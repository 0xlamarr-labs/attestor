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

import { executePostgresQuery, loadPostgresConfig, isPostgresConfigured, reportPostgresReadiness, type PostgresConfig, type PostgresExecutionResult } from './postgres.js';
import { runPredictivePreflight, type PredictiveGuardrailResult } from './predictive-guardrails.js';
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
      skipReason: readiness.message,
    };
  }

  const config = loadPostgresConfig()!;
  const sanitizedUrl = config.connectionUrl.replace(/:[^@]*@/, ':***@');

  // Step 1: Predictive guardrail preflight
  const preflight = await runPredictivePreflight(sql, config.connectionUrl);

  // Step 2: Check if preflight denies execution
  if (preflight.recommendation === 'deny') {
    return {
      attempted: true,
      config: { url: sanitizedUrl, timeoutMs: config.statementTimeoutMs ?? 10000, maxRows: config.maxRows ?? 10000, allowedSchemas: config.allowedSchemas ?? [] },
      predictiveGuardrail: preflight,
      execution: { success: false, durationMs: 0, rowCount: 0, columns: [], columnTypes: [], rows: [], error: `Predictive guardrail denied execution: ${preflight.signals.map((s) => s.detail).join('; ')}`, schemaHash: '' },
      postgresEvidence: { executionContextHash: null, executionTimestamp: null, provider: 'postgres' },
      skipReason: 'Predictive guardrail denied execution',
    };
  }

  // Step 3: Execute query
  const pgResult = await executePostgresQuery(sql, config);

  // Step 4: Convert to ExecutionEvidence
  const execution: ExecutionEvidence = {
    success: pgResult.success,
    durationMs: pgResult.durationMs,
    rowCount: pgResult.rowCount,
    columns: pgResult.columns,
    columnTypes: pgResult.columnTypes,
    rows: pgResult.rows,
    error: pgResult.error,
    schemaHash: pgResult.executionContextHash ?? '',
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
    skipReason: null,
  };
}
