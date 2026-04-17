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

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import Stripe from 'stripe';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { runFinancialPipeline } from '../financial/pipeline.js';
import { generateKeyPair } from '../signing/keys.js';
import { verifyCertificate } from '../signing/certificate.js';
import { buildVerificationKit } from '../signing/bundle.js';
import { domainRegistry } from '../domains/domain-pack.js';
import { financeDomainPack } from '../domains/finance-pack.js';
import { healthcareDomainPack } from '../domains/healthcare-pack.js';
import { verifyOidcToken, classifyIdentitySource } from '../identity/oidc-identity.js';
import type { FinancialPipelineInput } from '../financial/pipeline.js';
import type { ReviewerIdentity } from '../financial/types.js';

import { connectorRegistry } from '../connectors/connector-interface.js';
import { snowflakeConnector } from '../connectors/snowflake-connector.js';
import { filingRegistry } from '../filing/filing-adapter.js';
import { xbrlUsGaapAdapter, buildCounterpartyEnvelope } from '../filing/xbrl-adapter.js';
import { xbrlCsvEbaAdapter } from '../filing/xbrl-csv-adapter.js';
import { generatePkiHierarchy, verifyTrustChain } from '../signing/pki-chain.js';
import { createKeylessSignerPair, verifyKeylessSigner, type KeylessSigner } from '../signing/keyless-signer.js';
import { derivePublicKeyIdentity } from '../signing/keys.js';
import { decision, decisionLog, evidence, introspection, policy, review, shadow, token, verification } from '../release-layer/index.js';
import { action as financeActionRelease, communication as financeCommunicationRelease, financeReleasePolicies, record as financeRecordRelease } from '../release-layer/finance.js';
import {
  canEnqueueTenantAsyncJob,
  createPipelineQueue,
  createPipelineWorker,
  getAsyncQueueSummary,
  getAsyncRetryPolicy,
  getJobStatus,
  listFailedPipelineJobs,
  retryFailedPipelineJob,
  submitPipelineJob,
} from './async-pipeline.js';
import {
  tenantMiddleware,
  getAccountAccessContextFromHeaders,
  getTenantContextFromHeaders,
  type AccountAccessContext,
  type TenantContext,
} from './tenant-isolation.js';

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
const { createReleaseDecisionEngine } = decision;
const { createInMemoryReleaseDecisionLogWriter } = decisionLog;
const { createShadowModeReleaseEvaluator } = shadow;
const { createInMemoryReleaseTokenIntrospectionStore, createReleaseTokenIntrospector } =
  introspection;
const { createFinanceReviewerQueueItem, createInMemoryReleaseReviewerQueueStore } = review;
const { createReleaseTokenIssuer } = token;
const { createInMemoryReleaseEvidencePackStore, createReleaseEvidencePackIssuer } = evidence;
const {
  createActionReleasePolicy: createFinanceActionReleasePolicy,
  createCommunicationReleasePolicy: createFinanceCommunicationReleasePolicy,
} = financeReleasePolicies;
const { ReleaseVerificationError, resolveReleaseTokenFromRequest, verifyReleaseAuthorization } =
  verification;
