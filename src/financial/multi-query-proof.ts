/**
 * Multi-Query Proof Artifacts — First Slice
 *
 * Portable, reviewer-facing artifacts for a governed multi-query run.
 * These are the multi-query equivalents of output-pack, dossier, and manifest
 * at the run level, with per-unit summaries preserving full traceability.
 *
 * Design rules:
 * - Per-unit full reports are NOT included (they are internal runtime objects)
 * - Per-unit evidence chain terminals ARE included (portable anchors)
 * - Aggregate decision/proof/governance are truthful projections
 * - No DAG semantics, no differential evidence, no per-unit certificates
 * - Artifacts are portable: they can be serialized, stored, and reviewed
 *   without access to the runtime
 */

import { createHash } from 'node:crypto';
import type { MultiQueryRunReport, MultiQueryUnitResult } from './multi-query-pipeline.js';

// ─── Multi-Query Output Pack ────────────────────────────────────────────────

/**
 * Per-unit summary for the output pack.
 * Contains everything a reviewer needs per unit, but NOT the full report.
 */
export interface MultiQueryUnitSummary {
  unitId: string;
  label: string;
  decision: string;
  proofMode: string;
  evidenceChainTerminal: string;

  governance: {
    sqlPass: boolean;
    policyPass: boolean;
    guardrailsPass: boolean;
  };

  scoring: {
    scorersRun: number;
  };

  warrant: {
    status: string;
  };

  audit: {
    entryCount: number;
    chainIntact: boolean;
  };

  blockers: string[];
}

export interface MultiQueryOutputPack {
  version: '1.0';
  type: 'attestor.multi_query_output_pack.v1';
  generatedAt: string;

  runId: string;
  unitCount: number;

  aggregate: {
    decision: string;
    proofMode: string;
    allUnitsLive: boolean;
    hasProofGaps: boolean;
    allAuditChainsIntact: boolean;
  };

  decisionBreakdown: {
    pass: number;
    fail: number;
    block: number;
    pending_approval: number;
  };

  governanceSufficiency: {
    sufficient: boolean;
    sqlPassCount: number;
    policyPassCount: number;
    guardrailsPassCount: number;
    totalUnits: number;
  };

  units: MultiQueryUnitSummary[];

  blockers: { unitId: string; blocker: string }[];

  evidence: {
    multiQueryHash: string;
    totalAuditEntries: number;
  };
}

// ─── Multi-Query Dossier ────────────────────────────────────────────────────

export interface MultiQueryDossierUnitEntry {
  unitId: string;
  label: string;
  decision: string;
  proofMode: string;
  /** Why this unit's decision is what it is (blockers or pass-through). */
  explanation: string;
  blockerCount: number;
}

export interface MultiQueryDossier {
  version: '1.0';
  type: 'attestor.multi_query_dossier.v1';
  generatedAt: string;

  runId: string;
  unitCount: number;

  /** One-line verdict for the whole run. */
  verdict: string;
  aggregateDecision: string;
  aggregateProofMode: string;

  /** Per-unit entry: decision + explanation. */
  unitEntries: MultiQueryDossierUnitEntry[];

  /** All blockers across all units, with attribution. */
  blockers: { unitId: string; blocker: string }[];

  governanceSummary: string;
  proofSummary: string;
}

// ─── Multi-Query Manifest ───────────────────────────────────────────────────

export interface MultiQueryManifest {
  version: '1.0';
  type: 'attestor.multi_query_manifest.v1';
  generatedAt: string;

  runId: string;
  unitCount: number;
  aggregateDecision: string;
  multiQueryHash: string;

  /** Per-unit evidence anchors — minimal, portable. */
  unitAnchors: {
    unitId: string;
    decision: string;
    evidenceChainTerminal: string;
  }[];

  /** Manifest-level hash: hash of (multiQueryHash + all unit terminals + aggregate decision). */
  manifestHash: string;
}

// ─── Builders ───────────────────────────────────────────────────────────────

