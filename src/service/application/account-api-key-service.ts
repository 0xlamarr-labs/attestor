import type { HostedAccountRecord } from '../account-store.js';
import type { HostedBillingEntitlementRecord } from '../billing-entitlement-store.js';
import type * as ControlPlaneStore from '../control-plane-store.js';
import type * as PlanCatalog from '../plan-catalog.js';
import { TenantKeyStoreError, type TenantKeyRecord } from '../tenant-key-store.js';

interface SyncHostedBillingEntitlementOptions {
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
}

export interface AccountApiKeyListResult {
  keys: TenantKeyRecord[];
  defaults: {
    maxActiveKeysPerTenant: number;
  };
}

export interface AccountApiKeyIssueResult {
  record: TenantKeyRecord;
  apiKey: string;
  entitlement: HostedBillingEntitlementRecord | null;
}

export interface AccountApiKeyRotateResult {
  previousRecord: TenantKeyRecord;
  record: TenantKeyRecord;
  apiKey: string;
  entitlement: HostedBillingEntitlementRecord | null;
}

export interface AccountApiKeyStatusResult {
  record: TenantKeyRecord;
  entitlement: HostedBillingEntitlementRecord | null;
}

export interface AccountApiKeyRevokeResult {
  record: TenantKeyRecord;
  entitlement: HostedBillingEntitlementRecord | null;
}

export interface AccountApiKeyService {
  list(accountId: string): Promise<AccountApiKeyListResult>;
  issue(accountId: string): Promise<AccountApiKeyIssueResult>;
  rotate(accountId: string, keyId: string): Promise<AccountApiKeyRotateResult>;
  setStatus(accountId: string, keyId: string, status: 'active' | 'inactive'): Promise<AccountApiKeyStatusResult>;
  revoke(accountId: string, keyId: string): Promise<AccountApiKeyRevokeResult>;
}

export interface AccountApiKeyServiceDeps {
  findHostedAccountByIdState: typeof ControlPlaneStore.findHostedAccountByIdState;
  findTenantRecordByTenantIdState: typeof ControlPlaneStore.findTenantRecordByTenantIdState;
  listTenantKeyRecordsState: typeof ControlPlaneStore.listTenantKeyRecordsState;
  tenantKeyStorePolicy(): { maxActiveKeysPerTenant: number };
  SELF_HOST_PLAN_ID: typeof PlanCatalog.SELF_HOST_PLAN_ID;
  issueTenantApiKeyState: typeof ControlPlaneStore.issueTenantApiKeyState;
  rotateTenantApiKeyState: typeof ControlPlaneStore.rotateTenantApiKeyState;
  setTenantApiKeyStatusState: typeof ControlPlaneStore.setTenantApiKeyStatusState;
  revokeTenantApiKeyState: typeof ControlPlaneStore.revokeTenantApiKeyState;
  syncHostedBillingEntitlementForTenant(
    tenantId: string,
    options?: SyncHostedBillingEntitlementOptions,
  ): Promise<HostedBillingEntitlementRecord | null>;
  now(): string;
}

export class AccountApiKeyServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'AccountApiKeyServiceError';
  }
}

function mapTenantKeyStoreError(error: unknown): AccountApiKeyServiceError | null {
  if (error instanceof AccountApiKeyServiceError) return error;
  if (!(error instanceof TenantKeyStoreError)) return null;
  return new AccountApiKeyServiceError(error.code === 'NOT_FOUND' ? 404 : 409, error.message);
}

function throwMappedError(error: unknown): never {
  const mapped = mapTenantKeyStoreError(error);
  if (mapped) throw mapped;
  if (error instanceof Error) {
    throw new AccountApiKeyServiceError(400, error.message);
  }
  throw error;
}

async function requireHostedAccount(deps: AccountApiKeyServiceDeps, accountId: string): Promise<HostedAccountRecord> {
  const account = await deps.findHostedAccountByIdState(accountId);
  if (!account) {
    throw new AccountApiKeyServiceError(404, `Hosted account '${accountId}' was not found.`);
  }
  return account;
}

