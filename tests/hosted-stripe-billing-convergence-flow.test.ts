import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';
import { startServer } from '../src/service/api-server.js';
import { resetAccountSessionStoreForTests } from '../src/service/account-session-store.js';
import { resetAccountStoreForTests } from '../src/service/account-store.js';
import { resetAccountUserStoreForTests } from '../src/service/account-user-store.js';
import { resetAccountUserActionTokenStoreForTests } from '../src/service/account-user-token-store.js';
import { resetAdminAuditLogForTests } from '../src/service/admin-audit-log.js';
import { resetAdminIdempotencyStoreForTests } from '../src/service/admin-idempotency-store.js';
import { resetAsyncDeadLetterStoreForTests } from '../src/service/async-dead-letter-store.js';
import { resetBillingEventLedgerForTests } from '../src/service/billing-event-ledger.js';
import { resetHostedBillingEntitlementStoreForTests } from '../src/service/billing-entitlement-store.js';
import { resetHostedEmailDeliveryEventStoreForTests } from '../src/service/email-delivery-event-store.js';
import { resetObservabilityForTests } from '../src/service/observability.js';
import { resetTenantRateLimiterForTests } from '../src/service/rate-limit.js';
import { shutdownTenantRuntimeBackends } from '../src/service/runtime/tenant-runtime.js';
import { resetStripeWebhookStoreForTests } from '../src/service/stripe-webhook-store.js';
import { resetTenantKeyStoreForTests } from '../src/service/tenant-key-store.js';
import { resetUsageMeter } from '../src/service/usage-meter.js';

let passed = 0;

interface TestServerHandle {
  close(): void;
}

const stripe = new Stripe('sk_test_hosted_billing_convergence');

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function cookieHeaderFromResponse(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  const [cookiePair] = raw.split(';', 1);
  return cookiePair?.trim() || null;
}

async function readJson(res: Response): Promise<any> {
  return res.json() as Promise<any>;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function signedStripeHeaders(payload: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Stripe-Signature': stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    }),
  };
}

