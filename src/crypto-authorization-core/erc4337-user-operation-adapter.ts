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
import type { CryptoAccountKind } from './types.js';

/**
 * ERC-4337 UserOperation adapter for account-abstraction execution.
 *
 * Step 15 keeps UserOperation packing and bundler-specific facts outside the
 * crypto object model. The adapter binds Attestor authorization evidence to the
 * EntryPoint, userOpHash, sender, nonce, decoded call intent, ERC-7562 validation
 * scope, and optional factory/paymaster readiness before a bundler can proceed.
 */

export const ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION =
  'attestor.crypto-erc4337-user-operation-adapter.v1';

export const ERC4337_USER_OPERATION_ENTRYPOINT_VERSIONS = [
  'v0.6',
  'v0.7',
  'v0.8',
] as const;
export type Erc4337EntryPointVersion =
  typeof ERC4337_USER_OPERATION_ENTRYPOINT_VERSIONS[number];

export const ERC4337_USER_OPERATION_OUTCOMES = [
  'allow',
  'review-required',
  'block',
] as const;
export type Erc4337UserOperationOutcome =
  typeof ERC4337_USER_OPERATION_OUTCOMES[number];

export const ERC4337_USER_OPERATION_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
] as const;
export type Erc4337UserOperationObservationStatus =
  typeof ERC4337_USER_OPERATION_OBSERVATION_STATUSES[number];

export const ERC4337_USER_OPERATION_VALIDATION_STATUSES = [
  'passed',
  'failed',
  'not-run',
] as const;
export type Erc4337ValidationStatus =
  typeof ERC4337_USER_OPERATION_VALIDATION_STATUSES[number];

export const ERC4337_USER_OPERATION_ENTITY_STATUSES = [
  'not-used',
  'ready',
  'not-ready',
  'failed',
] as const;
export type Erc4337EntityStatus =
  typeof ERC4337_USER_OPERATION_ENTITY_STATUSES[number];

export const ERC4337_USER_OPERATION_SUPPORTED_ACCOUNT_KINDS = [
  'erc-4337-smart-account',
  'erc-7579-modular-account',
  'erc-6900-modular-account',
] as const satisfies readonly CryptoAccountKind[];

export const ERC4337_USER_OPERATION_CHECKS = [
  'erc4337-adapter-kind',
  'erc4337-account-kind-supported',
  'erc4337-sender-matches-intent',
  'erc4337-chain-matches-intent',
  'erc4337-entrypoint-bound',
  'erc4337-userop-hash-bound',
  'erc4337-nonce-matches-intent',
  'erc4337-call-target-bound',
  'erc4337-function-selector-bound',
  'erc4337-calldata-class-bound',
  'erc4337-call-data-present',
  'erc4337-bundler-simulation-passed',
  'erc4337-erc7562-scope-passed',
  'erc4337-account-validation-passed',
  'erc4337-factory-readiness',
  'erc4337-gas-policy-bound',
  'erc4337-prefund-covered',
  'erc4337-paymaster-readiness',
  'erc4337-validation-window-bound',
  'erc4337-release-binding-ready',
  'erc4337-policy-binding-ready',
  'erc4337-enforcement-binding-ready',
] as const;
export type Erc4337UserOperationCheck =
  typeof ERC4337_USER_OPERATION_CHECKS[number];

export interface Erc4337ValidationWindow {
  readonly validAfter?: string | null;
  readonly validUntil?: string | null;
}

export interface Erc4337UserOperation {
  readonly sender: string;
  readonly nonce: string;
  readonly entryPoint: string;
  readonly entryPointVersion: Erc4337EntryPointVersion;
  readonly chainId: string;
  readonly callData: string;
  readonly callTarget?: string | null;
  readonly callValue?: string | null;
  readonly callFunctionSelector?: string | null;
  readonly callDataClass?: string | null;
  readonly callCount?: number | null;
  readonly factory?: string | null;
  readonly factoryData?: string | null;
  readonly callGasLimit: string;
  readonly verificationGasLimit: string;
  readonly preVerificationGas: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
  readonly paymaster?: string | null;
  readonly paymasterVerificationGasLimit?: string | null;
  readonly paymasterPostOpGasLimit?: string | null;
  readonly paymasterData?: string | null;
  readonly signature: string;
  readonly userOpHash: string;
}

export interface Erc4337BundlerValidation {
  readonly validatedAt: string;
  readonly bundlerId: string;
  readonly entryPointSupported: boolean;
  readonly simulateValidationStatus: Erc4337ValidationStatus;
  readonly erc7562ValidationStatus: Erc4337ValidationStatus;
  readonly accountValidationStatus: Erc4337ValidationStatus;
  readonly signatureValidationStatus: Erc4337ValidationStatus;
  readonly nonceValidationStatus: Erc4337ValidationStatus;
  readonly senderAlreadyDeployed?: boolean | null;
  readonly factoryStatus?: Erc4337EntityStatus | null;
  readonly paymasterStatus?: Erc4337EntityStatus | null;
  readonly paymasterStakeReady?: boolean | null;
  readonly paymasterDepositReady?: boolean | null;
  readonly prefundCovered: boolean;
  readonly gasLimitsWithinPolicy: boolean;
  readonly bannedOpcodeDetected?: boolean | null;
  readonly storageAccessViolation?: boolean | null;
  readonly unstakedEntityAccessDetected?: boolean | null;
  readonly aggregatorAddress?: string | null;
  readonly accountValidation?: Erc4337ValidationWindow | null;
  readonly paymasterValidation?: Erc4337ValidationWindow | null;
}

export interface Erc4337UserOperationObservation {
  readonly check: Erc4337UserOperationCheck;
  readonly status: Erc4337UserOperationObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateErc4337UserOperationPreflightInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly userOperation: Erc4337UserOperation;
  readonly bundlerValidation: Erc4337BundlerValidation;
  readonly preflightId?: string | null;
}

