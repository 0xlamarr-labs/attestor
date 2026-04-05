/**
 * Reporting Pack v1 — Full evidence package for bank-grade review.
 *
 * Includes: policy, guardrails, snapshot, break operations, filing readiness,
 * in addition to the original governance evidence sections.
 */

import type { FinancialRunReport, OutputPack, RegulatoryAlignmentNote } from './types.js';
import { warrantSummary } from './warrant.js';
import { receiptSummary } from './receipt.js';
import { escrowSummary } from './escrow.js';
import { capsuleSummary } from './capsule.js';

export function buildOutputPack(report: FinancialRunReport): OutputPack {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    runId: report.runId,
    decision: report.decision,

    summary: {
      queryType: report.queryIntent.queryType,
      description: report.queryIntent.description,
      materialityTier: report.queryIntent.materialityTier ?? 'medium',
      decision: report.decision,
      scorersRun: report.scoring.scorersRun,
      totalAuditEntries: report.audit.entries.length,
    },

    sqlGovernance: {
      result: report.sqlGovernance.result,
      gatesPassed: report.sqlGovernance.gates.filter((g) => g.passed).length,
      gatesTotal: report.sqlGovernance.gates.length,
      failedGates: report.sqlGovernance.gates.filter((g) => !g.passed).map((g) => g.gate),
      referencedTables: report.sqlGovernance.referencedTables.map((r) => r.reference),
      sqlHash: report.sqlGovernance.sqlHash,
    },

    execution: report.execution ? {
      success: report.execution.success,
      rowCount: report.execution.rowCount,
      columns: report.execution.columns,
      schemaHash: report.execution.schemaHash,
      error: report.execution.error,
    } : null,

    dataContracts: report.dataContract ? {
      result: report.dataContract.result,
      totalChecks: report.dataContract.totalChecks,
      failedChecks: report.dataContract.failedChecks,
      controlTotalChecks: report.dataContract.checks.filter((c) => c.check.startsWith('control_total')).length,
      failures: report.dataContract.checks.filter((c) => !c.passed).map((c) => c.detail),
    } : null,

    reportProvenance: report.reportValidation ? {
      totalRecords: report.reportValidation.provenance.length,
      allMatch: report.reportValidation.provenance.every((p) => p.matches),
      records: report.reportValidation.provenance,
    } : null,

    lineage: {
      inputCount: report.lineage.inputs.length,
      outputCount: report.lineage.outputs.length,
      metricMappings: report.lineage.metricMappings.length,
      provenanceComplete: report.lineage.provenanceComplete,
    },

    policy: report.policyResult ? {
      result: report.policyResult.result,
      leastPrivilegePreserved: report.policyResult.leastPrivilegePreserved,
      deniedReferences: report.policyResult.decisions.filter((d) => d.verdict === 'denied').map((d) => d.reference),
      restrictedReferences: report.policyResult.decisions.filter((d) => d.verdict === 'restricted').map((d) => d.reference),
    } : null,

    guardrails: report.guardrailResult ? {
      result: report.guardrailResult.result,
      executionClass: report.guardrailResult.executionClass,
      failedChecks: report.guardrailResult.checks.filter((c) => !c.passed).map((c) => c.check),
    } : null,

    snapshot: {
      snapshotId: report.snapshot.snapshotId,
      snapshotHash: report.snapshot.snapshotHash,
      version: report.snapshot.version,
      fixtureCount: report.snapshot.fixtureCount,
      sourceKind: report.snapshot.sourceKind ?? 'fixture',
      sourceCount: report.snapshot.sourceCount ?? report.snapshot.fixtureCount,
    },

    breakOps: {
      hasBreaks: report.breakReport.hasBreaks,
      totalBreaks: report.breakReport.totalBreaks,
      hardStops: report.breakReport.hardStops,
      reviewableVariances: report.breakReport.reviewableVariances,
      informational: report.breakReport.informational,
      breaks: report.breakReport.breaks.map((b) => ({
        check: b.check, reconClass: b.reconClass, handling: b.handling,
        expected: b.expected, actual: b.actual, variance: b.variance, column: b.column,
      })),
    },

    reviewPolicy: {
      required: report.reviewPolicy.required,
      approved: report.reviewPolicy.approved,
      rejected: report.reviewPolicy.rejected,
      triggeredBy: report.reviewPolicy.triggeredBy,
      reason: report.reviewPolicy.reason,
    },

    oversight: {
      required: report.oversight.required,
      status: report.oversight.status,
      reviewerRole: report.oversight.reviewerRole ?? null,
      reviewNote: report.oversight.reviewNote ?? null,
      reviewerIdentity: report.oversight.reviewerIdentity ?? null,
    },

    auditIntegrity: {
      chainIntact: report.audit.chainIntact,
      totalEntries: report.audit.entries.length,
    },

    warrant: warrantSummary(report.warrant),
    escrow: escrowSummary(report.escrow),
    receipt: report.receipt ? receiptSummary(report.receipt) : null,
    capsule: report.capsule ? capsuleSummary(report.capsule) : null,
    liveProof: report.liveProof ? {
      mode: report.liveProof.mode,
      upstreamLive: report.liveProof.upstream.live,
      executionLive: report.liveProof.execution.live,
      gaps: report.liveProof.gaps.length,
      gapCategories: report.liveProof.gaps.map((gap) => gap.category),
      consistent: report.liveProof.consistent,
      readiness: report.liveReadiness?.exerciseType ?? null,
      availableModes: report.liveReadiness?.availableModes ?? null,
    } : null,
    // Predictive guardrails (Postgres pre-execution risk preflight)
    predictiveGuardrail: report.predictiveGuardrail ? {
      performed: report.predictiveGuardrail.performed,
      riskLevel: report.predictiveGuardrail.riskLevel,
      recommendation: report.predictiveGuardrail.recommendation,
      signalCount: report.predictiveGuardrail.signals.length,
      signals: report.predictiveGuardrail.signals.map((s) => ({ signal: s.signal, severity: s.severity, detail: s.detail })),
    } : null,

    // Semantic clauses (analytical obligation checks)
    semanticClauses: report.semanticClauses ? {
      performed: report.semanticClauses.performed,
      clauseCount: report.semanticClauses.clauseCount,
      passCount: report.semanticClauses.passCount,
      failCount: report.semanticClauses.failCount,
      hardFailCount: report.semanticClauses.hardFailCount,
      failedClauses: report.semanticClauses.evaluations
        .filter((e) => !e.passed)
        .map((e) => ({ id: e.clause.id, type: e.clause.type, severity: e.clause.severity, explanation: e.explanation })),
    } : null,

    filingReadiness: report.filingReadiness,

    regulatoryAlignment: [
      { framework: 'SR 11-7', principle: 'Independent validation and model documentation', relevance: 'SQL governance, policy engine, scoring cascade, and audit trail provide independent validation. Lineage and provenance support documentation.' },
      { framework: 'EU AI Act (Article 12)', principle: 'Automatic logging for high-risk AI systems', relevance: 'Tamper-evident audit trail with hash-chained entries. Human oversight semantics support Article 14.' },
      { framework: 'DORA', principle: 'Operational resilience and ICT risk management', relevance: 'Deterministic governance gates, execution guardrails, snapshot semantics, and audit trail support operational control.' },
      { framework: 'BCBS 239', principle: 'Accuracy, completeness, and timeliness of risk data', relevance: 'Data contracts, control totals, reconciliation authority, break operations, timeliness proof, and lineage enforce BCBS 239 principles.' },
    ],
  };
}

