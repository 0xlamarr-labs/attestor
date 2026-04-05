/**
 * Attestor PostgreSQL Demo Bootstrap
 *
 * Creates a deterministic demo schema and dataset in a dedicated
 * `attestor_demo` schema so the real DB proof path can be exercised
 * against an actual PostgreSQL instance.
 *
 * IMPORTANT DESIGN BOUNDARIES:
 * - This is a BOOTSTRAP tool, not part of the governed proof path
 * - All writes are confined to the `attestor_demo` schema
 * - The governed proof path remains read-only
 * - This module is idempotent: DROP IF EXISTS + CREATE
 * - The seeded data matches repo fixture semantics so that existing
 *   proof scenarios produce meaningful results on real Postgres
 *
 * The demo schema seeds three tables matching the repo's fixture scenarios:
 * 1. attestor_demo.counterparty_exposures (counterparty scenario — expected: pass)
 * 2. attestor_demo.liquidity_buffer (liquidity scenario — expected: fail)
 * 3. attestor_demo.position_reconciliation (reconciliation scenario — expected: fail)
 */

import { loadPostgresConfig, isPostgresConfigured, isPostgresDriverAvailable, type PostgresConfig } from './postgres.js';

// ─── SQL Definitions ────────────────────────────────────────────────────────

const DEMO_SCHEMA = 'attestor_demo';

const SETUP_SQL = `
-- Attestor Demo Bootstrap — idempotent setup
-- All objects in schema: ${DEMO_SCHEMA}

CREATE SCHEMA IF NOT EXISTS ${DEMO_SCHEMA};

-- Counterparty Exposures (matches COUNTERPARTY_SQL scenario)
DROP TABLE IF EXISTS ${DEMO_SCHEMA}.counterparty_exposures;
CREATE TABLE ${DEMO_SCHEMA}.counterparty_exposures (
  counterparty_name TEXT NOT NULL,
  exposure_usd NUMERIC(18,2) NOT NULL,
  credit_rating TEXT NOT NULL,
  sector TEXT NOT NULL,
  reporting_date DATE NOT NULL
);

INSERT INTO ${DEMO_SCHEMA}.counterparty_exposures (counterparty_name, exposure_usd, credit_rating, sector, reporting_date) VALUES
  ('Bank of Nova Scotia',  250000000, 'AA-',  'Banking',    '2026-03-28'),
  ('Deutsche Bank AG',     200000000, 'A-',   'Banking',    '2026-03-28'),
  ('Toyota Motor Corp',    180000000, 'A+',   'Automotive', '2026-03-28'),
  ('Shell plc',            120000000, 'A',    'Energy',     '2026-03-28'),
  ('Tesco plc',            100000000, 'BBB+', 'Retail',     '2026-03-28'),
  ('Legacy Counterparty',   90000000, 'BBB',  'Industrial', '2026-03-21');

-- Liquidity Buffer (matches LIQUIDITY_SQL scenario — includes negative value)
DROP TABLE IF EXISTS ${DEMO_SCHEMA}.liquidity_buffer;
CREATE TABLE ${DEMO_SCHEMA}.liquidity_buffer (
  asset_class TEXT NOT NULL,
  liquidity_value NUMERIC(18,2) NOT NULL,
  days_to_maturity INTEGER NOT NULL,
  is_encumbered BOOLEAN NOT NULL,
  reporting_date DATE NOT NULL
);

INSERT INTO ${DEMO_SCHEMA}.liquidity_buffer (asset_class, liquidity_value, days_to_maturity, is_encumbered, reporting_date) VALUES
  ('Government Bonds',  500000000, 365, false, '2026-03-28'),
  ('Corporate Bonds',   -50000000, 180, false, '2026-03-28'),
  ('Cash',              200000000,   0, false, '2026-03-28');

-- Position Reconciliation (matches RECON_SQL scenario -- variance sum != 0)
DROP TABLE IF EXISTS ${DEMO_SCHEMA}.position_reconciliation;
CREATE TABLE ${DEMO_SCHEMA}.position_reconciliation (
  account_id TEXT NOT NULL,
  book_value NUMERIC(18,2) NOT NULL,
  market_value NUMERIC(18,2) NOT NULL,
  variance NUMERIC(18,2) NOT NULL,
  reporting_date DATE NOT NULL
);

INSERT INTO ${DEMO_SCHEMA}.position_reconciliation (account_id, book_value, market_value, variance, reporting_date) VALUES
  ('ACC-001', 1000000,  995000,   5000, '2026-03-28'),
  ('ACC-002', 2500000, 2510000, -10000, '2026-03-28'),
  ('ACC-003',  750000,  770000,  20000, '2026-03-28');
`;

const TEARDOWN_SQL = `
DROP TABLE IF EXISTS ${DEMO_SCHEMA}.counterparty_exposures;
DROP TABLE IF EXISTS ${DEMO_SCHEMA}.liquidity_buffer;
DROP TABLE IF EXISTS ${DEMO_SCHEMA}.position_reconciliation;
DROP SCHEMA IF EXISTS ${DEMO_SCHEMA};
`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DemoBootstrapResult {
  success: boolean;
  schema: string;
  tables: string[];
  rowCounts: Record<string, number>;
  message: string;
  /** The SQL that was executed (for transparency). */
  executedSql: string;
}

