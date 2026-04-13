import Stripe from 'stripe';
import {
  STRIPE_SUPPORTED_WEBHOOK_EVENTS,
  STRIPE_WEBHOOK_ROUTE,
} from '../src/service/stripe-webhook-events.js';

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const entry = process.argv.find((candidate) => candidate.startsWith(prefix));
  return entry ? entry.slice(prefix.length).trim() : null;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function requireStripeApiKey(): string {
  const apiKey = env('STRIPE_API_KEY');
  if (!apiKey) {
    throw new Error('STRIPE_API_KEY must be set to probe Stripe webhook endpoint configuration.');
  }
  return apiKey;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function expectedWebhookUrl(): string | null {
  const explicitUrl = arg('url') ?? env('ATTESTOR_STRIPE_WEBHOOK_URL');
  if (explicitUrl) return normalizeUrl(explicitUrl);

  const publicBaseUrl = env('ATTESTOR_PUBLIC_BASE_URL');
  if (publicBaseUrl) return `${normalizeUrl(publicBaseUrl)}${STRIPE_WEBHOOK_ROUTE}`;

  const hostname = env('ATTESTOR_PUBLIC_HOSTNAME');
  if (hostname) return `https://${hostname}${STRIPE_WEBHOOK_ROUTE}`;

  return null;
}

async function resolveWebhookEndpoint(stripe: Stripe): Promise<Stripe.WebhookEndpoint> {
  const endpointId = arg('endpoint-id') ?? env('ATTESTOR_STRIPE_WEBHOOK_ENDPOINT_ID');
  if (endpointId) {
    return stripe.webhookEndpoints.retrieve(endpointId);
  }

  const targetUrl = expectedWebhookUrl();
  const endpointPage = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoints = endpointPage.data;
  const urlMatches = targetUrl
    ? endpoints.filter((endpoint) => normalizeUrl(endpoint.url) === targetUrl)
    : endpoints.filter((endpoint) => normalizeUrl(endpoint.url).endsWith(STRIPE_WEBHOOK_ROUTE));

  if (urlMatches.length === 1) return urlMatches[0]!;
  if (urlMatches.length > 1) {
    throw new Error(
      targetUrl
        ? `Multiple Stripe webhook endpoints matched '${targetUrl}'. Re-run with --endpoint-id=<we_...>.`
        : `Multiple Stripe webhook endpoints matched '${STRIPE_WEBHOOK_ROUTE}'. Re-run with --endpoint-id=<we_...> or --url=<https://...>.`,
    );
  }

  if (targetUrl) {
    throw new Error(`No Stripe webhook endpoint matched '${targetUrl}'.`);
  }
  throw new Error('No Stripe webhook endpoint matched the Attestor Stripe webhook route. Set ATTESTOR_PUBLIC_HOSTNAME, ATTESTOR_PUBLIC_BASE_URL, ATTESTOR_STRIPE_WEBHOOK_URL, or pass --endpoint-id / --url.');
}

async function main(): Promise<void> {
  const stripe = new Stripe(requireStripeApiKey());
  const endpoint = await resolveWebhookEndpoint(stripe);
  const enabledEvents = [...endpoint.enabled_events].sort();
  const expectedEvents = [...STRIPE_SUPPORTED_WEBHOOK_EVENTS].sort();
  const enabledEventSet = new Set(enabledEvents);
  const missingEvents = expectedEvents.filter((eventType) => !enabledEventSet.has(eventType));
  const extraEvents = enabledEvents.filter((eventType) => !STRIPE_SUPPORTED_WEBHOOK_EVENTS.includes(eventType as any));

  const summary = {
    endpointId: endpoint.id,
    url: endpoint.url,
    livemode: endpoint.livemode,
    status: endpoint.status,
    missingEvents,
    extraEvents,
    enabledEvents,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (missingEvents.length > 0) {
    throw new Error(`Stripe webhook endpoint '${endpoint.id}' is missing supported Attestor event(s): ${missingEvents.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
