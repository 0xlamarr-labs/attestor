/**
 * Attestor Usage Meter — Hosted API First Slice
 *
 * Tracks billable pipeline run usage per tenant in a local file-backed ledger.
 *
 * BOUNDARY:
 * - Monthly counters keyed by tenantId + month
 * - Local single-node JSON ledger, persisted on disk
 * - No shared multi-node billing datastore or concurrency locking yet
 * - Intended for hosted-product shell and quota enforcement
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface UsageContext {
  tenantId: string;
  planId: string;
  meter: 'monthly_pipeline_runs';
  period: string;
  used: number;
  quota: number | null;
  remaining: number | null;
  enforced: boolean;
}

export interface UsageLedgerRecord {
  tenantId: string;
  period: string;
  used: number;
  updatedAt: string;
}

interface UsageLedgerFile {
  version: 1;
  monthlyPipelineRuns: UsageLedgerRecord[];
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function usageKey(tenantId: string, period: string): string {
  return `${tenantId}:${period}`;
}

function ledgerPath(): string {
  return resolve(process.env.ATTESTOR_USAGE_LEDGER_PATH ?? '.attestor/usage-ledger.json');
}

function defaultLedger(): UsageLedgerFile {
  return { version: 1, monthlyPipelineRuns: [] };
}

function loadLedger(): UsageLedgerFile {
  const path = ledgerPath();
  if (!existsSync(path)) return defaultLedger();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as UsageLedgerFile;
    if (parsed.version === 1 && Array.isArray(parsed.monthlyPipelineRuns)) return parsed;
  } catch {
    // fall through to safe default
  }
  return defaultLedger();
}

function saveLedger(ledger: UsageLedgerFile): void {
  const path = ledgerPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function loadUsedCount(tenantId: string, period: string): number {
  const ledger = loadLedger();
  return ledger.monthlyPipelineRuns.find((entry) => entry.tenantId === tenantId && entry.period === period)?.used ?? 0;
}

export function getUsageContext(
  tenantId: string,
  planId: string | null | undefined,
  quota: number | null | undefined,
): UsageContext {
  const period = currentPeriod();
  const used = loadUsedCount(tenantId, period);
  const resolvedQuota = typeof quota === 'number' && quota >= 0 ? quota : null;
  return {
    tenantId,
    planId: planId ?? 'community',
    meter: 'monthly_pipeline_runs',
    period,
    used,
    quota: resolvedQuota,
    remaining: resolvedQuota === null ? null : Math.max(0, resolvedQuota - used),
    enforced: resolvedQuota !== null,
  };
}

export function canConsumePipelineRun(
  tenantId: string,
  planId: string | null | undefined,
  quota: number | null | undefined,
): { allowed: boolean; usage: UsageContext } {
  const usage = getUsageContext(tenantId, planId, quota);
  if (!usage.enforced) return { allowed: true, usage };
  return { allowed: usage.used < (usage.quota ?? 0), usage };
}

export function consumePipelineRun(
  tenantId: string,
  planId: string | null | undefined,
  quota: number | null | undefined,
): UsageContext {
  const period = currentPeriod();
  const ledger = loadLedger();
  const key = usageKey(tenantId, period);
  const existing = ledger.monthlyPipelineRuns.find((entry) => usageKey(entry.tenantId, entry.period) === key);
  if (existing) {
    existing.used += 1;
    existing.updatedAt = new Date().toISOString();
  } else {
    ledger.monthlyPipelineRuns.push({
      tenantId,
      period,
      used: 1,
      updatedAt: new Date().toISOString(),
    });
  }
  saveLedger(ledger);
  return getUsageContext(tenantId, planId, quota);
}

export function readUsageLedgerSnapshot(): {
  path: string;
  records: UsageLedgerRecord[];
} {
  const ledger = loadLedger();
  return {
    path: ledgerPath(),
    records: ledger.monthlyPipelineRuns,
  };
}

export function queryUsageLedger(filters?: {
  tenantId?: string | null;
  period?: string | null;
}): UsageLedgerRecord[] {
  const ledger = loadLedger();
  return ledger.monthlyPipelineRuns
    .filter((entry) => !filters?.tenantId || entry.tenantId === filters.tenantId)
    .filter((entry) => !filters?.period || entry.period === filters.period)
    .sort((a, b) => {
      if (a.period !== b.period) return a.period < b.period ? 1 : -1;
      if (a.used !== b.used) return b.used - a.used;
      return a.tenantId.localeCompare(b.tenantId);
    });
}

export function resetUsageMeter(): void {
  const path = ledgerPath();
  if (existsSync(path)) rmSync(path, { force: true });
}