import { TENANT_SCHEMA_SQL, autoActivateRLS } from './tenant-rls.js';
import {
  configureTenantRateLimiter,
  getTenantPipelineRateLimit,
  reserveTenantPipelineRequest,
  shutdownTenantRateLimiter,
} from './rate-limit.js';
import {
  configureTenantAsyncExecutionCoordinator,
  getTenantAsyncExecutionCoordinatorStatus,
  shutdownTenantAsyncExecutionCoordinator,
} from './async-tenant-execution.js';
import {
  configureTenantAsyncWeightedDispatchCoordinator,
  getTenantAsyncWeightedDispatchCoordinatorStatus,
  shutdownTenantAsyncWeightedDispatchCoordinator,
} from './async-weighted-dispatch.js';
import {
  evaluateApiHighAvailabilityState,
  resolveServiceInstanceId,
} from './high-availability.js';
import {
  tenantKeyStorePolicy,
  TenantKeyStoreError,
  type TenantKeyRecord,
} from './tenant-key-store.js';
import {
  AccountStoreError,
  type HostedAccountRecord,
  type StripeSubscriptionStatus,
} from './account-store.js';
import {
  AccountUserStoreError,
  type AccountUserRecord,
  type AccountUserRole,
  verifyAccountUserPasswordRecord,
} from './account-user-store.js';
import { type AccountUserActionTokenRecord } from './account-user-token-store.js';
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
  accountUserOidcSummary,
  buildHostedOidcAuthorizationRequest,
  completeHostedOidcAuthorization,
  hostedOidcAllowsAutomaticLinking,
  hostedOidcSummary,
  linkAccountUserOidcIdentity,
} from './account-oidc.js';
import {
  accountUserSamlSummary,
  buildHostedSamlAuthorizationRequest,
  completeHostedSamlAuthorization,
  getHostedSamlMetadata,
  hostedSamlAllowsAutomaticLinking,
  linkAccountUserSamlIdentity,
  loadHostedSamlSummary,
} from './account-saml.js';
import {
  accountUserPasskeySummary,
  buildAccountUserPasskeyCredentialRecord,
  buildHostedPasskeyAuthenticationOptions,
  buildHostedPasskeyRegistrationOptions,
  generateHostedPasskeyUserHandle,
  passkeyCredentialToWebAuthnCredential,
  verifyHostedPasskeyAuthentication,
  verifyHostedPasskeyRegistration,
  type HostedPasskeyAuthenticationChallengeState,
  type HostedPasskeyAuthenticatorHint,
  type HostedPasskeyRegistrationChallengeState,
} from './account-passkeys.js';
import { type AsyncDeadLetterRecord } from './async-dead-letter-store.js';
import {
  sessionCookieName,
  sessionCookieSecure,
} from './account-session-store.js';
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
  listHostedPlans,
  resolvePlanAsyncDispatch,
  resolvePlanAsyncExecution,
  resolvePlanAsyncQueue,
  resolvePlanRateLimit,
  resolvePlanSpec,
  resolvePlanStripePrice,
  resolvePlanStripeTrialDays,
} from './plan-catalog.js';
import { type AdminAuditAction } from './admin-audit-log.js';
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
  forceFlushTelemetry,
  getTelemetryStatus,
  initializeTelemetry,
  observeBillingWebhookEvent,
  observeRequestComplete,
  observeRequestStart,
  renderPrometheusMetrics,
  shutdownTelemetry,
} from './observability.js';
import {
  deliverHostedInviteEmail,
  deliverHostedPasswordResetEmail,
  getHostedEmailDeliveryStatus,
  HostedEmailDeliveryError,
  shutdownHostedEmailDelivery,
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
import { getSecretEnvelopeStatus, SecretEnvelopeError } from './secret-envelope.js';
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
import { registerCoreRoutes } from './http/routes/core-routes.js';
import { registerAdminRoutes } from './http/routes/admin-routes.js';
import { registerAccountRoutes } from './http/routes/account-routes.js';
import { registerPipelineRoutes } from './http/routes/pipeline-routes.js';
import { registerPublicSiteRoutes } from './http/routes/public-site-routes.js';
import { registerReleaseReviewRoutes } from './http/routes/release-review-routes.js';
import { registerWebhookRoutes } from './http/routes/webhook-routes.js';

// Register domain packs
if (!domainRegistry.has('finance')) domainRegistry.register(financeDomainPack);
if (!domainRegistry.has('healthcare')) domainRegistry.register(healthcareDomainPack);

// Register connectors
if (!connectorRegistry.has('snowflake')) connectorRegistry.register(snowflakeConnector);

// Register filing adapters
if (!filingRegistry.has('xbrl-us-gaap-2024')) filingRegistry.register(xbrlUsGaapAdapter);
if (!filingRegistry.has('xbrl-csv-eba-dpm2')) filingRegistry.register(xbrlCsvEbaAdapter);

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
    const tenant = getTenantContextFromHeaders(c.req.raw.headers);
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

// PKI hierarchy (startup-time, for health/metadata)
const pki = generatePkiHierarchy('Attestor Keyless CA', 'API Runtime Signer', 'API Reviewer');
const pkiReady = true;
const financeReleaseDecisionLog = createInMemoryReleaseDecisionLogWriter();
const financeReleaseDecisionEngine = createReleaseDecisionEngine({
  decisionLog: financeReleaseDecisionLog,
});
const financeCommunicationReleaseShadowEvaluator = createShadowModeReleaseEvaluator({
  engine: createReleaseDecisionEngine({
    policies: [createFinanceCommunicationReleasePolicy()],
  }),
});
const financeActionReleaseShadowEvaluator = createShadowModeReleaseEvaluator({
  engine: createReleaseDecisionEngine({
    policies: [createFinanceActionReleasePolicy()],
  }),
});
const apiReleaseReviewerQueueStore = createInMemoryReleaseReviewerQueueStore();
const apiReleaseIntrospectionStore = createInMemoryReleaseTokenIntrospectionStore();
const apiReleaseIntrospector = createReleaseTokenIntrospector(apiReleaseIntrospectionStore);
const apiReleaseTokenIssuer = createReleaseTokenIssuer({
  issuer: 'attestor.api.release.local',
  privateKeyPem: pki.signer.keyPair.privateKeyPem,
  publicKeyPem: pki.signer.keyPair.publicKeyPem,
});
const apiReleaseEvidencePackStore = createInMemoryReleaseEvidencePackStore();
const apiReleaseEvidencePackIssuer = createReleaseEvidencePackIssuer({
  issuer: 'attestor.api.release.local',
  privateKeyPem: pki.signer.keyPair.privateKeyPem,
  publicKeyPem: pki.signer.keyPair.publicKeyPem,
});
const apiReleaseVerificationKeyPromise = apiReleaseTokenIssuer.exportVerificationKey();

// Keyless signer: per-request ephemeral keys with CA-issued short-lived certs (Sigstore pattern)
function createRequestSigners(identitySource: string, reviewerName?: string) {
  return createKeylessSignerPair(
    { subject: 'API Runtime Signer', source: identitySource === 'oidc_verified' ? 'oidc_verified' : 'ephemeral', identifier: 'api-keyless' },
    reviewerName ? { subject: reviewerName, source: identitySource === 'oidc_verified' ? 'oidc_verified' : 'operator_asserted', identifier: reviewerName } : undefined,
  );
}

function currentTenant(c: Context): TenantContext {
  return getTenantContextFromHeaders(c.req.raw.headers);
}

function currentReleaseRequester(
  c: Context,
  reviewerIdentity?: ReviewerIdentity,
) {
  if (reviewerIdentity) {
    return {
      id: `reviewer:${reviewerIdentity.identifier}`,
      type: 'user' as const,
      displayName: reviewerIdentity.name,
      role: reviewerIdentity.role,
    };
  }

  const tenant = currentTenant(c);
  return {
    id: tenant.tenantId === 'default' ? 'svc.attestor.api' : `tenant:${tenant.tenantId}`,
    type: 'service' as const,
    displayName: tenant.tenantId === 'default' ? 'Attestor API Runtime' : tenant.tenantId,
    role: tenant.planId ?? 'service',
  };
}

function currentAccountAccess(c: Context): AccountAccessContext | null {
  return getAccountAccessContextFromHeaders(c.req.raw.headers);
}

function currentAccountRole(c: Context): AccountUserRole | null {
  return currentAccountAccess(c)?.role ?? null;
}

function accountUserView(record: AccountUserRecord) {
  const mfa = totpSummary(record.mfa.totp);
  const passkeys = accountUserPasskeySummary(record);
  const oidc = accountUserOidcSummary(record);
  const saml = accountUserSamlSummary(record);
  return {
    id: record.id,
    accountId: record.accountId,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deactivatedAt: record.deactivatedAt,
    lastLoginAt: record.lastLoginAt,
    mfa: {
      enabled: mfa.enabled,
      method: mfa.method,
      enrolledAt: mfa.enrolledAt,
      pendingEnrollment: mfa.pendingEnrollment,
    },
    passkeys: {
      enabled: passkeys.enabled,
      credentialCount: passkeys.credentialCount,
      userHandleConfigured: passkeys.userHandleConfigured,
      lastUsedAt: passkeys.lastUsedAt,
    },
    federation: {
      oidcLinked: oidc.linked,
      oidcIdentityCount: oidc.identityCount,
      lastOidcLoginAt: oidc.lastLoginAt,
      samlLinked: saml.linked,
      samlIdentityCount: saml.identityCount,
      lastSamlLoginAt: saml.lastLoginAt,
    },
  };
}

function accountUserDetailedMfaView(record: AccountUserRecord) {
  return totpSummary(record.mfa.totp);
}

function accountUserDetailedOidcView(record: AccountUserRecord, requestOrigin?: string | URL | null) {
  const summary = hostedOidcSummary(requestOrigin);
  return {
    configured: summary.enabled,
    issuerUrl: summary.issuerUrl,
    redirectUrl: summary.redirectUrl,
    scopes: summary.scopes,
    identities: record.federation.oidc.identities.map((identity) => ({
      id: identity.id,
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      linkedAt: identity.linkedAt,
      lastLoginAt: identity.lastLoginAt,
    })),
  };
}

function accountUserDetailedSamlView(record: AccountUserRecord, requestOrigin?: string | URL | null) {
  const summary = loadHostedSamlSummary(requestOrigin);
  return {
    configured: summary.enabled,
    entityId: summary.entityId,
    metadataUrl: summary.metadataUrl,
    acsUrl: summary.acsUrl,
    authnRequestsSigned: summary.authnRequestsSigned,
    identities: record.federation.saml.identities.map((identity) => ({
      id: identity.id,
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      nameIdFormat: identity.nameIdFormat,
      linkedAt: identity.linkedAt,
      lastLoginAt: identity.lastLoginAt,
    })),
  };
}

function accountUserDetailedPasskeyView(record: AccountUserRecord) {
  const summary = accountUserPasskeySummary(record);
  return {
    enabled: summary.enabled,
    credentialCount: summary.credentialCount,
    userHandleConfigured: summary.userHandleConfigured,
    lastUsedAt: summary.lastUsedAt,
    updatedAt: summary.updatedAt,
    credentials: record.passkeys.credentials.map((credential) => ({
      id: credential.id,
      credentialId: credential.credentialId,
      transports: credential.transports,
      aaguid: credential.aaguid,
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
    })),
  };
}

function accountPasskeyCredentialView(record: AccountUserRecord['passkeys']['credentials'][number]) {
  return {
    id: record.id,
    credentialId: record.credentialId,
    transports: record.transports,
    aaguid: record.aaguid,
    deviceType: record.deviceType,
    backedUp: record.backedUp,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

function schemaAttestationSummaryFromFull(attestation: any) {
  return {
    present: true,
    scope: 'schema_attestation_full' as const,
    executionContextHash: attestation.executionContextHash,
    provider: 'postgres',
    txidSnapshot: attestation.txidSnapshot ?? null,
    columnFingerprint: attestation.columnFingerprint ?? null,
    constraintFingerprint: attestation.constraintFingerprint ?? null,
    indexFingerprint: attestation.indexFingerprint ?? null,
    schemaFingerprint: attestation.schemaFingerprint,
    sentinelFingerprint: attestation.sentinelFingerprint,
    contentFingerprint: attestation.contentFingerprint ?? null,
    tableNames: attestation.tables,
    attestationHash: attestation.attestationHash,
    tableFingerprints: Array.isArray(attestation.tableContentFingerprints)
      ? attestation.tableContentFingerprints.map((entry: any) => {
        const sentinel = Array.isArray(attestation.sentinels)
          ? attestation.sentinels.find((candidate: any) => candidate.tableName === entry.tableName)
          : null;
        return {
          tableName: entry.tableName,
          rowCount: entry.rowCount,
          sampledRowCount: entry.sampledRowCount,
          rowLimit: entry.rowLimit,
          mode: entry.mode,
          orderBy: entry.orderBy,
          maxXmin: sentinel?.maxXmin ?? null,
          contentHash: entry.contentHash ?? null,
        };
      })
      : null,
    historicalComparison: attestation.historicalComparison ?? null,
  };
}

function schemaAttestationSummaryFromConnector(
  connectorExecution: any,
  connectorProvider: string | null,
) {
  const attestation = connectorExecution?.schemaAttestation;
  if (attestation) {
    return {
      present: true,
      scope: 'schema_attestation_connector' as const,
      executionContextHash: connectorExecution.executionContextHash,
      provider: connectorProvider,
      txidSnapshot: attestation.txidSnapshot ?? null,
      columnFingerprint: attestation.columnFingerprint ?? null,
      constraintFingerprint: attestation.constraintFingerprint ?? null,
      indexFingerprint: attestation.indexFingerprint ?? null,
      schemaFingerprint: attestation.schemaFingerprint,
      sentinelFingerprint: attestation.sentinelFingerprint,
      contentFingerprint: attestation.contentFingerprint ?? null,
      tableNames: attestation.tables,
      attestationHash: attestation.attestationHash,
      tableFingerprints: attestation.tableFingerprints ?? null,
      historicalComparison: attestation.historicalComparison ?? null,
    };
  }
  if (connectorExecution?.executionContextHash) {
    return {
      present: true,
      scope: 'execution_context_only' as const,
      executionContextHash: connectorExecution.executionContextHash,
      provider: connectorProvider,
      txidSnapshot: null,
      columnFingerprint: null,
      constraintFingerprint: null,
      indexFingerprint: null,
      schemaFingerprint: null,
      sentinelFingerprint: null,
      contentFingerprint: null,
      tableNames: null,
      attestationHash: null,
      tableFingerprints: null,
      historicalComparison: null,
    };
  }
  return null;
}

function accountUserActionTokenStatus(record: AccountUserActionTokenRecord): 'pending' | 'consumed' | 'revoked' | 'expired' {
  if (record.consumedAt) return 'consumed';
  if (record.revokedAt) return 'revoked';
  if (Date.parse(record.expiresAt) <= Date.now()) return 'expired';
  return 'pending';
}

function accountUserActionTokenView(record: AccountUserActionTokenRecord) {
  return {
    id: record.id,
    purpose: record.purpose,
    accountId: record.accountId,
    accountUserId: record.accountUserId,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
    status: accountUserActionTokenStatus(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
    revokedAt: record.revokedAt,
  };
}

function accountUserActionTokenContext(record: AccountUserActionTokenRecord): Record<string, unknown> {
  return record.context && typeof record.context === 'object' ? record.context : {};
}

function parsePasskeyRegistrationChallenge(
  record: AccountUserActionTokenRecord,
): HostedPasskeyRegistrationChallengeState | null {
  if (record.purpose !== 'passkey_registration') return null;
  const context = accountUserActionTokenContext(record);
  const challenge = typeof context.challenge === 'string' ? context.challenge.trim() : '';
  const rpId = typeof context.rpId === 'string' ? context.rpId.trim() : '';
  const origin = typeof context.origin === 'string' ? context.origin.trim() : '';
  const userHandle = typeof context.userHandle === 'string' ? context.userHandle.trim() : '';
  if (!record.accountUserId || !challenge || !rpId || !origin || !userHandle) return null;
  return {
    version: 1,
    purpose: 'registration',
    accountId: record.accountId,
    accountUserId: record.accountUserId,
    rpId,
    origin,
    challenge,
    userHandle,
    issuedAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function parsePasskeyAuthenticationChallenge(
  record: AccountUserActionTokenRecord,
): HostedPasskeyAuthenticationChallengeState | null {
  if (record.purpose !== 'passkey_authentication') return null;
  const context = accountUserActionTokenContext(record);
  const challenge = typeof context.challenge === 'string' ? context.challenge.trim() : '';
  const rpId = typeof context.rpId === 'string' ? context.rpId.trim() : '';
  const origin = typeof context.origin === 'string' ? context.origin.trim() : '';
  if (!record.accountUserId || !challenge || !rpId || !origin) return null;
  return {
    version: 1,
    purpose: 'authentication',
    accountUserId: record.accountUserId,
    rpId,
    origin,
    challenge,
    issuedAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function normalizePasskeyAuthenticatorHint(value: unknown): HostedPasskeyAuthenticatorHint | null {
  if (value !== 'securityKey' && value !== 'localDevice' && value !== 'remoteDevice') {
    return null;
  }
  return value;
}

function asRegistrationResponse(value: unknown): RegistrationResponseJSON | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as RegistrationResponseJSON;
  if (response.type !== 'public-key' || !response.response || typeof response.response !== 'object') {
    return null;
  }
  return response;
}

function asAuthenticationResponse(value: unknown): AuthenticationResponseJSON | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as AuthenticationResponseJSON;
  if (response.type !== 'public-key' || !response.response || typeof response.response !== 'object') {
    return null;
  }
  return response;
}

function setSessionCookieForRecord(c: Context, sessionToken: string, expiresAt: string): void {
  setCookie(c, sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: sessionCookieSecure(),
    path: '/api/v1',
    expires: new Date(expiresAt),
  });
}

function requireAccountSession(
  c: Context,
  options?: {
    roles?: AccountUserRole[];
    allowApiKey?: boolean;
  },
): Response | null {
  const access = currentAccountAccess(c);
  if (!access) {
    if (options?.allowApiKey && currentTenant(c).source === 'api_key') return null;
    return c.json({ error: 'Account session required.' }, 401);
  }
  if (options?.roles && !options.roles.includes(access.role)) {
    return c.json({
      error: `Account role '${access.role}' is not allowed to perform this action.`,
      requiredRoles: options.roles,
    }, 403);
  }
  return null;
}

function currentAdminAuthorized(c: Context): Response | null {
  const configured = process.env.ATTESTOR_ADMIN_API_KEY?.trim();
  if (!configured) {
    return c.json({
      error: 'Admin API disabled. Set ATTESTOR_ADMIN_API_KEY to enable tenant management endpoints.',
    }, 503);
  }

  const authHeader = c.req.header('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!constantTimeSecretEquals(token, configured)) {
    return c.json({ error: 'Valid admin API key required in Authorization header.' }, 401);
  }

  return null;
}

function currentMetricsAuthorized(c: Context): Response | null {
  const configured = process.env.ATTESTOR_METRICS_API_KEY?.trim();
  if (configured) {
    const authHeader = c.req.header('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!constantTimeSecretEquals(token, configured)) {
      return c.json({ error: 'Valid metrics API key required in Authorization header.' }, 401);
    }
    return null;
  }

  return currentAdminAuthorized(c);
}

function constantTimeSecretEquals(candidate: string, configured: string): boolean {
  if (!candidate || !configured) return false;
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const configuredDigest = createHash('sha256').update(configured).digest();
  return timingSafeEqual(candidateDigest, configuredDigest);
}

function stripeClient(): Stripe {
  return new Stripe(process.env.STRIPE_API_KEY?.trim() || 'sk_test_attestor_local');
}

function parseStripeSubscriptionStatus(raw: unknown): StripeSubscriptionStatus {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = raw.trim();
  switch (value) {
    case 'trialing':
    case 'active':
    case 'incomplete':
    case 'incomplete_expired':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
    case 'paused':
      return value as StripeSubscriptionStatus;
    default:
      throw new Error(
        "stripeSubscriptionStatus must be one of: trialing, active, incomplete, incomplete_expired, past_due, canceled, unpaid, paused.",
      );
  }
}

function parseStripeInvoiceStatus(
  raw: unknown,
): 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  switch (raw.trim()) {
    case 'draft':
    case 'open':
    case 'paid':
    case 'uncollectible':
    case 'void':
      return raw.trim() as 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
    default:
      return null;
  }
}

function parseStripeChargeStatus(
  raw: unknown,
): 'succeeded' | 'pending' | 'failed' | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  switch (raw.trim()) {
    case 'succeeded':
    case 'pending':
    case 'failed':
      return raw.trim() as 'succeeded' | 'pending' | 'failed';
    default:
      return null;
  }
}

function metadataStringValue(
  key: string,
  ...sources: Array<Record<string, unknown> | Stripe.Metadata | null | undefined>
): string | null {
  for (const source of sources) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

function stripeReferenceId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') {
    return ((value as { id: string }).id).trim();
  }
  return null;
}

function unixSecondsToIso(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

function stripeInvoicePriceId(invoice: Stripe.Invoice): string | null {
  for (const entry of invoice.lines?.data ?? []) {
    const directPriceId = stripeReferenceId((entry as { price?: unknown }).price);
    if (directPriceId) return directPriceId;
    const pricingPriceId = stripeReferenceId(
      (entry as { pricing?: { price_details?: { price?: unknown } | null } | null }).pricing?.price_details?.price,
    );
    if (pricingPriceId) return pricingPriceId;
  }
  return null;
}

function adminTenantKeyView(record: TenantKeyRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    tenantName: record.tenantName,
    planId: record.planId,
    monthlyRunQuota: record.monthlyRunQuota,
    apiKeyPreview: record.apiKeyPreview,
    status: record.status,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    deactivatedAt: record.deactivatedAt,
    revokedAt: record.revokedAt,
    rotatedFromKeyId: record.rotatedFromKeyId,
    supersededByKeyId: record.supersededByKeyId,
    supersededAt: record.supersededAt,
    sealedStorage: {
      enabled: Boolean(record.recoveryEnvelope),
      provider: record.recoveryEnvelope?.provider ?? null,
      keyName: record.recoveryEnvelope?.keyName ?? null,
      sealedAt: record.recoveryEnvelope?.sealedAt ?? null,
      breakGlassRecoverable: Boolean(record.recoveryEnvelope),
    },
  };
}

function accountApiKeyView(record: TenantKeyRecord) {
  return adminTenantKeyView(record);
}

function normalizeSignupTenantSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 32);
}

