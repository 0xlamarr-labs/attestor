import type * as AccountMfa from '../account-mfa.js';
import type * as ControlPlaneStore from '../control-plane-store.js';
import type * as PlanCatalog from '../plan-catalog.js';
import type * as RateLimit from '../rate-limit.js';
import { AccountStoreError, type HostedAccountRecord } from '../account-store.js';
import type { AccountSessionRecord } from '../account-session-store.js';
import { AccountUserStoreError, type AccountUserRecord } from '../account-user-store.js';
import type { AccountUserActionTokenRecord } from '../account-user-token-store.js';
import { TenantKeyStoreError, type TenantKeyRecord } from '../tenant-key-store.js';
import type { TenantContext } from '../tenant-isolation.js';
import type { UsageContext } from '../usage-meter.js';

interface SyncHostedBillingEntitlementOptions {
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
}

export interface AccountAuthCurrentAccount {
  tenant: TenantContext;
  account: HostedAccountRecord;
  usage: UsageContext;
  rateLimit: RateLimit.TenantRateLimitContext;
}

export interface AccountAuthBootstrapInput {
  current: AccountAuthCurrentAccount;
  email: string;
  displayName: string;
  password: string;
}

export interface AccountAuthBootstrapResult {
  user: AccountUserRecord;
}

export interface AccountAuthSignupInput {
  accountName: string;
  email: string;
  displayName: string;
  password: string;
}

export interface AccountAuthSignupResult {
  sessionToken: string;
  session: AccountSessionRecord;
  user: AccountUserRecord;
  account: HostedAccountRecord;
  initialKey: TenantKeyRecord;
  apiKey: string;
  commercial: {
    currentPhase: 'evaluation' | 'paid';
    includedMonthlyRunQuota: number | null;
    firstHostedPlanId: string;
    firstHostedPlanTrialDays: number | null;
  };
}

export interface AccountAuthLoginInput {
  email: string;
  password: string;
}

export interface AccountAuthLoginSessionResult {
  mfaRequired: false;
  sessionToken: string;
  session: AccountSessionRecord;
  user: AccountUserRecord;
  account: HostedAccountRecord;
}

export interface AccountAuthLoginMfaResult {
  mfaRequired: true;
  challengeToken: string;
  challenge: {
    id: string;
    method: 'totp';
    expiresAt: string;
    maxAttempts: number | null;
    remainingAttempts: number | null;
  };
  user: AccountUserRecord;
  account: HostedAccountRecord;
}

export type AccountAuthLoginResult = AccountAuthLoginSessionResult | AccountAuthLoginMfaResult;

export interface AccountAuthService {
  bootstrapFirstUser(input: AccountAuthBootstrapInput): Promise<AccountAuthBootstrapResult>;
  signup(input: AccountAuthSignupInput): Promise<AccountAuthSignupResult>;
  login(input: AccountAuthLoginInput): Promise<AccountAuthLoginResult>;
}

export interface AccountAuthServiceDeps {
  countAccountUsersForAccountState: typeof ControlPlaneStore.countAccountUsersForAccountState;
  createAccountUserState: typeof ControlPlaneStore.createAccountUserState;
  findAccountUserByEmailState: typeof ControlPlaneStore.findAccountUserByEmailState;
  deriveSignupTenantId(accountName: string, email: string): string;
  resolvePlanSpec: typeof PlanCatalog.resolvePlanSpec;
  SELF_HOST_PLAN_ID: typeof PlanCatalog.SELF_HOST_PLAN_ID;
  DEFAULT_HOSTED_PLAN_ID: typeof PlanCatalog.DEFAULT_HOSTED_PLAN_ID;
  resolvePlanStripeTrialDays: typeof PlanCatalog.resolvePlanStripeTrialDays;
  provisionHostedAccountState: typeof ControlPlaneStore.provisionHostedAccountState;
  issueAccountSessionState: typeof ControlPlaneStore.issueAccountSessionState;
  recordAccountUserLoginState: typeof ControlPlaneStore.recordAccountUserLoginState;
  syncHostedBillingEntitlementForTenant(
    tenantId: string,
    options?: SyncHostedBillingEntitlementOptions,
  ): Promise<unknown>;
  verifyAccountUserPasswordRecord: typeof import('../account-user-store.js').verifyAccountUserPasswordRecord;
  findHostedAccountByIdState: typeof ControlPlaneStore.findHostedAccountByIdState;
  totpSummary: typeof AccountMfa.totpSummary;
  issueAccountMfaLoginTokenState: typeof ControlPlaneStore.issueAccountMfaLoginTokenState;
}

