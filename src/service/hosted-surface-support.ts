import type { AdminAuditRecord } from './admin-audit-log.js';
import type { HostedAccountRecord } from './account-store.js';
import type { BillingEventRecord } from './billing-event-ledger.js';
import type { HostedBillingEntitlementRecord } from './billing-entitlement-store.js';
import {
  listHostedPlans,
  resolvePlanAsyncDispatch,
  resolvePlanAsyncExecution,
  resolvePlanAsyncQueue,
  resolvePlanRateLimit,
  resolvePlanStripePrice,
  resolvePlanStripeTrialDays,
} from './plan-catalog.js';
import type { TenantKeyRecord } from './tenant-key-store.js';

export function adminTenantKeyView(record: TenantKeyRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    tenantName: record.tenantName,
    planId: record.planId,
    monthlyRunQuota: record.monthlyRunQuota,
    apiKeyPreview: record.apiKeyPreview,
    status: record.status,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    deactivatedAt: record.deactivatedAt,
    revokedAt: record.revokedAt,
    rotatedFromKeyId: record.rotatedFromKeyId,
    supersededByKeyId: record.supersededByKeyId,
    supersededAt: record.supersededAt,
    sealedStorage: {
      enabled: Boolean(record.recoveryEnvelope),
      provider: record.recoveryEnvelope?.provider ?? null,
      keyName: record.recoveryEnvelope?.keyName ?? null,
      sealedAt: record.recoveryEnvelope?.sealedAt ?? null,
      breakGlassRecoverable: Boolean(record.recoveryEnvelope),
    },
  };
}

export function accountApiKeyView(record: TenantKeyRecord) {
  return adminTenantKeyView(record);
}

export function adminAccountView(record: HostedAccountRecord) {
  return {
    id: record.id,
    accountName: record.accountName,
    contactEmail: record.contactEmail,
    primaryTenantId: record.primaryTenantId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    suspendedAt: record.suspendedAt,
    archivedAt: record.archivedAt,
    billing: record.billing,
  };
}

export function adminPlanView() {
  return listHostedPlans().map((plan) => ({
    id: plan.id,
    displayName: plan.displayName,
    description: plan.description,
    defaultStripeTrialDays: resolvePlanStripeTrialDays(plan.id).trialDays,
    defaultMonthlyRunQuota: plan.defaultMonthlyRunQuota,
    defaultPipelineRequestsPerWindow: resolvePlanRateLimit(plan.id).requestsPerWindow,
    defaultAsyncPendingJobsPerTenant: resolvePlanAsyncQueue(plan.id).pendingJobsPerTenant,
    defaultAsyncActiveJobsPerTenant: resolvePlanAsyncExecution(plan.id).activeJobsPerTenant,
    defaultAsyncDispatchWeight: resolvePlanAsyncDispatch(plan.id).dispatchWeight,
    defaultAsyncDispatchWindowMs: resolvePlanAsyncDispatch(plan.id).dispatchWindowMs,
    stripePriceConfigured: resolvePlanStripePrice(plan.id).configured,
    intendedFor: plan.intendedFor,
    defaultForHostedProvisioning: plan.defaultForHostedProvisioning,
  }));
}

export function billingEntitlementView(record: HostedBillingEntitlementRecord) {
  return {
    id: record.id,
    accountId: record.accountId,
    tenantId: record.tenantId,
    provider: record.provider,
    status: record.status,
    accessEnabled: record.accessEnabled,
    effectivePlanId: record.effectivePlanId,
    requestedPlanId: record.requestedPlanId,
    monthlyRunQuota: record.monthlyRunQuota,
    requestsPerWindow: record.requestsPerWindow,
    asyncPendingJobsPerTenant: record.asyncPendingJobsPerTenant,
    accountStatus: record.accountStatus,
    stripeCustomerId: record.stripeCustomerId,
    stripeSubscriptionId: record.stripeSubscriptionId,
    stripeSubscriptionStatus: record.stripeSubscriptionStatus,
    stripePriceId: record.stripePriceId,
    stripeCheckoutSessionId: record.stripeCheckoutSessionId,
    stripeInvoiceId: record.stripeInvoiceId,
    stripeInvoiceStatus: record.stripeInvoiceStatus,
    stripeEntitlementLookupKeys: record.stripeEntitlementLookupKeys,
    stripeEntitlementFeatureIds: record.stripeEntitlementFeatureIds,
    stripeEntitlementSummaryUpdatedAt: record.stripeEntitlementSummaryUpdatedAt,
    lastEventId: record.lastEventId,
    lastEventType: record.lastEventType,
    lastEventAt: record.lastEventAt,
    effectiveAt: record.effectiveAt,
    delinquentSince: record.delinquentSince,
    reason: record.reason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function adminAuditView(record: AdminAuditRecord) {
  return {
    id: record.id,
    occurredAt: record.occurredAt,
    actorType: record.actorType,
    actorLabel: record.actorLabel,
    action: record.action,
    routeId: record.routeId,
    accountId: record.accountId,
    tenantId: record.tenantId,
    tenantKeyId: record.tenantKeyId,
    planId: record.planId,
    monthlyRunQuota: record.monthlyRunQuota,
    idempotencyKey: record.idempotencyKey,
    requestHash: record.requestHash,
    metadata: record.metadata,
    previousHash: record.previousHash,
    eventHash: record.eventHash,
  };
}

export function billingEventView(record: BillingEventRecord) {
  return {
    id: record.id,
    provider: record.provider,
    source: record.source,
    providerEventId: record.providerEventId,
    eventType: record.eventType,
    payloadHash: record.payloadHash,
    outcome: record.outcome,
    reason: record.reason,
    accountId: record.accountId,
    tenantId: record.tenantId,
    stripeCheckoutSessionId: record.stripeCheckoutSessionId,
    stripeCustomerId: record.stripeCustomerId,
    stripeSubscriptionId: record.stripeSubscriptionId,
    stripePriceId: record.stripePriceId,
    stripeInvoiceId: record.stripeInvoiceId,
    stripeInvoiceStatus: record.stripeInvoiceStatus,
    stripeInvoiceCurrency: record.stripeInvoiceCurrency,
    stripeInvoiceAmountPaid: record.stripeInvoiceAmountPaid,
    stripeInvoiceAmountDue: record.stripeInvoiceAmountDue,
    accountStatusBefore: record.accountStatusBefore,
    accountStatusAfter: record.accountStatusAfter,
    billingStatusBefore: record.billingStatusBefore,
    billingStatusAfter: record.billingStatusAfter,
    mappedPlanId: record.mappedPlanId,
    receivedAt: record.receivedAt,
    processedAt: record.processedAt,
    metadata: record.metadata,
  };
}
