import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function yamlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function env(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function pushWebhookConfig(lines, url, sendResolved = true) {
  lines.push('      - send_resolved: ' + String(sendResolved));
  lines.push('        url: ' + yamlString(url));
}

function buildConfig() {
  const defaultWebhook = env('ALERTMANAGER_DEFAULT_WEBHOOK_URL');
  const criticalWebhook = env('ALERTMANAGER_CRITICAL_WEBHOOK_URL');
  const warningWebhook = env('ALERTMANAGER_WARNING_WEBHOOK_URL');
  const defaultSlackWebhook = env('ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL');
  const defaultSlackChannel = env('ALERTMANAGER_DEFAULT_SLACK_CHANNEL');
  const warningSlackWebhook = env('ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL');
  const warningSlackChannel = env('ALERTMANAGER_WARNING_SLACK_CHANNEL');
  const criticalPagerDutyKey = env('ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY');
  const securityWebhook = env('ALERTMANAGER_SECURITY_WEBHOOK_URL');
  const billingWebhook = env('ALERTMANAGER_BILLING_WEBHOOK_URL');
  const emailTo = env('ALERTMANAGER_EMAIL_TO');
  const emailFrom = env('ALERTMANAGER_EMAIL_FROM');
  const smarthost = env('ALERTMANAGER_SMARTHOST');
  const smtpAuthUsername = env('ALERTMANAGER_SMTP_AUTH_USERNAME');
  const smtpAuthPassword = env('ALERTMANAGER_SMTP_AUTH_PASSWORD');

  const lines = [
    'global:',
    '  resolve_timeout: 5m',
  ];

  if (smarthost) {
    lines.push('  smtp_smarthost: ' + yamlString(smarthost));
  }
  if (emailFrom) {
    lines.push('  smtp_from: ' + yamlString(emailFrom));
  }
  if (smtpAuthUsername) {
    lines.push('  smtp_auth_username: ' + yamlString(smtpAuthUsername));
  }
  if (smtpAuthPassword) {
    lines.push('  smtp_auth_password: ' + yamlString(smtpAuthPassword));
  }

  lines.push(
    '',
    'route:',
    '  receiver: default',
    '  group_by: [alertname, severity]',
    '  group_wait: 30s',
    '  group_interval: 5m',
    '  repeat_interval: 4h',
    '  routes:',
    '    - matchers:',
    '        - alertname="Watchdog"',
    '      receiver: watchdog',
    '      repeat_interval: 1m',
    '    - matchers:',
    '        - team="security"',
    '      receiver: security',
    '      continue: true',
    '    - matchers:',
    '        - team="billing"',
    '      receiver: billing',
    '      continue: true',
    '    - matchers:',
    '        - severity="critical"',
    '      receiver: critical',
    '    - matchers:',
    '        - severity="warning"',
    '      receiver: warning',
    '',
    'inhibit_rules:',
    '  - source_matchers:',
    '      - severity="critical"',
    '    target_matchers:',
    '      - severity="warning"',
    '    equal: [alertname]',
    '',
    'receivers:',
    '  - name: default',
  );

  if (defaultWebhook) {
    lines.push('    webhook_configs:');
    pushWebhookConfig(lines, defaultWebhook);
  }
  if (defaultSlackWebhook && defaultSlackChannel) {
    lines.push('    slack_configs:');
    lines.push('      - send_resolved: true');
    lines.push('        api_url: ' + yamlString(defaultSlackWebhook));
    lines.push('        channel: ' + yamlString(defaultSlackChannel));
    lines.push('        title: ' + yamlString('[attestor][default] {{ .CommonLabels.alertname }}'));
    lines.push('        text: ' + yamlString('{{ .CommonAnnotations.summary }}'));
  }

  lines.push('  - name: watchdog');

  lines.push('  - name: critical');
  if (criticalWebhook) {
    lines.push('    webhook_configs:');
    pushWebhookConfig(lines, criticalWebhook);
  }
  if (criticalPagerDutyKey) {
    lines.push('    pagerduty_configs:');
    lines.push('      - send_resolved: true');
    lines.push('        routing_key: ' + yamlString(criticalPagerDutyKey));
    lines.push('        severity: ' + yamlString('critical'));
    lines.push('        description: ' + yamlString('{{ .CommonAnnotations.summary }}'));
  }
  if (emailTo && smarthost) {
    lines.push('    email_configs:');
    lines.push('      - send_resolved: true');
    lines.push('        to: ' + yamlString(emailTo));
    if (emailFrom) {
      lines.push('        from: ' + yamlString(emailFrom));
    }
    lines.push('        headers:');
    lines.push('          Subject: ' + yamlString('[attestor][critical] {{ .CommonLabels.alertname }}'));
  }

  lines.push('  - name: warning');
  if (warningWebhook) {
    lines.push('    webhook_configs:');
    pushWebhookConfig(lines, warningWebhook);
  }
  if (warningSlackWebhook && warningSlackChannel) {
    lines.push('    slack_configs:');
    lines.push('      - send_resolved: true');
    lines.push('        api_url: ' + yamlString(warningSlackWebhook));
    lines.push('        channel: ' + yamlString(warningSlackChannel));
    lines.push('        title: ' + yamlString('[attestor][warning] {{ .CommonLabels.alertname }}'));
    lines.push('        text: ' + yamlString('{{ .CommonAnnotations.summary }}'));
  }
  if (emailTo && smarthost) {
    lines.push('    email_configs:');
    lines.push('      - send_resolved: true');
    lines.push('        to: ' + yamlString(emailTo));
    if (emailFrom) {
      lines.push('        from: ' + yamlString(emailFrom));
    }
    lines.push('        headers:');
    lines.push('          Subject: ' + yamlString('[attestor][warning] {{ .CommonLabels.alertname }}'));
  }

  lines.push('  - name: security');
  if (securityWebhook) {
    lines.push('    webhook_configs:');
    pushWebhookConfig(lines, securityWebhook);
  }

  lines.push('  - name: billing');
  if (billingWebhook) {
    lines.push('    webhook_configs:');
    pushWebhookConfig(lines, billingWebhook);
  }

  return lines.join('\n') + '\n';
}

const outputPath = resolve(process.argv[2] || 'ops/observability/alertmanager/rendered-alertmanager.yml');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, buildConfig(), 'utf8');
console.log(`Rendered Alertmanager config -> ${outputPath}`);
