import IORedis from 'ioredis';
import { resolvePlanAsyncExecution } from './plan-catalog.js';

export interface TenantAsyncExecutionState {
  tenantId: string;
  planId: string;
  backend: 'memory' | 'redis';
  activeExecutions: number;
  activeExecutionLimit: number | null;
  enforced: boolean;
  leaseTtlSeconds: number;
  requeueDelayMs: number;
}

export interface TenantAsyncExecutionAcquireDecision {
  acquired: boolean;
  state: TenantAsyncExecutionState;
}

interface MemoryLeaseBucket {
  leases: Map<string, number>;
}

const MEMORY_BUCKETS = new Map<string, MemoryLeaseBucket>();
const REDIS_KEY_PREFIX = 'attestor:async-active';
const DEFAULT_LEASE_MS = 15_000;
const DEFAULT_REQUEUE_DELAY_MS = 1_000;
const DEFAULT_HEARTBEAT_MS = 5_000;
const REDIS_ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local member = ARGV[2]
local limit = tonumber(ARGV[3])
local expiresAt = tonumber(ARGV[4])
local leaseMs = tonumber(ARGV[5])
if redis.call('ZSCORE', KEYS[1], member) then
  redis.call('ZADD', KEYS[1], expiresAt, member)
  redis.call('PEXPIRE', KEYS[1], leaseMs)
  return {1, redis.call('ZCARD', KEYS[1]), expiresAt}
end
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], expiresAt, member)
  redis.call('PEXPIRE', KEYS[1], leaseMs)
  return {1, count + 1, expiresAt}
end
return {0, count, 0}
`;
const REDIS_TOUCH_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local member = ARGV[2]
local expiresAt = tonumber(ARGV[3])
local leaseMs = tonumber(ARGV[4])
if redis.call('ZSCORE', KEYS[1], member) then
  redis.call('ZADD', KEYS[1], expiresAt, member)
  redis.call('PEXPIRE', KEYS[1], leaseMs)
  return {1, redis.call('ZCARD', KEYS[1]), expiresAt}
end
return {0, redis.call('ZCARD', KEYS[1]), 0}
`;
const REDIS_RELEASE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZREM', KEYS[1], ARGV[2])
local count = redis.call('ZCARD', KEYS[1])
if count == 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return count
`;
const REDIS_COUNT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZCARD', KEYS[1])
`;

let configuredRedisUrl: string | null = null;
let configuredRedisMode: string | null = null;
let configuredBackend: 'memory' | 'redis' = 'memory';
let redisClient: IORedis | null = null;
let redisConnectPromise: Promise<IORedis | null> | null = null;

function nowMs(): number {
  return Date.now();
}

function leaseMs(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_ASYNC_ACTIVE_LEASE_MS ?? `${DEFAULT_LEASE_MS}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LEASE_MS;
}

function requeueDelayMs(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS ?? `${DEFAULT_REQUEUE_DELAY_MS}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEUE_DELAY_MS;
}

export function tenantAsyncExecutionHeartbeatMs(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_ASYNC_ACTIVE_HEARTBEAT_MS ?? `${DEFAULT_HEARTBEAT_MS}`, 10);
  const computed = Math.max(1_000, Math.floor(leaseMs() / 3));
  if (!Number.isFinite(parsed) || parsed <= 0) return computed;
  return Math.min(parsed, Math.max(1_000, leaseMs() - 1_000));
}

function configuredAsyncExecutionRedisUrl(): string | null {
  const explicit = process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL?.trim();
  if (explicit) return explicit;
  return configuredRedisUrl ?? process.env.REDIS_URL?.trim() ?? null;
}

function executionKey(queueName: string, tenantId: string): string {
  return `${REDIS_KEY_PREFIX}:${queueName}:${tenantId}`;
}

function memoryKey(queueName: string, tenantId: string): string {
  return `${queueName}:${tenantId}`;
}

function cleanupMemoryBucket(bucket: MemoryLeaseBucket, currentNow: number): void {
  for (const [jobId, expiresAt] of bucket.leases.entries()) {
    if (expiresAt <= currentNow) bucket.leases.delete(jobId);
  }
}

function ensureMemoryBucket(queueName: string, tenantId: string): MemoryLeaseBucket {
  const key = memoryKey(queueName, tenantId);
  const currentNow = nowMs();
  const existing = MEMORY_BUCKETS.get(key);
  if (existing) {
    cleanupMemoryBucket(existing, currentNow);
    return existing;
  }
  const fresh: MemoryLeaseBucket = { leases: new Map() };
  MEMORY_BUCKETS.set(key, fresh);
  return fresh;
}

