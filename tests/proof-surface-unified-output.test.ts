import assert from 'node:assert/strict';
import {
  PROOF_SURFACE_OUTPUT_SPEC_VERSION,
  RUNNABLE_PROOF_SCENARIO_IDS,
  runProofSurfaceScenario,
  runProofSurfaceScenarios,
} from '../src/proof-surface/index.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  passed += 1;
}

function testFinanceAdmitUsesUnifiedShape(): void {
  const output = runProofSurfaceScenario('finance-filing-admit');

  equal(output.version, PROOF_SURFACE_OUTPUT_SPEC_VERSION, 'Unified proof: version is stable');
  equal(output.source.scenarioId, 'finance-filing-admit', 'Unified proof: finance scenario id is preserved');
  equal(output.source.packFamily, 'finance', 'Unified proof: finance pack family is preserved');
  equal(output.decision.actual, 'admit', 'Unified proof: finance admit keeps decision');
  equal(output.decision.expected, 'admit', 'Unified proof: finance admit keeps expected decision');
  equal(output.decision.failClosed, false, 'Unified proof: finance admit does not fail closed');
  equal(output.checks.policy.outcome, 'pass', 'Unified proof: finance policy passes');
  equal(output.checks.authority.outcome, 'pass', 'Unified proof: finance authority passes');
  equal(output.checks.evidence.outcome, 'pass', 'Unified proof: finance evidence passes');
  ok(output.checks.evidence.evidenceRefs.some((ref) => ref.startsWith('sha256:')), 'Unified proof: finance evidence refs include hashes');
  ok(
    output.evidenceAnchors.some((anchor) => anchor.kind === 'release-decision'),
    'Unified proof: finance output includes release decision anchor',
  );
  ok(output.digest.startsWith('sha256:'), 'Unified proof: finance output has digest');
  equal(JSON.parse(output.canonical).version, output.version, 'Unified proof: canonical JSON is parseable');
}

function testFinanceReviewKeepsAuthorityWarning(): void {
  const output = runProofSurfaceScenario('finance-filing-review');

  equal(output.decision.actual, 'review', 'Unified proof: finance review keeps review decision');
  equal(output.decision.failClosed, true, 'Unified proof: finance review fails closed downstream');
  equal(output.checks.policy.outcome, 'pass', 'Unified proof: finance review policy passes');
  equal(output.checks.authority.outcome, 'warn', 'Unified proof: finance review authority warns');
  equal(output.checks.evidence.outcome, 'pass', 'Unified proof: finance review evidence passes');
  ok(
    output.checks.authority.summary.includes('pending'),
    'Unified proof: finance review authority summary explains pending posture',
  );
}

function testCryptoX402UsesSameUnifiedShape(): void {
  const output = runProofSurfaceScenario('crypto-x402-payment-admit');

  equal(output.source.scenarioId, 'crypto-x402-payment-admit', 'Unified proof: x402 scenario id is preserved');
  equal(output.source.packFamily, 'crypto', 'Unified proof: x402 pack family is preserved');
  equal(output.decision.actual, 'admit', 'Unified proof: x402 keeps admit decision');
  equal(output.decision.failClosed, false, 'Unified proof: x402 does not fail closed');
  equal(output.checks.policy.outcome, 'pass', 'Unified proof: x402 policy passes');
  equal(output.checks.authority.outcome, 'pass', 'Unified proof: x402 authority passes');
  equal(output.checks.evidence.outcome, 'pass', 'Unified proof: x402 evidence passes');
  ok(
    output.evidenceAnchors.some((anchor) => anchor.kind === 'admission-plan'),
    'Unified proof: x402 includes admission plan anchor',
  );
  ok(
    output.evidenceAnchors.some((anchor) => anchor.kind === 'admission-receipt'),
    'Unified proof: x402 includes signed admission receipt anchor',
  );
  ok(
    output.proofMaterials.some((material) => material.kind === 'crypto-admission-plan'),
    'Unified proof: x402 keeps proof material',
  );
}

function testCryptoDelegatedEoaFailsClosedInUnifiedShape(): void {
  const output = runProofSurfaceScenario('crypto-delegated-eoa-block');

  equal(output.decision.actual, 'block', 'Unified proof: delegated EOA keeps block decision');
  equal(output.decision.failClosed, true, 'Unified proof: delegated EOA fails closed');
  equal(output.checks.policy.outcome, 'pass', 'Unified proof: delegated EOA policy passes');
  equal(output.checks.authority.outcome, 'fail', 'Unified proof: delegated EOA authority fails');
  equal(output.checks.evidence.outcome, 'fail', 'Unified proof: delegated EOA evidence fails');
  ok(
    output.checks.authority.evidenceRefs.includes('eip7702-authorization-signature-invalid'),
    'Unified proof: delegated EOA preserves invalid tuple evidence',
  );
  ok(
    output.evidenceAnchors.every((anchor) => anchor.digest === null || anchor.digest.startsWith('sha256:')),
    'Unified proof: delegated EOA anchors are digest-shaped',
  );
}

function testUnifiedOutputIsCompactAndDeterministic(): void {
  const first = runProofSurfaceScenario('crypto-x402-payment-admit');
  const second = runProofSurfaceScenario('crypto-x402-payment-admit');
  const regenerated = runProofSurfaceScenario('crypto-x402-payment-admit', {
    generatedAt: '2026-04-22T12:07:00.000Z',
  });

  deepEqual(
    Object.keys(first).sort(),
    [
      'canonical',
      'checks',
      'decision',
      'digest',
      'evidenceAnchors',
      'generatedAt',
      'outputId',
      'proofMaterials',
      'proposedConsequence',
      'source',
      'version',
    ],
    'Unified proof: top-level shape stays compact',
  );
  equal(first.digest, second.digest, 'Unified proof: default output is deterministic');
  equal(first.outputId, second.outputId, 'Unified proof: default output id is deterministic');
  ok(first.digest !== regenerated.digest, 'Unified proof: generatedAt participates in digest');
  ok(!('admission' in first), 'Unified proof: crypto internals are not top-level output fields');
  ok(!('material' in first), 'Unified proof: finance internals are not top-level output fields');
}

function testBatchRunnerCoversRunnableFinanceAndCryptoScenarios(): void {
  const outputs = runProofSurfaceScenarios();

  equal(outputs.length, RUNNABLE_PROOF_SCENARIO_IDS.length, 'Unified proof: batch runner covers runnable ids');
  deepEqual(
    outputs.map((output) => output.source.scenarioId),
    [...RUNNABLE_PROOF_SCENARIO_IDS],
    'Unified proof: batch order follows runnable id list',
  );
  ok(
    outputs.every((output) => output.proofMaterials.length > 0),
    'Unified proof: every output has proof materials',
  );
  ok(
    outputs.every((output) => Object.keys(output.checks).join(',') === 'policy,authority,evidence'),
    'Unified proof: every output has the three shared checks',
  );
  ok(
    outputs.some((output) => output.decision.actual === 'review') &&
      outputs.some((output) => output.decision.actual === 'block') &&
      outputs.some((output) => output.decision.actual === 'admit'),
    'Unified proof: admit, review, and block remain represented',
  );
}

testFinanceAdmitUsesUnifiedShape();
testFinanceReviewKeepsAuthorityWarning();
testCryptoX402UsesSameUnifiedShape();
testCryptoDelegatedEoaFailsClosedInUnifiedShape();
testUnifiedOutputIsCompactAndDeterministic();
testBatchRunnerCoversRunnableFinanceAndCryptoScenarios();

console.log(`Proof surface unified output tests: ${passed} passed, 0 failed`);
