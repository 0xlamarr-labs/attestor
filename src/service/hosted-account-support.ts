import type { Context } from 'hono';
import type * as ControlPlaneStore from './control-plane-store.js';
import type * as RateLimit from './rate-limit.js';
import type { HostedAccountRecord } from './account-store.js';
import {
  projectHostedBillingEntitlement,
  type HostedBillingEntitlementRecord,
} from './billing-entitlement-store.js';
import { currentTenant } from './request-context.js';
import { StripeBillingError } from './stripe-billing.js';
import type { UsageContext } from './usage-meter.js';

export interface CurrentHostedAccountResult {
  tenant: ReturnType<typeof currentTenant>;
  account: HostedAccountRecord;
  usage: UsageContext;
  rateLimit: RateLimit.TenantRateLimitContext;
}

export interface HostedBillingEntitlementSyncOptions {
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
}

export interface StripeAccountMatch {
  record: HostedAccountRecord | null;
  matchReason: 'account_id' | 'subscription_id' | 'customer_id' | 'none';
}

export interface HostedAccountSupport {
  currentHostedAccount(context: Context): Promise<CurrentHostedAccountResult | Response>;
  readHostedBillingEntitlement(
    account: HostedAccountRecord,
  ): Promise<HostedBillingEntitlementRecord>;
  syncHostedBillingEntitlement(
    account: HostedAccountRecord,
    options?: HostedBillingEntitlementSyncOptions,
  ): Promise<HostedBillingEntitlementRecord>;
  syncHostedBillingEntitlementForTenant(
    tenantId: string,
    options?: HostedBillingEntitlementSyncOptions,
  ): Promise<HostedBillingEntitlementRecord | null>;
  findHostedAccountByStripeRefs(options: {
    accountId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }): Promise<StripeAccountMatch>;
  revokeAccountSessionsForLifecycleChange(options: {
    account: HostedAccountRecord | null;
    previousStatus: HostedAccountRecord['status'] | null;
    nextStatus: HostedAccountRecord['status'] | null;
  }): Promise<number>;
}

export interface HostedAccountSupportDeps {
  DEFAULT_HOSTED_PLAN_ID: string;
  findHostedAccountByTenantId: typeof ControlPlaneStore.findHostedAccountByTenantIdState;
  findHostedAccountById: typeof ControlPlaneStore.findHostedAccountByIdState;
  listHostedAccounts: typeof ControlPlaneStore.listHostedAccountsState;
  findTenantRecordByTenantId: typeof ControlPlaneStore.findTenantRecordByTenantIdState;
  getUsageContext: typeof ControlPlaneStore.getUsageContextState;
  getTenantPipelineRateLimit: typeof RateLimit.getTenantPipelineRateLimit;
  findHostedBillingEntitlementByAccountId:
    typeof ControlPlaneStore.findHostedBillingEntitlementByAccountIdState;
  upsertHostedBillingEntitlement:
    typeof ControlPlaneStore.upsertHostedBillingEntitlementState;
  revokeAccountSessionsForAccount:
    typeof ControlPlaneStore.revokeAccountSessionsForAccountState;
}

export function accountMfaErrorResponse(context: Context, error: unknown): Response | null {
  if (!(error instanceof Error)) return null;
  if (
    error.message.includes('ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY')
    || error.message.includes('ATTESTOR_ADMIN_API_KEY')
  ) {
    return context.json({ error: error.message }, 503);
  }
  return null;
}

export function stripeBillingErrorResponse(
  context: Context,
  error: unknown,
): Response | null {
  if (!(error instanceof StripeBillingError)) return null;
  if (error.code === 'DISABLED') return context.json({ error: error.message }, 503);
  if (error.code === 'NO_CUSTOMER') return context.json({ error: error.message }, 409);
  return context.json({ error: error.message }, 400);
}

