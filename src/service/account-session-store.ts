/**
 * Account Session Store — opaque hosted customer sessions first slice.
 *
 * Persists hashed session tokens in a local JSON file so hosted customers can
 * authenticate without introducing JWT signing, MFA, or external session
 * infrastructure before the shared PostgreSQL control-plane is configured.
 *
 * BOUNDARY:
 * - Local file-backed store only
 * - Opaque random session tokens hashed at rest
 * - HttpOnly cookie/header transport expected
 * - Sessions are issued only after MFA verification when the account user has MFA enabled
 * - No refresh tokens, device binding, or central session revocation bus yet
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AccountUserRole } from './account-user-store.js';
import { withFileLock, writeTextFileAtomic } from './file-store.js';

export interface AccountSessionRecord {
  id: string;
  accountId: string;
  accountUserId: string;
  role: AccountUserRole;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface AccountSessionStoreFile {
  version: 1;
  records: AccountSessionRecord[];
}

export interface IssueAccountSessionInput {
  accountId: string;
  accountUserId: string;
  role: AccountUserRole;
  ttlHours?: number | null;
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH ?? '.attestor/account-sessions.json');
}

export function sessionCookieName(): string {
  return process.env.ATTESTOR_SESSION_COOKIE_NAME?.trim() || 'attestor_session';
}

export function sessionTtlHours(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_SESSION_TTL_HOURS ?? '12', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
}

export function sessionIdleTimeoutMinutes(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_SESSION_IDLE_TIMEOUT_MINUTES ?? '30', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function sessionCookieSecure(): boolean {
  const explicit = process.env.ATTESTOR_SESSION_COOKIE_SECURE?.trim();
  if (explicit) {
    return /^(1|true|yes)$/i.test(explicit);
  }

  const publicBaseUrl = process.env.ATTESTOR_PUBLIC_BASE_URL?.trim();
  if (publicBaseUrl) {
    try {
      return new URL(publicBaseUrl).protocol === 'https:';
    } catch {
      return false;
    }
  }

  const publicHostname = process.env.ATTESTOR_PUBLIC_HOSTNAME?.trim().toLowerCase();
  if (publicHostname) {
    return publicHostname !== 'localhost'
      && publicHostname !== '127.0.0.1'
      && publicHostname !== '::1';
  }

  return false;
}

function defaultStore(): AccountSessionStoreFile {
  return { version: 1, records: [] };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashAccountSessionToken(token: string): string {
  return hashToken(token);
}

export function isAccountSessionRecordExpired(record: AccountSessionRecord, now = Date.now()): boolean {
  const absoluteExpired = Number.isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) <= now;
  const idleTimeoutMs = sessionIdleTimeoutMinutes() * 60 * 1000;
  const lastSeenMs = Date.parse(record.lastSeenAt);
  const idleExpired = Number.isFinite(lastSeenMs) && (lastSeenMs + idleTimeoutMs) <= now;
  return absoluteExpired || idleExpired;
}

function loadStore(): AccountSessionStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AccountSessionStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return parsed;
    }
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: AccountSessionStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeTextFileAtomic(path, `${JSON.stringify(store, null, 2)}\n`);
}

function pruneExpiredSessions(store: AccountSessionStoreFile): boolean {
  const before = store.records.length;
  const now = Date.now();
  store.records = store.records.filter((record) => !isAccountSessionRecordExpired(record, now));
  return before !== store.records.length;
}

export function listAccountSessions(): {
  records: AccountSessionRecord[];
  path: string;
} {
  const path = storePath();
  return withFileLock(path, () => {
    const store = loadStore();
    if (pruneExpiredSessions(store)) saveStore(store);
    return { records: [...store.records], path };
  });
}

export function buildAccountSessionRecord(input: IssueAccountSessionInput): {
  sessionToken: string;
  record: AccountSessionRecord;
} {
  const ttlHours = input.ttlHours ?? sessionTtlHours();
  const sessionToken = `atsess_${randomBytes(32).toString('hex')}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + (ttlHours * 60 * 60 * 1000));
  return {
    sessionToken,
    record: {
      id: `asess_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      accountId: input.accountId,
      accountUserId: input.accountUserId,
      role: input.role,
      tokenHash: hashToken(sessionToken),
      createdAt: createdAt.toISOString(),
      lastSeenAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    },
  };
}

export function issueAccountSession(input: IssueAccountSessionInput): {
  sessionToken: string;
  record: AccountSessionRecord;
  path: string;
} {
  const path = storePath();
  return withFileLock(path, () => {
    const store = loadStore();
    if (pruneExpiredSessions(store)) saveStore(store);
    const { sessionToken, record } = buildAccountSessionRecord(input);
    store.records.push(record);
    saveStore(store);
    return { sessionToken, record, path };
  });
}

export function findAccountSessionByToken(
  token: string,
  options?: { touch?: boolean },
): AccountSessionRecord | null {
  const hashed = hashToken(token);
  return withFileLock(storePath(), () => {
    const store = loadStore();
    let changed = pruneExpiredSessions(store);
    const record = store.records.find((entry) => entry.tokenHash === hashed) ?? null;
    if (!record || record.revokedAt) {
      if (changed) saveStore(store);
      return null;
    }
    if (options?.touch) {
      record.lastSeenAt = new Date().toISOString();
      changed = true;
    }
    if (changed) saveStore(store);
    return { ...record };
  });
}

export function revokeAccountSession(id: string): {
  record: AccountSessionRecord | null;
  path: string;
} {
  const path = storePath();
  return withFileLock(path, () => {
    const store = loadStore();
    const record = store.records.find((entry) => entry.id === id) ?? null;
    if (!record) return { record: null, path };
    if (!record.revokedAt) {
      record.revokedAt = new Date().toISOString();
      saveStore(store);
    }
    return { record: { ...record }, path };
  });
}

export function revokeAccountSessionByToken(token: string): {
  record: AccountSessionRecord | null;
  path: string;
} {
  const hashed = hashToken(token);
  const path = storePath();
  return withFileLock(path, () => {
    const store = loadStore();
    const record = store.records.find((entry) => entry.tokenHash === hashed) ?? null;
    if (!record) return { record: null, path };
    if (!record.revokedAt) {
      record.revokedAt = new Date().toISOString();
      saveStore(store);
    }
    return { record: { ...record }, path };
  });
}

export function revokeAccountSessionsForUser(accountUserId: string): {
  revokedCount: number;
  path: string;
} {
  const path = storePath();
  return withFileLock(path, () => {
    const store = loadStore();
    let revokedCount = 0;
    for (const record of store.records) {
      if (record.accountUserId === accountUserId && !record.revokedAt) {
        record.revokedAt = new Date().toISOString();
        revokedCount += 1;
      }
    }
    if (revokedCount > 0) saveStore(store);
    return { revokedCount, path };
  });
}

export function revokeAccountSessionsForAccount(accountId: string): {
  revokedCount: number;
  path: string;
} {
  const path = storePath();
  return withFileLock(path, () => {
    const store = loadStore();
    let revokedCount = 0;
    for (const record of store.records) {
      if (record.accountId === accountId && !record.revokedAt) {
        record.revokedAt = new Date().toISOString();
        revokedCount += 1;
      }
    }
    if (revokedCount > 0) saveStore(store);
    return { revokedCount, path };
  });
}

export function resetAccountSessionStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
  if (existsSync(`${path}.lock`)) rmSync(`${path}.lock`, { recursive: true, force: true });
}
