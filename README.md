# Attestor

**Attested analytics runtime for bank-grade internal financial reporting.**

Attestor is a governance-and-proof runtime for financial analytical decisions. It separates generation from acceptance: models or operators propose candidate financial logic, and deterministic governance gates, authority artifacts, and cryptographically signed evidence decide what is accepted, held, or denied. Every decision produces portable, independently verifiable proof — no platform access required to check it.

**Models generate. Evidence decides. Proof is portable.**

## Why This Exists

AI-assisted financial analytics fail in four predictable ways. Attestor exists to prevent all four:

- **Raw prompt execution.** Generation and acceptance collapse into one step. Attestor enforces typed contracts, SQL governance, and execution guardrails before anything runs.
- **Authority collapse.** Model output is treated as its own approval authority. Attestor interposes an explicit warrant → escrow → receipt → capsule chain so no component can approve its own work.
- **Unverifiable acceptance.** Teams cannot show what evidence justified a decision. Attestor produces a reviewer-facing dossier, hash-linked audit trail, and Ed25519-signed attestation certificate for every run.
- **Runtime truth drift.** The repo or operator claims stronger guarantees than the runtime actually proved. Attestor labels every run with its real proof mode and explicit proof gaps — it will not claim live execution when it ran fixtures.

## What Attestor Is

Attestor is a **governance + proof runtime** for internal financial analytical decisions — the kind that appear in treasury, risk, reconciliation, regulatory reporting, and internal control workflows.

It governs AI-generated SQL before execution. It produces deterministic evidence that is separate from the generation step. It issues Ed25519-signed certificates that bind authority state, governance results, and execution evidence into a single portable proof. And it supports reviewer-signed endorsements that are cryptographically bound to the specific run they approved.

Best fit today: internal banking, treasury, risk, and regulatory-reporting analytics where acceptance must be explainable, replayable, and verifiable.

## What It Is Not

- Not a customer-facing decision engine (underwriting, credit scoring, recommendations)
- Not a filing or regulatory submission platform
- Not an LLM orchestrator or prompt engineering framework
- Not a generic BI tool, dashboard system, or enterprise workflow platform
- Not a warehouse-scale distributed control plane (yet)
- Not a claim that model output constitutes approval authority

## How a Governed Run Works

```text
Query contract        What is this query allowed to do?
  → SQL governance    Is the SQL safe, scoped, and aligned with intent?
  → Guardrails        Row/cost/shape limits enforced before execution
  → Execution         SQLite fixture, local live SQLite, or bounded PostgreSQL
  → Evidence          Data contracts, control totals, semantic clauses, audit chain
  → Scoring           8 deterministic scorers with priority short-circuit
  → Review            Materiality-based escalation, reviewer endorsement
  → Authority         Warrant → escrow → receipt → capsule
  → Attestation       Ed25519-signed certificate + 6-dimensional verification kit
```

Every run produces a decision (`pass` / `fail` / `block` / `pending_approval`), a full authority chain, a reviewer dossier, and optionally a portable signed certificate that anyone can verify with a public key alone.

## Quick Start

```bash
npm install

# List available scenarios
npm run list

# Run a fixture scenario (no keys, no database required)
npm run scenario -- counterparty

# Check product proof readiness (signing keys, database, credentials)
npm run start -- doctor

# Run a product proof with signed certificate + reviewer-verifiable kit
npm run prove -- counterparty

# Run a product proof with persistent signing keys
npm run prove -- counterparty .attestor

# Run a product proof with a separate reviewer key directory
npm run prove -- counterparty .attestor --reviewer-key-dir ./reviewer-keys

# Verify a verification kit (certificate + bundle + reviewer endorsement)
npm run verify:cert -- .attestor/proofs/<run>/kit.json

# Verify a certificate independently (certificate + public key only)
npm run verify:cert -- .attestor/proofs/<run>/certificate.json .attestor/proofs/<run>/public-key.pem

# Generate a persistent signing key pair
npm run keygen

# Run all tests (348 tests)
npm test

# Full verification (typecheck + test + build)
npm run verify
```

No API key or database is required for fixture scenarios. PostgreSQL proof requires `npm install pg` + `ATTESTOR_PG_URL`. Live model proof requires `OPENAI_API_KEY`.

## Proof Modes

Every run is labeled with its actual proof mode. Attestor will not imply stronger guarantees than the runtime really proved.

