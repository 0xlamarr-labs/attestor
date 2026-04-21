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
 * Safe transaction guard adapter for ordinary owner-approved Safe transactions.
 *
 * Step 12 keeps Safe-specific hook shape out of the core authorization model.
 * The adapter turns Safe guard checkTransaction/checkAfterExecution facts into
 * a deterministic Attestor preflight signal, then reuses the crypto simulation
 * surface for allow/review/deny preview before a Safe transaction is dispatched.
 */

export const SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION =
  'attestor.crypto-safe-transaction-guard-adapter.v1';

export const SAFE_TRANSACTION_GUARD_HOOK_PHASES = [
  'check-transaction',
  'check-after-execution',
] as const;
export type SafeTransactionGuardHookPhase =
  typeof SAFE_TRANSACTION_GUARD_HOOK_PHASES[number];

export const SAFE_TRANSACTION_OPERATION_TYPES = [
  'call',
  'delegatecall',
] as const;
export type SafeTransactionOperationType =
  typeof SAFE_TRANSACTION_OPERATION_TYPES[number];

export const SAFE_TRANSACTION_GUARD_OUTCOMES = [
  'allow',
  'review-required',
  'block',
] as const;
export type SafeTransactionGuardOutcome =
  typeof SAFE_TRANSACTION_GUARD_OUTCOMES[number];

export const SAFE_TRANSACTION_GUARD_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
] as const;
export type SafeTransactionGuardObservationStatus =
  typeof SAFE_TRANSACTION_GUARD_OBSERVATION_STATUSES[number];

export const SAFE_TRANSACTION_GUARD_CHECKS = [
  'safe-adapter-kind-is-ordinary-guard',
  'safe-account-matches-intent',
  'safe-chain-matches-intent',
  'safe-operation-is-call',
  'safe-target-matches-intent',
  'safe-function-selector-matches-intent',
  'safe-native-value-posture',
  'safe-nonce-matches-intent',
  'safe-release-binding-ready',
  'safe-policy-binding-ready',
  'safe-enforcement-binding-ready',
  'safe-transaction-hash-bound',
  'safe-post-execution-status',
] as const;
export type SafeTransactionGuardCheck =
  typeof SAFE_TRANSACTION_GUARD_CHECKS[number];

export interface SafeTransactionGuardHookContext {
  readonly phase: SafeTransactionGuardHookPhase;
  readonly checkedAt: string;
  readonly guardAddress: string;
  readonly safeVersion?: string | null;
  readonly executionSuccess?: boolean | null;
}

export interface SafeTransactionGuardTransaction {
  readonly safeAddress: string;
  readonly chainId: string;
  readonly to: string;
  readonly value: string;
  readonly data: string;
  readonly operation: SafeTransactionOperationType;
  readonly safeTxGas?: string | null;
  readonly baseGas?: string | null;
  readonly gasPrice?: string | null;
  readonly gasToken?: string | null;
  readonly refundReceiver?: string | null;
  readonly signaturesHash?: string | null;
  readonly msgSender?: string | null;
  readonly safeTxHash: string;
  readonly nonce: string;
}

export interface SafeTransactionGuardObservation {
  readonly check: SafeTransactionGuardCheck;
  readonly status: SafeTransactionGuardObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateSafeTransactionGuardPreflightInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly transaction: SafeTransactionGuardTransaction;
  readonly hook: SafeTransactionGuardHookContext;
  readonly preflightId?: string | null;
}

