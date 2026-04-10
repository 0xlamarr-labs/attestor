import IORedis from 'ioredis';
import { resolvePlanAsyncDispatch } from './plan-catalog.js';

export interface TenantAsyncWeightedDispatchState {
  tenantId: string;
  planId: string;
  backend: 'memory' | 'redis';
  dispatchWeight: number | null;
  dispatchWindowMs: number | null;
  enabled: boolean;
  tenantNextEligibleAt: string | null;
  planNextEligibleAt: string | null;
  nextEligibleAt: string | null;
  waitMs: number;
  source: 'plan_default' | 'env_override' | 'custom_disabled';
}

export interface TenantAsyncWeightedDispatchDecision {
  acquired: boolean;
  state: TenantAsyncWeightedDispatchState;
}

const TENANT_NEXT_MEMORY = new Map<string, number>();
const PLAN_NEXT_MEMORY = new Map<string, number>();
const REDIS_KEY_PREFIX = 'attestor:async-dispatch';
const REDIS_ACQUIRE_SCRIPT = `
local tenantNext = tonumber(redis.call('GET', KEYS[1]) or '0')
local planNext = tonumber(redis.call('GET', KEYS[2]) or '0')
local nowMs = tonumber(ARGV[1])
local tenantWindowMs = tonumber(ARGV[2])
local planWindowMs = tonumber(ARGV[3])
local ttlMs = tonumber(ARGV[4])
local nextEligible = tenantNext
if planNext > nextEligible then
  nextEligible = planNext
end
if nowMs < nextEligible then
  return {0, tenantNext, planNext, nextEligible}
end
tenantNext = nowMs + tenantWindowMs
planNext = nowMs + planWindowMs
redis.call('SET', KEYS[1], tenantNext, 'PX', ttlMs)
redis.call('SET', KEYS[2], planNext, 'PX', ttlMs)
return {1, tenantNext, planNext, nowMs}
`;

let configuredRedisUrl: string | null = null;
let configuredRedisMode: string | null = null;
let configuredBackend: 'memory' | 'redis' = 'memory';
let redisClient: IORedis | null = null;
let redisConnectPromise: Promise<IORedis | null> | null = null;

function nowMs(): number {
  return Date.now();
}

function ttlMs(windowMs: number | null): number {
  const base = windowMs ?? 0;
  return Math.max(1000, base * 4);
}

function tenantKey(queueName: string, tenantId: string): string {
  return `${REDIS_KEY_PREFIX}:tenant:${queueName}:${tenantId}`;
}

function planKey(queueName: string, planId: string): string {
  return `${REDIS_KEY_PREFIX}:plan:${queueName}:${planId}`;
}

function configuredDispatchRedisUrl(): string | null {
  const explicit = process.env.ATTESTOR_ASYNC_DISPATCH_REDIS_URL?.trim();
  if (explicit) return explicit;
  return configuredRedisUrl ?? process.env.REDIS_URL?.trim() ?? null;
}

