# System Overview

Architecture of Attestor as of April 2026.

Attestor is a governance and proof engine for AI-assisted high-stakes workflows. The engine pattern is domain-independent. The current reference implementation is financial and remains the strongest end-to-end path in the repository.

## Engine Architecture

The engine is built from reusable layers:

- **Typed contracts** constrain what a proposal is allowed to do.
- **Deterministic evidence** records governance, execution, validation, and lineage independent of generation.
- **Scoring and review** translate evidence into governed decisions and reviewer escalation.
- **Authority artifacts** close acceptance through warrant -> escrow -> receipt -> capsule.
- **Portable proof** issues signed verifier-facing artifacts.
- **Live proof** records what was actually observed at runtime.

The engine is reusable across domains. Domain packs provide domain-specific clauses, guardrails, evidence obligations, and semantics.

## Reference Financial Shape

The financial reference path currently includes:

- SQL governance
- policy and entitlement checks
- execution guardrails
- fixture, SQLite, and bounded PostgreSQL execution
- data contracts and reconciliation logic
- semantic clauses
- filing readiness
- signed certificates and verification kits
- reviewer endorsement and authority closure

This is the most complete path in the repository.

## Proof Maturity Boundary

Attestor keeps proof maturity explicit.

**Single-query**

- mature
- signed
- reviewer-verifiable
- outsider-verifiable

**Multi-query**

- signed at the run level
- portable certificate + kit + reviewer endorsement exist
- per-unit and aggregate truth preserved
- still not per-unit certificate issuance

**Real PostgreSQL**

- achieved
- bounded read-only execution
- predictive preflight
- execution context evidence
- reproducible demo bootstrap

## Bounded Service Layer

The repository now ships a real Hono HTTP server. Today it provides:

- `GET /api/v1/health`
- `GET /api/v1/domains`
- `GET /api/v1/connectors`
- `POST /api/v1/pipeline/run`
- `POST /api/v1/verify`

This is a bounded synchronous service layer. It is not yet a distributed control plane, async job system, or multi-tenant platform.

## Domain, Connector, and Filing Breadth

The repository includes more than the financial reference path:

- **Domain packs:** `finance`, `healthcare`
- **Connectors:** PostgreSQL, Snowflake
- **Filing adapters:** XBRL US-GAAP 2024
- **Identity:** operator-asserted reviewer identity plus OIDC verification on the API path
- **Trust chain:** JSON PKI chain module

Current boundary:

- Finance is the most complete end-to-end implementation.
- Healthcare is a pack-first second domain.
- Snowflake is a real connector module, not yet a top-level prove flow.
- XBRL is a real mapping/export adapter, not yet a full filing issuance workflow.
- PKI exists as a module, not yet as the default certificate issuance mode.

## Reviewer Authority

Reviewer authority is cryptographically bound to the run:

- single-query binding: `runId + replayIdentity + evidenceChainTerminal`
- multi-query binding: `runId + multiQueryHash`

Replay across runs is detectable. Reviewer identity can be operator-asserted or OIDC-verified on the API path. Full enterprise IAM flow is not yet shipped.

## Current Boundary

**Shipped**

- Financial reference implementation
- Signed single-query and multi-query proof
- Real PostgreSQL-backed proof path
- Bounded API service
- Domain/connector/filing registries
- Snowflake connector module
- XBRL mapping adapter
- OIDC verification first slice

**Not shipped**

- Broader end-to-end domain implementations beyond finance
- Top-level non-PostgreSQL prove routing
- Filing issuance wired into pipeline/API flows
- Full IAM/session lifecycle
- PKI-integrated default signing
- Distributed service control plane
