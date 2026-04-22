import {
  createCryptoEnforcementVerificationBinding,
  type CryptoEnforcementVerificationBinding,
} from '../crypto-authorization-core/enforcement-plane-verification.js';
import {
  createCryptoPolicyControlPlaneScopeBinding,
  type CryptoPolicyControlPlaneScopeBinding,
} from '../crypto-authorization-core/policy-control-plane-scope-binding.js';
import {
  createCryptoReleaseDecisionBinding,
  type CryptoReleaseDecisionBinding,
} from '../crypto-authorization-core/release-decision-binding.js';
import {
  createCryptoEoaSignatureValidationProjection,
} from '../crypto-authorization-core/erc1271-validation-projection.js';
import {
  createCryptoReplayFreshnessRules,
  evaluateCryptoAuthorizationFreshness,
} from '../crypto-authorization-core/replay-freshness-rules.js';
import {
  createCryptoEip712AuthorizationEnvelope,
} from '../crypto-authorization-core/eip712-authorization-envelope.js';
import {
  createCryptoCanonicalAssetReference,
  createCryptoCanonicalReferenceBundle,
} from '../crypto-authorization-core/canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
  type CryptoConsequenceRiskAssessment,
} from '../crypto-authorization-core/consequence-risk-mapping.js';
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
} from '../crypto-authorization-core/object-model.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
  type CryptoExecutionAdapterKind,
} from '../crypto-authorization-core/types.js';
import {
  X402_HTTP_PAYMENT_REQUIRED_STATUS,
  X402_PROTOCOL_VERSION,
  simulateX402AgenticPaymentAuthorization,
  type CreateX402AgenticPaymentPreflightInput,
  type X402AgentBudgetEvidence,
  type X402AgenticPaymentPreflight,
  type X402ExactAuthorizationEvidence,
  type X402FacilitatorEvidence,
  type X402PaymentPayloadEvidence,
  type X402PaymentRequirementsEvidence,
  type X402PrivacyMetadataEvidence,
  type X402ResourceEvidence,
  type X402ServiceTrustEvidence,
} from '../crypto-authorization-core/x402-agentic-payment-adapter.js';
import {
  EIP7702_SET_CODE_TX_TYPE,
  simulateEip7702DelegationAuthorization,
  type CreateEip7702DelegationPreflightInput,
  type Eip7702AccountStateEvidence,
  type Eip7702AuthorizationTupleEvidence,
  type Eip7702DelegateCodeEvidence,
  type Eip7702DelegationPreflight,
  type Eip7702ExecutionEvidence,
  type Eip7702InitializationEvidence,
  type Eip7702RecoveryEvidence,
  type Eip7702SponsorEvidence,
} from '../crypto-authorization-core/eip7702-delegation-adapter.js';
import type {
  CryptoAuthorizationSimulationResult,
} from '../crypto-authorization-core/authorization-simulation.js';
import {
  createCryptoAdmissionReceipt,
  createCryptoAdmissionTelemetrySubject,
  createCryptoExecutionAdmissionPlan,
  verifyCryptoAdmissionReceipt,
  type CryptoAdmissionReceipt,
  type CryptoExecutionAdmissionPlan,
} from '../crypto-execution-admission/index.js';
import {
  getProofScenario,
  type ProofScenarioCheckSet,
  type ProofScenarioConsequence,
  type ProofScenarioId,
  type ProofScenarioProofMaterial,
  type ProofSurfaceDecision,
} from './scenario-registry.js';

export type CryptoProofScenarioId = Extract<
  ProofScenarioId,
  'crypto-x402-payment-admit' | 'crypto-delegated-eoa-block'
>;

export const CRYPTO_PROOF_SCENARIO_IDS = [
  'crypto-x402-payment-admit',
  'crypto-delegated-eoa-block',
] as const satisfies readonly CryptoProofScenarioId[];

type CryptoScenarioPreflight =
  | X402AgenticPaymentPreflight
  | Eip7702DelegationPreflight;

interface CryptoFixtureSuite {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
}

