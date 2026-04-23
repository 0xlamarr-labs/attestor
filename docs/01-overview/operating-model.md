# Attestor Operating Model

Use this page as the customer-facing truth source for how Attestor is used before consequence.

For pricing and buying paths, use [Commercial packaging, pricing, and evaluation](product-packaging.md).
For hosted route order, use [Hosted journey contract](hosted-journey-contract.md).
For the first hosted call, use [First hosted API call](hosted-first-api-call.md).
For the finance and crypto entry points, use [Finance and crypto first integrations](finance-and-crypto-first-integrations.md).

## The Short Version

Attestor is called by a customer-controlled system before a sensitive output, record, action, message, filing-like artifact, or programmable-money execution becomes real.

The customer system does not hand ownership of the workflow to Attestor. It asks Attestor for an admission decision before the downstream system writes, sends, files, executes, signs, broadcasts, settles, or routes the consequence.

```text
proposed consequence
  -> explicit Attestor path or package boundary
  -> policy, authority, evidence, freshness, and enforcement checks
  -> canonical admission decision
  -> proof material
  -> downstream system proceeds only if allowed
```

Attestor does not auto-detect finance, crypto, or future packs from magic input. The customer chooses the relevant path for the consequence it needs to control.

## Canonical Admission Vocabulary

The public operating model should use one bounded decision vocabulary across packs:

| Decision | Meaning | Downstream posture |
|---|---|---|
| `admit` | The proposed consequence may proceed as requested. | Continue, while preserving proof material. |
| `narrow` | The proposed consequence may proceed only with a tighter scope, reduced authority, or stricter binding. | Continue only with the returned constraints. |
| `review` | The proposed consequence cannot proceed automatically because authority, evidence, risk, or policy closure is incomplete. | Route to review or hold. |
| `block` | The proposed consequence must not proceed. | Fail closed. |

This vocabulary is the customer-facing language. Some shipped surfaces still expose domain-native values because they predate the canonical admission facade.

## Current Surface Mapping

| Surface | Current shipped entry point | Current native decision | Canonical reading |
|---|---|---|---|
| Finance hosted proof wedge | `POST /api/v1/pipeline/run` | `decision`, including the finance allow value `pass`; signed runs can also include filing release status and proof material | `pass` is the finance allow branch and maps to `admit`; accepted filing releases map to `admit`; held/review-required paths map to `review`; denied, expired, revoked, or unknown paths map to `block`. |
| Crypto package integration | `attestor/crypto-authorization-core` and `attestor/crypto-execution-admission` | `CryptoExecutionAdmissionPlan.outcome`: `admit`, `needs-evidence`, or `deny` | package-native `admit` maps to canonical `admit`; `needs-evidence` maps to fail-closed `review`; `deny` maps to fail-closed `block`. |
| Local proof surface | `npm run proof:surface` | unified proof output decisions | Already uses `admit`, `narrow`, `review`, or `block`. |
| Signed proof verification | `POST /api/v1/verify` | verification status | Verifies proof material; it does not create a new consequence decision by itself. |

The typed contract lives in `src/consequence-admission/index.ts`. It defines the canonical request, response, check, proof, native-decision mapping, and fail-closed problem shapes without claiming a universal hosted admission route yet.

The finance projection lives in `src/consequence-admission/finance.ts`. It wraps the existing finance hosted route response into the canonical admission response shape without changing `POST /api/v1/pipeline/run` behavior.

The crypto projection lives in `src/consequence-admission/crypto.ts`. It wraps `CryptoExecutionAdmissionPlan` into the same canonical admission response shape through the package boundary, without claiming a public hosted crypto route.

## What A Customer Actually Does

1. The customer system prepares the proposed consequence and evidence it already has.
2. The customer calls the relevant Attestor hosted route or package boundary.
3. Attestor evaluates policy, authority, evidence, freshness, and enforcement posture.
4. Attestor returns a decision, reasons, proof references, and operational context.
5. The downstream system only proceeds if the decision allows it.
6. The customer keeps the proof material for review, audit, or independent verification.

That is the operating model whether the first integration is finance, crypto, or a later consequence pack.

## What Is Not Claimed Yet

- No public hosted crypto HTTP route is claimed until a route contract, implementation, tests, and tracker step exist.
- No universal hosted `admit` route is claimed until a route contract, implementation, tests, and tracker step exist.
- No automatic pack router is claimed.
- No wallet, custody, model-runtime, agent-runtime, or orchestration ownership is claimed.
- No downstream execution happens merely because Attestor returned a proof object; the customer-operated downstream system must enforce the returned decision.

## Design Rule For Future Work

Every new Attestor entry point should answer the same customer question:

> May this proposed consequence proceed, under this policy, with this authority, and with this evidence?

If the answer is not `admit`, the downstream system must not quietly continue.
