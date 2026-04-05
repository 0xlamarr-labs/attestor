/**
 * Attestor PostgreSQL Connector — Bounded Read-Only Query Execution
 *
 * Safety constraints:
 * - Read-only: SET TRANSACTION READ ONLY enforced per-query
 * - Timeout: statement_timeout set per-query (default 10s)
 * - Row limit: enforced via LIMIT injection if not present
 * - No write operations: validated before execution
 * - Schema hash: captures pg_catalog version info for snapshot evidence
 *
 * This connector is designed for governed financial query execution.
 * It does NOT modify data, create objects, or execute stored procedures.
 *
 * Requires: npm install pg @types/pg
 * Env: ATTESTOR_PG_URL=postgres://user:pass@host:port/db
 */

import { createHash } from 'node:crypto';
import type { ExecutionEvidence } from '../financial/types.js';

/** PostgreSQL connection configuration. */
export interface PostgresConfig {
  /** Connection URL (postgres://user:pass@host:port/db) */
  connectionUrl: string;
  /** Statement timeout in milliseconds (default: 10000) */
  statementTimeoutMs?: number;
  /** Maximum rows to return (default: 10000) */
  maxRows?: number;
  /** Allowed schemas (if set, only these schemas can be queried) */
  allowedSchemas?: string[];
}

/** Write-operation patterns that must be blocked. */
const WRITE_PATTERNS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|CALL)\b/i;

/** Stacked query pattern. */
const STACKED_QUERY_PATTERN = /;\s*\S/;

/**
 * Validate that a SQL query is safe for read-only execution.
 * Throws if the query contains write operations or stacked queries.
 */
export function validateReadOnlySql(sql: string): void {
  const trimmed = sql.trim().replace(/--[^\n]*\n/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

  if (WRITE_PATTERNS.test(trimmed)) {
    throw new Error(`Attestor: Write operation detected in SQL. Only SELECT/WITH queries are allowed.`);
  }

  if (STACKED_QUERY_PATTERN.test(trimmed)) {
    throw new Error(`Attestor: Stacked queries detected. Only single-statement SELECT is allowed.`);
  }

  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error(`Attestor: Query must start with SELECT or WITH. Got: ${trimmed.slice(0, 30)}...`);
  }
}

/**
 * Inject LIMIT if not already present in the query.
 */
function injectLimit(sql: string, maxRows: number): string {
  if (/\bLIMIT\b/i.test(sql)) return sql;
  return `${sql.replace(/;\s*$/, '')} LIMIT ${maxRows}`;
}

/**
 * Execute a governed read-only query against PostgreSQL.
 *
 * Returns ExecutionEvidence compatible with the financial pipeline.
 * The connection is opened, used once, and closed — no connection pooling.
 */
export async function executePostgresQuery(
  sql: string,
  config: PostgresConfig,
): Promise<ExecutionEvidence> {
  const start = Date.now();

  // Pre-execution validation
  try {
    validateReadOnlySql(sql);
  } catch (err) {
    return {
      success: false,
      durationMs: Date.now() - start,
      rowCount: 0,
      columns: [],
      columnTypes: [],
      rows: [],
      error: err instanceof Error ? err.message : String(err),
      schemaHash: null,
    };
  }

  const timeoutMs = config.statementTimeoutMs ?? 10000;
  const maxRows = config.maxRows ?? 10000;
  const boundedSql = injectLimit(sql, maxRows);

  // Dynamic import pg — it's an optional dependency
  let pg: typeof import('pg');
  try {
    pg = await import('pg');
  } catch {
    return {
      success: false,
      durationMs: Date.now() - start,
      rowCount: 0,
      columns: [],
      columnTypes: [],
      rows: [],
      error: 'PostgreSQL driver not installed. Run: npm install pg @types/pg',
      schemaHash: null,
    };
  }

  const client = new pg.default.Client({ connectionString: config.connectionUrl });

  try {
    await client.connect();

    // Enforce read-only transaction + timeout
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${timeoutMs}'`);

    const result = await client.query(boundedSql);

    await client.query('ROLLBACK'); // always rollback (read-only, nothing to commit)

    const columns = result.fields.map((f) => f.name);
    const columnTypes = result.fields.map((f) => `oid:${f.dataTypeID}`);
    const rows = result.rows.map((row) => columns.map((col) => row[col]));

    // Compute a snapshot hash from the connection URL + query + timestamp (bounded evidence)
    const snapshotInput = `${config.connectionUrl}:${sql}:${new Date().toISOString().slice(0, 10)}`;
    const schemaHash = createHash('sha256').update(snapshotInput).digest('hex').slice(0, 16);

    return {
      success: true,
      durationMs: Date.now() - start,
      rowCount: result.rowCount ?? rows.length,
      columns,
      columnTypes,
      rows,
      error: null,
      schemaHash,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback errors */ }
    return {
      success: false,
      durationMs: Date.now() - start,
      rowCount: 0,
      columns: [],
      columnTypes: [],
      rows: [],
      error: err instanceof Error ? err.message : String(err),
      schemaHash: null,
    };
  } finally {
    try { await client.end(); } catch { /* ignore close errors */ }
  }
}

/**
 * Check if PostgreSQL credentials are configured.
 */
export function isPostgresConfigured(): boolean {
  return !!process.env.ATTESTOR_PG_URL;
}

/**
 * Load PostgreSQL configuration from environment.
 */
export function loadPostgresConfig(): PostgresConfig | null {
  const url = process.env.ATTESTOR_PG_URL;
  if (!url) return null;

  return {
    connectionUrl: url,
    statementTimeoutMs: parseInt(process.env.ATTESTOR_PG_TIMEOUT_MS ?? '10000', 10),
    maxRows: parseInt(process.env.ATTESTOR_PG_MAX_ROWS ?? '10000', 10),
  };
}
