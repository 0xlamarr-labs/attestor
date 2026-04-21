import {
  AccountStoreError,
  type HostedAccountRecord,
  type HostedAccountStatus,
  type StripeSubscriptionStatus,
} from '../account-store.js';
import type { HostedBillingEntitlementRecord } from '../billing-entitlement-store.js';
import type * as ControlPlaneStore from '../control-plane-store.js';
import type * as PlanCatalog from '../plan-catalog.js';
import { SecretEnvelopeError } from '../secret-envelope.js';
import { StripeBillingError } from '../stripe-billing.js';
import { TenantKeyStoreError, type TenantKeyRecord } from '../tenant-key-store.js';

interface SyncHostedBillingEntitlementOptions {
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
}

export interface AdminControlBillingEventInput {
  idempotencyKey: string | null;
  routeId: string;
  occurredAt?: string;
}

export interface AdminControlProvisionAccountInput {
  accountName: string;
  contactEmail: string;
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
}

export interface AdminControlProvisionAccountResult {
  account: HostedAccountRecord;
  initialKey: TenantKeyRecord;
  apiKey: string;
  entitlement: HostedBillingEntitlementRecord;
}

export interface AdminControlAttachStripeBillingInput {
  accountId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: unknown;
  stripePriceId: string | null;
}

export interface AdminControlAttachStripeBillingResult {
  record: HostedAccountRecord;
  entitlement: HostedBillingEntitlementRecord;
}

export interface AdminControlSetHostedAccountStatusInput {
  accountId: string;
  status: HostedAccountStatus;
}

export interface AdminControlSetHostedAccountStatusResult {
  record: HostedAccountRecord;
  revokedSessionCount: number;
  entitlement: HostedBillingEntitlementRecord;
}

export interface AdminControlIssueTenantKeyInput {
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
  billingEvent: AdminControlBillingEventInput;
}

export interface AdminControlIssueTenantKeyResult {
  record: TenantKeyRecord;
  apiKey: string;
  entitlement: HostedBillingEntitlementRecord | null;
}

export interface AdminControlRotateTenantKeyInput {
  id: string;
  planId: string | null;
  monthlyRunQuota: number | null;
  billingEvent: AdminControlBillingEventInput;
}

export interface AdminControlRotateTenantKeyResult {
  previousRecord: TenantKeyRecord;
  record: TenantKeyRecord;
  apiKey: string;
  entitlement: HostedBillingEntitlementRecord | null;
}

export interface AdminControlSetTenantKeyStatusInput {
  id: string;
  status: 'active' | 'inactive';
  billingEvent: AdminControlBillingEventInput;
}

export interface AdminControlSetTenantKeyStatusResult {
  record: TenantKeyRecord;
  entitlement: HostedBillingEntitlementRecord | null;
}

export interface AdminControlRecoverTenantKeyInput {
  id: string;
}

export interface AdminControlRecoverTenantKeyResult {
  record: TenantKeyRecord;
  apiKey: string;
}

export interface AdminControlRevokeTenantKeyInput {
  id: string;
  billingEvent: AdminControlBillingEventInput;
}

export interface AdminControlRevokeTenantKeyResult {
  record: TenantKeyRecord;
  entitlement: HostedBillingEntitlementRecord | null;
}

export interface AdminControlService {
  provisionHostedAccount(input: AdminControlProvisionAccountInput): Promise<AdminControlProvisionAccountResult>;
  attachStripeBilling(input: AdminControlAttachStripeBillingInput): Promise<AdminControlAttachStripeBillingResult>;
  setHostedAccountStatus(input: AdminControlSetHostedAccountStatusInput): Promise<AdminControlSetHostedAccountStatusResult>;
  issueTenantApiKey(input: AdminControlIssueTenantKeyInput): Promise<AdminControlIssueTenantKeyResult>;
  rotateTenantApiKey(input: AdminControlRotateTenantKeyInput): Promise<AdminControlRotateTenantKeyResult>;
  setTenantApiKeyStatus(input: AdminControlSetTenantKeyStatusInput): Promise<AdminControlSetTenantKeyStatusResult>;
  recoverTenantApiKey(input: AdminControlRecoverTenantKeyInput): Promise<AdminControlRecoverTenantKeyResult>;
  revokeTenantApiKey(input: AdminControlRevokeTenantKeyInput): Promise<AdminControlRevokeTenantKeyResult>;
}

