import {
  createPolicyActivationRecord,
  type PolicyActivationRecord,
  type PolicyActivationOperationType,
} from './object-model.js';
import {
  policyActivationTargetLabel,
  type PolicyActivationTarget,
  type PolicyBundleReference,
} from './types.js';
import type { PolicyControlPlaneStore } from './store.js';
import type {
  ReleaseActorReference,
  ReleasePolicyRolloutMode,
} from '../release-layer/index.js';

/**
 * Activation and rollback lifecycle helpers.
 *
 * The store from Step 06 gives us durable persistence, but operators still need
 * a first-class way to model promotion, supersession, and rollback without
 * hand-assembling record mutations. This module turns those transitions into
 * explicit, repeatable lifecycle operations on top of the store contract.
 */

export const POLICY_ACTIVATION_LIFECYCLE_SPEC_VERSION =
  'attestor.policy-activation-lifecycle.v1';

export interface StagePolicyActivationInput {
  readonly id: string;
  readonly target: PolicyActivationTarget;
  readonly bundle: PolicyBundleReference;
  readonly requestedBy: ReleaseActorReference;
  readonly requestedAt: string;
  readonly rolloutMode: ReleasePolicyRolloutMode;
  readonly reasonCode?: string;
  readonly rationale: string;
}

export interface ActivatePolicyBundleInput {
  readonly id: string;
  readonly target: PolicyActivationTarget;
  readonly bundle: PolicyBundleReference;
  readonly activatedBy: ReleaseActorReference;
  readonly activatedAt: string;
  readonly rolloutMode: ReleasePolicyRolloutMode;
  readonly reasonCode?: string;
  readonly rationale: string;
}

export interface RollbackPolicyActivationInput {
  readonly id: string;
  readonly target: PolicyActivationTarget;
  readonly rollbackTargetActivationId: string;
  readonly activatedBy: ReleaseActorReference;
  readonly activatedAt: string;
  readonly rationale: string;
  readonly reasonCode?: string;
}

export interface PolicyActivationLifecycleResult {
  readonly version: typeof POLICY_ACTIVATION_LIFECYCLE_SPEC_VERSION;
  readonly operationType: PolicyActivationOperationType;
  readonly targetLabel: string;
  readonly appliedRecord: PolicyActivationRecord;
  readonly currentActiveRecord: PolicyActivationRecord | null;
  readonly updatedHistoricalRecord: PolicyActivationRecord | null;
  readonly rollbackTargetRecord: PolicyActivationRecord | null;
}

function exactTargetLabel(target: PolicyActivationTarget): string {
  return policyActivationTargetLabel(target);
}

function exactTargetActivations(
  store: PolicyControlPlaneStore,
  target: PolicyActivationTarget,
): readonly PolicyActivationRecord[] {
  const targetLabel = exactTargetLabel(target);
  return store
    .listActivations()
    .filter((record) => record.targetLabel === targetLabel);
}

export function findLatestExactTargetActivation(
  store: PolicyControlPlaneStore,
  target: PolicyActivationTarget,
): PolicyActivationRecord | null {
  return exactTargetActivations(store, target)[0] ?? null;
}

export function findLatestActiveExactTargetActivation(
  store: PolicyControlPlaneStore,
  target: PolicyActivationTarget,
): PolicyActivationRecord | null {
  return (
    exactTargetActivations(store, target).find((record) => record.state === 'active') ?? null
  );
}

function markHistoricalActivation(
  record: PolicyActivationRecord,
  state: Extract<PolicyActivationRecord['state'], 'superseded' | 'rolled-back'>,
  supersededByActivationId: string,
): PolicyActivationRecord {
  return createPolicyActivationRecord({
    id: record.id,
    state,
    operationType: record.operationType,
    target: record.target,
    bundle: record.bundle,
    activatedBy: record.activatedBy,
    activatedAt: record.activatedAt,
    rolloutMode: record.rolloutMode,
    reasonCode: record.reasonCode,
    rationale: record.rationale,
    previousActivationId: record.previousActivationId,
    supersededByActivationId,
    rollbackOfActivationId: record.rollbackOfActivationId,
    freezeReason: record.freezeReason,
  });
}

