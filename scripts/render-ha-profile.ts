import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface BenchmarkSummary {
  url: string;
  concurrency: number;
  durationSeconds: number;
  replicas?: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate?: number;
  errorRate?: number;
  requestsPerSecond: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  suggestedApiPrometheusThreshold: number;
  suggestedWorkerRedisListThreshold: number;
}

interface ScalerProfile {
  thresholdMultiplier: number;
  minThreshold: number;
  maxThreshold: number;
  activationRatio: number;
  minActivationThreshold: number;
  pollingIntervalSeconds: number;
  cooldownPeriodSeconds: number;
  minReplicaCount: number;
  maxReplicaCount: number;
  fallbackReplicas: number;
}

interface AwsProfile {
  healthcheckIntervalSeconds: number;
  healthcheckTimeoutSeconds: number;
  healthyThresholdCount: number;
  unhealthyThresholdCount: number;
  idleTimeoutMinSeconds: number;
  idleTimeoutMaxSeconds: number;
  idleTimeoutLatencyMultiplier: number;
  deregistrationDelayMinSeconds: number;
  deregistrationDelayMaxSeconds: number;
  deregistrationDelayLatencyMultiplier: number;
  slowStartMinSeconds: number;
  slowStartMaxSeconds: number;
  slowStartLatencyMultiplier: number;
}

interface GkeProfile {
  timeoutMinSeconds: number;
  timeoutMaxSeconds: number;
  timeoutLatencyMultiplier: number;
  drainingMinSeconds: number;
  drainingMaxSeconds: number;
  drainingLatencyMultiplier: number;
  loggingSampleRate: number;
}

