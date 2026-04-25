import { createHash, randomUUID } from 'node:crypto';
import { degradedMode } from '../release-enforcement-plane/index.js';
import type { ReleaseActorReference } from '../release-layer/index.js';
import {
  RELEASE_AUTHORITY_SCHEMA,
  ensureReleaseAuthorityStore,
  getReleaseAuthorityComponent,
  recordReleaseAuthorityComponentState,
  resetReleaseAuthorityStoreForTests,
  withReleaseAuthorityAdvisoryLock,
  type ReleaseAuthorityPgClient,
} from './release-authority-store.js';

const RELEASE_DEGRADED_MODE_GRANTS_COMPONENT = 'release-degraded-mode-grants';
const RELEASE_DEGRADED_MODE_GRANTS_TABLE =
  `${RELEASE_AUTHORITY_SCHEMA}.release_degraded_mode_grants`;
const RELEASE_DEGRADED_MODE_AUDIT_TABLE =
  `${RELEASE_AUTHORITY_SCHEMA}.release_degraded_mode_audit_records`;
const RELEASE_DEGRADED_MODE_MUTATION_LOCK = 'release-degraded-mode-grants-mutate';
const SHARED_RELEASE_DEGRADED_MODE_GRANT_STORE_VERSION = 1;

type PgQueryResultRow = Record<string, unknown>;
type DegradedModeGrant = degradedMode.DegradedModeGrant;
type DegradedModeAuditRecord = degradedMode.DegradedModeAuditRecord;
type DegradedModeAuditAction = degradedMode.DegradedModeAuditAction;
type ListDegradedModeGrantOptions = degradedMode.ListDegradedModeGrantOptions;
type RevokeDegradedModeGrantInput = degradedMode.RevokeDegradedModeGrantInput;
type ConsumeDegradedModeGrantInput = degradedMode.ConsumeDegradedModeGrantInput;
type DegradedModeFailureReasons = NonNullable<ConsumeDegradedModeGrantInput['failureReasons']>;
type DegradedModeOutcome = NonNullable<ConsumeDegradedModeGrantInput['outcome']>;

export interface SharedReleaseDegradedModeGrantStoreSummary {
  readonly component: typeof RELEASE_DEGRADED_MODE_GRANTS_COMPONENT;
  readonly grantsTable: typeof RELEASE_DEGRADED_MODE_GRANTS_TABLE;
  readonly auditTable: typeof RELEASE_DEGRADED_MODE_AUDIT_TABLE;
  readonly grantCount: number;
  readonly auditRecordCount: number;
  readonly auditHead: string | null;
  readonly componentStatus: 'pending' | 'ready';
}

export interface SharedReleaseDegradedModeGrantStore {
  registerGrant(grant: DegradedModeGrant): Promise<DegradedModeGrant>;
  findGrant(id: string): Promise<DegradedModeGrant | null>;
  listGrants(options?: ListDegradedModeGrantOptions): Promise<readonly DegradedModeGrant[]>;
  revokeGrant(input: RevokeDegradedModeGrantInput): Promise<DegradedModeGrant | null>;
  consumeGrant(input: ConsumeDegradedModeGrantInput): Promise<DegradedModeGrant | null>;
  listAuditRecords(): Promise<readonly DegradedModeAuditRecord[]>;
  auditHead(): Promise<string | null>;
  summary(): Promise<SharedReleaseDegradedModeGrantStoreSummary>;
}

export class SharedReleaseDegradedModeGrantStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedReleaseDegradedModeGrantStoreError';
  }
}

let initPromise: Promise<void> | null = null;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(',')}}`;
}

function sha256Digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SharedReleaseDegradedModeGrantStoreError(
      `Shared degraded-mode grant row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) {
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new SharedReleaseDegradedModeGrantStoreError(
      `Shared degraded-mode grant row has invalid ${fieldName}.`,
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
    throw new SharedReleaseDegradedModeGrantStoreError(
      `Shared degraded-mode grant row has invalid ${fieldName}.`,
    );
  }
  return parsed.toISOString();
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0) {
    throw new SharedReleaseDegradedModeGrantStoreError(
      `Shared degraded-mode grant ${fieldName} requires a non-empty value.`,
    );
  }
  return normalized;
}

