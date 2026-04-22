# Proof Surface Buildout Tracker

This tracker covers the Attestor proof surface: the visible, runnable path that helps an outside evaluator understand what Attestor does before consequence.

The goal is not to add another product line. The goal is to make the existing Attestor platform core easy to see, run, inspect, and verify.

## Guardrails For This Tracker

- The numbered step list below is frozen for this buildout track.
- Step ids and titles do not get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.
- Keep Attestor as one product with one platform core and modular packs.
- Treat finance and crypto scenarios as demonstrations of the same platform core, not as separate product identities.
- Do not turn the proof surface into a wallet, custody platform, model runtime, agent runtime, orchestration layer, or generic dashboard.
- Do not ship mock-only marketing output. Every scenario must be backed by shipped Attestor logic, package surfaces, fixtures, or verification material.
- Do not describe crypto as generally available through a public hosted HTTP route unless a committed route contract, implementation, test, and tracker step exist.
- Keep the public mental model simple: proposed consequence -> Attestor checks policy, authority, and evidence -> decision -> proof.

## Why This Track Exists

Attestor already has a serious platform core: release decisions, policy activation, enforcement verification, finance proof flows, crypto authorization, crypto execution admission, hosted account flow, and verification tooling.

The remaining problem is external legibility.

A serious buyer, engineer, or partner should not need to read the whole repository before they understand the core reflex:

**Before consequence, there must be proof.**

The proof surface exists to make that reflex visible:

1. choose a concrete scenario
2. run it through Attestor
3. see the proposed consequence
4. see the policy, authority, and evidence checks
5. see the bounded decision: `admit`, `narrow`, `review`, or `block`
6. inspect the proof packet, receipt, fixture, or verification material
7. understand where a real downstream system would fail closed or proceed

This is an adoption and proof layer around the existing product, not a replacement for the product.

## Fresh Research Anchors

Reviewed on 2026-04-22 before opening this track:

