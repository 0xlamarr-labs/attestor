# Purpose

Use this page as the shortest internal orientation note.

For the public product framing, use the [README](../../README.md).
For the customer-facing operating model, use [Operating model](operating-model.md).
For the architecture map, use [System overview](../02-architecture/system-overview.md).
For commercial packaging, use [Commercial packaging, pricing, and evaluation](product-packaging.md).

## Current Repository Truth

Attestor is one product:

**a policy-bound release and authorization platform that sits before real consequence.**

The repository currently contains a shared platform core with curated package surfaces:

- `attestor/release-layer`
- `attestor/release-layer/finance`
- `attestor/release-policy-control-plane`
- `attestor/release-enforcement-plane`
- `attestor/crypto-authorization-core`
- `attestor/crypto-execution-admission`

These are repository and commercial/self-hosted import boundaries, not a public npm publication claim. `package.json` remains `private: true`; public npm distribution would require a separate release decision.

The finance pack remains the deepest proven wedge today. It carries the strongest end-to-end path for AI-assisted financial reporting acceptance, governed SQL, deterministic checks, release decisions, signed proof, reviewer authority, verification kits, and downstream consequence gating.

The crypto pack extends the same platform core into programmable-money authorization and execution admission. Its first public integration shape is packaged authorization/admission surfaces for external integrators, not a public hosted crypto HTTP route.

The hosted path includes account signup, the first API key, tenant API-key calls, usage and entitlement visibility, Stripe checkout and portal handoff, signed webhook convergence, billing export/reconciliation, and focused readiness gates.

The service/API refactor keeps the HTTP server thin: `api-server.ts` is now a small Hono composition root, with route registration, server lifecycle, runtime wiring, and route dependency construction under `src/service/bootstrap`.

Supporting slices such as healthcare, Snowflake, VSAC, observability, HA/DR, OIDC, SAML, passkeys, and live provider probes show architectural breadth. They are not all as deep as the finance proof wedge.

## What It Is

Attestor is a release and authorization layer before consequence.

It is used when a customer-controlled system has a proposed output, record, communication, action, filing-like artifact, or programmable-money execution path that should not proceed on informal trust.

The customer system calls Attestor before the downstream system writes, sends, files, executes, signs, broadcasts, settles, or routes the consequence. Attestor evaluates policy, authority, evidence, freshness, and enforcement posture, then returns a bounded decision and proof material.

The canonical customer-facing decision vocabulary is `admit`, `narrow`, `review`, or `block`. Domain-native surfaces may still expose older values, such as the finance hosted route's `pass` allow branch or the crypto package's `needs-evidence` review branch; [Operating model](operating-model.md) owns that mapping.

## What It Is Not

- not the model
- not the agent runtime
- not the downstream system of record
- not a financial chatbot
- not a wallet or custody platform
- not a bundler, paymaster, bridge, facilitator, solver, or relayer
- not an LLM orchestration framework
- not a BI front-end
- not a generic AI compliance checklist
- not a magical router that guesses the correct pack automatically

Attestor makes release into consequence governable. It does not make AI or programmable execution inherently trustworthy.

## Who This Is For

- teams introducing AI into high-consequence internal workflows
- reviewers and control functions who need evidence-bearing release decisions
- builders who need portable proof, not just a model answer
- organizations that want AI assistance without surrendering authority, auditability, or verification
- finance, crypto, healthcare, insurance, and internal AI platform teams that need a release or authorization boundary rather than another AI app
