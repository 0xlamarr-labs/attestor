# Reusable Release-Enforcement Plane Surface

Attestor now exposes the release enforcement plane through a **stable package subpath** instead of asking consumers to reach into internal `src/release-enforcement-plane/*` files.

## Public Subpath

- `attestor/release-enforcement-plane`

This is the intended reusable enforcement-plane surface inside the current modular monolith and the intended starting boundary if the enforcement plane is extracted later.

## Why This Shape

The goal is to make the enforcement plane reusable **without** freezing every internal file path as public API.

- `attestor/release-enforcement-plane` groups the stable enforcement primitives:
  - vocabulary and point/boundary grammar
  - versioned enforcement object model
  - verification-profile matrix
  - freshness, replay, and nonce posture
  - offline and online verification
  - audience-scoped token exchange
  - sender-constrained presentation modes
  - middleware, webhook, gateway, and proxy enforcement adapters
  - degraded-mode control
  - telemetry, transparency receipts, and conformance helpers

This follows current Node package-subpath export guidance and current TypeScript package-resolution guidance: the package exposes one stable entrypoint while hiding internal implementation paths behind the `exports` map.

## SemVer Boundary

The public compatibility promise is now:

- the subpath name is stable
- namespace names under that subpath are stable
- versioned enforcement request, presentation, verifier, gateway, telemetry, and conformance specs remain the public contract
- internal `src/release-enforcement-plane/*` paths are implementation detail unless they are later promoted explicitly

That means the enforcement plane can evolve internally without forcing consumers to track file-move churn.

## Extraction Criteria

The public package surface is ready before full service extraction, but full extraction still requires one criterion to be satisfied:

1. The enforcement verifier contract is stable. Status: `ready`
2. Multiple enforcement-point topologies reuse the same verification core. Status: `ready`
3. Sender-constrained presentation is stable across HTTP and service-to-service paths. Status: `ready`
4. Operational enforcement controls and receipts are stable enough to travel with the package surface. Status: `ready`
5. Scaling, isolation, or customer-operated requirements justify a separate deployable boundary. Status: `pending`

So the enforcement plane is now **packaged**, but not yet **split into a separate service**.

## Consumption Example

```ts
import {
  releaseEnforcementPlane,
  releaseEnforcementPlanePublicSurface,
} from 'attestor/release-enforcement-plane';

const descriptor = releaseEnforcementPlanePublicSurface();
const point = releaseEnforcementPlane.types.createEnforcementPointReference({
  kind: 'application-middleware',
  boundaryKind: 'http-request',
  consequenceType: 'action',
  riskClass: 'R3',
  targetId: 'finance-reporting-api',
});

const profile = releaseEnforcementPlane.verificationProfiles.resolveVerificationProfile({
  consequenceType: point.consequenceType,
  riskClass: point.riskClass,
  boundaryKind: point.boundaryKind,
});
```

## What Stays Internal

These paths are intentionally **not** public package API:

- `attestor/release-enforcement-plane/*.js` deep module paths
- `attestor/service/*`
- private adoption helpers that have not been promoted into the curated surface

That keeps the enforcement plane reusable without freezing the whole repository structure.
