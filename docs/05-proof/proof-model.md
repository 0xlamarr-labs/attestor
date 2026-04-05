# Proof Model

Attestor treats proof as an explicit runtime truth artifact, not a side effect.

Every governed run records what was actually observed, what was inferred, what was reviewed, and what a verifier can later check independently.

## Proof Modes

| Mode | Meaning |
|---|---|
| `offline_fixture` | Predefined fixture data. No live observation. |
| `mocked_model` | Synthetic or mocked model behavior. |
| `live_model` | Real model generation. |
| `live_runtime` | Real database execution. |
| `hybrid` | Mixed live and fixture or mocked components. |

The system does not imply stronger proof than the runtime actually produced.

## Live Proof

Live Proof records:

- upstream model evidence
- runtime execution evidence
- explicit proof gaps
- consistency between declared mode and observed evidence
- replay identity for run equivalence

Missing live proof does not automatically deny authority. It constrains what can be truthfully claimed.

## Portable Proof

Portable proof is the verifier-facing artifact layer.

For mature paths, that means:

- signed certificate
- authority bundle
- verification summary
- reviewer endorsement material
- public key material for independent verification

An outsider should not need platform access to verify a mature proof path.

## Single-Query Proof

Single-query proof is mature:

- Ed25519-signed certificate
- verification kit
- run-bound reviewer endorsement
- real PostgreSQL-backed proof path
- independent verification CLI

## Multi-Query Proof

Multi-query proof is now signed at the run level.

Current multi-query artifact set:

- multi-query output pack
- multi-query dossier
- multi-query manifest
- multi-query certificate
- multi-query verification kit
- multi-query reviewer endorsement

What multi-query preserves:

- per-unit decisions
- per-unit evidence anchors
- aggregate decision
- aggregate proof mode
- blocker attribution
- run-level reviewer binding

What multi-query still does not do:

- differential evidence
- DAG or dependency semantics
- per-unit certificate issuance
- cross-query state attestation

## Real PostgreSQL Proof

Real PostgreSQL proof is a working path in the repository.

The bounded proof story includes:

- read-only execution
- predictive EXPLAIN-based preflight
- schema allowlist enforcement
- execution context hash
- reproducible demo bootstrap
- self-contained proof script

What it still does not prove:

- full schema snapshot
- data-state attestation across time
- table-level content hashing

## Verification Surface

The repository currently exposes verification through:

- the CLI verification path
- the HTTP `/api/v1/verify` route
- kit and certificate verification scripts

The mature verifier contract is: signed artifact + public key material -> independent verdict.
