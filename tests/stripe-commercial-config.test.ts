import { strict as assert } from 'node:assert';
import {
  StripeBillingError,
  createHostedBillingPortalSession,
  createHostedCheckoutSession,
} from '../src/service/stripe-billing.js';
import { getHostedPlan, resolvePlanStripeTrialDays } from '../src/service/plan-catalog.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  const previous = {
    ATTESTOR_STRIPE_USE_MOCK: process.env.ATTESTOR_STRIPE_USE_MOCK,
    ATTESTOR_BILLING_SUCCESS_URL: process.env.ATTESTOR_BILLING_SUCCESS_URL,
    ATTESTOR_BILLING_CANCEL_URL: process.env.ATTESTOR_BILLING_CANCEL_URL,
    ATTESTOR_STRIPE_STARTER_TRIAL_DAYS: process.env.ATTESTOR_STRIPE_STARTER_TRIAL_DAYS,
    ATTESTOR_STRIPE_PRICE_STARTER: process.env.ATTESTOR_STRIPE_PRICE_STARTER,
    ATTESTOR_STRIPE_PRICE_PRO: process.env.ATTESTOR_STRIPE_PRICE_PRO,
  };

  process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
  process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.example.invalid/billing/success';
  process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.example.invalid/billing/cancel';
  process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_live';
  process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_live';

  try {
    const starter = getHostedPlan('starter');
    const pro = getHostedPlan('pro');
    const community = getHostedPlan('community');

    ok(starter?.defaultStripeTrialDays === 14, 'Stripe commercial config: starter defaults to a 14-day trial');
    ok(pro?.defaultStripeTrialDays === null, 'Stripe commercial config: pro defaults to no trial');
    ok(community?.intendedFor === 'self_host', 'Stripe commercial config: community remains self-host only');

    process.env.ATTESTOR_STRIPE_STARTER_TRIAL_DAYS = '21';
    ok(resolvePlanStripeTrialDays('starter').trialDays === 21, 'Stripe commercial config: starter trial can be overridden by env');

    process.env.ATTESTOR_STRIPE_STARTER_TRIAL_DAYS = '0';
    ok(resolvePlanStripeTrialDays('starter').trialDays === 14, 'Stripe commercial config: invalid starter trial override falls back to 14 days');

    delete process.env.ATTESTOR_STRIPE_STARTER_TRIAL_DAYS;

    const account = {
      id: 'acct_123',
      primaryTenantId: 'tenant_123',
      contactEmail: 'ops@attestor.example.invalid',
      billing: {
        stripeCustomerId: null,
      },
    } as any;

    const tenant = {
      tenantId: 'tenant_123',
      source: 'account_session',
      planId: 'starter',
    } as any;

    const starterCheckout = await createHostedCheckoutSession({
      account,
      tenant,
      plan: starter!,
      idempotencyKey: 'starter-trial-test',
    });
    ok(starterCheckout.trialDays === 14, 'Stripe commercial config: starter checkout returns a 14-day trial in mock mode');

    const proCheckout = await createHostedCheckoutSession({
      account,
      tenant: { ...tenant, planId: 'pro' },
      plan: pro!,
      idempotencyKey: 'pro-no-trial-test',
    });
    ok(proCheckout.trialDays === null, 'Stripe commercial config: pro checkout returns no trial in mock mode');

    process.env.ATTESTOR_BILLING_SUCCESS_URL = '/billing/success';
    let invalidCheckoutUrlError: unknown = null;
    try {
      await createHostedCheckoutSession({
        account,
        tenant,
        plan: starter!,
        idempotencyKey: 'invalid-url-test',
      });
    } catch (error) {
      invalidCheckoutUrlError = error;
    }
    ok(invalidCheckoutUrlError instanceof StripeBillingError, 'Stripe commercial config: invalid checkout return URL raises StripeBillingError');
    ok((invalidCheckoutUrlError as StripeBillingError).code === 'CONFIG', 'Stripe commercial config: invalid checkout return URL is treated as config error');

    process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.example.invalid/billing/success';
    process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'javascript:alert(1)';
    let invalidPortalUrlError: unknown = null;
    try {
      await createHostedBillingPortalSession({
        account: {
          ...account,
          billing: {
            stripeCustomerId: 'cus_123',
          },
        },
      });
    } catch (error) {
      invalidPortalUrlError = error;
    }
    ok(invalidPortalUrlError instanceof StripeBillingError, 'Stripe commercial config: invalid portal return URL raises StripeBillingError');
    ok((invalidPortalUrlError as StripeBillingError).code === 'CONFIG', 'Stripe commercial config: invalid portal return URL is treated as config error');

    console.log(`\nStripe commercial config tests: ${passed} passed, 0 failed`);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error('\nStripe commercial config tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
