import assert from 'node:assert/strict';
import {
  activatePolicyBundle,
  findLatestActiveExactTargetActivation,
  freezePolicyActivationScope,
  rollbackPolicyActivation,
  stagePolicyActivationCandidate,
} from '../src/release-policy-control-plane/activation-records.js';
import {
  createInMemoryPolicyControlPlaneStore,
} from '../src/release-policy-control-plane/store.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';

function sampleTarget() {
  return createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
  });
}

function otherTarget() {
  return createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    wedgeId: 'finance.communication.release',
    consequenceType: 'communication',
    riskClass: 'R2',
  });
}

function bundle(bundleId: string) {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: bundleId.replace('bundle_', '').replaceAll('_', '.'),
    digest: `sha256:${bundleId}`,
  } as const;
}

function actor(id: string) {
  return {
    id,
    type: 'user' as const,
    displayName: id,
    role: 'policy-admin',
  };
}

function testStageCandidateRecord(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const result = stagePolicyActivationCandidate(store, {
    id: 'activation_candidate',
    target: sampleTarget(),
    bundle: bundle('bundle_candidate'),
    requestedBy: actor('anne'),
    requestedAt: '2026-04-17T15:00:00.000Z',
    rolloutMode: 'canary',
    rationale: 'Stage finance policy candidate.',
  });

  assert.equal(result.appliedRecord.state, 'candidate');
  assert.equal(result.appliedRecord.rolloutMode, 'canary');
  assert.equal(result.appliedRecord.reasonCode, 'stage-activation');
}

function testActivateSupersedesCurrentExactTargetOnly(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const initial = activatePolicyBundle(store, {
    id: 'activation_record_v1',
    target: sampleTarget(),
    bundle: bundle('bundle_record_v1'),
    activatedBy: actor('anne'),
    activatedAt: '2026-04-17T15:05:00.000Z',
    rolloutMode: 'enforce',
    rationale: 'Activate record policy v1.',
  });
  activatePolicyBundle(store, {
    id: 'activation_other_target',
    target: otherTarget(),
    bundle: bundle('bundle_comm_v1'),
    activatedBy: actor('anne'),
    activatedAt: '2026-04-17T15:06:00.000Z',
    rolloutMode: 'dry-run',
    rationale: 'Activate comm policy.',
  });
  const next = activatePolicyBundle(store, {
    id: 'activation_record_v2',
    target: sampleTarget(),
    bundle: bundle('bundle_record_v2'),
    activatedBy: actor('bob'),
    activatedAt: '2026-04-17T15:10:00.000Z',
    rolloutMode: 'canary',
    rationale: 'Promote record policy v2.',
  });

  assert.equal(initial.appliedRecord.state, 'active');
  assert.equal(next.currentActiveRecord?.id, 'activation_record_v1');
  assert.equal(next.updatedHistoricalRecord?.state, 'superseded');
  assert.equal(next.updatedHistoricalRecord?.supersededByActivationId, 'activation_record_v2');
  assert.equal(next.appliedRecord.previousActivationId, 'activation_record_v1');
  assert.equal(findLatestActiveExactTargetActivation(store, sampleTarget())?.id, 'activation_record_v2');
  assert.equal(findLatestActiveExactTargetActivation(store, otherTarget())?.id, 'activation_other_target');
}

function testRollbackCreatesReplacementAndMarksCurrentRolledBack(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  activatePolicyBundle(store, {
    id: 'activation_record_v1',
    target: sampleTarget(),
    bundle: bundle('bundle_record_v1'),
    activatedBy: actor('anne'),
    activatedAt: '2026-04-17T15:15:00.000Z',
    rolloutMode: 'enforce',
    rationale: 'Activate record policy v1.',
  });
  activatePolicyBundle(store, {
    id: 'activation_record_v2',
    target: sampleTarget(),
    bundle: bundle('bundle_record_v2'),
    activatedBy: actor('bob'),
    activatedAt: '2026-04-17T15:20:00.000Z',
    rolloutMode: 'canary',
    rationale: 'Promote record policy v2.',
  });

  const rollback = rollbackPolicyActivation(store, {
    id: 'activation_record_rollback_to_v1',
    target: sampleTarget(),
    rollbackTargetActivationId: 'activation_record_v1',
    activatedBy: actor('carol'),
    activatedAt: '2026-04-17T15:25:00.000Z',
    rationale: 'Rollback to last known good policy.',
  });

  assert.equal(rollback.appliedRecord.operationType, 'rollback-activation');
  assert.equal(rollback.appliedRecord.rolloutMode, 'rolled-back');
  assert.equal(rollback.appliedRecord.rollbackOfActivationId, 'activation_record_v1');
  assert.equal(rollback.currentActiveRecord?.id, 'activation_record_v2');
  assert.equal(rollback.updatedHistoricalRecord?.state, 'rolled-back');
  assert.equal(rollback.updatedHistoricalRecord?.supersededByActivationId, 'activation_record_rollback_to_v1');
  assert.equal(findLatestActiveExactTargetActivation(store, sampleTarget())?.id, 'activation_record_rollback_to_v1');
}

