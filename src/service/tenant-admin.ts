/**
 * Tenant Admin CLI — Hosted API onboarding first slice
 *
 * Usage:
 *   npm run tenant:keys -- list
 *   npm run tenant:keys -- issue --tenant-id tenant-pro --name Acme --plan pro --quota 1000
 *   npm run tenant:keys -- revoke --id tkey_...
 */

import { issueTenantApiKey, listTenantKeyRecords, revokeTenantApiKey } from './tenant-key-store.js';

function readFlag(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function printUsage(): void {
  console.log('Tenant Admin CLI');
  console.log('');
  console.log('Commands:');
  console.log('  list');
  console.log('  issue --tenant-id <id> --name <tenant name> [--plan <plan>] [--quota <n>]');
  console.log('  revoke --id <tenant-key-record-id>');
}

async function main() {
  const command = process.argv[2];

  if (!command || command === 'help' || command === '--help') {
    printUsage();
    process.exit(0);
  }

  if (command === 'list') {
    const { records, path } = listTenantKeyRecords();
    console.log(`Store: ${path}`);
    if (records.length === 0) {
      console.log('No tenant API keys issued yet.');
      return;
    }
    for (const record of records) {
      console.log([
        `id=${record.id}`,
        `tenant=${record.tenantId}`,
        `name="${record.tenantName}"`,
        `plan=${record.planId ?? 'community'}`,
        `quota=${record.monthlyRunQuota ?? 'unlimited'}`,
        `preview=${record.apiKeyPreview}`,
        `status=${record.status}`,
      ].join(' | '));
    }
    return;
  }

  if (command === 'issue') {
    const tenantId = readFlag('--tenant-id') ?? readFlag('--tenant');
    const tenantName = readFlag('--name');
    const planId = readFlag('--plan') ?? 'community';
    const quotaRaw = readFlag('--quota');
    const monthlyRunQuota = quotaRaw ? Number.parseInt(quotaRaw, 10) : null;

    if (!tenantId || !tenantName) {
      console.error('issue requires --tenant-id and --name');
      process.exit(1);
    }

    const { apiKey, record, path } = issueTenantApiKey({
      tenantId,
      tenantName,
      planId,
      monthlyRunQuota: Number.isFinite(monthlyRunQuota as number) ? monthlyRunQuota : null,
    });

    console.log(`Store: ${path}`);
    console.log(`Issued tenant key record ${record.id}`);
    console.log(`Tenant: ${record.tenantId} (${record.tenantName})`);
    console.log(`Plan: ${record.planId ?? 'community'}`);
    console.log(`Quota: ${record.monthlyRunQuota ?? 'unlimited'}`);
    console.log('');
    console.log('API key — show once and copy now:');
    console.log(apiKey);
    return;
  }

  if (command === 'revoke') {
    const id = readFlag('--id');
    if (!id) {
      console.error('revoke requires --id');
      process.exit(1);
    }
    const result = revokeTenantApiKey(id);
    if (!result.record) {
      console.error(`Tenant key record not found: ${id}`);
      process.exit(1);
    }
    console.log(`Store: ${result.path}`);
    console.log(`Revoked ${result.record.id} (${result.record.apiKeyPreview}) for tenant ${result.record.tenantId}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
