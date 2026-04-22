import assert from 'node:assert/strict';
import {
  FINANCE_PROOF_SCENARIO_IDS,
  getProofScenario,
  runFinanceProofScenario,
  runFinanceProofScenarios,
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

function testFinanceAdmitScenarioRunsThroughReleaseKernel(): void {
  const run = runFinanceProofScenario('finance-filing-admit');
  const registryScenario = getProofScenario('finance-filing-admit');

  equal(run.version, 'attestor.proof-surface.finance-run.v1', 'Finance proof: run version is stable');
  equal(run.scenarioId, registryScenario.id, 'Finance proof: run binds back to registry scenario');
  equal(run.packFamily, 'finance', 'Finance proof: pack family remains finance');
  equal(run.expectedDecision, 'admit', 'Finance proof: admit scenario expects admit');
  equal(run.decision, 'admit', 'Finance proof: finance admit scenario admits');
  equal(run.rawReleaseStatus, 'review-required', 'Finance proof: raw R4 release still requires review before domain bridge');
  equal(run.finalReleaseStatus, 'accepted', 'Finance proof: domain receipt and escrow finalize accepted release');
  equal(run.failClosed, false, 'Finance proof: admitted finance scenario does not fail closed');
  equal(run.policyMatched, true, 'Finance proof: release policy is matched');
  equal(run.matchedPolicyId, 'finance.structured-record-release.v1', 'Finance proof: first hard-gateway policy is used');
  equal(run.deterministicChecksCompleted, true, 'Finance proof: deterministic checks run');
  equal(run.checkResult.policySatisfied, true, 'Finance proof: policy check passes');
  equal(run.checkResult.evidenceSatisfied, true, 'Finance proof: evidence check passes');
  equal(run.checkResult.authoritySatisfied, true, 'Finance proof: authority check passes');
  ok(run.material.outputHash.startsWith('sha256:'), 'Finance proof: output hash is canonical');
  ok(run.material.consequenceHash.startsWith('sha256:'), 'Finance proof: consequence hash is canonical');
  equal(run.material.adapterId, 'xbrl-us-gaap-2024', 'Finance proof: filing adapter is grounded');
  equal(run.material.targetId, 'sec.edgar.filing.prepare', 'Finance proof: target is the filing-preparation boundary');
  equal(run.material.rowCount, 1, 'Finance proof: scenario carries deterministic row evidence');
  equal(run.material.proofMode, 'live_runtime', 'Finance proof: proof mode is surfaced');
  ok(run.material.certificateId !== null, 'Finance proof: certificate id is exposed');
  ok(run.material.evidenceChainTerminal.length > 10, 'Finance proof: terminal evidence-chain hash is exposed');
  ok(run.reason.includes('accepted'), 'Finance proof: reason includes final accepted status');
  ok(
    run.proofMaterials.some((material) => material.kind === 'release-material'),
    'Finance proof: release material is exposed',
  );
}

function testFinanceReviewScenarioPausesConsequence(): void {
  const run = runFinanceProofScenario('finance-filing-review');
  const registryScenario = getProofScenario('finance-filing-review');

  equal(run.scenarioId, registryScenario.id, 'Finance review proof: run binds back to registry scenario');
  equal(run.expectedDecision, 'review', 'Finance review proof: review scenario expects review');
  equal(run.decision, 'review', 'Finance review proof: finance review scenario pauses consequence');
  equal(run.rawReleaseStatus, 'review-required', 'Finance review proof: raw release requires review');
  equal(run.finalReleaseStatus, 'review-required', 'Finance review proof: final release remains review-required');
  equal(run.failClosed, true, 'Finance review proof: review scenario fails closed for downstream action');
  equal(run.checkResult.policySatisfied, true, 'Finance review proof: policy check is satisfied');
  equal(run.checkResult.evidenceSatisfied, true, 'Finance review proof: evidence can be sufficient while authority is pending');
  equal(run.checkResult.authoritySatisfied, false, 'Finance review proof: authority is pending');
  ok(run.reason.includes('paused'), 'Finance review proof: reason says consequence remains paused');
  ok(
    run.proofMaterials.some((material) => material.kind === 'source-module'),
    'Finance review proof: source-module proof material is exposed',
  );
}

function testBatchRunnerCoversFrozenFinanceIds(): void {
  const runs = runFinanceProofScenarios();

  equal(runs.length, FINANCE_PROOF_SCENARIO_IDS.length, 'Finance proof: batch runner covers all finance proof ids');
  equal(runs[0]?.scenarioId, 'finance-filing-admit', 'Finance proof: admit run stays first');
  equal(runs[1]?.scenarioId, 'finance-filing-review', 'Finance proof: review run stays second');
  ok(
    runs.every((run) => run.proposedConsequence.consequenceType === 'record'),
    'Finance proof: finance scenarios stay on record consequence boundary',
  );
  ok(
    runs.every((run) => run.proofMaterials.length > 0),
    'Finance proof: all finance runs expose proof materials',
  );
}

testFinanceAdmitScenarioRunsThroughReleaseKernel();
testFinanceReviewScenarioPausesConsequence();
testBatchRunnerCoversFrozenFinanceIds();

console.log(`Proof surface finance scenario tests: ${passed} passed, 0 failed`);