export class AccountAuthServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'AccountAuthServiceError';
  }
}

function requireNonEmpty(value: string, fieldList: string): void {
  if (!value) {
    throw new AccountAuthServiceError(400, `${fieldList} are required.`);
  }
}

function requirePasswordLength(password: string, fieldName = 'password'): void {
  if (password.length < 12) {
    throw new AccountAuthServiceError(400, `${fieldName} must be at least 12 characters long.`);
  }
}

function mapStoreError(error: unknown): AccountAuthServiceError | null {
  if (error instanceof AccountUserStoreError) {
    return new AccountAuthServiceError(error.code === 'NOT_FOUND' ? 404 : 409, error.message);
  }
  if (error instanceof AccountStoreError) {
    return new AccountAuthServiceError(error.code === 'NOT_FOUND' ? 404 : 409, error.message);
  }
  if (error instanceof TenantKeyStoreError) {
    return new AccountAuthServiceError(error.code === 'NOT_FOUND' ? 404 : 409, error.message);
  }
  return null;
}

function mfaChallengeView(record: AccountUserActionTokenRecord) {
  return {
    id: record.id,
    method: 'totp' as const,
    expiresAt: record.expiresAt,
    maxAttempts: record.maxAttempts,
    remainingAttempts: record.maxAttempts === null
      ? null
      : Math.max(record.maxAttempts - record.attemptCount, 0),
  };
}

