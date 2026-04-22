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
- ERC-7769 defines ERC-4337 JSON-RPC methods such as `eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`, `eth_supportedEntryPoints`, and standard bundler error codes: [ERC-7769](https://eips.ethereum.org/EIPS/eip-7769)
- ERC-7579 and ERC-6900 define modular account/module/plugin execution surfaces that need explicit module, hook, and plugin admission evidence: [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579), [ERC-6900](https://eips.ethereum.org/EIPS/eip-6900)
- EIP-7702 introduces delegated EOA execution with authorization tuples, delegation indicators, and nonce-sensitive set-code behavior: [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
- Safe guards can make checks before and after Safe transactions, and Safe warns that broken guards can block execution, so guard admission must be explicit and recoverable: [Safe Guards](https://docs.safe.global/advanced/smart-account-guards), [Safe setModuleGuard](https://docs.safe.global/reference-smart-account/guards/setModuleGuard)
- x402 v2 uses HTTP-native 402 payment negotiation, `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, facilitator verification, and extensible scheme/network pairs: [x402](https://github.com/x402-foundation/x402)
- Fireblocks API co-signer callbacks are a custody chokepoint: without a Callback Handler the co-signer can automatically sign or approve requests, while reject declines and missing/retry responses fail the request, so Attestor custody admission must make callback configuration and response freshness fail-closed: [Fireblocks API Co-signers](https://developers.fireblocks.com/docs/cosigner-architecture-overview)
- Turnkey policy evaluation uses explicit allow/deny effects, consensus, explicit deny precedence, and implicit deny by default, which matches Attestor's custody callback normalization into allow / needs-review / deny outputs: [Turnkey policy engine](https://docs.turnkey.com/products/embedded-wallets/features/policy-engine)
- ERC-7683 defines cross-chain intent orders, filler responsibilities, origin/destination settler interfaces, fill instructions, nonce/deadline replay posture, and explicitly leaves settlement security evaluation to fillers and applications, so Attestor intent admission must bind the solver route before execution: [ERC-7683](https://eips.ethereum.org/EIPS/eip-7683)
- Across documents ERC-7683 in production through `AcrossOriginSettler`, `open()`, fill deadlines, encoded order data, destination-chain outputs, and fill tracking, which makes route/settlement/deadline evidence a concrete admission surface rather than a pure abstraction: [Across ERC-7683 in production](https://docs.across.to/guides/concepts/erc-7683)
- A 2026 arXiv analysis of intent-based cross-chain bridges highlights solver liquidity concentration, delayed settlement, and replay-based liquidity exhaustion attacks, which supports fail-closed liquidity, refund, counterparty, and replay checks in the solver handoff: [Liquidity exhaustion attacks in intent-based cross-chain bridges](https://arxiv.org/abs/2602.17805)
- OpenTelemetry models events as log records with event names, severity, body, and attributes, so Attestor crypto admission telemetry should emit structured event objects instead of free-form strings: [OpenTelemetry events](https://opentelemetry.io/docs/specs/semconv/general/events/), [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
- CloudEvents provides a common envelope for event metadata and routing, which fits cross-surface admission events that may be shipped to different customer-operated observability stacks: [CloudEvents CNCF project](https://www.cncf.io/projects/cloudevents/)
- W3C Trace Context standardizes `traceparent` and `tracestate` propagation, so crypto admission events and receipts should preserve trace correlation without inventing a custom trace header: [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- JSON Schema Draft 2020-12 is the current fixture/schema target because it is the documented meta-schema family for portable JSON validation and structured output contracts: [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- The CloudEvents 1.0 specification defines vendor-neutral event metadata and requires `specversion` `1.0`, which keeps admission fixture telemetry aligned with standard event envelopes: [CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)
- ERC-4337's bundler compatibility suite shows that external crypto infrastructure benefits from shared conformance fixtures that test EntryPoint support, simulation/validation rules, edge cases, and submission behavior: [ERC-4337 compatibility test suite](https://docs.erc4337.io/bundlers/compatibility-test-suite)
- WalletConnect's Wallet Call API documents EIP-5792 methods such as `wallet_sendCalls` and `wallet_getCapabilities` and CAIP-25 capability negotiation, which supports explicit wallet-RPC conformance fixtures instead of implicit wallet behavior: [WalletConnect Wallet Call API](https://docs.walletconnect.network/wallet-sdk/ios/eip5792)
- Node package `exports` defines explicit package entry points and encapsulates undeclared internal subpaths, which is why the final execution-admission surface stays behind `attestor/crypto-execution-admission` with package-boundary probes: [Node.js package exports](https://nodejs.org/api/packages.html#exports)

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
| Completed | 12 |
| In progress | 0 |
| Not started | 0 |
| Current posture | Complete; frozen crypto execution-admission buildout is packaged and ready for future work to start from a new tracker |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Define the crypto execution admission planner | `src/crypto-execution-admission/index.ts`, `tests/crypto-execution-admission.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | The first admission slice converts crypto authorization simulations into deterministic admission plans with adapter-to-surface mapping, required handoff artifacts, HTTP payment headers, fail-closed deny plans, missing-evidence next actions, canonical digests, and a packaged `attestor/crypto-execution-admission` subpath. |
| 02 | complete | Add wallet RPC admission for EIP-5792, ERC-7715, and ERC-7902 | `src/crypto-execution-admission/wallet-rpc.ts`, `tests/crypto-execution-admission-wallet-rpc.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | Admission plans now project into wallet RPC handoffs for capability discovery, `wallet_sendCalls`, status tracking, ERC-7715 execution-permission requests, supported-permission discovery, ERC-7902 capability expectations, optional Attestor sidecar metadata, canonical handoff digests, fail-closed unsupported-capability blocking, and missing-wallet-evidence next actions without making Attestor a wallet. |
| 03 | complete | Add Safe guard admission receipts | `src/crypto-execution-admission/safe-guard.ts`, `tests/crypto-execution-admission-safe-guard.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | Safe transaction guard and Safe module guard pre/post hook evidence now become durable Attestor admission receipts with guard/interface binding, Safe/module transaction hash binding, ERC-165 support posture, recovery posture, post-execution observation, canonical receipt digests, and fail-closed blocked/recovery-required outcomes. |
| 04 | complete | Add ERC-4337 bundler admission handoff | `src/crypto-execution-admission/erc4337-bundler.ts`, `tests/crypto-execution-admission-erc4337-bundler.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | Admission plans now project into ERC-7769 bundler JSON-RPC handoffs for chain/EntryPoint discovery, gas estimation, UserOperation submission, status/receipt lookup, Attestor sidecar evidence, EntryPoint support checks, ERC-7562 validation-scope expectations, paymaster posture, gas-fit enforcement, and fail-closed blocked/needs-bundler-evidence outcomes. |
| 05 | complete | Add modular account admission handoff | `src/crypto-execution-admission/modular-account.ts`, `tests/crypto-execution-admission-modular-account.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | ERC-7579 module and ERC-6900 plugin preflight evidence now becomes deterministic modular-account runtime admission handoffs with account/module/plugin binding, module type projection, execution-mode checks, selector-scope checks, hook evidence, ERC-6900 manifest binding, recovery posture, post-execution runtime observations, Attestor sidecar evidence, canonical digests, and fail-closed ready/needs-runtime-evidence/blocked outcomes. |
| 06 | complete | Add delegated EOA admission for EIP-7702 | `src/crypto-execution-admission/delegated-eoa.ts`, `tests/crypto-execution-admission-delegated-eoa.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | Admission plans now project into delegated-EOA runtime handoffs that bind authorization tuple evidence, delegate-code posture, authority nonce state, account code posture, wallet capability support, initialization posture, sponsorship posture, recovery posture, post-execution observation, Attestor sidecar evidence, canonical digests, and fail-closed ready/needs-runtime-evidence/blocked outcomes for EIP-7702 execution paths. |
| 07 | complete | Add x402 resource-server admission middleware | `src/crypto-execution-admission/x402-resource-server.ts`, `tests/crypto-execution-admission-x402-resource-server.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | x402 payment-server admission now becomes a deterministic middleware contract that binds `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, facilitator `/verify`, facilitator `/settle`, `PAYMENT-RESPONSE`, payment-identifier posture, fulfillment gating, Attestor sidecar evidence, canonical digests, and fail-closed ready/needs-http-evidence/blocked outcomes before a resource server may fulfill a paid request. |
| 08 | complete | Add custody policy admission callback contract | `src/crypto-execution-admission/custody-policy-callback.ts`, `tests/crypto-execution-admission-custody-policy-callback.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | Custody/co-signer provider callbacks now normalize into deterministic Attestor `allow` / `needs-review` / `deny` outputs with provider callback mode, auth protocol, response deadline, policy decision, approval quorum, callback authentication, freshness, Attestor token binding, screening, velocity, key posture, and post-execution expectations. |
| 09 | complete | Add intent-solver admission handoff | `src/crypto-execution-admission/intent-solver.ts`, `tests/crypto-execution-admission-intent-solver.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | Intent-solver routes now project into deterministic pre-execution handoffs that bind ERC-7683-style order evidence, solver route commitments, settlement contracts, fill instructions, slippage bounds, deadline windows, liquidity/refund posture, counterparty screening, Attestor sidecar evidence, replay protection, and post-settlement observation hooks before any route is opened, filled, submitted, or broadcast. |
| 10 | complete | Add admission telemetry and receipts | `src/crypto-execution-admission/telemetry-receipts.ts`, `tests/crypto-execution-admission-telemetry-receipts.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | Crypto execution admission now emits uniform admitted / blocked / missing-evidence / receipt-issued telemetry with CloudEvents-style metadata, OpenTelemetry-compatible severity and attributes, W3C trace-context correlation, in-memory sink and summary helpers, sensitive-marker safety checks, and HMAC-SHA256 signed admission receipts with verification across all admission surfaces. |
| 11 | complete | Add conformance fixtures for external integrators | `src/crypto-execution-admission/conformance-fixtures.ts`, `fixtures/crypto-execution-admission/conformance-fixtures.v1.json`, `fixtures/crypto-execution-admission/conformance-fixtures.schema.json`, `tests/crypto-execution-admission-conformance-fixtures.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md` | External integrators now get adapter-neutral JSON conformance fixtures covering wallet RPC, smart-account guard, ERC-4337 bundler, modular-account runtime, delegated-EOA runtime, x402 resource server, custody policy engine, and intent solver surfaces, with JSON Schema Draft 2020-12 shape metadata, plan/subject/telemetry/receipt binding checks, fixture-only signed receipt verification, and fail-closed integrator assertions. |
| 12 | complete | Package and document the execution-admission platform surface | `src/crypto-execution-admission/index.ts`, `tests/crypto-execution-admission-platform-surface.test.ts`, `scripts/probe-crypto-execution-admission-package-surface.mjs`, `package.json`, `docs/02-architecture/crypto-execution-admission-platform-surface.md`, `README.md`, `docs/02-architecture/system-overview.md` | Crypto execution admission now ships as a curated packaged platform surface with `cryptoExecutionAdmission`, `cryptoExecutionAdmissionPublicSurface()`, namespace grouping for planner/integration/proof modules, extraction criteria, fixture path disclosure, package-boundary probes, and platform-surface tests while keeping internal deep module paths private. |

## Immediate Next Step

The frozen crypto execution-admission buildout track is complete at `12 / 12`. Future work should start from a new tracker rather than extending this frozen step list.
