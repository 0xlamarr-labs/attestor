# Backup, Restore, and DR

This document describes the current Attestor control-plane backup and restore story.

## Scope

Current backup tooling covers:

- hosted account store
- account user store
- account session store
- tenant key store
- usage ledger
- async DLQ store
- admin audit log
- optional ephemeral stores:
  - admin idempotency replay store
  - Stripe webhook dedupe store
- optional shared PostgreSQL billing event ledger export/import

Current application-level snapshot tooling does **not** provide by itself:

- physical PostgreSQL replication
- automated failover
- exact in-flight job replay semantics beyond BullMQ + Redis durability
- restore of optional observability JSONL logs

This remains a **logical snapshot first slice** for control-plane state. The repo now also ships an operator bundle for PostgreSQL WAL archiving/PITR and Redis/BullMQ durability:

- [docker-compose.dr.yml](../../docker-compose.dr.yml)
- [ops/postgres/pitr/postgresql-pitr.conf](../../ops/postgres/pitr/postgresql-pitr.conf)
- [ops/postgres/pitr/restore-wal.sh](../../ops/postgres/pitr/restore-wal.sh)
- [ops/postgres/pitr/README.md](../../ops/postgres/pitr/README.md)
- [ops/redis/redis-recovery.conf](../../ops/redis/redis-recovery.conf)
- [ops/redis/README.md](../../ops/redis/README.md)

## Why this exists

Attestor's hosted control-plane is currently mixed:

- hosted accounts, account users, account sessions, tenant keys, usage, billing entitlements, async DLQ, and admin audit can run either file-backed or on the shared PostgreSQL control-plane first slice
- admin idempotency replay and Stripe webhook dedupe can also move onto the shared PostgreSQL control-plane when `--include-ephemeral` is used for snapshot drills
- Stripe billing event truth already has a shared PostgreSQL first slice

The control-plane snapshot gives operators one bounded way to:

- capture the hosted-account state
- restore it onto a replacement node
- drill disaster recovery without waiting for a full shared control-plane migration

## Recommended production stance

Use both layers:

1. **Attestor control-plane snapshot**
   - protects the current control-plane state, whether file-backed or shared PostgreSQL-backed
   - exports the shared billing event ledger logically
2. **Native PostgreSQL backups**
   - `pg_dump` / logical dumps for routine export
   - continuous archiving / WAL-based PITR for serious DR
3. **Durable Redis/BullMQ runtime**
   - Redis AOF + RDB persistence for queue and shared runtime state
   - BullMQ recovery expectations documented alongside Redis durability

Official references:

