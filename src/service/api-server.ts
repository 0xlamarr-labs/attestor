/**
 * Attestor HTTP API Server — Real Hono-based service layer.
 *
 * Endpoints:
 * - POST /api/v1/pipeline/run       — synchronous governed pipeline execution
 * - POST /api/v1/pipeline/run-async  — async job submission (returns jobId)
 * - GET  /api/v1/pipeline/status/:id — async job status/result
 * - POST /api/v1/verify              — certificate + PKI chain verification
 * - POST /api/v1/filing/export       — XBRL taxonomy mapping export
 * - GET  /api/v1/health              — service health + PKI + registries
 * - GET  /api/v1/domains             — registered domain packs
 * - GET  /api/v1/connectors          — registered database connectors
 * - GET  /api/v1/account             — current hosted account summary for tenant-authenticated callers
 * - GET  /api/v1/account/entitlement — current hosted billing entitlement truth
 * - GET  /api/v1/account/features    — current hosted feature entitlement truth
 * - GET  /api/v1/account/email/deliveries — hosted invite/reset delivery analytics
 * - GET  /api/v1/account/usage       — current hosted usage/rate-limit summary
 * - POST /api/v1/account/billing/checkout — create Stripe Checkout subscription session
 * - POST /api/v1/account/billing/portal — create Stripe Billing Portal session
 * - GET  /api/v1/account/billing/export — export hosted billing summary/history as JSON or CSV
 * - GET  /api/v1/account/billing/reconciliation — per-account charge/invoice reconciliation view
 * - GET/POST /api/v1/admin/accounts  — hosted operator account provisioning
 * - GET  /api/v1/admin/accounts/:id/features — operator hosted feature entitlement truth
 * - GET  /api/v1/admin/accounts/:id/billing/export — operator billing export for a hosted account
 * - GET  /api/v1/admin/accounts/:id/billing/reconciliation — operator billing reconciliation for a hosted account
 * - POST /api/v1/admin/accounts/:id/billing/stripe — attach Stripe billing ids/status
 * - POST /api/v1/admin/accounts/:id/suspend|reactivate|archive — hosted account lifecycle
 * - GET  /api/v1/admin/plans         — hosted plan catalog + defaults
 * - GET  /api/v1/admin/billing/entitlements — hosted billing entitlement read model
 * - GET  /api/v1/admin/email/deliveries — hosted operator email delivery analytics
 * - GET  /api/v1/admin/audit         — tamper-evident hosted admin ledger
 * - GET  /api/v1/admin/telemetry     — OTLP exporter status / config summary
 * - GET  /api/v1/metrics             — Prometheus scrape endpoint with dedicated metrics token or admin fallback
 * - GET  /api/v1/admin/queue         — async queue summary + retry policy
 * - GET  /api/v1/admin/queue/dlq     — failed-job / dead-letter inspection
 * - POST /api/v1/admin/queue/jobs/:id/retry — manual retry of failed async jobs
 * - GET/POST /api/v1/admin/tenant-keys — hosted operator tenant key management
 * - POST /api/v1/admin/tenant-keys/:id/rotate — key rollover with overlap window
 * - POST /api/v1/admin/tenant-keys/:id/deactivate — safe cutover pause for old keys
 * - POST /api/v1/admin/tenant-keys/:id/reactivate — rollback support during cutover
 * - GET  /api/v1/admin/usage         — hosted operator usage reporting
 * - POST /api/v1/billing/stripe/webhook — Stripe billing state reconciliation
 * - POST /api/v1/email/sendgrid/webhook — signed SendGrid delivery analytics ingest
 *
 * This is a real server. It binds to a port and accepts real HTTP requests.
 * Integration tests hit it over the network.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { runFinancialPipeline } from '../financial/pipeline.js';
import { generateKeyPair } from '../signing/keys.js';
import { verifyCertificate } from '../signing/certificate.js';
import { buildVerificationKit } from '../signing/bundle.js';
import { verifyOidcToken, classifyIdentitySource } from '../identity/oidc-identity.js';
import type { FinancialPipelineInput } from '../financial/pipeline.js';

import { buildCounterpartyEnvelope } from '../filing/xbrl-adapter.js';
import { verifyTrustChain } from '../signing/pki-chain.js';
import { derivePublicKeyIdentity } from '../signing/keys.js';
import { review, verification } from '../release-layer/index.js';
import { action as financeActionRelease, communication as financeCommunicationRelease, record as financeRecordRelease } from '../release-layer/finance.js';
import {
  canEnqueueTenantAsyncJob,
  getAsyncQueueSummary,
  getAsyncRetryPolicy,
  getJobStatus,
  listFailedPipelineJobs,
  retryFailedPipelineJob,
  submitPipelineJob,
} from './async-pipeline.js';
import { tenantMiddleware } from './tenant-isolation.js';
import {
  accountPasskeyCredentialView,
  accountUserActionTokenView,
  accountUserDetailedMfaView,
  accountUserDetailedOidcView,
  accountUserDetailedPasskeyView,
  accountUserDetailedSamlView,
  accountUserView,
  asAuthenticationResponse,
  asRegistrationResponse,
  deriveSignupTenantId,
  normalizePasskeyAuthenticatorHint,
  parsePasskeyAuthenticationChallenge,
  parsePasskeyRegistrationChallenge,
} from './account-route-support.js';
import {
  accountApiKeyView,
  adminAccountView,
  adminAuditView,
  adminPlanView,
  adminTenantKeyView,
  billingEntitlementView,
  billingEventView,
} from './hosted-surface-support.js';
import {
  accountMfaErrorResponse,
  createHostedAccountSupport,
  stripeBillingErrorResponse,
} from './hosted-account-support.js';
import { createRequestObservabilityMiddleware } from './request-observability-middleware.js';
import {
  applyRateLimitHeaders,
  schemaAttestationSummaryFromConnector,
  schemaAttestationSummaryFromFull,
} from './pipeline-route-support.js';
import {
  createRequestSigners,
  currentAccountAccess,
  currentAccountRole,
  currentAdminAuthorized,
  currentMetricsAuthorized,
  currentReleaseEvaluationContext,
  currentReleaseRequester,
  currentTenant,
  requireAccountSession,
  setSessionCookieForRecord,
} from './request-context.js';
import {
  metadataStringValue,
  parseStripeChargeStatus,
  parseStripeInvoiceStatus,
  stripeClient,
  stripeInvoicePriceId,
  stripeReferenceId,
  unixSecondsToIso,
} from './stripe-webhook-support.js';

const {
  buildFinanceCommunicationReleaseMaterial,
  buildFinanceCommunicationReleaseObservation,
  createFinanceCommunicationReleaseCandidateFromReport,
} = financeCommunicationRelease;
const {
  buildFinanceActionReleaseMaterial,
  buildFinanceActionReleaseObservation,
  createFinanceActionReleaseCandidateFromReport,
} = financeActionRelease;
const {
  buildFinanceFilingReleaseMaterial,
  createFinanceFilingReleaseCandidateFromReport,
  FINANCE_FILING_ADAPTER_ID,
  finalizeFinanceFilingReleaseDecision,
  buildFinanceFilingReleaseObservation,
} = financeRecordRelease;
const { createFinanceReviewerQueueItem } = review;
const { ReleaseVerificationError, resolveReleaseTokenFromRequest, verifyReleaseAuthorization } =
  verification;
import {
  getTenantPipelineRateLimit,
  reserveTenantPipelineRequest,
} from './rate-limit.js';
import {
  getTenantAsyncExecutionCoordinatorStatus,
} from './async-tenant-execution.js';
import {
  getTenantAsyncWeightedDispatchCoordinatorStatus,
} from './async-weighted-dispatch.js';
import {
  evaluateApiHighAvailabilityState,
  resolveServiceInstanceId,
} from './high-availability.js';
import { tenantKeyStorePolicy } from './tenant-key-store.js';
import {
  type AccountUserRole,
  verifyAccountUserPasswordRecord,
} from './account-user-store.js';
import {
  buildTotpOtpAuthUrl,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecretBase32,
  totpSummary,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from './account-mfa.js';
import {
  buildHostedOidcAuthorizationRequest,
  completeHostedOidcAuthorization,
  hostedOidcAllowsAutomaticLinking,
  linkAccountUserOidcIdentity,
} from './account-oidc.js';
import {
  buildHostedSamlAuthorizationRequest,
  completeHostedSamlAuthorization,
  getHostedSamlMetadata,
  hostedSamlAllowsAutomaticLinking,
  linkAccountUserSamlIdentity,
} from './account-saml.js';
import {
  buildAccountUserPasskeyCredentialRecord,
  buildHostedPasskeyAuthenticationOptions,
  buildHostedPasskeyRegistrationOptions,
  generateHostedPasskeyUserHandle,
  passkeyCredentialToWebAuthnCredential,
  verifyHostedPasskeyAuthentication,
  verifyHostedPasskeyRegistration,
} from './account-passkeys.js';
import { type AsyncDeadLetterRecord } from './async-dead-letter-store.js';
import { sessionCookieName } from './account-session-store.js';
import {
  findHostedBillingEntitlementByAccountIdState,
  applyStripeCheckoutCompletionState,
  applyStripeInvoiceStateState,
  applyStripeSubscriptionStateState,
  attachStripeBillingToAccountState,
  claimProcessedStripeWebhookState,
  canConsumePipelineRunState,
  countAccountUsersForAccountState,
  consumeAccountUserActionTokenState,
  createAccountUserState,
  saveAccountUserRecordState,
  findAccountUserByOidcIdentityState,
  findAccountUserBySamlIdentityState,
  finalizeProcessedStripeWebhookState,
  consumePipelineRunState,
  findAccountUserByEmailState,
  findAccountUserByIdState,
  findAccountUserByPasskeyCredentialIdState,
  findAccountUserActionTokenByTokenState,
  findHostedAccountByIdState,
  findHostedAccountByTenantIdState,
  findTenantRecordByTenantIdState,
  getUsageContextState,
  issueAccountInviteTokenState,
  issueAccountPasskeyChallengeTokenState,
  issueAccountMfaLoginTokenState,
  issueAccountSessionState,
  isSharedControlPlaneConfigured,
  issueTenantApiKeyState,
  issuePasswordResetTokenState,
  listAsyncDeadLetterRecordsState,
  listAccountUsersByAccountIdState,
  listAccountUserActionTokensByAccountIdState,
  listHostedEmailDeliveriesState,
  listHostedAccountsState,
  listTenantKeyRecordsState,
  provisionHostedAccountState,
  queryUsageLedgerState,
  recordHostedSamlReplayState,
  recoverTenantApiKeyState,
  recordAccountUserLoginState,
  revokeAccountUserActionTokenState,
  revokeAccountUserActionTokensForUserState,
  revokeAccountSessionByTokenState,
  revokeAccountSessionsForAccountState,
  revokeAccountSessionsForUserState,
  revokeTenantApiKeyState,
  rotateTenantApiKeyState,
  appendAdminAuditRecordState,
  listAdminAuditRecordsState,
  lookupAdminIdempotencyState,
  recordAdminIdempotencyState,
  recordHostedEmailProviderEventState,
  lookupProcessedStripeWebhookState,
  releaseProcessedStripeWebhookClaimState,
  recordProcessedStripeWebhookState,
  setAccountUserPasswordState,
  setAccountUserStatusState,
  saveAccountUserActionTokenRecordState,
  setHostedAccountStatusState,
  setTenantApiKeyStatusState,
  syncTenantPlanByTenantIdState,
  upsertAsyncDeadLetterRecordState,
  upsertHostedBillingEntitlementState,
  listHostedBillingEntitlementsState,
} from './control-plane-store.js';
import { type HostedBillingEntitlementStatus } from './billing-entitlement-store.js';
import { buildHostedFeatureServiceView } from './billing-feature-service.js';
import {
  DEFAULT_HOSTED_PLAN_ID,
  SELF_HOST_PLAN_ID,
  defaultRateLimitWindowSeconds,
  findHostedPlanByStripePriceId,
  getHostedPlan,
  resolvePlanSpec,
  resolvePlanStripePrice,
  resolvePlanStripeTrialDays,
} from './plan-catalog.js';
import { hashJsonValue } from './json-stable.js';
import {
  claimStripeBillingEvent,
  finalizeStripeBillingEvent,
  isBillingEventLedgerConfigured,
  listBillingEvents,
  releaseStripeBillingEventClaim,
  upsertStripeCharges,
  upsertStripeInvoiceLineItems,
} from './billing-event-ledger.js';
import {
  getTelemetryStatus,
  observeBillingWebhookEvent,
  renderPrometheusMetrics,
} from './observability.js';
import {
  deliverHostedInviteEmail,
  deliverHostedPasswordResetEmail,
  getHostedEmailDeliveryStatus,
} from './email-delivery.js';
import {
  getMailgunWebhookStatus,
  mailgunEventTypeToStatusHint,
  parseMailgunWebhookEvent,
  verifySignedMailgunWebhook,
} from './mailgun-email-webhook.js';
import {
  getSendGridWebhookStatus,
  parseSendGridWebhookEvents,
  sendGridEventTypeToStatusHint,
  verifySignedSendGridWebhook,
} from './sendgrid-email-webhook.js';
import { getSecretEnvelopeStatus } from './secret-envelope.js';
import {
  createHostedBillingPortalSession,
  createHostedCheckoutSession,
  extractActiveEntitlementsFromSummary,
  extractInvoiceLineItemSnapshotsFromInvoice,
  listHostedStripeActiveEntitlements,
  listHostedStripeInvoiceLineItems,
} from './stripe-billing.js';
import { isSupportedStripeWebhookEvent } from './stripe-webhook-events.js';
import {
  buildHostedBillingExport,
  renderHostedBillingExportCsv,
} from './billing-export.js';
import { buildHostedBillingReconciliation } from './billing-reconciliation.js';
import {
  financialReportingEvidenceRoot,
  loadCommittedFinancialReportingPacket,
  renderFinancialReportingLandingPage,
  renderFinancialReportingProofPage,
  renderHostedReturnPage,
} from './site.js';
import {
  renderReleaseReviewerQueueDetailPage,
  renderReleaseReviewerQueueInboxPage,
} from './release-review-site.js';
import { createRegistries } from './bootstrap/registries.js';
import { createReleaseRuntimeBootstrap } from './bootstrap/release-runtime.js';
import {
  buildAccountRouteDeps,
  buildAdminRouteDeps,
  buildPipelineRouteDeps,
  buildReleasePolicyControlRouteDeps,
  buildReleaseReviewRouteDeps,
  buildWebhookRouteDeps,
} from './bootstrap/http-route-builders.js';
import { registerAllRoutes } from './bootstrap/routes.js';
import {
  createHttpRouteRuntime,
  createRuntimeInfra,
  type AppRouteDeps,
} from './bootstrap/runtime.js';
import {
  installGracefulShutdown,
  startHttpServer,
  type HttpServerHandle,
} from './bootstrap/server.js';
import {
  asyncBackendMode,
  bullmqQueue,
  currentAsyncSubmissionReservations,
  inProcessJobs,
  inProcessTenantQueueSnapshot,
  redisMode,
  releaseAsyncSubmission,
  reserveAsyncSubmission,
} from './runtime/tenant-runtime.js';
import { rlsActivationResult } from './runtime/rls-runtime.js';

const registries = createRegistries();
const { domainRegistry, connectorRegistry, filingRegistry } = registries;

const app = new Hono();
const startTime = Date.now();
const serviceInstanceId = resolveServiceInstanceId();

function committedEvidenceContentType(path: string): string {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case '.json':
      return 'application/json; charset=utf-8';
    case '.pem':
    case '.md':
      return 'text/plain; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function readCommittedEvidence(relativePath: string): { path: string; content: string } | null {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/u, '');
  const safeSegments = normalized
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..');
  const baseDir = financialReportingEvidenceRoot();
  const resolvedPath = resolve(baseDir, ...safeSegments);
  if (!resolvedPath.startsWith(baseDir) || !existsSync(resolvedPath)) return null;
  return {
    path: resolvedPath,
    content: readFileSync(resolvedPath, 'utf8'),
  };
}

const committedFinancialPacket = loadCommittedFinancialReportingPacket();
type ApiRouteDeps = AppRouteDeps<typeof committedFinancialPacket>;


app.use('/api/*', createRequestObservabilityMiddleware({
  serviceInstanceId,
  findHostedAccountByTenantId: findHostedAccountByTenantIdState,
}));

// Apply tenant isolation middleware to all API routes
app.use('/api/*', tenantMiddleware());

const {
  pki,
  pkiReady,
  financeReleaseDecisionLog,
  apiReleaseReviewerQueueStore,
  apiReleaseIntrospectionStore,
  apiReleaseIntrospector,
  apiReleaseTokenIssuer,
  apiReleaseEvidencePackStore,
  apiReleaseEvidencePackIssuer,
  apiReleaseVerificationKeyPromise,
  apiReleaseDegradedModeGrantStore,
  policyControlPlaneStore,
  policyActivationApprovalStore,
  policyMutationAuditLog,
  financeReleaseDecisionEngine,
  financeCommunicationReleaseShadowEvaluator,
  financeActionReleaseShadowEvaluator,
} = createReleaseRuntimeBootstrap();
const {
  currentHostedAccount,
  readHostedBillingEntitlement,
  syncHostedBillingEntitlement,
  syncHostedBillingEntitlementForTenant,
  findHostedAccountByStripeRefs,
  revokeAccountSessionsForLifecycleChange,
} = createHostedAccountSupport({
  DEFAULT_HOSTED_PLAN_ID,
  findHostedAccountByTenantId: findHostedAccountByTenantIdState,
  findHostedAccountById: findHostedAccountByIdState,
  listHostedAccounts: listHostedAccountsState,
  findTenantRecordByTenantId: findTenantRecordByTenantIdState,
  getUsageContext: getUsageContextState,
  getTenantPipelineRateLimit,
  findHostedBillingEntitlementByAccountId: findHostedBillingEntitlementByAccountIdState,
  upsertHostedBillingEntitlement: upsertHostedBillingEntitlementState,
  revokeAccountSessionsForAccount: revokeAccountSessionsForAccountState,
});

const publicSiteRouteDeps = {
  committedFinancialPacket,
  renderFinancialReportingLandingPage,
  renderFinancialReportingProofPage,
  renderHostedReturnPage,
  readCommittedEvidence,
  committedEvidenceContentType,
} satisfies ApiRouteDeps['publicSite'];

const coreRouteDeps = {
  evaluateApiHighAvailabilityState,
  redisMode,
  asyncBackendMode,
  isSharedControlPlaneConfigured,
  serviceInstanceId,
  startTime,
  domainRegistry,
  connectorRegistry,
  filingRegistry,
  pkiReady,
  pki,
  rlsActivationResult,
} satisfies ApiRouteDeps['core'];

const accountRouteDeps = buildAccountRouteDeps({
  countAccountUsersForAccountState,
  createAccountUserState,
  findAccountUserByEmailState,
  deriveSignupTenantId,
  resolvePlanSpec,
  SELF_HOST_PLAN_ID,
  DEFAULT_HOSTED_PLAN_ID,
  resolvePlanStripeTrialDays,
  provisionHostedAccountState,
  issueAccountSessionState,
  recordAccountUserLoginState,
  syncHostedBillingEntitlementForTenant,
  verifyAccountUserPasswordRecord,
  findHostedAccountByIdState,
  totpSummary,
  issueAccountMfaLoginTokenState,
  findTenantRecordByTenantIdState,
  listTenantKeyRecordsState,
  tenantKeyStorePolicy,
  issueTenantApiKeyState,
  rotateTenantApiKeyState,
  setTenantApiKeyStatusState,
  revokeTenantApiKeyState,
  now: () => new Date().toISOString(),
  listAccountUsersByAccountIdState,
  listAccountUserActionTokensByAccountIdState,
  findAccountUserActionTokenByTokenState,
  issueAccountInviteTokenState,
  revokeAccountUserActionTokenState,
  consumeAccountUserActionTokenState,
  findAccountUserByIdState,
  setAccountUserStatusState,
  revokeAccountSessionsForUserState,
  revokeAccountUserActionTokensForUserState,
  issuePasswordResetTokenState,
  setAccountUserPasswordState,
  deliverHostedInviteEmail,
  deliverHostedPasswordResetEmail,
  findAccountUserByEmail: findAccountUserByEmailState,
  issueAccountSession: issueAccountSessionState,
  recordAccountUserLogin: recordAccountUserLoginState,
  findHostedAccountById: findHostedAccountByIdState,
  issueAccountMfaLoginToken: issueAccountMfaLoginTokenState,
  issueAccountPasskeyChallengeToken: issueAccountPasskeyChallengeTokenState,
  findAccountUserActionTokenByToken: findAccountUserActionTokenByTokenState,
  findAccountUserById: findAccountUserByIdState,
  findAccountUserByPasskeyCredentialId: findAccountUserByPasskeyCredentialIdState,
  saveAccountUserRecord: saveAccountUserRecordState,
  consumeAccountUserActionToken: consumeAccountUserActionTokenState,
  revokeAccountUserActionTokensForUser: revokeAccountUserActionTokensForUserState,
  recordHostedSamlReplay: recordHostedSamlReplayState,
  findAccountUserBySamlIdentity: findAccountUserBySamlIdentityState,
  findAccountUserByOidcIdentity: findAccountUserByOidcIdentityState,
  getUsageContext: getUsageContextState,
  setAccountUserPassword: setAccountUserPasswordState,
  revokeAccountSessionsForUser: revokeAccountSessionsForUserState,
  saveAccountUserActionTokenRecord: saveAccountUserActionTokenRecordState,
  revokeAccountSessionByToken: revokeAccountSessionByTokenState,
  listHostedEmailDeliveries: listHostedEmailDeliveriesState,
  currentHostedAccount,
  setSessionCookieForRecord,
  accountUserView,
  adminAccountView,
  accountApiKeyView,
  buildHostedPasskeyAuthenticationOptions,
  asAuthenticationResponse,
  parsePasskeyAuthenticationChallenge,
  verifyHostedPasskeyAuthentication,
  passkeyCredentialToWebAuthnCredential,
  getHostedSamlMetadata,
  buildHostedSamlAuthorizationRequest,
  completeHostedSamlAuthorization,
  hostedSamlAllowsAutomaticLinking,
  linkAccountUserSamlIdentity,
  buildHostedOidcAuthorizationRequest,
  completeHostedOidcAuthorization,
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
  getTenantPipelineRateLimit,
  readHostedBillingEntitlement,
  buildHostedFeatureServiceView,
  accountUserActionTokenView,
  getCookie,
  deleteCookie,
  sessionCookieName,
  accountMfaErrorResponse,
  getHostedPlan,
  createHostedCheckoutSession,
  stripeBillingErrorResponse,
  createHostedBillingPortalSession,
  buildHostedBillingExport,
  renderHostedBillingExportCsv,
  buildHostedBillingReconciliation,
  billingEntitlementView,
  currentTenant,
});

const {
  adminRouteDeps,
  adminMutationRequest,
  finalizeAdminMutation,
} = buildAdminRouteDeps({
  hashJsonValue,
  lookupAdminIdempotencyState,
  recordAdminIdempotencyState,
  appendAdminAuditRecordState,
  resolvePlanSpec,
  DEFAULT_HOSTED_PLAN_ID,
  provisionHostedAccountState,
  attachStripeBillingToAccountState,
  setHostedAccountStatusState,
  revokeAccountSessionsForAccountState,
  readHostedBillingEntitlement,
  tenantKeyStorePolicy,
  issueTenantApiKeyState,
  rotateTenantApiKeyState,
  setTenantApiKeyStatusState,
  recoverTenantApiKeyState,
  revokeTenantApiKeyState,
  syncHostedBillingEntitlement,
  syncHostedBillingEntitlementForTenant,
  now: () => new Date().toISOString(),
  listTenantKeyRecordsState,
  listHostedAccountsState,
  findHostedAccountByIdState,
  listAdminAuditRecordsState,
  listHostedBillingEntitlementsState,
  listHostedEmailDeliveriesState,
  listAsyncDeadLetterRecordsState,
  queryUsageLedgerState,
  findTenantRecordByTenantIdState,
  findHostedAccountByTenantIdState,
  currentAdminAuthorized,
  adminTenantKeyView,
  adminAccountView,
  buildHostedBillingExport,
  buildHostedBillingReconciliation,
  renderHostedBillingExportCsv,
  billingEntitlementView,
  buildHostedFeatureServiceView,
  getTenantAsyncExecutionCoordinatorStatus,
  getTenantAsyncWeightedDispatchCoordinatorStatus,
  adminPlanView,
  defaultRateLimitWindowSeconds,
  adminAuditView,
  isBillingEventLedgerConfigured,
  listBillingEvents,
  billingEventView,
  renderPrometheusMetrics,
  currentMetricsAuthorized,
  getTelemetryStatus,
  getHostedEmailDeliveryStatus,
  getSecretEnvelopeStatus,
  asyncBackendMode,
  bullmqQueue,
  getAsyncQueueSummary,
  getAsyncRetryPolicy,
  inProcessJobs,
  inProcessTenantQueueSnapshot,
  listFailedPipelineJobs,
  retryFailedPipelineJob,
  apiReleaseIntrospectionStore,
  releaseDegradedModeGrantStore: apiReleaseDegradedModeGrantStore,
});

const releaseReviewRouteDeps = buildReleaseReviewRouteDeps({
  renderReleaseReviewerQueueInboxPage,
  renderReleaseReviewerQueueDetailPage,
  currentAdminAuthorized,
  apiReleaseReviewerQueueStore,
  financeReleaseDecisionLog,
  apiReleaseTokenIssuer,
  apiReleaseEvidencePackStore,
  apiReleaseEvidencePackIssuer,
  apiReleaseIntrospectionStore,
  adminMutationRequest,
  finalizeAdminMutation,
});

const releasePolicyControlRouteDeps = buildReleasePolicyControlRouteDeps({
  currentAdminAuthorized,
  policyControlPlaneStore,
  policyActivationApprovalStore,
  policyMutationAuditLog,
  adminMutationRequest,
  finalizeAdminMutation,
});

const pipelineRouteDeps = buildPipelineRouteDeps({
  checkQuota: canConsumePipelineRunState,
  consumeRun: consumePipelineRunState,
  upsertDeadLetterRecord: upsertAsyncDeadLetterRecordState,
  currentTenant,
  reserveTenantPipelineRequest,
  applyRateLimitHeaders,
  connectorRegistry,
  verifyOidcToken,
  classifyIdentitySource,
  createRequestSigners,
  runFinancialPipeline,
  buildVerificationKit,
  createFinanceCommunicationReleaseCandidateFromReport,
  buildFinanceCommunicationReleaseMaterial,
  buildFinanceCommunicationReleaseObservation,
  financeCommunicationReleaseShadowEvaluator,
  createFinanceActionReleaseCandidateFromReport,
  buildFinanceActionReleaseMaterial,
  buildFinanceActionReleaseObservation,
  financeActionReleaseShadowEvaluator,
  createFinanceFilingReleaseCandidateFromReport,
  FINANCE_FILING_ADAPTER_ID,
  buildFinanceFilingReleaseMaterial,
  financeReleaseDecisionEngine,
  financeReleaseDecisionLog,
  buildFinanceFilingReleaseObservation,
  currentReleaseRequester,
  currentReleaseEvaluationContext,
  finalizeFinanceFilingReleaseDecision,
  createFinanceReviewerQueueItem,
  apiReleaseReviewerQueueStore,
  apiReleaseTokenIssuer,
  apiReleaseEvidencePackStore,
  apiReleaseEvidencePackIssuer,
  apiReleaseIntrospectionStore,
  schemaAttestationSummaryFromFull,
  schemaAttestationSummaryFromConnector,
  filingRegistry,
  buildCounterpartyEnvelope,
  verifyCertificate,
  verifyTrustChain,
  derivePublicKeyIdentity,
  apiReleaseVerificationKeyPromise,
  resolveReleaseTokenFromRequest,
  verifyReleaseAuthorization,
  apiReleaseIntrospector,
  ReleaseVerificationError,
  asyncBackendMode,
  bullmqQueue,
  canEnqueueTenantAsyncJob,
  currentAsyncSubmissionReservations,
  reserveAsyncSubmission,
  releaseAsyncSubmission,
  getAsyncRetryPolicy,
  getAsyncQueueSummary,
  submitPipelineJob,
  getTenantPipelineRateLimit,
  inProcessTenantQueueSnapshot,
  inProcessJobs,
  pki,
  getJobStatus,
});

const webhookRouteDeps = buildWebhookRouteDeps({
  stripeClient,
  observeBillingWebhookEvent,
  isBillingEventLedgerConfigured,
  isSharedControlPlaneConfigured,
  claimStripeBillingEvent,
  claimProcessedStripeWebhookState,
  lookupProcessedStripeWebhookState,
  finalizeProcessedStripeWebhookState,
  recordProcessedStripeWebhookState,
  releaseProcessedStripeWebhookClaimState,
  finalizeStripeBillingEvent,
  releaseStripeBillingEventClaim,
  isSupportedStripeWebhookEvent,
  stripeReferenceId,
  parseStripeInvoiceStatus,
  stripeInvoicePriceId,
  metadataStringValue,
  applyStripeSubscriptionStateState,
  applyStripeInvoiceStateState,
  applyStripeCheckoutCompletionState,
  findHostedAccountByStripeRefs,
  findHostedPlanByStripePriceId,
  resolvePlanSpec,
  DEFAULT_HOSTED_PLAN_ID,
  syncTenantPlanByTenantIdState,
  syncHostedBillingEntitlement,
  revokeAccountSessionsForLifecycleChange,
  appendAdminAuditRecordState,
  billingEntitlementView,
  extractInvoiceLineItemSnapshotsFromInvoice,
  listHostedStripeActiveEntitlements,
  extractActiveEntitlementsFromSummary,
  listHostedStripeInvoiceLineItems,
  upsertStripeInvoiceLineItems,
  parseStripeChargeStatus,
  getHostedPlan,
  upsertStripeCharges,
  unixSecondsToIso,
  resolvePlanStripePrice,
  getSendGridWebhookStatus,
  verifySignedSendGridWebhook,
  parseSendGridWebhookEvents,
  getMailgunWebhookStatus,
  parseMailgunWebhookEvent,
  verifySignedMailgunWebhook,
  async findEmailDeliveryById(deliveryId) {
    const existing = await listHostedEmailDeliveriesState({
      deliveryId,
      limit: 1,
    });
    return existing.records[0] ?? null;
  },
  recordEmailProviderEvent: recordHostedEmailProviderEventState,
  sendGridEventTypeToStatusHint,
  mailgunEventTypeToStatusHint,
  now: () => new Date().toISOString(),
});

const runtime = createHttpRouteRuntime({
  registries,
  infra: createRuntimeInfra({
    instanceId: serviceInstanceId,
    startedAtEpochMs: startTime,
    asyncExecution: {
      backendMode: asyncBackendMode,
      redisMode,
    },
    security: {
      rlsActivationResult,
      pkiReady,
    },
  }),
  httpRoutes: {
    publicSite: publicSiteRouteDeps,
    core: coreRouteDeps,
    account: accountRouteDeps,
    admin: adminRouteDeps,
    releaseReview: releaseReviewRouteDeps,
    releasePolicyControl: releasePolicyControlRouteDeps,
    pipeline: pipelineRouteDeps,
    webhook: webhookRouteDeps,
  },
});

registerAllRoutes(app, runtime);


// ─── Server Start/Stop ──────────────────────────────────────────────────────

export function startServer(port: number = 3700): HttpServerHandle {
  return startHttpServer(app, port);
}

export { app };

// Standalone mode: start server when run directly
if (process.argv[1]?.endsWith('api-server.ts') || process.argv[1]?.endsWith('api-server.js')) {
  const port = parseInt(process.env.PORT ?? '3700', 10);
  const handle = startServer(port);
  console.log(`[attestor] API server running on port ${port}`);

  installGracefulShutdown(handle);
}
