/**
 * Observability — Structured request logs, Prometheus metrics, and trace correlation.
 *
 * BOUNDARY:
 * - In-process metrics registry with Prometheus text exposition
 * - W3C trace-context-compatible request correlation headers
 * - Local JSONL structured request log when configured
 * - Optional OTLP trace + metrics + logs export over HTTP/protobuf
 * - No bundled collector or full distributed trace/log backend yet
 */

import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, TraceFlags, trace, type Counter, type Histogram, type ObservableGauge, type Span } from '@opentelemetry/api';
import { logs as otelLogsApi, SeverityNumber, type Logger as OtelLogger } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider as SdkLoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_CLIENT_ADDRESS,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_USER_AGENT_ORIGINAL,
} from '@opentelemetry/semantic-conventions';

const HTTP_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

type TraceContextStatus = 'present' | 'absent' | 'invalid';
type BillingWebhookMetricOutcome = 'applied' | 'ignored' | 'duplicate' | 'conflict' | 'signature_invalid';

export interface RequestTraceContext {
  traceId: string;
  parentSpanId: string | null;
  spanId: string;
  traceFlags: string;
  incomingStatus: TraceContextStatus;
  responseTraceparent: string;
  span: Span | null;
}

export interface BeginRequestTraceInput {
  method: string;
  path: string;
  url: string;
  remoteAddress: string | null;
  userAgent: string | null;
  serverAddress: string | null;
  serverPort: number | null;
}

export interface CompleteRequestTraceInput {
  route: string;
  method: string;
  path: string;
  statusCode: number;
  durationSeconds: number;
  tenantId: string | null;
  planId: string | null;
  accountId: string | null;
  accountStatus: string | null;
  rateLimited: boolean;
  quotaRejected: boolean;
  remoteAddress: string | null;
  userAgent: string | null;
  error?: unknown;
}

export interface HttpObservation {
  route: string;
  method: string;
  statusCode: number;
  durationSeconds: number;
  traceContextStatus: TraceContextStatus;
}

export interface StructuredRequestLogRecord {
  occurredAt: string;
  route: string;
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceFlags: string;
  tenantId: string | null;
  planId: string | null;
  accountId: string | null;
  accountStatus: string | null;
  rateLimited: boolean;
  quotaRejected: boolean;
  remoteAddress: string | null;
  userAgent: string | null;
}

interface DurationHistogramState {
  count: number;
  sum: number;
  bucketCounts: number[];
}

interface ParsedTraceparent {
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
}

interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  logs: {
    enabled: boolean;
    protocol: string | null;
    endpoint: string | null;
    headers: Record<string, string>;
    timeoutMillis: number | null;
    disabledReason: string | null;
  };
  traces: {
    enabled: boolean;
    protocol: string | null;
    endpoint: string | null;
    headers: Record<string, string>;
    timeoutMillis: number | null;
    disabledReason: string | null;
  };
  metrics: {
    enabled: boolean;
    protocol: string | null;
    endpoint: string | null;
    headers: Record<string, string>;
    timeoutMillis: number | null;
    exportIntervalMillis: number | null;
    disabledReason: string | null;
  };
}

export interface TelemetrySignalStatus {
  enabled: boolean;
  protocol: string | null;
  endpoint: string | null;
  timeoutMillis: number | null;
  disabledReason: string | null;
}

export interface TelemetryMetricsStatus extends TelemetrySignalStatus {
  exportIntervalMillis: number | null;
}

export interface TelemetryStatus {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  disabledReason: string | null;
  logs: TelemetrySignalStatus;
  traces: TelemetrySignalStatus;
  metrics: TelemetryMetricsStatus;
}

