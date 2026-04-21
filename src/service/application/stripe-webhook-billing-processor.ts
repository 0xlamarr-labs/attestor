import Stripe from 'stripe';
import {
  AccountStoreError,
  type HostedAccountRecord,
  type StripeInvoiceStatus,
} from '../account-store.js';
import type * as BillingEventLedger from '../billing-event-ledger.js';
import type { HostedBillingEntitlementRecord } from '../billing-entitlement-store.js';
import type * as ControlPlaneStore from '../control-plane-store.js';
import type * as PlanCatalog from '../plan-catalog.js';
import type * as StripeBilling from '../stripe-billing.js';
import type {
  BillingWebhookMetricOutcome,
  StripeWebhookProcessingHandle,
} from './stripe-webhook-service.js';

interface SyncHostedBillingEntitlementOptions {
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
}

type StripeAccountMatchReason = 'account_id' | 'subscription_id' | 'customer_id' | 'none';

interface StripeAccountMatch {
  record: HostedAccountRecord | null;
  matchReason: StripeAccountMatchReason;
}

type StripeInvoiceWebhookObject = Stripe.Invoice & {
  subscription?: unknown;
  subscription_details?: {
    metadata?: Record<string, unknown> | Stripe.Metadata | null;
  } | null;
  status_transitions?: {
    paid_at?: unknown;
  } | null;
  billing_reason?: string | null;
};

export interface StripeWebhookProcessorObservability {
  accountId?: string | null;
  accountStatus?: HostedAccountRecord['status'] | null;
  tenantId?: string | null;
  planId?: string | null;
}

export interface StripeWebhookBillingProcessorResult {
  statusCode: 200 | 404 | 409;
  responseBody: Record<string, unknown>;
  observability: StripeWebhookProcessorObservability;
}

interface StripeWebhookProcessorContext {
  observability: StripeWebhookProcessorObservability;
  json(
    responseBody: Record<string, unknown>,
    statusCode?: 200 | 404 | 409,
  ): StripeWebhookBillingProcessorResult;
  set(key: string, value: unknown): void;
}

export interface StripeWebhookBillingProcessor {
  process(stripeWebhook: StripeWebhookProcessingHandle): Promise<StripeWebhookBillingProcessorResult>;
}

export interface StripeWebhookBillingProcessorDeps {
  observeBillingWebhookEvent(eventType: string, outcome: BillingWebhookMetricOutcome): void;
  isSupportedStripeWebhookEvent(eventType: string): boolean;
  stripeReferenceId(value: unknown): string | null;
  parseStripeInvoiceStatus(raw: unknown): StripeInvoiceStatus;
  stripeInvoicePriceId(invoice: Stripe.Invoice): string | null;
  metadataStringValue(
    key: string,
    ...sources: Array<Record<string, unknown> | Stripe.Metadata | null | undefined>
  ): string | null;
  applyStripeSubscriptionStateState: typeof ControlPlaneStore.applyStripeSubscriptionStateState;
  applyStripeInvoiceStateState: typeof ControlPlaneStore.applyStripeInvoiceStateState;
  applyStripeCheckoutCompletionState: typeof ControlPlaneStore.applyStripeCheckoutCompletionState;
  findHostedAccountByStripeRefs(options: {
    accountId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }): Promise<StripeAccountMatch>;
  findHostedPlanByStripePriceId: typeof PlanCatalog.findHostedPlanByStripePriceId;
  resolvePlanSpec: typeof PlanCatalog.resolvePlanSpec;
  DEFAULT_HOSTED_PLAN_ID: typeof PlanCatalog.DEFAULT_HOSTED_PLAN_ID;
  syncTenantPlanByTenantIdState: typeof ControlPlaneStore.syncTenantPlanByTenantIdState;
  syncHostedBillingEntitlement(
    account: HostedAccountRecord,
    options?: SyncHostedBillingEntitlementOptions,
  ): Promise<HostedBillingEntitlementRecord>;
  revokeAccountSessionsForLifecycleChange(options: {
    account: HostedAccountRecord | null;
    previousStatus: HostedAccountRecord['status'] | null;
    nextStatus: HostedAccountRecord['status'] | null;
  }): Promise<number>;
  appendAdminAuditRecordState: typeof ControlPlaneStore.appendAdminAuditRecordState;
  billingEntitlementView(record: HostedBillingEntitlementRecord): Record<string, unknown>;
  extractInvoiceLineItemSnapshotsFromInvoice: typeof StripeBilling.extractInvoiceLineItemSnapshotsFromInvoice;
  listHostedStripeActiveEntitlements: typeof StripeBilling.listHostedStripeActiveEntitlements;
  extractActiveEntitlementsFromSummary: typeof StripeBilling.extractActiveEntitlementsFromSummary;
  listHostedStripeInvoiceLineItems: typeof StripeBilling.listHostedStripeInvoiceLineItems;
  upsertStripeInvoiceLineItems: typeof BillingEventLedger.upsertStripeInvoiceLineItems;
  parseStripeChargeStatus(raw: unknown): BillingEventLedger.BillingChargeStatus;
  getHostedPlan: typeof PlanCatalog.getHostedPlan;
  upsertStripeCharges: typeof BillingEventLedger.upsertStripeCharges;
  unixSecondsToIso(value: unknown): string | null;
  resolvePlanStripePrice: typeof PlanCatalog.resolvePlanStripePrice;
}

