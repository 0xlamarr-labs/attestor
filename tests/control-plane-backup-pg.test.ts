import { strict as assert } from 'node:assert';
import EmbeddedPostgres from 'embedded-postgres';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  claimStripeBillingEvent,
  finalizeStripeBillingEvent,
  listBillingEvents,
  resetBillingEventLedgerForTests,
} from '../src/service/billing-event-ledger.js';
import {
  createControlPlaneBackupSnapshot,
  restoreControlPlaneBackupSnapshot,
} from '../src/service/control-plane-backup.js';
import {
  consumePipelineRunState,
  findHostedAccountByIdState,
  listTenantKeyRecordsState,
  listAdminAuditRecordsState,
  lookupAdminIdempotencyState,
  lookupProcessedStripeWebhookState,
  appendAdminAuditRecordState,
  recordAdminIdempotencyState,
  recordProcessedStripeWebhookState,
  provisionHostedAccountState,
  queryUsageLedgerState,
  resetSharedControlPlaneStoreForTests,
  restoreAdminAuditLogStoreSnapshot,
} from '../src/service/control-plane-store.js';

let passed = 0;

function ok(condition: boolean, message: string): void {
  assert(condition, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve TCP port.'));
        return;
      }
      const { port } = address;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(process.cwd(), '.attestor', 'control-plane-dr-pg-'));
  const snapshotDir = join(tempRoot, 'snapshot');
  const pgDataDir = join(tempRoot, 'pg');
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user: 'cp_backup_pg',
    password: 'cp_backup_pg',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  process.env.ATTESTOR_CONTROL_PLANE_PG_URL = `postgres://cp_backup_pg:cp_backup_pg@localhost:${pgPort}/attestor_control_plane`;
  process.env.ATTESTOR_BILLING_LEDGER_PG_URL = `postgres://cp_backup_pg:cp_backup_pg@localhost:${pgPort}/attestor_billing`;
  process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(tempRoot, 'admin-audit-log.json');
  process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(tempRoot, 'admin-idempotency.json');
  process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(tempRoot, 'stripe-webhooks.json');
  process.env.ATTESTOR_ADMIN_API_KEY = 'backup-test-admin';

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('attestor_control_plane');
  await pg.createDatabase('attestor_billing');

  await resetSharedControlPlaneStoreForTests();
  await resetBillingEventLedgerForTests();

  try {
    console.log('\n[Control-plane backup / restore — shared PG]');

    const provisioned = await provisionHostedAccountState({
      account: {
        accountName: 'Backup PG Co',
        contactEmail: 'ops@backup-pg.example',
        primaryTenantId: 'tenant-backup-pg',
      },
      key: {
        tenantId: 'tenant-backup-pg',
        tenantName: 'Backup PG Tenant',
        planId: 'starter',
      },
    });
    await consumePipelineRunState('tenant-backup-pg', 'starter', 100);

    await appendAdminAuditRecordState({
      actorType: 'admin_api_key',
      actorLabel: 'backup-test-admin',
      action: 'account.created',
      routeId: 'admin.accounts.create',
      accountId: provisioned.account.id,
      tenantId: 'tenant-backup-pg',
      tenantKeyId: provisioned.initialKey.id,
      planId: 'starter',
      monthlyRunQuota: 100,
      idempotencyKey: 'idem-backup-pg-1',
      requestHash: 'req_hash_backup_pg',
      metadata: { source: 'test' },
    });
    await recordAdminIdempotencyState({
      idempotencyKey: 'idem-backup-pg-1',
      routeId: 'admin.accounts.create',
      requestPayload: { accountId: provisioned.account.id },
      statusCode: 201,
      response: { ok: true, accountId: provisioned.account.id },
    });
    await recordProcessedStripeWebhookState({
      eventId: 'evt_webhook_backup_pg_1',
      eventType: 'invoice.paid',
      accountId: provisioned.account.id,
      stripeCustomerId: 'cus_backup_pg',
      stripeSubscriptionId: 'sub_backup_pg',
      outcome: 'applied',
      reason: null,
      rawPayload: '{"id":"evt_webhook_backup_pg_1"}',
    });
    const claim = await claimStripeBillingEvent({
      providerEventId: 'evt_billing_backup_pg_1',
      eventType: 'invoice.paid',
      rawPayload: '{"id":"evt_billing_backup_pg_1"}',
    });
    ok(claim.kind === 'claimed', 'Billing ledger: shared PG claim created');
    await finalizeStripeBillingEvent({
      providerEventId: 'evt_billing_backup_pg_1',
      outcome: 'applied',
      accountId: provisioned.account.id,
      tenantId: 'tenant-backup-pg',
      stripeCustomerId: 'cus_backup_pg',
      stripeSubscriptionId: 'sub_backup_pg',
      stripePriceId: 'price_starter_monthly',
      stripeInvoiceId: 'in_backup_pg_1',
      stripeInvoiceStatus: 'paid',
      stripeInvoiceCurrency: 'usd',
      stripeInvoiceAmountPaid: 5000,
      stripeInvoiceAmountDue: 0,
      accountStatusBefore: 'active',
      accountStatusAfter: 'active',
      billingStatusBefore: 'active',
      billingStatusAfter: 'active',
      mappedPlanId: 'starter',
      metadata: { paidAt: '2026-04-07T00:00:00.000Z' },
    });

    const backup = await createControlPlaneBackupSnapshot({
      snapshotDir,
      includeEphemeral: true,
    });
    ok(backup.manifest.sharedControlPlaneMode === 'postgres', 'Backup: shared control-plane mode recorded');
    ok(backup.manifest.components.some((entry) => entry.id === 'account_store' && entry.tier === 'shared_postgres' && entry.present), 'Backup: PG account snapshot present');
    ok(backup.manifest.components.some((entry) => entry.id === 'tenant_key_store' && entry.tier === 'shared_postgres' && entry.present), 'Backup: PG tenant key snapshot present');
    ok(backup.manifest.components.some((entry) => entry.id === 'usage_ledger' && entry.tier === 'shared_postgres' && entry.present), 'Backup: PG usage snapshot present');
    ok(backup.manifest.components.some((entry) => entry.id === 'admin_audit_log' && entry.tier === 'shared_postgres' && entry.present), 'Backup: PG admin audit snapshot present');
    ok(backup.manifest.components.some((entry) => entry.id === 'admin_idempotency_store' && entry.tier === 'ephemeral' && entry.present), 'Backup: PG admin idempotency snapshot present');
    ok(backup.manifest.components.some((entry) => entry.id === 'stripe_webhook_store' && entry.tier === 'ephemeral' && entry.present), 'Backup: PG webhook dedupe snapshot present');
    ok(backup.manifest.components.some((entry) => entry.id === 'billing_event_ledger' && entry.present), 'Backup: billing ledger snapshot present');

    await resetSharedControlPlaneStoreForTests();
    await resetBillingEventLedgerForTests();

    const restored = await restoreControlPlaneBackupSnapshot({
      snapshotDir,
      includeEphemeral: true,
      replaceExisting: true,
    });
    ok(restored.restoredComponents.includes('account_store'), 'Restore: shared PG account restored');
    ok(restored.restoredComponents.includes('tenant_key_store'), 'Restore: shared PG tenant keys restored');
    ok(restored.restoredComponents.includes('usage_ledger'), 'Restore: shared PG usage restored');
    ok(restored.restoredComponents.includes('billing_event_ledger'), 'Restore: shared billing ledger restored');
    ok(restored.restoredComponents.includes('admin_audit_log'), 'Restore: shared admin audit restored');
    ok(restored.restoredComponents.includes('admin_idempotency_store'), 'Restore: shared admin idempotency restored');
    ok(restored.restoredComponents.includes('stripe_webhook_store'), 'Restore: shared Stripe webhook dedupe restored');

    const restoredAccount = await findHostedAccountByIdState(provisioned.account.id);
    ok(Boolean(restoredAccount), 'Restore: hosted account recovered from PG snapshot');
    ok(restoredAccount?.primaryTenantId === 'tenant-backup-pg', 'Restore: account tenant preserved');

    const restoredKeys = (await listTenantKeyRecordsState()).records;
    ok(restoredKeys.length === 1, 'Restore: tenant key recovered from PG snapshot');
    ok(restoredKeys[0].id === provisioned.initialKey.id, 'Restore: tenant key id preserved');

    const restoredUsage = await queryUsageLedgerState({ tenantId: 'tenant-backup-pg' });
    ok(restoredUsage.length === 1, 'Restore: usage ledger recovered from PG snapshot');
    ok(restoredUsage[0].used === 1, 'Restore: usage count preserved');

    const restoredAudit = await listAdminAuditRecordsState();
    ok(restoredAudit.chainIntact === true, 'Restore: admin audit chain intact');
    ok(restoredAudit.records.length === 1, 'Restore: admin audit records recovered');

    let invalidAuditRejected = false;
    try {
      await restoreAdminAuditLogStoreSnapshot({
        version: 1,
        exportedAt: new Date().toISOString(),
        recordCount: restoredAudit.records.length,
        chainIntact: false,
        latestHash: restoredAudit.latestHash,
        records: restoredAudit.records.map((record, index) => index === 0
          ? { ...record, previousHash: 'tampered_previous_hash' }
          : record),
      }, { replaceExisting: true });
    } catch (err) {
      invalidAuditRejected = err instanceof Error && err.message.includes('invalid');
    }
    ok(invalidAuditRejected, 'Restore: invalid admin audit snapshot is rejected before import');

    const idempotencyLookup = await lookupAdminIdempotencyState({
      idempotencyKey: 'idem-backup-pg-1',
      routeId: 'admin.accounts.create',
      requestPayload: { accountId: provisioned.account.id },
    });
    ok(idempotencyLookup.kind === 'replay', 'Restore: admin idempotency restored');

    const webhookLookup = await lookupProcessedStripeWebhookState('evt_webhook_backup_pg_1', '{"id":"evt_webhook_backup_pg_1"}');
    ok(webhookLookup.kind === 'duplicate', 'Restore: stripe webhook dedupe restored');

    const restoredBillingEvents = await listBillingEvents({ accountId: provisioned.account.id, limit: 10 });
    ok(restoredBillingEvents.length === 1, 'Restore: billing ledger rows restored');
    ok(restoredBillingEvents[0].stripeInvoiceId === 'in_backup_pg_1', 'Restore: billing invoice id preserved');

    console.log(`  Control-plane backup PG tests: ${passed} passed, 0 failed\n`);
  } finally {
    await resetSharedControlPlaneStoreForTests();
    await resetBillingEventLedgerForTests();
    await pg.stop();
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    delete process.env.ATTESTOR_CONTROL_PLANE_PG_URL;
  }
}

run().catch((err) => {
  console.error('Control-plane backup PG test failed:', err);
  process.exit(1);
});
