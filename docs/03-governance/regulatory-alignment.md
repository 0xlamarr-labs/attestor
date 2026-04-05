# Regulatory and Control Alignment

Attestor does **not** claim out-of-the-box regulatory compliance.

What it does provide is a financial governance runtime whose controls, evidence model, and reviewer artifacts map to control expectations that recur across financial regulation, model governance, and reporting assurance.

The right reading of this document is:

- **capability-level mapping**, not legal certification
- **control support**, not full framework completion
- **truthful boundary**, not marketing overclaim

---

## Why this mapping exists

Attestor is built around:

- typed query and report contracts
- SQL governance and execution guardrails
- deterministic evidence collection
- bounded scoring and review policy
- authority artifacts (`warrant -> escrow -> receipt -> capsule`)
- reviewer-facing artifacts (`dossier`, `output pack`, `manifest`, `attestation`)
- explicit runtime truth (`Live Proof`, `Live Readiness`)

Those capabilities map naturally to regulatory and assurance themes such as:

- traceability
- logging
- independent validation
- reviewability
- control evidence
- reporting integrity
- operational discipline

---

## Framework Mapping

### DORA

Official reference: Digital Operational Resilience Act, Regulation (EU) 2022/2554.

Relevant expectation areas:

- ICT risk management
- operational control and resilience
- traceability and auditable operation

Attestor support today:

- deterministic governance gates before execution
- execution guardrails for bounded runtime behavior
- snapshot semantics and audit-chain evidence
- reviewer-visible artifact set for post-run accountability
- explicit proof-mode and readiness labeling

Attestor boundary:

- not a full DORA compliance program
- no incident management framework
- no third-party ICT risk management system
- no resilience testing governance program
- no enterprise operations platform

### BCBS 239

Official reference: BCBS 239, *Principles for effective risk data aggregation and risk reporting*.

Relevant expectation areas:

- accuracy
- integrity
- completeness
- timeliness
- traceability of risk data and outputs

Attestor support today:

- data contracts
- control totals
- reconciliation checks
- timeliness proof
- lineage and provenance artifacts
- break reporting and filing-readiness summaries

Attestor boundary:

- not a bank-wide risk data aggregation architecture
- not a supervisory reporting platform
- not an enterprise master-data or data-quality control plane

### SR 11-7

Official reference: Federal Reserve / OCC supervisory guidance on model risk management.

Relevant expectation areas:

- model governance
- independent validation
- documentation
- effective challenge
- controlled use of model-driven outputs

Attestor support today:

- architectural separation between candidate generator and deterministic validators
- bounded scoring cascade
- review policy and escalation
- audit trail and reviewer dossier
- runtime truth labeling for live vs offline evidence

Attestor boundary:

- not a full MRM operating model
- not a complete model inventory, change-management, or annual validation program
- not a substitute for enterprise governance committees or policy ownership

### EU AI Act

Official references: Regulation (EU) 2024/1689; logging, documentation, and human-oversight duties are especially relevant when a deployed use case is in scope as high-risk.

Relevant expectation areas:

- logging
- traceability
- technical documentation
- human oversight

Attestor support today:

- hash-linked audit trail
- reviewer-facing artifacts and output packaging
- explicit proof mode and proof gap reporting
- oversight semantics via review policy and authority state

Attestor boundary:

- applicability depends on the actual deployed use case
- Attestor does not by itself perform a conformity assessment
- it does not by itself satisfy all provider/deployer obligations under the Act

### SOX / ICFR

Relevant expectation areas:

- internal control evidence
- reviewer accountability
- traceable acceptance of reporting logic and outputs

Attestor support today:

- warrant/escrow/receipt/capsule authority chain
- audit trail
- manifest and attestation artifacts
- filing-readiness summaries
- replayable evidence chain

Attestor boundary:

- not a full ICFR environment
- does not replace segregation-of-duties design, management testing, auditor judgment, or entity-level controls

---

## What Attestor can truthfully say today

Attestor can truthfully say that it:

- supports control evidence and reviewer traceability for financial pipelines
- makes runtime truth explicit rather than implied
- provides deterministic governance around model-mediated analytical output
- produces portable internal artifacts that explain why a run was accepted, held, or denied

Attestor should **not** yet say that it:

- is compliant with DORA, BCBS 239, SR 11-7, EU AI Act, or SOX on its own
- replaces enterprise policy, control, legal, audit, or operations functions
- proves broad external live-system coverage beyond the repo's current runtime boundary

---

## Current gap to stronger regulatory claims

The main missing pieces before stronger external claims would be:

- real production database connectors
- stronger identity and entitlement integration
- asymmetric signing and external verification
- enterprise deployment and audit-operating model
- formal clause-level control mapping and evidence coverage

Until then, the right position is:

**Attestor is a financial authority-and-evidence runtime with strong control relevance, not a completed compliance solution.**
