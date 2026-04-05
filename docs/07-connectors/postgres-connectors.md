# PostgreSQL Connector and Predictive Guardrails

Attestor includes an optional PostgreSQL connector for real-database proof and a predictive guardrail preflight that can refuse dangerous queries before they touch data.

## PostgreSQL Connector

**Requirements:** `npm install pg` + `ATTESTOR_PG_URL` environment variable.

### Safety Model

- **Read-only**: `BEGIN TRANSACTION READ ONLY` enforced per-query
- **Timeout**: `statement_timeout` set per-query (configurable via `ATTESTOR_PG_TIMEOUT_MS`, default 10000ms)
- **Row limit**: `LIMIT` injected if not present (configurable via `ATTESTOR_PG_MAX_ROWS`, default 10000)
- **Write/stacked-query rejection**: blocked before execution
- **Schema allowlist**: when `ATTESTOR_PG_ALLOWED_SCHEMAS` is configured, all table references must be fully qualified (`schema.table`). Unqualified references are rejected because they can resolve through `search_path` to any schema.

### Execution Evidence

| Field | What it proves |
|---|---|
| `executionContextHash` | SHA-256 of (pg server version + current_schemas + sanitized connection URL). Proves WHICH database environment was queried. |
| `executionTimestamp` | ISO timestamp of when the query ran. |

**What it does NOT prove:** Full schema snapshot, table-level hash, or data-state attestation. Those would require `pg_dump` or logical replication snapshot, which is not yet implemented.

## Predictive Guardrails

When PostgreSQL is configured, Attestor runs a predictive guardrail preflight using `EXPLAIN (FORMAT JSON)` before executing the actual query.

### Risk Signals

| Signal | Threshold |
|---|---|
| High row volume | >100K rows estimated |
| Critical row volume | >1M rows estimated |
| High query cost | Elevated cost estimate |
| Sequential scans | >2 sequential scans |
| Nested loops | >3 nested loops |

### Actions

| Action | Meaning |
|---|---|
| `proceed` | Low risk. Execute normally. |
| `warn` | Moderate risk. Execute but flag in evidence. |
| `deny` | Critical risk. Refuse execution before it happens. |

When the preflight denies execution, the pipeline runs with `execution: null` — no fake success object, no synthetic results. The denial is truthfully recorded in the evidence.

## Semantic Clauses

Attestor supports machine-checkable analytical obligations that define what the **numbers** must satisfy, not just what the **query** must look like.

| Clause type | What it checks |
|---|---|
| `balance_identity` | net = gross_long - gross_short (additive identity) |
| `control_total` | total equals sum of parts (reconciliation) |
| `ratio_bound` | ratio within acceptable range |
| `sign_constraint` | column values satisfy sign rules (non-negative, positive) |
| `completeness_check` | required columns have no nulls |

Clauses are defined in the query intent, evaluated against actual execution results, and reported in the authority evidence. Hard failures block acceptance; soft failures produce warnings.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ATTESTOR_PG_URL` | (none) | PostgreSQL connection URL |
| `ATTESTOR_PG_TIMEOUT_MS` | 10000 | Query timeout in milliseconds |
| `ATTESTOR_PG_MAX_ROWS` | 10000 | Maximum result rows |
| `ATTESTOR_PG_ALLOWED_SCHEMAS` | (none) | Comma-separated schema allowlist |

## Readiness Check

```bash
npm run start -- doctor
```

The doctor command checks signing key pair, OpenAI API key, and PostgreSQL readiness.

When `ATTESTOR_PG_URL` and `pg` are both present, doctor runs a **bounded connectivity probe**:

| Step | What it checks |
|---|---|
| `config` | `ATTESTOR_PG_URL` is set |
| `driver` | `pg` driver is importable |
| `connect` | Connection opens successfully |
| `version` | `SELECT version()` returns server version |
| `schemas` | `current_schemas(false)` returns schema context |
| `readonly_txn` | `BEGIN TRANSACTION READ ONLY` / `ROLLBACK` works |

The probe is read-only and bounded. It does not inspect user tables, run EXPLAIN, or execute any user SQL.

Each step has independent error handling — failures are attributed to the specific step that failed, not collapsed into a generic error. Failed steps include a **remediation hint** in the doctor output (e.g., check host/credentials for connect failures, check permissions for transaction failures).

When the probe completes successfully, doctor reports: `configured ✓  reachable ✓  read-only safe ✓  ready for prove ✓`

## Artifact Evidence

When a real PostgreSQL-backed proof run occurs, the authority bundle and verification kit carry additional evidence fields:

- `proof.executionProvider`: `'postgres'` (vs null for fixture)
- `proof.executionContextHash`: SHA-256 of (server version + schemas + sanitized URL)
- `proofCompleteness.hasDbContextEvidence`: true when execution context hash is present

These fields make a real DB-backed kit immediately distinguishable from a fixture-based kit without digging into the full report.

## Demo Bootstrap

Attestor includes a bounded demo bootstrap that seeds a deterministic `attestor_demo` schema in PostgreSQL. The first real DB proof run has been completed using this path (PostgreSQL 18.3, real execution, signed certificate, verified kit).

**Self-contained proof:** `npx tsx scripts/real-db-proof.ts` downloads an embedded PostgreSQL binary, starts it, bootstraps the demo schema, runs the full governed proof, and saves verified artifacts. No manual PostgreSQL installation required.

**Bash / macOS / Linux:**
```bash
export ATTESTOR_PG_URL=postgres://user:pass@localhost:5432/mydb
npm install pg
npx tsx src/financial/cli.ts pg-demo-init
export ATTESTOR_PG_ALLOWED_SCHEMAS=attestor_demo
npm run prove -- counterparty
```

**PowerShell (Windows):**
```powershell
$env:ATTESTOR_PG_URL='postgres://user:pass@localhost:5432/mydb'
npm install pg
npx tsx src/financial/cli.ts pg-demo-init
$env:ATTESTOR_PG_ALLOWED_SCHEMAS='attestor_demo'
npm run prove -- counterparty
```

**Teardown (optional):** `npx tsx src/financial/cli.ts pg-demo-teardown`

The `doctor` and `pg-demo-init` commands detect your shell environment and print copy-paste-ready instructions.

The bootstrap creates three tables matching the repo's fixture scenarios:

| Table | Rows | Scenario |
|---|---|---|
| `attestor_demo.counterparty_exposures` | 6 | Counterparty exposure (expected: pass) |
| `attestor_demo.liquidity_buffer` | 3 | Liquidity risk (expected: fail — negative value) |
| `attestor_demo.position_reconciliation` | 3 | Reconciliation (expected: fail — variance sum mismatch) |

**Important boundaries:**
- The bootstrap is the ONLY write operation in Attestor's PostgreSQL integration
- All writes are confined to the `attestor_demo` schema
- The governed proof path remains strictly read-only
- The command is idempotent (DROP IF EXISTS + CREATE)
- This is for reproducible demo/proof setup, not normal runtime behavior
