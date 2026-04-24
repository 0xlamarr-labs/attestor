import {
  introspection,
  type RegisteredReleaseToken,
  type RegisterIssuedReleaseTokenInput,
  type RecordedReleaseTokenUseResult,
  type RecordReleaseTokenUseInput,
  type ReleaseTokenInactiveReason,
  type RevokeReleaseTokenInput,
} from '../release-layer/index.js';
import {
  RELEASE_AUTHORITY_SCHEMA,
  ensureReleaseAuthorityStore,
  getReleaseAuthorityComponent,
  recordReleaseAuthorityComponentState,
  resetReleaseAuthorityStoreForTests,
  withReleaseAuthorityTransaction,
  type ReleaseAuthorityPgClient,
} from './release-authority-store.js';

const RELEASE_TOKEN_INTROSPECTION_COMPONENT = 'release-token-introspection';
const RELEASE_TOKEN_INTROSPECTION_TABLE =
  `${RELEASE_AUTHORITY_SCHEMA}.release_token_introspection_records`;
const SHARED_RELEASE_TOKEN_INTROSPECTION_STORE_VERSION = 1;

type PgQueryResultRow = Record<string, unknown>;

export interface SharedReleaseTokenIntrospectionStoreSummary {
  readonly component: typeof RELEASE_TOKEN_INTROSPECTION_COMPONENT;
  readonly table: typeof RELEASE_TOKEN_INTROSPECTION_TABLE;
  readonly totalRecords: number;
  readonly issuedRecords: number;
  readonly revokedRecords: number;
  readonly expiredRecords: number;
  readonly consumedRecords: number;
  readonly componentStatus: 'pending' | 'ready';
}

export interface SharedReleaseTokenIntrospectionStore {
  registerIssuedToken(input: RegisterIssuedReleaseTokenInput): Promise<RegisteredReleaseToken>;
  findToken(tokenId: string): Promise<RegisteredReleaseToken | null>;
  revokeToken(input: RevokeReleaseTokenInput): Promise<RegisteredReleaseToken | null>;
  syncLifecycle(currentDate?: string): Promise<readonly RegisteredReleaseToken[]>;
  recordTokenUse(input: RecordReleaseTokenUseInput): Promise<RecordedReleaseTokenUseResult>;
  summary(): Promise<SharedReleaseTokenIntrospectionStoreSummary>;
}

export class SharedReleaseTokenIntrospectionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedReleaseTokenIntrospectionStoreError';
  }
}

let initPromise: Promise<void> | null = null;

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) {
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      `Shared release token introspection row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      `Shared release token introspection row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireNullableTimestamp(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeIso(value, fieldName);
}

function normalizeIso(value: unknown, fieldName: string): string {
  const parsed =
    value instanceof Date
      ? value
      : new Date(requireString(value, fieldName));
  if (Number.isNaN(parsed.getTime())) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      `Shared release token introspection row has invalid ${fieldName}.`,
    );
  }
  return parsed.toISOString();
}

function normalizeLifecycleTimestamp(label: string, timestamp?: string): string {
  const parsed = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      `Shared release token introspection requires a valid ${label} timestamp.`,
    );
  }
  return parsed.toISOString();
}

function inactiveReasonForRecord(record: RegisteredReleaseToken): ReleaseTokenInactiveReason {
  switch (record.status) {
    case 'revoked':
      return 'revoked';
    case 'expired':
      return 'expired';
    case 'consumed':
      return 'usage_exhausted';
    case 'issued':
    default:
      return 'invalid';
  }
}

function freezeRecord(record: RegisteredReleaseToken): RegisteredReleaseToken {
  return Object.freeze({ ...record });
}

function buildRegisteredRecord(input: RegisterIssuedReleaseTokenInput): RegisteredReleaseToken {
  const store = introspection.createInMemoryReleaseTokenIntrospectionStore();
  return freezeRecord(store.registerIssuedToken(input));
}

function expireRecord(record: RegisteredReleaseToken): RegisteredReleaseToken {
  if (record.status !== 'issued') {
    return record;
  }
  return Object.freeze({
    ...record,
    status: 'expired',
    statusChangedAt: record.expiresAt,
    expiredAt: record.expiresAt,
  });
}

