import type { Context, Hono } from 'hono';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type * as AccountMfa from '../../account-mfa.js';
import type * as AccountOidc from '../../account-oidc.js';
import type * as AccountPasskeys from '../../account-passkeys.js';
import type * as AccountSessionStore from '../../account-session-store.js';
import type * as AccountSaml from '../../account-saml.js';
import type * as AccountUserStore from '../../account-user-store.js';
import type * as BillingExport from '../../billing-export.js';
import type * as BillingFeatureService from '../../billing-feature-service.js';
import type * as BillingReconciliation from '../../billing-reconciliation.js';
import type * as ControlPlaneStore from '../../control-plane-store.js';
import type * as EmailDelivery from '../../email-delivery.js';
import type { HostedEmailDeliveryProvider, HostedEmailDeliveryStatus } from '../../email-delivery-event-store.js';
import type * as PlanCatalog from '../../plan-catalog.js';
import type * as RateLimit from '../../rate-limit.js';
import type { SecretEnvelopeStatus } from '../../secret-envelope.js';
import type * as StripeBilling from '../../stripe-billing.js';
import { AccountAuthServiceError, type AccountAuthService } from '../../application/account-auth-service.js';
import type { HostedAccountRecord } from '../../account-store.js';
import type {
  AccountUserPasskeyCredentialRecord,
  AccountUserRecord,
  AccountUserRole,
} from '../../account-user-store.js';
import type { AccountUserActionTokenRecord } from '../../account-user-token-store.js';
import type { HostedBillingEntitlementRecord } from '../../billing-entitlement-store.js';
import type { HostedPasskeyAuthenticationChallengeState, HostedPasskeyAuthenticatorHint, HostedPasskeyRegistrationChallengeState } from '../../account-passkeys.js';
import type { TenantKeyRecord } from '../../tenant-key-store.js';
import type { AccountAccessContext, TenantContext } from '../../tenant-isolation.js';
import type { UsageContext } from '../../usage-meter.js';

interface SyncHostedBillingEntitlementOptions {
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
}

interface CurrentHostedAccountResult {
  tenant: TenantContext;
  account: HostedAccountRecord;
  usage: UsageContext;
  rateLimit: RateLimit.TenantRateLimitContext;
}

function accountRouteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function accountAuthServiceErrorResponse(context: Context, error: unknown): Response | null {
  if (!(error instanceof AccountAuthServiceError)) return null;
  return context.json({ error: error.message }, error.statusCode);
}

function accountUserRoleFilter(value: unknown): AccountUserRole | null {
  switch (value) {
    case 'account_admin':
    case 'billing_admin':
    case 'read_only':
      return value;
    default:
      return null;
  }
}

function hostedEmailDeliveryStatusFilter(value: string | undefined): HostedEmailDeliveryStatus | null {
  switch (value) {
    case 'manual_delivered':
    case 'smtp_sent':
    case 'processed':
    case 'delivered':
    case 'deferred':
    case 'bounced':
    case 'dropped':
    case 'failed':
    case 'unknown':
      return value;
    default:
      return null;
  }
}

function hostedEmailDeliveryProviderFilter(value: string | undefined): HostedEmailDeliveryProvider | null {
  switch (value) {
    case 'manual':
    case 'smtp':
    case 'sendgrid_smtp':
    case 'mailgun_smtp':
      return value;
    default:
      return null;
  }
}

export interface AccountRouteDeps {
  authService: AccountAuthService;
  currentHostedAccount(context: Context): Promise<CurrentHostedAccountResult | Response>;
  createAccountUserState: typeof ControlPlaneStore.createAccountUserState;
  AccountUserStoreError: typeof AccountUserStore.AccountUserStoreError;
  findAccountUserByEmailState: typeof ControlPlaneStore.findAccountUserByEmailState;
  resolvePlanSpec: typeof PlanCatalog.resolvePlanSpec;
  SELF_HOST_PLAN_ID: typeof PlanCatalog.SELF_HOST_PLAN_ID;
  tenantKeyStoreErrorResponse(context: Context, error: unknown): Response | null;
  issueAccountSessionState: typeof ControlPlaneStore.issueAccountSessionState;
  recordAccountUserLoginState: typeof ControlPlaneStore.recordAccountUserLoginState;
  syncHostedBillingEntitlementForTenant(
    tenantId: string,
    options?: SyncHostedBillingEntitlementOptions,
  ): Promise<HostedBillingEntitlementRecord | null>;
  setSessionCookieForRecord(context: Context, sessionToken: string, expiresAt: string): void;
  accountUserView(record: AccountUserRecord): Record<string, unknown>;
  adminAccountView(record: HostedAccountRecord): Record<string, unknown>;
  accountApiKeyView(record: TenantKeyRecord): Record<string, unknown>;
  verifyAccountUserPasswordRecord: typeof AccountUserStore.verifyAccountUserPasswordRecord;
  findHostedAccountByIdState: typeof ControlPlaneStore.findHostedAccountByIdState;
  totpSummary: typeof AccountMfa.totpSummary;
  issueAccountMfaLoginTokenState: typeof ControlPlaneStore.issueAccountMfaLoginTokenState;
  issueAccountPasskeyChallengeTokenState: typeof ControlPlaneStore.issueAccountPasskeyChallengeTokenState;
  buildHostedPasskeyAuthenticationOptions: typeof AccountPasskeys.buildHostedPasskeyAuthenticationOptions;
  asAuthenticationResponse(value: unknown): AuthenticationResponseJSON | null;
  findAccountUserActionTokenByTokenState: typeof ControlPlaneStore.findAccountUserActionTokenByTokenState;
  parsePasskeyAuthenticationChallenge(
    record: AccountUserActionTokenRecord,
  ): HostedPasskeyAuthenticationChallengeState | null;
  findAccountUserByIdState: typeof ControlPlaneStore.findAccountUserByIdState;
  findAccountUserByPasskeyCredentialIdState: typeof ControlPlaneStore.findAccountUserByPasskeyCredentialIdState;
  verifyHostedPasskeyAuthentication: typeof AccountPasskeys.verifyHostedPasskeyAuthentication;
  passkeyCredentialToWebAuthnCredential: typeof AccountPasskeys.passkeyCredentialToWebAuthnCredential;
  saveAccountUserRecordState: typeof ControlPlaneStore.saveAccountUserRecordState;
  consumeAccountUserActionTokenState: typeof ControlPlaneStore.consumeAccountUserActionTokenState;
  revokeAccountUserActionTokensForUserState: typeof ControlPlaneStore.revokeAccountUserActionTokensForUserState;
  getHostedSamlMetadata: typeof AccountSaml.getHostedSamlMetadata;
  buildHostedSamlAuthorizationRequest: typeof AccountSaml.buildHostedSamlAuthorizationRequest;
  completeHostedSamlAuthorization: typeof AccountSaml.completeHostedSamlAuthorization;
  recordHostedSamlReplayState: typeof ControlPlaneStore.recordHostedSamlReplayState;
  findAccountUserBySamlIdentityState: typeof ControlPlaneStore.findAccountUserBySamlIdentityState;
  hostedSamlAllowsAutomaticLinking: typeof AccountSaml.hostedSamlAllowsAutomaticLinking;
  linkAccountUserSamlIdentity: typeof AccountSaml.linkAccountUserSamlIdentity;
  buildHostedOidcAuthorizationRequest: typeof AccountOidc.buildHostedOidcAuthorizationRequest;
  completeHostedOidcAuthorization: typeof AccountOidc.completeHostedOidcAuthorization;
  findAccountUserByOidcIdentityState: typeof ControlPlaneStore.findAccountUserByOidcIdentityState;
  hostedOidcAllowsAutomaticLinking: typeof AccountOidc.hostedOidcAllowsAutomaticLinking;
  linkAccountUserOidcIdentity: typeof AccountOidc.linkAccountUserOidcIdentity;
  verifyTotpCode: typeof AccountMfa.verifyTotpCode;
  verifyAndConsumeRecoveryCode: typeof AccountMfa.verifyAndConsumeRecoveryCode;
  requireAccountSession(
    context: Context,
    options?: {
      roles?: AccountUserRole[];
      allowApiKey?: boolean;
    },
  ): Response | null;
  currentAccountAccess(context: Context): AccountAccessContext | null;
  buildHostedPasskeyRegistrationOptions: typeof AccountPasskeys.buildHostedPasskeyRegistrationOptions;
  parsePasskeyRegistrationChallenge(
    record: AccountUserActionTokenRecord,
  ): HostedPasskeyRegistrationChallengeState | null;
  asRegistrationResponse(value: unknown): RegistrationResponseJSON | null;
  verifyHostedPasskeyRegistration: typeof AccountPasskeys.verifyHostedPasskeyRegistration;
  buildAccountUserPasskeyCredentialRecord: typeof AccountPasskeys.buildAccountUserPasskeyCredentialRecord;
  generateHostedPasskeyUserHandle: typeof AccountPasskeys.generateHostedPasskeyUserHandle;
  accountUserDetailedMfaView(record: AccountUserRecord): ReturnType<typeof AccountMfa.totpSummary>;
  accountUserDetailedOidcView(
    record: AccountUserRecord,
    requestOrigin?: string | URL | null,
  ): Record<string, unknown>;
  accountUserDetailedSamlView(
    record: AccountUserRecord,
    requestOrigin?: string | URL | null,
  ): Record<string, unknown>;
  accountUserDetailedPasskeyView(record: AccountUserRecord): Record<string, unknown>;
  accountPasskeyCredentialView(record: AccountUserPasskeyCredentialRecord): Record<string, unknown>;
  decryptTotpSecret: typeof AccountMfa.decryptTotpSecret;
  getSecretEnvelopeStatus(): SecretEnvelopeStatus;
  encryptTotpSecret: typeof AccountMfa.encryptTotpSecret;
  generateRecoveryCodes: typeof AccountMfa.generateRecoveryCodes;
  generateTotpSecretBase32: typeof AccountMfa.generateTotpSecretBase32;
  buildTotpOtpAuthUrl: typeof AccountMfa.buildTotpOtpAuthUrl;
  normalizePasskeyAuthenticatorHint(value: unknown): HostedPasskeyAuthenticatorHint | null;
  currentAccountRole(context: Context): AccountUserRole | null;
  findTenantRecordByTenantIdState: typeof ControlPlaneStore.findTenantRecordByTenantIdState;
  getTenantPipelineRateLimit: typeof RateLimit.getTenantPipelineRateLimit;
  getUsageContextState: typeof ControlPlaneStore.getUsageContextState;
  readHostedBillingEntitlement(account: HostedAccountRecord): Promise<HostedBillingEntitlementRecord>;
  buildHostedFeatureServiceView: typeof BillingFeatureService.buildHostedFeatureServiceView;
  listTenantKeyRecordsState: typeof ControlPlaneStore.listTenantKeyRecordsState;
  tenantKeyStorePolicy: typeof import('../../tenant-key-store.js').tenantKeyStorePolicy;
  issueTenantApiKeyState: typeof ControlPlaneStore.issueTenantApiKeyState;
  rotateTenantApiKeyState: typeof ControlPlaneStore.rotateTenantApiKeyState;
  setTenantApiKeyStatusState: typeof ControlPlaneStore.setTenantApiKeyStatusState;
  revokeTenantApiKeyState: typeof ControlPlaneStore.revokeTenantApiKeyState;
  listAccountUsersByAccountIdState: typeof ControlPlaneStore.listAccountUsersByAccountIdState;
  listAccountUserActionTokensByAccountIdState: typeof ControlPlaneStore.listAccountUserActionTokensByAccountIdState;
  issueAccountInviteTokenState: typeof ControlPlaneStore.issueAccountInviteTokenState;
  deliverHostedInviteEmail: typeof EmailDelivery.deliverHostedInviteEmail;
  hostedEmailDeliveryErrorResponse(context: Context, error: unknown): Response | null;
  revokeAccountUserActionTokenState: typeof ControlPlaneStore.revokeAccountUserActionTokenState;
  accountUserActionTokenView(record: AccountUserActionTokenRecord): Record<string, unknown>;
  issuePasswordResetTokenState: typeof ControlPlaneStore.issuePasswordResetTokenState;
  deliverHostedPasswordResetEmail: typeof EmailDelivery.deliverHostedPasswordResetEmail;
  setAccountUserPasswordState: typeof ControlPlaneStore.setAccountUserPasswordState;
  revokeAccountSessionsForUserState: typeof ControlPlaneStore.revokeAccountSessionsForUserState;
  setAccountUserStatusState: typeof ControlPlaneStore.setAccountUserStatusState;
  saveAccountUserActionTokenRecordState: typeof ControlPlaneStore.saveAccountUserActionTokenRecordState;
  getCookie(context: Context, key: string, prefix?: string): string | undefined;
  deleteCookie(context: Context, key: string, options?: { path?: string }): void;
  sessionCookieName: typeof AccountSessionStore.sessionCookieName;
  revokeAccountSessionByTokenState: typeof ControlPlaneStore.revokeAccountSessionByTokenState;
  accountMfaErrorResponse(context: Context, error: unknown): Response | null;
  getHostedPlan: typeof PlanCatalog.getHostedPlan;
  listHostedEmailDeliveriesState: typeof ControlPlaneStore.listHostedEmailDeliveriesState;
  createHostedCheckoutSession: typeof StripeBilling.createHostedCheckoutSession;
  stripeBillingErrorResponse(context: Context, error: unknown): Response | null;
  createHostedBillingPortalSession: typeof StripeBilling.createHostedBillingPortalSession;
  buildHostedBillingExport: typeof BillingExport.buildHostedBillingExport;
  renderHostedBillingExportCsv: typeof BillingExport.renderHostedBillingExportCsv;
  buildHostedBillingReconciliation: typeof BillingReconciliation.buildHostedBillingReconciliation;
  billingEntitlementView(record: HostedBillingEntitlementRecord): Record<string, unknown>;
  currentTenant(context: Context): TenantContext;
}

