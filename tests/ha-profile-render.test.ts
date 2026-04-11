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
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-ha-profile-'));
  const benchmarkPath = resolve(tempDir, 'benchmark.json');
  const awsOutputDir = resolve(tempDir, 'aws');
  const gkeOutputDir = resolve(tempDir, 'gke');

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

  try {
    const aws = spawnSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/render-ha-profile.ts', `--input=${benchmarkPath}`, '--profile=ops/kubernetes/ha/profiles/aws-production.json', `--output-dir=${awsOutputDir}`],
      { cwd: resolve('.'), encoding: 'utf8' },
    );
    ok(aws.status === 0, 'HA profile render: AWS render exits successfully');
    const awsSummary = JSON.parse(readFileSync(resolve(awsOutputDir, 'summary.json'), 'utf8')) as {
      profile: { provider: string };
      recommendedKeda: { api: { threshold: number }; worker: { listLength: number } };
      slo: { meetsP95Latency: boolean; meetsAvailability: boolean };
    };
    const awsAlbPatch = readFileSync(resolve(awsOutputDir, 'alb-ingress.patch.yaml'), 'utf8');
    ok(awsSummary.profile.provider === 'aws', 'HA profile render: AWS summary records provider');
    ok(awsSummary.recommendedKeda.api.threshold === 18, 'HA profile render: AWS summary keeps calibrated API threshold');
    ok(awsSummary.recommendedKeda.worker.listLength === 74, 'HA profile render: AWS summary keeps calibrated worker threshold');
    ok(awsSummary.slo.meetsP95Latency && !awsSummary.slo.meetsAvailability, 'HA profile render: AWS summary evaluates SLOs');
    ok(awsAlbPatch.includes('idle_timeout.timeout_seconds') && awsAlbPatch.includes('deregistration_delay.timeout_seconds'), 'HA profile render: AWS patch carries ALB tuning');

    const gke = spawnSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/render-ha-profile.ts', `--input=${benchmarkPath}`, '--profile=ops/kubernetes/ha/profiles/gke-production.json', `--output-dir=${gkeOutputDir}`],
      { cwd: resolve('.'), encoding: 'utf8' },
    );
    ok(gke.status === 0, 'HA profile render: GKE render exits successfully');
    const gkePatch = readFileSync(resolve(gkeOutputDir, 'gcpbackendpolicy.patch.yaml'), 'utf8');
    const apiPatch = readFileSync(resolve(gkeOutputDir, 'api-scaledobject.patch.yaml'), 'utf8');
    ok(gkePatch.includes('timeoutSec:') && gkePatch.includes('drainingTimeoutSec:'), 'HA profile render: GKE patch carries backend tuning');
    ok(apiPatch.includes('threshold: "18"') && apiPatch.includes('activationThreshold: "3"'), 'HA profile render: KEDA API patch carries expected thresholds');

    console.log(`\nHA profile render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error('\nHA profile render tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