function revokeRecord(
  record: RegisteredReleaseToken,
  input: RevokeReleaseTokenInput,
): RegisteredReleaseToken {
  if (record.status === 'revoked') {
    return record;
  }
  const revokedAt = normalizeLifecycleTimestamp('revokedAt', input.revokedAt);
  const reason = typeof input.reason === 'string' && input.reason.trim() !== ''
    ? input.reason.trim()
    : null;
  const revokedBy = typeof input.revokedBy === 'string' && input.revokedBy.trim() !== ''
    ? input.revokedBy.trim()
    : null;
  return Object.freeze({
    ...record,
    status: 'revoked',
    statusChangedAt: revokedAt,
    revokedAt,
    revocationReason: reason,
    revokedBy,
  });
}

function consumeRecord(
  record: RegisteredReleaseToken,
  input: RecordReleaseTokenUseInput,
): RegisteredReleaseToken {
  const usedAt = normalizeLifecycleTimestamp('usedAt', input.usedAt);
  const nextUseCount = record.useCount + 1;
  const exhausted = nextUseCount >= record.maxUses;
  return Object.freeze({
    ...record,
    status: exhausted ? 'consumed' : record.status,
    statusChangedAt: exhausted ? usedAt : record.statusChangedAt,
    useCount: nextUseCount,
    firstUsedAt: record.firstUsedAt ?? usedAt,
    lastUsedAt: usedAt,
    lastUsedByResourceServerId: input.resourceServerId ?? null,
  });
}

function rowJsonObject(row: PgQueryResultRow): Record<string, unknown> {
  const value = row.record_json;
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new SharedReleaseTokenIntrospectionStoreError(
    'Shared release token introspection row has invalid record_json.',
  );
}

function rowToRecord(row: PgQueryResultRow): RegisteredReleaseToken {
  const record = freezeRecord(rowJsonObject(row) as unknown as RegisteredReleaseToken);
  if (record.version !== introspection.RELEASE_TOKEN_REGISTRY_SPEC_VERSION) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      'Shared release token introspection record has an invalid version.',
    );
  }
  if (record.tokenId !== requireString(row.token_id, 'token_id')) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      'Shared release token introspection row is inconsistent for token_id.',
    );
  }
  if (record.status !== requireString(row.status, 'status')) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      'Shared release token introspection row is inconsistent for status.',
    );
  }
  if (record.decisionId !== requireString(row.decision_id, 'decision_id')) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      'Shared release token introspection row is inconsistent for decision_id.',
    );
  }
  if (record.audience !== requireString(row.audience, 'audience')) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      'Shared release token introspection row is inconsistent for audience.',
    );
  }
  if (record.useCount !== requireInteger(row.use_count, 'use_count')) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      'Shared release token introspection row is inconsistent for use_count.',
    );
  }
  if (record.revokedAt !== requireNullableTimestamp(row.revoked_at, 'revoked_at')) {
    throw new SharedReleaseTokenIntrospectionStoreError(
      'Shared release token introspection row is inconsistent for revoked_at.',
    );
  }
  return record;
}

async function ensureTokenIntrospectionTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureReleaseAuthorityStore();
      await withReleaseAuthorityTransaction(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${RELEASE_TOKEN_INTROSPECTION_TABLE} (
            token_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK (status IN ('issued', 'revoked', 'expired', 'consumed')),
            status_changed_at TIMESTAMPTZ NOT NULL,
            issuer TEXT NOT NULL,
            subject TEXT NOT NULL,
            audience TEXT NOT NULL,
            decision_id TEXT NOT NULL,
            decision_status TEXT NOT NULL,
            consequence_type TEXT NOT NULL,
            risk_class TEXT NOT NULL CHECK (risk_class IN ('R0', 'R1', 'R2', 'R3', 'R4')),
            expires_at TIMESTAMPTZ NOT NULL,
            max_uses INTEGER NOT NULL CHECK (max_uses >= 1),
            use_count INTEGER NOT NULL CHECK (use_count >= 0),
            first_used_at TIMESTAMPTZ NULL,
            last_used_at TIMESTAMPTZ NULL,
            last_used_by_resource_server_id TEXT NULL,
            revoked_at TIMESTAMPTZ NULL,
            expired_at TIMESTAMPTZ NULL,
            record_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS release_token_introspection_status_idx
            ON ${RELEASE_TOKEN_INTROSPECTION_TABLE} (status, expires_at ASC);

          CREATE INDEX IF NOT EXISTS release_token_introspection_decision_idx
            ON ${RELEASE_TOKEN_INTROSPECTION_TABLE} (decision_id);

          CREATE INDEX IF NOT EXISTS release_token_introspection_audience_idx
            ON ${RELEASE_TOKEN_INTROSPECTION_TABLE} (audience);
        `);
      });

      const currentRecord = await getReleaseAuthorityComponent(
        RELEASE_TOKEN_INTROSPECTION_COMPONENT,
      );
      await recordReleaseAuthorityComponentState({
        component: RELEASE_TOKEN_INTROSPECTION_COMPONENT,
        status: 'ready',
        migratedAt: currentRecord?.migratedAt ?? new Date().toISOString(),
        metadata: {
          ...(currentRecord?.metadata ?? {}),
          sharedStore: 'postgres',
          storeVersion: SHARED_RELEASE_TOKEN_INTROSPECTION_STORE_VERSION,
          table: RELEASE_TOKEN_INTROSPECTION_TABLE,
          lifecycleDiscipline: 'row-lock-token-use-and-revocation',
          bootstrapWired: false,
          trackerStep: '05',
        },
      });
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

async function upsertRecord(
  client: ReleaseAuthorityPgClient,
  record: RegisteredReleaseToken,
): Promise<RegisteredReleaseToken> {
  const stored = freezeRecord(record);
  await client.query(
    `INSERT INTO ${RELEASE_TOKEN_INTROSPECTION_TABLE} (
      token_id,
      status,
      status_changed_at,
      issuer,
      subject,
      audience,
      decision_id,
      decision_status,
      consequence_type,
      risk_class,
      expires_at,
      max_uses,
      use_count,
      first_used_at,
      last_used_at,
      last_used_by_resource_server_id,
      revoked_at,
      expired_at,
      record_json
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
      $11::timestamptz,
      $12,
      $13,
      $14::timestamptz,
      $15::timestamptz,
      $16,
      $17::timestamptz,
      $18::timestamptz,
      $19::jsonb
    )
    ON CONFLICT (token_id) DO UPDATE SET
      status = EXCLUDED.status,
      status_changed_at = EXCLUDED.status_changed_at,
      issuer = EXCLUDED.issuer,
      subject = EXCLUDED.subject,
      audience = EXCLUDED.audience,
      decision_id = EXCLUDED.decision_id,
      decision_status = EXCLUDED.decision_status,
      consequence_type = EXCLUDED.consequence_type,
      risk_class = EXCLUDED.risk_class,
      expires_at = EXCLUDED.expires_at,
      max_uses = EXCLUDED.max_uses,
      use_count = EXCLUDED.use_count,
      first_used_at = EXCLUDED.first_used_at,
      last_used_at = EXCLUDED.last_used_at,
      last_used_by_resource_server_id = EXCLUDED.last_used_by_resource_server_id,
      revoked_at = EXCLUDED.revoked_at,
      expired_at = EXCLUDED.expired_at,
      record_json = EXCLUDED.record_json,
      updated_at = NOW()`,
    [
      stored.tokenId,
      stored.status,
      stored.statusChangedAt,
      stored.issuer,
      stored.subject,
      stored.audience,
      stored.decisionId,
      stored.decisionStatus,
      stored.consequenceType,
      stored.riskClass,
      stored.expiresAt,
      stored.maxUses,
      stored.useCount,
      stored.firstUsedAt,
      stored.lastUsedAt,
      stored.lastUsedByResourceServerId,
      stored.revokedAt,
      stored.expiredAt,
      JSON.stringify(stored),
    ],
  );
  return stored;
}

async function expireIssuedRows(
  client: ReleaseAuthorityPgClient,
  now: string,
): Promise<readonly RegisteredReleaseToken[]> {
  const result = await client.query(
    `SELECT token_id, status, decision_id, audience, use_count, revoked_at, record_json
       FROM ${RELEASE_TOKEN_INTROSPECTION_TABLE}
      WHERE status = 'issued'
        AND expires_at <= $1::timestamptz
      FOR UPDATE`,
    [now],
  );
  const expired: RegisteredReleaseToken[] = [];
  for (const row of result.rows) {
    expired.push(await upsertRecord(client, expireRecord(rowToRecord(row))));
  }
  return Object.freeze(expired);
}

async function registerIssuedToken(
  input: RegisterIssuedReleaseTokenInput,
): Promise<RegisteredReleaseToken> {
  await ensureTokenIntrospectionTable();
  const record = buildRegisteredRecord(input);
  return withReleaseAuthorityTransaction((client) => upsertRecord(client, record));
}

async function findToken(tokenId: string): Promise<RegisteredReleaseToken | null> {
  await ensureTokenIntrospectionTable();
  return withReleaseAuthorityTransaction(async (client) => {
    const result = await client.query(
      `SELECT token_id, status, decision_id, audience, use_count, revoked_at, record_json
         FROM ${RELEASE_TOKEN_INTROSPECTION_TABLE}
        WHERE token_id = $1
        LIMIT 1`,
      [tokenId],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  });
}

async function revokeToken(
  input: RevokeReleaseTokenInput,
): Promise<RegisteredReleaseToken | null> {
  await ensureTokenIntrospectionTable();
  return withReleaseAuthorityTransaction(async (client) => {
    const result = await client.query(
      `SELECT token_id, status, decision_id, audience, use_count, revoked_at, record_json
         FROM ${RELEASE_TOKEN_INTROSPECTION_TABLE}
        WHERE token_id = $1
        FOR UPDATE`,
      [input.tokenId],
    );
    const existing = result.rows[0] ? rowToRecord(result.rows[0]) : null;
    if (!existing) {
      return null;
    }
    return upsertRecord(client, revokeRecord(existing, input));
  });
}

async function syncLifecycle(currentDate?: string): Promise<readonly RegisteredReleaseToken[]> {
  await ensureTokenIntrospectionTable();
  const now = normalizeLifecycleTimestamp('currentDate', currentDate);
  return withReleaseAuthorityTransaction((client) => expireIssuedRows(client, now));
}

async function recordTokenUse(
  input: RecordReleaseTokenUseInput,
): Promise<RecordedReleaseTokenUseResult> {
  await ensureTokenIntrospectionTable();
  const now = normalizeLifecycleTimestamp('usedAt', input.usedAt);
  return withReleaseAuthorityTransaction(async (client) => {
    await expireIssuedRows(client, now);
    const result = await client.query(
      `SELECT token_id, status, decision_id, audience, use_count, revoked_at, record_json
         FROM ${RELEASE_TOKEN_INTROSPECTION_TABLE}
        WHERE token_id = $1
        FOR UPDATE`,
      [input.tokenId],
    );
    const existing = result.rows[0] ? rowToRecord(result.rows[0]) : null;
    if (!existing) {
      return Object.freeze({
        accepted: false,
        inactiveReason: 'unknown',
        record: null,
      });
    }
    if (existing.status !== 'issued') {
      return Object.freeze({
        accepted: false,
        inactiveReason: inactiveReasonForRecord(existing),
        record: existing,
      });
    }
    const consumed = await upsertRecord(client, consumeRecord(existing, input));
    return Object.freeze({
      accepted: true,
      inactiveReason: null,
      record: consumed,
    });
  });
}

async function summary(): Promise<SharedReleaseTokenIntrospectionStoreSummary> {
  await ensureTokenIntrospectionTable();
  const [component, stats] = await Promise.all([
    getReleaseAuthorityComponent(RELEASE_TOKEN_INTROSPECTION_COMPONENT),
    withReleaseAuthorityTransaction(async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS total_records,
                COUNT(*) FILTER (WHERE status = 'issued')::int AS issued_records,
                COUNT(*) FILTER (WHERE status = 'revoked')::int AS revoked_records,
                COUNT(*) FILTER (WHERE status = 'expired')::int AS expired_records,
                COUNT(*) FILTER (WHERE status = 'consumed')::int AS consumed_records
           FROM ${RELEASE_TOKEN_INTROSPECTION_TABLE}`,
      );
      return result.rows[0] ?? {};
    }),
  ]);
  return Object.freeze({
    component: RELEASE_TOKEN_INTROSPECTION_COMPONENT,
    table: RELEASE_TOKEN_INTROSPECTION_TABLE,
    totalRecords: requireInteger(stats.total_records ?? 0, 'total_records'),
    issuedRecords: requireInteger(stats.issued_records ?? 0, 'issued_records'),
    revokedRecords: requireInteger(stats.revoked_records ?? 0, 'revoked_records'),
    expiredRecords: requireInteger(stats.expired_records ?? 0, 'expired_records'),
    consumedRecords: requireInteger(stats.consumed_records ?? 0, 'consumed_records'),
    componentStatus: component?.status ?? 'pending',
  });
}

export async function ensureSharedReleaseTokenIntrospectionStore(): Promise<
  SharedReleaseTokenIntrospectionStoreSummary
> {
  await ensureTokenIntrospectionTable();
  return summary();
}

export function createSharedReleaseTokenIntrospectionStore(): SharedReleaseTokenIntrospectionStore {
  return Object.freeze({
    registerIssuedToken,
    findToken,
    revokeToken,
    syncLifecycle,
    recordTokenUse,
    summary,
  });
}

export async function resetSharedReleaseTokenIntrospectionStoreForTests(): Promise<void> {
  initPromise = null;
  await resetReleaseAuthorityStoreForTests();
}
