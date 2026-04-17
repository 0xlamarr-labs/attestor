import type { FinancialRunReport } from '../financial/types.js';
import type { ReleaseDecision, ReleaseFinding, ReleaseTargetReference } from './object-model.js';
import type { DeterministicCheckObservation } from './release-deterministic-checks.js';
import {
  createCanonicalReleaseHashBundle,
  type CanonicalReleaseHashBundle,
} from './release-canonicalization.js';
import type {
  CapabilityBoundaryDescriptor,
  OutputContractDescriptor,
  ReleaseDecisionStatus,
} from './types.js';

/**
 * Finance-first bridge between the existing financial reporting pipeline and
 * the shared release-kernel primitives.
 *
 * Step 14 intentionally does not replace the finance domain logic. Instead, it
 * binds the strongest existing finance acceptance path to the new release
 * kernel so one real filing-preparation route becomes fail-closed end to end.
 */

export const FINANCE_RECORD_RELEASE_SPEC_VERSION = 'attestor.finance-record-release.v1';
export const FINANCE_FILING_PREPARE_TARGET_ID = 'sec.edgar.filing.prepare';
export const FINANCE_FILING_PREPARE_TARGET: ReleaseTargetReference = Object.freeze({
  kind: 'artifact-registry',
  id: FINANCE_FILING_PREPARE_TARGET_ID,
  displayName: 'SEC EDGAR filing preparation',
});
export const FINANCE_FILING_ADAPTER_ID = 'xbrl-us-gaap-2024';
export const FINANCE_FILING_ARTIFACT_TYPE = 'financial-reporting.filing-preparation-payload';
export const FINANCE_FILING_EXPECTED_SHAPE = 'structured financial record payload';

export type FinanceFilingRowValue = string | number | boolean | null;
export type FinanceFilingRow = { readonly [key: string]: FinanceFilingRowValue };

export interface FinanceFilingReleaseCandidate {
  readonly adapterId: string;
  readonly runId: string;
  readonly decision: string;
  readonly certificateId: string | null;
  readonly evidenceChainTerminal: string;
  readonly rows: readonly FinanceFilingRow[];
  readonly proofMode: string;
}

export interface FinanceFilingReleaseMaterial {
  readonly version: typeof FINANCE_RECORD_RELEASE_SPEC_VERSION;
  readonly candidate: FinanceFilingReleaseCandidate;
  readonly target: ReleaseTargetReference;
  readonly outputContract: OutputContractDescriptor;
  readonly capabilityBoundary: CapabilityBoundaryDescriptor;
  readonly hashBundle: CanonicalReleaseHashBundle;
}

export type FinanceFilingReleaseReportLike = Pick<
  FinancialRunReport,
  | 'decision'
  | 'receipt'
  | 'oversight'
  | 'execution'
  | 'escrow'
  | 'filingReadiness'
  | 'certificate'
  | 'evidenceChain'
  | 'audit'
  | 'attestation'
  | 'liveProof'
>;

