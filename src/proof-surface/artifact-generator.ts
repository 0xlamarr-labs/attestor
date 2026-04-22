import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import {
  PROOF_SURFACE_OUTPUT_DEFAULT_GENERATED_AT,
  RUNNABLE_PROOF_SCENARIO_IDS,
  runProofSurfaceScenarios,
  type CreateProofSurfaceOutputOptions,
  type ProofSurfaceOutput,
  type RunnableProofScenarioId,
} from './unified-output.js';
import type {
  ProofSurfaceDecision,
  ProofSurfacePackFamily,
} from './scenario-registry.js';

export const PROOF_SURFACE_ARTIFACT_SPEC_VERSION =
  'attestor.proof-surface.artifact.v1';
export const PROOF_SURFACE_ARTIFACT_BUNDLE_SPEC_VERSION =
  'attestor.proof-surface.artifact-bundle.v1';
export const DEFAULT_PROOF_SURFACE_ARTIFACT_DIR =
  '.attestor/proof-surface/latest';
const PROOF_SURFACE_ARTIFACT_FILES = [
  'manifest.json',
  'summary.md',
  'bundle.json',
  'outputs/*.json',
] as const;

export interface ProofSurfaceArtifactFileRef {
  readonly scenarioId: RunnableProofScenarioId;
  readonly path: string;
  readonly digest: string;
}

export interface ProofSurfaceArtifactManifest {
  readonly version: typeof PROOF_SURFACE_ARTIFACT_SPEC_VERSION;
  readonly generatedAt: string;
  readonly generator: 'attestor.proof-surface.local-artifact-generator';
  readonly outputCount: number;
  readonly scenarioIds: readonly RunnableProofScenarioId[];
  readonly decisions: Readonly<Record<ProofSurfaceDecision, number>>;
  readonly packFamilies: Readonly<Record<Exclude<ProofSurfacePackFamily, 'general'>, number>>;
  readonly files: {
    readonly manifest: 'manifest.json';
    readonly summary: 'summary.md';
    readonly bundle: 'bundle.json';
    readonly outputs: readonly ProofSurfaceArtifactFileRef[];
  };
  readonly bundleDigest: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface ProofSurfaceArtifactBundleFile {
  readonly version: typeof PROOF_SURFACE_ARTIFACT_BUNDLE_SPEC_VERSION;
  readonly generatedAt: string;
  readonly outputs: readonly ProofSurfaceOutput[];
  readonly digest: string;
}

export interface ProofSurfaceArtifactBundle {
  readonly manifest: ProofSurfaceArtifactManifest;
  readonly bundle: ProofSurfaceArtifactBundleFile;
  readonly outputs: readonly ProofSurfaceOutput[];
  readonly summaryMarkdown: string;
}

export interface BuildProofSurfaceArtifactBundleOptions
  extends CreateProofSurfaceOutputOptions {}

export interface WriteProofSurfaceArtifactBundleOptions
  extends BuildProofSurfaceArtifactBundleOptions {
  readonly outDir?: string | null;
}

export interface WrittenProofSurfaceArtifactBundle {
  readonly outDir: string;
  readonly manifestPath: string;
  readonly summaryPath: string;
  readonly bundlePath: string;
  readonly outputPaths: readonly string[];
  readonly manifest: ProofSurfaceArtifactManifest;
}

function canonicalObject<T extends CanonicalReleaseJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  const canonical = canonicalizeReleaseJson(value);
  return Object.freeze({
    canonical,
    digest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
  });
}

function normalizeGeneratedAt(value: string | null | undefined): string {
  const raw = value ?? PROOF_SURFACE_OUTPUT_DEFAULT_GENERATED_AT;
  const timestamp = new Date(raw);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Proof surface artifact generatedAt must be an ISO timestamp.');
  }
  return timestamp.toISOString();
}

function normalizeOutputDir(value: string | null | undefined): string {
  return resolve(value?.trim() || DEFAULT_PROOF_SURFACE_ARTIFACT_DIR);
}

function forwardSlashPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function decisionCounts(
  outputs: readonly ProofSurfaceOutput[],
): Readonly<Record<ProofSurfaceDecision, number>> {
  const counts: Record<ProofSurfaceDecision, number> = {
    admit: 0,
    narrow: 0,
    review: 0,
    block: 0,
  };
  for (const output of outputs) {
    counts[output.decision.actual] += 1;
  }
  return Object.freeze(counts);
}

function packFamilyCounts(
  outputs: readonly ProofSurfaceOutput[],
): Readonly<Record<Exclude<ProofSurfacePackFamily, 'general'>, number>> {
  const counts: Record<Exclude<ProofSurfacePackFamily, 'general'>, number> = {
    finance: 0,
    crypto: 0,
  };
  for (const output of outputs) {
    counts[output.source.packFamily] += 1;
  }
  return Object.freeze(counts);
}

function outputFileRef(output: ProofSurfaceOutput): ProofSurfaceArtifactFileRef {
  return Object.freeze({
    scenarioId: output.source.scenarioId,
    path: `outputs/${output.source.scenarioId}.json`,
    digest: output.digest,
  });
}

function bundleDigest(input: {
  readonly generatedAt: string;
  readonly outputs: readonly ProofSurfaceOutput[];
}): string {
  return canonicalObject({
    version: PROOF_SURFACE_ARTIFACT_BUNDLE_SPEC_VERSION,
    generatedAt: input.generatedAt,
    outputDigests: input.outputs.map((output) => output.digest),
  }).digest;
}

