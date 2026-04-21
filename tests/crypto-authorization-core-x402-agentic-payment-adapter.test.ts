import assert from 'node:assert/strict';
import {
  X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
  X402_CHECKS,
  X402_EXACT_AUTHORIZATION_MODES,
  X402_FACILITATOR_PATHS,
  X402_HTTP_PAYMENT_REQUIRED_STATUS,
  X402_OUTCOMES,
  X402_PAYMENT_REQUIRED_HEADER,
  X402_PAYMENT_RESPONSE_HEADER,
  X402_PAYMENT_SCHEMES,
  X402_PAYMENT_SIGNATURE_HEADER,
  X402_PROTOCOL_VERSION,
  createX402AgenticPaymentPreflight,
  simulateX402AgenticPaymentAuthorization,
  x402AgenticPaymentAdapterDescriptor,
  x402AgenticPaymentPreflightLabel,
  type X402AgentBudgetEvidence,
  type X402ExactAuthorizationEvidence,
  type X402FacilitatorEvidence,
  type X402PaymentPayloadEvidence,
  type X402PaymentRequirementsEvidence,
  type X402PrivacyMetadataEvidence,
  type X402ResourceEvidence,
  type X402ServiceTrustEvidence,
} from '../src/crypto-authorization-core/x402-agentic-payment-adapter.js';
import {
  createCryptoEnforcementVerificationBinding,
  type CryptoEnforcementVerificationBinding,
} from '../src/crypto-authorization-core/enforcement-plane-verification.js';
import {
  createCryptoPolicyControlPlaneScopeBinding,
  type CryptoPolicyControlPlaneScopeBinding,
} from '../src/crypto-authorization-core/policy-control-plane-scope-binding.js';
import {
  createCryptoReleaseDecisionBinding,
  type CryptoReleaseDecisionBinding,
} from '../src/crypto-authorization-core/release-decision-binding.js';
import {
  createCryptoEoaSignatureValidationProjection,
} from '../src/crypto-authorization-core/erc1271-validation-projection.js';
import {
  createCryptoReplayFreshnessRules,
  evaluateCryptoAuthorizationFreshness,
} from '../src/crypto-authorization-core/replay-freshness-rules.js';
import {
  createCryptoEip712AuthorizationEnvelope,
} from '../src/crypto-authorization-core/eip712-authorization-envelope.js';
import {
  createCryptoCanonicalAssetReference,
  createCryptoCanonicalReferenceBundle,
} from '../src/crypto-authorization-core/canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
  type CryptoConsequenceRiskAssessment,
} from '../src/crypto-authorization-core/consequence-risk-mapping.js';
import {
  CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
  createCryptoAuthorizationActor,
  createCryptoAuthorizationConstraints,
  createCryptoAuthorizationDecision,
  createCryptoAuthorizationIntent,
  createCryptoAuthorizationPolicyScope,
  createCryptoExecutionTarget,
  createCryptoSignerAuthority,
  type CryptoAuthorizationIntent,
} from '../src/crypto-authorization-core/object-model.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
  type CryptoExecutionAdapterKind,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

const PAYER_ADDRESS = '0x1111111111111111111111111111111111111111';
const PAY_TO_ADDRESS = '0x2222222222222222222222222222222222222222';
const OTHER_ADDRESS = '0x3333333333333333333333333333333333333333';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const RESOURCE_URL = 'https://api.attestor.example/market-data/premium';
const FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const AUTHORIZATION_NONCE = `0x${'aa'.repeat(32)}`;
const PAYLOAD_HASH = `0x${'bb'.repeat(32)}`;
const REQUIREMENTS_HASH = `0x${'cc'.repeat(32)}`;
const SETTLEMENT_TX = `0x${'dd'.repeat(32)}`;
const SPIFFE_ID = 'spiffe://attestor.test/ns/crypto/sa/x402-payment';
const SIMULATED_AT_EPOCH_SECONDS = 1776762060;
const FRESH_REVOCATION_CHECKED_AT_EPOCH_SECONDS = 1776762055;

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

