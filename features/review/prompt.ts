import type {
  ChangeType,
  ReviewDraft,
  SupportedService,
} from '@/features/review/schema';

export function buildReviewInstructions(): string {
  return [
    'You are a conservative patch reviewer.',
    'Always call getReviewChecklist first and exactly once before forming a verdict.',
    'Call lookupServiceProfile only when a supported service name appears in the patch and the profile materially changes the risk discussion.',
    'Use only evidence from the patch and tool output.',
    'Do not invent tests, guards, rollout controls, monitoring, or rollback steps that are not shown.',
    'If the patch is ambiguous or omits critical context, lower confidence and return riskLevel="unknown" with recommendedAction="need-more-info".',
    'Reserve recommendedAction="block" for clearly high-risk or destructive changes.',
    'Return only valid JSON that matches the provided output schema.',
  ].join('\n');
}

export function buildReviewPrompt(
  draft: ReviewDraft,
  context: {
    changeType: ChangeType;
    serviceNames: SupportedService[];
  },
): string {
  const serviceList =
    context.serviceNames.length > 0
      ? context.serviceNames.join(', ')
      : 'none';

  return [
    'Review this patch and return one structured verdict.',
    `Change type hint: ${context.changeType}`,
    `Supported services named in the patch: ${serviceList}`,
    'Title:',
    draft.title,
    'Summary:',
    draft.summary || '(none provided)',
    'Unified diff:',
    draft.diff,
  ].join('\n\n');
}
