import {
  buildFinanceFilingReleaseMaterial,
  buildFinanceFilingReleaseObservation,
  createFinanceFilingReleaseCandidateFromReport,
  finalizeFinanceFilingReleaseDecision,
} from '../release-kernel/finance-record-release.js';
import {
  createReleaseDecisionEngine,
  type ReleaseDeterministicEvaluationResult,
} from '../release-kernel/release-decision-engine.js';
import type { ReleaseDecision, ReleaseFinding } from '../release-kernel/object-model.js';
import type { ReleaseDecisionStatus } from '../release-kernel/types.js';
import {
  getProofScenario,
  type ProofScenarioCheckSet,
  type ProofScenarioConsequence,
  type ProofScenarioDefinition,
  type ProofScenarioId,
  type ProofScenarioProofMaterial,
  type ProofSurfaceDecision,
} from './scenario-registry.js';

export type FinanceProofScenarioId = Extract<
  ProofScenarioId,
  'finance-filing-admit' | 'finance-filing-review'
>;

export const FINANCE_PROOF_SCENARIO_IDS = [
  'finance-filing-admit',
  'finance-filing-review',
] as const satisfies readonly FinanceProofScenarioId[];

type FinanceCandidateReport =
  Parameters<typeof createFinanceFilingReleaseCandidateFromReport>[0];
type FinanceObservationReport =
  Parameters<typeof buildFinanceFilingReleaseObservation>[1];
type FinanceFinalizationReport =
  Parameters<typeof finalizeFinanceFilingReleaseDecision>[1];
type FinanceProofReport =
  FinanceCandidateReport & FinanceObservationReport & FinanceFinalizationReport;

export interface FinanceProofRunMaterial {
  readonly candidateRunId: string;
  readonly adapterId: string;
  readonly targetId: string;
  readonly targetDisplayName: string | null;
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly rowCount: number;
  readonly proofMode: string;
  readonly certificateId: string | null;
  readonly evidenceChainTerminal: string;
}

export interface FinanceProofCheckResult {
  readonly policySatisfied: boolean;
  readonly authoritySatisfied: boolean;
  readonly evidenceSatisfied: boolean;
  readonly deterministicFindingCodes: readonly string[];
}

export interface FinanceProofScenarioRun {
  readonly version: 'attestor.proof-surface.finance-run.v1';
  readonly scenarioId: FinanceProofScenarioId;
  readonly title: string;
  readonly packFamily: 'finance';
  readonly categoryEntryPoint: string;
  readonly plainLanguageHook: string;
  readonly proposedConsequence: ProofScenarioConsequence;
  readonly checks: ProofScenarioCheckSet;
  readonly expectedDecision: ProofSurfaceDecision;
  readonly decision: ProofSurfaceDecision;
  readonly reason: string;
  readonly policyMatched: boolean;
  readonly matchedPolicyId: string | null;
  readonly deterministicChecksCompleted: boolean;
  readonly rawReleaseStatus: ReleaseDecisionStatus;
  readonly finalReleaseStatus: ReleaseDecisionStatus;
  readonly releaseDecisionId: string;
  readonly checkResult: FinanceProofCheckResult;
  readonly material: FinanceProofRunMaterial;
  readonly proofMaterials: readonly ProofScenarioProofMaterial[];
  readonly failClosed: boolean;
}

