import { strict as assert } from 'node:assert';
import {
  STRIPE_SUPPORTED_WEBHOOK_EVENTS,
  STRIPE_WEBHOOK_ROUTE,
  isSupportedStripeWebhookEvent,
} from '../src/service/stripe-webhook-events.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  ok(STRIPE_WEBHOOK_ROUTE === '/api/v1/billing/stripe/webhook', 'Stripe webhook events: route constant matches the live API endpoint');
  ok(new Set(STRIPE_SUPPORTED_WEBHOOK_EVENTS).size === STRIPE_SUPPORTED_WEBHOOK_EVENTS.length, 'Stripe webhook events: supported event list contains no duplicates');
  ok(STRIPE_SUPPORTED_WEBHOOK_EVENTS.includes('checkout.session.completed'), 'Stripe webhook events: checkout completion is supported');
  ok(STRIPE_SUPPORTED_WEBHOOK_EVENTS.includes('customer.subscription.paused'), 'Stripe webhook events: paused subscriptions are supported');
  ok(STRIPE_SUPPORTED_WEBHOOK_EVENTS.includes('customer.subscription.resumed'), 'Stripe webhook events: resumed subscriptions are supported');
  ok(STRIPE_SUPPORTED_WEBHOOK_EVENTS.includes('entitlements.active_entitlement_summary.updated'), 'Stripe webhook events: entitlement summary updates are supported');
  ok(isSupportedStripeWebhookEvent('invoice.payment_failed'), 'Stripe webhook events: helper accepts supported event types');
  ok(!isSupportedStripeWebhookEvent('invoice.finalized'), 'Stripe webhook events: helper rejects unsupported event types');

  console.log(`\nStripe webhook event tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nStripe webhook event tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