function normalizeFinanceFilingRowValue(
  value: unknown,
  fieldName: string,
): FinanceFilingRowValue {
  if (value === null) {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Finance filing row field '${fieldName}' is not a finite number.`);
    }
    return value;
  }

  throw new Error(
    `Finance filing row field '${fieldName}' is not canonicalizable for release binding.`,
  );
}

function normalizeFinanceFilingRow(row: Record<string, unknown>): FinanceFilingRow {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(row).map(([fieldName, value]) => [
        fieldName,
        normalizeFinanceFilingRowValue(value, fieldName),
      ]),
    ) as FinanceFilingRow,
  );
}

function runtimeFinding(
  code: string,
  result: ReleaseFinding['result'],
  message: string,
): ReleaseFinding {
  return {
    code,
    result,
    message,
    source: 'runtime',
  };
}

export function createFinanceFilingReleaseCandidateFromReport(
  report: Pick<
    FinancialRunReport,
    'runId' | 'decision' | 'certificate' | 'evidenceChain' | 'execution' | 'liveProof'
  >,
  adapterId = FINANCE_FILING_ADAPTER_ID,
): FinanceFilingReleaseCandidate | null {
  if (!report.execution?.success || report.execution.rows.length === 0) {
    return null;
  }

  return Object.freeze({
    adapterId,
    runId: report.runId,
    decision: report.decision,
    certificateId: report.certificate?.certificateId ?? null,
    evidenceChainTerminal: report.evidenceChain?.terminalHash ?? '',
    rows: Object.freeze(report.execution.rows.map((row) => normalizeFinanceFilingRow(row))),
    proofMode: report.liveProof.mode,
  });
}

export function financeFilingReleaseOutputContract(): OutputContractDescriptor {
  return {
    artifactType: FINANCE_FILING_ARTIFACT_TYPE,
    expectedShape: FINANCE_FILING_EXPECTED_SHAPE,
    consequenceType: 'record',
    riskClass: 'R4',
  };
}

export function financeFilingReleaseCapabilityBoundary(): CapabilityBoundaryDescriptor {
  return {
    allowedTools: ['xbrl-export', 'filing-prepare'],
    allowedTargets: [FINANCE_FILING_PREPARE_TARGET_ID],
    allowedDataDomains: ['financial-reporting'],
  };
}

function financeFilingReleaseOutputPayload(
  candidate: FinanceFilingReleaseCandidate,
): Record<string, FinanceFilingRowValue | readonly FinanceFilingRow[]> {
  return {
    adapterId: candidate.adapterId,
    runId: candidate.runId,
    decision: candidate.decision,
    certificateId: candidate.certificateId,
    evidenceChainTerminal: candidate.evidenceChainTerminal,
    proofMode: candidate.proofMode,
    rows: candidate.rows,
  };
}

function financeFilingReleaseConsequencePayload(
  candidate: FinanceFilingReleaseCandidate,
): Record<string, FinanceFilingRowValue | readonly FinanceFilingRow[]> {
  return {
    operation: 'filing-export',
    adapterId: candidate.adapterId,
    targetId: FINANCE_FILING_PREPARE_TARGET_ID,
    runId: candidate.runId,
    decision: candidate.decision,
    certificateId: candidate.certificateId,
    evidenceChainTerminal: candidate.evidenceChainTerminal,
    proofMode: candidate.proofMode,
    rows: candidate.rows,
  };
}

export function buildFinanceFilingReleaseMaterial(
  candidate: FinanceFilingReleaseCandidate,
): FinanceFilingReleaseMaterial {
  const outputContract = financeFilingReleaseOutputContract();
  const target = FINANCE_FILING_PREPARE_TARGET;

  return Object.freeze({
    version: FINANCE_RECORD_RELEASE_SPEC_VERSION,
    candidate,
    target,
    outputContract,
    capabilityBoundary: financeFilingReleaseCapabilityBoundary(),
    hashBundle: createCanonicalReleaseHashBundle({
      outputContract,
      target,
      outputPayload: financeFilingReleaseOutputPayload(candidate),
      consequencePayload: financeFilingReleaseConsequencePayload(candidate),
    }),
  });
}

export function financeFilingReleaseStatusFromReport(
  report: FinanceFilingReleaseReportLike,
): ReleaseDecisionStatus {
  if (!report.execution?.success || report.execution.rows.length === 0) {
    return 'denied';
  }

  if (
    report.decision === 'block' ||
    report.decision === 'fail' ||
    report.decision === 'rejected'
  ) {
    return 'denied';
  }

  if (
    report.receipt?.receiptStatus === 'issued' &&
    report.escrow.state === 'released' &&
    report.filingReadiness.status !== 'blocked'
  ) {
    return 'accepted';
  }

  if (report.decision === 'pending_approval' || report.oversight.status === 'pending') {
    return 'review-required';
  }

  return 'hold';
}

export function buildFinanceFilingReleaseObservation(
  material: FinanceFilingReleaseMaterial,
  report: FinanceFilingReleaseReportLike,
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
    usedTools: ['xbrl-export', 'filing-prepare'],
    usedDataDomains: ['financial-reporting'],
    observedOutputHash: material.hashBundle.outputHash,
    observedConsequenceHash: material.hashBundle.consequenceHash,
    policyRulesSatisfied:
      report.audit.chainIntact &&
      report.evidenceChain.intact &&
      report.receipt?.receiptStatus === 'issued' &&
      report.filingReadiness.status !== 'blocked' &&
      (report.decision === 'pass' || report.decision === 'warn'),
    evidenceKinds,
    traceGradePassed: report.liveProof.consistent ?? false,
    provenanceBound:
      !!report.attestation &&
      !!report.certificate &&
      !!report.evidenceChain?.terminalHash,
    downstreamReceiptConfirmed: report.receipt?.receiptStatus === 'issued',
  };
}

export function releaseDecisionHasDeterministicFailures(decision: ReleaseDecision): boolean {
  return decision.findings.some(
    (finding) => finding.source === 'deterministic-check' && finding.result === 'fail',
  );
}

export function finalizeFinanceFilingReleaseDecision(
  decision: ReleaseDecision,
  report: FinanceFilingReleaseReportLike,
): ReleaseDecision {
  const terminalStatus = financeFilingReleaseStatusFromReport(report);
  const deterministicFailures = releaseDecisionHasDeterministicFailures(decision);

  if (deterministicFailures) {
    return {
      ...decision,
      status: terminalStatus === 'denied' ? 'denied' : 'hold',
      findings: [
        ...decision.findings,
        runtimeFinding(
          'finance_record_release_not_authorized',
          terminalStatus === 'denied' ? 'fail' : 'warn',
          'The finance filing release candidate did not satisfy deterministic release checks well enough to authorize a filing export token.',
        ),
      ],
    };
  }

  return {
    ...decision,
    status: terminalStatus,
    findings: [
      ...decision.findings,
      runtimeFinding(
        'finance_domain_acceptance_bridge',
        terminalStatus === 'accepted' ? 'pass' : terminalStatus === 'denied' ? 'fail' : 'info',
        terminalStatus === 'accepted'
          ? 'Existing finance-domain authority signals satisfied the first hard-gateway release criteria for filing preparation.'
          : terminalStatus === 'review-required'
            ? 'Finance-domain acceptance still requires review before a filing-preparation release token may be issued.'
            : terminalStatus === 'denied'
              ? 'Finance-domain authority withheld release because the filing candidate was not acceptable for consequence.'
              : 'Finance-domain authority has not released this filing candidate yet, so the consequence remains on hold.',
      ),
    ],
  };
}
