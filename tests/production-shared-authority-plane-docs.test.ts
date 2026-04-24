import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function includes(content: string, expected: string, message: string): void {
  assert.ok(
    content.includes(expected),
    `${message}\nExpected to find: ${expected}`,
  );
  passed += 1;
}

function excludes(content: string, unexpected: RegExp, message: string): void {
  assert.doesNotMatch(content, unexpected, message);
  passed += 1;
}

function testTrackerIsLinkedFromCurrentTruthSources(): void {
  const readme = readProjectFile('README.md');
  const systemOverview = readProjectFile('docs', '02-architecture', 'system-overview.md');
  const readiness = readProjectFile('docs', '08-deployment', 'production-readiness.md');
  const runtimeHardening = readProjectFile('docs', '02-architecture', 'production-runtime-hardening-buildout.md');

  includes(
    readme,
    'docs/02-architecture/production-shared-authority-plane-buildout.md',
    'Shared authority docs: README links the new tracker',
  );
  includes(
    systemOverview,
    'Production shared authority plane buildout',
    'Shared authority docs: system overview points at the active frontier',
  );
  includes(
    readiness,
    '../02-architecture/production-shared-authority-plane-buildout.md',
    'Shared authority docs: production readiness links the new tracker',
  );
  includes(
    runtimeHardening,
    '[Production shared authority plane buildout](production-shared-authority-plane-buildout.md)',
    'Shared authority docs: completed hardening tracker points to the new shared-store tracker',
  );
}

function testTrackerFreezesTheCutLineCleanly(): void {
  const tracker = readProjectFile(
    'docs',
    '02-architecture',
    'production-shared-authority-plane-buildout.md',
  );

  includes(
    tracker,
    'one Attestor platform core',
    'Shared authority docs: tracker preserves one-product framing',
  );
  includes(
    tracker,
    'Do not add a new hosted crypto route as part of shared-runtime work.',
    'Shared authority docs: tracker blocks accidental crypto-route widening',
  );
  includes(
    tracker,
    'PostgreSQL-backed shared state for authoritative release and policy records',
    'Shared authority docs: tracker fixes the shared authority storage model',
  );
  includes(
    tracker,
    'Redis stays in coordination roles',
    'Shared authority docs: tracker keeps Redis in coordination roles',
  );
  includes(
    tracker,
    '| Total frozen steps | 9 |',
    'Shared authority docs: tracker freezes the step count',
  );
  includes(
    tracker,
    '| Completed | 5 |',
    'Shared authority docs: tracker records the completed shared token/evidence step',
  );
  includes(
    tracker,
    '| 01 | complete | Define the production-shared authority-plane scope, cut line, and storage model |',
    'Shared authority docs: step 01 is complete',
  );
  includes(
    tracker,
    '| 02 | complete | Add shared release-authority PostgreSQL substrate |',
    'Shared authority docs: step 02 is complete',
  );
  includes(
    tracker,
    '| 03 | complete | Add shared release decision log store |',
    'Shared authority docs: step 03 is complete',
  );
  includes(
    tracker,
    '| 04 | complete | Add shared release reviewer queue store and claim discipline |',
    'Shared authority docs: step 04 is complete',
  );
  includes(
    tracker,
    '| 05 | complete | Add shared release token introspection and evidence-pack stores |',
    'Shared authority docs: step 05 is complete',
  );
  includes(
    tracker,
    '| 06 | pending | Add shared degraded-mode and policy-control-plane authority stores |',
    'Shared authority docs: step 06 is now the next engineering step',
  );
  includes(
    tracker,
    'ATTESTOR_RELEASE_AUTHORITY_PG_URL',
    'Shared authority docs: tracker names the dedicated release-authority PostgreSQL env',
  );
  includes(
    tracker,
    'Carry the audit gaps forward on every remaining step',
    'Shared authority docs: tracker carries the audit gap guard into future steps',
  );
}

function testTrackerKeepsCurrentRuntimeTruthHonest(): void {
  const tracker = readProjectFile(
    'docs',
    '02-architecture',
    'production-shared-authority-plane-buildout.md',
  );
  const readiness = readProjectFile('docs', '08-deployment', 'production-readiness.md');

  includes(
    tracker,
    'The repository already proves the first two lines. It does not yet prove the third.',
    'Shared authority docs: tracker states the current runtime boundary honestly',
  );
  includes(
    tracker,
    '`single-node-durable`',
    'Shared authority docs: tracker keeps the currently proven profile visible',
  );
  includes(
    readiness,
    'The current repository proves `single-node-durable` restart recovery.',
    'Shared authority docs: production readiness still records the proven posture',
  );
  excludes(
    tracker,
    /\bfirst[- ]slice\b/iu,
    'Shared authority docs: tracker should not reintroduce stale first-slice language',
  );
}

testTrackerIsLinkedFromCurrentTruthSources();
testTrackerFreezesTheCutLineCleanly();
testTrackerKeepsCurrentRuntimeTruthHonest();

console.log(`Production shared authority plane docs tests: ${passed} passed, 0 failed`);
