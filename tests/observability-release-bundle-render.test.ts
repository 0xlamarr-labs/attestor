import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function main(): void {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-observability-release-'));
  const benchmarkPath = resolve(tempDir, 'benchmark.json');
  const secretOut = resolve(tempDir, 'grafana-cloud-secret');
  const externalOut = resolve(tempDir, 'grafana-cloud-external');
  const alloyOut = resolve(tempDir, 'grafana-alloy-external');

  writeFileSync(
    benchmarkPath,
    `${JSON.stringify({
      requestsPerSecond: 22.4,
      p95LatencyMs: 420,
      successRate: 0.998,
    }, null, 2)}\n`,
    'utf8',
  );

  try {
    const secretRun = spawnSync(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        'scripts/render-observability-release-bundle.ts',
        '--provider=grafana-cloud',
        `--benchmark=${benchmarkPath}`,
        '--profile=ops/observability/profiles/regulated-production.json',
        `--output-dir=${secretOut}`,
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          GRAFANA_CLOUD_OTLP_ENDPOINT: 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp',
          GRAFANA_CLOUD_OTLP_USERNAME: '123456',
          GRAFANA_CLOUD_OTLP_TOKEN: 'grafana-secret-token',
          ALERTMANAGER_DEFAULT_WEBHOOK_URL: 'https://alerts.example.invalid/default',
          ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY: 'pd-secret',
          ALERTMANAGER_WARNING_WEBHOOK_URL: 'https://alerts.example.invalid/warning',
          ALERTMANAGER_PRODUCTION_MODE: 'true',
          ATTESTOR_OBSERVABILITY_SECRET_MODE: 'secret',
        },
      },
    );

    ok(secretRun.status === 0, `Observability release bundle: Grafana Cloud secret-mode render exits successfully\nstdout:\n${secretRun.stdout}\nstderr:\n${secretRun.stderr}`);
    const secretKustomization = readFileSync(resolve(secretOut, 'kustomization.yaml'), 'utf8');
    const secretConfigmap = readFileSync(resolve(secretOut, 'configmap.yaml'), 'utf8');
    const secretDeployment = readFileSync(resolve(secretOut, 'deployment.yaml'), 'utf8');
    const alertmanager = readFileSync(resolve(secretOut, 'alertmanager.generated.yml'), 'utf8');
    const retention = readFileSync(resolve(secretOut, 'retention.env'), 'utf8');
    const summary = JSON.parse(readFileSync(resolve(secretOut, 'summary.json'), 'utf8')) as any;

    ok(secretKustomization.includes('grafana-cloud.secret.yaml') && secretKustomization.includes('alertmanager-routing.secret.yaml'), 'Observability release bundle: secret mode includes rendered Grafana Cloud and Alertmanager secrets');
    ok(secretConfigmap.includes('basicauth/grafana_cloud') && secretConfigmap.includes('otlphttp/grafana_cloud'), 'Observability release bundle: Grafana Cloud configmap swaps to managed OTLP basicauth wiring');
    ok(secretDeployment.includes('GRAFANA_CLOUD_OTLP_ENDPOINT') && !secretDeployment.includes('TEMPO_OTLP_ENDPOINT'), 'Observability release bundle: Grafana Cloud deployment consumes secret-backed OTLP env instead of local Tempo/Loki envs');
    ok(alertmanager.includes('routing_key: \'pd-secret\'') && alertmanager.includes('url: \'https://alerts.example.invalid/default\''), 'Observability release bundle: rendered Alertmanager config carries production routing targets');
    ok(retention.includes('ATTESTOR_OBSERVABILITY_PROMETHEUS_RETENTION_TIME=30d') && retention.includes('ATTESTOR_OBSERVABILITY_TEMPO_RETENTION_PERIOD=720h'), 'Observability release bundle: profile-derived retention env is included');
    ok(summary.provider === 'grafana-cloud' && summary.secretMode === 'secret' && summary.alertmanagerConfigured === true, 'Observability release bundle: summary captures provider, secret mode, and alerting truth');

    const externalRun = spawnSync(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        'scripts/render-observability-release-bundle.ts',
        '--provider=grafana-cloud',
        `--benchmark=${benchmarkPath}`,
        '--profile=ops/observability/profiles/regulated-production.json',
        `--output-dir=${externalOut}`,
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          GRAFANA_CLOUD_OTLP_ENDPOINT: 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp',
          GRAFANA_CLOUD_OTLP_USERNAME: '123456',
          GRAFANA_CLOUD_OTLP_TOKEN: 'grafana-secret-token',
          ALERTMANAGER_DEFAULT_WEBHOOK_URL: 'https://alerts.example.invalid/default',
          ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY: 'pd-secret',
          ALERTMANAGER_WARNING_WEBHOOK_URL: 'https://alerts.example.invalid/warning',
          ALERTMANAGER_PRODUCTION_MODE: 'true',
          ATTESTOR_OBSERVABILITY_SECRET_MODE: 'external-secret',
          ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE: 'corp-secrets',
          ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE_KIND: 'ClusterSecretStore',
          ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_REFRESH_INTERVAL: '15m',
          ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_CREATION_POLICY: 'Owner',
          ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_DELETION_POLICY: 'Retain',
          ATTESTOR_OBSERVABILITY_NAMESPACE: 'obs-prod',
        },
      },
    );

    ok(externalRun.status === 0, `Observability release bundle: external-secret render exits successfully\nstdout:\n${externalRun.stdout}\nstderr:\n${externalRun.stderr}`);
    const externalKustomization = readFileSync(resolve(externalOut, 'kustomization.yaml'), 'utf8');
    const externalGrafanaSecret = readFileSync(resolve(externalOut, 'grafana-cloud.external-secret.yaml'), 'utf8');
    const externalAlertSecret = readFileSync(resolve(externalOut, 'alertmanager-routing.external-secret.yaml'), 'utf8');
    const externalNamespace = readFileSync(resolve(externalOut, 'namespace.yaml'), 'utf8');
    const externalSummary = JSON.parse(readFileSync(resolve(externalOut, 'summary.json'), 'utf8')) as any;
    ok(externalKustomization.includes('grafana-cloud.external-secret.yaml') && externalKustomization.includes('alertmanager-routing.external-secret.yaml'), 'Observability release bundle: external-secret mode includes ExternalSecret resources');
    ok(externalGrafanaSecret.includes('name: corp-secrets') && externalGrafanaSecret.includes('namespace: obs-prod') && externalGrafanaSecret.includes('refreshInterval: 15m') && externalGrafanaSecret.includes('deletionPolicy: Retain'), 'Observability release bundle: Grafana Cloud ExternalSecret rewires secret store, namespace, and lifecycle policy');
    ok(externalAlertSecret.includes('name: corp-secrets') && externalAlertSecret.includes('namespace: obs-prod') && externalAlertSecret.includes('refreshInterval: 15m') && externalAlertSecret.includes('deletionPolicy: Retain'), 'Observability release bundle: Alertmanager ExternalSecret rewires secret store, namespace, and lifecycle policy');
    ok(externalNamespace.includes('name: obs-prod'), 'Observability release bundle: namespace resource is rewritten');
    ok(externalSummary.externalSecretPolicy.refreshInterval === '15m' && externalSummary.externalSecretPolicy.deletionPolicy === 'Retain', 'Observability release bundle: summary captures external secret lifecycle policy');

    const alloyRun = spawnSync(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        'scripts/render-observability-release-bundle.ts',
        '--provider=grafana-alloy',
        `--benchmark=${benchmarkPath}`,
        '--profile=ops/observability/profiles/regulated-production.json',
        `--output-dir=${alloyOut}`,
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          GRAFANA_CLOUD_OTLP_ENDPOINT: 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp',
          GRAFANA_CLOUD_OTLP_USERNAME: '123456',
          GRAFANA_CLOUD_OTLP_TOKEN: 'grafana-secret-token',
          ALERTMANAGER_DEFAULT_WEBHOOK_URL: 'https://alerts.example.invalid/default',
          ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY: 'pd-secret',
          ALERTMANAGER_WARNING_WEBHOOK_URL: 'https://alerts.example.invalid/warning',
          ALERTMANAGER_PRODUCTION_MODE: 'true',
          ATTESTOR_OBSERVABILITY_SECRET_MODE: 'external-secret',
          ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE: 'corp-secrets',
        },
      },
    );

    ok(alloyRun.status === 0, `Observability release bundle: Grafana Alloy render exits successfully\nstdout:\n${alloyRun.stdout}\nstderr:\n${alloyRun.stderr}`);
    const alloyDeployment = readFileSync(resolve(alloyOut, 'deployment.yaml'), 'utf8');
    const alloyConfigmap = readFileSync(resolve(alloyOut, 'configmap.yaml'), 'utf8');
    const alloySummary = JSON.parse(readFileSync(resolve(alloyOut, 'summary.json'), 'utf8')) as any;
    ok(alloyDeployment.includes('grafana/alloy:latest') && alloyDeployment.includes('bin/otelcol'), 'Observability release bundle: Grafana Alloy provider swaps the runtime image and command');
    ok(alloyConfigmap.includes('otlphttp/grafana_cloud') && alloyConfigmap.includes('basicauth/grafana_cloud'), 'Observability release bundle: Grafana Alloy provider reuses the managed OTLP basicauth pipeline');
    ok(alloySummary.provider === 'grafana-alloy' && alloySummary.runtimeEngine === 'grafana-alloy-otel', 'Observability release bundle: summary captures the Grafana Alloy runtime engine');

    console.log(`\nObservability release bundle render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error('\nObservability release bundle render tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
