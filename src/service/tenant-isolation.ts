/**
 * Tenant Isolation — Bounded Multi-Tenant First Slice
 *
 * Provides request-level tenant identification and isolation
 * via Bearer token with tenant claims.
 *
 * ARCHITECTURE:
 * - Each request carries a Bearer token with optional tenantId
 * - Middleware extracts tenantId and injects into request context
 * - All logging/artifacts include tenantId for audit trail
 * - No shared state between tenants
 *
 * BOUNDARY:
 * - Token-based tenant identification (not database isolation)
 * - API key lookup can come from env or local file-backed operator store
 * - Plan/quota metadata can ride with API keys for hosted enforcement
 * - No rate limiting or shared multi-node tenant datastore yet
 * - Request routing remains distinct from optional database-level RLS
 * - This is the first request-routing slice
 */

import type { Context, Next } from 'hono';
import { findActiveTenantKey } from './tenant-key-store.js';

export interface TenantContext {
  tenantId: string;
  tenantName: string | null;
  authenticatedAt: string;
  source: 'bearer_token' | 'api_key' | 'anonymous';
  planId: string | null;
  monthlyRunQuota: number | null;
}

/** Tenant registry — maps API keys to tenants. */
const tenantKeys = new Map<string, {
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
}>();
let loadedTenantKeyConfig: string | null = null;

/**
 * Register an API key for a tenant.
 */
export function registerTenantKey(
  apiKey: string,
  tenantId: string,
  tenantName: string,
  planId: string | null = null,
  monthlyRunQuota: number | null = null,
): void {
  tenantKeys.set(apiKey, { tenantId, tenantName, planId, monthlyRunQuota });
}

/**
 * Load tenant keys from environment variable.
 * Format: ATTESTOR_TENANT_KEYS=key1:tenant1:name1[:plan][:quota],key2:tenant2:name2[:plan][:quota]
 */
export function loadTenantKeysFromEnv(): void {
  const raw = process.env.ATTESTOR_TENANT_KEYS?.trim() ?? '';
  if (raw === loadedTenantKeyConfig) return;

  tenantKeys.clear();
  loadedTenantKeyConfig = raw;
  if (!raw) return;
  for (const entry of raw.split(',')) {
    const [key, id, name, planId, quotaRaw] = entry.trim().split(':');
    const quota = quotaRaw && quotaRaw.trim() !== '' ? Number.parseInt(quotaRaw, 10) : null;
    if (key && id) registerTenantKey(key, id, name ?? id, planId ?? null, Number.isFinite(quota as number) ? quota : null);
  }
}

/**
 * Extract tenant context from a request.
 */
export function extractTenantContext(authHeader: string | undefined): TenantContext | null {
  if (!authHeader) return null;

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const tenant = tenantKeys.get(token);
  if (tenant) {
      return {
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        authenticatedAt: new Date().toISOString(),
        source: 'api_key',
        planId: tenant.planId,
        monthlyRunQuota: tenant.monthlyRunQuota,
      };
    }

  const fileBackedTenant = findActiveTenantKey(token);
  if (fileBackedTenant) {
    return {
      tenantId: fileBackedTenant.tenantId,
      tenantName: fileBackedTenant.tenantName,
      authenticatedAt: new Date().toISOString(),
      source: 'api_key',
      planId: fileBackedTenant.planId,
      monthlyRunQuota: fileBackedTenant.monthlyRunQuota,
    };
  }

  // Try JWT decode for tenantId claim
  try {
    const [, payloadB64] = token.split('.');
    if (payloadB64) {
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      if (payload.tenantId) {
        return {
          tenantId: payload.tenantId,
          tenantName: payload.tenantName ?? null,
          authenticatedAt: new Date().toISOString(),
          source: 'bearer_token',
          planId: payload.planId ?? null,
          monthlyRunQuota: typeof payload.monthlyRunQuota === 'number' ? payload.monthlyRunQuota : null,
        };
      }
    }
  } catch { /* not a JWT — ignore */ }

  return null;
}

/**
 * Hono middleware for tenant isolation.
 * When ATTESTOR_TENANT_KEYS is set, requests must carry a valid tenant key.
 * When not set, all requests run as 'anonymous' with tenantId='default'.
 */
export function tenantMiddleware() {
  return async (c: Context, next: Next) => {
    loadTenantKeysFromEnv();
    const enforced = tenantKeys.size > 0;
    const tenant = extractTenantContext(c.req.header('authorization'));

    if (enforced && !tenant) {
      return c.json({ error: 'Valid tenant API key required in Authorization header' }, 401);
    }

    // Propagate tenant context via internal headers (Hono-safe approach)
    const resolved = tenant ?? {
      tenantId: 'default',
      tenantName: 'anonymous',
      authenticatedAt: new Date().toISOString(),
      source: 'anonymous' as const,
      planId: 'community',
      monthlyRunQuota: null,
    };
    c.req.raw.headers.set('x-attestor-tenant-id', resolved.tenantId);
    c.req.raw.headers.set('x-attestor-tenant-source', resolved.source);
    c.req.raw.headers.set('x-attestor-plan-id', resolved.planId ?? 'community');
    if (resolved.monthlyRunQuota !== null) {
      c.req.raw.headers.set('x-attestor-monthly-run-quota', String(resolved.monthlyRunQuota));
    }
    await next();
  };
}

export function getTenantContextFromHeaders(headers: Headers): TenantContext {
  const quotaRaw = headers.get('x-attestor-monthly-run-quota');
  const parsedQuota = quotaRaw ? Number.parseInt(quotaRaw, 10) : NaN;
  return {
    tenantId: headers.get('x-attestor-tenant-id') ?? 'default',
    tenantName: null,
    authenticatedAt: new Date().toISOString(),
    source: (headers.get('x-attestor-tenant-source') as TenantContext['source'] | null) ?? 'anonymous',
    planId: headers.get('x-attestor-plan-id') ?? 'community',
    monthlyRunQuota: Number.isFinite(parsedQuota) ? parsedQuota : null,
  };
}
