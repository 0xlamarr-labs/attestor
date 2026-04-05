# Attestor

**Governance and proof engine for AI-assisted high-stakes decisions.**

AI output becomes economically useful before it becomes operationally admissible. Attestor closes that gap. It enforces governed acceptance — typed contracts, deterministic controls, authority separation, reviewer-bound endorsement, and cryptographically signed portable proof — so that AI-assisted outputs can enter consequence-bearing workflows without surrendering control, auditability, or verifiability.

The single-query governed proof path is mature: Ed25519-signed certificates, 6-dimensional verification kits, and run-bound reviewer endorsements are issued, portable, and independently verifiable. The multi-query path ships a first-slice portable artifact layer — per-unit and aggregate truth preserved — but does not yet carry the same signed certificate and kit completeness. That boundary is precise and intentional.

The reference implementation targets **bank-grade internal financial analytics**. The engine architecture is domain-independent.

## The Acceptance Problem

Raw AI output is not admissible in high-consequence environments. Not because it is always wrong — but because there is no governed path from proposal to acceptance. No evidence trail. No authority separation. No reviewer record. No proof an outsider can check.

Four failures recur wherever AI enters consequence-sensitive workflows:

**Raw execution.** Generation and acceptance collapse into one act. No governance gate separates proposing from deciding.

**Authority collapse.** Model output is treated as its own approval. The boundary between generation and authorization disappears.

**Invisible acceptance.** The organization cannot show what evidence justified the decision. Acceptance is an event with no artifact.

**Truth drift.** The system implies stronger guarantees than it actually proved. Proof mode is implicit or absent.

These are not finance-specific failures. They appear in any workflow where AI-assisted output carries operational, regulatory, or reputational consequences.

## What Attestor Does About It

Attestor interposes a governance and proof layer between generation and operational use:

**Typed contracts** bound what is permitted before anything executes.

**Deterministic controls** — governance gates, execution guardrails, data contracts, semantic clauses — produce evidence independent of the generation step.

**Authority separation** prevents any component from approving its own output. A warrant → escrow → receipt → capsule chain enforces monotonic authority closure.

**Reviewer escalation** routes high-consequence decisions to human reviewers. Endorsements are Ed25519-signed and cryptographically bound to the specific run they approved.

**Portable proof** makes governed acceptance verifiable by an outsider. Ed25519-signed certificates and 6-dimensional verification kits require only a public key to check — no platform access, no database, no API call.

## Where Raw AI Is Not Admissible

Attestor matters wherever AI output is economically useful but operationally inadmissible without governed acceptance. The conditions are:

- The output has operational consequences.
- Raw model output cannot be accepted on sight.
- Acceptance requires controls, review, evidence, and later verification.
- The workflow is audit-sensitive, regulatorily exposed, or reputationally consequential.

Domains where these conditions hold:

- **Financial analytics and reporting** — the current reference implementation
- **Risk and control operations** — exception reviews, control-gap assessments, breach analysis
- **Healthcare and life sciences** — internal analytical workflows where clinical or operational AI proposals require governed review
- **Insurance and claims** — reserve estimation, claims-review support, audit-sensitive internal analytics
- **Industrial and supply-chain operations** — safety-critical assessments, quality-control analytics, predictive maintenance decisions
- **Legal and compliance** — document review support, contract analysis, regulatory-change impact assessment
- **Public-sector and government** — decision-support analytics subject to audit, oversight, or freedom-of-information obligations

The engine architecture is domain-independent. The repository ships finance. Broader domain implementations require domain-specific contracts, semantic clauses, and scoring logic. The governance engine, authority chain, signing, and verification layers do not change.

These categories describe where the engine applies in principle. They are not a claim that domain packs are shipped.

## Reference Implementation: Finance

Finance is the hardest proving ground. Silent errors are expensive. Auditability is non-negotiable. Approval authority is a control requirement, not a convenience feature. Regulatory frameworks demand traceable evidence, reviewer accountability, and explainable acceptance.

