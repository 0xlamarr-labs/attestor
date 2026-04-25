/**
 * Break Operations Pack v1 — Reconciliation-aware break reporting.
 *
 * Promotes reconciliation from a generic validator to an operational authority.
 * Each break carries reconciliation class, handling semantics, and severity.
 *
 * Break handling:
 * - hard_stop: blocks the run, no override possible
 * - reviewable_variance: within business tolerance, proceeds with review
 * - informational: noted but non-blocking
 * - explanation_required: must be explained before acceptance
 * - approval_required: requires explicit human approval
 */

import type {
  DataContractResult,
  BreakReport,
  ReconciliationBreak,
  ReviewPolicyResult,
  ReconciliationClass,
  BreakHandling,
} from './types.js';

/**
 * Determine break handling based on reconciliation class and severity.
 */
function determineHandling(
  reconClass: ReconciliationClass,
  severity: 'hard' | 'soft',
  isWithinTolerance: boolean,
): BreakHandling {
  if (severity === 'hard') {
    if (reconClass === 'exact_balance') return 'hard_stop';
    if (reconClass === 'tolerance_balance' && !isWithinTolerance) return 'hard_stop';
    if (reconClass === 'tolerance_balance' && isWithinTolerance) return 'reviewable_variance';
    if (reconClass === 'control_total_only') return 'hard_stop';
    if (reconClass === 'variance_explanation_required') return 'explanation_required';
    return 'approval_required';
  }
  // Soft severity
  if (reconClass === 'variance_explanation_required') return 'explanation_required';
  return 'informational';
}

/**
 * Determine reconciliation class for a check based on its name and context.
 */
function classifyCheck(checkName: string, intentClass?: ReconciliationClass): ReconciliationClass {
  if (intentClass) return intentClass;
  if (checkName.startsWith('control_total')) return 'control_total_only';
  if (checkName.startsWith('sum_equals')) return 'exact_balance';
  if (checkName.startsWith('range')) return 'tolerance_balance';
  return 'aggregate_crosscheck';
}

/**
 * Build a reconciliation-aware break operations pack.
 */
export function buildBreakReport(
  dataContract: DataContractResult | null,
  reviewPolicy: ReviewPolicyResult,
  reconClass?: ReconciliationClass,
  snapshotHash?: string | null,
): BreakReport {
  if (!dataContract) {
    return { hasBreaks: false, totalBreaks: 0, breaks: [], reviewRequired: false, hardStops: 0, reviewableVariances: 0, informational: 0 };
  }

  const breaks: ReconciliationBreak[] = [];

  for (const check of dataContract.checks) {
    if (!check.passed && (
      check.check.startsWith('sum_equals') ||
      check.check.startsWith('control_total') ||
      check.check.startsWith('range') ||
      check.check.startsWith('non_negative')
    )) {
      const sumMatch = check.detail.match(/sum ([\d.-]+).*expected ([\d.-]+)/);
      const ctMatch = check.detail.match(/actual=([\d.-]+), expected=([\d.-]+), variance=([\d.-]+).*tolerance ([\d.-]+)/);
      const colMatch = check.check.match(/:([\w]+)/);

      let expected: string = 'N/A';
      let actual: string = 'N/A';
      let variance: string = 'N/A';
      let tolerance: string = '0';
      let isWithinTolerance = false;

      if (ctMatch) {
        actual = ctMatch[1]; expected = ctMatch[2]; variance = ctMatch[3]; tolerance = ctMatch[4];
        isWithinTolerance = parseFloat(ctMatch[3]) <= parseFloat(ctMatch[4]);
      } else if (sumMatch) {
        actual = sumMatch[1]; expected = sumMatch[2];
        variance = String(Math.abs(parseFloat(sumMatch[1]) - parseFloat(sumMatch[2])).toFixed(2));
      }

      const checkClass = classifyCheck(check.check, reconClass);
      const handling = determineHandling(checkClass, check.severity, isWithinTolerance);

      breaks.push({
        check: check.check,
        description: check.detail,
        expected, actual, variance, tolerance,
        column: colMatch ? colMatch[1] : '*',
        severity: check.severity,
        reconClass: checkClass,
        handling,
        reviewEscalated: reviewPolicy.triggeredBy.some((t) =>
          t.includes('recon') || t.includes('ct_breach') || t.includes('control'),
        ),
        snapshotHash: snapshotHash ?? null,
      });
    }
  }

  const hardStops = breaks.filter((b) => b.handling === 'hard_stop').length;
  const reviewableVariances = breaks.filter((b) => b.handling === 'reviewable_variance' || b.handling === 'approval_required').length;
  const informational = breaks.filter((b) => b.handling === 'informational').length;

  return {
    hasBreaks: breaks.length > 0,
    totalBreaks: breaks.length,
    breaks,
    reviewRequired: reviewPolicy.required && breaks.length > 0,
    hardStops,
    reviewableVariances,
    informational,
  };
}
