# Production Runtime Hardening Buildout Tracker

This tracker covers the next Attestor production-readiness layer: making release authority state durable, explicit, restart-safe, and eventually shared across production runtimes.

The goal is not to add a new product, a new crypto branch, or a new public API story. The goal is to harden the existing Attestor platform core so release decisions, review queues, tokens, evidence packs, policy state, and degraded-mode grants survive the runtime shape they claim to support.

## Guardrails For This Tracker

- The numbered step list below is frozen for this buildout track.
- Step ids and titles do not get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.
- Keep Attestor as one product with one platform core and modular packs.
- Do not add a new hosted crypto route as part of runtime hardening.
- Do not make production claims until the runtime profile, store mode, restart behavior, and verification tests support them.
- Keep local developer speed available, but make production durability explicit and fail closed.

## Why This Track Exists

Attestor already has serious governed-execution logic: release decisions, policy activation, enforcement verification, finance proof flows, crypto authorization, crypto execution admission, consequence admission, customer gates, proof surfaces, and hosted account flow.

The remaining risk is runtime durability.

Some authority state is still intentionally local to the API runtime while the platform is being proven. That is acceptable for local development and single-runtime evaluation, but it is not enough for a multi-node production authority plane.

This track turns the runtime posture from implicit to explicit:

```text
local-dev -> in-memory state is allowed
single-node-durable -> restart-surviving file/shared state is required
production-shared -> shared durable state is required
```

## Fresh Research Anchors

Reviewed on 2026-04-23 before opening this track:

- Redis documents RDB and AOF persistence as explicit durability mechanisms for data that otherwise lives primarily in memory, which supports making Attestor's memory/file/shared runtime posture explicit rather than implied: [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- PostgreSQL's reliability model centers on write-ahead logging for crash recovery and durable transaction history, which supports treating release authority state as a durable record in production: [PostgreSQL WAL reliability](https://www.postgresql.org/docs/current/wal.html)
- BullMQ is a Redis-backed queue system, so production async/review posture depends on Redis connection and persistence choices rather than queue code alone: [BullMQ queues](https://docs.bullmq.io/guide/queues)
- Node.js exposes environment variables through `process.env`, which is the right minimal mechanism for selecting an Attestor runtime profile without inventing a separate config service in Step 01: [Node.js environment variables](https://nodejs.org/api/environment_variables.html)

## Runtime Profile Vocabulary

| Profile | Meaning | Production claim |
|---|---|---|
| `local-dev` | Fast development, demos, and repeatable tests. Memory-backed release stores are allowed. | Not production |
| `single-node-durable` | One runtime may be used for evaluation where restart survival matters. File-backed or shared stores are required for authority state. | Not multi-node production |
| `production-shared` | Multi-node production authority plane. Release, policy, token, proof, and review state must be shared durable state. | Production profile |

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 8 |
| Completed | 1 |
| In progress | 0 |
| Not started | 7 |
| Current posture | Step 01 is complete: Attestor now has a typed runtime profile contract, environment-based profile resolution, current release store mode inventory, durability evaluation, fail-closed production/shared profile checks, API runtime wiring, and automated tests. The current default remains `local-dev`; `single-node-durable` and `production-shared` intentionally fail until later steps replace in-memory release stores. |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Add the runtime profile contract | `src/service/bootstrap/runtime-profile.ts`, `src/service/bootstrap/release-runtime.ts`, `src/service/bootstrap/api-route-runtime.ts`, `tests/production-runtime-profile.test.ts`, `docs/02-architecture/production-runtime-hardening-buildout.md`, `README.md`, `package.json` | Runtime profiles are now explicit: `local-dev`, `single-node-durable`, and `production-shared`. The current store inventory names memory/file/shared posture for each release authority component. Unsupported profiles fail configuration. Profiles whose durability requirements are not met fail closed before the API runtime starts. |
| 02 | not_started | Add a durable release decision log store |  | Replace the API release decision log's in-memory-only posture for durable profiles and prove restart survival. |
| 03 | not_started | Add a durable release reviewer queue store |  | Preserve reviewer queue items across restart and prepare the queue for shared production backends. |
| 04 | not_started | Add durable release token introspection state |  | Preserve token status, revocation, freshness, replay, and use-count posture across runtime restart. |
| 05 | not_started | Add a durable release evidence pack store |  | Preserve release evidence packs and proof references beyond process lifetime. |
| 06 | not_started | Wire runtime profile selection through API bootstrap |  | Replace the Step 01 inventory-only profile posture with profile-aware store construction and explicit startup diagnostics. |
| 07 | not_started | Add restart and recovery tests |  | Prove decision log, reviewer queue, token introspection, evidence packs, policy state, and degraded-mode grants survive restart in durable profiles. |
| 08 | not_started | Update production docs and readiness gates |  | Publish the runtime profile matrix, production limitations, operator knobs, readiness commands, and anti-overclaim tests. |

## Immediate Next Step

Step 02 should add the first durable release decision log store and prove it survives restart under the `single-node-durable` profile.