function buildManifest(input: {
  readonly generatedAt: string;
  readonly outputs: readonly ProofSurfaceOutput[];
  readonly bundleDigest: string;
}): ProofSurfaceArtifactManifest {
  const payload = {
    version: PROOF_SURFACE_ARTIFACT_SPEC_VERSION,
    generatedAt: input.generatedAt,
    generator: 'attestor.proof-surface.local-artifact-generator',
    outputCount: input.outputs.length,
    scenarioIds: input.outputs.map((output) => output.source.scenarioId),
    decisions: decisionCounts(input.outputs),
    packFamilies: packFamilyCounts(input.outputs),
    files: {
      manifest: 'manifest.json',
      summary: 'summary.md',
      bundle: 'bundle.json',
      outputs: input.outputs.map(outputFileRef),
    },
    bundleDigest: input.bundleDigest,
  } as const;
  const canonical = canonicalObject(payload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...payload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

function buildBundleFile(input: {
  readonly generatedAt: string;
  readonly outputs: readonly ProofSurfaceOutput[];
  readonly digest: string;
}): ProofSurfaceArtifactBundleFile {
  return Object.freeze({
    version: PROOF_SURFACE_ARTIFACT_BUNDLE_SPEC_VERSION,
    generatedAt: input.generatedAt,
    outputs: input.outputs,
    digest: input.digest,
  });
}

function renderCheckOutcome(output: ProofSurfaceOutput): string {
  return [
    output.checks.policy.outcome,
    output.checks.authority.outcome,
    output.checks.evidence.outcome,
  ].join(' / ');
}

export function renderProofSurfaceArtifactMarkdown(
  manifest: ProofSurfaceArtifactManifest,
  outputs: readonly ProofSurfaceOutput[],
): string {
  const lines = [
    '# Attestor Proof Surface Artifact',
    '',
    'A deterministic local artifact for the runnable Attestor proof scenarios.',
    '',
    `Generated: ${manifest.generatedAt}`,
    `Manifest digest: ${manifest.digest}`,
    `Bundle digest: ${manifest.bundleDigest}`,
    '',
    '## Scenario Outputs',
    '',
    '| Scenario | Pack | Decision | Checks | Digest |',
    '|---|---|---|---|---|',
    ...outputs.map((output) =>
      [
        `| ${output.source.scenarioId}`,
        output.source.packFamily,
        output.decision.actual,
        renderCheckOutcome(output),
        `${output.digest} |`,
      ].join(' | '),
    ),
    '',
    '## Files',
    '',
    '- `manifest.json` records the generated artifact set and file digests.',
    '- `bundle.json` contains every unified proof output in one machine-readable file.',
    '- `outputs/*.json` contains one canonical proof output per runnable scenario.',
    '',
    '## Local Verification',
    '',
    '- Re-run with `npm run proof:surface`.',
    '- Inspect each output digest and canonical JSON before treating the result as proof material.',
    '- This is a local artifact generator, not a hosted console or public crypto HTTP route.',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

export function buildProofSurfaceArtifactBundle(
  options: BuildProofSurfaceArtifactBundleOptions = {},
): ProofSurfaceArtifactBundle {
  const generatedAt = normalizeGeneratedAt(options.generatedAt);
  const outputs = runProofSurfaceScenarios({ generatedAt });
  const digest = bundleDigest({ generatedAt, outputs });
  const manifest = buildManifest({
    generatedAt,
    outputs,
    bundleDigest: digest,
  });
  const bundle = buildBundleFile({ generatedAt, outputs, digest });

  return Object.freeze({
    manifest,
    bundle,
    outputs,
    summaryMarkdown: renderProofSurfaceArtifactMarkdown(manifest, outputs),
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeProofSurfaceArtifactBundle(
  options: WriteProofSurfaceArtifactBundleOptions = {},
): WrittenProofSurfaceArtifactBundle {
  const outDir = normalizeOutputDir(options.outDir);
  const outputsDir = join(outDir, 'outputs');
  const artifact = buildProofSurfaceArtifactBundle(options);

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  if (!existsSync(outputsDir)) {
    mkdirSync(outputsDir, { recursive: true });
  }

  const manifestPath = join(outDir, 'manifest.json');
  const summaryPath = join(outDir, 'summary.md');
  const bundlePath = join(outDir, 'bundle.json');
  const outputPaths = artifact.outputs.map((output) =>
    join(outputsDir, `${output.source.scenarioId}.json`),
  );

  writeJson(manifestPath, artifact.manifest);
  writeJson(bundlePath, artifact.bundle);
  writeFileSync(summaryPath, artifact.summaryMarkdown, 'utf8');
  for (const output of artifact.outputs) {
    writeJson(join(outputsDir, `${output.source.scenarioId}.json`), output);
  }

  return Object.freeze({
    outDir: forwardSlashPath(outDir),
    manifestPath: forwardSlashPath(manifestPath),
    summaryPath: forwardSlashPath(summaryPath),
    bundlePath: forwardSlashPath(bundlePath),
    outputPaths: Object.freeze(outputPaths.map(forwardSlashPath)),
    manifest: artifact.manifest,
  });
}

export function proofSurfaceArtifactGeneratorDescriptor(): {
  readonly version: typeof PROOF_SURFACE_ARTIFACT_SPEC_VERSION;
  readonly defaultOutDir: typeof DEFAULT_PROOF_SURFACE_ARTIFACT_DIR;
  readonly scenarioIds: typeof RUNNABLE_PROOF_SCENARIO_IDS;
  readonly files: readonly ['manifest.json', 'summary.md', 'bundle.json', 'outputs/*.json'];
} {
  return Object.freeze({
    version: PROOF_SURFACE_ARTIFACT_SPEC_VERSION,
    defaultOutDir: DEFAULT_PROOF_SURFACE_ARTIFACT_DIR,
    scenarioIds: RUNNABLE_PROOF_SCENARIO_IDS,
    files: PROOF_SURFACE_ARTIFACT_FILES,
  });
}
