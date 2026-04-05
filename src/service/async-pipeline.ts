/**
 * Attestor Async Pipeline Execution — BullMQ Job Orchestration
 *
 * Enables async governed pipeline execution via a Redis-backed job queue.
 * The API can submit a pipeline run as a job and return a jobId immediately.
 * A worker process picks up the job, executes the pipeline, and stores results.
 *
 * ARCHITECTURE:
 * - Queue: BullMQ queue named 'attestor-pipeline'
 * - Worker: processes jobs by calling runFinancialPipeline()
 * - Status: job progress and results queryable by jobId
 *
 * DEPLOYMENT:
 * - Requires Redis (localhost:6379 or REDIS_URL)
 * - Worker runs in the same process or a separate one
 * - Jobs survive worker restarts (Redis persistence)
 *
 * BOUNDARY:
 * - Single-queue, single-worker first slice
 * - No multi-tenant isolation in the queue
 * - No job prioritization or rate limiting
 * - No long-term result persistence (Redis TTL)
 */

import { Queue, Worker, Job } from 'bullmq';
import type { FinancialPipelineInput } from '../financial/pipeline.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PipelineJobData {
  input: FinancialPipelineInput;
  sign: boolean;
  requestedAt: string;
}

export interface PipelineJobResult {
  runId: string;
  decision: string;
  proofMode: string;
  certificateId: string | null;
  completedAt: string;
  durationMs: number;
}

export interface AsyncPipelineConfig {
  /** Redis connection URL. Default: redis://localhost:6379 */
  redisUrl?: string;
  /** Queue name. Default: 'attestor-pipeline' */
  queueName?: string;
  /** Job TTL in seconds. Default: 3600 (1 hour) */
  jobTtlSeconds?: number;
}

// ─── Queue ──────────────────────────────────────────────────────────────────

const DEFAULT_QUEUE = 'attestor-pipeline';

function parseRedisOpts(url?: string): { host: string; port: number } {
  if (!url) return { host: 'localhost', port: 6379 };
  try {
    const u = new URL(url);
    return { host: u.hostname, port: parseInt(u.port || '6379', 10) };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

/**
 * Create a pipeline job queue.
 * Does not start a worker — that is separate.
 */
export function createPipelineQueue(config?: AsyncPipelineConfig): Queue<PipelineJobData, PipelineJobResult> {
  const redis = parseRedisOpts(config?.redisUrl ?? process.env.REDIS_URL);
  return new Queue(config?.queueName ?? DEFAULT_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: { age: config?.jobTtlSeconds ?? 3600 },
      removeOnFail: { age: config?.jobTtlSeconds ?? 3600 },
    },
  });
}

/**
 * Submit a pipeline run as an async job.
 * Returns immediately with a jobId.
 */
export async function submitPipelineJob(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  input: FinancialPipelineInput,
  sign: boolean = false,
): Promise<{ jobId: string }> {
  const job = await queue.add('pipeline-run', {
    input,
    sign,
    requestedAt: new Date().toISOString(),
  });
  return { jobId: job.id! };
}

/**
 * Get the status and result of a pipeline job.
 */
export async function getJobStatus(
  queue: Queue<PipelineJobData, PipelineJobResult>,
  jobId: string,
): Promise<{
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'not_found';
  result: PipelineJobResult | null;
  error: string | null;
}> {
  const job = await queue.getJob(jobId);
  if (!job) return { status: 'not_found', result: null, error: null };

  const state = await job.getState();
  if (state === 'completed') {
    return { status: 'completed', result: job.returnvalue, error: null };
  }
  if (state === 'failed') {
    return { status: 'failed', result: null, error: job.failedReason ?? 'Unknown error' };
  }
  return { status: state as 'waiting' | 'active', result: null, error: null };
}

// ─── Worker ─────────────────────────────────────────────────────────────────

/**
 * Create a pipeline worker that processes jobs from the queue.
 * Each job executes the full governed pipeline.
 */
export function createPipelineWorker(config?: AsyncPipelineConfig): Worker<PipelineJobData, PipelineJobResult> {
  const redis = parseRedisOpts(config?.redisUrl ?? process.env.REDIS_URL);

  return new Worker<PipelineJobData, PipelineJobResult>(
    config?.queueName ?? DEFAULT_QUEUE,
    async (job: Job<PipelineJobData, PipelineJobResult>) => {
      const start = Date.now();
      const { runFinancialPipeline } = await import('../financial/pipeline.js');
      const { generateKeyPair } = await import('../signing/keys.js');

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
    { connection: redis, concurrency: 1 },
  );
}

// ─── Health Check ───────────────────────────────────────────────────────────

/**
 * Check if Redis is reachable for the async pipeline.
 */
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
