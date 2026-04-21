import assert from 'node:assert/strict';
import {
  createPipelineDeadLetterService,
  type PipelineDeadLetterServiceDeps,
} from '../src/service/application/pipeline-dead-letter-service.js';
import type { AsyncDeadLetterRecord } from '../src/service/async-dead-letter-store.js';

const record: AsyncDeadLetterRecord = {
  jobId: 'job_123',
  name: 'pipeline-run',
  backendMode: 'in_process',
  tenantId: 'tenant_123',
  planId: 'pro',
  state: 'failed',
  failedReason: 'boom',
  attemptsMade: 1,
  maxAttempts: 1,
  requestedAt: '2026-04-21T10:00:00.000Z',
  submittedAt: '2026-04-21T10:00:00.000Z',
  processedAt: '2026-04-21T10:00:01.000Z',
  failedAt: '2026-04-21T10:00:01.000Z',
  recordedAt: '2026-04-21T10:00:01.000Z',
};

function createDeps(calls: AsyncDeadLetterRecord[]): PipelineDeadLetterServiceDeps {
  return {
    async upsertDeadLetterRecord(input) {
      calls.push(input);
      return {
        record: input,
        path: '.attestor/async-dlq.json',
      };
    },
  };
}

async function testDeadLetterServiceDelegatesRecordUpsert(): Promise<void> {
  const calls: AsyncDeadLetterRecord[] = [];
  const service = createPipelineDeadLetterService(createDeps(calls));

  const result = await service.record(record);

  assert.equal(result.record.jobId, 'job_123');
  assert.equal(result.path, '.attestor/async-dlq.json');
  assert.deepEqual(calls, [record]);
}

await testDeadLetterServiceDelegatesRecordUpsert();

console.log('Service pipeline dead letter service tests: 1 passed, 0 failed');
