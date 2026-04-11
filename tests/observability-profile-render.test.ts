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
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-observability-profile-'));
  const benchmarkPath = resolve(tempDir, 'benchmark.json');
  const outputDir = resolve(tempDir, 'rendered');

  writeFileSync(
    benchmarkPath,
    `${JSON.stringify({
      requestsPerSecond: 22.4,
      p95LatencyMs: 420,
      successRate: 0.998
    }, null, 2)}\n`,
    'utf8',
  );

  try {
    const run = spawnSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/render-observability-profile.ts',
        `--input=${benchmarkPath}`,
        '--profile=ops/observability/profiles/regulated-production.json',
        `--output-dir=${outputDir}`,
      ],
      { cwd: resolve('.'), encoding: 'utf8' },
    );
    ok(run.status === 0, 'Observability profile render: script exits successfully');
    const summary = JSON.parse(readFileSync(resolve(outputDir, 'summary.json'), 'utf8')) as {
      slo: { meetsAvailability: boolean; meetsLatency: boolean; availabilityErrorBudget: number; latencyErrorBudget: number };
    };
    const rules = readFileSync(resolve(outputDir, 'recording-rules.generated.yml'), 'utf8');
    const alerts = readFileSync(resolve(outputDir, 'alerts.generated.yml'), 'utf8');
    const retention = readFileSync(resolve(outputDir, 'retention.env'), 'utf8');
    ok(summary.slo.meetsAvailability && summary.slo.meetsLatency, 'Observability profile render: summary evaluates measured SLO success');
    ok(summary.slo.availabilityErrorBudget === 0.005, 'Observability profile render: summary derives availability error budget');
    ok(summary.slo.latencyErrorBudget === 0.05, 'Observability profile render: summary derives latency error budget');
    ok(rules.includes('/ 0.005') && rules.includes('le="0.5"'), 'Observability profile render: recording rules carry profile-specific SLO math');
    ok(alerts.includes('> 10') && alerts.includes('for: 5m') && alerts.includes('500ms latency objective'), 'Observability profile render: alerts carry profile-specific burn thresholds');
    ok(retention.includes('ATTESTOR_OBSERVABILITY_PROMETHEUS_RETENTION_TIME=30d') && retention.includes('ATTESTOR_OBSERVABILITY_TEMPO_RETENTION_PERIOD=720h'), 'Observability profile render: retention env output is generated');

    console.log(`\nObservability profile render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error('\nObservability profile render tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
