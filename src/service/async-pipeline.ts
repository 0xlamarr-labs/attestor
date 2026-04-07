/**
 * Attestor Async Pipeline Execution - BullMQ Job Orchestration
 *
 * Enables async governed pipeline execution via a Redis-backed job queue.
 * The API can submit a pipeline run as a job and return a jobId immediately.
 * A worker process picks up the job, executes the pipeline, and stores results.
 *
 * ARCHITECTURE:
 * - Queue: BullMQ queue named 'attestor-pipeline'
 * - Worker: processes jobs by calling runFinancialPipeline()
 * - Status: job progress and results queryable by jobId
 * - Retry: bounded attempts + exponential backoff
 * - DLQ: failed BullMQ jobs retained for short-lived operator inspection
 *
 * DEPLOYMENT:
 * - Requires Redis (localhost:6379 or REDIS_URL)
 * - Worker runs in the same process or a separate one
 * - Jobs survive worker restarts (Redis persistence)
 *
 * BOUNDARY:
 * - Single logical queue first slice
 * - Tenant fairness is enforced via per-tenant pending-job caps, not BullMQ Pro groups
 * - Failed jobs remain in BullMQ's failed set / DLQ view, not an external incident system
 * - No long-term job result persistence outside BullMQ retention
 */

import { randomUUID } from 'node:crypto';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { FinancialPipelineInput } from '../financial/pipeline.js';
import { resolvePlanAsyncQueue } from './plan-catalog.js';

export interface PipelineJobTenantContext {
  tenantId: string;
  planId: string | null;
  source: string;
}

export interface PipelineJobData {
  input: FinancialPipelineInput;
  sign: boolean;
  requestedAt: string;
  tenant: PipelineJobTenantContext;
}

export interface PipelineJobResult {
  runId: string;
  decision: string;
  proofMode: string;
  certificateId: string | null;
  completedAt: string;
  durationMs: number;
}

export interface AsyncRetryPolicy {
  attempts: number;
  backoffMs: number;
  maxStalledCount: number;
  workerConcurrency: number;
  completedTtlSeconds: number;
  failedTtlSeconds: number;
}

export interface TenantAsyncQueueSnapshot {
  tenantId: string;
  planId: string | null;
  pendingJobs: number;
  pendingLimit: number | null;
  enforced: boolean;
  scanLimit: number;
  scanTruncated: boolean;
  states: {
    waiting: number;
    active: number;
    delayed: number;
    prioritized: number;
    failed: number;
  };
}

export interface AsyncQueueSummary {
  queueName: string;
  backend: 'bullmq';
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    prioritized: number;
    completed: number;
    failed: number;
    paused: number;
  };
  retryPolicy: AsyncRetryPolicy;
  tenant: TenantAsyncQueueSnapshot | null;
}

export interface AsyncDeadLetterJobRecord {
  jobId: string;
  name: string;
  tenantId: string | null;
  planId: string | null;
  state: 'failed' | string;
  failedReason: string | null;
  attemptsMade: number;
  maxAttempts: number;
  requestedAt: string | null;
  submittedAt: string | null;
  processedAt: string | null;
  failedAt: string | null;
}

export interface AsyncPipelineConfig {
  redisUrl?: string;
  queueName?: string;
  jobTtlSeconds?: number;
}

const DEFAULT_QUEUE = 'attestor-pipeline';
const DEFAULT_JOB_TTL_SECONDS = 3600;
const DEFAULT_FAILED_TTL_SECONDS = 86400;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 1000;
const DEFAULT_MAX_STALLED_COUNT = 1;
const DEFAULT_WORKER_CONCURRENCY = 1;
const DEFAULT_TENANT_SCAN_LIMIT = 200;