export interface Erc4337UserOperationPreflight {
  readonly version: typeof ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION;
  readonly preflightId: string;
  readonly adapterKind: 'erc-4337-user-operation';
  readonly checkedAt: string;
  readonly bundlerId: string;
  readonly entryPoint: string;
  readonly entryPointVersion: Erc4337EntryPointVersion;
  readonly sender: string;
  readonly userOpHash: string;
  readonly nonce: string;
  readonly chainId: string;
  readonly callTarget: string | null;
  readonly callFunctionSelector: string | null;
  readonly callDataClass: string | null;
  readonly paymaster: string | null;
  readonly factory: string | null;
  readonly outcome: Erc4337UserOperationOutcome;
  readonly signals: readonly CryptoSimulationPreflightSignal[];
  readonly observations: readonly Erc4337UserOperationObservation[];
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface Erc4337UserOperationSimulationResult {
  readonly preflight: Erc4337UserOperationPreflight;
  readonly simulation: CryptoAuthorizationSimulationResult;
}

export interface Erc4337UserOperationAdapterDescriptor {
  readonly version: typeof ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION;
  readonly entryPointVersions: typeof ERC4337_USER_OPERATION_ENTRYPOINT_VERSIONS;
  readonly outcomes: typeof ERC4337_USER_OPERATION_OUTCOMES;
  readonly validationStatuses: typeof ERC4337_USER_OPERATION_VALIDATION_STATUSES;
  readonly entityStatuses: typeof ERC4337_USER_OPERATION_ENTITY_STATUSES;
  readonly supportedAccountKinds: typeof ERC4337_USER_OPERATION_SUPPORTED_ACCOUNT_KINDS;
  readonly checks: typeof ERC4337_USER_OPERATION_CHECKS;
  readonly standards: readonly string[];
}

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';
const EIP_7702_FACTORY_MARKER = '0x7702';

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`ERC-4337 UserOperation adapter ${fieldName} requires a non-empty value.`);
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
    throw new Error(`ERC-4337 UserOperation adapter ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalIsoTimestamp(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeIsoTimestamp(value, fieldName);
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`ERC-4337 UserOperation adapter ${fieldName} must be an EVM address.`);
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

function normalizeFactory(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = normalizeIdentifier(value, 'userOperation.factory').toLowerCase();
  if (normalized === EIP_7702_FACTORY_MARKER) {
    return normalized;
  }
  return normalizeAddress(normalized, 'userOperation.factory');
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`ERC-4337 UserOperation adapter ${fieldName} must be a 32-byte hex value.`);
  }
  return normalized.toLowerCase();
}

function normalizeHexData(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(normalized)) {
    throw new Error(`ERC-4337 UserOperation adapter ${fieldName} must be hex bytes.`);
  }
  return normalized.toLowerCase();
}

function normalizeOptionalHexData(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeHexData(value, fieldName);
}

function normalizeUintString(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`ERC-4337 UserOperation adapter ${fieldName} must be a non-negative integer string.`);
  }
  return normalized;
}

function normalizeOptionalUintString(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeUintString(value, fieldName);
}

function normalizePositiveUintString(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeUintString(value, fieldName);
  if (BigInt(normalized) <= 0n) {
    throw new Error(`ERC-4337 UserOperation adapter ${fieldName} must be a positive integer string.`);
  }
  return normalized;
}

function normalizeOptionalCallCount(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('ERC-4337 UserOperation adapter userOperation.callCount must be a positive integer.');
  }
  return value;
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

function sameAddress(left: string, right: string | null | undefined): boolean {
  if (!right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
}

function statusFrom(input: Erc4337ValidationStatus): Erc4337ValidationStatus {
  if (!ERC4337_USER_OPERATION_VALIDATION_STATUSES.includes(input)) {
    throw new Error(`ERC-4337 UserOperation adapter does not support validation status ${input}.`);
  }
  return input;
}

function entityStatusFrom(
  input: Erc4337EntityStatus | null | undefined,
  fallback: Erc4337EntityStatus,
): Erc4337EntityStatus {
  if (input === undefined || input === null) {
    return fallback;
  }
  if (!ERC4337_USER_OPERATION_ENTITY_STATUSES.includes(input)) {
    throw new Error(`ERC-4337 UserOperation adapter does not support entity status ${input}.`);
  }
  return input;
}

function entryPointVersionFrom(input: Erc4337EntryPointVersion): Erc4337EntryPointVersion {
  if (!ERC4337_USER_OPERATION_ENTRYPOINT_VERSIONS.includes(input)) {
    throw new Error(`ERC-4337 UserOperation adapter does not support EntryPoint version ${input}.`);
  }
  return input;
}

function nonceMatches(intentNonce: string, userOperationNonce: string): boolean {
  return (
    intentNonce === userOperationNonce ||
    intentNonce === `userop:${userOperationNonce}` ||
    intentNonce === `user-operation:${userOperationNonce}` ||
    intentNonce === `entrypoint:nonce:${userOperationNonce}` ||
    intentNonce.endsWith(`:${userOperationNonce}`)
  );
}

function compareUintStrings(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
}

function normalizeValidationWindow(
  value: Erc4337ValidationWindow | null | undefined,
  fieldName: string,
): Erc4337ValidationWindow | null {
  if (value === undefined || value === null) {
    return null;
  }
  return Object.freeze({
    validAfter: normalizeOptionalIsoTimestamp(value.validAfter, `${fieldName}.validAfter`),
    validUntil: normalizeOptionalIsoTimestamp(value.validUntil, `${fieldName}.validUntil`),
  });
}

function timestampMillis(value: string): number {
  return new Date(value).getTime();
}

function validationWindowInsideIntent(input: {
  readonly window: Erc4337ValidationWindow | null;
  readonly intent: CryptoAuthorizationIntent;
}): boolean {
  const validAfter = input.window?.validAfter ?? null;
  const validUntil = input.window?.validUntil ?? null;
  if (validAfter === null || validUntil === null) {
    return false;
  }
  return (
    timestampMillis(validAfter) >= timestampMillis(input.intent.constraints.validAfter) &&
    timestampMillis(validUntil) <= timestampMillis(input.intent.constraints.validUntil)
  );
}

function validationWindowEvidence(
  window: Erc4337ValidationWindow | null | undefined,
): CanonicalReleaseJsonValue {
  if (window === undefined || window === null) {
    return null;
  }
  return Object.freeze({
    validAfter: window.validAfter ?? null,
    validUntil: window.validUntil ?? null,
  });
}

function isSupportedErc4337AccountKind(accountKind: CryptoAccountKind): boolean {
  return (ERC4337_USER_OPERATION_SUPPORTED_ACCOUNT_KINDS as readonly CryptoAccountKind[]).includes(
    accountKind,
  );
}

function observation(input: {
  readonly check: Erc4337UserOperationCheck;
  readonly status: Erc4337UserOperationObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): Erc4337UserOperationObservation {
  return Object.freeze({
    check: input.check,
    status: input.status,
    code: normalizeIdentifier(input.code, 'observation.code'),
    message: normalizeIdentifier(input.message, 'observation.message'),
    required: input.required ?? true,
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function normalizedUserOperation(input: Erc4337UserOperation): Erc4337UserOperation {
  return Object.freeze({
    sender: normalizeAddress(input.sender, 'userOperation.sender'),
    nonce: normalizeUintString(input.nonce, 'userOperation.nonce'),
    entryPoint: normalizeAddress(input.entryPoint, 'userOperation.entryPoint'),
    entryPointVersion: entryPointVersionFrom(input.entryPointVersion),
    chainId: normalizeIdentifier(input.chainId, 'userOperation.chainId'),
    callData: normalizeHexData(input.callData, 'userOperation.callData'),
    callTarget: normalizeOptionalAddress(input.callTarget, 'userOperation.callTarget'),
    callValue: normalizeOptionalUintString(input.callValue, 'userOperation.callValue'),
    callFunctionSelector: normalizeOptionalIdentifier(
      input.callFunctionSelector?.toLowerCase(),
      'userOperation.callFunctionSelector',
    ),
    callDataClass: normalizeOptionalIdentifier(input.callDataClass, 'userOperation.callDataClass'),
    callCount: normalizeOptionalCallCount(input.callCount),
    factory: normalizeFactory(input.factory),
    factoryData: normalizeOptionalHexData(input.factoryData, 'userOperation.factoryData'),
    callGasLimit: normalizePositiveUintString(input.callGasLimit, 'userOperation.callGasLimit'),
    verificationGasLimit: normalizePositiveUintString(
      input.verificationGasLimit,
      'userOperation.verificationGasLimit',
    ),
    preVerificationGas: normalizePositiveUintString(
      input.preVerificationGas,
      'userOperation.preVerificationGas',
    ),
    maxFeePerGas: normalizePositiveUintString(input.maxFeePerGas, 'userOperation.maxFeePerGas'),
    maxPriorityFeePerGas: normalizeUintString(
      input.maxPriorityFeePerGas,
      'userOperation.maxPriorityFeePerGas',
    ),
    paymaster: normalizeOptionalAddress(input.paymaster, 'userOperation.paymaster'),
    paymasterVerificationGasLimit: normalizeOptionalUintString(
      input.paymasterVerificationGasLimit,
      'userOperation.paymasterVerificationGasLimit',
    ),
    paymasterPostOpGasLimit: normalizeOptionalUintString(
      input.paymasterPostOpGasLimit,
      'userOperation.paymasterPostOpGasLimit',
    ),
    paymasterData: normalizeOptionalHexData(input.paymasterData, 'userOperation.paymasterData'),
    signature: normalizeHexData(input.signature, 'userOperation.signature'),
    userOpHash: normalizeHash(input.userOpHash, 'userOperation.userOpHash'),
  });
}

function normalizedBundlerValidation(
  input: Erc4337BundlerValidation,
  userOperation: Erc4337UserOperation,
): Erc4337BundlerValidation {
  const paymasterUsed = userOperation.paymaster !== null;
  const factoryUsed =
    userOperation.factory !== null || input.senderAlreadyDeployed === false;
  return Object.freeze({
    validatedAt: normalizeIsoTimestamp(input.validatedAt, 'bundlerValidation.validatedAt'),
    bundlerId: normalizeIdentifier(input.bundlerId, 'bundlerValidation.bundlerId'),
    entryPointSupported: input.entryPointSupported,
    simulateValidationStatus: statusFrom(input.simulateValidationStatus),
    erc7562ValidationStatus: statusFrom(input.erc7562ValidationStatus),
    accountValidationStatus: statusFrom(input.accountValidationStatus),
    signatureValidationStatus: statusFrom(input.signatureValidationStatus),
    nonceValidationStatus: statusFrom(input.nonceValidationStatus),
    senderAlreadyDeployed: input.senderAlreadyDeployed ?? null,
    factoryStatus: entityStatusFrom(
      input.factoryStatus,
      factoryUsed ? 'not-ready' : 'not-used',
    ),
    paymasterStatus: entityStatusFrom(
      input.paymasterStatus,
      paymasterUsed ? 'not-ready' : 'not-used',
    ),
    paymasterStakeReady: input.paymasterStakeReady ?? null,
    paymasterDepositReady: input.paymasterDepositReady ?? null,
    prefundCovered: input.prefundCovered,
    gasLimitsWithinPolicy: input.gasLimitsWithinPolicy,
    bannedOpcodeDetected: input.bannedOpcodeDetected ?? false,
    storageAccessViolation: input.storageAccessViolation ?? false,
    unstakedEntityAccessDetected: input.unstakedEntityAccessDetected ?? false,
    aggregatorAddress: normalizeOptionalAddress(
      input.aggregatorAddress,
      'bundlerValidation.aggregatorAddress',
    ),
    accountValidation: normalizeValidationWindow(
      input.accountValidation,
      'bundlerValidation.accountValidation',
    ),
    paymasterValidation: normalizeValidationWindow(
      input.paymasterValidation,
      'bundlerValidation.paymasterValidation',
    ),
  });
}

function assertAdapterConsistency(input: CreateErc4337UserOperationPreflightInput): void {
  if (input.intent.executionAdapterKind !== 'erc-4337-user-operation') {
    throw new Error('ERC-4337 UserOperation adapter requires intent.executionAdapterKind erc-4337-user-operation.');
  }
  if (input.riskAssessment.consequenceKind !== input.intent.consequenceKind) {
    throw new Error('ERC-4337 UserOperation adapter risk consequence does not match intent.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.policyScopeBinding.cryptoDecisionId) {
    throw new Error('ERC-4337 UserOperation adapter policy binding does not match release binding.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.enforcementBinding.cryptoDecisionId) {
    throw new Error('ERC-4337 UserOperation adapter enforcement binding does not match release binding.');
  }
  if (input.enforcementBinding.adapterKind !== 'erc-4337-user-operation') {
    throw new Error('ERC-4337 UserOperation adapter requires erc-4337-user-operation enforcement binding.');
  }
  if (input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind !== 'action-dispatch') {
    throw new Error('ERC-4337 UserOperation adapter requires action-dispatch enforcement.');
  }
  if (!input.enforcementBinding.verificationProfile.failClosed) {
    throw new Error('ERC-4337 UserOperation adapter requires fail-closed enforcement verification.');
  }
}

function buildObservations(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly userOperation: Erc4337UserOperation;
  readonly bundlerValidation: Erc4337BundlerValidation;
}): readonly Erc4337UserOperationObservation[] {
  const observations: Erc4337UserOperationObservation[] = [];
  const chainId = caip2ChainId(input.intent);
  const targetAddress = input.intent.target.address ?? null;
  const requiredSelector = input.intent.target.functionSelector?.toLowerCase() ?? null;
  const requiredCalldataClass = input.intent.target.calldataClass ?? null;
  const userOperation = input.userOperation;
  const validation = input.bundlerValidation;
  const accountValidationWindowReady = validationWindowInsideIntent({
    window: validation.accountValidation ?? null,
    intent: input.intent,
  });
  const paymasterUsed = userOperation.paymaster !== null;
  const paymasterValidationWindowReady = !paymasterUsed || validationWindowInsideIntent({
    window: validation.paymasterValidation ?? null,
    intent: input.intent,
  });
  const factoryUsed =
    userOperation.factory !== null || validation.senderAlreadyDeployed === false;
  const paymasterVerificationGasLimit = userOperation.paymasterVerificationGasLimit ?? null;
  const paymasterPostOpGasLimit = userOperation.paymasterPostOpGasLimit ?? null;
  const factoryReady =
    !factoryUsed ||
    (userOperation.factory !== null &&
      userOperation.factoryData !== null &&
      userOperation.factoryData !== '0x' &&
      validation.factoryStatus === 'ready');
  const paymasterGasReady =
    !paymasterUsed ||
    (paymasterVerificationGasLimit !== null &&
      paymasterPostOpGasLimit !== null &&
      BigInt(paymasterVerificationGasLimit) > 0n &&
      BigInt(paymasterPostOpGasLimit) > 0n);
  const paymasterReady =
    !paymasterUsed ||
    (validation.paymasterStatus === 'ready' &&
      validation.paymasterStakeReady === true &&
      validation.paymasterDepositReady === true &&
      paymasterGasReady &&
      paymasterValidationWindowReady);
  const gasPolicyReady =
    validation.gasLimitsWithinPolicy &&
    compareUintStrings(userOperation.maxPriorityFeePerGas, userOperation.maxFeePerGas) <= 0;
  const erc7562Ready =
    validation.erc7562ValidationStatus === 'passed' &&
    validation.bannedOpcodeDetected !== true &&
    validation.storageAccessViolation !== true &&
    validation.unstakedEntityAccessDetected !== true;

  observations.push(
    observation({
      check: 'erc4337-adapter-kind',
      status: 'pass',
      code: 'erc4337-user-operation-adapter',
      message: 'Intent, release binding, and enforcement binding use the ERC-4337 UserOperation adapter.',
      evidence: {
        adapterKind: input.intent.executionAdapterKind,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-account-kind-supported',
      status: isSupportedErc4337AccountKind(input.intent.account.accountKind)
        ? 'pass'
        : 'fail',
      code: isSupportedErc4337AccountKind(input.intent.account.accountKind)
        ? 'erc4337-account-kind-supported'
        : 'erc4337-account-kind-unsupported',
      message: isSupportedErc4337AccountKind(input.intent.account.accountKind)
        ? 'Smart-account kind is supported for ERC-4337 UserOperation execution.'
        : 'Account kind is not supported by the ERC-4337 UserOperation adapter.',
      evidence: {
        accountKind: input.intent.account.accountKind,
        supportedKinds: [...ERC4337_USER_OPERATION_SUPPORTED_ACCOUNT_KINDS],
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-sender-matches-intent',
      status: sameAddress(userOperation.sender, input.intent.account.address) ? 'pass' : 'fail',
      code: sameAddress(userOperation.sender, input.intent.account.address)
        ? 'erc4337-sender-bound'
        : 'erc4337-sender-mismatch',
      message: sameAddress(userOperation.sender, input.intent.account.address)
        ? 'UserOperation sender matches the crypto authorization account.'
        : 'UserOperation sender does not match the crypto authorization account.',
      evidence: {
        sender: userOperation.sender,
        intentAccount: input.intent.account.address,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-chain-matches-intent',
      status: userOperation.chainId === chainId ? 'pass' : 'fail',
      code: userOperation.chainId === chainId
        ? 'erc4337-chain-bound'
        : 'erc4337-chain-mismatch',
      message: userOperation.chainId === chainId
        ? 'UserOperation chain matches the crypto authorization intent.'
        : 'UserOperation chain does not match the crypto authorization intent.',
      evidence: {
        userOperationChainId: userOperation.chainId,
        intentChainId: chainId,
      },
    }),
  );

  const entryPointReady =
    userOperation.entryPoint !== ZERO_EVM_ADDRESS && validation.entryPointSupported;
  observations.push(
    observation({
      check: 'erc4337-entrypoint-bound',
      status: entryPointReady ? 'pass' : 'fail',
      code: entryPointReady
        ? 'erc4337-entrypoint-supported'
        : 'erc4337-entrypoint-not-supported',
      message: entryPointReady
        ? 'EntryPoint address and version are supported by bundler validation.'
        : 'EntryPoint is missing, zero, or not supported by bundler validation.',
      evidence: {
        entryPoint: userOperation.entryPoint,
        entryPointVersion: userOperation.entryPointVersion,
        entryPointSupported: validation.entryPointSupported,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-userop-hash-bound',
      status: 'pass',
      code: 'erc4337-userop-hash-bound',
      message: 'UserOperation hash is present and bound into adapter evidence.',
      evidence: {
        userOpHash: userOperation.userOpHash,
        entryPoint: userOperation.entryPoint,
        chainId: userOperation.chainId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-nonce-matches-intent',
      status: nonceMatches(input.intent.constraints.nonce, userOperation.nonce)
        ? 'pass'
        : 'fail',
      code: nonceMatches(input.intent.constraints.nonce, userOperation.nonce)
        ? 'erc4337-nonce-bound'
        : 'erc4337-nonce-mismatch',
      message: nonceMatches(input.intent.constraints.nonce, userOperation.nonce)
        ? 'UserOperation nonce matches the crypto authorization replay constraint.'
        : 'UserOperation nonce does not match the crypto authorization replay constraint.',
      evidence: {
        userOperationNonce: userOperation.nonce,
        intentNonce: input.intent.constraints.nonce,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-call-target-bound',
      status: targetAddress === null
        ? 'warn'
        : sameAddress(userOperation.callTarget ?? '', targetAddress)
          ? 'pass'
          : 'fail',
      code: targetAddress === null
        ? 'erc4337-call-target-not-required'
        : sameAddress(userOperation.callTarget ?? '', targetAddress)
          ? 'erc4337-call-target-bound'
          : 'erc4337-call-target-mismatch',
      message: targetAddress === null
        ? 'Crypto authorization intent does not require a decoded UserOperation call target.'
        : sameAddress(userOperation.callTarget ?? '', targetAddress)
          ? 'Decoded UserOperation call target matches the crypto authorization intent.'
          : 'Decoded UserOperation call target does not match the crypto authorization intent.',
      evidence: {
        callTarget: userOperation.callTarget ?? null,
        intentTargetAddress: targetAddress,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-function-selector-bound',
      status: requiredSelector === null
        ? 'pass'
        : userOperation.callFunctionSelector === requiredSelector
          ? 'pass'
          : 'fail',
      code: requiredSelector === null
        ? 'erc4337-function-selector-not-required'
        : userOperation.callFunctionSelector === requiredSelector
          ? 'erc4337-function-selector-bound'
          : 'erc4337-function-selector-mismatch',
      message: requiredSelector === null
        ? 'Crypto authorization intent does not require a decoded function selector.'
        : userOperation.callFunctionSelector === requiredSelector
          ? 'Decoded UserOperation function selector matches the crypto authorization intent.'
          : 'Decoded UserOperation function selector does not match the crypto authorization intent.',
      evidence: {
        callFunctionSelector: userOperation.callFunctionSelector ?? null,
        intentFunctionSelector: requiredSelector,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-calldata-class-bound',
      status: requiredCalldataClass === null
        ? 'pass'
        : userOperation.callDataClass === requiredCalldataClass
          ? 'pass'
          : 'fail',
      code: requiredCalldataClass === null
        ? 'erc4337-calldata-class-not-required'
        : userOperation.callDataClass === requiredCalldataClass
          ? 'erc4337-calldata-class-bound'
          : 'erc4337-calldata-class-mismatch',
      message: requiredCalldataClass === null
        ? 'Crypto authorization intent does not require a calldata class.'
        : userOperation.callDataClass === requiredCalldataClass
          ? 'Decoded UserOperation calldata class matches the crypto authorization intent.'
          : 'Decoded UserOperation calldata class does not match the crypto authorization intent.',
      evidence: {
        callDataClass: userOperation.callDataClass ?? null,
        intentCalldataClass: requiredCalldataClass,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-call-data-present',
      status: userOperation.callData === '0x' || userOperation.signature === '0x'
        ? 'fail'
        : 'pass',
      code: userOperation.callData === '0x'
        ? 'erc4337-call-data-empty'
        : userOperation.signature === '0x'
          ? 'erc4337-signature-empty'
          : 'erc4337-call-data-and-signature-present',
      message: userOperation.callData === '0x' || userOperation.signature === '0x'
        ? 'UserOperation calldata and signature must be non-empty before bundler submission.'
        : 'UserOperation calldata and signature are present.',
      evidence: {
        callDataLength: userOperation.callData.length,
        signatureLength: userOperation.signature.length,
        callCount: userOperation.callCount ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-bundler-simulation-passed',
      status: validation.simulateValidationStatus === 'passed' ? 'pass' : 'fail',
      code: validation.simulateValidationStatus === 'passed'
        ? 'erc4337-simulate-validation-passed'
        : 'erc4337-simulate-validation-failed',
      message: validation.simulateValidationStatus === 'passed'
        ? 'Bundler simulateValidation accepted the UserOperation.'
        : 'Bundler simulateValidation did not pass and the UserOperation must fail closed.',
      evidence: {
        bundlerId: validation.bundlerId,
        simulateValidationStatus: validation.simulateValidationStatus,
        validatedAt: validation.validatedAt,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-erc7562-scope-passed',
      status: erc7562Ready ? 'pass' : 'fail',
      code: validation.erc7562ValidationStatus !== 'passed'
        ? 'erc4337-erc7562-validation-failed'
        : validation.bannedOpcodeDetected === true
          ? 'erc4337-erc7562-banned-opcode'
          : validation.storageAccessViolation === true
            ? 'erc4337-erc7562-storage-access-violation'
            : validation.unstakedEntityAccessDetected === true
              ? 'erc4337-erc7562-unstaked-entity-access'
              : 'erc4337-erc7562-validation-passed',
      message: erc7562Ready
        ? 'ERC-7562 validation-scope evidence passed without forbidden validation behavior.'
        : 'ERC-7562 validation-scope evidence failed or detected forbidden validation behavior.',
      evidence: {
        erc7562ValidationStatus: validation.erc7562ValidationStatus,
        bannedOpcodeDetected: validation.bannedOpcodeDetected ?? false,
        storageAccessViolation: validation.storageAccessViolation ?? false,
        unstakedEntityAccessDetected: validation.unstakedEntityAccessDetected ?? false,
      },
    }),
  );

  const accountValidationReady =
    validation.accountValidationStatus === 'passed' &&
    validation.signatureValidationStatus === 'passed' &&
    validation.nonceValidationStatus === 'passed';
  observations.push(
    observation({
      check: 'erc4337-account-validation-passed',
      status: accountValidationReady ? 'pass' : 'fail',
      code: validation.accountValidationStatus !== 'passed'
        ? 'erc4337-account-validation-failed'
        : validation.signatureValidationStatus !== 'passed'
          ? 'erc4337-signature-validation-failed'
          : validation.nonceValidationStatus !== 'passed'
            ? 'erc4337-nonce-validation-failed'
            : 'erc4337-account-validation-passed',
      message: accountValidationReady
        ? 'Account, signature, and EntryPoint nonce validation passed.'
        : 'Account, signature, or EntryPoint nonce validation did not pass.',
      evidence: {
        accountValidationStatus: validation.accountValidationStatus,
        signatureValidationStatus: validation.signatureValidationStatus,
        nonceValidationStatus: validation.nonceValidationStatus,
        aggregatorAddress: validation.aggregatorAddress ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-factory-readiness',
      status: factoryReady ? 'pass' : 'fail',
      code: !factoryUsed
        ? 'erc4337-factory-not-used'
        : factoryReady
          ? 'erc4337-factory-ready'
          : 'erc4337-factory-not-ready',
      message: !factoryUsed
        ? 'Sender account is already deployed and no factory path is required.'
        : factoryReady
          ? 'Factory deployment path is present and bundler validation marked it ready.'
          : 'Undeployed sender or factory path is missing factory readiness evidence.',
      evidence: {
        senderAlreadyDeployed: validation.senderAlreadyDeployed ?? null,
        factory: userOperation.factory ?? null,
        factoryDataLength: userOperation.factoryData?.length ?? null,
        factoryStatus: validation.factoryStatus ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-gas-policy-bound',
      status: gasPolicyReady ? 'pass' : 'fail',
      code: !validation.gasLimitsWithinPolicy
        ? 'erc4337-gas-limits-outside-policy'
        : compareUintStrings(userOperation.maxPriorityFeePerGas, userOperation.maxFeePerGas) > 0
          ? 'erc4337-priority-fee-exceeds-max-fee'
          : 'erc4337-gas-policy-bound',
      message: gasPolicyReady
        ? 'UserOperation gas limits and EIP-1559 fee caps are inside policy.'
        : 'UserOperation gas limits or fee caps are outside policy.',
      evidence: {
        callGasLimit: userOperation.callGasLimit,
        verificationGasLimit: userOperation.verificationGasLimit,
        preVerificationGas: userOperation.preVerificationGas,
        maxFeePerGas: userOperation.maxFeePerGas,
        maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas,
        gasLimitsWithinPolicy: validation.gasLimitsWithinPolicy,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-prefund-covered',
      status: validation.prefundCovered ? 'pass' : 'fail',
      code: validation.prefundCovered ? 'erc4337-prefund-covered' : 'erc4337-prefund-missing',
      message: validation.prefundCovered
        ? 'Account or paymaster prefund covers maximum validation and execution cost.'
        : 'Account or paymaster prefund does not cover the UserOperation cost envelope.',
      evidence: {
        prefundCovered: validation.prefundCovered,
        paymaster: userOperation.paymaster ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-paymaster-readiness',
      status: paymasterReady ? 'pass' : 'fail',
      code: !paymasterUsed
        ? 'erc4337-paymaster-not-used'
        : validation.paymasterStatus !== 'ready'
          ? 'erc4337-paymaster-not-ready'
          : validation.paymasterStakeReady !== true
            ? 'erc4337-paymaster-stake-not-ready'
            : validation.paymasterDepositReady !== true
              ? 'erc4337-paymaster-deposit-not-ready'
              : !paymasterGasReady
                ? 'erc4337-paymaster-gas-missing'
                : !paymasterValidationWindowReady
                  ? 'erc4337-paymaster-validation-window-outside-intent'
                  : 'erc4337-paymaster-ready',
      message: !paymasterUsed
        ? 'UserOperation does not use a paymaster.'
        : paymasterReady
          ? 'Paymaster stake, deposit, validation window, and postOp gas evidence are ready.'
          : 'Paymaster readiness evidence is missing or failed.',
      evidence: {
        paymaster: userOperation.paymaster ?? null,
        paymasterStatus: validation.paymasterStatus ?? null,
        paymasterStakeReady: validation.paymasterStakeReady ?? null,
        paymasterDepositReady: validation.paymasterDepositReady ?? null,
        paymasterVerificationGasLimit: userOperation.paymasterVerificationGasLimit ?? null,
        paymasterPostOpGasLimit: userOperation.paymasterPostOpGasLimit ?? null,
      },
    }),
  );

  const validationWindowReady = accountValidationWindowReady && paymasterValidationWindowReady;
  observations.push(
    observation({
      check: 'erc4337-validation-window-bound',
      status: validationWindowReady ? 'pass' : 'fail',
      code: !accountValidationWindowReady
        ? 'erc4337-account-validation-window-outside-intent'
        : !paymasterValidationWindowReady
          ? 'erc4337-paymaster-validation-window-outside-intent'
          : 'erc4337-validation-window-bound',
      message: validationWindowReady
        ? 'Account and paymaster validation windows are inside the Attestor authorization window.'
        : 'Validation window evidence is missing or wider than the Attestor authorization window.',
      evidence: {
        intentValidAfter: input.intent.constraints.validAfter,
        intentValidUntil: input.intent.constraints.validUntil,
        accountValidation: validationWindowEvidence(validation.accountValidation),
        paymasterValidation: validationWindowEvidence(validation.paymasterValidation),
      },
    }),
  );

  const releaseReady =
    input.releaseBinding.status === 'bound' &&
    (input.releaseBinding.releaseDecision.status === 'accepted' ||
      input.releaseBinding.releaseDecision.status === 'overridden');
  observations.push(
    observation({
      check: 'erc4337-release-binding-ready',
      status: releaseReady ? 'pass' : 'fail',
      code: releaseReady
        ? 'erc4337-release-binding-ready'
        : 'erc4337-release-binding-not-executable',
      message: releaseReady
        ? 'Release binding is executable for UserOperation dispatch.'
        : 'Release binding is not executable and UserOperation dispatch must fail closed.',
      evidence: {
        bindingStatus: input.releaseBinding.status,
        releaseStatus: input.releaseBinding.releaseDecision.status,
        releaseDecisionId: input.releaseBinding.releaseDecisionId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'erc4337-policy-binding-ready',
      status: input.policyScopeBinding.activationRecord.state === 'active' ? 'pass' : 'fail',
      code: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'erc4337-policy-binding-active'
        : 'erc4337-policy-binding-not-active',
      message: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'Policy-control-plane binding is active for UserOperation dispatch.'
        : 'Policy-control-plane binding is not active.',
      evidence: {
        activationId: input.policyScopeBinding.activationId,
        activationState: input.policyScopeBinding.activationRecord.state,
      },
    }),
  );

  const enforcementReady =
    input.enforcementBinding.adapterKind === 'erc-4337-user-operation' &&
    input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind === 'action-dispatch' &&
    input.enforcementBinding.verificationProfile.failClosed;
  observations.push(
    observation({
      check: 'erc4337-enforcement-binding-ready',
      status: enforcementReady ? 'pass' : 'fail',
      code: enforcementReady
        ? 'erc4337-enforcement-binding-ready'
        : 'erc4337-enforcement-binding-not-ready',
      message: enforcementReady
        ? 'Enforcement binding is fail-closed and action-dispatch scoped for UserOperation dispatch.'
        : 'Enforcement binding is not ERC-4337 action-dispatch ready.',
      evidence: {
        adapterKind: input.enforcementBinding.adapterKind,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
        profileId: input.enforcementBinding.verificationProfile.id,
      },
    }),
  );

  return Object.freeze(observations);
}

function outcomeFromObservations(
  observations: readonly Erc4337UserOperationObservation[],
): Erc4337UserOperationOutcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'block';
  }
  if (observations.some((entry) => entry.required && entry.status === 'warn')) {
    return 'review-required';
  }
  return 'allow';
}

function signalStatusFor(
  outcome: Erc4337UserOperationOutcome,
): CryptoSimulationPreflightSignal['status'] {
  switch (outcome) {
    case 'allow':
      return 'pass';
    case 'review-required':
      return 'warn';
    case 'block':
      return 'fail';
  }
}

function failingReasonCodes(
  observations: readonly Erc4337UserOperationObservation[],
): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.code),
  );
}

function signalCodeFor(
  source: 'erc-4337-validation' | 'erc-7562-validation-scope',
  outcome: Erc4337UserOperationOutcome,
): string {
  const prefix = source === 'erc-4337-validation'
    ? 'erc4337-user-operation'
    : 'erc7562-validation-scope';
  switch (outcome) {
    case 'allow':
      return `${prefix}-preflight-pass`;
    case 'review-required':
      return `${prefix}-preflight-review-required`;
    case 'block':
      return `${prefix}-preflight-block`;
  }
}

function signalMessageFor(
  source: 'erc-4337-validation' | 'erc-7562-validation-scope',
  outcome: Erc4337UserOperationOutcome,
): string {
  const surface = source === 'erc-4337-validation'
    ? 'ERC-4337 UserOperation validation'
    : 'ERC-7562 validation-scope evidence';
  switch (outcome) {
    case 'allow':
      return `${surface} accepted the Attestor-bound UserOperation preflight.`;
    case 'review-required':
      return `${surface} needs additional evidence before UserOperation submission.`;
    case 'block':
      return `${surface} would block the UserOperation fail-closed.`;
  }
}

function preflightIdFor(input: {
  readonly userOperation: Erc4337UserOperation;
  readonly bundlerValidation: Erc4337BundlerValidation;
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
}): string {
  return canonicalObject({
    version: ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION,
    validatedAt: input.bundlerValidation.validatedAt,
    bundlerId: input.bundlerValidation.bundlerId,
    entryPoint: input.userOperation.entryPoint,
    sender: input.userOperation.sender,
    nonce: input.userOperation.nonce,
    userOpHash: input.userOperation.userOpHash,
    releaseBindingDigest: input.releaseBindingDigest,
    policyScopeDigest: input.policyScopeDigest,
    enforcementBindingDigest: input.enforcementBindingDigest,
  }).digest;
}

function signalsFor(input: {
  readonly outcome: Erc4337UserOperationOutcome;
  readonly preflightId: string;
  readonly userOperation: Erc4337UserOperation;
  readonly bundlerValidation: Erc4337BundlerValidation;
  readonly observations: readonly Erc4337UserOperationObservation[];
}): readonly CryptoSimulationPreflightSignal[] {
  const status = signalStatusFor(input.outcome);
  const baseEvidence = Object.freeze({
    adapterVersion: ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION,
    preflightId: input.preflightId,
    outcome: input.outcome,
    bundlerId: input.bundlerValidation.bundlerId,
    validatedAt: input.bundlerValidation.validatedAt,
    entryPoint: input.userOperation.entryPoint,
    entryPointVersion: input.userOperation.entryPointVersion,
    sender: input.userOperation.sender,
    nonce: input.userOperation.nonce,
    userOpHash: input.userOperation.userOpHash,
    chainId: input.userOperation.chainId,
    callTarget: input.userOperation.callTarget ?? null,
    callFunctionSelector: input.userOperation.callFunctionSelector ?? null,
    paymaster: input.userOperation.paymaster ?? null,
    factory: input.userOperation.factory ?? null,
    reasonCodes: failingReasonCodes(input.observations),
  });

  return Object.freeze([
    Object.freeze({
      source: 'erc-4337-validation',
      status,
      code: signalCodeFor('erc-4337-validation', input.outcome),
      message: signalMessageFor('erc-4337-validation', input.outcome),
      required: true,
      evidence: Object.freeze({
        ...baseEvidence,
        simulateValidationStatus: input.bundlerValidation.simulateValidationStatus,
        accountValidationStatus: input.bundlerValidation.accountValidationStatus,
        signatureValidationStatus: input.bundlerValidation.signatureValidationStatus,
        nonceValidationStatus: input.bundlerValidation.nonceValidationStatus,
        prefundCovered: input.bundlerValidation.prefundCovered,
        gasLimitsWithinPolicy: input.bundlerValidation.gasLimitsWithinPolicy,
        paymasterStatus: input.bundlerValidation.paymasterStatus ?? null,
        factoryStatus: input.bundlerValidation.factoryStatus ?? null,
      }),
    }),
    Object.freeze({
      source: 'erc-7562-validation-scope',
      status,
      code: signalCodeFor('erc-7562-validation-scope', input.outcome),
      message: signalMessageFor('erc-7562-validation-scope', input.outcome),
      required: true,
      evidence: Object.freeze({
        ...baseEvidence,
        erc7562ValidationStatus: input.bundlerValidation.erc7562ValidationStatus,
        bannedOpcodeDetected: input.bundlerValidation.bannedOpcodeDetected ?? false,
        storageAccessViolation: input.bundlerValidation.storageAccessViolation ?? false,
        unstakedEntityAccessDetected: input.bundlerValidation.unstakedEntityAccessDetected ?? false,
        aggregatorAddress: input.bundlerValidation.aggregatorAddress ?? null,
      }),
    }),
  ]);
}

export function createErc4337UserOperationPreflight(
  input: CreateErc4337UserOperationPreflightInput,
): Erc4337UserOperationPreflight {
  assertAdapterConsistency(input);
  const userOperation = normalizedUserOperation(input.userOperation);
  const bundlerValidation = normalizedBundlerValidation(input.bundlerValidation, userOperation);
  const observations = buildObservations({
    intent: input.intent,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    userOperation,
    bundlerValidation,
  });
  const outcome = outcomeFromObservations(observations);
  const preflightId =
    normalizeOptionalIdentifier(input.preflightId, 'preflightId') ??
    preflightIdFor({
      userOperation,
      bundlerValidation,
      releaseBindingDigest: input.releaseBinding.digest,
      policyScopeDigest: input.policyScopeBinding.digest,
      enforcementBindingDigest: input.enforcementBinding.digest,
    });
  const signals = signalsFor({
    outcome,
    preflightId,
    userOperation,
    bundlerValidation,
    observations,
  });
  const canonicalPayload = {
    version: ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION,
    preflightId,
    adapterKind: 'erc-4337-user-operation',
    checkedAt: bundlerValidation.validatedAt,
    bundlerId: bundlerValidation.bundlerId,
    entryPoint: userOperation.entryPoint,
    entryPointVersion: userOperation.entryPointVersion,
    sender: userOperation.sender,
    userOpHash: userOperation.userOpHash,
    nonce: userOperation.nonce,
    chainId: userOperation.chainId,
    callTarget: userOperation.callTarget ?? null,
    callFunctionSelector: userOperation.callFunctionSelector ?? null,
    callDataClass: userOperation.callDataClass ?? null,
    paymaster: userOperation.paymaster ?? null,
    factory: userOperation.factory ?? null,
    outcome,
    signals,
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

export function simulateErc4337UserOperationAuthorization(
  input: CreateErc4337UserOperationPreflightInput,
): Erc4337UserOperationSimulationResult {
  const preflight = createErc4337UserOperationPreflight(input);
  const simulation = createCryptoAuthorizationSimulation({
    intent: input.intent,
    riskAssessment: input.riskAssessment,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    simulatedAt: preflight.checkedAt,
    preflightSignals: preflight.signals,
    operatorNote: `ERC-4337 UserOperation ${preflight.userOpHash} preflight ${preflight.outcome}.`,
  });

  return Object.freeze({
    preflight,
    simulation,
  });
}

export function erc4337UserOperationPreflightLabel(
  preflight: Erc4337UserOperationPreflight,
): string {
  return [
    `erc4337-userop:${preflight.userOpHash}`,
    `outcome:${preflight.outcome}`,
    `sender:${preflight.sender}`,
    `entrypoint:${preflight.entryPointVersion}`,
  ].join(' / ');
}

export function erc4337UserOperationAdapterDescriptor():
Erc4337UserOperationAdapterDescriptor {
  return Object.freeze({
    version: ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION,
    entryPointVersions: ERC4337_USER_OPERATION_ENTRYPOINT_VERSIONS,
    outcomes: ERC4337_USER_OPERATION_OUTCOMES,
    validationStatuses: ERC4337_USER_OPERATION_VALIDATION_STATUSES,
    entityStatuses: ERC4337_USER_OPERATION_ENTITY_STATUSES,
    supportedAccountKinds: ERC4337_USER_OPERATION_SUPPORTED_ACCOUNT_KINDS,
    checks: ERC4337_USER_OPERATION_CHECKS,
    standards: Object.freeze([
      'ERC-4337',
      'UserOperation',
      'EntryPoint',
      'simulateValidation',
      'handleOps',
      'ERC-7562',
      'Paymaster',
      'Factory',
      'EIP-7702-aware',
      'release-layer',
      'release-policy-control-plane',
      'release-enforcement-plane',
      'attestor-crypto-authorization-simulation',
    ]),
  });
}
