import {
  changeTypeSchema,
  reviewDraftSchema,
  supportedServiceSchema,
  type ChangeType,
  type ReviewDraft,
  type ReviewScenario,
  type SupportedService,
} from '@/lib/review-types';

function cleanLine(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanBlock(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

export function normalizeReviewDraft(
  input: Partial<ReviewDraft>,
  scenario?: ReviewScenario,
): ReviewDraft {
  return reviewDraftSchema.parse({
    title: cleanLine(input.title ?? scenario?.title),
    summary: cleanBlock(input.summary ?? scenario?.summary),
    diff: cleanBlock(input.diff ?? scenario?.diff),
    scenarioId: input.scenarioId ?? scenario?.id,
    simulateFallback: Boolean(input.simulateFallback),
  });
}

export function inferChangeType(draft: ReviewDraft): ChangeType {
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
