# Attestor

**Governance and proof engine for AI-assisted high-stakes workflows.**

AI output becomes economically useful before it becomes operationally admissible. Attestor closes that gap. It governs the boundary between proposal and acceptance with typed contracts, deterministic controls, reviewer authority, and portable proof.

The repository's deepest implementation is financial: bank-grade internal reporting, treasury, risk, reconciliation, and regulatory analytics. The engine pattern is broader than finance. The current codebase is not.

## The Acceptance Problem

Raw AI output is hard to admit into consequence-bearing workflows for four recurring reasons:

- Generation and acceptance collapse into one act.
- Authority is implicit instead of explicit.
- Evidence is scattered or absent.
- The system implies stronger proof than it actually produced.

Attestor addresses those failures with governed acceptance:

- Typed contracts bound what is allowed before execution.
- Deterministic controls produce evidence independent of generation.
- Review policy and authority artifacts prevent self-approval.
- Signed certificates and verification kits make acceptance portable.

## Where This Engine Applies

The pattern matters wherever AI output is useful but cannot be accepted raw:

- Financial analytics and reporting
- Risk and control operations
- Healthcare analytics and quality review
- Insurance and claims support
- Industrial and supply-chain operations
- Legal and compliance review
- Public-sector and government decision support

Those categories describe architectural fit, not shipped breadth. The repository currently ships finance as the reference implementation and a smaller healthcare pack as a second domain slice.

## Why Finance Is First

Finance is the hardest proving ground: silent errors are expensive, auditability is mandatory, reviewer authority matters, and control failures are legible. If the engine works there, the architecture has passed a demanding test.

Finance is the proving ground. Not the ceiling.

## Proof Maturity Today

Attestor does not blur proof maturity across tracks.

**Single-query governed proof**

- Ed25519-signed certificates
- 6-dimensional verification kits
- Run-bound reviewer endorsements
- Real PostgreSQL-backed proof path
- Independent verification CLI

**Multi-query governed proof**

- Multi-query pipeline with aggregate governance
- Signed run-level multi-query certificates
- Multi-query verification kits
- Run-bound multi-query reviewer endorsements
- Differential evidence for multi-run comparison
- Portable output pack, dossier, and manifest

**Real PostgreSQL proof**

- Real bounded execution
- Predictive guardrail preflight
- Reproducible demo bootstrap
- Self-contained proof script
- Schema/data-state attestation capture in the Postgres prove path
- Reviewer-verifiable proof artifacts

## What Ships in This Repository

**Engine core**

- Authority chain: warrant -> escrow -> receipt -> capsule
- Deterministic scorer cascade with priority short-circuit
- Evidence chain, provenance, and hash-linked audit trail
- Ed25519 signing and certificate verification
- Keyless-first API signing with short-lived CA-issued certificates
- JSON-based PKI trust chain module with API-path issuance and chain verification
- Reviewer identity, endorsement, and run binding
- Single-query and multi-query certificate issuance
- Differential evidence for multi-query comparison

**Reference financial implementation**

- SQL governance and entitlement checks
- Execution guardrails
- Data contracts and reconciliation logic
- Five semantic clause types
- Filing readiness assessment
- PostgreSQL proof path and demo bootstrap

**Expansion modules already present**

- Domain pack registry with `finance` and `healthcare`
- Connector registry with PostgreSQL and Snowflake modules
- Filing adapter registry with XBRL US-GAAP 2024 and xBRL-CSV EBA DPM 2.0 adapters
- Bounded HTTP API server with sync and async first-slice routes
- OIDC reviewer identity verification on the API path, plus OS keychain-backed session management (`@napi-rs/keyring` native keychain with encrypted-file fallback) + device flow in the CLI proof path
- BullMQ/Redis async orchestration with 3-tier auto-resolution (`REDIS_URL` → localhost:6379 → embedded Redis), in-process fallback when all Redis tiers unavailable

## What Attestor Is

Attestor is the acceptance layer for AI-assisted high-stakes workflows.

It does not generate the answer. It governs whether the answer may be accepted, how that acceptance is evidenced, who may endorse it, and what a third party can verify afterward.

## What Attestor Is Not

- Not a financial chatbot
- Not an LLM orchestration framework
- Not a BI dashboard
- Not a customer-facing automated decision engine
- Not a regulatory submission platform
- Not a fully general enterprise control plane
- Not proof that AI is inherently trustworthy

