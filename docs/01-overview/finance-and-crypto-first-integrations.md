# Finance And Crypto First Integrations

This document shows how the same Attestor adoption model maps into the finance and crypto packs.

It is not a second product page. Finance and crypto are modular packs on the same Attestor platform core.

Use this after:

- [Operating model](operating-model.md)
- [Consequence admission quickstart](consequence-admission-quickstart.md)
- [Hosted customer journey](hosted-customer-journey.md)
- [First hosted API call](hosted-first-api-call.md)
- [Hosted journey contract](hosted-journey-contract.md)

## The Shared Model

Every first integration follows the same shape:

1. a customer-controlled system prepares a proposed consequence
2. the system calls Attestor or an Attestor package boundary before the consequence happens
3. Attestor evaluates policy, authority, evidence, freshness, and adapter readiness
4. the downstream system only proceeds if the returned decision allows it
5. the customer keeps proof, usage, entitlement, and operational evidence attached to the same Attestor account/adoption path

Attestor does not auto-detect finance or crypto from magic input. The customer chooses the relevant path for the consequence it needs to control.

Canonical admission vocabulary is shared across packs: `admit`, `narrow`, `review`, or `block`. Current shipped surfaces may expose domain-native values; this guide names the mapping when that happens.

The shared package facade is `attestor/consequence-admission`. It can project the current finance route result or a crypto execution plan into the canonical admission shape, but the caller must choose `finance-pipeline-run` or `crypto-execution-plan` explicitly. This keeps one product shape without pretending that crypto already has a hosted public route.

## Finance First Integration

Finance is the deepest proven path today.

The first finance integration is a hosted HTTP gate before a financial record, report, communication, action, or filing-like consequence enters production.

| Integration question | Finance answer |
|---|---|
| Customer system | reporting pipeline, analytics workflow, data warehouse job, filing workflow, or review tool |
| Attestor entry point | `POST /api/v1/pipeline/run` |
| Auth boundary | `Authorization: Bearer <tenant_api_key>` |
| First request object | `candidateSql`, `intent`, optional evidence fixtures or connector-backed execution, optional `sign` |
| Returned decision | domain-native finance `decision`, proof posture, tenant context, usage, optional certificate and release summaries |
| Downstream gate | only write, send, file, export, or route to review if the Attestor decision allows it |
| Proof path | signed response material can be checked through `POST /api/v1/verify` |

Minimal sequence:

```text
hosted signup
  -> first tenant API key
  -> GET /api/v1/account/usage
  -> POST /api/v1/pipeline/run
  -> gate the downstream finance consequence on the returned decision
  -> optionally POST /api/v1/verify for signed proof material
```

Use [First hosted API call](hosted-first-api-call.md) for the concrete request shape.

For the finance hosted route, `pass` maps to canonical `admit`. Signed filing releases can also project accepted, held/review-required, denied, expired, revoked, and unknown statuses into `admit`, `review`, or fail-closed `block`. That typed projection lives in `src/consequence-admission/finance.ts` and does not change the hosted route contract.

What Attestor is doing in this path:

- checking SQL and execution shape before unsafe work proceeds
- checking policy, entitlement, data contracts, guardrails, and report structure
- returning a bounded decision before the financial consequence
- producing evidence that can be reviewed or verified later

What Attestor is not doing:

- replacing the data warehouse
- replacing the finance system of record
- becoming the filing workspace
- deciding that a financial output is true merely because an AI produced it

## Crypto First Integration

Crypto uses the same Attestor control model, but the current public crypto entry point is a packaged integration boundary, not a new hosted HTTP route.

The crypto pack is for systems that need a policy-bound admission decision before programmable-money execution reaches a wallet, smart-account guard, bundler, delegated EOA runtime, x402 resource server, custody policy engine, or intent solver.

