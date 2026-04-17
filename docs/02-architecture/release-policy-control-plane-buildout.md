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
| Completed | 3 |
| In progress | 0 |
| Not started | 17 |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Codify the policy control-plane vocabulary | `src/release-policy-control-plane/types.ts`, `tests/release-policy-control-plane-types.test.ts` | The control plane now has a stable first-class grammar for policy pack lifecycle states, activation states, discovery modes, store kinds, scope dimensions, mutation actions, bundle references, and normalized activation targets/selectors built on the packaged release-layer consequence/risk vocabulary. |
| 02 | complete | Define the versioned policy-pack object model | `src/release-policy-control-plane/object-model.ts`, `tests/release-policy-control-plane-object-model.test.ts` | The control plane now has versioned first-class objects for policy packs, bundle manifests, bundle signatures, activation records, and compatibility-bearing control-plane metadata that bind directly to the packaged release-layer policy and rollout specs. |
| 03 | complete | Define scoping and precedence rules | `src/release-policy-control-plane/scoping.ts`, `tests/release-policy-control-plane-scoping.test.ts` | Scope resolution is now deterministic: environment is a hard exact boundary, null dimensions act as wildcards, account outranks tenant, wedge outranks domain, risk-class outranks consequence-type, plan is the lowest optional discriminator, and top-level precedence ties are treated as explicit control-plane conflicts instead of implicit winner-picking. |
| 04 | not_started | Define the signed policy-bundle format | Pending | Turn policies from in-process factories into portable, hashable, signable bundles with manifest integrity and explicit compatibility metadata. |
| 05 | not_started | Implement policy-bundle signing and verification | Pending | Add cryptographic signing and verification for policy bundles so activation can be gated on verified provenance instead of trust-by-location. |
| 06 | not_started | Build the policy store abstraction | Pending | Add a first-class store/repository layer for policy packs, bundle versions, activation state, and version history rather than scattering policy state across route wiring. |
| 07 | not_started | Build activation and rollback records | Pending | Model policy activation as an auditable resource with staged rollout, supersession, rollback target, actor, and reason fields. |
| 08 | not_started | Add discovery and bundle-resolution surface | Pending | Introduce a discovery contract that tells consumers which bundle to load and under what labels/scope, aligned with modern policy-distribution practice. |
| 09 | not_started | Build the active policy resolver | Pending | Replace direct policy-factory selection with a control-plane-backed resolver that returns the effective active policy bundle for a request scope. |
| 10 | not_started | Add policy simulation and dry-run API | Pending | Operators need to ask “what would this policy do?” before activation; simulation must become a first-class control-plane capability. |
| 11 | not_started | Add policy diff and impact summaries | Pending | Show semantic differences between policy versions, affected scopes, and consequence/risk changes before rollout. |
| 12 | not_started | Build a policy test-pack format and runner | Pending | Policy changes should carry executable checks and example cases so bundle activation depends on verifiable policy tests, not just syntax. |
| 13 | not_started | Add immutable policy mutation audit logging | Pending | Policy create/update/activate/rollback actions need their own tamper-evident audit chain, separate from release-decision logs. |
| 14 | not_started | Add admin HTTP surfaces for policy control | Pending | Introduce explicit operator routes for policy packs, versions, simulation, activation, rollback, and audit inspection. |
| 15 | not_started | Add reviewer approval for policy activation | Pending | High-impact policy changes should require named review and, where needed, dual approval before they can become active. |
| 16 | not_started | Add emergency rollback and freeze switch | Pending | Control-plane operations need an explicit break-glass rollback/freeze path so bad policy rollouts can be contained immediately. |
| 17 | not_started | Add bundle caching, persistence, and freshness controls | Pending | Consumers need stable ETag/version/freshness semantics so discovery and bundle loading stay deterministic under failure and restart. |
| 18 | not_started | Migrate the finance proving policies onto the control plane | Pending | The current finance record/communication/action policies should be served through the control plane, not through direct in-process factory selection. |
| 19 | not_started | Add tenant-scoped progressive rollout | Pending | Enable bundle rollout by tenant/account/cohort so policy migration can move from global activation to controlled deployment. |
| 20 | not_started | Package the policy control plane as a reusable platform surface | Pending | Expose the stable public subpath and extraction criteria for the policy control plane just as the release layer itself now has a packaged surface. |

## Immediate Next Step

Step 04 is next. The goal is to turn policy packs into portable, hashable bundle artifacts with a frozen signed-bundle format.
