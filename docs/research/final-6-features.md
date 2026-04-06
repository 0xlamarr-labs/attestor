# Research: Final 6 Features (April 2026)

## 1. OIDC + OS Keychain
- Package: `@napi-rs/keyring` (v1.1.x, Rust-backed, Windows+macOS+Linux)
- `keytar` fully deprecated (Atom sunset)
- openid-client v6: `tokenRevocation()` for logout
- Effort: 1-2 days | Risk: native binary matrix in CI

## 2. PKI Mandatory Verify
- Built-in `node:crypto` — no new deps
- Pattern: reject flat Ed25519 by default, `--allow-legacy-verify` escape
- Embed trust root as .pem in package
- Effort: 0.5-1 day | Risk: breaking existing users

## 3. Redis Unconditional Default
- `redis-memory-server`: real Redis binary, works with BullMQ
- Windows: Memurai, macOS/Linux: redis-server binary
- `ioredis-mock` does NOT work with BullMQ (Lua/blocking commands fail)
- 3-tier: REDIS_URL → embedded → reject
- Effort: 1 day | Risk: first-run download latency

## 4. PostgreSQL RLS Auto-Activation
- `CREATE POLICY` has NO `IF NOT EXISTS` — check pg_policies first
- `DROP POLICY IF EXISTS` + `CREATE POLICY` pattern
- Verify via `pg_policies` catalog view
- Connection user must be table owner
- Effort: 0.5 day | Risk: limited-privilege connection role

## 5. Distributed (Railway)
- Same repo, multiple services (different start commands)
- Private networking: `<service>.railway.internal`
- Minimum: API + Worker + shared Redis/PG
- Effort: 1-2 days | Risk: same-project networking constraint

## 6. QRDA III Healthcare
- NO npm package for QRDA III — only Ruby gem (cqm-reports)
- Must hand-build XML with `xmlbuilder2`
- CMS validates: XML Schema + Schematron rules (annual)
- 200-400 lines XML per document
- Effort: 2-4 WEEKS | Risk: annual IG churn, no Node.js library
