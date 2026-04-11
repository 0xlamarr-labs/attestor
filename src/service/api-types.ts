/**
 * Attestor API Service Types — Exact Public Contract
 *
 * These types describe the actual runtime shapes emitted by api-server.ts.
 * They are the source of truth for API consumers.
 */

// ─── Sync Pipeline ──────────────────────────────────────────────────────────

export interface SyncPipelineRunRequest {
  candidateSql: string;
  intent: Record<string, unknown>;
  sign?: boolean;
  fixtures?: Record<string, unknown>[];
  generatedReport?: Record<string, unknown>;
  reportContract?: Record<string, unknown>;
  connector?: string;
  reviewerOidcToken?: string;
  oidcIssuer?: string;
  oidcAudience?: string;
  reviewerName?: string;
  reviewerRole?: string;
  reviewerIdentifier?: string;
}

export interface SyncPipelineRunResponse {
  runId: string;
  decision: string;
  scoring: { scorersRun: number; decision: string };
  warrant: string;
  escrow: string;
  receipt: string | null;
  capsule: string | null;
  proofMode: string;
  auditEntries: number;
  auditChainIntact: boolean;
  certificate: Record<string, unknown> | null;
  verification: Record<string, unknown> | null;
  publicKeyPem: string | null;
  trustChain: Record<string, unknown> | null;
  caPublicKeyPem: string | null;
  signingMode: 'keyless' | null;
  connectorUsed: string | null;
  schemaAttestation: SchemaAttestationSummary | null;
  tenantContext: { tenantId: string; source: string; planId: string | null };
  usage: UsageContext;
  rateLimit: RateLimitContext;
  identitySource: 'operator_asserted' | 'oidc_verified' | 'pki_bound';
  reviewerName: string | null;
  filingExport: { adapterId: string; coveragePercent: number; mappedCount: number } | null;
  filingPackage: {
    adapterId: string;
    coveragePercent: number;
    mappedCount: number;
    issuedPackage: Record<string, unknown>;
  } | null;
}

// ─── Async Pipeline ─────────────────────────────────────────────────────────

export interface AsyncPipelineRunRequest {
  candidateSql: string;
  intent: Record<string, unknown>;
  sign?: boolean;
  fixtures?: Record<string, unknown>[];
  generatedReport?: Record<string, unknown>;
  reportContract?: Record<string, unknown>;
}

export interface AsyncPipelineSubmitResponse {
  jobId: string;
  status: 'queued';
  backendMode: 'bullmq' | 'in_process';
  submittedAt: string;
  tenantContext: { tenantId: string; source: string; planId: string | null };
  usage: UsageContext;
  rateLimit: RateLimitContext;
  asyncQueue: {
    tenantPendingJobs: number;
    tenantPendingLimit: number | null;
    tenantIsolationEnforced: boolean;
    tenantActiveExecutions: number;
    tenantActiveExecutionLimit: number | null;
    tenantActiveExecutionEnforced: boolean;
    tenantActiveExecutionBackend: 'memory' | 'redis';
    tenantWeightedDispatchEnforced: boolean;
    tenantWeightedDispatchBackend: 'memory' | 'redis';
    tenantWeightedDispatchWeight: number | null;
    tenantWeightedDispatchWindowMs: number | null;
    tenantWeightedDispatchNextEligibleAt: string | null;
    tenantWeightedDispatchWaitMs: number;
    retryPolicy: {
      attempts: number;
      backoffMs: number;
      maxStalledCount: number;
      workerConcurrency: number;
      completedTtlSeconds: number;
      failedTtlSeconds: number;
    };
  };
}

export interface AsyncPipelineStatusResponse {
  jobId: string;
  backendMode: 'bullmq' | 'in_process';
  status: 'queued' | 'running' | 'waiting' | 'active' | 'delayed' | 'prioritized' | 'completed' | 'failed';
  submittedAt: string | null;
  completedAt: string | null;
  result: {
    runId: string;
    decision: string;
    proofMode: string;
    certificateId: string | null;
    certificate: Record<string, unknown> | null;
    verification: Record<string, unknown> | null;
    publicKeyPem: string | null;
    trustChain: Record<string, unknown> | null;
    caPublicKeyPem: string | null;
  } | null;
  error: string | null;
  attemptsMade: number;
  maxAttempts: number;
  tenantContext: { tenantId: string; source: string; planId: string | null } | null;
  failedAt: string | null;
}

// ─── Verify ─────────────────────────────────────────────────────────────────

export interface VerifyRequest {
  certificate: Record<string, unknown>;
  publicKeyPem: string;
  trustChain?: Record<string, unknown>;
  caPublicKeyPem?: string;
}

export interface VerifyResponse {
  signatureValid: boolean;
  fingerprintConsistent: boolean;
  schemaValid: boolean;
  overall: 'valid' | 'invalid' | 'schema_error';
  explanation: string;
  chainVerification: {
    caValid: boolean;
    leafValid: boolean;
    chainIntact: boolean;
    issuerMatch: boolean;
    caExpired: boolean;
    leafExpired: boolean;
    leafMatchesCertificateKey: boolean;
    leafMatchesCertificateFingerprint: boolean;
    pkiBound: boolean;
    overall: string;
    caName: string | null;
    leafSubject: string | null;
  } | null;
  trustBinding: {
    certificateSignature: boolean;
    chainValid: boolean;
    certificateBoundToLeaf: boolean;
    pkiVerified: boolean;
  };
}

// ─── Filing Export ──────────────────────────────────────────────────────────