Attestor's financial reference implementation is the most tested, most explicit, and most complete domain in the repository. If the engine works here — where acceptance must be explainable, replayable, and verifiable under regulatory-grade constraints — it validates the architecture under demanding conditions.

Finance is the proving ground. Not the ceiling.

## Proof Maturity Today

Proof completeness varies by execution path. The repository does not blur this distinction.

**Single-query governed proof** — mature:
- Ed25519-signed attestation certificate binding authority + evidence + decision
- 6-dimensional verification kit: cryptographic, structural, authority, governance, proof, reviewer endorsement
- Run-bound reviewer endorsement with independent outsider verification
- Independent verification CLI requiring only a public key
- Real PostgreSQL execution evidence when database is configured

**Multi-query governed proof** — first slice:
- Portable artifacts: multi-query output pack, dossier, and manifest
- Per-unit governance, evidence, and decision preserved
- Aggregate decision, proof mode, governance sufficiency, blocker attribution
- Not yet at signed certificate / verification kit / reviewer-endorsement completeness

**Real PostgreSQL proof** — operational:
- Bounded read-only PostgreSQL connector with predictive guardrails
- Reproducible demo bootstrap (`pg-demo-init`) for repo-native proof
- Execution context hash and provider markers in bundle and kit
- Operator path: doctor → probe → bootstrap → prove

## What This Repository Implements

**Governance engine (domain-independent):**

- Authority chain: warrant → escrow → receipt → capsule
- Deterministic scorer cascade with priority short-circuit
- Review policy with materiality-based escalation
- Evidence chain, hash-linked audit trail, provenance
- Ed25519 attestation certificates and verification kits (single-query)
- Run-bound reviewer endorsement with outsider verification (single-query)
- Multi-query governed pipeline with portable proof artifacts

**Financial domain (reference implementation):**

- SQL governance: read/write safety, scope constraints, injection detection
- Policy and least-privilege entitlement checks
- Execution guardrails: row, cost, shape, join-depth limits
- Data contracts, control totals, reconciliation break handling
- 5 semantic clause types: `balance_identity`, `control_total`, `ratio_bound`, `sign_constraint`, `completeness_check`
- Filing readiness assessment
- OpenLineage-compatible lineage export

## What Attestor Is

A governance and proof engine. The acceptance layer for AI-assisted high-stakes decisions.

Attestor governs the boundary between proposal and operational use. It does not generate output. It does not orchestrate models. It enforces contracts, produces evidence, escalates review, closes authority, and issues portable proof.

Current strongest implementation: internal banking, treasury, risk, and regulatory-reporting analytics.

## What Attestor Is Not

- Not a financial chatbot or AI assistant
- Not an LLM orchestrator or prompt engineering framework
- Not a customer-facing automated decision engine
- Not a generic BI tool, dashboard, or visualization layer
- Not a filing or regulatory submission platform
- Not a generic "AI compliance" or "responsible AI" checklist
- Not a cross-domain enterprise control plane that is already complete
- Not proof that AI output is inherently trustworthy

## How a Governed Run Works

```text
Typed contract        What is this operation allowed to do?
  → Governance        Is the proposal safe, scoped, and intent-aligned?
  → Guardrails        Resource and shape limits enforced before execution
  → Execution         Fixture, local live, or bounded real database
  → Evidence          Data contracts, semantic clauses, audit chain
  → Scoring           Deterministic scorers with priority short-circuit
  → Review            Materiality-based escalation, reviewer endorsement
  → Authority         Warrant → escrow → receipt → capsule
  → Attestation       Ed25519-signed certificate + verification kit (single-query)
```

Every run produces a decision (`pass` / `fail` / `block` / `pending_approval`), an authority chain, and a reviewer dossier. The single-query path additionally issues a portable signed certificate verifiable by anyone with the signer's public key.

## Quick Start

