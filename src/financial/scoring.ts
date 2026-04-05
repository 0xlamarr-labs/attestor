/**
 * Financial Authority Stack v2 — Deterministic scoring cascade.
 *
 * Scorers in priority order:
 * 1. sql_safety       — pre-execution SQL governance passed
 * 2. execution        — SQL executed successfully
 * 3. data_contracts   — output conforms to data contracts
 * 4. reconciliation   — output values are internally consistent
 * 5. report_structure — generated report passes structural validation
 * 6. provenance       — reported values are traceable to execution evidence
 * 7. audit_integrity  — audit trail hash chain is intact
 *
 * Short-circuit: sql_safety or execution failure stops the cascade.
 * After cascade: oversight check may elevate decision to pending_approval.
 * All scorers are deterministic — no LLM calls.
 */

import type {
  FinancialScore,
  FinancialScoringResult,
  FinancialDecision,
  SqlGovernanceResult,
  ExecutionEvidence,
  DataContractResult,
  ReportValidationResult,
  AuditTrail,
  LineageEvidence,
  ReviewPolicyResult,
} from './types.js';

export interface FinancialScoringContext {
  sqlGovernance: SqlGovernanceResult;
  execution: ExecutionEvidence | null;
  dataContract: DataContractResult | null;
  reportValidation: ReportValidationResult | null;
  audit: AuditTrail;
  lineage: LineageEvidence;
  reviewPolicy: ReviewPolicyResult;
}

type FinancialScorerFn = (ctx: FinancialScoringContext) => FinancialScore;

// ─── Individual Scorers ──────────────────────────────────────────────────────

const scoreSqlSafety: FinancialScorerFn = (ctx) => {
  const passed = ctx.sqlGovernance.result === 'pass';
  const failedGates = ctx.sqlGovernance.gates.filter((g) => !g.passed);
  return {
    scorer: 'sql_safety',
    value: passed ? true : false,
    verdict: passed
      ? `All ${ctx.sqlGovernance.gates.length} SQL governance gates passed (${ctx.sqlGovernance.referencedTables.length} table refs analyzed)`
      : `SQL governance failed: ${failedGates.map((g) => g.gate).join(', ')}`,
    explanation: passed
      ? `Tables: ${ctx.sqlGovernance.referencedTables.map((r) => r.reference).join(', ') || 'none'}`
      : `Failed gates: ${failedGates.map((g) => `${g.gate}: ${g.detail}`).join('; ')}`,
  };
};

const scoreExecution: FinancialScorerFn = (ctx) => {
  if (!ctx.execution) {
    return { scorer: 'execution', value: 'skip', verdict: 'Execution skipped (SQL governance failed)', explanation: 'SQL did not pass governance gates.' };
  }
  return {
    scorer: 'execution',
    value: ctx.execution.success ? true : false,
    verdict: ctx.execution.success
      ? `Query executed: ${ctx.execution.rowCount} rows, ${ctx.execution.columns.length} columns, ${ctx.execution.durationMs}ms`
      : `Execution failed: ${ctx.execution.error}`,
    explanation: ctx.execution.success
      ? `Schema hash: ${ctx.execution.schemaHash}`
      : 'Query execution did not produce valid results.',
  };
};

const scoreDataContracts: FinancialScorerFn = (ctx) => {
  if (!ctx.dataContract) {
    return { scorer: 'data_contracts', value: 'skip', verdict: 'No data contract evidence', explanation: 'Data contracts not evaluated.' };
  }
  const r = ctx.dataContract;
  return {
    scorer: 'data_contracts',
    value: r.result === 'pass' ? true : r.result === 'warn' ? 'warn' : false,
    verdict: `Data contracts: ${r.result} (${r.totalChecks - r.failedChecks}/${r.totalChecks} passed)`,
    explanation: r.failedChecks > 0
      ? `Failed: ${r.checks.filter((c) => !c.passed).map((c) => c.detail).join('; ')}`
      : 'All data contract checks passed.',
  };
};

const scoreReconciliation: FinancialScorerFn = (ctx) => {
  if (!ctx.dataContract) {
    return { scorer: 'reconciliation', value: 'skip', verdict: 'No reconciliation evidence', explanation: 'Data contracts not available.' };
  }
  const reconChecks = ctx.dataContract.checks.filter((c) =>
    c.check.startsWith('sum_equals') || c.check.startsWith('range'),
  );
  if (reconChecks.length === 0) {
    return { scorer: 'reconciliation', value: 'skip', verdict: 'No reconciliation constraints defined', explanation: 'No sum_equals or range constraints.' };
  }
  const failed = reconChecks.filter((c) => !c.passed);
  return {
    scorer: 'reconciliation',
    value: failed.length === 0 ? true : false,
    verdict: `Reconciliation: ${reconChecks.length - failed.length}/${reconChecks.length} checks passed`,
    explanation: failed.length > 0
      ? `Failed: ${failed.map((c) => c.detail).join('; ')}`
      : 'All reconciliation checks passed.',
  };
};

