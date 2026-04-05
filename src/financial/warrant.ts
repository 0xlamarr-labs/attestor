/**
 * Financial Warrant v1.1 — Contract-bound pre-execution authority.
 *
 * Changes from v1:
 * - contractHash binds the full effective contract (not just queryType+description)
 * - Lifecycle simplified: issued → active → fulfilled | violated (removed 'expired')
 * - Stage-by-stage path enforcement helper for pipeline integration
 * - Snapshot validation integrated as a warrant-aware primitive
 * - Trust level reflects review policy state, not just materiality
 */

import { createHash } from 'node:crypto';
import type {
  FinancialWarrant, FinancialQueryIntent, SqlGovernanceResult, PolicyResult,
  GuardrailResult, SnapshotIdentity, TrustLevel, EvidenceObligation,
} from './types.js';

function h(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

const CANONICAL_PATH = [
  'sql_governance', 'policy', 'guardrails', 'execution',
  'data_contracts', 'report_validation', 'lineage',
  'review_policy', 'scoring', 'decision',
];

const BLOCKED_PATH = ['sql_governance', 'policy', 'guardrails', 'decision'];

/**
 * Build a contract-bound identity hash.
 * Includes all fields that define what this run is authorized to do.
 * Excludes run-instance fields (runId, timestamps).
 */
function buildContractHash(intent: FinancialQueryIntent): string {
  return h(JSON.stringify({
    queryType: intent.queryType,
    description: intent.description,
    materialityTier: intent.materialityTier ?? 'medium',
    allowedSchemas: intent.allowedSchemas,
    forbiddenSchemas: intent.forbiddenSchemas,
    expectedColumns: intent.expectedColumns.map((c) => c.name).sort(),
    businessConstraints: intent.businessConstraints.map((c) => c.description).sort(),
    controlTotals: (intent.controlTotals ?? []).map((ct) => `${ct.column}:${ct.expectedTotal}`).sort(),
    reconciliationClass: intent.reconciliationClass ?? null,
    executionClass: intent.executionClass ?? 'unbounded',
    executionBudget: intent.executionBudget ?? {},
    reviewTriggers: (intent.reviewTriggers ?? []).map((t) => t.id).sort(),
  }));
}

function buildEvidenceObligations(hasReport: boolean): EvidenceObligation[] {
  const obs: EvidenceObligation[] = [
    { id: 'sql_governance_pass', description: 'SQL governance gates must pass', fulfilled: false },
    { id: 'policy_pass', description: 'Policy entitlement must be granted', fulfilled: false },
    { id: 'guardrails_pass', description: 'Execution guardrails must pass', fulfilled: false },
    { id: 'snapshot_bound', description: 'Execution bound to a specific snapshot', fulfilled: false },
    { id: 'data_contracts_checked', description: 'Data contracts validated', fulfilled: false },
    { id: 'audit_chain_present', description: 'Audit trail present and intact', fulfilled: false },
  ];
  if (hasReport) {
    obs.push({ id: 'provenance_checked', description: 'Report provenance verified', fulfilled: false });
    obs.push({ id: 'reconciliation_checked', description: 'Reconciliation/control totals checked', fulfilled: false });
  }
  return obs;
}

function deriveTrustLevel(
  materialityTier: string,
  reviewRequired: boolean,
  policyDenied: boolean,
  allPreGatesPass: boolean,
): TrustLevel {
  if (!allPreGatesPass || policyDenied) return 'observe_only';
  if (materialityTier === 'high' || reviewRequired) return 'human_approved';
  if (materialityTier === 'medium') return 'bounded_autonomy';
  return 'domain_autonomy';
}

function fulfillOb(obs: EvidenceObligation[], id: string): void {
  const ob = obs.find((o) => o.id === id);
  if (ob) ob.fulfilled = true;
}

/**
 * Issue a financial warrant from pre-execution evidence.
 */
export function issueWarrant(
  runId: string,
  intent: FinancialQueryIntent,
  sqlGovernance: SqlGovernanceResult,
  policyResult: PolicyResult,
  guardrailResult: GuardrailResult,
  snapshot: SnapshotIdentity,
  replayIdentity: string,
  hasReport: boolean,
): FinancialWarrant {
  const allPreGatesPass = sqlGovernance.result === 'pass'
    && policyResult.result === 'pass'
    && guardrailResult.result !== 'fail';

  const contractHash = buildContractHash(intent);
  const allowedPath = allPreGatesPass ? [...CANONICAL_PATH] : [...BLOCKED_PATH];

  const trustLevel = deriveTrustLevel(
    intent.materialityTier ?? 'medium',
    (intent.materialityTier ?? 'medium') === 'high',
    policyResult.result === 'fail',
    allPreGatesPass,
  );

  const evidenceObligations = buildEvidenceObligations(hasReport);
  if (sqlGovernance.result === 'pass') fulfillOb(evidenceObligations, 'sql_governance_pass');
  if (policyResult.result === 'pass') fulfillOb(evidenceObligations, 'policy_pass');
  if (guardrailResult.result !== 'fail') fulfillOb(evidenceObligations, 'guardrails_pass');
  fulfillOb(evidenceObligations, 'snapshot_bound');

  const violations: string[] = [];
  if (!allPreGatesPass) {
    if (sqlGovernance.result === 'fail') violations.push(`sql_governance: ${sqlGovernance.gates.filter((g) => !g.passed).map((g) => g.gate).join(', ')}`);
    if (policyResult.result === 'fail') violations.push(`policy: ${policyResult.decisions.filter((d) => d.verdict === 'denied').map((d) => d.reference).join(', ')}`);
    if (guardrailResult.result === 'fail') violations.push(`guardrails: ${guardrailResult.checks.filter((c) => !c.passed).map((c) => c.check).join(', ')}`);
  }

  return {
    warrantId: `wrnt_${runId}_${h(contractHash + snapshot.snapshotHash).slice(0, 8)}`,
    issuedAt: new Date().toISOString(),
    runId,
    contractHash: contractHash,
    replayIdentity,
    snapshotHash: snapshot.snapshotHash,
    allowedScope: policyResult.decisions.filter((d) => d.verdict === 'allowed').map((d) => d.reference),
    deniedScope: policyResult.decisions.filter((d) => d.verdict === 'denied').map((d) => d.reference),
    executionClass: intent.executionClass ?? 'unbounded',
    executionBudget: intent.executionBudget ?? {},
    trustLevel,
    allowedPath,
    evidenceObligations,
    reviewRequired: trustLevel === 'human_approved',
    materialityTier: intent.materialityTier ?? 'medium',
    status: allPreGatesPass ? 'active' : 'violated',
    violations,
  };
}

/** Validate a stage against the warrant. Returns violation string or null. */
export function validateWarrantStage(warrant: FinancialWarrant, stage: string): string | null {
  if (warrant.status === 'violated') return `Warrant ${warrant.warrantId} is violated — stage "${stage}" blocked`;
  if (!warrant.allowedPath.includes(stage)) return `Stage "${stage}" not in allowed path: [${warrant.allowedPath.join(', ')}]`;
  return null;
}

/** Validate snapshot consistency. Returns violation string or null. */
export function validateWarrantSnapshot(warrant: FinancialWarrant, snapshotHash: string): string | null {
  if (warrant.snapshotHash !== snapshotHash) return `Snapshot mismatch: warrant=${warrant.snapshotHash}, actual=${snapshotHash}`;
  return null;
}

/** Record a violation and set status. */
export function recordWarrantViolation(warrant: FinancialWarrant, violation: string): void {
  warrant.violations.push(violation);
  warrant.status = 'violated';
}

/** Fulfill an evidence obligation. */
export function fulfillWarrantObligation(warrant: FinancialWarrant, obligationId: string): void {
  fulfillOb(warrant.evidenceObligations, obligationId);
}

/** Finalize: all obligations fulfilled → fulfilled, else stays active. Violated stays violated. */
export function finalizeWarrant(warrant: FinancialWarrant): void {
  if (warrant.status === 'violated') return;
  warrant.status = warrant.evidenceObligations.every((o) => o.fulfilled) ? 'fulfilled' : 'active';
}

/** Compact warrant summary for reviewer-facing artifacts. */
export function warrantSummary(w: FinancialWarrant): {
  warrantId: string; status: string; trustLevel: string;
  contractHash: string; snapshotHash: string;
  pathStages: number; obligationsFulfilled: number; obligationsTotal: number;
  violations: string[];
} {
  return {
    warrantId: w.warrantId,
    status: w.status,
    trustLevel: w.trustLevel,
    contractHash: w.contractHash,
    snapshotHash: w.snapshotHash,
    pathStages: w.allowedPath.length,
    obligationsFulfilled: w.evidenceObligations.filter((o) => o.fulfilled).length,
    obligationsTotal: w.evidenceObligations.length,
    violations: w.violations,
  };
}