function fixtureChain() {
  return createCryptoChainReference({
    namespace: 'eip155',
    chainId: '8453',
  });
}

function fixtureAgentAccount() {
  return createCryptoAccountReference({
    accountKind: 'agent-wallet',
    chain: fixtureChain(),
    address: PAYER_ADDRESS,
    accountLabel: 'Agent x402 wallet',
  });
}

function fixtureAsset() {
  return createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain: fixtureChain(),
    assetId: USDC_BASE,
    symbol: 'USDC',
    decimals: 6,
  });
}

interface FixtureSuite {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
}

function fixtureSuite(
  executionAdapterKind: CryptoExecutionAdapterKind = 'x402-payment',
): FixtureSuite {
  const chain = fixtureChain();
  const account = fixtureAgentAccount();
  const asset = fixtureAsset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:x402-market-data',
    authorityRef: 'authority:x402-agent-budget-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'payee',
    chain,
    targetId: RESOURCE_URL,
    address: PAY_TO_ADDRESS,
    counterparty: PAY_TO_ADDRESS,
    protocol: 'x402',
    calldataClass: 'http-get-premium-market-data',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: [
      'chain',
      'account',
      'actor',
      'asset',
      'counterparty',
      'spender',
      'protocol',
      'function-selector',
      'calldata-class',
      'amount',
      'budget',
      'validity-window',
      'cadence',
      'risk-tier',
      'approval-quorum',
      'runtime-context',
    ],
    environment: 'prod-crypto',
    tenantId: 'tenant-crypto',
    policyPackRef: 'policy-pack:crypto:x402:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T09:00:00.000Z',
    validUntil: '2026-04-21T09:02:00.000Z',
    nonce: AUTHORIZATION_NONCE,
    replayProtectionMode: 'idempotency-key',
    digestMode: 'http-payment-hash',
    requiredArtifacts: [
      ...CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
      'http-payment-authorization',
    ],
    maxAmount: '250000',
    budgetId: 'budget:x402:market-data:daily',
    cadence: 'per-minute',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: `intent-crypto-x402-payment-${executionAdapterKind}`,
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    asset,
    consequenceKind: 'agent-payment',
    target,
    policyScope,
    constraints,
    executionAdapterKind,
    evidenceRefs: [
      'evidence:crypto-x402-payment:001',
      'policy:activation:x402:001',
    ],
  });
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain,
    account,
    asset: createCryptoCanonicalAssetReference({ asset }),
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account,
    asset,
    amount: {
      assetAmount: '120000',
      normalizedUsd: '0.12',
    },
    context: {
      executionAdapterKind,
      signals: ['agent-initiated', 'known-counterparty'],
      hasExpiry: true,
      hasBudget: true,
      hasRevocationPath: true,
      isKnownCounterparty: true,
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'eoa-signer',
    authorityId: 'agent-wallet:x402-market-data',
    validationMode: 'eip-712-eoa',
    address: PAYER_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: `decision-crypto-x402-payment-${executionAdapterKind}`,
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: `release-crypto-x402-payment-${executionAdapterKind}`,
    reasonCodes: ['policy-allow', 'x402-budget-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: `envelope-crypto-x402-payment-${executionAdapterKind}`,
    receiptId: `receipt-crypto-x402-payment-${executionAdapterKind}`,
    intent,
    decision: cryptoDecision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: VERIFYING_CONTRACT,
  });
  const signatureValidation = createCryptoEoaSignatureValidationProjection({
    envelope,
    signature: SIGNATURE,
    expectedSigner: PAYER_ADDRESS,
    adapterKind: executionAdapterKind,
  });
  const freshnessRules = createCryptoReplayFreshnessRules({
    intent,
    decision: cryptoDecision,
    envelope,
    idempotencyKey: 'idem-x402-market-data-001',
  });
  const freshnessEvaluation = evaluateCryptoAuthorizationFreshness({
    rules: freshnessRules,
    nowEpochSeconds: SIMULATED_AT_EPOCH_SECONDS,
    replayLedgerAvailable: true,
    replayLedgerEntry: null,
    revocationObservation: {
      revocationKey: freshnessRules.revocation.revocationKey,
      status: 'active',
      checkedAtEpochSeconds: FRESH_REVOCATION_CHECKED_AT_EPOCH_SECONDS,
    },
  });
  const releaseBinding = createCryptoReleaseDecisionBinding({
    intent,
    cryptoDecision,
    riskAssessment,
    envelope,
    signatureValidation,
    freshnessRules,
    freshnessEvaluation,
  });
  const policyScopeBinding = createCryptoPolicyControlPlaneScopeBinding({
    intent,
    cryptoDecision,
    riskAssessment,
    releaseBinding,
    generatedAt: '2026-04-21T09:00:03.000Z',
    planId: 'enterprise',
  });
  const enforcementBinding = createCryptoEnforcementVerificationBinding({
    releaseBinding,
    policyScopeBinding,
    requestId: `erq_crypto_x402_payment_${executionAdapterKind.replaceAll('-', '_')}`,
    receivedAt: '2026-04-21T09:00:04.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.crypto.x402-payment',
      workloadId: SPIFFE_ID,
    },
    traceId: 'trace-crypto-x402-payment-001',
    idempotencyKey: 'idem-x402-market-data-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function resource(overrides: Partial<X402ResourceEvidence> = {}): X402ResourceEvidence {
  return {
    transport: 'http',
    observedAt: '2026-04-21T09:01:00.000Z',
    method: 'GET',
    resourceUrl: RESOURCE_URL,
    statusCode: X402_HTTP_PAYMENT_REQUIRED_STATUS,
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
    x402Version: X402_PROTOCOL_VERSION,
    acceptsCount: 1,
    selectedAcceptIndex: 0,
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '120000',
    asset: USDC_BASE,
    payTo: PAY_TO_ADDRESS,
    maxTimeoutSeconds: 60,
    extraName: 'USDC',
    extraVersion: '2',
    requirementsHash: REQUIREMENTS_HASH,
    extensionsAdvertised: ['sign-in-with-x'],
    ...overrides,
  };
}