const httpRequestCounts = new Map<string, number>();
const httpRequestDuration = new Map<string, DurationHistogramState>();
const traceContextCounts = new Map<TraceContextStatus, number>();
const billingWebhookCounts = new Map<string, number>();
let inFlightRequests = 0;
let telemetryInitialized = false;
let telemetryProvider: NodeTracerProvider | null = null;
let telemetryLoggerProvider: SdkLoggerProvider | null = null;
let telemetryMeterProvider: MeterProvider | null = null;
let telemetryRequestLogger: OtelLogger | null = null;
let telemetryHttpRequestCounter: Counter | null = null;
let telemetryHttpRequestDurationHistogram: Histogram | null = null;
let telemetryTraceContextCounter: Counter | null = null;
let telemetryBillingWebhookCounter: Counter | null = null;
let telemetryInFlightGauge: ObservableGauge | null = null;
let telemetryStatus: TelemetryStatus = {
  enabled: false,
  serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'attestor-api',
  serviceVersion: process.env.ATTESTOR_SERVICE_VERSION?.trim() || '0.1.0',
  serviceInstanceId: process.env.OTEL_SERVICE_INSTANCE_ID?.trim() || process.env.HOSTNAME?.trim() || process.env.COMPUTERNAME?.trim() || os.hostname(),
  disabledReason: 'Telemetry not initialized.',
  logs: {
    enabled: false,
    protocol: null,
    endpoint: null,
    timeoutMillis: null,
    disabledReason: 'Telemetry not initialized.',
  },
  traces: {
    enabled: false,
    protocol: null,
    endpoint: null,
    timeoutMillis: null,
    disabledReason: 'Telemetry not initialized.',
  },
  metrics: {
    enabled: false,
    protocol: null,
    endpoint: null,
    timeoutMillis: null,
    exportIntervalMillis: null,
    disabledReason: 'Telemetry not initialized.',
  },
};

function logPath(): string | null {
  const configured = process.env.ATTESTOR_OBSERVABILITY_LOG_PATH?.trim();
  return configured ? resolve(configured) : null;
}

function nextHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function nonZeroHex(bytes: number): string {
  let value = nextHex(bytes);
  while (/^0+$/.test(value)) {
    value = nextHex(bytes);
  }
  return value;
}

function parseTraceparent(header: string | undefined): ParsedTraceparent | null {
  if (!header) return null;
  const value = header.trim().toLowerCase();
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(?:-.*)?$/.exec(value);
  if (!match) return null;
  const [, version, traceId, parentSpanId, traceFlags] = match;
  if (version !== '00') return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return null;
  return { traceId, parentSpanId, traceFlags };
}

function labelEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function labels(input: Record<string, string>): string {
  const parts = Object.entries(input).map(([key, value]) => `${key}="${labelEscape(value)}"`);
  return `{${parts.join(',')}}`;
}