| Integration question | Crypto answer |
|---|---|
| Customer system | wallet, Safe guard, account-abstraction bundler, modular-account runtime, delegated EOA flow, x402 resource server, custody policy engine, or intent solver |
| Attestor entry point today | `attestor/crypto-authorization-core` and `attestor/crypto-execution-admission` package subpaths |
| Auth/adoption boundary | same customer account/commercial path for adoption; execution admission is currently integrated by the customer-operated runtime or sidecar |
| First authorization object | crypto authorization simulation result from the core/adapters |
| First admission object | `CryptoExecutionAdmissionPlan` from `createCryptoExecutionAdmissionPlan()` |
| Returned decision | package-native outcome: `admit`, `needs-evidence`, or `deny` |
| Downstream gate | only submit, broadcast, fulfill, sign, or settle if admission is `admit` |
| Proof path | admission telemetry, signed admission receipts, and JSON conformance fixtures |

Minimal package-side sequence:

```ts
import {
  createCryptoExecutionAdmissionPlan,
  cryptoExecutionAdmissionAdapterProfile,
} from 'attestor/crypto-execution-admission';

const profile = cryptoExecutionAdmissionAdapterProfile('erc-4337-user-operation');

const plan = createCryptoExecutionAdmissionPlan({
  simulation,
  createdAt: new Date().toISOString(),
  integrationRef: 'integration:erc4337:bundler',
});

if (plan.outcome !== 'admit') {
  throw new Error(`Attestor admission blocked execution: ${plan.nextActions.join(', ')}`);
}

// Only now may the customer-operated bundler path continue.
```

The `simulation` object is produced by the crypto authorization core and its adapter preflight evidence. It is not guessed from a wallet transaction by a magical router.

For the crypto package path, package-native `admit` maps to canonical `admit`, `needs-evidence` maps to fail-closed `review`, and `deny` maps to fail-closed `block`. That typed projection lives in `src/consequence-admission/crypto.ts` and keeps the current entry point as a package boundary rather than a public hosted crypto route.

Choose the first crypto surface by where the consequence would happen:

| Consequence surface | First Attestor surface |
|---|---|
| wallet app or dapp wants batched calls | wallet RPC admission |
| Safe transaction or module execution | Safe guard admission receipt |
| ERC-4337 UserOperation | bundler admission handoff |
| ERC-7579 or ERC-6900 modular account | modular-account runtime handoff |
| EIP-7702 delegated EOA | delegated EOA admission handoff |
| HTTP-native agent payment | x402 resource-server admission middleware |
| custody withdrawal or co-signer callback | custody policy callback contract |
| intent or cross-chain solver route | intent-solver admission handoff |

What Attestor is doing in this path:

- checking that the proposed programmable-money consequence matches policy scope
- checking release, policy, enforcement, replay, nonce, expiry, and adapter readiness
- producing a deterministic admission plan for the customer-operated integration point
- giving wallets, guards, bundlers, custody systems, payment servers, and solvers a fail-closed handoff

What Attestor is not doing:

- becoming a wallet
- becoming a custody platform
- becoming a bundler, paymaster, bridge, facilitator, solver, or relayer
- signing customer transactions with customer keys
- inventing an on-chain route that is not already implemented

## When To Use Which First

| If the first buyer problem is... | Start with... |
|---|---|
| AI-assisted finance output must be accepted, reviewed, or released safely | finance hosted API path |
| a financial reporting workflow needs proof before downstream consequence | finance hosted API path |
| a wallet, Safe, bundler, custody engine, or payment server needs pre-execution authorization | crypto package integration path |
| a team needs account, billing, usage, and entitlement onboarding before integration work | hosted customer journey |

The commercial/adoption story remains one Attestor story. The integration surface changes because the downstream consequence changes.

## Guardrail

Do not describe crypto as generally available through a public hosted route until a committed route contract, test, and tracker say so.

Today the honest shape is:

- finance first integration: hosted API route
- crypto first integration: packaged authorization/admission surface for external integrators
- same Attestor platform core and commercial/adoption model
