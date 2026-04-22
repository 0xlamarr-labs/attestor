import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROOF_SURFACE_DECISIONS,
  RUNNABLE_PROOF_SCENARIO_IDS,
  buildProofSurfaceArtifactBundle,
  getProofScenario,
  proofScenarioRegistry,
  runProofSurfaceScenarios,
} from '../src/proof-surface/index.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  passed += 1;
}

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function projectFileExists(path: string): boolean {
  return existsSync(join(process.cwd(), path));
}

function packageJson(): {
  readonly scripts: Readonly<Record<string, string>>;
} {
  return JSON.parse(readProjectFile('package.json')) as {
    readonly scripts: Readonly<Record<string, string>>;
  };
}

function exportedSymbolNeedle(symbol: string): string {
  return symbol.includes('.')
    ? symbol.slice(symbol.lastIndexOf('.') + 1)
    : symbol;
}

function digestCanonical(canonical: string): string {
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function isDigestLike(value: string | null): boolean {
  return value === null || value.startsWith('sha256:') || /^[a-f0-9]{64}$/iu.test(value);
}

function assertNoPlaceholderLanguage(value: string, message: string): void {
  assert.doesNotMatch(
    value,
    /\b(mock-only|fake|placeholder|todo|coming soon|not implemented|first[- ]slice)\b/iu,
    message,
  );
  passed += 1;
}

function testRunnableOutputsMatchRegistryAndDecisionCoverage(): void {
  const outputs = runProofSurfaceScenarios({
    generatedAt: '2026-04-22T12:10:00.000Z',
  });
  const decisions = new Set(outputs.map((output) => output.decision.actual));

  deepEqual(
    outputs.map((output) => output.source.scenarioId),
    [...RUNNABLE_PROOF_SCENARIO_IDS],
    'Proof surface readiness: runnable output order follows runnable ids',
  );
  for (const decision of ['admit', 'review', 'block'] as const) {
    ok(decisions.has(decision), `Proof surface readiness: ${decision} decision remains covered`);
  }
  ok(PROOF_SURFACE_DECISIONS.includes('narrow'), 'Proof surface readiness: narrow remains a valid bounded decision even when no current scenario narrows');

  for (const output of outputs) {
    const scenario = getProofScenario(output.source.scenarioId);

    equal(output.decision.expected, scenario.expectedDecision, `Proof surface readiness: ${scenario.id} expected decision matches registry`);
    equal(output.decision.actual, scenario.expectedDecision, `Proof surface readiness: ${scenario.id} actual decision matches registry`);
    deepEqual(
      Object.keys(output.checks),
      ['policy', 'authority', 'evidence'],
      `Proof surface readiness: ${scenario.id} keeps the three shared checks`,
    );
    ok(output.proofMaterials.length > 0, `Proof surface readiness: ${scenario.id} exposes proof material`);
    ok(output.evidenceAnchors.length > 0, `Proof surface readiness: ${scenario.id} exposes evidence anchors`);
    equal(
      output.decision.failClosed,
      output.decision.actual === 'review' || output.decision.actual === 'block',
      `Proof surface readiness: ${scenario.id} fail-closed posture matches bounded decision`,
    );
    for (const anchor of output.evidenceAnchors) {
      ok(
        isDigestLike(anchor.digest),
        `Proof surface readiness: ${scenario.id} anchor digests are hash-shaped`,
      );
    }

    assertNoPlaceholderLanguage(
      [
        scenario.title,
        scenario.categoryEntryPoint,
        scenario.plainLanguageHook,
        scenario.expectedReason,
        scenario.customerValue,
        output.decision.reason,
        output.checks.policy.summary,
        output.checks.authority.summary,
        output.checks.evidence.summary,
      ].join('\n'),
      `Proof surface readiness: ${scenario.id} does not use placeholder scenario language`,
    );
  }
}

function testArtifactManifestProvidesVerifiableSubjectRefs(): void {
  const artifact = buildProofSurfaceArtifactBundle({
    generatedAt: '2026-04-22T12:10:00.000Z',
  });

  equal(
    artifact.manifest.outputCount,
    artifact.outputs.length,
    'Proof surface readiness: manifest output count matches outputs',
  );
  deepEqual(
    artifact.manifest.scenarioIds,
    artifact.outputs.map((output) => output.source.scenarioId),
    'Proof surface readiness: manifest scenario ids match outputs',
  );
  equal(
    artifact.manifest.bundleDigest,
    artifact.bundle.digest,
    'Proof surface readiness: manifest records bundle digest',
  );
  ok(artifact.manifest.digest.startsWith('sha256:'), 'Proof surface readiness: manifest digest is hash-shaped');
  ok(artifact.bundle.digest.startsWith('sha256:'), 'Proof surface readiness: bundle digest is hash-shaped');

  for (const output of artifact.outputs) {
    const fileRef = artifact.manifest.files.outputs.find(
      (candidate) => candidate.scenarioId === output.source.scenarioId,
    );
    ok(fileRef, `Proof surface readiness: manifest has file ref for ${output.source.scenarioId}`);
    equal(fileRef?.path, `outputs/${output.source.scenarioId}.json`, `Proof surface readiness: ${output.source.scenarioId} output path is deterministic`);
    equal(fileRef?.digest, output.digest, `Proof surface readiness: ${output.source.scenarioId} file digest matches output`);
    equal(output.digest, digestCanonical(output.canonical), `Proof surface readiness: ${output.source.scenarioId} digest matches canonical JSON`);
  }
}

function testEveryScenarioIsGroundedInRealSurfaceOrFixture(): void {
  const scripts = packageJson().scripts;

  for (const scenario of proofScenarioRegistry()) {
    ok(scenario.entryPoints.length > 0, `Proof surface readiness: ${scenario.id} has entry points`);
    ok(scenario.proofMaterials.length > 0, `Proof surface readiness: ${scenario.id} has proof materials`);

    for (const entryPoint of scenario.entryPoints) {
      equal(entryPoint.kind, 'package-surface', `Proof surface readiness: ${scenario.id} uses package-surface entry points`);
      equal(entryPoint.route, null, `Proof surface readiness: ${scenario.id} does not claim a hosted route`);
      ok(entryPoint.packageSubpath?.startsWith('attestor/'), `Proof surface readiness: ${scenario.id} entry point is on an Attestor package subpath`);
      ok(entryPoint.sourceFiles.length > 0, `Proof surface readiness: ${scenario.id} entry point has source files`);

      for (const sourceFile of entryPoint.sourceFiles) {
        ok(projectFileExists(sourceFile), `Proof surface readiness: ${scenario.id} source exists: ${sourceFile}`);
      }
      for (const exportedSymbol of entryPoint.exportedSymbols) {
        const needle = exportedSymbolNeedle(exportedSymbol);
        ok(
          entryPoint.sourceFiles.some((sourceFile) => readProjectFile(sourceFile).includes(needle)),
          `Proof surface readiness: ${scenario.id} exported symbol is grounded: ${exportedSymbol}`,
        );
      }
    }

    for (const material of scenario.proofMaterials) {
      assertNoPlaceholderLanguage(
        [material.label, material.source, material.verifyHint].join('\n'),
        `Proof surface readiness: ${scenario.id} proof material avoids placeholder language`,
      );
      if (material.source.startsWith('npm run ')) {
        for (const match of material.source.matchAll(/npm run ([a-z0-9:._-]+)/giu)) {
          ok(Boolean(scripts[match[1] ?? '']), `Proof surface readiness: ${scenario.id} command exists: npm run ${match[1]}`);
        }
      } else {
        ok(projectFileExists(material.source), `Proof surface readiness: ${scenario.id} proof material source exists: ${material.source}`);
      }
    }
  }
}

function testPublicDocsKeepOneProductAndAvoidOverclaims(): void {
  const readme = readProjectFile('README.md');
  const tracker = readProjectFile('docs', '02-architecture', 'proof-console-buildout.md');

  ok(readme.includes('One product. One platform core.'), 'Proof surface readiness: README keeps one-product product framing');
  ok(tracker.includes('Keep Attestor as one product with one platform core and modular packs.'), 'Proof surface readiness: tracker keeps one-product guardrail');
  ok(readme.includes('It is a local static proof surface; it does not start a hosted console or claim a public hosted crypto route.'), 'Proof surface readiness: README blocks hosted proof-surface overclaim');
  ok(tracker.includes('Do not describe crypto as generally available through a public hosted HTTP route'), 'Proof surface readiness: tracker blocks hosted crypto route overclaim');
  assert.doesNotMatch(readme, /\b\d+\s*\/\s*\d+\b/u, 'Proof surface readiness: README does not expose frozen step fractions');
  passed += 1;
  assert.doesNotMatch(readme, /\bfirst[- ]slice\b/iu, 'Proof surface readiness: README avoids stale first-slice posture');
  passed += 1;
}

function testReadinessGateIsWiredIntoVerification(): void {
  const scripts = packageJson().scripts;

  equal(
    scripts['test:proof-surface-readiness'],
    'tsx tests/proof-surface-readiness.test.ts',
    'Proof surface readiness: package script exposes readiness gate',
  );
  ok(
    scripts.test.includes('tsx tests/proof-surface-readiness.test.ts'),
    'Proof surface readiness: npm test runs readiness gate',
  );
  ok(
    scripts.verify.includes('npm run test:proof-surface-readiness'),
    'Proof surface readiness: npm run verify runs readiness gate',
  );
}

testRunnableOutputsMatchRegistryAndDecisionCoverage();
testArtifactManifestProvidesVerifiableSubjectRefs();
testEveryScenarioIsGroundedInRealSurfaceOrFixture();
testPublicDocsKeepOneProductAndAvoidOverclaims();
testReadinessGateIsWiredIntoVerification();

console.log(`Proof surface readiness tests: ${passed} passed, 0 failed`);
