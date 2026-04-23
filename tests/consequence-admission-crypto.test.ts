import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  type CryptoExecutionAdmissionPlan,
} from '../src/crypto-execution-admission/index.js';
import {
  createCryptoExecutionPlanAdmissionRequest,
  createCryptoExecutionPlanAdmissionResponse,
  cryptoExecutionPlanAdmissionDescriptor,
  type ConsequenceAdmissionCheck,
  type ConsequenceAdmissionResponse,
} from '../src/consequence-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import type { CryptoExecutionAdapterKind } from '../src/crypto-authorization-core/types.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function check(
  response: ConsequenceAdmissionResponse,
  kind: ConsequenceAdmissionCheck['kind'],
): ConsequenceAdmissionCheck {
  const match = response.checks.find((entry) => entry.kind === kind);
  assert.ok(match, `Expected ${kind} check to exist`);
  return match;
}

function observation(
  source: CryptoSimulationPreflightSource,
  status: CryptoSimulationObservation['status'],
): CryptoSimulationObservation {
  return {
    check: 'adapter-preflight-readiness',
    source,
    status,
    severity: status === 'fail' ? 'critical' : status === 'pass' ? 'info' : 'warning',
    code: status === 'pass' ? `${source}-ready` : `${source}-missing`,
    message: status === 'pass'
      ? `${source} preflight passed.`
      : `${source} preflight is required.`,
    required: true,
    evidence: {
      source,
      status,
    },
  };
}

