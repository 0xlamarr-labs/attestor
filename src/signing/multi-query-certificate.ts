/**
 * Multi-Query Attestation Certificate
 *
 * A portable, independently verifiable certificate for a governed multi-query run.
 * Covers the aggregate decision and per-unit evidence anchors.
 *
 * This is the multi-query equivalent of AttestationCertificate.
 * The single-query certificate proves one governed query.
 * The multi-query certificate proves N governed queries with aggregate truth.
 */

import { createHash } from 'node:crypto';
import { signPayload, verifySignature, canonicalize } from './sign.js';
import { derivePublicKeyIdentity } from './keys.js';
import type { AttestorKeyPair } from './keys.js';
import type { MultiQueryRunReport } from '../financial/multi-query-pipeline.js';

// ─── Certificate Schema ─────────────────────────────────────────────────────

export interface MultiQueryCertificate {
  version: '1.0';
  type: 'attestor.certificate.multi_query.v1';

  certificateId: string;
  issuedAt: string;
  runId: string;

  /** Aggregate decision across all units. */
  aggregateDecision: string;
  decisionSummary: string;

  unitCount: number;

  /** Per-unit evidence anchors. */
  unitAnchors: {
    unitId: string;
    decision: string;
    evidenceChainTerminal: string;
  }[];

  /** Aggregate governance. */
  governance: {
    sufficient: boolean;
    sqlPassCount: number;
    policyPassCount: number;
    guardrailsPassCount: number;
    totalUnits: number;
  };

  /** Decision breakdown. */
  decisionBreakdown: {
    pass: number;
    fail: number;
    block: number;
    pending_approval: number;
  };

  /** Aggregate proof. */
  proof: {
    aggregateMode: string;
    allUnitsLive: boolean;
    hasProofGaps: boolean;
  };

  /** Evidence anchors. */
  evidence: {
    multiQueryHash: string;
    totalAuditEntries: number;
    allAuditChainsIntact: boolean;
  };

  /** Signing section. */
  signing: {
    algorithm: 'ed25519';
    publicKey: string;
    fingerprint: string;
    signature: string;
  };
}

export type MultiQueryCertificateBody = Omit<MultiQueryCertificate, 'signing'>;

// ─── Issuance ───────────────────────────────────────────────────────────────

export function issueMultiQueryCertificate(
  report: MultiQueryRunReport,
  keyPair: AttestorKeyPair,
): MultiQueryCertificate {
  const certificateId = `mqcert_${createHash('sha256').update(`${report.runId}:${report.multiQueryHash}:${Date.now()}`).digest('hex').slice(0, 16)}`;

  const decisionSummary = `${report.unitCount} units: ${report.decisionBreakdown.pass} pass, ${report.decisionBreakdown.fail} fail, ${report.decisionBreakdown.block} block, ${report.decisionBreakdown.pending_approval} pending. Governance: ${report.governanceSufficiency.sufficient ? 'sufficient' : 'insufficient'}.`;

  const unitAnchors = report.units.map(u => ({
    unitId: u.unitId,
    decision: u.decision,
    evidenceChainTerminal: u.evidenceChainTerminal,
  }));

  const body: MultiQueryCertificateBody = {
    version: '1.0',
    type: 'attestor.certificate.multi_query.v1',
    certificateId,
    issuedAt: new Date().toISOString(),
    runId: report.runId,
    aggregateDecision: report.aggregateDecision,
    decisionSummary,
    unitCount: report.unitCount,
    unitAnchors,
    governance: report.governanceSufficiency,
    decisionBreakdown: report.decisionBreakdown,
    proof: {
      aggregateMode: report.aggregateProofMode,
      allUnitsLive: report.allUnitsLive,
      hasProofGaps: report.hasProofGaps,
    },
    evidence: {
      multiQueryHash: report.multiQueryHash,
      totalAuditEntries: report.totalAuditEntries,
      allAuditChainsIntact: report.allAuditChainsIntact,
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

// ─── Verification ───────────────────────────────────────────────────────────

export interface MultiQueryCertificateVerification {
  signatureValid: boolean;
  fingerprintConsistent: boolean;
  schemaValid: boolean;
  overall: 'valid' | 'invalid' | 'schema_error';
  explanation: string;
}

export function verifyMultiQueryCertificate(
  certificate: MultiQueryCertificate,
  publicKeyPem: string,
): MultiQueryCertificateVerification {
  if (certificate.version !== '1.0' || certificate.type !== 'attestor.certificate.multi_query.v1') {
    return { signatureValid: false, fingerprintConsistent: false, schemaValid: false, overall: 'schema_error', explanation: `Unknown certificate version=${certificate.version} type=${certificate.type}` };
  }

  const schemaValid = !!(certificate.certificateId && certificate.runId && certificate.aggregateDecision && certificate.signing?.signature);

  const derived = derivePublicKeyIdentity(publicKeyPem);
  const fingerprintConsistent = derived.fingerprint === certificate.signing.fingerprint;

  const { signing: _signing, ...body } = certificate;
  const canonical = canonicalize(body);
  const signatureValid = verifySignature(canonical, certificate.signing.signature, publicKeyPem);

  const overall = schemaValid && signatureValid && fingerprintConsistent ? 'valid' : !schemaValid ? 'schema_error' : 'invalid';

  return {
    signatureValid,
    fingerprintConsistent,
    schemaValid,
    overall,
    explanation: overall === 'valid'
      ? `Multi-query certificate verified: ${certificate.unitCount} units, aggregate=${certificate.aggregateDecision}`
      : `Verification failed: schema=${schemaValid}, sig=${signatureValid}, fp=${fingerprintConsistent}`,
  };
}
