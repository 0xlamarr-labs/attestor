/**
 * Tenant Rate Limiter - Hosted API abuse and cost guard.
 *
 * Enforces a small, plan-aware request window for expensive pipeline routes.
 *
 * BACKENDS:
 * - Memory: single-node fallback for local/dev mode
 * - Redis: fixed-window shared limiter for multi-instance/runtime parity
 *
 * BOUNDARY:
 * - Tenant-scoped (not IP-scoped, not globally distributed edge/WAF logic)
 * - Intended to protect expensive pipeline execution paths
 * - Redis mode provides shared process/node coordination, not a CDN/WAF substitute
 */

import IORedis from 'ioredis';
import { resolvePlanRateLimit } from './plan-catalog.js';

export interface TenantRateLimitContext {
  tenantId: string;
  planId: string;
  scope: 'pipeline_requests';
  backend: 'memory' | 'redis';
  windowSeconds: number;
  requestsPerWindow: number | null;
  used: number;
  remaining: number | null;
  enforced: boolean;
  resetAt: string;
  retryAfterSeconds: number;
}

export interface TenantRateLimitDecision {
  allowed: boolean;
  rateLimit: TenantRateLimitContext;
}

interface RateLimitBucket {
  windowStartedAtMs: number;
  used: number;
}

interface RedisWindowState {
  key: string;
  windowStartedAtMs: number;
  windowEndsAtMs: number;
}

const buckets = new Map<string, RateLimitBucket>();
const REDIS_KEY_PREFIX = 'attestor:rate-limit';
const REDIS_CONSUME_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current and tonumber(current) >= tonumber(ARGV[1]) then
  return {0, tonumber(current)}
