import type {
  HostedBillingExportChargeRecord,
  HostedBillingExportInvoiceLineItemRecord,
  HostedBillingExportInvoiceRecord,
  HostedBillingExportPayload,
} from './billing-export.js';

export type BillingReconciliationCheckStatus = 'match' | 'mismatch' | 'unavailable';
export type BillingReconciliationInvoiceStatus = 'reconciled' | 'partial' | 'needs_attention';
export type BillingReconciliationSummaryStatus = 'reconciled' | 'partial' | 'needs_attention' | 'empty';
export type BillingReconciliationBasis = 'invoice_amount_due' | 'invoice_amount_paid' | null;

export interface HostedBillingReconciliationCheck {
  status: BillingReconciliationCheckStatus;
  basis: BillingReconciliationBasis;
  expectedAmount: number | null;
  actualAmount: number | null;
}

export interface HostedBillingReconciliationInvoiceRecord {
  invoiceId: string;
  source: HostedBillingExportInvoiceRecord['source'];
  currency: string | null;
  invoiceStatus: string | null;
  amountPaid: number | null;
  amountDue: number | null;
  chargeCount: number;
  lineItemCount: number;
  chargeAmountTotal: number | null;
  chargeNetAmountTotal: number | null;
  lineItemAmountTotal: number | null;
  lineItemSubtotalTotal: number | null;
  checks: {
    lineItemsVsInvoice: HostedBillingReconciliationCheck;
    chargesVsInvoicePaid: HostedBillingReconciliationCheck;
    netChargesVsInvoicePaid: HostedBillingReconciliationCheck;
  };
  overallStatus: BillingReconciliationInvoiceStatus;
  reasons: string[];
}

export interface HostedBillingReconciliationPayload {
  invoices: HostedBillingReconciliationInvoiceRecord[];
  summary: {
    status: BillingReconciliationSummaryStatus;
    dataSource: HostedBillingExportPayload['summary']['dataSource'];
    sharedBillingLedger: boolean;
    invoiceCount: number;
    reconciledCount: number;
    partialCount: number;
    attentionCount: number;
    chargeRecordCount: number;
    lineItemRecordCount: number;
  };
}

function sumKnown(values: Array<number | null | undefined>): number | null {
  let sawNumber = false;
  let total = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    sawNumber = true;
    total += value;
  }
  return sawNumber ? total : null;
}

function sumNetCharges(records: HostedBillingExportChargeRecord[]): number | null {
  let sawNumber = false;
  let total = 0;
  for (const record of records) {
    if (typeof record.amount !== 'number' || !Number.isFinite(record.amount)) continue;
    sawNumber = true;
    total += record.amount - (typeof record.amountRefunded === 'number' && Number.isFinite(record.amountRefunded) ? record.amountRefunded : 0);
  }
  return sawNumber ? total : null;
}

function expectedInvoiceAmount(invoice: HostedBillingExportInvoiceRecord): {
  basis: BillingReconciliationBasis;
  amount: number | null;
} {
  if (typeof invoice.amountDue === 'number' && Number.isFinite(invoice.amountDue)) {
    return {
      basis: 'invoice_amount_due',
      amount: invoice.amountDue,
    };
  }
  if (typeof invoice.amountPaid === 'number' && Number.isFinite(invoice.amountPaid)) {
    return {
      basis: 'invoice_amount_paid',
      amount: invoice.amountPaid,
    };
  }
  return {
    basis: null,
    amount: null,
  };
}

function expectedPaidAmount(invoice: HostedBillingExportInvoiceRecord): {
  basis: BillingReconciliationBasis;
  amount: number | null;
} {
  if (typeof invoice.amountPaid === 'number' && Number.isFinite(invoice.amountPaid)) {
    return {
      basis: 'invoice_amount_paid',
      amount: invoice.amountPaid,
    };
  }
  if (
    invoice.status === 'paid'
    && typeof invoice.amountDue === 'number'
    && Number.isFinite(invoice.amountDue)
  ) {
    return {
      basis: 'invoice_amount_paid',
      amount: invoice.amountDue,
    };
  }
  return {
    basis: null,
    amount: null,
  };
}

function buildCheck(options: {
  expected: number | null;
  actual: number | null;
  basis: BillingReconciliationBasis;
  recordCount: number;
  allowZeroWithoutRecords?: boolean;
}): HostedBillingReconciliationCheck {
  if (options.expected === null || options.basis === null) {
    return {
      status: 'unavailable',
      basis: options.basis,
      expectedAmount: options.expected,
      actualAmount: options.actual,
    };
  }
  if (options.recordCount === 0) {
    if (options.allowZeroWithoutRecords && options.expected === 0) {
      return {
        status: 'match',
        basis: options.basis,
        expectedAmount: options.expected,
        actualAmount: 0,
      };
    }
    return {
      status: 'unavailable',
      basis: options.basis,
      expectedAmount: options.expected,
      actualAmount: options.actual,
    };
  }
  if (options.actual === null) {
    return {
      status: 'unavailable',
      basis: options.basis,
      expectedAmount: options.expected,
      actualAmount: null,
    };
  }
  return {
    status: options.actual === options.expected ? 'match' : 'mismatch',
    basis: options.basis,
    expectedAmount: options.expected,
    actualAmount: options.actual,
  };
}

