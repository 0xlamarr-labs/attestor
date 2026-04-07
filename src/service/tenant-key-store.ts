/**
 * Tenant Key Store — Hosted API operator first slice
 *
 * Persists tenant API key metadata in a local JSON file so operators can
 * issue and revoke customer keys without editing env vars by hand.
 *
 * BOUNDARY:
 * - Local file-backed store only
 * - API keys are hashed at rest; plaintext is returned once on issuance
 * - No dashboard, no billing sync, no multi-node shared datastore yet
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface TenantKeyRecord {
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

interface TenantKeyStoreFile {
  version: 1;
  records: TenantKeyRecord[];
}

export interface IssueTenantKeyInput {
  tenantId: string;
  tenantName: string;
  planId?: string | null;
  monthlyRunQuota?: number | null;
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_TENANT_KEY_STORE_PATH ?? '.attestor/tenant-keys.json');
}

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

function previewApiKey(apiKey: string): string {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

function defaultStore(): TenantKeyStoreFile {
  return { version: 1, records: [] };
}

function loadStore(): TenantKeyStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TenantKeyStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) return parsed;
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

export function issueTenantApiKey(input: IssueTenantKeyInput): {
  apiKey: string;
  record: TenantKeyRecord;
  path: string;
} {
  const apiKey = `atk_${randomBytes(24).toString('hex')}`;
  const record: TenantKeyRecord = {
    id: `tkey_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    planId: input.planId ?? 'community',
    monthlyRunQuota: typeof input.monthlyRunQuota === 'number' && input.monthlyRunQuota >= 0
      ? input.monthlyRunQuota
      : null,
    apiKeyHash: hashApiKey(apiKey),
    apiKeyPreview: previewApiKey(apiKey),
    status: 'active',
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };

  const store = loadStore();
  store.records.push(record);
  saveStore(store);

  return { apiKey, record, path: storePath() };
}

export function listTenantKeyRecords(): {
  records: TenantKeyRecord[];
  path: string;
} {
  const store = loadStore();
  return { records: store.records, path: storePath() };
}

export function revokeTenantApiKey(id: string): {
  record: TenantKeyRecord | null;
  path: string;
} {
  const store = loadStore();
  const record = store.records.find((entry) => entry.id === id);
  if (!record) return { record: null, path: storePath() };
  record.status = 'revoked';
  record.revokedAt = new Date().toISOString();
  saveStore(store);
  return { record, path: storePath() };
}

export function findActiveTenantKey(apiKey: string): TenantKeyRecord | null {
  const hashed = hashApiKey(apiKey);
  const store = loadStore();
  return store.records.find((entry) => entry.status === 'active' && entry.apiKeyHash === hashed) ?? null;
}

export function hasActiveTenantKeys(): boolean {
  const store = loadStore();
  return store.records.some((entry) => entry.status === 'active');
}

export function findTenantRecordByTenantId(tenantId: string): TenantKeyRecord | null {
  const store = loadStore();
  const candidates = store.records.filter((entry) => entry.tenantId === tenantId);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.createdAt > b.createdAt ? -1 : 1;
  });
  return candidates[0] ?? null;
}

export function resetTenantKeyStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
