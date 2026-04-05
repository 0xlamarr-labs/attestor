# Purpose

## What Attestor Is

Attestor is a governance and proof engine for AI-assisted high-stakes decisions. It enforces governed acceptance: the boundary between a model's proposal and the organization's operational use of that proposal.

No component — model or runtime — can approve its own output. Typed contracts bound what is permitted. Deterministic controls produce evidence independent of the generation step. Authority separation prevents self-approval. Reviewer escalation routes consequence-bearing decisions to human authority. Portable proof makes governed acceptance verifiable by an outsider.

The engine architecture is domain-independent. The current repository implements one reference domain:

- **Bank-grade internal financial analytics**: SQL governance, execution guardrails, data contracts, semantic clauses, authority chain, Ed25519-signed portable certificates, run-bound reviewer endorsements, and truthful proof with explicit gaps

Finance is the first implementation because it is the hardest proving ground — where silent errors are expensive, auditability is non-negotiable, and approval authority is a control requirement. The core engine pattern (typed contracts → deterministic evidence → bounded review → authority closure → portable proof) generalizes to any consequence-sensitive workflow. Broader domain packs are not yet shipped.

The architecture is organized around governance capabilities:

- **Domain contracts**: typed constraints and execution obligations that bound allowed behavior before execution
- **Deterministic evidence**: governance gates, data contracts, control totals, audit-chain hashing, runtime proof
- **Bounded scoring and review**: deterministic scorer cascade, escalation rules, reviewer-facing evidence
- **Authority artifacts**: warrant → escrow → receipt → capsule chain for monotonic authority closure
- **Portable proof**: Ed25519-signed certificates, 6-dimensional verification kits, run-bound reviewer endorsements (single-query path)
- **Live Proof**: truthful runtime-proof record distinguishing offline, mocked, live-model, live-runtime, and hybrid runs with explicit gaps

## The Problem

AI output becomes economically useful before it becomes operationally admissible. Generated output may be good enough to act on — but there is no governed path from proposal to acceptance.

Four failures recur wherever AI enters consequence-sensitive workflows:

| Failure | What breaks |
|---|---|
| **Raw execution** | Generation and acceptance collapse into one act |
| **Authority collapse** | Model output is treated as its own approval |
| **Invisible acceptance** | No artifact shows what evidence justified the decision |
| **Truth drift** | The system implies stronger proof than the runtime actually produced |

Attestor addresses each with a separate architectural control:

| Failure | Attestor response |
|---|---|
| Raw execution | Typed contracts, governance gates, execution guardrails before execution |
| Authority collapse | Deterministic evidence, scorer cascade, reviewer escalation, explicit authority chain |
| Invisible acceptance | Dossier, output pack, manifest, attestation, audit trail, lineage |
| Truth drift | Live Proof, explicit proof gaps, verifier-facing runtime summaries |

## What It Is Not

- **Not a financial chatbot or AI assistant.** Attestor governs acceptance, not generation.
- **Not an LLM orchestrator.** It sits after generation, not before it.
- **Not a dashboard, BI tool, or visualization layer.** Governance and authority are the point.
- **Not a generic "AI compliance" or "responsible AI" checklist.** It is a control-bearing execution layer, not a policy catalog.
- **Not a customer-facing automated decision engine.** It governs internal analytical workflows.
- **Not a filing or regulatory submission platform.**
- **Not a cross-domain enterprise control plane that is already complete.** The engine generalizes. The current implementation is financial.
- **Not proof that AI output is inherently trustworthy.** Attestor makes AI-assisted output *governable*, not *trustworthy by default*.

## Proof Maturity

The single-query governed proof path is mature: signed certificates, 6-dimensional verification kits, and run-bound reviewer endorsements are issued, portable, and independently verifiable.

The multi-query path ships a first-slice portable artifact layer (output pack, dossier, manifest) with per-unit and aggregate truth. It does not yet carry signed certificates, verification kits, or reviewer-endorsement completeness.

Real PostgreSQL proof is operational: bounded read-only execution, predictive guardrails, reproducible demo bootstrap, and execution context evidence in the bundle and kit.

## Who This Is For

- **Builders** of AI-assisted internal workflows where acceptance must be explainable, evidence-bearing, and verifiable — in finance, risk, operations, healthcare analytics, insurance, or any audit-sensitive environment
- **Reviewers and control functions** who need to answer: what was authorized, what was held, what was denied, and what the runtime actually proved
- **Teams introducing AI** into consequence-sensitive internal processes where governed acceptance is the prerequisite for operational use
