# Attestor

**Policy-bound release and authorization platform that sits before real consequence.**

One product. One platform core. Hosted and customer-operated delivery paths. Modular packs for finance, crypto, and later consequence domains.

Attestor sits between a proposed consequence and the system that would make it real. Teams use it before accepting AI-assisted outputs, writing financial records, sending controlled communications, or allowing programmable-money execution.

Its job is simple: decide whether the proposed consequence may proceed, under what policy, with what authority, and with what durable evidence left behind.

Built for teams that cannot let sensitive outputs or execution paths enter production on informal trust.

> [!IMPORTANT]
> Attestor is the release / authorization / evidence layer before consequence. It is not the model, agent runtime, wallet, custody platform, or orchestration layer.

> [!NOTE]
> This repository is source-available under Business Source License 1.1. Non-production use is allowed. Production use requires a commercial license until the Change Date in [LICENSE](LICENSE).

## How Attestor works in practice

- A customer system proposes a sensitive output, record, action, or programmable-money move.
- It calls Attestor before the downstream system writes, sends, files, or executes that consequence.
- Attestor evaluates active policy, required authority, and evidence requirements.
- Attestor returns a bounded decision: admit, narrow, review, or block, plus proof material.
- The downstream system proceeds only when the decision allows it and otherwise fails closed.
- The result can be reviewed and independently verified later.

## One product, modular packs

Attestor is one product, not a collection of unrelated products.

The same platform core stays in place across domains: release decisions, policy activation, enforcement verification, and portable authorization objects. Finance and crypto sit on top of that shared core as modular packs.

- **Finance pack:** the strongest proof wedge today
- **Crypto pack:** the programmable-money extension on the same policy / authority / proof / fail-closed model
- **Later packs:** additional consequence domains can attach to the same core without becoming separate primary products by default

Attestor does not magically guess what to run. Customer systems call the relevant Attestor path for the consequence they want to control.

## Current proof wedge

The deepest proven wedge today is finance.

The first hard boundary is:

**AI output -> structured financial record release**

That is where weak acceptance models break quickly: reviewer authority matters, deterministic checks matter, portable proof matters, and auditability is not optional.

Finance is the current proving ground, not the ceiling of the platform.

See [AI-assisted financial reporting acceptance](docs/01-overview/financial-reporting-acceptance.md).

## How teams adopt Attestor

Teams buy a control layer, not a replacement for their existing systems.

Attestor is called from the customer's own environment. Customer data, business workflows, models, agents, wallets, and operational systems stay where they already are.

Teams are buying governed release and authorization infrastructure, portable proof, independent verification, and a bounded control point before consequence.

A practical buying path is simple:

- Evaluation starts on the free `community` path or locally from this repo.
- If the hosted path fits, teams sign up, receive the first API key, and upgrade through Stripe when moving onto a paid hosted plan.
- If stricter runtime or isolation is required, production moves through the enterprise customer-operated path.

In both paths, Attestor stays in front of an existing system that would otherwise write, send, file, or execute the consequence directly.

Paid hosted starts at `starter`; customer-operated production fits the enterprise path. Production use is commercial under BSL 1.1 until the Change Date in [LICENSE](LICENSE).

Need pricing, free evaluation, or hosted trial details? See [Commercial packaging, pricing, and evaluation](docs/01-overview/product-packaging.md).

Need the hosted sign-up, first API key, and checkout flow? See [Hosted customer journey](docs/01-overview/hosted-customer-journey.md).

Need the first hosted API call after signup? See [First hosted API call](docs/01-overview/hosted-first-api-call.md).

## Platform core

| Core layer | Role | Status |
|---|---|---|
| Release layer | consequence decisions, deterministic checks, tokens, reviewer queue, evidence packs | `24 / 24` complete, packaged |
| Policy control plane | signed policy bundles, activation, rollback, scoping, simulation, audit trail | `20 / 20` complete, packaged |
| Enforcement plane | offline/online verification, gateways, DPoP, mTLS/SPIFFE, HTTP message signatures | `20 / 20` complete, packaged |
| Crypto authorization core | programmable-money authorization vocabulary, bindings, simulation, adapter preflight | `20 / 20` complete, packaged |

## Pack status

| Pack | What it means today | Status |
|---|---|---|
| Finance | deepest proven path today; financial reporting is the current proving wedge | mature proving pack |
| Crypto | real programmable-money core on the same model, with packaged admission surfaces for external integrations | `attestor/crypto-authorization-core` `20 / 20` complete, packaged; `attestor/crypto-execution-admission` `12 / 12` complete, packaged |

The crypto pack already covers the authorization core and execution-admission surfaces, including wallet RPC, Safe guard, ERC-4337 bundler, modular-account runtime, delegated-EOA runtime, x402 resource-server middleware, custody policy callback paths, intent-solver handoffs, uniform admission telemetry / signed receipts, JSON conformance fixtures, and a curated package surface for external integrators. It extends the same Attestor control model; it is not a separate product identity.

## Proof and verification

Attestor does not stop at policy text. It produces portable proof material and supports independent verification.

Shortest proof path:

```bash
npm run showcase:proof:hybrid
npm run verify:cert -- .attestor/showcase/latest/evidence/kit.json
```

That path generates a live hybrid packet, then verifies the resulting kit outside the main runtime.

## Quick start

```bash
npm install

# Explore the reference scenarios
npm run list

# Run the bounded fixture scenario
npm run scenario -- counterparty

# Generate a signed proof for the same scenario
npm run prove -- counterparty

# Generate a live hybrid packet
npm run showcase:proof:hybrid

# Run the local verification gate
npm run verify
```

## Documentation map

- [System overview](docs/02-architecture/system-overview.md)
- [Release layer buildout](docs/02-architecture/release-layer-buildout.md)
- [Policy control-plane buildout](docs/02-architecture/release-policy-control-plane-buildout.md)
- [Enforcement-plane buildout](docs/02-architecture/release-enforcement-plane-buildout.md)
- [Crypto authorization core buildout](docs/02-architecture/crypto-authorization-core-buildout.md)
- [Crypto execution-admission buildout](docs/02-architecture/crypto-execution-admission-buildout.md)
- [Hosted product flow buildout](docs/02-architecture/hosted-product-flow-buildout.md)
- [Production readiness](docs/08-deployment/production-readiness.md)

## Start here

- Want the deepest proof wedge? Start with [Financial reporting acceptance](docs/01-overview/financial-reporting-acceptance.md).
- Want pricing, free evaluation, or hosted trial details? Start with [Commercial packaging, pricing, and evaluation](docs/01-overview/product-packaging.md).
- Want the managed customer path, sign-up flow, and billing handoff? Start with [Hosted customer journey](docs/01-overview/hosted-customer-journey.md).
- Want the first API call after signup? Start with [First hosted API call](docs/01-overview/hosted-first-api-call.md).

## What Attestor is not

- Not the model
- Not the agent runtime
- Not the downstream system that actually writes, sends, files, executes, or settles
- Not a wallet or custody platform
- Not an orchestration framework or generic AI workspace
- Not a magical system that guesses the right path automatically
- Not proof that AI or programmable execution is inherently trustworthy
