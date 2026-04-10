/**
 * Account Store — Hosted customer lifecycle + billing first slice
 *
 * Persists hosted customer account records in a local JSON file so operators
 * can track account status, tenant ownership, and billing-provider metadata.
 *
 * BOUNDARY:
 * - Local file-backed store only
 * - One primary tenant per account in this first slice
 * - Stripe metadata sync + checkout/invoice summary only; no shared customer portal state
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type HostedAccountStatus = 'active' | 'suspended' | 'archived';

export type StripeSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'
  | null;

export type StripeInvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'uncollectible'
  | 'void'
  | null;

export interface HostedAccountBillingState {
  provider: 'stripe' | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: StripeSubscriptionStatus;
  stripePriceId: string | null;
  lastCheckoutSessionId: string | null;
  lastCheckoutCompletedAt: string | null;
  lastCheckoutPlanId: string | null;
  lastInvoiceId: string | null;
  lastInvoiceStatus: StripeInvoiceStatus;
  lastInvoiceCurrency: string | null;
  lastInvoiceAmountPaid: number | null;
  lastInvoiceAmountDue: number | null;
  lastInvoiceEventId: string | null;
  lastInvoiceEventType: string | null;
  lastInvoiceProcessedAt: string | null;
  lastInvoicePaidAt: string | null;
  delinquentSince: string | null;
  lastWebhookEventId: string | null;
  lastWebhookEventType: string | null;
  lastWebhookProcessedAt: string | null;
}

export interface HostedAccountRecord {
  id: string;
  accountName: string;
  contactEmail: string;
  primaryTenantId: string;
  status: HostedAccountStatus;
  createdAt: string;
  updatedAt: string;
  suspendedAt: string | null;
  archivedAt: string | null;
  billing: HostedAccountBillingState;
}

interface LegacyHostedAccountRecordV1 {
  id: string;
  accountName: string;
  contactEmail: string;
  primaryTenantId: string;
  status: 'active' | 'archived';
  createdAt: string;
  archivedAt: string | null;
}

interface AccountStoreFileV1 {
  version: 1;
  records: LegacyHostedAccountRecordV1[];
}

interface AccountStoreFileV2 {
  version: 2;
  records: HostedAccountRecord[];
}

type AccountStoreFile = AccountStoreFileV2;

export interface CreateHostedAccountInput {
  accountName: string;
  contactEmail: string;
  primaryTenantId: string;
}

export interface AttachStripeBillingInput {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: StripeSubscriptionStatus;
  stripePriceId?: string | null;
  lastWebhookEventId?: string | null;
  lastWebhookEventType?: string | null;
  lastWebhookProcessedAt?: string | null;
}

export class AccountStoreError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'AccountStoreError';
  }
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_ACCOUNT_STORE_PATH ?? '.attestor/accounts.json');
}

function defaultBillingState(): HostedAccountBillingState {
  return {
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
  };
}

function normalizeStripeSubscriptionStatus(raw: string | null | undefined): StripeSubscriptionStatus {
  if (!raw) return null;
  switch (raw) {
    case 'trialing':
    case 'active':
    case 'incomplete':
    case 'incomplete_expired':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
    case 'paused':
      return raw;
    default:
      return null;
  }
}

function normalizeStripeInvoiceStatus(raw: string | null | undefined): StripeInvoiceStatus {
  if (!raw) return null;
  switch (raw) {
    case 'draft':
    case 'open':
    case 'paid':
    case 'uncollectible':
    case 'void':
      return raw;
    default:
      return null;
  }
}

function migrateRecordV1(record: LegacyHostedAccountRecordV1): HostedAccountRecord {
  return {
    id: record.id,
    accountName: record.accountName,
    contactEmail: record.contactEmail,
    primaryTenantId: record.primaryTenantId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.archivedAt ?? record.createdAt,
    suspendedAt: null,
    archivedAt: record.archivedAt,
    billing: defaultBillingState(),
  };
}

function defaultStore(): AccountStoreFile {
  return { version: 2, records: [] };
}

function loadStore(): AccountStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AccountStoreFileV1 | AccountStoreFileV2;
    if (parsed.version === 2 && Array.isArray(parsed.records)) {
      return {
        version: 2,
        records: parsed.records.map((record) => ({
          ...record,
          updatedAt: record.updatedAt ?? record.archivedAt ?? record.suspendedAt ?? record.createdAt,
          suspendedAt: record.suspendedAt ?? null,
          archivedAt: record.archivedAt ?? null,
          billing: {
            ...defaultBillingState(),
            ...(record.billing ?? {}),
            provider: record.billing?.provider === 'stripe' ? 'stripe' : null,
            stripeSubscriptionStatus: normalizeStripeSubscriptionStatus(record.billing?.stripeSubscriptionStatus ?? null),
            lastInvoiceStatus: normalizeStripeInvoiceStatus(record.billing?.lastInvoiceStatus ?? null),
          },
        })),
      };
    }
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return {
        version: 2,
        records: parsed.records.map(migrateRecordV1),
      };
    }
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: AccountStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function findRecord(store: AccountStoreFile, id: string): HostedAccountRecord | null {
  return store.records.find((entry) => entry.id === id) ?? null;
}

function requireRecord(store: AccountStoreFile, id: string): HostedAccountRecord {
  const record = findRecord(store, id);
  if (!record) {
    throw new AccountStoreError('NOT_FOUND', `Hosted account '${id}' was not found.`);
  }
  return record;
}

function ensureUniqueTenant(store: AccountStoreFile, primaryTenantId: string, selfId?: string): void {
  const existing = store.records.find((entry) => entry.primaryTenantId === primaryTenantId && entry.id !== selfId);
  if (existing) {
    throw new AccountStoreError(
      'CONFLICT',
      `Primary tenant '${primaryTenantId}' is already assigned to hosted account '${existing.id}'.`,
    );
  }
}

function ensureStripeBindingUniqueness(
  store: AccountStoreFile,
  billing: AttachStripeBillingInput,
  selfId: string,
): void {
  for (const record of store.records) {
    if (record.id === selfId) continue;
    if (
      billing.stripeCustomerId &&
      record.billing.stripeCustomerId &&
      record.billing.stripeCustomerId === billing.stripeCustomerId
    ) {
      throw new AccountStoreError(
        'CONFLICT',
        `Stripe customer '${billing.stripeCustomerId}' is already linked to hosted account '${record.id}'.`,
      );
    }
    if (
      billing.stripeSubscriptionId &&
      record.billing.stripeSubscriptionId &&
      record.billing.stripeSubscriptionId === billing.stripeSubscriptionId
    ) {
      throw new AccountStoreError(
        'CONFLICT',
        `Stripe subscription '${billing.stripeSubscriptionId}' is already linked to hosted account '${record.id}'.`,
      );
    }
  }
}

function resolveStripeAccountMatch(
  store: AccountStoreFile,
  options: {
    accountId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeCustomerId?: string | null;
  },
): {
  record: HostedAccountRecord | null;
  matchReason: 'account_id' | 'subscription_id' | 'customer_id' | 'none';
} {
  if (options.accountId) {
    const record = findRecord(store, options.accountId);
    if (record) {
      return { record, matchReason: 'account_id' };
    }
  }
  if (options.stripeSubscriptionId) {
    const record = store.records.find((entry) => entry.billing.stripeSubscriptionId === options.stripeSubscriptionId) ?? null;
    if (record) {
      return { record, matchReason: 'subscription_id' };
    }
  }
  if (options.stripeCustomerId) {
    const record = store.records.find((entry) => entry.billing.stripeCustomerId === options.stripeCustomerId) ?? null;
    if (record) {
      return { record, matchReason: 'customer_id' };
    }
  }
  return { record: null, matchReason: 'none' };
}

function touchRecord(record: HostedAccountRecord): void {
  record.updatedAt = new Date().toISOString();
}

export function deriveHostedAccountStatusFromStripeSubscriptionStatus(
  status: StripeSubscriptionStatus,
): 'active' | 'suspended' | null {
  if (!status) return null;
  if (status === 'active' || status === 'trialing') return 'active';
  return 'suspended';
}

function deriveStripeSubscriptionStatusFromInvoiceEvent(
  eventType: string,
  currentStatus: StripeSubscriptionStatus,
): StripeSubscriptionStatus {
  if (eventType === 'invoice.paid') {
    if (currentStatus === 'paused' || currentStatus === 'canceled') return currentStatus;
    if (currentStatus === 'trialing') return 'trialing';
    return 'active';
  }
  if (eventType === 'invoice.payment_failed') {
    if (currentStatus === 'paused' || currentStatus === 'canceled') return currentStatus;
    if (currentStatus === 'unpaid') return 'unpaid';
    return 'past_due';
  }
  return currentStatus;
}

export function createHostedAccount(input: CreateHostedAccountInput): {
  record: HostedAccountRecord;
  path: string;
} {
  const now = new Date().toISOString();
  const record: HostedAccountRecord = {
    id: `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    accountName: input.accountName,
    contactEmail: input.contactEmail,
    primaryTenantId: input.primaryTenantId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    suspendedAt: null,
    archivedAt: null,
    billing: defaultBillingState(),
  };

  const store = loadStore();
  ensureUniqueTenant(store, input.primaryTenantId);
  store.records.push(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function listHostedAccounts(): {
  records: HostedAccountRecord[];
  path: string;
} {
  const store = loadStore();
  return { records: store.records, path: storePath() };
}

export function findHostedAccountById(id: string): HostedAccountRecord | null {
  const store = loadStore();
  return findRecord(store, id);
}

export function findHostedAccountByTenantId(primaryTenantId: string): HostedAccountRecord | null {
  const store = loadStore();
  return store.records.find((entry) => entry.primaryTenantId === primaryTenantId) ?? null;
}

export function findHostedAccountByStripeCustomerId(stripeCustomerId: string): HostedAccountRecord | null {
  const store = loadStore();
  return store.records.find((entry) => entry.billing.stripeCustomerId === stripeCustomerId) ?? null;
}

export function findHostedAccountByStripeSubscriptionId(stripeSubscriptionId: string): HostedAccountRecord | null {
  const store = loadStore();
  return store.records.find((entry) => entry.billing.stripeSubscriptionId === stripeSubscriptionId) ?? null;
}

export function setHostedAccountStatus(id: string, nextStatus: HostedAccountStatus): {
  record: HostedAccountRecord;
  path: string;
} {
  const store = loadStore();
  const record = requireRecord(store, id);
  if (record.status === 'archived' && nextStatus !== 'archived') {
    throw new AccountStoreError(
      'INVALID_STATE',
      `Hosted account '${id}' is archived and cannot transition back to ${nextStatus}.`,
    );
  }

  if (record.status === nextStatus) {
    return { record, path: storePath() };
  }

  record.status = nextStatus;
  if (nextStatus === 'active') {
    record.suspendedAt = null;
  } else if (nextStatus === 'suspended') {
    record.suspendedAt = new Date().toISOString();
  } else if (nextStatus === 'archived') {
    record.archivedAt = new Date().toISOString();
  }
  touchRecord(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function attachStripeBillingToAccount(id: string, billing: AttachStripeBillingInput): {
  record: HostedAccountRecord;
  path: string;
} {
  const store = loadStore();
  const record = requireRecord(store, id);
  ensureStripeBindingUniqueness(store, billing, id);

  record.billing = {
    ...defaultBillingState(),
    ...record.billing,
    provider: billing.stripeCustomerId || billing.stripeSubscriptionId ? 'stripe' : record.billing.provider,
    stripeCustomerId: billing.stripeCustomerId ?? record.billing.stripeCustomerId,
    stripeSubscriptionId: billing.stripeSubscriptionId ?? record.billing.stripeSubscriptionId,
    stripeSubscriptionStatus: normalizeStripeSubscriptionStatus(
      billing.stripeSubscriptionStatus ?? record.billing.stripeSubscriptionStatus,
    ),
    stripePriceId: billing.stripePriceId ?? record.billing.stripePriceId,
    lastWebhookEventId: billing.lastWebhookEventId ?? record.billing.lastWebhookEventId,
    lastWebhookEventType: billing.lastWebhookEventType ?? record.billing.lastWebhookEventType,
    lastWebhookProcessedAt: billing.lastWebhookProcessedAt ?? record.billing.lastWebhookProcessedAt,
  };

  touchRecord(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function applyStripeSubscriptionState(options: {
  accountId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripePriceId?: string | null;
  eventId: string;
  eventType: string;
}): {
  record: HostedAccountRecord | null;
  previousStatus: HostedAccountStatus | null;
  nextStatus: HostedAccountStatus | null;
  previousBillingStatus: StripeSubscriptionStatus;
  nextBillingStatus: StripeSubscriptionStatus;
  path: string | null;
  matchReason: 'account_id' | 'subscription_id' | 'customer_id' | 'none';
} {
  const normalizedStatus = normalizeStripeSubscriptionStatus(options.stripeSubscriptionStatus ?? null);
  const store = loadStore();
  const match = resolveStripeAccountMatch(store, options);
  const matchReason = match.matchReason;
  const record = match.record;

  if (!record) {
    return {
      record: null,
      previousStatus: null,
      nextStatus: null,
      previousBillingStatus: null,
      nextBillingStatus: normalizedStatus,
      path: null,
      matchReason: 'none',
    };
  }

  ensureStripeBindingUniqueness(store, {
    stripeCustomerId: options.stripeCustomerId ?? record.billing.stripeCustomerId,
    stripeSubscriptionId: options.stripeSubscriptionId ?? record.billing.stripeSubscriptionId,
  }, record.id);

  const previousStatus = record.status;
  const previousBillingStatus = record.billing.stripeSubscriptionStatus;
  record.billing = {
    ...defaultBillingState(),
    ...record.billing,
    provider: 'stripe',
    stripeCustomerId: options.stripeCustomerId ?? record.billing.stripeCustomerId,
    stripeSubscriptionId: options.stripeSubscriptionId ?? record.billing.stripeSubscriptionId,
    stripeSubscriptionStatus: normalizedStatus,
    stripePriceId: options.stripePriceId ?? record.billing.stripePriceId,
    lastWebhookEventId: options.eventId,
    lastWebhookEventType: options.eventType,
    lastWebhookProcessedAt: new Date().toISOString(),
  };

  const derivedStatus = deriveHostedAccountStatusFromStripeSubscriptionStatus(normalizedStatus);
  if (record.status !== 'archived' && derivedStatus && record.status !== derivedStatus) {
    record.status = derivedStatus;
    if (derivedStatus === 'active') {
      record.suspendedAt = null;
    } else if (derivedStatus === 'suspended') {
      record.suspendedAt = new Date().toISOString();
    }
  }

  touchRecord(record);
  saveStore(store);
  return {
    record,
    previousStatus,
    nextStatus: record.status,
    previousBillingStatus,
    nextBillingStatus: record.billing.stripeSubscriptionStatus,
    path: storePath(),
    matchReason,
  };
}

export function applyStripeCheckoutCompletion(options: {
  accountId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  planId?: string | null;
  checkoutSessionId: string;
  completedAt?: string | null;
  eventId: string;
  eventType: string;
}): {
  record: HostedAccountRecord | null;
  previousStatus: HostedAccountStatus | null;
  nextStatus: HostedAccountStatus | null;
  previousBillingStatus: StripeSubscriptionStatus;
  nextBillingStatus: StripeSubscriptionStatus;
  path: string | null;
  matchReason: 'account_id' | 'subscription_id' | 'customer_id' | 'none';
} {
  const store = loadStore();
  const match = resolveStripeAccountMatch(store, options);
  const matchReason = match.matchReason;
  const record = match.record;
  if (!record) {
    return {
      record: null,
      previousStatus: null,
      nextStatus: null,
      previousBillingStatus: null,
      nextBillingStatus: null,
      path: null,
      matchReason: 'none',
    };
  }

  ensureStripeBindingUniqueness(store, {
    stripeCustomerId: options.stripeCustomerId ?? record.billing.stripeCustomerId,
    stripeSubscriptionId: options.stripeSubscriptionId ?? record.billing.stripeSubscriptionId,
  }, record.id);

  const previousStatus = record.status;
  const previousBillingStatus = record.billing.stripeSubscriptionStatus;
  record.billing = {
    ...defaultBillingState(),
    ...record.billing,
    provider: 'stripe',
    stripeCustomerId: options.stripeCustomerId ?? record.billing.stripeCustomerId,
    stripeSubscriptionId: options.stripeSubscriptionId ?? record.billing.stripeSubscriptionId,
    stripePriceId: options.stripePriceId ?? record.billing.stripePriceId,
    lastCheckoutSessionId: options.checkoutSessionId,
    lastCheckoutCompletedAt: options.completedAt ?? new Date().toISOString(),
    lastCheckoutPlanId: options.planId ?? record.billing.lastCheckoutPlanId,
    lastWebhookEventId: options.eventId,
    lastWebhookEventType: options.eventType,
    lastWebhookProcessedAt: new Date().toISOString(),
  };

  touchRecord(record);
  saveStore(store);
  return {
    record,
    previousStatus,
    nextStatus: record.status,
    previousBillingStatus,
    nextBillingStatus: record.billing.stripeSubscriptionStatus,
    path: storePath(),
    matchReason,
  };
}

export function applyStripeInvoiceState(options: {
  accountId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  invoiceId: string;
  invoiceStatus?: string | null;
  currency?: string | null;
  amountPaid?: number | null;
  amountDue?: number | null;
  paidAt?: string | null;
  paymentFailedAt?: string | null;
  eventId: string;
  eventType: string;
}): {
  record: HostedAccountRecord | null;
  previousStatus: HostedAccountStatus | null;
  nextStatus: HostedAccountStatus | null;
  previousBillingStatus: StripeSubscriptionStatus;
  nextBillingStatus: StripeSubscriptionStatus;
  path: string | null;
  matchReason: 'account_id' | 'subscription_id' | 'customer_id' | 'none';
} {
  const normalizedInvoiceStatus = normalizeStripeInvoiceStatus(options.invoiceStatus ?? null);
  const store = loadStore();
  const match = resolveStripeAccountMatch(store, options);
  const matchReason = match.matchReason;
  const record = match.record;
  if (!record) {
    return {
      record: null,
      previousStatus: null,
      nextStatus: null,
      previousBillingStatus: null,
      nextBillingStatus: null,
      path: null,
      matchReason: 'none',
    };
  }

  ensureStripeBindingUniqueness(store, {
    stripeCustomerId: options.stripeCustomerId ?? record.billing.stripeCustomerId,
    stripeSubscriptionId: options.stripeSubscriptionId ?? record.billing.stripeSubscriptionId,
  }, record.id);

  const previousStatus = record.status;
  const previousBillingStatus = record.billing.stripeSubscriptionStatus;
  const nextBillingStatus = deriveStripeSubscriptionStatusFromInvoiceEvent(
    options.eventType,
    record.billing.stripeSubscriptionStatus,
  );
  const paidAt = options.eventType === 'invoice.paid'
    ? (options.paidAt ?? new Date().toISOString())
    : record.billing.lastInvoicePaidAt;
  const delinquentSince = options.eventType === 'invoice.payment_failed'
    ? (record.billing.delinquentSince ?? options.paymentFailedAt ?? new Date().toISOString())
    : options.eventType === 'invoice.paid'
      ? null
      : record.billing.delinquentSince;

  record.billing = {
    ...defaultBillingState(),
    ...record.billing,
    provider: 'stripe',
    stripeCustomerId: options.stripeCustomerId ?? record.billing.stripeCustomerId,
    stripeSubscriptionId: options.stripeSubscriptionId ?? record.billing.stripeSubscriptionId,
    stripeSubscriptionStatus: nextBillingStatus,
    stripePriceId: options.stripePriceId ?? record.billing.stripePriceId,
    lastInvoiceId: options.invoiceId,
    lastInvoiceStatus: normalizedInvoiceStatus,
    lastInvoiceCurrency: options.currency ?? record.billing.lastInvoiceCurrency,
    lastInvoiceAmountPaid: options.amountPaid ?? record.billing.lastInvoiceAmountPaid,
    lastInvoiceAmountDue: options.amountDue ?? record.billing.lastInvoiceAmountDue,
    lastInvoiceEventId: options.eventId,
    lastInvoiceEventType: options.eventType,
    lastInvoiceProcessedAt: new Date().toISOString(),
    lastInvoicePaidAt: paidAt,
    delinquentSince,
    lastWebhookEventId: options.eventId,
    lastWebhookEventType: options.eventType,
    lastWebhookProcessedAt: new Date().toISOString(),
  };

  const derivedStatus = deriveHostedAccountStatusFromStripeSubscriptionStatus(nextBillingStatus);
  if (record.status !== 'archived' && derivedStatus && record.status !== derivedStatus) {
    record.status = derivedStatus;
    if (derivedStatus === 'active') {
      record.suspendedAt = null;
    } else if (derivedStatus === 'suspended') {
      record.suspendedAt = new Date().toISOString();
    }
  }

  touchRecord(record);
  saveStore(store);
  return {
    record,
    previousStatus,
    nextStatus: record.status,
    previousBillingStatus,
    nextBillingStatus: record.billing.stripeSubscriptionStatus,
    path: storePath(),
    matchReason,
  };
}

export function resetAccountStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
