/**
 * Stripe Billing — Hosted checkout + customer portal first slice
 *
 * BOUNDARY:
 * - Stripe-hosted checkout and portal only
 * - No internal invoice ledger or entitlement service yet
 * - Supports a deterministic mock mode for local integration tests
 */

import Stripe from 'stripe';
import type { HostedAccountRecord } from './account-store.js';
import type { HostedPlanDefinition } from './plan-catalog.js';
import type { TenantContext } from './tenant-isolation.js';
import { resolvePlanStripePrice } from './plan-catalog.js';

export class StripeBillingError extends Error {
  constructor(
    public readonly code: 'DISABLED' | 'CONFIG' | 'PLAN_UNAVAILABLE' | 'NO_CUSTOMER',
    message: string,
  ) {
    super(message);
    this.name = 'StripeBillingError';
  }
}

let cachedStripeClient: Stripe | null = null;

function useMockStripeBilling(): boolean {
  return process.env.ATTESTOR_STRIPE_USE_MOCK === 'true';
}

function requireStripeApiKey(): string {
  const key = process.env.STRIPE_API_KEY?.trim();
  if (!key) {
    throw new StripeBillingError(
      'DISABLED',
      'Stripe billing routes are disabled. Set STRIPE_API_KEY to enable hosted checkout and portal sessions.',
    );
  }
  return key;
}

function stripeClient(): Stripe {
  if (useMockStripeBilling()) {
    return new Stripe('sk_test_attestor_mock');
  }
  if (!cachedStripeClient) {
    cachedStripeClient = new Stripe(requireStripeApiKey());
  }
  return cachedStripeClient;
}

function requiredUrl(envName: 'ATTESTOR_BILLING_SUCCESS_URL' | 'ATTESTOR_BILLING_CANCEL_URL' | 'ATTESTOR_BILLING_PORTAL_RETURN_URL'): string {
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new StripeBillingError('CONFIG', `${envName} must be set for hosted Stripe billing flows.`);
  }
  return value;
}

function planPriceOrThrow(planId: string): { planId: string; priceId: string } {
  const resolved = resolvePlanStripePrice(planId);
  if (!resolved.knownPlan || !resolved.priceId) {
    throw new StripeBillingError(
      'PLAN_UNAVAILABLE',
      `Stripe price not configured for plan '${planId}'. Set ATTESTOR_STRIPE_PRICE_${planId.toUpperCase()} first.`,
    );
  }
  return {
    planId: resolved.planId,
    priceId: resolved.priceId,
  };
}

export interface HostedCheckoutSessionResult {
  sessionId: string;
  url: string;
  planId: string;
  stripePriceId: string;
  mode: 'subscription';
  mock: boolean;
}

export interface HostedBillingPortalSessionResult {
  sessionId: string;
  url: string;
  mock: boolean;
}

export interface HostedStripeInvoiceSnapshot {
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
  source: 'stripe_live' | 'mock_summary';
}

export interface HostedStripeChargeSnapshot {
  chargeId: string | null;
  invoiceId: string | null;
  amount: number | null;
  currency: string | null;
  status: 'succeeded' | 'pending' | 'failed' | null;
  paid: boolean | null;
  refunded: boolean | null;
  createdAt: string | null;
  source: 'stripe_live' | 'mock_summary';
}

export interface HostedStripeBillingSnapshot {
  source: 'stripe_live' | 'mock_summary' | 'no_customer';
  mock: boolean;
  customerId: string | null;
  invoices: HostedStripeInvoiceSnapshot[];
  charges: HostedStripeChargeSnapshot[];
}

function stripeReferenceId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') {
    return ((value as { id: string }).id).trim();
  }
  return null;
}

function unixSecondsToIso(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

function stripeInvoicePriceId(invoice: Stripe.Invoice): string | null {
  for (const entry of invoice.lines?.data ?? []) {
    const directPriceId = stripeReferenceId((entry as { price?: unknown }).price);
    if (directPriceId) return directPriceId;
    const pricingPriceId = stripeReferenceId(
      (entry as { pricing?: { price_details?: { price?: unknown } | null } | null }).pricing?.price_details?.price,
    );
    if (pricingPriceId) return pricingPriceId;
  }
  return null;
}

export async function createHostedCheckoutSession(options: {
  account: HostedAccountRecord;
  tenant: TenantContext;
  plan: HostedPlanDefinition;
  idempotencyKey: string;
}): Promise<HostedCheckoutSessionResult> {
  const { planId, priceId } = planPriceOrThrow(options.plan.id);
  const successUrl = requiredUrl('ATTESTOR_BILLING_SUCCESS_URL');
  const cancelUrl = requiredUrl('ATTESTOR_BILLING_CANCEL_URL');
  const idempotencyKey = options.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new StripeBillingError(
      'CONFIG',
      'Idempotency-Key header is required for hosted checkout session creation.',
    );
  }

  if (useMockStripeBilling()) {
    const token = Buffer.from(
      `${options.account.id}:${planId}:${idempotencyKey}`,
      'utf8',
    ).toString('base64url').slice(0, 32);
    return {
      sessionId: `cs_mock_${token}`,
      url: `https://billing.stripe.test/checkout/${token}`,
      planId,
      stripePriceId: priceId,
      mode: 'subscription',
      mock: true,
    };
  }

  const metadata = {
    attestorAccountId: options.account.id,
    attestorTenantId: options.account.primaryTenantId,
    attestorPlanId: planId,
  };

  const session = await stripeClient().checkout.sessions.create({
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [{ price: priceId, quantity: 1 }],
    customer: options.account.billing.stripeCustomerId ?? undefined,
    customer_email: options.account.billing.stripeCustomerId ? undefined : options.account.contactEmail,
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
  }, {
    idempotencyKey,
  });

  if (!session.url) {
    throw new StripeBillingError('CONFIG', 'Stripe checkout session did not return a hosted URL.');
  }

  return {
    sessionId: session.id,
    url: session.url,
    planId,
    stripePriceId: priceId,
    mode: 'subscription',
    mock: false,
  };
}