async function connectRedisClient(): Promise<IORedis | null> {
  const redisUrl = configuredAsyncExecutionRedisUrl();
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

function buildState(
  tenantId: string,
  planId: string | null | undefined,
  activeExecutions: number,
  backend: 'memory' | 'redis',
): TenantAsyncExecutionState {
  const spec = resolvePlanAsyncExecution(planId);
  return {
    tenantId,
    planId: spec.planId,
    backend,
    activeExecutions,
    activeExecutionLimit: spec.activeJobsPerTenant,
    enforced: spec.enforced,
    leaseTtlSeconds: Math.ceil(leaseMs() / 1000),
    requeueDelayMs: requeueDelayMs(),
  };
}

export function configureTenantAsyncExecutionCoordinator(options?: {
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

export function getTenantAsyncExecutionCoordinatorStatus(): {
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

export async function getTenantAsyncExecutionState(
  queueName: string,
  tenantId: string,
  planId: string | null | undefined,
): Promise<TenantAsyncExecutionState> {
  const spec = resolvePlanAsyncExecution(planId);
  if (!spec.enforced || spec.activeJobsPerTenant === null) {
    return buildState(tenantId, planId, 0, configuredBackend);
  }

  const client = await connectRedisClient();
  if (!client) {
    const bucket = ensureMemoryBucket(queueName, tenantId);
    cleanupMemoryBucket(bucket, nowMs());
    return buildState(tenantId, planId, bucket.leases.size, 'memory');
  }

  const key = executionKey(queueName, tenantId);
  const count = await client.eval(
    REDIS_COUNT_SCRIPT,
    1,
    key,
    String(nowMs()),
  ) as number | string | null;
  return buildState(tenantId, planId, Number(count ?? 0), 'redis');
}

export async function acquireTenantAsyncExecutionLease(options: {
  queueName: string;
  tenantId: string;
  planId: string | null | undefined;
  jobId: string;
}): Promise<TenantAsyncExecutionAcquireDecision> {
  const spec = resolvePlanAsyncExecution(options.planId);
  if (!spec.enforced || spec.activeJobsPerTenant === null) {
    return {
      acquired: true,
      state: buildState(options.tenantId, options.planId, 0, configuredBackend),
    };
  }

  const currentNow = nowMs();
  const expiresAt = currentNow + leaseMs();
  const client = await connectRedisClient();
  if (!client) {
    const bucket = ensureMemoryBucket(options.queueName, options.tenantId);
    cleanupMemoryBucket(bucket, currentNow);
    if (!bucket.leases.has(options.jobId) && bucket.leases.size >= spec.activeJobsPerTenant) {
      return {
        acquired: false,
        state: buildState(options.tenantId, options.planId, bucket.leases.size, 'memory'),
      };
    }
    bucket.leases.set(options.jobId, expiresAt);
    return {
      acquired: true,
      state: buildState(options.tenantId, options.planId, bucket.leases.size, 'memory'),
    };
  }

  const key = executionKey(options.queueName, options.tenantId);
  const result = await client.eval(
    REDIS_ACQUIRE_SCRIPT,
    1,
    key,
    String(currentNow),
    options.jobId,
    String(spec.activeJobsPerTenant),
    String(expiresAt),
    String(leaseMs()),
  ) as [number, number, number] | null;
  const acquired = Array.isArray(result) && Number(result[0]) === 1;
  const activeExecutions = Array.isArray(result) ? Number(result[1]) : 0;
  return {
    acquired,
    state: buildState(options.tenantId, options.planId, activeExecutions, 'redis'),
  };
}

export async function heartbeatTenantAsyncExecutionLease(options: {
  queueName: string;
  tenantId: string;
  planId: string | null | undefined;
  jobId: string;
}): Promise<boolean> {
  const spec = resolvePlanAsyncExecution(options.planId);
  if (!spec.enforced || spec.activeJobsPerTenant === null) {
    return true;
  }

  const currentNow = nowMs();
  const expiresAt = currentNow + leaseMs();
  const client = await connectRedisClient();
  if (!client) {
    const bucket = ensureMemoryBucket(options.queueName, options.tenantId);
    cleanupMemoryBucket(bucket, currentNow);
    if (!bucket.leases.has(options.jobId)) return false;
    bucket.leases.set(options.jobId, expiresAt);
    return true;
  }

  const key = executionKey(options.queueName, options.tenantId);
  const result = await client.eval(
    REDIS_TOUCH_SCRIPT,
    1,
    key,
    String(currentNow),
    options.jobId,
    String(expiresAt),
    String(leaseMs()),
  ) as [number, number, number] | null;
  return Array.isArray(result) && Number(result[0]) === 1;
}

export async function releaseTenantAsyncExecutionLease(options: {
  queueName: string;
  tenantId: string;
  planId: string | null | undefined;
  jobId: string;
}): Promise<void> {
  const spec = resolvePlanAsyncExecution(options.planId);
  if (!spec.enforced || spec.activeJobsPerTenant === null) return;

  const currentNow = nowMs();
  const client = await connectRedisClient();
  if (!client) {
    const bucket = ensureMemoryBucket(options.queueName, options.tenantId);
    cleanupMemoryBucket(bucket, currentNow);
    bucket.leases.delete(options.jobId);
    if (bucket.leases.size === 0) {
      MEMORY_BUCKETS.delete(memoryKey(options.queueName, options.tenantId));
    }
    return;
  }

  const key = executionKey(options.queueName, options.tenantId);
  await client.eval(
    REDIS_RELEASE_SCRIPT,
    1,
    key,
    String(currentNow),
    options.jobId,
    String(leaseMs()),
  );
}

export async function shutdownTenantAsyncExecutionCoordinator(): Promise<void> {
  MEMORY_BUCKETS.clear();
  if (redisClient) {
    try { redisClient.disconnect(); } catch {}
    redisClient = null;
  }
  redisConnectPromise = null;
}

export async function resetTenantAsyncExecutionCoordinatorForTests(): Promise<void> {
  await shutdownTenantAsyncExecutionCoordinator();
  configuredBackend = configuredAsyncExecutionRedisUrl() ? 'redis' : 'memory';
}
