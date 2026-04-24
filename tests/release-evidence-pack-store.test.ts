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
  attachIssuedTokenToReviewerQueueRecord,
  createFinanceReviewerQueueItem,
} from '../src/release-kernel/reviewer-queue.js';
import { createReleaseEvidencePackIssuer } from '../src/release-kernel/release-evidence-pack.js';
import { createReleaseTokenIssuer } from '../src/release-kernel/release-token.js';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  getReleaseAuthorityComponent,
  withReleaseAuthorityTransaction,
} from '../src/service/release-authority-store.js';
import {
  SharedReleaseEvidencePackStoreError,
  createSharedReleaseEvidencePackStore,
  ensureSharedReleaseEvidencePackStore,
  resetSharedReleaseEvidencePackStoreForTests,
} from '../src/service/release-evidence-pack-store.js';

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

function makeFinanceReport() {
  return {
    runId: 'shared-release-evidence-pack',
    timestamp: '2026-04-24T19:30:00.000Z',
    decision: 'pending_approval',
    certificate: { certificateId: 'cert_shared_release_evidence_pack' },
    evidenceChain: { terminalHash: 'sha256:chain_terminal_shared_release_evidence_pack', intact: true },
    execution: {
      success: true,
      rows: [
        {
          counterparty_name: 'Bank of Nova Scotia',
          exposure_usd: 250000000,
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
      manifestHash: 'manifest_hash_shared_release_evidence_pack',
    },
  } as any;
}

async function makeEvidencePack() {
  const report = makeFinanceReport();
  const candidate = createFinanceFilingReleaseCandidateFromReport(report);
  assert.ok(candidate, 'expected finance filing candidate');
  const material = buildFinanceFilingReleaseMaterial(candidate);
  const decisionLog = createInMemoryReleaseDecisionLogWriter();
  const engine = createReleaseDecisionEngine({ decisionLog });
  const evaluation = engine.evaluateWithDeterministicChecks(
    {
      id: 'decision-shared-evidence-pack',
      createdAt: report.timestamp,
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
  const queueItem = createFinanceReviewerQueueItem({
    decision: finalized,
    candidate,
    report,
    logEntries: decisionLog.entries(),
  });
  const firstApproval = applyReviewerDecision({
    record: queueItem,
    outcome: 'approved',
    reviewerId: 'reviewer.alpha',
    reviewerName: 'Alpha Reviewer',
    reviewerRole: 'financial_reporting_manager',
    decidedAt: '2026-04-24T19:31:00.000Z',
  });
  const secondApproval = applyReviewerDecision({
    record: firstApproval.record,
    outcome: 'approved',
    reviewerId: 'reviewer.beta',
    reviewerName: 'Beta Reviewer',
    reviewerRole: 'financial_reporting_manager',
    decidedAt: '2026-04-24T19:32:00.000Z',
  });
  decisionLog.append({
    occurredAt: '2026-04-24T19:32:00.000Z',
    requestId: 'review:shared-release-evidence-pack:terminal-accept',
    phase: 'terminal-accept',
    matchedPolicyId: secondApproval.record.releaseDecision.policyVersion,
    decision: secondApproval.record.releaseDecision,
    metadata: {
      policyMatched: true,
      pendingChecks: [],
      pendingEvidenceKinds: [],
      requiresReview: false,
      deterministicChecksCompleted: true,
    },
  });

  const keys = generateKeyPair();
  const tokenIssuer = createReleaseTokenIssuer({
    issuer: 'attestor.release.shared',
    privateKeyPem: keys.privateKeyPem,
    publicKeyPem: keys.publicKeyPem,
  });
  const issuedToken = await tokenIssuer.issue({
    decision: secondApproval.record.releaseDecision,
    issuedAt: '2026-04-24T19:32:30.000Z',
  });
  const recordWithToken = attachIssuedTokenToReviewerQueueRecord({
    record: secondApproval.record,
    issuedToken,
  });
  const evidenceIssuer = createReleaseEvidencePackIssuer({
    issuer: 'attestor.release.shared',
    privateKeyPem: keys.privateKeyPem,
    publicKeyPem: keys.publicKeyPem,
  });
  return evidenceIssuer.issue({
    decision: {
      ...recordWithToken.releaseDecision,
      evidencePackId: 'ep_shared_release_evidence_pack',
    },
    evidencePackId: 'ep_shared_release_evidence_pack',
    issuedAt: '2026-04-24T19:33:00.000Z',
    decisionLogEntries: decisionLog.entries().filter((entry) => entry.decisionId === recordWithToken.releaseDecision.id),
    decisionLogChainIntact: decisionLog.verify().valid,
    review: recordWithToken.detail,
    releaseToken: issuedToken,
    artifactReferences: [
      {
        kind: 'provenance',
        path: 'finance-evidence-chain://shared-release-evidence-pack',
        digest: report.evidenceChain.terminalHash,
      },
    ],
  });
}

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-release-evidence-pack-store-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(tempRoot, 'pg'),
    user: 'release_evidence_pack',
    password: 'release_evidence_pack',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_release_authority');
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://release_evidence_pack:release_evidence_pack@localhost:${pgPort}/attestor_release_authority`;

    const store = createSharedReleaseEvidencePackStore();
    const bootSummary = await ensureSharedReleaseEvidencePackStore();
    equal(bootSummary.totalPacks, 0, 'Shared evidence pack: boot summary starts empty');
    equal(bootSummary.componentStatus, 'ready', 'Shared evidence pack: component is ready after bootstrap');

    const component = await getReleaseAuthorityComponent('release-evidence-pack-store');
    equal(
      String(component?.metadata.integrityDiscipline),
      'verify-dsse-and-bundle-digest-on-read-and-write',
      'Shared evidence pack: component registry records integrity discipline',
    );
    equal(
      String(component?.metadata.bootstrapWired),
      'false',
      'Shared evidence pack: component metadata truthfully records runtime wiring as pending',
    );

    const pack = await makeEvidencePack();
    await store.upsert(pack);
    const reloaded = await store.get(pack.evidencePack.id);
    equal(
      reloaded?.bundleDigest,
      pack.bundleDigest,
      'Shared evidence pack: PostgreSQL store reloads the signed bundle digest',
    );
    equal(
      reloaded?.statement.predicate.releaseToken?.tokenId,
      pack.statement.predicate.releaseToken?.tokenId,
      'Shared evidence pack: PostgreSQL store preserves release token evidence summary',
    );
    equal(
      (await store.summary()).totalPacks,
      1,
      'Shared evidence pack: summary counts persisted evidence packs',
    );

    await withReleaseAuthorityTransaction(async (client) => {
      await client.query(
        `UPDATE attestor_release_authority.release_evidence_packs
            SET pack_json = jsonb_set(pack_json, '{bundleDigest}', '"sha256:tampered"'::jsonb)
          WHERE pack_id = $1`,
        [pack.evidencePack.id],
      );
    });

    await assert.rejects(
      store.get(pack.evidencePack.id),
      SharedReleaseEvidencePackStoreError,
      'Shared evidence pack: tampered persisted bundle fails closed on reload',
    );
    passed += 1;

    await assert.rejects(
      store.upsert({
        ...pack,
        bundleDigest: 'sha256:invalid',
      }),
      SharedReleaseEvidencePackStoreError,
      'Shared evidence pack: invalid bundle cannot be written into shared authority state',
    );
    passed += 1;
  } finally {
    await resetSharedReleaseEvidencePackStoreForTests();
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    try {
      await pg.stop();
    } catch {}
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }

  console.log(`Shared release evidence pack store tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Shared release evidence pack store tests failed:', error);
  process.exit(1);
});
