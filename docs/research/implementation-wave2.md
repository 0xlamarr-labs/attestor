# Research: Implementation Wave 2 (April 2026)

## OIDC Enterprise Session
- `keyring-node` replaces deprecated `keytar` (Rust-backed, napi-rs)
- openid-client v6: Device Flow + PKCE + refreshTokenGrant()
- Pattern: OS keychain store + auto-refresh + revocation on logout
- Effort: 2-3 days

## PKI Default Verifier
- Cosign transition: v2 opt-in → v3 default → deprecation warning on old path
- Pattern: swap default in verify(), add --legacy-flat-verify escape hatch
- Effort: ~2 days

## Redis-Backed BullMQ Default
- `redis-memory-server` for zero-config local dev (optional dependency)
- 3-tier probe: explicit URL → localhost:6379 → embedded fallback
- Effort: ~2 days

## PostgreSQL RLS Tenant Isolation
- Drizzle ORM: native pgPolicy() + .enableRLS()
- Per-request: set_config('app.tenant_id', $1, true) + RESET ALL on release
- FORCE ROW LEVEL SECURITY for safety net
- Effort: 2-3 days

## Unified Schema Attestation
- Same INFORMATION_SCHEMA.COLUMNS query works on both PG and Snowflake
- Provider pattern: SchemaAttestationProvider interface
- Pre-execution hook in connector execute() path
- Effort: 2-3 days

## Distributed Deployment
- Railway: 4 services (API + Worker + PG + Redis)
- docker-compose.yml for local dev
- Health check: /health with db + redis probes
- Effort: 1-2 days

## Healthcare eCQM Measures
Top 3 measures by impact:
1. CMS165v12 — Controlling High Blood Pressure (simplest, largest population)
2. CMS122v12 — Diabetes HbA1c Poor Control (inverse numerator)
3. CMS130v12 — Colorectal Cancer Screening (multi-pathway)
- FHIR MeasureReport output for dQM compatibility
- QRDA Category III XML for legacy reporting
- Effort: 5-7 days total
