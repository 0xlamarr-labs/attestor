import Stripe from 'stripe';
import type * as BillingEventLedger from '../billing-event-ledger.js';
import type * as ControlPlaneStore from '../control-plane-store.js';

export type BillingWebhookMetricOutcome =
  | 'applied'
  | 'ignored'
  | 'duplicate'
  | 'conflict'
  | 'signature_invalid';

export interface StripeWebhookDedupeFinalizationInput {
  eventType: string;
  accountId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  outcome: 'applied' | 'ignored';
  reason: string | null;
}

export type StripeWebhookSharedFinalizationInput =
  Parameters<typeof BillingEventLedger.finalizeStripeBillingEvent>[0];

export interface StripeWebhookProcessingHandle {
  event: Stripe.Event;
  rawPayload: string;
  payloadHash: string;
  sharedBillingLedger: boolean;
  sharedControlPlaneWebhookState: boolean;
  controlPlaneClaimId: string | null;
  finalizedSharedEvent: boolean;
  finalizedControlPlaneEvent: boolean;
  finalizeSharedEvent(input: StripeWebhookSharedFinalizationInput): Promise<void>;
  finalizeDedupe(input: StripeWebhookDedupeFinalizationInput): Promise<void>;
  releaseClaim(): Promise<void>;
}

export type StripeWebhookBeginResult =
  | {
      kind: 'ready';
      webhook: StripeWebhookProcessingHandle;
    }
  | {
      kind: 'rejected';
      statusCode: 200 | 400 | 409 | 503;
      responseBody: Record<string, unknown>;
      headers?: Record<string, string>;
    };

export interface StripeWebhookBeginInput {
  webhookSecret: string | null | undefined;
  signature: string | null | undefined;
  rawPayload: string;
}

export interface StripeWebhookService {
  begin(input: StripeWebhookBeginInput): Promise<StripeWebhookBeginResult>;
}

export interface StripeWebhookServiceDeps {
  stripeClient(): Stripe;
  observeBillingWebhookEvent(eventType: string, outcome: BillingWebhookMetricOutcome): void;
  isBillingEventLedgerConfigured(): boolean;
  isSharedControlPlaneConfigured(): boolean;
  claimStripeBillingEvent: typeof BillingEventLedger.claimStripeBillingEvent;
  claimProcessedStripeWebhookState: typeof ControlPlaneStore.claimProcessedStripeWebhookState;
  lookupProcessedStripeWebhookState: typeof ControlPlaneStore.lookupProcessedStripeWebhookState;
  finalizeProcessedStripeWebhookState: typeof ControlPlaneStore.finalizeProcessedStripeWebhookState;
  recordProcessedStripeWebhookState: typeof ControlPlaneStore.recordProcessedStripeWebhookState;
  releaseProcessedStripeWebhookClaimState: typeof ControlPlaneStore.releaseProcessedStripeWebhookClaimState;
  finalizeStripeBillingEvent: typeof BillingEventLedger.finalizeStripeBillingEvent;
  releaseStripeBillingEventClaim: typeof BillingEventLedger.releaseStripeBillingEventClaim;
}

