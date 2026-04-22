import Stripe from 'stripe';

export function stripeClient(): Stripe {
  return new Stripe(process.env.STRIPE_API_KEY?.trim() || 'sk_test_attestor_local');
}

export function parseStripeInvoiceStatus(
  raw: unknown,
): 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  switch (raw.trim()) {
    case 'draft':
    case 'open':
    case 'paid':
    case 'uncollectible':
    case 'void':
      return raw.trim() as 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
    default:
      return null;
  }
}

export function parseStripeChargeStatus(
  raw: unknown,
): 'succeeded' | 'pending' | 'failed' | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  switch (raw.trim()) {
    case 'succeeded':
    case 'pending':
    case 'failed':
      return raw.trim() as 'succeeded' | 'pending' | 'failed';
    default:
      return null;
  }
}

export function metadataStringValue(
  key: string,
  ...sources: Array<Record<string, unknown> | Stripe.Metadata | null | undefined>
): string | null {
  for (const source of sources) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

export function stripeReferenceId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof (value as { id?: unknown }).id === 'string'
  ) {
    return (value as { id: string }).id.trim();
  }
  return null;
}

export function unixSecondsToIso(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

export function stripeInvoicePriceId(invoice: Stripe.Invoice): string | null {
  for (const entry of invoice.lines?.data ?? []) {
    const directPriceId = stripeReferenceId((entry as { price?: unknown }).price);
    if (directPriceId) return directPriceId;
    const pricingPriceId = stripeReferenceId(
      (
        entry as {
          pricing?: { price_details?: { price?: unknown } | null } | null;
        }
      ).pricing?.price_details?.price,
    );
    if (pricingPriceId) return pricingPriceId;
  }
  return null;
}