export interface FilingExportRequest {
  adapterId: string;
  runId: string;
  decision?: string;
  certificateId?: string;
  evidenceChainTerminal?: string;
  rows: Record<string, unknown>[];
  proofMode?: string;
}

export interface FilingExportResponse {
  adapterId: string;
  format: string;
  taxonomyVersion: string;
  mapping: { mappedCount: number; unmappedCount: number; coveragePercent: number };
  package: Record<string, unknown>;
}

// ─── Schema Attestation ────────────────────────────────────────────────────

export interface SchemaAttestationSummary {
  present: boolean;
  scope: 'schema_attestation_full' | 'schema_attestation_connector' | 'execution_context_only';
  executionContextHash: string | null;
  provider: string | null;
  txidSnapshot: string | null;
  columnFingerprint: string | null;
  constraintFingerprint: string | null;
  indexFingerprint: string | null;
  schemaFingerprint: string | null;
  sentinelFingerprint: string | null;
  contentFingerprint: string | null;
  tableNames: string[] | null;
  attestationHash: string | null;
  tableFingerprints: Array<{
    tableName: string;
    rowCount: number;
    sampledRowCount: number;
    rowLimit: number;
    mode: 'full' | 'truncated' | 'unavailable';
    orderBy: string[];
    maxXmin: string | null;
    contentHash: string | null;
  }> | null;
  historicalComparison: {
    historyKey: string;
    previousCapturedAt: string;
    previousAttestationHash: string;
    currentAttestationHash: string;
    schemaChanged: boolean;
    dataChanged: boolean;
    contentChanged: boolean;
    summary: string;
  } | null;
}

// ─── Health ─────────────────────────────────────────────────────────────────

export interface ServiceHealth {
  status: 'healthy';
  version: string;
  uptime: number;
  domains: string[];
  connectors: string[];
  filingAdapters: string[];
  pki: {
    ready: boolean;
    caName: string;
    caFingerprint: string;
    signerSubject: string;
    reviewerSubject: string;
  };
  tenantIsolation: {
    requestLevel: boolean;
    databaseRls: {
      schemaAvailable: boolean;
      configured: boolean;
      activated: boolean;
      verified: boolean;
    };
  };
  engine: string;
}

export interface AccountUsageResponse {
  tenantContext: { tenantId: string; source: string; planId: string | null };
  usage: UsageContext;
  rateLimit: RateLimitContext;
}

export interface AccountSummaryResponse {
  account: AdminAccountRecord;
  entitlement: AccountBillingEntitlementRecord;
  tenantContext: { tenantId: string; source: string; planId: string | null };
  usage: UsageContext;
  rateLimit: RateLimitContext;
}

