import { strict as assert } from 'node:assert';
import {
  orderedRiskControlProfiles,
  riskClassesRequiringHumanReview,
  riskControlProfile,
} from '../src/release-kernel/risk-controls.js';

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
    orderedRiskControlProfiles().map((profile) => profile.riskClass).join(','),
    'R0,R1,R2,R3,R4',
    'Risk controls: every shared risk class has an explicit control profile in order',
  );

  const r0 = riskControlProfile('R0');
  equal(r0.review.mode, 'auto', 'Risk controls: R0 stays auto-review only');
  equal(r0.review.failureDisposition, 'observe', 'Risk controls: R0 failures are observed, not blocked');
  equal(r0.token.minimumEnforcement, 'none', 'Risk controls: R0 does not require token enforcement');
  equal(r0.evidence.retentionClass, 'ephemeral', 'Risk controls: R0 uses ephemeral retention');

  const r2 = riskControlProfile('R2');
  ok(
    r2.deterministicChecks.includes('capability-boundary') &&
      r2.deterministicChecks.includes('consequence-hash-integrity'),
    'Risk controls: R2 requires bounded capability and consequence hash checks',
  );
  equal(r2.review.failureDisposition, 'hold', 'Risk controls: R2 failures default to hold');
  equal(r2.token.minimumEnforcement, 'required', 'Risk controls: R2 requires release-token enforcement');
  ok(r2.token.requiresReplayLedger, 'Risk controls: R2 begins replay-ledger requirements');

  const r3 = riskControlProfile('R3');
  equal(r3.review.mode, 'named-reviewer', 'Risk controls: R3 requires a named reviewer');
  ok(r3.review.requiresNamedReviewer, 'Risk controls: R3 keeps reviewer identity explicit');
  equal(
    r3.token.minimumEnforcement,
    'required-with-introspection',
    'Risk controls: R3 requires introspectable token enforcement',
  );
  ok(
    r3.deterministicChecks.includes('trace-grade-regression'),
    'Risk controls: R3 requires trace-grade regression checks',
  );
  ok(r3.evidence.requiresDurableEvidencePack, 'Risk controls: R3 requires a durable evidence pack');

  const r4 = riskControlProfile('R4');
  equal(r4.review.mode, 'dual-approval', 'Risk controls: R4 requires dual approval');
  equal(r4.evidence.retentionClass, 'regulated', 'Risk controls: R4 maps to regulated retention');
  ok(
    r4.deterministicChecks.includes('provenance-binding') &&
      r4.deterministicChecks.includes('downstream-receipt-reconciliation'),
    'Risk controls: R4 requires provenance and downstream receipt reconciliation',
  );
  ok(
    r4.evidence.requiresDownstreamReceipt,
    'Risk controls: R4 requires downstream receipt evidence for regulated release',
  );
  equal(r4.token.maxTtlSeconds, 180, 'Risk controls: R4 keeps the shortest default token TTL');

  equal(
    riskClassesRequiringHumanReview().join(','),
    'R3,R4',
    'Risk controls: only R3 and R4 require human review by default',
  );

  console.log(`\nRelease kernel risk-controls tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel risk-controls tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
