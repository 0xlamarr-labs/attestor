/**
 * Attestor Authority Bundle + Verification Kit
 *
 * Authority Bundle: the full internal evidence package for a governed run.
 * Verification Kit: the portable outsider-verifiable package.
 *
 * The bundle is the audit-grade truth.
 * The kit is the portable proof.
 */

import type { FinancialRunReport, ReviewerEndorsement } from '../financial/types.js';
import type { AttestationCertificate } from './certificate.js';
import type { CertificateVerification } from './certificate.js';
import { verifyCertificate } from './certificate.js';
import { verifyReviewerEndorsement } from './reviewer-endorsement.js';

// ─── Authority Bundle ────────────────────────────────────────────────────────

export interface AuthorityBundle {
  version: '1.0';
  type: 'attestor.authority_bundle.v1';
  runId: string;
  timestamp: string;
  decision: string;

  authority: {
    warrant: { id: string; status: string; trustLevel: string; obligationsFulfilled: number; obligationsTotal: number };
    escrow: { state: string; releasedCount: number; totalObligations: number; reviewHeld: boolean };
    receipt: { id: string | null; status: string; signatureMode: string } | null;
    capsule: { id: string | null; authorityState: string; factCount: number } | null;
  };

  evidence: {
    chainRoot: string;
    chainTerminal: string;
    /** Replay identity anchoring the run's deterministic identity for endorsement binding. */
    replayIdentity: string;
    auditEntryCount: number;
    auditChainIntact: boolean;
    sqlHash: string;
    snapshotHash: string;
  };

  governance: {
    sqlGovernance: { result: string; gatesPassed: number; gatesTotal: number };
    policy: { result: string; leastPrivilegePreserved: boolean };
    guardrails: { result: string; checksRun: number };
    dataContracts: { result: string; checksRun: number; failedCount: number } | null;
    scoring: { decision: string; scorersRun: number; passCount: number; failCount: number; warnCount: number };
    review: {
      required: boolean;
      triggeredBy: string[];
      endorsement: {
        endorsedAt: string;
        reviewerName: string;
        reviewerRole: string;
        endorsedDecision: string;
        signed: boolean;
        runBinding: { runId: string; replayIdentity: string; evidenceChainTerminal: string } | null;
        signerFingerprint: string | null;
      } | null;
    };
  };

  proof: {
    mode: string;
    upstreamLive: boolean;
    executionLive: boolean;
    /** Execution provider when live (e.g., 'postgres', 'sqlite'). Null for fixture. */
    executionProvider: string | null;
    /** Execution context hash when live DB execution occurred. Null for fixture/SQLite. */
    executionContextHash: string | null;
    consistent: boolean;
    gapCategories: string[];
  };

  filing: {
    status: string;
    blockingGapCount: number;
  };
}

/**
 * Build an authority bundle from a completed financial run report.
 */
export function buildAuthorityBundle(report: FinancialRunReport): AuthorityBundle {
  return {
    version: '1.0',
    type: 'attestor.authority_bundle.v1',
    runId: report.runId,
    timestamp: report.timestamp,
    decision: report.decision,
    authority: {
      warrant: {
        id: report.warrant.warrantId,
        status: report.warrant.status,
        trustLevel: report.warrant.trustLevel,
        obligationsFulfilled: report.warrant.evidenceObligations.filter((o) => o.fulfilled).length,
        obligationsTotal: report.warrant.evidenceObligations.length,
      },
      escrow: {
        state: report.escrow.state,
        releasedCount: report.escrow.releasedCount,
        totalObligations: report.escrow.totalObligations,
        reviewHeld: report.escrow.reviewHeld,
      },
      receipt: report.receipt ? {
        id: report.receipt.receiptId,
        status: report.receipt.receiptStatus,
        signatureMode: report.receipt.signatureMode,
      } : null,
      capsule: report.capsule ? {
        id: report.capsule.capsuleId,
        authorityState: report.capsule.authorityState,
        factCount: report.capsule.authorityFacts.length,
      } : null,
    },
    evidence: {
      chainRoot: report.evidenceChain.rootHash,
      chainTerminal: report.evidenceChain.terminalHash,
      replayIdentity: report.replayMetadata.replayIdentity,
      auditEntryCount: report.audit.entries.length,
      auditChainIntact: report.audit.chainIntact,
      sqlHash: report.sqlGovernance.sqlHash,
      snapshotHash: report.snapshot.snapshotHash,
    },
    governance: {
      sqlGovernance: {
        result: report.sqlGovernance.result,
        gatesPassed: report.sqlGovernance.gates.filter((g) => g.passed).length,
        gatesTotal: report.sqlGovernance.gates.length,
      },
      policy: {
        result: report.policyResult.result,
        leastPrivilegePreserved: report.policyResult.leastPrivilegePreserved,
      },
      guardrails: {
        result: report.guardrailResult.result,
        checksRun: report.guardrailResult.checks.length,
      },
      dataContracts: report.dataContract ? {
        result: report.dataContract.result,
        checksRun: report.dataContract.checks.length,
        failedCount: report.dataContract.checks.filter((c) => !c.passed).length,
      } : null,
      scoring: {
        decision: report.scoring.decision,
        scorersRun: report.scoring.scorersRun,
        passCount: report.scoring.scores.filter((s) => s.value === true).length,
        failCount: report.scoring.scores.filter((s) => s.value === false).length,
        warnCount: report.scoring.scores.filter((s) => s.value === 'warn').length,
      },
      review: {
        required: report.reviewPolicy.required,
        triggeredBy: report.reviewPolicy.triggeredBy,
        endorsement: report.oversight.endorsement ? {
          endorsedAt: report.oversight.endorsement.endorsedAt,
          reviewerName: report.oversight.endorsement.reviewer.name,
          reviewerRole: report.oversight.endorsement.reviewer.role,
          endorsedDecision: report.oversight.endorsement.endorsedDecision,
          signed: !!report.oversight.endorsement.signature,
          runBinding: report.oversight.endorsement.runBinding,
          signerFingerprint: report.oversight.endorsement.reviewer.signerFingerprint ?? null,
        } : null,
      },
    },
    proof: {
      mode: report.liveProof.mode,
      upstreamLive: report.liveProof.upstream.live,
      executionLive: report.liveProof.execution.live,
      executionProvider: report.liveProof.execution.provider ?? null,
      executionContextHash: report.execution?.executionContextHash ?? null,
      consistent: report.liveProof.consistent ?? false,
      gapCategories: report.liveProof.gaps.map((g) => g.category),
    },
    filing: {
      status: report.filingReadiness.status,
      blockingGapCount: report.filingReadiness.gaps.filter((g) => g.blocking).length,
    },
  };
}