export interface CryptoProofPreflightSummary {
  readonly adapterKind: CryptoExecutionAdapterKind;
  readonly preflightId: string;
  readonly outcome: string;
  readonly signalStatus: string;
  readonly observationCount: number;
  readonly failedObservationCodes: readonly string[];
  readonly warningObservationCodes: readonly string[];
  readonly digest: string;
}

export interface CryptoProofSimulationSummary {
  readonly simulationId: string;
  readonly outcome: CryptoAuthorizationSimulationResult['outcome'];
  readonly readiness: CryptoAuthorizationSimulationResult['readiness'];
  readonly requiredPreflightSources: readonly string[];
  readonly requiredNextArtifacts: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly digest: string;
}

export interface CryptoProofAdmissionSummary {
  readonly planId: string;
  readonly outcome: CryptoExecutionAdmissionPlan['outcome'];
  readonly surface: CryptoExecutionAdmissionPlan['surface'];
  readonly chainId: string;
  readonly accountAddress: string;
  readonly requiredHandoffArtifacts: readonly string[];
  readonly transportHeaders: readonly string[];
  readonly blockedReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly stepCount: number;
  readonly digest: string;
}

export interface CryptoProofAdmissionReceiptSummary {
  readonly receiptId: string;
  readonly classification: CryptoAdmissionReceipt['classification'];
  readonly verificationStatus: 'valid' | 'invalid';
  readonly signatureKeyId: string;
  readonly evidenceDigest: string;
  readonly receiptDigest: string;
}

export interface CryptoProofScenarioRun {
  readonly version: 'attestor.proof-surface.crypto-run.v1';
  readonly scenarioId: CryptoProofScenarioId;
  readonly title: string;
  readonly packFamily: 'crypto';
  readonly categoryEntryPoint: string;
  readonly plainLanguageHook: string;
  readonly proposedConsequence: ProofScenarioConsequence;
  readonly checks: ProofScenarioCheckSet;
  readonly expectedDecision: ProofSurfaceDecision;
  readonly decision: ProofSurfaceDecision;
  readonly reason: string;
  readonly preflight: CryptoProofPreflightSummary;
  readonly simulation: CryptoProofSimulationSummary;
  readonly admission: CryptoProofAdmissionSummary;
  readonly admissionReceipt: CryptoProofAdmissionReceiptSummary;
  readonly proofMaterials: readonly ProofScenarioProofMaterial[];
  readonly failClosed: boolean;
}

const X402_PAYER_ADDRESS = '0x1111111111111111111111111111111111111111';
const X402_PAY_TO_ADDRESS = '0x2222222222222222222222222222222222222222';
const X402_USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const X402_VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const X402_RESOURCE_URL = 'https://api.attestor.example/market-data/premium';
const X402_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';
const X402_SIGNATURE = `0x${'11'.repeat(65)}`;
const X402_AUTHORIZATION_NONCE = `0x${'aa'.repeat(32)}`;
const X402_PAYLOAD_HASH = `0x${'bb'.repeat(32)}`;
const X402_REQUIREMENTS_HASH = `0x${'cc'.repeat(32)}`;
const X402_SETTLEMENT_TX = `0x${'dd'.repeat(32)}`;
const X402_SPIFFE_ID = 'spiffe://attestor.test/ns/proof-surface/sa/x402-payment';

const EIP7702_ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const EIP7702_TARGET_ADDRESS = '0x2222222222222222222222222222222222222222';
const EIP7702_DELEGATE_ADDRESS = '0x3333333333333333333333333333333333333333';
const EIP7702_OTHER_ADDRESS = '0x6666666666666666666666666666666666666666';
const EIP7702_VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const EIP7702_SIGNATURE = `0x${'11'.repeat(65)}`;
const EIP7702_TUPLE_HASH = `0x${'aa'.repeat(32)}`;
const EIP7702_DELEGATE_CODE_HASH = `0x${'bb'.repeat(32)}`;
const EIP7702_INIT_DATA_HASH = `0x${'dd'.repeat(32)}`;
const EIP7702_SPIFFE_ID =
  'spiffe://attestor.test/ns/proof-surface/sa/eip7702-delegation';

