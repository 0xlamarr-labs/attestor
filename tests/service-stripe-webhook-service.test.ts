import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {
  createStripeWebhookService,
  type BillingWebhookMetricOutcome,
  type StripeWebhookServiceDeps,
} from '../src/service/application/stripe-webhook-service.js';
import type { BillingEventRecord } from '../src/service/billing-event-ledger.js';
import type { StripeWebhookRecord } from '../src/service/stripe-webhook-store.js';

const now = '2026-04-21T10:00:00.000Z';

function stripeEvent(overrides: Partial<Stripe.Event> = {}): Stripe.Event {
  return {
    id: 'evt_123',
    object: 'event',
    api_version: null,
    created: 1_776_768_000,
    data: {
      object: {},
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: 'invoice.paid',
    ...overrides,
  } as Stripe.Event;
}

function webhookRecord(overrides: Partial<StripeWebhookRecord> = {}): StripeWebhookRecord {
  return {
    id: 'stripe_evt_123',
    eventId: 'evt_123',
    eventType: 'invoice.paid',
    payloadHash: 'payload-hash',
    accountId: 'acct_123',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    outcome: 'applied',
    reason: null,
    receivedAt: now,
    ...overrides,
  };
}

function billingEventRecord(overrides: Partial<BillingEventRecord> = {}): BillingEventRecord {
  return {
    id: 'bill_evt_123',
    provider: 'stripe',
    source: 'stripe_webhook',
    providerEventId: 'evt_123',
    eventType: 'invoice.paid',
    payloadHash: 'payload-hash',
    outcome: 'pending',
    reason: null,
    accountId: null,
    tenantId: null,
    stripeCheckoutSessionId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    stripeInvoiceId: null,
    stripeInvoiceStatus: null,
    stripeInvoiceCurrency: null,
    stripeInvoiceAmountPaid: null,
    stripeInvoiceAmountDue: null,
    accountStatusBefore: null,
    accountStatusAfter: null,
    billingStatusBefore: null,
    billingStatusAfter: null,
    mappedPlanId: null,
    receivedAt: now,
    processedAt: null,
    metadata: {},
    ...overrides,
  };
}

function stripeClientFor(event: Stripe.Event): Stripe {
  return {
    webhooks: {
      constructEvent: () => event,
    },
  } as unknown as Stripe;
}

function createDeps(overrides: Partial<StripeWebhookServiceDeps> = {}): StripeWebhookServiceDeps {
  const deps: StripeWebhookServiceDeps = {
    stripeClient: () => stripeClientFor(stripeEvent()),
    observeBillingWebhookEvent: () => {},
    isBillingEventLedgerConfigured: () => false,
    isSharedControlPlaneConfigured: () => false,
    claimStripeBillingEvent: async (input) => ({
      kind: 'claimed',
      payloadHash: 'shared-payload-hash',
      record: billingEventRecord({
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        payloadHash: 'shared-payload-hash',
      }),
    }),
    claimProcessedStripeWebhookState: async (input) => ({
      kind: 'claimed',
      payloadHash: 'control-payload-hash',
      claimId: 'claim_123',
      record: webhookRecord({
        eventId: input.eventId,
        eventType: input.eventType,
        payloadHash: 'control-payload-hash',
        outcome: 'pending',
      }),
    }),
    lookupProcessedStripeWebhookState: async () => ({
      kind: 'miss',
      payloadHash: 'file-payload-hash',
    }),
    finalizeProcessedStripeWebhookState: async (input) => ({
      record: webhookRecord({
        eventId: input.eventId,
        eventType: input.eventType,
        accountId: input.accountId,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        outcome: input.outcome,
        reason: input.reason,
      }),
      path: null,
    }),
    recordProcessedStripeWebhookState: async (input) => ({
      record: webhookRecord({
        eventId: input.eventId,
        eventType: input.eventType,
        accountId: input.accountId,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        outcome: input.outcome,
        reason: input.reason,
      }),
      path: null,
    }),
    releaseProcessedStripeWebhookClaimState: async () => {},
    finalizeStripeBillingEvent: async (input) => billingEventRecord({
      providerEventId: input.providerEventId,
      outcome: input.outcome,
      reason: input.reason ?? null,
      accountId: input.accountId ?? null,
    }),
    releaseStripeBillingEventClaim: async () => {},
  };
  return {
    ...deps,
    ...overrides,
  };
}

async function testMissingSecretFailsClosed(): Promise<void> {
  const service = createStripeWebhookService(createDeps());

  const result = await service.begin({
    webhookSecret: ' ',
    signature: 'sig',
    rawPayload: '{}',
  });

  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') {
    assert.equal(result.statusCode, 503);
    assert.match(String(result.responseBody.error), /webhook disabled/u);
  }
}

async function testMissingSignatureFailsClosed(): Promise<void> {
  const service = createStripeWebhookService(createDeps());

  const result = await service.begin({
    webhookSecret: 'whsec_123',
    signature: null,
    rawPayload: '{}',
  });

  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') {
    assert.equal(result.statusCode, 400);
    assert.match(String(result.responseBody.error), /Stripe-Signature/u);
  }
}

async function testInvalidSignatureIsObserved(): Promise<void> {
  const observed: Array<[string, BillingWebhookMetricOutcome]> = [];
  const service = createStripeWebhookService(createDeps({
    stripeClient: () => ({
      webhooks: {
        constructEvent: () => {
          throw new Error('bad signature');
        },
      },
    } as unknown as Stripe),
    observeBillingWebhookEvent: (eventType, outcome) => {
      observed.push([eventType, outcome]);
    },
  }));

  const result = await service.begin({
    webhookSecret: 'whsec_123',
    signature: 'bad',
    rawPayload: '{}',
  });

  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') {
    assert.equal(result.statusCode, 400);
  }
  assert.deepEqual(observed, [['signature_verification', 'signature_invalid']]);
}

