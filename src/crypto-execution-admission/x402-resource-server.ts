import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import {
  X402_HTTP_PAYMENT_REQUIRED_STATUS,
  X402_PAYMENT_REQUIRED_HEADER,
  X402_PAYMENT_RESPONSE_HEADER,
  X402_PAYMENT_SIGNATURE_HEADER,
  type X402AgentBudgetEvidence,
  type X402AgenticPaymentPreflight,
  type X402FacilitatorEvidence,
  type X402PaymentPayloadEvidence,
  type X402PaymentRequirementsEvidence,
  type X402PrivacyMetadataEvidence,
  type X402ResourceEvidence,
  type X402ServiceTrustEvidence,
} from '../crypto-authorization-core/x402-agentic-payment-adapter.js';
import type { CryptoExecutionAdmissionPlan } from './index.js';

/**
 * x402 resource-server admission middleware turns the Attestor admission plan
 * and x402 preflight evidence into the concrete fail-closed contract a resource
 * server middleware should honor before returning a paid response.
 */

export const X402_RESOURCE_SERVER_ADMISSION_MIDDLEWARE_SPEC_VERSION =
  'attestor.crypto-x402-resource-server-admission-middleware.v1';

export const X402_RESOURCE_SERVER_ADMISSION_PHASES = [
  'payment-challenge',
  'payment-retry',
  'resource-fulfillment',
] as const;
export type X402ResourceServerAdmissionPhase =
  typeof X402_RESOURCE_SERVER_ADMISSION_PHASES[number];

export const X402_RESOURCE_SERVER_ADMISSION_OUTCOMES = [
  'ready',
  'needs-http-evidence',
  'blocked',
] as const;
export type X402ResourceServerAdmissionOutcome =
  typeof X402_RESOURCE_SERVER_ADMISSION_OUTCOMES[number];

export const X402_RESOURCE_SERVER_ADMISSION_ACTIONS = [
  'issue-payment-required',
  'verify-payment',
  'settle-payment',
  'fulfill-resource',
  'block-request',
] as const;
export type X402ResourceServerAdmissionAction =
  typeof X402_RESOURCE_SERVER_ADMISSION_ACTIONS[number];

export const X402_RESOURCE_SERVER_ADMISSION_EXPECTATION_KINDS = [
  'plan-surface',
  'adapter-preflight',
  'resource-route',
  'service-trust',
  'privacy-posture',
  'payment-required-header',
  'payment-signature-header',
  'facilitator-verify',
  'facilitator-settle',
  'payment-response-header',
  'payment-identifier',
  'fulfillment-gate',
] as const;
export type X402ResourceServerAdmissionExpectationKind =
  typeof X402_RESOURCE_SERVER_ADMISSION_EXPECTATION_KINDS[number];

export const X402_RESOURCE_SERVER_ADMISSION_EXPECTATION_STATUSES = [
  'satisfied',
  'missing',
  'failed',
  'unsupported',
  'pending',
] as const;
export type X402ResourceServerAdmissionExpectationStatus =
  typeof X402_RESOURCE_SERVER_ADMISSION_EXPECTATION_STATUSES[number];

export interface X402ResourceServerRuntimeObservation {
  readonly observedAt: string;
  readonly paymentRequiredHeaderSent?: boolean | null;
  readonly paymentSignatureHeaderSeen?: boolean | null;
  readonly paymentResponseHeaderSent?: boolean | null;
  readonly verifyAccepted?: boolean | null;
  readonly settlementAccepted?: boolean | null;
  readonly fulfillmentDeferredUntilSettlement?: boolean | null;
  readonly resourceFulfilled?: boolean | null;
  readonly duplicatePaymentBlocked?: boolean | null;
  readonly returnedStatusCode?: number | null;
}

export interface X402ResourceServerAdmissionExpectation {
  readonly kind: X402ResourceServerAdmissionExpectationKind;
  readonly status: X402ResourceServerAdmissionExpectationStatus;
  readonly reasonCode: string;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface X402ResourceServerAdmissionHeaders {
  readonly paymentRequiredStatus: typeof X402_HTTP_PAYMENT_REQUIRED_STATUS;
  readonly paymentRequired: typeof X402_PAYMENT_REQUIRED_HEADER;
  readonly paymentSignature: typeof X402_PAYMENT_SIGNATURE_HEADER;
  readonly paymentResponse: typeof X402_PAYMENT_RESPONSE_HEADER;
}

export interface X402ResourceServerAdmissionFacilitatorContract {
  readonly facilitatorUrl: string;
  readonly path: X402FacilitatorEvidence['path'];
  readonly verifyPath: '/verify';
  readonly settlePath: '/settle';
}

export interface X402ResourceServerAdmissionFulfillmentGate {
  readonly requiresSettlementSuccess: true;
  readonly requiresPaymentResponseHeader: true;
  readonly requiresIdempotencyProtection: true;
  readonly challengeStatusCode: typeof X402_HTTP_PAYMENT_REQUIRED_STATUS;
}

export interface CreateX402ResourceServerAdmissionMiddlewareInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: X402AgenticPaymentPreflight;
  readonly resource: X402ResourceEvidence;
  readonly paymentRequirements: X402PaymentRequirementsEvidence;
  readonly paymentPayload: X402PaymentPayloadEvidence;
  readonly facilitator: X402FacilitatorEvidence;
  readonly budget: X402AgentBudgetEvidence;
  readonly serviceTrust: X402ServiceTrustEvidence;
  readonly privacy: X402PrivacyMetadataEvidence;
  readonly phase: X402ResourceServerAdmissionPhase;
  readonly createdAt: string;
  readonly middlewareId?: string | null;
  readonly runtimeObservation?: X402ResourceServerRuntimeObservation | null;
  readonly operatorNote?: string | null;
}

