import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { AccountStoreError } from '../src/service/account-store.js';
import {
  createStripeWebhookBillingProcessor,
  type StripeWebhookBillingProcessorDeps,
} from '../src/service/application/stripe-webhook-billing-processor.js';
import type {
  StripeWebhookDedupeFinalizationInput,
  StripeWebhookProcessingHandle,
  StripeWebhookSharedFinalizationInput,
} from '../src/service/application/stripe-webhook-service.js';

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

function createWebhook(
  event: Stripe.Event,
  overrides: Partial<StripeWebhookProcessingHandle> = {},
): StripeWebhookProcessingHandle {
  return {
    event,
    rawPayload: '{"id":"evt_123"}',
    payloadHash: 'payload-hash',
    sharedBillingLedger: false,
    sharedControlPlaneWebhookState: false,
    controlPlaneClaimId: null,
    finalizedSharedEvent: false,
    finalizedControlPlaneEvent: false,
    async finalizeSharedEvent() {},
    async finalizeDedupe() {},
    async releaseClaim() {},
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<StripeWebhookBillingProcessorDeps> = {},
): StripeWebhookBillingProcessorDeps {
  const deps: StripeWebhookBillingProcessorDeps = {
    observeBillingWebhookEvent: () => {},
    isSupportedStripeWebhookEvent: () => false,
    stripeReferenceId: (value) => typeof value === 'string' ? value : null,
    parseStripeInvoiceStatus: () => null,
    stripeInvoicePriceId: () => null,
    metadataStringValue: () => null,
    applyStripeSubscriptionStateState: async () => {
      throw new Error('unused applyStripeSubscriptionStateState');
    },
    applyStripeInvoiceStateState: async () => {
      throw new Error('unused applyStripeInvoiceStateState');
    },
    applyStripeCheckoutCompletionState: async () => {
      throw new Error('unused applyStripeCheckoutCompletionState');
    },
    findHostedAccountByStripeRefs: async () => ({
      record: null,
      matchReason: 'none',
    }),
    findHostedPlanByStripePriceId: () => null,
    resolvePlanSpec: (() => {
      throw new Error('unused resolvePlanSpec');
    }) as StripeWebhookBillingProcessorDeps['resolvePlanSpec'],
    DEFAULT_HOSTED_PLAN_ID: 'community',
    syncTenantPlanByTenantIdState: async () => ({
      record: null,
      path: null,
    }),
    syncHostedBillingEntitlement: async () => {
      throw new Error('unused syncHostedBillingEntitlement');
    },
    revokeAccountSessionsForLifecycleChange: async () => 0,
    appendAdminAuditRecordState: async () => {
      throw new Error('unused appendAdminAuditRecordState');
    },
    billingEntitlementView: () => ({}),
    extractInvoiceLineItemSnapshotsFromInvoice: () => ({
      lineItems: [],
      hasMore: false,
    }),
    listHostedStripeActiveEntitlements: async () => [],
    extractActiveEntitlementsFromSummary: () => [],
    listHostedStripeInvoiceLineItems: async () => [],
    upsertStripeInvoiceLineItems: async () => ({
      recordCount: 0,
      records: [],
    }),
    parseStripeChargeStatus: () => null,
    getHostedPlan: () => null,
    upsertStripeCharges: async () => ({
      recordCount: 0,
      records: [],
    }),
    unixSecondsToIso: () => '2026-04-21T10:00:00.000Z',
    resolvePlanStripePrice: (() => {
      throw new Error('unused resolvePlanStripePrice');
    }) as StripeWebhookBillingProcessorDeps['resolvePlanStripePrice'],
  };
  return {
    ...deps,
    ...overrides,
  };
}

async function testUnsupportedEventFinalizesFileDedupe(): Promise<void> {
  const observed: Array<[string, string]> = [];
  let dedupeFinalization: StripeWebhookDedupeFinalizationInput | null = null;
  const processor = createStripeWebhookBillingProcessor(createDeps({
    observeBillingWebhookEvent: (eventType, outcome) => {
      observed.push([eventType, outcome]);
    },
  }));
  const webhook = createWebhook(stripeEvent({
    type: 'customer.created',
  }), {
    finalizeDedupe: async (input) => {
      dedupeFinalization = input;
    },
  });

  const result = await processor.process(webhook);

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.ignored, true);
  assert.equal(result.responseBody.reason, 'unsupported_event_type');
  assert.deepEqual(observed, [['customer.created', 'ignored']]);
  assert.deepEqual(dedupeFinalization, {
    eventType: 'customer.created',
    accountId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    outcome: 'ignored',
    reason: 'unsupported_event_type',
  });
}

async function testUnsupportedEventFinalizesSharedLedger(): Promise<void> {
  let sharedFinalization: StripeWebhookSharedFinalizationInput | null = null;
  const processor = createStripeWebhookBillingProcessor(createDeps());
  const webhook = createWebhook(stripeEvent({
    type: 'customer.created',
  }), {
    sharedBillingLedger: true,
    finalizeSharedEvent: async (input) => {
      sharedFinalization = input;
    },
  });

  const result = await processor.process(webhook);

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.ignored, true);
  assert.equal(sharedFinalization?.providerEventId, 'evt_123');
  assert.equal(sharedFinalization?.outcome, 'ignored');
  assert.equal(sharedFinalization?.reason, 'unsupported_event_type');
}

async function testAccountStoreErrorReleasesClaimAndMapsConflict(): Promise<void> {
  let releaseCount = 0;
  const processor = createStripeWebhookBillingProcessor(createDeps({
    isSupportedStripeWebhookEvent: () => true,
    applyStripeSubscriptionStateState: async () => {
      throw new AccountStoreError('INVALID_STATE', 'account state is locked');
    },
  }));
  const webhook = createWebhook(stripeEvent({
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        items: {
          data: [{
            price: {
              id: 'price_123',
            },
          }],
        },
        metadata: {
          attestorAccountId: 'acct_123',
        },
      },
    },
  }), {
    releaseClaim: async () => {
      releaseCount += 1;
    },
  });

  const result = await processor.process(webhook);

  assert.equal(releaseCount, 1);
  assert.equal(result.statusCode, 409);
  assert.deepEqual(result.responseBody, {
    error: 'account state is locked',
  });
}

await testUnsupportedEventFinalizesFileDedupe();
await testUnsupportedEventFinalizesSharedLedger();
await testAccountStoreErrorReleasesClaimAndMapsConflict();

console.log('Service stripe webhook billing processor tests: 3 passed, 0 failed');