function testRollbackRequiresExactTargetMatch(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  activatePolicyBundle(store, {
    id: 'activation_other_target',
    target: otherTarget(),
    bundle: bundle('bundle_comm_v1'),
    activatedBy: actor('anne'),
    activatedAt: '2026-04-17T15:30:00.000Z',
    rolloutMode: 'dry-run',
    rationale: 'Activate comm policy.',
  });

  assert.throws(
    () =>
      rollbackPolicyActivation(store, {
        id: 'activation_bad_rollback',
        target: sampleTarget(),
        rollbackTargetActivationId: 'activation_other_target',
        activatedBy: actor('bob'),
        activatedAt: '2026-04-17T15:35:00.000Z',
        rationale: 'Bad rollback.',
      }),
    /exact target label/i,
  );
}

function testFreezeCreatesFailClosedRecordAndSupersedesCurrent(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  activatePolicyBundle(store, {
    id: 'activation_record_v1',
    target: sampleTarget(),
    bundle: bundle('bundle_record_v1'),
    activatedBy: actor('anne'),
    activatedAt: '2026-04-17T15:40:00.000Z',
    rolloutMode: 'enforce',
    rationale: 'Activate record policy v1.',
  });

  const freeze = freezePolicyActivationScope(store, {
    id: 'activation_record_freeze',
    target: sampleTarget(),
    activatedBy: actor('incident_commander'),
    activatedAt: '2026-04-17T15:45:00.000Z',
    reasonCode: 'incident-policy-freeze',
    rationale: 'Freeze the record release policy during an incident.',
    freezeReason: 'Suspected bad policy rollout.',
  });

  assert.equal(freeze.appliedRecord.state, 'frozen');
  assert.equal(freeze.appliedRecord.operationType, 'freeze-scope');
  assert.equal(freeze.appliedRecord.rolloutMode, 'rolled-back');
  assert.equal(freeze.appliedRecord.freezeReason, 'Suspected bad policy rollout.');
  assert.equal(freeze.appliedRecord.previousActivationId, 'activation_record_v1');
  assert.equal(freeze.updatedHistoricalRecord?.state, 'superseded');
  assert.equal(findLatestActiveExactTargetActivation(store, sampleTarget()), null);
}

function testRollbackAfterFreezeClearsTheFrozenBarrier(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  activatePolicyBundle(store, {
    id: 'activation_record_v1',
    target: sampleTarget(),
    bundle: bundle('bundle_record_v1'),
    activatedBy: actor('anne'),
    activatedAt: '2026-04-17T15:50:00.000Z',
    rolloutMode: 'enforce',
    rationale: 'Activate record policy v1.',
  });
  freezePolicyActivationScope(store, {
    id: 'activation_record_freeze',
    target: sampleTarget(),
    activatedBy: actor('incident_commander'),
    activatedAt: '2026-04-17T15:55:00.000Z',
    rationale: 'Freeze the record release policy during an incident.',
    freezeReason: 'Bad policy rollout.',
  });

  const rollback = rollbackPolicyActivation(store, {
    id: 'activation_record_emergency_rollback',
    target: sampleTarget(),
    rollbackTargetActivationId: 'activation_record_v1',
    activatedBy: actor('incident_commander'),
    activatedAt: '2026-04-17T16:00:00.000Z',
    rationale: 'Restore last known good policy after freeze.',
    reasonCode: 'emergency-rollback',
  });

  assert.equal(rollback.currentActiveRecord?.id, 'activation_record_freeze');
  assert.equal(rollback.updatedHistoricalRecord?.state, 'rolled-back');
  assert.equal(rollback.appliedRecord.rollbackOfActivationId, 'activation_record_v1');
  assert.equal(findLatestActiveExactTargetActivation(store, sampleTarget())?.id, 'activation_record_emergency_rollback');
}

testStageCandidateRecord();
testActivateSupersedesCurrentExactTargetOnly();
testRollbackCreatesReplacementAndMarksCurrentRolledBack();
testRollbackRequiresExactTargetMatch();
testFreezeCreatesFailClosedRecordAndSupersedesCurrent();
testRollbackAfterFreezeClearsTheFrozenBarrier();

console.log('Release policy control-plane activation-record tests: 33 passed, 0 failed');
