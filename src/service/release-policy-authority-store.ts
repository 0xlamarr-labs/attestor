import {
  activationApprovals,
  auditLog,
  objectModel,
  store as policyStore,
} from '../release-policy-control-plane/index.js';
import {
  RELEASE_AUTHORITY_SCHEMA,
  ensureReleaseAuthorityStore,
  getReleaseAuthorityComponent,
  recordReleaseAuthorityComponentState,
  resetReleaseAuthorityStoreForTests,
  withReleaseAuthorityAdvisoryLock,
  type ReleaseAuthorityPgClient,
} from './release-authority-store.js';

const POLICY_CONTROL_PLANE_COMPONENT = 'policy-control-plane-store';
const POLICY_ACTIVATION_APPROVAL_COMPONENT = 'policy-activation-approval-store';
const POLICY_MUTATION_AUDIT_COMPONENT = 'policy-mutation-audit-log';
const POLICY_STORE_MUTATION_LOCK = 'policy-control-plane-store-mutate';
const POLICY_APPROVAL_MUTATION_LOCK = 'policy-activation-approval-store-mutate';
const POLICY_AUDIT_APPEND_LOCK = 'policy-mutation-audit-log-append';
const SHARED_POLICY_AUTHORITY_STORE_VERSION = 1;

const POLICY_METADATA_TABLE = `${RELEASE_AUTHORITY_SCHEMA}.policy_control_plane_metadata`;
const POLICY_PACKS_TABLE = `${RELEASE_AUTHORITY_SCHEMA}.policy_packs`;
const POLICY_BUNDLES_TABLE = `${RELEASE_AUTHORITY_SCHEMA}.policy_bundles`;
const POLICY_ACTIVATIONS_TABLE = `${RELEASE_AUTHORITY_SCHEMA}.policy_activations`;
const POLICY_ACTIVATION_APPROVALS_TABLE =
  `${RELEASE_AUTHORITY_SCHEMA}.policy_activation_approvals`;
const POLICY_MUTATION_AUDIT_TABLE =
  `${RELEASE_AUTHORITY_SCHEMA}.policy_mutation_audit_entries`;

type PgQueryResultRow = Record<string, unknown>;
type PolicyControlPlaneMetadata = ReturnType<typeof objectModel.createPolicyControlPlaneMetadata>;
type PolicyPackMetadata = ReturnType<typeof objectModel.createPolicyPackMetadata>;
type PolicyActivationRecord = ReturnType<typeof objectModel.createPolicyActivationRecord>;
type StoredPolicyBundleRecord = policyStore.StoredPolicyBundleRecord;
type UpsertStoredPolicyBundleInput = policyStore.UpsertStoredPolicyBundleInput;
type PolicyStoreSnapshot = ReturnType<
  ReturnType<typeof policyStore.createInMemoryPolicyControlPlaneStore>['exportSnapshot']
>;
type PolicyActivationApprovalRequest =
  activationApprovals.PolicyActivationApprovalRequest;
type PolicyActivationApprovalStoreSnapshot = ReturnType<
  ReturnType<typeof activationApprovals.createInMemoryPolicyActivationApprovalStore>['exportSnapshot']
>;
type PolicyActivationApprovalState =
  activationApprovals.PolicyActivationApprovalState;
type PolicyMutationAuditAppendInput = auditLog.PolicyMutationAuditAppendInput;
type PolicyMutationAuditEntry = auditLog.PolicyMutationAuditEntry;
type PolicyMutationAuditVerificationResult =
  auditLog.PolicyMutationAuditVerificationResult;
type PolicyMutationAuditSnapshot = ReturnType<
  ReturnType<typeof auditLog.createInMemoryPolicyMutationAuditLogWriter>['exportSnapshot']
>;

export interface SharedPolicyControlPlaneStoreSummary {
  readonly component: typeof POLICY_CONTROL_PLANE_COMPONENT;
  readonly metadataTable: typeof POLICY_METADATA_TABLE;
  readonly packsTable: typeof POLICY_PACKS_TABLE;
  readonly bundlesTable: typeof POLICY_BUNDLES_TABLE;
  readonly activationsTable: typeof POLICY_ACTIVATIONS_TABLE;
  readonly packCount: number;
  readonly bundleCount: number;
  readonly activationCount: number;
  readonly hasMetadata: boolean;
  readonly componentStatus: 'pending' | 'ready';
}

export interface SharedPolicyActivationApprovalStoreSummary {
  readonly component: typeof POLICY_ACTIVATION_APPROVAL_COMPONENT;
  readonly table: typeof POLICY_ACTIVATION_APPROVALS_TABLE;
  readonly requestCount: number;
  readonly pendingCount: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
  readonly componentStatus: 'pending' | 'ready';
}

