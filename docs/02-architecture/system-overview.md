# System Overview

Current repository-level architecture for Attestor as of April 2026.

Attestor is a financial authority-and-evidence runtime with explicit reviewer-facing artifacts, a typed authority chain, and truthful runtime-proof semantics.

---

## Governance Capabilities

The architecture is organized around governance capabilities:

- **Domain contracts**: typed query contracts, report contracts, warrant scope, and execution obligations that define allowed behavior before execution
- **Deterministic evidence**: SQL governance gates, data contracts, control totals, report validation, lineage capture, audit hashing
- **Bounded scoring and review**: deterministic scorer cascade, review policy, escalation thresholds, reviewer-facing summaries
- **Authority artifacts**: warrant -> escrow -> receipt -> capsule chain for monotonic authority closure
- **Live Proof**: typed runtime-proof artifact recording what was offline, mocked, or live, with explicit proof gaps
- **Reviewer artifacts**: dossier, output pack, manifest, attestation, audit trail, and OpenLineage export

---

## Shared Runtime Pattern

```text
request
  -> typed contract
  -> constrained execution
  -> deterministic evidence collection
  -> bounded scoring / review
  -> reviewer-facing artifacts
  -> explicit runtime-truth record
```

Generation and authority are separate. A generated query is only a candidate. Acceptance depends on governance, evidence, and review policy.

---

## Financial Runtime Shape

```text
financial query contract
  -> SQL governance
  -> policy and entitlement
  -> execution guardrails
  -> snapshot or fixture execution
  -> data contracts and control totals
  -> provenance and lineage evidence
  -> review policy and bounded scoring
  -> filing readiness
  -> warrant
  -> escrow
  -> receipt
  -> decision capsule
  -> output pack / dossier / manifest / attestation
  -> Live Proof summary
  -> Live Readiness assessment
```

The committed repo centers this runtime on offline/reference exercises, but it also includes a bounded local live hybrid slice with model-generated SQL and local SQLite execution.

---

## Authority Model

The financial authority chain is:

```text
warrant -> escrow -> receipt -> capsule
```

Each artifact has a different job:

- **Warrant**: what was authorized up front
- **Escrow**: which obligations were released, held, or denied
- **Receipt**: whether final authority was granted or withheld
- **Capsule**: portable summary of the final authority state and anchors

This chain is separate from Live Proof.
Live Proof describes what runtime evidence was actually observed.
Receipt and capsule describe authority closure.

---

## Proof and Readiness Model

Attestor uses explicit proof modes:

- `offline_fixture`
- `mocked_model`
- `live_model`
- `live_runtime`
- `hybrid`

Live Proof records:

- upstream model evidence
- execution evidence
- explicit proof gaps
- consistency between observed evidence and the declared proof mode

Live Readiness records:

- which proof modes are currently available
- which modes remain blocked
- what next steps would increase confidence
- whether the current result is a readiness check or a real live exercise

Important design rule:

- missing live proof does not automatically deny authority
- live proof is a truthfulness artifact, not the authority chain itself

---

## Reviewer-Facing Artifact Set

Attestor emits or models these reviewer-facing artifacts:

- **Output pack**
- **Decision dossier**
- **Manifest**
- **Attestation**
- **Audit trail**
- **OpenLineage export**
- **Live Proof summary**

The design rule is that these artifacts should agree with each other and should not overclaim what the runtime actually proved.

---

## Controls and Reporting Relevance

Attestor does not claim built-in regulatory compliance, but it is designed to support evidence and control expectations common in:

- internal control over financial reporting
- audit preparation
- governed reconciliations and control totals
- model-risk-sensitive financial workflows
- reviewable reporting pipelines with explicit acceptance semantics

The repo is strongest when used to answer:

- What was authorized before execution?
- What evidence justified acceptance?
- What remained held or denied?
- What was truly live versus offline?
- What gaps remain before stronger reliance or filing use?

---

## Current Boundary

What the repo truthfully proves today:

- the offline/reference financial architecture is implemented
- the authority chain is real in the repo
- Live Proof and Live Readiness exist as typed, verifiable artifact models
- reviewer-facing artifacts are implemented and internally coherent
- the repo supports bounded local live hybrid exercises through model-generated SQL and local SQLite execution

What the repo does not yet prove:

- broad, repeatable live external warehouse execution
- enterprise identity and entitlement integration
- external trust registration or PKI-backed signing
- production filing submission adapters
- a distributed service control plane
