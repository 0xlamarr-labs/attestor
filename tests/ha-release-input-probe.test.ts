import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { probeHaReleaseInputs } from '../scripts/probe-ha-release-inputs.ts';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-ha-probe-'));
  const benchmarkPath = resolve(tempDir, 'benchmark.json');
  const certPath = resolve(tempDir, 'tls.crt');
  const keyPath = resolve(tempDir, 'tls.key');

  writeFileSync(
    benchmarkPath,
    `${JSON.stringify({
      requestsPerSecond: 14.85,
      p95LatencyMs: 620,
      successRate: 0.99,
      suggestedApiPrometheusThreshold: 18,
      suggestedWorkerRedisListThreshold: 74,
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
    ATTESTOR_TLS_MODE: process.env.ATTESTOR_TLS_MODE,
    ATTESTOR_TLS_CERT_PEM_FILE: process.env.ATTESTOR_TLS_CERT_PEM_FILE,
    ATTESTOR_TLS_KEY_PEM_FILE: process.env.ATTESTOR_TLS_KEY_PEM_FILE,
    ATTESTOR_HA_RUNTIME_SECRET_MODE: process.env.ATTESTOR_HA_RUNTIME_SECRET_MODE,
    ATTESTOR_HA_EXTERNAL_SECRET_STORE: process.env.ATTESTOR_HA_EXTERNAL_SECRET_STORE,
  };

  try {
    const missing = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(missing.rolloutReadiness.envComplete === false, 'HA release probe: missing envs are reported');
    ok(missing.rolloutReadiness.issues.some((issue) => issue.includes('ATTESTOR_API_IMAGE')), 'HA release probe: missing image requirement is surfaced');

    process.env.ATTESTOR_API_IMAGE = 'ghcr.io/example/attestor-api:1.2.3';
    process.env.ATTESTOR_WORKER_IMAGE = 'ghcr.io/example/attestor-worker:1.2.3';
    process.env.ATTESTOR_PUBLIC_HOSTNAME = 'ha.attestor.example.invalid';
    process.env.REDIS_URL = 'redis://cache.example.invalid:6379/0';
    process.env.ATTESTOR_CONTROL_PLANE_PG_URL = 'postgres://user:pass@db/control';
    process.env.ATTESTOR_BILLING_LEDGER_PG_URL = 'postgres://user:pass@db/billing';
    process.env.ATTESTOR_ADMIN_API_KEY = 'admin-key';
    process.env.ATTESTOR_TLS_MODE = 'secret';
    process.env.ATTESTOR_TLS_CERT_PEM_FILE = certPath;
    process.env.ATTESTOR_TLS_KEY_PEM_FILE = keyPath;
    delete process.env.ATTESTOR_HA_RUNTIME_SECRET_MODE;
    delete process.env.ATTESTOR_HA_EXTERNAL_SECRET_STORE;

    const ready = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(ready.rolloutReadiness.envComplete === true, 'HA release probe: env completeness passes with required inputs');
    ok(ready.rolloutReadiness.bundleRenderSucceeded === true, 'HA release probe: release bundle render succeeds in preflight');
    ok(ready.benchmark.p95LatencyMs === 620 && ready.benchmark.requestsPerSecond === 14.85, 'HA release probe: benchmark truth is echoed back');
    ok(ready.provider === 'generic' && ready.tlsMode === 'secret', 'HA release probe: provider and tls mode are captured');

    console.log(`\nHA release input probe tests: ${passed} passed, 0 failed`);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\nHA release input probe tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