export interface X402ResourceServerAdmissionMiddleware {
  readonly version: typeof X402_RESOURCE_SERVER_ADMISSION_MIDDLEWARE_SPEC_VERSION;
  readonly middlewareId: string;
  readonly createdAt: string;
  readonly phase: X402ResourceServerAdmissionPhase;
  readonly outcome: X402ResourceServerAdmissionOutcome;
  readonly action: X402ResourceServerAdmissionAction;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly preflightId: string;
  readonly preflightDigest: string;
  readonly routeId: string | null;
  readonly method: string;
  readonly resourceUrl: string;
  readonly payer: string;
  readonly payTo: string;
  readonly network: string;
  readonly scheme: string;
  readonly amount: string;
  readonly asset: string;
  readonly budgetId: string;
  readonly idempotencyKey: string;
  readonly requirementsHash: string | null;
  readonly payloadHash: string | null;
  readonly settlementTransaction: string | null;
  readonly headers: X402ResourceServerAdmissionHeaders;
  readonly facilitatorContract: X402ResourceServerAdmissionFacilitatorContract;
  readonly fulfillmentGate: X402ResourceServerAdmissionFulfillmentGate;
  readonly runtimeObservation: X402ResourceServerRuntimeObservation | null;
  readonly attestorSidecar: Readonly<Record<string, CanonicalReleaseJsonValue>>;
  readonly expectations: readonly X402ResourceServerAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface X402ResourceServerAdmissionDescriptor {
  readonly version: typeof X402_RESOURCE_SERVER_ADMISSION_MIDDLEWARE_SPEC_VERSION;
  readonly phases: typeof X402_RESOURCE_SERVER_ADMISSION_PHASES;
  readonly outcomes: typeof X402_RESOURCE_SERVER_ADMISSION_OUTCOMES;
  readonly actions: typeof X402_RESOURCE_SERVER_ADMISSION_ACTIONS;
  readonly expectationKinds: typeof X402_RESOURCE_SERVER_ADMISSION_EXPECTATION_KINDS;
  readonly expectationStatuses: typeof X402_RESOURCE_SERVER_ADMISSION_EXPECTATION_STATUSES;
  readonly headers: X402ResourceServerAdmissionHeaders;
  readonly standards: readonly string[];
  readonly runtimeChecks: readonly string[];
}

function includesValue<T extends string>(
  values: readonly T[],
  candidate: string,
): candidate is T {
  return (values as readonly string[]).includes(candidate);
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(
      `x402 resource-server admission ${fieldName} requires a non-empty value.`,
    );
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(
      `x402 resource-server admission ${fieldName} must be an ISO timestamp.`,
    );
  }
  return timestamp.toISOString();
}

function normalizeMethod(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toUpperCase();
  if (!/^[A-Z]+$/u.test(normalized)) {
    throw new Error(
      `x402 resource-server admission ${fieldName} must be an HTTP token.`,
    );
  }
  return normalized;
}

function normalizeUrl(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  try {
    return new URL(normalized).toString();
  } catch {
    throw new Error(`x402 resource-server admission ${fieldName} must be a URL.`);
  }
}

function normalizePhase(value: string): X402ResourceServerAdmissionPhase {
  if (!includesValue(X402_RESOURCE_SERVER_ADMISSION_PHASES, value)) {
    throw new Error(
      `x402 resource-server admission phase must be one of ${X402_RESOURCE_SERVER_ADMISSION_PHASES.join(', ')}.`,
    );
  }
  return value;
}

function normalizeComparable(value: string | null | undefined): string {
  const normalized = normalizeIdentifier(value, 'comparable');
  return normalized.startsWith('0x') ? normalized.toLowerCase() : normalized.toLowerCase();
}

