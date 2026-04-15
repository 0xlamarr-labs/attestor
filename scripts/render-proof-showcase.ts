import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
}

function parseArgs(argv: string[]): ScriptArgs {
  let fromDir: string | null = null;
  let skipRun = false;
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
    }
  }
  return { fromDir, skipRun };
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

function latestRealProofDir(): string {
  const proofRoot = resolve('.attestor', 'proofs');
  if (!existsSync(proofRoot)) {
    throw new Error('No proof directory exists yet. Run scripts/real-db-proof.ts first.');
  }
  const latest = readdirSync(proofRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('real-pg-proof_'))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!latest) {
    throw new Error('No real PostgreSQL proof artifacts were found under .attestor/proofs/.');
  }
  return join(proofRoot, latest);
}

function copyArtifactIfPresent(sourceDir: string, destinationDir: string, name: string): void {
  const source = join(sourceDir, name);
  if (!existsSync(source)) return;
  cpSync(source, join(destinationDir, name));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fromDir && !args.skipRun) {
    console.log('\nGenerating a fresh real PostgreSQL-backed proof before rendering the showcase packet...\n');
    runRealProof();
  }

  const proofDir = args.fromDir ?? latestRealProofDir();
  const proofBaseName = proofDir.replaceAll('\\', '/').split('/').at(-1) ?? 'latest-proof';
  const showcaseRoot = resolve('.attestor', 'showcase');
  const packetDir = join(showcaseRoot, proofBaseName);
  const latestPacketDir = join(showcaseRoot, 'latest');
  const evidenceDir = join(packetDir, 'evidence');

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
  copyArtifactIfPresent(proofDir, evidenceDir, 'schema-attestation.json');
  copyArtifactIfPresent(proofDir, evidenceDir, 'trust-chain.json');
  copyArtifactIfPresent(proofDir, evidenceDir, 'ca-public.pem');

  const packet = buildProofShowcasePacket({
    proofDir: proofDir.replaceAll('\\', '/'),
    latestPacketDir: '.attestor/showcase/latest',
    kit,
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
