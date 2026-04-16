/**
 * Admin Audit Log — Tamper-evident ledger for hosted operator mutations.
 *
 * BOUNDARY:
 * - Local file-backed append-only ledger only
 * - Hash-linked records provide tamper evidence, not external notarization
 * - Logs only operator/admin mutations, not every tenant request
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { writeTextFileAtomic } from './file-store.js';
import { hashJsonValue } from './json-stable.js';

export type AdminAuditAction =
  | 'account.created'
  | 'account.suspended'
  | 'account.reactivated'
  | 'account.archived'
  | 'account.billing.attached'
  | 'async_job.retried'
  | 'billing.stripe.webhook_applied'
  | 'tenant_key.issued'
  | 'tenant_key.rotated'
  | 'tenant_key.deactivated'
  | 'tenant_key.reactivated'
  | 'tenant_key.recovered'
  | 'tenant_key.revoked';

export interface AdminAuditRecord {
  id: string;
  occurredAt: string;
  actorType: 'admin_api_key' | 'stripe_webhook';
  actorLabel: string;
  action: AdminAuditAction;
  routeId: string;
  accountId: string | null;
  tenantId: string | null;
  tenantKeyId: string | null;
  planId: string | null;
  monthlyRunQuota: number | null;
  idempotencyKey: string | null;
  requestHash: string;
  metadata: Record<string, unknown>;
  previousHash: string | null;
  eventHash: string;
}

interface AdminAuditLogFile {
  version: 1;
  records: AdminAuditRecord[];
}

function logPath(): string {
  return resolve(process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH ?? '.attestor/admin-audit-log.json');
}

function defaultLog(): AdminAuditLogFile {
  return { version: 1, records: [] };
}

function loadLog(): AdminAuditLogFile {
  const path = logPath();
  if (!existsSync(path)) return defaultLog();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AdminAuditLogFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) return parsed;
  } catch {
    // fall through to safe default
  }
  return defaultLog();
}

function saveLog(log: AdminAuditLogFile): void {
  const path = logPath();
  mkdirSync(dirname(path), { recursive: true });
  writeTextFileAtomic(path, `${JSON.stringify(log, null, 2)}\n`);
}

function computeEventHash(record: Omit<AdminAuditRecord, 'eventHash'>): string {
  return hashJsonValue(record);
}

export function appendAdminAuditRecord(input: Omit<AdminAuditRecord, 'id' | 'occurredAt' | 'previousHash' | 'eventHash'>): {
  record: AdminAuditRecord;
  path: string;
} {
  const log = loadLog();
  const previousHash = log.records.length > 0 ? log.records[log.records.length - 1]?.eventHash ?? null : null;
  const baseRecord = {
    id: `audit_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    occurredAt: new Date().toISOString(),
    previousHash,
    ...input,
  };
  const record: AdminAuditRecord = {
    ...baseRecord,
    eventHash: computeEventHash(baseRecord),
  };
  log.records.push(record);
  saveLog(log);
  return { record, path: logPath() };
}

export function listAdminAuditRecords(filters?: {
  action?: AdminAuditAction | null;
  tenantId?: string | null;
  accountId?: string | null;
  limit?: number | null;
}): {
  records: AdminAuditRecord[];
  chainIntact: boolean;
  latestHash: string | null;
  path: string;
} {
  const log = loadLog();
  const chainIntact = verifyAdminAuditChain(log.records);
  let records = log.records
    .filter((record) => !filters?.action || record.action === filters.action)
    .filter((record) => !filters?.tenantId || record.tenantId === filters.tenantId)
    .filter((record) => !filters?.accountId || record.accountId === filters.accountId)
    .sort((left, right) => left.occurredAt < right.occurredAt ? 1 : -1);

  if (filters?.limit && filters.limit > 0) {
    records = records.slice(0, filters.limit);
  }

  return {
    records,
    chainIntact,
    latestHash: log.records.length > 0 ? log.records[log.records.length - 1]?.eventHash ?? null : null,
    path: logPath(),
  };
}

export function verifyAdminAuditChain(records: AdminAuditRecord[]): boolean {
  let previousHash: string | null = null;
  for (const record of records) {
    if (record.previousHash !== previousHash) return false;
    const { eventHash: actualEventHash, ...rest } = record;
    if (computeEventHash(rest) !== actualEventHash) return false;
    previousHash = actualEventHash;
  }
  return true;
}

export function resetAdminAuditLogForTests(): void {
  const path = logPath();
  if (existsSync(path)) rmSync(path, { force: true });
}