function authorization(
  overrides: Partial<X402ExactAuthorizationEvidence> = {},
): X402ExactAuthorizationEvidence {
  return {
    mode: 'eip-3009-transfer-with-authorization',
    from: PAYER_ADDRESS,
    to: PAY_TO_ADDRESS,
    value: '120000',
    validAfterEpochSeconds: '1776762000',
    validBeforeEpochSeconds: '1776762060',
    nonce: AUTHORIZATION_NONCE,
    signature: SIGNATURE,
    signatureValid: true,
    domainName: 'USDC',
    domainVersion: '2',
    domainChainId: '8453',
    verifyingContract: USDC_BASE,
    nonceUnused: true,
    balanceSufficient: true,
    transferSimulationSucceeded: true,
    ...overrides,
  };
}

function payload(overrides: Partial<X402PaymentPayloadEvidence> = {}): X402PaymentPayloadEvidence {
  const auth = overrides.authorization ?? authorization();
  return {
    x402Version: X402_PROTOCOL_VERSION,
    paymentSignatureHeaderPresent: true,
    payloadHash: PAYLOAD_HASH,
    resourceMatchesRequirements: true,
    acceptedMatchesRequirements: true,
    payer: PAYER_ADDRESS,
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '120000',
    asset: USDC_BASE,
    payTo: PAY_TO_ADDRESS,
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
    verifyPayer: PAYER_ADDRESS,
    settleRequested: true,
    settleResponseSuccess: true,
    settlementTransaction: SETTLEMENT_TX,
    settlementNetwork: 'eip155:8453',
    settlementPayer: PAYER_ADDRESS,
    settlementAmount: '120000',
    paymentResponseHeaderPresent: true,
    ...overrides,
  };
}