export function createAccountAuthService(deps: AccountAuthServiceDeps): AccountAuthService {
  return {
    async bootstrapFirstUser(input) {
      if (input.current.tenant.source !== 'api_key') {
        throw new AccountAuthServiceError(403, 'Bootstrap requires a tenant API key.');
      }
      requireNonEmpty(input.email && input.displayName && input.password, 'email, displayName, and password');
      requirePasswordLength(input.password);

      const existingUsers = await deps.countAccountUsersForAccountState(input.current.account.id);
      if (existingUsers > 0) {
        throw new AccountAuthServiceError(
          409,
          `Hosted account '${input.current.account.id}' already has account users. Use an account_admin session to manage users.`,
        );
      }

      try {
        const created = await deps.createAccountUserState({
          accountId: input.current.account.id,
          email: input.email,
          displayName: input.displayName,
          password: input.password,
          role: 'account_admin',
        });
        return { user: created.record };
      } catch (error) {
        const mapped = mapStoreError(error);
        if (mapped) throw mapped;
        throw error;
      }
    },

    async signup(input) {
      requireNonEmpty(
        input.accountName && input.email && input.displayName && input.password,
        'accountName, email, displayName, and password',
      );
      requirePasswordLength(input.password);

      const existingUser = await deps.findAccountUserByEmailState(input.email);
      if (existingUser) {
        throw new AccountAuthServiceError(409, `Account user '${input.email}' already exists.`);
      }

      let resolvedPlan: PlanCatalog.ResolvedPlanSpec;
      try {
        resolvedPlan = deps.resolvePlanSpec({
          planId: deps.SELF_HOST_PLAN_ID,
          defaultPlanId: deps.SELF_HOST_PLAN_ID,
        });
      } catch (error) {
        throw new AccountAuthServiceError(
          400,
          error instanceof Error ? error.message : String(error),
        );
      }

      const tenantId = deps.deriveSignupTenantId(input.accountName, input.email);
      let provisioned: Awaited<ReturnType<typeof deps.provisionHostedAccountState>>;
      try {
        provisioned = await deps.provisionHostedAccountState({
          account: {
            accountName: input.accountName,
            contactEmail: input.email,
            primaryTenantId: tenantId,
          },
          key: {
            tenantId,
            tenantName: input.accountName,
            planId: resolvedPlan.planId,
            monthlyRunQuota: resolvedPlan.monthlyRunQuota,
          },
        });
      } catch (error) {
        const mapped = mapStoreError(error);
        if (mapped) throw mapped;
        throw error;
      }

      let createdUser: Awaited<ReturnType<typeof deps.createAccountUserState>>;
      try {
        createdUser = await deps.createAccountUserState({
          accountId: provisioned.account.id,
          email: input.email,
          displayName: input.displayName,
          password: input.password,
          role: 'account_admin',
        });
      } catch (error) {
        const mapped = mapStoreError(error);
        if (mapped) throw mapped;
        throw error;
      }

      const issued = await deps.issueAccountSessionState({
        accountId: provisioned.account.id,
        accountUserId: createdUser.record.id,
        role: createdUser.record.role,
      });
      const loginTouch = await deps.recordAccountUserLoginState(createdUser.record.id);
      await deps.syncHostedBillingEntitlementForTenant(provisioned.account.primaryTenantId, {
        lastEventType: 'auth.signup',
        lastEventAt: new Date().toISOString(),
      });

      return {
        sessionToken: issued.sessionToken,
        session: issued.record,
        user: loginTouch.record,
        account: provisioned.account,
        initialKey: provisioned.initialKey,
        apiKey: provisioned.apiKey,
        commercial: {
          currentPhase: resolvedPlan.plan?.intendedFor === 'self_host' ? 'evaluation' : 'paid',
          includedMonthlyRunQuota: resolvedPlan.monthlyRunQuota,
          firstHostedPlanId: deps.DEFAULT_HOSTED_PLAN_ID,
          firstHostedPlanTrialDays: deps.resolvePlanStripeTrialDays(deps.DEFAULT_HOSTED_PLAN_ID).trialDays,
        },
      };
    },

    async login(input) {
      requireNonEmpty(input.email && input.password, 'email and password');

      const user = await deps.findAccountUserByEmailState(input.email);
      if (!user || !deps.verifyAccountUserPasswordRecord(user.password, input.password)) {
        throw new AccountAuthServiceError(401, 'Invalid email or password.');
      }
      if (user.status !== 'active') {
        throw new AccountAuthServiceError(403, `Account user '${user.email}' is inactive.`);
      }

      const account = await deps.findHostedAccountByIdState(user.accountId);
      if (!account) {
        throw new AccountAuthServiceError(404, `Hosted account '${user.accountId}' was not found.`);
      }
      if (account.status === 'archived') {
        throw new AccountAuthServiceError(
          403,
          `Hosted account '${account.id}' is archived and cannot accept new sessions.`,
        );
      }

      const userTotp = deps.totpSummary(user.mfa.totp);
      if (userTotp.enabled) {
        const issued = await deps.issueAccountMfaLoginTokenState({
          accountId: account.id,
          accountUserId: user.id,
          email: user.email,
        });
        return {
          mfaRequired: true,
          challengeToken: issued.token,
          challenge: mfaChallengeView(issued.record),
          user,
          account,
        };
      }

      const issued = await deps.issueAccountSessionState({
        accountId: account.id,
        accountUserId: user.id,
        role: user.role,
      });
      const loginTouch = await deps.recordAccountUserLoginState(user.id);
      return {
        mfaRequired: false,
        sessionToken: issued.sessionToken,
        session: issued.record,
        user: loginTouch.record,
        account,
      };
    },
  };
}
