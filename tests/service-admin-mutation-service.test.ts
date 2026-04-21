import assert from 'node:assert/strict';
import {
  createAdminMutationService,
  type AdminMutationServiceDeps,
} from '../src/service/application/admin-mutation-service.js';
import type { AdminAuditRecord } from '../src/service/admin-audit-log.js';
import type { AdminIdempotencyRecord } from '../src/service/admin-idempotency-store.js';

const now = '2026-04-21T10:00:00.000Z';

function idempotencyRecord(overrides: Partial<AdminIdempotencyRecord> = {}): AdminIdempotencyRecord {
  return {
    id: 'idem_123',
    idempotencyKey: 'idem-key',
    routeId: 'admin.accounts.create',
    requestHash: 'hash-original',
    statusCode: 201,
    responseCiphertext: 'cipher',
    responseIv: 'iv',
    responseAuthTag: 'tag',
    createdAt: now,
    lastReplayedAt: null,
    replayCount: 0,
    ...overrides,
  };
}

function auditRecord(overrides: Partial<AdminAuditRecord> = {}): AdminAuditRecord {
  return {
    id: 'audit_123',
    occurredAt: now,
    actorType: 'admin_api_key',
    actorLabel: 'ATTESTOR_ADMIN_API_KEY',
    action: 'account.created',
    routeId: 'admin.accounts.create',
    accountId: null,
    tenantId: null,
    tenantKeyId: null,
    planId: null,
    monthlyRunQuota: null,
    idempotencyKey: null,
    requestHash: '',
    metadata: {},
    previousHash: null,
    eventHash: 'hash',
    ...overrides,
  };
}

function createDeps(overrides: Partial<AdminMutationServiceDeps> = {}): AdminMutationServiceDeps {
  const deps: AdminMutationServiceDeps = {
    hashJsonValue: (value) => `hash:${JSON.stringify(value)}`,
    lookupAdminIdempotencyState: async () => ({
      kind: 'miss',
      requestHash: 'hash-miss',
    }),
    recordAdminIdempotencyState: async () => ({
      record: idempotencyRecord(),
      path: null,
    }),
    appendAdminAuditRecordState: async (input) => ({
      record: auditRecord({
        action: input.action,
        routeId: input.routeId,
        requestHash: input.requestHash,
      }),
      path: null,
    }),
  };
  return {
    ...deps,
    ...overrides,
  };
}

async function testBeginWithoutIdempotencyUsesDeterministicHash(): Promise<void> {
  let lookupCalled = false;
  const service = createAdminMutationService(createDeps({
    lookupAdminIdempotencyState: async () => {
      lookupCalled = true;
      return { kind: 'miss', requestHash: 'unused' };
    },
  }));

  const result = await service.begin({
    idempotencyKey: null,
    routeId: 'admin.accounts.create',
    requestPayload: { accountName: 'Acme' },
  });

  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') {
    assert.equal(result.idempotencyKey, null);
    assert.match(result.requestHash, /^hash:/u);
  }
  assert.equal(lookupCalled, false);
}

async function testBeginMapsIdempotencyConflict(): Promise<void> {
  const service = createAdminMutationService(createDeps({
    lookupAdminIdempotencyState: async () => ({
      kind: 'conflict',
      requestHash: 'hash-new',
      record: idempotencyRecord({
        routeId: 'admin.tenant_keys.rotate',
      }),
    }),
  }));

  const result = await service.begin({
    idempotencyKey: 'idem-key',
    routeId: 'admin.accounts.create',
    requestPayload: { accountName: 'Acme' },
  });

  assert.equal(result.kind, 'conflict');
  if (result.kind === 'conflict') {
    assert.equal(result.statusCode, 409);
    assert.equal(result.responseBody.routeId, 'admin.tenant_keys.rotate');
  }
}

async function testBeginMapsIdempotencyReplay(): Promise<void> {
  const service = createAdminMutationService(createDeps({
    lookupAdminIdempotencyState: async () => ({
      kind: 'replay',
      requestHash: 'hash-replay',
      record: idempotencyRecord({
        statusCode: 202,
      }),
      response: { job: { id: 'job_123' } },
    }),
  }));

  const result = await service.begin({
    idempotencyKey: 'idem-key',
    routeId: 'admin.queue.jobs.retry',
    requestPayload: { jobId: 'job_123' },
  });

  assert.equal(result.kind, 'replay');
  if (result.kind === 'replay') {
    assert.equal(result.statusCode, 202);
    assert.deepEqual(result.responseBody, { job: { id: 'job_123' } });
    assert.equal(result.headers['x-attestor-idempotent-replay'], 'true');
  }
}

async function testFinalizeRecordsIdempotencyAndAudit(): Promise<void> {
  const calls: string[] = [];
  const service = createAdminMutationService(createDeps({
    recordAdminIdempotencyState: async (input) => {
      calls.push(`idempotency:${input.idempotencyKey}:${input.statusCode}`);
      return {
        record: idempotencyRecord({
          idempotencyKey: input.idempotencyKey,
          routeId: input.routeId,
          statusCode: input.statusCode,
        }),
        path: null,
      };
    },
    appendAdminAuditRecordState: async (input) => {
      calls.push(`audit:${input.action}:${input.requestHash}`);
      return {
        record: auditRecord({
          action: input.action,
          routeId: input.routeId,
          requestHash: input.requestHash,
        }),
        path: null,
      };
    },
  }));

  const response = await service.finalize({
    idempotencyKey: 'idem-key',
    routeId: 'admin.accounts.create',
    requestPayload: { accountName: 'Acme' },
    statusCode: 201,
    responseBody: { account: { id: 'acct_123' } },
    audit: {
      action: 'account.created',
      requestHash: 'hash-ready',
    },
  });

  assert.deepEqual(response, { account: { id: 'acct_123' } });
  assert.deepEqual(calls, [
    'idempotency:idem-key:201',
    'audit:account.created:hash-ready',
  ]);
}

await testBeginWithoutIdempotencyUsesDeterministicHash();
await testBeginMapsIdempotencyConflict();
await testBeginMapsIdempotencyReplay();
await testFinalizeRecordsIdempotencyAndAudit();

console.log('Service admin mutation service tests: 4 passed, 0 failed');
