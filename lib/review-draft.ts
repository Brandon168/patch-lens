import {
  changeTypeSchema,
  reviewDraftSchema,
  supportedServiceSchema,
  type ChangeType,
  type ReviewDraft,
  type SupportedService,
} from '@/lib/review-types';

function cleanLine(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanBlock(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

export function normalizeReviewDraft(input: Partial<ReviewDraft>): ReviewDraft {
  return reviewDraftSchema.parse({
    title: cleanLine(input.title),
    summary: cleanBlock(input.summary),
    diff: cleanBlock(input.diff),
    simulateFallback: Boolean(input.simulateFallback),
  });
}

export function inferChangeType(draft: ReviewDraft): ChangeType {
  // Keep the hint deliberately cheap and explainable; this is only there to narrow the review rubric.
  const haystack = `${draft.title}\n${draft.summary}\n${draft.diff}`.toLowerCase();

  if (
    /\balter table\b|\bdrop column\b|\bdrop table\b|\bcreate index\b|\bmigration\b|\bdelete from\b|\btruncate\b/.test(
      haystack,
    )
  ) {
    return changeTypeSchema.enum.database;
  }

  if (
    /\bingress\b|\bsecurity group\b|\ballowlist\b|\bcidr\b|\bfirewall\b|\bload balancer\b|\bpublic ingress\b/.test(
      haystack,
    )
  ) {
    return changeTypeSchema.enum.network;
  }

  if (
    /\bauth\b|\btoken\b|\boauth\b|\bjwt\b|\bsession\b|\brefresh\b|\blogin\b/.test(
      haystack,
    )
  ) {
    return changeTypeSchema.enum.auth;
  }

  if (
    /\btimeout\b|\bretry\b|\bconfig\b|\benv\b|\bhelm\b|\byaml\b|\bfeature flag\b|\bttl\b/.test(
      haystack,
    )
  ) {
    return changeTypeSchema.enum.config;
  }

  return changeTypeSchema.enum.application;
}

export function extractSupportedServices(
  draft: Pick<ReviewDraft, 'title' | 'summary' | 'diff'>,
): SupportedService[] {
  // Only return services the tools know how to enrich so tool availability stays explicit.
  const haystack = `${draft.title}\n${draft.summary}\n${draft.diff}`.toLowerCase();
  const services = new Set<SupportedService>();

  for (const serviceName of supportedServiceSchema.options) {
    const pattern = new RegExp(`\\b${serviceName.replace('-', '\\-')}\\b`, 'i');

    if (pattern.test(haystack)) {
      services.add(serviceName);
    }
  }

  return [...services];
}
