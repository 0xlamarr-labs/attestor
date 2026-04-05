/**
 * Multi-Query Reviewer Endorsement
 *
 * Ed25519-signed reviewer endorsement for multi-query governed runs.
 * Binds the reviewer's approval to the specific multi-query run via
 * runId + multiQueryHash, preventing cross-run replay.
 *
 * This is the multi-query equivalent of reviewer-endorsement.ts.
 * The single-query endorsement binds to runId + replayIdentity + evidenceChainTerminal.
 * The multi-query endorsement binds to runId + multiQueryHash (the aggregate evidence anchor).
 */

import { signPayload, verifySignature, canonicalize } from './sign.js';
import { derivePublicKeyIdentity } from './keys.js';
import type { AttestorKeyPair } from './keys.js';
import type { ReviewerIdentity } from '../financial/types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MultiQueryReviewerEndorsement {
  endorsedAt: string;
  reviewer: ReviewerIdentity;
  /** What the reviewer endorsed: the aggregate decision they saw. */
  endorsedDecision: string;
  rationale: string;
  scope: string[];
  /** Multi-query run binding: prevents replay across runs. */
  runBinding: {
    runId: string;
    multiQueryHash: string;
    unitCount: number;
  };
  /** Ed25519 signature over the endorsement body. Null when unsigned. */
  signature: string | null;
}

// ─── Signing ────────────────────────────────────────────────────────────────

export function signMultiQueryReviewerEndorsement(
  endorsement: MultiQueryReviewerEndorsement,
  reviewerKeyPair: AttestorKeyPair,
): MultiQueryReviewerEndorsement {
  const signedReviewer: ReviewerIdentity = {
    ...endorsement.reviewer,
    signerFingerprint: reviewerKeyPair.fingerprint,
  };

  const body = {
    endorsedAt: endorsement.endorsedAt,
    reviewer: signedReviewer,
    endorsedDecision: endorsement.endorsedDecision,
    rationale: endorsement.rationale,
    scope: endorsement.scope,
    runBinding: endorsement.runBinding,
  };

  const canonical = canonicalize(body);
  const signature = signPayload(canonical, reviewerKeyPair.privateKeyPem);

  return {
    ...endorsement,
    reviewer: signedReviewer,
    signature,
  };
}

// ─── Verification ───────────────────────────────────────────────────────────

export interface MultiQueryReviewerVerification {
  valid: boolean;
  fingerprintMatch: boolean;
  boundToRun: boolean;
  bindingMismatch: boolean;
  explanation: string;
}

/**
 * Verify a multi-query reviewer endorsement.
 * Optionally checks run binding against the actual run's multiQueryHash.
 */
export function verifyMultiQueryReviewerEndorsement(
  endorsement: MultiQueryReviewerEndorsement,
  reviewerPublicKeyPem: string,
  expectedRunId?: string,
  expectedMultiQueryHash?: string,
): MultiQueryReviewerVerification {
  if (!endorsement.signature) {
    return { valid: false, fingerprintMatch: false, boundToRun: false, bindingMismatch: false, explanation: 'Endorsement is unsigned' };
  }

  const derived = derivePublicKeyIdentity(reviewerPublicKeyPem);
  const fingerprintMatch = derived.fingerprint === endorsement.reviewer.signerFingerprint;

  const body = {
    endorsedAt: endorsement.endorsedAt,
    reviewer: endorsement.reviewer,
    endorsedDecision: endorsement.endorsedDecision,
    rationale: endorsement.rationale,
    scope: endorsement.scope,
    runBinding: endorsement.runBinding,
  };

  const canonical = canonicalize(body);
  const valid = verifySignature(canonical, endorsement.signature, reviewerPublicKeyPem);

  // Run binding check
  let boundToRun = true;
  let bindingMismatch = false;
  if (expectedRunId !== undefined && expectedMultiQueryHash !== undefined) {
    const runIdMatch = endorsement.runBinding.runId === expectedRunId;
    const hashMatch = endorsement.runBinding.multiQueryHash === expectedMultiQueryHash;
    boundToRun = runIdMatch && hashMatch;
    bindingMismatch = !boundToRun;
  }

  const explanation = valid && fingerprintMatch && boundToRun
    ? `Multi-query reviewer endorsement verified: ${endorsement.reviewer.name} (${endorsement.reviewer.signerFingerprint})`
    : `Verification failed: sig=${valid}, fp=${fingerprintMatch}, bound=${boundToRun}`;

  return { valid, fingerprintMatch, boundToRun, bindingMismatch, explanation };
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Create and sign a multi-query reviewer endorsement.
 */
export function buildMultiQueryReviewerEndorsement(
  runId: string,
  multiQueryHash: string,
  unitCount: number,
  aggregateDecision: string,
  reviewer: ReviewerIdentity,
  rationale: string,
  reviewerKeyPair: AttestorKeyPair,
): MultiQueryReviewerEndorsement {
  const unsigned: MultiQueryReviewerEndorsement = {
    endorsedAt: new Date().toISOString(),
    reviewer,
    endorsedDecision: aggregateDecision,
    rationale,
    scope: ['multi_query_output_pack', 'multi_query_dossier'],
    runBinding: { runId, multiQueryHash, unitCount },
    signature: null,
  };

  return signMultiQueryReviewerEndorsement(unsigned, reviewerKeyPair);
}
