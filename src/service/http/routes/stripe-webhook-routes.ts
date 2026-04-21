import type { Hono } from 'hono';
import Stripe from 'stripe';

type RouteDependency = any;

export interface StripeWebhookRouteDeps {
  stripeClient: RouteDependency;
  observeBillingWebhookEvent: RouteDependency;
  isBillingEventLedgerConfigured: RouteDependency;
  isSharedControlPlaneConfigured: RouteDependency;
  claimStripeBillingEvent: RouteDependency;
  claimProcessedStripeWebhookState: RouteDependency;
  lookupProcessedStripeWebhookState: RouteDependency;
  finalizeProcessedStripeWebhookState: RouteDependency;
  recordProcessedStripeWebhookState: RouteDependency;
  releaseProcessedStripeWebhookClaimState: RouteDependency;
  finalizeStripeBillingEvent: RouteDependency;
  releaseStripeBillingEventClaim: RouteDependency;
  isSupportedStripeWebhookEvent: RouteDependency;
  stripeReferenceId: RouteDependency;
  parseStripeInvoiceStatus: RouteDependency;
  stripeInvoicePriceId: RouteDependency;
  metadataStringValue: RouteDependency;
  accountStoreErrorResponse: RouteDependency;
  applyStripeSubscriptionStateState: RouteDependency;
  applyStripeInvoiceStateState: RouteDependency;
  applyStripeCheckoutCompletionState: RouteDependency;
  attachStripeBillingToAccountState: RouteDependency;
  findHostedAccountByStripeRefs: RouteDependency;
  findHostedPlanByStripePriceId: RouteDependency;
  resolvePlanSpec: RouteDependency;
  DEFAULT_HOSTED_PLAN_ID: RouteDependency;
  syncTenantPlanByTenantIdState: RouteDependency;
  syncHostedBillingEntitlement: RouteDependency;
  revokeAccountSessionsForLifecycleChange: RouteDependency;
  appendAdminAuditRecordState: RouteDependency;
  billingEntitlementView: RouteDependency;
  extractInvoiceLineItemSnapshotsFromInvoice: RouteDependency;
  listHostedStripeActiveEntitlements: RouteDependency;
  extractActiveEntitlementsFromSummary: RouteDependency;
  listHostedStripeInvoiceLineItems: RouteDependency;
  upsertStripeInvoiceLineItems: RouteDependency;
  parseStripeChargeStatus: RouteDependency;
  getHostedPlan: RouteDependency;
  upsertStripeCharges: RouteDependency;
  unixSecondsToIso: RouteDependency;
  resolvePlanStripePrice: RouteDependency;
}

