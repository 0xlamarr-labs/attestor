import { strict as assert } from 'node:assert';
import { RedisMemoryServer } from 'redis-memory-server';
import {
  createPipelineQueue,
  createPipelineWorker,
  getJobStatus,
  getTenantAsyncQueueSnapshot,
  submitPipelineJob,
  type PipelineJobResult,
} from '../src/service/async-pipeline.js';
import {
  configureTenantAsyncExecutionCoordinator,
  resetTenantAsyncExecutionCoordinatorForTests,
  shutdownTenantAsyncExecutionCoordinator,
} from '../src/service/async-tenant-execution.js';
import {
  configureTenantAsyncWeightedDispatchCoordinator,
  getTenantAsyncWeightedDispatchCoordinatorStatus,
  resetTenantAsyncWeightedDispatchCoordinatorForTests,
  shutdownTenantAsyncWeightedDispatchCoordinator,
} from '../src/service/async-weighted-dispatch.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompletion(
  queue: ReturnType<typeof createPipelineQueue>,
  jobId: string,
  timeoutMs: number = 8_000,
): Promise<PipelineJobResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getJobStatus(queue, jobId);
    if (status.status === 'completed') return status.result!;
    if (status.status === 'failed') {
      throw new Error(`Async job ${jobId} failed unexpectedly: ${status.error}`);
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for async job ${jobId} to complete.`);
}

async function main(): Promise<void> {
  const previousEnv = {
    ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS: process.env.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS,
    ATTESTOR_ASYNC_DISPATCH_REDIS_URL: process.env.ATTESTOR_ASYNC_DISPATCH_REDIS_URL,
    ATTESTOR_ASYNC_ACTIVE_REDIS_URL: process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL,
    ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS: process.env.ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS,
    ATTESTOR_ASYNC_ACTIVE_PRO_JOBS: process.env.ATTESTOR_ASYNC_ACTIVE_PRO_JOBS,
    ATTESTOR_ASYNC_WORKER_CONCURRENCY: process.env.ATTESTOR_ASYNC_WORKER_CONCURRENCY,
  };

  const redis = new RedisMemoryServer();
  const host = await redis.getHost();
  const port = await redis.getPort();
  const redisUrl = `redis://${host}:${port}`;
  const queueName = `attestor-weighted-dispatch-${Date.now().toString(36)}`;

  process.env.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS = '400';
  process.env.ATTESTOR_ASYNC_DISPATCH_REDIS_URL = redisUrl;
  process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL = redisUrl;
  process.env.ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS = '4';
  process.env.ATTESTOR_ASYNC_ACTIVE_PRO_JOBS = '4';
  process.env.ATTESTOR_ASYNC_WORKER_CONCURRENCY = '4';

  const planStarts = new Map<string, number[]>();

  const queue = createPipelineQueue({ redisUrl, queueName });
  const worker = createPipelineWorker({
    redisUrl,
    queueName,
    processJob: async (job) => {
      const planId = job.data.tenant.planId ?? 'community';
      const planEntries = planStarts.get(planId) ?? [];
      planEntries.push(Date.now());
      planStarts.set(planId, planEntries);
      await sleep(80);
      return {
        runId: `weighted-${job.id}`,
        decision: 'approve',
        proofMode: 'live',
        certificateId: null,
        completedAt: new Date().toISOString(),
        durationMs: 80,
      };
    },
  });

  try {
    console.log('\n[Live Async Weighted Dispatch Redis]');

    configureTenantAsyncExecutionCoordinator({ redisUrl, redisMode: 'embedded-test' });
    configureTenantAsyncWeightedDispatchCoordinator({ redisUrl, redisMode: 'embedded-test' });
    await resetTenantAsyncExecutionCoordinatorForTests();
    await resetTenantAsyncWeightedDispatchCoordinatorForTests();

    const coordinator = getTenantAsyncWeightedDispatchCoordinatorStatus();
    ok(coordinator.backend === 'redis', 'Weighted dispatch: backend reports redis');
    ok(coordinator.shared === true, 'Weighted dispatch: shared mode reports true');

    const starterA = await submitPipelineJob(queue, {
      runId: 'starter-a',
      candidateSql: 'select 1 as n',
      intent: { label: 'starter-a' },
    }, {
      tenantId: 'starter-a',
      planId: 'starter',
      source: 'live-test',
    });
    const starterB = await submitPipelineJob(queue, {
      runId: 'starter-b',
      candidateSql: 'select 2 as n',
      intent: { label: 'starter-b' },
    }, {
      tenantId: 'starter-b',
      planId: 'starter',
      source: 'live-test',
    });
    const proA = await submitPipelineJob(queue, {
      runId: 'pro-a',
      candidateSql: 'select 3 as n',
      intent: { label: 'pro-a' },
    }, {
      tenantId: 'pro-a',
      planId: 'pro',
      source: 'live-test',
    });
    const proB = await submitPipelineJob(queue, {
      runId: 'pro-b',
      candidateSql: 'select 4 as n',
      intent: { label: 'pro-b' },
    }, {
      tenantId: 'pro-b',
      planId: 'pro',
      source: 'live-test',
    });

    await sleep(150);

    const starterSnapshot = await getTenantAsyncQueueSnapshot(queue, 'starter-a', 'starter');
    ok(starterSnapshot.weightedDispatchEnforced === true, 'Weighted dispatch: starter snapshot reports enforcement');
    ok(starterSnapshot.weightedDispatchBackend === 'redis', 'Weighted dispatch: starter snapshot reports redis backend');
    ok(starterSnapshot.weightedDispatchWeight === 1, 'Weighted dispatch: starter weight = 1');
    ok(starterSnapshot.weightedDispatchWindowMs === 400, 'Weighted dispatch: starter dispatch window = 400ms');

    const proSnapshot = await getTenantAsyncQueueSnapshot(queue, 'pro-a', 'pro');
    ok(proSnapshot.weightedDispatchWeight === 2, 'Weighted dispatch: pro weight = 2');
    ok(proSnapshot.weightedDispatchWindowMs === 200, 'Weighted dispatch: pro dispatch window = 200ms');

    await waitForCompletion(queue, starterA.jobId);
    await waitForCompletion(queue, starterB.jobId);
    await waitForCompletion(queue, proA.jobId);
    await waitForCompletion(queue, proB.jobId);

    const starterStarts = (planStarts.get('starter') ?? []).sort((a, b) => a - b);
    const proStarts = (planStarts.get('pro') ?? []).sort((a, b) => a - b);
    ok(starterStarts.length === 2, 'Weighted dispatch: both starter jobs ran');
    ok(proStarts.length === 2, 'Weighted dispatch: both pro jobs ran');

    const starterDelta = starterStarts[1] - starterStarts[0];
    const proDelta = proStarts[1] - proStarts[0];
    ok(starterDelta >= 300, 'Weighted dispatch: starter jobs are spaced by the slower dispatch window');
    ok(proDelta >= 140, 'Weighted dispatch: pro jobs are still dispatch-gated, not concurrent');
    ok(proDelta < starterDelta, 'Weighted dispatch: pro plan gets a shorter shared dispatch interval than starter');

    console.log(`  Live async weighted dispatch tests: ${passed} passed, 0 failed`);
  } finally {
    try { await worker.close(); } catch {}
    try { await queue.close(); } catch {}
    await shutdownTenantAsyncExecutionCoordinator().catch(() => {});
    await shutdownTenantAsyncWeightedDispatchCoordinator().catch(() => {});
    try { await redis.stop(); } catch {}

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error('\nLive async weighted dispatch tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
