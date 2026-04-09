import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

function main(): void {
  const compose = read('docker-compose.observability.yml');
  const collector = read('ops/otel/collector-config.yaml');

  ok(compose.includes('otel-collector:'), 'Observability bundle: compose defines otel-collector service');
  ok(compose.includes('grafana/otel-lgtm'), 'Observability bundle: compose defines local LGTM backend');
  ok(compose.includes('./ops/otel/collector-config.yaml'), 'Observability bundle: collector config mounted into compose');
  ok(collector.includes('receivers:'), 'Observability bundle: collector config declares receivers');
  ok(collector.includes('otlp:'), 'Observability bundle: collector config declares OTLP receiver');
  ok(collector.includes('exporters:'), 'Observability bundle: collector config declares exporters');
  ok(collector.includes('otlp/lgtm:'), 'Observability bundle: collector forwards to LGTM exporter');
  ok(collector.includes('traces:') && collector.includes('metrics:') && collector.includes('logs:'), 'Observability bundle: collector pipelines cover traces, metrics, and logs');

  console.log(`\nObservability bundle tests: ${passed} passed, 0 failed`);
}

try {
  main();
} catch (error) {
  console.error('\nObservability bundle tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
}
