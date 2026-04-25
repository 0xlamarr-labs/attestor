/**
 * Evidence Attestation Pack v1.1 — Structured verification results.
 *
 * Verification sub-results:
 * - chain_linkage: evidence chain links are internally consistent
 * - canonical_artifacts: manifest hashes match recomputed canonical hashes
 * - signature: HMAC-SHA256 verified (null if unsigned)
 * - overall: combined result
 *
 * Trust model:
 * - unsigned: all evidence is internally linked, no external attestation
 * - hmac_sha256: HMAC proves integrity to anyone with the shared key;
 *   does NOT prove identity (no asymmetric key, no PKI, no KMS)
 * - future: asymmetric signing / Sigstore / KMS is not yet implemented
 */

import { createHmac } from 'node:crypto';
import type { FinancialRunReport, VerificationSubResults } from './types.js';
import { verifyLiveProof } from './types.js';
import { canonicalOutputPackHash, canonicalDossierHash } from './canonical.js';
import { verifyEvidenceChain } from './evidence-chain.js';

export interface AttestationPack {
  version: '1.1';
  issuedAt: string;
  runId: string;
  replayIdentity: string;
  snapshotHash: string;
  decision: string;
  artifactHashes: {
    outputPack: string | null;
    dossier: string | null;
    evidenceChainTerminal: string;
    auditChainIntact: boolean;
    sqlHash: string;
    schemaHash: string | null;
  };
  evidenceChainRoot: string;
  evidenceChainTerminal: string;
  liveProof: {
    mode: string;
    upstreamLive: boolean;
    executionLive: boolean;
    gapCategories: string[];
    consistent: boolean;
  };
  verification: VerificationSubResults;
  filingReadiness: string;
  signatureMode: 'unsigned' | 'hmac_sha256';
  signature: string | null;
  trustModel: string;
}

/**
 * Build a v1.1 attestation pack with structured verification.
 */
export function buildAttestationPack(
  report: FinancialRunReport,
  signingKey?: string,
): AttestationPack {
  const outputPackHash = report.outputPack ? canonicalOutputPackHash(report.outputPack) : null;
  const dossierHash = report.dossier ? canonicalDossierHash(report.dossier) : null;

  // Verification sub-results
  const chainLinkage = verifyEvidenceChain(report.evidenceChain);

  // Canonical artifact verification: check manifest hashes match recomputed
  const manifestPackHash = report.manifest?.artifacts.outputPack.hash ?? null;
  const manifestDossierHash = report.manifest?.artifacts.dossier.hash ?? null;
  const packMatch = outputPackHash !== null && manifestPackHash !== null && outputPackHash === manifestPackHash;
  const dossierMatch = dossierHash !== null && manifestDossierHash !== null && dossierHash === manifestDossierHash;
  const canonicalArtifacts = packMatch && dossierMatch;

  const signed = !!signingKey;
  const trustModel = signed
    ? 'HMAC-SHA256 shared-key integrity. Proves content has not been modified by anyone without the key. Does NOT prove signer identity (no PKI/KMS). Suitable for internal audit; external attestation requires asymmetric signing.'
    : 'Unsigned. All evidence is internally linked via hash chains but not externally attested. Suitable for internal review. External trust requires signing.';

  let overall: VerificationSubResults['overall'];
  if (chainLinkage && canonicalArtifacts) {
    overall = signed ? 'passed' : 'unsigned';
  } else if (chainLinkage || canonicalArtifacts) {
    overall = 'partial';
  } else {
    overall = 'failed';
  }

  const verification: VerificationSubResults = {
    chainLinkage,
    canonicalArtifacts,
    signatureVerified: null, // filled after signing
    overall,
    trustModel,
  };

  const body = {
    version: '1.1' as const,
    issuedAt: new Date().toISOString(),
    runId: report.runId,
    replayIdentity: report.replayMetadata.replayIdentity,
    snapshotHash: report.snapshot.snapshotHash,
    decision: report.decision,
    artifactHashes: {
      outputPack: outputPackHash,
      dossier: dossierHash,
      evidenceChainTerminal: report.evidenceChain.terminalHash,
      auditChainIntact: report.audit.chainIntact,
      sqlHash: report.sqlGovernance.sqlHash,
      schemaHash: report.execution?.schemaHash ?? null,
    },
    evidenceChainRoot: report.evidenceChain.rootHash,
    evidenceChainTerminal: report.evidenceChain.terminalHash,
    liveProof: {
      mode: report.liveProof.mode,
      upstreamLive: report.liveProof.upstream.live,
      executionLive: report.liveProof.execution.live,
      gapCategories: report.liveProof.gaps.map((gap) => gap.category),
      consistent: verifyLiveProof(report.liveProof),
    },
    verification,
    filingReadiness: report.filingReadiness.status,
    trustModel,
  };

  if (signingKey) {
    const canonical = JSON.stringify(body, Object.keys(body).sort());
    const signature = createHmac('sha256', signingKey).update(canonical).digest('hex');
    return { ...body, signatureMode: 'hmac_sha256', signature, verification: { ...verification, signatureVerified: true } };
  }

  return { ...body, signatureMode: 'unsigned', signature: null };
}

/**
 * Verify an attestation pack.
 * Returns structured sub-results matching the attestation's own verification schema.
 */
export function verifyAttestation(pack: AttestationPack, signingKey?: string): VerificationSubResults {
  let signatureVerified: boolean | null = null;

  if (pack.signatureMode === 'hmac_sha256') {
    if (!signingKey || !pack.signature) {
      signatureVerified = false;
    } else {
      // Reconstruct the body that was signed: the build function signs body before
      // adding signatureMode/signature and before setting signatureVerified to true.
      // So we reconstruct with signatureVerified: null.
      const { signature: _sig, signatureMode: _mode, ...rest } = pack;
      const body = { ...rest, verification: { ...rest.verification, signatureVerified: null } };
      const canonical = JSON.stringify(body, Object.keys(body).sort());
      const expected = createHmac('sha256', signingKey).update(canonical).digest('hex');
      signatureVerified = expected === pack.signature;
    }
  }

  const chainLinkage = pack.verification.chainLinkage;
  const canonicalArtifacts = pack.verification.canonicalArtifacts;

  let overall: VerificationSubResults['overall'];
  if (chainLinkage && canonicalArtifacts && (signatureVerified === true || signatureVerified === null)) {
    overall = pack.signatureMode === 'unsigned' ? 'unsigned' : (signatureVerified ? 'passed' : 'failed');
  } else {
    overall = 'failed';
  }

  return {
    chainLinkage,
    canonicalArtifacts,
    signatureVerified,
    overall,
    trustModel: pack.trustModel,
  };
}
