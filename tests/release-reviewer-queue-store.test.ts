import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import {
  buildFinanceFilingReleaseMaterial,
  buildFinanceFilingReleaseObservation,
  createFinanceFilingReleaseCandidateFromReport,
  finalizeFinanceFilingReleaseDecision,
} from '../src/release-kernel/finance-record-release.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';
import { createInMemoryReleaseDecisionLogWriter } from '../src/release-kernel/release-decision-log.js';
import {
  applyReviewerDecision,
  createFinanceReviewerQueueItem,
} from '../src/release-kernel/reviewer-queue.js';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  getReleaseAuthorityComponent,
} from '../src/service/release-authority-store.js';
import {
  createSharedReleaseReviewerQueueStore,
  ensureSharedReleaseReviewerQueueStore,
  resetSharedReleaseReviewerQueueStoreForTests,
} from '../src/service/release-reviewer-queue-store.js';

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

function makeFinanceReport(runId: string, exposureUsd: number) {
  return {
    runId,
    decision: 'pending_approval',
    certificate: { certificateId: `cert_${runId}` },
    evidenceChain: { terminalHash: `chain_${runId}`, intact: true },
    execution: {
      success: true,
      rows: [
        {
          counterparty_name: 'Bank of Nova Scotia',
          exposure_usd: exposureUsd,
          credit_rating: 'AA-',
          sector: 'Banking',
        },
      ],
    },
    liveProof: {
      mode: 'live_runtime',
      consistent: true,
    },
    receipt: {
      receiptStatus: 'withheld',
    },
    oversight: {
      status: 'pending',
    },
    escrow: {
      state: 'held',
    },
    filingReadiness: {
      status: 'internal_report_ready',
    },
    audit: {
      chainIntact: true,
    },
    attestation: {
      manifestHash: `manifest_${runId}`,
    },
  } as any;
}

