import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
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
    ATTESTOR_METRICS_API_KEY: process.env.ATTESTOR_METRICS_API_KEY,
    ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY: process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY,
    STRIPE_API_KEY: process.env.STRIPE_API_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    ATTESTOR_STRIPE_PRICE_STARTER: process.env.ATTESTOR_STRIPE_PRICE_STARTER,
    ATTESTOR_STRIPE_PRICE_PRO: process.env.ATTESTOR_STRIPE_PRICE_PRO,
    ATTESTOR_STRIPE_PRICE_ENTERPRISE: process.env.ATTESTOR_STRIPE_PRICE_ENTERPRISE,
    ATTESTOR_BILLING_SUCCESS_URL: process.env.ATTESTOR_BILLING_SUCCESS_URL,
    ATTESTOR_BILLING_CANCEL_URL: process.env.ATTESTOR_BILLING_CANCEL_URL,
    ATTESTOR_BILLING_PORTAL_RETURN_URL: process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL,
    ATTESTOR_TLS_MODE: process.env.ATTESTOR_TLS_MODE,
    ATTESTOR_TLS_CERT_PEM_FILE: process.env.ATTESTOR_TLS_CERT_PEM_FILE,
    ATTESTOR_TLS_KEY_PEM_FILE: process.env.ATTESTOR_TLS_KEY_PEM_FILE,
    ATTESTOR_SESSION_COOKIE_SECURE: process.env.ATTESTOR_SESSION_COOKIE_SECURE,
    ATTESTOR_STRIPE_USE_MOCK: process.env.ATTESTOR_STRIPE_USE_MOCK,
    ATTESTOR_HOSTED_OIDC_ALLOW_INSECURE_HTTP: process.env.ATTESTOR_HOSTED_OIDC_ALLOW_INSECURE_HTTP,
    ATTESTOR_HA_RUNTIME_SECRET_MODE: process.env.ATTESTOR_HA_RUNTIME_SECRET_MODE,
    ATTESTOR_HA_SECRET_STORE: process.env.ATTESTOR_HA_SECRET_STORE,
    ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND: process.env.ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND,
    ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL: process.env.ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL,
    ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY: process.env.ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY,
    ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY: process.env.ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY,
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

    const missing = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(missing.rolloutReadiness.envComplete === false, 'HA release probe: missing envs are reported');
    ok(missing.rolloutReadiness.issues.some((issue) => issue.includes('ATTESTOR_API_IMAGE')), 'HA release probe: missing image requirement is surfaced');

    process.env.ATTESTOR_API_IMAGE = 'ghcr.io/example/attestor-api:1.2.3';
    process.env.ATTESTOR_WORKER_IMAGE = 'ghcr.io/example/attestor-worker:1.2.3';
    process.env.ATTESTOR_PUBLIC_HOSTNAME = 'ha.attestor.example.invalid';
    process.env.REDIS_URL = redisUrl;
    process.env.ATTESTOR_CONTROL_PLANE_PG_URL = `${basePg}/control_plane`;
    process.env.ATTESTOR_BILLING_LEDGER_PG_URL = `${basePg}/billing_ledger`;
    process.env.ATTESTOR_ADMIN_API_KEY = 'admin-key';
    process.env.ATTESTOR_METRICS_API_KEY = 'metrics-key';
    process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY = 'mfa-key';
    process.env.STRIPE_API_KEY = 'sk_live_probe';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_probe';
    process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_probe';
    process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_probe';
    process.env.ATTESTOR_STRIPE_PRICE_ENTERPRISE = 'price_enterprise_probe';
    process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://ha.attestor.example.invalid/billing/success';
    process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://ha.attestor.example.invalid/billing/cancel';
    process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://ha.attestor.example.invalid/settings/billing';
    process.env.ATTESTOR_TLS_MODE = 'secret';
    process.env.ATTESTOR_TLS_CERT_PEM_FILE = certPath;
    process.env.ATTESTOR_TLS_KEY_PEM_FILE = keyPath;
    delete process.env.ATTESTOR_SESSION_COOKIE_SECURE;
    delete process.env.ATTESTOR_HA_RUNTIME_SECRET_MODE;
    delete process.env.ATTESTOR_HA_SECRET_STORE;

    const ready = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(ready.rolloutReadiness.envComplete === true, 'HA release probe: env completeness passes with required inputs');
    ok(ready.rolloutReadiness.bundleRenderSucceeded === true, 'HA release probe: release bundle render succeeds in preflight');
    ok(ready.rolloutReadiness.connectivityProbeSucceeded === true, 'HA release probe: runtime connectivity passes in preflight');
    ok(ready.benchmark.p95LatencyMs === 620 && ready.benchmark.requestsPerSecond === 14.85, 'HA release probe: benchmark truth is echoed back');
    ok(ready.provider === 'generic' && ready.tlsMode === 'secret', 'HA release probe: provider and tls mode are captured');

    delete process.env.STRIPE_API_KEY;
    const missingStripe = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(missingStripe.rolloutReadiness.envComplete === false, 'HA release probe: missing Stripe API key blocks public deployment readiness');
    ok(missingStripe.rolloutReadiness.issues.some((issue) => issue.includes('STRIPE_API_KEY')), 'HA release probe: missing Stripe API key issue is surfaced');
    process.env.STRIPE_API_KEY = 'sk_live_probe';

    process.env.ATTESTOR_HA_RUNTIME_SECRET_MODE = 'external-secret';
    process.env.ATTESTOR_HA_SECRET_STORE = 'platform-secrets';
    process.env.ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND = 'BadStoreKind';
    const invalidExternalSecret = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(invalidExternalSecret.rolloutReadiness.envComplete === false, 'HA release probe: invalid External Secrets store kind is rejected');
    ok(invalidExternalSecret.rolloutReadiness.issues.some((issue) => issue.includes('STORE_KIND')), 'HA release probe: invalid store kind issue is surfaced');

    process.env.ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND = 'SecretStore';
    process.env.ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL = '30m';
    process.env.ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY = 'Merge';
    process.env.ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY = 'Retain';
    const validExternalSecret = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(validExternalSecret.rolloutReadiness.envComplete === true, 'HA release probe: valid External Secrets lifecycle settings pass');
    ok(validExternalSecret.rolloutReadiness.bundleRenderSucceeded === true, 'HA release probe: valid External Secrets lifecycle settings still render');
    ok(validExternalSecret.rolloutReadiness.connectivityProbeSucceeded === true, 'HA release probe: valid External Secrets lifecycle settings keep runtime connectivity green');

    process.env.ATTESTOR_SESSION_COOKIE_SECURE = 'false';
    const insecureCookie = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(insecureCookie.rolloutReadiness.envComplete === false, 'HA release probe: explicit insecure session cookies block public deployment readiness');
    ok(insecureCookie.rolloutReadiness.issues.some((issue) => issue.includes('SESSION_COOKIE_SECURE')), 'HA release probe: insecure session cookie issue is surfaced');
    delete process.env.ATTESTOR_SESSION_COOKIE_SECURE;

    process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
    const mockStripe = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(mockStripe.rolloutReadiness.envComplete === false, 'HA release probe: mock Stripe blocks public deployment readiness');
    ok(mockStripe.rolloutReadiness.issues.some((issue) => issue.includes('STRIPE_USE_MOCK')), 'HA release probe: mock Stripe issue is surfaced');
    delete process.env.ATTESTOR_STRIPE_USE_MOCK;

    process.env.ATTESTOR_HOSTED_OIDC_ALLOW_INSECURE_HTTP = 'true';
    const insecureOidc = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(insecureOidc.rolloutReadiness.envComplete === false, 'HA release probe: insecure hosted OIDC override blocks public deployment readiness');
    ok(insecureOidc.rolloutReadiness.issues.some((issue) => issue.includes('OIDC_ALLOW_INSECURE_HTTP')), 'HA release probe: insecure hosted OIDC issue is surfaced');
    delete process.env.ATTESTOR_HOSTED_OIDC_ALLOW_INSECURE_HTTP;

    process.env.ATTESTOR_BILLING_SUCCESS_URL = 'http://ha.attestor.example.invalid/billing/success';
    const insecureBillingUrl = await probeHaReleaseInputs({ provider: 'generic', benchmarkPath });
    ok(insecureBillingUrl.rolloutReadiness.envComplete === false, 'HA release probe: insecure billing return URLs block public deployment readiness');
    ok(insecureBillingUrl.rolloutReadiness.issues.some((issue) => issue.includes('ATTESTOR_BILLING_SUCCESS_URL')), 'HA release probe: insecure billing URL issue is surfaced');

    console.log(`\nHA release input probe tests: ${passed} passed, 0 failed`);
  } finally {
    try { await redis.stop(); } catch {}
    try { await pg.stop(); } catch {}
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => {
  console.error('\nHA release input probe tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