export function registerAccountRoutes(app: Hono, deps: AccountRouteDeps): void {
  const {
    authService,
    currentHostedAccount,
    createAccountUserState,
    AccountUserStoreError,
    findAccountUserByEmailState,
    resolvePlanSpec,
    SELF_HOST_PLAN_ID,
    tenantKeyStoreErrorResponse,
    issueAccountSessionState,
    recordAccountUserLoginState,
    syncHostedBillingEntitlementForTenant,
    setSessionCookieForRecord,
    accountUserView,
    adminAccountView,
    accountApiKeyView,
    verifyAccountUserPasswordRecord,
    findHostedAccountByIdState,
    totpSummary,
    issueAccountMfaLoginTokenState,
    issueAccountPasskeyChallengeTokenState,
    buildHostedPasskeyAuthenticationOptions,
    asAuthenticationResponse,
    findAccountUserActionTokenByTokenState,
    parsePasskeyAuthenticationChallenge,
    findAccountUserByIdState,
    findAccountUserByPasskeyCredentialIdState,
    verifyHostedPasskeyAuthentication,
    passkeyCredentialToWebAuthnCredential,
    saveAccountUserRecordState,
    consumeAccountUserActionTokenState,
    revokeAccountUserActionTokensForUserState,
    getHostedSamlMetadata,
    buildHostedSamlAuthorizationRequest,
    completeHostedSamlAuthorization,
    recordHostedSamlReplayState,
    findAccountUserBySamlIdentityState,
    hostedSamlAllowsAutomaticLinking,
    linkAccountUserSamlIdentity,
    buildHostedOidcAuthorizationRequest,
    completeHostedOidcAuthorization,
    findAccountUserByOidcIdentityState,
    hostedOidcAllowsAutomaticLinking,
    linkAccountUserOidcIdentity,
    verifyTotpCode,
    verifyAndConsumeRecoveryCode,
    requireAccountSession,
    currentAccountAccess,
    buildHostedPasskeyRegistrationOptions,
    parsePasskeyRegistrationChallenge,
    asRegistrationResponse,
    verifyHostedPasskeyRegistration,
    buildAccountUserPasskeyCredentialRecord,
    generateHostedPasskeyUserHandle,
    accountUserDetailedMfaView,
    accountUserDetailedOidcView,
    accountUserDetailedSamlView,
    accountUserDetailedPasskeyView,
    accountPasskeyCredentialView,
    decryptTotpSecret,
    getSecretEnvelopeStatus,
    encryptTotpSecret,
    generateRecoveryCodes,
    generateTotpSecretBase32,
    buildTotpOtpAuthUrl,
    normalizePasskeyAuthenticatorHint,
    currentAccountRole,
    findTenantRecordByTenantIdState,
    getTenantPipelineRateLimit,
    getUsageContextState,
    readHostedBillingEntitlement,
    buildHostedFeatureServiceView,
    listTenantKeyRecordsState,
    tenantKeyStorePolicy,
    issueTenantApiKeyState,
    rotateTenantApiKeyState,
    setTenantApiKeyStatusState,
    revokeTenantApiKeyState,
    listAccountUsersByAccountIdState,
    listAccountUserActionTokensByAccountIdState,
    issueAccountInviteTokenState,
    deliverHostedInviteEmail,
    hostedEmailDeliveryErrorResponse,
    revokeAccountUserActionTokenState,
    accountUserActionTokenView,
    issuePasswordResetTokenState,
    deliverHostedPasswordResetEmail,
    setAccountUserPasswordState,
    revokeAccountSessionsForUserState,
    setAccountUserStatusState,
    saveAccountUserActionTokenRecordState,
    getCookie,
    deleteCookie,
    sessionCookieName,
    revokeAccountSessionByTokenState,
    accountMfaErrorResponse,
    getHostedPlan,
    listHostedEmailDeliveriesState,
    createHostedCheckoutSession,
    stripeBillingErrorResponse,
    createHostedBillingPortalSession,
    buildHostedBillingExport,
    renderHostedBillingExportCsv,
    buildHostedBillingReconciliation,
    billingEntitlementView,
    currentTenant,
  } = deps;

app.post('/api/v1/account/users/bootstrap', async (c) => {
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;

  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  try {
    const created = await authService.bootstrapFirstUser({
      current,
      email,
      displayName,
      password,
    });
    return c.json({
      user: accountUserView(created.user),
      bootstrap: true,
    }, 201);
  } catch (err) {
    const mapped = accountAuthServiceErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
});

app.post('/api/v1/auth/signup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const accountName = typeof body.accountName === 'string' ? body.accountName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  try {
    const signup = await authService.signup({
      accountName,
      email,
      displayName,
      password,
    });

    setSessionCookieForRecord(c, signup.sessionToken, signup.session.expiresAt);

    return c.json({
      signup: true,
      session: {
        id: signup.session.id,
        expiresAt: signup.session.expiresAt,
        source: 'account_session',
      },
      user: accountUserView(signup.user),
      account: adminAccountView(signup.account),
      commercial: signup.commercial,
      initialKey: {
        ...accountApiKeyView(signup.initialKey),
        apiKey: signup.apiKey,
      },
    }, 201);
  } catch (err) {
    const mapped = accountAuthServiceErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
});

app.post('/api/v1/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  try {
    const login = await authService.login({ email, password });
    if (login.mfaRequired) {
      return c.json({
        mfaRequired: true,
        challengeToken: login.challengeToken,
        challenge: login.challenge,
        user: accountUserView(login.user),
        account: adminAccountView(login.account),
      });
    }

    setSessionCookieForRecord(c, login.sessionToken, login.session.expiresAt);

    return c.json({
      session: {
        id: login.session.id,
        expiresAt: login.session.expiresAt,
        source: 'account_session',
      },
      user: accountUserView(login.user),
      account: adminAccountView(login.account),
    });
  } catch (err) {
    const mapped = accountAuthServiceErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
});

