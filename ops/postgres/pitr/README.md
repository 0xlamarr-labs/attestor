# PostgreSQL PITR Bundle

This bundle adds a production-oriented PostgreSQL continuous-archiving and restore reference for Attestor.

Files:

- `postgresql-pitr.conf` - enables WAL archiving and PITR restore hooks
- `restore-wal.sh` - container-side restore command used by PostgreSQL
- `../../../docker-compose.dr.yml` - reference topology wiring API, worker, Redis, and PostgreSQL together

## Base backup

Take a physical base backup from the running PostgreSQL primary:

```bash
pg_basebackup \
  -d "$ATTESTOR_PG_PITR_URL" \
  -D /var/lib/postgresql/base-backups/attestor-$(date +%Y%m%d%H%M%S) \
  -Fp -Xs -P
```

## Restore drill

1. Restore the chosen base backup into an empty PostgreSQL data directory.
2. Ensure the archived WAL files are available in `/var/lib/postgresql/archive`.
3. Create `recovery.signal` in the PostgreSQL data directory.
4. Start PostgreSQL with `postgresql-pitr.conf` mounted as the active config.
5. Validate Attestor control-plane and billing schemas before reconnecting API/worker.

## Boundary

This is a shipped operator bundle and runbook, not managed failover:

- no automated replica promotion
- no cross-region replication policy
- no backup scheduling daemon inside Attestor
