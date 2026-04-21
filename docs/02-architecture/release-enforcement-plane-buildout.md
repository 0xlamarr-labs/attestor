# Release Enforcement Plane Buildout Tracker

This file is the frozen implementation list for turning Attestor's packaged release layer and policy control plane into a real **distributed enforcement plane** where downstream boundaries fail closed unless they receive valid Attestor release authorization.

## Guardrails For This Tracker

- The numbered step list below is **frozen** for this buildout track.
- Step ids and titles do **not** get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.

## Repository and Service Shape Decision

**Decision:** keep the enforcement plane inside the main `attestor` repository as a **modular monolith extension of the packaged release-layer and policy-control-plane surfaces**, not as a standalone service yet.

**Why this is the right starting point**

- `attestor/release-layer` and `attestor/release-policy-control-plane` now exist as curated public surfaces to build on.
- The next missing capability is not another policy primitive, but reusable enforcement points, verifier contracts, sender-constrained presentation modes, and boundary adapters.
- Splitting into a separate service before the verifier contract, presentation model, and boundary adapters are proven would create unstable network and SDK contracts too early.

**What has to become true before extracting it later**

1. The enforcement verifier contract is stable.
2. At least two independent enforcement-point topologies reuse the same verification core.
3. Sender-constrained presentation is stable across both HTTP and service-to-service paths.
4. Workload identity and trust-anchor handling are stable enough to operate independently.
5. Latency, blast-radius, or customer-operated deployment requirements clearly justify a separate boundary.

## Why This Track Is Next

The release and policy layers are now real:

- release decisions are versioned
- release tokens are signed, revocable, introspected, and replay-protected
- reviewer authority and break-glass are explicit
- policy bundles are signed, scoped, activated, rolled out, and packaged behind stable subpaths

What is still missing is the **distributed policy enforcement point layer**:

- how downstream systems verify release authorization locally
- how high-risk paths re-check liveness and revocation online
- how release authorization is bound to the actual caller instead of acting as a reusable bearer
- how HTTP, webhook, proxy, and async boundaries fail closed consistently
- how customers adopt Attestor as an actual enforcement boundary instead of only a release-decision service

Without that, Attestor is a strong policy decision and policy administration system, but not yet a pervasive policy enforcement plane.

## Research Anchors