function normalizeRuntimeObservation(
  value: X402ResourceServerRuntimeObservation | null | undefined,
): X402ResourceServerRuntimeObservation | null {
  if (!value) return null;
  return Object.freeze({
    observedAt: normalizeIsoTimestamp(value.observedAt, 'runtimeObservation.observedAt'),
    paymentRequiredHeaderSent:
      value.paymentRequiredHeaderSent === undefined
        ? null
        : Boolean(value.paymentRequiredHeaderSent),
    paymentSignatureHeaderSeen:
      value.paymentSignatureHeaderSeen === undefined
        ? null
        : Boolean(value.paymentSignatureHeaderSeen),
    paymentResponseHeaderSent:
      value.paymentResponseHeaderSent === undefined
        ? null
        : Boolean(value.paymentResponseHeaderSent),
    verifyAccepted:
      value.verifyAccepted === undefined ? null : Boolean(value.verifyAccepted),
    settlementAccepted:
      value.settlementAccepted === undefined ? null : Boolean(value.settlementAccepted),
    fulfillmentDeferredUntilSettlement:
      value.fulfillmentDeferredUntilSettlement === undefined
        ? null
        : Boolean(value.fulfillmentDeferredUntilSettlement),
    resourceFulfilled:
      value.resourceFulfilled === undefined ? null : Boolean(value.resourceFulfilled),
    duplicatePaymentBlocked:
      value.duplicatePaymentBlocked === undefined
        ? null
        : Boolean(value.duplicatePaymentBlocked),
    returnedStatusCode:
      value.returnedStatusCode === undefined || value.returnedStatusCode === null
        ? null
        : value.returnedStatusCode,
  });
}

function canonicalObject<T extends CanonicalReleaseJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  const canonical = canonicalizeReleaseJson(value);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return Object.freeze({
    canonical,
    digest: `sha256:${digest}`,
  });
}

function expectation(
  kind: X402ResourceServerAdmissionExpectationKind,
  status: X402ResourceServerAdmissionExpectationStatus,
  reasonCode: string,
  evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>,
): X402ResourceServerAdmissionExpectation {
  return Object.freeze({
    kind,
    status,
    reasonCode,
    evidence,
  });
}

function expectationsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: X402AgenticPaymentPreflight;
  readonly resource: X402ResourceEvidence;
  readonly paymentRequirements: X402PaymentRequirementsEvidence;
  readonly paymentPayload: X402PaymentPayloadEvidence;
  readonly facilitator: X402FacilitatorEvidence;
  readonly budget: X402AgentBudgetEvidence;
  readonly serviceTrust: X402ServiceTrustEvidence;
  readonly privacy: X402PrivacyMetadataEvidence;
  readonly phase: X402ResourceServerAdmissionPhase;
  readonly runtimeObservation: X402ResourceServerRuntimeObservation | null;
}): readonly X402ResourceServerAdmissionExpectation[] {
  const planSurfaceReady =
    input.plan.surface === 'agent-payment-http' &&
    input.plan.adapterKind === 'x402-payment' &&
    input.preflight.adapterKind === 'x402-payment';
  const planExpectation = expectation(
    'plan-surface',
    planSurfaceReady ? 'satisfied' : 'failed',
    planSurfaceReady
      ? 'x402-plan-surface-ready'
      : 'x402-plan-surface-mismatch',
    {
      planSurface: input.plan.surface,
      planAdapterKind: input.plan.adapterKind ?? 'adapter-neutral',
      preflightAdapterKind: input.preflight.adapterKind,
    },
  );

  const preflightStatus: X402ResourceServerAdmissionExpectationStatus =
    input.plan.outcome === 'deny' || input.preflight.outcome === 'block'
      ? 'failed'
      : input.plan.outcome === 'admit' && input.preflight.outcome === 'allow'
        ? 'satisfied'
        : 'pending';
  const preflightExpectation = expectation(
    'adapter-preflight',
    preflightStatus,
    preflightStatus === 'failed'
      ? input.plan.outcome === 'deny'
        ? 'x402-admission-plan-denied'
        : 'x402-preflight-blocked'
      : preflightStatus === 'pending'
        ? 'x402-preflight-awaiting-evidence'
        : 'x402-preflight-ready',
    {
      planOutcome: input.plan.outcome,
      preflightOutcome: input.preflight.outcome,
      chainId: input.plan.chainId,
      network: input.preflight.network,
    },
  );

  const resourceRouteReady =
    input.resource.transport === 'http' &&
    normalizeMethod(input.resource.method, 'resource.method') ===
      normalizeMethod(input.preflight.method, 'preflight.method') &&
    normalizeUrl(input.resource.resourceUrl, 'resource.resourceUrl') ===
      normalizeUrl(input.preflight.resourceUrl, 'preflight.resourceUrl') &&
    normalizeComparable(input.paymentRequirements.network) ===
      normalizeComparable(input.preflight.network) &&
    normalizeComparable(input.plan.chainId) ===
      normalizeComparable(input.preflight.network);
  const resourceRouteExpectation = expectation(
    'resource-route',
    resourceRouteReady ? 'satisfied' : 'failed',
    resourceRouteReady
      ? 'x402-resource-route-bound'
      : 'x402-resource-route-mismatch',
    {
      transport: input.resource.transport,
      method: normalizeMethod(input.resource.method, 'resource.method'),
      resourceUrl: normalizeUrl(input.resource.resourceUrl, 'resource.resourceUrl'),
      routeId: input.resource.routeId ?? null,
      network: input.paymentRequirements.network,
      planChainId: input.plan.chainId,
    },
  );

  const serviceTrustReady =
    input.serviceTrust.resourceOriginAllowlisted &&
    input.serviceTrust.payToAllowlisted &&
    input.serviceTrust.assetAllowlisted &&
    input.serviceTrust.networkAllowlisted &&
    input.serviceTrust.priceMatchesCatalog;
  const serviceTrustExpectation = expectation(
    'service-trust',
    serviceTrustReady ? 'satisfied' : 'failed',
    serviceTrustReady
      ? 'x402-service-trust-ready'
      : 'x402-service-trust-failed',
    {
      merchantId: input.serviceTrust.merchantId,
      serviceDiscoveryRef: input.serviceTrust.serviceDiscoveryRef ?? null,
      resourceOriginAllowlisted: input.serviceTrust.resourceOriginAllowlisted,
      payToAllowlisted: input.serviceTrust.payToAllowlisted,
      assetAllowlisted: input.serviceTrust.assetAllowlisted,
      networkAllowlisted: input.serviceTrust.networkAllowlisted,
      priceMatchesCatalog: input.serviceTrust.priceMatchesCatalog,
    },
  );

  const privacyReady =
    input.privacy.metadataScanned &&
    input.privacy.metadataMinimized &&
    input.privacy.facilitatorDataMinimized &&
    (!input.privacy.piiDetected || input.privacy.piiRedacted) &&
    (!input.privacy.sensitiveQueryDetected || input.privacy.sensitiveQueryRedacted);
  const privacyExpectation = expectation(
    'privacy-posture',
    privacyReady ? 'satisfied' : 'failed',
    privacyReady
      ? 'x402-privacy-posture-ready'
      : 'x402-privacy-posture-failed',
    {
      metadataScanned: input.privacy.metadataScanned,
      piiDetected: input.privacy.piiDetected,
      piiRedacted: input.privacy.piiRedacted,
      sensitiveQueryDetected: input.privacy.sensitiveQueryDetected,
      sensitiveQueryRedacted: input.privacy.sensitiveQueryRedacted,
      metadataMinimized: input.privacy.metadataMinimized,
      facilitatorDataMinimized: input.privacy.facilitatorDataMinimized,
    },
  );

  const paymentRequiredSent =
    input.phase === 'payment-challenge'
      ? (input.runtimeObservation?.paymentRequiredHeaderSent ??
          input.resource.paymentRequiredHeaderPresent)
      : input.resource.paymentRequiredHeaderPresent;
  const paymentRequiredReady =
    input.resource.statusCode === X402_HTTP_PAYMENT_REQUIRED_STATUS &&
    paymentRequiredSent &&
    input.resource.paymentRequiredHeaderDecoded &&
    input.resource.responseBodyMatchesHeader;
  const paymentRequiredExpectation = expectation(
    'payment-required-header',
    paymentRequiredReady ? 'satisfied' : 'failed',
    paymentRequiredReady
      ? 'x402-payment-required-header-ready'
      : 'x402-payment-required-header-invalid',
    {
      phase: input.phase,
      statusCode: input.resource.statusCode,
      paymentRequiredHeaderPresent: paymentRequiredSent,
      paymentRequiredHeaderDecoded: input.resource.paymentRequiredHeaderDecoded,
      responseBodyMatchesHeader: input.resource.responseBodyMatchesHeader,
    },
  );

  const paymentSignatureSeen =
    input.runtimeObservation?.paymentSignatureHeaderSeen ??
    input.paymentPayload.paymentSignatureHeaderPresent;
  const paymentSignatureStatus: X402ResourceServerAdmissionExpectationStatus =
    input.phase === 'payment-challenge'
      ? paymentSignatureSeen
        ? 'satisfied'
        : 'pending'
      : paymentSignatureSeen
        ? input.paymentPayload.resourceMatchesRequirements &&
          input.paymentPayload.acceptedMatchesRequirements &&
          normalizeComparable(input.paymentPayload.payer) ===
            normalizeComparable(input.preflight.payer) &&
          normalizeComparable(input.paymentPayload.payTo) ===
            normalizeComparable(input.preflight.payTo) &&
          normalizeComparable(input.paymentPayload.amount) ===
            normalizeComparable(input.preflight.amount) &&
          normalizeComparable(input.paymentPayload.asset) ===
            normalizeComparable(input.preflight.asset) &&
          normalizeComparable(input.paymentPayload.network) ===
            normalizeComparable(input.preflight.network)
          ? 'satisfied'
          : 'failed'
        : 'missing';
  const paymentSignatureExpectation = expectation(
    'payment-signature-header',
    paymentSignatureStatus,
    paymentSignatureStatus === 'pending'
      ? 'x402-awaiting-payment-signature'
      : paymentSignatureStatus === 'missing'
        ? 'x402-payment-signature-header-missing'
        : paymentSignatureStatus === 'failed'
          ? 'x402-payment-signature-payload-mismatch'
          : 'x402-payment-signature-ready',
    {
      phase: input.phase,
      paymentSignatureHeaderPresent: paymentSignatureSeen,
      payer: input.paymentPayload.payer,
      payTo: input.paymentPayload.payTo,
      amount: input.paymentPayload.amount,
      asset: input.paymentPayload.asset,
      network: input.paymentPayload.network,
      resourceMatchesRequirements: input.paymentPayload.resourceMatchesRequirements,
      acceptedMatchesRequirements: input.paymentPayload.acceptedMatchesRequirements,
    },
  );

  const verifyAccepted =
    input.runtimeObservation?.verifyAccepted ?? input.facilitator.verifyResponseValid;
  const facilitatorVerifyStatus: X402ResourceServerAdmissionExpectationStatus =
    input.phase === 'payment-challenge'
      ? 'pending'
      : !input.facilitator.supportedChecked
        ? 'missing'
        : !input.facilitator.supportedKindAdvertised
          ? 'unsupported'
          : !input.facilitator.signerTrusted
            ? 'failed'
            : !input.facilitator.verifyRequested
              ? 'missing'
              : verifyAccepted &&
                  normalizeComparable(input.facilitator.verifyPayer ?? input.paymentPayload.payer) ===
                    normalizeComparable(input.paymentPayload.payer)
                ? 'satisfied'
                : 'failed';
  const facilitatorVerifyExpectation = expectation(
    'facilitator-verify',
    facilitatorVerifyStatus,
    facilitatorVerifyStatus === 'pending'
      ? 'x402-facilitator-verify-pending'
      : facilitatorVerifyStatus === 'missing'
        ? 'x402-facilitator-verify-missing'
        : facilitatorVerifyStatus === 'unsupported'
          ? 'x402-facilitator-kind-unsupported'
          : facilitatorVerifyStatus === 'failed'
            ? 'x402-facilitator-verify-failed'
            : 'x402-facilitator-verify-ready',
    {
      phase: input.phase,
      facilitatorUrl: input.facilitator.facilitatorUrl,
      path: input.facilitator.path,
      supportedChecked: input.facilitator.supportedChecked,
      supportedKindAdvertised: input.facilitator.supportedKindAdvertised,
      signerTrusted: input.facilitator.signerTrusted,
      verifyRequested: input.facilitator.verifyRequested,
      verifyAccepted,
      verifyPayer: input.facilitator.verifyPayer ?? null,
    },
  );

  const settlementAccepted =
    input.runtimeObservation?.settlementAccepted ?? input.facilitator.settleResponseSuccess;
  const facilitatorSettleStatus: X402ResourceServerAdmissionExpectationStatus =
    input.phase === 'payment-challenge'
      ? 'pending'
      : facilitatorVerifyStatus !== 'satisfied'
        ? 'pending'
        : !input.facilitator.settleRequested
          ? 'missing'
          : settlementAccepted === true
            ? 'satisfied'
            : settlementAccepted === null
              ? 'pending'
              : 'failed';
  const facilitatorSettleExpectation = expectation(
    'facilitator-settle',
    facilitatorSettleStatus,
    facilitatorSettleStatus === 'pending'
      ? 'x402-facilitator-settle-pending'
      : facilitatorSettleStatus === 'missing'
        ? 'x402-facilitator-settle-missing'
        : facilitatorSettleStatus === 'failed'
          ? 'x402-facilitator-settle-failed'
          : 'x402-facilitator-settle-ready',
    {
      phase: input.phase,
      settleRequested: input.facilitator.settleRequested,
      settlementAccepted,
      settlementTransaction: input.facilitator.settlementTransaction ?? null,
      settlementNetwork: input.facilitator.settlementNetwork ?? null,
      settlementAmount: input.facilitator.settlementAmount ?? null,
    },
  );

  const paymentResponseSent =
    input.runtimeObservation?.paymentResponseHeaderSent ??
    input.facilitator.paymentResponseHeaderPresent;
  const paymentResponseStatus: X402ResourceServerAdmissionExpectationStatus =
    input.phase === 'payment-challenge'
      ? 'pending'
      : facilitatorSettleStatus !== 'satisfied'
        ? 'pending'
        : paymentResponseSent
          ? 'satisfied'
          : 'failed';
  const paymentResponseExpectation = expectation(
    'payment-response-header',
    paymentResponseStatus,
    paymentResponseStatus === 'pending'
      ? 'x402-payment-response-header-pending'
      : paymentResponseStatus === 'failed'
        ? 'x402-payment-response-header-missing'
        : 'x402-payment-response-header-ready',
    {
      phase: input.phase,
      paymentResponseHeaderPresent: paymentResponseSent,
      settlementAccepted,
    },
  );

  const paymentIdentifierStatus: X402ResourceServerAdmissionExpectationStatus =
    input.budget.duplicatePaymentDetected
      ? 'failed'
      : input.budget.idempotencyFresh
        ? 'satisfied'
        : 'missing';
  const paymentIdentifierExpectation = expectation(
    'payment-identifier',
    paymentIdentifierStatus,
    paymentIdentifierStatus === 'failed'
      ? 'x402-duplicate-payment-detected'
      : paymentIdentifierStatus === 'missing'
        ? 'x402-payment-identifier-stale'
        : 'x402-payment-identifier-ready',
    {
      budgetId: input.budget.budgetId,
      idempotencyKey: input.budget.idempotencyKey,
      idempotencyFresh: input.budget.idempotencyFresh,
      duplicatePaymentDetected: input.budget.duplicatePaymentDetected,
      duplicatePaymentBlocked: input.runtimeObservation?.duplicatePaymentBlocked ?? null,
    },
  );

  const fulfillmentDeferred =
    input.runtimeObservation?.fulfillmentDeferredUntilSettlement ?? null;
  const returnedStatusCode = input.runtimeObservation?.returnedStatusCode ?? null;
  const resourceFulfilled = input.runtimeObservation?.resourceFulfilled ?? null;
  const fulfillmentGateStatus: X402ResourceServerAdmissionExpectationStatus =
    input.phase === 'payment-challenge'
      ? 'pending'
      : facilitatorSettleStatus !== 'satisfied'
        ? 'pending'
        : paymentResponseStatus !== 'satisfied'
          ? 'failed'
          : fulfillmentDeferred === false
            ? 'failed'
            : input.phase === 'resource-fulfillment' || resourceFulfilled === true
              ? 'satisfied'
              : 'pending';
  const fulfillmentGateExpectation = expectation(
    'fulfillment-gate',
    fulfillmentGateStatus,
    fulfillmentGateStatus === 'pending'
      ? 'x402-fulfillment-awaiting-release'
      : fulfillmentGateStatus === 'failed'
        ? 'x402-fulfillment-gate-failed'
        : 'x402-fulfillment-gate-ready',
    {
      phase: input.phase,
      settlementAccepted,
      paymentResponseHeaderPresent: paymentResponseSent,
      fulfillmentDeferredUntilSettlement: fulfillmentDeferred,
      resourceFulfilled,
      returnedStatusCode,
    },
  );

  return Object.freeze([
    planExpectation,
    preflightExpectation,
    resourceRouteExpectation,
    serviceTrustExpectation,
    privacyExpectation,
    paymentRequiredExpectation,
    paymentSignatureExpectation,
    facilitatorVerifyExpectation,
    facilitatorSettleExpectation,
    paymentResponseExpectation,
    paymentIdentifierExpectation,
    fulfillmentGateExpectation,
  ]);
}

function blockingReasonsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: X402AgenticPaymentPreflight;
  readonly paymentRequirements: X402PaymentRequirementsEvidence;
  readonly paymentPayload: X402PaymentPayloadEvidence;
  readonly expectations: readonly X402ResourceServerAdmissionExpectation[];
}): readonly string[] {
  const reasons: string[] = [];
  if (input.plan.surface !== 'agent-payment-http') {
    reasons.push('admission-plan-surface-not-agent-payment-http');
  }
  if (input.plan.adapterKind !== 'x402-payment') {
    reasons.push('admission-plan-adapter-not-x402-payment');
  }
  if (input.preflight.adapterKind !== 'x402-payment') {
    reasons.push('preflight-adapter-not-x402-payment');
  }
  if (input.plan.outcome === 'deny') {
    reasons.push('admission-plan-denied');
  }
  if (input.preflight.outcome === 'block') {
    reasons.push('x402-preflight-blocked');
  }
  if (
    normalizeComparable(input.plan.chainId) !==
      normalizeComparable(input.preflight.network) ||
    normalizeComparable(input.paymentRequirements.network) !==
      normalizeComparable(input.preflight.network) ||
    normalizeComparable(input.paymentPayload.network) !==
      normalizeComparable(input.preflight.network)
  ) {
    reasons.push('x402-network-mismatch');
  }
  if (
    normalizeComparable(input.plan.accountAddress) !==
      normalizeComparable(input.preflight.payer) ||
    normalizeComparable(input.paymentPayload.payer) !==
      normalizeComparable(input.preflight.payer)
  ) {
    reasons.push('x402-payer-mismatch');
  }
  if (
    normalizeComparable(input.paymentRequirements.payTo) !==
      normalizeComparable(input.preflight.payTo) ||
    normalizeComparable(input.paymentPayload.payTo) !==
      normalizeComparable(input.preflight.payTo)
  ) {
    reasons.push('x402-payto-mismatch');
  }
  if (
    normalizeComparable(input.paymentRequirements.amount) !==
      normalizeComparable(input.preflight.amount) ||
    normalizeComparable(input.paymentPayload.amount) !==
      normalizeComparable(input.preflight.amount)
  ) {
    reasons.push('x402-amount-mismatch');
  }
  if (
    normalizeComparable(input.paymentRequirements.asset) !==
      normalizeComparable(input.preflight.asset) ||
    normalizeComparable(input.paymentPayload.asset) !==
      normalizeComparable(input.preflight.asset)
  ) {
    reasons.push('x402-asset-mismatch');
  }
  input.expectations
    .filter((entry) => entry.status === 'failed' || entry.status === 'unsupported')
    .forEach((entry) => reasons.push(entry.reasonCode));
  return Object.freeze(reasons);
}

