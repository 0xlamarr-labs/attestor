import { strict as assert } from 'node:assert';
import {
  consequenceRolloutProfile,
  CONSEQUENCE_ROLLOUT_PROFILES,
  hardGateEligibleConsequenceTypes,
  orderedConsequenceRolloutProfiles,
} from '../src/release-kernel/consequence-rollout.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

async function main(): Promise<void> {
  equal(
    orderedConsequenceRolloutProfiles().map((profile) => profile.consequenceType).join(','),
    'record,communication,action,decision-support',
    'Consequence rollout: rollout order is record first, then communication, action, and decision-support',
  );

  const record = consequenceRolloutProfile('record');
  equal(record.rolloutMode, 'hard-gate-first', 'Consequence rollout: record is the first hard-gate path');
  equal(record.enforcementMode, 'signed-envelope-verify', 'Consequence rollout: record uses signed-envelope verification');
  ok(record.contractRequirements.requiresIdempotencyKey, 'Consequence rollout: record requires idempotency');
  ok(record.contractRequirements.requiresSingleUseRelease, 'Consequence rollout: record requires single-use release');
  ok(record.evidenceRequirements.requiresDurableEvidence, 'Consequence rollout: record requires durable evidence');
  ok(
    record.defaultTargetKinds.includes('record-store') && record.defaultTargetKinds.includes('artifact-registry'),
    'Consequence rollout: record binds to record stores and artifact registries',
  );

  const communication = consequenceRolloutProfile('communication');
  equal(
    communication.rolloutMode,
    'shadow-first-then-hard-gate',
    'Consequence rollout: communication starts in shadow mode before hard gating',
  );
  ok(
    communication.contractRequirements.requiresRecipientBinding,
    'Consequence rollout: communication requires explicit recipient binding',
  );
  ok(
    communication.evidenceRequirements.requiresDownstreamReceipt,
    'Consequence rollout: communication expects downstream send receipt evidence',
  );

  const action = consequenceRolloutProfile('action');
  equal(
    action.enforcementMode,
    'pre-execution-authorize',
    'Consequence rollout: action is enforced as pre-execution authorization',
  );
  ok(action.contractRequirements.requiresSingleUseRelease, 'Consequence rollout: action is single-use by default');
  ok(
    !action.contractRequirements.allowsBatchRelease,
    'Consequence rollout: action does not allow batch release by default',
  );

  const decisionSupport = consequenceRolloutProfile('decision-support');
  equal(
    decisionSupport.rolloutMode,
    'advisory-first-until-boundary',
    'Consequence rollout: decision-support stays advisory until a concrete downstream boundary exists',
  );
  ok(
    !decisionSupport.hardGateEligible,
    'Consequence rollout: decision-support is not hard-gate eligible by default',
  );
  ok(
    decisionSupport.contractRequirements.allowsBatchRelease,
    'Consequence rollout: decision-support can remain batch-oriented while advisory',
  );

  equal(
    hardGateEligibleConsequenceTypes().join(','),
    'record,communication,action',
    'Consequence rollout: only record, communication, and action are hard-gate eligible today',
  );

  equal(
    Object.keys(CONSEQUENCE_ROLLOUT_PROFILES).sort().join(','),
    'action,communication,decision-support,record',
    'Consequence rollout: every shared consequence type has an explicit rollout profile',
  );

  console.log(`\nRelease kernel consequence-rollout tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel consequence-rollout tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
