import assert from 'node:assert/strict';
import type { HostedAccountRecord } from '../src/service/account-store.js';
import type { AccountSessionRecord } from '../src/service/account-session-store.js';
import {
  AccountUserManagementServiceError,
  createAccountUserManagementService,
  type AccountUserManagementServiceDeps,
} from '../src/service/application/account-user-management-service.js';
import type { AccountUserRecord, AccountUserRole } from '../src/service/account-user-store.js';
import type { AccountUserActionTokenRecord } from '../src/service/account-user-token-store.js';
import { HostedEmailDeliveryError, type HostedEmailDeliverySummary } from '../src/service/email-delivery.js';

const now = '2026-04-21T10:00:00.000Z';

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
      lastCheckoutSessionId: null,
      lastCheckoutCompletedAt: null,
      lastCheckoutPlanId: null,
      lastInvoiceId: null,
      lastInvoiceStatus: null,
      lastInvoiceCurrency: null,
      lastInvoiceAmountPaid: null,
      lastInvoiceAmountDue: null,
      lastInvoiceEventId: null,
      lastInvoiceEventType: null,
      lastInvoiceProcessedAt: null,
      lastInvoicePaidAt: null,
      delinquentSince: null,
      lastWebhookEventId: null,
      lastWebhookEventType: null,
      lastWebhookProcessedAt: null,
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
    password: {
      algorithm: 'scrypt',
      params: { N: 16_384, r: 8, p: 1, keylen: 64 },
      salt: 'salt',
      hash: 'hash',
    },
    createdAt: now,
    updatedAt: now,
    passwordUpdatedAt: now,
    deactivatedAt: null,
    lastLoginAt: null,
    mfa: {
      totp: {
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
      },
    },
    passkeys: {
      userHandle: null,
      credentials: [],
      updatedAt: null,
    },
    federation: {
      oidc: { identities: [] },
      saml: { identities: [] },
    },
    ...overrides,
  };
}

function token(overrides: Partial<AccountUserActionTokenRecord> = {}): AccountUserActionTokenRecord {
  return {
    id: 'atok_123',
    purpose: 'invite',
    accountId: 'acct_123',
    accountUserId: null,
    email: 'new@example.com',
    displayName: 'New User',
    role: 'read_only',
    tokenHash: 'hash',
    createdAt: now,
    updatedAt: now,
    expiresAt: '2026-04-22T10:00:00.000Z',
    consumedAt: null,
    revokedAt: null,
    issuedByAccountUserId: 'user_admin',
    attemptCount: 0,
    maxAttempts: null,
    lastAttemptAt: null,
    context: null,
    ...overrides,
  };
}

