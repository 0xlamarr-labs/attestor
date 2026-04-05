/**
 * Financial Execution Harness - fixture and bounded live SQLite execution.
 *
 * Offline reference runs execute through deterministic fixture mappings.
 * Bounded live runs can execute read-only SQL against local SQLite snapshot files
 * materialized from synthetic data. This keeps the proof slice local,
 * replayable, and truthful without requiring an external warehouse.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ExecutionEvidence } from './types.js';

// ---------------- Fixture Database ----------------

export interface FixtureTable {
  name: string;
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
}

export interface FixtureDatabase {
  schema: string;
  tables: FixtureTable[];
}

export interface FixtureQueryMapping {
  /** SQL hash that this fixture responds to. */
  sqlHash: string;
  /** Description for test readability. */
  description: string;
  /** Simulated execution result. */
  result: {
    success: boolean;
    columns: string[];
    columnTypes: string[];
    rows: Record<string, unknown>[];
    error?: string;
  };
}

export interface SqliteSchemaBinding {
  schema: string;
  filePath: string;
}

export interface SqliteLiveExecutionConfig {
  provider?: string;
  bindings: SqliteSchemaBinding[];
}

export interface MaterializedSqliteSnapshot {
  bindings: SqliteSchemaBinding[];
  snapshotHash: string;
  sourceCount: number;
}

// ---------------- Shared Helpers ----------------

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/;+\s*$/u, '');
}

function isSafeSingleSelect(sql: string): boolean {
  const normalized = normalizeSql(sql);
  if (!/^\s*select\b/iu.test(normalized)) return false;
  return normalized.indexOf(';') === -1;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/gu, '""')}"`;
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/gu, "''");
}

function toSqliteColumnType(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized === 'number' || normalized === 'integer' || normalized === 'int') return 'REAL';
  if (normalized === 'boolean' || normalized === 'bool') return 'INTEGER';
  return 'TEXT';
}

function normalizeSqliteValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function mapSqliteType(type: string | undefined, sample: unknown): string {
  const normalized = (type ?? '').trim().toLowerCase();
  if (normalized.includes('int')) return 'number';
  if (normalized.includes('real') || normalized.includes('double') || normalized.includes('numeric') || normalized.includes('decimal') || normalized.includes('float')) return 'number';
  if (normalized.includes('bool')) return 'boolean';
  if (normalized.includes('date') || normalized.includes('time')) return 'date';
  if (normalized.includes('text') || normalized.includes('char') || normalized.includes('clob')) return 'string';
  if (sample === null) return 'null';
  if (typeof sample === 'number') return 'number';
  if (typeof sample === 'boolean') return 'boolean';
  return 'string';
}

// ---------------- Fixture Execution ----------------

/**
 * Execute SQL against a fixture database.
 *
 * This is a deterministic fixture-mapping execution:
 * the SQL hash is looked up in the fixture mappings.
 * If no mapping exists, execution "fails" with an unknown-query error.
 */
export function executeFixtureQuery(
  sql: string,
  fixtures: FixtureQueryMapping[],
): ExecutionEvidence {
  const start = Date.now();
  const sqlHash = hashText(sql);

  const mapping = fixtures.find((fixture) => fixture.sqlHash === sqlHash);

  if (!mapping) {
    return {
      success: false,
      durationMs: Date.now() - start,
      rowCount: 0,
      columns: [],
      columnTypes: [],
      rows: [],
      error: `No fixture mapping for SQL hash ${sqlHash}. Query not recognized.`,
      schemaHash: hashText('empty'),
    };
  }

  const result = mapping.result;
  const schemaHash = hashText(JSON.stringify({ columns: result.columns, types: result.columnTypes }));

  return {
    success: result.success,
    durationMs: Date.now() - start,
    rowCount: result.success ? result.rows.length : 0,
    columns: result.columns,
    columnTypes: result.columnTypes,
    rows: result.success ? result.rows : [],
    error: result.error ?? null,
    schemaHash,
  };
}

/**
 * Compute the SQL hash for a given query string (for fixture mapping creation).
 */
export function computeSqlHash(sql: string): string {
  return hashText(sql);
}

