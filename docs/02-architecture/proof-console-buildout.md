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
| Completed | 1 |
| In progress | 0 |
| Not started | 7 |
| Current posture | Track opened; scope, vocabulary, research anchors, and anti-drift guardrails are defined before implementation starts |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Define the proof surface purpose, scope, vocabulary, and guardrails | `docs/02-architecture/proof-console-buildout.md`, `tests/proof-surface-docs.test.ts`, `README.md`, `package.json` | The track is explicitly an adoption/proof layer around the existing Attestor product, not a new product, wallet, custody platform, agent runtime, orchestration layer, or mock-only marketing demo. |
| 02 | not started | Add the proof scenario registry |  | Define a small typed registry for finance, crypto, and blocked/review scenarios. The registry should describe proposed consequence, pack family, Attestor entry point, expected decision, and proof material without invoking broad UI concerns. |
| 03 | not started | Add finance proof scenarios |  | Include at least one admit path and one review/block path tied to shipped finance/release proof behavior. Finance remains the deepest proof wedge. |
| 04 | not started | Add crypto admission proof scenarios |  | Include at least one admit path and one deny/needs-evidence path tied to `attestor/crypto-authorization-core` or `attestor/crypto-execution-admission`. Do not claim a public hosted crypto HTTP route. |
| 05 | not started | Add unified proof output shape |  | Output proposed consequence, policy check, authority check, evidence check, decision, reason, and proof material in one shared structure across packs. |
| 06 | not started | Add runnable local proof command or artifact generator |  | Prefer a deterministic CLI/static artifact first. A broad hosted console waits until the proof output shape is stable and tested. |
| 07 | not started | Add README "Run the proof" path |  | Link the runnable proof scenarios from the README without bloating the opening product story or claiming unfinished hosted capability. |
| 08 | not started | Add proof-surface readiness and anti-drift gates |  | Guard that scenarios use real shipped logic or fixtures, cover admit/review/block behavior, expose proof material, and preserve one-product positioning. |

## Immediate Next Step

Implement Step 02: add the proof scenario registry as a small typed surface that can describe finance, crypto, and blocked/review proof scenarios before any UI is added.