export interface SharedPolicyMutationAuditLogSummary {
  readonly component: typeof POLICY_MUTATION_AUDIT_COMPONENT;
  readonly table: typeof POLICY_MUTATION_AUDIT_TABLE;
  readonly entryCount: number;
  readonly latestSequence: number;
  readonly latestEntryDigest: string | null;
  readonly componentStatus: 'pending' | 'ready';
}

export interface SharedPolicyControlPlaneStore {
  getMetadata(): Promise<PolicyControlPlaneMetadata | null>;
  setMetadata(metadata: PolicyControlPlaneMetadata): Promise<PolicyControlPlaneMetadata>;
  upsertPack(pack: PolicyPackMetadata): Promise<PolicyPackMetadata>;
  getPack(packId: string): Promise<PolicyPackMetadata | null>;
  listPacks(): Promise<readonly PolicyPackMetadata[]>;
  upsertBundle(input: UpsertStoredPolicyBundleInput): Promise<StoredPolicyBundleRecord>;
  getBundle(packId: string, bundleId: string): Promise<StoredPolicyBundleRecord | null>;
  listBundleHistory(packId: string): Promise<readonly StoredPolicyBundleRecord[]>;
  listBundles(): Promise<readonly StoredPolicyBundleRecord[]>;
  upsertActivation(record: PolicyActivationRecord): Promise<PolicyActivationRecord>;
  getActivation(id: string): Promise<PolicyActivationRecord | null>;
  listActivations(): Promise<readonly PolicyActivationRecord[]>;
  exportSnapshot(): Promise<PolicyStoreSnapshot>;
  summary(): Promise<SharedPolicyControlPlaneStoreSummary>;
}

export interface SharedPolicyActivationApprovalStore {
  upsert(request: PolicyActivationApprovalRequest): Promise<PolicyActivationApprovalRequest>;
  get(id: string): Promise<PolicyActivationApprovalRequest | null>;
  list(filters?: SharedPolicyActivationApprovalListFilters): Promise<readonly PolicyActivationApprovalRequest[]>;
  exportSnapshot(): Promise<PolicyActivationApprovalStoreSnapshot>;
  summary(): Promise<SharedPolicyActivationApprovalStoreSummary>;
}

export interface SharedPolicyActivationApprovalListFilters {
  readonly state?: PolicyActivationApprovalState | null;
  readonly targetLabel?: string | null;
  readonly bundleId?: string | null;
  readonly packId?: string | null;
}

export interface SharedPolicyMutationAuditLogWriter {
  append(input: PolicyMutationAuditAppendInput): Promise<PolicyMutationAuditEntry>;
  entries(): Promise<readonly PolicyMutationAuditEntry[]>;
  latestEntryDigest(): Promise<string | null>;
  verify(): Promise<PolicyMutationAuditVerificationResult>;
  exportSnapshot(): Promise<PolicyMutationAuditSnapshot>;
  summary(): Promise<SharedPolicyMutationAuditLogSummary>;
}

export class SharedPolicyAuthorityStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedPolicyAuthorityStoreError';
  }
}

let initPromise: Promise<void> | null = null;

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SharedPolicyAuthorityStoreError(
      `Shared policy authority row has invalid ${fieldName}.`,
    );
  }
  return value;
}

function requireInteger(value: unknown, fieldName: string): number {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) {
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new SharedPolicyAuthorityStoreError(
      `Shared policy authority row has invalid ${fieldName}.`,
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
    throw new SharedPolicyAuthorityStoreError(
      `Shared policy authority row has invalid ${fieldName}.`,
    );
  }
  return parsed.toISOString();
}

function rowJsonObject(row: PgQueryResultRow, fieldName: string): Record<string, unknown> {
  const value = row[fieldName];
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new SharedPolicyAuthorityStoreError(
    `Shared policy authority row has invalid ${fieldName}.`,
  );
}

function freezeClone<T>(value: T): T {
  return Object.freeze(structuredClone(value)) as T;
}

function assertRowField<T>(actual: T, expected: T, fieldName: string): void {
  if (actual !== expected) {
    throw new SharedPolicyAuthorityStoreError(
      `Shared policy authority row is inconsistent for ${fieldName}.`,
    );
  }
}

function normalizeMetadata(metadata: PolicyControlPlaneMetadata): PolicyControlPlaneMetadata {
  const store = policyStore.createInMemoryPolicyControlPlaneStore();
  return store.setMetadata(metadata);
}

function normalizePack(pack: PolicyPackMetadata): PolicyPackMetadata {
  const store = policyStore.createInMemoryPolicyControlPlaneStore();
  return store.upsertPack(pack);
}

function normalizeBundle(input: UpsertStoredPolicyBundleInput): StoredPolicyBundleRecord {
  const store = policyStore.createInMemoryPolicyControlPlaneStore();
  return store.upsertBundle(input);
}

