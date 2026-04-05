# Purpose

## What Attestor Is

Attestor is a governance and proof engine for AI-assisted high-stakes workflows. It separates generation from acceptance: models or operators can propose, but deterministic controls, bounded review, reviewer-visible artifacts, and truthful runtime-proof records decide what is accepted, held, or denied. Every decision produces portable, independently verifiable proof.

The engine architecture is domain-general. The current repository implements one reference domain:

- **Bank-grade internal financial analytics**: SQL governance, policy and entitlement checks, execution guardrails, data contracts, semantic clauses, provenance, review policy, authority artifacts, Ed25519-signed portable certificates, reviewer-signed endorsements, and truthful Live Proof with explicit proof gaps

Finance is the first and most mature implementation because it is a demanding proving ground — where silent errors are expensive, auditability is non-optional, and approval authority matters. The core engine pattern (typed contracts → deterministic evidence → bounded review → authority closure → portable proof) generalizes to other high-stakes internal workflows. Broader domain implementations are not yet shipped.

The architecture is organized around governance capabilities rather than UI or service layers:

- **Domain contracts**: typed contracts, warrant bindings, and execution obligations define scope and boundaries before execution begins
- **Deterministic evidence**: governance gates, data contracts, control totals, audit-chain hashing, report validation, runtime proof summaries
- **Bounded scoring and review**: deterministic scorer cascade, review policy, escalation rules, and reviewer-facing evidence
- **Authority artifacts**: warrant → escrow → receipt → capsule chain for monotonic authority composition
- **Live Proof**: truthful runtime-proof record distinguishing offline, mocked, live-model, live-runtime, and hybrid runs with explicit proof gaps

The external interface is intentionally simple: request in, reviewable evidence plus authority decision out.

## What Problem It Solves

In many industries, AI becomes useful before it becomes admissible. Generated output may be good enough to act on — but there is no evidence trail, no reviewer authority, no proof mode, and no way for an outsider to verify the decision.

Attestor exists to prevent four common failures in AI-assisted high-stakes workflows:

| Failure | Why it happens |
|---|---|
| **Raw execution** | Generation and acceptance collapse into one step |
| **Authority collapse** | Model output is treated as its own approval authority |
| **Unverifiable acceptance** | The system cannot show what evidence justified the decision |
| **Runtime truth drift** | The system claims stronger guarantees than the runtime actually proved |

Attestor addresses each one with a separate architectural control:

| Failure | Attestor response |
|---|---|
| Raw execution | Typed contracts, governance gates, and execution guardrails before execution |
| Authority collapse | Deterministic evidence, review policy, scorer cascade, and explicit authority chain |
| Unverifiable acceptance | Dossier, output pack, manifest, attestation, audit trail, and lineage artifacts |
| Runtime truth drift | Live Proof, Live Readiness, proof gaps, and reviewer-visible runtime summaries |

These failures are not finance-specific. They appear wherever AI is introduced into decision workflows that carry operational, regulatory, or reputational consequences.

## What It Is Not

- **Not a financial chatbot or AI assistant.** Attestor governs acceptance, not generation.
- **Not an LLM orchestrator.** It sits after generation, not before it.
- **Not a generic BI tool or dashboard.** Governance and authority are the point, not visualization or query convenience.
- **Not a generic "AI compliance" or "responsible AI" suite.** It is a governance engine, not a policy catalog or ethics checklist.
- **Not a customer-facing automated decision engine.** It governs internal analytical workflows, not customer-facing underwriting or credit scoring.
- **Not automatic compliance certification.** It supports control evidence; it does not certify compliance by itself.
- **Not a cross-domain enterprise control plane (yet).** The engine architecture generalizes; the current implementation is financial-first. Broader domain packs are not shipped.
- **Not an external trust service.** Attestation uses Ed25519 portable certificates today; PKI-backed trust registration is future work.

## Who This Is For

- **Builders** of AI-assisted internal workflows that need evidence, replayability, and explicit acceptance semantics — in finance, risk, operations, healthcare analytics, insurance, or any audit-sensitive environment
- **Reviewers and control functions** who need to answer what was authorized, what was held, what was denied, and what actually happened at runtime
- **Teams introducing AI** into high-stakes internal processes where raw model output is useful but not yet admissible without governed acceptance
