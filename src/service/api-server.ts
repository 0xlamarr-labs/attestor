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
import { Hono, type Context } from 'hono';
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
import {
  tenantMiddleware,
  type TenantContext,
} from './tenant-isolation.js';
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
  AccountStoreError,
  type HostedAccountRecord,
} from './account-store.js';
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
import {
  projectHostedBillingEntitlement,
  type HostedBillingEntitlementRecord,
  type HostedBillingEntitlementStatus,
} from './billing-entitlement-store.js';
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
  appendStructuredRequestLog,
  beginRequestTrace,
  completeRequestTrace,
  getTelemetryStatus,
  observeBillingWebhookEvent,
  observeRequestComplete,
  observeRequestStart,
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
  StripeBillingError,
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


app.use('/api/*', async (c, next) => {
  const requestUrl = new URL(c.req.url);
  const remoteAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || null;
  const trace = beginRequestTrace(c.req.header('traceparent'), {
    method: c.req.method,
    path: c.req.path,
    url: c.req.url,
    remoteAddress,
    userAgent: c.req.header('user-agent') ?? null,
    serverAddress: requestUrl.hostname || null,
    serverPort: requestUrl.port ? Number.parseInt(requestUrl.port, 10) : null,
  });
  const startedAt = process.hrtime.bigint();
  observeRequestStart();

  let statusCode = 500;
  let route = c.req.path;
  let rateLimited = false;
  let quotaRejected = false;
  let thrownError: unknown = null;

  try {
    await next();
    statusCode = c.res.status;
    route = c.req.routePath || c.req.path;
    rateLimited = c.res.headers.get('retry-after') !== null;
    quotaRejected = statusCode === 429 && route === '/api/v1/pipeline/run';
  } catch (err) {
    route = c.req.routePath || c.req.path;
    thrownError = err;
    throw err;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const tenant = currentTenant(c);
    const observedTenantId = c.get('obs.tenantId') as string | null | undefined;
    const observedPlanId = c.get('obs.planId') as string | null | undefined;
    const observedAccountId = c.get('obs.accountId') as string | null | undefined;
    const observedAccountStatus = c.get('obs.accountStatus') as string | null | undefined;
    let account: HostedAccountRecord | null = null;

    if (!observedAccountId && tenant.tenantId && tenant.tenantId !== 'default') {
      try {
        account = await findHostedAccountByTenantIdState(tenant.tenantId);
      } catch {
        // Observability should never take down request handling if the hosted control-plane
        // backend is temporarily unreachable.
      }
    }

    observeRequestComplete({
      route,
      method: c.req.method,
      statusCode,
      durationSeconds,
      traceContextStatus: trace.incomingStatus,
    });
    completeRequestTrace(trace, {
      route,
      method: c.req.method,
      path: c.req.path,
      statusCode,
      durationSeconds,
      tenantId: observedTenantId ?? tenant.tenantId ?? null,
      planId: observedPlanId ?? tenant.planId ?? null,
      accountId: observedAccountId ?? account?.id ?? null,
      accountStatus: observedAccountStatus ?? account?.status ?? null,
      rateLimited,
      quotaRejected,
      remoteAddress,
      userAgent: c.req.header('user-agent') ?? null,
      error: thrownError,
    });

    appendStructuredRequestLog({
      occurredAt: new Date().toISOString(),
      route,
      path: c.req.path,
      method: c.req.method,
      statusCode,
      durationMs: Math.round(durationSeconds * 1000),
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
      traceFlags: trace.traceFlags,
      tenantId: observedTenantId ?? tenant.tenantId ?? null,
      planId: observedPlanId ?? tenant.planId ?? null,
      accountId: observedAccountId ?? account?.id ?? null,
      accountStatus: observedAccountStatus ?? account?.status ?? null,
      rateLimited,
      quotaRejected,
      remoteAddress,
      userAgent: c.req.header('user-agent') ?? null,
    });

    c.header('traceparent', trace.responseTraceparent);
    c.header('x-attestor-trace-id', trace.traceId);
    c.header('x-attestor-span-id', trace.spanId);
    c.header('x-attestor-instance-id', serviceInstanceId);
  }
});

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

function accountStoreErrorResponse(c: Context, err: unknown): Response | null {
  if (!(err instanceof AccountStoreError)) return null;
  if (err.code === 'NOT_FOUND') {
    return c.json({ error: err.message }, 404);
  }
  return c.json({ error: err.message }, 409);
}

function accountMfaErrorResponse(c: Context, err: unknown): Response | null {
  if (!(err instanceof Error)) return null;
  if (err.message.includes('ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY') || err.message.includes('ATTESTOR_ADMIN_API_KEY')) {
    return c.json({ error: err.message }, 503);
  }
  return null;
}

function stripeBillingErrorResponse(c: Context, err: unknown): Response | null {
  if (!(err instanceof StripeBillingError)) return null;
  if (err.code === 'DISABLED') return c.json({ error: err.message }, 503);
  if (err.code === 'NO_CUSTOMER') return c.json({ error: err.message }, 409);
  return c.json({ error: err.message }, 400);
}