const SIMULATED_AT_EPOCH_SECONDS = 1776762120;
const FRESH_REVOCATION_CHECKED_AT_EPOCH_SECONDS = 1776762110;

const PROOF_RECEIPT_SIGNER = Object.freeze({
  keyId: 'proof-surface-crypto-admission-receipt-key-001',
  secret: 'local-proof-surface-crypto-receipt-secret',
});

const POLICY_DIMENSIONS = [
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
] as const;

function x402Chain() {
  return createCryptoChainReference({
    namespace: 'eip155',
    chainId: '8453',
  });
}

function eip7702Chain() {
  return createCryptoChainReference({
    namespace: 'eip155',
    chainId: '1',
  });
}

function x402Account() {
  return createCryptoAccountReference({
    accountKind: 'agent-wallet',
    chain: x402Chain(),
    address: X402_PAYER_ADDRESS,
    accountLabel: 'Agent x402 wallet',
  });
}

function eip7702Account() {
  return createCryptoAccountReference({
    accountKind: 'eoa',
    chain: eip7702Chain(),
    address: EIP7702_ACCOUNT_ADDRESS,
    accountLabel: 'Treasury EOA',
  });
}

function x402Asset() {
  return createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain: x402Chain(),
    assetId: X402_USDC_BASE,
    symbol: 'USDC',
    decimals: 6,
  });
}

