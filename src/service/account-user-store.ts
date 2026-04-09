/**
 * Account User Store — hosted customer user + RBAC first slice.
 *
 * Persists human account users in a local JSON file so hosted customers can
 * bootstrap an initial account admin and manage least-privilege users even
 * when the shared PostgreSQL control-plane is not configured.
 *
 * BOUNDARY:
 * - Local file-backed store only
 * - One account membership per email in this first slice
 * - Passwords use built-in scrypt (memory-hard) instead of Argon2id
 * - Invite and password-reset flows exist, but delivery is still manual/operator-driven
 * - No MFA or SSO/SAML yet
 */

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type AccountUserRole = 'account_admin' | 'billing_admin' | 'read_only';
export type AccountUserStatus = 'active' | 'inactive';

export interface AccountUserPasswordState {
  algorithm: 'scrypt';
  params: {
    N: number;
    r: number;
    p: number;
    keylen: number;
  };
  salt: string;
  hash: string;
}

export interface AccountUserRecord {
  id: string;
  accountId: string;
  email: string;
  displayName: string;
  role: AccountUserRole;
  status: AccountUserStatus;
  password: AccountUserPasswordState;
  createdAt: string;
  updatedAt: string;
  passwordUpdatedAt: string;
  deactivatedAt: string | null;
  lastLoginAt: string | null;
}

interface AccountUserStoreFile {
  version: 1;
  records: AccountUserRecord[];
}

export interface CreateAccountUserInput {
  accountId: string;
  email: string;
  displayName: string;
  password: string;
  role: AccountUserRole;
}

export class AccountUserStoreError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'AccountUserStoreError';
  }
}

const PASSWORD_PARAMS = {
  N: 16_384,
  r: 8,
  p: 1,
  keylen: 64,
} as const;

function storePath(): string {
  return resolve(process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH ?? '.attestor/account-users.json');
}

function defaultStore(): AccountUserStoreFile {
  return { version: 1, records: [] };
}

