import assert from 'node:assert/strict';
import {
  CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION,
  createCryptoExecutionAdmissionPlan,
  cryptoExecutionAdmissionAdapterProfile,
  cryptoExecutionAdmissionDescriptor,
  cryptoExecutionAdmissionLabel,
} from '../src/crypto-execution-admission/index.js';
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

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  passed += 1;
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
    simulatedAt: '2026-04-22T10:00:00.000Z',
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

function testX402AdmitPlanCarriesHttpPaymentHandoff(): void {
  const plan = createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'x402-payment',
      outcome: 'allow-preview',
      requiredPreflightSources: ['x402-payment'],
    }),
    createdAt: '2026-04-22T10:01:00.000Z',
    integrationRef: 'integration:x402:premium-api',
  });

  equal(plan.version, CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION, 'admission: version is exposed');
  equal(plan.outcome, 'admit', 'admission: ready x402 simulation is admitted');
  equal(plan.surface, 'agent-payment-http', 'admission: x402 uses HTTP payment surface');
  deepEqual(
    plan.transportHeaders,
    ['PAYMENT-REQUIRED', 'PAYMENT-SIGNATURE', 'PAYMENT-RESPONSE'],
    'admission: x402 handoff exposes required transport headers',
  );
  ok(
    plan.requiredHandoffArtifacts.includes('PAYMENT-SIGNATURE'),
    'admission: x402 plan requires signed payment payload',
  );
  ok(
    plan.steps.some((step) => step.kind === 'verify-http-payment' && step.status === 'required'),
    'admission: x402 plan includes payment verification handoff',
  );
  ok(
    plan.digest.startsWith('sha256:'),
    'admission: plan digest is canonicalized',
  );
}

function testUserOperationMissingPreflightNeedsEvidence(): void {
  const plan = createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'erc-4337-user-operation',
      outcome: 'review-required',
      requiredPreflightSources: ['erc-4337-validation', 'erc-7562-validation-scope'],
      preflightStatus: 'not-run',
      adapterReady: false,
    }),
    createdAt: '2026-04-22T10:02:00.000Z',
  });

  equal(plan.outcome, 'needs-evidence', 'admission: missing bundler evidence requires evidence');
  equal(plan.surface, 'account-abstraction-bundler', 'admission: ERC-4337 maps to bundler surface');
  ok(
    plan.steps.some(
      (step) =>
        step.source === 'erc-4337-validation' &&
        step.kind === 'simulate-user-operation' &&
        step.status === 'required',
    ),
    'admission: ERC-4337 validation must be collected',
  );
  ok(
    plan.nextActions.includes('erc-4337-validation-missing'),
    'admission: missing UserOperation preflight becomes a next action',
  );
}

function testDeniedDelegationFailsClosed(): void {
  const plan = createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'eip-7702-delegation',
      outcome: 'deny-preview',
      requiredPreflightSources: ['eip-7702-authorization'],
      preflightStatus: 'fail',
      adapterReady: false,
    }),
    createdAt: '2026-04-22T10:03:00.000Z',
  });

  equal(plan.outcome, 'deny', 'admission: denied EIP-7702 simulation fails closed');
  equal(plan.surface, 'delegated-eoa-runtime', 'admission: EIP-7702 maps to delegated EOA surface');
  ok(
    plan.blockedReasons.includes('eip-7702-authorization-missing'),
    'admission: failed EIP-7702 evidence is a blocked reason',
  );
  ok(
    plan.steps.some((step) => step.kind === 'block-execution' && step.status === 'blocked'),
    'admission: denied plan has explicit block step',
  );
}

function testDescriptorAndProfiles(): void {
  const descriptor = cryptoExecutionAdmissionDescriptor();
  const profile = cryptoExecutionAdmissionAdapterProfile('wallet-call-api');
  const plan = createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'wallet-call-api',
      outcome: 'allow-preview',
      requiredPreflightSources: ['wallet-capabilities', 'wallet-call-preparation'],
    }),
    createdAt: '2026-04-22T10:04:00.000Z',
  });

  equal(
    descriptor.subpath,
    'attestor/crypto-execution-admission',
    'admission: descriptor exposes public subpath',
  );
  ok(
    descriptor.standards.includes('EIP-5792'),
    'admission: descriptor carries wallet-call standard anchor',
  );
  equal(profile.surface, 'wallet-rpc', 'admission: wallet-call profile maps to wallet RPC');
  ok(
    cryptoExecutionAdmissionLabel(plan).includes('surface:wallet-rpc'),
    'admission: label includes selected surface',
  );
}

testX402AdmitPlanCarriesHttpPaymentHandoff();
testUserOperationMissingPreflightNeedsEvidence();
testDeniedDelegationFailsClosed();
testDescriptorAndProfiles();

console.log(`Crypto execution admission tests: ${passed} passed, 0 failed`);
