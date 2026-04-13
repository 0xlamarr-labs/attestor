import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  shutdownTelemetry,
} from '../src/service/observability.js';

type NullableString = string | null;

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

async function fetchJson<T>(url: string, authHeader: string | null): Promise<{ ok: boolean; status: number; body: T | null; error: string | null }> {
  try {
    const headers = new Headers();
    if (authHeader) headers.set('authorization', authHeader);
    const response = await fetch(url, { headers });
    const text = await response.text();
    let parsed: T | null = null;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        parsed = null;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body: parsed,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ReceiverProbeSummary {
  telemetry: ReturnType<typeof getTelemetryStatus> & {
    flushSucceeded: boolean;
    flushError: string | null;
  };
  prometheus: {
    configured: boolean;
    url: string | null;
    ok: boolean;
    status: number | null;
    error: string | null;
  };
  alertmanager: {
    configured: boolean;
    url: string | null;
    ok: boolean;
    status: number | null;
    error: string | null;
    activeAlerts: number | null;
  };
}

export async function probeObservabilityReceivers(options?: {
  prometheusUrl?: string | null;
  alertmanagerUrl?: string | null;
  outputDir?: string;
}): Promise<ReceiverProbeSummary> {
  const outputDir = resolve(options?.outputDir ?? arg('output-dir', '.attestor/observability/probe/latest')!);
  const prometheusUrl = options?.prometheusUrl ?? arg('prometheus-url', env('ATTESTOR_OBSERVABILITY_PROMETHEUS_URL') ?? env('PROMETHEUS_BASE_URL'));
  const alertmanagerUrl = options?.alertmanagerUrl ?? arg('alertmanager-url', env('ATTESTOR_OBSERVABILITY_ALERTMANAGER_URL') ?? env('ALERTMANAGER_BASE_URL'));

  const telemetry = initializeTelemetry('1.0.0');
  let flushSucceeded = false;
  let flushError: string | null = null;

  try {
    observeRequestStart();
    const trace = beginRequestTrace(undefined, {
      method: 'GET',
      path: '/api/v1/health',
      url: 'http://127.0.0.1:3700/api/v1/health',
      remoteAddress: '127.0.0.1',
      userAgent: 'observability-probe',
      serverAddress: '127.0.0.1',
      serverPort: 3700,
    });
    completeRequestTrace(trace, {
      route: '/api/v1/health',
      method: 'GET',
      path: '/api/v1/health',
      statusCode: 200,
      durationSeconds: 0.01,
      tenantId: 'probe',
      planId: 'enterprise',
      accountId: 'acct_probe',
      accountStatus: 'active',
      rateLimited: false,
      quotaRejected: false,
      remoteAddress: '127.0.0.1',
      userAgent: 'observability-probe',
    });
    observeRequestComplete({
      route: '/api/v1/health',
      method: 'GET',
      statusCode: 200,
      durationSeconds: 0.01,
      traceContextStatus: 'absent',
    });
    observeBillingWebhookEvent('invoice.paid', 'applied');
    appendStructuredRequestLog({
      occurredAt: new Date().toISOString(),
      route: '/api/v1/health',
      path: '/api/v1/health',
      method: 'GET',
      statusCode: 200,
      durationMs: 10,
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
      traceFlags: trace.traceFlags,
      tenantId: 'probe',
      planId: 'enterprise',
      accountId: 'acct_probe',
      accountStatus: 'active',
      rateLimited: false,
      quotaRejected: false,
      remoteAddress: '127.0.0.1',
      userAgent: 'observability-probe',
    });

    try {
      await forceFlushTelemetry();
      flushSucceeded = true;
    } catch (error) {
      flushSucceeded = false;
      flushError = error instanceof Error ? error.message : String(error);
    }

    const prometheusProbe = prometheusUrl
      ? await fetchJson<{ status?: string }>(
        new URL('/api/v1/query?query=vector(1)', prometheusUrl).toString(),
        headerValue('PROMETHEUS'),
      )
      : null;
    const alertmanagerProbe = alertmanagerUrl
      ? await fetchJson<Array<unknown>>(
        new URL('/api/v2/alerts', alertmanagerUrl).toString(),
        headerValue('ALERTMANAGER'),
      )
      : null;

    const summary: ReceiverProbeSummary = {
      telemetry: {
        ...getTelemetryStatus(),
        flushSucceeded,
        flushError,
      },
      prometheus: {
        configured: Boolean(prometheusUrl),
        url: prometheusUrl ?? null,
        ok: prometheusProbe?.ok ?? false,
        status: prometheusProbe ? prometheusProbe.status : null,
        error: prometheusProbe?.error ?? null,
      },
      alertmanager: {
        configured: Boolean(alertmanagerUrl),
        url: alertmanagerUrl ?? null,
        ok: alertmanagerProbe?.ok ?? false,
        status: alertmanagerProbe ? alertmanagerProbe.status : null,
        error: alertmanagerProbe?.error ?? null,
        activeAlerts: Array.isArray(alertmanagerProbe?.body) ? alertmanagerProbe!.body.length : null,
      },
    };

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    writeFileSync(
      resolve(outputDir, 'README.md'),
      `# Observability receiver probe

Generated from the current OTLP / Prometheus / Alertmanager environment.

- OTLP telemetry enabled: ${summary.telemetry.enabled}
- OTLP flush succeeded: ${summary.telemetry.flushSucceeded}
- Prometheus configured: ${summary.prometheus.configured}
- Alertmanager configured: ${summary.alertmanager.configured}

Use this output as a rollout checkpoint before calling the managed observability wiring production-ready.
`,
      'utf8',
    );

    return summary;
  } finally {
    await shutdownTelemetry().catch(() => {});
  }
}

async function main(): Promise<void> {
  const summary = await probeObservabilityReceivers();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
