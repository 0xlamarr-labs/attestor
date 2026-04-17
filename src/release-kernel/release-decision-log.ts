import { createHash, randomUUID } from 'node:crypto';
import type { ReleaseDecision } from './object-model.js';

/**
 * Immutable release decision logging.
 *
 * The log is append-only and hash-linked so later audit and evidence export
 * can prove whether entries were removed, rewritten, or reordered.
 */

export const RELEASE_DECISION_LOG_SPEC_VERSION = 'attestor.release-decision-log.v1';

export type ReleaseDecisionLogPhase =
  | 'policy-resolution'
  | 'deterministic-checks'
  | 'review'
  | 'override'
  | 'evidence-pack'
  | 'terminal-accept'
  | 'terminal-deny';

export interface ReleaseDecisionLogMetadata {
  readonly policyMatched: boolean;
  readonly pendingChecks: readonly string[];
  readonly pendingEvidenceKinds: readonly string[];
  readonly requiresReview: boolean;
  readonly deterministicChecksCompleted: boolean;
  readonly effectivePolicyId: string | null;
  readonly rolloutMode: string | null;
  readonly rolloutEvaluationMode: string | null;
  readonly rolloutReason: string | null;
  readonly rolloutCanaryBucket: number | null;
  readonly rolloutFallbackPolicyId: string | null;
}

export interface ReleaseDecisionLogEntry {
  readonly version: typeof RELEASE_DECISION_LOG_SPEC_VERSION;
  readonly entryId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly requestId: string;
  readonly phase: ReleaseDecisionLogPhase;
  readonly matchedPolicyId: string | null;
  readonly decisionId: string;
  readonly decisionStatus: ReleaseDecision['status'];
  readonly decisionDigest: string;
  readonly findingsDigest: string;
  readonly previousEntryDigest: string | null;
  readonly metadata: ReleaseDecisionLogMetadata;
  readonly entryDigest: string;
}

export interface ReleaseDecisionLogAppendInput {
  readonly occurredAt: string;
  readonly requestId: string;
  readonly phase: ReleaseDecisionLogPhase;
  readonly matchedPolicyId: string | null;
  readonly decision: ReleaseDecision;
  readonly metadata: ReleaseDecisionLogMetadata;
}

export interface ReleaseDecisionLogVerificationResult {
  readonly valid: boolean;
  readonly verifiedEntries: number;
  readonly brokenEntryId: string | null;
}

