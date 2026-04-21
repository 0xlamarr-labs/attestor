import type { TenantContext } from '../tenant-isolation.js';
import type { UsageContext } from '../usage-meter.js';

export type PipelineUsageTenant = Pick<
  TenantContext,
  'tenantId' | 'planId' | 'monthlyRunQuota'
>;

export interface PipelineUsageDecision {
  allowed: boolean;
  usage: UsageContext;
}

export interface PipelineUsageService {
  check(tenant: PipelineUsageTenant): Promise<PipelineUsageDecision>;
  consume(tenant: PipelineUsageTenant): Promise<UsageContext>;
}

export interface PipelineUsageServiceDeps {
  checkQuota(
    tenantId: string,
    planId: string | null | undefined,
    quota: number | null | undefined,
  ): Promise<PipelineUsageDecision>;
  consumeRun(
    tenantId: string,
    planId: string | null | undefined,
    quota: number | null | undefined,
  ): Promise<UsageContext>;
}

export function createPipelineUsageService(deps: PipelineUsageServiceDeps): PipelineUsageService {
  return {
    check(tenant) {
      return deps.checkQuota(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    },

    consume(tenant) {
      return deps.consumeRun(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    },
  };
}
