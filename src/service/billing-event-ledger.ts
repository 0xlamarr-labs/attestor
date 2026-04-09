/**
 * Billing Event Ledger — Shared PostgreSQL-backed billing event truth.
 *
 * BOUNDARY:
 * - Optional PostgreSQL-backed shared ledger for billing webhook events
 * - Cross-node duplicate suppression via unique provider event ids
 * - Captures checkout completion, invoice lifecycle summaries, and invoice line-item truth
 */

import { randomUUID } from 'node:crypto';
import { hashJsonValue } from './json-stable.js';

export type BillingEventProvider = 'stripe';
export type BillingEventSource = 'stripe_webhook';
export type BillingEventOutcome = 'pending' | 'applied' | 'ignored';
export type BillingAccountStatus = 'active' | 'suspended' | 'archived' | null;
export type BillingSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'
  | null;
export type BillingInvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'uncollectible'
  | 'void'
  | null;
export type BillingInvoiceLineItemSource = 'stripe_webhook' | 'stripe_live_fetch';
export type BillingInvoiceLineItemCaptureMode = 'full' | 'partial';

export interface BillingEventRecord {
  id: string;
  provider: BillingEventProvider;
  source: BillingEventSource;
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  outcome: BillingEventOutcome;
  reason: string | null;
  accountId: string | null;
  tenantId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeInvoiceId: string | null;
  stripeInvoiceStatus: BillingInvoiceStatus;
  stripeInvoiceCurrency: string | null;
  stripeInvoiceAmountPaid: number | null;
  stripeInvoiceAmountDue: number | null;
  accountStatusBefore: BillingAccountStatus;
  accountStatusAfter: BillingAccountStatus;
  billingStatusBefore: BillingSubscriptionStatus;
  billingStatusAfter: BillingSubscriptionStatus;
  mappedPlanId: string | null;
  receivedAt: string;
  processedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface BillingInvoiceLineItemRecord {
  id: string;
  provider: BillingEventProvider;
  accountId: string | null;
  tenantId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeInvoiceId: string;
  stripeInvoiceLineItemId: string;
  stripePriceId: string | null;
  description: string | null;
  currency: string | null;
  amount: number | null;
  subtotal: number | null;
  quantity: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  proration: boolean | null;
  source: BillingInvoiceLineItemSource;
  captureMode: BillingInvoiceLineItemCaptureMode;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type BillingEventClaim =
  | { kind: 'claimed'; payloadHash: string; record: BillingEventRecord }
  | { kind: 'duplicate'; payloadHash: string; record: BillingEventRecord }
  | { kind: 'conflict'; payloadHash: string; record: BillingEventRecord };

export interface BillingEventListFilters {
  accountId?: string | null;
  tenantId?: string | null;
  provider?: BillingEventProvider | null;
  eventType?: string | null;
  outcome?: Exclude<BillingEventOutcome, 'pending'> | null;
  limit?: number | null;
}

export interface BillingEventLedgerSnapshot {
  version: 2;
  provider: 'stripe';
  exportedAt: string;
  eventRecordCount: number;
  lineItemRecordCount: number;
  recordCount: number;
  records: BillingEventRecord[];
  lineItems: BillingInvoiceLineItemRecord[];
}

export interface BillingInvoiceLineItemInput {
  stripeInvoiceLineItemId: string;
  stripePriceId?: string | null;
  description?: string | null;
  currency?: string | null;
  amount?: number | null;
  subtotal?: number | null;
  quantity?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  proration?: boolean | null;
  metadata?: Record<string, unknown>;
}

export interface BillingInvoiceLineItemListFilters {
  accountId?: string | null;
  tenantId?: string | null;
  stripeInvoiceId?: string | null;
  limit?: number | null;
}

type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

let poolPromise: Promise<PgPool> | null = null;
let initPromise: Promise<void> | null = null;

function connectionString(): string | null {
  const direct = process.env.ATTESTOR_BILLING_LEDGER_PG_URL?.trim();
  if (direct) return direct;
  return null;
}

export function billingEventLedgerMode(): 'postgres' | 'disabled' {
  return connectionString() ? 'postgres' : 'disabled';
}

export function isBillingEventLedgerConfigured(): boolean {
  return billingEventLedgerMode() === 'postgres';
}

async function getPool(): Promise<PgPool> {
  const connectionUrl = connectionString();
  if (!connectionUrl) {
    throw new Error('Billing event ledger is disabled. Set ATTESTOR_BILLING_LEDGER_PG_URL.');
  }
  if (!poolPromise) {
    poolPromise = (async () => {
      const pg = await (Function('return import("pg")')() as Promise<any>);
      const Pool = pg.Pool ?? pg.default?.Pool;
      if (!Pool) {
        throw new Error('pg.Pool is not available for the billing event ledger.');
      }
      return new Pool({ connectionString: connectionUrl }) as PgPool;
    })();
  }
  return poolPromise;
}

async function ensureSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = await getPool();
      await pool.query(`
        CREATE SCHEMA IF NOT EXISTS attestor_control_plane;

        CREATE TABLE IF NOT EXISTS attestor_control_plane.billing_event_ledger (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          source TEXT NOT NULL,
          provider_event_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'applied', 'ignored')),
          reason TEXT NULL,
          account_id TEXT NULL,
          tenant_id TEXT NULL,
          stripe_checkout_session_id TEXT NULL,
          stripe_customer_id TEXT NULL,
          stripe_subscription_id TEXT NULL,
          stripe_price_id TEXT NULL,
          stripe_invoice_id TEXT NULL,
          stripe_invoice_status TEXT NULL,
          stripe_invoice_currency TEXT NULL,
          stripe_invoice_amount_paid BIGINT NULL,
          stripe_invoice_amount_due BIGINT NULL,
          account_status_before TEXT NULL,
          account_status_after TEXT NULL,
          billing_status_before TEXT NULL,
          billing_status_after TEXT NULL,
          mapped_plan_id TEXT NULL,
          received_at TIMESTAMPTZ NOT NULL,
          processed_at TIMESTAMPTZ NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        );

        CREATE UNIQUE INDEX IF NOT EXISTS billing_event_ledger_provider_event_idx
          ON attestor_control_plane.billing_event_ledger (provider, provider_event_id);

        CREATE INDEX IF NOT EXISTS billing_event_ledger_account_idx
          ON attestor_control_plane.billing_event_ledger (account_id, received_at DESC);

        CREATE INDEX IF NOT EXISTS billing_event_ledger_tenant_idx
          ON attestor_control_plane.billing_event_ledger (tenant_id, received_at DESC);

        CREATE INDEX IF NOT EXISTS billing_event_ledger_received_idx
          ON attestor_control_plane.billing_event_ledger (received_at DESC);

        ALTER TABLE attestor_control_plane.billing_event_ledger
          ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT NULL,
          ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT NULL,
          ADD COLUMN IF NOT EXISTS stripe_invoice_status TEXT NULL,
          ADD COLUMN IF NOT EXISTS stripe_invoice_currency TEXT NULL,
          ADD COLUMN IF NOT EXISTS stripe_invoice_amount_paid BIGINT NULL,
          ADD COLUMN IF NOT EXISTS stripe_invoice_amount_due BIGINT NULL;

        CREATE TABLE IF NOT EXISTS attestor_control_plane.billing_invoice_line_items (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          account_id TEXT NULL,
          tenant_id TEXT NULL,
          stripe_customer_id TEXT NULL,
          stripe_subscription_id TEXT NULL,
          stripe_invoice_id TEXT NOT NULL,
          stripe_invoice_line_item_id TEXT NOT NULL,
          stripe_price_id TEXT NULL,
          description TEXT NULL,
          currency TEXT NULL,
          amount BIGINT NULL,
          subtotal BIGINT NULL,
          quantity BIGINT NULL,
          period_start TIMESTAMPTZ NULL,
          period_end TIMESTAMPTZ NULL,
          proration BOOLEAN NULL,
          source TEXT NOT NULL CHECK (source IN ('stripe_webhook', 'stripe_live_fetch')),
          capture_mode TEXT NOT NULL CHECK (capture_mode IN ('full', 'partial')),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS billing_invoice_line_items_provider_line_idx
          ON attestor_control_plane.billing_invoice_line_items (provider, stripe_invoice_line_item_id);

        CREATE INDEX IF NOT EXISTS billing_invoice_line_items_invoice_idx
          ON attestor_control_plane.billing_invoice_line_items (stripe_invoice_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS billing_invoice_line_items_account_idx
          ON attestor_control_plane.billing_invoice_line_items (account_id, updated_at DESC);
      `);
    })();
  }
  await initPromise;
}

