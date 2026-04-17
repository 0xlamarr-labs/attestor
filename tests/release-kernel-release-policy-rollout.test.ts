import { strict as assert } from 'node:assert';
import {
  computeReleasePolicyCanaryBucket,
  createReleasePolicyRollout,
  RELEASE_POLICY_ROLLOUT_SPEC_VERSION,
  resolveReleasePolicyRollout,
} from '../src/release-kernel/release-policy-rollout.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

const context = {
  requestId: 'release-request-001',
  outputHash: 'sha256:output-001',
  requesterId: 'svc.reporting-bot',
  targetId: 'finance.reporting.record-store',
};

async function main(): Promise<void> {
  const enforce = createReleasePolicyRollout({
    mode: 'enforce',
    activatedAt: '2026-04-17T20:00:00.000Z',
  });
  equal(
    enforce.version,
    RELEASE_POLICY_ROLLOUT_SPEC_VERSION,
    'Release policy rollout: schema version is stable and stamped on rollout definitions',
  );
  equal(
    enforce.canaryPercentage,
    100,
    'Release policy rollout: enforce mode behaves like a fully enforced cohort',
  );
  equal(
    resolveReleasePolicyRollout(enforce, context).evaluationMode,
    'enforce',
    'Release policy rollout: enforce mode resolves to active enforcement',
  );

  const dryRun = createReleasePolicyRollout({
    mode: 'dry-run',
    activatedAt: '2026-04-17T20:05:00.000Z',
    notes: ['Shadow before deny.'],
  });
  const dryRunResolution = resolveReleasePolicyRollout(dryRun, context);
  equal(
    dryRunResolution.evaluationMode,
    'shadow',
    'Release policy rollout: dry-run mode keeps matching policies visible without enforcing them',
  );
  equal(
    dryRunResolution.reason,
    'dry-run',
    'Release policy rollout: dry-run resolutions preserve an explicit reason code',
  );

  const canary = createReleasePolicyRollout({
    mode: 'canary',
    canaryPercentage: 17,
    cohortKey: 'output-hash',
    cohortSalt: 'attestor.test.canary',
  });
  const bucketA = computeReleasePolicyCanaryBucket(canary, context);
  const bucketB = computeReleasePolicyCanaryBucket(canary, context);
  equal(
    bucketA,
    bucketB,
    'Release policy rollout: canary cohort assignment is deterministic for the same request context',
  );
  ok(
    bucketA >= 0 && bucketA < 10000,
    'Release policy rollout: canary bucket stays inside the 0-9999 range',
  );
  const canaryResolution = resolveReleasePolicyRollout(canary, context);
  equal(
    canaryResolution.canaryBucket,
    bucketA,
    'Release policy rollout: canary resolution surfaces the evaluated cohort bucket',
  );

  const canaryFull = createReleasePolicyRollout({
    mode: 'canary',
    canaryPercentage: 100,
  });
  equal(
    resolveReleasePolicyRollout(canaryFull, context).evaluationMode,
    'enforce',
    'Release policy rollout: a 100% canary behaves as effective enforcement',
  );

  const rolledBack = createReleasePolicyRollout({
    mode: 'rolled-back',
    fallbackPolicyId: 'finance.structured-record-release.v0',
  });
  const rolledBackResolution = resolveReleasePolicyRollout(rolledBack, context);
  equal(
    rolledBackResolution.evaluationMode,
    'shadow',
    'Release policy rollout: rolled-back mode defaults to shadow unless a caller explicitly selects a fallback policy',
  );
  equal(
    rolledBack.fallbackPolicyId,
    'finance.structured-record-release.v0',
    'Release policy rollout: rollback metadata can carry the intended fallback policy id',
  );

  console.log(`\nRelease kernel release-policy-rollout tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-policy-rollout tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
