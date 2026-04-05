/**
 * Attestor Semantic Clauses — Machine-Checkable Analytical Obligations
 *
 * Goes beyond SQL-shape governance: these define what the NUMBERS must satisfy,
 * not just what the QUERY must look like.
 *
 * Clause types:
 * - balance_identity: net = gross_long - gross_short (additive identity)
 * - control_total: total must equal sum of parts (reconciliation)
 * - ratio_bound: ratio must be within acceptable range
 * - sign_constraint: column values must be positive/negative/non-negative
 * - completeness_check: required columns must have no nulls
 *
 * These are the first step toward semantic analytical governance:
 * the system can verify that financial outputs satisfy their mathematical
 * obligations, not just their schema obligations.
 */

import type { SemanticClause, SemanticClauseEvaluation, SemanticClauseResult, ExecutionEvidence } from './types.js';

/**
 * Evaluate semantic clauses against actual execution results.
 */
export function evaluateSemanticClauses(
  clauses: SemanticClause[],
  execution: ExecutionEvidence | null,
): SemanticClauseResult {
  if (!execution?.success || clauses.length === 0) {
    return { performed: false, clauseCount: clauses.length, passCount: 0, failCount: 0, hardFailCount: 0, evaluations: [] };
  }

  const evaluations: SemanticClauseEvaluation[] = clauses.map((clause) => {
    switch (clause.type) {
      case 'balance_identity': return evaluateBalanceIdentity(clause, execution);
      case 'control_total': return evaluateControlTotal(clause, execution);
      case 'ratio_bound': return evaluateRatioBound(clause, execution);
      case 'sign_constraint': return evaluateSignConstraint(clause, execution);
      case 'completeness_check': return evaluateCompletenessCheck(clause, execution);
      default: return { clause, passed: false, observed: {}, expected: clause.expression, variance: null, explanation: `Unknown clause type: ${clause.type}` };
    }
  });

  const passCount = evaluations.filter((e) => e.passed).length;
  const failCount = evaluations.filter((e) => !e.passed).length;
  const hardFailCount = evaluations.filter((e) => !e.passed && e.clause.severity === 'hard').length;

  return { performed: true, clauseCount: clauses.length, passCount, failCount, hardFailCount, evaluations };
}

// ─── Column value extraction ─────────────────────────────────────────────────

function extractColumnValues(column: string, execution: ExecutionEvidence): number[] {
  const colIndex = execution.columns.indexOf(column);
  if (colIndex === -1) return [];
  return execution.rows
    .map((row) => {
      const val = row[column];
      return typeof val === 'number' ? val : parseFloat(String(val));
    })
    .filter((v) => !isNaN(v));
}

function sumColumn(column: string, execution: ExecutionEvidence): number | null {
  const values = extractColumnValues(column, execution);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
}

// ─── Clause evaluators ───────────────────────────────────────────────────────

function evaluateBalanceIdentity(clause: SemanticClause, execution: ExecutionEvidence): SemanticClauseEvaluation {
  // Expression format: "result_col = col_a - col_b" or "result_col = col_a + col_b"
  const parts = clause.expression.split('=').map((s) => s.trim());
  if (parts.length !== 2) return { clause, passed: false, observed: {}, expected: clause.expression, variance: null, explanation: 'Cannot parse balance identity expression' };

  const resultCol = parts[0];
  const resultSum = sumColumn(resultCol, execution);

  // Parse right side: col_a +/- col_b
  const rhsParts = parts[1].split(/\s*([+-])\s*/);
  let computed = sumColumn(rhsParts[0], execution) ?? 0;
  const observed: Record<string, number> = { [rhsParts[0]]: computed };
  for (let i = 1; i < rhsParts.length; i += 2) {
    const op = rhsParts[i];
    const col = rhsParts[i + 1];
    const val = sumColumn(col, execution) ?? 0;
    observed[col] = val;
    computed = op === '+' ? computed + val : computed - val;
  }
  observed[resultCol] = resultSum ?? 0;

  const variance = resultSum !== null ? Math.abs(resultSum - computed) : null;
  const passed = variance !== null && variance <= clause.tolerance;

  return { clause, passed, observed, expected: clause.expression, variance, explanation: passed ? `Balance holds: ${resultCol}=${resultSum}, computed=${computed.toFixed(4)}` : `Balance violated: ${resultCol}=${resultSum}, expected=${computed.toFixed(4)}, variance=${variance?.toFixed(4)}` };
}