async function currentHostedAccount(c: Context): Promise<{
  tenant: TenantContext;
  account: HostedAccountRecord;
  usage: Awaited<ReturnType<typeof getUsageContextState>>;
  rateLimit: Awaited<ReturnType<typeof getTenantPipelineRateLimit>>;
} | Response> {
  const tenant = currentTenant(c);
  const account = await findHostedAccountByTenantIdState(tenant.tenantId);
  if (!account) {
    return c.json({
      error: `Hosted account not found for tenant '${tenant.tenantId}'.`,
      tenantContext: {
        tenantId: tenant.tenantId,
        source: tenant.source,
        planId: tenant.planId,
      },
    }, 404);
  }
  return {
    tenant,
    account,
    usage: await getUsageContextState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota),
    rateLimit: await getTenantPipelineRateLimit(tenant.tenantId, tenant.planId),
  };
}

async function projectBillingEntitlementForAccount(account: HostedAccountRecord, options?: {
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
}): Promise<HostedBillingEntitlementRecord> {
  const tenantRecord = await findTenantRecordByTenantIdState(account.primaryTenantId);
  return projectHostedBillingEntitlement(
    await findHostedBillingEntitlementByAccountIdState(account.id),
    {
      account,
      currentPlanId: tenantRecord?.planId ?? account.billing.lastCheckoutPlanId ?? DEFAULT_HOSTED_PLAN_ID,
      currentMonthlyRunQuota: tenantRecord?.monthlyRunQuota ?? null,
      stripeEntitlementLookupKeys: options?.stripeEntitlementLookupKeys ?? null,
      stripeEntitlementFeatureIds: options?.stripeEntitlementFeatureIds ?? null,
      stripeEntitlementSummaryUpdatedAt: options?.stripeEntitlementSummaryUpdatedAt ?? null,
      lastEventId: options?.lastEventId ?? null,
      lastEventType: options?.lastEventType ?? null,
      lastEventAt: options?.lastEventAt ?? null,
    },
  );
}

async function readHostedBillingEntitlement(account: HostedAccountRecord): Promise<HostedBillingEntitlementRecord> {
  const existing = await findHostedBillingEntitlementByAccountIdState(account.id);
  if (existing) return existing;
  return projectBillingEntitlementForAccount(account);
}

async function syncHostedBillingEntitlement(account: HostedAccountRecord, options?: {
  lastEventId?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  stripeEntitlementLookupKeys?: string[] | null;
  stripeEntitlementFeatureIds?: string[] | null;
  stripeEntitlementSummaryUpdatedAt?: string | null;
}): Promise<HostedBillingEntitlementRecord> {
  const tenantRecord = await findTenantRecordByTenantIdState(account.primaryTenantId);
  const synced = await upsertHostedBillingEntitlementState({
    account,
    currentPlanId: tenantRecord?.planId ?? account.billing.lastCheckoutPlanId ?? DEFAULT_HOSTED_PLAN_ID,
    currentMonthlyRunQuota: tenantRecord?.monthlyRunQuota ?? null,
    stripeEntitlementLookupKeys: options?.stripeEntitlementLookupKeys ?? null,
    stripeEntitlementFeatureIds: options?.stripeEntitlementFeatureIds ?? null,
    stripeEntitlementSummaryUpdatedAt: options?.stripeEntitlementSummaryUpdatedAt ?? null,
    lastEventId: options?.lastEventId ?? null,
    lastEventType: options?.lastEventType ?? null,
    lastEventAt: options?.lastEventAt ?? null,
  });
  return synced.record;
}

async function syncHostedBillingEntitlementForTenant(
  tenantId: string,
  options?: {
    lastEventId?: string | null;
    lastEventType?: string | null;
    lastEventAt?: string | null;
    stripeEntitlementLookupKeys?: string[] | null;
    stripeEntitlementFeatureIds?: string[] | null;
    stripeEntitlementSummaryUpdatedAt?: string | null;
  },
): Promise<HostedBillingEntitlementRecord | null> {
  const account = await findHostedAccountByTenantIdState(tenantId);
  if (!account) return null;
  return syncHostedBillingEntitlement(account, options);
}

async function findHostedAccountByStripeRefs(options: {
  accountId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<{
  record: HostedAccountRecord | null;
  matchReason: 'account_id' | 'subscription_id' | 'customer_id' | 'none';
}> {
  if (options.accountId) {
    const record = await findHostedAccountByIdState(options.accountId);
    if (record) {
      return { record, matchReason: 'account_id' };
    }
  }

  const { records } = await listHostedAccountsState();
  if (options.stripeSubscriptionId) {
    const record = records.find((entry) => entry.billing.stripeSubscriptionId === options.stripeSubscriptionId) ?? null;
    if (record) {
      return { record, matchReason: 'subscription_id' };
    }
  }

  if (options.stripeCustomerId) {
    const record = records.find((entry) => entry.billing.stripeCustomerId === options.stripeCustomerId) ?? null;
    if (record) {
      return { record, matchReason: 'customer_id' };
    }
  }

  return {
    record: null,
    matchReason: 'none',
  };
}

async function revokeAccountSessionsForLifecycleChange(options: {
  account: HostedAccountRecord | null;
  previousStatus: HostedAccountRecord['status'] | null;
  nextStatus: HostedAccountRecord['status'] | null;
}): Promise<number> {
  if (!options.account) return 0;
  if (options.previousStatus === options.nextStatus) return 0;
  if (options.nextStatus !== 'suspended' && options.nextStatus !== 'archived') return 0;
  const result = await revokeAccountSessionsForAccountState(options.account.id);
  return result.revokedCount;
}

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