function budget(overrides: Partial<X402AgentBudgetEvidence> = {}): X402AgentBudgetEvidence {
  return {
    agentId: 'agent:x402-market-data',
    budgetId: 'budget:x402:market-data:daily',
    spendLimitAtomic: '1000000',
    spendUsedAtomic: '250000',
    proposedSpendAtomic: '120000',
    cadence: 'per-minute',
    requestsUsedInWindow: 2,
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
    merchantId: 'merchant:attestor-market-data',
    serviceDiscoveryRef: 'x402-bazaar:market-data:attestor',
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

function preflightInput() {
  return {
    ...fixtureSuite(),
    resource: resource(),
    paymentRequirements: requirements(),
    paymentPayload: payload(),
    facilitator: facilitator(),
    budget: budget(),
    serviceTrust: serviceTrust(),
    privacy: privacy(),
  };
}

function testDescriptor(): void {
  const descriptor = x402AgenticPaymentAdapterDescriptor();

  equal(
    descriptor.version,
    X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
    'x402 adapter: descriptor exposes version',
  );
  equal(
    descriptor.protocolVersion,
    X402_PROTOCOL_VERSION,
    'x402 adapter: descriptor exposes protocol version',
  );
  equal(
    descriptor.paymentRequiredStatus,
    X402_HTTP_PAYMENT_REQUIRED_STATUS,
    'x402 adapter: descriptor exposes HTTP 402 status',
  );
  equal(
    descriptor.headers.paymentRequired,
    X402_PAYMENT_REQUIRED_HEADER,
    'x402 adapter: descriptor exposes PAYMENT-REQUIRED header',
  );
  equal(
    descriptor.headers.paymentSignature,
    X402_PAYMENT_SIGNATURE_HEADER,
    'x402 adapter: descriptor exposes PAYMENT-SIGNATURE header',
  );
  equal(
    descriptor.headers.paymentResponse,
    X402_PAYMENT_RESPONSE_HEADER,
    'x402 adapter: descriptor exposes PAYMENT-RESPONSE header',
  );
  deepEqual(
    descriptor.schemes,
    X402_PAYMENT_SCHEMES,
    'x402 adapter: descriptor exposes schemes',
  );
  deepEqual(
    descriptor.authorizationModes,
    X402_EXACT_AUTHORIZATION_MODES,
    'x402 adapter: descriptor exposes exact authorization modes',
  );
  deepEqual(
    descriptor.facilitatorPaths,
    X402_FACILITATOR_PATHS,
    'x402 adapter: descriptor exposes facilitator paths',
  );
  deepEqual(
    descriptor.outcomes,
    X402_OUTCOMES,
    'x402 adapter: descriptor exposes outcomes',
  );
  deepEqual(
    descriptor.checks,
    X402_CHECKS,
    'x402 adapter: descriptor exposes checks',
  );
  ok(
    descriptor.references.includes('EIP-3009'),
    'x402 adapter: descriptor names EIP-3009',
  );
  ok(
    descriptor.references.includes('CAIP-2'),
    'x402 adapter: descriptor names CAIP-2',
  );
  ok(
    descriptor.references.includes('metadata-privacy-filtering'),
    'x402 adapter: descriptor names metadata privacy filtering',
  );
}

function testCreatesAllowPreflight(): void {
  const input = preflightInput();
  const preflight = createX402AgenticPaymentPreflight(input);
  const second = createX402AgenticPaymentPreflight(input);

  equal(
    preflight.version,
    X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
    'x402 adapter: preflight carries version',
  );
  equal(
    preflight.adapterKind,
    'x402-payment',
    'x402 adapter: preflight carries adapter kind',
  );
  equal(
    preflight.outcome,
    'allow',
    'x402 adapter: complete payment preflight allows',
  );
  equal(
    preflight.signal.source,
    'x402-payment',
    'x402 adapter: emits x402 simulation source',
  );
  equal(
    preflight.signal.status,
    'pass',
    'x402 adapter: allow signal passes',
  );
  equal(
    preflight.network,
    'eip155:8453',
    'x402 adapter: preflight binds CAIP-2 network',
  );
  equal(
    preflight.payTo,
    PAY_TO_ADDRESS,
    'x402 adapter: preflight binds payTo recipient',
  );
  equal(
    preflight.amount,
    '120000',
    'x402 adapter: preflight binds atomic amount',
  );
  equal(
    preflight.digest,
    second.digest,
    'x402 adapter: preflight digest is deterministic',
  );
  ok(
    preflight.observations.every((entry) => entry.status === 'pass'),
    'x402 adapter: all allow observations pass',
  );
  ok(
    x402AgenticPaymentPreflightLabel(preflight).includes('outcome:allow'),
    'x402 adapter: label includes outcome',
  );
}

function testSimulationAllowsPayment(): void {
  const result = simulateX402AgenticPaymentAuthorization(preflightInput());

  equal(
    result.preflight.outcome,
    'allow',
    'x402 adapter: simulation wrapper carries allow preflight',
  );
  equal(
    result.simulation.outcome,
    'allow-preview',
    'x402 adapter: payment execution allows simulation preview',
  );
  equal(
    result.simulation.readiness.adapterPreflight,
    'ready',
    'x402 adapter: simulation adapter preflight is ready',
  );
  deepEqual(
    result.simulation.requiredPreflightSources,
    ['x402-payment'],
    'x402 adapter: simulation requires x402 payment evidence',
  );
  deepEqual(
    result.simulation.requiredNextArtifacts,
    [],
    'x402 adapter: allow simulation has no required next artifacts',
  );
}

function testPermit2ExactModeAllows(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    paymentPayload: payload({
      authorization: authorization({
        mode: 'permit2-transfer',
      }),
    }),
  });

  equal(
    preflight.outcome,
    'allow',
    'x402 adapter: Permit2 exact transfer mode allows on EVM networks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-exact-authorization-bound'),
    'x402 adapter: exact authorization observation is present',
  );
}