function buildUnitSummary(unit: MultiQueryUnitResult): MultiQueryUnitSummary {
  return {
    unitId: unit.unitId,
    label: unit.label,
    decision: unit.decision,
    proofMode: unit.proofMode,
    evidenceChainTerminal: unit.evidenceChainTerminal,
    governance: {
      sqlPass: unit.sqlGovernancePass,
      policyPass: unit.policyPass,
      guardrailsPass: unit.guardrailsPass,
    },
    scoring: {
      scorersRun: unit.scorersRun,
    },
    warrant: {
      status: unit.warrantStatus,
    },
    audit: {
      entryCount: unit.auditEntryCount,
      chainIntact: unit.report.audit.chainIntact,
    },
    blockers: unit.blockers,
  };
}

/**
 * Build a multi-query output pack from a completed run report.
 * This is the machine-readable, reviewer-facing summary of the entire multi-query run.
 */
export function buildMultiQueryOutputPack(report: MultiQueryRunReport): MultiQueryOutputPack {
  return {
    version: '1.0',
    type: 'attestor.multi_query_output_pack.v1',
    generatedAt: new Date().toISOString(),
    runId: report.runId,
    unitCount: report.unitCount,
    aggregate: {
      decision: report.aggregateDecision,
      proofMode: report.aggregateProofMode,
      allUnitsLive: report.allUnitsLive,
      hasProofGaps: report.hasProofGaps,
      allAuditChainsIntact: report.allAuditChainsIntact,
    },
    decisionBreakdown: report.decisionBreakdown,
    governanceSufficiency: report.governanceSufficiency,
    units: report.units.map(buildUnitSummary),
    blockers: report.allBlockers,
    evidence: {
      multiQueryHash: report.multiQueryHash,
      totalAuditEntries: report.totalAuditEntries,
    },
  };
}

function explainUnitDecision(unit: MultiQueryUnitResult): string {
  if (unit.decision === 'pass') {
    return `All governance gates passed. ${unit.scorersRun} scorers ran. Proof: ${unit.proofMode}.`;
  }
  if (unit.decision === 'block') {
    const reasons = unit.blockers.length > 0 ? unit.blockers.join('; ') : 'blocked by governance gate';
    return `Blocked before execution: ${reasons}`;
  }
  if (unit.decision === 'fail') {
    const reasons = unit.blockers.length > 0 ? unit.blockers.join('; ') : 'failed post-execution evidence checks';
    return `Failed: ${reasons}`;
  }
  if (unit.decision === 'pending_approval') {
    return `Pending human approval. Review required before acceptance.`;
  }
  return `Decision: ${unit.decision}`;
}

function deriveVerdict(report: MultiQueryRunReport): string {
  const { aggregateDecision, unitCount, decisionBreakdown } = report;
  if (aggregateDecision === 'pass') {
    return `All ${unitCount} query units passed governance. Aggregate: PASS.`;
  }
  if (aggregateDecision === 'block') {
    return `${decisionBreakdown.block} of ${unitCount} units blocked. Aggregate: BLOCK.`;
  }
  if (aggregateDecision === 'fail') {
    return `${decisionBreakdown.fail} of ${unitCount} units failed. Aggregate: FAIL.`;
  }
  if (aggregateDecision === 'pending_approval') {
    return `${decisionBreakdown.pending_approval} of ${unitCount} units pending approval. Aggregate: PENDING.`;
  }
  return `Aggregate decision: ${aggregateDecision}.`;
}

function deriveGovernanceSummary(report: MultiQueryRunReport): string {
  const g = report.governanceSufficiency;
  if (g.sufficient) {
    return `All ${g.totalUnits} units passed SQL governance, policy, and guardrails.`;
  }
  const failures: string[] = [];
  if (g.sqlPassCount < g.totalUnits) failures.push(`SQL: ${g.sqlPassCount}/${g.totalUnits}`);
  if (g.policyPassCount < g.totalUnits) failures.push(`policy: ${g.policyPassCount}/${g.totalUnits}`);
  if (g.guardrailsPassCount < g.totalUnits) failures.push(`guardrails: ${g.guardrailsPassCount}/${g.totalUnits}`);
  return `Governance insufficient: ${failures.join(', ')}.`;
}

function deriveProofSummary(report: MultiQueryRunReport): string {
  if (report.allUnitsLive) return `All ${report.unitCount} units backed by live execution.`;
  if (report.hasProofGaps) return `Proof mode: ${report.aggregateProofMode}. Some units have proof gaps.`;
  return `Proof mode: ${report.aggregateProofMode}. No gaps detected.`;
}

