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
- Request-level tenant isolation via `ATTESTOR_TENANT_KEYS`, database-level RLS auto-activated when `ATTESTOR_PG_URL` set
- PKI-backed signing with certificate-to-leaf chain verification
- XBRL filing export auto-summary in signed pipeline responses
- OIDC reviewer identity verification on the API path
- Connector routing (e.g., `connector: 'snowflake'` in pipeline/run)

Current service boundaries:
- Single-node API + worker split (no multi-instance horizontal scaling or load balancer)
- In-process async fallback when all Redis tiers unavailable (jobs lost on restart)
- No persistent long-term job store, job priority, or dead-letter queue
- No centralized logging, metrics, or tracing

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
- Healthcare CLI: governed E2E scenarios + clause evaluators + CMS top-3 eCQM measures (CMS165/CMS122/CMS130) + FHIR MeasureReport (R4 schema-validated) + QRDA III generation with 5-tier validation (structural self-validation + CMS IG XPath + real CMS 2026 Schematron + Cypress-equivalent Layers 2-6), all passing with zero errors
- Snowflake schema attestation captured in connector execute path and surfaced through `ConnectorExecutionResult.schemaAttestation`
- Redis async backend with 3-tier auto-resolution (`REDIS_URL` → localhost:6379 → embedded Redis → in-process fallback). BullMQ active when any Redis tier resolves.
- Split API/worker deployment (single-node first slice): `npm run serve` (API) + `npm run worker` (BullMQ pipeline worker), `docker-compose.yml` with separate api and worker services, `/api/v1/ready` readiness probe, SIGTERM graceful shutdown. Not horizontal multi-node — see Capability modules.

**First slices** (real, wired into runtime paths, but not fully productized):
- Filing: evidence obligation in warrant, auto-summary in signed API response, not yet full filing-package issuance by default
- PKI: mandatory across CLI and API public surfaces. `verifyCertificate()` low-level primitive remains flat Ed25519 (intentional — no PKI awareness at function level). Legacy escape via env var, not silent acceptance.
- Async: BullMQ with split worker process, in-process fallback when Redis unavailable. No job priority, rate limiting, or dead-letter queue.
- Request-level tenant isolation: middleware active on all API routes, enforced when ATTESTOR_TENANT_KEYS set
- OIDC session: keychain-session wired into CLI prove, `@napi-rs/keyring` installed (OS keychain on Windows/macOS/Linux, encrypted-file fallback when native unavailable). Not enterprise central session management.
- Redis async: 3-tier auto-resolution wired into API startup, `redis-memory-server` installed. Tiers: REDIS_URL → localhost:6379 → embedded Redis → in_process fallback. Embedded is dev/CI only.
- DB-level RLS: auto-activation called on startup when ATTESTOR_PG_URL set, health endpoint shows live activation status
- QRDA III: CMS-compatible XML generation with 5-tier runtime validation all passing zero errors: structural self-validation (16 checks) + CMS IG XPath assertions (29 rules via SaxonJS) + real CMS 2026 Schematron (vendored .sch via `cda-schematron-validator`) + Cypress-equivalent validators (Layers 2-6: Measure ID, Performance Rate recalculation, Population Logic, Program, Measure Period). Layer 7 (VSAC value set) not included — requires NLM credentials.
- FHIR MeasureReport: schema-validated at runtime in healthcare CLI via `@solarahealth/fhir-r4` (Zod). Structural JSON Schema validation only, not terminology bindings or FHIRPath conformance.

**Capability modules** (code exists, not yet fully productized):
- Horizontal multi-node scaling (current: single-node API + worker split, no load balancer or multi-instance coordination)

## Not Yet Implemented

- ONC Cypress live-credential validation (current: Cypress API client is wired into the healthcare CLI and connectivity proof shows `cypressdemo.healthit.gov` is reachable and enforcing auth. Remaining closure work is twofold: run the real ONC validation path with working `CYPRESS_UMLS_USER` + `CYPRESS_UMLS_PASS` credentials, and decide or implement Layer 7 VSAC value set coverage, which is still absent and UMLS-gated. A zero-error ONC run would materially reduce the gap, but this item is not fully closed until the live run and the VSAC boundary are explicitly resolved.)

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
| `ATTESTOR_TENANT_KEYS` | Tenant API keys (`key:id:name,...`) for request-level isolation |
| `REDIS_URL` | Redis URL for BullMQ async backend |
| `ATTESTOR_ALLOW_LEGACY_API` | Set `true` to allow flat Ed25519 at `/api/v1/verify` (deprecated) |
| `CYPRESS_UMLS_USER` | UMLS username for ONC Cypress API validation (free from uts.nlm.nih.gov) |
| `CYPRESS_UMLS_PASS` | UMLS password for ONC Cypress API validation |

## Project Status

| Field | Value |
|---|---|
| Version | 0.1.0 |
| Runtime | Node.js 22+, TypeScript, split API + worker CLI + bounded HTTP API |
| Core verification gate | 557 tests (`npm test`: 461 financial + 96 signing) |
| Expanded verification surface | 834 tests across 7 suites: 557 unit + 102 live API + 43 live PostgreSQL + 38 connector/filing + 91 healthcare E2E + 3 live Cypress connectivity, plus env-gated live Snowflake and Cypress full validation |
| Scripts | `npm run verify` (safe local) and `npm run verify:full` (safe local + live/integration suites) |
| License | UNLICENSED / private |
