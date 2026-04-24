import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer as createTcpServer } from 'node:net';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { RedisMemoryServer } from 'redis-memory-server';
import { renderProductionReadinessPacket } from '../scripts/render-production-readiness-packet.ts';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to resolve port.'));
        return;
      }
      resolvePort(address.port);
    });
    server.on('error', reject);
  });
}

function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createTcpServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to resolve TCP port.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-production-readiness-'));
  const observabilityBenchmarkPath = resolve(tempDir, 'observability-benchmark.json');
  const haBenchmarkPath = resolve(tempDir, 'ha-benchmark.json');
  const certPath = resolve(tempDir, 'tls.crt');
  const keyPath = resolve(tempDir, 'tls.key');
  const pgDataDir = mkdtempSync(join(tempDir, 'pg-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user: 'test_attestor',
    password: 'test_attestor',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  const redis = new RedisMemoryServer();

  writeFileSync(
    observabilityBenchmarkPath,
    `${JSON.stringify({ requestsPerSecond: 28.1, p95LatencyMs: 190, successRate: 0.999 }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    haBenchmarkPath,
    `${JSON.stringify({ requestsPerSecond: 21.4, p95LatencyMs: 420, successRate: 0.997 }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n', 'utf8');
  writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n', 'utf8');

  const previous = {
    GRAFANA_CLOUD_OTLP_ENDPOINT: process.env.GRAFANA_CLOUD_OTLP_ENDPOINT,
    GRAFANA_CLOUD_OTLP_USERNAME: process.env.GRAFANA_CLOUD_OTLP_USERNAME,
    GRAFANA_CLOUD_OTLP_TOKEN: process.env.GRAFANA_CLOUD_OTLP_TOKEN,
    ALERTMANAGER_DEFAULT_WEBHOOK_URL: process.env.ALERTMANAGER_DEFAULT_WEBHOOK_URL,
    ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY: process.env.ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY,
    ALERTMANAGER_WARNING_WEBHOOK_URL: process.env.ALERTMANAGER_WARNING_WEBHOOK_URL,
    ALERTMANAGER_PRODUCTION_MODE: process.env.ALERTMANAGER_PRODUCTION_MODE,
    ATTESTOR_OBSERVABILITY_SECRET_MODE: process.env.ATTESTOR_OBSERVABILITY_SECRET_MODE,
    ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE: process.env.ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE,
    OTEL_LOGS_EXPORTER: process.env.OTEL_LOGS_EXPORTER,
    OTEL_TRACES_EXPORTER: process.env.OTEL_TRACES_EXPORTER,
    OTEL_METRICS_EXPORTER: process.env.OTEL_METRICS_EXPORTER,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL,
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL,
    OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL,
    OTEL_METRIC_EXPORT_INTERVAL: process.env.OTEL_METRIC_EXPORT_INTERVAL,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    ATTESTOR_API_IMAGE: process.env.ATTESTOR_API_IMAGE,
    ATTESTOR_WORKER_IMAGE: process.env.ATTESTOR_WORKER_IMAGE,
    ATTESTOR_PUBLIC_HOSTNAME: process.env.ATTESTOR_PUBLIC_HOSTNAME,
    REDIS_URL: process.env.REDIS_URL,
    ATTESTOR_CONTROL_PLANE_PG_URL: process.env.ATTESTOR_CONTROL_PLANE_PG_URL,
    ATTESTOR_BILLING_LEDGER_PG_URL: process.env.ATTESTOR_BILLING_LEDGER_PG_URL,
    ATTESTOR_RUNTIME_PROFILE: process.env.ATTESTOR_RUNTIME_PROFILE,
    ATTESTOR_RELEASE_AUTHORITY_PG_URL: process.env.ATTESTOR_RELEASE_AUTHORITY_PG_URL,
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
    ATTESTOR_REPO_PIPELINE_READY: process.env.ATTESTOR_REPO_PIPELINE_READY,
    ATTESTOR_TLS_MODE: process.env.ATTESTOR_TLS_MODE,
    ATTESTOR_TLS_CERT_PEM_FILE: process.env.ATTESTOR_TLS_CERT_PEM_FILE,
    ATTESTOR_TLS_KEY_PEM_FILE: process.env.ATTESTOR_TLS_KEY_PEM_FILE,
  };

  const collector = createServer((_req, res) => {
    res.writeHead(200).end('ok');
  });
  const prometheus = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/api/v1/query')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: [1, '1'] }] } }));
      return;
    }
    res.writeHead(404).end();
  });
  const alertmanager = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ labels: { severity: 'critical' } }]));
  });

  const collectorPort = await listen(collector);
  const prometheusPort = await listen(prometheus);
  const alertmanagerPort = await listen(alertmanager);

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('control_plane');
    await pg.createDatabase('billing_ledger');
    await pg.createDatabase('release_authority');
    const redisHost = await redis.getHost();
    const redisPort = await redis.getPort();
    const redisUrl = `redis://${redisHost}:${redisPort}`;
    const basePg = `postgres://test_attestor:test_attestor@localhost:${pgPort}`;

    process.env.GRAFANA_CLOUD_OTLP_ENDPOINT = 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp';
    process.env.GRAFANA_CLOUD_OTLP_USERNAME = '123456';
    process.env.GRAFANA_CLOUD_OTLP_TOKEN = 'grafana-secret-token';
    process.env.ALERTMANAGER_DEFAULT_WEBHOOK_URL = 'https://alerts.example.invalid/default';
    process.env.ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY = 'pd-secret';
    process.env.ALERTMANAGER_WARNING_WEBHOOK_URL = 'https://alerts.example.invalid/warning';
    process.env.ALERTMANAGER_PRODUCTION_MODE = 'true';
    process.env.ATTESTOR_OBSERVABILITY_SECRET_MODE = 'external-secret';
    process.env.ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE = 'corp-secrets';
    process.env.OTEL_LOGS_EXPORTER = 'otlp';
    process.env.OTEL_TRACES_EXPORTER = 'otlp';
    process.env.OTEL_METRICS_EXPORTER = 'otlp';
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = `http://127.0.0.1:${collectorPort}/v1/logs`;
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${collectorPort}/v1/traces`;
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = `http://127.0.0.1:${collectorPort}/v1/metrics`;
    process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = 'http/protobuf';
    process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = 'http/protobuf';
    process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = 'http/protobuf';
    process.env.OTEL_METRIC_EXPORT_INTERVAL = '200';
    process.env.OTEL_SERVICE_NAME = 'attestor-production-readiness-test';

    process.env.ATTESTOR_API_IMAGE = 'ghcr.io/example/attestor-api:1.2.3';
    process.env.ATTESTOR_WORKER_IMAGE = 'ghcr.io/example/attestor-worker:1.2.3';
    process.env.ATTESTOR_PUBLIC_HOSTNAME = 'ha.attestor.example.invalid';
    process.env.REDIS_URL = redisUrl;
    process.env.ATTESTOR_CONTROL_PLANE_PG_URL = `${basePg}/control_plane`;
    process.env.ATTESTOR_BILLING_LEDGER_PG_URL = `${basePg}/billing_ledger`;
    process.env.ATTESTOR_RUNTIME_PROFILE = 'production-shared';
    process.env.ATTESTOR_RELEASE_AUTHORITY_PG_URL = `${basePg}/release_authority`;
    process.env.ATTESTOR_ADMIN_API_KEY = 'admin-key';
    process.env.ATTESTOR_METRICS_API_KEY = 'metrics-key';
    process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY = 'mfa-key';
    process.env.STRIPE_API_KEY = 'sk_live_readiness';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_readiness';
    process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_readiness';
    process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_readiness';
    process.env.ATTESTOR_STRIPE_PRICE_ENTERPRISE = 'price_enterprise_readiness';
    process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://ha.attestor.example.invalid/billing/success';
    process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://ha.attestor.example.invalid/billing/cancel';
    process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://ha.attestor.example.invalid/settings/billing';
    process.env.ATTESTOR_REPO_PIPELINE_READY = 'true';
    process.env.ATTESTOR_TLS_MODE = 'secret';
    process.env.ATTESTOR_TLS_CERT_PEM_FILE = certPath;
    process.env.ATTESTOR_TLS_KEY_PEM_FILE = keyPath;

    const staleTime = new Date(Date.now() - 48 * 3_600_000);
    utimesSync(observabilityBenchmarkPath, staleTime, staleTime);
    const blocked = await renderProductionReadinessPacket({
      observabilityProvider: 'grafana-cloud',
      observabilitySecretMode: 'external-secret',
      observabilityBenchmarkPath,
      prometheusUrl: `http://127.0.0.1:${prometheusPort}`,
      alertmanagerUrl: `http://127.0.0.1:${alertmanagerPort}`,
      haProvider: 'generic',
      haBenchmarkPath,
      observabilityBenchmarkMaxAgeHours: 24,
      haBenchmarkMaxAgeHours: 72,
      outputDir: resolve(tempDir, 'blocked'),
    });
    ok(blocked.readiness.state === 'blocked-on-environment-inputs', 'Production readiness packet: stale benchmark blocks readiness');
    ok(blocked.readiness.benchmarkFreshnessPassed === false, 'Production readiness packet: freshness gate fails when benchmark is stale');
    ok(blocked.readiness.issues.some((item) => item.includes('Observability benchmark is stale')), 'Production readiness packet: stale benchmark issue is surfaced');
    ok(readFileSync(resolve(tempDir, 'blocked', 'README.md'), 'utf8').includes('blocked-on-environment-inputs'), 'Production readiness packet: blocked README is written');

    delete process.env.ATTESTOR_RELEASE_AUTHORITY_PG_URL;
    const missingReleaseAuthority = await renderProductionReadinessPacket({
      observabilityProvider: 'grafana-alloy',
      observabilitySecretMode: 'external-secret',
      observabilityBenchmarkPath,
      prometheusUrl: `http://127.0.0.1:${prometheusPort}`,
      alertmanagerUrl: `http://127.0.0.1:${alertmanagerPort}`,
      haProvider: 'generic',
      haBenchmarkPath,
      observabilityBenchmarkMaxAgeHours: 72,
      haBenchmarkMaxAgeHours: 72,
      outputDir: resolve(tempDir, 'missing-release-authority'),
    });
    ok(missingReleaseAuthority.readiness.state === 'blocked-on-environment-inputs', 'Production readiness packet: production-shared blocks without release-authority PG');
    ok(missingReleaseAuthority.readiness.missingInputs.some((item) => item.includes('ATTESTOR_RELEASE_AUTHORITY_PG_URL')), 'Production readiness packet: missing release-authority PG is surfaced');
    process.env.ATTESTOR_RELEASE_AUTHORITY_PG_URL = `${basePg}/release_authority`;

    const now = new Date();
    utimesSync(observabilityBenchmarkPath, now, now);
    const ready = await renderProductionReadinessPacket({
      observabilityProvider: 'grafana-alloy',
      observabilitySecretMode: 'external-secret',
      observabilityBenchmarkPath,
      prometheusUrl: `http://127.0.0.1:${prometheusPort}`,
      alertmanagerUrl: `http://127.0.0.1:${alertmanagerPort}`,
      haProvider: 'generic',
      haBenchmarkPath,
      observabilityBenchmarkMaxAgeHours: 24,
      haBenchmarkMaxAgeHours: 72,
      outputDir: resolve(tempDir, 'ready'),
    });
    ok(ready.readiness.state === 'ready-for-environment-promotion', 'Production readiness packet: ready state is reached with complete fresh inputs');
    ok(ready.readiness.promotionGatePassed === true, 'Production readiness packet: both promotion gates pass');
    ok(ready.artifacts.observabilityPacketDir.endsWith('observability'), 'Production readiness packet: observability artifact path is captured');
    ok(ready.artifacts.haPacketDir.endsWith('ha'), 'Production readiness packet: HA artifact path is captured');
    ok(ready.observability.provider === 'grafana-alloy', 'Production readiness packet: Grafana Alloy can drive the observability side of the final handoff');
    ok(ready.runtimeAuthority.profile === 'production-shared', 'Production readiness packet: runtime profile truth is captured');
    ok(ready.runtimeAuthority.releaseAuthorityPgConfigured === true, 'Production readiness packet: release-authority PG is captured');
    ok(readFileSync(resolve(tempDir, 'ready', 'README.md'), 'utf8').includes('Runtime authority'), 'Production readiness packet: runtime authority section is written');

    console.log(`\nProduction readiness packet tests: ${passed} passed, 0 failed`);
  } finally {
    await new Promise<void>((resolveClose) => collector.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => prometheus.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => alertmanager.close(() => resolveClose()));
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
  console.error('\nProduction readiness packet tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
