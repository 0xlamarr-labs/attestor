import type { AdminAuditRecord } from '../admin-audit-log.js';
import type { AsyncDeadLetterRecord } from '../async-dead-letter-store.js';
import type { HostedAccountRecord } from '../account-store.js';
import type { HostedBillingEntitlementRecord } from '../billing-entitlement-store.js';
import type * as ControlPlaneStore from '../control-plane-store.js';
import type { HostedEmailDeliverySummaryRecord } from '../email-delivery-event-store.js';
import type { TenantKeyRecord } from '../tenant-key-store.js';

export interface AdminQueryListResult<T> {
  records: T[];
  path: string | null;
}

export interface AdminAuditQueryResult {
  records: AdminAuditRecord[];
  path: string | null;
  chainIntact: boolean;
  latestHash: string | null;
}

export interface AdminUsageRecord {
  tenantId: string;
  tenantName: string | null;
  accountId: string | null;
  accountName: string | null;
  planId: string | null;
  monthlyRunQuota: number | null;
  meter: 'monthly_pipeline_runs';
  period: string;
  used: number;
  remaining: number | null;
  enforced: boolean;
  updatedAt: string;
}

export interface AdminQueryService {
  listTenantKeys(): Promise<AdminQueryListResult<TenantKeyRecord>>;
  listHostedAccounts(): Promise<AdminQueryListResult<HostedAccountRecord>>;
  findHostedAccountById(id: string): Promise<HostedAccountRecord | null>;
  listAdminAuditRecords(
    filters: Parameters<typeof ControlPlaneStore.listAdminAuditRecordsState>[0],
  ): Promise<AdminAuditQueryResult>;
  listHostedBillingEntitlements(
    filters: Parameters<typeof ControlPlaneStore.listHostedBillingEntitlementsState>[0],
  ): Promise<AdminQueryListResult<HostedBillingEntitlementRecord>>;
  listHostedEmailDeliveries(
    filters: Parameters<typeof ControlPlaneStore.listHostedEmailDeliveriesState>[0],
  ): Promise<AdminQueryListResult<HostedEmailDeliverySummaryRecord>>;
  listAsyncDeadLetters(
    filters: Parameters<typeof ControlPlaneStore.listAsyncDeadLetterRecordsState>[0],
  ): Promise<AdminQueryListResult<AsyncDeadLetterRecord>>;
  listUsage(filters: Parameters<typeof ControlPlaneStore.queryUsageLedgerState>[0]): Promise<AdminUsageRecord[]>;
}

export interface AdminQueryServiceDeps {
  listTenantKeyRecordsState: typeof ControlPlaneStore.listTenantKeyRecordsState;
  listHostedAccountsState: typeof ControlPlaneStore.listHostedAccountsState;
  findHostedAccountByIdState: typeof ControlPlaneStore.findHostedAccountByIdState;
  listAdminAuditRecordsState: typeof ControlPlaneStore.listAdminAuditRecordsState;
  listHostedBillingEntitlementsState: typeof ControlPlaneStore.listHostedBillingEntitlementsState;
  listHostedEmailDeliveriesState: typeof ControlPlaneStore.listHostedEmailDeliveriesState;
  listAsyncDeadLetterRecordsState: typeof ControlPlaneStore.listAsyncDeadLetterRecordsState;
  queryUsageLedgerState: typeof ControlPlaneStore.queryUsageLedgerState;
  findTenantRecordByTenantIdState: typeof ControlPlaneStore.findTenantRecordByTenantIdState;
  findHostedAccountByTenantIdState: typeof ControlPlaneStore.findHostedAccountByTenantIdState;
}

export function createAdminQueryService(deps: AdminQueryServiceDeps): AdminQueryService {
  return {
    listTenantKeys() {
      return deps.listTenantKeyRecordsState();
    },

    listHostedAccounts() {
      return deps.listHostedAccountsState();
    },

    findHostedAccountById(id) {
      return deps.findHostedAccountByIdState(id);
    },

    listAdminAuditRecords(filters) {
      return deps.listAdminAuditRecordsState(filters);
    },

    listHostedBillingEntitlements(filters) {
      return deps.listHostedBillingEntitlementsState(filters);
    },

    listHostedEmailDeliveries(filters) {
      return deps.listHostedEmailDeliveriesState(filters);
    },

    listAsyncDeadLetters(filters) {
      return deps.listAsyncDeadLetterRecordsState(filters);
    },

    async listUsage(filters) {
      const usageRecords = await deps.queryUsageLedgerState(filters);
      return Promise.all(usageRecords.map(async (entry) => {
        const tenantRecord = await deps.findTenantRecordByTenantIdState(entry.tenantId);
        const accountRecord = await deps.findHostedAccountByTenantIdState(entry.tenantId);
        const quota = tenantRecord?.monthlyRunQuota ?? null;
        return {
          tenantId: entry.tenantId,
          tenantName: tenantRecord?.tenantName ?? null,
          accountId: accountRecord?.id ?? null,
          accountName: accountRecord?.accountName ?? null,
          planId: tenantRecord?.planId ?? null,
          monthlyRunQuota: quota,
          meter: 'monthly_pipeline_runs' as const,
          period: entry.period,
          used: entry.used,
          remaining: quota === null ? null : Math.max(0, quota - entry.used),
          enforced: quota !== null,
          updatedAt: entry.updatedAt,
        };
      }));
    },
  };
}
