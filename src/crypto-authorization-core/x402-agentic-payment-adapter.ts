import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  CryptoAuthorizationIntent,
} from './object-model.js';
import type {
  CryptoConsequenceRiskAssessment,
} from './consequence-risk-mapping.js';
import type { CryptoReleaseDecisionBinding } from './release-decision-binding.js';
import type { CryptoPolicyControlPlaneScopeBinding } from './policy-control-plane-scope-binding.js';
import type { CryptoEnforcementVerificationBinding } from './enforcement-plane-verification.js';
import {
  createCryptoAuthorizationSimulation,
  type CryptoAuthorizationSimulationResult,
  type CryptoSimulationPreflightSignal,
} from './authorization-simulation.js';

/**
 * x402 agentic payment adapter.
 *
 * Step 18 keeps HTTP-native payment protocol details outside the core object
 * model while making the payment quote, signed payload, facilitator, replay,
 * budget, cadence, recipient, privacy, settlement, and Attestor release
 * evidence explicit before an autonomous agent may pay for an HTTP resource.
 */

export const X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION =
  'attestor.crypto-x402-agentic-payment-adapter.v1';

export const X402_PROTOCOL_VERSION = 2;
export const X402_HTTP_PAYMENT_REQUIRED_STATUS = 402;
export const X402_PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const X402_PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const X402_PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

export const X402_TRANSPORTS = ['http'] as const;
export type X402Transport = typeof X402_TRANSPORTS[number];

export const X402_PAYMENT_SCHEMES = ['exact'] as const;
export type X402PaymentScheme = typeof X402_PAYMENT_SCHEMES[number];

export const X402_NETWORK_NAMESPACES = ['eip155', 'solana'] as const;
export type X402NetworkNamespace = typeof X402_NETWORK_NAMESPACES[number];

export const X402_EXACT_AUTHORIZATION_MODES = [
  'eip-3009-transfer-with-authorization',
  'permit2-transfer',
  'svm-transfer-checked',
] as const;
export type X402ExactAuthorizationMode =
  typeof X402_EXACT_AUTHORIZATION_MODES[number];

export const X402_FACILITATOR_PATHS = [
  'facilitator-verify-settle',
  'self-hosted-facilitator',
  'local-verify-facilitator-settle',
] as const;
export type X402FacilitatorPath = typeof X402_FACILITATOR_PATHS[number];

export const X402_OUTCOMES = [
  'allow',
  'review-required',
  'block',
] as const;
export type X402Outcome = typeof X402_OUTCOMES[number];

export const X402_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
] as const;
export type X402ObservationStatus = typeof X402_OBSERVATION_STATUSES[number];

export const X402_CHECKS = [
  'x402-adapter-kind',
  'x402-agent-payment-intent',
  'x402-agent-identity-bound',
  'x402-protocol-version',
  'x402-http-transport',
  'x402-payment-required-header',
  'x402-resource-bound',
  'x402-accepts-selection',
  'x402-caip2-network-bound',
  'x402-exact-scheme-bound',
  'x402-asset-bound',
  'x402-recipient-bound',
  'x402-amount-bound',
  'x402-time-window-bound',
  'x402-payment-signature-payload',
  'x402-exact-authorization-bound',
  'x402-replay-and-idempotency',
  'x402-agent-budget-cadence',
  'x402-service-trust-posture',
  'x402-facilitator-support',
  'x402-facilitator-verify',
  'x402-settlement-posture',
  'x402-privacy-metadata-posture',
  'x402-release-binding-ready',
  'x402-policy-binding-ready',
  'x402-enforcement-binding-ready',
] as const;
export type X402Check = typeof X402_CHECKS[number];

export interface X402ResourceEvidence {
  readonly transport: X402Transport | string;
  readonly observedAt: string;
  readonly method: string;
  readonly resourceUrl: string;
  readonly statusCode: number;
  readonly paymentRequiredHeaderPresent: boolean;
  readonly paymentRequiredHeaderDecoded: boolean;
  readonly responseBodyMatchesHeader: boolean;
  readonly description?: string | null;
  readonly mimeType?: string | null;
  readonly routeId?: string | null;
}

export interface X402PaymentRequirementsEvidence {
  readonly x402Version: number;
  readonly acceptsCount: number;
  readonly selectedAcceptIndex: number;
  readonly scheme: X402PaymentScheme | string;
  readonly network: string;
  readonly amount: string;
  readonly asset: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extraName?: string | null;
  readonly extraVersion?: string | null;
  readonly requirementsHash?: string | null;
  readonly extensionsAdvertised?: readonly string[] | null;
}

export interface X402ExactAuthorizationEvidence {
  readonly mode: X402ExactAuthorizationMode | string;
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly validAfterEpochSeconds: string;
  readonly validBeforeEpochSeconds: string;
  readonly nonce: string;
  readonly signature: string;
  readonly signatureValid: boolean;
  readonly domainName?: string | null;
  readonly domainVersion?: string | null;
  readonly domainChainId?: string | null;
  readonly verifyingContract?: string | null;
  readonly nonceUnused: boolean;
  readonly balanceSufficient: boolean;
  readonly transferSimulationSucceeded: boolean;
}

export interface X402PaymentPayloadEvidence {
  readonly x402Version: number;
  readonly paymentSignatureHeaderPresent: boolean;
  readonly payloadHash?: string | null;
  readonly resourceMatchesRequirements: boolean;
  readonly acceptedMatchesRequirements: boolean;
  readonly payer: string;
  readonly scheme: X402PaymentScheme | string;
  readonly network: string;
  readonly amount: string;
  readonly asset: string;
  readonly payTo: string;
  readonly authorization: X402ExactAuthorizationEvidence;
  readonly extensionsEchoed: boolean;
}

export interface X402FacilitatorEvidence {
  readonly path: X402FacilitatorPath | string;
  readonly facilitatorUrl: string;
  readonly supportedChecked: boolean;
  readonly supportedKindAdvertised: boolean;
  readonly signerTrusted: boolean;
  readonly verifyRequested: boolean;
  readonly verifyResponseValid: boolean;
  readonly verifyInvalidReason?: string | null;
  readonly verifyPayer?: string | null;
  readonly settleRequested: boolean;
  readonly settleResponseSuccess: boolean | null;
  readonly settlementTransaction?: string | null;
  readonly settlementNetwork?: string | null;
  readonly settlementPayer?: string | null;
  readonly settlementAmount?: string | null;
  readonly paymentResponseHeaderPresent: boolean;
}

export interface X402AgentBudgetEvidence {
  readonly agentId: string;
  readonly budgetId: string;
  readonly spendLimitAtomic: string;
  readonly spendUsedAtomic: string;
  readonly proposedSpendAtomic: string;
  readonly cadence: string;
  readonly requestsUsedInWindow: number;
  readonly maxRequestsInWindow: number;
  readonly idempotencyKey: string;
  readonly idempotencyFresh: boolean;
  readonly duplicatePaymentDetected: boolean;
  readonly correlationId?: string | null;
}

export interface X402ServiceTrustEvidence {
  readonly merchantId: string;
  readonly serviceDiscoveryRef?: string | null;
  readonly resourceOriginAllowlisted: boolean;
  readonly payToAllowlisted: boolean;
  readonly assetAllowlisted: boolean;
  readonly networkAllowlisted: boolean;
  readonly priceMatchesCatalog: boolean;
}

export interface X402PrivacyMetadataEvidence {
  readonly metadataScanned: boolean;
  readonly piiDetected: boolean;
  readonly piiRedacted: boolean;
  readonly sensitiveQueryDetected: boolean;
  readonly sensitiveQueryRedacted: boolean;
  readonly metadataMinimized: boolean;
  readonly facilitatorDataMinimized: boolean;
  readonly reasonStringPiiDetected?: boolean | null;
}

export interface X402Observation {
  readonly check: X402Check;
  readonly status: X402ObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateX402AgenticPaymentPreflightInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly resource: X402ResourceEvidence;
  readonly paymentRequirements: X402PaymentRequirementsEvidence;
  readonly paymentPayload: X402PaymentPayloadEvidence;
  readonly facilitator: X402FacilitatorEvidence;
  readonly budget: X402AgentBudgetEvidence;
  readonly serviceTrust: X402ServiceTrustEvidence;
  readonly privacy: X402PrivacyMetadataEvidence;
  readonly preflightId?: string | null;
}

