# System Overview

Current repository-level architecture for Attestor as of April 2026.

Attestor is a governance and proof engine for AI-assisted high-stakes workflows. It provides deterministic governance gates, explicit reviewer-facing artifacts, a typed authority chain, and truthful runtime-proof semantics. The engine architecture is domain-general; the current implementation targets internal financial analytics as the reference domain.

---

## Engine Architecture

The engine is organized around governance capabilities, not UI or domain-specific layers:

- **Domain contracts**: typed contracts, warrant scope, and execution obligations that define allowed behavior before execution
- **Deterministic evidence**: governance gates, data contracts, control totals, report validation, lineage capture, audit hashing
- **Bounded scoring and review**: deterministic scorer cascade, review policy, escalation thresholds, reviewer-facing summaries
- **Authority artifacts**: warrant → escrow → receipt → capsule chain for monotonic authority closure
- **Live Proof**: typed runtime-proof artifact recording what was offline, mocked, or live, with explicit proof gaps
- **Reviewer artifacts**: dossier, output pack, manifest, attestation, audit trail, and interop export
- **Portable verification**: Ed25519-signed certificates and 6-dimensional verification kits

These capabilities are domain-independent. Domain-specific behavior comes from contracts, semantic clauses, and scoring logic — not from the engine itself.

---

## Shared Engine Pattern

```text
proposal
  → typed contract
  → constrained execution
  → deterministic evidence collection
  → bounded scoring / review
  → authority chain (warrant → escrow → receipt → capsule)
  → reviewer-facing artifacts
  → portable proof (Ed25519 certificate + verification kit)
```

Generation and authority are separate. A generated proposal is only a candidate. Acceptance depends on governance, evidence, and review policy.

---

## Financial Reference Implementation

The current repository implements the engine pattern for internal financial analytics:

```text
financial query contract
  → SQL governance
  → policy and entitlement
  → execution guardrails
  → snapshot or fixture execution
  → data contracts and control totals
  → provenance and lineage evidence
  → review policy and bounded scoring
  → filing readiness
  → warrant → escrow → receipt → capsule
  → output pack / dossier / manifest / attestation
  → Live Proof summary + Live Readiness assessment
```

The financial implementation includes bounded local live execution (model-generated SQL + local SQLite) and an optional bounded PostgreSQL proof path with predictive guardrails and a reproducible demo bootstrap.

---

## Authority Model

The authority chain is:

```text
warrant → escrow → receipt → capsule
```

Each artifact has a different job:

- **Warrant**: what was authorized up front
- **Escrow**: which obligations were released, held, or denied
- **Receipt**: whether final authority was granted or withheld
- **Capsule**: portable summary of the final authority state and anchors

This chain is separate from Live Proof. Live Proof describes what runtime evidence was actually observed. Receipt and capsule describe authority closure.

---

## Proof and Readiness Model

Attestor uses explicit proof modes:

- `offline_fixture`
- `mocked_model`
- `live_model`
- `live_runtime`
- `hybrid`

Live Proof records upstream model evidence, execution evidence, explicit proof gaps, and consistency between observed evidence and the declared proof mode.

Live Readiness records which proof modes are available, which remain blocked, and what next steps would increase confidence.

Important design rule: missing live proof does not automatically deny authority. Live proof is a truthfulness artifact, not the authority chain itself.

---

## Reviewer-Facing Artifact Set

Attestor produces these reviewer-facing artifacts:

- **Output pack** — machine-readable run summary
- **Decision dossier** — reviewer packet with readiness, breaks, policy, guardrails, authority, proof
- **Manifest** — artifact inventory and run-anchor hashes
- **Attestation** — canonical evidence pack with chain linkage
- **Audit trail** — ordered event log with evidence hashes
- **OpenLineage export** — provenance and lineage interoperability

These artifacts should agree with each other and should not overclaim what the runtime actually proved.

---

## Current Boundary

What the repo implements today:

- Complete financial analytics reference implementation of the engine pattern
- Authority chain, deterministic scoring, review policy, evidence chain
- Ed25519-signed portable certificates and 6-dimensional verification kits
- Reviewer-signed run-bound endorsements with independent outsider verification
- Multi-query governed pipeline with portable proof artifacts
- Bounded PostgreSQL proof path with predictive guardrails and demo bootstrap
- Bounded local live hybrid exercises through model-generated SQL and local SQLite execution

What the repo does not yet implement:

- Domain packs beyond finance
- Broad, repeatable live warehouse execution
- Enterprise identity and entitlement integration
- External trust registration or PKI-backed signing
- Filing submission adapters
- Distributed service control plane
