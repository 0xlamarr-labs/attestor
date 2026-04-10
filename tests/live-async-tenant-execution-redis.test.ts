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
  getTenantAsyncExecutionCoordinatorStatus,
  resetTenantAsyncExecutionCoordinatorForTests,
  shutdownTenantAsyncExecutionCoordinator,
} from '../src/service/async-tenant-execution.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompletion(queue: ReturnType<typeof createPipelineQueue>, jobId: string, timeoutMs: number = 6_000): Promise<PipelineJobResult> {
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
    ATTESTOR_ASYNC_ACTIVE_LEASE_MS: process.env.ATTESTOR_ASYNC_ACTIVE_LEASE_MS,
    ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS: process.env.ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS,
    ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS: process.env.ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS,
    ATTESTOR_ASYNC_WORKER_CONCURRENCY: process.env.ATTESTOR_ASYNC_WORKER_CONCURRENCY,
    ATTESTOR_ASYNC_ACTIVE_REDIS_URL: process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL,
    ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS: process.env.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS,
  };

  const redis = new RedisMemoryServer();
  const host = await redis.getHost();
  const port = await redis.getPort();
  const redisUrl = `redis://${host}:${port}`;
  const queueName = `attestor-active-execution-${Date.now().toString(36)}`;

  process.env.ATTESTOR_ASYNC_ACTIVE_LEASE_MS = '1200';
  process.env.ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS = '150';
  process.env.ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS = '1';
  process.env.ATTESTOR_ASYNC_WORKER_CONCURRENCY = '2';
  process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL = redisUrl;
  // Keep weighted dispatch effectively out of the way here so this suite stays focused
  // on active-execution isolation rather than plan-level fairness.
  process.env.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS = '1';

  const startTimes = new Map<string, number[]>();
  let concurrentRunning = 0;
  let peakConcurrentRunning = 0;

  const queue = createPipelineQueue({ redisUrl, queueName });
  const worker = createPipelineWorker({
    redisUrl,
    queueName,
    processJob: async (job) => {
      const tenantId = job.data.tenant.tenantId;
      const existing = startTimes.get(tenantId) ?? [];
      existing.push(Date.now());
      startTimes.set(tenantId, existing);
      concurrentRunning += 1;
      peakConcurrentRunning = Math.max(peakConcurrentRunning, concurrentRunning);
      await sleep(350);
      concurrentRunning -= 1;
      return {
        runId: `test-${job.id}`,
        decision: 'approve',
        proofMode: 'live',
        certificateId: null,
        completedAt: new Date().toISOString(),
        durationMs: 350,
      };
    },
  });

  try {
    console.log('\n[Live Async Tenant Execution Redis]');

    configureTenantAsyncExecutionCoordinator({ redisUrl, redisMode: 'embedded-test' });
    await resetTenantAsyncExecutionCoordinatorForTests();

    const coordinator = getTenantAsyncExecutionCoordinatorStatus();
    ok(coordinator.backend === 'redis', 'Async execution coordinator: backend reports redis');
    ok(coordinator.shared === true, 'Async execution coordinator: shared mode reports true');

    const tenantAJob1 = await submitPipelineJob(queue, {
      runId: 'tenant-a-1',
      candidateSql: 'select 1 as n',
      intent: { label: 'tenant-a-1' },
    }, {
      tenantId: 'tenant-a',
      planId: 'starter',
      source: 'live-test',
    });
    const tenantAJob2 = await submitPipelineJob(queue, {
      runId: 'tenant-a-2',
      candidateSql: 'select 2 as n',
      intent: { label: 'tenant-a-2' },
    }, {
      tenantId: 'tenant-a',
      planId: 'starter',
      source: 'live-test',
    });

    await sleep(120);
    const snapshotWhileRunning = await getTenantAsyncQueueSnapshot(queue, 'tenant-a', 'starter');
    ok(snapshotWhileRunning.activeExecutionLimit === 1, 'Async execution cap: starter active limit is 1');
    ok(snapshotWhileRunning.activeExecutions === 1, 'Async execution cap: only one tenant-a job is actively running');
    ok(snapshotWhileRunning.activeExecutionBackend === 'redis', 'Async execution cap: snapshot reports redis backend');
    ok(snapshotWhileRunning.pendingJobs >= 1, 'Async execution cap: second tenant-a job remains queued/delayed');

    await waitForCompletion(queue, tenantAJob1.jobId);
    await waitForCompletion(queue, tenantAJob2.jobId);

    const tenantAStarts = startTimes.get('tenant-a') ?? [];
    ok(tenantAStarts.length === 2, 'Async execution cap: both tenant-a jobs eventually ran');
    ok(tenantAStarts[1] - tenantAStarts[0] >= 250, 'Async execution cap: second tenant-a job waited for the first slot to free');

    startTimes.clear();
    concurrentRunning = 0;
    peakConcurrentRunning = 0;

    const tenantBJob = await submitPipelineJob(queue, {
      runId: 'tenant-b',
      candidateSql: 'select 3 as n',
      intent: { label: 'tenant-b' },
    }, {
      tenantId: 'tenant-b',
      planId: 'starter',
      source: 'live-test',
    });
    const tenantCJob = await submitPipelineJob(queue, {
      runId: 'tenant-c',
      candidateSql: 'select 4 as n',
      intent: { label: 'tenant-c' },
    }, {
      tenantId: 'tenant-c',
      planId: 'starter',
      source: 'live-test',
    });

    await waitForCompletion(queue, tenantBJob.jobId);
    await waitForCompletion(queue, tenantCJob.jobId);

    const tenantBStarts = startTimes.get('tenant-b') ?? [];
    const tenantCStarts = startTimes.get('tenant-c') ?? [];
    ok(tenantBStarts.length === 1 && tenantCStarts.length === 1, 'Async execution cap: distinct tenants both ran once');
    ok(Math.abs(tenantBStarts[0] - tenantCStarts[0]) < 250, 'Async execution cap: distinct tenants can start concurrently');
    ok(peakConcurrentRunning >= 2, 'Async execution cap: worker concurrency still usable across different tenants');

    console.log(`  Live async tenant execution tests: ${passed} passed, 0 failed`);
  } finally {
    try { await worker.close(); } catch {}
    try { await queue.close(); } catch {}
    await shutdownTenantAsyncExecutionCoordinator().catch(() => {});
    try { await redis.stop(); } catch {}
    if (previousEnv.ATTESTOR_ASYNC_ACTIVE_LEASE_MS === undefined) delete process.env.ATTESTOR_ASYNC_ACTIVE_LEASE_MS; else process.env.ATTESTOR_ASYNC_ACTIVE_LEASE_MS = previousEnv.ATTESTOR_ASYNC_ACTIVE_LEASE_MS;
    if (previousEnv.ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS === undefined) delete process.env.ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS; else process.env.ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS = previousEnv.ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS;
    if (previousEnv.ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS === undefined) delete process.env.ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS; else process.env.ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS = previousEnv.ATTESTOR_ASYNC_ACTIVE_STARTER_JOBS;
    if (previousEnv.ATTESTOR_ASYNC_WORKER_CONCURRENCY === undefined) delete process.env.ATTESTOR_ASYNC_WORKER_CONCURRENCY; else process.env.ATTESTOR_ASYNC_WORKER_CONCURRENCY = previousEnv.ATTESTOR_ASYNC_WORKER_CONCURRENCY;
    if (previousEnv.ATTESTOR_ASYNC_ACTIVE_REDIS_URL === undefined) delete process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL; else process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL = previousEnv.ATTESTOR_ASYNC_ACTIVE_REDIS_URL;
    if (previousEnv.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS === undefined) delete process.env.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS; else process.env.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS = previousEnv.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS;
  }
}

main().catch((error) => {
  console.error('\nLive async tenant execution tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
