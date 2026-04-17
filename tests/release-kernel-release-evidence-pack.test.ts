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
  applyReviewerDecision,
  attachIssuedTokenToReviewerQueueRecord,
  createFinanceReviewerQueueItem,
} from '../src/release-kernel/reviewer-queue.js';
import {
  createInMemoryReleaseEvidencePackStore,
  createReleaseEvidencePackIssuer,
  verifyIssuedReleaseEvidencePack,
} from '../src/release-kernel/release-evidence-pack.js';
import { createReleaseTokenIssuer } from '../src/release-kernel/release-token.js';
import { generateKeyPair } from '../src/signing/keys.js';

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
    runId: 'api-finance-release-evidence',
    timestamp: '2026-04-17T23:30:00.000Z',
    decision: 'pending_approval',
    certificate: { certificateId: 'cert_finance_release_evidence' },
    evidenceChain: { terminalHash: 'sha256:chain_terminal_release_evidence', intact: true },
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
      manifestHash: 'manifest_hash_release_evidence',
    },
    ...overrides,
  } as any;
}

async function main(): Promise<void> {
  const report = makeFinanceReport();
  const candidate = createFinanceFilingReleaseCandidateFromReport(report);
  ok(candidate !== null, 'Release evidence pack: review-required finance report still produces a release candidate');

  const material = buildFinanceFilingReleaseMaterial(candidate!);
  const decisionLog = createInMemoryReleaseDecisionLogWriter();
  const engine = createReleaseDecisionEngine({ decisionLog });
  const evaluation = engine.evaluateWithDeterministicChecks(
    {
      id: 'finance-release-evidence-decision',
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

  equal(evaluation.decision.status, 'review-required', 'Release evidence pack: deterministic evaluation routes regulated finance release through review');

  const finalized = finalizeFinanceFilingReleaseDecision(evaluation.decision, report);
  equal(finalized.status, 'hold', 'Release evidence pack: finance release remains held until explicit reviewer authority closure');

  const queueItem = createFinanceReviewerQueueItem({
    decision: finalized,
    candidate: candidate!,
    report,
    logEntries: decisionLog.entries(),
  });

  const firstApproval = applyReviewerDecision({
    record: queueItem,
    outcome: 'approved',
    reviewerId: 'reviewer.alpha',
    reviewerName: 'Alpha Reviewer',
    reviewerRole: 'financial_reporting_manager',
    decidedAt: '2026-04-17T23:31:00.000Z',
    note: 'First reviewer confirms release conditions.',
  });
  const secondApproval = applyReviewerDecision({
    record: firstApproval.record,
    outcome: 'approved',
    reviewerId: 'reviewer.beta',
    reviewerName: 'Beta Reviewer',
    reviewerRole: 'financial_reporting_manager',
    decidedAt: '2026-04-17T23:32:00.000Z',
    note: 'Second reviewer closes regulated release authority.',
  });

  equal(secondApproval.record.detail.status, 'approved', 'Release evidence pack: dual approval closes the regulated review path');
  equal(secondApproval.record.releaseDecision.status, 'accepted', 'Release evidence pack: dual approval upgrades the decision to accepted');

  decisionLog.append({
    occurredAt: '2026-04-17T23:31:00.000Z',
    requestId: 'review:finance-release-evidence:approve-1',
    phase: 'review',
    matchedPolicyId: secondApproval.record.releaseDecision.policyVersion,
    decision: secondApproval.record.releaseDecision,
    metadata: {
      policyMatched: true,
      pendingChecks: [],
      pendingEvidenceKinds: [],
      requiresReview: true,
      deterministicChecksCompleted: true,
    },
  });
  decisionLog.append({
    occurredAt: '2026-04-17T23:32:00.000Z',
    requestId: 'review:finance-release-evidence:terminal-accept',
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

  const signingKeys = generateKeyPair();
  const tokenIssuer = createReleaseTokenIssuer({
    issuer: 'attestor.test.release',
    privateKeyPem: signingKeys.privateKeyPem,
    publicKeyPem: signingKeys.publicKeyPem,
  });
  const issuedToken = await tokenIssuer.issue({
    decision: secondApproval.record.releaseDecision,
    issuedAt: '2026-04-17T23:32:30.000Z',
  });
  const recordWithToken = attachIssuedTokenToReviewerQueueRecord({
    record: secondApproval.record,
    issuedToken,
  });

  const evidenceIssuer = createReleaseEvidencePackIssuer({
    issuer: 'attestor.test.release',
    privateKeyPem: signingKeys.privateKeyPem,
    publicKeyPem: signingKeys.publicKeyPem,
  });
  const issuedEvidencePack = await evidenceIssuer.issue({
    decision: {
      ...recordWithToken.releaseDecision,
      evidencePackId: 'ep_release_evidence_test',
    },
    evidencePackId: 'ep_release_evidence_test',
    issuedAt: '2026-04-17T23:33:00.000Z',
    decisionLogEntries: decisionLog.entries().filter((entry) => entry.decisionId === recordWithToken.releaseDecision.id),
    decisionLogChainIntact: decisionLog.verify().valid,
    review: recordWithToken.detail,
    releaseToken: issuedToken,
    artifactReferences: [
      {
        kind: 'provenance',
        path: 'finance-evidence-chain://api-finance-release-evidence',
        digest: report.evidenceChain.terminalHash,
      },
    ],
  });

  equal(issuedEvidencePack.evidencePack.id, 'ep_release_evidence_test', 'Release evidence pack: caller-provided pack id is preserved');
  equal(issuedEvidencePack.evidencePack.retentionClass, 'regulated', 'Release evidence pack: regulated finance release gets regulated retention');
  ok(issuedEvidencePack.evidencePack.artifacts.some((artifact) => artifact.kind === 'review-record'), 'Release evidence pack: review-record artifact is captured');
  ok(issuedEvidencePack.evidencePack.artifacts.some((artifact) => artifact.kind === 'signature'), 'Release evidence pack: release-token artifact is captured');
  equal(
    issuedEvidencePack.statement.subject[0]?.digest.sha256,
    recordWithToken.releaseDecision.outputHash.replace('sha256:', ''),
    'Release evidence pack: output subject digest binds to the release output hash',
  );
  equal(
    issuedEvidencePack.statement.subject[1]?.digest.sha256,
    recordWithToken.releaseDecision.consequenceHash.replace('sha256:', ''),
    'Release evidence pack: consequence subject digest binds to the release consequence hash',
  );
  equal(
    issuedEvidencePack.statement.predicate.releaseToken?.tokenId,
    issuedToken.tokenId,
    'Release evidence pack: predicate carries the issued release token summary',
  );
  equal(
    issuedEvidencePack.statement.predicate.review?.reviewId,
    recordWithToken.detail.id,
    'Release evidence pack: predicate carries the reviewer queue summary',
  );
  equal(
    issuedEvidencePack.statement.predicate.decision.evidencePackId,
    issuedEvidencePack.evidencePack.id,
    'Release evidence pack: decision summary binds back to the durable evidence pack id',
  );

  const verification = verifyIssuedReleaseEvidencePack({
    issuedEvidencePack,
  });
  equal(verification.valid, true, 'Release evidence pack: DSSE signature verifies');
  equal(
    verification.bundleDigest,
    issuedEvidencePack.bundleDigest,
    'Release evidence pack: verification preserves the exported bundle digest',
  );

  const store = createInMemoryReleaseEvidencePackStore();
  store.upsert(issuedEvidencePack);
  equal(
    store.get(issuedEvidencePack.evidencePack.id)?.evidencePack.id,
    issuedEvidencePack.evidencePack.id,
    'Release evidence pack: in-memory store round-trips the exported bundle',
  );

  let tamperedSignatureError: Error | null = null;
  try {
    verifyIssuedReleaseEvidencePack({
      issuedEvidencePack: {
        ...issuedEvidencePack,
        envelope: {
          ...issuedEvidencePack.envelope,
          signatures: [
            {
              ...issuedEvidencePack.envelope.signatures[0]!,
              sig: 'A'.repeat(issuedEvidencePack.envelope.signatures[0]!.sig.length),
            },
          ],
        },
      },
    });
  } catch (error) {
    tamperedSignatureError = error as Error;
  }
  ok(
    tamperedSignatureError?.message.includes('DSSE signature'),
    'Release evidence pack: tampered DSSE envelope is rejected',
  );

  let tamperedDigestError: Error | null = null;
  try {
    verifyIssuedReleaseEvidencePack({
      issuedEvidencePack: {
        ...issuedEvidencePack,
        bundleDigest: 'sha256:deadbeef',
      },
    });
  } catch (error) {
    tamperedDigestError = error as Error;
  }
  ok(
    tamperedDigestError?.message.includes('bundle digest'),
    'Release evidence pack: tampered bundle digest is rejected',
  );

  console.log(`\nRelease kernel release-evidence-pack tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-evidence-pack tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
