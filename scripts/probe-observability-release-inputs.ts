import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { probeObservabilityReceivers } from './probe-observability-receivers.ts';
import { probeAlertRouting } from './probe-alert-routing.ts';

type Provider = 'generic' | 'grafana-cloud';
type SecretMode = 'secret' | 'external-secret';

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

export interface ObservabilityReleaseProbeSummary {
  provider: Provider;
  secretMode: SecretMode;
  benchmark: {
    path: string;
    requestsPerSecond: number;
    p95LatencyMs: number;
    successRate: number | null;
  };
  releaseReadiness: {
    envComplete: boolean;
    bundleRenderSucceeded: boolean;
    receiverProbeSucceeded: boolean;
    alertRoutingSucceeded: boolean;
    issues: string[];
  };
  receiverProbe: {
    telemetryFlushSucceeded: boolean;
    prometheusOk: boolean | null;
    alertmanagerOk: boolean | null;
  } | null;
  alertRouting: {
    routingValid: boolean;
    deliveryCoverageValid: boolean;
  } | null;
}

export async function probeObservabilityReleaseInputs(options?: {
  provider?: Provider;
  benchmarkPath?: string;
  prometheusUrl?: string | null;
  alertmanagerUrl?: string | null;
}): Promise<ObservabilityReleaseProbeSummary> {
  const provider = (options?.provider ?? arg('provider', env('ATTESTOR_OBSERVABILITY_PROVIDER') ?? 'grafana-cloud')) as Provider;
  const benchmarkPath = options?.benchmarkPath ?? arg('benchmark', env('ATTESTOR_OBSERVABILITY_BENCHMARK_PATH')) ?? '';
  const prometheusUrl = options?.prometheusUrl ?? arg('prometheus-url', env('ATTESTOR_OBSERVABILITY_PROMETHEUS_URL') ?? env('PROMETHEUS_BASE_URL')) ?? null;
  const alertmanagerUrl = options?.alertmanagerUrl ?? arg('alertmanager-url', env('ATTESTOR_OBSERVABILITY_ALERTMANAGER_URL') ?? env('ALERTMANAGER_BASE_URL')) ?? null;
  const secretMode = (arg(
    'secret-mode',
    env('ATTESTOR_OBSERVABILITY_SECRET_MODE') ?? (provider === 'grafana-cloud' ? 'external-secret' : 'secret'),
  ) as SecretMode);

  if (!['generic', 'grafana-cloud'].includes(provider)) {
    throw new Error('provider must be one of generic, grafana-cloud');
  }
  if (!['secret', 'external-secret'].includes(secretMode)) {
    throw new Error('secret-mode must be one of secret, external-secret');
  }
  if (!benchmarkPath) {
    throw new Error('--benchmark or ATTESTOR_OBSERVABILITY_BENCHMARK_PATH is required.');
  }

  const benchmark = JSON.parse(readFileSync(resolve(benchmarkPath), 'utf8')) as {
    requestsPerSecond: number;
    p95LatencyMs: number;
    successRate?: number;
  };

  const issues: string[] = [];
  const grafanaEndpoint = envOrFile('GRAFANA_CLOUD_OTLP_ENDPOINT');
  const grafanaUsername = envOrFile('GRAFANA_CLOUD_OTLP_USERNAME');
  const grafanaToken = envOrFile('GRAFANA_CLOUD_OTLP_TOKEN');

  if (provider === 'grafana-cloud') {
    required('GRAFANA_CLOUD_OTLP_ENDPOINT or GRAFANA_CLOUD_OTLP_ENDPOINT_FILE', grafanaEndpoint, issues);
    required('GRAFANA_CLOUD_OTLP_USERNAME or GRAFANA_CLOUD_OTLP_USERNAME_FILE', grafanaUsername, issues);
    required('GRAFANA_CLOUD_OTLP_TOKEN or GRAFANA_CLOUD_OTLP_TOKEN_FILE', grafanaToken, issues);
  }

  if (secretMode === 'external-secret') {
    required('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE', env('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE'), issues);
  }

  let bundleRenderSucceeded = false;
  let receiverProbeSucceeded = false;
  let alertRoutingSucceeded = false;
  let receiverProbe: ObservabilityReleaseProbeSummary['receiverProbe'] = null;
  let alertRouting: ObservabilityReleaseProbeSummary['alertRouting'] = null;

  if (issues.length === 0) {
    const outDir = mkdtempSync(resolve(tmpdir(), 'attestor-observability-preflight-'));
    try {
      const releaseRender = spawnSync(
        process.execPath,
        [
          resolve('node_modules/tsx/dist/cli.mjs'),
          'scripts/render-observability-release-bundle.ts',
          `--provider=${provider}`,
          `--secret-mode=${secretMode}`,
          `--benchmark=${resolve(benchmarkPath)}`,
          `--output-dir=${outDir}`,
        ],
        { cwd: resolve('.'), encoding: 'utf8', env: process.env },
      );
      bundleRenderSucceeded = releaseRender.status === 0;
      if (!bundleRenderSucceeded) {
        issues.push(`render-observability-release-bundle failed: ${(releaseRender.stderr || releaseRender.stdout).trim()}`);
      } else {
        const probeSummary = await probeObservabilityReceivers({
          prometheusUrl,
          alertmanagerUrl,
          outputDir: resolve(outDir, 'receiver-probe'),
        });
        receiverProbe = {
          telemetryFlushSucceeded: probeSummary.telemetry.flushSucceeded,
          prometheusOk: probeSummary.prometheus.configured ? probeSummary.prometheus.ok : null,
          alertmanagerOk: probeSummary.alertmanager.configured ? probeSummary.alertmanager.ok : null,
        };
        receiverProbeSucceeded =
          probeSummary.telemetry.flushSucceeded
          && (!probeSummary.prometheus.configured || probeSummary.prometheus.ok)
          && (!probeSummary.alertmanager.configured || probeSummary.alertmanager.ok);
        if (!receiverProbeSucceeded) {
          issues.push('probe-observability-receivers did not fully pass for the current OTLP/Prometheus/Alertmanager configuration.');
        }
        const alertRoutingSummary = await probeAlertRouting({
          outputDir: resolve(outDir, 'alert-routing'),
        });
        alertRouting = {
          routingValid: alertRoutingSummary.releaseReadiness.routingValid,
          deliveryCoverageValid: alertRoutingSummary.releaseReadiness.deliveryCoverageValid,
        };
        alertRoutingSucceeded = alertRoutingSummary.releaseReadiness.routingValid && alertRoutingSummary.releaseReadiness.deliveryCoverageValid;
        if (!alertRoutingSucceeded) {
          issues.push(
            `probe-alert-routing reported issues: ${alertRoutingSummary.releaseReadiness.issues.join(' | ')}`,
          );
        }
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  return {
    provider,
    secretMode,
    benchmark: {
      path: resolve(benchmarkPath),
      requestsPerSecond: benchmark.requestsPerSecond,
      p95LatencyMs: benchmark.p95LatencyMs,
      successRate: benchmark.successRate ?? null,
    },
    releaseReadiness: {
      envComplete: issues.length === 0,
      bundleRenderSucceeded,
      receiverProbeSucceeded,
      alertRoutingSucceeded,
      issues,
    },
    receiverProbe,
    alertRouting,
  };
}

async function main(): Promise<void> {
  const summary = await probeObservabilityReleaseInputs();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
