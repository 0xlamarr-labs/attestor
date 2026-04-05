# Proof Model

Attestor treats proof mode as a first-class runtime truth artifact. Every run explicitly labels what was proved and what was not.

## Proof Modes

| Mode | Meaning |
|---|---|
| `offline_fixture` | All inputs are pre-defined fixture data. No runtime observation. |
| `mocked_model` | Model generation was mocked or synthetic. |
| `live_model` | Real model generation (e.g., OpenAI GPT). |
| `live_runtime` | Real database execution (SQLite or PostgreSQL). |
| `hybrid` | Some components are live, others are fixture or mocked. |

## Live Proof

Live Proof is a typed runtime-proof artifact that records:

- **Upstream evidence**: was model generation live or mocked? Which provider, model, latency?
- **Execution evidence**: was query execution live or fixture? Which database, latency?
- **Proof gaps**: what is missing for a stronger proof claim?
- **Consistency**: do the claimed mode and the actual evidence agree?
- **Replay identity**: deterministic fingerprint for replay-equivalence across runs

## Live Readiness

Every run can produce a Live Readiness result that states:

- What proof modes are currently available
- What remains blocked (missing API key, missing database, etc.)
- What proof gaps still exist
- What next step would increase confidence most

## Design Rules

- **Live Proof is not an authority gate by itself.** Missing live proof does not automatically deny authority. It changes what can be truthfully claimed about the run.
- **Proof mode is explicit.** The system never implies stronger guarantees than the runtime actually proved.
- **Proof gaps are named.** Each gap has a category (`upstream`, `execution`, `schema_snapshot`, `lineage`) and a description. Gaps are surfaced in the dossier, verification summary, and filing readiness assessment.

## What Fixture Proof Demonstrates

Fixture-based runs demonstrate the full governance and signing chain — authority lifecycle, deterministic scoring, review policy, endorsement signing, and portable certificate issuance — using pre-defined data. They do not prove that a real database was queried.

## What Real-Data Proof Requires

Outsider-verifiable real-data proof requires:

1. A configured PostgreSQL instance (`ATTESTOR_PG_URL`)
2. The `pg` driver installed (`npm install pg`)
3. A signing key pair for certificate issuance
4. Optionally, a reviewer key pair for reviewer-verifiable endorsement

When all of these are present, the `prove` path can emit a verification kit backed by real database execution evidence, predictive guardrail preflight, and independently verifiable certificates.

Use `npm run start -- doctor` to check readiness.

## Multi-Query Governed Proof

Attestor supports multi-query reporting runs where N governed query units execute within a single run.

**How it works:**

- Each query unit is a full governed pipeline execution with its own evidence chain, governance gates, and decision
- The aggregate decision is conservative: any `block` or `fail` in any unit → the run-level decision reflects the worst case
- Per-query traceability is preserved: each unit's decision, blockers, proof mode, and evidence chain terminal are available
- Aggregate proof mode is the weakest across all units: if any unit is fixture-based while others are live, the aggregate is `hybrid`
- Governance sufficiency requires all units to pass SQL governance, policy, and guardrails

**What multi-query does NOT yet do:**

- Differential evidence (proving what changed between queries)
- Cross-query join or dependency semantics
- DAG-based query ordering
- Per-unit certificate issuance (certificates are per-run, not per-unit)

This is a bounded first slice: one run, N independent units, one aggregate report.
