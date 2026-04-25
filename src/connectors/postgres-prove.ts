/**
 * Attestor PostgreSQL Product-Proof Flow
 *
 * Orchestrates the full Postgres-backed proof path:
 * 1. Predictive guardrail preflight (EXPLAIN)
 * 2. Governed read-only execution
 * 3. Evidence packaging for the financial pipeline
 *
 * This is called by `prove` when ATTESTOR_PG_URL is configured.
 */

import { executePostgresQuery, loadPostgresConfig, reportPostgresReadiness } from './postgres.js';
import { runPredictivePreflight, type PredictiveGuardrailResult } from './predictive-guardrails.js';
import { captureSchemaAttestation, type HistoricalSchemaComparison, type SchemaAttestation } from './schema-attestation.js';
import { buildSchemaAttestationHistoryKey, recordSchemaAttestationHistory } from './schema-attestation-history.js';
import type { ExecutionEvidence } from '../financial/types.js';

export interface PostgresProveResult {
  /** Whether Postgres execution was attempted. */
  attempted: boolean;
  /** Postgres configuration used (sanitized). */
  config: { url: string; timeoutMs: number; maxRows: number; allowedSchemas: string[] } | null;
  /** Predictive guardrail preflight result. */
  predictiveGuardrail: PredictiveGuardrailResult;
  /** Execution evidence compatible with FinancialRunReport. */
  execution: ExecutionEvidence | null;
  /** Additional Postgres-specific evidence. */
  postgresEvidence: {
    executionContextHash: string | null;
    executionTimestamp: string | null;
    provider: string;
  };
  /** Schema and data-state attestation (when execution succeeded). */
  schemaAttestation: SchemaAttestation | null;
  /** Comparison against the previous local attestation for the same attestation scope. */
  historicalComparison: HistoricalSchemaComparison | null;
  /** Why Postgres was not used (if not attempted). */
  skipReason: string | null;
}

/**
 * Run the full PostgreSQL product-proof flow.
 * Returns execution evidence ready for the financial pipeline.
 */
export async function runPostgresProve(sql: string): Promise<PostgresProveResult> {
  // Check readiness
  const readiness = await reportPostgresReadiness();
  if (!readiness.runnable) {
    return {
      attempted: false,
      config: null,
      predictiveGuardrail: { performed: false, riskLevel: 'low', signals: [], recommendation: 'proceed', plannerEvidence: null },
      execution: null,
      postgresEvidence: { executionContextHash: null, executionTimestamp: null, provider: 'postgres' },
      schemaAttestation: null,
      historicalComparison: null,
      skipReason: readiness.message,
    };
  }

  const config = loadPostgresConfig()!;
  const sanitizedUrl = config.connectionUrl.replace(/:[^@]*@/, ':***@');

  // Step 1: Predictive guardrail preflight
  const preflight = await runPredictivePreflight(sql, config.connectionUrl);

  // Step 2: Check if preflight denies execution
  if (preflight.recommendation === 'deny') {
    // Execution was DENIED before it happened — no execution evidence exists
    return {
      attempted: true,
      config: { url: sanitizedUrl, timeoutMs: config.statementTimeoutMs ?? 10000, maxRows: config.maxRows ?? 10000, allowedSchemas: config.allowedSchemas ?? [] },
      predictiveGuardrail: preflight,
      execution: null, // truthful: no execution occurred
      postgresEvidence: { executionContextHash: null, executionTimestamp: null, provider: 'postgres' },
      schemaAttestation: null,
      historicalComparison: null,
      skipReason: `Predictive guardrail denied execution: ${preflight.signals.filter((s) => s.severity === 'critical').map((s) => s.detail).join('; ')}`,
    };
  }

  // Step 3: Capture schema attestation BEFORE query execution
  let schemaAttestation: SchemaAttestation | null = null;
  try {
    const pg = await (Function('return import("pg")')() as Promise<any>);
    const PgClient = pg.default?.Client ?? pg.Client;
    const attestClient = new PgClient({ connectionString: config.connectionUrl });
    await attestClient.connect();
    await attestClient.query('BEGIN TRANSACTION READ ONLY');

    // Extract schema and table names from SQL (bounded: look for schema.table patterns)
    const tableRefs = [...sql.matchAll(/\b(\w+)\.(\w+)\b/g)].map(m => ({ schema: m[1], table: m[2] }));
    const schemaName = tableRefs[0]?.schema ?? 'public';
    const tableNames = [...new Set(tableRefs.map(r => r.table))];

    if (tableNames.length > 0) {
      schemaAttestation = await captureSchemaAttestation(attestClient, schemaName, tableNames, null);
    }
    await attestClient.query('ROLLBACK');
    await attestClient.end();
  } catch {
    // Schema attestation is best-effort — don't fail the query if it can't be captured
  }

  // Step 4: Execute query
  const pgResult = await executePostgresQuery(sql, config);

  // Update attestation with execution context hash
  if (schemaAttestation && pgResult.executionContextHash) {
    schemaAttestation.executionContextHash = pgResult.executionContextHash;
    schemaAttestation.historyKey = buildSchemaAttestationHistoryKey(schemaAttestation);
    schemaAttestation.historicalComparison = recordSchemaAttestationHistory(schemaAttestation);
  }

  // Step 5: Convert to ExecutionEvidence with truthful evidence separation
  // schemaHash = hash of result columns+types (what the query RETURNED)
  // executionContextHash = hash of database environment (where it RAN)
  const { createHash } = await import('node:crypto');
  const resultSchemaHash = pgResult.success
    ? createHash('sha256').update(JSON.stringify({ columns: pgResult.columns, types: pgResult.columnTypes })).digest('hex').slice(0, 16)
    : '';
  const execution: ExecutionEvidence = {
    success: pgResult.success,
    durationMs: pgResult.durationMs,
    rowCount: pgResult.rowCount,
    columns: pgResult.columns,
    columnTypes: pgResult.columnTypes,
    rows: pgResult.rows,
    error: pgResult.error,
    schemaHash: resultSchemaHash,
    provider: 'postgres',
    executionContextHash: pgResult.executionContextHash,
  };

  return {
    attempted: true,
    config: { url: sanitizedUrl, timeoutMs: config.statementTimeoutMs ?? 10000, maxRows: config.maxRows ?? 10000, allowedSchemas: config.allowedSchemas ?? [] },
    predictiveGuardrail: preflight,
    execution,
    postgresEvidence: {
      executionContextHash: pgResult.executionContextHash,
      executionTimestamp: pgResult.executionTimestamp,
      provider: 'postgres',
    },
    schemaAttestation,
    historicalComparison: schemaAttestation?.historicalComparison ?? null,
    skipReason: null,
  };
}
