import {
  createAgentUIStreamResponse,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  prReviewAgent,
  type ReviewAgentOptions,
} from '@/lib/agents/pr-review-agent';
import {
  buildFallbackNarrative,
  evaluateFallbackReview,
} from '@/lib/fallback-review';
import { hasReviewModelAccess, reviewModelId } from '@/lib/model';
import { normalizeReviewDraft } from '@/lib/review-draft';
import { type ReviewUIMessage } from '@/lib/review-message';
import { getReviewScenario } from '@/lib/review-scenarios';
import {
  type FallbackReason,
  parseReviewVerdictText,
  type ReviewMessageMetadata,
  type ReviewVerdict,
} from '@/lib/review-types';

export const runtime = 'nodejs';

const requestSchema = z.object({
  messages: z.array(z.unknown()).default([]),
  draft: z
    .object({
      title: z.string().optional(),
      summary: z.string().optional(),
      diff: z.string().optional(),
      scenarioId: z.string().optional(),
      simulateFallback: z.boolean().optional(),
    })
    .default({}),
});

function toErrorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function chunkText(text: string, chunkSize = 48): string[] {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }

  return chunks;
}

function createFallbackResponse(options: {
  draft: ReviewAgentOptions['draft'];
  fallbackReason: FallbackReason;
  originalMessages: ReviewUIMessage[];
  startedAt: number;
}) {
  const verdict = evaluateFallbackReview(options.draft);
  const narrative = buildFallbackNarrative(verdict);

  // Keep the fallback verdict contract aligned with the agent path so the UI does not branch on shape.
  return createUIMessageStreamResponse({
    stream: createUIMessageStream<ReviewUIMessage>({
      originalMessages: options.originalMessages,
      execute: ({ writer }) => {
        const textId = `fallback-${crypto.randomUUID()}`;

        writer.write({
          type: 'start',
          messageMetadata: {
            reviewPath: 'fallback',
            durationMs: 0,
            // Expose the fallback cause in stream metadata without adding persistence or tracing infrastructure.
            fallbackReason: options.fallbackReason,
          } satisfies ReviewMessageMetadata,
        });
        writer.write({ type: 'start-step' });
        writer.write({ type: 'text-start', id: textId });

        for (const delta of chunkText(narrative)) {
          writer.write({
            type: 'text-delta',
            id: textId,
            delta,
          });
        }

        writer.write({ type: 'text-end', id: textId });
        writer.write({ type: 'finish-step' });
        writer.write({
          type: 'finish',
          finishReason: 'stop',
          messageMetadata: {
            reviewPath: 'fallback',
            durationMs: Date.now() - options.startedAt,
            completedAt: new Date().toISOString(),
            fallbackReason: options.fallbackReason,
            verdict,
          } satisfies ReviewMessageMetadata,
        });
      },
    }),
  });
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return toErrorResponse('Invalid JSON body.');
  }

  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    return toErrorResponse('Invalid review request.');
  }

  const scenarioId = parsed.data.draft.scenarioId;
  const scenario = scenarioId ? getReviewScenario(scenarioId) : undefined;

  if (scenarioId && !scenario) {
    return toErrorResponse('Unknown scenario.');
  }

  let draft: ReviewAgentOptions['draft'];

  try {
    draft = normalizeReviewDraft(parsed.data.draft, scenario);
  } catch {
    return toErrorResponse('A title and diff are required.');
  }

  const originalMessages = parsed.data.messages as ReviewUIMessage[];
  const startedAt = Date.now();

  if (draft.simulateFallback || !hasReviewModelAccess()) {
    return createFallbackResponse({
      draft,
      fallbackReason: draft.simulateFallback ? 'simulate' : 'no-model-access',
      originalMessages,
      startedAt,
    });
  }

  let totalTokens = 0;
  let finalVerdict: ReviewVerdict | undefined;
  const fallbackVerdict = evaluateFallbackReview(draft);

  try {
    return await createAgentUIStreamResponse({
      agent: prReviewAgent,
      uiMessages: originalMessages,
      originalMessages,
      options: { draft },
      sendReasoning: false,
      onStepFinish: step => {
        totalTokens += step.usage.totalTokens ?? 0;

        const verdict = parseReviewVerdictText(step.text);

        if (verdict) {
          finalVerdict = verdict;
        }
      },
      messageMetadata: ({ part }) => {
        if (part.type === 'start') {
          return {
            reviewPath: 'agent',
            durationMs: 0,
            modelId: reviewModelId,
          } satisfies ReviewMessageMetadata;
        }

        if (part.type === 'finish') {
          const verdict = finalVerdict ?? fallbackVerdict;
          const fellBack = !finalVerdict;

          return {
            reviewPath: fellBack ? 'fallback' : 'agent',
            durationMs: Date.now() - startedAt,
            modelId: reviewModelId,
            completedAt: new Date().toISOString(),
            fallbackReason: fellBack ? 'agent-error' : undefined,
            totalTokens: totalTokens || undefined,
            verdict,
          } satisfies ReviewMessageMetadata;
        }

        return undefined;
      },
      onError: error => {
        console.error('review stream error', error);
        return 'Review run failed before a complete verdict was produced.';
      },
    });
  } catch (error) {
    console.error('review route failed, falling back', error);
    return createFallbackResponse({
      draft,
      fallbackReason: 'agent-error',
      originalMessages,
      startedAt,
    });
  }
}
