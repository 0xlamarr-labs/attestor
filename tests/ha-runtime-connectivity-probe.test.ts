import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import { probeHaRuntimeConnectivity } from '../scripts/probe-ha-runtime-connectivity.ts';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-ha-connectivity-'));
  const certPath = resolve(tempDir, 'tls.crt');
  const keyPath = resolve(tempDir, 'tls.key');
  const dataDir = mkdtempSync(join(tempDir, 'pg-'));
  const port = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'test_attestor',
    password: 'test_attestor',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  const redis = new RedisMemoryServer();

  writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n', 'utf8');
  writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n', 'utf8');

  const previous = {
    ATTESTOR_API_IMAGE: process.env.ATTESTOR_API_IMAGE,
    ATTESTOR_WORKER_IMAGE: process.env.ATTESTOR_WORKER_IMAGE,
    ATTESTOR_PUBLIC_HOSTNAME: process.env.ATTESTOR_PUBLIC_HOSTNAME,
    REDIS_URL: process.env.REDIS_URL,
    ATTESTOR_CONTROL_PLANE_PG_URL: process.env.ATTESTOR_CONTROL_PLANE_PG_URL,
    ATTESTOR_BILLING_LEDGER_PG_URL: process.env.ATTESTOR_BILLING_LEDGER_PG_URL,
    ATTESTOR_PG_URL: process.env.ATTESTOR_PG_URL,
    ATTESTOR_RUNTIME_PROFILE: process.env.ATTESTOR_RUNTIME_PROFILE,
    ATTESTOR_RELEASE_AUTHORITY_PG_URL: process.env.ATTESTOR_RELEASE_AUTHORITY_PG_URL,
    ATTESTOR_TLS_MODE: process.env.ATTESTOR_TLS_MODE,
    ATTESTOR_TLS_CERT_PEM_FILE: process.env.ATTESTOR_TLS_CERT_PEM_FILE,
    ATTESTOR_TLS_KEY_PEM_FILE: process.env.ATTESTOR_TLS_KEY_PEM_FILE,
  };

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('control_plane');
    await pg.createDatabase('billing_ledger');
    await pg.createDatabase('runtime_db');
    await pg.createDatabase('release_authority');

    const host = await redis.getHost();
    const redisPort = await redis.getPort();
    const redisUrl = `redis://${host}:${redisPort}`;
    const basePg = `postgres://test_attestor:test_attestor@localhost:${port}`;

    process.env.ATTESTOR_API_IMAGE = 'ghcr.io/example/attestor-api:1.2.3';
    process.env.ATTESTOR_WORKER_IMAGE = 'ghcr.io/example/attestor-worker:1.2.3';
    process.env.ATTESTOR_PUBLIC_HOSTNAME = 'ha.attestor.example.invalid';
    process.env.REDIS_URL = redisUrl;
    process.env.ATTESTOR_CONTROL_PLANE_PG_URL = `${basePg}/control_plane`;
    process.env.ATTESTOR_BILLING_LEDGER_PG_URL = `${basePg}/billing_ledger`;
    process.env.ATTESTOR_PG_URL = `${basePg}/runtime_db`;
    process.env.ATTESTOR_RUNTIME_PROFILE = 'production-shared';
    process.env.ATTESTOR_RELEASE_AUTHORITY_PG_URL = `${basePg}/release_authority`;
    process.env.ATTESTOR_TLS_MODE = 'secret';
    process.env.ATTESTOR_TLS_CERT_PEM_FILE = certPath;
    process.env.ATTESTOR_TLS_KEY_PEM_FILE = keyPath;

    const ready = await probeHaRuntimeConnectivity({ provider: 'generic', timeoutMs: 3000 });
    ok(ready.overall.passed === true, 'HA runtime connectivity: reachable Redis and PostgreSQL inputs pass');
    ok(ready.checks.redis.reachable === true, 'HA runtime connectivity: Redis ping succeeds');
    ok(ready.checks.controlPlanePg.reachable === true, 'HA runtime connectivity: control-plane PG query succeeds');
    ok(ready.checks.billingLedgerPg.reachable === true, 'HA runtime connectivity: billing-ledger PG query succeeds');
    ok(ready.checks.runtimePg.reachable === true, 'HA runtime connectivity: runtime PG query succeeds');
    ok(ready.checks.runtimeProfile.productionShared === true, 'HA runtime connectivity: production-shared profile is detected');
    ok(ready.checks.releaseAuthorityPg.reachable === true, 'HA runtime connectivity: release-authority PG query succeeds');
    ok(ready.checks.tls.valid === true, 'HA runtime connectivity: TLS PEM material passes structural validation');

    process.env.ATTESTOR_RELEASE_AUTHORITY_PG_URL = `${basePg}/missing_release_authority`;
    const brokenReleaseAuthority = await probeHaRuntimeConnectivity({ provider: 'generic', timeoutMs: 500 });
    ok(brokenReleaseAuthority.overall.passed === false, 'HA runtime connectivity: broken release-authority PG endpoint blocks production-shared readiness');
    ok(brokenReleaseAuthority.overall.issues.some((issue) => issue.includes('Release-authority PostgreSQL connectivity failed')), 'HA runtime connectivity: release-authority PG failure is surfaced');
    process.env.ATTESTOR_RELEASE_AUTHORITY_PG_URL = `${basePg}/release_authority`;

    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const brokenRedis = await probeHaRuntimeConnectivity({ provider: 'generic', timeoutMs: 500 });
    ok(brokenRedis.overall.passed === false, 'HA runtime connectivity: broken Redis endpoint blocks readiness');
    ok(brokenRedis.overall.issues.some((issue) => issue.includes('Redis connectivity failed')), 'HA runtime connectivity: Redis failure is surfaced');

    console.log(`\nHA runtime connectivity probe tests: ${passed} passed, 0 failed`);
  } finally {
    try { await redis.stop(); } catch {}
    try { await pg.stop(); } catch {}
    rmSync(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error('\nHA runtime connectivity probe tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
