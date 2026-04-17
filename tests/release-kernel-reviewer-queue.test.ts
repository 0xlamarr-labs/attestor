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
  applyBreakGlassOverride,
  applyReviewerDecision,
  createFinanceReviewerQueueItem,
  createInMemoryReleaseReviewerQueueStore,
  ReleaseReviewerQueueError,
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

  equal(item.detail.kind, 'finance.filing-export', 'Reviewer queue: queue item kind is finance filing export');
  equal(item.detail.riskClass, 'R4', 'Reviewer queue: risk class is preserved on the queue item');
  ok(item.detail.summary.includes('paused before consequence'), 'Reviewer queue: summary is reviewer-oriented');
  ok(item.detail.findings.length > 0, 'Reviewer queue: findings are preserved for the reviewer packet');
  equal(item.detail.candidate.rowCount, 2, 'Reviewer queue: row count preview is included');
  ok(item.detail.timeline.length >= 2, 'Reviewer queue: policy and deterministic phases are preserved in the review timeline');
  ok(item.detail.checklist.length >= 4, 'Reviewer queue: reviewer checklist is present');

  const store = createInMemoryReleaseReviewerQueueStore();
  store.upsert(item);

  const list = store.listPending();
  equal(list.totalPending, 1, 'Reviewer queue: pending count increments after enqueue');
  equal(list.countsByRiskClass.R4, 1, 'Reviewer queue: risk counts reflect the review item');
  equal(list.items[0]?.id, item.detail.id, 'Reviewer queue: list returns the enqueued review item');

  const detail = store.get(item.detail.id);
  ok(detail !== null, 'Reviewer queue: detail lookup resolves the queue item');
  equal(detail?.candidate.previewRows.length, 2, 'Reviewer queue: preview rows remain available on detail lookup');
  equal(detail?.timeline[0]?.phase, 'policy-resolution', 'Reviewer queue: timeline begins with policy resolution');

  const afterFirstApproval = applyReviewerDecision({
    record: store.getRecord(item.detail.id)!,
    outcome: 'approved',
    reviewerId: 'reviewer.alpha',
    reviewerName: 'Alpha Reviewer',
    reviewerRole: 'financial_reporting_manager',
    decidedAt: '2026-04-17T23:11:00.000Z',
    note: 'Numbers and target binding look correct.',
  });
  equal(afterFirstApproval.record.detail.status, 'pending-review', 'Reviewer queue: first approval does not close an R4 dual-approval path');
  equal(afterFirstApproval.record.detail.approvalsRecorded, 1, 'Reviewer queue: first approval increments approval count');
  equal(afterFirstApproval.record.detail.approvalsRemaining, 1, 'Reviewer queue: one more approval remains after the first reviewer');
  ok(afterFirstApproval.record.detail.reviewerDecisions.length === 1, 'Reviewer queue: first reviewer decision is recorded');

  let duplicateReviewerError: ReleaseReviewerQueueError | null = null;
  try {
    applyReviewerDecision({
      record: afterFirstApproval.record,
      outcome: 'approved',
      reviewerId: 'reviewer.alpha',
      reviewerName: 'Alpha Reviewer',
      reviewerRole: 'financial_reporting_manager',
      decidedAt: '2026-04-17T23:11:30.000Z',
    });
  } catch (error) {
    duplicateReviewerError = error as ReleaseReviewerQueueError;
  }
  equal(duplicateReviewerError?.code, 'duplicate_reviewer', 'Reviewer queue: the same reviewer cannot satisfy both sides of dual approval');

  const afterSecondApproval = applyReviewerDecision({
    record: afterFirstApproval.record,
    outcome: 'approved',
    reviewerId: 'reviewer.beta',
    reviewerName: 'Beta Reviewer',
    reviewerRole: 'financial_reporting_manager',
    decidedAt: '2026-04-17T23:12:00.000Z',
    note: 'Second pair of eyes agrees to consequence release.',
  });
  equal(afterSecondApproval.record.detail.status, 'approved', 'Reviewer queue: the second distinct approval closes the dual-approval path');
  equal(afterSecondApproval.record.detail.authorityState, 'approved', 'Reviewer queue: authority state becomes approved');
  equal(afterSecondApproval.record.releaseDecision.status, 'accepted', 'Reviewer queue: final review closure upgrades the release decision to accepted');
  ok(afterSecondApproval.record.detail.timeline.some((entry) => entry.phase === 'terminal-accept'), 'Reviewer queue: accepted review closure is reflected in the review timeline');

  const rejected = applyReviewerDecision({
    record: item,
    outcome: 'rejected',
    reviewerId: 'reviewer.gamma',
    reviewerName: 'Gamma Reviewer',
    reviewerRole: 'financial_reporting_manager',
    decidedAt: '2026-04-17T23:13:00.000Z',
    note: 'Counterparty exposure requires escalation.',
  });
  equal(rejected.record.detail.status, 'rejected', 'Reviewer queue: explicit rejection closes the queue item');
  equal(rejected.record.releaseDecision.status, 'denied', 'Reviewer queue: explicit rejection denies consequence release');
  ok(rejected.record.detail.timeline.some((entry) => entry.phase === 'terminal-deny'), 'Reviewer queue: rejected review closure is reflected in the review timeline');

  const overridden = applyBreakGlassOverride({
    record: item,
    reasonCode: 'regulatory_deadline',
    ticketId: 'INC-2048',
    requestedById: 'ops.breakglass',
    requestedByName: 'Operations Override',
    requestedByRole: 'incident_commander',
    note: 'Emergency filing preparation required before market open.',
    decidedAt: '2026-04-17T23:14:00.000Z',
  });
  equal(overridden.detail.status, 'overridden', 'Reviewer queue: break-glass override closes the queue item with a distinct overridden status');
  equal(overridden.detail.authorityState, 'overridden', 'Reviewer queue: authority state becomes overridden under break-glass');
  equal(overridden.releaseDecision.status, 'overridden', 'Reviewer queue: release decision enters overridden state');
  equal(overridden.detail.overrideGrant?.reasonCode, 'regulatory_deadline', 'Reviewer queue: override summary preserves the reason code');
  ok(overridden.detail.timeline.some((entry) => entry.phase === 'override'), 'Reviewer queue: override phase is appended to the timeline');

  console.log(`\nRelease kernel reviewer-queue tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel reviewer-queue tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
