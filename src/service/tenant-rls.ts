/**
 * Database-Level Multi-Tenant Isolation — PostgreSQL Row-Level Security
 *
 * Implements tenant isolation at the database level using PostgreSQL RLS.
 * Even if application code has a bug, Postgres blocks cross-tenant data access.
 *
 * PATTERN (from research: 0.4ms overhead, production-proven):
 * 1. All tenant-scoped tables have a `tenant_id` column
 * 2. RLS policies enforce filtering: USING (tenant_id = current_setting('app.tenant_id'))
 * 3. Per-transaction: SET app.tenant_id = ? (transaction-scoped, PgBouncer safe)
 *
 * BOUNDARY:
 * - Shared schema + RLS (not schema-per-tenant)
 * - Composite indexes on (tenant_id, ...) for performance
 * - Transaction-scoped settings (not session-scoped)
 * - No tenant-specific DDL or storage isolation
 */

// ─── Schema Setup SQL ───────────────────────────────────────────────────────

/**
 * SQL to create RLS-protected tenant tables.
 * Run this once during database initialization.
 */
export const TENANT_SCHEMA_SQL = `
-- Tenant registry
CREATE TABLE IF NOT EXISTS attestor_tenants (
  tenant_id TEXT PRIMARY KEY,
  tenant_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE
);

-- Governed run results (tenant-isolated)
CREATE TABLE IF NOT EXISTS attestor_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES attestor_tenants(tenant_id),
  run_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  proof_mode TEXT NOT NULL,
  certificate_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE attestor_runs ENABLE ROW LEVEL SECURITY;

-- RLS policy: each tenant sees only their own rows
CREATE POLICY tenant_isolation_runs ON attestor_runs
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Composite indexes for performance
CREATE INDEX IF NOT EXISTS idx_runs_tenant_created ON attestor_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_tenant_decision ON attestor_runs (tenant_id, decision);

-- Audit log (tenant-isolated)
CREATE TABLE IF NOT EXISTS attestor_audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES attestor_tenants(tenant_id),
  action TEXT NOT NULL,
  run_id TEXT,
  actor TEXT,
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE attestor_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit ON attestor_audit_log
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON attestor_audit_log (tenant_id, created_at DESC);
`;

// ─── Transaction-Scoped Tenant Context ──────────────────────────────────────

/**
 * Execute a function within a tenant-scoped transaction.
 * The tenant_id is set via set_config (transaction-local), so it is
 * PgBouncer-safe and cannot leak between requests.
 */
export async function withTenantTransaction<T>(
  pool: any, // pg.Pool
  tenantId: string,
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Tenant CRUD ────────────────────────────────────────────────────────────

export async function createTenant(client: any, tenantId: string, tenantName: string): Promise<void> {
  await client.query(
    'INSERT INTO attestor_tenants (tenant_id, tenant_name) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING',
    [tenantId, tenantName],
  );
}

export async function storeRun(
  client: any,
  tenantId: string,
  runId: string,
  decision: string,
  proofMode: string,
  certificateId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO attestor_runs (id, tenant_id, run_id, decision, proof_mode, certificate_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [`${tenantId}-${runId}`, tenantId, runId, decision, proofMode, certificateId, JSON.stringify(metadata)],
  );
}

export async function logAuditEvent(
  client: any,
  tenantId: string,
  action: string,
  runId: string | null,
  actor: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO attestor_audit_log (tenant_id, action, run_id, actor, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, action, runId, actor, JSON.stringify(detail)],
  );
}

export async function getTenantRuns(
  client: any,
  limit: number = 50,
): Promise<any[]> {
  const result = await client.query(
    'SELECT * FROM attestor_runs ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return result.rows;
}

/**
 * Verify RLS isolation: attempt to read another tenant's data.
 * Should return 0 rows if RLS is working correctly.
 */
export async function verifyIsolation(
  pool: any,
  tenantA: string,
  tenantB: string,
): Promise<{ isolated: boolean; leakedRows: number }> {
  // Write as tenant A
  await withTenantTransaction(pool, tenantA, async (client) => {
    await storeRun(client, tenantA, 'isolation-test', 'pass', 'fixture', null);
  });

  // Read as tenant B — should see 0 rows from tenant A
  const rows = await withTenantTransaction(pool, tenantB, async (client) => {
    return getTenantRuns(client);
  });

  const leakedRows = rows.filter((r: any) => r.tenant_id === tenantA).length;
  return { isolated: leakedRows === 0, leakedRows };
}