function payloadHash(rawPayload: string): string {
  return hashJsonValue({ payload: rawPayload });
}

function toNullableObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toNullableInvoiceStatus(value: unknown): BillingInvoiceStatus {
  if (value === null || value === undefined) return null;
  switch (String(value)) {
    case 'draft':
    case 'open':
    case 'paid':
    case 'uncollectible':
    case 'void':
      return String(value) as BillingInvoiceStatus;
    default:
      return null;
  }
}

function rowToRecord(row: Record<string, unknown>): BillingEventRecord {
  return {
    id: String(row.id),
    provider: String(row.provider) as BillingEventProvider,
    source: String(row.source) as BillingEventSource,
    providerEventId: String(row.provider_event_id),
    eventType: String(row.event_type),
    payloadHash: String(row.payload_hash),
    outcome: String(row.outcome) as BillingEventOutcome,
    reason: row.reason === null ? null : String(row.reason),
    accountId: row.account_id === null ? null : String(row.account_id),
    tenantId: row.tenant_id === null ? null : String(row.tenant_id),
    stripeCheckoutSessionId: row.stripe_checkout_session_id === null ? null : String(row.stripe_checkout_session_id),
    stripeCustomerId: row.stripe_customer_id === null ? null : String(row.stripe_customer_id),
    stripeSubscriptionId: row.stripe_subscription_id === null ? null : String(row.stripe_subscription_id),
    stripePriceId: row.stripe_price_id === null ? null : String(row.stripe_price_id),
    stripeInvoiceId: row.stripe_invoice_id === null ? null : String(row.stripe_invoice_id),
    stripeInvoiceStatus: toNullableInvoiceStatus(row.stripe_invoice_status),
    stripeInvoiceCurrency: row.stripe_invoice_currency === null ? null : String(row.stripe_invoice_currency),
    stripeInvoiceAmountPaid: row.stripe_invoice_amount_paid === null ? null : Number(row.stripe_invoice_amount_paid),
    stripeInvoiceAmountDue: row.stripe_invoice_amount_due === null ? null : Number(row.stripe_invoice_amount_due),
    accountStatusBefore: row.account_status_before === null ? null : String(row.account_status_before) as BillingAccountStatus,
    accountStatusAfter: row.account_status_after === null ? null : String(row.account_status_after) as BillingAccountStatus,
    billingStatusBefore: row.billing_status_before === null ? null : String(row.billing_status_before) as BillingSubscriptionStatus,
    billingStatusAfter: row.billing_status_after === null ? null : String(row.billing_status_after) as BillingSubscriptionStatus,
    mappedPlanId: row.mapped_plan_id === null ? null : String(row.mapped_plan_id),
    receivedAt: new Date(String(row.received_at)).toISOString(),
    processedAt: row.processed_at === null ? null : new Date(String(row.processed_at)).toISOString(),
    metadata: toNullableObject(row.metadata),
  };
}

