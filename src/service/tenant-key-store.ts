/**
 * Tenant Key Store - Hosted API operator first slice
 *
 * Persists tenant API key metadata in a local JSON file so operators can
 * issue, rotate, deactivate, reactivate, and revoke customer keys without
 * editing env vars by hand.
 *
 * BOUNDARY:
 * - Local file-backed store only
 * - API keys are hashed at rest; plaintext is returned once on issuance
 * - Rotation is single-node and operator-driven, not an external KMS flow
 * - No dashboard, no billing sync, no multi-node shared datastore yet
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_HOSTED_PLAN_ID, resolvePlanSpec } from './plan-catalog.js';

export type TenantKeyStatus = 'active' | 'inactive' | 'revoked';

export interface TenantKeyRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
  apiKeyHash: string;
  apiKeyPreview: string;
  status: TenantKeyStatus;
  createdAt: string;
  lastUsedAt: string | null;
  deactivatedAt: string | null;
  revokedAt: string | null;
  rotatedFromKeyId: string | null;
  supersededByKeyId: string | null;
  supersededAt: string | null;
}

interface LegacyTenantKeyRecordV1 {
  id: string;
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
  apiKeyHash: string;
  apiKeyPreview: string;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
}

interface TenantKeyStoreFileV1 {
  version: 1;
  records: LegacyTenantKeyRecordV1[];
}

interface TenantKeyStoreFile {
  version: 2;
  records: TenantKeyRecord[];
}

export interface IssueTenantKeyInput {
  tenantId: string;
  tenantName: string;
  planId?: string | null;
  monthlyRunQuota?: number | null;
}

export interface RotateTenantKeyInput {
  planId?: string | null;
  monthlyRunQuota?: number | null;
}

export class TenantKeyStoreError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_STATE' | 'LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'TenantKeyStoreError';
  }
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_TENANT_KEY_STORE_PATH ?? '.attestor/tenant-keys.json');
}

function maxActiveKeysPerTenant(): number {
  const raw = Number.parseInt(process.env.ATTESTOR_TENANT_KEY_MAX_ACTIVE_PER_TENANT ?? '2', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

export function tenantKeyStorePolicy(): { maxActiveKeysPerTenant: number } {
  return {
    maxActiveKeysPerTenant: maxActiveKeysPerTenant(),
  };
}

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

function previewApiKey(apiKey: string): string {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

function defaultStore(): TenantKeyStoreFile {
  return { version: 2, records: [] };
}

function migrateLegacyRecord(record: LegacyTenantKeyRecordV1): TenantKeyRecord {
  return {
    ...record,
    status: record.status === 'revoked' ? 'revoked' : 'active',
    lastUsedAt: null,
    deactivatedAt: null,
    rotatedFromKeyId: null,
    supersededByKeyId: null,
    supersededAt: null,
  };
}

function loadStore(): TenantKeyStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TenantKeyStoreFile | TenantKeyStoreFileV1;
    if (parsed.version === 2 && Array.isArray(parsed.records)) {
      return parsed;
    }
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return {
        version: 2,
        records: parsed.records.map(migrateLegacyRecord),
      };
    }
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: TenantKeyStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function countActiveKeysForTenant(store: TenantKeyStoreFile, tenantId: string): number {
  return store.records.filter((entry) => entry.tenantId === tenantId && entry.status === 'active').length;
}

function requireRecord(store: TenantKeyStoreFile, id: string): TenantKeyRecord {
  const record = store.records.find((entry) => entry.id === id);
  if (!record) {
    throw new TenantKeyStoreError('NOT_FOUND', `Tenant key record not found: ${id}`);
  }
  return record;
}

function ensureCanCreateActiveKey(store: TenantKeyStoreFile, tenantId: string): void {
  const activeCount = countActiveKeysForTenant(store, tenantId);
  const maxActive = maxActiveKeysPerTenant();
  if (activeCount >= maxActive) {
    throw new TenantKeyStoreError(
      'LIMIT_EXCEEDED',
      `Tenant '${tenantId}' already has ${activeCount} active keys. Deactivate or revoke one before issuing another. Max active keys per tenant: ${maxActive}.`,
    );
  }
}

function buildTenantKeyRecord(options: {
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
  apiKey: string;
  createdAt: string;
  rotatedFromKeyId?: string | null;
}): TenantKeyRecord {
  return {
    id: `tkey_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    tenantId: options.tenantId,
    tenantName: options.tenantName,
    planId: options.planId,
    monthlyRunQuota: options.monthlyRunQuota,
    apiKeyHash: hashApiKey(options.apiKey),
    apiKeyPreview: previewApiKey(options.apiKey),
    status: 'active',
    createdAt: options.createdAt,
    lastUsedAt: null,
    deactivatedAt: null,
    revokedAt: null,
    rotatedFromKeyId: options.rotatedFromKeyId ?? null,
    supersededByKeyId: null,
    supersededAt: null,
  };
}

function activeReplacementExists(store: TenantKeyStoreFile, record: TenantKeyRecord): boolean {
  if (!record.supersededByKeyId) return false;
  const replacement = store.records.find((entry) => entry.id === record.supersededByKeyId);
  return Boolean(replacement && replacement.status !== 'revoked');
}

export function issueTenantApiKey(input: IssueTenantKeyInput): {
  apiKey: string;
  record: TenantKeyRecord;
  path: string;
} {
  const resolvedPlan = resolvePlanSpec({
    planId: input.planId,
    monthlyRunQuota: input.monthlyRunQuota,
    defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
  });
  const store = loadStore();
  ensureCanCreateActiveKey(store, input.tenantId);

  const apiKey = `atk_${randomBytes(24).toString('hex')}`;
  const record = buildTenantKeyRecord({
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    planId: resolvedPlan.planId,
    monthlyRunQuota: resolvedPlan.monthlyRunQuota,
    apiKey,
    createdAt: new Date().toISOString(),
  });

  store.records.push(record);
  saveStore(store);

  return { apiKey, record, path: storePath() };
}

export function rotateTenantApiKey(id: string, input?: RotateTenantKeyInput): {
  apiKey: string;
  record: TenantKeyRecord;
  previousRecord: TenantKeyRecord;
  path: string;
} {
  const store = loadStore();
  const sourceRecord = requireRecord(store, id);
  if (sourceRecord.status !== 'active') {
    throw new TenantKeyStoreError(
      'INVALID_STATE',
      `Tenant key '${id}' must be active before rotation. Current status: ${sourceRecord.status}.`,
    );
  }
  if (activeReplacementExists(store, sourceRecord)) {
    throw new TenantKeyStoreError(
      'INVALID_STATE',
      `Tenant key '${id}' already has an unreconciled replacement key. Reuse or revoke the replacement before rotating again.`,
    );
  }

  ensureCanCreateActiveKey(store, sourceRecord.tenantId);

  const resolvedPlan = resolvePlanSpec({
    planId: input?.planId ?? sourceRecord.planId,
    monthlyRunQuota: input?.monthlyRunQuota ?? sourceRecord.monthlyRunQuota,
    defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
  });
  const apiKey = `atk_${randomBytes(24).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const record = buildTenantKeyRecord({
    tenantId: sourceRecord.tenantId,
    tenantName: sourceRecord.tenantName,
    planId: resolvedPlan.planId,
    monthlyRunQuota: resolvedPlan.monthlyRunQuota,
    apiKey,
    createdAt,
    rotatedFromKeyId: sourceRecord.id,
  });

  sourceRecord.supersededByKeyId = record.id;
  sourceRecord.supersededAt = createdAt;
  store.records.push(record);
  saveStore(store);

  return {
    apiKey,
    record,
    previousRecord: { ...sourceRecord },
    path: storePath(),
  };
}

export function listTenantKeyRecords(): {
  records: TenantKeyRecord[];
  path: string;
} {
  const store = loadStore();
  return { records: store.records, path: storePath() };
}

export function setTenantApiKeyStatus(id: string, nextStatus: 'active' | 'inactive'): {
  record: TenantKeyRecord;
  path: string;
} {
  const store = loadStore();
  const record = requireRecord(store, id);
  if (record.status === 'revoked') {
    throw new TenantKeyStoreError(
      'INVALID_STATE',
      `Tenant key '${id}' is revoked and cannot transition back to ${nextStatus}.`,
    );
  }

  if (nextStatus === 'inactive') {
    if (record.status === 'inactive') {
      return { record, path: storePath() };
    }
    record.status = 'inactive';
    record.deactivatedAt = new Date().toISOString();
    saveStore(store);
    return { record, path: storePath() };
  }

  if (record.status === 'active') {
    return { record, path: storePath() };
  }

  ensureCanCreateActiveKey(store, record.tenantId);
  record.status = 'active';
  record.deactivatedAt = null;
  saveStore(store);
  return { record, path: storePath() };
}

export function revokeTenantApiKey(id: string): {
  record: TenantKeyRecord | null;
  path: string;
} {
  const store = loadStore();
  const record = store.records.find((entry) => entry.id === id);
  if (!record) return { record: null, path: storePath() };
  if (record.status === 'revoked') {
    return { record, path: storePath() };
  }
  record.status = 'revoked';
  record.revokedAt = new Date().toISOString();
  saveStore(store);
  return { record, path: storePath() };
}

export function findActiveTenantKey(apiKey: string, options?: { markUsed?: boolean }): TenantKeyRecord | null {
  const hashed = hashApiKey(apiKey);
  const store = loadStore();
  const record = store.records.find((entry) => entry.status === 'active' && entry.apiKeyHash === hashed) ?? null;
  if (!record) return null;
  if (options?.markUsed) {
    record.lastUsedAt = new Date().toISOString();
    saveStore(store);
  }
  return record;
}

export function hasActiveTenantKeys(): boolean {
  const store = loadStore();
  return store.records.some((entry) => entry.status === 'active');
}

function statusRank(status: TenantKeyStatus): number {
  if (status === 'active') return 0;
  if (status === 'inactive') return 1;
  return 2;
}

export function findTenantRecordByTenantId(tenantId: string): TenantKeyRecord | null {
  const store = loadStore();
  const candidates = store.records.filter((entry) => entry.tenantId === tenantId);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const statusDelta = statusRank(a.status) - statusRank(b.status);
    if (statusDelta !== 0) return statusDelta;
    return a.createdAt > b.createdAt ? -1 : 1;
  });
  return candidates[0] ?? null;
}

export function resetTenantKeyStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
