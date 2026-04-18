# Release Policy Control-Plane Buildout Tracker

This file is the frozen implementation list for turning Attestor's packaged release layer into a real **policy control plane** instead of a collection of hard-coded policy factories.

## Guardrails For This Tracker

- The numbered step list below is **frozen** for this buildout track.
- Step ids and titles do **not** get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.

## Repository and Service Shape Decision

**Decision:** keep the policy control plane inside the main `attestor` repository as a **modular monolith extension of the packaged release-layer surface**, not as a standalone service yet.

**Why this is the right starting point**

- The `attestor/release-layer` and `attestor/release-layer/finance` public surfaces are now stable enough to build on.
- The next missing capability is not another consequence primitive, but policy lifecycle: storage, scoping, distribution, activation, rollback, and audit.
- Splitting into a separate service before the policy bundle format, scoping model, and rollout mechanics are proven would create unstable network contracts too early.

**What has to become true before extracting it later**

1. Policy bundle manifest and signature format are stable.
2. Policy discovery and distribution contracts are stable.
3. At least two domains or tenant classes use the same policy-control-plane primitives.
4. Policy activation and rollback semantics are stable enough to operate independently.
5. Scaling, isolation, or customer-operated requirements clearly justify a separate deployable boundary.

## Why This Track Is Next

The release engine is now real:

- release decisions are versioned
- tokens are signed, revocable, introspected, and replay-protected
- reviewer authority is explicit
- evidence is durable
- the release layer is packaged behind stable subpaths

What is still missing is the **operating system for policy itself**:

- where policies live
- who can change them
- how they are signed and distributed
- how tenants get different active policy versions
- how rollout, rollback, simulation, and audit work

Without that, Attestor has a strong release kernel but not yet a true release-policy control plane.

## Research Anchors