function incrementMetric(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function durationState(key: string): DurationHistogramState {
  const existing = httpRequestDuration.get(key);
  if (existing) return existing;
  const created: DurationHistogramState = {
    count: 0,
    sum: 0,
    bucketCounts: HTTP_DURATION_BUCKETS.map(() => 0),
  };
  httpRequestDuration.set(key, created);
  return created;
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

function parsePositiveInteger(raw: string | undefined): number | null {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveTraceExporterConfig(): TelemetryConfig['traces'] {
  const protocol = (
    process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL?.trim()
    || process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()
    || 'http/protobuf'
  ).toLowerCase();

  if (protocol !== 'http/protobuf') {
    return {
      enabled: false,
      protocol,
      endpoint: null,
      headers: {},
      timeoutMillis: null,
      disabledReason: `Unsupported OTLP traces protocol '${protocol}'. Only http/protobuf is supported in this first slice.`,
    };
  }

  const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
    || process.env.ATTESTOR_OTLP_TRACES_ENDPOINT?.trim()
    || null;
  const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || null;
  const exporterSetting = process.env.OTEL_TRACES_EXPORTER?.trim().toLowerCase() || '';
  const enabled = explicitEndpoint !== null || baseEndpoint !== null || exporterSetting === 'otlp';
  const endpoint = explicitEndpoint
    ?? (baseEndpoint ? `${baseEndpoint.replace(/\/+$/, '')}/v1/traces` : null)
    ?? (enabled ? 'http://127.0.0.1:4318/v1/traces' : null);

  return {
    enabled: enabled && endpoint !== null,
    protocol,
    endpoint,
    headers: {
      ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
      ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
    },
    timeoutMillis: parsePositiveInteger(process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT)
      ?? parsePositiveInteger(process.env.OTEL_EXPORTER_OTLP_TIMEOUT),
    disabledReason: enabled ? null : 'No OTLP trace exporter endpoint configured.',
  };
}

function resolveLogsExporterConfig(): TelemetryConfig['logs'] {
  const protocol = (
    process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL?.trim()
    || process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()
    || 'http/protobuf'
  ).toLowerCase();

  if (protocol !== 'http/protobuf') {
    return {
      enabled: false,
      protocol,
      endpoint: null,
      headers: {},
      timeoutMillis: null,
      disabledReason: `Unsupported OTLP logs protocol '${protocol}'. Only http/protobuf is supported in this first slice.`,
    };
  }

  const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim()
    || process.env.ATTESTOR_OTLP_LOGS_ENDPOINT?.trim()
    || null;
  const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || null;
  const exporterSetting = process.env.OTEL_LOGS_EXPORTER?.trim().toLowerCase() || '';
  const enabled = explicitEndpoint !== null || baseEndpoint !== null || exporterSetting === 'otlp';
  const endpoint = explicitEndpoint
    ?? (baseEndpoint ? `${baseEndpoint.replace(/\/+$/, '')}/v1/logs` : null)
    ?? (enabled ? 'http://127.0.0.1:4318/v1/logs' : null);

  return {
    enabled: enabled && endpoint !== null,
    protocol,
    endpoint,
    headers: {
      ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
      ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS),
    },
    timeoutMillis: parsePositiveInteger(process.env.OTEL_EXPORTER_OTLP_LOGS_TIMEOUT)
      ?? parsePositiveInteger(process.env.OTEL_EXPORTER_OTLP_TIMEOUT),
    disabledReason: enabled ? null : 'No OTLP logs exporter endpoint configured.',
  };
}

function resolveMetricsExporterConfig(): TelemetryConfig['metrics'] {
  const protocol = (
    process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL?.trim()
    || process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()
    || 'http/protobuf'
  ).toLowerCase();

  if (protocol !== 'http/protobuf') {
    return {
      enabled: false,
      protocol,
      endpoint: null,
      headers: {},
      timeoutMillis: null,
      exportIntervalMillis: null,
      disabledReason: `Unsupported OTLP metrics protocol '${protocol}'. Only http/protobuf is supported in this first slice.`,
    };
  }

  const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim()
    || process.env.ATTESTOR_OTLP_METRICS_ENDPOINT?.trim()
    || null;
  const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || null;
  const exporterSetting = process.env.OTEL_METRICS_EXPORTER?.trim().toLowerCase() || '';
  const enabled = explicitEndpoint !== null || baseEndpoint !== null || exporterSetting === 'otlp';
  const endpoint = explicitEndpoint
    ?? (baseEndpoint ? `${baseEndpoint.replace(/\/+$/, '')}/v1/metrics` : null)
    ?? (enabled ? 'http://127.0.0.1:4318/v1/metrics' : null);

  return {
    enabled: enabled && endpoint !== null,
    protocol,
    endpoint,
    headers: {
      ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
      ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS),
    },
    timeoutMillis: parsePositiveInteger(process.env.OTEL_EXPORTER_OTLP_METRICS_TIMEOUT)
      ?? parsePositiveInteger(process.env.OTEL_EXPORTER_OTLP_TIMEOUT)
      ?? parsePositiveInteger(process.env.OTEL_METRIC_EXPORT_TIMEOUT),
    exportIntervalMillis: parsePositiveInteger(process.env.OTEL_METRIC_EXPORT_INTERVAL) ?? 1000,
    disabledReason: enabled ? null : 'No OTLP metrics exporter endpoint configured.',
  };
}

function resolveTelemetryConfig(serviceVersion = '0.1.0'): TelemetryConfig {
  return {
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'attestor-api',
    serviceVersion,
    serviceInstanceId: process.env.OTEL_SERVICE_INSTANCE_ID?.trim() || process.env.HOSTNAME?.trim() || process.env.COMPUTERNAME?.trim() || os.hostname(),
    logs: resolveLogsExporterConfig(),
    traces: resolveTraceExporterConfig(),
    metrics: resolveMetricsExporterConfig(),
  };
}

export function initializeTelemetry(serviceVersion = '0.1.0'): TelemetryStatus {
  if (telemetryInitialized) return telemetryStatus;
  telemetryInitialized = true;
  const config = resolveTelemetryConfig(serviceVersion);
  const enabled = config.logs.enabled || config.traces.enabled || config.metrics.enabled;
  const metricsExportIntervalMillis = config.metrics.exportIntervalMillis ?? 1000;
  const metricsExportTimeoutMillis = Math.min(
    config.metrics.timeoutMillis ?? metricsExportIntervalMillis,
    metricsExportIntervalMillis,
  );
  telemetryStatus = {
    enabled,
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    serviceInstanceId: config.serviceInstanceId,
    disabledReason: enabled
      ? null
      : [config.logs.disabledReason, config.traces.disabledReason, config.metrics.disabledReason].filter(Boolean).join(' / '),
    logs: {
      enabled: config.logs.enabled,
      protocol: config.logs.enabled ? config.logs.protocol : null,
      endpoint: config.logs.enabled ? config.logs.endpoint : null,
      timeoutMillis: config.logs.timeoutMillis,
      disabledReason: config.logs.disabledReason,
    },
    traces: {
      enabled: config.traces.enabled,
      protocol: config.traces.enabled ? config.traces.protocol : null,
      endpoint: config.traces.enabled ? config.traces.endpoint : null,
      timeoutMillis: config.traces.timeoutMillis,
      disabledReason: config.traces.disabledReason,
    },
    metrics: {
      enabled: config.metrics.enabled,
      protocol: config.metrics.enabled ? config.metrics.protocol : null,
      endpoint: config.metrics.enabled ? config.metrics.endpoint : null,
      timeoutMillis: config.metrics.enabled ? metricsExportTimeoutMillis : null,
      exportIntervalMillis: config.metrics.enabled ? metricsExportIntervalMillis : null,
      disabledReason: config.metrics.disabledReason,
    },
  };
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    [ATTR_SERVICE_INSTANCE_ID]: config.serviceInstanceId,
  });

  if (config.logs.enabled && config.logs.endpoint) {
    const exporter = new OTLPLogExporter({
      url: config.logs.endpoint,
      headers: config.logs.headers,
      timeoutMillis: config.logs.timeoutMillis ?? undefined,
    });
    const provider = new SdkLoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor(exporter)],
    });
    otelLogsApi.setGlobalLoggerProvider(provider);
    telemetryLoggerProvider = provider;
    telemetryRequestLogger = provider.getLogger('attestor-api');
  }

  if (config.traces.enabled && config.traces.endpoint) {
    const exporter = new OTLPTraceExporter({
      url: config.traces.endpoint,
      headers: config.traces.headers,
      timeoutMillis: config.traces.timeoutMillis ?? undefined,
    });

    const provider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    provider.register();
    telemetryProvider = provider;
  }

  if (config.metrics.enabled && config.metrics.endpoint) {
    const exporter = new OTLPMetricExporter({
      url: config.metrics.endpoint,
      headers: config.metrics.headers,
      timeoutMillis: metricsExportTimeoutMillis,
    });
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: metricsExportIntervalMillis,
      exportTimeoutMillis: metricsExportTimeoutMillis,
    });
    const meterProvider = new MeterProvider({
      resource,
      readers: [reader],
    });
    const meter = meterProvider.getMeter('attestor-api');
    telemetryHttpRequestCounter = meter.createCounter('attestor.http.requests', {
      description: 'Total completed HTTP API requests.',
    });
    telemetryHttpRequestDurationHistogram = meter.createHistogram('attestor.http.request.duration', {
      description: 'HTTP request duration in seconds.',
      unit: 's',
    });
    telemetryTraceContextCounter = meter.createCounter('attestor.http.trace_context.requests', {
      description: 'Inbound request trace-context validity.',
    });
    telemetryBillingWebhookCounter = meter.createCounter('attestor.billing.webhook.events', {
      description: 'Stripe webhook outcomes recorded by the service.',
    });
    telemetryInFlightGauge = meter.createObservableGauge('attestor.http.in_flight_requests', {
      description: 'Current in-flight HTTP API requests.',
    });
    telemetryInFlightGauge.addCallback((observableResult) => {
      observableResult.observe(inFlightRequests);
    });
    telemetryMeterProvider = meterProvider;
  }

  return telemetryStatus;
}

