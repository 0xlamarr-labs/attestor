import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import IORedis from 'ioredis';

type Provider = 'generic' | 'aws' | 'gke';

function arg(name: string, fallback?: string): string | undefined {
  const prefixed = `--${name}=`;
  const found = process.argv.find((entry) => entry.startsWith(prefixed));
  if (found) return found.slice(prefixed.length);
  return fallback;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function envOrFile(name: string): string | null {
  const direct = env(name);
  if (direct) return direct;
  const filePath = env(`${name}_FILE`);
  if (!filePath) return null;
  const raw = readFileSync(resolve(filePath), 'utf8').trim();
  return raw || null;
}

function buildRedisUrl(): string | null {
  const direct = env('REDIS_URL');
  if (direct) return direct;
  const address = env('REDIS_ADDRESS');
  if (!address) return null;
  const username = env('REDIS_USERNAME');
  const password = env('REDIS_PASSWORD');
  const schemeAddress = address.startsWith('redis://') || address.startsWith('rediss://')
    ? address
    : `redis://${address}`;
  if (!username && !password) return schemeAddress;
  const url = new URL(schemeAddress);
  if (username) url.username = username;
  if (password) url.password = password;
  return url.toString();
}

function validHostname(value: string | null): boolean {
  if (!value) return false;
  if (value.includes('://') || value.includes('/') || /\s/.test(value)) return false;
  return /^[A-Za-z0-9.-]+$/.test(value);
}

function validImageRef(value: string | null): boolean {
  if (!value) return false;
  return !/\s/.test(value) && value.includes('/');
}

function validPemCertificate(value: string | null): boolean {
  return Boolean(value && value.includes('BEGIN CERTIFICATE') && value.includes('END CERTIFICATE'));
}

function validPemKey(value: string | null): boolean {
  return Boolean(
    value
    && /BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY/.test(value)
    && /END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY/.test(value),
  );
}

function validAcmArnList(value: string | null): boolean {
  if (!value) return false;
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return false;
  return entries.every((entry) => /^arn:aws(-[\w]+)?:acm:[^:]+:\d{12}:certificate\/[A-Za-z0-9-]+$/.test(entry));
}

async function probeRedis(redisUrl: string | null, timeoutMs: number): Promise<{ configured: boolean; reachable: boolean; detail: string; }> {
  if (!redisUrl) {
    return { configured: false, reachable: false, detail: 'Redis URL not configured.' };
  }
  let client: IORedis | null = null;
  try {
    client = new IORedis(redisUrl, {
      lazyConnect: true,
      connectTimeout: timeoutMs,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: null,
    });
    client.on('error', () => {});
    await client.connect();
    const pong = await client.ping();
    return { configured: true, reachable: pong === 'PONG', detail: pong === 'PONG' ? 'Redis ping succeeded.' : `Unexpected Redis ping response: ${pong}` };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (client) {
      try { await client.quit(); } catch {
        try { client.disconnect(); } catch {}
      }
    }
  }
}

async function probePg(connectionString: string | null, timeoutMs: number): Promise<{ configured: boolean; reachable: boolean; detail: string; }> {
  if (!connectionString) {
    return { configured: false, reachable: false, detail: 'PostgreSQL URL not configured.' };
  }
  const pgModule = await (Function('return import("pg")')() as Promise<any>);
  const PgClient = pgModule.default?.Client ?? pgModule.Client;
  const client = new PgClient({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
  });
  try {
    await client.connect();
    const result = await client.query('select 1 as ok');
    return {
      configured: true,
      reachable: result.rows?.[0]?.ok === 1,
      detail: result.rows?.[0]?.ok === 1 ? 'PostgreSQL query succeeded.' : 'PostgreSQL returned an unexpected result.',
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try { await client.end(); } catch {}
  }
}

export interface HaRuntimeConnectivitySummary {
  provider: Provider;
  tlsMode: string;
  timeoutMs: number;
  checks: {
    hostname: { configured: boolean; valid: boolean; detail: string; };
    images: { apiConfigured: boolean; workerConfigured: boolean; valid: boolean; detail: string; };
    redis: { configured: boolean; reachable: boolean; detail: string; };
    controlPlanePg: { configured: boolean; reachable: boolean; detail: string; };
    billingLedgerPg: { configured: boolean; reachable: boolean; detail: string; };
    runtimePg: { configured: boolean; reachable: boolean; detail: string; };
    tls: { valid: boolean; detail: string; };
  };
  overall: {
    passed: boolean;
    issues: string[];
  };
}

export async function probeHaRuntimeConnectivity(options?: {
  provider?: Provider;
  timeoutMs?: number;
}): Promise<HaRuntimeConnectivitySummary> {
  const provider = (options?.provider ?? arg('provider', env('ATTESTOR_HA_PROVIDER') ?? 'gke')) as Provider;
  if (!['generic', 'aws', 'gke'].includes(provider)) throw new Error('provider must be one of generic, aws, or gke');
  const tlsMode = env('ATTESTOR_TLS_MODE') ?? 'secret';
  const timeoutMs = Number.parseInt(arg('timeout-ms', env('ATTESTOR_HA_CONNECTIVITY_TIMEOUT_MS') ?? '3000')!, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout-ms must be a positive integer.');

  const hostname = env('ATTESTOR_PUBLIC_HOSTNAME');
  const apiImage = env('ATTESTOR_API_IMAGE');
  const workerImage = env('ATTESTOR_WORKER_IMAGE');
  const redisUrl = buildRedisUrl();
  const controlPlanePgUrl = env('ATTESTOR_CONTROL_PLANE_PG_URL');
  const billingLedgerPgUrl = env('ATTESTOR_BILLING_LEDGER_PG_URL');
  const runtimePgUrl = env('ATTESTOR_PG_URL');

  const hostnameCheck = {
    configured: Boolean(hostname),
    valid: validHostname(hostname),
    detail: hostname
      ? (validHostname(hostname) ? 'Public hostname looks valid.' : 'Public hostname must be a bare hostname without scheme or path.')
      : 'Public hostname not configured.',
  };

  const imagesCheck = {
    apiConfigured: Boolean(apiImage),
    workerConfigured: Boolean(workerImage),
    valid: validImageRef(apiImage) && validImageRef(workerImage),
    detail: validImageRef(apiImage) && validImageRef(workerImage)
      ? 'API and worker image references look valid.'
      : 'API and worker image references must be non-empty registry/image references.',
  };

  const [redisCheck, controlPlanePgCheck, billingLedgerPgCheck, runtimePgCheck] = await Promise.all([
    probeRedis(redisUrl, timeoutMs),
    probePg(controlPlanePgUrl, timeoutMs),
    probePg(billingLedgerPgUrl, timeoutMs),
    probePg(runtimePgUrl, timeoutMs),
  ]);

  const tlsCheck = (() => {
    if (tlsMode === 'secret' || tlsMode === 'external-secret') {
      const cert = envOrFile('ATTESTOR_TLS_CERT_PEM');
      const key = envOrFile('ATTESTOR_TLS_KEY_PEM');
      const valid = validPemCertificate(cert) && validPemKey(key);
      return {
        valid,
        detail: valid
          ? 'TLS PEM material passed a structural preflight check.'
          : 'TLS secret mode requires structurally valid PEM certificate and private key material.',
      };
    }
    if (tlsMode === 'cert-manager') {
      const issuer = env('ATTESTOR_TLS_CLUSTER_ISSUER');
      return {
        valid: Boolean(issuer),
        detail: issuer
          ? 'cert-manager ClusterIssuer is configured.'
          : 'ATTESTOR_TLS_CLUSTER_ISSUER is required for cert-manager mode.',
      };
    }
    if (tlsMode === 'aws-acm') {
      const arns = env('ATTESTOR_AWS_ALB_CERTIFICATE_ARNS');
      return {
        valid: validAcmArnList(arns),
        detail: validAcmArnList(arns)
          ? 'AWS ACM certificate ARN list passed structural validation.'
          : 'ATTESTOR_AWS_ALB_CERTIFICATE_ARNS must contain one or more valid ACM certificate ARNs.',
      };
    }
    return {
      valid: false,
      detail: `Unsupported TLS mode: ${tlsMode}`,
    };
  })();

  const issues: string[] = [];
  if (!hostnameCheck.valid) issues.push(hostnameCheck.detail);
  if (!imagesCheck.valid) issues.push(imagesCheck.detail);
  if (!redisCheck.reachable) issues.push(`Redis connectivity failed: ${redisCheck.detail}`);
  if (!controlPlanePgCheck.reachable) issues.push(`Control-plane PostgreSQL connectivity failed: ${controlPlanePgCheck.detail}`);
  if (!billingLedgerPgCheck.reachable) issues.push(`Billing-ledger PostgreSQL connectivity failed: ${billingLedgerPgCheck.detail}`);
  if (runtimePgCheck.configured && !runtimePgCheck.reachable) issues.push(`Runtime PostgreSQL connectivity failed: ${runtimePgCheck.detail}`);
  if (!tlsCheck.valid) issues.push(tlsCheck.detail);

  return {
    provider,
    tlsMode,
    timeoutMs,
    checks: {
      hostname: hostnameCheck,
      images: imagesCheck,
      redis: redisCheck,
      controlPlanePg: controlPlanePgCheck,
      billingLedgerPg: billingLedgerPgCheck,
      runtimePg: runtimePgCheck,
      tls: tlsCheck,
    },
    overall: {
      passed: issues.length === 0,
      issues,
    },
  };
}

async function main(): Promise<void> {
  const summary = await probeHaRuntimeConnectivity();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