function buildInvoiceReconciliation(options: {
  invoice: HostedBillingExportInvoiceRecord;
  charges: HostedBillingExportChargeRecord[];
  lineItems: HostedBillingExportInvoiceLineItemRecord[];
}): HostedBillingReconciliationInvoiceRecord {
  const invoiceExpected = expectedInvoiceAmount(options.invoice);
  const paidExpected = expectedPaidAmount(options.invoice);
  const settledCharges = options.charges.filter((record) => record.status === 'succeeded' && record.paid !== false);
  const chargeAmountTotal = settledCharges.length > 0
    ? sumKnown(settledCharges.map((record) => record.amount))
    : options.charges.length > 0
      ? 0
      : null;
  const chargeNetAmountTotal = settledCharges.length > 0
    ? sumNetCharges(settledCharges)
    : options.charges.length > 0
      ? 0
      : null;
  const lineItemAmountTotal = sumKnown(options.lineItems.map((record) => record.amount));
  const lineItemSubtotalTotal = sumKnown(options.lineItems.map((record) => record.subtotal));

  const lineItemsVsInvoice = buildCheck({
    expected: invoiceExpected.amount,
    actual: lineItemAmountTotal,
    basis: invoiceExpected.basis,
    recordCount: options.lineItems.length,
  });
  const chargesVsInvoicePaid = buildCheck({
    expected: paidExpected.amount,
    actual: chargeAmountTotal,
    basis: paidExpected.basis,
    recordCount: options.charges.length,
    allowZeroWithoutRecords: true,
  });
  const netChargesVsInvoicePaid = buildCheck({
    expected: paidExpected.amount,
    actual: chargeNetAmountTotal,
    basis: paidExpected.basis,
    recordCount: options.charges.length,
    allowZeroWithoutRecords: true,
  });

  const reasons: string[] = [];
  if (lineItemsVsInvoice.status === 'mismatch') reasons.push('line_item_total_mismatch');
  if (lineItemsVsInvoice.status === 'unavailable' && options.lineItems.length === 0 && invoiceExpected.amount !== null) {
    reasons.push('missing_line_items');
  }
  if (chargesVsInvoicePaid.status === 'mismatch') reasons.push('charge_total_mismatch');
  if (chargesVsInvoicePaid.status === 'unavailable' && options.charges.length === 0 && paidExpected.amount !== null && paidExpected.amount > 0) {
    reasons.push('missing_charge_records');
  }
  if (netChargesVsInvoicePaid.status === 'mismatch') reasons.push('net_charge_total_mismatch');

  const anyMismatch =
    lineItemsVsInvoice.status === 'mismatch'
    || chargesVsInvoicePaid.status === 'mismatch'
    || netChargesVsInvoicePaid.status === 'mismatch';
  const anyUnavailable =
    lineItemsVsInvoice.status === 'unavailable'
    || chargesVsInvoicePaid.status === 'unavailable'
    || netChargesVsInvoicePaid.status === 'unavailable';

  return {
    invoiceId: options.invoice.invoiceId,
    source: options.invoice.source,
    currency: options.invoice.currency,
    invoiceStatus: options.invoice.status,
    amountPaid: options.invoice.amountPaid,
    amountDue: options.invoice.amountDue,
    chargeCount: options.charges.length,
    lineItemCount: options.lineItems.length,
    chargeAmountTotal,
    chargeNetAmountTotal,
    lineItemAmountTotal,
    lineItemSubtotalTotal,
    checks: {
      lineItemsVsInvoice,
      chargesVsInvoicePaid,
      netChargesVsInvoicePaid,
    },
    overallStatus: anyMismatch ? 'needs_attention' : anyUnavailable ? 'partial' : 'reconciled',
    reasons,
  };
}

export function buildHostedBillingReconciliation(
  payload: HostedBillingExportPayload,
): HostedBillingReconciliationPayload {
  const records = payload.invoices.map((invoice) => buildInvoiceReconciliation({
    invoice,
    charges: payload.charges.filter((record) => record.invoiceId === invoice.invoiceId),
    lineItems: payload.lineItems.filter((record) => record.invoiceId === invoice.invoiceId),
  }));

  const reconciledCount = records.filter((record) => record.overallStatus === 'reconciled').length;
  const partialCount = records.filter((record) => record.overallStatus === 'partial').length;
  const attentionCount = records.filter((record) => record.overallStatus === 'needs_attention').length;

  return {
    invoices: records,
    summary: {
      status: records.length === 0
        ? 'empty'
        : attentionCount > 0
          ? 'needs_attention'
          : partialCount > 0
            ? 'partial'
            : 'reconciled',
      dataSource: payload.summary.dataSource,
      sharedBillingLedger: payload.summary.sharedBillingLedger,
      invoiceCount: records.length,
      reconciledCount,
      partialCount,
      attentionCount,
      chargeRecordCount: payload.charges.length,
      lineItemRecordCount: payload.lineItems.length,
    },
  };
}
