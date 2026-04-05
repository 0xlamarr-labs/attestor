/**
 * Multi-Query Governed Pipeline — First Slice
 *
 * Runs N governed query units within a single reporting run.
 * Each unit gets its own governance, evidence, and decision.
 * The run produces an aggregate report preserving:
 * - per-query decisions, blockers, and evidence
 * - overall run decision (worst-case aggregation)
 * - overall proof mode (weakest proof across units)
 * - overall governance sufficiency
 *
 * Design rules:
 * - Each query unit is a full governed pipeline execution
 * - Per-query traceability is never lost
 * - Aggregate decision is conservative: any fail → run fails
 * - Proof mode is truthful: any fixture unit → aggregate proof is hybrid or fixture
 * - Authority chain is per-run (one warrant, one escrow, one receipt)
 *
 * This is NOT a full DAG or differential evidence system yet.
 * It is a bounded first slice: one run, N independent query units, one aggregate.
 */

import { createHash } from 'node:crypto';
import { runFinancialPipeline, type FinancialPipelineInput } from './pipeline.js';
import type {
  FinancialRunReport, FinancialQueryIntent, FinancialDecision,
} from './types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MultiQueryUnit {
  /** Unique identifier for this query unit within the run. */
  unitId: string;
  /** Human-readable label for this query unit. */
  label: string;
  /** Full pipeline input for this unit (runId will be overridden). */
  input: FinancialPipelineInput;
}

export interface MultiQueryUnitResult {
  unitId: string;
  label: string;
  /** Decision for this individual query unit. */
  decision: FinancialDecision;
  /** Whether SQL governance passed for this unit. */
  sqlGovernancePass: boolean;
  /** Whether policy passed for this unit. */
  policyPass: boolean;
  /** Whether guardrails passed for this unit. */
  guardrailsPass: boolean;
  /** Proof mode for this unit. */
  proofMode: string;
  /** Number of audit entries for this unit. */
  auditEntryCount: number;
  /** Evidence chain terminal hash for this unit. */
  evidenceChainTerminal: string;
  /** Number of scorers that ran for this unit. */
  scorersRun: number;
  /** Warrant status for this unit. */
  warrantStatus: string;
  /** Blockers (if any) from this unit's break report. */
  blockers: string[];
  /** Full report for this unit (preserved for downstream use). */
  report: FinancialRunReport;
}

export interface MultiQueryRunReport {
  /** Run ID for the overall multi-query run. */
  runId: string;
  /** Timestamp of the overall run. */
  timestamp: string;
  /** Number of query units in this run. */
  unitCount: number;
  /** Per-query unit results, preserving full evidence. */
  units: MultiQueryUnitResult[];

  /** Aggregate decision: conservative (worst-case). */
  aggregateDecision: FinancialDecision;
  /** How many units passed / failed / blocked / pending. */
  decisionBreakdown: {
    pass: number;
    fail: number;
    block: number;
    pending_approval: number;
  };

  /** Overall governance sufficiency: all units must pass. */
  governanceSufficiency: {
    sufficient: boolean;
    sqlPassCount: number;
    policyPassCount: number;
    guardrailsPassCount: number;
    totalUnits: number;
  };

  /** Aggregate proof mode: weakest across all units. */
  aggregateProofMode: string;
  /** Whether all units are live. */
  allUnitsLive: boolean;
  /** Whether any unit has proof gaps. */
  hasProofGaps: boolean;

  /** Combined blockers across all units. */
  allBlockers: { unitId: string; blocker: string }[];

  /** Aggregate audit: total entries across all units. */
  totalAuditEntries: number;
  /** Whether all unit audit chains are intact. */
  allAuditChainsIntact: boolean;

  /** Run-level hash for replay: hash of all unit evidence chain terminals. */
  multiQueryHash: string;
}

// ─── Decision Aggregation ───────────────────────────────────────────────────

const DECISION_PRIORITY: Record<string, number> = {
  'block': 0,         // worst: blocked before execution
  'fail': 1,          // governance/evidence failure
  'pending_approval': 2, // needs human review
  'pass': 3,          // best case
};

function aggregateDecisions(decisions: FinancialDecision[]): FinancialDecision {
  if (decisions.length === 0) return 'block';
  let worst: FinancialDecision = 'pass';
  let worstPriority = DECISION_PRIORITY['pass'];
  for (const d of decisions) {
    const p = DECISION_PRIORITY[d] ?? 1;
    if (p < worstPriority) {
      worst = d;
      worstPriority = p;
    }
  }
  return worst;
}

// ─── Proof Mode Aggregation ─────────────────────────────────────────────────

