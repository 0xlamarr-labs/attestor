/**
 * Attestor Attestation Certificate v1
 *
 * A portable, independently verifiable certificate that proves:
 * 1. WHO signed (Ed25519 public key identity)
 * 2. WHAT was decided (pass/fail/block/pending)
 * 3. HOW it was governed (authority chain summary)
 * 4. WHAT evidence anchors exist (hash chain roots/terminals)
 * 5. WHETHER execution was live or fixture-based
 * 6. WHEN it was issued
 *
 * Verification requires only the certificate JSON + the signer's public key.
 * No platform access, no database, no API call needed.
 *
 * Inspired by:
 * - C2PA (Content Credentials) — media provenance certificates
 * - SLSA / in-toto — software supply chain attestations
 * - Sigstore — keyless/keyed signing for artifacts
 *
 * But purpose-built for analytical outputs, not media or software builds.
 */

import { createHash } from 'node:crypto';
import { signPayload, verifySignature, canonicalize } from './sign.js';
import { derivePublicKeyIdentity } from './keys.js';
import type { AttestorKeyPair } from './keys.js';

// ─── Certificate Schema ──────────────────────────────────────────────────────

export interface AttestationCertificate {
  /** Schema version. */
  version: '1.0';
  /** Certificate type identifier. */
  type: 'attestor.certificate.v1';

  // ── Identity ──
  /** Unique certificate ID. */
  certificateId: string;
  /** ISO timestamp of issuance. */
  issuedAt: string;
  /** Run identity (deterministic, replay-stable). */
  runIdentity: string;

  // ── Decision ──
  /** Final pipeline decision. */
  decision: 'pass' | 'fail' | 'block' | 'pending_approval' | 'approved' | 'rejected' | 'warn';
  /** Human-readable decision summary. */
  decisionSummary: string;

  // ── Authority Chain ──
  authority: {
    /** Warrant status at finalization. */
    warrantStatus: string;
    /** Number of evidence obligations fulfilled. */
    obligationsFulfilled: number;
    /** Number of evidence obligations total. */
    obligationsTotal: number;
    /** Escrow release state. */
    escrowState: string;
    /** Receipt status. */
    receiptStatus: string;
    /** Capsule authority state. */
    capsuleAuthority: string;
  };

  // ── Evidence Anchors ──
  evidence: {
    /** Root hash of the evidence chain. */
    evidenceChainRoot: string;
    /** Terminal hash of the evidence chain. */
    evidenceChainTerminal: string;
    /** Whether the audit trail hash chain is intact. */
    auditChainIntact: boolean;
    /** Number of audit entries. */
    auditEntryCount: number;
    /** SQL query hash (for replay correlation). */
    sqlHash: string;
    /** Data snapshot hash (proves which data state was used). */
    snapshotHash: string;
  };

  // ── Governance Summary ──
  governance: {
    /** SQL governance result. */
    sqlGovernance: 'pass' | 'fail';
    /** Policy result. */
    policy: 'pass' | 'fail';
    /** Guardrails result. */
    guardrails: 'pass' | 'fail';
    /** Data contracts result. */
    dataContracts: 'pass' | 'fail' | 'warn' | 'skip';
    /** Number of scorers that ran. */
    scorersRun: number;
    /** Whether review was required. */
    reviewRequired: boolean;
  };

  // ── Live Proof ──
  liveProof: {
    /** Proof mode: offline_fixture | live_model | live_runtime | hybrid */
    mode: string;
    /** Whether upstream (model) was live. */
    upstreamLive: boolean;
    /** Whether execution was live. */
    executionLive: boolean;
    /** Whether proof is internally consistent. */
    consistent: boolean;
  };

  // ── Signing ──
  signing: {
    /** Signing algorithm. */
    algorithm: 'ed25519';
    /** Public key of the signer (hex-encoded, 32 bytes). */
    publicKey: string;
    /** Key fingerprint (truncated SHA-256 of SPKI DER). */
    fingerprint: string;
    /** Signature over the canonicalized certificate body (hex-encoded, 64 bytes). */
    signature: string;
  };
}

/** The certificate body that gets signed (everything except the signing section). */
export type CertificateBody = Omit<AttestationCertificate, 'signing'>;

// ─── Certificate Issuance ────────────────────────────────────────────────────

export interface CertificateInput {
  runIdentity: string;
  decision: AttestationCertificate['decision'];
  decisionSummary: string;
  warrant: { status: string; obligationsFulfilled: number; obligationsTotal: number };
  escrow: { state: string };
  receipt: { status: string };
  capsule: { authority: string };
  evidenceChainRoot: string;
  evidenceChainTerminal: string;
  auditChainIntact: boolean;
  auditEntryCount: number;
  sqlHash: string;
  snapshotHash: string;
  sqlGovernance: 'pass' | 'fail';
  policy: 'pass' | 'fail';
  guardrails: 'pass' | 'fail';
  dataContracts: 'pass' | 'fail' | 'warn' | 'skip';
  scorersRun: number;
  reviewRequired: boolean;
  liveProofMode: string;
  upstreamLive: boolean;
  executionLive: boolean;
  liveProofConsistent: boolean;
}

