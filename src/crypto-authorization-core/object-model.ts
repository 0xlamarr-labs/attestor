import {
  CRYPTO_AUTHORIZATION_ARTIFACT_KINDS,
  CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES,
  type CryptoAccountReference,
  type CryptoAssetReference,
  type CryptoAuthorizationArtifactKind,
  type CryptoAuthorizationConsequenceKind,
  type CryptoAuthorizationPolicyDimension,
  type CryptoAuthorizationRiskClass,
  type CryptoChainReference,
  type CryptoExecutionAdapterKind,
  isCryptoAuthorizationArtifactKind,
  isCryptoAuthorizationConsequenceKind,
  isCryptoAuthorizationPolicyDimension,
  isCryptoExecutionAdapterKind,
} from './types.js';

/**
 * Versioned object model for Attestor's crypto authorization core.
 *
 * Step 02 defines the durable object boundaries only. It deliberately does not
 * implement EIP-712 hashing, ERC-1271 calls, UserOperation packing, wallet RPCs,
 * custody API calls, or Safe-specific behavior. Those belong to later adapter
 * steps that project this common object model outward.
 */

export const CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION =
  'attestor.crypto-authorization-object-model.v1';

export const CRYPTO_AUTHORIZATION_OBJECT_KINDS = [
  'authorization-intent',
  'authorization-decision',
  'authorization-receipt',
  'execution-projection',
] as const;
export type CryptoAuthorizationObjectKind =
  typeof CRYPTO_AUTHORIZATION_OBJECT_KINDS[number];

export const CRYPTO_AUTHORIZATION_ACTOR_KINDS = [
  'human',
  'service',
  'agent',
  'wallet',
  'custody-system',
] as const;
export type CryptoAuthorizationActorKind =
  typeof CRYPTO_AUTHORIZATION_ACTOR_KINDS[number];

export const CRYPTO_EXECUTION_TARGET_KINDS = [
  'address',
  'contract',
  'module',
  'payee',
  'bridge',
  'intent-solver',
  'custody-destination',
  'governance-proposal',
] as const;
export type CryptoExecutionTargetKind =
  typeof CRYPTO_EXECUTION_TARGET_KINDS[number];

export const CRYPTO_AUTHORIZATION_DECISION_STATUSES = [
  'allow',
  'deny',
  'review-required',
  'expired',
  'revoked',
] as const;
export type CryptoAuthorizationDecisionStatus =
  typeof CRYPTO_AUTHORIZATION_DECISION_STATUSES[number];

export const CRYPTO_SIGNER_AUTHORITY_KINDS = [
  'attestor-issuer',
  'eoa-signer',
  'smart-account',
  'custody-policy-engine',
  'wallet-permission-controller',
  'reviewer-quorum',
] as const;
export type CryptoSignerAuthorityKind =
  typeof CRYPTO_SIGNER_AUTHORITY_KINDS[number];

export const CRYPTO_SIGNATURE_VALIDATION_MODES = [
  'attestor-release-signature',
  'eip-712-eoa',
  'erc-1271-contract',
  'wallet-native-permission',
  'custody-policy-decision',
] as const;
export type CryptoSignatureValidationMode =
  typeof CRYPTO_SIGNATURE_VALIDATION_MODES[number];

export const CRYPTO_REPLAY_PROTECTION_MODES = [
  'nonce',
  'user-operation-nonce',
  'authorization-list-nonce',
  'one-time-receipt',
  'session-budget',
  'idempotency-key',
] as const;
export type CryptoReplayProtectionMode =
  typeof CRYPTO_REPLAY_PROTECTION_MODES[number];

export const CRYPTO_AUTHORIZATION_DIGEST_MODES = [
  'attestor-canonical-json',
  'eip-712-typed-data',
  'user-operation-hash',
  'wallet-call-batch-hash',
  'http-payment-hash',
  'custody-policy-hash',
] as const;
export type CryptoAuthorizationDigestMode =
  typeof CRYPTO_AUTHORIZATION_DIGEST_MODES[number];

export interface CryptoAuthorizationActor {
  readonly actorKind: CryptoAuthorizationActorKind;
  readonly actorId: string;
  readonly authorityRef: string | null;
}

