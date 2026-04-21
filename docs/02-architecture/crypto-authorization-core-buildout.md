# Crypto Authorization Core Buildout Tracker

This file is the frozen implementation list for turning Attestor from a finance-proven release, policy, and enforcement platform into a reusable **crypto execution authorization core**: a policy-bound layer that can decide whether programmable-money movement, smart-account execution, delegation, permission grants, and agent payments may proceed.

## Guardrails For This Tracker

- The numbered step list below is **frozen** for this buildout track.
- Step ids and titles do **not** get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.

## Repository and Service Shape Decision

**Decision:** keep the crypto authorization core inside the main `attestor` repository as a **modular monolith extension of the packaged release layer, policy control plane, and enforcement plane**, not as a standalone chain-specific service yet.

**Why this is the right starting point**

- The existing `attestor/release-layer`, `attestor/release-policy-control-plane`, and `attestor/release-enforcement-plane` surfaces already define decision, policy lifecycle, verification, sender-constrained presentation, replay, online liveness, and fail-closed enforcement.
- The next missing capability is not a single Safe integration. It is a stable crypto authorization language that can survive multiple account models, wallet standards, custody surfaces, and payment protocols.
- Splitting into a separate service before the authorization object model, digest rules, and first adapter contracts are proven would freeze unstable protocol and SDK boundaries too early.

**What has to become true before extracting it later**

1. The crypto authorization object model is stable.
2. EIP-712 and ERC-1271 verification projections are stable enough to sign and verify outside the main runtime.
3. At least two independent execution adapters reuse the same authorization core.
4. The same policy dimensions work across wallet, custody, and programmable-payment paths.
5. Latency, chain-adjacent deployment, customer custody requirements, or verification environment requirements clearly justify a separate deployable boundary.

## Why This Track Is Next

The release, policy, and enforcement planes are now real:

- release decisions and release tokens are versioned
- policy bundles are signed, scoped, activated, rolled out, cached, audited, and packaged
- enforcement points can fail closed at HTTP, webhook, async, record-write, communication-send, action-dispatch, and proxy boundaries
- sender-constrained presentation, online introspection, replay defense, break-glass, telemetry, and conformance now exist behind a stable surface

What is still missing is the **programmable-money authorization substrate**:

- how Attestor describes a crypto consequence before it reaches a wallet, smart account, custody system, payment rail, bridge, or intent solver
- how an Attestor decision becomes a typed authorization artifact that wallets and contracts can verify
- how account-level authorization, wallet permissions, delegation, payment requirements, and custody approval policy fit into one model
- how the core stays adapter-neutral while still giving Safe, ERC-4337, ERC-7579, ERC-6900, EIP-7702, x402, and custody paths concrete integration points

Without this, Attestor can govern high-consequence software actions, but it is not yet positioned as the layer that sits before programmable money moves.

## Research Anchors