app.post('/api/v1/auth/passkeys/options', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email) {
    return c.json({ error: 'email is required for hosted passkey login in the current first slice.' }, 400);
  }

  const user = await findAccountUserByEmailState(email);
  if (!user || user.status !== 'active') {
    return c.json({ error: 'Hosted passkey login requires an active account user with enrolled passkeys.' }, 404);
  }
  if (user.passkeys.credentials.length === 0) {
    return c.json({ error: `Account user '${user.email}' does not have passkeys enrolled.` }, 409);
  }

  const account = await findHostedAccountByIdState(user.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${user.accountId}' was not found.` }, 404);
  }
  if (account.status === 'archived') {
    return c.json({ error: `Hosted account '${account.id}' is archived and cannot accept new sessions.` }, 403);
  }

  try {
    const built = await buildHostedPasskeyAuthenticationOptions({
      requestOrigin: c.req.url,
      user,
    });
    const issued = await issueAccountPasskeyChallengeTokenState({
      purpose: 'passkey_authentication',
      accountId: account.id,
      accountUserId: user.id,
      email: user.email,
      context: {
        challenge: built.challengeState.challenge,
        rpId: built.challengeState.rpId,
        origin: built.challengeState.origin,
      },
    });
    return c.json({
      challengeToken: issued.token,
      authentication: built.authentication,
      mode: 'email_lookup',
      hintedUser: accountUserView(user),
    });
  } catch (err) {
    return c.json({ error: accountRouteErrorMessage(err) }, 400);
  }
});

app.post('/api/v1/auth/passkeys/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const challengeToken = typeof body.challengeToken === 'string' ? body.challengeToken.trim() : '';
  const response = asAuthenticationResponse(body.response);
  if (!challengeToken || !response) {
    return c.json({ error: 'challengeToken and a valid WebAuthn authentication response are required.' }, 400);
  }

  const challengeRecord = await findAccountUserActionTokenByTokenState(challengeToken);
  const challenge = challengeRecord ? parsePasskeyAuthenticationChallenge(challengeRecord) : null;
  if (!challengeRecord || !challenge || !challengeRecord.accountUserId) {
    return c.json({ error: 'Passkey authentication challenge is invalid or expired.' }, 400);
  }

  const user = await findAccountUserByIdState(challengeRecord.accountUserId);
  const account = user ? await findHostedAccountByIdState(user.accountId) : null;
  if (!user || !account || account.id !== challengeRecord.accountId || user.status !== 'active' || account.status === 'archived') {
    return c.json({ error: 'Passkey authentication challenge is invalid or expired.' }, 400);
  }

  const credentialUser = await findAccountUserByPasskeyCredentialIdState(response.id);
  if (!credentialUser || credentialUser.id !== user.id) {
    return c.json({ error: 'Passkey credential could not be matched to the challenged account user.' }, 400);
  }

  const credentialIndex = user.passkeys.credentials.findIndex((entry) => entry.credentialId === response.id);
  if (credentialIndex < 0) {
    return c.json({ error: 'Passkey credential could not be matched to the challenged account user.' }, 400);
  }
  const storedCredential = user.passkeys.credentials[credentialIndex]!;

  let verification;
  try {
    verification = await verifyHostedPasskeyAuthentication({
      challengeState: challenge,
      response,
      credential: passkeyCredentialToWebAuthnCredential(storedCredential),
    });
  } catch (err) {
    return c.json({ error: accountRouteErrorMessage(err) }, 400);
  }
  if (!verification.verified) {
    return c.json({ error: 'Passkey authentication could not be verified.' }, 400);
  }

  const now = new Date().toISOString();
  const nextUser = structuredClone(user);
  const nextCredential = nextUser.passkeys.credentials[credentialIndex]!;
  nextCredential.counter = verification.authenticationInfo.newCounter;
  nextCredential.deviceType = verification.authenticationInfo.credentialDeviceType;
  nextCredential.backedUp = verification.authenticationInfo.credentialBackedUp;
  nextCredential.lastUsedAt = now;
  nextUser.passkeys.updatedAt = now;
  nextUser.updatedAt = now;
  await saveAccountUserRecordState(nextUser);
  await consumeAccountUserActionTokenState(challengeRecord.id);
  await revokeAccountUserActionTokensForUserState(user.id, 'passkey_authentication');

  const loginTouch = await recordAccountUserLoginState(user.id);
  const issued = await issueAccountSessionState({
    accountId: account.id,
    accountUserId: user.id,
    role: user.role,
  });
  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    upstreamAuth: {
      provider: 'passkey',
      credentialId: storedCredential.credentialId,
    },
    user: accountUserView(loginTouch.record),
    account: adminAccountView(account),
  });
});

app.get('/api/v1/auth/saml/metadata', (c) => {
  try {
    const metadata = getHostedSamlMetadata(c.req.url);
    c.header('content-type', 'application/samlmetadata+xml; charset=utf-8');
    return c.body(metadata);
  } catch (err) {
    const message = accountRouteErrorMessage(err);
    const status = message.includes('not configured') ? 503 : 400;
    return c.json({ error: message }, status);
  }
});

app.post('/api/v1/auth/saml/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  try {
    const authorization = buildHostedSamlAuthorizationRequest({
      requestOrigin: c.req.url,
      emailHint: email || null,
    });
    return c.json({ authorization });
  } catch (err) {
    const message = accountRouteErrorMessage(err);
    const status = message.includes('not configured') ? 503 : 400;
    return c.json({ error: message }, status);
  }
});

