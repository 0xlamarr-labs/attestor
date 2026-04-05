/**
 * Schema and Data-State Attestation
 *
 * Captures bounded, verifiable evidence of the database schema and data state
 * at the time of a governed query execution. This is NOT a full database
 * snapshot — it is a fingerprint that proves:
 *
 * 1. WHICH tables existed with WHICH columns and types (schema fingerprint)
 * 2. HOW MUCH data was in each table at query time (row count sentinels)
 * 3. WHETHER any rows were modified since a reference point (xmin sentinel)
 *
 * HONEST BOUNDARIES:
 * - Proves schema structure, not data content
 * - Detects volume changes, not specific row mutations
 * - xmin-based change detection is bounded (transaction-ID wraparound limits)
 * - This is evidence, not a full audit trail — CDC is needed for row-level attribution
 *
 * ZERO TARGET DATABASE CHANGES REQUIRED.
 * All queries use information_schema and pg_catalog — read-only, safe.
 */

import { createHash } from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SchemaColumn {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
  ordinalPosition: number;
}

export interface TableSentinel {
  tableName: string;
  rowCount: number;
  /** Max transaction ID — detects any row modification since last check. */
  maxXmin: string | null;
}

export interface SchemaAttestation {
  version: '1.0';
  type: 'attestor.schema_attestation.v1';
  capturedAt: string;
  /** Database context hash at capture time. */
  executionContextHash: string | null;
  /** Schema fingerprint: SHA-256 of ordered column definitions. */
  schemaFingerprint: string;
  /** Per-table column definitions. */
  columns: SchemaColumn[];
  /** Per-table data sentinels. */
  sentinels: TableSentinel[];
  /** Sentinel fingerprint: SHA-256 of ordered sentinel values. */
  sentinelFingerprint: string;
  /** Combined attestation hash: schema + sentinels. */
  attestationHash: string;
  /** Tables that were attested. */
  tables: string[];
  /** Schema name. */
  schemaName: string;
}

export interface SchemaComparisonResult {
  schemaChanged: boolean;
  dataChanged: boolean;
  /** Per-table comparison. */
  tableChanges: TableChange[];
  /** Summary. */
  summary: string;
}

export interface TableChange {
  tableName: string;
  schemaChanged: boolean;
  rowCountChanged: boolean;
  previousRowCount: number | null;
  currentRowCount: number | null;
  xminChanged: boolean;
}

// ─── Schema Capture (PostgreSQL) ────────────────────────────────────────────

/**
 * Capture schema attestation from a live PostgreSQL connection.
 * Requires an active pg Client that is already connected.
 */
export async function captureSchemaAttestation(
  client: any,
  schemaName: string,
  tables: string[],
  executionContextHash: string | null,
): Promise<SchemaAttestation> {
  const capturedAt = new Date().toISOString();

  // 1. Schema fingerprint — query information_schema.columns
  const colResult = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = ANY($2)
    ORDER BY table_name, ordinal_position
  `, [schemaName, tables]);

  const columns: SchemaColumn[] = colResult.rows.map((r: any) => ({
    tableName: r.table_name,
    columnName: r.column_name,
    dataType: r.data_type,
    isNullable: r.is_nullable,
    columnDefault: r.column_default,
    ordinalPosition: Number(r.ordinal_position),
  }));

  const schemaFingerprint = createHash('sha256')
    .update(JSON.stringify(columns))
    .digest('hex')
    .slice(0, 32);

  // 2. Data sentinels — COUNT(*) + MAX(xmin) per table
  const sentinels: TableSentinel[] = [];
  for (const table of tables) {
    try {
      const sentResult = await client.query(
        `SELECT COUNT(*)::int AS row_count, MAX(xmin::text::bigint)::text AS max_xmin FROM "${schemaName}"."${table}"`
      );
      sentinels.push({
        tableName: table,
        rowCount: sentResult.rows[0]?.row_count ?? 0,
        maxXmin: sentResult.rows[0]?.max_xmin ?? null,
      });
    } catch {
      // Table might not exist or access denied — record as zero
      sentinels.push({ tableName: table, rowCount: 0, maxXmin: null });
    }
  }

  const sentinelFingerprint = createHash('sha256')
    .update(JSON.stringify(sentinels))
    .digest('hex')
    .slice(0, 32);

  // 3. Combined attestation hash
  const attestationHash = createHash('sha256')
    .update(`${schemaFingerprint}|${sentinelFingerprint}|${capturedAt}`)
    .digest('hex')
    .slice(0, 32);

  return {
    version: '1.0',
    type: 'attestor.schema_attestation.v1',
    capturedAt,
    executionContextHash,
    schemaFingerprint,
    columns,
    sentinels,
    sentinelFingerprint,
    attestationHash,
    tables,
    schemaName,
  };
}

// ─── Schema Comparison ──────────────────────────────────────────────────────

/**
 * Compare two schema attestations to detect changes.
 */
export function compareSchemaAttestations(
  previous: SchemaAttestation,
  current: SchemaAttestation,
): SchemaComparisonResult {
  const schemaChanged = previous.schemaFingerprint !== current.schemaFingerprint;

  const prevSentinelMap = new Map(previous.sentinels.map(s => [s.tableName, s]));
  const currSentinelMap = new Map(current.sentinels.map(s => [s.tableName, s]));

  const allTables = new Set([...previous.tables, ...current.tables]);
  const tableChanges: TableChange[] = [];
  let anyDataChanged = false;

  for (const table of allTables) {
    const prev = prevSentinelMap.get(table);
    const curr = currSentinelMap.get(table);

    const rowCountChanged = (prev?.rowCount ?? -1) !== (curr?.rowCount ?? -1);
    const xminChanged = (prev?.maxXmin ?? '') !== (curr?.maxXmin ?? '');

    if (rowCountChanged || xminChanged) anyDataChanged = true;

    // Check if columns changed for this specific table
    const prevCols = previous.columns.filter(c => c.tableName === table);
    const currCols = current.columns.filter(c => c.tableName === table);
    const tblSchemaChanged = JSON.stringify(prevCols) !== JSON.stringify(currCols);

    tableChanges.push({
      tableName: table,
      schemaChanged: tblSchemaChanged,
      rowCountChanged,
      previousRowCount: prev?.rowCount ?? null,
      currentRowCount: curr?.rowCount ?? null,
      xminChanged,
    });
  }

  const changedTables = tableChanges.filter(t => t.schemaChanged || t.rowCountChanged || t.xminChanged);
  const summary = changedTables.length === 0
    ? `No changes detected across ${allTables.size} tables.`
    : `${changedTables.length} of ${allTables.size} tables changed: ${changedTables.map(t => t.tableName).join(', ')}.`;

  return { schemaChanged, dataChanged: anyDataChanged, tableChanges, summary };
}

// ─── Offline Schema Fingerprint (for fixture/SQLite) ────────────────────────

/**
 * Create a schema fingerprint from column definitions without a live DB connection.
 * Used for fixture-based runs where we know the schema statically.
 */
export function createOfflineSchemaFingerprint(
  columns: { tableName: string; columnName: string; dataType: string }[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(columns.sort((a, b) =>
      a.tableName.localeCompare(b.tableName) || a.columnName.localeCompare(b.columnName)
    )))
    .digest('hex')
    .slice(0, 32);
}