```bash
npm install

# List available scenarios (financial reference implementation)
npm run list

# Run a fixture scenario (no keys, no database required)
npm run scenario -- counterparty

# Check proof readiness (signing keys, database, credentials)
npm run start -- doctor

# Run a governed proof with signed certificate + reviewer-verifiable kit
npm run prove -- counterparty

# Run with persistent signing keys
npm run prove -- counterparty .attestor

# Run with a separate reviewer key directory
npm run prove -- counterparty .attestor --reviewer-key-dir ./reviewer-keys

# Bootstrap demo PostgreSQL schema for real DB proof
npx tsx src/financial/cli.ts pg-demo-init

# Run a multi-query governed proof (fixed 3-unit demo, first-slice artifacts)
npx tsx src/financial/cli.ts multi-query

# Verify a verification kit (certificate + bundle + reviewer endorsement)
npm run verify:cert -- .attestor/proofs/<run>/kit.json

# Verify a certificate alone (certificate + public key only)
npm run verify:cert -- .attestor/proofs/<run>/certificate.json .attestor/proofs/<run>/public-key.pem

# Generate a persistent signing key pair
npm run keygen

# Run all tests (399 tests)
npm test

# Full verification (typecheck + test + build)
npm run verify
```

Fixture scenarios require no API key or database. PostgreSQL proof requires `npm install pg` + `ATTESTOR_PG_URL`. Live model proof requires `OPENAI_API_KEY`.

## Proof Modes

Every run is labeled with its actual proof mode. Attestor does not imply stronger guarantees than the runtime proved.

| Mode | Meaning |
|---|---|
| `offline_fixture` | Pre-defined fixture data. No live observation. |
| `live_model` | Real model generation with fixture or local execution. |
| `live_runtime` | Real database execution (SQLite or PostgreSQL). |
| `hybrid` | Some components live, others fixture or mocked. |

Incomplete proof is named, not hidden. Each gap has a category (`upstream`, `execution`, `schema_snapshot`, `lineage`) and a description. Missing live proof does not deny authority — it constrains what can be truthfully claimed about the run.

## Shipped vs Architectural Scope

The engine architecture — typed contracts → deterministic evidence → bounded review → authority closure → portable proof — is domain-independent.

The repository ships a complete implementation for financial analytics. That is the current beachhead: the most tested, most audited, most explicit domain.

Extending Attestor to a new domain requires domain-specific contracts, semantic clauses, and scoring logic. The governance engine, authority chain, signing, and verification layers are reusable without modification.

Broader domain packs are architectural possibility. They are not shipped.

## Bounded Capabilities Today

**PostgreSQL proof path.** Optional read-only connector with predictive guardrails, schema allowlist enforcement, and a reproducible demo bootstrap. Doctor provides step-by-step probe with remediation hints.

**Local runtime.** Single-process CLI or programmatic import. No API service layer, no distributed execution, no multi-tenant isolation.

**Reviewer-signed proof.** Ed25519-signed and run-bound. Reviewer identity is operator-asserted, not enterprise-directory-bound (SSO/LDAP/AD).

**Key management.** Ephemeral keys by default. Persistent keys loadable from a directory. No HSM, vault, or external KMS.

## Not Yet Implemented

- Domain packs beyond finance
- Signed certificates and verification kits for multi-query runs
- Reviewer authority at the multi-query level
- Differential evidence across multi-query units
- Warehouse-scale connectors (Snowflake, BigQuery, Databricks)
- Filing or regulatory submission adapters
- Enterprise IAM / SSO / LDAP integration
- PKI-backed or CA-chained signing
- Distributed control plane or API service layer

## Output Artifacts