export function createStripeWebhookService(deps: StripeWebhookServiceDeps): StripeWebhookService {
  return {
    async begin(input) {
      const webhookSecret = input.webhookSecret?.trim();
      if (!webhookSecret) {
        return {
          kind: 'rejected',
          statusCode: 503,
          responseBody: {
            error: 'Stripe webhook disabled. Set STRIPE_WEBHOOK_SECRET to enable billing reconciliation.',
          },
        };
      }

      const signature = input.signature?.trim() ?? '';
      if (!signature) {
        return {
          kind: 'rejected',
          statusCode: 400,
          responseBody: {
            error: 'Stripe-Signature header is required.',
          },
        };
      }

      let event: Stripe.Event;
      try {
        event = deps.stripeClient().webhooks.constructEvent(
          input.rawPayload,
          signature,
          webhookSecret,
        );
      } catch (error) {
        deps.observeBillingWebhookEvent('signature_verification', 'signature_invalid');
        return {
          kind: 'rejected',
          statusCode: 400,
          responseBody: {
            error: 'Stripe webhook signature verification failed.',
            detail: error instanceof Error ? error.message : String(error),
          },
        };
      }

      const sharedBillingLedger = deps.isBillingEventLedgerConfigured();
      const sharedControlPlaneWebhookState =
        !sharedBillingLedger && deps.isSharedControlPlaneConfigured();
      const dedupe = sharedBillingLedger
        ? await deps.claimStripeBillingEvent({
          providerEventId: event.id,
          eventType: event.type,
          rawPayload: input.rawPayload,
        })
        : sharedControlPlaneWebhookState
          ? await deps.claimProcessedStripeWebhookState({
            eventId: event.id,
            eventType: event.type,
            rawPayload: input.rawPayload,
          })
          : await deps.lookupProcessedStripeWebhookState(event.id, input.rawPayload);
      const controlPlaneClaimId =
        dedupe.kind === 'claimed' && 'claimId' in dedupe ? dedupe.claimId : null;

      if (dedupe.kind === 'conflict') {
        deps.observeBillingWebhookEvent(event.type, 'conflict');
        return {
          kind: 'rejected',
          statusCode: 409,
          responseBody: {
            error: `Stripe event '${event.id}' was already recorded with a different payload hash.`,
            eventType: dedupe.record.eventType,
            recordedAt: dedupe.record.receivedAt,
          },
        };
      }

      if (dedupe.kind === 'duplicate') {
        deps.observeBillingWebhookEvent(dedupe.record.eventType, 'duplicate');
        return {
          kind: 'rejected',
          statusCode: 200,
          headers: {
            'x-attestor-stripe-replay': 'true',
          },
          responseBody: {
            received: true,
            duplicate: true,
            eventId: event.id,
            eventType: dedupe.record.eventType,
            outcome: dedupe.record.outcome,
            accountId: dedupe.record.accountId,
            reason: dedupe.record.reason,
          },
        };
      }

      const webhook: StripeWebhookProcessingHandle = {
        event,
        rawPayload: input.rawPayload,
        payloadHash: dedupe.payloadHash,
        sharedBillingLedger,
        sharedControlPlaneWebhookState,
        controlPlaneClaimId,
        finalizedSharedEvent: false,
        finalizedControlPlaneEvent: false,
        async finalizeSharedEvent(finalization) {
          await deps.finalizeStripeBillingEvent(finalization);
          this.finalizedSharedEvent = true;
        },
        async finalizeDedupe(finalization) {
          if (sharedBillingLedger) return;
          if (sharedControlPlaneWebhookState && controlPlaneClaimId) {
            await deps.finalizeProcessedStripeWebhookState({
              claimId: controlPlaneClaimId,
              eventId: event.id,
              eventType: finalization.eventType,
              accountId: finalization.accountId,
              stripeCustomerId: finalization.stripeCustomerId,
              stripeSubscriptionId: finalization.stripeSubscriptionId,
              outcome: finalization.outcome,
              reason: finalization.reason,
              rawPayload: input.rawPayload,
            });
            this.finalizedControlPlaneEvent = true;
            return;
          }
          await deps.recordProcessedStripeWebhookState({
            eventId: event.id,
            eventType: finalization.eventType,
            accountId: finalization.accountId,
            stripeCustomerId: finalization.stripeCustomerId,
            stripeSubscriptionId: finalization.stripeSubscriptionId,
            outcome: finalization.outcome,
            reason: finalization.reason,
            rawPayload: input.rawPayload,
          });
        },
        async releaseClaim() {
          if (sharedBillingLedger && !this.finalizedSharedEvent) {
            await deps.releaseStripeBillingEventClaim(event.id);
            return;
          }
          if (sharedControlPlaneWebhookState && controlPlaneClaimId && !this.finalizedControlPlaneEvent) {
            await deps.releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
          }
        },
      };

      return {
        kind: 'ready',
        webhook,
      };
    },
  };
}