function toNullableLineItemSource(value: unknown): BillingInvoiceLineItemSource {
  return value === 'stripe_live_fetch' ? 'stripe_live_fetch' : 'stripe_webhook';
}

function toNullableCaptureMode(value: unknown): BillingInvoiceLineItemCaptureMode {
  return value === 'partial' ? 'partial' : 'full';
}

function rowToLineItemRecord(row: Record<string, unknown>): BillingInvoiceLineItemRecord {
  return {
    id: String(row.id),
    provider: String(row.provider) as BillingEventProvider,
    accountId: row.account_id === null ? null : String(row.account_id),
    tenantId: row.tenant_id === null ? null : String(row.tenant_id),
    stripeCustomerId: row.stripe_customer_id === null ? null : String(row.stripe_customer_id),
    stripeSubscriptionId: row.stripe_subscription_id === null ? null : String(row.stripe_subscription_id),
    stripeInvoiceId: String(row.stripe_invoice_id),
    stripeInvoiceLineItemId: String(row.stripe_invoice_line_item_id),
    stripePriceId: row.stripe_price_id === null ? null : String(row.stripe_price_id),
    description: row.description === null ? null : String(row.description),
    currency: row.currency === null ? null : String(row.currency),
    amount: row.amount === null ? null : Number(row.amount),
    subtotal: row.subtotal === null ? null : Number(row.subtotal),
    quantity: row.quantity === null ? null : Number(row.quantity),
    periodStart: row.period_start === null ? null : new Date(String(row.period_start)).toISOString(),
    periodEnd: row.period_end === null ? null : new Date(String(row.period_end)).toISOString(),
    proration: row.proration === null ? null : Boolean(row.proration),
    source: toNullableLineItemSource(row.source),
    captureMode: toNullableCaptureMode(row.capture_mode),
    metadata: toNullableObject(row.metadata),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

async function findExistingStripeEvent(providerEventId: string): Promise<BillingEventRecord | null> {
  await ensureSchema();
  const pool = await getPool();
  const result = await pool.query(
    `SELECT * FROM attestor_control_plane.billing_event_ledger
      WHERE provider = 'stripe' AND provider_event_id = $1
      LIMIT 1`,
    [providerEventId],
  );
  if (result.rows.length === 0) return null;
  return rowToRecord(result.rows[0]);
}

export async function claimStripeBillingEvent(input: {
  providerEventId: string;
  eventType: string;
  rawPayload: string;
}): Promise<BillingEventClaim> {
  await ensureSchema();
  const pool = await getPool();
  const requestPayloadHash = payloadHash(input.rawPayload);
  const claimId = `bill_evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const inserted = await pool.query(
    `INSERT INTO attestor_control_plane.billing_event_ledger (
      id,
      provider,
      source,
      provider_event_id,
      event_type,
      payload_hash,
      outcome,
      reason,
      account_id,
      tenant_id,
      stripe_checkout_session_id,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_price_id,
      stripe_invoice_id,
      stripe_invoice_status,
      stripe_invoice_currency,
      stripe_invoice_amount_paid,
      stripe_invoice_amount_due,
      account_status_before,
      account_status_after,
      billing_status_before,
      billing_status_after,
      mapped_plan_id,
      received_at,
      processed_at,
      metadata
    ) VALUES (
      $1,
      'stripe',
      'stripe_webhook',
      $2,
      $3,
      $4,
      'pending',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NOW(),
      NULL,
      '{}'::jsonb
    )
    ON CONFLICT (provider, provider_event_id) DO NOTHING
    RETURNING *`,
    [claimId, input.providerEventId, input.eventType, requestPayloadHash],
  );
  if (inserted.rows.length > 0) {
    const record = rowToRecord(inserted.rows[0]);
    return { kind: 'claimed', payloadHash: requestPayloadHash, record };
  }

  const existing = await findExistingStripeEvent(input.providerEventId);
  if (!existing) {
    throw new Error(`Stripe billing ledger failed to read back event '${input.providerEventId}'.`);
  }
  if (existing.payloadHash !== requestPayloadHash) {
    return { kind: 'conflict', payloadHash: requestPayloadHash, record: existing };
  }
  return { kind: 'duplicate', payloadHash: requestPayloadHash, record: existing };
}

export async function finalizeStripeBillingEvent(input: {
  providerEventId: string;
  outcome: Exclude<BillingEventOutcome, 'pending'>;
  reason?: string | null;
  accountId?: string | null;
  tenantId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  stripeInvoiceId?: string | null;
  stripeInvoiceStatus?: BillingInvoiceStatus;
  stripeInvoiceCurrency?: string | null;
  stripeInvoiceAmountPaid?: number | null;
  stripeInvoiceAmountDue?: number | null;
  accountStatusBefore?: BillingAccountStatus;
  accountStatusAfter?: BillingAccountStatus;
  billingStatusBefore?: BillingSubscriptionStatus;
  billingStatusAfter?: BillingSubscriptionStatus;
  mappedPlanId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<BillingEventRecord> {
  await ensureSchema();
  const pool = await getPool();
  const updated = await pool.query(
    `UPDATE attestor_control_plane.billing_event_ledger
        SET outcome = $2,
            reason = $3,
            account_id = $4,
            tenant_id = $5,
            stripe_checkout_session_id = $6,
            stripe_customer_id = $7,
            stripe_subscription_id = $8,
            stripe_price_id = $9,
            stripe_invoice_id = $10,
            stripe_invoice_status = $11,
            stripe_invoice_currency = $12,
            stripe_invoice_amount_paid = $13,
            stripe_invoice_amount_due = $14,
            account_status_before = $15,
            account_status_after = $16,
            billing_status_before = $17,
            billing_status_after = $18,
            mapped_plan_id = $19,
            processed_at = NOW(),
            metadata = $20::jsonb
      WHERE provider = 'stripe' AND provider_event_id = $1
      RETURNING *`,
    [
      input.providerEventId,
      input.outcome,
      input.reason ?? null,
      input.accountId ?? null,
      input.tenantId ?? null,
      input.stripeCheckoutSessionId ?? null,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.stripePriceId ?? null,
      input.stripeInvoiceId ?? null,
      input.stripeInvoiceStatus ?? null,
      input.stripeInvoiceCurrency ?? null,
      input.stripeInvoiceAmountPaid ?? null,
      input.stripeInvoiceAmountDue ?? null,
      input.accountStatusBefore ?? null,
      input.accountStatusAfter ?? null,
      input.billingStatusBefore ?? null,
      input.billingStatusAfter ?? null,
      input.mappedPlanId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  if (updated.rows.length === 0) {
    throw new Error(`Stripe billing ledger event '${input.providerEventId}' was not claimed before finalize.`);
  }
  return rowToRecord(updated.rows[0]);
}

export async function releaseStripeBillingEventClaim(providerEventId: string): Promise<void> {
  if (!isBillingEventLedgerConfigured()) return;
  await ensureSchema();
  const pool = await getPool();
  await pool.query(
    `DELETE FROM attestor_control_plane.billing_event_ledger
      WHERE provider = 'stripe' AND provider_event_id = $1 AND outcome = 'pending'`,
    [providerEventId],
  );
}

export async function listBillingEvents(filters: BillingEventListFilters = {}): Promise<BillingEventRecord[]> {
  await ensureSchema();
  const pool = await getPool();
  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.accountId) {
    where.push(`account_id = $${idx++}`);
    params.push(filters.accountId);
  }
  if (filters.tenantId) {
    where.push(`tenant_id = $${idx++}`);
    params.push(filters.tenantId);
  }
  if (filters.provider) {
    where.push(`provider = $${idx++}`);
    params.push(filters.provider);
  }
  if (filters.eventType) {
    where.push(`event_type = $${idx++}`);
    params.push(filters.eventType);
  }
  if (filters.outcome) {
    where.push(`outcome = $${idx++}`);
    params.push(filters.outcome);
  }

  const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
  params.push(limit);
  const sql = `
    SELECT *
      FROM attestor_control_plane.billing_event_ledger
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY received_at DESC
      LIMIT $${idx}
  `;
  const result = await pool.query(sql, params);
  return result.rows.map(rowToRecord);
}

export async function upsertStripeInvoiceLineItems(input: {
  accountId: string | null;
  tenantId: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId: string;
  lineItems: BillingInvoiceLineItemInput[];
  source: BillingInvoiceLineItemSource;
  captureMode: BillingInvoiceLineItemCaptureMode;
  replaceExisting?: boolean;
}): Promise<{ recordCount: number }> {
  await ensureSchema();
  const pool = await getPool();
  if (input.replaceExisting) {
    await pool.query(
      `DELETE FROM attestor_control_plane.billing_invoice_line_items
        WHERE provider = 'stripe' AND stripe_invoice_id = $1`,
      [input.stripeInvoiceId],
    );
  }

  let recordCount = 0;
  for (const lineItem of input.lineItems) {
    if (!lineItem.stripeInvoiceLineItemId?.trim()) continue;
    const now = new Date().toISOString();
    const lineId = `bill_line_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await pool.query(
      `INSERT INTO attestor_control_plane.billing_invoice_line_items (
        id, provider, account_id, tenant_id, stripe_customer_id, stripe_subscription_id,
        stripe_invoice_id, stripe_invoice_line_item_id, stripe_price_id, description, currency,
        amount, subtotal, quantity, period_start, period_end, proration, source, capture_mode,
        metadata, created_at, updated_at
      ) VALUES (
        $1, 'stripe', $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14::timestamptz, $15::timestamptz, $16, $17, $18,
        $19::jsonb, $20::timestamptz, $21::timestamptz
      )
      ON CONFLICT (provider, stripe_invoice_line_item_id) DO UPDATE SET
        account_id = EXCLUDED.account_id,
        tenant_id = EXCLUDED.tenant_id,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        stripe_invoice_id = EXCLUDED.stripe_invoice_id,
        stripe_price_id = EXCLUDED.stripe_price_id,
        description = EXCLUDED.description,
        currency = EXCLUDED.currency,
        amount = EXCLUDED.amount,
        subtotal = EXCLUDED.subtotal,
        quantity = EXCLUDED.quantity,
        period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end,
        proration = EXCLUDED.proration,
        source = EXCLUDED.source,
        capture_mode = EXCLUDED.capture_mode,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        lineId,
        input.accountId,
        input.tenantId,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        input.stripeInvoiceId,
        lineItem.stripeInvoiceLineItemId,
        lineItem.stripePriceId ?? null,
        lineItem.description ?? null,
        lineItem.currency ?? null,
        lineItem.amount ?? null,
        lineItem.subtotal ?? null,
        lineItem.quantity ?? null,
        lineItem.periodStart ?? null,
        lineItem.periodEnd ?? null,
        lineItem.proration ?? null,
        input.source,
        input.captureMode,
        JSON.stringify(lineItem.metadata ?? {}),
        now,
        now,
      ],
    );
    recordCount += 1;
  }

  return { recordCount };
}

export async function listBillingInvoiceLineItems(
  filters: BillingInvoiceLineItemListFilters = {},
): Promise<BillingInvoiceLineItemRecord[]> {
  await ensureSchema();
  const pool = await getPool();
  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.accountId) {
    where.push(`account_id = $${idx++}`);
    params.push(filters.accountId);
  }
  if (filters.tenantId) {
    where.push(`tenant_id = $${idx++}`);
    params.push(filters.tenantId);
  }
  if (filters.stripeInvoiceId) {
    where.push(`stripe_invoice_id = $${idx++}`);
    params.push(filters.stripeInvoiceId);
  }

  const limit = Math.max(1, Math.min(5_000, filters.limit ?? 500));
  params.push(limit);
  const sql = `
    SELECT *
      FROM attestor_control_plane.billing_invoice_line_items
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, stripe_invoice_line_item_id ASC
      LIMIT $${idx}
  `;
  const result = await pool.query(sql, params);
  return result.rows.map(rowToLineItemRecord);
}

export async function exportBillingEventLedgerSnapshot(): Promise<BillingEventLedgerSnapshot> {
  await ensureSchema();
  const pool = await getPool();
  const [eventResult, lineItemResult] = await Promise.all([
    pool.query(`
      SELECT *
        FROM attestor_control_plane.billing_event_ledger
        ORDER BY received_at ASC, provider_event_id ASC
    `),
    pool.query(`
      SELECT *
        FROM attestor_control_plane.billing_invoice_line_items
        ORDER BY updated_at ASC, stripe_invoice_id ASC, stripe_invoice_line_item_id ASC
    `),
  ]);
  const records = eventResult.rows.map(rowToRecord);
  const lineItems = lineItemResult.rows.map(rowToLineItemRecord);
  return {
    version: 2,
    provider: 'stripe',
    exportedAt: new Date().toISOString(),
    eventRecordCount: records.length,
    lineItemRecordCount: lineItems.length,
    recordCount: records.length + lineItems.length,
    records,
    lineItems,
  };
}

export async function restoreBillingEventLedgerSnapshot(
  snapshot: BillingEventLedgerSnapshot | {
    version: 1;
    provider: 'stripe';
    exportedAt: string;
    recordCount: number;
    records: BillingEventRecord[];
  },
  options?: { replaceExisting?: boolean },
): Promise<{ recordCount: number }> {
  await ensureSchema();
  const pool = await getPool();
  if (options?.replaceExisting) {
    await pool.query(`
      TRUNCATE TABLE attestor_control_plane.billing_invoice_line_items,
      attestor_control_plane.billing_event_ledger
    `);
  }

  for (const record of snapshot.records) {
    await pool.query(
      `INSERT INTO attestor_control_plane.billing_event_ledger (
        id,
        provider,
        source,
        provider_event_id,
        event_type,
        payload_hash,
        outcome,
        reason,
        account_id,
        tenant_id,
        stripe_checkout_session_id,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
        stripe_invoice_id,
        stripe_invoice_status,
        stripe_invoice_currency,
        stripe_invoice_amount_paid,
        stripe_invoice_amount_due,
        account_status_before,
        account_status_after,
        billing_status_before,
        billing_status_after,
        mapped_plan_id,
        received_at,
        processed_at,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25::timestamptz, $26::timestamptz, $27::jsonb
      )
      ON CONFLICT (provider, provider_event_id) DO UPDATE SET
        id = EXCLUDED.id,
        source = EXCLUDED.source,
        event_type = EXCLUDED.event_type,
        payload_hash = EXCLUDED.payload_hash,
        outcome = EXCLUDED.outcome,
        reason = EXCLUDED.reason,
        account_id = EXCLUDED.account_id,
        tenant_id = EXCLUDED.tenant_id,
        stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        stripe_price_id = EXCLUDED.stripe_price_id,
        stripe_invoice_id = EXCLUDED.stripe_invoice_id,
        stripe_invoice_status = EXCLUDED.stripe_invoice_status,
        stripe_invoice_currency = EXCLUDED.stripe_invoice_currency,
        stripe_invoice_amount_paid = EXCLUDED.stripe_invoice_amount_paid,
        stripe_invoice_amount_due = EXCLUDED.stripe_invoice_amount_due,
        account_status_before = EXCLUDED.account_status_before,
        account_status_after = EXCLUDED.account_status_after,
        billing_status_before = EXCLUDED.billing_status_before,
        billing_status_after = EXCLUDED.billing_status_after,
        mapped_plan_id = EXCLUDED.mapped_plan_id,
        received_at = EXCLUDED.received_at,
        processed_at = EXCLUDED.processed_at,
        metadata = EXCLUDED.metadata`,
      [
        record.id,
        record.provider,
        record.source,
        record.providerEventId,
        record.eventType,
        record.payloadHash,
        record.outcome,
        record.reason,
        record.accountId,
        record.tenantId,
        record.stripeCheckoutSessionId,
        record.stripeCustomerId,
        record.stripeSubscriptionId,
        record.stripePriceId,
        record.stripeInvoiceId,
        record.stripeInvoiceStatus,
        record.stripeInvoiceCurrency,
        record.stripeInvoiceAmountPaid,
        record.stripeInvoiceAmountDue,
        record.accountStatusBefore,
        record.accountStatusAfter,
        record.billingStatusBefore,
        record.billingStatusAfter,
        record.mappedPlanId,
        record.receivedAt,
        record.processedAt,
        JSON.stringify(record.metadata ?? {}),
      ],
    );
  }

  const snapshotLineItems = 'lineItems' in snapshot ? snapshot.lineItems : [];
  for (const lineItem of snapshotLineItems) {
    await pool.query(
      `INSERT INTO attestor_control_plane.billing_invoice_line_items (
        id, provider, account_id, tenant_id, stripe_customer_id, stripe_subscription_id,
        stripe_invoice_id, stripe_invoice_line_item_id, stripe_price_id, description, currency,
        amount, subtotal, quantity, period_start, period_end, proration, source, capture_mode,
        metadata, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15::timestamptz, $16::timestamptz, $17, $18, $19,
        $20::jsonb, $21::timestamptz, $22::timestamptz
      )
      ON CONFLICT (provider, stripe_invoice_line_item_id) DO UPDATE SET
        id = EXCLUDED.id,
        account_id = EXCLUDED.account_id,
        tenant_id = EXCLUDED.tenant_id,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        stripe_invoice_id = EXCLUDED.stripe_invoice_id,
        stripe_price_id = EXCLUDED.stripe_price_id,
        description = EXCLUDED.description,
        currency = EXCLUDED.currency,
        amount = EXCLUDED.amount,
        subtotal = EXCLUDED.subtotal,
        quantity = EXCLUDED.quantity,
        period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end,
        proration = EXCLUDED.proration,
        source = EXCLUDED.source,
        capture_mode = EXCLUDED.capture_mode,
        metadata = EXCLUDED.metadata,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        lineItem.id,
        lineItem.provider,
        lineItem.accountId,
        lineItem.tenantId,
        lineItem.stripeCustomerId,
        lineItem.stripeSubscriptionId,
        lineItem.stripeInvoiceId,
        lineItem.stripeInvoiceLineItemId,
        lineItem.stripePriceId,
        lineItem.description,
        lineItem.currency,
        lineItem.amount,
        lineItem.subtotal,
        lineItem.quantity,
        lineItem.periodStart,
        lineItem.periodEnd,
        lineItem.proration,
        lineItem.source,
        lineItem.captureMode,
        JSON.stringify(lineItem.metadata ?? {}),
        lineItem.createdAt,
        lineItem.updatedAt,
      ],
    );
  }

  return { recordCount: snapshot.records.length + snapshotLineItems.length };
}

export async function resetBillingEventLedgerForTests(): Promise<void> {
  if (!isBillingEventLedgerConfigured()) {
    if (poolPromise) {
      const pool = await poolPromise;
      await pool.end();
    }
    poolPromise = null;
    initPromise = null;
    return;
  }

  const pool = await getPool();
  await pool.query('DROP SCHEMA IF EXISTS attestor_control_plane CASCADE');
  await pool.end();
  poolPromise = null;
  initPromise = null;
}