/**
 * Build a multi-query decision dossier from a completed run report.
 * This is the reviewer-facing explanation packet: what happened, why, and what blocked.
 */
export function buildMultiQueryDossier(report: MultiQueryRunReport): MultiQueryDossier {
  return {
    version: '1.0',
    type: 'attestor.multi_query_dossier.v1',
    generatedAt: new Date().toISOString(),
    runId: report.runId,
    unitCount: report.unitCount,
    verdict: deriveVerdict(report),
    aggregateDecision: report.aggregateDecision,
    aggregateProofMode: report.aggregateProofMode,
    unitEntries: report.units.map(unit => ({
      unitId: unit.unitId,
      label: unit.label,
      decision: unit.decision,
      proofMode: unit.proofMode,
      explanation: explainUnitDecision(unit),
      blockerCount: unit.blockers.length,
    })),
    blockers: report.allBlockers,
    governanceSummary: deriveGovernanceSummary(report),
    proofSummary: deriveProofSummary(report),
  };
}

/**
 * Build a multi-query manifest from a completed run report.
 * This is the minimal portable anchor set: hash chain for replay and verification.
 */
export function buildMultiQueryManifest(report: MultiQueryRunReport): MultiQueryManifest {
  const unitAnchors = report.units.map(u => ({
    unitId: u.unitId,
    decision: u.decision,
    evidenceChainTerminal: u.evidenceChainTerminal,
  }));

  // Manifest hash: binds the aggregate decision to the ordered unit evidence
  const manifestHash = createHash('sha256')
    .update([
      report.multiQueryHash,
      report.aggregateDecision,
      ...unitAnchors.map(a => `${a.unitId}:${a.decision}:${a.evidenceChainTerminal}`),
    ].join('|'))
    .digest('hex')
    .slice(0, 32);

  return {
    version: '1.0',
    type: 'attestor.multi_query_manifest.v1',
    generatedAt: new Date().toISOString(),
    runId: report.runId,
    unitCount: report.unitCount,
    aggregateDecision: report.aggregateDecision,
    multiQueryHash: report.multiQueryHash,
    unitAnchors,
    manifestHash,
  };
}

/**
 * Render a human-readable multi-query summary for CLI output.
 */
export function renderMultiQuerySummary(report: MultiQueryRunReport): string {
  const lines: string[] = [];
  lines.push(`  Multi-Query Run: ${report.runId}`);
  lines.push(`  Units: ${report.unitCount} | Decision: ${report.aggregateDecision.toUpperCase()} | Proof: ${report.aggregateProofMode}`);
  lines.push('');

  lines.push(`  Breakdown: ${report.decisionBreakdown.pass} pass, ${report.decisionBreakdown.fail} fail, ${report.decisionBreakdown.block} block, ${report.decisionBreakdown.pending_approval} pending`);

  const g = report.governanceSufficiency;
  lines.push(`  Governance: ${g.sufficient ? 'sufficient' : 'INSUFFICIENT'} (SQL: ${g.sqlPassCount}/${g.totalUnits}, policy: ${g.policyPassCount}/${g.totalUnits}, guardrails: ${g.guardrailsPassCount}/${g.totalUnits})`);
  lines.push('');

  lines.push(`  Per-unit:`);
  for (const unit of report.units) {
    const status = unit.decision === 'pass' ? '  ✓' : unit.decision === 'block' ? '  ✗' : '  △';
    lines.push(`  ${status} ${unit.unitId.padEnd(20)} ${unit.decision.padEnd(18)} ${unit.proofMode}`);
    if (unit.blockers.length > 0) {
      for (const b of unit.blockers) {
        lines.push(`      ✗ ${b}`);
      }
    }
  }
  lines.push('');

  if (report.allBlockers.length > 0) {
    lines.push(`  Blockers (${report.allBlockers.length}):`);
    for (const b of report.allBlockers) {
      lines.push(`    [${b.unitId}] ${b.blocker}`);
    }
    lines.push('');
  }

  lines.push(`  Evidence: multiQueryHash=${report.multiQueryHash.slice(0, 16)}... | ${report.totalAuditEntries} audit entries | chains ${report.allAuditChainsIntact ? 'intact' : 'BROKEN'}`);

  return lines.join('\n');
}