export interface CreateCryptoAuthorizationActorInput {
  readonly actorKind: CryptoAuthorizationActorKind;
  readonly actorId: string;
  readonly authorityRef?: string | null;
}

export interface CryptoExecutionTarget {
  readonly targetKind: CryptoExecutionTargetKind;
  readonly chain: CryptoChainReference;
  readonly targetId: string;
  readonly address: string | null;
  readonly counterparty: string | null;
  readonly protocol: string | null;
  readonly functionSelector: string | null;
  readonly calldataClass: string | null;
}

export interface CreateCryptoExecutionTargetInput {
  readonly targetKind: CryptoExecutionTargetKind;
  readonly chain: CryptoChainReference;
  readonly targetId: string;
  readonly address?: string | null;
  readonly counterparty?: string | null;
  readonly protocol?: string | null;
  readonly functionSelector?: string | null;
  readonly calldataClass?: string | null;
}

export interface CryptoAuthorizationPolicyScope {
  readonly dimensions: readonly CryptoAuthorizationPolicyDimension[];
  readonly environment: string | null;
  readonly tenantId: string | null;
  readonly accountId: string | null;
  readonly policyPackRef: string | null;
}

export interface CreateCryptoAuthorizationPolicyScopeInput {
  readonly dimensions: readonly CryptoAuthorizationPolicyDimension[];
  readonly environment?: string | null;
  readonly tenantId?: string | null;
  readonly accountId?: string | null;
  readonly policyPackRef?: string | null;
}

export interface CryptoAuthorizationConstraints {
  readonly validAfter: string;
  readonly validUntil: string;
  readonly nonce: string;
  readonly replayProtectionMode: CryptoReplayProtectionMode;
  readonly digestMode: CryptoAuthorizationDigestMode;
  readonly requiredArtifacts: readonly CryptoAuthorizationArtifactKind[];
  readonly maxAmount: string | null;
  readonly budgetId: string | null;
  readonly cadence: string | null;
}

export interface CreateCryptoAuthorizationConstraintsInput {
  readonly validAfter: string;
  readonly validUntil: string;
  readonly nonce: string;
  readonly replayProtectionMode: CryptoReplayProtectionMode;
  readonly digestMode: CryptoAuthorizationDigestMode;
  readonly requiredArtifacts: readonly CryptoAuthorizationArtifactKind[];
  readonly maxAmount?: string | null;
  readonly budgetId?: string | null;
  readonly cadence?: string | null;
}

export interface CryptoAuthorizationIntent {
  readonly objectKind: 'authorization-intent';
  readonly version: typeof CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION;
  readonly intentId: string;
  readonly requestedAt: string;
  readonly requester: CryptoAuthorizationActor;
  readonly account: CryptoAccountReference;
  readonly chain: CryptoChainReference;
  readonly consequenceKind: CryptoAuthorizationConsequenceKind;
  readonly target: CryptoExecutionTarget;
  readonly asset: CryptoAssetReference | null;
  readonly policyScope: CryptoAuthorizationPolicyScope;
  readonly constraints: CryptoAuthorizationConstraints;
  readonly executionAdapterKind: CryptoExecutionAdapterKind | null;
  readonly evidenceRefs: readonly string[];
}

export interface CreateCryptoAuthorizationIntentInput {
  readonly intentId: string;
  readonly requestedAt: string;
  readonly requester: CryptoAuthorizationActor;
  readonly account: CryptoAccountReference;
  readonly consequenceKind: CryptoAuthorizationConsequenceKind;
  readonly target: CryptoExecutionTarget;
  readonly asset?: CryptoAssetReference | null;
  readonly policyScope: CryptoAuthorizationPolicyScope;
  readonly constraints: CryptoAuthorizationConstraints;
  readonly executionAdapterKind?: CryptoExecutionAdapterKind | null;
  readonly evidenceRefs?: readonly string[];
}

export interface CryptoSignerAuthority {
  readonly authorityKind: CryptoSignerAuthorityKind;
  readonly authorityId: string;
  readonly validationMode: CryptoSignatureValidationMode;
  readonly address: string | null;
  readonly keyRef: string | null;
}

