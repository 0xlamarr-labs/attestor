# Purpose

## What Attestor Is

Attestor is a governance-and-proof runtime for AI-assisted high-stakes workflows. It separates generation from acceptance: models or operators can propose, but deterministic checks, bounded review, reviewer-visible artifacts, and truthful runtime-proof records decide what is accepted, held, or denied.

The architecture is domain-general. The current repository implements one reference domain:

- **Bank-grade internal financial analytics**: SQL governance, policy and entitlement checks, execution guardrails, data contracts, semantic clauses, provenance, review policy, authority artifacts, Ed25519-signed portable certificates, reviewer-signed endorsements, and truthful Live Proof with explicit proof gaps

Finance is the first and most mature implementation because it is a demanding proving ground — where silent errors are expensive, auditability is non-optional, and approval authority matters. The core pattern (typed contracts → deterministic evidence → bounded review → authority closure → portable proof) generalizes to other high-stakes internal workflows. Broader domain packs are not yet shipped.

The architecture is organized around governance capabilities rather than UI or service layers:

- **Domain contracts**: typed query contracts, report contracts, warrant bindings, and execution obligations define scope and boundaries before execution begins
- **Deterministic evidence**: SQL governance, data contracts, control totals, audit-chain hashing, report validation, runtime proof summaries
- **Bounded scoring and review**: deterministic scorer cascade, review policy, escalation rules, and reviewer-facing evidence
- **Authority artifacts**: warrant -> escrow -> receipt -> capsule chain for monotonic authority composition
- **Live Proof**: truthful runtime-proof record distinguishing offline, mocked, live-model, live-runtime, and hybrid runs with explicit proof gaps

The external interface is intentionally simple: request in, reviewable evidence plus authority decision out.

## What Problem It Solves

Attestor exists to prevent four common failures in AI-assisted high-stakes workflows (demonstrated here in the financial domain):

| Failure | Why it happens |
|---|---|
| **Raw prompt execution** | Generation and execution collapse into one step |
| **Authority collapse** | A model output, or second model opinion, is treated as approval authority |
| **Unverifiable acceptance** | The system cannot show what evidence justified the decision |
| **Runtime truth drift** | The repo or operator describes stronger or weaker guarantees than the runtime really proves |

Attestor answers each one with a separate control:

| Failure | Attestor response |
|---|---|
| Raw prompt execution | Query contract, SQL governance, policy checks, and execution guardrails before execution |
| Authority collapse | Deterministic evidence, review policy, scorer cascade, and explicit authority chain |
| Unverifiable acceptance | Dossier, output pack, manifest, attestation, audit trail, and lineage artifacts |
| Runtime truth drift | Live Proof, Live Readiness, proof gaps, and reviewer-visible runtime summaries |

## What It Is Not

- **Not a dashboard generator or BI tool.** Governance and authority are the point, not raw query convenience.
- **Not an LLM orchestrator.** Attestor governs acceptance, not generation.
- **Not automatic compliance certification.** It supports reviewability and control evidence; it does not certify compliance by itself.
- **Not a domain-agnostic enterprise control plane (yet).** The architecture generalizes; the current implementation is financial-first.
- **Not an external trust service.** Attestation uses Ed25519 portable certificates today; PKI-backed trust registration is future work.

## Who This Is For

- **Builders** of AI-assisted financial workflows that need evidence, replayability, and explicit acceptance semantics
- **Reviewers and control functions** who need to answer what was authorized, what was held, what was denied, and what actually happened at runtime
- **Financial engineering and analytics teams** operating in high-accountability reporting, reconciliation, or governed decision pipelines
