import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { evaluateApiHighAvailabilityState } from '../high-availability.js';
import {
  forceFlushTelemetry,
  initializeTelemetry,
  shutdownTelemetry,
} from '../observability.js';
import { shutdownHostedEmailDelivery } from '../email-delivery.js';
import { isSharedControlPlaneConfigured } from '../control-plane-store.js';
import {
  asyncBackendMode,
  configureTenantRuntimeBackends,
  redisMode,
  shutdownTenantRuntimeBackends,
} from '../runtime/tenant-runtime.js';

export interface HttpServerHandle {
  port: number;
  close(): void;
}

type HonoNodeServer = ReturnType<typeof serve>;

function closeServer(server: HonoNodeServer): void {
  const maybeClosable = server as { close?: unknown };
  if (typeof maybeClosable.close === 'function') {
    maybeClosable.close();
  }
}

function logTelemetryStartup(telemetry: ReturnType<typeof initializeTelemetry>): void {
  if (telemetry.traces.enabled && telemetry.traces.endpoint) {
    console.log(`[telemetry] OTLP traces enabled (${telemetry.traces.protocol}) -> ${telemetry.traces.endpoint}`);
  }
  if (telemetry.metrics.enabled && telemetry.metrics.endpoint) {
    console.log(`[telemetry] OTLP metrics enabled (${telemetry.metrics.protocol}) -> ${telemetry.metrics.endpoint} @ ${telemetry.metrics.exportIntervalMillis ?? 1000}ms`);
  }
  if (!telemetry.traces.enabled && !telemetry.metrics.enabled && telemetry.disabledReason) {
    console.log(`[telemetry] Disabled: ${telemetry.disabledReason}`);
  }
}

export function startHttpServer(app: Hono, port: number = 3700): HttpServerHandle {
  const telemetry = initializeTelemetry('1.0.0');
  configureTenantRuntimeBackends();

  const highAvailability = evaluateApiHighAvailabilityState({
    redisMode: redisMode as 'external' | 'localhost' | 'embedded' | 'none' | 'unavailable',
    asyncBackendMode: asyncBackendMode as 'bullmq' | 'in_process' | 'none',
    sharedControlPlane: isSharedControlPlaneConfigured(),
    sharedBillingLedger: !!process.env.ATTESTOR_BILLING_LEDGER_PG_URL?.trim(),
  });

  if (!highAvailability.ready) {
    if (highAvailability.enabled) {
      throw new Error(`ATTESTOR_HA_MODE startup guard failed for instance '${highAvailability.instanceId}': ${highAvailability.issues.join(' ')}`);
    }
    if (highAvailability.publicHosted) {
      throw new Error(`Public hosted startup guard failed for instance '${highAvailability.instanceId}': ${highAvailability.issues.join(' ')}`);
    }
  }
  if (highAvailability.enabled) {
    console.log(`[ha] Multi-node first slice enabled for instance '${highAvailability.instanceId}' (redis=${highAvailability.redisMode}, sharedControlPlane=${highAvailability.sharedControlPlane}, sharedBillingLedger=${highAvailability.sharedBillingLedger})`);
  }

  logTelemetryStartup(telemetry);

  const server = serve({ fetch: app.fetch, port });
  return {
    port,
    close: () => {
      void forceFlushTelemetry().catch(() => {});
      shutdownHostedEmailDelivery();
      closeServer(server);
      void shutdownTenantRuntimeBackends().catch(() => {});
      void shutdownTelemetry().catch(() => {});
    },
  };
}

export function installGracefulShutdown(handle: HttpServerHandle): void {
  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`[attestor] ${signal} received - shutting down gracefully...`);
    handle.close();
    setTimeout(() => {
      console.log('[attestor] Force exit after timeout');
      process.exit(0);
    }, 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
