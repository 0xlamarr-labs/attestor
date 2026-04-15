import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { VerificationKit } from '../src/signing/bundle.js';
import {
  buildProofShowcasePacket,
  renderProofShowcaseHtml,
  renderProofShowcaseMarkdown,
  type SchemaAttestationLike,
} from '../src/showcase/proof-showcase.js';

interface ScriptArgs {
  fromDir: string | null;
  skipRun: boolean;
  liveScenario: string | null;
}

function parseArgs(argv: string[]): ScriptArgs {
  let fromDir: string | null = null;
  let skipRun = false;
  let liveScenario: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skip-run') {
      skipRun = true;
      continue;
    }
    if (arg === '--from') {
      fromDir = argv[index + 1] ? resolve(argv[index + 1]) : null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--from=')) {
      fromDir = resolve(arg.slice('--from='.length));
      continue;
    }
    if (arg === '--live-scenario') {
      liveScenario = argv[index + 1] ? argv[index + 1] : null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--live-scenario=')) {
      liveScenario = arg.slice('--live-scenario='.length);
    }
  }
  return { fromDir, skipRun, liveScenario };
}

function realProofCommand(): { command: string; args: string[] } {
  const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return {
    command: process.execPath,
    args: [tsxCli, 'scripts/real-db-proof.ts'],
  };
}

function runRealProof(): void {
  const { command, args } = realProofCommand();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    const detail = result.error ? result.error.message : `status ${result.status ?? 'unknown'}`;
    throw new Error(`real-db-proof failed: ${detail}.`);
  }
}

function liveProofCommand(scenarioId: string): { command: string; args: string[] } {
  const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return {
    command: process.execPath,
    args: [tsxCli, 'src/financial/cli.ts', 'live-scenario', scenarioId],
  };
}

function runLiveScenario(scenarioId: string): void {
  const { command, args } = liveProofCommand(scenarioId);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    const detail = result.error ? result.error.message : `status ${result.status ?? 'unknown'}`;
    throw new Error(`live scenario failed: ${detail}.`);
  }
}

function latestRealProofDir(): string {
  const proofRoot = resolve('.attestor', 'proofs');
  if (!existsSync(proofRoot)) {
    throw new Error('No proof directory exists yet. Run scripts/real-db-proof.ts first.');
  }
  const latest = readdirSync(proofRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('real-pg-proof_'))
    .map((entry) => ({ name: entry.name, mtimeMs: statSync(join(proofRoot, entry.name)).mtimeMs }))
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .map((entry) => entry.name)
    .at(-1);
  if (!latest) {
    throw new Error('No real PostgreSQL proof artifacts were found under .attestor/proofs/.');
  }
  return join(proofRoot, latest);
}

function latestHybridProofDir(scenarioId: string | null = null): string {
  const runsRoot = resolve('.attestor-financial', 'runs');
  if (!existsSync(runsRoot)) {
    throw new Error('No live hybrid run directory exists yet. Run src/financial/cli.ts live-scenario first.');
  }
  const prefix = scenarioId ? `financial-live-${scenarioId}-` : 'financial-live-';
  const latest = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => ({ name: entry.name, mtimeMs: statSync(join(runsRoot, entry.name)).mtimeMs }))
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .map((entry) => entry.name)
    .at(-1);
  if (!latest) {
    throw new Error(`No live hybrid proof artifacts were found under .attestor-financial/runs/ for prefix "${prefix}".`);
  }
  return join(runsRoot, latest);
}

function inferProofContext(
  proofDir: string,
  explicitLiveScenario: string | null,
): { proofLabel: string; rerunCommand: string } {
  const baseName = proofDir.replaceAll('\\', '/').split('/').at(-1) ?? 'latest-proof';
  if (explicitLiveScenario || baseName.startsWith('financial-live-')) {
    const inferredScenario = explicitLiveScenario
      ?? baseName.match(/^financial-live-([a-z0-9_-]+)-/iu)?.[1]
      ?? 'counterparty';
    return {
      proofLabel: `Live hybrid proof run (${inferredScenario})`,
      rerunCommand: `npx tsx src/financial/cli.ts live-scenario ${inferredScenario}`,
    };
  }
  return {
    proofLabel: 'Real PostgreSQL-backed proof run',
    rerunCommand: 'npx tsx scripts/real-db-proof.ts',
  };
}