export async function forceFlushTelemetry(): Promise<void> {
  if (telemetryLoggerProvider) {
    await telemetryLoggerProvider.forceFlush();
  }
  if (telemetryProvider) {
    await telemetryProvider.forceFlush();
  }
  if (telemetryMeterProvider) {
    await telemetryMeterProvider.forceFlush();
  }
}

export async function shutdownTelemetry(): Promise<void> {
  const loggerProvider = telemetryLoggerProvider;
  const provider = telemetryProvider;
  const meterProvider = telemetryMeterProvider;
  telemetryLoggerProvider = null;
  telemetryProvider = null;
  telemetryMeterProvider = null;
  telemetryRequestLogger = null;
  telemetryHttpRequestCounter = null;
  telemetryHttpRequestDurationHistogram = null;
  telemetryTraceContextCounter = null;
  telemetryBillingWebhookCounter = null;
  telemetryInFlightGauge = null;
  telemetryInitialized = false;
  telemetryStatus = {
    enabled: false,
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'attestor-api',
    serviceVersion: process.env.ATTESTOR_SERVICE_VERSION?.trim() || '0.1.0',
    serviceInstanceId: process.env.OTEL_SERVICE_INSTANCE_ID?.trim() || process.env.HOSTNAME?.trim() || process.env.COMPUTERNAME?.trim() || os.hostname(),
    disabledReason: 'Telemetry not initialized.',
    logs: {
      enabled: false,
      protocol: null,
      endpoint: null,
      timeoutMillis: null,
      disabledReason: 'Telemetry not initialized.',
    },
    traces: {
      enabled: false,
      protocol: null,
      endpoint: null,
      timeoutMillis: null,
      disabledReason: 'Telemetry not initialized.',
    },
    metrics: {
      enabled: false,
      protocol: null,
      endpoint: null,
      timeoutMillis: null,
      exportIntervalMillis: null,
      disabledReason: 'Telemetry not initialized.',
    },
  };
  if (loggerProvider) {
    await loggerProvider.shutdown();
  }
  otelLogsApi.disable();
  if (provider) {
    await provider.shutdown();
  }
  if (meterProvider) {
    await meterProvider.shutdown();
  }
}

