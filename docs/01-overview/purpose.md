# Purpose

Use this page as the shortest internal orientation note.

For the public product framing, use the [README](../../README.md).
For the architecture map, use [System overview](../02-architecture/system-overview.md).

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

## Who This Is For

- Teams introducing AI into high-stakes internal workflows
- Reviewers and control functions who need evidence-bearing acceptance
- Builders who need portable proof, not just a model answer
- Organizations that want AI assistance without surrendering authority, auditability, or verification
- Banks, hospitals, insurers, and internal AI platform teams that need infrastructure rather than another AI app
