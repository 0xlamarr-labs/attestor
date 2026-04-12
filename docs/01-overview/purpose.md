# Purpose

## What Attestor Is

Attestor is acceptance, proof, and operating infrastructure for AI-assisted work.

It is consumed as a hosted API product or private deployment, not as a file-management app.

Its job is to govern acceptance, not generation. A model may propose. Attestor determines whether that proposal can be accepted, what evidence supports it, who may endorse it, and what an outsider can verify later.

The engine architecture is domain-independent. The repository's reference implementation is financial and remains the deepest path in the codebase.

## Why It Exists

AI becomes useful before it becomes admissible.

In consequence-bearing workflows, the missing layer is usually not "better generation." It is governed acceptance:

- typed contracts before execution
- deterministic controls independent of generation
- explicit review and authority closure
- portable proof after the fact

Without that layer, organizations get raw execution, authority collapse, weak evidence, and overclaimed proof.

## Current Repository Truth

The repository currently contains:

- a complete financial reference implementation
- signed single-query and multi-query proof paths
- reviewer endorsements with run binding
- a real PostgreSQL-backed proof path
- a bounded HTTP API service with sync and async first-slice routes
- domain pack, connector, and filing-adapter registries
- differential evidence for multi-query comparison

It also contains broader building blocks:

- a healthcare domain pack
- a Snowflake connector module
- an XBRL US-GAAP 2024 adapter
- OIDC reviewer identity verification plus a CLI device-flow helper
- a JSON PKI trust-chain module with API-path issuance and chain validation
- a BullMQ/Redis async orchestration module

Those modules prove architectural breadth. They do not yet imply finance-level end-to-end completeness outside the financial reference path.

## What It Is Not

- Not a financial chatbot
- Not an LLM orchestration framework
- Not a BI front-end
- Not a generic AI compliance checklist
- Not a customer-facing automated decision engine
- Not a distributed enterprise control plane

Attestor makes AI-assisted output governable. It does not make AI inherently trustworthy.

## Proof Maturity

**Single-query:** mature signed certificate and verification-kit path.

**Multi-query:** signed run-level certificate and verification-kit path exists, with reviewer binding and differential evidence, but not per-unit certificate issuance.

**Real PostgreSQL:** real bounded proof path is working, including a self-contained proof script, reproducible demo bootstrap, and schema/data-state attestation capture in the Postgres prove helper.

**Service and identity:** the API can issue, verify, export filings, and run async jobs as a bounded first slice. Operator-asserted reviewer identity is standard; API-path OIDC verification and CLI device flow are shipped as first slices; full IAM flow is not.

## Who This Is For

- Teams introducing AI into high-stakes internal workflows
- Reviewers and control functions who need evidence-bearing acceptance
- Builders who need portable proof, not just a model answer
- Organizations that want AI assistance without surrendering authority, auditability, or verification
- Banks, hospitals, insurers, and internal AI platform teams that need infrastructure rather than another AI app