export interface DemoBootstrapPlan {
  schema: string;
  tables: { name: string; columns: string[]; rowCount: number }[];
  setupSql: string;
  teardownSql: string;
}

// ─── Plan (deterministic, no DB needed) ─────────────────────────────────────

/**
 * Returns the demo bootstrap plan without executing anything.
 * Useful for tests and operator inspection.
 */
export function getDemoBootstrapPlan(): DemoBootstrapPlan {
  return {
    schema: DEMO_SCHEMA,
    tables: [
      { name: 'counterparty_exposures', columns: ['counterparty_name', 'exposure_usd', 'credit_rating', 'sector', 'reporting_date'], rowCount: 6 },
      { name: 'liquidity_buffer', columns: ['asset_class', 'liquidity_value', 'days_to_maturity', 'is_encumbered', 'reporting_date'], rowCount: 3 },
      { name: 'position_reconciliation', columns: ['account_id', 'book_value', 'market_value', 'variance', 'reporting_date'], rowCount: 3 },
    ],
    setupSql: SETUP_SQL.trim(),
    teardownSql: TEARDOWN_SQL.trim(),
  };
}

/**
 * Returns the SQL that `prove counterparty` should use when running against
 * the demo schema. This rewrites the fixture SQL to use attestor_demo.* instead of risk.*.
 */
export function getDemoCounterpartySql(): string {
  return `SELECT
  counterparty_name,
  exposure_usd,
  credit_rating,
  sector
FROM ${DEMO_SCHEMA}.counterparty_exposures
WHERE reporting_date = '2026-03-28'
ORDER BY exposure_usd DESC`;
}

export function getDemoAllowedSchemas(): string[] {
  return [DEMO_SCHEMA];
}

// ─── Execution ──────────────────────────────────────────────────────────────

/**
 * Execute the demo bootstrap against a real PostgreSQL instance.
 * Creates the attestor_demo schema and seeds all demo tables.
 * This is the ONLY write operation in Attestor's PostgreSQL integration.
 */
export async function runDemoBootstrap(): Promise<DemoBootstrapResult> {
  // Validate prerequisites
  if (!isPostgresConfigured()) {
    return { success: false, schema: DEMO_SCHEMA, tables: [], rowCounts: {}, message: 'ATTESTOR_PG_URL not set. Cannot bootstrap.', executedSql: '' };
  }
  if (!(await isPostgresDriverAvailable())) {
    return { success: false, schema: DEMO_SCHEMA, tables: [], rowCounts: {}, message: 'pg driver not installed. Run: npm install pg', executedSql: '' };
  }

  const config = loadPostgresConfig()!;
  let Client: any;
  try {
    const pg = await (Function('return import("pg")')() as Promise<any>);
    Client = pg.default?.Client ?? pg.Client;
  } catch {
    return { success: false, schema: DEMO_SCHEMA, tables: [], rowCounts: {}, message: 'Failed to load pg driver.', executedSql: '' };
  }

  const client = new Client({ connectionString: config.connectionUrl });
  try {
    await client.connect();

    // Execute the full setup script
    await client.query(SETUP_SQL);

    // Verify row counts
    const rowCounts: Record<string, number> = {};
    for (const table of ['counterparty_exposures', 'liquidity_buffer', 'position_reconciliation']) {
      const result = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${DEMO_SCHEMA}.${table}`);
      rowCounts[table] = result.rows[0]?.cnt ?? 0;
    }

    await client.end();

    const tables = Object.keys(rowCounts);
    const totalRows = Object.values(rowCounts).reduce((s, n) => s + n, 0);

    return {
      success: true,
      schema: DEMO_SCHEMA,
      tables,
      rowCounts,
      message: `Demo schema '${DEMO_SCHEMA}' bootstrapped: ${tables.length} tables, ${totalRows} rows.`,
      executedSql: SETUP_SQL.trim(),
    };
  } catch (err) {
    try { await client.end(); } catch { /* ignore */ }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, schema: DEMO_SCHEMA, tables: [], rowCounts: {}, message: `Bootstrap failed: ${msg}`, executedSql: SETUP_SQL.trim() };
  }
}

/**
 * Remove the demo schema and all its tables.
 */
export async function runDemoTeardown(): Promise<{ success: boolean; message: string }> {
  if (!isPostgresConfigured()) {
    return { success: false, message: 'ATTESTOR_PG_URL not set.' };
  }
  if (!(await isPostgresDriverAvailable())) {
    return { success: false, message: 'pg driver not installed.' };
  }

  const config = loadPostgresConfig()!;
  let Client: any;
  try {
    const pg = await (Function('return import("pg")')() as Promise<any>);
    Client = pg.default?.Client ?? pg.Client;
  } catch {
    return { success: false, message: 'Failed to load pg driver.' };
  }

  const client = new Client({ connectionString: config.connectionUrl });
  try {
    await client.connect();
    await client.query(TEARDOWN_SQL);
    await client.end();
    return { success: true, message: `Demo schema '${DEMO_SCHEMA}' removed.` };
  } catch (err) {
    try { await client.end(); } catch { /* ignore */ }
    return { success: false, message: `Teardown failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
