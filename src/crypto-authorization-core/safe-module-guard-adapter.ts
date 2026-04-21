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
 * Safe module guard adapter for module-initiated Safe transactions.
 *
 * Step 13 keeps module-specific execution outside the crypto core object model.
 * Safe modules can execute through execTransactionFromModule after they are
 * enabled, so this adapter treats module identity, module-guard installation,
 * module nonce/idempotency, and recovery posture as first-class preflight
 * evidence before the generic Attestor simulation can allow a preview.
 */

export const SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION =
  'attestor.crypto-safe-module-guard-adapter.v1';

export const SAFE_MODULE_GUARD_HOOK_PHASES = [
  'check-module-transaction',
  'check-after-module-execution',
] as const;
export type SafeModuleGuardHookPhase =
  typeof SAFE_MODULE_GUARD_HOOK_PHASES[number];

export const SAFE_MODULE_OPERATION_TYPES = [
  'call',
  'delegatecall',
] as const;
export type SafeModuleOperationType = typeof SAFE_MODULE_OPERATION_TYPES[number];

export const SAFE_MODULE_GUARD_OUTCOMES = [
  'allow',
  'review-required',
  'block',
] as const;
export type SafeModuleGuardOutcome =
  typeof SAFE_MODULE_GUARD_OUTCOMES[number];

export const SAFE_MODULE_GUARD_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
] as const;
export type SafeModuleGuardObservationStatus =
  typeof SAFE_MODULE_GUARD_OBSERVATION_STATUSES[number];

export const SAFE_MODULE_GUARD_CHECKS = [
  'safe-module-adapter-kind-is-module-guard',
  'safe-module-account-matches-intent',
  'safe-module-chain-matches-intent',
  'safe-module-is-enabled',
  'safe-module-guard-is-installed',
  'safe-module-operation-is-call',
  'safe-module-target-matches-intent',
  'safe-module-function-selector-matches-intent',
  'safe-module-native-value-posture',
  'safe-module-nonce-matches-intent',
  'safe-module-release-binding-ready',
  'safe-module-policy-binding-ready',
  'safe-module-enforcement-binding-ready',
  'safe-module-transaction-hash-bound',
  'safe-module-recovery-posture-ready',
  'safe-module-post-execution-status',
] as const;
export type SafeModuleGuardCheck = typeof SAFE_MODULE_GUARD_CHECKS[number];

export interface SafeModuleGuardHookContext {
  readonly phase: SafeModuleGuardHookPhase;
  readonly checkedAt: string;
  readonly moduleGuardAddress: string;
  readonly safeVersion?: string | null;
  readonly executionSuccess?: boolean | null;
}

export interface SafeModuleGuardRecoveryPosture {
  readonly moduleCanBeDisabledByOwners: boolean;
  readonly guardCanBeRemovedByOwners: boolean;
  readonly emergencySafeTxPrepared: boolean;
  readonly recoveryAuthorityRef?: string | null;
  readonly recoveryDelaySeconds?: number | null;
}

export interface SafeModuleGuardTransaction {
  readonly safeAddress: string;
  readonly chainId: string;
  readonly moduleAddress: string;
  readonly moduleEnabled: boolean;
  readonly moduleGuardInstalled: boolean;
  readonly moduleKind?: string | null;
  readonly modulePolicyRef?: string | null;
  readonly to: string;
  readonly value: string;
  readonly data: string;
  readonly operation: SafeModuleOperationType;
  readonly delegateCallAllowed?: boolean;
  readonly moduleTxHash: string;
  readonly moduleNonce: string;
  readonly executor?: string | null;
  readonly returnDataHash?: string | null;
}

export interface SafeModuleGuardObservation {
  readonly check: SafeModuleGuardCheck;
  readonly status: SafeModuleGuardObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateSafeModuleGuardPreflightInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly transaction: SafeModuleGuardTransaction;
  readonly hook: SafeModuleGuardHookContext;
  readonly recovery: SafeModuleGuardRecoveryPosture;
  readonly preflightId?: string | null;
}

