import type { Hono } from 'hono';
import {
  registerEmailWebhookRoutes,
  type EmailWebhookRouteDeps,
} from './email-webhook-routes.js';
import {
  registerStripeWebhookRoutes,
  type StripeWebhookRouteDeps,
} from './stripe-webhook-routes.js';

export interface WebhookRouteDeps extends EmailWebhookRouteDeps, StripeWebhookRouteDeps {}

export function registerWebhookRoutes(app: Hono, deps: WebhookRouteDeps): void {
  registerEmailWebhookRoutes(app, deps);
  registerStripeWebhookRoutes(app, deps);
}
