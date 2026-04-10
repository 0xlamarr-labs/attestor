import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { HistoricalSchemaComparison, SchemaAttestation } from './schema-attestation.js';
import { compareSchemaAttestations } from './schema-attestation.js';

interface SchemaAttestationHistoryRecord {
  key: string;
  capturedAt: string;
  attestation: SchemaAttestation;
}

interface SchemaAttestationHistoryFile {
  version: 1;
  records: SchemaAttestationHistoryRecord[];
}

function storePath(): string {
  return resolve(process.env.ATTESTOR_SCHEMA_ATTESTATION_HISTORY_PATH ?? '.attestor/postgres-schema-attestations.json');
}

function defaultStore(): SchemaAttestationHistoryFile {
  return { version: 1, records: [] };
}

function loadStore(): SchemaAttestationHistoryFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SchemaAttestationHistoryFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) return parsed;
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: SchemaAttestationHistoryFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function buildSchemaAttestationHistoryKey(attestation: SchemaAttestation): string {
  return [
    'postgres',
    attestation.schemaName,
    attestation.tables.slice().sort().join(','),
    attestation.executionContextHash ?? 'unknown-context',
    hash(`${attestation.schemaName}|${attestation.tables.slice().sort().join(',')}`),
  ].join(':');
}

function sanitizeAttestationForStore(attestation: SchemaAttestation): SchemaAttestation {
  return {
    ...structuredClone(attestation),
    historicalComparison: null,
  };
}

export function findLatestSchemaAttestationHistory(key: string): SchemaAttestationHistoryRecord | null {
  const store = loadStore();
  return store.records
    .filter((record) => record.key === key)
    .sort((left, right) => left.capturedAt < right.capturedAt ? 1 : -1)[0] ?? null;
}

export function recordSchemaAttestationHistory(attestation: SchemaAttestation): HistoricalSchemaComparison | null {
  const store = loadStore();
  const historyKey = buildSchemaAttestationHistoryKey(attestation);
  const previous = findLatestSchemaAttestationHistory(historyKey);
  const comparison = previous ? compareSchemaAttestations(previous.attestation, attestation) : null;

  store.records.push({
    key: historyKey,
    capturedAt: attestation.capturedAt,
    attestation: sanitizeAttestationForStore({
      ...attestation,
      historyKey,
      historicalComparison: null,
    }),
  });

  const maxRecordsPerKey = Number.parseInt(process.env.ATTESTOR_SCHEMA_ATTESTATION_HISTORY_MAX_PER_KEY ?? '20', 10);
  const safeMax = Number.isFinite(maxRecordsPerKey) && maxRecordsPerKey > 0 ? maxRecordsPerKey : 20;
  const grouped = store.records.filter((record) => record.key === historyKey)
    .sort((left, right) => left.capturedAt < right.capturedAt ? 1 : -1);
  const keep = new Set(grouped.slice(0, safeMax).map((record) => `${record.key}:${record.capturedAt}`));
  store.records = store.records.filter((record) => {
    if (record.key !== historyKey) return true;
    return keep.has(`${record.key}:${record.capturedAt}`);
  });

  saveStore(store);

  if (!previous || !comparison) return null;
  return {
    historyKey,
    previousCapturedAt: previous.attestation.capturedAt,
    previousAttestationHash: previous.attestation.attestationHash,
    currentAttestationHash: attestation.attestationHash,
    schemaChanged: comparison.schemaChanged,
    dataChanged: comparison.dataChanged,
    contentChanged: comparison.contentChanged,
    summary: comparison.summary,
  };
}

export function resetSchemaAttestationHistoryForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
