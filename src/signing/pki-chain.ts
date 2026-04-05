/**
 * Attestor PKI Trust Chain — Ed25519 Certificate Authority Hierarchy
 *
 * Implements a bounded CA chain for Ed25519 signers:
 *   Root CA → Leaf Signer Certificate
 *
 * The chain proves that a signer's key was issued/endorsed by a trusted CA.
 * This replaces flat "trust the fingerprint" verification with chain verification:
 * an outsider needs only the Root CA's public key to verify the entire chain.
 *
 * DESIGN:
 * - Root CA: self-signed Ed25519 key pair with CA metadata
 * - Leaf certificate: signed by the CA, binds a signer's public key to an identity
 * - Chain verification: given a leaf cert + CA public key → verified or invalid
 * - All signing uses the existing Ed25519 infrastructure (no external ASN.1 libs)
 *
 * BOUNDARY:
 * - This is NOT full X.509 ASN.1/DER encoding — it is a JSON-based chain model
 * - It IS cryptographically real: Ed25519 signatures over canonical JSON
 * - It proves chain-of-trust for Attestor's own certificate and reviewer key issuance
 * - It does not interoperate with external PKI (browsers, CAs) — that is future work
 */

import { createHash } from 'node:crypto';
import { signPayload, verifySignature, canonicalize } from './sign.js';
import { generateKeyPair, derivePublicKeyIdentity } from './keys.js';
import type { AttestorKeyPair } from './keys.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CaCertificate {
  version: '1.0';
  type: 'attestor.ca_certificate.v1';
  /** Unique CA certificate ID. */
  certificateId: string;
  /** CA display name. */
  name: string;
  /** ISO timestamp — valid from. */
  notBefore: string;
  /** ISO timestamp — valid until. */
  notAfter: string;
  /** Whether this CA can sign other certificates. */
  isCA: true;
  /** CA public key (hex). */
  publicKey: string;
  /** CA public key fingerprint. */
  fingerprint: string;
  /** Self-signature over the certificate body. */
  signature: string;
}

export interface LeafCertificate {
  version: '1.0';
  type: 'attestor.leaf_certificate.v1';
  /** Unique leaf certificate ID. */
  certificateId: string;
  /** Subject name (e.g., "Runtime Signer" or "Reviewer: Jane Chen"). */
  subject: string;
  /** Subject role (e.g., "runtime_signer", "reviewer"). */
  role: string;
  /** ISO timestamp — valid from. */
  notBefore: string;
  /** ISO timestamp — valid until. */
  notAfter: string;
  /** The subject's public key (hex). */
  subjectPublicKey: string;
  /** The subject's public key fingerprint. */
  subjectFingerprint: string;
  /** Issuing CA's fingerprint. */
  issuerFingerprint: string;
  /** CA's signature over the leaf certificate body. */
  issuerSignature: string;
}

export interface TrustChain {
  version: '1.0';
  type: 'attestor.trust_chain.v1';
  ca: CaCertificate;
  leaf: LeafCertificate;
}

export interface ChainVerification {
  caValid: boolean;
  leafValid: boolean;
  chainIntact: boolean;
  caExpired: boolean;
  leafExpired: boolean;
  issuerMatch: boolean;
  overall: 'valid' | 'invalid' | 'expired';
  explanation: string;
}

// ─── CA Certificate ─────────────────────────────────────────────────────────

/**
 * Create a self-signed Root CA certificate.
 * This is the trust anchor — everything chains to this.
 */
export function createCaCertificate(
  name: string,
  caKeyPair: AttestorKeyPair,
  validityDays: number = 365,
): CaCertificate {
  const now = new Date();
  const notAfter = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const certificateId = `ca_${createHash('sha256').update(`${name}:${caKeyPair.fingerprint}:${now.toISOString()}`).digest('hex').slice(0, 16)}`;

  const body = {
    version: '1.0' as const,
    type: 'attestor.ca_certificate.v1' as const,
    certificateId,
    name,
    notBefore: now.toISOString(),
    notAfter: notAfter.toISOString(),
    isCA: true as const,
    publicKey: caKeyPair.publicKeyHex,
    fingerprint: caKeyPair.fingerprint,
  };

  const canonical = canonicalize(body);
  const signature = signPayload(canonical, caKeyPair.privateKeyPem);

  return { ...body, signature };
}

// ─── Leaf Certificate ───────────────────────────────────────────────────────

/**
 * Issue a leaf certificate signed by the CA.
 * Binds a subject's public key to an identity, endorsed by the CA.
 */
