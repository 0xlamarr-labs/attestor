/**
 * Attestor Usage Meter — Hosted API First Slice
 *
 * Tracks billable pipeline run usage per tenant in memory.
 *
 * BOUNDARY:
 * - Monthly counters keyed by tenantId
 * - In-memory only (resets on restart)
 * - No persistent billing ledger yet
 * - Intended for first hosted-product shell and quota enforcement
 */

export interface UsageContext {
  tenantId: string;
  planId: string;
  meter: 'monthly_pipeline_runs';
  period: string;
  used: number;
  quota: number | null;
  remaining: number | null;
  enforced: boolean;
}

const monthlyRuns = new Map<string, number>();

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function usageKey(tenantId: string, period: string): string {
  return `${tenantId}:${period}`;
}

export function getUsageContext(
  tenantId: string,
  planId: string | null | undefined,
  quota: number | null | undefined,
): UsageContext {
  const period = currentPeriod();
  const used = monthlyRuns.get(usageKey(tenantId, period)) ?? 0;
  const resolvedQuota = typeof quota === 'number' && quota >= 0 ? quota : null;
  return {
    tenantId,
    planId: planId ?? 'community',
    meter: 'monthly_pipeline_runs',
    period,
    used,
    quota: resolvedQuota,
    remaining: resolvedQuota === null ? null : Math.max(0, resolvedQuota - used),
    enforced: resolvedQuota !== null,
  };
}

export function canConsumePipelineRun(
  tenantId: string,
  planId: string | null | undefined,
  quota: number | null | undefined,
): { allowed: boolean; usage: UsageContext } {
  const usage = getUsageContext(tenantId, planId, quota);
  if (!usage.enforced) return { allowed: true, usage };
  return { allowed: usage.used < (usage.quota ?? 0), usage };
}

export function consumePipelineRun(
  tenantId: string,
  planId: string | null | undefined,
  quota: number | null | undefined,
): UsageContext {
  const period = currentPeriod();
  const key = usageKey(tenantId, period);
  const used = (monthlyRuns.get(key) ?? 0) + 1;
  monthlyRuns.set(key, used);
  return getUsageContext(tenantId, planId, quota);
}

export function resetUsageMeter(): void {
  monthlyRuns.clear();
}
