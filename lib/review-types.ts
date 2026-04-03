import { z } from 'zod';

export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'unknown']);

export const recommendedActionSchema = z.enum([
  'approve',
  'review',
  'block',
  'need-more-info',
]);

export const changeTypeSchema = z.enum([
  'application',
  'database',
  'network',
  'auth',
  'config',
]);

export const supportedServiceSchema = z.enum([
  'auth-api',
  'payments-api',
  'orders-api',
]);

export const reviewDraftSchema = z.object({
  title: z.string().min(3),
  summary: z.string().default(''),
  diff: z.string().min(1),
  scenarioId: z.string().optional(),
  simulateFallback: z.boolean().default(false),
});

export const reviewVerdictSchema = z.object({
  riskLevel: riskLevelSchema,
  confidence: z.number().int().min(0).max(100),
  reasoning: z.array(z.string().min(1)).min(2).max(5),
  missingInfo: z.array(z.string().min(1)).max(5),
  rollbackPlan: z.string().min(1),
  recommendedAction: recommendedActionSchema,
  executiveSummary: z.string().min(1).max(280),
});

export const reviewMessageMetadataSchema = z.object({
  reviewPath: z.enum(['agent', 'fallback']),
  modelId: z.string().optional(),
  completedAt: z.string().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  verdict: reviewVerdictSchema.optional(),
});

export const reviewScenarioSchema = reviewDraftSchema.extend({
  id: z.string().min(1),
  label: z.string().min(1),
  expectedRiskLevel: riskLevelSchema,
  expectedAction: recommendedActionSchema,
});

export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type RecommendedAction = z.infer<typeof recommendedActionSchema>;
export type ChangeType = z.infer<typeof changeTypeSchema>;
export type SupportedService = z.infer<typeof supportedServiceSchema>;
export type ReviewDraft = z.infer<typeof reviewDraftSchema>;
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type ReviewMessageMetadata = z.infer<typeof reviewMessageMetadataSchema>;
export type ReviewScenario = z.infer<typeof reviewScenarioSchema>;

export function parseReviewVerdictText(text: string): ReviewVerdict | undefined {
  const trimmed = text.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = z
    .string()
    .transform(value => JSON.parse(value))
    .pipe(reviewVerdictSchema)
    .safeParse(trimmed);

  return parsed.success ? parsed.data : undefined;
}
