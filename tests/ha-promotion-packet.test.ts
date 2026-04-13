import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import { renderHaPromotionPacket } from '../scripts/render-ha-promotion-packet.ts';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-ha-promotion-'));
  const benchmarkPath = resolve(tempDir, 'benchmark.json');
  const certPath = resolve(tempDir, 'tls.crt');
  const keyPath = resolve(tempDir, 'tls.key');
  const dataDir = mkdtempSync(join(tempDir, 'pg-'));

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

  writeFileSync(
    benchmarkPath,
    `${JSON.stringify({
      requestsPerSecond: 19.3,
      p95LatencyMs: 540,
      successRate: 0.995,
      suggestedApiPrometheusThreshold: 24,
      suggestedWorkerRedisListThreshold: 80,
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n', 'utf8');
  writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n', 'utf8');

  const previous = {
    ATTESTOR_API_IMAGE: process.env.ATTESTOR_API_IMAGE,
    ATTESTOR_WORKER_IMAGE: process.env.ATTESTOR_WORKER_IMAGE,
    ATTESTOR_PUBLIC_HOSTNAME: process.env.ATTESTOR_PUBLIC_HOSTNAME,
    REDIS_URL: process.env.REDIS_URL,
    ATTESTOR_CONTROL_PLANE_PG_URL: process.env.ATTESTOR_CONTROL_PLANE_PG_URL,
    ATTESTOR_BILLING_LEDGER_PG_URL: process.env.ATTESTOR_BILLING_LEDGER_PG_URL,
    ATTESTOR_ADMIN_API_KEY: process.env.ATTESTOR_ADMIN_API_KEY,
    ATTESTOR_METRICS_API_KEY: process.env.ATTESTOR_METRICS_API_KEY,
    ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY: process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY,
    ATTESTOR_TLS_MODE: process.env.ATTESTOR_TLS_MODE,
    ATTESTOR_TLS_CERT_PEM_FILE: process.env.ATTESTOR_TLS_CERT_PEM_FILE,
    ATTESTOR_TLS_KEY_PEM_FILE: process.env.ATTESTOR_TLS_KEY_PEM_FILE,
    ATTESTOR_HA_SECRET_STORE: process.env.ATTESTOR_HA_SECRET_STORE,
    ATTESTOR_HA_RUNTIME_SECRET_MODE: process.env.ATTESTOR_HA_RUNTIME_SECRET_MODE,
    ATTESTOR_REPO_PIPELINE_READY: process.env.ATTESTOR_REPO_PIPELINE_READY,
  };

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('control_plane');
    await pg.createDatabase('billing_ledger');
    const redisHost = await redis.getHost();
    const redisPort = await redis.getPort();
    const redisUrl = `redis://${redisHost}:${redisPort}`;
    const basePg = `postgres://test_attestor:test_attestor@localhost:${port}`;

    const blocked = await renderHaPromotionPacket({
      provider: 'generic',
      benchmarkPath,
      outputDir: resolve(tempDir, 'blocked'),
    });
    ok(blocked.readiness.state === 'blocked-on-environment-inputs', 'HA promotion packet: missing env stays blocked');
    ok(blocked.readiness.missingInputs.some((item) => item.includes('ATTESTOR_API_IMAGE')), 'HA promotion packet: missing image input is surfaced');

    process.env.ATTESTOR_API_IMAGE = 'ghcr.io/example/attestor-api:1.2.3';
    process.env.ATTESTOR_WORKER_IMAGE = 'ghcr.io/example/attestor-worker:1.2.3';
    process.env.ATTESTOR_PUBLIC_HOSTNAME = 'ha.attestor.example.invalid';
    process.env.REDIS_URL = redisUrl;
    process.env.ATTESTOR_CONTROL_PLANE_PG_URL = `${basePg}/control_plane`;
    process.env.ATTESTOR_BILLING_LEDGER_PG_URL = `${basePg}/billing_ledger`;
    process.env.ATTESTOR_ADMIN_API_KEY = 'admin-key';
    process.env.ATTESTOR_METRICS_API_KEY = 'metrics-key';
    process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY = 'mfa-key';
    process.env.ATTESTOR_TLS_MODE = 'secret';
    process.env.ATTESTOR_TLS_CERT_PEM_FILE = certPath;
    process.env.ATTESTOR_TLS_KEY_PEM_FILE = keyPath;
    delete process.env.ATTESTOR_HA_RUNTIME_SECRET_MODE;
    delete process.env.ATTESTOR_HA_SECRET_STORE;
    process.env.ATTESTOR_REPO_PIPELINE_READY = 'true';

    const ready = await renderHaPromotionPacket({
      provider: 'generic',
      benchmarkPath,
      outputDir: resolve(tempDir, 'ready'),
    });
    ok(ready.readiness.state === 'ready-for-environment-promotion', 'HA promotion packet: ready state is reached with complete inputs');
    ok(ready.readiness.promotionGatePassed === true, 'HA promotion packet: promotion gate passes');
    ok(ready.artifacts.releaseSummaryPath !== null, 'HA promotion packet: release summary is present when environment is complete');
    ok(readFileSync(resolve(tempDir, 'ready', 'README.md'), 'utf8').includes('Recommended apply flow'), 'HA promotion packet: rollout README is written');
    ok(readFileSync(resolve(tempDir, 'ready', 'summary.json'), 'utf8').includes('ready-for-environment-promotion'), 'HA promotion packet: summary captures the final readiness state');

    console.log(`\nHA promotion packet tests: ${passed} passed, 0 failed`);
  } finally {
    try { await redis.stop(); } catch {}
    try { await pg.stop(); } catch {}
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error('\nHA promotion packet tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
