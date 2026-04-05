/**
 * Data Contract Validation — Post-execution deterministic gates.
 *
 * Validates that SQL execution results conform to expected data contracts.
 * Inspired by dbt model contracts, Great Expectations, and Soda Core patterns.
 * Implementation: Attestor-native, deterministic, no external dependencies.
 *
 * Checks:
 * 1. Schema match (columns present and typed)
 * 2. Required columns present
 * 3. Nullability enforcement
 * 4. Business constraints (min, max, range, non_negative, sum_equals, row_count)
 * 5. Row-count / emptiness checks
 */

import type {
  DataContractResult,
  DataContractCheck,
  DataContractColumn,
  BusinessConstraint,
  ControlTotal,
  ExecutionEvidence,
} from './types.js';

// ─── Schema Checks ───────────────────────────────────────────────────────────

function checkSchemaMatch(
  evidence: ExecutionEvidence,
  expectedColumns: DataContractColumn[],
): DataContractCheck[] {
  const checks: DataContractCheck[] = [];

  for (const col of expectedColumns) {
    const idx = evidence.columns.indexOf(col.name);
    if (idx === -1) {
      if (col.required) {
        checks.push({
          check: `column_present:${col.name}`,
          passed: false,
          detail: `Required column "${col.name}" missing from result`,
          severity: 'hard',
        });
      } else {
        checks.push({
          check: `column_present:${col.name}`,
          passed: true,
          detail: `Optional column "${col.name}" not present (acceptable)`,
          severity: 'soft',
        });
      }
    } else {
      checks.push({
        check: `column_present:${col.name}`,
        passed: true,
        detail: `Column "${col.name}" present at index ${idx}`,
        severity: col.required ? 'hard' : 'soft',
      });
    }
  }

  return checks;
}

// ─── Nullability Checks ──────────────────────────────────────────────────────

function checkNullability(
  evidence: ExecutionEvidence,
  expectedColumns: DataContractColumn[],
): DataContractCheck[] {
  const checks: DataContractCheck[] = [];

  for (const col of expectedColumns) {
    if (!col.notNull) continue;
    const colIdx = evidence.columns.indexOf(col.name);
    if (colIdx === -1) continue; // handled by schema check

    const nullCount = evidence.rows.filter((r) => r[col.name] === null || r[col.name] === undefined).length;
    checks.push({
      check: `not_null:${col.name}`,
      passed: nullCount === 0,
      detail: nullCount === 0
        ? `Column "${col.name}": no null values (${evidence.rows.length} rows)`
        : `Column "${col.name}": ${nullCount} null values found (not-null constraint violated)`,
      severity: 'hard',
    });
  }

  return checks;
}

// ─── Business Constraint Checks ──────────────────────────────────────────────

