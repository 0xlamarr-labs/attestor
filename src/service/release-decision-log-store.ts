import {
  decisionLog,
  type ReleaseDecisionLogAppendInput,
  type ReleaseDecisionLogEntry,
  type ReleaseDecisionLogVerificationResult,
} from '../release-layer/index.js';
import {
  RELEASE_AUTHORITY_SCHEMA,
  ensureReleaseAuthorityStore,
  getReleaseAuthorityComponent,
  recordReleaseAuthorityComponentState,
  type ReleaseAuthorityPgClient,
  resetReleaseAuthorityStoreForTests,
  withReleaseAuthorityAdvisoryLock,
  withReleaseAuthorityTransaction,
} from './release-authority-store.js';

const RELEASE_DECISION_LOG_COMPONENT = 'release-decision-log';
const RELEASE_DECISION_LOG_TABLE = `${RELEASE_AUTHORITY_SCHEMA}.release_decision_log_entries`;
const RELEASE_DECISION_LOG_APPEND_LOCK = 'release-decision-log-append';
const SHARED_RELEASE_DECISION_LOG_STORE_VERSION = 1;

type PgQueryResultRow = Record<string, unknown>;

export interface SharedReleaseDecisionLogStoreSummary {
  readonly component: typeof RELEASE_DECISION_LOG_COMPONENT;
  readonly table: typeof RELEASE_DECISION_LOG_TABLE;
  readonly entryCount: number;
  readonly latestSequence: number;
  readonly latestEntryDigest: string | null;
  readonly componentStatus: 'pending' | 'ready';
}

export interface ListSharedReleaseDecisionLogEntriesInput {
  readonly requestId?: string;
  readonly limit?: number;
}

export interface SharedReleaseDecisionLogStore {
  append(input: ReleaseDecisionLogAppendInput): Promise<ReleaseDecisionLogEntry>;
  entries(
    input?: ListSharedReleaseDecisionLogEntriesInput,
  ): Promise<readonly ReleaseDecisionLogEntry[]>;
  latestEntryDigest(): Promise<string | null>;
  verify(): Promise<ReleaseDecisionLogVerificationResult>;
  summary(): Promise<SharedReleaseDecisionLogStoreSummary>;
}

export class SharedReleaseDecisionLogStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedReleaseDecisionLogStoreError';
  }
}

let initPromise: Promise<void> | null = null;
const RELEASE_DECISION_LOG_STORED_STATUSES = Object.freeze([
  'accepted',
  'denied',
  'hold',
  'review-required',
  'expired',
  'revoked',
  'overridden',
]);

