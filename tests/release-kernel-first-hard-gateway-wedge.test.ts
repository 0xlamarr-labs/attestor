import { strict as assert } from 'node:assert';
import {
  FIRST_HARD_GATEWAY_WEDGE,
  firstHardGatewayWedge,
} from '../src/release-kernel/first-hard-gateway-wedge.js';

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
  const wedge = firstHardGatewayWedge();

  equal(
    wedge.id,
    'finance-structured-record-release',
    'First gateway wedge: the frozen first wedge targets finance structured record release',
  );
  equal(wedge.status, 'frozen', 'First gateway wedge: the initial wedge is frozen, not provisional');
  equal(wedge.consequenceType, 'record', 'First gateway wedge: the first hard gate is a record consequence');
  equal(wedge.defaultRiskClass, 'R4', 'First gateway wedge: the first hard gate assumes regulated-artifact discipline');
  ok(
    wedge.targetKinds.includes('record-store') && wedge.targetKinds.includes('artifact-registry'),
    'First gateway wedge: downstream targets are record stores and artifact registries',
  );
  ok(
    wedge.outputFocus.includes('report field updates') &&
      wedge.outputFocus.includes('filing preparation payloads'),
    'First gateway wedge: scope centers on structured reporting artifacts',
  );
  ok(
    wedge.downstreamBoundary.includes('No write, export, or filing-preparation handoff'),
    'First gateway wedge: the boundary is fail-closed on write or export',
  );
  ok(
    wedge.whyNow.some((reason) => reason.includes('EDGAR')) &&
      wedge.whyNow.some((reason) => reason.includes('structured')),
    'First gateway wedge: rationale is anchored in structured filing and reporting systems',
  );
  ok(
    wedge.explicitlyOutOfScope.includes('customer communication release as the first hard gate'),
    'First gateway wedge: communication is explicitly not the first hard gate',
  );
  equal(
    wedge.successCriteria.map((criterion) => criterion.id).join(','),
    'no-token-no-write,payload-binding,replay-safe,reviewable-evidence',
    'First gateway wedge: success criteria stay tied to real gateway properties',
  );
  equal(
    FIRST_HARD_GATEWAY_WEDGE.name,
    'AI output to structured financial record release',
    'First gateway wedge: exported constant and accessor agree on the chosen wedge',
  );

  console.log(`\nRelease kernel first-hard-gateway-wedge tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel first-hard-gateway-wedge tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
