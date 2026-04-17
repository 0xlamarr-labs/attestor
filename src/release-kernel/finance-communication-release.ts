import type { FinancialRunReport } from '../financial/types.js';
import type { ReleaseTargetReference } from './object-model.js';
import {
  createCanonicalReleaseHashBundle,
  type CanonicalReleaseHashBundle,
} from './release-canonicalization.js';
import type {
  CapabilityBoundaryDescriptor,
  OutputContractDescriptor,
} from './types.js';
import type { DeterministicCheckObservation } from './release-deterministic-checks.js';

export const FINANCE_COMMUNICATION_RELEASE_SPEC_VERSION =
  'attestor.finance-communication-release.v1';
export const FINANCE_REVIEW_SUMMARY_TARGET_ID = 'finance.reporting.review.mailbox';
export const FINANCE_REVIEW_SUMMARY_TARGET: ReleaseTargetReference = Object.freeze({
  kind: 'endpoint',
  id: FINANCE_REVIEW_SUMMARY_TARGET_ID,
  displayName: 'Finance reporting review mailbox',
});
export const FINANCE_REVIEW_SUMMARY_ARTIFACT_TYPE =
  'financial-reporting.review-summary-message';
export const FINANCE_REVIEW_SUMMARY_EXPECTED_SHAPE =
  'outbound finance release summary';

export interface FinanceCommunicationReleaseCandidate {
  readonly runId: string;
  readonly decision: string;
  readonly recipientId: string;
  readonly channelId: string;
  readonly subject: string;
  readonly body: string;
  readonly proofMode: string;
}

export interface FinanceCommunicationReleaseMaterial {
  readonly version: typeof FINANCE_COMMUNICATION_RELEASE_SPEC_VERSION;
  readonly candidate: FinanceCommunicationReleaseCandidate;
  readonly target: ReleaseTargetReference;
  readonly outputContract: OutputContractDescriptor;
  readonly capabilityBoundary: CapabilityBoundaryDescriptor;
  readonly hashBundle: CanonicalReleaseHashBundle;
}

function renderReviewerSummaryBody(
  report: Pick<FinancialRunReport, 'runId' | 'decision' | 'filingReadiness' | 'dossier'>,
): string {
  const lines = [
    `Run: ${report.runId}`,
    `Decision: ${report.decision}`,
    `Filing readiness: ${report.filingReadiness.status}`,
    '',
    ...report.dossier.reviewerSummary.map(
      (section) => `${section.category}: ${section.status} — ${section.detail}`,
    ),
  ];

  return lines.join('\n');
}

export function createFinanceCommunicationReleaseCandidateFromReport(
  report: Pick<
    FinancialRunReport,
    'runId' | 'decision' | 'filingReadiness' | 'dossier' | 'liveProof'
  >,
): FinanceCommunicationReleaseCandidate | null {
  if (report.dossier.reviewerSummary.length === 0) {
    return null;
  }

  return Object.freeze({
    runId: report.runId,
    decision: report.decision,
    recipientId: 'finance-reporting-reviewers',
    channelId: 'internal-review-mailbox',
    subject: `Finance review summary for ${report.runId}`,
    body: renderReviewerSummaryBody(report),
    proofMode: report.liveProof.mode,
  });
}

export function financeCommunicationReleaseOutputContract(): OutputContractDescriptor {
  return {
    artifactType: FINANCE_REVIEW_SUMMARY_ARTIFACT_TYPE,
    expectedShape: FINANCE_REVIEW_SUMMARY_EXPECTED_SHAPE,
    consequenceType: 'communication',
    riskClass: 'R2',
  };
}

export function financeCommunicationReleaseCapabilityBoundary(): CapabilityBoundaryDescriptor {
  return {
    allowedTools: ['review-summary-render', 'channel-dispatch'],
    allowedTargets: [FINANCE_REVIEW_SUMMARY_TARGET_ID],
    allowedDataDomains: ['financial-reporting'],
  };
}

function financeCommunicationOutputPayload(
  candidate: FinanceCommunicationReleaseCandidate,
): Record<string, string> {
  return {
    runId: candidate.runId,
    decision: candidate.decision,
    recipientId: candidate.recipientId,
    channelId: candidate.channelId,
    subject: candidate.subject,
    body: candidate.body,
    proofMode: candidate.proofMode,
  };
}

function financeCommunicationConsequencePayload(
  candidate: FinanceCommunicationReleaseCandidate,
): Record<string, string> {
  return {
    operation: 'dispatch-review-summary',
    targetId: FINANCE_REVIEW_SUMMARY_TARGET_ID,
    recipientId: candidate.recipientId,
    channelId: candidate.channelId,
    subject: candidate.subject,
    body: candidate.body,
  };
}

export function buildFinanceCommunicationReleaseMaterial(
  candidate: FinanceCommunicationReleaseCandidate,
): FinanceCommunicationReleaseMaterial {
  const outputContract = financeCommunicationReleaseOutputContract();
  const target = FINANCE_REVIEW_SUMMARY_TARGET;

  return Object.freeze({
    version: FINANCE_COMMUNICATION_RELEASE_SPEC_VERSION,
    candidate,
    target,
    outputContract,
    capabilityBoundary: financeCommunicationReleaseCapabilityBoundary(),
    hashBundle: createCanonicalReleaseHashBundle({
      outputContract,
      target,
      outputPayload: financeCommunicationOutputPayload(candidate),
      consequencePayload: financeCommunicationConsequencePayload(candidate),
    }),
  });
}

export function buildFinanceCommunicationReleaseObservation(
  material: FinanceCommunicationReleaseMaterial,
  report: Pick<
    FinancialRunReport,
    'audit' | 'dossier' | 'filingReadiness' | 'liveProof' | 'certificate' | 'evidenceChain'
  >,
): DeterministicCheckObservation {
  const evidenceKinds = ['trace', 'finding-log'];
  if (report.certificate) {
    evidenceKinds.push('signature');
  }
  if (report.evidenceChain?.terminalHash) {
    evidenceKinds.push('provenance');
  }

  return {
    actualArtifactType: material.outputContract.artifactType,
    actualShape: material.outputContract.expectedShape,
    observedTargetId: material.target.id,
    usedTools: ['review-summary-render', 'channel-dispatch'],
    usedDataDomains: ['financial-reporting'],
    observedOutputHash: material.hashBundle.outputHash,
    observedConsequenceHash: material.hashBundle.consequenceHash,
    policyRulesSatisfied:
      report.audit.chainIntact &&
      report.liveProof.consistent &&
      report.dossier.reviewerSummary.length > 0 &&
      report.filingReadiness.status !== 'blocked',
    evidenceKinds,
    traceGradePassed: report.liveProof.consistent ?? false,
    provenanceBound:
      !!report.evidenceChain?.terminalHash &&
      !!report.certificate,
  };
}
