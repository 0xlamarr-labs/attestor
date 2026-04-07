/**
 * Observability — Structured request logs, Prometheus metrics, and trace correlation.
 *
 * BOUNDARY:
 * - In-process metrics registry with Prometheus text exposition
 * - W3C trace-context-compatible request correlation headers
 * - Local JSONL structured request log when configured
 * - No external collector/exporter or full distributed tracing backend yet
 */

import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

const httpRequestCounts = new Map<string, number>();
const httpRequestDuration = new Map<string, DurationHistogramState>();
const traceContextCounts = new Map<TraceContextStatus, number>();
const billingWebhookCounts = new Map<string, number>();
let inFlightRequests = 0;

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

function parseTraceparent(header: string | undefined): {
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
} | null {
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

export function beginRequestTrace(traceparentHeader: string | undefined): RequestTraceContext {
  const incoming = parseTraceparent(traceparentHeader);
  const traceId = incoming?.traceId ?? nonZeroHex(16);
  const parentSpanId = incoming?.parentSpanId ?? null;
  const spanId = nonZeroHex(8);
  const traceFlags = incoming?.traceFlags ?? '01';
  return {
    traceId,
    parentSpanId,
    spanId,
    traceFlags,
    incomingStatus: traceparentHeader ? (incoming ? 'present' : 'invalid') : 'absent',
    responseTraceparent: `00-${traceId}-${spanId}-${traceFlags}`,
  };
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
}

export function appendStructuredRequestLog(record: StructuredRequestLogRecord): void {
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