function deriveSignupTenantId(accountName: string, email: string): string {
  const [emailLocalPart] = email.split('@', 1);
  const base = normalizeSignupTenantSegment(accountName)
    || normalizeSignupTenantSegment(emailLocalPart ?? '')
    || 'account';
  return `${base}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function adminAccountView(record: HostedAccountRecord) {
  return {
    id: record.id,
    accountName: record.accountName,
    contactEmail: record.contactEmail,
    primaryTenantId: record.primaryTenantId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    suspendedAt: record.suspendedAt,
    archivedAt: record.archivedAt,
    billing: record.billing,
  };
}

function adminPlanView() {
  return listHostedPlans().map((plan) => ({
    id: plan.id,
    displayName: plan.displayName,
    description: plan.description,
    defaultStripeTrialDays: resolvePlanStripeTrialDays(plan.id).trialDays,
    defaultMonthlyRunQuota: plan.defaultMonthlyRunQuota,
    defaultPipelineRequestsPerWindow: resolvePlanRateLimit(plan.id).requestsPerWindow,
    defaultAsyncPendingJobsPerTenant: resolvePlanAsyncQueue(plan.id).pendingJobsPerTenant,
    defaultAsyncActiveJobsPerTenant: resolvePlanAsyncExecution(plan.id).activeJobsPerTenant,
    defaultAsyncDispatchWeight: resolvePlanAsyncDispatch(plan.id).dispatchWeight,
    defaultAsyncDispatchWindowMs: resolvePlanAsyncDispatch(plan.id).dispatchWindowMs,
    stripePriceConfigured: resolvePlanStripePrice(plan.id).configured,
    intendedFor: plan.intendedFor,
    defaultForHostedProvisioning: plan.defaultForHostedProvisioning,
  }));
}

function tenantKeyStoreErrorResponse(c: Context, err: unknown): Response | null {
  if (!(err instanceof TenantKeyStoreError)) return null;
  if (err.code === 'NOT_FOUND') {
    return c.json({ error: err.message }, 404);
  }
  return c.json({ error: err.message }, 409);
}

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

function secretEnvelopeErrorResponse(c: Context, err: unknown): Response | null {
  if (!(err instanceof SecretEnvelopeError)) return null;
  if (err.code === 'DISABLED') {
    return c.json({ error: err.message }, 409);
  }
  return c.json({ error: err.message }, 503);
}

function stripeBillingErrorResponse(c: Context, err: unknown): Response | null {
  if (!(err instanceof StripeBillingError)) return null;
  if (err.code === 'DISABLED') return c.json({ error: err.message }, 503);
  if (err.code === 'NO_CUSTOMER') return c.json({ error: err.message }, 409);
  return c.json({ error: err.message }, 400);
}

function hostedEmailDeliveryErrorResponse(c: Context, err: unknown): Response | null {
  if (!(err instanceof HostedEmailDeliveryError)) return null;
  if (err.code === 'CONFIG') return c.json({ error: err.message }, 503);
  return c.json({ error: err.message }, 502);
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

function billingEntitlementView(record: HostedBillingEntitlementRecord) {
  return {
    id: record.id,
    accountId: record.accountId,
    tenantId: record.tenantId,
    provider: record.provider,
    status: record.status,
    accessEnabled: record.accessEnabled,
    effectivePlanId: record.effectivePlanId,
    requestedPlanId: record.requestedPlanId,
    monthlyRunQuota: record.monthlyRunQuota,
    requestsPerWindow: record.requestsPerWindow,
    asyncPendingJobsPerTenant: record.asyncPendingJobsPerTenant,
    accountStatus: record.accountStatus,
    stripeCustomerId: record.stripeCustomerId,
    stripeSubscriptionId: record.stripeSubscriptionId,
    stripeSubscriptionStatus: record.stripeSubscriptionStatus,
    stripePriceId: record.stripePriceId,
    stripeCheckoutSessionId: record.stripeCheckoutSessionId,
    stripeInvoiceId: record.stripeInvoiceId,
    stripeInvoiceStatus: record.stripeInvoiceStatus,
    stripeEntitlementLookupKeys: record.stripeEntitlementLookupKeys,
    stripeEntitlementFeatureIds: record.stripeEntitlementFeatureIds,
    stripeEntitlementSummaryUpdatedAt: record.stripeEntitlementSummaryUpdatedAt,
    lastEventId: record.lastEventId,
    lastEventType: record.lastEventType,
    lastEventAt: record.lastEventAt,
    effectiveAt: record.effectiveAt,
    delinquentSince: record.delinquentSince,
    reason: record.reason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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

function applyRateLimitHeaders(
  c: Context,
  rateLimit: {
    requestsPerWindow: number | null;
    remaining: number | null;
    resetAt: string;
    retryAfterSeconds: number;
    enforced: boolean;
  },
  options?: { includeRetryAfter?: boolean },
): void {
  if (!rateLimit.enforced || rateLimit.requestsPerWindow === null) return;
  c.header('x-attestor-rate-limit-limit', String(rateLimit.requestsPerWindow));
  c.header('x-attestor-rate-limit-remaining', String(rateLimit.remaining ?? 0));
  c.header('x-attestor-rate-limit-reset', rateLimit.resetAt);
  if (options?.includeRetryAfter) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds));
  }
}

function adminAuditView(record: {
  id: string;
  occurredAt: string;
  actorType: 'admin_api_key' | 'stripe_webhook';
  actorLabel: string;
  action: AdminAuditAction;
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
}) {
  return {
    id: record.id,
    occurredAt: record.occurredAt,
    actorType: record.actorType,
    actorLabel: record.actorLabel,
    action: record.action,
    routeId: record.routeId,
    accountId: record.accountId,
    tenantId: record.tenantId,
    tenantKeyId: record.tenantKeyId,
    planId: record.planId,
    monthlyRunQuota: record.monthlyRunQuota,
    idempotencyKey: record.idempotencyKey,
    requestHash: record.requestHash,
    metadata: record.metadata,
    previousHash: record.previousHash,
    eventHash: record.eventHash,
  };
}

function billingEventView(record: Awaited<ReturnType<typeof listBillingEvents>>[number]) {
  return {
    id: record.id,
    provider: record.provider,
    source: record.source,
    providerEventId: record.providerEventId,
    eventType: record.eventType,
    payloadHash: record.payloadHash,
    outcome: record.outcome,
    reason: record.reason,
    accountId: record.accountId,
    tenantId: record.tenantId,
    stripeCheckoutSessionId: record.stripeCheckoutSessionId,
    stripeCustomerId: record.stripeCustomerId,
    stripeSubscriptionId: record.stripeSubscriptionId,
    stripePriceId: record.stripePriceId,
    stripeInvoiceId: record.stripeInvoiceId,
    stripeInvoiceStatus: record.stripeInvoiceStatus,
    stripeInvoiceCurrency: record.stripeInvoiceCurrency,
    stripeInvoiceAmountPaid: record.stripeInvoiceAmountPaid,
    stripeInvoiceAmountDue: record.stripeInvoiceAmountDue,
    accountStatusBefore: record.accountStatusBefore,
    accountStatusAfter: record.accountStatusAfter,
    billingStatusBefore: record.billingStatusBefore,
    billingStatusAfter: record.billingStatusAfter,
    mappedPlanId: record.mappedPlanId,
    receivedAt: record.receivedAt,
    processedAt: record.processedAt,
    metadata: record.metadata,
  };
}

async function adminMutationRequest(c: Context, routeId: string, requestPayload: unknown):
  Promise<{ idempotencyKey: string | null; requestHash: string } | Response> {
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() ?? null;
  if (!idempotencyKey) {
    return {
      idempotencyKey: null,
      requestHash: hashJsonValue({ routeId, payload: requestPayload }),
    };
  }

  const lookup = await lookupAdminIdempotencyState({
    idempotencyKey,
    routeId,
    requestPayload,
  });

  if (lookup.kind === 'conflict') {
    return c.json({
      error: `Idempotency-Key '${idempotencyKey}' was already used for a different admin mutation.`,
      routeId: lookup.record.routeId,
      createdAt: lookup.record.createdAt,
    }, 409);
  }

  if (lookup.kind === 'replay') {
    return new Response(JSON.stringify(lookup.response), {
      status: lookup.record.statusCode,
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-attestor-idempotent-replay': 'true',
        'x-attestor-idempotency-key': idempotencyKey,
      },
    });
  }

  return {
    idempotencyKey,
    requestHash: lookup.requestHash,
  };
}

async function finalizeAdminMutation(options: {
  idempotencyKey: string | null;
  routeId: string;
  requestPayload: unknown;
  statusCode: number;
  responseBody: Record<string, unknown>;
  audit: {
    action: AdminAuditAction;
    accountId?: string | null;
    tenantId?: string | null;
    tenantKeyId?: string | null;
    planId?: string | null;
    monthlyRunQuota?: number | null;
    requestHash?: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<Record<string, unknown>> {
  if (options.idempotencyKey) {
    await recordAdminIdempotencyState({
      idempotencyKey: options.idempotencyKey,
      routeId: options.routeId,
      requestPayload: options.requestPayload,
      statusCode: options.statusCode,
      response: options.responseBody,
    });
  }

  await appendAdminAuditRecordState({
    actorType: 'admin_api_key',
    actorLabel: 'ATTESTOR_ADMIN_API_KEY',
    action: options.audit.action,
    routeId: options.routeId,
    accountId: options.audit.accountId ?? null,
    tenantId: options.audit.tenantId ?? null,
    tenantKeyId: options.audit.tenantKeyId ?? null,
    planId: options.audit.planId ?? null,
    monthlyRunQuota: options.audit.monthlyRunQuota ?? null,
    idempotencyKey: options.idempotencyKey,
    requestHash: options.audit.requestHash ?? '',
    metadata: options.audit.metadata ?? {},
  });

  return options.responseBody;
}

// ─── Async Pipeline — BullMQ with truthful in-process fallback ──────────────

// Detect async backend at startup
let asyncBackendMode: 'bullmq' | 'in_process' = 'in_process';
let bullmqQueue: Awaited<ReturnType<typeof createPipelineQueue>> | null = null;
let bullmqWorker: Awaited<ReturnType<typeof createPipelineWorker>> | null = null;
let sharedRedisUrl: string | null = null;

// In-process fallback store
interface AsyncJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  submittedAt: string;
  completedAt: string | null;
  tenantId: string;
  planId: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}
const inProcessJobs = new Map<string, AsyncJob>();
const asyncSubmissionReservations = new Map<string, number>();

function currentAsyncSubmissionReservations(tenantId: string): number {
  return asyncSubmissionReservations.get(tenantId) ?? 0;
}

function reserveAsyncSubmission(tenantId: string): void {
  asyncSubmissionReservations.set(tenantId, currentAsyncSubmissionReservations(tenantId) + 1);
}

function releaseAsyncSubmission(tenantId: string): void {
  const next = currentAsyncSubmissionReservations(tenantId) - 1;
  if (next <= 0) {
    asyncSubmissionReservations.delete(tenantId);
    return;
  }
  asyncSubmissionReservations.set(tenantId, next);
}

function inProcessTenantQueueSnapshot(tenantId: string, planId: string | null) {
  const states = {
    waiting: 0,
    active: 0,
    delayed: 0,
    prioritized: 0,
    failed: 0,
  };
  for (const job of inProcessJobs.values()) {
    if (job.tenantId !== tenantId) continue;
    if (job.status === 'queued') states.waiting += 1;
    if (job.status === 'running') states.active += 1;
    if (job.status === 'failed') states.failed += 1;
  }
  const policy = resolvePlanAsyncQueue(planId);
  const executionPolicy = resolvePlanAsyncExecution(planId);
  const dispatchPolicy = resolvePlanAsyncDispatch(planId);
  return {
    tenantId,
    planId,
    pendingJobs: states.waiting + states.active,
    pendingLimit: policy.pendingJobsPerTenant,
    enforced: policy.enforced,
    activeExecutions: states.active,
    activeExecutionLimit: executionPolicy.activeJobsPerTenant,
    activeExecutionEnforced: executionPolicy.enforced,
    activeExecutionBackend: 'memory' as const,
    weightedDispatchEnforced: false,
    weightedDispatchBackend: 'memory' as const,
    weightedDispatchWeight: dispatchPolicy.dispatchWeight,
    weightedDispatchWindowMs: dispatchPolicy.dispatchWindowMs,
    weightedDispatchNextEligibleAt: null,
    weightedDispatchWaitMs: 0,
    scanLimit: Number.MAX_SAFE_INTEGER,
    scanTruncated: false,
    states,
  };
}

// BullMQ initialization via 3-tier Redis auto-resolution:
// 1. REDIS_URL env var (production)  2. localhost:6379 probe  3. embedded (dev/CI)
// Falls back to in_process if all tiers fail.
import { resolveRedis } from './redis-auto.js';

let redisMode: string = 'none';
try {
  const resolved = await resolveRedis();
  const redisUrl = `redis://${resolved.host}:${resolved.port}`;
  sharedRedisUrl = redisUrl;
  configureTenantAsyncExecutionCoordinator({ redisUrl, redisMode: resolved.mode });
  configureTenantAsyncWeightedDispatchCoordinator({ redisUrl, redisMode: resolved.mode });
  bullmqQueue = createPipelineQueue({ redisUrl });
  bullmqWorker = createPipelineWorker({ redisUrl });
  asyncBackendMode = 'bullmq';
  redisMode = resolved.mode;
  console.log(`[async] BullMQ active (Redis: ${resolved.mode} @ ${resolved.host}:${resolved.port})`);
} catch (err: any) {
  redisMode = 'unavailable';
  console.log(`[async] Redis unavailable (${err.message}), using in_process fallback`);
}