export interface ReleaseDecisionLogWriter {
  append(input: ReleaseDecisionLogAppendInput): ReleaseDecisionLogEntry;
  entries(): readonly ReleaseDecisionLogEntry[];
  latestEntryDigest(): string | null;
  verify(): ReleaseDecisionLogVerificationResult;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function digestDecision(decision: ReleaseDecision): string {
  return sha256Hex(
    JSON.stringify({
      version: decision.version,
      id: decision.id,
      status: decision.status,
      policyVersion: decision.policyVersion,
      policyHash: decision.policyHash,
      outputHash: decision.outputHash,
      consequenceHash: decision.consequenceHash,
      consequenceType: decision.consequenceType,
      riskClass: decision.riskClass,
      reviewAuthority: decision.reviewAuthority,
      releaseConditions: decision.releaseConditions,
    }),
  );
}

function digestFindings(decision: ReleaseDecision): string {
  return sha256Hex(JSON.stringify(decision.findings));
}

function computeEntryDigest(entry: Omit<ReleaseDecisionLogEntry, 'entryDigest'>): string {
  return sha256Hex(
    JSON.stringify({
      version: entry.version,
      entryId: entry.entryId,
      sequence: entry.sequence,
      occurredAt: entry.occurredAt,
      requestId: entry.requestId,
      phase: entry.phase,
      matchedPolicyId: entry.matchedPolicyId,
      decisionId: entry.decisionId,
      decisionStatus: entry.decisionStatus,
      decisionDigest: entry.decisionDigest,
      findingsDigest: entry.findingsDigest,
      previousEntryDigest: entry.previousEntryDigest,
      metadata: entry.metadata,
    }),
  );
}

function snapshotMetadata(metadata: ReleaseDecisionLogMetadata): ReleaseDecisionLogMetadata {
  return Object.freeze({
    policyMatched: metadata.policyMatched,
    pendingChecks: Object.freeze([...metadata.pendingChecks]),
    pendingEvidenceKinds: Object.freeze([...metadata.pendingEvidenceKinds]),
    requiresReview: metadata.requiresReview,
    deterministicChecksCompleted: metadata.deterministicChecksCompleted,
    effectivePolicyId: metadata.effectivePolicyId,
    rolloutMode: metadata.rolloutMode,
    rolloutEvaluationMode: metadata.rolloutEvaluationMode,
    rolloutReason: metadata.rolloutReason,
    rolloutCanaryBucket: metadata.rolloutCanaryBucket,
    rolloutFallbackPolicyId: metadata.rolloutFallbackPolicyId,
  });
}

export function createReleaseDecisionLogEntry(
  input: ReleaseDecisionLogAppendInput,
  sequence: number,
  previousEntryDigest: string | null,
): ReleaseDecisionLogEntry {
  const metadata = snapshotMetadata(input.metadata);
  const base: Omit<ReleaseDecisionLogEntry, 'entryDigest'> = {
    version: RELEASE_DECISION_LOG_SPEC_VERSION,
    entryId: randomUUID(),
    sequence,
    occurredAt: input.occurredAt,
    requestId: input.requestId,
    phase: input.phase,
    matchedPolicyId: input.matchedPolicyId,
    decisionId: input.decision.id,
    decisionStatus: input.decision.status,
    decisionDigest: digestDecision(input.decision),
    findingsDigest: digestFindings(input.decision),
    previousEntryDigest,
    metadata,
  };

  return Object.freeze({
    ...base,
    entryDigest: computeEntryDigest(base),
  });
}

export function verifyReleaseDecisionLogChain(
  entries: readonly ReleaseDecisionLogEntry[],
): ReleaseDecisionLogVerificationResult {
  let previousDigest: string | null = null;
  let expectedSequence = 1;

  for (const entry of entries) {
    const expectedDigest = computeEntryDigest({
      version: entry.version,
      entryId: entry.entryId,
      sequence: entry.sequence,
      occurredAt: entry.occurredAt,
      requestId: entry.requestId,
      phase: entry.phase,
      matchedPolicyId: entry.matchedPolicyId,
      decisionId: entry.decisionId,
      decisionStatus: entry.decisionStatus,
      decisionDigest: entry.decisionDigest,
      findingsDigest: entry.findingsDigest,
      previousEntryDigest: entry.previousEntryDigest,
      metadata: entry.metadata,
    });

    if (
      entry.sequence !== expectedSequence ||
      entry.previousEntryDigest !== previousDigest ||
      entry.entryDigest !== expectedDigest
    ) {
      return {
        valid: false,
        verifiedEntries: expectedSequence - 1,
        brokenEntryId: entry.entryId,
      };
    }

    previousDigest = entry.entryDigest;
    expectedSequence += 1;
  }

  return {
    valid: true,
    verifiedEntries: entries.length,
    brokenEntryId: null,
  };
}

export function createInMemoryReleaseDecisionLogWriter(): ReleaseDecisionLogWriter {
  const entries: ReleaseDecisionLogEntry[] = [];

  return {
    append(input: ReleaseDecisionLogAppendInput): ReleaseDecisionLogEntry {
      const entry = createReleaseDecisionLogEntry(
        input,
        entries.length + 1,
        entries.at(-1)?.entryDigest ?? null,
      );
      entries.push(entry);
      return entry;
    },
    entries(): readonly ReleaseDecisionLogEntry[] {
      return [...entries];
    },
    latestEntryDigest(): string | null {
      return entries.at(-1)?.entryDigest ?? null;
    },
    verify(): ReleaseDecisionLogVerificationResult {
      return verifyReleaseDecisionLogChain(entries);
    },
  };
}
