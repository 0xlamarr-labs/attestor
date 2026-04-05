/**
 * Healthcare Semantic Clause Evaluators
 *
 * Real evaluation logic for the healthcare domain pack clauses.
 * These are the healthcare equivalents of the financial semantic clauses
 * (balance_identity, control_total, ratio_bound, etc.).
 *
 * Each evaluator takes execution result rows and checks a domain-specific
 * analytical obligation.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HealthcareClauseResult {
  clauseId: string;
  passed: boolean;
  severity: 'blocking' | 'warning' | 'info';
  explanation: string;
  evidence: Record<string, unknown>;
}

// ─── Evaluators ─────────────────────────────────────────────────────────────

/**
 * Patient Count Consistency:
 * numerator + excluded must equal denominator.
 * Validates that quality measure populations are correctly derived.
 */
export function evaluatePatientCountConsistency(
  rows: Record<string, unknown>[],
  numeratorCol: string,
  excludedCol: string,
  denominatorCol: string,
): HealthcareClauseResult {
  let totalNumerator = 0;
  let totalExcluded = 0;
  let totalDenominator = 0;

  for (const row of rows) {
    totalNumerator += Number(row[numeratorCol] ?? 0);
    totalExcluded += Number(row[excludedCol] ?? 0);
    totalDenominator += Number(row[denominatorCol] ?? 0);
  }

  const expected = totalNumerator + totalExcluded;
  const passed = expected === totalDenominator;

  return {
    clauseId: 'patient_count_consistency',
    passed,
    severity: 'blocking',
    explanation: passed
      ? `Patient counts consistent: numerator(${totalNumerator}) + excluded(${totalExcluded}) = denominator(${totalDenominator})`
      : `Patient counts INCONSISTENT: numerator(${totalNumerator}) + excluded(${totalExcluded}) = ${expected}, but denominator = ${totalDenominator}`,
    evidence: { totalNumerator, totalExcluded, totalDenominator, expected, consistent: passed },
  };
}

/**
 * Rate Bound:
 * Calculated clinical rate must fall within clinically plausible range.
 */
export function evaluateRateBound(
  rows: Record<string, unknown>[],
  rateCol: string,
  minRate: number,
  maxRate: number,
  rateName: string = 'rate',
): HealthcareClauseResult {
  const rates = rows.map(r => Number(r[rateCol] ?? 0));
  const outOfBound = rates.filter(r => r < minRate || r > maxRate);

  const passed = outOfBound.length === 0;

  return {
    clauseId: 'rate_bound',
    passed,
    severity: 'warning',
    explanation: passed
      ? `All ${rateName} values within plausible range [${minRate}, ${maxRate}]`
      : `${outOfBound.length} ${rateName} values outside plausible range [${minRate}, ${maxRate}]: ${outOfBound.join(', ')}`,
    evidence: { rateName, minRate, maxRate, totalValues: rates.length, outOfBound },
  };
}

/**
 * Small Cell Suppression:
 * No output cell may contain fewer than the minimum patient count.
 * Prevents re-identification of individuals in aggregate data.
 */
export function evaluateSmallCellSuppression(
  rows: Record<string, unknown>[],
  countCol: string,
  minCellSize: number = 11,
): HealthcareClauseResult {
  const violations: { row: number; count: number }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const count = Number(rows[i][countCol] ?? 0);
    if (count > 0 && count < minCellSize) {
      violations.push({ row: i, count });
    }
  }

  const passed = violations.length === 0;

  return {
    clauseId: 'small_cell_suppression',
    passed,
    severity: 'blocking',
    explanation: passed
      ? `All cells meet minimum count threshold (>= ${minCellSize})`
      : `${violations.length} cells below minimum count ${minCellSize}: ${violations.map(v => `row ${v.row}=${v.count}`).join(', ')}`,
    evidence: { minCellSize, violations, totalRows: rows.length },
  };
}

/**
 * PHI Completeness Check:
 * All required fields must be present or properly marked as redacted.
 */
export function evaluatePhiCompleteness(
  rows: Record<string, unknown>[],
  requiredFields: string[],
  redactedMarker: string = '[REDACTED]',
): HealthcareClauseResult {
  const missing: { row: number; field: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    for (const field of requiredFields) {
      const val = rows[i][field];
      if (val === null || val === undefined || val === '') {
        missing.push({ row: i, field });
      }
      // Redacted is acceptable
    }
  }

  const passed = missing.length === 0;

  return {
    clauseId: 'phi_completeness_check',
    passed,
    severity: 'blocking',
    explanation: passed
      ? `All ${requiredFields.length} required fields present across ${rows.length} rows`
      : `${missing.length} missing field values: ${missing.slice(0, 5).map(m => `row ${m.row}.${m.field}`).join(', ')}${missing.length > 5 ? '...' : ''}`,
    evidence: { requiredFields, redactedMarker, missingCount: missing.length, totalRows: rows.length },
  };
}

/**
 * Temporal Consistency:
 * Encounter dates must be logically ordered (admission <= discharge).
 */
export function evaluateTemporalConsistency(
  rows: Record<string, unknown>[],
  startDateCol: string,
  endDateCol: string,
): HealthcareClauseResult {
  const violations: { row: number; start: string; end: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const start = String(rows[i][startDateCol] ?? '');
    const end = String(rows[i][endDateCol] ?? '');
    if (start && end && start > end) {
      violations.push({ row: i, start, end });
    }
  }

  const passed = violations.length === 0;

  return {
    clauseId: 'temporal_consistency',
    passed,
    severity: 'blocking',
    explanation: passed
      ? `All date sequences logically ordered (${startDateCol} <= ${endDateCol})`
      : `${violations.length} temporal inconsistencies: ${violations.slice(0, 3).map(v => `row ${v.row}: ${v.start} > ${v.end}`).join(', ')}`,
    evidence: { startDateCol, endDateCol, violations: violations.length, totalRows: rows.length },
  };
}