function normalizeActivation(record: PolicyActivationRecord): PolicyActivationRecord {
  const store = policyStore.createInMemoryPolicyControlPlaneStore();
  return store.upsertActivation(record);
}

function normalizeApproval(
  request: PolicyActivationApprovalRequest,
): PolicyActivationApprovalRequest {
  const store = activationApprovals.createInMemoryPolicyActivationApprovalStore();
  return store.upsert(request);
}

function rowToMetadata(row: PgQueryResultRow): PolicyControlPlaneMetadata {
  return freezeClone(rowJsonObject(row, 'metadata_json')) as unknown as PolicyControlPlaneMetadata;
}

function rowToPack(row: PgQueryResultRow): PolicyPackMetadata {
  const pack = freezeClone(rowJsonObject(row, 'pack_json')) as unknown as PolicyPackMetadata;
  assertRowField(requireString(row.pack_id, 'pack_id'), pack.id, 'pack_id');
  return pack;
}

function rowToBundle(row: PgQueryResultRow): StoredPolicyBundleRecord {
  const record = freezeClone(rowJsonObject(row, 'bundle_json')) as unknown as StoredPolicyBundleRecord;
  if (record.version !== policyStore.POLICY_STORE_RECORD_SPEC_VERSION) {
    throw new SharedPolicyAuthorityStoreError(
      'Shared policy bundle record has an invalid version.',
    );
  }
  assertRowField(requireString(row.pack_id, 'pack_id'), record.packId, 'pack_id');
  assertRowField(requireString(row.bundle_id, 'bundle_id'), record.bundleId, 'bundle_id');
  assertRowField(
    requireString(row.bundle_version, 'bundle_version'),
    record.bundleVersion,
    'bundle_version',
  );
  assertRowField(normalizeIso(row.stored_at, 'stored_at'), record.storedAt, 'stored_at');
  return record;
}

function rowToActivation(row: PgQueryResultRow): PolicyActivationRecord {
  const record = freezeClone(rowJsonObject(row, 'activation_json')) as unknown as PolicyActivationRecord;
  assertRowField(requireString(row.activation_id, 'activation_id'), record.id, 'activation_id');
  assertRowField(requireString(row.activation_state, 'activation_state'), record.state, 'activation_state');
  assertRowField(requireString(row.target_label, 'target_label'), record.targetLabel, 'target_label');
  assertRowField(requireString(row.pack_id, 'pack_id'), record.bundle.packId, 'pack_id');
  assertRowField(requireString(row.bundle_id, 'bundle_id'), record.bundle.bundleId, 'bundle_id');
  return record;
}

function rowToApproval(row: PgQueryResultRow): PolicyActivationApprovalRequest {
  const request = freezeClone(rowJsonObject(row, 'request_json')) as unknown as PolicyActivationApprovalRequest;
  if (request.version !== activationApprovals.POLICY_ACTIVATION_APPROVAL_SPEC_VERSION) {
    throw new SharedPolicyAuthorityStoreError(
      'Shared policy activation approval has an invalid version.',
    );
  }
  assertRowField(requireString(row.request_id, 'request_id'), request.id, 'request_id');
  assertRowField(requireString(row.request_state, 'request_state'), request.state, 'request_state');
  assertRowField(requireString(row.target_label, 'target_label'), request.targetLabel, 'target_label');
  assertRowField(requireString(row.pack_id, 'pack_id'), request.bundle.packId, 'pack_id');
  assertRowField(requireString(row.bundle_id, 'bundle_id'), request.bundle.bundleId, 'bundle_id');
  assertRowField(requireString(row.approval_digest, 'approval_digest'), request.approvalDigest, 'approval_digest');
  return request;
}

function rowToAuditEntry(row: PgQueryResultRow): PolicyMutationAuditEntry {
  const entry = freezeClone(rowJsonObject(row, 'entry_json')) as unknown as PolicyMutationAuditEntry;
  if (entry.version !== auditLog.POLICY_MUTATION_AUDIT_LOG_SPEC_VERSION) {
    throw new SharedPolicyAuthorityStoreError(
      'Shared policy mutation audit entry has an invalid version.',
    );
  }
  assertRowField(requireInteger(row.sequence, 'sequence'), entry.sequence, 'sequence');
  assertRowField(requireString(row.entry_id, 'entry_id'), entry.entryId, 'entry_id');
  assertRowField(requireString(row.action, 'action'), entry.action, 'action');
  assertRowField(normalizeIso(row.occurred_at, 'occurred_at'), entry.occurredAt, 'occurred_at');
  assertRowField(requireString(row.entry_digest, 'entry_digest'), entry.entryDigest, 'entry_digest');
  return entry;
}

