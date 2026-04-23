import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  type CryptoExecutionAdmissionPlan,
} from '../src/crypto-execution-admission/index.js';
import {
  CONSEQUENCE_ADMISSION_FACADE_SPEC_VERSION,
  createConsequenceAdmissionFacadeResponse,
  consequenceAdmissionFacadeDescriptor,
  isConsequenceAdmissionFacadeSurface,
  type ConsequenceAdmissionResponse,
  type FinancePipelineAdmissionRun,
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

function financeRunFixture(
  overrides: Partial<FinancePipelineAdmissionRun> = {},
): FinancePipelineAdmissionRun {
  return {
    runId: 'run_facade_finance_001',
    decision: 'pass',
    proofMode: 'offline_fixture',
    warrant: 'issued',
    escrow: 'released',
    receipt: 'issued',
    capsule: 'closed',
    auditChainIntact: true,
    certificate: {
      certificateId: 'cert_facade_finance_001',
      signing: {
        fingerprint: 'fingerprint_facade_finance_001',
      },
    },
    verification: {
      digest: 'sha256:verification',
    },
    tenantContext: {
      tenantId: 'tenant_demo',
      source: 'hosted',
      planId: 'community',
    },
    ...overrides,
  };
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
  adapterReady?: boolean;
}): CryptoAuthorizationSimulationResult {
  const requiredPreflightSources = input.requiredPreflightSources ?? [];
  const preflightStatus = input.preflightStatus ?? 'pass';
  const adapterPreflight = input.adapterReady ?? true;
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: `simulation-facade-${input.adapterKind ?? 'neutral'}`,
    simulatedAt: '2026-04-23T14:00:00.000Z',
    intentId: `intent-facade-${input.adapterKind ?? 'neutral'}`,
    consequenceKind: input.adapterKind === 'x402-payment'
      ? 'agent-payment'
      : input.adapterKind === 'erc-4337-user-operation'
        ? 'user-operation'
        : 'transfer',
    adapterKind: input.adapterKind,
    chainId: 'eip155:8453',
    accountAddress: '0x2222222222222222222222222222222222222222',
    riskClass: 'R3',
    reviewAuthorityMode: 'dual-approval',
    outcome: input.outcome,
    confidence: input.outcome === 'deny-preview' ? 'high' : 'medium',
    reasonCodes: input.outcome === 'deny-preview' ? ['blocked-by-simulation'] : [],
    readiness: {
      releaseBinding: 'ready',
      policyBinding: 'ready',
      enforcementBinding: 'ready',
      adapterPreflight: adapterPreflight
        ? 'ready'
        : preflightStatus === 'fail'
          ? 'blocked'
          : 'missing',
    },
    requiredPreflightSources,
    recommendedPreflightSources: [],
    observations: requiredPreflightSources.map((source) =>
      observation(source, preflightStatus),
    ),
    requiredNextArtifacts: adapterPreflight ? [] : ['missing-adapter-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:facade-${input.adapterKind ?? 'neutral'}-${input.outcome}`,
  };
}

function cryptoPlanFixture(input: {
  adapterKind: CryptoExecutionAdapterKind | null;
  outcome: CryptoAuthorizationSimulationResult['outcome'];
  requiredPreflightSources?: readonly CryptoSimulationPreflightSource[];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
}): CryptoExecutionAdmissionPlan {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture(input),
    createdAt: '2026-04-23T14:01:00.000Z',
    integrationRef: input.adapterKind
      ? `integration:${input.adapterKind}`
      : 'integration:adapter-neutral',
  });
}

function assertCanonicalResponse(
  response: ConsequenceAdmissionResponse,
  expectedDecision: ConsequenceAdmissionResponse['decision'],
): void {
  equal(response.decision, expectedDecision, `Facade: decision is ${expectedDecision}`);
  ok(response.request.requestId.startsWith('sha256:'), 'Facade: request id is canonical');
  ok(response.admissionId.startsWith('sha256:'), 'Facade: admission id is canonical');
  ok(response.digest.startsWith('sha256:'), 'Facade: response digest is canonical');
}

