# Release Layer Buildout Tracker

This file is the frozen implementation list for turning Attestor into a real release boundary between AI output and consequence.

## Guardrails For This Tracker

- The numbered step list below is **frozen** for this buildout track.
- Step ids and titles do **not** get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.

## Repository and Service Shape Decision

**Decision:** keep this work inside the main `attestor` repository as a **modular monolith first**, not as a separate repository or standalone service yet.

**Why this is the right starting point**

- The common release-kernel vocabulary and object model are still stabilizing.
- The finance-first proof surface, signing, evidence, and control-plane primitives already live in this repository.
- Splitting too early would force unstable contracts across repos and services before the consequence model is proven.

**What has to become true before extracting it later**

1. `releaseDecision` is stable.
2. `releaseToken` is stable.
3. At least two distinct consequence flows use the same release kernel.
4. The downstream verification contract is stable enough to be versioned independently.
5. Separate scaling and availability requirements clearly justify extraction.

**Research anchors**

- Microsoft documents monolithic deployments as the simplest deployment model and notes that many applications begin as monoliths before later evolution: [Common web application architectures](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures)
- AWS documents gradual extraction via the strangler fig pattern when boundaries are real and proven, rather than splitting first: [Strangler fig pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 24 |
| Completed | 1 |
| In progress | 0 |
| Not started | 23 |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Codify the shared release-kernel vocabulary | `src/release-kernel/types.ts`, `tests/release-kernel-types.test.ts` | Consequence types, risk classes, review authority defaults, and release decision status grammar are now first-class. |
| 02 | not_started | Define the versioned core object model | Pending | `releaseDecision`, `releaseToken`, `releaseConditions`, `reviewAuthority`, `evidencePack` |
| 03 | not_started | Define the consequence taxonomy rollout rules | Pending | `communication`, `record`, `action`, `decision-support` need consequence-specific contract guidance |
| 04 | not_started | Define the risk-to-control matrix | Pending | R0–R4 must map to deterministic checks, review mode, retention, and token enforcement |
| 05 | not_started | Choose the first hard gateway wedge | Pending | First enforceable flow should remain `AI output -> structured record` |
| 06 | not_started | Build the release policy language v1 | Pending | Output contract, capability boundary, and acceptance policy |
| 07 | not_started | Build the release decision engine skeleton | Pending | A first-class PDP for release evaluation |
| 08 | not_started | Implement deterministic release checks | Pending | Schema checks, capability checks, consequence-target checks |
| 09 | not_started | Implement immutable release decision logging | Pending | Structured audit trail for every release evaluation |
| 10 | not_started | Add shadow-mode release evaluation | Pending | Observe without blocking the downstream path |
| 11 | not_started | Canonicalize and hash releasable outputs | Pending | Stable `outputHash` and `consequenceHash` generation |
| 12 | not_started | Implement signed release token issuance | Pending | Short-lived authorization artifact |
| 13 | not_started | Implement downstream verification SDK/middleware | Pending | `no token -> no release` must be easy to adopt |
| 14 | not_started | Enforce one finance record path end to end | Pending | First fail-closed gateway path |
| 15 | not_started | Add token introspection for high-risk paths | Pending | Required for R3/R4 consequence release |
| 16 | not_started | Add token revocation and expiry handling | Pending | Explicit invalidation semantics |
| 17 | not_started | Add replay protection ledger | Pending | `jti`-bound or single-use issuance support |
| 18 | not_started | Build the reviewer queue UX | Pending | Reviewer decision needs to be fast and legible |
| 19 | not_started | Add named review and dual approval | Pending | Default authority model for R3/R4 |
| 20 | not_started | Add override and break-glass path | Pending | Emergency release with stronger audit and shorter validity |
| 21 | not_started | Sign and export the durable evidence pack | Pending | Longer-lived proof separate from the short-lived release token |
| 22 | not_started | Add policy rollout controls | Pending | Dry-run, canary, enforce, rollback |
| 23 | not_started | Launch the second and third canonical flows | Pending | `communication` then `action`, after `record` works |
| 24 | not_started | Package the release layer as a reusable platform surface | Pending | Stable SDKs, docs, and extraction criteria ready |

## Immediate Next Step

Step 02 is next. The goal is to define a versioned object model that every later API, token, evidence pack, and downstream verifier can share without ambiguity.
