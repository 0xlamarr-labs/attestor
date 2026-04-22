import assert from 'node:assert/strict';
import {
  CRYPTO_PROOF_SCENARIO_IDS,
  getProofScenario,
  runCryptoProofScenario,
  runCryptoProofScenarios,
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

function testX402AdmitScenarioRunsThroughCryptoAdmission(): void {
  const run = runCryptoProofScenario('crypto-x402-payment-admit');
  const registryScenario = getProofScenario('crypto-x402-payment-admit');

  equal(run.version, 'attestor.proof-surface.crypto-run.v1', 'Crypto proof: run version is stable');
  equal(run.scenarioId, registryScenario.id, 'Crypto proof: x402 run binds back to registry scenario');
  equal(run.packFamily, 'crypto', 'Crypto proof: pack family remains crypto');
  equal(run.expectedDecision, 'admit', 'Crypto proof: x402 scenario expects admit');
  equal(run.decision, 'admit', 'Crypto proof: x402 scenario admits');
  equal(run.failClosed, false, 'Crypto proof: admitted x402 scenario does not fail closed');
  equal(run.preflight.adapterKind, 'x402-payment', 'Crypto proof: x402 preflight uses x402 adapter');
  equal(run.preflight.outcome, 'allow', 'Crypto proof: x402 preflight allows');
  equal(run.preflight.signalStatus, 'pass', 'Crypto proof: x402 signal passes');
  ok(run.preflight.observationCount > 15, 'Crypto proof: x402 preflight exposes a full check set');
  deepEqual(run.preflight.failedObservationCodes, [], 'Crypto proof: x402 preflight has no failed observations');
  ok(run.preflight.digest.startsWith('sha256:'), 'Crypto proof: x402 preflight digest is canonical');
  equal(run.simulation.outcome, 'allow-preview', 'Crypto proof: x402 simulation allows preview');
  equal(run.simulation.readiness.adapterPreflight, 'ready', 'Crypto proof: x402 adapter preflight is ready');
  deepEqual(run.simulation.requiredPreflightSources, ['x402-payment'], 'Crypto proof: x402 simulation requires x402 payment evidence');
  deepEqual(run.simulation.requiredNextArtifacts, [], 'Crypto proof: x402 simulation has no next artifacts');
  equal(run.admission.outcome, 'admit', 'Crypto proof: x402 admission admits');
  equal(run.admission.surface, 'agent-payment-http', 'Crypto proof: x402 admission uses agent payment HTTP surface');
  ok(
    run.admission.requiredHandoffArtifacts.includes('PAYMENT-SIGNATURE'),
    'Crypto proof: x402 admission requires the signed payment payload',
  );
  deepEqual(
    run.admission.transportHeaders,
    ['PAYMENT-REQUIRED', 'PAYMENT-SIGNATURE', 'PAYMENT-RESPONSE'],
    'Crypto proof: x402 admission exposes transport headers',
  );
  equal(run.admissionReceipt.classification, 'admitted', 'Crypto proof: x402 receipt is admitted');
  equal(run.admissionReceipt.verificationStatus, 'valid', 'Crypto proof: x402 receipt verifies');
  ok(run.admissionReceipt.receiptDigest.startsWith('sha256:'), 'Crypto proof: x402 receipt has digest');
  ok(run.reason.includes('admitted'), 'Crypto proof: x402 reason names admitted plan');
  ok(
    run.proofMaterials.some((material) => material.kind === 'crypto-admission-plan'),
    'Crypto proof: x402 exposes admission plan proof material',
  );
}

function testDelegatedEoaScenarioFailsClosed(): void {
  const run = runCryptoProofScenario('crypto-delegated-eoa-block');
  const registryScenario = getProofScenario('crypto-delegated-eoa-block');

  equal(run.scenarioId, registryScenario.id, 'Crypto block proof: run binds back to registry scenario');
  equal(run.expectedDecision, 'block', 'Crypto block proof: delegated EOA scenario expects block');
  equal(run.decision, 'block', 'Crypto block proof: delegated EOA scenario blocks');
  equal(run.failClosed, true, 'Crypto block proof: delegated EOA scenario fails closed');
  equal(run.preflight.adapterKind, 'eip-7702-delegation', 'Crypto block proof: preflight uses EIP-7702 adapter');
  equal(run.preflight.outcome, 'block', 'Crypto block proof: invalid delegated EOA preflight blocks');
  equal(run.preflight.signalStatus, 'fail', 'Crypto block proof: delegated EOA signal fails');
  ok(
    run.preflight.failedObservationCodes.includes('eip7702-authorization-signature-invalid'),
    'Crypto block proof: invalid authorization tuple is surfaced',
  );
  equal(run.simulation.outcome, 'deny-preview', 'Crypto block proof: simulation denies preview');
  equal(run.simulation.readiness.adapterPreflight, 'blocked', 'Crypto block proof: adapter preflight is blocked');
  deepEqual(
    run.simulation.requiredPreflightSources,
    ['eip-7702-authorization'],
    'Crypto block proof: simulation requires EIP-7702 authorization evidence',
  );
  ok(
    run.simulation.reasonCodes.includes('eip7702-delegation-adapter-block'),
    'Crypto block proof: simulation reason includes adapter block',
  );
  equal(run.admission.outcome, 'deny', 'Crypto block proof: admission denies');
  equal(run.admission.surface, 'delegated-eoa-runtime', 'Crypto block proof: admission uses delegated EOA runtime');
  ok(
    run.admission.blockedReasons.includes('eip7702-delegation-adapter-block'),
    'Crypto block proof: admission carries the blocked adapter reason',
  );
  ok(
    run.admission.blockedReasons.includes('execution-admission-denied'),
    'Crypto block proof: admission has terminal deny reason',
  );
  equal(run.admissionReceipt.classification, 'blocked', 'Crypto block proof: receipt is blocked');
  equal(run.admissionReceipt.verificationStatus, 'valid', 'Crypto block proof: blocked receipt verifies');
  ok(run.reason.includes('denied'), 'Crypto block proof: reason names denied admission plan');
  ok(
    run.proofMaterials.some((material) => material.kind === 'crypto-admission-receipt'),
    'Crypto block proof: delegated EOA exposes receipt proof material',
  );
}

function testBatchRunnerCoversFrozenCryptoIds(): void {
  const runs = runCryptoProofScenarios();

  equal(runs.length, CRYPTO_PROOF_SCENARIO_IDS.length, 'Crypto proof: batch runner covers all crypto proof ids');
  equal(runs[0]?.scenarioId, 'crypto-x402-payment-admit', 'Crypto proof: x402 run stays first');
  equal(runs[1]?.scenarioId, 'crypto-delegated-eoa-block', 'Crypto proof: delegated EOA run stays second');
  ok(
    runs.every((run) => run.proposedConsequence.riskClass === 'R3' || run.proposedConsequence.riskClass === 'R4'),
    'Crypto proof: crypto scenarios stay on high-consequence boundaries',
  );
  ok(
    runs.every((run) => run.admissionReceipt.verificationStatus === 'valid'),
    'Crypto proof: all crypto runs issue verifiable admission receipts',
  );
  ok(
    runs.every((run) => run.proofMaterials.length > 0),
    'Crypto proof: all crypto runs expose proof materials',
  );
}

testX402AdmitScenarioRunsThroughCryptoAdmission();
testDelegatedEoaScenarioFailsClosed();
testBatchRunnerCoversFrozenCryptoIds();

console.log(`Proof surface crypto scenario tests: ${passed} passed, 0 failed`);
