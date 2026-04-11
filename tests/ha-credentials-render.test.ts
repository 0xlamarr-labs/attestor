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
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-ha-creds-'));
  const inlineOutputDir = resolve(tempDir, 'inline');
  const awsOutputDir = resolve(tempDir, 'aws');
  const secretOutputDir = resolve(tempDir, 'secret');
  const tlsCertPath = resolve(tempDir, 'tls.crt');
  const tlsKeyPath = resolve(tempDir, 'tls.key');
  const pgPath = resolve(tempDir, 'control-plane.pg');

  writeFileSync(tlsCertPath, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n', 'utf8');
  writeFileSync(tlsKeyPath, '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n', 'utf8');
  writeFileSync(pgPath, 'postgres://attestor:test@db.example.invalid:5432/control\n', 'utf8');

  try {
    const inline = spawnSync(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/render-ha-credentials.ts', `--output-dir=${inlineOutputDir}`],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          ATTESTOR_HA_PROVIDER: 'gke',
          ATTESTOR_HA_PRODUCTION_MODE: 'true',
          ATTESTOR_PUBLIC_HOSTNAME: 'attestor.example.invalid',
          ATTESTOR_TLS_MODE: 'secret',
          ATTESTOR_TLS_CERT_PEM_FILE: tlsCertPath,
          ATTESTOR_TLS_KEY_PEM_FILE: tlsKeyPath,
          ATTESTOR_GKE_SSL_POLICY: 'attestor-modern-tls',
          REDIS_URL: 'redis://cache.example.invalid:6379/0',
          ATTESTOR_CONTROL_PLANE_PG_URL_FILE: pgPath,
          ATTESTOR_BILLING_LEDGER_PG_URL: 'postgres://attestor:test@db.example.invalid:5432/billing',
          ATTESTOR_ADMIN_API_KEY: 'admin-inline',
          ATTESTOR_HA_SECRET_STORE: 'platform-secrets',
          ATTESTOR_HA_SECRET_PREFIX: 'prod/attestor',
        },
      },
    );
    ok(inline.status === 0, 'HA credentials render: inline GKE render exits successfully');
    const inlineSummary = JSON.parse(readFileSync(resolve(inlineOutputDir, 'summary.json'), 'utf8')) as any;
    const inlineTlsSecret = readFileSync(resolve(inlineOutputDir, 'tls.secret.yaml'), 'utf8');
    const inlineGatewayPatch = readFileSync(resolve(inlineOutputDir, 'gateway.patch.yaml'), 'utf8');
    const inlineExternalSecret = readFileSync(resolve(inlineOutputDir, 'runtime-secrets.external-secret.yaml'), 'utf8');
    const inlineGkePatch = readFileSync(resolve(inlineOutputDir, 'gke-gateway-policy.patch.yaml'), 'utf8');
    ok(inlineSummary.provider === 'gke', 'HA credentials render: summary records GKE provider');
    ok(inlineSummary.tls.inlineSecretConfigured === true, 'HA credentials render: summary reports inline TLS secret wiring');
    ok(inlineTlsSecret.includes('-----BEGIN CERTIFICATE-----') && inlineTlsSecret.includes('tls.key:'), 'HA credentials render: inline TLS manifest contains cert and key');
    ok(inlineGatewayPatch.includes('hostname: attestor.example.invalid') && inlineGatewayPatch.includes('certificateRefs:'), 'HA credentials render: Gateway patch rewires hostname and TLS secret');
    ok(inlineExternalSecret.includes('prod/attestor/control-plane-pg-url') && inlineExternalSecret.includes('platform-secrets'), 'HA credentials render: runtime ExternalSecret uses configured store and prefix');
    ok(inlineGkePatch.includes('sslPolicy: attestor-modern-tls'), 'HA credentials render: GKE patch carries configured SSL policy');

    const aws = spawnSync(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/render-ha-credentials.ts', `--output-dir=${awsOutputDir}`],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          ATTESTOR_HA_PROVIDER: 'aws',
          ATTESTOR_HA_PRODUCTION_MODE: 'true',
          ATTESTOR_PUBLIC_HOSTNAME: 'api.attestor.example.invalid',
          ATTESTOR_TLS_MODE: 'aws-acm',
          ATTESTOR_AWS_ALB_CERTIFICATE_ARNS: 'arn:aws:acm:eu-west-1:123456789012:certificate/aaa,arn:aws:acm:eu-west-1:123456789012:certificate/bbb',
          ATTESTOR_AWS_ALB_SSL_POLICY: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
          ATTESTOR_AWS_ALB_WAFV2_ACL_ARN: 'arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/attestor/1234',
          ATTESTOR_AWS_ALB_GROUP_NAME: 'attestor-edge',
          REDIS_URL: 'redis://cache.example.invalid:6379/0',
          ATTESTOR_CONTROL_PLANE_PG_URL: 'postgres://attestor:test@db.example.invalid:5432/control',
          ATTESTOR_BILLING_LEDGER_PG_URL: 'postgres://attestor:test@db.example.invalid:5432/billing',
          ATTESTOR_ADMIN_API_KEY: 'admin-aws',
        },
      },
    );
    ok(aws.status === 0, 'HA credentials render: AWS ACM render exits successfully');
    const awsSummary = JSON.parse(readFileSync(resolve(awsOutputDir, 'summary.json'), 'utf8')) as any;
    const awsPatch = readFileSync(resolve(awsOutputDir, 'aws-alb-ingress.patch.yaml'), 'utf8');
    ok(awsSummary.tls.awsAcmConfigured === true, 'HA credentials render: summary reports ACM wiring');
    ok(awsPatch.includes('alb.ingress.kubernetes.io/certificate-arn') && awsPatch.includes('ELBSecurityPolicy-TLS13-1-2-2021-06'), 'HA credentials render: AWS ALB patch carries certificate and SSL policy');
    ok(awsPatch.includes('group.name') && awsPatch.includes('wafv2-acl-arn'), 'HA credentials render: AWS ALB patch carries group and WAF wiring');

    const externalSecret = spawnSync(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/render-ha-credentials.ts', `--output-dir=${secretOutputDir}`],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          ATTESTOR_PUBLIC_HOSTNAME: 'edge.attestor.example.invalid',
          ATTESTOR_TLS_MODE: 'external-secret',
          ATTESTOR_HA_SECRET_STORE: 'regional-secrets',
          ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND: 'SecretStore',
          ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL: '30m',
          ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY: 'Merge',
          ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY: 'Retain',
        },
      },
    );
    ok(externalSecret.status === 0, 'HA credentials render: external-secret TLS render exits successfully');
    const externalSecretSummary = JSON.parse(readFileSync(resolve(secretOutputDir, 'summary.json'), 'utf8')) as any;
    const runtimeExternalSecret = readFileSync(resolve(secretOutputDir, 'runtime-secrets.external-secret.yaml'), 'utf8');
    const tlsExternalSecret = readFileSync(resolve(secretOutputDir, 'tls.external-secret.yaml'), 'utf8');
    const readme = readFileSync(resolve(secretOutputDir, 'README.md'), 'utf8');
    ok(externalSecretSummary.runtimeSecrets.externalSecret.storeKind === 'SecretStore', 'HA credentials render: summary records custom External Secrets store kind');
    ok(externalSecretSummary.runtimeSecrets.externalSecret.refreshInterval === '30m', 'HA credentials render: summary records custom External Secrets refresh interval');
    ok(runtimeExternalSecret.includes('refreshInterval: 30m') && runtimeExternalSecret.includes('kind: SecretStore') && runtimeExternalSecret.includes('creationPolicy: Merge') && runtimeExternalSecret.includes('deletionPolicy: Retain'), 'HA credentials render: runtime ExternalSecret carries lifecycle policy overrides');
    ok(tlsExternalSecret.includes('kubernetes.io/tls') && tlsExternalSecret.includes('attestor/tls-crt'), 'HA credentials render: TLS ExternalSecret projects kubernetes.io/tls material');
    ok(tlsExternalSecret.includes('refreshInterval: 30m') && tlsExternalSecret.includes('creationPolicy: Merge') && tlsExternalSecret.includes('deletionPolicy: Retain'), 'HA credentials render: TLS ExternalSecret carries lifecycle policy overrides');
    ok(readme.includes('do not commit'), 'HA credentials render: README warns about secret material');

    console.log(`\nHA credentials render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error('\nHA credentials render tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