const PROOF_MODE_STRENGTH: Record<string, number> = {
  'offline_fixture': 0,
  'mocked_model': 1,
  'hybrid': 2,
  'live_model': 3,
  'live_runtime': 4,
};

function deriveAggregateProofMode(modes: string[]): string {
  if (modes.length === 0) return 'offline_fixture';
  const allSame = modes.every(m => m === modes[0]);
  if (allSame) return modes[0];
  // If any unit is weaker, the aggregate is hybrid
  let weakest = Infinity;
  for (const m of modes) {
    const s = PROOF_MODE_STRENGTH[m] ?? 0;
    if (s < weakest) weakest = s;
  }
  // If weakest is offline_fixture and there are live units → hybrid
  if (weakest < (PROOF_MODE_STRENGTH['live_runtime'] ?? 4)) return 'hybrid';
  return 'live_runtime';
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

/**
 * Run a multi-query governed pipeline.
 *
 * Each unit is a full governed pipeline execution with its own evidence.
 * The aggregate report preserves per-query traceability while providing
 * a conservative overall decision.
 */
export function runMultiQueryPipeline(
  runId: string,
  units: MultiQueryUnit[],
): MultiQueryRunReport {
  const timestamp = new Date().toISOString();
  const results: MultiQueryUnitResult[] = [];

  for (const unit of units) {
    // Override runId to be scoped to this multi-query run
    const unitRunId = `${runId}:${unit.unitId}`;
    const unitInput: FinancialPipelineInput = {
      ...unit.input,
      runId: unitRunId,
    };

    const report = runFinancialPipeline(unitInput);

    const blockers: string[] = [];
    if (report.breakReport.hardStops > 0) {
      for (const b of report.breakReport.breaks) {
        if (b.handling === 'hard_stop') {
          blockers.push(`${b.check}: ${b.description}`);
        }
      }
    }
    // SQL governance blocks
    if (report.sqlGovernance.result !== 'pass') {
      for (const g of report.sqlGovernance.gates) {
        if (!g.passed) blockers.push(`sql:${g.gate}: ${g.detail}`);
      }
    }

    results.push({
      unitId: unit.unitId,
      label: unit.label,
      decision: report.decision,
      sqlGovernancePass: report.sqlGovernance.result === 'pass',
      policyPass: report.policyResult.result === 'pass',
      guardrailsPass: report.guardrailResult.result === 'pass',
      proofMode: report.liveProof.mode,
      auditEntryCount: report.audit.entries.length,
      evidenceChainTerminal: report.evidenceChain.terminalHash,
      scorersRun: report.scoring.scorersRun,
      warrantStatus: report.warrant.status,
      blockers,
      report,
    });
  }

  // Aggregate
  const decisions = results.map(r => r.decision);
  const aggregateDecision = aggregateDecisions(decisions);

  const decisionBreakdown = {
    pass: decisions.filter(d => d === 'pass').length,
    fail: decisions.filter(d => d === 'fail').length,
    block: decisions.filter(d => d === 'block').length,
    pending_approval: decisions.filter(d => d === 'pending_approval').length,
  };

  const sqlPassCount = results.filter(r => r.sqlGovernancePass).length;
  const policyPassCount = results.filter(r => r.policyPass).length;
  const guardrailsPassCount = results.filter(r => r.guardrailsPass).length;
  const governanceSufficiency = {
    sufficient: sqlPassCount === units.length && policyPassCount === units.length && guardrailsPassCount === units.length,
    sqlPassCount,
    policyPassCount,
    guardrailsPassCount,
    totalUnits: units.length,
  };

  const proofModes = results.map(r => r.proofMode);
  const aggregateProofMode = deriveAggregateProofMode(proofModes);
  const allUnitsLive = proofModes.every(m => m === 'live_runtime');
  const hasProofGaps = results.some(r => r.report.liveProof.gaps.length > 0);

  const allBlockers = results.flatMap(r =>
    r.blockers.map(b => ({ unitId: r.unitId, blocker: b }))
  );

  const totalAuditEntries = results.reduce((sum, r) => sum + r.auditEntryCount, 0);
  const allAuditChainsIntact = results.every(r => r.report.audit.chainIntact);

  // Run-level hash: hash of all unit evidence chain terminals (ordered)
  const multiQueryHash = createHash('sha256')
    .update(results.map(r => r.evidenceChainTerminal).join(':'))
    .digest('hex')
    .slice(0, 32);

  return {
    runId,
    timestamp,
    unitCount: units.length,
    units: results,
    aggregateDecision,
    decisionBreakdown,
    governanceSufficiency,
    aggregateProofMode,
    allUnitsLive,
    hasProofGaps,
    allBlockers,
    totalAuditEntries,
    allAuditChainsIntact,
    multiQueryHash,
  };
}