function outcomeFor(input: {
  readonly phase: X402ResourceServerAdmissionPhase;
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: X402AgenticPaymentPreflight;
  readonly expectations: readonly X402ResourceServerAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
}): X402ResourceServerAdmissionOutcome {
  if (input.blockingReasons.length > 0) return 'blocked';
  if (input.phase === 'payment-challenge') return 'needs-http-evidence';
  if (input.plan.outcome !== 'admit' || input.preflight.outcome !== 'allow') {
    return 'needs-http-evidence';
  }
  if (
    input.expectations.some(
      (entry) => entry.status === 'missing' || entry.status === 'pending',
    )
  ) {
    return 'needs-http-evidence';
  }
  return 'ready';
}

function actionFor(input: {
  readonly outcome: X402ResourceServerAdmissionOutcome;
  readonly phase: X402ResourceServerAdmissionPhase;
  readonly expectations: readonly X402ResourceServerAdmissionExpectation[];
}): X402ResourceServerAdmissionAction {
  if (input.outcome === 'blocked') return 'block-request';
  if (input.phase === 'payment-challenge') return 'issue-payment-required';
  const byKind = new Map(
    input.expectations.map((entry) => [entry.kind, entry] as const),
  );
  const paymentSignature = byKind.get('payment-signature-header');
  if (paymentSignature && paymentSignature.status !== 'satisfied') {
    return 'issue-payment-required';
  }
  const verify = byKind.get('facilitator-verify');
  if (verify && verify.status !== 'satisfied') {
    return 'verify-payment';
  }
  const settle = byKind.get('facilitator-settle');
  if (settle && settle.status !== 'satisfied') {
    return 'settle-payment';
  }
  return 'fulfill-resource';
}

