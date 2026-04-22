import type { Context } from 'hono';

export function schemaAttestationSummaryFromFull(attestation: any) {
  return {
    present: true,
    scope: 'schema_attestation_full' as const,
    executionContextHash: attestation.executionContextHash,
    provider: 'postgres',
    txidSnapshot: attestation.txidSnapshot ?? null,
    columnFingerprint: attestation.columnFingerprint ?? null,
    constraintFingerprint: attestation.constraintFingerprint ?? null,
    indexFingerprint: attestation.indexFingerprint ?? null,
    schemaFingerprint: attestation.schemaFingerprint,
    sentinelFingerprint: attestation.sentinelFingerprint,
    contentFingerprint: attestation.contentFingerprint ?? null,
    tableNames: attestation.tables,
    attestationHash: attestation.attestationHash,
    tableFingerprints: Array.isArray(attestation.tableContentFingerprints)
      ? attestation.tableContentFingerprints.map((entry: any) => {
          const sentinel = Array.isArray(attestation.sentinels)
            ? attestation.sentinels.find(
                (candidate: any) => candidate.tableName === entry.tableName,
              )
            : null;
          return {
            tableName: entry.tableName,
            rowCount: entry.rowCount,
            sampledRowCount: entry.sampledRowCount,
            rowLimit: entry.rowLimit,
            mode: entry.mode,
            orderBy: entry.orderBy,
            maxXmin: sentinel?.maxXmin ?? null,
            contentHash: entry.contentHash ?? null,
          };
        })
      : null,
    historicalComparison: attestation.historicalComparison ?? null,
  };
}

export function schemaAttestationSummaryFromConnector(
  connectorExecution: any,
  connectorProvider: string | null,
) {
  const attestation = connectorExecution?.schemaAttestation;
  if (attestation) {
    return {
      present: true,
      scope: 'schema_attestation_connector' as const,
      executionContextHash: connectorExecution.executionContextHash,
      provider: connectorProvider,
      txidSnapshot: attestation.txidSnapshot ?? null,
      columnFingerprint: attestation.columnFingerprint ?? null,
      constraintFingerprint: attestation.constraintFingerprint ?? null,
      indexFingerprint: attestation.indexFingerprint ?? null,
      schemaFingerprint: attestation.schemaFingerprint,
      sentinelFingerprint: attestation.sentinelFingerprint,
      contentFingerprint: attestation.contentFingerprint ?? null,
      tableNames: attestation.tables,
      attestationHash: attestation.attestationHash,
      tableFingerprints: attestation.tableFingerprints ?? null,
      historicalComparison: attestation.historicalComparison ?? null,
    };
  }
  if (connectorExecution?.executionContextHash) {
    return {
      present: true,
      scope: 'execution_context_only' as const,
      executionContextHash: connectorExecution.executionContextHash,
      provider: connectorProvider,
      txidSnapshot: null,
      columnFingerprint: null,
      constraintFingerprint: null,
      indexFingerprint: null,
      schemaFingerprint: null,
      sentinelFingerprint: null,
      contentFingerprint: null,
      tableNames: null,
      attestationHash: null,
      tableFingerprints: null,
      historicalComparison: null,
    };
  }
  return null;
}

export function applyRateLimitHeaders(
  context: Context,
  rateLimit: {
    requestsPerWindow: number | null;
    remaining: number | null;
    resetAt: string;
    retryAfterSeconds: number;
    enforced: boolean;
  },
  options?: { includeRetryAfter?: boolean },
): void {
  if (!rateLimit.enforced || rateLimit.requestsPerWindow === null) return;
  context.header('x-attestor-rate-limit-limit', String(rateLimit.requestsPerWindow));
  context.header('x-attestor-rate-limit-remaining', String(rateLimit.remaining ?? 0));
  context.header('x-attestor-rate-limit-reset', rateLimit.resetAt);
  if (options?.includeRetryAfter) {
    context.header('Retry-After', String(rateLimit.retryAfterSeconds));
  }
}
