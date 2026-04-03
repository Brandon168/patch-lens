import { prReviewAgent } from '../lib/agents/pr-review-agent';
import { evaluateFallbackReview } from '../lib/fallback-review';
import { hasReviewModelAccess } from '../lib/model';
import { reviewScenarios } from '../lib/review-scenarios';

async function runDeterministicChecks() {
  const failures: string[] = [];

  for (const scenario of reviewScenarios) {
    const verdict = evaluateFallbackReview(scenario);

    if (verdict.riskLevel !== scenario.expectedRiskLevel) {
      failures.push(
        `${scenario.id}: expected risk ${scenario.expectedRiskLevel}, got ${verdict.riskLevel}`,
      );
    }

    if (verdict.recommendedAction !== scenario.expectedAction) {
      failures.push(
        `${scenario.id}: expected action ${scenario.expectedAction}, got ${verdict.recommendedAction}`,
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

  console.log(`Deterministic eval passed for ${reviewScenarios.length} fixtures.`);
}

async function runLiveSmoke() {
  if (!hasReviewModelAccess()) {
    console.log('Skipping live smoke because PATCH_LENS_GATEWAY_API_KEY is not set.');
    return;
  }

  const smokeScenarios = reviewScenarios.filter(scenario =>
    ['auth-token-refresh', 'drop-orders-column'].includes(scenario.id),
  );

  for (const scenario of smokeScenarios) {
    const result = await prReviewAgent.generate({
      prompt: 'Review this patch.',
      options: { draft: scenario },
    });
    const output = await result.output;
    const steps = await result.steps;
    const toolNames = steps.flatMap(step =>
      step.toolCalls.map(toolCall => toolCall.toolName),
    );

    if (!toolNames.includes('getReviewChecklist')) {
      throw new Error(`${scenario.id}: missing required checklist tool call`);
    }

    if (
      scenario.id === 'auth-token-refresh' &&
      !toolNames.includes('lookupServiceProfile')
    ) {
      throw new Error(`${scenario.id}: missing service profile tool call`);
    }

    console.log(
      `Live smoke passed for ${scenario.id}: ${output.riskLevel} / ${output.recommendedAction}`,
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
