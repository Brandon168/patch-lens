import {
  reviewScenarioSchema,
  type ReviewScenario,
} from '@/lib/review-types';

export const reviewScenarios: ReviewScenario[] = [
  reviewScenarioSchema.parse({
    id: 'banner-copy-flag',
    label: 'Flagged Banner Copy',
    title: 'Tighten checkout banner copy behind the existing flag',
    summary:
      'Swaps the banner text while keeping the rollout behind an existing feature flag.',
    diff: `diff --git a/web/src/components/CheckoutBanner.tsx b/web/src/components/CheckoutBanner.tsx
index 9b3d1d1..f3b1220 100644
--- a/web/src/components/CheckoutBanner.tsx
+++ b/web/src/components/CheckoutBanner.tsx
@@ -12,7 +12,7 @@ export function CheckoutBanner({ flags }: Props) {
-  const copy = 'Try the new checkout flow';
+  const copy = flags.newCheckoutBanner ? 'Try the guided checkout flow' : 'Checkout is ready when you are';
 
   return (
     <Banner
@@ -25,6 +25,6 @@ export function CheckoutBanner({ flags }: Props) {
       actionLabel="Open checkout"
     >
       {copy}
-    </Banner>
+    </Banner>
   );
 }`,
    expectedRiskLevel: 'low',
    expectedAction: 'approve',
    simulateFallback: false,
  }),
  reviewScenarioSchema.parse({
    id: 'auth-token-refresh',
    label: 'Auth Refresh Window',
    title: 'Extend refresh token lifetime in auth-api',
    summary:
      'Reduces re-auth prompts by extending refresh lifetime and shrinking the grace window.',
    diff: `diff --git a/services/auth-api/src/token/refresh.ts b/services/auth-api/src/token/refresh.ts
index 7a24f2d..d12f64a 100644
--- a/services/auth-api/src/token/refresh.ts
+++ b/services/auth-api/src/token/refresh.ts
@@ -3,12 +3,12 @@ import { issueTokenPair } from './issue-token-pair';
 
-const REFRESH_TOKEN_TTL_MINUTES = 30;
+const REFRESH_TOKEN_TTL_MINUTES = 120;
 
 export async function rotateRefreshToken(session: Session) {
-  const gracePeriodSeconds = 60;
+  const gracePeriodSeconds = 5;
 
   return issueTokenPair({
     sessionId: session.id,
     ttlMinutes: REFRESH_TOKEN_TTL_MINUTES,
     gracePeriodSeconds,
   });
 }`,
    expectedRiskLevel: 'medium',
    expectedAction: 'review',
    simulateFallback: false,
  }),
  reviewScenarioSchema.parse({
    id: 'payments-timeout-config',
    label: 'Payments Timeout',
    title: 'Raise upstream timeout and breaker threshold in payments-api',
    summary:
      'Expands the payment gateway timeout window during a recent provider slowdown.',
    diff: `diff --git a/services/payments-api/src/gateway/client.ts b/services/payments-api/src/gateway/client.ts
index 4fd8c0a..69dd7af 100644
--- a/services/payments-api/src/gateway/client.ts
+++ b/services/payments-api/src/gateway/client.ts
@@ -8,10 +8,10 @@ export const gatewayClient = new PaymentGatewayClient({
   baseUrl: process.env.PAYMENT_GATEWAY_URL,
-  timeoutMs: 2000,
+  timeoutMs: 10000,
   retry: {
     attempts: 2,
   },
   circuitBreaker: {
-    failureThreshold: 5,
+    failureThreshold: 12,
   },
 });`,
    expectedRiskLevel: 'medium',
    expectedAction: 'review',
    simulateFallback: false,
  }),
  reviewScenarioSchema.parse({
    id: 'drop-orders-column',
    label: 'Drop Orders Column',
    title: 'Remove legacy fulfillment column from orders',
    summary:
      'Deletes a column that was previously backfilled into a new structure.',
    diff: `diff --git a/db/migrations/20260328_drop_legacy_fulfillment.sql b/db/migrations/20260328_drop_legacy_fulfillment.sql
new file mode 100644
index 0000000..4ab9d2f
--- /dev/null
+++ b/db/migrations/20260328_drop_legacy_fulfillment.sql
@@ -0,0 +1,7 @@
+BEGIN;
+
+ALTER TABLE orders
+  DROP COLUMN legacy_fulfillment_state;
+
+COMMIT;`,
    expectedRiskLevel: 'high',
    expectedAction: 'block',
    simulateFallback: false,
  }),
  reviewScenarioSchema.parse({
    id: 'ingress-allowlist',
    label: 'Open Ingress',
    title: 'Temporarily widen inbound access for partner debugging',
    summary:
      'Expands the production allowlist while a partner IP range is still unknown.',
    diff: `diff --git a/infra/network/ingress.tf b/infra/network/ingress.tf
index 4c720b1..c22dd17 100644
--- a/infra/network/ingress.tf
+++ b/infra/network/ingress.tf
@@ -11,7 +11,7 @@ resource "aws_security_group_rule" "partner_ingress" {
   from_port         = 443
   to_port           = 443
   protocol          = "tcp"
-  cidr_blocks       = ["203.0.113.42/32"]
+  cidr_blocks       = ["0.0.0.0/0"]
   security_group_id = aws_security_group.partner_gateway.id
 }`,
    expectedRiskLevel: 'high',
    expectedAction: 'block',
    simulateFallback: false,
  }),
  reviewScenarioSchema.parse({
    id: 'mystery-performance-tweak',
    label: 'Unclear Fast Path',
    title: 'Swap in a faster order worker path',
    summary:
      'Claims a performance improvement without showing the new implementation or any safety checks.',
    diff: `diff --git a/services/orders-api/src/worker/process-batch.ts b/services/orders-api/src/worker/process-batch.ts
index 4bc3b0f..9e73051 100644
--- a/services/orders-api/src/worker/process-batch.ts
+++ b/services/orders-api/src/worker/process-batch.ts
@@ -18,7 +18,7 @@ export async function processBatch(batch: OrderBatch) {
-  return processBatchStable(batch);
+  return processBatchFast(batch);
 }`,
    expectedRiskLevel: 'unknown',
    expectedAction: 'need-more-info',
    simulateFallback: false,
  }),
];

export const demoScenarioIds = [
  'auth-token-refresh',
  'ingress-allowlist',
  'mystery-performance-tweak',
] as const;

export const demoReviewScenarios = reviewScenarios.filter(scenario =>
  demoScenarioIds.includes(scenario.id as (typeof demoScenarioIds)[number]),
);

export function getReviewScenario(id: string): ReviewScenario | undefined {
  return reviewScenarios.find(scenario => scenario.id === id);
}
