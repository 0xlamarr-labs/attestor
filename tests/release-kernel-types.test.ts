import { strict as assert } from 'node:assert';
import {
  CONSEQUENCE_TYPES,
  CONSEQUENCE_TYPE_PROFILES,
  RISK_CLASSES,
  RISK_CLASS_PROFILES,
  RELEASE_DECISION_STATUSES,
  RELEASE_DECISION_TERMINAL_STATUSES,
  consequenceTypeLabel,
  defaultReviewAuthorityForRiskClass,
  isConsequenceType,
  isRiskClass,
} from '../src/release-kernel/types.js';

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
  equal(CONSEQUENCE_TYPES.length, 4, 'Release kernel: exactly four canonical consequence types are defined');
  ok(isConsequenceType('record'), 'Release kernel: record is a valid consequence type');
  ok(isConsequenceType('decision-support'), 'Release kernel: decision-support is a valid consequence type');
  ok(!isConsequenceType('filing'), 'Release kernel: filing is not treated as a top-level consequence type');
  equal(consequenceTypeLabel('communication'), 'Communication', 'Release kernel: consequence labels are human-readable');
  equal(CONSEQUENCE_TYPE_PROFILES.record.examples[0], 'report field update', 'Release kernel: record consequence examples stay finance-useful without becoming finance-only');

  equal(RISK_CLASSES.length, 5, 'Release kernel: five canonical risk classes are defined');
  ok(isRiskClass('R4'), 'Release kernel: R4 is a valid risk class');
  ok(!isRiskClass('R5'), 'Release kernel: R5 is not a valid risk class');
  equal(RISK_CLASS_PROFILES.R0.defaultReleasePath, 'advisory', 'Release kernel: R0 remains advisory by default');
  equal(RISK_CLASS_PROFILES.R1.defaultReleasePath, 'auto-accept-eligible', 'Release kernel: R1 is auto-accept eligible by default');
  equal(RISK_CLASS_PROFILES.R2.defaultReleasePath, 'policy-gated', 'Release kernel: R2 is policy-gated by default');
  equal(RISK_CLASS_PROFILES.R3.defaultReviewAuthority.mode, 'named-reviewer', 'Release kernel: R3 requires a named reviewer by default');
  equal(defaultReviewAuthorityForRiskClass('R4').mode, 'dual-approval', 'Release kernel: R4 defaults to dual approval');
  equal(defaultReviewAuthorityForRiskClass('R4').minimumReviewerCount, 2, 'Release kernel: R4 requires two reviewers by default');

  ok(RELEASE_DECISION_STATUSES.includes('accepted'), 'Release kernel: accepted is a valid decision status');
  ok(RELEASE_DECISION_STATUSES.includes('review-required'), 'Release kernel: review-required is a valid decision status');
  ok(RELEASE_DECISION_TERMINAL_STATUSES.includes('revoked'), 'Release kernel: revoked is treated as terminal');
  ok(!RELEASE_DECISION_TERMINAL_STATUSES.includes('hold'), 'Release kernel: hold is not treated as terminal');

  console.log(`\nRelease kernel type tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel type tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
