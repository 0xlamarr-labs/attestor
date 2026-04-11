import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function main(): void {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-alertmanager-'));
  const outputPath = resolve(tempDir, 'alertmanager.yml');
  const run = spawnSync(
    process.execPath,
    ['scripts/render-alertmanager-config.mjs', outputPath],
    {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        ALERTMANAGER_DEFAULT_WEBHOOK_URL: 'https://alerts.example.invalid/default',
        ALERTMANAGER_CRITICAL_WEBHOOK_URL: 'https://alerts.example.invalid/critical',
        ALERTMANAGER_WARNING_WEBHOOK_URL: 'https://alerts.example.invalid/warning',
        ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL: 'https://slack.example.invalid/default',
        ALERTMANAGER_DEFAULT_SLACK_CHANNEL: '#ops-default',
        ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL: 'https://slack.example.invalid/warning',
        ALERTMANAGER_WARNING_SLACK_CHANNEL: '#ops-warning',
        ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY: 'pagerduty-key',
        ALERTMANAGER_SECURITY_WEBHOOK_URL: 'https://alerts.example.invalid/security',
        ALERTMANAGER_BILLING_WEBHOOK_URL: 'https://alerts.example.invalid/billing',
        ALERTMANAGER_EMAIL_TO: 'ops@example.invalid',
        ALERTMANAGER_EMAIL_FROM: 'attestor@example.invalid',
        ALERTMANAGER_SMARTHOST: 'smtp.example.invalid:587',
        ALERTMANAGER_SMTP_AUTH_USERNAME: 'mailer',
        ALERTMANAGER_SMTP_AUTH_PASSWORD: 'secret',
      },
    },
  );

  try {
    ok(run.status === 0, 'Alertmanager render: script exits successfully');
    const rendered = readFileSync(outputPath, 'utf8');
    ok(rendered.includes('receiver: critical') && rendered.includes('receiver: warning'), 'Alertmanager render: routes are split by severity');
    ok(rendered.includes('url: \'https://alerts.example.invalid/critical\''), 'Alertmanager render: critical webhook receiver is rendered');
    ok(rendered.includes('url: \'https://alerts.example.invalid/warning\''), 'Alertmanager render: warning webhook receiver is rendered');
    ok(rendered.includes('api_url: \'https://slack.example.invalid/default\'') && rendered.includes('channel: \'#ops-default\''), 'Alertmanager render: default Slack receiver is rendered');
    ok(rendered.includes('api_url: \'https://slack.example.invalid/warning\'') && rendered.includes('channel: \'#ops-warning\''), 'Alertmanager render: warning Slack receiver is rendered');
    ok(rendered.includes('routing_key: \'pagerduty-key\''), 'Alertmanager render: critical PagerDuty receiver is rendered');
    ok(rendered.includes('team=\"security\"') && rendered.includes('receiver: security') && rendered.includes('url: \'https://alerts.example.invalid/security\''), 'Alertmanager render: security escalation route is rendered');
    ok(rendered.includes('team=\"billing\"') && rendered.includes('receiver: billing') && rendered.includes('url: \'https://alerts.example.invalid/billing\''), 'Alertmanager render: billing escalation route is rendered');
    ok(rendered.includes('smtp_smarthost: \'smtp.example.invalid:587\''), 'Alertmanager render: SMTP smarthost is rendered');
    ok(rendered.includes('to: \'ops@example.invalid\''), 'Alertmanager render: email receiver is rendered');
    ok(rendered.includes('receiver: watchdog'), 'Alertmanager render: Watchdog route is present');
    ok(rendered.includes('inhibit_rules:'), 'Alertmanager render: inhibition rules are rendered');

    console.log(`\nAlertmanager config render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error('\nAlertmanager config render tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
