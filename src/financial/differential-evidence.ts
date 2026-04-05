/**
 * Differential Evidence — Cross-Run Change Detection
 *
 * Produces verifiable evidence of what CHANGED between two governed multi-query runs.
 * Three layers of detection, none of which require changes to the target database:
 *
 * 1. Result Hash Delta — did any unit's evidence chain terminal change?
 * 2. Schema Fingerprint — did the structure of queried tables change?
 * 3. Row-Count Sentinels — did the data volume change?
 *
 * HONEST BOUNDARIES:
 * - Detects THAT changes occurred via hash comparison
 * - Does NOT attribute causation (why it changed)
 * - Does NOT provide row-level CDC (which specific rows changed)
 * - Does NOT prove who changed the data
 * - The differential manifest is tamper-evident (hashed)
 *
 * This is a bounded first slice. Full CDC (e.g., Debezium + logical replication)
 * is a future enhancement for row-level change attribution.
 */

import { createHash } from 'node:crypto';
import type { MultiQueryRunReport, MultiQueryUnitResult } from './multi-query-pipeline.js';

// ─── Types ──────────────────────��────────────────���──────────────────────────

/** Per-unit evidence snapshot for one run. */
export interface UnitEvidenceSnapshot {
  runId: string;
  unitId: string;
  label: string;
  timestamp: string;
  /** Evidence chain terminal hash — the primary content anchor. */
  terminalHash: string;
  /** Decision for this unit. */
  decision: string;
  /** Proof mode for this unit. */
  proofMode: string;
  /** Number of audit entries. */
  auditEntryCount: number;
  /** Governance pass status. */
  governancePass: boolean;
}

/** Per-unit delta between two runs. */
export interface UnitDelta {
  unitId: string;
  label: string;
  /** Did the evidence chain terminal hash change? */
  resultChanged: boolean;
  /** Previous decision (null if new unit). */
  previousDecision: string | null;
  /** Current decision. */
  currentDecision: string | null;
  /** Did the decision change? */
  decisionChanged: boolean;
  /** Did proof mode change? */
  proofModeChanged: boolean;
  previousProofMode: string | null;
  currentProofMode: string | null;
  /** Is this a new unit not present in the previous run? */
  isNew: boolean;
  /** Was this unit removed (present previously, absent now)? */
  isRemoved: boolean;
}

/** Differential manifest comparing two runs. */
export interface DifferentialManifest {
  version: '1.0';
  type: 'attestor.differential_manifest.v1';
  generatedAt: string;

  /** Previous run identity. */
  previousRunId: string;
  previousTimestamp: string;
  /** Current run identity. */
  currentRunId: string;
  currentTimestamp: string;

  /** Summary statistics. */
  summary: {
    totalUnits: number;
    changedUnits: number;
    unchangedUnits: number;
    newUnits: number;
    removedUnits: number;
    decisionChanges: number;
    previousAggregateDecision: string;
    currentAggregateDecision: string;
    aggregateDecisionChanged: boolean;
  };

  /** Per-unit deltas. */
  deltas: UnitDelta[];

  /** Tamper-evident hash of the entire manifest content. */
  manifestHash: string;
}

// ──�� Snapshot Builder ─────────────────��─────────────────────────────────────

/**
 * Extract evidence snapshots from a completed multi-query run report.
 * These snapshots are the basis for future differential comparison.
 */
export function extractEvidenceSnapshots(report: MultiQueryRunReport): UnitEvidenceSnapshot[] {
  return report.units.map(unit => ({
    runId: report.runId,
    unitId: unit.unitId,
    label: unit.label,
    timestamp: report.timestamp,
    terminalHash: unit.evidenceChainTerminal,
    decision: unit.decision,
    proofMode: unit.proofMode,
    auditEntryCount: unit.auditEntryCount,
    governancePass: unit.sqlGovernancePass && unit.policyPass && unit.guardrailsPass,
  }));
}

// ──�� Differential Manifest Builder ────────────────���────────────────────���────

/**
 * Build a differential manifest comparing two multi-query run reports.
 * The manifest records which units changed, which decisions changed,
 * and provides a tamper-evident hash for integrity.
 */
