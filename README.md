# Attestor

**Governed financial execution runtime for AI-assisted analytics.**

Attestor separates generation from acceptance. Models or operators propose candidate financial logic; deterministic governance gates, authority artifacts, and reviewer-facing evidence decide what is accepted, held, or denied. The runtime produces portable, independently verifiable proof of every decision.

**Models generate, evidence decides.**

## Why This Exists

AI-assisted financial analytics workflows fail in four predictable ways:

| Failure | What goes wrong | Attestor response |
|---|---|---|
| **Raw prompt execution** | Generation and acceptance collapse into one step | Typed contracts, SQL governance, execution guardrails |
| **Authority collapse** | Model output is treated as its own approval | Explicit warrant → escrow → receipt → capsule chain |
| **Unverifiable acceptance** | No evidence trail for what justified a decision | Reviewer-facing dossier, audit chain, signed attestation |
| **Runtime truth drift** | Claims outrun what the runtime actually proved | Live Proof with explicit gaps and proof-mode labeling |

## How a Governed Run Works

```text
Query contract        What is allowed
  → SQL governance    Is this query safe and in scope?
  → Guardrails        Row/cost/shape limits before execution
  → Execution         SQLite fixture or bounded PostgreSQL
  → Evidence          Data contracts, control totals, audit chain
  → Scoring           8 deterministic scorers, priority short-circuit
  → Review            Escalation policy, reviewer endorsement
  → Authority         Warrant → escrow → receipt → capsule
  → Attestation       Ed25519-signed certificate + verification kit
```

A single run produces: a decision (`pass` / `fail` / `block` / `pending_approval`), an authority chain, a reviewer dossier, and optionally a portable signed certificate that anyone can verify with a public key alone.

## Quick Start

```bash
npm install

# List available scenarios
npm run list

# Run a fixture scenario
npm run scenario -- counterparty

# Run a product proof (signed certificate + verification kit)
npm run prove -- counterparty

# Verify a certificate independently
npm run verify:cert -- .attestor/proofs/<run>/kit.json

# Run tests (276 tests)
npm test

# Full verification (typecheck + test + build)
npm run verify
```

No API key or database is required for fixture scenarios. PostgreSQL proof requires `npm install pg` + `ATTESTOR_PG_URL`. Live model proof requires `OPENAI_API_KEY`.

## What Is Implemented Today

| Capability | Status |
|---|---|
| Authority chain (warrant → escrow → receipt → capsule) | Implemented |
| SQL governance, policy enforcement, execution guardrails | Implemented |
| Data contracts, control totals, semantic clauses | Implemented |
| Evidence chain, audit trail, provenance, lineage | Implemented |
| 8-scorer deterministic cascade with priority short-circuit | Implemented |
| Review policy with materiality-based escalation | Implemented |
| Reviewer endorsement with Ed25519 signing and run binding | Implemented |
| Portable attestation certificates (Ed25519) | Implemented |
| 6-dimensional verification kit | Implemented |
| Bounded PostgreSQL proof with predictive guardrails | Implemented |
| Multi-query governed pipeline (N units, aggregate decision) | Implemented |
| Filing readiness assessment | Implemented |
| Offline fixture, local SQLite, and hybrid proof modes | Implemented |

### Not Implemented

- Differential evidence across multi-query units
- Warehouse-scale connectors (Snowflake, BigQuery, Databricks)
- Filing submission adapters
- Enterprise IAM / SSO / LDAP approval integration
- Distributed control plane or API service layer
- PKI-backed or CA-chained signing
- Multi-tenant entitlement service

Attestor is an implemented financial reference runtime, not yet a finished enterprise platform.

## Trust, Proof, and Boundaries

### Authority model

Every financial operation follows a strict lifecycle: **warrant → escrow → receipt → capsule**. Authority artifacts answer what was authorized. This is separate from runtime proof, which answers what was actually observed. See [Authority model](docs/04-authority/authority-model.md).

### Proof model

Attestor labels every run with its actual proof mode: `offline_fixture`, `live_model`, `live_runtime`, or `hybrid`. Missing live proof does not deny authority — it changes what can be truthfully claimed. See [Proof model](docs/05-proof/proof-model.md).

### Regulatory boundary

Attestor supports **control objectives** that map to DORA, BCBS 239, SR 11-7, EU AI Act, and SOX/ICFR. It does **not** by itself certify compliance with any framework. Applicability depends on deployment context. See [Regulatory alignment](docs/03-governance/regulatory-alignment.md).

## Output Artifacts

Every governed run can produce:

| Artifact | What it is for |
|---|---|
| **Decision dossier** | Reviewer packet: readiness, breaks, policy, guardrails, authority, proof |
| **Output pack** | Machine-readable run summary with oversight and evidence |
| **Manifest** | Artifact inventory and run-anchor hashes |
| **Attestation** | Canonical evidence pack with chain linkage |
| **Certificate** | Ed25519-signed portable proof: authority + evidence + decision |
| **Verification kit** | Self-contained package: certificate + bundle + reviewer endorsement + summary |
| **Audit trail** | Ordered event log with evidence hashes |

These artifacts are designed to agree with each other and to remain truthful about what the runtime actually proved. See [Signing and verification](docs/06-signing/signing-verification.md).

## Documentation

| Doc | Audience | Content |
|---|---|---|
| [Purpose and product boundary](docs/01-overview/purpose.md) | Evaluators, leadership | What Attestor is, what problem it solves, what it does not do |
| [System overview](docs/02-architecture/system-overview.md) | Engineers, integrators | Architecture, governance capabilities, runtime shape |
| [Regulatory alignment](docs/03-governance/regulatory-alignment.md) | Controllers, compliance | Control mapping, boundaries, framework-level relevance |
| [Authority model](docs/04-authority/authority-model.md) | Engineers, reviewers | Warrant → escrow → receipt → capsule lifecycle |
| [Proof model](docs/05-proof/proof-model.md) | Engineers, reviewers | Proof modes, Live Proof, Live Readiness, gap semantics |
| [Signing and verification](docs/06-signing/signing-verification.md) | Engineers, operators | Ed25519 certificates, verification kit, reviewer endorsement |
| [PostgreSQL and connectors](docs/07-connectors/postgres-connectors.md) | Operators, engineers | Postgres safety model, predictive guardrails, semantic clauses |

## Environment Variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Enables live model proof (AI-generated SQL) |
| `ATTESTOR_PG_URL` | PostgreSQL connection URL for real database proof |
| `ATTESTOR_PG_TIMEOUT_MS` | Query timeout in ms (default: 10000) |
| `ATTESTOR_PG_MAX_ROWS` | Maximum result rows (default: 10000) |
| `ATTESTOR_PG_ALLOWED_SCHEMAS` | Comma-separated schema allowlist |

Offline fixture mode works without any API key or database.

## Project Status

| | |
|---|---|
| **Version** | 0.1.0 |
| **Runtime** | Node.js 22+, TypeScript, local single-process |
| **Tests** | 276 (244 financial + 32 signing) |
| **License** | Proprietary. All rights reserved. |
