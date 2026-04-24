import { createHash } from 'node:crypto';
import type { ReleaseRuntimeStoreComponent } from './bootstrap/runtime-profile.js';

type PgQueryResultRow = Record<string, unknown>;
export type ReleaseAuthorityPgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: PgQueryResultRow[] }>;
  release: () => void;
};
type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: PgQueryResultRow[] }>;
  connect: () => Promise<ReleaseAuthorityPgClient>;
  end: () => Promise<void>;
};

export const ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV =
  'ATTESTOR_RELEASE_AUTHORITY_PG_URL';
export const RELEASE_AUTHORITY_SCHEMA = 'attestor_release_authority';
export const RELEASE_AUTHORITY_SCHEMA_VERSION = 1;

export const RELEASE_AUTHORITY_COMPONENTS = Object.freeze([
  'release-decision-log',
  'release-reviewer-queue',
  'release-token-introspection',
  'release-evidence-pack-store',
  'release-degraded-mode-grants',
  'policy-control-plane-store',
  'policy-activation-approval-store',
  'policy-mutation-audit-log',
] satisfies readonly ReleaseRuntimeStoreComponent[]);

export type ReleaseAuthorityComponentStatus = 'pending' | 'ready';

export interface ReleaseAuthorityComponentRecord {
  readonly component: ReleaseRuntimeStoreComponent;
  readonly desiredMode: 'shared';
  readonly status: ReleaseAuthorityComponentStatus;
  readonly schemaVersion: number;
  readonly bootstrappedAt: string;
  readonly updatedAt: string;
  readonly migratedAt: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface ReleaseAuthorityStoreSummary {
  readonly mode: 'postgres' | 'disabled';
  readonly configured: boolean;
  readonly schema: typeof RELEASE_AUTHORITY_SCHEMA | null;
  readonly schemaVersion: number | null;
  readonly componentCount: number;
  readonly readyComponentCount: number;
}

export interface RecordReleaseAuthorityComponentStateInput {
  readonly component: ReleaseRuntimeStoreComponent;
  readonly status: ReleaseAuthorityComponentStatus;
  readonly migratedAt?: string | null;
  readonly metadata?: Record<string, unknown>;
}

let poolPromise: Promise<PgPool> | null = null;
let initPromise: Promise<void> | null = null;

function connectionString(): string | null {
  return process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV]?.trim() || null;
}