export interface CreateCryptoSignerAuthorityInput {
  readonly authorityKind: CryptoSignerAuthorityKind;
  readonly authorityId: string;
  readonly validationMode: CryptoSignatureValidationMode;
  readonly address?: string | null;
  readonly keyRef?: string | null;
}

export interface CryptoAuthorizationDecision {
  readonly objectKind: 'authorization-decision';
  readonly version: typeof CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION;
  readonly decisionId: string;
  readonly intentId: string;
  readonly decidedAt: string;
  readonly status: CryptoAuthorizationDecisionStatus;
  readonly riskClass: CryptoAuthorizationRiskClass;
  readonly releaseDecisionId: string | null;
  readonly reasonCodes: readonly string[];
  readonly signerAuthorities: readonly CryptoSignerAuthority[];
  readonly requiredArtifacts: readonly CryptoAuthorizationArtifactKind[];
  readonly validAfter: string;
  readonly validUntil: string;
  readonly nonce: string;
}

export interface CreateCryptoAuthorizationDecisionInput {
  readonly decisionId: string;
  readonly intent: CryptoAuthorizationIntent;
  readonly decidedAt: string;
  readonly status: CryptoAuthorizationDecisionStatus;
  readonly riskClass?: CryptoAuthorizationRiskClass;
  readonly releaseDecisionId?: string | null;
  readonly reasonCodes?: readonly string[];
  readonly signerAuthorities?: readonly CryptoSignerAuthority[];
  readonly requiredArtifacts?: readonly CryptoAuthorizationArtifactKind[];
}

export interface CryptoAuthorizationReceipt {
  readonly objectKind: 'authorization-receipt';
  readonly version: typeof CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION;
  readonly receiptId: string;
  readonly decisionId: string;
  readonly intentId: string;
  readonly issuedAt: string;
  readonly artifactKind: CryptoAuthorizationArtifactKind;
  readonly digestMode: CryptoAuthorizationDigestMode;
  readonly authorizationDigest: string;
  readonly evidenceDigest: string;
  readonly signerAuthority: CryptoSignerAuthority;
  readonly signatureValidationMode: CryptoSignatureValidationMode;
}

export interface CreateCryptoAuthorizationReceiptInput {
  readonly receiptId: string;
  readonly decision: CryptoAuthorizationDecision;
  readonly issuedAt: string;
  readonly artifactKind: CryptoAuthorizationArtifactKind;
  readonly digestMode: CryptoAuthorizationDigestMode;
  readonly authorizationDigest: string;
  readonly evidenceDigest: string;
  readonly signerAuthority: CryptoSignerAuthority;
  readonly signatureValidationMode?: CryptoSignatureValidationMode;
}

export interface CryptoExecutionProjection {
  readonly objectKind: 'execution-projection';
  readonly version: typeof CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION;
  readonly projectionId: string;
  readonly receiptId: string;
  readonly adapterKind: CryptoExecutionAdapterKind;
  readonly target: CryptoExecutionTarget;
  readonly digestMode: CryptoAuthorizationDigestMode;
  readonly projectedArtifactDigest: string;
}

export interface CreateCryptoExecutionProjectionInput {
  readonly projectionId: string;
  readonly receipt: CryptoAuthorizationReceipt;
  readonly adapterKind: CryptoExecutionAdapterKind;
  readonly target: CryptoExecutionTarget;
  readonly digestMode: CryptoAuthorizationDigestMode;
  readonly projectedArtifactDigest: string;
}

