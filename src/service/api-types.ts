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
  schemaFingerprint: string | null;
  sentinelFingerprint: string | null;
  tableNames: string[] | null;
  attestationHash: string | null;
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

export interface AccountUserMfaSummaryView {
  enabled: boolean;
  method: 'totp' | null;
  enrolledAt: string | null;
  pendingEnrollment: boolean;
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
  purpose: 'invite' | 'password_reset';
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
  inviteToken: string;
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
  resetToken: string;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthLoginResponse {
  session: {
    id: string;
    expiresAt: string;
    source: 'account_session';
  };
  user: AccountUserRecordView;
  account: AdminAccountRecord;
}

export interface AuthLoginMfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
  challenge: {
    id: string;
    method: 'totp';
    expiresAt: string;
    maxAttempts: number | null;
    remainingAttempts: number | null;
  };
  user: AccountUserRecordView;
  account: AdminAccountRecord;
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
  currency: string | null;
  status: 'succeeded' | 'pending' | 'failed' | null;
  paid: boolean | null;
  refunded: boolean | null;
  createdAt: string | null;
  source: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary';
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
  summary: {
    dataSource: 'stripe_live' | 'ledger_derived' | 'summary_only' | 'mock_summary' | 'empty';
    mock: boolean;
    sharedBillingLedger: boolean;
    requestedLimit: number;
    invoiceCount: number;
    chargeCount: number;
  };
}

export interface AdminTenantKeyRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
  apiKeyPreview: string;
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
  PIPELINE_RUN: '/api/v1/pipeline/run',
  PIPELINE_RUN_ASYNC: '/api/v1/pipeline/run-async',
  PIPELINE_STATUS: '/api/v1/pipeline/status/:jobId',
  VERIFY: '/api/v1/verify',
  FILING_EXPORT: '/api/v1/filing/export',
  ACCOUNT_USAGE: '/api/v1/account/usage',
  ACCOUNT_SUMMARY: '/api/v1/account',
  ACCOUNT_BILLING_CHECKOUT: '/api/v1/account/billing/checkout',
  ACCOUNT_BILLING_PORTAL: '/api/v1/account/billing/portal',
  ACCOUNT_BILLING_EXPORT: '/api/v1/account/billing/export',
  ADMIN_ACCOUNTS: '/api/v1/admin/accounts',
  ADMIN_ACCOUNT_BILLING_EXPORT: '/api/v1/admin/accounts/:id/billing/export',
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
  ADMIN_TENANT_KEY_REVOKE: '/api/v1/admin/tenant-keys/:id/revoke',
  ADMIN_USAGE: '/api/v1/admin/usage',
  BILLING_STRIPE_WEBHOOK: '/api/v1/billing/stripe/webhook',
  HEALTH: '/api/v1/health',
  DOMAINS: '/api/v1/domains',
  CONNECTORS: '/api/v1/connectors',
} as const;
