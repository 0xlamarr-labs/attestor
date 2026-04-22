import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  SafeModuleGuardPreflight,
} from '../crypto-authorization-core/safe-module-guard-adapter.js';
import type {
  SafeTransactionGuardPreflight,
} from '../crypto-authorization-core/safe-transaction-guard-adapter.js';
import type { CryptoExecutionAdmissionPlan } from './index.js';

/**
 * Safe guard admission receipts bind Attestor admission plans to Safe guard
 * and module-guard pre/post execution hooks. They do not replace Safe's guard
 * contracts; they create the durable off-chain receipt a guard-aware
 * integration can verify before and after Safe execution.
 */

export const SAFE_GUARD_ADMISSION_RECEIPT_SPEC_VERSION =
  'attestor.crypto-safe-guard-admission-receipt.v1';

export const SAFE_GUARD_ADMISSION_RECEIPT_KINDS = [
  'safe-transaction-guard',
  'safe-module-guard',
] as const;
export type SafeGuardAdmissionReceiptKind =
  typeof SAFE_GUARD_ADMISSION_RECEIPT_KINDS[number];

export const SAFE_GUARD_ADMISSION_OUTCOMES = [
  'ready',
  'post-execution-pending',
  'recovery-required',
  'blocked',
] as const;
export type SafeGuardAdmissionOutcome =
  typeof SAFE_GUARD_ADMISSION_OUTCOMES[number];

export const SAFE_GUARD_ADMISSION_PHASES = [
  'pre-execution',
  'post-execution',
] as const;
export type SafeGuardAdmissionPhase =
  typeof SAFE_GUARD_ADMISSION_PHASES[number];

export const SAFE_GUARD_INTERFACE_IDS = Object.freeze({
  erc165: '0x01ffc9a7',
  transactionGuard: '0xe6d7a83a',
  moduleGuard: '0x58401ed8',
});

export interface SafeGuardAdmissionRecoveryPosture {
  readonly guardCanBeRemovedByOwners: boolean;
  readonly emergencySafeTxPrepared: boolean;
  readonly recoveryAuthorityRef?: string | null;
  readonly recoveryDelaySeconds?: number | null;
  readonly moduleCanBeDisabledByOwners?: boolean | null;
}

export interface SafeGuardAdmissionInstallationEvidence {
  readonly guardAddress: string;
  readonly expectedGuardAddress?: string | null;
  readonly safeVersion?: string | null;
  readonly supportsErc165: boolean;
  readonly supportsGuardInterface: boolean;
  readonly enabledOnSafe: boolean;
  readonly changedGuardEventObserved?: boolean | null;
  readonly changedModuleGuardEventObserved?: boolean | null;
}

export interface SafeGuardAdmissionExecutionObservation {
  readonly observedAt: string;
  readonly txHash: string;
  readonly success: boolean;
  readonly revertedReason?: string | null;
  readonly statusEvent?: string | null;
}

export interface CreateSafeGuardAdmissionReceiptInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight;
  readonly createdAt: string;
  readonly receiptId?: string | null;
  readonly installation: SafeGuardAdmissionInstallationEvidence;
  readonly recovery: SafeGuardAdmissionRecoveryPosture;
  readonly execution?: SafeGuardAdmissionExecutionObservation | null;
  readonly operatorNote?: string | null;
}

