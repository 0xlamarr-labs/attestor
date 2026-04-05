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
 * - No per-tenant storage, quotas, or rate limiting yet
 * - No schema-per-tenant or RLS yet
 * - This is the first request-routing slice
 */

import type { Context, Next } from 'hono';

export interface TenantContext {
  tenantId: string;
  tenantName: string | null;
  authenticatedAt: string;
  source: 'bearer_token' | 'api_key' | 'anonymous';
}

/** Tenant registry — maps API keys to tenants. */
const tenantKeys = new Map<string, { tenantId: string; tenantName: string }>();

/**
 * Register an API key for a tenant.
 */
export function registerTenantKey(apiKey: string, tenantId: string, tenantName: string): void {
  tenantKeys.set(apiKey, { tenantId, tenantName });
}

/**
 * Load tenant keys from environment variable.
 * Format: ATTESTOR_TENANT_KEYS=key1:tenant1:name1,key2:tenant2:name2
 */
export function loadTenantKeysFromEnv(): void {
  const raw = process.env.ATTESTOR_TENANT_KEYS;
  if (!raw) return;
  for (const entry of raw.split(',')) {
    const [key, id, name] = entry.trim().split(':');
    if (key && id) registerTenantKey(key, id, name ?? id);
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
  loadTenantKeysFromEnv();
  const enforced = tenantKeys.size > 0;

  return async (c: Context, next: Next) => {
    const tenant = extractTenantContext(c.req.header('authorization'));

    if (enforced && !tenant) {
      return c.json({ error: 'Valid tenant API key required in Authorization header' }, 401);
    }

    // Set tenant context on request (accessible via c.get('tenant'))
    c.set('tenant', tenant ?? { tenantId: 'default', tenantName: 'anonymous', authenticatedAt: new Date().toISOString(), source: 'anonymous' as const });
    await next();
  };
}
