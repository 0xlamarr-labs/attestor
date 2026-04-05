# Attestor

**Governance and proof runtime for AI-assisted high-stakes workflows.**

Attestor separates generation from acceptance. Models or operators can propose — but proposals are not authority. Deterministic governance gates, typed authority chains, reviewer-signed endorsements, and cryptographically signed evidence decide what is accepted, held, or denied. Every decision produces portable, independently verifiable proof. No platform access required to check it.

The current reference implementation targets **bank-grade internal financial analytics**: treasury, risk, reconciliation, and regulatory-reporting workflows. The architecture generalizes to any domain where AI output is useful but cannot be accepted raw.

**Models generate. Evidence decides. Proof is portable.**

## The Core Principle

Generation and acceptance are different acts. A model can generate a useful answer before it can be trusted to authorize that answer. The missing layer in most AI-assisted workflows is not better generation — it is **governed acceptance**.

Attestor creates the acceptance layer:

- **Bounded generation.** Typed contracts define what is allowed before anything runs.
- **Deterministic controls.** SQL governance, execution guardrails, data contracts, and semantic clauses produce evidence independent of the generation step.
- **Authority separation.** A warrant → escrow → receipt → capsule chain ensures no component — model or runtime — can approve its own output.
- **Reviewer escalation.** Materiality-based escalation policies route high-stakes decisions to human reviewers with Ed25519-signed, run-bound endorsements.
- **Evidence and audit trail.** Hash-linked audit chains, provenance records, and lineage preserve what happened and why.
- **Portable verification.** Ed25519-signed certificates and 6-dimensional verification kits let anyone verify a decision with only a public key.

This architecture works anywhere AI output needs governed acceptance before it becomes operational.

## Why This Exists

AI adoption in high-stakes internal workflows is often blocked not because generated output is useless, but because there is no acceptable path from proposal to governed acceptance. The output might be good enough to act on — but there is no evidence trail, no reviewer authority, no proof mode, and no way for an outsider to verify the decision.

Attestor exists to close that gap. Four failures recur across domains:

- **Raw prompt execution.** Generation and acceptance collapse into one step. No governance gate exists.
- **Authority collapse.** Model output is treated as its own approval. No separation between proposing and deciding.
- **Unverifiable acceptance.** Teams cannot show what evidence justified a decision. Acceptance is invisible.
- **Runtime truth drift.** The system claims stronger guarantees than it actually proved. Proof mode is implicit.

Attestor addresses each one with a separate architectural control.

## Where This Pattern Applies

The Attestor pattern is relevant anywhere:

- AI output is useful enough to be operationally valuable
- but cannot be accepted raw — it needs contracts, controls, review, and evidence before it becomes authoritative

This includes, in principle:

- **Internal financial analytics and reporting** — the current reference implementation
- **Internal risk and control workflows** — exception reviews, control-gap assessments, threshold breach analysis
- **Regulated operations support** — audit-sensitive internal decisions with traceability requirements
- **High-stakes internal analytical workflows** — where AI can propose but must not self-authorize

The architecture is domain-general. The implementation in this repository is financial-first. Broader domain packs are not yet shipped — they are architectural possibility, not current repository truth.

## Why Finance Is the First Implementation

Finance is a hard proving ground. Silent errors are expensive. Auditability is not optional. Approval authority matters — the wrong person approving the wrong thing is a control failure, not just a quality problem. Regulatory frameworks expect traceable controls, evidence, and reviewer accountability.

If the governance-and-proof architecture can work under these conditions — where acceptance must be explainable, replayable, and verifiable — it validates the core design under demanding requirements. Finance is the strongest proving ground for this pattern, not its permanent boundary.

## What This Repository Implements Today

The repository ships a complete governed financial analytics pipeline. This is the current beachhead:

**Core governance runtime (financial analytics):**

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
- Independent verification CLI — certificate-only or full kit, no platform access required
- Bundle proof carries execution provider and database context hash when backed by real PostgreSQL

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

## What Attestor Is

Attestor is a **governance + proof runtime** for AI-assisted high-stakes analytical and operational workflows — where outputs need contracts, controls, reviewer authority, and verifiable evidence before acceptance.

