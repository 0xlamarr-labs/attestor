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
  const recordingRules = read('ops/observability/prometheus/recording-rules.yml');
  const alertmanager = read('ops/observability/alertmanager/alertmanager.yml');
  const grafanaDatasources = read('ops/observability/grafana/provisioning/datasources/datasources.yml');
  const grafanaDashboards = read('ops/observability/grafana/provisioning/dashboards/dashboards.yml');
  const grafanaOverview = read('ops/observability/grafana/dashboards/attestor-overview.json');
  const grafanaSlo = read('ops/observability/grafana/dashboards/attestor-slo.json');
  const tempo = read('ops/observability/tempo/tempo.yml');
  const loki = read('ops/observability/loki/loki.yml');
  const bundleReadme = read('ops/observability/README.md');
  const alertRenderScript = read('scripts/render-alertmanager-config.mjs');
  const credentialsRenderScript = read('scripts/render-observability-credentials.ts');
  const profilesReadme = read('ops/observability/profiles/README.md');
  const regulatedProfile = read('ops/observability/profiles/regulated-production.json');
  const leanProfile = read('ops/observability/profiles/lean-production.json');

  ok(compose.includes('attestor-api:'), 'Observability bundle: compose defines attestor-api service');
  ok(compose.includes('otel-collector:'), 'Observability bundle: compose defines otel-collector service');
  ok(compose.includes('prometheus:'), 'Observability bundle: compose defines prometheus service');
  ok(compose.includes('alertmanager:'), 'Observability bundle: compose defines alertmanager service');
  ok(compose.includes('alertmanager-config-renderer:'), 'Observability bundle: compose defines Alertmanager config renderer service');
  ok(compose.includes('grafana:'), 'Observability bundle: compose defines grafana service');
  ok(compose.includes('tempo:'), 'Observability bundle: compose defines tempo service');
  ok(compose.includes('loki:'), 'Observability bundle: compose defines loki service');
  ok(compose.includes('ATTESTOR_METRICS_API_KEY: metrics-secret'), 'Observability bundle: compose wires dedicated metrics token');
  ok(compose.includes('--web.enable-remote-write-receiver'), 'Observability bundle: Prometheus enables remote write receiver for Tempo-generated metrics');
  ok(compose.includes('ATTESTOR_OBSERVABILITY_PROMETHEUS_RETENTION_TIME'), 'Observability bundle: Prometheus retention is tunable from compose env');
  ok(compose.includes('ATTESTOR_OBSERVABILITY_TEMPO_RETENTION_PERIOD'), 'Observability bundle: Tempo retention is tunable from compose env');
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
  ok(prometheus.includes('recording-rules.yml'), 'Observability bundle: Prometheus loads SLO recording rules');
  ok(prometheus.includes('job_name: tempo') && prometheus.includes('job_name: loki') && prometheus.includes('job_name: alertmanager'), 'Observability bundle: Prometheus scrapes backend control-plane components');
  ok(alerts.includes('AttestorApiDown'), 'Observability bundle: alert rules include API down alert');
  ok(alerts.includes('AttestorHttp5xxBurst'), 'Observability bundle: alert rules include 5xx alert');
  ok(alerts.includes('AttestorBillingWebhookFailures'), 'Observability bundle: alert rules include billing webhook alert');
  ok(alerts.includes('Watchdog'), 'Observability bundle: alert rules include Watchdog deadman alert');
  ok(alerts.includes('AttestorAvailabilityErrorBudgetFastBurn') && alerts.includes('AttestorLatencyErrorBudgetFastBurn'), 'Observability bundle: alert rules include fast burn-rate SLO alerts');
  ok(recordingRules.includes('attestor:slo_api_availability_burn_rate:1h') && recordingRules.includes('attestor:slo_api_latency_burn_rate:24h'), 'Observability bundle: recording rules derive multi-window SLO burn rates');
  ok(alertmanager.includes('receivers:'), 'Observability bundle: Alertmanager config declares receivers');
  ok(alertmanager.includes('inhibit_rules:') && alertmanager.includes('severity="critical"') && alertmanager.includes('receiver: watchdog'), 'Observability bundle: Alertmanager config includes severity routing and inhibition');
  ok(grafanaDatasources.includes('Prometheus'), 'Observability bundle: Grafana provisions Prometheus datasource');
  ok(grafanaDatasources.includes('Loki'), 'Observability bundle: Grafana provisions Loki datasource');
  ok(grafanaDatasources.includes('Tempo'), 'Observability bundle: Grafana provisions Tempo datasource');
  ok(grafanaDashboards.includes('/var/lib/grafana/dashboards'), 'Observability bundle: Grafana dashboard provisioning path configured');
  ok(grafanaOverview.includes('Attestor Overview'), 'Observability bundle: Grafana overview dashboard is present');
  ok(grafanaSlo.includes('Attestor SLO') && grafanaSlo.includes('traces_service_graph_request_total'), 'Observability bundle: Grafana SLO dashboard includes service graph metrics');
  ok(tempo.includes('block_retention') && tempo.includes('metrics_generator:') && tempo.includes('service-graphs') && tempo.includes('span-metrics'), 'Observability bundle: Tempo config sets trace retention and derives service-graph/span metrics');
  ok(loki.includes('retention_period') && loki.includes('compactor:'), 'Observability bundle: Loki config sets retention with compactor enabled');
  ok(alertRenderScript.includes('ALERTMANAGER_CRITICAL_WEBHOOK_URL') && alertRenderScript.includes('ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY') && alertRenderScript.includes('ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL'), 'Observability bundle: Alertmanager render script supports webhook, PagerDuty, and Slack routing');
  ok(alertRenderScript.includes('ALERTMANAGER_SECURITY_WEBHOOK_URL') && alertRenderScript.includes('ALERTMANAGER_BILLING_WEBHOOK_URL'), 'Observability bundle: Alertmanager render script supports team escalation routes');
  ok(alertRenderScript.includes('_FILE') && alertRenderScript.includes('ALERTMANAGER_PRODUCTION_MODE'), 'Observability bundle: Alertmanager render script supports secret-file inputs and production validation');
  ok(credentialsRenderScript.includes('GRAFANA_CLOUD_OTLP_ENDPOINT') && credentialsRenderScript.includes('attestor-alertmanager-routing'), 'Observability bundle: observability credential renderer emits managed collector and Alertmanager secret bundles');
  ok(profilesReadme.includes('render:observability-profile') && profilesReadme.includes('regulated-production.json'), 'Observability bundle: profile README documents render flow');
  ok(regulatedProfile.includes('"prometheusDays": 30') && regulatedProfile.includes('"availabilityTarget": 0.995'), 'Observability bundle: regulated profile ships longer-retention defaults');
  ok(leanProfile.includes('"prometheusDays": 15') && leanProfile.includes('"tempoHours": 336'), 'Observability bundle: lean profile ships cost-aware retention defaults');
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
