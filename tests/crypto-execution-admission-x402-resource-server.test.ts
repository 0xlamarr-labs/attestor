import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  createX402ResourceServerAdmissionMiddleware,
  x402ResourceServerAdmissionDescriptor,
  x402ResourceServerAdmissionLabel,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import type { CryptoExecutionAdapterKind } from '../src/crypto-authorization-core/types.js';
import type {
  X402AgentBudgetEvidence,
  X402AgenticPaymentPreflight,
  X402ExactAuthorizationEvidence,
  X402FacilitatorEvidence,
  X402PaymentPayloadEvidence,
  X402PaymentRequirementsEvidence,
  X402PrivacyMetadataEvidence,
  X402ResourceEvidence,
  X402ServiceTrustEvidence,
} from '../src/crypto-authorization-core/x402-agentic-payment-adapter.js';

let passed = 0;

const PAYER = '0x1111111111111111111111111111111111111111';
const PAY_TO = '0x2222222222222222222222222222222222222222';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const RESOURCE_URL = 'https://api.attestor.example/market-data/premium';
const FACILITATOR_URL = 'https://facilitator.attestor.example/x402';

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
    message: status === 'pass' ? `${source} preflight passed.` : `${source} preflight is required.`,
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
  const adapterReady = input.adapterReady ?? true;
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: `simulation-${input.adapterKind ?? 'neutral'}`,
    simulatedAt: '2026-04-22T12:00:00.000Z',
    intentId: `intent-${input.adapterKind ?? 'neutral'}`,
    consequenceKind: 'agent-payment',
    adapterKind: input.adapterKind,
    chainId: 'eip155:8453',
    accountAddress: PAYER,
    riskClass: 'R3',
    reviewAuthorityMode: 'dual-approval',
    outcome: input.outcome,
    confidence: input.outcome === 'deny-preview' ? 'high' : 'medium',
    reasonCodes: input.outcome === 'deny-preview' ? ['blocked-by-simulation'] : [],
    readiness: {
      releaseBinding: 'ready',
      policyBinding: 'ready',
      enforcementBinding: 'ready',
      adapterPreflight: adapterReady
        ? 'ready'
        : preflightStatus === 'fail'
          ? 'blocked'
          : 'missing',
    },
    requiredPreflightSources,
    recommendedPreflightSources: [],
    observations: requiredPreflightSources.map((source) => observation(source, preflightStatus)),
    requiredNextArtifacts: adapterReady ? [] : ['missing-adapter-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:${input.adapterKind ?? 'neutral'}-${input.outcome}`,
  };
}

function admittedPlan() {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'x402-payment',
      outcome: 'allow-preview',
      requiredPreflightSources: ['x402-payment'],
    }),
    createdAt: '2026-04-22T12:05:00.000Z',
    integrationRef: 'integration:x402:resource-server',
  });
}

function authorization(
  overrides: Partial<X402ExactAuthorizationEvidence> = {},
): X402ExactAuthorizationEvidence {
  return {
    mode: 'eip-3009-transfer-with-authorization',
    from: PAYER,
    to: PAY_TO,
    value: '120000',
    validAfterEpochSeconds: '1776811200',
    validBeforeEpochSeconds: '1776811800',
    nonce: `0x${'aa'.repeat(32)}`,
    signature: `0x${'11'.repeat(65)}`,
    signatureValid: true,
    domainName: 'USDC',
    domainVersion: '2',
    domainChainId: '8453',
    verifyingContract: USDC,
    nonceUnused: true,
    balanceSufficient: true,
    transferSimulationSucceeded: true,
    ...overrides,
  };
}

function resource(overrides: Partial<X402ResourceEvidence> = {}): X402ResourceEvidence {
  return {
    transport: 'http',
    observedAt: '2026-04-22T12:06:00.000Z',
    method: 'GET',
    resourceUrl: RESOURCE_URL,
    statusCode: 402,
    paymentRequiredHeaderPresent: true,
    paymentRequiredHeaderDecoded: true,
    responseBodyMatchesHeader: true,
    description: 'Premium market data',
    mimeType: 'application/json',
    routeId: 'GET /market-data/premium',
    ...overrides,
  };
}

function requirements(
  overrides: Partial<X402PaymentRequirementsEvidence> = {},
): X402PaymentRequirementsEvidence {
  return {
    x402Version: 2,
    acceptsCount: 1,
    selectedAcceptIndex: 0,
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '120000',
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extraName: 'USDC',
    extraVersion: '2',
    requirementsHash: `0x${'22'.repeat(32)}`,
    extensionsAdvertised: ['payment-identifier'],
    ...overrides,
  };
}

