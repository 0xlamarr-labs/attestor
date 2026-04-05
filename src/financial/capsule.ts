/**
 * Decision Capsule v1.1 — Judgment-preserving portable authority state.
 *
 * v1.1 improvements:
 * - Build order: capsule before manifest/attestation (no artifact drift)
 * - Judgment-preserving: distinguishes blocked/withheld/partial/denied/authorized
 *   with explicit authority-fact vs advisory-signal distinction
 * - Verification: checks warrant/escrow/receipt linkage, evidence-chain anchor,
 *   authority-state consistency, and optional manifest cross-check.
 *   Attestation reference is null at capsule build time (capsule precedes attestation).
 */

import { createHash } from 'node:crypto';
import type { FinancialRunReport, FinancialDecision, EscrowState } from './types.js';

function h(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export type AuthorityState = 'authorized' | 'partial' | 'denied' | 'blocked';

/** Distinguish hard authority facts from advisory signals. */
export type AuthorityFactType = 'hard_block' | 'integrity_failure' | 'authority_denied' | 'pending_obligation' | 'advisory' | 'granted';

export interface AuthorityFact {
  type: AuthorityFactType;
  source: string;
  description: string;
}

export interface DecisionCapsule {
  version: '1.1';
  capsuleId: string;
  issuedAt: string;
  runId: string;
  decision: FinancialDecision;
  authorityState: AuthorityState;
  authorityReason: string;
  /** Judgment-preserving authority facts: distinguish hard blocks from advisory signals. */
  authorityFacts: AuthorityFact[];

  warrant: { warrantId: string; status: string; trustLevel: string; contractHash: string };
  escrow: { state: EscrowState; released: number; total: number; reviewHeld: boolean; reason: string };
  receipt: { receiptId: string; status: string; issuanceReason: string } | null;
  identity: { replayIdentity: string; snapshotHash: string; evidenceChainTerminal: string };
  /** Attestation reference (null when capsule is built before attestation). */
  attestation: { version: string; verificationOverall: string; signatureMode: string } | null;

  anchors: {
    warrantHash: string;
    escrowHash: string;
    receiptHash: string | null;
    evidenceChainTerminal: string;
    auditChainIntact: boolean;
  };
}

function deriveAuthorityState(
  escrowState: EscrowState,
  receiptIssued: boolean,
  decision: FinancialDecision,
): { state: AuthorityState; reason: string } {
  if (decision === 'block') return { state: 'blocked', reason: 'Pre-execution gates blocked the run' };
  if (escrowState === 'withheld') return { state: 'denied', reason: 'Authority withheld: escrow conditions not met or explicitly denied' };
  if (escrowState === 'released' && receiptIssued) return { state: 'authorized', reason: 'All escrow obligations released, receipt issued' };
  if (escrowState === 'partial') return { state: 'partial', reason: 'Escrow partially released — awaiting remaining obligations' };
  if (decision === 'fail' || decision === 'rejected') return { state: 'denied', reason: `Decision "${decision}" — authority not granted` };
  return { state: 'partial', reason: 'Authority state indeterminate — escrow not fully released' };
}

/**
 * Collect judgment-preserving authority facts from the run.
 * Distinguishes hard authority facts from advisory/warning signals.
 */
function collectAuthorityFacts(report: FinancialRunReport): AuthorityFact[] {
  const facts: AuthorityFact[] = [];

  // Hard blocks
  if (report.warrant.status === 'violated') {
    for (const v of report.warrant.violations) facts.push({ type: 'hard_block', source: 'warrant', description: v });
  }
  if (report.policyResult.result === 'fail') {
    facts.push({ type: 'hard_block', source: 'policy', description: report.policyResult.summary });
  }
  if (report.guardrailResult.result === 'fail') {
    facts.push({ type: 'hard_block', source: 'guardrails', description: `${report.guardrailResult.failedChecks} guardrail checks failed` });
  }

  // Integrity failures
  if (!report.audit.chainIntact) facts.push({ type: 'integrity_failure', source: 'audit', description: 'Audit trail hash chain broken' });
  if (report.breakReport.hardStops > 0) facts.push({ type: 'integrity_failure', source: 'reconciliation', description: `${report.breakReport.hardStops} reconciliation hard stop(s)` });

  // Authority denial
  if (report.escrow.state === 'withheld' && report.escrow.stateReason.includes('denied')) {
    facts.push({ type: 'authority_denied', source: 'review', description: report.escrow.stateReason });
  }

  // Pending obligations
  if (report.escrow.reviewHeld) facts.push({ type: 'pending_obligation', source: 'review', description: 'Human review required but not completed' });
  const unfulfilledObs = report.warrant.evidenceObligations.filter((o) => !o.fulfilled);
  for (const ob of unfulfilledObs) facts.push({ type: 'pending_obligation', source: 'obligation', description: `Unfulfilled: ${ob.description}` });

  // Advisory signals (warnings that did NOT block authority)
  if (report.breakReport.reviewableVariances > 0) facts.push({ type: 'advisory', source: 'reconciliation', description: `${report.breakReport.reviewableVariances} reviewable variance(s)` });
  if (report.breakReport.informational > 0) facts.push({ type: 'advisory', source: 'reconciliation', description: `${report.breakReport.informational} informational mismatch(es)` });
  if (!report.lineage.provenanceComplete) facts.push({ type: 'advisory', source: 'lineage', description: 'Provenance incomplete' });

  // Granted (positive fact)
  if (report.receipt?.receiptStatus === 'issued') facts.push({ type: 'granted', source: 'receipt', description: 'Receipt issued — authority granted' });

  return facts;
}

export function buildDecisionCapsule(report: FinancialRunReport): DecisionCapsule {
  const { state: authorityState, reason: authorityReason } = deriveAuthorityState(
    report.escrow.state, report.receipt?.receiptStatus === 'issued', report.decision,
  );

  return {
    version: '1.1',
    capsuleId: `caps_${report.runId}_${h(report.warrant.warrantId + report.decision + report.escrow.state)}`,
    issuedAt: new Date().toISOString(),
    runId: report.runId,
    decision: report.decision,
    authorityState,
    authorityReason,
    authorityFacts: collectAuthorityFacts(report),

    warrant: { warrantId: report.warrant.warrantId, status: report.warrant.status, trustLevel: report.warrant.trustLevel, contractHash: report.warrant.contractHash },
    escrow: { state: report.escrow.state, released: report.escrow.releasedCount, total: report.escrow.totalObligations, reviewHeld: report.escrow.reviewHeld, reason: report.escrow.stateReason },
    receipt: report.receipt ? { receiptId: report.receipt.receiptId, status: report.receipt.receiptStatus, issuanceReason: report.receipt.issuanceReason } : null,
    identity: { replayIdentity: report.replayMetadata.replayIdentity, snapshotHash: report.snapshot.snapshotHash, evidenceChainTerminal: report.evidenceChain.terminalHash },
    attestation: report.attestation ? { version: report.attestation.version, verificationOverall: report.attestation.verification.overall, signatureMode: report.attestation.signatureMode } : null,
    anchors: {
      warrantHash: h(JSON.stringify({ id: report.warrant.warrantId, status: report.warrant.status, contract: report.warrant.contractHash })),
      escrowHash: h(JSON.stringify({ state: report.escrow.state, released: report.escrow.releasedCount, total: report.escrow.totalObligations })),
      receiptHash: report.receipt ? h(JSON.stringify({ id: report.receipt.receiptId, status: report.receipt.receiptStatus })) : null,
      evidenceChainTerminal: report.evidenceChain.terminalHash,
      auditChainIntact: report.audit.chainIntact,
    },
  };
}

export function verifyCapsule(capsule: DecisionCapsule, manifestEvidenceTerminal?: string): {
  warrantLinked: boolean;
  escrowLinked: boolean;
  receiptLinked: boolean;
  evidenceAnchored: boolean;
  manifestConsistent: boolean | null;
  authorityConsistent: boolean;
  overall: 'consistent' | 'inconsistent';
} {
  const warrantLinked = capsule.warrant.warrantId.length > 0 && capsule.anchors.warrantHash.length > 0;
  const escrowLinked = capsule.anchors.escrowHash.length > 0;
  const receiptLinked = capsule.receipt !== null ? capsule.anchors.receiptHash !== null : true;
  const evidenceAnchored = capsule.anchors.evidenceChainTerminal.length > 0 && capsule.identity.evidenceChainTerminal === capsule.anchors.evidenceChainTerminal;

  // Cross-artifact: evidence chain terminal matches manifest if provided
  let manifestConsistent: boolean | null = null;
  if (manifestEvidenceTerminal) {
    manifestConsistent = capsule.anchors.evidenceChainTerminal === manifestEvidenceTerminal;
  }

  let authorityConsistent = true;
  if (capsule.authorityState === 'authorized') {
    if (!capsule.receipt || capsule.receipt.status !== 'issued') authorityConsistent = false;
    if (capsule.escrow.state !== 'released') authorityConsistent = false;
  }
  if (capsule.authorityState === 'denied') {
    if (capsule.receipt?.status === 'issued') authorityConsistent = false;
  }
  if (capsule.authorityState === 'blocked') {
    if (capsule.receipt?.status === 'issued') authorityConsistent = false;
  }

  const overall = warrantLinked && escrowLinked && receiptLinked && evidenceAnchored && (manifestConsistent !== false) && authorityConsistent ? 'consistent' : 'inconsistent';
  return { warrantLinked, escrowLinked, receiptLinked, evidenceAnchored, manifestConsistent, authorityConsistent, overall };
}

export function capsuleSummary(c: DecisionCapsule): {
  capsuleId: string; authorityState: string; decision: string; reason: string;
  hardFacts: number; advisorySignals: number;
} {
  return {
    capsuleId: c.capsuleId,
    authorityState: c.authorityState,
    decision: c.decision,
    reason: c.authorityReason,
    hardFacts: c.authorityFacts.filter((f) => f.type === 'hard_block' || f.type === 'integrity_failure' || f.type === 'authority_denied').length,
    advisorySignals: c.authorityFacts.filter((f) => f.type === 'advisory').length,
  };
}
