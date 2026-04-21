import { createHash } from 'node:crypto';
import type {
  CryptoAuthorizationDecision,
  CryptoAuthorizationIntent,
  CryptoSignerAuthority,
} from './object-model.js';
import type {
  CryptoCanonicalAccountReference,
  CryptoCanonicalReferenceBundle,
} from './canonical-references.js';
import { createCryptoCanonicalAccountReference } from './canonical-references.js';
import type { CryptoConsequenceRiskAssessment } from './consequence-risk-mapping.js';

/**
 * EIP-712 typed authorization envelope projection.
 *
 * Step 05 defines the typed-data payload and Attestor digest coverage only. It
 * does not perform wallet signing, secp256k1 recovery, or ERC-1271 validation;
 * those belong to later adapter and validation-projection steps.
 */

export const CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION =
  'attestor.crypto-eip712-authorization-envelope.v1';

export const CRYPTO_EIP712_DOMAIN_NAME = 'Attestor Crypto Authorization';
export const CRYPTO_EIP712_DOMAIN_VERSION = '1';
export const CRYPTO_EIP712_PRIMARY_TYPE = 'AttestorCryptoAuthorization';
export const CRYPTO_EIP712_COVERAGE_TYPE = 'AttestorDigestCoverage';
export const CRYPTO_EIP191_STRUCTURED_DATA_PREFIX = '0x1901';

export const CRYPTO_EIP712_AUTHORIZATION_DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
] as const;

export const CRYPTO_EIP712_AUTHORIZATION_MESSAGE_FIELDS = [
  { name: 'version', type: 'string' },
  { name: 'envelopeId', type: 'string' },
  { name: 'intentId', type: 'string' },
  { name: 'decisionId', type: 'string' },
  { name: 'receiptId', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'caip2ChainId', type: 'string' },
  { name: 'account', type: 'address' },
  { name: 'signer', type: 'address' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validUntil', type: 'uint256' },
  { name: 'nonce', type: 'string' },
  { name: 'consequenceKind', type: 'string' },
  { name: 'riskClass', type: 'string' },
  { name: 'coverage', type: CRYPTO_EIP712_COVERAGE_TYPE },
] as const;

export const CRYPTO_EIP712_DIGEST_COVERAGE_FIELDS = [
  { name: 'referenceBundleDigest', type: 'bytes32' },
  { name: 'intentDigest', type: 'bytes32' },
  { name: 'decisionDigest', type: 'bytes32' },
  { name: 'riskAssessmentDigest', type: 'bytes32' },
  { name: 'evidenceDigest', type: 'bytes32' },
] as const;

export interface CryptoEip712Domain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number | string;
  readonly verifyingContract: string;
  readonly salt: string;
}

export interface CryptoEip712DigestCoverage {
  readonly referenceBundleDigest: string;
  readonly intentDigest: string;
  readonly decisionDigest: string;
  readonly riskAssessmentDigest: string;
  readonly evidenceDigest: string;
}

export interface CryptoEip712AuthorizationMessage {
  readonly version: typeof CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION;
  readonly envelopeId: string;
  readonly intentId: string;
  readonly decisionId: string;
  readonly receiptId: string;
  readonly chainId: number | string;
  readonly caip2ChainId: string;
  readonly account: string;
  readonly signer: string;
  readonly validAfter: number;
  readonly validUntil: number;
  readonly nonce: string;
  readonly consequenceKind: string;
  readonly riskClass: string;
  readonly coverage: CryptoEip712DigestCoverage;
}

export interface CryptoEip712TypedData {
  readonly types: {
    readonly EIP712Domain: typeof CRYPTO_EIP712_AUTHORIZATION_DOMAIN_FIELDS;
    readonly AttestorDigestCoverage: typeof CRYPTO_EIP712_DIGEST_COVERAGE_FIELDS;
    readonly AttestorCryptoAuthorization: typeof CRYPTO_EIP712_AUTHORIZATION_MESSAGE_FIELDS;
  };
  readonly primaryType: typeof CRYPTO_EIP712_PRIMARY_TYPE;
  readonly domain: CryptoEip712Domain;
  readonly message: CryptoEip712AuthorizationMessage;
}

export interface CryptoEip712DomainIntrospection {
  readonly erc5267FieldsBitmap: '0x1f';
  readonly fields: readonly string[];
  readonly extensions: readonly number[];
}

export interface CryptoEip712SignerBinding {
  readonly signerAddress: string;
  readonly signerAuthorityId: string;
  readonly signerAuthorityKind: CryptoSignerAuthority['authorityKind'];
  readonly signatureValidationMode: CryptoSignerAuthority['validationMode'];
  readonly accountAddress: string;
}

export interface CryptoEip712ChainBinding {
  readonly caip2ChainId: string;
  readonly eip155ChainId: string;
}

