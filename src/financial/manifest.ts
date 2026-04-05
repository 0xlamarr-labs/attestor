/**
 * Run Manifest v2 — Full canonical artifact hashing.
 *
 * v2 fix: hashes full canonical output pack and dossier (not summary subsets).
 * Uses canonical.ts for stable, deterministic hashing with documented exclusions.
 */

import type { RunManifest, FinancialDecision, AuditTrail, LineageEvidence, LiveProofMetadata, OutputPack, DecisionDossier } from './types.js';
import { canonicalOutputPackHash, canonicalDossierHash } from './canonical.js';

export function buildRunManifest(
  runId: string,
  decision: FinancialDecision,
  audit: AuditTrail,
  lineage: LineageEvidence,
  outputPack: OutputPack | null,
  dossier: DecisionDossier | null,
  liveProof: LiveProofMetadata,
  receiptStatus?: string,
  receiptId?: string,
  evidenceChainTerminal?: string,
  capsuleId?: string,
  capsuleAuthorityState?: string,
): RunManifest {
  return {
    runId,
    timestamp: new Date().toISOString(),
    decision,
    artifacts: {
      runReport: { present: true },
      outputPack: {
        present: outputPack !== null,
        hash: outputPack ? canonicalOutputPackHash(outputPack) : null,
      },
      dossier: {
        present: dossier !== null,
        hash: dossier ? canonicalDossierHash(dossier) : null,
      },
      auditTrail: {
        entries: audit.entries.length,
        chainIntact: audit.chainIntact,
        lastHash: audit.entries.length > 0 ? audit.entries[audit.entries.length - 1].evidenceHash : null,
      },
      lineage: {
        inputs: lineage.inputs.length,
        outputs: lineage.outputs.length,
        provenanceComplete: lineage.provenanceComplete,
      },
    },
    liveProof,
    receipt: receiptId ? { receiptId, status: receiptStatus ?? 'unknown' } : null,
    capsule: capsuleId ? { capsuleId, authorityState: capsuleAuthorityState ?? 'unknown' } : null,
    evidenceChainTerminal: evidenceChainTerminal ?? null,
  };
}
