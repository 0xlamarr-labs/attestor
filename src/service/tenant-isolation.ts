/**
 * Tenant Isolation — Bounded Multi-Tenant First Slice
 *
 * Provides request-level tenant identification and isolation
 * via Bearer auth using API keys or tenant claims.
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
 * - No full multi-node customer identity fabric yet; hosted tenant truth can be shared via the control-plane PostgreSQL first slice
 * - Request routing remains distinct from optional database-level RLS
 * - This is the first request-routing slice
 */

import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import {
  findAccountSessionByTokenState,
  findAccountUserByIdState,
  findHostedAccountByIdState,
  findActiveTenantKeyState,
  findHostedAccountByTenantIdState,
  findTenantRecordByTenantIdState,
  hasTenantKeyRecordsState,
  revokeAccountSessionState,
} from './control-plane-store.js';
import { DEFAULT_HOSTED_PLAN_ID, SELF_HOST_PLAN_ID, resolvePlanSpec } from './plan-catalog.js';
import type { AccountUserRole } from './account-user-store.js';

export interface TenantContext {
  tenantId: string;
  tenantName: string | null;
  authenticatedAt: string;
  source: 'bearer_token' | 'api_key' | 'account_session' | 'anonymous';
  planId: string | null;
  monthlyRunQuota: number | null;
}