export interface CryptoEip712AuthorizationEnvelope {
  readonly version: typeof CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION;
  readonly envelopeId: string;
  readonly rpcMethod: 'eth_signTypedData';
  readonly eip191Prefix: typeof CRYPTO_EIP191_STRUCTURED_DATA_PREFIX;
  readonly typedData: CryptoEip712TypedData;
  readonly signerBinding: CryptoEip712SignerBinding;
  readonly chainBinding: CryptoEip712ChainBinding;
  readonly domainIntrospection: CryptoEip712DomainIntrospection;
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateCryptoEip712AuthorizationEnvelopeInput {
  readonly envelopeId: string;
  readonly receiptId: string;
  readonly intent: CryptoAuthorizationIntent;
  readonly decision: CryptoAuthorizationDecision;
  readonly signerAuthority: CryptoSignerAuthority;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly referenceBundle: CryptoCanonicalReferenceBundle;
  readonly verifyingContract: string;
  readonly domainName?: string | null;
  readonly domainVersion?: string | null;
  readonly domainSalt?: string | null;
}

export interface CryptoEip712AuthorizationEnvelopeDescriptor {
  readonly version: typeof CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION;
  readonly domainName: typeof CRYPTO_EIP712_DOMAIN_NAME;
  readonly domainVersion: typeof CRYPTO_EIP712_DOMAIN_VERSION;
  readonly primaryType: typeof CRYPTO_EIP712_PRIMARY_TYPE;
  readonly eip191Prefix: typeof CRYPTO_EIP191_STRUCTURED_DATA_PREFIX;
  readonly domainFields: typeof CRYPTO_EIP712_AUTHORIZATION_DOMAIN_FIELDS;
  readonly messageFields: typeof CRYPTO_EIP712_AUTHORIZATION_MESSAGE_FIELDS;
  readonly coverageFields: typeof CRYPTO_EIP712_DIGEST_COVERAGE_FIELDS;
  readonly standards: readonly string[];
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const EIP155_CHAIN_ID_PATTERN = /^(0|[1-9]\d*)$/;

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Crypto EIP-712 authorization envelope ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fallback: string,
  fieldName: string,
): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  return normalizeIdentifier(value, fieldName);
}

function normalizeEvmAddress(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!EVM_ADDRESS_PATTERN.test(normalized)) {
    throw new Error(`Crypto EIP-712 authorization envelope ${fieldName} must be a 20-byte EVM address.`);
  }
  return normalized.toLowerCase();
}

function digestToBytes32(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  const sha256Match = normalized.match(SHA256_DIGEST_PATTERN);
  if (sha256Match) {
    return `0x${sha256Match[1]}`;
  }
  if (BYTES32_PATTERN.test(normalized)) {
    return normalized.toLowerCase();
  }
  throw new Error(`Crypto EIP-712 authorization envelope ${fieldName} must be sha256:<64 hex> or 0x<32 bytes>.`);
}

function sha256Bytes32(value: unknown): string {
  return `0x${createHash('sha256')
    .update(canonicalizeJson(value as CanonicalJsonValue))
    .digest('hex')}`;
}

function canonicalizeJson(value: CanonicalJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalizeJson(entry)).join(',')}]`;

  const objectValue = value as { readonly [key: string]: CanonicalJsonValue };
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(objectValue[key])}`)
    .join(',')}}`;
}

function digestCanonicalJson(value: CanonicalJsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value)).digest('hex')}`;
}

function parseEip155ChainId(caip2ChainId: string): CryptoEip712ChainBinding & {
  readonly typedChainId: number | string;
} {
  const [namespace, reference, extra] = caip2ChainId.split(':');
  if (extra !== undefined || namespace !== 'eip155' || !EIP155_CHAIN_ID_PATTERN.test(reference)) {
    throw new Error('Crypto EIP-712 authorization envelope requires an eip155 CAIP-2 chain id.');
  }

  const chainId = BigInt(reference);
  if (chainId <= 0n) {
    throw new Error('Crypto EIP-712 authorization envelope chainId must be positive.');
  }
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

  return Object.freeze({
    caip2ChainId,
    eip155ChainId: reference,
    typedChainId: chainId <= maxSafe ? Number(reference) : reference,
  });
}

function epochSeconds(value: string, fieldName: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`Crypto EIP-712 authorization envelope ${fieldName} must be an ISO timestamp.`);
  }
  return Math.floor(time / 1000);
}

function evidenceDigestFor(intent: CryptoAuthorizationIntent): string {
  return sha256Bytes32({
    intentId: intent.intentId,
    evidenceRefs: intent.evidenceRefs,
  });
}