async function listAccountTenantKeys(
  deps: AccountApiKeyServiceDeps,
  account: HostedAccountRecord,
): Promise<TenantKeyRecord[]> {
  const keys = await deps.listTenantKeyRecordsState();
  return keys.records.filter((entry) => entry.tenantId === account.primaryTenantId);
}

async function requireAccountTenantKey(
  deps: AccountApiKeyServiceDeps,
  account: HostedAccountRecord,
  keyId: string,
): Promise<TenantKeyRecord> {
  const keys = await listAccountTenantKeys(deps, account);
  const currentKey = keys.find((entry) => entry.id === keyId) ?? null;
  if (!currentKey) {
    throw new AccountApiKeyServiceError(404, `API key '${keyId}' was not found.`);
  }
  return currentKey;
}

async function syncEntitlement(
  deps: AccountApiKeyServiceDeps,
  tenantId: string,
  eventType: string,
): Promise<HostedBillingEntitlementRecord | null> {
  return deps.syncHostedBillingEntitlementForTenant(tenantId, {
    lastEventType: eventType,
    lastEventAt: deps.now(),
  });
}

export function createAccountApiKeyService(deps: AccountApiKeyServiceDeps): AccountApiKeyService {
  return {
    async list(accountId) {
      const account = await requireHostedAccount(deps, accountId);
      return {
        keys: await listAccountTenantKeys(deps, account),
        defaults: {
          maxActiveKeysPerTenant: deps.tenantKeyStorePolicy().maxActiveKeysPerTenant,
        },
      };
    },

    async issue(accountId) {
      const account = await requireHostedAccount(deps, accountId);
      const tenantRecord = await deps.findTenantRecordByTenantIdState(account.primaryTenantId);
      const planId = tenantRecord?.planId ?? deps.SELF_HOST_PLAN_ID;
      const monthlyRunQuota = tenantRecord?.monthlyRunQuota ?? null;
      const tenantName = tenantRecord?.tenantName ?? account.accountName;

      try {
        const issued = await deps.issueTenantApiKeyState({
          tenantId: account.primaryTenantId,
          tenantName,
          planId,
          monthlyRunQuota,
        });
        const entitlement = await syncEntitlement(deps, account.primaryTenantId, 'account.api_keys.issue');
        return {
          record: issued.record,
          apiKey: issued.apiKey,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async rotate(accountId, keyId) {
      const account = await requireHostedAccount(deps, accountId);
      const currentKey = await requireAccountTenantKey(deps, account, keyId);
      try {
        const rotated = await deps.rotateTenantApiKeyState(currentKey.id);
        const entitlement = await syncEntitlement(deps, account.primaryTenantId, 'account.api_keys.rotate');
        return {
          previousRecord: rotated.previousRecord,
          record: rotated.record,
          apiKey: rotated.apiKey,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async setStatus(accountId, keyId, status) {
      const account = await requireHostedAccount(deps, accountId);
      const currentKey = await requireAccountTenantKey(deps, account, keyId);
      try {
        const result = await deps.setTenantApiKeyStatusState(currentKey.id, status);
        const entitlement = await syncEntitlement(
          deps,
          account.primaryTenantId,
          status === 'active' ? 'account.api_keys.reactivate' : 'account.api_keys.deactivate',
        );
        return {
          record: result.record,
          entitlement,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async revoke(accountId, keyId) {
      const account = await requireHostedAccount(deps, accountId);
      const currentKey = await requireAccountTenantKey(deps, account, keyId);
      try {
        const result = await deps.revokeTenantApiKeyState(currentKey.id);
        if (!result.record) {
          throw new AccountApiKeyServiceError(404, `API key '${keyId}' was not found.`);
        }
        const entitlement = await syncEntitlement(deps, account.primaryTenantId, 'account.api_keys.revoke');
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