function componentOrder(component: ReleaseRuntimeStoreComponent): number {
  return RELEASE_AUTHORITY_COMPONENTS.indexOf(component);
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function advisoryLockKeys(lockName: string): [number, number] {
  const digest = createHash('sha256').update(lockName).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function normalizeTimestamp(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Release authority store requires a valid ${fieldName} timestamp.`);
  }
  return parsed.toISOString();
}

function rowToComponentRecord(row: PgQueryResultRow): ReleaseAuthorityComponentRecord {
  return Object.freeze({
    component: String(row.component_id) as ReleaseRuntimeStoreComponent,
    desiredMode: 'shared',
    status: String(row.status) as ReleaseAuthorityComponentStatus,
    schemaVersion: Number(row.schema_version),
    bootstrappedAt: new Date(String(row.bootstrapped_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    migratedAt: row.migrated_at === null ? null : new Date(String(row.migrated_at)).toISOString(),
    metadata: metadataObject(row.metadata_json),
  });
}

function assertComponent(component: ReleaseRuntimeStoreComponent): void {
  if (!RELEASE_AUTHORITY_COMPONENTS.includes(component)) {
    throw new Error(`Unsupported release authority component '${component}'.`);
  }
}

export function releaseAuthorityStoreMode(): 'postgres' | 'disabled' {
  return connectionString() ? 'postgres' : 'disabled';
}

export function isReleaseAuthorityStoreConfigured(): boolean {
  return releaseAuthorityStoreMode() === 'postgres';
}

export function releaseAuthorityStoreSource(): string | null {
  return connectionString();
}

async function getPool(): Promise<PgPool> {
  const connectionUrl = connectionString();
  if (!connectionUrl) {
    throw new Error(
      `Release authority shared store is disabled. Set ${ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV}.`,
    );
  }
  if (!poolPromise) {
    poolPromise = (async () => {
      const pg = await (Function('return import("pg")')() as Promise<any>);
      const Pool = pg.Pool ?? pg.default?.Pool;
      if (!Pool) {
        throw new Error('pg.Pool is not available for the release authority shared store.');
      }
      return new Pool({ connectionString: connectionUrl }) as PgPool;
    })();
  }
  return poolPromise;
}

async function ensureSchema(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = await getPool();
      await pool.query(`
        CREATE SCHEMA IF NOT EXISTS ${RELEASE_AUTHORITY_SCHEMA};

        CREATE TABLE IF NOT EXISTS ${RELEASE_AUTHORITY_SCHEMA}.schema_metadata (
          singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
          schema_version INTEGER NOT NULL,
          bootstrapped_at TIMESTAMPTZ NOT NULL,
          last_bootstrapped_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${RELEASE_AUTHORITY_SCHEMA}.shared_store_components (
          component_id TEXT PRIMARY KEY,
          desired_mode TEXT NOT NULL CHECK (desired_mode = 'shared'),
          status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
          schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
          bootstrapped_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          migrated_at TIMESTAMPTZ NULL,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
        );
      `);

      await pool.query(
        `INSERT INTO ${RELEASE_AUTHORITY_SCHEMA}.schema_metadata (
          singleton, schema_version, bootstrapped_at, last_bootstrapped_at
        ) VALUES (
          TRUE, $1, NOW(), NOW()
        )
        ON CONFLICT (singleton) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          last_bootstrapped_at = EXCLUDED.last_bootstrapped_at`,
        [RELEASE_AUTHORITY_SCHEMA_VERSION],
      );

      for (const component of RELEASE_AUTHORITY_COMPONENTS) {
        await pool.query(
          `INSERT INTO ${RELEASE_AUTHORITY_SCHEMA}.shared_store_components (
            component_id, desired_mode, status, schema_version, bootstrapped_at, updated_at, migrated_at, metadata_json
          ) VALUES (
            $1, 'shared', 'pending', $2, NOW(), NOW(), NULL, '{}'::jsonb
          )
          ON CONFLICT (component_id) DO NOTHING`,
          [component, RELEASE_AUTHORITY_SCHEMA_VERSION],
        );
      }
    })();
  }
  await initPromise;
}

export async function ensureReleaseAuthorityStore(): Promise<ReleaseAuthorityStoreSummary> {
  if (!isReleaseAuthorityStoreConfigured()) {
    return Object.freeze({
      mode: 'disabled',
      configured: false,
      schema: null,
      schemaVersion: null,
      componentCount: 0,
      readyComponentCount: 0,
    });
  }

  await ensureSchema();
  const pool = await getPool();
  const [schemaResult, componentResult] = await Promise.all([
    pool.query(`
      SELECT schema_version
        FROM ${RELEASE_AUTHORITY_SCHEMA}.schema_metadata
       WHERE singleton = TRUE
       LIMIT 1
    `),
    pool.query(`
      SELECT COUNT(*)::int AS component_count,
             COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_component_count
        FROM ${RELEASE_AUTHORITY_SCHEMA}.shared_store_components
    `),
  ]);

  const schemaVersion = Number(schemaResult.rows[0]?.schema_version ?? RELEASE_AUTHORITY_SCHEMA_VERSION);
  const componentCount = Number(componentResult.rows[0]?.component_count ?? 0);
  const readyComponentCount = Number(componentResult.rows[0]?.ready_component_count ?? 0);

  return Object.freeze({
    mode: 'postgres',
    configured: true,
    schema: RELEASE_AUTHORITY_SCHEMA,
    schemaVersion,
    componentCount,
    readyComponentCount,
  });
}

export async function listReleaseAuthorityComponents(): Promise<
  readonly ReleaseAuthorityComponentRecord[]
> {
  await ensureSchema();
  const pool = await getPool();
  const result = await pool.query(`
    SELECT component_id, status, schema_version, bootstrapped_at, updated_at, migrated_at, metadata_json
      FROM ${RELEASE_AUTHORITY_SCHEMA}.shared_store_components
     ORDER BY component_id ASC
  `);

  return Object.freeze(
    result.rows
      .map(rowToComponentRecord)
      .sort((left, right) => componentOrder(left.component) - componentOrder(right.component)),
  );
}

export async function getReleaseAuthorityComponent(
  component: ReleaseRuntimeStoreComponent,
): Promise<ReleaseAuthorityComponentRecord | null> {
  assertComponent(component);
  await ensureSchema();
  const pool = await getPool();
  const result = await pool.query(
    `SELECT component_id, status, schema_version, bootstrapped_at, updated_at, migrated_at, metadata_json
       FROM ${RELEASE_AUTHORITY_SCHEMA}.shared_store_components
      WHERE component_id = $1
      LIMIT 1`,
    [component],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return rowToComponentRecord(result.rows[0]!);
}

export async function withReleaseAuthorityTransaction<T>(
  action: (client: ReleaseAuthorityPgClient) => Promise<T>,
): Promise<T> {
  await ensureSchema();
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function withReleaseAuthorityAdvisoryLock<T>(
  lockName: string,
  action: (client: ReleaseAuthorityPgClient) => Promise<T>,
): Promise<T> {
  const [key1, key2] = advisoryLockKeys(lockName);
  return withReleaseAuthorityTransaction(async (client) => {
    await client.query(
      'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
      [key1, key2],
    );
    return action(client);
  });
}

export async function recordReleaseAuthorityComponentState(
  input: RecordReleaseAuthorityComponentStateInput,
): Promise<ReleaseAuthorityComponentRecord> {
  assertComponent(input.component);
  await ensureSchema();
  const pool = await getPool();
  const migratedAt =
    input.status === 'ready'
      ? normalizeTimestamp(input.migratedAt, 'migratedAt') ?? new Date().toISOString()
      : normalizeTimestamp(input.migratedAt, 'migratedAt');

  const result = await pool.query(
    `INSERT INTO ${RELEASE_AUTHORITY_SCHEMA}.shared_store_components (
      component_id, desired_mode, status, schema_version, bootstrapped_at, updated_at, migrated_at, metadata_json
    ) VALUES (
      $1, 'shared', $2, $3, NOW(), NOW(), $4::timestamptz, $5::jsonb
    )
    ON CONFLICT (component_id) DO UPDATE SET
      status = EXCLUDED.status,
      schema_version = EXCLUDED.schema_version,
      updated_at = EXCLUDED.updated_at,
      migrated_at = EXCLUDED.migrated_at,
      metadata_json = EXCLUDED.metadata_json
    RETURNING component_id, status, schema_version, bootstrapped_at, updated_at, migrated_at, metadata_json`,
    [
      input.component,
      input.status,
      RELEASE_AUTHORITY_SCHEMA_VERSION,
      migratedAt,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  return rowToComponentRecord(result.rows[0]!);
}

export async function resetReleaseAuthorityStoreForTests(): Promise<void> {
  const existingPoolPromise = poolPromise;
  const configured = isReleaseAuthorityStoreConfigured();
  poolPromise = null;
  initPromise = null;

  if (!existingPoolPromise && !connectionString()) {
    return;
  }

  if (!configured) {
    if (existingPoolPromise) {
      try {
        const pool = await existingPoolPromise;
        await pool.end();
      } catch {
        // Test cleanup must be able to recover after an intentionally
        // unreachable shared-store URL leaves the lazy pool promise rejected.
      }
    }
    return;
  }

  const pool = existingPoolPromise ? await existingPoolPromise : await getPool();
  await pool.query(`DROP SCHEMA IF EXISTS ${RELEASE_AUTHORITY_SCHEMA} CASCADE`);
  await pool.end();
}

export async function closeReleaseAuthorityStorePoolForTests(): Promise<void> {
  const existingPoolPromise = poolPromise;
  poolPromise = null;
  initPromise = null;

  if (!existingPoolPromise) {
    return;
  }

  try {
    const pool = await existingPoolPromise;
    await pool.end();
  } catch {
    // Test reconnect probes intentionally exercise failed or closed pools.
  }
}