function intentDigestFor(intent: CryptoAuthorizationIntent): string {
  return sha256Bytes32({
    objectKind: intent.objectKind,
    version: intent.version,
    intentId: intent.intentId,
    requestedAt: intent.requestedAt,
    requester: intent.requester,
    account: {
      accountKind: intent.account.accountKind,
      chain: intent.account.chain,
      address: intent.account.address,
    },
    consequenceKind: intent.consequenceKind,
    target: intent.target,
    asset: intent.asset,
    policyScope: intent.policyScope,
    constraints: intent.constraints,
    executionAdapterKind: intent.executionAdapterKind,
    evidenceRefs: intent.evidenceRefs,
  });
}

function decisionDigestFor(decision: CryptoAuthorizationDecision): string {
  return sha256Bytes32({
    objectKind: decision.objectKind,
    version: decision.version,
    decisionId: decision.decisionId,
    intentId: decision.intentId,
    decidedAt: decision.decidedAt,
    status: decision.status,
    riskClass: decision.riskClass,
    releaseDecisionId: decision.releaseDecisionId,
    reasonCodes: decision.reasonCodes,
    signerAuthorities: decision.signerAuthorities,
    requiredArtifacts: decision.requiredArtifacts,
    validAfter: decision.validAfter,
    validUntil: decision.validUntil,
    nonce: decision.nonce,
  });
}

function defaultDomainSalt(caip2ChainId: string, verifyingContract: string): string {
  return sha256Bytes32({
    version: CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION,
    caip2ChainId,
    verifyingContract,
  });
}

function assertEnvelopeConsistency(
  input: CreateCryptoEip712AuthorizationEnvelopeInput,
  canonicalAccount: CryptoCanonicalAccountReference,
): void {
  if (input.decision.status !== 'allow') {
    throw new Error('Crypto EIP-712 authorization envelope requires an allow decision.');
  }
  if (input.decision.intentId !== input.intent.intentId) {
    throw new Error('Crypto EIP-712 authorization envelope decision must bind to the intent.');
  }
  if (input.decision.riskClass !== input.riskAssessment.riskClass) {
    throw new Error('Crypto EIP-712 authorization envelope decision risk must match risk assessment.');
  }
  if (input.riskAssessment.consequenceKind !== input.intent.consequenceKind) {
    throw new Error('Crypto EIP-712 authorization envelope risk assessment consequence must match intent.');
  }
  if (input.riskAssessment.accountKind !== input.intent.account.accountKind) {
    throw new Error('Crypto EIP-712 authorization envelope risk assessment account must match intent.');
  }
  if (input.intent.asset && input.riskAssessment.assetKind !== input.intent.asset.assetKind) {
    throw new Error('Crypto EIP-712 authorization envelope risk assessment asset must match intent.');
  }
  if (input.referenceBundle.chain.caip2ChainId !== canonicalAccount.chain.caip2ChainId) {
    throw new Error('Crypto EIP-712 authorization envelope reference bundle chain must match account chain.');
  }
  if (
    input.referenceBundle.account &&
    input.referenceBundle.account.caip10AccountId !== canonicalAccount.caip10AccountId
  ) {
    throw new Error('Crypto EIP-712 authorization envelope reference bundle account must match intent account.');
  }
  const signerIncluded = input.decision.signerAuthorities.some(
    (authority) => authority.authorityId === input.signerAuthority.authorityId,
  );
  if (!signerIncluded) {
    throw new Error('Crypto EIP-712 authorization envelope signer must be authorized by the decision.');
  }
}

