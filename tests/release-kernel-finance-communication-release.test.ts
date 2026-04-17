import { strict as assert } from 'node:assert';
import {
  buildFinanceCommunicationReleaseMaterial,
  buildFinanceCommunicationReleaseObservation,
  createFinanceCommunicationReleaseCandidateFromReport,
} from '../src/release-kernel/finance-communication-release.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';
import { createFinanceCommunicationReleasePolicy } from '../src/release-kernel/release-policy.js';
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
    runId: 'api-finance-communication-release',
    decision: 'pass',
    certificate: { certificateId: 'cert_finance_comm' },
    evidenceChain: { terminalHash: 'comm_chain_terminal', intact: true },
    liveProof: {
      mode: 'live_runtime',
      consistent: true,
    },
    filingReadiness: {
      status: 'internal_report_ready',
      blockingGaps: 0,
    },
    dossier: {
      reviewerSummary: [
        {
          category: 'policy',
          status: 'pass',
          detail: 'No blocking policy findings.',
        },
        {
          category: 'attestation',
          status: 'signed',
          detail: 'Attestation material present for the run.',
        },
      ],
    },
    audit: {
      chainIntact: true,
    },
    ...overrides,
  } as any;
}

async function main(): Promise<void> {
  const report = makeFinanceReport();
  const candidate = createFinanceCommunicationReleaseCandidateFromReport(report);

  ok(
    candidate !== null,
    'Finance communication release: reviewer summary sections produce a communication candidate',
  );
  equal(
    candidate?.channelId,
    'internal-review-mailbox',
    'Finance communication release: canonical review mailbox channel is stable',
  );

  const material = buildFinanceCommunicationReleaseMaterial(candidate!);
  equal(
    material.target.id,
    'finance.reporting.review.mailbox',
    'Finance communication release: target is the internal review mailbox boundary',
  );
  ok(
    material.hashBundle.outputHash.startsWith('sha256:'),
    'Finance communication release: output hash is canonicalized',
  );

  const observation = buildFinanceCommunicationReleaseObservation(material, report);
  ok(
    observation.policyRulesSatisfied,
    'Finance communication release: intact audit and reviewer summary satisfy the communication bridge checks',
  );

  const engine = createReleaseDecisionEngine({
    policies: [createFinanceCommunicationReleasePolicy()],
  });
  const shadowEvaluator = createShadowModeReleaseEvaluator({ engine });
  const shadow = shadowEvaluator.evaluate(
    {
      id: 'finance-communication-shadow',
      createdAt: '2026-04-17T22:40:00.000Z',
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
    'accepted',
    'Finance communication release: deterministic success yields an accepted communication decision under the shared kernel',
  );
  equal(
    shadow.policyRolloutMode,
    'dry-run',
    'Finance communication release: communication launches under explicit dry-run rollout control',
  );
  equal(
    shadow.policyEvaluationMode,
    'shadow',
    'Finance communication release: dry-run rollout keeps the communication flow in shadow evaluation mode',
  );
  ok(
    !shadow.wouldBlockIfEnforced,
    'Finance communication release: accepted communication candidates would not block if this flow later hardens',
  );
  ok(
    shadow.wouldRequireToken,
    'Finance communication release: communication flow still surfaces that operational release would require a token when enforced',
  );

  console.log(`\nRelease kernel finance-communication-release tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel finance-communication-release tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