export interface SafeModuleGuardPreflight {
  readonly version: typeof SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION;
  readonly preflightId: string;
  readonly adapterKind: 'safe-module-guard';
  readonly hookPhase: SafeModuleGuardHookPhase;
  readonly checkedAt: string;
  readonly moduleGuardAddress: string;
  readonly safeAddress: string;
  readonly moduleAddress: string;
  readonly moduleTxHash: string;
  readonly operation: SafeModuleOperationType;
  readonly chainId: string;
  readonly to: string;
  readonly functionSelector: string | null;
  readonly moduleNonce: string;
  readonly outcome: SafeModuleGuardOutcome;
  readonly signals: readonly CryptoSimulationPreflightSignal[];
  readonly observations: readonly SafeModuleGuardObservation[];
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface SafeModuleGuardSimulationResult {
  readonly preflight: SafeModuleGuardPreflight;
  readonly simulation: CryptoAuthorizationSimulationResult;
}

export interface SafeModuleGuardAdapterDescriptor {
  readonly version: typeof SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION;
  readonly hookPhases: typeof SAFE_MODULE_GUARD_HOOK_PHASES;
  readonly operationTypes: typeof SAFE_MODULE_OPERATION_TYPES;
  readonly outcomes: typeof SAFE_MODULE_GUARD_OUTCOMES;
  readonly checks: typeof SAFE_MODULE_GUARD_CHECKS;
  readonly standards: readonly string[];
}

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Safe module guard adapter ${fieldName} requires a non-empty value.`);
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
    throw new Error(`Safe module guard adapter ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`Safe module guard adapter ${fieldName} must be an EVM address.`);
  }
  return normalized.toLowerCase();
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`Safe module guard adapter ${fieldName} must be a 32-byte hex value.`);
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

function normalizeHexData(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(normalized)) {
    throw new Error(`Safe module guard adapter ${fieldName} must be hex bytes.`);
  }
  return normalized.toLowerCase();
}

function normalizeUintString(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`Safe module guard adapter ${fieldName} must be a non-negative integer string.`);
  }
  return normalized;
}

