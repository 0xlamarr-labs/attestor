# Reusable Release-Policy Control-Plane Surface

Attestor now exposes the policy control plane through a **stable package subpath** instead of asking consumers to reach into internal `src/release-policy-control-plane/*` files.

## Public Subpath

- `attestor/release-policy-control-plane`

This is the intended reusable control-plane surface inside the current modular monolith and the intended starting boundary if the policy control plane is extracted later.

## Why This Shape

The goal is to make the policy control plane reusable **without** freezing every internal file path as public API.

- `attestor/release-policy-control-plane` groups the stable policy lifecycle primitives:
  - vocabulary and target grammar
  - object model and compatibility envelopes
  - scope precedence
  - bundle format, signing, caching, and store contracts
  - activation, rollback, freeze, and approval semantics
  - discovery, resolution, simulation, and impact preview
  - audit logging
  - runtime bridge
  - finance proving policy seed and rollout helpers

This follows current Node package-subpath export guidance and current TypeScript package-resolution guidance: the package exposes one stable entrypoint while hiding internal implementation paths behind the `exports` map.

## SemVer Boundary

The public compatibility promise is now:

- the subpath name is stable
- namespace names under that subpath are stable
- versioned policy-bundle, activation, discovery, and runtime specs remain the public contract
- internal `src/release-policy-control-plane/*` paths are implementation detail unless they are later promoted explicitly

That means the control plane can evolve internally without forcing consumers to track file-move churn.

## Extraction Criteria

The public package surface is ready before full service extraction, but full extraction still requires one criterion to be satisfied:

1. Policy bundle contract is stable. Status: `ready`
2. Scope and activation lifecycle are stable. Status: `ready`
3. Runtime resolution is proven in a real domain. Status: `ready`
4. Operator surface is stable. Status: `ready`
5. Scaling, isolation, or customer-operated requirements justify a separate deployable boundary. Status: `pending`

So the policy control plane is now **packaged**, but not yet **split into a separate service**.

## Consumption Example

```ts
import {
  releasePolicyControlPlane,
  releasePolicyControlPlanePublicSurface,
} from 'attestor/release-policy-control-plane';

const descriptor = releasePolicyControlPlanePublicSurface();
const store = releasePolicyControlPlane.store.createInMemoryPolicyControlPlaneStore();

const target =
  releasePolicyControlPlane.financeProving.createFinancePolicyActivationTarget(
    'record',
    'api-runtime',
    {
      tenantId: 'tenant-pilot',
      cohortId: 'wave-a',
      planId: 'enterprise',
    },
  );
```

## What Stays Internal

These paths are intentionally **not** public package API:

- `attestor/release-policy-control-plane/*.js` deep module paths
- `attestor/service/*`
- private migration helpers that have not been promoted into the curated surface

That keeps the policy control plane reusable without freezing the whole repository structure.