app.post('/api/v1/auth/saml/acs', async (c) => {
  const body = await c.req.parseBody();
  const samlResponse = typeof body.SAMLResponse === 'string' ? body.SAMLResponse.trim() : '';
  const relayState = typeof body.RelayState === 'string' ? body.RelayState.trim() : '';
  if (!samlResponse || !relayState) {
    return c.json({ error: 'SAMLResponse and RelayState are required.' }, 400);
  }

  let callback;
  try {
    callback = await completeHostedSamlAuthorization({
      requestOrigin: c.req.url,
      samlResponse,
      relayState,
    });
  } catch (err) {
    const message = accountRouteErrorMessage(err);
    const status = message.includes('not configured') ? 503 : 400;
    return c.json({ error: message }, status);
  }

  const replay = await recordHostedSamlReplayState({
    requestId: callback.relayState.requestId,
    responseId: callback.responseId,
    issuer: callback.identity.issuer,
    subject: callback.identity.subject,
    consumedAt: new Date().toISOString(),
    expiresAt: callback.relayState.expiresAt,
  });
  if (replay.duplicate) {
    return c.json({
      error: 'SAML response has already been consumed.',
      requestId: callback.relayState.requestId,
    }, 409);
  }

  let user = await findAccountUserBySamlIdentityState(
    callback.identity.issuer,
    callback.identity.subject,
  );
  if (!user) {
    if (!hostedSamlAllowsAutomaticLinking(callback.identity) || !callback.identity.email) {
      return c.json({
        error: 'SAML identity could not be matched to an existing hosted account user.',
        identity: {
          issuer: callback.identity.issuer,
          subject: callback.identity.subject,
          email: callback.identity.email,
          nameId: callback.identity.nameId,
        },
      }, 403);
    }
    user = await findAccountUserByEmailState(callback.identity.email);
  }
  if (!user) {
    return c.json({
      error: 'SAML identity could not be matched to an existing hosted account user.',
      identity: {
        issuer: callback.identity.issuer,
        subject: callback.identity.subject,
        email: callback.identity.email,
        nameId: callback.identity.nameId,
      },
    }, 403);
  }
  if (user.status !== 'active') {
    return c.json({ error: `Account user '${user.email}' is inactive.` }, 403);
  }

  const account = await findHostedAccountByIdState(user.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${user.accountId}' was not found.` }, 404);
  }
  if (account.status === 'archived') {
    return c.json({ error: `Hosted account '${account.id}' is archived and cannot accept new sessions.` }, 403);
  }

  const sync = linkAccountUserSamlIdentity(user, callback.identity);
  if (sync.changed) {
    await saveAccountUserRecordState(sync.record);
    user = sync.record;
  }

  const userTotp = totpSummary(user.mfa.totp);
  if (userTotp.enabled) {
    const issued = await issueAccountMfaLoginTokenState({
      accountId: account.id,
      accountUserId: user.id,
      email: user.email,
    });
    return c.json({
      mfaRequired: true,
      challengeToken: issued.token,
      challenge: {
        id: issued.record.id,
        method: 'totp',
        expiresAt: issued.record.expiresAt,
        maxAttempts: issued.record.maxAttempts,
        remainingAttempts: issued.record.maxAttempts === null
          ? null
          : Math.max(issued.record.maxAttempts - issued.record.attemptCount, 0),
      },
      upstreamAuth: {
        provider: 'saml',
        issuer: callback.identity.issuer,
        subject: callback.identity.subject,
        nameId: callback.identity.nameId,
      },
      user: accountUserView(user),
      account: adminAccountView(account),
    });
  }

  const issued = await issueAccountSessionState({
    accountId: account.id,
    accountUserId: user.id,
    role: user.role,
  });
  const loginTouch = await recordAccountUserLoginState(user.id);
  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    upstreamAuth: {
      provider: 'saml',
      issuer: callback.identity.issuer,
      subject: callback.identity.subject,
      nameId: callback.identity.nameId,
    },
    user: accountUserView(loginTouch.record),
    account: adminAccountView(account),
  });
});

app.post('/api/v1/auth/oidc/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  try {
    const authorization = await buildHostedOidcAuthorizationRequest({
      requestOrigin: c.req.url,
      emailHint: email || null,
    });
    return c.json({
      authorization: {
        mode: authorization.mode,
        issuerUrl: authorization.issuerUrl,
        redirectUrl: authorization.redirectUrl,
        scopes: authorization.scopes,
        authorizationUrl: authorization.authorizationUrl,
        expiresAt: authorization.expiresAt,
      },
    });
  } catch (err) {
    const message = accountRouteErrorMessage(err);
    if (message.includes('not configured')) {
      return c.json({ error: message }, 503);
    }
    return c.json({ error: message }, 400);
  }
});

app.get('/api/v1/auth/oidc/callback', async (c) => {
  let callback;
  try {
    callback = await completeHostedOidcAuthorization(c.req.url);
  } catch (err) {
    const message = accountRouteErrorMessage(err);
    const status = message.includes('not configured') ? 503 : 400;
    return c.json({ error: message }, status);
  }

  let user = await findAccountUserByOidcIdentityState(
    callback.identity.issuer,
    callback.identity.subject,
  );
  if (!user) {
    if (!hostedOidcAllowsAutomaticLinking(callback.identity) || !callback.identity.email) {
      return c.json({
        error: 'OIDC identity could not be matched to an existing hosted account user.',
        identity: {
          issuer: callback.identity.issuer,
          subject: callback.identity.subject,
          email: callback.identity.email,
          emailVerified: callback.identity.emailVerified,
        },
      }, 403);
    }
    user = await findAccountUserByEmailState(callback.identity.email);
  }
  if (!user) {
    return c.json({
      error: 'OIDC identity could not be matched to an existing hosted account user.',
      identity: {
        issuer: callback.identity.issuer,
        subject: callback.identity.subject,
        email: callback.identity.email,
        emailVerified: callback.identity.emailVerified,
      },
    }, 403);
  }
  if (user.status !== 'active') {
    return c.json({ error: `Account user '${user.email}' is inactive.` }, 403);
  }

  const account = await findHostedAccountByIdState(user.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${user.accountId}' was not found.` }, 404);
  }
  if (account.status === 'archived') {
    return c.json({ error: `Hosted account '${account.id}' is archived and cannot accept new sessions.` }, 403);
  }

  const sync = linkAccountUserOidcIdentity(user, callback.identity);
  if (sync.changed) {
    await saveAccountUserRecordState(sync.record);
    user = sync.record;
  }

  const userTotp = totpSummary(user.mfa.totp);
  if (userTotp.enabled) {
    const issued = await issueAccountMfaLoginTokenState({
      accountId: account.id,
      accountUserId: user.id,
      email: user.email,
    });
    return c.json({
      mfaRequired: true,
      challengeToken: issued.token,
      challenge: {
        id: issued.record.id,
        method: 'totp',
        expiresAt: issued.record.expiresAt,
        maxAttempts: issued.record.maxAttempts,
        remainingAttempts: issued.record.maxAttempts === null
          ? null
          : Math.max(issued.record.maxAttempts - issued.record.attemptCount, 0),
      },
      upstreamAuth: {
        provider: 'oidc',
        issuer: callback.identity.issuer,
        subject: callback.identity.subject,
      },
      user: accountUserView(user),
      account: adminAccountView(account),
    });
  }

  const issued = await issueAccountSessionState({
    accountId: account.id,
    accountUserId: user.id,
    role: user.role,
  });
  const loginTouch = await recordAccountUserLoginState(user.id);
  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    upstreamAuth: {
      provider: 'oidc',
      issuer: callback.identity.issuer,
      subject: callback.identity.subject,
    },
    user: accountUserView(loginTouch.record),
    account: adminAccountView(account),
  });
});

app.post('/api/v1/auth/mfa/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const challengeToken = typeof body.challengeToken === 'string' ? body.challengeToken.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : '';
  if (!challengeToken || (!code && !recoveryCode)) {
    return c.json({ error: 'challengeToken and either code or recoveryCode are required.' }, 400);
  }

  const challenge = await findAccountUserActionTokenByTokenState(challengeToken);
  if (!challenge || challenge.purpose !== 'mfa_login' || !challenge.accountUserId) {
    return c.json({ error: 'MFA challenge is invalid or expired.' }, 400);
  }

  const user = await findAccountUserByIdState(challenge.accountUserId);
  const account = user ? await findHostedAccountByIdState(user.accountId) : null;
  if (!user || !account || account.id !== challenge.accountId || user.status !== 'active' || account.status === 'archived') {
    return c.json({ error: 'MFA challenge is invalid or expired.' }, 400);
  }
  if (!user.mfa.totp.enabledAt || !user.mfa.totp.secretCiphertext || !user.mfa.totp.secretIv || !user.mfa.totp.secretAuthTag) {
    return c.json({ error: `Account user '${user.email}' does not have active MFA configured.` }, 409);
  }

  let verified = false;
  let recoveryCodeUsed = false;
  const nextUser = structuredClone(user);

  if (code) {
    try {
      verified = verifyTotpCode({
        secretBase32: decryptTotpSecret({
          ciphertext: user.mfa.totp.secretCiphertext,
          iv: user.mfa.totp.secretIv,
          authTag: user.mfa.totp.secretAuthTag,
        }),
        code,
      });
    } catch (err) {
      const mapped = accountMfaErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }
    if (verified) {
      const now = new Date().toISOString();
      nextUser.mfa.totp.lastVerifiedAt = now;
      nextUser.mfa.totp.updatedAt = now;
      nextUser.updatedAt = now;
      await saveAccountUserRecordState(nextUser);
    }
  } else {
    const recovery = verifyAndConsumeRecoveryCode(user.mfa.totp, recoveryCode);
    verified = recovery.ok;
    recoveryCodeUsed = recovery.ok;
    if (recovery.ok) {
      nextUser.mfa.totp = recovery.nextTotp;
      nextUser.updatedAt = recovery.nextTotp.updatedAt ?? nextUser.updatedAt;
      await saveAccountUserRecordState(nextUser);
    }
  }

  if (!verified) {
    const nextChallenge = structuredClone(challenge);
    nextChallenge.attemptCount += 1;
    nextChallenge.lastAttemptAt = new Date().toISOString();
    nextChallenge.updatedAt = nextChallenge.lastAttemptAt;
    if (nextChallenge.maxAttempts !== null && nextChallenge.attemptCount >= nextChallenge.maxAttempts) {
      nextChallenge.revokedAt = nextChallenge.lastAttemptAt;
    }
    await saveAccountUserActionTokenRecordState(nextChallenge);
    return c.json({ error: 'MFA code is invalid or expired.' }, 400);
  }

  await consumeAccountUserActionTokenState(challenge.id);
  await revokeAccountUserActionTokensForUserState(user.id, 'mfa_login');
  const loginTouch = await recordAccountUserLoginState(user.id);
  const issued = await issueAccountSessionState({
    accountId: account.id,
    accountUserId: user.id,
    role: user.role,
  });
  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    verified: true,
    recoveryCodeUsed,
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    user: accountUserView(loginTouch.record),
    account: adminAccountView(account),
  });
});

