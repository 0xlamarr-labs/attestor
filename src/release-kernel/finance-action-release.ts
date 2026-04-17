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

export const FINANCE_ACTION_RELEASE_SPEC_VERSION =
  'attestor.finance-action-release.v1';
export const FINANCE_WORKFLOW_ACTION_TARGET_ID =
  'finance.reporting.release-workflow.dispatch';
export const FINANCE_WORKFLOW_ACTION_TARGET: ReleaseTargetReference = Object.freeze({
  kind: 'workflow',
  id: FINANCE_WORKFLOW_ACTION_TARGET_ID,
  displayName: 'Finance reporting release workflow',
});
export const FINANCE_WORKFLOW_ACTION_ARTIFACT_TYPE =
  'financial-reporting.workflow-action-request';
export const FINANCE_WORKFLOW_ACTION_EXPECTED_SHAPE =
  'bounded finance workflow action request';

export interface FinanceActionReleaseCandidate {
  readonly runId: string;
  readonly decision: string;
  readonly workflowId: string;
  readonly actionType: string;
  readonly requestedTransition: string;
  readonly certificateId: string | null;
  readonly filingReadinessStatus: string;
  readonly blockingGaps: number;
  readonly proofMode: string;
}

export interface FinanceActionReleaseMaterial {
  readonly version: typeof FINANCE_ACTION_RELEASE_SPEC_VERSION;
  readonly candidate: FinanceActionReleaseCandidate;
  readonly target: ReleaseTargetReference;
  readonly outputContract: OutputContractDescriptor;
  readonly capabilityBoundary: CapabilityBoundaryDescriptor;
  readonly hashBundle: CanonicalReleaseHashBundle;
}

export function createFinanceActionReleaseCandidateFromReport(
  report: Pick<
    FinancialRunReport,
    'runId' | 'decision' | 'certificate' | 'filingReadiness' | 'liveProof'
  >,
): FinanceActionReleaseCandidate {
  return Object.freeze({
    runId: report.runId,
    decision: report.decision,
    workflowId: 'finance.reporting.release-workflow',
    actionType: 'workflow-dispatch',
    requestedTransition: 'prepare-filing-submission',
    certificateId: report.certificate?.certificateId ?? null,
    filingReadinessStatus: report.filingReadiness.status,
    blockingGaps: report.filingReadiness.blockingGaps,
    proofMode: report.liveProof.mode,
  });
}

export function financeActionReleaseOutputContract(): OutputContractDescriptor {
  return {
    artifactType: FINANCE_WORKFLOW_ACTION_ARTIFACT_TYPE,
    expectedShape: FINANCE_WORKFLOW_ACTION_EXPECTED_SHAPE,
    consequenceType: 'action',
    riskClass: 'R3',
  };
}

export function financeActionReleaseCapabilityBoundary(): CapabilityBoundaryDescriptor {
  return {
    allowedTools: ['workflow-dispatch', 'filing-prepare'],
    allowedTargets: [FINANCE_WORKFLOW_ACTION_TARGET_ID],
    allowedDataDomains: ['financial-reporting'],
  };
}

function financeActionOutputPayload(
  candidate: FinanceActionReleaseCandidate,
): Record<string, string | number | null> {
  return {
    runId: candidate.runId,
    decision: candidate.decision,
    workflowId: candidate.workflowId,
    actionType: candidate.actionType,
    requestedTransition: candidate.requestedTransition,
    certificateId: candidate.certificateId,
    filingReadinessStatus: candidate.filingReadinessStatus,
    blockingGaps: candidate.blockingGaps,
    proofMode: candidate.proofMode,
  };
}

function financeActionConsequencePayload(
  candidate: FinanceActionReleaseCandidate,
): Record<string, string | number | null> {
  return {
    operation: candidate.actionType,
    targetId: FINANCE_WORKFLOW_ACTION_TARGET_ID,
    workflowId: candidate.workflowId,
    requestedTransition: candidate.requestedTransition,
    certificateId: candidate.certificateId,
    filingReadinessStatus: candidate.filingReadinessStatus,
    blockingGaps: candidate.blockingGaps,
  };
}

export function buildFinanceActionReleaseMaterial(
  candidate: FinanceActionReleaseCandidate,
): FinanceActionReleaseMaterial {
  const outputContract = financeActionReleaseOutputContract();
  const target = FINANCE_WORKFLOW_ACTION_TARGET;

  return Object.freeze({
    version: FINANCE_ACTION_RELEASE_SPEC_VERSION,
    candidate,
    target,
    outputContract,
    capabilityBoundary: financeActionReleaseCapabilityBoundary(),
    hashBundle: createCanonicalReleaseHashBundle({
      outputContract,
      target,
      outputPayload: financeActionOutputPayload(candidate),
      consequencePayload: financeActionConsequencePayload(candidate),
    }),
  });
}

export function buildFinanceActionReleaseObservation(
  material: FinanceActionReleaseMaterial,
  report: Pick<
    FinancialRunReport,
    'audit' | 'filingReadiness' | 'liveProof' | 'certificate' | 'evidenceChain'
  >,
): DeterministicCheckObservation {
  const evidenceKinds = ['trace', 'finding-log'];
  if (report.evidenceChain?.terminalHash) {
    evidenceKinds.push('provenance');
  }
  if (report.certificate) {
    evidenceKinds.push('signature');
  }

  return {
    actualArtifactType: material.outputContract.artifactType,
    actualShape: material.outputContract.expectedShape,
    observedTargetId: material.target.id,
    usedTools: ['workflow-dispatch', 'filing-prepare'],
    usedDataDomains: ['financial-reporting'],
    observedOutputHash: material.hashBundle.outputHash,
    observedConsequenceHash: material.hashBundle.consequenceHash,
    policyRulesSatisfied:
      report.audit.chainIntact &&
      report.liveProof.consistent &&
      report.filingReadiness.status !== 'blocked',
    evidenceKinds,
    traceGradePassed: report.liveProof.consistent ?? false,
    provenanceBound: !!report.evidenceChain?.terminalHash,
  };
}
