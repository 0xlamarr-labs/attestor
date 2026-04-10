import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

function main(): void {
  const compose = read('docker-compose.dr.yml');
  const postgresConfig = read('ops/postgres/pitr/postgresql-pitr.conf');
  const restoreScript = read('ops/postgres/pitr/restore-wal.sh');
  const postgresReadme = read('ops/postgres/pitr/README.md');
  const redisConfig = read('ops/redis/redis-recovery.conf');
  const redisReadme = read('ops/redis/README.md');
  const backupDr = read('docs/08-deployment/backup-restore-dr.md');

  ok(compose.includes('postgres-dr:'), 'DR bundle: compose defines postgres-dr service');
  ok(compose.includes('redis-dr:'), 'DR bundle: compose defines redis-dr service');
  ok(compose.includes('ATTESTOR_CONTROL_PLANE_PG_URL'), 'DR bundle: compose wires shared control-plane PG');
  ok(compose.includes('REDIS_URL: redis://redis-dr:6379'), 'DR bundle: compose wires external Redis for API/worker');
  ok(postgresConfig.includes('archive_mode = on'), 'DR bundle: PostgreSQL config enables WAL archiving');
  ok(postgresConfig.includes('wal_level = replica'), 'DR bundle: PostgreSQL config sets wal_level replica');
  ok(postgresConfig.includes('restore_command'), 'DR bundle: PostgreSQL config declares restore_command');
  ok(restoreScript.includes('cp "$source_file" "$destination"'), 'DR bundle: restore script copies archived WAL into place');
  ok(postgresReadme.includes('pg_basebackup'), 'DR bundle: PostgreSQL readme documents base backup');
  ok(postgresReadme.includes('recovery.signal'), 'DR bundle: PostgreSQL readme documents recovery.signal restore flow');
  ok(redisConfig.includes('appendonly yes'), 'DR bundle: Redis config enables appendonly persistence');
  ok(redisConfig.includes('appendfsync everysec'), 'DR bundle: Redis config uses everysec fsync');
  ok(redisReadme.includes('BullMQ'), 'DR bundle: Redis readme documents BullMQ recovery expectation');
  ok(backupDr.includes('docker-compose.dr.yml'), 'DR bundle: main DR doc points to shipped docker-compose.dr.yml');
  ok(backupDr.includes('recovery.signal'), 'DR bundle: main DR doc now documents PITR restore flow');

  console.log(`\nDR bundle tests: ${passed} passed, 0 failed`);
}

try {
  main();
} catch (error) {
  console.error('\nDR bundle tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