end
local next = redis.call('INCR', KEYS[1])
if next == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return {1, tonumber(next)}
`;

let configuredBackend: 'memory' | 'redis' = 'memory';
let configuredRedisUrl: string | null = null;
let configuredRedisMode: string | null = null;
let redisClient: IORedis | null = null;
let redisConnectPromise: Promise<IORedis | null> | null = null;

function bucketKey(tenantId: string, scope: TenantRateLimitContext['scope']): string {
  return `${scope}:${tenantId}`;
}

function nowMs(): number {
  return Date.now();
}

function currentRedisWindow(tenantId: string, scope: TenantRateLimitContext['scope'], windowSeconds: number, currentNow: number): RedisWindowState {
  const windowMs = windowSeconds * 1000;
  const windowStartedAtMs = Math.floor(currentNow / windowMs) * windowMs;
  const windowEndsAtMs = windowStartedAtMs + windowMs;
  return {
    key: `${REDIS_KEY_PREFIX}:${scope}:${tenantId}:${windowStartedAtMs}`,
    windowStartedAtMs,
    windowEndsAtMs,
  };
}

function currentBucket(
  tenantId: string,
  scope: TenantRateLimitContext['scope'],
  windowSeconds: number,
): RateLimitBucket {
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

function configuredTenantRateLimitRedisUrl(): string | null {
  const explicit = process.env.ATTESTOR_RATE_LIMIT_REDIS_URL?.trim();
  if (explicit) return explicit;
  return configuredRedisUrl;
}

function configuredRateLimitBackend(): 'memory' | 'redis' {
  return configuredBackend;
}

function buildContextFromUsage(
  tenantId: string,
  planId: string | null | undefined,
  scope: TenantRateLimitContext['scope'],
  options: {
    backend: 'memory' | 'redis';
    used: number;
    windowStartedAtMs: number;
    windowSeconds: number;
  },
): TenantRateLimitContext {
  const spec = resolvePlanRateLimit(planId);
  const resetAtMs = options.windowStartedAtMs + (options.windowSeconds * 1000);
  const remaining = spec.requestsPerWindow === null ? null : Math.max(0, spec.requestsPerWindow - options.used);
  const retryAfterSeconds = Math.max(0, Math.ceil((resetAtMs - nowMs()) / 1000));

  return {
    tenantId,
    planId: spec.planId,
    scope,
    backend: options.backend,
    windowSeconds: options.windowSeconds,
    requestsPerWindow: spec.requestsPerWindow,
    used: options.used,
    remaining,
    enforced: spec.enforced,
    resetAt: new Date(resetAtMs).toISOString(),
    retryAfterSeconds,
  };
}

async function connectRedisClient(): Promise<IORedis | null> {
  const redisUrl = configuredTenantRateLimitRedisUrl();
  if (!redisUrl) return null;
  if (redisClient) return redisClient;
  if (redisConnectPromise) return redisConnectPromise;

  redisConnectPromise = (async () => {
    let nextClient: IORedis | null = null;
    try {
      nextClient = new IORedis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 1500,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      nextClient.on('error', () => {});
      await nextClient.connect();
      await nextClient.ping();
      redisClient = nextClient;
      return nextClient;
    } catch {
      try { nextClient?.disconnect(); } catch {}
      redisClient = null;
      configuredBackend = 'memory';
      return null;
    } finally {
      redisConnectPromise = null;
    }
  })();

  return redisConnectPromise;
}

async function readRedisUsage(
  tenantId: string,
  scope: TenantRateLimitContext['scope'],
  windowSeconds: number,
): Promise<{ used: number; windowStartedAtMs: number }> {
  const client = await connectRedisClient();
  if (!client) {
    const bucket = currentBucket(tenantId, scope, windowSeconds);
    return { used: bucket.used, windowStartedAtMs: bucket.windowStartedAtMs };
  }

  const currentNow = nowMs();
  const window = currentRedisWindow(tenantId, scope, windowSeconds, currentNow);
  const raw = await client.get(window.key);
  const used = raw ? Math.max(0, Number.parseInt(raw, 10) || 0) : 0;
  configuredBackend = 'redis';
  return { used, windowStartedAtMs: window.windowStartedAtMs };
}

async function reserveRedisUsage(
  tenantId: string,
  scope: TenantRateLimitContext['scope'],
  windowSeconds: number,
  limit: number,
): Promise<{ allowed: boolean; used: number; windowStartedAtMs: number; backend: 'memory' | 'redis' }> {
  const client = await connectRedisClient();
  if (!client) {
    const bucket = currentBucket(tenantId, scope, windowSeconds);
    const allowed = bucket.used < limit;
    if (allowed) bucket.used += 1;
    return {
      allowed,
      used: bucket.used,
      windowStartedAtMs: bucket.windowStartedAtMs,
      backend: 'memory',
    };
  }

  const currentNow = nowMs();
  const window = currentRedisWindow(tenantId, scope, windowSeconds, currentNow);
  const ttlMs = Math.max(1, window.windowEndsAtMs - currentNow);
  const result = await client.eval(
    REDIS_CONSUME_SCRIPT,
    1,
    window.key,
    String(limit),
    String(ttlMs),
  ) as [number, number] | null;
  const allowed = Array.isArray(result) && Number(result[0]) === 1;
  const used = Array.isArray(result) ? Number(result[1]) : limit;
  configuredBackend = 'redis';
  return {
    allowed,
    used,
    windowStartedAtMs: window.windowStartedAtMs,
    backend: 'redis',
  };
}

export function configureTenantRateLimiter(options?: {
  redisUrl?: string | null;
  redisMode?: string | null;
}): void {
  const nextRedisUrl = options?.redisUrl?.trim() || null;
  const nextRedisMode = options?.redisMode?.trim() || null;
  const changed = nextRedisUrl !== configuredRedisUrl || nextRedisMode !== configuredRedisMode;
  configuredRedisUrl = nextRedisUrl;
  configuredRedisMode = nextRedisMode;
  configuredBackend = nextRedisUrl ? 'redis' : 'memory';
  if (changed && redisClient) {
    try { redisClient.disconnect(); } catch {}
    redisClient = null;
  }
}

export function getTenantRateLimiterStatus(): {
  backend: 'memory' | 'redis';
  configuredRedisMode: string | null;
  shared: boolean;
} {
  return {
    backend: configuredRateLimitBackend(),
    configuredRedisMode,
    shared: configuredRateLimitBackend() === 'redis',
  };
}

export async function getTenantPipelineRateLimit(
  tenantId: string,
  planId: string | null | undefined,
): Promise<TenantRateLimitContext> {
  const spec = resolvePlanRateLimit(planId);
  if (!spec.enforced) {
    return buildContextFromUsage(tenantId, planId, 'pipeline_requests', {
      backend: configuredRateLimitBackend(),
      used: 0,
      windowStartedAtMs: nowMs(),
      windowSeconds: spec.windowSeconds,
    });
  }

  const usage = await readRedisUsage(tenantId, 'pipeline_requests', spec.windowSeconds);
  return buildContextFromUsage(tenantId, planId, 'pipeline_requests', {
    backend: configuredRateLimitBackend(),
    used: usage.used,
    windowStartedAtMs: usage.windowStartedAtMs,
    windowSeconds: spec.windowSeconds,
  });
}

export async function canConsumeTenantPipelineRequest(
  tenantId: string,
  planId: string | null | undefined,
): Promise<TenantRateLimitDecision> {
  const rateLimit = await getTenantPipelineRateLimit(tenantId, planId);
  if (!rateLimit.enforced) return { allowed: true, rateLimit };
  return {
    allowed: rateLimit.used < (rateLimit.requestsPerWindow ?? 0),
    rateLimit,
  };
}

export async function reserveTenantPipelineRequest(
  tenantId: string,
  planId: string | null | undefined,
): Promise<TenantRateLimitDecision> {
  const spec = resolvePlanRateLimit(planId);
  if (!spec.enforced || spec.requestsPerWindow === null) {
    return {
      allowed: true,
      rateLimit: await getTenantPipelineRateLimit(tenantId, planId),
    };
  }

  const result = await reserveRedisUsage(
    tenantId,
    'pipeline_requests',
    spec.windowSeconds,
    spec.requestsPerWindow,
  );

  return {
    allowed: result.allowed,
    rateLimit: buildContextFromUsage(tenantId, planId, 'pipeline_requests', {
      backend: result.backend,
      used: result.used,
      windowStartedAtMs: result.windowStartedAtMs,
      windowSeconds: spec.windowSeconds,
    }),
  };
}

export async function shutdownTenantRateLimiter(): Promise<void> {
  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch {}
    redisClient = null;
  }
  redisConnectPromise = null;
}

export async function resetTenantRateLimiterForTests(): Promise<void> {
  buckets.clear();
  await shutdownTenantRateLimiter();
  configuredBackend = configuredTenantRateLimitRedisUrl() ? 'redis' : 'memory';
}