export interface AccountAccessContext {
  accountId: string;
  accountUserId: string;
  role: AccountUserRole;
  sessionId: string;
  source: 'account_session';
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
  const resolvedPlan = resolvePlanSpec({
    planId,
    monthlyRunQuota,
    defaultPlanId: SELF_HOST_PLAN_ID,
    allowCustomPlan: true,
  });
  tenantKeys.set(apiKey, {
    tenantId,
    tenantName,
    planId: resolvedPlan.planId,
    monthlyRunQuota: resolvedPlan.monthlyRunQuota,
  });
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
export async function extractTenantContext(authHeader: string | undefined): Promise<TenantContext | null> {
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

  const fileBackedTenant = await findActiveTenantKeyState(token, { markUsed: true });
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
    if (
      c.req.path.startsWith('/api/v1/admin/') ||
      c.req.path === '/api/v1/billing/stripe/webhook' ||
      c.req.path === '/api/v1/health' ||
      c.req.path === '/api/v1/ready' ||
      c.req.path === '/api/v1/domains' ||
      c.req.path === '/api/v1/connectors'
    ) {
      return next();
    }

    loadTenantKeysFromEnv();
    const isAuthRoute = c.req.path.startsWith('/api/v1/auth/');
    const isPublicInviteAcceptRoute = c.req.path === '/api/v1/account/users/invites/accept';
    const enforced = tenantKeys.size > 0 || await hasTenantKeyRecordsState();
    const session = await resolveAccountSessionContext(c);
    const tenant = session?.tenant ?? await extractTenantContext(c.req.header('authorization'));

    if (enforced && !tenant && !isAuthRoute && !isPublicInviteAcceptRoute) {
      return c.json({ error: 'Valid tenant API key required in Authorization header' }, 401);
    }

    // Propagate tenant context via internal headers (Hono-safe approach)
    const resolved = tenant ?? {
      tenantId: 'default',
      tenantName: 'anonymous',
      authenticatedAt: new Date().toISOString(),
      source: 'anonymous' as const,
      planId: SELF_HOST_PLAN_ID,
      monthlyRunQuota: null,
    };
    c.req.raw.headers.set('x-attestor-tenant-id', resolved.tenantId);
    c.req.raw.headers.set('x-attestor-tenant-source', resolved.source);
    c.req.raw.headers.set('x-attestor-plan-id', resolved.planId ?? SELF_HOST_PLAN_ID);
    if (resolved.monthlyRunQuota !== null) {
      c.req.raw.headers.set('x-attestor-monthly-run-quota', String(resolved.monthlyRunQuota));
    }
    if (session) {
      c.req.raw.headers.set('x-attestor-account-id', session.accountId);
      c.req.raw.headers.set('x-attestor-account-user-id', session.accountUserId);
      c.req.raw.headers.set('x-attestor-account-role', session.role);
      c.req.raw.headers.set('x-attestor-account-session-id', session.sessionId);
    }

    if (isAuthRoute || isPublicInviteAcceptRoute) {
      await next();
      return;
    }

    const account = session?.account ?? await findHostedAccountByTenantIdState(resolved.tenantId);
    const isBillingSelfService = c.req.path.startsWith('/api/v1/account/billing/');
    if (account?.status === 'suspended') {
      if (isBillingSelfService) {
        await next();
        return;
      }
      return c.json({
        error: 'Hosted account is suspended. Restore billing or reactivate the account before using tenant APIs.',
        accountId: account.id,
        accountStatus: account.status,
      }, 403);
    }
    if (account?.status === 'archived') {
      return c.json({
        error: 'Hosted account is archived and no longer allowed to use tenant APIs.',
        accountId: account.id,
        accountStatus: account.status,
      }, 403);
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
    planId: headers.get('x-attestor-plan-id') ?? SELF_HOST_PLAN_ID,
    monthlyRunQuota: Number.isFinite(parsedQuota) ? parsedQuota : null,
  };
}

export function getAccountAccessContextFromHeaders(headers: Headers): AccountAccessContext | null {
  const source = headers.get('x-attestor-tenant-source');
  if (source !== 'account_session') return null;
  const accountId = headers.get('x-attestor-account-id');
  const accountUserId = headers.get('x-attestor-account-user-id');
  const role = headers.get('x-attestor-account-role') as AccountUserRole | null;
  const sessionId = headers.get('x-attestor-account-session-id');
  if (!accountId || !accountUserId || !role || !sessionId) return null;
  return {
    accountId,
    accountUserId,
    role,
    sessionId,
    source: 'account_session',
  };
}

async function resolveAccountSessionContext(c: Context): Promise<{
  tenant: TenantContext;
  account: Awaited<ReturnType<typeof findHostedAccountByIdState>>;
  accountId: string;
  accountUserId: string;
  role: AccountUserRole;
  sessionId: string;
} | null> {
  const sessionToken = getCookie(c, process.env.ATTESTOR_SESSION_COOKIE_NAME?.trim() || 'attestor_session')
    ?? c.req.header('x-attestor-session')
    ?? null;
  if (!sessionToken) return null;

  const session = await findAccountSessionByTokenState(sessionToken, { touch: true });
  if (!session) return null;

  const user = await findAccountUserByIdState(session.accountUserId);
  const account = await findHostedAccountByIdState(session.accountId);
  const suspendedAtMs = account?.suspendedAt ? Date.parse(account.suspendedAt) : Number.NaN;
  const sessionCreatedAtMs = Date.parse(session.createdAt);
  const passwordUpdatedAtMs = user?.passwordUpdatedAt ? Date.parse(user.passwordUpdatedAt) : Number.NaN;
  const sessionPredatesSuspension = account?.status === 'suspended'
    && Number.isFinite(suspendedAtMs)
    && Number.isFinite(sessionCreatedAtMs)
    && sessionCreatedAtMs <= suspendedAtMs;
  const sessionPredatesPasswordChange = Number.isFinite(passwordUpdatedAtMs)
    && Number.isFinite(sessionCreatedAtMs)
    && sessionCreatedAtMs < passwordUpdatedAtMs;
  if (
    !user
    || user.status !== 'active'
    || !account
    || account.status === 'archived'
    || sessionPredatesSuspension
    || sessionPredatesPasswordChange
  ) {
    await revokeAccountSessionState(session.id);
    return null;
  }

  const tenantRecord = await findTenantRecordByTenantIdState(account.primaryTenantId);
  const resolvedPlan = resolvePlanSpec({
    planId: tenantRecord?.planId ?? account.billing.lastCheckoutPlanId ?? DEFAULT_HOSTED_PLAN_ID,
    monthlyRunQuota: tenantRecord?.monthlyRunQuota ?? null,
    defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
    allowCustomPlan: true,
  });

  return {
    tenant: {
      tenantId: account.primaryTenantId,
      tenantName: tenantRecord?.tenantName ?? account.accountName,
      authenticatedAt: new Date().toISOString(),
      source: 'account_session',
      planId: resolvedPlan.planId,
      monthlyRunQuota: resolvedPlan.monthlyRunQuota,
    },
    account,
    accountId: account.id,
    accountUserId: user.id,
    role: user.role,
    sessionId: session.id,
  };
}