export function getTelemetryStatus(): TelemetryStatus {
  return telemetryStatus;
}

export function beginRequestTrace(
  traceparentHeader: string | undefined,
  input: BeginRequestTraceInput,
): RequestTraceContext {
  const incoming = parseTraceparent(traceparentHeader);
  let traceId = incoming?.traceId ?? nonZeroHex(16);
  const parentSpanId = incoming?.parentSpanId ?? null;
  let spanId = nonZeroHex(8);
  let traceFlags = incoming?.traceFlags ?? '01';
  let span: Span | null = null;

  if (telemetryStatus.traces.enabled) {
    const tracer = trace.getTracer('attestor-api');
    const parentContext = incoming
      ? trace.setSpanContext(ROOT_CONTEXT, {
        traceId: incoming.traceId,
        spanId: incoming.parentSpanId,
        traceFlags: incoming.traceFlags === '00' ? TraceFlags.NONE : TraceFlags.SAMPLED,
        isRemote: true,
      })
      : ROOT_CONTEXT;
    span = tracer.startSpan(
      `${input.method} ${input.path}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          [ATTR_HTTP_REQUEST_METHOD]: input.method,
          [ATTR_URL_PATH]: input.path,
          [ATTR_URL_FULL]: input.url,
          ...(input.remoteAddress ? { [ATTR_CLIENT_ADDRESS]: input.remoteAddress } : {}),
          ...(input.userAgent ? { [ATTR_USER_AGENT_ORIGINAL]: input.userAgent } : {}),
          ...(input.serverAddress ? { [ATTR_SERVER_ADDRESS]: input.serverAddress } : {}),
          ...(input.serverPort !== null ? { [ATTR_SERVER_PORT]: input.serverPort } : {}),
        },
      },
      parentContext,
    );
    const context = span.spanContext();
    traceId = context.traceId;
    spanId = context.spanId;
    traceFlags = context.traceFlags.toString(16).padStart(2, '0');
  }

  return {
    traceId,
    parentSpanId,
    spanId,
    traceFlags,
    incomingStatus: traceparentHeader ? (incoming ? 'present' : 'invalid') : 'absent',
    responseTraceparent: `00-${traceId}-${spanId}-${traceFlags}`,
    span,
  };
}

export function completeRequestTrace(
  traceContext: RequestTraceContext,
  input: CompleteRequestTraceInput,
): void {
  const span = traceContext.span;
  if (!span) return;
  span.updateName(`${input.method} ${input.route}`);
  span.setAttribute(ATTR_HTTP_ROUTE, input.route);
  span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, input.statusCode);
  if (input.remoteAddress) span.setAttribute(ATTR_CLIENT_ADDRESS, input.remoteAddress);
  if (input.userAgent) span.setAttribute(ATTR_USER_AGENT_ORIGINAL, input.userAgent);
  if (input.tenantId) span.setAttribute('attestor.tenant.id', input.tenantId);
  if (input.planId) span.setAttribute('attestor.plan.id', input.planId);
  if (input.accountId) span.setAttribute('attestor.account.id', input.accountId);
  if (input.accountStatus) span.setAttribute('attestor.account.status', input.accountStatus);
  span.setAttribute('attestor.rate_limited', input.rateLimited);
  span.setAttribute('attestor.quota_rejected', input.quotaRejected);
  span.setAttribute('attestor.duration_ms', Math.round(input.durationSeconds * 1000));

  if (input.error instanceof Error) {
    span.recordException(input.error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: input.error.message });
  } else if (input.statusCode >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${input.statusCode}` });
  }

  span.end();
}

