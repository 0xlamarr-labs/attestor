import {
  describeControlPlaneSnapshot,
  restoreControlPlaneBackupSnapshot,
} from '../src/service/control-plane-backup.js';

function parseArgs(argv: string[]): {
  inputDir?: string;
  includeEphemeral: boolean;
  replaceExisting: boolean;
} {
  let inputDir: string | undefined;
  let includeEphemeral = false;
  let replaceExisting = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input-dir') {
      inputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--include-ephemeral') {
      includeEphemeral = true;
      continue;
    }
    if (token === '--replace-existing') {
      replaceExisting = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      console.log('Usage: npm run restore:control-plane -- --input-dir <dir> [--include-ephemeral] [--replace-existing]');
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { inputDir, includeEphemeral, replaceExisting };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inputDir) {
    throw new Error('--input-dir is required');
  }

  const snapshot = describeControlPlaneSnapshot(args.inputDir);
  console.log(`Restoring control-plane snapshot: ${args.inputDir}`);
  console.log(`Manifest integrity hash: ${snapshot.integrityHash}`);
  console.log(`Shared billing ledger configured at backup time: ${snapshot.manifest.sharedBillingLedgerConfigured}`);

  const result = await restoreControlPlaneBackupSnapshot({
    snapshotDir: args.inputDir,
    includeEphemeral: args.includeEphemeral,
    replaceExisting: args.replaceExisting,
  });

  console.log(`Restored components: ${result.restoredComponents.join(', ') || '(none)'}`);
  console.log(`Skipped components: ${result.skippedComponents.join(', ') || '(none)'}`);
}

main().catch((err) => {
  console.error(`control-plane restore failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
