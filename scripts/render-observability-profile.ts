import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface BenchmarkSummary {
  requestsPerSecond: number;
  p95LatencyMs: number;
  successRate?: number;
  successCount?: number;
  totalRequests?: number;
}

interface ObservabilityProfile {
  name: string;
  description?: string;
  slo: {
    availabilityTarget: number;
    latencyP95Ms: number;
    latencySuccessTarget: number;
  };
  alerts: {
    fastBurnRate: number;
    slowBurnRate: number;
    criticalForMinutes: number;
    warningForMinutes: number;
    repeatIntervalMinutes: number;
  };
  retention: {
    prometheusDays: number;
    prometheusSizeGb: number;
    lokiHours: number;
    tempoHours: number;
  };
}

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

function main(): void {
  const inputPath = arg('input');
  const profilePath = arg('profile');
  if (!inputPath || !profilePath) {
    throw new Error('Usage: tsx scripts/render-observability-profile.ts --input=<benchmark.json> --profile=<profile.json> [--output-dir=<dir>]');
  }

  const benchmark = readJson<BenchmarkSummary>(inputPath);
  const profile = readJson<ObservabilityProfile>(profilePath);
  const outputDir = resolve(arg('output-dir', `.attestor/observability/${profile.name}`)!);
  const measuredAvailability = benchmark.successRate ?? ((benchmark.totalRequests ?? 0) > 0 && benchmark.successCount !== undefined
    ? benchmark.successCount / (benchmark.totalRequests ?? 1)
    : 1);
  const availabilityErrorBudget = 1 - profile.slo.availabilityTarget;
  const latencyErrorBudget = 1 - profile.slo.latencySuccessTarget;
  const latencyBucketSeconds = (profile.slo.latencyP95Ms / 1000).toFixed(3).replace(/\.?0+$/, '');

  mkdirSync(outputDir, { recursive: true });

  const summary = {
    profile: {
      name: profile.name,
      description: profile.description,
    },
    benchmark: {
      requestsPerSecond: benchmark.requestsPerSecond,
      p95LatencyMs: benchmark.p95LatencyMs,
      measuredAvailability: Number(measuredAvailability.toFixed(4)),
    },
    slo: {
      targetAvailability: profile.slo.availabilityTarget,
      targetLatencyP95Ms: profile.slo.latencyP95Ms,
      meetsAvailability: measuredAvailability >= profile.slo.availabilityTarget,
      meetsLatency: benchmark.p95LatencyMs <= profile.slo.latencyP95Ms,
      availabilityErrorBudget: Number(availabilityErrorBudget.toFixed(4)),
      latencyErrorBudget: Number(latencyErrorBudget.toFixed(4)),
    },
    retention: profile.retention,
    alerts: profile.alerts,
  };

  const recordingRules = `groups:
  - name: attestor-slo-recording
    rules:
      - record: attestor:slo_api_requests:rate5m
        expr: sum(rate(attestor_http_requests_total{route!~"/api/v1/(metrics|admin/metrics|health|ready)"}[5m]))

      - record: attestor:slo_api_error_ratio:5m
        expr: |
          sum(rate(attestor_http_requests_total{route!~"/api/v1/(metrics|admin/metrics|health|ready)",status_code=~"5.."}[5m]))
          /
          clamp_min(sum(rate(attestor_http_requests_total{route!~"/api/v1/(metrics|admin/metrics|health|ready)"}[5m])), 0.001)

      - record: attestor:slo_api_error_ratio:1h
        expr: |
          sum(rate(attestor_http_requests_total{route!~"/api/v1/(metrics|admin/metrics|health|ready)",status_code=~"5.."}[1h]))
          /
          clamp_min(sum(rate(attestor_http_requests_total{route!~"/api/v1/(metrics|admin/metrics|health|ready)"}[1h])), 0.001)

      - record: attestor:slo_api_error_ratio:24h
        expr: |
          sum(rate(attestor_http_requests_total{route!~"/api/v1/(metrics|admin/metrics|health|ready)",status_code=~"5.."}[24h]))
          /
          clamp_min(sum(rate(attestor_http_requests_total{route!~"/api/v1/(metrics|admin/metrics|health|ready)"}[24h])), 0.001)

      - record: attestor:slo_api_availability_burn_rate:5m
        expr: attestor:slo_api_error_ratio:5m / ${availabilityErrorBudget.toFixed(4)}

      - record: attestor:slo_api_availability_burn_rate:1h
        expr: attestor:slo_api_error_ratio:1h / ${availabilityErrorBudget.toFixed(4)}

      - record: attestor:slo_api_availability_burn_rate:24h
        expr: attestor:slo_api_error_ratio:24h / ${availabilityErrorBudget.toFixed(4)}

      - record: attestor:slo_api_latency_good_ratio:5m
        expr: |
          sum(rate(attestor_http_request_duration_seconds_bucket{route!~"/api/v1/(metrics|admin/metrics|health|ready)",le="${latencyBucketSeconds}"}[5m]))
          /
          clamp_min(sum(rate(attestor_http_request_duration_seconds_count{route!~"/api/v1/(metrics|admin/metrics|health|ready)"}[5m])), 0.001)

      - record: attestor:slo_api_latency_good_ratio:1h
        expr: |
          sum(rate(attestor_http_request_duration_seconds_bucket{route!~"/api/v1/(metrics|admin/metrics|health|ready)",le="${latencyBucketSeconds}"}[1h]))
          /
          clamp_min(sum(rate(attestor_http_request_duration_seconds_count{route!~"/api/v1/(metrics|admin/metrics|health|ready)"}[1h])), 0.001)

      - record: attestor:slo_api_latency_good_ratio:24h
        expr: |
          sum(rate(attestor_http_request_duration_seconds_bucket{route!~"/api/v1/(metrics|admin/metrics|health|ready)",le="${latencyBucketSeconds}"}[24h]))
          /
          clamp_min(sum(rate(attestor_http_request_duration_seconds_count{route!~"/api/v1/(metrics|admin/metrics|health|ready)"}[24h])), 0.001)

      - record: attestor:slo_api_latency_burn_rate:5m
        expr: (1 - attestor:slo_api_latency_good_ratio:5m) / ${latencyErrorBudget.toFixed(4)}

      - record: attestor:slo_api_latency_burn_rate:1h
        expr: (1 - attestor:slo_api_latency_good_ratio:1h) / ${latencyErrorBudget.toFixed(4)}

      - record: attestor:slo_api_latency_burn_rate:24h
        expr: (1 - attestor:slo_api_latency_good_ratio:24h) / ${latencyErrorBudget.toFixed(4)}
`;

  const alerts = `groups:
  - name: attestor-slo
    rules:
      - alert: AttestorAvailabilityErrorBudgetFastBurn
        expr: attestor:slo_api_availability_burn_rate:1h > ${profile.alerts.fastBurnRate} and attestor:slo_api_availability_burn_rate:5m > ${profile.alerts.fastBurnRate}
        for: ${profile.alerts.criticalForMinutes}m
        labels:
          severity: critical
        annotations:
          summary: Attestor API is rapidly burning availability error budget
          description: Multi-window burn-rate alert indicates a severe availability regression against the ${(profile.slo.availabilityTarget * 100).toFixed(2)}% availability target.

      - alert: AttestorAvailabilityErrorBudgetSlowBurn
        expr: attestor:slo_api_availability_burn_rate:24h > ${profile.alerts.slowBurnRate} and attestor:slo_api_availability_burn_rate:1h > ${profile.alerts.slowBurnRate}
        for: ${profile.alerts.warningForMinutes}m
        labels:
          severity: warning
        annotations:
          summary: Attestor API is steadily burning availability error budget
          description: Multi-window burn-rate alert indicates a sustained availability regression against the ${(profile.slo.availabilityTarget * 100).toFixed(2)}% availability target.

      - alert: AttestorLatencyErrorBudgetFastBurn
        expr: attestor:slo_api_latency_burn_rate:1h > ${profile.alerts.fastBurnRate} and attestor:slo_api_latency_burn_rate:5m > ${profile.alerts.fastBurnRate}
        for: ${profile.alerts.criticalForMinutes}m
        labels:
          severity: critical
        annotations:
          summary: Attestor API is rapidly burning latency error budget
          description: Multi-window burn-rate alert indicates the ${Math.round(profile.slo.latencySuccessTarget * 100)}% under ${profile.slo.latencyP95Ms}ms latency objective is sharply regressing.

      - alert: AttestorLatencyErrorBudgetSlowBurn
        expr: attestor:slo_api_latency_burn_rate:24h > ${profile.alerts.slowBurnRate} and attestor:slo_api_latency_burn_rate:1h > ${profile.alerts.slowBurnRate}
        for: ${profile.alerts.warningForMinutes}m
        labels:
          severity: warning
        annotations:
          summary: Attestor API is steadily burning latency error budget
          description: Multi-window burn-rate alert indicates the ${Math.round(profile.slo.latencySuccessTarget * 100)}% under ${profile.slo.latencyP95Ms}ms latency objective is drifting out of budget.
`;

  const retentionEnv = `ATTESTOR_OBSERVABILITY_PROMETHEUS_RETENTION_TIME=${profile.retention.prometheusDays}d
ATTESTOR_OBSERVABILITY_PROMETHEUS_RETENTION_SIZE=${profile.retention.prometheusSizeGb}GB
ATTESTOR_OBSERVABILITY_LOKI_RETENTION_PERIOD=${profile.retention.lokiHours}h
ATTESTOR_OBSERVABILITY_TEMPO_RETENTION_PERIOD=${profile.retention.tempoHours}h
`;

  const readme = `# ${profile.name}

Generated from ${inputPath}.

- measured availability: ${(measuredAvailability * 100).toFixed(2)}%
- measured p95 latency: ${benchmark.p95LatencyMs} ms
- target availability: ${(profile.slo.availabilityTarget * 100).toFixed(2)}%
- target latency: ${profile.slo.latencyP95Ms} ms

Apply guidance:

1. Review \`summary.json\`.
2. Compare \`recording-rules.generated.yml\` with \`ops/observability/prometheus/recording-rules.yml\`.
3. Compare \`alerts.generated.yml\` with \`ops/observability/prometheus/alerts.yml\`.
4. Feed \`retention.env\` into the observability compose or managed rollout environment.
5. Re-render after real traffic changes.
`;

  writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'recording-rules.generated.yml'), recordingRules, 'utf8');
  writeFileSync(resolve(outputDir, 'alerts.generated.yml'), alerts, 'utf8');
  writeFileSync(resolve(outputDir, 'retention.env'), retentionEnv, 'utf8');
  writeFileSync(resolve(outputDir, 'README.md'), readme, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
