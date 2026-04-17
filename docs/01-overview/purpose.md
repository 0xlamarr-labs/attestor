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

Those modules prove architectural breadth. They do not yet imply release-layer completeness outside the financial reference path.

## What It Is

Attestor is being built as:

- an AI output release layer
- an AI acceptance layer
- a consequence gateway between generated output and real-world effect

The point is not to generate the output.

The point is to decide whether that output may move forward into communication, record, action, or decision-support.

## What It Is Not

- not a financial chatbot
- not an LLM orchestration framework
- not a BI front-end
- not a generic AI compliance checklist
- not a customer-facing automated decision engine
- not a universal AI platform

Attestor makes release into consequence governable. It does not make AI inherently trustworthy.

## Who This Is For

- teams introducing AI into high-stakes internal workflows
- reviewers and control functions who need evidence-bearing release decisions
- builders who need portable proof, not just a model answer
- organizations that want AI assistance without surrendering authority, auditability, or verification
- banks, hospitals, insurers, and internal AI platform teams that need a release boundary rather than another AI app