function payload(
  overrides: Partial<X402PaymentPayloadEvidence> = {},
): X402PaymentPayloadEvidence {
  const auth = overrides.authorization ?? authorization();
  return {
    x402Version: 2,
    paymentSignatureHeaderPresent: true,
    payloadHash: `0x${'33'.repeat(32)}`,
    resourceMatchesRequirements: true,
    acceptedMatchesRequirements: true,
    payer: PAYER,
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '120000',
    asset: USDC,
    payTo: PAY_TO,
    authorization: auth,
    extensionsEchoed: true,
    ...overrides,
    authorization: auth,
  };
}

function facilitator(
  overrides: Partial<X402FacilitatorEvidence> = {},
): X402FacilitatorEvidence {
  return {
    path: 'facilitator-verify-settle',
    facilitatorUrl: FACILITATOR_URL,
    supportedChecked: true,
    supportedKindAdvertised: true,
    signerTrusted: true,
    verifyRequested: true,
    verifyResponseValid: true,
    verifyInvalidReason: null,
    verifyPayer: PAYER,
    settleRequested: true,
    settleResponseSuccess: true,
    settlementTransaction: `0x${'44'.repeat(32)}`,
    settlementNetwork: 'eip155:8453',
    settlementPayer: PAYER,
    settlementAmount: '120000',
    paymentResponseHeaderPresent: true,
    ...overrides,
  };
}

function budget(overrides: Partial<X402AgentBudgetEvidence> = {}): X402AgentBudgetEvidence {
  return {
    agentId: 'agent:market-data',
    budgetId: 'budget:x402:daily',
    spendLimitAtomic: '1000000',
    spendUsedAtomic: '250000',
    proposedSpendAtomic: '120000',
    cadence: 'per-minute',
    requestsUsedInWindow: 1,
    maxRequestsInWindow: 10,
    idempotencyKey: 'idem-x402-market-data-001',
    idempotencyFresh: true,
    duplicatePaymentDetected: false,
    correlationId: 'corr-x402-market-data-001',
    ...overrides,
  };
}

function serviceTrust(
  overrides: Partial<X402ServiceTrustEvidence> = {},
): X402ServiceTrustEvidence {
  return {
    merchantId: 'merchant:attestor',
    serviceDiscoveryRef: 'x402-bazaar:attestor-market-data',
    resourceOriginAllowlisted: true,
    payToAllowlisted: true,
    assetAllowlisted: true,
    networkAllowlisted: true,
    priceMatchesCatalog: true,
    ...overrides,
  };
}

function privacy(
  overrides: Partial<X402PrivacyMetadataEvidence> = {},
): X402PrivacyMetadataEvidence {
  return {
    metadataScanned: true,
    piiDetected: false,
    piiRedacted: false,
    sensitiveQueryDetected: false,
    sensitiveQueryRedacted: false,
    metadataMinimized: true,
    facilitatorDataMinimized: true,
    reasonStringPiiDetected: false,
    ...overrides,
  };
}

function preflight(
  overrides: Partial<X402AgenticPaymentPreflight> = {},
): X402AgenticPaymentPreflight {
  return {
    version: 'attestor.crypto-x402-agentic-payment-adapter.v1',
    preflightId: 'preflight-x402-resource-server',
    adapterKind: 'x402-payment',
    checkedAt: '2026-04-22T12:06:00.000Z',
    x402Version: 2,
    transport: 'http',
    resourceUrl: RESOURCE_URL,
    method: 'GET',
    payer: PAYER,
    payTo: PAY_TO,
    network: 'eip155:8453',
    scheme: 'exact',
    asset: USDC,
    amount: '120000',
    budgetId: 'budget:x402:daily',
    idempotencyKey: 'idem-x402-market-data-001',
    outcome: 'allow',
    signal: {
      source: 'x402-payment',
      status: 'pass',
      code: 'x402-ready',
      message: 'x402 payment preflight passed.',
      required: true,
      evidence: {
        payer: PAYER,
        payTo: PAY_TO,
      },
    },
    observations: [],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    canonical: '{}',
    digest: 'sha256:x402-preflight',
    ...overrides,
  };
}