function financeReportFixture(
  scenarioId: FinanceProofScenarioId,
): FinanceProofReport {
  const reviewPending = scenarioId === 'finance-filing-review';
  const runId = reviewPending
    ? 'proof-finance-filing-review'
    : 'proof-finance-filing-admit';
  const report = {
    runId,
    decision: 'pass',
    certificate: { certificateId: `cert_${runId}` },
    evidenceChain: {
      terminalHash: `terminal_${runId}`,
      intact: true,
    },
    execution: {
      success: true,
      rows: [
        {
          counterparty_name: 'Northstar Clearing Bank',
          exposure_usd: 125000000,
          credit_rating: 'A',
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
      status: reviewPending ? 'pending' : 'not_required',
    },
    escrow: {
      state: reviewPending ? 'held' : 'released',
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
  };

  return Object.freeze(report) as unknown as FinanceProofReport;
}

function releaseStatusToProofDecision(
  status: ReleaseDecisionStatus,
): ProofSurfaceDecision {
  switch (status) {
    case 'accepted':
      return 'admit';
    case 'review-required':
    case 'hold':
      return 'review';
    case 'denied':
    case 'expired':
    case 'revoked':
      return 'block';
    case 'overridden':
      return 'narrow';
  }
}

function deterministicFindingCodes(decision: ReleaseDecision): readonly string[] {
  return Object.freeze(
    decision.findings
      .filter((finding: ReleaseFinding) => finding.source === 'deterministic-check')
      .map((finding) => finding.code),
  );
}

function buildReason(
  scenario: ProofScenarioDefinition,
  finalDecision: ReleaseDecision,
): string {
  if (finalDecision.status === 'accepted') {
    return `${scenario.expectedReason} Final release status is accepted and the proof material is bound to canonical output and consequence hashes.`;
  }

  if (finalDecision.status === 'review-required') {
    return `${scenario.expectedReason} Final release status is review-required, so the downstream filing-preparation consequence remains paused.`;
  }

  return scenario.expectedReason;
}

export function runFinanceProofScenario(
  scenarioId: FinanceProofScenarioId,
): FinanceProofScenarioRun {
  const scenario = getProofScenario(scenarioId);
  if (scenario.packFamily !== 'finance') {
    throw new Error(`Proof scenario ${scenarioId} is not a finance scenario.`);
  }

  const report = financeReportFixture(scenarioId);
  const candidate = createFinanceFilingReleaseCandidateFromReport(report);
  if (!candidate) {
    throw new Error(`Finance proof scenario ${scenarioId} did not produce a release candidate.`);
  }

  const material = buildFinanceFilingReleaseMaterial(candidate);
  const observation = buildFinanceFilingReleaseObservation(material, report);
  const evaluation: ReleaseDeterministicEvaluationResult =
    createReleaseDecisionEngine().evaluateWithDeterministicChecks(
      {
        id: `proof-${scenarioId}`,
        createdAt: '2026-04-22T12:00:00.000Z',
        outputHash: material.hashBundle.outputHash,
        consequenceHash: material.hashBundle.consequenceHash,
        outputContract: material.outputContract,
        capabilityBoundary: material.capabilityBoundary,
        requester: {
          id: 'svc.attestor.proof-surface',
          type: 'service',
          displayName: 'Attestor Proof Surface',
          role: 'proof-demo-runner',
        },
        target: material.target,
      },
      observation,
    );

  const finalDecision = finalizeFinanceFilingReleaseDecision(
    evaluation.decision,
    report,
  );
  const decision = releaseStatusToProofDecision(finalDecision.status);

  if (decision !== scenario.expectedDecision) {
    throw new Error(
      `Finance proof scenario ${scenarioId} expected ${scenario.expectedDecision} but produced ${decision}.`,
    );
  }

  return Object.freeze({
    version: 'attestor.proof-surface.finance-run.v1',
    scenarioId,
    title: scenario.title,
    packFamily: 'finance',
    categoryEntryPoint: scenario.categoryEntryPoint,
    plainLanguageHook: scenario.plainLanguageHook,
    proposedConsequence: scenario.proposedConsequence,
    checks: scenario.checks,
    expectedDecision: scenario.expectedDecision,
    decision,
    reason: buildReason(scenario, finalDecision),
    policyMatched: evaluation.policyMatched,
    matchedPolicyId: evaluation.matchedPolicyId,
    deterministicChecksCompleted: evaluation.deterministicChecksCompleted,
    rawReleaseStatus: evaluation.decision.status,
    finalReleaseStatus: finalDecision.status,
    releaseDecisionId: finalDecision.id,
    checkResult: Object.freeze({
      policySatisfied: evaluation.policyMatched,
      authoritySatisfied: finalDecision.status === 'accepted',
      evidenceSatisfied: observation.policyRulesSatisfied,
      deterministicFindingCodes: deterministicFindingCodes(evaluation.decision),
    }),
    material: Object.freeze({
      candidateRunId: candidate.runId,
      adapterId: candidate.adapterId,
      targetId: material.target.id,
      targetDisplayName: material.target.displayName ?? null,
      outputHash: material.hashBundle.outputHash,
      consequenceHash: material.hashBundle.consequenceHash,
      rowCount: candidate.rows.length,
      proofMode: candidate.proofMode,
      certificateId: candidate.certificateId,
      evidenceChainTerminal: candidate.evidenceChainTerminal,
    }),
    proofMaterials: scenario.proofMaterials,
    failClosed: finalDecision.status !== 'accepted',
  });
}

export function runFinanceProofScenarios():
readonly FinanceProofScenarioRun[] {
  return Object.freeze(
    FINANCE_PROOF_SCENARIO_IDS.map((scenarioId) =>
      runFinanceProofScenario(scenarioId),
    ),
  );
}