export function createHostedAccountSupport(
  deps: HostedAccountSupportDeps,
): HostedAccountSupport {
  async function currentHostedAccount(
    context: Context,
  ): Promise<CurrentHostedAccountResult | Response> {
    const tenant = currentTenant(context);
    const account = await deps.findHostedAccountByTenantId(tenant.tenantId);
    if (!account) {
      return context.json(
        {
          error: `Hosted account not found for tenant '${tenant.tenantId}'.`,
          tenantContext: {
            tenantId: tenant.tenantId,
            source: tenant.source,
            planId: tenant.planId,
          },
        },
        404,
      );
    }

    return {
      tenant,
      account,
      usage: await deps.getUsageContext(
        tenant.tenantId,
        tenant.planId,
        tenant.monthlyRunQuota,
      ),
      rateLimit: await deps.getTenantPipelineRateLimit(tenant.tenantId, tenant.planId),
    };
  }

  async function projectBillingEntitlementForAccount(
    account: HostedAccountRecord,
    options?: HostedBillingEntitlementSyncOptions,
  ): Promise<HostedBillingEntitlementRecord> {
    const tenantRecord = await deps.findTenantRecordByTenantId(account.primaryTenantId);
    return projectHostedBillingEntitlement(
      await deps.findHostedBillingEntitlementByAccountId(account.id),
      {
        account,
        currentPlanId:
          tenantRecord?.planId
          ?? account.billing.lastCheckoutPlanId
          ?? deps.DEFAULT_HOSTED_PLAN_ID,
        currentMonthlyRunQuota: tenantRecord?.monthlyRunQuota ?? null,
        stripeEntitlementLookupKeys: options?.stripeEntitlementLookupKeys ?? null,
        stripeEntitlementFeatureIds: options?.stripeEntitlementFeatureIds ?? null,
        stripeEntitlementSummaryUpdatedAt:
          options?.stripeEntitlementSummaryUpdatedAt ?? null,
        lastEventId: options?.lastEventId ?? null,
        lastEventType: options?.lastEventType ?? null,
        lastEventAt: options?.lastEventAt ?? null,
      },
    );
  }

  async function readHostedBillingEntitlement(
    account: HostedAccountRecord,
  ): Promise<HostedBillingEntitlementRecord> {
    const existing = await deps.findHostedBillingEntitlementByAccountId(account.id);
    if (existing) return existing;
    return projectBillingEntitlementForAccount(account);
  }

  async function syncHostedBillingEntitlement(
    account: HostedAccountRecord,
    options?: HostedBillingEntitlementSyncOptions,
  ): Promise<HostedBillingEntitlementRecord> {
    const tenantRecord = await deps.findTenantRecordByTenantId(account.primaryTenantId);
    const synced = await deps.upsertHostedBillingEntitlement({
      account,
      currentPlanId:
        tenantRecord?.planId
        ?? account.billing.lastCheckoutPlanId
        ?? deps.DEFAULT_HOSTED_PLAN_ID,
      currentMonthlyRunQuota: tenantRecord?.monthlyRunQuota ?? null,
      stripeEntitlementLookupKeys: options?.stripeEntitlementLookupKeys ?? null,
      stripeEntitlementFeatureIds: options?.stripeEntitlementFeatureIds ?? null,
      stripeEntitlementSummaryUpdatedAt:
        options?.stripeEntitlementSummaryUpdatedAt ?? null,
      lastEventId: options?.lastEventId ?? null,
      lastEventType: options?.lastEventType ?? null,
      lastEventAt: options?.lastEventAt ?? null,
    });
    return synced.record;
  }

  async function syncHostedBillingEntitlementForTenant(
    tenantId: string,
    options?: HostedBillingEntitlementSyncOptions,
  ): Promise<HostedBillingEntitlementRecord | null> {
    const account = await deps.findHostedAccountByTenantId(tenantId);
    if (!account) return null;
    return syncHostedBillingEntitlement(account, options);
  }

  async function findHostedAccountByStripeRefs(options: {
    accountId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }): Promise<StripeAccountMatch> {
    if (options.accountId) {
      const record = await deps.findHostedAccountById(options.accountId);
      if (record) {
        return { record, matchReason: 'account_id' };
      }
    }

    const { records } = await deps.listHostedAccounts();
    if (options.stripeSubscriptionId) {
      const record =
        records.find(
          (entry) => entry.billing.stripeSubscriptionId === options.stripeSubscriptionId,
        ) ?? null;
      if (record) {
        return { record, matchReason: 'subscription_id' };
      }
    }

    if (options.stripeCustomerId) {
      const record =
        records.find((entry) => entry.billing.stripeCustomerId === options.stripeCustomerId)
        ?? null;
      if (record) {
        return { record, matchReason: 'customer_id' };
      }
    }

    return {
      record: null,
      matchReason: 'none',
    };
  }

  async function revokeAccountSessionsForLifecycleChange(options: {
    account: HostedAccountRecord | null;
    previousStatus: HostedAccountRecord['status'] | null;
    nextStatus: HostedAccountRecord['status'] | null;
  }): Promise<number> {
    if (!options.account) return 0;
    if (options.previousStatus === options.nextStatus) return 0;
    if (options.nextStatus !== 'suspended' && options.nextStatus !== 'archived') return 0;
    const result = await deps.revokeAccountSessionsForAccount(options.account.id);
    return result.revokedCount;
  }

  return {
    currentHostedAccount,
    readHostedBillingEntitlement,
    syncHostedBillingEntitlement,
    syncHostedBillingEntitlementForTenant,
    findHostedAccountByStripeRefs,
    revokeAccountSessionsForLifecycleChange,
  };
}