/**
 * Issue a signed attestation certificate.
 */
export function issueCertificate(
  input: CertificateInput,
  keyPair: AttestorKeyPair,
): AttestationCertificate {
  const certificateId = `cert_${createHash('sha256').update(`${input.runIdentity}:${input.evidenceChainTerminal}:${Date.now()}`).digest('hex').slice(0, 16)}`;

  const body: CertificateBody = {
    version: '1.0',
    type: 'attestor.certificate.v1',
    certificateId,
    issuedAt: new Date().toISOString(),
    runIdentity: input.runIdentity,
    decision: input.decision,
    decisionSummary: input.decisionSummary,
    authority: {
      warrantStatus: input.warrant.status,
      obligationsFulfilled: input.warrant.obligationsFulfilled,
      obligationsTotal: input.warrant.obligationsTotal,
      escrowState: input.escrow.state,
      receiptStatus: input.receipt.status,
      capsuleAuthority: input.capsule.authority,
    },
    evidence: {
      evidenceChainRoot: input.evidenceChainRoot,
      evidenceChainTerminal: input.evidenceChainTerminal,
      auditChainIntact: input.auditChainIntact,
      auditEntryCount: input.auditEntryCount,
      sqlHash: input.sqlHash,
      snapshotHash: input.snapshotHash,
    },
    governance: {
      sqlGovernance: input.sqlGovernance,
      policy: input.policy,
      guardrails: input.guardrails,
      dataContracts: input.dataContracts,
      scorersRun: input.scorersRun,
      reviewRequired: input.reviewRequired,
    },
    liveProof: {
      mode: input.liveProofMode,
      upstreamLive: input.upstreamLive,
      executionLive: input.executionLive,
      consistent: input.liveProofConsistent,
    },
  };

  const canonical = canonicalize(body);
  const signature = signPayload(canonical, keyPair.privateKeyPem);

  return {
    ...body,
    signing: {
      algorithm: 'ed25519',
      publicKey: keyPair.publicKeyHex,
      fingerprint: keyPair.fingerprint,
      signature,
    },
  };
}

// ─── Certificate Verification ────────────────────────────────────────────────

export interface CertificateVerification {
  /** Is the signature cryptographically valid? */
  signatureValid: boolean;
  /** Does the signing public key match the claimed fingerprint? */
  fingerprintConsistent: boolean;
  /** Is the certificate schema valid? */
  schemaValid: boolean;
  /** Overall result. */
  overall: 'valid' | 'invalid' | 'schema_error';
  /** Human-readable explanation. */
  explanation: string;
}

/**
 * Verify an attestation certificate.
 *
 * Requires only the certificate JSON and the signer's public key PEM.
 * No platform access needed — this is the core third-party verification path.
 */
export function verifyCertificate(
  certificate: AttestationCertificate,
  publicKeyPem: string,
): CertificateVerification {
  // Schema validation
  if (certificate.version !== '1.0' || certificate.type !== 'attestor.certificate.v1') {
    return { signatureValid: false, fingerprintConsistent: false, schemaValid: false, overall: 'schema_error', explanation: `Unknown certificate version=${certificate.version} type=${certificate.type}` };
  }

  if (!certificate.signing?.algorithm || certificate.signing.algorithm !== 'ed25519') {
    return { signatureValid: false, fingerprintConsistent: false, schemaValid: false, overall: 'schema_error', explanation: `Unsupported algorithm: ${certificate.signing?.algorithm}` };
  }

  const schemaValid = !!(certificate.certificateId && certificate.runIdentity && certificate.decision && certificate.signing.signature);

  // Fingerprint consistency
  const derived = derivePublicKeyIdentity(publicKeyPem);
  const fingerprintConsistent = derived.fingerprint === certificate.signing.fingerprint;

  // Signature verification: reconstruct the body (everything except signing) and verify
  const { signing: _signing, ...body } = certificate;
  const canonical = canonicalize(body);
  const signatureValid = verifySignature(canonical, certificate.signing.signature, publicKeyPem);

  const overall = signatureValid && fingerprintConsistent && schemaValid ? 'valid' : 'invalid';
  const explanation = overall === 'valid'
    ? `Certificate ${certificate.certificateId} is valid. Signed by ${certificate.signing.fingerprint} using Ed25519. Decision: ${certificate.decision}.`
    : `Certificate verification failed: signature=${signatureValid}, fingerprint=${fingerprintConsistent}, schema=${schemaValid}`;

  return { signatureValid, fingerprintConsistent, schemaValid, overall, explanation };
}