function parseRedisOpts(url?: string): { host: string; port: number; enableOfflineQueue: false } {
  if (!url) return { host: 'localhost', port: 6379, enableOfflineQueue: false };
  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number.parseInt(u.port || '6379', 10), enableOfflineQueue: false };
  } catch {
    return { host: 'localhost', port: 6379, enableOfflineQueue: false };
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTenantScanLimit(): number {
  return parsePositiveInt(process.env.ATTESTOR_ASYNC_TENANT_SCAN_LIMIT, DEFAULT_TENANT_SCAN_LIMIT);
}

function resolveRetryPolicy(config?: AsyncPipelineConfig): AsyncRetryPolicy {
  return {
    attempts: parsePositiveInt(process.env.ATTESTOR_ASYNC_ATTEMPTS, DEFAULT_ATTEMPTS),
    backoffMs: parsePositiveInt(process.env.ATTESTOR_ASYNC_BACKOFF_MS, DEFAULT_BACKOFF_MS),
    maxStalledCount: parsePositiveInt(process.env.ATTESTOR_ASYNC_MAX_STALLED_COUNT, DEFAULT_MAX_STALLED_COUNT),
    workerConcurrency: parsePositiveInt(process.env.ATTESTOR_ASYNC_WORKER_CONCURRENCY, DEFAULT_WORKER_CONCURRENCY),
    completedTtlSeconds: config?.jobTtlSeconds ?? parsePositiveInt(process.env.ATTESTOR_ASYNC_JOB_TTL_SECONDS, DEFAULT_JOB_TTL_SECONDS),
    failedTtlSeconds: parsePositiveInt(process.env.ATTESTOR_ASYNC_FAILED_TTL_SECONDS, DEFAULT_FAILED_TTL_SECONDS),
  };
}

function planPriority(planId: string | null): number {
  switch (planId) {
    case 'enterprise':
      return 1;
    case 'pro':
      return 2;
    case 'starter':
      return 3;
    default:
      return 5;
  }
}

function sanitizeTenantId(tenantId: string): string {
  const normalized = tenantId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'tenant';
}

function currentQueueName(config?: AsyncPipelineConfig): string {
  return config?.queueName ?? DEFAULT_QUEUE;
}

function buildJobId(tenantId: string): string {
  return `${sanitizeTenantId(tenantId)}__${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function ensureValidPipelineJobData(data: PipelineJobData): void {
  const input = data.input;
  if (!input || typeof input !== 'object') {
    throw new UnrecoverableError('Async job payload missing pipeline input object.');
  }
  if (typeof input.candidateSql !== 'string' || input.candidateSql.trim() === '') {
    throw new UnrecoverableError('Async job payload requires candidateSql as a non-empty string.');
  }
  if (!input.intent || typeof input.intent !== 'object' || Array.isArray(input.intent)) {
    throw new UnrecoverableError('Async job payload requires intent as an object.');
  }
  if (!data.tenant || typeof data.tenant.tenantId !== 'string' || data.tenant.tenantId.trim() === '') {
    throw new UnrecoverableError('Async job payload missing tenant metadata.');
  }
}

type InspectableState = 'waiting' | 'active' | 'delayed' | 'prioritized' | 'failed';

async function loadTenantJobs(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  states: InspectableState[],
  limit?: number,
): Promise<Job<PipelineJobData, PipelineJobResult>[]> {
  const scanLimit = limit ?? normalizeTenantScanLimit();
  if (scanLimit <= 0) return [];
  return queue.getJobs(states, 0, scanLimit - 1, true);
}

function tenantStateCounter(): TenantAsyncQueueSnapshot['states'] {
  return {
    waiting: 0,
    active: 0,
    delayed: 0,
    prioritized: 0,
    failed: 0,
  };
}

export function getAsyncRetryPolicy(config?: AsyncPipelineConfig): AsyncRetryPolicy {
  return resolveRetryPolicy(config);
}

export function createPipelineQueue(config?: AsyncPipelineConfig): Queue<PipelineJobData, PipelineJobResult> {
  const redis = parseRedisOpts(config?.redisUrl ?? process.env.REDIS_URL);
  const policy = resolveRetryPolicy(config);
  return new Queue(currentQueueName(config), {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: { age: policy.completedTtlSeconds },
      removeOnFail: { age: policy.failedTtlSeconds },
      attempts: policy.attempts,
      backoff: {
        type: 'exponential',
        delay: policy.backoffMs,
      },
    },
  });
}

export async function submitPipelineJob(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  input: FinancialPipelineInput,
  tenant: PipelineJobTenantContext,
  sign: boolean = false,
): Promise<{ jobId: string }> {
  const resolvedTenantId = tenant.tenantId.trim() || 'default';
  const job = await queue.add('pipeline-run', {
    input,
    sign,
    requestedAt: new Date().toISOString(),
    tenant: {
      tenantId: resolvedTenantId,
      planId: tenant.planId,
      source: tenant.source,
    },
  }, {
    jobId: buildJobId(resolvedTenantId),
    priority: planPriority(tenant.planId),
  });
  return { jobId: job.id! };
}

export async function getJobStatus(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  jobId: string,
): Promise<{
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'prioritized' | 'not_found';
  result: PipelineJobResult | null;
  error: string | null;
  submittedAt: string | null;
  attemptsMade: number;
  maxAttempts: number;
  tenant: PipelineJobTenantContext | null;
  failedAt: string | null;
}> {
  const job = await queue.getJob(jobId);
  if (!job) {
    return {
      status: 'not_found',
      result: null,
      error: null,
      submittedAt: null,
      attemptsMade: 0,
      maxAttempts: 0,
      tenant: null,
      failedAt: null,
    };
  }

  const state = await job.getState();
  if (state === 'completed') {
    return {
      status: 'completed',
      result: job.returnvalue,
      error: null,
      submittedAt: job.data.requestedAt ?? (job.timestamp ? new Date(job.timestamp).toISOString() : null),
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? resolveRetryPolicy().attempts,
      tenant: job.data.tenant ?? null,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };
  }
  if (state === 'failed') {
    return {
      status: 'failed',
      result: null,
      error: job.failedReason ?? 'Unknown error',
      submittedAt: job.data.requestedAt ?? (job.timestamp ? new Date(job.timestamp).toISOString() : null),
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? resolveRetryPolicy().attempts,
      tenant: job.data.tenant ?? null,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };
  }

  return {
    status: state as 'waiting' | 'active' | 'delayed' | 'prioritized',
    result: null,
    error: null,
    submittedAt: job.data.requestedAt ?? (job.timestamp ? new Date(job.timestamp).toISOString() : null),
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? resolveRetryPolicy().attempts,
    tenant: job.data.tenant ?? null,
    failedAt: null,
  };
}

export async function getTenantAsyncQueueSnapshot(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  tenantId: string,
  planId: string | null,
): Promise<TenantAsyncQueueSnapshot> {
  const scanLimit = normalizeTenantScanLimit();
  const states = tenantStateCounter();
  const jobs = await loadTenantJobs(queue, ['waiting', 'active', 'delayed', 'prioritized', 'failed'], scanLimit);
  const scanTruncated = jobs.length >= scanLimit;
  for (const job of jobs) {
    if (job.data.tenant?.tenantId !== tenantId) continue;
    const state = await job.getState();
    if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'prioritized' || state === 'failed') {
      states[state] += 1;
    }
  }

  const policy = resolvePlanAsyncQueue(planId);
  return {
    tenantId,
    planId,
    pendingJobs: states.waiting + states.active + states.delayed + states.prioritized,
    pendingLimit: policy.pendingJobsPerTenant,
    enforced: policy.enforced,
    scanLimit,
    scanTruncated,
    states,
  };
}

export async function canEnqueueTenantAsyncJob(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  tenantId: string,
  planId: string | null,
): Promise<{ allowed: boolean; snapshot: TenantAsyncQueueSnapshot }> {
  const snapshot = await getTenantAsyncQueueSnapshot(queue, tenantId, planId);
  if (!snapshot.enforced || snapshot.pendingLimit === null) {
    return { allowed: true, snapshot };
  }
  return {
    allowed: snapshot.pendingJobs < snapshot.pendingLimit,
    snapshot,
  };
}

export async function getAsyncQueueSummary(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  tenantId?: string | null,
  planId?: string | null,
): Promise<AsyncQueueSummary> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'completed', 'failed', 'paused');
  return {
    queueName: queue.name,
    backend: 'bullmq',
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      prioritized: counts.prioritized ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      paused: counts.paused ?? 0,
    },
    retryPolicy: resolveRetryPolicy(),
    tenant: tenantId ? await getTenantAsyncQueueSnapshot(queue, tenantId, planId ?? null) : null,
  };
}

export async function listFailedPipelineJobs(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  options?: { tenantId?: string | null; limit?: number | null },
): Promise<AsyncDeadLetterJobRecord[]> {
  const limit = options?.limit && options.limit > 0 ? options.limit : 25;
  const jobs = await queue.getJobs(['failed'], 0, limit - 1, true);
  const records: AsyncDeadLetterJobRecord[] = [];
  for (const job of jobs) {
    if (options?.tenantId && job.data.tenant?.tenantId !== options.tenantId) continue;
    records.push({
      jobId: String(job.id),
      name: job.name,
      tenantId: job.data.tenant?.tenantId ?? null,
      planId: job.data.tenant?.planId ?? null,
      state: await job.getState(),
      failedReason: job.failedReason ?? null,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? resolveRetryPolicy().attempts,
      requestedAt: job.data.requestedAt ?? null,
      submittedAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    });
  }
  return records;
}

export async function retryFailedPipelineJob(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  jobId: string,
): Promise<AsyncDeadLetterJobRecord> {
  const job = await queue.getJob(jobId);
  if (!job) {
    throw new Error(`Async job '${jobId}' not found.`);
  }
  const state = await job.getState();
  if (state !== 'failed') {
    throw new Error(`Async job '${jobId}' is not in failed state (current: ${state}).`);
  }
  await job.retry();
  return {
    jobId: String(job.id),
    name: job.name,
    tenantId: job.data.tenant?.tenantId ?? null,
    planId: job.data.tenant?.planId ?? null,
    state: 'waiting',
    failedReason: null,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? resolveRetryPolicy().attempts,
    requestedAt: job.data.requestedAt ?? null,
    submittedAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
    processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    failedAt: null,
  };
}

export function createPipelineWorker(config?: AsyncPipelineConfig): Worker<PipelineJobData, PipelineJobResult> {
  const redis = parseRedisOpts(config?.redisUrl ?? process.env.REDIS_URL);
  const policy = resolveRetryPolicy(config);

  return new Worker<PipelineJobData, PipelineJobResult>(
    currentQueueName(config),
    async (job: Job<PipelineJobData, PipelineJobResult>) => {
      const start = Date.now();
      const { runFinancialPipeline } = await import('../financial/pipeline.js');
      const { generateKeyPair } = await import('../signing/keys.js');

      ensureValidPipelineJobData(job.data);

      const input = job.data.input;
      if (job.data.sign && !input.signingKeyPair) {
        input.signingKeyPair = generateKeyPair();
      }

      const report = runFinancialPipeline(input);

      return {
        runId: report.runId,
        decision: report.decision,
        proofMode: report.liveProof.mode,
        certificateId: report.certificate?.certificateId ?? null,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    },
    {
      connection: redis,
      concurrency: policy.workerConcurrency,
      maxStalledCount: policy.maxStalledCount,
    },
  );
}

export async function checkRedisHealth(config?: AsyncPipelineConfig): Promise<{
  available: boolean;
  message: string;
}> {
  try {
    const IORedis = (await import('ioredis')).default;
    const redis = parseRedisOpts(config?.redisUrl ?? process.env.REDIS_URL);
    const client = new IORedis(redis);
    const pong = await client.ping();
    await client.quit();
    return { available: pong === 'PONG', message: `Redis reachable at ${redis.host}:${redis.port}` };
  } catch (err: any) {
    return { available: false, message: `Redis not reachable: ${err.message}` };
  }
}