export function stagePolicyActivationCandidate(
  store: PolicyControlPlaneStore,
  input: StagePolicyActivationInput,
): PolicyActivationLifecycleResult {
  const candidate = store.upsertActivation(
    createPolicyActivationRecord({
      id: input.id,
      state: 'candidate',
      operationType: 'activate-bundle',
      target: input.target,
      bundle: input.bundle,
      activatedBy: input.requestedBy,
      activatedAt: input.requestedAt,
      rolloutMode: input.rolloutMode,
      reasonCode: input.reasonCode ?? 'stage-activation',
      rationale: input.rationale,
      previousActivationId: findLatestExactTargetActivation(store, input.target)?.id ?? null,
    }),
  );

  return Object.freeze({
    version: POLICY_ACTIVATION_LIFECYCLE_SPEC_VERSION,
    operationType: candidate.operationType,
    targetLabel: candidate.targetLabel,
    appliedRecord: candidate,
    currentActiveRecord: findLatestActiveExactTargetActivation(store, input.target),
    updatedHistoricalRecord: null,
    rollbackTargetRecord: null,
  });
}

export function activatePolicyBundle(
  store: PolicyControlPlaneStore,
  input: ActivatePolicyBundleInput,
): PolicyActivationLifecycleResult {
  const currentActive = findLatestActiveExactTargetActivation(store, input.target);
  const appliedRecord = store.upsertActivation(
    createPolicyActivationRecord({
      id: input.id,
      state: 'active',
      operationType: 'activate-bundle',
      target: input.target,
      bundle: input.bundle,
      activatedBy: input.activatedBy,
      activatedAt: input.activatedAt,
      rolloutMode: input.rolloutMode,
      reasonCode: input.reasonCode ?? 'promote-bundle',
      rationale: input.rationale,
      previousActivationId: currentActive?.id ?? null,
    }),
  );

  const updatedHistoricalRecord =
    currentActive && currentActive.id !== appliedRecord.id
      ? store.upsertActivation(
          markHistoricalActivation(
            currentActive,
            'superseded',
            appliedRecord.id,
          ),
        )
      : null;

  return Object.freeze({
    version: POLICY_ACTIVATION_LIFECYCLE_SPEC_VERSION,
    operationType: appliedRecord.operationType,
    targetLabel: appliedRecord.targetLabel,
    appliedRecord,
    currentActiveRecord: currentActive,
    updatedHistoricalRecord,
    rollbackTargetRecord: null,
  });
}

export function rollbackPolicyActivation(
  store: PolicyControlPlaneStore,
  input: RollbackPolicyActivationInput,
): PolicyActivationLifecycleResult {
  const rollbackTargetRecord = store.getActivation(input.rollbackTargetActivationId);
  if (!rollbackTargetRecord) {
    throw new Error(
      `Cannot rollback policy activation; target '${input.rollbackTargetActivationId}' was not found.`,
    );
  }
  if (rollbackTargetRecord.targetLabel !== exactTargetLabel(input.target)) {
    throw new Error(
      'Rollback policy activation target must match the exact target label of the rollback source.',
    );
  }

  const currentActive = findLatestActiveExactTargetActivation(store, input.target);
  const appliedRecord = store.upsertActivation(
    createPolicyActivationRecord({
      id: input.id,
      state: 'active',
      operationType: 'rollback-activation',
      target: input.target,
      bundle: rollbackTargetRecord.bundle,
      activatedBy: input.activatedBy,
      activatedAt: input.activatedAt,
      rolloutMode: 'rolled-back',
      reasonCode: input.reasonCode ?? 'rollback',
      rationale: input.rationale,
      previousActivationId: currentActive?.id ?? null,
      rollbackOfActivationId: rollbackTargetRecord.id,
    }),
  );

  const updatedHistoricalRecord =
    currentActive && currentActive.id !== appliedRecord.id
      ? store.upsertActivation(
          markHistoricalActivation(
            currentActive,
            'rolled-back',
            appliedRecord.id,
          ),
        )
      : null;

  return Object.freeze({
    version: POLICY_ACTIVATION_LIFECYCLE_SPEC_VERSION,
    operationType: appliedRecord.operationType,
    targetLabel: appliedRecord.targetLabel,
    appliedRecord,
    currentActiveRecord: currentActive,
    updatedHistoricalRecord,
    rollbackTargetRecord,
  });
}
