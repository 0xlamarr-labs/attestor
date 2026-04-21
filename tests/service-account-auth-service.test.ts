import assert from 'node:assert/strict';
import {
  AccountAuthServiceError,
  createAccountAuthService,
  type AccountAuthCurrentAccount,
  type AccountAuthServiceDeps,
} from '../src/service/application/account-auth-service.js';
import type { HostedAccountRecord } from '../src/service/account-store.js';
import type { AccountSessionRecord } from '../src/service/account-session-store.js';
import type {
  AccountUserPasswordState,
  AccountUserRecord,
  AccountUserTotpState,
} from '../src/service/account-user-store.js';
import type { AccountUserActionTokenRecord } from '../src/service/account-user-token-store.js';
import type { HostedPlanDefinition, ResolvedPlanSpec } from '../src/service/plan-catalog.js';
import type { TenantKeyRecord } from '../src/service/tenant-key-store.js';

const now = '2026-04-21T10:00:00.000Z';

function passwordState(): AccountUserPasswordState {
  return {
    algorithm: 'scrypt',
    params: {
      N: 16_384,
      r: 8,
      p: 1,
      keylen: 64,
    },
    salt: 'salt',
    hash: 'hash',
  };
}

function totpState(overrides: Partial<AccountUserTotpState> = {}): AccountUserTotpState {
  return {
    method: 'totp',
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
    enabledAt: null,
    updatedAt: null,
    sessionBoundaryAt: null,
    secretCiphertext: null,
    secretIv: null,
    secretAuthTag: null,
    pendingSecretCiphertext: null,
    pendingSecretIv: null,
    pendingSecretAuthTag: null,
    pendingIssuedAt: null,
    recoveryCodes: [],
    recoveryCodesIssuedAt: null,
    lastVerifiedAt: null,
    ...overrides,
  };
}

function account(overrides: Partial<HostedAccountRecord> = {}): HostedAccountRecord {
  return {
    id: 'acct_123',
    accountName: 'Acme',
    contactEmail: 'ops@example.com',
    primaryTenantId: 'tenant_123',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    suspendedAt: null,
    archivedAt: null,
    billing: {
      provider: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
      stripePriceId: null,
      lastStripeEventId: null,
      lastStripeEventType: null,
      lastStripeEventAt: null,
      lastCheckoutSessionId: null,
      lastCheckoutPlanId: null,
      entitlementStatus: 'inactive',
      entitlementAccessEnabled: false,
      entitlementUpdatedAt: null,
    },
    ...overrides,
  };
}

function user(overrides: Partial<AccountUserRecord> = {}): AccountUserRecord {
  return {
    id: 'user_123',
    accountId: 'acct_123',
    email: 'ops@example.com',
    displayName: 'Ops User',
    role: 'account_admin',
    status: 'active',
    password: passwordState(),
    createdAt: now,
    updatedAt: now,
    passwordUpdatedAt: now,
    deactivatedAt: null,
    lastLoginAt: null,
    mfa: {
      totp: totpState(),
    },
    passkeys: {
      userHandle: null,
      credentials: [],
      updatedAt: null,
    },
    federation: {
      oidc: {
        identities: [],
      },
      saml: {
        identities: [],
      },
    },
    ...overrides,
  };
}