// ─── RLS Auto-Activation ─────────────────────────────────────────────────────

let rlsActivationResult = { activated: false, policiesFound: 0, tablesProtected: [] as string[], error: null as string | null };

if (process.env.ATTESTOR_PG_URL) {
  try {
    const pg = await (Function('return import("pg")')() as Promise<any>);
    const Pool = pg.Pool ?? pg.default?.Pool;
    const pool = new Pool({ connectionString: process.env.ATTESTOR_PG_URL });
    rlsActivationResult = await autoActivateRLS(pool);
    if (rlsActivationResult.activated) {
      console.log(`[rls] Active: ${rlsActivationResult.policiesFound} policies on [${rlsActivationResult.tablesProtected.join(', ')}]`);
    } else {
      console.log(`[rls] Not activated: ${rlsActivationResult.error ?? 'unknown'}`);
    }
    await pool.end();
  } catch (err: any) {
    rlsActivationResult.error = err.message;
    console.log(`[rls] Skipped: ${err.message}`);
  }
}

const routeDeps = {
  committedFinancialPacket,
  renderFinancialReportingLandingPage,
  renderFinancialReportingProofPage,
  renderHostedReturnPage,
  readCommittedEvidence,
  committedEvidenceContentType,
  currentHostedAccount,
  countAccountUsersForAccountState,
  createAccountUserState,
  AccountUserStoreError,
  findAccountUserByEmailState,
  deriveSignupTenantId,
  SELF_HOST_PLAN_ID,
  provisionHostedAccountState,
  tenantKeyStoreErrorResponse,
  issueAccountSessionState,
  recordAccountUserLoginState,
  syncHostedBillingEntitlement,
  syncHostedBillingEntitlementForTenant,
  setSessionCookieForRecord,
  accountUserView,
  adminAccountView,
  accountApiKeyView,
  resolvePlanStripeTrialDays,
  verifyAccountUserPasswordRecord,
  findHostedAccountByIdState,
  findHostedAccountByTenantIdState,
  totpSummary,
  issueAccountMfaLoginTokenState,
  buildHostedPasskeyAuthenticationOptions,
  issueAccountPasskeyChallengeTokenState,
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
  HostedEmailDeliveryError,
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
  createHostedCheckoutSession,
  stripeBillingErrorResponse,
  createHostedBillingPortalSession,
  buildHostedBillingExport,
  renderHostedBillingExportCsv,
  buildHostedBillingReconciliation,
  renderReleaseReviewerQueueInboxPage,
  renderReleaseReviewerQueueDetailPage,
  currentAdminAuthorized,
  adminTenantKeyView,
  listHostedAccountsState,
  getTenantAsyncExecutionCoordinatorStatus,
  getTenantAsyncWeightedDispatchCoordinatorStatus,
  adminPlanView,
  defaultRateLimitWindowSeconds,
  listAdminAuditRecordsState,
  adminAuditView,
  listBillingEvents,
  billingEventView,
  listHostedBillingEntitlementsState,
  renderPrometheusMetrics,
  currentMetricsAuthorized,
  getTelemetryStatus,
  getHostedEmailDeliveryStatus,
  listAsyncDeadLetterRecordsState,
  listFailedPipelineJobs,
  retryFailedPipelineJob,
  adminMutationRequest,
  finalizeAdminMutation,
  parseStripeSubscriptionStatus,
  setHostedAccountStatusState,
  revokeAccountSessionsForAccountState,
  recoverTenantApiKeyState,
  secretEnvelopeErrorResponse,
  queryUsageLedgerState,
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
  currentTenant,
  canConsumePipelineRunState,
  reserveTenantPipelineRequest,
  applyRateLimitHeaders,
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
  finalizeFinanceFilingReleaseDecision,
  createFinanceReviewerQueueItem,
  apiReleaseReviewerQueueStore,
  apiReleaseTokenIssuer,
  apiReleaseEvidencePackStore,
  apiReleaseEvidencePackIssuer,
  apiReleaseIntrospectionStore,
  consumePipelineRunState,
  schemaAttestationSummaryFromFull,
  schemaAttestationSummaryFromConnector,
  verifyCertificate,
  verifyTrustChain,
  derivePublicKeyIdentity,
  buildCounterpartyEnvelope,
  apiReleaseVerificationKeyPromise,
  resolveReleaseTokenFromRequest,
  verifyReleaseAuthorization,
  apiReleaseIntrospector,
  ReleaseVerificationError,
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
  upsertAsyncDeadLetterRecordState,
  getJobStatus,
  getSendGridWebhookStatus,
  verifySignedSendGridWebhook,
  parseSendGridWebhookEvents,
  listHostedEmailDeliveriesState,
  recordHostedEmailProviderEventState,
  sendGridEventTypeToStatusHint,
  getMailgunWebhookStatus,
  parseMailgunWebhookEvent,
  verifySignedMailgunWebhook,
  mailgunEventTypeToStatusHint,
  stripeClient,
  observeBillingWebhookEvent,
  isBillingEventLedgerConfigured,
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
  accountStoreErrorResponse,
  applyStripeSubscriptionStateState,
  applyStripeInvoiceStateState,
  applyStripeCheckoutCompletionState,
  attachStripeBillingToAccountState,
  findHostedAccountByStripeRefs,
  findHostedPlanByStripePriceId,
  resolvePlanSpec,
  DEFAULT_HOSTED_PLAN_ID,
  syncTenantPlanByTenantIdState,
  revokeAccountSessionsForLifecycleChange,
  appendAdminAuditRecordState,
  billingEntitlementView,
  extractInvoiceLineItemSnapshotsFromInvoice,
  listHostedStripeActiveEntitlements,
  extractActiveEntitlementsFromSummary,
  listHostedStripeInvoiceLineItems,
  upsertStripeInvoiceLineItems,
  parseStripeChargeStatus,
  upsertStripeCharges,
  unixSecondsToIso,
  resolvePlanStripePrice,
};

