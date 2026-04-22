import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import {
  EIP7702_AUTHORIZATION_MAGIC,
  EIP7702_DELEGATION_INDICATOR_PREFIX,
  EIP7702_INITCODE_MARKER,
  EIP7702_SET_CODE_TX_TYPE,
  type Eip7702AccountCodeState,
  type Eip7702AccountStateEvidence,
  type Eip7702AuthorizationTupleEvidence,
  type Eip7702DelegateCodeEvidence,
  type Eip7702DelegationPreflight,
  type Eip7702ExecutionEvidence,
  type Eip7702ExecutionPath,
  type Eip7702InitializationEvidence,
  type Eip7702RecoveryEvidence,
  type Eip7702SponsorEvidence,
} from '../crypto-authorization-core/eip7702-delegation-adapter.js';
import type { CryptoExecutionAdmissionPlan } from './index.js';

/**
 * Delegated EOA admission handoffs bind EIP-7702 authorization-tuple evidence,
 * delegate-code posture, nonce posture, and path-specific wallet/runtime checks
 * into a deterministic object that a delegated-EOA integration can honor before
 * any value-moving execution is submitted.
 */

export const DELEGATED_EOA_ADMISSION_HANDOFF_SPEC_VERSION =
  'attestor.crypto-delegated-eoa-admission-handoff.v1';

export const DELEGATED_EOA_ADMISSION_OUTCOMES = [
  'ready',
  'needs-runtime-evidence',
  'blocked',
] as const;
export type DelegatedEoaAdmissionOutcome =
  typeof DELEGATED_EOA_ADMISSION_OUTCOMES[number];

export const DELEGATED_EOA_ADMISSION_EXPECTATION_KINDS = [
  'plan-surface',
  'adapter-preflight',
  'authorization-tuple',
  'authority-nonce',
  'delegate-code',
  'account-code-state',
  'execution-path',
  'wallet-capability',
  'initialization',
  'sponsorship',
  'recovery',
  'post-execution',
] as const;
export type DelegatedEoaAdmissionExpectationKind =
  typeof DELEGATED_EOA_ADMISSION_EXPECTATION_KINDS[number];

export const DELEGATED_EOA_ADMISSION_EXPECTATION_STATUSES = [
  'satisfied',
  'missing',
  'unsupported',
  'failed',
] as const;
export type DelegatedEoaAdmissionExpectationStatus =
  typeof DELEGATED_EOA_ADMISSION_EXPECTATION_STATUSES[number];

export interface DelegatedEoaRuntimeObservation {
  readonly observedAt: string;
  readonly txHash?: string | null;
  readonly success: boolean;
  readonly receiptStatus?: string | null;
  readonly codeState?: Eip7702AccountCodeState | null;
  readonly delegationAddress?: string | null;
  readonly nonce?: string | null;
}

export interface DelegatedEoaWalletCapabilityStatus {
  readonly required: boolean;
  readonly observed: boolean | null;
  readonly supported: boolean | null;
  readonly requested: boolean | null;
  readonly atomicRequired: boolean | null;
}

export interface DelegatedEoaRuntimeCheck {
  readonly standard:
    | 'EIP-7702'
    | 'EIP-5792'
    | 'ERC-7902'
    | 'ERC-4337'
    | 'ERC-7769'
    | 'Attestor';
  readonly check: string;
  readonly reason: string;
}

export interface DelegatedEoaAdmissionExpectation {
  readonly kind: DelegatedEoaAdmissionExpectationKind;
  readonly status: DelegatedEoaAdmissionExpectationStatus;
  readonly reasonCode: string;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateDelegatedEoaAdmissionHandoffInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Eip7702DelegationPreflight;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
  readonly delegateCode: Eip7702DelegateCodeEvidence;
  readonly execution: Eip7702ExecutionEvidence;
  readonly initialization: Eip7702InitializationEvidence;
  readonly sponsor: Eip7702SponsorEvidence;
  readonly recovery: Eip7702RecoveryEvidence;
  readonly createdAt: string;
  readonly handoffId?: string | null;
  readonly runtimeId?: string | null;
  readonly walletProviderId?: string | null;
  readonly runtimeObservation?: DelegatedEoaRuntimeObservation | null;
  readonly operatorNote?: string | null;
}

