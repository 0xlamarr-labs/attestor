import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type NullableString = string | null;

interface PrometheusVectorResult {
  metric: Record<string, string>;
  value: [number | string, string];
}

interface PrometheusApiResponse {
  status: string;
  data?: {
    resultType: string;
    result: PrometheusVectorResult[];
  };
  error?: string;
}

interface AlertmanagerAlert {
  labels?: Record<string, string>;
  status?: { state?: string };
}

interface BenchmarkOptions {
  prometheusUrl: string;
  alertmanagerUrl?: string | null;
  outputDir: string;
  window: string;
}

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

function headerValue(prefix: 'PROMETHEUS' | 'ALERTMANAGER'): string | null {
  const direct = env(`${prefix}_AUTH_HEADER`);
  if (direct) return direct;
  const bearer = env(`${prefix}_BEARER_TOKEN`);
  if (bearer) return `Bearer ${bearer}`;
  const username = env(`${prefix}_BASIC_AUTH_USERNAME`);
  const password = env(`${prefix}_BASIC_AUTH_PASSWORD`);
  if (!username && !password) return null;
  if (!(username && password)) throw new Error(`${prefix}_BASIC_AUTH_USERNAME and ${prefix}_BASIC_AUTH_PASSWORD must be set together.`);
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

async function fetchJson<T>(url: string, authHeader: string | null): Promise<T> {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}`);
  return (await response.json()) as T;
}

async function queryPrometheus(baseUrl: string, authHeader: string | null, query: string): Promise<PrometheusVectorResult[]> {
  const url = new URL('/api/v1/query', baseUrl);
  url.searchParams.set('query', query);
  const payload = await fetchJson<PrometheusApiResponse>(url.toString(), authHeader);
  if (payload.status !== 'success') throw new Error(`Prometheus query failed: ${payload.error ?? query}`);
  return payload.data?.result ?? [];
}

function firstNumber(results: PrometheusVectorResult[], fallback = 0): number {
  const raw = results[0]?.value?.[1];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

export async function captureObservabilityBenchmark(options: BenchmarkOptions): Promise<{
  source: { prometheusUrl: string; alertmanagerUrl?: string | null; window: string };
  requestsPerSecond: number;
  successRate: number;
  p95LatencyMs: number;
  activeAlerts: { critical: number; warning: number; total: number };
  hotRoutes: Array<{ route: string; requestsPerSecond: number }>;
}> {
  const { prometheusUrl, alertmanagerUrl, outputDir, window } = options;
  const routeMatcher = '{route!~"/api/v1/(metrics|admin/metrics|health|ready)"}';
  const requestMetric = `attestor_http_requests_total${routeMatcher}`;
  const durationMetric = `attestor_http_request_duration_seconds_bucket${routeMatcher}`;

  const prometheusAuth = headerValue('PROMETHEUS');
  const alertmanagerAuth = headerValue('ALERTMANAGER');

  const rps = await queryPrometheus(prometheusUrl, prometheusAuth, `sum(rate(${requestMetric}[${window}]))`);
  const successRate = await queryPrometheus(
    prometheusUrl,
    prometheusAuth,
    `1 - (sum(rate(attestor_http_requests_total{route!~"/api/v1/(metrics|admin/metrics|health|ready)",status_code=~"5.."}[${window}])) / clamp_min(sum(rate(${requestMetric}[${window}])), 0.001))`,
  );
  const latency = await queryPrometheus(
    prometheusUrl,
    prometheusAuth,
    `histogram_quantile(0.95, sum(rate(${durationMetric}[${window}])) by (le)) * 1000`,
  );
  const routes = await queryPrometheus(
    prometheusUrl,
    prometheusAuth,
    `topk(5, sum(rate(${requestMetric}[${window}])) by (route))`,
  );
  const alerts = alertmanagerUrl
    ? await fetchJson<AlertmanagerAlert[]>(new URL('/api/v2/alerts', alertmanagerUrl).toString(), alertmanagerAuth)
    : [];

  const benchmark = {
    source: { prometheusUrl, alertmanagerUrl, window },
    requestsPerSecond: round(firstNumber(rps), 2),
    successRate: round(Math.min(1, Math.max(0, firstNumber(successRate, 1))), 4),
    p95LatencyMs: round(Math.max(0, firstNumber(latency)), 2),
    activeAlerts: {
      critical: alerts.filter((alert) => alert.labels?.severity === 'critical' && alert.status?.state !== 'suppressed').length,
      warning: alerts.filter((alert) => alert.labels?.severity === 'warning' && alert.status?.state !== 'suppressed').length,
      total: alerts.length,
    },
    hotRoutes: routes.map((entry) => ({
      route: entry.metric.route ?? 'unknown',
      requestsPerSecond: round(Number(entry.value[1]), 3),
    })),
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'benchmark.json'), `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'hot-routes.json'), `${JSON.stringify(benchmark.hotRoutes, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'alerts-summary.json'), `${JSON.stringify(benchmark.activeAlerts, null, 2)}\n`, 'utf8');
  writeFileSync(
    resolve(outputDir, 'README.md'),
    `# Observability calibration snapshot

Generated from:

- Prometheus: ${prometheusUrl}
- Alertmanager: ${alertmanagerUrl ?? 'not configured'}
- window: ${window}

Next steps:

1. Review \`benchmark.json\`.
2. Run \`npm run render:observability-profile -- --input=${resolve(outputDir, 'benchmark.json')} --profile=ops/observability/profiles/regulated-production.json\`.
3. Compare the rendered SLO/retention pack against your current production routing and retention.
4. Re-run after major traffic or feature-shape changes.
`,
    'utf8',
  );

  return benchmark;
}

async function main(): Promise<void> {
  const prometheusUrl = arg('prometheus-url', env('ATTESTOR_OBSERVABILITY_PROMETHEUS_URL') ?? env('PROMETHEUS_BASE_URL'));
  if (!prometheusUrl) {
    throw new Error('Usage: tsx scripts/benchmark-observability.ts --prometheus-url=<url> [--alertmanager-url=<url>] [--window=5m] [--output-dir=<dir>]');
  }

  const benchmark = await captureObservabilityBenchmark({
    prometheusUrl,
    alertmanagerUrl: arg('alertmanager-url', env('ATTESTOR_OBSERVABILITY_ALERTMANAGER_URL') ?? env('ALERTMANAGER_BASE_URL')),
    outputDir: resolve(arg('output-dir', '.attestor/observability/calibration/latest')!),
    window: arg('window', env('ATTESTOR_OBSERVABILITY_BENCHMARK_WINDOW') ?? '5m')!,
  });

  console.log(JSON.stringify(benchmark, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
