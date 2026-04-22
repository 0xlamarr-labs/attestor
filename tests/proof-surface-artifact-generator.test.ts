import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROOF_SURFACE_ARTIFACT_BUNDLE_SPEC_VERSION,
  PROOF_SURFACE_ARTIFACT_SPEC_VERSION,
  PROOF_SURFACE_OUTPUT_SPEC_VERSION,
  RUNNABLE_PROOF_SCENARIO_IDS,
  buildProofSurfaceArtifactBundle,
  writeProofSurfaceArtifactBundle,
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function testBuildsDeterministicArtifactBundle(): void {
  const artifact = buildProofSurfaceArtifactBundle({
    generatedAt: '2026-04-22T12:08:00.000Z',
  });

  equal(
    artifact.manifest.version,
    PROOF_SURFACE_ARTIFACT_SPEC_VERSION,
    'Proof surface artifact: manifest version is stable',
  );
  equal(
    artifact.bundle.version,
    PROOF_SURFACE_ARTIFACT_BUNDLE_SPEC_VERSION,
    'Proof surface artifact: bundle version is stable',
  );
  equal(
    artifact.manifest.outputCount,
    RUNNABLE_PROOF_SCENARIO_IDS.length,
    'Proof surface artifact: manifest covers every runnable scenario',
  );
  deepEqual(
    artifact.manifest.scenarioIds,
    [...RUNNABLE_PROOF_SCENARIO_IDS],
    'Proof surface artifact: scenario order follows runnable ids',
  );
  deepEqual(
    artifact.manifest.decisions,
    { admit: 2, narrow: 0, review: 1, block: 1 },
    'Proof surface artifact: decision summary covers admit, review, and block',
  );
  deepEqual(
    artifact.manifest.packFamilies,
    { finance: 2, crypto: 2 },
    'Proof surface artifact: pack summary keeps finance and crypto as pack families',
  );
  ok(
    artifact.manifest.bundleDigest.startsWith('sha256:'),
    'Proof surface artifact: bundle digest is hash-shaped',
  );
  ok(
    artifact.summaryMarkdown.includes('deterministic local artifact'),
    'Proof surface artifact: summary says this is a deterministic local artifact',
  );
  ok(
    artifact.summaryMarkdown.includes('not a hosted console or public crypto HTTP route'),
    'Proof surface artifact: summary blocks hosted-console and public-crypto-route overclaims',
  );
}

function testWritesManifestBundleSummaryAndOutputs(): void {
  const outDir = mkdtempSync(join(tmpdir(), 'attestor-proof-surface-'));
  const written = writeProofSurfaceArtifactBundle({
    outDir,
    generatedAt: '2026-04-22T12:08:00.000Z',
  });

  ok(existsSync(written.manifestPath), 'Proof surface artifact: manifest is written');
  ok(existsSync(written.summaryPath), 'Proof surface artifact: summary is written');
  ok(existsSync(written.bundlePath), 'Proof surface artifact: bundle is written');
  equal(
    written.outputPaths.length,
    RUNNABLE_PROOF_SCENARIO_IDS.length,
    'Proof surface artifact: one output file is written per runnable scenario',
  );
  ok(
    written.outputPaths.every((path) => existsSync(path)),
    'Proof surface artifact: every output path exists',
  );

  const manifest = readJson<typeof written.manifest>(written.manifestPath);
  const bundle = readJson<{ readonly digest: string }>(written.bundlePath);
  const firstOutput = readJson<{
    readonly version: string;
    readonly digest: string;
    readonly source: { readonly scenarioId: string };
  }>(written.outputPaths[0] ?? '');

  equal(manifest.digest, written.manifest.digest, 'Proof surface artifact: manifest round trips');
  equal(bundle.digest, manifest.bundleDigest, 'Proof surface artifact: bundle digest matches manifest');
  equal(
    firstOutput.version,
    PROOF_SURFACE_OUTPUT_SPEC_VERSION,
    'Proof surface artifact: output file contains unified proof output',
  );
  equal(
    manifest.files.outputs[0]?.digest,
    firstOutput.digest,
    'Proof surface artifact: per-output digest matches manifest file ref',
  );
  equal(
    manifest.files.outputs[0]?.scenarioId,
    firstOutput.source.scenarioId,
    'Proof surface artifact: per-output scenario id matches manifest file ref',
  );
}

function testGeneratedAtControlsArtifactDigest(): void {
  const first = buildProofSurfaceArtifactBundle({
    generatedAt: '2026-04-22T12:08:00.000Z',
  });
  const second = buildProofSurfaceArtifactBundle({
    generatedAt: '2026-04-22T12:08:00.000Z',
  });
  const third = buildProofSurfaceArtifactBundle({
    generatedAt: '2026-04-22T12:09:00.000Z',
  });

  equal(first.manifest.digest, second.manifest.digest, 'Proof surface artifact: same inputs produce same manifest digest');
  equal(first.bundle.digest, second.bundle.digest, 'Proof surface artifact: same inputs produce same bundle digest');
  ok(first.manifest.digest !== third.manifest.digest, 'Proof surface artifact: generatedAt participates in manifest digest');
  ok(first.bundle.digest !== third.bundle.digest, 'Proof surface artifact: generatedAt participates in bundle digest');
}

function testRenderCommandWritesArtifacts(): void {
  const outDir = mkdtempSync(join(tmpdir(), 'attestor-proof-surface-cli-'));
  const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      'scripts/render-proof-surface.ts',
      '--out',
      outDir,
      '--generated-at',
      '2026-04-22T12:08:00.000Z',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  equal(result.status, 0, `Proof surface artifact CLI exits successfully: ${result.stderr}`);
  ok(
    result.stdout.includes('Attestor proof surface artifact created.'),
    'Proof surface artifact CLI: stdout confirms creation',
  );
  ok(
    existsSync(join(outDir, 'manifest.json')) &&
      existsSync(join(outDir, 'bundle.json')) &&
      existsSync(join(outDir, 'summary.md')),
    'Proof surface artifact CLI: expected top-level files are written',
  );
}

testBuildsDeterministicArtifactBundle();
testWritesManifestBundleSummaryAndOutputs();
testGeneratedAtControlsArtifactDigest();
testRenderCommandWritesArtifacts();

console.log(`Proof surface artifact generator tests: ${passed} passed, 0 failed`);
