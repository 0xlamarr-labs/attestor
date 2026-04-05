# System Overview

Architecture of Attestor as of April 2026.

Attestor is a governance and proof engine for AI-assisted high-stakes decisions. It enforces governed acceptance through deterministic controls, typed authority chains, reviewer-bound endorsements, and portable cryptographic proof. The engine architecture is domain-independent. The current implementation targets internal financial analytics as the reference domain.

---

## Engine Architecture

The engine is organized around governance capabilities. Domain-specific behavior comes from contracts, semantic clauses, and scoring logic — not from the engine itself.

**Domain contracts.** Typed constraints and execution obligations that bound permitted behavior before execution begins.

**Deterministic evidence.** Governance gates, data contracts, control totals, report validation, lineage capture, and audit-chain hashing — all independent of the generation step.

**Bounded scoring and review.** Deterministic scorer cascade with priority short-circuit. Review policy with materiality-based escalation. Reviewer-facing evidence summaries.

**Authority artifacts.** Warrant → escrow → receipt → capsule chain for monotonic authority closure. No component can approve its own output.

**Portable proof.** Ed25519-signed attestation certificates binding authority + evidence + decision. 6-dimensional verification kits. Run-bound reviewer endorsements. Independent verification requiring only a public key. *This path is complete for single-query runs.*

**Live Proof.** Typed runtime-proof artifact recording what was offline, mocked, or live. Explicit proof gaps. Consistency checks between observed evidence and declared proof mode.

**Multi-query governance.** N independent governed units within a single run. Per-unit evidence and decision preserved. Aggregate decision, proof mode, and governance sufficiency. *Portable artifact layer ships as a first slice; signed certificate and kit completeness are not yet reached.*

---

## Engine Pattern

```text
proposal
  → typed contract
  → constrained execution
  → deterministic evidence
  → bounded scoring / review
  → authority chain (warrant → escrow → receipt → capsule)
  → reviewer-facing artifacts
  → portable proof (Ed25519 certificate + verification kit)
```

Generation and authority are separate. A generated proposal is only a candidate. Acceptance depends on governance, evidence, and review policy. Proof makes acceptance portable.

---

## Financial Reference Implementation

The current repository implements the engine for internal financial analytics:

```text
financial query contract
  → SQL governance
  → policy and entitlement
  → execution guardrails
  → fixture / SQLite / bounded PostgreSQL execution
  → data contracts and control totals
  → provenance and lineage
  → review policy and bounded scoring
  → filing readiness
  → warrant → escrow → receipt → capsule
  → output pack / dossier / manifest / attestation
  → Ed25519-signed certificate + verification kit
  → Live Proof + Live Readiness
```

Finance is the most tested, most audited, and most explicit implementation. Success here validates the engine architecture under regulatory-grade constraints.

---

## Authority Model

```text
warrant → escrow → receipt → capsule
```

- **Warrant**: what was authorized up front, with typed scope and evidence obligations
- **Escrow**: which obligations were released, held, or denied
- **Receipt**: whether final authority was granted or withheld
- **Capsule**: portable authority summary with hard facts and closure state

Authority artifacts answer what was authorized and what was accepted. Live Proof answers what was actually observed at runtime. These are separate concerns.

---

## Proof Model

Attestor uses explicit proof modes: `offline_fixture`, `mocked_model`, `live_model`, `live_runtime`, `hybrid`.

Live Proof records upstream model evidence, execution evidence, explicit proof gaps, and internal consistency. Live Readiness records which proof modes are available and what remains blocked.

Design rule: missing live proof does not deny authority. It constrains what can be truthfully claimed.

---

## Proof Maturity Boundary

**Single-query.** Mature. Signed certificates, verification kits, and reviewer endorsements are portable and independently verifiable.

**Multi-query.** First slice. Per-unit and aggregate truth in portable artifacts (output pack, dossier, manifest). Not yet at signed certificate, kit, or reviewer-endorsement completeness.

**Real PostgreSQL.** Operational. Bounded read-only execution, predictive guardrails, reproducible demo bootstrap, execution context evidence in bundle and kit.

---

## Reviewer Authority

Reviewer endorsements are Ed25519-signed and cryptographically bound to the specific run they approved (runId + replayIdentity + evidenceChainTerminal). The verification kit checks binding equality — endorsement replay across runs is detected and rejected.

Reviewer identity is operator-asserted. Enterprise directory binding (SSO, LDAP, AD) is not yet shipped.

---

## Artifact Set

- **Output pack** — machine-readable run summary
- **Decision dossier** — reviewer-facing packet with readiness, breaks, governance, authority, proof
- **Manifest** — artifact inventory and evidence anchors
- **Attestation** — canonical evidence pack with chain linkage
- **Certificate** — Ed25519-signed portable proof (single-query)
- **Verification kit** — verifier-facing package with certificate, bundle, reviewer endorsement, 6-dimensional summary (single-query)
- **Audit trail** — ordered event log with evidence hashes
- **OpenLineage export** — provenance and lineage interoperability

---

## Current Boundary

Shipped:
- Complete financial analytics reference implementation
- Authority chain, deterministic scoring, review policy, evidence chain
- Ed25519 certificates, verification kits, reviewer endorsements (single-query)
- Multi-query governed pipeline with first-slice portable artifacts
- Bounded PostgreSQL proof with predictive guardrails and demo bootstrap

Not shipped:
- Domain packs beyond finance
- Signed certificates and kits for multi-query runs
- Warehouse-scale connectors
- Enterprise identity and entitlement integration
- PKI-backed signing
- Filing submission adapters
- Distributed service layer