function createProcessorContext(): StripeWebhookProcessorContext {
  const observability: StripeWebhookProcessorObservability = {};
  return {
    observability,
    json(responseBody, statusCode = 200) {
      return {
        statusCode,
        responseBody,
        observability,
      };
    },
    set(key, value) {
      switch (key) {
        case 'obs.accountId':
          observability.accountId = typeof value === 'string' ? value : null;
          break;
        case 'obs.accountStatus':
          observability.accountStatus = typeof value === 'string'
            ? value as HostedAccountRecord['status']
            : null;
          break;
        case 'obs.tenantId':
          observability.tenantId = typeof value === 'string' ? value : null;
          break;
        case 'obs.planId':
          observability.planId = typeof value === 'string' ? value : null;
          break;
      }
    },
  };
}

function accountStoreErrorResponse(
  c: StripeWebhookProcessorContext,
  err: unknown,
): StripeWebhookBillingProcessorResult | null {
  if (!(err instanceof AccountStoreError)) return null;
  if (err.code === 'NOT_FOUND') {
    return c.json({ error: err.message }, 404);
  }
  return c.json({ error: err.message }, 409);
}

export function createStripeWebhookBillingProcessor(
  deps: StripeWebhookBillingProcessorDeps,
): StripeWebhookBillingProcessor {
  const {
    observeBillingWebhookEvent,
    isSupportedStripeWebhookEvent,
    stripeReferenceId,
    parseStripeInvoiceStatus,
    stripeInvoicePriceId,
    metadataStringValue,
    applyStripeSubscriptionStateState,
    applyStripeInvoiceStateState,
    applyStripeCheckoutCompletionState,
    findHostedAccountByStripeRefs,
    findHostedPlanByStripePriceId,
    resolvePlanSpec,
    DEFAULT_HOSTED_PLAN_ID,
    syncTenantPlanByTenantIdState,
    syncHostedBillingEntitlement,
    revokeAccountSessionsForLifecycleChange,
    appendAdminAuditRecordState,
    billingEntitlementView,
    extractInvoiceLineItemSnapshotsFromInvoice,
    listHostedStripeActiveEntitlements,
    extractActiveEntitlementsFromSummary,
    listHostedStripeInvoiceLineItems,
    upsertStripeInvoiceLineItems,
    parseStripeChargeStatus,
    getHostedPlan,
    upsertStripeCharges,
    unixSecondsToIso,
    resolvePlanStripePrice,
  } = deps;

  function isStripeChargeEvent(eventType: string): boolean {
    return eventType === 'charge.succeeded'
      || eventType === 'charge.failed'
      || eventType === 'charge.refunded';
  }

  async function processUnsupportedEvent(
    stripeWebhook: StripeWebhookProcessingHandle,
    c: StripeWebhookProcessorContext,
  ): Promise<StripeWebhookBillingProcessorResult> {
    const event = stripeWebhook.event;
    const sharedBillingLedger = stripeWebhook.sharedBillingLedger;
    observeBillingWebhookEvent(event.type, 'ignored');
    if (sharedBillingLedger) {
      await stripeWebhook.finalizeSharedEvent({
        providerEventId: event.id,
        outcome: 'ignored',
        reason: 'unsupported_event_type',
        metadata: {
          eventType: event.type,
        },
      });
    } else {
      await stripeWebhook.finalizeDedupe({
        eventType: event.type,
        accountId: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        outcome: 'ignored',
        reason: 'unsupported_event_type',
      });
    }
    return c.json({
      received: true,
      duplicate: false,
      ignored: true,
      eventId: event.id,
      eventType: event.type,
      reason: 'unsupported_event_type',
    });
  }

  async function processSubscriptionEvent(
    stripeWebhook: StripeWebhookProcessingHandle,
    c: StripeWebhookProcessorContext,
  ): Promise<StripeWebhookBillingProcessorResult> {
    const event = stripeWebhook.event;
    const sharedBillingLedger = stripeWebhook.sharedBillingLedger;
    const subscription = event.data.object as Stripe.Subscription;
    const stripeCustomerId = stripeReferenceId(subscription.customer);
    const stripeSubscriptionId = stripeReferenceId(subscription.id);
    const stripeSubscriptionStatus =
      typeof subscription.status === 'string'
        ? subscription.status
        : event.type === 'customer.subscription.deleted'
          ? 'canceled'
          : null;
    const stripePriceId = typeof subscription.items?.data?.[0]?.price?.id === 'string'
      ? subscription.items.data[0].price.id
      : null;
    const accountIdFromMetadata = metadataStringValue('attestorAccountId', subscription.metadata);

    let applied;
    try {
      applied = await applyStripeSubscriptionStateState({
        accountId: accountIdFromMetadata,
        stripeCustomerId,
        stripeSubscriptionId,
        stripeSubscriptionStatus,
        stripePriceId,
        eventId: event.id,
        eventType: event.type,
      });
    } catch (err) {
      try {
        await stripeWebhook.releaseClaim();
      } catch {
        // allow original failure to surface
      }
      const mapped = accountStoreErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }

    if (!applied.record) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await stripeWebhook.finalizeSharedEvent({
          providerEventId: event.id,
          outcome: 'ignored',
          reason: 'no_account_match',
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          billingStatusAfter: stripeSubscriptionStatus,
          metadata: {
            eventType: event.type,
          },
        });
      } else {
        await stripeWebhook.finalizeDedupe({
          eventType: event.type,
          accountId: null,
          stripeCustomerId,
          stripeSubscriptionId,
          outcome: 'ignored',
          reason: 'no_account_match',
        });
      }
      return c.json({
        received: true,
        duplicate: false,
        ignored: true,
        eventId: event.id,
        eventType: event.type,
        reason: 'no_account_match',
        stripeCustomerId,
        stripeSubscriptionId,
      });
    }

    const mappedPlan = findHostedPlanByStripePriceId(stripePriceId);
    if (mappedPlan) {
      const resolvedPlan = resolvePlanSpec({
        planId: mappedPlan.id,
        defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
      });
      await syncTenantPlanByTenantIdState(applied.record.primaryTenantId, {
        planId: resolvedPlan.planId,
        monthlyRunQuota: resolvedPlan.monthlyRunQuota,
      });
    }
    const entitlement = await syncHostedBillingEntitlement(applied.record, {
      lastEventId: event.id,
      lastEventType: event.type,
      lastEventAt: unixSecondsToIso(event.created) ?? new Date().toISOString(),
    });
    const revokedSessions = await revokeAccountSessionsForLifecycleChange({
      account: applied.record,
      previousStatus: applied.previousStatus,
      nextStatus: applied.nextStatus,
    });

    c.set('obs.accountId', applied.record.id);
    c.set('obs.accountStatus', applied.record.status);
    c.set('obs.tenantId', applied.record.primaryTenantId);
    c.set('obs.planId', mappedPlan?.id ?? null);

    if (sharedBillingLedger) {
      await stripeWebhook.finalizeSharedEvent({
        providerEventId: event.id,
        outcome: 'applied',
        accountId: applied.record.id,
        tenantId: applied.record.primaryTenantId,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        accountStatusBefore: applied.previousStatus,
        accountStatusAfter: applied.nextStatus,
        billingStatusBefore: applied.previousBillingStatus,
        billingStatusAfter: applied.nextBillingStatus,
        mappedPlanId: mappedPlan?.id ?? null,
        metadata: {
          eventType: event.type,
          matchReason: applied.matchReason,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
          revokedSessionCount: revokedSessions,
        },
      });
    } else {
      await stripeWebhook.finalizeDedupe({
        eventType: event.type,
        accountId: applied.record.id,
        stripeCustomerId,
        stripeSubscriptionId,
        outcome: 'applied',
        reason: null,
      });
    }

    observeBillingWebhookEvent(event.type, 'applied');

    await appendAdminAuditRecordState({
      actorType: 'stripe_webhook',
      actorLabel: 'stripe.webhooks',
      action: 'billing.stripe.webhook_applied',
      routeId: 'billing.stripe.webhook',
      accountId: applied.record.id,
      tenantId: applied.record.primaryTenantId,
      tenantKeyId: null,
      planId: mappedPlan?.id ?? null,
      monthlyRunQuota: null,
      idempotencyKey: event.id,
      requestHash: stripeWebhook.payloadHash,
      metadata: {
        eventType: event.type,
        matchReason: applied.matchReason,
        stripeCustomerId,
        stripeSubscriptionId,
        stripeSubscriptionStatus,
        stripePriceId,
        mappedPlanId: mappedPlan?.id ?? null,
        entitlementStatus: entitlement.status,
        entitlementAccessEnabled: entitlement.accessEnabled,
        effectivePlanId: entitlement.effectivePlanId,
        previousAccountStatus: applied.previousStatus,
        nextAccountStatus: applied.nextStatus,
        previousBillingStatus: applied.previousBillingStatus,
        nextBillingStatus: applied.nextBillingStatus,
        revokedSessionCount: revokedSessions,
        sharedLedger: sharedBillingLedger,
      },
    });

    return c.json({
      received: true,
      duplicate: false,
      eventId: event.id,
      eventType: event.type,
      accountId: applied.record.id,
      accountStatus: applied.record.status,
      mappedPlanId: mappedPlan?.id ?? null,
      billing: applied.record.billing,
    });
  }

  async function processCheckoutCompletedEvent(
    stripeWebhook: StripeWebhookProcessingHandle,
    c: StripeWebhookProcessorContext,
  ): Promise<StripeWebhookBillingProcessorResult> {
    const event = stripeWebhook.event;
    const sharedBillingLedger = stripeWebhook.sharedBillingLedger;
    const session = event.data.object as Stripe.Checkout.Session;
    const stripeCheckoutSessionId = stripeReferenceId(session.id);
    const stripeCustomerId = stripeReferenceId(session.customer);
    const stripeSubscriptionId = stripeReferenceId(session.subscription);
    const accountIdFromMetadata = metadataStringValue('attestorAccountId', session.metadata);
    const planIdFromMetadata = metadataStringValue('attestorPlanId', session.metadata);
    const mappedPlan = planIdFromMetadata
      ? getHostedPlan(planIdFromMetadata)
      : null;
    const stripePriceId = mappedPlan ? resolvePlanStripePrice(mappedPlan.id).priceId : null;
    const completedAt = unixSecondsToIso(session.created) ?? new Date().toISOString();

    let applied;
    try {
      applied = await applyStripeCheckoutCompletionState({
        accountId: accountIdFromMetadata,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        planId: mappedPlan?.id ?? planIdFromMetadata,
        checkoutSessionId: stripeCheckoutSessionId ?? `checkout_missing_${event.id}`,
        completedAt,
        eventId: event.id,
        eventType: event.type,
      });
    } catch (err) {
      try {
        await stripeWebhook.releaseClaim();
      } catch {
        // allow original failure to surface
      }
      const mapped = accountStoreErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }

    if (!applied.record) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await stripeWebhook.finalizeSharedEvent({
          providerEventId: event.id,
          outcome: 'ignored',
          reason: 'no_account_match',
          stripeCheckoutSessionId,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          mappedPlanId: mappedPlan?.id ?? planIdFromMetadata ?? null,
          metadata: {
            eventType: event.type,
            checkoutMode: session.mode ?? null,
          },
        });
      } else {
        await stripeWebhook.finalizeDedupe({
          eventType: event.type,
          accountId: null,
          stripeCustomerId,
          stripeSubscriptionId,
          outcome: 'ignored',
          reason: 'no_account_match',
        });
      }
      return c.json({
        received: true,
        duplicate: false,
        ignored: true,
        eventId: event.id,
        eventType: event.type,
        reason: 'no_account_match',
        stripeCustomerId,
        stripeSubscriptionId,
        checkoutSessionId: stripeCheckoutSessionId,
      });
    }

    if (mappedPlan) {
      const resolvedPlan = resolvePlanSpec({
        planId: mappedPlan.id,
        defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
      });
      await syncTenantPlanByTenantIdState(applied.record.primaryTenantId, {
        planId: resolvedPlan.planId,
        monthlyRunQuota: resolvedPlan.monthlyRunQuota,
      });
    }
    const entitlement = await syncHostedBillingEntitlement(applied.record, {
      lastEventId: event.id,
      lastEventType: event.type,
      lastEventAt: completedAt,
    });

    c.set('obs.accountId', applied.record.id);
    c.set('obs.accountStatus', applied.record.status);
    c.set('obs.tenantId', applied.record.primaryTenantId);
    c.set('obs.planId', mappedPlan?.id ?? planIdFromMetadata ?? null);

    if (sharedBillingLedger) {
      await stripeWebhook.finalizeSharedEvent({
        providerEventId: event.id,
        outcome: 'applied',
        accountId: applied.record.id,
        tenantId: applied.record.primaryTenantId,
        stripeCheckoutSessionId,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        accountStatusBefore: applied.previousStatus,
        accountStatusAfter: applied.nextStatus,
        billingStatusBefore: applied.previousBillingStatus,
        billingStatusAfter: applied.nextBillingStatus,
        mappedPlanId: mappedPlan?.id ?? planIdFromMetadata ?? null,
        metadata: {
          eventType: event.type,
          matchReason: applied.matchReason,
          completedAt,
          checkoutMode: session.mode ?? null,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
        },
      });
    } else {
      await stripeWebhook.finalizeDedupe({
        eventType: event.type,
        accountId: applied.record.id,
        stripeCustomerId,
        stripeSubscriptionId,
        outcome: 'applied',
        reason: null,
      });
    }

    observeBillingWebhookEvent(event.type, 'applied');

    await appendAdminAuditRecordState({
      actorType: 'stripe_webhook',
      actorLabel: 'stripe.webhooks',
      action: 'billing.stripe.webhook_applied',
      routeId: 'billing.stripe.webhook',
      accountId: applied.record.id,
      tenantId: applied.record.primaryTenantId,
      tenantKeyId: null,
      planId: mappedPlan?.id ?? planIdFromMetadata ?? null,
      monthlyRunQuota: null,
      idempotencyKey: event.id,
      requestHash: stripeWebhook.payloadHash,
      metadata: {
        eventType: event.type,
        matchReason: applied.matchReason,
        stripeCheckoutSessionId,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        completedAt,
        entitlementStatus: entitlement.status,
        entitlementAccessEnabled: entitlement.accessEnabled,
        effectivePlanId: entitlement.effectivePlanId,
        sharedLedger: sharedBillingLedger,
      },
    });

    return c.json({
      received: true,
      duplicate: false,
      eventId: event.id,
      eventType: event.type,
      accountId: applied.record.id,
      accountStatus: applied.record.status,
      mappedPlanId: mappedPlan?.id ?? planIdFromMetadata ?? null,
      billing: applied.record.billing,
    });
  }

  async function processChargeEvent(
    stripeWebhook: StripeWebhookProcessingHandle,
    c: StripeWebhookProcessorContext,
  ): Promise<StripeWebhookBillingProcessorResult> {
    const event = stripeWebhook.event;
    const sharedBillingLedger = stripeWebhook.sharedBillingLedger;
    const charge = event.data.object as Stripe.Charge;
    const stripeChargeId = stripeReferenceId(charge.id);
    const stripeCustomerId = stripeReferenceId(charge.customer);
    const stripeInvoiceId = stripeReferenceId((charge as { invoice?: unknown }).invoice);
    const accountIdFromMetadata = metadataStringValue('attestorAccountId', charge.metadata);
    const matched = await findHostedAccountByStripeRefs({
      accountId: accountIdFromMetadata,
      stripeCustomerId,
      stripeSubscriptionId: null,
    });
    const account = matched.record;
    const chargeCreatedAt = unixSecondsToIso(charge.created) ?? new Date().toISOString();

    if (sharedBillingLedger && stripeChargeId) {
      await upsertStripeCharges({
        accountId: account?.id ?? null,
        tenantId: account?.primaryTenantId ?? null,
        stripeCustomerId,
        stripeSubscriptionId: account?.billing.stripeSubscriptionId ?? null,
        charges: [{
          stripeChargeId,
          stripeInvoiceId,
          stripePaymentIntentId: stripeReferenceId(charge.payment_intent),
          amount: typeof charge.amount === 'number' ? charge.amount : null,
          amountRefunded: typeof charge.amount_refunded === 'number' ? charge.amount_refunded : null,
          currency: typeof charge.currency === 'string' ? charge.currency : null,
          status: parseStripeChargeStatus(charge.status),
          paid: typeof charge.paid === 'boolean' ? charge.paid : null,
          refunded: typeof charge.refunded === 'boolean' ? charge.refunded : null,
          failureCode: typeof charge.failure_code === 'string' ? charge.failure_code : null,
          failureMessage: typeof charge.failure_message === 'string' ? charge.failure_message : null,
          metadata: {
            eventType: event.type,
          },
          createdAt: chargeCreatedAt,
        }],
        source: 'stripe_webhook',
      });
    }

    if (!account) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await stripeWebhook.finalizeSharedEvent({
          providerEventId: event.id,
          outcome: 'ignored',
          reason: 'no_account_match',
          stripeCustomerId,
          stripeSubscriptionId: null,
          stripeInvoiceId,
          metadata: {
            eventType: event.type,
            stripeChargeId,
            chargeStatus: parseStripeChargeStatus(charge.status),
            chargeCreatedAt,
          },
        });
      } else {
        await stripeWebhook.finalizeDedupe({
          eventType: event.type,
          accountId: null,
          stripeCustomerId,
          stripeSubscriptionId: null,
          outcome: 'ignored',
          reason: 'no_account_match',
        });
      }
      return c.json({
        received: true,
        duplicate: false,
        ignored: true,
        eventId: event.id,
        eventType: event.type,
        reason: 'no_account_match',
        stripeCustomerId,
        stripeChargeId,
        invoiceId: stripeInvoiceId,
      });
    }

    const entitlement = await syncHostedBillingEntitlement(account, {
      lastEventId: event.id,
      lastEventType: event.type,
      lastEventAt: chargeCreatedAt,
    });

    c.set('obs.accountId', account.id);
    c.set('obs.accountStatus', account.status);
    c.set('obs.tenantId', account.primaryTenantId);
    c.set('obs.planId', account.billing.lastCheckoutPlanId ?? entitlement.effectivePlanId ?? null);

    if (sharedBillingLedger) {
      await stripeWebhook.finalizeSharedEvent({
        providerEventId: event.id,
        outcome: 'applied',
        accountId: account.id,
        tenantId: account.primaryTenantId,
        stripeCustomerId,
        stripeSubscriptionId: account.billing.stripeSubscriptionId,
        stripePriceId: account.billing.stripePriceId,
        stripeInvoiceId,
        metadata: {
          eventType: event.type,
          matchReason: matched.matchReason,
          stripeChargeId,
          chargeStatus: parseStripeChargeStatus(charge.status),
          chargeCreatedAt,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
        },
      });
    } else {
      await stripeWebhook.finalizeDedupe({
        eventType: event.type,
        accountId: account.id,
        stripeCustomerId,
        stripeSubscriptionId: account.billing.stripeSubscriptionId,
        outcome: 'applied',
        reason: null,
      });
    }

    observeBillingWebhookEvent(event.type, 'applied');

    await appendAdminAuditRecordState({
      actorType: 'stripe_webhook',
      actorLabel: 'stripe.webhooks',
      action: 'billing.stripe.webhook_applied',
      routeId: 'billing.stripe.webhook',
      accountId: account.id,
      tenantId: account.primaryTenantId,
      tenantKeyId: null,
      planId: account.billing.lastCheckoutPlanId ?? entitlement.effectivePlanId ?? null,
      monthlyRunQuota: null,
      idempotencyKey: event.id,
      requestHash: stripeWebhook.payloadHash,
      metadata: {
        eventType: event.type,
        matchReason: matched.matchReason,
        stripeChargeId,
        stripeCustomerId,
        stripeInvoiceId,
        chargeStatus: parseStripeChargeStatus(charge.status),
        chargeCreatedAt,
        entitlementStatus: entitlement.status,
        entitlementAccessEnabled: entitlement.accessEnabled,
        effectivePlanId: entitlement.effectivePlanId,
        sharedLedger: sharedBillingLedger,
      },
    });

    return c.json({
      received: true,
      duplicate: false,
      eventId: event.id,
      eventType: event.type,
      accountId: account.id,
      accountStatus: account.status,
      chargeId: stripeChargeId,
      invoiceId: stripeInvoiceId,
    });
  }

  async function processEntitlementSummaryEvent(
    stripeWebhook: StripeWebhookProcessingHandle,
    c: StripeWebhookProcessorContext,
  ): Promise<StripeWebhookBillingProcessorResult> {
    const event = stripeWebhook.event;
    const sharedBillingLedger = stripeWebhook.sharedBillingLedger;
    const summary = event.data.object as Stripe.Entitlements.ActiveEntitlementSummary;
    const stripeCustomerId = stripeReferenceId((summary as { customer?: unknown }).customer);
    const matched = await findHostedAccountByStripeRefs({
      accountId: null,
      stripeCustomerId,
      stripeSubscriptionId: null,
    });
    const account = matched.record;
    const summaryUpdatedAt = unixSecondsToIso(event.created) ?? new Date().toISOString();
    const canFetchCanonicalEntitlements = process.env.ATTESTOR_STRIPE_USE_MOCK !== 'true'
      && Boolean(process.env.STRIPE_API_KEY?.trim())
      && Boolean(stripeCustomerId);
    const summaryEntitlements = extractActiveEntitlementsFromSummary(summary);
    const canonicalEntitlements = canFetchCanonicalEntitlements && stripeCustomerId
      ? await listHostedStripeActiveEntitlements({
        customerId: stripeCustomerId,
        limit: 5_000,
      })
      : [];
    const entitlementRecords = canonicalEntitlements.length > 0 ? canonicalEntitlements : summaryEntitlements;
    const lookupKeys = [...new Set(entitlementRecords.map((record) => record.lookupKey).filter((value) => value.trim() !== ''))].sort();
    const featureIds = [...new Set(entitlementRecords.map((record) => record.featureId ?? '').filter((value) => value.trim() !== ''))].sort();

    if (!account) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await stripeWebhook.finalizeSharedEvent({
          providerEventId: event.id,
          outcome: 'ignored',
          reason: 'no_account_match',
          stripeCustomerId,
          stripeSubscriptionId: null,
          metadata: {
            eventType: event.type,
            entitlementLookupKeyCount: lookupKeys.length,
            entitlementFeatureIdCount: featureIds.length,
            entitlementSummaryUpdatedAt: summaryUpdatedAt,
          },
        });
      } else {
        await stripeWebhook.finalizeDedupe({
          eventType: event.type,
          accountId: null,
          stripeCustomerId,
          stripeSubscriptionId: null,
          outcome: 'ignored',
          reason: 'no_account_match',
        });
      }
      return c.json({
        received: true,
        duplicate: false,
        ignored: true,
        eventId: event.id,
        eventType: event.type,
        reason: 'no_account_match',
        stripeCustomerId,
      });
    }

    const entitlement = await syncHostedBillingEntitlement(account, {
      lastEventId: event.id,
      lastEventType: event.type,
      lastEventAt: summaryUpdatedAt,
      stripeEntitlementLookupKeys: lookupKeys,
      stripeEntitlementFeatureIds: featureIds,
      stripeEntitlementSummaryUpdatedAt: summaryUpdatedAt,
    });

    c.set('obs.accountId', account.id);
    c.set('obs.accountStatus', account.status);
    c.set('obs.tenantId', account.primaryTenantId);
    c.set('obs.planId', account.billing.lastCheckoutPlanId ?? entitlement.effectivePlanId ?? null);

    if (sharedBillingLedger) {
      await stripeWebhook.finalizeSharedEvent({
        providerEventId: event.id,
        outcome: 'applied',
        accountId: account.id,
        tenantId: account.primaryTenantId,
        stripeCustomerId,
        stripeSubscriptionId: account.billing.stripeSubscriptionId,
        stripePriceId: account.billing.stripePriceId,
        metadata: {
          eventType: event.type,
          matchReason: matched.matchReason,
          entitlementLookupKeys: lookupKeys,
          entitlementFeatureIds: featureIds,
          entitlementSummaryUpdatedAt: summaryUpdatedAt,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
        },
      });
    } else {
      await stripeWebhook.finalizeDedupe({
        eventType: event.type,
        accountId: account.id,
        stripeCustomerId,
        stripeSubscriptionId: account.billing.stripeSubscriptionId,
        outcome: 'applied',
        reason: null,
      });
    }

    observeBillingWebhookEvent(event.type, 'applied');

    await appendAdminAuditRecordState({
      actorType: 'stripe_webhook',
      actorLabel: 'stripe.webhooks',
      action: 'billing.stripe.webhook_applied',
      routeId: 'billing.stripe.webhook',
      accountId: account.id,
      tenantId: account.primaryTenantId,
      tenantKeyId: null,
      planId: account.billing.lastCheckoutPlanId ?? entitlement.effectivePlanId ?? null,
      monthlyRunQuota: null,
      idempotencyKey: event.id,
      requestHash: stripeWebhook.payloadHash,
      metadata: {
        eventType: event.type,
        matchReason: matched.matchReason,
        stripeCustomerId,
        entitlementLookupKeys: lookupKeys,
        entitlementFeatureIds: featureIds,
        entitlementSummaryUpdatedAt: summaryUpdatedAt,
        entitlementStatus: entitlement.status,
        entitlementAccessEnabled: entitlement.accessEnabled,
        effectivePlanId: entitlement.effectivePlanId,
        sharedLedger: sharedBillingLedger,
      },
    });

    return c.json({
      received: true,
      duplicate: false,
      eventId: event.id,
      eventType: event.type,
      accountId: account.id,
      accountStatus: account.status,
      entitlement: billingEntitlementView(entitlement),
    });
  }

  async function processInvoiceEvent(
    stripeWebhook: StripeWebhookProcessingHandle,
    c: StripeWebhookProcessorContext,
  ): Promise<StripeWebhookBillingProcessorResult> {
    const event = stripeWebhook.event;
    const sharedBillingLedger = stripeWebhook.sharedBillingLedger;
    const invoice = event.data.object as StripeInvoiceWebhookObject;
    const stripeCustomerId = stripeReferenceId(invoice.customer);
    const stripeSubscriptionId = stripeReferenceId(invoice.subscription);
    const stripePriceId = stripeInvoicePriceId(invoice);
    const stripeInvoiceId = stripeReferenceId(invoice.id);
    const stripeInvoiceStatus = parseStripeInvoiceStatus(
      typeof invoice.status === 'string'
        ? invoice.status
        : event.type === 'invoice.paid'
          ? 'paid'
          : null,
    );
    const stripeInvoiceCurrency = typeof invoice.currency === 'string' ? invoice.currency : null;
    const accountIdFromMetadata = metadataStringValue(
      'attestorAccountId',
      invoice.metadata,
      invoice.subscription_details?.metadata ?? null,
    );
    const extractedInvoiceLineItems = extractInvoiceLineItemSnapshotsFromInvoice(invoice);

    let applied;
    try {
      applied = await applyStripeInvoiceStateState({
        accountId: accountIdFromMetadata,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        invoiceId: stripeInvoiceId ?? `invoice_missing_${event.id}`,
        invoiceStatus: stripeInvoiceStatus,
        currency: stripeInvoiceCurrency,
        amountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
        amountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
        paidAt: unixSecondsToIso((invoice.status_transitions as { paid_at?: unknown } | null | undefined)?.paid_at),
        paymentFailedAt: event.type === 'invoice.payment_failed'
          ? (unixSecondsToIso(event.created) ?? new Date().toISOString())
          : null,
        eventId: event.id,
        eventType: event.type,
      });
    } catch (err) {
      try {
        await stripeWebhook.releaseClaim();
      } catch {
        // allow original failure to surface
      }
      const mapped = accountStoreErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }

    if (!applied.record) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await stripeWebhook.finalizeSharedEvent({
          providerEventId: event.id,
          outcome: 'ignored',
          reason: 'no_account_match',
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          stripeInvoiceId,
          stripeInvoiceStatus,
          stripeInvoiceCurrency,
          stripeInvoiceAmountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
          stripeInvoiceAmountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
          metadata: {
            eventType: event.type,
            billingReason: invoice.billing_reason ?? null,
          },
        });
      } else {
        await stripeWebhook.finalizeDedupe({
          eventType: event.type,
          accountId: null,
          stripeCustomerId,
          stripeSubscriptionId,
          outcome: 'ignored',
          reason: 'no_account_match',
        });
      }
      return c.json({
        received: true,
        duplicate: false,
        ignored: true,
        eventId: event.id,
        eventType: event.type,
        reason: 'no_account_match',
        stripeCustomerId,
        stripeSubscriptionId,
        invoiceId: stripeInvoiceId,
      });
    }

    const mappedPlan = findHostedPlanByStripePriceId(stripePriceId);
    if (mappedPlan) {
      const resolvedPlan = resolvePlanSpec({
        planId: mappedPlan.id,
        defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
      });
      await syncTenantPlanByTenantIdState(applied.record.primaryTenantId, {
        planId: resolvedPlan.planId,
        monthlyRunQuota: resolvedPlan.monthlyRunQuota,
      });
    }

    let persistedInvoiceLineItemCount = 0;
    let persistedInvoiceLineItemCaptureMode: 'full' | 'partial' | null = null;
    if (sharedBillingLedger && stripeInvoiceId) {
      let lineItemsToPersist: BillingEventLedger.BillingInvoiceLineItemInput[] = extractedInvoiceLineItems.lineItems.map((lineItem) => ({
        stripeInvoiceLineItemId: lineItem.lineItemId,
        stripePriceId: lineItem.priceId,
        description: lineItem.description,
        currency: lineItem.currency,
        amount: lineItem.amount,
        subtotal: lineItem.subtotal,
        quantity: lineItem.quantity,
        periodStart: lineItem.periodStart,
        periodEnd: lineItem.periodEnd,
        proration: lineItem.proration,
        metadata: {},
      }));
      let captureMode: BillingEventLedger.BillingInvoiceLineItemCaptureMode = extractedInvoiceLineItems.hasMore ? 'partial' : 'full';
      let source: BillingEventLedger.BillingInvoiceLineItemSource = 'stripe_webhook';
      const canFetchCanonicalLineItems = process.env.ATTESTOR_STRIPE_USE_MOCK !== 'true'
        && Boolean(process.env.STRIPE_API_KEY?.trim());
      if (canFetchCanonicalLineItems) {
        const canonicalLineItems = await listHostedStripeInvoiceLineItems({ invoiceId: stripeInvoiceId, limit: 5_000 });
        if (canonicalLineItems.length > 0) {
          lineItemsToPersist = canonicalLineItems.map((lineItem) => ({
            stripeInvoiceLineItemId: lineItem.lineItemId,
            stripePriceId: lineItem.priceId,
            description: lineItem.description,
            currency: lineItem.currency,
            amount: lineItem.amount,
            subtotal: lineItem.subtotal,
            quantity: lineItem.quantity,
            periodStart: lineItem.periodStart,
            periodEnd: lineItem.periodEnd,
            proration: lineItem.proration,
            metadata: {},
          }));
          captureMode = 'full';
          source = 'stripe_live_fetch';
        }
      }
      if (lineItemsToPersist.length > 0) {
        const persistedLineItems = await upsertStripeInvoiceLineItems({
          accountId: applied.record.id,
          tenantId: applied.record.primaryTenantId,
          stripeCustomerId,
          stripeSubscriptionId,
          stripeInvoiceId,
          lineItems: lineItemsToPersist,
          source,
          captureMode,
          replaceExisting: captureMode === 'full',
        });
        persistedInvoiceLineItemCount = persistedLineItems.recordCount;
        persistedInvoiceLineItemCaptureMode = captureMode;
      }
    }

    const entitlement = await syncHostedBillingEntitlement(applied.record, {
      lastEventId: event.id,
      lastEventType: event.type,
      lastEventAt: unixSecondsToIso(event.created) ?? new Date().toISOString(),
    });
    const revokedSessions = await revokeAccountSessionsForLifecycleChange({
      account: applied.record,
      previousStatus: applied.previousStatus,
      nextStatus: applied.nextStatus,
    });

    c.set('obs.accountId', applied.record.id);
    c.set('obs.accountStatus', applied.record.status);
    c.set('obs.tenantId', applied.record.primaryTenantId);
    c.set('obs.planId', mappedPlan?.id ?? null);

    if (sharedBillingLedger) {
      await stripeWebhook.finalizeSharedEvent({
        providerEventId: event.id,
        outcome: 'applied',
        accountId: applied.record.id,
        tenantId: applied.record.primaryTenantId,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        stripeInvoiceId,
        stripeInvoiceStatus,
        stripeInvoiceCurrency,
        stripeInvoiceAmountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
        stripeInvoiceAmountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
        accountStatusBefore: applied.previousStatus,
        accountStatusAfter: applied.nextStatus,
        billingStatusBefore: applied.previousBillingStatus,
        billingStatusAfter: applied.nextBillingStatus,
        mappedPlanId: mappedPlan?.id ?? null,
        metadata: {
          eventType: event.type,
          matchReason: applied.matchReason,
          billingReason: invoice.billing_reason ?? null,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
          revokedSessionCount: revokedSessions,
          invoiceLineItemCount: persistedInvoiceLineItemCount,
          invoiceLineItemCaptureMode: persistedInvoiceLineItemCaptureMode,
        },
      });
    } else {
      await stripeWebhook.finalizeDedupe({
        eventType: event.type,
        accountId: applied.record.id,
        stripeCustomerId,
        stripeSubscriptionId,
        outcome: 'applied',
        reason: null,
      });
    }

    observeBillingWebhookEvent(event.type, 'applied');

    await appendAdminAuditRecordState({
      actorType: 'stripe_webhook',
      actorLabel: 'stripe.webhooks',
      action: 'billing.stripe.webhook_applied',
      routeId: 'billing.stripe.webhook',
      accountId: applied.record.id,
      tenantId: applied.record.primaryTenantId,
      tenantKeyId: null,
      planId: mappedPlan?.id ?? null,
      monthlyRunQuota: null,
      idempotencyKey: event.id,
      requestHash: stripeWebhook.payloadHash,
      metadata: {
        eventType: event.type,
        matchReason: applied.matchReason,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        stripeInvoiceId,
        stripeInvoiceStatus,
        stripeInvoiceCurrency,
        invoiceAmountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
        invoiceAmountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
        billingReason: invoice.billing_reason ?? null,
        entitlementStatus: entitlement.status,
        entitlementAccessEnabled: entitlement.accessEnabled,
        effectivePlanId: entitlement.effectivePlanId,
        previousAccountStatus: applied.previousStatus,
        nextAccountStatus: applied.nextStatus,
        previousBillingStatus: applied.previousBillingStatus,
        nextBillingStatus: applied.nextBillingStatus,
        revokedSessionCount: revokedSessions,
        sharedLedger: sharedBillingLedger,
        invoiceLineItemCount: persistedInvoiceLineItemCount,
        invoiceLineItemCaptureMode: persistedInvoiceLineItemCaptureMode,
      },
    });

    return c.json({
      received: true,
      duplicate: false,
      eventId: event.id,
      eventType: event.type,
      accountId: applied.record.id,
      accountStatus: applied.record.status,
      mappedPlanId: mappedPlan?.id ?? null,
      billing: applied.record.billing,
    });
  }

  return {
    async process(stripeWebhook) {
      const c = createProcessorContext();
      const event = stripeWebhook.event;
      try {
        if (!isSupportedStripeWebhookEvent(event.type)) {
          return processUnsupportedEvent(stripeWebhook, c);
        }

        if (event.type.startsWith('customer.subscription.')) {
          return processSubscriptionEvent(stripeWebhook, c);
        }

        if (event.type === 'checkout.session.completed') {
          return processCheckoutCompletedEvent(stripeWebhook, c);
        }

        if (isStripeChargeEvent(event.type)) {
          return processChargeEvent(stripeWebhook, c);
        }

        if (event.type === 'entitlements.active_entitlement_summary.updated') {
          return processEntitlementSummaryEvent(stripeWebhook, c);
        }

        return processInvoiceEvent(stripeWebhook, c);
      } catch (err) {
        try {
          await stripeWebhook.releaseClaim();
        } catch {
          // allow original failure to surface
        }
        throw err;
      }
    },
  };
}
