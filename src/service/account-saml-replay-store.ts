/**
 * Hosted SAML Replay Store — one-time AuthnRequest consumption ledger.
 *
 * BOUNDARY:
 * - Local JSON first slice when shared PG control-plane is disabled
 * - Stores only consumed request IDs, not full pending login state
 * - Expired entries are pruned opportunistically
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { HostedSamlReplayRecord } from './account-saml.js';

interface HostedSamlReplayStoreFile {
  version: 1;
  records: HostedSamlReplayRecord[];
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_ACCOUNT_SAML_REPLAY_STORE_PATH ?? '.attestor/account-saml-replays.json');
}

function defaultStore(): HostedSamlReplayStoreFile {
  return { version: 1, records: [] };
}

function normalizeRecord(record: HostedSamlReplayRecord): HostedSamlReplayRecord {
  return {
    requestId: String(record.requestId ?? '').trim(),
    responseId: typeof record.responseId === 'string' && record.responseId.trim() ? record.responseId.trim() : null,
    issuer: String(record.issuer ?? '').trim(),
    subject: String(record.subject ?? '').trim(),
    consumedAt: String(record.consumedAt ?? ''),
    expiresAt: String(record.expiresAt ?? ''),
  };
}

function loadStore(): HostedSamlReplayStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HostedSamlReplayStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return {
        version: 1,
        records: parsed.records.map((record) => normalizeRecord(record)),
      };
    }
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: HostedSamlReplayStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function pruneExpired(store: HostedSamlReplayStoreFile): boolean {
  const before = store.records.length;
  const now = Date.now();
  store.records = store.records.filter((record) => {
    const expiresAtMs = Date.parse(record.expiresAt);
    return !Number.isFinite(expiresAtMs) || expiresAtMs > now;
  });
  return before !== store.records.length;
}

export function recordHostedSamlReplay(
  record: HostedSamlReplayRecord,
): {
  duplicate: boolean;
  record: HostedSamlReplayRecord;
  existing: HostedSamlReplayRecord | null;
  path: string;
} {
  const store = loadStore();
  pruneExpired(store);
  const normalized = normalizeRecord(record);
  const existing = store.records.find((entry) => entry.requestId === normalized.requestId) ?? null;
  if (existing) {
    saveStore(store);
    return {
      duplicate: true,
      record: normalized,
      existing,
      path: storePath(),
    };
  }
  store.records.push(normalized);
  saveStore(store);
  return {
    duplicate: false,
    record: normalized,
    existing: null,
    path: storePath(),
  };
}

export function listHostedSamlReplays(): { records: HostedSamlReplayRecord[]; path: string } {
  const store = loadStore();
  if (pruneExpired(store)) saveStore(store);
  return { records: store.records.map((record) => normalizeRecord(record)), path: storePath() };
}

export function resetHostedSamlReplayStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}

