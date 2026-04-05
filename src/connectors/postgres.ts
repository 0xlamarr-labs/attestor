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
 * - executionContextHash: SHA-256 of pg_catalog server version + current_schemas()
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
  /**
   * Bounded execution context hash.
   *
   * What this IS: SHA-256 of (pg server version + current_schemas + sanitized connection URL).
   * It proves WHICH database environment the query ran against at a bounded level.
   *
   * What this is NOT: a full schema snapshot, a table-level hash, or a data-state proof.
   * It cannot prove the database content was unchanged between executions.
   * Full schema/data attestation would require pg_dump or logical replication snapshot.
   */
  executionContextHash: string | null;
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

/**
 * Enforce schema allowlist on SQL table references.
 *
 * When allowedSchemas is configured:
 * - Fully qualified references (schema.table) must use an allowed schema
 * - Unqualified references (bare table name) are REJECTED because they can
 *   resolve through PostgreSQL search_path to any schema, bypassing the allowlist
 *
 * This is a safety-first design: require explicit schema qualification
 * when an allowlist is active, even if it is less convenient.
 */
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
    if (ref.schema === null) {
      // Unqualified table reference — cannot verify schema through search_path
      throw new Error(`Unqualified table reference "${ref.table}" is not allowed when schema allowlist is active. Use fully qualified "schema.table" syntax. Allowed schemas: [${allowedSchemas.join(', ')}].`);
    }
    if (!allowed.has(ref.schema)) {
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
    return { success: false, durationMs: Date.now() - start, rowCount: 0, columns: [], columnTypes: [], rows: [], error: err instanceof Error ? err.message : String(err), executionContextHash: null, executionTimestamp };
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
    return { success: false, durationMs: Date.now() - start, rowCount: 0, columns: [], columnTypes: [], rows: [], error: 'PostgreSQL driver not installed. Run: npm install pg', executionContextHash: null, executionTimestamp };
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
    const executionContextHash = createHash('sha256').update(`${serverVersion}|${currentSchemas}|${config.connectionUrl.replace(/:[^@]*@/, ':***@')}`).digest('hex').slice(0, 16);

    const result = await client.query(boundedSql);
    await client.query('ROLLBACK');

    const columns: string[] = result.fields.map((f: any) => f.name);
    const columnTypes: string[] = result.fields.map((f: any) => `oid:${f.dataTypeID}`);
    // Rows as Record<string,unknown>[] (pg returns this natively)
    const rows: Record<string, unknown>[] = result.rows;

    return { success: true, durationMs: Date.now() - start, rowCount: result.rowCount ?? rows.length, columns, columnTypes, rows, error: null, executionContextHash, executionTimestamp };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    return { success: false, durationMs: Date.now() - start, rowCount: 0, columns: [], columnTypes: [], rows: [], error: err instanceof Error ? err.message : String(err), executionContextHash: null, executionTimestamp };
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

// ─── Configuration ───────────────────────────────────────────────────────────

export function isPostgresConfigured(): boolean {
  return !!process.env.ATTESTOR_PG_URL;
}

/**
 * Check if the pg driver is installed (runtime, not build-time).
 */
export async function isPostgresDriverAvailable(): Promise<boolean> {
  try {
    await (Function('return import("pg")')() as Promise<any>);
    return true;
  } catch {
    return false;
  }
}

/**
 * Report PostgreSQL readiness status for CLI/diagnostics.
 */
export async function reportPostgresReadiness(): Promise<{ configured: boolean; driverInstalled: boolean; runnable: boolean; message: string }> {
  const configured = isPostgresConfigured();
  const driverInstalled = await isPostgresDriverAvailable();
  const runnable = configured && driverInstalled;
  const message = !configured ? 'ATTESTOR_PG_URL not set. PostgreSQL proof path inactive.'
    : !driverInstalled ? 'ATTESTOR_PG_URL set but pg driver not installed. Run: npm install pg'
      : 'PostgreSQL proof path ready.';
  return { configured, driverInstalled, runnable, message };
}

// ─── Proof Readiness Probe ──────────────────────────────────────────────────

/**
 * Bounded connectivity and capability probe for Postgres proof readiness.
 *
 * What this checks (all read-only, safe):
 * 1. pg driver availability
 * 2. Connection can open
 * 3. SELECT version() succeeds
 * 4. current_schemas() observable
 * 5. Read-only transaction works
 *
 * What this does NOT do:
 * - Inspect user tables or data
 * - Run EXPLAIN
 * - Execute any user SQL
 * - Modify anything
 */
export interface PostgresProbeResult {
  /** Whether the probe was attempted at all. */
  attempted: boolean;
  /** Whether all probe steps passed. */
  success: boolean;
  /** Step-by-step results. */
  steps: PostgresProbeStep[];
  /** Database server version (when available). */
  serverVersion: string | null;
  /** Current schemas (when available). */
  currentSchemas: string | null;
  /** Sanitized connection URL. */
  sanitizedUrl: string | null;
  /** Overall message for operator. */
  message: string;
}

export interface PostgresProbeStep {
  step: string;
  passed: boolean;
  detail: string;
  /** Operator-facing remediation hint when this step fails. Null when passed. */
  remediation: string | null;
}

export async function runPostgresProbe(): Promise<PostgresProbeResult> {
  const steps: PostgresProbeStep[] = [];
  let serverVersion: string | null = null;
  let currentSchemas: string | null = null;
  let sanitizedUrl: string | null = null;

  // Step 1: Config
  const config = loadPostgresConfig();
  if (!config) {
    steps.push({ step: 'config', passed: false, detail: 'ATTESTOR_PG_URL not set', remediation: 'Set ATTESTOR_PG_URL to a PostgreSQL connection URL (e.g., postgres://user:pass@host:5432/db)' });
    return { attempted: false, success: false, steps, serverVersion: null, currentSchemas: null, sanitizedUrl: null, message: 'ATTESTOR_PG_URL not set. Cannot probe.' };
  }
  sanitizedUrl = config.connectionUrl.replace(/:[^@]*@/, ':***@');
  steps.push({ step: 'config', passed: true, detail: `URL configured: ${sanitizedUrl}`, remediation: null });

  // Step 2: Driver
  const driverOk = await isPostgresDriverAvailable();
  if (!driverOk) {
    steps.push({ step: 'driver', passed: false, detail: 'pg driver not installed', remediation: 'Run: npm install pg' });
    return { attempted: true, success: false, steps, serverVersion, currentSchemas, sanitizedUrl, message: 'pg driver not installed.' };
  }
  steps.push({ step: 'driver', passed: true, detail: 'pg driver available', remediation: null });

  // Step 3: Load driver
  let Client: any;
  try {
    const pg = await (Function('return import("pg")')() as Promise<any>);
    Client = pg.default?.Client ?? pg.Client;
  } catch {
    steps.push({ step: 'connect', passed: false, detail: 'Failed to load pg driver module', remediation: 'Reinstall pg: npm install pg' });
    return { attempted: true, success: false, steps, serverVersion, currentSchemas, sanitizedUrl, message: 'Failed to load pg driver.' };
  }

  // Step 4: Connect (separate try/catch for precise step attribution)
  const client = new Client({ connectionString: config.connectionUrl });
  try {
    await client.connect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'connect', passed: false, detail: msg, remediation: 'Check: host reachable, port open, credentials correct, database exists. Verify ATTESTOR_PG_URL.' });
    return { attempted: true, success: false, steps, serverVersion, currentSchemas, sanitizedUrl, message: `Connection failed: ${msg}` };
  }
  steps.push({ step: 'connect', passed: true, detail: 'Connection established', remediation: null });

  // Step 5: Version (separate try/catch)
  try {
    const vResult = await client.query('SELECT version()');
    serverVersion = vResult.rows[0]?.version ?? null;
    if (!serverVersion) throw new Error('version() returned null');
    steps.push({ step: 'version', passed: true, detail: `Server: ${serverVersion.split(',')[0]}`, remediation: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'version', passed: false, detail: msg, remediation: 'Check: user has permission to run SELECT version(). Database may require specific privileges.' });
    try { await client.end(); } catch { /* ignore */ }
    return { attempted: true, success: false, steps, serverVersion, currentSchemas, sanitizedUrl, message: `Version check failed: ${msg}` };
  }

  // Step 6: Schemas (separate try/catch)
  try {
    const sResult = await client.query('SELECT current_schemas(false)::text AS schemas');
    currentSchemas = sResult.rows[0]?.schemas ?? null;
    if (!currentSchemas) throw new Error('current_schemas() returned null');
    steps.push({ step: 'schemas', passed: true, detail: `Schemas: ${currentSchemas}`, remediation: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'schemas', passed: false, detail: msg, remediation: 'Check: schema search path is configured. User may lack schema-level permissions.' });
    try { await client.end(); } catch { /* ignore */ }
    return { attempted: true, success: false, steps, serverVersion, currentSchemas, sanitizedUrl, message: `Schema check failed: ${msg}` };
  }

  // Step 7: Read-only transaction (separate try/catch)
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query('ROLLBACK');
    steps.push({ step: 'readonly_txn', passed: true, detail: 'Read-only transaction works', remediation: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'readonly_txn', passed: false, detail: msg, remediation: 'Check: user has permission to begin read-only transactions. Database may restrict transaction modes.' });
    try { await client.end(); } catch { /* ignore */ }
    return { attempted: true, success: false, steps, serverVersion, currentSchemas, sanitizedUrl, message: `Read-only transaction check failed: ${msg}` };
  }

  try { await client.end(); } catch { /* ignore */ }

  const allPassed = steps.every(s => s.passed);
  return {
    attempted: true,
    success: allPassed,
    steps,
    serverVersion,
    currentSchemas,
    sanitizedUrl,
    message: allPassed ? 'PostgreSQL proof path fully verified. Ready for real DB proof.' : 'Some probe steps failed.',
  };
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