function checkBusinessConstraints(
  evidence: ExecutionEvidence,
  constraints: BusinessConstraint[],
): DataContractCheck[] {
  const checks: DataContractCheck[] = [];

  for (const constraint of constraints) {
    switch (constraint.check) {
      case 'not_empty': {
        checks.push({
          check: `not_empty`,
          passed: evidence.rows.length > 0,
          detail: evidence.rows.length > 0
            ? `Result has ${evidence.rows.length} rows`
            : 'Result is empty (not_empty constraint violated)',
          severity: 'hard',
        });
        break;
      }
      case 'row_count_min': {
        const pass = evidence.rows.length >= (constraint.value ?? 0);
        checks.push({
          check: `row_count_min:${constraint.value}`,
          passed: pass,
          detail: `Row count ${evidence.rows.length} ${pass ? '>=' : '<'} minimum ${constraint.value}`,
          severity: 'hard',
        });
        break;
      }
      case 'row_count_max': {
        const pass = evidence.rows.length <= (constraint.value ?? Infinity);
        checks.push({
          check: `row_count_max:${constraint.value}`,
          passed: pass,
          detail: `Row count ${evidence.rows.length} ${pass ? '<=' : '>'} maximum ${constraint.value}`,
          severity: 'soft',
        });
        break;
      }
      case 'non_negative': {
        const col = constraint.column;
        const negatives = evidence.rows.filter((r) => typeof r[col] === 'number' && (r[col] as number) < 0);
        checks.push({
          check: `non_negative:${col}`,
          passed: negatives.length === 0,
          detail: negatives.length === 0
            ? `Column "${col}": all values non-negative`
            : `Column "${col}": ${negatives.length} negative values found`,
          severity: 'hard',
        });
        break;
      }
      case 'min': {
        const col = constraint.column;
        const values = evidence.rows.map((r) => r[col]).filter((v) => typeof v === 'number') as number[];
        const minVal = Math.min(...values);
        const pass = values.length > 0 && minVal >= (constraint.value ?? -Infinity);
        checks.push({
          check: `min:${col}:${constraint.value}`,
          passed: pass,
          detail: `Column "${col}": min value ${minVal} ${pass ? '>=' : '<'} threshold ${constraint.value}`,
          severity: 'hard',
        });
        break;
      }
      case 'max': {
        const col = constraint.column;
        const values = evidence.rows.map((r) => r[col]).filter((v) => typeof v === 'number') as number[];
        const maxVal = Math.max(...values);
        const pass = values.length > 0 && maxVal <= (constraint.value ?? Infinity);
        checks.push({
          check: `max:${col}:${constraint.value}`,
          passed: pass,
          detail: `Column "${col}": max value ${maxVal} ${pass ? '<=' : '>'} threshold ${constraint.value}`,
          severity: 'hard',
        });
        break;
      }
      case 'sum_equals': {
        const col = constraint.column;
        const values = evidence.rows.map((r) => r[col]).filter((v) => typeof v === 'number') as number[];
        const sum = values.reduce((a, b) => a + b, 0);
        // Use a small tolerance for floating point
        const pass = Math.abs(sum - (constraint.value ?? 0)) < 0.01;
        checks.push({
          check: `sum_equals:${col}:${constraint.value}`,
          passed: pass,
          detail: `Column "${col}": sum ${sum.toFixed(2)} ${pass ? '≈' : '≠'} expected ${constraint.value}`,
          severity: 'hard',
        });
        break;
      }
      case 'range': {
        const col = constraint.column;
        const values = evidence.rows.map((r) => r[col]).filter((v) => typeof v === 'number') as number[];
        const outOfRange = values.filter((v) => v < (constraint.min ?? -Infinity) || v > (constraint.max ?? Infinity));
        checks.push({
          check: `range:${col}:${constraint.min}-${constraint.max}`,
          passed: outOfRange.length === 0,
          detail: outOfRange.length === 0
            ? `Column "${col}": all ${values.length} values within [${constraint.min}, ${constraint.max}]`
            : `Column "${col}": ${outOfRange.length} values outside [${constraint.min}, ${constraint.max}]`,
          severity: 'hard',
        });
        break;
      }
    }
  }

  return checks;
}

// ─── Main Contract Validation ────────────────────────────────────────────────

/**
 * Validate execution evidence against data contracts.
 * All checks are deterministic — no LLM calls, no external services.
 */
// ─── Control Total Checks ────────────────────────────────────────────────────

function checkControlTotals(
  evidence: ExecutionEvidence,
  controlTotals: ControlTotal[],
): DataContractCheck[] {
  const checks: DataContractCheck[] = [];

  for (const ct of controlTotals) {
    const values = evidence.rows.map((r) => r[ct.column]).filter((v) => typeof v === 'number') as number[];
    const actualTotal = values.reduce((a, b) => a + b, 0);
    const variance = Math.abs(actualTotal - ct.expectedTotal);
    const pass = variance <= ct.tolerance;

    checks.push({
      check: `control_total:${ct.column}`,
      passed: pass,
      detail: pass
        ? `Control total "${ct.description}": ${actualTotal.toFixed(2)} within tolerance ${ct.tolerance} of expected ${ct.expectedTotal}`
        : `Control total BREACH "${ct.description}": actual=${actualTotal.toFixed(2)}, expected=${ct.expectedTotal}, variance=${variance.toFixed(2)} exceeds tolerance ${ct.tolerance}`,
      severity: 'hard',
    });
  }

  return checks;
}

// ─── Main Contract Validation ────────────────────────────────────────────────

/**
 * Validate execution evidence against data contracts.
 * All checks are deterministic — no LLM calls, no external services.
 */
export function validateDataContracts(
  evidence: ExecutionEvidence,
  expectedColumns: DataContractColumn[],
  constraints: BusinessConstraint[],
  controlTotals?: ControlTotal[],
): DataContractResult {
  const allChecks: DataContractCheck[] = [
    ...checkSchemaMatch(evidence, expectedColumns),
    ...checkNullability(evidence, expectedColumns),
    ...checkBusinessConstraints(evidence, constraints),
    ...checkControlTotals(evidence, controlTotals ?? []),
  ];

  const failedChecks = allChecks.filter((c) => !c.passed);
  const hardFailures = failedChecks.filter((c) => c.severity === 'hard');

  return {
    result: hardFailures.length > 0 ? 'fail' : failedChecks.length > 0 ? 'warn' : 'pass',
    checks: allChecks,
    totalChecks: allChecks.length,
    failedChecks: failedChecks.length,
  };
}