| Mode | What it means |
|---|---|
| `offline_fixture` | All inputs are pre-defined fixture data. No live observation. |
| `live_model` | Real model generation (e.g., OpenAI GPT) with fixture or local execution. |
| `live_runtime` | Real database execution (SQLite or PostgreSQL). |
| `hybrid` | Some components live, others fixture or mocked. |

When proof is incomplete, Attestor names the gaps explicitly. Each gap has a category (`upstream`, `execution`, `schema_snapshot`, `lineage`) and a description. Gaps appear in the dossier, verification summary, and filing readiness assessment. Missing live proof does not deny authority — it changes what can be truthfully claimed about the run.

## What Is Implemented Today

**Core governance runtime:**

- Authority chain lifecycle: warrant → escrow → receipt → capsule
- SQL governance with read/write safety, scope constraints, injection detection
- Policy and least-privilege entitlement checks
- Execution guardrails: row, cost, shape, and join-depth limits
- Data contracts, control totals, and reconciliation break handling
- 5 semantic clause types: `balance_identity`, `control_total`, `ratio_bound`, `sign_constraint`, `completeness_check`
- 8-scorer deterministic cascade with priority short-circuit
- Review policy with materiality-based escalation (low / medium / high)
- Evidence chain, hash-linked audit trail, provenance, OpenLineage export
- Filing readiness assessment with structured gap reporting

**Portable proof and signing:**

- Ed25519 attestation certificates binding authority + evidence + decision
- 6-dimensional verification kit: cryptographic, structural, authority, governance, proof, reviewer endorsement
- Independent verification CLI (certificate-only or full kit, no platform access required)

**Reviewer authority:**

- Workflow-bound reviewer identity (name, role, identifier)
- Ed25519-signed reviewer endorsements
- Run-bound endorsement: signature covers runId + replayIdentity + evidenceChainTerminal
- Kit-level binding check: mismatched endorsements are detected and rejected
- Reviewer public key included in verification kit for independent outsider verification

**Multi-query pipeline** (programmatic API + CLI demo):

- N governed query units within a single reporting run
- Per-unit governance, evidence, and decision preserved
- Conservative worst-case aggregate decision
- Per-unit blocker attribution and proof-mode aggregation
- Portable proof artifacts: multi-query output pack, dossier, and manifest
- CLI demo: `npx tsx src/financial/cli.ts multi-query`

## What Is Optional / Bounded Today

**Bounded PostgreSQL proof path:**
Optional read-only PostgreSQL connector for real-database execution evidence. Requires `npm install pg` + `ATTESTOR_PG_URL`. Includes predictive guardrail preflight (EXPLAIN-based risk assessment that can deny dangerous queries before they touch data). Schema allowlist enforcement when configured. The `prove` CLI explicitly reports whether execution used real PostgreSQL or fell back to fixtures, and why.

**Local single-process runtime:**
Attestor runs as a local CLI or programmatic import. No API service layer, no distributed execution, no multi-tenant isolation. This is the current deployment boundary.

**Reviewer-signed local proof:**
Reviewer endorsements are Ed25519-signed and run-bound. The `prove` path generates an ephemeral reviewer key pair by default, or loads persistent keys from a directory. Reviewer identity is not yet bound to enterprise SSO/LDAP/AD — it is operator-asserted.

**Ephemeral and persistent key modes:**
The `prove` path generates ephemeral signing and reviewer keys by default for local demonstration. Persistent keys can be loaded from a directory. No HSM, vault, or external key management integration exists yet.

## What Is Not Yet Implemented

- First real Postgres-backed outsider-verifiable proof run (the next operational milestone)
- Differential evidence across multi-query units
- Signing and reviewer authority at the multi-query level
- Warehouse-scale connectors (Snowflake, BigQuery, Databricks)
- Filing or regulatory submission adapters
- Enterprise IAM / SSO / LDAP approval integration
- PKI-backed or CA-chained signing
- Distributed control plane or API service layer
- Multi-tenant entitlement service
- Per-unit certificate issuance

## Output Artifacts

Every governed run can produce:

