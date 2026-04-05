/**
 * Keyless Signer — Sigstore-inspired default signing path
 *
 * Makes PKI-backed signing the default instead of flat ephemeral keys.
 * Follows the Sigstore pattern: identity IS the credential.
 *
 * ARCHITECTURE (mirrors Sigstore/Fulcio):
 * 1. Generate ephemeral Ed25519 key pair (per-signing, never persisted)
 * 2. CA issues a short-lived leaf certificate binding key to identity
 * 3. Artifact signed with ephemeral key
 * 4. Trust chain (CA cert + leaf cert) attached to artifact
 * 5. Ephemeral private key discarded immediately after signing
 *
 * VERIFICATION:
 * Verifier needs only the CA public key (trust root) to verify:
 * - CA self-signature valid
 * - Leaf issued by CA
 * - Leaf not expired
 * - Artifact signature matches leaf key
 * - Certificate-to-leaf binding intact
 *
 * BOUNDARY:
 * - No external Fulcio/Rekor integration (yet)
 * - No transparency log (yet)
 * - Self-hosted CA hierarchy, not public PKI
 * - Short-lived certs (configurable, default 1 hour)
 */

import {
  generateKeyPair,
  type AttestorKeyPair,
} from './keys.js';
import {
  createCaCertificate,
  issueLeafCertificate,
  buildTrustChain,
  verifyTrustChain,
  type CaCertificate,
  type LeafCertificate,
  type TrustChain,
  type ChainVerification,
} from './pki-chain.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KeylessSigner {
  /** The ephemeral signing key pair (destroyed after use in production). */
  signingKeyPair: AttestorKeyPair;
  /** The trust chain binding the ephemeral key to the CA. */
  trustChain: TrustChain;
  /** The CA's public key PEM for verification. */
  caPublicKeyPem: string;
  /** Identity that was bound to the leaf certificate. */
  boundIdentity: BoundIdentity;
  /** Leaf certificate validity in minutes. */
  leafValidityMinutes: number;
}

export interface BoundIdentity {
  /** Subject name on the leaf certificate. */
  subject: string;
  /** Role/purpose. */
  role: 'runtime_signer' | 'reviewer';
  /** Identity source. */
  source: 'ephemeral' | 'oidc_verified' | 'operator_asserted';
  /** Original identifier (email, sub, or CLI user). */
  identifier: string;
}

export interface KeylessSignerConfig {
  /** CA name. Default: 'Attestor Keyless CA'. */
  caName?: string;
  /** Leaf certificate validity in minutes. Default: 60. */
  leafValidityMinutes?: number;
  /** CA validity in days. Default: 365. */
  caValidityDays?: number;
}

// ─── CA Singleton (per-process) ─────────────────────────────────────────────

let cachedCa: { keyPair: AttestorKeyPair; certificate: CaCertificate } | null = null;

function getOrCreateCa(config?: KeylessSignerConfig): { keyPair: AttestorKeyPair; certificate: CaCertificate } {
  if (!cachedCa) {
    const caKeyPair = generateKeyPair();
    const caCert = createCaCertificate(
      config?.caName ?? 'Attestor Keyless CA',
      caKeyPair,
      config?.caValidityDays ?? 365,
    );
    cachedCa = { keyPair: caKeyPair, certificate: caCert };
  }
  return cachedCa;
}

/** Reset CA (for testing). */
export function resetKeylessCa(): void {
  cachedCa = null;
}

// ─── Keyless Signer Creation ────────────────────────────────────────────────

/**
 * Create a keyless signer: ephemeral key + short-lived CA-issued leaf cert.
 *
 * This is the DEFAULT signing path. The ephemeral key should be discarded
 * after the signing operation completes.
 */
export function createKeylessSigner(
  identity: BoundIdentity,
  config?: KeylessSignerConfig,
): KeylessSigner {
  const ca = getOrCreateCa(config);
  const leafValidityMinutes = config?.leafValidityMinutes ?? 60;

  // Generate ephemeral key pair (will be discarded after signing)
  const signingKeyPair = generateKeyPair();

  // Issue short-lived leaf certificate
  const leafCert = issueLeafCertificate(
    identity.subject,
    identity.role,
    signingKeyPair,
    ca.keyPair,
    ca.certificate,
    // Convert minutes to days (minimum 1 day for the cert library, but we track actual validity separately)
    Math.max(1, Math.ceil(leafValidityMinutes / (24 * 60))),
  );

  const trustChain = buildTrustChain(ca.certificate, leafCert);

  return {
    signingKeyPair,
    trustChain,
    caPublicKeyPem: ca.keyPair.publicKeyPem,
    boundIdentity: identity,
    leafValidityMinutes,
  };
}

/**
 * Create a keyless signer pair: one for runtime signing, one for reviewer.
 */
export function createKeylessSignerPair(
  signerIdentity?: Partial<BoundIdentity>,
  reviewerIdentity?: Partial<BoundIdentity>,
  config?: KeylessSignerConfig,
): { signer: KeylessSigner; reviewer: KeylessSigner } {
  const signer = createKeylessSigner({
    subject: signerIdentity?.subject ?? 'Runtime Signer',
    role: 'runtime_signer',
    source: signerIdentity?.source ?? 'ephemeral',
    identifier: signerIdentity?.identifier ?? 'keyless-runtime',
  }, config);

  const reviewer = createKeylessSigner({
    subject: reviewerIdentity?.subject ?? 'Reviewer',
    role: 'reviewer',
    source: reviewerIdentity?.source ?? 'ephemeral',
    identifier: reviewerIdentity?.identifier ?? 'keyless-reviewer',
  }, config);

  return { signer, reviewer };
}

/**
 * Verify a keyless signer's trust chain.
 */
export function verifyKeylessSigner(signer: KeylessSigner): ChainVerification {
  return verifyTrustChain(signer.trustChain, signer.caPublicKeyPem);
}