function x402FixtureSuite(): CryptoFixtureSuite {
  const chain = x402Chain();
  const account = x402Account();
  const asset = x402Asset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:x402-market-data',
    authorityRef: 'authority:x402-agent-budget-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'payee',
    chain,
    targetId: X402_RESOURCE_URL,
    address: X402_PAY_TO_ADDRESS,
    counterparty: X402_PAY_TO_ADDRESS,
    protocol: 'x402',
    calldataClass: 'http-get-premium-market-data',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: POLICY_DIMENSIONS,
    environment: 'prod-crypto',
    tenantId: 'tenant-crypto',
    policyPackRef: 'policy-pack:crypto:x402:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T09:00:00.000Z',
    validUntil: '2026-04-21T09:02:00.000Z',
    nonce: X402_AUTHORIZATION_NONCE,
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
    intentId: 'intent-proof-crypto-x402-payment',
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    asset,
    consequenceKind: 'agent-payment',
    target,
    policyScope,
    constraints,
    executionAdapterKind: 'x402-payment',
    evidenceRefs: [
      'evidence:proof-crypto-x402-payment:001',
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
      executionAdapterKind: 'x402-payment',
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
    address: X402_PAYER_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: 'decision-proof-crypto-x402-payment',
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: 'release-proof-crypto-x402-payment',
    reasonCodes: ['policy-allow', 'x402-budget-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: 'envelope-proof-crypto-x402-payment',
    receiptId: 'receipt-proof-crypto-x402-payment',
    intent,
    decision: cryptoDecision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: X402_VERIFYING_CONTRACT,
  });
  const signatureValidation = createCryptoEoaSignatureValidationProjection({
    envelope,
    signature: X402_SIGNATURE,
    expectedSigner: X402_PAYER_ADDRESS,
    adapterKind: 'x402-payment',
  });
  const freshnessRules = createCryptoReplayFreshnessRules({
    intent,
    decision: cryptoDecision,
    envelope,
    idempotencyKey: 'idem-proof-x402-market-data-001',
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
    requestId: 'erq_proof_crypto_x402_payment',
    receivedAt: '2026-04-21T09:00:04.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.proof.crypto.x402-payment',
      workloadId: X402_SPIFFE_ID,
    },
    traceId: 'trace-proof-crypto-x402-payment-001',
    idempotencyKey: 'idem-proof-x402-market-data-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function eip7702FixtureSuite(): CryptoFixtureSuite {
  const chain = eip7702Chain();
  const account = eip7702Account();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:treasury-eip7702',
    authorityRef: 'authority:treasury-eip7702-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'contract',
    chain,
    targetId: 'contract:bounded-delegated-call',
    address: EIP7702_TARGET_ADDRESS,
    counterparty: 'contract:bounded-delegated-call',
    protocol: 'eip7702-delegate-protocol',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-delegated-call',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: POLICY_DIMENSIONS,
    environment: 'prod-crypto',
    tenantId: 'tenant-crypto',
    policyPackRef: 'policy-pack:crypto:eip7702:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T09:00:00.000Z',
    validUntil: '2026-04-21T09:05:00.000Z',
    nonce: 'authorization-list:nonce:7',
    replayProtectionMode: 'authorization-list-nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
    budgetId: 'budget:eip7702:daily',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-proof-crypto-eip7702-delegation',
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'account-delegation',
    target,
    policyScope,
    constraints,
    executionAdapterKind: 'eip-7702-delegation',
    evidenceRefs: [
      'evidence:proof-crypto-eip7702-delegation:001',
      'policy:activation:eip7702:001',
    ],
  });
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain,
    account,
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'account-delegation',
    account,
    context: {
      executionAdapterKind: 'eip-7702-delegation',
      signals: ['agent-initiated'],
      hasExpiry: true,
      hasBudget: true,
      hasRevocationPath: true,
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'eoa-signer',
    authorityId: 'eoa:treasury',
    validationMode: 'eip-712-eoa',
    address: EIP7702_ACCOUNT_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: 'decision-proof-crypto-eip7702-delegation',
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: 'release-proof-crypto-eip7702-delegation',
    reasonCodes: ['policy-allow', 'eip7702-delegation-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: 'envelope-proof-crypto-eip7702-delegation',
    receiptId: 'receipt-proof-crypto-eip7702-delegation',
    intent,
    decision: cryptoDecision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: EIP7702_VERIFYING_CONTRACT,
  });
  const signatureValidation = createCryptoEoaSignatureValidationProjection({
    envelope,
    signature: EIP7702_SIGNATURE,
    expectedSigner: EIP7702_ACCOUNT_ADDRESS,
    adapterKind: 'eip-7702-delegation',
  });
  const freshnessRules = createCryptoReplayFreshnessRules({
    intent,
    decision: cryptoDecision,
    envelope,
  });
  const freshnessEvaluation = evaluateCryptoAuthorizationFreshness({
    rules: freshnessRules,
    nowEpochSeconds: SIMULATED_AT_EPOCH_SECONDS,
    revocationObservation: {
      revocationKey: freshnessRules.revocation.revocationKey,
      status: 'active',
      checkedAtEpochSeconds: FRESH_REVOCATION_CHECKED_AT_EPOCH_SECONDS,
    },
    adapterNonceObservation: {
      nonce: freshnessRules.adapterNonce.expectedNonce,
      matchesExpected: true,
      checkedAtEpochSeconds: FRESH_REVOCATION_CHECKED_AT_EPOCH_SECONDS,
      sourceKind: 'eip-7702-authority-nonce',
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
    requestId: 'erq_proof_crypto_eip7702_delegation',
    receivedAt: '2026-04-21T09:01:00.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.proof.crypto.eip7702-delegation',
      workloadId: EIP7702_SPIFFE_ID,
    },
    traceId: 'trace-proof-crypto-eip7702-delegation-001',
    idempotencyKey: 'idem-proof-crypto-eip7702-delegation-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function x402Resource(): X402ResourceEvidence {
  return {
    transport: 'http',
    observedAt: '2026-04-21T09:01:00.000Z',
    method: 'GET',
    resourceUrl: X402_RESOURCE_URL,
    statusCode: X402_HTTP_PAYMENT_REQUIRED_STATUS,
    paymentRequiredHeaderPresent: true,
    paymentRequiredHeaderDecoded: true,
    responseBodyMatchesHeader: true,
    description: 'Premium market data',
    mimeType: 'application/json',
    routeId: 'GET /market-data/premium',
  };
}

function x402PaymentRequirements(): X402PaymentRequirementsEvidence {
  return {
    x402Version: X402_PROTOCOL_VERSION,
    acceptsCount: 1,
    selectedAcceptIndex: 0,
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '120000',
    asset: X402_USDC_BASE,
    payTo: X402_PAY_TO_ADDRESS,
    maxTimeoutSeconds: 60,
    extraName: 'USDC',
    extraVersion: '2',
    requirementsHash: X402_REQUIREMENTS_HASH,
    extensionsAdvertised: ['sign-in-with-x'],
  };
}

function x402Authorization(): X402ExactAuthorizationEvidence {
  return {
    mode: 'eip-3009-transfer-with-authorization',
    from: X402_PAYER_ADDRESS,
    to: X402_PAY_TO_ADDRESS,
    value: '120000',
    validAfterEpochSeconds: '1776762000',
    validBeforeEpochSeconds: '1776762060',
    nonce: X402_AUTHORIZATION_NONCE,
    signature: X402_SIGNATURE,
    signatureValid: true,
    domainName: 'USDC',
    domainVersion: '2',
    domainChainId: '8453',
    verifyingContract: X402_USDC_BASE,
    nonceUnused: true,
    balanceSufficient: true,
    transferSimulationSucceeded: true,
  };
}

function x402PaymentPayload(): X402PaymentPayloadEvidence {
  return {
    x402Version: X402_PROTOCOL_VERSION,
    paymentSignatureHeaderPresent: true,
    payloadHash: X402_PAYLOAD_HASH,
    resourceMatchesRequirements: true,
    acceptedMatchesRequirements: true,
    payer: X402_PAYER_ADDRESS,
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '120000',
    asset: X402_USDC_BASE,
    payTo: X402_PAY_TO_ADDRESS,
    authorization: x402Authorization(),
    extensionsEchoed: true,
  };
}

function x402Facilitator(): X402FacilitatorEvidence {
  return {
    path: 'facilitator-verify-settle',
    facilitatorUrl: X402_FACILITATOR_URL,
    supportedChecked: true,
    supportedKindAdvertised: true,
    signerTrusted: true,
    verifyRequested: true,
    verifyResponseValid: true,
    verifyInvalidReason: null,
    verifyPayer: X402_PAYER_ADDRESS,
    settleRequested: true,
    settleResponseSuccess: true,
    settlementTransaction: X402_SETTLEMENT_TX,
    settlementNetwork: 'eip155:8453',
    settlementPayer: X402_PAYER_ADDRESS,
    settlementAmount: '120000',
    paymentResponseHeaderPresent: true,
  };
}

function x402Budget(): X402AgentBudgetEvidence {
  return {
    agentId: 'agent:x402-market-data',
    budgetId: 'budget:x402:market-data:daily',
    spendLimitAtomic: '1000000',
    spendUsedAtomic: '250000',
    proposedSpendAtomic: '120000',
    cadence: 'per-minute',
    requestsUsedInWindow: 2,
    maxRequestsInWindow: 10,
    idempotencyKey: 'idem-proof-x402-market-data-001',
    idempotencyFresh: true,
    duplicatePaymentDetected: false,
    correlationId: 'corr-proof-x402-market-data-001',
  };
}

function x402ServiceTrust(): X402ServiceTrustEvidence {
  return {
    merchantId: 'merchant:attestor-market-data',
    serviceDiscoveryRef: 'x402-bazaar:market-data:attestor',
    resourceOriginAllowlisted: true,
    payToAllowlisted: true,
    assetAllowlisted: true,
    networkAllowlisted: true,
    priceMatchesCatalog: true,
  };
}

function x402Privacy(): X402PrivacyMetadataEvidence {
  return {
    metadataScanned: true,
    piiDetected: false,
    piiRedacted: false,
    sensitiveQueryDetected: false,
    sensitiveQueryRedacted: false,
    metadataMinimized: true,
    facilitatorDataMinimized: true,
    reasonStringPiiDetected: false,
  };
}

function x402PreflightInput(): CreateX402AgenticPaymentPreflightInput {
  return {
    ...x402FixtureSuite(),
    resource: x402Resource(),
    paymentRequirements: x402PaymentRequirements(),
    paymentPayload: x402PaymentPayload(),
    facilitator: x402Facilitator(),
    budget: x402Budget(),
    serviceTrust: x402ServiceTrust(),
    privacy: x402Privacy(),
  };
}

function eip7702Authorization(
  overrides: Partial<Eip7702AuthorizationTupleEvidence> = {},
): Eip7702AuthorizationTupleEvidence {
  return {
    chainId: '1',
    authorityAddress: EIP7702_ACCOUNT_ADDRESS,
    delegationAddress: EIP7702_DELEGATE_ADDRESS,
    nonce: '7',
    yParity: '1',
    r: `0x${'12'.repeat(32)}`,
    s: `0x${'34'.repeat(32)}`,
    tupleHash: EIP7702_TUPLE_HASH,
    signatureRecoveredAddress: EIP7702_ACCOUNT_ADDRESS,
    signatureValid: true,
    lowS: true,
    ...overrides,
  };
}

function eip7702AccountState(): Eip7702AccountStateEvidence {
  return {
    observedAt: '2026-04-21T09:02:00.000Z',
    chainId: 'eip155:1',
    authorityAddress: EIP7702_ACCOUNT_ADDRESS,
    currentNonce: '7',
    codeState: 'empty',
    currentDelegationAddress: null,
    delegationIndicator: null,
    codeHash: null,
    pendingTransactionCount: 1,
    pendingTransactionPolicyCompliant: true,
  };
}

function eip7702DelegateCode(): Eip7702DelegateCodeEvidence {
  return {
    delegationAddress: EIP7702_DELEGATE_ADDRESS,
    delegateCodeHash: EIP7702_DELEGATE_CODE_HASH,
    delegateImplementationId: 'delegate.safe-eip7702.1.0.0',
    audited: true,
    allowlisted: true,
    storageLayoutSafe: true,
    supportsReplayProtection: true,
    supportsTargetCalldataBinding: true,
    supportsValueBinding: true,
    supportsGasBinding: true,
    supportsExpiryBinding: true,
  };
}

function eip7702Execution(): Eip7702ExecutionEvidence {
  return {
    executionPath: 'set-code-transaction',
    transactionType: EIP7702_SET_CODE_TX_TYPE,
    authorizationListLength: 1,
    tupleIndex: 0,
    tupleIsLastValidForAuthority: true,
    authorizationListNonEmpty: true,
    destination: EIP7702_ACCOUNT_ADDRESS,
    target: EIP7702_TARGET_ADDRESS,
    value: '0',
    data: '0x12345678abcdef',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-delegated-call',
    batchCallCount: 1,
    targetCalldataSigned: true,
    valueSigned: true,
    gasLimitSigned: true,
    nonceSigned: true,
    expirySigned: true,
    runtimeContextBound: true,
    userOperationHash: null,
    entryPoint: null,
    initCodeMarker: null,
    factoryDataHash: null,
    eip7702AuthIncluded: null,
    preVerificationGasIncludesAuthorizationCost: null,
    walletCapabilityObserved: null,
    walletCapabilitySupported: null,
    walletCapabilityRequested: null,
    atomicRequired: null,
    postExecutionSuccess: null,
  };
}

function eip7702Initialization(): Eip7702InitializationEvidence {
  return {
    initializationRequired: true,
    initializationCalldataHash: EIP7702_INIT_DATA_HASH,
    initializationSignedByAuthority: true,
    initializationExecutedBeforeValidation: true,
    frontRunProtected: true,
  };
}

function eip7702Sponsor(): Eip7702SponsorEvidence {
  return {
    sponsored: false,
    sponsorAddress: null,
    sponsorBondRequired: null,
    sponsorBondPresent: null,
    reimbursementBound: null,
  };
}

function eip7702Recovery(): Eip7702RecoveryEvidence {
  return {
    revocationPathReady: true,
    zeroAddressClearSupported: true,
    privateKeyStillControlsAccountAcknowledged: true,
    emergencyDelegateResetPrepared: true,
    recoveryAuthorityRef: 'authority:treasury-eip7702-recovery',
  };
}

function eip7702BlockedPreflightInput(): CreateEip7702DelegationPreflightInput {
  return {
    ...eip7702FixtureSuite(),
    authorization: eip7702Authorization({
      signatureValid: false,
      signatureRecoveredAddress: EIP7702_OTHER_ADDRESS,
    }),
    accountState: eip7702AccountState(),
    delegateCode: eip7702DelegateCode(),
    execution: eip7702Execution(),
    initialization: eip7702Initialization(),
    sponsor: eip7702Sponsor(),
    recovery: eip7702Recovery(),
  };
}

function admissionOutcomeToProofDecision(
  outcome: CryptoExecutionAdmissionPlan['outcome'],
): ProofSurfaceDecision {
  switch (outcome) {
    case 'admit':
      return 'admit';
    case 'needs-evidence':
      return 'review';
    case 'deny':
      return 'block';
  }
}

function summarizePreflight(
  preflight: CryptoScenarioPreflight,
): CryptoProofPreflightSummary {
  return Object.freeze({
    adapterKind: preflight.adapterKind,
    preflightId: preflight.preflightId,
    outcome: preflight.outcome,
    signalStatus: preflight.signal.status,
    observationCount: preflight.observations.length,
    failedObservationCodes: Object.freeze(
      preflight.observations
        .filter((entry) => entry.status === 'fail')
        .map((entry) => entry.code),
    ),
    warningObservationCodes: Object.freeze(
      preflight.observations
        .filter((entry) => entry.status === 'warn')
        .map((entry) => entry.code),
    ),
    digest: preflight.digest,
  });
}

function summarizeSimulation(
  simulation: CryptoAuthorizationSimulationResult,
): CryptoProofSimulationSummary {
  return Object.freeze({
    simulationId: simulation.simulationId,
    outcome: simulation.outcome,
    readiness: simulation.readiness,
    requiredPreflightSources: simulation.requiredPreflightSources,
    requiredNextArtifacts: simulation.requiredNextArtifacts,
    reasonCodes: simulation.reasonCodes,
    digest: simulation.digest,
  });
}

function summarizeAdmission(
  plan: CryptoExecutionAdmissionPlan,
): CryptoProofAdmissionSummary {
  return Object.freeze({
    planId: plan.planId,
    outcome: plan.outcome,
    surface: plan.surface,
    chainId: plan.chainId,
    accountAddress: plan.accountAddress,
    requiredHandoffArtifacts: plan.requiredHandoffArtifacts,
    transportHeaders: plan.transportHeaders,
    blockedReasons: plan.blockedReasons,
    nextActions: plan.nextActions,
    stepCount: plan.steps.length,
    digest: plan.digest,
  });
}

function admissionReceiptFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: CryptoScenarioPreflight;
  readonly subjectKind: string;
  readonly outcome: string;
  readonly action: string;
  readonly issuedAt: string;
}): CryptoProofAdmissionReceiptSummary {
  const subject = createCryptoAdmissionTelemetrySubject({
    plan: input.plan,
    subjectKind: input.subjectKind,
    subjectId: input.preflight.preflightId,
    subjectDigest: input.preflight.digest,
    outcome: input.outcome,
    action: input.action,
  });
  const receipt = createCryptoAdmissionReceipt({
    plan: input.plan,
    subject,
    issuedAt: input.issuedAt,
    serviceId: 'attestor-proof-surface',
    signer: PROOF_RECEIPT_SIGNER,
    failureReasons: input.plan.blockedReasons,
  });
  const verification = verifyCryptoAdmissionReceipt({
    receipt,
    signer: PROOF_RECEIPT_SIGNER,
  });

  return Object.freeze({
    receiptId: receipt.receiptId,
    classification: receipt.classification,
    verificationStatus: verification.status,
    signatureKeyId: receipt.signature.keyId,
    evidenceDigest: receipt.evidenceDigest,
    receiptDigest: receipt.receiptDigest,
  });
}

