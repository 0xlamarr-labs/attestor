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
| Completed | 16 |
| In progress | 0 |
| Not started | 8 |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Codify the shared release-kernel vocabulary | `src/release-kernel/types.ts`, `tests/release-kernel-types.test.ts` | Consequence types, risk classes, review authority defaults, and release decision status grammar are now first-class. |
| 02 | complete | Define the versioned core object model | `src/release-kernel/object-model.ts`, `tests/release-kernel-object-model.test.ts` | `releaseDecision`, `releaseToken`, `releaseConditions`, `reviewAuthority`, and `evidencePack` are now versioned first-class objects with stable defaults. |
| 03 | complete | Define the consequence taxonomy rollout rules | `src/release-kernel/consequence-rollout.ts`, `tests/release-kernel-consequence-rollout.test.ts` | Consequence rollout order, enforcement posture, and contract/evidence expectations are now explicit for `communication`, `record`, `action`, and `decision-support`. |
| 04 | complete | Define the risk-to-control matrix | `src/release-kernel/risk-controls.ts`, `tests/release-kernel-risk-controls.test.ts` | R0-R4 now map to concrete deterministic checks, review posture, retention class, and token enforcement, aligned to current NIST AI RMF GenAI guidance, current AWS detect-only verification patterns, current OpenAI trace/evals guidance, and EU AI Act oversight/logging expectations. |
| 05 | complete | Choose the first hard gateway wedge | `src/release-kernel/first-hard-gateway-wedge.ts`, `tests/release-kernel-first-hard-gateway-wedge.test.ts` | The first enforceable path is now frozen as `AI output -> structured financial record release`, with explicit in-scope, out-of-scope, and fail-closed success criteria anchored to current SEC/ESMA/EBA structured reporting surfaces. |
| 06 | complete | Build the release policy language v1 | `src/release-kernel/release-policy.ts`, `tests/release-kernel-release-policy.test.ts` | Versioned release policies now express scope, output contract, capability boundary, acceptance rules, and release requirements in a declarative grammar aligned with current OPA/Cedar/validated-policy design patterns. |
| 07 | complete | Build the release decision engine skeleton | `src/release-kernel/release-decision-engine.ts`, `tests/release-kernel-release-decision-engine.test.ts` | A first-class PDP skeleton now resolves the active release policy, stamps an initial release decision, and emits the pending deterministic-check plan without yet executing the checks. |
| 08 | complete | Implement deterministic release checks | `src/release-kernel/release-deterministic-checks.ts`, `tests/release-kernel-release-deterministic-checks.test.ts` | Deterministic contract, boundary, hash, evidence, provenance, and downstream-receipt checks now execute as a reproducible runner and can advance the PDP from planned checks into concrete release outcomes. |
| 09 | complete | Implement immutable release decision logging | `src/release-kernel/release-decision-log.ts`, `tests/release-kernel-release-decision-log.test.ts` | Append-only, hash-linked release decision events now record policy-resolution and deterministic-check phases as verifiable audit evidence, aligned with current OPA decision-log practice, current NIST log-management guidance, and current QLDB-style digest-chain verification patterns. |
| 10 | complete | Add shadow-mode release evaluation | `src/release-kernel/release-shadow-mode.ts`, `tests/release-kernel-release-shadow-mode.test.ts` | Shadow-mode evaluation now computes the full would-decision, emits pass-through-with-warning semantics, and annotates what hard enforcement would have required, following current warn/audit-first policy rollout patterns from current Kubernetes admission policy guidance and current proxy/authz dry-run practices. |
| 11 | complete | Canonicalize and hash releasable outputs | `src/release-kernel/release-canonicalization.ts`, `tests/release-kernel-release-canonicalization.test.ts` | Stable canonical JSON envelopes and SHA-256 release hashes now bind the output artifact contract and the downstream consequence candidate, aligned with current RFC 8785 JSON canonicalization practice, current NIST SHA-256 guidance, and current structured-output contract discipline. |
| 12 | complete | Implement signed release token issuance | `src/release-kernel/release-token.ts`, `tests/release-kernel-release-token.test.ts` | Accepted and overridden release decisions can now issue short-lived EdDSA-signed JWT release tokens with stable `kid`, bounded expiry, and exported verification-key material, aligned with current RFC 7515/7519 JOSE patterns and current JOSE library practice. |
| 13 | complete | Implement downstream verification SDK/middleware | `src/release-kernel/release-verification.ts`, `tests/release-kernel-release-verification.test.ts` | Downstream services now have a verifier core, RFC6750-style token transport/error contract, binding checks for output/consequence/target, and a Hono middleware path that makes `no token -> no release` straightforward to adopt on the first hard gateway wedge. |
| 14 | complete | Enforce one finance record path end to end | `src/release-kernel/finance-record-release.ts`, `src/service/api-server.ts`, `tests/release-kernel-finance-record-release.test.ts`, `tests/live-api.test.ts` | The first real fail-closed gateway path now exists on the finance filing export surface: signed pipeline runs mint a hash-bound filing release artifact, and `POST /api/v1/filing/export` rejects missing or tampered release authorization before export. |
| 15 | complete | Add token introspection for high-risk paths | `src/release-kernel/release-introspection.ts`, `src/release-kernel/release-verification.ts`, `src/service/api-server.ts`, `tests/release-kernel-release-introspection.test.ts`, `tests/release-kernel-release-verification.test.ts`, `tests/live-api.test.ts` | High-risk release tokens now require active-status introspection in addition to cryptographic verification: the release authority plane registers issued tokens, the verifier checks active state for `R3/R4`, and the finance filing export path now proves this on the first hard gateway wedge using RFC 7662-style active/inactive semantics adapted to the release layer. |
| 16 | complete | Add token revocation and expiry handling | `src/release-kernel/release-token.ts`, `src/release-kernel/release-introspection.ts`, `src/release-kernel/release-verification.ts`, `src/service/http/routes/admin-routes.ts`, `tests/release-kernel-release-verification.test.ts`, `tests/release-kernel-release-introspection.test.ts`, `tests/live-api.test.ts` | Release tokens now distinguish natural expiry from explicit revocation: JOSE verification surfaces expiry clearly, the release registry persists `issued`/`expired`/`revoked` lifecycle state, admin operators can revoke issued release tokens explicitly on the first finance hard-gateway wedge, and downstream verification now blocks revoked tokens with a reason-specific fail-closed response aligned with current RFC 7009 / RFC 7662 lifecycle expectations. |
| 17 | not_started | Add replay protection ledger | Pending | `jti`-bound or single-use issuance support. |
| 18 | not_started | Build the reviewer queue UX | Pending | Reviewer decision needs to be fast and legible. |
| 19 | not_started | Add named review and dual approval | Pending | Default authority model for R3/R4. |
| 20 | not_started | Add override and break-glass path | Pending | Emergency release with stronger audit and shorter validity. |
| 21 | not_started | Sign and export the durable evidence pack | Pending | Longer-lived proof separate from the short-lived release token. |
| 22 | not_started | Add policy rollout controls | Pending | Dry-run, canary, enforce, rollback. |
| 23 | not_started | Launch the second and third canonical flows | Pending | `communication` then `action`, after `record` works. |
| 24 | not_started | Package the release layer as a reusable platform surface | Pending | Stable SDKs, docs, and extraction criteria ready. |

## Immediate Next Step

Step 17 is next. The goal is to add a replay-protection ledger so issued release authorization can become intentionally one-shot or bounded-use rather than reusable while still active.
