import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { probeObservabilityReleaseInputs } from './probe-observability-release-inputs.ts';
import { resolveRepoPipelineReadiness } from './repo-pipeline-readiness.ts';

type Provider = 'generic' | 'grafana-cloud' | 'grafana-alloy';
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

function runTsx(script: string, args: string[], envVars: NodeJS.ProcessEnv): void {
  const run = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), script, ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: envVars,
  });
  if (run.status !== 0) {
    throw new Error(`${script} failed.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  }
}

function detectMissingInputs(provider: Provider, secretMode: SecretMode): string[] {
  const missing: string[] = [];
  const requireOne = (name: string): void => {
    if (!env(name) && !env(`${name}_FILE`)) missing.push(name);
  };

  if (provider === 'grafana-cloud' || provider === 'grafana-alloy') {
    requireOne('GRAFANA_CLOUD_OTLP_ENDPOINT');
    requireOne('GRAFANA_CLOUD_OTLP_USERNAME');
    requireOne('GRAFANA_CLOUD_OTLP_TOKEN');
  }

  if (env('ALERTMANAGER_PRODUCTION_MODE') === 'true') {
    const defaultConfigured = Boolean(
      env('ALERTMANAGER_DEFAULT_WEBHOOK_URL')
      || env('ALERTMANAGER_DEFAULT_WEBHOOK_URL_FILE')
      || ((env('ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL') || env('ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL_FILE'))
        && (env('ALERTMANAGER_DEFAULT_SLACK_CHANNEL') || env('ALERTMANAGER_DEFAULT_SLACK_CHANNEL_FILE')))
      || env('ALERTMANAGER_EMAIL_TO')
      || env('ALERTMANAGER_EMAIL_TO_FILE'),
    );
    const criticalConfigured = Boolean(
      env('ALERTMANAGER_CRITICAL_WEBHOOK_URL')
      || env('ALERTMANAGER_CRITICAL_WEBHOOK_URL_FILE')
      || env('ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY')
      || env('ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY_FILE')
      || env('ALERTMANAGER_EMAIL_TO')
      || env('ALERTMANAGER_EMAIL_TO_FILE'),
    );
    const warningConfigured = Boolean(
      env('ALERTMANAGER_WARNING_WEBHOOK_URL')
      || env('ALERTMANAGER_WARNING_WEBHOOK_URL_FILE')
      || ((env('ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL') || env('ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL_FILE'))
        && (env('ALERTMANAGER_WARNING_SLACK_CHANNEL') || env('ALERTMANAGER_WARNING_SLACK_CHANNEL_FILE')))
      || env('ALERTMANAGER_EMAIL_TO')
      || env('ALERTMANAGER_EMAIL_TO_FILE'),
    );
    if (!defaultConfigured) missing.push('ALERTMANAGER_DEFAULT_* delivery target');
    if (!criticalConfigured) missing.push('ALERTMANAGER_CRITICAL_* delivery target');
    if (!warningConfigured) missing.push('ALERTMANAGER_WARNING_* delivery target');
  }

  if (secretMode === 'external-secret' && !env('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE')) {
    missing.push('ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE');
  }

  return missing;
}

function formatChecklist(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

export interface ObservabilityPromotionPacket {
  provider: Provider;
  secretMode: SecretMode;
  benchmarkPath: string;
  benchmark: {
    requestsPerSecond: number;
    p95LatencyMs: number;
    successRate: number | null;
  };
  readiness: {
    repoPipelineReady: boolean;
    environmentInputsComplete: boolean;
    promotionGatePassed: boolean;
    state: 'ready-for-environment-promotion' | 'blocked-on-environment-inputs';
    issues: string[];
    missingInputs: string[];
  };
  artifacts: {
    releaseBundleDir: string;
    profileSummaryPath: string | null;
    releaseSummaryPath: string | null;
    promotionReadmePath: string;
  };
  probe: Awaited<ReturnType<typeof probeObservabilityReleaseInputs>>;
}

export async function renderObservabilityPromotionPacket(options?: {
  provider?: Provider;
  secretMode?: SecretMode;
  benchmarkPath?: string;
  prometheusUrl?: string | null;
  alertmanagerUrl?: string | null;
  outputDir?: string;
}): Promise<ObservabilityPromotionPacket> {
  const provider = (options?.provider ?? arg('provider', env('ATTESTOR_OBSERVABILITY_PROVIDER') ?? 'grafana-alloy')) as Provider;
  const secretMode = (options?.secretMode ?? arg(
    'secret-mode',
    env('ATTESTOR_OBSERVABILITY_SECRET_MODE') ?? ((provider === 'grafana-cloud' || provider === 'grafana-alloy') ? 'external-secret' : 'secret'),
  )) as SecretMode;
  const benchmarkPath = resolve(options?.benchmarkPath ?? arg('benchmark', env('ATTESTOR_OBSERVABILITY_BENCHMARK_PATH')) ?? '');
  if (!benchmarkPath) throw new Error('--benchmark or ATTESTOR_OBSERVABILITY_BENCHMARK_PATH is required.');
  const outputDir = resolve(options?.outputDir ?? arg('output-dir', '.attestor/observability/promotion/latest')!);
  const prometheusUrl = options?.prometheusUrl ?? arg('prometheus-url', env('ATTESTOR_OBSERVABILITY_PROMETHEUS_URL') ?? env('PROMETHEUS_BASE_URL')) ?? null;
  const alertmanagerUrl = options?.alertmanagerUrl ?? arg('alertmanager-url', env('ATTESTOR_OBSERVABILITY_ALERTMANAGER_URL') ?? env('ALERTMANAGER_BASE_URL')) ?? null;

  const benchmark = readJson<{ requestsPerSecond: number; p95LatencyMs: number; successRate?: number }>(benchmarkPath);
  const releaseBundleDir = resolve(outputDir, 'release-bundle');

  const probe = await probeObservabilityReleaseInputs({
    provider,
    benchmarkPath,
    prometheusUrl,
    alertmanagerUrl,
  });

  const repoPipeline = resolveRepoPipelineReadiness();
  const missingInputs = detectMissingInputs(provider, secretMode);
  if (repoPipeline.missingInput) missingInputs.push(repoPipeline.missingInput);
  const issues = [...new Set([
    ...probe.releaseReadiness.issues,
    ...missingInputs.map((item) => `${item} is still missing.`),
    ...(repoPipeline.issue ? [repoPipeline.issue] : []),
  ])];
  const environmentInputsComplete = missingInputs.length === 0 && probe.releaseReadiness.envComplete;
  const promotionGatePassed = probe.releaseReadiness.bundleRenderSucceeded
    && probe.releaseReadiness.receiverProbeSucceeded
    && probe.releaseReadiness.alertRoutingSucceeded;

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(releaseBundleDir, { recursive: true });

  let profileSummaryPath: string | null = null;
  let releaseSummaryPath: string | null = null;

  if (environmentInputsComplete) {
    runTsx(
      'scripts/render-observability-release-bundle.ts',
      [`--provider=${provider}`, `--secret-mode=${secretMode}`, `--benchmark=${benchmarkPath}`, `--output-dir=${releaseBundleDir}`],
      process.env,
    );
    profileSummaryPath = resolve(releaseBundleDir, 'profile-summary.json');
    releaseSummaryPath = resolve(releaseBundleDir, 'summary.json');
  } else {
    writeFileSync(
      resolve(releaseBundleDir, 'README.md'),
      `# Release bundle skipped

The release bundle was not rendered because required observability inputs are still missing.

Missing inputs:
${formatChecklist(missingInputs)}
`,
      'utf8',
    );
  }

  const packet: ObservabilityPromotionPacket = {
    provider,
    secretMode,
    benchmarkPath,
    benchmark: {
      requestsPerSecond: benchmark.requestsPerSecond,
      p95LatencyMs: benchmark.p95LatencyMs,
      successRate: benchmark.successRate ?? null,
    },
    readiness: {
      repoPipelineReady: repoPipeline.ready,
      environmentInputsComplete,
      promotionGatePassed,
      state: repoPipeline.ready && environmentInputsComplete && promotionGatePassed
        ? 'ready-for-environment-promotion'
        : 'blocked-on-environment-inputs',
      issues,
      missingInputs,
    },
    artifacts: {
      releaseBundleDir,
      profileSummaryPath,
      releaseSummaryPath,
      promotionReadmePath: resolve(outputDir, 'README.md'),
    },
    probe,
  };

  writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  writeFileSync(
    resolve(outputDir, 'README.md'),
    `# Attestor observability promotion packet

Generated from:

- benchmark: ${benchmarkPath}
- provider: ${provider}
- secret mode: ${secretMode}

Readiness:

- repo pipeline ready: ${packet.readiness.repoPipelineReady}
- environment inputs complete: ${packet.readiness.environmentInputsComplete}
- promotion gate passed: ${packet.readiness.promotionGatePassed}
- state: ${packet.readiness.state}

Missing inputs:
${formatChecklist(packet.readiness.missingInputs)}

Issues:
${formatChecklist(packet.readiness.issues)}

Recommended apply flow:

1. Review \`${releaseBundleDir}\`
2. ${environmentInputsComplete ? `Apply the bundle: \`kubectl apply -k ${releaseBundleDir}\`` : 'Load the missing inputs listed above and re-render the promotion packet'}
3. Run \`npm run probe:observability-release-inputs -- --provider=${provider} --benchmark=${benchmarkPath}${prometheusUrl ? ` --prometheus-url=${prometheusUrl}` : ''}${alertmanagerUrl ? ` --alertmanager-url=${alertmanagerUrl}` : ''}\`
4. Re-run this promotion packet generator and archive \`${resolve(outputDir, 'summary.json')}\` as the rollout checkpoint
`,
    'utf8',
  );

  return packet;
}

async function main(): Promise<void> {
  const packet = await renderObservabilityPromotionPacket();
  console.log(JSON.stringify(packet, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