function testChallengePhaseReturnsPaymentRequired(): void {
  const middleware = createX402ResourceServerAdmissionMiddleware({
    plan: admittedPlan(),
    preflight: preflight(),
    resource: resource(),
    paymentRequirements: requirements(),
    paymentPayload: payload({
      paymentSignatureHeaderPresent: false,
    }),
    facilitator: facilitator({
      verifyRequested: false,
      verifyResponseValid: false,
      settleRequested: false,
      settleResponseSuccess: null,
      paymentResponseHeaderPresent: false,
    }),
    budget: budget(),
    serviceTrust: serviceTrust(),
    privacy: privacy(),
    phase: 'payment-challenge',
    createdAt: '2026-04-22T12:07:00.000Z',
  });

  equal(
    middleware.outcome,
    'needs-http-evidence',
    'x402 resource-server admission: challenge phase waits for payment evidence',
  );
  equal(
    middleware.action,
    'issue-payment-required',
    'x402 resource-server admission: challenge phase returns PAYMENT-REQUIRED',
  );
  equal(
    middleware.headers.paymentRequiredStatus,
    402,
    'x402 resource-server admission: exposes HTTP 402 status',
  );
  equal(
    middleware.expectations.find((entry) => entry.kind === 'payment-signature-header')?.status,
    'pending',
    'x402 resource-server admission: challenge phase awaits PAYMENT-SIGNATURE',
  );
}

function testRetryPhaseWaitsForSettlement(): void {
  const middleware = createX402ResourceServerAdmissionMiddleware({
    plan: admittedPlan(),
    preflight: preflight(),
    resource: resource(),
    paymentRequirements: requirements(),
    paymentPayload: payload(),
    facilitator: facilitator({
      settleRequested: false,
      settleResponseSuccess: null,
      paymentResponseHeaderPresent: false,
    }),
    budget: budget(),
    serviceTrust: serviceTrust(),
    privacy: privacy(),
    phase: 'payment-retry',
    createdAt: '2026-04-22T12:08:00.000Z',
    runtimeObservation: {
      observedAt: '2026-04-22T12:08:30.000Z',
      paymentSignatureHeaderSeen: true,
      verifyAccepted: true,
      settlementAccepted: null,
      paymentResponseHeaderSent: false,
      fulfillmentDeferredUntilSettlement: true,
    },
  });

  equal(
    middleware.outcome,
    'needs-http-evidence',
    'x402 resource-server admission: retry phase waits for settlement when it is not done yet',
  );
  equal(
    middleware.action,
    'settle-payment',
    'x402 resource-server admission: retry phase settles before fulfillment',
  );
  ok(
    middleware.nextActions.some((entry) => entry.includes('/settle')),
    'x402 resource-server admission: retry phase points to facilitator settlement',
  );
}

function testFulfillmentPhaseBecomesReady(): void {
  const middleware = createX402ResourceServerAdmissionMiddleware({
    plan: admittedPlan(),
    preflight: preflight(),
    resource: resource(),
    paymentRequirements: requirements(),
    paymentPayload: payload(),
    facilitator: facilitator(),
    budget: budget(),
    serviceTrust: serviceTrust(),
    privacy: privacy(),
    phase: 'resource-fulfillment',
    createdAt: '2026-04-22T12:09:00.000Z',
    runtimeObservation: {
      observedAt: '2026-04-22T12:09:30.000Z',
      paymentSignatureHeaderSeen: true,
      verifyAccepted: true,
      settlementAccepted: true,
      paymentResponseHeaderSent: true,
      fulfillmentDeferredUntilSettlement: true,
      resourceFulfilled: false,
      returnedStatusCode: 200,
    },
  });

  equal(
    middleware.outcome,
    'ready',
    'x402 resource-server admission: fulfillment phase becomes ready once settlement and headers are bound',
  );
  equal(
    middleware.action,
    'fulfill-resource',
    'x402 resource-server admission: ready middleware allows resource fulfillment',
  );
  equal(
    middleware.expectations.find((entry) => entry.kind === 'fulfillment-gate')?.status,
    'satisfied',
    'x402 resource-server admission: fulfillment gate is satisfied after settlement success',
  );
  ok(
    middleware.digest.startsWith('sha256:'),
    'x402 resource-server admission: middleware is canonicalized',
  );
}

