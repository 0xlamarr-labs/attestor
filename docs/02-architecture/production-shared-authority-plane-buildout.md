# Production Shared Authority Plane Buildout Tracker

This tracker covers the next Attestor runtime frontier after the completed production-runtime hardening track: turning the `production-shared` profile into a real multi-node authority plane with shared authoritative release and policy state.

The goal is not to add a new product, a new crypto branch, or a new public API surface. The goal is to finish the runtime cut line honestly: one Attestor platform core, one shared authority plane, and explicit fail-closed truth about what can and cannot be claimed in production.

## Guardrails For This Tracker

- The numbered step list below is frozen for this buildout track.
- Step ids and titles do not get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.
- Keep Attestor as one product with one platform core and modular packs.
- Do not add a new hosted crypto route as part of shared-runtime work.
- Do not widen the public product story from runtime internals.
- Keep `single-node-durable` as the truthful proven posture until the shared authority plane is actually wired and tested.
- Use PostgreSQL-backed shared state for authoritative release and policy records; do not promote Redis into the sole authority record for release or policy truth.
- Keep Redis in its existing coordination roles where it already fits: async execution, queueing, rate-limit windows, and other shared runtime coordination that is not the durable authority record.
- Carry the audit gaps forward on every remaining step: pack completion is not the same as multi-node runtime readiness, shared stores are not runtime-ready until bootstrap wiring proves them, and every authority mutation must preserve fail-closed behavior under concurrency and restart.

## Why This Track Exists

Attestor's major platform tracks are now complete:

- release layer
- release policy control plane
- release enforcement plane
- crypto authorization core
- crypto execution admission
- consequence admission
- hosted product flow
- proof surface
- production runtime hardening
- service/API boundary refactor

The main remaining engineering gap is the last runtime claim:

```text
local-dev -> memory-backed state is allowed
single-node-durable -> one runtime survives restart with durable file-backed state
production-shared -> multiple runtimes share authoritative release and policy state
```

The repository already proves the first two lines. It does not yet prove the third.

The code truth today is clear:

- the runtime profile contract already names `production-shared`
- the production profile already requires all 8 authority-state components to be `shared`
- the current bootstrap still instantiates file-backed release/policy stores, not shared ones
- the runtime therefore correctly fails closed before claiming `production-shared`

This tracker closes that gap without muddying the product story.

## Architecture Decision

Start the shared authority plane inside the existing Attestor modular monolith and reuse the repository's existing shared-PostgreSQL patterns.

- authoritative shared record: PostgreSQL
- coordination infrastructure: Redis where already appropriate
- service boundary: still one Attestor service/runtime family
- extraction rule: do not split this into a separate service first; finish the shared authority-plane contract and tests inside the repo before deciding on extraction

The reason is already visible in the codebase:

- `src/service/control-plane-store.ts` already uses a PostgreSQL-backed shared truth model with `pg.Pool`, schema bootstrap, transactions, unique constraints, and `ON CONFLICT` upserts
- the release/policy authority stores still live behind file-backed implementations
- the missing work is therefore not "invent a distributed platform"; it is "promote the release/policy authority state onto the same honest shared-store discipline"

The dedicated connection contract for this track is `ATTESTOR_RELEASE_AUTHORITY_PG_URL`.
That env var names the shared PostgreSQL substrate for release and policy authority state; it is separate from `ATTESTOR_CONTROL_PLANE_PG_URL`, `ATTESTOR_BILLING_LEDGER_PG_URL`, and `ATTESTOR_PG_URL`.

## Fresh Research Anchors

Reviewed on 2026-04-24 before opening this track:

