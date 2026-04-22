# System Overview

Architecture of Attestor as of April 22, 2026.

This document is the short architectural truth source. Detailed inventories stay in the buildout trackers and platform-surface documents linked from the README.

## Current Architectural Identity

Attestor is the policy-bound release, enforcement, and execution-authorization layer that sits before a proposed consequence is allowed to happen.

The common pattern is:

```text
proposed output or operation -> policy, authority, and evidence -> admitted, reviewed, narrowed, or blocked consequence
```

Finance remains the deepest proven domain wedge, but the platform architecture is broader than finance:

- release decisions govern AI-assisted outputs before they become communication, records, actions, or decision support
- policy-control-plane bundles decide which rules are active for a scoped workload or tenant
- enforcement-plane verifiers and PEP adapters fail closed at downstream boundaries
- crypto authorization and admission modules extend the same release discipline toward programmable-money execution

## Packaged Platform Surfaces

The reusable platform surfaces that are complete today are:

| Surface | Package subpath | Status |
|---|---|---|
| Release layer | `attestor/release-layer`, `attestor/release-layer/finance` | `24 / 24` complete, packaged |
| Release policy control plane | `attestor/release-policy-control-plane` | `20 / 20` complete, packaged |
| Release enforcement plane | `attestor/release-enforcement-plane` | `20 / 20` complete, packaged |
| Crypto authorization core | `attestor/crypto-authorization-core` | `20 / 20` complete, packaged |
| Crypto execution admission | `attestor/crypto-execution-admission` | `5 / 12` complete, active buildout |

The codebase is still one repository and one modular monolith. Package surfaces are stable import boundaries, not a claim that every module is already a separately operated service.

## Shipped Capabilities

The shipped platform capabilities include:

- typed release vocabulary, object model, consequence rollout, deterministic checks, risk controls, release decisions, decision logging, canonicalization, and release tokens
- token introspection, revocation, expiry, replay protection, reviewer queue, named review, dual approval, break-glass override, evidence packs, and release-layer package boundaries
- signed policy bundles, activation records, scoped policy resolution, simulation, impact summaries, audit logs, activation approvals, and policy-control package boundaries
- offline and online enforcement verification, freshness and replay rules, token exchange, DPoP, mTLS/SPIFFE, HTTP message signatures, async envelopes, Hono/Node middleware, webhook receiver, record-write gateway, communication-send gateway, action-dispatch gateway, Envoy/Istio external authorization, degraded-mode control, telemetry, conformance, and enforcement package boundaries
- crypto authorization vocabulary, object model, canonical chain/account/asset references, risk mapping, EIP-712 envelopes, ERC-1271 projection, replay/freshness rules, release/policy/enforcement binding, simulation, Safe adapters, ERC-4337, ERC-7579, ERC-6900, EIP-7702, x402, custody/co-signer adapters, and crypto authorization package boundaries
- crypto execution admission first slices for admission planning, wallet RPC handoffs, Safe guard receipts, ERC-4337 bundler handoffs, and ERC-7579/ERC-6900 modular account handoffs

## Deepest Proven Domain

Finance is still the strongest end-to-end proving surface.

The financial reference path includes:

- SQL governance
- policy and entitlement checks
- execution guardrails
- fixture, SQLite, and bounded PostgreSQL execution
- data contracts and reconciliation logic
- semantic clauses
- filing readiness
- signed certificates and verification kits
- reviewer endorsement and authority closure
- finance record-release enforcement as the first hard gateway wedge
- finance communication and action release flows in shadow-first posture

Finance is the current proof wedge, not the ceiling of the platform.

## First-Slice Or Not Yet Complete

The following areas exist, but should not be presented as fully complete products:

- hosted account, billing, SSO, passkey, and tenant operations are implemented as product-surface slices inside the service, not as a separately operated commercial SaaS deployment
- healthcare, Snowflake, VSAC, and other domain/connector paths are useful supporting slices, not as deep as the finance path
- distributed control-plane operation is not extracted into an independent multi-region service
- crypto execution admission has a packaged API for the first execution surfaces, but it is not yet a full crypto platform, wallet, custody product, bundler, payment facilitator, or intent-solver network

## Current Work Posture

Active priority:

- keep the core platform story coherent
- keep docs aligned with the trackers
- keep README scope tight enough to be readable
- avoid presenting first-slice product surfaces as complete markets

Active:

- finish the frozen crypto execution-admission buildout before the broader product packaging pass

The next frozen crypto execution-admission step is Step 06: delegated EOA admission for EIP-7702.
