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
 * EIP-7702 delegation-aware adapter.
 *
 * Step 17 keeps delegated-EOA semantics outside the core authorization object
 * model while making authorization-list tuple, delegate code, nonce, runtime
 * scope, initialization, sponsorship, and revocation evidence explicit before
 * an EOA is allowed to execute through delegated code.
 */

export const EIP7702_DELEGATION_ADAPTER_SPEC_VERSION =
  'attestor.crypto-eip7702-delegation-adapter.v1';

export const EIP7702_SET_CODE_TX_TYPE = '0x04';
export const EIP7702_AUTHORIZATION_MAGIC = '0x05';
export const EIP7702_DELEGATION_INDICATOR_PREFIX = '0xef0100';
export const EIP7702_INITCODE_MARKER = '0x7702';
export const EIP7702_PER_EMPTY_ACCOUNT_COST = '25000';
export const EIP7702_PER_AUTH_BASE_COST = '12500';

export const EIP7702_EXECUTION_PATHS = [
  'set-code-transaction',
  'erc-4337-user-operation',
  'wallet-call-api',
] as const;
export type Eip7702ExecutionPath = typeof EIP7702_EXECUTION_PATHS[number];

export const EIP7702_ACCOUNT_CODE_STATES = [
  'empty',
  'delegated',
  'other-code',
] as const;
export type Eip7702AccountCodeState = typeof EIP7702_ACCOUNT_CODE_STATES[number];

export const EIP7702_OUTCOMES = [
  'allow',
  'review-required',
  'block',
] as const;
export type Eip7702Outcome = typeof EIP7702_OUTCOMES[number];

export const EIP7702_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
] as const;
export type Eip7702ObservationStatus =
  typeof EIP7702_OBSERVATION_STATUSES[number];

export const EIP7702_CHECKS = [
  'eip7702-adapter-kind',
  'eip7702-account-kind-eoa',
  'eip7702-authority-matches-intent',
  'eip7702-chain-matches-intent',
  'eip7702-authorization-chain-scope',
  'eip7702-authorization-signature',
  'eip7702-authorization-nonce',
  'eip7702-delegation-address-bound',
  'eip7702-delegate-code-posture',
  'eip7702-account-code-state',
  'eip7702-authorization-list',
  'eip7702-execution-path',
  'eip7702-target-matches-intent',
  'eip7702-function-selector-matches-intent',
  'eip7702-calldata-class-matches-intent',
  'eip7702-call-scope-signed',
  'eip7702-initialization-posture',
  'eip7702-erc4337-posture',
  'eip7702-wallet-capability-posture',
  'eip7702-pending-transaction-posture',
  'eip7702-sponsor-posture',
  'eip7702-release-binding-ready',
  'eip7702-policy-binding-ready',
  'eip7702-enforcement-binding-ready',
  'eip7702-revocation-and-recovery',
  'eip7702-post-execution-status',
] as const;
export type Eip7702Check = typeof EIP7702_CHECKS[number];

export interface Eip7702AuthorizationTupleEvidence {
  readonly chainId: string;
  readonly authorityAddress: string;
  readonly delegationAddress: string;
  readonly nonce: string;
  readonly yParity: string;
  readonly r: string;
  readonly s: string;
  readonly tupleHash?: string | null;
  readonly signatureRecoveredAddress?: string | null;
  readonly signatureValid: boolean;
  readonly lowS: boolean;
}

export interface Eip7702AccountStateEvidence {
  readonly observedAt: string;
  readonly chainId: string;
  readonly authorityAddress: string;
  readonly currentNonce: string;
  readonly codeState: Eip7702AccountCodeState;
  readonly currentDelegationAddress?: string | null;
  readonly delegationIndicator?: string | null;
  readonly codeHash?: string | null;
  readonly pendingTransactionCount?: number | null;
  readonly pendingTransactionPolicyCompliant: boolean;
}

export interface Eip7702DelegateCodeEvidence {
  readonly delegationAddress: string;
  readonly delegateCodeHash: string;
  readonly delegateImplementationId: string;
  readonly audited: boolean;
  readonly allowlisted: boolean;
  readonly storageLayoutSafe: boolean;
  readonly supportsReplayProtection: boolean;
  readonly supportsTargetCalldataBinding: boolean;
  readonly supportsValueBinding: boolean;
  readonly supportsGasBinding: boolean;
  readonly supportsExpiryBinding: boolean;
}

export interface Eip7702ExecutionEvidence {
  readonly executionPath: Eip7702ExecutionPath;
  readonly transactionType?: string | null;
  readonly authorizationListLength: number;
  readonly tupleIndex: number;
  readonly tupleIsLastValidForAuthority: boolean;
  readonly authorizationListNonEmpty: boolean;
  readonly destination: string;
  readonly target: string;
  readonly value: string;
  readonly data: string;
  readonly functionSelector?: string | null;
  readonly calldataClass?: string | null;
  readonly batchCallCount?: number | null;
  readonly targetCalldataSigned: boolean;
  readonly valueSigned: boolean;
  readonly gasLimitSigned: boolean;
  readonly nonceSigned: boolean;
  readonly expirySigned: boolean;
  readonly runtimeContextBound: boolean;
  readonly userOperationHash?: string | null;
  readonly entryPoint?: string | null;
  readonly initCodeMarker?: string | null;
  readonly factoryDataHash?: string | null;
  readonly eip7702AuthIncluded?: boolean | null;
  readonly preVerificationGasIncludesAuthorizationCost?: boolean | null;
  readonly walletCapabilityObserved?: boolean | null;
  readonly walletCapabilitySupported?: boolean | null;
  readonly walletCapabilityRequested?: boolean | null;
  readonly atomicRequired?: boolean | null;
  readonly postExecutionSuccess?: boolean | null;
}

export interface Eip7702InitializationEvidence {
  readonly initializationRequired: boolean;
  readonly initializationCalldataHash?: string | null;
  readonly initializationSignedByAuthority?: boolean | null;
  readonly initializationExecutedBeforeValidation?: boolean | null;
  readonly frontRunProtected?: boolean | null;
}

export interface Eip7702SponsorEvidence {
  readonly sponsored: boolean;
  readonly sponsorAddress?: string | null;
  readonly sponsorBondRequired?: boolean | null;
  readonly sponsorBondPresent?: boolean | null;
  readonly reimbursementBound?: boolean | null;
}

export interface Eip7702RecoveryEvidence {
  readonly revocationPathReady: boolean;
  readonly zeroAddressClearSupported: boolean;
  readonly privateKeyStillControlsAccountAcknowledged: boolean;
  readonly emergencyDelegateResetPrepared: boolean;
  readonly recoveryAuthorityRef?: string | null;
}

export interface Eip7702Observation {
  readonly check: Eip7702Check;
  readonly status: Eip7702ObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateEip7702DelegationPreflightInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
  readonly delegateCode: Eip7702DelegateCodeEvidence;
  readonly execution: Eip7702ExecutionEvidence;
  readonly initialization: Eip7702InitializationEvidence;
  readonly sponsor: Eip7702SponsorEvidence;
  readonly recovery: Eip7702RecoveryEvidence;
  readonly preflightId?: string | null;
}

