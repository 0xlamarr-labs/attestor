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

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

function main(): void {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-gke-cutover-'));
  const outputDir = resolve(tempDir, 'bundle');

  try {
    const run = spawnSync(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        'scripts/render-gke-domain-cutover.ts',
        '--hostname=attestor.example.invalid',
        '--static-address-name=attestor-prod-ip',
        '--dns-target-ip=34.49.37.115',
        '--cluster-issuer=letsencrypt-prod',
        '--tls-secret-name=attestor-tls',
        '--acme-email=ops@attestor.example.invalid',
        `--output-dir=${outputDir}`,
      ],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: process.env,
      },
    );

    ok(run.status === 0, `GKE domain cutover render exits successfully\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);

    const gateway = read(resolve(outputDir, 'gateway.yaml'));
    const route = read(resolve(outputDir, 'httproute.yaml'));
    const certificate = read(resolve(outputDir, 'certificate.yaml'));
    const issuer = read(resolve(outputDir, 'clusterissuer.yaml'));
    const readme = read(resolve(outputDir, 'README.md'));
    const summary = JSON.parse(read(resolve(outputDir, 'summary.json'))) as any;

    ok(gateway.includes('gke-l7-global-external-managed') && gateway.includes('attestor-prod-ip') && gateway.includes('attestor.example.invalid'), 'GKE domain cutover render: Gateway carries GKE class, named address, and final hostname');
    ok(gateway.includes('protocol: HTTPS') && gateway.includes('attestor-tls'), 'GKE domain cutover render: Gateway terminates HTTPS with the rendered TLS secret');
    ok(route.includes('statusCode: 301') && route.includes('sectionName: http') && route.includes('sectionName: https'), 'GKE domain cutover render: HTTPRoute redirects HTTP and serves HTTPS');
    ok(route.includes('attestor.example.invalid') && route.includes('attestor-api'), 'GKE domain cutover render: HTTPRoute targets the final hostname and API service');
    ok(certificate.includes('attestor.example.invalid') && certificate.includes('letsencrypt-prod') && certificate.includes('attestor-tls'), 'GKE domain cutover render: Certificate carries hostname, issuer, and secret name');
    ok(issuer.includes('ops@attestor.example.invalid') && issuer.includes('gatewayHTTPRoute') && issuer.includes('name: attestor') && issuer.includes('namespace: attestor'), 'GKE domain cutover render: ClusterIssuer carries ACME email and Gateway HTTP-01 solver');
    ok(summary.dnsRecord.target === '34.49.37.115' && summary.bootstrapHostname === '34.49.37.115.sslip.io', 'GKE domain cutover render: summary preserves DNS target and bootstrap sslip.io hostname');
    ok(readme.includes('kubectl apply -k') && readme.includes('attestor.example.invalid') && readme.includes('/api/v1/health') && readme.includes('/api/v1/ready'), 'GKE domain cutover render: handoff README documents apply flow, hostname, and verification URLs');

    console.log(`\nGKE domain cutover render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error('\nGKE domain cutover render tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