export function createCryptoEip712AuthorizationEnvelope(
  input: CreateCryptoEip712AuthorizationEnvelopeInput,
): CryptoEip712AuthorizationEnvelope {
  const envelopeId = normalizeIdentifier(input.envelopeId, 'envelopeId');
  const receiptId = normalizeIdentifier(input.receiptId, 'receiptId');
  const canonicalAccount = createCryptoCanonicalAccountReference(input.intent.account);
  assertEnvelopeConsistency(input, canonicalAccount);

  const verifyingContract = normalizeEvmAddress(input.verifyingContract, 'verifyingContract');
  const signerAddress = normalizeEvmAddress(
    input.signerAuthority.address ?? '',
    'signer authority address',
  );
  const accountAddress = normalizeEvmAddress(canonicalAccount.accountAddress, 'account address');
  const chainBinding = parseEip155ChainId(canonicalAccount.chain.caip2ChainId);
  const validAfter = epochSeconds(input.decision.validAfter, 'validAfter');
  const validUntil = epochSeconds(input.decision.validUntil, 'validUntil');
  if (validAfter >= validUntil) {
    throw new Error('Crypto EIP-712 authorization envelope validAfter must be before validUntil.');
  }

  const domainSalt = input.domainSalt
    ? digestToBytes32(input.domainSalt, 'domainSalt')
    : defaultDomainSalt(chainBinding.caip2ChainId, verifyingContract);
  const domain: CryptoEip712Domain = Object.freeze({
    name: normalizeOptionalIdentifier(input.domainName, CRYPTO_EIP712_DOMAIN_NAME, 'domainName'),
    version: normalizeOptionalIdentifier(
      input.domainVersion,
      CRYPTO_EIP712_DOMAIN_VERSION,
      'domainVersion',
    ),
    chainId: chainBinding.typedChainId,
    verifyingContract,
    salt: domainSalt,
  });
  const coverage: CryptoEip712DigestCoverage = Object.freeze({
    referenceBundleDigest: digestToBytes32(input.referenceBundle.digest, 'referenceBundleDigest'),
    intentDigest: intentDigestFor(input.intent),
    decisionDigest: decisionDigestFor(input.decision),
    riskAssessmentDigest: digestToBytes32(input.riskAssessment.digest, 'riskAssessmentDigest'),
    evidenceDigest: evidenceDigestFor(input.intent),
  });
  const message: CryptoEip712AuthorizationMessage = Object.freeze({
    version: CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION,
    envelopeId,
    intentId: input.intent.intentId,
    decisionId: input.decision.decisionId,
    receiptId,
    chainId: chainBinding.typedChainId,
    caip2ChainId: chainBinding.caip2ChainId,
    account: accountAddress,
    signer: signerAddress,
    validAfter,
    validUntil,
    nonce: input.decision.nonce,
    consequenceKind: input.intent.consequenceKind,
    riskClass: input.decision.riskClass,
    coverage,
  });
  const typedData: CryptoEip712TypedData = Object.freeze({
    types: Object.freeze({
      EIP712Domain: CRYPTO_EIP712_AUTHORIZATION_DOMAIN_FIELDS,
      AttestorDigestCoverage: CRYPTO_EIP712_DIGEST_COVERAGE_FIELDS,
      AttestorCryptoAuthorization: CRYPTO_EIP712_AUTHORIZATION_MESSAGE_FIELDS,
    }),
    primaryType: CRYPTO_EIP712_PRIMARY_TYPE,
    domain,
    message,
  });
  const canonicalPayload = {
    version: CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION,
    rpcMethod: 'eth_signTypedData',
    eip191Prefix: CRYPTO_EIP191_STRUCTURED_DATA_PREFIX,
    typedData,
  } as const;

  return Object.freeze({
    version: CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION,
    envelopeId,
    rpcMethod: 'eth_signTypedData',
    eip191Prefix: CRYPTO_EIP191_STRUCTURED_DATA_PREFIX,
    typedData,
    signerBinding: Object.freeze({
      signerAddress,
      signerAuthorityId: input.signerAuthority.authorityId,
      signerAuthorityKind: input.signerAuthority.authorityKind,
      signatureValidationMode: input.signerAuthority.validationMode,
      accountAddress,
    }),
    chainBinding: Object.freeze({
      caip2ChainId: chainBinding.caip2ChainId,
      eip155ChainId: chainBinding.eip155ChainId,
    }),
    domainIntrospection: Object.freeze({
      erc5267FieldsBitmap: '0x1f',
      fields: Object.freeze(['name', 'version', 'chainId', 'verifyingContract', 'salt']),
      extensions: Object.freeze([]),
    }),
    canonical: canonicalizeJson(canonicalPayload as unknown as CanonicalJsonValue),
    digest: digestCanonicalJson(canonicalPayload as unknown as CanonicalJsonValue),
  });
}

export function cryptoEip712AuthorizationEnvelopeLabel(
  envelope: CryptoEip712AuthorizationEnvelope,
): string {
  return [
    `envelope:${envelope.envelopeId}`,
    `chain:${envelope.chainBinding.caip2ChainId}`,
    `account:${envelope.signerBinding.accountAddress}`,
    `signer:${envelope.signerBinding.signerAddress}`,
    `risk:${envelope.typedData.message.riskClass}`,
    `nonce:${envelope.typedData.message.nonce}`,
  ].join(' / ');
}

export function cryptoEip712AuthorizationEnvelopeDescriptor():
CryptoEip712AuthorizationEnvelopeDescriptor {
  return Object.freeze({
    version: CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION,
    domainName: CRYPTO_EIP712_DOMAIN_NAME,
    domainVersion: CRYPTO_EIP712_DOMAIN_VERSION,
    primaryType: CRYPTO_EIP712_PRIMARY_TYPE,
    eip191Prefix: CRYPTO_EIP191_STRUCTURED_DATA_PREFIX,
    domainFields: CRYPTO_EIP712_AUTHORIZATION_DOMAIN_FIELDS,
    messageFields: CRYPTO_EIP712_AUTHORIZATION_MESSAGE_FIELDS,
    coverageFields: CRYPTO_EIP712_DIGEST_COVERAGE_FIELDS,
    standards: Object.freeze(['EIP-712', 'EIP-191', 'ERC-5267', 'ERC-7739-ready']),
  });
}