function normalizeOptionalRecoveryDelay(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Safe module guard adapter recoveryDelaySeconds must be a non-negative integer.');
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

function operationFrom(input: SafeModuleOperationType): SafeModuleOperationType {
  if (!SAFE_MODULE_OPERATION_TYPES.includes(input)) {
    throw new Error(`Safe module guard adapter does not support operation ${input}.`);
  }
  return input;
}

function phaseFrom(input: SafeModuleGuardHookPhase): SafeModuleGuardHookPhase {
  if (!SAFE_MODULE_GUARD_HOOK_PHASES.includes(input)) {
    throw new Error(`Safe module guard adapter does not support hook phase ${input}.`);
  }
  return input;
}

function safeFunctionSelector(data: string): string | null {
  return data.length >= 10 ? data.slice(0, 10) : null;
}

function sameAddress(left: string, right: string | null | undefined): boolean {
  if (!right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
}

function nonceMatches(intentNonce: string, moduleNonce: string): boolean {
  return (
    intentNonce === moduleNonce ||
    intentNonce === `module:nonce:${moduleNonce}` ||
    intentNonce === `safe-module:nonce:${moduleNonce}` ||
    intentNonce.endsWith(`:${moduleNonce}`)
  );
}

function observation(input: {
  readonly check: SafeModuleGuardCheck;
  readonly status: SafeModuleGuardObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): SafeModuleGuardObservation {
  return Object.freeze({
    check: input.check,
    status: input.status,
    code: normalizeIdentifier(input.code, 'observation.code'),
    message: normalizeIdentifier(input.message, 'observation.message'),
    required: input.required ?? true,
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function normalizedTransaction(
  input: SafeModuleGuardTransaction,
): SafeModuleGuardTransaction {
  return Object.freeze({
    safeAddress: normalizeAddress(input.safeAddress, 'transaction.safeAddress'),
    chainId: normalizeIdentifier(input.chainId, 'transaction.chainId'),
    moduleAddress: normalizeAddress(input.moduleAddress, 'transaction.moduleAddress'),
    moduleEnabled: input.moduleEnabled,
    moduleGuardInstalled: input.moduleGuardInstalled,
    moduleKind: normalizeOptionalIdentifier(input.moduleKind, 'transaction.moduleKind'),
    modulePolicyRef: normalizeOptionalIdentifier(
      input.modulePolicyRef,
      'transaction.modulePolicyRef',
    ),
    to: normalizeAddress(input.to, 'transaction.to'),
    value: normalizeUintString(input.value, 'transaction.value'),
    data: normalizeHexData(input.data, 'transaction.data'),
    operation: operationFrom(input.operation),
    delegateCallAllowed: input.delegateCallAllowed === true,
    moduleTxHash: normalizeHash(input.moduleTxHash, 'transaction.moduleTxHash'),
    moduleNonce: normalizeUintString(input.moduleNonce, 'transaction.moduleNonce'),
    executor: input.executor
      ? normalizeAddress(input.executor, 'transaction.executor')
      : null,
    returnDataHash: normalizeOptionalHash(input.returnDataHash, 'transaction.returnDataHash'),
  });
}

function normalizedHook(input: SafeModuleGuardHookContext): SafeModuleGuardHookContext {
  return Object.freeze({
    phase: phaseFrom(input.phase),
    checkedAt: normalizeIsoTimestamp(input.checkedAt, 'hook.checkedAt'),
    moduleGuardAddress: normalizeAddress(input.moduleGuardAddress, 'hook.moduleGuardAddress'),
    safeVersion: normalizeOptionalIdentifier(input.safeVersion, 'hook.safeVersion'),
    executionSuccess: input.executionSuccess ?? null,
  });
}

function normalizedRecovery(
  input: SafeModuleGuardRecoveryPosture,
): SafeModuleGuardRecoveryPosture {
  return Object.freeze({
    moduleCanBeDisabledByOwners: input.moduleCanBeDisabledByOwners,
    guardCanBeRemovedByOwners: input.guardCanBeRemovedByOwners,
    emergencySafeTxPrepared: input.emergencySafeTxPrepared,
    recoveryAuthorityRef: normalizeOptionalIdentifier(
      input.recoveryAuthorityRef,
      'recovery.recoveryAuthorityRef',
    ),
    recoveryDelaySeconds: normalizeOptionalRecoveryDelay(input.recoveryDelaySeconds),
  });
}

function assertAdapterConsistency(input: CreateSafeModuleGuardPreflightInput): void {
  if (input.intent.executionAdapterKind !== 'safe-module-guard') {
    throw new Error('Safe module guard adapter requires intent.executionAdapterKind safe-module-guard.');
  }
  if (input.intent.account.accountKind !== 'safe') {
    throw new Error('Safe module guard adapter requires a Safe account intent.');
  }
  if (input.riskAssessment.consequenceKind !== input.intent.consequenceKind) {
    throw new Error('Safe module guard adapter risk consequence does not match intent.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.policyScopeBinding.cryptoDecisionId) {
    throw new Error('Safe module guard adapter policy binding does not match release binding.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.enforcementBinding.cryptoDecisionId) {
    throw new Error('Safe module guard adapter enforcement binding does not match release binding.');
  }
  if (input.enforcementBinding.adapterKind !== 'safe-module-guard') {
    throw new Error('Safe module guard adapter requires safe-module-guard enforcement binding.');
  }
  if (input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind !== 'action-dispatch') {
    throw new Error('Safe module guard adapter requires action-dispatch enforcement.');
  }
  if (!input.enforcementBinding.verificationProfile.failClosed) {
    throw new Error('Safe module guard adapter requires fail-closed enforcement verification.');
  }
}

function buildObservations(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly transaction: SafeModuleGuardTransaction;
  readonly hook: SafeModuleGuardHookContext;
  readonly recovery: SafeModuleGuardRecoveryPosture;
  readonly functionSelector: string | null;
}): readonly SafeModuleGuardObservation[] {
  const observations: SafeModuleGuardObservation[] = [];
  const chainId = caip2ChainId(input.intent);
  const targetAddress = input.intent.target.address ?? null;
  const requiredSelector = input.intent.target.functionSelector?.toLowerCase() ?? null;

  observations.push(
    observation({
      check: 'safe-module-adapter-kind-is-module-guard',
      status: 'pass',
      code: 'safe-module-guard-adapter',
      message: 'Intent, release binding, and enforcement binding use the Safe module guard adapter.',
      evidence: {
        adapterKind: input.intent.executionAdapterKind,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-account-matches-intent',
      status: sameAddress(input.transaction.safeAddress, input.intent.account.address)
        ? 'pass'
        : 'fail',
      code: sameAddress(input.transaction.safeAddress, input.intent.account.address)
        ? 'safe-module-account-bound'
        : 'safe-module-account-mismatch',
      message: sameAddress(input.transaction.safeAddress, input.intent.account.address)
        ? 'Safe module transaction account matches the crypto authorization intent.'
        : 'Safe module transaction account does not match the crypto authorization intent.',
      evidence: {
        safeAddress: input.transaction.safeAddress,
        intentAccount: input.intent.account.address,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-chain-matches-intent',
      status: input.transaction.chainId === chainId ? 'pass' : 'fail',
      code: input.transaction.chainId === chainId
        ? 'safe-module-chain-bound'
        : 'safe-module-chain-mismatch',
      message: input.transaction.chainId === chainId
        ? 'Safe module transaction chain matches the crypto authorization intent.'
        : 'Safe module transaction chain does not match the crypto authorization intent.',
      evidence: {
        transactionChainId: input.transaction.chainId,
        intentChainId: chainId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-is-enabled',
      status: input.transaction.moduleEnabled ? 'pass' : 'fail',
      code: input.transaction.moduleEnabled
        ? 'safe-module-enabled'
        : 'safe-module-not-enabled',
      message: input.transaction.moduleEnabled
        ? 'Safe module is enabled before module transaction execution.'
        : 'Safe module is not enabled and cannot execute on behalf of the Safe.',
      evidence: {
        moduleAddress: input.transaction.moduleAddress,
        moduleKind: input.transaction.moduleKind ?? null,
        modulePolicyRef: input.transaction.modulePolicyRef ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-guard-is-installed',
      status: input.transaction.moduleGuardInstalled && input.hook.moduleGuardAddress !== ZERO_EVM_ADDRESS
        ? 'pass'
        : 'fail',
      code: input.transaction.moduleGuardInstalled && input.hook.moduleGuardAddress !== ZERO_EVM_ADDRESS
        ? 'safe-module-guard-installed'
        : 'safe-module-guard-not-installed',
      message: input.transaction.moduleGuardInstalled && input.hook.moduleGuardAddress !== ZERO_EVM_ADDRESS
        ? 'Safe module guard is installed for module execution.'
        : 'Safe module guard is not installed for module execution.',
      evidence: {
        moduleGuardAddress: input.hook.moduleGuardAddress,
        safeVersion: input.hook.safeVersion ?? null,
      },
    }),
  );

  const delegateCallBlocked =
    input.transaction.operation === 'delegatecall' &&
    input.transaction.delegateCallAllowed !== true;
  observations.push(
    observation({
      check: 'safe-module-operation-is-call',
      status: delegateCallBlocked ? 'fail' : 'pass',
      code: delegateCallBlocked
        ? 'safe-module-delegatecall-blocked'
        : 'safe-module-operation-compatible',
      message: delegateCallBlocked
        ? 'Safe module guard adapter blocks delegatecall unless explicitly allowed by adapter evidence.'
        : 'Safe module operation is compatible with adapter evidence.',
      evidence: {
        operation: input.transaction.operation,
        delegateCallAllowed: input.transaction.delegateCallAllowed ?? false,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-target-matches-intent',
      status: targetAddress === null
        ? 'warn'
        : sameAddress(input.transaction.to, targetAddress)
          ? 'pass'
          : 'fail',
      code: targetAddress === null
        ? 'safe-module-target-address-not-bound'
        : sameAddress(input.transaction.to, targetAddress)
          ? 'safe-module-target-bound'
          : 'safe-module-target-mismatch',
      message: targetAddress === null
        ? 'Crypto authorization intent does not bind an EVM target address for the Safe module transaction.'
        : sameAddress(input.transaction.to, targetAddress)
          ? 'Safe module transaction target matches the crypto authorization intent.'
          : 'Safe module transaction target does not match the crypto authorization intent.',
      evidence: {
        transactionTo: input.transaction.to,
        intentTargetAddress: targetAddress,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-function-selector-matches-intent',
      status: requiredSelector === null
        ? 'pass'
        : input.functionSelector === requiredSelector
          ? 'pass'
          : 'fail',
      code: requiredSelector === null
        ? 'safe-module-function-selector-not-required'
        : input.functionSelector === requiredSelector
          ? 'safe-module-function-selector-bound'
          : 'safe-module-function-selector-mismatch',
      message: requiredSelector === null
        ? 'Crypto authorization intent does not require a function selector match.'
        : input.functionSelector === requiredSelector
          ? 'Safe module transaction function selector matches the crypto authorization intent.'
          : 'Safe module transaction function selector does not match the crypto authorization intent.',
      evidence: {
        transactionFunctionSelector: input.functionSelector,
        intentFunctionSelector: requiredSelector,
      },
    }),
  );

  const nativeValueUnexpected =
    input.transaction.value !== '0' &&
    input.intent.asset !== null &&
    input.intent.asset.assetKind !== 'native-token';
  observations.push(
    observation({
      check: 'safe-module-native-value-posture',
      status: nativeValueUnexpected ? 'fail' : 'pass',
      code: nativeValueUnexpected
        ? 'safe-module-native-value-not-expected'
        : 'safe-module-native-value-compatible',
      message: nativeValueUnexpected
        ? 'Safe module transaction carries native value while the intent is scoped to a non-native asset.'
        : 'Safe module transaction native value posture is compatible with the crypto authorization intent.',
      evidence: {
        value: input.transaction.value,
        assetKind: input.intent.asset?.assetKind ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-nonce-matches-intent',
      status: nonceMatches(input.intent.constraints.nonce, input.transaction.moduleNonce)
        ? 'pass'
        : 'fail',
      code: nonceMatches(input.intent.constraints.nonce, input.transaction.moduleNonce)
        ? 'safe-module-nonce-bound'
        : 'safe-module-nonce-mismatch',
      message: nonceMatches(input.intent.constraints.nonce, input.transaction.moduleNonce)
        ? 'Safe module transaction nonce matches the crypto authorization replay constraint.'
        : 'Safe module transaction nonce does not match the crypto authorization replay constraint.',
      evidence: {
        moduleNonce: input.transaction.moduleNonce,
        intentNonce: input.intent.constraints.nonce,
      },
    }),
  );

  const releaseReady =
    input.releaseBinding.status === 'bound' &&
    (input.releaseBinding.releaseDecision.status === 'accepted' ||
      input.releaseBinding.releaseDecision.status === 'overridden');
  observations.push(
    observation({
      check: 'safe-module-release-binding-ready',
      status: releaseReady ? 'pass' : 'fail',
      code: releaseReady
        ? 'safe-module-release-binding-ready'
        : 'safe-module-release-binding-not-executable',
      message: releaseReady
        ? 'Release binding is executable for Safe module guard dispatch.'
        : 'Release binding is not executable and Safe module guard dispatch must fail closed.',
      evidence: {
        bindingStatus: input.releaseBinding.status,
        releaseStatus: input.releaseBinding.releaseDecision.status,
        releaseDecisionId: input.releaseBinding.releaseDecisionId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-policy-binding-ready',
      status: input.policyScopeBinding.activationRecord.state === 'active' ? 'pass' : 'fail',
      code: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'safe-module-policy-binding-active'
        : 'safe-module-policy-binding-not-active',
      message: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'Policy-control-plane binding is active for Safe module guard dispatch.'
        : 'Policy-control-plane binding is not active.',
      evidence: {
        activationId: input.policyScopeBinding.activationId,
        activationState: input.policyScopeBinding.activationRecord.state,
      },
    }),
  );

  const enforcementReady =
    input.enforcementBinding.adapterKind === 'safe-module-guard' &&
    input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind === 'action-dispatch' &&
    input.enforcementBinding.verificationProfile.failClosed;
  observations.push(
    observation({
      check: 'safe-module-enforcement-binding-ready',
      status: enforcementReady ? 'pass' : 'fail',
      code: enforcementReady
        ? 'safe-module-enforcement-binding-ready'
        : 'safe-module-enforcement-binding-not-ready',
      message: enforcementReady
        ? 'Enforcement binding is fail-closed and action-dispatch scoped for the Safe module guard.'
        : 'Enforcement binding is not Safe module guard action-dispatch ready.',
      evidence: {
        adapterKind: input.enforcementBinding.adapterKind,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
        profileId: input.enforcementBinding.verificationProfile.id,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-module-transaction-hash-bound',
      status: 'pass',
      code: 'safe-module-transaction-hash-bound',
      message: 'Safe module transaction hash is present and bound into adapter evidence.',
      evidence: {
        moduleTxHash: input.transaction.moduleTxHash,
        returnDataHash: input.transaction.returnDataHash ?? null,
      },
    }),
  );

  const recoveryReady =
    input.recovery.moduleCanBeDisabledByOwners &&
    input.recovery.guardCanBeRemovedByOwners &&
    input.recovery.emergencySafeTxPrepared;
  observations.push(
    observation({
      check: 'safe-module-recovery-posture-ready',
      status: recoveryReady ? 'pass' : 'fail',
      code: recoveryReady
        ? 'safe-module-recovery-posture-ready'
        : 'safe-module-recovery-posture-missing',
      message: recoveryReady
        ? 'Safe module guard has explicit owner-controlled recovery and fail-closed posture.'
        : 'Safe module guard is missing owner-controlled recovery evidence.',
      evidence: {
        moduleCanBeDisabledByOwners: input.recovery.moduleCanBeDisabledByOwners,
        guardCanBeRemovedByOwners: input.recovery.guardCanBeRemovedByOwners,
        emergencySafeTxPrepared: input.recovery.emergencySafeTxPrepared,
        recoveryAuthorityRef: input.recovery.recoveryAuthorityRef ?? null,
        recoveryDelaySeconds: input.recovery.recoveryDelaySeconds ?? null,
      },
    }),
  );

  const postExecutionRelevant = input.hook.phase === 'check-after-module-execution';
  const postExecutionSuccess = input.hook.executionSuccess === true;
  observations.push(
    observation({
      check: 'safe-module-post-execution-status',
      status: !postExecutionRelevant
        ? 'pass'
        : postExecutionSuccess
          ? 'pass'
          : 'fail',
      code: !postExecutionRelevant
        ? 'safe-module-post-execution-not-applicable'
        : postExecutionSuccess
          ? 'safe-module-post-execution-success'
          : 'safe-module-post-execution-failed',
      message: !postExecutionRelevant
        ? 'Pre-execution Safe module guard hook does not yet require post-execution success.'
        : postExecutionSuccess
          ? 'Safe module post-execution hook observed successful execution.'
          : 'Safe module post-execution hook observed failed or missing execution success.',
      evidence: {
        phase: input.hook.phase,
        executionSuccess: input.hook.executionSuccess ?? null,
      },
    }),
  );

  return Object.freeze(observations);
}

function outcomeFromObservations(
  observations: readonly SafeModuleGuardObservation[],
): SafeModuleGuardOutcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'block';
  }
  if (observations.some((entry) => entry.required && entry.status === 'warn')) {
    return 'review-required';
  }
  return 'allow';
}

function signalStatusFor(
  outcome: SafeModuleGuardOutcome,
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

function signalCodeFor(
  source: 'safe-guard' | 'module-hook',
  outcome: SafeModuleGuardOutcome,
): string {
  const prefix = source === 'safe-guard'
    ? 'safe-module-guard'
    : 'safe-module-hook';
  switch (outcome) {
    case 'allow':
      return `${prefix}-adapter-allow`;
    case 'review-required':
      return `${prefix}-adapter-review-required`;
    case 'block':
      return `${prefix}-adapter-block`;
  }
}

function signalMessageFor(
  source: 'safe-guard' | 'module-hook',
  outcome: SafeModuleGuardOutcome,
): string {
  const surface = source === 'safe-guard' ? 'Safe module guard' : 'Safe module hook';
  switch (outcome) {
    case 'allow':
      return `${surface} adapter accepted the Attestor-bound module transaction preflight.`;
    case 'review-required':
      return `${surface} adapter needs additional Attestor evidence before module execution.`;
    case 'block':
      return `${surface} adapter would block the module transaction fail-closed.`;
  }
}

function failingReasonCodes(
  observations: readonly SafeModuleGuardObservation[],
): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.code),
  );
}

function preflightIdFor(input: {
  readonly hook: SafeModuleGuardHookContext;
  readonly transaction: SafeModuleGuardTransaction;
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
}): string {
  return canonicalObject({
    version: SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION,
    phase: input.hook.phase,
    checkedAt: input.hook.checkedAt,
    moduleGuardAddress: input.hook.moduleGuardAddress,
    moduleAddress: input.transaction.moduleAddress,
    moduleTxHash: input.transaction.moduleTxHash,
    releaseBindingDigest: input.releaseBindingDigest,
    policyScopeDigest: input.policyScopeDigest,
    enforcementBindingDigest: input.enforcementBindingDigest,
  }).digest;
}

function signalsFor(input: {
  readonly outcome: SafeModuleGuardOutcome;
  readonly preflightId: string;
  readonly hook: SafeModuleGuardHookContext;
  readonly transaction: SafeModuleGuardTransaction;
  readonly functionSelector: string | null;
  readonly observations: readonly SafeModuleGuardObservation[];
}): readonly CryptoSimulationPreflightSignal[] {
  const evidence = Object.freeze({
    adapterVersion: SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION,
    preflightId: input.preflightId,
    outcome: input.outcome,
    hookPhase: input.hook.phase,
    moduleGuardAddress: input.hook.moduleGuardAddress,
    safeAddress: input.transaction.safeAddress,
    moduleAddress: input.transaction.moduleAddress,
    moduleEnabled: input.transaction.moduleEnabled,
    moduleGuardInstalled: input.transaction.moduleGuardInstalled,
    moduleTxHash: input.transaction.moduleTxHash,
    operation: input.transaction.operation,
    to: input.transaction.to,
    value: input.transaction.value,
    functionSelector: input.functionSelector,
    moduleNonce: input.transaction.moduleNonce,
    reasonCodes: failingReasonCodes(input.observations),
  });
  const status = signalStatusFor(input.outcome);

  return Object.freeze([
    Object.freeze({
      source: 'safe-guard',
      status,
      code: signalCodeFor('safe-guard', input.outcome),
      message: signalMessageFor('safe-guard', input.outcome),
      required: true,
      evidence,
    }),
    Object.freeze({
      source: 'module-hook',
      status,
      code: signalCodeFor('module-hook', input.outcome),
      message: signalMessageFor('module-hook', input.outcome),
      required: true,
      evidence,
    }),
  ]);
}

export function createSafeModuleGuardPreflight(
  input: CreateSafeModuleGuardPreflightInput,
): SafeModuleGuardPreflight {
  assertAdapterConsistency(input);
  const transaction = normalizedTransaction(input.transaction);
  const hook = normalizedHook(input.hook);
  const recovery = normalizedRecovery(input.recovery);
  const functionSelector = safeFunctionSelector(transaction.data);
  const observations = buildObservations({
    intent: input.intent,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    transaction,
    hook,
    recovery,
    functionSelector,
  });
  const outcome = outcomeFromObservations(observations);
  const preflightId =
    normalizeOptionalIdentifier(input.preflightId, 'preflightId') ??
    preflightIdFor({
      hook,
      transaction,
      releaseBindingDigest: input.releaseBinding.digest,
      policyScopeDigest: input.policyScopeBinding.digest,
      enforcementBindingDigest: input.enforcementBinding.digest,
    });
  const signals = signalsFor({
    outcome,
    preflightId,
    hook,
    transaction,
    functionSelector,
    observations,
  });
  const canonicalPayload = {
    version: SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION,
    preflightId,
    adapterKind: 'safe-module-guard',
    hookPhase: hook.phase,
    checkedAt: hook.checkedAt,
    moduleGuardAddress: hook.moduleGuardAddress,
    safeAddress: transaction.safeAddress,
    moduleAddress: transaction.moduleAddress,
    moduleTxHash: transaction.moduleTxHash,
    operation: transaction.operation,
    chainId: transaction.chainId,
    to: transaction.to,
    functionSelector,
    moduleNonce: transaction.moduleNonce,
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

export function simulateSafeModuleGuardAuthorization(
  input: CreateSafeModuleGuardPreflightInput,
): SafeModuleGuardSimulationResult {
  const preflight = createSafeModuleGuardPreflight(input);
  const simulation = createCryptoAuthorizationSimulation({
    intent: input.intent,
    riskAssessment: input.riskAssessment,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    simulatedAt: preflight.checkedAt,
    preflightSignals: preflight.signals,
    operatorNote: `Safe module guard ${preflight.hookPhase} preflight ${preflight.outcome}.`,
  });

  return Object.freeze({
    preflight,
    simulation,
  });
}

export function safeModuleGuardPreflightLabel(
  preflight: SafeModuleGuardPreflight,
): string {
  return [
    `safe-module-guard:${preflight.moduleTxHash}`,
    `outcome:${preflight.outcome}`,
    `phase:${preflight.hookPhase}`,
    `module:${preflight.moduleAddress}`,
    `safe:${preflight.safeAddress}`,
  ].join(' / ');
}

export function safeModuleGuardAdapterDescriptor():
SafeModuleGuardAdapterDescriptor {
  return Object.freeze({
    version: SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION,
    hookPhases: SAFE_MODULE_GUARD_HOOK_PHASES,
    operationTypes: SAFE_MODULE_OPERATION_TYPES,
    outcomes: SAFE_MODULE_GUARD_OUTCOMES,
    checks: SAFE_MODULE_GUARD_CHECKS,
    standards: Object.freeze([
      'Safe-Module-Guard',
      'setModuleGuard',
      'execTransactionFromModule',
      'checkModuleTransaction',
      'checkAfterModuleExecution',
      'ERC-4337-module-aware',
      'release-layer',
      'release-policy-control-plane',
      'release-enforcement-plane',
      'attestor-crypto-authorization-simulation',
    ]),
  });
}
