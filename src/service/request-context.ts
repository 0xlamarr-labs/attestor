import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { ReviewerIdentity } from '../financial/types.js';
import {
  createKeylessSignerPair,
  type KeylessSigner,
} from '../signing/keyless-signer.js';
import {
  sessionCookieName,
  sessionCookieSecure,
} from './account-session-store.js';
import type { AccountUserRole } from './account-user-store.js';
import {
  getAccountAccessContextFromHeaders,
  getTenantContextFromHeaders,
  type AccountAccessContext,
  type TenantContext,
} from './tenant-isolation.js';

interface RequestSignerPair {
  signer: KeylessSigner;
  reviewer: KeylessSigner;
}

export function createRequestSigners(
  identitySource: string,
  reviewerName?: string,
): RequestSignerPair {
  return createKeylessSignerPair(
    {
      subject: 'API Runtime Signer',
      source: identitySource === 'oidc_verified' ? 'oidc_verified' : 'ephemeral',
      identifier: 'api-keyless',
    },
    reviewerName
      ? {
          subject: reviewerName,
          source: identitySource === 'oidc_verified' ? 'oidc_verified' : 'operator_asserted',
          identifier: reviewerName,
        }
      : undefined,
  );
}

export function currentTenant(context: Context): TenantContext {
  return getTenantContextFromHeaders(context.req.raw.headers);
}

export function currentAccountAccess(context: Context): AccountAccessContext | null {
  return getAccountAccessContextFromHeaders(context.req.raw.headers);
}

export function currentAccountRole(context: Context): AccountUserRole | null {
  return currentAccountAccess(context)?.role ?? null;
}

export function currentReleaseRequester(
  context: Context,
  reviewerIdentity?: ReviewerIdentity,
) {
  if (reviewerIdentity) {
    return {
      id: `reviewer:${reviewerIdentity.identifier}`,
      type: 'user' as const,
      displayName: reviewerIdentity.name,
      role: reviewerIdentity.role,
    };
  }

  const tenant = currentTenant(context);
  return {
    id: tenant.tenantId === 'default' ? 'svc.attestor.api' : `tenant:${tenant.tenantId}`,
    type: 'service' as const,
    displayName: tenant.tenantId === 'default' ? 'Attestor API Runtime' : tenant.tenantId,
    role: tenant.planId ?? 'service',
  };
}

export function currentReleaseEvaluationContext(context: Context) {
  const tenant = currentTenant(context);
  const account = currentAccountAccess(context);
  const cohortHeader = context.req.header('x-attestor-release-cohort');
  const cohortId = cohortHeader?.trim() ? cohortHeader.trim() : null;

  return {
    tenantId: tenant.tenantId !== 'default' ? tenant.tenantId : null,
    accountId: account?.accountId ?? null,
    planId: tenant.planId ?? null,
    cohortId,
  } as const;
}

export function setSessionCookieForRecord(
  context: Context,
  sessionToken: string,
  expiresAt: string,
): void {
  setCookie(context, sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: sessionCookieSecure(),
    path: '/api/v1',
    expires: new Date(expiresAt),
  });
}

export function requireAccountSession(
  context: Context,
  options?: {
    roles?: AccountUserRole[];
    allowApiKey?: boolean;
  },
): Response | null {
  const access = currentAccountAccess(context);
  if (!access) {
    if (options?.allowApiKey && currentTenant(context).source === 'api_key') return null;
    return context.json({ error: 'Account session required.' }, 401);
  }
  if (options?.roles && !options.roles.includes(access.role)) {
    return context.json(
      {
        error: `Account role '${access.role}' is not allowed to perform this action.`,
        requiredRoles: options.roles,
      },
      403,
    );
  }
  return null;
}

export function constantTimeSecretEquals(candidate: string, configured: string): boolean {
  if (!candidate || !configured) return false;
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const configuredDigest = createHash('sha256').update(configured).digest();
  return timingSafeEqual(candidateDigest, configuredDigest);
}

export function currentAdminAuthorized(context: Context): Response | null {
  const configured = process.env.ATTESTOR_ADMIN_API_KEY?.trim();
  if (!configured) {
    return context.json(
      {
        error:
          'Admin API disabled. Set ATTESTOR_ADMIN_API_KEY to enable tenant management endpoints.',
      },
      503,
    );
  }

  const authHeader = context.req.header('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!constantTimeSecretEquals(token, configured)) {
    return context.json({ error: 'Valid admin API key required in Authorization header.' }, 401);
  }

  return null;
}

export function currentMetricsAuthorized(context: Context): Response | null {
  const configured = process.env.ATTESTOR_METRICS_API_KEY?.trim();
  if (configured) {
    const authHeader = context.req.header('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!constantTimeSecretEquals(token, configured)) {
      return context.json(
        { error: 'Valid metrics API key required in Authorization header.' },
        401,
      );
    }
    return null;
  }

  return currentAdminAuthorized(context);
}
