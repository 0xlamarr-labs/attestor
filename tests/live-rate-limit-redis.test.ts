import { strict as assert } from 'node:assert';
import { RedisMemoryServer } from 'redis-memory-server';
import {
  configureTenantRateLimiter,
  getTenantPipelineRateLimit,
  reserveTenantPipelineRequest,
  resetTenantRateLimiterForTests,
  shutdownTenantRateLimiter,
} from '../src/service/rate-limit.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  const previousEnv = {
    ATTESTOR_RATE_LIMIT_WINDOW_SECONDS: process.env.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS,
    ATTESTOR_RATE_LIMIT_STARTER_REQUESTS: process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS,
    ATTESTOR_RATE_LIMIT_REDIS_URL: process.env.ATTESTOR_RATE_LIMIT_REDIS_URL,
  };

  const redis = new RedisMemoryServer();
  const host = await redis.getHost();
  const port = await redis.getPort();
  const redisUrl = `redis://${host}:${port}`;

  try {
    console.log('\n[Live Shared Redis Rate Limit]');

    process.env.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS = '2';
    process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS = '2';
    process.env.ATTESTOR_RATE_LIMIT_REDIS_URL = redisUrl;

    configureTenantRateLimiter({ redisUrl, redisMode: 'embedded-test' });
    await resetTenantRateLimiterForTests();

    const initial = await getTenantPipelineRateLimit('tenant-redis', 'starter');
    ok(initial.backend === 'redis', 'Redis Rate Limit: backend reports redis');
    ok(initial.used === 0, 'Redis Rate Limit: initial usage is zero');

    const first = await reserveTenantPipelineRequest('tenant-redis', 'starter');
    ok(first.allowed === true, 'Redis Rate Limit: first request allowed');
    ok(first.rateLimit.used === 1, 'Redis Rate Limit: first request increments usage');

    await shutdownTenantRateLimiter();

    const afterReconnect = await getTenantPipelineRateLimit('tenant-redis', 'starter');
    ok(afterReconnect.backend === 'redis', 'Redis Rate Limit: backend stays redis after reconnect');
    ok(afterReconnect.used === 1, 'Redis Rate Limit: usage survives local disconnect via shared Redis');

    const second = await reserveTenantPipelineRequest('tenant-redis', 'starter');
    ok(second.allowed === true, 'Redis Rate Limit: second request allowed');
    ok(second.rateLimit.used === 2, 'Redis Rate Limit: second request reaches limit');

    const denied = await reserveTenantPipelineRequest('tenant-redis', 'starter');
    ok(denied.allowed === false, 'Redis Rate Limit: third request denied at limit');
    ok(denied.rateLimit.used === 2, 'Redis Rate Limit: denied request does not over-increment usage');

    await new Promise((resolve) => setTimeout(resolve, 2200));

    const resetWindow = await reserveTenantPipelineRequest('tenant-redis', 'starter');
    ok(resetWindow.allowed === true, 'Redis Rate Limit: new window allows request again');
    ok(resetWindow.rateLimit.used === 1, 'Redis Rate Limit: new window resets usage to 1');

    console.log(`  Live shared Redis rate-limit tests: ${passed} passed, 0 failed`);
  } finally {
    await resetTenantRateLimiterForTests();
    try { await redis.stop(); } catch {}
    if (previousEnv.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS === undefined) delete process.env.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS; else process.env.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS = previousEnv.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS;
    if (previousEnv.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS === undefined) delete process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS; else process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS = previousEnv.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS;
    if (previousEnv.ATTESTOR_RATE_LIMIT_REDIS_URL === undefined) delete process.env.ATTESTOR_RATE_LIMIT_REDIS_URL; else process.env.ATTESTOR_RATE_LIMIT_REDIS_URL = previousEnv.ATTESTOR_RATE_LIMIT_REDIS_URL;
  }
}

main().catch((error) => {
  console.error('\nLive shared Redis rate-limit tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