export interface CryptoAuthorizationObjectModelDescriptor {
  readonly version: typeof CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION;
  readonly objectKinds: readonly CryptoAuthorizationObjectKind[];
  readonly actorKinds: readonly CryptoAuthorizationActorKind[];
  readonly executionTargetKinds: readonly CryptoExecutionTargetKind[];
  readonly decisionStatuses: readonly CryptoAuthorizationDecisionStatus[];
  readonly signerAuthorityKinds: readonly CryptoSignerAuthorityKind[];
  readonly signatureValidationModes: readonly CryptoSignatureValidationMode[];
  readonly replayProtectionModes: readonly CryptoReplayProtectionMode[];
  readonly digestModes: readonly CryptoAuthorizationDigestMode[];
}

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Crypto authorization object model ${fieldName} requires a non-empty value.`);
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
      `Crypto authorization object model ${fieldName} cannot be blank when provided.`,
    );
  }

  return normalized;
}

function normalizeIdentifierList(
  values: readonly string[] | undefined,
  fieldName: string,
): readonly string[] {
  if (values === undefined) {
    return Object.freeze([]);
  }

  return Object.freeze(
    values.map((value) => normalizeIdentifier(value, fieldName)),
  );
}

function assertKnownArtifactKinds(
  values: readonly CryptoAuthorizationArtifactKind[],
): readonly CryptoAuthorizationArtifactKind[] {
  for (const value of values) {
    if (!isCryptoAuthorizationArtifactKind(value)) {
      throw new Error(
        `Crypto authorization object model does not support artifact kind ${value}.`,
      );
    }
  }

  return Object.freeze([...values]);
}

function assertValidIsoRange(validAfter: string, validUntil: string): void {
  const afterTime = Date.parse(validAfter);
  const untilTime = Date.parse(validUntil);

  if (!Number.isFinite(afterTime)) {
    throw new Error('Crypto authorization object model validAfter must be an ISO timestamp.');
  }
  if (!Number.isFinite(untilTime)) {
    throw new Error('Crypto authorization object model validUntil must be an ISO timestamp.');
  }
  if (afterTime >= untilTime) {
    throw new Error('Crypto authorization object model validAfter must be before validUntil.');
  }
}

function sameChain(left: CryptoChainReference, right: CryptoChainReference): boolean {
  return (
    left.namespace === right.namespace &&
    left.chainId === right.chainId &&
    left.runtimeFamily === right.runtimeFamily
  );
}

function requiredDimensionsFor(
  consequenceKind: CryptoAuthorizationConsequenceKind,
): readonly CryptoAuthorizationPolicyDimension[] {
  return CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[consequenceKind].requiredPolicyDimensions;
}

export function isCryptoAuthorizationObjectKind(
  value: string,
): value is CryptoAuthorizationObjectKind {
  return includesValue(CRYPTO_AUTHORIZATION_OBJECT_KINDS, value);
}

export function isCryptoAuthorizationActorKind(
  value: string,
): value is CryptoAuthorizationActorKind {
  return includesValue(CRYPTO_AUTHORIZATION_ACTOR_KINDS, value);
}

export function isCryptoExecutionTargetKind(
  value: string,
): value is CryptoExecutionTargetKind {
  return includesValue(CRYPTO_EXECUTION_TARGET_KINDS, value);
}

export function isCryptoAuthorizationDecisionStatus(
  value: string,
): value is CryptoAuthorizationDecisionStatus {
  return includesValue(CRYPTO_AUTHORIZATION_DECISION_STATUSES, value);
}

export function isCryptoSignerAuthorityKind(
  value: string,
): value is CryptoSignerAuthorityKind {
  return includesValue(CRYPTO_SIGNER_AUTHORITY_KINDS, value);
}

export function isCryptoSignatureValidationMode(
  value: string,
): value is CryptoSignatureValidationMode {
  return includesValue(CRYPTO_SIGNATURE_VALIDATION_MODES, value);
}

export function isCryptoReplayProtectionMode(
  value: string,
): value is CryptoReplayProtectionMode {
  return includesValue(CRYPTO_REPLAY_PROTECTION_MODES, value);
}

export function isCryptoAuthorizationDigestMode(
  value: string,
): value is CryptoAuthorizationDigestMode {
  return includesValue(CRYPTO_AUTHORIZATION_DIGEST_MODES, value);
}

export function createCryptoAuthorizationActor(
  input: CreateCryptoAuthorizationActorInput,
): CryptoAuthorizationActor {
  if (!isCryptoAuthorizationActorKind(input.actorKind)) {
    throw new Error(
      `Crypto authorization object model does not support actor kind ${input.actorKind}.`,
    );
  }

  return Object.freeze({
    actorKind: input.actorKind,
    actorId: normalizeIdentifier(input.actorId, 'actorId'),
    authorityRef: normalizeOptionalIdentifier(input.authorityRef, 'authorityRef'),
  });
}

export function createCryptoExecutionTarget(
  input: CreateCryptoExecutionTargetInput,
): CryptoExecutionTarget {
  if (!isCryptoExecutionTargetKind(input.targetKind)) {
    throw new Error(
      `Crypto authorization object model does not support execution target kind ${input.targetKind}.`,
    );
  }

  return Object.freeze({
    targetKind: input.targetKind,
    chain: input.chain,
    targetId: normalizeIdentifier(input.targetId, 'targetId'),
    address: normalizeOptionalIdentifier(input.address, 'address'),
    counterparty: normalizeOptionalIdentifier(input.counterparty, 'counterparty'),
    protocol: normalizeOptionalIdentifier(input.protocol, 'protocol'),
    functionSelector: normalizeOptionalIdentifier(input.functionSelector, 'functionSelector'),
    calldataClass: normalizeOptionalIdentifier(input.calldataClass, 'calldataClass'),
  });
}

export function createCryptoAuthorizationPolicyScope(
  input: CreateCryptoAuthorizationPolicyScopeInput,
): CryptoAuthorizationPolicyScope {
  const uniqueDimensions = [...new Set(input.dimensions)];
  if (uniqueDimensions.length === 0) {
    throw new Error(
      'Crypto authorization object model policy scope requires at least one dimension.',
    );
  }

  for (const dimension of uniqueDimensions) {
    if (!isCryptoAuthorizationPolicyDimension(dimension)) {
      throw new Error(
        `Crypto authorization object model does not support policy dimension ${dimension}.`,
      );
    }
  }

  return Object.freeze({
    dimensions: Object.freeze(uniqueDimensions),
    environment: normalizeOptionalIdentifier(input.environment, 'environment'),
    tenantId: normalizeOptionalIdentifier(input.tenantId, 'tenantId'),
    accountId: normalizeOptionalIdentifier(input.accountId, 'accountId'),
    policyPackRef: normalizeOptionalIdentifier(input.policyPackRef, 'policyPackRef'),
  });
}

export function createCryptoAuthorizationConstraints(
  input: CreateCryptoAuthorizationConstraintsInput,
): CryptoAuthorizationConstraints {
  const validAfter = normalizeIdentifier(input.validAfter, 'validAfter');
  const validUntil = normalizeIdentifier(input.validUntil, 'validUntil');
  assertValidIsoRange(validAfter, validUntil);

  if (!isCryptoReplayProtectionMode(input.replayProtectionMode)) {
    throw new Error(
      `Crypto authorization object model does not support replay protection mode ${input.replayProtectionMode}.`,
    );
  }

  if (!isCryptoAuthorizationDigestMode(input.digestMode)) {
    throw new Error(
      `Crypto authorization object model does not support digest mode ${input.digestMode}.`,
    );
  }

  return Object.freeze({
    validAfter,
    validUntil,
    nonce: normalizeIdentifier(input.nonce, 'nonce'),
    replayProtectionMode: input.replayProtectionMode,
    digestMode: input.digestMode,
    requiredArtifacts: assertKnownArtifactKinds(input.requiredArtifacts),
    maxAmount: normalizeOptionalIdentifier(input.maxAmount, 'maxAmount'),
    budgetId: normalizeOptionalIdentifier(input.budgetId, 'budgetId'),
    cadence: normalizeOptionalIdentifier(input.cadence, 'cadence'),
  });
}

export function createCryptoAuthorizationIntent(
  input: CreateCryptoAuthorizationIntentInput,
): CryptoAuthorizationIntent {
  if (!isCryptoAuthorizationConsequenceKind(input.consequenceKind)) {
    throw new Error(
      `Crypto authorization object model does not support consequence kind ${input.consequenceKind}.`,
    );
  }

  if (input.executionAdapterKind != null && !isCryptoExecutionAdapterKind(input.executionAdapterKind)) {
    throw new Error(
      `Crypto authorization object model does not support execution adapter kind ${input.executionAdapterKind}.`,
    );
  }

  if (!sameChain(input.account.chain, input.target.chain)) {
    throw new Error('Crypto authorization object model account and target must share a chain.');
  }

  if (input.asset != null && !sameChain(input.account.chain, input.asset.chain)) {
    throw new Error('Crypto authorization object model asset and account must share a chain.');
  }

  const requiredDimensions = requiredDimensionsFor(input.consequenceKind);
  for (const dimension of requiredDimensions) {
    if (!input.policyScope.dimensions.includes(dimension)) {
      throw new Error(
        `Crypto authorization object model policy scope for ${input.consequenceKind} requires ${dimension}.`,
      );
    }
  }

  return Object.freeze({
    objectKind: 'authorization-intent',
    version: CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION,
    intentId: normalizeIdentifier(input.intentId, 'intentId'),
    requestedAt: normalizeIdentifier(input.requestedAt, 'requestedAt'),
    requester: input.requester,
    account: input.account,
    chain: input.account.chain,
    consequenceKind: input.consequenceKind,
    target: input.target,
    asset: input.asset ?? null,
    policyScope: input.policyScope,
    constraints: input.constraints,
    executionAdapterKind: input.executionAdapterKind ?? null,
    evidenceRefs: normalizeIdentifierList(input.evidenceRefs, 'evidenceRefs'),
  });
}

export function createCryptoSignerAuthority(
  input: CreateCryptoSignerAuthorityInput,
): CryptoSignerAuthority {
  if (!isCryptoSignerAuthorityKind(input.authorityKind)) {
    throw new Error(
      `Crypto authorization object model does not support signer authority kind ${input.authorityKind}.`,
    );
  }

  if (!isCryptoSignatureValidationMode(input.validationMode)) {
    throw new Error(
      `Crypto authorization object model does not support signature validation mode ${input.validationMode}.`,
    );
  }

  return Object.freeze({
    authorityKind: input.authorityKind,
    authorityId: normalizeIdentifier(input.authorityId, 'authorityId'),
    validationMode: input.validationMode,
    address: normalizeOptionalIdentifier(input.address, 'address'),
    keyRef: normalizeOptionalIdentifier(input.keyRef, 'keyRef'),
  });
}

export function createCryptoAuthorizationDecision(
  input: CreateCryptoAuthorizationDecisionInput,
): CryptoAuthorizationDecision {
  if (!isCryptoAuthorizationDecisionStatus(input.status)) {
    throw new Error(
      `Crypto authorization object model does not support decision status ${input.status}.`,
    );
  }

  const requiredArtifacts = input.requiredArtifacts ?? input.intent.constraints.requiredArtifacts;
  const signerAuthorities = Object.freeze([...(input.signerAuthorities ?? [])]);

  if (input.status === 'allow' && signerAuthorities.length === 0) {
    throw new Error(
      'Crypto authorization object model allow decisions require at least one signer authority.',
    );
  }

  return Object.freeze({
    objectKind: 'authorization-decision',
    version: CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION,
    decisionId: normalizeIdentifier(input.decisionId, 'decisionId'),
    intentId: input.intent.intentId,
    decidedAt: normalizeIdentifier(input.decidedAt, 'decidedAt'),
    status: input.status,
    riskClass:
      input.riskClass ??
      CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[input.intent.consequenceKind].defaultRiskClass,
    releaseDecisionId: normalizeOptionalIdentifier(input.releaseDecisionId, 'releaseDecisionId'),
    reasonCodes: normalizeIdentifierList(input.reasonCodes, 'reasonCodes'),
    signerAuthorities,
    requiredArtifacts: assertKnownArtifactKinds(requiredArtifacts),
    validAfter: input.intent.constraints.validAfter,
    validUntil: input.intent.constraints.validUntil,
    nonce: input.intent.constraints.nonce,
  });
}

export function createCryptoAuthorizationReceipt(
  input: CreateCryptoAuthorizationReceiptInput,
): CryptoAuthorizationReceipt {
  if (!isCryptoAuthorizationArtifactKind(input.artifactKind)) {
    throw new Error(
      `Crypto authorization object model does not support artifact kind ${input.artifactKind}.`,
    );
  }

  if (!isCryptoAuthorizationDigestMode(input.digestMode)) {
    throw new Error(
      `Crypto authorization object model does not support digest mode ${input.digestMode}.`,
    );
  }

  const signatureValidationMode =
    input.signatureValidationMode ?? input.signerAuthority.validationMode;

  if (signatureValidationMode !== input.signerAuthority.validationMode) {
    throw new Error(
      'Crypto authorization object model receipt validation mode must match signer authority.',
    );
  }

  return Object.freeze({
    objectKind: 'authorization-receipt',
    version: CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION,
    receiptId: normalizeIdentifier(input.receiptId, 'receiptId'),
    decisionId: input.decision.decisionId,
    intentId: input.decision.intentId,
    issuedAt: normalizeIdentifier(input.issuedAt, 'issuedAt'),
    artifactKind: input.artifactKind,
    digestMode: input.digestMode,
    authorizationDigest: normalizeIdentifier(input.authorizationDigest, 'authorizationDigest'),
    evidenceDigest: normalizeIdentifier(input.evidenceDigest, 'evidenceDigest'),
    signerAuthority: input.signerAuthority,
    signatureValidationMode,
  });
}

export function createCryptoExecutionProjection(
  input: CreateCryptoExecutionProjectionInput,
): CryptoExecutionProjection {
  if (!isCryptoExecutionAdapterKind(input.adapterKind)) {
    throw new Error(
      `Crypto authorization object model does not support execution adapter kind ${input.adapterKind}.`,
    );
  }

  if (!isCryptoAuthorizationDigestMode(input.digestMode)) {
    throw new Error(
      `Crypto authorization object model does not support digest mode ${input.digestMode}.`,
    );
  }

  return Object.freeze({
    objectKind: 'execution-projection',
    version: CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION,
    projectionId: normalizeIdentifier(input.projectionId, 'projectionId'),
    receiptId: input.receipt.receiptId,
    adapterKind: input.adapterKind,
    target: input.target,
    digestMode: input.digestMode,
    projectedArtifactDigest: normalizeIdentifier(
      input.projectedArtifactDigest,
      'projectedArtifactDigest',
    ),
  });
}

export function cryptoAuthorizationIntentLabel(intent: CryptoAuthorizationIntent): string {
  return [
    `intent:${intent.intentId}`,
    `consequence:${intent.consequenceKind}`,
    `chain:${intent.chain.namespace}:${intent.chain.chainId}`,
    `account:${intent.account.accountKind}`,
    `target:${intent.target.targetKind}:${intent.target.targetId}`,
    `nonce:${intent.constraints.nonce}`,
  ].join(' / ');
}

export function cryptoAuthorizationDecisionLabel(
  decision: CryptoAuthorizationDecision,
): string {
  return [
    `decision:${decision.decisionId}`,
    `intent:${decision.intentId}`,
    `status:${decision.status}`,
    `risk:${decision.riskClass}`,
    `nonce:${decision.nonce}`,
  ].join(' / ');
}

export function cryptoAuthorizationObjectModelDescriptor(): CryptoAuthorizationObjectModelDescriptor {
  return Object.freeze({
    version: CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION,
    objectKinds: CRYPTO_AUTHORIZATION_OBJECT_KINDS,
    actorKinds: CRYPTO_AUTHORIZATION_ACTOR_KINDS,
    executionTargetKinds: CRYPTO_EXECUTION_TARGET_KINDS,
    decisionStatuses: CRYPTO_AUTHORIZATION_DECISION_STATUSES,
    signerAuthorityKinds: CRYPTO_SIGNER_AUTHORITY_KINDS,
    signatureValidationModes: CRYPTO_SIGNATURE_VALIDATION_MODES,
    replayProtectionModes: CRYPTO_REPLAY_PROTECTION_MODES,
    digestModes: CRYPTO_AUTHORIZATION_DIGEST_MODES,
  });
}

export const CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS = Object.freeze([
  'attestor-release-receipt',
  'eip-712-authorization',
] satisfies readonly CryptoAuthorizationArtifactKind[]);

export const CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS = Object.freeze([
  'attestor-release-receipt',
  'erc-1271-validation',
] satisfies readonly CryptoAuthorizationArtifactKind[]);

export const CRYPTO_AUTHORIZATION_WALLET_PERMISSION_ARTIFACTS = Object.freeze([
  'attestor-release-receipt',
  'wallet-permission-grant',
] satisfies readonly CryptoAuthorizationArtifactKind[]);

export const CRYPTO_AUTHORIZATION_ALL_ARTIFACTS = CRYPTO_AUTHORIZATION_ARTIFACT_KINDS;