app.post('/api/v1/auth/logout', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;

  const token = c.req.header('x-attestor-session')
    ?? getCookie(c, sessionCookieName())
    ?? null;
  if (token) {
    await revokeAccountSessionByTokenState(token);
  }
  deleteCookie(c, sessionCookieName(), {
    path: '/api/v1',
  });
  return c.json({ loggedOut: true });
});

app.post('/api/v1/auth/password/change', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!currentPassword || !newPassword) {
    return c.json({ error: 'currentPassword and newPassword are required.' }, 400);
  }
  if (!verifyAccountUserPasswordRecord(user.password, currentPassword)) {
    return c.json({ error: 'Current password is invalid.' }, 403);
  }
  if (newPassword.length < 12) {
    return c.json({ error: 'newPassword must be at least 12 characters long.' }, 400);
  }

  const updated = await setAccountUserPasswordState(user.id, newPassword);
  await revokeAccountSessionsForUserState(user.id);
  await revokeAccountUserActionTokensForUserState(user.id, 'password_reset');
  const issued = await issueAccountSessionState({
    accountId: access.accountId,
    accountUserId: user.id,
    role: user.role,
  });
  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    changed: true,
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    user: accountUserView(updated.record),
  });
});

app.get('/api/v1/auth/me', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  const account = await findHostedAccountByIdState(access.accountId);
  if (!user || !account) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }
  return c.json({
    session: {
      id: access.sessionId,
      source: access.source,
      role: access.role,
    },
    user: accountUserView(user),
    account: adminAccountView(account),
  });
});

app.get('/api/v1/account/mfa', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }
  return c.json({
    mfa: accountUserDetailedMfaView(user),
  });
});

app.get('/api/v1/account/oidc', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }
  return c.json({
    oidc: accountUserDetailedOidcView(user, c.req.url),
  });
});

app.get('/api/v1/account/saml', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }
  return c.json({
    saml: accountUserDetailedSamlView(user, c.req.url),
  });
});

app.get('/api/v1/account/passkeys', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }
  return c.json({
    passkeys: accountUserDetailedPasskeyView(user),
  });
});

app.post('/api/v1/account/passkeys/register/options', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  const preferredAuthenticatorType = normalizePasskeyAuthenticatorHint(body.preferredAuthenticatorType);
  if (!password) {
    return c.json({ error: 'password is required.' }, 400);
  }
  if (!verifyAccountUserPasswordRecord(user.password, password)) {
    return c.json({ error: 'Current password is invalid.' }, 403);
  }

  try {
    const built = await buildHostedPasskeyRegistrationOptions({
      requestOrigin: c.req.url,
      user,
      userHandle: user.passkeys.userHandle || generateHostedPasskeyUserHandle(),
      preferredAuthenticatorType,
    });
    const issued = await issueAccountPasskeyChallengeTokenState({
      purpose: 'passkey_registration',
      accountId: access.accountId,
      accountUserId: user.id,
      email: user.email,
      context: {
        challenge: built.challengeState.challenge,
        rpId: built.challengeState.rpId,
        origin: built.challengeState.origin,
        userHandle: built.challengeState.userHandle,
      },
    });
    return c.json({
      challengeToken: issued.token,
      registration: built.registration,
      rp: {
        id: built.config.rpId,
        name: built.config.rpName,
        origin: built.config.origin,
      },
    });
  } catch (err) {
    return c.json({ error: accountRouteErrorMessage(err) }, 400);
  }
});

app.post('/api/v1/account/passkeys/register/verify', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const sessionUser = await findAccountUserByIdState(access.accountUserId);
  if (!sessionUser || sessionUser.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const challengeToken = typeof body.challengeToken === 'string' ? body.challengeToken.trim() : '';
  const response = asRegistrationResponse(body.response);
  if (!challengeToken || !response) {
    return c.json({ error: 'challengeToken and a valid WebAuthn registration response are required.' }, 400);
  }

  const challengeRecord = await findAccountUserActionTokenByTokenState(challengeToken);
  const challenge = challengeRecord ? parsePasskeyRegistrationChallenge(challengeRecord) : null;
  if (
    !challengeRecord
    || !challenge
    || challenge.accountId !== access.accountId
    || challenge.accountUserId !== access.accountUserId
  ) {
    return c.json({ error: 'Passkey registration challenge is invalid or expired.' }, 400);
  }

  let verification;
  try {
    verification = await verifyHostedPasskeyRegistration({
      challengeState: challenge,
      response,
    });
  } catch (err) {
    return c.json({ error: accountRouteErrorMessage(err) }, 400);
  }
  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'Passkey registration could not be verified.' }, 400);
  }

  const now = new Date().toISOString();
  const nextUser = structuredClone(sessionUser);
  const nextCredential = buildAccountUserPasskeyCredentialRecord({
    credential: verification.registrationInfo.credential,
    transports: response.response.transports ?? [],
    aaguid: verification.registrationInfo.aaguid,
    deviceType: verification.registrationInfo.credentialDeviceType,
    backedUp: verification.registrationInfo.credentialBackedUp,
    createdAt: now,
  });
  const existingIndex = nextUser.passkeys.credentials.findIndex(
    (entry) => entry.credentialId === nextCredential.credentialId,
  );
  if (existingIndex >= 0) {
    const existing = nextUser.passkeys.credentials[existingIndex]!;
    nextCredential.id = existing.id;
    nextCredential.createdAt = existing.createdAt;
    nextCredential.lastUsedAt = existing.lastUsedAt;
    nextUser.passkeys.credentials.splice(existingIndex, 1);
  }
  nextUser.passkeys.userHandle = challenge.userHandle;
  nextUser.passkeys.credentials.push(nextCredential);
  nextUser.passkeys.updatedAt = now;
  nextUser.updatedAt = now;
  await saveAccountUserRecordState(nextUser);
  await consumeAccountUserActionTokenState(challengeRecord.id);
  await revokeAccountUserActionTokensForUserState(nextUser.id, 'passkey_registration');

  return c.json({
    registered: true,
    passkey: accountPasskeyCredentialView(nextCredential),
    user: accountUserView(nextUser),
  });
});

app.post('/api/v1/account/passkeys/:id/delete', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }

  const passkeyId = c.req.param('id')?.trim() ?? '';
  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!passkeyId || !password) {
    return c.json({ error: 'passkey id and password are required.' }, 400);
  }
  if (!verifyAccountUserPasswordRecord(user.password, password)) {
    return c.json({ error: 'Current password is invalid.' }, 403);
  }

  const credentialIndex = user.passkeys.credentials.findIndex((entry) => entry.id === passkeyId);
  if (credentialIndex < 0) {
    return c.json({ error: `Passkey '${passkeyId}' was not found for the current account user.` }, 404);
  }

  const nextUser = structuredClone(user);
  nextUser.passkeys.credentials.splice(credentialIndex, 1);
  nextUser.passkeys.updatedAt = new Date().toISOString();
  nextUser.updatedAt = nextUser.passkeys.updatedAt;
  await saveAccountUserRecordState(nextUser);

  return c.json({
    deleted: true,
    passkeyId,
    user: accountUserView(nextUser),
  });
});

app.post('/api/v1/account/mfa/totp/enroll', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  const account = await findHostedAccountByIdState(access.accountId);
  if (!user || !account || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return c.json({ error: 'password is required.' }, 400);
  }
  if (!verifyAccountUserPasswordRecord(user.password, password)) {
    return c.json({ error: 'Current password is invalid.' }, 403);
  }
  if (totpSummary(user.mfa.totp).enabled) {
    return c.json({ error: `Account user '${user.email}' already has TOTP MFA enabled.` }, 409);
  }

  let secretBase32: string;
  let secretEnvelope: ReturnType<typeof encryptTotpSecret>;
  try {
    secretBase32 = generateTotpSecretBase32();
    secretEnvelope = encryptTotpSecret(secretBase32);
  } catch (err) {
    const mapped = accountMfaErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  const now = new Date().toISOString();
  const nextUser = structuredClone(user);
  nextUser.mfa.totp.pendingSecretCiphertext = secretEnvelope.ciphertext;
  nextUser.mfa.totp.pendingSecretIv = secretEnvelope.iv;
  nextUser.mfa.totp.pendingSecretAuthTag = secretEnvelope.authTag;
  nextUser.mfa.totp.pendingIssuedAt = now;
  nextUser.mfa.totp.updatedAt = now;
  nextUser.updatedAt = now;
  await saveAccountUserRecordState(nextUser);

  const issuer = process.env.ATTESTOR_MFA_ISSUER?.trim() || 'Attestor';
  return c.json({
    enrollment: {
      method: 'totp',
      issuer,
      accountName: user.email,
      secretBase32,
      otpauthUrl: buildTotpOtpAuthUrl({
        issuer,
        accountName: user.email,
        secretBase32,
      }),
      digits: 6,
      periodSeconds: 30,
      algorithm: 'SHA1',
      pendingIssuedAt: now,
    },
  });
});