- [PostgreSQL Backup and Restore](https://www.postgresql.org/docs/current/backup.html)
- [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/current/app-pgdump.html)
- [PostgreSQL Continuous Archiving and PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [Redis Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [AWS Disaster Recovery Strategies](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)

## Backup command

Critical-only snapshot:

```bash
npm run backup:control-plane
```

Explicit output directory:

```bash
npm run backup:control-plane -- --output-dir .attestor/backups/pre-maintenance
```

Include ephemeral stores too:

```bash
npm run backup:control-plane -- --include-ephemeral
```

What it writes:

- `manifest.json`
- `critical/*.json`
- `ephemeral/*.json` when requested
- `shared/billing-entitlement-store.json` when `ATTESTOR_CONTROL_PLANE_PG_URL` is configured
- `shared/billing-event-ledger.json` when `ATTESTOR_BILLING_LEDGER_PG_URL` is configured

The manifest records:

- snapshot id
- creation time
- whether ephemeral state was included
- whether shared billing ledger export was present
- checksum and byte size for every captured component

## Restore command

Restore from a snapshot directory:

```bash
npm run restore:control-plane -- --input-dir .attestor/backups/pre-maintenance --replace-existing
```

Restore ephemeral stores too:

```bash
npm run restore:control-plane -- --input-dir .attestor/backups/pre-maintenance --replace-existing --include-ephemeral
```

Restore behavior:

- verifies snapshot checksums before writing
- rejects admin audit snapshots whose hash chain is broken
- restores file-backed stores to their configured runtime paths
- restores the shared billing ledger into PostgreSQL when:
  - the snapshot contains it
  - `ATTESTOR_BILLING_LEDGER_PG_URL` is configured

If a billing ledger snapshot is present but PostgreSQL is not configured, restore fails fast instead of silently skipping shared billing truth.

## PostgreSQL PITR bundle

The repo ships a PITR-oriented PostgreSQL config and restore helper:

- `docker-compose.dr.yml` mounts `ops/postgres/pitr/postgresql-pitr.conf`
- `postgresql-pitr.conf` enables:
  - `wal_level = replica`
  - `archive_mode = on`
  - `archive_timeout = 60s`
  - `restore_command = '/etc/postgresql/restore-wal.sh %f %p'`
- `restore-wal.sh` copies archived WAL files back into place during restore

Recommended drill:

1. Take the Attestor control-plane snapshot.
2. Take a PostgreSQL base backup with `pg_basebackup`.
3. Preserve the WAL archive directory.
4. Restore the base backup onto a replacement PostgreSQL node.
5. Create `recovery.signal` in the target PostgreSQL data directory.
6. Start PostgreSQL with `postgresql-pitr.conf` and the archived WAL directory mounted.
7. Restore the Attestor control-plane snapshot on top for file-backed and export-backed state.
8. Start Attestor API + worker against the recovered PostgreSQL + Redis pair.

This is a shipped operator bundle, not automatic replica promotion or managed failover.

## Redis / BullMQ recovery bundle

The repo ships a Redis durability reference at `ops/redis/redis-recovery.conf` and wires it into `docker-compose.dr.yml`.

Current Redis recovery stance:

- `appendonly yes`
- `appendfsync everysec`
- RDB snapshots remain enabled as an additional checkpoint layer

BullMQ recovery expectation:

- queued jobs survive according to Redis durability
- in-flight jobs may be retried or marked stalled after process loss
- the in-process fallback path is still non-durable

## Critical vs ephemeral state

### Critical

Back up and restore these by default:

- hosted accounts
- account users
- account sessions
- tenant keys
- usage ledger
- billing entitlement read model
- async DLQ store
- admin audit log
- shared billing event ledger

### Ephemeral

Include only if you explicitly want replay continuity:

- admin idempotency replay store
- Stripe webhook dedupe store

These are not long-term sources of truth. In many DR events it is acceptable not to restore them.

## Suggested DR drill

1. Take a control-plane snapshot.
2. Stop the current API/worker.
3. Provision a replacement node.
4. Restore the snapshot onto the replacement node.
5. Reconfigure the same:
   - `ATTESTOR_ADMIN_API_KEY`
   - `ATTESTOR_CONTROL_PLANE_PG_URL` if shared control-plane mode is used
   - Stripe env vars
   - `ATTESTOR_BILLING_LEDGER_PG_URL`
6. Start the API and worker.
7. Validate:
   - `GET /api/v1/ready`
   - `GET /api/v1/auth/me` using a known restored account session, or `POST /api/v1/auth/login` for a restored account user
   - `GET /api/v1/admin/accounts`
   - `GET /api/v1/admin/tenant-keys`
   - `GET /api/v1/admin/usage`
   - `GET /api/v1/admin/billing/events`
   - `GET /api/v1/account/billing/export` for a known tenant
8. Run a fresh hosted billing or pipeline request to confirm writes succeed after restore.

## RPO / RTO guidance

Current logical snapshot first slice is suitable for:

- operator-managed backup before deployment changes
- node replacement in a single-region first-slice environment
- DR drills for the hosted beta / pilot topology

It is not yet equivalent to:

- automated replicated control-plane storage
- zero-downtime failover
- orchestrated multi-region failover

## Current boundary

This improves operational safety materially, but it does not replace the longer-term work to:

- move the remaining non-shared control-plane edges fully off local files in all deployments
- add broader shared multi-node stores
- add fully automated PostgreSQL backup scheduling and retention policy outside the application
- add managed Redis failover / queue recovery operations beyond the shipped durability bundle