function session(overrides: Partial<AccountSessionRecord> = {}): AccountSessionRecord {
  return {
    id: 'sess_123',
    accountId: 'acct_123',
    accountUserId: 'user_123',
    role: 'read_only',
    tokenHash: 'hash',
    createdAt: now,
    lastSeenAt: now,
    expiresAt: '2026-04-22T10:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

function delivery(overrides: Partial<HostedEmailDeliverySummary> = {}): HostedEmailDeliverySummary {
  return {
    deliveryId: 'edel_123',
    mode: 'manual',
    provider: 'manual',
    channel: 'api_response',
    delivered: true,
    recipient: 'new@example.com',
    messageId: null,
    actionUrl: null,
    tokenReturned: true,
    ...overrides,
  };
}

function createDeps(overrides: Partial<AccountUserManagementServiceDeps> = {}): AccountUserManagementServiceDeps {
  const baseUser = user();
  const deps: AccountUserManagementServiceDeps = {
    listAccountUsersByAccountIdState: async () => ({ records: [baseUser], path: null }),
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
    listAccountUserActionTokensByAccountIdState: async (_accountId, options) => ({
      records: [token({ purpose: options?.purpose ?? 'invite' })],
      path: null,
    }),
    findAccountUserActionTokenByTokenState: async () => token(),
    issueAccountInviteTokenState: async (input) => ({
      record: token({
        accountId: input.accountId,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
      }),
      token: 'invite_secret',
      path: null,
    }),
    revokeAccountUserActionTokenState: async (id) => ({
      record: token({ id, revokedAt: now }),
      path: null,
    }),
    consumeAccountUserActionTokenState: async (id) => ({
      record: token({ id, consumedAt: now }),
      path: null,
    }),
    findHostedAccountByIdState: async () => account(),
    findAccountUserByIdState: async (id) => user({ id }),
    recordAccountUserLoginState: async (id) => ({
      record: user({ id, lastLoginAt: now }),
      path: null,
    }),
    issueAccountSessionState: async (input) => ({
      sessionToken: 'session_secret',
      record: session({
        accountId: input.accountId,
        accountUserId: input.accountUserId,
        role: input.role,
      }),
      path: null,
    }),
    setAccountUserStatusState: async (id, status) => ({
      record: user({ id, status }),
      path: null,
    }),
    revokeAccountSessionsForUserState: async () => ({ revokedCount: 2, path: null }),
    revokeAccountUserActionTokensForUserState: async () => ({ revokedCount: 3, path: null }),
    issuePasswordResetTokenState: async (input) => ({
      record: token({
        id: 'reset_123',
        purpose: 'password_reset',
        accountId: input.accountId,
        accountUserId: input.accountUserId,
        email: input.email,
        displayName: null,
        role: null,
      }),
      token: 'reset_secret',
      path: null,
    }),
    setAccountUserPasswordState: async (id) => ({
      record: user({ id, passwordUpdatedAt: now }),
      path: null,
    }),
    deliverHostedInviteEmail: async () => delivery(),
    deliverHostedPasswordResetEmail: async () => delivery({ recipient: 'ops@example.com' }),
  };
  return {
    ...deps,
    ...overrides,
  };
}

async function testCreateUserValidatesPasswordAndRole(): Promise<void> {
  const service = createAccountUserManagementService(createDeps());
  const created = await service.createUser({
    accountId: 'acct_123',
    email: 'reader@example.com',
    displayName: 'Reader',
    password: 'long-enough-password',
    role: 'read_only',
  });

  assert.equal(created.email, 'reader@example.com');
  assert.equal(created.role, 'read_only');
}

async function testInviteDeliveryFailureRevokesIssuedToken(): Promise<void> {
  const calls: string[] = [];
  const service = createAccountUserManagementService(createDeps({
    revokeAccountUserActionTokenState: async (id) => {
      calls.push(`revoke:${id}`);
      return { record: token({ id, revokedAt: now }), path: null };
    },
    deliverHostedInviteEmail: async () => {
      throw new HostedEmailDeliveryError('SEND', 'smtp failed');
    },
  }));

  await assert.rejects(
    () => service.issueInvite({
      accountId: 'acct_123',
      actorUserId: 'user_admin',
      email: 'new@example.com',
      displayName: 'New User',
      role: 'read_only' as AccountUserRole,
      expiresHours: null,
    }),
    (error) => error instanceof AccountUserManagementServiceError
      && error.statusCode === 502
      && error.message === 'smtp failed',
  );
  assert.deepEqual(calls, ['revoke:atok_123']);
}

async function testAcceptInviteConsumesTokenAndIssuesSession(): Promise<void> {
  const calls: string[] = [];
  const service = createAccountUserManagementService(createDeps({
    consumeAccountUserActionTokenState: async (id) => {
      calls.push(`consume:${id}`);
      return { record: token({ id, consumedAt: now }), path: null };
    },
    issueAccountSessionState: async (input) => {
      calls.push(`session:${input.accountUserId}:${input.role}`);
      return {
        sessionToken: 'session_secret',
        record: session({
          accountId: input.accountId,
          accountUserId: input.accountUserId,
          role: input.role,
        }),
        path: null,
      };
    },
  }));

  const accepted = await service.acceptInvite({
    inviteToken: 'invite_secret',
    password: 'long-enough-password',
  });

  assert.equal(accepted.sessionToken, 'session_secret');
  assert.equal(accepted.user.lastLoginAt, now);
  assert.deepEqual(calls, [
    'consume:atok_123',
    'session:user_123:read_only',
  ]);
}

async function testDeactivationRevokesSessionsAndTokens(): Promise<void> {
  const service = createAccountUserManagementService(createDeps());

  const result = await service.setUserStatus('acct_123', 'user_123', 'inactive');

  assert.equal(result.record.status, 'inactive');
  assert.equal(result.revokedSessionCount, 2);
  assert.equal(result.revokedTokenCount, 3);
}

async function testConsumePasswordResetRevokesAndConsumes(): Promise<void> {
  const calls: string[] = [];
  const service = createAccountUserManagementService(createDeps({
    findAccountUserActionTokenByTokenState: async () => token({
      id: 'reset_123',
      purpose: 'password_reset',
      accountUserId: 'user_123',
      displayName: null,
      role: null,
    }),
    setAccountUserPasswordState: async (id) => {
      calls.push(`password:${id}`);
      return { record: user({ id }), path: null };
    },
    revokeAccountSessionsForUserState: async (id) => {
      calls.push(`sessions:${id}`);
      return { revokedCount: 1, path: null };
    },
    revokeAccountUserActionTokensForUserState: async (id, purpose) => {
      calls.push(`tokens:${id}:${purpose}`);
      return { revokedCount: 1, path: null };
    },
    consumeAccountUserActionTokenState: async (id) => {
      calls.push(`consume:${id}`);
      return { record: token({ id, consumedAt: now }), path: null };
    },
  }));

  await service.consumePasswordReset({
    resetToken: 'reset_secret',
    newPassword: 'long-enough-password',
  });

  assert.deepEqual(calls, [
    'password:user_123',
    'sessions:user_123',
    'tokens:user_123:password_reset',
    'consume:reset_123',
  ]);
}

await testCreateUserValidatesPasswordAndRole();
await testInviteDeliveryFailureRevokesIssuedToken();
await testAcceptInviteConsumesTokenAndIssuesSession();
await testDeactivationRevokesSessionsAndTokens();
await testConsumePasswordResetRevokesAndConsumes();

console.log('Service account user management service tests: 5 passed, 0 failed');
