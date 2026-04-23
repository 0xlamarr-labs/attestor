import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { withFileLock } from '../platform/file-store.js';
import type { ReleaseDecision } from './object-model.js';
import { RELEASE_DECISION_STATUSES, type ReleaseDecisionStatus } from './types.js';

/**
 * Immutable release decision logging.
 *
 * The log is append-only and hash-linked so later audit and evidence export
 * can prove whether entries were removed, rewritten, or reordered.
 */

export const RELEASE_DECISION_LOG_SPEC_VERSION = 'attestor.release-decision-log.v1';
export const ATTESTOR_RELEASE_DECISION_LOG_PATH_ENV = 'ATTESTOR_RELEASE_DECISION_LOG_PATH';

const DEFAULT_RELEASE_DECISION_LOG_PATH = '.attestor/release-decision-log.jsonl';

const RELEASE_DECISION_LOG_PHASES = Object.freeze([
  'policy-resolution',
  'deterministic-checks',
  'review',
  'override',
  'evidence-pack',
  'terminal-accept',
  'terminal-deny',
] as const);

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

export interface CreateFileBackedReleaseDecisionLogWriterInput {
  readonly path?: string;
}

export class ReleaseDecisionLogStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseDecisionLogStoreError';
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string, lineNumber: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireNullableString(value: unknown, fieldName: string, lineNumber: number): string | null {
  if (value === null) return null;
  return requireString(value, fieldName, lineNumber);
}

function requireNumber(value: unknown, fieldName: string, lineNumber: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, fieldName: string, lineNumber: number): boolean {
  if (typeof value !== 'boolean') {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireNullableNumber(value: unknown, fieldName: string, lineNumber: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireStringArray(value: unknown, fieldName: string, lineNumber: number): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has invalid ${fieldName}.`,
    );
  }
  return Object.freeze([...value]);
}

function requirePhase(value: unknown, lineNumber: number): ReleaseDecisionLogPhase {
  if (
    typeof value !== 'string' ||
    !RELEASE_DECISION_LOG_PHASES.includes(value as ReleaseDecisionLogPhase)
  ) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has invalid phase.`,
    );
  }
  return value as ReleaseDecisionLogPhase;
}

function requireDecisionStatus(value: unknown, lineNumber: number): ReleaseDecisionStatus {
  if (
    typeof value !== 'string' ||
    !RELEASE_DECISION_STATUSES.includes(value as ReleaseDecisionStatus)
  ) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has invalid decisionStatus.`,
    );
  }
  return value as ReleaseDecisionStatus;
}

function normalizeLoadedMetadata(
  value: unknown,
  lineNumber: number,
): ReleaseDecisionLogMetadata {
  if (!isRecord(value)) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has invalid metadata.`,
    );
  }
  return snapshotMetadata({
    policyMatched: requireBoolean(value.policyMatched, 'metadata.policyMatched', lineNumber),
    pendingChecks: requireStringArray(value.pendingChecks, 'metadata.pendingChecks', lineNumber),
    pendingEvidenceKinds: requireStringArray(
      value.pendingEvidenceKinds,
      'metadata.pendingEvidenceKinds',
      lineNumber,
    ),
    requiresReview: requireBoolean(value.requiresReview, 'metadata.requiresReview', lineNumber),
    deterministicChecksCompleted: requireBoolean(
      value.deterministicChecksCompleted,
      'metadata.deterministicChecksCompleted',
      lineNumber,
    ),
    effectivePolicyId: requireNullableString(
      value.effectivePolicyId,
      'metadata.effectivePolicyId',
      lineNumber,
    ),
    rolloutMode: requireNullableString(value.rolloutMode, 'metadata.rolloutMode', lineNumber),
    rolloutEvaluationMode: requireNullableString(
      value.rolloutEvaluationMode,
      'metadata.rolloutEvaluationMode',
      lineNumber,
    ),
    rolloutReason: requireNullableString(value.rolloutReason, 'metadata.rolloutReason', lineNumber),
    rolloutCanaryBucket: requireNullableNumber(
      value.rolloutCanaryBucket,
      'metadata.rolloutCanaryBucket',
      lineNumber,
    ),
    rolloutFallbackPolicyId: requireNullableString(
      value.rolloutFallbackPolicyId,
      'metadata.rolloutFallbackPolicyId',
      lineNumber,
    ),
  });
}

