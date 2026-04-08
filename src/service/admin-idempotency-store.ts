/**
 * Admin Idempotency Store — Safe retry support for hosted operator mutations.
 *
 * BOUNDARY:
 * - Local file-backed store only
 * - Replay payloads are encrypted at rest using a key derived from ATTESTOR_ADMIN_API_KEY
 * - Intended for operator/admin POST routes, not public customer traffic
 * - Short-lived retention only; this is not a long-term event store
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashJsonValue, stableJsonStringify } from './json-stable.js';

export interface AdminIdempotencyRecord {
  id: string;
  idempotencyKey: string;
  routeId: string;
  requestHash: string;
  statusCode: number;
  responseCiphertext: string;
  responseIv: string;
  responseAuthTag: string;
  createdAt: string;
  lastReplayedAt: string | null;
  replayCount: number;
}

interface AdminIdempotencyStoreFile {
  version: 1;
  records: AdminIdempotencyRecord[];
}

export type AdminIdempotencyLookup =
  | { kind: 'miss'; requestHash: string }
  | { kind: 'replay'; requestHash: string; record: AdminIdempotencyRecord; response: unknown }
  | { kind: 'conflict'; requestHash: string; record: AdminIdempotencyRecord };

function storePath(): string {
  return resolve(process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH ?? '.attestor/admin-idempotency.json');
}

function ttlHours(): number {
  const raw = process.env.ATTESTOR_ADMIN_IDEMPOTENCY_TTL_HOURS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 24;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function adminEncryptionKey(): Buffer {
  const adminKey = process.env.ATTESTOR_ADMIN_API_KEY?.trim();
  if (!adminKey) {
    throw new Error('ATTESTOR_ADMIN_API_KEY must be set before using admin idempotency storage');
  }
  return createHash('sha256').update(`attestor.admin.idempotency:${adminKey}`).digest();
}

export function encryptAdminIdempotencyResponse(response: unknown): {
  ciphertext: string;
  iv: string;
  authTag: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', adminEncryptionKey(), iv);
  const plaintext = stableJsonStringify(response);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptAdminIdempotencyResponse(record: Pick<
  AdminIdempotencyRecord,
  'responseCiphertext' | 'responseIv' | 'responseAuthTag'
>): unknown {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    adminEncryptionKey(),
    Buffer.from(record.responseIv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(record.responseAuthTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.responseCiphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

function defaultStore(): AdminIdempotencyStoreFile {
  return { version: 1, records: [] };
}

function pruneExpired(records: AdminIdempotencyRecord[]): AdminIdempotencyRecord[] {
  const cutoff = Date.now() - ttlHours() * 60 * 60 * 1000;
  return records.filter((record) => Date.parse(record.createdAt) >= cutoff);
}

function loadStore(): AdminIdempotencyStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AdminIdempotencyStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return { version: 1, records: pruneExpired(parsed.records) };
    }
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: AdminIdempotencyStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...store, records: pruneExpired(store.records) }, null, 2)}\n`, 'utf8');
}

export function readAdminIdempotencySnapshot(): {
  path: string;
  records: AdminIdempotencyRecord[];
} {
  const store = loadStore();
  return {
    path: storePath(),
    records: [...store.records],
  };
}

export function buildAdminIdempotencyRequestHash(routeId: string, payload: unknown): string {
  return hashJsonValue({ routeId, payload });
}

export function lookupAdminIdempotency(options: {
  idempotencyKey: string;
  routeId: string;
  requestPayload: unknown;
}): AdminIdempotencyLookup {
  const requestHash = buildAdminIdempotencyRequestHash(options.routeId, options.requestPayload);
  const store = loadStore();
  const existing = store.records.find((record) => record.idempotencyKey === options.idempotencyKey);
  if (!existing) return { kind: 'miss', requestHash };
  if (existing.routeId !== options.routeId || existing.requestHash !== requestHash) {
    return { kind: 'conflict', requestHash, record: existing };
  }

  existing.lastReplayedAt = new Date().toISOString();
  existing.replayCount += 1;
  saveStore(store);
  return {
    kind: 'replay',
    requestHash,
    record: existing,
    response: decryptAdminIdempotencyResponse(existing),
  };
}

export function recordAdminIdempotency(options: {
  idempotencyKey: string;
  routeId: string;
  requestPayload: unknown;
  statusCode: number;
  response: unknown;
}): { record: AdminIdempotencyRecord; path: string } {
  const store = loadStore();
  const existing = store.records.find((record) => record.idempotencyKey === options.idempotencyKey);
  if (existing) {
    if (
      existing.routeId !== options.routeId ||
      existing.requestHash !== buildAdminIdempotencyRequestHash(options.routeId, options.requestPayload)
    ) {
      throw new Error(`Idempotency-Key '${options.idempotencyKey}' already exists for a different request`);
    }
    return { record: existing, path: storePath() };
  }

  const encrypted = encryptAdminIdempotencyResponse(options.response);
  const record: AdminIdempotencyRecord = {
    id: `idem_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    idempotencyKey: options.idempotencyKey,
    routeId: options.routeId,
    requestHash: buildAdminIdempotencyRequestHash(options.routeId, options.requestPayload),
    statusCode: options.statusCode,
    responseCiphertext: encrypted.ciphertext,
    responseIv: encrypted.iv,
    responseAuthTag: encrypted.authTag,
    createdAt: new Date().toISOString(),
    lastReplayedAt: null,
    replayCount: 0,
  };
  store.records.push(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function resetAdminIdempotencyStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
