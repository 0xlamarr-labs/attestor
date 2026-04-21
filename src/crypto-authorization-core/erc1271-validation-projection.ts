import { createHash } from 'node:crypto';
import type { CryptoExecutionAdapterKind } from './types.js';
import type { CryptoEip712AuthorizationEnvelope } from './eip712-authorization-envelope.js';

/**
 * ERC-1271 smart-account validation projection.
 *
 * Step 06 defines how an Attestor EIP-712 authorization envelope should be
 * checked when the signer is a contract account. It only builds a deterministic
 * validation plan and result interpreter; chain calls, ABI transport, Safe
 * guards, ERC-4337 bundlers, and custody integrations stay in adapter layers.
 */

export const CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION =
  'attestor.crypto-erc1271-validation-projection.v1';

export const ERC1271_IS_VALID_SIGNATURE_ABI = 'isValidSignature(bytes32,bytes)';
export const ERC1271_IS_VALID_SIGNATURE_SELECTOR = '0x1626ba7e';
export const ERC1271_MAGIC_VALUE = ERC1271_IS_VALID_SIGNATURE_SELECTOR;
export const ERC1271_INVALID_VALUE = '0xffffffff';
export const ERC6492_DETECTION_SUFFIX =
  '0x6492649264926492649264926492649264926492649264926492649264926492';
export const ERC7739_SUPPORT_DETECTION_HASH =
  '0x7739773977397739773977397739773977397739773977397739773977397739';
export const ERC7739_SUPPORT_MAGIC_VALUE = '0x77390001';

export const CRYPTO_ERC1271_VALIDATION_PATHS = [
  'deployed-contract',
  'counterfactual-erc6492',
  'modular-validator',
  'safe-guard',
] as const;
export type CryptoErc1271ValidationPath =
  typeof CRYPTO_ERC1271_VALIDATION_PATHS[number];

export const CRYPTO_MODULAR_VALIDATION_MODULE_TYPES = [
  'validator',
  'executor',
  'hook',
  'fallback',
] as const;
export type CryptoModularValidationModuleType =
  typeof CRYPTO_MODULAR_VALIDATION_MODULE_TYPES[number];

export const CRYPTO_SIGNATURE_VALIDATION_SUBJECT_KINDS = [
  'eoa',
  'smart-account',
] as const;
export type CryptoSignatureValidationSubjectKind =
  typeof CRYPTO_SIGNATURE_VALIDATION_SUBJECT_KINDS[number];

export const CRYPTO_ERC1271_RESULT_STATUSES = [
  'valid',
  'invalid',
  'indeterminate',
] as const;
export type CryptoErc1271ResultStatus =
  typeof CRYPTO_ERC1271_RESULT_STATUSES[number];

export interface CryptoErc1271StaticCallPlan {
  readonly callKind: 'erc-1271-is-valid-signature';
  readonly callType: 'staticcall';
  readonly to: string;
  readonly selector: typeof ERC1271_IS_VALID_SIGNATURE_SELECTOR;
  readonly abiSignature: typeof ERC1271_IS_VALID_SIGNATURE_ABI;
  readonly stateMutability: 'view';
  readonly arguments: {
    readonly hash: string;
    readonly signature: string;
  };
  readonly expectedReturnValue: typeof ERC1271_MAGIC_VALUE;
  readonly invalidReturnValue: typeof ERC1271_INVALID_VALUE;
  readonly gasPolicy: 'do-not-hardcode-gas-limit';
}

export interface CryptoErc1271CounterfactualPlan {
  readonly standard: 'ERC-6492';
  readonly enabled: boolean;
  readonly detectionSuffix: typeof ERC6492_DETECTION_SUFFIX;
  readonly factory: string;
  readonly factoryCalldata: string;
  readonly verificationOrder: readonly string[];
}

export interface CryptoErc1271ModularPlan {
  readonly standard: 'ERC-7579';
  readonly module: string;
  readonly moduleType: CryptoModularValidationModuleType;
  readonly validatorRequired: boolean;
}

export interface CryptoErc1271DefensiveRehashingPlan {
  readonly standard: 'ERC-7739';
  readonly accountAddress: string;
  readonly chainId: string;
  readonly domainVerifyingContract: string;
  readonly supportDetectionHash: typeof ERC7739_SUPPORT_DETECTION_HASH;
  readonly supportMagicValue: typeof ERC7739_SUPPORT_MAGIC_VALUE;
  readonly safeToSkipReason: 'attestor-envelope-binds-account-chain-domain';
}

