/**
 * Billing Entitlement Store — current hosted billing/access truth.
 *
 * BOUNDARY:
 * - Current-state read model keyed by hosted account id
 * - Derives effective hosted billing/access status from account + Stripe sync state
 * - Complements the raw billing event ledger; does not replace line-item invoice history
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  HostedAccountRecord,
  HostedAccountStatus,
  StripeInvoiceStatus,
  StripeSubscriptionStatus,
} from './account-store.js';
import {
  DEFAULT_HOSTED_PLAN_ID,
  resolvePlanAsyncQueue,
  resolvePlanRateLimit,
  resolvePlanSpec,
} from './plan-catalog.js';

export type HostedBillingEntitlementProvider = 'manual' | 'stripe';
export type HostedBillingEntitlementStatus =
  | 'provisioned'
  | 'checkout_completed'
  | 'active'
  | 'trialing'
  | 'delinquent'
  | 'suspended'
  | 'archived';

export interface HostedBillingEntitlementRecord {
  id: string;
  accountId: string;
  tenantId: string;
  provider: HostedBillingEntitlementProvider;
  status: HostedBillingEntitlementStatus;
  accessEnabled: boolean;
  effectivePlanId: string | null;
  requestedPlanId: string | null;
  monthlyRunQuota: number | null;
  requestsPerWindow: number | null;
  asyncPendingJobsPerTenant: number | null;
  accountStatus: HostedAccountStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: StripeSubscriptionStatus;
  stripePriceId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeInvoiceId: string | null;
  stripeInvoiceStatus: StripeInvoiceStatus;
  stripeEntitlementLookupKeys: string[];
  stripeEntitlementFeatureIds: string[];
  stripeEntitlementSummaryUpdatedAt: string | null;
  lastEventId: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  effectiveAt: string | null;
  delinquentSince: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BillingEntitlementStoreFile {
  version: 1;
  records: HostedBillingEntitlementRecord[];
}

export interface HostedBillingEntitlementStoreSnapshot {
  version: 1;
  exportedAt: string;
  recordCount: number;
  records: HostedBillingEntitlementRecord[];
}

export interface ProjectHostedBillingEntitlementInput {
  account: HostedAccountRecord;
  currentPlanId?: string | null;
  currentMonthlyRunQuota?: number | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
}

function normalizeStringArray(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter((value) => value !== '');
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

export interface ListBillingEntitlementsFilters {
  accountId?: string | null;
  tenantId?: string | null;
  status?: HostedBillingEntitlementStatus | null;
  limit?: number | null;
  offset?: number | null;
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH ?? '.attestor/billing-entitlements.json');
}

function defaultStore(): BillingEntitlementStoreFile {
  return { version: 1, records: [] };
}

function loadStore(): BillingEntitlementStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BillingEntitlementStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return {
        version: 1,
        records: parsed.records.map(normalizeHostedBillingEntitlementRecord),
      };
    }
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: BillingEntitlementStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function hasStripeBinding(account: HostedAccountRecord): boolean {
  return account.billing.provider === 'stripe'
    || !!account.billing.stripeCustomerId
    || !!account.billing.stripeSubscriptionId;
}

function deriveEntitlementShape(options: {
  account: HostedAccountRecord;
  provider: HostedBillingEntitlementProvider;
}): {
  status: HostedBillingEntitlementStatus;
  accessEnabled: boolean;
  reason: string | null;
  effectiveAt: string | null;
} {
  const { account } = options;
  const subscriptionStatus = account.billing.stripeSubscriptionStatus;

  if (account.status === 'archived') {
    return {
      status: 'archived',
      accessEnabled: false,
      reason: 'account_archived',
      effectiveAt: account.archivedAt ?? account.updatedAt,
    };
  }

  if (account.status === 'suspended' && subscriptionStatus !== 'past_due' && subscriptionStatus !== 'unpaid') {
    return {
      status: 'suspended',
      accessEnabled: false,
      reason: account.billing.lastInvoiceEventType === 'invoice.payment_failed'
        ? 'invoice_payment_failed'
        : 'account_suspended',
      effectiveAt: account.suspendedAt ?? account.updatedAt,
    };
  }

  switch (subscriptionStatus) {
    case 'active':
      return {
        status: 'active',
        accessEnabled: true,
        reason: 'subscription_active',
        effectiveAt: account.billing.lastWebhookProcessedAt ?? account.updatedAt,
      };
    case 'trialing':
      return {
        status: 'trialing',
        accessEnabled: true,
        reason: 'subscription_trialing',
        effectiveAt: account.billing.lastWebhookProcessedAt ?? account.updatedAt,
      };
    case 'past_due':
    case 'unpaid':
      return {
        status: 'delinquent',
        accessEnabled: false,
        reason: `subscription_${subscriptionStatus}`,
        effectiveAt: account.billing.lastWebhookProcessedAt ?? account.updatedAt,
      };
    case 'canceled':
    case 'paused':
    case 'incomplete':
    case 'incomplete_expired':
      return {
        status: 'suspended',
        accessEnabled: false,
        reason: `subscription_${subscriptionStatus}`,
        effectiveAt: account.billing.lastWebhookProcessedAt ?? account.updatedAt,
      };
    default:
      break;
  }

  if (account.billing.lastCheckoutSessionId && account.billing.lastCheckoutCompletedAt) {
    return {
      status: 'checkout_completed',
      accessEnabled: account.status === 'active',
      reason: options.provider === 'stripe'
        ? 'checkout_completed_pending_subscription'
        : 'manual_checkout_completed',
      effectiveAt: account.billing.lastCheckoutCompletedAt,
    };
  }

  return {
    status: 'provisioned',
    accessEnabled: account.status === 'active',
    reason: options.provider === 'stripe'
      ? 'stripe_bound_pending_subscription'
      : 'manual_provisioning',
    effectiveAt: account.createdAt,
  };
}

export function normalizeHostedBillingEntitlementRecord(record: HostedBillingEntitlementRecord): HostedBillingEntitlementRecord {
  return {
    ...record,
    provider: record.provider === 'stripe' ? 'stripe' : 'manual',
    status: (
      [
        'provisioned',
        'checkout_completed',
        'active',
        'trialing',
        'delinquent',
        'suspended',
        'archived',
      ] as const
    ).includes(record.status)
      ? record.status
      : 'provisioned',
    accessEnabled: Boolean(record.accessEnabled),
    effectivePlanId: record.effectivePlanId ?? null,
    requestedPlanId: record.requestedPlanId ?? null,
    monthlyRunQuota: typeof record.monthlyRunQuota === 'number' && Number.isInteger(record.monthlyRunQuota)
      ? record.monthlyRunQuota
      : null,
    requestsPerWindow: typeof record.requestsPerWindow === 'number' && Number.isInteger(record.requestsPerWindow)
      ? record.requestsPerWindow
      : null,
    asyncPendingJobsPerTenant: typeof record.asyncPendingJobsPerTenant === 'number' && Number.isInteger(record.asyncPendingJobsPerTenant)
      ? record.asyncPendingJobsPerTenant
      : null,
    accountStatus: record.accountStatus === 'archived'
      ? 'archived'
      : record.accountStatus === 'suspended'
        ? 'suspended'
        : 'active',
    stripeCustomerId: record.stripeCustomerId ?? null,
    stripeSubscriptionId: record.stripeSubscriptionId ?? null,
    stripeSubscriptionStatus: record.stripeSubscriptionStatus ?? null,
    stripePriceId: record.stripePriceId ?? null,
    stripeCheckoutSessionId: record.stripeCheckoutSessionId ?? null,
    stripeInvoiceId: record.stripeInvoiceId ?? null,
    stripeInvoiceStatus: record.stripeInvoiceStatus ?? null,
    stripeEntitlementLookupKeys: normalizeStringArray(record.stripeEntitlementLookupKeys),
    stripeEntitlementFeatureIds: normalizeStringArray(record.stripeEntitlementFeatureIds),
    stripeEntitlementSummaryUpdatedAt: record.stripeEntitlementSummaryUpdatedAt ?? null,
    lastEventId: record.lastEventId ?? null,
    lastEventType: record.lastEventType ?? null,
    lastEventAt: record.lastEventAt ?? null,
    effectiveAt: record.effectiveAt ?? null,
    delinquentSince: record.delinquentSince ?? null,
    reason: record.reason ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function projectHostedBillingEntitlement(
  previous: HostedBillingEntitlementRecord | null,
  input: ProjectHostedBillingEntitlementInput,
): HostedBillingEntitlementRecord {
  const provider: HostedBillingEntitlementProvider = hasStripeBinding(input.account) ? 'stripe' : 'manual';
  const resolvedPlan = resolvePlanSpec({
    planId: input.currentPlanId ?? input.account.billing.lastCheckoutPlanId ?? DEFAULT_HOSTED_PLAN_ID,
    monthlyRunQuota: input.currentMonthlyRunQuota ?? null,
    defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
    allowCustomPlan: true,
  });
  const rateLimit = resolvePlanRateLimit(resolvedPlan.planId);
  const asyncQueue = resolvePlanAsyncQueue(resolvedPlan.planId);
  const derived = deriveEntitlementShape({
    account: input.account,
    provider,
  });
  const now = new Date().toISOString();

  return normalizeHostedBillingEntitlementRecord({
    id: previous?.id ?? `ent_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    accountId: input.account.id,
    tenantId: input.account.primaryTenantId,
    provider,
    status: derived.status,
    accessEnabled: derived.accessEnabled,
    effectivePlanId: resolvedPlan.planId,
    requestedPlanId: input.account.billing.lastCheckoutPlanId ?? resolvedPlan.planId,
    monthlyRunQuota: resolvedPlan.monthlyRunQuota,
    requestsPerWindow: rateLimit.requestsPerWindow,
    asyncPendingJobsPerTenant: asyncQueue.pendingJobsPerTenant,
    accountStatus: input.account.status,
    stripeCustomerId: input.account.billing.stripeCustomerId,
    stripeSubscriptionId: input.account.billing.stripeSubscriptionId,
    stripeSubscriptionStatus: input.account.billing.stripeSubscriptionStatus,
    stripePriceId: input.account.billing.stripePriceId,
    stripeCheckoutSessionId: input.account.billing.lastCheckoutSessionId,
    stripeInvoiceId: input.account.billing.lastInvoiceId,
    stripeInvoiceStatus: input.account.billing.lastInvoiceStatus,
    stripeEntitlementLookupKeys: input.stripeEntitlementLookupKeys ?? previous?.stripeEntitlementLookupKeys ?? [],
    stripeEntitlementFeatureIds: input.stripeEntitlementFeatureIds ?? previous?.stripeEntitlementFeatureIds ?? [],
    stripeEntitlementSummaryUpdatedAt: input.stripeEntitlementSummaryUpdatedAt
      ?? previous?.stripeEntitlementSummaryUpdatedAt
      ?? null,
    lastEventId: input.lastEventId
      ?? input.account.billing.lastWebhookEventId
      ?? input.account.billing.lastInvoiceEventId
      ?? null,
    lastEventType: input.lastEventType
      ?? input.account.billing.lastWebhookEventType
      ?? input.account.billing.lastInvoiceEventType
      ?? null,
    lastEventAt: input.lastEventAt
      ?? input.account.billing.lastWebhookProcessedAt
      ?? input.account.billing.lastInvoiceProcessedAt
      ?? input.account.updatedAt,
    effectiveAt: derived.effectiveAt,
    delinquentSince: input.account.billing.delinquentSince,
    reason: derived.reason,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  });
}

export function upsertHostedBillingEntitlement(
  input: ProjectHostedBillingEntitlementInput,
): { record: HostedBillingEntitlementRecord; path: string } {
  const store = loadStore();
  const index = store.records.findIndex((entry) => entry.accountId === input.account.id);
  const previous = index >= 0 ? store.records[index] : null;
  const record = projectHostedBillingEntitlement(previous, input);
  if (index >= 0) store.records[index] = record;
  else store.records.push(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function findHostedBillingEntitlementByAccountId(accountId: string): {
  record: HostedBillingEntitlementRecord | null;
  path: string;
} {
  const store = loadStore();
  return {
    record: store.records.find((entry) => entry.accountId === accountId) ?? null,
    path: storePath(),
  };
}

export function listHostedBillingEntitlements(filters?: ListBillingEntitlementsFilters): {
  records: HostedBillingEntitlementRecord[];
  path: string;
} {
  const limit = Math.max(1, Math.min(1000, filters?.limit ?? 100));
  const offset = Math.max(0, filters?.offset ?? 0);
  let records = loadStore().records;
  if (filters?.accountId) {
    records = records.filter((entry) => entry.accountId === filters.accountId);
  }
  if (filters?.tenantId) {
    records = records.filter((entry) => entry.tenantId === filters.tenantId);
  }
  if (filters?.status) {
    records = records.filter((entry) => entry.status === filters.status);
  }
  records = [...records].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return {
    records: records.slice(offset, offset + limit),
    path: storePath(),
  };
}

export function exportHostedBillingEntitlementStoreSnapshot(): HostedBillingEntitlementStoreSnapshot {
  const records = [...loadStore().records].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    recordCount: records.length,
    records,
  };
}

export function restoreHostedBillingEntitlementStoreSnapshot(snapshot: HostedBillingEntitlementStoreSnapshot): {
  recordCount: number;
  path: string;
} {
  const store: BillingEntitlementStoreFile = {
    version: 1,
    records: snapshot.records.map(normalizeHostedBillingEntitlementRecord),
  };
  saveStore(store);
  return {
    recordCount: store.records.length,
    path: storePath(),
  };
}

export function resetHostedBillingEntitlementStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