function buildReason(input: {
  readonly expectedReason: string;
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly receipt: CryptoProofAdmissionReceiptSummary;
}): string {
  if (input.plan.outcome === 'admit') {
    return `${input.expectedReason} The admission plan is admitted on ${input.plan.surface}, and the signed admission receipt verifies as ${input.receipt.verificationStatus}.`;
  }

  if (input.plan.outcome === 'deny') {
    return `${input.expectedReason} The admission plan is denied with blocked reasons: ${input.plan.blockedReasons.join(', ')}.`;
  }

  return `${input.expectedReason} The admission plan needs more evidence before any downstream execution may proceed.`;
}

function x402Run() {
  const { preflight, simulation } =
    simulateX402AgenticPaymentAuthorization(x402PreflightInput());
  const admission = createCryptoExecutionAdmissionPlan({
    simulation,
    createdAt: '2026-04-22T12:04:00.000Z',
    integrationRef: 'integration:proof:x402-resource-server',
  });
  const receipt = admissionReceiptFor({
    plan: admission,
    preflight,
    subjectKind: 'x402-resource-server-handoff',
    outcome: 'ready-to-fulfill',
    action: 'fulfill-protected-resource',
    issuedAt: '2026-04-22T12:04:01.000Z',
  });

  return { preflight, simulation, admission, receipt };
}

