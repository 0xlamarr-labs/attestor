/**
 * Attestor Snowflake Connector — Real warehouse connector implementing DatabaseConnector.
 *
 * Uses the official snowflake-sdk for governed read-only query execution.
 * Includes: connection, execution, EXPLAIN-based preflight, evidence collection.
 *
 * Safety: SQL governance (write rejection) is enforced at the Attestor engine level.
 * The connector executes only what passes governance gates.
 */

import { createHash } from 'node:crypto';
import type {
  DatabaseConnector, ConnectorConfig, ConnectorExecutionResult,
  ConnectorPreflightResult, ConnectorProbeResult,
} from './connector-interface.js';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface SnowflakeConfig extends ConnectorConfig {
  provider: 'snowflake';
  /** Snowflake account identifier (e.g., HJCKOWO-VR06454). */
  account: string;
  username: string;
  password: string;
  warehouse: string;
  database?: string;
  schema?: string;
}

export function loadSnowflakeConfig(): SnowflakeConfig | null {
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USERNAME;
  const password = process.env.SNOWFLAKE_PASSWORD;
  if (!account || !username || !password) return null;
  return {
    provider: 'snowflake',
    connectionUrl: `https://${account}.snowflakecomputing.com`,
    account,
    username,
    password,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? 'COMPUTE_WH',
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    timeoutMs: parseInt(process.env.SNOWFLAKE_TIMEOUT_MS ?? '30000', 10),
    maxRows: parseInt(process.env.SNOWFLAKE_MAX_ROWS ?? '10000', 10),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getSnowflakeSDK() {
  try {
    const sdk = await import('snowflake-sdk');
    return sdk.default ?? sdk;
  } catch {
    return null;
  }
}

function execSql(conn: any, sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      complete: (err: any, _stmt: any, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows ?? []);
      },
    });
  });
}

function connectSnowflake(sdk: any, config: SnowflakeConfig): Promise<any> {
  return new Promise((resolve, reject) => {
    const conn = sdk.createConnection({
      account: config.account,
      username: config.username,
      password: config.password,
      warehouse: config.warehouse,
      database: config.database,
      schema: config.schema,
      application: 'Attestor_Connector',
    });
    conn.connect((err: any, c: any) => {
      if (err) reject(err);
      else resolve(c);
    });
  });
}

// ─── Connector Implementation ───────────────────────────────────────────────