export interface SafeTransactionGuardPreflight {
  readonly version: typeof SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION;
  readonly preflightId: string;
  readonly adapterKind: 'safe-guard';
  readonly hookPhase: SafeTransactionGuardHookPhase;
  readonly checkedAt: string;
  readonly guardAddress: string;
  readonly safeAddress: string;
  readonly safeTxHash: string;
  readonly operation: SafeTransactionOperationType;
  readonly chainId: string;
  readonly to: string;
  readonly functionSelector: string | null;
  readonly nonce: string;
  readonly outcome: SafeTransactionGuardOutcome;
  readonly signal: CryptoSimulationPreflightSignal;
  readonly observations: readonly SafeTransactionGuardObservation[];
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface SafeTransactionGuardSimulationResult {
  readonly preflight: SafeTransactionGuardPreflight;
  readonly simulation: CryptoAuthorizationSimulationResult;
}

export interface SafeTransactionGuardAdapterDescriptor {
  readonly version: typeof SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION;
  readonly hookPhases: typeof SAFE_TRANSACTION_GUARD_HOOK_PHASES;
  readonly operationTypes: typeof SAFE_TRANSACTION_OPERATION_TYPES;
  readonly outcomes: typeof SAFE_TRANSACTION_GUARD_OUTCOMES;
  readonly checks: typeof SAFE_TRANSACTION_GUARD_CHECKS;
  readonly standards: readonly string[];
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Safe transaction guard adapter ${fieldName} requires a non-empty value.`);
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
    throw new Error(`Safe transaction guard adapter ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`Safe transaction guard adapter ${fieldName} must be an EVM address.`);
  }
  return normalized.toLowerCase();
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`Safe transaction guard adapter ${fieldName} must be a 32-byte hex value.`);
  }
  return normalized.toLowerCase();
}

function normalizeHexData(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(normalized)) {
    throw new Error(`Safe transaction guard adapter ${fieldName} must be hex bytes.`);
  }
  return normalized.toLowerCase();
}

function normalizeUintString(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`Safe transaction guard adapter ${fieldName} must be a non-negative integer string.`);
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

function operationFrom(input: SafeTransactionOperationType): SafeTransactionOperationType {
  if (!SAFE_TRANSACTION_OPERATION_TYPES.includes(input)) {
    throw new Error(`Safe transaction guard adapter does not support operation ${input}.`);
  }
  return input;
}

