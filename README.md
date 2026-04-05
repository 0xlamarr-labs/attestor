# Attestor

**Governance and proof engine for AI-assisted high-stakes workflows.**

Attestor is the acceptance layer for AI-assisted decisions. It sits between "the model produced an answer" and "the organization acts on it." Deterministic governance gates, typed authority chains, reviewer-signed endorsements, and cryptographically signed evidence decide what is accepted, held, or denied. Every decision produces portable, independently verifiable proof — no platform access required to check it.

The current reference implementation ships a complete governed pipeline for **bank-grade internal financial analytics** — treasury, risk, reconciliation, and regulatory-reporting workflows. The engine architecture generalizes to any domain where AI output is useful but cannot be accepted raw.

**Models generate. Evidence decides. Proof is portable.**

## The Core Principle

In many industries, AI becomes useful before it becomes admissible. Generated output may be good enough to act on — but there is no evidence trail, no reviewer authority, no proof mode, and no way for an outsider to verify the decision.

The missing layer is not better generation. It is **governed acceptance**: the ability to treat AI output as a proposal and then apply deterministic controls, reviewer authority, and portable evidence before it becomes operational.

Attestor creates this layer:

- **Typed contracts** define what is allowed before anything runs.
- **Deterministic controls** produce evidence independent of the generation step.
- **Authority separation** ensures no component — model or runtime — can approve its own output (warrant → escrow → receipt → capsule).
- **Reviewer escalation** routes high-stakes decisions to human reviewers with Ed25519-signed, run-bound endorsements.
- **Evidence and audit trail** preserve what happened and why, with hash-linked chains.
- **Portable verification** lets anyone verify a decision with only a public key — no platform access, no database, no API call.

This architecture works wherever AI output needs governed acceptance before it becomes operational.

## Why This Exists

AI adoption in high-stakes internal workflows is blocked not because generated output is useless, but because there is no acceptable path from proposal to governed acceptance. Four failures recur:

- **Raw execution.** Generation and acceptance collapse into one step. No governance gate exists.
- **Authority collapse.** Model output is treated as its own approval. No separation between proposing and deciding.
- **Unverifiable acceptance.** Teams cannot show what evidence justified a decision. Acceptance is invisible.
- **Runtime truth drift.** The system claims stronger guarantees than it actually proved. Proof mode is implicit.

Attestor addresses each one with a separate architectural control. The failures are not finance-specific. They appear wherever AI is introduced into decision workflows that carry operational, regulatory, or reputational consequences.

## Where This Pattern Applies

The Attestor engine pattern is relevant anywhere:

- AI output is useful enough to be operationally valuable
- but cannot be accepted raw — it needs contracts, controls, review, and evidence before it becomes authoritative

This includes:

- **Internal financial analytics and reporting** — the current reference implementation
- **Risk and control workflows** — exception reviews, control-gap assessments, threshold breach analysis
- **Regulated operations support** — audit-sensitive internal decisions with traceability requirements
- **Healthcare and life sciences** — internal analytical workflows where clinical or operational AI proposals need governed review before they become actionable
- **Insurance and claims** — internal analytics, reserve estimation, claims-review support where AI can propose but human authority must decide
- **Industrial and supply-chain operations** — quality-control analytics, predictive maintenance decisions, safety-critical assessments
- **Legal and compliance** — internal document review support, contract analysis, regulatory-change impact assessment
- **Public-sector and government** — internal decision-support analytics subject to audit, freedom-of-information, or oversight requirements

The architecture is domain-general. The implementation in this repository is financial-first. Broader domain implementations require domain-specific contracts, semantic clauses, and scoring logic — the governance engine, authority chain, signing, and verification layers are domain-independent.

**Important:** The categories above describe where the engine pattern applies in principle. They are not a claim that domain packs for all of them are already shipped. The current repository implements finance.

## Why Finance Is the First Implementation

Finance is the hardest proving ground. Silent errors are expensive. Auditability is non-optional. Approval authority matters — the wrong person approving the wrong thing is a control failure, not just a quality problem. Regulatory frameworks expect traceable controls, evidence, and reviewer accountability.

If a governance-and-proof engine can work here — where acceptance must be explainable, replayable, and verifiable — it validates the core design under the most demanding conditions. Finance is the strongest proving ground for this pattern, not its permanent boundary.

## What This Repository Implements Today

The repository ships a complete governed financial analytics pipeline as the reference implementation for the engine architecture.

**Governance engine (domain-independent core):**

