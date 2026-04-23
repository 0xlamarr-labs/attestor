# Consequence Admission Buildout Tracker

This tracker covers the Attestor consequence-admission contract: the customer-facing operating model and typed decision facade that make the existing platform core easier to integrate.

The goal is not to add a second product, a crypto-only track, or another broad surface. The goal is to turn the existing Attestor platform into a simpler first integration path:

**proposed consequence -> Attestor admission decision -> proof -> downstream consequence only if allowed**

## Guardrails For This Tracker

- The numbered step list below is frozen for this buildout track.
- Step ids and titles do not get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.
- Keep Attestor as one product with one platform core and modular packs.
- Treat finance and crypto as pack families on the same consequence-admission model.
- Do not claim a public hosted crypto HTTP route until a route contract, implementation, tests, and tracker step exist.
- Do not claim a universal hosted admission route until the typed contract and route are implemented and tested.
- Do not make Attestor sound like a magical router that guesses packs automatically.
- Keep the public decision vocabulary bounded: `admit`, `narrow`, `review`, `block`.

## Why This Track Exists

The repo already has serious shipped surfaces:

- finance hosted proof wedge through `POST /api/v1/pipeline/run`
- signed proof verification through `POST /api/v1/verify`
- release-layer, policy-control-plane, and enforcement-plane package surfaces
- crypto authorization and execution-admission package surfaces
- local proof surface through `npm run proof:surface`

The remaining problem is the first integration mental model.

External users should not need to learn every internal domain decision before they understand the basic rule:

**Attestor returns whether a proposed consequence may proceed, with proof.**

## Fresh Research Anchors

Reviewed on 2026-04-23 before opening this track:

- NIST AI RMF frames trustworthy AI risk management around governed, mapped, measured, and managed risk processes; Attestor's admission contract should therefore make policy, authority, evidence, and decision posture explicit instead of implicit: [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)
- MCP authorization keeps authorization as an explicit protocol concern for tool/resource access; Attestor should preserve explicit caller-chosen paths rather than auto-detecting packs from ambiguous input: [MCP authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- x402 uses ordinary HTTP request/response flow to require payment evidence before a resource is served; Attestor's crypto admission work should keep the same before-consequence posture without becoming a wallet, facilitator, or custody service: [x402 docs](https://docs.x402.org/)
- Current runtime-guardrail research emphasizes intervention at execution time; Attestor should expose a small admission contract before downstream write/send/file/execute boundaries instead of only producing after-the-fact audit text: [Runtime guardrails](https://arxiv.org/abs/2604.05229)

## Canonical Vocabulary

| Term | Meaning |
|---|---|
| Proposed consequence | The output, record, message, payment, wallet action, filing-like action, or policy decision a downstream system wants to make real |
| Admission decision | The bounded customer-facing result: `admit`, `narrow`, `review`, or `block` |
| Policy check | The active policy material Attestor evaluates before consequence |
| Authority check | The actor, reviewer, signer, delegation, account, or token authority required for the action |
| Evidence check | The proof, fixture, receipt, simulation, signature, hash, or review material required before consequence |
| Proof material | The durable material a reviewer, auditor, verifier, or downstream system can inspect later |

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 6 |
| Completed | 1 |
| In progress | 0 |
| Not started | 5 |
| Current posture | Step 01 is complete: the operating model, canonical vocabulary, surface mappings, docs links, and anti-drift test are in place. Next work should add the typed canonical admission contract before adding or widening any hosted route. |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Codify the operating model and canonical admission vocabulary | `docs/01-overview/operating-model.md`, `docs/02-architecture/consequence-admission-buildout.md`, `tests/consequence-admission-operating-model.test.ts`, `README.md`, `docs/01-overview/purpose.md`, `docs/02-architecture/system-overview.md`, `docs/01-overview/hosted-first-api-call.md`, `docs/01-overview/finance-and-crypto-first-integrations.md`, `package.json` | Attestor now has a customer-facing truth source for proposed consequence -> explicit path -> policy/authority/evidence/freshness/enforcement checks -> canonical decision -> proof -> downstream enforcement. The docs explicitly map finance `pass` to canonical `admit`, crypto `needs-evidence` to `review`, and crypto `deny` to `block`, while blocking public hosted crypto route and universal admission route overclaims. |
| 02 | not started | Add the typed canonical admission contract |  | Define stable TypeScript types for proposed consequences, pack family, decision, checks, reasons, fail-closed posture, proof references, and domain-native mappings. |
| 03 | not started | Add finance decision mapping into the admission contract |  | Wrap the existing hosted finance proof wedge without changing its route behavior prematurely. The mapping should make `pass -> admit` explicit and preserve held/review/block semantics. |
| 04 | not started | Add crypto package outcome mapping into the admission contract |  | Wrap `CryptoExecutionAdmissionPlan.outcome` so package-native `admit`, `needs-evidence`, and `deny` project into the shared admission decision vocabulary. |
| 05 | not started | Add the first customer-facing admission facade |  | Add a small integration helper or hosted route only after the typed contract and mappings are tested. Do not claim a public hosted crypto HTTP route unless it is actually implemented and covered. |
| 06 | not started | Add admission readiness and quickstart gates |  | Add docs/tests that prove README, operating model, first-call docs, first-integration docs, package surfaces, and route/helper behavior stay aligned. |

## Immediate Next Step

Implement Step 02 before widening any public API story.

