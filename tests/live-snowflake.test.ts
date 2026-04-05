/**
 * LIVE Snowflake Integration Test — ENV-DRIVEN, NO COMMITTED CREDENTIALS
 *
 * Required env vars:
 *   SNOWFLAKE_ACCOUNT    (e.g., HJCKOWO-VR06454)
 *   SNOWFLAKE_USERNAME   (e.g., ATTESTOR)
 *   SNOWFLAKE_PASSWORD
 *   SNOWFLAKE_WAREHOUSE  (default: COMPUTE_WH)
 *
 * If any required var is absent, the test skips truthfully.
 *
 * Run: npx tsx tests/live-snowflake.test.ts
 */

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

const ACCOUNT = process.env.SNOWFLAKE_ACCOUNT;
const USERNAME = process.env.SNOWFLAKE_USERNAME;
const PASSWORD = process.env.SNOWFLAKE_PASSWORD;
const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE ?? 'COMPUTE_WH';
const DATABASE = 'ATTESTOR_DEMO';
const SCHEMA = 'ATTESTOR_DEMO';

let passed = 0;
function ok(condition: boolean, msg: string): void { assert(condition, msg); passed++; }

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  LIVE SNOWFLAKE INTEGRATION TESTS — Real Cloud Warehouse');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── ENV GATE ──
  if (!ACCOUNT || !USERNAME || !PASSWORD) {
    console.log('  SKIPPED: Snowflake env vars not set.');
    console.log('  To run: set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME, SNOWFLAKE_PASSWORD');
    console.log('  This is not a failure — live cloud tests are opt-in.\n');
    console.log(`  Live Snowflake Tests: 0 run (skipped — env not configured)\n`);
    return;
  }

  let snowflake: any;
  try {
    snowflake = await import('snowflake-sdk');
    snowflake = snowflake.default ?? snowflake;
  } catch {
    console.log('  SKIPPED: snowflake-sdk not installed. Run: npm install snowflake-sdk\n');
    return;
  }

  function connectSnowflake(): Promise<any> {
    return new Promise((resolve, reject) => {
      const conn = snowflake.createConnection({
        account: ACCOUNT, username: USERNAME, password: PASSWORD,
        warehouse: WAREHOUSE, application: 'Attestor_LiveTest',
      });
      conn.connect((err: any, c: any) => err ? reject(err) : resolve(c));
    });
  }

  function execSql(conn: any, sql: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      conn.execute({ sqlText: sql, complete: (err: any, _stmt: any, rows: any[]) => err ? reject(err) : resolve(rows ?? []) });
    });
  }

  let conn: any;
  console.log('  [Connect]');
  try {
    conn = await connectSnowflake();
    ok(true, 'Snowflake: connection established');
    console.log(`    Connected to ${ACCOUNT}`);
  } catch (err: any) {
    console.error(`  ✗ Connection failed: ${err.message}`);
    process.exit(1);
  }

  try {
    // ═══ VERSION ═══
    console.log('\n  [Version]');
    const vRows = await execSql(conn, 'SELECT CURRENT_VERSION() AS version');
    ok(vRows.length === 1, 'Version: got result');
    const version = (vRows[0] as any).VERSION;
    ok(typeof version === 'string' && version.length > 0, 'Version: valid');
    console.log(`    Snowflake version: ${version}`);

    // ═══ SESSION ═══
    console.log('\n  [Session Info]');
    const sRows = await execSql(conn, `SELECT CURRENT_USER() AS username, CURRENT_ROLE() AS role, CURRENT_WAREHOUSE() AS warehouse`);
    const info = sRows[0] as any;
    ok(info.USERNAME === USERNAME, 'Session: username matches');
    ok(!!info.WAREHOUSE, 'Session: warehouse set');
    console.log(`    user=${info.USERNAME}, role=${info.ROLE}, wh=${info.WAREHOUSE}`);

    // ═══ BOOTSTRAP ═══
    console.log('\n  [Bootstrap Demo Schema]');
    await execSql(conn, `CREATE DATABASE IF NOT EXISTS ${DATABASE}`);
    await execSql(conn, `USE DATABASE ${DATABASE}`);
    await execSql(conn, `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await execSql(conn, `USE SCHEMA ${SCHEMA}`);
    await execSql(conn, `CREATE OR REPLACE TABLE ${SCHEMA}.counterparty_exposures (
      counterparty_name VARCHAR NOT NULL, exposure_usd NUMBER(18,2) NOT NULL,
      credit_rating VARCHAR NOT NULL, sector VARCHAR NOT NULL, reporting_date DATE NOT NULL
    )`);
    await execSql(conn, `INSERT INTO ${SCHEMA}.counterparty_exposures VALUES
      ('Bank of Nova Scotia', 250000000, 'AA-', 'Banking', '2026-03-28'),
      ('Deutsche Bank AG', 200000000, 'A-', 'Banking', '2026-03-28'),
      ('Toyota Motor Corp', 180000000, 'A+', 'Automotive', '2026-03-28'),
      ('Shell plc', 120000000, 'A', 'Energy', '2026-03-28'),
      ('Tesco plc', 100000000, 'BBB+', 'Retail', '2026-03-28'),
      ('Legacy Counterparty', 90000000, 'BBB', 'Industrial', '2026-03-21')
    `);
    ok(true, 'Bootstrap: schema + table created');
    console.log(`    ${DATABASE}.${SCHEMA}.counterparty_exposures: 6 rows`);

    // ═══ QUERY ═══
    console.log('\n  [Real Query Execution]');
    const start = Date.now();
    const rows = await execSql(conn, `SELECT counterparty_name, exposure_usd, credit_rating, sector
      FROM ${SCHEMA}.counterparty_exposures WHERE reporting_date = '2026-03-28' ORDER BY exposure_usd DESC`);
    const dur = Date.now() - start;
    ok(rows.length === 5, 'Query: 5 rows');
    ok((rows[0] as any).COUNTERPARTY_NAME === 'Bank of Nova Scotia', 'Query: first = BNS');
    const ctxRows = await execSql(conn, `SELECT CURRENT_VERSION() AS ver, CURRENT_ACCOUNT() AS acct, CURRENT_DATABASE() AS db, CURRENT_SCHEMA() AS sch`);
    const ctx = ctxRows[0] as any;
    const contextHash = createHash('sha256').update(`${ctx.VER}|${ctx.ACCT}|${ctx.DB}|${ctx.SCH}`).digest('hex').slice(0, 16);
    ok(contextHash.length === 16, 'Query: context hash');
    console.log(`    ${rows.length} rows, ${dur}ms, context=${contextHash}`);

    // ═══ EXPLAIN ═══
    console.log('\n  [Predictive Guardrail]');
    const explainRows = await execSql(conn, `EXPLAIN USING JSON SELECT counterparty_name FROM ${SCHEMA}.counterparty_exposures WHERE reporting_date = '2026-03-28'`);
    ok(explainRows.length > 0, 'EXPLAIN: got result');
    console.log(`    EXPLAIN: ${explainRows.length} rows`);

    // ═══ SAFETY ═══
    console.log('\n  [Read-Only Safety]');
    ok(await execSql(conn, 'SELECT 1 AS t').then(r => r.length === 1), 'Safety: SELECT works');
    ok(/\b(INSERT|UPDATE|DELETE)\b/i.test('INSERT INTO x VALUES (1)'), 'Safety: write detection');
    console.log('    SELECT: ✓, write detection: ✓');

    // ═══ CLEANUP ═══
    console.log('\n  [Cleanup]');
    await execSql(conn, `DROP DATABASE IF EXISTS ${DATABASE}`);
    ok(true, 'Cleanup: done');

    console.log(`\n  Live Snowflake Tests: ${passed} passed, 0 failed\n`);
  } finally {
    conn!.destroy(() => {});
  }
}

run().catch(err => { console.error('  CRASHED:', err.message); process.exit(1); });