export interface DelegatedEoaAdmissionHandoff {
  readonly version: typeof DELEGATED_EOA_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly handoffId: string;
  readonly createdAt: string;
  readonly outcome: DelegatedEoaAdmissionOutcome;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly preflightId: string;
  readonly preflightDigest: string;
  readonly authorityAddress: string;
  readonly delegationAddress: string;
  readonly chainId: string;
  readonly chainIdHex: string;
  readonly authorizationNonce: string;
  readonly executionPath: Eip7702ExecutionPath;
  readonly target: string;
  readonly functionSelector: string | null;
  readonly setCodeTransactionType: typeof EIP7702_SET_CODE_TX_TYPE;
  readonly authorizationMagic: typeof EIP7702_AUTHORIZATION_MAGIC;
  readonly delegationIndicatorPrefix: typeof EIP7702_DELEGATION_INDICATOR_PREFIX;
  readonly runtimeId: string | null;
  readonly walletProviderId: string | null;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
  readonly delegateCode: Eip7702DelegateCodeEvidence;
  readonly execution: Eip7702ExecutionEvidence;
  readonly walletCapability: DelegatedEoaWalletCapabilityStatus | null;
  readonly initialization: Eip7702InitializationEvidence;
  readonly sponsor: Eip7702SponsorEvidence;
  readonly recovery: Eip7702RecoveryEvidence;
  readonly runtimeChecks: readonly DelegatedEoaRuntimeCheck[];
  readonly runtimeObservation: DelegatedEoaRuntimeObservation | null;
  readonly attestorSidecar: Readonly<Record<string, CanonicalReleaseJsonValue>>;
  readonly expectations: readonly DelegatedEoaAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface DelegatedEoaAdmissionDescriptor {
  readonly version: typeof DELEGATED_EOA_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly outcomes: typeof DELEGATED_EOA_ADMISSION_OUTCOMES;
  readonly expectationKinds: typeof DELEGATED_EOA_ADMISSION_EXPECTATION_KINDS;
  readonly expectationStatuses: typeof DELEGATED_EOA_ADMISSION_EXPECTATION_STATUSES;
  readonly standards: readonly string[];
  readonly runtimeChecks: readonly string[];
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`Delegated EOA admission ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Delegated EOA admission ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(normalized)) {
    throw new Error(`Delegated EOA admission ${fieldName} must be an EVM address.`);
  }
  return normalized;
}

function normalizeOptionalAddress(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeAddress(value, fieldName);
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`Delegated EOA admission ${fieldName} must be a 32-byte hex value.`);
  }
  return normalized;
}

function normalizeOptionalHash(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeHash(value, fieldName);
}

function normalizeHexBytes(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]*$/u.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`Delegated EOA admission ${fieldName} must be 0x-prefixed hex bytes.`);
  }
  return normalized;
}

function normalizeOptionalHexBytes(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeHexBytes(value, fieldName);
}

function normalizeSelector(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{8}$/u.test(normalized)) {
    throw new Error(`Delegated EOA admission ${fieldName} must be a 4-byte selector.`);
  }
  return normalized;
}

function normalizeDecimalInteger(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error(`Delegated EOA admission ${fieldName} must be a decimal integer.`);
  }
  return normalized;
}

function normalizeOptionalDecimalInteger(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeDecimalInteger(value, fieldName);
}

function normalizeQuantity(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(normalized)) return normalized;
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error(
      `Delegated EOA admission ${fieldName} must be a decimal integer or 0x quantity.`,
    );
  }
  return normalized;
}

function normalizeCaip2ChainId(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^eip155:(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error(
      `Delegated EOA admission ${fieldName} must be an EIP-155 CAIP-2 chain id.`,
    );
  }
  return normalized;
}

function normalizeYParity(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (normalized === '0' || normalized === '0x0') return '0';
  if (normalized === '1' || normalized === '0x1') return '1';
  throw new Error(`Delegated EOA admission ${fieldName} must be 0 or 1.`);
}

function normalizeTransactionType(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (normalized === '0x4' || normalized === '0x04') return '0x04';
  throw new Error(`Delegated EOA admission ${fieldName} must be the EIP-7702 type 0x04.`);
}

function normalizeDelegationIndicator(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0xef0100[0-9a-f]{40}$/u.test(normalized)) {
    throw new Error(
      `Delegated EOA admission ${fieldName} must be a valid EIP-7702 delegation indicator.`,
    );
  }
  return normalized;
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

function chainIdNumberFromCaip2(chainId: string): string {
  const [namespace, id] = chainId.split(':');
  if (namespace !== 'eip155' || !id) {
    throw new Error(
      'Delegated EOA admission requires an EIP-155 CAIP-2 chain id such as eip155:1.',
    );
  }
  return id;
}

function chainIdHexFromCaip2(chainId: string): string {
  return `0x${BigInt(chainIdNumberFromCaip2(chainId)).toString(16)}`;
}

function delegationIndicatorFor(address: string): string {
  return `${EIP7702_DELEGATION_INDICATOR_PREFIX}${address.slice(2)}`;
}

function normalizeAuthorization(
  value: Eip7702AuthorizationTupleEvidence,
): Eip7702AuthorizationTupleEvidence {
  return Object.freeze({
    chainId: normalizeDecimalInteger(value.chainId, 'authorization.chainId'),
    authorityAddress: normalizeAddress(value.authorityAddress, 'authorization.authorityAddress'),
    delegationAddress: normalizeAddress(
      value.delegationAddress,
      'authorization.delegationAddress',
    ),
    nonce: normalizeDecimalInteger(value.nonce, 'authorization.nonce'),
    yParity: normalizeYParity(value.yParity, 'authorization.yParity'),
    r: normalizeHash(value.r, 'authorization.r'),
    s: normalizeHash(value.s, 'authorization.s'),
    tupleHash: normalizeOptionalHash(value.tupleHash, 'authorization.tupleHash'),
    signatureRecoveredAddress: normalizeOptionalAddress(
      value.signatureRecoveredAddress,
      'authorization.signatureRecoveredAddress',
    ),
    signatureValid: value.signatureValid,
    lowS: value.lowS,
  });
}

function normalizeAccountState(
  value: Eip7702AccountStateEvidence,
): Eip7702AccountStateEvidence {
  const codeState = value.codeState;
  if (codeState !== 'empty' && codeState !== 'delegated' && codeState !== 'other-code') {
    throw new Error('Delegated EOA admission accountState.codeState is invalid.');
  }
  const pendingTransactionCount = value.pendingTransactionCount;
  if (
    pendingTransactionCount !== undefined &&
    pendingTransactionCount !== null &&
    (!Number.isInteger(pendingTransactionCount) || pendingTransactionCount < 0)
  ) {
    throw new Error(
      'Delegated EOA admission accountState.pendingTransactionCount must be a non-negative integer.',
    );
  }
  return Object.freeze({
    observedAt: normalizeIsoTimestamp(value.observedAt, 'accountState.observedAt'),
    chainId: normalizeCaip2ChainId(value.chainId, 'accountState.chainId'),
    authorityAddress: normalizeAddress(value.authorityAddress, 'accountState.authorityAddress'),
    currentNonce: normalizeDecimalInteger(value.currentNonce, 'accountState.currentNonce'),
    codeState,
    currentDelegationAddress: normalizeOptionalAddress(
      value.currentDelegationAddress,
      'accountState.currentDelegationAddress',
    ),
    delegationIndicator: normalizeDelegationIndicator(
      value.delegationIndicator,
      'accountState.delegationIndicator',
    ),
    codeHash: normalizeOptionalHash(value.codeHash, 'accountState.codeHash'),
    pendingTransactionCount:
      pendingTransactionCount === undefined ? null : pendingTransactionCount,
    pendingTransactionPolicyCompliant: value.pendingTransactionPolicyCompliant,
  });
}

function normalizeDelegateCode(
  value: Eip7702DelegateCodeEvidence,
): Eip7702DelegateCodeEvidence {
  return Object.freeze({
    delegationAddress: normalizeAddress(value.delegationAddress, 'delegateCode.delegationAddress'),
    delegateCodeHash: normalizeHash(value.delegateCodeHash, 'delegateCode.delegateCodeHash'),
    delegateImplementationId: normalizeIdentifier(
      value.delegateImplementationId,
      'delegateCode.delegateImplementationId',
    ),
    audited: value.audited,
    allowlisted: value.allowlisted,
    storageLayoutSafe: value.storageLayoutSafe,
    supportsReplayProtection: value.supportsReplayProtection,
    supportsTargetCalldataBinding: value.supportsTargetCalldataBinding,
    supportsValueBinding: value.supportsValueBinding,
    supportsGasBinding: value.supportsGasBinding,
    supportsExpiryBinding: value.supportsExpiryBinding,
  });
}

function normalizeExecution(value: Eip7702ExecutionEvidence): Eip7702ExecutionEvidence {
  const executionPath = value.executionPath;
  if (
    executionPath !== 'set-code-transaction' &&
    executionPath !== 'erc-4337-user-operation' &&
    executionPath !== 'wallet-call-api'
  ) {
    throw new Error('Delegated EOA admission execution.executionPath is invalid.');
  }
  const batchCallCount = value.batchCallCount;
  if (
    batchCallCount !== undefined &&
    batchCallCount !== null &&
    (!Number.isInteger(batchCallCount) || batchCallCount < 0)
  ) {
    throw new Error(
      'Delegated EOA admission execution.batchCallCount must be a non-negative integer.',
    );
  }
  return Object.freeze({
    executionPath,
    transactionType:
      value.transactionType === undefined || value.transactionType === null
        ? null
        : normalizeTransactionType(value.transactionType, 'execution.transactionType'),
    authorizationListLength: value.authorizationListLength,
    tupleIndex: value.tupleIndex,
    tupleIsLastValidForAuthority: value.tupleIsLastValidForAuthority,
    authorizationListNonEmpty: value.authorizationListNonEmpty,
    destination: normalizeAddress(value.destination, 'execution.destination'),
    target: normalizeAddress(value.target, 'execution.target'),
    value: normalizeQuantity(value.value, 'execution.value'),
    data: normalizeHexBytes(value.data, 'execution.data'),
    functionSelector: normalizeSelector(value.functionSelector, 'execution.functionSelector'),
    calldataClass: normalizeOptionalIdentifier(
      value.calldataClass,
      'execution.calldataClass',
    ),
    batchCallCount: batchCallCount === undefined ? null : batchCallCount,
    targetCalldataSigned: value.targetCalldataSigned,
    valueSigned: value.valueSigned,
    gasLimitSigned: value.gasLimitSigned,
    nonceSigned: value.nonceSigned,
    expirySigned: value.expirySigned,
    runtimeContextBound: value.runtimeContextBound,
    userOperationHash: normalizeOptionalHash(
      value.userOperationHash,
      'execution.userOperationHash',
    ),
    entryPoint: normalizeOptionalAddress(value.entryPoint, 'execution.entryPoint'),
    initCodeMarker: normalizeOptionalIdentifier(value.initCodeMarker, 'execution.initCodeMarker'),
    factoryDataHash: normalizeOptionalHash(value.factoryDataHash, 'execution.factoryDataHash'),
    eip7702AuthIncluded:
      value.eip7702AuthIncluded === undefined ? null : value.eip7702AuthIncluded,
    preVerificationGasIncludesAuthorizationCost:
      value.preVerificationGasIncludesAuthorizationCost === undefined
        ? null
        : value.preVerificationGasIncludesAuthorizationCost,
    walletCapabilityObserved:
      value.walletCapabilityObserved === undefined ? null : value.walletCapabilityObserved,
    walletCapabilitySupported:
      value.walletCapabilitySupported === undefined ? null : value.walletCapabilitySupported,
    walletCapabilityRequested:
      value.walletCapabilityRequested === undefined ? null : value.walletCapabilityRequested,
    atomicRequired: value.atomicRequired === undefined ? null : value.atomicRequired,
    postExecutionSuccess:
      value.postExecutionSuccess === undefined ? null : value.postExecutionSuccess,
  });
}

function normalizeInitialization(
  value: Eip7702InitializationEvidence,
): Eip7702InitializationEvidence {
  return Object.freeze({
    initializationRequired: value.initializationRequired,
    initializationCalldataHash: normalizeOptionalHash(
      value.initializationCalldataHash,
      'initialization.initializationCalldataHash',
    ),
    initializationSignedByAuthority:
      value.initializationSignedByAuthority === undefined
        ? null
        : value.initializationSignedByAuthority,
    initializationExecutedBeforeValidation:
      value.initializationExecutedBeforeValidation === undefined
        ? null
        : value.initializationExecutedBeforeValidation,
    frontRunProtected:
      value.frontRunProtected === undefined ? null : value.frontRunProtected,
  });
}

function normalizeSponsor(value: Eip7702SponsorEvidence): Eip7702SponsorEvidence {
  return Object.freeze({
    sponsored: value.sponsored,
    sponsorAddress: normalizeOptionalAddress(value.sponsorAddress, 'sponsor.sponsorAddress'),
    sponsorBondRequired:
      value.sponsorBondRequired === undefined ? null : value.sponsorBondRequired,
    sponsorBondPresent:
      value.sponsorBondPresent === undefined ? null : value.sponsorBondPresent,
    reimbursementBound:
      value.reimbursementBound === undefined ? null : value.reimbursementBound,
  });
}

function normalizeRecovery(value: Eip7702RecoveryEvidence): Eip7702RecoveryEvidence {
  return Object.freeze({
    revocationPathReady: value.revocationPathReady,
    zeroAddressClearSupported: value.zeroAddressClearSupported,
    privateKeyStillControlsAccountAcknowledged:
      value.privateKeyStillControlsAccountAcknowledged,
    emergencyDelegateResetPrepared: value.emergencyDelegateResetPrepared,
    recoveryAuthorityRef: normalizeOptionalIdentifier(
      value.recoveryAuthorityRef,
      'recovery.recoveryAuthorityRef',
    ),
  });
}

function normalizeRuntimeObservation(
  value: DelegatedEoaRuntimeObservation | null | undefined,
): DelegatedEoaRuntimeObservation | null {
  if (value === undefined || value === null) return null;
  const codeState = value.codeState ?? null;
  if (
    codeState !== null &&
    codeState !== 'empty' &&
    codeState !== 'delegated' &&
    codeState !== 'other-code'
  ) {
    throw new Error('Delegated EOA admission runtimeObservation.codeState is invalid.');
  }
  return Object.freeze({
    observedAt: normalizeIsoTimestamp(value.observedAt, 'runtimeObservation.observedAt'),
    txHash: normalizeOptionalHash(value.txHash, 'runtimeObservation.txHash'),
    success: value.success,
    receiptStatus: normalizeOptionalIdentifier(
      value.receiptStatus,
      'runtimeObservation.receiptStatus',
    ),
    codeState,
    delegationAddress: normalizeOptionalAddress(
      value.delegationAddress,
      'runtimeObservation.delegationAddress',
    ),
    nonce: normalizeOptionalDecimalInteger(value.nonce, 'runtimeObservation.nonce'),
  });
}

function walletCapabilityStatus(
  execution: Eip7702ExecutionEvidence,
): DelegatedEoaWalletCapabilityStatus | null {
  if (
    execution.executionPath !== 'wallet-call-api' &&
    execution.walletCapabilityObserved === null &&
    execution.walletCapabilitySupported === null &&
    execution.walletCapabilityRequested === null &&
    execution.atomicRequired === null
  ) {
    return null;
  }
  return Object.freeze({
    required: execution.executionPath === 'wallet-call-api',
    observed: execution.walletCapabilityObserved ?? null,
    supported: execution.walletCapabilitySupported ?? null,
    requested: execution.walletCapabilityRequested ?? null,
    atomicRequired: execution.atomicRequired ?? null,
  });
}

function runtimeChecksFor(
  executionPath: Eip7702ExecutionPath,
): readonly DelegatedEoaRuntimeCheck[] {
  const checks: DelegatedEoaRuntimeCheck[] = [
    {
      standard: 'EIP-7702',
      check: 'authorizationTuple',
      reason: 'Authorization tuple must match the admitted authority, delegate, and nonce.',
    },
    {
      standard: 'EIP-7702',
      check: 'authorityNonce',
      reason: 'Authority nonce and pending-transaction posture must still match the admitted tuple.',
    },
    {
      standard: 'Attestor',
      check: 'delegateCodePosture',
      reason: 'Delegate code must stay audited, allowlisted, and scope-binding safe.',
    },
    {
      standard: 'EIP-7702',
      check: 'runtimeContextBinding',
      reason: 'Target, calldata class, value, gas, and nonce must stay bound to the admitted context.',
    },
  ];
  if (executionPath === 'set-code-transaction') {
    checks.push({
      standard: 'EIP-7702',
      check: 'setCodeTransactionType',
      reason: 'Direct delegated EOA execution must use type 0x04 with a non-empty authorization list.',
    });
  }
  if (executionPath === 'wallet-call-api') {
    checks.push({
      standard: 'EIP-5792',
      check: 'walletSendCalls',
      reason: 'Wallet runtime must project the admitted delegated EOA call through wallet_sendCalls.',
    });
    checks.push({
      standard: 'ERC-7902',
      check: 'eip7702Auth',
      reason: 'Wallet must support the eip7702Auth capability for the admitted authority/delegate pair.',
    });
  }
  if (executionPath === 'erc-4337-user-operation') {
    checks.push({
      standard: 'ERC-4337',
      check: 'eip7702Auth',
      reason: 'UserOperation path must carry the EIP-7702 authorization tuple when delegation is being changed.',
    });
    checks.push({
      standard: 'ERC-7769',
      check: 'preVerificationGasIncludesAuthorizationCost',
      reason: 'Bundler-facing gas evidence must account for EIP-7702 authorization overhead.',
    });
  }
  return Object.freeze(checks);
}

function expectation(input: {
  readonly kind: DelegatedEoaAdmissionExpectationKind;
  readonly status: DelegatedEoaAdmissionExpectationStatus;
  readonly reasonCode: string;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): DelegatedEoaAdmissionExpectation {
  return Object.freeze({
    kind: input.kind,
    status: input.status,
    reasonCode: normalizeIdentifier(input.reasonCode, 'expectation.reasonCode'),
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function authorizationExpectation(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Eip7702DelegationPreflight;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
}): DelegatedEoaAdmissionExpectation {
  const currentChainId = chainIdNumberFromCaip2(input.plan.chainId);
  const chainScopeReady =
    input.authorization.chainId === '0' || input.authorization.chainId === currentChainId;
  const addressReady =
    input.authorization.authorityAddress ===
      normalizeAddress(input.preflight.authorityAddress, 'preflight.authorityAddress') &&
    input.authorization.delegationAddress ===
      normalizeAddress(input.preflight.delegationAddress, 'preflight.delegationAddress');
  const nonceReady =
    input.authorization.nonce ===
    normalizeDecimalInteger(input.preflight.authorizationNonce, 'preflight.authorizationNonce');
  const recoveredMissing = input.authorization.signatureRecoveredAddress === null;
  const recoveredReady =
    input.authorization.signatureRecoveredAddress === input.authorization.authorityAddress;
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-authorization-tuple-ready';
  if (!chainScopeReady) {
    status = 'failed';
    reasonCode = 'eip7702-authorization-chain-scope-mismatch';
  } else if (!addressReady) {
    status = 'failed';
    reasonCode = 'eip7702-authorization-address-mismatch';
  } else if (!nonceReady) {
    status = 'failed';
    reasonCode = 'eip7702-authorization-nonce-mismatch';
  } else if (!input.authorization.signatureValid) {
    status = 'failed';
    reasonCode = 'eip7702-authorization-signature-invalid';
  } else if (!input.authorization.lowS) {
    status = 'failed';
    reasonCode = 'eip7702-authorization-high-s';
  } else if (recoveredMissing) {
    status = 'missing';
    reasonCode = 'eip7702-authorization-recovered-address-missing';
  } else if (!recoveredReady) {
    status = 'failed';
    reasonCode = 'eip7702-authorization-recovered-address-mismatch';
  }
  return expectation({
    kind: 'authorization-tuple',
    status,
    reasonCode,
    evidence: {
      authorizationChainId: input.authorization.chainId,
      expectedChainId: currentChainId,
      authorityAddress: input.authorization.authorityAddress,
      delegationAddress: input.authorization.delegationAddress,
      nonce: input.authorization.nonce,
      tupleHash: input.authorization.tupleHash ?? null,
      signatureRecoveredAddress: input.authorization.signatureRecoveredAddress ?? null,
      signatureValid: input.authorization.signatureValid,
      lowS: input.authorization.lowS,
    },
  });
}

function authorityNonceExpectation(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Eip7702DelegationPreflight;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
}): DelegatedEoaAdmissionExpectation {
  const authorityReady =
    input.accountState.authorityAddress === input.authorization.authorityAddress;
  const chainReady = input.accountState.chainId === input.plan.chainId;
  const nonceReady =
    input.accountState.currentNonce === input.authorization.nonce &&
    input.accountState.currentNonce ===
      normalizeDecimalInteger(input.preflight.authorizationNonce, 'preflight.authorizationNonce');
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-authority-nonce-ready';
  if (!authorityReady || !chainReady || !nonceReady) {
    status = 'failed';
    reasonCode = 'eip7702-authority-nonce-mismatch';
  } else if (!input.accountState.pendingTransactionPolicyCompliant) {
    status = 'failed';
    reasonCode = 'eip7702-pending-transaction-policy-noncompliant';
  }
  return expectation({
    kind: 'authority-nonce',
    status,
    reasonCode,
    evidence: {
      chainId: input.accountState.chainId,
      currentNonce: input.accountState.currentNonce,
      expectedNonce: input.authorization.nonce,
      pendingTransactionCount: input.accountState.pendingTransactionCount ?? null,
      pendingTransactionPolicyCompliant: input.accountState.pendingTransactionPolicyCompliant,
    },
  });
}

function delegateCodeExpectation(input: {
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly delegateCode: Eip7702DelegateCodeEvidence;
}): DelegatedEoaAdmissionExpectation {
  const addressReady =
    input.delegateCode.delegationAddress === input.authorization.delegationAddress;
  const criticalReady =
    input.delegateCode.audited &&
    input.delegateCode.allowlisted &&
    input.delegateCode.storageLayoutSafe &&
    input.delegateCode.supportsReplayProtection &&
    input.delegateCode.supportsTargetCalldataBinding &&
    input.delegateCode.supportsValueBinding &&
    input.delegateCode.supportsGasBinding;
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-delegate-code-ready';
  if (!addressReady) {
    status = 'failed';
    reasonCode = 'eip7702-delegate-address-mismatch';
  } else if (!criticalReady) {
    status = 'failed';
    reasonCode = 'eip7702-delegate-code-posture-blocked';
  } else if (!input.delegateCode.supportsExpiryBinding) {
    status = 'missing';
    reasonCode = 'eip7702-delegate-expiry-binding-missing';
  }
  return expectation({
    kind: 'delegate-code',
    status,
    reasonCode,
    evidence: {
      delegateImplementationId: input.delegateCode.delegateImplementationId,
      delegateCodeHash: input.delegateCode.delegateCodeHash,
      audited: input.delegateCode.audited,
      allowlisted: input.delegateCode.allowlisted,
      storageLayoutSafe: input.delegateCode.storageLayoutSafe,
      supportsReplayProtection: input.delegateCode.supportsReplayProtection,
      supportsTargetCalldataBinding: input.delegateCode.supportsTargetCalldataBinding,
      supportsValueBinding: input.delegateCode.supportsValueBinding,
      supportsGasBinding: input.delegateCode.supportsGasBinding,
      supportsExpiryBinding: input.delegateCode.supportsExpiryBinding,
    },
  });
}

function accountCodeStateExpectation(input: {
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
}): DelegatedEoaAdmissionExpectation {
  const currentDelegationAddress = input.accountState.currentDelegationAddress ?? null;
  const delegationIndicator = input.accountState.delegationIndicator ?? null;
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-account-code-state-ready';
  if (input.accountState.codeState === 'other-code') {
    status = 'failed';
    reasonCode = 'eip7702-account-has-other-code';
  } else if (input.accountState.codeState === 'empty') {
    if (
      currentDelegationAddress !== null ||
      delegationIndicator !== null
    ) {
      status = 'failed';
      reasonCode = 'eip7702-empty-account-state-inconsistent';
    }
  } else if (currentDelegationAddress === null) {
    status = 'missing';
    reasonCode = 'eip7702-current-delegation-address-missing';
  } else if (delegationIndicator === null) {
    status = 'missing';
    reasonCode = 'eip7702-delegation-indicator-missing';
  } else if (delegationIndicator !== delegationIndicatorFor(currentDelegationAddress)) {
    status = 'failed';
    reasonCode = 'eip7702-delegation-indicator-mismatch';
  }
  return expectation({
    kind: 'account-code-state',
    status,
    reasonCode,
    evidence: {
      codeState: input.accountState.codeState,
      currentDelegationAddress,
      delegationIndicator,
      requestedDelegationAddress: input.authorization.delegationAddress,
      codeHash: input.accountState.codeHash ?? null,
    },
  });
}

function executionPathExpectation(input: {
  readonly preflight: Eip7702DelegationPreflight;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly execution: Eip7702ExecutionEvidence;
}): DelegatedEoaAdmissionExpectation {
  const pathReady = input.execution.executionPath === input.preflight.executionPath;
  const targetReady =
    input.execution.target === normalizeAddress(input.preflight.target, 'preflight.target');
  const selectorReady =
    input.execution.functionSelector ===
    normalizeSelector(input.preflight.functionSelector, 'preflight.functionSelector');
  const tupleIndexReady =
    input.execution.authorizationListNonEmpty &&
    input.execution.authorizationListLength > 0 &&
    input.execution.tupleIndex >= 0 &&
    input.execution.tupleIndex < input.execution.authorizationListLength &&
    input.execution.tupleIsLastValidForAuthority;
  const bindingsReady =
    input.execution.targetCalldataSigned &&
    input.execution.valueSigned &&
    input.execution.gasLimitSigned &&
    input.execution.nonceSigned &&
    input.execution.runtimeContextBound;
  const expiryReady = input.execution.expirySigned;
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-execution-path-ready';
  if (!pathReady) {
    status = 'failed';
    reasonCode = 'eip7702-execution-path-mismatch';
  } else if (!targetReady || !selectorReady) {
    status = 'failed';
    reasonCode = 'eip7702-target-or-selector-mismatch';
  } else if (!tupleIndexReady) {
    status = 'failed';
    reasonCode = 'eip7702-authorization-list-evidence-invalid';
  } else if (!bindingsReady) {
    status = 'failed';
    reasonCode = 'eip7702-call-scope-binding-failed';
  } else if (input.execution.executionPath === 'set-code-transaction') {
    if (input.execution.transactionType !== EIP7702_SET_CODE_TX_TYPE) {
      status = 'failed';
      reasonCode = 'eip7702-transaction-type-mismatch';
    } else if (!expiryReady) {
      status = 'missing';
      reasonCode = 'eip7702-expiry-binding-missing';
    }
  } else if (input.execution.executionPath === 'erc-4337-user-operation') {
    if (input.execution.eip7702AuthIncluded !== true) {
      status = 'failed';
      reasonCode = 'eip7702-useroperation-auth-missing';
    } else if (input.execution.initCodeMarker !== EIP7702_INITCODE_MARKER) {
      status = 'failed';
      reasonCode = 'eip7702-useroperation-initcode-marker-mismatch';
    } else if (input.execution.entryPoint === null) {
      status = 'missing';
      reasonCode = 'eip7702-useroperation-entrypoint-missing';
    } else if (input.execution.preVerificationGasIncludesAuthorizationCost !== true) {
      status = 'failed';
      reasonCode = 'eip7702-useroperation-auth-gas-not-covered';
    } else if (!expiryReady) {
      status = 'missing';
      reasonCode = 'eip7702-expiry-binding-missing';
    }
  } else if (!expiryReady) {
    status = 'missing';
    reasonCode = 'eip7702-expiry-binding-missing';
  }
  return expectation({
    kind: 'execution-path',
    status,
    reasonCode,
    evidence: {
      executionPath: input.execution.executionPath,
      transactionType: input.execution.transactionType ?? null,
      authorizationListLength: input.execution.authorizationListLength,
      tupleIndex: input.execution.tupleIndex,
      tupleIsLastValidForAuthority: input.execution.tupleIsLastValidForAuthority,
      target: input.execution.target,
      functionSelector: input.execution.functionSelector ?? null,
      targetCalldataSigned: input.execution.targetCalldataSigned,
      valueSigned: input.execution.valueSigned,
      gasLimitSigned: input.execution.gasLimitSigned,
      nonceSigned: input.execution.nonceSigned,
      expirySigned: input.execution.expirySigned,
      runtimeContextBound: input.execution.runtimeContextBound,
      eip7702AuthIncluded: input.execution.eip7702AuthIncluded ?? null,
      initCodeMarker: input.execution.initCodeMarker ?? null,
      preVerificationGasIncludesAuthorizationCost:
        input.execution.preVerificationGasIncludesAuthorizationCost ?? null,
      entryPoint: input.execution.entryPoint ?? null,
      userOperationHash: input.execution.userOperationHash ?? null,
    },
  });
}

function walletCapabilityExpectation(
  execution: Eip7702ExecutionEvidence,
): DelegatedEoaAdmissionExpectation {
  if (execution.executionPath !== 'wallet-call-api') {
    return expectation({
      kind: 'wallet-capability',
      status: 'satisfied',
      reasonCode: 'eip7702-wallet-capability-not-required',
      evidence: {
        executionPath: execution.executionPath,
      },
    });
  }
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-wallet-capability-ready';
  if (execution.walletCapabilityObserved !== true || execution.walletCapabilityRequested !== true) {
    status = 'missing';
    reasonCode = 'eip7702-wallet-capability-evidence-missing';
  } else if (execution.walletCapabilitySupported !== true) {
    status = 'unsupported';
    reasonCode = 'eip7702-wallet-capability-unsupported';
  }
  return expectation({
    kind: 'wallet-capability',
    status,
    reasonCode,
    evidence: {
      observed: execution.walletCapabilityObserved ?? null,
      supported: execution.walletCapabilitySupported ?? null,
      requested: execution.walletCapabilityRequested ?? null,
      atomicRequired: execution.atomicRequired ?? null,
    },
  });
}

function initializationExpectation(input: {
  readonly execution: Eip7702ExecutionEvidence;
  readonly initialization: Eip7702InitializationEvidence;
}): DelegatedEoaAdmissionExpectation {
  if (!input.initialization.initializationRequired) {
    return expectation({
      kind: 'initialization',
      status: 'satisfied',
      reasonCode: 'eip7702-initialization-not-required',
    });
  }
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-initialization-ready';
  if (input.initialization.initializationCalldataHash === null) {
    status = 'missing';
    reasonCode = 'eip7702-initialization-calldata-hash-missing';
  } else if (input.initialization.initializationSignedByAuthority !== true) {
    status = 'failed';
    reasonCode = 'eip7702-initialization-not-signed-by-authority';
  } else if (input.initialization.frontRunProtected !== true) {
    status = 'failed';
    reasonCode = 'eip7702-initialization-front-run-protection-missing';
  } else if (
    input.execution.executionPath === 'erc-4337-user-operation' &&
    input.initialization.initializationExecutedBeforeValidation !== true
  ) {
    status = 'failed';
    reasonCode = 'eip7702-initialization-not-before-validation';
  }
  return expectation({
    kind: 'initialization',
    status,
    reasonCode,
    evidence: {
      initializationRequired: input.initialization.initializationRequired,
      initializationCalldataHash: input.initialization.initializationCalldataHash ?? null,
      initializationSignedByAuthority:
        input.initialization.initializationSignedByAuthority ?? null,
      initializationExecutedBeforeValidation:
        input.initialization.initializationExecutedBeforeValidation ?? null,
      frontRunProtected: input.initialization.frontRunProtected ?? null,
    },
  });
}

function sponsorshipExpectation(
  sponsor: Eip7702SponsorEvidence,
): DelegatedEoaAdmissionExpectation {
  if (!sponsor.sponsored) {
    return expectation({
      kind: 'sponsorship',
      status: 'satisfied',
      reasonCode: 'eip7702-sponsorship-not-used',
    });
  }
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-sponsored-path-ready';
  if (sponsor.sponsorAddress === null) {
    status = 'missing';
    reasonCode = 'eip7702-sponsor-address-missing';
  } else if (sponsor.sponsorBondRequired === true && sponsor.sponsorBondPresent !== true) {
    status = 'failed';
    reasonCode = 'eip7702-sponsor-bond-missing';
  } else if (sponsor.reimbursementBound !== true) {
    status = 'failed';
    reasonCode = 'eip7702-sponsor-reimbursement-unbound';
  }
  return expectation({
    kind: 'sponsorship',
    status,
    reasonCode,
    evidence: {
      sponsored: sponsor.sponsored,
      sponsorAddress: sponsor.sponsorAddress ?? null,
      sponsorBondRequired: sponsor.sponsorBondRequired ?? null,
      sponsorBondPresent: sponsor.sponsorBondPresent ?? null,
      reimbursementBound: sponsor.reimbursementBound ?? null,
    },
  });
}

function recoveryExpectation(
  recovery: Eip7702RecoveryEvidence,
): DelegatedEoaAdmissionExpectation {
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-recovery-ready';
  if (!recovery.privateKeyStillControlsAccountAcknowledged) {
    status = 'failed';
    reasonCode = 'eip7702-private-key-control-not-acknowledged';
  } else if (
    !recovery.revocationPathReady ||
    (!recovery.zeroAddressClearSupported && !recovery.emergencyDelegateResetPrepared)
  ) {
    status = 'missing';
    reasonCode = 'eip7702-recovery-posture-incomplete';
  }
  return expectation({
    kind: 'recovery',
    status,
    reasonCode,
    evidence: {
      revocationPathReady: recovery.revocationPathReady,
      zeroAddressClearSupported: recovery.zeroAddressClearSupported,
      privateKeyStillControlsAccountAcknowledged:
        recovery.privateKeyStillControlsAccountAcknowledged,
      emergencyDelegateResetPrepared: recovery.emergencyDelegateResetPrepared,
      recoveryAuthorityRef: recovery.recoveryAuthorityRef ?? null,
    },
  });
}

function postExecutionExpectation(input: {
  readonly delegationAddress: string;
  readonly runtimeObservation: DelegatedEoaRuntimeObservation | null;
}): DelegatedEoaAdmissionExpectation {
  if (input.runtimeObservation === null) {
    return expectation({
      kind: 'post-execution',
      status: 'satisfied',
      reasonCode: 'eip7702-post-execution-pending',
    });
  }
  let status: DelegatedEoaAdmissionExpectationStatus = 'satisfied';
  let reasonCode = 'eip7702-post-execution-compatible';
  if (!input.runtimeObservation.success) {
    status = 'failed';
    reasonCode = 'eip7702-post-execution-failed';
  } else if (
    input.runtimeObservation.delegationAddress !== null &&
    input.runtimeObservation.delegationAddress !== input.delegationAddress
  ) {
    status = 'failed';
    reasonCode = 'eip7702-post-execution-delegation-mismatch';
  } else if (input.runtimeObservation.codeState === 'other-code') {
    status = 'failed';
    reasonCode = 'eip7702-post-execution-other-code';
  }
  return expectation({
    kind: 'post-execution',
    status,
    reasonCode,
    evidence: {
      runtimeObservation: input.runtimeObservation as unknown as CanonicalReleaseJsonValue,
    },
  });
}

function expectationsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Eip7702DelegationPreflight;
  readonly authorization: Eip7702AuthorizationTupleEvidence;
  readonly accountState: Eip7702AccountStateEvidence;
  readonly delegateCode: Eip7702DelegateCodeEvidence;
  readonly execution: Eip7702ExecutionEvidence;
  readonly initialization: Eip7702InitializationEvidence;
  readonly sponsor: Eip7702SponsorEvidence;
  readonly recovery: Eip7702RecoveryEvidence;
  readonly runtimeObservation: DelegatedEoaRuntimeObservation | null;
}): readonly DelegatedEoaAdmissionExpectation[] {
  const planSurfaceReady =
    input.plan.surface === 'delegated-eoa-runtime' &&
    input.plan.adapterKind === 'eip-7702-delegation' &&
    input.preflight.adapterKind === 'eip-7702-delegation' &&
    input.plan.chainId === input.preflight.chainId &&
    normalizeAddress(input.plan.accountAddress, 'plan.accountAddress') ===
      normalizeAddress(input.preflight.authorityAddress, 'preflight.authorityAddress');
  const adapterPreflightReady = input.preflight.outcome === 'allow';
  const adapterPreflightStatus: DelegatedEoaAdmissionExpectationStatus =
    adapterPreflightReady
      ? 'satisfied'
      : input.preflight.outcome === 'review-required'
        ? 'missing'
        : 'failed';
  const adapterPreflightReason =
    input.preflight.outcome === 'allow'
      ? 'eip7702-preflight-allow'
      : input.preflight.outcome === 'review-required'
        ? 'eip7702-preflight-review-required'
        : 'eip7702-preflight-blocked';
  return Object.freeze([
    expectation({
      kind: 'plan-surface',
      status: planSurfaceReady ? 'satisfied' : 'unsupported',
      reasonCode: planSurfaceReady
        ? 'delegated-eoa-plan-surface-ready'
        : 'delegated-eoa-plan-surface-mismatch',
      evidence: {
        planSurface: input.plan.surface,
        planAdapterKind: input.plan.adapterKind,
        preflightAdapterKind: input.preflight.adapterKind,
        planChainId: input.plan.chainId,
        preflightChainId: input.preflight.chainId,
        planAccountAddress: input.plan.accountAddress,
        preflightAuthorityAddress: input.preflight.authorityAddress,
      },
    }),
    expectation({
      kind: 'adapter-preflight',
      status: adapterPreflightStatus,
      reasonCode: adapterPreflightReason,
      evidence: {
        preflightOutcome: input.preflight.outcome,
        preflightDigest: input.preflight.digest,
        executionPath: input.preflight.executionPath,
      },
    }),
    authorizationExpectation(input),
    authorityNonceExpectation(input),
    delegateCodeExpectation(input),
    accountCodeStateExpectation(input),
    executionPathExpectation(input),
    walletCapabilityExpectation(input.execution),
    initializationExpectation(input),
    sponsorshipExpectation(input.sponsor),
    recoveryExpectation(input.recovery),
    postExecutionExpectation({
      delegationAddress: input.authorization.delegationAddress,
      runtimeObservation: input.runtimeObservation,
    }),
  ]);
}

function blockingReasonsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly expectations: readonly DelegatedEoaAdmissionExpectation[];
}): readonly string[] {
  const reasons: string[] = [];
  if (input.plan.outcome === 'deny') {
    reasons.push('admission-plan-denied');
  }
  input.expectations
    .filter((entry) => entry.status === 'unsupported' || entry.status === 'failed')
    .forEach((entry) => reasons.push(entry.reasonCode));
  return Object.freeze(reasons);
}

function outcomeFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Eip7702DelegationPreflight;
  readonly expectations: readonly DelegatedEoaAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
}): DelegatedEoaAdmissionOutcome {
  if (input.blockingReasons.length > 0) return 'blocked';
  if (input.plan.outcome !== 'admit' || input.preflight.outcome !== 'allow') {
    return 'needs-runtime-evidence';
  }
  if (input.expectations.some((entry) => entry.status === 'missing')) {
    return 'needs-runtime-evidence';
  }
  return 'ready';
}

function nextActionsFor(outcome: DelegatedEoaAdmissionOutcome): readonly string[] {
  switch (outcome) {
    case 'ready':
      return Object.freeze([
        'Proceed through the admitted EIP-7702 delegated EOA path.',
        'Record the post-execution nonce, code-state, and delegation observation against this Attestor handoff.',
      ]);
    case 'needs-runtime-evidence':
      return Object.freeze([
        'Collect the missing authorization tuple, nonce, wallet capability, initialization, sponsorship, or recovery evidence.',
        'Refresh the delegated EOA admission handoff before execution is submitted.',
      ]);
    case 'blocked':
      return Object.freeze([
        'Do not submit this delegated EOA execution path.',
        'Resolve the blocked tuple, nonce, delegate-code, runtime-path, wallet-capability, or recovery reason and create a new handoff.',
      ]);
  }
}

function handoffIdFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: Eip7702DelegationPreflight;
  readonly createdAt: string;
}): string {
  return canonicalObject({
    version: DELEGATED_EOA_ADMISSION_HANDOFF_SPEC_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    createdAt: input.createdAt,
  }).digest;
}

export function createDelegatedEoaAdmissionHandoff(
  input: CreateDelegatedEoaAdmissionHandoffInput,
): DelegatedEoaAdmissionHandoff {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const authorization = normalizeAuthorization(input.authorization);
  const accountState = normalizeAccountState(input.accountState);
  const delegateCode = normalizeDelegateCode(input.delegateCode);
  const execution = normalizeExecution(input.execution);
  const initialization = normalizeInitialization(input.initialization);
  const sponsor = normalizeSponsor(input.sponsor);
  const recovery = normalizeRecovery(input.recovery);
  const runtimeObservation = normalizeRuntimeObservation(input.runtimeObservation);
  const chainId = normalizeCaip2ChainId(input.preflight.chainId, 'preflight.chainId');
  const chainIdHex = chainIdHexFromCaip2(chainId);
  const authorityAddress = normalizeAddress(
    input.preflight.authorityAddress,
    'preflight.authorityAddress',
  );
  const delegationAddress = normalizeAddress(
    input.preflight.delegationAddress,
    'preflight.delegationAddress',
  );
  const authorizationNonce = normalizeDecimalInteger(
    input.preflight.authorizationNonce,
    'preflight.authorizationNonce',
  );
  const target = normalizeAddress(input.preflight.target, 'preflight.target');
  const functionSelector = normalizeSelector(
    input.preflight.functionSelector,
    'preflight.functionSelector',
  );
  const expectations = expectationsFor({
    plan: input.plan,
    preflight: input.preflight,
    authorization,
    accountState,
    delegateCode,
    execution,
    initialization,
    sponsor,
    recovery,
    runtimeObservation,
  });
  const blockingReasons = blockingReasonsFor({
    plan: input.plan,
    expectations,
  });
  const outcome = outcomeFor({
    plan: input.plan,
    preflight: input.preflight,
    expectations,
    blockingReasons,
  });
  const walletCapability = walletCapabilityStatus(execution);
  const handoffId =
    normalizeOptionalIdentifier(input.handoffId, 'handoffId') ??
    handoffIdFor({
      plan: input.plan,
      preflight: input.preflight,
      createdAt,
    });
  const runtimeId = normalizeOptionalIdentifier(input.runtimeId, 'runtimeId');
  const walletProviderId = normalizeOptionalIdentifier(
    input.walletProviderId,
    'walletProviderId',
  );
  const runtimeChecks = runtimeChecksFor(execution.executionPath);
  const walletCapabilitySidecar = walletCapability === null
    ? null
    : Object.freeze({
        required: walletCapability.required,
        observed: walletCapability.observed,
        supported: walletCapability.supported,
        requested: walletCapability.requested,
        atomicRequired: walletCapability.atomicRequired,
      });
  const attestorSidecar = Object.freeze({
    attestorPlanId: input.plan.planId,
    attestorPlanDigest: input.plan.digest,
    attestorPreflightId: input.preflight.preflightId,
    attestorPreflightDigest: input.preflight.digest,
    executionPath: execution.executionPath,
    authorizationTupleHash: authorization.tupleHash ?? null,
    delegateImplementationId: delegateCode.delegateImplementationId,
    walletCapability: walletCapabilitySidecar,
    runtimeId,
    walletProviderId,
  });
  const canonicalPayload = {
    version: DELEGATED_EOA_ADMISSION_HANDOFF_SPEC_VERSION,
    handoffId,
    createdAt,
    outcome,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    authorityAddress,
    delegationAddress,
    chainId,
    chainIdHex,
    authorizationNonce,
    executionPath: execution.executionPath,
    target,
    functionSelector,
    setCodeTransactionType: EIP7702_SET_CODE_TX_TYPE,
    authorizationMagic: EIP7702_AUTHORIZATION_MAGIC,
    delegationIndicatorPrefix: EIP7702_DELEGATION_INDICATOR_PREFIX,
    runtimeId,
    walletProviderId,
    authorization,
    accountState,
    delegateCode,
    execution,
    walletCapability,
    initialization,
    sponsor,
    recovery,
    runtimeChecks,
    runtimeObservation,
    attestorSidecar,
    expectations,
    blockingReasons,
    nextActions: nextActionsFor(outcome),
    operatorNote: normalizeOptionalIdentifier(input.operatorNote, 'operatorNote'),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function delegatedEoaAdmissionHandoffLabel(
  handoff: DelegatedEoaAdmissionHandoff,
): string {
  return [
    `delegated-eoa:${handoff.authorityAddress}`,
    `delegate:${handoff.delegationAddress}`,
    `path:${handoff.executionPath}`,
    `outcome:${handoff.outcome}`,
  ].join(' / ');
}

export function delegatedEoaAdmissionDescriptor(): DelegatedEoaAdmissionDescriptor {
  return Object.freeze({
    version: DELEGATED_EOA_ADMISSION_HANDOFF_SPEC_VERSION,
    outcomes: DELEGATED_EOA_ADMISSION_OUTCOMES,
    expectationKinds: DELEGATED_EOA_ADMISSION_EXPECTATION_KINDS,
    expectationStatuses: DELEGATED_EOA_ADMISSION_EXPECTATION_STATUSES,
    standards: Object.freeze([
      'EIP-7702',
      'EIP-5792',
      'ERC-7902',
      'ERC-4337',
      'ERC-7769',
      'Attestor release layer',
      'Attestor policy control plane',
      'Attestor enforcement plane',
    ]),
    runtimeChecks: Object.freeze([
      'authorizationTuple',
      'authorityNonce',
      'delegateCodePosture',
      'runtimeContextBinding',
      'setCodeTransactionType',
      'walletSendCalls',
      'eip7702Auth',
      'preVerificationGasIncludesAuthorizationCost',
    ]),
  });
}