function simulationFixture(input: {
  adapterKind: CryptoExecutionAdapterKind | null;
  outcome: CryptoAuthorizationSimulationResult['outcome'];
  requiredPreflightSources?: readonly CryptoSimulationPreflightSource[];
  preflightStatus?: CryptoSimulationObservation['status'];
  releaseReady?: boolean;
  policyReady?: boolean;
  enforcementReady?: boolean;
  adapterReady?: boolean;
}): CryptoAuthorizationSimulationResult {
  const requiredPreflightSources = input.requiredPreflightSources ?? [];
  const preflightStatus = input.preflightStatus ?? 'pass';
  const releaseBinding = input.releaseReady ?? true;
  const policyBinding = input.policyReady ?? true;
  const enforcementBinding = input.enforcementReady ?? true;
  const adapterPreflight = input.adapterReady ?? true;
  const observations = requiredPreflightSources.map((source) =>
    observation(source, preflightStatus),
  );
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: `simulation-${input.adapterKind ?? 'neutral'}`,
    simulatedAt: '2026-04-23T13:00:00.000Z',
    intentId: `intent-${input.adapterKind ?? 'neutral'}`,
    consequenceKind: input.adapterKind === 'x402-payment'
      ? 'agent-payment'
      : input.adapterKind === 'erc-4337-user-operation'
        ? 'user-operation'
        : input.adapterKind === 'eip-7702-delegation'
          ? 'account-delegation'
          : 'transfer',
    adapterKind: input.adapterKind,
    chainId: 'eip155:8453',
    accountAddress: '0x1111111111111111111111111111111111111111',
    riskClass: 'R3',
    reviewAuthorityMode: 'dual-approval',
    outcome: input.outcome,
    confidence: input.outcome === 'deny-preview' ? 'high' : 'medium',
    reasonCodes: input.outcome === 'deny-preview' ? ['blocked-by-simulation'] : [],
    readiness: {
      releaseBinding: releaseBinding ? 'ready' : 'missing',
      policyBinding: policyBinding ? 'ready' : 'missing',
      enforcementBinding: enforcementBinding ? 'ready' : 'missing',
      adapterPreflight: adapterPreflight
        ? 'ready'
        : preflightStatus === 'fail'
          ? 'blocked'
          : 'missing',
    },
    requiredPreflightSources,
    recommendedPreflightSources: [],
    observations,
    requiredNextArtifacts: adapterPreflight ? [] : ['missing-adapter-evidence'],
    releaseBindingDigest: releaseBinding ? 'sha256:release' : null,
    policyScopeDigest: policyBinding ? 'sha256:policy' : null,
    enforcementBindingDigest: enforcementBinding ? 'sha256:enforcement' : null,
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:${input.adapterKind ?? 'neutral'}-${input.outcome}`,
  };
}

function planFixture(input: {
  adapterKind: CryptoExecutionAdapterKind | null;
  outcome: CryptoAuthorizationSimulationResult['outcome'];
  requiredPreflightSources?: readonly CryptoSimulationPreflightSource[];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
}): CryptoExecutionAdmissionPlan {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture(input),
    createdAt: '2026-04-23T13:01:00.000Z',
    integrationRef: input.adapterKind
      ? `integration:${input.adapterKind}`
      : 'integration:adapter-neutral',
  });
}

function testDescriptorAndRequestStayOnThePackageBoundary(): void {
  const plan = planFixture({
    adapterKind: 'wallet-call-api',
    outcome: 'allow-preview',
    requiredPreflightSources: ['wallet-capabilities', 'wallet-call-preparation'],
  });
  const descriptor = cryptoExecutionPlanAdmissionDescriptor();
  const request = createCryptoExecutionPlanAdmissionRequest({
    requestedAt: '2026-04-23T13:02:00.000Z',
    plan,
    tenantId: 'tenant_demo',
  });

  equal(descriptor.packFamily, 'crypto', 'Crypto admission: descriptor stays in the crypto pack');
  equal(descriptor.packageSubpath, 'attestor/crypto-execution-admission', 'Crypto admission: descriptor uses package subpath');
  equal(descriptor.hostedRouteClaimed, false, 'Crypto admission: descriptor does not claim hosted route');
  equal(request.packFamily, 'crypto', 'Crypto admission: request uses crypto pack family');
  equal(request.entryPoint.kind, 'package-boundary', 'Crypto admission: entry point is a package boundary');
  equal(request.entryPoint.route, null, 'Crypto admission: no hosted route is claimed');
  equal(request.entryPoint.packageSubpath, 'attestor/crypto-execution-admission', 'Crypto admission: package subpath is explicit');
  equal(request.proposedConsequence.consequenceKind, 'transfer', 'Crypto admission: native crypto consequence kind is preserved');
  ok(request.nativeInputRefs.includes('CryptoExecutionAdmissionPlan.outcome'), 'Crypto admission: native outcome ref is preserved');
}

function testX402AdmitMapsToCanonicalAdmit(): void {
  const plan = planFixture({
    adapterKind: 'x402-payment',
    outcome: 'allow-preview',
    requiredPreflightSources: ['x402-payment'],
  });
  const response = createCryptoExecutionPlanAdmissionResponse({
    plan,
    decidedAt: '2026-04-23T13:02:00.000Z',
  });

  equal(response.decision, 'admit', 'Crypto admission: package admit maps to canonical admit');
  equal(response.allowed, true, 'Crypto admission: admitted response is allowed');
  equal(response.failClosed, false, 'Crypto admission: admitted response is not fail closed');
  equal(response.nativeDecision?.value, 'admit', 'Crypto admission: native outcome is preserved');
  equal(check(response, 'policy').outcome, 'pass', 'Crypto admission: policy check passes on admit');
  equal(check(response, 'enforcement').outcome, 'pass', 'Crypto admission: enforcement passes on admit');
  equal(check(response, 'adapter-readiness').outcome, 'pass', 'Crypto admission: adapter readiness passes on x402 admit');
  ok(response.proof.some((entry) => entry.kind === 'admission-plan'), 'Crypto admission: admission plan proof is exposed');
  ok(response.proof.some((entry) => entry.id === plan.simulationId), 'Crypto admission: simulation proof is exposed');
  equal(response.operationalContext.surface, 'agent-payment-http', 'Crypto admission: x402 surface is preserved');
}

function testUserOperationNeedsEvidenceMapsToReview(): void {
  const plan = planFixture({
    adapterKind: 'erc-4337-user-operation',
    outcome: 'review-required',
    requiredPreflightSources: ['erc-4337-validation', 'erc-7562-validation-scope'],
    preflightStatus: 'not-run',
    adapterReady: false,
  });
  const response = createCryptoExecutionPlanAdmissionResponse({
    plan,
    decidedAt: '2026-04-23T13:02:00.000Z',
  });

  equal(response.decision, 'review', 'Crypto admission: needs-evidence maps to canonical review');
  equal(response.allowed, false, 'Crypto admission: review does not allow automatic execution');
  equal(response.failClosed, true, 'Crypto admission: review is fail closed');
  equal(response.nativeDecision?.value, 'needs-evidence', 'Crypto admission: native needs-evidence is preserved');
  equal(check(response, 'policy').outcome, 'warn', 'Crypto admission: needs-evidence warns policy');
  equal(check(response, 'adapter-readiness').outcome, 'warn', 'Crypto admission: missing ERC-4337 preflight warns adapter readiness');
  equal(response.operationalContext.requiredStepCount, 2, 'Crypto admission: required step count is preserved');
  equal(response.operationalContext.nextActionCount, 2, 'Crypto admission: next action count is preserved');
}

function testDelegatedEoaDenyMapsToBlock(): void {
  const plan = planFixture({
    adapterKind: 'eip-7702-delegation',
    outcome: 'deny-preview',
    requiredPreflightSources: ['eip-7702-authorization'],
    preflightStatus: 'fail',
    adapterReady: false,
  });
  const response = createCryptoExecutionPlanAdmissionResponse({
    plan,
    decidedAt: '2026-04-23T13:02:00.000Z',
  });

  equal(response.decision, 'block', 'Crypto admission: deny maps to canonical block');
  equal(response.allowed, false, 'Crypto admission: block is not allowed');
  equal(response.failClosed, true, 'Crypto admission: block is fail closed');
  equal(check(response, 'policy').outcome, 'fail', 'Crypto admission: deny fails policy');
  equal(check(response, 'enforcement').outcome, 'fail', 'Crypto admission: denied plan fails enforcement');
  equal(check(response, 'adapter-readiness').outcome, 'fail', 'Crypto admission: failed EIP-7702 preflight fails adapter readiness');
  equal(response.operationalContext.blockedReasonCount, 2, 'Crypto admission: blocked reason count is preserved');
}

testDescriptorAndRequestStayOnThePackageBoundary();
testX402AdmitMapsToCanonicalAdmit();
testUserOperationNeedsEvidenceMapsToReview();
testDelegatedEoaDenyMapsToBlock();

console.log(`Consequence admission crypto tests: ${passed} passed, 0 failed`);