function session(overrides: Partial<AccountSessionRecord> = {}): AccountSessionRecord {
  return {
    id: 'sess_123',
    accountId: 'acct_123',
    accountUserId: 'user_123',
    role: 'account_admin',
    tokenHash: 'hash',
    createdAt: now,
    lastSeenAt: now,
    expiresAt: '2026-04-22T10:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

function tenantKey(overrides: Partial<TenantKeyRecord> = {}): TenantKeyRecord {
  return {
    id: 'key_123',
    tenantId: 'tenant_123',
    tenantName: 'Acme',
    planId: 'community',
    monthlyRunQuota: 10,
    apiKeyHash: 'hash',
    apiKeyPreview: 'att_...',
    status: 'active',
    createdAt: now,
    lastUsedAt: null,
    deactivatedAt: null,
    revokedAt: null,
    rotatedFromKeyId: null,
    supersededByKeyId: null,
    supersededAt: null,
    recoveryEnvelope: null,
    ...overrides,
  };
}

function actionToken(overrides: Partial<AccountUserActionTokenRecord> = {}): AccountUserActionTokenRecord {
  return {
    id: 'tok_123',
    purpose: 'mfa_login',
    accountId: 'acct_123',
    accountUserId: 'user_123',
    email: 'ops@example.com',
    displayName: null,
    role: null,
    tokenHash: 'hash',
    createdAt: now,
    updatedAt: now,
    expiresAt: '2026-04-21T10:05:00.000Z',
    consumedAt: null,
    revokedAt: null,
    issuedByAccountUserId: null,
    attemptCount: 1,
    maxAttempts: 3,
    lastAttemptAt: null,
    context: null,
    ...overrides,
  };
}

const communityPlan: HostedPlanDefinition = {
  id: 'community',
  displayName: 'Community',
  description: 'Community',
  defaultStripeTrialDays: null,
  defaultMonthlyRunQuota: 10,
  defaultPipelineRequestsPerWindow: null,
  defaultAsyncPendingJobsPerTenant: null,
  defaultAsyncActiveJobsPerTenant: null,
  defaultAsyncDispatchWeight: null,
  intendedFor: 'self_host',
  defaultForHostedProvisioning: false,
};

function resolvedPlan(): ResolvedPlanSpec {
  return {
    plan: communityPlan,
    planId: 'community',
    monthlyRunQuota: 10,
    knownPlan: true,
    quotaSource: 'plan_default',
  };
}

function currentAccount(source: AccountAuthCurrentAccount['tenant']['source'] = 'api_key'): AccountAuthCurrentAccount {
  return {
    tenant: {
      tenantId: 'tenant_123',
      tenantName: 'Acme',
      authenticatedAt: now,
      source,
      planId: 'community',
      monthlyRunQuota: 10,
    },
    account: account(),
    usage: {
      tenantId: 'tenant_123',
      planId: 'community',
      meter: 'monthly_pipeline_runs',
      period: '2026-04',
      used: 0,
      quota: 10,
      remaining: 10,
      enforced: true,
    },
    rateLimit: {
      tenantId: 'tenant_123',
      planId: 'community',
      scope: 'pipeline_requests',
      backend: 'memory',
      windowSeconds: 60,
      requestsPerWindow: null,
      used: 0,
      remaining: null,
      enforced: false,
      resetAt: now,
      retryAfterSeconds: 0,
    },
  };
}

function createDeps(overrides: Partial<AccountAuthServiceDeps> = {}): AccountAuthServiceDeps {
  const deps: AccountAuthServiceDeps = {
    countAccountUsersForAccountState: async () => 0,
    createAccountUserState: async (input) => ({
      record: user({
        accountId: input.accountId,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
      }),
      path: null,
    }),
    findAccountUserByEmailState: async () => null,
    deriveSignupTenantId: () => 'tenant_123',
    resolvePlanSpec: () => resolvedPlan(),
    SELF_HOST_PLAN_ID: 'community',
    DEFAULT_HOSTED_PLAN_ID: 'starter',
    resolvePlanStripeTrialDays: (planId) => ({
      planId: planId ?? 'starter',
      trialDays: 14,
      configured: true,
      knownPlan: true,
      source: 'plan_default',
    }),
    provisionHostedAccountState: async (input) => ({
      account: account({
        accountName: input.account.accountName,
        contactEmail: input.account.contactEmail,
        primaryTenantId: input.account.primaryTenantId,
      }),
      initialKey: tenantKey({
        tenantId: input.key.tenantId,
        tenantName: input.key.tenantName,
        planId: input.key.planId,
        monthlyRunQuota: input.key.monthlyRunQuota,
      }),
      apiKey: 'att_live_initial',
      path: null,
    }),
    issueAccountSessionState: async (input) => ({
      sessionToken: 'session_token',
      record: session({
        accountId: input.accountId,
        accountUserId: input.accountUserId,
        role: input.role,
      }),
      path: null,
    }),
    recordAccountUserLoginState: async (id) => ({
      record: user({
        id,
        lastLoginAt: now,
      }),
      path: null,
    }),
    syncHostedBillingEntitlementForTenant: async () => null,
    verifyAccountUserPasswordRecord: (_passwordState, password) => password === 'correct-password',
    findHostedAccountByIdState: async (id) => account({ id }),
    totpSummary: (totp) => ({
      enabled: Boolean(totp.enabledAt),
      method: totp.enabledAt ? 'totp' : null,
      enrolledAt: totp.enabledAt,
      pendingEnrollment: false,
      recoveryCodesRemaining: 0,
      lastVerifiedAt: totp.lastVerifiedAt,
      updatedAt: totp.updatedAt,
    }),
    issueAccountMfaLoginTokenState: async (input) => ({
      token: 'mfa_token',
      record: actionToken({
        accountId: input.accountId,
        accountUserId: input.accountUserId,
        email: input.email,
      }),
      path: null,
    }),
  };
  return {
    ...deps,
    ...overrides,
  };
}

async function expectAuthError(
  action: Promise<unknown>,
  statusCode: AccountAuthServiceError['statusCode'],
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof AccountAuthServiceError && error.statusCode === statusCode,
  );
}

async function testBootstrapRequiresTenantApiKey(): Promise<void> {
  const service = createAccountAuthService(createDeps());
  await expectAuthError(
    service.bootstrapFirstUser({
      current: currentAccount('account_session'),
      email: 'ops@example.com',
      displayName: 'Ops User',
      password: 'correct-password',
    }),
    403,
  );
}

async function testSignupOrchestratesAccountAndSession(): Promise<void> {
  const syncEvents: string[] = [];
  const service = createAccountAuthService(createDeps({
    syncHostedBillingEntitlementForTenant: async (tenantId, options) => {
      syncEvents.push(`${tenantId}:${options?.lastEventType ?? 'none'}`);
      return null;
    },
  }));

  const result = await service.signup({
    accountName: 'Acme',
    email: 'ops@example.com',
    displayName: 'Ops User',
    password: 'correct-password',
  });

  assert.equal(result.sessionToken, 'session_token');
  assert.equal(result.account.primaryTenantId, 'tenant_123');
  assert.equal(result.initialKey.tenantId, 'tenant_123');
  assert.equal(result.apiKey, 'att_live_initial');
  assert.deepEqual(result.commercial, {
    currentPhase: 'evaluation',
    includedMonthlyRunQuota: 10,
    firstHostedPlanId: 'starter',
    firstHostedPlanTrialDays: 14,
  });
  assert.deepEqual(syncEvents, ['tenant_123:auth.signup']);
}

async function testLoginIssuesSessionWithoutMfa(): Promise<void> {
  const activeUser = user();
  const service = createAccountAuthService(createDeps({
    findAccountUserByEmailState: async () => activeUser,
  }));

  const result = await service.login({
    email: 'ops@example.com',
    password: 'correct-password',
  });

  assert.equal(result.mfaRequired, false);
  if (!result.mfaRequired) {
    assert.equal(result.sessionToken, 'session_token');
    assert.equal(result.session.accountUserId, activeUser.id);
    assert.equal(result.user.lastLoginAt, now);
  }
}

async function testLoginReturnsMfaChallenge(): Promise<void> {
  let issuedSession = false;
  const activeUser = user({
    mfa: {
      totp: totpState({
        enabledAt: now,
        secretCiphertext: 'cipher',
        secretIv: 'iv',
        secretAuthTag: 'tag',
      }),
    },
  });
  const service = createAccountAuthService(createDeps({
    findAccountUserByEmailState: async () => activeUser,
    issueAccountSessionState: async (input) => {
      issuedSession = true;
      return {
        sessionToken: 'session_token',
        record: session({
          accountId: input.accountId,
          accountUserId: input.accountUserId,
          role: input.role,
        }),
        path: null,
      };
    },
  }));

  const result = await service.login({
    email: 'ops@example.com',
    password: 'correct-password',
  });

  assert.equal(result.mfaRequired, true);
  if (result.mfaRequired) {
    assert.equal(result.challengeToken, 'mfa_token');
    assert.equal(result.challenge.remainingAttempts, 2);
  }
  assert.equal(issuedSession, false);
}

async function testLoginRejectsBadPassword(): Promise<void> {
  const service = createAccountAuthService(createDeps({
    findAccountUserByEmailState: async () => user(),
  }));

  await expectAuthError(
    service.login({
      email: 'ops@example.com',
      password: 'wrong-password',
    }),
    401,
  );
}

await testBootstrapRequiresTenantApiKey();
await testSignupOrchestratesAccountAndSession();
await testLoginIssuesSessionWithoutMfa();
await testLoginReturnsMfaChallenge();
await testLoginRejectsBadPassword();

console.log('Service account auth service tests: 5 passed, 0 failed');
