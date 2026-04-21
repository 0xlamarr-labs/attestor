import type { HostedAccountRecord } from '../account-store.js';
import type * as AccountSessionStore from '../account-session-store.js';
import {
  AccountUserStoreError,
  type AccountUserRecord,
  type AccountUserRole,
} from '../account-user-store.js';
import type { AccountUserActionTokenRecord } from '../account-user-token-store.js';
import type * as ControlPlaneStore from '../control-plane-store.js';
import {
  HostedEmailDeliveryError,
  type HostedEmailDeliverySummary,
} from '../email-delivery.js';

export interface AccountUserCreateInput {
  accountId: string;
  email: string;
  displayName: string;
  password: string;
  role: AccountUserRole;
}

export interface AccountUserInviteInput {
  accountId: string;
  actorUserId: string;
  email: string;
  displayName: string;
  role: AccountUserRole;
  expiresHours: number | null;
}

export interface AccountUserInviteResult {
  record: AccountUserActionTokenRecord;
  token: string;
  delivery: HostedEmailDeliverySummary;
}

export interface AccountUserInviteAcceptInput {
  inviteToken: string;
  password: string;
}

export interface AccountUserInviteAcceptResult {
  user: AccountUserRecord;
  account: HostedAccountRecord;
  sessionToken: string;
  session: AccountSessionStore.AccountSessionRecord;
}

export interface AccountUserPasswordResetIssueInput {
  accountId: string;
  actorUserId: string;
  targetUserId: string;
  ttlMinutes: number | null;
}

export interface AccountUserPasswordResetIssueResult {
  record: AccountUserActionTokenRecord;
  token: string;
  delivery: HostedEmailDeliverySummary;
}

export interface AccountUserPasswordResetConsumeInput {
  resetToken: string;
  newPassword: string;
}

export interface AccountUserStatusResult {
  record: AccountUserRecord;
  revokedSessionCount: number;
  revokedTokenCount: number;
}

export interface AccountUserManagementService {
  listUsers(accountId: string): Promise<AccountUserRecord[]>;
  createUser(input: AccountUserCreateInput): Promise<AccountUserRecord>;
  listInvites(accountId: string): Promise<AccountUserActionTokenRecord[]>;
  issueInvite(input: AccountUserInviteInput): Promise<AccountUserInviteResult>;
  revokeInvite(accountId: string, inviteId: string): Promise<AccountUserActionTokenRecord>;
  acceptInvite(input: AccountUserInviteAcceptInput): Promise<AccountUserInviteAcceptResult>;
  setUserStatus(accountId: string, userId: string, status: 'active' | 'inactive'): Promise<AccountUserStatusResult>;
  issuePasswordReset(input: AccountUserPasswordResetIssueInput): Promise<AccountUserPasswordResetIssueResult>;
  consumePasswordReset(input: AccountUserPasswordResetConsumeInput): Promise<void>;
}

export interface AccountUserManagementServiceDeps {
  listAccountUsersByAccountIdState: typeof ControlPlaneStore.listAccountUsersByAccountIdState;
  createAccountUserState: typeof ControlPlaneStore.createAccountUserState;
  findAccountUserByEmailState: typeof ControlPlaneStore.findAccountUserByEmailState;
  listAccountUserActionTokensByAccountIdState: typeof ControlPlaneStore.listAccountUserActionTokensByAccountIdState;
  findAccountUserActionTokenByTokenState: typeof ControlPlaneStore.findAccountUserActionTokenByTokenState;
  issueAccountInviteTokenState: typeof ControlPlaneStore.issueAccountInviteTokenState;
  revokeAccountUserActionTokenState: typeof ControlPlaneStore.revokeAccountUserActionTokenState;
  consumeAccountUserActionTokenState: typeof ControlPlaneStore.consumeAccountUserActionTokenState;
  findHostedAccountByIdState: typeof ControlPlaneStore.findHostedAccountByIdState;
  findAccountUserByIdState: typeof ControlPlaneStore.findAccountUserByIdState;
  recordAccountUserLoginState: typeof ControlPlaneStore.recordAccountUserLoginState;
  issueAccountSessionState: typeof ControlPlaneStore.issueAccountSessionState;
  setAccountUserStatusState: typeof ControlPlaneStore.setAccountUserStatusState;
  revokeAccountSessionsForUserState: typeof ControlPlaneStore.revokeAccountSessionsForUserState;
  revokeAccountUserActionTokensForUserState: typeof ControlPlaneStore.revokeAccountUserActionTokensForUserState;
  issuePasswordResetTokenState: typeof ControlPlaneStore.issuePasswordResetTokenState;
  setAccountUserPasswordState: typeof ControlPlaneStore.setAccountUserPasswordState;
  deliverHostedInviteEmail: typeof import('../email-delivery.js').deliverHostedInviteEmail;
  deliverHostedPasswordResetEmail: typeof import('../email-delivery.js').deliverHostedPasswordResetEmail;
}