export const snowflakeConnector: DatabaseConnector = {
  id: 'snowflake',
  displayName: 'Snowflake Data Cloud',

  async isAvailable(): Promise<boolean> {
    const sdk = await getSnowflakeSDK();
    if (!sdk) return false;
    const config = loadSnowflakeConfig();
    return config !== null;
  },

  loadConfig(): ConnectorConfig | null {
    return loadSnowflakeConfig();
  },

  async execute(sql: string, config: ConnectorConfig): Promise<ConnectorExecutionResult> {
    const sfConfig = config as SnowflakeConfig;
    const start = Date.now();
    const timestamp = new Date().toISOString();
    const sdk = await getSnowflakeSDK();
    if (!sdk) {
      return { success: false, provider: 'snowflake', durationMs: 0, rowCount: 0, columns: [], columnTypes: [], rows: [], error: 'snowflake-sdk not installed', executionContextHash: null, executionTimestamp: timestamp };
    }

    let conn: any;
    try {
      conn = await connectSnowflake(sdk, sfConfig);

      // Collect context evidence BEFORE query
      const ctxRows = await execSql(conn, `
        SELECT CURRENT_VERSION() AS ver, CURRENT_ACCOUNT() AS acct,
               CURRENT_DATABASE() AS db, CURRENT_SCHEMA() AS sch
      `);
      const ctx = ctxRows[0] as any;
      const executionContextHash = createHash('sha256')
        .update(`${ctx.VER}|${ctx.ACCT}|${ctx.DB}|${ctx.SCH}|snowflake`)
        .digest('hex')
        .slice(0, 16);

      // Execute governed query
      const rows = await execSql(conn, sql);
      const durationMs = Date.now() - start;

      // Extract columns from first row
      const columns = rows.length > 0 ? Object.keys(rows[0] as any) : [];
      const columnTypes = columns.map(() => 'unknown'); // Snowflake SDK doesn't expose types easily

      return {
        success: true,
        provider: 'snowflake',
        durationMs,
        rowCount: rows.length,
        columns,
        columnTypes,
        rows: rows as Record<string, unknown>[],
        error: null,
        executionContextHash,
        executionTimestamp: timestamp,
      };
    } catch (err: any) {
      return {
        success: false, provider: 'snowflake', durationMs: Date.now() - start,
        rowCount: 0, columns: [], columnTypes: [], rows: [],
        error: err.message ?? String(err), executionContextHash: null, executionTimestamp: timestamp,
      };
    } finally {
      if (conn) conn.destroy(() => {});
    }
  },

  async preflight(sql: string, config: ConnectorConfig): Promise<ConnectorPreflightResult> {
    const sfConfig = config as SnowflakeConfig;
    const sdk = await getSnowflakeSDK();
    if (!sdk) {
      return { performed: false, provider: 'snowflake', riskLevel: 'low', recommendation: 'proceed', signals: [] };
    }

    let conn: any;
    try {
      conn = await connectSnowflake(sdk, sfConfig);
      const rows = await execSql(conn, `EXPLAIN USING JSON ${sql}`);
      const planStr = JSON.stringify(rows);

      // Basic risk analysis from plan size
      const signals: { signal: string; severity: string; detail: string }[] = [];
      if (planStr.length > 10000) {
        signals.push({ signal: 'complex_plan', severity: 'warn', detail: `Plan is ${planStr.length} chars — may indicate complex query` });
      }

      return {
        performed: true,
        provider: 'snowflake',
        riskLevel: signals.length > 0 ? 'moderate' : 'low',
        recommendation: signals.some(s => s.severity === 'critical') ? 'deny' : signals.length > 0 ? 'warn' : 'proceed',
        signals,
      };
    } catch (err: any) {
      return {
        performed: false, provider: 'snowflake', riskLevel: 'low', recommendation: 'proceed',
        signals: [{ signal: 'explain_failed', severity: 'info', detail: err.message }],
      };
    } finally {
      if (conn) conn.destroy(() => {});
    }
  },

  async probe(config: ConnectorConfig): Promise<ConnectorProbeResult> {
    const sfConfig = config as SnowflakeConfig;
    const steps: { step: string; passed: boolean; detail: string }[] = [];
    let serverVersion: string | null = null;

    const sdk = await getSnowflakeSDK();
    if (!sdk) {
      steps.push({ step: 'driver', passed: false, detail: 'snowflake-sdk not installed' });
      return { provider: 'snowflake', success: false, steps, serverVersion, message: 'Driver not installed' };
    }
    steps.push({ step: 'driver', passed: true, detail: 'snowflake-sdk available' });

    let conn: any;
    try {
      conn = await connectSnowflake(sdk, sfConfig);
      steps.push({ step: 'connect', passed: true, detail: `Connected to ${sfConfig.account}` });

      const vRows = await execSql(conn, 'SELECT CURRENT_VERSION() AS version');
      serverVersion = (vRows[0] as any)?.VERSION ?? null;
      steps.push({ step: 'version', passed: !!serverVersion, detail: serverVersion ? `Snowflake ${serverVersion}` : 'Version unknown' });

      const whRows = await execSql(conn, 'SELECT CURRENT_WAREHOUSE() AS wh');
      const wh = (whRows[0] as any)?.WH;
      steps.push({ step: 'warehouse', passed: !!wh, detail: wh ? `Warehouse: ${wh}` : 'No warehouse' });

      return { provider: 'snowflake', success: steps.every(s => s.passed), steps, serverVersion, message: 'Snowflake probe passed' };
    } catch (err: any) {
      steps.push({ step: 'connect', passed: false, detail: err.message });
      return { provider: 'snowflake', success: false, steps, serverVersion, message: `Probe failed: ${err.message}` };
    } finally {
      if (conn) conn.destroy(() => {});
    }
  },
};
