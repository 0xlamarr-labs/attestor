# Crypto Execution Admission Buildout Tracker

This file is the frozen implementation list for the next Attestor crypto branch after the completed crypto authorization core. The goal is to turn core authorization simulations into concrete admission plans that wallet RPCs, smart-account guards, account-abstraction bundlers, delegated EOA flows, x402 payment servers, custody policy engines, and intent solvers can use before execution.

## Guardrails For This Tracker

- The numbered step list below is frozen for this buildout track.
- Step ids and titles do not get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.

## Why This Track Exists

The crypto authorization core is complete and packaged. It now describes intents, risk, release bindings, policy scope, enforcement verification, and adapter-specific preflight for Safe, ERC-4337, ERC-7579, ERC-6900, EIP-7702, x402, and custody paths.

The next missing layer is execution admission:

- the core says whether a proposed programmable-money consequence is ready, blocked, or missing evidence
- an execution admission plan says exactly what an integration point must collect, block, submit, and record
- wallets, guards, bundlers, payment facilitators, custody engines, and solvers receive a bounded handoff rather than interpreting raw core objects differently

This keeps Attestor from becoming a chain-specific wallet, custody platform, or payment facilitator. Attestor remains the policy, authority, and evidence layer before execution.

## Fresh Research Anchors

Reviewed on 2026-04-22 before opening this track:

- EIP-5792 defines wallet RPCs for batched calls and wallet capability discovery, making wallet-app capability negotiation a first-class execution surface: [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792)
- ERC-7715 defines wallet execution permission requests, rules such as expiry, permission context, dependencies, and revocation: [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- ERC-7902 extends EIP-5792 with account-abstraction capabilities, including `eip7702Auth` for EIP-7702 authorization tuple generation: [ERC-7902](https://eips.ethereum.org/EIPS/eip-7902)
- ERC-1271 remains the smart-account signature validation base that contract accounts use to prove a signed action is valid: [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- ERC-4337 defines UserOperation submission and bundler handling outside consensus changes: [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- ERC-7579 and ERC-6900 define modular account/module/plugin execution surfaces that need explicit module, hook, and plugin admission evidence: [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579), [ERC-6900](https://eips.ethereum.org/EIPS/eip-6900)
- EIP-7702 introduces delegated EOA execution with authorization tuples, delegation indicators, and nonce-sensitive set-code behavior: [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
- Safe guards can make checks before and after Safe transactions, and Safe warns that broken guards can block execution, so guard admission must be explicit and recoverable: [Safe Guards](https://docs.safe.global/advanced/smart-account-guards), [Safe setModuleGuard](https://docs.safe.global/reference-smart-account/guards/setModuleGuard)
- x402 v2 uses HTTP-native 402 payment negotiation, `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, facilitator verification, and extensible scheme/network pairs: [x402](https://github.com/x402-foundation/x402)

## Architecture Decision

Start this layer as a packaged module inside the Attestor modular monolith:

- package subpath: `attestor/crypto-execution-admission`
- source: `src/crypto-execution-admission`
- dependency direction: admission depends on the crypto authorization core, release canonicalization, and public types; core does not depend on admission
- extraction rule: a standalone crypto admission service waits until a real integration needs low-latency chain adjacency, customer-operated custody boundaries, or separate deployment/isolation

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 12 |
| Completed | 2 |
| In progress | 0 |
| Not started | 10 |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Define the crypto execution admission planner | `src/crypto-execution-admission/index.ts`, `tests/crypto-execution-admission.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | The first admission slice converts crypto authorization simulations into deterministic admission plans with adapter-to-surface mapping, required handoff artifacts, HTTP payment headers, fail-closed deny plans, missing-evidence next actions, canonical digests, and a packaged `attestor/crypto-execution-admission` subpath. |
| 02 | complete | Add wallet RPC admission for EIP-5792, ERC-7715, and ERC-7902 | `src/crypto-execution-admission/wallet-rpc.ts`, `tests/crypto-execution-admission-wallet-rpc.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | Admission plans now project into wallet RPC handoffs for capability discovery, `wallet_sendCalls`, status tracking, ERC-7715 execution-permission requests, supported-permission discovery, ERC-7902 capability expectations, optional Attestor sidecar metadata, canonical handoff digests, fail-closed unsupported-capability blocking, and missing-wallet-evidence next actions without making Attestor a wallet. |
| 03 | not-started | Add Safe guard admission receipts |  | Bind Safe transaction and module guard prechecks to durable admission receipts and recovery posture. |
| 04 | not-started | Add ERC-4337 bundler admission handoff |  | Project admission plans into UserOperation simulation/submission envelopes with EntryPoint and paymaster evidence. |
| 05 | not-started | Add modular account admission handoff |  | Project ERC-7579/ERC-6900 module, hook, and plugin preflight evidence into admission receipts. |
| 06 | not-started | Add delegated EOA admission for EIP-7702 |  | Bind authorization tuple evidence, delegate code posture, nonce state, and wallet capability support to execution admission. |
| 07 | not-started | Add x402 resource-server admission middleware |  | Gate HTTP 402 payment verification and settlement through Attestor admission before resource fulfillment. |
| 08 | not-started | Add custody policy admission callback contract |  | Shape custody/co-signer provider callbacks into Attestor admission allow/deny/needs-review outputs. |
| 09 | not-started | Add intent-solver admission handoff |  | Bind solver route commitments, slippage, counterparties, settlement windows, and replay posture before intent execution. |
| 10 | not-started | Add admission telemetry and receipts |  | Emit uniform admitted/blocked/missing-evidence telemetry and signed admission receipts across all crypto execution surfaces. |
| 11 | not-started | Add conformance fixtures for external integrators |  | Provide adapter-neutral JSON fixtures that wallets, guards, bundlers, payment servers, custody engines, and solvers can test against. |
| 12 | not-started | Package and document the execution-admission platform surface |  | Promote the mature admission layer into a final documented platform surface with package-boundary probes and extraction criteria. |

## Immediate Next Step

Step 03 should use the planner and wallet RPC handoff surface to add Safe guard admission receipts. That is the best next move because Safe guards are a concrete institutional smart-account enforcement point where Attestor admission can become a pre-check and a durable receipt without requiring a new chain or wallet.