export interface X402AgenticPaymentPreflight {
  readonly version: typeof X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION;
  readonly preflightId: string;
  readonly adapterKind: 'x402-payment';
  readonly checkedAt: string;
  readonly x402Version: typeof X402_PROTOCOL_VERSION;
  readonly transport: X402Transport;
  readonly resourceUrl: string;
  readonly method: string;
  readonly payer: string;
  readonly payTo: string;
  readonly network: string;
  readonly scheme: X402PaymentScheme;
  readonly asset: string;
  readonly amount: string;
  readonly budgetId: string;
  readonly idempotencyKey: string;
  readonly outcome: X402Outcome;
  readonly signal: CryptoSimulationPreflightSignal;
  readonly observations: readonly X402Observation[];
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface X402AgenticPaymentSimulationResult {
  readonly preflight: X402AgenticPaymentPreflight;
  readonly simulation: CryptoAuthorizationSimulationResult;
}

export interface X402AgenticPaymentAdapterDescriptor {
  readonly version: typeof X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION;
  readonly adapterKind: 'x402-payment';
  readonly protocolVersion: typeof X402_PROTOCOL_VERSION;
  readonly paymentRequiredStatus: typeof X402_HTTP_PAYMENT_REQUIRED_STATUS;
  readonly headers: {
    readonly paymentRequired: typeof X402_PAYMENT_REQUIRED_HEADER;
    readonly paymentSignature: typeof X402_PAYMENT_SIGNATURE_HEADER;
    readonly paymentResponse: typeof X402_PAYMENT_RESPONSE_HEADER;
  };
  readonly transports: typeof X402_TRANSPORTS;
  readonly schemes: typeof X402_PAYMENT_SCHEMES;
  readonly networkNamespaces: typeof X402_NETWORK_NAMESPACES;
  readonly authorizationModes: typeof X402_EXACT_AUTHORIZATION_MODES;
  readonly facilitatorPaths: typeof X402_FACILITATOR_PATHS;
  readonly outcomes: typeof X402_OUTCOMES;
  readonly checks: typeof X402_CHECKS;
  readonly references: readonly string[];
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`x402 agentic payment adapter ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeUrl(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  try {
    const url = new URL(normalized);
    return url.toString();
  } catch {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be a URL.`);
  }
}

function normalizeHttpsUrl(value: string, fieldName: string): string {
  const normalized = normalizeUrl(value, fieldName);
  if (!normalized.startsWith('https://')) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must use https.`);
  }
  return normalized;
}

function normalizeMethod(value: string): string {
  const normalized = normalizeIdentifier(value, 'method').toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) {
    throw new Error('x402 agentic payment adapter method must be an HTTP token.');
  }
  return normalized;
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be a 32-byte hex value.`);
  }
  return normalized.toLowerCase();
}

function normalizeOptionalHash(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeHash(value, fieldName);
}

function normalizeSignature(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]+$/.test(normalized) || normalized.length < 132) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be a hex signature.`);
  }
  return normalized.toLowerCase();
}

function normalizeEvmAddress(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be an EVM address.`);
  }
  return normalized.toLowerCase();
}

function normalizeSolanaAddress(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalized)) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be a Solana base58 address.`);
  }
  return normalized;
}

function namespaceForNetwork(network: string): X402NetworkNamespace | null {
  const [namespace] = network.split(':', 1);
  return X402_NETWORK_NAMESPACES.includes(namespace as X402NetworkNamespace)
    ? namespace as X402NetworkNamespace
    : null;
}

function normalizeCaip2Network(value: string): string {
  const normalized = normalizeIdentifier(value, 'network');
  if (!/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(normalized)) {
    throw new Error('x402 agentic payment adapter network must be CAIP-2.');
  }
  if (!namespaceForNetwork(normalized)) {
    throw new Error('x402 agentic payment adapter network namespace is unsupported.');
  }
  return normalized;
}

function normalizePaymentAddress(value: string, network: string, fieldName: string): string {
  const namespace = namespaceForNetwork(network);
  if (namespace === 'eip155') {
    return normalizeEvmAddress(value, fieldName);
  }
  if (namespace === 'solana') {
    return normalizeSolanaAddress(value, fieldName);
  }
  return normalizeIdentifier(value, fieldName);
}

function normalizeAtomicUnits(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be atomic integer units.`);
  }
  return normalized;
}

function parseAtomicUnits(value: string, fieldName: string): bigint {
  return BigInt(normalizeAtomicUnits(value, fieldName));
}