export class AccountUserManagementServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'AccountUserManagementServiceError';
  }
}

function requirePasswordLength(password: string, fieldName = 'password'): void {
  if (password.length < 12) {
    throw new AccountUserManagementServiceError(400, `${fieldName} must be at least 12 characters long.`);
  }
}

function requireNonEmpty(value: string, message: string): void {
  if (!value) throw new AccountUserManagementServiceError(400, message);
}

function mapUserServiceError(error: unknown): AccountUserManagementServiceError | null {
  if (error instanceof AccountUserManagementServiceError) return error;
  if (error instanceof AccountUserStoreError) {
    return new AccountUserManagementServiceError(error.code === 'NOT_FOUND' ? 404 : 409, error.message);
  }
  if (error instanceof HostedEmailDeliveryError) {
    return new AccountUserManagementServiceError(error.code === 'CONFIG' ? 503 : 502, error.message);
  }
  return null;
}

function throwMappedError(error: unknown): never {
  const mapped = mapUserServiceError(error);
  if (mapped) throw mapped;
  throw error;
}

async function requireAccount(
  deps: AccountUserManagementServiceDeps,
  accountId: string,
  options?: { allowArchived?: boolean },
): Promise<HostedAccountRecord> {
  const account = await deps.findHostedAccountByIdState(accountId);
  if (!account || (!options?.allowArchived && account.status === 'archived')) {
    throw new AccountUserManagementServiceError(404, `Hosted account '${accountId}' was not found.`);
  }
  return account;
}

async function requireAccountUser(
  deps: AccountUserManagementServiceDeps,
  accountId: string,
  userId: string,
): Promise<AccountUserRecord> {
  const user = await deps.findAccountUserByIdState(userId);
  if (!user || user.accountId !== accountId) {
    throw new AccountUserManagementServiceError(404, `Account user '${userId}' was not found.`);
  }
  return user;
}