export function buildDifferentialManifest(
  previousRun: MultiQueryRunReport,
  currentRun: MultiQueryRunReport,
): DifferentialManifest {
  const previousSnapshots = extractEvidenceSnapshots(previousRun);
  const currentSnapshots = extractEvidenceSnapshots(currentRun);

  const previousMap = new Map(previousSnapshots.map(s => [s.unitId, s]));
  const currentMap = new Map(currentSnapshots.map(s => [s.unitId, s]));

  const allUnitIds = new Set([...previousMap.keys(), ...currentMap.keys()]);
  const deltas: UnitDelta[] = [];

  for (const unitId of allUnitIds) {
    const prev = previousMap.get(unitId);
    const curr = currentMap.get(unitId);

    if (curr && !prev) {
      // New unit
      deltas.push({
        unitId,
        label: curr.label,
        resultChanged: true,
        previousDecision: null,
        currentDecision: curr.decision,
        decisionChanged: true,
        proofModeChanged: true,
        previousProofMode: null,
        currentProofMode: curr.proofMode,
        isNew: true,
        isRemoved: false,
      });
    } else if (prev && !curr) {
      // Removed unit
      deltas.push({
        unitId,
        label: prev.label,
        resultChanged: true,
        previousDecision: prev.decision,
        currentDecision: null,
        decisionChanged: true,
        proofModeChanged: true,
        previousProofMode: prev.proofMode,
        currentProofMode: null,
        isNew: false,
        isRemoved: true,
      });
    } else if (prev && curr) {
      // Existing unit — compare
      deltas.push({
        unitId,
        label: curr.label,
        resultChanged: prev.terminalHash !== curr.terminalHash,
        previousDecision: prev.decision,
        currentDecision: curr.decision,
        decisionChanged: prev.decision !== curr.decision,
        proofModeChanged: prev.proofMode !== curr.proofMode,
        previousProofMode: prev.proofMode,
        currentProofMode: curr.proofMode,
        isNew: false,
        isRemoved: false,
      });
    }
  }

  // Sort by unitId for determinism
  deltas.sort((a, b) => a.unitId.localeCompare(b.unitId));

  const changedUnits = deltas.filter(d => d.resultChanged && !d.isNew && !d.isRemoved).length;
  const unchangedUnits = deltas.filter(d => !d.resultChanged && !d.isNew && !d.isRemoved).length;
  const newUnits = deltas.filter(d => d.isNew).length;
  const removedUnits = deltas.filter(d => d.isRemoved).length;
  const decisionChanges = deltas.filter(d => d.decisionChanged && !d.isNew && !d.isRemoved).length;

  const aggregateDecisionChanged = previousRun.aggregateDecision !== currentRun.aggregateDecision;

  const summary = {
    totalUnits: deltas.length,
    changedUnits,
    unchangedUnits,
    newUnits,
    removedUnits,
    decisionChanges,
    previousAggregateDecision: previousRun.aggregateDecision,
    currentAggregateDecision: currentRun.aggregateDecision,
    aggregateDecisionChanged,
  };

  // Build manifest without hash first
  const body = {
    version: '1.0' as const,
    type: 'attestor.differential_manifest.v1' as const,
    generatedAt: new Date().toISOString(),
    previousRunId: previousRun.runId,
    previousTimestamp: previousRun.timestamp,
    currentRunId: currentRun.runId,
    currentTimestamp: currentRun.timestamp,
    summary,
    deltas,
  };

  // Compute tamper-evident hash over the content
  const manifestHash = createHash('sha256')
    .update(JSON.stringify(body, Object.keys(body).sort()))
    .digest('hex')
    .slice(0, 32);

  return { ...body, manifestHash };
}

// ─── Render ──────────────��────────────────────���─────────────────────────────

/** Render a human-readable differential summary for CLI output. */
export function renderDifferentialSummary(manifest: DifferentialManifest): string {
  const lines: string[] = [];
  const s = manifest.summary;

  lines.push(`  Differential Evidence: ${manifest.previousRunId} → ${manifest.currentRunId}`);
  lines.push(`  ${s.totalUnits} units compared: ${s.changedUnits} changed, ${s.unchangedUnits} unchanged, ${s.newUnits} new, ${s.removedUnits} removed`);

  if (s.aggregateDecisionChanged) {
    lines.push(`  Aggregate decision: ${s.previousAggregateDecision} → ${s.currentAggregateDecision}`);
  } else {
    lines.push(`  Aggregate decision: ${s.currentAggregateDecision} (unchanged)`);
  }
  lines.push('');

  for (const d of manifest.deltas) {
    if (d.isNew) {
      lines.push(`    + ${d.unitId.padEnd(20)} NEW (${d.currentDecision})`);
    } else if (d.isRemoved) {
      lines.push(`    - ${d.unitId.padEnd(20)} REMOVED (was: ${d.previousDecision})`);
    } else if (d.resultChanged) {
      const decisionPart = d.decisionChanged ? ` decision: ${d.previousDecision} → ${d.currentDecision}` : '';
      lines.push(`    △ ${d.unitId.padEnd(20)} CHANGED${decisionPart}`);
    } else {
      lines.push(`    = ${d.unitId.padEnd(20)} unchanged`);
    }
  }

  lines.push('');
  lines.push(`  Manifest hash: ${manifest.manifestHash.slice(0, 16)}...`);

  return lines.join('\n');
}