export interface CryptoErc1271ValidationProjection {
  readonly version: typeof CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION;
  readonly projectionKind: 'signature-validation';
  readonly subjectKind: 'smart-account';
  readonly validationMode: 'erc-1271-contract';
  readonly validationPath: CryptoErc1271ValidationPath;
  readonly envelopeId: string;
  readonly chainId: string;
  readonly accountAddress: string;
  readonly signerAddress: string;
  readonly validatorContract: string;
  readonly adapterKind: CryptoExecutionAdapterKind | null;
  readonly attestorAuthorizationDigest: string;
  readonly attestorAuthorizationDigestBytes32: string;
  readonly staticCall: CryptoErc1271StaticCallPlan;
  readonly counterfactual: CryptoErc1271CounterfactualPlan | null;
  readonly modular: CryptoErc1271ModularPlan | null;
  readonly defensiveRehashing: CryptoErc1271DefensiveRehashingPlan;
  readonly validationChecks: readonly string[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoEoaSignatureValidationProjection {
  readonly version: typeof CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION;
  readonly projectionKind: 'signature-validation';
  readonly subjectKind: 'eoa';
  readonly validationMode: 'eip-712-eoa';
  readonly envelopeId: string;
  readonly chainId: string;
  readonly accountAddress: string;
  readonly signerAddress: string;
  readonly adapterKind: CryptoExecutionAdapterKind | null;
  readonly attestorAuthorizationDigest: string;
  readonly attestorAuthorizationDigestBytes32: string;
  readonly expectedRecoveredSigner: string;
  readonly erc1271StaticCall: null;
  readonly validationChecks: readonly string[];
  readonly canonical: string;
  readonly digest: string;
}

export type CryptoSignatureValidationProjection =
  | CryptoErc1271ValidationProjection
  | CryptoEoaSignatureValidationProjection;

export interface CreateCryptoSignatureValidationProjectionInput {
  readonly envelope: CryptoEip712AuthorizationEnvelope;
  readonly signature: string;
  readonly validationPath?: CryptoErc1271ValidationPath;
  readonly validatorContract?: string | null;
  readonly expectedSigner?: string | null;
  readonly adapterKind?: CryptoExecutionAdapterKind | null;
  readonly allowCounterfactual?: boolean;
  readonly factory?: string | null;
  readonly factoryCalldata?: string | null;
  readonly module?: string | null;
  readonly moduleType?: CryptoModularValidationModuleType | null;
}

export interface EvaluateCryptoErc1271ValidationResultInput {
  readonly projection: CryptoErc1271ValidationProjection;
  readonly returnValue?: string | null;
  readonly reverted?: boolean;
  readonly revertReason?: string | null;
  readonly blockNumber?: number | string | null;
  readonly validatedAtEpochSeconds?: number | null;
}

export interface CryptoErc1271ValidationResult {
  readonly version: typeof CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION;
  readonly projectionDigest: string;
  readonly status: CryptoErc1271ResultStatus;
  readonly accepted: boolean;
  readonly magicValueMatched: boolean;
  readonly returnValue: string | null;
  readonly returnBytes4: string | null;
  readonly blockNumber: number | string | null;
  readonly validatedAtEpochSeconds: number | null;
  readonly reasonCodes: readonly string[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoErc1271ValidationProjectionDescriptor {
  readonly version: typeof CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION;
  readonly abiSignature: typeof ERC1271_IS_VALID_SIGNATURE_ABI;
  readonly selector: typeof ERC1271_IS_VALID_SIGNATURE_SELECTOR;
  readonly magicValue: typeof ERC1271_MAGIC_VALUE;
  readonly invalidValue: typeof ERC1271_INVALID_VALUE;
  readonly validationPaths: typeof CRYPTO_ERC1271_VALIDATION_PATHS;
  readonly modularModuleTypes: typeof CRYPTO_MODULAR_VALIDATION_MODULE_TYPES;
  readonly subjectKinds: typeof CRYPTO_SIGNATURE_VALIDATION_SUBJECT_KINDS;
  readonly resultStatuses: typeof CRYPTO_ERC1271_RESULT_STATUSES;
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
const HEX_BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;
const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const BYTES4_PATTERN = /^0x[0-9a-fA-F]{8}$/;
const ABI_ENCODED_BYTES4_PATTERN = /^0x[0-9a-fA-F]{8}[0]{56}$/;

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Crypto ERC-1271 validation projection ${fieldName} requires a non-empty value.`);
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

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(
      `Crypto ERC-1271 validation projection ${fieldName} cannot be blank when provided.`,
    );
  }
  return normalized;
}

function normalizeEvmAddress(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!EVM_ADDRESS_PATTERN.test(normalized)) {
    throw new Error(
      `Crypto ERC-1271 validation projection ${fieldName} must be a 20-byte EVM address.`,
    );
  }
  return normalized.toLowerCase();
}

function normalizeHexBytes(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!HEX_BYTES_PATTERN.test(normalized)) {
    throw new Error(`Crypto ERC-1271 validation projection ${fieldName} must be non-empty 0x hex bytes.`);
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
  throw new Error(
    `Crypto ERC-1271 validation projection ${fieldName} must be sha256:<64 hex> or 0x<32 bytes>.`,
  );
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

function canonicalObject<T extends CanonicalJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  return Object.freeze({
    canonical: canonicalizeJson(value),
    digest: digestCanonicalJson(value),
  });
}

function assertExpectedSigner(
  envelope: CryptoEip712AuthorizationEnvelope,
  expectedSigner: string | null,
): void {
  if (expectedSigner === null) {
    return;
  }

  const normalizedExpectedSigner = normalizeEvmAddress(expectedSigner, 'expectedSigner');
  if (normalizedExpectedSigner !== envelope.signerBinding.signerAddress) {
    throw new Error(
      'Crypto ERC-1271 validation projection expectedSigner must match the envelope signer.',
    );
  }
}

function assertKnownValidationPath(path: CryptoErc1271ValidationPath): void {
  if (!includesValue(CRYPTO_ERC1271_VALIDATION_PATHS, path)) {
    throw new Error(
      `Crypto ERC-1271 validation projection does not support validation path ${path}.`,
    );
  }
}

function assertKnownModuleType(moduleType: CryptoModularValidationModuleType): void {
  if (!includesValue(CRYPTO_MODULAR_VALIDATION_MODULE_TYPES, moduleType)) {
    throw new Error(
      `Crypto ERC-1271 validation projection does not support module type ${moduleType}.`,
    );
  }
}

function counterfactualPlanFor(
  input: CreateCryptoSignatureValidationProjectionInput,
  signature: string,
  validationPath: CryptoErc1271ValidationPath,
): CryptoErc1271CounterfactualPlan | null {
  if (validationPath !== 'counterfactual-erc6492') {
    return null;
  }

  if (input.allowCounterfactual !== true) {
    throw new Error(
      'Crypto ERC-1271 validation projection counterfactual validation must be explicitly enabled.',
    );
  }

  const factory = normalizeEvmAddress(input.factory ?? '', 'factory');
  const factoryCalldata = normalizeHexBytes(input.factoryCalldata ?? '', 'factoryCalldata');
  const signatureHasSuffix = signature.endsWith(ERC6492_DETECTION_SUFFIX.slice(2));

  return Object.freeze({
    standard: 'ERC-6492',
    enabled: true,
    detectionSuffix: ERC6492_DETECTION_SUFFIX,
    factory,
    factoryCalldata,
    verificationOrder: Object.freeze([
      'detect-erc6492-suffix',
      signatureHasSuffix ? 'unwrap-factory-calldata-and-signature' : 'require-explicit-wrapper-or-adapter-preparation',
      'eth-call-factory-prepare-if-needed',
      'erc1271-staticcall',
      'fallback-ecrecover-only-if-no-contract-code',
    ]),
  });
}

function modularPlanFor(
  input: CreateCryptoSignatureValidationProjectionInput,
  validationPath: CryptoErc1271ValidationPath,
): CryptoErc1271ModularPlan | null {
  if (validationPath !== 'modular-validator') {
    return null;
  }

  const module = normalizeEvmAddress(input.module ?? '', 'module');
  const moduleType = input.moduleType ?? 'validator';
  assertKnownModuleType(moduleType);

  if (moduleType !== 'validator') {
    throw new Error(
      'Crypto ERC-1271 validation projection modular-validator path requires a validator module.',
    );
  }

  return Object.freeze({
    standard: 'ERC-7579',
    module,
    moduleType,
    validatorRequired: true,
  });
}

function validationChecksFor(
  projection: Pick<
    CryptoErc1271ValidationProjection,
    'validationPath' | 'accountAddress' | 'validatorContract' | 'chainId'
  >,
): readonly string[] {
  const checks = [
    'signature-validation-mode-is-erc1271-contract',
    'attestor-envelope-digest-is-bytes32',
    'staticcall-is-required',
    'isValidSignature-selector-is-0x1626ba7e',
    'magic-value-must-match-0x1626ba7e',
    'account-address-is-bound-in-envelope',
    'chain-id-is-bound-in-envelope',
    'eip712-domain-is-bound-in-envelope',
    'nonce-and-validity-window-come-from-envelope',
  ];

  if (projection.validatorContract !== projection.accountAddress) {
    checks.push('validator-contract-is-explicitly-projected');
  }
  if (projection.validationPath === 'counterfactual-erc6492') {
    checks.push('erc6492-counterfactual-wrapper-is-declared');
  }
  if (projection.validationPath === 'modular-validator') {
    checks.push('erc7579-validator-module-is-declared');
  }
  if (projection.validationPath === 'safe-guard') {
    checks.push('safe-guard-path-is-declared');
  }

  return Object.freeze(checks);
}

function eoaValidationChecks(): readonly string[] {
  return Object.freeze([
    'signature-validation-mode-is-eip712-eoa',
    'attestor-envelope-digest-is-bytes32',
    'ecrecover-or-wallet-verifier-must-match-envelope-signer',
    'account-address-is-bound-in-envelope',
    'chain-id-is-bound-in-envelope',
    'eip712-domain-is-bound-in-envelope',
    'nonce-and-validity-window-come-from-envelope',
  ]);
}

function resultReasonCodesFor(
  status: CryptoErc1271ResultStatus,
  returnBytes4: string | null,
  malformed: boolean,
  reverted: boolean,
): readonly string[] {
  if (status === 'valid') {
    return Object.freeze(['erc1271-magic-value-matched']);
  }
  if (reverted) {
    return Object.freeze(['erc1271-call-reverted']);
  }
  if (malformed) {
    return Object.freeze(['erc1271-return-value-malformed']);
  }
  if (returnBytes4 === null) {
    return Object.freeze(['erc1271-return-value-missing']);
  }
  if (returnBytes4 === ERC1271_INVALID_VALUE) {
    return Object.freeze(['erc1271-invalid-value-returned']);
  }
  return Object.freeze(['erc1271-magic-value-mismatch']);
}

export function isCryptoErc1271ValidationPath(
  value: string,
): value is CryptoErc1271ValidationPath {
  return includesValue(CRYPTO_ERC1271_VALIDATION_PATHS, value);
}

export function isCryptoModularValidationModuleType(
  value: string,
): value is CryptoModularValidationModuleType {
  return includesValue(CRYPTO_MODULAR_VALIDATION_MODULE_TYPES, value);
}

export function isCryptoErc1271ResultStatus(
  value: string,
): value is CryptoErc1271ResultStatus {
  return includesValue(CRYPTO_ERC1271_RESULT_STATUSES, value);
}

export function extractCryptoErc1271ReturnBytes4(returnValue: string): string {
  const normalized = normalizeHexBytes(returnValue, 'returnValue');
  if (BYTES4_PATTERN.test(normalized)) {
    return normalized;
  }
  if (ABI_ENCODED_BYTES4_PATTERN.test(normalized)) {
    return `0x${normalized.slice(2, 10)}`;
  }
  throw new Error(
    'Crypto ERC-1271 validation projection returnValue must be bytes4 or ABI-encoded bytes4.',
  );
}

export function createCryptoErc1271ValidationProjection(
  input: CreateCryptoSignatureValidationProjectionInput,
): CryptoErc1271ValidationProjection {
  const { envelope } = input;
  if (envelope.signerBinding.signatureValidationMode !== 'erc-1271-contract') {
    throw new Error(
      'Crypto ERC-1271 validation projection requires an erc-1271-contract envelope.',
    );
  }

  const signature = normalizeHexBytes(input.signature, 'signature');
  const validationPath = input.validationPath ?? 'deployed-contract';
  assertKnownValidationPath(validationPath);
  assertExpectedSigner(envelope, normalizeOptionalIdentifier(input.expectedSigner, 'expectedSigner'));

  const validatorContract = normalizeEvmAddress(
    input.validatorContract ?? envelope.signerBinding.accountAddress,
    'validatorContract',
  );
  const digestBytes32 = digestToBytes32(envelope.digest, 'attestorAuthorizationDigest');
  const counterfactual = counterfactualPlanFor(input, signature, validationPath);
  const modular = modularPlanFor(input, validationPath);

  const staticCall: CryptoErc1271StaticCallPlan = Object.freeze({
    callKind: 'erc-1271-is-valid-signature',
    callType: 'staticcall',
    to: validatorContract,
    selector: ERC1271_IS_VALID_SIGNATURE_SELECTOR,
    abiSignature: ERC1271_IS_VALID_SIGNATURE_ABI,
    stateMutability: 'view',
    arguments: Object.freeze({
      hash: digestBytes32,
      signature,
    }),
    expectedReturnValue: ERC1271_MAGIC_VALUE,
    invalidReturnValue: ERC1271_INVALID_VALUE,
    gasPolicy: 'do-not-hardcode-gas-limit',
  });
  const baseProjection = {
    version: CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION,
    projectionKind: 'signature-validation',
    subjectKind: 'smart-account',
    validationMode: 'erc-1271-contract',
    validationPath,
    envelopeId: envelope.envelopeId,
    chainId: envelope.chainBinding.caip2ChainId,
    accountAddress: envelope.signerBinding.accountAddress,
    signerAddress: envelope.signerBinding.signerAddress,
    validatorContract,
    adapterKind: input.adapterKind ?? null,
    attestorAuthorizationDigest: envelope.digest,
    attestorAuthorizationDigestBytes32: digestBytes32,
    staticCall,
    counterfactual,
    modular,
    defensiveRehashing: Object.freeze({
      standard: 'ERC-7739',
      accountAddress: envelope.signerBinding.accountAddress,
      chainId: envelope.chainBinding.caip2ChainId,
      domainVerifyingContract: envelope.typedData.domain.verifyingContract,
      supportDetectionHash: ERC7739_SUPPORT_DETECTION_HASH,
      supportMagicValue: ERC7739_SUPPORT_MAGIC_VALUE,
      safeToSkipReason: 'attestor-envelope-binds-account-chain-domain',
    }),
  } as const;
  const validationChecks = validationChecksFor(baseProjection);
  const canonicalPayload = {
    ...baseProjection,
    validationChecks,
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalJsonValue);

  return Object.freeze({
    ...baseProjection,
    validationChecks,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function createCryptoEoaSignatureValidationProjection(
  input: CreateCryptoSignatureValidationProjectionInput,
): CryptoEoaSignatureValidationProjection {
  const { envelope } = input;
  if (envelope.signerBinding.signatureValidationMode !== 'eip-712-eoa') {
    throw new Error(
      'Crypto ERC-1271 validation projection EOA path requires an eip-712-eoa envelope.',
    );
  }

  normalizeHexBytes(input.signature, 'signature');
  assertExpectedSigner(envelope, normalizeOptionalIdentifier(input.expectedSigner, 'expectedSigner'));
  const digestBytes32 = digestToBytes32(envelope.digest, 'attestorAuthorizationDigest');
  const baseProjection = {
    version: CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION,
    projectionKind: 'signature-validation',
    subjectKind: 'eoa',
    validationMode: 'eip-712-eoa',
    envelopeId: envelope.envelopeId,
    chainId: envelope.chainBinding.caip2ChainId,
    accountAddress: envelope.signerBinding.accountAddress,
    signerAddress: envelope.signerBinding.signerAddress,
    adapterKind: input.adapterKind ?? null,
    attestorAuthorizationDigest: envelope.digest,
    attestorAuthorizationDigestBytes32: digestBytes32,
    expectedRecoveredSigner: envelope.signerBinding.signerAddress,
    erc1271StaticCall: null,
    validationChecks: eoaValidationChecks(),
  } as const;
  const canonical = canonicalObject(baseProjection as unknown as CanonicalJsonValue);

  return Object.freeze({
    ...baseProjection,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function createCryptoSignatureValidationProjection(
  input: CreateCryptoSignatureValidationProjectionInput,
): CryptoSignatureValidationProjection {
  switch (input.envelope.signerBinding.signatureValidationMode) {
    case 'erc-1271-contract':
      return createCryptoErc1271ValidationProjection(input);
    case 'eip-712-eoa':
      return createCryptoEoaSignatureValidationProjection(input);
    default:
      throw new Error(
        `Crypto ERC-1271 validation projection does not support envelope validation mode ${input.envelope.signerBinding.signatureValidationMode}.`,
      );
  }
}

export function evaluateCryptoErc1271ValidationResult(
  input: EvaluateCryptoErc1271ValidationResultInput,
): CryptoErc1271ValidationResult {
  const reverted = input.reverted === true;
  const normalizedReturnValue =
    input.returnValue === undefined || input.returnValue === null
      ? null
      : normalizeHexBytes(input.returnValue, 'returnValue');
  let returnBytes4: string | null = null;
  let malformed = false;

  if (normalizedReturnValue !== null && !reverted) {
    try {
      returnBytes4 = extractCryptoErc1271ReturnBytes4(normalizedReturnValue);
    } catch {
      malformed = true;
    }
  }

  const magicValueMatched = returnBytes4 === ERC1271_MAGIC_VALUE;
  const status: CryptoErc1271ResultStatus = reverted || malformed || returnBytes4 === null
    ? 'indeterminate'
    : magicValueMatched
      ? 'valid'
      : 'invalid';
  const reasonCodes = resultReasonCodesFor(status, returnBytes4, malformed, reverted);
  const payload = {
    version: CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION,
    projectionDigest: input.projection.digest,
    status,
    accepted: status === 'valid',
    magicValueMatched,
    returnValue: normalizedReturnValue,
    returnBytes4,
    blockNumber: input.blockNumber ?? null,
    validatedAtEpochSeconds: input.validatedAtEpochSeconds ?? null,
    reasonCodes,
    revertReason: input.revertReason ?? null,
  } as const;
  const canonical = canonicalObject(payload as unknown as CanonicalJsonValue);

  return Object.freeze({
    version: CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION,
    projectionDigest: input.projection.digest,
    status,
    accepted: status === 'valid',
    magicValueMatched,
    returnValue: normalizedReturnValue,
    returnBytes4,
    blockNumber: input.blockNumber ?? null,
    validatedAtEpochSeconds: input.validatedAtEpochSeconds ?? null,
    reasonCodes,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function cryptoErc1271ValidationProjectionLabel(
  projection: CryptoSignatureValidationProjection,
): string {
  if (projection.subjectKind === 'eoa') {
    return [
      `validation:${projection.envelopeId}`,
      `mode:${projection.validationMode}`,
      `chain:${projection.chainId}`,
      `signer:${projection.signerAddress}`,
    ].join(' / ');
  }

  return [
    `validation:${projection.envelopeId}`,
    `mode:${projection.validationMode}`,
    `path:${projection.validationPath}`,
    `chain:${projection.chainId}`,
    `account:${projection.accountAddress}`,
    `validator:${projection.validatorContract}`,
  ].join(' / ');
}

export function cryptoErc1271ValidationProjectionDescriptor():
CryptoErc1271ValidationProjectionDescriptor {
  return Object.freeze({
    version: CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION,
    abiSignature: ERC1271_IS_VALID_SIGNATURE_ABI,
    selector: ERC1271_IS_VALID_SIGNATURE_SELECTOR,
    magicValue: ERC1271_MAGIC_VALUE,
    invalidValue: ERC1271_INVALID_VALUE,
    validationPaths: CRYPTO_ERC1271_VALIDATION_PATHS,
    modularModuleTypes: CRYPTO_MODULAR_VALIDATION_MODULE_TYPES,
    subjectKinds: CRYPTO_SIGNATURE_VALIDATION_SUBJECT_KINDS,
    resultStatuses: CRYPTO_ERC1271_RESULT_STATUSES,
    standards: Object.freeze([
      'ERC-1271',
      'EIP-712',
      'EIP-191',
      'ERC-6492-ready',
      'ERC-7579-ready',
      'ERC-7739-ready',
    ]),
  });
}
