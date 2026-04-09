import os from 'node:os';

type RedisMode = 'external' | 'localhost' | 'embedded' | 'none' | 'unavailable';
type AsyncBackendMode = 'bullmq' | 'in_process' | 'none';

export interface ApiHighAvailabilityState {
  enabled: boolean;
  instanceId: string;
  ready: boolean;
  issues: string[];
  redisMode: RedisMode;
  asyncBackendMode: AsyncBackendMode;
  sharedControlPlane: boolean;
  sharedBillingLedger: boolean;
}

export interface WorkerHighAvailabilityState {
  enabled: boolean;
  instanceId: string;
  ready: boolean;
  issues: string[];
  redisMode: RedisMode;
}

function envTruthy(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function isHighAvailabilityModeEnabled(): boolean {
  return envTruthy(process.env.ATTESTOR_HA_MODE);
}

export function resolveServiceInstanceId(): string {
  return process.env.ATTESTOR_INSTANCE_ID?.trim()
    || process.env.OTEL_SERVICE_INSTANCE_ID?.trim()
    || process.env.HOSTNAME?.trim()
    || process.env.COMPUTERNAME?.trim()
    || os.hostname();
}

export function evaluateApiHighAvailabilityState(input: {
  redisMode: RedisMode;
  asyncBackendMode: AsyncBackendMode;
  sharedControlPlane: boolean;
  sharedBillingLedger: boolean;
}): ApiHighAvailabilityState {
  const enabled = isHighAvailabilityModeEnabled();
  const issues: string[] = [];

  if (enabled) {
    if (input.asyncBackendMode !== 'bullmq') {
      issues.push('ATTESTOR_HA_MODE requires BullMQ/shared Redis async mode. In-process async fallback is not HA-safe.');
    }
    if (input.redisMode !== 'external') {
      issues.push('ATTESTOR_HA_MODE requires REDIS_URL-backed external Redis. Localhost and embedded Redis are not HA-safe.');
    }
    if (!input.sharedControlPlane) {
      issues.push('ATTESTOR_HA_MODE requires ATTESTOR_CONTROL_PLANE_PG_URL so hosted control-plane state is shared across API instances.');
    }
  }

  return {
    enabled,
    instanceId: resolveServiceInstanceId(),
    ready: !enabled || issues.length === 0,
    issues,
    redisMode: input.redisMode,
    asyncBackendMode: input.asyncBackendMode,
    sharedControlPlane: input.sharedControlPlane,
    sharedBillingLedger: input.sharedBillingLedger,
  };
}

export function evaluateWorkerHighAvailabilityState(input: {
  redisMode: RedisMode;
}): WorkerHighAvailabilityState {
  const enabled = isHighAvailabilityModeEnabled();
  const issues: string[] = [];

  if (enabled && input.redisMode !== 'external') {
    issues.push('ATTESTOR_HA_MODE requires REDIS_URL-backed external Redis for worker instances. Localhost and embedded Redis are not HA-safe.');
  }

  return {
    enabled,
    instanceId: resolveServiceInstanceId(),
    ready: !enabled || issues.length === 0,
    issues,
    redisMode: input.redisMode,
  };
}