function eip7702BlockedRun() {
  const { preflight, simulation } =
    simulateEip7702DelegationAuthorization(eip7702BlockedPreflightInput());
  const admission = createCryptoExecutionAdmissionPlan({
    simulation,
    createdAt: '2026-04-22T12:05:00.000Z',
    integrationRef: 'integration:proof:eip7702-runtime',
  });
  const receipt = admissionReceiptFor({
    plan: admission,
    preflight,
    subjectKind: 'delegated-eoa-runtime-handoff',
    outcome: 'blocked',
    action: 'block-delegated-execution',
    issuedAt: '2026-04-22T12:05:01.000Z',
  });

  return { preflight, simulation, admission, receipt };
}

export function runCryptoProofScenario(
  scenarioId: CryptoProofScenarioId,
): CryptoProofScenarioRun {
  const scenario = getProofScenario(scenarioId);
  if (scenario.packFamily !== 'crypto') {
    throw new Error(`Proof scenario ${scenarioId} is not a crypto scenario.`);
  }

  const result = scenarioId === 'crypto-x402-payment-admit'
    ? x402Run()
    : eip7702BlockedRun();
  const decision = admissionOutcomeToProofDecision(result.admission.outcome);

  if (decision !== scenario.expectedDecision) {
    throw new Error(
      `Crypto proof scenario ${scenarioId} expected ${scenario.expectedDecision} but produced ${decision}.`,
    );
  }

  return Object.freeze({
    version: 'attestor.proof-surface.crypto-run.v1',
    scenarioId,
    title: scenario.title,
    packFamily: 'crypto',
    categoryEntryPoint: scenario.categoryEntryPoint,
    plainLanguageHook: scenario.plainLanguageHook,
    proposedConsequence: scenario.proposedConsequence,
    checks: scenario.checks,
    expectedDecision: scenario.expectedDecision,
    decision,
    reason: buildReason({
      expectedReason: scenario.expectedReason,
      plan: result.admission,
      receipt: result.receipt,
    }),
    preflight: summarizePreflight(result.preflight),
    simulation: summarizeSimulation(result.simulation),
    admission: summarizeAdmission(result.admission),
    admissionReceipt: result.receipt,
    proofMaterials: scenario.proofMaterials,
    failClosed: result.admission.outcome !== 'admit',
  });
}

export function runCryptoProofScenarios(): readonly CryptoProofScenarioRun[] {
  return Object.freeze(
    CRYPTO_PROOF_SCENARIO_IDS.map((scenarioId) =>
      runCryptoProofScenario(scenarioId),
    ),
  );
}
