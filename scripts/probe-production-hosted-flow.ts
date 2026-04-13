import assert from 'node:assert/strict';
import Stripe from 'stripe';

import {
  COUNTERPARTY_FIXTURE,
  COUNTERPARTY_INTENT,
  COUNTERPARTY_REPORT,
  COUNTERPARTY_REPORT_CONTRACT,
  COUNTERPARTY_SQL,
} from '../src/financial/fixtures/scenarios.js';

type JsonResult = {
  res: Response;
  text: string;
  body: any;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<JsonResult> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, text, body };
}

function cookieHeader(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  const first = raw.split(';', 1)[0];
  return first ? first.trim() : null;
}

async function archiveAccount(baseUrl: string, adminApiKey: string, accountId: string, reason: string, idempotencyKey: string): Promise<void> {
  const archive = await fetchJson(`${baseUrl}/api/v1/admin/accounts/${accountId}/archive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminApiKey}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ reason }),
  });
  if (archive.res.status !== 200 && archive.res.status !== 409) {
    throw new Error(`Account archive failed: ${archive.res.status} ${archive.text}`);
  }
}

async function main(): Promise<void> {
  const baseUrl = (process.env.ATTESTOR_BASE_URL?.trim() || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const adminApiKey = requiredEnv('ATTESTOR_ADMIN_API_KEY');
  const stripeApiKey = requiredEnv('STRIPE_API_KEY');
  const stripeWebhookSecret = requiredEnv('STRIPE_WEBHOOK_SECRET');
  const stripe = new Stripe(stripeApiKey);

  const suffix = `${Date.now()}`;
  const accountName = `Launch Verify ${suffix}`;
  const contactEmail = `ops+${suffix}@attestor.live`;
  const bootstrapEmail = `owner+${suffix}@attestor.live`;
  const password = `LaunchPass!${suffix.slice(-6)}Aa`;

  let accountId: string | null = null;
  let stripeCustomerId: string | null = null;

  try {
    const createAccount = await fetchJson(`${baseUrl}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminApiKey}`,
        'Idempotency-Key': `launch-verify-create-${suffix}`,
      },
      body: JSON.stringify({
        accountName,
        contactEmail,
        tenantId: `tenant-launch-${suffix}`,
        tenantName: `Launch Tenant ${suffix}`,
      }),
    });
    assert.equal(createAccount.res.status, 201, `Account creation failed: ${createAccount.res.status} ${createAccount.text}`);
    const account = createAccount.body.account;
    const initialApiKey = createAccount.body.initialKey.apiKey as string;
    accountId = account.id;

    const bootstrap = await fetchJson(`${baseUrl}/api/v1/account/users/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${initialApiKey}`,
      },
      body: JSON.stringify({
        email: bootstrapEmail,
        displayName: 'Launch Verifier',
        password,
      }),
    });
    assert.equal(bootstrap.res.status, 201, `Bootstrap failed: ${bootstrap.res.status} ${bootstrap.text}`);

    const login = await fetchJson(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: bootstrapEmail, password }),
    });
    assert.equal(login.res.status, 200, `Login failed: ${login.res.status} ${login.text}`);
    const sessionCookie = cookieHeader(login.res);
    assert(sessionCookie, 'Login did not issue an account session cookie.');

    const usageBefore = await fetchJson(`${baseUrl}/api/v1/account/usage`, {
      headers: { Authorization: `Bearer ${initialApiKey}` },
    });
    assert.equal(usageBefore.res.status, 200, `Account usage failed: ${usageBefore.res.status} ${usageBefore.text}`);

    const pipelineRun = await fetchJson(`${baseUrl}/api/v1/pipeline/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${initialApiKey}`,
      },
      body: JSON.stringify({
        candidateSql: COUNTERPARTY_SQL,
        intent: COUNTERPARTY_INTENT,
        fixtures: [COUNTERPARTY_FIXTURE],
        generatedReport: COUNTERPARTY_REPORT,
        reportContract: COUNTERPARTY_REPORT_CONTRACT,
        sign: true,
      }),
    });
    assert.equal(pipelineRun.res.status, 200, `Pipeline run failed: ${pipelineRun.res.status} ${pipelineRun.text}`);
    assert.equal(pipelineRun.body.decision, 'pass');
    assert.equal(pipelineRun.body.proofMode, 'offline_fixture');
    assert.equal(pipelineRun.body.tenantContext?.tenantId, account.primaryTenantId);
    assert.equal(pipelineRun.body.tenantContext?.planId, 'starter');
    assert.equal(pipelineRun.body.verification?.cryptographic?.valid, true);

    const verify = await fetchJson(`${baseUrl}/api/v1/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${initialApiKey}`,
      },
      body: JSON.stringify({
        certificate: pipelineRun.body.certificate,
        publicKeyPem: pipelineRun.body.publicKeyPem,
        trustChain: pipelineRun.body.trustChain,
        caPublicKeyPem: pipelineRun.body.caPublicKeyPem,
      }),
    });
    assert.equal(verify.res.status, 200, `Verify failed: ${verify.res.status} ${verify.text}`);
    assert.equal(verify.body.overall, 'valid');
    assert.equal(verify.body.signatureValid, true);
    assert.equal(verify.body.chainVerification?.chainIntact, true);
    assert.equal(verify.body.trustBinding?.pkiVerified, true);

    const filing = await fetchJson(`${baseUrl}/api/v1/filing/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${initialApiKey}`,
      },
      body: JSON.stringify({
        adapterId: 'xbrl-us-gaap-2024',
        runId: `launch-product-${suffix}`,
        decision: pipelineRun.body.decision,
        certificateId: pipelineRun.body.certificate.certificateId,
        evidenceChainTerminal: pipelineRun.body.evidenceChainTerminal,
        rows: [
          { counterparty_name: 'Bank of Nova Scotia', exposure_usd: 250000000, credit_rating: 'AA-', sector: 'Banking' },
          { counterparty_name: 'Deutsche Bank AG', exposure_usd: 200000000, credit_rating: 'A-', sector: 'Banking' },
        ],
        proofMode: 'live_runtime',
      }),
    });
    assert.equal(filing.res.status, 200, `Filing export failed: ${filing.res.status} ${filing.text}`);
    assert.equal(filing.body.adapterId, 'xbrl-us-gaap-2024');
    assert.equal(filing.body.package?.issuedPackage?.fileExtension, '.xbr');

    const checkout = await fetchJson(`${baseUrl}/api/v1/account/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        'Idempotency-Key': `launch-verify-checkout-${suffix}`,
      },
      body: JSON.stringify({ planId: 'starter' }),
    });
    assert.equal(checkout.res.status, 200, `Checkout failed: ${checkout.res.status} ${checkout.text}`);
    assert.equal(checkout.body.planId, 'starter');
    assert.equal(checkout.body.trialDays, 14);
    assert.equal(checkout.body.mock, false);
    assert.match(checkout.body.checkoutSessionId, /^cs_/);
    assert.match(checkout.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);

    const stripeCustomer = await stripe.customers.create({
      email: contactEmail,
      name: accountName,
      metadata: {
        attestorAccountId: account.id,
        verification: 'probe-production-hosted-flow',
      },
    });
    stripeCustomerId = stripeCustomer.id;

    const attachBilling = await fetchJson(`${baseUrl}/api/v1/admin/accounts/${account.id}/billing/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminApiKey}`,
        'Idempotency-Key': `launch-verify-attach-${suffix}`,
      },
      body: JSON.stringify({
        stripeCustomerId: stripeCustomer.id,
        stripeSubscriptionStatus: 'trialing',
        stripePriceId: checkout.body.stripePriceId,
      }),
    });
    assert.equal(attachBilling.res.status, 200, `Attach billing failed: ${attachBilling.res.status} ${attachBilling.text}`);

    const portal = await fetchJson(`${baseUrl}/api/v1/account/billing/portal`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    });
    assert.equal(portal.res.status, 200, `Portal failed: ${portal.res.status} ${portal.text}`);
    assert.equal(portal.body.mock, false);
    assert.match(portal.body.portalSessionId, /^bps_/);
    assert.match(portal.body.portalUrl, /^https:\/\/billing\.stripe\.com\//);

    const subscriptionId = `sub_launch_${suffix}`;
    const checkoutCompletedPayload = JSON.stringify({
      id: `evt_launch_checkout_${suffix}`,
      object: 'event',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: checkout.body.checkoutSessionId,
          object: 'checkout.session',
          mode: 'subscription',
          customer: stripeCustomer.id,
          subscription: subscriptionId,
          created: Math.floor(Date.now() / 1000),
          metadata: {
            attestorAccountId: account.id,
            attestorTenantId: account.primaryTenantId,
            attestorPlanId: 'starter',
          },
        },
      },
    });
    const checkoutCompletedSignature = stripe.webhooks.generateTestHeaderString({
      payload: checkoutCompletedPayload,
      secret: stripeWebhookSecret,
    });
    const checkoutCompleted = await fetchJson(`${baseUrl}/api/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': checkoutCompletedSignature,
      },
      body: checkoutCompletedPayload,
    });
    assert.equal(checkoutCompleted.res.status, 200, `Checkout webhook failed: ${checkoutCompleted.res.status} ${checkoutCompleted.text}`);

    const subscriptionTrialingPayload = JSON.stringify({
      id: `evt_launch_subscription_${suffix}`,
      object: 'event',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: subscriptionId,
          object: 'subscription',
          customer: stripeCustomer.id,
          status: 'trialing',
          metadata: {
            attestorAccountId: account.id,
          },
          items: {
            object: 'list',
            data: [{ price: { id: checkout.body.stripePriceId } }],
          },
        },
      },
    });
    const subscriptionTrialingSignature = stripe.webhooks.generateTestHeaderString({
      payload: subscriptionTrialingPayload,
      secret: stripeWebhookSecret,
    });
    const subscriptionTrialing = await fetchJson(`${baseUrl}/api/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': subscriptionTrialingSignature,
      },
      body: subscriptionTrialingPayload,
    });
    assert.equal(subscriptionTrialing.res.status, 200, `Subscription webhook failed: ${subscriptionTrialing.res.status} ${subscriptionTrialing.text}`);

    const entitlement = await fetchJson(`${baseUrl}/api/v1/account/entitlement`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(entitlement.res.status, 200, `Entitlement failed: ${entitlement.res.status} ${entitlement.text}`);
    assert.equal(entitlement.body.entitlement?.status, 'trialing');
    assert.equal(entitlement.body.entitlement?.effectivePlanId, 'starter');

    const accountSummary = await fetchJson(`${baseUrl}/api/v1/account`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(accountSummary.res.status, 200, `Account summary failed: ${accountSummary.res.status} ${accountSummary.text}`);
    assert.equal(accountSummary.body.account?.status, 'active');
    assert.equal(accountSummary.body.account?.billing?.stripeSubscriptionStatus, 'trialing');

    const usageAfter = await fetchJson(`${baseUrl}/api/v1/account/usage`, {
      headers: { Authorization: `Bearer ${initialApiKey}` },
    });
    assert.equal(usageAfter.res.status, 200, `Account usage after run failed: ${usageAfter.res.status} ${usageAfter.text}`);
    assert.ok((usageAfter.body.usage?.used ?? 0) >= (usageBefore.body.usage?.used ?? 0) + 1, 'Usage did not increment after pipeline run.');

    console.log(JSON.stringify({
      baseUrl,
      accountId: account.id,
      tenantId: account.primaryTenantId,
      product: {
        decision: pipelineRun.body.decision,
        proofMode: pipelineRun.body.proofMode,
        certificateId: pipelineRun.body.certificate.certificateId,
        verifyOverall: verify.body.overall,
        filingAdapter: filing.body.adapterId,
      },
      billing: {
        checkoutSessionId: checkout.body.checkoutSessionId,
        checkoutTrialDays: checkout.body.trialDays,
        portalSessionId: portal.body.portalSessionId,
        entitlementStatus: entitlement.body.entitlement.status,
        effectivePlanId: entitlement.body.entitlement.effectivePlanId,
        subscriptionStatus: accountSummary.body.account.billing.stripeSubscriptionStatus,
      },
      usage: {
        before: usageBefore.body.usage?.used ?? null,
        after: usageAfter.body.usage?.used ?? null,
      },
    }, null, 2));
  } finally {
    if (accountId) {
      await archiveAccount(
        baseUrl,
        adminApiKey,
        accountId,
        'probe-production-hosted-flow cleanup',
        `launch-verify-archive-${suffix}`,
      );
    }
    if (stripeCustomerId) {
      await stripe.customers.del(stripeCustomerId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
