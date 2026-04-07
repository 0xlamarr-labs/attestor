/**
 * Tenant Rate Limiter - Hosted API abuse and cost guard first slice.
 *
 * Enforces a small, plan-aware request window for expensive pipeline routes.
 *
 * BOUNDARY:
 * - In-memory single-node limiter only
 * - Tenant-scoped (not IP-scoped, not globally distributed)
 * - Intended to protect expensive pipeline execution paths
 * - Not a centralized multi-node edge throttle or WAF replacement
 */

import { resolvePlanRateLimit } from './plan-catalog.js';

export interface TenantRateLimitContext {
  tenantId: string;
  planId: string;
  scope: 'pipeline_requests';
  windowSeconds: number;
  requestsPerWindow: number | null;
  used: number;
  remaining: number | null;
  enforced: boolean;
  resetAt: string;
  retryAfterSeconds: number;
}

interface RateLimitBucket {
  windowStartedAtMs: number;
  used: number;
}

const buckets = new Map<string, RateLimitBucket>();

function bucketKey(tenantId: string, scope: TenantRateLimitContext['scope']): string {
  return `${scope}:${tenantId}`;
}

function nowMs(): number {
  return Date.now();
}

function bucketFor(tenantId: string, scope: TenantRateLimitContext['scope'], windowSeconds: number): RateLimitBucket {
  const key = bucketKey(tenantId, scope);
  const current = buckets.get(key);
  const currentNow = nowMs();
  if (!current || currentNow >= current.windowStartedAtMs + (windowSeconds * 1000)) {
    const fresh = { windowStartedAtMs: currentNow, used: 0 };
    buckets.set(key, fresh);
    return fresh;
  }
  return current;
}

function buildContext(
  tenantId: string,
  planId: string | null | undefined,
  scope: TenantRateLimitContext['scope'],
): TenantRateLimitContext {
  const spec = resolvePlanRateLimit(planId);
  const bucket = bucketFor(tenantId, scope, spec.windowSeconds);
  const resetAtMs = bucket.windowStartedAtMs + (spec.windowSeconds * 1000);
  const remaining = spec.requestsPerWindow === null ? null : Math.max(0, spec.requestsPerWindow - bucket.used);
  const retryAfterSeconds = Math.max(0, Math.ceil((resetAtMs - nowMs()) / 1000));

  return {
    tenantId,
    planId: spec.planId,
    scope,
    windowSeconds: spec.windowSeconds,
    requestsPerWindow: spec.requestsPerWindow,
    used: bucket.used,
    remaining,
    enforced: spec.enforced,
    resetAt: new Date(resetAtMs).toISOString(),
    retryAfterSeconds,
  };
}

export function getTenantPipelineRateLimit(
  tenantId: string,
  planId: string | null | undefined,
): TenantRateLimitContext {
  return buildContext(tenantId, planId, 'pipeline_requests');
}

export function canConsumeTenantPipelineRequest(
  tenantId: string,
  planId: string | null | undefined,
): { allowed: boolean; rateLimit: TenantRateLimitContext } {
  const rateLimit = getTenantPipelineRateLimit(tenantId, planId);
  if (!rateLimit.enforced) return { allowed: true, rateLimit };
  return {
    allowed: rateLimit.used < (rateLimit.requestsPerWindow ?? 0),
    rateLimit,
  };
}

export function consumeTenantPipelineRequest(
  tenantId: string,
  planId: string | null | undefined,
): TenantRateLimitContext {
  const spec = resolvePlanRateLimit(planId);
  if (!spec.enforced) {
    return getTenantPipelineRateLimit(tenantId, planId);
  }
  const bucket = bucketFor(tenantId, 'pipeline_requests', spec.windowSeconds);
  bucket.used += 1;
  return getTenantPipelineRateLimit(tenantId, planId);
}

export function resetTenantRateLimiterForTests(): void {
  buckets.clear();
}