export function issueLeafCertificate(
  subject: string,
  role: string,
  subjectKeyPair: AttestorKeyPair,
  caKeyPair: AttestorKeyPair,
  caCert: CaCertificate,
  validityDays: number = 90,
): LeafCertificate {
  const now = new Date();
  const notAfter = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const certificateId = `leaf_${createHash('sha256').update(`${subject}:${subjectKeyPair.fingerprint}:${now.toISOString()}`).digest('hex').slice(0, 16)}`;

  const body = {
    version: '1.0' as const,
    type: 'attestor.leaf_certificate.v1' as const,
    certificateId,
    subject,
    role,
    notBefore: now.toISOString(),
    notAfter: notAfter.toISOString(),
    subjectPublicKey: subjectKeyPair.publicKeyHex,
    subjectFingerprint: subjectKeyPair.fingerprint,
    issuerFingerprint: caCert.fingerprint,
  };

  const canonical = canonicalize(body);
  const issuerSignature = signPayload(canonical, caKeyPair.privateKeyPem);

  return { ...body, issuerSignature };
}

// ─── Trust Chain Construction ───────────────────────────────────────────────

/**
 * Build a trust chain: CA cert + leaf cert together.
 */
export function buildTrustChain(
  caCert: CaCertificate,
  leafCert: LeafCertificate,
): TrustChain {
  return { version: '1.0', type: 'attestor.trust_chain.v1', ca: caCert, leaf: leafCert };
}

// ─── Chain Verification ─────────────────────────────────────────────────────

/**
 * Verify an entire trust chain given only the CA's public key PEM.
 *
 * This is the core third-party verification path:
 * an outsider with the CA's public key can verify the entire chain.
 */
export function verifyTrustChain(
  chain: TrustChain,
  caPublicKeyPem: string,
): ChainVerification {
  const now = new Date();

  // 1. Verify CA self-signature
  const { signature: caSig, ...caBody } = chain.ca;
  const caCanonical = canonicalize(caBody);
  const caValid = verifySignature(caCanonical, caSig, caPublicKeyPem);

  // 2. Verify CA fingerprint
  const caIdentity = derivePublicKeyIdentity(caPublicKeyPem);
  const caFpMatch = caIdentity.fingerprint === chain.ca.fingerprint;

  // 3. Check CA expiry
  const caExpired = now > new Date(chain.ca.notAfter) || now < new Date(chain.ca.notBefore);

  // 4. Verify leaf certificate — signed by the CA
  const { issuerSignature: leafSig, ...leafBody } = chain.leaf;
  const leafCanonical = canonicalize(leafBody);
  const leafValid = verifySignature(leafCanonical, leafSig, caPublicKeyPem);

  // 5. Verify issuer chain link — leaf's issuerFingerprint matches CA
  const issuerMatch = chain.leaf.issuerFingerprint === chain.ca.fingerprint;

  // 6. Check leaf expiry
  const leafExpired = now > new Date(chain.leaf.notAfter) || now < new Date(chain.leaf.notBefore);

  const chainIntact = caValid && caFpMatch && leafValid && issuerMatch;
  const overall = !chainIntact ? 'invalid' : (caExpired || leafExpired) ? 'expired' : 'valid';

  const explanation = overall === 'valid'
    ? `Trust chain verified: CA=${chain.ca.name}, subject=${chain.leaf.subject}, role=${chain.leaf.role}`
    : `Chain verification failed: ca_sig=${caValid}, ca_fp=${caFpMatch}, leaf_sig=${leafValid}, issuer=${issuerMatch}, ca_expired=${caExpired}, leaf_expired=${leafExpired}`;

  return { caValid: caValid && caFpMatch, leafValid, chainIntact, caExpired, leafExpired, issuerMatch, overall, explanation };
}

// ─── Convenience: Full PKI Setup ────────────────────────────────────────────

/**
 * Generate a complete PKI hierarchy: CA + runtime signer leaf + reviewer leaf.
 * Returns all key pairs and certificates for immediate use.
 */
export function generatePkiHierarchy(
  caName: string = 'Attestor Root CA',
  signerName: string = 'Runtime Signer',
  reviewerName: string = 'Reviewer',
): {
  ca: { keyPair: AttestorKeyPair; certificate: CaCertificate };
  signer: { keyPair: AttestorKeyPair; certificate: LeafCertificate };
  reviewer: { keyPair: AttestorKeyPair; certificate: LeafCertificate };
  chains: { signer: TrustChain; reviewer: TrustChain };
} {
  const caKeyPair = generateKeyPair();
  const caCert = createCaCertificate(caName, caKeyPair);

  const signerKeyPair = generateKeyPair();
  const signerCert = issueLeafCertificate(signerName, 'runtime_signer', signerKeyPair, caKeyPair, caCert);

  const reviewerKeyPair = generateKeyPair();
  const reviewerCert = issueLeafCertificate(reviewerName, 'reviewer', reviewerKeyPair, caKeyPair, caCert);

  return {
    ca: { keyPair: caKeyPair, certificate: caCert },
    signer: { keyPair: signerKeyPair, certificate: signerCert },
    reviewer: { keyPair: reviewerKeyPair, certificate: reviewerCert },
    chains: {
      signer: buildTrustChain(caCert, signerCert),
      reviewer: buildTrustChain(caCert, reviewerCert),
    },
  };
}
