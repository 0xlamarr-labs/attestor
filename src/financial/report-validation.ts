/**
 * Report Validation v2 — Structural validation with provenance.
 *
 * Validates that an AI-generated financial report conforms to its contract
 * and adds provenance records linking reported values to execution evidence.
 *
 * Provenance means: for each reported numeric value, the system records
 * the source column, aggregation method, computed value, and match status.
 * This makes every important number traceable, not just "correct."
 *
 * Inspired by Arelle XBRL validation and JSON Schema patterns.
 */

import type {
  ReportContract,
  GeneratedReport,
  ReportValidationResult,
  ReportValidationCheck,
  ExecutionEvidence,
  MetricProvenance,
} from './types.js';

// ─── Section Checks ──────────────────────────────────────────────────────────

function checkRequiredSections(
  report: GeneratedReport,
  contract: ReportContract,
): ReportValidationCheck[] {
  const checks: ReportValidationCheck[] = [];

  for (const section of contract.sections) {
    const found = report.sections.find((s) => s.id === section.id);
    if (!found) {
      if (section.required) {
        checks.push({
          check: `section_present:${section.id}`,
          passed: false,
          detail: `Required section "${section.title}" (${section.id}) missing from report`,
        });
      }
      continue;
    }

    checks.push({
      check: `section_present:${section.id}`,
      passed: true,
      detail: `Section "${section.title}" present`,
    });

    if (found.contentType !== section.contentType) {
      checks.push({
        check: `section_type:${section.id}`,
        passed: false,
        detail: `Section "${section.id}": expected type "${section.contentType}", got "${found.contentType}"`,
      });
    } else {
      checks.push({
        check: `section_type:${section.id}`,
        passed: true,
        detail: `Section "${section.id}": content type "${found.contentType}" matches contract`,
      });
    }

    if (!found.content || found.content.trim().length === 0) {
      checks.push({
        check: `section_content:${section.id}`,
        passed: false,
        detail: `Section "${section.id}" has empty content`,
      });
    } else {
      checks.push({
        check: `section_content:${section.id}`,
        passed: true,
        detail: `Section "${section.id}" has ${found.content.length} chars of content`,
      });
    }
  }

  return checks;
}

// ─── Metadata Checks ─────────────────────────────────────────────────────────

function checkRequiredMetadata(
  report: GeneratedReport,
  requiredMetadata: string[],
): ReportValidationCheck[] {
  const checks: ReportValidationCheck[] = [];

  for (const key of requiredMetadata) {
    const value = report.metadata[key];
    if (!value || value.trim().length === 0) {
      checks.push({
        check: `metadata:${key}`,
        passed: false,
        detail: `Required metadata "${key}" missing or empty`,
      });
    } else {
      checks.push({
        check: `metadata:${key}`,
        passed: true,
        detail: `Metadata "${key}" present: "${value.slice(0, 50)}"`,
      });
    }
  }

  return checks;
}

// ─── Numeric Provenance Checks ───────────────────────────────────────────────

/** Compute an aggregated value from a column in execution evidence. */
function computeAggregation(
  values: number[],
  aggregation: MetricProvenance['aggregation'],
): number | null {
  if (values.length === 0) return null;
  switch (aggregation) {
    case 'sum': return values.reduce((a, b) => a + b, 0);
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min': return Math.min(...values);
    case 'max': return Math.max(...values);
    case 'count': return values.length;
    case 'first': return values[0];
    case 'last': return values[values.length - 1];
    case 'direct': return values[0];
    default: return null;
  }
}

/**
 * Build provenance records and cross-reference checks.
 * Each provenance record links a reported metric to its source data.
 */
function buildProvenanceAndChecks(
  report: GeneratedReport,
  contract: ReportContract,
  executionEvidence: ExecutionEvidence | null,
): { checks: ReportValidationCheck[]; provenance: MetricProvenance[] } {
  const checks: ReportValidationCheck[] = [];
  const provenance: MetricProvenance[] = [];

  if (!executionEvidence || !executionEvidence.success) {
    return { checks, provenance };
  }

  for (const contractSection of contract.sections) {
    if (!contractSection.numericReference) continue;

    const reportSection = report.sections.find((s) => s.id === contractSection.id);
    if (!reportSection || !reportSection.numericValues) continue;

    const refField = contractSection.numericReference;
    const reportedValue = reportSection.numericValues[refField];

    if (reportedValue === undefined) {
      checks.push({
        check: `provenance:${contractSection.id}:${refField}`,
        passed: false,
        detail: `Section "${contractSection.id}" missing numeric reference for "${refField}"`,
      });
      continue;
    }

    // Extract values from execution evidence
    const dataValues = executionEvidence.rows
      .map((r) => r[refField])
      .filter((v) => typeof v === 'number') as number[];

    if (dataValues.length === 0) {
      checks.push({
        check: `provenance:${contractSection.id}:${refField}`,
        passed: false,
        detail: `No numeric data for "${refField}" in execution results`,
      });
      continue;
    }

    // Determine aggregation method
    const aggregation = contractSection.expectedAggregation ?? 'sum';
    const computedValue = computeAggregation(dataValues, aggregation);

    if (computedValue === null) {
      checks.push({
        check: `provenance:${contractSection.id}:${refField}`,
        passed: false,
        detail: `Could not compute ${aggregation} for "${refField}"`,
      });
      continue;
    }

    const matches = Math.abs(computedValue - reportedValue) < 0.01;

    // Record provenance
    provenance.push({
      metric: refField,
      aggregation,
      sourceColumn: refField,
      computedValue,
      reportedValue,
      matches,
    });

    checks.push({
      check: `provenance:${contractSection.id}:${refField}`,
      passed: matches,
      detail: matches
        ? `Provenance verified: ${refField} reported=${reportedValue}, computed=${computedValue.toFixed(2)} via ${aggregation}`
        : `Provenance mismatch: ${refField} reported=${reportedValue}, computed=${computedValue.toFixed(2)} via ${aggregation}`,
    });
  }

  return { checks, provenance };
}

// ─── Report Type Match ───────────────────────────────────────────────────────

function checkReportType(
  report: GeneratedReport,
  contract: ReportContract,
): ReportValidationCheck[] {
  const match = report.reportType === contract.reportType;
  return [{
    check: 'report_type_match',
    passed: match,
    detail: match
      ? `Report type "${report.reportType}" matches contract`
      : `Report type mismatch: expected "${contract.reportType}", got "${report.reportType}"`,
  }];
}

// ─── Main Validation ─────────────────────────────────────────────────────────

/**
 * Validate a generated financial report against its contract.
 * Returns provenance records for every numeric cross-reference.
 */
export function validateReport(
  report: GeneratedReport,
  contract: ReportContract,
  executionEvidence?: ExecutionEvidence | null,
): ReportValidationResult {
  const { checks: provenanceChecks, provenance } = buildProvenanceAndChecks(
    report, contract, executionEvidence ?? null,
  );

  const allChecks: ReportValidationCheck[] = [
    ...checkReportType(report, contract),
    ...checkRequiredSections(report, contract),
    ...checkRequiredMetadata(report, contract.requiredMetadata),
    ...provenanceChecks,
  ];

  const failedChecks = allChecks.filter((c) => !c.passed);

  return {
    result: failedChecks.length > 0 ? 'fail' : 'pass',
    checks: allChecks,
    totalChecks: allChecks.length,
    failedChecks: failedChecks.length,
    provenance,
  };
}