async function testFileModeReadyHandleFinalizesDedupe(): Promise<void> {
  let finalizedInput: Parameters<StripeWebhookServiceDeps['recordProcessedStripeWebhookState']>[0] | null = null;
  const service = createStripeWebhookService(createDeps({
    recordProcessedStripeWebhookState: async (input) => {
      finalizedInput = input;
      return { record: webhookRecord({ eventId: input.eventId }), path: null };
    },
  }));

  const result = await service.begin({
    webhookSecret: 'whsec_123',
    signature: 'sig',
    rawPayload: '{"id":"evt_123"}',
  });

  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.webhook.event.id, 'evt_123');
  assert.equal(result.webhook.payloadHash, 'file-payload-hash');
  assert.equal(result.webhook.sharedBillingLedger, false);

  await result.webhook.finalizeDedupe({
    eventType: 'invoice.paid',
    accountId: 'acct_123',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    outcome: 'applied',
    reason: null,
  });

  assert.equal(finalizedInput?.eventId, 'evt_123');
  assert.equal(finalizedInput?.rawPayload, '{"id":"evt_123"}');
}

async function testDuplicateMapsToReplayResponse(): Promise<void> {
  const observed: Array<[string, BillingWebhookMetricOutcome]> = [];
  const service = createStripeWebhookService(createDeps({
    observeBillingWebhookEvent: (eventType, outcome) => {
      observed.push([eventType, outcome]);
    },
    lookupProcessedStripeWebhookState: async () => ({
      kind: 'duplicate',
      payloadHash: 'payload-hash',
      record: webhookRecord({
        eventType: 'invoice.payment_failed',
        outcome: 'ignored',
        reason: 'no_account_match',
      }),
    }),
  }));

  const result = await service.begin({
    webhookSecret: 'whsec_123',
    signature: 'sig',
    rawPayload: '{"id":"evt_123"}',
  });

  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') {
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers?.['x-attestor-stripe-replay'], 'true');
    assert.equal(result.responseBody.duplicate, true);
    assert.equal(result.responseBody.outcome, 'ignored');
  }
  assert.deepEqual(observed, [['invoice.payment_failed', 'duplicate']]);
}

async function testSharedLedgerFinalizationSuppressesRelease(): Promise<void> {
  let releaseCount = 0;
  let finalizedProviderEventId: string | null = null;
  const service = createStripeWebhookService(createDeps({
    isBillingEventLedgerConfigured: () => true,
    finalizeStripeBillingEvent: async (input) => {
      finalizedProviderEventId = input.providerEventId;
      return billingEventRecord({
        providerEventId: input.providerEventId,
        outcome: input.outcome,
      });
    },
    releaseStripeBillingEventClaim: async () => {
      releaseCount += 1;
    },
  }));

  const result = await service.begin({
    webhookSecret: 'whsec_123',
    signature: 'sig',
    rawPayload: '{"id":"evt_123"}',
  });

  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;

  await result.webhook.finalizeSharedEvent({
    providerEventId: 'evt_123',
    outcome: 'ignored',
    reason: 'test_complete',
  });
  await result.webhook.releaseClaim();

  assert.equal(finalizedProviderEventId, 'evt_123');
  assert.equal(result.webhook.finalizedSharedEvent, true);
  assert.equal(releaseCount, 0);
}

async function testSharedControlPlaneClaimReleaseAndFinalize(): Promise<void> {
  let finalizedClaimId: string | null = null;
  let releasedClaimId: string | null = null;
  const service = createStripeWebhookService(createDeps({
    isSharedControlPlaneConfigured: () => true,
    finalizeProcessedStripeWebhookState: async (input) => {
      finalizedClaimId = input.claimId;
      return {
        record: webhookRecord({
          eventId: input.eventId,
          eventType: input.eventType,
          outcome: input.outcome,
        }),
        path: null,
      };
    },
    releaseProcessedStripeWebhookClaimState: async (_eventId, claimId) => {
      releasedClaimId = claimId;
    },
  }));

  const result = await service.begin({
    webhookSecret: 'whsec_123',
    signature: 'sig',
    rawPayload: '{"id":"evt_123"}',
  });

  assert.equal(result.kind, 'ready');
  if (result.kind !== 'ready') return;
  assert.equal(result.webhook.sharedControlPlaneWebhookState, true);
  assert.equal(result.webhook.controlPlaneClaimId, 'claim_123');

  await result.webhook.finalizeDedupe({
    eventType: 'invoice.paid',
    accountId: 'acct_123',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    outcome: 'applied',
    reason: null,
  });
  await result.webhook.releaseClaim();

  assert.equal(finalizedClaimId, 'claim_123');
  assert.equal(result.webhook.finalizedControlPlaneEvent, true);
  assert.equal(releasedClaimId, null);
}

await testMissingSecretFailsClosed();
await testMissingSignatureFailsClosed();
await testInvalidSignatureIsObserved();
await testFileModeReadyHandleFinalizesDedupe();
await testDuplicateMapsToReplayResponse();
await testSharedLedgerFinalizationSuppressesRelease();
await testSharedControlPlaneClaimReleaseAndFinalize();

console.log('Service stripe webhook service tests: 7 passed, 0 failed');
