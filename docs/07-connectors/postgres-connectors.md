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

The doctor command checks: signing key pair, OpenAI API key, PostgreSQL connectivity, and reports which proof modes are ready.