export interface Eip7702DelegationPreflight {
  readonly version: typeof EIP7702_DELEGATION_ADAPTER_SPEC_VERSION;
  readonly preflightId: string;
  readonly adapterKind: 'eip-7702-delegation';
  readonly checkedAt: string;
  readonly authorityAddress: string;
  readonly delegationAddress: string;
  readonly chainId: string;
  readonly authorizationNonce: string;
  readonly executionPath: Eip7702ExecutionPath;
  readonly target: string;
  readonly functionSelector: string | null;
  readonly outcome: Eip7702Outcome;
  readonly signal: CryptoSimulationPreflightSignal;
  readonly observations: readonly Eip7702Observation[];
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface Eip7702DelegationSimulationResult {
  readonly preflight: Eip7702DelegationPreflight;
  readonly simulation: CryptoAuthorizationSimulationResult;
}

export interface Eip7702DelegationAdapterDescriptor {
  readonly version: typeof EIP7702_DELEGATION_ADAPTER_SPEC_VERSION;
  readonly adapterKind: 'eip-7702-delegation';
  readonly transactionType: typeof EIP7702_SET_CODE_TX_TYPE;
  readonly authorizationMagic: typeof EIP7702_AUTHORIZATION_MAGIC;
  readonly delegationIndicatorPrefix: typeof EIP7702_DELEGATION_INDICATOR_PREFIX;
  readonly initCodeMarker: typeof EIP7702_INITCODE_MARKER;
  readonly executionPaths: typeof EIP7702_EXECUTION_PATHS;
  readonly accountCodeStates: typeof EIP7702_ACCOUNT_CODE_STATES;
  readonly outcomes: typeof EIP7702_OUTCOMES;
  readonly checks: typeof EIP7702_CHECKS;
  readonly references: readonly string[];
}

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`EIP-7702 delegation adapter ${fieldName} requires a non-empty value.`);
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
    throw new Error(`EIP-7702 delegation adapter ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`EIP-7702 delegation adapter ${fieldName} must be an EVM address.`);
  }
  return normalized.toLowerCase();
}

function normalizeOptionalAddress(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeAddress(value, fieldName);
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`EIP-7702 delegation adapter ${fieldName} must be a 32-byte hex value.`);
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

function normalizeSelector(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[a-f0-9]{8}$/.test(normalized)) {
    throw new Error(`EIP-7702 delegation adapter ${fieldName} must be a 4-byte selector.`);
  }
  return normalized;
}

function normalizeHexBytes(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(normalized)) {
    throw new Error(`EIP-7702 delegation adapter ${fieldName} must be hex bytes.`);
  }
  return normalized.toLowerCase();
}

function normalizeOptionalHexBytes(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeHexBytes(value, fieldName);
}

function normalizeUintString(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`EIP-7702 delegation adapter ${fieldName} must be a non-negative integer string.`);
  }
  return normalized;
}

function normalizeTupleChainId(value: string): string {
  const normalized = normalizeUintString(value, 'authorization.chainId');
  const asBigInt = BigInt(normalized);
  if (asBigInt >= 2n ** 256n) {
    throw new Error('EIP-7702 delegation adapter authorization.chainId must fit uint256.');
  }
  return normalized;
}

function normalizeAuthorityNonce(value: string): string {
  const normalized = normalizeUintString(value, 'authorization.nonce');
  const asBigInt = BigInt(normalized);
  if (asBigInt >= 2n ** 64n) {
    throw new Error('EIP-7702 delegation adapter authorization.nonce must fit uint64.');
  }
  return normalized;
}

function normalizeYParity(value: string): string {
  const normalized = normalizeUintString(value, 'authorization.yParity');
  if (normalized !== '0' && normalized !== '1') {
    throw new Error('EIP-7702 delegation adapter authorization.yParity must be 0 or 1.');
  }
  return normalized;
}

function normalizeSignatureComponent(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`EIP-7702 delegation adapter ${fieldName} must be a 32-byte secp256k1 component.`);
  }
  return normalized;
}

function normalizePositiveInteger(value: number | null | undefined, fieldName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`EIP-7702 delegation adapter ${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function executionPathFrom(input: Eip7702ExecutionPath): Eip7702ExecutionPath {
  if (!EIP7702_EXECUTION_PATHS.includes(input)) {
    throw new Error(`EIP-7702 delegation adapter does not support execution path ${input}.`);
  }
  return input;
}

function accountCodeStateFrom(input: Eip7702AccountCodeState): Eip7702AccountCodeState {
  if (!EIP7702_ACCOUNT_CODE_STATES.includes(input)) {
    throw new Error(`EIP-7702 delegation adapter does not support account code state ${input}.`);
  }
  return input;
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

function eip155ChainId(intent: CryptoAuthorizationIntent): string {
  if (intent.chain.namespace !== 'eip155') {
    throw new Error('EIP-7702 delegation adapter requires an EIP-155 chain.');
  }
  return intent.chain.chainId;
}

function sameAddress(left: string, right: string | null | undefined): boolean {
  if (!right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
}

function nonceMatches(intentNonce: string, authorityNonce: string): boolean {
  return (
    intentNonce === authorityNonce ||
    intentNonce === `authorization-list:nonce:${authorityNonce}` ||
    intentNonce === `eip7702:nonce:${authorityNonce}` ||
    intentNonce === `delegation:nonce:${authorityNonce}` ||
    intentNonce.endsWith(`:${authorityNonce}`)
  );
}

function normalizeAuthorization(
  input: Eip7702AuthorizationTupleEvidence,
): Eip7702AuthorizationTupleEvidence {
  return Object.freeze({
    chainId: normalizeTupleChainId(input.chainId),
    authorityAddress: normalizeAddress(input.authorityAddress, 'authorization.authorityAddress'),
    delegationAddress: normalizeAddress(input.delegationAddress, 'authorization.delegationAddress'),
    nonce: normalizeAuthorityNonce(input.nonce),
    yParity: normalizeYParity(input.yParity),
    r: normalizeSignatureComponent(input.r, 'authorization.r'),
    s: normalizeSignatureComponent(input.s, 'authorization.s'),
    tupleHash: normalizeOptionalHash(input.tupleHash, 'authorization.tupleHash'),
    signatureRecoveredAddress: normalizeOptionalAddress(
      input.signatureRecoveredAddress,
      'authorization.signatureRecoveredAddress',
    ),
    signatureValid: input.signatureValid,
    lowS: input.lowS,
  });
}

function normalizeAccountState(input: Eip7702AccountStateEvidence): Eip7702AccountStateEvidence {
  return Object.freeze({
    observedAt: normalizeIsoTimestamp(input.observedAt, 'accountState.observedAt'),
    chainId: normalizeIdentifier(input.chainId, 'accountState.chainId'),
    authorityAddress: normalizeAddress(input.authorityAddress, 'accountState.authorityAddress'),
    currentNonce: normalizeAuthorityNonce(input.currentNonce),
    codeState: accountCodeStateFrom(input.codeState),
    currentDelegationAddress: normalizeOptionalAddress(
      input.currentDelegationAddress,
      'accountState.currentDelegationAddress',
    ),
    delegationIndicator: normalizeOptionalHexBytes(
      input.delegationIndicator,
      'accountState.delegationIndicator',
    ),
    codeHash: normalizeOptionalHash(input.codeHash, 'accountState.codeHash'),
    pendingTransactionCount: normalizePositiveInteger(
      input.pendingTransactionCount,
      'accountState.pendingTransactionCount',
    ),
    pendingTransactionPolicyCompliant: input.pendingTransactionPolicyCompliant,
  });
}

function normalizeDelegateCode(input: Eip7702DelegateCodeEvidence): Eip7702DelegateCodeEvidence {
  return Object.freeze({
    delegationAddress: normalizeAddress(input.delegationAddress, 'delegateCode.delegationAddress'),
    delegateCodeHash: normalizeHash(input.delegateCodeHash, 'delegateCode.delegateCodeHash'),
    delegateImplementationId: normalizeIdentifier(
      input.delegateImplementationId,
      'delegateCode.delegateImplementationId',
    ),
    audited: input.audited,
    allowlisted: input.allowlisted,
    storageLayoutSafe: input.storageLayoutSafe,
    supportsReplayProtection: input.supportsReplayProtection,
    supportsTargetCalldataBinding: input.supportsTargetCalldataBinding,
    supportsValueBinding: input.supportsValueBinding,
    supportsGasBinding: input.supportsGasBinding,
    supportsExpiryBinding: input.supportsExpiryBinding,
  });
}

function normalizeBatchCallCount(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('EIP-7702 delegation adapter execution.batchCallCount must be a positive integer.');
  }
  return value;
}

function normalizeExecution(input: Eip7702ExecutionEvidence): Eip7702ExecutionEvidence {
  const authorizationListLength = normalizePositiveInteger(
    input.authorizationListLength,
    'execution.authorizationListLength',
  ) ?? 0;
  const tupleIndex = normalizePositiveInteger(input.tupleIndex, 'execution.tupleIndex') ?? 0;
  return Object.freeze({
    executionPath: executionPathFrom(input.executionPath),
    transactionType: normalizeOptionalIdentifier(input.transactionType, 'execution.transactionType')?.toLowerCase() ?? null,
    authorizationListLength,
    tupleIndex,
    tupleIsLastValidForAuthority: input.tupleIsLastValidForAuthority,
    authorizationListNonEmpty: input.authorizationListNonEmpty,
    destination: normalizeAddress(input.destination, 'execution.destination'),
    target: normalizeAddress(input.target, 'execution.target'),
    value: normalizeUintString(input.value, 'execution.value'),
    data: normalizeHexBytes(input.data, 'execution.data'),
    functionSelector: normalizeSelector(input.functionSelector, 'execution.functionSelector'),
    calldataClass: normalizeOptionalIdentifier(input.calldataClass, 'execution.calldataClass'),
    batchCallCount: normalizeBatchCallCount(input.batchCallCount),
    targetCalldataSigned: input.targetCalldataSigned,
    valueSigned: input.valueSigned,
    gasLimitSigned: input.gasLimitSigned,
    nonceSigned: input.nonceSigned,
    expirySigned: input.expirySigned,
    runtimeContextBound: input.runtimeContextBound,
    userOperationHash: normalizeOptionalHash(input.userOperationHash, 'execution.userOperationHash'),
    entryPoint: normalizeOptionalAddress(input.entryPoint, 'execution.entryPoint'),
    initCodeMarker: normalizeOptionalIdentifier(input.initCodeMarker, 'execution.initCodeMarker')?.toLowerCase() ?? null,
    factoryDataHash: normalizeOptionalHash(input.factoryDataHash, 'execution.factoryDataHash'),
    eip7702AuthIncluded: input.eip7702AuthIncluded ?? null,
    preVerificationGasIncludesAuthorizationCost:
      input.preVerificationGasIncludesAuthorizationCost ?? null,
    walletCapabilityObserved: input.walletCapabilityObserved ?? null,
    walletCapabilitySupported: input.walletCapabilitySupported ?? null,
    walletCapabilityRequested: input.walletCapabilityRequested ?? null,
    atomicRequired: input.atomicRequired ?? null,
    postExecutionSuccess: input.postExecutionSuccess ?? null,
  });
}

function normalizeInitialization(
  input: Eip7702InitializationEvidence,
): Eip7702InitializationEvidence {
  return Object.freeze({
    initializationRequired: input.initializationRequired,
    initializationCalldataHash: normalizeOptionalHash(
      input.initializationCalldataHash,
      'initialization.initializationCalldataHash',
    ),
    initializationSignedByAuthority: input.initializationSignedByAuthority ?? null,
    initializationExecutedBeforeValidation:
      input.initializationExecutedBeforeValidation ?? null,
    frontRunProtected: input.frontRunProtected ?? null,
  });
}

function normalizeSponsor(input: Eip7702SponsorEvidence): Eip7702SponsorEvidence {
  return Object.freeze({
    sponsored: input.sponsored,
    sponsorAddress: normalizeOptionalAddress(input.sponsorAddress, 'sponsor.sponsorAddress'),
    sponsorBondRequired: input.sponsorBondRequired ?? null,
    sponsorBondPresent: input.sponsorBondPresent ?? null,
    reimbursementBound: input.reimbursementBound ?? null,
  });
}

function normalizeRecovery(input: Eip7702RecoveryEvidence): Eip7702RecoveryEvidence {
  return Object.freeze({
    revocationPathReady: input.revocationPathReady,
    zeroAddressClearSupported: input.zeroAddressClearSupported,
    privateKeyStillControlsAccountAcknowledged:
      input.privateKeyStillControlsAccountAcknowledged,
    emergencyDelegateResetPrepared: input.emergencyDelegateResetPrepared,
    recoveryAuthorityRef: normalizeOptionalIdentifier(
      input.recoveryAuthorityRef,
      'recovery.recoveryAuthorityRef',
    ),
  });
}

function assertAdapterConsistency(input: CreateEip7702DelegationPreflightInput): void {
  if (input.intent.executionAdapterKind !== 'eip-7702-delegation') {
    throw new Error('EIP-7702 delegation adapter requires intent execution adapter eip-7702-delegation.');
  }
  if (input.riskAssessment.consequenceKind !== input.intent.consequenceKind) {
    throw new Error('EIP-7702 delegation adapter risk consequence does not match intent.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.policyScopeBinding.cryptoDecisionId) {
    throw new Error('EIP-7702 delegation adapter policy binding does not match release binding.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.enforcementBinding.cryptoDecisionId) {
    throw new Error('EIP-7702 delegation adapter enforcement binding does not match release binding.');
  }
  if (input.enforcementBinding.adapterKind !== 'eip-7702-delegation') {
    throw new Error('EIP-7702 delegation adapter requires eip-7702-delegation enforcement binding.');
  }
  if (input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind !== 'action-dispatch') {
    throw new Error('EIP-7702 delegation adapter requires action-dispatch enforcement.');
  }
  if (!input.enforcementBinding.verificationProfile.failClosed) {
    throw new Error('EIP-7702 delegation adapter requires fail-closed enforcement verification.');
  }
}

function authorizationChainReady(input: {
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly intent: CryptoAuthorizationIntent;
}): boolean {
  const chainId = eip155ChainId(input.intent);
  return input.authorization.chainId === '0' || input.authorization.chainId === chainId;
}

function delegateCodeReady(delegateCode: Eip7702DelegateCodeEvidence): boolean {
  return (
    delegateCode.audited &&
    delegateCode.allowlisted &&
    delegateCode.storageLayoutSafe &&
    delegateCode.supportsReplayProtection &&
    delegateCode.supportsTargetCalldataBinding &&
    delegateCode.supportsValueBinding &&
    delegateCode.supportsGasBinding &&
    delegateCode.supportsExpiryBinding
  );
}

function accountCodeReady(input: {
  readonly accountState: Eip7702AccountStateEvidence;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
}): boolean {
  if (input.accountState.codeState === 'empty') {
    return true;
  }
  if (input.accountState.codeState !== 'delegated') {
    return false;
  }
  return sameAddress(
    input.authorization.delegationAddress,
    input.accountState.currentDelegationAddress,
  );
}

function authorizationListReady(execution: Eip7702ExecutionEvidence): boolean {
  return (
    execution.authorizationListNonEmpty &&
    execution.authorizationListLength > 0 &&
    execution.tupleIndex >= 0 &&
    execution.tupleIndex < execution.authorizationListLength &&
    execution.tupleIsLastValidForAuthority
  );
}

function executionPathReady(input: {
  readonly accountState: Eip7702AccountStateEvidence;
  readonly execution: Eip7702ExecutionEvidence;
}): boolean {
  const { accountState, execution } = input;
  switch (execution.executionPath) {
    case 'set-code-transaction':
      return (
        execution.transactionType === EIP7702_SET_CODE_TX_TYPE &&
        execution.authorizationListNonEmpty &&
        execution.destination !== ZERO_EVM_ADDRESS
      );
    case 'erc-4337-user-operation': {
      const authIncluded = execution.eip7702AuthIncluded === true;
      const alreadyDelegated = accountState.codeState === 'delegated';
      return (
        execution.userOperationHash !== null &&
        execution.entryPoint !== null &&
        execution.initCodeMarker === EIP7702_INITCODE_MARKER &&
        (authIncluded || alreadyDelegated) &&
        (!authIncluded || execution.preVerificationGasIncludesAuthorizationCost === true)
      );
    }
    case 'wallet-call-api':
      return (
        execution.walletCapabilityRequested === true &&
        execution.walletCapabilityObserved === true &&
        execution.walletCapabilitySupported === true
      );
  }
}

function callScopeSigned(execution: Eip7702ExecutionEvidence): boolean {
  return (
    execution.targetCalldataSigned &&
    execution.valueSigned &&
    execution.gasLimitSigned &&
    execution.nonceSigned &&
    execution.expirySigned &&
    execution.runtimeContextBound
  );
}

function initializationReady(initialization: Eip7702InitializationEvidence): boolean {
  if (!initialization.initializationRequired) {
    return true;
  }
  return (
    initialization.initializationCalldataHash !== null &&
    initialization.initializationSignedByAuthority === true &&
    initialization.initializationExecutedBeforeValidation === true &&
    initialization.frontRunProtected === true
  );
}

function erc4337Ready(input: {
  readonly accountState: Eip7702AccountStateEvidence;
  readonly execution: Eip7702ExecutionEvidence;
}): boolean {
  if (input.execution.executionPath !== 'erc-4337-user-operation') {
    return true;
  }
  return executionPathReady(input);
}

function walletCapabilityReady(execution: Eip7702ExecutionEvidence): boolean {
  if (execution.executionPath !== 'wallet-call-api') {
    return true;
  }
  return (
    execution.walletCapabilityRequested === true &&
    execution.walletCapabilityObserved === true &&
    execution.walletCapabilitySupported === true
  );
}

function sponsorReady(sponsor: Eip7702SponsorEvidence): boolean {
  if (!sponsor.sponsored) {
    return true;
  }
  return (
    sponsor.sponsorAddress !== null &&
    sponsor.sponsorBondRequired === true &&
    sponsor.sponsorBondPresent === true &&
    sponsor.reimbursementBound === true
  );
}

function recoveryReady(recovery: Eip7702RecoveryEvidence): boolean {
  return (
    recovery.revocationPathReady &&
    recovery.zeroAddressClearSupported &&
    recovery.privateKeyStillControlsAccountAcknowledged &&
    recovery.emergencyDelegateResetPrepared
  );
}

function observation(input: {
  readonly check: Eip7702Check;
  readonly status: Eip7702ObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): Eip7702Observation {
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
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
  readonly delegateCode: Eip7702DelegateCodeEvidence;
  readonly execution: Eip7702ExecutionEvidence;
  readonly initialization: Eip7702InitializationEvidence;
  readonly sponsor: Eip7702SponsorEvidence;
  readonly recovery: Eip7702RecoveryEvidence;
}): readonly Eip7702Observation[] {
  const observations: Eip7702Observation[] = [];
  const intentChainId = caip2ChainId(input.intent);
  const targetAddress = input.intent.target.address ?? null;
  const requiredSelector = input.intent.target.functionSelector?.toLowerCase() ?? null;
  const requiredCalldataClass = input.intent.target.calldataClass ?? null;
  const signatureReady =
    input.authorization.signatureValid &&
    input.authorization.lowS &&
    sameAddress(input.authorization.authorityAddress, input.authorization.signatureRecoveredAddress);
  const authorizationNonceReady =
    input.authorization.nonce === input.accountState.currentNonce &&
    nonceMatches(input.intent.constraints.nonce, input.authorization.nonce);
  const delegationAddressReady =
    input.authorization.delegationAddress !== ZERO_EVM_ADDRESS &&
    sameAddress(input.authorization.delegationAddress, input.delegateCode.delegationAddress);
  const releaseReady =
    input.releaseBinding.status === 'bound' &&
    (input.releaseBinding.releaseDecision.status === 'accepted' ||
      input.releaseBinding.releaseDecision.status === 'overridden');
  const enforcementReady =
    input.enforcementBinding.adapterKind === 'eip-7702-delegation' &&
    input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind === 'action-dispatch' &&
    input.enforcementBinding.verificationProfile.failClosed;
  const postExecutionReady =
    input.execution.postExecutionSuccess === null ||
    input.execution.postExecutionSuccess === true;

  observations.push(
    observation({
      check: 'eip7702-adapter-kind',
      status: input.intent.executionAdapterKind === 'eip-7702-delegation' ? 'pass' : 'fail',
      code: input.intent.executionAdapterKind === 'eip-7702-delegation'
        ? 'eip7702-adapter-kind-bound'
        : 'eip7702-adapter-kind-mismatch',
      message: input.intent.executionAdapterKind === 'eip-7702-delegation'
        ? 'Intent is bound to the EIP-7702 delegation adapter.'
        : 'Intent is not bound to the EIP-7702 delegation adapter.',
      evidence: {
        adapterKind: input.intent.executionAdapterKind ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-account-kind-eoa',
      status: input.intent.account.accountKind === 'eoa' ? 'pass' : 'fail',
      code: input.intent.account.accountKind === 'eoa'
        ? 'eip7702-account-kind-eoa'
        : 'eip7702-account-kind-not-eoa',
      message: input.intent.account.accountKind === 'eoa'
        ? 'Intent account is an EOA as required for EIP-7702 delegated execution.'
        : 'EIP-7702 delegated execution requires an EOA account.',
      evidence: {
        accountKind: input.intent.account.accountKind,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-authority-matches-intent',
      status:
        sameAddress(input.authorization.authorityAddress, input.intent.account.address) &&
        sameAddress(input.accountState.authorityAddress, input.intent.account.address)
          ? 'pass'
          : 'fail',
      code:
        sameAddress(input.authorization.authorityAddress, input.intent.account.address) &&
        sameAddress(input.accountState.authorityAddress, input.intent.account.address)
          ? 'eip7702-authority-bound'
          : 'eip7702-authority-mismatch',
      message:
        sameAddress(input.authorization.authorityAddress, input.intent.account.address) &&
        sameAddress(input.accountState.authorityAddress, input.intent.account.address)
          ? 'Authorization tuple authority and observed account state match the intent account.'
          : 'Authorization tuple authority or observed account state does not match the intent account.',
      evidence: {
        intentAccount: input.intent.account.address,
        tupleAuthority: input.authorization.authorityAddress,
        observedAuthority: input.accountState.authorityAddress,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-chain-matches-intent',
      status: input.accountState.chainId === intentChainId ? 'pass' : 'fail',
      code: input.accountState.chainId === intentChainId
        ? 'eip7702-chain-bound'
        : 'eip7702-chain-mismatch',
      message: input.accountState.chainId === intentChainId
        ? 'Observed EIP-7702 account state is on the intent chain.'
        : 'Observed EIP-7702 account state is not on the intent chain.',
      evidence: {
        observedChainId: input.accountState.chainId,
        intentChainId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-authorization-chain-scope',
      status: authorizationChainReady({ authorization: input.authorization, intent: input.intent })
        ? 'pass'
        : 'fail',
      code: authorizationChainReady({ authorization: input.authorization, intent: input.intent })
        ? 'eip7702-authorization-chain-scoped'
        : 'eip7702-authorization-chain-mismatch',
      message: authorizationChainReady({ authorization: input.authorization, intent: input.intent })
        ? 'Authorization tuple chain id is either universal zero or the current EIP-155 chain.'
        : 'Authorization tuple chain id is not valid for this EIP-155 chain.',
      evidence: {
        tupleChainId: input.authorization.chainId,
        intentEip155ChainId: eip155ChainId(input.intent),
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-authorization-signature',
      status: signatureReady ? 'pass' : 'fail',
      code: !input.authorization.signatureValid
        ? 'eip7702-authorization-signature-invalid'
        : !input.authorization.lowS
          ? 'eip7702-authorization-signature-malleable'
          : !sameAddress(input.authorization.authorityAddress, input.authorization.signatureRecoveredAddress)
            ? 'eip7702-authorization-recovered-authority-mismatch'
            : 'eip7702-authorization-signature-valid',
      message: signatureReady
        ? 'Authorization tuple signature is valid, low-s, and recovers the authority address.'
        : 'Authorization tuple signature is invalid, malleable, or recovers the wrong authority.',
      evidence: {
        magic: EIP7702_AUTHORIZATION_MAGIC,
        tupleHash: input.authorization.tupleHash ?? null,
        authorityAddress: input.authorization.authorityAddress,
        recoveredAddress: input.authorization.signatureRecoveredAddress ?? null,
        yParity: input.authorization.yParity,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-authorization-nonce',
      status: authorizationNonceReady ? 'pass' : 'fail',
      code: input.authorization.nonce !== input.accountState.currentNonce
        ? 'eip7702-authority-nonce-stale'
        : authorizationNonceReady
          ? 'eip7702-authorization-nonce-bound'
          : 'eip7702-authorization-nonce-mismatch',
      message: authorizationNonceReady
        ? 'Authorization tuple nonce matches account state and Attestor replay constraints.'
        : 'Authorization tuple nonce is stale or not bound to Attestor replay constraints.',
      evidence: {
        tupleNonce: input.authorization.nonce,
        observedNonce: input.accountState.currentNonce,
        intentNonce: input.intent.constraints.nonce,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-delegation-address-bound',
      status: delegationAddressReady ? 'pass' : 'fail',
      code: input.authorization.delegationAddress === ZERO_EVM_ADDRESS
        ? 'eip7702-delegation-clear-not-execution'
        : delegationAddressReady
          ? 'eip7702-delegation-address-bound'
          : 'eip7702-delegation-address-mismatch',
      message: delegationAddressReady
        ? 'Authorization tuple delegation address matches the approved delegate code evidence.'
        : 'Delegation address is zero or does not match approved delegate code evidence.',
      evidence: {
        tupleDelegationAddress: input.authorization.delegationAddress,
        delegateCodeAddress: input.delegateCode.delegationAddress,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-delegate-code-posture',
      status: delegateCodeReady(input.delegateCode) ? 'pass' : 'fail',
      code: delegateCodeReady(input.delegateCode)
        ? 'eip7702-delegate-code-ready'
        : 'eip7702-delegate-code-not-approved',
      message: delegateCodeReady(input.delegateCode)
        ? 'Delegate code is audited, allowlisted, storage-safe, and supports bounded execution proofs.'
        : 'Delegate code lacks audit, allowlist, storage, or signed-scope support.',
      evidence: {
        delegateCodeHash: input.delegateCode.delegateCodeHash,
        implementationId: input.delegateCode.delegateImplementationId,
        audited: input.delegateCode.audited,
        allowlisted: input.delegateCode.allowlisted,
        storageLayoutSafe: input.delegateCode.storageLayoutSafe,
        supportsReplayProtection: input.delegateCode.supportsReplayProtection,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-account-code-state',
      status: accountCodeReady({
        accountState: input.accountState,
        authorization: input.authorization,
      }) ? 'pass' : 'fail',
      code: input.accountState.codeState === 'other-code'
        ? 'eip7702-account-has-nondelegation-code'
        : accountCodeReady({ accountState: input.accountState, authorization: input.authorization })
          ? 'eip7702-account-code-state-compatible'
          : 'eip7702-current-delegation-mismatch',
      message: accountCodeReady({ accountState: input.accountState, authorization: input.authorization })
        ? 'Account code state is empty or already delegated to the intended code target.'
        : 'Account code state is incompatible with the requested EIP-7702 delegation.',
      evidence: {
        codeState: input.accountState.codeState,
        currentDelegationAddress: input.accountState.currentDelegationAddress ?? null,
        delegationIndicator: input.accountState.delegationIndicator ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-authorization-list',
      status: authorizationListReady(input.execution) ? 'pass' : 'fail',
      code: !input.execution.authorizationListNonEmpty || input.execution.authorizationListLength === 0
        ? 'eip7702-authorization-list-empty'
        : !input.execution.tupleIsLastValidForAuthority
          ? 'eip7702-authorization-tuple-not-last-valid'
          : authorizationListReady(input.execution)
            ? 'eip7702-authorization-list-bound'
            : 'eip7702-authorization-list-invalid-index',
      message: authorizationListReady(input.execution)
        ? 'Authorization list is non-empty and the tuple is the last valid occurrence for the authority.'
        : 'Authorization list is empty, invalidly indexed, or superseded by a later tuple.',
      evidence: {
        authorizationListLength: input.execution.authorizationListLength,
        tupleIndex: input.execution.tupleIndex,
        tupleIsLastValidForAuthority: input.execution.tupleIsLastValidForAuthority,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-execution-path',
      status: executionPathReady({
        accountState: input.accountState,
        execution: input.execution,
      }) ? 'pass' : 'fail',
      code: executionPathReady({ accountState: input.accountState, execution: input.execution })
        ? 'eip7702-execution-path-ready'
        : 'eip7702-execution-path-not-ready',
      message: executionPathReady({ accountState: input.accountState, execution: input.execution })
        ? 'Execution path satisfies set-code, ERC-4337, or wallet-call EIP-7702 requirements.'
        : 'Execution path lacks required EIP-7702 transaction, UserOperation, or wallet capability evidence.',
      evidence: {
        executionPath: input.execution.executionPath,
        transactionType: input.execution.transactionType ?? null,
        userOperationHash: input.execution.userOperationHash ?? null,
        initCodeMarker: input.execution.initCodeMarker ?? null,
        walletCapabilitySupported: input.execution.walletCapabilitySupported ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-target-matches-intent',
      status: targetAddress === null
        ? 'warn'
        : sameAddress(input.execution.target, targetAddress)
          ? 'pass'
          : 'fail',
      code: targetAddress === null
        ? 'eip7702-target-not-required'
        : sameAddress(input.execution.target, targetAddress)
          ? 'eip7702-target-bound'
          : 'eip7702-target-mismatch',
      message: targetAddress === null
        ? 'Crypto authorization intent does not require an execution target.'
        : sameAddress(input.execution.target, targetAddress)
          ? 'Delegated EOA execution target matches the intent.'
          : 'Delegated EOA execution target does not match the intent.',
      evidence: {
        executionTarget: input.execution.target,
        intentTargetAddress: targetAddress,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-function-selector-matches-intent',
      status: requiredSelector === null
        ? 'pass'
        : input.execution.functionSelector === requiredSelector
          ? 'pass'
          : 'fail',
      code: requiredSelector === null
        ? 'eip7702-function-selector-not-required'
        : input.execution.functionSelector === requiredSelector
          ? 'eip7702-function-selector-bound'
          : 'eip7702-function-selector-mismatch',
      message: requiredSelector === null
        ? 'Crypto authorization intent does not require a function selector.'
        : input.execution.functionSelector === requiredSelector
          ? 'Delegated EOA function selector matches the intent.'
          : 'Delegated EOA function selector does not match the intent.',
      evidence: {
        executionFunctionSelector: input.execution.functionSelector ?? null,
        intentFunctionSelector: requiredSelector,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-calldata-class-matches-intent',
      status: requiredCalldataClass === null
        ? 'pass'
        : input.execution.calldataClass === requiredCalldataClass
          ? 'pass'
          : 'fail',
      code: requiredCalldataClass === null
        ? 'eip7702-calldata-class-not-required'
        : input.execution.calldataClass === requiredCalldataClass
          ? 'eip7702-calldata-class-bound'
          : 'eip7702-calldata-class-mismatch',
      message: requiredCalldataClass === null
        ? 'Crypto authorization intent does not require a calldata class.'
        : input.execution.calldataClass === requiredCalldataClass
          ? 'Delegated EOA calldata class matches the intent.'
          : 'Delegated EOA calldata class does not match the intent.',
      evidence: {
        calldataClass: input.execution.calldataClass ?? null,
        intentCalldataClass: requiredCalldataClass,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-call-scope-signed',
      status: callScopeSigned(input.execution) ? 'pass' : 'fail',
      code: callScopeSigned(input.execution)
        ? 'eip7702-call-scope-signed'
        : 'eip7702-call-scope-not-signed',
      message: callScopeSigned(input.execution)
        ? 'Delegate execution binds target, calldata, value, gas, nonce, expiry, and runtime context.'
        : 'Delegate execution lacks signed target, calldata, value, gas, nonce, expiry, or runtime-context binding.',
      evidence: {
        targetCalldataSigned: input.execution.targetCalldataSigned,
        valueSigned: input.execution.valueSigned,
        gasLimitSigned: input.execution.gasLimitSigned,
        nonceSigned: input.execution.nonceSigned,
        expirySigned: input.execution.expirySigned,
        runtimeContextBound: input.execution.runtimeContextBound,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-initialization-posture',
      status: initializationReady(input.initialization) ? 'pass' : 'fail',
      code: !input.initialization.initializationRequired
        ? 'eip7702-initialization-not-required'
        : initializationReady(input.initialization)
          ? 'eip7702-initialization-front-run-protected'
          : 'eip7702-initialization-not-protected',
      message: !input.initialization.initializationRequired
        ? 'Delegated EOA execution does not require initialization.'
        : initializationReady(input.initialization)
          ? 'Initialization calldata is signed, ordered before validation, and front-run protected.'
          : 'Initialization calldata is missing, unsigned, unordered, or not front-run protected.',
      evidence: {
        initializationRequired: input.initialization.initializationRequired,
        initializationCalldataHash: input.initialization.initializationCalldataHash ?? null,
        initializationSignedByAuthority: input.initialization.initializationSignedByAuthority ?? null,
        initializationExecutedBeforeValidation:
          input.initialization.initializationExecutedBeforeValidation ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-erc4337-posture',
      status: erc4337Ready({
        accountState: input.accountState,
        execution: input.execution,
      }) ? 'pass' : 'fail',
      code: input.execution.executionPath !== 'erc-4337-user-operation'
        ? 'eip7702-erc4337-not-applicable'
        : erc4337Ready({ accountState: input.accountState, execution: input.execution })
          ? 'eip7702-erc4337-posture-ready'
          : 'eip7702-erc4337-posture-not-ready',
      message: input.execution.executionPath !== 'erc-4337-user-operation'
        ? 'Execution is not using ERC-4337 UserOperation submission.'
        : erc4337Ready({ accountState: input.accountState, execution: input.execution })
          ? 'ERC-4337 EIP-7702 marker, auth inclusion, EntryPoint, and gas posture are ready.'
          : 'ERC-4337 EIP-7702 marker, auth inclusion, EntryPoint, or gas posture is missing.',
      evidence: {
        userOperationHash: input.execution.userOperationHash ?? null,
        entryPoint: input.execution.entryPoint ?? null,
        initCodeMarker: input.execution.initCodeMarker ?? null,
        eip7702AuthIncluded: input.execution.eip7702AuthIncluded ?? null,
        preVerificationGasIncludesAuthorizationCost:
          input.execution.preVerificationGasIncludesAuthorizationCost ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-wallet-capability-posture',
      status: walletCapabilityReady(input.execution) ? 'pass' : 'fail',
      code: input.execution.executionPath !== 'wallet-call-api'
        ? 'eip7702-wallet-capability-not-applicable'
        : walletCapabilityReady(input.execution)
          ? 'eip7702-wallet-capability-ready'
          : 'eip7702-wallet-capability-missing',
      message: input.execution.executionPath !== 'wallet-call-api'
        ? 'Execution is not using wallet-call capability negotiation.'
        : walletCapabilityReady(input.execution)
          ? 'Wallet-call path requested, observed, and supports the EIP-7702 authorization capability.'
          : 'Wallet-call path did not prove support for the EIP-7702 authorization capability.',
      evidence: {
        walletCapabilityRequested: input.execution.walletCapabilityRequested ?? null,
        walletCapabilityObserved: input.execution.walletCapabilityObserved ?? null,
        walletCapabilitySupported: input.execution.walletCapabilitySupported ?? null,
        atomicRequired: input.execution.atomicRequired ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-pending-transaction-posture',
      status: input.accountState.pendingTransactionPolicyCompliant ? 'pass' : 'fail',
      code: input.accountState.pendingTransactionPolicyCompliant
        ? 'eip7702-pending-transaction-posture-ready'
        : 'eip7702-pending-transaction-risk',
      message: input.accountState.pendingTransactionPolicyCompliant
        ? 'Pending-transaction posture is compatible with delegated EOA execution.'
        : 'Pending-transaction posture violates delegated EOA propagation safeguards.',
      evidence: {
        pendingTransactionCount: input.accountState.pendingTransactionCount ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-sponsor-posture',
      status: sponsorReady(input.sponsor) ? 'pass' : 'fail',
      code: !input.sponsor.sponsored
        ? 'eip7702-sponsor-not-used'
        : sponsorReady(input.sponsor)
          ? 'eip7702-sponsor-posture-ready'
          : 'eip7702-sponsor-posture-not-ready',
      message: !input.sponsor.sponsored
        ? 'Delegated EOA execution is not sponsored by a relayer.'
        : sponsorReady(input.sponsor)
          ? 'Sponsored relayer posture binds sponsor address, bond, and reimbursement terms.'
          : 'Sponsored relayer posture lacks sponsor address, bond, or reimbursement binding.',
      evidence: {
        sponsored: input.sponsor.sponsored,
        sponsorAddress: input.sponsor.sponsorAddress ?? null,
        sponsorBondRequired: input.sponsor.sponsorBondRequired ?? null,
        sponsorBondPresent: input.sponsor.sponsorBondPresent ?? null,
        reimbursementBound: input.sponsor.reimbursementBound ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-release-binding-ready',
      status: releaseReady ? 'pass' : 'fail',
      code: releaseReady
        ? 'eip7702-release-binding-ready'
        : 'eip7702-release-binding-not-executable',
      message: releaseReady
        ? 'Release binding is executable for EIP-7702 delegated execution.'
        : 'Release binding is not executable and delegated execution must fail closed.',
      evidence: {
        bindingStatus: input.releaseBinding.status,
        releaseStatus: input.releaseBinding.releaseDecision.status,
        releaseDecisionId: input.releaseBinding.releaseDecisionId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-policy-binding-ready',
      status: input.policyScopeBinding.activationRecord.state === 'active' ? 'pass' : 'fail',
      code: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'eip7702-policy-binding-active'
        : 'eip7702-policy-binding-not-active',
      message: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'Policy-control-plane binding is active for EIP-7702 delegated execution.'
        : 'Policy-control-plane binding is not active.',
      evidence: {
        activationId: input.policyScopeBinding.activationId,
        activationState: input.policyScopeBinding.activationRecord.state,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-enforcement-binding-ready',
      status: enforcementReady ? 'pass' : 'fail',
      code: enforcementReady
        ? 'eip7702-enforcement-binding-ready'
        : 'eip7702-enforcement-binding-not-ready',
      message: enforcementReady
        ? 'Enforcement binding is fail-closed and action-dispatch scoped for EIP-7702.'
        : 'Enforcement binding is not EIP-7702 action-dispatch ready.',
      evidence: {
        adapterKind: input.enforcementBinding.adapterKind,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
        profileId: input.enforcementBinding.verificationProfile.id,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-revocation-and-recovery',
      status: recoveryReady(input.recovery) ? 'pass' : 'fail',
      code: recoveryReady(input.recovery)
        ? 'eip7702-revocation-and-recovery-ready'
        : 'eip7702-revocation-and-recovery-missing',
      message: recoveryReady(input.recovery)
        ? 'Revocation, zero-address clearing, private-key continuity, and emergency reset posture are ready.'
        : 'Revocation, zero-address clearing, private-key continuity, or emergency reset posture is missing.',
      evidence: {
        revocationPathReady: input.recovery.revocationPathReady,
        zeroAddressClearSupported: input.recovery.zeroAddressClearSupported,
        privateKeyStillControlsAccountAcknowledged:
          input.recovery.privateKeyStillControlsAccountAcknowledged,
        emergencyDelegateResetPrepared: input.recovery.emergencyDelegateResetPrepared,
        recoveryAuthorityRef: input.recovery.recoveryAuthorityRef ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'eip7702-post-execution-status',
      status: postExecutionReady ? 'pass' : 'fail',
      code: postExecutionReady
        ? 'eip7702-post-execution-compatible'
        : 'eip7702-post-execution-failed',
      message: postExecutionReady
        ? 'No failed delegated-EOA post-execution status was observed.'
        : 'Delegated-EOA post-execution status failed and must block.',
      evidence: {
        postExecutionSuccess: input.execution.postExecutionSuccess ?? null,
      },
    }),
  );

  return Object.freeze(observations);
}

function outcomeFromObservations(observations: readonly Eip7702Observation[]): Eip7702Outcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'block';
  }
  if (observations.some((entry) => entry.required && entry.status === 'warn')) {
    return 'review-required';
  }
  return 'allow';
}

function signalStatusFor(outcome: Eip7702Outcome): CryptoSimulationPreflightSignal['status'] {
  switch (outcome) {
    case 'allow':
      return 'pass';
    case 'review-required':
      return 'warn';
    case 'block':
      return 'fail';
  }
}

function failingReasonCodes(observations: readonly Eip7702Observation[]): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.code),
  );
}

function preflightIdFor(input: {
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
  readonly delegateCode: Eip7702DelegateCodeEvidence;
  readonly execution: Eip7702ExecutionEvidence;
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
}): string {
  return canonicalObject({
    version: EIP7702_DELEGATION_ADAPTER_SPEC_VERSION,
    authorityAddress: input.authorization.authorityAddress,
    delegationAddress: input.authorization.delegationAddress,
    authorizationNonce: input.authorization.nonce,
    observedAt: input.accountState.observedAt,
    delegateCodeHash: input.delegateCode.delegateCodeHash,
    executionPath: input.execution.executionPath,
    target: input.execution.target,
    releaseBindingDigest: input.releaseBindingDigest,
    policyScopeDigest: input.policyScopeDigest,
    enforcementBindingDigest: input.enforcementBindingDigest,
  }).digest;
}

function signalFor(input: {
  readonly outcome: Eip7702Outcome;
  readonly preflightId: string;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
  readonly delegateCode: Eip7702DelegateCodeEvidence;
  readonly execution: Eip7702ExecutionEvidence;
  readonly observations: readonly Eip7702Observation[];
}): CryptoSimulationPreflightSignal {
  return Object.freeze({
    source: 'eip-7702-authorization',
    status: signalStatusFor(input.outcome),
    code: input.outcome === 'allow'
      ? 'eip7702-delegation-adapter-allow'
      : input.outcome === 'review-required'
        ? 'eip7702-delegation-adapter-review-required'
        : 'eip7702-delegation-adapter-block',
    message: input.outcome === 'allow'
      ? 'EIP-7702 delegation adapter accepted the Attestor-bound authorization-list preflight.'
      : input.outcome === 'review-required'
        ? 'EIP-7702 delegation adapter needs additional evidence before execution.'
        : 'EIP-7702 delegation adapter would block delegated EOA execution fail-closed.',
    required: true,
    evidence: Object.freeze({
      adapterVersion: EIP7702_DELEGATION_ADAPTER_SPEC_VERSION,
      preflightId: input.preflightId,
      transactionType: EIP7702_SET_CODE_TX_TYPE,
      authorizationMagic: EIP7702_AUTHORIZATION_MAGIC,
      authorityAddress: input.authorization.authorityAddress,
      delegationAddress: input.authorization.delegationAddress,
      authorizationNonce: input.authorization.nonce,
      chainId: input.accountState.chainId,
      executionPath: input.execution.executionPath,
      target: input.execution.target,
      delegateCodeHash: input.delegateCode.delegateCodeHash,
      reasonCodes: failingReasonCodes(input.observations),
    }),
  });
}

export function createEip7702DelegationPreflight(
  input: CreateEip7702DelegationPreflightInput,
): Eip7702DelegationPreflight {
  assertAdapterConsistency(input);
  const authorization = normalizeAuthorization(input.authorization);
  const accountState = normalizeAccountState(input.accountState);
  const delegateCode = normalizeDelegateCode(input.delegateCode);
  const execution = normalizeExecution(input.execution);
  const initialization = normalizeInitialization(input.initialization);
  const sponsor = normalizeSponsor(input.sponsor);
  const recovery = normalizeRecovery(input.recovery);
  const observations = buildObservations({
    intent: input.intent,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    authorization,
    accountState,
    delegateCode,
    execution,
    initialization,
    sponsor,
    recovery,
  });
  const outcome = outcomeFromObservations(observations);
  const preflightId =
    normalizeOptionalIdentifier(input.preflightId, 'preflightId') ??
    preflightIdFor({
      authorization,
      accountState,
      delegateCode,
      execution,
      releaseBindingDigest: input.releaseBinding.digest,
      policyScopeDigest: input.policyScopeBinding.digest,
      enforcementBindingDigest: input.enforcementBinding.digest,
    });
  const signal = signalFor({
    outcome,
    preflightId,
    authorization,
    accountState,
    delegateCode,
    execution,
    observations,
  });
  const canonicalPayload = {
    version: EIP7702_DELEGATION_ADAPTER_SPEC_VERSION,
    preflightId,
    adapterKind: 'eip-7702-delegation' as const,
    checkedAt: accountState.observedAt,
    authorityAddress: authorization.authorityAddress,
    delegationAddress: authorization.delegationAddress,
    chainId: accountState.chainId,
    authorizationNonce: authorization.nonce,
    executionPath: execution.executionPath,
    target: execution.target,
    functionSelector: execution.functionSelector ?? null,
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

export function simulateEip7702DelegationAuthorization(
  input: CreateEip7702DelegationPreflightInput,
): Eip7702DelegationSimulationResult {
  const preflight = createEip7702DelegationPreflight(input);
  const simulation = createCryptoAuthorizationSimulation({
    intent: input.intent,
    riskAssessment: input.riskAssessment,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    simulatedAt: preflight.checkedAt,
    preflightSignals: [preflight.signal],
    operatorNote: `EIP-7702 delegation ${preflight.authorityAddress} -> ${preflight.delegationAddress} preflight ${preflight.outcome}.`,
  });

  return Object.freeze({
    preflight,
    simulation,
  });
}

export function eip7702DelegationPreflightLabel(
  preflight: Eip7702DelegationPreflight,
): string {
  return [
    `eip7702:${preflight.authorityAddress}`,
    `delegate:${preflight.delegationAddress}`,
    `nonce:${preflight.authorizationNonce}`,
    `outcome:${preflight.outcome}`,
  ].join(' / ');
}

export function eip7702DelegationAdapterDescriptor(): Eip7702DelegationAdapterDescriptor {
  return Object.freeze({
    version: EIP7702_DELEGATION_ADAPTER_SPEC_VERSION,
    adapterKind: 'eip-7702-delegation',
    transactionType: EIP7702_SET_CODE_TX_TYPE,
    authorizationMagic: EIP7702_AUTHORIZATION_MAGIC,
    delegationIndicatorPrefix: EIP7702_DELEGATION_INDICATOR_PREFIX,
    initCodeMarker: EIP7702_INITCODE_MARKER,
    executionPaths: EIP7702_EXECUTION_PATHS,
    accountCodeStates: EIP7702_ACCOUNT_CODE_STATES,
    outcomes: EIP7702_OUTCOMES,
    checks: EIP7702_CHECKS,
    references: Object.freeze([
      'EIP-7702',
      'EIP-2718',
      'EIP-155',
      'ERC-4337',
      'ERC-7769',
      'EIP-5792',
      'ERC-7902',
      'authorization-list',
      'delegation-indicator',
      'release-layer',
      'release-policy-control-plane',
      'release-enforcement-plane',
      'attestor-crypto-authorization-simulation',
    ]),
  });
}