// ─── Verification Kit ────────────────────────────────────────────────────────

export interface VerificationKit {
  version: '1.0';
  type: 'attestor.verification_kit.v1';

  certificate: AttestationCertificate;
  bundle: AuthorityBundle;
  signerPublicKeyPem: string;

  /** Reviewer endorsement material for independent verification (null when no endorsement). */
  reviewerEndorsement: ReviewerEndorsement | null;
  /** Reviewer's public key PEM for independent endorsement verification (null when unsigned). */
  reviewerPublicKeyPem: string | null;

  verification: VerificationSummary;
}

export interface VerificationSummary {
  /** Cryptographic signature validity. */
  cryptographic: { valid: boolean; algorithm: string; fingerprint: string };
  /** Structural validity of the certificate schema. */
  structural: { valid: boolean; version: string; type: string };
  /** Authority chain state. */
  authority: { state: string; warrantFulfilled: boolean; escrowReleased: boolean; receiptIssued: boolean };
  /** Governance sufficiency — did enough gates pass for the claimed decision? */
  governanceSufficiency: {
    sufficient: boolean;
    sqlPass: boolean;
    policyPass: boolean;
    guardrailsPass: boolean;
    scoringDecision: string;
  };
  /** Proof completeness — what was actually proven vs what is claimed. */
  proofCompleteness: {
    mode: string;
    gapCount: number;
    gaps: string[];
    executionLive: boolean;
    upstreamLive: boolean;
    /** Execution provider when live (e.g., 'postgres'). Null for fixture. */
    executionProvider: string | null;
    /** Whether database context evidence exists (executionContextHash present). */
    hasDbContextEvidence: boolean;
  };
  /** Reviewer endorsement verification — is the run backed by verified human authority? */
  reviewerEndorsement: {
    /** Is a reviewer endorsement present in the bundle? */
    present: boolean;
    /** Is the endorsement cryptographically signed? */
    signed: boolean;
    /** Is the endorsement bound to this specific run (runId + evidenceChainTerminal + replayIdentity)? */
    boundToRun: boolean;
    /** Does the endorsement have run-binding fields but they DON'T match this kit's run? */
    bindingMismatch: boolean;
    /** Does the signature verify against the provided reviewer public key? */
    verified: boolean;
    /** Reviewer name (when present). */
    reviewerName: string | null;
    /** Reviewer signer fingerprint (when signed). */
    fingerprint: string | null;
  };
  /** Overall verdict. */
  overall: 'verified' | 'signature_invalid' | 'governance_insufficient' | 'authority_incomplete' | 'proof_degraded';
}

/**
 * Build a verification kit from a report + certificate + public key.
 * Optionally includes reviewer endorsement material for independent verification.
 */
