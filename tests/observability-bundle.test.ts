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
  const compose = read('docker-compose.observability.yml');
  const collector = read('ops/otel/collector-config.yaml');
  const prometheus = read('ops/observability/prometheus/prometheus.yml');
  const alerts = read('ops/observability/prometheus/alerts.yml');
  const alertmanager = read('ops/observability/alertmanager/alertmanager.yml');
  const grafanaDatasources = read('ops/observability/grafana/provisioning/datasources/datasources.yml');
  const grafanaDashboards = read('ops/observability/grafana/provisioning/dashboards/dashboards.yml');
  const grafanaOverview = read('ops/observability/grafana/dashboards/attestor-overview.json');
  const tempo = read('ops/observability/tempo/tempo.yml');
  const loki = read('ops/observability/loki/loki.yml');
  const bundleReadme = read('ops/observability/README.md');

  ok(compose.includes('attestor-api:'), 'Observability bundle: compose defines attestor-api service');
  ok(compose.includes('otel-collector:'), 'Observability bundle: compose defines otel-collector service');
  ok(compose.includes('prometheus:'), 'Observability bundle: compose defines prometheus service');
  ok(compose.includes('alertmanager:'), 'Observability bundle: compose defines alertmanager service');
  ok(compose.includes('grafana:'), 'Observability bundle: compose defines grafana service');
  ok(compose.includes('tempo:'), 'Observability bundle: compose defines tempo service');
  ok(compose.includes('loki:'), 'Observability bundle: compose defines loki service');
  ok(compose.includes('ATTESTOR_METRICS_API_KEY: metrics-secret'), 'Observability bundle: compose wires dedicated metrics token');
  ok(compose.includes('./ops/otel/collector-config.yaml'), 'Observability bundle: collector config mounted into compose');
  ok(collector.includes('receivers:'), 'Observability bundle: collector config declares receivers');
  ok(collector.includes('otlp:'), 'Observability bundle: collector config declares OTLP receiver');
  ok(collector.includes('exporters:'), 'Observability bundle: collector config declares exporters');
  ok(collector.includes('otlp/tempo:'), 'Observability bundle: collector forwards traces to Tempo');
  ok(collector.includes('otlphttp/loki:'), 'Observability bundle: collector forwards logs to Loki');
  ok(collector.includes('prometheus:'), 'Observability bundle: collector exposes Prometheus metrics exporter');
  ok(collector.includes('memory_limiter:'), 'Observability bundle: collector config enables memory limiter');
  ok(collector.includes('traces:') && collector.includes('metrics:') && collector.includes('logs:'), 'Observability bundle: collector pipelines cover traces, metrics, and logs');
  ok(prometheus.includes('/api/v1/metrics'), 'Observability bundle: Prometheus scrapes dedicated metrics route');
  ok(prometheus.includes('credentials: metrics-secret'), 'Observability bundle: Prometheus scrape uses bearer token');
  ok(prometheus.includes('alertmanagers:'), 'Observability bundle: Prometheus forwards alerts to Alertmanager');
  ok(alerts.includes('AttestorApiDown'), 'Observability bundle: alert rules include API down alert');
  ok(alerts.includes('AttestorHttp5xxBurst'), 'Observability bundle: alert rules include 5xx alert');
  ok(alerts.includes('AttestorBillingWebhookFailures'), 'Observability bundle: alert rules include billing webhook alert');
  ok(alertmanager.includes('receivers:'), 'Observability bundle: Alertmanager config declares receivers');
  ok(grafanaDatasources.includes('Prometheus'), 'Observability bundle: Grafana provisions Prometheus datasource');
  ok(grafanaDatasources.includes('Loki'), 'Observability bundle: Grafana provisions Loki datasource');
  ok(grafanaDatasources.includes('Tempo'), 'Observability bundle: Grafana provisions Tempo datasource');
  ok(grafanaDashboards.includes('/var/lib/grafana/dashboards'), 'Observability bundle: Grafana dashboard provisioning path configured');
  ok(grafanaOverview.includes('Attestor Overview'), 'Observability bundle: Grafana overview dashboard is present');
  ok(tempo.includes('block_retention'), 'Observability bundle: Tempo config sets trace retention');
  ok(loki.includes('retention_period'), 'Observability bundle: Loki config sets log retention');
  ok(bundleReadme.includes('docker compose -f docker-compose.observability.yml up'), 'Observability bundle: README documents startup command');

  console.log(`\nObservability bundle tests: ${passed} passed, 0 failed`);
}

try {
  main();
} catch (error) {
  console.error('\nObservability bundle tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
