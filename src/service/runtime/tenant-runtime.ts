import {
  createPipelineQueue,
  createPipelineWorker,
} from '../async-pipeline.js';
import {
  configureTenantAsyncExecutionCoordinator,
  shutdownTenantAsyncExecutionCoordinator,
} from '../async-tenant-execution.js';
import {
  configureTenantAsyncWeightedDispatchCoordinator,
  shutdownTenantAsyncWeightedDispatchCoordinator,
} from '../async-weighted-dispatch.js';
import {
  configureTenantRateLimiter,
  shutdownTenantRateLimiter,
} from '../rate-limit.js';
import { resolveRedis } from '../redis-auto.js';
import {
  resolvePlanAsyncDispatch,
  resolvePlanAsyncExecution,
  resolvePlanAsyncQueue,
} from '../plan-catalog.js';

export type TenantAsyncBackendMode = 'bullmq' | 'in_process';
export type TenantRedisMode = string;

export interface InProcessAsyncJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  submittedAt: string;
  completedAt: string | null;
  tenantId: string;
  planId: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

export let asyncBackendMode: TenantAsyncBackendMode = 'in_process';
export let bullmqQueue: Awaited<ReturnType<typeof createPipelineQueue>> | null = null;
export let redisMode: TenantRedisMode = 'none';

let sharedRedisUrl: string | null = null;
let shutdownSharedRedis: (() => Promise<void>) | null = null;
// Keep the worker module-scoped so BullMQ processing stays alive for the server lifetime.
let bullmqWorker: Awaited<ReturnType<typeof createPipelineWorker>> | null = null;

export const inProcessJobs = new Map<string, InProcessAsyncJob>();
const asyncSubmissionReservations = new Map<string, number>();

export function currentAsyncSubmissionReservations(tenantId: string): number {
  return asyncSubmissionReservations.get(tenantId) ?? 0;
}

export function reserveAsyncSubmission(tenantId: string): void {
  asyncSubmissionReservations.set(tenantId, currentAsyncSubmissionReservations(tenantId) + 1);
}

export function releaseAsyncSubmission(tenantId: string): void {
  const next = currentAsyncSubmissionReservations(tenantId) - 1;
  if (next <= 0) {
    asyncSubmissionReservations.delete(tenantId);
    return;
  }
  asyncSubmissionReservations.set(tenantId, next);
}

export function inProcessTenantQueueSnapshot(tenantId: string, planId: string | null) {
  const states = {
    waiting: 0,
    active: 0,
    delayed: 0,
    prioritized: 0,
    failed: 0,
  };
  for (const job of inProcessJobs.values()) {
    if (job.tenantId !== tenantId) continue;
    if (job.status === 'queued') states.waiting += 1;
    if (job.status === 'running') states.active += 1;
    if (job.status === 'failed') states.failed += 1;
  }
  const policy = resolvePlanAsyncQueue(planId);
  const executionPolicy = resolvePlanAsyncExecution(planId);
  const dispatchPolicy = resolvePlanAsyncDispatch(planId);
  return {
    tenantId,
    planId,
    pendingJobs: states.waiting + states.active,
    pendingLimit: policy.pendingJobsPerTenant,
    enforced: policy.enforced,
    activeExecutions: states.active,
    activeExecutionLimit: executionPolicy.activeJobsPerTenant,
    activeExecutionEnforced: executionPolicy.enforced,
    activeExecutionBackend: 'memory' as const,
    weightedDispatchEnforced: false,
    weightedDispatchBackend: 'memory' as const,
    weightedDispatchWeight: dispatchPolicy.dispatchWeight,
    weightedDispatchWindowMs: dispatchPolicy.dispatchWindowMs,
    weightedDispatchNextEligibleAt: null,
    weightedDispatchWaitMs: 0,
    scanLimit: Number.MAX_SAFE_INTEGER,
    scanTruncated: false,
    states,
  };
}

function explicitRedisUrl(envName: string): string | null {
  return process.env[envName]?.trim() || null;
}

export function configureTenantRuntimeBackends(): void {
  const activeRedisUrl = explicitRedisUrl('ATTESTOR_ASYNC_ACTIVE_REDIS_URL');
  configureTenantAsyncExecutionCoordinator({
    redisUrl: activeRedisUrl ?? sharedRedisUrl,
    redisMode: activeRedisUrl ? 'explicit' : redisMode,
  });

  const dispatchRedisUrl = explicitRedisUrl('ATTESTOR_ASYNC_DISPATCH_REDIS_URL');
  configureTenantAsyncWeightedDispatchCoordinator({
    redisUrl: dispatchRedisUrl ?? sharedRedisUrl,
    redisMode: dispatchRedisUrl ? 'explicit' : redisMode,
  });

  const rateLimitRedisUrl = explicitRedisUrl('ATTESTOR_RATE_LIMIT_REDIS_URL');
  configureTenantRateLimiter({
    redisUrl: rateLimitRedisUrl ?? sharedRedisUrl,
    redisMode: rateLimitRedisUrl ? 'explicit' : redisMode,
  });
}

export async function shutdownTenantRuntimeBackends(): Promise<void> {
  const worker = bullmqWorker;
  const queue = bullmqQueue;
  const redisShutdown = shutdownSharedRedis;
  bullmqWorker = null;
  bullmqQueue = null;
  shutdownSharedRedis = null;
  sharedRedisUrl = null;
  asyncBackendMode = 'in_process';
  redisMode = 'none';

  await Promise.allSettled([
    shutdownTenantAsyncExecutionCoordinator(),
    shutdownTenantAsyncWeightedDispatchCoordinator(),
    shutdownTenantRateLimiter(),
    worker?.close(),
    queue?.close(),
    redisShutdown?.(),
  ]);
}

try {
  const resolved = await resolveRedis();
  const redisUrl = `redis://${resolved.host}:${resolved.port}`;
  sharedRedisUrl = redisUrl;
  shutdownSharedRedis = resolved.shutdown;
  configureTenantAsyncExecutionCoordinator({ redisUrl, redisMode: resolved.mode });
  configureTenantAsyncWeightedDispatchCoordinator({ redisUrl, redisMode: resolved.mode });
  bullmqQueue = createPipelineQueue({ redisUrl });
  bullmqWorker = createPipelineWorker({ redisUrl });
  asyncBackendMode = 'bullmq';
  redisMode = resolved.mode;
  console.log(`[async] BullMQ active (Redis: ${resolved.mode} @ ${resolved.host}:${resolved.port})`);
} catch (err: any) {
  redisMode = 'unavailable';
  console.log(`[async] Redis unavailable (${err.message}), using in_process fallback`);
}
