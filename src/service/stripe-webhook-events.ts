export const STRIPE_WEBHOOK_ROUTE = '/api/v1/billing/stripe/webhook';

export const STRIPE_SUPPORTED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'entitlements.active_entitlement_summary.updated',
] as const;

export type SupportedStripeWebhookEvent = (typeof STRIPE_SUPPORTED_WEBHOOK_EVENTS)[number];

const STRIPE_SUPPORTED_WEBHOOK_EVENT_SET = new Set<string>(STRIPE_SUPPORTED_WEBHOOK_EVENTS);

export function isSupportedStripeWebhookEvent(eventType: string): eventType is SupportedStripeWebhookEvent {
  return STRIPE_SUPPORTED_WEBHOOK_EVENT_SET.has(eventType);
}
