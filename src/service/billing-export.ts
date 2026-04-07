import type { HostedAccountRecord } from './account-store.js';
import {
  isBillingEventLedgerConfigured,
  listBillingEvents,
  type BillingEventRecord,
} from './billing-event-ledger.js';
import {
  exportHostedStripeBillingSnapshot,
  type HostedStripeChargeSnapshot,
  type HostedStripeInvoiceSnapshot,
} from './stripe-billing.js';

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
  currency: string | null;
  status: 'succeeded' | 'pending' | 'failed' | null;
  paid: boolean | null;
  refunded: boolean | null;
  createdAt: string | null;
  source: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary';
}

export interface HostedBillingExportPayload {
  accountId: string;
  tenantId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  checkout: HostedBillingExportCheckoutSummary;
  invoices: HostedBillingExportInvoiceRecord[];
  charges: HostedBillingExportChargeRecord[];
  summary: {
    dataSource: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary' | 'empty';
    mock: boolean;
    sharedBillingLedger: boolean;
    requestedLimit: number;
    invoiceCount: number;
    chargeCount: number;
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
        status: latest.stripeInvoiceStatus,
        currency: latest.stripeInvoiceCurrency,
        amountPaid: latest.stripeInvoiceAmountPaid,
        amountDue: latest.stripeInvoiceAmountDue,
        subscriptionId: latest.stripeSubscriptionId,
        priceId: latest.stripePriceId,
        billingReason: metadataString(latest.metadata, 'billingReason'),
        createdAt: latest.receivedAt,
        paidAt: metadataString(latest.metadata, 'paidAt') ?? (latest.eventType === 'invoice.paid' ? (latest.processedAt ?? latest.receivedAt) : null),
        lastEventType: latest.eventType,
        source: 'ledger_derived',
      };
    })
    .sort((left, right) => Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? ''));
}

function deriveChargesFromLedger(records: BillingEventRecord[]): HostedBillingExportChargeRecord[] {
  return records
    .filter((record) => record.eventType === 'invoice.paid' && record.outcome === 'applied' && record.stripeInvoiceId)
    .map((record) => ({
      chargeId: null,
      invoiceId: record.stripeInvoiceId,
      amount: record.stripeInvoiceAmountPaid,
      currency: record.stripeInvoiceCurrency,
      status: 'succeeded' as const,
      paid: true,
      refunded: false,
      createdAt: metadataString(record.metadata, 'paidAt') ?? record.processedAt ?? record.receivedAt,
      source: 'ledger_derived' as const,
    }))
    .sort((left, right) => Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? ''));
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
    currency: record.currency,
    status: record.status,
    paid: record.paid,
    refunded: record.refunded,
    createdAt: record.createdAt,
    source: record.source === 'mock_summary' ? 'mock_summary' : 'stripe_live',
  }));
}

export async function buildHostedBillingExport(options: {
  account: HostedAccountRecord;
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

  let invoices: HostedBillingExportInvoiceRecord[] = [];
  let charges: HostedBillingExportChargeRecord[] = [];
  let dataSource: HostedBillingExportPayload['summary']['dataSource'] = 'empty';

  if (stripeSnapshot.source === 'stripe_live') {
    invoices = mapStripeInvoices(stripeSnapshot.invoices);
    charges = mapStripeCharges(stripeSnapshot.charges);
    dataSource = 'stripe_live';
  } else if (ledgerRecords.length > 0) {
    invoices = deriveInvoicesFromLedger(ledgerRecords).slice(0, limit);
    charges = deriveChargesFromLedger(ledgerRecords).slice(0, limit);
    dataSource = 'ledger_derived';
  } else if (stripeSnapshot.source === 'mock_summary') {
    invoices = mapStripeInvoices(stripeSnapshot.invoices);
    charges = mapStripeCharges(stripeSnapshot.charges);
    dataSource = 'mock_summary';
  } else {
    invoices = summaryInvoices(options.account);
    charges = summaryCharges(options.account);
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
    summary: {
      dataSource,
      mock: stripeSnapshot.mock,
      sharedBillingLedger,
      requestedLimit: limit,
      invoiceCount: invoices.length,
      chargeCount: charges.length,
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
      'chargeId',
      'status',
      'currency',
      'amountPaid',
      'amountDue',
      'amount',
      'subscriptionId',
      'priceId',
      'billingReason',
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
      invoice.status ?? '',
      invoice.currency ?? '',
      invoice.amountPaid === null ? '' : String(invoice.amountPaid),
      invoice.amountDue === null ? '' : String(invoice.amountDue),
      '',
      invoice.subscriptionId ?? '',
      invoice.priceId ?? '',
      invoice.billingReason ?? '',
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
      charge.chargeId ?? '',
      charge.status ?? '',
      charge.currency ?? '',
      '',
      '',
      charge.amount === null ? '' : String(charge.amount),
      payload.stripeSubscriptionId ?? '',
      '',
      '',
      charge.createdAt ?? '',
      '',
      charge.refunded === null ? '' : String(charge.refunded),
      '',
    ].map(escapeCsv).join(','));
  }

  return `${rows.join('\n')}\n`;
}