function testDescriptorKeepsOneExplicitFacade(): void {
  const descriptor = consequenceAdmissionFacadeDescriptor();

  equal(descriptor.version, CONSEQUENCE_ADMISSION_FACADE_SPEC_VERSION, 'Facade: descriptor version is stable');
  equal(descriptor.publicSubpath, 'attestor/consequence-admission', 'Facade: public subpath is explicit');
  equal(descriptor.explicitSurfaceRequired, true, 'Facade: explicit surface is required');
  equal(descriptor.automaticPackDetection, false, 'Facade: automatic pack detection is rejected');
  equal(descriptor.entryPoints.financePipelineRun.route, '/api/v1/pipeline/run', 'Facade: finance keeps hosted route');
  equal(descriptor.entryPoints.cryptoExecutionPlan.route, null, 'Facade: crypto hosted route is not claimed');
  equal(descriptor.entryPoints.cryptoExecutionPlan.packageSubpath, 'attestor/crypto-execution-admission', 'Facade: crypto keeps package boundary');
  equal(isConsequenceAdmissionFacadeSurface('finance-pipeline-run'), true, 'Facade: finance surface is recognized');
  equal(isConsequenceAdmissionFacadeSurface('crypto-execution-plan'), true, 'Facade: crypto surface is recognized');
  equal(isConsequenceAdmissionFacadeSurface('auto'), false, 'Facade: auto surface is rejected');
}

function testFinanceFacadeUsesFinanceProjection(): void {
  const response = createConsequenceAdmissionFacadeResponse({
    surface: 'finance-pipeline-run',
    run: financeRunFixture(),
    decidedAt: '2026-04-23T14:02:00.000Z',
    requestInput: {
      actorRef: 'actor:finance-agent',
      reviewerRef: 'reviewer:controller',
      authorityMode: 'dual-approval',
    },
  });

  assertCanonicalResponse(response, 'admit');
  equal(response.request.packFamily, 'finance', 'Facade: finance request uses finance pack');
  equal(response.request.entryPoint.route, '/api/v1/pipeline/run', 'Facade: finance request uses hosted route');
  equal(response.request.entryPoint.packageSubpath, null, 'Facade: finance request does not use package boundary');
  equal(response.nativeDecision?.value, 'pass', 'Facade: finance native value is preserved');
}

function testCryptoFacadeUsesPackageProjection(): void {
  const plan = cryptoPlanFixture({
    adapterKind: 'erc-4337-user-operation',
    outcome: 'review-required',
    requiredPreflightSources: ['erc-4337-validation'],
    preflightStatus: 'not-run',
    adapterReady: false,
  });
  const response = createConsequenceAdmissionFacadeResponse({
    surface: 'crypto-execution-plan',
    plan,
    decidedAt: '2026-04-23T14:02:00.000Z',
  });

  assertCanonicalResponse(response, 'review');
  equal(response.request.packFamily, 'crypto', 'Facade: crypto request uses crypto pack');
  equal(response.request.entryPoint.route, null, 'Facade: crypto request does not claim hosted route');
  equal(response.request.entryPoint.packageSubpath, 'attestor/crypto-execution-admission', 'Facade: crypto request uses package boundary');
  equal(response.nativeDecision?.value, 'needs-evidence', 'Facade: crypto native value is preserved');
  equal(response.failClosed, true, 'Facade: crypto review is fail closed');
}

function testInvalidSurfaceFailsClosedBeforeGuessing(): void {
  assert.throws(
    () =>
      createConsequenceAdmissionFacadeResponse({
        surface: 'auto',
        decidedAt: '2026-04-23T14:02:00.000Z',
        run: financeRunFixture(),
      } as unknown as Parameters<typeof createConsequenceAdmissionFacadeResponse>[0]),
    /requires an explicit supported surface/u,
  );
  passed += 1;
}

testDescriptorKeepsOneExplicitFacade();
testFinanceFacadeUsesFinanceProjection();
testCryptoFacadeUsesPackageProjection();
testInvalidSurfaceFailsClosedBeforeGuessing();

console.log(`Consequence admission facade tests: ${passed} passed, 0 failed`);
