import assert from 'node:assert/strict';
import {
  AccountApiKeyServiceError,
  createAccountApiKeyService,
  type AccountApiKeyServiceDeps,
} from '../src/service/application/account-api-key-service.js';
import type { HostedAccountRecord } from '../src/service/account-store.js';
import type { HostedBillingEntitlementRecord } from '../src/service/billing-entitlement-store.js';
import { SELF_HOST_PLAN_ID } from '../src/service/plan-catalog.js';
import { TenantKeyStoreError, type TenantKeyRecord } from '../src/service/tenant-key-store.js';

const now = '2026-04-21T10:00:00.000Z';

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

function tenantKey(overrides: Partial<TenantKeyRecord> = {}): TenantKeyRecord {
  return {
    id: 'tkey_123',
    tenantId: 'tenant_123',
    tenantName: 'Acme',
    planId: SELF_HOST_PLAN_ID,
    monthlyRunQuota: 100,
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

function entitlement(overrides: Partial<HostedBillingEntitlementRecord> = {}): HostedBillingEntitlementRecord {
  return {
    id: 'ent_123',
    accountId: 'acct_123',
    tenantId: 'tenant_123',
    provider: 'manual',
    status: 'active',
    accessEnabled: true,
    effectivePlanId: SELF_HOST_PLAN_ID,
    requestedPlanId: SELF_HOST_PLAN_ID,
    monthlyRunQuota: 100,
    requestsPerWindow: null,
    asyncPendingJobsPerTenant: null,
    accountStatus: 'active',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: null,
    stripePriceId: null,
    stripeCheckoutSessionId: null,
    stripeInvoiceId: null,
    stripeInvoiceStatus: null,
    stripeEntitlementLookupKeys: [],
    stripeEntitlementFeatureIds: [],
    stripeEntitlementSummaryUpdatedAt: null,
    lastEventId: null,
    lastEventType: null,
    lastEventAt: null,
    effectiveAt: now,
    delinquentSince: null,
    reason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createDeps(overrides: Partial<AccountApiKeyServiceDeps> = {}): AccountApiKeyServiceDeps {
  const deps: AccountApiKeyServiceDeps = {
    findHostedAccountByIdState: async () => account(),
    findTenantRecordByTenantIdState: async () => ({
      id: 'tenant_123',
      tenantId: 'tenant_123',
      tenantName: 'Acme Tenant',
      planId: 'pro',
      monthlyRunQuota: 500,
      createdAt: now,
      updatedAt: now,
    }),
    listTenantKeyRecordsState: async () => ({
      records: [
        tenantKey({ id: 'tkey_123', tenantId: 'tenant_123' }),
        tenantKey({ id: 'tkey_other', tenantId: 'tenant_other' }),
      ],
      path: null,
    }),
    tenantKeyStorePolicy: () => ({ maxActiveKeysPerTenant: 2 }),
    SELF_HOST_PLAN_ID,
    issueTenantApiKeyState: async (input) => ({
      record: tenantKey({
        tenantId: input.tenantId,
        tenantName: input.tenantName,
        planId: input.planId ?? null,
        monthlyRunQuota: input.monthlyRunQuota ?? null,
      }),
      apiKey: 'atk_plaintext',
      path: null,
    }),
    rotateTenantApiKeyState: async () => ({
      previousRecord: tenantKey({ id: 'tkey_123', supersededByKeyId: 'tkey_new' }),
      record: tenantKey({ id: 'tkey_new', rotatedFromKeyId: 'tkey_123' }),
      apiKey: 'atk_rotated',
      path: null,
    }),
    setTenantApiKeyStatusState: async (_id, status) => ({
      record: tenantKey({ status }),
      path: null,
    }),
    revokeTenantApiKeyState: async () => ({
      record: tenantKey({ status: 'revoked', revokedAt: now }),
      path: null,
    }),
    syncHostedBillingEntitlementForTenant: async (tenantId, options) => entitlement({
      tenantId,
      lastEventType: options?.lastEventType ?? null,
      lastEventAt: options?.lastEventAt ?? null,
    }),
    now: () => now,
  };
  return {
    ...deps,
    ...overrides,
  };
}

async function testListFiltersTenantKeys(): Promise<void> {
  const service = createAccountApiKeyService(createDeps());
  const result = await service.list('acct_123');

  assert.deepEqual(result.keys.map((entry) => entry.id), ['tkey_123']);
  assert.equal(result.defaults.maxActiveKeysPerTenant, 2);
}

async function testIssueUsesTenantPlanAndSyncsEntitlement(): Promise<void> {
  const events: string[] = [];
  const service = createAccountApiKeyService(createDeps({
    issueTenantApiKeyState: async (input) => {
      events.push(`issue:${input.planId}:${input.monthlyRunQuota}:${input.tenantName}`);
      return {
        record: tenantKey({ planId: input.planId ?? null, monthlyRunQuota: input.monthlyRunQuota ?? null }),
        apiKey: 'atk_created',
        path: null,
      };
    },
    syncHostedBillingEntitlementForTenant: async (tenantId, options) => {
      events.push(`sync:${tenantId}:${options?.lastEventType}:${options?.lastEventAt}`);
      return entitlement({ tenantId });
    },
  }));

  const result = await service.issue('acct_123');

  assert.equal(result.apiKey, 'atk_created');
  assert.deepEqual(events, [
    'issue:pro:500:Acme Tenant',
    'sync:tenant_123:account.api_keys.issue:2026-04-21T10:00:00.000Z',
  ]);
}

async function testRotateRejectsForeignKey(): Promise<void> {
  const service = createAccountApiKeyService(createDeps());

  await assert.rejects(
    () => service.rotate('acct_123', 'tkey_other'),
    (error) => error instanceof AccountApiKeyServiceError
      && error.statusCode === 404
      && error.message === "API key 'tkey_other' was not found.",
  );
}

async function testTenantKeyStoreErrorsMapToConflicts(): Promise<void> {
  const service = createAccountApiKeyService(createDeps({
    setTenantApiKeyStatusState: async () => {
      throw new TenantKeyStoreError('LIMIT_EXCEEDED', 'too many active keys');
    },
  }));

  await assert.rejects(
    () => service.setStatus('acct_123', 'tkey_123', 'active'),
    (error) => error instanceof AccountApiKeyServiceError
      && error.statusCode === 409
      && error.message === 'too many active keys',
  );
}

await testListFiltersTenantKeys();
await testIssueUsesTenantPlanAndSyncsEntitlement();
await testRotateRejectsForeignKey();
await testTenantKeyStoreErrorsMapToConflicts();

console.log('Service account API key service tests: 4 passed, 0 failed');