export function observeRequestStart(): void {
  inFlightRequests += 1;
}

export function observeRequestComplete(input: HttpObservation): void {
  inFlightRequests = Math.max(0, inFlightRequests - 1);
  incrementMetric(
    httpRequestCounts,
    `${input.method}|${input.route}|${input.statusCode}`,
  );
  incrementMetric(traceContextCounts as unknown as Map<string, number>, input.traceContextStatus);
  telemetryHttpRequestCounter?.add(1, {
    method: input.method,
    route: input.route,
    status_code: String(input.statusCode),
  });
  telemetryHttpRequestDurationHistogram?.record(input.durationSeconds, {
    method: input.method,
    route: input.route,
  });
  telemetryTraceContextCounter?.add(1, {
    status: input.traceContextStatus,
  });

  const state = durationState(`${input.method}|${input.route}`);
  state.count += 1;
  state.sum += input.durationSeconds;
  HTTP_DURATION_BUCKETS.forEach((bucket, index) => {
    if (input.durationSeconds <= bucket) {
      state.bucketCounts[index] += 1;
    }
  });
}

export function observeBillingWebhookEvent(eventType: string, outcome: BillingWebhookMetricOutcome): void {
  incrementMetric(billingWebhookCounts, `${eventType}|${outcome}`);
  telemetryBillingWebhookCounter?.add(1, {
    event_type: eventType,
    outcome,
  });
}

