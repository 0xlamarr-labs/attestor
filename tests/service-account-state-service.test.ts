import assert from 'node:assert/strict';
import {
  createAccountStateService,
  type AccountStateServiceDeps,
} from '../src/service/application/account-state-service.js';

function createDeps(): AccountStateServiceDeps {
  return {
    findAccountUserByEmail: async () => null,
    issueAccountSession: async () => ({
      sessionToken: 'session_secret',
      record: {
        id: 'sess_123',
        accountId: 'acct_123',
        accountUserId: 'user_123',
        role: 'account_admin',
        tokenHash: 'hash',
        createdAt: '2026-04-21T10:00:00.000Z',
        lastSeenAt: '2026-04-21T10:00:00.000Z',
        expiresAt: '2026-04-22T10:00:00.000Z',
        revokedAt: null,
      },
      path: null,
    }),
    recordAccountUserLogin: async () => {
      throw new Error('unused');
    },
    findHostedAccountById: async () => null,
    issueAccountMfaLoginToken: async () => {
      throw new Error('unused');
    },
    issueAccountPasskeyChallengeToken: async () => {
      throw new Error('unused');
    },
    findAccountUserActionTokenByToken: async () => null,
    findAccountUserById: async () => null,
    findAccountUserByPasskeyCredentialId: async () => null,
    saveAccountUserRecord: async (record) => ({ record, path: null }),
    consumeAccountUserActionToken: async () => {
      throw new Error('unused');
    },
    revokeAccountUserActionTokensForUser: async () => ({ revokedCount: 0, path: null }),
    recordHostedSamlReplay: async (record) => ({
      duplicate: false,
      record,
      existing: null,
      path: null,
    }),
    findAccountUserBySamlIdentity: async () => null,
    findAccountUserByOidcIdentity: async () => null,
    getUsageContext: async (tenantId, planId, monthlyRunQuota) => ({
      tenantId,
      planId,
      monthlyRunQuota,
      period: '2026-04',
      used: 0,
      remaining: monthlyRunQuota,
      enforced: monthlyRunQuota !== null,
      updatedAt: '2026-04-21T10:00:00.000Z',
    }),
    setAccountUserPassword: async () => {
      throw new Error('unused');
    },
    revokeAccountSessionsForUser: async () => ({ revokedCount: 0, path: null }),
    saveAccountUserActionTokenRecord: async (record) => ({ record, path: null }),
    revokeAccountSessionByToken: async () => ({ record: null, path: null }),
    listHostedEmailDeliveries: async () => ({ records: [], path: null }),
  };
}

async function testStateServiceExposesTypedPortMethods(): Promise<void> {
  const service = createAccountStateService(createDeps());

  const session = await service.issueAccountSession({
    accountId: 'acct_123',
    accountUserId: 'user_123',
    role: 'account_admin',
  });
  const usage = await service.getUsageContext('tenant_123', 'pro', 10);
  const deliveries = await service.listHostedEmailDeliveries({ accountId: 'acct_123' });

  assert.equal(session.sessionToken, 'session_secret');
  assert.equal(usage.remaining, 10);
  assert.deepEqual(deliveries.records, []);
}

await testStateServiceExposesTypedPortMethods();

console.log('Service account state service tests: 1 passed, 0 failed');