It is not an AI model, an LLM orchestrator, or a generation engine. It is the acceptance layer: the part that sits between "the model produced an answer" and "the organization acts on it."

Best fit today: internal banking, treasury, risk, and regulatory-reporting analytics where acceptance must be explainable, replayable, and verifiable.

## What Attestor Is Not

- Not a customer-facing decision engine (underwriting, credit scoring, recommendations)
- Not a filing or regulatory submission platform
- Not an LLM orchestrator or prompt engineering framework
- Not a generic BI tool, dashboard system, or enterprise workflow platform
- Not a warehouse-scale distributed control plane (yet)
- Not a claim that AI output is universally trustworthy
- Not a domain-agnostic enterprise control plane that is already complete — broader domain applicability is architectural truth, not shipped implementation

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

# Run a multi-query governed proof (fixed 3-unit demo)
npx tsx src/financial/cli.ts multi-query

# Verify a verification kit (certificate + bundle + reviewer endorsement)
npm run verify:cert -- .attestor/proofs/<run>/kit.json

# Verify a certificate independently (certificate + public key only)
npm run verify:cert -- .attestor/proofs/<run>/certificate.json .attestor/proofs/<run>/public-key.pem

# Generate a persistent signing key pair
npm run keygen

# Run all tests (353 tests)
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

## Current Implementation Scope

The current repository implements the governance-and-proof architecture for **financial analytics**. This is the most tested, most explicit, most complete domain in the repo.

The domain-general architecture (typed contracts → deterministic evidence → bounded review → authority closure → portable proof) can support other high-stakes internal workflows. That is architectural truth. It is not a claim that non-financial domain packs are already shipped.

To extend Attestor to a new domain, the required work includes: domain-specific contracts, domain-specific semantic clauses, domain-appropriate scoring logic, and domain-relevant evidence obligations. The governance runtime, authority chain, signing, and verification layers are domain-independent.

## Optional / Bounded Today

**Bounded PostgreSQL proof path:**
Optional read-only PostgreSQL connector for real-database execution evidence. Requires `npm install pg` + `ATTESTOR_PG_URL`. Includes predictive guardrail preflight (EXPLAIN-based risk assessment that can deny dangerous queries before they touch data). Schema allowlist enforcement when configured. The `prove` CLI explicitly reports whether execution used real PostgreSQL or fell back to fixtures, and why. Doctor runs a bounded connectivity probe when PostgreSQL is configured.

**Local single-process runtime:**
Attestor runs as a local CLI or programmatic import. No API service layer, no distributed execution, no multi-tenant isolation. This is the current deployment boundary.

**Reviewer-signed local proof:**
Reviewer endorsements are Ed25519-signed and run-bound. The `prove` path generates an ephemeral reviewer key pair by default, or loads persistent keys from a directory. Reviewer identity is not yet bound to enterprise SSO/LDAP/AD — it is operator-asserted.

**Ephemeral and persistent key modes:**
The `prove` path generates ephemeral signing and reviewer keys by default for local demonstration. Persistent keys can be loaded from a directory. No HSM, vault, or external key management integration exists yet.

## Not Yet Implemented

- Generalized domain packs beyond finance (architectural possibility, not shipped)
- Domain-specific semantic clause libraries for non-financial workflows
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

**What the evidence proves:** `executionContextHash` (SHA-256 of pg server version + schemas + sanitized URL) proves WHICH database environment was queried. `executionTimestamp` records WHEN. The authority bundle and verification kit carry `executionProvider` and `executionContextHash`, making a real-DB kit immediately distinguishable from a fixture kit.

**What it does NOT prove:** Full schema snapshot, table-level content hash, or data-state attestation. Those would require `pg_dump` or logical replication snapshots, which are not yet implemented.

**Operator path:** Run `npm run start -- doctor` to check PostgreSQL readiness with a bounded connectivity probe. The `prove` CLI explicitly reports the proof source after every run: `REAL PostgreSQL execution (N rows, Xms)` or `offline fixture (reason)`.

**Next milestone:** The first real Postgres-backed outsider-verifiable proof run. The governance, signing, and verification chain is complete. The remaining step is a configured PostgreSQL instance with real data.

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
| **Tests** | 353 (321 financial + 32 signing) |
| **License** | Proprietary. All rights reserved. |