function compareBundles(
  left: StoredPolicyBundleRecord,
  right: StoredPolicyBundleRecord,
): number {
  return (
    Date.parse(right.storedAt) - Date.parse(left.storedAt) ||
    right.bundleVersion.localeCompare(left.bundleVersion) ||
    right.bundleId.localeCompare(left.bundleId)
  );
}

function compareActivations(
  left: PolicyActivationRecord,
  right: PolicyActivationRecord,
): number {
  return (
    Date.parse(right.activatedAt) - Date.parse(left.activatedAt) ||
    right.id.localeCompare(left.id)
  );
}

function compareApprovals(
  left: PolicyActivationApprovalRequest,
  right: PolicyActivationApprovalRequest,
): number {
  return (
    Date.parse(right.requestedAt) - Date.parse(left.requestedAt) ||
    right.id.localeCompare(left.id)
  );
}

async function latestPolicyAuditDigest(client: ReleaseAuthorityPgClient): Promise<string | null> {
  const result = await client.query(
    `SELECT entry_digest
       FROM ${POLICY_MUTATION_AUDIT_TABLE}
      ORDER BY sequence DESC
      LIMIT 1`,
  );
  return typeof result.rows[0]?.entry_digest === 'string'
    ? result.rows[0]!.entry_digest
    : null;
}

async function ensurePolicyAuthorityTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureReleaseAuthorityStore();
      await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${POLICY_METADATA_TABLE} (
            singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
            metadata_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS ${POLICY_PACKS_TABLE} (
            pack_id TEXT PRIMARY KEY,
            lifecycle_state TEXT NOT NULL,
            latest_bundle_id TEXT NULL,
            latest_bundle_version TEXT NULL,
            pack_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS ${POLICY_BUNDLES_TABLE} (
            pack_id TEXT NOT NULL,
            bundle_id TEXT NOT NULL,
            bundle_version TEXT NOT NULL,
            stored_at TIMESTAMPTZ NOT NULL,
            bundle_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (pack_id, bundle_id)
          );

          CREATE INDEX IF NOT EXISTS policy_bundles_pack_stored_idx
            ON ${POLICY_BUNDLES_TABLE} (pack_id, stored_at DESC, bundle_version DESC);

          CREATE TABLE IF NOT EXISTS ${POLICY_ACTIVATIONS_TABLE} (
            activation_id TEXT PRIMARY KEY,
            activation_state TEXT NOT NULL,
            target_label TEXT NOT NULL,
            pack_id TEXT NOT NULL,
            bundle_id TEXT NOT NULL,
            activated_at TIMESTAMPTZ NOT NULL,
            activation_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS policy_activations_target_idx
            ON ${POLICY_ACTIVATIONS_TABLE} (target_label, activated_at DESC);

          CREATE TABLE IF NOT EXISTS ${POLICY_ACTIVATION_APPROVALS_TABLE} (
            request_id TEXT PRIMARY KEY,
            request_state TEXT NOT NULL CHECK (request_state IN ('pending', 'approved', 'rejected')),
            target_label TEXT NOT NULL,
            pack_id TEXT NOT NULL,
            bundle_id TEXT NOT NULL,
            requested_at TIMESTAMPTZ NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            approval_digest TEXT NOT NULL,
            request_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS policy_activation_approvals_state_idx
            ON ${POLICY_ACTIVATION_APPROVALS_TABLE} (request_state, requested_at DESC);

          CREATE INDEX IF NOT EXISTS policy_activation_approvals_bundle_idx
            ON ${POLICY_ACTIVATION_APPROVALS_TABLE} (pack_id, bundle_id, requested_at DESC);

          CREATE TABLE IF NOT EXISTS ${POLICY_MUTATION_AUDIT_TABLE} (
            sequence BIGINT PRIMARY KEY CHECK (sequence >= 1),
            entry_id TEXT NOT NULL UNIQUE,
            occurred_at TIMESTAMPTZ NOT NULL,
            action TEXT NOT NULL,
            pack_id TEXT NULL,
            bundle_id TEXT NULL,
            activation_id TEXT NULL,
            target_label TEXT NULL,
            previous_entry_digest TEXT NULL,
            entry_digest TEXT NOT NULL UNIQUE,
            entry_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS policy_mutation_audit_subject_idx
            ON ${POLICY_MUTATION_AUDIT_TABLE} (pack_id, bundle_id, activation_id, sequence ASC);
        `);
      });

      const now = new Date().toISOString();
      await Promise.all([
        markPolicyComponentReady(POLICY_CONTROL_PLANE_COMPONENT, now),
        markPolicyComponentReady(POLICY_ACTIVATION_APPROVAL_COMPONENT, now),
        markPolicyComponentReady(POLICY_MUTATION_AUDIT_COMPONENT, now),
      ]);
    })();
  }
  await initPromise;
}

async function markPolicyComponentReady(
  component:
    | typeof POLICY_CONTROL_PLANE_COMPONENT
    | typeof POLICY_ACTIVATION_APPROVAL_COMPONENT
    | typeof POLICY_MUTATION_AUDIT_COMPONENT,
  defaultMigratedAt: string,
): Promise<void> {
  const currentRecord = await getReleaseAuthorityComponent(component);
  const table =
    component === POLICY_CONTROL_PLANE_COMPONENT
      ? POLICY_BUNDLES_TABLE
      : component === POLICY_ACTIVATION_APPROVAL_COMPONENT
        ? POLICY_ACTIVATION_APPROVALS_TABLE
        : POLICY_MUTATION_AUDIT_TABLE;
  await recordReleaseAuthorityComponentState({
    component,
    status: 'ready',
    migratedAt: currentRecord?.migratedAt ?? defaultMigratedAt,
    metadata: {
      ...(currentRecord?.metadata ?? {}),
      sharedStore: 'postgres',
      storeVersion: SHARED_POLICY_AUTHORITY_STORE_VERSION,
      table,
      bootstrapWired: false,
      trackerStep: '06',
    },
  });
}

export async function ensureSharedPolicyControlPlaneStore(): Promise<
  SharedPolicyControlPlaneStoreSummary
> {
  await ensurePolicyAuthorityTables();
  return createSharedPolicyControlPlaneStore().summary();
}

export async function ensureSharedPolicyActivationApprovalStore(): Promise<
  SharedPolicyActivationApprovalStoreSummary
> {
  await ensurePolicyAuthorityTables();
  return createSharedPolicyActivationApprovalStore().summary();
}

export async function ensureSharedPolicyMutationAuditLog(): Promise<
  SharedPolicyMutationAuditLogSummary
> {
  await ensurePolicyAuthorityTables();
  return createSharedPolicyMutationAuditLogWriter().summary();
}

export function createSharedPolicyControlPlaneStore(): SharedPolicyControlPlaneStore {
  return Object.freeze({
    async getMetadata(): Promise<PolicyControlPlaneMetadata | null> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT metadata_json
             FROM ${POLICY_METADATA_TABLE}
            WHERE singleton = TRUE
            LIMIT 1`,
        ),
      );
      return result.rows.length === 0 ? null : rowToMetadata(result.rows[0]!);
    },

    async setMetadata(metadata: PolicyControlPlaneMetadata): Promise<PolicyControlPlaneMetadata> {
      await ensurePolicyAuthorityTables();
      const normalized = normalizeMetadata(metadata);
      await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `INSERT INTO ${POLICY_METADATA_TABLE} (
            singleton, metadata_json, updated_at
          ) VALUES (
            TRUE, $1::jsonb, NOW()
          )
          ON CONFLICT (singleton) DO UPDATE SET
            metadata_json = EXCLUDED.metadata_json,
            updated_at = EXCLUDED.updated_at`,
          [JSON.stringify(normalized)],
        ),
      );
      return normalized;
    },

    async upsertPack(pack: PolicyPackMetadata): Promise<PolicyPackMetadata> {
      await ensurePolicyAuthorityTables();
      const normalized = normalizePack(pack);
      await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `INSERT INTO ${POLICY_PACKS_TABLE} (
            pack_id, lifecycle_state, latest_bundle_id, latest_bundle_version, pack_json, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5::jsonb, NOW()
          )
          ON CONFLICT (pack_id) DO UPDATE SET
            lifecycle_state = EXCLUDED.lifecycle_state,
            latest_bundle_id = EXCLUDED.latest_bundle_id,
            latest_bundle_version = EXCLUDED.latest_bundle_version,
            pack_json = EXCLUDED.pack_json,
            updated_at = EXCLUDED.updated_at`,
          [
            normalized.id,
            normalized.lifecycleState,
            normalized.latestBundleRef?.bundleId ?? null,
            normalized.latestBundleRef?.bundleVersion ?? null,
            JSON.stringify(normalized),
          ],
        ),
      );
      return normalized;
    },

    async getPack(packId: string): Promise<PolicyPackMetadata | null> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_PACKS_TABLE}
            WHERE pack_id = $1
            LIMIT 1`,
          [packId],
        ),
      );
      return result.rows.length === 0 ? null : rowToPack(result.rows[0]!);
    },

    async listPacks(): Promise<readonly PolicyPackMetadata[]> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_PACKS_TABLE}
            ORDER BY pack_id ASC`,
        ),
      );
      return Object.freeze(result.rows.map(rowToPack));
    },

    async upsertBundle(input: UpsertStoredPolicyBundleInput): Promise<StoredPolicyBundleRecord> {
      await ensurePolicyAuthorityTables();
      const normalized = normalizeBundle(input);
      await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `INSERT INTO ${POLICY_BUNDLES_TABLE} (
            pack_id, bundle_id, bundle_version, stored_at, bundle_json, updated_at
          ) VALUES (
            $1, $2, $3, $4::timestamptz, $5::jsonb, NOW()
          )
          ON CONFLICT (pack_id, bundle_id) DO UPDATE SET
            bundle_version = EXCLUDED.bundle_version,
            stored_at = EXCLUDED.stored_at,
            bundle_json = EXCLUDED.bundle_json,
            updated_at = EXCLUDED.updated_at`,
          [
            normalized.packId,
            normalized.bundleId,
            normalized.bundleVersion,
            normalized.storedAt,
            JSON.stringify(normalized),
          ],
        ),
      );
      return normalized;
    },

    async getBundle(
      packId: string,
      bundleId: string,
    ): Promise<StoredPolicyBundleRecord | null> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_BUNDLES_TABLE}
            WHERE pack_id = $1 AND bundle_id = $2
            LIMIT 1`,
          [packId, bundleId],
        ),
      );
      return result.rows.length === 0 ? null : rowToBundle(result.rows[0]!);
    },

    async listBundleHistory(packId: string): Promise<readonly StoredPolicyBundleRecord[]> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_BUNDLES_TABLE}
            WHERE pack_id = $1
            ORDER BY stored_at DESC, bundle_version DESC, bundle_id DESC`,
          [packId],
        ),
      );
      return Object.freeze(result.rows.map(rowToBundle).sort(compareBundles));
    },

    async listBundles(): Promise<readonly StoredPolicyBundleRecord[]> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_BUNDLES_TABLE}
            ORDER BY stored_at DESC, bundle_version DESC, bundle_id DESC`,
        ),
      );
      return Object.freeze(result.rows.map(rowToBundle).sort(compareBundles));
    },

    async upsertActivation(record: PolicyActivationRecord): Promise<PolicyActivationRecord> {
      await ensurePolicyAuthorityTables();
      const normalized = normalizeActivation(record);
      await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `INSERT INTO ${POLICY_ACTIVATIONS_TABLE} (
            activation_id, activation_state, target_label, pack_id, bundle_id,
            activated_at, activation_json, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, NOW()
          )
          ON CONFLICT (activation_id) DO UPDATE SET
            activation_state = EXCLUDED.activation_state,
            target_label = EXCLUDED.target_label,
            pack_id = EXCLUDED.pack_id,
            bundle_id = EXCLUDED.bundle_id,
            activated_at = EXCLUDED.activated_at,
            activation_json = EXCLUDED.activation_json,
            updated_at = EXCLUDED.updated_at`,
          [
            normalized.id,
            normalized.state,
            normalized.targetLabel,
            normalized.bundle.packId,
            normalized.bundle.bundleId,
            normalized.activatedAt,
            JSON.stringify(normalized),
          ],
        ),
      );
      return normalized;
    },

    async getActivation(id: string): Promise<PolicyActivationRecord | null> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_ACTIVATIONS_TABLE}
            WHERE activation_id = $1
            LIMIT 1`,
          [id],
        ),
      );
      return result.rows.length === 0 ? null : rowToActivation(result.rows[0]!);
    },

    async listActivations(): Promise<readonly PolicyActivationRecord[]> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_ACTIVATIONS_TABLE}
            ORDER BY activated_at DESC, activation_id DESC`,
        ),
      );
      return Object.freeze(result.rows.map(rowToActivation).sort(compareActivations));
    },

    async exportSnapshot(): Promise<PolicyStoreSnapshot> {
      const [metadata, packs, bundles, activations] = await Promise.all([
        this.getMetadata(),
        this.listPacks(),
        this.listBundles(),
        this.listActivations(),
      ]);
      return freezeClone({
        version: policyStore.POLICY_STORE_SNAPSHOT_SPEC_VERSION,
        metadata,
        packs,
        bundles,
        activations,
      }) as PolicyStoreSnapshot;
    },

    async summary(): Promise<SharedPolicyControlPlaneStoreSummary> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_STORE_MUTATION_LOCK, async (client) => {
        const metadata = await client.query(
          `SELECT COUNT(*)::int AS count
             FROM ${POLICY_METADATA_TABLE}`,
        );
        const packs = await client.query(
          `SELECT COUNT(*)::int AS count
             FROM ${POLICY_PACKS_TABLE}`,
        );
        const bundles = await client.query(
          `SELECT COUNT(*)::int AS count
             FROM ${POLICY_BUNDLES_TABLE}`,
        );
        const activations = await client.query(
          `SELECT COUNT(*)::int AS count
             FROM ${POLICY_ACTIVATIONS_TABLE}`,
        );
        return {
          hasMetadata: Number(metadata.rows[0]?.count ?? 0) > 0,
          packCount: Number(packs.rows[0]?.count ?? 0),
          bundleCount: Number(bundles.rows[0]?.count ?? 0),
          activationCount: Number(activations.rows[0]?.count ?? 0),
        };
      });
      const component = await getReleaseAuthorityComponent(POLICY_CONTROL_PLANE_COMPONENT);
      return Object.freeze({
        component: POLICY_CONTROL_PLANE_COMPONENT,
        metadataTable: POLICY_METADATA_TABLE,
        packsTable: POLICY_PACKS_TABLE,
        bundlesTable: POLICY_BUNDLES_TABLE,
        activationsTable: POLICY_ACTIVATIONS_TABLE,
        ...result,
        componentStatus: component?.status ?? 'pending',
      });
    },
  });
}

export function createSharedPolicyActivationApprovalStore(): SharedPolicyActivationApprovalStore {
  return Object.freeze({
    async upsert(
      request: PolicyActivationApprovalRequest,
    ): Promise<PolicyActivationApprovalRequest> {
      await ensurePolicyAuthorityTables();
      const normalized = normalizeApproval(request);
      await withReleaseAuthorityAdvisoryLock(POLICY_APPROVAL_MUTATION_LOCK, (client) =>
        client.query(
          `INSERT INTO ${POLICY_ACTIVATION_APPROVALS_TABLE} (
            request_id, request_state, target_label, pack_id, bundle_id,
            requested_at, expires_at, approval_digest, request_json, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9::jsonb, NOW()
          )
          ON CONFLICT (request_id) DO UPDATE SET
            request_state = EXCLUDED.request_state,
            target_label = EXCLUDED.target_label,
            pack_id = EXCLUDED.pack_id,
            bundle_id = EXCLUDED.bundle_id,
            requested_at = EXCLUDED.requested_at,
            expires_at = EXCLUDED.expires_at,
            approval_digest = EXCLUDED.approval_digest,
            request_json = EXCLUDED.request_json,
            updated_at = EXCLUDED.updated_at`,
          [
            normalized.id,
            normalized.state,
            normalized.targetLabel,
            normalized.bundle.packId,
            normalized.bundle.bundleId,
            normalized.requestedAt,
            normalized.expiresAt,
            normalized.approvalDigest,
            JSON.stringify(normalized),
          ],
        ),
      );
      return normalized;
    },

    async get(id: string): Promise<PolicyActivationApprovalRequest | null> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_APPROVAL_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_ACTIVATION_APPROVALS_TABLE}
            WHERE request_id = $1
            LIMIT 1`,
          [id],
        ),
      );
      return result.rows.length === 0 ? null : rowToApproval(result.rows[0]!);
    },

    async list(
      filters: SharedPolicyActivationApprovalListFilters = {},
    ): Promise<readonly PolicyActivationApprovalRequest[]> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_APPROVAL_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT *
             FROM ${POLICY_ACTIVATION_APPROVALS_TABLE}
            ORDER BY requested_at DESC, request_id DESC`,
        ),
      );
      return Object.freeze(
        result.rows
          .map(rowToApproval)
          .filter((request) => !filters.state || request.state === filters.state)
          .filter((request) => !filters.targetLabel || request.targetLabel === filters.targetLabel)
          .filter((request) => !filters.bundleId || request.bundle.bundleId === filters.bundleId)
          .filter((request) => !filters.packId || request.bundle.packId === filters.packId)
          .sort(compareApprovals),
      );
    },

    async exportSnapshot(): Promise<PolicyActivationApprovalStoreSnapshot> {
      const requests = await this.list();
      return freezeClone({
        version: activationApprovals.POLICY_ACTIVATION_APPROVAL_STORE_SPEC_VERSION,
        requests,
      }) as PolicyActivationApprovalStoreSnapshot;
    },

    async summary(): Promise<SharedPolicyActivationApprovalStoreSummary> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_APPROVAL_MUTATION_LOCK, (client) =>
        client.query(
          `SELECT COUNT(*)::int AS request_count,
                  COUNT(*) FILTER (WHERE request_state = 'pending')::int AS pending_count,
                  COUNT(*) FILTER (WHERE request_state = 'approved')::int AS approved_count,
                  COUNT(*) FILTER (WHERE request_state = 'rejected')::int AS rejected_count
             FROM ${POLICY_ACTIVATION_APPROVALS_TABLE}`,
        ),
      );
      const component = await getReleaseAuthorityComponent(POLICY_ACTIVATION_APPROVAL_COMPONENT);
      const row = result.rows[0] ?? {};
      return Object.freeze({
        component: POLICY_ACTIVATION_APPROVAL_COMPONENT,
        table: POLICY_ACTIVATION_APPROVALS_TABLE,
        requestCount: Number(row.request_count ?? 0),
        pendingCount: Number(row.pending_count ?? 0),
        approvedCount: Number(row.approved_count ?? 0),
        rejectedCount: Number(row.rejected_count ?? 0),
        componentStatus: component?.status ?? 'pending',
      });
    },
  });
}

export function createSharedPolicyMutationAuditLogWriter(): SharedPolicyMutationAuditLogWriter {
  async function entriesFromRows(): Promise<readonly PolicyMutationAuditEntry[]> {
    const result = await withReleaseAuthorityAdvisoryLock(POLICY_AUDIT_APPEND_LOCK, (client) =>
      client.query(
        `SELECT *
           FROM ${POLICY_MUTATION_AUDIT_TABLE}
          ORDER BY sequence ASC`,
      ),
    );
    const entries = result.rows.map(rowToAuditEntry);
    const verification = auditLog.verifyPolicyMutationAuditLogChain(entries);
    if (!verification.valid) {
      throw new SharedPolicyAuthorityStoreError(
        `Shared policy mutation audit log is invalid at entry ${verification.brokenEntryId ?? 'unknown'}.`,
      );
    }
    return Object.freeze(entries);
  }

  return Object.freeze({
    async append(input: PolicyMutationAuditAppendInput): Promise<PolicyMutationAuditEntry> {
      await ensurePolicyAuthorityTables();
      return withReleaseAuthorityAdvisoryLock(POLICY_AUDIT_APPEND_LOCK, async (client) => {
        const latest = await client.query(
          `SELECT sequence, entry_digest
             FROM ${POLICY_MUTATION_AUDIT_TABLE}
            ORDER BY sequence DESC
            LIMIT 1`,
        );
        const latestSequence = Number(latest.rows[0]?.sequence ?? 0);
        const previousEntryDigest =
          typeof latest.rows[0]?.entry_digest === 'string'
            ? latest.rows[0]!.entry_digest
            : null;
        const entry = auditLog.createPolicyMutationAuditEntry(
          input,
          latestSequence + 1,
          previousEntryDigest,
        );
        await client.query(
          `INSERT INTO ${POLICY_MUTATION_AUDIT_TABLE} (
            sequence, entry_id, occurred_at, action, pack_id, bundle_id,
            activation_id, target_label, previous_entry_digest, entry_digest,
            entry_json
          ) VALUES (
            $1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11::jsonb
          )`,
          [
            entry.sequence,
            entry.entryId,
            entry.occurredAt,
            entry.action,
            entry.subject.packId,
            entry.subject.bundleId,
            entry.subject.activationId,
            entry.subject.targetLabel,
            entry.previousEntryDigest,
            entry.entryDigest,
            JSON.stringify(entry),
          ],
        );
        return entry;
      });
    },

    async entries(): Promise<readonly PolicyMutationAuditEntry[]> {
      await ensurePolicyAuthorityTables();
      return entriesFromRows();
    },

    async latestEntryDigest(): Promise<string | null> {
      await ensurePolicyAuthorityTables();
      return withReleaseAuthorityAdvisoryLock(POLICY_AUDIT_APPEND_LOCK, latestPolicyAuditDigest);
    },

    async verify(): Promise<PolicyMutationAuditVerificationResult> {
      const entries = await this.entries();
      return auditLog.verifyPolicyMutationAuditLogChain(entries);
    },

    async exportSnapshot(): Promise<PolicyMutationAuditSnapshot> {
      const entries = await this.entries();
      return freezeClone({
        version: auditLog.POLICY_MUTATION_AUDIT_FILE_SPEC_VERSION,
        entries,
      }) as PolicyMutationAuditSnapshot;
    },

    async summary(): Promise<SharedPolicyMutationAuditLogSummary> {
      await ensurePolicyAuthorityTables();
      const result = await withReleaseAuthorityAdvisoryLock(POLICY_AUDIT_APPEND_LOCK, async (client) => {
        const count = await client.query(
          `SELECT COUNT(*)::int AS entry_count,
                  COALESCE(MAX(sequence), 0)::int AS latest_sequence
             FROM ${POLICY_MUTATION_AUDIT_TABLE}`,
        );
        const latestDigest = await latestPolicyAuditDigest(client);
        return {
          entryCount: Number(count.rows[0]?.entry_count ?? 0),
          latestSequence: Number(count.rows[0]?.latest_sequence ?? 0),
          latestEntryDigest: latestDigest,
        };
      });
      const component = await getReleaseAuthorityComponent(POLICY_MUTATION_AUDIT_COMPONENT);
      return Object.freeze({
        component: POLICY_MUTATION_AUDIT_COMPONENT,
        table: POLICY_MUTATION_AUDIT_TABLE,
        ...result,
        componentStatus: component?.status ?? 'pending',
      });
    },
  });
}

export async function resetSharedPolicyAuthorityStoresForTests(): Promise<void> {
  initPromise = null;
  await resetReleaseAuthorityStoreForTests();
}