- Authority chain lifecycle: warrant → escrow → receipt → capsule
- Deterministic scorer cascade with priority short-circuit
- Review policy with materiality-based escalation
- Evidence chain, hash-linked audit trail, provenance
- Ed25519 attestation certificates and 6-dimensional verification kits
- Run-bound reviewer endorsement with independent outsider verification
- Multi-query governed pipeline with portable proof artifacts

**Financial domain implementation (current reference):**

- SQL governance with read/write safety, scope constraints, injection detection
- Policy and least-privilege entitlement checks
- Execution guardrails: row, cost, shape, and join-depth limits
- Data contracts, control totals, and reconciliation break handling
- 5 semantic clause types: `balance_identity`, `control_total`, `ratio_bound`, `sign_constraint`, `completeness_check`
- Filing readiness assessment with structured gap reporting
- OpenLineage-compatible lineage export

**Portable proof and signing:**

- Ed25519 certificates binding authority + evidence + decision
- 6-dimensional verification: cryptographic, structural, authority, governance, proof, reviewer endorsement
- Independent verification CLI — certificate-only or full kit, no platform access required
- Bundle carries execution provider and database context hash for real PostgreSQL proof

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
- Portable proof artifacts: multi-query output pack, dossier, and manifest

## What Attestor Is

Attestor is a **governance and proof engine** for AI-assisted high-stakes workflows — where outputs need contracts, controls, reviewer authority, and verifiable evidence before acceptance.

It is not an AI model, an LLM orchestrator, or a generation engine. It is the acceptance layer: the part between "the model produced an answer" and "the organization acts on it."

Current strongest implementation: internal banking, treasury, risk, and regulatory-reporting analytics.

## What Attestor Is Not

- Not a financial chatbot or AI assistant
- Not a customer-facing decision engine (underwriting, credit scoring, recommendations)
- Not a filing or regulatory submission platform
- Not an LLM orchestrator or prompt engineering framework
- Not a generic BI tool, dashboard system, or enterprise workflow platform
- Not a generic "AI compliance" or "responsible AI" suite
- Not a warehouse-scale distributed control plane (yet)
- Not a claim that AI output is universally trustworthy
- Not a cross-domain enterprise control plane that is already complete — broader domain applicability is architectural truth, not shipped implementation

## How a Governed Run Works

```text
Typed contract        What is this operation allowed to do?
  → Governance        Is the proposal safe, scoped, and aligned with intent?
  → Guardrails        Resource and shape limits enforced before execution
  → Execution         Fixture, local live, or bounded real database
  → Evidence          Data contracts, semantic clauses, audit chain
  → Scoring           Deterministic scorers with priority short-circuit
  → Review            Materiality-based escalation, reviewer endorsement
  → Authority         Warrant → escrow → receipt → capsule
  → Attestation       Ed25519-signed certificate + 6-dimensional verification kit
```

Every run produces a decision (`pass` / `fail` / `block` / `pending_approval`), a full authority chain, a reviewer dossier, and optionally a portable signed certificate that anyone can verify with a public key alone.

## Quick Start