function normalizeRecord(record: AccountUserRecord): AccountUserRecord {
  return {
    ...record,
    passwordUpdatedAt: record.passwordUpdatedAt ?? record.updatedAt ?? record.createdAt,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeAccountUserEmail(email: string): string {
  return normalizeEmail(email);
}

function loadStore(): AccountUserStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AccountUserStoreFile;
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

function saveStore(store: AccountUserStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function hashPassword(password: string): AccountUserPasswordState {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, PASSWORD_PARAMS.keylen, {
    N: PASSWORD_PARAMS.N,
    r: PASSWORD_PARAMS.r,
    p: PASSWORD_PARAMS.p,
  });
  return {
    algorithm: 'scrypt',
    params: { ...PASSWORD_PARAMS },
    salt: salt.toString('hex'),
    hash: derived.toString('hex'),
  };
}

export function createPasswordHashState(password: string): AccountUserPasswordState {
  return hashPassword(password);
}

export function verifyAccountUserPasswordRecord(
  passwordState: AccountUserPasswordState,
  candidatePassword: string,
): boolean {
  const expected = Buffer.from(passwordState.hash, 'hex');
  const actual = scryptSync(candidatePassword, Buffer.from(passwordState.salt, 'hex'), passwordState.params.keylen, {
    N: passwordState.params.N,
    r: passwordState.params.r,
    p: passwordState.params.p,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function ensureUniqueEmail(store: AccountUserStoreFile, email: string, selfId?: string): void {
  const existing = store.records.find((entry) => entry.email === email && entry.id !== selfId);
  if (existing) {
    throw new AccountUserStoreError(
      'CONFLICT',
      `Account user email '${email}' is already assigned to account '${existing.accountId}'.`,
    );
  }
}

function findRecord(store: AccountUserStoreFile, id: string): AccountUserRecord | null {
  return store.records.find((entry) => entry.id === id) ?? null;
}

function requireRecord(store: AccountUserStoreFile, id: string): AccountUserRecord {
  const record = findRecord(store, id);
  if (!record) {
    throw new AccountUserStoreError('NOT_FOUND', `Account user '${id}' was not found.`);
  }
  return record;
}

function activeAdminCount(store: AccountUserStoreFile, accountId: string): number {
  return store.records.filter((entry) =>
    entry.accountId === accountId &&
    entry.role === 'account_admin' &&
    entry.status === 'active').length;
}

export function buildAccountUserRecord(input: CreateAccountUserInput): AccountUserRecord {
  const normalizedEmail = normalizeEmail(input.email);
  const now = new Date().toISOString();
  return {
    id: `acctusr_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    accountId: input.accountId,
    email: normalizedEmail,
    displayName: input.displayName.trim(),
    role: input.role,
    status: 'active',
    password: hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
    passwordUpdatedAt: now,
    deactivatedAt: null,
    lastLoginAt: null,
  };
}

export function listAccountUsersByAccountId(accountId: string): {
  records: AccountUserRecord[];
  path: string;
} {
  const store = loadStore();
  return {
    records: store.records
      .filter((entry) => entry.accountId === accountId)
      .map((entry) => normalizeRecord(entry))
      .sort((left, right) => left.createdAt < right.createdAt ? -1 : 1),
    path: storePath(),
  };
}

export function listAllAccountUsers(): {
  records: AccountUserRecord[];
  path: string;
} {
  const store = loadStore();
  return { records: store.records.map((record) => normalizeRecord(record)), path: storePath() };
}

export function countAccountUsersForAccount(accountId: string): number {
  const store = loadStore();
  return store.records.filter((entry) => entry.accountId === accountId).length;
}

export function findAccountUserById(id: string): AccountUserRecord | null {
  const store = loadStore();
  const record = findRecord(store, id);
  return record ? normalizeRecord(record) : null;
}

export function findAccountUserByEmail(email: string): AccountUserRecord | null {
  const store = loadStore();
  const record = store.records.find((entry) => entry.email === normalizeEmail(email)) ?? null;
  return record ? normalizeRecord(record) : null;
}

export function createAccountUser(input: CreateAccountUserInput): {
  record: AccountUserRecord;
  path: string;
} {
  const store = loadStore();
  const normalizedEmail = normalizeEmail(input.email);
  ensureUniqueEmail(store, normalizedEmail);
  const record = buildAccountUserRecord(input);
  store.records.push(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function recordAccountUserLogin(id: string): {
  record: AccountUserRecord;
  path: string;
} {
  const store = loadStore();
  const record = requireRecord(store, id);
  record.lastLoginAt = new Date().toISOString();
  record.updatedAt = record.lastLoginAt;
  saveStore(store);
  return { record, path: storePath() };
}

export function setAccountUserPassword(
  id: string,
  nextPassword: string,
): {
  record: AccountUserRecord;
  path: string;
} {
  const store = loadStore();
  const record = requireRecord(store, id);
  const now = new Date().toISOString();
  record.password = hashPassword(nextPassword);
  record.passwordUpdatedAt = now;
  record.updatedAt = now;
  saveStore(store);
  return { record, path: storePath() };
}

export function setAccountUserStatus(
  id: string,
  nextStatus: AccountUserStatus,
): {
  record: AccountUserRecord;
  path: string;
} {
  const store = loadStore();
  const record = requireRecord(store, id);
  if (record.status === nextStatus) {
    return { record, path: storePath() };
  }
  if (nextStatus === 'inactive' && record.role === 'account_admin' && activeAdminCount(store, record.accountId) <= 1) {
    throw new AccountUserStoreError(
      'INVALID_STATE',
      `Account '${record.accountId}' must retain at least one active account_admin user.`,
    );
  }
  record.status = nextStatus;
  record.updatedAt = new Date().toISOString();
  record.deactivatedAt = nextStatus === 'inactive' ? record.updatedAt : null;
  saveStore(store);
  return { record, path: storePath() };
}

export function resetAccountUserStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