function testInvalidVerifyResponseBlocks(): void {
  const middleware = createX402ResourceServerAdmissionMiddleware({
    plan: admittedPlan(),
    preflight: preflight(),
    resource: resource(),
    paymentRequirements: requirements(),
    paymentPayload: payload(),
    facilitator: facilitator({
      verifyRequested: true,
      verifyResponseValid: false,
      verifyInvalidReason: 'signature-invalid',
      settleRequested: false,
      settleResponseSuccess: null,
      paymentResponseHeaderPresent: false,
    }),
    budget: budget(),
    serviceTrust: serviceTrust(),
    privacy: privacy(),
    phase: 'payment-retry',
    createdAt: '2026-04-22T12:10:00.000Z',
    runtimeObservation: {
      observedAt: '2026-04-22T12:10:30.000Z',
      paymentSignatureHeaderSeen: true,
      verifyAccepted: false,
      settlementAccepted: null,
      paymentResponseHeaderSent: false,
      fulfillmentDeferredUntilSettlement: true,
    },
  });

  equal(
    middleware.outcome,
    'blocked',
    'x402 resource-server admission: invalid facilitator verification blocks the request',
  );
  equal(
    middleware.action,
    'block-request',
    'x402 resource-server admission: blocked verify path cannot fulfill the resource',
  );
  ok(
    middleware.blockingReasons.includes('x402-facilitator-verify-failed'),
    'x402 resource-server admission: blocking reasons carry facilitator verify failure',
  );
}

function testDuplicatePaymentBlocks(): void {
  const middleware = createX402ResourceServerAdmissionMiddleware({
    plan: admittedPlan(),
    preflight: preflight(),
    resource: resource(),
    paymentRequirements: requirements(),
    paymentPayload: payload(),
    facilitator: facilitator(),
    budget: budget({
      duplicatePaymentDetected: true,
    }),
    serviceTrust: serviceTrust(),
    privacy: privacy(),
    phase: 'resource-fulfillment',
    createdAt: '2026-04-22T12:11:00.000Z',
    runtimeObservation: {
      observedAt: '2026-04-22T12:11:30.000Z',
      paymentSignatureHeaderSeen: true,
      verifyAccepted: true,
      settlementAccepted: true,
      paymentResponseHeaderSent: true,
      fulfillmentDeferredUntilSettlement: true,
      duplicatePaymentBlocked: true,
    },
  });

  equal(
    middleware.outcome,
    'blocked',
    'x402 resource-server admission: duplicate payment posture fails closed',
  );
  ok(
    middleware.blockingReasons.includes('x402-duplicate-payment-detected'),
    'x402 resource-server admission: duplicate payment reason is surfaced',
  );
}

function testDescriptorAndLabel(): void {
  const descriptor = x402ResourceServerAdmissionDescriptor();
  const middleware = createX402ResourceServerAdmissionMiddleware({
    plan: admittedPlan(),
    preflight: preflight(),
    resource: resource(),
    paymentRequirements: requirements(),
    paymentPayload: payload(),
    facilitator: facilitator(),
    budget: budget(),
    serviceTrust: serviceTrust(),
    privacy: privacy(),
    phase: 'resource-fulfillment',
    createdAt: '2026-04-22T12:12:00.000Z',
    runtimeObservation: {
      observedAt: '2026-04-22T12:12:30.000Z',
      paymentSignatureHeaderSeen: true,
      verifyAccepted: true,
      settlementAccepted: true,
      paymentResponseHeaderSent: true,
      fulfillmentDeferredUntilSettlement: true,
    },
  });

  equal(
    descriptor.version,
    'attestor.crypto-x402-resource-server-admission-middleware.v1',
    'x402 resource-server admission: descriptor exposes version',
  );
  ok(
    descriptor.runtimeChecks.includes('PAYMENT-REQUIRED'),
    'x402 resource-server admission: descriptor names PAYMENT-REQUIRED check',
  );
  deepEqual(
    descriptor.phases,
    ['payment-challenge', 'payment-retry', 'resource-fulfillment'],
    'x402 resource-server admission: descriptor exposes phases',
  );
  ok(
    x402ResourceServerAdmissionLabel(middleware).includes('x402-resource-server:resource-fulfillment'),
    'x402 resource-server admission: label encodes phase',
  );
}

testChallengePhaseReturnsPaymentRequired();
testRetryPhaseWaitsForSettlement();
testFulfillmentPhaseBecomesReady();
testInvalidVerifyResponseBlocks();
testDuplicatePaymentBlocks();
testDescriptorAndLabel();

console.log(`crypto-execution-admission-x402-resource-server: ${passed} assertions passed`);
