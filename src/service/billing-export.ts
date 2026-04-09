import type { HostedAccountRecord } from './account-store.js';
import type { HostedBillingEntitlementRecord } from './billing-entitlement-store.js';
import {
  isBillingEventLedgerConfigured,
  listBillingCharges,
  listBillingEvents,
  type BillingChargeRecord,
  type BillingEventRecord,
} from './billing-event-ledger.js';
import {
  exportHostedStripeBillingSnapshot,
  type HostedStripeChargeSnapshot,
  type HostedStripeActiveEntitlementSnapshot,
  type HostedStripeInvoiceSnapshot,
  type HostedStripeInvoiceLineItemSnapshot,
} from './stripe-billing.js';
import {
  listBillingInvoiceLineItems,
  type BillingInvoiceLineItemRecord,
} from './billing-event-ledger.js';

export interface HostedBillingExportCheckoutSummary {
  sessionId: string | null;
  completedAt: string | null;
  planId: string | null;
}

export interface HostedBillingExportInvoiceRecord {
  invoiceId: string;
  status: string | null;
  currency: string | null;
  amountPaid: number | null;
  amountDue: number | null;
  subscriptionId: string | null;
  priceId: string | null;
  billingReason: string | null;
  createdAt: string | null;
  paidAt: string | null;
  lastEventType: string | null;
  source: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary';
}

export interface HostedBillingExportChargeRecord {
  chargeId: string | null;
  invoiceId: string | null;
  amount: number | null;
  amountRefunded: number | null;
  currency: string | null;
  status: 'succeeded' | 'pending' | 'failed' | null;
  paid: boolean | null;
  refunded: boolean | null;
  createdAt: string | null;
  source: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary';
}

export interface HostedBillingExportInvoiceLineItemRecord {
  lineItemId: string;
  invoiceId: string;
  subscriptionId: string | null;
  priceId: string | null;
  description: string | null;
  currency: string | null;
  amount: number | null;
  subtotal: number | null;
  quantity: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  proration: boolean | null;
  captureMode: 'full' | 'partial';
  source: 'stripe_live' | 'ledger_derived' | 'mock_summary';
}

export interface HostedBillingExportPayload {
  accountId: string;
  tenantId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  checkout: HostedBillingExportCheckoutSummary;
  invoices: HostedBillingExportInvoiceRecord[];
  charges: HostedBillingExportChargeRecord[];
  lineItems: HostedBillingExportInvoiceLineItemRecord[];
  entitlementFeatures: {
    lookupKeys: string[];
    featureIds: string[];
    source: 'stripe_live' | 'entitlement_read_model' | 'none';
  };
  summary: {
    dataSource: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary' | 'empty';
    mock: boolean;
    sharedBillingLedger: boolean;
    requestedLimit: number;
    invoiceCount: number;
    chargeCount: number;
    lineItemCount: number;
  };
}

function isoOrNull(value: string | null | undefined): string | null {
  return value && value.trim() !== '' ? value : null;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function newestRecord(a: BillingEventRecord, b: BillingEventRecord): BillingEventRecord {
  const aTs = Date.parse(a.processedAt ?? a.receivedAt);
  const bTs = Date.parse(b.processedAt ?? b.receivedAt);
  return aTs >= bTs ? a : b;
}

function newestNonNullValue<T>(
  records: BillingEventRecord[],
  selector: (record: BillingEventRecord) => T | null | undefined,
): T | null {
  let selected: T | null = null;
  let selectedTs = -Infinity;
  for (const record of records) {
    const value = selector(record);
    if (value === null || value === undefined) continue;
    const ts = Date.parse(record.processedAt ?? record.receivedAt);
    if (ts >= selectedTs) {
      selected = value;
      selectedTs = ts;
    }
  }
  return selected;
}

function deriveInvoicesFromLedger(records: BillingEventRecord[]): HostedBillingExportInvoiceRecord[] {
  const groups = new Map<string, BillingEventRecord[]>();
  for (const record of records) {
    if (!record.stripeInvoiceId) continue;
    const existing = groups.get(record.stripeInvoiceId);
    if (existing) existing.push(record);
    else groups.set(record.stripeInvoiceId, [record]);
  }
  return Array.from(groups.entries())
    .map<HostedBillingExportInvoiceRecord>(([invoiceId, invoiceRecords]) => {
      const latest = invoiceRecords.reduce(newestRecord);
      return {
        invoiceId,
        status: newestNonNullValue(invoiceRecords, (record) => record.stripeInvoiceStatus),
        currency: newestNonNullValue(invoiceRecords, (record) => record.stripeInvoiceCurrency),
        amountPaid: newestNonNullValue(invoiceRecords, (record) => record.stripeInvoiceAmountPaid),
        amountDue: newestNonNullValue(invoiceRecords, (record) => record.stripeInvoiceAmountDue),
        subscriptionId: newestNonNullValue(invoiceRecords, (record) => record.stripeSubscriptionId),
        priceId: newestNonNullValue(invoiceRecords, (record) => record.stripePriceId),
        billingReason: newestNonNullValue(invoiceRecords, (record) => metadataString(record.metadata, 'billingReason')),
        createdAt: latest.receivedAt,
        paidAt: newestNonNullValue(invoiceRecords, (record) => (
          metadataString(record.metadata, 'paidAt')
          ?? (record.eventType === 'invoice.paid' ? (record.processedAt ?? record.receivedAt) : null)
        )),
        lastEventType: latest.eventType,
        source: 'ledger_derived',
      };
    })
    .sort((left, right) => Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? ''));
}

