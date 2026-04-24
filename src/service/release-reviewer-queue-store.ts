import { randomUUID } from 'node:crypto';
import {
  review,
  type ReleaseReviewerQueueDetail,
  type ReleaseReviewerQueueListOptions,
  type ReleaseReviewerQueueListResult,
  type ReleaseReviewerQueueRecord,
} from '../release-layer/index.js';
import {
  RELEASE_AUTHORITY_SCHEMA,
  ensureReleaseAuthorityStore,
  getReleaseAuthorityComponent,
  recordReleaseAuthorityComponentState,
  resetReleaseAuthorityStoreForTests,
  withReleaseAuthorityTransaction,
} from './release-authority-store.js';

const RELEASE_REVIEWER_QUEUE_COMPONENT = 'release-reviewer-queue';
const RELEASE_REVIEWER_QUEUE_TABLE = `${RELEASE_AUTHORITY_SCHEMA}.release_reviewer_queue_items`;
const SHARED_RELEASE_REVIEWER_QUEUE_STORE_VERSION = 1;

type PgQueryResultRow = Record<string, unknown>;

export interface SharedReleaseReviewerQueueStoreSummary {
  readonly component: typeof RELEASE_REVIEWER_QUEUE_COMPONENT;
  readonly table: typeof RELEASE_REVIEWER_QUEUE_TABLE;
  readonly totalRecords: number;
  readonly pendingRecords: number;
  readonly activeClaims: number;
  readonly componentStatus: 'pending' | 'ready';
}

export interface SharedReleaseReviewerQueueClaimInput extends ReleaseReviewerQueueListOptions {
  readonly claimedBy: string;
  readonly claimedAt?: string;
  readonly leaseMs?: number;
}

export interface SharedReleaseReviewerQueueClaim {
  readonly claimToken: string;
  readonly claimedBy: string;
  readonly claimedAt: string;
  readonly claimExpiresAt: string;
  readonly claimVersion: number;
  readonly record: ReleaseReviewerQueueRecord;
}

export interface SharedReleaseReviewerQueueReleaseClaimInput {
  readonly reviewId: string;
  readonly claimToken: string;
}

export interface SharedReleaseReviewerQueueStore {
  upsert(record: ReleaseReviewerQueueRecord): Promise<ReleaseReviewerQueueDetail>;
  get(id: string): Promise<ReleaseReviewerQueueDetail | null>;
  getRecord(id: string): Promise<ReleaseReviewerQueueRecord | null>;
  listPending(options?: ReleaseReviewerQueueListOptions): Promise<ReleaseReviewerQueueListResult>;
  claimNextPending(
    input: SharedReleaseReviewerQueueClaimInput,
  ): Promise<SharedReleaseReviewerQueueClaim | null>;
  releaseClaim(input: SharedReleaseReviewerQueueReleaseClaimInput): Promise<boolean>;
  summary(): Promise<SharedReleaseReviewerQueueStoreSummary>;
}

export class SharedReleaseReviewerQueueStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedReleaseReviewerQueueStoreError';
  }
}

let initPromise: Promise<void> | null = null;

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) {
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new SharedReleaseReviewerQueueStoreError(
      `Shared release reviewer queue row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SharedReleaseReviewerQueueStoreError(
      `Shared release reviewer queue row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function normalizeIso(value: unknown, fieldName: string): string {
  const parsed =
    value instanceof Date
      ? value
      : new Date(requireString(value, fieldName));
  if (Number.isNaN(parsed.getTime())) {
    throw new SharedReleaseReviewerQueueStoreError(
      `Shared release reviewer queue row has invalid ${fieldName}.`,
    );
  }
  return parsed.toISOString();
}

function riskRank(riskClass: ReleaseReviewerQueueDetail['riskClass']): number {
  switch (riskClass) {
    case 'R4':
      return 4;
    case 'R3':
      return 3;
    case 'R2':
      return 2;
    case 'R1':
      return 1;
    case 'R0':
      return 0;
  }
}

function rowToRecord(row: PgQueryResultRow): ReleaseReviewerQueueRecord {
  const record = review.coerceReleaseReviewerQueueRecord(
    row.record_json as ReleaseReviewerQueueRecord,
  );
  if (record.detail.id !== row.review_id) {
    throw new SharedReleaseReviewerQueueStoreError(
      'Shared release reviewer queue row is inconsistent for review_id.',
    );
  }
  if (record.detail.decisionId !== row.decision_id) {
    throw new SharedReleaseReviewerQueueStoreError(
      'Shared release reviewer queue row is inconsistent for decision_id.',
    );
  }
  if (record.detail.status !== row.status) {
    throw new SharedReleaseReviewerQueueStoreError(
      'Shared release reviewer queue row is inconsistent for status.',
    );
  }
  if (record.detail.authorityState !== row.authority_state) {
    throw new SharedReleaseReviewerQueueStoreError(
      'Shared release reviewer queue row is inconsistent for authority_state.',
    );
  }
  if (record.detail.riskClass !== row.risk_class) {
    throw new SharedReleaseReviewerQueueStoreError(
      'Shared release reviewer queue row is inconsistent for risk_class.',
    );
  }
  return record;
}

function rowToClaim(row: PgQueryResultRow): SharedReleaseReviewerQueueClaim {
  return Object.freeze({
    claimToken: requireString(row.claim_token, 'claim_token'),
    claimedBy: requireString(row.claimed_by, 'claimed_by'),
    claimedAt: normalizeIso(row.claimed_at, 'claimed_at'),
    claimExpiresAt: normalizeIso(row.claim_expires_at, 'claim_expires_at'),
    claimVersion: requireInteger(row.claim_version, 'claim_version'),
    record: rowToRecord(row),
  });
}

function normalizeClaimedBy(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new SharedReleaseReviewerQueueStoreError(
      'Shared release reviewer queue claim requires a non-empty claimedBy value.',
    );
  }
  return normalized;
}

function normalizeClaimedAt(value?: string): string {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw new SharedReleaseReviewerQueueStoreError(
      'Shared release reviewer queue claim requires a valid claimedAt timestamp.',
    );
  }
  return parsed.toISOString();
}

