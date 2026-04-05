/**
 * Filing Readiness v1 — Structured readiness assessment.
 *
 * Evaluates whether a financial run is:
 * - review_ready: all evidence present, no blocking gaps
 * - internal_report_ready: all evidence + approval + no hard stops
 * - filing_not_ready: evidence present but gaps remain
 * - blocked: hard stops or missing critical evidence
 */

import type { FinancialRunReport, FilingReadiness, ReadinessGap, ReadinessStatus } from './types.js';

export function assessFilingReadiness(report: FinancialRunReport): FilingReadiness {
  const gaps: ReadinessGap[] = [];

  // Missing approval when required
  if (report.reviewPolicy.required && !report.reviewPolicy.approved) {
    gaps.push({
      category: 'approval',
      description: report.reviewPolicy.rejected
        ? 'Review was rejected — cannot proceed without new review'
        : 'Human approval required but not yet completed',
      blocking: true,
    });
  }

  // Hard reconciliation stops
  if (report.breakReport.hardStops > 0) {
    gaps.push({
      category: 'reconciliation',
      description: `${report.breakReport.hardStops} reconciliation hard stop(s) — control totals or exact balances failed`,
      blocking: true,
    });
  }

  // Explanation-required breaks without resolution
  const explanationBreaks = report.breakReport.breaks.filter((b) => b.handling === 'explanation_required');
  if (explanationBreaks.length > 0) {
    gaps.push({
      category: 'reconciliation',
      description: `${explanationBreaks.length} break(s) require explanation before acceptance`,
      blocking: true,
    });
  }

  // Provenance incomplete
  if (report.reportValidation && !report.lineage.provenanceComplete) {
    gaps.push({
      category: 'provenance',
      description: 'Provenance incomplete — not all reported metrics are traceable to execution evidence',
      blocking: false,
    });
  }

  // Report validation failure
  if (report.reportValidation?.result === 'fail') {
    gaps.push({
      category: 'report_structure',
      description: `Report structural validation failed (${report.reportValidation.failedChecks} checks)`,
      blocking: true,
    });
  }

  // SQL governance or policy failure
  if (report.sqlGovernance.result === 'fail') {
    gaps.push({ category: 'sql_governance', description: 'SQL governance failed', blocking: true });
  }
  if (report.policyResult.result === 'fail') {
    gaps.push({ category: 'policy', description: 'Policy entitlement denied', blocking: true });
  }

  // Guardrail failure
  if (report.guardrailResult.result === 'fail') {
    gaps.push({ category: 'guardrails', description: 'Execution guardrails failed', blocking: true });
  }

  // Audit integrity
  if (!report.audit.chainIntact) {
    gaps.push({ category: 'audit', description: 'Audit trail hash chain is broken', blocking: true });
  }

  // Missing metadata
  if (report.reportValidation) {
    const metaChecks = report.reportValidation.checks.filter((c) => c.check.startsWith('metadata:') && !c.passed);
    if (metaChecks.length > 0) {
      gaps.push({
        category: 'metadata',
        description: `Missing report metadata: ${metaChecks.map((c) => c.check.replace('metadata:', '')).join(', ')}`,
        blocking: false,
      });
    }
  }

  const blockingGaps = gaps.filter((g) => g.blocking).length;
  const totalGaps = gaps.length;

  let status: ReadinessStatus;
  if (blockingGaps > 0) {
    status = report.decision === 'block' ? 'blocked' : 'filing_not_ready';
  } else if (totalGaps > 0) {
    status = 'review_ready';
  } else {
    status = report.reviewPolicy.required && report.reviewPolicy.approved
      ? 'internal_report_ready'
      : 'review_ready';
  }

  return { status, gaps, totalGaps, blockingGaps };
}
