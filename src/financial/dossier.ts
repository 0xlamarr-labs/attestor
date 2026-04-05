/**
 * Decision Dossier v2 — Full reviewer packet.
 *
 * Surfaces: filing readiness, break ops, policy, guardrails, snapshot,
 * attestation, interop status alongside decision explainability.
 */

import type { FinancialRunReport, DecisionDossier, FinancialScore, DossierEvent, DossierEvidence, DossierBlocker, DossierReviewPath, DossierSummarySection } from './types.js';
import { warrantSummary } from './warrant.js';
import { receiptSummary } from './receipt.js';
import { escrowSummary } from './escrow.js';
import { capsuleSummary } from './capsule.js';

export function buildDecisionDossier(report: FinancialRunReport): DecisionDossier {
  const timeline: DossierEvent[] = report.audit.entries
    .filter((e) => e.category !== 'lifecycle')
    .map((e) => ({ seq: e.seq, stage: e.stage, outcome: e.action, significance: classifySignificance(e.stage, e.action) }));

  const criticalEvidence: DossierEvidence[] = report.scoring.scores.map((s) => ({
    scorer: s.scorer, value: String(s.value), verdict: s.verdict, significance: classifyScoreSignificance(s),
  }));

  const blockers: DossierBlocker[] = [];
  if (report.sqlGovernance.result === 'fail') {
    for (const g of report.sqlGovernance.gates.filter((g) => !g.passed)) {
      blockers.push({ source: `sql_governance.${g.gate}`, reason: g.detail });
    }
  }
  if (report.execution && !report.execution.success) blockers.push({ source: 'execution', reason: report.execution.error ?? 'Execution failed' });
  if (report.dataContract?.result === 'fail') {
    for (const f of report.dataContract.checks.filter((c) => !c.passed && c.severity === 'hard')) {
      blockers.push({ source: `data_contract.${f.check}`, reason: f.detail });
    }
  }
  if (report.decision === 'rejected') blockers.push({ source: 'review', reason: report.oversight.reviewNote ?? 'Review rejected' });
  if (report.policyResult.result === 'fail') {
    for (const d of report.policyResult.decisions.filter((d) => d.verdict === 'denied')) {
      blockers.push({ source: `policy.${d.reference}`, reason: d.reason });
    }
  }
  if (report.guardrailResult.result === 'fail') {
    for (const c of report.guardrailResult.checks.filter((c) => !c.passed)) {
      blockers.push({ source: `guardrail.${c.check}`, reason: c.detail });
    }
  }
  if (report.warrant.status === 'violated') {
    for (const v of report.warrant.violations) {
      blockers.push({ source: 'warrant', reason: v });
    }
  }

  const reviewPath: DossierReviewPath = {
    required: report.reviewPolicy.required,
    triggers: report.reviewPolicy.triggeredBy,
    outcome: report.reviewPolicy.rejected ? 'rejected' : report.reviewPolicy.approved ? 'approved' : report.reviewPolicy.required ? 'pending' : 'not_required',
    reviewerRole: report.oversight.reviewerRole ?? null,
    reviewNote: report.oversight.reviewNote ?? null,
  };

  const unresolvedRisks: string[] = [];
  for (const s of report.scoring.scores) { if (s.value === 'warn') unresolvedRisks.push(`${s.scorer}: ${s.verdict}`); }
  if (!report.lineage.provenanceComplete) unresolvedRisks.push('Lineage: provenance incomplete');
  if (report.reviewPolicy.required && !report.reviewPolicy.approved && !report.reviewPolicy.rejected) unresolvedRisks.push('Human review required but not completed');

  const artifactHashes: Record<string, string> = { sqlHash: report.sqlGovernance.sqlHash };
  if (report.execution) artifactHashes.schemaHash = report.execution.schemaHash;
  if (report.audit.entries.length > 0) artifactHashes.lastAuditHash = report.audit.entries[report.audit.entries.length - 1].evidenceHash;

  // ── Reviewer Summary Sections ──
  const reviewerSummary: DossierSummarySection[] = [
    { category: 'filing_readiness', status: report.filingReadiness.status, detail: `${report.filingReadiness.totalGaps} gaps (${report.filingReadiness.blockingGaps} blocking)` },
    { category: 'break_operations', status: report.breakReport.hasBreaks ? `${report.breakReport.totalBreaks} breaks` : 'no breaks', detail: `hard_stops=${report.breakReport.hardStops}, reviewable=${report.breakReport.reviewableVariances}, info=${report.breakReport.informational}` },
    { category: 'policy', status: report.policyResult.result, detail: report.policyResult.leastPrivilegePreserved ? 'Least-privilege preserved' : `Denied: ${report.policyResult.decisions.filter((d) => d.verdict === 'denied').map((d) => d.reference).join(', ')}` },
    { category: 'guardrails', status: report.guardrailResult.result, detail: `${report.guardrailResult.executionClass}, ${report.guardrailResult.failedChecks} failed` },
    { category: 'snapshot', status: 'present', detail: `hash=${report.snapshot.snapshotHash}, ${report.snapshot.version}, ${report.snapshot.sourceCount ?? report.snapshot.fixtureCount} ${report.snapshot.sourceKind ?? 'fixture'} source${(report.snapshot.sourceCount ?? report.snapshot.fixtureCount) === 1 ? '' : 's'}` },
    { category: 'warrant', status: report.warrant.status, detail: `trust=${report.warrant.trustLevel}, path=${report.warrant.allowedPath.length} stages, obligations=${report.warrant.evidenceObligations.filter((o) => o.fulfilled).length}/${report.warrant.evidenceObligations.length}, violations=${report.warrant.violations.length}` },
    { category: 'escrow', status: report.escrow.state, detail: `${report.escrow.releasedCount}/${report.escrow.totalObligations} released, review_held=${report.escrow.reviewHeld}, reason=${report.escrow.stateReason.slice(0, 80)}` },
    { category: 'receipt', status: report.receipt?.receiptStatus ?? 'not_issued', detail: report.receipt ? `id=${report.receipt.receiptId}, reason=${report.receipt.issuanceReason}, sig=${report.receipt.signatureMode}` : 'No receipt issued' },
    { category: 'capsule', status: report.capsule?.authorityState ?? 'not_issued', detail: report.capsule ? `id=${report.capsule.capsuleId}, authority=${report.capsule.authorityState}, reason=${report.capsule.authorityReason.slice(0, 60)}` : 'No capsule' },
    { category: 'attestation', status: report.attestation?.signatureMode ?? 'not_emitted', detail: report.attestation ? `verification=${report.attestation.verification.overall}, chain=${report.attestation.verification.chainLinkage ? 'ok' : 'fail'}, artifacts=${report.attestation.verification.canonicalArtifacts ? 'ok' : 'fail'}` : 'No attestation' },
    { category: 'live_proof', status: report.liveProof?.mode ?? 'unknown', detail: `upstream_live=${report.liveProof?.upstream.live ?? false}, execution_live=${report.liveProof?.execution.live ?? false}, consistent=${report.liveProof?.consistent ?? false}, gap_categories=${report.liveProof?.gaps.map((gap) => gap.category).join('|') ?? 'none'}${report.liveReadiness ? `, readiness=${report.liveReadiness.exerciseType}, available_modes=${report.liveReadiness.availableModes.join('+')}` : ''}` },
    { category: 'interop', status: report.openLineageExport ? 'exported' : 'not_exported', detail: report.openLineageExport ? `eventType=${report.openLineageExport.eventType}, inputs=${report.openLineageExport.inputs.length}, outputs=${report.openLineageExport.outputs.length}` : 'No OpenLineage export' },
  ];

  return { runId: report.runId, generatedAt: new Date().toISOString(), decision: report.decision, timeline, criticalEvidence, blockers, reviewPath, unresolvedRisks, artifactHashes, reviewerSummary };
}

function classifySignificance(stage: string, action: string): DossierEvent['significance'] {
  if (action === 'fail' || action === 'failure' || action === 'block' || action === 'rejected') return 'critical';
  if (action === 'escalated' || action === 'pending' || action === 'incomplete') return 'notable';
  return 'routine';
}

function classifyScoreSignificance(score: FinancialScore): DossierEvidence['significance'] {
  if (score.value === false) return 'failed';
  if (score.value === 'warn') return 'warning';
  if (score.value === 'skip') return 'skipped';
  return 'passed';
}