| Artifact | Purpose |
|---|---|
| **Decision dossier** | Reviewer packet: readiness, breaks, policy, guardrails, authority, proof |
| **Output pack** | Machine-readable run summary with oversight and evidence |
| **Manifest** | Artifact inventory and run-anchor hashes |
| **Attestation** | Canonical evidence pack with chain linkage |
| **Certificate** | Ed25519-signed portable proof: authority + evidence + decision (single-query) |
| **Verification kit** | Self-contained verifier-facing package: certificate + bundle + reviewer endorsement (single-query) |
| **Audit trail** | Ordered event log with evidence hashes |
| **Reviewer public key** | Ed25519 public key for independent endorsement verification |

Artifacts are designed to agree with each other and to remain truthful about what the runtime actually proved.

## Reviewer Authority

Workflow-bound reviewer authority. Not a status flag — a cryptographic proof of who approved, what they approved, and which specific run they approved.

**Identity** captures name, role, and identifier. **Endorsement** captures the decision, rationale, and review scope. When a reviewer key pair is available, the endorsement is **Ed25519-signed** and bound to `runId` + `replayIdentity` + `evidenceChainTerminal`.

**Run binding** prevents cross-run replay. The verification kit checks binding equality — a valid endorsement from one run fails verification inside a different run's kit.

**Boundary.** Reviewer identity is operator-asserted. Enterprise directory binding (SSO, LDAP, AD) is not yet shipped. The cryptographic chain is real. The organizational identity binding is not.

## PostgreSQL Product Proof

Optional bounded PostgreSQL connector for real-database execution proof.

**Safety.** Read-only transactions. Statement timeout. Row limits. Write/stacked-query rejection. Schema allowlist enforcement.

**Predictive guardrails.** EXPLAIN-based risk preflight. Critical-risk queries are denied before they touch data.

**Demo bootstrap.** `pg-demo-init` seeds a deterministic `attestor_demo` schema for reproducible repo-native proof.

**Evidence.** `executionContextHash` anchors which database environment was queried. `executionProvider` and `hasDbContextEvidence` make a real-DB kit distinguishable from a fixture kit.

**Boundary.** Does not prove schema snapshot, table-level content hash, or data-state attestation.

## Regulatory Boundary

Attestor maps to **control objectives** in DORA, BCBS 239, SR 11-7, EU AI Act, and SOX/ICFR. It does not certify compliance. Compliance remains the organization's responsibility. Applicability depends on deployment context.

See [Regulatory alignment](docs/03-governance/regulatory-alignment.md).

## Documentation

| Document | Content |
|---|---|
| [Purpose and boundary](docs/01-overview/purpose.md) | Engine identity, problem definition, non-claims |
| [System overview](docs/02-architecture/system-overview.md) | Engine architecture, financial reference shape, proof model |
| [Regulatory alignment](docs/03-governance/regulatory-alignment.md) | Control mapping, framework-level boundaries |
| [Authority model](docs/04-authority/authority-model.md) | Warrant → escrow → receipt → capsule lifecycle |
| [Proof model](docs/05-proof/proof-model.md) | Proof modes, Live Proof, Live Readiness, multi-query proof |
| [Signing and verification](docs/06-signing/signing-verification.md) | Ed25519 certificates, verification kit, reviewer endorsement |
| [PostgreSQL and connectors](docs/07-connectors/postgres-connectors.md) | Safety model, predictive guardrails, demo bootstrap |

## Environment Variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Live model proof (AI-generated SQL) |
| `ATTESTOR_PG_URL` | PostgreSQL connection URL for real database proof |
| `ATTESTOR_PG_TIMEOUT_MS` | Query timeout in ms (default: 10000) |
| `ATTESTOR_PG_MAX_ROWS` | Maximum result rows (default: 10000) |
| `ATTESTOR_PG_ALLOWED_SCHEMAS` | Comma-separated schema allowlist |

Fixture mode requires no API key or database.

## Project Status

| | |
|---|---|
| **Version** | 0.1.0 |
| **Runtime** | Node.js 22+, TypeScript, local single-process |
| **Tests** | 399 (367 financial + 32 signing) |
| **License** | Proprietary. All rights reserved. |