export function createAccountUserManagementService(
  deps: AccountUserManagementServiceDeps,
): AccountUserManagementService {
  return {
    async listUsers(accountId) {
      const users = await deps.listAccountUsersByAccountIdState(accountId);
      return users.records;
    },

    async createUser(input) {
      requireNonEmpty(
        input.email && input.displayName && input.password && input.role,
        'email, displayName, password, and role are required.',
      );
      requirePasswordLength(input.password);
      try {
        const created = await deps.createAccountUserState({
          accountId: input.accountId,
          email: input.email,
          displayName: input.displayName,
          password: input.password,
          role: input.role,
        });
        return created.record;
      } catch (error) {
        throwMappedError(error);
      }
    },

    async listInvites(accountId) {
      const invites = await deps.listAccountUserActionTokensByAccountIdState(accountId, { purpose: 'invite' });
      return invites.records;
    },

    async issueInvite(input) {
      requireNonEmpty(input.email && input.displayName && input.role, 'email, displayName, and role are required.');
      const account = await requireAccount(deps, input.accountId);
      const existing = await deps.findAccountUserByEmailState(input.email);
      if (existing) {
        throw new AccountUserManagementServiceError(409, `Account user '${input.email}' already exists.`);
      }
      const issued = await deps.issueAccountInviteTokenState({
        accountId: input.accountId,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        issuedByAccountUserId: input.actorUserId,
        ttlHours: input.expiresHours,
      });
      try {
        const delivery = await deps.deliverHostedInviteEmail({
          accountId: input.accountId,
          accountUserId: null,
          recipientEmail: input.email,
          displayName: input.displayName,
          role: input.role,
          accountName: account.accountName,
          token: issued.token,
        });
        return {
          record: issued.record,
          token: issued.token,
          delivery,
        };
      } catch (error) {
        await deps.revokeAccountUserActionTokenState(issued.record.id);
        throwMappedError(error);
      }
    },

    async revokeInvite(accountId, inviteId) {
      const invites = await deps.listAccountUserActionTokensByAccountIdState(accountId, { purpose: 'invite' });
      const target = invites.records.find((entry) => entry.id === inviteId) ?? null;
      if (!target) {
        throw new AccountUserManagementServiceError(404, `Invite '${inviteId}' was not found.`);
      }
      const revoked = await deps.revokeAccountUserActionTokenState(target.id);
      return revoked.record ?? target;
    },

    async acceptInvite(input) {
      requireNonEmpty(input.inviteToken && input.password, 'inviteToken and password are required.');
      requirePasswordLength(input.password);
      const invite = await deps.findAccountUserActionTokenByTokenState(input.inviteToken);
      if (!invite || invite.purpose !== 'invite' || !invite.role || !invite.displayName) {
        throw new AccountUserManagementServiceError(400, 'Invite token is invalid or expired.');
      }
      const account = await deps.findHostedAccountByIdState(invite.accountId);
      if (!account || account.status === 'archived') {
        throw new AccountUserManagementServiceError(404, 'Invite account is not available.');
      }
      const existing = await deps.findAccountUserByEmailState(invite.email);
      if (existing) {
        throw new AccountUserManagementServiceError(409, `Account user '${invite.email}' already exists.`);
      }
      try {
        const created = await deps.createAccountUserState({
          accountId: invite.accountId,
          email: invite.email,
          displayName: invite.displayName,
          password: input.password,
          role: invite.role,
        });
        await deps.consumeAccountUserActionTokenState(invite.id);
        const loginTouch = await deps.recordAccountUserLoginState(created.record.id);
        const issued = await deps.issueAccountSessionState({
          accountId: invite.accountId,
          accountUserId: created.record.id,
          role: created.record.role,
        });
        return {
          user: loginTouch.record,
          account,
          sessionToken: issued.sessionToken,
          session: issued.record,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async setUserStatus(accountId, userId, status) {
      const user = await requireAccountUser(deps, accountId, userId);
      try {
        const updated = await deps.setAccountUserStatusState(user.id, status);
        let revokedSessionCount = 0;
        let revokedTokenCount = 0;
        if (status === 'inactive') {
          const revokedSessions = await deps.revokeAccountSessionsForUserState(user.id);
          const revokedTokens = await deps.revokeAccountUserActionTokensForUserState(user.id);
          revokedSessionCount = revokedSessions.revokedCount;
          revokedTokenCount = revokedTokens.revokedCount;
        }
        return {
          record: updated.record,
          revokedSessionCount,
          revokedTokenCount,
        };
      } catch (error) {
        throwMappedError(error);
      }
    },

    async issuePasswordReset(input) {
      const account = await requireAccount(deps, input.accountId);
      const user = await requireAccountUser(deps, input.accountId, input.targetUserId);
      const issued = await deps.issuePasswordResetTokenState({
        accountId: input.accountId,
        accountUserId: user.id,
        email: user.email,
        issuedByAccountUserId: input.actorUserId,
        ttlMinutes: input.ttlMinutes,
      });
      try {
        const delivery = await deps.deliverHostedPasswordResetEmail({
          accountId: input.accountId,
          accountUserId: user.id,
          recipientEmail: user.email,
          displayName: user.displayName,
          accountName: account.accountName,
          token: issued.token,
        });
        return {
          record: issued.record,
          token: issued.token,
          delivery,
        };
      } catch (error) {
        await deps.revokeAccountUserActionTokenState(issued.record.id);
        throwMappedError(error);
      }
    },

    async consumePasswordReset(input) {
      requireNonEmpty(input.resetToken && input.newPassword, 'resetToken and newPassword are required.');
      requirePasswordLength(input.newPassword, 'newPassword');
      const tokenRecord = await deps.findAccountUserActionTokenByTokenState(input.resetToken);
      if (!tokenRecord || tokenRecord.purpose !== 'password_reset' || !tokenRecord.accountUserId) {
        throw new AccountUserManagementServiceError(400, 'Password reset token is invalid or expired.');
      }
      const user = await deps.findAccountUserByIdState(tokenRecord.accountUserId);
      const account = user ? await deps.findHostedAccountByIdState(user.accountId) : null;
      if (!user || !account || account.id !== tokenRecord.accountId || account.status === 'archived') {
        throw new AccountUserManagementServiceError(400, 'Password reset token is invalid or expired.');
      }
      await deps.setAccountUserPasswordState(user.id, input.newPassword);
      await deps.revokeAccountSessionsForUserState(user.id);
      await deps.revokeAccountUserActionTokensForUserState(user.id, 'password_reset');
      await deps.consumeAccountUserActionTokenState(tokenRecord.id);
    },
  };
}
