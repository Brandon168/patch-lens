import { Output, ToolLoopAgent, stepCountIs } from 'ai';
import { z } from 'zod';
import {
  extractSupportedServices,
  inferChangeType,
} from '@/lib/review-draft';
import { reviewLanguageModel } from '@/lib/model';
import {
  buildReviewInstructions,
  buildReviewPrompt,
} from '@/lib/review-prompt';
import {
  reviewDraftSchema,
  reviewVerdictSchema,
  type ChangeType,
  type ReviewDraft,
  type SupportedService,
} from '@/lib/review-types';
import { reviewTools } from '@/lib/tools/review-tools';

const reviewAgentOptionsSchema = z.object({
  draft: reviewDraftSchema,
});

type ReviewAgentContext = {
  draft: ReviewDraft;
  changeType: ChangeType;
  serviceNames: SupportedService[];
};

export type ReviewAgentOptions = z.infer<typeof reviewAgentOptionsSchema>;

const reviewVerdictOutput = Output.object({
  schema: reviewVerdictSchema,
  name: 'patchVerdict',
  description:
    'A conservative patch review verdict with explicit risk, confidence, gaps, and rollback guidance.',
});

export const prReviewAgent = new ToolLoopAgent<
  ReviewAgentOptions,
  typeof reviewTools,
  typeof reviewVerdictOutput
>({
  id: 'patch-reviewer',
  model: reviewLanguageModel,
  instructions: buildReviewInstructions(),
  tools: reviewTools,
  output: reviewVerdictOutput,
  temperature: 0,
  stopWhen: stepCountIs(4),
  callOptionsSchema: reviewAgentOptionsSchema,
  prepareCall: ({ options, ...callArgs }) => {
    const draft = options.draft;
    const changeType = inferChangeType(draft);
    const serviceNames = extractSupportedServices(draft);

    // Derive review context once so prompt construction and tool policy stay aligned across steps.
    return {
      ...callArgs,
      model: reviewLanguageModel,
      prompt: buildReviewPrompt(draft, { changeType, serviceNames }),
      experimental_context: {
        draft,
        changeType,
        serviceNames,
      } satisfies ReviewAgentContext,
    };
  },
  prepareStep: ({ stepNumber, steps, experimental_context }) => {
    const context = experimental_context as ReviewAgentContext;
    const serviceProfileWasCalled = steps.some(step =>
      step.toolCalls.some(call => call.toolName === 'lookupServiceProfile'),
    );

    // Force the checklist first so every run starts from the same bounded review rubric.
    if (stepNumber === 0) {
      return {
        activeTools: ['getReviewChecklist'],
        toolChoice: { type: 'tool', toolName: 'getReviewChecklist' },
        experimental_context: context,
      };
    }

    // The second tool is only useful when the diff names a supported service and we have not
    // already enriched the run with that service profile.
    if (context.serviceNames.length > 0 && !serviceProfileWasCalled) {
      return {
        activeTools: ['lookupServiceProfile'],
        toolChoice: { type: 'tool', toolName: 'lookupServiceProfile' },
        experimental_context: context,
      };
    }

    return {
      activeTools: [],
      toolChoice: 'none',
      experimental_context: context,
    };
  },
});
