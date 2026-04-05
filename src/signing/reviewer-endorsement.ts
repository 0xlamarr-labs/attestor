/**
 * Attestor Reviewer-Signed Endorsement
 *
 * Enables a reviewer to cryptographically bind their approval to the
 * endorsement body using Ed25519. This completes the trust chain:
 *
 *   Generator (AI) → Governor (Attestor) → Reviewer (human, signed) → Certificate
 *
 * The reviewer's signature proves:
 * - WHO approved (Ed25519 public key identity)
 * - WHAT they approved (endorsedDecision, bound to the run)
 * - WHEN they approved (endorsedAt timestamp)
 * - WHY they approved (rationale)
 *
 * This is separate from the runtime certificate signer —
 * the reviewer signs their own endorsement with their own key.
 */

import { signPayload, verifySignature, canonicalize } from './sign.js';
import { derivePublicKeyIdentity } from './keys.js';
import type { AttestorKeyPair } from './keys.js';
import type { ReviewerEndorsement, ReviewerIdentity } from '../financial/types.js';

/**
 * Sign a reviewer endorsement with the reviewer's Ed25519 key.
 * Returns a new endorsement with the signature and fingerprint populated.
 */
export function signReviewerEndorsement(
  endorsement: ReviewerEndorsement,
  reviewerKeyPair: AttestorKeyPair,
): ReviewerEndorsement {
  // Populate signer fingerprint on the reviewer identity
  const signedReviewer: ReviewerIdentity = {
    ...endorsement.reviewer,
    signerFingerprint: reviewerKeyPair.fingerprint,
  };

  // Build the body to sign (everything except signature — includes run binding)
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

/**
 * Verify a reviewer endorsement signature.
 * Requires the reviewer's public key PEM.
 */
export function verifyReviewerEndorsement(
  endorsement: ReviewerEndorsement,
  reviewerPublicKeyPem: string,
): { valid: boolean; fingerprintMatch: boolean; explanation: string } {
  if (!endorsement.signature) {
    return { valid: false, fingerprintMatch: false, explanation: 'Endorsement is unsigned' };
  }

  // Verify fingerprint
  const derived = derivePublicKeyIdentity(reviewerPublicKeyPem);
  const fingerprintMatch = derived.fingerprint === endorsement.reviewer.signerFingerprint;

  // Reconstruct signed body (includes run binding)
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

  const explanation = valid && fingerprintMatch
    ? `Reviewer endorsement verified: ${endorsement.reviewer.name} (${endorsement.reviewer.signerFingerprint})`
    : `Verification failed: signature=${valid}, fingerprint=${fingerprintMatch}`;

  return { valid, fingerprintMatch, explanation };
}
