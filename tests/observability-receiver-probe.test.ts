import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { probeObservabilityReceivers } from '../scripts/probe-observability-receivers.ts';

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
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-observability-probe-'));
  const outputDir = resolve(tempDir, 'probe');
  const collectorRequests: string[] = [];

  const previousEnv = {
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

  const collector = createServer((req, res) => {
    collectorRequests.push(req.url ?? '/');
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
    process.env.OTEL_SERVICE_NAME = 'attestor-observability-probe-test';

    const summary = await probeObservabilityReceivers({
      prometheusUrl: `http://127.0.0.1:${prometheusPort}`,
      alertmanagerUrl: `http://127.0.0.1:${alertmanagerPort}`,
      outputDir,
    });

    const written = JSON.parse(readFileSync(resolve(outputDir, 'summary.json'), 'utf8')) as any;
    const readme = readFileSync(resolve(outputDir, 'README.md'), 'utf8');

    ok(summary.telemetry.enabled === true, 'Observability receiver probe: telemetry is enabled');
    ok(summary.telemetry.flushSucceeded === true, 'Observability receiver probe: OTLP flush succeeds');
    ok(collectorRequests.includes('/v1/logs') && collectorRequests.includes('/v1/traces') && collectorRequests.includes('/v1/metrics'), 'Observability receiver probe: all OTLP receiver paths are exercised');
    ok(summary.prometheus.ok === true && summary.prometheus.status === 200, 'Observability receiver probe: Prometheus query probe succeeds');
    ok(summary.alertmanager.ok === true && summary.alertmanager.activeAlerts === 1, 'Observability receiver probe: Alertmanager alerts probe succeeds');
    ok(written.telemetry.flushSucceeded === true, 'Observability receiver probe: summary is written to disk');
    ok(readme.includes('OTLP flush succeeded: true') && readme.includes('Prometheus configured: true'), 'Observability receiver probe: README captures probe truth');

    console.log(`\nObservability receiver probe tests: ${passed} passed, 0 failed`);
  } finally {
    await new Promise<void>((resolveClose) => collector.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => prometheus.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => alertmanager.close(() => resolveClose()));
    rmSync(tempDir, { recursive: true, force: true });

    if (previousEnv.OTEL_LOGS_EXPORTER === undefined) delete process.env.OTEL_LOGS_EXPORTER; else process.env.OTEL_LOGS_EXPORTER = previousEnv.OTEL_LOGS_EXPORTER;
    if (previousEnv.OTEL_TRACES_EXPORTER === undefined) delete process.env.OTEL_TRACES_EXPORTER; else process.env.OTEL_TRACES_EXPORTER = previousEnv.OTEL_TRACES_EXPORTER;
    if (previousEnv.OTEL_METRICS_EXPORTER === undefined) delete process.env.OTEL_METRICS_EXPORTER; else process.env.OTEL_METRICS_EXPORTER = previousEnv.OTEL_METRICS_EXPORTER;
    if (previousEnv.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT === undefined) delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT; else process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = previousEnv.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    if (previousEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT; else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = previousEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    if (previousEnv.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT === undefined) delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT; else process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = previousEnv.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    if (previousEnv.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL === undefined) delete process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL; else process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = previousEnv.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL;
    if (previousEnv.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL; else process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = previousEnv.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL;
    if (previousEnv.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL === undefined) delete process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL; else process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = previousEnv.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL;
    if (previousEnv.OTEL_METRIC_EXPORT_INTERVAL === undefined) delete process.env.OTEL_METRIC_EXPORT_INTERVAL; else process.env.OTEL_METRIC_EXPORT_INTERVAL = previousEnv.OTEL_METRIC_EXPORT_INTERVAL;
    if (previousEnv.OTEL_SERVICE_NAME === undefined) delete process.env.OTEL_SERVICE_NAME; else process.env.OTEL_SERVICE_NAME = previousEnv.OTEL_SERVICE_NAME;
  }
}

main().catch((error) => {
  console.error('\nObservability receiver probe tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