export async function createHostedBillingPortalSession(options: {
  account: HostedAccountRecord;
}): Promise<HostedBillingPortalSessionResult> {
  const customerId = options.account.billing.stripeCustomerId;
  if (!customerId) {
    throw new StripeBillingError(
      'NO_CUSTOMER',
      `Hosted account '${options.account.id}' does not have a Stripe customer id yet.`,
    );
  }

  const returnUrl = requiredUrl('ATTESTOR_BILLING_PORTAL_RETURN_URL');

  if (useMockStripeBilling()) {
    return {
      sessionId: `bps_mock_${options.account.id}`,
      url: `https://billing.stripe.test/portal/${options.account.id}`,
      mock: true,
    };
  }

  const session = await stripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return {
    sessionId: session.id,
    url: session.url,
    mock: false,
  };
}

export async function exportHostedStripeBillingSnapshot(options: {
  account: HostedAccountRecord;
  limit: number;
}): Promise<HostedStripeBillingSnapshot> {
  const customerId = options.account.billing.stripeCustomerId;
  if (!customerId) {
    return {
      source: 'no_customer',
      mock: useMockStripeBilling(),
      customerId: null,
      invoices: [],
      charges: [],
    };
  }

  if (useMockStripeBilling()) {
    const invoices: HostedStripeInvoiceSnapshot[] = options.account.billing.lastInvoiceId
      ? [{
          invoiceId: options.account.billing.lastInvoiceId,
          status: options.account.billing.lastInvoiceStatus,
          currency: options.account.billing.lastInvoiceCurrency,
          amountPaid: options.account.billing.lastInvoiceAmountPaid,
          amountDue: options.account.billing.lastInvoiceAmountDue,
          subscriptionId: options.account.billing.stripeSubscriptionId,
          priceId: options.account.billing.stripePriceId,
          billingReason: 'subscription_cycle',
          createdAt: options.account.billing.lastInvoiceProcessedAt ?? options.account.billing.lastWebhookProcessedAt,
          paidAt: options.account.billing.lastInvoicePaidAt,
          source: 'mock_summary',
        }]
      : [];
    const charges: HostedStripeChargeSnapshot[] =
      options.account.billing.lastInvoiceId && options.account.billing.lastInvoiceStatus === 'paid'
        ? [{
            chargeId: `ch_mock_${options.account.id}`,
            invoiceId: options.account.billing.lastInvoiceId,
            amount: options.account.billing.lastInvoiceAmountPaid,
            currency: options.account.billing.lastInvoiceCurrency,
            status: 'succeeded',
            paid: true,
            refunded: false,
            createdAt: options.account.billing.lastInvoicePaidAt ?? options.account.billing.lastInvoiceProcessedAt,
            source: 'mock_summary',
          }]
        : [];
    return {
      source: 'mock_summary',
      mock: true,
      customerId,
      invoices,
      charges,
    };
  }

  const limit = Math.max(1, Math.min(100, options.limit));
  const [invoiceList, chargeList] = await Promise.all([
    stripeClient().invoices.list({ customer: customerId, limit }),
    stripeClient().charges.list({ customer: customerId, limit }),
  ]);

  return {
    source: 'stripe_live',
    mock: false,
    customerId,
    invoices: invoiceList.data.map((invoice) => ({
      invoiceId: invoice.id,
      status: typeof invoice.status === 'string' ? invoice.status : null,
      currency: typeof invoice.currency === 'string' ? invoice.currency : null,
      amountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
      amountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
      subscriptionId: stripeReferenceId((invoice as Stripe.Invoice & { subscription?: unknown }).subscription),
      priceId: stripeInvoicePriceId(invoice),
      billingReason: typeof invoice.billing_reason === 'string' ? invoice.billing_reason : null,
      createdAt: unixSecondsToIso(invoice.created),
      paidAt: unixSecondsToIso((invoice.status_transitions as { paid_at?: unknown } | null | undefined)?.paid_at),
      source: 'stripe_live',
    })),
    charges: chargeList.data.map((charge) => ({
      chargeId: charge.id,
      invoiceId: stripeReferenceId((charge as Stripe.Charge & { invoice?: unknown }).invoice),
      amount: typeof charge.amount === 'number' ? charge.amount : null,
      currency: typeof charge.currency === 'string' ? charge.currency : null,
      status: charge.status === 'succeeded' || charge.status === 'pending' || charge.status === 'failed'
        ? charge.status
        : null,
      paid: typeof charge.paid === 'boolean' ? charge.paid : null,
      refunded: typeof charge.refunded === 'boolean' ? charge.refunded : null,
      createdAt: unixSecondsToIso(charge.created),
      source: 'stripe_live',
    })),
  };
}
