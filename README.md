# Attestor

**Policy-bound release and authorization platform that sits before real consequence.**

One front door. One platform core. Modular packs for finance, crypto, and later consequence domains.

Attestor sits between a proposed consequence and the system that would make it real. Teams use it before accepting AI-assisted outputs, writing financial records, sending controlled communications, or allowing programmable-money execution.

Its job is simple: decide whether the proposed consequence may proceed, under what policy, with what authority, and with what durable evidence left behind. It keeps high-consequence workflows from crossing into production on informal trust alone.

> [!IMPORTANT]
> Attestor is the release / authorization / evidence layer before consequence. It is not the model, agent runtime, wallet, custody platform, or orchestration layer.

> [!NOTE]
> This repository is source-available under Business Source License 1.1. Non-production use is allowed. Production use requires a commercial license until the Change Date in [LICENSE](LICENSE).

## What Attestor Is

Attestor answers four practical questions:

- may this proposed consequence proceed at all?
- under what policy may it move forward?
- who or what authority can approve it?
- what evidence survives after the decision?

That pattern holds across both finance and programmable-money workflows.

## How Attestor works in practice

- A customer system proposes a sensitive output, record, action, or programmable-money move.
- It calls Attestor before the downstream system accepts or executes that consequence.
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

A practical adoption path is usually:

1. Start with one narrow consequence boundary, not a full platform rewrite.
2. Evaluate locally from this repo and the proof path, or through the hosted account path described in the docs.
3. Put Attestor in front of the downstream system that would otherwise accept or execute the sensitive consequence.
4. Move to production on the hosted path or a customer-operated deployment boundary, depending on control requirements.

The hosted path in this repo/docs includes account, API key, usage, and billing surfaces. The customer-operated path exists for teams that need stricter runtime and control boundaries. Production use is commercial under BSL 1.1 until the Change Date in [LICENSE](LICENSE).

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
| Finance | strongest end-to-end proof path; financial reporting is the deepest proving wedge | mature proving pack |
| Crypto | same core control model applied to programmable-money authorization and admission | `attestor/crypto-authorization-core` `20 / 20` complete; `attestor/crypto-execution-admission` `6 / 12` active buildout |

The crypto pack already covers the authorization core and several execution-admission surfaces, including wallet RPC, Safe guard, ERC-4337 bundler, modular-account runtime, and delegated-EOA runtime paths. It extends the same Attestor control model; it is not a separate product identity.

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
- [Financial reporting acceptance wedge](docs/01-overview/financial-reporting-acceptance.md)
- [Product packaging and pricing](docs/01-overview/product-packaging.md)
- [Hosted customer journey](docs/01-overview/hosted-customer-journey.md)
- [Release layer buildout](docs/02-architecture/release-layer-buildout.md)
- [Policy control-plane buildout](docs/02-architecture/release-policy-control-plane-buildout.md)
- [Enforcement-plane buildout](docs/02-architecture/release-enforcement-plane-buildout.md)
- [Crypto authorization core buildout](docs/02-architecture/crypto-authorization-core-buildout.md)
- [Crypto execution-admission buildout](docs/02-architecture/crypto-execution-admission-buildout.md)
- [Production readiness](docs/08-deployment/production-readiness.md)

## What Attestor is not

- Not the model
- Not the agent runtime
- Not the downstream system that actually writes, sends, files, executes, or settles
- Not a wallet or custody platform
- Not an orchestration framework or generic AI workspace
- Not a magical system that guesses the right path automatically
- Not proof that AI or programmable execution is inherently trustworthy
