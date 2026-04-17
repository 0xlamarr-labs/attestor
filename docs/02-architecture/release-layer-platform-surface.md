# Reusable Release-Layer Platform Surface

Attestor now exposes the release layer through **stable package subpaths** instead of asking consumers to reach into internal `src/release-kernel/*` files.

## Public Subpaths

- `attestor/release-layer`
- `attestor/release-layer/finance`

These subpaths are the intended reusable platform surface inside the current modular monolith and the intended starting boundary if the release layer is extracted later.

## Why This Shape

The goal is to make the release layer reusable **without** freezing every internal file path as public API.

- `attestor/release-layer` groups the cross-consequence release primitives:
  - vocabulary
  - object model
  - consequence rollout
  - risk controls
  - policy rollout
  - release policy
  - decision engine
  - decision log
  - deterministic checks
  - shadow evaluation
  - canonicalization
  - token issuance
  - verification
  - introspection
  - durable evidence
  - reviewer authority
- `attestor/release-layer/finance` groups the current proving wedges:
  - record
  - communication
  - action
  - finance policy factories

This follows current Node package-subpath export guidance and current TypeScript package-resolution guidance: the package exposes stable entrypoints while hiding internal implementation paths behind the `exports` map.

## SemVer Boundary

The public compatibility promise is now:

- subpath names are stable
- namespace names under those subpaths are stable
- versioned object-model / token / evidence specs remain the public contract
- internal `src/release-kernel/*` paths are implementation detail unless they are later promoted into the public surface

That means the platform can evolve internally without forcing consumers to track file-move churn.

## Extraction Criteria

The public package surface is ready before full service extraction, but full extraction still requires one criterion to become true:

1. `releaseDecision` is stable. Status: `ready`
2. `releaseToken` is stable. Status: `ready`
3. Multiple consequence flows use the same release layer. Status: `ready`
4. The downstream verification contract is stable enough to version independently. Status: `ready`
5. Scaling and availability requirements justify a separate deployable boundary. Status: `pending`

So the release layer is now **packaged**, but not yet **split into a separate service**.

## Consumption Example

```ts
import { releaseLayer, releaseLayerPublicSurface } from 'attestor/release-layer';
import { financeReleaseLayer } from 'attestor/release-layer/finance';

const descriptor = releaseLayerPublicSurface();
const tokenIssuer = releaseLayer.token.createReleaseTokenIssuer({
  issuer: 'attestor',
  privateKeyPem: privateKeyPem,
  publicKeyPem: publicKeyPem,
});

const financeRecordTarget = financeReleaseLayer.record.FINANCE_FILING_PREPARE_TARGET_ID;
```

## What Stays Internal

These paths are intentionally **not** public package API:

- `attestor/release-kernel/*`
- `attestor/service/*`
- ad hoc proving-path helpers that have not been promoted into the public surface

That keeps the release layer reusable without freezing the whole repository structure.
