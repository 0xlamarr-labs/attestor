import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  renderObservabilityPromotionPacket,
  type ObservabilityPromotionPacket,
} from './render-observability-promotion-packet.ts';
import {
  renderHaPromotionPacket,
  type HaPromotionPacket,
} from './render-ha-promotion-packet.ts';

type ObservabilityProvider = 'generic' | 'grafana-cloud';
type HaProvider = 'generic' | 'aws' | 'gke';
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

function numberArg(name: string, fallback: number): number {
  const raw = arg(name, env(name) ?? undefined);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function formatChecklist(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

function benchmarkAgeHours(path: string): number {
  return (Date.now() - statSync(path).mtimeMs) / 3_600_000;
}

export interface ProductionReadinessPacket {
  generatedAt: string;
  readiness: {
    repoPipelineReady: boolean;
    environmentInputsComplete: boolean;
    benchmarkFreshnessPassed: boolean;
    promotionGatePassed: boolean;
    state: 'ready-for-environment-promotion' | 'blocked-on-environment-inputs';
    issues: string[];
    missingInputs: string[];
  };
  thresholds: {
    observabilityBenchmarkMaxAgeHours: number;
    haBenchmarkMaxAgeHours: number;
  };
  observability: {
    provider: ObservabilityProvider;
    secretMode: SecretMode;
    benchmarkPath: string;
    benchmarkAgeHours: number;
    packet: ObservabilityPromotionPacket;
  };
  ha: {
    provider: HaProvider;
    benchmarkPath: string;
    benchmarkAgeHours: number;
    packet: HaPromotionPacket;
  };
  artifacts: {
    outputDir: string;
    observabilityPacketDir: string;
    haPacketDir: string;
    summaryPath: string;
    readmePath: string;
  };
}

export async function renderProductionReadinessPacket(options?: {
  observabilityProvider?: ObservabilityProvider;
  observabilitySecretMode?: SecretMode;
  observabilityBenchmarkPath?: string;
  prometheusUrl?: string | null;
  alertmanagerUrl?: string | null;
  haProvider?: HaProvider;
  haBenchmarkPath?: string;
  outputDir?: string;
  observabilityBenchmarkMaxAgeHours?: number;
  haBenchmarkMaxAgeHours?: number;
}): Promise<ProductionReadinessPacket> {
  const observabilityProvider = (options?.observabilityProvider
    ?? arg('observability-provider', env('ATTESTOR_OBSERVABILITY_PROVIDER') ?? 'grafana-cloud')) as ObservabilityProvider;
  const observabilitySecretMode = (options?.observabilitySecretMode
    ?? arg(
      'observability-secret-mode',
      env('ATTESTOR_OBSERVABILITY_SECRET_MODE') ?? (observabilityProvider === 'grafana-cloud' ? 'external-secret' : 'secret'),
    )) as SecretMode;
  const observabilityBenchmarkPath = resolve(
    options?.observabilityBenchmarkPath
    ?? arg('observability-benchmark', env('ATTESTOR_OBSERVABILITY_BENCHMARK_PATH') ?? '')
    ?? '',
  );
  const haProvider = (options?.haProvider ?? arg('ha-provider', env('ATTESTOR_HA_PROVIDER') ?? 'gke')) as HaProvider;
  const haBenchmarkPath = resolve(
    options?.haBenchmarkPath
    ?? arg('ha-benchmark', env('ATTESTOR_HA_BENCHMARK_PATH') ?? '')
    ?? '',
  );
  if (!observabilityBenchmarkPath) throw new Error('--observability-benchmark or ATTESTOR_OBSERVABILITY_BENCHMARK_PATH is required.');
  if (!haBenchmarkPath) throw new Error('--ha-benchmark or ATTESTOR_HA_BENCHMARK_PATH is required.');

  const outputDir = resolve(options?.outputDir ?? arg('output-dir', '.attestor/production-readiness/latest')!);
  const observabilityPacketDir = resolve(outputDir, 'observability');
  const haPacketDir = resolve(outputDir, 'ha');
  const prometheusUrl = options?.prometheusUrl ?? arg('prometheus-url', env('ATTESTOR_OBSERVABILITY_PROMETHEUS_URL') ?? env('PROMETHEUS_BASE_URL')) ?? null;
  const alertmanagerUrl = options?.alertmanagerUrl ?? arg('alertmanager-url', env('ATTESTOR_OBSERVABILITY_ALERTMANAGER_URL') ?? env('ALERTMANAGER_BASE_URL')) ?? null;
  const observabilityBenchmarkMaxAgeHours = options?.observabilityBenchmarkMaxAgeHours ?? numberArg('observability-max-age-hours', 24);
  const haBenchmarkMaxAgeHours = options?.haBenchmarkMaxAgeHours ?? numberArg('ha-max-age-hours', 72);

  mkdirSync(outputDir, { recursive: true });

  const observabilityPacket = await renderObservabilityPromotionPacket({
    provider: observabilityProvider,
    secretMode: observabilitySecretMode,
    benchmarkPath: observabilityBenchmarkPath,
    prometheusUrl,
    alertmanagerUrl,
    outputDir: observabilityPacketDir,
  });
  const haPacket = await renderHaPromotionPacket({
    provider: haProvider,
    benchmarkPath: haBenchmarkPath,
    outputDir: haPacketDir,
  });

  const observabilityAge = benchmarkAgeHours(observabilityBenchmarkPath);
  const haAge = benchmarkAgeHours(haBenchmarkPath);
  const freshnessIssues: string[] = [];
  if (observabilityAge > observabilityBenchmarkMaxAgeHours) {
    freshnessIssues.push(`Observability benchmark is stale (${observabilityAge.toFixed(2)}h > ${observabilityBenchmarkMaxAgeHours}h max).`);
  }
  if (haAge > haBenchmarkMaxAgeHours) {
    freshnessIssues.push(`HA benchmark is stale (${haAge.toFixed(2)}h > ${haBenchmarkMaxAgeHours}h max).`);
  }

  const missingInputs = [
    ...observabilityPacket.readiness.missingInputs.map((item) => `observability: ${item}`),
    ...haPacket.readiness.missingInputs.map((item) => `ha: ${item}`),
  ];
  const issues = [
    ...new Set([
      ...observabilityPacket.readiness.issues.map((item) => `observability: ${item}`),
      ...haPacket.readiness.issues.map((item) => `ha: ${item}`),
      ...freshnessIssues,
    ]),
  ];

  const environmentInputsComplete = observabilityPacket.readiness.environmentInputsComplete
    && haPacket.readiness.environmentInputsComplete;
  const benchmarkFreshnessPassed = freshnessIssues.length === 0;
  const promotionGatePassed = observabilityPacket.readiness.promotionGatePassed
    && haPacket.readiness.promotionGatePassed;

  const packet: ProductionReadinessPacket = {
    generatedAt: new Date().toISOString(),
    readiness: {
      repoPipelineReady: true,
      environmentInputsComplete,
      benchmarkFreshnessPassed,
      promotionGatePassed,
      state: environmentInputsComplete && benchmarkFreshnessPassed && promotionGatePassed
        ? 'ready-for-environment-promotion'
        : 'blocked-on-environment-inputs',
      issues,
      missingInputs,
    },
    thresholds: {
      observabilityBenchmarkMaxAgeHours,
      haBenchmarkMaxAgeHours,
    },
    observability: {
      provider: observabilityProvider,
      secretMode: observabilitySecretMode,
      benchmarkPath: observabilityBenchmarkPath,
      benchmarkAgeHours: observabilityAge,
      packet: observabilityPacket,
    },
    ha: {
      provider: haProvider,
      benchmarkPath: haBenchmarkPath,
      benchmarkAgeHours: haAge,
      packet: haPacket,
    },
    artifacts: {
      outputDir,
      observabilityPacketDir,
      haPacketDir,
      summaryPath: resolve(outputDir, 'summary.json'),
      readmePath: resolve(outputDir, 'README.md'),
    },
  };

  writeFileSync(packet.artifacts.summaryPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  writeFileSync(
    packet.artifacts.readmePath,
    `# Attestor production readiness packet

Generated at:

- ${packet.generatedAt}

Readiness:

- repo pipeline ready: ${packet.readiness.repoPipelineReady}
- environment inputs complete: ${packet.readiness.environmentInputsComplete}
- benchmark freshness passed: ${packet.readiness.benchmarkFreshnessPassed}
- promotion gate passed: ${packet.readiness.promotionGatePassed}
- state: ${packet.readiness.state}

Benchmark freshness:

- observability benchmark age: ${observabilityAge.toFixed(2)}h (max ${observabilityBenchmarkMaxAgeHours}h)
- HA benchmark age: ${haAge.toFixed(2)}h (max ${haBenchmarkMaxAgeHours}h)

Missing inputs:
${formatChecklist(packet.readiness.missingInputs)}

Issues:
${formatChecklist(packet.readiness.issues)}

Artifacts:

- observability packet: ${observabilityPacketDir}
- HA packet: ${haPacketDir}
- summary: ${packet.artifacts.summaryPath}

Recommended promotion flow:

1. If blocked, resolve the missing inputs or refresh the stale benchmark files listed above.
2. Review the observability packet in \`${observabilityPacketDir}\`.
3. Review the HA packet in \`${haPacketDir}\`.
4. ${packet.readiness.state === 'ready-for-environment-promotion'
    ? `Apply the observability and HA bundles from those packet directories, then archive \`${packet.artifacts.summaryPath}\` as the rollout checkpoint.`
    : 'Re-run this production readiness packet after the blockers are cleared.'}
`,
    'utf8',
  );

  return packet;
}

async function main(): Promise<void> {
  const packet = await renderProductionReadinessPacket();
  console.log(JSON.stringify(packet, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
