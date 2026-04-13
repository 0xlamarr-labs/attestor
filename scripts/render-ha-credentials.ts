import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { remoteSecretKey } from './remote-secret-keys.ts';

type NullableString = string | null;
type TlsMode = 'secret' | 'external-secret' | 'cert-manager' | 'aws-acm';
type Provider = 'generic' | 'aws' | 'gke';

interface SecretMapping {
  envName: string;
  secretKey: string;
  remoteSuffix: string;
}

const runtimeSecretMappings: SecretMapping[] = [
  { envName: 'REDIS_URL', secretKey: 'redis-url', remoteSuffix: 'redis-url' },
  { envName: 'REDIS_ADDRESS', secretKey: 'redis-address', remoteSuffix: 'redis-address' },
  { envName: 'REDIS_PASSWORD', secretKey: 'redis-password', remoteSuffix: 'redis-password' },
  { envName: 'REDIS_USERNAME', secretKey: 'redis-username', remoteSuffix: 'redis-username' },
  { envName: 'ATTESTOR_CONTROL_PLANE_PG_URL', secretKey: 'control-plane-pg-url', remoteSuffix: 'control-plane-pg-url' },
  { envName: 'ATTESTOR_BILLING_LEDGER_PG_URL', secretKey: 'billing-ledger-pg-url', remoteSuffix: 'billing-ledger-pg-url' },
  { envName: 'ATTESTOR_PG_URL', secretKey: 'runtime-pg-url', remoteSuffix: 'runtime-pg-url' },
  { envName: 'ATTESTOR_ADMIN_API_KEY', secretKey: 'admin-api-key', remoteSuffix: 'admin-api-key' },
  { envName: 'ATTESTOR_METRICS_API_KEY', secretKey: 'metrics-api-key', remoteSuffix: 'metrics-api-key' },
  { envName: 'ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY', secretKey: 'account-mfa-encryption-key', remoteSuffix: 'account-mfa-encryption-key' },
  { envName: 'STRIPE_API_KEY', secretKey: 'stripe-api-key', remoteSuffix: 'stripe-api-key' },
  { envName: 'STRIPE_WEBHOOK_SECRET', secretKey: 'stripe-webhook-secret', remoteSuffix: 'stripe-webhook-secret' },
  { envName: 'ATTESTOR_STRIPE_PRICE_STARTER', secretKey: 'stripe-price-starter', remoteSuffix: 'stripe-price-starter' },
  { envName: 'ATTESTOR_STRIPE_PRICE_PRO', secretKey: 'stripe-price-pro', remoteSuffix: 'stripe-price-pro' },
  { envName: 'ATTESTOR_STRIPE_PRICE_ENTERPRISE', secretKey: 'stripe-price-enterprise', remoteSuffix: 'stripe-price-enterprise' },
  { envName: 'ATTESTOR_HOSTED_OIDC_CLIENT_SECRET', secretKey: 'hosted-oidc-client-secret', remoteSuffix: 'hosted-oidc-client-secret' },
  { envName: 'ATTESTOR_HOSTED_OIDC_STATE_KEY', secretKey: 'hosted-oidc-state-key', remoteSuffix: 'hosted-oidc-state-key' },
  { envName: 'ATTESTOR_HOSTED_SAML_RELAY_STATE_KEY', secretKey: 'hosted-saml-relay-state-key', remoteSuffix: 'hosted-saml-relay-state-key' },
  { envName: 'ATTESTOR_HOSTED_SAML_SP_PRIVATE_KEY', secretKey: 'hosted-saml-sp-private-key', remoteSuffix: 'hosted-saml-sp-private-key' },
  { envName: 'ATTESTOR_HOSTED_SAML_SP_CERT', secretKey: 'hosted-saml-sp-cert', remoteSuffix: 'hosted-saml-sp-cert' },
];

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

function csv(value: NullableString): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function yamlQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function maybeYamlString(lines: string[], key: string, value: NullableString): void {
  if (!value) return;
  if (value.includes('\n')) {
    lines.push(`  ${key}: |`);
    for (const line of value.split(/\r?\n/)) {
      lines.push(`    ${line}`);
    }
    return;
  }
  lines.push(`  ${key}: ${yamlQuote(value)}`);
}

function bool(value: NullableString): boolean {
  return value === 'true';
}

function validateRefreshInterval(value: string): string {
  if (!/^[1-9]\d*[smhd]$/.test(value)) {
    throw new Error('ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL must look like 30m, 1h, or 7d.');
  }
  return value;
}

