/**
 * Attestor Async Pipeline Worker — Standalone Entry Point
 *
 * Runs a BullMQ worker that processes governed pipeline jobs from the shared
 * Redis-backed queue. Designed to run as a separate process from the API server,
 * enabling horizontal scaling of pipeline execution independently of HTTP serving.
 *
 * ARCHITECTURE:
 * - Connects to Redis via 3-tier auto-resolution (same as API)
 * - Creates a BullMQ Worker for the 'attestor-pipeline' queue
 * - Processes jobs by calling runFinancialPipeline()
 * - Handles SIGTERM/SIGINT for graceful shutdown (drain in-flight jobs)
 *
 * DEPLOYMENT:
 * - Container: docker run attestor node dist/service/worker.js
 * - Local:     npm run worker (or npx tsx src/service/worker.ts)
 * - Compose:   worker service in docker-compose.yml
 *
 * BOUNDARY:
 * - Single-queue, configurable concurrency (default 1)
 * - Shares Redis with API server
 * - Tenant fairness comes from per-tenant pending-job caps at API submit time plus shared tenant active-execution caps at worker runtime
 * - Terminal failed jobs remain inspectable through the admin DLQ route and persist into the current DLQ store for retry/audit workflows
 * - Pipeline-route rate limiting is enforced on the API side and can use shared Redis-backed windows when configured
 * - No BullMQ Pro queue groups or broader weighted multi-tenant scheduling/isolation yet
 *
 * Run: npm run worker
 * Run: REDIS_URL=redis://prod:6379 npm run worker
 */

import type { Worker } from 'bullmq';
import { resolveRedis } from './redis-auto.js';
import {
  configureTenantAsyncExecutionCoordinator,
  shutdownTenantAsyncExecutionCoordinator,
} from './async-tenant-execution.js';
import {
  evaluateWorkerHighAvailabilityState,
  resolveServiceInstanceId,
} from './high-availability.js';
import { createPipelineWorker } from './async-pipeline.js';

async function main() {
  console.log('[worker] Attestor Pipeline Worker starting...');
  const instanceId = resolveServiceInstanceId();

  let redisUrl: string;
  let resolvedRedisMode: 'external' | 'localhost' | 'embedded' = 'embedded';
  try {
    const resolved = await resolveRedis();
    redisUrl = `redis://${resolved.host}:${resolved.port}`;
    resolvedRedisMode = resolved.mode;
    configureTenantAsyncExecutionCoordinator({ redisUrl, redisMode: resolved.mode });
    console.log(`[worker] Redis connected (${resolved.mode} @ ${resolved.host}:${resolved.port})`);
  } catch (err: any) {
    console.error(`[worker] FATAL: Redis required for worker mode but unavailable: ${err.message}`);
    console.error('[worker] Set REDIS_URL or ensure localhost:6379 / redis-memory-server is available.');
    process.exit(1);
  }

  const highAvailability = evaluateWorkerHighAvailabilityState({
    redisMode: resolvedRedisMode,
  });
  if (highAvailability.enabled && !highAvailability.ready) {
    throw new Error(`ATTESTOR_HA_MODE startup guard failed for worker '${instanceId}': ${highAvailability.issues.join(' ')}`);
  }
  if (highAvailability.enabled) {
    console.log(`[worker] Multi-node first slice enabled for instance '${instanceId}' (redis=${highAvailability.redisMode})`);
  }

  const worker: Worker = createPipelineWorker({ redisUrl });
  console.log(`[worker] Pipeline worker active — listening for jobs on queue 'attestor-pipeline'`);

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed: ${job.returnvalue?.decision ?? 'unknown'} (${job.returnvalue?.durationMs ?? '?'}ms)`);
  });
  worker.on('failed', (job, err) => {
    console.log(`[worker] Job ${job?.id ?? '?'} failed: ${err.message}`);
  });
  worker.on('error', (err) => {
    console.error(`[worker] Worker error: ${err.message}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received — draining in-flight jobs...`);
    try {
      await worker.close();
      await shutdownTenantAsyncExecutionCoordinator().catch(() => {});
      console.log('[worker] Worker drained and closed.');
    } catch (err: any) {
      console.error(`[worker] Error during shutdown: ${err.message}`);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(`[worker] FATAL: ${err.message}`);
  process.exit(1);
});