// ---------------- Local SQLite Live Execution ----------------

export function computeSqliteSnapshot(bindings: SqliteSchemaBinding[]): { snapshotHash: string; sourceCount: number } {
  const parts = bindings
    .map((binding) => {
      const bytes = readFileSync(binding.filePath);
      return {
        schema: binding.schema,
        fileHash: createHash('sha256').update(bytes).digest('hex'),
      };
    })
    .sort((a, b) => a.schema.localeCompare(b.schema));

  return {
    snapshotHash: hashText(JSON.stringify(parts)),
    sourceCount: parts.length,
  };
}

export function materializeSqliteFixtureDatabases(
  baseDir: string,
  databases: FixtureDatabase[],
): MaterializedSqliteSnapshot {
  mkdirSync(baseDir, { recursive: true });

  const bindings: SqliteSchemaBinding[] = [];

  for (const database of databases) {
    const filePath = join(baseDir, `${database.schema}.db`);
    rmSync(filePath, { force: true });

    const db = new DatabaseSync(filePath);
    try {
      db.exec('PRAGMA journal_mode = DELETE;');

      for (const table of database.tables) {
        const quotedTable = quoteIdentifier(table.name);
        db.exec(`DROP TABLE IF EXISTS ${quotedTable}`);

        const columnDefinitions = table.columns
          .map((column) => `${quoteIdentifier(column.name)} ${toSqliteColumnType(column.type)}`)
          .join(', ');
        db.exec(`CREATE TABLE ${quotedTable} (${columnDefinitions})`);

        if (table.rows.length > 0) {
          const columnNames = table.columns.map((column) => quoteIdentifier(column.name)).join(', ');
          const placeholders = table.columns.map(() => '?').join(', ');
          const insert = db.prepare(`INSERT INTO ${quotedTable} (${columnNames}) VALUES (${placeholders})`);

          for (const row of table.rows) {
            insert.run(...table.columns.map((column) => normalizeSqliteValue(row[column.name]) as any));
          }
        }
      }

      db.exec('VACUUM');
    } finally {
      db.close();
    }

    bindings.push({ schema: database.schema, filePath });
  }

  const snapshot = computeSqliteSnapshot(bindings);
  return {
    bindings,
    snapshotHash: snapshot.snapshotHash,
    sourceCount: snapshot.sourceCount,
  };
}

export function executeSqliteQuery(
  sql: string,
  config: SqliteLiveExecutionConfig,
): ExecutionEvidence {
  const start = Date.now();
  const normalizedSql = normalizeSql(sql);

  if (!isSafeSingleSelect(normalizedSql)) {
    return {
      success: false,
      durationMs: Date.now() - start,
      rowCount: 0,
      columns: [],
      columnTypes: [],
      rows: [],
      error: 'Live SQLite execution only permits a single read-only SELECT statement.',
      schemaHash: hashText('invalid-live-sql'),
    };
  }

  const snapshot = computeSqliteSnapshot(config.bindings);
  const db = new DatabaseSync(':memory:');

  try {
    db.exec('PRAGMA query_only = ON;');
    for (const binding of config.bindings) {
      db.exec(`ATTACH DATABASE '${escapeSqlLiteral(binding.filePath)}' AS ${quoteIdentifier(binding.schema)}`);
    }

    const statement = db.prepare(normalizedSql);
    const columnInfo = statement.columns();
    const rows = statement.all() as Record<string, unknown>[];
    const columns = columnInfo.map((column) => column.name);
    const columnTypes = columnInfo.map((column, index) => mapSqliteType(column.type ?? undefined, rows[0]?.[columns[index]]));

    return {
      success: true,
      durationMs: Date.now() - start,
      rowCount: rows.length,
      columns,
      columnTypes,
      rows,
      error: null,
      schemaHash: hashText(JSON.stringify({ columns, types: columnTypes })),
    };
  } catch (error) {
    return {
      success: false,
      durationMs: Date.now() - start,
      rowCount: 0,
      columns: [],
      columnTypes: [],
      rows: [],
      error: error instanceof Error ? error.message : String(error),
      schemaHash: snapshot.snapshotHash,
    };
  } finally {
    db.close();
  }
}
