/**
 * Attestor Database Connector Interface
 *
 * Pluggable connector interface for governed read-only query execution.
 * PostgreSQL is the reference implementation. This interface enables
 * Snowflake, BigQuery, Databricks, and other warehouse connectors.
 *
 * SAFETY CONTRACT:
 * - All connectors must enforce read-only execution
 * - All connectors must enforce query timeout
 * - All connectors must enforce row limits
 * - All connectors must produce execution evidence (context hash, timestamp)
 * - All connectors must support write/stacked-query rejection
 */

// ─── Connector Interface ────────────────────────────────────────────────────

export interface DatabaseConnector {
  /** Connector identifier (e.g., 'postgres', 'snowflake', 'bigquery'). */
  readonly id: string;
  /** Human-readable connector name. */
  readonly displayName: string;
  /** Whether this connector is available (driver installed, configured). */
  isAvailable(): Promise<boolean>;
  /** Connection configuration from environment. */
  loadConfig(): ConnectorConfig | null;
  /** Execute a governed read-only query. */
  execute(sql: string, config: ConnectorConfig): Promise<ConnectorExecutionResult>;
  /** Run a predictive guardrail preflight (EXPLAIN or equivalent). */
  preflight?(sql: string, config: ConnectorConfig): Promise<ConnectorPreflightResult>;
  /** Bounded connectivity probe. */
  probe(config: ConnectorConfig): Promise<ConnectorProbeResult>;
}

export interface ConnectorConfig {
  /** Provider identifier. */
  provider: string;
  /** Connection URL or equivalent. */
  connectionUrl: string;
  /** Query timeout in milliseconds. */
  timeoutMs: number;
  /** Maximum result rows. */
  maxRows: number;
  /** Allowed schemas (if applicable). */
  allowedSchemas?: string[];
  /** Provider-specific options. */
  options?: Record<string, unknown>;
}

export interface ConnectorExecutionResult {
  success: boolean;
  provider: string;
  durationMs: number;
  rowCount: number;
  columns: string[];
  columnTypes: string[];
  rows: Record<string, unknown>[];
  error: string | null;
  /** Bounded execution context hash. */
  executionContextHash: string | null;
  /** ISO timestamp of execution. */
  executionTimestamp: string;
  /** Schema attestation summary (when captured by the connector). */
  schemaAttestation?: {
    schemaFingerprint: string;
    sentinelFingerprint: string;
    tables: string[];
    attestationHash: string;
    source: string;
    columnFingerprint?: string | null;
    constraintFingerprint?: string | null;
    indexFingerprint?: string | null;
    contentFingerprint?: string | null;
    txidSnapshot?: string | null;
    tableFingerprints?: Array<{
      tableName: string;
      rowCount: number;
      sampledRowCount: number;
      rowLimit: number;
      mode: 'full' | 'truncated' | 'unavailable';
      orderBy: string[];
      contentHash: string | null;
      maxXmin?: string | null;
    }> | null;
    historicalComparison?: {
      historyKey: string;
      previousCapturedAt: string;
      previousAttestationHash: string;
      currentAttestationHash: string;
      schemaChanged: boolean;
      dataChanged: boolean;
      contentChanged: boolean;
      summary: string;
    } | null;
  } | null;
}

export interface ConnectorPreflightResult {
  performed: boolean;
  provider: string;
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  recommendation: 'proceed' | 'warn' | 'deny';
  signals: { signal: string; severity: string; detail: string }[];
}

export interface ConnectorProbeResult {
  provider: string;
  success: boolean;
  steps: { step: string; passed: boolean; detail: string }[];
  serverVersion: string | null;
  message: string;
}

// ─── Connector Registry ─────────────────────────────────────────────────────

export class ConnectorRegistry {
  private connectors = new Map<string, DatabaseConnector>();

  register(connector: DatabaseConnector): void {
    if (this.connectors.has(connector.id)) {
      throw new Error(`Connector "${connector.id}" already registered`);
    }
    this.connectors.set(connector.id, connector);
  }

  get(id: string): DatabaseConnector | undefined {
    return this.connectors.get(id);
  }

  has(id: string): boolean {
    return this.connectors.has(id);
  }

  list(): DatabaseConnector[] {
    return [...this.connectors.values()];
  }

  listIds(): string[] {
    return [...this.connectors.keys()];
  }

  /** Find the first available connector. */
  async findAvailable(): Promise<DatabaseConnector | null> {
    for (const connector of this.connectors.values()) {
      if (await connector.isAvailable()) return connector;
    }
    return null;
  }
}

export const connectorRegistry = new ConnectorRegistry();