function nextActionsFor(input: {
  readonly outcome: X402ResourceServerAdmissionOutcome;
  readonly action: X402ResourceServerAdmissionAction;
}): readonly string[] {
  if (input.outcome === 'blocked') {
    return Object.freeze([
      'Do not fulfill the resource for this request.',
      'Return a fail-closed denial or HTTP 402 response and create a new admission after fixing the blocked reason.',
    ]);
  }
  switch (input.action) {
    case 'issue-payment-required':
      return Object.freeze([
        'Return HTTP 402 with the PAYMENT-REQUIRED header for the admitted route.',
        'Do not verify, settle, or fulfill the resource until the client retries with PAYMENT-SIGNATURE.',
      ]);
    case 'verify-payment':
      return Object.freeze([
        'Verify the PAYMENT-SIGNATURE payload locally or through facilitator /verify before any fulfillment.',
        'Keep the resource blocked until verification succeeds for the admitted payer, amount, asset, and payee.',
      ]);
    case 'settle-payment':
      return Object.freeze([
        'Call facilitator /settle or settle locally and wait for settlement success before any fulfillment.',
        'Prepare the PAYMENT-RESPONSE header only after settlement outcome is known.',
      ]);
    case 'fulfill-resource':
      return Object.freeze([
        'Return the paid resource only after settlement success and PAYMENT-RESPONSE binding are in place.',
        'Record the Attestor admission middleware digest alongside the downstream settlement result.',
      ]);
    case 'block-request':
      return Object.freeze([
        'Do not fulfill the resource.',
        'Resolve the blocked admission reason and mint a new middleware contract.',
      ]);
  }
}

function middlewareIdFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: X402AgenticPaymentPreflight;
  readonly phase: X402ResourceServerAdmissionPhase;
  readonly createdAt: string;
}): string {
  return canonicalObject({
    version: X402_RESOURCE_SERVER_ADMISSION_MIDDLEWARE_SPEC_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    phase: input.phase,
    createdAt: input.createdAt,
  }).digest;
}

