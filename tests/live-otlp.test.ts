import { strict as assert } from 'node:assert';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import {
  beginRequestTrace,
  completeRequestTrace,
  forceFlushTelemetry,
  getTelemetryStatus,
  initializeTelemetry,
  resetObservabilityForTests,
  shutdownTelemetry,
} from '../src/service/observability.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

async function listen(server: ReturnType<typeof createHttpServer>, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if ((Date.now() - started) > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for OTLP export.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

interface CapturedCollectorRequest {
  method: string;
  path: string;
  contentType: string | undefined;
  bodyLength: number;
}

async function main(): Promise<void> {
  const previousEnv = {
    OTEL_TRACES_EXPORTER: process.env.OTEL_TRACES_EXPORTER,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
  };

  const collectorRequests: CapturedCollectorRequest[] = [];
  const collector = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      collectorRequests.push({
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        contentType: req.headers['content-type'],
        bodyLength: Buffer.concat(chunks).length,
      });
      res.statusCode = 200;
      res.end('ok');
    });
  });

  const collectorPort = await reservePort();

  try {
    await listen(collector, collectorPort);
    resetObservabilityForTests();

    process.env.OTEL_TRACES_EXPORTER = 'otlp';
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${collectorPort}/v1/traces`;
    process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = 'http/protobuf';
    process.env.OTEL_SERVICE_NAME = 'attestor-live-otlp-test';

    const telemetry = initializeTelemetry('0.1.0');

    console.log('\n[Live OTLP Export]');

    ok(telemetry.enabled === true, 'OTLP: telemetry initializes enabled');
    ok(telemetry.endpoint === `http://127.0.0.1:${collectorPort}/v1/traces`, 'OTLP: endpoint matches local collector');
    ok(telemetry.serviceName === 'attestor-live-otlp-test', 'OTLP: service name propagated');

    const trace = beginRequestTrace('00-0123456789abcdef0123456789abcdef-0123456789abcdef-01', {
      method: 'GET',
      path: '/api/v1/health',
      url: 'http://127.0.0.1:3700/api/v1/health',
      remoteAddress: '127.0.0.1',
      userAgent: 'live-otlp-test',
      serverAddress: '127.0.0.1',
      serverPort: 3700,
    });
    ok(
      trace.responseTraceparent.startsWith('00-0123456789abcdef0123456789abcdef-'),
      'OTLP: response traceparent preserves incoming trace id',
    );

    completeRequestTrace(trace, {
      route: '/api/v1/health',
      method: 'GET',
      path: '/api/v1/health',
      statusCode: 200,
      durationSeconds: 0.012,
      tenantId: 'tenant-test',
      planId: 'starter',
      accountId: 'acct_test',
      accountStatus: 'active',
      rateLimited: false,
      quotaRejected: false,
      remoteAddress: '127.0.0.1',
      userAgent: 'live-otlp-test',
    });

    await forceFlushTelemetry();
    await waitFor(() => collectorRequests.length > 0);

    const exportRequest = collectorRequests[0];
    ok(exportRequest.method === 'POST', 'OTLP: collector received POST export');
    ok(exportRequest.path === '/v1/traces', 'OTLP: collector received /v1/traces path');
    ok(
      typeof exportRequest.contentType === 'string' && exportRequest.contentType.includes('application/x-protobuf'),
      'OTLP: collector received protobuf content type',
    );
    ok(exportRequest.bodyLength > 0, 'OTLP: collector received non-empty payload');

    console.log(`  Live OTLP tests: ${passed} passed, 0 failed`);
  } finally {
    await shutdownTelemetry().catch(() => {});
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    if (previousEnv.OTEL_TRACES_EXPORTER === undefined) delete process.env.OTEL_TRACES_EXPORTER; else process.env.OTEL_TRACES_EXPORTER = previousEnv.OTEL_TRACES_EXPORTER;
    if (previousEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT; else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = previousEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    if (previousEnv.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL; else process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = previousEnv.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL;
    if (previousEnv.OTEL_SERVICE_NAME === undefined) delete process.env.OTEL_SERVICE_NAME; else process.env.OTEL_SERVICE_NAME = previousEnv.OTEL_SERVICE_NAME;
  }
}

main().catch((error) => {
  console.error('\nLive OTLP tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