registerPublicSiteRoutes(app, routeDeps);
registerCoreRoutes(app, routeDeps);
registerAccountRoutes(app, routeDeps);
registerAdminRoutes(app, routeDeps);
registerReleaseReviewRoutes(app, routeDeps);
registerWebhookRoutes(app, routeDeps);
registerPipelineRoutes(app, routeDeps);


// ─── Server Start/Stop ──────────────────────────────────────────────────────

export function startServer(port: number = 3700): { port: number; close: () => void } {
  const telemetry = initializeTelemetry('1.0.0');
  configureTenantAsyncExecutionCoordinator({
    redisUrl: process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL?.trim() || sharedRedisUrl,
    redisMode: process.env.ATTESTOR_ASYNC_ACTIVE_REDIS_URL?.trim() ? 'explicit' : redisMode,
  });
  configureTenantAsyncWeightedDispatchCoordinator({
    redisUrl: process.env.ATTESTOR_ASYNC_DISPATCH_REDIS_URL?.trim() || sharedRedisUrl,
    redisMode: process.env.ATTESTOR_ASYNC_DISPATCH_REDIS_URL?.trim() ? 'explicit' : redisMode,
  });
  configureTenantRateLimiter({
    redisUrl: process.env.ATTESTOR_RATE_LIMIT_REDIS_URL?.trim() || sharedRedisUrl,
    redisMode: process.env.ATTESTOR_RATE_LIMIT_REDIS_URL?.trim() ? 'explicit' : redisMode,
  });
  const highAvailability = evaluateApiHighAvailabilityState({
    redisMode: redisMode as 'external' | 'localhost' | 'embedded' | 'none' | 'unavailable',
    asyncBackendMode: asyncBackendMode as 'bullmq' | 'in_process' | 'none',
    sharedControlPlane: isSharedControlPlaneConfigured(),
    sharedBillingLedger: !!process.env.ATTESTOR_BILLING_LEDGER_PG_URL?.trim(),
  });
  if (!highAvailability.ready) {
    if (highAvailability.enabled) {
      throw new Error(`ATTESTOR_HA_MODE startup guard failed for instance '${highAvailability.instanceId}': ${highAvailability.issues.join(' ')}`);
    }
    if (highAvailability.publicHosted) {
      throw new Error(`Public hosted startup guard failed for instance '${highAvailability.instanceId}': ${highAvailability.issues.join(' ')}`);
    }
  }
  if (highAvailability.enabled) {
    console.log(`[ha] Multi-node first slice enabled for instance '${highAvailability.instanceId}' (redis=${highAvailability.redisMode}, sharedControlPlane=${highAvailability.sharedControlPlane}, sharedBillingLedger=${highAvailability.sharedBillingLedger})`);
  }
  if (telemetry.traces.enabled && telemetry.traces.endpoint) {
    console.log(`[telemetry] OTLP traces enabled (${telemetry.traces.protocol}) -> ${telemetry.traces.endpoint}`);
  }
  if (telemetry.metrics.enabled && telemetry.metrics.endpoint) {
    console.log(`[telemetry] OTLP metrics enabled (${telemetry.metrics.protocol}) -> ${telemetry.metrics.endpoint} @ ${telemetry.metrics.exportIntervalMillis ?? 1000}ms`);
  }
  if (!telemetry.traces.enabled && !telemetry.metrics.enabled && telemetry.disabledReason) {
    console.log(`[telemetry] Disabled: ${telemetry.disabledReason}`);
  }
  const server = serve({ fetch: app.fetch, port });
  return {
    port,
      close: () => {
        void forceFlushTelemetry().catch(() => {});
        shutdownHostedEmailDelivery();
        if (server && typeof (server as any).close === 'function') {
          (server as any).close();
        }
      void shutdownTenantAsyncExecutionCoordinator().catch(() => {});
      void shutdownTenantAsyncWeightedDispatchCoordinator().catch(() => {});
      void shutdownTenantRateLimiter().catch(() => {});
      void shutdownTelemetry().catch(() => {});
    },
  };
}

export { app };

// Standalone mode: start server when run directly
if (process.argv[1]?.endsWith('api-server.ts') || process.argv[1]?.endsWith('api-server.js')) {
  const port = parseInt(process.env.PORT ?? '3700', 10);
  const handle = startServer(port);
  console.log(`[attestor] API server running on port ${port}`);

  // Graceful shutdown: drain connections on SIGTERM/SIGINT (container orchestration)
  const shutdown = (signal: string) => {
    console.log(`[attestor] ${signal} received — shutting down gracefully...`);
    handle.close();
    // Give in-flight requests 5s to complete, then force exit
    setTimeout(() => { console.log('[attestor] Force exit after timeout'); process.exit(0); }, 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
