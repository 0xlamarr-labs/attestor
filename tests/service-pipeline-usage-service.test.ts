import assert from 'node:assert/strict';
import {
  createPipelineUsageService,
  type PipelineUsageServiceDeps,
} from '../src/service/application/pipeline-usage-service.js';
import type { TenantContext } from '../src/service/tenant-isolation.js';
import type { UsageContext } from '../src/service/usage-meter.js';

const tenant: TenantContext = {
  tenantId: 'tenant_123',
  tenantName: 'Acme',
  authenticatedAt: '2026-04-21T10:00:00.000Z',
  source: 'api_key',
  planId: 'pro',
  monthlyRunQuota: 10,
};

function usage(overrides: Partial<UsageContext> = {}): UsageContext {
  return {
    tenantId: 'tenant_123',
    planId: 'pro',
    meter: 'monthly_pipeline_runs',
    period: '2026-04',
    used: 3,
    quota: 10,
    remaining: 7,
    enforced: true,
    ...overrides,
  };
}

function createDeps(calls: string[]): PipelineUsageServiceDeps {
  return {
    async checkQuota(tenantId, planId, quota) {
      calls.push(`check:${tenantId}:${planId}:${quota}`);
      return {
        allowed: true,
        usage: usage(),
      };
    },
    async consumeRun(tenantId, planId, quota) {
      calls.push(`consume:${tenantId}:${planId}:${quota}`);
      return usage({ used: 4, remaining: 6 });
    },
  };
}

async function testUsageServiceChecksQuotaFromTenantContext(): Promise<void> {
  const calls: string[] = [];
  const service = createPipelineUsageService(createDeps(calls));

  const result = await service.check(tenant);

  assert.equal(result.allowed, true);
  assert.equal(result.usage.remaining, 7);
  assert.deepEqual(calls, ['check:tenant_123:pro:10']);
}

async function testUsageServiceConsumesRunFromTenantContext(): Promise<void> {
  const calls: string[] = [];
  const service = createPipelineUsageService(createDeps(calls));

  const result = await service.consume(tenant);

  assert.equal(result.used, 4);
  assert.equal(result.remaining, 6);
  assert.deepEqual(calls, ['consume:tenant_123:pro:10']);
}

await testUsageServiceChecksQuotaFromTenantContext();
await testUsageServiceConsumesRunFromTenantContext();

console.log('Service pipeline usage service tests: 2 passed, 0 failed');