- NIST defines the policy engine, policy administrator, and policy enforcement point as separate logical components and explicitly separates control plane from data plane: [NIST SP 800-207](https://nvlpubs.nist.gov/nistpubs/specialpublications/NIST.SP.800-207.pdf)
- Istio and Envoy document external authorization as a first-class enforcement pattern where a proxy pauses a request and delegates the allow/deny decision to an external authorizer: [Istio external authorization](https://istio.io/latest/docs/tasks/security/authorization/authz-custom/), [Envoy ext_authz filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter.html)
- Kubernetes documents fail-closed admission, dry-run rollout, and in-process validating policy as production enforcement patterns rather than optional governance extras: [Admission webhook good practices](https://kubernetes.io/docs/concepts/cluster-administration/admission-webhooks-good-practices/), [ValidatingAdmissionPolicy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/)
- Modern authorization standards provide the pieces for live token state, revocation, delegated narrowing, sender constraint, service binding, and signed HTTP transport: [RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662), [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009), [RFC 8693](https://www.ietf.org/rfc/rfc8693), [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449), [RFC 8705](https://www.ietf.org/rfc/rfc8705.pdf), [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421)
- SPIRE documents workload attestation and workload-issued identities for service-to-service enforcement: [SPIRE / SPIFFE](https://spiffe.io/docs/latest/spire-about/)
- Sigstore and GitHub document signed-attestation admission control as a real deployment gate, and SCITT now defines modern transparency receipts for signed statements and relying-party verification: [Sigstore policy-controller](https://docs.sigstore.dev/policy-controller/overview/), [GitHub artifact attestation enforcement](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/enforce-artifact-attestations), [RFC 9943 SCITT Architecture](https://ftp.fau.de/mirrors/ripe.net/rfc/authors/rfc9943.pdf)

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 20 |
| Completed | 11 |
| In progress | 0 |
| Not started | 9 |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Codify the enforcement-plane vocabulary | `src/release-enforcement-plane/types.ts`, `tests/release-enforcement-plane-types.test.ts` | The enforcement plane now has a stable first-class grammar for enforcement points, boundary kinds, verification modes, presentation modes, cache states, degraded states, break-glass reasons, enforcement outcomes, failure reasons, and normalized enforcement-point references. |
| 02 | complete | Define the versioned enforcement object model | `src/release-enforcement-plane/object-model.ts`, `tests/release-enforcement-plane-object-model.test.ts` | The enforcement plane now has versioned first-class objects for `enforcementRequest`, `releasePresentation`, `introspectionSnapshot`, `verificationResult`, `enforcementDecision`, and `enforcementReceipt`, including proof-shape validation for DPoP, mTLS, SPIFFE, HTTP message signatures, and signed JSON envelopes. |
| 03 | complete | Define the verification-profile matrix | `src/release-enforcement-plane/verification-profiles.ts`, `tests/release-enforcement-plane-verification-profiles.test.ts` | Consequence type, risk class, and boundary kind now deterministically map to verification mode, online introspection requirement, allowed presentation modes, sender-constrained presentation modes, replay protection, cache/freshness budgets, override posture, and fail-closed behavior. |
| 04 | complete | Define freshness, caching, and replay rules | `src/release-enforcement-plane/freshness.ts`, `tests/release-enforcement-plane-freshness.test.ts` | The enforcement plane now has explicit rules for stale-if-error windows, negative caching, replay windows, `jti` tracking, nonce handling, and fail-closed freshness behavior, grounded in JWT time claims, introspection cache liveness tradeoffs, DPoP replay/nonce semantics, and fail-closed admission patterns. |
| 05 | complete | Implement the offline verification core | `src/release-enforcement-plane/offline-verifier.ts`, `tests/release-enforcement-plane-offline-verifier.test.ts` | Downstream enforcement points can locally verify signed release authorization, audience binding, consequence binding, risk binding, policy/output/consequence hash binding, replay freshness, and safe indeterminate posture for online-required releases without a network call. |
| 06 | complete | Implement online introspection and revocation checks | `src/release-enforcement-plane/online-verifier.ts`, `tests/release-enforcement-plane-online-verifier.test.ts` | High-risk boundaries now add live active-state, revocation-state, freshness-state, unknown/unsupported-token handling, usage exhaustion/replay, and claim-consistency checks on top of offline verification using the release-introspection contract. |
| 07 | complete | Implement audience-scoped release token exchange | `src/release-enforcement-plane/token-exchange.ts`, `tests/release-enforcement-plane-token-exchange.test.ts` | A general Attestor authorization can now be exchanged for a narrower downstream-specific release credential with explicit audience, resource, scope, actor history, parent-token linkage, source-audience linkage, TTL narrowing, optional subject-token liveness checks, and registry registration for downstream online enforcement. |
| 08 | complete | Implement DPoP-bound HTTP presentation | `src/release-enforcement-plane/dpop.ts`, `tests/release-enforcement-plane-dpop.test.ts` | HTTP-bound enforcement can now require DPoP proof-of-possession on each request with `typ=dpop+jwt`, public JWK thumbprint binding through `cnf.jkt`, method and normalized URI binding through `htm`/`htu`, release-token hash binding through `ath`, optional nonce checks, and `jti` replay-ledger protection. The offline verifier now enforces the signed proof against the presented release token, and the high-risk online verifier path remains compatible with DPoP-bound presentations. |
| 09 | complete | Implement workload-bound mTLS and SPIFFE presentation | `src/release-enforcement-plane/workload-binding.ts`, `tests/release-enforcement-plane-workload-binding.test.ts` | Service-to-service enforcement now binds release authorization to RFC 8705-style `cnf.x5t#S256` certificate thumbprints and SPIFFE/SPIRE workload identities. The offline and online verifiers now fail closed when an mTLS/SPIFFE presentation is not backed by matching token confirmation, and token exchange preserves workload confirmation so narrowing a release token does not weaken it back into a bearer credential. |
| 10 | complete | Implement signed HTTP authorization envelopes | `src/release-enforcement-plane/http-message-signatures.ts`, `src/release-enforcement-plane/offline-verifier.ts`, `tests/release-enforcement-plane-http-message-signatures.test.ts` | Webhook and callback boundaries now carry RFC 9421-style detached HTTP message signatures over derived request components, release-token headers, and RFC 9530 `Content-Digest` values. The offline and online verifier paths now fail closed unless the request signature verifies, covers the required Attestor authorization envelope fields, matches the release token `cnf.jkt` sender binding, and passes nonce/replay freshness checks. |
| 11 | complete | Implement signed async consequence envelopes | `src/release-enforcement-plane/async-envelope.ts`, `src/release-enforcement-plane/offline-verifier.ts`, `tests/release-enforcement-plane-async-envelope.test.ts` | Queue, export, file, and artifact boundaries now carry DSSE-style consequence envelopes with expiry, idempotency, release-token digest, CloudEvents metadata, in-toto Statement-style subject binding, and token `cnf.jkt` sender binding that survive asynchronous transport. Offline and online verifiers now fail closed unless the signed envelope verifies and matches the presented release authorization. |
| 12 | not started | Build the reference Node and Hono middleware PEP | `src/release-enforcement-plane/middleware.ts`, `tests/release-enforcement-plane-middleware.test.ts` | A reusable middleware path now makes `no release authorization -> no consequence` easy to adopt on ordinary HTTP mutation surfaces. |
| 13 | not started | Build the reference webhook receiver PEP | `src/release-enforcement-plane/webhook-receiver.ts`, `tests/release-enforcement-plane-webhook-receiver.test.ts` | Receiver-side verification now handles signed HTTP envelopes, release authorization, freshness, replay, and break-glass semantics on inbound webhook boundaries. |
| 14 | not started | Build the record-write enforcement gateway | `src/release-enforcement-plane/record-write.ts`, `tests/release-enforcement-plane-record-write.test.ts` | Structured record mutations now go through a dedicated enforcement adapter that proves the release authorization matches the target record write before the mutation is admitted. |
| 15 | not started | Build the communication-send enforcement gateway | `src/release-enforcement-plane/communication-send.ts`, `tests/release-enforcement-plane-communication-send.test.ts` | Email, memo, and outbound message boundaries now have a dedicated enforcement adapter that blocks send unless the communication artifact is explicitly authorized. |
| 16 | not started | Build the action-dispatch enforcement gateway | `src/release-enforcement-plane/action-dispatch.ts`, `tests/release-enforcement-plane-action-dispatch.test.ts` | Tool calls, workflow steps, and async dispatch boundaries now go through a dedicated action gateway that binds release authorization to the actual downstream action target. |
| 17 | not started | Build the Envoy and Istio external-authz bridge | `src/release-enforcement-plane/envoy-ext-authz.ts`, `tests/release-enforcement-plane-envoy-ext-authz.test.ts`, `docs/08-deployment/release-enforcement-plane-envoy.md` | Mesh and proxy deployments now have a reference ext-authz service so ingress or east-west traffic can pause, verify release authorization, and allow or deny consistently outside application code. |
| 18 | not started | Add degraded-mode and break-glass enforcement control | `src/release-enforcement-plane/degraded-mode.ts`, `tests/release-enforcement-plane-degraded-mode.test.ts`, `src/service/http/routes/admin-routes.ts` | The enforcement plane now makes fail-closed default, explicitly models when cache-only or emergency behavior is allowed, and records who invoked break-glass, why, and for how long. |
| 19 | not started | Add enforcement telemetry, conformance, and transparency receipts | `src/release-enforcement-plane/telemetry.ts`, `src/release-enforcement-plane/conformance.ts`, `tests/release-enforcement-plane-conformance.test.ts` | Enforcement points now emit a uniform allow/deny/revoke/replay/freshness telemetry surface, run through one conformance suite, and can optionally export transparency-style high-consequence receipts for later relying-party verification. |
| 20 | not started | Package the enforcement plane as a reusable platform surface | `src/release-enforcement-plane/index.ts`, `docs/02-architecture/release-enforcement-plane-platform-surface.md`, `tests/release-enforcement-plane-platform-surface.test.ts`, `scripts/probe-release-enforcement-plane-package-surface.mjs`, `package.json` | The enforcement plane now ships behind a stable `attestor/release-enforcement-plane` surface instead of ad hoc internal paths, with explicit extraction criteria and package-boundary probing. |

## Immediate Next Step

Step 11 is complete. The next implementation step is Step 12: build the reference Node and Hono middleware PEP so ordinary HTTP mutation surfaces can adopt `no release authorization -> no consequence` with the shared verifier core.