function makeQueueItem(runId: string, exposureUsd: number) {
  const report = makeFinanceReport(runId, exposureUsd);
  const candidate = createFinanceFilingReleaseCandidateFromReport(report);
  assert.ok(candidate, 'expected finance filing candidate');
  const material = buildFinanceFilingReleaseMaterial(candidate);
  const decisionLog = createInMemoryReleaseDecisionLogWriter();
  const engine = createReleaseDecisionEngine({ decisionLog });
  const evaluation = engine.evaluateWithDeterministicChecks(
    {
      id: `decision-${runId}`,
      createdAt: '2026-04-24T18:30:00.000Z',
      outputHash: material.hashBundle.outputHash,
      consequenceHash: material.hashBundle.consequenceHash,
      outputContract: material.outputContract,
      capabilityBoundary: material.capabilityBoundary,
      requester: {
        id: 'svc.attestor.api',
        type: 'service',
        displayName: 'Attestor API',
      },
      target: material.target,
    },
    buildFinanceFilingReleaseObservation(material, report),
  );
  const finalized = finalizeFinanceFilingReleaseDecision(evaluation.decision, report);
  return createFinanceReviewerQueueItem({
    decision: finalized,
    candidate,
    report,
    logEntries: decisionLog.entries(),
  });
}

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-release-reviewer-queue-store-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(tempRoot, 'pg'),
    user: 'release_reviewer_queue',
    password: 'release_reviewer_queue',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_release_authority');
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://release_reviewer_queue:release_reviewer_queue@localhost:${pgPort}/attestor_release_authority`;

    const store = createSharedReleaseReviewerQueueStore();
    const bootSummary = await ensureSharedReleaseReviewerQueueStore();
    equal(bootSummary.totalRecords, 0, 'Shared reviewer queue: boot summary starts empty');
    equal(bootSummary.componentStatus, 'ready', 'Shared reviewer queue: component is ready after bootstrap');

    const component = await getReleaseAuthorityComponent('release-reviewer-queue');
    equal(
      String(component?.metadata.claimDiscipline),
      'for-update-skip-locked',
      'Shared reviewer queue: component registry records claim discipline',
    );
    equal(
      String(component?.metadata.bootstrapWired),
      'false',
      'Shared reviewer queue: component metadata truthfully records runtime wiring as pending',
    );

    const first = makeQueueItem('shared-review-1', 250000000);
    const second = makeQueueItem('shared-review-2', 185000000);
    await store.upsert(first);
    await store.upsert(second);

    equal((await store.summary()).pendingRecords, 2, 'Shared reviewer queue: summary counts pending records');
    equal((await store.listPending()).totalPending, 2, 'Shared reviewer queue: pending list returns both items');
    equal(
      (await store.get(first.detail.id))?.candidate.rowCount,
      1,
      'Shared reviewer queue: detail lookup reloads record JSON from PostgreSQL',
    );

    const activeClaimedAt = new Date().toISOString();
    const reclaimedAt = new Date(Date.parse(activeClaimedAt) + 30_000).toISOString();
    const expiredLeaseClaimedAt = new Date(Date.parse(activeClaimedAt) + 4 * 60_000).toISOString();
    const [claimA, claimB, claimC] = await Promise.all([
      store.claimNextPending({
        claimedBy: 'worker-a',
        claimedAt: activeClaimedAt,
        leaseMs: 60_000,
      }),
      store.claimNextPending({
        claimedBy: 'worker-b',
        claimedAt: activeClaimedAt,
        leaseMs: 60_000,
      }),
      store.claimNextPending({
        claimedBy: 'worker-c',
        claimedAt: activeClaimedAt,
        leaseMs: 60_000,
      }),
    ]);
    ok(claimA, 'Shared reviewer queue: first concurrent consumer claims an item');
    ok(claimB, 'Shared reviewer queue: second concurrent consumer claims an item');
    equal(claimC, null, 'Shared reviewer queue: third concurrent consumer gets no duplicate claim');
    ok(
      claimA!.record.detail.id !== claimB!.record.detail.id,
      'Shared reviewer queue: concurrent claims pick distinct pending items',
    );
    equal((await store.summary()).activeClaims, 2, 'Shared reviewer queue: active claim count reflects leases');
    equal(
      (await store.listPending()).totalPending,
      2,
      'Shared reviewer queue: deterministic pending view does not hide claimed records',
    );

    equal(
      await store.releaseClaim({
        reviewId: claimA!.record.detail.id,
        claimToken: 'wrong-token',
      }),
      false,
      'Shared reviewer queue: wrong claim token cannot release a claim',
    );
    equal(
      await store.releaseClaim({
        reviewId: claimA!.record.detail.id,
        claimToken: claimA!.claimToken,
      }),
      true,
      'Shared reviewer queue: matching claim token releases a claim',
    );

    const reclaimed = await store.claimNextPending({
      claimedBy: 'worker-d',
      claimedAt: reclaimedAt,
      leaseMs: 60_000,
    });
    equal(
      reclaimed?.record.detail.id,
      claimA!.record.detail.id,
      'Shared reviewer queue: released claim becomes claimable again',
    );

    const approved = applyReviewerDecision({
      record: first,
      outcome: 'approved',
      reviewerId: 'reviewer.alpha',
      reviewerName: 'Alpha Reviewer',
      reviewerRole: 'financial_reporting_manager',
      decidedAt: '2026-04-24T18:33:00.000Z',
    });
    await store.upsert(approved.record);
    equal(
      (await store.getRecord(first.detail.id))?.detail.approvalsRecorded,
      1,
      'Shared reviewer queue: upsert preserves reviewer decision state',
    );

    const expiredClaim = await store.claimNextPending({
      claimedBy: 'worker-e',
      claimedAt: expiredLeaseClaimedAt,
      leaseMs: 60_000,
    });
    ok(
      expiredClaim,
      'Shared reviewer queue: expired leases become claimable without manual cleanup',
    );
  } finally {
    await resetSharedReleaseReviewerQueueStoreForTests();
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    try {
      await pg.stop();
    } catch {}
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }

  console.log(`Shared release reviewer queue store tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Shared release reviewer queue store tests failed:', error);
  process.exit(1);
});