function testPendingSettlementRequiresReview(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    facilitator: facilitator({
      settleResponseSuccess: null,
      settlementTransaction: null,
      settlementNetwork: null,
      settlementPayer: null,
      settlementAmount: null,
      paymentResponseHeaderPresent: false,
    }),
  });

  equal(
    preflight.outcome,
    'review-required',
    'x402 adapter: verified but unsettled payment requires review',
  );
  equal(
    preflight.signal.status,
    'warn',
    'x402 adapter: pending settlement signal warns',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-settlement-pending-review'),
    'x402 adapter: pending settlement reason is present',
  );
}

function testBudgetExceededBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    budget: budget({
      spendUsedAtomic: '950000',
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: budget overflow blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-agent-budget-cadence-exceeded'),
    'x402 adapter: budget overflow reason is present',
  );
}

function testCadenceExceededBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    budget: budget({
      requestsUsedInWindow: 10,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: cadence request limit blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.check === 'x402-agent-budget-cadence'),
    'x402 adapter: cadence check is present',
  );
}

function testRecipientMismatchBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    paymentRequirements: requirements({
      payTo: OTHER_ADDRESS,
    }),
    paymentPayload: payload({
      payTo: OTHER_ADDRESS,
      authorization: authorization({
        to: OTHER_ADDRESS,
      }),
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: recipient mismatch blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-recipient-mismatch'),
    'x402 adapter: recipient mismatch reason is present',
  );
}

function testInvalidSignatureBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    paymentPayload: payload({
      authorization: authorization({
        signatureValid: false,
      }),
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: invalid payment signature blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-payment-signature-payload-invalid'),
    'x402 adapter: invalid signature reason is present',
  );
}

function testReplayAndIdempotencyBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    budget: budget({
      idempotencyFresh: false,
      duplicatePaymentDetected: true,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: stale idempotency blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-replay-or-idempotency-risk'),
    'x402 adapter: replay/idempotency reason is present',
  );
}

function testUnredactedMetadataBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    privacy: privacy({
      piiDetected: true,
      piiRedacted: false,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: unredacted payment metadata blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-privacy-metadata-risk'),
    'x402 adapter: privacy risk reason is present',
  );
}

function testRedactedMetadataAllows(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    privacy: privacy({
      piiDetected: true,
      piiRedacted: true,
      sensitiveQueryDetected: true,
      sensitiveQueryRedacted: true,
    }),
  });

  equal(
    preflight.outcome,
    'allow',
    'x402 adapter: redacted metadata allows',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-privacy-metadata-ready'),
    'x402 adapter: privacy ready reason is present',
  );
}

function testFacilitatorUnsupportedBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    facilitator: facilitator({
      supportedKindAdvertised: false,
      signerTrusted: false,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: unsupported facilitator kind blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-facilitator-support-invalid'),
    'x402 adapter: facilitator support reason is present',
  );
}

function testFacilitatorVerifyBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    facilitator: facilitator({
      verifyResponseValid: false,
      verifyInvalidReason: 'insufficient_funds',
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: facilitator verify failure blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-facilitator-verify-invalid'),
    'x402 adapter: facilitator verify reason is present',
  );
}

function testServiceTrustBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    serviceTrust: serviceTrust({
      resourceOriginAllowlisted: false,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: untrusted service origin blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-service-trust-not-ready'),
    'x402 adapter: service trust reason is present',
  );
}

function testUnsupportedSchemeBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    paymentRequirements: requirements({
      scheme: 'upto',
    }),
    paymentPayload: payload({
      scheme: 'upto',
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: non-exact scheme blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-exact-scheme-required'),
    'x402 adapter: exact scheme reason is present',
  );
}

function testResourceMismatchBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    resource: resource({
      resourceUrl: 'https://api.attestor.example/market-data/other',
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: resource mismatch blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-resource-mismatch'),
    'x402 adapter: resource mismatch reason is present',
  );
}

function testTimeWindowBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    paymentPayload: payload({
      authorization: authorization({
        validBeforeEpochSeconds: '1776762120',
      }),
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: overlong authorization window blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-time-window-invalid'),
    'x402 adapter: time window reason is present',
  );
}

function testAcceptsOutOfRangeBlocks(): void {
  const preflight = createX402AgenticPaymentPreflight({
    ...preflightInput(),
    paymentRequirements: requirements({
      acceptsCount: 1,
      selectedAcceptIndex: 1,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'x402 adapter: accepts index out of range blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'x402-accepts-selection-invalid'),
    'x402 adapter: accepts selection reason is present',
  );
}

function testWrongAdapterThrows(): void {
  assert.throws(
    () =>
      createX402AgenticPaymentPreflight({
        ...preflightInput(),
        ...fixtureSuite('wallet-call-api'),
      }),
    /requires intent execution adapter x402-payment/u,
    'x402 adapter: wrong adapter throws',
  );
  passed += 1;
}

testDescriptor();
testCreatesAllowPreflight();
testSimulationAllowsPayment();
testPermit2ExactModeAllows();
testPendingSettlementRequiresReview();
testBudgetExceededBlocks();
testCadenceExceededBlocks();
testRecipientMismatchBlocks();
testInvalidSignatureBlocks();
testReplayAndIdempotencyBlocks();
testUnredactedMetadataBlocks();
testRedactedMetadataAllows();
testFacilitatorUnsupportedBlocks();
testFacilitatorVerifyBlocks();
testServiceTrustBlocks();
testUnsupportedSchemeBlocks();
testResourceMismatchBlocks();
testTimeWindowBlocks();
testAcceptsOutOfRangeBlocks();
testWrongAdapterThrows();

console.log(`crypto-authorization-core-x402-agentic-payment-adapter: ${passed} checks passed`);