function deriveChargesFromLedger(records: BillingChargeRecord[]): HostedBillingExportChargeRecord[] {
  return records
    .map((record) => ({
      chargeId: record.stripeChargeId,
      invoiceId: record.stripeInvoiceId,
      amount: record.amount,
      amountRefunded: record.amountRefunded,
      currency: record.currency,
      status: record.status,
      paid: record.paid,
      refunded: record.refunded,
      createdAt: record.createdAt,
      source: 'ledger_derived' as const,
    }))
    .sort((left, right) => Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? ''));
}

function deriveLineItemsFromLedger(records: BillingInvoiceLineItemRecord[]): HostedBillingExportInvoiceLineItemRecord[] {
  return records
    .map((record) => ({
      lineItemId: record.stripeInvoiceLineItemId,
      invoiceId: record.stripeInvoiceId,
      subscriptionId: record.stripeSubscriptionId,
      priceId: record.stripePriceId,
      description: record.description,
      currency: record.currency,
      amount: record.amount,
      subtotal: record.subtotal,
      quantity: record.quantity,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      proration: record.proration,
      captureMode: record.captureMode,
      source: 'ledger_derived' as const,
    }))
    .sort((left, right) => Date.parse(right.periodStart ?? right.periodEnd ?? '') - Date.parse(left.periodStart ?? left.periodEnd ?? ''));
}

function summaryInvoices(account: HostedAccountRecord): HostedBillingExportInvoiceRecord[] {
  return account.billing.lastInvoiceId
    ? [{
        invoiceId: account.billing.lastInvoiceId,
        status: account.billing.lastInvoiceStatus,
        currency: account.billing.lastInvoiceCurrency,
        amountPaid: account.billing.lastInvoiceAmountPaid,
        amountDue: account.billing.lastInvoiceAmountDue,
        subscriptionId: account.billing.stripeSubscriptionId,
        priceId: account.billing.stripePriceId,
        billingReason: null,
        createdAt: account.billing.lastInvoiceProcessedAt ?? account.billing.lastWebhookProcessedAt,
        paidAt: account.billing.lastInvoicePaidAt,
        lastEventType: account.billing.lastInvoiceEventType,
        source: 'summary_only',
      }]
    : [];
}

function summaryCharges(account: HostedAccountRecord): HostedBillingExportChargeRecord[] {
  return account.billing.lastInvoiceId && account.billing.lastInvoiceStatus === 'paid'
    ? [{
        chargeId: null,
        invoiceId: account.billing.lastInvoiceId,
        amount: account.billing.lastInvoiceAmountPaid,
        amountRefunded: 0,
        currency: account.billing.lastInvoiceCurrency,
        status: 'succeeded',
        paid: true,
        refunded: false,
        createdAt: account.billing.lastInvoicePaidAt ?? account.billing.lastInvoiceProcessedAt,
        source: 'summary_only',
      }]
    : [];
}

function mapStripeInvoices(records: HostedStripeInvoiceSnapshot[]): HostedBillingExportInvoiceRecord[] {
  return records.map<HostedBillingExportInvoiceRecord>((record) => ({
    invoiceId: record.invoiceId,
    status: record.status,
    currency: record.currency,
    amountPaid: record.amountPaid,
    amountDue: record.amountDue,
    subscriptionId: record.subscriptionId,
    priceId: record.priceId,
    billingReason: record.billingReason,
    createdAt: record.createdAt,
    paidAt: record.paidAt,
    lastEventType: null,
    source: record.source === 'mock_summary' ? 'mock_summary' : 'stripe_live',
  }));
}

