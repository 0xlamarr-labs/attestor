import { strict as assert } from 'node:assert';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import {
  appendStructuredRequestLog,
  beginRequestTrace,
  completeRequestTrace,
  forceFlushTelemetry,
  getTelemetryStatus,
  initializeTelemetry,
  observeBillingWebhookEvent,
  observeRequestComplete,
  observeRequestStart,
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
    OTEL_LOGS_EXPORTER: process.env.OTEL_LOGS_EXPORTER,
    OTEL_TRACES_EXPORTER: process.env.OTEL_TRACES_EXPORTER,
    OTEL_METRICS_EXPORTER: process.env.OTEL_METRICS_EXPORTER,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL,
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL,
    OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL,
    OTEL_METRIC_EXPORT_INTERVAL: process.env.OTEL_METRIC_EXPORT_INTERVAL,
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
    process.env.OTEL_METRICS_EXPORTER = 'otlp';
    process.env.OTEL_LOGS_EXPORTER = 'otlp';
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = `http://127.0.0.1:${collectorPort}/v1/logs`;
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${collectorPort}/v1/traces`;
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = `http://127.0.0.1:${collectorPort}/v1/metrics`;
    process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = 'http/protobuf';
    process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = 'http/protobuf';
    process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = 'http/protobuf';
    process.env.OTEL_METRIC_EXPORT_INTERVAL = '200';
    process.env.OTEL_SERVICE_NAME = 'attestor-live-otlp-test';

    const telemetry = initializeTelemetry('0.1.0');

    console.log('\n[Live OTLP Export]');

    ok(telemetry.enabled === true, 'OTLP: telemetry initializes enabled');
    ok(telemetry.logs.enabled === true, 'OTLP: logs enabled');
    ok(telemetry.traces.enabled === true, 'OTLP: traces enabled');
    ok(telemetry.metrics.enabled === true, 'OTLP: metrics enabled');
    ok(telemetry.logs.endpoint === `http://127.0.0.1:${collectorPort}/v1/logs`, 'OTLP: logs endpoint matches local collector');
    ok(telemetry.traces.endpoint === `http://127.0.0.1:${collectorPort}/v1/traces`, 'OTLP: trace endpoint matches local collector');
    ok(telemetry.metrics.endpoint === `http://127.0.0.1:${collectorPort}/v1/metrics`, 'OTLP: metrics endpoint matches local collector');
    ok(telemetry.serviceName === 'attestor-live-otlp-test', 'OTLP: service name propagated');

    observeRequestStart();
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
    observeRequestComplete({
      route: '/api/v1/health',
      method: 'GET',
      statusCode: 200,
      durationSeconds: 0.012,
      traceContextStatus: 'present',
    });
    observeBillingWebhookEvent('invoice.paid', 'applied');
    appendStructuredRequestLog({
      occurredAt: new Date().toISOString(),
      route: '/api/v1/health',
      path: '/api/v1/health',
      method: 'GET',
      statusCode: 200,
      durationMs: 12,
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
      traceFlags: trace.traceFlags,
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
    await waitFor(() => (
      collectorRequests.some((request) => request.path === '/v1/logs')
      && collectorRequests.some((request) => request.path === '/v1/traces')
      && collectorRequests.some((request) => request.path === '/v1/metrics')
    ));

    const logsExportRequest = collectorRequests.find((request) => request.path === '/v1/logs');
    const traceExportRequest = collectorRequests.find((request) => request.path === '/v1/traces');
    const metricsExportRequest = collectorRequests.find((request) => request.path === '/v1/metrics');
    ok(!!logsExportRequest, 'OTLP: collector received logs export');
    ok(!!traceExportRequest, 'OTLP: collector received trace export');
    ok(!!metricsExportRequest, 'OTLP: collector received metrics export');
    ok(logsExportRequest?.method === 'POST', 'OTLP: collector received logs POST export');
    ok(traceExportRequest?.method === 'POST', 'OTLP: collector received trace POST export');
    ok(metricsExportRequest?.method === 'POST', 'OTLP: collector received metrics POST export');
    ok(
      typeof logsExportRequest?.contentType === 'string' && logsExportRequest.contentType.includes('application/x-protobuf'),
      'OTLP: logs export received protobuf content type',
    );
    ok(
      typeof traceExportRequest?.contentType === 'string' && traceExportRequest.contentType.includes('application/x-protobuf'),
      'OTLP: trace export received protobuf content type',
    );
    ok(
      typeof metricsExportRequest?.contentType === 'string' && metricsExportRequest.contentType.includes('application/x-protobuf'),
      'OTLP: metrics export received protobuf content type',
    );
    ok((logsExportRequest?.bodyLength ?? 0) > 0, 'OTLP: collector received non-empty logs payload');
    ok((traceExportRequest?.bodyLength ?? 0) > 0, 'OTLP: collector received non-empty trace payload');
    ok((metricsExportRequest?.bodyLength ?? 0) > 0, 'OTLP: collector received non-empty metrics payload');

    console.log(`  Live OTLP tests: ${passed} passed, 0 failed`);
  } finally {
    await shutdownTelemetry().catch(() => {});
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    if (previousEnv.OTEL_LOGS_EXPORTER === undefined) delete process.env.OTEL_LOGS_EXPORTER; else process.env.OTEL_LOGS_EXPORTER = previousEnv.OTEL_LOGS_EXPORTER;
    if (previousEnv.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT === undefined) delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT; else process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = previousEnv.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    if (previousEnv.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL === undefined) delete process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL; else process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = previousEnv.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL;
    if (previousEnv.OTEL_TRACES_EXPORTER === undefined) delete process.env.OTEL_TRACES_EXPORTER; else process.env.OTEL_TRACES_EXPORTER = previousEnv.OTEL_TRACES_EXPORTER;
    if (previousEnv.OTEL_METRICS_EXPORTER === undefined) delete process.env.OTEL_METRICS_EXPORTER; else process.env.OTEL_METRICS_EXPORTER = previousEnv.OTEL_METRICS_EXPORTER;
    if (previousEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT; else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = previousEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    if (previousEnv.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT === undefined) delete process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT; else process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = previousEnv.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    if (previousEnv.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL; else process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = previousEnv.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL;
    if (previousEnv.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL === undefined) delete process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL; else process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = previousEnv.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL;
    if (previousEnv.OTEL_METRIC_EXPORT_INTERVAL === undefined) delete process.env.OTEL_METRIC_EXPORT_INTERVAL; else process.env.OTEL_METRIC_EXPORT_INTERVAL = previousEnv.OTEL_METRIC_EXPORT_INTERVAL;
    if (previousEnv.OTEL_SERVICE_NAME === undefined) delete process.env.OTEL_SERVICE_NAME; else process.env.OTEL_SERVICE_NAME = previousEnv.OTEL_SERVICE_NAME;
  }
}

main().catch((error) => {
  console.error('\nLive OTLP tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