async function postStripeWebhook(baseUrl: string, payload: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/stripe/webhook`, {
    method: 'POST',
    headers: signedStripeHeaders(payload),
    body: payload,
  });
}

function configureIsolatedStores(root: string): void {
  delete process.env.ATTESTOR_TENANT_KEYS;
  delete process.env.ATTESTOR_BILLING_LEDGER_PG_URL;
  delete process.env.ATTESTOR_RATE_LIMIT_COMMUNITY_REQUESTS;
  delete process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS;
  delete process.env.ATTESTOR_RATE_LIMIT_PRO_REQUESTS;
  delete process.env.ATTESTOR_RATE_LIMIT_ENTERPRISE_REQUESTS;
  delete process.env.ATTESTOR_ASYNC_QUEUE_REDIS_URL;
  delete process.env.ATTESTOR_ASYNC_DISPATCH_REDIS_URL;

  process.env.ATTESTOR_TENANT_KEY_STORE_PATH = join(root, 'tenant-keys.json');
  process.env.ATTESTOR_USAGE_LEDGER_PATH = join(root, 'usage-ledger.json');
  process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(root, 'accounts.json');
  process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH = join(root, 'account-users.json');
  process.env.ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH = join(root, 'account-user-tokens.json');
  process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH = join(root, 'account-sessions.json');
  process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY = 'hosted-stripe-billing-mfa-secret';
  process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(root, 'admin-audit.json');
  process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(root, 'admin-idempotency.json');
  process.env.ATTESTOR_ASYNC_DLQ_STORE_PATH = join(root, 'async-dlq.json');
  process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(root, 'stripe-webhooks.json');
  process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH = join(root, 'billing-entitlements.json');
  process.env.ATTESTOR_EMAIL_DELIVERY_EVENTS_PATH = join(root, 'email-delivery-events.json');
  process.env.ATTESTOR_OBSERVABILITY_LOG_PATH = join(root, 'observability.jsonl');
  process.env.ATTESTOR_SESSION_COOKIE_SECURE = 'false';
  process.env.ATTESTOR_ADMIN_API_KEY = 'hosted-stripe-billing-admin';
  process.env.ATTESTOR_METRICS_API_KEY = 'hosted-stripe-billing-metrics';
  process.env.ATTESTOR_TENANT_KEY_MAX_ACTIVE_PER_TENANT = '2';
  process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
  process.env.STRIPE_API_KEY = 'sk_test_hosted_stripe_billing';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_hosted_stripe_billing';
  process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.dev/billing/success';
  process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.dev/billing/cancel';
  process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://attestor.dev/settings/billing';
  process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_ENTERPRISE = 'price_enterprise_monthly';
}

async function resetStores(): Promise<void> {
  resetTenantKeyStoreForTests();
  resetUsageMeter();
  await resetTenantRateLimiterForTests();
  resetAccountStoreForTests();
  resetAccountUserStoreForTests();
  resetAccountUserActionTokenStoreForTests();
  resetAccountSessionStoreForTests();
  resetAdminAuditLogForTests();
  resetAdminIdempotencyStoreForTests();
  resetAsyncDeadLetterStoreForTests();
  resetStripeWebhookStoreForTests();
  await resetBillingEventLedgerForTests();
  resetHostedBillingEntitlementStoreForTests();
  resetHostedEmailDeliveryEventStoreForTests();
  resetObservabilityForTests();
}

function checkoutCompletedPayload(input: {
  eventId: string;
  accountId: string;
  tenantId: string;
  checkoutSessionId: string;
  customerId: string;
  subscriptionId: string;
  planId: string;
}): string {
  return JSON.stringify({
    id: input.eventId,
    object: 'event',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: input.checkoutSessionId,
        object: 'checkout.session',
        mode: 'subscription',
        customer: input.customerId,
        subscription: input.subscriptionId,
        created: Math.floor(Date.now() / 1000),
        metadata: {
          attestorAccountId: input.accountId,
          attestorTenantId: input.tenantId,
          attestorPlanId: input.planId,
        },
      },
    },
  });
}

function subscriptionUpdatedPayload(input: {
  eventId: string;
  customerId: string;
  subscriptionId: string;
  status: string;
  priceId: string;
}): string {
  return JSON.stringify({
    id: input.eventId,
    object: 'event',
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: input.subscriptionId,
        object: 'subscription',
        customer: input.customerId,
        status: input.status,
        metadata: {},
        items: {
          object: 'list',
          data: [{ price: { id: input.priceId } }],
        },
      },
    },
  });
}

function invoicePayload(input: {
  eventId: string;
  eventType: 'invoice.payment_failed' | 'invoice.paid';
  accountId: string;
  customerId: string;
  subscriptionId: string;
  invoiceId: string;
  status: 'open' | 'paid';
  amountPaid: number;
  amountDue: number;
  priceId: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    id: input.eventId,
    object: 'event',
    type: input.eventType,
    created: now,
    data: {
      object: {
        id: input.invoiceId,
        object: 'invoice',
        customer: input.customerId,
        subscription: input.subscriptionId,
        status: input.status,
        currency: 'usd',
        amount_paid: input.amountPaid,
        amount_due: input.amountDue,
        billing_reason: 'subscription_cycle',
        metadata: {
          attestorAccountId: input.accountId,
        },
        status_transitions: {
          paid_at: input.status === 'paid' ? now : null,
        },
        lines: {
          object: 'list',
          has_more: false,
          data: [{
            id: `${input.invoiceId}_line_1`,
            object: 'line_item',
            invoice: input.invoiceId,
            amount: input.amountDue,
            subtotal: input.amountDue,
            currency: 'usd',
            description: 'Attestor Pro Monthly',
            quantity: 1,
            subscription: input.subscriptionId,
            pricing: {
              type: 'price_details',
              price_details: {
                price: input.priceId,
              },
              unit_amount_decimal: String(input.amountDue),
            },
            period: {
              start: now - 3600,
              end: now,
            },
            parent: {
              type: 'subscription_item_details',
              invoice_item_details: null,
              subscription_item_details: {
                invoice_item: null,
                proration: false,
                proration_details: null,
                subscription: input.subscriptionId,
                subscription_item: 'si_hosted_billing_001',
              },
            },
            metadata: {},
          }],
        },
      },
    },
  });
}

function entitlementSummaryPayload(input: {
  eventId: string;
  customerId: string;
}): string {
  return JSON.stringify({
    id: input.eventId,
    object: 'event',
    type: 'entitlements.active_entitlement_summary.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        object: 'entitlements.active_entitlement_summary',
        customer: input.customerId,
        entitlements: {
          object: 'list',
          data: [
            {
              id: 'ent_hosted_pro_api',
              object: 'entitlements.active_entitlement',
              lookup_key: 'attestor.pro.api',
              feature: {
                id: 'feat_hosted_pro_api',
                object: 'entitlements.feature',
                lookup_key: 'attestor.pro.api',
              },
            },
            {
              id: 'ent_hosted_billing_export',
              object: 'entitlements.active_entitlement',
              lookup_key: 'attestor.pro.billing_export',
              feature: {
                id: 'feat_hosted_billing_export',
                object: 'entitlements.feature',
                lookup_key: 'attestor.pro.billing_export',
              },
            },
          ],
        },
      },
    },
  });
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-hosted-stripe-'));
  let serverHandle: TestServerHandle | null = null;

  try {
    configureIsolatedStores(tempRoot);
    await resetStores();

    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    serverHandle = startServer(port);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signupRes = await postJson(`${baseUrl}/api/v1/auth/signup`, {
      accountName: `Hosted Billing ${suffix}`,
      email: `billing-owner-${suffix}@example.test`,
      displayName: 'Hosted Billing Owner',
      password: 'HostedBillingPass123!',
    });
    equal(signupRes.status, 201, 'Hosted billing: signup creates account');
    const accountAdminCookie = cookieHeaderFromResponse(signupRes);
    ok(Boolean(accountAdminCookie), 'Hosted billing: account admin session cookie issued');
    const signupBody = await readJson(signupRes);
    const accountId = signupBody.account.id as string;
    const tenantId = signupBody.account.primaryTenantId as string;
    const initialApiKey = signupBody.initialKey.apiKey as string;

    const missingIdempotencyRes = await postJson(
      `${baseUrl}/api/v1/account/billing/checkout`,
      { planId: 'pro' },
      { Cookie: accountAdminCookie! },
    );
    equal(missingIdempotencyRes.status, 400, 'Hosted checkout: Idempotency-Key is required');

    const invalidPlanRes = await postJson(
      `${baseUrl}/api/v1/account/billing/checkout`,
      { planId: 'community' },
      {
        Cookie: accountAdminCookie!,
        'Idempotency-Key': 'billing-invalid-community',
      },
    );
    equal(invalidPlanRes.status, 400, 'Hosted checkout: community cannot be bought through Stripe checkout');

    const checkoutRes = await postJson(
      `${baseUrl}/api/v1/account/billing/checkout`,
      { planId: 'pro' },
      {
        Cookie: accountAdminCookie!,
        'Idempotency-Key': 'billing-pro-checkout-1',
      },
    );
    equal(checkoutRes.status, 200, 'Hosted checkout: paid checkout session starts');
    equal(checkoutRes.headers.get('x-attestor-idempotency-key'), 'billing-pro-checkout-1', 'Hosted checkout: idempotency key is echoed');
    const checkoutBody = await readJson(checkoutRes);
    equal(checkoutBody.planId, 'pro', 'Hosted checkout: plan is echoed');
    equal(checkoutBody.stripePriceId, 'price_pro_monthly', 'Hosted checkout: Stripe price maps to pro');
    equal(checkoutBody.trialDays, null, 'Hosted checkout: pro has no trial by default');
    equal(checkoutBody.mock, true, 'Hosted checkout: deterministic mock mode is visible');
    ok(String(checkoutBody.checkoutUrl).includes('/checkout/'), 'Hosted checkout: hosted checkout URL is returned');

    const checkoutReplayRes = await postJson(
      `${baseUrl}/api/v1/account/billing/checkout`,
      { planId: 'pro' },
      {
        Cookie: accountAdminCookie!,
        'Idempotency-Key': 'billing-pro-checkout-1',
      },
    );
    equal(checkoutReplayRes.status, 200, 'Hosted checkout: idempotent replay stays successful');
    const checkoutReplayBody = await readJson(checkoutReplayRes);
    equal(checkoutReplayBody.checkoutSessionId, checkoutBody.checkoutSessionId, 'Hosted checkout: replay preserves checkout session id');
    equal(checkoutReplayBody.checkoutUrl, checkoutBody.checkoutUrl, 'Hosted checkout: replay preserves checkout URL');

    const entitlementAfterCheckoutRes = await fetch(`${baseUrl}/api/v1/account/entitlement`, {
      headers: { Cookie: accountAdminCookie! },
    });
    equal(entitlementAfterCheckoutRes.status, 200, 'Hosted entitlement: readable after checkout start');
    const entitlementAfterCheckoutBody = await readJson(entitlementAfterCheckoutRes);
    equal(entitlementAfterCheckoutBody.entitlement.status, 'provisioned', 'Hosted entitlement: checkout start alone does not activate paid access');
    equal(entitlementAfterCheckoutBody.entitlement.effectivePlanId, 'community', 'Hosted entitlement: evaluation plan remains active until webhook convergence');

    const portalBeforeCustomerRes = await fetch(`${baseUrl}/api/v1/account/billing/portal`, {
      method: 'POST',
      headers: { Cookie: accountAdminCookie! },
    });
    equal(portalBeforeCustomerRes.status, 409, 'Hosted portal: Stripe customer is required before portal creation');

    const customerId = `cus_hosted_${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
    const subscriptionId = `sub_hosted_${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
    const checkoutPayload = checkoutCompletedPayload({
      eventId: 'evt_hosted_checkout_completed',
      accountId,
      tenantId,
      checkoutSessionId: checkoutBody.checkoutSessionId,
      customerId,
      subscriptionId,
      planId: 'pro',
    });

    const invalidSignatureRes = await fetch(`${baseUrl}/api/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 'bad-signature',
      },
      body: checkoutPayload,
    });
    equal(invalidSignatureRes.status, 400, 'Stripe webhook: invalid signature fails closed');

    const missingSignatureRes = await fetch(`${baseUrl}/api/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: checkoutPayload,
    });
    equal(missingSignatureRes.status, 400, 'Stripe webhook: missing signature fails closed');

    const checkoutWebhookRes = await postStripeWebhook(baseUrl, checkoutPayload);
    equal(checkoutWebhookRes.status, 200, 'Stripe webhook: checkout.session.completed is accepted');
    const checkoutWebhookBody = await readJson(checkoutWebhookRes);
    equal(checkoutWebhookBody.accountId, accountId, 'Stripe webhook: checkout completion maps account');
    equal(checkoutWebhookBody.mappedPlanId, 'pro', 'Stripe webhook: checkout completion maps plan');
    equal(checkoutWebhookBody.billing.stripeCustomerId, customerId, 'Stripe webhook: checkout completion stores customer');
    equal(checkoutWebhookBody.billing.stripeSubscriptionId, subscriptionId, 'Stripe webhook: checkout completion stores subscription');
    equal(checkoutWebhookBody.billing.lastCheckoutSessionId, checkoutBody.checkoutSessionId, 'Stripe webhook: checkout completion stores session id');

    const checkoutDuplicateRes = await postStripeWebhook(baseUrl, checkoutPayload);
    equal(checkoutDuplicateRes.status, 200, 'Stripe webhook: duplicate checkout event preserves 200');
    equal(checkoutDuplicateRes.headers.get('x-attestor-stripe-replay'), 'true', 'Stripe webhook: duplicate replay header is set');
    const checkoutDuplicateBody = await readJson(checkoutDuplicateRes);
    equal(checkoutDuplicateBody.duplicate, true, 'Stripe webhook: duplicate replay is explicit');

    const checkoutConflictPayload = checkoutCompletedPayload({
      eventId: 'evt_hosted_checkout_completed',
      accountId,
      tenantId,
      checkoutSessionId: checkoutBody.checkoutSessionId,
      customerId,
      subscriptionId,
      planId: 'enterprise',
    });
    const checkoutConflictRes = await postStripeWebhook(baseUrl, checkoutConflictPayload);
    equal(checkoutConflictRes.status, 409, 'Stripe webhook: same event id with different payload is rejected');

    const summaryAfterCheckoutRes = await fetch(`${baseUrl}/api/v1/account`, {
      headers: { Authorization: `Bearer ${initialApiKey}` },
    });
    equal(summaryAfterCheckoutRes.status, 200, 'Hosted account: summary is readable after checkout convergence');
    const summaryAfterCheckoutBody = await readJson(summaryAfterCheckoutRes);
    equal(summaryAfterCheckoutBody.tenantContext.planId, 'pro', 'Hosted account: tenant plan converges to pro');
    equal(summaryAfterCheckoutBody.entitlement.provider, 'stripe', 'Hosted account: entitlement provider switches to Stripe');
    equal(
      summaryAfterCheckoutBody.entitlement.status,
      'checkout_completed',
      'Hosted account: checkout completion remains pending until the subscription lifecycle converges',
    );
    equal(summaryAfterCheckoutBody.entitlement.effectivePlanId, 'pro', 'Hosted account: effective plan becomes pro');

    const pastDuePayload = subscriptionUpdatedPayload({
      eventId: 'evt_hosted_subscription_past_due',
      customerId,
      subscriptionId,
      status: 'past_due',
      priceId: 'price_pro_monthly',
    });
    const pastDueRes = await postStripeWebhook(baseUrl, pastDuePayload);
    equal(pastDueRes.status, 200, 'Stripe webhook: past_due subscription update is accepted');
    const pastDueBody = await readJson(pastDueRes);
    equal(pastDueBody.accountStatus, 'suspended', 'Stripe webhook: past_due suspends the hosted account');
    equal(pastDueBody.billing.stripeSubscriptionStatus, 'past_due', 'Stripe webhook: billing status becomes past_due');

    const blockedUsageRes = await fetch(`${baseUrl}/api/v1/account/usage`, {
      headers: { Authorization: `Bearer ${initialApiKey}` },
    });
    equal(blockedUsageRes.status, 403, 'Hosted enforcement: suspended paid account is fail-closed for tenant APIs');

    const suspendedLoginRes = await postJson(`${baseUrl}/api/v1/auth/login`, {
      email: `billing-owner-${suffix}@example.test`,
      password: 'HostedBillingPass123!',
    });
    equal(suspendedLoginRes.status, 200, 'Hosted billing: suspended account can re-login for billing self-service');
    const suspendedCookie = cookieHeaderFromResponse(suspendedLoginRes);
    ok(Boolean(suspendedCookie), 'Hosted billing: suspended re-login issues session cookie');

    const suspendedPortalRes = await fetch(`${baseUrl}/api/v1/account/billing/portal`, {
      method: 'POST',
      headers: { Cookie: suspendedCookie! },
    });
    equal(suspendedPortalRes.status, 200, 'Hosted portal: suspended account can still open billing portal');
    const suspendedPortalBody = await readJson(suspendedPortalRes);
    ok(String(suspendedPortalBody.portalUrl).includes('/portal/'), 'Hosted portal: portal URL is returned');
    equal(suspendedPortalBody.mock, true, 'Hosted portal: mock mode is visible');

    const pastDueReplayRes = await postStripeWebhook(baseUrl, pastDuePayload);
    equal(pastDueReplayRes.status, 200, 'Stripe webhook: duplicate past_due event preserves 200');
    equal(pastDueReplayRes.headers.get('x-attestor-stripe-replay'), 'true', 'Stripe webhook: duplicate past_due header is set');

    const activePayload = subscriptionUpdatedPayload({
      eventId: 'evt_hosted_subscription_active',
      customerId,
      subscriptionId,
      status: 'active',
      priceId: 'price_pro_monthly',
    });
    const activeRes = await postStripeWebhook(baseUrl, activePayload);
    equal(activeRes.status, 200, 'Stripe webhook: active subscription update is accepted');
    const activeBody = await readJson(activeRes);
    equal(activeBody.accountStatus, 'active', 'Stripe webhook: active subscription restores account');
    equal(activeBody.billing.stripeSubscriptionStatus, 'active', 'Stripe webhook: billing status is active');
    equal(activeBody.mappedPlanId, 'pro', 'Stripe webhook: active subscription maps pro plan');

    const unblockedUsageRes = await fetch(`${baseUrl}/api/v1/account/usage`, {
      headers: { Authorization: `Bearer ${initialApiKey}` },
    });
    equal(unblockedUsageRes.status, 200, 'Hosted enforcement: active paid account can use tenant APIs again');
    const unblockedUsageBody = await readJson(unblockedUsageRes);
    equal(unblockedUsageBody.tenantContext.planId, 'pro', 'Hosted enforcement: restored tenant API sees pro plan');
    equal(unblockedUsageBody.usage.quota, 1000, 'Hosted enforcement: pro quota is visible after billing convergence');

    const invoiceFailedRes = await postStripeWebhook(baseUrl, invoicePayload({
      eventId: 'evt_hosted_invoice_failed',
      eventType: 'invoice.payment_failed',
      accountId,
      customerId,
      subscriptionId,
      invoiceId: 'in_hosted_failed',
      status: 'open',
      amountPaid: 0,
      amountDue: 5000,
      priceId: 'price_pro_monthly',
    }));
    equal(invoiceFailedRes.status, 200, 'Stripe webhook: invoice.payment_failed is accepted');
    const invoiceFailedBody = await readJson(invoiceFailedRes);
    equal(invoiceFailedBody.billing.lastInvoiceId, 'in_hosted_failed', 'Stripe webhook: failed invoice id is stored');
    equal(invoiceFailedBody.billing.lastInvoiceStatus, 'open', 'Stripe webhook: failed invoice status is stored');
    equal(invoiceFailedBody.billing.lastInvoiceAmountDue, 5000, 'Stripe webhook: failed invoice amount due is stored');
    ok(typeof invoiceFailedBody.billing.delinquentSince === 'string', 'Stripe webhook: delinquentSince is set after payment failure');

    const invoicePaidRes = await postStripeWebhook(baseUrl, invoicePayload({
      eventId: 'evt_hosted_invoice_paid',
      eventType: 'invoice.paid',
      accountId,
      customerId,
      subscriptionId,
      invoiceId: 'in_hosted_paid',
      status: 'paid',
      amountPaid: 5000,
      amountDue: 5000,
      priceId: 'price_pro_monthly',
    }));
    equal(invoicePaidRes.status, 200, 'Stripe webhook: invoice.paid is accepted');
    const invoicePaidBody = await readJson(invoicePaidRes);
    equal(invoicePaidBody.billing.lastInvoiceId, 'in_hosted_paid', 'Stripe webhook: paid invoice id is stored');
    equal(invoicePaidBody.billing.lastInvoiceStatus, 'paid', 'Stripe webhook: paid invoice status is stored');
    equal(invoicePaidBody.billing.lastInvoiceAmountPaid, 5000, 'Stripe webhook: paid invoice amount is stored');
    equal(invoicePaidBody.billing.delinquentSince, null, 'Stripe webhook: paid invoice clears delinquency');

    const entitlementSummaryRes = await postStripeWebhook(baseUrl, entitlementSummaryPayload({
      eventId: 'evt_hosted_entitlements_updated',
      customerId,
    }));
    equal(entitlementSummaryRes.status, 200, 'Stripe webhook: entitlement summary update is accepted');
    const entitlementSummaryBody = await readJson(entitlementSummaryRes);
    equal(entitlementSummaryBody.entitlement.lastEventId, 'evt_hosted_entitlements_updated', 'Hosted entitlement: last event advances to entitlement summary');
    ok(
      entitlementSummaryBody.entitlement.stripeEntitlementLookupKeys.includes('attestor.pro.api'),
      'Hosted entitlement: Stripe lookup keys are persisted',
    );
    ok(
      entitlementSummaryBody.entitlement.stripeEntitlementFeatureIds.includes('feat_hosted_pro_api'),
      'Hosted entitlement: Stripe feature ids are persisted',
    );

    const restoredLoginRes = await postJson(`${baseUrl}/api/v1/auth/login`, {
      email: `billing-owner-${suffix}@example.test`,
      password: 'HostedBillingPass123!',
    });
    equal(restoredLoginRes.status, 200, 'Hosted features: restored active account can issue a fresh session');
    const restoredCookie = cookieHeaderFromResponse(restoredLoginRes);
    ok(Boolean(restoredCookie), 'Hosted features: restored login returns a session cookie');

    const featuresRes = await fetch(`${baseUrl}/api/v1/account/features`, {
      headers: { Cookie: restoredCookie! },
    });
    equal(featuresRes.status, 200, 'Hosted features: feature view is readable after entitlement summary');
    const featuresBody = await readJson(featuresRes);
    equal(featuresBody.summary.stripeSummaryPresent, true, 'Hosted features: Stripe summary is marked present');
    const apiFeature = featuresBody.features.find((entry: any) => entry.key === 'api.access');
    ok(Boolean(apiFeature), 'Hosted features: api.access feature exists');
    equal(apiFeature.granted, true, 'Hosted features: api.access is granted by Stripe entitlement');
    equal(apiFeature.grantSource, 'stripe_entitlement', 'Hosted features: api.access source is Stripe entitlement');
    const reconciliationFeature = featuresBody.features.find((entry: any) => entry.key === 'billing.reconciliation');
    ok(Boolean(reconciliationFeature), 'Hosted features: billing.reconciliation feature exists');
    equal(reconciliationFeature.granted, false, 'Hosted features: missing Stripe entitlement remains disabled');

    ok(passed > 0, 'Hosted Stripe billing convergence flow: tests executed');
    console.log(`\nHosted Stripe billing convergence flow tests: ${passed} passed, 0 failed`);
  } finally {
    serverHandle?.close();
    await shutdownTenantRuntimeBackends();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\nHosted Stripe billing convergence flow tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