interface CalibrationProfile {
  name: string;
  provider: 'aws' | 'gke';
  description?: string;
  slo: {
    p95LatencyMs: number;
    availabilityTarget: number;
  };
  api: ScalerProfile;
  worker: ScalerProfile;
  aws?: AwsProfile;
  gke?: GkeProfile;
}

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function deriveActivation(threshold: number, ratio: number, minActivation: number): number {
  return clamp(Math.floor(threshold * ratio), minActivation, Math.max(minActivation, threshold - 1));
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

function renderApiPatch(threshold: number, activationThreshold: number, profile: ScalerProfile): string {
  return `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: attestor-api
spec:
  pollingInterval: ${profile.pollingIntervalSeconds}
  cooldownPeriod: ${profile.cooldownPeriodSeconds}
  minReplicaCount: ${profile.minReplicaCount}
  maxReplicaCount: ${profile.maxReplicaCount}
  fallback:
    failureThreshold: 3
    replicas: ${profile.fallbackReplicas}
  triggers:
    - type: prometheus
      metadata:
        threshold: "${threshold}"
        activationThreshold: "${activationThreshold}"
`;
}

function renderWorkerPatch(listLength: number, activationListLength: number, profile: ScalerProfile): string {
  return `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: attestor-worker
spec:
  pollingInterval: ${profile.pollingIntervalSeconds}
  cooldownPeriod: ${profile.cooldownPeriodSeconds}
  minReplicaCount: ${profile.minReplicaCount}
  maxReplicaCount: ${profile.maxReplicaCount}
  fallback:
    failureThreshold: 3
    replicas: ${profile.fallbackReplicas}
  triggers:
    - type: redis-lists
      metadata:
        listLength: "${listLength}"
        activationListLength: "${activationListLength}"
`;
}

function renderAwsPatch(profile: AwsProfile, p95LatencyMs: number): string {
  const baseLatencySeconds = Math.max(1, Math.ceil(p95LatencyMs / 1000));
  const idleTimeoutSeconds = clamp(baseLatencySeconds * profile.idleTimeoutLatencyMultiplier, profile.idleTimeoutMinSeconds, profile.idleTimeoutMaxSeconds);
  const deregistrationDelaySeconds = clamp(baseLatencySeconds * profile.deregistrationDelayLatencyMultiplier, profile.deregistrationDelayMinSeconds, profile.deregistrationDelayMaxSeconds);
  const slowStartSeconds = clamp(baseLatencySeconds * profile.slowStartLatencyMultiplier, profile.slowStartMinSeconds, profile.slowStartMaxSeconds);
  return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: attestor-api
  annotations:
    alb.ingress.kubernetes.io/healthcheck-interval-seconds: "${profile.healthcheckIntervalSeconds}"
    alb.ingress.kubernetes.io/healthcheck-timeout-seconds: "${profile.healthcheckTimeoutSeconds}"
    alb.ingress.kubernetes.io/healthy-threshold-count: "${profile.healthyThresholdCount}"
    alb.ingress.kubernetes.io/unhealthy-threshold-count: "${profile.unhealthyThresholdCount}"
    alb.ingress.kubernetes.io/target-group-attributes: deregistration_delay.timeout_seconds=${deregistrationDelaySeconds},slow_start.duration_seconds=${slowStartSeconds},load_balancing.algorithm.type=least_outstanding_requests
    alb.ingress.kubernetes.io/load-balancer-attributes: routing.http.drop_invalid_header_fields.enabled=true,idle_timeout.timeout_seconds=${idleTimeoutSeconds}
`;
}

function renderGkePatch(profile: GkeProfile, p95LatencyMs: number): string {
  const baseLatencySeconds = Math.max(1, Math.ceil(p95LatencyMs / 1000));
  const timeoutSec = clamp(baseLatencySeconds * profile.timeoutLatencyMultiplier, profile.timeoutMinSeconds, profile.timeoutMaxSeconds);
  const drainingTimeoutSec = clamp(baseLatencySeconds * profile.drainingLatencyMultiplier, profile.drainingMinSeconds, profile.drainingMaxSeconds);
  return `apiVersion: networking.gke.io/v1
kind: GCPBackendPolicy
metadata:
  name: attestor-api
spec:
  default:
    timeoutSec: ${timeoutSec}
    connectionDraining:
      drainingTimeoutSec: ${drainingTimeoutSec}
    logging:
      enabled: true
      sampleRate: ${profile.loggingSampleRate}
`;
}

function main(): void {
  const inputPath = arg('input');
  const profilePath = arg('profile');
  if (!inputPath || !profilePath) {
    throw new Error('Usage: tsx scripts/render-ha-profile.ts --input=<benchmark.json> --profile=<profile.json> [--output-dir=<dir>]');
  }

  const benchmark = readJsonFile<BenchmarkSummary>(inputPath);
  const profile = readJsonFile<CalibrationProfile>(profilePath);
  const outputDir = resolve(arg('output-dir', `.attestor/ha-calibration/rendered/${profile.name}`)!);
  const successRate = benchmark.successRate ?? (benchmark.totalRequests > 0 ? benchmark.successCount / benchmark.totalRequests : 0);
  const apiThreshold = clamp(
    Math.round(benchmark.suggestedApiPrometheusThreshold * profile.api.thresholdMultiplier),
    profile.api.minThreshold,
    profile.api.maxThreshold,
  );
  const workerListLength = clamp(
    Math.round(benchmark.suggestedWorkerRedisListThreshold * profile.worker.thresholdMultiplier),
    profile.worker.minThreshold,
    profile.worker.maxThreshold,
  );
  const apiActivationThreshold = deriveActivation(apiThreshold, profile.api.activationRatio, profile.api.minActivationThreshold);
  const workerActivationListLength = deriveActivation(workerListLength, profile.worker.activationRatio, profile.worker.minActivationThreshold);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    resolve(outputDir, 'summary.json'),
    `${JSON.stringify({
      profile: {
        name: profile.name,
        provider: profile.provider,
        description: profile.description,
      },
      benchmark,
      slo: {
        targetP95LatencyMs: profile.slo.p95LatencyMs,
        targetAvailability: profile.slo.availabilityTarget,
        measuredP95LatencyMs: benchmark.p95LatencyMs,
        measuredAvailability: Number(successRate.toFixed(4)),
        meetsP95Latency: benchmark.p95LatencyMs <= profile.slo.p95LatencyMs,
        meetsAvailability: successRate >= profile.slo.availabilityTarget,
      },
      recommendedKeda: {
        api: {
          threshold: apiThreshold,
          activationThreshold: apiActivationThreshold,
        },
        worker: {
          listLength: workerListLength,
          activationListLength: workerActivationListLength,
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(resolve(outputDir, 'api-scaledobject.patch.yaml'), renderApiPatch(apiThreshold, apiActivationThreshold, profile.api), 'utf8');
  writeFileSync(resolve(outputDir, 'worker-scaledobject.patch.yaml'), renderWorkerPatch(workerListLength, workerActivationListLength, profile.worker), 'utf8');
  if (profile.provider === 'aws') {
    if (!profile.aws) throw new Error(`Profile "${profile.name}" is missing aws settings.`);
    writeFileSync(resolve(outputDir, 'alb-ingress.patch.yaml'), renderAwsPatch(profile.aws, benchmark.p95LatencyMs), 'utf8');
  } else {
    if (!profile.gke) throw new Error(`Profile "${profile.name}" is missing gke settings.`);
    writeFileSync(resolve(outputDir, 'gcpbackendpolicy.patch.yaml'), renderGkePatch(profile.gke, benchmark.p95LatencyMs), 'utf8');
  }
  writeFileSync(
    resolve(outputDir, 'README.md'),
    `# ${profile.name}

Generated from ${inputPath}.

1. Review \`summary.json\` for SLO pass/fail status.
2. Patch \`ops/kubernetes/ha/providers/keda/api-scaledobject.yaml\` with \`api-scaledobject.patch.yaml\`.
3. Patch \`ops/kubernetes/ha/providers/keda/worker-scaledobject.yaml\` with \`worker-scaledobject.patch.yaml\`.
4. Apply the provider patch for ${profile.provider.toUpperCase()} after validating account/project-specific policy names and certificate wiring.
`,
    'utf8',
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
