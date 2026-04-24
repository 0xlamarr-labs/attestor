import {
  evidence,
  type IssuedReleaseEvidencePack,
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

const RELEASE_EVIDENCE_PACK_COMPONENT = 'release-evidence-pack-store';
const RELEASE_EVIDENCE_PACK_TABLE =
  `${RELEASE_AUTHORITY_SCHEMA}.release_evidence_packs`;
const SHARED_RELEASE_EVIDENCE_PACK_STORE_VERSION = 1;

type PgQueryResultRow = Record<string, unknown>;

export interface SharedReleaseEvidencePackStoreSummary {
  readonly component: typeof RELEASE_EVIDENCE_PACK_COMPONENT;
  readonly table: typeof RELEASE_EVIDENCE_PACK_TABLE;
  readonly totalPacks: number;
  readonly latestIssuedAt: string | null;
  readonly componentStatus: 'pending' | 'ready';
}

export interface SharedReleaseEvidencePackStore {
  upsert(pack: IssuedReleaseEvidencePack): Promise<IssuedReleaseEvidencePack>;
  get(id: string): Promise<IssuedReleaseEvidencePack | null>;
  summary(): Promise<SharedReleaseEvidencePackStoreSummary>;
}

export class SharedReleaseEvidencePackStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedReleaseEvidencePackStoreError';
  }
}