export function appendStructuredRequestLog(record: StructuredRequestLogRecord): void {
  if (telemetryRequestLogger) {
    const severity = record.statusCode >= 500
      ? { number: SeverityNumber.ERROR, text: 'ERROR' }
      : record.statusCode >= 400
        ? { number: SeverityNumber.WARN, text: 'WARN' }
        : { number: SeverityNumber.INFO, text: 'INFO' };
    const traceFlags = record.traceFlags === '00' ? TraceFlags.NONE : TraceFlags.SAMPLED;
    telemetryRequestLogger.emit({
      eventName: 'attestor.http.request',
      severityNumber: severity.number,
      severityText: severity.text,
      body: `${record.method} ${record.route} -> ${record.statusCode}`,
      attributes: {
        'attestor.occurred_at': record.occurredAt,
        'attestor.http.route': record.route,
        'attestor.http.path': record.path,
        'attestor.http.method': record.method,
        'attestor.http.status_code': record.statusCode,
        'attestor.http.duration_ms': record.durationMs,
        'attestor.trace.id': record.traceId,
        'attestor.trace.span_id': record.spanId,
        ...(record.parentSpanId ? { 'attestor.trace.parent_span_id': record.parentSpanId } : {}),
        ...(record.tenantId ? { 'attestor.tenant.id': record.tenantId } : {}),
        ...(record.planId ? { 'attestor.plan.id': record.planId } : {}),
        ...(record.accountId ? { 'attestor.account.id': record.accountId } : {}),
        ...(record.accountStatus ? { 'attestor.account.status': record.accountStatus } : {}),
        ...(record.remoteAddress ? { 'client.address': record.remoteAddress } : {}),
        ...(record.userAgent ? { 'user_agent.original': record.userAgent } : {}),
        'attestor.rate_limited': record.rateLimited,
        'attestor.quota_rejected': record.quotaRejected,
      },
      context: trace.setSpanContext(ROOT_CONTEXT, {
        traceId: record.traceId,
        spanId: record.spanId,
        traceFlags,
        isRemote: false,
      }),
    });
  }

  const path = logPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

export function renderPrometheusMetrics(version: string): string {
  const lines: string[] = [];

  lines.push('# HELP attestor_build_info Static build info for the running Attestor service.');
  lines.push('# TYPE attestor_build_info gauge');
  lines.push(`attestor_build_info${labels({ version })} 1`);

  lines.push('# HELP attestor_http_in_flight_requests Current in-flight HTTP API requests.');
  lines.push('# TYPE attestor_http_in_flight_requests gauge');
  lines.push(`attestor_http_in_flight_requests ${inFlightRequests}`);

  lines.push('# HELP attestor_http_requests_total Total completed HTTP API requests.');
  lines.push('# TYPE attestor_http_requests_total counter');
  for (const [key, value] of [...httpRequestCounts.entries()].sort()) {
    const [method, route, statusCode] = key.split('|');
    lines.push(`attestor_http_requests_total${labels({ method, route, status_code: statusCode })} ${value}`);
  }

  lines.push('# HELP attestor_http_request_duration_seconds HTTP request latency histogram.');
  lines.push('# TYPE attestor_http_request_duration_seconds histogram');
  for (const [key, state] of [...httpRequestDuration.entries()].sort()) {
    const [method, route] = key.split('|');
    HTTP_DURATION_BUCKETS.forEach((bucket, index) => {
      lines.push(`attestor_http_request_duration_seconds_bucket${labels({ method, route, le: String(bucket) })} ${state.bucketCounts[index]}`);
    });
    lines.push(`attestor_http_request_duration_seconds_bucket${labels({ method, route, le: '+Inf' })} ${state.count}`);
    lines.push(`attestor_http_request_duration_seconds_sum${labels({ method, route })} ${state.sum}`);
    lines.push(`attestor_http_request_duration_seconds_count${labels({ method, route })} ${state.count}`);
  }

  lines.push('# HELP attestor_trace_context_requests_total Inbound request trace-context validity.');
  lines.push('# TYPE attestor_trace_context_requests_total counter');
  for (const status of ['present', 'absent', 'invalid'] as const) {
    lines.push(`attestor_trace_context_requests_total${labels({ status })} ${traceContextCounts.get(status) ?? 0}`);
  }

  lines.push('# HELP attestor_billing_webhook_events_total Stripe webhook outcomes recorded by the service.');
  lines.push('# TYPE attestor_billing_webhook_events_total counter');
  for (const [key, value] of [...billingWebhookCounts.entries()].sort()) {
    const [eventType, outcome] = key.split('|');
    lines.push(`attestor_billing_webhook_events_total${labels({ event_type: eventType, outcome })} ${value}`);
  }

  return `${lines.join('\n')}\n`;
}

export function resetObservabilityForTests(): void {
  httpRequestCounts.clear();
  httpRequestDuration.clear();
  traceContextCounts.clear();
  billingWebhookCounts.clear();
  inFlightRequests = 0;
  const path = logPath();
  if (path && existsSync(path)) {
    rmSync(path, { force: true });
  }
}
