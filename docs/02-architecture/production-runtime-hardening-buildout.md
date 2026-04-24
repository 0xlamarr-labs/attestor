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
- Node.js exposes synchronous file open/write/fsync/close primitives, which supports a small append-only restart-surviving decision log before a shared database backend is introduced: [Node.js file system API](https://nodejs.org/api/fs.html)
- Redis AOF durability and PostgreSQL WAL both reinforce the same queue-state rule: pending authority work needs explicit persisted write state, not only an in-process queue, if restart recovery matters.
- RFC 7662 defines token introspection around active token state, and RFC 7009 defines revocation as immediate invalidation; Attestor's release-token introspection state must therefore survive restart for revocation, expiry, replay, and use-count checks to remain meaningful.
- The in-toto attestation envelope specification requires signed payloads and authenticated payload types, while SLSA provenance guidance binds produced artifacts to cryptographic digests; Attestor's durable evidence pack store must therefore preserve the signed DSSE bundle and reject persisted evidence whose digest/signature no longer verifies.
- Kubernetes separates liveness, readiness, and startup probes, while the Twelve-Factor App treats environment-backed config as the deployment-specific control surface; Attestor's selected runtime profile and release-store posture should therefore be explicit in startup diagnostics and readiness output rather than inferred from code paths.

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
| Completed | 8 |
| In progress | 0 |
| Not started | 0 |
| Current posture | Step 08 is complete: the runtime hardening track now has an operator-facing production readiness gate, explicit runtime profile matrix, durable store knobs, restart/recovery commands, readiness endpoint checks, and anti-overclaim language. The default `local-dev` profile still keeps fast in-memory release authority stores; `single-node-durable` is the proven restart-safe one-runtime posture; `production-shared` remains the multi-node production target and must not be claimed until shared release-authority stores satisfy that profile. |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Add the runtime profile contract | `src/service/bootstrap/runtime-profile.ts`, `src/service/bootstrap/release-runtime.ts`, `src/service/bootstrap/api-route-runtime.ts`, `tests/production-runtime-profile.test.ts`, `docs/02-architecture/production-runtime-hardening-buildout.md`, `README.md`, `package.json` | Runtime profiles are now explicit: `local-dev`, `single-node-durable`, and `production-shared`. The current store inventory names memory/file/shared posture for each release authority component. Unsupported profiles fail configuration. Profiles whose durability requirements are not met fail closed before the API runtime starts. |
| 02 | complete | Add a durable release decision log store | `src/release-kernel/release-decision-log.ts`, `src/service/bootstrap/release-runtime.ts`, `src/service/bootstrap/runtime-profile.ts`, `tests/release-kernel-release-decision-log.test.ts`, `tests/production-runtime-profile.test.ts`, `tests/service-bootstrap-boundary.test.ts`, `docs/02-architecture/production-runtime-hardening-buildout.md` | The release decision log now has a file-backed JSONL writer that appends under a file lock, fsyncs each append, reloads entries after restart, verifies the hash chain on load, fails closed on tampering, and is available to durable runtime profiles. `local-dev` intentionally keeps the in-memory writer for fast test/dev loops. |
| 03 | complete | Add a durable release reviewer queue store | `src/release-kernel/reviewer-queue.ts`, `src/platform/file-store.ts`, `src/service/bootstrap/release-runtime.ts`, `src/service/bootstrap/runtime-profile.ts`, `tests/release-kernel-reviewer-queue.test.ts`, `tests/production-runtime-profile.test.ts`, `tests/service-bootstrap-boundary.test.ts`, `docs/02-architecture/production-runtime-hardening-buildout.md` | The reviewer queue now has a file-backed snapshot store guarded by file locks and atomic fsync-backed writes. It reloads pending review items, reviewer decisions, and partial dual-approval state after restart, and fails closed on corrupt persisted queue state. `local-dev` intentionally keeps the in-memory queue for fast test/dev loops. |
| 04 | complete | Add durable release token introspection state | `src/release-kernel/release-introspection.ts`, `src/service/bootstrap/release-runtime.ts`, `src/service/bootstrap/runtime-profile.ts`, `tests/release-kernel-release-introspection.test.ts`, `tests/production-runtime-profile.test.ts`, `tests/service-bootstrap-boundary.test.ts`, `docs/02-architecture/production-runtime-hardening-buildout.md` | The release-token introspection store now has a file-backed snapshot store guarded by file locks and atomic fsync-backed writes. It reloads issued, revoked, consumed, and expired token state after restart, preserves resource-server usage metadata, rejects replay/use-count exhaustion after restart, and fails closed on corrupt persisted token state. `local-dev` intentionally keeps the in-memory store for fast test/dev loops. |
| 05 | complete | Add a durable release evidence pack store | `src/release-kernel/release-evidence-pack.ts`, `src/service/bootstrap/release-runtime.ts`, `src/service/bootstrap/runtime-profile.ts`, `tests/release-kernel-release-evidence-pack.test.ts`, `tests/production-runtime-profile.test.ts`, `tests/service-bootstrap-boundary.test.ts`, `docs/02-architecture/production-runtime-hardening-buildout.md` | The release evidence pack store now has a file-backed snapshot store guarded by file locks and atomic fsync-backed writes. It reloads issued evidence packs after restart, preserves DSSE envelopes, verification keys, proof references, and bundle digests, verifies persisted packs on load, and fails closed on malformed or tampered persisted evidence. `local-dev` intentionally keeps the in-memory store for fast test/dev loops. |
| 06 | complete | Wire runtime profile selection through API bootstrap | `src/service/bootstrap/runtime-profile.ts`, `src/service/bootstrap/release-runtime.ts`, `src/service/bootstrap/api-route-runtime.ts`, `src/service/bootstrap/server.ts`, `src/service/http/routes/core-routes.ts`, `src/service/api-server.ts`, `tests/production-runtime-profile.test.ts`, `tests/service-bootstrap-boundary.test.ts`, `tests/live-api.test.ts`, `docs/02-architecture/production-runtime-hardening-buildout.md` | API bootstrap now builds a versioned runtime-profile diagnostics object after durability assertion. `/api/v1/health` and `/api/v1/ready` expose the selected profile, release-store modes, durability summary, and profile satisfaction state. Server startup logs the selected profile, durability status, and release-store mode inventory. |
| 07 | complete | Add restart and recovery tests | `tests/production-runtime-restart-recovery.test.ts`, `tests/production-runtime-profile.test.ts`, `package.json`, `docs/02-architecture/production-runtime-hardening-buildout.md` | The new restart/recovery guard writes a finance release decision, dual-review closure, issued release token, token introspection record, evidence pack, policy metadata, policy activation approval, policy mutation audit entry, and consumed degraded-mode grant into durable profile stores, reboots the release runtime bootstrap against the same store paths, and fails the guard if any recovered state or audit head is missing. |
| 08 | complete | Update production docs and readiness gates | `docs/08-deployment/production-readiness.md`, `tests/production-runtime-profile.test.ts`, `docs/02-architecture/production-runtime-hardening-buildout.md` | The production readiness guide now includes the runtime profile gate, production limitations, operator store path knobs, restart/recovery commands, `/api/v1/health` and `/api/v1/ready` checks, and exit criteria that prevent claiming multi-node production from file-backed single-runtime state. The profile guard test now enforces these doc truths and closes this buildout track. |

## Immediate Next Step

This buildout track is complete. The next production-runtime frontier is [Production shared authority plane buildout](production-shared-authority-plane-buildout.md); do not fold that work back into this frozen 8-step tracker.