export function createX402ResourceServerAdmissionMiddleware(
  input: CreateX402ResourceServerAdmissionMiddlewareInput,
): X402ResourceServerAdmissionMiddleware {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const phase = normalizePhase(input.phase);
  const method = normalizeMethod(input.resource.method, 'resource.method');
  const resourceUrl = normalizeUrl(input.resource.resourceUrl, 'resource.resourceUrl');
  const runtimeObservation = normalizeRuntimeObservation(input.runtimeObservation);
  const expectations = expectationsFor({
    ...input,
    phase,
    runtimeObservation,
  });
  const blockingReasons = blockingReasonsFor({
    plan: input.plan,
    preflight: input.preflight,
    paymentRequirements: input.paymentRequirements,
    paymentPayload: input.paymentPayload,
    expectations,
  });
  const outcome = outcomeFor({
    phase,
    plan: input.plan,
    preflight: input.preflight,
    expectations,
    blockingReasons,
  });
  const action = actionFor({
    outcome,
    phase,
    expectations,
  });
  const middlewareId =
    normalizeOptionalIdentifier(input.middlewareId, 'middlewareId') ??
    middlewareIdFor({
      plan: input.plan,
      preflight: input.preflight,
      phase,
      createdAt,
    });

  const headers: X402ResourceServerAdmissionHeaders = Object.freeze({
    paymentRequiredStatus: X402_HTTP_PAYMENT_REQUIRED_STATUS,
    paymentRequired: X402_PAYMENT_REQUIRED_HEADER,
    paymentSignature: X402_PAYMENT_SIGNATURE_HEADER,
    paymentResponse: X402_PAYMENT_RESPONSE_HEADER,
  });

  const facilitatorContract: X402ResourceServerAdmissionFacilitatorContract =
    Object.freeze({
      facilitatorUrl: normalizeUrl(
        input.facilitator.facilitatorUrl,
        'facilitator.facilitatorUrl',
      ),
      path: input.facilitator.path,
      verifyPath: '/verify',
      settlePath: '/settle',
    });

  const fulfillmentGate: X402ResourceServerAdmissionFulfillmentGate = Object.freeze({
    requiresSettlementSuccess: true,
    requiresPaymentResponseHeader: true,
    requiresIdempotencyProtection: true,
    challengeStatusCode: X402_HTTP_PAYMENT_REQUIRED_STATUS,
  });

  const attestorSidecar = Object.freeze({
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    releaseBindingDigest: input.preflight.releaseBindingDigest,
    policyScopeDigest: input.preflight.policyScopeDigest,
    enforcementBindingDigest: input.preflight.enforcementBindingDigest,
    phase,
    outcome,
    action,
  });

  const canonicalPayload = {
    version: X402_RESOURCE_SERVER_ADMISSION_MIDDLEWARE_SPEC_VERSION,
    middlewareId,
    createdAt,
    phase,
    outcome,
    action,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    routeId: normalizeOptionalIdentifier(input.resource.routeId, 'resource.routeId'),
    method,
    resourceUrl,
    payer: normalizeIdentifier(input.paymentPayload.payer, 'paymentPayload.payer'),
    payTo: normalizeIdentifier(input.paymentRequirements.payTo, 'paymentRequirements.payTo'),
    network: normalizeIdentifier(input.paymentRequirements.network, 'paymentRequirements.network'),
    scheme: normalizeIdentifier(input.paymentRequirements.scheme, 'paymentRequirements.scheme'),
    amount: normalizeIdentifier(input.paymentRequirements.amount, 'paymentRequirements.amount'),
    asset: normalizeIdentifier(input.paymentRequirements.asset, 'paymentRequirements.asset'),
    budgetId: normalizeIdentifier(input.budget.budgetId, 'budget.budgetId'),
    idempotencyKey: normalizeIdentifier(input.budget.idempotencyKey, 'budget.idempotencyKey'),
    requirementsHash: normalizeOptionalIdentifier(
      input.paymentRequirements.requirementsHash,
      'paymentRequirements.requirementsHash',
    ),
    payloadHash: normalizeOptionalIdentifier(
      input.paymentPayload.payloadHash,
      'paymentPayload.payloadHash',
    ),
    settlementTransaction: normalizeOptionalIdentifier(
      input.facilitator.settlementTransaction,
      'facilitator.settlementTransaction',
    ),
    headers,
    facilitatorContract,
    fulfillmentGate,
    runtimeObservation,
    attestorSidecar,
    expectations,
    blockingReasons,
    nextActions: nextActionsFor({ outcome, action }),
    operatorNote: normalizeOptionalIdentifier(input.operatorNote, 'operatorNote'),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function x402ResourceServerAdmissionLabel(
  middleware: X402ResourceServerAdmissionMiddleware,
): string {
  return [
    `x402-resource-server:${middleware.phase}`,
    `${middleware.method} ${middleware.resourceUrl}`,
    `outcome:${middleware.outcome}`,
    `action:${middleware.action}`,
  ].join(' / ');
}

export function x402ResourceServerAdmissionDescriptor():
X402ResourceServerAdmissionDescriptor {
  return Object.freeze({
    version: X402_RESOURCE_SERVER_ADMISSION_MIDDLEWARE_SPEC_VERSION,
    phases: X402_RESOURCE_SERVER_ADMISSION_PHASES,
    outcomes: X402_RESOURCE_SERVER_ADMISSION_OUTCOMES,
    actions: X402_RESOURCE_SERVER_ADMISSION_ACTIONS,
    expectationKinds: X402_RESOURCE_SERVER_ADMISSION_EXPECTATION_KINDS,
    expectationStatuses: X402_RESOURCE_SERVER_ADMISSION_EXPECTATION_STATUSES,
    headers: Object.freeze({
      paymentRequiredStatus: X402_HTTP_PAYMENT_REQUIRED_STATUS,
      paymentRequired: X402_PAYMENT_REQUIRED_HEADER,
      paymentSignature: X402_PAYMENT_SIGNATURE_HEADER,
      paymentResponse: X402_PAYMENT_RESPONSE_HEADER,
    }),
    standards: Object.freeze(['x402-v2', 'HTTP 402', 'EIP-3009']),
    runtimeChecks: Object.freeze([
      'PAYMENT-REQUIRED',
      'PAYMENT-SIGNATURE',
      'facilitatorVerify',
      'facilitatorSettle',
      'PAYMENT-RESPONSE',
      'paymentIdentifier',
      'fulfillmentGate',
    ]),
  });
}
