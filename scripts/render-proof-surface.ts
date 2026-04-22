import {
  DEFAULT_PROOF_SURFACE_ARTIFACT_DIR,
  writeProofSurfaceArtifactBundle,
} from '../src/proof-surface/index.js';

interface ScriptArgs {
  readonly outDir: string | null;
  readonly generatedAt: string | null;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): ScriptArgs {
  let outDir: string | null = null;
  let generatedAt: string | null = null;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--out') {
      outDir = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg?.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
      continue;
    }
    if (arg === '--generated-at') {
      generatedAt = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg?.startsWith('--generated-at=')) {
      generatedAt = arg.slice('--generated-at='.length);
      continue;
    }
    throw new Error(`Unknown proof surface argument: ${arg}`);
  }

  return { outDir, generatedAt, help };
}

function printHelp(): void {
  console.log([
    'Render deterministic Attestor proof-surface artifacts.',
    '',
    'Usage:',
    '  npm run proof:surface',
    '  npm run proof:surface -- --out .attestor/proof-surface/latest',
    '  npm run proof:surface -- --generated-at 2026-04-22T12:08:00.000Z',
    '',
    'Options:',
    `  --out <dir>             Output directory. Default: ${DEFAULT_PROOF_SURFACE_ARTIFACT_DIR}`,
    '  --generated-at <iso>    Override the deterministic generatedAt timestamp.',
    '  --help                  Show this help.',
    '',
  ].join('\n'));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const written = writeProofSurfaceArtifactBundle({
    outDir: args.outDir,
    generatedAt: args.generatedAt,
  });

  console.log('\nAttestor proof surface artifact created.\n');
  console.log(`  Output dir: ${written.outDir}`);
  console.log(`  Manifest:   ${written.manifestPath}`);
  console.log(`  Summary:    ${written.summaryPath}`);
  console.log(`  Bundle:     ${written.bundlePath}`);
  for (const outputPath of written.outputPaths) {
    console.log(`  Output:     ${outputPath}`);
  }
  console.log(`\nManifest digest: ${written.manifest.digest}`);
  console.log('\nRe-run with `npm run proof:surface` to regenerate the local artifact set.\n');
}

try {
  main();
} catch (error) {
  console.error('\nProof surface artifact generation failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
