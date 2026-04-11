import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type NullableString = string | null;

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function env(name: string): NullableString {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function envOrFile(name: string): NullableString {
  const direct = env(name);
  if (direct) return direct;
  const filePath = env(`${name}_FILE`);
  if (!filePath) return null;
  const raw = readFileSync(resolve(filePath), 'utf8').trim();
  return raw || null;
}

function yamlString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function maybeSecretLine(lines: string[], key: string, value: NullableString): void {
  if (!value) return;
  lines.push(`  ${key}: ${yamlString(value)}`);
}

function main(): void {
  const outputDir = resolve(arg('output-dir', '.attestor/observability/credentials')!);
  mkdirSync(outputDir, { recursive: true });

  const grafanaEndpoint = envOrFile('GRAFANA_CLOUD_OTLP_ENDPOINT');
  const grafanaUsername = envOrFile('GRAFANA_CLOUD_OTLP_USERNAME');
  const grafanaToken = envOrFile('GRAFANA_CLOUD_OTLP_TOKEN');

  if ((grafanaEndpoint || grafanaUsername || grafanaToken) && !(grafanaEndpoint && grafanaUsername && grafanaToken)) {
    throw new Error('GRAFANA_CLOUD_OTLP_ENDPOINT, GRAFANA_CLOUD_OTLP_USERNAME, and GRAFANA_CLOUD_OTLP_TOKEN must be set together.');
  }

  const alertKeys = [
    'ALERTMANAGER_DEFAULT_WEBHOOK_URL',
    'ALERTMANAGER_CRITICAL_WEBHOOK_URL',
    'ALERTMANAGER_WARNING_WEBHOOK_URL',
    'ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL',
    'ALERTMANAGER_DEFAULT_SLACK_CHANNEL',
    'ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL',
    'ALERTMANAGER_WARNING_SLACK_CHANNEL',
    'ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY',
    'ALERTMANAGER_SECURITY_WEBHOOK_URL',
    'ALERTMANAGER_BILLING_WEBHOOK_URL',
    'ALERTMANAGER_EMAIL_TO',
    'ALERTMANAGER_EMAIL_FROM',
    'ALERTMANAGER_SMARTHOST',
    'ALERTMANAGER_SMTP_AUTH_USERNAME',
    'ALERTMANAGER_SMTP_AUTH_PASSWORD',
    'ALERTMANAGER_PRODUCTION_MODE',
  ] as const;

  const alertValues = Object.fromEntries(alertKeys.map((key) => [key, envOrFile(key)])) as Record<(typeof alertKeys)[number], NullableString>;

  const summary = {
    grafanaCloud: {
      configured: Boolean(grafanaEndpoint && grafanaUsername && grafanaToken),
      endpoint: grafanaEndpoint,
      usernameConfigured: Boolean(grafanaUsername),
      tokenConfigured: Boolean(grafanaToken),
    },
    alertmanager: {
      configuredKeys: Object.entries(alertValues)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key),
      productionMode: alertValues.ALERTMANAGER_PRODUCTION_MODE === 'true',
      deliveryTargets: {
        defaultWebhook: Boolean(alertValues.ALERTMANAGER_DEFAULT_WEBHOOK_URL),
        criticalWebhook: Boolean(alertValues.ALERTMANAGER_CRITICAL_WEBHOOK_URL),
        warningWebhook: Boolean(alertValues.ALERTMANAGER_WARNING_WEBHOOK_URL),
        defaultSlack: Boolean(alertValues.ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL && alertValues.ALERTMANAGER_DEFAULT_SLACK_CHANNEL),
        warningSlack: Boolean(alertValues.ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL && alertValues.ALERTMANAGER_WARNING_SLACK_CHANNEL),
        pagerDuty: Boolean(alertValues.ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY),
        securityWebhook: Boolean(alertValues.ALERTMANAGER_SECURITY_WEBHOOK_URL),
        billingWebhook: Boolean(alertValues.ALERTMANAGER_BILLING_WEBHOOK_URL),
        email: Boolean(alertValues.ALERTMANAGER_EMAIL_TO && alertValues.ALERTMANAGER_SMARTHOST),
      },
    },
  };

  const localEnvLines: string[] = [];
  if (grafanaEndpoint) {
    localEnvLines.push(`GRAFANA_CLOUD_OTLP_ENDPOINT=${grafanaEndpoint}`);
    localEnvLines.push(`GRAFANA_CLOUD_OTLP_USERNAME=${grafanaUsername}`);
    localEnvLines.push(`GRAFANA_CLOUD_OTLP_TOKEN=${grafanaToken}`);
  }
  for (const key of alertKeys) {
    const value = alertValues[key];
    if (value) localEnvLines.push(`${key}=${value}`);
  }

  const grafanaSecretLines = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: attestor-otel-gateway-grafana-cloud',
    '  namespace: attestor-observability',
    'type: Opaque',
    'stringData:',
  ];
  maybeSecretLine(grafanaSecretLines, 'grafana-cloud-otlp-endpoint', grafanaEndpoint);
  maybeSecretLine(grafanaSecretLines, 'grafana-cloud-otlp-username', grafanaUsername);
  maybeSecretLine(grafanaSecretLines, 'grafana-cloud-otlp-token', grafanaToken);

  const alertSecretLines = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: attestor-alertmanager-routing',
    '  namespace: attestor-observability',
    'type: Opaque',
    'stringData:',
  ];
  for (const key of alertKeys) {
    maybeSecretLine(alertSecretLines, key, alertValues[key]);
  }

  const readme = `# Observability credential bundle

Generated by \`npm run render:observability-credentials\`.

- \`local.env\` can be fed into the local observability bundle.
- \`grafana-cloud.secret.yaml\` can be applied to the Grafana Cloud collector overlay.
- \`alertmanager-routing.secret.yaml\` can be consumed by secret managers or in-cluster render jobs.

This output intentionally contains secrets; do not commit it.
`;

  writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'local.env'), `${localEnvLines.join('\n')}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'grafana-cloud.secret.yaml'), `${grafanaSecretLines.join('\n')}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'alertmanager-routing.secret.yaml'), `${alertSecretLines.join('\n')}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'README.md'), readme, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
