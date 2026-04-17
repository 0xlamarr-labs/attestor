import { strict as assert } from 'node:assert';
import {
  buildFinanceFilingReleaseMaterial,
  buildFinanceFilingReleaseObservation,
  createFinanceFilingReleaseCandidateFromReport,
  finalizeFinanceFilingReleaseDecision,
} from '../src/release-kernel/finance-record-release.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';
import { createInMemoryReleaseDecisionLogWriter } from '../src/release-kernel/release-decision-log.js';
import {
  createFinanceReviewerQueueItem,
  createInMemoryReleaseReviewerQueueStore,
} from '../src/release-kernel/reviewer-queue.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function makeFinanceReport(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'api-finance-review-queue',
    decision: 'pending_approval',
    certificate: { certificateId: 'cert_finance_review_queue' },
    evidenceChain: { terminalHash: 'chain_terminal', intact: true },
    execution: {
      success: true,
      rows: [
        {
          counterparty_name: 'Bank of Nova Scotia',
          exposure_usd: 250000000,
          credit_rating: 'AA-',
          sector: 'Banking',
        },
        {
          counterparty_name: 'BNP Paribas',
          exposure_usd: 185000000,
          credit_rating: 'A+',
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
      manifestHash: 'manifest_hash',
    },
    ...overrides,
  } as any;
}

async function main(): Promise<void> {
  const report = makeFinanceReport();
  const candidate = createFinanceFilingReleaseCandidateFromReport(report);
  ok(candidate !== null, 'Reviewer queue: review-required finance report still produces a filing release candidate');

  const material = buildFinanceFilingReleaseMaterial(candidate!);
  const decisionLog = createInMemoryReleaseDecisionLogWriter();
  const engine = createReleaseDecisionEngine({ decisionLog });
  const evaluation = engine.evaluateWithDeterministicChecks(
    {
      id: 'finance-review-queue-decision',
      createdAt: '2026-04-17T23:10:00.000Z',
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

  equal(evaluation.decision.status, 'review-required', 'Reviewer queue: deterministic evaluation still routes R4 release through review');

  const finalized = finalizeFinanceFilingReleaseDecision(evaluation.decision, report);
  equal(finalized.status, 'hold', 'Reviewer queue: pending finance approval stays held until human authority closes the finance bridge');

  const item = createFinanceReviewerQueueItem({
    decision: finalized,
    candidate: candidate!,
    report,
    logEntries: decisionLog.entries(),
  });

  equal(item.kind, 'finance.filing-export', 'Reviewer queue: queue item kind is finance filing export');
  equal(item.riskClass, 'R4', 'Reviewer queue: risk class is preserved on the queue item');
  ok(item.summary.includes('paused before consequence'), 'Reviewer queue: summary is reviewer-oriented');
  ok(item.findings.length > 0, 'Reviewer queue: findings are preserved for the reviewer packet');
  equal(item.candidate.rowCount, 2, 'Reviewer queue: row count preview is included');
  ok(item.timeline.length >= 2, 'Reviewer queue: policy and deterministic phases are preserved in the review timeline');
  ok(item.checklist.length >= 4, 'Reviewer queue: reviewer checklist is present');

  const store = createInMemoryReleaseReviewerQueueStore();
  store.upsert(item);

  const list = store.listPending();
  equal(list.totalPending, 1, 'Reviewer queue: pending count increments after enqueue');
  equal(list.countsByRiskClass.R4, 1, 'Reviewer queue: risk counts reflect the review item');
  equal(list.items[0]?.id, item.id, 'Reviewer queue: list returns the enqueued review item');

  const detail = store.get(item.id);
  ok(detail !== null, 'Reviewer queue: detail lookup resolves the queue item');
  equal(detail?.candidate.previewRows.length, 2, 'Reviewer queue: preview rows remain available on detail lookup');
  equal(detail?.timeline[0]?.phase, 'policy-resolution', 'Reviewer queue: timeline begins with policy resolution');

  console.log(`\nRelease kernel reviewer-queue tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel reviewer-queue tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
