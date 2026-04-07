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