function quoteSqlText(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
}

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) {
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new SharedReleaseDecisionLogStoreError(
      `Shared release decision log row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SharedReleaseDecisionLogStoreError(
      `Shared release decision log row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireNullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requireString(value, fieldName);
}

function normalizeIso(value: unknown, fieldName: string): string {
  const parsed =
    value instanceof Date
      ? value
      : new Date(requireString(value, fieldName));
  if (Number.isNaN(parsed.getTime())) {
    throw new SharedReleaseDecisionLogStoreError(
      `Shared release decision log row has invalid ${fieldName}.`,
    );
  }
  return parsed.toISOString();
}

function assertFieldMatch<T>(actual: T, expected: T, fieldName: string): void {
  if (actual !== expected) {
    throw new SharedReleaseDecisionLogStoreError(
      `Shared release decision log row is inconsistent for ${fieldName}.`,
    );
  }
}

function rowToReleaseDecisionLogEntry(row: PgQueryResultRow, lineNumber: number): ReleaseDecisionLogEntry {
  const entry = decisionLog.coerceReleaseDecisionLogEntry(row.entry_json, lineNumber);
  const metadata = decisionLog.coerceReleaseDecisionLogMetadata(row.metadata_json, lineNumber);

  assertFieldMatch(requireInteger(row.sequence, 'sequence'), entry.sequence, 'sequence');
  assertFieldMatch(requireString(row.entry_id, 'entry_id'), entry.entryId, 'entry_id');
  assertFieldMatch(normalizeIso(row.occurred_at, 'occurred_at'), entry.occurredAt, 'occurred_at');
  assertFieldMatch(requireString(row.request_id, 'request_id'), entry.requestId, 'request_id');
  assertFieldMatch(requireString(row.phase, 'phase'), entry.phase, 'phase');
  assertFieldMatch(
    requireNullableString(row.matched_policy_id, 'matched_policy_id'),
    entry.matchedPolicyId,
    'matched_policy_id',
  );
  assertFieldMatch(requireString(row.decision_id, 'decision_id'), entry.decisionId, 'decision_id');
  assertFieldMatch(
    requireString(row.decision_status, 'decision_status'),
    entry.decisionStatus,
    'decision_status',
  );
  assertFieldMatch(
    requireString(row.decision_digest, 'decision_digest'),
    entry.decisionDigest,
    'decision_digest',
  );
  assertFieldMatch(
    requireString(row.findings_digest, 'findings_digest'),
    entry.findingsDigest,
    'findings_digest',
  );
  assertFieldMatch(
    requireNullableString(row.previous_entry_digest, 'previous_entry_digest'),
    entry.previousEntryDigest,
    'previous_entry_digest',
  );
  assertFieldMatch(requireString(row.entry_digest, 'entry_digest'), entry.entryDigest, 'entry_digest');
  assertFieldMatch(
    JSON.stringify(metadata),
    JSON.stringify(entry.metadata),
    'metadata_json',
  );

  return entry;
}

function verificationOrThrow(
  entries: readonly ReleaseDecisionLogEntry[],
): ReleaseDecisionLogVerificationResult {
  const verification = decisionLog.verifyReleaseDecisionLogChain(entries);
  if (!verification.valid) {
    throw new SharedReleaseDecisionLogStoreError(
      `Shared release decision log chain is invalid at entry ${verification.brokenEntryId ?? 'unknown'}.`,
    );
  }
  return verification;
}

async function ensureDecisionLogTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureReleaseAuthorityStore();
      await withReleaseAuthorityTransaction(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${RELEASE_DECISION_LOG_TABLE} (
            sequence BIGINT PRIMARY KEY CHECK (sequence >= 1),
            entry_id TEXT NOT NULL UNIQUE,
            occurred_at TIMESTAMPTZ NOT NULL,
            request_id TEXT NOT NULL,
            phase TEXT NOT NULL CHECK (phase IN (${quoteSqlText(decisionLog.RELEASE_DECISION_LOG_PHASES)})),
            matched_policy_id TEXT NULL,
            decision_id TEXT NOT NULL,
            decision_status TEXT NOT NULL CHECK (decision_status IN (${quoteSqlText(RELEASE_DECISION_LOG_STORED_STATUSES)})),
            decision_digest TEXT NOT NULL,
            findings_digest TEXT NOT NULL,
            previous_entry_digest TEXT NULL,
            entry_digest TEXT NOT NULL UNIQUE,
            metadata_json JSONB NOT NULL,
            entry_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS release_decision_log_entries_request_idx
            ON ${RELEASE_DECISION_LOG_TABLE} (request_id, sequence ASC);

          CREATE INDEX IF NOT EXISTS release_decision_log_entries_occurred_idx
            ON ${RELEASE_DECISION_LOG_TABLE} (occurred_at ASC, sequence ASC);

          CREATE INDEX IF NOT EXISTS release_decision_log_entries_decision_idx
            ON ${RELEASE_DECISION_LOG_TABLE} (decision_id, sequence ASC);
        `);
      });

      const currentRecord = await getReleaseAuthorityComponent(RELEASE_DECISION_LOG_COMPONENT);
      await recordReleaseAuthorityComponentState({
        component: RELEASE_DECISION_LOG_COMPONENT,
        status: 'ready',
        migratedAt: currentRecord?.migratedAt ?? new Date().toISOString(),
        metadata: {
          ...(currentRecord?.metadata ?? {}),
          sharedStore: 'postgres',
          storeVersion: SHARED_RELEASE_DECISION_LOG_STORE_VERSION,
          table: RELEASE_DECISION_LOG_TABLE,
          bootstrapWired: false,
          trackerStep: '03',
        },
      });
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

async function queryEntries(
  input: ListSharedReleaseDecisionLogEntriesInput = {},
): Promise<readonly ReleaseDecisionLogEntry[]> {
  await ensureDecisionLogTable();
  return withReleaseAuthorityTransaction(async (client) => {
    const params: unknown[] = [];
    const predicates: string[] = [];

    if (input.requestId) {
      params.push(input.requestId);
      predicates.push(`request_id = $${params.length}`);
    }

    let sql = `
      SELECT sequence,
             entry_id,
             occurred_at,
             request_id,
             phase,
             matched_policy_id,
             decision_id,
             decision_status,
             decision_digest,
             findings_digest,
             previous_entry_digest,
             entry_digest,
             metadata_json,
             entry_json
        FROM ${RELEASE_DECISION_LOG_TABLE}
    `;
    if (predicates.length > 0) {
      sql += ` WHERE ${predicates.join(' AND ')}`;
    }
    sql += ' ORDER BY sequence ASC';

    if (input.limit !== undefined) {
      if (!Number.isInteger(input.limit) || input.limit <= 0) {
        throw new SharedReleaseDecisionLogStoreError(
          'Shared release decision log requires a positive integer limit.',
        );
      }
      params.push(input.limit);
      sql += ` LIMIT $${params.length}`;
    }

    const result = await client.query(sql, params);
    const entries = Object.freeze(
      result.rows.map((row, index) => rowToReleaseDecisionLogEntry(row, index + 1)),
    );
    verificationOrThrow(entries);
    return entries;
  });
}

async function latestSequenceAndDigest(
  client: ReleaseAuthorityPgClient,
): Promise<{ sequence: number; entryDigest: string } | null> {
  const result = await client.query(
    `SELECT sequence, entry_digest
       FROM ${RELEASE_DECISION_LOG_TABLE}
      ORDER BY sequence DESC
      LIMIT 1`,
  );
  if (result.rows.length === 0) {
    return null;
  }
  return {
    sequence: requireInteger(result.rows[0]?.sequence, 'sequence'),
    entryDigest: requireString(result.rows[0]?.entry_digest, 'entry_digest'),
  };
}

async function appendEntry(
  input: ReleaseDecisionLogAppendInput,
): Promise<ReleaseDecisionLogEntry> {
  await ensureDecisionLogTable();
  return withReleaseAuthorityAdvisoryLock(RELEASE_DECISION_LOG_APPEND_LOCK, async (client) => {
    const latest = await latestSequenceAndDigest(client);
    const entry = decisionLog.createReleaseDecisionLogEntry(
      input,
      (latest?.sequence ?? 0) + 1,
      latest?.entryDigest ?? null,
    );

    await client.query(
      `INSERT INTO ${RELEASE_DECISION_LOG_TABLE} (
        sequence,
        entry_id,
        occurred_at,
        request_id,
        phase,
        matched_policy_id,
        decision_id,
        decision_status,
        decision_digest,
        findings_digest,
        previous_entry_digest,
        entry_digest,
        metadata_json,
        entry_json
      ) VALUES (
        $1,
        $2,
        $3::timestamptz,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13::jsonb,
        $14::jsonb
      )`,
      [
        entry.sequence,
        entry.entryId,
        entry.occurredAt,
        entry.requestId,
        entry.phase,
        entry.matchedPolicyId,
        entry.decisionId,
        entry.decisionStatus,
        entry.decisionDigest,
        entry.findingsDigest,
        entry.previousEntryDigest,
        entry.entryDigest,
        JSON.stringify(entry.metadata),
        JSON.stringify(entry),
      ],
    );

    return entry;
  });
}

async function summary(): Promise<SharedReleaseDecisionLogStoreSummary> {
  await ensureDecisionLogTable();
  const [component, stats] = await Promise.all([
    getReleaseAuthorityComponent(RELEASE_DECISION_LOG_COMPONENT),
    withReleaseAuthorityTransaction(async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS entry_count,
                COALESCE(MAX(sequence), 0)::int AS latest_sequence,
                (
                  SELECT entry_digest
                    FROM ${RELEASE_DECISION_LOG_TABLE}
                   ORDER BY sequence DESC
                   LIMIT 1
                ) AS latest_entry_digest
           FROM ${RELEASE_DECISION_LOG_TABLE}`,
      );
      return result.rows[0] ?? {};
    }),
  ]);

  return Object.freeze({
    component: RELEASE_DECISION_LOG_COMPONENT,
    table: RELEASE_DECISION_LOG_TABLE,
    entryCount: requireInteger(stats.entry_count ?? 0, 'entry_count'),
    latestSequence: requireInteger(stats.latest_sequence ?? 0, 'latest_sequence'),
    latestEntryDigest: requireNullableString(
      stats.latest_entry_digest ?? null,
      'latest_entry_digest',
    ),
    componentStatus: component?.status ?? 'pending',
  });
}

export async function ensureSharedReleaseDecisionLogStore(): Promise<SharedReleaseDecisionLogStoreSummary> {
  await ensureDecisionLogTable();
  return summary();
}

export function createSharedReleaseDecisionLogStore(): SharedReleaseDecisionLogStore {
  return Object.freeze({
    append: appendEntry,
    entries: queryEntries,
    async latestEntryDigest(): Promise<string | null> {
      return (await summary()).latestEntryDigest;
    },
    async verify(): Promise<ReleaseDecisionLogVerificationResult> {
      return verificationOrThrow(await queryEntries());
    },
    summary,
  });
}

export async function resetSharedReleaseDecisionLogStoreForTests(): Promise<void> {
  initPromise = null;
  await resetReleaseAuthorityStoreForTests();
}