export interface AccountBillingEntitlementRecord {
  id: string;
  accountId: string;
  tenantId: string;
  provider: 'manual' | 'stripe';
  status: 'provisioned' | 'checkout_completed' | 'active' | 'trialing' | 'delinquent' | 'suspended' | 'archived';
  accessEnabled: boolean;
  effectivePlanId: string | null;
  requestedPlanId: string | null;
  monthlyRunQuota: number | null;
  requestsPerWindow: number | null;
  asyncPendingJobsPerTenant: number | null;
  accountStatus: 'active' | 'suspended' | 'archived';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus:
    | 'trialing'
    | 'active'
    | 'incomplete'
    | 'incomplete_expired'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | null;
  stripePriceId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeInvoiceId: string | null;
  stripeInvoiceStatus: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null;
  stripeEntitlementLookupKeys: string[];
  stripeEntitlementFeatureIds: string[];
  stripeEntitlementSummaryUpdatedAt: string | null;
  lastEventId: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  effectiveAt: string | null;
  delinquentSince: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountBillingEntitlementResponse {
  entitlement: AccountBillingEntitlementRecord;
}

export interface AccountFeatureRecord {
  key:
    | 'api.access'
    | 'account.users'
    | 'billing.checkout'
    | 'billing.portal'
    | 'billing.export'
    | 'billing.reconciliation'
    | 'async.pipeline'
    | 'iam.oidc_sso'
    | 'iam.saml_sso'
    | 'healthcare.validation';
  displayName: string;
  description: string;
  category: 'access' | 'account' | 'billing' | 'runtime' | 'identity' | 'domain';
  granted: boolean;
  available: boolean;
  grantSource: 'stripe_entitlement' | 'plan_default' | 'stripe_not_granted' | 'not_in_plan';
  planEligible: boolean;
  stripeManaged: boolean;
  stripeSummaryPresent: boolean;
  configuredLookupKeys: string[];
  matchedLookupKeys: string[];
}

export interface AccountFeaturesResponse {
  accountId: string;
  tenantId: string;
  effectivePlanId: string | null;
  provider: 'manual' | 'stripe';
  entitlementStatus: 'provisioned' | 'checkout_completed' | 'active' | 'trialing' | 'delinquent' | 'suspended' | 'archived';
  accessEnabled: boolean;
  stripeSummaryUpdatedAt: string | null;
  features: AccountFeatureRecord[];
  summary: {
    featureCount: number;
    grantedCount: number;
    availableCount: number;
    stripeGrantedCount: number;
    planDefaultCount: number;
    stripeDeniedCount: number;
    notInPlanCount: number;
    stripeSummaryPresent: boolean;
  };
}

export interface AccountUserMfaSummaryView {
  enabled: boolean;
  method: 'totp' | null;
  enrolledAt: string | null;
  pendingEnrollment: boolean;
}

export interface AccountUserFederationSummaryView {
  oidcLinked: boolean;
  oidcIdentityCount: number;
  lastOidcLoginAt: string | null;
  samlLinked: boolean;
  samlIdentityCount: number;
  lastSamlLoginAt: string | null;
}

export interface AccountUserPasskeySummaryView {
  enabled: boolean;
  credentialCount: number;
  userHandleConfigured: boolean;
  lastUsedAt: string | null;
}

export interface AccountUserRecordView {
  id: string;
  accountId: string;
  email: string;
  displayName: string;
  role: 'account_admin' | 'billing_admin' | 'read_only';
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  lastLoginAt: string | null;
  mfa: AccountUserMfaSummaryView;
  passkeys: AccountUserPasskeySummaryView;
  federation: AccountUserFederationSummaryView;
}

export interface AccountUsersListResponse {
  users: AccountUserRecordView[];
}

export interface AccountBootstrapUserRequest {
  email: string;
  displayName: string;
  password: string;
}

export interface AccountBootstrapUserResponse {
  user: AccountUserRecordView;
  bootstrap: true;
}

export interface AccountCreateUserRequest {
  email: string;
  displayName: string;
  password: string;
  role: 'account_admin' | 'billing_admin' | 'read_only';
}

export interface AccountCreateUserResponse {
  user: AccountUserRecordView;
}

export interface AccountSetUserStatusResponse {
  user: AccountUserRecordView;
}

export interface AccountUserActionTokenRecordView {
  id: string;
  purpose: 'invite' | 'password_reset' | 'mfa_login' | 'passkey_registration' | 'passkey_authentication';
  accountId: string;
  accountUserId: string | null;
  email: string;
  displayName: string | null;
  role: 'account_admin' | 'billing_admin' | 'read_only' | null;
  status: 'pending' | 'consumed' | 'revoked' | 'expired';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

export interface AccountUserInvitesListResponse {
  invites: AccountUserActionTokenRecordView[];
}

export interface AccountInviteUserRequest {
  email: string;
  displayName: string;
  role: 'account_admin' | 'billing_admin' | 'read_only';
  expiresHours?: number;
}

export interface AccountInviteUserResponse {
  invite: AccountUserActionTokenRecordView;
  inviteToken?: string | null;
  delivery: {
    deliveryId: string;
    mode: 'manual' | 'smtp';
    provider: 'manual' | 'smtp' | 'sendgrid_smtp';
    channel: 'api_response' | 'smtp';
    delivered: boolean;
    recipient: string;
    messageId: string | null;
    actionUrl: string | null;
    tokenReturned: boolean;
  };
}

export interface AccountRevokeInviteResponse {
  invite: AccountUserActionTokenRecordView;
}

export interface AccountAcceptInviteRequest {
  inviteToken: string;
  password: string;
}

export interface AccountAcceptInviteResponse {
  accepted: true;
  session: {
    id: string;
    expiresAt: string;
    source: 'account_session';
  };
  user: AccountUserRecordView;
  account: AdminAccountRecord;
}

export interface AccountIssuePasswordResetRequest {
  ttlMinutes?: number;
}

export interface AccountIssuePasswordResetResponse {
  reset: AccountUserActionTokenRecordView;
  resetToken?: string | null;
  delivery: {
    deliveryId: string;
    mode: 'manual' | 'smtp';
    provider: 'manual' | 'smtp' | 'sendgrid_smtp';
    channel: 'api_response' | 'smtp';
    delivered: boolean;
    recipient: string;
    messageId: string | null;
    actionUrl: string | null;
    tokenReturned: boolean;
  };
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthOidcLoginRequest {
  email?: string;
}

export interface AuthSamlLoginRequest {
  email?: string;
}

export interface AuthOidcUpstreamView {
  provider: 'oidc';
  issuer: string;
  subject: string;
}

export interface AuthSamlUpstreamView {
  provider: 'saml';
  issuer: string;
  subject: string;
  nameId: string;
}

export interface AuthPasskeyUpstreamView {
  provider: 'passkey';
  credentialId: string;
}

export type AuthUpstreamAuthView = AuthOidcUpstreamView | AuthSamlUpstreamView | AuthPasskeyUpstreamView;

export interface AuthLoginResponse {
  session: {
    id: string;
    expiresAt: string;
    source: 'account_session';
  };
  upstreamAuth?: AuthUpstreamAuthView;
  user: AccountUserRecordView;
  account: AdminAccountRecord;
}

export interface AuthLoginMfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
  challenge: {
    id: string;
    method: 'totp' | 'passkey_totp_fallback';
    expiresAt: string;
    maxAttempts: number | null;
    remainingAttempts: number | null;
  };
  upstreamAuth?: AuthUpstreamAuthView;
  user: AccountUserRecordView;
  account: AdminAccountRecord;
}

export interface AuthOidcLoginResponse {
  authorization: {
    mode: 'authorization_code_pkce';
    issuerUrl: string;
    redirectUrl: string;
    scopes: string[];
    authorizationUrl: string;
    expiresAt: string;
  };
}

export interface AuthSamlLoginResponse {
  authorization: {
    mode: 'sp_initiated_redirect';
    entityId: string;
    metadataUrl: string;
    acsUrl: string;
    authorizationUrl: string;
    requestId: string;
    expiresAt: string;
  };
}

export interface AuthMfaVerifyRequest {
  challengeToken: string;
  code?: string;
  recoveryCode?: string;
}

export interface AuthMfaVerifyResponse {
  verified: true;
  recoveryCodeUsed: boolean;
  session: {
    id: string;
    expiresAt: string;
    source: 'account_session';
  };
  user: AccountUserRecordView;
  account: AdminAccountRecord;
}

export interface AccountPasskeyCredentialView {
  id: string;
  credentialId: string;
  transports: Array<'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'>;
  aaguid: string | null;
  deviceType: 'singleDevice' | 'multiDevice' | null;
  backedUp: boolean | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AccountPasskeysResponse {
  passkeys: {
    enabled: boolean;
    credentialCount: number;
    userHandleConfigured: boolean;
    lastUsedAt: string | null;
    updatedAt: string | null;
    credentials: AccountPasskeyCredentialView[];
  };
}

export interface AccountPasskeyRegisterOptionsRequest {
  password: string;
  preferredAuthenticatorType?: 'securityKey' | 'localDevice' | 'remoteDevice';
}

export interface AccountPasskeyRegisterOptionsResponse {
  challengeToken: string;
  registration: Record<string, unknown>;
  rp: {
    id: string;
    name: string;
    origin: string;
  };
}

export interface AccountPasskeyRegisterVerifyRequest {
  challengeToken: string;
  response: Record<string, unknown>;
}

export interface AccountPasskeyRegisterVerifyResponse {
  registered: true;
  passkey: AccountPasskeyCredentialView;
  user: AccountUserRecordView;
}

export interface AccountPasskeyDeleteRequest {
  password: string;
}

export interface AccountPasskeyDeleteResponse {
  deleted: true;
  passkeyId: string;
  user: AccountUserRecordView;
}

export interface AuthPasskeyOptionsRequest {
  email?: string;
}

export interface AuthPasskeyOptionsResponse {
  challengeToken: string;
  authentication: Record<string, unknown>;
  mode: 'usernameless' | 'email_lookup';
  hintedUser: AccountUserRecordView | null;
}

export interface AuthPasskeyVerifyRequest {
  challengeToken: string;
  response: Record<string, unknown>;
}

export interface AuthMeResponse {
  session: {
    id: string;
    source: 'account_session';
    role: 'account_admin' | 'billing_admin' | 'read_only';
  };
  user: AccountUserRecordView;
  account: AdminAccountRecord;
}

export interface AuthLogoutResponse {
  loggedOut: true;
}

export interface AuthPasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

export interface AuthPasswordChangeResponse {
  changed: true;
  session: {
    id: string;
    expiresAt: string;
    source: 'account_session';
  };
  user: AccountUserRecordView;
}

export interface AuthPasswordResetRequest {
  resetToken: string;
  newPassword: string;
}

export interface AuthPasswordResetResponse {
  reset: true;
}

export interface AccountMfaSummaryResponse {
  mfa: {
    enabled: boolean;
    method: 'totp' | null;
    enrolledAt: string | null;
    pendingEnrollment: boolean;
    recoveryCodesRemaining: number;
    lastVerifiedAt: string | null;
    updatedAt: string | null;
  };
}

export interface AccountOidcSummaryResponse {
  oidc: {
    configured: boolean;
    issuerUrl: string | null;
    redirectUrl: string | null;
    scopes: string[];
    identities: Array<{
      id: string;
      issuer: string;
      subject: string;
      email: string | null;
      linkedAt: string;
      lastLoginAt: string | null;
    }>;
  };
}

export interface AccountSamlSummaryResponse {
  saml: {
    configured: boolean;
    entityId: string | null;
    metadataUrl: string | null;
    acsUrl: string | null;
    authnRequestsSigned: boolean;
    identities: Array<{
      id: string;
      issuer: string;
      subject: string;
      email: string | null;
      nameIdFormat: string | null;
      linkedAt: string;
      lastLoginAt: string | null;
    }>;
  };
}

export interface AccountMfaTotpEnrollRequest {
  password: string;
}

export interface AccountMfaTotpEnrollResponse {
  enrollment: {
    method: 'totp';
    issuer: string;
    accountName: string;
    secretBase32: string;
    otpauthUrl: string;
    digits: 6;
    periodSeconds: 30;
    algorithm: 'SHA1';
    pendingIssuedAt: string;
  };
}

export interface AccountMfaTotpConfirmRequest {
  code: string;
}

export interface AccountMfaTotpConfirmResponse {
  enabled: true;
  recoveryCodes: string[];
  session: {
    id: string;
    expiresAt: string;
    source: 'account_session';
  };
  user: AccountUserRecordView;
}

export interface AccountMfaDisableRequest {
  password: string;
  code?: string;
  recoveryCode?: string;
}

export interface AccountMfaDisableResponse {
  disabled: true;
  recoveryCodeUsed: boolean;
  session: {
    id: string;
    expiresAt: string;
    source: 'account_session';
  };
  user: AccountUserRecordView;
}

export interface AccountBillingCheckoutRequest {
  planId: 'starter' | 'pro' | 'enterprise';
}

export interface EmailDeliveryRecordView {
  deliveryId: string;
  accountId: string | null;
  accountUserId: string | null;
  purpose: 'invite' | 'password_reset' | null;
  provider: 'manual' | 'smtp' | 'sendgrid_smtp';
  channel: 'api_response' | 'smtp';
  recipient: string;
  messageId: string | null;
  providerMessageId: string | null;
  actionUrl: string | null;
  tokenReturned: boolean;
  status: 'manual_delivered' | 'smtp_sent' | 'processed' | 'delivered' | 'deferred' | 'bounced' | 'dropped' | 'failed' | 'unknown';
  latestEventType: string | null;
  latestEventAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  deferredAt: string | null;
  failedAt: string | null;
  firstOpenedAt: string | null;
  lastClickedAt: string | null;
  opened: boolean;
  clicked: boolean;
  unsubscribed: boolean;
  spamReported: boolean;
  failureReason: string | null;
  eventCount: number;
}

export interface AccountEmailDeliveriesResponse {
  accountId: string;
  records: EmailDeliveryRecordView[];
  summary: {
    purposeFilter: 'invite' | 'password_reset' | null;
    statusFilter: EmailDeliveryRecordView['status'] | null;
    providerFilter: EmailDeliveryRecordView['provider'] | null;
    recipientFilter: string | null;
    recordCount: number;
  };
}

export interface AdminEmailDeliveriesResponse {
  records: EmailDeliveryRecordView[];
  summary: {
    accountFilter: string | null;
    purposeFilter: 'invite' | 'password_reset' | null;
    statusFilter: EmailDeliveryRecordView['status'] | null;
    providerFilter: EmailDeliveryRecordView['provider'] | null;
    recipientFilter: string | null;
    recordCount: number;
  };
}

export interface SendGridWebhookResponse {
  received: true;
  provider: 'sendgrid_smtp';
  eventCount: number;
  applied: number;
  duplicate: number;
  ignored: number;
  conflict: number;
}

export interface AccountBillingCheckoutResponse {
  accountId: string;
  tenantId: string;
  planId: 'starter' | 'pro' | 'enterprise';
  stripePriceId: string;
  checkoutSessionId: string;
  checkoutUrl: string;
  mock: boolean;
}

export interface AccountBillingPortalResponse {
  accountId: string;
  tenantId: string;
  portalSessionId: string;
  portalUrl: string;
  mock: boolean;
}

export interface BillingExportCheckoutSummary {
  sessionId: string | null;
  completedAt: string | null;
  planId: string | null;
}

export interface BillingExportInvoiceRecord {
  invoiceId: string;
  status: string | null;
  currency: string | null;
  amountPaid: number | null;
  amountDue: number | null;
  subscriptionId: string | null;
  priceId: string | null;
  billingReason: string | null;
  createdAt: string | null;
  paidAt: string | null;
  lastEventType: string | null;
  source: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary';
}

export interface BillingExportChargeRecord {
  chargeId: string | null;
  invoiceId: string | null;
  amount: number | null;
  amountRefunded: number | null;
  currency: string | null;
  status: 'succeeded' | 'pending' | 'failed' | null;
  paid: boolean | null;
  refunded: boolean | null;
  createdAt: string | null;
  source: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary';
}

export interface BillingExportInvoiceLineItemRecord {
  lineItemId: string;
  invoiceId: string;
  subscriptionId: string | null;
  priceId: string | null;
  description: string | null;
  currency: string | null;
  amount: number | null;
  subtotal: number | null;
  quantity: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  proration: boolean | null;
  captureMode: 'full' | 'partial';
  source: 'stripe_live' | 'ledger_derived' | 'mock_summary';
}

export interface BillingExportEntitlementFeatures {
  lookupKeys: string[];
  featureIds: string[];
  source: 'stripe_live' | 'entitlement_read_model' | 'none';
}

export interface AccountBillingExportResponse {
  accountId: string;
  tenantId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  entitlement: AccountBillingEntitlementRecord;
  checkout: BillingExportCheckoutSummary;
  invoices: BillingExportInvoiceRecord[];
  charges: BillingExportChargeRecord[];
  lineItems: BillingExportInvoiceLineItemRecord[];
  entitlementFeatures: BillingExportEntitlementFeatures;
  reconciliation: AccountBillingReconciliationSummary;
  summary: {
    dataSource: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary' | 'empty';
    mock: boolean;
    sharedBillingLedger: boolean;
    requestedLimit: number;
    invoiceCount: number;
    chargeCount: number;
    lineItemCount: number;
  };
}

export interface BillingReconciliationCheck {
  status: 'match' | 'mismatch' | 'unavailable';
  basis: 'invoice_amount_due' | 'invoice_amount_paid' | null;
  expectedAmount: number | null;
  actualAmount: number | null;
}

export interface BillingReconciliationInvoiceRecord {
  invoiceId: string;
  source: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary';
  currency: string | null;
  invoiceStatus: string | null;
  amountPaid: number | null;
  amountDue: number | null;
  chargeCount: number;
  lineItemCount: number;
  chargeAmountTotal: number | null;
  chargeNetAmountTotal: number | null;
  lineItemAmountTotal: number | null;
  lineItemSubtotalTotal: number | null;
  checks: {
    lineItemsVsInvoice: BillingReconciliationCheck;
    chargesVsInvoicePaid: BillingReconciliationCheck;
    netChargesVsInvoicePaid: BillingReconciliationCheck;
  };
  overallStatus: 'reconciled' | 'partial' | 'needs_attention';
  reasons: string[];
}

export interface AccountBillingReconciliationSummary {
  invoices: BillingReconciliationInvoiceRecord[];
  summary: {
    status: 'reconciled' | 'partial' | 'needs_attention' | 'empty';
    dataSource: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary' | 'empty';
    sharedBillingLedger: boolean;
    invoiceCount: number;
    reconciledCount: number;
    partialCount: number;
    attentionCount: number;
    chargeRecordCount: number;
    lineItemRecordCount: number;
  };
}

export interface AccountBillingReconciliationResponse {
  accountId: string;
  tenantId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  entitlement: AccountBillingEntitlementRecord;
  reconciliation: AccountBillingReconciliationSummary;
}

export interface AdminTenantKeyRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
  apiKeyPreview: string;
  sealedStorage: {
    enabled: boolean;
    provider: 'vault_transit' | null;
    keyName: string | null;
    sealedAt: string | null;
    breakGlassRecoverable: boolean;
  };
  status: 'active' | 'inactive' | 'revoked';
  createdAt: string;
  lastUsedAt: string | null;
  deactivatedAt: string | null;
  revokedAt: string | null;
  rotatedFromKeyId: string | null;
  supersededByKeyId: string | null;
  supersededAt: string | null;
}

export interface AdminListTenantKeysResponse {
  keys: AdminTenantKeyRecord[];
  defaults: {
    maxActiveKeysPerTenant: number;
  };
}

export interface AdminIssueTenantKeyRequest {
  tenantId: string;
  tenantName: string;
  planId?: string;
  monthlyRunQuota?: number | null;
}

export interface AdminIssueTenantKeyResponse {
  key: AdminTenantKeyRecord & { apiKey: string };
}

export interface AdminRotateTenantKeyRequest {
  planId?: string;
  monthlyRunQuota?: number | null;
}

export interface AdminRotateTenantKeyResponse {
  previousKey: AdminTenantKeyRecord;
  newKey: AdminTenantKeyRecord & { apiKey: string };
}

export interface AdminTenantKeyStatusResponse {
  key: AdminTenantKeyRecord;
}

export interface AdminRecoverTenantKeyRequest {
  reason?: string;
}

export interface AdminRecoverTenantKeyResponse {
  key: AdminTenantKeyRecord & { apiKey: string };
}

export interface AdminAccountBillingSummary {
  provider: 'stripe' | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus:
    | 'trialing'
    | 'active'
    | 'incomplete'
    | 'incomplete_expired'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | null;
  stripePriceId: string | null;
  lastCheckoutSessionId: string | null;
  lastCheckoutCompletedAt: string | null;
  lastCheckoutPlanId: string | null;
  lastInvoiceId: string | null;
  lastInvoiceStatus: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null;
  lastInvoiceCurrency: string | null;
  lastInvoiceAmountPaid: number | null;
  lastInvoiceAmountDue: number | null;
  lastInvoiceEventId: string | null;
  lastInvoiceEventType: string | null;
  lastInvoiceProcessedAt: string | null;
  lastInvoicePaidAt: string | null;
  delinquentSince: string | null;
  lastWebhookEventId: string | null;
  lastWebhookEventType: string | null;
  lastWebhookProcessedAt: string | null;
}

export interface AdminAccountRecord {
  id: string;
  accountName: string;
  contactEmail: string;
  primaryTenantId: string;
  status: 'active' | 'suspended' | 'archived';
  createdAt: string;
  updatedAt: string;
  suspendedAt: string | null;
  archivedAt: string | null;
  billing: AdminAccountBillingSummary;
}

export interface AdminListAccountsResponse {
  accounts: AdminAccountRecord[];
}

export interface AdminCreateAccountRequest {
  accountName: string;
  contactEmail: string;
  tenantId: string;
  tenantName: string;
  planId?: string;
  monthlyRunQuota?: number | null;
}

export interface AdminCreateAccountResponse {
  account: AdminAccountRecord;
  initialKey: AdminTenantKeyRecord & { apiKey: string };
}

export interface AdminAttachStripeBillingRequest {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionStatus?:
    | 'trialing'
    | 'active'
    | 'incomplete'
    | 'incomplete_expired'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | null;
  stripePriceId?: string | null;
}

export interface AdminAccountLifecycleResponse {
  account: AdminAccountRecord;
}

export interface HostedPlanSummary {
  id: 'community' | 'starter' | 'pro' | 'enterprise';
  displayName: string;
  description: string;
  defaultMonthlyRunQuota: number | null;
  defaultPipelineRequestsPerWindow: number | null;
  defaultAsyncPendingJobsPerTenant: number | null;
  defaultAsyncActiveJobsPerTenant: number | null;
  stripePriceConfigured: boolean;
  intendedFor: 'self_host' | 'hosted' | 'enterprise';
  defaultForHostedProvisioning: boolean;
}

export interface AdminListPlansResponse {
  plans: HostedPlanSummary[];
  defaults: {
    hostedProvisioningPlanId: 'starter';
    maxActiveKeysPerTenant: number;
    rateLimitWindowSeconds: number;
    asyncExecutionShared: boolean;
    asyncExecutionBackend: 'memory' | 'redis';
  };
}

export interface AdminAuditRecordResponse {
  id: string;
  occurredAt: string;
  actorType: 'admin_api_key' | 'stripe_webhook';
  actorLabel: string;
  action:
    | 'account.created'
    | 'account.suspended'
    | 'account.reactivated'
    | 'account.archived'
    | 'account.billing.attached'
    | 'async_job.retried'
    | 'billing.stripe.webhook_applied'
    | 'tenant_key.issued'
    | 'tenant_key.rotated'
    | 'tenant_key.deactivated'
    | 'tenant_key.reactivated'
    | 'tenant_key.revoked';
  routeId: string;
  accountId: string | null;
  tenantId: string | null;
  tenantKeyId: string | null;
  planId: string | null;
  monthlyRunQuota: number | null;
  idempotencyKey: string | null;
  requestHash: string;
  metadata: Record<string, unknown>;
  previousHash: string | null;
  eventHash: string;
}

export interface AdminAuditResponse {
  records: AdminAuditRecordResponse[];
  summary: {
    actionFilter:
      | 'account.created'
      | 'account.suspended'
      | 'account.reactivated'
      | 'account.archived'
      | 'account.billing.attached'
      | 'async_job.retried'
      | 'billing.stripe.webhook_applied'
      | 'tenant_key.issued'
      | 'tenant_key.rotated'
      | 'tenant_key.deactivated'
      | 'tenant_key.reactivated'
      | 'tenant_key.revoked'
      | null;
    tenantFilter: string | null;
    accountFilter: string | null;
    recordCount: number;
    chainIntact: boolean;
    latestHash: string | null;
  };
}

export interface AdminUsageRecord {
  tenantId: string;
  tenantName: string | null;
  accountId: string | null;
  accountName: string | null;
  planId: string | null;
  monthlyRunQuota: number | null;
  meter: 'monthly_pipeline_runs';
  period: string;
  used: number;
  remaining: number | null;
  enforced: boolean;
  updatedAt: string;
}

export interface AdminUsageResponse {
  records: AdminUsageRecord[];
  summary: {
    tenantFilter: string | null;
    periodFilter: string | null;
    recordCount: number;
    tenantCount: number;
    totalUsed: number;
  };
}

export interface AdminBillingEventRecord {
  id: string;
  provider: 'stripe';
  source: 'stripe_webhook';
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  outcome: 'pending' | 'applied' | 'ignored';
  reason: string | null;
  accountId: string | null;
  tenantId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeInvoiceId: string | null;
  stripeInvoiceStatus: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null;
  stripeInvoiceCurrency: string | null;
  stripeInvoiceAmountPaid: number | null;
  stripeInvoiceAmountDue: number | null;
  accountStatusBefore: 'active' | 'suspended' | 'archived' | null;
  accountStatusAfter: 'active' | 'suspended' | 'archived' | null;
  billingStatusBefore:
    | 'trialing'
    | 'active'
    | 'incomplete'
    | 'incomplete_expired'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | null;
  billingStatusAfter:
    | 'trialing'
    | 'active'
    | 'incomplete'
    | 'incomplete_expired'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | null;
  mappedPlanId: string | null;
  receivedAt: string;
  processedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface AdminBillingEventsResponse {
  records: AdminBillingEventRecord[];
  summary: {
    providerFilter: 'stripe' | null;
    accountFilter: string | null;
    tenantFilter: string | null;
    eventTypeFilter: string | null;
    outcomeFilter: 'applied' | 'ignored' | null;
    recordCount: number;
    appliedCount: number;
    ignoredCount: number;
    pendingCount: number;
  };
}

export interface AdminBillingEntitlementsResponse {
  records: AccountBillingEntitlementRecord[];
  summary: {
    accountFilter: string | null;
    tenantFilter: string | null;
    statusFilter:
      | 'provisioned'
      | 'checkout_completed'
      | 'active'
      | 'trialing'
      | 'delinquent'
      | 'suspended'
      | 'archived'
      | null;
    recordCount: number;
    accessEnabledCount: number;
    providerCounts: {
      manual: number;
      stripe: number;
    };
  };
}

export interface AdminAccountBillingExportResponse extends AccountBillingExportResponse {}
export interface AdminAccountBillingReconciliationResponse extends AccountBillingReconciliationResponse {}

export interface AdminAsyncQueueTenantSnapshot {
  tenantId: string;
  planId: string | null;
  pendingJobs: number;
  pendingLimit: number | null;
  enforced: boolean;
  activeExecutions: number;
  activeExecutionLimit: number | null;
  activeExecutionEnforced: boolean;
  activeExecutionBackend: 'memory' | 'redis';
  weightedDispatchEnforced: boolean;
  weightedDispatchBackend: 'memory' | 'redis';
  weightedDispatchWeight: number | null;
  weightedDispatchWindowMs: number | null;
  weightedDispatchNextEligibleAt: string | null;
  weightedDispatchWaitMs: number;
  scanLimit: number;
  scanTruncated: boolean;
  states: {
    waiting: number;
    active: number;
    delayed: number;
    prioritized: number;
    failed: number;
  };
}

export interface AdminAsyncQueueSummaryResponse {
  backendMode: 'bullmq' | 'in_process';
  queueName: string | null;
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    prioritized: number;
    completed: number;
    failed: number;
    paused: number;
  };
  retryPolicy: {
    attempts: number;
    backoffMs: number;
    maxStalledCount: number;
    workerConcurrency: number;
    completedTtlSeconds: number;
    failedTtlSeconds: number;
  };
  tenant: AdminAsyncQueueTenantSnapshot | null;
}

export interface AdminAsyncDeadLetterRecord {
  jobId: string;
  name: string;
  backendMode: 'bullmq' | 'in_process';
  tenantId: string | null;
  planId: string | null;
  state: string;
  failedReason: string | null;
  attemptsMade: number;
  maxAttempts: number;
  requestedAt: string | null;
  submittedAt: string | null;
  processedAt: string | null;
  failedAt: string | null;
  recordedAt: string;
}

export interface AdminAsyncDeadLetterResponse {
  records: AdminAsyncDeadLetterRecord[];
  summary: {
    backendMode: 'bullmq' | 'in_process';
    tenantFilter: string | null;
    limit: number;
    recordCount: number;
  };
}

export interface AdminAsyncRetryResponse {
  job: AdminAsyncDeadLetterRecord;
}

export interface UsageContext {
  tenantId: string;
  planId: string;
  meter: 'monthly_pipeline_runs';
  period: string;
  used: number;
  quota: number | null;
  remaining: number | null;
  enforced: boolean;
}

export interface RateLimitContext {
  tenantId: string;
  planId: string;
  scope: 'pipeline_requests';
  backend: 'memory' | 'redis';
  windowSeconds: number;
  requestsPerWindow: number | null;
  used: number;
  remaining: number | null;
  enforced: boolean;
  resetAt: string;
  retryAfterSeconds: number;
}

// ─── Route Constants ────────────────────────────────────────────────────────

export const API_ROUTES = {
  METRICS: '/api/v1/metrics',
  PIPELINE_RUN: '/api/v1/pipeline/run',
  PIPELINE_RUN_ASYNC: '/api/v1/pipeline/run-async',
  PIPELINE_STATUS: '/api/v1/pipeline/status/:jobId',
  VERIFY: '/api/v1/verify',
  FILING_EXPORT: '/api/v1/filing/export',
  ACCOUNT_USAGE: '/api/v1/account/usage',
  ACCOUNT_SUMMARY: '/api/v1/account',
  ACCOUNT_FEATURES: '/api/v1/account/features',
  ACCOUNT_EMAIL_DELIVERIES: '/api/v1/account/email/deliveries',
  ACCOUNT_OIDC: '/api/v1/account/oidc',
  ACCOUNT_SAML: '/api/v1/account/saml',
  ACCOUNT_PASSKEYS: '/api/v1/account/passkeys',
  ACCOUNT_PASSKEYS_REGISTER_OPTIONS: '/api/v1/account/passkeys/register/options',
  ACCOUNT_PASSKEYS_REGISTER_VERIFY: '/api/v1/account/passkeys/register/verify',
  ACCOUNT_PASSKEYS_DELETE: '/api/v1/account/passkeys/:id/delete',
  ACCOUNT_BILLING_CHECKOUT: '/api/v1/account/billing/checkout',
  ACCOUNT_BILLING_PORTAL: '/api/v1/account/billing/portal',
  ACCOUNT_BILLING_EXPORT: '/api/v1/account/billing/export',
  ACCOUNT_BILLING_RECONCILIATION: '/api/v1/account/billing/reconciliation',
  ADMIN_ACCOUNTS: '/api/v1/admin/accounts',
  ADMIN_EMAIL_DELIVERIES: '/api/v1/admin/email/deliveries',
  ADMIN_ACCOUNT_FEATURES: '/api/v1/admin/accounts/:id/features',
  ADMIN_ACCOUNT_BILLING_EXPORT: '/api/v1/admin/accounts/:id/billing/export',
  ADMIN_ACCOUNT_BILLING_RECONCILIATION: '/api/v1/admin/accounts/:id/billing/reconciliation',
  ADMIN_ACCOUNT_SUSPEND: '/api/v1/admin/accounts/:id/suspend',
  ADMIN_ACCOUNT_REACTIVATE: '/api/v1/admin/accounts/:id/reactivate',
  ADMIN_ACCOUNT_ARCHIVE: '/api/v1/admin/accounts/:id/archive',
  ADMIN_ACCOUNT_ATTACH_STRIPE: '/api/v1/admin/accounts/:id/billing/stripe',
  ADMIN_PLANS: '/api/v1/admin/plans',
  ADMIN_AUDIT: '/api/v1/admin/audit',
  ADMIN_BILLING_EVENTS: '/api/v1/admin/billing/events',
  ADMIN_METRICS: '/api/v1/admin/metrics',
  ADMIN_QUEUE: '/api/v1/admin/queue',
  ADMIN_QUEUE_DLQ: '/api/v1/admin/queue/dlq',
  ADMIN_QUEUE_RETRY: '/api/v1/admin/queue/jobs/:id/retry',
  ADMIN_TENANT_KEYS: '/api/v1/admin/tenant-keys',
  ADMIN_TENANT_KEY_ROTATE: '/api/v1/admin/tenant-keys/:id/rotate',
  ADMIN_TENANT_KEY_DEACTIVATE: '/api/v1/admin/tenant-keys/:id/deactivate',
  ADMIN_TENANT_KEY_REACTIVATE: '/api/v1/admin/tenant-keys/:id/reactivate',
  ADMIN_TENANT_KEY_RECOVER: '/api/v1/admin/tenant-keys/:id/recover',
  ADMIN_TENANT_KEY_REVOKE: '/api/v1/admin/tenant-keys/:id/revoke',
  ADMIN_USAGE: '/api/v1/admin/usage',
  AUTH_PASSKEY_OPTIONS: '/api/v1/auth/passkeys/options',
  AUTH_PASSKEY_VERIFY: '/api/v1/auth/passkeys/verify',
  AUTH_OIDC_LOGIN: '/api/v1/auth/oidc/login',
  AUTH_OIDC_CALLBACK: '/api/v1/auth/oidc/callback',
  AUTH_SAML_METADATA: '/api/v1/auth/saml/metadata',
  AUTH_SAML_LOGIN: '/api/v1/auth/saml/login',
  AUTH_SAML_ACS: '/api/v1/auth/saml/acs',
  BILLING_STRIPE_WEBHOOK: '/api/v1/billing/stripe/webhook',
  EMAIL_SENDGRID_WEBHOOK: '/api/v1/email/sendgrid/webhook',
  HEALTH: '/api/v1/health',
  DOMAINS: '/api/v1/domains',
  CONNECTORS: '/api/v1/connectors',
} as const;
