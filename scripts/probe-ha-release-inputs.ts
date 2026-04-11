import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

type Provider = 'generic' | 'aws' | 'gke';

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

function envOrFile(name: string): string | null {
  const direct = env(name);
  if (direct) return direct;
  const filePath = env(`${name}_FILE`);
  if (!filePath) return null;
  const raw = readFileSync(resolve(filePath), 'utf8').trim();
  return raw || null;
}

function required(name: string, value: string | null, issues: string[]): void {
  if (!value) issues.push(`${name} is required.`);
}

function pushInvalid(message: string, issues: string[]): void {
  issues.push(message);
}

export interface HaReleaseProbeSummary {
  provider: Provider;
  tlsMode: string;
  benchmark: {
    path: string;
    requestsPerSecond: number;
    p95LatencyMs: number;
    successRate: number | null;
  };
  rolloutReadiness: {
    envComplete: boolean;
    bundleRenderSucceeded: boolean;
    issues: string[];
  };
}

export async function probeHaReleaseInputs(options?: {
  provider?: Provider;
  benchmarkPath?: string;
}): Promise<HaReleaseProbeSummary> {
  const provider = (options?.provider ?? arg('provider', env('ATTESTOR_HA_PROVIDER') ?? 'gke')) as Provider;
  const benchmarkPath = options?.benchmarkPath ?? arg('benchmark', env('ATTESTOR_HA_BENCHMARK_PATH')) ?? '';
  if (!['generic', 'aws', 'gke'].includes(provider)) throw new Error('provider must be one of generic, aws, gke');
  if (!benchmarkPath) throw new Error('--benchmark or ATTESTOR_HA_BENCHMARK_PATH is required.');

  const benchmark = JSON.parse(readFileSync(resolve(benchmarkPath), 'utf8')) as {
    requestsPerSecond: number;
    p95LatencyMs: number;
    successRate?: number;
  };

  const tlsMode = env('ATTESTOR_TLS_MODE') ?? 'secret';
  const issues: string[] = [];

  required('ATTESTOR_API_IMAGE', env('ATTESTOR_API_IMAGE'), issues);
  required('ATTESTOR_WORKER_IMAGE', env('ATTESTOR_WORKER_IMAGE'), issues);
  required('ATTESTOR_PUBLIC_HOSTNAME', env('ATTESTOR_PUBLIC_HOSTNAME'), issues);
  required('REDIS_URL', env('REDIS_URL'), issues);
  required('ATTESTOR_CONTROL_PLANE_PG_URL', env('ATTESTOR_CONTROL_PLANE_PG_URL'), issues);
  required('ATTESTOR_BILLING_LEDGER_PG_URL', env('ATTESTOR_BILLING_LEDGER_PG_URL'), issues);
  required('ATTESTOR_ADMIN_API_KEY', env('ATTESTOR_ADMIN_API_KEY'), issues);

  if (provider === 'aws' && tlsMode === 'aws-acm') {
    required('ATTESTOR_AWS_ALB_CERTIFICATE_ARNS', env('ATTESTOR_AWS_ALB_CERTIFICATE_ARNS'), issues);
  }
  if (provider === 'gke' && tlsMode === 'cert-manager') {
    required('ATTESTOR_TLS_CLUSTER_ISSUER', env('ATTESTOR_TLS_CLUSTER_ISSUER'), issues);
  }
  if (tlsMode === 'secret') {
    required('ATTESTOR_TLS_CERT_PEM or ATTESTOR_TLS_CERT_PEM_FILE', envOrFile('ATTESTOR_TLS_CERT_PEM'), issues);
    required('ATTESTOR_TLS_KEY_PEM or ATTESTOR_TLS_KEY_PEM_FILE', envOrFile('ATTESTOR_TLS_KEY_PEM'), issues);
  }
  const runtimeSecretMode = env('ATTESTOR_HA_RUNTIME_SECRET_MODE') ?? '';
  const externalSecretStoreKind = env('ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND');
  const externalSecretRefreshInterval = env('ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL');
  const externalSecretCreationPolicy = env('ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY');
  const externalSecretDeletionPolicy = env('ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY');
  const usingExternalSecrets = runtimeSecretMode === 'external-secret' || tlsMode === 'external-secret';
  if (usingExternalSecrets && !env('ATTESTOR_HA_SECRET_STORE')) {
    required('ATTESTOR_HA_SECRET_STORE', env('ATTESTOR_HA_SECRET_STORE'), issues);
  }
  if (externalSecretStoreKind && externalSecretStoreKind !== 'ClusterSecretStore' && externalSecretStoreKind !== 'SecretStore') {
    pushInvalid('ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND must be ClusterSecretStore or SecretStore.', issues);
  }
  if (externalSecretRefreshInterval && !/^[1-9]\d*[smhd]$/.test(externalSecretRefreshInterval)) {
    pushInvalid('ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL must look like 30m, 1h, or 7d.', issues);
  }
  if (externalSecretCreationPolicy && !['Owner', 'Orphan', 'Merge', 'None'].includes(externalSecretCreationPolicy)) {
    pushInvalid('ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY must be one of Owner, Orphan, Merge, or None.', issues);
  }
  if (externalSecretDeletionPolicy && !['Retain', 'Merge', 'Delete'].includes(externalSecretDeletionPolicy)) {
    pushInvalid('ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY must be one of Retain, Merge, or Delete.', issues);
  }

  let bundleRenderSucceeded = false;
  if (issues.length === 0) {
    const outDir = mkdtempSync(resolve(tmpdir(), 'attestor-ha-preflight-'));
    try {
      const run = spawnSync(
        process.execPath,
        [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/render-ha-release-bundle.ts', `--provider=${provider}`, `--benchmark=${resolve(benchmarkPath)}`, `--output-dir=${outDir}`],
        { cwd: resolve('.'), encoding: 'utf8', env: process.env },
      );
      bundleRenderSucceeded = run.status === 0;
      if (!bundleRenderSucceeded) {
        issues.push(`render-ha-release-bundle failed: ${(run.stderr || run.stdout).trim()}`);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  return {
    provider,
    tlsMode,
    benchmark: {
      path: resolve(benchmarkPath),
      requestsPerSecond: benchmark.requestsPerSecond,
      p95LatencyMs: benchmark.p95LatencyMs,
      successRate: benchmark.successRate ?? null,
    },
    rolloutReadiness: {
      envComplete: issues.length === 0,
      bundleRenderSucceeded,
      issues,
    },
  };
}

async function main(): Promise<void> {
  const summary = await probeHaReleaseInputs();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