export function registerStripeWebhookRoutes(app: Hono, deps: StripeWebhookRouteDeps): void {
  const {
    stripeClient,
    observeBillingWebhookEvent,
    isBillingEventLedgerConfigured,
    isSharedControlPlaneConfigured,
    claimStripeBillingEvent,
    claimProcessedStripeWebhookState,
    lookupProcessedStripeWebhookState,
    finalizeProcessedStripeWebhookState,
    recordProcessedStripeWebhookState,
    releaseProcessedStripeWebhookClaimState,
    finalizeStripeBillingEvent,
    releaseStripeBillingEventClaim,
    isSupportedStripeWebhookEvent,
    stripeReferenceId,
    parseStripeInvoiceStatus,
    stripeInvoicePriceId,
    metadataStringValue,
    accountStoreErrorResponse,
    applyStripeSubscriptionStateState,
    applyStripeInvoiceStateState,
    applyStripeCheckoutCompletionState,
    attachStripeBillingToAccountState,
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

app.post('/api/v1/billing/stripe/webhook', async (c) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return c.json({
      error: 'Stripe webhook disabled. Set STRIPE_WEBHOOK_SECRET to enable billing reconciliation.',
    }, 503);
  }

  const signature = c.req.header('stripe-signature')?.trim() ?? '';
  if (!signature) {
    return c.json({ error: 'Stripe-Signature header is required.' }, 400);
  }

  const rawPayload = await c.req.text();
  let event: any;
  try {
    event = stripeClient().webhooks.constructEvent(rawPayload, signature, webhookSecret);
  } catch (err) {
    observeBillingWebhookEvent('signature_verification', 'signature_invalid');
    return c.json({
      error: 'Stripe webhook signature verification failed.',
      detail: err instanceof Error ? err.message : String(err),
    }, 400);
  }

  c.header('x-attestor-stripe-event-id', event.id);
  const sharedBillingLedger = isBillingEventLedgerConfigured();
  const sharedControlPlaneWebhookState = !sharedBillingLedger && isSharedControlPlaneConfigured();
  const dedupe = sharedBillingLedger
    ? await claimStripeBillingEvent({
      providerEventId: event.id,
      eventType: event.type,
      rawPayload,
    })
    : sharedControlPlaneWebhookState
      ? await claimProcessedStripeWebhookState({
        eventId: event.id,
        eventType: event.type,
        rawPayload,
      })
    : await lookupProcessedStripeWebhookState(event.id, rawPayload);
  const controlPlaneClaimId = dedupe.kind === 'claimed' && 'claimId' in dedupe ? dedupe.claimId : null;
  if (dedupe.kind === 'conflict') {
    observeBillingWebhookEvent(event.type, 'conflict');
    return c.json({
      error: `Stripe event '${event.id}' was already recorded with a different payload hash.`,
      eventType: dedupe.record.eventType,
      recordedAt: dedupe.record.receivedAt,
    }, 409);
  }
  if (dedupe.kind === 'duplicate') {
    observeBillingWebhookEvent(dedupe.record.eventType, 'duplicate');
    c.header('x-attestor-stripe-replay', 'true');
    return c.json({
      received: true,
      duplicate: true,
      eventId: event.id,
      eventType: dedupe.record.eventType,
      outcome: dedupe.record.outcome,
      accountId: dedupe.record.accountId,
      reason: dedupe.record.reason,
    });
  }

  let finalizedSharedEvent = false;
  let finalizedControlPlaneEvent = false;
  const finalizeWebhookDedupe = async (input: {
    eventType: string;
    accountId: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    outcome: 'applied' | 'ignored';
    reason: string | null;
  }): Promise<void> => {
    if (sharedBillingLedger) return;
    if (sharedControlPlaneWebhookState && controlPlaneClaimId) {
      await finalizeProcessedStripeWebhookState({
        claimId: controlPlaneClaimId,
        eventId: event.id,
        eventType: input.eventType,
        accountId: input.accountId,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        outcome: input.outcome,
        reason: input.reason,
        rawPayload,
      });
      finalizedControlPlaneEvent = true;
      return;
    }
    await recordProcessedStripeWebhookState({
      eventId: event.id,
      eventType: input.eventType,
      accountId: input.accountId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      outcome: input.outcome,
      reason: input.reason,
      rawPayload,
    });
  };
  try {
    if (!isSupportedStripeWebhookEvent(event.type)) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await finalizeStripeBillingEvent({
          providerEventId: event.id,
          outcome: 'ignored',
          reason: 'unsupported_event_type',
          metadata: {
            eventType: event.type,
          },
        });
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
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

    if (event.type.startsWith('customer.subscription.')) {
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
        if (sharedBillingLedger && !finalizedSharedEvent) {
          try {
            await releaseStripeBillingEventClaim(event.id);
          } catch {
            // allow original error mapping to surface
          }
        } else if (sharedControlPlaneWebhookState && controlPlaneClaimId && !finalizedControlPlaneEvent) {
          try {
            await releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
          } catch {
            // allow original error mapping to surface
          }
        }
        const mapped = accountStoreErrorResponse(c, err);
        if (mapped) return mapped;
        throw err;
      }

      if (!applied.record) {
        observeBillingWebhookEvent(event.type, 'ignored');
        if (sharedBillingLedger) {
          await finalizeStripeBillingEvent({
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
          finalizedSharedEvent = true;
        } else {
          await finalizeWebhookDedupe({
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
        await finalizeStripeBillingEvent({
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
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
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
        requestHash: dedupe.payloadHash,
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

    if (event.type === 'checkout.session.completed') {
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
        if (sharedBillingLedger && !finalizedSharedEvent) {
          try {
            await releaseStripeBillingEventClaim(event.id);
          } catch {
            // allow original error mapping to surface
          }
        } else if (sharedControlPlaneWebhookState && controlPlaneClaimId && !finalizedControlPlaneEvent) {
          try {
            await releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
          } catch {
            // allow original error mapping to surface
          }
        }
        const mapped = accountStoreErrorResponse(c, err);
        if (mapped) return mapped;
        throw err;
      }

      if (!applied.record) {
        observeBillingWebhookEvent(event.type, 'ignored');
        if (sharedBillingLedger) {
          await finalizeStripeBillingEvent({
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
          finalizedSharedEvent = true;
        } else {
          await finalizeWebhookDedupe({
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
        await finalizeStripeBillingEvent({
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
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
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
        requestHash: dedupe.payloadHash,
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

    if (event.type === 'charge.succeeded' || event.type === 'charge.failed' || event.type === 'charge.refunded') {
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
          await finalizeStripeBillingEvent({
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
          finalizedSharedEvent = true;
        } else {
          await finalizeWebhookDedupe({
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
        await finalizeStripeBillingEvent({
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
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
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
        requestHash: dedupe.payloadHash,
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

    if (event.type === 'entitlements.active_entitlement_summary.updated') {
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
      const lookupKeys = [...new Set(entitlementRecords.map((record: any) => record.lookupKey).filter((value: string) => value.trim() !== ''))].sort();
      const featureIds = [...new Set(entitlementRecords.map((record: any) => record.featureId ?? '').filter((value: string) => value.trim() !== ''))].sort();

      if (!account) {
        observeBillingWebhookEvent(event.type, 'ignored');
        if (sharedBillingLedger) {
          await finalizeStripeBillingEvent({
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
          finalizedSharedEvent = true;
        } else {
          await finalizeWebhookDedupe({
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
        await finalizeStripeBillingEvent({
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
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
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
        requestHash: dedupe.payloadHash,
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

    const invoice: any = event.data.object;
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
      if (sharedBillingLedger && !finalizedSharedEvent) {
        try {
          await releaseStripeBillingEventClaim(event.id);
        } catch {
          // allow original error mapping to surface
        }
      } else if (sharedControlPlaneWebhookState && controlPlaneClaimId && !finalizedControlPlaneEvent) {
        try {
          await releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
        } catch {
          // allow original error mapping to surface
        }
      }
      const mapped = accountStoreErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }

    if (!applied.record) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await finalizeStripeBillingEvent({
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
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
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
      let lineItemsToPersist = extractedInvoiceLineItems.lineItems.map((lineItem: any) => ({
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
      let captureMode: 'full' | 'partial' = extractedInvoiceLineItems.hasMore ? 'partial' : 'full';
      let source: 'stripe_webhook' | 'stripe_live_fetch' = 'stripe_webhook';
      const canFetchCanonicalLineItems = process.env.ATTESTOR_STRIPE_USE_MOCK !== 'true'
        && Boolean(process.env.STRIPE_API_KEY?.trim());
      if (canFetchCanonicalLineItems) {
        const canonicalLineItems = await listHostedStripeInvoiceLineItems({ invoiceId: stripeInvoiceId, limit: 5_000 });
        if (canonicalLineItems.length > 0) {
          lineItemsToPersist = canonicalLineItems.map((lineItem: any) => ({
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
      await finalizeStripeBillingEvent({
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
      finalizedSharedEvent = true;
    } else {
      await finalizeWebhookDedupe({
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
      requestHash: dedupe.payloadHash,
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
  } catch (err) {
    if (sharedBillingLedger && !finalizedSharedEvent) {
      try {
        await releaseStripeBillingEventClaim(event.id);
      } catch {
        // allow original failure to surface
      }
    } else if (sharedControlPlaneWebhookState && controlPlaneClaimId && !finalizedControlPlaneEvent) {
      try {
        await releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
      } catch {
        // allow original failure to surface
      }
    }
    throw err;
  }
});
}