app.post('/api/v1/account/mfa/totp/confirm', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return c.json({ error: 'code is required.' }, 400);
  }
  if (!user.mfa.totp.pendingSecretCiphertext || !user.mfa.totp.pendingSecretIv || !user.mfa.totp.pendingSecretAuthTag) {
    return c.json({ error: `Account user '${user.email}' does not have a pending TOTP enrollment.` }, 409);
  }

  let secretBase32: string;
  try {
    secretBase32 = decryptTotpSecret({
      ciphertext: user.mfa.totp.pendingSecretCiphertext,
      iv: user.mfa.totp.pendingSecretIv,
      authTag: user.mfa.totp.pendingSecretAuthTag,
    });
  } catch (err) {
    const mapped = accountMfaErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  if (!verifyTotpCode({ secretBase32, code })) {
    return c.json({ error: 'TOTP code is invalid.' }, 400);
  }

  const recovery = generateRecoveryCodes();
  const now = new Date().toISOString();
  const nextUser = structuredClone(user);
  nextUser.mfa.totp.secretCiphertext = user.mfa.totp.pendingSecretCiphertext;
  nextUser.mfa.totp.secretIv = user.mfa.totp.pendingSecretIv;
  nextUser.mfa.totp.secretAuthTag = user.mfa.totp.pendingSecretAuthTag;
  nextUser.mfa.totp.pendingSecretCiphertext = null;
  nextUser.mfa.totp.pendingSecretIv = null;
  nextUser.mfa.totp.pendingSecretAuthTag = null;
  nextUser.mfa.totp.pendingIssuedAt = null;
  nextUser.mfa.totp.enabledAt = now;
  nextUser.mfa.totp.updatedAt = now;
  nextUser.mfa.totp.sessionBoundaryAt = now;
  nextUser.mfa.totp.lastVerifiedAt = now;
  nextUser.mfa.totp.recoveryCodes = recovery.hashedCodes;
  nextUser.mfa.totp.recoveryCodesIssuedAt = now;
  nextUser.updatedAt = now;
  await saveAccountUserRecordState(nextUser);

  await revokeAccountSessionsForUserState(user.id);
  await revokeAccountUserActionTokensForUserState(user.id, 'mfa_login');
  const issued = await issueAccountSessionState({
    accountId: access.accountId,
    accountUserId: user.id,
    role: user.role,
  });
  const loginTouch = await recordAccountUserLoginState(user.id);
  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    enabled: true,
    recoveryCodes: recovery.codes,
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    user: accountUserView(loginTouch.record),
  });
});

app.post('/api/v1/account/mfa/disable', async (c) => {
  const unauthorized = requireAccountSession(c);
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(access.accountUserId);
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: 'Current account session could not be resolved.' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : '';
  if (!password || (!code && !recoveryCode)) {
    return c.json({ error: 'password and either code or recoveryCode are required.' }, 400);
  }
  if (!verifyAccountUserPasswordRecord(user.password, password)) {
    return c.json({ error: 'Current password is invalid.' }, 403);
  }
  if (!totpSummary(user.mfa.totp).enabled || !user.mfa.totp.secretCiphertext || !user.mfa.totp.secretIv || !user.mfa.totp.secretAuthTag) {
    return c.json({ error: `Account user '${user.email}' does not have TOTP MFA enabled.` }, 409);
  }

  let verified = false;
  let recoveryCodeUsed = false;
  const nextUser = structuredClone(user);
  if (code) {
    try {
      verified = verifyTotpCode({
        secretBase32: decryptTotpSecret({
          ciphertext: user.mfa.totp.secretCiphertext,
          iv: user.mfa.totp.secretIv,
          authTag: user.mfa.totp.secretAuthTag,
        }),
        code,
      });
    } catch (err) {
      const mapped = accountMfaErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }
  } else {
    const recovery = verifyAndConsumeRecoveryCode(user.mfa.totp, recoveryCode);
    verified = recovery.ok;
    recoveryCodeUsed = recovery.ok;
    if (recovery.ok) {
      nextUser.mfa.totp = recovery.nextTotp;
    }
  }
  if (!verified) {
    return c.json({ error: 'MFA code is invalid or expired.' }, 400);
  }

  const now = new Date().toISOString();
  nextUser.mfa.totp.enabledAt = null;
  nextUser.mfa.totp.updatedAt = now;
  nextUser.mfa.totp.sessionBoundaryAt = now;
  nextUser.mfa.totp.secretCiphertext = null;
  nextUser.mfa.totp.secretIv = null;
  nextUser.mfa.totp.secretAuthTag = null;
  nextUser.mfa.totp.pendingSecretCiphertext = null;
  nextUser.mfa.totp.pendingSecretIv = null;
  nextUser.mfa.totp.pendingSecretAuthTag = null;
  nextUser.mfa.totp.pendingIssuedAt = null;
  nextUser.mfa.totp.lastVerifiedAt = now;
  nextUser.mfa.totp.recoveryCodes = [];
  nextUser.mfa.totp.recoveryCodesIssuedAt = null;
  nextUser.updatedAt = now;
  await saveAccountUserRecordState(nextUser);

  await revokeAccountSessionsForUserState(user.id);
  await revokeAccountUserActionTokensForUserState(user.id, 'mfa_login');
  const issued = await issueAccountSessionState({
    accountId: access.accountId,
    accountUserId: user.id,
    role: user.role,
  });
  const loginTouch = await recordAccountUserLoginState(user.id);
  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    disabled: true,
    recoveryCodeUsed,
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    user: accountUserView(loginTouch.record),
  });
});

app.get('/api/v1/account/usage', async (c) => {
  const tenant = currentTenant(c);
  const usage = await getUsageContextState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
  const rateLimit = await getTenantPipelineRateLimit(tenant.tenantId, tenant.planId);
  return c.json({
    tenantContext: {
      tenantId: tenant.tenantId,
      source: tenant.source,
      planId: tenant.planId,
    },
    usage,
    rateLimit,
  });
});

app.get('/api/v1/account', async (c) => {
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;
  const entitlement = await readHostedBillingEntitlement(current.account);
  return c.json({
    account: adminAccountView(current.account),
    entitlement: billingEntitlementView(entitlement),
    tenantContext: {
      tenantId: current.tenant.tenantId,
      source: current.tenant.source,
      planId: current.tenant.planId,
    },
    usage: current.usage,
    rateLimit: current.rateLimit,
  });
});

app.get('/api/v1/account/entitlement', async (c) => {
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;
  const entitlement = await readHostedBillingEntitlement(current.account);
  return c.json({
    entitlement: billingEntitlementView(entitlement),
  });
});

app.get('/api/v1/account/features', async (c) => {
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;
  const entitlement = await readHostedBillingEntitlement(current.account);
  return c.json(buildHostedFeatureServiceView(entitlement));
});

app.get('/api/v1/account/api-keys', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const account = await findHostedAccountByIdState(access.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${access.accountId}' was not found.` }, 404);
  }
  const keys = await listTenantKeyRecordsState();
  return c.json({
    keys: keys.records
      .filter((entry) => entry.tenantId === account.primaryTenantId)
      .map((entry) => accountApiKeyView(entry)),
    defaults: {
      maxActiveKeysPerTenant: tenantKeyStorePolicy().maxActiveKeysPerTenant,
    },
  });
});

app.post('/api/v1/account/api-keys', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const account = await findHostedAccountByIdState(access.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${access.accountId}' was not found.` }, 404);
  }
  const tenantRecord = await findTenantRecordByTenantIdState(account.primaryTenantId);
  const planId = tenantRecord?.planId ?? SELF_HOST_PLAN_ID;
  const monthlyRunQuota = tenantRecord?.monthlyRunQuota ?? null;
  const tenantName = tenantRecord?.tenantName ?? account.accountName;

  let issued;
  try {
    issued = await issueTenantApiKeyState({
      tenantId: account.primaryTenantId,
      tenantName,
      planId,
      monthlyRunQuota,
    });
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlementForTenant(account.primaryTenantId, {
    lastEventType: 'account.api_keys.issue',
    lastEventAt: new Date().toISOString(),
  });

  return c.json({
    key: {
      ...accountApiKeyView(issued.record),
      apiKey: issued.apiKey,
    },
  }, 201);
});