## How a Governed Run Works

```text
proposal
  -> typed contract
  -> governance and guardrails
  -> bounded execution
  -> deterministic evidence
  -> scoring and review
  -> authority closure
  -> portable proof
```

Every run yields a governed decision and evidence-bearing artifacts. Mature proof paths additionally yield signed certificates and verification kits.

## Quick Start

```bash
npm install

# List financial reference scenarios
npm run list

# Fixture run (no keys, no database)
npm run scenario -- counterparty

# Check signing / model / database readiness
npm run start -- doctor

# Signed single-query proof
npm run prove -- counterparty

# Signed single-query proof with persistent runtime keys
npm run prove -- counterparty .attestor

# Signed single-query proof with a separate reviewer key
npm run prove -- counterparty .attestor --reviewer-key-dir ./reviewer-keys

# Reproducible real PostgreSQL-backed proof
npx tsx scripts/real-db-proof.ts

# Multi-query signed proof
npx tsx src/financial/cli.ts multi-query

# Verify a kit
npm run verify:cert -- .attestor/proofs/<run>/kit.json

# Verify a certificate only
npm run verify:cert -- .attestor/proofs/<run>/certificate.json .attestor/proofs/<run>/public-key.pem

# Core unit suites
npm test

# Core verification gate
npm run verify

# Expanded verification surface
npm run verify:full

# Additional live / integration suites
npx tsx tests/live-api.test.ts
npx tsx tests/live-postgres.test.ts
npx tsx tests/connectors-and-filing.test.ts
npx tsx tests/control-plane-backup.test.ts
npx tsx tests/live-snowflake.test.ts
```

Notes:

- `npm test` runs the core financial + signing suites.
- `tests/live-snowflake.test.ts` is env-gated and opt-in.
- `scripts/real-db-proof.ts` performs real PostgreSQL execution against an embedded instance and emits signed artifacts.

## Bounded Service Layer

The repository ships a split API/worker service topology:

- **API server** (`npm run serve`) — HTTP endpoints, synchronous pipeline, verification, filing
- **Pipeline worker** (`npm run worker`) — standalone BullMQ consumer for async jobs

API endpoints:

