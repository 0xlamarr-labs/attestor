/**
 * Warrant Receipt v1.1 — Authority completion with final-artifact binding.
 *
 * Build order: receipt is issued BEFORE manifest/attestation, so it cannot
 * reference their hashes directly. Instead, it binds the evidence chain
 * terminal + warrant + decision. Manifest/attestation then reference the
 * receipt, creating a forward chain: receipt → manifest → attestation.
 *
 * Verification: checks receipt payload integrity, warrant binding, evidence
 * binding, and optional HMAC signature. Can also verify against provided
 * manifest/attestation hashes for cross-artifact consistency.
 */

import { createHash, createHmac } from 'node:crypto';
import type { FinancialRunReport, FinancialDecision } from './types.js';

function h(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export type ReceiptStatus = 'issued' | 'withheld';

export interface WarrantReceipt {
  version: '1.1';
  receiptId: string;
  issuedAt: string;
  runId: string;
  warrantId: string;
  warrantStatus: string;
  contractHash: string;
  replayIdentity: string;
  snapshotHash: string;
  decision: FinancialDecision;
  receiptStatus: ReceiptStatus;
  issuanceReason: string;
  /** Evidence bindings to upstream pipeline artifacts. */
  evidenceBindings: {
    evidenceChainTerminal: string;
    auditChainIntact: boolean;
    filingReadiness: string;
    warrantHash: string;
    decisionHash: string;
  };
  verificationSummary: {
    chainLinkage: boolean;
    warrantFulfilled: boolean;
    evidenceChainIntact: boolean;
  };
  signatureMode: 'unsigned' | 'hmac_sha256';
  signature: string | null;
}

function determineReceiptStatus(report: FinancialRunReport): { status: ReceiptStatus; reason: string } {
  // Escrow-first: authority must be fully released before receipt issuance
  if (report.escrow) {
    if (report.escrow.state === 'withheld') {
      return { status: 'withheld', reason: `Escrow withheld: ${report.escrow.stateReason}` };
    }
    if (report.escrow.state === 'held') {
      return { status: 'withheld', reason: `Escrow held: ${report.escrow.stateReason}` };
    }
    if (report.escrow.state === 'partial') {
      return { status: 'withheld', reason: `Escrow partial: ${report.escrow.stateReason}` };
    }
    // state === 'released' → continue to other checks
  }

  // Decision-level checks
  if (report.decision === 'block' || report.decision === 'fail' || report.decision === 'rejected') {
    return { status: 'withheld', reason: `Decision is "${report.decision}" — authority not granted` };
  }
  if (report.decision === 'pending_approval') {
    return { status: 'withheld', reason: 'Pending human approval — receipt withheld until review completes' };
  }

  return { status: 'issued', reason: 'Escrow fully released, decision accepted, all authority conditions satisfied' };
}

/**
 * Issue or withhold a warrant receipt.
 * Called BEFORE manifest/attestation in the build pipeline.
 */
export function issueReceipt(report: FinancialRunReport, signingKey?: string): WarrantReceipt {
  const { status, reason } = determineReceiptStatus(report);

  const body: Omit<WarrantReceipt, 'signature' | 'signatureMode'> = {
    version: '1.1',
    receiptId: `rcpt_${report.runId}_${h(report.warrant.warrantId + report.decision)}`,
    issuedAt: new Date().toISOString(),
    runId: report.runId,
    warrantId: report.warrant.warrantId,
    warrantStatus: report.warrant.status,
    contractHash: report.warrant.contractHash,
    replayIdentity: report.replayMetadata.replayIdentity,
    snapshotHash: report.snapshot.snapshotHash,
    decision: report.decision,
    receiptStatus: status,
    issuanceReason: reason,
    evidenceBindings: {
      evidenceChainTerminal: report.evidenceChain.terminalHash,
      auditChainIntact: report.audit.chainIntact,
      filingReadiness: report.filingReadiness.status,
      warrantHash: h(JSON.stringify({ id: report.warrant.warrantId, status: report.warrant.status, contractHash: report.warrant.contractHash })),
      decisionHash: h(report.decision),
    },
    verificationSummary: {
      chainLinkage: report.evidenceChain.intact,
      warrantFulfilled: report.warrant.status === 'fulfilled',
      evidenceChainIntact: report.evidenceChain.intact,
    },
  };

  if (signingKey && status === 'issued') {
    const canonical = JSON.stringify(body, Object.keys(body).sort());
    const signature = createHmac('sha256', signingKey).update(canonical).digest('hex');
    return { ...body, signatureMode: 'hmac_sha256', signature };
  }

  return { ...body, signatureMode: 'unsigned', signature: null };
}

export interface ReceiptVerificationResult {
  signatureValid: boolean | null;
  warrantBound: boolean;
  evidenceBound: boolean;
  /** Cross-artifact consistency: receipt's evidence hash matches provided manifest evidence. */
  crossArtifactConsistent: boolean | null;
  overall: 'valid' | 'invalid' | 'unsigned';
}

/**
 * Verify a receipt's integrity and bindings.
 * Optionally cross-check against the manifest's evidence chain terminal.
 */
export function verifyReceipt(
  receipt: WarrantReceipt,
  signingKey?: string,
  manifestEvidenceChainTerminal?: string,
): ReceiptVerificationResult {
  let signatureValid: boolean | null = null;

  if (receipt.signatureMode === 'hmac_sha256') {
    if (!signingKey || !receipt.signature) {
      signatureValid = false;
    } else {
      const { signature: _sig, signatureMode: _mode, ...rest } = receipt;
      const canonical = JSON.stringify(rest, Object.keys(rest).sort());
      const expected = createHmac('sha256', signingKey).update(canonical).digest('hex');
      signatureValid = expected === receipt.signature;
    }
  }

  const warrantBound = receipt.warrantId.length > 0 && receipt.contractHash.length > 0;
  const evidenceBound = receipt.evidenceBindings.evidenceChainTerminal.length > 0;

  // Cross-artifact consistency: receipt's evidence chain terminal must match manifest's
  let crossArtifactConsistent: boolean | null = null;
  if (manifestEvidenceChainTerminal) {
    crossArtifactConsistent = receipt.evidenceBindings.evidenceChainTerminal === manifestEvidenceChainTerminal;
  }

  let overall: 'valid' | 'invalid' | 'unsigned';
  if (receipt.signatureMode === 'unsigned') {
    overall = warrantBound && evidenceBound && (crossArtifactConsistent !== false) ? 'unsigned' : 'invalid';
  } else {
    overall = signatureValid && warrantBound && evidenceBound && (crossArtifactConsistent !== false) ? 'valid' : 'invalid';
  }

  return { signatureValid, warrantBound, evidenceBound, crossArtifactConsistent, overall };
}

/** Compact receipt summary for reviewer artifacts. */
export function receiptSummary(r: WarrantReceipt): {
  receiptId: string; status: string; decision: string;
  warrantId: string; signatureMode: string; issuanceReason: string;
} {
  return {
    receiptId: r.receiptId, status: r.receiptStatus, decision: r.decision,
    warrantId: r.warrantId, signatureMode: r.signatureMode, issuanceReason: r.issuanceReason,
  };
}