app.post('/api/v1/account/api-keys/:id/rotate', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const account = await findHostedAccountByIdState(access.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${access.accountId}' was not found.` }, 404);
  }
  const keys = await listTenantKeyRecordsState();
  const currentKey = keys.records.find(
    (entry) => entry.id === c.req.param('id') && entry.tenantId === account.primaryTenantId,
  ) ?? null;
  if (!currentKey) {
    return c.json({ error: `API key '${c.req.param('id')}' was not found.` }, 404);
  }

  let rotated;
  try {
    rotated = await rotateTenantApiKeyState(currentKey.id);
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    return c.json({ error: accountRouteErrorMessage(err) }, 400);
  }
  await syncHostedBillingEntitlementForTenant(account.primaryTenantId, {
    lastEventType: 'account.api_keys.rotate',
    lastEventAt: new Date().toISOString(),
  });

  return c.json({
    previousKey: accountApiKeyView(rotated.previousRecord),
    newKey: {
      ...accountApiKeyView(rotated.record),
      apiKey: rotated.apiKey,
    },
  }, 201);
});

app.post('/api/v1/account/api-keys/:id/deactivate', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const account = await findHostedAccountByIdState(access.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${access.accountId}' was not found.` }, 404);
  }
  const keys = await listTenantKeyRecordsState();
  const currentKey = keys.records.find(
    (entry) => entry.id === c.req.param('id') && entry.tenantId === account.primaryTenantId,
  ) ?? null;
  if (!currentKey) {
    return c.json({ error: `API key '${c.req.param('id')}' was not found.` }, 404);
  }

  let result;
  try {
    result = await setTenantApiKeyStatusState(currentKey.id, 'inactive');
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlementForTenant(account.primaryTenantId, {
    lastEventType: 'account.api_keys.deactivate',
    lastEventAt: new Date().toISOString(),
  });

  return c.json({
    key: accountApiKeyView(result.record),
  });
});

app.post('/api/v1/account/api-keys/:id/reactivate', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const account = await findHostedAccountByIdState(access.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${access.accountId}' was not found.` }, 404);
  }
  const keys = await listTenantKeyRecordsState();
  const currentKey = keys.records.find(
    (entry) => entry.id === c.req.param('id') && entry.tenantId === account.primaryTenantId,
  ) ?? null;
  if (!currentKey) {
    return c.json({ error: `API key '${c.req.param('id')}' was not found.` }, 404);
  }

  let result;
  try {
    result = await setTenantApiKeyStatusState(currentKey.id, 'active');
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlementForTenant(account.primaryTenantId, {
    lastEventType: 'account.api_keys.reactivate',
    lastEventAt: new Date().toISOString(),
  });

  return c.json({
    key: accountApiKeyView(result.record),
  });
});

app.post('/api/v1/account/api-keys/:id/revoke', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const account = await findHostedAccountByIdState(access.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${access.accountId}' was not found.` }, 404);
  }
  const keys = await listTenantKeyRecordsState();
  const currentKey = keys.records.find(
    (entry) => entry.id === c.req.param('id') && entry.tenantId === account.primaryTenantId,
  ) ?? null;
  if (!currentKey) {
    return c.json({ error: `API key '${c.req.param('id')}' was not found.` }, 404);
  }

  const result = await revokeTenantApiKeyState(currentKey.id);
  if (!result.record) {
    return c.json({ error: `API key '${c.req.param('id')}' was not found.` }, 404);
  }
  await syncHostedBillingEntitlementForTenant(account.primaryTenantId, {
    lastEventType: 'account.api_keys.revoke',
    lastEventAt: new Date().toISOString(),
  });

  return c.json({
    key: accountApiKeyView(result.record),
  });
});

app.get('/api/v1/account/users', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const users = await listAccountUsersByAccountIdState(access.accountId);
  return c.json({
    users: users.records.map(accountUserView),
  });
});

app.post('/api/v1/account/users', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = accountUserRoleFilter(typeof body.role === 'string' ? body.role.trim() : null);
  if (!email || !displayName || !password || !role) {
    return c.json({ error: 'email, displayName, password, and role are required.' }, 400);
  }
  if (password.length < 12) {
    return c.json({ error: 'password must be at least 12 characters long.' }, 400);
  }

  let created;
  try {
    created = await createAccountUserState({
      accountId: access.accountId,
      email,
      displayName,
      password,
      role,
    });
  } catch (err) {
    if (err instanceof AccountUserStoreError) {
      return c.json({ error: err.message }, err.code === 'NOT_FOUND' ? 404 : 409);
    }
    throw err;
  }

  return c.json({
    user: accountUserView(created.record),
  }, 201);
});

app.get('/api/v1/account/users/invites', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const invites = await listAccountUserActionTokensByAccountIdState(access.accountId, { purpose: 'invite' });
  return c.json({
    invites: invites.records.map(accountUserActionTokenView),
  });
});

app.post('/api/v1/account/users/invites', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const account = await findHostedAccountByIdState(access.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${access.accountId}' was not found.` }, 404);
  }
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const role = accountUserRoleFilter(typeof body.role === 'string' ? body.role.trim() : null);
  const expiresHours = typeof body.expiresHours === 'number' ? body.expiresHours : null;
  if (!email || !displayName || !role) {
    return c.json({ error: 'email, displayName, and role are required.' }, 400);
  }
  const existing = await findAccountUserByEmailState(email);
  if (existing) {
    return c.json({ error: `Account user '${email}' already exists.` }, 409);
  }
  const issued = await issueAccountInviteTokenState({
    accountId: access.accountId,
    email,
    displayName,
    role,
    issuedByAccountUserId: access.accountUserId,
    ttlHours: expiresHours,
  });
  let delivery;
  try {
    delivery = await deliverHostedInviteEmail({
      accountId: access.accountId,
      accountUserId: null,
      recipientEmail: email,
      displayName,
      role,
      accountName: account.accountName,
      token: issued.token,
    });
  } catch (err) {
    await revokeAccountUserActionTokenState(issued.record.id);
    const mapped = hostedEmailDeliveryErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  return c.json({
    invite: accountUserActionTokenView(issued.record),
    ...(delivery.tokenReturned ? { inviteToken: issued.token } : {}),
    delivery,
  }, 201);
});

app.post('/api/v1/account/users/invites/:id/revoke', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const invites = await listAccountUserActionTokensByAccountIdState(access.accountId, { purpose: 'invite' });
  const target = invites.records.find((entry) => entry.id === c.req.param('id')) ?? null;
  if (!target) {
    return c.json({ error: `Invite '${c.req.param('id')}' was not found.` }, 404);
  }
  const revoked = await revokeAccountUserActionTokenState(target.id);
  return c.json({
    invite: accountUserActionTokenView(revoked.record ?? target),
  });
});

app.post('/api/v1/account/users/invites/accept', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!inviteToken || !password) {
    return c.json({ error: 'inviteToken and password are required.' }, 400);
  }
  if (password.length < 12) {
    return c.json({ error: 'password must be at least 12 characters long.' }, 400);
  }

  const invite = await findAccountUserActionTokenByTokenState(inviteToken);
  if (!invite || invite.purpose !== 'invite' || !invite.role || !invite.displayName) {
    return c.json({ error: 'Invite token is invalid or expired.' }, 400);
  }
  const account = await findHostedAccountByIdState(invite.accountId);
  if (!account || account.status === 'archived') {
    return c.json({ error: 'Invite account is not available.' }, 404);
  }
  const existing = await findAccountUserByEmailState(invite.email);
  if (existing) {
    return c.json({ error: `Account user '${invite.email}' already exists.` }, 409);
  }

  let created;
  try {
    created = await createAccountUserState({
      accountId: invite.accountId,
      email: invite.email,
      displayName: invite.displayName,
      password,
      role: invite.role,
    });
  } catch (err) {
    if (err instanceof AccountUserStoreError) {
      return c.json({ error: err.message }, err.code === 'NOT_FOUND' ? 404 : 409);
    }
    throw err;
  }
  await consumeAccountUserActionTokenState(invite.id);
  const loginTouch = await recordAccountUserLoginState(created.record.id);
  const issued = await issueAccountSessionState({
    accountId: invite.accountId,
    accountUserId: created.record.id,
    role: created.record.role,
  });
  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    accepted: true,
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    user: accountUserView(loginTouch.record),
    account: adminAccountView(account),
  }, 201);
});

app.post('/api/v1/account/users/:id/deactivate', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(c.req.param('id'));
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: `Account user '${c.req.param('id')}' was not found.` }, 404);
  }
  try {
    const updated = await setAccountUserStatusState(user.id, 'inactive');
    await revokeAccountSessionsForUserState(user.id);
    await revokeAccountUserActionTokensForUserState(user.id);
    return c.json({
      user: accountUserView(updated.record),
    });
  } catch (err) {
    if (err instanceof AccountUserStoreError) {
      return c.json({ error: err.message }, err.code === 'NOT_FOUND' ? 404 : 409);
    }
    throw err;
  }
});

app.post('/api/v1/account/users/:id/reactivate', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const user = await findAccountUserByIdState(c.req.param('id'));
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: `Account user '${c.req.param('id')}' was not found.` }, 404);
  }
  try {
    const updated = await setAccountUserStatusState(user.id, 'active');
    return c.json({
      user: accountUserView(updated.record),
    });
  } catch (err) {
    if (err instanceof AccountUserStoreError) {
      return c.json({ error: err.message }, err.code === 'NOT_FOUND' ? 404 : 409);
    }
    throw err;
  }
});