function phaseFrom(input: SafeTransactionGuardHookPhase): SafeTransactionGuardHookPhase {
  if (!SAFE_TRANSACTION_GUARD_HOOK_PHASES.includes(input)) {
    throw new Error(`Safe transaction guard adapter does not support hook phase ${input}.`);
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

function nonceMatches(intentNonce: string, safeNonce: string): boolean {
  return (
    intentNonce === safeNonce ||
    intentNonce === `safe:nonce:${safeNonce}` ||
    intentNonce.endsWith(`:${safeNonce}`)
  );
}

function observation(input: {
  readonly check: SafeTransactionGuardCheck;
  readonly status: SafeTransactionGuardObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): SafeTransactionGuardObservation {
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
  input: SafeTransactionGuardTransaction,
): SafeTransactionGuardTransaction {
  return Object.freeze({
    safeAddress: normalizeAddress(input.safeAddress, 'transaction.safeAddress'),
    chainId: normalizeIdentifier(input.chainId, 'transaction.chainId'),
    to: normalizeAddress(input.to, 'transaction.to'),
    value: normalizeUintString(input.value, 'transaction.value'),
    data: normalizeHexData(input.data, 'transaction.data'),
    operation: operationFrom(input.operation),
    safeTxGas: normalizeOptionalUintString(input.safeTxGas, 'transaction.safeTxGas'),
    baseGas: normalizeOptionalUintString(input.baseGas, 'transaction.baseGas'),
    gasPrice: normalizeOptionalUintString(input.gasPrice, 'transaction.gasPrice'),
    gasToken: normalizeOptionalIdentifier(input.gasToken, 'transaction.gasToken'),
    refundReceiver: normalizeOptionalIdentifier(input.refundReceiver, 'transaction.refundReceiver'),
    signaturesHash: input.signaturesHash
      ? normalizeHash(input.signaturesHash, 'transaction.signaturesHash')
      : null,
    msgSender: input.msgSender
      ? normalizeAddress(input.msgSender, 'transaction.msgSender')
      : null,
    safeTxHash: normalizeHash(input.safeTxHash, 'transaction.safeTxHash'),
    nonce: normalizeUintString(input.nonce, 'transaction.nonce'),
  });
}

function normalizedHook(input: SafeTransactionGuardHookContext):
SafeTransactionGuardHookContext {
  return Object.freeze({
    phase: phaseFrom(input.phase),
    checkedAt: normalizeIsoTimestamp(input.checkedAt, 'hook.checkedAt'),
    guardAddress: normalizeAddress(input.guardAddress, 'hook.guardAddress'),
    safeVersion: normalizeOptionalIdentifier(input.safeVersion, 'hook.safeVersion'),
    executionSuccess: input.executionSuccess ?? null,
  });
}

function assertAdapterConsistency(input: CreateSafeTransactionGuardPreflightInput): void {
  if (input.intent.executionAdapterKind !== 'safe-guard') {
    throw new Error('Safe transaction guard adapter requires intent.executionAdapterKind safe-guard.');
  }
  if (input.intent.account.accountKind !== 'safe') {
    throw new Error('Safe transaction guard adapter requires a Safe account intent.');
  }
  if (input.riskAssessment.consequenceKind !== input.intent.consequenceKind) {
    throw new Error('Safe transaction guard adapter risk consequence does not match intent.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.policyScopeBinding.cryptoDecisionId) {
    throw new Error('Safe transaction guard adapter policy binding does not match release binding.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.enforcementBinding.cryptoDecisionId) {
    throw new Error('Safe transaction guard adapter enforcement binding does not match release binding.');
  }
  if (input.enforcementBinding.adapterKind !== 'safe-guard') {
    throw new Error('Safe transaction guard adapter requires safe-guard enforcement binding.');
  }
  if (input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind !== 'action-dispatch') {
    throw new Error('Safe transaction guard adapter requires action-dispatch enforcement.');
  }
  if (!input.enforcementBinding.verificationProfile.failClosed) {
    throw new Error('Safe transaction guard adapter requires fail-closed enforcement verification.');
  }
}

function buildObservations(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly transaction: SafeTransactionGuardTransaction;
  readonly hook: SafeTransactionGuardHookContext;
  readonly functionSelector: string | null;
}): readonly SafeTransactionGuardObservation[] {
  const observations: SafeTransactionGuardObservation[] = [];
  const chainId = caip2ChainId(input.intent);
  const targetAddress = input.intent.target.address ?? null;
  const requiredSelector = input.intent.target.functionSelector?.toLowerCase() ?? null;

  observations.push(
    observation({
      check: 'safe-adapter-kind-is-ordinary-guard',
      status: 'pass',
      code: 'safe-ordinary-guard-adapter',
      message: 'Intent, release binding, and enforcement binding use the ordinary Safe transaction guard adapter.',
      evidence: {
        adapterKind: input.intent.executionAdapterKind,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-account-matches-intent',
      status: sameAddress(input.transaction.safeAddress, input.intent.account.address)
        ? 'pass'
        : 'fail',
      code: sameAddress(input.transaction.safeAddress, input.intent.account.address)
        ? 'safe-account-bound'
        : 'safe-account-mismatch',
      message: sameAddress(input.transaction.safeAddress, input.intent.account.address)
        ? 'Safe transaction account matches the crypto authorization intent.'
        : 'Safe transaction account does not match the crypto authorization intent.',
      evidence: {
        safeAddress: input.transaction.safeAddress,
        intentAccount: input.intent.account.address,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-chain-matches-intent',
      status: input.transaction.chainId === chainId ? 'pass' : 'fail',
      code: input.transaction.chainId === chainId
        ? 'safe-chain-bound'
        : 'safe-chain-mismatch',
      message: input.transaction.chainId === chainId
        ? 'Safe transaction chain matches the crypto authorization intent.'
        : 'Safe transaction chain does not match the crypto authorization intent.',
      evidence: {
        transactionChainId: input.transaction.chainId,
        intentChainId: chainId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-operation-is-call',
      status: input.transaction.operation === 'call' ? 'pass' : 'fail',
      code: input.transaction.operation === 'call'
        ? 'safe-operation-call'
        : 'safe-delegatecall-blocked',
      message: input.transaction.operation === 'call'
        ? 'Ordinary Safe transaction uses CALL operation.'
        : 'Ordinary Safe transaction guard adapter blocks delegatecall execution.',
      evidence: {
        operation: input.transaction.operation,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-target-matches-intent',
      status: targetAddress === null
        ? 'warn'
        : sameAddress(input.transaction.to, targetAddress)
          ? 'pass'
          : 'fail',
      code: targetAddress === null
        ? 'safe-target-address-not-bound'
        : sameAddress(input.transaction.to, targetAddress)
          ? 'safe-target-bound'
          : 'safe-target-mismatch',
      message: targetAddress === null
        ? 'Crypto authorization intent does not bind an EVM target address for the Safe transaction.'
        : sameAddress(input.transaction.to, targetAddress)
          ? 'Safe transaction target matches the crypto authorization intent.'
          : 'Safe transaction target does not match the crypto authorization intent.',
      evidence: {
        transactionTo: input.transaction.to,
        intentTargetAddress: targetAddress,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-function-selector-matches-intent',
      status: requiredSelector === null
        ? 'pass'
        : input.functionSelector === requiredSelector
          ? 'pass'
          : 'fail',
      code: requiredSelector === null
        ? 'safe-function-selector-not-required'
        : input.functionSelector === requiredSelector
          ? 'safe-function-selector-bound'
          : 'safe-function-selector-mismatch',
      message: requiredSelector === null
        ? 'Crypto authorization intent does not require a function selector match.'
        : input.functionSelector === requiredSelector
          ? 'Safe transaction function selector matches the crypto authorization intent.'
          : 'Safe transaction function selector does not match the crypto authorization intent.',
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
      check: 'safe-native-value-posture',
      status: nativeValueUnexpected ? 'fail' : 'pass',
      code: nativeValueUnexpected
        ? 'safe-native-value-not-expected'
        : 'safe-native-value-compatible',
      message: nativeValueUnexpected
        ? 'Safe transaction carries native value while the intent is scoped to a non-native asset.'
        : 'Safe transaction native value posture is compatible with the crypto authorization intent.',
      evidence: {
        value: input.transaction.value,
        assetKind: input.intent.asset?.assetKind ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-nonce-matches-intent',
      status: nonceMatches(input.intent.constraints.nonce, input.transaction.nonce)
        ? 'pass'
        : 'fail',
      code: nonceMatches(input.intent.constraints.nonce, input.transaction.nonce)
        ? 'safe-nonce-bound'
        : 'safe-nonce-mismatch',
      message: nonceMatches(input.intent.constraints.nonce, input.transaction.nonce)
        ? 'Safe transaction nonce matches the crypto authorization replay constraint.'
        : 'Safe transaction nonce does not match the crypto authorization replay constraint.',
      evidence: {
        transactionNonce: input.transaction.nonce,
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
      check: 'safe-release-binding-ready',
      status: releaseReady ? 'pass' : 'fail',
      code: releaseReady
        ? 'safe-release-binding-ready'
        : 'safe-release-binding-not-executable',
      message: releaseReady
        ? 'Release binding is executable for Safe guard dispatch.'
        : 'Release binding is not executable and Safe guard dispatch must fail closed.',
      evidence: {
        bindingStatus: input.releaseBinding.status,
        releaseStatus: input.releaseBinding.releaseDecision.status,
        releaseDecisionId: input.releaseBinding.releaseDecisionId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-policy-binding-ready',
      status: input.policyScopeBinding.activationRecord.state === 'active' ? 'pass' : 'fail',
      code: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'safe-policy-binding-active'
        : 'safe-policy-binding-not-active',
      message: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'Policy-control-plane binding is active for Safe guard dispatch.'
        : 'Policy-control-plane binding is not active.',
      evidence: {
        activationId: input.policyScopeBinding.activationId,
        activationState: input.policyScopeBinding.activationRecord.state,
      },
    }),
  );

  const enforcementReady =
    input.enforcementBinding.adapterKind === 'safe-guard' &&
    input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind === 'action-dispatch' &&
    input.enforcementBinding.verificationProfile.failClosed;
  observations.push(
    observation({
      check: 'safe-enforcement-binding-ready',
      status: enforcementReady ? 'pass' : 'fail',
      code: enforcementReady
        ? 'safe-enforcement-binding-ready'
        : 'safe-enforcement-binding-not-ready',
      message: enforcementReady
        ? 'Enforcement binding is fail-closed and action-dispatch scoped for the Safe guard.'
        : 'Enforcement binding is not Safe guard action-dispatch ready.',
      evidence: {
        adapterKind: input.enforcementBinding.adapterKind,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
        profileId: input.enforcementBinding.verificationProfile.id,
      },
    }),
  );

  observations.push(
    observation({
      check: 'safe-transaction-hash-bound',
      status: 'pass',
      code: 'safe-transaction-hash-bound',
      message: 'Safe transaction hash is present and bound into the adapter evidence.',
      evidence: {
        safeTxHash: input.transaction.safeTxHash,
        signaturesHash: input.transaction.signaturesHash ?? null,
      },
    }),
  );

  const postExecutionRelevant = input.hook.phase === 'check-after-execution';
  const postExecutionSuccess = input.hook.executionSuccess === true;
  observations.push(
    observation({
      check: 'safe-post-execution-status',
      status: !postExecutionRelevant
        ? 'pass'
        : postExecutionSuccess
          ? 'pass'
          : 'fail',
      code: !postExecutionRelevant
        ? 'safe-post-execution-not-applicable'
        : postExecutionSuccess
          ? 'safe-post-execution-success'
          : 'safe-post-execution-failed',
      message: !postExecutionRelevant
        ? 'Pre-execution Safe guard hook does not yet require post-execution success.'
        : postExecutionSuccess
          ? 'Safe post-execution hook observed successful execution.'
          : 'Safe post-execution hook observed failed or missing execution success.',
      evidence: {
        phase: input.hook.phase,
        executionSuccess: input.hook.executionSuccess ?? null,
      },
    }),
  );

  return Object.freeze(observations);
}

function outcomeFromObservations(
  observations: readonly SafeTransactionGuardObservation[],
): SafeTransactionGuardOutcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'block';
  }
  if (observations.some((entry) => entry.required && entry.status === 'warn')) {
    return 'review-required';
  }
  return 'allow';
}

function signalStatusFor(
  outcome: SafeTransactionGuardOutcome,
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

function signalCodeFor(outcome: SafeTransactionGuardOutcome): string {
  switch (outcome) {
    case 'allow':
      return 'safe-guard-adapter-allow';
    case 'review-required':
      return 'safe-guard-adapter-review-required';
    case 'block':
      return 'safe-guard-adapter-block';
  }
}

function signalMessageFor(outcome: SafeTransactionGuardOutcome): string {
  switch (outcome) {
    case 'allow':
      return 'Safe transaction guard adapter accepted the Attestor-bound transaction preflight.';
    case 'review-required':
      return 'Safe transaction guard adapter needs additional Attestor evidence before execution.';
    case 'block':
      return 'Safe transaction guard adapter would block the transaction fail-closed.';
  }
}

function failingReasonCodes(
  observations: readonly SafeTransactionGuardObservation[],
): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.code),
  );
}

function preflightIdFor(input: {
  readonly hook: SafeTransactionGuardHookContext;
  readonly transaction: SafeTransactionGuardTransaction;
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
}): string {
  return canonicalObject({
    version: SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION,
    phase: input.hook.phase,
    checkedAt: input.hook.checkedAt,
    guardAddress: input.hook.guardAddress,
    safeTxHash: input.transaction.safeTxHash,
    releaseBindingDigest: input.releaseBindingDigest,
    policyScopeDigest: input.policyScopeDigest,
    enforcementBindingDigest: input.enforcementBindingDigest,
  }).digest;
}

export function createSafeTransactionGuardPreflight(
  input: CreateSafeTransactionGuardPreflightInput,
): SafeTransactionGuardPreflight {
  assertAdapterConsistency(input);
  const transaction = normalizedTransaction(input.transaction);
  const hook = normalizedHook(input.hook);
  const functionSelector = safeFunctionSelector(transaction.data);
  const observations = buildObservations({
    intent: input.intent,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    transaction,
    hook,
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
  const signal: CryptoSimulationPreflightSignal = Object.freeze({
    source: 'safe-guard',
    status: signalStatusFor(outcome),
    code: signalCodeFor(outcome),
    message: signalMessageFor(outcome),
    required: true,
    evidence: Object.freeze({
      adapterVersion: SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION,
      preflightId,
      outcome,
      hookPhase: hook.phase,
      guardAddress: hook.guardAddress,
      safeAddress: transaction.safeAddress,
      safeTxHash: transaction.safeTxHash,
      operation: transaction.operation,
      to: transaction.to,
      value: transaction.value,
      functionSelector,
      nonce: transaction.nonce,
      reasonCodes: failingReasonCodes(observations),
    }),
  });
  const canonicalPayload = {
    version: SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION,
    preflightId,
    adapterKind: 'safe-guard',
    hookPhase: hook.phase,
    checkedAt: hook.checkedAt,
    guardAddress: hook.guardAddress,
    safeAddress: transaction.safeAddress,
    safeTxHash: transaction.safeTxHash,
    operation: transaction.operation,
    chainId: transaction.chainId,
    to: transaction.to,
    functionSelector,
    nonce: transaction.nonce,
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

export function simulateSafeTransactionGuardAuthorization(
  input: CreateSafeTransactionGuardPreflightInput,
): SafeTransactionGuardSimulationResult {
  const preflight = createSafeTransactionGuardPreflight(input);
  const simulation = createCryptoAuthorizationSimulation({
    intent: input.intent,
    riskAssessment: input.riskAssessment,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    simulatedAt: preflight.checkedAt,
    preflightSignals: [preflight.signal],
    operatorNote: `Safe transaction guard ${preflight.hookPhase} preflight ${preflight.outcome}.`,
  });

  return Object.freeze({
    preflight,
    simulation,
  });
}

export function safeTransactionGuardPreflightLabel(
  preflight: SafeTransactionGuardPreflight,
): string {
  return [
    `safe-guard:${preflight.safeTxHash}`,
    `outcome:${preflight.outcome}`,
    `phase:${preflight.hookPhase}`,
    `safe:${preflight.safeAddress}`,
  ].join(' / ');
}

export function safeTransactionGuardAdapterDescriptor():
SafeTransactionGuardAdapterDescriptor {
  return Object.freeze({
    version: SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION,
    hookPhases: SAFE_TRANSACTION_GUARD_HOOK_PHASES,
    operationTypes: SAFE_TRANSACTION_OPERATION_TYPES,
    outcomes: SAFE_TRANSACTION_GUARD_OUTCOMES,
    checks: SAFE_TRANSACTION_GUARD_CHECKS,
    standards: Object.freeze([
      'Safe-Smart-Account-Guard',
      'checkTransaction',
      'checkAfterExecution',
      'ERC-1271-aware',
      'release-layer',
      'release-policy-control-plane',
      'release-enforcement-plane',
      'attestor-crypto-authorization-simulation',
      'OWASP-SCSVS-guard-hook-aware',
    ]),
  });
}
