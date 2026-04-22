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

function testProofSurfaceIsFindableFromReadme(): void {
  const readme = readProjectFile('README.md');

  includes(
    readme,
    'docs/02-architecture/proof-console-buildout.md',
    'Proof surface docs: README links the proof surface tracker',
  );
  includes(
    readme,
    'npm run proof:surface',
    'Proof surface docs: README names the local proof-surface command',
  );
  includes(
    readme,
    '.attestor/proof-surface/latest/manifest.json',
    'Proof surface docs: README points evaluators at the local manifest',
  );
  includes(
    readme,
    'It is a local static proof surface; it does not start a hosted console or claim a public hosted crypto route.',
    'Proof surface docs: README keeps the proof surface local and avoids hosted-route claims',
  );
}

function testTrackerPreservesOneProductScope(): void {
  const tracker = readProjectFile('docs', '02-architecture', 'proof-console-buildout.md');

  includes(
    tracker,
    'The goal is not to add another product line.',
    'Proof surface docs: tracker blocks a new product line',
  );
  includes(
    tracker,
    'Keep Attestor as one product with one platform core and modular packs.',
    'Proof surface docs: tracker preserves one-product framing',
  );
  includes(
    tracker,
    'Treat finance and crypto scenarios as demonstrations of the same platform core, not as separate product identities.',
    'Proof surface docs: tracker blocks finance/crypto product split',
  );
}

function testTrackerBlocksOverclaimsAndMockMarketing(): void {
  const tracker = readProjectFile('docs', '02-architecture', 'proof-console-buildout.md');

  includes(
    tracker,
    'Do not ship mock-only marketing output.',
    'Proof surface docs: tracker blocks mock-only marketing demo posture',
  );
  includes(
    tracker,
    'Do not describe crypto as generally available through a public hosted HTTP route',
    'Proof surface docs: tracker keeps crypto hosted-route overclaim blocked',
  );
  includes(
    tracker,
    'Do not turn the proof surface into a wallet, custody platform, model runtime, agent runtime, orchestration layer, or generic dashboard.',
    'Proof surface docs: tracker keeps non-goals explicit',
  );
}

function testTrackerDefinesTheMentalModelAndVocabulary(): void {
  const tracker = readProjectFile('docs', '02-architecture', 'proof-console-buildout.md');

  includes(
    tracker,
    'Before consequence, there must be proof.',
    'Proof surface docs: tracker anchors the public mental model',
  );
  includes(
    tracker,
    'proposed consequence -> Attestor checks policy, authority, and evidence -> decision -> proof',
    'Proof surface docs: tracker keeps the operating model simple',
  );
  for (const term of [
    'Proposed consequence',
    'Policy check',
    'Authority check',
    'Evidence check',
    'Decision',
    'Proof material',
  ]) {
    includes(tracker, `| ${term} |`, `Proof surface docs: vocabulary includes ${term}`);
  }
}

function testFrozenPlanStartsNarrow(): void {
  const tracker = readProjectFile('docs', '02-architecture', 'proof-console-buildout.md');

  includes(tracker, '| Total frozen steps | 8 |', 'Proof surface docs: step count is explicit');
  includes(tracker, '| Completed | 8 |', 'Proof surface docs: all frozen proof-surface steps are complete');
  includes(tracker, '| 01 | complete | Define the proof surface purpose, scope, vocabulary, and guardrails |', 'Proof surface docs: step 01 is complete');
  includes(tracker, '| 02 | complete | Add the proof scenario registry |', 'Proof surface docs: scenario registry step is complete');
  includes(tracker, '| 03 | complete | Add finance proof scenarios |', 'Proof surface docs: finance proof scenario step is complete');
  includes(tracker, '| 04 | complete | Add crypto admission proof scenarios |', 'Proof surface docs: crypto proof scenario step is complete');
  includes(tracker, '| 05 | complete | Add unified proof output shape |', 'Proof surface docs: unified output step is complete');
  includes(tracker, '| 06 | complete | Add runnable local proof command or artifact generator |', 'Proof surface docs: local artifact generator step is complete');
  includes(tracker, '| 07 | complete | Add README "Run the proof" path |', 'Proof surface docs: README run-the-proof step is complete');
  includes(tracker, '| 08 | complete | Add proof-surface readiness and anti-drift gates |', 'Proof surface docs: readiness gate step is complete');
  includes(tracker, '`npm run proof:surface` renders a deterministic local artifact set', 'Proof surface docs: artifact generator command is named');
  includes(tracker, '`npm run test:proof-surface-readiness` now verifies runnable output order', 'Proof surface docs: readiness gate evidence is named');
  includes(tracker, 'No frozen proof-surface step remains.', 'Proof surface docs: completed track has no remaining frozen step');
  includes(tracker, 'no hosted-console/public-hosted-crypto-route overclaims', 'Proof surface docs: tracker avoids premature broad UI and route claims');
  excludes(tracker, /\bfirst[- ]slice\b/iu, 'Proof surface docs: tracker avoids stale first-slice language');
}

testProofSurfaceIsFindableFromReadme();
testTrackerPreservesOneProductScope();
testTrackerBlocksOverclaimsAndMockMarketing();
testTrackerDefinesTheMentalModelAndVocabulary();
testFrozenPlanStartsNarrow();

console.log(`Proof surface docs tests: ${passed} passed, 0 failed`);