export interface SafeGuardAdmissionReceipt {
  readonly version: typeof SAFE_GUARD_ADMISSION_RECEIPT_SPEC_VERSION;
  readonly receiptId: string;
  readonly createdAt: string;
  readonly kind: SafeGuardAdmissionReceiptKind;
  readonly phase: SafeGuardAdmissionPhase;
  readonly outcome: SafeGuardAdmissionOutcome;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly adapterKind: 'safe-guard' | 'safe-module-guard';
  readonly safeAddress: string;
  readonly guardAddress: string;
  readonly moduleAddress: string | null;
  readonly chainId: string;
  readonly operation: 'call' | 'delegatecall';
  readonly transactionHash: string;
  readonly preflightId: string;
  readonly preflightDigest: string;
  readonly interfaceId: string;
  readonly supportsErc165: boolean;
  readonly supportsGuardInterface: boolean;
  readonly installation: SafeGuardAdmissionInstallationEvidence;
  readonly recovery: SafeGuardAdmissionRecoveryPosture;
  readonly execution: SafeGuardAdmissionExecutionObservation | null;
  readonly blockingReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface SafeGuardAdmissionDescriptor {
  readonly version: typeof SAFE_GUARD_ADMISSION_RECEIPT_SPEC_VERSION;
  readonly kinds: typeof SAFE_GUARD_ADMISSION_RECEIPT_KINDS;
  readonly outcomes: typeof SAFE_GUARD_ADMISSION_OUTCOMES;
  readonly phases: typeof SAFE_GUARD_ADMISSION_PHASES;
  readonly interfaceIds: typeof SAFE_GUARD_INTERFACE_IDS;
  readonly standards: readonly string[];
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`Safe guard admission ${fieldName} requires a non-empty value.`);
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
    throw new Error(`Safe guard admission ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(normalized)) {
    throw new Error(`Safe guard admission ${fieldName} must be an EVM address.`);
  }
  return normalized;
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`Safe guard admission ${fieldName} must be a 32-byte hex value.`);
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

function normalizeOptionalDelay(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Safe guard admission recoveryDelaySeconds must be a non-negative integer.');
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

function isModulePreflight(
  preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight,
): preflight is SafeModuleGuardPreflight {
  return preflight.adapterKind === 'safe-module-guard';
}

function kindFor(
  preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight,
): SafeGuardAdmissionReceiptKind {
  return isModulePreflight(preflight)
    ? 'safe-module-guard'
    : 'safe-transaction-guard';
}

function phaseFor(
  preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight,
): SafeGuardAdmissionPhase {
  if (
    preflight.hookPhase === 'check-after-execution' ||
    preflight.hookPhase === 'check-after-module-execution'
  ) {
    return 'post-execution';
  }
  return 'pre-execution';
}

function guardAddressFor(
  preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight,
): string {
  return isModulePreflight(preflight)
    ? preflight.moduleGuardAddress
    : preflight.guardAddress;
}

function transactionHashFor(
  preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight,
): string {
  return isModulePreflight(preflight)
    ? preflight.moduleTxHash
    : preflight.safeTxHash;
}

function preflightOutcome(
  preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight,
): 'allow' | 'review-required' | 'block' {
  return preflight.outcome;
}

function preflightExecutionSuccess(
  preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight,
): boolean | null {
  const maybeExecutionSuccess = (
    preflight as SafeTransactionGuardPreflight | SafeModuleGuardPreflight
  ).observations.find((observation) =>
    observation.check.endsWith('post-execution-status'),
  )?.evidence.executionSuccess;
  return typeof maybeExecutionSuccess === 'boolean' ? maybeExecutionSuccess : null;
}

function normalizedInstallation(
  input: SafeGuardAdmissionInstallationEvidence,
  expectedGuardAddress: string,
): SafeGuardAdmissionInstallationEvidence {
  return Object.freeze({
    guardAddress: normalizeAddress(input.guardAddress, 'installation.guardAddress'),
    expectedGuardAddress: input.expectedGuardAddress
      ? normalizeAddress(input.expectedGuardAddress, 'installation.expectedGuardAddress')
      : expectedGuardAddress,
    safeVersion: normalizeOptionalIdentifier(input.safeVersion, 'installation.safeVersion'),
    supportsErc165: input.supportsErc165,
    supportsGuardInterface: input.supportsGuardInterface,
    enabledOnSafe: input.enabledOnSafe,
    changedGuardEventObserved: input.changedGuardEventObserved ?? null,
    changedModuleGuardEventObserved: input.changedModuleGuardEventObserved ?? null,
  });
}

function normalizedRecovery(
  input: SafeGuardAdmissionRecoveryPosture,
): SafeGuardAdmissionRecoveryPosture {
  return Object.freeze({
    guardCanBeRemovedByOwners: input.guardCanBeRemovedByOwners,
    emergencySafeTxPrepared: input.emergencySafeTxPrepared,
    recoveryAuthorityRef: normalizeOptionalIdentifier(
      input.recoveryAuthorityRef,
      'recovery.recoveryAuthorityRef',
    ),
    recoveryDelaySeconds: normalizeOptionalDelay(input.recoveryDelaySeconds),
    moduleCanBeDisabledByOwners: input.moduleCanBeDisabledByOwners ?? null,
  });
}

function normalizedExecution(
  input: SafeGuardAdmissionExecutionObservation | null | undefined,
): SafeGuardAdmissionExecutionObservation | null {
  if (input === undefined || input === null) return null;
  return Object.freeze({
    observedAt: normalizeIsoTimestamp(input.observedAt, 'execution.observedAt'),
    txHash: normalizeHash(input.txHash, 'execution.txHash'),
    success: input.success,
    revertedReason: normalizeOptionalIdentifier(input.revertedReason, 'execution.revertedReason'),
    statusEvent: normalizeOptionalIdentifier(input.statusEvent, 'execution.statusEvent'),
  });
}

function recoveryIsReady(
  kind: SafeGuardAdmissionReceiptKind,
  recovery: SafeGuardAdmissionRecoveryPosture,
): boolean {
  const baseReady =
    recovery.guardCanBeRemovedByOwners && recovery.emergencySafeTxPrepared;
  if (kind !== 'safe-module-guard') return baseReady;
  return baseReady && recovery.moduleCanBeDisabledByOwners === true;
}

function blockingReasonsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight;
  readonly installation: SafeGuardAdmissionInstallationEvidence;
  readonly recovery: SafeGuardAdmissionRecoveryPosture;
  readonly execution: SafeGuardAdmissionExecutionObservation | null;
  readonly kind: SafeGuardAdmissionReceiptKind;
}): readonly string[] {
  const reasons: string[] = [];
  if (input.plan.surface !== 'smart-account-guard') {
    reasons.push('admission-plan-surface-not-smart-account-guard');
  }
  if (
    input.plan.adapterKind !== 'safe-guard' &&
    input.plan.adapterKind !== 'safe-module-guard'
  ) {
    reasons.push('admission-plan-adapter-not-safe-guard');
  }
  if (input.plan.adapterKind !== input.preflight.adapterKind) {
    reasons.push('admission-plan-preflight-adapter-mismatch');
  }
  if (input.plan.outcome === 'deny') {
    reasons.push('admission-plan-denied');
  }
  if (input.preflight.chainId !== input.plan.chainId) {
    reasons.push('safe-chain-mismatch');
  }
  if (input.preflight.safeAddress !== input.plan.accountAddress.toLowerCase()) {
    reasons.push('safe-account-mismatch');
  }
  if (preflightOutcome(input.preflight) === 'block') {
    reasons.push('safe-guard-preflight-blocked');
  }
  if (input.installation.guardAddress !== guardAddressFor(input.preflight)) {
    reasons.push('safe-guard-installation-address-mismatch');
  }
  if (!input.installation.enabledOnSafe) {
    reasons.push('safe-guard-not-enabled-on-safe');
  }
  if (!input.installation.supportsErc165) {
    reasons.push('safe-guard-erc165-support-missing');
  }
  if (!input.installation.supportsGuardInterface) {
    reasons.push('safe-guard-interface-support-missing');
  }
  if (input.execution && !input.execution.success) {
    reasons.push('safe-guard-post-execution-failed');
  }
  const hookExecutionSuccess = preflightExecutionSuccess(input.preflight);
  if (hookExecutionSuccess === false) {
    reasons.push('safe-guard-hook-reported-execution-failure');
  }
  if (!recoveryIsReady(input.kind, input.recovery)) {
    reasons.push('safe-guard-recovery-posture-required');
  }
  return Object.freeze(reasons);
}

function outcomeFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight;
  readonly phase: SafeGuardAdmissionPhase;
  readonly blockingReasons: readonly string[];
}): SafeGuardAdmissionOutcome {
  if (
    input.blockingReasons.some((reason) => reason !== 'safe-guard-recovery-posture-required')
  ) {
    return 'blocked';
  }
  if (input.blockingReasons.includes('safe-guard-recovery-posture-required')) {
    return 'recovery-required';
  }
  if (input.plan.outcome !== 'admit' || preflightOutcome(input.preflight) !== 'allow') {
    return 'post-execution-pending';
  }
  if (input.phase === 'pre-execution') {
    return 'ready';
  }
  return 'ready';
}

function nextActionsFor(outcome: SafeGuardAdmissionOutcome): readonly string[] {
  switch (outcome) {
    case 'ready':
      return Object.freeze([
        'Proceed through the Safe guard surface and persist this admission receipt.',
        'Record the post-execution Safe guard observation after the Safe transaction returns.',
      ]);
    case 'post-execution-pending':
      return Object.freeze([
        'Do not treat this Safe guard receipt as final until post-execution evidence is recorded.',
        'Collect checkAfterExecution or checkAfterModuleExecution evidence before settlement closure.',
      ]);
    case 'recovery-required':
      return Object.freeze([
        'Do not enable or rely on this Safe guard path until owner recovery is proven.',
        'Prepare an emergency Safe transaction for guard removal or module disablement.',
      ]);
    case 'blocked':
      return Object.freeze([
        'Do not submit the Safe transaction or module transaction.',
        'Resolve the blocked Safe guard admission reason and create a new receipt.',
      ]);
  }
}

function receiptIdFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: SafeTransactionGuardPreflight | SafeModuleGuardPreflight;
  readonly createdAt: string;
  readonly transactionHash: string;
}): string {
  return canonicalObject({
    version: SAFE_GUARD_ADMISSION_RECEIPT_SPEC_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightDigest: input.preflight.digest,
    transactionHash: input.transactionHash,
    createdAt: input.createdAt,
  }).digest;
}

export function createSafeGuardAdmissionReceipt(
  input: CreateSafeGuardAdmissionReceiptInput,
): SafeGuardAdmissionReceipt {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const kind = kindFor(input.preflight);
  const phase = phaseFor(input.preflight);
  const guardAddress = normalizeAddress(guardAddressFor(input.preflight), 'preflight.guardAddress');
  const transactionHash = normalizeHash(transactionHashFor(input.preflight), 'preflight.transactionHash');
  const installation = normalizedInstallation(input.installation, guardAddress);
  const recovery = normalizedRecovery(input.recovery);
  const execution = normalizedExecution(input.execution);
  const blockingReasons = blockingReasonsFor({
    plan: input.plan,
    preflight: input.preflight,
    installation,
    recovery,
    execution,
    kind,
  });
  const outcome = outcomeFor({
    plan: input.plan,
    preflight: input.preflight,
    phase,
    blockingReasons,
  });
  const receiptId =
    normalizeOptionalIdentifier(input.receiptId, 'receiptId') ??
    receiptIdFor({
      plan: input.plan,
      preflight: input.preflight,
      createdAt,
      transactionHash,
    });
  const interfaceId = kind === 'safe-module-guard'
    ? SAFE_GUARD_INTERFACE_IDS.moduleGuard
    : SAFE_GUARD_INTERFACE_IDS.transactionGuard;
  const canonicalPayload = {
    version: SAFE_GUARD_ADMISSION_RECEIPT_SPEC_VERSION,
    receiptId,
    createdAt,
    kind,
    phase,
    outcome,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    adapterKind: input.preflight.adapterKind,
    safeAddress: input.preflight.safeAddress,
    guardAddress,
    moduleAddress: isModulePreflight(input.preflight)
      ? input.preflight.moduleAddress
      : null,
    chainId: input.preflight.chainId,
    operation: input.preflight.operation,
    transactionHash,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    interfaceId,
    supportsErc165: installation.supportsErc165,
    supportsGuardInterface: installation.supportsGuardInterface,
    installation,
    recovery,
    execution,
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

export function safeGuardAdmissionReceiptLabel(
  receipt: SafeGuardAdmissionReceipt,
): string {
  return [
    `safe-guard-admission:${receipt.transactionHash}`,
    `kind:${receipt.kind}`,
    `phase:${receipt.phase}`,
    `outcome:${receipt.outcome}`,
  ].join(' / ');
}

export function safeGuardAdmissionDescriptor(): SafeGuardAdmissionDescriptor {
  return Object.freeze({
    version: SAFE_GUARD_ADMISSION_RECEIPT_SPEC_VERSION,
    kinds: SAFE_GUARD_ADMISSION_RECEIPT_KINDS,
    outcomes: SAFE_GUARD_ADMISSION_OUTCOMES,
    phases: SAFE_GUARD_ADMISSION_PHASES,
    interfaceIds: SAFE_GUARD_INTERFACE_IDS,
    standards: Object.freeze([
      'Safe Transaction Guard',
      'Safe Module Guard',
      'ERC-165',
      'ERC-1271',
      'Attestor admission receipt',
      'Attestor enforcement plane',
    ]),
  });
}