function validateStoreKind(value: string): 'ClusterSecretStore' | 'SecretStore' {
  if (value !== 'ClusterSecretStore' && value !== 'SecretStore') {
    throw new Error('ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND must be ClusterSecretStore or SecretStore.');
  }
  return value;
}

function validateCreationPolicy(value: string): 'Owner' | 'Orphan' | 'Merge' | 'None' {
  if (value !== 'Owner' && value !== 'Orphan' && value !== 'Merge' && value !== 'None') {
    throw new Error('ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY must be one of Owner, Orphan, Merge, or None.');
  }
  return value;
}

function validateDeletionPolicy(value: NullableString): 'Retain' | 'Merge' | 'Delete' | null {
  if (!value) return null;
  if (value !== 'Retain' && value !== 'Merge' && value !== 'Delete') {
    throw new Error('ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY must be one of Retain, Merge, or Delete when set.');
  }
  return value;
}

function requireAll(pairs: Array<[string, NullableString]>): void {
  for (const [name, value] of pairs) {
    if (!value) throw new Error(`${name} must be set.`);
  }
}

function main(): void {
  const outputDir = resolve(arg('output-dir', '.attestor/ha/credentials')!);
  mkdirSync(outputDir, { recursive: true });

  const provider = (arg('provider', env('ATTESTOR_HA_PROVIDER') ?? 'generic') as Provider);
  if (!['generic', 'aws', 'gke'].includes(provider)) {
    throw new Error('ATTESTOR_HA_PROVIDER must be one of generic, aws, or gke.');
  }

  const tlsMode = (arg('tls-mode', env('ATTESTOR_TLS_MODE') ?? 'secret') as TlsMode);
  if (!['secret', 'external-secret', 'cert-manager', 'aws-acm'].includes(tlsMode)) {
    throw new Error('ATTESTOR_TLS_MODE must be one of secret, external-secret, cert-manager, or aws-acm.');
  }

  const productionMode = bool(envOrFile('ATTESTOR_HA_PRODUCTION_MODE'));
  const hostname = envOrFile('ATTESTOR_PUBLIC_HOSTNAME');
  const gatewayClassName = envOrFile('ATTESTOR_GATEWAY_CLASS_NAME') ?? 'managed-external';
  const secretStoreName = envOrFile('ATTESTOR_HA_SECRET_STORE') ?? 'platform-secrets';
  const secretPrefix = envOrFile('ATTESTOR_HA_SECRET_PREFIX') ?? 'attestor';
  const remoteSecretProvider = provider === 'gke' ? 'gke' : provider === 'aws' ? 'aws' : 'generic';
  const externalSecretStoreKind = validateStoreKind(
    envOrFile('ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND') ?? 'ClusterSecretStore',
  );
  const externalSecretRefreshInterval = validateRefreshInterval(
    envOrFile('ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL') ?? '1h',
  );
  const externalSecretCreationPolicy = validateCreationPolicy(
    envOrFile('ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY') ?? 'Owner',
  );
  const externalSecretDeletionPolicy = validateDeletionPolicy(
    envOrFile('ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY'),
  );
  const tlsSecretName = envOrFile('ATTESTOR_TLS_SECRET_NAME') ?? 'attestor-tls';
  const clusterIssuer = envOrFile('ATTESTOR_TLS_CLUSTER_ISSUER');
  const tlsCertPem = envOrFile('ATTESTOR_TLS_CERT_PEM');
  const tlsKeyPem = envOrFile('ATTESTOR_TLS_KEY_PEM');
  const awsCertificateArns = csv(envOrFile('ATTESTOR_AWS_ALB_CERTIFICATE_ARNS'));
  const awsSslPolicy = envOrFile('ATTESTOR_AWS_ALB_SSL_POLICY');
  const awsWafAclArn = envOrFile('ATTESTOR_AWS_ALB_WAFV2_ACL_ARN');
  const awsGroupName = envOrFile('ATTESTOR_AWS_ALB_GROUP_NAME');
  const gkeSslPolicy = envOrFile('ATTESTOR_GKE_SSL_POLICY');
  const tlsDnsNames = csv(envOrFile('ATTESTOR_TLS_DNS_NAMES'));
  const dnsNames = tlsDnsNames.length > 0 ? tlsDnsNames : hostname ? [hostname] : [];

  if (!hostname) throw new Error('ATTESTOR_PUBLIC_HOSTNAME must be set.');
  if (tlsMode === 'secret') requireAll([['ATTESTOR_TLS_CERT_PEM', tlsCertPem], ['ATTESTOR_TLS_KEY_PEM', tlsKeyPem]]);
  if (tlsMode === 'cert-manager') requireAll([['ATTESTOR_TLS_CLUSTER_ISSUER', clusterIssuer]]);
  if (tlsMode === 'aws-acm') requireAll([['ATTESTOR_AWS_ALB_CERTIFICATE_ARNS', awsCertificateArns.join(',')]]);
  if (provider === 'gke' && tlsMode === 'aws-acm') throw new Error('ATTESTOR_TLS_MODE=aws-acm cannot be used with ATTESTOR_HA_PROVIDER=gke.');
  if (provider === 'aws' && tlsMode !== 'aws-acm' && productionMode) {
    throw new Error('Production AWS HA expects ATTESTOR_TLS_MODE=aws-acm so the ALB can terminate TLS with ACM.');
  }
  if (productionMode) {
    requireAll([
      ['REDIS_URL or REDIS_ADDRESS', envOrFile('REDIS_URL') ?? envOrFile('REDIS_ADDRESS')],
      ['ATTESTOR_CONTROL_PLANE_PG_URL', envOrFile('ATTESTOR_CONTROL_PLANE_PG_URL')],
      ['ATTESTOR_BILLING_LEDGER_PG_URL', envOrFile('ATTESTOR_BILLING_LEDGER_PG_URL')],
      ['ATTESTOR_ADMIN_API_KEY', envOrFile('ATTESTOR_ADMIN_API_KEY')],
    ]);
  }

  const runtimeValues = Object.fromEntries(
    runtimeSecretMappings.map((mapping) => [mapping.secretKey, envOrFile(mapping.envName)]),
  ) as Record<string, NullableString>;

  const localEnvLines: string[] = [
    `ATTESTOR_HA_PROVIDER=${provider}`,
    `ATTESTOR_HA_PRODUCTION_MODE=${productionMode ? 'true' : 'false'}`,
    `ATTESTOR_PUBLIC_HOSTNAME=${hostname}`,
    `ATTESTOR_GATEWAY_CLASS_NAME=${gatewayClassName}`,
    `ATTESTOR_TLS_MODE=${tlsMode}`,
    `ATTESTOR_TLS_SECRET_NAME=${tlsSecretName}`,
    `ATTESTOR_HA_SECRET_STORE=${secretStoreName}`,
    `ATTESTOR_HA_SECRET_PREFIX=${secretPrefix}`,
    `ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND=${externalSecretStoreKind}`,
    `ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL=${externalSecretRefreshInterval}`,
    `ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY=${externalSecretCreationPolicy}`,
  ];
  if (externalSecretDeletionPolicy) localEnvLines.push(`ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY=${externalSecretDeletionPolicy}`);

  if (clusterIssuer) localEnvLines.push(`ATTESTOR_TLS_CLUSTER_ISSUER=${clusterIssuer}`);
  if (dnsNames.length > 0) localEnvLines.push(`ATTESTOR_TLS_DNS_NAMES=${dnsNames.join(',')}`);
  if (awsCertificateArns.length > 0) localEnvLines.push(`ATTESTOR_AWS_ALB_CERTIFICATE_ARNS=${awsCertificateArns.join(',')}`);
  if (awsSslPolicy) localEnvLines.push(`ATTESTOR_AWS_ALB_SSL_POLICY=${awsSslPolicy}`);
  if (awsWafAclArn) localEnvLines.push(`ATTESTOR_AWS_ALB_WAFV2_ACL_ARN=${awsWafAclArn}`);
  if (awsGroupName) localEnvLines.push(`ATTESTOR_AWS_ALB_GROUP_NAME=${awsGroupName}`);
  if (gkeSslPolicy) localEnvLines.push(`ATTESTOR_GKE_SSL_POLICY=${gkeSslPolicy}`);
  if (tlsCertPem) localEnvLines.push(`ATTESTOR_TLS_CERT_PEM=${tlsCertPem}`);
  if (tlsKeyPem) localEnvLines.push(`ATTESTOR_TLS_KEY_PEM=${tlsKeyPem}`);
  for (const mapping of runtimeSecretMappings) {
    const value = runtimeValues[mapping.secretKey];
    if (value) localEnvLines.push(`${mapping.envName}=${value}`);
  }

  const runtimeSecretLines = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: attestor-runtime-secrets',
    '  namespace: attestor',
    'type: Opaque',
    'stringData:',
  ];
  for (const mapping of runtimeSecretMappings) {
    maybeYamlString(runtimeSecretLines, mapping.secretKey, runtimeValues[mapping.secretKey]);
  }

  const runtimeExternalSecretLines = [
    'apiVersion: external-secrets.io/v1beta1',
    'kind: ExternalSecret',
    'metadata:',
    '  name: attestor-runtime-secrets',
    'spec:',
    `  refreshInterval: ${externalSecretRefreshInterval}`,
    '  secretStoreRef:',
    `    kind: ${externalSecretStoreKind}`,
    `    name: ${secretStoreName}`,
    '  target:',
    '    name: attestor-runtime-secrets',
    `    creationPolicy: ${externalSecretCreationPolicy}`,
  ];
  if (externalSecretDeletionPolicy) {
    runtimeExternalSecretLines.push(`    deletionPolicy: ${externalSecretDeletionPolicy}`);
  }
  runtimeExternalSecretLines.push('  data:');
  for (const mapping of runtimeSecretMappings) {
    runtimeExternalSecretLines.push(`    - secretKey: ${mapping.secretKey}`);
    runtimeExternalSecretLines.push('      remoteRef:');
    runtimeExternalSecretLines.push(`        key: ${remoteSecretKey(remoteSecretProvider, `${secretPrefix}/${mapping.remoteSuffix}`)}`);
  }

  const gatewayPatchLines = [
    'apiVersion: gateway.networking.k8s.io/v1',
    'kind: Gateway',
    'metadata:',
    '  name: attestor',
    'spec:',
    `  gatewayClassName: ${gatewayClassName}`,
    '  listeners:',
    '    - name: https',
    '      protocol: HTTPS',
    '      port: 443',
    `      hostname: ${hostname}`,
  ];
  if (tlsMode !== 'aws-acm') {
    gatewayPatchLines.push('      tls:');
    gatewayPatchLines.push('        mode: Terminate');
    gatewayPatchLines.push('        certificateRefs:');
    gatewayPatchLines.push(`          - name: ${tlsSecretName}`);
  }

  const certificateLines = [
    'apiVersion: cert-manager.io/v1',
    'kind: Certificate',
    'metadata:',
    '  name: attestor-api',
    'spec:',
    `  secretName: ${tlsSecretName}`,
    '  dnsNames:',
    ...dnsNames.map((name) => `    - ${name}`),
    '  issuerRef:',
    '    kind: ClusterIssuer',
    `    name: ${clusterIssuer ?? 'replace-me'}`,
  ];

  const tlsSecretLines = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    `  name: ${tlsSecretName}`,
    '  namespace: attestor',
    'type: kubernetes.io/tls',
    'stringData:',
  ];
  maybeYamlString(tlsSecretLines, 'tls.crt', tlsCertPem);
  maybeYamlString(tlsSecretLines, 'tls.key', tlsKeyPem);

  const tlsExternalSecretLines = [
    'apiVersion: external-secrets.io/v1beta1',
    'kind: ExternalSecret',
    'metadata:',
    `  name: ${tlsSecretName}`,
    'spec:',
    `  refreshInterval: ${externalSecretRefreshInterval}`,
    '  secretStoreRef:',
    `    kind: ${externalSecretStoreKind}`,
    `    name: ${secretStoreName}`,
    '  target:',
    `    name: ${tlsSecretName}`,
    `    creationPolicy: ${externalSecretCreationPolicy}`,
    '    template:',
    '      type: kubernetes.io/tls',
  ];
  if (externalSecretDeletionPolicy) {
    tlsExternalSecretLines.push(`    deletionPolicy: ${externalSecretDeletionPolicy}`);
  }
  tlsExternalSecretLines.push('  data:');
  tlsExternalSecretLines.push('    - secretKey: tls.crt');
  tlsExternalSecretLines.push('      remoteRef:');
  tlsExternalSecretLines.push(`        key: ${remoteSecretKey(remoteSecretProvider, `${secretPrefix}/tls-crt`)}`);
  tlsExternalSecretLines.push('    - secretKey: tls.key');
  tlsExternalSecretLines.push('      remoteRef:');
  tlsExternalSecretLines.push(`        key: ${remoteSecretKey(remoteSecretProvider, `${secretPrefix}/tls-key`)}`);

  const awsAlbPatchLines = [
    'apiVersion: networking.k8s.io/v1',
    'kind: Ingress',
    'metadata:',
    '  name: attestor-api',
    '  annotations:',
    '    alb.ingress.kubernetes.io/listen-ports: \'[{"HTTPS":443}]\'',
    `    alb.ingress.kubernetes.io/certificate-arn: ${yamlQuote(awsCertificateArns.join(','))}`,
  ];
  if (awsSslPolicy) awsAlbPatchLines.push(`    alb.ingress.kubernetes.io/ssl-policy: ${yamlQuote(awsSslPolicy)}`);
  if (awsWafAclArn) awsAlbPatchLines.push(`    alb.ingress.kubernetes.io/wafv2-acl-arn: ${yamlQuote(awsWafAclArn)}`);
  if (awsGroupName) awsAlbPatchLines.push(`    alb.ingress.kubernetes.io/group.name: ${yamlQuote(awsGroupName)}`);
  awsAlbPatchLines.push('spec:');
  awsAlbPatchLines.push('  rules:');
  awsAlbPatchLines.push(`    - host: ${hostname}`);
  awsAlbPatchLines.push('      http:');
  awsAlbPatchLines.push('        paths:');
  awsAlbPatchLines.push('          - path: /');
  awsAlbPatchLines.push('            pathType: Prefix');
  awsAlbPatchLines.push('            backend:');
  awsAlbPatchLines.push('              service:');
  awsAlbPatchLines.push('                name: attestor-api');
  awsAlbPatchLines.push('                port:');
  awsAlbPatchLines.push('                  number: 80');

  const gkeGatewayPolicyLines = [
    'apiVersion: networking.gke.io/v1',
    'kind: GCPGatewayPolicy',
    'metadata:',
    '  name: attestor',
    'spec:',
    '  default:',
    `    sslPolicy: ${gkeSslPolicy ?? 'replace-me'}`,
    '  targetRef:',
    '    group: gateway.networking.k8s.io',
    '    kind: Gateway',
    '    name: attestor',
  ];

  const summary = {
    provider,
    productionMode,
    hostname,
    tls: {
      mode: tlsMode,
      secretName: tlsSecretName,
      dnsNames,
      inlineSecretConfigured: Boolean(tlsCertPem && tlsKeyPem),
      certManagerConfigured: Boolean(clusterIssuer),
      awsAcmConfigured: awsCertificateArns.length > 0,
      gkeSslPolicyConfigured: Boolean(gkeSslPolicy),
    },
    runtimeSecrets: {
      configured: runtimeSecretMappings.filter((mapping) => Boolean(runtimeValues[mapping.secretKey])).map((mapping) => mapping.envName),
      externalSecret: {
        storeName: secretStoreName,
        storeKind: externalSecretStoreKind,
        refreshInterval: externalSecretRefreshInterval,
        creationPolicy: externalSecretCreationPolicy,
      deletionPolicy: externalSecretDeletionPolicy,
    },
      remoteSecretProvider,
    },
  };

  writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'local.env'), `${localEnvLines.join('\n')}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'runtime-secrets.secret.yaml'), `${runtimeSecretLines.join('\n')}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'runtime-secrets.external-secret.yaml'), `${runtimeExternalSecretLines.join('\n')}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'gateway.patch.yaml'), `${gatewayPatchLines.join('\n')}\n`, 'utf8');
  if (tlsMode === 'secret') writeFileSync(resolve(outputDir, 'tls.secret.yaml'), `${tlsSecretLines.join('\n')}\n`, 'utf8');
  if (tlsMode === 'external-secret') writeFileSync(resolve(outputDir, 'tls.external-secret.yaml'), `${tlsExternalSecretLines.join('\n')}\n`, 'utf8');
  if (tlsMode === 'cert-manager') writeFileSync(resolve(outputDir, 'cert-manager.certificate.yaml'), `${certificateLines.join('\n')}\n`, 'utf8');
  if (awsCertificateArns.length > 0 || tlsMode === 'aws-acm') {
    writeFileSync(resolve(outputDir, 'aws-alb-ingress.patch.yaml'), `${awsAlbPatchLines.join('\n')}\n`, 'utf8');
  }
  if (provider === 'gke') writeFileSync(resolve(outputDir, 'gke-gateway-policy.patch.yaml'), `${gkeGatewayPolicyLines.join('\n')}\n`, 'utf8');

  const readme = `# HA credential bundle

Generated by \`npm run render:ha-credentials\`.

- \`local.env\` captures the rendered environment view.
- \`runtime-secrets.secret.yaml\` projects inline runtime secrets for quick ops drills.
- \`runtime-secrets.external-secret.yaml\` projects the same runtime contract through External Secrets Operator.
- \`gateway.patch.yaml\` rewires hostname and TLS secret wiring for the base Gateway.
- \`tls.secret.yaml\`, \`tls.external-secret.yaml\`, or \`cert-manager.certificate.yaml\` depends on \`ATTESTOR_TLS_MODE\`.
- \`aws-alb-ingress.patch.yaml\` appears for AWS/ACM bundles.
- \`gke-gateway-policy.patch.yaml\` appears for GKE bundles.

This output intentionally contains secrets; do not commit it.
`;
  writeFileSync(resolve(outputDir, 'README.md'), readme, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