let initPromise: Promise<void> | null = null;

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) {
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new SharedReleaseEvidencePackStoreError(
      `Shared release evidence pack row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SharedReleaseEvidencePackStoreError(
      `Shared release evidence pack row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireNullableIso(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed =
    value instanceof Date
      ? value
      : new Date(requireString(value, fieldName));
  if (Number.isNaN(parsed.getTime())) {
    throw new SharedReleaseEvidencePackStoreError(
      `Shared release evidence pack row has invalid ${fieldName}.`,
    );
  }
  return parsed.toISOString();
}

function rowJsonObject(row: PgQueryResultRow): Record<string, unknown> {
  const value = row.pack_json;
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new SharedReleaseEvidencePackStoreError(
    'Shared release evidence pack row has invalid pack_json.',
  );
}

function verifyAndFreezePack(pack: IssuedReleaseEvidencePack): IssuedReleaseEvidencePack {
  try {
    evidence.verifyIssuedReleaseEvidencePack({ issuedEvidencePack: pack });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SharedReleaseEvidencePackStoreError(
      `Shared release evidence pack failed integrity verification: ${message}`,
    );
  }
  return Object.freeze({
    ...pack,
    evidencePack: Object.freeze({
      ...pack.evidencePack,
      findings: Object.freeze(pack.evidencePack.findings.map((finding) => Object.freeze({ ...finding }))),
      artifacts: Object.freeze(pack.evidencePack.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
    }),
    statement: Object.freeze(pack.statement),
    envelope: Object.freeze({
      ...pack.envelope,
      signatures: Object.freeze(pack.envelope.signatures.map((signature) => Object.freeze({ ...signature }))),
    }),
    verificationKey: Object.freeze({ ...pack.verificationKey }),
  });
}

function rowToPack(row: PgQueryResultRow): IssuedReleaseEvidencePack {
  const pack = verifyAndFreezePack(rowJsonObject(row) as unknown as IssuedReleaseEvidencePack);
  if (pack.evidencePack.id !== requireString(row.pack_id, 'pack_id')) {
    throw new SharedReleaseEvidencePackStoreError(
      'Shared release evidence pack row is inconsistent for pack_id.',
    );
  }
  if (pack.statement.predicate.decision.id !== requireString(row.decision_id, 'decision_id')) {
    throw new SharedReleaseEvidencePackStoreError(
      'Shared release evidence pack row is inconsistent for decision_id.',
    );
  }
  if (pack.bundleDigest !== requireString(row.bundle_digest, 'bundle_digest')) {
    throw new SharedReleaseEvidencePackStoreError(
      'Shared release evidence pack row is inconsistent for bundle_digest.',
    );
  }
  return pack;
}

async function ensureEvidencePackTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureReleaseAuthorityStore();
      await withReleaseAuthorityTransaction(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${RELEASE_EVIDENCE_PACK_TABLE} (
            pack_id TEXT PRIMARY KEY,
            decision_id TEXT NOT NULL,
            bundle_digest TEXT NOT NULL UNIQUE,
            issued_at TIMESTAMPTZ NOT NULL,
            key_id TEXT NOT NULL,
            public_key_fingerprint TEXT NOT NULL,
            pack_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS release_evidence_packs_decision_idx
            ON ${RELEASE_EVIDENCE_PACK_TABLE} (decision_id);

          CREATE INDEX IF NOT EXISTS release_evidence_packs_issued_idx
            ON ${RELEASE_EVIDENCE_PACK_TABLE} (issued_at DESC, pack_id ASC);
        `);
      });

      const currentRecord = await getReleaseAuthorityComponent(RELEASE_EVIDENCE_PACK_COMPONENT);
      await recordReleaseAuthorityComponentState({
        component: RELEASE_EVIDENCE_PACK_COMPONENT,
        status: 'ready',
        migratedAt: currentRecord?.migratedAt ?? new Date().toISOString(),
        metadata: {
          ...(currentRecord?.metadata ?? {}),
          sharedStore: 'postgres',
          storeVersion: SHARED_RELEASE_EVIDENCE_PACK_STORE_VERSION,
          table: RELEASE_EVIDENCE_PACK_TABLE,
          integrityDiscipline: 'verify-dsse-and-bundle-digest-on-read-and-write',
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

async function upsertPack(
  client: ReleaseAuthorityPgClient,
  input: IssuedReleaseEvidencePack,
): Promise<IssuedReleaseEvidencePack> {
  const pack = verifyAndFreezePack(input);
  await client.query(
    `INSERT INTO ${RELEASE_EVIDENCE_PACK_TABLE} (
      pack_id,
      decision_id,
      bundle_digest,
      issued_at,
      key_id,
      public_key_fingerprint,
      pack_json
    ) VALUES (
      $1,
      $2,
      $3,
      $4::timestamptz,
      $5,
      $6,
      $7::jsonb
    )
    ON CONFLICT (pack_id) DO UPDATE SET
      decision_id = EXCLUDED.decision_id,
      bundle_digest = EXCLUDED.bundle_digest,
      issued_at = EXCLUDED.issued_at,
      key_id = EXCLUDED.key_id,
      public_key_fingerprint = EXCLUDED.public_key_fingerprint,
      pack_json = EXCLUDED.pack_json,
      updated_at = NOW()`,
    [
      pack.evidencePack.id,
      pack.statement.predicate.decision.id,
      pack.bundleDigest,
      pack.issuedAt,
      pack.keyId,
      pack.publicKeyFingerprint,
      JSON.stringify(pack),
    ],
  );
  return pack;
}

async function upsert(pack: IssuedReleaseEvidencePack): Promise<IssuedReleaseEvidencePack> {
  await ensureEvidencePackTable();
  return withReleaseAuthorityTransaction((client) => upsertPack(client, pack));
}

async function get(id: string): Promise<IssuedReleaseEvidencePack | null> {
  await ensureEvidencePackTable();
  return withReleaseAuthorityTransaction(async (client) => {
    const result = await client.query(
      `SELECT pack_id, decision_id, bundle_digest, pack_json
         FROM ${RELEASE_EVIDENCE_PACK_TABLE}
        WHERE pack_id = $1
        LIMIT 1`,
      [id],
    );
    return result.rows[0] ? rowToPack(result.rows[0]) : null;
  });
}

async function summary(): Promise<SharedReleaseEvidencePackStoreSummary> {
  await ensureEvidencePackTable();
  const [component, stats] = await Promise.all([
    getReleaseAuthorityComponent(RELEASE_EVIDENCE_PACK_COMPONENT),
    withReleaseAuthorityTransaction(async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS total_packs,
                MAX(issued_at) AS latest_issued_at
           FROM ${RELEASE_EVIDENCE_PACK_TABLE}`,
      );
      return result.rows[0] ?? {};
    }),
  ]);
  return Object.freeze({
    component: RELEASE_EVIDENCE_PACK_COMPONENT,
    table: RELEASE_EVIDENCE_PACK_TABLE,
    totalPacks: requireInteger(stats.total_packs ?? 0, 'total_packs'),
    latestIssuedAt: requireNullableIso(stats.latest_issued_at ?? null, 'latest_issued_at'),
    componentStatus: component?.status ?? 'pending',
  });
}

export async function ensureSharedReleaseEvidencePackStore(): Promise<
  SharedReleaseEvidencePackStoreSummary
> {
  await ensureEvidencePackTable();
  return summary();
}

export function createSharedReleaseEvidencePackStore(): SharedReleaseEvidencePackStore {
  return Object.freeze({
    upsert,
    get,
    summary,
  });
}

export async function resetSharedReleaseEvidencePackStoreForTests(): Promise<void> {
  initPromise = null;
  await resetReleaseAuthorityStoreForTests();
}
