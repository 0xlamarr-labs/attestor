import type * as ControlPlaneStore from '../control-plane-store.js';

export interface AccountStateService {
  findAccountUserByEmail: typeof ControlPlaneStore.findAccountUserByEmailState;
  issueAccountSession: typeof ControlPlaneStore.issueAccountSessionState;
  recordAccountUserLogin: typeof ControlPlaneStore.recordAccountUserLoginState;
  findHostedAccountById: typeof ControlPlaneStore.findHostedAccountByIdState;
  issueAccountMfaLoginToken: typeof ControlPlaneStore.issueAccountMfaLoginTokenState;
  issueAccountPasskeyChallengeToken: typeof ControlPlaneStore.issueAccountPasskeyChallengeTokenState;
  findAccountUserActionTokenByToken: typeof ControlPlaneStore.findAccountUserActionTokenByTokenState;
  findAccountUserById: typeof ControlPlaneStore.findAccountUserByIdState;
  findAccountUserByPasskeyCredentialId: typeof ControlPlaneStore.findAccountUserByPasskeyCredentialIdState;
  saveAccountUserRecord: typeof ControlPlaneStore.saveAccountUserRecordState;
  consumeAccountUserActionToken: typeof ControlPlaneStore.consumeAccountUserActionTokenState;
  revokeAccountUserActionTokensForUser: typeof ControlPlaneStore.revokeAccountUserActionTokensForUserState;
  recordHostedSamlReplay: typeof ControlPlaneStore.recordHostedSamlReplayState;
  findAccountUserBySamlIdentity: typeof ControlPlaneStore.findAccountUserBySamlIdentityState;
  findAccountUserByOidcIdentity: typeof ControlPlaneStore.findAccountUserByOidcIdentityState;
  getUsageContext: typeof ControlPlaneStore.getUsageContextState;
  setAccountUserPassword: typeof ControlPlaneStore.setAccountUserPasswordState;
  revokeAccountSessionsForUser: typeof ControlPlaneStore.revokeAccountSessionsForUserState;
  saveAccountUserActionTokenRecord: typeof ControlPlaneStore.saveAccountUserActionTokenRecordState;
  revokeAccountSessionByToken: typeof ControlPlaneStore.revokeAccountSessionByTokenState;
  listHostedEmailDeliveries: typeof ControlPlaneStore.listHostedEmailDeliveriesState;
}

export interface AccountStateServiceDeps extends AccountStateService {}

export function createAccountStateService(deps: AccountStateServiceDeps): AccountStateService {
  return {
    ...deps,
  };
}
