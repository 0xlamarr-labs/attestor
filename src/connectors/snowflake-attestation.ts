/**
 * Snowflake Schema Attestation
 *
 * Captures schema fingerprint and data sentinels from Snowflake
 * for cross-database attestation parity with PostgreSQL.
 *
 * Uses INFORMATION_SCHEMA (session-scoped, real-time) for schema capture
 * and COUNT(*) sentinels for data state evidence.
 *
 * BOUNDARY:
 * - No Snowflake Time Travel for schema history (only data)
 * - No ACCESS_HISTORY integration (requires ACCOUNT_USAGE, 45min latency)
 * - Attestation is point-in-time, not historical
 */

import { createHash } from 'node:crypto';
import type { SchemaAttestation, SchemaColumn, TableSentinel } from './schema-attestation.js';

/**
 * Capture schema attestation from a Snowflake connection.
 * Requires an active snowflake-sdk connection.
 */
export async function captureSnowflakeSchemaAttestation(
  execSql: (sql: string) => Promise<any[]>,
  database: string,
  schema: string,
  tables: string[],
): Promise<SchemaAttestation> {
  const capturedAt = new Date().toISOString();

  // 1. Schema fingerprint via INFORMATION_SCHEMA
  const colRows = await execSql(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION
    FROM ${database}.INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = '${schema}'
      AND TABLE_NAME IN (${tables.map(t => `'${t.toUpperCase()}'`).join(',')})
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  const columns: SchemaColumn[] = colRows.map((r: any) => ({
    tableName: r.TABLE_NAME,
    columnName: r.COLUMN_NAME,
    dataType: r.DATA_TYPE,
    isNullable: r.IS_NULLABLE,
    columnDefault: r.COLUMN_DEFAULT,
    ordinalPosition: Number(r.ORDINAL_POSITION),
  }));

  const schemaFingerprint = createHash('sha256')
    .update(JSON.stringify(columns))
    .digest('hex')
    .slice(0, 32);

  // 2. Data sentinels (COUNT per table)
  const sentinels: TableSentinel[] = [];
  for (const table of tables) {
    try {
      const rows = await execSql(`SELECT COUNT(*) AS ROW_COUNT FROM ${database}.${schema}.${table}`);
      sentinels.push({
        tableName: table,
        rowCount: Number(rows[0]?.ROW_COUNT ?? 0),
        maxXmin: null, // Snowflake has no xmin equivalent
      });
    } catch {
      sentinels.push({ tableName: table, rowCount: 0, maxXmin: null });
    }
  }

  const sentinelFingerprint = createHash('sha256')
    .update(JSON.stringify(sentinels))
    .digest('hex')
    .slice(0, 32);

  // 3. Execution context
  let executionContextHash: string | null = null;
  try {
    const ctxRows = await execSql(`SELECT CURRENT_VERSION() AS VER, CURRENT_ACCOUNT() AS ACCT`);
    const ctx = ctxRows[0] as any;
    executionContextHash = createHash('sha256')
      .update(`${ctx.VER}|${ctx.ACCT}|${database}|${schema}|snowflake`)
      .digest('hex')
      .slice(0, 16);
  } catch { /* non-fatal */ }

  const attestationHash = createHash('sha256')
    .update(`${schemaFingerprint}|${sentinelFingerprint}|${capturedAt}`)
    .digest('hex')
    .slice(0, 32);

  return {
    version: '1.0',
    type: 'attestor.schema_attestation.v1',
    capturedAt,
    executionContextHash,
    txidSnapshot: null,
    schemaName: schema,
    tables,
    schemaFingerprint,
    columns,
    constraints: [],
    indexes: [],
    sentinels,
    tableContentFingerprints: sentinels.map((sentinel) => ({
      tableName: sentinel.tableName,
      rowCount: sentinel.rowCount,
      sampledRowCount: sentinel.rowCount,
      rowLimit: sentinel.rowCount,
      mode: 'unavailable' as const,
      orderBy: [],
      contentHash: null,
    })),
    columnFingerprint: schemaFingerprint,
    constraintFingerprint: createHash('sha256').update('[]').digest('hex').slice(0, 32),
    indexFingerprint: createHash('sha256').update('[]').digest('hex').slice(0, 32),
    sentinelFingerprint,
    contentFingerprint: createHash('sha256').update(JSON.stringify(tables)).digest('hex').slice(0, 32),
    attestationHash,
    historyKey: null,
    historicalComparison: null,
  };
}
