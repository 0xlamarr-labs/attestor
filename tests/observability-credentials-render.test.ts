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
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-observability-creds-'));
  const outputDir = resolve(tempDir, 'bundle');
  const grafanaTokenPath = resolve(tempDir, 'grafana.token');
  writeFileSync(grafanaTokenPath, 'grafana-token-value\n', 'utf8');

  const run = spawnSync(
    process.execPath,
    [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/render-observability-credentials.ts', `--output-dir=${outputDir}`],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        GRAFANA_CLOUD_OTLP_ENDPOINT: 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp',
        GRAFANA_CLOUD_OTLP_USERNAME: '123456',
        GRAFANA_CLOUD_OTLP_TOKEN_FILE: grafanaTokenPath,
        ALERTMANAGER_DEFAULT_WEBHOOK_URL: 'https://alerts.example.invalid/default',
        ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY: 'pd-key',
        ALERTMANAGER_EMAIL_TO: 'ops@example.invalid',
        ALERTMANAGER_EMAIL_FROM: 'attestor@example.invalid',
        ALERTMANAGER_SMARTHOST: 'smtp.example.invalid:587',
        ALERTMANAGER_PRODUCTION_MODE: 'true',
      },
    },
  );

  try {
    ok(run.status === 0, 'Observability credentials render: script exits successfully');
    const summary = JSON.parse(readFileSync(resolve(outputDir, 'summary.json'), 'utf8')) as any;
    const localEnv = readFileSync(resolve(outputDir, 'local.env'), 'utf8');
    const grafanaSecret = readFileSync(resolve(outputDir, 'grafana-cloud.secret.yaml'), 'utf8');
    const alertSecret = readFileSync(resolve(outputDir, 'alertmanager-routing.secret.yaml'), 'utf8');
    const readme = readFileSync(resolve(outputDir, 'README.md'), 'utf8');

    ok(summary.grafanaCloud.configured === true, 'Observability credentials render: summary reports Grafana Cloud wiring');
    ok(summary.grafanaCloud.tokenConfigured === true, 'Observability credentials render: summary redacts token but reports presence');
    ok(summary.alertmanager.deliveryTargets.defaultWebhook === true, 'Observability credentials render: summary reports default webhook route');
    ok(summary.alertmanager.deliveryTargets.pagerDuty === true, 'Observability credentials render: summary reports PagerDuty route');
    ok(localEnv.includes('GRAFANA_CLOUD_OTLP_TOKEN=grafana-token-value'), 'Observability credentials render: local env contains Grafana token');
    ok(grafanaSecret.includes('grafana-cloud-otlp-username') && grafanaSecret.includes('grafana-cloud-otlp-token'), 'Observability credentials render: Grafana secret manifest contains username/token keys');
    ok(alertSecret.includes('ALERTMANAGER_DEFAULT_WEBHOOK_URL') && alertSecret.includes('ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY'), 'Observability credentials render: Alertmanager secret manifest contains routing keys');
    ok(readme.includes('do not commit'), 'Observability credentials render: README warns about secret material');

    console.log(`\nObservability credentials render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error('\nObservability credentials render tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