function mapStripeCharges(records: HostedStripeChargeSnapshot[]): HostedBillingExportChargeRecord[] {
  return records.map<HostedBillingExportChargeRecord>((record) => ({
    chargeId: record.chargeId,
    invoiceId: record.invoiceId,
    amount: record.amount,
    amountRefunded: record.amountRefunded,
    currency: record.currency,
    status: record.status,
    paid: record.paid,
    refunded: record.refunded,
    createdAt: record.createdAt,
    source: record.source === 'mock_summary' ? 'mock_summary' : 'stripe_live',
  }));
}

function mapStripeLineItems(records: HostedStripeInvoiceLineItemSnapshot[]): HostedBillingExportInvoiceLineItemRecord[] {
  return records.map<HostedBillingExportInvoiceLineItemRecord>((record) => ({
    lineItemId: record.lineItemId,
    invoiceId: record.invoiceId,
    subscriptionId: record.subscriptionId,
    priceId: record.priceId,
    description: record.description,
    currency: record.currency,
    amount: record.amount,
    subtotal: record.subtotal,
    quantity: record.quantity,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    proration: record.proration,
    captureMode: record.captureMode,
    source: record.source === 'mock_summary' ? 'mock_summary' : 'stripe_live',
  }));
}

function mapStripeEntitlements(records: HostedStripeActiveEntitlementSnapshot[]): {
  lookupKeys: string[];
  featureIds: string[];
  source: 'stripe_live';
} {
  return {
    lookupKeys: [...new Set(records.map((record) => record.lookupKey).filter((value) => value.trim() !== ''))].sort(),
    featureIds: [...new Set(records.map((record) => record.featureId ?? '').filter((value) => value.trim() !== ''))].sort(),
    source: 'stripe_live',
  };
}

function mapEntitlementReadModel(record: HostedBillingEntitlementRecord | null | undefined): {
  lookupKeys: string[];
  featureIds: string[];
  source: 'entitlement_read_model' | 'none';
} {
  const lookupKeys = [...new Set(record?.stripeEntitlementLookupKeys ?? [])];
  const featureIds = [...new Set(record?.stripeEntitlementFeatureIds ?? [])];
  return {
    lookupKeys,
    featureIds,
    source: lookupKeys.length > 0 || featureIds.length > 0 ? 'entitlement_read_model' : 'none',
  };
}

export async function buildHostedBillingExport(options: {
  account: HostedAccountRecord;
  entitlement?: HostedBillingEntitlementRecord | null;
  limit?: number | null;
}): Promise<HostedBillingExportPayload> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const sharedBillingLedger = isBillingEventLedgerConfigured();
  const stripeSnapshot = await exportHostedStripeBillingSnapshot({
    account: options.account,
    limit,
  });

  const ledgerRecords = sharedBillingLedger
    ? await listBillingEvents({
        provider: 'stripe',
        accountId: options.account.id,
        limit: Math.max(limit * 5, 50),
      })
    : [];
  const ledgerLineItems = sharedBillingLedger
    ? await listBillingInvoiceLineItems({
        accountId: options.account.id,
        limit: Math.max(limit * 50, 250),
      })
    : [];
  const ledgerCharges = sharedBillingLedger
    ? await listBillingCharges({
        accountId: options.account.id,
        limit: Math.max(limit * 10, 100),
      })
    : [];

  let invoices: HostedBillingExportInvoiceRecord[] = [];
  let charges: HostedBillingExportChargeRecord[] = [];
  let lineItems: HostedBillingExportInvoiceLineItemRecord[] = [];
  let entitlementFeatures: HostedBillingExportPayload['entitlementFeatures'] = {
    lookupKeys: [],
    featureIds: [],
    source: 'none',
  };
  let dataSource: HostedBillingExportPayload['summary']['dataSource'] = 'empty';

  if (stripeSnapshot.source === 'stripe_live') {
    invoices = mapStripeInvoices(stripeSnapshot.invoices);
    charges = mapStripeCharges(stripeSnapshot.charges);
    lineItems = mapStripeLineItems(stripeSnapshot.lineItems);
    entitlementFeatures = mapStripeEntitlements(stripeSnapshot.entitlements);
    dataSource = 'stripe_live';
  } else if (ledgerRecords.length > 0 || ledgerCharges.length > 0 || ledgerLineItems.length > 0) {
    invoices = deriveInvoicesFromLedger(ledgerRecords).slice(0, limit);
    charges = deriveChargesFromLedger(ledgerCharges).slice(0, limit);
    const invoiceIds = new Set(invoices.map((invoice) => invoice.invoiceId));
    lineItems = deriveLineItemsFromLedger(ledgerLineItems)
      .filter((lineItem) => invoiceIds.has(lineItem.invoiceId))
      .slice(0, Math.max(limit * 25, 100));
    entitlementFeatures = mapEntitlementReadModel(options.entitlement);
    dataSource = 'ledger_derived';
  } else if (stripeSnapshot.source === 'mock_summary') {
    invoices = mapStripeInvoices(stripeSnapshot.invoices);
    charges = mapStripeCharges(stripeSnapshot.charges);
    lineItems = mapStripeLineItems(stripeSnapshot.lineItems);
    entitlementFeatures = mapEntitlementReadModel(options.entitlement);
    dataSource = 'mock_summary';
  } else {
    invoices = summaryInvoices(options.account);
    charges = summaryCharges(options.account);
    lineItems = [];
    entitlementFeatures = mapEntitlementReadModel(options.entitlement);
    dataSource = invoices.length > 0 || charges.length > 0 ? 'summary_only' : 'empty';
  }

  return {
    accountId: options.account.id,
    tenantId: options.account.primaryTenantId,
    stripeCustomerId: options.account.billing.stripeCustomerId,
    stripeSubscriptionId: options.account.billing.stripeSubscriptionId,
    checkout: {
      sessionId: options.account.billing.lastCheckoutSessionId,
      completedAt: isoOrNull(options.account.billing.lastCheckoutCompletedAt),
      planId: options.account.billing.lastCheckoutPlanId,
    },
    invoices,
    charges,
    lineItems,
    entitlementFeatures,
    summary: {
      dataSource,
      mock: stripeSnapshot.mock,
      sharedBillingLedger,
      requestedLimit: limit,
      invoiceCount: invoices.length,
      chargeCount: charges.length,
      lineItemCount: lineItems.length,
    },
  };
}