- PostgreSQL documents Serializable as the strictest isolation level and notes that applications must be prepared to retry serialization failures, which fits authority-plane mutations that need correctness under concurrency: [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- PostgreSQL documents `INSERT ... ON CONFLICT` as a deterministic statement with explicit arbiter constraints and `RETURNING`, which fits idempotent shared-store upserts for release and policy records: [PostgreSQL INSERT](https://www.postgresql.org/docs/current/sql-insert.html)
- PostgreSQL documents advisory locks as application-defined locks, with transaction-level advisory locks automatically released at transaction end, which fits short-lived coordination around shared authority mutations without inventing a second lock service: [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- PostgreSQL documents `SKIP LOCKED` as providing an inconsistent view that is suitable for queue-like tables but not for general-purpose state access, which fits reviewer-queue claim paths but not authoritative record reads: [PostgreSQL SELECT locking clause](https://www.postgresql.org/docs/current/sql-select.html)
- PostgreSQL documents `LISTEN`/`NOTIFY` as simple interprocess communication where notifications are delivered between transactions and after commit, which fits cache invalidation or wake-up signals but not durable authority truth by itself: [LISTEN](https://www.postgresql.org/docs/current/sql-listen.html), [NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)
- PostgreSQL's reliability model is explicitly centered on the Write-Ahead Log, which supports treating shared release/policy authority state as durable database record rather than in-memory coordination state: [PostgreSQL WAL reliability](https://www.postgresql.org/docs/current/wal.html)
- Redis documents persistence through RDB and AOF and separately emphasizes backup discipline, which supports keeping Redis as explicit coordination infrastructure rather than silently treating it as the only authority record for release/policy history: [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- node-postgres documents that transactions must use the same checked-out client and that most applications should use a connection pool, which matches the repository's existing shared-control-plane PostgreSQL pattern: [node-postgres transactions](https://node-postgres.com/features/transactions), [node-postgres pooling](https://node-postgres.com/features/pooling)

## Shared Authority Components

The `production-shared` profile is blocked until all 8 release-authority components are truly shared:

| Component | Current mode | Required mode for `production-shared` |
|---|---|---|
| release decision log | file | shared |
| release reviewer queue | file | shared |
| release token introspection | file | shared |
| release evidence pack store | file | shared |
| release degraded-mode grants | file | shared |
| policy control plane store | file | shared |
| policy activation approval store | file | shared |
| policy mutation audit log | file | shared |

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 9 |
| Completed | 6 |
| In progress | 1 |
| Not started | 2 |
| Current posture | Step 07 is in progress: the API health/readiness surface now has a shared-authority runtime readiness diagnostic that initializes and probes all PostgreSQL-backed shared authority stores without overclaiming production-shared readiness. The diagnostic remains fail-closed until every ready shared store is explicitly marked as runtime bootstrap wired, preserving the known sync-runtime/shared-store cutover gap. |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Define the production-shared authority-plane scope, cut line, and storage model | `docs/02-architecture/production-shared-authority-plane-buildout.md`, `docs/02-architecture/system-overview.md`, `docs/02-architecture/production-runtime-hardening-buildout.md`, `docs/08-deployment/production-readiness.md`, `README.md`, `tests/production-shared-authority-plane-docs.test.ts`, `package.json` | The next runtime frontier is now frozen as its own tracker. The truth source explicitly keeps one-product framing, keeps `single-node-durable` as the current proven posture, and sets PostgreSQL as the authoritative shared store target for release/policy state while Redis stays in coordination roles. |
| 02 | complete | Add shared release-authority PostgreSQL substrate | `src/service/release-authority-store.ts`, `src/service/bootstrap/release-runtime.ts`, `tests/release-authority-store.test.ts`, `tests/production-runtime-profile.test.ts`, `tests/service-bootstrap-boundary.test.ts`, `tests/production-shared-authority-plane-docs.test.ts`, `package.json`, `docs/02-architecture/production-shared-authority-plane-buildout.md` | A dedicated shared PostgreSQL substrate now exists for release/policy authority state under `ATTESTOR_RELEASE_AUTHORITY_PG_URL`. It bootstraps the `attestor_release_authority` schema, seeds the 8 authority components into a shared registry, exposes pooled transaction and advisory-lock helpers, and gives the release bootstrap an explicit config view of whether the substrate is present. This step does not yet promote the individual release/policy stores off their file-backed implementations. |
| 03 | complete | Add shared release decision log store | `src/service/release-decision-log-store.ts`, `src/release-kernel/release-decision-log.ts`, `tests/release-decision-log-store.test.ts`, `tests/production-shared-authority-plane-docs.test.ts`, `package.json`, `docs/02-architecture/production-shared-authority-plane-buildout.md` | The release decision log now has a PostgreSQL-backed shared store on the release-authority substrate. Appends serialize through transaction-scoped advisory locking, sequence numbers stay contiguous without relying on non-rollback-safe database sequences, the hash chain is re-verified on read, and tampered persisted rows fail closed. The shared store is implemented and registry-marked as ready, while runtime bootstrap wiring still remains for the later production-shared cutover steps. |
| 04 | complete | Add shared release reviewer queue store and claim discipline | `src/service/release-reviewer-queue-store.ts`, `src/release-kernel/reviewer-queue.ts`, `tests/release-reviewer-queue-store.test.ts`, `tests/production-shared-authority-plane-docs.test.ts`, `package.json`, `docs/02-architecture/production-shared-authority-plane-buildout.md` | The reviewer queue now has a PostgreSQL-backed shared store on the release-authority substrate. Durable queue records preserve full reviewer packet JSON, deterministic pending views use direct ordered reads, and multi-consumer claim paths use short `FOR UPDATE SKIP LOCKED` transactions with claim leases and token-checked release. This follows PostgreSQL's queue-specific guidance: `SKIP LOCKED` is only used for the claim path, not for authoritative state reads. Runtime bootstrap wiring still remains for the later production-shared cutover steps. |
| 05 | complete | Add shared release token introspection and evidence-pack stores | `src/service/release-token-introspection-store.ts`, `src/service/release-evidence-pack-store.ts`, `tests/release-token-introspection-store.test.ts`, `tests/release-evidence-pack-store.test.ts`, `src/release-layer/index.ts`, `tests/production-shared-authority-plane-docs.test.ts`, `package.json`, `docs/02-architecture/production-shared-authority-plane-buildout.md` | Release token introspection and release evidence packs now have PostgreSQL-backed shared stores on the release-authority substrate. Token use/revocation/lifecycle mutations run under row locks and persist issued, consumed, revoked, expired, and replay state; evidence pack reads and writes verify DSSE signatures and bundle digests and fail closed on tampered persisted rows. The component registry marks both stores ready with `bootstrapWired: false`, preserving the audit truth that runtime cutover remains Step 07. |
| 06 | complete | Add shared degraded-mode and policy-control-plane authority stores | `src/service/release-degraded-mode-grant-store.ts`, `src/service/release-policy-authority-store.ts`, `tests/release-degraded-mode-grant-store.test.ts`, `tests/release-policy-authority-store.test.ts`, `tests/production-shared-authority-plane-docs.test.ts`, `package.json`, `docs/02-architecture/production-shared-authority-plane-buildout.md` | Degraded-mode grants, policy bundle state, activation approvals, and policy mutation audit history now have PostgreSQL-backed shared stores on the release-authority substrate. Degraded-mode grant mutations use transaction-scoped advisory locking and row locks, preserve a tamper-evident audit chain, and fail closed on inconsistent persisted JSON. Policy bundle, activation approval, and mutation audit records persist through shared tables; policy audit appends serialize with contiguous sequence and verified hash linkage. The component registry marks all four stores ready with `bootstrapWired: false`, preserving the audit truth that runtime cutover remains Step 07. |
| 07 | in_progress | Wire `production-shared` bootstrap, health, and readiness truth | `src/service/bootstrap/shared-authority-readiness.ts`, `src/service/http/routes/core-routes.ts`, `src/service/bootstrap/api-route-runtime.ts`, `tests/shared-authority-runtime-readiness.test.ts`, `package.json`, `docs/02-architecture/production-shared-authority-plane-buildout.md` | Shared-authority readiness now instantiates and probes all eight PostgreSQL-backed shared stores and exposes the result through health/readiness diagnostics. It intentionally keeps `ready=false` while the shared store component metadata still has `bootstrapWired=false`, so the runtime does not confuse "shared stores exist" with "production-shared request-path cutover is complete." The remaining Step 07 work is the real runtime bootstrap cutover, not a status-label flip. |
| 08 | pending | Add multi-instance concurrency, restart, and recovery tests | | Prove the shared authority plane under concurrent API runtimes, restart/reconnect cycles, reviewer-queue claims, token use/revocation, and policy mutations using the repository's embedded PostgreSQL test harness. |
| 09 | pending | Update promotion docs, readiness packets, and anti-overclaim gates | | Close the track by aligning production docs, render/probe assets, and runtime-profile gates with the newly implemented shared authority plane, without claiming more than the tests and readiness packets can prove. |

## Immediate Next Step

Step 07 is in progress. The next sub-step is the real runtime bootstrap cutover: either adapt the release/policy authority contracts to an async shared-store boundary or add a deliberately bounded runtime adapter that preserves fail-closed behavior without pretending synchronous file-backed stores are shared.
