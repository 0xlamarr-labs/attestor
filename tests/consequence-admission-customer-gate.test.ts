import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCustomerAdmissionGateExample } from '../examples/customer-admission-gate.js';
import {
  CONSEQUENCE_ADMISSION_CUSTOMER_GATE_VERSION,
  ConsequenceAdmissionGateHeldError,
  assertConsequenceAdmissionGateAllows,
  createConsequenceAdmissionFacadeResponse,
  evaluateConsequenceAdmissionGate,
  type FinancePipelineAdmissionRun,
} from '../src/consequence-admission/index.js';

let passed = 0;

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function includes(content: string, expected: string, message: string): void {
  assert.ok(
    content.includes(expected),
    `${message}\nExpected to find: ${expected}`,
  );
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function financeRunFixture(
  overrides: Partial<FinancePipelineAdmissionRun> = {},
): FinancePipelineAdmissionRun {
  return {
    runId: 'run_customer_gate_001',
    decision: 'pass',
    proofMode: 'offline_fixture',
    warrant: 'issued',
    escrow: 'released',
    receipt: 'issued',
    capsule: 'closed',
    auditChainIntact: true,
    certificate: {
      certificateId: 'cert_customer_gate_001',
      signing: {
        fingerprint: 'fingerprint_customer_gate_001',
      },
    },
    verification: {
      digest: 'sha256:customer-gate',
    },
    tenantContext: {
      tenantId: 'tenant_customer_gate',
      source: 'hosted',
      planId: 'community',
    },
    ...overrides,
  };
}

function admissionFor(run: FinancePipelineAdmissionRun) {
  return createConsequenceAdmissionFacadeResponse({
    surface: 'finance-pipeline-run',
    run,
    decidedAt: '2026-04-23T18:30:00.000Z',
  });
}

function testProceedGate(): void {
  const gate = evaluateConsequenceAdmissionGate({
    admission: admissionFor(financeRunFixture()),
    downstreamAction: 'customer_reporting_store.write',
    requireProof: true,
  });

  equal(gate.version, CONSEQUENCE_ADMISSION_CUSTOMER_GATE_VERSION, 'Customer gate: version is stable');
  equal(gate.outcome, 'proceed', 'Customer gate: admitted response proceeds');
  equal(gate.failClosed, false, 'Customer gate: proceed is not fail closed');
  equal(gate.proofSatisfied, true, 'Customer gate: proof requirement is satisfied');
  equal(gate.proofRefs.length, 2, 'Customer gate: proof refs are preserved');
  includes(gate.instruction, 'Run downstream action', 'Customer gate: instruction allows downstream action');
  ok(gate.reasonCodes.includes('customer-gate-proceed'), 'Customer gate: reason codes include proceed');
}

function testHoldGate(): void {
  const gate = evaluateConsequenceAdmissionGate({
    admission: admissionFor(financeRunFixture({
      decision: 'fail',
      certificate: null,
      verification: null,
      auditChainIntact: false,
    })),
    downstreamAction: 'customer_message_sender.send',
    requireProof: false,
  });

  equal(gate.outcome, 'hold', 'Customer gate: blocked response holds');
  equal(gate.failClosed, true, 'Customer gate: hold is fail closed');
  includes(gate.instruction, 'Do not run downstream action', 'Customer gate: instruction blocks downstream action');
  ok(gate.reasonCodes.includes('customer-gate-hold'), 'Customer gate: reason codes include hold');
}

function testRequiredProofHoldsEvenWhenNativeDecisionPassed(): void {
  const gate = evaluateConsequenceAdmissionGate({
    admission: admissionFor(financeRunFixture({
      certificate: null,
      verification: null,
    })),
    downstreamAction: 'customer_reporting_store.write',
    requireProof: true,
  });

  equal(gate.decision, 'admit', 'Customer gate: native allow still maps to admit');
  equal(gate.outcome, 'hold', 'Customer gate: missing required proof holds');
  equal(gate.proofSatisfied, false, 'Customer gate: proof requirement fails');
  ok(gate.reasonCodes.includes('customer-gate-proof-required'), 'Customer gate: reason codes include proof requirement');
}

function testAssertGateThrowsWhenHeld(): void {
  assert.throws(
    () =>
      assertConsequenceAdmissionGateAllows({
        admission: admissionFor(financeRunFixture({ decision: 'fail' })),
        downstreamAction: 'customer_message_sender.send',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConsequenceAdmissionGateHeldError);
      assert.equal(error.gateDecision.outcome, 'hold');
      return true;
    },
  );
  passed += 1;
}

function testExampleAndDocs(): void {
  const result = runCustomerAdmissionGateExample();
  const readme = readProjectFile('README.md');
  const doc = readProjectFile('docs', '01-overview', 'customer-admission-gate.md');
  const tryFirst = readProjectFile('docs', '01-overview', 'try-attestor-first.md');
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
  };

  includes(result.output, 'Customer-side Attestor admission gate', 'Customer gate example: has title');
  includes(result.output, 'Customer gate: PROCEED', 'Customer gate example: shows proceed');
  includes(result.output, 'Customer gate: HOLD', 'Customer gate example: shows hold');
  includes(result.output, 'Customer system enforces the gate', 'Customer gate example: names enforcement responsibility');

  includes(readme, 'docs/01-overview/customer-admission-gate.md', 'README: links customer gate docs');
  includes(doc, 'npm run example:customer-gate', 'Customer gate doc: includes runnable command');
  includes(doc, 'assertConsequenceAdmissionGateAllows', 'Customer gate doc: includes copy-paste helper');
  includes(doc, 'This does not add a universal hosted admission route.', 'Customer gate doc: keeps route boundary honest');
  includes(doc, 'This does not add a public hosted crypto route.', 'Customer gate doc: keeps crypto boundary honest');
  includes(doc, 'This does not auto-detect packs from payload shape.', 'Customer gate doc: rejects auto detection');
  includes(tryFirst, '[Customer admission gate](customer-admission-gate.md)', 'Try-first doc: links the next integration step');

  equal(packageJson.scripts['example:customer-gate'], 'tsx examples/customer-admission-gate.ts', 'Package: customer gate example script exists');
  equal(packageJson.scripts['test:consequence-admission-customer-gate'], 'tsx tests/consequence-admission-customer-gate.test.ts', 'Package: customer gate test script exists');
  includes(packageJson.scripts.test, 'tsx tests/consequence-admission-customer-gate.test.ts', 'Package: npm test runs customer gate test');
  includes(packageJson.scripts.verify, 'npm run test:consequence-admission-customer-gate', 'Package: verify runs customer gate test');
}

testProceedGate();
testHoldGate();
testRequiredProofHoldsEvenWhenNativeDecisionPassed();
testAssertGateThrowsWhenHeld();
testExampleAndDocs();

console.log(`Consequence admission customer gate tests: ${passed} passed, 0 failed`);
