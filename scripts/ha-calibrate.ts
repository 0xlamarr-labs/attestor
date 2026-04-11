import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface Sample {
  latencyMs: number;
  ok: boolean;
}

interface ResultSummary {
  url: string;
  concurrency: number;
  durationSeconds: number;
  replicas: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  errorRate: number;
  requestsPerSecond: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  suggestedApiPrometheusThreshold: number;
  suggestedWorkerRedisListThreshold: number;
}

function arg(name: string, fallback: string): string {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function num(name: string, fallback: number): number {
  const value = Number(arg(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

async function worker(url: string, untilMs: number, samples: Sample[]): Promise<void> {
  while (Date.now() < untilMs) {
    const started = performance.now();
    try {
      const response = await fetch(url, { method: 'GET' });
      const latencyMs = performance.now() - started;
      samples.push({ latencyMs, ok: response.ok });
      await response.arrayBuffer().catch(() => {});
    } catch {
      const latencyMs = performance.now() - started;
      samples.push({ latencyMs, ok: false });
    }
  }
}

async function main(): Promise<void> {
  const url = arg('url', 'http://127.0.0.1:3700/api/v1/health');
  const concurrency = num('concurrency', 16);
  const durationSeconds = num('duration', 20);
  const replicas = num('replicas', 2);
  const targetQueueDelaySeconds = num('queue-delay', 10);
  const output = resolve(arg('output', '.attestor/ha-calibration/latest.json'));
  const untilMs = Date.now() + (durationSeconds * 1000);
  const samples: Sample[] = [];

  await Promise.all(Array.from({ length: concurrency }, () => worker(url, untilMs, samples)));

  const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const successCount = samples.filter((sample) => sample.ok).length;
  const errorCount = samples.length - successCount;
  const requestsPerSecond = successCount / durationSeconds;
  const perReplicaRps = replicas > 0 ? (requestsPerSecond / replicas) : requestsPerSecond;
  const suggestedApiPrometheusThreshold = Math.max(1, Math.floor(perReplicaRps * 0.7));
  const suggestedWorkerRedisListThreshold = Math.max(1, Math.ceil(perReplicaRps * targetQueueDelaySeconds));
  const successRate = samples.length > 0 ? successCount / samples.length : 0;
  const errorRate = samples.length > 0 ? errorCount / samples.length : 0;

  const summary: ResultSummary = {
    url,
    concurrency,
    durationSeconds,
    replicas,
    totalRequests: samples.length,
    successCount,
    errorCount,
    successRate: Number(successRate.toFixed(4)),
    errorRate: Number(errorRate.toFixed(4)),
    requestsPerSecond: Number(requestsPerSecond.toFixed(2)),
    p50LatencyMs: Number(percentile(latencies, 0.5).toFixed(2)),
    p95LatencyMs: Number(percentile(latencies, 0.95).toFixed(2)),
    suggestedApiPrometheusThreshold,
    suggestedWorkerRedisListThreshold,
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