- `GET /api/v1/health` — detailed system state (PKI, RLS, async backend)
- `GET /api/v1/ready` — orchestrator readiness probe (200 when ready, 503 when not)
- `GET /api/v1/domains`
- `GET /api/v1/connectors`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/account`
- `GET /api/v1/account/usage`
- `POST /api/v1/account/users/bootstrap`
- `GET /api/v1/account/users`
- `POST /api/v1/account/users`
- `POST /api/v1/account/users/:id/deactivate`
- `POST /api/v1/account/users/:id/reactivate`
- `POST /api/v1/account/billing/checkout` (`Idempotency-Key` required)
- `POST /api/v1/account/billing/portal`
- `GET /api/v1/account/billing/export` (`format=json|csv`)
- `GET /api/v1/admin/accounts`
- `POST /api/v1/admin/accounts`
- `GET /api/v1/admin/accounts/:id/billing/export` (`format=json|csv`)
- `POST /api/v1/admin/accounts/:id/billing/stripe`
- `POST /api/v1/admin/accounts/:id/suspend`
- `POST /api/v1/admin/accounts/:id/reactivate`
- `POST /api/v1/admin/accounts/:id/archive`
- `GET /api/v1/admin/plans`
- `GET /api/v1/admin/audit`
- `GET /api/v1/admin/queue`
- `GET /api/v1/admin/queue/dlq`
- `POST /api/v1/admin/queue/jobs/:id/retry`
- `GET /api/v1/admin/billing/events`
- `GET /api/v1/admin/metrics`
- `GET /api/v1/admin/tenant-keys`
- `POST /api/v1/admin/tenant-keys`
- `POST /api/v1/admin/tenant-keys/:id/rotate`
- `POST /api/v1/admin/tenant-keys/:id/deactivate`
- `POST /api/v1/admin/tenant-keys/:id/reactivate`
- `POST /api/v1/admin/tenant-keys/:id/revoke`
- `GET /api/v1/admin/usage`
- `POST /api/v1/billing/stripe/webhook`
- `POST /api/v1/pipeline/run`
- `POST /api/v1/pipeline/run-async`
- `GET /api/v1/pipeline/status/:jobId`
- `POST /api/v1/verify`
- `POST /api/v1/filing/export`

This is a bounded service layer, not a distributed control plane.

Current service capabilities:
- Split API/worker deployment via `docker-compose.yml` (separate `api` and `worker` services sharing Redis)
- 3-tier Redis auto-resolution: `REDIS_URL` → localhost:6379 → embedded `redis-memory-server` → in-process fallback
- Readiness probe (`/api/v1/ready`) checking async backend, PKI, domains, and Redis state
- SIGTERM graceful shutdown in both API server and worker (connection drain before exit)
- Plan-aware tenant rate limiting on pipeline routes with `429` + `Retry-After` and per-plan runtime defaults
- Async queue hardening first slice: bounded BullMQ retry/backoff, exact paginated tenant-aware pending-job caps, admin queue summary/DLQ inspection, and manual failed-job retry
- Structured observability first slice: W3C `traceparent`/trace-id response headers on API routes, Prometheus-text metrics at `GET /api/v1/admin/metrics`, and optional JSONL request logging via `ATTESTOR_OBSERVABILITY_LOG_PATH`
- Request-level tenant isolation via `ATTESTOR_TENANT_KEYS` or the current hosted tenant-key store, plus overlap-capped key rotation (`rotate` -> `deactivate/reactivate` -> `revoke`), plan-aware tenant rate limiting on pipeline routes, and admin account/tenant provisioning behind `ATTESTOR_ADMIN_API_KEY`, with database-level RLS auto-activated when `ATTESTOR_PG_URL` set
- PKI-backed signing with certificate-to-leaf chain verification
- XBRL filing export auto-summary in signed pipeline responses
- OIDC reviewer identity verification on the API path
- Connector routing (e.g., `connector: 'snowflake'` in pipeline/run)

Current service boundaries:
- Single-node API + worker split (no multi-instance horizontal scaling or load balancer)
- In-process async fallback when all Redis tiers unavailable (jobs lost on restart)
- No persistent long-term job result store, queue-group isolation, or external/shared dead-letter system beyond BullMQ's failed-job set
- No external log/metrics collector, OTLP exporter, or full distributed trace backend yet

## Reviewer Authority

Reviewer authority is cryptographic, not cosmetic.

- Endorsements can be Ed25519-signed.
- Single-query endorsements bind to `runId + replayIdentity + evidenceChainTerminal`.
- Multi-query endorsements bind to `runId + multiQueryHash`.
- Replay across runs is detectable and rejected.

Identity truth today:

- Operator-asserted reviewer identity is supported everywhere.
- OIDC-verified reviewer identity is supported on the API path.
- CLI prove path supports OIDC device flow with keychain-backed session management (OS keychain via `@napi-rs/keyring` when available, encrypted-file fallback otherwise; cached → refresh → interactive fallback).
- Token lifecycle: OS keychain or encrypted local store (AES-256-GCM) with expiry checking and refresh-token support.
- Full enterprise IAM/session management is not shipped.

## Connectors and Domain Breadth

The repository is broader than finance in architecture, but not equally deep in every path.

- Finance is the most complete domain and the reference implementation.
- Healthcare has a domain pack, real clause evaluators, eCQM measure evaluation, and a governed E2E scenario library (readmission rates, small cell suppression, temporal consistency).
- PostgreSQL is the reference live execution connector with schema/data-state attestation.
- Snowflake is a real connector module with env-gated live testing, API connector routing, and CLI `prove --connector snowflake` support.
- XBRL US-GAAP 2024 and xBRL-CSV EBA DPM 2.0 are real filing adapters; US-GAAP is used for API export and signed auto-summary, while xBRL-CSV EBA is registered in the filing export surface.

## PostgreSQL Product Proof

Real PostgreSQL-backed proof is already part of the repository's working surface.

- Bounded read-only execution
- EXPLAIN-based predictive guardrails
- Demo bootstrap via `pg-demo-init`
- Self-contained proof run via `scripts/real-db-proof.ts`
- Execution provider and execution-context evidence in bundle and kit
- Schema/data-state attestation: schema fingerprint, sentinel data, attestation hash in the Postgres prove path
- API responses distinguish `schema_attestation_full`, `schema_attestation_connector`, and `execution_context_only` evidence scopes

What it does not prove yet:

- Full verifier-facing schema attestation surfaced uniformly across every API connector path
- Table-level content hashing
- Historical data-state attestation comparison across time

## Current Capability Maturity

**Shipped product paths** (integrated, tested, reachable through CLI/API):
- Keyless-first signing in API (Sigstore pattern, per-request ephemeral keys + CA-issued certs)
- PKI chain verification as **mandatory** across CLI and API. CLI: exit code 2 without chain (`--allow-legacy-verify` escape). API: 422 rejection without chain (`ATTESTOR_ALLOW_LEGACY_API=true` escape). `VerificationKit` now self-contains `trustChain` + `caPublicKeyPem`.
- Secure encrypted token store (AES-256-GCM) as default OIDC persistence for both read and write. Plaintext cache is not read by default. Legacy import: `ATTESTOR_PLAINTEXT_TOKEN_IMPORT=1` (one-time). Plaintext write: `ATTESTOR_PLAINTEXT_TOKEN_FALLBACK=1` (opt-in).
- xBRL US-GAAP 2024 + xBRL-CSV EBA DPM 2.0 adapters registered in API filing export
- Healthcare CLI: governed E2E scenarios + clause evaluators + CMS top-3 eCQM measures (CMS165/CMS122/CMS130) + FHIR MeasureReport (R4 schema-validated) + QRDA III generation with 5-tier local/runtime validation all passing zero errors (structural self-validation + CMS IG XPath + real CMS 2026 Schematron + Cypress-equivalent Layers 2-6), plus live VSAC Layer 7 expansion (11/11 curated targets) and real ONC Cypress zero-error validation on the demo service
- Snowflake schema attestation captured in connector execute path and surfaced through `ConnectorExecutionResult.schemaAttestation`
- Redis async backend with 3-tier auto-resolution (`REDIS_URL` → localhost:6379 → embedded Redis → in-process fallback). BullMQ active when any Redis tier resolves.
- Split API/worker deployment (single-node first slice): `npm run serve` (API) + `npm run worker` (BullMQ pipeline worker), `docker-compose.yml` with separate api and worker services, `/api/v1/ready` readiness probe, SIGTERM graceful shutdown. Not horizontal multi-node — see Capability modules.

**First slices** (real, wired into runtime paths, but not fully productized):
- Filing: evidence obligation in warrant, auto-summary in signed API response, not yet full filing-package issuance by default
- Hosted API shell: built-in hosted plan catalog (`community`, `starter`, `pro`, `enterprise`) + API-key tenant plans + monthly pipeline-run quota enforcement + plan-aware tenant rate limiting on expensive pipeline routes + `/api/v1/account`, `/api/v1/account/usage`, and `/api/v1/account/billing/export` hosted-customer endpoints. When `ATTESTOR_CONTROL_PLANE_PG_URL` is set, hosted account state, tenant keys, usage, admin audit, admin idempotency replay, and Stripe webhook dedupe all move onto a shared PostgreSQL-backed control-plane first slice; otherwise they fall back to local single-node files. `/api/v1/account` surfaces the current Stripe-backed checkout and invoice summary for the hosted account, while `/api/v1/account/billing/export` can return JSON or CSV using live Stripe invoice/charge listing when available and shared-ledger/mock-summary fallbacks otherwise.
- Customer auth / RBAC first slice: hosted customer access now supports account users plus opaque server-side sessions with role boundaries (`account_admin`, `billing_admin`, `read_only`). `POST /api/v1/account/users/bootstrap` creates the first `account_admin` from an initial tenant API key, `POST /api/v1/auth/login|logout` + `GET /api/v1/auth/me` provide cookie/header-backed session auth, and `/api/v1/account/users*` manages users under `account_admin` authorization. In shared-control-plane mode, account users and sessions move into PostgreSQL alongside the rest of the hosted control-plane. Boundary: one account membership per email, built-in `scrypt` password hashing, no invites/password reset/MFA/SSO yet.
- Tenant onboarding CLI: `npm run tenant:keys -- plans|issue|list|rotate|deactivate|reactivate|revoke` manages hosted tenant keys through the current control-plane backend. Built-in plans resolve default quotas centrally; keys are hashed at rest and plaintext is only shown once on issuance.
- Account provisioning store: hosted account registry with one primary tenant per account, explicit `active/suspended/archived` lifecycle, and Stripe billing summary in this first slice (subscription status, last checkout completion, last invoice outcome). Storage is local file-backed by default and shared PostgreSQL-backed when `ATTESTOR_CONTROL_PLANE_PG_URL` is configured. The same shared PG first slice now also covers hosted account users and opaque customer sessions.
- Admin account API: `GET/POST /api/v1/admin/accounts` creates a hosted customer record and issues the first tenant API key in one operator call. `GET /api/v1/admin/accounts/:id/billing/export` returns JSON/CSV billing export for one hosted account, and `POST /api/v1/admin/accounts/:id/billing/stripe|suspend|reactivate|archive` adds operator billing attachment and account lifecycle controls. Hosted operator provisioning defaults to the `starter` plan unless overridden.
- Admin plan catalog API: `GET /api/v1/admin/plans` returns the built-in hosted plan catalog, the current default provisioning plan, the active pipeline rate-limit window/defaults, the per-plan async pending-job caps, and whether each plan has a Stripe price configured.
- Admin tenant management API: `GET/POST /api/v1/admin/tenant-keys` plus `POST /api/v1/admin/tenant-keys/:id/rotate|deactivate|reactivate|revoke` behind `ATTESTOR_ADMIN_API_KEY`. Built-in plan ids are validated server-side so operator typos cannot silently create the wrong quota boundary, and active overlap is capped to two keys per tenant by default.
- Admin mutation idempotency: account create, Stripe billing attach, account suspend/reactivate/archive, tenant key issue, rotate, deactivate, reactivate, and revoke accept `Idempotency-Key` for safe operator retries. Replay payloads stay encrypted at rest using a key derived from `ATTESTOR_ADMIN_API_KEY`, and now persist in the shared PostgreSQL control-plane when `ATTESTOR_CONTROL_PLANE_PG_URL` is configured.
- Admin audit ledger: `GET /api/v1/admin/audit` exposes a tamper-evident, hash-linked log of hosted operator mutations plus Stripe-applied billing reconciliations (`account.created`, `account.billing.attached`, `account.suspended`, `account.reactivated`, `account.archived`, `async_job.retried`, `billing.stripe.webhook_applied`, `tenant_key.*`). In shared-control-plane mode this ledger is serialized into PostgreSQL with a transaction-scoped append lock; otherwise it stays file-backed.
- Admin billing event API: `GET /api/v1/admin/billing/events` exposes the shared PostgreSQL-backed billing event ledger when `ATTESTOR_BILLING_LEDGER_PG_URL` is configured, with account/tenant/event filters and deduplicated Stripe subscription, checkout-completion, and invoice lifecycle history.
- Admin usage reporting API: `GET /api/v1/admin/usage` returns tenant-level monthly usage from the current control-plane ledger, with optional `tenantId` / `period` filtering and best-effort tenant metadata enrichment.
- Control-plane backup / restore first slice: `npm run backup:control-plane` creates a logical snapshot of the hosted control-plane, including shared PostgreSQL-backed account/tenant/usage/admin-audit state when `ATTESTOR_CONTROL_PLANE_PG_URL` is configured, plus the shared PostgreSQL billing event ledger when `ATTESTOR_BILLING_LEDGER_PG_URL` is configured. Ephemeral idempotency/webhook stores can be included explicitly for DR drills, restore verifies snapshot checksums before writing, and admin audit snapshots with a broken hash chain are rejected instead of being imported. This is still a logical snapshot path, not PostgreSQL PITR or Redis queue recovery.
- Control-plane backup / restore first slice: `npm run backup:control-plane` creates a logical snapshot of the hosted control-plane, including shared PostgreSQL-backed account/tenant/usage/admin-audit/account-user/account-session state when `ATTESTOR_CONTROL_PLANE_PG_URL` is configured, plus the shared PostgreSQL billing event ledger when `ATTESTOR_BILLING_LEDGER_PG_URL` is configured. Ephemeral idempotency/webhook stores can be included explicitly for DR drills, restore verifies snapshot checksums before writing, and admin audit snapshots with a broken hash chain are rejected instead of being imported. This is still a logical snapshot path, not PostgreSQL PITR or Redis queue recovery.
- Stripe reconciliation first slice: `POST /api/v1/billing/stripe/webhook` verifies Stripe signatures, de-duplicates by `event.id`, reconciles hosted account billing state from `customer.subscription.*`, `checkout.session.completed`, `invoice.paid`, and `invoice.payment_failed`, and suspends/reactivates account access based on subscription status. When `ATTESTOR_CONTROL_PLANE_PG_URL` is set, duplicate suppression moves onto a shared PostgreSQL claim/finalize path with advisory-lock guarded processing instead of the local processed-event file; when `ATTESTOR_BILLING_LEDGER_PG_URL` is set, the same route also claims and finalizes events in the shared PostgreSQL billing ledger. This now persists checkout-completion and last-invoice summary truth, and backs hosted billing export with shared event history, but it is still not a full internal invoice line-item or entitlement ledger.
- Customer-facing Stripe entrypoints: `POST /api/v1/account/billing/checkout` creates a Stripe Checkout subscription session for a selected hosted plan using env-mapped Stripe prices and a required `Idempotency-Key`, `POST /api/v1/account/billing/portal` opens the Stripe Billing Portal for the current hosted account, and `GET /api/v1/account/billing/export` returns customer-visible billing export in JSON or CSV. In runtime, `customer.subscription.*`, `checkout.session.completed`, and invoice webhooks sync Stripe billing truth back into Attestor hosted account and tenant state.
- PKI: mandatory across CLI and API public surfaces. `verifyCertificate()` low-level primitive remains flat Ed25519 (intentional — no PKI awareness at function level). Legacy escape via env var, not silent acceptance.
- Async: BullMQ with split worker process, bounded retry/backoff, exact paginated tenant-aware per-tenant pending-job caps on async submit, admin queue/DLQ introspection (`GET /api/v1/admin/queue`, `GET /api/v1/admin/queue/dlq`) and manual failed-job retry (`POST /api/v1/admin/queue/jobs/:id/retry`). In-process fallback remains explicit when Redis unavailable. No BullMQ Pro queue groups, distributed/shared rate limiting, or broader scheduling policy yet.
- Request-level tenant isolation: middleware active on all tenant routes, enforced when `ATTESTOR_TENANT_KEYS` or the current hosted tenant key store is configured; optional plan/quota metadata and rate-limit context now propagate into API responses. Admin routes are separately protected by `ATTESTOR_ADMIN_API_KEY`.
- OIDC session: keychain-session wired into CLI prove, `@napi-rs/keyring` installed (OS keychain on Windows/macOS/Linux, encrypted-file fallback when native unavailable). Not enterprise central session management.
- Redis async: 3-tier auto-resolution wired into API startup, `redis-memory-server` installed. Tiers: REDIS_URL → localhost:6379 → embedded Redis → in_process fallback. Embedded is dev/CI only.
- DB-level RLS: auto-activation called on startup when ATTESTOR_PG_URL set, health endpoint shows live activation status
- QRDA III: CMS-compatible XML generation with 5-tier runtime validation all passing zero errors: structural self-validation (16 checks) + CMS IG XPath assertions (29 rules via SaxonJS) + real CMS 2026 Schematron (vendored .sch via `cda-schematron-validator`) + Cypress-equivalent validators (Layers 2-6: Measure ID, Performance Rate recalculation, Population Logic, Program, Measure Period). Live closure is now proven for the current CMS165/CMS122/CMS130 demo slice: VSAC Layer 7 expands all 11 curated targets via the official VSAC FHIR API, and ONC Cypress accepts the generated QRDA III with zero execution errors.
- FHIR MeasureReport: schema-validated at runtime in healthcare CLI via `@solarahealth/fhir-r4` (Zod). Structural JSON Schema validation only, not terminology bindings or FHIRPath conformance.

**Capability modules** (code exists, not yet fully productized):
- Horizontal multi-node scaling (current: single-node API + worker split, no load balancer or multi-instance coordination)

## Output Artifacts

| Artifact | Purpose |
|---|---|
| `dossier` | Reviewer-facing decision packet |
| `output pack` | Machine-readable run summary |
| `manifest` | Artifact inventory and evidence anchors |
| `attestation` | Canonical evidence pack |
| `certificate` | Signed portable proof |
| `verification kit` | Verifier-facing package |
| `audit trail` | Ordered evidence log |
| `reviewer-public.pem` | Reviewer verification material |

## Documentation

| Document | Content |
|---|---|
| [Purpose and boundary](docs/01-overview/purpose.md) | Engine identity and non-claims |
| [System overview](docs/02-architecture/system-overview.md) | Engine architecture and current boundaries |
| [Regulatory alignment](docs/03-governance/regulatory-alignment.md) | Control-objective mapping |
| [Authority model](docs/04-authority/authority-model.md) | Warrant -> escrow -> receipt -> capsule |
| [Proof model](docs/05-proof/proof-model.md) | Proof modes, maturity, and multi-query proof |
| [Signing and verification](docs/06-signing/signing-verification.md) | Certificates, kits, reviewer endorsements |
| [PostgreSQL and connectors](docs/07-connectors/postgres-connectors.md) | PostgreSQL proof path and connector safety |
| [Deployment](docs/08-deployment/deployment.md) | Service topology, container usage, health/readiness |
| [Backup, restore, and DR](docs/08-deployment/backup-restore-dr.md) | Logical control-plane snapshot, restore flow, and DR drill |

## Environment Variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Live model proof |
| `ATTESTOR_PG_URL` | PostgreSQL connection URL |
| `ATTESTOR_PG_TIMEOUT_MS` | PostgreSQL timeout override |
| `ATTESTOR_PG_MAX_ROWS` | PostgreSQL row limit override |
| `ATTESTOR_PG_ALLOWED_SCHEMAS` | PostgreSQL schema allowlist |
| `SNOWFLAKE_ACCOUNT` | Snowflake live connector test |
| `SNOWFLAKE_USERNAME` | Snowflake live connector test |
| `SNOWFLAKE_PASSWORD` | Snowflake live connector test |
| `SNOWFLAKE_WAREHOUSE` | Snowflake warehouse override |
| `OIDC_ISSUER_URL` | OIDC identity provider URL for reviewer identity |
| `OIDC_CLIENT_ID` | OIDC client ID for device flow |
| `ATTESTOR_TENANT_KEYS` | Tenant API keys with optional plan/quota metadata (`key:id:name[:plan][:quota],...`) for request-level isolation and hosted quota enforcement |
| `ATTESTOR_ACCOUNT_STORE_PATH` | Optional path for the file-backed hosted account registry used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ACCOUNT_USER_STORE_PATH` | Optional path for the file-backed hosted account user registry used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ACCOUNT_SESSION_STORE_PATH` | Optional path for the file-backed hosted account session store used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_TENANT_KEY_STORE_PATH` | Optional path for the file-backed tenant key store used by `npm run tenant:keys` and hosted API key lookup when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_TENANT_KEY_MAX_ACTIVE_PER_TENANT` | Optional max active hosted API keys per tenant during overlap / cutover (default `2`) |
| `ATTESTOR_USAGE_LEDGER_PATH` | Optional path for the file-backed hosted usage ledger used by quota enforcement and `/api/v1/account/usage` when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_SESSION_COOKIE_NAME` | Optional cookie name for hosted customer sessions (default `attestor_session`) |
| `ATTESTOR_SESSION_TTL_HOURS` | Optional hosted session TTL in hours (default `12`) |
| `ATTESTOR_SESSION_COOKIE_SECURE` | Set `true` to mark hosted session cookies as `Secure` |
| `ATTESTOR_RATE_LIMIT_WINDOW_SECONDS` | Optional tenant pipeline rate-limit window size in seconds (default `60`) |
| `ATTESTOR_RATE_LIMIT_<PLAN>_REQUESTS` | Optional per-plan pipeline request ceiling for the current window (`COMMUNITY`, `STARTER`, `PRO`, `ENTERPRISE`) |
| `ATTESTOR_ASYNC_PENDING_<PLAN>_JOBS` | Optional per-plan pending async-job cap override used for tenant-aware BullMQ submit fairness (`COMMUNITY`, `STARTER`, `PRO`, `ENTERPRISE`) |
| `ATTESTOR_ASYNC_ATTEMPTS` | Optional BullMQ retry-attempt ceiling for async jobs (default `3`) |
| `ATTESTOR_ASYNC_BACKOFF_MS` | Optional BullMQ exponential backoff base delay in milliseconds (default `1000`) |
| `ATTESTOR_ASYNC_MAX_STALLED_COUNT` | Optional BullMQ stalled-job recovery ceiling before failing a job (default `1`) |
| `ATTESTOR_ASYNC_WORKER_CONCURRENCY` | Optional worker concurrency for BullMQ async processing (default `1`) |
| `ATTESTOR_ASYNC_JOB_TTL_SECONDS` | Optional completed-job retention in BullMQ (default `3600`) |
| `ATTESTOR_ASYNC_FAILED_TTL_SECONDS` | Optional failed-job / DLQ retention in BullMQ (default `86400`) |
| `ATTESTOR_ASYNC_TENANT_SCAN_LIMIT` | Optional BullMQ page size used by exact per-tenant async pending-job inspection (default `200`) |
| `ATTESTOR_ADMIN_API_KEY` | Admin API key for hosted operator endpoints: accounts, plan catalog, audit, billing events, tenant key lifecycle management, and usage reporting |
| `ATTESTOR_CONTROL_PLANE_PG_URL` | Optional PostgreSQL connection URL for the shared hosted control-plane first slice (accounts, tenant keys, usage, admin audit, admin idempotency replay, Stripe webhook dedupe) |
| `ATTESTOR_ADMIN_AUDIT_LOG_PATH` | Optional path for the file-backed admin mutation ledger used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH` | Optional path for the file-backed encrypted admin idempotency replay store used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ADMIN_IDEMPOTENCY_TTL_HOURS` | Optional retention window for encrypted admin replay payloads (default `24`) |
| `ATTESTOR_BILLING_LEDGER_PG_URL` | Optional PostgreSQL connection URL for the shared Stripe billing event ledger used by `/api/v1/admin/billing/events` and cross-node webhook dedupe |
| `ATTESTOR_OBSERVABILITY_LOG_PATH` | Optional JSONL path for structured API request logs with trace correlation and tenant/account context |
| `STRIPE_API_KEY` | Stripe secret API key for hosted Checkout and Billing Portal session creation |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret for `POST /api/v1/billing/stripe/webhook` |
| `ATTESTOR_STRIPE_PRICE_STARTER` | Stripe recurring price id for the hosted `starter` plan |
| `ATTESTOR_STRIPE_PRICE_PRO` | Stripe recurring price id for the hosted `pro` plan |
| `ATTESTOR_STRIPE_PRICE_ENTERPRISE` | Stripe recurring price id for the hosted `enterprise` plan |
| `ATTESTOR_BILLING_SUCCESS_URL` | Hosted return URL for successful Stripe Checkout sessions |
| `ATTESTOR_BILLING_CANCEL_URL` | Hosted return URL for canceled Stripe Checkout sessions |
| `ATTESTOR_BILLING_PORTAL_RETURN_URL` | Hosted return URL for Stripe Billing Portal sessions |
| `ATTESTOR_STRIPE_WEBHOOK_STORE_PATH` | Optional path for the file-backed processed-event ledger used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_STRIPE_USE_MOCK` | Set `true` only in local/test environments to return deterministic mock Checkout/Portal sessions without hitting Stripe |
| `REDIS_URL` | Redis URL for BullMQ async backend |
| `ATTESTOR_ALLOW_LEGACY_API` | Set `true` to allow flat Ed25519 at `/api/v1/verify` (deprecated) |
| `CYPRESS_EMAIL` | Cypress demo account email for ONC Cypress API validation |
| `CYPRESS_PASSWORD` | Cypress demo account password for ONC Cypress API validation |
| `CYPRESS_UMLS_USER` | Legacy fallback env name for `CYPRESS_EMAIL` |
| `CYPRESS_UMLS_PASS` | Legacy fallback env name for `CYPRESS_PASSWORD` |
| `VSAC_UMLS_API_KEY` | UMLS API key for the official VSAC FHIR Layer 7 expansion path |
| `UMLS_API_KEY` | Fallback env name for the VSAC UMLS API key |
| `ATTESTOR_VSAC_MANIFEST_URL` | Optional VSAC manifest URL for `$expand` requests (default `http://cts.nlm.nih.gov/fhir/Library/latest-active`) |
| `VSAC_FHIR_BASE_URL` | Optional override for the VSAC FHIR base URL (default `https://cts.nlm.nih.gov/fhir`) |

## Project Status

| Field | Value |
|---|---|
| Version | 0.1.0 |
| Runtime | Node.js 22+, TypeScript, split API + worker CLI + bounded HTTP API |
| Core verification gate | 557 tests (`npm test`: 461 financial + 96 signing) |
| Expanded verification surface | 1301 tests across 10 suites: 557 unit + 431 live API + 43 live PostgreSQL + 38 connector/filing + 98 healthcare E2E + 31 control-plane backup/restore + 37 control-plane backup/restore shared PG + 60 live shared control-plane PG + 3 live Cypress connectivity + 3 live VSAC connectivity, plus env-gated live Snowflake and full ONC/VSAC credential runs |
| Scripts | `npm run verify` (safe local) and `npm run verify:full` (safe local + live/integration suites) |
| License | UNLICENSED / private |