function evaluateControlTotal(clause: SemanticClause, execution: ExecutionEvidence): SemanticClauseEvaluation {
  // Expression format: "total_col = sum(detail_col)"
  const parts = clause.expression.split('=').map((s) => s.trim());
  if (parts.length !== 2) return { clause, passed: false, observed: {}, expected: clause.expression, variance: null, explanation: 'Cannot parse control total expression' };

  const totalCol = parts[0];
  const detailMatch = parts[1].match(/sum\((\w+)\)/i);
  if (!detailMatch) return { clause, passed: false, observed: {}, expected: clause.expression, variance: null, explanation: 'Right side must be sum(column)' };

  const detailCol = detailMatch[1];
  const totalValue = sumColumn(totalCol, execution);
  const detailSum = sumColumn(detailCol, execution);

  const observed: Record<string, number> = {};
  if (totalValue !== null) observed[totalCol] = totalValue;
  if (detailSum !== null) observed[`sum(${detailCol})`] = detailSum;

  const variance = totalValue !== null && detailSum !== null ? Math.abs(totalValue - detailSum) : null;
  const passed = variance !== null && variance <= clause.tolerance;

  return { clause, passed, observed, expected: clause.expression, variance, explanation: passed ? `Control total holds: ${totalCol}=${totalValue}, sum(${detailCol})=${detailSum?.toFixed(4)}` : `Control total failed: ${totalCol}=${totalValue}, sum(${detailCol})=${detailSum?.toFixed(4)}, variance=${variance?.toFixed(4)}` };
}

function evaluateRatioBound(clause: SemanticClause, execution: ExecutionEvidence): SemanticClauseEvaluation {
  // Expression format: "ratio_col <= 1.0" or "ratio_col >= 0.5"
  const match = clause.expression.match(/(\w+)\s*(<=|>=|<|>)\s*([\d.]+)/);
  if (!match) return { clause, passed: false, observed: {}, expected: clause.expression, variance: null, explanation: 'Cannot parse ratio bound' };

  const [, col, op, threshStr] = match;
  const threshold = parseFloat(threshStr);
  const values = extractColumnValues(col, execution);
  if (values.length === 0) return { clause, passed: false, observed: {}, expected: clause.expression, variance: null, explanation: `Column ${col} not found or empty` };

  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  let passed = true;
  for (const v of values) {
    if (op === '<=' && v > threshold + clause.tolerance) passed = false;
    if (op === '>=' && v < threshold - clause.tolerance) passed = false;
    if (op === '<' && v >= threshold) passed = false;
    if (op === '>' && v <= threshold) passed = false;
  }

  return { clause, passed, observed: { [col]: values.length === 1 ? values[0] : maxVal, min: minVal, max: maxVal }, expected: clause.expression, variance: null, explanation: passed ? `All ${values.length} values of ${col} satisfy ${op} ${threshold}` : `${col} range [${minVal}, ${maxVal}] violates ${op} ${threshold}` };
}

function evaluateSignConstraint(clause: SemanticClause, execution: ExecutionEvidence): SemanticClauseEvaluation {
  // Expression format: "col >= 0" (non-negative) or "col > 0" (positive)
  const match = clause.expression.match(/(\w+)\s*(>=|>|<=|<)\s*([\d.-]+)/);
  if (!match) return { clause, passed: false, observed: {}, expected: clause.expression, variance: null, explanation: 'Cannot parse sign constraint' };

  const [, col, op, threshStr] = match;
  const threshold = parseFloat(threshStr);
  const values = extractColumnValues(col, execution);
  if (values.length === 0) return { clause, passed: false, observed: {}, expected: clause.expression, variance: null, explanation: `Column ${col} not found` };

  let violationCount = 0;
  for (const v of values) {
    if (op === '>=' && v < threshold) violationCount++;
    if (op === '>' && v <= threshold) violationCount++;
    if (op === '<=' && v > threshold) violationCount++;
    if (op === '<' && v >= threshold) violationCount++;
  }

  return { clause, passed: violationCount === 0, observed: { total_values: values.length, violations: violationCount }, expected: clause.expression, variance: null, explanation: violationCount === 0 ? `All ${values.length} values satisfy ${col} ${op} ${threshold}` : `${violationCount}/${values.length} values violate ${col} ${op} ${threshold}` };
}

function evaluateCompletenessCheck(clause: SemanticClause, execution: ExecutionEvidence): SemanticClauseEvaluation {
  // Check that all specified columns have non-null values in all rows
  const observed: Record<string, number> = {};
  let totalNulls = 0;
  for (const col of clause.columns) {
    const colIndex = execution.columns.indexOf(col);
    if (colIndex === -1) { observed[col] = -1; totalNulls++; continue; }
    const nullCount = execution.rows.filter((row) => row[col] === null || row[col] === undefined).length;
    observed[col] = nullCount;
    totalNulls += nullCount;
  }

  return { clause, passed: totalNulls === 0, observed, expected: 'All columns non-null', variance: null, explanation: totalNulls === 0 ? `All ${clause.columns.length} columns complete across ${execution.rows.length} rows` : `${totalNulls} null values found across checked columns` };
}