function normalizeLoadedReleaseDecisionLogEntry(
  value: unknown,
  lineNumber: number,
): ReleaseDecisionLogEntry {
  if (!isRecord(value)) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} is not an object.`,
    );
  }
  if (value.version !== RELEASE_DECISION_LOG_SPEC_VERSION) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log line ${lineNumber} has unsupported version.`,
    );
  }

  return Object.freeze({
    version: RELEASE_DECISION_LOG_SPEC_VERSION,
    entryId: requireString(value.entryId, 'entryId', lineNumber),
    sequence: requireNumber(value.sequence, 'sequence', lineNumber),
    occurredAt: requireString(value.occurredAt, 'occurredAt', lineNumber),
    requestId: requireString(value.requestId, 'requestId', lineNumber),
    phase: requirePhase(value.phase, lineNumber),
    matchedPolicyId: requireNullableString(value.matchedPolicyId, 'matchedPolicyId', lineNumber),
    decisionId: requireString(value.decisionId, 'decisionId', lineNumber),
    decisionStatus: requireDecisionStatus(value.decisionStatus, lineNumber),
    decisionDigest: requireString(value.decisionDigest, 'decisionDigest', lineNumber),
    findingsDigest: requireString(value.findingsDigest, 'findingsDigest', lineNumber),
    previousEntryDigest: requireNullableString(
      value.previousEntryDigest,
      'previousEntryDigest',
      lineNumber,
    ),
    metadata: normalizeLoadedMetadata(value.metadata, lineNumber),
    entryDigest: requireString(value.entryDigest, 'entryDigest', lineNumber),
  });
}

function defaultReleaseDecisionLogPath(): string {
  return resolve(
    process.env[ATTESTOR_RELEASE_DECISION_LOG_PATH_ENV] ?? DEFAULT_RELEASE_DECISION_LOG_PATH,
  );
}

function ensureReleaseDecisionLogDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function appendReleaseDecisionLogLineDurably(path: string, line: string): void {
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readReleaseDecisionLogEntries(path: string): readonly ReleaseDecisionLogEntry[] {
  ensureReleaseDecisionLogDirectory(path);
  if (!existsSync(path)) return Object.freeze([]);

  const content = readFileSync(path, 'utf8');
  if (content.trim().length === 0) return Object.freeze([]);

  const entries = content
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return normalizeLoadedReleaseDecisionLogEntry(JSON.parse(line) as unknown, index + 1);
      } catch (error) {
        if (error instanceof ReleaseDecisionLogStoreError) throw error;
        throw new ReleaseDecisionLogStoreError(
          `Release decision log line ${index + 1} is not valid JSON.`,
        );
      }
    });

  const verification = verifyReleaseDecisionLogChain(entries);
  if (!verification.valid) {
    throw new ReleaseDecisionLogStoreError(
      `Release decision log chain is invalid at entry ${verification.brokenEntryId ?? 'unknown'}.`,
    );
  }
  return Object.freeze(entries);
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

export function createFileBackedReleaseDecisionLogWriter(
  input: CreateFileBackedReleaseDecisionLogWriterInput = {},
): ReleaseDecisionLogWriter {
  const path = input.path ?? defaultReleaseDecisionLogPath();
  readReleaseDecisionLogEntries(path);

  return {
    append(input: ReleaseDecisionLogAppendInput): ReleaseDecisionLogEntry {
      return withFileLock(path, () => {
        const entries = readReleaseDecisionLogEntries(path);
        const entry = createReleaseDecisionLogEntry(
          input,
          entries.length + 1,
          entries.at(-1)?.entryDigest ?? null,
        );
        appendReleaseDecisionLogLineDurably(path, `${JSON.stringify(entry)}\n`);
        return entry;
      });
    },
    entries(): readonly ReleaseDecisionLogEntry[] {
      return withFileLock(path, () => [...readReleaseDecisionLogEntries(path)]);
    },
    latestEntryDigest(): string | null {
      return withFileLock(
        path,
        () => readReleaseDecisionLogEntries(path).at(-1)?.entryDigest ?? null,
      );
    },
    verify(): ReleaseDecisionLogVerificationResult {
      return verifyReleaseDecisionLogChain(
        withFileLock(path, () => readReleaseDecisionLogEntries(path)),
      );
    },
  };
}

export function resetFileBackedReleaseDecisionLogForTests(path?: string): void {
  const resolvedPath = path ?? defaultReleaseDecisionLogPath();
  if (existsSync(resolvedPath)) {
    rmSync(resolvedPath, { force: true });
  }
  if (existsSync(`${resolvedPath}.lock`)) {
    rmSync(`${resolvedPath}.lock`, { recursive: true, force: true });
  }
}
