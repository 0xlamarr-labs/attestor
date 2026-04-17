import type { Hono } from 'hono';
import Stripe from 'stripe';

type RouteDeps = Record<string, any>;

export function registerWebhookRoutes(app: Hono, deps: RouteDeps): void {
  const {
    getSendGridWebhookStatus,
    verifySignedSendGridWebhook,
    parseSendGridWebhookEvents,
    listHostedEmailDeliveriesState,
    recordHostedEmailProviderEventState,
    sendGridEventTypeToStatusHint,
    getMailgunWebhookStatus,
    parseMailgunWebhookEvent,
    verifySignedMailgunWebhook,
    mailgunEventTypeToStatusHint,
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

app.post('/api/v1/email/sendgrid/webhook', async (c) => {
  const webhookStatus = getSendGridWebhookStatus();
  if (!webhookStatus.configured) {
    return c.json({
      error: 'SendGrid event webhook disabled. Set ATTESTOR_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY to enable delivery analytics.',
    }, 503);
  }

  const signature = c.req.header('x-twilio-email-event-webhook-signature')?.trim() ?? '';
  const timestamp = c.req.header('x-twilio-email-event-webhook-timestamp')?.trim() ?? '';
  if (!signature || !timestamp) {
    return c.json({
      error: 'Signed SendGrid webhook requires X-Twilio-Email-Event-Webhook-Signature and X-Twilio-Email-Event-Webhook-Timestamp.',
    }, 400);
  }

  const rawPayload = await c.req.text();
  if (!verifySignedSendGridWebhook({ rawPayload, signature, timestamp })) {
    return c.json({ error: 'SendGrid webhook signature verification failed.' }, 400);
  }

  let events;
  try {
    events = parseSendGridWebhookEvents(rawPayload);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  let applied = 0;
  let duplicate = 0;
  let ignored = 0;
  let conflict = 0;

  for (const event of events) {
    if (!event.deliveryId || !event.email) {
      ignored += 1;
      continue;
    }
    const existing = await listHostedEmailDeliveriesState({
      deliveryId: event.deliveryId,
      limit: 1,
    });
    const delivery = existing.records[0] ?? null;
    const result = await recordHostedEmailProviderEventState({
      deliveryId: event.deliveryId,
      accountId: delivery?.accountId ?? null,
      accountUserId: delivery?.accountUserId ?? null,
      purpose: event.purpose ?? delivery?.purpose ?? null,
      provider: 'sendgrid_smtp',
      channel: 'smtp',
      recipient: event.email,
      messageId: delivery?.messageId ?? null,
      providerMessageId: event.sgMessageId ?? delivery?.providerMessageId ?? null,
      providerEventId: event.sgEventId,
      eventType: `sendgrid.${event.event}`,
      statusHint: sendGridEventTypeToStatusHint(event.event),
      actionUrl: delivery?.actionUrl ?? null,
      tokenReturned: delivery?.tokenReturned ?? false,
      occurredAt: event.timestamp
        ? new Date(event.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      metadata: event.raw,
      rawPayload: event.raw,
    });
    if (result.kind === 'recorded') applied += 1;
    else if (result.kind === 'duplicate') duplicate += 1;
    else conflict += 1;
  }

  return c.json({
    received: true,
    provider: 'sendgrid_smtp',
    eventCount: events.length,
    applied,
    duplicate,
    ignored,
    conflict,
  });
});

app.post('/api/v1/email/mailgun/webhook', async (c) => {
  const webhookStatus = getMailgunWebhookStatus();
  if (!webhookStatus.configured) {
    return c.json({
      error: 'Mailgun event webhook disabled. Set ATTESTOR_MAILGUN_WEBHOOK_SIGNING_KEY to enable delivery analytics.',
    }, 503);
  }

  const rawPayload = await c.req.text();
  let parsed;
  try {
    parsed = parseMailgunWebhookEvent(rawPayload);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  if (!verifySignedMailgunWebhook(parsed.signature)) {
    return c.json({ error: 'Mailgun webhook signature verification failed.' }, 400);
  }

  const event = parsed.event;
  let applied = 0;
  let duplicate = 0;
  let ignored = 0;
  let conflict = 0;

  if (!event.deliveryId || !event.email) {
    ignored += 1;
  } else {
    const existing = await listHostedEmailDeliveriesState({
      deliveryId: event.deliveryId,
      limit: 1,
    });
    const delivery = existing.records[0] ?? null;
    const result = await recordHostedEmailProviderEventState({
      deliveryId: event.deliveryId,
      accountId: delivery?.accountId ?? null,
      accountUserId: delivery?.accountUserId ?? null,
      purpose: event.purpose ?? delivery?.purpose ?? null,
      provider: 'mailgun_smtp',
      channel: 'smtp',
      recipient: event.email,
      messageId: delivery?.messageId ?? null,
      providerMessageId: event.messageId ?? delivery?.providerMessageId ?? null,
      providerEventId: event.eventId,
      eventType: `mailgun.${event.event}`,
      statusHint: mailgunEventTypeToStatusHint(event.event, event.severity),
      actionUrl: delivery?.actionUrl ?? null,
      tokenReturned: delivery?.tokenReturned ?? false,
      occurredAt: event.timestamp
        ? new Date(event.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      metadata: {
        ...event.raw,
        severity: event.severity ?? null,
      },
      rawPayload: event.raw,
    });
    if (result.kind === 'recorded') applied += 1;
    else if (result.kind === 'duplicate') duplicate += 1;
    else conflict += 1;
  }

  return c.json({
    received: true,
    provider: 'mailgun_smtp',
    eventCount: 1,
    applied,
    duplicate,
    ignored,
    conflict,
  });
});

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
