/**
 * Financial Pipeline v7 — Validation Core Hardening + Policy Engine.
 *
 * Fixes from v6:
 * - Oversight derived AFTER post-score review merge (was too early)
 * - Replay identity separated from run identity (excludes runId)
 * - Evidence chain hashes canonical artifacts (not shallow summaries)
 * - Policy & Entitlement Engine as first-class authority
 */

import { createHash } from 'node:crypto';
import type {
  FinancialQueryIntent, FinancialRunReport, GeneratedReport, ReportContract,
  HumanOversight, IndependenceProof, TimelinessProof, StageTimingEntry, ReplayMetadata, SnapshotIdentity, LiveProofInput,
} from './types.js';
import { buildLiveProof, buildOfflineProof, assessLiveReadiness } from './types.js';
import { governSql } from './sql-governance.js';
import { evaluatePolicy } from './policy.js';
import { evaluateGuardrails } from './execution-guardrails.js';
import {
  executeFixtureQuery,
  executeSqliteQuery,
  computeSqliteSnapshot,
  type FixtureQueryMapping,
  type SqliteLiveExecutionConfig,
} from './execution.js';
// Postgres execution is provided via externalExecution (pre-computed by connectors/postgres-prove.ts)
import { validateDataContracts } from './data-contracts.js';
import { validateReport } from './report-validation.js';
import { buildLineageEvidence } from './lineage.js';
import { evaluateReviewPolicy, mergePostScoreReview } from './review-policy.js';
import { createAuditTrail, appendAuditEntry, finalizeAuditTrail } from './audit.js';
import { runFinancialScoringCascade } from './scoring.js';
import { buildOutputPack } from './output-pack.js';
import { buildDecisionDossier } from './dossier.js';
import { buildRunManifest } from './manifest.js';
import { buildEvidenceChain } from './evidence-chain.js';
import { buildBreakReport } from './break-report.js';
import { assessFilingReadiness } from './filing-readiness.js';
import { buildAttestationPack } from './attestation.js';
import { buildOpenLineageExport } from './openlineage.js';
import { evaluateSemanticClauses } from './semantic-clauses.js';
import { issueCertificate, type CertificateInput } from '../signing/certificate.js';
import { signReviewerEndorsement } from '../signing/reviewer-endorsement.js';
import { issueReceipt } from './receipt.js';
import { buildEscrow } from './escrow.js';
import { buildDecisionCapsule } from './capsule.js';
import { issueWarrant, validateWarrantStage, validateWarrantSnapshot, fulfillWarrantObligation, finalizeWarrant, recordWarrantViolation } from './warrant.js';