function escapeCsv(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function renderHostedBillingExportCsv(payload: HostedBillingExportPayload): string {
  const rows: string[] = [
    [
      'recordType',
      'accountId',
      'tenantId',
      'source',
      'invoiceId',
      'lineItemId',
      'chargeId',
      'status',
      'currency',
      'amountPaid',
      'amountDue',
      'amount',
      'amountRefunded',
      'subtotal',
      'subscriptionId',
      'priceId',
      'billingReason',
      'description',
      'quantity',
      'periodStart',
      'periodEnd',
      'proration',
      'captureMode',
      'createdAt',
      'paidAt',
      'refunded',
      'lastEventType',
    ].join(','),
  ];

  for (const invoice of payload.invoices) {
    rows.push([
      'invoice',
      payload.accountId,
      payload.tenantId,
      invoice.source,
      invoice.invoiceId,
      '',
      '',
      invoice.status ?? '',
      invoice.currency ?? '',
      invoice.amountPaid === null ? '' : String(invoice.amountPaid),
      invoice.amountDue === null ? '' : String(invoice.amountDue),
      '',
      '',
      '',
      invoice.subscriptionId ?? '',
      invoice.priceId ?? '',
      invoice.billingReason ?? '',
      '',
      '',
      '',
      '',
      '',
      '',
      invoice.createdAt ?? '',
      invoice.paidAt ?? '',
      '',
      invoice.lastEventType ?? '',
    ].map(escapeCsv).join(','));
  }

  for (const charge of payload.charges) {
    rows.push([
      'charge',
      payload.accountId,
      payload.tenantId,
      charge.source,
      charge.invoiceId ?? '',
      '',
      charge.chargeId ?? '',
      charge.status ?? '',
      charge.currency ?? '',
      '',
      '',
      charge.amount === null ? '' : String(charge.amount),
      charge.amountRefunded === null ? '' : String(charge.amountRefunded),
      '',
      payload.stripeSubscriptionId ?? '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      charge.createdAt ?? '',
      '',
      charge.refunded === null ? '' : String(charge.refunded),
      '',
    ].map(escapeCsv).join(','));
  }

  for (const lineItem of payload.lineItems) {
    rows.push([
      'line_item',
      payload.accountId,
      payload.tenantId,
      lineItem.source,
      lineItem.invoiceId,
      lineItem.lineItemId,
      '',
      '',
      lineItem.currency ?? '',
      '',
      '',
      lineItem.amount === null ? '' : String(lineItem.amount),
      '',
      lineItem.subtotal === null ? '' : String(lineItem.subtotal),
      lineItem.subscriptionId ?? '',
      lineItem.priceId ?? '',
      '',
      lineItem.description ?? '',
      lineItem.quantity === null ? '' : String(lineItem.quantity),
      lineItem.periodStart ?? '',
      lineItem.periodEnd ?? '',
      lineItem.proration === null ? '' : String(lineItem.proration),
      lineItem.captureMode,
      '',
      '',
      '',
      '',
    ].map(escapeCsv).join(','));
  }

  return `${rows.join('\n')}\n`;
}