| Artifact | Purpose |
|---|---|
| **Decision dossier** | Reviewer packet: readiness, breaks, policy, guardrails, authority, proof |
| **Output pack** | Machine-readable run summary with oversight and evidence |
| **Manifest** | Artifact inventory and run-anchor hashes |
| **Attestation** | Canonical evidence pack with chain linkage |
| **Certificate** | Ed25519-signed portable proof: authority + evidence + decision |
| **Verification kit** | Self-contained package: certificate + bundle + reviewer endorsement + 6-dimensional summary |
| **Audit trail** | Ordered event log with evidence hashes |
| **Reviewer public key** | Reviewer's Ed25519 public key for independent endorsement verification |

These artifacts are designed to agree with each other and to remain truthful about what the runtime actually proved.

## Reviewer Authority

Attestor supports workflow-bound reviewer authority — not just a status flag, but a cryptographic proof of WHO approved, WHAT they approved, and WHICH specific run they approved.

**Reviewer identity** captures the reviewer's name, organizational role, and unique identifier. **Reviewer endorsement** captures the decision they saw, their rationale, and the scope of what they reviewed. When a reviewer key pair is available, the endorsement is **Ed25519-signed**.

**Run binding** prevents cross-run replay: the endorsement signature covers the specific `runId`, `replayIdentity`, and `evidenceChainTerminal`. The verification kit checks binding equality — a valid endorsement from one run cannot pass verification inside a different run's kit.

The `prove` CLI includes the reviewer's public key in the saved kit, so an outsider can independently verify the reviewer endorsement without any platform access.

**Current boundary:** Reviewer identity is operator-asserted. It is not yet bound to enterprise directory services (SSO, LDAP, AD). The cryptographic chain is real; the identity binding to organizational systems is not yet shipped.

## PostgreSQL Product Proof

Attestor includes an optional bounded PostgreSQL connector for real-database execution proof.

**Safety model:** Read-only transactions enforced per-query. Statement timeout and row limits enforced. Write and stacked-query rejection before execution. Schema allowlist enforcement when configured (all table references must be fully qualified).

**Predictive guardrails:** Before execution, `EXPLAIN (FORMAT JSON)` runs a risk preflight. The system detects high row volume, excessive cost, sequential scans, and nested loops. Critical-risk queries are denied before they touch data — the pipeline falls back to fixture with the denial recorded in evidence.

**What the evidence proves:** `executionContextHash` (SHA-256 of pg server version + schemas + sanitized URL) proves WHICH database environment was queried. `executionTimestamp` records WHEN.

**What it does NOT prove:** Full schema snapshot, table-level content hash, or data-state attestation. Those would require `pg_dump` or logical replication snapshots, which are not yet implemented.

**Operator path:** Run `npm run start -- doctor` to check PostgreSQL readiness. The `prove` CLI explicitly reports the proof source after every run: `REAL PostgreSQL execution (N rows, Xms)` or `offline fixture (reason)`.

**Next milestone:** The first real Postgres-backed outsider-verifiable proof run. The governance, signing, and verification chain is complete. The remaining step is a configured PostgreSQL instance with real financial data.

## Regulatory Boundary

Attestor supports **control objectives** that map to financial regulatory and governance frameworks: DORA, BCBS 239, SR 11-7, EU AI Act, and SOX/ICFR.

It does **not** by itself certify compliance with any framework. Compliance remains the organization's responsibility. Attestor provides the engineering substrate — traceability, evidence, authority closure, and runtime truth — that these frameworks expect. Applicability depends on the deployment context, operating model, and the actual regulated use case.

See [Regulatory alignment](docs/03-governance/regulatory-alignment.md).

## Documentation

| Document | Content |
|---|---|
| [Purpose and product boundary](docs/01-overview/purpose.md) | What Attestor is, what it solves, what it does not do |
| [System overview](docs/02-architecture/system-overview.md) | Architecture, governance capabilities, runtime shape |
| [Regulatory alignment](docs/03-governance/regulatory-alignment.md) | Control mapping, boundaries, framework-level relevance |
| [Authority model](docs/04-authority/authority-model.md) | Warrant → escrow → receipt → capsule lifecycle |
| [Proof model](docs/05-proof/proof-model.md) | Proof modes, Live Proof, Live Readiness, multi-query proof |
| [Signing and verification](docs/06-signing/signing-verification.md) | Ed25519 certificates, verification kit, reviewer endorsement |
| [PostgreSQL and connectors](docs/07-connectors/postgres-connectors.md) | Safety model, predictive guardrails, semantic clauses |

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
| **Tests** | 348 (316 financial + 32 signing) |
| **License** | Proprietary. All rights reserved. |
