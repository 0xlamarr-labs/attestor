import type { Context, Hono } from 'hono';
import type {
  StripeWebhookBillingProcessor,
  StripeWebhookProcessorObservability,
} from '../../application/stripe-webhook-billing-processor.js';
import type { StripeWebhookService } from '../../application/stripe-webhook-service.js';

export interface StripeWebhookRouteDeps {
  stripeWebhookService: StripeWebhookService;
  stripeWebhookBillingProcessor: StripeWebhookBillingProcessor;
}

function hasObservedField(
  observability: StripeWebhookProcessorObservability,
  key: keyof StripeWebhookProcessorObservability,
): boolean {
  return Object.prototype.hasOwnProperty.call(observability, key);
}

function applyStripeWebhookObservability(
  c: Context,
  observability: StripeWebhookProcessorObservability,
): void {
  if (hasObservedField(observability, 'accountId')) {
    c.set('obs.accountId', observability.accountId ?? null);
  }
  if (hasObservedField(observability, 'accountStatus')) {
    c.set('obs.accountStatus', observability.accountStatus ?? null);
  }
  if (hasObservedField(observability, 'tenantId')) {
    c.set('obs.tenantId', observability.tenantId ?? null);
  }
  if (hasObservedField(observability, 'planId')) {
    c.set('obs.planId', observability.planId ?? null);
  }
}

export function registerStripeWebhookRoutes(app: Hono, deps: StripeWebhookRouteDeps): void {
  const {
    stripeWebhookService,
    stripeWebhookBillingProcessor,
  } = deps;

  app.post('/api/v1/billing/stripe/webhook', async (c) => {
    const rawPayload = await c.req.text();
    const stripeWebhookBegin = await stripeWebhookService.begin({
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      signature: c.req.header('stripe-signature'),
      rawPayload,
    });
    if (stripeWebhookBegin.kind === 'rejected') {
      for (const [key, value] of Object.entries(stripeWebhookBegin.headers ?? {})) {
        c.header(key, value);
      }
      return c.json(stripeWebhookBegin.responseBody, stripeWebhookBegin.statusCode);
    }

    const stripeWebhook = stripeWebhookBegin.webhook;
    c.header('x-attestor-stripe-event-id', stripeWebhook.event.id);

    const result = await stripeWebhookBillingProcessor.process(stripeWebhook);
    applyStripeWebhookObservability(c, result.observability);
    return c.json(result.responseBody, result.statusCode);
  });
}
