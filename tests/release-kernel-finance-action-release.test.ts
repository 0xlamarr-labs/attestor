import { strict as assert } from 'node:assert';
import {
  buildFinanceActionReleaseMaterial,
  buildFinanceActionReleaseObservation,
  createFinanceActionReleaseCandidateFromReport,
} from '../src/release-kernel/finance-action-release.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';
import { createFinanceActionReleasePolicy } from '../src/release-kernel/release-policy.js';
import { createShadowModeReleaseEvaluator } from '../src/release-kernel/release-shadow-mode.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function makeFinanceReport(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'api-finance-action-release',
    decision: 'pass',
    certificate: { certificateId: 'cert_finance_action' },
    evidenceChain: { terminalHash: 'action_chain_terminal', intact: true },
    liveProof: {
      mode: 'live_runtime',
      consistent: true,
    },
    filingReadiness: {
      status: 'internal_report_ready',
      blockingGaps: 0,
    },
    audit: {
      chainIntact: true,
    },
    ...overrides,
  } as any;
}

async function main(): Promise<void> {
  const report = makeFinanceReport();
  const candidate = createFinanceActionReleaseCandidateFromReport(report);

  equal(
    candidate.workflowId,
    'finance.reporting.release-workflow',
    'Finance action release: canonical workflow id is stable',
  );
  equal(
    candidate.actionType,
    'workflow-dispatch',
    'Finance action release: canonical action type is stable',
  );

  const material = buildFinanceActionReleaseMaterial(candidate);
  equal(
    material.target.id,
    'finance.reporting.release-workflow.dispatch',
    'Finance action release: target is the workflow dispatch boundary',
  );
  ok(
    material.hashBundle.consequenceHash.startsWith('sha256:'),
    'Finance action release: consequence hash is canonicalized',
  );

  const observation = buildFinanceActionReleaseObservation(material, report);
  ok(
    observation.policyRulesSatisfied,
    'Finance action release: intact audit and non-blocked filing readiness satisfy the action bridge checks',
  );

  const engine = createReleaseDecisionEngine({
    policies: [createFinanceActionReleasePolicy()],
  });
  const shadowEvaluator = createShadowModeReleaseEvaluator({ engine });
  const shadow = shadowEvaluator.evaluate(
    {
      id: 'finance-action-shadow',
      createdAt: '2026-04-17T22:45:00.000Z',
      outputHash: material.hashBundle.outputHash,
      consequenceHash: material.hashBundle.consequenceHash,
      outputContract: material.outputContract,
      capabilityBoundary: material.capabilityBoundary,
      requester: {
        id: 'svc.attestor.api',
        type: 'service',
      },
      target: material.target,
    },
    observation,
  );

  equal(
    shadow.evaluation.decision.status,
    'review-required',
    'Finance action release: deterministic success still requires human authority for the higher-risk action flow',
  );
  equal(
    shadow.policyRolloutMode,
    'dry-run',
    'Finance action release: action launches under explicit dry-run rollout control',
  );
  equal(
    shadow.policyEvaluationMode,
    'shadow',
    'Finance action release: dry-run rollout keeps the action flow in shadow evaluation mode',
  );
  ok(
    shadow.wouldRequireReview,
    'Finance action release: action flow surfaces named-review requirements even before hard enforcement',
  );
  ok(
    shadow.wouldRequireToken,
    'Finance action release: higher-risk action flow surfaces token requirements for future hardening',
  );

  console.log(`\nRelease kernel finance-action-release tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel finance-action-release tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
