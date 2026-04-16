/**
 * Async Dead-Letter Store - persistent operator view of terminal async failures.
 *
 * BOUNDARY:
 * - Local file-backed first slice by default
 * - Stores final async failures for operator inspection and retry workflows
 * - Not a full incident-management system or long-term analytics warehouse
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { writeTextFileAtomic } from './file-store.js';

export type AsyncDeadLetterBackendMode = 'bullmq' | 'in_process';

export interface AsyncDeadLetterRecord {
  jobId: string;
  name: string;
  backendMode: AsyncDeadLetterBackendMode;
  tenantId: string | null;
  planId: string | null;
  state: string;
  failedReason: string | null;
  attemptsMade: number;
  maxAttempts: number;
  requestedAt: string | null;
  submittedAt: string | null;
  processedAt: string | null;
  failedAt: string | null;
  recordedAt: string;
}

interface AsyncDeadLetterStoreFile {
  version: 1;
  records: AsyncDeadLetterRecord[];
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_ASYNC_DLQ_STORE_PATH ?? '.attestor/async-dead-letter.json');
}

function defaultStore(): AsyncDeadLetterStoreFile {
  return { version: 1, records: [] };
}

function loadStore(): AsyncDeadLetterStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AsyncDeadLetterStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return {
        version: 1,
        records: parsed.records.map(normalizeAsyncDeadLetterRecord),
      };
    }
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: AsyncDeadLetterStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeTextFileAtomic(path, `${JSON.stringify(store, null, 2)}\n`);
}

function sortRecords(records: AsyncDeadLetterRecord[]): AsyncDeadLetterRecord[] {
  return [...records].sort((left, right) => {
    const leftKey = left.failedAt ?? left.recordedAt;
    const rightKey = right.failedAt ?? right.recordedAt;
    if (leftKey === rightKey) return left.jobId < right.jobId ? 1 : -1;
    return leftKey < rightKey ? 1 : -1;
  });
}

export function normalizeAsyncDeadLetterRecord(record: AsyncDeadLetterRecord): AsyncDeadLetterRecord {
  return {
    ...record,
    backendMode: record.backendMode === 'in_process' ? 'in_process' : 'bullmq',
    tenantId: record.tenantId ?? null,
    planId: record.planId ?? null,
    state: record.state || 'failed',
    failedReason: record.failedReason ?? null,
    attemptsMade: Number.isFinite(record.attemptsMade) ? Math.max(0, record.attemptsMade) : 0,
    maxAttempts: Number.isFinite(record.maxAttempts) ? Math.max(1, record.maxAttempts) : 1,
    requestedAt: record.requestedAt ?? null,
    submittedAt: record.submittedAt ?? null,
    processedAt: record.processedAt ?? null,
    failedAt: record.failedAt ?? null,
    recordedAt: record.recordedAt ?? new Date().toISOString(),
  };
}

export function readAsyncDeadLetterStoreSnapshot(): {
  path: string;
  records: AsyncDeadLetterRecord[];
} {
  const store = loadStore();
  return {
    path: storePath(),
    records: sortRecords(store.records),
  };
}

export function upsertAsyncDeadLetterRecord(
  input: AsyncDeadLetterRecord,
): { record: AsyncDeadLetterRecord; path: string } {
  const store = loadStore();
  const record = normalizeAsyncDeadLetterRecord(input);
  const existingIdx = store.records.findIndex((entry) => entry.jobId === record.jobId);
  if (existingIdx >= 0) {
    store.records[existingIdx] = record;
  } else {
    store.records.push(record);
  }
  store.records = sortRecords(store.records);
  saveStore(store);
  return { record, path: storePath() };
}

export function listAsyncDeadLetterRecords(filters?: {
  tenantId?: string | null;
  backendMode?: AsyncDeadLetterBackendMode | null;
  limit?: number | null;
}): { records: AsyncDeadLetterRecord[]; path: string } {
  const store = loadStore();
  let records = sortRecords(store.records)
    .filter((record) => !filters?.tenantId || record.tenantId === filters.tenantId)
    .filter((record) => !filters?.backendMode || record.backendMode === filters.backendMode);
  if (filters?.limit && filters.limit > 0) {
    records = records.slice(0, filters.limit);
  }
  return { records, path: storePath() };
}

export function removeAsyncDeadLetterRecord(jobId: string): {
  removed: boolean;
  record: AsyncDeadLetterRecord | null;
  path: string;
} {
  const store = loadStore();
  const existingIdx = store.records.findIndex((entry) => entry.jobId === jobId);
  if (existingIdx < 0) {
    return { removed: false, record: null, path: storePath() };
  }
  const [record] = store.records.splice(existingIdx, 1);
  saveStore(store);
  return { removed: true, record, path: storePath() };
}

export function resetAsyncDeadLetterStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
