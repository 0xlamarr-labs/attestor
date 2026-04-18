import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { withFileLock, writeTextFileAtomic } from '../platform/file-store.js';
import type { PolicyPackMetadata, PolicyActivationRecord } from './object-model.js';
import type { StoredPolicyBundleRecord } from './store.js';
import type { PolicyMutationAction } from './types.js';
import type { ReleaseActorReference } from '../release-layer/index.js';

/**
 * Immutable policy mutation audit log.
 *
 * Step 13 gives the control plane its own tamper-evident ledger, separate from
 * release-decision logging. The goal is to make policy lifecycle mutations
 * inspectable and verifiable even before admin HTTP surfaces arrive.
 */

export const POLICY_MUTATION_AUDIT_LOG_SPEC_VERSION =
  'attestor.policy-mutation-audit-log.v1';
export const POLICY_MUTATION_AUDIT_FILE_SPEC_VERSION =
  'attestor.policy-mutation-audit-file.v1';

export interface PolicyMutationAuditSubject {
  readonly packId: string | null;
  readonly bundleId: string | null;
  readonly bundleVersion: string | null;
  readonly activationId: string | null;
  readonly targetLabel: string | null;
}

export interface PolicyMutationAuditEntry {
  readonly version: typeof POLICY_MUTATION_AUDIT_LOG_SPEC_VERSION;
  readonly entryId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly action: PolicyMutationAction;
  readonly actor: ReleaseActorReference;
  readonly subject: PolicyMutationAuditSubject;
  readonly reasonCode: string | null;
  readonly rationale: string | null;
  readonly mutationSnapshot: unknown;
  readonly mutationDigest: string;
  readonly previousEntryDigest: string | null;
  readonly entryDigest: string;
}

export interface PolicyMutationAuditAppendInput {
  readonly occurredAt: string;
  readonly action: PolicyMutationAction;
  readonly actor: ReleaseActorReference;
  readonly subject: PolicyMutationAuditSubject;
  readonly reasonCode?: string | null;
  readonly rationale?: string | null;
  readonly mutationSnapshot: unknown;
}

export interface PolicyMutationAuditVerificationResult {
  readonly valid: boolean;
  readonly verifiedEntries: number;
  readonly brokenEntryId: string | null;
}

export interface PolicyMutationAuditSnapshot {
  readonly version: typeof POLICY_MUTATION_AUDIT_FILE_SPEC_VERSION;
  readonly entries: readonly PolicyMutationAuditEntry[];
}

export interface PolicyMutationAuditLogWriter {
  readonly kind: 'embedded-memory' | 'file-backed';
  append(input: PolicyMutationAuditAppendInput): PolicyMutationAuditEntry;
  entries(): readonly PolicyMutationAuditEntry[];
  latestEntryDigest(): string | null;
  verify(): PolicyMutationAuditVerificationResult;
  exportSnapshot(): PolicyMutationAuditSnapshot;
}

interface PolicyMutationAuditFile {
  readonly version: 1;
  entries: PolicyMutationAuditEntry[];
}

function defaultAuditFile(): PolicyMutationAuditFile {
  return {
    version: 1,
    entries: [],
  };
}

function defaultAuditLogPath(): string {
  return resolve(
    process.env.ATTESTOR_POLICY_MUTATION_AUDIT_LOG_PATH ??
      '.attestor/release-policy-mutation-audit-log.json',
  );
}

function ensureAuditDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Policy mutation audit log requires a valid occurredAt timestamp.');
  }
  return timestamp.toISOString();
}

