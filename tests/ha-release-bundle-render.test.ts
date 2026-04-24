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
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-ha-release-'));
  const benchmarkPath = resolve(tempDir, 'benchmark.json');
  const awsOut = resolve(tempDir, 'aws-bundle');
  const gkeOut = resolve(tempDir, 'gke-bundle');
  const certPath = resolve(tempDir, 'tls.crt');
  const keyPath = resolve(tempDir, 'tls.key');

  writeFileSync(
    benchmarkPath,
    `${JSON.stringify({
      url: 'http://127.0.0.1:3700/api/v1/health',
      concurrency: 16,
      durationSeconds: 20,
      replicas: 3,
      totalRequests: 300,
      successCount: 297,
      errorCount: 3,
      successRate: 0.99,
      errorRate: 0.01,
      requestsPerSecond: 14.85,
      p50LatencyMs: 80,
      p95LatencyMs: 620,
      suggestedApiPrometheusThreshold: 18,
      suggestedWorkerRedisListThreshold: 74
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n', 'utf8');
  writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n', 'utf8');

  try {
    const aws = spawnSync(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        'scripts/render-ha-release-bundle.ts',
        '--provider=aws',
        `--benchmark=${benchmarkPath}`,
        `--output-dir=${awsOut}`,
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          ATTESTOR_API_IMAGE: 'ghcr.io/example/attestor-api:1.2.3',
          ATTESTOR_WORKER_IMAGE: 'ghcr.io/example/attestor-worker:1.2.3',
          ATTESTOR_PUBLIC_HOSTNAME: 'api.attestor.example.invalid',
          ATTESTOR_HA_PRODUCTION_MODE: 'true',
          ATTESTOR_TLS_MODE: 'aws-acm',
          ATTESTOR_AWS_ALB_CERTIFICATE_ARNS: 'arn:aws:acm:eu-west-1:123:certificate/aaa',
          ATTESTOR_AWS_ALB_SSL_POLICY: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
          REDIS_URL: 'redis://cache.example.invalid:6379/0',
          ATTESTOR_CONTROL_PLANE_PG_URL: 'postgres://user:pass@db/control',
          ATTESTOR_BILLING_LEDGER_PG_URL: 'postgres://user:pass@db/billing',
          ATTESTOR_RELEASE_AUTHORITY_PG_URL: 'postgres://user:pass@db/release_authority',
          ATTESTOR_ADMIN_API_KEY: 'admin-key',
        },
      },
    );
    ok(aws.status === 0, `HA release bundle: AWS render exits successfully\nstdout:\n${aws.stdout}\nstderr:\n${aws.stderr}`);
    const awsKustomization = readFileSync(resolve(awsOut, 'kustomization.yaml'), 'utf8');
    const awsIngress = readFileSync(resolve(awsOut, 'ingress.yaml'), 'utf8');
    const awsConfigMap = readFileSync(resolve(awsOut, 'configmap.yaml'), 'utf8');
    const awsApiDeployment = readFileSync(resolve(awsOut, 'api-deployment.yaml'), 'utf8');
    const awsApiScaled = readFileSync(resolve(awsOut, 'api-scaledobject.yaml'), 'utf8');
    const awsSummary = JSON.parse(readFileSync(resolve(awsOut, 'summary.json'), 'utf8')) as any;
    ok(awsKustomization.includes('ingress.yaml') && !awsKustomization.includes('gateway.yaml'), 'HA release bundle: AWS bundle uses ingress instead of gateway resources');
    ok(awsIngress.includes('certificate-arn') && awsIngress.includes('ELBSecurityPolicy-TLS13-1-2-2021-06'), 'HA release bundle: AWS ingress carries ACM TLS wiring');
    ok(awsConfigMap.includes('ATTESTOR_RUNTIME_PROFILE') && awsConfigMap.includes('production-shared'), 'HA release bundle: AWS config keeps production-shared runtime profile');
    ok(awsApiDeployment.includes('ATTESTOR_RELEASE_AUTHORITY_PG_URL'), 'HA release bundle: AWS API deployment wires release-authority PostgreSQL');
    ok(awsApiScaled.includes('threshold: "18"') && awsApiScaled.includes('activationThreshold: "3"'), 'HA release bundle: AWS KEDA scaler is benchmark-tuned');
    ok(awsSummary.provider === 'aws' && awsSummary.apiImage.includes(':1.2.3'), 'HA release bundle: AWS summary captures provider and image refs');

    const gke = spawnSync(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        'scripts/render-ha-release-bundle.ts',
        '--provider=gke',
        `--benchmark=${benchmarkPath}`,
        `--output-dir=${gkeOut}`,
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          ATTESTOR_API_IMAGE: 'ghcr.io/example/attestor-api:4.5.6',
          ATTESTOR_WORKER_IMAGE: 'ghcr.io/example/attestor-worker:4.5.6',
          ATTESTOR_PUBLIC_HOSTNAME: 'gke.attestor.example.invalid',
          ATTESTOR_HA_PRODUCTION_MODE: 'true',
          ATTESTOR_TLS_MODE: 'cert-manager',
          ATTESTOR_TLS_CLUSTER_ISSUER: 'letsencrypt-prod',
          ATTESTOR_GKE_SSL_POLICY: 'attestor-modern-tls',
          REDIS_URL: 'redis://cache.example.invalid:6379/0',
          ATTESTOR_CONTROL_PLANE_PG_URL: 'postgres://user:pass@db/control',
          ATTESTOR_BILLING_LEDGER_PG_URL: 'postgres://user:pass@db/billing',
          ATTESTOR_RELEASE_AUTHORITY_PG_URL: 'postgres://user:pass@db/release_authority',
          ATTESTOR_ADMIN_API_KEY: 'admin-key',
          ATTESTOR_TLS_CERT_PEM_FILE: certPath,
          ATTESTOR_TLS_KEY_PEM_FILE: keyPath,
        },
      },
    );
    ok(gke.status === 0, `HA release bundle: GKE render exits successfully\nstdout:\n${gke.stdout}\nstderr:\n${gke.stderr}`);
    const gkeKustomization = readFileSync(resolve(gkeOut, 'kustomization.yaml'), 'utf8');
    const gkeGateway = readFileSync(resolve(gkeOut, 'gateway.yaml'), 'utf8');
    const gkeRoute = readFileSync(resolve(gkeOut, 'httproute.yaml'), 'utf8');
    const gkePolicy = readFileSync(resolve(gkeOut, 'gcpgatewaypolicy.yaml'), 'utf8');
    const gkeCertificate = readFileSync(resolve(gkeOut, 'certificate.yaml'), 'utf8');
    ok(gkeKustomization.includes('gateway.yaml') && gkeKustomization.includes('certificate.yaml'), 'HA release bundle: GKE bundle includes gateway and cert-manager certificate');
    ok(gkeGateway.includes('gke.attestor.example.invalid') && gkeRoute.includes('gke.attestor.example.invalid'), 'HA release bundle: GKE bundle rewires hostname across gateway and route');
    ok(gkePolicy.includes('sslPolicy: attestor-modern-tls'), 'HA release bundle: GKE gateway policy carries SSL policy wiring');
    ok(gkeCertificate.includes('letsencrypt-prod') && gkeCertificate.includes('gke.attestor.example.invalid'), 'HA release bundle: GKE certificate carries issuer and hostname');

    console.log(`\nHA release bundle render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error('\nHA release bundle render tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