function normalizeEpochSeconds(value: string, fieldName: string): string {
  const normalized = normalizeAtomicUnits(value, fieldName);
  const parsed = BigInt(normalized);
  if (parsed <= 0n) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be positive.`);
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`x402 agentic payment adapter ${fieldName} must be a positive safe integer.`);
  }
  return value;
}

function normalizeStringList(
  values: readonly string[] | null | undefined,
): readonly string[] {
  if (!values) {
    return Object.freeze([]);
  }
  return Object.freeze(
    Array.from(new Set(values.map((entry) => normalizeIdentifier(entry, 'string list entry')))),
  );
}

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

function normalizeResource(input: X402ResourceEvidence): X402ResourceEvidence {
  const transport = normalizeIdentifier(input.transport, 'resource.transport');
  if (!includesValue(X402_TRANSPORTS, transport)) {
    throw new Error('x402 agentic payment adapter currently supports HTTP transport only.');
  }
  return Object.freeze({
    transport,
    observedAt: normalizeIsoTimestamp(input.observedAt, 'resource.observedAt'),
    method: normalizeMethod(input.method),
    resourceUrl: normalizeHttpsUrl(input.resourceUrl, 'resource.resourceUrl'),
    statusCode: normalizeNonNegativeInteger(input.statusCode, 'resource.statusCode'),
    paymentRequiredHeaderPresent: Boolean(input.paymentRequiredHeaderPresent),
    paymentRequiredHeaderDecoded: Boolean(input.paymentRequiredHeaderDecoded),
    responseBodyMatchesHeader: Boolean(input.responseBodyMatchesHeader),
    description: normalizeOptionalIdentifier(input.description, 'resource.description'),
    mimeType: normalizeOptionalIdentifier(input.mimeType, 'resource.mimeType'),
    routeId: normalizeOptionalIdentifier(input.routeId, 'resource.routeId'),
  });
}

function normalizeRequirements(
  input: X402PaymentRequirementsEvidence,
): X402PaymentRequirementsEvidence {
  const network = normalizeCaip2Network(input.network);
  return Object.freeze({
    x402Version: normalizePositiveInteger(input.x402Version, 'requirements.x402Version'),
    acceptsCount: normalizePositiveInteger(input.acceptsCount, 'requirements.acceptsCount'),
    selectedAcceptIndex: normalizeNonNegativeInteger(
      input.selectedAcceptIndex,
      'requirements.selectedAcceptIndex',
    ),
    scheme: normalizeIdentifier(input.scheme, 'requirements.scheme'),
    network,
    amount: normalizeAtomicUnits(input.amount, 'requirements.amount'),
    asset: normalizeIdentifier(input.asset, 'requirements.asset'),
    payTo: normalizePaymentAddress(input.payTo, network, 'requirements.payTo'),
    maxTimeoutSeconds: normalizePositiveInteger(
      input.maxTimeoutSeconds,
      'requirements.maxTimeoutSeconds',
    ),
    extraName: normalizeOptionalIdentifier(input.extraName, 'requirements.extraName'),
    extraVersion: normalizeOptionalIdentifier(input.extraVersion, 'requirements.extraVersion'),
    requirementsHash: normalizeOptionalHash(input.requirementsHash, 'requirements.requirementsHash'),
    extensionsAdvertised: normalizeStringList(input.extensionsAdvertised),
  });
}

function normalizeAuthorization(
  input: X402ExactAuthorizationEvidence,
  network: string,
): X402ExactAuthorizationEvidence {
  return Object.freeze({
    mode: normalizeIdentifier(input.mode, 'authorization.mode'),
    from: normalizePaymentAddress(input.from, network, 'authorization.from'),
    to: normalizePaymentAddress(input.to, network, 'authorization.to'),
    value: normalizeAtomicUnits(input.value, 'authorization.value'),
    validAfterEpochSeconds: normalizeEpochSeconds(
      input.validAfterEpochSeconds,
      'authorization.validAfterEpochSeconds',
    ),
    validBeforeEpochSeconds: normalizeEpochSeconds(
      input.validBeforeEpochSeconds,
      'authorization.validBeforeEpochSeconds',
    ),
    nonce: normalizeHash(input.nonce, 'authorization.nonce'),
    signature: normalizeSignature(input.signature, 'authorization.signature'),
    signatureValid: Boolean(input.signatureValid),
    domainName: normalizeOptionalIdentifier(input.domainName, 'authorization.domainName'),
    domainVersion: normalizeOptionalIdentifier(input.domainVersion, 'authorization.domainVersion'),
    domainChainId: normalizeOptionalIdentifier(input.domainChainId, 'authorization.domainChainId'),
    verifyingContract: namespaceForNetwork(network) === 'eip155'
      ? normalizeOptionalIdentifier(input.verifyingContract, 'authorization.verifyingContract')
      : normalizeOptionalIdentifier(input.verifyingContract, 'authorization.verifyingContract'),
    nonceUnused: Boolean(input.nonceUnused),
    balanceSufficient: Boolean(input.balanceSufficient),
    transferSimulationSucceeded: Boolean(input.transferSimulationSucceeded),
  });
}

function normalizePayload(
  input: X402PaymentPayloadEvidence,
  requirements: X402PaymentRequirementsEvidence,
): X402PaymentPayloadEvidence {
  const network = normalizeCaip2Network(input.network);
  const authorization = normalizeAuthorization(input.authorization, network);
  return Object.freeze({
    x402Version: normalizePositiveInteger(input.x402Version, 'payload.x402Version'),
    paymentSignatureHeaderPresent: Boolean(input.paymentSignatureHeaderPresent),
    payloadHash: normalizeOptionalHash(input.payloadHash, 'payload.payloadHash'),
    resourceMatchesRequirements: Boolean(input.resourceMatchesRequirements),
    acceptedMatchesRequirements: Boolean(input.acceptedMatchesRequirements),
    payer: normalizePaymentAddress(input.payer, network, 'payload.payer'),
    scheme: normalizeIdentifier(input.scheme, 'payload.scheme'),
    network,
    amount: normalizeAtomicUnits(input.amount, 'payload.amount'),
    asset: normalizeIdentifier(input.asset, 'payload.asset'),
    payTo: normalizePaymentAddress(input.payTo, network, 'payload.payTo'),
    authorization,
    extensionsEchoed:
      normalizeStringList(requirements.extensionsAdvertised).length === 0 ||
      Boolean(input.extensionsEchoed),
  });
}

function normalizeFacilitator(input: X402FacilitatorEvidence): X402FacilitatorEvidence {
  return Object.freeze({
    path: normalizeIdentifier(input.path, 'facilitator.path'),
    facilitatorUrl: normalizeHttpsUrl(input.facilitatorUrl, 'facilitator.facilitatorUrl'),
    supportedChecked: Boolean(input.supportedChecked),
    supportedKindAdvertised: Boolean(input.supportedKindAdvertised),
    signerTrusted: Boolean(input.signerTrusted),
    verifyRequested: Boolean(input.verifyRequested),
    verifyResponseValid: Boolean(input.verifyResponseValid),
    verifyInvalidReason: normalizeOptionalIdentifier(
      input.verifyInvalidReason,
      'facilitator.verifyInvalidReason',
    ),
    verifyPayer: normalizeOptionalIdentifier(input.verifyPayer, 'facilitator.verifyPayer'),
    settleRequested: Boolean(input.settleRequested),
    settleResponseSuccess:
      input.settleResponseSuccess === null ? null : Boolean(input.settleResponseSuccess),
    settlementTransaction: normalizeOptionalIdentifier(
      input.settlementTransaction,
      'facilitator.settlementTransaction',
    ),
    settlementNetwork: input.settlementNetwork
      ? normalizeCaip2Network(input.settlementNetwork)
      : null,
    settlementPayer: normalizeOptionalIdentifier(
      input.settlementPayer,
      'facilitator.settlementPayer',
    ),
    settlementAmount: input.settlementAmount
      ? normalizeAtomicUnits(input.settlementAmount, 'facilitator.settlementAmount')
      : null,
    paymentResponseHeaderPresent: Boolean(input.paymentResponseHeaderPresent),
  });
}

function normalizeBudget(input: X402AgentBudgetEvidence): X402AgentBudgetEvidence {
  return Object.freeze({
    agentId: normalizeIdentifier(input.agentId, 'budget.agentId'),
    budgetId: normalizeIdentifier(input.budgetId, 'budget.budgetId'),
    spendLimitAtomic: normalizeAtomicUnits(input.spendLimitAtomic, 'budget.spendLimitAtomic'),
    spendUsedAtomic: normalizeAtomicUnits(input.spendUsedAtomic, 'budget.spendUsedAtomic'),
    proposedSpendAtomic: normalizeAtomicUnits(
      input.proposedSpendAtomic,
      'budget.proposedSpendAtomic',
    ),
    cadence: normalizeIdentifier(input.cadence, 'budget.cadence'),
    requestsUsedInWindow: normalizeNonNegativeInteger(
      input.requestsUsedInWindow,
      'budget.requestsUsedInWindow',
    ),
    maxRequestsInWindow: normalizePositiveInteger(
      input.maxRequestsInWindow,
      'budget.maxRequestsInWindow',
    ),
    idempotencyKey: normalizeIdentifier(input.idempotencyKey, 'budget.idempotencyKey'),
    idempotencyFresh: Boolean(input.idempotencyFresh),
    duplicatePaymentDetected: Boolean(input.duplicatePaymentDetected),
    correlationId: normalizeOptionalIdentifier(input.correlationId, 'budget.correlationId'),
  });
}

function normalizeServiceTrust(input: X402ServiceTrustEvidence): X402ServiceTrustEvidence {
  return Object.freeze({
    merchantId: normalizeIdentifier(input.merchantId, 'serviceTrust.merchantId'),
    serviceDiscoveryRef: normalizeOptionalIdentifier(
      input.serviceDiscoveryRef,
      'serviceTrust.serviceDiscoveryRef',
    ),
    resourceOriginAllowlisted: Boolean(input.resourceOriginAllowlisted),
    payToAllowlisted: Boolean(input.payToAllowlisted),
    assetAllowlisted: Boolean(input.assetAllowlisted),
    networkAllowlisted: Boolean(input.networkAllowlisted),
    priceMatchesCatalog: Boolean(input.priceMatchesCatalog),
  });
}

function normalizePrivacy(input: X402PrivacyMetadataEvidence): X402PrivacyMetadataEvidence {
  return Object.freeze({
    metadataScanned: Boolean(input.metadataScanned),
    piiDetected: Boolean(input.piiDetected),
    piiRedacted: Boolean(input.piiRedacted),
    sensitiveQueryDetected: Boolean(input.sensitiveQueryDetected),
    sensitiveQueryRedacted: Boolean(input.sensitiveQueryRedacted),
    metadataMinimized: Boolean(input.metadataMinimized),
    facilitatorDataMinimized: Boolean(input.facilitatorDataMinimized),
    reasonStringPiiDetected: input.reasonStringPiiDetected === true,
  });
}

function canonicalObject<T extends CanonicalReleaseJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  const canonical = canonicalizeReleaseJson(value);
  return Object.freeze({
    canonical,
    digest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
  });
}

function caip2ChainId(intent: CryptoAuthorizationIntent): string {
  return `${intent.chain.namespace}:${intent.chain.chainId}`;
}

function samePaymentAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  if (left.startsWith('0x') || right.startsWith('0x')) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function sameString(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
}

function resourceOrigin(resourceUrl: string): string {
  const url = new URL(resourceUrl);
  return url.origin;
}

function intentMaxAmountReady(intent: CryptoAuthorizationIntent, amount: string): boolean {
  if (!intent.constraints.maxAmount) {
    return true;
  }
  return parseAtomicUnits(amount, 'amount') <= parseAtomicUnits(intent.constraints.maxAmount, 'intent.maxAmount');
}

function selectedAcceptReady(requirements: X402PaymentRequirementsEvidence): boolean {
  return (
    requirements.acceptsCount > 0 &&
    requirements.selectedAcceptIndex >= 0 &&
    requirements.selectedAcceptIndex < requirements.acceptsCount
  );
}

function expectedAuthorizationModeReady(
  mode: string,
  network: string,
  asset: string,
): boolean {
  const namespace = namespaceForNetwork(network);
  if (!includesValue(X402_EXACT_AUTHORIZATION_MODES, mode)) {
    return false;
  }
  if (namespace === 'eip155') {
    return (
      mode === 'eip-3009-transfer-with-authorization' ||
      mode === 'permit2-transfer'
    );
  }
  if (namespace === 'solana') {
    return mode === 'svm-transfer-checked' && asset.length > 0;
  }
  return false;
}

function authorizationWindowSeconds(authorization: X402ExactAuthorizationEvidence): bigint {
  return (
    BigInt(authorization.validBeforeEpochSeconds) -
    BigInt(authorization.validAfterEpochSeconds)
  );
}

function authorizationWithinIntentWindow(
  authorization: X402ExactAuthorizationEvidence,
  intent: CryptoAuthorizationIntent,
): boolean {
  const validAfter = Number(authorization.validAfterEpochSeconds) * 1000;
  const validBefore = Number(authorization.validBeforeEpochSeconds) * 1000;
  const intentValidAfter = new Date(intent.constraints.validAfter).getTime();
  const intentValidUntil = new Date(intent.constraints.validUntil).getTime();
  return (
    Number.isFinite(validAfter) &&
    Number.isFinite(validBefore) &&
    validAfter >= intentValidAfter &&
    validBefore <= intentValidUntil
  );
}

function budgetWithinLimit(input: {
  readonly budget: X402AgentBudgetEvidence;
  readonly requirements: X402PaymentRequirementsEvidence;
  readonly intent: CryptoAuthorizationIntent;
}): boolean {
  const spendUsed = parseAtomicUnits(input.budget.spendUsedAtomic, 'budget.spendUsedAtomic');
  const proposed = parseAtomicUnits(input.budget.proposedSpendAtomic, 'budget.proposedSpendAtomic');
  const limit = parseAtomicUnits(input.budget.spendLimitAtomic, 'budget.spendLimitAtomic');
  return (
    input.budget.budgetId === input.intent.constraints.budgetId &&
    input.budget.proposedSpendAtomic === input.requirements.amount &&
    intentMaxAmountReady(input.intent, input.requirements.amount) &&
    spendUsed + proposed <= limit &&
    input.budget.requestsUsedInWindow + 1 <= input.budget.maxRequestsInWindow &&
    input.budget.cadence === input.intent.constraints.cadence
  );
}

function privacyReady(privacy: X402PrivacyMetadataEvidence): boolean {
  const piiSafe = !privacy.piiDetected || privacy.piiRedacted;
  const querySafe = !privacy.sensitiveQueryDetected || privacy.sensitiveQueryRedacted;
  return (
    privacy.metadataScanned &&
    piiSafe &&
    querySafe &&
    privacy.metadataMinimized &&
    privacy.facilitatorDataMinimized &&
    !privacy.reasonStringPiiDetected
  );
}

function releaseReady(releaseBinding: CryptoReleaseDecisionBinding): boolean {
  return (
    releaseBinding.status === 'bound' &&
    (releaseBinding.releaseDecision.status === 'accepted' ||
      releaseBinding.releaseDecision.status === 'overridden')
  );
}

function enforcementReady(enforcementBinding: CryptoEnforcementVerificationBinding): boolean {
  return (
    enforcementBinding.adapterKind === 'x402-payment' &&
    enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind === 'action-dispatch' &&
    enforcementBinding.verificationProfile.failClosed
  );
}

function assertAdapterConsistency(input: CreateX402AgenticPaymentPreflightInput): void {
  if (input.intent.executionAdapterKind !== 'x402-payment') {
    throw new Error('x402 agentic payment adapter requires intent execution adapter x402-payment.');
  }
  if (input.riskAssessment.consequenceKind !== input.intent.consequenceKind) {
    throw new Error('x402 agentic payment adapter risk consequence does not match intent.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.policyScopeBinding.cryptoDecisionId) {
    throw new Error('x402 agentic payment adapter policy binding does not match release binding.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.enforcementBinding.cryptoDecisionId) {
    throw new Error('x402 agentic payment adapter enforcement binding does not match release binding.');
  }
  if (input.enforcementBinding.adapterKind !== 'x402-payment') {
    throw new Error('x402 agentic payment adapter requires x402-payment enforcement binding.');
  }
  if (input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind !== 'action-dispatch') {
    throw new Error('x402 agentic payment adapter requires action-dispatch enforcement.');
  }
  if (!input.enforcementBinding.verificationProfile.failClosed) {
    throw new Error('x402 agentic payment adapter requires fail-closed enforcement verification.');
  }
}

function observation(input: {
  readonly check: X402Check;
  readonly status: X402ObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): X402Observation {
  return Object.freeze({
    check: input.check,
    status: input.status,
    code: normalizeIdentifier(input.code, 'observation.code'),
    message: normalizeIdentifier(input.message, 'observation.message'),
    required: input.required ?? true,
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function buildObservations(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly resource: X402ResourceEvidence;
  readonly requirements: X402PaymentRequirementsEvidence;
  readonly payload: X402PaymentPayloadEvidence;
  readonly facilitator: X402FacilitatorEvidence;
  readonly budget: X402AgentBudgetEvidence;
  readonly serviceTrust: X402ServiceTrustEvidence;
  readonly privacy: X402PrivacyMetadataEvidence;
}): readonly X402Observation[] {
  const observations: X402Observation[] = [];
  const intentChainId = caip2ChainId(input.intent);
  const targetPayTo = input.intent.target.address ?? input.intent.target.counterparty;
  const intentAssetId = input.intent.asset?.assetId ?? null;
  const authorization = input.payload.authorization;
  const authorizationModeReady = expectedAuthorizationModeReady(
    authorization.mode,
    input.requirements.network,
    input.requirements.asset,
  );
  const timeWindowSeconds = authorizationWindowSeconds(authorization);
  const timeoutReady =
    timeWindowSeconds > 0n &&
    timeWindowSeconds <= BigInt(input.requirements.maxTimeoutSeconds) &&
    authorizationWithinIntentWindow(authorization, input.intent);
  const facilitatorPayer = input.facilitator.verifyPayer ?? input.facilitator.settlementPayer;
  const settlementReady =
    input.facilitator.settleRequested &&
    input.facilitator.settleResponseSuccess === true &&
    input.facilitator.paymentResponseHeaderPresent &&
    Boolean(input.facilitator.settlementTransaction) &&
    input.facilitator.settlementNetwork === input.requirements.network &&
    samePaymentAddress(input.facilitator.settlementPayer, input.payload.payer) &&
    input.facilitator.settlementAmount === input.requirements.amount;
  const serviceReady =
    input.serviceTrust.resourceOriginAllowlisted &&
    input.serviceTrust.payToAllowlisted &&
    input.serviceTrust.assetAllowlisted &&
    input.serviceTrust.networkAllowlisted &&
    input.serviceTrust.priceMatchesCatalog;

  observations.push(
    observation({
      check: 'x402-adapter-kind',
      status: input.intent.executionAdapterKind === 'x402-payment' ? 'pass' : 'fail',
      code: input.intent.executionAdapterKind === 'x402-payment'
        ? 'x402-adapter-kind-bound'
        : 'x402-adapter-kind-mismatch',
      message: input.intent.executionAdapterKind === 'x402-payment'
        ? 'Intent is bound to the x402 payment adapter.'
        : 'Intent is not bound to the x402 payment adapter.',
      evidence: {
        adapterKind: input.intent.executionAdapterKind ?? null,
      },
    }),
    observation({
      check: 'x402-agent-payment-intent',
      status:
        input.intent.consequenceKind === 'agent-payment' &&
        input.intent.target.targetKind === 'payee' &&
        input.intent.target.protocol === 'x402'
          ? 'pass'
          : 'fail',
      code:
        input.intent.consequenceKind === 'agent-payment' &&
        input.intent.target.targetKind === 'payee' &&
        input.intent.target.protocol === 'x402'
          ? 'x402-agent-payment-intent-bound'
          : 'x402-agent-payment-intent-mismatch',
      message:
        input.intent.consequenceKind === 'agent-payment' &&
        input.intent.target.targetKind === 'payee' &&
        input.intent.target.protocol === 'x402'
          ? 'Intent is a protocol-bound agent payment to an x402 payee.'
          : 'x402 payment execution requires an agent-payment intent targeting an x402 payee.',
      evidence: {
        consequenceKind: input.intent.consequenceKind,
        targetKind: input.intent.target.targetKind,
        protocol: input.intent.target.protocol ?? null,
      },
    }),
    observation({
      check: 'x402-agent-identity-bound',
      status:
        input.intent.requester.actorKind === 'agent' &&
        input.budget.agentId === input.intent.requester.actorId
          ? 'pass'
          : 'fail',
      code:
        input.intent.requester.actorKind === 'agent' &&
        input.budget.agentId === input.intent.requester.actorId
          ? 'x402-agent-identity-bound'
          : 'x402-agent-identity-mismatch',
      message:
        input.intent.requester.actorKind === 'agent' &&
        input.budget.agentId === input.intent.requester.actorId
          ? 'The paying agent identity is bound to the Attestor intent and budget ledger.'
          : 'x402 agent payment requires the same agent identity in the intent and budget evidence.',
      evidence: {
        requesterKind: input.intent.requester.actorKind,
        requesterId: input.intent.requester.actorId,
        budgetAgentId: input.budget.agentId,
      },
    }),
    observation({
      check: 'x402-protocol-version',
      status:
        input.requirements.x402Version === X402_PROTOCOL_VERSION &&
        input.payload.x402Version === X402_PROTOCOL_VERSION
          ? 'pass'
          : 'fail',
      code:
        input.requirements.x402Version === X402_PROTOCOL_VERSION &&
        input.payload.x402Version === X402_PROTOCOL_VERSION
          ? 'x402-protocol-version-v2'
          : 'x402-protocol-version-mismatch',
      message:
        input.requirements.x402Version === X402_PROTOCOL_VERSION &&
        input.payload.x402Version === X402_PROTOCOL_VERSION
          ? 'Payment requirement and payment payload use x402 protocol version 2.'
          : 'x402 payment requirement and payload must both use protocol version 2.',
      evidence: {
        requiredVersion: input.requirements.x402Version,
        payloadVersion: input.payload.x402Version,
      },
    }),
    observation({
      check: 'x402-http-transport',
      status:
        input.resource.transport === 'http' &&
        input.resource.statusCode === X402_HTTP_PAYMENT_REQUIRED_STATUS
          ? 'pass'
          : 'fail',
      code:
        input.resource.transport === 'http' &&
        input.resource.statusCode === X402_HTTP_PAYMENT_REQUIRED_STATUS
          ? 'x402-http-402-observed'
          : 'x402-http-402-missing',
      message:
        input.resource.transport === 'http' &&
        input.resource.statusCode === X402_HTTP_PAYMENT_REQUIRED_STATUS
          ? 'HTTP transport observed a 402 Payment Required response.'
          : 'x402 HTTP transport must observe a 402 Payment Required response.',
      evidence: {
        transport: input.resource.transport,
        statusCode: input.resource.statusCode,
      },
    }),
    observation({
      check: 'x402-payment-required-header',
      status:
        input.resource.paymentRequiredHeaderPresent &&
        input.resource.paymentRequiredHeaderDecoded &&
        input.resource.responseBodyMatchesHeader
          ? 'pass'
          : 'fail',
      code:
        input.resource.paymentRequiredHeaderPresent &&
        input.resource.paymentRequiredHeaderDecoded &&
        input.resource.responseBodyMatchesHeader
          ? 'x402-payment-required-header-bound'
          : 'x402-payment-required-header-invalid',
      message:
        input.resource.paymentRequiredHeaderPresent &&
        input.resource.paymentRequiredHeaderDecoded &&
        input.resource.responseBodyMatchesHeader
          ? 'PAYMENT-REQUIRED was present, decoded, and matched the response body.'
          : 'PAYMENT-REQUIRED must be present, decodable, and consistent with the response body.',
      evidence: {
        header: X402_PAYMENT_REQUIRED_HEADER,
        present: input.resource.paymentRequiredHeaderPresent,
        decoded: input.resource.paymentRequiredHeaderDecoded,
        bodyMatchesHeader: input.resource.responseBodyMatchesHeader,
      },
    }),
    observation({
      check: 'x402-resource-bound',
      status:
        input.resource.resourceUrl === input.intent.target.targetId &&
        input.payload.resourceMatchesRequirements
          ? 'pass'
          : 'fail',
      code:
        input.resource.resourceUrl === input.intent.target.targetId &&
        input.payload.resourceMatchesRequirements
          ? 'x402-resource-bound'
          : 'x402-resource-mismatch',
      message:
        input.resource.resourceUrl === input.intent.target.targetId &&
        input.payload.resourceMatchesRequirements
          ? 'Resource URL is bound to the intent and echoed by the payment payload.'
          : 'x402 resource URL must match the Attestor intent and payment payload.',
      evidence: {
        resourceUrl: input.resource.resourceUrl,
        intentTargetId: input.intent.target.targetId,
        origin: resourceOrigin(input.resource.resourceUrl),
        payloadResourceMatches: input.payload.resourceMatchesRequirements,
      },
    }),
    observation({
      check: 'x402-accepts-selection',
      status:
        selectedAcceptReady(input.requirements) &&
        input.payload.acceptedMatchesRequirements &&
        input.payload.extensionsEchoed
          ? 'pass'
          : 'fail',
      code:
        selectedAcceptReady(input.requirements) &&
        input.payload.acceptedMatchesRequirements &&
        input.payload.extensionsEchoed
          ? 'x402-accepts-selection-bound'
          : 'x402-accepts-selection-invalid',
      message:
        selectedAcceptReady(input.requirements) &&
        input.payload.acceptedMatchesRequirements &&
        input.payload.extensionsEchoed
          ? 'The selected accepts entry is in range and echoed by the payment payload.'
          : 'x402 accepted payment requirement must be selected, echoed, and extension-preserving.',
      evidence: {
        acceptsCount: input.requirements.acceptsCount,
        selectedAcceptIndex: input.requirements.selectedAcceptIndex,
        acceptedMatchesRequirements: input.payload.acceptedMatchesRequirements,
        extensionsAdvertised: input.requirements.extensionsAdvertised ?? [],
        extensionsEchoed: input.payload.extensionsEchoed,
      },
    }),
    observation({
      check: 'x402-caip2-network-bound',
      status:
        input.requirements.network === intentChainId &&
        input.payload.network === input.requirements.network
          ? 'pass'
          : 'fail',
      code:
        input.requirements.network === intentChainId &&
        input.payload.network === input.requirements.network
          ? 'x402-caip2-network-bound'
          : 'x402-caip2-network-mismatch',
      message:
        input.requirements.network === intentChainId &&
        input.payload.network === input.requirements.network
          ? 'Payment network is CAIP-2 bound to the Attestor intent chain.'
          : 'x402 payment network must match the Attestor intent chain and payload.',
      evidence: {
        intentChainId,
        requirementNetwork: input.requirements.network,
        payloadNetwork: input.payload.network,
      },
    }),
    observation({
      check: 'x402-exact-scheme-bound',
      status:
        input.requirements.scheme === 'exact' &&
        input.payload.scheme === 'exact'
          ? 'pass'
          : 'fail',
      code:
        input.requirements.scheme === 'exact' &&
        input.payload.scheme === 'exact'
          ? 'x402-exact-scheme-bound'
          : 'x402-exact-scheme-required',
      message:
        input.requirements.scheme === 'exact' &&
        input.payload.scheme === 'exact'
          ? 'The x402 exact payment scheme is bound in requirement and payload.'
          : 'This adapter only allows x402 exact scheme payments.',
      evidence: {
        requirementScheme: input.requirements.scheme,
        payloadScheme: input.payload.scheme,
      },
    }),
    observation({
      check: 'x402-asset-bound',
      status:
        input.payload.asset === input.requirements.asset &&
        (!intentAssetId || sameString(input.requirements.asset, intentAssetId))
          ? 'pass'
          : 'fail',
      code:
        input.payload.asset === input.requirements.asset &&
        (!intentAssetId || sameString(input.requirements.asset, intentAssetId))
          ? 'x402-asset-bound'
          : 'x402-asset-mismatch',
      message:
        input.payload.asset === input.requirements.asset &&
        (!intentAssetId || sameString(input.requirements.asset, intentAssetId))
          ? 'Payment asset is bound to the requirement, payload, and intent asset.'
          : 'x402 payment asset must match the requirement, payload, and Attestor intent asset.',
      evidence: {
        requirementAsset: input.requirements.asset,
        payloadAsset: input.payload.asset,
        intentAssetId,
      },
    }),
    observation({
      check: 'x402-recipient-bound',
      status:
        samePaymentAddress(input.requirements.payTo, input.payload.payTo) &&
        samePaymentAddress(input.requirements.payTo, targetPayTo)
          ? 'pass'
          : 'fail',
      code:
        samePaymentAddress(input.requirements.payTo, input.payload.payTo) &&
        samePaymentAddress(input.requirements.payTo, targetPayTo)
          ? 'x402-recipient-bound'
          : 'x402-recipient-mismatch',
      message:
        samePaymentAddress(input.requirements.payTo, input.payload.payTo) &&
        samePaymentAddress(input.requirements.payTo, targetPayTo)
          ? 'Payment recipient is bound to requirement, payload, and Attestor payee target.'
          : 'x402 payment recipient must match the quoted requirement, payload, and Attestor payee target.',
      evidence: {
        requirementPayTo: input.requirements.payTo,
        payloadPayTo: input.payload.payTo,
        intentTargetPayTo: targetPayTo ?? null,
      },
    }),
    observation({
      check: 'x402-amount-bound',
      status:
        input.payload.amount === input.requirements.amount &&
        authorization.value === input.requirements.amount &&
        intentMaxAmountReady(input.intent, input.requirements.amount)
          ? 'pass'
          : 'fail',
      code:
        input.payload.amount === input.requirements.amount &&
        authorization.value === input.requirements.amount &&
        intentMaxAmountReady(input.intent, input.requirements.amount)
          ? 'x402-amount-bound'
          : 'x402-amount-mismatch',
      message:
        input.payload.amount === input.requirements.amount &&
        authorization.value === input.requirements.amount &&
        intentMaxAmountReady(input.intent, input.requirements.amount)
          ? 'Payment amount exactly matches quote, payload authorization, and Attestor max amount.'
          : 'x402 exact payment amount must match the quote, payload authorization, and Attestor max amount.',
      evidence: {
        requirementAmount: input.requirements.amount,
        payloadAmount: input.payload.amount,
        authorizationValue: authorization.value,
        intentMaxAmount: input.intent.constraints.maxAmount ?? null,
      },
    }),
    observation({
      check: 'x402-time-window-bound',
      status: timeoutReady ? 'pass' : 'fail',
      code: timeoutReady
        ? 'x402-time-window-bound'
        : 'x402-time-window-invalid',
      message: timeoutReady
        ? 'Payment authorization validity is bounded by x402 timeout and Attestor intent validity.'
        : 'x402 payment authorization must be within maxTimeoutSeconds and the Attestor validity window.',
      evidence: {
        maxTimeoutSeconds: input.requirements.maxTimeoutSeconds,
        authorizationWindowSeconds: timeWindowSeconds.toString(),
        intentValidAfter: input.intent.constraints.validAfter,
        intentValidUntil: input.intent.constraints.validUntil,
      },
    }),
    observation({
      check: 'x402-payment-signature-payload',
      status:
        input.payload.paymentSignatureHeaderPresent &&
        input.payload.x402Version === input.requirements.x402Version &&
        input.payload.authorization.signatureValid
          ? 'pass'
          : 'fail',
      code:
        input.payload.paymentSignatureHeaderPresent &&
        input.payload.x402Version === input.requirements.x402Version &&
        input.payload.authorization.signatureValid
          ? 'x402-payment-signature-payload-bound'
          : 'x402-payment-signature-payload-invalid',
      message:
        input.payload.paymentSignatureHeaderPresent &&
        input.payload.x402Version === input.requirements.x402Version &&
        input.payload.authorization.signatureValid
          ? 'PAYMENT-SIGNATURE payload is present and signed by the payer.'
          : 'PAYMENT-SIGNATURE payload must be present, version matched, and validly signed.',
      evidence: {
        header: X402_PAYMENT_SIGNATURE_HEADER,
        present: input.payload.paymentSignatureHeaderPresent,
        payloadHash: input.payload.payloadHash ?? null,
        signatureValid: input.payload.authorization.signatureValid,
      },
    }),
    observation({
      check: 'x402-exact-authorization-bound',
      status:
        authorizationModeReady &&
        samePaymentAddress(authorization.from, input.payload.payer) &&
        samePaymentAddress(authorization.from, input.intent.account.address) &&
        samePaymentAddress(authorization.to, input.requirements.payTo) &&
        authorization.nonceUnused &&
        authorization.balanceSufficient &&
        authorization.transferSimulationSucceeded
          ? 'pass'
          : 'fail',
      code:
        authorizationModeReady &&
        samePaymentAddress(authorization.from, input.payload.payer) &&
        samePaymentAddress(authorization.from, input.intent.account.address) &&
        samePaymentAddress(authorization.to, input.requirements.payTo) &&
        authorization.nonceUnused &&
        authorization.balanceSufficient &&
        authorization.transferSimulationSucceeded
          ? 'x402-exact-authorization-bound'
          : 'x402-exact-authorization-invalid',
      message:
        authorizationModeReady &&
        samePaymentAddress(authorization.from, input.payload.payer) &&
        samePaymentAddress(authorization.from, input.intent.account.address) &&
        samePaymentAddress(authorization.to, input.requirements.payTo) &&
        authorization.nonceUnused &&
        authorization.balanceSufficient &&
        authorization.transferSimulationSucceeded
          ? 'Exact payment authorization is payer-bound, recipient-bound, unused, funded, and simulated.'
          : 'Exact payment authorization must bind payer, recipient, nonce, balance, and transfer simulation.',
      evidence: {
        mode: authorization.mode,
        from: authorization.from,
        payer: input.payload.payer,
        intentAccount: input.intent.account.address,
        to: authorization.to,
        nonceUnused: authorization.nonceUnused,
        balanceSufficient: authorization.balanceSufficient,
        transferSimulationSucceeded: authorization.transferSimulationSucceeded,
      },
    }),
    observation({
      check: 'x402-replay-and-idempotency',
      status:
        input.budget.idempotencyFresh &&
        !input.budget.duplicatePaymentDetected &&
        authorization.nonce === input.intent.constraints.nonce
          ? 'pass'
          : 'fail',
      code:
        input.budget.idempotencyFresh &&
        !input.budget.duplicatePaymentDetected &&
        authorization.nonce === input.intent.constraints.nonce
          ? 'x402-replay-and-idempotency-fresh'
          : 'x402-replay-or-idempotency-risk',
      message:
        input.budget.idempotencyFresh &&
        !input.budget.duplicatePaymentDetected &&
        authorization.nonce === input.intent.constraints.nonce
          ? 'Payment nonce and idempotency key are fresh and bound to the Attestor intent.'
          : 'x402 payment must not reuse a nonce, idempotency key, or previously detected duplicate payment.',
      evidence: {
        intentNonce: input.intent.constraints.nonce,
        authorizationNonce: authorization.nonce,
        idempotencyKey: input.budget.idempotencyKey,
        idempotencyFresh: input.budget.idempotencyFresh,
        duplicatePaymentDetected: input.budget.duplicatePaymentDetected,
      },
    }),
    observation({
      check: 'x402-agent-budget-cadence',
      status: budgetWithinLimit({
        budget: input.budget,
        requirements: input.requirements,
        intent: input.intent,
      })
        ? 'pass'
        : 'fail',
      code: budgetWithinLimit({
        budget: input.budget,
        requirements: input.requirements,
        intent: input.intent,
      })
        ? 'x402-agent-budget-cadence-bound'
        : 'x402-agent-budget-cadence-exceeded',
      message: budgetWithinLimit({
        budget: input.budget,
        requirements: input.requirements,
        intent: input.intent,
      })
        ? 'Agent budget, cadence, and request-count controls admit this payment.'
        : 'x402 agent payment exceeds or mismatches budget, cadence, amount, or request-count controls.',
      evidence: {
        budgetId: input.budget.budgetId,
        intentBudgetId: input.intent.constraints.budgetId ?? null,
        spendLimitAtomic: input.budget.spendLimitAtomic,
        spendUsedAtomic: input.budget.spendUsedAtomic,
        proposedSpendAtomic: input.budget.proposedSpendAtomic,
        requestsUsedInWindow: input.budget.requestsUsedInWindow,
        maxRequestsInWindow: input.budget.maxRequestsInWindow,
        cadence: input.budget.cadence,
        intentCadence: input.intent.constraints.cadence ?? null,
      },
    }),
    observation({
      check: 'x402-service-trust-posture',
      status: serviceReady ? 'pass' : 'fail',
      code: serviceReady
        ? 'x402-service-trust-ready'
        : 'x402-service-trust-not-ready',
      message: serviceReady
        ? 'Resource origin, recipient, asset, network, and catalog price are trusted.'
        : 'x402 payment requires trusted resource origin, recipient, asset, network, and catalog price.',
      evidence: {
        merchantId: input.serviceTrust.merchantId,
        serviceDiscoveryRef: input.serviceTrust.serviceDiscoveryRef ?? null,
        resourceOriginAllowlisted: input.serviceTrust.resourceOriginAllowlisted,
        payToAllowlisted: input.serviceTrust.payToAllowlisted,
        assetAllowlisted: input.serviceTrust.assetAllowlisted,
        networkAllowlisted: input.serviceTrust.networkAllowlisted,
        priceMatchesCatalog: input.serviceTrust.priceMatchesCatalog,
      },
    }),
    observation({
      check: 'x402-facilitator-support',
      status:
        includesValue(X402_FACILITATOR_PATHS, input.facilitator.path) &&
        input.facilitator.supportedChecked &&
        input.facilitator.supportedKindAdvertised &&
        input.facilitator.signerTrusted
          ? 'pass'
          : 'fail',
      code:
        includesValue(X402_FACILITATOR_PATHS, input.facilitator.path) &&
        input.facilitator.supportedChecked &&
        input.facilitator.supportedKindAdvertised &&
        input.facilitator.signerTrusted
          ? 'x402-facilitator-support-ready'
          : 'x402-facilitator-support-invalid',
      message:
        includesValue(X402_FACILITATOR_PATHS, input.facilitator.path) &&
        input.facilitator.supportedChecked &&
        input.facilitator.supportedKindAdvertised &&
        input.facilitator.signerTrusted
          ? 'Facilitator support was checked and the selected payment kind is advertised by a trusted signer.'
          : 'x402 facilitator must advertise the selected kind through a trusted support response.',
      evidence: {
        path: input.facilitator.path,
        facilitatorUrl: input.facilitator.facilitatorUrl,
        supportedChecked: input.facilitator.supportedChecked,
        supportedKindAdvertised: input.facilitator.supportedKindAdvertised,
        signerTrusted: input.facilitator.signerTrusted,
      },
    }),
    observation({
      check: 'x402-facilitator-verify',
      status:
        input.facilitator.verifyRequested &&
        input.facilitator.verifyResponseValid &&
        samePaymentAddress(facilitatorPayer, input.payload.payer)
          ? 'pass'
          : 'fail',
      code:
        input.facilitator.verifyRequested &&
        input.facilitator.verifyResponseValid &&
        samePaymentAddress(facilitatorPayer, input.payload.payer)
          ? 'x402-facilitator-verify-valid'
          : 'x402-facilitator-verify-invalid',
      message:
        input.facilitator.verifyRequested &&
        input.facilitator.verifyResponseValid &&
        samePaymentAddress(facilitatorPayer, input.payload.payer)
          ? 'Facilitator /verify accepted the payment authorization for the expected payer.'
          : 'x402 facilitator /verify must validate the payment authorization for the expected payer.',
      evidence: {
        verifyRequested: input.facilitator.verifyRequested,
        verifyResponseValid: input.facilitator.verifyResponseValid,
        verifyInvalidReason: input.facilitator.verifyInvalidReason ?? null,
        verifyPayer: input.facilitator.verifyPayer ?? null,
        payloadPayer: input.payload.payer,
      },
    }),
    observation({
      check: 'x402-settlement-posture',
      status:
        settlementReady ? 'pass' : input.facilitator.settleResponseSuccess === null ? 'warn' : 'fail',
      code:
        settlementReady
          ? 'x402-settlement-confirmed'
          : input.facilitator.settleResponseSuccess === null
            ? 'x402-settlement-pending-review'
            : 'x402-settlement-invalid',
      message:
        settlementReady
          ? 'Facilitator settlement succeeded and PAYMENT-RESPONSE details are bound.'
          : input.facilitator.settleResponseSuccess === null
            ? 'x402 settlement is verified but not yet confirmed; reviewer confirmation is required before access.'
            : 'x402 settlement must succeed and bind network, payer, amount, transaction, and PAYMENT-RESPONSE.',
      evidence: {
        settleRequested: input.facilitator.settleRequested,
        settleResponseSuccess: input.facilitator.settleResponseSuccess,
        settlementTransaction: input.facilitator.settlementTransaction ?? null,
        settlementNetwork: input.facilitator.settlementNetwork ?? null,
        settlementPayer: input.facilitator.settlementPayer ?? null,
        settlementAmount: input.facilitator.settlementAmount ?? null,
        paymentResponseHeaderPresent: input.facilitator.paymentResponseHeaderPresent,
      },
    }),
    observation({
      check: 'x402-privacy-metadata-posture',
      status: privacyReady(input.privacy) ? 'pass' : 'fail',
      code: privacyReady(input.privacy)
        ? 'x402-privacy-metadata-ready'
        : 'x402-privacy-metadata-risk',
      message: privacyReady(input.privacy)
        ? 'Payment metadata was scanned, minimized, and made safe for facilitator transmission.'
        : 'x402 payment metadata must be scanned, minimized, and redacted before facilitator transmission.',
      evidence: {
        metadataScanned: input.privacy.metadataScanned,
        piiDetected: input.privacy.piiDetected,
        piiRedacted: input.privacy.piiRedacted,
        sensitiveQueryDetected: input.privacy.sensitiveQueryDetected,
        sensitiveQueryRedacted: input.privacy.sensitiveQueryRedacted,
        metadataMinimized: input.privacy.metadataMinimized,
        facilitatorDataMinimized: input.privacy.facilitatorDataMinimized,
        reasonStringPiiDetected: input.privacy.reasonStringPiiDetected ?? false,
      },
    }),
    observation({
      check: 'x402-release-binding-ready',
      status: releaseReady(input.releaseBinding) ? 'pass' : 'fail',
      code: releaseReady(input.releaseBinding)
        ? 'x402-release-binding-ready'
        : 'x402-release-binding-not-ready',
      message: releaseReady(input.releaseBinding)
        ? 'Release binding is accepted and ready for x402 payment execution.'
        : 'x402 payment requires an accepted or overridden Attestor release binding.',
      evidence: {
        releaseBindingStatus: input.releaseBinding.status,
        releaseDecisionStatus: input.releaseBinding.releaseDecision.status,
        releaseBindingDigest: input.releaseBinding.digest,
      },
    }),
    observation({
      check: 'x402-policy-binding-ready',
      status: input.policyScopeBinding.activationRecord.state === 'active' ? 'pass' : 'fail',
      code: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'x402-policy-binding-ready'
        : 'x402-policy-binding-not-active',
      message: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'Policy control-plane activation is active for the x402 payment scope.'
        : 'x402 payment requires an active policy control-plane activation.',
      evidence: {
        activationId: input.policyScopeBinding.activationId,
        activationStatus: input.policyScopeBinding.activationRecord.state,
        policyScopeDigest: input.policyScopeBinding.digest,
      },
    }),
    observation({
      check: 'x402-enforcement-binding-ready',
      status: enforcementReady(input.enforcementBinding) ? 'pass' : 'fail',
      code: enforcementReady(input.enforcementBinding)
        ? 'x402-enforcement-binding-ready'
        : 'x402-enforcement-binding-not-ready',
      message: enforcementReady(input.enforcementBinding)
        ? 'Enforcement binding is fail-closed and attached to the action-dispatch boundary.'
        : 'x402 payment requires fail-closed action-dispatch enforcement binding.',
      evidence: {
        adapterKind: input.enforcementBinding.adapterKind ?? null,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
        failClosed: input.enforcementBinding.verificationProfile.failClosed,
        enforcementBindingDigest: input.enforcementBinding.digest,
      },
    }),
  );

  return Object.freeze(observations);
}

function outcomeFromObservations(observations: readonly X402Observation[]): X402Outcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'block';
  }
  if (observations.some((entry) => entry.required && entry.status === 'warn')) {
    return 'review-required';
  }
  return 'allow';
}

function signalStatusFor(outcome: X402Outcome): CryptoSimulationPreflightSignal['status'] {
  switch (outcome) {
    case 'allow':
      return 'pass';
    case 'review-required':
      return 'warn';
    case 'block':
      return 'fail';
  }
}

function nonPassingReasonCodes(observations: readonly X402Observation[]): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.code),
  );
}

function preflightIdFor(input: {
  readonly resource: X402ResourceEvidence;
  readonly requirements: X402PaymentRequirementsEvidence;
  readonly payload: X402PaymentPayloadEvidence;
  readonly facilitator: X402FacilitatorEvidence;
  readonly budget: X402AgentBudgetEvidence;
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
}): string {
  return canonicalObject({
    version: X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
    resourceUrl: input.resource.resourceUrl,
    method: input.resource.method,
    network: input.requirements.network,
    scheme: input.requirements.scheme,
    amount: input.requirements.amount,
    asset: input.requirements.asset,
    payTo: input.requirements.payTo,
    payloadHash: input.payload.payloadHash ?? null,
    authorizationNonce: input.payload.authorization.nonce,
    facilitatorUrl: input.facilitator.facilitatorUrl,
    budgetId: input.budget.budgetId,
    idempotencyKey: input.budget.idempotencyKey,
    releaseBindingDigest: input.releaseBindingDigest,
    policyScopeDigest: input.policyScopeDigest,
    enforcementBindingDigest: input.enforcementBindingDigest,
  }).digest;
}

function signalFor(input: {
  readonly outcome: X402Outcome;
  readonly preflightId: string;
  readonly resource: X402ResourceEvidence;
  readonly requirements: X402PaymentRequirementsEvidence;
  readonly payload: X402PaymentPayloadEvidence;
  readonly facilitator: X402FacilitatorEvidence;
  readonly budget: X402AgentBudgetEvidence;
  readonly observations: readonly X402Observation[];
}): CryptoSimulationPreflightSignal {
  return Object.freeze({
    source: 'x402-payment',
    status: signalStatusFor(input.outcome),
    code: input.outcome === 'allow'
      ? 'x402-agentic-payment-adapter-allow'
      : input.outcome === 'review-required'
        ? 'x402-agentic-payment-adapter-review-required'
        : 'x402-agentic-payment-adapter-block',
    message: input.outcome === 'allow'
      ? 'x402 agentic payment adapter accepted the Attestor-bound payment preflight.'
      : input.outcome === 'review-required'
        ? 'x402 agentic payment adapter needs settlement or reviewer evidence before access.'
        : 'x402 agentic payment adapter would block HTTP-native agent payment fail-closed.',
    required: true,
    evidence: Object.freeze({
      adapterVersion: X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
      preflightId: input.preflightId,
      protocolVersion: X402_PROTOCOL_VERSION,
      resourceUrl: input.resource.resourceUrl,
      method: input.resource.method,
      network: input.requirements.network,
      scheme: input.requirements.scheme,
      amount: input.requirements.amount,
      asset: input.requirements.asset,
      payTo: input.requirements.payTo,
      payer: input.payload.payer,
      facilitatorUrl: input.facilitator.facilitatorUrl,
      budgetId: input.budget.budgetId,
      idempotencyKey: input.budget.idempotencyKey,
      reasonCodes: nonPassingReasonCodes(input.observations),
    }),
  });
}

export function createX402AgenticPaymentPreflight(
  input: CreateX402AgenticPaymentPreflightInput,
): X402AgenticPaymentPreflight {
  assertAdapterConsistency(input);
  const resource = normalizeResource(input.resource);
  const requirements = normalizeRequirements(input.paymentRequirements);
  const payload = normalizePayload(input.paymentPayload, requirements);
  const facilitator = normalizeFacilitator(input.facilitator);
  const budget = normalizeBudget(input.budget);
  const serviceTrust = normalizeServiceTrust(input.serviceTrust);
  const privacy = normalizePrivacy(input.privacy);
  const observations = buildObservations({
    intent: input.intent,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    resource,
    requirements,
    payload,
    facilitator,
    budget,
    serviceTrust,
    privacy,
  });
  const outcome = outcomeFromObservations(observations);
  const preflightId =
    normalizeOptionalIdentifier(input.preflightId, 'preflightId') ??
    preflightIdFor({
      resource,
      requirements,
      payload,
      facilitator,
      budget,
      releaseBindingDigest: input.releaseBinding.digest,
      policyScopeDigest: input.policyScopeBinding.digest,
      enforcementBindingDigest: input.enforcementBinding.digest,
    });
  const signal = signalFor({
    outcome,
    preflightId,
    resource,
    requirements,
    payload,
    facilitator,
    budget,
    observations,
  });
  const canonicalPayload = {
    version: X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
    preflightId,
    adapterKind: 'x402-payment' as const,
    checkedAt: resource.observedAt,
    x402Version: X402_PROTOCOL_VERSION,
    transport: 'http' as const,
    resourceUrl: resource.resourceUrl,
    method: resource.method,
    payer: payload.payer,
    payTo: requirements.payTo,
    network: requirements.network,
    scheme: 'exact' as const,
    asset: requirements.asset,
    amount: requirements.amount,
    budgetId: budget.budgetId,
    idempotencyKey: budget.idempotencyKey,
    outcome,
    signal,
    observations,
    releaseBindingDigest: input.releaseBinding.digest,
    policyScopeDigest: input.policyScopeBinding.digest,
    enforcementBindingDigest: input.enforcementBinding.digest,
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function simulateX402AgenticPaymentAuthorization(
  input: CreateX402AgenticPaymentPreflightInput,
): X402AgenticPaymentSimulationResult {
  const preflight = createX402AgenticPaymentPreflight(input);
  const simulation = createCryptoAuthorizationSimulation({
    intent: input.intent,
    riskAssessment: input.riskAssessment,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    simulatedAt: preflight.checkedAt,
    preflightSignals: [preflight.signal],
    operatorNote: `x402 payment ${preflight.payer} -> ${preflight.payTo} ${preflight.amount} ${preflight.asset} preflight ${preflight.outcome}.`,
  });

  return Object.freeze({
    preflight,
    simulation,
  });
}

export function x402AgenticPaymentPreflightLabel(
  preflight: X402AgenticPaymentPreflight,
): string {
  return [
    `x402:${preflight.method}`,
    preflight.resourceUrl,
    `payTo:${preflight.payTo}`,
    `amount:${preflight.amount}`,
    `outcome:${preflight.outcome}`,
  ].join(' / ');
}

export function x402AgenticPaymentAdapterDescriptor(): X402AgenticPaymentAdapterDescriptor {
  return Object.freeze({
    version: X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
    adapterKind: 'x402-payment',
    protocolVersion: X402_PROTOCOL_VERSION,
    paymentRequiredStatus: X402_HTTP_PAYMENT_REQUIRED_STATUS,
    headers: Object.freeze({
      paymentRequired: X402_PAYMENT_REQUIRED_HEADER,
      paymentSignature: X402_PAYMENT_SIGNATURE_HEADER,
      paymentResponse: X402_PAYMENT_RESPONSE_HEADER,
    }),
    transports: X402_TRANSPORTS,
    schemes: X402_PAYMENT_SCHEMES,
    networkNamespaces: X402_NETWORK_NAMESPACES,
    authorizationModes: X402_EXACT_AUTHORIZATION_MODES,
    facilitatorPaths: X402_FACILITATOR_PATHS,
    outcomes: X402_OUTCOMES,
    checks: X402_CHECKS,
    references: Object.freeze([
      'x402-v2',
      'HTTP-402',
      'PAYMENT-REQUIRED',
      'PAYMENT-SIGNATURE',
      'PAYMENT-RESPONSE',
      'CAIP-2',
      'EIP-3009',
      'EIP-712',
      'Permit2',
      'SPL-TransferChecked',
      'facilitator-verify',
      'facilitator-settle',
      'agent-budget',
      'agent-cadence',
      'metadata-privacy-filtering',
      'release-layer',
      'release-policy-control-plane',
      'release-enforcement-plane',
      'attestor-crypto-authorization-simulation',
    ]),
  });
}
