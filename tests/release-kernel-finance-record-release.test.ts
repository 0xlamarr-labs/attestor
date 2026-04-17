import { strict as assert } from 'node:assert';
import {
  buildFinanceFilingReleaseMaterial,
  buildFinanceFilingReleaseObservation,
  createFinanceFilingReleaseCandidateFromReport,
  finalizeFinanceFilingReleaseDecision,
  financeFilingReleaseStatusFromReport,
} from '../src/release-kernel/finance-record-release.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';

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
    runId: 'api-finance-release',
    decision: 'pass',
    certificate: { certificateId: 'cert_finance_release' },
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
      ],
    },
    liveProof: {
      mode: 'live_runtime',
      consistent: true,
    },
    receipt: {
      receiptStatus: 'issued',
    },
    oversight: {
      status: 'not_required',
    },
    escrow: {
      state: 'released',
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

  ok(candidate !== null, 'Finance record release: successful execution rows produce a filing release candidate');
  equal(candidate?.adapterId, 'xbrl-us-gaap-2024', 'Finance record release: the first hard-gateway adapter is frozen');
  equal(candidate?.rows.length, 1, 'Finance record release: row payload is preserved for downstream binding');

  const material = buildFinanceFilingReleaseMaterial(candidate!);
  equal(material.target.id, 'sec.edgar.filing.prepare', 'Finance record release: target is the filing-preparation boundary');
  ok(material.hashBundle.outputHash.startsWith('sha256:'), 'Finance record release: output hash is canonicalized');
  ok(material.hashBundle.consequenceHash.startsWith('sha256:'), 'Finance record release: consequence hash is canonicalized');

  const observation = buildFinanceFilingReleaseObservation(material, report);
  ok(observation.policyRulesSatisfied, 'Finance record release: issued receipt and intact evidence satisfy the policy bridge checks');
  ok(observation.downstreamReceiptConfirmed, 'Finance record release: receipt status feeds the downstream receipt control');

  const engine = createReleaseDecisionEngine();
  const evaluation = engine.evaluateWithDeterministicChecks(
    {
      id: 'finance-release-decision',
      createdAt: '2026-04-17T22:30:00.000Z',
      outputHash: material.hashBundle.outputHash,
      consequenceHash: material.hashBundle.consequenceHash,
      outputContract: material.outputContract,
      capabilityBoundary: material.capabilityBoundary,
      requester: {
        id: 'svc.attestor.api',
        type: 'service',
      },
      target: material.target,
    },
    observation,
  );

  equal(evaluation.decision.status, 'review-required', 'Finance record release: raw R4 deterministic success still lands in review-required before domain bridging');

  const finalized = finalizeFinanceFilingReleaseDecision(evaluation.decision, report);
  equal(finalized.status, 'accepted', 'Finance record release: finance-domain receipt/escrow signals can finalize the first hard-gateway release as accepted');
  ok(
    finalized.findings.some((finding) => finding.code === 'finance_domain_acceptance_bridge' && finding.result === 'pass'),
    'Finance record release: the bridge records an explicit runtime finding when finance authority accepts release',
  );

  equal(
    financeFilingReleaseStatusFromReport(
      makeFinanceReport({
        decision: 'pending_approval',
        receipt: { receiptStatus: 'withheld' },
        oversight: { status: 'pending' },
      }),
    ),
    'review-required',
    'Finance record release: pending approval stays in review-required instead of becoming releasable',
  );

  equal(
    financeFilingReleaseStatusFromReport(
      makeFinanceReport({
        decision: 'block',
        receipt: { receiptStatus: 'withheld' },
      }),
    ),
    'denied',
    'Finance record release: blocked finance outcomes are denied for release',
  );

  equal(
    createFinanceFilingReleaseCandidateFromReport(
      makeFinanceReport({
        execution: { success: false, rows: [] },
      }),
    ),
    null,
    'Finance record release: failed execution does not produce a filing release candidate',
  );

  console.log(`\nRelease kernel finance-record-release tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel finance-record-release tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
