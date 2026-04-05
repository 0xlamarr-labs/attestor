/**
 * Canonical Artifact Hashing v1.
 *
 * Produces stable, deterministic hashes of runtime artifacts.
 * Excludes known-unstable fields (timestamps, generatedAt) explicitly.
 *
 * Exclusion policy:
 * - timestamp/generatedAt: differs between runs even with same inputs
 * - durationMs: non-deterministic timing
 * All other fields are included in the canonical hash.
 */

import { createHash } from 'node:crypto';
import type { OutputPack, DecisionDossier } from './types.js';

function h(data: string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/** Fields excluded from canonical hashing (non-deterministic or run-instance-specific). */
const EXCLUDED_FIELDS = new Set(['generatedAt', 'timestamp', 'durationMs', 'issuedAt', 'snapshotId', 'runId', 'runIdentity']);

/**
 * Canonicalize an object by removing non-deterministic fields
 * and sorting keys for stable JSON serialization.
 */
function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, (key, value) => {
    if (EXCLUDED_FIELDS.has(key)) return undefined;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
}

/** Canonical hash of an output pack (excludes generatedAt). */
export function canonicalOutputPackHash(pack: OutputPack): string {
  return h(canonicalize(pack));
}

/** Canonical hash of a decision dossier (excludes generatedAt). */
export function canonicalDossierHash(dossier: DecisionDossier): string {
  return h(canonicalize(dossier));
}

/** Generic canonical hash for any artifact. */
export function canonicalHash(artifact: unknown): string {
  return h(canonicalize(artifact));
}
