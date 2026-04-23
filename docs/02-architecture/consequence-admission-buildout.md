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
- Step 03 research refreshed on 2026-04-23: SEC EDGAR Release 26.1 confirms finance filing surfaces keep changing and need route-specific proof context rather than generic claims: [SEC EDGAR Filer Manual](https://www.sec.gov/submit-filings/edgar-filer-manual)
- Step 03 research refreshed on 2026-04-23: OPA decision logs keep policy decision IDs, inputs, results, and masking concerns explicit; Attestor's finance adapter should preserve decision/proof references without copying sensitive raw inputs into the canonical admission object: [OPA decision logs](https://www.openpolicyagent.org/docs/management-decision-logs)
- Step 03 research refreshed on 2026-04-23: RFC 8785 keeps deterministic JSON canonicalization as the right shape for digestible admission records: [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
- Step 04 research refreshed on 2026-04-23: ERC-4337 keeps execution admission centered on UserOperation simulation and the EntryPoint pipeline, so Attestor should project package plans before bundler submission rather than pretending to be the bundler: [ERC-4337 docs](https://docs.erc4337.io/core-standards/erc-4337.html)
- Step 04 research refreshed on 2026-04-23: EIP-7702 delegated EOAs make account authority and delegate-code approval explicit, so denied or missing delegation evidence should project to fail-closed admission: [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
- Step 04 research refreshed on 2026-04-23: ERC-6900 modular accounts standardize plugin/module execution surfaces, supporting a package-boundary adapter model instead of a single magic crypto route: [ERC-6900](https://eips.ethereum.org/EIPS/eip-6900)
- Step 04 research refreshed on 2026-04-23: x402 keeps payment evidence in the HTTP request/response path before a resource is served, matching Attestor's before-consequence admission posture: [x402 docs](https://docs.x402.org/)
- Step 05 research refreshed on 2026-04-23: RFC 9457 keeps machine-readable HTTP problem details distinct from successful response contracts, so the facade should fail fast on unsupported surfaces rather than silently guessing: [RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457)
- Step 05 research refreshed on 2026-04-23: OpenAPI 3.1.1 keeps public API contracts explicit and versioned, so Attestor should publish a bounded package facade before claiming a universal hosted route: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)
- Step 05 research refreshed on 2026-04-23: OPA decision logs keep policy decisions, inputs, results, IDs, and masking concerns explicit; Attestor's facade should preserve entry-point and proof references without merging pack-specific evidence into a vague blob: [OPA decision logs](https://www.openpolicyagent.org/docs/management-decision-logs)
- Step 05 research refreshed on 2026-04-23: MCP authorization keeps authorization endpoints as explicit protocol surfaces; Attestor should require callers to choose `finance-pipeline-run` or `crypto-execution-plan` instead of auto-routing from ambiguous payloads: [MCP authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- Step 06 research refreshed on 2026-04-23: RFC 9457 reinforces that machine-readable API failure shapes should be stable and explicit; the readiness gate should therefore reject invented universal routes and unsupported surface guessing: [RFC 9457](https://www.ietf.org/rfc/rfc9457.html)
- Step 06 research refreshed on 2026-04-23: OpenAPI 3.1.1 describes API capabilities as explicit, human- and machine-readable contracts; Attestor's quickstart should point to the real hosted route and package facade rather than implying hidden auto-discovery: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)
- Step 06 research refreshed on 2026-04-23: OPA decision logs preserve decision IDs, inputs, results, and audit/debug context; Attestor's readiness gate should keep proof references and decision mappings visible across docs and code: [OPA decision logs](https://www.openpolicyagent.org/docs/management-decision-logs)
- Step 06 research refreshed on 2026-04-23: MCP authorization requires explicit bearer authorization on each HTTP request and clear protected-resource behavior; Attestor's first-call and admission docs should keep hosted finance auth separate from crypto package-boundary integration: [MCP authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)

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
| Completed | 6 |
| In progress | 0 |
| Not started | 0 |
| Current posture | Step 06 is complete: the consequence-admission quickstart and readiness gate now prove README, operating model, first-call docs, first-integration docs, package exports, facade descriptors, and route/helper behavior stay aligned. No frozen consequence-admission step remains. |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Codify the operating model and canonical admission vocabulary | `docs/01-overview/operating-model.md`, `docs/02-architecture/consequence-admission-buildout.md`, `tests/consequence-admission-operating-model.test.ts`, `README.md`, `docs/01-overview/purpose.md`, `docs/02-architecture/system-overview.md`, `docs/01-overview/hosted-first-api-call.md`, `docs/01-overview/finance-and-crypto-first-integrations.md`, `package.json` | Attestor now has a customer-facing truth source for proposed consequence -> explicit path -> policy/authority/evidence/freshness/enforcement checks -> canonical decision -> proof -> downstream enforcement. The docs explicitly map finance `pass` to canonical `admit`, crypto `needs-evidence` to `review`, and crypto `deny` to `block`, while blocking public hosted crypto route and universal admission route overclaims. |
| 02 | complete | Add the typed canonical admission contract | `src/consequence-admission/index.ts`, `tests/consequence-admission-contract.test.ts`, `package.json`, `docs/02-architecture/consequence-admission-buildout.md` | The canonical contract now defines versioned request/response types, pack families, explicit entry points, proposed consequence shape, policy/authority/evidence inputs, policy/authority/evidence/freshness/enforcement/adapter-readiness checks, `admit` / `narrow` / `review` / `block` decisions, proof refs, fail-closed problem details, canonical digests, and native mapping helpers for finance pipeline decisions and crypto execution-admission outcomes. Unknown native values fail closed, `narrow` requires explicit constraints, and `review` / `block` default to fail-closed posture. |
| 03 | complete | Add finance decision mapping into the admission contract | `src/consequence-admission/finance.ts`, `src/consequence-admission/index.ts`, `tests/consequence-admission-finance.test.ts`, `docs/01-overview/operating-model.md`, `docs/01-overview/hosted-first-api-call.md`, `docs/01-overview/finance-and-crypto-first-integrations.md`, `package.json` | The finance adapter wraps the current hosted finance pipeline response into a canonical admission request/response without changing route behavior. It maps native pipeline `pass` to `admit`, accepted filing release status to `admit`, held/review-required status to fail-closed `review`, denied/expired/revoked/unknown paths to fail-closed `block`, and emits policy/authority/evidence/freshness/enforcement/adapter-readiness checks plus certificate, verification-kit, release-token, release-evidence-pack, and review-queue proof references when present. |
| 04 | complete | Add crypto package outcome mapping into the admission contract | `src/consequence-admission/crypto.ts`, `src/consequence-admission/index.ts`, `tests/consequence-admission-crypto.test.ts`, `docs/01-overview/operating-model.md`, `docs/01-overview/finance-and-crypto-first-integrations.md`, `package.json` | The crypto adapter wraps `CryptoExecutionAdmissionPlan` into canonical admission request/response objects through a package-boundary entry point. Package-native `admit` maps to canonical `admit`, `needs-evidence` maps to fail-closed `review`, and `deny` maps to fail-closed `block`. The adapter emits policy/authority/evidence/freshness/enforcement/adapter-readiness checks plus admission-plan, simulation, and source-module proof references while explicitly keeping `route: null` for crypto. |
| 05 | complete | Add the first customer-facing admission facade | `src/consequence-admission/facade.ts`, `src/consequence-admission/index.ts`, `tests/consequence-admission-facade.test.ts`, `scripts/probe-consequence-admission-package-surface.mjs`, `package.json`, `docs/01-overview/operating-model.md`, `docs/01-overview/finance-and-crypto-first-integrations.md`, `tests/consequence-admission-operating-model.test.ts` | The first public facade is exported through `attestor/consequence-admission`. It requires an explicit `finance-pipeline-run` or `crypto-execution-plan` surface, delegates to the tested finance and crypto projections, preserves `/api/v1/pipeline/run` as the finance hosted route, preserves `attestor/crypto-execution-admission` as the crypto package boundary, rejects automatic pack detection, and keeps `publicHostedCryptoRouteClaimed: false`. |
| 06 | complete | Add admission readiness and quickstart gates | `docs/01-overview/consequence-admission-quickstart.md`, `tests/consequence-admission-readiness.test.ts`, `tests/consequence-admission-operating-model.test.ts`, `package.json`, `README.md`, `docs/01-overview/operating-model.md`, `docs/01-overview/hosted-first-api-call.md`, `docs/01-overview/finance-and-crypto-first-integrations.md`, `docs/02-architecture/system-overview.md`, `docs/02-architecture/consequence-admission-buildout.md` | The quickstart documents how to use `attestor/consequence-admission` without inventing a universal hosted route, preserves finance as `POST /api/v1/pipeline/run`, preserves crypto as `attestor/crypto-execution-admission` with `route: null`, and names the readiness/package/full verify gates. The readiness test proves README, operating model, first-call docs, first-integration docs, tracker posture, package export, facade descriptor, finance route descriptor, crypto package descriptor, native mapping helpers, and fail-fast explicit-surface behavior stay aligned. |

## Immediate Next Step

No frozen consequence-admission step remains. Future admission expansion should start from a new explicit tracker or an intentional extension to this completed track.