export interface AdminControlServiceDeps {
  resolvePlanSpec: typeof PlanCatalog.resolvePlanSpec;
  DEFAULT_HOSTED_PLAN_ID: typeof PlanCatalog.DEFAULT_HOSTED_PLAN_ID;
  provisionHostedAccountState: typeof ControlPlaneStore.provisionHostedAccountState;
  attachStripeBillingToAccountState: typeof ControlPlaneStore.attachStripeBillingToAccountState;
  setHostedAccountStatusState: typeof ControlPlaneStore.setHostedAccountStatusState;
  revokeAccountSessionsForAccountState: typeof ControlPlaneStore.revokeAccountSessionsForAccountState;
  issueTenantApiKeyState: typeof ControlPlaneStore.issueTenantApiKeyState;
  rotateTenantApiKeyState: typeof ControlPlaneStore.rotateTenantApiKeyState;
  setTenantApiKeyStatusState: typeof ControlPlaneStore.setTenantApiKeyStatusState;
  recoverTenantApiKeyState: typeof ControlPlaneStore.recoverTenantApiKeyState;
  revokeTenantApiKeyState: typeof ControlPlaneStore.revokeTenantApiKeyState;
  syncHostedBillingEntitlement(
    account: HostedAccountRecord,
    options?: SyncHostedBillingEntitlementOptions,
  ): Promise<HostedBillingEntitlementRecord>;
  syncHostedBillingEntitlementForTenant(
    tenantId: string,
    options?: SyncHostedBillingEntitlementOptions,
  ): Promise<HostedBillingEntitlementRecord | null>;
  now(): string;
}

export class AdminControlServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'AdminControlServiceError';
  }
}

function mapControlError(error: unknown): AdminControlServiceError | null {
  if (error instanceof AdminControlServiceError) return error;
  if (error instanceof AccountStoreError) {
    return new AdminControlServiceError(error.code === 'NOT_FOUND' ? 404 : 409, error.message);
  }
  if (error instanceof TenantKeyStoreError) {
    return new AdminControlServiceError(error.code === 'NOT_FOUND' ? 404 : 409, error.message);
  }
  if (error instanceof SecretEnvelopeError) {
    return new AdminControlServiceError(error.code === 'DISABLED' ? 409 : 503, error.message);
  }
  if (error instanceof StripeBillingError) {
    if (error.code === 'DISABLED') return new AdminControlServiceError(503, error.message);
    if (error.code === 'NO_CUSTOMER') return new AdminControlServiceError(409, error.message);
    return new AdminControlServiceError(400, error.message);
  }
  return null;
}

function throwMappedError(error: unknown): never {
  const mapped = mapControlError(error);
  if (mapped) throw mapped;
  throw error;
}

function resolveHostedPlan(
  deps: Pick<AdminControlServiceDeps, 'DEFAULT_HOSTED_PLAN_ID' | 'resolvePlanSpec'>,
  options: { planId: string | null; monthlyRunQuota: number | null },
): PlanCatalog.ResolvedPlanSpec {
  try {
    return deps.resolvePlanSpec({
      planId: options.planId,
      monthlyRunQuota: options.monthlyRunQuota,
      defaultPlanId: deps.DEFAULT_HOSTED_PLAN_ID,
    });
  } catch (error) {
    throw new AdminControlServiceError(400, error instanceof Error ? error.message : String(error));
  }
}

function parseStripeSubscriptionStatus(raw: unknown): StripeSubscriptionStatus {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = raw.trim();
  switch (value) {
    case 'trialing':
    case 'active':
    case 'incomplete':
    case 'incomplete_expired':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
    case 'paused':
      return value;
    default:
      throw new AdminControlServiceError(
        400,
        'stripeSubscriptionStatus must be one of: trialing, active, incomplete, incomplete_expired, past_due, canceled, unpaid, paused.',
      );
  }
}

function billingEventOptions(deps: Pick<AdminControlServiceDeps, 'now'>, input: AdminControlBillingEventInput):
  SyncHostedBillingEntitlementOptions {
  return {
    lastEventId: input.idempotencyKey,
    lastEventType: input.routeId,
    lastEventAt: input.occurredAt ?? deps.now(),
  };
}

async function syncTenantEntitlement(
  deps: AdminControlServiceDeps,
  tenantId: string,
  billingEvent: AdminControlBillingEventInput,
): Promise<HostedBillingEntitlementRecord | null> {
  return deps.syncHostedBillingEntitlementForTenant(tenantId, billingEventOptions(deps, billingEvent));
}

