# System Overview

Architecture of Attestor as of April 22, 2026.

This document is the short architectural truth source. The README gives the product view; the trackers and platform-surface docs give the detailed implementation view.

## One Product

Attestor should be understood as one product:

**a policy-bound release and authorization platform for high-consequence systems**

The core pattern is:

```text
proposed output or operation -> policy, authority, and evidence -> admitted, reviewed, narrowed, or blocked consequence
```

That same pattern spans both AI-output release and programmable-money authorization. The architecture therefore has one shared core and multiple packs, not multiple unrelated products hiding in one repository.

## Shared Platform Core

The platform core is made of reusable layers:

| Layer | Role | Status |
|---|---|---|
| Release layer | decides whether a proposed consequence may proceed | `24 / 24` complete, packaged |
| Policy control plane | stores, signs, scopes, activates, rolls out, simulates, and audits policy | `20 / 20` complete, packaged |
| Enforcement plane | verifies authorization at downstream boundaries and fails closed without it | `20 / 20` complete, packaged |
| Crypto authorization core | extends the same decision model into programmable-money authorization objects and simulations | `20 / 20` complete, packaged |

The public package surfaces already reflect that shared core:

- `attestor/release-layer`
- `attestor/release-layer/finance`
- `attestor/release-policy-control-plane`
- `attestor/release-enforcement-plane`
- `attestor/crypto-authorization-core`
- `attestor/crypto-execution-admission`

These are stable import boundaries inside one modular monolith. They are not a claim that every layer is already a separately operated service.

## Pack Model

The pack model is:

- the platform core stays common
- domain or execution packs attach to that core
- packs reuse the same policy, proof, and authorization logic
- packs do not become separate products by default

Today the two most important packs are:

- **finance pack**: the strongest proven wedge
- **crypto pack**: the active programmable-money extension

## Finance Pack

Finance is still the deepest end-to-end proof surface.

The finance pack currently includes:

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

Finance is the current proof wedge, not the total definition of Attestor.

## Crypto Pack

The crypto pack is an extension of the same Attestor core.

Current status:

| Surface | Status |
|---|---|
| `attestor/crypto-authorization-core` | `20 / 20` complete, packaged |
| `attestor/crypto-execution-admission` | `12 / 12` complete, packaged |

What the crypto pack already covers:

- authorization vocabulary, object model, canonical references, and risk mapping
- EIP-712 envelopes, ERC-1271 projection, replay/freshness, and core bindings
- pre-execution simulation
- Safe transaction and module guard adapters
- ERC-4337 UserOperation adapter
- ERC-7579 and ERC-6900 modular account adapters
- EIP-7702 delegation-aware adapter
- x402 and custody/co-signer adapters
- execution-admission planning, wallet RPC handoffs, Safe guard receipts, ERC-4337 bundler handoffs, modular-account handoffs, delegated-EOA handoffs, x402 resource-server middleware, custody policy callback contracts, intent-solver admission handoffs, uniform admission telemetry / signed receipts, JSON conformance fixtures, and a curated package surface for external integrators

Current crypto execution-admission posture:

- the frozen execution-admission buildout is complete at `12 / 12`
- future crypto work should start from a new tracker rather than extending the frozen list

## Product Truth Versus First Slices

The following distinctions matter:

- the platform core is real and already strongly implemented
- the finance pack is the strongest end-to-end proof wedge
- the crypto pack is real, and the current authorization plus execution-admission package tracks are complete; future chain/customer deployment work should be tracked separately
- hosted account, billing, SSO, passkey, and tenant operations exist as product-surface slices inside the service, not as proof that every commercial surface is already independently mature
- healthcare, Snowflake, VSAC, and other supporting slices exist, but they are not as deep as the finance wedge
- distributed control-plane operation is not extracted into an independent multi-region service

So the honest architectural statement is:

**Attestor is one product with a real shared core and modular packs, but not every pack or supporting slice is equally mature.**

## Current Work Posture

Active priority:

- keep the product story centered on one Attestor platform
- keep the README and architecture docs aligned with the trackers
- keep the frozen crypto execution-admission track moving without letting the product story drift
- avoid presenting first-slice supporting surfaces as if they were the entire product story
