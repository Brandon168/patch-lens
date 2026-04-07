import { type ToolSet } from 'ai';
import { z } from 'zod';
import {
  changeTypeSchema,
  supportedServiceSchema,
  type ChangeType,
  type SupportedService,
} from '@/features/review/schema';

const reviewChecklists: Record<
  ChangeType,
  {
    changeType: ChangeType;
    focusAreas: string[];
    stopIfMissing: string[];
  }
> = {
  application: {
    changeType: 'application',
    focusAreas: [
      'User-facing behavior changes',
      'Feature flag or safe rollout controls',
      'Tests or assertions for the changed branch',
    ],
    stopIfMissing: [
      'Clear evidence of the user-visible behavior being changed',
      'Any rollback or containment plan if the change is wider than a copy tweak',
    ],
  },
  database: {
    changeType: 'database',
    focusAreas: [
      'Destructive schema operations',
      'Backfill or compatibility window',
      'Rollback path for data shape changes',
    ],
    stopIfMissing: [
      'Whether the dropped or changed field is still read anywhere',
      'How the data will be restored if the migration must be reversed',
    ],
  },
  network: {
    changeType: 'network',
    focusAreas: [
      'Blast radius of the ingress or allowlist change',
      'Temporary versus permanent exposure',
      'Operational guardrails and monitoring',
    ],
    stopIfMissing: [
      'Why the wider access is needed',
      'When and how the previous boundary will be restored',
    ],
  },
  auth: {
    changeType: 'auth',
    focusAreas: [
      'Token lifetime and replay window changes',
      'Login or session failure modes',
      'Rollback path for auth regressions',
    ],
    stopIfMissing: [
      'Evidence that the new lifetime is compatible with existing revocation logic',
      'Signals to watch after rollout if refresh behavior degrades',
    ],
  },
  config: {
    changeType: 'config',
    focusAreas: [
      'Timeout and retry interactions',
      'Latency versus availability tradeoffs',
      'Environment-specific blast radius',
    ],
    stopIfMissing: [
      'Why the new configuration is safe under peak load',
      'How the previous settings will be restored if latency or saturation worsens',
    ],
  },
};

const serviceProfiles: Record<
  SupportedService,
  {
    serviceName: SupportedService;
    blastRadius: string;
    watchMetrics: string[];
    rollbackHints: string[];
  }
> = {
  'auth-api': {
    serviceName: 'auth-api',
    blastRadius: 'Login, refresh-token rotation, and session validity across the entire product surface.',
    watchMetrics: [
      'Refresh token failure rate',
      'Unexpected logout rate',
      'Login latency at the token endpoint',
    ],
    rollbackHints: [
      'Revert TTL and grace-window settings together',
      'Watch for session revocation lag after rollback',
    ],
  },
  'payments-api': {
    serviceName: 'payments-api',
    blastRadius: 'Checkout completion and payment authorization latency under upstream provider stress.',
    watchMetrics: [
      'Payment timeout rate',
      'Circuit-breaker open events',
      'Median and p95 authorization latency',
    ],
    rollbackHints: [
      'Restore the prior timeout and breaker threshold as one unit',
      'Check queued retry volume after rollback',
    ],
  },
  'orders-api': {
    serviceName: 'orders-api',
    blastRadius: 'Order ingestion, worker throughput, and fulfillment handoff for new orders.',
    watchMetrics: [
      'Worker retry count',
      'Order processing latency',
      'Dead-letter queue volume',
    ],
    rollbackHints: [
      'Revert the worker path and drain any failing batch queue',
      'Validate that downstream fulfillment events recover after rollback',
    ],
  },
};

export const reviewTools = {
  getReviewChecklist: {
    description:
      'Return the bounded checklist for a patch change type so the review stays narrow.',
    inputSchema: z.object({
      changeType: changeTypeSchema,
    }),
    execute: async ({ changeType }: { changeType: ChangeType }) =>
      reviewChecklists[changeType],
  },
  lookupServiceProfile: {
    description:
      'Return a short risk profile for a supported service when the patch touches it directly.',
    inputSchema: z.object({
      serviceName: supportedServiceSchema,
    }),
    execute: async ({ serviceName }: { serviceName: SupportedService }) =>
      serviceProfiles[serviceName],
  },
} satisfies ToolSet;