- Open Policy Agent documents bundle distribution and discovery as first-class policy lifecycle primitives rather than ad hoc file loading: [OPA bundles](https://www.openpolicyagent.org/docs/management-bundles), [OPA discovery](https://www.openpolicyagent.org/docs/management-discovery)
- Amazon Verified Permissions documents policy stores, schemas, validation, namespaces, and authorization as explicit control-plane resources: [Policy stores](https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/policy-stores.html), [Authorization](https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/authorization.html)
- Kubernetes admission guidance documents rollout, failure posture, filtering scope, latency, and auditability as part of production policy control, not optional extras: [Admission webhook good practices](https://kubernetes.io/docs/concepts/cluster-administration/admission-webhooks-good-practices/)

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 20 |
| Completed | 16 |
| In progress | 0 |
| Not started | 4 |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Codify the policy control-plane vocabulary | `src/release-policy-control-plane/types.ts`, `tests/release-policy-control-plane-types.test.ts` | The control plane now has a stable first-class grammar for policy pack lifecycle states, activation states, discovery modes, store kinds, scope dimensions, mutation actions, bundle references, and normalized activation targets/selectors built on the packaged release-layer consequence/risk vocabulary. |
| 02 | complete | Define the versioned policy-pack object model | `src/release-policy-control-plane/object-model.ts`, `tests/release-policy-control-plane-object-model.test.ts` | The control plane now has versioned first-class objects for policy packs, bundle manifests, bundle signatures, activation records, and compatibility-bearing control-plane metadata that bind directly to the packaged release-layer policy and rollout specs. |
| 03 | complete | Define scoping and precedence rules | `src/release-policy-control-plane/scoping.ts`, `tests/release-policy-control-plane-scoping.test.ts` | Scope resolution is now deterministic: environment is a hard exact boundary, null dimensions act as wildcards, account outranks tenant, wedge outranks domain, risk-class outranks consequence-type, plan is the lowest optional discriminator, and top-level precedence ties are treated as explicit control-plane conflicts instead of implicit winner-picking. |
| 04 | complete | Define the signed policy-bundle format | `src/release-policy-control-plane/bundle-format.ts`, `tests/release-policy-control-plane-bundle-format.test.ts` | Policy packs now freeze into deterministic, DSSE-ready bundle artifacts with canonical payloads, subject digests for pack/manifest/entries/schemas, manifest integrity checks, and explicit rejection of mismatched entry hashes. |
| 05 | complete | Implement policy-bundle signing and verification | `src/release-policy-control-plane/bundle-signing.ts`, `tests/release-policy-control-plane-bundle-signing.test.ts` | Policy bundles now have real DSSE-style signing and verification with explicit verification-key exports, signature-record coherence checks, wrong-key failure, payload-tamper rejection, and bundle-reference binding enforcement. |
| 06 | complete | Build the policy store abstraction | `src/release-policy-control-plane/store.ts`, `tests/release-policy-control-plane-store.test.ts` | The control plane now has an explicit repository contract for pack metadata, bundle history, signed bundle records, activation history, and metadata snapshots, with both in-memory and file-backed first-slice implementations. |
| 07 | complete | Build activation and rollback records | `src/release-policy-control-plane/activation-records.ts`, `tests/release-policy-control-plane-activation-records.test.ts` | Activation records now carry explicit rollout mode, reason code, operation type, supersession link, and rollback target fields, with lifecycle helpers that stage candidates, supersede prior exact-scope activations, and create rollback replacements on top of the control-plane store. |
| 08 | complete | Add discovery and bundle-resolution surface | `src/release-policy-control-plane/discovery.ts`, `tests/release-policy-control-plane-discovery.test.ts` | The control plane now has a first-class discovery surface with reserved scope labels, static vs scoped-active discovery handling, explicit bundle resource descriptors, and fail-closed bundle-resolution results for resolved, ambiguous, no-match, and missing-bundle cases. |
| 09 | complete | Build the active policy resolver | `src/release-policy-control-plane/resolver.ts`, `tests/release-policy-control-plane-resolver.test.ts` | The control plane now resolves the effective active policy for a request by composing bundle discovery, compatibility checks, entry-level scoped precedence, runtime release-policy matching, and rollout evaluation into one fail-closed resolution contract. |
| 10 | complete | Add policy simulation and dry-run API | `src/release-policy-control-plane/simulation.ts`, `tests/release-policy-control-plane-simulation.test.ts` | Operators can now resolve the current active policy, clone the control-plane snapshot into an isolated in-memory store, overlay a candidate signed bundle and activation posture, and compute a fail-closed dry-run result with explicit current-versus-simulated status and delta flags without mutating the persistent store. |
| 11 | complete | Add policy diff and impact summaries | `src/release-policy-control-plane/impact-summary.ts`, `tests/release-policy-control-plane-impact-summary.test.ts` | Operators can now compare current-versus-candidate bundles with structured entry-level semantic diffs, affected scope labels, consequence/risk coverage summaries, rollout/enforcement flags, and dry-run impact previews layered directly on top of the simulation and resolver surfaces. |
| 12 | complete | Build a policy test-pack format and runner | `src/release-policy-control-plane/test-pack.ts`, `tests/release-policy-control-plane-test-pack.test.ts` | Candidate bundles can now carry executable pre-activation expectations through versioned policy test packs. The runner executes required and advisory cases through the same dry-run preview path as the live control plane and returns a fail-closed run result that can gate activation on reproducible policy checks. |
| 13 | complete | Add immutable policy mutation audit logging | `src/release-policy-control-plane/audit-log.ts`, `tests/release-policy-control-plane-audit-log.test.ts` | Policy lifecycle mutations now have a separate hash-linked audit chain with in-memory and file-backed writers, stable mutation snapshots, tamper detection, append-only verification, and subject helpers for pack, bundle, and activation events. |
| 14 | complete | Add admin HTTP surfaces for policy control | `src/service/http/routes/release-policy-control-routes.ts`, `tests/release-policy-control-plane-admin-routes.test.ts` | Operators now have explicit admin-only policy-control HTTP routes for pack and bundle/version inspection, pack upsert, bundle publish, active resolution, candidate simulation, activation, rollback, and policy mutation audit verification, wired through the same store, simulation, activation, and tamper-evident audit primitives as the control plane. |
| 15 | complete | Add reviewer approval for policy activation | `src/release-policy-control-plane/activation-approvals.ts`, `tests/release-policy-control-plane-activation-approvals.test.ts`, `src/service/http/routes/release-policy-control-routes.ts` | High-impact policy activations now require a first-class approval request before promotion. R3 changes require named review, R4 changes require dual approval, self-approval is rejected, approval expiry and bundle/target mismatches fail closed, and the admin activation route now enforces the approval gate before mutating active policy state. |
| 16 | complete | Add emergency rollback and freeze switch | `src/release-policy-control-plane/activation-records.ts`, `src/release-policy-control-plane/discovery.ts`, `src/release-policy-control-plane/resolver.ts`, `src/service/http/routes/release-policy-control-routes.ts`, `tests/release-policy-control-plane-activation-records.test.ts`, `tests/release-policy-control-plane-discovery.test.ts`, `tests/release-policy-control-plane-resolver.test.ts`, `tests/release-policy-control-plane-admin-routes.test.ts` | Control-plane operations now have an explicit break-glass freeze and emergency rollback path. Frozen scopes fail closed in bundle discovery and active policy resolution, emergency routes require break-glass acknowledgement, privileged actor role, reason code, rationale, and audit metadata, and emergency rollback can restore a last-known-good activation after a freeze. |
| 17 | not_started | Add bundle caching, persistence, and freshness controls | Pending | Consumers need stable ETag/version/freshness semantics so discovery and bundle loading stay deterministic under failure and restart. |
| 18 | not_started | Migrate the finance proving policies onto the control plane | Pending | The current finance record/communication/action policies should be served through the control plane, not through direct in-process factory selection. |
| 19 | not_started | Add tenant-scoped progressive rollout | Pending | Enable bundle rollout by tenant/account/cohort so policy migration can move from global activation to controlled deployment. |
| 20 | not_started | Package the policy control plane as a reusable platform surface | Pending | Expose the stable public subpath and extraction criteria for the policy control plane just as the release layer itself now has a packaged surface. |

## Immediate Next Step

Step 17 is next. The goal is to add bundle caching, persistence, and freshness controls so consumers get deterministic policy-bundle loading semantics under restart, stale cache, and control-plane failure conditions.