- EIP-712 defines deterministic typed structured data hashing and signing with domain separation, while explicitly leaving replay protection to protocol designers: [EIP-712](https://eips.ethereum.org/EIPS/eip-712)
- EIP-191 defines the signed-data envelope family that EIP-712 uses with version byte `0x01`; ERC-5267 standardizes retrieval of EIP-712 domain fields; ERC-7739's draft defensive rehashing pattern reinforces that smart-account signatures need explicit account, chain, and domain binding to avoid replay across accounts: [EIP-191](https://eips.ethereum.org/EIPS/eip-191), [ERC-5267](https://eips.ethereum.org/EIPS/eip-5267), [ERC-7739](https://eips.ethereum.org/EIPS/eip-7739)
- ERC-1271 defines contract signature validation so smart accounts, DAOs, and multisigs can validate signed actions without EOA private keys: [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- ERC-6492 extends ERC-1271 validation to predeploy/counterfactual smart accounts by wrapping factory preparation data and requiring wrapper detection before normal contract or EOA validation: [ERC-6492](https://eips.ethereum.org/EIPS/eip-6492)
- ERC-4337 defines the UserOperation and EntryPoint flow for account abstraction and programmable smart wallets, including `userOpHash` binding to EntryPoint and chain id plus validation data that can encode validity windows: [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337), [ERC-4337 docs](https://docs.erc4337.io/core-standards/erc-4337.html)
- EIP-5792 defines wallet batch-call and capability discovery RPCs, which makes wallet capabilities an explicit app-wallet negotiation surface: [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792)
- ERC-7715 defines wallet execution permission requests with scoped rules such as expiry constraints, opaque permission context for redemption, and wallet-side revocation mechanisms: [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715)
- ERC-7579 and ERC-6900 define modular smart-account and plugin/module standards, keeping validator, executor, fallback, hook, and module logic interoperable across account implementations: [ERC-7579](https://eips.ethereum.org/EIPS/eip-7579), [ERC-6900](https://eips.ethereum.org/EIPS/eip-6900)
- EIP-7702 introduces EOA authorization tuples for delegated execution with chain id, delegate address, and nonce checks, making authorization-list freshness a first-class account concern: [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
- Safe documents guards and module guards as execution-blocking smart-account hooks, with explicit warning that guards can block transaction execution: [Safe smart account overview](https://docs.safe.global/advanced/smart-account-overview), [Safe setModuleGuard](https://docs.safe.global/reference-smart-account/guards/setModuleGuard)
- x402 activates HTTP 402 for programmatic payments, especially machine-to-machine and agentic pay-per-use flows: [Coinbase x402 HTTP 402](https://docs.cdp.coinbase.com/x402/core-concepts/http-402)
- Custody and wallet infrastructure already treat authorization policy as a first-class control surface: [Turnkey policy engine](https://docs.turnkey.com/products/embedded-wallets/features/policy-engine), [Fireblocks authorization policy](https://developers.fireblocks.com/docs/set-transaction-authorization-policy)
- CAIP-2, CAIP-10, and CAIP-19 define chain-agnostic chain, account, and asset identifiers; EIP-55 and ERC-3770 remain useful display/adapter concerns rather than replacing the canonical core identity backbone: [CAIP-2](https://chainagnostic.org/CAIPs/caip-2), [CAIP-10](https://chainagnostic.org/CAIPs/caip-10), [CAIP-19](https://chainagnostic.org/CAIPs/caip-19), [EIP-55](https://eips.ethereum.org/EIPS/eip-55), [ERC-3770](https://eips.ethereum.org/EIPS/eip-3770)
- Recent crypto-risk data reinforces that authorization risk is concentrated around private-key compromise, personal-wallet compromise, bridge movement, high-value service compromise, and delegated/permissioned execution, so the core risk mapper must treat amount, counterparty, custody, bridge, approval, delegation, budget, expiry, and revocation posture as first-class signals: [Chainalysis 2025 Crypto Crime Trends](https://www.chainalysis.com/blog/2025-crypto-crime-report-introduction/), [Chainalysis 2025 Mid-Year Update](https://www.chainalysis.com/blog/2025-crypto-crime-mid-year-update/), [Chainalysis 2025 Crypto Theft](https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2026/), [Accounting-based Bridge Defenses](https://arxiv.org/abs/2410.01107)

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 20 |
| Completed | 9 |
| In progress | 0 |
| Not started | 11 |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Codify the crypto authorization vocabulary | `src/crypto-authorization-core/types.ts`, `tests/crypto-authorization-core-types.test.ts` | The crypto authorization core now has a stable first-class grammar for chain namespaces, runtime families, account kinds, asset kinds, consequence kinds, execution adapter kinds, authorization artifact kinds, policy dimensions, consequence-risk profiles, and normalized chain/account/asset/adapter references. |
| 02 | complete | Define the versioned crypto authorization object model | `src/crypto-authorization-core/object-model.ts`, `tests/crypto-authorization-core-object-model.test.ts` | The crypto authorization core now has versioned first-class objects for authorization intent, decision, receipt, execution projection, signer authority, policy scope, execution target, validity constraints, replay posture, digest modes, and signature-validation modes without binding the core to a single wallet, account, custody, or chain adapter. |
| 03 | complete | Define canonical chain, account, asset, and counterparty references | `src/crypto-authorization-core/canonical-references.ts`, `tests/crypto-authorization-core-canonical-references.test.ts` | The crypto authorization core now has CAIP-2 chain, CAIP-10 account, CAIP-19 asset, and counterparty references with explicit canonical JSON, SHA-256 digests, display separation, EVM address normalization, bundle binding, parser helpers, and invalid-reference rejection. |
| 04 | complete | Define crypto consequence risk mapping | `src/crypto-authorization-core/consequence-risk-mapping.ts`, `tests/crypto-authorization-core-risk-mapping.test.ts` | The crypto authorization core now maps consequence kind, account kind, asset kind, amount, counterparty, adapter, and execution-context signals into deterministic Attestor risk classes, review authority, required artifacts, policy dimensions, canonical assessment digests, and fail-closed review requirements. |
| 05 | complete | Define EIP-712 typed authorization envelopes | `src/crypto-authorization-core/eip712-authorization-envelope.ts`, `tests/crypto-authorization-core-eip712-envelope.test.ts` | The crypto authorization core now projects allowed Attestor decisions into EIP-712 typed data with explicit domain fields, ERC-5267-style domain metadata, EIP-191 structured-data prefix exposure, signer/account/chain binding, validity windows, nonce binding, and bytes32 digest coverage for references, intent, decision, risk assessment, and evidence. |
| 06 | complete | Define ERC-1271 smart-account validation projection | `src/crypto-authorization-core/erc1271-validation-projection.ts`, `tests/crypto-authorization-core-erc1271-validation.test.ts` | The crypto authorization core now distinguishes EOA and smart-account signature validation paths, projects ERC-1271 `isValidSignature(bytes32,bytes)` STATICCALL plans with magic-value result interpretation, and carries ERC-6492 counterfactual, ERC-7579 modular-validator, Safe guard, and ERC-7739 defensive-rehashing readiness without binding the core to a single adapter. |
| 07 | complete | Define replay, nonce, expiry, and revocation rules | `src/crypto-authorization-core/replay-freshness-rules.ts`, `tests/crypto-authorization-core-replay-freshness.test.ts` | The crypto authorization core now binds Attestor EIP-712 envelopes, intents, and decisions to deterministic validity windows, max-age limits, replay ledger keys, consume-on-allow posture, chain-authoritative adapter nonce checks for ERC-4337 and EIP-7702 paths, online revocation/liveness requirements, and fail-closed freshness evaluation. |
| 08 | complete | Bind crypto authorization to release-layer decisions | `src/crypto-authorization-core/release-decision-binding.ts`, `tests/crypto-authorization-core-release-binding.test.ts` | The crypto authorization core now projects crypto authorization outputs into real release-layer hash bundles, release decisions, reviewer authority checks, evidence artifact requirements, evidence-pack validation, and release-token posture while failing closed on mismatched hashes, weak authority, invalid signatures, replayed freshness, or inconsistent token claims. |
| 09 | complete | Bind crypto authorization to policy-control-plane scopes | `src/crypto-authorization-core/policy-control-plane-scope-binding.ts`, `tests/crypto-authorization-core-policy-scope-binding.test.ts` | Crypto authorization now projects chain/account/asset/counterparty/spender/protocol/function/budget scope into policy-control-plane activation targets, selectors, signed policy-pack artifacts, bundle records, activation records, simulation overlays, and audit append inputs while failing closed on missing risk-required dimensions, missing amount/budget/cadence/spender/protocol values, or mismatched release bindings. |
| 10 | not-started | Bind crypto authorization to enforcement-plane verification |  | Reuse offline/online verification, sender-constrained presentation, replay protection, degraded mode, and conformance for crypto execution boundaries. |
| 11 | not-started | Build the crypto authorization simulation surface |  | Let operators and integrations preview allow/deny/review outcomes for candidate crypto actions before any wallet, custody, or contract path is touched. |
| 12 | not-started | Add the Safe transaction guard adapter |  | Use the core authorization model to gate ordinary Safe transaction execution through a guard path without making Safe part of the core vocabulary. |
| 13 | not-started | Add the Safe module guard adapter |  | Gate module-initiated Safe transactions with Attestor authorization and explicit recovery/fail-closed posture. |
| 14 | not-started | Add approval and allowance consequence support |  | Treat token approvals, spender allowances, and permission-like grants as high-risk consequences with budget, expiry, revocation, and spender constraints. |
| 15 | not-started | Add the ERC-4337 UserOperation adapter |  | Project Attestor authorization into UserOperation validation and bundler/paymaster-aware execution paths. |
| 16 | not-started | Add ERC-7579 and ERC-6900 modular account adapters |  | Map Attestor authorization into validator, executor, hook, and plugin/module surfaces for modular smart accounts. |
| 17 | not-started | Add the EIP-7702 delegation-aware adapter |  | Model delegated EOA execution as an authorization-list-sensitive consequence with signer, code target, nonce, and runtime-context binding. |
| 18 | not-started | Add the x402 agentic payment adapter |  | Gate programmatic HTTP 402 payment flows and agent payments with Attestor budget, cadence, recipient, and evidence requirements. |
| 19 | not-started | Add the custody co-signer and policy-engine adapter |  | Integrate custody approval paths as Attestor-backed authorization evidence without replacing the custody platform's own key management or policy layer. |
| 20 | not-started | Package crypto authorization as a reusable platform surface |  | Promote the finished crypto authorization core behind a stable package subpath, extraction criteria, package-boundary probes, and platform-surface docs. |

## Immediate Next Step

Step 10 is next: bind crypto authorization to enforcement-plane verification.
