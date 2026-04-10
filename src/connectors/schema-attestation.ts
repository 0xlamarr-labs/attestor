/**
 * Schema and Data-State Attestation
 *
 * Captures bounded, verifier-facing evidence of database structure and data state
 * at the time of a governed query execution.
 *
 * What this now proves:
 * 1. Which columns existed, in what order, with what defaults/nullability
 * 2. Which constraints and indexes were present on the attested tables
 * 3. Per-table row-count/xmin sentinels
 * 4. Bounded per-table content fingerprints over deterministic row samples
 * 5. Historical attestation deltas across repeated captures outside the target DB
 *
 * HONEST BOUNDARIES:
 * - Content hashing is bounded by ATTTESTOR_SCHEMA_CONTENT_HASH_MAX_ROWS and will
 *   surface `mode=truncated` if the table is larger than the sampled window
 * - Historical comparison persists locally; it does not write to the target DB
 * - This is attestation evidence, not a full CDC/audit trail
 */

import { createHash } from 'node:crypto';

export interface SchemaColumn {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
  ordinalPosition: number;
}

export interface SchemaConstraint {
  tableName: string;
  constraintName: string;
  constraintType: string;
  columnNames: string[];
  referencedTableName: string | null;
  referencedColumnNames: string[];
  checkClause: string | null;
}

export interface SchemaIndex {
  tableName: string;
  indexName: string;
  indexDefinition: string;
}

export interface TableSentinel {
  tableName: string;
  rowCount: number;
  maxXmin: string | null;
}

export interface TableContentFingerprint {
  tableName: string;
  rowCount: number;
  sampledRowCount: number;
  rowLimit: number;
  mode: 'full' | 'truncated' | 'unavailable';
  orderBy: string[];
  contentHash: string | null;
}

export interface HistoricalSchemaComparison {
  historyKey: string;
  previousCapturedAt: string;
  previousAttestationHash: string;
  currentAttestationHash: string;
  schemaChanged: boolean;
  dataChanged: boolean;
  contentChanged: boolean;
  summary: string;
}

export interface SchemaAttestation {
  version: '1.0';
  type: 'attestor.schema_attestation.v1';
  capturedAt: string;
  executionContextHash: string | null;
  txidSnapshot: string | null;
  schemaName: string;
  tables: string[];
  columns: SchemaColumn[];
  constraints: SchemaConstraint[];
  indexes: SchemaIndex[];
  sentinels: TableSentinel[];
  tableContentFingerprints: TableContentFingerprint[];
  columnFingerprint: string;
  constraintFingerprint: string;
  indexFingerprint: string;
  schemaFingerprint: string;
  sentinelFingerprint: string;
  contentFingerprint: string;
  attestationHash: string;
  historyKey: string | null;
  historicalComparison: HistoricalSchemaComparison | null;
}

export interface TableChange {
  tableName: string;
  schemaChanged: boolean;
  rowCountChanged: boolean;
  previousRowCount: number | null;
  currentRowCount: number | null;
  xminChanged: boolean;
  contentChanged: boolean;
  previousContentHash: string | null;
  currentContentHash: string | null;
}

export interface SchemaComparisonResult {
  schemaChanged: boolean;
  dataChanged: boolean;
  contentChanged: boolean;
  tableChanges: TableChange[];
  summary: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

function contentHashRowLimit(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_SCHEMA_CONTENT_HASH_MAX_ROWS ?? '1000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier '${identifier}' for schema attestation.`);
  }
  return `"${identifier}"`;
}

function canonicalizeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Buffer.isBuffer(value)) return JSON.stringify(`base64:${value.toString('base64')}`);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalizeValue(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeValue(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalizeRow(row: Record<string, unknown>, orderedColumns: string[]): string {
  const parts = orderedColumns.map((column) => `${JSON.stringify(column)}:${canonicalizeValue(row[column])}`);
  return `{${parts.join(',')}}`;
}

function groupConstraints(rows: any[]): SchemaConstraint[] {
  const grouped = new Map<string, SchemaConstraint>();
  for (const row of rows) {
    const key = `${row.table_name}::${row.constraint_name}`;
    const existing: SchemaConstraint = grouped.get(key) ?? {
      tableName: row.table_name,
      constraintName: row.constraint_name,
      constraintType: row.constraint_type,
      columnNames: [],
      referencedTableName: row.referenced_table_name ?? null,
      referencedColumnNames: [],
      checkClause: row.check_clause ?? null,
    };
    if (typeof row.column_name === 'string' && !existing.columnNames.includes(row.column_name)) {
      existing.columnNames.push(row.column_name);
    }
    if (typeof row.referenced_column_name === 'string' && !existing.referencedColumnNames.includes(row.referenced_column_name)) {
      existing.referencedColumnNames.push(row.referenced_column_name);
    }
    grouped.set(key, existing);
  }
  return [...grouped.values()].sort((left, right) =>
    left.tableName.localeCompare(right.tableName)
    || left.constraintType.localeCompare(right.constraintType)
    || left.constraintName.localeCompare(right.constraintName));
}

function primaryKeyColumnsForTable(constraints: SchemaConstraint[], tableName: string): string[] {
  return constraints
    .filter((constraint) => constraint.tableName === tableName && constraint.constraintType === 'PRIMARY KEY')
    .flatMap((constraint) => constraint.columnNames);
}

async function captureTableContentFingerprint(options: {
  client: any;
  schemaName: string;
  tableName: string;
  columns: SchemaColumn[];
  rowCount: number;
  primaryKeyColumns: string[];
}): Promise<TableContentFingerprint> {
  const rowLimit = contentHashRowLimit();
  const orderedColumns = options.columns
    .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
    .map((column) => column.columnName);
  const orderBy = options.primaryKeyColumns.length > 0 ? [...options.primaryKeyColumns] : ['ctid'];
  try {
    const projection = orderedColumns.map((column) => quoteIdent(column));
    if (options.primaryKeyColumns.length === 0) {
      projection.push('ctid::text AS "__attestor_ctid"');
      orderedColumns.push('__attestor_ctid');
    }
    const orderSql = options.primaryKeyColumns.length > 0
      ? options.primaryKeyColumns.map((column) => quoteIdent(column)).join(', ')
      : 'ctid';
    const rowsResult = await options.client.query(
      `SELECT ${projection.join(', ')}
         FROM ${quoteIdent(options.schemaName)}.${quoteIdent(options.tableName)}
        ORDER BY ${orderSql}
        LIMIT $1`,
      [rowLimit],
    );
    const rowStrings = rowsResult.rows.map((row: Record<string, unknown>) => canonicalizeRow(row, orderedColumns));
    return {
      tableName: options.tableName,
      rowCount: options.rowCount,
      sampledRowCount: rowsResult.rows.length,
      rowLimit,
      mode: options.rowCount > rowLimit ? 'truncated' : 'full',
      orderBy,
      contentHash: sha256(rowStrings.join('\n')),
    };
  } catch {
    return {
      tableName: options.tableName,
      rowCount: options.rowCount,
      sampledRowCount: 0,
      rowLimit,
      mode: 'unavailable',
      orderBy,
      contentHash: null,
    };
  }
}

export async function captureSchemaAttestation(
  client: any,
  schemaName: string,
  tables: string[],
  executionContextHash: string | null,
): Promise<SchemaAttestation> {
  const capturedAt = new Date().toISOString();

  const txidSnapshotResult = await client.query('SELECT txid_current_snapshot()::text AS snapshot');
  const txidSnapshot = txidSnapshotResult.rows[0]?.snapshot ?? null;

  const colResult = await client.query(
    `
      SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = ANY($2)
      ORDER BY table_name, ordinal_position
    `,
    [schemaName, tables],
  );

  const columns: SchemaColumn[] = colResult.rows.map((row: any) => ({
    tableName: row.table_name,
    columnName: row.column_name,
    dataType: row.data_type,
    isNullable: row.is_nullable,
    columnDefault: row.column_default,
    ordinalPosition: Number(row.ordinal_position),
  }));

  const constraintResult = await client.query(
    `
      SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS referenced_table_name,
        ccu.column_name AS referenced_column_name,
        cc.check_clause
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_schema = kcu.constraint_schema
       AND tc.constraint_name = kcu.constraint_name
       AND tc.table_name = kcu.table_name
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_schema = ccu.constraint_schema
       AND tc.constraint_name = ccu.constraint_name
      LEFT JOIN information_schema.check_constraints cc
        ON tc.constraint_schema = cc.constraint_schema
       AND tc.constraint_name = cc.constraint_name
      WHERE tc.table_schema = $1
        AND tc.table_name = ANY($2)
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position NULLS LAST, ccu.column_name NULLS LAST
    `,
    [schemaName, tables],
  );
  const constraints = groupConstraints(constraintResult.rows);

  const indexResult = await client.query(
    `
      SELECT tablename AS table_name, indexname AS index_name, indexdef AS index_definition
      FROM pg_indexes
      WHERE schemaname = $1
        AND tablename = ANY($2)
      ORDER BY tablename, indexname
    `,
    [schemaName, tables],
  );
  const indexes: SchemaIndex[] = indexResult.rows.map((row: any) => ({
    tableName: row.table_name,
    indexName: row.index_name,
    indexDefinition: row.index_definition,
  }));

  const sentinels: TableSentinel[] = [];
  const tableContentFingerprints: TableContentFingerprint[] = [];
  for (const tableName of tables) {
    let sentinel: TableSentinel = { tableName, rowCount: 0, maxXmin: null };
    try {
      const sentinelResult = await client.query(
        `SELECT COUNT(*)::int AS row_count, MAX(xmin::text::bigint)::text AS max_xmin
           FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)}`,
      );
      sentinel = {
        tableName,
        rowCount: sentinelResult.rows[0]?.row_count ?? 0,
        maxXmin: sentinelResult.rows[0]?.max_xmin ?? null,
      };
    } catch {
      sentinel = { tableName, rowCount: 0, maxXmin: null };
    }
    sentinels.push(sentinel);
    tableContentFingerprints.push(await captureTableContentFingerprint({
      client,
      schemaName,
      tableName,
      columns: columns.filter((column) => column.tableName === tableName),
      rowCount: sentinel.rowCount,
      primaryKeyColumns: primaryKeyColumnsForTable(constraints, tableName),
    }));
  }

  const columnFingerprint = sha256(JSON.stringify(columns));
  const constraintFingerprint = sha256(JSON.stringify(constraints));
  const indexFingerprint = sha256(JSON.stringify(indexes));
  const schemaFingerprint = sha256(`${columnFingerprint}|${constraintFingerprint}|${indexFingerprint}`);
  const sentinelFingerprint = sha256(JSON.stringify(sentinels));
  const contentFingerprint = sha256(JSON.stringify(tableContentFingerprints));
  const attestationHash = sha256(
    `${schemaFingerprint}|${sentinelFingerprint}|${contentFingerprint}|${txidSnapshot ?? ''}|${capturedAt}`,
  );

  return {
    version: '1.0',
    type: 'attestor.schema_attestation.v1',
    capturedAt,
    executionContextHash,
    txidSnapshot,
    schemaName,
    tables,
    columns,
    constraints,
    indexes,
    sentinels,
    tableContentFingerprints,
    columnFingerprint,
    constraintFingerprint,
    indexFingerprint,
    schemaFingerprint,
    sentinelFingerprint,
    contentFingerprint,
    attestationHash,
    historyKey: null,
    historicalComparison: null,
  };
}

export function compareSchemaAttestations(
  previous: SchemaAttestation,
  current: SchemaAttestation,
): SchemaComparisonResult {
  const schemaChanged = previous.schemaFingerprint !== current.schemaFingerprint;
  const contentChanged = previous.contentFingerprint !== current.contentFingerprint;

  const prevSentinelMap = new Map(previous.sentinels.map((sentinel) => [sentinel.tableName, sentinel]));
  const currSentinelMap = new Map(current.sentinels.map((sentinel) => [sentinel.tableName, sentinel]));
  const prevContentMap = new Map(previous.tableContentFingerprints.map((fingerprint) => [fingerprint.tableName, fingerprint]));
  const currContentMap = new Map(current.tableContentFingerprints.map((fingerprint) => [fingerprint.tableName, fingerprint]));

  const allTables = new Set([...previous.tables, ...current.tables]);
  const tableChanges: TableChange[] = [];
  let anyDataChanged = false;

  for (const tableName of allTables) {
    const previousColumns = previous.columns.filter((column) => column.tableName === tableName);
    const currentColumns = current.columns.filter((column) => column.tableName === tableName);
    const previousConstraints = previous.constraints.filter((constraint) => constraint.tableName === tableName);
    const currentConstraints = current.constraints.filter((constraint) => constraint.tableName === tableName);
    const previousIndexes = previous.indexes.filter((index) => index.tableName === tableName);
    const currentIndexes = current.indexes.filter((index) => index.tableName === tableName);
    const prevSentinel = prevSentinelMap.get(tableName);
    const currSentinel = currSentinelMap.get(tableName);
    const prevContent = prevContentMap.get(tableName);
    const currContent = currContentMap.get(tableName);

    const tableSchemaChanged =
      JSON.stringify(previousColumns) !== JSON.stringify(currentColumns)
      || JSON.stringify(previousConstraints) !== JSON.stringify(currentConstraints)
      || JSON.stringify(previousIndexes) !== JSON.stringify(currentIndexes);
    const rowCountChanged = (prevSentinel?.rowCount ?? -1) !== (currSentinel?.rowCount ?? -1);
    const xminChanged = (prevSentinel?.maxXmin ?? '') !== (currSentinel?.maxXmin ?? '');
    const tableContentChanged = (prevContent?.contentHash ?? '') !== (currContent?.contentHash ?? '')
      || (prevContent?.mode ?? '') !== (currContent?.mode ?? '');

    if (rowCountChanged || xminChanged || tableContentChanged) {
      anyDataChanged = true;
    }

    tableChanges.push({
      tableName,
      schemaChanged: tableSchemaChanged,
      rowCountChanged,
      previousRowCount: prevSentinel?.rowCount ?? null,
      currentRowCount: currSentinel?.rowCount ?? null,
      xminChanged,
      contentChanged: tableContentChanged,
      previousContentHash: prevContent?.contentHash ?? null,
      currentContentHash: currContent?.contentHash ?? null,
    });
  }

  const changedTables = tableChanges.filter((table) =>
    table.schemaChanged || table.rowCountChanged || table.xminChanged || table.contentChanged);
  const summary = changedTables.length === 0
    ? `No schema/data changes detected across ${allTables.size} attested tables.`
    : `${changedTables.length} of ${allTables.size} attested tables changed: ${changedTables.map((table) => table.tableName).join(', ')}.`;

  return {
    schemaChanged,
    dataChanged: anyDataChanged,
    contentChanged,
    tableChanges,
    summary,
  };
}

export function createOfflineSchemaFingerprint(
  columns: { tableName: string; columnName: string; dataType: string }[],
): string {
  return sha256(JSON.stringify(columns.sort((left, right) =>
    left.tableName.localeCompare(right.tableName) || left.columnName.localeCompare(right.columnName))));
}
