import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
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
import {
  type FallbackReason,
  type ReviewMessageMetadata,
  reviewVerdictSchema,
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

  let draft: ReviewAgentOptions['draft'];

  try {
    draft = normalizeReviewDraft(parsed.data.draft);
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

  // Compute a conservative fallback upfront so a bad model finish can still return a typed verdict.
  const fallbackVerdict = evaluateFallbackReview(draft);

  try {
    const result = await prReviewAgent.stream({
      prompt: `Review patch: ${draft.title}`,
      options: { draft },
    });

    return createUIMessageStreamResponse({
      stream: createUIMessageStream<ReviewUIMessage>({
        originalMessages,
        onError: error => {
          console.error('review stream error', error);
          return 'Review run failed before a complete verdict was produced.';
        },
        execute: async ({ writer }) => {
          // Let tool calls and assistant text stream immediately, then attach the authoritative
          // verdict only after the structured output has been validated.
          writer.merge(
            result.toUIMessageStream<ReviewUIMessage>({
              originalMessages,
              sendReasoning: false,
              sendFinish: false,
              messageMetadata: ({ part }) => {
                if (part.type !== 'start') {
                  return undefined;
                }

                return {
                  reviewPath: 'agent',
                  durationMs: 0,
                  modelId: reviewModelId,
                } satisfies ReviewMessageMetadata;
              },
              onError: error => {
                console.error('review stream error', error);
                return 'Review run failed before a complete verdict was produced.';
              },
            }),
          );

          let verdict: ReviewVerdict = fallbackVerdict;
          let reviewPath: ReviewMessageMetadata['reviewPath'] = 'agent';
          let fallbackReason: FallbackReason | undefined;

          try {
            verdict = reviewVerdictSchema.parse(await result.output);
          } catch (error) {
            console.error('review output invalid, using fallback verdict', error);
            reviewPath = 'fallback';
            fallbackReason = 'agent-error';
          }

          let totalUsage:
            | Awaited<typeof result.totalUsage>
            | undefined;

          try {
            totalUsage = await result.totalUsage;
          } catch (error) {
            console.error('review usage unavailable', error);
          }

          let finishReason: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';

          try {
            finishReason = await result.finishReason;
          } catch (error) {
            console.error('review finish reason unavailable', error);
            // If the stream cannot report a finish reason, treat the run as an agent failure in metadata.
            reviewPath = 'fallback';
            fallbackReason = 'agent-error';
            finishReason = 'error';
          }

          writer.write({
            type: 'finish',
            finishReason,
            messageMetadata: {
              reviewPath,
              durationMs: Date.now() - startedAt,
              modelId: reviewModelId,
              completedAt: new Date().toISOString(),
              fallbackReason,
              totalTokens: totalUsage?.totalTokens,
              verdict,
            } satisfies ReviewMessageMetadata,
          });
        },
      }),
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
