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

function readPackageJson(): {
  readonly version: string;
  readonly private: boolean;
  readonly scripts: Readonly<Record<string, string>>;
} {
  return JSON.parse(readProjectFile('package.json')) as {
    readonly version: string;
    readonly private: boolean;
    readonly scripts: Readonly<Record<string, string>>;
  };
}

function readPackageLock(): {
  readonly version: string;
  readonly packages: {
    readonly '': {
      readonly version: string;
    };
  };
} {
  return JSON.parse(readProjectFile('package-lock.json')) as {
    readonly version: string;
    readonly packages: {
      readonly '': {
        readonly version: string;
      };
    };
  };
}

function testEvaluationVersionTruth(): void {
  const pkg = readPackageJson();
  const lock = readPackageLock();

  assert.match(pkg.version, /^0\.1\.1-evaluation$/u, 'Evaluation release: package version is an evaluation pre-release');
  passed += 1;
  assert.equal(lock.version, pkg.version, 'Evaluation release: package-lock top-level version matches package.json');
  passed += 1;
  assert.equal(lock.packages[''].version, pkg.version, 'Evaluation release: package-lock root package version matches package.json');
  passed += 1;
  assert.equal(pkg.private, true, 'Evaluation release: package remains private and is not a public npm package');
  passed += 1;
}

function testReleaseNotesAreLinkedAndBounded(): void {
  const readme = readProjectFile('README.md');
  const packet = readProjectFile('docs', '00-evaluation', 'v0.1-evaluation-packet.md');
  const notes = readProjectFile('docs', '00-evaluation', 'v0.1.1-evaluation-release-notes.md');

  includes(readme, 'docs/00-evaluation/v0.1.1-evaluation-release-notes.md', 'Evaluation release: README links release notes');
  includes(packet, 'v0.1.1-evaluation-release-notes.md', 'Evaluation release: packet links release notes');
  includes(notes, '# Attestor v0.1.1-evaluation Release Notes', 'Evaluation release: release note title is stable');
  includes(notes, '**Release type:** GitHub pre-release / CI-backed evaluation baseline', 'Evaluation release: release type is explicit');
  includes(notes, '**Tag:** `v0.1.1-evaluation`', 'Evaluation release: tag name is explicit');
  includes(notes, '**Package version:** `0.1.1-evaluation`', 'Evaluation release: package version is explicit');
  includes(notes, 'CI-backed evaluation baseline', 'Evaluation release: purpose stays evaluation-focused');
  includes(notes, 'PROOF_DEGRADED', 'Evaluation release: release notes are explicit about degraded local proof verification');
  includes(notes, 'Evaluation Smoke', 'Evaluation release: CI smoke gate is documented');
  includes(notes, 'proof-surface', 'Evaluation release: proof-surface artifact is documented');
  includes(notes, 'idle-client shutdown errors', 'Evaluation release: shared authority pool lifecycle hardening is documented');
  includes(notes, 'GitHub Actions `Full Verify`', 'Evaluation release: full verify workflow evidence is documented');
}

function testReleaseNotesCommandsExist(): void {
  const notes = readProjectFile('docs', '00-evaluation', 'v0.1.1-evaluation-release-notes.md');
  const pkg = readPackageJson();
  const commandNames = new Set(
    [...notes.matchAll(/\bnpm run ([a-z0-9:_-]+)/giu)].map((match) => match[1]),
  );

  assert.ok(commandNames.size > 0, 'Evaluation release: release notes list npm run commands');
  passed += 1;

  for (const commandName of commandNames) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(pkg.scripts, commandName),
      `Evaluation release: package.json must define script ${commandName}`,
    );
    passed += 1;
  }
}

function testReleaseNotesDoNotOverclaim(): void {
  const notes = readProjectFile('docs', '00-evaluation', 'v0.1.1-evaluation-release-notes.md');

  includes(notes, 'Not a hosted public SaaS launch.', 'Evaluation release: no hosted SaaS overclaim');
  includes(notes, 'Not a public npm package release.', 'Evaluation release: no public npm overclaim');
  includes(notes, 'Not a completed customer-operated production deployment.', 'Evaluation release: no production deployment overclaim');
  includes(notes, 'Not market validation or paid customer adoption.', 'Evaluation release: no market validation overclaim');
  includes(notes, 'Not a security audit.', 'Evaluation release: no audit overclaim');
  excludes(notes, /\bgeneral availability\b/iu, 'Evaluation release: must not imply GA');
  excludes(notes, /\bproduction-ready\b/iu, 'Evaluation release: must not imply production ready');
  excludes(notes, /\bis a public npm package\b/iu, 'Evaluation release: must not imply public npm availability');
}

function testPackageRunnerIncludesReleaseNotesGuard(): void {
  const pkg = readPackageJson();

  assert.equal(
    pkg.scripts['test:evaluation-release-notes'],
    'tsx tests/evaluation-release-notes.test.ts',
    'Evaluation release: release notes guard is exposed as a package script',
  );
  passed += 1;
}

testEvaluationVersionTruth();
testReleaseNotesAreLinkedAndBounded();
testReleaseNotesCommandsExist();
testReleaseNotesDoNotOverclaim();
testPackageRunnerIncludesReleaseNotesGuard();

console.log(`Evaluation release notes tests: ${passed} passed, 0 failed`);
