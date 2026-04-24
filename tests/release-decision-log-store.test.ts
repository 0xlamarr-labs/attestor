import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import type { ReleaseDecisionLogMetadata } from '../src/release-kernel/release-decision-log.js';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  getReleaseAuthorityComponent,
  withReleaseAuthorityTransaction,
} from '../src/service/release-authority-store.js';
import {
  SharedReleaseDecisionLogStoreError,
  createSharedReleaseDecisionLogStore,
  ensureSharedReleaseDecisionLogStore,
  resetSharedReleaseDecisionLogStoreForTests,
} from '../src/service/release-decision-log-store.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function makeDecision(status: 'hold' | 'review-required' | 'accepted') {
  return createReleaseDecisionSkeleton({
    id: `decision-${status}-${Math.random().toString(16).slice(2, 10)}`,
    createdAt: '2026-04-24T18:00:00.000Z',
    status,
    policyVersion: 'finance.structured-record-release.v1',
    policyHash: 'finance.structured-record-release.v1',
    outputHash: `sha256:output-${status}`,
    consequenceHash: `sha256:consequence-${status}`,
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    capabilityBoundary: {
      allowedTools: ['xbrl-export'],
      allowedTargets: ['sec.edgar.filing.prepare'],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.reporting-bot',
      type: 'service',
    },
    target: {
      kind: 'record-store',
      id: 'finance.reporting.record-store',
    },
  });
}

function makeMetadata(
  input: Partial<ReleaseDecisionLogMetadata> = {},
): ReleaseDecisionLogMetadata {
  return {
    policyMatched: true,
    pendingChecks: ['contract-shape'],
    pendingEvidenceKinds: ['trace'],
    requiresReview: true,
    deterministicChecksCompleted: false,
    effectivePolicyId: 'finance.structured-record-release.v1',
    rolloutMode: 'enforce',
    rolloutEvaluationMode: 'enforce',
    rolloutReason: 'enforce',
    rolloutCanaryBucket: null,
    rolloutFallbackPolicyId: null,
    ...input,
  };
}

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-release-decision-log-store-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(tempRoot, 'pg'),
    user: 'release_decision_log',
    password: 'release_decision_log',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_release_authority');
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://release_decision_log:release_decision_log@localhost:${pgPort}/attestor_release_authority`;

    const store = createSharedReleaseDecisionLogStore();
    const bootSummary = await ensureSharedReleaseDecisionLogStore();
    equal(
      bootSummary.entryCount,
      0,
      'Shared release decision log: boot summary starts empty',
    );
    equal(
      bootSummary.componentStatus,
      'ready',
      'Shared release decision log: component is marked ready once the shared store exists',
    );
    equal(
      bootSummary.latestEntryDigest,
      null,
      'Shared release decision log: empty store has no latest digest',
    );

    const component = await getReleaseAuthorityComponent('release-decision-log');
    equal(
      String(component?.metadata.trackerStep),
      '03',
      'Shared release decision log: component registry records the owning tracker step',
    );
    equal(
      String(component?.metadata.bootstrapWired),
      'false',
      'Shared release decision log: component metadata truthfully records runtime wiring as still pending',
    );

    const firstEntry = await store.append({
      occurredAt: '2026-04-24T18:00:00.000Z',
      requestId: 'req-shared-1',
      phase: 'policy-resolution',
      matchedPolicyId: 'finance.structured-record-release.v1',
      decision: makeDecision('hold'),
      metadata: makeMetadata(),
    });
    const secondEntry = await store.append({
      occurredAt: '2026-04-24T18:00:01.000Z',
      requestId: 'req-shared-1',
      phase: 'deterministic-checks',
      matchedPolicyId: 'finance.structured-record-release.v1',
      decision: makeDecision('review-required'),
      metadata: makeMetadata({
        pendingChecks: [],
        pendingEvidenceKinds: [],
        deterministicChecksCompleted: true,
      }),
    });

    equal(firstEntry.sequence, 1, 'Shared release decision log: first append starts at sequence 1');
    equal(secondEntry.sequence, 2, 'Shared release decision log: second append increments sequence');
    equal(
      secondEntry.previousEntryDigest,
      firstEntry.entryDigest,
      'Shared release decision log: later entries bind to the previous digest',
    );

    const persistedEntries = await store.entries();
    equal(
      persistedEntries.length,
      2,
      'Shared release decision log: entries reload durably from PostgreSQL',
    );
    ok(
      (await store.verify()).valid,
      'Shared release decision log: persisted chain verifies after reload',
    );
    equal(
      await store.latestEntryDigest(),
      secondEntry.entryDigest,
      'Shared release decision log: latest digest matches the last appended entry',
    );

    const concurrentEntries = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        store.append({
          occurredAt: `2026-04-24T18:00:${String(index + 2).padStart(2, '0')}.000Z`,
          requestId: `req-shared-concurrent-${index + 1}`,
          phase: 'review',
          matchedPolicyId: 'finance.structured-record-release.v1',
          decision: makeDecision(index % 2 === 0 ? 'review-required' : 'accepted'),
          metadata: makeMetadata({
            pendingChecks: [],
            pendingEvidenceKinds: [],
            requiresReview: index % 2 === 0,
            deterministicChecksCompleted: true,
          }),
        }),
      ),
    );

    equal(
      concurrentEntries.length,
      6,
      'Shared release decision log: concurrent appends all complete',
    );
    const allEntries = await store.entries();
    equal(
      allEntries.length,
      8,
      'Shared release decision log: concurrent appends extend the same durable chain',
    );
    ok(
      allEntries.every((entry, index) => entry.sequence === index + 1),
      'Shared release decision log: concurrent appends still produce contiguous durable ordering',
    );

    const filteredEntries = await store.entries({ requestId: 'req-shared-1' });
    equal(
      filteredEntries.length,
      2,
      'Shared release decision log: requestId filter returns the matching chain slice',
    );

    await withReleaseAuthorityTransaction(async (client) => {
      await client.query(
        `UPDATE attestor_release_authority.release_decision_log_entries
            SET entry_json = jsonb_set(entry_json, '{decisionStatus}', '\"denied\"'::jsonb)
          WHERE sequence = 2`,
      );
    });

    await assert.rejects(
      store.entries(),
      SharedReleaseDecisionLogStoreError,
      'Shared release decision log: tampered persisted entry fails closed on reload',
    );
    passed += 1;
  } finally {
    await resetSharedReleaseDecisionLogStoreForTests();
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    try {
      await pg.stop();
    } catch {}
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }

  console.log(`Shared release decision log store tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Shared release decision log store tests failed:', error);
  process.exit(1);
});