async function connectRedisClient(): Promise<IORedis | null> {
  const redisUrl = configuredDispatchRedisUrl();
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
      configuredBackend = 'redis';
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

function isoAt(value: number): string {
  return new Date(value).toISOString();
}

function buildState(
  tenantId: string,
  planId: string | null | undefined,
  backend: 'memory' | 'redis',
  tenantNextEligible: number | null,
  planNextEligible: number | null,
): TenantAsyncWeightedDispatchState {
  const spec = resolvePlanAsyncDispatch(planId);
  const nextEligible = Math.max(tenantNextEligible ?? 0, planNextEligible ?? 0);
  const currentNow = nowMs();
  return {
    tenantId,
    planId: spec.planId,
    backend,
    dispatchWeight: spec.dispatchWeight,
    dispatchWindowMs: spec.dispatchWindowMs,
    enabled: spec.enabled,
    tenantNextEligibleAt: tenantNextEligible ? isoAt(tenantNextEligible) : null,
    planNextEligibleAt: planNextEligible ? isoAt(planNextEligible) : null,
    nextEligibleAt: nextEligible > 0 ? isoAt(nextEligible) : null,
    waitMs: nextEligible > currentNow ? nextEligible - currentNow : 0,
    source: spec.source,
  };
}

export function configureTenantAsyncWeightedDispatchCoordinator(options?: {
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

export function getTenantAsyncWeightedDispatchCoordinatorStatus(): {
  backend: 'memory' | 'redis';
  configuredRedisMode: string | null;
  shared: boolean;
} {
  return {
    backend: configuredBackend,
    configuredRedisMode,
    shared: configuredBackend === 'redis',
  };
}

export async function getTenantAsyncWeightedDispatchState(
  queueName: string,
  tenantId: string,
  planId: string | null | undefined,
): Promise<TenantAsyncWeightedDispatchState> {
  const spec = resolvePlanAsyncDispatch(planId);
  if (!spec.enabled || spec.dispatchWindowMs === null) {
    return buildState(tenantId, planId, configuredBackend, null, null);
  }

  const tenantStateKey = tenantKey(queueName, tenantId);
  const planStateKey = planKey(queueName, spec.planId);
  const client = await connectRedisClient();
  if (!client) {
    const tenantNext = TENANT_NEXT_MEMORY.get(tenantStateKey) ?? null;
    const planNext = PLAN_NEXT_MEMORY.get(planStateKey) ?? null;
    return buildState(tenantId, planId, 'memory', tenantNext, planNext);
  }

  const [tenantRaw, planRaw] = await Promise.all([
    client.get(tenantStateKey),
    client.get(planStateKey),
  ]);

  return buildState(
    tenantId,
    planId,
    'redis',
    tenantRaw ? Number.parseInt(tenantRaw, 10) : null,
    planRaw ? Number.parseInt(planRaw, 10) : null,
  );
}

export async function acquireTenantAsyncWeightedDispatchPermit(options: {
  queueName: string;
  tenantId: string;
  planId: string | null | undefined;
}): Promise<TenantAsyncWeightedDispatchDecision> {
  const spec = resolvePlanAsyncDispatch(options.planId);
  if (!spec.enabled || spec.dispatchWindowMs === null) {
    return {
      acquired: true,
      state: buildState(options.tenantId, options.planId, configuredBackend, null, null),
    };
  }

  const tenantStateKey = tenantKey(options.queueName, options.tenantId);
  const planStateKey = planKey(options.queueName, spec.planId);
  const currentNow = nowMs();
  const client = await connectRedisClient();
  if (!client) {
    const tenantNext = TENANT_NEXT_MEMORY.get(tenantStateKey) ?? 0;
    const planNext = PLAN_NEXT_MEMORY.get(planStateKey) ?? 0;
    const nextEligible = Math.max(tenantNext, planNext);
    if (currentNow < nextEligible) {
      return {
        acquired: false,
        state: buildState(options.tenantId, options.planId, 'memory', tenantNext || null, planNext || null),
      };
    }
    const next = currentNow + spec.dispatchWindowMs;
    TENANT_NEXT_MEMORY.set(tenantStateKey, next);
    PLAN_NEXT_MEMORY.set(planStateKey, next);
    return {
      acquired: true,
      state: buildState(options.tenantId, options.planId, 'memory', next, next),
    };
  }

  const result = await client.eval(
    REDIS_ACQUIRE_SCRIPT,
    2,
    tenantStateKey,
    planStateKey,
    String(currentNow),
    String(spec.dispatchWindowMs),
    String(spec.dispatchWindowMs),
    String(ttlMs(spec.dispatchWindowMs)),
  ) as [number, number, number, number] | null;

  const acquired = Array.isArray(result) && Number(result[0]) === 1;
  const tenantNext = Array.isArray(result) ? Number(result[1]) : null;
  const planNext = Array.isArray(result) ? Number(result[2]) : null;

  return {
    acquired,
    state: buildState(options.tenantId, options.planId, 'redis', tenantNext, planNext),
  };
}

export async function shutdownTenantAsyncWeightedDispatchCoordinator(): Promise<void> {
  TENANT_NEXT_MEMORY.clear();
  PLAN_NEXT_MEMORY.clear();
  if (redisClient) {
    try { redisClient.disconnect(); } catch {}
    redisClient = null;
  }
  redisConnectPromise = null;
}

export async function resetTenantAsyncWeightedDispatchCoordinatorForTests(): Promise<void> {
  await shutdownTenantAsyncWeightedDispatchCoordinator();
  configuredBackend = configuredDispatchRedisUrl() ? 'redis' : 'memory';
}