const scoreReportStructure: FinancialScorerFn = (ctx) => {
  if (!ctx.reportValidation) {
    return { scorer: 'report_structure', value: 'skip', verdict: 'No report validation', explanation: 'Report validation not performed.' };
  }
  const r = ctx.reportValidation;
  return {
    scorer: 'report_structure',
    value: r.result === 'pass' ? true : false,
    verdict: `Report structure: ${r.result} (${r.totalChecks - r.failedChecks}/${r.totalChecks} passed)`,
    explanation: r.failedChecks > 0
      ? `Failed: ${r.checks.filter((c) => !c.passed).map((c) => c.detail).join('; ')}`
      : 'All report structure checks passed.',
  };
};

const scoreProvenance: FinancialScorerFn = (ctx) => {
  if (!ctx.reportValidation || ctx.reportValidation.provenance.length === 0) {
    return { scorer: 'provenance', value: 'skip', verdict: 'No provenance records', explanation: 'No numeric cross-references to verify.' };
  }
  const prov = ctx.reportValidation.provenance;
  const mismatches = prov.filter((p) => !p.matches);
  return {
    scorer: 'provenance',
    value: mismatches.length === 0 ? true : false,
    verdict: mismatches.length === 0
      ? `All ${prov.length} provenance records verified (${prov.map((p) => `${p.metric}:${p.aggregation}`).join(', ')})`
      : `Provenance mismatch: ${mismatches.map((p) => `${p.metric} reported=${p.reportedValue} vs computed=${p.computedValue}`).join('; ')}`,
    explanation: mismatches.length === 0
      ? 'Every reported metric is traceable to execution evidence with matching values.'
      : 'Reported values do not match computed values from execution evidence.',
  };
};

const scoreLineage: FinancialScorerFn = (ctx) => {
  const lin = ctx.lineage;
  if (lin.inputs.length === 0 && lin.outputs.length === 0) {
    return { scorer: 'lineage', value: 'skip', verdict: 'No lineage artifacts', explanation: 'No input/output artifacts to trace.' };
  }

  // Lineage is complete if: inputs exist, outputs exist, and provenance is complete
  const hasInputs = lin.inputs.length > 0;
  const hasOutputs = lin.outputs.length > 0;
  const complete = hasInputs && hasOutputs && lin.provenanceComplete;

  return {
    scorer: 'lineage',
    value: complete ? true : 'warn',
    verdict: complete
      ? `Lineage complete: ${lin.inputs.length} inputs → ${lin.outputs.length} outputs, ${lin.metricMappings.length} metric mappings, provenance complete`
      : `Lineage incomplete: inputs=${lin.inputs.length}, outputs=${lin.outputs.length}, provenance_complete=${lin.provenanceComplete}`,
    explanation: complete
      ? `Full traceability: ${lin.chainSummary.length} evidence chain stages.`
      : 'Not all pipeline artifacts are fully traceable. Missing lineage reduces auditability.',
  };
};

const scoreAuditIntegrity: FinancialScorerFn = (ctx) => ({
  scorer: 'audit_integrity',
  value: ctx.audit.chainIntact ? true : false,
  verdict: ctx.audit.chainIntact
    ? `Audit trail intact: ${ctx.audit.entries.length} entries, hash chain verified`
    : 'Audit trail hash chain is broken',
  explanation: ctx.audit.chainIntact
    ? 'Every audit entry links to its predecessor via truncated SHA-256.'
    : 'Hash chain verification failed. Evidence may have been tampered with.',
});

// ─── Cascade Runner ──────────────────────────────────────────────────────────

const FINANCIAL_SCORERS: Array<{ id: string; priority: number; run: FinancialScorerFn }> = [
  { id: 'sql_safety', priority: 1, run: scoreSqlSafety },
  { id: 'execution', priority: 1, run: scoreExecution },
  { id: 'data_contracts', priority: 2, run: scoreDataContracts },
  { id: 'reconciliation', priority: 2, run: scoreReconciliation },
  { id: 'report_structure', priority: 3, run: scoreReportStructure },
  { id: 'provenance', priority: 3, run: scoreProvenance },
  { id: 'lineage', priority: 3, run: scoreLineage },
  { id: 'audit_integrity', priority: 3, run: scoreAuditIntegrity },
];

/**
 * Run the financial scoring cascade.
 * P1 failures short-circuit. After cascade, oversight may elevate to pending_approval.
 */
export function runFinancialScoringCascade(ctx: FinancialScoringContext): FinancialScoringResult {
  const scores: FinancialScore[] = [];
  let scorersRun = 0;

  for (const scorer of FINANCIAL_SCORERS) {
    const score = scorer.run(ctx);
    scores.push(score);
    scorersRun++;

    if (scorer.priority === 1 && score.value === false) {
      break;
    }
  }

  // Determine base decision from evidence
  const failures = scores.filter((s) => s.value === false);
  const warnings = scores.filter((s) => s.value === 'warn');

  let decision: FinancialDecision;
  if (failures.some((f) => {
    const s = FINANCIAL_SCORERS.find((sc) => sc.id === f.scorer);
    return s && s.priority === 1;
  })) {
    decision = 'block';
  } else if (failures.length > 0) {
    decision = 'fail';
  } else if (warnings.length > 0) {
    decision = 'warn';
  } else {
    decision = 'pass';
  }

  // Note: review policy override (pending_approval / rejected) is handled by the pipeline
  // after post-score review policy merge. The scorer returns the evidence-based decision only.

  return { decision, scores, scorersRun };
}
