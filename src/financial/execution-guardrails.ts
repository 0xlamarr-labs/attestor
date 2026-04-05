/**
 * Execution Guardrails v1 — Query shape and resource boundary enforcement.
 *
 * Gates between policy (access allowed) and execution (query runs).
 * Validates that the SQL shape matches the declared execution class and budget.
 *
 * Checks:
 * 1. Wildcard projection (SELECT *)
 * 2. WHERE clause presence (for bounded_detail / reconciliation_check)
 * 3. JOIN count within budget
 * 4. Projected column count within budget
 * 5. Aggregate vs detail distinction
 * 6. LIMIT presence (for bounded_detail)
 *
 * All checks are deterministic — no database access required.
 */

import type { ExecutionClass, ExecutionBudget, GuardrailResult, GuardrailCheck } from './types.js';

function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Evaluate execution guardrails for a candidate SQL.
 */
export function evaluateGuardrails(
  sql: string,
  executionClass: ExecutionClass = 'unbounded',
  budget: ExecutionBudget = {},
): GuardrailResult {
  const normalized = normalizeSql(sql);
  const checks: GuardrailCheck[] = [];

  // 1. Wildcard projection
  const hasWildcard = /\bselect\s+\*/.test(normalized) || /,\s*\*\s*(from|,)/.test(normalized);
  if (hasWildcard && budget.allowWildcard === false) {
    checks.push({ check: 'no_wildcard', passed: false, detail: 'SELECT * detected but wildcard projection is not allowed by execution budget' });
  } else if (hasWildcard) {
    checks.push({ check: 'no_wildcard', passed: true, detail: 'SELECT * detected — wildcard is allowed (budget.allowWildcard not false)' });
  } else {
    checks.push({ check: 'no_wildcard', passed: true, detail: 'No wildcard projection' });
  }

  // 2. WHERE clause (required for bounded_detail, reconciliation_check)
  const hasWhere = /\bwhere\b/.test(normalized);
  const requireWhere = budget.requireWhere ?? (executionClass === 'bounded_detail' || executionClass === 'reconciliation_check');
  if (requireWhere && !hasWhere) {
    checks.push({ check: 'require_where', passed: false, detail: `WHERE clause required for execution class "${executionClass}" but not found` });
  } else {
    checks.push({ check: 'require_where', passed: true, detail: hasWhere ? 'WHERE clause present' : 'WHERE clause not required for this execution class' });
  }

  // 3. JOIN count
  const joinCount = (normalized.match(/\bjoin\b/g) || []).length;
  if (budget.maxJoins !== undefined && joinCount > budget.maxJoins) {
    checks.push({ check: 'join_budget', passed: false, detail: `${joinCount} JOINs exceed budget of ${budget.maxJoins}` });
  } else {
    checks.push({ check: 'join_budget', passed: true, detail: `${joinCount} JOINs${budget.maxJoins !== undefined ? ` within budget of ${budget.maxJoins}` : ''}` });
  }

  // 4. Projected columns (count SELECT-list columns by commas between SELECT and FROM)
  const selectMatch = normalized.match(/^(?:with\s+.*?\)\s*)?select\s+(.*?)\s+from\b/s);
  let projectedCols = 0;
  if (selectMatch) {
    projectedCols = selectMatch[1].split(',').length;
  }
  if (budget.maxProjectedColumns !== undefined && projectedCols > budget.maxProjectedColumns) {
    checks.push({ check: 'column_budget', passed: false, detail: `${projectedCols} projected columns exceed budget of ${budget.maxProjectedColumns}` });
  } else {
    checks.push({ check: 'column_budget', passed: true, detail: `${projectedCols} projected columns${budget.maxProjectedColumns !== undefined ? ` within budget of ${budget.maxProjectedColumns}` : ''}` });
  }

  // 5. Aggregate detection
  const hasAggregate = /\b(sum|avg|count|min|max)\s*\(/.test(normalized);
  const hasGroupBy = /\bgroup\s+by\b/.test(normalized);
  if (executionClass === 'aggregate_summary' && !hasAggregate && !hasGroupBy) {
    checks.push({ check: 'aggregate_shape', passed: false, detail: 'Execution class is aggregate_summary but no aggregate functions or GROUP BY found' });
  } else {
    checks.push({ check: 'aggregate_shape', passed: true, detail: hasAggregate ? 'Aggregate functions present' : 'No aggregate functions (acceptable for non-aggregate class)' });
  }

  // 6. LIMIT clause (for bounded_detail)
  const hasLimit = /\blimit\b/.test(normalized);
  const requireLimit = budget.requireLimit ?? (executionClass === 'bounded_detail');
  if (requireLimit && !hasLimit) {
    checks.push({ check: 'require_limit', passed: false, detail: `LIMIT clause required for execution class "${executionClass}" but not found` });
  } else {
    checks.push({ check: 'require_limit', passed: true, detail: hasLimit ? 'LIMIT clause present' : 'LIMIT not required for this execution class' });
  }

  const failedChecks = checks.filter((c) => !c.passed);

  return {
    result: failedChecks.length > 0 ? 'fail' : 'pass',
    checks,
    executionClass,
    totalChecks: checks.length,
    failedChecks: failedChecks.length,
  };
}