app.post('/api/v1/account/users/:id/password-reset', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const account = await findHostedAccountByIdState(access.accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${access.accountId}' was not found.` }, 404);
  }
  const user = await findAccountUserByIdState(c.req.param('id'));
  if (!user || user.accountId !== access.accountId) {
    return c.json({ error: `Account user '${c.req.param('id')}' was not found.` }, 404);
  }
  const body = await c.req.json().catch(() => ({}));
  const ttlMinutes = typeof body.ttlMinutes === 'number' ? body.ttlMinutes : null;
  const issued = await issuePasswordResetTokenState({
    accountId: access.accountId,
    accountUserId: user.id,
    email: user.email,
    issuedByAccountUserId: access.accountUserId,
    ttlMinutes,
  });
  let delivery;
  try {
    delivery = await deliverHostedPasswordResetEmail({
      accountId: access.accountId,
      accountUserId: user.id,
      recipientEmail: user.email,
      displayName: user.displayName,
      accountName: account.accountName,
      token: issued.token,
    });
  } catch (err) {
    await revokeAccountUserActionTokenState(issued.record.id);
    const mapped = hostedEmailDeliveryErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  return c.json({
    reset: accountUserActionTokenView(issued.record),
    ...(delivery.tokenReturned ? { resetToken: issued.token } : {}),
    delivery,
  }, 201);
});

app.post('/api/v1/auth/password/reset', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const resetToken = typeof body.resetToken === 'string' ? body.resetToken.trim() : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!resetToken || !newPassword) {
    return c.json({ error: 'resetToken and newPassword are required.' }, 400);
  }
  if (newPassword.length < 12) {
    return c.json({ error: 'newPassword must be at least 12 characters long.' }, 400);
  }
  const tokenRecord = await findAccountUserActionTokenByTokenState(resetToken);
  if (!tokenRecord || tokenRecord.purpose !== 'password_reset' || !tokenRecord.accountUserId) {
    return c.json({ error: 'Password reset token is invalid or expired.' }, 400);
  }
  const user = await findAccountUserByIdState(tokenRecord.accountUserId);
  const account = user ? await findHostedAccountByIdState(user.accountId) : null;
  if (!user || !account || account.id !== tokenRecord.accountId || account.status === 'archived') {
    return c.json({ error: 'Password reset token is invalid or expired.' }, 400);
  }
  await setAccountUserPasswordState(user.id, newPassword);
  await revokeAccountSessionsForUserState(user.id);
  await revokeAccountUserActionTokensForUserState(user.id, 'password_reset');
  await consumeAccountUserActionTokenState(tokenRecord.id);
  deleteCookie(c, sessionCookieName(), {
    path: '/api/v1',
  });
  return c.json({
    reset: true,
  });
});

app.get('/api/v1/account/email/deliveries', async (c) => {
  const unauthorized = requireAccountSession(c, {
    roles: ['account_admin', 'billing_admin'],
  });
  if (unauthorized) return unauthorized;
  const access = currentAccountAccess(c)!;
  const purpose = c.req.query('purpose')?.trim();
  const status = c.req.query('status')?.trim();
  const provider = c.req.query('provider')?.trim();
  const recipient = c.req.query('recipient')?.trim();
  const limitRaw = c.req.query('limit')?.trim();
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const statusFilter = hostedEmailDeliveryStatusFilter(status);
  const providerFilter = hostedEmailDeliveryProviderFilter(provider);
  const deliveries = await listHostedEmailDeliveriesState({
    accountId: access.accountId,
    purpose: purpose === 'invite' || purpose === 'password_reset' ? purpose : null,
    status: statusFilter,
    provider: providerFilter,
    recipient: recipient || null,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return c.json({
    accountId: access.accountId,
    records: deliveries.records,
    summary: {
      purposeFilter: purpose ?? null,
      statusFilter: status ?? null,
      providerFilter: provider ?? null,
      recipientFilter: recipient ?? null,
      recordCount: deliveries.records.length,
    },
  });
});

app.post('/api/v1/account/billing/checkout', async (c) => {
  const roleGate = requireAccountSession(c, {
    roles: ['account_admin', 'billing_admin'],
  });
  if (roleGate) return roleGate;
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;

  const body = await c.req.json().catch(() => ({}));
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() ?? '';
  if (!idempotencyKey) {
    return c.json({ error: 'Idempotency-Key header is required for hosted checkout.' }, 400);
  }
  const requestedPlanId = typeof body.planId === 'string' ? body.planId.trim() : '';
  if (!requestedPlanId) {
    return c.json({ error: 'planId is required.' }, 400);
  }

  const plan = getHostedPlan(requestedPlanId);
  if (!plan || plan.intendedFor === 'self_host') {
    return c.json({
      error: `Hosted billing checkout only supports hosted/enterprise plans. Valid hosted plans: starter, pro, enterprise.`,
    }, 400);
  }

  let checkout;
  try {
    checkout = await createHostedCheckoutSession({
      account: current.account,
      tenant: current.tenant,
      plan,
      idempotencyKey,
    });
  } catch (err) {
    const mapped = stripeBillingErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }

  c.header('x-attestor-idempotency-key', idempotencyKey);
  return c.json({
    accountId: current.account.id,
    tenantId: current.tenant.tenantId,
    planId: checkout.planId,
    stripePriceId: checkout.stripePriceId,
    trialDays: checkout.trialDays,
    checkoutSessionId: checkout.sessionId,
    checkoutUrl: checkout.url,
    mock: checkout.mock,
  });
});

app.post('/api/v1/account/billing/portal', async (c) => {
  const roleGate = requireAccountSession(c, {
    roles: ['account_admin', 'billing_admin'],
  });
  if (roleGate) return roleGate;
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;

  let portal;
  try {
    portal = await createHostedBillingPortalSession({
      account: current.account,
    });
  } catch (err) {
    const mapped = stripeBillingErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }

  return c.json({
    accountId: current.account.id,
    tenantId: current.tenant.tenantId,
    portalSessionId: portal.sessionId,
    portalUrl: portal.url,
    mock: portal.mock,
  });
});

app.get('/api/v1/account/billing/export', async (c) => {
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;

  c.set('obs.accountId', current.account.id);
  c.set('obs.accountStatus', current.account.status);
  c.set('obs.tenantId', current.account.primaryTenantId);
  c.set('obs.planId', current.tenant.planId ?? current.account.billing.lastCheckoutPlanId ?? null);

  const format = (c.req.query('format')?.trim().toLowerCase() ?? 'json');
  if (format !== 'json' && format !== 'csv') {
    return c.json({ error: "format must be 'json' or 'csv'." }, 400);
  }

  const rawLimit = c.req.query('limit');
  const parsedLimit = rawLimit === undefined
    ? null
    : Number.parseInt(rawLimit, 10);
  if (rawLimit !== undefined && (parsedLimit === null || !Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
    return c.json({ error: 'limit must be a positive integer.' }, 400);
  }

  const entitlement = await readHostedBillingEntitlement(current.account);
  const payload = await buildHostedBillingExport({
    account: current.account,
    entitlement,
    limit: parsedLimit ?? undefined,
  });
  const reconciliation = buildHostedBillingReconciliation(payload);

  if (format === 'csv') {
    c.header('content-type', 'text/csv; charset=utf-8');
    c.header('cache-control', 'no-store');
    c.header('content-disposition', `attachment; filename="${current.account.id}-billing-export.csv"`);
    return c.body(renderHostedBillingExportCsv(payload));
  }

  return c.json({
    ...payload,
    entitlement: billingEntitlementView(entitlement),
    reconciliation,
  });
});

app.get('/api/v1/account/billing/reconciliation', async (c) => {
  const roleGate = requireAccountSession(c, {
    roles: ['account_admin', 'billing_admin', 'read_only'],
  });
  if (roleGate) return roleGate;
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;

  c.set('obs.accountId', current.account.id);
  c.set('obs.accountStatus', current.account.status);
  c.set('obs.tenantId', current.account.primaryTenantId);
  c.set('obs.planId', current.tenant.planId ?? current.account.billing.lastCheckoutPlanId ?? null);

  const rawLimit = c.req.query('limit');
  const parsedLimit = rawLimit === undefined
    ? null
    : Number.parseInt(rawLimit, 10);
  if (rawLimit !== undefined && (parsedLimit === null || !Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
    return c.json({ error: 'limit must be a positive integer.' }, 400);
  }

  const entitlement = await readHostedBillingEntitlement(current.account);
  const payload = await buildHostedBillingExport({
    account: current.account,
    entitlement,
    limit: parsedLimit ?? undefined,
  });
  const reconciliation = buildHostedBillingReconciliation(payload);

  return c.json({
    accountId: current.account.id,
    tenantId: current.account.primaryTenantId,
    stripeCustomerId: current.account.billing.stripeCustomerId,
    stripeSubscriptionId: current.account.billing.stripeSubscriptionId,
    entitlement: billingEntitlementView(entitlement),
    reconciliation,
  });
});

}