- Ehrenberg-Bass mental availability guidance emphasizes distinctive assets and category entry points; Attestor's category entry point is the moment a system is about to create real consequence: [Ehrenberg-Bass](https://marketingscience.info/how-do-you-measure-how-brands-grow/)
- Behavioural Insights Team's EAST framework says behavior change should be easy, attractive, social, and timely; Attestor's proof surface should therefore be runnable, visually plain, evidence-backed, and tied to the moment before action: [EAST framework](https://www.bi.team/publications/east-four-simple-ways-to-apply-behavioural-insights/)
- Stanford Web Credibility guidance says credibility improves when claims are easy to verify, the site looks appropriate for its purpose, and evidence is visible; Attestor's demo should therefore expose verification material instead of relying on positioning alone: [Stanford Web Credibility Guidelines](https://credibility.stanford.edu/guidelines/index.html)
- The FTC dark-patterns report warns against designs that trick or manipulate users; Attestor's adoption surface must build recognition through clarity and proof, not through deceptive urgency, hidden terms, or fake social proof: [FTC dark patterns report](https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers)

Reviewed again on 2026-04-22 before Step 03:

- SEC Inline XBRL guidance describes Inline XBRL as a structured data language that lets filers prepare one document that is both human-readable and machine-readable, supporting the finance proof scenario's focus on structured filing-preparation evidence: [SEC Inline XBRL](https://www.sec.gov/about/inline-xbrl)
- The SEC adopted the updated EDGAR Filer Manual for EDGAR Release 26.1 in March 2026, keeping filing preparation tied to current EDGAR procedural requirements rather than a static historical demo: [SEC Adoption of Updated EDGAR Filer Manual](https://www.sec.gov/rules-regulations/2026/03/33-11411)
- XBRL International describes iXBRL as an open standard for reports that preserve human presentation while providing structured, machine-readable data, reinforcing why Attestor's first finance proof scenario binds output hashes, evidence, and release status before filing-like consequence: [XBRL iXBRL](https://www.xbrl.org/ixbrl)

Reviewed again on 2026-04-22 before Step 04:

- EIP-7702 defines set-code transactions for EOAs with an authorization list of tuples, which is the right official anchor for delegated-EOA authorization evidence and fail-closed tuple checks: [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
- x402 uses standard HTTP request/response semantics around `402 Payment Required`, with payment instructions and signed payment evidence before fulfillment; this anchors the agent-payment proof scenario without claiming Attestor is a wallet or payment facilitator: [x402 docs](https://docs.x402.org/)
- ERC-4337 documentation and the EIP both keep UserOperation simulation and EntryPoint validation as the account-abstraction pre-execution surface; this remains adjacent evidence for later proof scenarios but Step 04 stays on x402 and EIP-7702: [ERC-4337 docs](https://docs.erc4337.io/core-standards/erc-4337.html), [EIP-4337](https://eips.ethereum.org/EIPS/eip-4337)
- Safe guard documentation names `checkTransaction` and `checkAfterExecution` as guard hooks; this confirms the broader admission mental model while Step 04 avoids adding a Safe-specific proof run: [Safe guard docs](https://docs.safe.global/advanced/smart-account-guards/smart-account-guard-tutorial)

Reviewed again on 2026-04-22 before Step 05:

- W3C Verifiable Credentials 2.0 keeps evidence as supporting information that a verifier can inspect, which reinforces the proof surface need for explicit proof materials and evidence anchors instead of a UI-only status: [W3C VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- CloudEvents defines a compact interoperable envelope with required context attributes such as `id`, `source`, `type`, and `specversion`; the proof output should keep stable context fields now so Step 06 can later render static artifacts or events without reshaping the contract: [CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)
- OpenTelemetry event semantic conventions emphasize named events with attributes for context, supporting a uniform proof output that separates the bounded decision from structured check attributes and evidence references: [OpenTelemetry events](https://opentelemetry.io/docs/specs/semconv/general/events/)
- NIST AI RMF guidance keeps governance, measurement, and management tied to documentation and transparency; Attestor's proof output therefore needs a single inspectable record across packs, not finance-only or crypto-only output shapes: [NIST AI RMF Playbook](https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook)

Reviewed again on 2026-04-22 before Step 06:

- SLSA provenance guidance keeps attestations attached to artifacts and emphasizes immutable, inspectable provenance, so the proof surface should emit a file manifest and digest chain instead of only console text: [SLSA provenance](https://slsa.dev/spec/v1.0/requirements)
- in-toto attestations model a signed statement around a subject and predicate, reinforcing the need for explicit proof outputs and artifact references that can later be wrapped by stronger signing flows without changing the local artifact contract: [in-toto attestations](https://github.com/in-toto/attestation)
- JSON Schema Draft 2020-12 keeps machine validation as a first-class JSON document concern; Step 06 therefore keeps proof output as structured JSON with stable version fields rather than a markdown-only demo: [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- CloudEvents JSON format keeps event envelopes portable through `id`, `source`, `type`, and related context attributes; the local artifact generator keeps the unified output envelope stable so later event publishing can be added without reshaping scenario evidence: [CloudEvents JSON format](https://github.com/cloudevents/spec/blob/main/cloudevents/formats/json-format.md)

Reviewed again on 2026-04-22 before Step 07:

- GitHub README guidance says the README should contain the information needed to get started while longer documentation belongs elsewhere; Step 07 should therefore add a compact run path and keep tracker detail in architecture docs: [GitHub Docs: About READMEs](https://docs.github.com/articles/about-readmes/)
- Google developer documentation style guidance emphasizes clear, consistent technical writing for developer audiences; the README proof path should use plain command-and-output language rather than architecture-first explanation: [Google developer documentation style guide](https://developers.google.com/style)
- Diataxis separates tutorials, how-to guides, reference, and explanation; the README should act as a short entry point and point deeper readers to the proof-surface tracker instead of becoming the whole proof-surface guide: [Diataxis](https://diataxis.fr/)
- The Good Docs Project describes quickstarts as first-use entry points; the README should let evaluators run one proof command before asking them to understand every pack and verification path: [The Good Docs Project templates](https://www.thegooddocsproject.dev/template)

Reviewed again on 2026-04-22 before Step 08:

- SLSA requires provenance to identify produced artifacts by cryptographic digest and to be available to consumers, which supports adding an automated gate that validates proof manifests, output digests, and deterministic file refs: [SLSA requirements](https://slsa.dev/spec/v1.0/requirements)
- in-toto attestations keep proof statements structured around subjects and predicates; the readiness gate should therefore validate explicit proof material and evidence anchors instead of relying on prose-only claims: [in-toto attestation framework](https://github.com/in-toto/attestation)
- OpenSSF Scorecard frames repository health as automated checks, reinforcing that proof-surface readiness must run in `npm test` and `npm run verify`, not live as a manual review checklist: [OpenSSF Scorecard](https://securityscorecards.dev/)
- NIST SSDF emphasizes repeatable secure development practices; the proof surface needs repeatable anti-drift gates for one-product positioning, shipped source grounding, and overclaim prevention: [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final)

## Architecture Decision

Start the proof surface as a small, testable product-adoption layer inside the existing modular monolith:

- canonical tracker: `docs/02-architecture/proof-console-buildout.md`
- first surface shape: scenario registry plus deterministic proof output
- first UX target: CLI/static artifact before broad hosted UI
- scenario families: finance release, crypto admission, and blocked/review high-consequence actions
- proof rule: every scenario must expose decision reason and verification material or explicitly name the shipped fixture/package surface it uses
- extraction rule: a hosted visual console waits until the scenario registry and proof output are stable and tested

## Scenario Vocabulary

The proof surface uses one shared vocabulary across packs:

| Term | Meaning |
|---|---|
| Proposed consequence | The output, record, message, payment, wallet action, filing-like action, or policy decision a downstream system wants to make real |
| Policy check | The active rule set Attestor evaluates before the consequence is allowed through |
| Authority check | The actor, reviewer, delegation, token, or account authority Attestor requires for the action |
| Evidence check | The proof, receipt, fixture, signature, hash, or review material Attestor requires before consequence |
| Decision | A bounded result: `admit`, `narrow`, `review`, or `block` |
| Proof material | The portable artifact, receipt, evidence kit, fixture, or verification path that lets the result be inspected later |

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 8 |
| Completed | 8 |
| In progress | 0 |
| Not started | 0 |
| Current posture | The proof surface buildout is complete for this frozen track. Evaluators can run `npm run proof:surface`, inspect `.attestor/proof-surface/latest/manifest.json`, and rely on automated readiness gates that keep runnable outputs, registry definitions, artifact digests, shipped source grounding, proof material exposure, README positioning, and no-hosted-route claims aligned |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Define the proof surface purpose, scope, vocabulary, and guardrails | `docs/02-architecture/proof-console-buildout.md`, `tests/proof-surface-docs.test.ts`, `README.md`, `package.json` | The track is explicitly an adoption/proof layer around the existing Attestor product, not a new product, wallet, custody platform, agent runtime, orchestration layer, or mock-only marketing demo. |
| 02 | complete | Add the proof scenario registry | `src/proof-surface/scenario-registry.ts`, `src/proof-surface/index.ts`, `tests/proof-surface-scenario-registry.test.ts`, `package.json` | The registry defines five grounded proof scenarios across finance, crypto, and general fail-closed consequences. Each scenario carries a human hook, proposed consequence, real package/source entry points, expected bounded decision, proof material, customer value, and non-goals. The guard test verifies scenario uniqueness, package-surface binding, source/export grounding, proof material existence, finance/crypto/general coverage, admit/review/block coverage, and the no-hosted-crypto-route constraint. |
| 03 | complete | Add finance proof scenarios | `src/proof-surface/finance-scenarios.ts`, `src/proof-surface/index.ts`, `tests/proof-surface-finance-scenarios.test.ts`, `package.json`, `docs/02-architecture/proof-console-buildout.md` | Finance proof runs now execute the shipped finance filing release bridge, release decision engine, deterministic checks, canonical release material, and domain finalization. The admit scenario reaches `accepted` with canonical hashes and authority satisfied; the review scenario keeps evidence sufficient while authority remains pending, producing `review-required` and fail-closed downstream behavior. |
| 04 | complete | Add crypto admission proof scenarios | `src/proof-surface/crypto-scenarios.ts`, `src/proof-surface/index.ts`, `tests/proof-surface-crypto-scenarios.test.ts`, `package.json`, `docs/02-architecture/proof-console-buildout.md` | Crypto proof runs now execute the shipped x402 agentic payment adapter, EIP-7702 delegation adapter, crypto authorization simulation, crypto execution-admission planner, and signed admission receipt verifier. The x402 scenario reaches `admit` on the `agent-payment-http` surface with PAYMENT handoff artifacts; the delegated EOA scenario injects invalid authorization tuple evidence and reaches fail-closed `deny` on the `delegated-eoa-runtime` surface. No public hosted crypto HTTP route is claimed. |
| 05 | complete | Add unified proof output shape | `src/proof-surface/unified-output.ts`, `src/proof-surface/index.ts`, `tests/proof-surface-unified-output.test.ts`, `package.json`, `docs/02-architecture/proof-console-buildout.md` | Finance and crypto scenario runs now normalize into `attestor.proof-surface.output.v1`: source, proposed consequence, shared policy/authority/evidence checks, bounded decision, proof materials, evidence anchors, canonical JSON, output id, and digest. The shape intentionally keeps pack-specific finance material and crypto admission internals out of the top-level output while preserving evidence refs and anchors for later rendering. |
| 06 | complete | Add runnable local proof command or artifact generator | `src/proof-surface/artifact-generator.ts`, `src/proof-surface/index.ts`, `scripts/render-proof-surface.ts`, `tests/proof-surface-artifact-generator.test.ts`, `package.json`, `docs/02-architecture/proof-console-buildout.md` | `npm run proof:surface` renders a deterministic local artifact set under `.attestor/proof-surface/latest` by default: manifest, bundle, markdown summary, and per-scenario unified proof outputs. The manifest records decision counts, pack-family counts, file refs, and digests. This remains a local artifact generator, not a hosted console or public crypto HTTP route. |
| 07 | complete | Add README "Run the proof" path | `README.md`, `tests/proof-surface-docs.test.ts`, `docs/02-architecture/proof-console-buildout.md` | The README now names `npm run proof:surface`, explains the local `.attestor/proof-surface/latest/` output set, links the proof-surface tracker from Start here, and preserves the no-hosted-console / no-public-hosted-crypto-route guardrail. |
| 08 | complete | Add proof-surface readiness and anti-drift gates | `tests/proof-surface-readiness.test.ts`, `package.json`, `tests/proof-surface-docs.test.ts`, `docs/02-architecture/proof-console-buildout.md` | `npm run test:proof-surface-readiness` now verifies runnable output order, admit/review/block coverage, registry-vs-output decision alignment, fail-closed posture, proof material exposure, evidence anchors, canonical digest integrity, manifest file refs, real source/fixture/command grounding, one-product README/tracker positioning, no hosted-console/public-hosted-crypto-route overclaims, and `npm test`/`npm run verify` wiring. |

## Immediate Next Step

No frozen proof-surface step remains. Future proof-surface expansion should start from a new explicit tracker or an intentional extension to this completed track.
