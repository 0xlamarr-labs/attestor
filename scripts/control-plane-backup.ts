import { createControlPlaneBackupSnapshot } from '../src/service/control-plane-backup.js';

function parseArgs(argv: string[]): {
  outputDir?: string;
  includeEphemeral: boolean;
} {
  let outputDir: string | undefined;
  let includeEphemeral = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output-dir') {
      outputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--include-ephemeral') {
      includeEphemeral = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      console.log('Usage: npm run backup:control-plane -- [--output-dir <dir>] [--include-ephemeral]');
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { outputDir, includeEphemeral };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await createControlPlaneBackupSnapshot({
    snapshotDir: args.outputDir,
    includeEphemeral: args.includeEphemeral,
  });

  console.log(`Control-plane backup created: ${result.snapshotDir}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log(`Shared billing ledger configured: ${result.manifest.sharedBillingLedgerConfigured}`);
  for (const component of result.manifest.components) {
    console.log(
      `- ${component.id}: ${component.present ? 'present' : 'missing'}`
      + (component.snapshotPath ? ` -> ${component.snapshotPath}` : '')
      + (component.recordCount !== null ? ` (${component.recordCount} records)` : ''),
    );
  }
}

main().catch((err) => {
  console.error(`control-plane backup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
