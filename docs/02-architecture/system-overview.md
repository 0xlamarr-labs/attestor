# System Overview

Architecture of Attestor as of April 2026.

This document assumes the public framing already covered in the [README](../../README.md) and focuses on the architecture only.

## Current Architectural Identity

Attestor is being shaped as an **AI output release and acceptance layer**.

That means the architecture is converging on a common kernel that sits between generated output and consequence:

- consequence type
- risk class
- release decision
- review authority
- evidence pack
- release token

Today, the strongest implemented proving path is still financial reporting. The broader release-layer identity is the architectural direction, while finance remains the deepest end-to-end slice in the repository.

## Engine Architecture

The engine is built from reusable layers:

- **Typed contracts** constrain what a proposal is allowed to do.
- **Deterministic evidence** records governance, execution, validation, and lineage independent of generation.
- **Scoring and review** translate evidence into governed decisions and reviewer escalation.
- **Authority artifacts** close acceptance through warrant -> escrow -> receipt -> capsule.
- **Portable proof** issues signed verifier-facing artifacts.
- **Live proof** records what was actually observed at runtime.

The current codebase already has the core ingredients for a release layer. What is still being built is the common release kernel that can carry those ingredients consistently across multiple consequence types.

## Reference Financial Shape

The financial reference path currently includes:

- SQL governance
- policy and entitlement checks
- execution guardrails
- fixture, SQLite, and bounded PostgreSQL execution
- data contracts and reconciliation logic
- semantic clauses
- filing readiness
- signed certificates and verification kits
- reviewer endorsement and authority closure

This remains the strongest proving surface in the repository.

## Release-Layer Direction

The release-layer buildout is not trying to replace model runtimes, agent frameworks, or data systems.

It is trying to add a common decision boundary before output becomes:

- `communication`
- `record`
- `action`
- `decision-support`

That direction is tracked here:

- [Release layer buildout tracker](release-layer-buildout.md)

## Current Boundary

**Shipped**

- financial reference implementation
- signed single-query and multi-query proof
- real PostgreSQL-backed proof path
- bounded API service
- domain, connector, and filing registries
- Snowflake connector module
- XBRL mapping adapter
- OIDC verification first slice
- async API submission/status first slice
- first release-kernel vocabulary and object-model work

**Not shipped yet**

- consequence-specific release enforcement across the four canonical consequence types
- signed release token issuance for downstream consequence gating
- downstream verifier SDK/middleware
- centralized revocation/introspection for high-risk release paths
- reviewer queue UX for release decisions
- broader end-to-end domain implementations beyond finance
- distributed control plane
