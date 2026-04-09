/**
 * Account User Action Token Store — manual-delivery invite/reset first slice.
 *
 * Stores one-time opaque action tokens for hosted customer user lifecycle
 * flows without assuming outbound email infrastructure yet.
 *
 * BOUNDARY:
 * - Local file-backed store only
 * - Tokens are hashed at rest
 * - Invite and password-reset delivery is still manual/operator-driven
 * - No MFA/TOTP, WebAuthn, or federated SSO/SAML yet
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AccountUserRole } from './account-user-store.js';

export type AccountUserActionTokenPurpose = 'invite' | 'password_reset';

export interface AccountUserActionTokenRecord {
  id: string;
  purpose: AccountUserActionTokenPurpose;
  accountId: string;
  accountUserId: string | null;
  email: string;
  displayName: string | null;
  role: AccountUserRole | null;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  issuedByAccountUserId: string | null;
}

interface AccountUserActionTokenStoreFile {
  version: 1;
  records: AccountUserActionTokenRecord[];
}

export interface IssueAccountInviteTokenInput {
  accountId: string;
  email: string;
  displayName: string;
  role: AccountUserRole;
  issuedByAccountUserId: string | null;
  ttlHours?: number | null;
}

export interface IssuePasswordResetTokenInput {
  accountId: string;
  accountUserId: string;
  email: string;
  issuedByAccountUserId: string | null;
  ttlMinutes?: number | null;
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH ?? '.attestor/account-user-tokens.json');
}

function defaultStore(): AccountUserActionTokenStoreFile {
  return { version: 1, records: [] };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashAccountUserActionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function inviteTtlHours(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_ACCOUNT_INVITE_TTL_HOURS ?? '72', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
}

function passwordResetTtlMinutes(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_PASSWORD_RESET_TTL_MINUTES ?? '30', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function loadStore(): AccountUserActionTokenStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AccountUserActionTokenStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return parsed;
    }
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: AccountUserActionTokenStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function isExpired(record: AccountUserActionTokenRecord, now = Date.now()): boolean {
  return Number.isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) <= now;
}

function isUsable(record: AccountUserActionTokenRecord, now = Date.now()): boolean {
  return !record.revokedAt && !record.consumedAt && !isExpired(record, now);
}

function pruneExpired(store: AccountUserActionTokenStoreFile): boolean {
  const before = store.records.length;
  const now = Date.now();
  store.records = store.records.filter((record) => !isExpired(record, now));
  return before !== store.records.length;
}

function revokeMatching(
  store: AccountUserActionTokenStoreFile,
  predicate: (record: AccountUserActionTokenRecord) => boolean,
): boolean {
  let changed = false;
  const revokedAt = new Date().toISOString();
  for (const record of store.records) {
    if (predicate(record) && isUsable(record)) {
      record.revokedAt = revokedAt;
      record.updatedAt = revokedAt;
      changed = true;
    }
  }
  return changed;
}

function buildActionTokenRecord(base: {
  purpose: AccountUserActionTokenPurpose;
  accountId: string;
  accountUserId: string | null;
  email: string;
  displayName: string | null;
  role: AccountUserRole | null;
  issuedByAccountUserId: string | null;
  expiresAt: Date;
}): { token: string; record: AccountUserActionTokenRecord } {
  const token = `atok_${randomBytes(32).toString('hex')}`;
  const createdAt = new Date().toISOString();
  return {
    token,
    record: {
      id: `autok_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      purpose: base.purpose,
      accountId: base.accountId,
      accountUserId: base.accountUserId,
      email: normalizeEmail(base.email),
      displayName: base.displayName?.trim() || null,
      role: base.role,
      tokenHash: hashAccountUserActionToken(token),
      createdAt,
      updatedAt: createdAt,
      expiresAt: base.expiresAt.toISOString(),
      consumedAt: null,
      revokedAt: null,
      issuedByAccountUserId: base.issuedByAccountUserId,
    },
  };
}

export function buildAccountInviteTokenRecord(input: IssueAccountInviteTokenInput): {
  token: string;
  record: AccountUserActionTokenRecord;
} {
  const normalizedEmail = normalizeEmail(input.email);
  const expiresAt = new Date(Date.now() + ((input.ttlHours ?? inviteTtlHours()) * 60 * 60 * 1000));
  return buildActionTokenRecord({
    purpose: 'invite',
    accountId: input.accountId,
    accountUserId: null,
    email: normalizedEmail,
    displayName: input.displayName,
    role: input.role,
    issuedByAccountUserId: input.issuedByAccountUserId,
    expiresAt,
  });
}

export function buildPasswordResetTokenRecord(input: IssuePasswordResetTokenInput): {
  token: string;
  record: AccountUserActionTokenRecord;
} {
  const expiresAt = new Date(Date.now() + ((input.ttlMinutes ?? passwordResetTtlMinutes()) * 60 * 1000));
  return buildActionTokenRecord({
    purpose: 'password_reset',
    accountId: input.accountId,
    accountUserId: input.accountUserId,
    email: input.email,
    displayName: null,
    role: null,
    issuedByAccountUserId: input.issuedByAccountUserId,
    expiresAt,
  });
}

export function issueAccountInviteToken(input: IssueAccountInviteTokenInput): {
  token: string;
  record: AccountUserActionTokenRecord;
  path: string;
} {
  const store = loadStore();
  pruneExpired(store);
  const normalizedEmail = normalizeEmail(input.email);
  revokeMatching(
    store,
    (record) => record.purpose === 'invite' && record.accountId === input.accountId && record.email === normalizedEmail,
  );
  const issued = buildAccountInviteTokenRecord(input);
  store.records.push(issued.record);
  saveStore(store);
  return { token: issued.token, record: issued.record, path: storePath() };
}

export function issuePasswordResetToken(input: IssuePasswordResetTokenInput): {
  token: string;
  record: AccountUserActionTokenRecord;
  path: string;
} {
  const store = loadStore();
  pruneExpired(store);
  revokeMatching(
    store,
    (record) => record.purpose === 'password_reset' && record.accountUserId === input.accountUserId,
  );
  const issued = buildPasswordResetTokenRecord(input);
  store.records.push(issued.record);
  saveStore(store);
  return { token: issued.token, record: issued.record, path: storePath() };
}

export function listAccountUserActionTokensByAccountId(
  accountId: string,
  options?: { purpose?: AccountUserActionTokenPurpose | null },
): { records: AccountUserActionTokenRecord[]; path: string } {
  const store = loadStore();
  if (pruneExpired(store)) saveStore(store);
  const records = store.records
    .filter((record) => record.accountId === accountId)
    .filter((record) => !options?.purpose || record.purpose === options.purpose)
    .sort((left, right) => left.createdAt < right.createdAt ? 1 : -1);
  return { records, path: storePath() };
}

export function listAllAccountUserActionTokens(): {
  records: AccountUserActionTokenRecord[];
  path: string;
} {
  const store = loadStore();
  if (pruneExpired(store)) saveStore(store);
  return { records: store.records, path: storePath() };
}

export function findAccountUserActionTokenByToken(token: string): AccountUserActionTokenRecord | null {
  const store = loadStore();
  let changed = pruneExpired(store);
  const record = store.records.find((entry) => entry.tokenHash === hashAccountUserActionToken(token)) ?? null;
  if (!record || !isUsable(record)) {
    if (changed) saveStore(store);
    return null;
  }
  if (changed) saveStore(store);
  return record;
}

export function consumeAccountUserActionToken(id: string): {
  record: AccountUserActionTokenRecord | null;
  path: string;
} {
  const store = loadStore();
  const record = store.records.find((entry) => entry.id === id) ?? null;
  if (!record || !isUsable(record)) return { record: null, path: storePath() };
  record.consumedAt = new Date().toISOString();
  record.updatedAt = record.consumedAt;
  saveStore(store);
  return { record, path: storePath() };
}

export function revokeAccountUserActionToken(id: string): {
  record: AccountUserActionTokenRecord | null;
  path: string;
} {
  const store = loadStore();
  const record = store.records.find((entry) => entry.id === id) ?? null;
  if (!record) return { record: null, path: storePath() };
  if (!record.revokedAt && !record.consumedAt) {
    record.revokedAt = new Date().toISOString();
    record.updatedAt = record.revokedAt;
    saveStore(store);
  }
  return { record, path: storePath() };
}

export function revokeAccountUserActionTokensForUser(
  accountUserId: string,
  purpose?: AccountUserActionTokenPurpose,
): { revokedCount: number; path: string } {
  const store = loadStore();
  let revokedCount = 0;
  const revokedAt = new Date().toISOString();
  for (const record of store.records) {
    if (
      record.accountUserId === accountUserId
      && (!purpose || record.purpose === purpose)
      && isUsable(record)
    ) {
      record.revokedAt = revokedAt;
      record.updatedAt = revokedAt;
      revokedCount += 1;
    }
  }
  if (revokedCount > 0) saveStore(store);
  return { revokedCount, path: storePath() };
}

export function resetAccountUserActionTokenStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