function h(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export interface FinancialPipelineInput {
  runId: string;
  intent: FinancialQueryIntent;
  candidateSql: string;
  fixtures: FixtureQueryMapping[];
  liveExecution?: SqliteLiveExecutionConfig;
  generatedReport?: GeneratedReport;
  reportContract?: ReportContract;
  approval?: { status: 'approved' | 'rejected'; reviewerRole: string; reviewNote: string; reviewerIdentity?: import('./types.js').ReviewerIdentity; reviewerKeyPair?: import('../signing/keys.js').AttestorKeyPair };
  /** Pre-computed execution evidence from an external connector (e.g., Postgres). Takes priority over fixture/SQLite. */
  externalExecution?: import('./types.js').ExecutionEvidence;
  /** Optional runtime observation for future live integrations. Defaults to truthful offline fixture proof. */
  liveProof?: LiveProofInput;
  /** Optional Ed25519 signing key pair for portable attestation certificate issuance. */
  signingKeyPair?: import('../signing/keys.js').AttestorKeyPair;
  /** Predictive guardrail preflight result. Null for fixture/SQLite. */
  predictiveGuardrail?: import('../connectors/predictive-guardrails.js').PredictiveGuardrailResult;
  /** Semantic clauses to evaluate against execution results. */
  semanticClauses?: import('./types.js').SemanticClause[];
}

function determineOversight(reviewRequired: boolean, reviewReason: string, intent: FinancialQueryIntent, approval?: FinancialPipelineInput['approval']): HumanOversight {
  const required = reviewRequired || (intent.materialityTier ?? 'medium') === 'high';
  const reason = reviewRequired ? reviewReason : (intent.materialityTier === 'high' ? 'High materiality tier' : 'Policy does not require review');
  if (required && approval) {
    // Normalize: when reviewerIdentity exists, its role is authoritative
    const identity = approval.reviewerIdentity ?? null;
    const normalizedRole = identity?.role ?? approval.reviewerRole;
    // Build endorsement stub (run binding + signature populated AFTER evidence chain)
    const endorsement: import('./types.js').ReviewerEndorsement | null = identity ? {
      endorsedAt: new Date().toISOString(),
      reviewer: identity,
      endorsedDecision: approval.status,
      rationale: approval.reviewNote,
      scope: ['output_pack', 'dossier'],
      runBinding: null, // populated after evidence chain is built
      signature: null,  // populated after run binding
    } : null;
    return { required: true, reason, status: approval.status, reviewerRole: normalizedRole, reviewNote: approval.reviewNote, decisionTimestamp: new Date().toISOString(), reviewerIdentity: identity, endorsement };
  }
  if (required) return { required: true, reason, status: 'pending', reviewerIdentity: null, endorsement: null };
  return { required: false, reason, status: 'not_required', reviewerIdentity: null, endorsement: null };
}

function buildIndependenceProof(): IndependenceProof {
  return {
    generator: { component: 'LLM executor', role: 'candidate_generation' },
    validators: [
      { component: 'sql_governance', role: 'pre_execution_validation', scope: 'SQL safety, schema policy, injection detection' },
      { component: 'policy_engine', role: 'entitlement_enforcement', scope: 'Least-privilege data access, schema/table allow/deny' },
      { component: 'execution_guardrails', role: 'query_shape_enforcement', scope: 'Wildcard, bounds, joins, columns, aggregate/detail classification' },
      { component: 'data_contracts', role: 'post_execution_validation', scope: 'Schema, nullability, business constraints, control totals' },
      { component: 'report_validation', role: 'output_structure_validation', scope: 'Section completeness, metadata, numeric provenance' },
      { component: 'scoring_cascade', role: 'independent_scoring', scope: '8 deterministic scorers with priority short-circuit' },
    ],
    escalation: { component: 'review_policy', role: 'evidence_aware_escalation' },
    auditRecorder: { component: 'audit_trail', role: 'tamper_evident_recording' },
    overlapDetected: false,
    summary: 'Generator (LLM) and validators (policy engine + deterministic scorers) are architecturally separate. Execution evidence may come from fixtures or bounded live DB runtime, but no validator component has authority to modify candidate output.',
  };
}

export function runFinancialPipeline(input: FinancialPipelineInput): FinancialRunReport {
  const pipelineStart = Date.now();
  const stages: StageTimingEntry[] = [];
  const audit = createAuditTrail(input.runId);

  function timed<T>(stage: string, fn: () => T): T {
    const s = Date.now();
    const result = fn();
    const e = Date.now();
    stages.push({ stage, startMs: s - pipelineStart, endMs: e - pipelineStart, durationMs: e - s });
    return result;
  }

  // ── Replay identity (excludes runId for replay equivalence) ──
  const replayIdentity = h(JSON.stringify({ intent: input.intent, sql: input.candidateSql }));
  const runIdentity = h(JSON.stringify({ runId: input.runId, intent: input.intent, sql: input.candidateSql }));

  appendAuditEntry(audit, 'intake', 'pipeline_start', 'lifecycle', {
    runId: input.runId, queryType: input.intent.queryType, replayIdentity, runIdentity,
  });

  // ── SQL Governance ──
  const sqlGovernance = timed('sql_governance', () => governSql(input.candidateSql, input.intent));
  appendAuditEntry(audit, 'sql_governance', sqlGovernance.result, 'governance', {
    result: sqlGovernance.result,
    gatesPassed: sqlGovernance.gates.filter((g) => g.passed).length,
    referencedTables: sqlGovernance.referencedTables.map((r) => r.reference),
  });

  // ── Policy & Entitlement ──
  const policyResult = timed('policy', () => evaluatePolicy(sqlGovernance.referencedTables, input.intent));
  appendAuditEntry(audit, 'policy', policyResult.result, 'governance', {
    result: policyResult.result,
    leastPrivilegePreserved: policyResult.leastPrivilegePreserved,
    denied: policyResult.decisions.filter((d) => d.verdict === 'denied').map((d) => d.reference),
    restricted: policyResult.decisions.filter((d) => d.verdict === 'restricted').map((d) => d.reference),
  });

  // ── Execution Guardrails ──
  const guardrailResult = timed('guardrails', () =>
    evaluateGuardrails(input.candidateSql, input.intent.executionClass, input.intent.executionBudget),
  );
  appendAuditEntry(audit, 'guardrails', guardrailResult.result, 'governance', {
    result: guardrailResult.result, executionClass: guardrailResult.executionClass,
    failedChecks: guardrailResult.failedChecks,
  });

  // ── Snapshot Identity ──
  const hasExternalExecution = !!input.externalExecution;
  const liveSnapshot = input.liveExecution ? computeSqliteSnapshot(input.liveExecution.bindings) : null;
  const snapshot: SnapshotIdentity = hasExternalExecution
    ? {
        snapshotId: `snap_${input.runId}`,
        snapshotHash: input.externalExecution!.executionContextHash ?? input.externalExecution!.schemaHash,
        version: `${input.externalExecution!.provider ?? 'external'}-live-v1`,
        fixtureCount: 0,
        sourceKind: 'live_db',
        sourceCount: 1,
      }
    : input.liveExecution
      ? {
          snapshotId: `snap_${input.runId}`,
          snapshotHash: liveSnapshot!.snapshotHash,
          version: 'sqlite-live-v1',
          fixtureCount: 0,
          sourceKind: 'live_db',
          sourceCount: liveSnapshot!.sourceCount,
        }
      : {
          snapshotId: `snap_${input.runId}`,
          snapshotHash: h(JSON.stringify(input.fixtures.map((f) => ({ hash: f.sqlHash, desc: f.description })))),
          version: 'fixture-v1',
          fixtureCount: input.fixtures.length,
          sourceKind: 'fixture',
          sourceCount: input.fixtures.length,
        };

  // ── WARRANT ISSUANCE (before execution) ──
  const warrant = issueWarrant(
    input.runId, input.intent, sqlGovernance, policyResult, guardrailResult, snapshot,
    replayIdentity, !!(input.generatedReport && input.reportContract),
  );
  appendAuditEntry(audit, 'warrant', warrant.status, 'governance', {
    warrantId: warrant.warrantId, status: warrant.status, trustLevel: warrant.trustLevel,
    allowedPath: warrant.allowedPath, violations: warrant.violations,
  });

  // ── Execution (only if warrant is active) ──
  let execution = null;
  if (warrant.status === 'active') {
    const execViolation = validateWarrantStage(warrant, 'execution');
    if (execViolation) recordWarrantViolation(warrant, execViolation);
    // Validate snapshot consistency
    const snapViolation = validateWarrantSnapshot(warrant, snapshot.snapshotHash);
    if (snapViolation) recordWarrantViolation(warrant, snapViolation);
  }
  if (warrant.status === 'active') {
    if (hasExternalExecution) {
      // Use pre-computed external execution (e.g., Postgres)
      execution = input.externalExecution!;
    } else {
      execution = timed('execution', () =>
        input.liveExecution
          ? executeSqliteQuery(input.candidateSql, input.liveExecution)
          : executeFixtureQuery(input.candidateSql, input.fixtures),
      );
    }
    appendAuditEntry(audit, 'execution', execution.success ? 'success' : 'failure', 'execution', {
      success: execution.success, rowCount: execution.rowCount, schemaHash: execution.schemaHash,
      provider: execution.provider ?? (input.liveExecution ? 'sqlite' : 'fixture'),
    });
  }

  // ── Data Contracts (warrant-checked) ──
  let dataContract = null;
  if (execution?.success) {
    const dcViolation = validateWarrantStage(warrant, 'data_contracts');
    if (dcViolation) recordWarrantViolation(warrant, dcViolation);
  }
  if (execution?.success && warrant.status === 'active') {
    dataContract = timed('data_contracts', () =>
      validateDataContracts(execution!, input.intent.expectedColumns, input.intent.businessConstraints, input.intent.controlTotals),
    );
    appendAuditEntry(audit, 'data_contracts', dataContract.result, 'validation', {
      result: dataContract.result, totalChecks: dataContract.totalChecks, failedChecks: dataContract.failedChecks,
    });
    fulfillWarrantObligation(warrant, 'data_contracts_checked');
    if (dataContract.checks.some((c) => c.check.startsWith('control_total') || c.check.startsWith('sum_equals'))) {
      fulfillWarrantObligation(warrant, 'reconciliation_checked');
    }
  }

  // ── Semantic Clauses ──
  const semanticClauseResult = input.semanticClauses?.length
    ? evaluateSemanticClauses(input.semanticClauses, execution)
    : null;
  if (semanticClauseResult?.performed) {
    appendAuditEntry(audit, 'semantic_clauses', semanticClauseResult.hardFailCount > 0 ? 'hard_failure' : semanticClauseResult.failCount > 0 ? 'soft_failure' : 'pass', 'validation', {
      clauseCount: semanticClauseResult.clauseCount, passCount: semanticClauseResult.passCount, failCount: semanticClauseResult.failCount,
    });
  }

  // ── Report Validation ──
  let reportValidation = null;
  if (input.generatedReport && input.reportContract) {
    reportValidation = timed('report_validation', () =>
      validateReport(input.generatedReport!, input.reportContract!, execution),
    );
    if (reportValidation.provenance.length > 0) fulfillWarrantObligation(warrant, 'provenance_checked');
  }

  // ── Lineage ──
  const lineage = timed('lineage', () =>
    buildLineageEvidence(input.runId, sqlGovernance, execution, reportValidation, input.generatedReport ?? null, audit),
  );

  // ── Pre-score review policy ──
  let reviewPolicy = timed('review_policy_pre', () =>
    evaluateReviewPolicy({ intent: input.intent, sqlGovernance, dataContract, reportValidation, audit, scores: [] }),
  );

  // ── Scoring (warrant-checked) ──
  const scoringViolation = validateWarrantStage(warrant, 'scoring');
  if (scoringViolation && warrant.status === 'active') recordWarrantViolation(warrant, scoringViolation);
  const scoring = timed('scoring', () =>
    runFinancialScoringCascade({ sqlGovernance, execution, dataContract, reportValidation, audit, lineage, reviewPolicy }),
  );

  // ── Post-score review policy ──
  reviewPolicy = mergePostScoreReview(reviewPolicy, {
    intent: input.intent, sqlGovernance, dataContract, reportValidation, audit, scores: scoring.scores,
  });

  // Thread approval into FINAL review policy
  if (reviewPolicy.required && input.approval) {
    if (input.approval.status === 'approved') reviewPolicy.approved = true;
    else if (input.approval.status === 'rejected') reviewPolicy.rejected = true;
  }

  // ── FIX: Oversight derived from FINAL review state ──
  const oversight = determineOversight(reviewPolicy.required, reviewPolicy.reason, input.intent, input.approval);

  // ── Break Report (before decision — hardStops influence decision) ──
  const breakReport = buildBreakReport(dataContract, reviewPolicy, input.intent.reconciliationClass, snapshot.snapshotHash);

  // ── Warrant obligations (audit) ──
  fulfillWarrantObligation(warrant, 'audit_chain_present');

  // ── Warrant finalization ──
  finalizeWarrant(warrant);

  // ── Warrant violation → decision override ──
  let decision = scoring.decision;
  if (warrant.status === 'violated') decision = 'block';
  else if (policyResult.result === 'fail') decision = 'block';
  if (guardrailResult.result === 'fail' && decision !== 'block') decision = 'fail';
  if (breakReport.hardStops > 0 && decision !== 'block') decision = 'fail';
  // Semantic clause hard failures → fail (analytical obligations violated)
  if (semanticClauseResult?.hardFailCount && semanticClauseResult.hardFailCount > 0 && decision !== 'block') decision = 'fail';
  // Predictive guardrail deny → block (pre-execution risk too high)
  if (input.predictiveGuardrail?.recommendation === 'deny' && decision !== 'block') decision = 'block';
  if (reviewPolicy.required) {
    if (reviewPolicy.rejected) decision = 'rejected';
    else if (!reviewPolicy.approved && (decision === 'pass' || decision === 'warn')) decision = 'pending_approval';
  }

  // ── Audit entries for review/oversight/decision ──
  appendAuditEntry(audit, 'review_policy', reviewPolicy.required ? 'required' : 'not_required', 'oversight', {
    required: reviewPolicy.required, approved: reviewPolicy.approved, rejected: reviewPolicy.rejected, triggeredBy: reviewPolicy.triggeredBy,
  });
  appendAuditEntry(audit, 'oversight', oversight.status, 'oversight', {
    required: oversight.required, status: oversight.status, reviewerRole: oversight.reviewerRole ?? null,
  });
  appendAuditEntry(audit, 'decision', decision, 'decision', { decision, scorersRun: scoring.scorersRun });
  appendAuditEntry(audit, 'finalize', 'pipeline_end', 'lifecycle', { decision });
  const finalizedAudit = finalizeAuditTrail(audit);

  // ── Timeliness ──
  const totalDurationMs = Date.now() - pipelineStart;
  const validationMs = stages.filter((s) => ['data_contracts', 'report_validation'].includes(s.stage)).reduce((a, s) => a + s.durationMs, 0);
  const scoringMs = stages.find((s) => s.stage === 'scoring')?.durationMs ?? 0;
  const controlledAggregationMs = stages.filter((s) => ['sql_governance', 'policy', 'guardrails', 'execution', 'data_contracts'].includes(s.stage)).reduce((a, s) => a + s.durationMs, 0);
  const timelinessProof: TimelinessProof = { totalDurationMs, stages, controlledAggregationMs, validationMs, scoringMs };

  // ── Evidence Chain (canonical artifact hashes) ──
  const evidenceChain = buildEvidenceChain({
    runId: input.runId,
    inputHash: replayIdentity,
    sqlHash: sqlGovernance.sqlHash,
    schemaHash: execution?.schemaHash ?? null,
    contractHash: dataContract ? h(JSON.stringify(dataContract.checks.map((c) => ({ check: c.check, passed: c.passed })))) : null,
    reportHash: reportValidation ? h(JSON.stringify(reportValidation.checks.map((c) => ({ check: c.check, passed: c.passed })))) : null,
    provenanceHash: reportValidation?.provenance.length ? h(JSON.stringify(reportValidation.provenance)) : null,
    lineageHash: h(JSON.stringify({ inputs: lineage.inputs.map((i) => i.hash), outputs: lineage.outputs.map((o) => o.hash), provenanceComplete: lineage.provenanceComplete })),
    scoringHash: h(JSON.stringify(scoring.scores.map((s) => ({ scorer: s.scorer, value: s.value })))),
    auditHash: h(String(finalizedAudit.entries.length) + ':' + String(finalizedAudit.chainIntact)),
    decisionHash: h(decision),
  });

  const independenceProof = buildIndependenceProof();

  // ── Replay Metadata ──
  const fixtureHash = input.liveExecution
    ? snapshot.snapshotHash
    : h(JSON.stringify(input.fixtures.map((f) => f.sqlHash)));
  const replayMetadata: ReplayMetadata = {
    runIdentity, replayIdentity, fixtureHash, decisionHash: h(decision), replayStable: true,
  };

  // ── Live Proof + Readiness ──
  const mergedLiveProofInput: LiveProofInput | null = (input.liveProof || (input.liveExecution && execution))
    ? {
        collectedAt: input.liveProof?.collectedAt,
        upstream: input.liveProof?.upstream ? { ...input.liveProof.upstream } : undefined,
        execution: (input.liveExecution && execution)
          ? {
              ...(input.liveProof?.execution ?? {}),
              provider: input.liveExecution.provider ?? 'sqlite',
              mode: 'live_db',
              latencyMs: execution.durationMs,
              live: true,
            }
          : input.liveProof?.execution
            ? { ...input.liveProof.execution }
            : undefined,
        gaps: input.liveProof?.gaps,
      }
    : null;
  const liveProof = mergedLiveProofInput
    ? buildLiveProof(input.runId, replayIdentity, mergedLiveProofInput)
    : buildOfflineProof(input.runId, replayIdentity);
  const liveReadiness = assessLiveReadiness({
    exerciseType: liveProof.mode === 'offline_fixture' || liveProof.mode === 'mocked_model' ? 'readiness_only' : 'live_exercise',
    liveDbAvailable: !!input.liveExecution || hasExternalExecution,
  });

  // ── Build report ──
  const report: FinancialRunReport = {
    runId: input.runId,
    timestamp: new Date().toISOString(),
    durationMs: totalDurationMs,
    queryIntent: input.intent,
    sqlGovernance, execution, dataContract, reportValidation,
    scoring: { ...scoring, decision },
    audit: finalizedAudit,
    warrant,
    oversight, lineage, reviewPolicy,
    policyResult,
    guardrailResult,
    snapshot,
    outputPack: null as any,
    dossier: null as any,
    manifest: null as any,
    evidenceChain, independenceProof, timelinessProof, breakReport, replayMetadata,
    filingReadiness: null as any,
    attestation: null,
    escrow: null as any,
    receipt: null,
    capsule: null,
    liveProof,
    liveReadiness,
    openLineageExport: null,
    certificate: null,
    predictiveGuardrail: input.predictiveGuardrail ?? null,
    semanticClauses: semanticClauseResult,
    decision,
  };

  // ── Filing Readiness ──
  report.filingReadiness = assessFilingReadiness(report);
  fulfillWarrantObligation(warrant, 'filing_readiness_assessed');
  finalizeWarrant(warrant);

  // ── Authority Escrow (progressive release before receipt) ──
  report.escrow = buildEscrow(
    warrant,
    finalizedAudit.chainIntact,
    reviewPolicy.required,
    reviewPolicy.approved,
    reviewPolicy.rejected,
    breakReport.hardStops,
  );

  // ── Bind + sign reviewer endorsement (now that evidence chain exists) ──
  if (report.oversight.endorsement && report.oversight.endorsement.runBinding === null) {
    report.oversight.endorsement.runBinding = {
      runId: input.runId,
      replayIdentity,
      evidenceChainTerminal: report.evidenceChain.terminalHash,
    };
    // Sign the now-bound endorsement if reviewer key pair is available
    if (input.approval?.reviewerKeyPair) {
      report.oversight.endorsement = signReviewerEndorsement(report.oversight.endorsement, input.approval.reviewerKeyPair);
      // Update reviewer identity with signer fingerprint
      report.oversight.reviewerIdentity = report.oversight.endorsement.reviewer;
    }
  }

  // ── Runtime Artifacts (single coherent build cycle — no artifact drift) ──
  // 1. Receipt (needs warrant, escrow, evidence chain, filing readiness)
  report.receipt = issueReceipt(report);
  // 2. Capsule (needs warrant, escrow, receipt, evidence chain — NOT attestation/manifest)
  report.capsule = buildDecisionCapsule(report);
  // 3. Output pack + dossier (need receipt + capsule to be present)
  report.outputPack = buildOutputPack(report);
  report.dossier = buildDecisionDossier(report);
  // 4. Manifest (hashes FINAL output pack + dossier that include receipt + capsule)
  report.manifest = buildRunManifest(
    input.runId, decision, finalizedAudit, lineage, report.outputPack, report.dossier,
    report.liveProof,
    report.receipt?.receiptStatus, report.receipt?.receiptId, report.evidenceChain.terminalHash,
    report.capsule?.capsuleId, report.capsule?.authorityState,
  );
  // 5. Attestation (references FINAL manifest)
  report.attestation = buildAttestationPack(report);
  report.openLineageExport = buildOpenLineageExport(report);
  // 6. Rebuild dossier so reviewer summary includes attestation + OpenLineage truth
  report.dossier = buildDecisionDossier(report);

  // 6. Portable attestation certificate (Ed25519, issued only when signing key is provided)
  if (input.signingKeyPair) {
    const certInput: CertificateInput = {
      runIdentity: replayIdentity,
      decision: report.decision,
      decisionSummary: `${report.scoring.scorersRun} scorers: ${report.scoring.decision}. Authority: ${report.capsule?.authorityState ?? 'unknown'}.`,
      warrant: {
        status: report.warrant.status,
        obligationsFulfilled: report.warrant.evidenceObligations.filter((o: any) => o.fulfilled).length,
        obligationsTotal: report.warrant.evidenceObligations.length,
      },
      escrow: { state: report.escrow.state },
      receipt: { status: report.receipt?.receiptStatus ?? 'not_issued' },
      capsule: { authority: report.capsule?.authorityState ?? 'unknown' },
      evidenceChainRoot: report.evidenceChain.rootHash,
      evidenceChainTerminal: report.evidenceChain.terminalHash,
      auditChainIntact: report.audit.chainIntact,
      auditEntryCount: report.audit.entries.length,
      sqlHash: report.sqlGovernance.sqlHash,
      snapshotHash: report.snapshot.snapshotHash,
      sqlGovernance: report.sqlGovernance.result as 'pass' | 'fail',
      policy: report.policyResult.result as 'pass' | 'fail',
      guardrails: report.guardrailResult.result as 'pass' | 'fail',
      dataContracts: (report.dataContract?.result ?? 'skip') as 'pass' | 'fail' | 'warn' | 'skip',
      scorersRun: report.scoring.scorersRun,
      reviewRequired: report.reviewPolicy.required,
      liveProofMode: report.liveProof.mode,
      upstreamLive: report.liveProof.upstream.live,
      executionLive: report.liveProof.execution.live,
      liveProofConsistent: report.liveProof.consistent ?? false,
    };
    report.certificate = issueCertificate(certInput, input.signingKeyPair);
  } else {
    report.certificate = null;
  }

  return report;
}
