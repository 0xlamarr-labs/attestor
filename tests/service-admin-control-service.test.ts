import assert from 'node:assert/strict';
import {
  AdminControlServiceError,
  createAdminControlService,
  type AdminControlServiceDeps,
} from '../src/service/application/admin-control-service.js';
import type { HostedAccountRecord } from '../src/service/account-store.js';
import type { HostedBillingEntitlementRecord } from '../src/service/billing-entitlement-store.js';
import { DEFAULT_HOSTED_PLAN_ID, type HostedPlanDefinition, type ResolvedPlanSpec } from '../src/service/plan-catalog.js';
import { SecretEnvelopeError } from '../src/service/secret-envelope.js';
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
    planId: 'pro',
    monthlyRunQuota: 1000,
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

const proPlan: HostedPlanDefinition = {
  id: 'pro',
  displayName: 'Pro',
  description: 'Pro',
  defaultStripeTrialDays: null,
  defaultMonthlyRunQuota: 1000,
  defaultPipelineRequestsPerWindow: 100,
  defaultAsyncPendingJobsPerTenant: 10,
  defaultAsyncActiveJobsPerTenant: 2,
  defaultAsyncDispatchWeight: 1,
  defaultForHostedProvisioning: true,
  intendedFor: 'hosted',
};

function resolvedPlan(overrides: Partial<ResolvedPlanSpec> = {}): ResolvedPlanSpec {
  return {
    plan: proPlan,
    planId: 'pro',
    monthlyRunQuota: 1000,
    knownPlan: true,
    quotaSource: 'plan_default',
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
    effectivePlanId: 'pro',
    requestedPlanId: 'pro',
    monthlyRunQuota: 1000,
    requestsPerWindow: 100,
    asyncPendingJobsPerTenant: 10,
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

function createDeps(overrides: Partial<AdminControlServiceDeps> = {}): AdminControlServiceDeps {
  const baseAccount = account();
  const baseTenantKey = tenantKey();
  const deps: AdminControlServiceDeps = {
    resolvePlanSpec: () => resolvedPlan(),
    DEFAULT_HOSTED_PLAN_ID,
    provisionHostedAccountState: async () => ({
      account: baseAccount,
      initialKey: baseTenantKey,
      apiKey: 'atk_plaintext',
      path: null,
    }),
    attachStripeBillingToAccountState: async (_id, billing) => ({
      record: account({
        billing: {
          ...baseAccount.billing,
          provider: 'stripe',
          stripeCustomerId: billing.stripeCustomerId ?? null,
          stripeSubscriptionId: billing.stripeSubscriptionId ?? null,
          stripeSubscriptionStatus: billing.stripeSubscriptionStatus ?? null,
          stripePriceId: billing.stripePriceId ?? null,
        },
      }),
      path: null,
    }),
    setHostedAccountStatusState: async (_id, status) => ({
      record: account({
        status,
        suspendedAt: status === 'suspended' ? now : null,
        archivedAt: status === 'archived' ? now : null,
      }),
      path: null,
    }),
    revokeAccountSessionsForAccountState: async () => ({
      revokedCount: 2,
      path: null,
    }),
    issueTenantApiKeyState: async () => ({
      record: baseTenantKey,
      apiKey: 'atk_plaintext',
      path: null,
    }),
    rotateTenantApiKeyState: async () => ({
      previousRecord: tenantKey({ id: 'tkey_old', supersededByKeyId: 'tkey_new' }),
      record: tenantKey({ id: 'tkey_new', rotatedFromKeyId: 'tkey_old' }),
      apiKey: 'atk_rotated',
      path: null,
    }),
    setTenantApiKeyStatusState: async (_id, status) => ({
      record: tenantKey({
        status,
        deactivatedAt: status === 'inactive' ? now : null,
      }),
      path: null,
    }),
    recoverTenantApiKeyState: async () => ({
      record: baseTenantKey,
      apiKey: 'atk_recovered',
      path: null,
    }),
    revokeTenantApiKeyState: async () => ({
      record: tenantKey({ status: 'revoked', revokedAt: now }),
      path: null,
    }),
    syncHostedBillingEntitlement: async (record) => entitlement({
      accountId: record.id,
      tenantId: record.primaryTenantId,
      accountStatus: record.status,
    }),
    syncHostedBillingEntitlementForTenant: async (tenantId, options) => entitlement({
      tenantId,
      lastEventId: options?.lastEventId ?? null,
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

async function testProvisionResolvesPlanAndSyncsEntitlement(): Promise<void> {
  const calls: string[] = [];
  const service = createAdminControlService(createDeps({
    resolvePlanSpec: (options) => {
      calls.push(`resolve:${options?.planId}:${options?.monthlyRunQuota}`);
      return resolvedPlan({ planId: 'enterprise', monthlyRunQuota: 5000 });
    },
    provisionHostedAccountState: async (input) => {
      calls.push(`provision:${input.key.planId}:${input.key.monthlyRunQuota}`);
      return {
        account: account({ id: 'acct_new', primaryTenantId: input.key.tenantId }),
        initialKey: tenantKey({
          tenantId: input.key.tenantId,
          planId: input.key.planId ?? null,
          monthlyRunQuota: input.key.monthlyRunQuota ?? null,
        }),
        apiKey: 'atk_created',
        path: null,
      };
    },
    syncHostedBillingEntitlement: async (record) => {
      calls.push(`sync:${record.id}`);
      return entitlement({ accountId: record.id });
    },
  }));

  const result = await service.provisionHostedAccount({
    accountName: 'Acme',
    contactEmail: 'ops@example.com',
    tenantId: 'tenant_new',
    tenantName: 'Acme Tenant',
    planId: 'enterprise',
    monthlyRunQuota: 5000,
  });

  assert.equal(result.account.id, 'acct_new');
  assert.equal(result.initialKey.planId, 'enterprise');
  assert.equal(result.apiKey, 'atk_created');
  assert.deepEqual(calls, [
    'resolve:enterprise:5000',
    'provision:enterprise:5000',
    'sync:acct_new',
  ]);
}

async function testAttachStripeBillingNormalizesStatusAndSyncs(): Promise<void> {
  let attachedStatus: unknown = 'unset';
  const service = createAdminControlService(createDeps({
    attachStripeBillingToAccountState: async (_id, billing) => {
      attachedStatus = billing.stripeSubscriptionStatus;
      return {
        record: account({
          billing: {
            ...account().billing,
            provider: 'stripe',
            stripeCustomerId: billing.stripeCustomerId ?? null,
            stripeSubscriptionStatus: billing.stripeSubscriptionStatus ?? null,
          },
        }),
        path: null,
      };
    },
  }));

  const result = await service.attachStripeBilling({
    accountId: 'acct_123',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: ' active ',
    stripePriceId: null,
  });

  assert.equal(attachedStatus, 'active');
  assert.equal(result.record.billing.stripeSubscriptionStatus, 'active');
}

async function testHostedAccountLifecycleRevokesOnlyForClosedStatuses(): Promise<void> {
  const revokedFor: string[] = [];
  const service = createAdminControlService(createDeps({
    revokeAccountSessionsForAccountState: async (accountId) => {
      revokedFor.push(accountId);
      return {
        revokedCount: 3,
        path: null,
      };
    },
  }));

  const suspended = await service.setHostedAccountStatus({
    accountId: 'acct_123',
    status: 'suspended',
  });
  const active = await service.setHostedAccountStatus({
    accountId: 'acct_123',
    status: 'active',
  });

  assert.equal(suspended.revokedSessionCount, 3);
  assert.equal(active.revokedSessionCount, 0);
  assert.deepEqual(revokedFor, ['acct_123']);
}

async function testTenantKeyErrorsMapToControlErrors(): Promise<void> {
  const service = createAdminControlService(createDeps({
    issueTenantApiKeyState: async () => {
      throw new TenantKeyStoreError('LIMIT_EXCEEDED', 'too many active keys');
    },
  }));

  await assert.rejects(
    () => service.issueTenantApiKey({
      tenantId: 'tenant_123',
      tenantName: 'Acme',
      planId: 'pro',
      monthlyRunQuota: 1000,
      billingEvent: {
        idempotencyKey: 'idem_123',
        routeId: 'admin.tenant_keys.issue',
      },
    }),
    (error) => error instanceof AdminControlServiceError
      && error.statusCode === 409
      && error.message === 'too many active keys',
  );
}

async function testRecoverMapsDisabledSecretEnvelopeToConflict(): Promise<void> {
  const service = createAdminControlService(createDeps({
    recoverTenantApiKeyState: async () => {
      throw new SecretEnvelopeError('DISABLED', 'recovery is disabled');
    },
  }));

  await assert.rejects(
    () => service.recoverTenantApiKey({ id: 'tkey_123' }),
    (error) => error instanceof AdminControlServiceError
      && error.statusCode === 409
      && error.message === 'recovery is disabled',
  );
}

await testProvisionResolvesPlanAndSyncsEntitlement();
await testAttachStripeBillingNormalizesStatusAndSyncs();
await testHostedAccountLifecycleRevokesOnlyForClosedStatuses();
await testTenantKeyErrorsMapToControlErrors();
await testRecoverMapsDisabledSecretEnvelopeToConflict();

console.log('Service admin control service tests: 5 passed, 0 failed');
