import { strict as assert } from 'node:assert';
import EmbeddedPostgres from 'embedded-postgres';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendAdminAuditRecord,
  listAdminAuditRecords,
  resetAdminAuditLogForTests,
} from '../src/service/admin-audit-log.js';
import {
  lookupAdminIdempotency,
  recordAdminIdempotency,
  resetAdminIdempotencyStoreForTests,
} from '../src/service/admin-idempotency-store.js';
import {
  claimStripeBillingEvent,
  finalizeStripeBillingEvent,
  listBillingEvents,
  resetBillingEventLedgerForTests,
} from '../src/service/billing-event-ledger.js';
import {
  findHostedBillingEntitlementByAccountId,
  resetHostedBillingEntitlementStoreForTests,
  upsertHostedBillingEntitlement,
} from '../src/service/billing-entitlement-store.js';
import {
  createControlPlaneBackupSnapshot,
  restoreControlPlaneBackupSnapshot,
} from '../src/service/control-plane-backup.js';
import {
  createHostedAccount,
  findHostedAccountById,
  resetAccountStoreForTests,
} from '../src/service/account-store.js';
import {
  createAccountUser,
  findAccountUserByEmail,
  resetAccountUserStoreForTests,
} from '../src/service/account-user-store.js';
import {
  findAccountSessionByToken,
  issueAccountSession,
  resetAccountSessionStoreForTests,
} from '../src/service/account-session-store.js';
import {
  issueTenantApiKey,
  listTenantKeyRecords,
  resetTenantKeyStoreForTests,
} from '../src/service/tenant-key-store.js';
import {
  consumePipelineRun,
  queryUsageLedger,
  resetUsageMeter,
} from '../src/service/usage-meter.js';
import {
  lookupProcessedStripeWebhook,
  recordProcessedStripeWebhook,
  resetStripeWebhookStoreForTests,
} from '../src/service/stripe-webhook-store.js';

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
  const tempRoot = mkdtempSync(join(process.cwd(), '.attestor', 'control-plane-dr-'));
  const snapshotDir = join(tempRoot, 'snapshot');
  const billingPgDir = join(tempRoot, 'billing-pg');
  const billingPgPort = await reservePort();
  const billingPg = new EmbeddedPostgres({
    databaseDir: billingPgDir,
    user: 'cp_backup',
    password: 'cp_backup',
    port: billingPgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(tempRoot, 'accounts.json');
  process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH = join(tempRoot, 'account-users.json');
  process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH = join(tempRoot, 'account-sessions.json');
  process.env.ATTESTOR_TENANT_KEY_STORE_PATH = join(tempRoot, 'tenant-keys.json');
  process.env.ATTESTOR_USAGE_LEDGER_PATH = join(tempRoot, 'usage-ledger.json');
  process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH = join(tempRoot, 'billing-entitlements.json');
  process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(tempRoot, 'admin-audit-log.json');
  process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(tempRoot, 'admin-idempotency.json');
  process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(tempRoot, 'stripe-webhooks.json');
  process.env.ATTESTOR_ADMIN_API_KEY = 'backup-test-admin';

  await billingPg.initialise();
  await billingPg.start();
  await billingPg.createDatabase('attestor_billing');
  process.env.ATTESTOR_BILLING_LEDGER_PG_URL = `postgres://cp_backup:cp_backup@localhost:${billingPgPort}/attestor_billing`;

  resetAccountStoreForTests();
  resetAccountUserStoreForTests();
  resetAccountSessionStoreForTests();
  resetTenantKeyStoreForTests();
  resetUsageMeter();
  resetHostedBillingEntitlementStoreForTests();
  resetAdminAuditLogForTests();
  resetAdminIdempotencyStoreForTests();
  resetStripeWebhookStoreForTests();
  await resetBillingEventLedgerForTests();

  try {
    console.log('\n[Control-plane backup / restore]');

    const account = createHostedAccount({
      accountName: 'Backup Co',
      contactEmail: 'ops@backup.example',
      primaryTenantId: 'tenant-backup',
    }).record;
    const ownerUser = createAccountUser({
      accountId: account.id,
      email: 'owner@backup.example',
      displayName: 'Backup Owner',
      password: 'BackupOwnerPass123!',
      role: 'account_admin',
    }).record;
    const ownerSession = issueAccountSession({
      accountId: account.id,
      accountUserId: ownerUser.id,
      role: ownerUser.role,
    });
    const issued = issueTenantApiKey({
      tenantId: 'tenant-backup',
      tenantName: 'Backup Tenant',
      planId: 'starter',
    });
    upsertHostedBillingEntitlement({
      account,
      currentPlanId: 'starter',
      currentMonthlyRunQuota: 100,
      lastEventId: 'evt_entitlement_backup_1',
      lastEventType: 'manual.provisioning',
      lastEventAt: '2026-04-07T00:00:00.000Z',
    });
    consumePipelineRun('tenant-backup', 'starter', 100);
    appendAdminAuditRecord({
      actorType: 'admin_api_key',
      actorLabel: 'backup-test-admin',
      action: 'account.created',
      routeId: 'admin.accounts.create',
      accountId: account.id,
      tenantId: 'tenant-backup',
      tenantKeyId: issued.record.id,
      planId: 'starter',
      monthlyRunQuota: 100,
      idempotencyKey: 'idem-backup-1',
      requestHash: 'req_hash_backup',
      metadata: { source: 'test' },
    });
    recordAdminIdempotency({
      idempotencyKey: 'idem-backup-1',
      routeId: 'admin.accounts.create',
      requestPayload: { accountId: account.id },
      statusCode: 201,
      response: { ok: true, accountId: account.id },
    });
    recordProcessedStripeWebhook({
      eventId: 'evt_webhook_backup_1',
      eventType: 'invoice.paid',
      accountId: account.id,
      stripeCustomerId: 'cus_backup',
      stripeSubscriptionId: 'sub_backup',
      outcome: 'applied',
      reason: null,
      rawPayload: '{"id":"evt_webhook_backup_1"}',
    });
    const claim = await claimStripeBillingEvent({
      providerEventId: 'evt_billing_backup_1',
      eventType: 'invoice.paid',
      rawPayload: '{"id":"evt_billing_backup_1"}',
    });
    ok(claim.kind === 'claimed', 'Billing ledger: claim created');
    await finalizeStripeBillingEvent({
      providerEventId: 'evt_billing_backup_1',
      outcome: 'applied',
      accountId: account.id,
      tenantId: 'tenant-backup',
      stripeCustomerId: 'cus_backup',
      stripeSubscriptionId: 'sub_backup',
      stripePriceId: 'price_starter_monthly',
      stripeInvoiceId: 'in_backup_1',
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
    ok(backup.manifest.components.some((entry) => entry.id === 'account_store' && entry.present), 'Backup: account store present');
    ok(backup.manifest.components.some((entry) => entry.id === 'account_user_store' && entry.present), 'Backup: account user store present');
    ok(backup.manifest.components.some((entry) => entry.id === 'tenant_key_store' && entry.present), 'Backup: tenant key store present');
    ok(backup.manifest.components.some((entry) => entry.id === 'usage_ledger' && entry.present), 'Backup: usage ledger present');
    ok(backup.manifest.components.some((entry) => entry.id === 'billing_entitlement_store' && entry.present), 'Backup: billing entitlement store present');
    ok(backup.manifest.components.some((entry) => entry.id === 'admin_audit_log' && entry.present), 'Backup: admin audit present');
    ok(backup.manifest.components.some((entry) => entry.id === 'admin_idempotency_store' && entry.present), 'Backup: admin idempotency present');
    ok(backup.manifest.components.some((entry) => entry.id === 'stripe_webhook_store' && entry.present), 'Backup: webhook store present');
    ok(backup.manifest.components.some((entry) => entry.id === 'account_session_store' && entry.present), 'Backup: account session store present');
    const ledgerComponent = backup.manifest.components.find((entry) => entry.id === 'billing_event_ledger');
    ok(Boolean(ledgerComponent?.present), 'Backup: shared billing ledger exported');
    ok(ledgerComponent?.recordCount === 1, 'Backup: shared billing ledger record count captured');

    resetAccountStoreForTests();
    resetAccountUserStoreForTests();
    resetAccountSessionStoreForTests();
    resetTenantKeyStoreForTests();
    resetUsageMeter();
    resetHostedBillingEntitlementStoreForTests();
    resetAdminAuditLogForTests();
    resetAdminIdempotencyStoreForTests();
    resetStripeWebhookStoreForTests();
    await resetBillingEventLedgerForTests();

    const restored = await restoreControlPlaneBackupSnapshot({
      snapshotDir,
      includeEphemeral: true,
      replaceExisting: true,
    });
    ok(restored.restoredComponents.includes('account_store'), 'Restore: account store restored');
    ok(restored.restoredComponents.includes('account_user_store'), 'Restore: account user store restored');
    ok(restored.restoredComponents.includes('account_session_store'), 'Restore: account session store restored');
    ok(restored.restoredComponents.includes('billing_entitlement_store'), 'Restore: billing entitlement store restored');
    ok(restored.restoredComponents.includes('billing_event_ledger'), 'Restore: billing ledger restored');

    const restoredAccount = findHostedAccountById(account.id);
    ok(Boolean(restoredAccount), 'Restore: hosted account recovered');
    ok(restoredAccount?.primaryTenantId === 'tenant-backup', 'Restore: account tenant recovered');

    const restoredKeys = listTenantKeyRecords().records;
    ok(restoredKeys.length === 1, 'Restore: tenant key recovered');
    ok(restoredKeys[0].id === issued.record.id, 'Restore: tenant key id preserved');

    const restoredUser = findAccountUserByEmail('owner@backup.example');
    ok(Boolean(restoredUser), 'Restore: account user recovered');
    ok(restoredUser?.id === ownerUser.id, 'Restore: account user id preserved');

    const restoredSession = findAccountSessionByToken(ownerSession.sessionToken);
    ok(Boolean(restoredSession), 'Restore: account session recovered');
    ok(restoredSession?.accountUserId === ownerUser.id, 'Restore: account session user preserved');

    const restoredUsage = queryUsageLedger({ tenantId: 'tenant-backup' });
    ok(restoredUsage.length === 1, 'Restore: usage ledger recovered');
    ok(restoredUsage[0].used === 1, 'Restore: usage count preserved');

    const restoredEntitlement = findHostedBillingEntitlementByAccountId(account.id).record;
    ok(Boolean(restoredEntitlement), 'Restore: billing entitlement recovered');
    ok(restoredEntitlement?.effectivePlanId === 'starter', 'Restore: billing entitlement plan preserved');

    const restoredAudit = listAdminAuditRecords();
    ok(restoredAudit.chainIntact === true, 'Restore: admin audit chain intact');
    ok(restoredAudit.records.length === 1, 'Restore: admin audit records recovered');

    const idempotencyLookup = lookupAdminIdempotency({
      idempotencyKey: 'idem-backup-1',
      routeId: 'admin.accounts.create',
      requestPayload: { accountId: account.id },
    });
    ok(idempotencyLookup.kind === 'replay', 'Restore: admin idempotency restored');

    const webhookLookup = lookupProcessedStripeWebhook('evt_webhook_backup_1', '{"id":"evt_webhook_backup_1"}');
    ok(webhookLookup.kind === 'duplicate', 'Restore: stripe webhook dedupe store restored');

    const restoredBillingEvents = await listBillingEvents({ accountId: account.id, limit: 10 });
    ok(restoredBillingEvents.length === 1, 'Restore: billing ledger rows restored');
    ok(restoredBillingEvents[0].stripeInvoiceId === 'in_backup_1', 'Restore: billing invoice id preserved');

    console.log(`  Control-plane backup tests: ${passed} passed, 0 failed\n`);
  } finally {
    resetAccountStoreForTests();
    resetAccountUserStoreForTests();
    resetAccountSessionStoreForTests();
    resetTenantKeyStoreForTests();
    resetUsageMeter();
    resetHostedBillingEntitlementStoreForTests();
    resetAdminAuditLogForTests();
    resetAdminIdempotencyStoreForTests();
    resetStripeWebhookStoreForTests();
    await resetBillingEventLedgerForTests();
    try { await billingPg.stop(); } catch {}
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Control-plane backup test failed:', err);
  process.exit(1);
});