function normalizeActor(actor: ReleaseActorReference, fieldName: string): ReleaseActorReference {
  if (actor.type !== 'user' && actor.type !== 'service' && actor.type !== 'system') {
    throw new SharedReleaseDegradedModeGrantStoreError(
      `Shared degraded-mode grant ${fieldName}.type must be user, service, or system.`,
    );
  }
  return Object.freeze({
    id: normalizeIdentifier(actor.id, `${fieldName}.id`),
    type: actor.type,
    ...(actor.displayName ? { displayName: actor.displayName.trim() } : {}),
    ...(actor.role ? { role: actor.role.trim() } : {}),
  });
}

function rowJsonObject(row: PgQueryResultRow, fieldName: string): Record<string, unknown> {
  const value = row[fieldName];
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new SharedReleaseDegradedModeGrantStoreError(
    `Shared degraded-mode grant row has invalid ${fieldName}.`,
  );
}

function createGrantDigest(input: Omit<DegradedModeGrant, 'auditDigest'>): string {
  return sha256Digest({
    version: input.version,
    id: input.id,
    state: input.state,
    reason: input.reason,
    scope: input.scope,
    authorizedBy: input.authorizedBy,
    approvedBy: input.approvedBy,
    authorizedAt: input.authorizedAt,
    startsAt: input.startsAt,
    expiresAt: input.expiresAt,
    ticketId: input.ticketId,
    rationale: input.rationale,
    allowedFailureReasons: input.allowedFailureReasons,
    maxUses: input.maxUses,
    remainingUses: input.remainingUses,
    revokedAt: input.revokedAt,
    revokedBy: input.revokedBy,
    revocationReason: input.revocationReason,
  });
}

function recomputeGrantDigest(grant: DegradedModeGrant): string {
  const { auditDigest: _auditDigest, ...withoutDigest } = grant;
  return createGrantDigest(withoutDigest);
}

