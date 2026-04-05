/**
 * Financial Audit Trail v2 — Tamper-evident evidence chain.
 *
 * Every stage of the financial pipeline appends an entry to the audit trail.
 * Each entry contains:
 * - a monotonic sequence number
 * - a timestamp
 * - the stage and action
 * - an evidence category
 * - a truncated SHA-256 evidence hash (16 hex chars = 64 bits)
 * - a hash chain link to the previous entry
 *
 * Hash truncation note:
 * Hashes are truncated to 16 hex chars (64 bits) for compact representation.
 * This is sufficient for tamper evidence in an audit context (collision probability
 * is negligible for typical audit trail sizes) but is NOT cryptographically
 * equivalent to full 256-bit SHA-256. For production regulatory use, consider
 * using full-length hashes.
 *
 * v2 improvements over v1:
 * - Evidence category classification (governance, execution, validation, decision, oversight, lifecycle)
 * - Correct finalization order (finalize only after all entries appended)
 * - Honest hash-length documentation
 * - Human oversight entries
 *
 * Inspired by immudb / Merkle-tree audit patterns.
 */

import { createHash } from 'node:crypto';
import type { AuditEntry, AuditTrail, AuditCategory } from './types.js';

/** Truncated SHA-256 (16 hex chars). See module doc for truncation rationale. */
function sha256t(data: string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Create a new empty audit trail for a financial run.
 */
export function createAuditTrail(runId: string): AuditTrail {
  return {
    runId,
    entries: [],
    chainIntact: true,
  };
}

/**
 * Append an entry to the audit trail.
 * The entry is hash-chained to the previous entry for tamper evidence.
 */
export function appendAuditEntry(
  trail: AuditTrail,
  stage: string,
  action: string,
  category: AuditCategory,
  detail: Record<string, unknown>,
): AuditEntry {
  const seq = trail.entries.length;
  const previousHash = seq > 0
    ? trail.entries[seq - 1].evidenceHash
    : sha256t(`genesis:${trail.runId}`);

  const evidencePayload = JSON.stringify({ seq, stage, action, category, detail, previousHash });
  const evidenceHash = sha256t(evidencePayload);

  const entry: AuditEntry = {
    seq,
    timestamp: new Date().toISOString(),
    stage,
    action,
    category,
    evidenceHash,
    previousHash,
    detail,
  };

  trail.entries.push(entry);
  return entry;
}

/**
 * Verify the integrity of an audit trail's hash chain.
 * Returns true if the chain is intact (no entries modified or removed).
 */
export function verifyAuditChain(trail: AuditTrail): boolean {
  if (trail.entries.length === 0) return true;

  const genesisHash = sha256t(`genesis:${trail.runId}`);

  for (let i = 0; i < trail.entries.length; i++) {
    const entry = trail.entries[i];

    if (entry.seq !== i) return false;

    const expectedPrevious = i === 0
      ? genesisHash
      : trail.entries[i - 1].evidenceHash;

    if (entry.previousHash !== expectedPrevious) return false;

    const payload = JSON.stringify({
      seq: entry.seq,
      stage: entry.stage,
      action: entry.action,
      category: entry.category,
      detail: entry.detail,
      previousHash: entry.previousHash,
    });
    const recomputedHash = sha256t(payload);
    if (entry.evidenceHash !== recomputedHash) return false;
  }

  return true;
}

/**
 * Finalize the audit trail by verifying chain integrity.
 *
 * IMPORTANT: Call this ONLY after all entries have been appended.
 * Appending entries after finalization will not be reflected in chainIntact.
 */
export function finalizeAuditTrail(trail: AuditTrail): AuditTrail {
  trail.chainIntact = verifyAuditChain(trail);
  return trail;
}
