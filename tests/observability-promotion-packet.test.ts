import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { renderObservabilityPromotionPacket } from '../scripts/render-observability-promotion-packet.ts';

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

async function main(): Promise<void> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-observability-promotion-'));
  const benchmarkPath = resolve(tempDir, 'benchmark.json');
  writeFileSync(
    benchmarkPath,
    `${JSON.stringify({
      requestsPerSecond: 31.2,
      p95LatencyMs: 280,
      successRate: 0.999,
    }, null, 2)}\n`,
    'utf8',
  );

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
    delete process.env.GRAFANA_CLOUD_OTLP_ENDPOINT;
    delete process.env.GRAFANA_CLOUD_OTLP_USERNAME;
    delete process.env.GRAFANA_CLOUD_OTLP_TOKEN;
    delete process.env.ALERTMANAGER_DEFAULT_WEBHOOK_URL;
    delete process.env.ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY;
    delete process.env.ALERTMANAGER_WARNING_WEBHOOK_URL;
    delete process.env.ALERTMANAGER_PRODUCTION_MODE;
    delete process.env.ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE;

    const blocked = await renderObservabilityPromotionPacket({
      provider: 'grafana-cloud',
      secretMode: 'external-secret',
      benchmarkPath,
      outputDir: resolve(tempDir, 'blocked'),
    });
    ok(blocked.readiness.state === 'blocked-on-environment-inputs', 'Observability promotion packet: missing env stays blocked');
    ok(blocked.readiness.missingInputs.some((item) => item.includes('GRAFANA_CLOUD_OTLP_ENDPOINT')), 'Observability promotion packet: missing Grafana endpoint is surfaced');

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
    process.env.OTEL_SERVICE_NAME = 'attestor-observability-promotion-packet-test';

    const ready = await renderObservabilityPromotionPacket({
      provider: 'grafana-cloud',
      secretMode: 'external-secret',
      benchmarkPath,
      prometheusUrl: `http://127.0.0.1:${prometheusPort}`,
      alertmanagerUrl: `http://127.0.0.1:${alertmanagerPort}`,
      outputDir: resolve(tempDir, 'ready'),
    });
    ok(ready.readiness.state === 'ready-for-environment-promotion', 'Observability promotion packet: ready state is reached with complete inputs');
    ok(ready.readiness.promotionGatePassed === true, 'Observability promotion packet: promotion gate passes');
    ok(ready.probe.releaseReadiness.alertRoutingSucceeded === true, 'Observability promotion packet: alert routing probe is included');
    ok(readFileSync(resolve(tempDir, 'ready', 'README.md'), 'utf8').includes('Recommended apply flow'), 'Observability promotion packet: rollout README is written');
    ok(readFileSync(resolve(tempDir, 'ready', 'summary.json'), 'utf8').includes('ready-for-environment-promotion'), 'Observability promotion packet: summary captures the final readiness state');

    console.log(`\nObservability promotion packet tests: ${passed} passed, 0 failed`);
  } finally {
    await new Promise<void>((resolveClose) => collector.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => prometheus.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => alertmanager.close(() => resolveClose()));
    rmSync(tempDir, { recursive: true, force: true });

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error('\nObservability promotion packet tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