function normalizeSubject(subject: PolicyMutationAuditSubject): PolicyMutationAuditSubject {
  return Object.freeze({
    packId: normalizeOptionalText(subject.packId),
    bundleId: normalizeOptionalText(subject.bundleId),
    bundleVersion: normalizeOptionalText(subject.bundleVersion),
    activationId: normalizeOptionalText(subject.activationId),
    targetLabel: normalizeOptionalText(subject.targetLabel),
  });
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Policy mutation audit snapshots cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('Policy mutation audit snapshots must be JSON-like values.');
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  throw new Error('Policy mutation audit snapshots must be JSON-like values.');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cloneAndFreeze<T>(value: T): T {
  const clone = structuredClone(value);

  function deepFreeze(input: unknown): unknown {
    if (input === null || typeof input !== 'object') {
      return input;
    }
    if (Object.isFrozen(input)) {
      return input;
    }
    if (Array.isArray(input)) {
      for (const item of input) {
        deepFreeze(item);
      }
      return Object.freeze(input);
    }
    for (const nested of Object.values(input)) {
      deepFreeze(nested);
    }
    return Object.freeze(input);
  }

  return deepFreeze(clone) as T;
}

function computeMutationDigest(snapshot: unknown): string {
  return sha256Hex(stableStringify(snapshot));
}

function computeEntryDigest(entry: Omit<PolicyMutationAuditEntry, 'entryDigest'>): string {
  return sha256Hex(
    stableStringify({
      version: entry.version,
      entryId: entry.entryId,
      sequence: entry.sequence,
      occurredAt: entry.occurredAt,
      action: entry.action,
      actor: entry.actor,
      subject: entry.subject,
      reasonCode: entry.reasonCode,
      rationale: entry.rationale,
      mutationDigest: entry.mutationDigest,
      previousEntryDigest: entry.previousEntryDigest,
    }),
  );
}

export function createPolicyMutationAuditEntry(
  input: PolicyMutationAuditAppendInput,
  sequence: number,
  previousEntryDigest: string | null,
): PolicyMutationAuditEntry {
  const mutationSnapshot = cloneAndFreeze(input.mutationSnapshot);
  const base: Omit<PolicyMutationAuditEntry, 'entryDigest'> = {
    version: POLICY_MUTATION_AUDIT_LOG_SPEC_VERSION,
    entryId: `policy_audit_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    sequence,
    occurredAt: normalizeIsoTimestamp(input.occurredAt),
    action: input.action,
    actor: cloneAndFreeze(input.actor),
    subject: normalizeSubject(input.subject),
    reasonCode: normalizeOptionalText(input.reasonCode),
    rationale: normalizeOptionalText(input.rationale),
    mutationSnapshot,
    mutationDigest: computeMutationDigest(mutationSnapshot),
    previousEntryDigest,
  };

  return Object.freeze({
    ...base,
    entryDigest: computeEntryDigest(base),
  });
}

export function verifyPolicyMutationAuditLogChain(
  entries: readonly PolicyMutationAuditEntry[],
): PolicyMutationAuditVerificationResult {
  let expectedSequence = 1;
  let previousEntryDigest: string | null = null;

  for (const entry of entries) {
    const expectedDigest = computeEntryDigest({
      version: entry.version,
      entryId: entry.entryId,
      sequence: entry.sequence,
      occurredAt: entry.occurredAt,
      action: entry.action,
      actor: entry.actor,
      subject: entry.subject,
      reasonCode: entry.reasonCode,
      rationale: entry.rationale,
      mutationSnapshot: entry.mutationSnapshot,
      mutationDigest: entry.mutationDigest,
      previousEntryDigest: entry.previousEntryDigest,
    });
    const expectedMutationDigest = computeMutationDigest(entry.mutationSnapshot);

    if (
      entry.sequence !== expectedSequence ||
      entry.previousEntryDigest !== previousEntryDigest ||
      entry.mutationDigest !== expectedMutationDigest ||
      entry.entryDigest !== expectedDigest
    ) {
      return Object.freeze({
        valid: false,
        verifiedEntries: expectedSequence - 1,
        brokenEntryId: entry.entryId,
      });
    }

    previousEntryDigest = entry.entryDigest;
    expectedSequence += 1;
  }

  return Object.freeze({
    valid: true,
    verifiedEntries: entries.length,
    brokenEntryId: null,
  });
}

function normalizeSnapshot(file: PolicyMutationAuditFile): PolicyMutationAuditSnapshot {
  return cloneAndFreeze({
    version: POLICY_MUTATION_AUDIT_FILE_SPEC_VERSION,
    entries: [...file.entries],
  });
}

function loadAuditFile(path: string): PolicyMutationAuditFile {
  if (!existsSync(path)) {
    return defaultAuditFile();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PolicyMutationAuditFile;
    if (parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed;
    }
  } catch {
    // fall through to safe default
  }
  return defaultAuditFile();
}

function saveAuditFile(path: string, file: PolicyMutationAuditFile): void {
  writeTextFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}

function createWriterFromAccessors(
  kind: PolicyMutationAuditLogWriter['kind'],
  accessors: {
    readonly read: () => PolicyMutationAuditFile;
    readonly mutate: <T>(action: (file: PolicyMutationAuditFile) => T) => T;
  },
): PolicyMutationAuditLogWriter {
  return {
    kind,

    append(input: PolicyMutationAuditAppendInput): PolicyMutationAuditEntry {
      return accessors.mutate((file) => {
        const entry = createPolicyMutationAuditEntry(
          input,
          file.entries.length + 1,
          file.entries.at(-1)?.entryDigest ?? null,
        );
        file.entries.push(entry);
        return entry;
      });
    },

    entries(): readonly PolicyMutationAuditEntry[] {
      return cloneAndFreeze([...accessors.read().entries]);
    },

    latestEntryDigest(): string | null {
      return accessors.read().entries.at(-1)?.entryDigest ?? null;
    },

    verify(): PolicyMutationAuditVerificationResult {
      return verifyPolicyMutationAuditLogChain(accessors.read().entries);
    },

    exportSnapshot(): PolicyMutationAuditSnapshot {
      return normalizeSnapshot(accessors.read());
    },
  };
}

export function createInMemoryPolicyMutationAuditLogWriter(): PolicyMutationAuditLogWriter {
  let file = defaultAuditFile();

  return createWriterFromAccessors('embedded-memory', {
    read: () => file,
    mutate: (action) => {
      const workingCopy = structuredClone(file) as PolicyMutationAuditFile;
      const result = action(workingCopy);
      file = workingCopy;
      return result;
    },
  });
}

export function createFileBackedPolicyMutationAuditLogWriter(
  path = defaultAuditLogPath(),
): PolicyMutationAuditLogWriter {
  return createWriterFromAccessors('file-backed', {
    read: () => {
      ensureAuditDirectory(path);
      return withFileLock(path, () => loadAuditFile(path));
    },
    mutate: (action) =>
      {
        ensureAuditDirectory(path);
        return withFileLock(path, () => {
          const file = loadAuditFile(path);
          const result = action(file);
          saveAuditFile(path, file);
          return result;
        });
      },
  });
}

export function resetFileBackedPolicyMutationAuditLogForTests(path?: string): void {
  const resolvedPath = path ?? defaultAuditLogPath();
  if (existsSync(resolvedPath)) {
    rmSync(resolvedPath, { force: true });
  }
  if (existsSync(`${resolvedPath}.lock`)) {
    rmSync(`${resolvedPath}.lock`, { recursive: true, force: true });
  }
}

export function createPolicyMutationAuditSubjectFromPack(
  pack: PolicyPackMetadata,
): PolicyMutationAuditSubject {
  return Object.freeze({
    packId: pack.id,
    bundleId: pack.latestBundleRef?.bundleId ?? null,
    bundleVersion: pack.latestBundleRef?.bundleVersion ?? null,
    activationId: null,
    targetLabel: null,
  });
}

export function createPolicyMutationAuditSubjectFromBundle(
  bundleRecord: StoredPolicyBundleRecord,
): PolicyMutationAuditSubject {
  return Object.freeze({
    packId: bundleRecord.packId,
    bundleId: bundleRecord.bundleId,
    bundleVersion: bundleRecord.bundleVersion,
    activationId: null,
    targetLabel: null,
  });
}

export function createPolicyMutationAuditSubjectFromActivation(
  activation: PolicyActivationRecord,
): PolicyMutationAuditSubject {
  return Object.freeze({
    packId: activation.bundle.packId,
    bundleId: activation.bundle.bundleId,
    bundleVersion: activation.bundle.bundleVersion,
    activationId: activation.id,
    targetLabel: activation.targetLabel,
  });
}
