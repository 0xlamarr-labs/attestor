import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Socket } from 'node:net';
import { captureObservabilityBenchmark } from '../scripts/benchmark-observability.ts';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to resolve port.'));
        return;
      }
      resolvePort(address.port);
    });
    server.on('error', reject);
  });
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-observability-benchmark-'));
  const outputDir = resolve(tempDir, 'bundle');
  const sockets = new Set<Socket>();

  const prometheusServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/api/v1/query') {
      res.writeHead(404).end();
      return;
    }
    const query = url.searchParams.get('query') ?? '';
    let result: unknown[] = [];
    if (query.startsWith('sum(rate(attestor_http_requests_total')) {
      result = [{ metric: {}, value: [1712911200, '42.5'] }];
    } else if (query.startsWith('1 - (sum(rate(attestor_http_requests_total')) {
      result = [{ metric: {}, value: [1712911200, '0.9985'] }];
    } else if (query.startsWith('histogram_quantile(0.95')) {
      result = [{ metric: {}, value: [1712911200, '480'] }];
    } else if (query.startsWith('topk(5')) {
      result = [
        { metric: { route: '/api/v1/pipeline/run' }, value: [1712911200, '21.1'] },
        { metric: { route: '/api/v1/account' }, value: [1712911200, '7.3'] },
      ];
    }
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result } }));
  });

  const alertmanagerServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(
      JSON.stringify([
        { labels: { severity: 'critical' }, status: { state: 'active' } },
        { labels: { severity: 'warning' }, status: { state: 'active' } },
      ]),
    );
  });

  for (const server of [prometheusServer, alertmanagerServer]) {
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
  }

  const prometheusPort = await listen(prometheusServer);
  const alertmanagerPort = await listen(alertmanagerServer);

  try {
    const directBenchmark = await captureObservabilityBenchmark({
      prometheusUrl: `http://127.0.0.1:${prometheusPort}`,
      alertmanagerUrl: `http://127.0.0.1:${alertmanagerPort}`,
      window: '15m',
      outputDir,
    });
    const benchmark = JSON.parse(readFileSync(resolve(outputDir, 'benchmark.json'), 'utf8')) as any;
    const routes = JSON.parse(readFileSync(resolve(outputDir, 'hot-routes.json'), 'utf8')) as any[];
    const alerts = JSON.parse(readFileSync(resolve(outputDir, 'alerts-summary.json'), 'utf8')) as any;
    const readme = readFileSync(resolve(outputDir, 'README.md'), 'utf8');

    ok(benchmark.requestsPerSecond === 42.5, 'Observability benchmark: benchmark captures request rate');
    ok(benchmark.successRate === 0.9985, 'Observability benchmark: benchmark captures success rate');
    ok(benchmark.p95LatencyMs === 480, 'Observability benchmark: benchmark captures p95 latency');
    ok(routes.length === 2 && routes[0].route === '/api/v1/pipeline/run', 'Observability benchmark: hot route summary is emitted');
    ok(alerts.critical === 1 && alerts.warning === 1 && alerts.total === 2, 'Observability benchmark: alert summary is emitted');
    ok(readme.includes('render:observability-profile') && readme.includes('15m'), 'Observability benchmark: README carries next-step guidance');
    ok(benchmark.source.prometheusUrl.includes(`:${prometheusPort}`), 'Observability benchmark: source summary captures Prometheus URL');
    ok(directBenchmark.activeAlerts.total === 2, 'Observability benchmark: direct return value reports active alert count');

    console.log(`\nObservability benchmark tests: ${passed} passed, 0 failed`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolveClose) => prometheusServer.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => alertmanagerServer.close(() => resolveClose()));
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\nObservability benchmark tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
