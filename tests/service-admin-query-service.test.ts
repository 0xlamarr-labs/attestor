import assert from 'node:assert/strict';
import {
  createAdminQueryService,
  type AdminQueryServiceDeps,
} from '../src/service/application/admin-query-service.js';
import type { HostedAccountRecord } from '../src/service/account-store.js';
import type { TenantKeyRecord } from '../src/service/tenant-key-store.js';

const now = '2026-04-21T10:00:00.000Z';

function tenantKey(overrides: Partial<TenantKeyRecord> = {}): TenantKeyRecord {
  return {
    id: 'tkey_123',
    tenantId: 'tenant_123',
    tenantName: 'Acme',
    planId: 'pro',
    monthlyRunQuota: 10,
    apiKeyHash: 'hash',
    apiKeyPreview: 'atk_1234...abcd',
    status: 'active',
    createdAt: now,
    lastUsedAt: null,
    deactivatedAt: null,
    revokedAt: null,
    rotatedFromKeyId: null,
    supersededByKeyId: null,
    supersededAt: null,
    recoveryEnvelope: null,
    ...overrides,
  };
}

function account(overrides: Partial<HostedAccountRecord> = {}): HostedAccountRecord {
  return {
    id: 'acct_123',
    accountName: 'Acme',
    contactEmail: 'ops@example.com',
    primaryTenantId: 'tenant_123',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    suspendedAt: null,
    archivedAt: null,
    billing: {
      provider: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
      stripePriceId: null,
      lastCheckoutSessionId: null,
      lastCheckoutCompletedAt: null,
      lastCheckoutPlanId: null,
      lastInvoiceId: null,
      lastInvoiceStatus: null,
      lastInvoiceCurrency: null,
      lastInvoiceAmountPaid: null,
      lastInvoiceAmountDue: null,
      lastInvoiceEventId: null,
      lastInvoiceEventType: null,
      lastInvoiceProcessedAt: null,
      lastInvoicePaidAt: null,
      delinquentSince: null,
      lastWebhookEventId: null,
      lastWebhookEventType: null,
      lastWebhookProcessedAt: null,
    },
    ...overrides,
  };
}

function createDeps(overrides: Partial<AdminQueryServiceDeps> = {}): AdminQueryServiceDeps {
  const deps: AdminQueryServiceDeps = {
    listTenantKeyRecordsState: async () => ({ records: [tenantKey()], path: null }),
    listHostedAccountsState: async () => ({ records: [account()], path: null }),
    findHostedAccountByIdState: async (id) => account({ id }),
    listAdminAuditRecordsState: async () => ({
      records: [],
      path: null,
      chainIntact: true,
      latestHash: 'hash_latest',
    }),
    listHostedBillingEntitlementsState: async () => ({ records: [], path: null }),
    listHostedEmailDeliveriesState: async () => ({ records: [], path: null }),
    listAsyncDeadLetterRecordsState: async () => ({ records: [], path: null }),
    queryUsageLedgerState: async () => [{
      tenantId: 'tenant_123',
      period: '2026-04',
      used: 7,
      updatedAt: now,
    }],
    findTenantRecordByTenantIdState: async () => tenantKey({ monthlyRunQuota: 10 }),
    findHostedAccountByTenantIdState: async () => account(),
  };
  return {
    ...deps,
    ...overrides,
  };
}

async function testQueryServiceDelegatesListReads(): Promise<void> {
  const service = createAdminQueryService(createDeps());

  const keys = await service.listTenantKeys();
  const accounts = await service.listHostedAccounts();
  const audit = await service.listAdminAuditRecords({ limit: 5 });

  assert.equal(keys.records[0].id, 'tkey_123');
  assert.equal(accounts.records[0].id, 'acct_123');
  assert.equal(audit.chainIntact, true);
  assert.equal(audit.latestHash, 'hash_latest');
}

async function testUsageReportEnrichesTenantAndAccountContext(): Promise<void> {
  const service = createAdminQueryService(createDeps());

  const records = await service.listUsage({ tenantId: 'tenant_123', period: '2026-04' });

  assert.deepEqual(records, [{
    tenantId: 'tenant_123',
    tenantName: 'Acme',
    accountId: 'acct_123',
    accountName: 'Acme',
    planId: 'pro',
    monthlyRunQuota: 10,
    meter: 'monthly_pipeline_runs',
    period: '2026-04',
    used: 7,
    remaining: 3,
    enforced: true,
    updatedAt: now,
  }]);
}

await testQueryServiceDelegatesListReads();
await testUsageReportEnrichesTenantAndAccountContext();

console.log('Service admin query service tests: 2 passed, 0 failed');
