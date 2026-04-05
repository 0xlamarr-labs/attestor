/**
 * Attestor PostgreSQL Connector — Bounded Read-Only Query Execution
 *
 * Safety:
 * - Read-only: SET TRANSACTION READ ONLY enforced per-query
 * - Timeout: statement_timeout set per-query (default 10s)
 * - Row limit: enforced via LIMIT injection if not present
 * - Write/stacked-query rejection pre-execution
 * - Schema allowlist enforcement on SQL references
 *
 * Evidence:
 * - schemaHash: SHA-256 of pg_catalog server version + current_schemas()
 *   (bounded proof of WHICH database state was queried, not full snapshot)
 * - executionTimestamp: ISO timestamp of execution (for replay correlation)
 *
 * pg is loaded via dynamic import — not a build-time dependency.
 * Install: npm install pg
 * Env: ATTESTOR_PG_URL=postgres://user:pass@host:port/db
 */

import { createHash } from 'node:crypto';

/** PostgreSQL connection configuration. */
export interface PostgresConfig {
  /** Connection URL (postgres://user:pass@host:port/db) */
  connectionUrl: string;
  /** Statement timeout in milliseconds (default: 10000) */
  statementTimeoutMs?: number;
  /** Maximum rows to return (default: 10000) */
  maxRows?: number;
  /** Allowed schemas — if set, SQL must only reference tables in these schemas */
  allowedSchemas?: string[];
}

/** Execution result compatible with FinancialRunReport. */
export interface PostgresExecutionResult {
  success: boolean;
  durationMs: number;
  rowCount: number;
  columns: string[];
  columnTypes: string[];
  rows: Record<string, unknown>[];
  error: string | null;
  /** Bounded schema evidence: hash of server version + current schemas. */
  schemaHash: string | null;
  /** ISO timestamp of execution. */
  executionTimestamp: string;
}

// ─── SQL Safety ──────────────────────────────────────────────────────────────

const WRITE_PATTERNS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|CALL)\b/i;
const STACKED_QUERY_PATTERN = /;\s*\S/;
const TABLE_REF_PATTERN = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:"?(\w+)"?\.)?"?(\w+)"?/gi;

export function validateReadOnlySql(sql: string): void {
  const stripped = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  if (WRITE_PATTERNS.test(stripped)) throw new Error('Write operation detected. Only SELECT/WITH allowed.');
  if (STACKED_QUERY_PATTERN.test(stripped)) throw new Error('Stacked queries detected. Single SELECT only.');
  if (!/^\s*(SELECT|WITH)\b/i.test(stripped)) throw new Error(`Query must start with SELECT or WITH.`);
}

export function enforceAllowedSchemas(sql: string, allowedSchemas: string[]): void {
  if (allowedSchemas.length === 0) return;
  const allowed = new Set(allowedSchemas.map((s) => s.toLowerCase()));
  const refs: Array<{ schema: string | null; table: string }> = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(TABLE_REF_PATTERN.source, TABLE_REF_PATTERN.flags);
  while ((match = pattern.exec(sql)) !== null) {
    refs.push({ schema: match[1]?.toLowerCase() ?? null, table: match[2].toLowerCase() });
  }
  for (const ref of refs) {
    if (ref.schema && !allowed.has(ref.schema)) {
      throw new Error(`Schema "${ref.schema}" is not in allowedSchemas [${allowedSchemas.join(', ')}].`);
    }
  }
}

function injectLimit(sql: string, maxRows: number): string {
  if (/\bLIMIT\b/i.test(sql)) return sql;
  return `${sql.replace(/;\s*$/, '')} LIMIT ${maxRows}`;
}

// ─── Execution ───────────────────────────────────────────────────────────────

export async function executePostgresQuery(
  sql: string,
  config: PostgresConfig,
): Promise<PostgresExecutionResult> {
  const start = Date.now();
  const executionTimestamp = new Date().toISOString();

  // Pre-execution safety
  try {
    validateReadOnlySql(sql);
    if (config.allowedSchemas?.length) enforceAllowedSchemas(sql, config.allowedSchemas);
  } catch (err) {
    return { success: false, durationMs: Date.now() - start, rowCount: 0, columns: [], columnTypes: [], rows: [], error: err instanceof Error ? err.message : String(err), schemaHash: null, executionTimestamp };
  }

  const timeoutMs = config.statementTimeoutMs ?? 10000;
  const maxRows = config.maxRows ?? 10000;
  const boundedSql = injectLimit(sql, maxRows);

  // Dynamic import — pg is optional (not a build-time dependency)
  let Client: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = await (Function('return import("pg")')() as Promise<any>);
    Client = pg.default?.Client ?? pg.Client;
  } catch {
    return { success: false, durationMs: Date.now() - start, rowCount: 0, columns: [], columnTypes: [], rows: [], error: 'PostgreSQL driver not installed. Run: npm install pg', schemaHash: null, executionTimestamp };
  }

  const client = new Client({ connectionString: config.connectionUrl });
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${timeoutMs}'`);

    // Capture bounded schema evidence BEFORE the user query
    const versionResult = await client.query('SELECT version(), current_schemas(false)::text AS schemas');
    const serverVersion = versionResult.rows[0]?.version ?? 'unknown';
    const currentSchemas = versionResult.rows[0]?.schemas ?? 'unknown';
    const schemaHash = createHash('sha256').update(`${serverVersion}|${currentSchemas}|${config.connectionUrl.replace(/:[^@]*@/, ':***@')}`).digest('hex').slice(0, 16);

    const result = await client.query(boundedSql);
    await client.query('ROLLBACK');

    const columns: string[] = result.fields.map((f: any) => f.name);
    const columnTypes: string[] = result.fields.map((f: any) => `oid:${f.dataTypeID}`);
    // Rows as Record<string,unknown>[] (pg returns this natively)
    const rows: Record<string, unknown>[] = result.rows;

    return { success: true, durationMs: Date.now() - start, rowCount: result.rowCount ?? rows.length, columns, columnTypes, rows, error: null, schemaHash, executionTimestamp };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    return { success: false, durationMs: Date.now() - start, rowCount: 0, columns: [], columnTypes: [], rows: [], error: err instanceof Error ? err.message : String(err), schemaHash: null, executionTimestamp };
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

// ─── Configuration ───────────────────────────────────────────────────────────

export function isPostgresConfigured(): boolean {
  return !!process.env.ATTESTOR_PG_URL;
}

export function loadPostgresConfig(): PostgresConfig | null {
  const url = process.env.ATTESTOR_PG_URL;
  if (!url) return null;
  const schemas = process.env.ATTESTOR_PG_ALLOWED_SCHEMAS?.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    connectionUrl: url,
    statementTimeoutMs: parseInt(process.env.ATTESTOR_PG_TIMEOUT_MS ?? '10000', 10),
    maxRows: parseInt(process.env.ATTESTOR_PG_MAX_ROWS ?? '10000', 10),
    allowedSchemas: schemas?.length ? schemas : undefined,
  };
}