function copyArtifactIfPresent(sourceDir: string, destinationDir: string, name: string): void {
  const source = join(sourceDir, name);
  if (!existsSync(source)) return;
  cpSync(source, join(destinationDir, name));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fromDir && !args.skipRun) {
    if (args.liveScenario) {
      console.log(`\nGenerating a fresh live hybrid proof for scenario "${args.liveScenario}" before rendering the showcase packet...\n`);
      runLiveScenario(args.liveScenario);
    } else {
      console.log('\nGenerating a fresh real PostgreSQL-backed proof before rendering the showcase packet...\n');
      runRealProof();
    }
  }

  const proofDir = args.fromDir ?? (args.liveScenario ? latestHybridProofDir(args.liveScenario) : latestRealProofDir());
  const proofBaseName = proofDir.replaceAll('\\', '/').split('/').at(-1) ?? 'latest-proof';
  const showcaseRoot = resolve('.attestor', 'showcase');
  const packetDir = join(showcaseRoot, proofBaseName);
  const latestPacketDir = join(showcaseRoot, 'latest');
  const evidenceDir = join(packetDir, 'evidence');
  const proofContext = inferProofContext(proofDir, args.liveScenario);

  rmSync(packetDir, { recursive: true, force: true });
  mkdirSync(evidenceDir, { recursive: true });

  const kit = JSON.parse(readFileSync(join(proofDir, 'kit.json'), 'utf8')) as VerificationKit;
  const schemaAttestation = existsSync(join(proofDir, 'schema-attestation.json'))
    ? JSON.parse(readFileSync(join(proofDir, 'schema-attestation.json'), 'utf8')) as SchemaAttestationLike
    : null;

  copyArtifactIfPresent(proofDir, evidenceDir, 'kit.json');
  copyArtifactIfPresent(proofDir, evidenceDir, 'certificate.json');
  copyArtifactIfPresent(proofDir, evidenceDir, 'public-key.pem');
  copyArtifactIfPresent(proofDir, evidenceDir, 'reviewer-public.pem');
  copyArtifactIfPresent(proofDir, evidenceDir, 'verification-summary.json');
  copyArtifactIfPresent(proofDir, evidenceDir, 'bundle.json');
  copyArtifactIfPresent(proofDir, evidenceDir, 'schema-attestation.json');
  copyArtifactIfPresent(proofDir, evidenceDir, 'trust-chain.json');
  copyArtifactIfPresent(proofDir, evidenceDir, 'ca-public.pem');

  const packet = buildProofShowcasePacket({
    proofDir: proofDir.replaceAll('\\', '/'),
    latestPacketDir: '.attestor/showcase/latest',
    kit,
    proofLabel: proofContext.proofLabel,
    rerunCommand: proofContext.rerunCommand,
    schemaAttestation,
  });

  writeFileSync(join(packetDir, 'packet.json'), `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  writeFileSync(join(packetDir, 'README.md'), renderProofShowcaseMarkdown(packet), 'utf8');
  writeFileSync(join(packetDir, 'index.html'), renderProofShowcaseHtml(packet), 'utf8');

  rmSync(latestPacketDir, { recursive: true, force: true });
  cpSync(packetDir, latestPacketDir, { recursive: true });

  console.log('\nAttestor proof showcase packet created.\n');
  console.log(`  Source proof: ${proofDir}`);
  console.log(`  Packet:       ${packetDir}`);
  console.log(`  Latest alias: ${latestPacketDir}`);
  console.log(`  Markdown:     ${join(latestPacketDir, 'README.md')}`);
  console.log(`  HTML:         ${join(latestPacketDir, 'index.html')}`);
  console.log(`  JSON:         ${join(latestPacketDir, 'packet.json')}`);
  console.log('\nUse this to show a real Attestor result without opening the whole platform.\n');
}

main();