```bash
npm install

# List available scenarios (financial reference implementation)
npm run list

# Run a fixture scenario (no keys, no database required)
npm run scenario -- counterparty

# Check proof readiness (signing keys, database, credentials)
npm run start -- doctor

# Run a product proof with signed certificate + reviewer-verifiable kit
npm run prove -- counterparty

# Run a product proof with persistent signing keys
npm run prove -- counterparty .attestor

# Run a product proof with a separate reviewer key directory
npm run prove -- counterparty .attestor --reviewer-key-dir ./reviewer-keys

# Bootstrap demo PostgreSQL schema for real DB proof
npx tsx src/financial/cli.ts pg-demo-init

# Run a multi-query governed proof (fixed 3-unit demo)
npx tsx src/financial/cli.ts multi-query

# Verify a verification kit (certificate + bundle + reviewer endorsement)
npm run verify:cert -- .attestor/proofs/<run>/kit.json

# Verify a certificate independently (certificate + public key only)
npm run verify:cert -- .attestor/proofs/<run>/certificate.json .attestor/proofs/<run>/public-key.pem

# Generate a persistent signing key pair
npm run keygen

# Run all tests (390 tests)
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

When proof is incomplete, Attestor names the gaps explicitly. Each gap has a category and description. Gaps appear in the dossier, verification summary, and filing readiness assessment. Missing live proof does not deny authority — it changes what can be truthfully claimed about the run.

## Current Implementation Scope

The current repository implements the governance engine pattern for **financial analytics**. This is the most tested, most explicit, most complete domain in the repo.

The engine architecture (typed contracts → deterministic evidence → bounded review → authority closure → portable proof) is domain-independent. To extend Attestor to a new domain, the required work is: domain-specific contracts, domain-specific semantic clauses, domain-appropriate scoring logic, and domain-relevant evidence obligations. The governance engine, authority chain, signing, and verification layers do not change.

## Optional / Bounded Today

**Bounded PostgreSQL proof path:**
Optional read-only PostgreSQL connector for real-database execution evidence. Includes predictive guardrail preflight, schema allowlist enforcement, and a reproducible demo bootstrap (`pg-demo-init`). Doctor runs a bounded connectivity probe with per-step remediation hints.

**Local single-process runtime:**
Attestor runs as a local CLI or programmatic import. No API service layer, no distributed execution, no multi-tenant isolation.

**Reviewer-signed local proof:**
Reviewer endorsements are Ed25519-signed and run-bound. Reviewer identity is operator-asserted, not yet bound to enterprise SSO/LDAP/AD.

**Ephemeral and persistent key modes:**
Ephemeral keys by default for local demonstration. Persistent keys loadable from a directory. No HSM, vault, or external KMS integration yet.

## Not Yet Implemented

- Domain packs beyond finance (architectural possibility, not shipped)
- Domain-specific semantic clause libraries for non-financial workflows
- Differential evidence across multi-query units
- Signing and reviewer authority at the multi-query level
- Warehouse-scale connectors (Snowflake, BigQuery, Databricks)
- Filing or regulatory submission adapters
- Enterprise IAM / SSO / LDAP approval integration
- PKI-backed or CA-chained signing
- Distributed control plane or API service layer
- Multi-tenant entitlement service

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

Attestor supports workflow-bound reviewer authority — a cryptographic proof of WHO approved, WHAT they approved, and WHICH specific run they approved.

**Reviewer identity** captures name, role, and identifier. **Reviewer endorsement** captures the decision, rationale, and review scope. When a reviewer key pair is available, the endorsement is **Ed25519-signed**.

**Run binding** prevents cross-run replay: the endorsement signature covers `runId`, `replayIdentity`, and `evidenceChainTerminal`. The verification kit checks binding equality — a valid endorsement from one run cannot pass verification inside a different run's kit.

**Current boundary:** Reviewer identity is operator-asserted. Not yet bound to enterprise directory services (SSO, LDAP, AD). The cryptographic chain is real; the identity binding to organizational systems is not yet shipped.

## PostgreSQL Product Proof

Attestor includes an optional bounded PostgreSQL connector for real-database execution proof.

**Safety model:** Read-only transactions, statement timeout, row limits, write/stacked-query rejection, schema allowlist enforcement.

**Predictive guardrails:** EXPLAIN-based risk preflight that can deny dangerous queries before they touch data.

**Demo bootstrap:** `pg-demo-init` seeds a deterministic `attestor_demo` schema matching the repo's fixture scenarios for reproducible real-DB proof.

**Evidence:** `executionContextHash` proves which database environment was queried. `executionProvider` and `hasDbContextEvidence` make a real-DB kit immediately distinguishable from a fixture kit.

**What it does NOT prove:** Full schema snapshot, table-level content hash, or data-state attestation.

See [PostgreSQL and connectors](docs/07-connectors/postgres-connectors.md).

## Regulatory Boundary

Attestor supports **control objectives** that map to regulatory and governance frameworks including DORA, BCBS 239, SR 11-7, EU AI Act, and SOX/ICFR. It does **not** by itself certify compliance with any framework. Compliance remains the organization's responsibility. Applicability depends on the deployment context and regulated use case.

See [Regulatory alignment](docs/03-governance/regulatory-alignment.md).

## Documentation

| Document | Content |
|---|---|
| [Purpose and product boundary](docs/01-overview/purpose.md) | What Attestor is, what it solves, what it does not do |
| [System overview](docs/02-architecture/system-overview.md) | Engine architecture, governance capabilities, runtime shape |
| [Regulatory alignment](docs/03-governance/regulatory-alignment.md) | Control mapping, boundaries, framework-level relevance |
| [Authority model](docs/04-authority/authority-model.md) | Warrant → escrow → receipt → capsule lifecycle |
| [Proof model](docs/05-proof/proof-model.md) | Proof modes, Live Proof, Live Readiness, multi-query proof |
| [Signing and verification](docs/06-signing/signing-verification.md) | Ed25519 certificates, verification kit, reviewer endorsement |
| [PostgreSQL and connectors](docs/07-connectors/postgres-connectors.md) | Safety model, predictive guardrails, demo bootstrap |

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
| **Tests** | 390 (358 financial + 32 signing) |
| **License** | Proprietary. All rights reserved. |