function normalizeLeaseMs(value?: number): number {
  const leaseMs = value ?? 5 * 60 * 1000;
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw new SharedReleaseReviewerQueueStoreError(
      'Shared release reviewer queue claim requires a positive integer leaseMs.',
    );
  }
  return leaseMs;
}

async function ensureReviewerQueueTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureReleaseAuthorityStore();
      await withReleaseAuthorityTransaction(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${RELEASE_REVIEWER_QUEUE_TABLE} (
            review_id TEXT PRIMARY KEY,
            decision_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending-review', 'approved', 'rejected', 'overridden')),
            authority_state TEXT NOT NULL CHECK (authority_state IN ('pending', 'approved', 'rejected', 'overridden')),
            risk_class TEXT NOT NULL CHECK (risk_class IN ('R0', 'R1', 'R2', 'R3', 'R4')),
            risk_rank INTEGER NOT NULL CHECK (risk_rank >= 0 AND risk_rank <= 4),
            consequence_type TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            claim_token TEXT NULL,
            claimed_by TEXT NULL,
            claimed_at TIMESTAMPTZ NULL,
            claim_expires_at TIMESTAMPTZ NULL,
            claim_version INTEGER NOT NULL DEFAULT 0 CHECK (claim_version >= 0),
            record_json JSONB NOT NULL
          );

          CREATE INDEX IF NOT EXISTS release_reviewer_queue_pending_idx
            ON ${RELEASE_REVIEWER_QUEUE_TABLE} (status, risk_rank DESC, created_at ASC, review_id ASC);

          CREATE INDEX IF NOT EXISTS release_reviewer_queue_claim_idx
            ON ${RELEASE_REVIEWER_QUEUE_TABLE} (claim_expires_at ASC)
            WHERE claim_token IS NOT NULL;

          CREATE INDEX IF NOT EXISTS release_reviewer_queue_decision_idx
            ON ${RELEASE_REVIEWER_QUEUE_TABLE} (decision_id);
        `);
      });

      const currentRecord = await getReleaseAuthorityComponent(RELEASE_REVIEWER_QUEUE_COMPONENT);
      await recordReleaseAuthorityComponentState({
        component: RELEASE_REVIEWER_QUEUE_COMPONENT,
        status: 'ready',
        migratedAt: currentRecord?.migratedAt ?? new Date().toISOString(),
        metadata: {
          ...(currentRecord?.metadata ?? {}),
          sharedStore: 'postgres',
          storeVersion: SHARED_RELEASE_REVIEWER_QUEUE_STORE_VERSION,
          table: RELEASE_REVIEWER_QUEUE_TABLE,
          claimDiscipline: 'for-update-skip-locked',
          bootstrapWired: false,
          trackerStep: '04',
        },
      });
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
}

async function upsert(record: ReleaseReviewerQueueRecord): Promise<ReleaseReviewerQueueDetail> {
  await ensureReviewerQueueTable();
  const stored = review.coerceReleaseReviewerQueueRecord(record);
  await withReleaseAuthorityTransaction(async (client) => {
    await client.query(
      `INSERT INTO ${RELEASE_REVIEWER_QUEUE_TABLE} (
        review_id,
        decision_id,
        status,
        authority_state,
        risk_class,
        risk_rank,
        consequence_type,
        created_at,
        updated_at,
        record_json
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::timestamptz,
        $9::timestamptz,
        $10::jsonb
      )
      ON CONFLICT (review_id) DO UPDATE SET
        decision_id = EXCLUDED.decision_id,
        status = EXCLUDED.status,
        authority_state = EXCLUDED.authority_state,
        risk_class = EXCLUDED.risk_class,
        risk_rank = EXCLUDED.risk_rank,
        consequence_type = EXCLUDED.consequence_type,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        claim_token = CASE
          WHEN EXCLUDED.status = 'pending-review' THEN ${RELEASE_REVIEWER_QUEUE_TABLE}.claim_token
          ELSE NULL
        END,
        claimed_by = CASE
          WHEN EXCLUDED.status = 'pending-review' THEN ${RELEASE_REVIEWER_QUEUE_TABLE}.claimed_by
          ELSE NULL
        END,
        claimed_at = CASE
          WHEN EXCLUDED.status = 'pending-review' THEN ${RELEASE_REVIEWER_QUEUE_TABLE}.claimed_at
          ELSE NULL
        END,
        claim_expires_at = CASE
          WHEN EXCLUDED.status = 'pending-review' THEN ${RELEASE_REVIEWER_QUEUE_TABLE}.claim_expires_at
          ELSE NULL
        END,
        record_json = EXCLUDED.record_json`,
      [
        stored.detail.id,
        stored.detail.decisionId,
        stored.detail.status,
        stored.detail.authorityState,
        stored.detail.riskClass,
        riskRank(stored.detail.riskClass),
        stored.detail.consequenceType,
        stored.detail.createdAt,
        stored.detail.updatedAt,
        JSON.stringify(stored),
      ],
    );
  });
  return stored.detail;
}

async function getRecord(id: string): Promise<ReleaseReviewerQueueRecord | null> {
  await ensureReviewerQueueTable();
  return withReleaseAuthorityTransaction(async (client) => {
    const result = await client.query(
      `SELECT review_id, decision_id, status, authority_state, risk_class, record_json
         FROM ${RELEASE_REVIEWER_QUEUE_TABLE}
        WHERE review_id = $1
        LIMIT 1`,
      [id],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  });
}

async function listPending(
  options: ReleaseReviewerQueueListOptions = {},
): Promise<ReleaseReviewerQueueListResult> {
  await ensureReviewerQueueTable();
  return withReleaseAuthorityTransaction(async (client) => {
    const params: unknown[] = [];
    const predicates = ["status = 'pending-review'"];

    if (options.riskClass) {
      params.push(options.riskClass);
      predicates.push(`risk_class = $${params.length}`);
    }
    if (options.consequenceType) {
      params.push(options.consequenceType);
      predicates.push(`consequence_type = $${params.length}`);
    }

    let sql = `
      SELECT review_id, decision_id, status, authority_state, risk_class, record_json
        FROM ${RELEASE_REVIEWER_QUEUE_TABLE}
       WHERE ${predicates.join(' AND ')}
       ORDER BY risk_rank DESC, created_at ASC, review_id ASC
    `;
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new SharedReleaseReviewerQueueStoreError(
          'Shared release reviewer queue requires a positive integer limit.',
        );
      }
      params.push(options.limit);
      sql += ` LIMIT $${params.length}`;
    }

    const itemsResult = await client.query(sql, params);
    const countParams = params.slice(0, params.length - (options.limit === undefined ? 0 : 1));
    const countsResult = await client.query(
      `SELECT risk_class, COUNT(*)::int AS count
         FROM ${RELEASE_REVIEWER_QUEUE_TABLE}
        WHERE ${predicates.join(' AND ')}
        GROUP BY risk_class`,
      countParams,
    );
    const counts = { R0: 0, R1: 0, R2: 0, R3: 0, R4: 0 };
    for (const row of countsResult.rows) {
      const risk = requireString(row.risk_class, 'risk_class') as keyof typeof counts;
      counts[risk] = requireInteger(row.count, 'count');
    }
    const totalPending = Object.values(counts).reduce((sum, count) => sum + count, 0);

    return Object.freeze({
      generatedAt: new Date().toISOString(),
      totalPending,
      countsByRiskClass: Object.freeze(counts),
      items: Object.freeze(itemsResult.rows.map((row) => rowToRecord(row).detail)),
    });
  });
}

async function claimNextPending(
  input: SharedReleaseReviewerQueueClaimInput,
): Promise<SharedReleaseReviewerQueueClaim | null> {
  await ensureReviewerQueueTable();
  const claimedBy = normalizeClaimedBy(input.claimedBy);
  const claimedAt = normalizeClaimedAt(input.claimedAt);
  const leaseMs = normalizeLeaseMs(input.leaseMs);
  const expiresAt = new Date(new Date(claimedAt).getTime() + leaseMs).toISOString();
  const claimToken = `rrq_claim_${randomUUID().replace(/-/g, '')}`;

  return withReleaseAuthorityTransaction(async (client) => {
    const params: unknown[] = [claimedAt];
    const predicates = [
      "status = 'pending-review'",
      '(claim_token IS NULL OR claim_expires_at <= $1::timestamptz)',
    ];
    if (input.riskClass) {
      params.push(input.riskClass);
      predicates.push(`risk_class = $${params.length}`);
    }
    if (input.consequenceType) {
      params.push(input.consequenceType);
      predicates.push(`consequence_type = $${params.length}`);
    }
    params.push(claimToken, claimedBy, expiresAt);
    const claimTokenIndex = params.length - 2;
    const claimedByIndex = params.length - 1;
    const expiresAtIndex = params.length;

    const result = await client.query(
      `WITH candidate AS (
          SELECT review_id
            FROM ${RELEASE_REVIEWER_QUEUE_TABLE}
           WHERE ${predicates.join(' AND ')}
           ORDER BY risk_rank DESC, created_at ASC, review_id ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        UPDATE ${RELEASE_REVIEWER_QUEUE_TABLE} queue
           SET claim_token = $${claimTokenIndex},
               claimed_by = $${claimedByIndex},
               claimed_at = $1::timestamptz,
               claim_expires_at = $${expiresAtIndex}::timestamptz,
               claim_version = claim_version + 1
          FROM candidate
         WHERE queue.review_id = candidate.review_id
         RETURNING queue.review_id,
                   queue.decision_id,
                   queue.status,
                   queue.authority_state,
                   queue.risk_class,
                   queue.claim_token,
                   queue.claimed_by,
                   queue.claimed_at,
                   queue.claim_expires_at,
                   queue.claim_version,
                   queue.record_json`,
      params,
    );

    return result.rows[0] ? rowToClaim(result.rows[0]) : null;
  });
}

async function releaseClaim(
  input: SharedReleaseReviewerQueueReleaseClaimInput,
): Promise<boolean> {
  await ensureReviewerQueueTable();
  return withReleaseAuthorityTransaction(async (client) => {
    const result = await client.query(
      `UPDATE ${RELEASE_REVIEWER_QUEUE_TABLE}
          SET claim_token = NULL,
              claimed_by = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL
        WHERE review_id = $1
          AND claim_token = $2
        RETURNING review_id`,
      [input.reviewId, input.claimToken],
    );
    return result.rows.length > 0;
  });
}

async function summary(): Promise<SharedReleaseReviewerQueueStoreSummary> {
  await ensureReviewerQueueTable();
  const [component, stats] = await Promise.all([
    getReleaseAuthorityComponent(RELEASE_REVIEWER_QUEUE_COMPONENT),
    withReleaseAuthorityTransaction(async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS total_records,
                COUNT(*) FILTER (WHERE status = 'pending-review')::int AS pending_records,
                COUNT(*) FILTER (
                  WHERE claim_token IS NOT NULL
                    AND claim_expires_at > NOW()
                )::int AS active_claims
           FROM ${RELEASE_REVIEWER_QUEUE_TABLE}`,
      );
      return result.rows[0] ?? {};
    }),
  ]);

  return Object.freeze({
    component: RELEASE_REVIEWER_QUEUE_COMPONENT,
    table: RELEASE_REVIEWER_QUEUE_TABLE,
    totalRecords: requireInteger(stats.total_records ?? 0, 'total_records'),
    pendingRecords: requireInteger(stats.pending_records ?? 0, 'pending_records'),
    activeClaims: requireInteger(stats.active_claims ?? 0, 'active_claims'),
    componentStatus: component?.status ?? 'pending',
  });
}

export async function ensureSharedReleaseReviewerQueueStore(): Promise<SharedReleaseReviewerQueueStoreSummary> {
  await ensureReviewerQueueTable();
  return summary();
}

export function createSharedReleaseReviewerQueueStore(): SharedReleaseReviewerQueueStore {
  return Object.freeze({
    upsert,
    async get(id: string): Promise<ReleaseReviewerQueueDetail | null> {
      return (await getRecord(id))?.detail ?? null;
    },
    getRecord,
    listPending,
    claimNextPending,
    releaseClaim,
    summary,
  });
}

export async function resetSharedReleaseReviewerQueueStoreForTests(): Promise<void> {
  initPromise = null;
  await resetReleaseAuthorityStoreForTests();
}
