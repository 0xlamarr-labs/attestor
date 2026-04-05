/**
 * Lineage Evidence — structured traceability for financial runs.
 *
 * Builds a lineage record that answers:
 * - What source objects were touched (schemas, tables, query)
 * - What output structure was produced (result set, report)
 * - Which report metrics came from which execution evidence
 * - Which decision was made from that chain
 *
 * Inspired by OpenLineage facets. Implemented as bounded Attestor-native structure.
 */

import { createHash } from 'node:crypto';
import type {
  LineageEvidence,
  LineageArtifact,
  SqlGovernanceResult,
  ExecutionEvidence,
  ReportValidationResult,
  GeneratedReport,
  AuditTrail,
} from './types.js';

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Build lineage evidence from pipeline artifacts.
 */
export function buildLineageEvidence(
  runId: string,
  sqlGovernance: SqlGovernanceResult,
  execution: ExecutionEvidence | null,
  reportValidation: ReportValidationResult | null,
  report: GeneratedReport | null,
  audit: AuditTrail,
): LineageEvidence {
  const inputs: LineageArtifact[] = [];
  const outputs: LineageArtifact[] = [];

  // Input: referenced tables from SQL governance
  for (const ref of sqlGovernance.referencedTables) {
    if (ref.schema) {
      inputs.push({
        type: 'schema',
        name: ref.schema,
        hash: hash(ref.schema),
      });
    }
    inputs.push({
      type: 'table',
      name: ref.reference,
      hash: hash(ref.reference),
      metadata: { context: ref.context },
    });
  }

  // Input: the SQL query itself
  inputs.push({
    type: 'query',
    name: 'candidate_sql',
    hash: sqlGovernance.sqlHash,
  });

  // Output: execution result set
  if (execution?.success) {
    outputs.push({
      type: 'result_set',
      name: `result_${execution.columns.length}cols_${execution.rowCount}rows`,
      hash: execution.schemaHash,
      metadata: { columns: execution.columns, rowCount: execution.rowCount },
    });
  }

  // Output: generated report
  if (report) {
    outputs.push({
      type: 'report',
      name: report.reportType,
      hash: hash(JSON.stringify(report.metadata)),
      metadata: { sections: report.sections.length },
    });
  }

  // Metric mappings from provenance
  const metricMappings = reportValidation?.provenance ?? [];

  // Provenance completeness: every metric section in the report has a provenance record
  const metricSections = report?.sections.filter((s) => s.contentType === 'metric' && s.numericValues) ?? [];
  const provenanceComplete = metricSections.length > 0
    ? metricSections.every((s) => {
        const keys = Object.keys(s.numericValues ?? {});
        return keys.every((k) => metricMappings.some((m) => m.metric === k));
      })
    : metricMappings.length === 0; // no metrics = trivially complete

  // Chain summary: key audit hashes by stage
  const chainSummary = audit.entries
    .filter((e) => e.category !== 'lifecycle')
    .map((e) => ({ stage: e.stage, hash: e.evidenceHash }));

  return {
    runId,
    inputs,
    outputs,
    metricMappings,
    provenanceComplete,
    chainSummary,
  };
}