export function renderPackSummary(pack: OutputPack): string {
  const lines: string[] = [];
  lines.push(`# Financial Governance Reporting Pack`);
  lines.push(`**Run:** ${pack.runId} | **Decision:** ${pack.decision.toUpperCase()} | **Readiness:** ${pack.filingReadiness.status}`);
  lines.push('');

  lines.push(`## Summary`);
  lines.push(`- **Query:** ${pack.summary.queryType} — ${pack.summary.description}`);
  lines.push(`- **Materiality:** ${pack.summary.materialityTier} | **Scorers:** ${pack.summary.scorersRun} | **Audit:** ${pack.summary.totalAuditEntries} entries`);
  lines.push('');

  lines.push(`## Pre-Execution Gates`);
  lines.push(`- **SQL Governance:** ${pack.sqlGovernance.result} (${pack.sqlGovernance.gatesPassed}/${pack.sqlGovernance.gatesTotal})`);
  if (pack.policy) lines.push(`- **Policy:** ${pack.policy.result} | Least-privilege: ${pack.policy.leastPrivilegePreserved}${pack.policy.deniedReferences.length ? ' | Denied: ' + pack.policy.deniedReferences.join(', ') : ''}`);
  if (pack.guardrails) lines.push(`- **Guardrails:** ${pack.guardrails.result} (${pack.guardrails.executionClass})${pack.guardrails.failedChecks.length ? ' | Failed: ' + pack.guardrails.failedChecks.join(', ') : ''}`);
  lines.push(`- **Snapshot:** ${pack.snapshot.snapshotHash} (${pack.snapshot.version}, ${pack.snapshot.sourceCount ?? pack.snapshot.fixtureCount} ${pack.snapshot.sourceKind ?? 'fixture'} source${(pack.snapshot.sourceCount ?? pack.snapshot.fixtureCount) === 1 ? '' : 's'})`);
  lines.push('');

  if (pack.execution) {
    lines.push(`## Execution`);
    lines.push(`- **Success:** ${pack.execution.success} | **Rows:** ${pack.execution.rowCount} | **Schema:** ${pack.execution.schemaHash}`);
    lines.push('');
  }

  if (pack.breakOps.hasBreaks) {
    lines.push(`## Break Operations`);
    lines.push(`- **Total:** ${pack.breakOps.totalBreaks} | **Hard stops:** ${pack.breakOps.hardStops} | **Reviewable:** ${pack.breakOps.reviewableVariances} | **Info:** ${pack.breakOps.informational}`);
    for (const b of pack.breakOps.breaks) {
      lines.push(`  - [${b.handling}] ${b.check}: expected=${b.expected}, actual=${b.actual}, variance=${b.variance} (${b.reconClass})`);
    }
    lines.push('');
  }

  if (pack.predictiveGuardrail?.performed) {
    lines.push(`## Predictive Guardrails`);
    lines.push(`- **Risk Level:** ${pack.predictiveGuardrail.riskLevel} | **Recommendation:** ${pack.predictiveGuardrail.recommendation} | **Signals:** ${pack.predictiveGuardrail.signalCount}`);
    for (const s of pack.predictiveGuardrail.signals) {
      lines.push(`  - [${s.severity}] ${s.signal}: ${s.detail}`);
    }
    lines.push('');
  }

  if (pack.semanticClauses?.performed) {
    lines.push(`## Semantic Clauses`);
    lines.push(`- **Clauses:** ${pack.semanticClauses.clauseCount} | **Pass:** ${pack.semanticClauses.passCount} | **Fail:** ${pack.semanticClauses.failCount} | **Hard Fail:** ${pack.semanticClauses.hardFailCount}`);
    for (const c of pack.semanticClauses.failedClauses) {
      lines.push(`  - [${c.severity}/${c.type}] ${c.id}: ${c.explanation}`);
    }
    lines.push('');
  }

  lines.push(`## Review & Oversight`);
  lines.push(`- **Review:** ${pack.reviewPolicy.required ? 'required' : 'not required'}${pack.reviewPolicy.triggeredBy.length ? ' (' + pack.reviewPolicy.triggeredBy.join(', ') + ')' : ''}`);
  lines.push(`- **Oversight:** ${pack.oversight.status}${pack.oversight.reviewerRole ? ' by ' + pack.oversight.reviewerRole : ''}`);
  lines.push('');

  lines.push(`## Filing Readiness`);
  lines.push(`- **Status:** ${pack.filingReadiness.status} | **Gaps:** ${pack.filingReadiness.totalGaps} (${pack.filingReadiness.blockingGaps} blocking)`);
  for (const g of pack.filingReadiness.gaps) {
    lines.push(`  - [${g.blocking ? 'BLOCKING' : 'info'}] ${g.category}: ${g.description}`);
  }
  lines.push('');

  lines.push(`## Audit: chain ${pack.auditIntegrity.chainIntact ? 'intact' : 'BROKEN'} (${pack.auditIntegrity.totalEntries} entries)`);
  lines.push('');

  lines.push(`## Regulatory Alignment (informational)`);
  for (const n of pack.regulatoryAlignment) lines.push(`- **${n.framework}**: ${n.relevance}`);

  return lines.join('\n');
}