export function createAdminControlService(deps: AdminControlServiceDeps): AdminControlService {
  return {
    async provisionHostedAccount(input) {
      const resolvedPlan = resolveHostedPlan(deps, {
        planId: input.planId,
        monthlyRunQuota: input.monthlyRunQuota,
      });
      try {
        const provisioned = await deps.provisionHostedAccountState({
          account: {
            accountName: input.accountName,
            contactEmail: input.contactEmail,
            primaryTenantId: input.tenantId,
          },
          key: {
            tenantId: input.tenantId,
            tenantName: input.tenantName,
            planId: resolvedPlan.planId,
            monthlyRunQuota: resolvedPlan.monthlyRunQuota,
          },
        });
        const entitlement = await deps.syncHostedBillingEntitlement(provisioned.account);
        return {
          account: provisioned.account,
          initialKey: provisioned.initialKey,
          apiKey: provisioned.apiKey,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async attachStripeBilling(input) {
      const stripeSubscriptionStatus = parseStripeSubscriptionStatus(input.stripeSubscriptionStatus);
      try {
        const attached = await deps.attachStripeBillingToAccountState(input.accountId, {
          stripeCustomerId: input.stripeCustomerId,
          stripeSubscriptionId: input.stripeSubscriptionId,
          stripeSubscriptionStatus,
          stripePriceId: input.stripePriceId,
        });
        const entitlement = await deps.syncHostedBillingEntitlement(attached.record);
        return {
          record: attached.record,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async setHostedAccountStatus(input) {
      try {
        const result = await deps.setHostedAccountStatusState(input.accountId, input.status);
        const revokedSessions = input.status === 'suspended' || input.status === 'archived'
          ? await deps.revokeAccountSessionsForAccountState(result.record.id)
          : { revokedCount: 0 };
        const entitlement = await deps.syncHostedBillingEntitlement(result.record);
        return {
          record: result.record,
          revokedSessionCount: revokedSessions.revokedCount,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async issueTenantApiKey(input) {
      const resolvedPlan = resolveHostedPlan(deps, {
        planId: input.planId,
        monthlyRunQuota: input.monthlyRunQuota,
      });
      try {
        const issued = await deps.issueTenantApiKeyState({
          tenantId: input.tenantId,
          tenantName: input.tenantName,
          planId: resolvedPlan.planId,
          monthlyRunQuota: resolvedPlan.monthlyRunQuota,
        });
        const entitlement = await syncTenantEntitlement(deps, issued.record.tenantId, input.billingEvent);
        return {
          record: issued.record,
          apiKey: issued.apiKey,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async rotateTenantApiKey(input) {
      const resolvedPlan = input.planId
        ? resolveHostedPlan(deps, {
          planId: input.planId,
          monthlyRunQuota: input.monthlyRunQuota,
        })
        : null;
      try {
        const rotated = await deps.rotateTenantApiKeyState(input.id, {
          planId: resolvedPlan?.planId ?? input.planId,
          monthlyRunQuota: resolvedPlan?.monthlyRunQuota ?? input.monthlyRunQuota,
        });
        const entitlement = await syncTenantEntitlement(deps, rotated.record.tenantId, input.billingEvent);
        return {
          previousRecord: rotated.previousRecord,
          record: rotated.record,
          apiKey: rotated.apiKey,
          entitlement,
        };
      } catch (error) {
        if (error instanceof Error && !mapControlError(error)) {
          throw new AdminControlServiceError(400, error.message);
        }
        throwMappedError(error);
      }
    },

    async setTenantApiKeyStatus(input) {
      try {
        const result = await deps.setTenantApiKeyStatusState(input.id, input.status);
        const entitlement = await syncTenantEntitlement(deps, result.record.tenantId, input.billingEvent);
        return {
          record: result.record,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async recoverTenantApiKey(input) {
      try {
        const recovered = await deps.recoverTenantApiKeyState(input.id);
        return {
          record: recovered.record,
          apiKey: recovered.apiKey,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async revokeTenantApiKey(input) {
      try {
        const result = await deps.revokeTenantApiKeyState(input.id);
        if (!result.record) {
          throw new AdminControlServiceError(404, 'Tenant key record not found');
        }
        const entitlement = await syncTenantEntitlement(deps, result.record.tenantId, input.billingEvent);
        return {
          record: result.record,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },
  };
}
