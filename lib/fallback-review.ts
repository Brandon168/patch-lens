import {
  extractSupportedServices,
  inferChangeType,
} from '@/lib/review-draft';
import {
  reviewVerdictSchema,
  type RecommendedAction,
  type ReviewDraft,
  type ReviewVerdict,
  type RiskLevel,
} from '@/lib/review-types';

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter(pattern => pattern.test(text)).length;
}

function buildRollbackPlan(
  riskLevel: RiskLevel,
  changeType: ReturnType<typeof inferChangeType>,
): string {
  if (riskLevel === 'unknown') {
    return 'Hold the change until the owner can show the exact implementation path and a concrete revert procedure.';
  }

  if (changeType === 'database') {
    return 'Revert the migration before the next deploy window and restore the removed data from the last known good backup if reads still depend on it.';
  }

  if (changeType === 'network') {
    return 'Reapply the previous ingress boundary and redeploy the network config before keeping the wider rule in place.';
  }

  if (changeType === 'auth') {
    return 'Revert the token lifetime and grace-window change together, then watch refresh failures and unexpected logout rates.';
  }

  if (changeType === 'config') {
    return 'Restore the prior timeout or breaker settings as one unit and compare upstream latency and retry pressure after the rollback.';
  }

  return 'Revert the patch and redeploy the last known good build if the behavior change produces unexpected user impact.';
}

function mapRecommendedAction(riskLevel: RiskLevel): RecommendedAction {
  switch (riskLevel) {
    case 'low':
      return 'approve';
    case 'medium':
      return 'review';
    case 'high':
      return 'block';
    case 'unknown':
      return 'need-more-info';
  }
}

export function evaluateFallbackReview(draft: ReviewDraft): ReviewVerdict {
  const haystack = `${draft.title}\n${draft.summary}\n${draft.diff}`.toLowerCase();
  const changeType = inferChangeType(draft);
  const serviceNames = extractSupportedServices(draft);
  const lineCount = draft.diff.split('\n').length;
  const additions = draft.diff
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
  const deletions = draft.diff
    .split('\n')
    .filter(line => line.startsWith('-') && !line.startsWith('---')).length;

  const highPatterns = [
    /\bdrop column\b/,
    /\bdrop table\b/,
    /\bdelete from\b/,
    /\btruncate\b/,
    /\b0\.0\.0\.0\/0\b/,
    /\bpublic ingress\b/,
    /\bdisable auth\b/,
    /\bbypass\b/,
  ];
  const mediumPatterns = [
    /\btimeout\b/,
    /\bretry\b/,
    /\bttl\b/,
    /\brefresh\b/,
    /\bcircuitbreaker\b/,
    /\bcircuit breaker\b/,
    /\bauth-api\b/,
    /\bpayments-api\b/,
    /\borders-api\b/,
  ];
  const lowPatterns = [
    /\bbanner\b/,
    /\bcopy\b/,
    /\btext\b/,
    /\bfeature flag\b/,
    /\bflagged\b/,
    /\bui\b/,
    /\bcss\b/,
  ];

  const highSignal = hasAny(haystack, highPatterns);
  const mediumSignalCount = countMatches(haystack, mediumPatterns);
  const lowSignal = hasAny(haystack, lowPatterns);
  const ambiguousSignal =
    /\bfast\b|\bperformance\b|\btweak\b|\bcleanup\b|\brefactor\b/.test(haystack) &&
    lineCount <= 12;

  let riskLevel: RiskLevel;
  let confidence: number;

  if (highSignal) {
    riskLevel = 'high';
    confidence = 86;
  } else if (ambiguousSignal || (lineCount <= 8 && mediumSignalCount === 0 && !lowSignal)) {
    riskLevel = 'unknown';
    confidence = 34;
  } else if (mediumSignalCount > 0) {
    riskLevel = 'medium';
    confidence = 68;
  } else if (lowSignal) {
    riskLevel = 'low';
    confidence = 79;
  } else {
    riskLevel = 'unknown';
    confidence = 42;
  }

  const reasoning = unique(
    [
      highSignal
        ? 'The diff changes an obviously destructive or externally exposed surface.'
        : undefined,
      mediumSignalCount > 0
        ? 'The patch changes runtime behavior with operational consequences rather than a purely cosmetic path.'
        : undefined,
      lowSignal
        ? 'The patch reads as a narrow presentation-layer change with limited blast radius.'
        : undefined,
      ambiguousSignal
        ? 'The diff points to a new fast path without showing enough implementation detail to defend it.'
        : undefined,
      serviceNames.length > 0
        ? `The patch touches ${serviceNames.join(', ')}, which raises the impact beyond a local helper change.`
        : undefined,
      additions + deletions > 20
        ? 'The patch is wide enough that rollback and validation detail matters.'
        : undefined,
      lineCount <= 8 && riskLevel === 'unknown'
        ? 'The patch is too small and too vague to infer safe behavior confidently.'
        : undefined,
    ].filter(Boolean) as string[],
  ).slice(0, 5);

  const missingInfo = unique(
    [
      !/\btest\b|\.spec\b|\.test\b/.test(haystack)
        ? 'No explicit test coverage or validation evidence is shown in the patch.'
        : undefined,
      !/\brollback\b|\brevert\b|\brestore\b/.test(haystack) && riskLevel !== 'low'
        ? 'No rollback steps are shown for the changed behavior.'
        : undefined,
      !/\bflag\b|\bcanary\b|\bgradual\b/.test(haystack) &&
      (riskLevel === 'medium' || riskLevel === 'high')
        ? 'No staged rollout or containment control is visible.'
        : undefined,
      riskLevel === 'unknown'
        ? 'The patch does not show enough surrounding implementation detail to confirm safety.'
        : undefined,
    ].filter(Boolean) as string[],
  ).slice(0, 5);

  const recommendedAction = mapRecommendedAction(riskLevel);
  const executiveSummary = (() => {
    if (riskLevel === 'high') {
      return 'This patch changes a high-blast-radius surface without enough safety evidence to justify shipping as-is.';
    }

    if (riskLevel === 'medium') {
      return 'This patch looks plausible, but it changes operational behavior and needs a tighter technical review before approval.';
    }

    if (riskLevel === 'low') {
      return 'This patch appears narrow and low blast radius based on the diff that is shown.';
    }

    return 'This patch is too ambiguous to defend confidently from the diff alone.';
  })();

  return reviewVerdictSchema.parse({
    riskLevel,
    confidence,
    reasoning:
      reasoning.length >= 2
        ? reasoning
        : [
            executiveSummary,
            'The deterministic fallback stayed conservative because the diff did not provide enough direct evidence.',
          ],
    missingInfo,
    rollbackPlan: buildRollbackPlan(riskLevel, changeType),
    recommendedAction,
    executiveSummary,
  });
}

export function buildFallbackNarrative(verdict: ReviewVerdict): string {
  const reasoning = verdict.reasoning.map(item => `- ${item}`).join('\n');
  const missingInfo =
    verdict.missingInfo.length > 0
      ? verdict.missingInfo.map(item => `- ${item}`).join('\n')
      : '- No extra gaps were detected in the deterministic pass.';

  return [
    verdict.executiveSummary,
    `Recommended action: ${verdict.recommendedAction}.`,
    `Confidence: ${verdict.confidence}/100.`,
    '',
    'Why this landed there:',
    reasoning,
    '',
    'What is still missing:',
    missingInfo,
    '',
    `Rollback plan: ${verdict.rollbackPlan}`,
  ].join('\n');
}
