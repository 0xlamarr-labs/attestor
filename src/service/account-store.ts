/**
 * Account Store — Hosted customer onboarding first slice
 *
 * Persists hosted customer account records in a local JSON file so operators
 * can track who a tenant/key belongs to.
 *
 * BOUNDARY:
 * - Local file-backed store only
 * - One primary tenant per account in this first slice
 * - No invoices, billing provider sync, or customer self-serve portal yet
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface HostedAccountRecord {
  id: string;
  accountName: string;
  contactEmail: string;
  primaryTenantId: string;
  status: 'active' | 'archived';
  createdAt: string;
  archivedAt: string | null;
}

interface AccountStoreFile {
  version: 1;
  records: HostedAccountRecord[];
}

export interface CreateHostedAccountInput {
  accountName: string;
  contactEmail: string;
  primaryTenantId: string;
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_ACCOUNT_STORE_PATH ?? '.attestor/accounts.json');
}

function defaultStore(): AccountStoreFile {
  return { version: 1, records: [] };
}

function loadStore(): AccountStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AccountStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) return parsed;
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: AccountStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function createHostedAccount(input: CreateHostedAccountInput): {
  record: HostedAccountRecord;
  path: string;
} {
  const record: HostedAccountRecord = {
    id: `acct_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    accountName: input.accountName,
    contactEmail: input.contactEmail,
    primaryTenantId: input.primaryTenantId,
    status: 'active',
    createdAt: new Date().toISOString(),
    archivedAt: null,
  };

  const store = loadStore();
  store.records.push(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function listHostedAccounts(): {
  records: HostedAccountRecord[];
  path: string;
} {
  const store = loadStore();
  return { records: store.records, path: storePath() };
}

export function findHostedAccountByTenantId(primaryTenantId: string): HostedAccountRecord | null {
  const store = loadStore();
  return store.records.find((entry) => entry.primaryTenantId === primaryTenantId && entry.status === 'active') ?? null;
}

export function resetAccountStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
