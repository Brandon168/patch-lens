import { prReviewAgent } from '../lib/agents/pr-review-agent';
import { evaluateFallbackReview } from '../lib/fallback-review';
import { hasReviewModelAccess } from '../lib/model';
import { reviewFixtures } from './fixtures/review-fixtures';

async function runDeterministicChecks() {
  const failures: string[] = [];

  for (const fixture of reviewFixtures) {
    const verdict = evaluateFallbackReview(fixture);

    if (verdict.riskLevel !== fixture.expectedRiskLevel) {
      failures.push(
        `${fixture.id}: expected risk ${fixture.expectedRiskLevel}, got ${verdict.riskLevel}`,
      );
    }

    if (verdict.recommendedAction !== fixture.expectedAction) {
      failures.push(
        `${fixture.id}: expected action ${fixture.expectedAction}, got ${verdict.recommendedAction}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('Deterministic eval failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Deterministic eval passed for ${reviewFixtures.length} fixtures.`);
}

async function runLiveSmoke() {
  if (!hasReviewModelAccess()) {
    console.log('Skipping live smoke because PATCH_LENS_GATEWAY_API_KEY is not set.');
    return;
  }

  const smokeFixtures = reviewFixtures.filter(fixture =>
    ['auth-token-refresh', 'drop-orders-column'].includes(fixture.id),
  );

  for (const fixture of smokeFixtures) {
    const result = await prReviewAgent.generate({
      prompt: 'Review this patch.',
      options: { draft: fixture },
    });
    const output = await result.output;
    const steps = await result.steps;
    const toolNames = steps.flatMap(step =>
      step.toolCalls.map(toolCall => toolCall.toolName),
    );

    if (!toolNames.includes('getReviewChecklist')) {
      throw new Error(`${fixture.id}: missing required checklist tool call`);
    }

    if (
      fixture.id === 'auth-token-refresh' &&
      !toolNames.includes('lookupServiceProfile')
    ) {
      throw new Error(`${fixture.id}: missing service profile tool call`);
    }

    console.log(
      `Live smoke passed for ${fixture.id}: ${output.riskLevel} / ${output.recommendedAction}`,
    );
  }
}

async function main() {
  await runDeterministicChecks();
  await runLiveSmoke();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