function createAuditRecord(input: {
  readonly id?: string;
  readonly action: DegradedModeAuditAction;
  readonly grant: DegradedModeGrant;
  readonly recordedAt: string;
  readonly actor?: ReleaseActorReference | null;
  readonly failureReasons?: DegradedModeFailureReasons;
  readonly outcome?: DegradedModeOutcome | null;
  readonly remainingUses: number;
  readonly previousDigest: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): DegradedModeAuditRecord {
  const recordWithoutDigest: Omit<DegradedModeAuditRecord, 'digest'> = {
    version: degradedMode.RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
    id: input.id ?? `dma_${randomUUID().replaceAll('-', '')}`,
    action: input.action,
    grantId: input.grant.id,
    recordedAt: normalizeIso(input.recordedAt, 'recordedAt'),
    actor: input.actor ? normalizeActor(input.actor, 'audit.actor') : null,
    state: input.grant.state,
    scope: input.grant.scope,
    reason: input.grant.reason,
    ticketId: input.grant.ticketId,
    expiresAt: input.grant.expiresAt,
    failureReasons: Object.freeze([...(input.failureReasons ?? [])]),
    outcome: input.outcome ?? null,
    remainingUses: input.remainingUses,
    previousDigest: input.previousDigest,
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  };

  return Object.freeze({
    ...recordWithoutDigest,
    digest: sha256Digest(recordWithoutDigest),
  });
}

function recomputeAuditDigest(record: DegradedModeAuditRecord): string {
  const { digest: _digest, ...withoutDigest } = record;
  return sha256Digest(withoutDigest);
}

function replaceGrantUseBudget(
  grant: DegradedModeGrant,
  remainingUses: number,
): DegradedModeGrant {
  const withoutDigest: Omit<DegradedModeGrant, 'auditDigest'> = Object.freeze({
    ...grant,
    remainingUses,
  });
  return Object.freeze({
    ...withoutDigest,
    auditDigest: createGrantDigest(withoutDigest),
  });
}

function replaceGrantRevocation(
  grant: DegradedModeGrant,
  input: RevokeDegradedModeGrantInput,
): DegradedModeGrant {
  const withoutDigest: Omit<DegradedModeGrant, 'auditDigest'> = Object.freeze({
    ...grant,
    revokedAt: normalizeIso(input.revokedAt, 'revokedAt'),
    revokedBy: normalizeActor(input.revokedBy, 'revokedBy'),
    revocationReason: normalizeIdentifier(input.revocationReason, 'revocationReason'),
  });
  return Object.freeze({
    ...withoutDigest,
    auditDigest: createGrantDigest(withoutDigest),
  });
}

function assertRowField<T>(actual: T, expected: T, fieldName: string): void {
  if (actual !== expected) {
    throw new SharedReleaseDegradedModeGrantStoreError(
      `Shared degraded-mode grant row is inconsistent for ${fieldName}.`,
    );
  }
}

function rowToGrant(row: PgQueryResultRow): DegradedModeGrant {
  const grant = Object.freeze(
    structuredClone(rowJsonObject(row, 'grant_json')),
  ) as unknown as DegradedModeGrant;
  if (grant.version !== degradedMode.RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION) {
    throw new SharedReleaseDegradedModeGrantStoreError(
      'Shared degraded-mode grant has an invalid version.',
    );
  }
  assertRowField(requireString(row.grant_id, 'grant_id'), grant.id, 'grant_id');
  assertRowField(requireString(row.grant_state, 'grant_state'), grant.state, 'grant_state');
  assertRowField(requireString(row.reason, 'reason'), grant.reason, 'reason');
  assertRowField(requireString(row.ticket_id, 'ticket_id'), grant.ticketId, 'ticket_id');
  assertRowField(normalizeIso(row.authorized_at, 'authorized_at'), grant.authorizedAt, 'authorized_at');
  assertRowField(normalizeIso(row.starts_at, 'starts_at'), grant.startsAt, 'starts_at');
  assertRowField(normalizeIso(row.expires_at, 'expires_at'), grant.expiresAt, 'expires_at');
  assertRowField(requireInteger(row.remaining_uses, 'remaining_uses'), grant.remainingUses, 'remaining_uses');
  assertRowField(requireString(row.audit_digest, 'audit_digest'), grant.auditDigest, 'audit_digest');
  if (grant.auditDigest !== recomputeGrantDigest(grant)) {
    throw new SharedReleaseDegradedModeGrantStoreError(
      'Shared degraded-mode grant digest is invalid.',
    );
  }
  return grant;
}

function rowToAuditRecord(row: PgQueryResultRow): DegradedModeAuditRecord {
  const record = Object.freeze(
    structuredClone(rowJsonObject(row, 'audit_json')),
  ) as unknown as DegradedModeAuditRecord;
  if (record.version !== degradedMode.RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION) {
    throw new SharedReleaseDegradedModeGrantStoreError(
      'Shared degraded-mode audit record has an invalid version.',
    );
  }
  assertRowField(requireString(row.audit_id, 'audit_id'), record.id, 'audit_id');
  assertRowField(requireString(row.grant_id, 'grant_id'), record.grantId, 'grant_id');
  assertRowField(requireString(row.action, 'action'), record.action, 'action');
  assertRowField(normalizeIso(row.recorded_at, 'recorded_at'), record.recordedAt, 'recorded_at');
  assertRowField(requireString(row.digest, 'digest'), record.digest, 'digest');
  if (record.digest !== recomputeAuditDigest(record)) {
    throw new SharedReleaseDegradedModeGrantStoreError(
      'Shared degraded-mode audit record digest is invalid.',
    );
  }
  return record;
}

async function latestAuditDigest(client: ReleaseAuthorityPgClient): Promise<string | null> {
  const result = await client.query(
    `SELECT digest
       FROM ${RELEASE_DEGRADED_MODE_AUDIT_TABLE}
      ORDER BY audit_sequence DESC
      LIMIT 1`,
  );
  return typeof result.rows[0]?.digest === 'string' ? result.rows[0]!.digest : null;
}

async function nextAuditSequence(client: ReleaseAuthorityPgClient): Promise<number> {
  const result = await client.query(
    `SELECT COALESCE(MAX(audit_sequence), 0)::int AS latest_sequence
       FROM ${RELEASE_DEGRADED_MODE_AUDIT_TABLE}`,
  );
  return Number(result.rows[0]?.latest_sequence ?? 0) + 1;
}

async function insertAuditRecord(
  client: ReleaseAuthorityPgClient,
  record: DegradedModeAuditRecord,
): Promise<void> {
  const sequence = await nextAuditSequence(client);
  await client.query(
    `INSERT INTO ${RELEASE_DEGRADED_MODE_AUDIT_TABLE} (
      audit_sequence, audit_id, grant_id, action, recorded_at,
      previous_digest, digest, audit_json
    ) VALUES (
      $1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb
    )`,
    [
      sequence,
      record.id,
      record.grantId,
      record.action,
      record.recordedAt,
      record.previousDigest,
      record.digest,
      JSON.stringify(record),
    ],
  );
}

async function upsertGrant(
  client: ReleaseAuthorityPgClient,
  grant: DegradedModeGrant,
): Promise<void> {
  await client.query(
    `INSERT INTO ${RELEASE_DEGRADED_MODE_GRANTS_TABLE} (
      grant_id, grant_state, reason, ticket_id, authorized_at, starts_at,
      expires_at, remaining_uses, audit_digest, grant_json, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
      $7::timestamptz, $8, $9, $10::jsonb, NOW()
    )
    ON CONFLICT (grant_id) DO UPDATE SET
      grant_state = EXCLUDED.grant_state,
      reason = EXCLUDED.reason,
      ticket_id = EXCLUDED.ticket_id,
      authorized_at = EXCLUDED.authorized_at,
      starts_at = EXCLUDED.starts_at,
      expires_at = EXCLUDED.expires_at,
      remaining_uses = EXCLUDED.remaining_uses,
      audit_digest = EXCLUDED.audit_digest,
      grant_json = EXCLUDED.grant_json,
      updated_at = EXCLUDED.updated_at`,
    [
      grant.id,
      grant.state,
      grant.reason,
      grant.ticketId,
      grant.authorizedAt,
      grant.startsAt,
      grant.expiresAt,
      grant.remainingUses,
      grant.auditDigest,
      JSON.stringify(grant),
    ],
  );
}

async function ensureDegradedModeTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureReleaseAuthorityStore();
      await withReleaseAuthorityAdvisoryLock(RELEASE_DEGRADED_MODE_MUTATION_LOCK, async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${RELEASE_DEGRADED_MODE_GRANTS_TABLE} (
            grant_id TEXT PRIMARY KEY,
            grant_state TEXT NOT NULL CHECK (grant_state IN ('cache-only', 'break-glass-open')),
            reason TEXT NOT NULL,
            ticket_id TEXT NOT NULL,
            authorized_at TIMESTAMPTZ NOT NULL,
            starts_at TIMESTAMPTZ NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            remaining_uses INTEGER NOT NULL CHECK (remaining_uses >= 0),
            audit_digest TEXT NOT NULL,
            grant_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS release_degraded_mode_grants_state_idx
            ON ${RELEASE_DEGRADED_MODE_GRANTS_TABLE} (grant_state, expires_at ASC);

          CREATE INDEX IF NOT EXISTS release_degraded_mode_grants_ticket_idx
            ON ${RELEASE_DEGRADED_MODE_GRANTS_TABLE} (ticket_id);

          CREATE TABLE IF NOT EXISTS ${RELEASE_DEGRADED_MODE_AUDIT_TABLE} (
            audit_sequence BIGINT PRIMARY KEY CHECK (audit_sequence >= 1),
            audit_id TEXT NOT NULL UNIQUE,
            grant_id TEXT NOT NULL REFERENCES ${RELEASE_DEGRADED_MODE_GRANTS_TABLE} (grant_id),
            action TEXT NOT NULL CHECK (action IN ('grant-created', 'grant-used', 'grant-denied', 'grant-revoked')),
            recorded_at TIMESTAMPTZ NOT NULL,
            previous_digest TEXT NULL,
            digest TEXT NOT NULL UNIQUE,
            audit_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS release_degraded_mode_audit_grant_idx
            ON ${RELEASE_DEGRADED_MODE_AUDIT_TABLE} (grant_id, audit_sequence ASC);
        `);
      });

      const currentRecord = await getReleaseAuthorityComponent(RELEASE_DEGRADED_MODE_GRANTS_COMPONENT);
      await recordReleaseAuthorityComponentState({
        component: RELEASE_DEGRADED_MODE_GRANTS_COMPONENT,
        status: 'ready',
        migratedAt: currentRecord?.migratedAt ?? new Date().toISOString(),
        metadata: {
          ...(currentRecord?.metadata ?? {}),
          sharedStore: 'postgres',
          storeVersion: SHARED_RELEASE_DEGRADED_MODE_GRANT_STORE_VERSION,
          grantsTable: RELEASE_DEGRADED_MODE_GRANTS_TABLE,
          auditTable: RELEASE_DEGRADED_MODE_AUDIT_TABLE,
          mutationDiscipline: 'transaction-advisory-lock-and-row-lock',
          bootstrapWired: false,
          trackerStep: '06',
        },
      });
    })();
  }
  await initPromise;
}

export async function ensureSharedReleaseDegradedModeGrantStore(): Promise<
  SharedReleaseDegradedModeGrantStoreSummary
> {
  await ensureDegradedModeTables();
  return createSharedReleaseDegradedModeGrantStore().summary();
}

export function createSharedReleaseDegradedModeGrantStore(): SharedReleaseDegradedModeGrantStore {
  async function selectGrantForUpdate(
    client: ReleaseAuthorityPgClient,
    id: string,
  ): Promise<DegradedModeGrant | null> {
    const result = await client.query(
      `SELECT *
         FROM ${RELEASE_DEGRADED_MODE_GRANTS_TABLE}
        WHERE grant_id = $1
        FOR UPDATE`,
      [id],
    );
    return result.rows.length === 0 ? null : rowToGrant(result.rows[0]!);
  }

  return Object.freeze({
    async registerGrant(grant: DegradedModeGrant): Promise<DegradedModeGrant> {
      await ensureDegradedModeTables();
      const normalizedGrant = Object.freeze(structuredClone(grant)) as DegradedModeGrant;
      if (normalizedGrant.auditDigest !== recomputeGrantDigest(normalizedGrant)) {
        throw new SharedReleaseDegradedModeGrantStoreError(
          'Shared degraded-mode grant cannot register a grant with an invalid digest.',
        );
      }

      return withReleaseAuthorityAdvisoryLock(RELEASE_DEGRADED_MODE_MUTATION_LOCK, async (client) => {
        const existing = await selectGrantForUpdate(client, normalizedGrant.id);
        if (existing) {
          throw new SharedReleaseDegradedModeGrantStoreError(
            `Shared degraded-mode grant already exists: ${normalizedGrant.id}`,
          );
        }
        await upsertGrant(client, normalizedGrant);
        const auditRecord = createAuditRecord({
          action: 'grant-created',
          grant: normalizedGrant,
          recordedAt: normalizedGrant.authorizedAt,
          actor: normalizedGrant.authorizedBy,
          failureReasons: normalizedGrant.allowedFailureReasons,
          outcome: null,
          remainingUses: normalizedGrant.remainingUses,
          previousDigest: await latestAuditDigest(client),
          metadata: { auditDigest: normalizedGrant.auditDigest },
        });
        await insertAuditRecord(client, auditRecord);
        return normalizedGrant;
      });
    },

    async findGrant(id: string): Promise<DegradedModeGrant | null> {
      await ensureDegradedModeTables();
      const result = await withReleaseAuthorityAdvisoryLock('release-degraded-mode-grants-read', (client) =>
        client.query(
          `SELECT *
             FROM ${RELEASE_DEGRADED_MODE_GRANTS_TABLE}
            WHERE grant_id = $1
            LIMIT 1`,
          [normalizeIdentifier(id, 'id')],
        ),
      );
      return result.rows.length === 0 ? null : rowToGrant(result.rows[0]!);
    },

    async listGrants(options?: ListDegradedModeGrantOptions): Promise<readonly DegradedModeGrant[]> {
      await ensureDegradedModeTables();
      const result = await withReleaseAuthorityAdvisoryLock('release-degraded-mode-grants-read', (client) =>
        client.query(
          `SELECT *
             FROM ${RELEASE_DEGRADED_MODE_GRANTS_TABLE}
            ORDER BY authorized_at ASC, grant_id ASC`,
        ),
      );
      const checkedAt = options?.checkedAt ?? new Date().toISOString();
      const status = options?.status ?? 'all';
      return Object.freeze(
        result.rows
          .map(rowToGrant)
          .filter((grant) => {
            if (status !== 'all' && degradedMode.degradedModeGrantStatus(grant, checkedAt) !== status) {
              return false;
            }
            return options?.scope
              ? degradedMode.degradedModeScopeMatches(grant.scope, options.scope)
              : true;
          }),
      );
    },

    async revokeGrant(input: RevokeDegradedModeGrantInput): Promise<DegradedModeGrant | null> {
      await ensureDegradedModeTables();
      return withReleaseAuthorityAdvisoryLock(RELEASE_DEGRADED_MODE_MUTATION_LOCK, async (client) => {
        const current = await selectGrantForUpdate(client, normalizeIdentifier(input.id, 'id'));
        if (!current) return null;
        const revoked = replaceGrantRevocation(current, input);
        await upsertGrant(client, revoked);
        await insertAuditRecord(
          client,
          createAuditRecord({
            action: 'grant-revoked',
            grant: revoked,
            recordedAt: revoked.revokedAt ?? input.revokedAt,
            actor: revoked.revokedBy,
            failureReasons: [],
            outcome: null,
            remainingUses: revoked.remainingUses,
            previousDigest: await latestAuditDigest(client),
            metadata: { revocationReason: revoked.revocationReason },
          }),
        );
        return revoked;
      });
    },

    async consumeGrant(input: ConsumeDegradedModeGrantInput): Promise<DegradedModeGrant | null> {
      await ensureDegradedModeTables();
      return withReleaseAuthorityAdvisoryLock(RELEASE_DEGRADED_MODE_MUTATION_LOCK, async (client) => {
        const current = await selectGrantForUpdate(client, normalizeIdentifier(input.id, 'id'));
        if (
          !current ||
          degradedMode.degradedModeGrantStatus(current, input.checkedAt) !== 'active'
        ) {
          return null;
        }
        const consumed = replaceGrantUseBudget(current, current.remainingUses - 1);
        await upsertGrant(client, consumed);
        await insertAuditRecord(
          client,
          createAuditRecord({
            action: 'grant-used',
            grant: consumed,
            recordedAt: input.checkedAt,
            actor: input.actor ?? null,
            failureReasons: input.failureReasons ?? [],
            outcome: input.outcome ?? null,
            remainingUses: consumed.remainingUses,
            previousDigest: await latestAuditDigest(client),
            metadata: input.metadata,
          }),
        );
        return consumed;
      });
    },

    async listAuditRecords(): Promise<readonly DegradedModeAuditRecord[]> {
      await ensureDegradedModeTables();
      const result = await withReleaseAuthorityAdvisoryLock('release-degraded-mode-grants-read', (client) =>
        client.query(
          `SELECT *
             FROM ${RELEASE_DEGRADED_MODE_AUDIT_TABLE}
            ORDER BY audit_sequence ASC`,
        ),
      );
      const records = result.rows.map(rowToAuditRecord);
      let previousDigest: string | null = null;
      for (const record of records) {
        if (record.previousDigest !== previousDigest) {
          throw new SharedReleaseDegradedModeGrantStoreError(
            'Shared degraded-mode audit chain is invalid.',
          );
        }
        previousDigest = record.digest;
      }
      return Object.freeze(records);
    },

    async auditHead(): Promise<string | null> {
      await ensureDegradedModeTables();
      return withReleaseAuthorityAdvisoryLock('release-degraded-mode-grants-read', latestAuditDigest);
    },

    async summary(): Promise<SharedReleaseDegradedModeGrantStoreSummary> {
      await ensureDegradedModeTables();
      const result = await withReleaseAuthorityAdvisoryLock('release-degraded-mode-grants-read', async (client) => {
        const grantCount = await client.query(
          `SELECT COUNT(*)::int AS count
             FROM ${RELEASE_DEGRADED_MODE_GRANTS_TABLE}`,
        );
        const auditCount = await client.query(
          `SELECT COUNT(*)::int AS count
             FROM ${RELEASE_DEGRADED_MODE_AUDIT_TABLE}`,
        );
        const head = await latestAuditDigest(client);
        return {
          grantCount: Number(grantCount.rows[0]?.count ?? 0),
          auditRecordCount: Number(auditCount.rows[0]?.count ?? 0),
          auditHead: head,
        };
      });
      const component = await getReleaseAuthorityComponent(RELEASE_DEGRADED_MODE_GRANTS_COMPONENT);
      return Object.freeze({
        component: RELEASE_DEGRADED_MODE_GRANTS_COMPONENT,
        grantsTable: RELEASE_DEGRADED_MODE_GRANTS_TABLE,
        auditTable: RELEASE_DEGRADED_MODE_AUDIT_TABLE,
        grantCount: result.grantCount,
        auditRecordCount: result.auditRecordCount,
        auditHead: result.auditHead,
        componentStatus: component?.status ?? 'pending',
      });
    },
  });
}

export async function resetSharedReleaseDegradedModeGrantStoreForTests(): Promise<void> {
  initPromise = null;
  await resetReleaseAuthorityStoreForTests();
}
