# Reusable Crypto Authorization Core Surface

Attestor now exposes the crypto authorization core through a **stable package subpath** instead of asking consumers to import internal `src/crypto-authorization-core/*` files.

## Public Subpath

- `attestor/crypto-authorization-core`

This is the reusable programmable-money authorization surface inside the current modular monolith and the intended starting boundary if the crypto authorization core is extracted later.

## Why This Shape

The goal is to make crypto authorization reusable **without** freezing every internal adapter file as public API.

- `attestor/crypto-authorization-core` groups the stable crypto primitives:
  - chain, account, asset, consequence, artifact, policy, and adapter vocabulary
  - versioned intent, decision, receipt, and execution-projection objects
  - CAIP-style canonical chain, account, asset, and counterparty references
  - deterministic consequence-risk mapping
  - EIP-712 and ERC-1271 validation projections
  - replay, nonce, expiry, and revocation rules
  - release-layer, policy-control-plane, and enforcement-plane bindings
  - pre-execution simulation
  - Safe, approval/allowance, ERC-4337, ERC-7579, ERC-6900, EIP-7702, x402, and custody co-signer adapters

This follows current Node package-subpath export guidance and current TypeScript package-resolution guidance: the package exposes one stable entrypoint while hiding internal implementation paths behind the `exports` map.

## SemVer Boundary

The public compatibility promise is now:

- the subpath name is stable
- namespace names under that subpath are stable
- versioned crypto authorization, binding, simulation, and adapter specs remain the public contract
- internal `src/crypto-authorization-core/*` paths are implementation detail unless they are later promoted explicitly

That means the crypto authorization core can evolve internally without forcing consumers to track file-move churn.

## Extraction Criteria

The public package surface is ready before full service extraction, but full extraction still requires one criterion to be satisfied:

1. The authorization language is stable. Status: `ready`
2. Proof and verification bindings are stable. Status: `ready`
3. Multiple execution adapters reuse the same core. Status: `ready`
4. The package boundary is proven by export-map probes. Status: `ready`
5. Chain-adjacent latency, customer-operated custody, or isolation requirements justify a separate deployable boundary. Status: `pending`

So the crypto authorization core is now **packaged**, but not yet **split into a separate service**.

## Consumption Example

```ts
import {
  cryptoAuthorizationCore,
  cryptoAuthorizationCorePublicSurface,
} from 'attestor/crypto-authorization-core';

const descriptor = cryptoAuthorizationCorePublicSurface();
const chain = cryptoAuthorizationCore.types.createCryptoChainReference({
  namespace: 'eip155',
  chainId: '1',
});

const account = cryptoAuthorizationCore.types.createCryptoAccountReference({
  accountKind: 'safe',
  chain,
  address: '0x1111111111111111111111111111111111111111',
});
```

## What Stays Internal

These paths are intentionally **not** public package API:

- `attestor/crypto-authorization-core/*.js` deep module paths
- `attestor/service/*`
- adapter internals that have not been promoted into the curated surface

That keeps the crypto authorization core reusable without freezing the whole repository structure.