export function buildVerificationKit(
  report: FinancialRunReport,
  publicKeyPem: string,
  reviewerPublicKeyPem?: string | null,
): VerificationKit | null {
  if (!report.certificate) return null;

  const bundle = buildAuthorityBundle(report);
  const cryptoResult = verifyCertificate(report.certificate, publicKeyPem);

  const endorsement = report.oversight.endorsement ?? null;
  const verification = buildVerificationSummary(report.certificate, bundle, cryptoResult, endorsement, reviewerPublicKeyPem ?? null);

  return {
    version: '1.0',
    type: 'attestor.verification_kit.v1',
    certificate: report.certificate,
    bundle,
    signerPublicKeyPem: publicKeyPem,
    reviewerEndorsement: endorsement,
    reviewerPublicKeyPem: reviewerPublicKeyPem ?? null,
    verification,
  };
}

/**
 * Build a multi-dimensional verification summary.
 * When reviewer endorsement + public key are provided, independently verifies the endorsement.
 */
export function buildVerificationSummary(
  certificate: AttestationCertificate,
  bundle: AuthorityBundle,
  cryptoResult: CertificateVerification,
  endorsement?: ReviewerEndorsement | null,
  reviewerPublicKeyPem?: string | null,
): VerificationSummary {
  const cryptographic = {
    valid: cryptoResult.signatureValid && cryptoResult.fingerprintConsistent,
    algorithm: certificate.signing.algorithm,
    fingerprint: certificate.signing.fingerprint,
  };

  const structural = {
    valid: cryptoResult.schemaValid,
    version: certificate.version,
    type: certificate.type,
  };

  const warrantFulfilled = bundle.authority.warrant.status === 'fulfilled';
  const escrowReleased = bundle.authority.escrow.state === 'released';
  const receiptIssued = bundle.authority.receipt?.status === 'issued';
  const authorityState = (warrantFulfilled && escrowReleased && receiptIssued) ? 'authorized'
    : (!warrantFulfilled) ? 'warrant_incomplete'
      : (!escrowReleased) ? 'escrow_held'
        : 'receipt_pending';

  const sqlPass = certificate.governance.sqlGovernance === 'pass';
  const policyPass = certificate.governance.policy === 'pass';
  const guardrailsPass = certificate.governance.guardrails === 'pass';
  const governanceSufficient = sqlPass && policyPass && guardrailsPass;

  const proofGaps = bundle.proof.gapCategories;
  const proofMode = bundle.proof.mode;

  // ── Reviewer endorsement verification (6th dimension) ──
  // boundToRun is a REAL consistency check: endorsement binding must match kit/bundle identity
  const present = !!endorsement;
  const signed = present && !!endorsement!.signature;
  const bindingPresent = present && !!endorsement!.runBinding && !!endorsement!.runBinding.runId;
  const boundToRun = bindingPresent
    && endorsement!.runBinding!.runId === bundle.runId
    && endorsement!.runBinding!.evidenceChainTerminal === bundle.evidence.chainTerminal
    && endorsement!.runBinding!.replayIdentity === bundle.evidence.replayIdentity;

  // Endorsement is verified ONLY when signature is valid AND binding matches the kit
  let endorsementVerified = false;
  if (signed && boundToRun && reviewerPublicKeyPem) {
    const result = verifyReviewerEndorsement(endorsement!, reviewerPublicKeyPem);
    endorsementVerified = result.valid && result.fingerprintMatch;
  }

  // bindingMismatch: endorsement HAS run-binding fields, but they DON'T match this kit's run
  const bindingMismatch = bindingPresent && !boundToRun;

  const reviewerEndorsementDim = {
    present,
    signed,
    boundToRun,
    bindingMismatch,
    verified: endorsementVerified,
    reviewerName: endorsement?.reviewer.name ?? null,
    fingerprint: endorsement?.reviewer.signerFingerprint ?? null,
  };

  let overall: VerificationSummary['overall'];
  if (!cryptographic.valid) overall = 'signature_invalid';
  else if (!governanceSufficient) overall = 'governance_insufficient';
  else if (authorityState !== 'authorized') overall = 'authority_incomplete';
  else if (proofGaps.length > 0 || proofMode === 'offline_fixture') overall = 'proof_degraded';
  else overall = 'verified';

  return {
    cryptographic,
    structural,
    authority: { state: authorityState, warrantFulfilled, escrowReleased, receiptIssued },
    governanceSufficiency: { sufficient: governanceSufficient, sqlPass, policyPass, guardrailsPass, scoringDecision: bundle.governance.scoring.decision },
    proofCompleteness: { mode: proofMode, gapCount: proofGaps.length, gaps: proofGaps, executionLive: bundle.proof.executionLive, upstreamLive: bundle.proof.upstreamLive, executionProvider: bundle.proof.executionProvider, hasDbContextEvidence: !!bundle.proof.executionContextHash },
    reviewerEndorsement: reviewerEndorsementDim,
    overall,
  };
}
