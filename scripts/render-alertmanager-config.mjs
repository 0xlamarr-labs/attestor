import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function yamlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function env(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function envOrFile(name) {
  const direct = env(name);
  if (direct) return direct;
  const filePath = env(`${name}_FILE`);
  if (!filePath) return null;
  const raw = readFileSync(resolve(filePath), 'utf8');
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function pushWebhookConfig(lines, url, sendResolved = true) {
  lines.push('      - send_resolved: ' + String(sendResolved));
  lines.push('        url: ' + yamlString(url));
}

function requirePair(leftName, leftValue, rightName, rightValue) {
  if ((leftValue && !rightValue) || (!leftValue && rightValue)) {
    throw new Error(`${leftName} and ${rightName} must be set together.`);
  }
}

function requireAtLeastOne(name, values) {
  if (!values.some(Boolean)) {
    throw new Error(`${name} requires at least one configured delivery target.`);
  }
}

function buildConfig() {
  const defaultWebhook = envOrFile('ALERTMANAGER_DEFAULT_WEBHOOK_URL');
  const criticalWebhook = envOrFile('ALERTMANAGER_CRITICAL_WEBHOOK_URL');
  const warningWebhook = envOrFile('ALERTMANAGER_WARNING_WEBHOOK_URL');
  const defaultSlackWebhook = envOrFile('ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL');
  const defaultSlackChannel = envOrFile('ALERTMANAGER_DEFAULT_SLACK_CHANNEL');
  const warningSlackWebhook = envOrFile('ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL');
  const warningSlackChannel = envOrFile('ALERTMANAGER_WARNING_SLACK_CHANNEL');
  const criticalPagerDutyKey = envOrFile('ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY');
  const securityWebhook = envOrFile('ALERTMANAGER_SECURITY_WEBHOOK_URL');
  const billingWebhook = envOrFile('ALERTMANAGER_BILLING_WEBHOOK_URL');
  const emailTo = envOrFile('ALERTMANAGER_EMAIL_TO');
  const emailFrom = envOrFile('ALERTMANAGER_EMAIL_FROM');
  const smarthost = envOrFile('ALERTMANAGER_SMARTHOST');
  const smtpAuthUsername = envOrFile('ALERTMANAGER_SMTP_AUTH_USERNAME');
  const smtpAuthPassword = envOrFile('ALERTMANAGER_SMTP_AUTH_PASSWORD');
  const productionMode = env('ALERTMANAGER_PRODUCTION_MODE') === 'true';

  requirePair('ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL', defaultSlackWebhook, 'ALERTMANAGER_DEFAULT_SLACK_CHANNEL', defaultSlackChannel);
  requirePair('ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL', warningSlackWebhook, 'ALERTMANAGER_WARNING_SLACK_CHANNEL', warningSlackChannel);
  requirePair('ALERTMANAGER_SMTP_AUTH_USERNAME', smtpAuthUsername, 'ALERTMANAGER_SMTP_AUTH_PASSWORD', smtpAuthPassword);
  if (emailTo || emailFrom || smtpAuthUsername || smtpAuthPassword) {
    if (!smarthost) {
      throw new Error('ALERTMANAGER_SMARTHOST is required when email delivery is configured.');
    }
    if (!emailTo) {
      throw new Error('ALERTMANAGER_EMAIL_TO is required when email delivery is configured.');
    }
  }
  if (productionMode) {
    requireAtLeastOne('ALERTMANAGER_PRODUCTION_MODE', [
      defaultWebhook,
      defaultSlackWebhook,
      emailTo,
    ]);
    requireAtLeastOne('critical alert routing', [
      criticalWebhook,
      criticalPagerDutyKey,
      emailTo,
    ]);
    requireAtLeastOne('warning alert routing', [
      warningWebhook,
      warningSlackWebhook,
      emailTo,
    ]);
  }

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
