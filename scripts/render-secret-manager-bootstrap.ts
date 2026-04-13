import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { remoteSecretKey } from './remote-secret-keys.ts';

type Provider = 'aws' | 'gke' | 'all';
type ConcreteProvider = 'aws' | 'gke';

interface SecretCatalogEntry {
  logicalName: string;
  remoteName: string;
  type: 'string' | 'json';
  required: boolean;
  consumer: 'observability' | 'ha';
  env?: string;
  properties?: string[];
  notes?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function yamlQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function providerList(provider: Provider): ConcreteProvider[] {
  return provider === 'all' ? ['aws', 'gke'] : [provider];
}

function buildCatalog(prefix: string, provider: ConcreteProvider): SecretCatalogEntry[] {
  return [
    {
      logicalName: 'observability/grafana-cloud',
      remoteName: remoteSecretKey(provider, 'observability/grafana-cloud'),
      type: 'json',
      required: true,
      consumer: 'observability',
      properties: ['otlp_endpoint', 'username', 'token'],
      notes: 'Managed OTLP exporter credentials for Grafana Cloud.',
    },
    {
      logicalName: 'observability/alertmanager',
      remoteName: remoteSecretKey(provider, 'observability/alertmanager'),
      type: 'json',
      required: true,
      consumer: 'observability',
      properties: [
        'default_webhook_url',
        'critical_webhook_url',
        'warning_webhook_url',
        'default_slack_webhook_url',
        'default_slack_channel',
        'warning_slack_webhook_url',
        'warning_slack_channel',
        'critical_pagerduty_routing_key',
        'security_webhook_url',
        'billing_webhook_url',
        'email_to',
        'email_from',
        'smarthost',
        'smtp_auth_username',
        'smtp_auth_password',
        'production_mode',
      ],
      notes: 'Alertmanager routing and escalation bundle.',
    },
    { logicalName: `${prefix}/redis-url`, remoteName: remoteSecretKey(provider, `${prefix}/redis-url`), type: 'string', required: true, consumer: 'ha', env: 'REDIS_URL' },
    { logicalName: `${prefix}/redis-address`, remoteName: remoteSecretKey(provider, `${prefix}/redis-address`), type: 'string', required: false, consumer: 'ha', env: 'REDIS_ADDRESS' },
    { logicalName: `${prefix}/redis-password`, remoteName: remoteSecretKey(provider, `${prefix}/redis-password`), type: 'string', required: false, consumer: 'ha', env: 'REDIS_PASSWORD' },
    { logicalName: `${prefix}/redis-username`, remoteName: remoteSecretKey(provider, `${prefix}/redis-username`), type: 'string', required: false, consumer: 'ha', env: 'REDIS_USERNAME' },
    {
      logicalName: `${prefix}/control-plane-pg-url`,
      remoteName: remoteSecretKey(provider, `${prefix}/control-plane-pg-url`),
      type: 'string',
      required: true,
      consumer: 'ha',
      env: 'ATTESTOR_CONTROL_PLANE_PG_URL',
    },
    {
      logicalName: `${prefix}/billing-ledger-pg-url`,
      remoteName: remoteSecretKey(provider, `${prefix}/billing-ledger-pg-url`),
      type: 'string',
      required: true,
      consumer: 'ha',
      env: 'ATTESTOR_BILLING_LEDGER_PG_URL',
    },
    {
      logicalName: `${prefix}/runtime-pg-url`,
      remoteName: remoteSecretKey(provider, `${prefix}/runtime-pg-url`),
      type: 'string',
      required: false,
      consumer: 'ha',
      env: 'ATTESTOR_PG_URL',
    },
    {
      logicalName: `${prefix}/admin-api-key`,
      remoteName: remoteSecretKey(provider, `${prefix}/admin-api-key`),
      type: 'string',
      required: true,
      consumer: 'ha',
      env: 'ATTESTOR_ADMIN_API_KEY',
    },
    {
      logicalName: `${prefix}/metrics-api-key`,
      remoteName: remoteSecretKey(provider, `${prefix}/metrics-api-key`),
      type: 'string',
      required: false,
      consumer: 'ha',
      env: 'ATTESTOR_METRICS_API_KEY',
    },
    {
      logicalName: `${prefix}/stripe-api-key`,
      remoteName: remoteSecretKey(provider, `${prefix}/stripe-api-key`),
      type: 'string',
      required: true,
      consumer: 'ha',
      env: 'STRIPE_API_KEY',
    },
    {
      logicalName: `${prefix}/stripe-webhook-secret`,
      remoteName: remoteSecretKey(provider, `${prefix}/stripe-webhook-secret`),
      type: 'string',
      required: true,
      consumer: 'ha',
      env: 'STRIPE_WEBHOOK_SECRET',
    },
    {
      logicalName: `${prefix}/stripe-price-starter`,
      remoteName: remoteSecretKey(provider, `${prefix}/stripe-price-starter`),
      type: 'string',
      required: true,
      consumer: 'ha',
      env: 'ATTESTOR_STRIPE_PRICE_STARTER',
    },
    {
      logicalName: `${prefix}/stripe-price-pro`,
      remoteName: remoteSecretKey(provider, `${prefix}/stripe-price-pro`),
      type: 'string',
      required: true,
      consumer: 'ha',
      env: 'ATTESTOR_STRIPE_PRICE_PRO',
    },
    {
      logicalName: `${prefix}/stripe-price-enterprise`,
      remoteName: remoteSecretKey(provider, `${prefix}/stripe-price-enterprise`),
      type: 'string',
      required: true,
      consumer: 'ha',
      env: 'ATTESTOR_STRIPE_PRICE_ENTERPRISE',
    },
    {
      logicalName: `${prefix}/tls-crt`,
      remoteName: remoteSecretKey(provider, `${prefix}/tls-crt`),
      type: 'string',
      required: false,
      consumer: 'ha',
      env: 'ATTESTOR_TLS_CERT_PEM',
      notes: 'Required when ATTESTOR_TLS_MODE=secret or external-secret.',
    },
    {
      logicalName: `${prefix}/tls-key`,
      remoteName: remoteSecretKey(provider, `${prefix}/tls-key`),
      type: 'string',
      required: false,
      consumer: 'ha',
      env: 'ATTESTOR_TLS_KEY_PEM',
      notes: 'Required when ATTESTOR_TLS_MODE=secret or external-secret.',
    },
  ];
}

function renderAwsStore(storeName: string, region: string, roleArn: string | null, namespace: string, serviceAccount: string): string {
  const lines = [
    'apiVersion: external-secrets.io/v1beta1',
    'kind: ClusterSecretStore',
    'metadata:',
    `  name: ${storeName}`,
    'spec:',
    '  provider:',
    '    aws:',
    '      service: SecretsManager',
    `      region: ${region}`,
  ];
  if (roleArn) lines.push(`      role: ${yamlQuote(roleArn)}`);
  lines.push('      auth:');
  lines.push('        jwt:');
  lines.push('          serviceAccountRef:');
  lines.push(`            name: ${serviceAccount}`);
  lines.push(`            namespace: ${namespace}`);
  return `${lines.join('\n')}\n`;
}

function renderGkeStore(
  storeName: string,
  projectId: string,
  clusterProjectId: string,
  clusterLocation: string,
  clusterName: string,
  namespace: string,
  serviceAccount: string,
): string {
  return [
    'apiVersion: external-secrets.io/v1beta1',
    'kind: ClusterSecretStore',
    'metadata:',
    `  name: ${storeName}`,
    'spec:',
    '  provider:',
    '    gcpsm:',
    `      projectID: ${projectId}`,
    '      auth:',
    '        workloadIdentity:',
    `          clusterProjectID: ${clusterProjectId}`,
    `          clusterLocation: ${clusterLocation}`,
    `          clusterName: ${clusterName}`,
    '          serviceAccountRef:',
    `            name: ${serviceAccount}`,
    `            namespace: ${namespace}`,
    '',
  ].join('\n');
}

function renderSeed(catalog: SecretCatalogEntry[]): string {
  const seed: Record<string, string | Record<string, string>> = {};
  for (const entry of catalog) {
    if (entry.type === 'json') {
      seed[entry.remoteName] = Object.fromEntries((entry.properties ?? []).map((property) => [property, `REPLACE_ME_${property.toUpperCase()}`]));
    } else {
      seed[entry.remoteName] = entry.env ? `REPLACE_ME_FOR_${entry.env}` : 'REPLACE_ME';
    }
  }
  return `${JSON.stringify(seed, null, 2)}\n`;
}

export interface SecretManagerBootstrapSummary {
  providers: Array<{
    provider: ConcreteProvider;
    outputDir: string;
    observabilityStoreName: string;
    haStoreName: string;
    catalogSize: number;
  }>;
}

export function renderSecretManagerBootstrap(options?: {
  provider?: Provider;
  outputDir?: string;
}): SecretManagerBootstrapSummary {
  const provider = (options?.provider ?? arg('provider', env('ATTESTOR_SECRET_BOOTSTRAP_PROVIDER') ?? 'all')) as Provider;
  if (!['aws', 'gke', 'all'].includes(provider)) {
    throw new Error('--provider must be aws, gke, or all.');
  }
  const outputDir = resolve(options?.outputDir ?? arg('output-dir', '.attestor/secret-bootstrap')!);
  mkdirSync(outputDir, { recursive: true });

  const secretPrefix = env('ATTESTOR_HA_SECRET_PREFIX') ?? 'attestor';
  const observabilityStoreName = env('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE') ?? 'attestor-observability-secrets';
  const haStoreName = env('ATTESTOR_HA_SECRET_STORE') ?? 'attestor-platform-secrets';

  const awsRegion = env('ATTESTOR_AWS_REGION') ?? 'us-east-1';
  const awsRoleArn = env('ATTESTOR_AWS_EXTERNAL_SECRETS_ROLE_ARN');
  const awsNamespace = env('ATTESTOR_AWS_EXTERNAL_SECRETS_NAMESPACE') ?? 'external-secrets';
  const awsServiceAccount = env('ATTESTOR_AWS_EXTERNAL_SECRETS_SERVICE_ACCOUNT') ?? 'external-secrets';

  const gcpProjectId = env('ATTESTOR_GCP_SECRET_PROJECT_ID') ?? 'replace-me-project';
  const gcpClusterProjectId = env('ATTESTOR_GCP_WI_CLUSTER_PROJECT_ID') ?? gcpProjectId;
  const gcpClusterLocation = env('ATTESTOR_GCP_WI_CLUSTER_LOCATION') ?? 'europe-west1';
  const gcpClusterName = env('ATTESTOR_GCP_WI_CLUSTER_NAME') ?? 'replace-me-cluster';
  const gcpNamespace = env('ATTESTOR_GCP_EXTERNAL_SECRETS_NAMESPACE') ?? 'external-secrets';
  const gcpServiceAccount = env('ATTESTOR_GCP_EXTERNAL_SECRETS_SERVICE_ACCOUNT') ?? 'external-secrets';

  const summary: SecretManagerBootstrapSummary = { providers: [] };

  for (const concreteProvider of providerList(provider)) {
    const providerDir = resolve(outputDir, concreteProvider);
    mkdirSync(providerDir, { recursive: true });
    const catalog = buildCatalog(secretPrefix, concreteProvider);

    const readme = `# Attestor ${concreteProvider.toUpperCase()} secret-manager bootstrap

This bundle is the recommended best-practice secret wiring path:

- managed cloud secret manager
- External Secrets Operator
- identity-based auth (${concreteProvider === 'aws' ? 'IRSA / IAM role' : 'GKE Workload Identity'})
- no static provider access keys inside the repo

Files:

- \`observability-clustersecretstore.yaml\`
- \`ha-clustersecretstore.yaml\`
- \`catalog.json\`
- \`seed.json\`

Next steps:

1. Create the remote secrets listed in \`catalog.json\`.
2. Fill \`seed.json\` values in your cloud secret manager, not in git.
3. Apply the generated ClusterSecretStore manifests.
4. Use the existing Attestor render/probe chain:
   - \`npm run render:observability-credentials\`
   - \`npm run render:ha-credentials\`
   - \`npm run render:production-readiness-packet\`

Notes:

- AWS keeps path-style remote keys.
- GKE normalizes remote secret ids to Google Secret Manager-safe names and keeps the original logical path in \`catalog.json\`.
`;

    const observabilityStore = concreteProvider === 'aws'
      ? renderAwsStore(observabilityStoreName, awsRegion, awsRoleArn, awsNamespace, awsServiceAccount)
      : renderGkeStore(observabilityStoreName, gcpProjectId, gcpClusterProjectId, gcpClusterLocation, gcpClusterName, gcpNamespace, gcpServiceAccount);
    const haStore = concreteProvider === 'aws'
      ? renderAwsStore(haStoreName, awsRegion, awsRoleArn, awsNamespace, awsServiceAccount)
      : renderGkeStore(haStoreName, gcpProjectId, gcpClusterProjectId, gcpClusterLocation, gcpClusterName, gcpNamespace, gcpServiceAccount);

    writeFileSync(resolve(providerDir, 'observability-clustersecretstore.yaml'), observabilityStore, 'utf8');
    writeFileSync(resolve(providerDir, 'ha-clustersecretstore.yaml'), haStore, 'utf8');
    writeFileSync(resolve(providerDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    writeFileSync(resolve(providerDir, 'seed.json'), renderSeed(catalog), 'utf8');
    writeFileSync(resolve(providerDir, 'README.md'), readme, 'utf8');

    summary.providers.push({
      provider: concreteProvider,
      outputDir: providerDir,
      observabilityStoreName,
      haStoreName,
      catalogSize: catalog.length,
    });
  }

  writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

try {
  console.log(JSON.stringify(renderSecretManagerBootstrap(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
