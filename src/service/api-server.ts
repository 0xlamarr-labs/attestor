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
import {
  buildHostedBillingExport,
  renderHostedBillingExportCsv,
} from './billing-export.js';
import { buildHostedBillingReconciliation } from './billing-reconciliation.js';

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
  if (!token || token !== configured) {
    return c.json({ error: 'Valid admin API key required in Authorization header.' }, 401);
  }

  return null;
}

function currentMetricsAuthorized(c: Context): Response | null {
  const configured = process.env.ATTESTOR_METRICS_API_KEY?.trim();
  if (configured) {
    const authHeader = c.req.header('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== configured) {
      return c.json({ error: 'Valid metrics API key required in Authorization header.' }, 401);
    }
    return null;
  }

  return currentAdminAuthorized(c);
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

// ─── Health ─────────────────────────────────────────────────────────────────

app.get('/api/v1/health', (c) => {
  const highAvailability = evaluateApiHighAvailabilityState({
    redisMode: redisMode as 'external' | 'localhost' | 'embedded' | 'none' | 'unavailable',
    asyncBackendMode: asyncBackendMode as 'bullmq' | 'in_process' | 'none',
    sharedControlPlane: isSharedControlPlaneConfigured(),
    sharedBillingLedger: !!process.env.ATTESTOR_BILLING_LEDGER_PG_URL?.trim(),
  });
  return c.json({
    status: 'healthy',
    version: '0.1.0',
    instanceId: serviceInstanceId,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    domains: domainRegistry.listIds(),
    connectors: connectorRegistry.listIds(),
    filingAdapters: filingRegistry.list().map(a => a.id),
    pki: {
      ready: pkiReady,
      caName: pki.ca.certificate.name,
      caFingerprint: pki.ca.certificate.fingerprint,
      signerSubject: pki.signer.certificate.subject,
      reviewerSubject: pki.reviewer.certificate.subject,
    },
    tenantIsolation: {
      requestLevel: true,
      databaseRls: {
        schemaAvailable: true,
        configured: !!process.env.ATTESTOR_PG_URL,
        activated: rlsActivationResult.activated,
        policiesFound: rlsActivationResult.policiesFound,
        tablesProtected: rlsActivationResult.tablesProtected,
        error: rlsActivationResult.error,
      },
    },
    asyncBackend: { mode: asyncBackendMode, redisMode },
    highAvailability,
    engine: 'attestor',
  });
});

// ─── Domains ────────────────────────────────────────────────────────────────

app.get('/api/v1/domains', (c) => {
  const domains = domainRegistry.list().map(d => ({
    id: d.id,
    version: d.version,
    displayName: d.displayName,
    description: d.description,
    clauseCount: d.clauses.length,
    guardrailCount: d.guardrails.length,
  }));
  return c.json({ domains });
});

app.get('/api/v1/connectors', async (c) => {
  const connectors = await Promise.all(
    connectorRegistry.list().map(async (connector) => ({
      id: connector.id,
      displayName: connector.displayName,
      configured: connector.loadConfig() !== null,
      available: await connector.isAvailable(),
    })),
  );
  return c.json({ connectors });
});

app.post('/api/v1/account/users/bootstrap', async (c) => {
  const current = await currentHostedAccount(c);
  if (current instanceof Response) return current;
  if (current.tenant.source !== 'api_key' && current.tenant.source !== 'bearer_token') {
    return c.json({ error: 'Bootstrap requires a tenant API key or bearer token.' }, 403);
  }

  const existingUsers = await countAccountUsersForAccountState(current.account.id);
  if (existingUsers > 0) {
    return c.json({
      error: `Hosted account '${current.account.id}' already has account users. Use an account_admin session to manage users.`,
    }, 409);
  }

  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !displayName || !password) {
    return c.json({ error: 'email, displayName, and password are required.' }, 400);
  }
  if (password.length < 12) {
    return c.json({ error: 'password must be at least 12 characters long.' }, 400);
  }

  let created;
  try {
    created = await createAccountUserState({
      accountId: current.account.id,
      email,
      displayName,
      password,
      role: 'account_admin',
    });
  } catch (err) {
    if (err instanceof AccountUserStoreError) {
      return c.json({ error: err.message }, err.code === 'NOT_FOUND' ? 404 : 409);
    }
    throw err;
  }

  return c.json({
    user: accountUserView(created.record),
    bootstrap: true,
  }, 201);
});

app.post('/api/v1/auth/signup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const accountName = typeof body.accountName === 'string' ? body.accountName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!accountName || !email || !displayName || !password) {
    return c.json({ error: 'accountName, email, displayName, and password are required.' }, 400);
  }
  if (password.length < 12) {
    return c.json({ error: 'password must be at least 12 characters long.' }, 400);
  }

  const existingUser = await findAccountUserByEmailState(email);
  if (existingUser) {
    return c.json({ error: `Account user '${email}' already exists.` }, 409);
  }

  const tenantId = deriveSignupTenantId(accountName, email);
  let resolvedPlan;
  try {
    resolvedPlan = resolvePlanSpec({
      planId: SELF_HOST_PLAN_ID,
      defaultPlanId: SELF_HOST_PLAN_ID,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  let provisioned;
  try {
    provisioned = await provisionHostedAccountState({
      account: {
        accountName,
        contactEmail: email,
        primaryTenantId: tenantId,
      },
      key: {
        tenantId,
        tenantName: accountName,
        planId: resolvedPlan.planId,
        monthlyRunQuota: resolvedPlan.monthlyRunQuota,
      },
    });
  } catch (err) {
    const mapped = accountStoreErrorResponse(c, err);
    if (mapped) return mapped;
    const tenantMapped = tenantKeyStoreErrorResponse(c, err);
    if (tenantMapped) return tenantMapped;
    throw err;
  }

  let createdUser;
  try {
    createdUser = await createAccountUserState({
      accountId: provisioned.account.id,
      email,
      displayName,
      password,
      role: 'account_admin',
    });
  } catch (err) {
    if (err instanceof AccountUserStoreError) {
      return c.json({ error: err.message }, err.code === 'NOT_FOUND' ? 404 : 409);
    }
    throw err;
  }

  const issued = await issueAccountSessionState({
    accountId: provisioned.account.id,
    accountUserId: createdUser.record.id,
    role: createdUser.record.role,
  });
  const loginTouch = await recordAccountUserLoginState(createdUser.record.id);
  await syncHostedBillingEntitlementForTenant(provisioned.account.primaryTenantId, {
    lastEventType: 'auth.signup',
    lastEventAt: new Date().toISOString(),
  });

  setSessionCookieForRecord(c, issued.sessionToken, issued.record.expiresAt);

  return c.json({
    signup: true,
    session: {
      id: issued.record.id,
      expiresAt: issued.record.expiresAt,
      source: 'account_session',
    },
    user: accountUserView(loginTouch.record),
    account: adminAccountView(provisioned.account),
    initialKey: {
      ...accountApiKeyView(provisioned.initialKey),
      apiKey: provisioned.apiKey,
    },
  }, 201);
});

app.post('/api/v1/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return c.json({ error: 'email and password are required.' }, 400);
  }

  const user = await findAccountUserByEmailState(email);
  if (!user || !verifyAccountUserPasswordRecord(user.password, password)) {
    return c.json({ error: 'Invalid email or password.' }, 401);
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
    user: accountUserView(loginTouch.record),
    account: adminAccountView(account),
  });
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
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
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
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
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
    const message = err instanceof Error ? err.message : String(err);
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
    const message = err instanceof Error ? err.message : String(err);
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
    const message = err instanceof Error ? err.message : String(err);
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
    const message = err instanceof Error ? err.message : String(err);
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
    const message = err instanceof Error ? err.message : String(err);
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
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
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
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
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
      .map(accountApiKeyView),
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
  const currentKey = keys.records.find((entry) => entry.id === c.req.param('id') && entry.tenantId === account.primaryTenantId) ?? null;
  if (!currentKey) {
    return c.json({ error: `API key '${c.req.param('id')}' was not found.` }, 404);
  }

  let rotated;
  try {
    rotated = await rotateTenantApiKeyState(currentKey.id);
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
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
  const currentKey = keys.records.find((entry) => entry.id === c.req.param('id') && entry.tenantId === account.primaryTenantId) ?? null;
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
  const currentKey = keys.records.find((entry) => entry.id === c.req.param('id') && entry.tenantId === account.primaryTenantId) ?? null;
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
  const currentKey = keys.records.find((entry) => entry.id === c.req.param('id') && entry.tenantId === account.primaryTenantId) ?? null;
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
  const role = typeof body.role === 'string' ? body.role.trim() as AccountUserRole : null;
  if (!email || !displayName || !password || !role) {
    return c.json({ error: 'email, displayName, password, and role are required.' }, 400);
  }
  if (!['account_admin', 'billing_admin', 'read_only'].includes(role)) {
    return c.json({ error: "role must be one of: account_admin, billing_admin, read_only." }, 400);
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
  const role = typeof body.role === 'string' ? body.role.trim() as AccountUserRole : null;
  const expiresHours = typeof body.expiresHours === 'number' ? body.expiresHours : null;
  if (!email || !displayName || !role) {
    return c.json({ error: 'email, displayName, and role are required.' }, 400);
  }
  if (!['account_admin', 'billing_admin', 'read_only'].includes(role)) {
    return c.json({ error: "role must be one of: account_admin, billing_admin, read_only." }, 400);
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
  const deliveries = await listHostedEmailDeliveriesState({
    accountId: access.accountId,
    purpose: purpose === 'invite' || purpose === 'password_reset' ? purpose : null,
    status: status ? status as any : null,
    provider: provider ? provider as any : null,
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

app.post('/api/v1/email/sendgrid/webhook', async (c) => {
  const webhookStatus = getSendGridWebhookStatus();
  if (!webhookStatus.configured) {
    return c.json({
      error: 'SendGrid event webhook disabled. Set ATTESTOR_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY to enable delivery analytics.',
    }, 503);
  }

  const signature = c.req.header('x-twilio-email-event-webhook-signature')?.trim() ?? '';
  const timestamp = c.req.header('x-twilio-email-event-webhook-timestamp')?.trim() ?? '';
  if (!signature || !timestamp) {
    return c.json({
      error: 'Signed SendGrid webhook requires X-Twilio-Email-Event-Webhook-Signature and X-Twilio-Email-Event-Webhook-Timestamp.',
    }, 400);
  }

  const rawPayload = await c.req.text();
  if (!verifySignedSendGridWebhook({ rawPayload, signature, timestamp })) {
    return c.json({ error: 'SendGrid webhook signature verification failed.' }, 400);
  }

  let events;
  try {
    events = parseSendGridWebhookEvents(rawPayload);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  let applied = 0;
  let duplicate = 0;
  let ignored = 0;
  let conflict = 0;

  for (const event of events) {
    if (!event.deliveryId || !event.email) {
      ignored += 1;
      continue;
    }
    const existing = await listHostedEmailDeliveriesState({
      deliveryId: event.deliveryId,
      limit: 1,
    });
    const delivery = existing.records[0] ?? null;
    const result = await recordHostedEmailProviderEventState({
      deliveryId: event.deliveryId,
      accountId: delivery?.accountId ?? null,
      accountUserId: delivery?.accountUserId ?? null,
      purpose: event.purpose ?? delivery?.purpose ?? null,
      provider: 'sendgrid_smtp',
      channel: 'smtp',
      recipient: event.email,
      messageId: delivery?.messageId ?? null,
      providerMessageId: event.sgMessageId ?? delivery?.providerMessageId ?? null,
      providerEventId: event.sgEventId,
      eventType: `sendgrid.${event.event}`,
      statusHint: sendGridEventTypeToStatusHint(event.event),
      actionUrl: delivery?.actionUrl ?? null,
      tokenReturned: delivery?.tokenReturned ?? false,
      occurredAt: event.timestamp
        ? new Date(event.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      metadata: event.raw,
      rawPayload: event.raw,
    });
    if (result.kind === 'recorded') applied += 1;
    else if (result.kind === 'duplicate') duplicate += 1;
    else conflict += 1;
  }

  return c.json({
    received: true,
    provider: 'sendgrid_smtp',
    eventCount: events.length,
    applied,
    duplicate,
    ignored,
    conflict,
  });
});

app.post('/api/v1/email/mailgun/webhook', async (c) => {
  const webhookStatus = getMailgunWebhookStatus();
  if (!webhookStatus.configured) {
    return c.json({
      error: 'Mailgun event webhook disabled. Set ATTESTOR_MAILGUN_WEBHOOK_SIGNING_KEY to enable delivery analytics.',
    }, 503);
  }

  const rawPayload = await c.req.text();
  let parsed;
  try {
    parsed = parseMailgunWebhookEvent(rawPayload);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  if (!verifySignedMailgunWebhook(parsed.signature)) {
    return c.json({ error: 'Mailgun webhook signature verification failed.' }, 400);
  }

  const event = parsed.event;
  let applied = 0;
  let duplicate = 0;
  let ignored = 0;
  let conflict = 0;

  if (!event.deliveryId || !event.email) {
    ignored += 1;
  } else {
    const existing = await listHostedEmailDeliveriesState({
      deliveryId: event.deliveryId,
      limit: 1,
    });
    const delivery = existing.records[0] ?? null;
    const result = await recordHostedEmailProviderEventState({
      deliveryId: event.deliveryId,
      accountId: delivery?.accountId ?? null,
      accountUserId: delivery?.accountUserId ?? null,
      purpose: event.purpose ?? delivery?.purpose ?? null,
      provider: 'mailgun_smtp',
      channel: 'smtp',
      recipient: event.email,
      messageId: delivery?.messageId ?? null,
      providerMessageId: event.messageId ?? delivery?.providerMessageId ?? null,
      providerEventId: event.eventId,
      eventType: `mailgun.${event.event}`,
      statusHint: mailgunEventTypeToStatusHint(event.event, event.severity),
      actionUrl: delivery?.actionUrl ?? null,
      tokenReturned: delivery?.tokenReturned ?? false,
      occurredAt: event.timestamp
        ? new Date(event.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      metadata: {
        ...event.raw,
        severity: event.severity ?? null,
      },
      rawPayload: event.raw,
    });
    if (result.kind === 'recorded') applied += 1;
    else if (result.kind === 'duplicate') duplicate += 1;
    else conflict += 1;
  }

  return c.json({
    received: true,
    provider: 'mailgun_smtp',
    eventCount: 1,
    applied,
    duplicate,
    ignored,
    conflict,
  });
});

app.post('/api/v1/billing/stripe/webhook', async (c) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return c.json({
      error: 'Stripe webhook disabled. Set STRIPE_WEBHOOK_SECRET to enable billing reconciliation.',
    }, 503);
  }

  const signature = c.req.header('stripe-signature')?.trim() ?? '';
  if (!signature) {
    return c.json({ error: 'Stripe-Signature header is required.' }, 400);
  }

  const rawPayload = await c.req.text();
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(rawPayload, signature, webhookSecret);
  } catch (err) {
    observeBillingWebhookEvent('signature_verification', 'signature_invalid');
    return c.json({
      error: 'Stripe webhook signature verification failed.',
      detail: err instanceof Error ? err.message : String(err),
    }, 400);
  }

  c.header('x-attestor-stripe-event-id', event.id);
  const sharedBillingLedger = isBillingEventLedgerConfigured();
  const sharedControlPlaneWebhookState = !sharedBillingLedger && isSharedControlPlaneConfigured();
  const dedupe = sharedBillingLedger
    ? await claimStripeBillingEvent({
      providerEventId: event.id,
      eventType: event.type,
      rawPayload,
    })
    : sharedControlPlaneWebhookState
      ? await claimProcessedStripeWebhookState({
        eventId: event.id,
        eventType: event.type,
        rawPayload,
      })
    : await lookupProcessedStripeWebhookState(event.id, rawPayload);
  const controlPlaneClaimId = dedupe.kind === 'claimed' && 'claimId' in dedupe ? dedupe.claimId : null;
  if (dedupe.kind === 'conflict') {
    observeBillingWebhookEvent(event.type, 'conflict');
    return c.json({
      error: `Stripe event '${event.id}' was already recorded with a different payload hash.`,
      eventType: dedupe.record.eventType,
      recordedAt: dedupe.record.receivedAt,
    }, 409);
  }
  if (dedupe.kind === 'duplicate') {
    observeBillingWebhookEvent(dedupe.record.eventType, 'duplicate');
    c.header('x-attestor-stripe-replay', 'true');
    return c.json({
      received: true,
      duplicate: true,
      eventId: event.id,
      eventType: dedupe.record.eventType,
      outcome: dedupe.record.outcome,
      accountId: dedupe.record.accountId,
      reason: dedupe.record.reason,
    });
  }

  let finalizedSharedEvent = false;
  let finalizedControlPlaneEvent = false;
  const finalizeWebhookDedupe = async (input: {
    eventType: string;
    accountId: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    outcome: 'applied' | 'ignored';
    reason: string | null;
  }): Promise<void> => {
    if (sharedBillingLedger) return;
    if (sharedControlPlaneWebhookState && controlPlaneClaimId) {
      await finalizeProcessedStripeWebhookState({
        claimId: controlPlaneClaimId,
        eventId: event.id,
        eventType: input.eventType,
        accountId: input.accountId,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        outcome: input.outcome,
        reason: input.reason,
        rawPayload,
      });
      finalizedControlPlaneEvent = true;
      return;
    }
    await recordProcessedStripeWebhookState({
      eventId: event.id,
      eventType: input.eventType,
      accountId: input.accountId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      outcome: input.outcome,
      reason: input.reason,
      rawPayload,
    });
  };
  try {
    const supportedEvent =
      event.type === 'customer.subscription.created'
      || event.type === 'customer.subscription.updated'
      || event.type === 'customer.subscription.deleted'
      || event.type === 'customer.subscription.paused'
      || event.type === 'customer.subscription.resumed'
      || event.type === 'checkout.session.completed'
      || event.type === 'charge.succeeded'
      || event.type === 'charge.failed'
      || event.type === 'charge.refunded'
      || event.type === 'entitlements.active_entitlement_summary.updated'
      || event.type === 'invoice.paid'
      || event.type === 'invoice.payment_failed';

    if (!supportedEvent) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await finalizeStripeBillingEvent({
          providerEventId: event.id,
          outcome: 'ignored',
          reason: 'unsupported_event_type',
          metadata: {
            eventType: event.type,
          },
        });
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
          eventType: event.type,
          accountId: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          outcome: 'ignored',
          reason: 'unsupported_event_type',
        });
      }
      return c.json({
        received: true,
        duplicate: false,
        ignored: true,
        eventId: event.id,
        eventType: event.type,
        reason: 'unsupported_event_type',
      });
    }

    if (event.type.startsWith('customer.subscription.')) {
      const subscription = event.data.object as Stripe.Subscription;
      const stripeCustomerId = stripeReferenceId(subscription.customer);
      const stripeSubscriptionId = stripeReferenceId(subscription.id);
      const stripeSubscriptionStatus =
        typeof subscription.status === 'string'
          ? subscription.status
          : event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : null;
      const stripePriceId = typeof subscription.items?.data?.[0]?.price?.id === 'string'
        ? subscription.items.data[0].price.id
        : null;
      const accountIdFromMetadata = metadataStringValue('attestorAccountId', subscription.metadata);

      let applied;
      try {
      applied = await applyStripeSubscriptionStateState({
          accountId: accountIdFromMetadata,
          stripeCustomerId,
          stripeSubscriptionId,
          stripeSubscriptionStatus,
          stripePriceId,
          eventId: event.id,
          eventType: event.type,
        });
      } catch (err) {
        if (sharedBillingLedger && !finalizedSharedEvent) {
          try {
            await releaseStripeBillingEventClaim(event.id);
          } catch {
            // allow original error mapping to surface
          }
        } else if (sharedControlPlaneWebhookState && controlPlaneClaimId && !finalizedControlPlaneEvent) {
          try {
            await releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
          } catch {
            // allow original error mapping to surface
          }
        }
        const mapped = accountStoreErrorResponse(c, err);
        if (mapped) return mapped;
        throw err;
      }

      if (!applied.record) {
        observeBillingWebhookEvent(event.type, 'ignored');
        if (sharedBillingLedger) {
          await finalizeStripeBillingEvent({
            providerEventId: event.id,
            outcome: 'ignored',
            reason: 'no_account_match',
            stripeCustomerId,
            stripeSubscriptionId,
            stripePriceId,
            billingStatusAfter: stripeSubscriptionStatus,
            metadata: {
              eventType: event.type,
            },
          });
          finalizedSharedEvent = true;
        } else {
          await finalizeWebhookDedupe({
            eventType: event.type,
            accountId: null,
            stripeCustomerId,
            stripeSubscriptionId,
            outcome: 'ignored',
            reason: 'no_account_match',
          });
        }
        return c.json({
          received: true,
          duplicate: false,
          ignored: true,
          eventId: event.id,
          eventType: event.type,
          reason: 'no_account_match',
          stripeCustomerId,
          stripeSubscriptionId,
        });
      }

      const mappedPlan = findHostedPlanByStripePriceId(stripePriceId);
      if (mappedPlan) {
        const resolvedPlan = resolvePlanSpec({
          planId: mappedPlan.id,
          defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
        });
        await syncTenantPlanByTenantIdState(applied.record.primaryTenantId, {
          planId: resolvedPlan.planId,
          monthlyRunQuota: resolvedPlan.monthlyRunQuota,
        });
      }
      const entitlement = await syncHostedBillingEntitlement(applied.record, {
        lastEventId: event.id,
        lastEventType: event.type,
        lastEventAt: unixSecondsToIso(event.created) ?? new Date().toISOString(),
      });
      const revokedSessions = await revokeAccountSessionsForLifecycleChange({
        account: applied.record,
        previousStatus: applied.previousStatus,
        nextStatus: applied.nextStatus,
      });

      c.set('obs.accountId', applied.record.id);
      c.set('obs.accountStatus', applied.record.status);
      c.set('obs.tenantId', applied.record.primaryTenantId);
      c.set('obs.planId', mappedPlan?.id ?? null);

      if (sharedBillingLedger) {
        await finalizeStripeBillingEvent({
          providerEventId: event.id,
          outcome: 'applied',
          accountId: applied.record.id,
          tenantId: applied.record.primaryTenantId,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          accountStatusBefore: applied.previousStatus,
          accountStatusAfter: applied.nextStatus,
          billingStatusBefore: applied.previousBillingStatus,
          billingStatusAfter: applied.nextBillingStatus,
          mappedPlanId: mappedPlan?.id ?? null,
          metadata: {
            eventType: event.type,
            matchReason: applied.matchReason,
            entitlementStatus: entitlement.status,
            entitlementAccessEnabled: entitlement.accessEnabled,
            effectivePlanId: entitlement.effectivePlanId,
            revokedSessionCount: revokedSessions,
          },
        });
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
          eventType: event.type,
          accountId: applied.record.id,
          stripeCustomerId,
          stripeSubscriptionId,
          outcome: 'applied',
          reason: null,
        });
      }

      observeBillingWebhookEvent(event.type, 'applied');

      await appendAdminAuditRecordState({
        actorType: 'stripe_webhook',
        actorLabel: 'stripe.webhooks',
        action: 'billing.stripe.webhook_applied',
        routeId: 'billing.stripe.webhook',
        accountId: applied.record.id,
        tenantId: applied.record.primaryTenantId,
        tenantKeyId: null,
        planId: mappedPlan?.id ?? null,
        monthlyRunQuota: null,
        idempotencyKey: event.id,
        requestHash: dedupe.payloadHash,
        metadata: {
          eventType: event.type,
          matchReason: applied.matchReason,
          stripeCustomerId,
          stripeSubscriptionId,
          stripeSubscriptionStatus,
          stripePriceId,
          mappedPlanId: mappedPlan?.id ?? null,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
          previousAccountStatus: applied.previousStatus,
          nextAccountStatus: applied.nextStatus,
          previousBillingStatus: applied.previousBillingStatus,
          nextBillingStatus: applied.nextBillingStatus,
          revokedSessionCount: revokedSessions,
          sharedLedger: sharedBillingLedger,
        },
      });

      return c.json({
        received: true,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
        accountId: applied.record.id,
        accountStatus: applied.record.status,
        mappedPlanId: mappedPlan?.id ?? null,
        billing: applied.record.billing,
      });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const stripeCheckoutSessionId = stripeReferenceId(session.id);
      const stripeCustomerId = stripeReferenceId(session.customer);
      const stripeSubscriptionId = stripeReferenceId(session.subscription);
      const accountIdFromMetadata = metadataStringValue('attestorAccountId', session.metadata);
      const planIdFromMetadata = metadataStringValue('attestorPlanId', session.metadata);
      const mappedPlan = planIdFromMetadata
        ? getHostedPlan(planIdFromMetadata)
        : null;
      const stripePriceId = mappedPlan ? resolvePlanStripePrice(mappedPlan.id).priceId : null;
      const completedAt = unixSecondsToIso(session.created) ?? new Date().toISOString();

      let applied;
      try {
      applied = await applyStripeCheckoutCompletionState({
          accountId: accountIdFromMetadata,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          planId: mappedPlan?.id ?? planIdFromMetadata,
          checkoutSessionId: stripeCheckoutSessionId ?? `checkout_missing_${event.id}`,
          completedAt,
          eventId: event.id,
          eventType: event.type,
        });
      } catch (err) {
        if (sharedBillingLedger && !finalizedSharedEvent) {
          try {
            await releaseStripeBillingEventClaim(event.id);
          } catch {
            // allow original error mapping to surface
          }
        } else if (sharedControlPlaneWebhookState && controlPlaneClaimId && !finalizedControlPlaneEvent) {
          try {
            await releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
          } catch {
            // allow original error mapping to surface
          }
        }
        const mapped = accountStoreErrorResponse(c, err);
        if (mapped) return mapped;
        throw err;
      }

      if (!applied.record) {
        observeBillingWebhookEvent(event.type, 'ignored');
        if (sharedBillingLedger) {
          await finalizeStripeBillingEvent({
            providerEventId: event.id,
            outcome: 'ignored',
            reason: 'no_account_match',
            stripeCheckoutSessionId,
            stripeCustomerId,
            stripeSubscriptionId,
            stripePriceId,
            mappedPlanId: mappedPlan?.id ?? planIdFromMetadata ?? null,
            metadata: {
              eventType: event.type,
              checkoutMode: session.mode ?? null,
            },
          });
          finalizedSharedEvent = true;
        } else {
          await finalizeWebhookDedupe({
            eventType: event.type,
            accountId: null,
            stripeCustomerId,
            stripeSubscriptionId,
            outcome: 'ignored',
            reason: 'no_account_match',
          });
        }
        return c.json({
          received: true,
          duplicate: false,
          ignored: true,
          eventId: event.id,
          eventType: event.type,
          reason: 'no_account_match',
          stripeCustomerId,
          stripeSubscriptionId,
          checkoutSessionId: stripeCheckoutSessionId,
        });
      }

      if (mappedPlan) {
        const resolvedPlan = resolvePlanSpec({
          planId: mappedPlan.id,
          defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
        });
        await syncTenantPlanByTenantIdState(applied.record.primaryTenantId, {
          planId: resolvedPlan.planId,
          monthlyRunQuota: resolvedPlan.monthlyRunQuota,
        });
      }
      const entitlement = await syncHostedBillingEntitlement(applied.record, {
        lastEventId: event.id,
        lastEventType: event.type,
        lastEventAt: completedAt,
      });

      c.set('obs.accountId', applied.record.id);
      c.set('obs.accountStatus', applied.record.status);
      c.set('obs.tenantId', applied.record.primaryTenantId);
      c.set('obs.planId', mappedPlan?.id ?? planIdFromMetadata ?? null);

      if (sharedBillingLedger) {
        await finalizeStripeBillingEvent({
          providerEventId: event.id,
          outcome: 'applied',
          accountId: applied.record.id,
          tenantId: applied.record.primaryTenantId,
          stripeCheckoutSessionId,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          accountStatusBefore: applied.previousStatus,
          accountStatusAfter: applied.nextStatus,
          billingStatusBefore: applied.previousBillingStatus,
          billingStatusAfter: applied.nextBillingStatus,
          mappedPlanId: mappedPlan?.id ?? planIdFromMetadata ?? null,
          metadata: {
            eventType: event.type,
            matchReason: applied.matchReason,
            completedAt,
            checkoutMode: session.mode ?? null,
            entitlementStatus: entitlement.status,
            entitlementAccessEnabled: entitlement.accessEnabled,
            effectivePlanId: entitlement.effectivePlanId,
          },
        });
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
          eventType: event.type,
          accountId: applied.record.id,
          stripeCustomerId,
          stripeSubscriptionId,
          outcome: 'applied',
          reason: null,
        });
      }

      observeBillingWebhookEvent(event.type, 'applied');

      await appendAdminAuditRecordState({
        actorType: 'stripe_webhook',
        actorLabel: 'stripe.webhooks',
        action: 'billing.stripe.webhook_applied',
        routeId: 'billing.stripe.webhook',
        accountId: applied.record.id,
        tenantId: applied.record.primaryTenantId,
        tenantKeyId: null,
        planId: mappedPlan?.id ?? planIdFromMetadata ?? null,
        monthlyRunQuota: null,
        idempotencyKey: event.id,
        requestHash: dedupe.payloadHash,
        metadata: {
          eventType: event.type,
          matchReason: applied.matchReason,
          stripeCheckoutSessionId,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          completedAt,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
          sharedLedger: sharedBillingLedger,
        },
      });

      return c.json({
        received: true,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
        accountId: applied.record.id,
        accountStatus: applied.record.status,
        mappedPlanId: mappedPlan?.id ?? planIdFromMetadata ?? null,
        billing: applied.record.billing,
      });
    }

    if (event.type === 'charge.succeeded' || event.type === 'charge.failed' || event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const stripeChargeId = stripeReferenceId(charge.id);
      const stripeCustomerId = stripeReferenceId(charge.customer);
      const stripeInvoiceId = stripeReferenceId((charge as { invoice?: unknown }).invoice);
      const accountIdFromMetadata = metadataStringValue('attestorAccountId', charge.metadata);
      const matched = await findHostedAccountByStripeRefs({
        accountId: accountIdFromMetadata,
        stripeCustomerId,
        stripeSubscriptionId: null,
      });
      const account = matched.record;
      const chargeCreatedAt = unixSecondsToIso(charge.created) ?? new Date().toISOString();

      if (sharedBillingLedger && stripeChargeId) {
        await upsertStripeCharges({
          accountId: account?.id ?? null,
          tenantId: account?.primaryTenantId ?? null,
          stripeCustomerId,
          stripeSubscriptionId: account?.billing.stripeSubscriptionId ?? null,
          charges: [{
            stripeChargeId,
            stripeInvoiceId,
            stripePaymentIntentId: stripeReferenceId(charge.payment_intent),
            amount: typeof charge.amount === 'number' ? charge.amount : null,
            amountRefunded: typeof charge.amount_refunded === 'number' ? charge.amount_refunded : null,
            currency: typeof charge.currency === 'string' ? charge.currency : null,
            status: parseStripeChargeStatus(charge.status),
            paid: typeof charge.paid === 'boolean' ? charge.paid : null,
            refunded: typeof charge.refunded === 'boolean' ? charge.refunded : null,
            failureCode: typeof charge.failure_code === 'string' ? charge.failure_code : null,
            failureMessage: typeof charge.failure_message === 'string' ? charge.failure_message : null,
            metadata: {
              eventType: event.type,
            },
            createdAt: chargeCreatedAt,
          }],
          source: 'stripe_webhook',
        });
      }

      if (!account) {
        observeBillingWebhookEvent(event.type, 'ignored');
        if (sharedBillingLedger) {
          await finalizeStripeBillingEvent({
            providerEventId: event.id,
            outcome: 'ignored',
            reason: 'no_account_match',
            stripeCustomerId,
            stripeSubscriptionId: null,
            stripeInvoiceId,
            metadata: {
              eventType: event.type,
              stripeChargeId,
              chargeStatus: parseStripeChargeStatus(charge.status),
              chargeCreatedAt,
            },
          });
          finalizedSharedEvent = true;
        } else {
          await finalizeWebhookDedupe({
            eventType: event.type,
            accountId: null,
            stripeCustomerId,
            stripeSubscriptionId: null,
            outcome: 'ignored',
            reason: 'no_account_match',
          });
        }
        return c.json({
          received: true,
          duplicate: false,
          ignored: true,
          eventId: event.id,
          eventType: event.type,
          reason: 'no_account_match',
          stripeCustomerId,
          stripeChargeId,
          invoiceId: stripeInvoiceId,
        });
      }

      const entitlement = await syncHostedBillingEntitlement(account, {
        lastEventId: event.id,
        lastEventType: event.type,
        lastEventAt: chargeCreatedAt,
      });

      c.set('obs.accountId', account.id);
      c.set('obs.accountStatus', account.status);
      c.set('obs.tenantId', account.primaryTenantId);
      c.set('obs.planId', account.billing.lastCheckoutPlanId ?? entitlement.effectivePlanId ?? null);

      if (sharedBillingLedger) {
        await finalizeStripeBillingEvent({
          providerEventId: event.id,
          outcome: 'applied',
          accountId: account.id,
          tenantId: account.primaryTenantId,
          stripeCustomerId,
          stripeSubscriptionId: account.billing.stripeSubscriptionId,
          stripePriceId: account.billing.stripePriceId,
          stripeInvoiceId,
          metadata: {
            eventType: event.type,
            matchReason: matched.matchReason,
            stripeChargeId,
            chargeStatus: parseStripeChargeStatus(charge.status),
            chargeCreatedAt,
            entitlementStatus: entitlement.status,
            entitlementAccessEnabled: entitlement.accessEnabled,
            effectivePlanId: entitlement.effectivePlanId,
          },
        });
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
          eventType: event.type,
          accountId: account.id,
          stripeCustomerId,
          stripeSubscriptionId: account.billing.stripeSubscriptionId,
          outcome: 'applied',
          reason: null,
        });
      }

      observeBillingWebhookEvent(event.type, 'applied');

      await appendAdminAuditRecordState({
        actorType: 'stripe_webhook',
        actorLabel: 'stripe.webhooks',
        action: 'billing.stripe.webhook_applied',
        routeId: 'billing.stripe.webhook',
        accountId: account.id,
        tenantId: account.primaryTenantId,
        tenantKeyId: null,
        planId: account.billing.lastCheckoutPlanId ?? entitlement.effectivePlanId ?? null,
        monthlyRunQuota: null,
        idempotencyKey: event.id,
        requestHash: dedupe.payloadHash,
        metadata: {
          eventType: event.type,
          matchReason: matched.matchReason,
          stripeChargeId,
          stripeCustomerId,
          stripeInvoiceId,
          chargeStatus: parseStripeChargeStatus(charge.status),
          chargeCreatedAt,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
          sharedLedger: sharedBillingLedger,
        },
      });

      return c.json({
        received: true,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
        accountId: account.id,
        accountStatus: account.status,
        chargeId: stripeChargeId,
        invoiceId: stripeInvoiceId,
      });
    }

    if (event.type === 'entitlements.active_entitlement_summary.updated') {
      const summary = event.data.object as Stripe.Entitlements.ActiveEntitlementSummary;
      const stripeCustomerId = stripeReferenceId((summary as { customer?: unknown }).customer);
      const matched = await findHostedAccountByStripeRefs({
        accountId: null,
        stripeCustomerId,
        stripeSubscriptionId: null,
      });
      const account = matched.record;
      const summaryUpdatedAt = unixSecondsToIso(event.created) ?? new Date().toISOString();
      const canFetchCanonicalEntitlements = process.env.ATTESTOR_STRIPE_USE_MOCK !== 'true'
        && Boolean(process.env.STRIPE_API_KEY?.trim())
        && Boolean(stripeCustomerId);
      const summaryEntitlements = extractActiveEntitlementsFromSummary(summary);
      const canonicalEntitlements = canFetchCanonicalEntitlements && stripeCustomerId
        ? await listHostedStripeActiveEntitlements({
          customerId: stripeCustomerId,
          limit: 5_000,
        })
        : [];
      const entitlementRecords = canonicalEntitlements.length > 0 ? canonicalEntitlements : summaryEntitlements;
      const lookupKeys = [...new Set(entitlementRecords.map((record) => record.lookupKey).filter((value) => value.trim() !== ''))].sort();
      const featureIds = [...new Set(entitlementRecords.map((record) => record.featureId ?? '').filter((value) => value.trim() !== ''))].sort();

      if (!account) {
        observeBillingWebhookEvent(event.type, 'ignored');
        if (sharedBillingLedger) {
          await finalizeStripeBillingEvent({
            providerEventId: event.id,
            outcome: 'ignored',
            reason: 'no_account_match',
            stripeCustomerId,
            stripeSubscriptionId: null,
            metadata: {
              eventType: event.type,
              entitlementLookupKeyCount: lookupKeys.length,
              entitlementFeatureIdCount: featureIds.length,
              entitlementSummaryUpdatedAt: summaryUpdatedAt,
            },
          });
          finalizedSharedEvent = true;
        } else {
          await finalizeWebhookDedupe({
            eventType: event.type,
            accountId: null,
            stripeCustomerId,
            stripeSubscriptionId: null,
            outcome: 'ignored',
            reason: 'no_account_match',
          });
        }
        return c.json({
          received: true,
          duplicate: false,
          ignored: true,
          eventId: event.id,
          eventType: event.type,
          reason: 'no_account_match',
          stripeCustomerId,
        });
      }

      const entitlement = await syncHostedBillingEntitlement(account, {
        lastEventId: event.id,
        lastEventType: event.type,
        lastEventAt: summaryUpdatedAt,
        stripeEntitlementLookupKeys: lookupKeys,
        stripeEntitlementFeatureIds: featureIds,
        stripeEntitlementSummaryUpdatedAt: summaryUpdatedAt,
      });

      c.set('obs.accountId', account.id);
      c.set('obs.accountStatus', account.status);
      c.set('obs.tenantId', account.primaryTenantId);
      c.set('obs.planId', account.billing.lastCheckoutPlanId ?? entitlement.effectivePlanId ?? null);

      if (sharedBillingLedger) {
        await finalizeStripeBillingEvent({
          providerEventId: event.id,
          outcome: 'applied',
          accountId: account.id,
          tenantId: account.primaryTenantId,
          stripeCustomerId,
          stripeSubscriptionId: account.billing.stripeSubscriptionId,
          stripePriceId: account.billing.stripePriceId,
          metadata: {
            eventType: event.type,
            matchReason: matched.matchReason,
            entitlementLookupKeys: lookupKeys,
            entitlementFeatureIds: featureIds,
            entitlementSummaryUpdatedAt: summaryUpdatedAt,
            entitlementStatus: entitlement.status,
            entitlementAccessEnabled: entitlement.accessEnabled,
            effectivePlanId: entitlement.effectivePlanId,
          },
        });
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
          eventType: event.type,
          accountId: account.id,
          stripeCustomerId,
          stripeSubscriptionId: account.billing.stripeSubscriptionId,
          outcome: 'applied',
          reason: null,
        });
      }

      observeBillingWebhookEvent(event.type, 'applied');

      await appendAdminAuditRecordState({
        actorType: 'stripe_webhook',
        actorLabel: 'stripe.webhooks',
        action: 'billing.stripe.webhook_applied',
        routeId: 'billing.stripe.webhook',
        accountId: account.id,
        tenantId: account.primaryTenantId,
        tenantKeyId: null,
        planId: account.billing.lastCheckoutPlanId ?? entitlement.effectivePlanId ?? null,
        monthlyRunQuota: null,
        idempotencyKey: event.id,
        requestHash: dedupe.payloadHash,
        metadata: {
          eventType: event.type,
          matchReason: matched.matchReason,
          stripeCustomerId,
          entitlementLookupKeys: lookupKeys,
          entitlementFeatureIds: featureIds,
          entitlementSummaryUpdatedAt: summaryUpdatedAt,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
          sharedLedger: sharedBillingLedger,
        },
      });

      return c.json({
        received: true,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
        accountId: account.id,
        accountStatus: account.status,
        entitlement: billingEntitlementView(entitlement),
      });
    }

    const invoice = event.data.object as Stripe.Invoice & {
      subscription?: unknown;
      subscription_details?: { metadata?: Record<string, unknown> | null } | null;
    };
    const stripeCustomerId = stripeReferenceId(invoice.customer);
    const stripeSubscriptionId = stripeReferenceId(invoice.subscription);
    const stripePriceId = stripeInvoicePriceId(invoice);
    const stripeInvoiceId = stripeReferenceId(invoice.id);
    const stripeInvoiceStatus = parseStripeInvoiceStatus(
      typeof invoice.status === 'string'
        ? invoice.status
        : event.type === 'invoice.paid'
          ? 'paid'
          : null,
    );
    const stripeInvoiceCurrency = typeof invoice.currency === 'string' ? invoice.currency : null;
    const accountIdFromMetadata = metadataStringValue(
      'attestorAccountId',
      invoice.metadata,
      invoice.subscription_details?.metadata ?? null,
    );
    const extractedInvoiceLineItems = extractInvoiceLineItemSnapshotsFromInvoice(invoice);

    let applied;
    try {
      applied = await applyStripeInvoiceStateState({
        accountId: accountIdFromMetadata,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        invoiceId: stripeInvoiceId ?? `invoice_missing_${event.id}`,
        invoiceStatus: stripeInvoiceStatus,
        currency: stripeInvoiceCurrency,
        amountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
        amountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
        paidAt: unixSecondsToIso((invoice.status_transitions as { paid_at?: unknown } | null | undefined)?.paid_at),
        paymentFailedAt: event.type === 'invoice.payment_failed'
          ? (unixSecondsToIso(event.created) ?? new Date().toISOString())
          : null,
        eventId: event.id,
        eventType: event.type,
      });
    } catch (err) {
      if (sharedBillingLedger && !finalizedSharedEvent) {
        try {
          await releaseStripeBillingEventClaim(event.id);
        } catch {
          // allow original error mapping to surface
        }
      } else if (sharedControlPlaneWebhookState && controlPlaneClaimId && !finalizedControlPlaneEvent) {
        try {
          await releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
        } catch {
          // allow original error mapping to surface
        }
      }
      const mapped = accountStoreErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }

    if (!applied.record) {
      observeBillingWebhookEvent(event.type, 'ignored');
      if (sharedBillingLedger) {
        await finalizeStripeBillingEvent({
          providerEventId: event.id,
          outcome: 'ignored',
          reason: 'no_account_match',
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          stripeInvoiceId,
          stripeInvoiceStatus,
          stripeInvoiceCurrency,
          stripeInvoiceAmountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
          stripeInvoiceAmountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
          metadata: {
            eventType: event.type,
            billingReason: invoice.billing_reason ?? null,
          },
        });
        finalizedSharedEvent = true;
      } else {
        await finalizeWebhookDedupe({
          eventType: event.type,
          accountId: null,
          stripeCustomerId,
          stripeSubscriptionId,
          outcome: 'ignored',
          reason: 'no_account_match',
        });
      }
      return c.json({
        received: true,
        duplicate: false,
        ignored: true,
        eventId: event.id,
        eventType: event.type,
        reason: 'no_account_match',
        stripeCustomerId,
        stripeSubscriptionId,
        invoiceId: stripeInvoiceId,
      });
    }

    const mappedPlan = findHostedPlanByStripePriceId(stripePriceId);
    if (mappedPlan) {
      const resolvedPlan = resolvePlanSpec({
        planId: mappedPlan.id,
        defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
      });
      await syncTenantPlanByTenantIdState(applied.record.primaryTenantId, {
        planId: resolvedPlan.planId,
        monthlyRunQuota: resolvedPlan.monthlyRunQuota,
      });
    }

    let persistedInvoiceLineItemCount = 0;
    let persistedInvoiceLineItemCaptureMode: 'full' | 'partial' | null = null;
    if (sharedBillingLedger && stripeInvoiceId) {
      let lineItemsToPersist = extractedInvoiceLineItems.lineItems.map((lineItem) => ({
        stripeInvoiceLineItemId: lineItem.lineItemId,
        stripePriceId: lineItem.priceId,
        description: lineItem.description,
        currency: lineItem.currency,
        amount: lineItem.amount,
        subtotal: lineItem.subtotal,
        quantity: lineItem.quantity,
        periodStart: lineItem.periodStart,
        periodEnd: lineItem.periodEnd,
        proration: lineItem.proration,
        metadata: {},
      }));
      let captureMode: 'full' | 'partial' = extractedInvoiceLineItems.hasMore ? 'partial' : 'full';
      let source: 'stripe_webhook' | 'stripe_live_fetch' = 'stripe_webhook';
      const canFetchCanonicalLineItems = process.env.ATTESTOR_STRIPE_USE_MOCK !== 'true'
        && Boolean(process.env.STRIPE_API_KEY?.trim());
      if (canFetchCanonicalLineItems) {
        const canonicalLineItems = await listHostedStripeInvoiceLineItems({ invoiceId: stripeInvoiceId, limit: 5_000 });
        if (canonicalLineItems.length > 0) {
          lineItemsToPersist = canonicalLineItems.map((lineItem) => ({
            stripeInvoiceLineItemId: lineItem.lineItemId,
            stripePriceId: lineItem.priceId,
            description: lineItem.description,
            currency: lineItem.currency,
            amount: lineItem.amount,
            subtotal: lineItem.subtotal,
            quantity: lineItem.quantity,
            periodStart: lineItem.periodStart,
            periodEnd: lineItem.periodEnd,
            proration: lineItem.proration,
            metadata: {},
          }));
          captureMode = 'full';
          source = 'stripe_live_fetch';
        }
      }
      if (lineItemsToPersist.length > 0) {
        const persistedLineItems = await upsertStripeInvoiceLineItems({
          accountId: applied.record.id,
          tenantId: applied.record.primaryTenantId,
          stripeCustomerId,
          stripeSubscriptionId,
          stripeInvoiceId,
          lineItems: lineItemsToPersist,
          source,
          captureMode,
          replaceExisting: captureMode === 'full',
        });
        persistedInvoiceLineItemCount = persistedLineItems.recordCount;
        persistedInvoiceLineItemCaptureMode = captureMode;
      }
    }

    const entitlement = await syncHostedBillingEntitlement(applied.record, {
      lastEventId: event.id,
      lastEventType: event.type,
      lastEventAt: unixSecondsToIso(event.created) ?? new Date().toISOString(),
    });
    const revokedSessions = await revokeAccountSessionsForLifecycleChange({
      account: applied.record,
      previousStatus: applied.previousStatus,
      nextStatus: applied.nextStatus,
    });

    c.set('obs.accountId', applied.record.id);
    c.set('obs.accountStatus', applied.record.status);
    c.set('obs.tenantId', applied.record.primaryTenantId);
    c.set('obs.planId', mappedPlan?.id ?? null);

    if (sharedBillingLedger) {
      await finalizeStripeBillingEvent({
        providerEventId: event.id,
        outcome: 'applied',
        accountId: applied.record.id,
        tenantId: applied.record.primaryTenantId,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        stripeInvoiceId,
        stripeInvoiceStatus,
        stripeInvoiceCurrency,
        stripeInvoiceAmountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
        stripeInvoiceAmountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
        accountStatusBefore: applied.previousStatus,
        accountStatusAfter: applied.nextStatus,
        billingStatusBefore: applied.previousBillingStatus,
        billingStatusAfter: applied.nextBillingStatus,
        mappedPlanId: mappedPlan?.id ?? null,
        metadata: {
          eventType: event.type,
          matchReason: applied.matchReason,
          billingReason: invoice.billing_reason ?? null,
          entitlementStatus: entitlement.status,
          entitlementAccessEnabled: entitlement.accessEnabled,
          effectivePlanId: entitlement.effectivePlanId,
          revokedSessionCount: revokedSessions,
          invoiceLineItemCount: persistedInvoiceLineItemCount,
          invoiceLineItemCaptureMode: persistedInvoiceLineItemCaptureMode,
        },
      });
      finalizedSharedEvent = true;
    } else {
      await finalizeWebhookDedupe({
        eventType: event.type,
        accountId: applied.record.id,
        stripeCustomerId,
        stripeSubscriptionId,
        outcome: 'applied',
        reason: null,
      });
    }

    observeBillingWebhookEvent(event.type, 'applied');

    await appendAdminAuditRecordState({
      actorType: 'stripe_webhook',
      actorLabel: 'stripe.webhooks',
      action: 'billing.stripe.webhook_applied',
      routeId: 'billing.stripe.webhook',
      accountId: applied.record.id,
      tenantId: applied.record.primaryTenantId,
      tenantKeyId: null,
      planId: mappedPlan?.id ?? null,
      monthlyRunQuota: null,
      idempotencyKey: event.id,
      requestHash: dedupe.payloadHash,
      metadata: {
        eventType: event.type,
        matchReason: applied.matchReason,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        stripeInvoiceId,
        stripeInvoiceStatus,
        stripeInvoiceCurrency,
        invoiceAmountPaid: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
        invoiceAmountDue: typeof invoice.amount_due === 'number' ? invoice.amount_due : null,
        billingReason: invoice.billing_reason ?? null,
        entitlementStatus: entitlement.status,
        entitlementAccessEnabled: entitlement.accessEnabled,
        effectivePlanId: entitlement.effectivePlanId,
        previousAccountStatus: applied.previousStatus,
        nextAccountStatus: applied.nextStatus,
        previousBillingStatus: applied.previousBillingStatus,
        nextBillingStatus: applied.nextBillingStatus,
        revokedSessionCount: revokedSessions,
        sharedLedger: sharedBillingLedger,
        invoiceLineItemCount: persistedInvoiceLineItemCount,
        invoiceLineItemCaptureMode: persistedInvoiceLineItemCaptureMode,
      },
    });

    return c.json({
      received: true,
      duplicate: false,
      eventId: event.id,
      eventType: event.type,
      accountId: applied.record.id,
      accountStatus: applied.record.status,
      mappedPlanId: mappedPlan?.id ?? null,
      billing: applied.record.billing,
    });
  } catch (err) {
    if (sharedBillingLedger && !finalizedSharedEvent) {
      try {
        await releaseStripeBillingEventClaim(event.id);
      } catch {
        // allow original failure to surface
      }
    } else if (sharedControlPlaneWebhookState && controlPlaneClaimId && !finalizedControlPlaneEvent) {
      try {
        await releaseProcessedStripeWebhookClaimState(event.id, controlPlaneClaimId);
      } catch {
        // allow original failure to surface
      }
    }
    throw err;
  }
});

app.get('/api/v1/admin/tenant-keys', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const { records } = await listTenantKeyRecordsState();
  return c.json({
    keys: records.map(adminTenantKeyView),
    defaults: {
      maxActiveKeysPerTenant: tenantKeyStorePolicy().maxActiveKeysPerTenant,
    },
  });
});

app.get('/api/v1/admin/accounts', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const { records } = await listHostedAccountsState();
  return c.json({
    accounts: records.map(adminAccountView),
  });
});

app.get('/api/v1/admin/accounts/:id/billing/export', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const account = await findHostedAccountByIdState(c.req.param('id'));
  if (!account) {
    return c.json({ error: `Hosted account '${c.req.param('id')}' not found.` }, 404);
  }

  c.set('obs.accountId', account.id);
  c.set('obs.accountStatus', account.status);
  c.set('obs.tenantId', account.primaryTenantId);
  c.set('obs.planId', account.billing.lastCheckoutPlanId ?? null);

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

  const entitlement = await readHostedBillingEntitlement(account);
  const payload = await buildHostedBillingExport({
    account,
    entitlement,
    limit: parsedLimit ?? undefined,
  });
  const reconciliation = buildHostedBillingReconciliation(payload);

  if (format === 'csv') {
    c.header('content-type', 'text/csv; charset=utf-8');
    c.header('cache-control', 'no-store');
    c.header('content-disposition', `attachment; filename="${account.id}-billing-export.csv"`);
    return c.body(renderHostedBillingExportCsv(payload));
  }

  return c.json({
    ...payload,
    entitlement: billingEntitlementView(entitlement),
    reconciliation,
  });
});

app.get('/api/v1/admin/accounts/:id/features', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const accountId = c.req.param('id');
  const account = await findHostedAccountByIdState(accountId);
  if (!account) {
    return c.json({ error: `Hosted account '${accountId}' was not found.` }, 404);
  }
  const entitlement = await readHostedBillingEntitlement(account);
  return c.json(buildHostedFeatureServiceView(entitlement));
});

app.get('/api/v1/admin/accounts/:id/billing/reconciliation', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const account = await findHostedAccountByIdState(c.req.param('id'));
  if (!account) {
    return c.json({ error: `Hosted account '${c.req.param('id')}' not found.` }, 404);
  }

  c.set('obs.accountId', account.id);
  c.set('obs.accountStatus', account.status);
  c.set('obs.tenantId', account.primaryTenantId);
  c.set('obs.planId', account.billing.lastCheckoutPlanId ?? null);

  const rawLimit = c.req.query('limit');
  const parsedLimit = rawLimit === undefined
    ? null
    : Number.parseInt(rawLimit, 10);
  if (rawLimit !== undefined && (parsedLimit === null || !Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
    return c.json({ error: 'limit must be a positive integer.' }, 400);
  }

  const entitlement = await readHostedBillingEntitlement(account);
  const payload = await buildHostedBillingExport({
    account,
    entitlement,
    limit: parsedLimit ?? undefined,
  });
  const reconciliation = buildHostedBillingReconciliation(payload);

  return c.json({
    accountId: account.id,
    tenantId: account.primaryTenantId,
    stripeCustomerId: account.billing.stripeCustomerId,
    stripeSubscriptionId: account.billing.stripeSubscriptionId,
    entitlement: billingEntitlementView(entitlement),
    reconciliation,
  });
});

app.get('/api/v1/admin/plans', (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const asyncExecutionCoordinator = getTenantAsyncExecutionCoordinatorStatus();
  const asyncWeightedDispatchCoordinator = getTenantAsyncWeightedDispatchCoordinatorStatus();
  return c.json({
    plans: adminPlanView(),
    defaults: {
      hostedProvisioningPlanId: DEFAULT_HOSTED_PLAN_ID,
      maxActiveKeysPerTenant: tenantKeyStorePolicy().maxActiveKeysPerTenant,
      rateLimitWindowSeconds: defaultRateLimitWindowSeconds(),
      asyncExecutionShared: asyncExecutionCoordinator.shared,
      asyncExecutionBackend: asyncExecutionCoordinator.backend,
      asyncWeightedDispatchShared: asyncWeightedDispatchCoordinator.shared,
      asyncWeightedDispatchBackend: asyncWeightedDispatchCoordinator.backend,
    },
  });
});

app.get('/api/v1/admin/audit', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const action = c.req.query('action')?.trim() as AdminAuditAction | undefined;
  const tenantId = c.req.query('tenantId')?.trim() || null;
  const accountId = c.req.query('accountId')?.trim() || null;
  const limitRaw = c.req.query('limit')?.trim() || '';
  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

  const result = await listAdminAuditRecordsState({
    action: action ?? null,
    tenantId,
    accountId,
    limit,
  });

  return c.json({
    records: result.records.map(adminAuditView),
    summary: {
      actionFilter: action ?? null,
      tenantFilter: tenantId,
      accountFilter: accountId,
      recordCount: result.records.length,
      chainIntact: result.chainIntact,
      latestHash: result.latestHash,
    },
  });
});

app.get('/api/v1/admin/billing/events', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  if (!isBillingEventLedgerConfigured()) {
    return c.json({
      error: 'Billing event ledger disabled. Set ATTESTOR_BILLING_LEDGER_PG_URL to enable shared billing event storage.',
    }, 503);
  }

  const provider = c.req.query('provider')?.trim() as 'stripe' | undefined;
  const accountId = c.req.query('accountId')?.trim() || null;
  const tenantId = c.req.query('tenantId')?.trim() || null;
  const eventType = c.req.query('eventType')?.trim() || null;
  const outcome = c.req.query('outcome')?.trim() as 'applied' | 'ignored' | undefined;
  const limitRaw = c.req.query('limit')?.trim() || '';
  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

  const records = await listBillingEvents({
    provider: provider ?? null,
    accountId,
    tenantId,
    eventType,
    outcome: outcome ?? null,
    limit,
  });

  return c.json({
    records: records.map(billingEventView),
    summary: {
      providerFilter: provider ?? null,
      accountFilter: accountId,
      tenantFilter: tenantId,
      eventTypeFilter: eventType,
      outcomeFilter: outcome ?? null,
      recordCount: records.length,
      appliedCount: records.filter((record) => record.outcome === 'applied').length,
      ignoredCount: records.filter((record) => record.outcome === 'ignored').length,
      pendingCount: records.filter((record) => record.outcome === 'pending').length,
    },
  });
});

app.get('/api/v1/admin/billing/entitlements', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const accountId = c.req.query('accountId')?.trim() || null;
  const tenantId = c.req.query('tenantId')?.trim() || null;
  const statusValue = c.req.query('status')?.trim() || null;
  const allowedStatuses = new Set<HostedBillingEntitlementStatus>([
    'provisioned',
    'checkout_completed',
    'active',
    'trialing',
    'delinquent',
    'suspended',
    'archived',
  ]);
  const status = statusValue && allowedStatuses.has(statusValue as HostedBillingEntitlementStatus)
    ? statusValue as HostedBillingEntitlementStatus
    : null;
  if (statusValue && !status) {
    return c.json({ error: 'status filter is invalid.' }, 400);
  }

  const limitRaw = c.req.query('limit')?.trim() || '';
  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

  const result = await listHostedBillingEntitlementsState({
    accountId,
    tenantId,
    status,
    limit,
  });

  return c.json({
    records: result.records.map(billingEntitlementView),
    summary: {
      accountFilter: accountId,
      tenantFilter: tenantId,
      statusFilter: status,
      recordCount: result.records.length,
      accessEnabledCount: result.records.filter((entry) => entry.accessEnabled).length,
      providerCounts: {
        manual: result.records.filter((entry) => entry.provider === 'manual').length,
        stripe: result.records.filter((entry) => entry.provider === 'stripe').length,
      },
    },
  });
});

app.get('/api/v1/admin/metrics', (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  return c.body(renderPrometheusMetrics('0.1.0'), 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'cache-control': 'no-store',
  });
});

app.get('/api/v1/metrics', (c) => {
  const unauthorized = currentMetricsAuthorized(c);
  if (unauthorized) return unauthorized;

  return c.body(renderPrometheusMetrics('0.1.0'), 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'cache-control': 'no-store',
  });
});

app.get('/api/v1/admin/telemetry', (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;
  return c.json({
    telemetry: getTelemetryStatus(),
    emailDelivery: getHostedEmailDeliveryStatus(),
    secretEnvelope: getSecretEnvelopeStatus(),
  });
});

app.get('/api/v1/admin/email/deliveries', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;
  const purpose = c.req.query('purpose')?.trim();
  const status = c.req.query('status')?.trim();
  const provider = c.req.query('provider')?.trim();
  const recipient = c.req.query('recipient')?.trim();
  const accountId = c.req.query('accountId')?.trim();
  const limitRaw = c.req.query('limit')?.trim();
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const deliveries = await listHostedEmailDeliveriesState({
    accountId: accountId || null,
    purpose: purpose === 'invite' || purpose === 'password_reset' ? purpose : null,
    status: status ? status as any : null,
    provider: provider ? provider as any : null,
    recipient: recipient || null,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return c.json({
    records: deliveries.records,
    summary: {
      accountFilter: accountId ?? null,
      purposeFilter: purpose ?? null,
      statusFilter: status ?? null,
      providerFilter: provider ?? null,
      recipientFilter: recipient ?? null,
      recordCount: deliveries.records.length,
    },
  });
});

app.get('/api/v1/admin/queue', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const tenantId = c.req.query('tenantId')?.trim() || null;
  const planId = c.req.query('planId')?.trim() || null;

  if (asyncBackendMode === 'bullmq' && bullmqQueue) {
    const summary = await getAsyncQueueSummary(bullmqQueue, tenantId, planId);
    return c.json({
      backendMode: 'bullmq',
      queueName: summary.queueName,
      counts: summary.counts,
      retryPolicy: summary.retryPolicy,
      tenant: summary.tenant,
    });
  }

  const retryPolicy = getAsyncRetryPolicy();
  return c.json({
    backendMode: 'in_process',
    queueName: null,
    counts: {
      waiting: Array.from(inProcessJobs.values()).filter((job) => job.status === 'queued').length,
      active: Array.from(inProcessJobs.values()).filter((job) => job.status === 'running').length,
      delayed: 0,
      prioritized: 0,
      completed: Array.from(inProcessJobs.values()).filter((job) => job.status === 'completed').length,
      failed: Array.from(inProcessJobs.values()).filter((job) => job.status === 'failed').length,
      paused: 0,
    },
    retryPolicy: {
      ...retryPolicy,
      attempts: 1,
      backoffMs: 0,
      maxStalledCount: 0,
    },
    tenant: tenantId ? inProcessTenantQueueSnapshot(tenantId, planId) : null,
  });
});

app.get('/api/v1/admin/queue/dlq', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const tenantId = c.req.query('tenantId')?.trim() || null;
  const limitRaw = c.req.query('limit')?.trim() || '';
  const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 25;

  if (asyncBackendMode === 'bullmq' && bullmqQueue) {
    const persisted = await listAsyncDeadLetterRecordsState({ tenantId, backendMode: 'bullmq', limit });
    const live = persisted.records.length < limit
      ? await listFailedPipelineJobs(bullmqQueue, { tenantId, limit: limit * 2 })
      : [];
    const merged = new Map<string, AsyncDeadLetterRecord>();
    for (const record of persisted.records) merged.set(record.jobId, record);
    for (const record of live) {
      if (merged.size >= limit && merged.has(record.jobId)) continue;
      if (!merged.has(record.jobId)) merged.set(record.jobId, record);
      if (merged.size >= limit) break;
    }
    const records = [...merged.values()].slice(0, limit);
    return c.json({
      records,
      summary: {
        backendMode: 'bullmq',
        tenantFilter: tenantId,
        limit,
        recordCount: records.length,
      },
    });
  }

  const persisted = await listAsyncDeadLetterRecordsState({ tenantId, backendMode: 'in_process', limit });
  const live = Array.from(inProcessJobs.values())
    .filter((job) => job.status === 'failed')
    .filter((job) => !tenantId || job.tenantId === tenantId)
    .slice(0, limit)
    .map((job) => ({
      jobId: job.id,
      name: 'pipeline-run',
      backendMode: 'in_process' as const,
      tenantId: job.tenantId,
      planId: job.planId,
      state: 'failed',
      failedReason: job.error,
      attemptsMade: 0,
      maxAttempts: 1,
      requestedAt: job.submittedAt,
      submittedAt: job.submittedAt,
      processedAt: null,
      failedAt: job.completedAt,
      recordedAt: job.completedAt ?? job.submittedAt,
    }));
  const merged = new Map<string, AsyncDeadLetterRecord>();
  for (const record of persisted.records) merged.set(record.jobId, record);
  for (const record of live) {
    if (!merged.has(record.jobId)) merged.set(record.jobId, record);
    if (merged.size >= limit) break;
  }
  const records = [...merged.values()].slice(0, limit);

  return c.json({
    records,
    summary: {
      backendMode: 'in_process',
      tenantFilter: tenantId,
      limit,
      recordCount: records.length,
    },
  });
});

app.post('/api/v1/admin/queue/jobs/:id/retry', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const requestPayload = { jobId: c.req.param('id') };
  const adminMutation = await adminMutationRequest(c, 'admin.queue.jobs.retry', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  if (asyncBackendMode !== 'bullmq' || !bullmqQueue) {
    return c.json({ error: 'Manual async retry is only available when BullMQ is active.' }, 409);
  }

  let retried;
  try {
    retried = await retryFailedPipelineJob(bullmqQueue, c.req.param('id'));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
  }

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.queue.jobs.retry',
    requestPayload,
    statusCode: 202,
    responseBody: {
      job: retried,
    },
    audit: {
      action: 'async_job.retried',
      tenantId: retried.tenantId,
      planId: retried.planId,
      metadata: {
        queueName: bullmqQueue.name,
        attemptsMade: retried.attemptsMade,
        maxAttempts: retried.maxAttempts,
      },
      requestHash: adminMutation.requestHash,
    },
  });

  return c.json(responseBody, 202);
});

app.post('/api/v1/admin/accounts', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json();
  const accountName = typeof body.accountName === 'string' ? body.accountName.trim() : '';
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  const tenantName = typeof body.tenantName === 'string' ? body.tenantName.trim() : '';
  const requestedPlanId = typeof body.planId === 'string' && body.planId.trim() !== '' ? body.planId.trim() : DEFAULT_HOSTED_PLAN_ID;
  const monthlyRunQuota = typeof body.monthlyRunQuota === 'number' && body.monthlyRunQuota >= 0
    ? body.monthlyRunQuota
    : null;
  const requestPayload = {
    accountName,
    contactEmail,
    tenantId,
    tenantName,
    planId: requestedPlanId,
    monthlyRunQuota,
  };

  if (!accountName || !contactEmail || !tenantId || !tenantName) {
    return c.json({ error: 'accountName, contactEmail, tenantId, and tenantName are required' }, 400);
  }

  const adminMutation = await adminMutationRequest(c, 'admin.accounts.create', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let resolvedPlan;
  try {
    resolvedPlan = resolvePlanSpec({
      planId: requestedPlanId,
      monthlyRunQuota,
      defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  let provisioned;
  try {
    provisioned = await provisionHostedAccountState({
      account: {
        accountName,
        contactEmail,
        primaryTenantId: tenantId,
      },
      key: {
        tenantId,
        tenantName,
        planId: resolvedPlan.planId,
        monthlyRunQuota: resolvedPlan.monthlyRunQuota,
      },
    });
  } catch (err) {
    const mappedAccount = accountStoreErrorResponse(c, err);
    if (mappedAccount) return mappedAccount;
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlement(provisioned.account);

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.accounts.create',
    requestPayload,
    statusCode: 201,
    responseBody: {
      account: adminAccountView(provisioned.account),
      initialKey: {
        ...adminTenantKeyView(provisioned.initialKey),
        apiKey: provisioned.apiKey,
      },
    },
    audit: {
      action: 'account.created',
      accountId: provisioned.account.id,
      tenantId: provisioned.initialKey.tenantId,
      tenantKeyId: provisioned.initialKey.id,
      planId: provisioned.initialKey.planId,
      monthlyRunQuota: provisioned.initialKey.monthlyRunQuota,
      requestHash: adminMutation.requestHash,
      metadata: {
        accountName: provisioned.account.accountName,
        contactEmail: provisioned.account.contactEmail,
      },
    },
  });

  return c.json(responseBody, 201);
});

app.post('/api/v1/admin/accounts/:id/billing/stripe', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({}));
  let stripeSubscriptionStatus: StripeSubscriptionStatus;
  try {
    stripeSubscriptionStatus = parseStripeSubscriptionStatus(body.stripeSubscriptionStatus);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const requestPayload = {
    id: c.req.param('id'),
    stripeCustomerId: typeof body.stripeCustomerId === 'string' ? body.stripeCustomerId.trim() : '',
    stripeSubscriptionId: typeof body.stripeSubscriptionId === 'string' ? body.stripeSubscriptionId.trim() : '',
    stripeSubscriptionStatus,
    stripePriceId: typeof body.stripePriceId === 'string' ? body.stripePriceId.trim() : '',
  };
  if (!requestPayload.stripeCustomerId && !requestPayload.stripeSubscriptionId) {
    return c.json({ error: 'stripeCustomerId or stripeSubscriptionId is required.' }, 400);
  }

  const adminMutation = await adminMutationRequest(c, 'admin.accounts.attach_stripe_billing', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let attached;
  try {
    attached = await attachStripeBillingToAccountState(c.req.param('id'), {
      stripeCustomerId: requestPayload.stripeCustomerId || null,
      stripeSubscriptionId: requestPayload.stripeSubscriptionId || null,
      stripeSubscriptionStatus,
      stripePriceId: requestPayload.stripePriceId || null,
    });
  } catch (err) {
    const mapped = accountStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlement(attached.record);

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.accounts.attach_stripe_billing',
    requestPayload,
    statusCode: 200,
    responseBody: {
      account: adminAccountView(attached.record),
    },
    audit: {
      action: 'account.billing.attached',
      accountId: attached.record.id,
      tenantId: attached.record.primaryTenantId,
      requestHash: adminMutation.requestHash,
      metadata: {
        stripeCustomerId: attached.record.billing.stripeCustomerId,
        stripeSubscriptionId: attached.record.billing.stripeSubscriptionId,
        stripeSubscriptionStatus: attached.record.billing.stripeSubscriptionStatus,
        stripePriceId: attached.record.billing.stripePriceId,
      },
    },
  });

  return c.json(responseBody);
});

app.post('/api/v1/admin/accounts/:id/suspend', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({}));
  const requestPayload = {
    id: c.req.param('id'),
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
  };
  const adminMutation = await adminMutationRequest(c, 'admin.accounts.suspend', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let result;
  try {
    result = await setHostedAccountStatusState(c.req.param('id'), 'suspended');
  } catch (err) {
    const mapped = accountStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  const revokedSessions = await revokeAccountSessionsForAccountState(result.record.id);
  await syncHostedBillingEntitlement(result.record);

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.accounts.suspend',
    requestPayload,
    statusCode: 200,
    responseBody: {
      account: adminAccountView(result.record),
    },
    audit: {
      action: 'account.suspended',
      accountId: result.record.id,
      tenantId: result.record.primaryTenantId,
      requestHash: adminMutation.requestHash,
      metadata: {
        reason: requestPayload.reason || null,
        suspendedAt: result.record.suspendedAt,
        revokedSessionCount: revokedSessions.revokedCount,
      },
    },
  });

  return c.json(responseBody);
});

app.post('/api/v1/admin/accounts/:id/reactivate', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({}));
  const requestPayload = {
    id: c.req.param('id'),
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
  };
  const adminMutation = await adminMutationRequest(c, 'admin.accounts.reactivate', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let result;
  try {
    result = await setHostedAccountStatusState(c.req.param('id'), 'active');
  } catch (err) {
    const mapped = accountStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlement(result.record);

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.accounts.reactivate',
    requestPayload,
    statusCode: 200,
    responseBody: {
      account: adminAccountView(result.record),
    },
    audit: {
      action: 'account.reactivated',
      accountId: result.record.id,
      tenantId: result.record.primaryTenantId,
      requestHash: adminMutation.requestHash,
      metadata: {
        reason: requestPayload.reason || null,
      },
    },
  });

  return c.json(responseBody);
});

app.post('/api/v1/admin/accounts/:id/archive', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({}));
  const requestPayload = {
    id: c.req.param('id'),
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
  };
  const adminMutation = await adminMutationRequest(c, 'admin.accounts.archive', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let result;
  try {
    result = await setHostedAccountStatusState(c.req.param('id'), 'archived');
  } catch (err) {
    const mapped = accountStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  const revokedSessions = await revokeAccountSessionsForAccountState(result.record.id);
  await syncHostedBillingEntitlement(result.record);

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.accounts.archive',
    requestPayload,
    statusCode: 200,
    responseBody: {
      account: adminAccountView(result.record),
    },
    audit: {
      action: 'account.archived',
      accountId: result.record.id,
      tenantId: result.record.primaryTenantId,
      requestHash: adminMutation.requestHash,
      metadata: {
        reason: requestPayload.reason || null,
        archivedAt: result.record.archivedAt,
        revokedSessionCount: revokedSessions.revokedCount,
      },
    },
  });

  return c.json(responseBody);
});

app.post('/api/v1/admin/tenant-keys', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json();
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  const tenantName = typeof body.tenantName === 'string' ? body.tenantName.trim() : '';
  const requestedPlanId = typeof body.planId === 'string' && body.planId.trim() !== '' ? body.planId.trim() : DEFAULT_HOSTED_PLAN_ID;
  const monthlyRunQuota = typeof body.monthlyRunQuota === 'number' && body.monthlyRunQuota >= 0
    ? body.monthlyRunQuota
    : null;
  const requestPayload = {
    tenantId,
    tenantName,
    planId: requestedPlanId,
    monthlyRunQuota,
  };

  if (!tenantId || !tenantName) {
    return c.json({ error: 'tenantId and tenantName are required' }, 400);
  }

  const adminMutation = await adminMutationRequest(c, 'admin.tenant_keys.issue', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let resolvedPlan;
  try {
    resolvedPlan = resolvePlanSpec({
      planId: requestedPlanId,
      monthlyRunQuota,
      defaultPlanId: DEFAULT_HOSTED_PLAN_ID,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  let issued;
  try {
    issued = await issueTenantApiKeyState({
      tenantId,
      tenantName,
      planId: resolvedPlan.planId,
      monthlyRunQuota: resolvedPlan.monthlyRunQuota,
    });
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlementForTenant(issued.record.tenantId, {
    lastEventId: adminMutation.idempotencyKey,
    lastEventType: 'admin.tenant_keys.issue',
    lastEventAt: new Date().toISOString(),
  });

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.tenant_keys.issue',
    requestPayload,
    statusCode: 201,
    responseBody: {
      key: {
        ...adminTenantKeyView(issued.record),
        apiKey: issued.apiKey,
      },
    },
    audit: {
      action: 'tenant_key.issued',
      tenantId: issued.record.tenantId,
      tenantKeyId: issued.record.id,
      planId: issued.record.planId,
      monthlyRunQuota: issued.record.monthlyRunQuota,
      requestHash: adminMutation.requestHash,
      metadata: {
        tenantName: issued.record.tenantName,
      },
    },
  });

  return c.json(responseBody, 201);
});

app.post('/api/v1/admin/tenant-keys/:id/rotate', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({}));
  const requestedPlanId = typeof body.planId === 'string' && body.planId.trim() !== '' ? body.planId.trim() : null;
  const monthlyRunQuota = typeof body.monthlyRunQuota === 'number' && body.monthlyRunQuota >= 0
    ? body.monthlyRunQuota
    : null;
  const requestPayload = {
    id: c.req.param('id'),
    planId: requestedPlanId,
    monthlyRunQuota,
  };
  const adminMutation = await adminMutationRequest(c, 'admin.tenant_keys.rotate', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let rotated;
  try {
    rotated = await rotateTenantApiKeyState(c.req.param('id'), {
      planId: requestedPlanId,
      monthlyRunQuota,
    });
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
  await syncHostedBillingEntitlementForTenant(rotated.record.tenantId, {
    lastEventId: adminMutation.idempotencyKey,
    lastEventType: 'admin.tenant_keys.rotate',
    lastEventAt: new Date().toISOString(),
  });

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.tenant_keys.rotate',
    requestPayload,
    statusCode: 201,
    responseBody: {
      previousKey: adminTenantKeyView(rotated.previousRecord),
      newKey: {
        ...adminTenantKeyView(rotated.record),
        apiKey: rotated.apiKey,
      },
    },
    audit: {
      action: 'tenant_key.rotated',
      tenantId: rotated.record.tenantId,
      tenantKeyId: rotated.record.id,
      planId: rotated.record.planId,
      monthlyRunQuota: rotated.record.monthlyRunQuota,
      requestHash: adminMutation.requestHash,
      metadata: {
        previousKeyId: rotated.previousRecord.id,
        supersededKeyId: rotated.previousRecord.id,
        replacementKeyId: rotated.record.id,
        previousLastUsedAt: rotated.previousRecord.lastUsedAt,
      },
    },
  });

  return c.json(responseBody, 201);
});

app.post('/api/v1/admin/tenant-keys/:id/deactivate', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const requestPayload = { id: c.req.param('id') };
  const adminMutation = await adminMutationRequest(c, 'admin.tenant_keys.deactivate', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let result;
  try {
    result = await setTenantApiKeyStatusState(c.req.param('id'), 'inactive');
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlementForTenant(result.record.tenantId, {
    lastEventId: adminMutation.idempotencyKey,
    lastEventType: 'admin.tenant_keys.deactivate',
    lastEventAt: new Date().toISOString(),
  });

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.tenant_keys.deactivate',
    requestPayload,
    statusCode: 200,
    responseBody: {
      key: adminTenantKeyView(result.record),
    },
    audit: {
      action: 'tenant_key.deactivated',
      tenantId: result.record.tenantId,
      tenantKeyId: result.record.id,
      planId: result.record.planId,
      monthlyRunQuota: result.record.monthlyRunQuota,
      requestHash: adminMutation.requestHash,
      metadata: {
        tenantName: result.record.tenantName,
        deactivatedAt: result.record.deactivatedAt,
      },
    },
  });

  return c.json(responseBody);
});

app.post('/api/v1/admin/tenant-keys/:id/reactivate', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const requestPayload = { id: c.req.param('id') };
  const adminMutation = await adminMutationRequest(c, 'admin.tenant_keys.reactivate', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let result;
  try {
    result = await setTenantApiKeyStatusState(c.req.param('id'), 'active');
  } catch (err) {
    const mapped = tenantKeyStoreErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  }
  await syncHostedBillingEntitlementForTenant(result.record.tenantId, {
    lastEventId: adminMutation.idempotencyKey,
    lastEventType: 'admin.tenant_keys.reactivate',
    lastEventAt: new Date().toISOString(),
  });

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.tenant_keys.reactivate',
    requestPayload,
    statusCode: 200,
    responseBody: {
      key: adminTenantKeyView(result.record),
    },
    audit: {
      action: 'tenant_key.reactivated',
      tenantId: result.record.tenantId,
      tenantKeyId: result.record.id,
      planId: result.record.planId,
      monthlyRunQuota: result.record.monthlyRunQuota,
      requestHash: adminMutation.requestHash,
      metadata: {
        tenantName: result.record.tenantName,
      },
    },
  });

  return c.json(responseBody);
});

app.post('/api/v1/admin/tenant-keys/:id/recover', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({}));
  const requestPayload = {
    id: c.req.param('id'),
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
  };
  const adminMutation = await adminMutationRequest(c, 'admin.tenant_keys.recover', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  let recovered;
  try {
    recovered = await recoverTenantApiKeyState(c.req.param('id'));
  } catch (err) {
    const tenantError = tenantKeyStoreErrorResponse(c, err);
    if (tenantError) return tenantError;
    const secretError = secretEnvelopeErrorResponse(c, err);
    if (secretError) return secretError;
    throw err;
  }

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.tenant_keys.recover',
    requestPayload,
    statusCode: 200,
    responseBody: {
      key: {
        ...adminTenantKeyView(recovered.record),
        apiKey: recovered.apiKey,
      },
    },
    audit: {
      action: 'tenant_key.recovered',
      tenantId: recovered.record.tenantId,
      tenantKeyId: recovered.record.id,
      planId: recovered.record.planId,
      monthlyRunQuota: recovered.record.monthlyRunQuota,
      requestHash: adminMutation.requestHash,
      metadata: {
        tenantName: recovered.record.tenantName,
        provider: recovered.record.recoveryEnvelope?.provider ?? null,
        keyName: recovered.record.recoveryEnvelope?.keyName ?? null,
        reason: requestPayload.reason || null,
      },
    },
  });

  return c.json(responseBody);
});

app.post('/api/v1/admin/tenant-keys/:id/revoke', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const requestPayload = { id: c.req.param('id') };
  const adminMutation = await adminMutationRequest(c, 'admin.tenant_keys.revoke', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  const result = await revokeTenantApiKeyState(c.req.param('id'));
  if (!result.record) {
    return c.json({ error: 'Tenant key record not found' }, 404);
  }
  await syncHostedBillingEntitlementForTenant(result.record.tenantId, {
    lastEventId: adminMutation.idempotencyKey,
    lastEventType: 'admin.tenant_keys.revoke',
    lastEventAt: new Date().toISOString(),
  });

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.tenant_keys.revoke',
    requestPayload,
    statusCode: 200,
    responseBody: {
      key: adminTenantKeyView(result.record),
    },
    audit: {
      action: 'tenant_key.revoked',
      tenantId: result.record.tenantId,
      tenantKeyId: result.record.id,
      planId: result.record.planId,
      monthlyRunQuota: result.record.monthlyRunQuota,
      requestHash: adminMutation.requestHash,
      metadata: {
        tenantName: result.record.tenantName,
        revokedAt: result.record.revokedAt,
      },
    },
  });

  return c.json(responseBody);
});

app.get('/api/v1/admin/usage', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const tenantId = c.req.query('tenantId')?.trim() || null;
  const period = c.req.query('period')?.trim() || null;
  const usageRecords = await queryUsageLedgerState({ tenantId, period });
  const records = await Promise.all(usageRecords.map(async (entry) => {
    const tenantRecord = await findTenantRecordByTenantIdState(entry.tenantId);
    const accountRecord = await findHostedAccountByTenantIdState(entry.tenantId);
    const quota = tenantRecord?.monthlyRunQuota ?? null;
    return {
      tenantId: entry.tenantId,
      tenantName: tenantRecord?.tenantName ?? null,
      accountId: accountRecord?.id ?? null,
      accountName: accountRecord?.accountName ?? null,
      planId: tenantRecord?.planId ?? null,
      monthlyRunQuota: quota,
      meter: 'monthly_pipeline_runs' as const,
      period: entry.period,
      used: entry.used,
      remaining: quota === null ? null : Math.max(0, quota - entry.used),
      enforced: quota !== null,
      updatedAt: entry.updatedAt,
    };
  }));

  return c.json({
    records,
    summary: {
      tenantFilter: tenantId,
      periodFilter: period,
      recordCount: records.length,
      tenantCount: new Set(records.map((entry) => entry.tenantId)).size,
      totalUsed: records.reduce((sum, entry) => sum + entry.used, 0),
    },
  });
});

// ─── Pipeline Run ───────────────────────────────────────────────────────────

app.post('/api/v1/pipeline/run', async (c) => {
  try {
    const body = await c.req.json();
    const { scenarioId, candidateSql, intent, sign } = body;

    if (!candidateSql || !intent) {
      return c.json({ error: 'candidateSql and intent are required' }, 400);
    }

    const tenant = currentTenant(c);
    const quotaCheck = await canConsumePipelineRunState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Monthly pipeline run quota exceeded for this tenant plan.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
      }, 429);
    }
    const rateReservation = await reserveTenantPipelineRequest(tenant.tenantId, tenant.planId);
    if (!rateReservation.allowed) {
      applyRateLimitHeaders(c, rateReservation.rateLimit, { includeRetryAfter: true });
      return c.json({
        error: 'Pipeline request rate limit exceeded for this tenant plan.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
        rateLimit: rateReservation.rateLimit,
      }, 429);
    }
    const rateLimit = rateReservation.rateLimit;
    applyRateLimitHeaders(c, rateLimit);

    // ── Optional connector-backed execution ──
    let connectorExecution: any = null;
    let connectorProvider: string | null = null;
    let fullSchemaAttestation: any = null;

    // Special case: 'postgres-prove' uses the full postgres-prove path with schema attestation
    if (body.connector === 'postgres-prove') {
      try {
        const { isPostgresConfigured } = await import('../connectors/postgres.js');
        const { runPostgresProve } = await import('../connectors/postgres-prove.js');
        if (isPostgresConfigured()) {
          const pgResult = await runPostgresProve(candidateSql);
          if (pgResult.execution?.success) {
            connectorExecution = pgResult.execution;
            connectorProvider = 'postgres';
            fullSchemaAttestation = pgResult.schemaAttestation;
          }
        }
      } catch { /* non-fatal */ }
    } else if (body.connector) {
      const connector = connectorRegistry.get(body.connector);
      if (!connector) {
        return c.json({ error: `Connector '${body.connector}' not registered. Available: ${connectorRegistry.listIds().join(', ')}` }, 404);
      }
      const connConfig = connector.loadConfig();
      if (!connConfig) {
        return c.json({ error: `Connector '${body.connector}' not configured (env vars missing)` }, 400);
      }
      try {
        const result = await connector.execute(candidateSql, connConfig);
        if (result.success) {
          connectorExecution = result;
          connectorProvider = result.provider;
        }
      } catch (err: any) {
        // Connector execution failure is not fatal — fall back to fixture
        connectorExecution = null;
      }
    }

    // Keyless signer created after identity resolution (below)

    // ── OIDC-backed reviewer identity ──
    // If reviewerOidcToken is provided, verify it and derive reviewer identity.
    // If absent, fall back to operator-asserted identity (or no reviewer).
    let reviewerIdentity: ReviewerIdentity | undefined;
    let oidcVerified = false;

    if (body.reviewerOidcToken && body.oidcIssuer) {
      const oidcResult = await verifyOidcToken(body.reviewerOidcToken, {
        issuer: body.oidcIssuer,
        audience: body.oidcAudience,
      });
      if (oidcResult.verified && oidcResult.identity) {
        reviewerIdentity = oidcResult.identity;
        oidcVerified = true;
      } else {
        return c.json({ error: `OIDC token verification failed: ${oidcResult.error}`, identitySource: 'rejected' }, 401);
      }
    } else if (body.reviewerName) {
      reviewerIdentity = {
        name: body.reviewerName,
        role: body.reviewerRole ?? 'operator',
        identifier: body.reviewerIdentifier ?? 'api-caller',
        signerFingerprint: null,
      };
    }

    const identitySource = classifyIdentitySource(oidcVerified, false);

    // Keyless-first: per-request ephemeral keys with CA-issued short-lived certs
    const keylessPair = sign ? createRequestSigners(identitySource, reviewerIdentity?.name) : null;
    const keyPair = keylessPair?.signer.signingKeyPair;
    const reviewerKeyPair = (sign && reviewerIdentity && keylessPair) ? keylessPair.reviewer.signingKeyPair : undefined;

    const input: FinancialPipelineInput = {
      runId: `api-${Date.now().toString(36)}`,
      intent,
      candidateSql,
      fixtures: body.fixtures ?? [],
      generatedReport: body.generatedReport,
      reportContract: body.reportContract,
      signingKeyPair: keyPair,
      // Connector-backed execution evidence
      ...(connectorExecution ? {
        externalExecution: connectorExecution,
        liveProof: {
          collectedAt: new Date().toISOString(),
          execution: { live: true, provider: connectorProvider!, mode: 'live_db' as const, latencyMs: connectorExecution.durationMs ?? null },
        },
      } : {}),
      ...(reviewerIdentity && reviewerKeyPair ? {
        approval: {
          status: 'approved' as const,
          reviewerRole: reviewerIdentity.role,
          reviewNote: `API reviewer (${identitySource})`,
          reviewerIdentity,
          reviewerKeyPair,
        },
      } : {}),
    };

    const report = runFinancialPipeline(input);

    let kit = null;
    if (keyPair && report.certificate) {
      kit = buildVerificationKit(
        report, keyPair.publicKeyPem, undefined,
        keylessPair?.signer.trustChain ?? null,
        keylessPair?.signer.caPublicKeyPem ?? null,
      );
    }

    const usage = await consumePipelineRunState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);

    return c.json({
      runId: report.runId,
      decision: report.decision,
      scoring: {
        scorersRun: report.scoring.scorersRun,
        decision: report.scoring.decision,
      },
      warrant: report.warrant.status,
      escrow: report.escrow.state,
      receipt: report.receipt?.receiptStatus ?? null,
      capsule: report.capsule?.authorityState ?? null,
      proofMode: report.liveProof.mode,
      auditEntries: report.audit.entries.length,
      auditChainIntact: report.audit.chainIntact,
      // Full certificate for independent verification
      certificate: report.certificate ?? null,
      verification: kit?.verification ?? null,
      publicKeyPem: keyPair?.publicKeyPem ?? null,
      trustChain: keylessPair?.signer.trustChain ?? null,
      caPublicKeyPem: keylessPair?.signer.caPublicKeyPem ?? null,
      signingMode: sign ? 'keyless' : null,
      connectorUsed: connectorProvider,
      // Schema/data-state attestation
      schemaAttestation: fullSchemaAttestation
        ? schemaAttestationSummaryFromFull(fullSchemaAttestation)
        : schemaAttestationSummaryFromConnector(connectorExecution, connectorProvider),
      // Tenant context (from middleware)
      tenantContext: (() => {
        return { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId };
      })(),
      usage,
      rateLimit,
      identitySource,
      reviewerName: reviewerIdentity?.name ?? null,
      // Auto-filing: when sign=true and filing adapter is available, include XBRL summary + issued report package
      ...(await (async () => {
        if (!sign || !report.certificate) {
          return { filingExport: null, filingPackage: null };
        }
        try {
          const adapter = filingRegistry.get('xbrl-us-gaap-2024');
          if (!adapter) return { filingExport: null, filingPackage: null };
          const { issueFilingPackage } = await import('../filing/report-package.js');
          const envelope = buildCounterpartyEnvelope(
            report.runId, report.decision, report.certificate?.certificateId ?? null,
            report.evidenceChain?.terminalHash ?? '', report.execution?.rows ?? [], report.liveProof.mode,
          );
          const mapping = adapter.mapToTaxonomy(envelope);
          const pkg = adapter.generatePackage(mapping);
          pkg.evidenceLink = {
            runId: report.runId,
            certificateId: report.certificate?.certificateId ?? null,
            evidenceChainTerminal: report.evidenceChain?.terminalHash ?? '',
          };
          pkg.issuedPackage = await issueFilingPackage(pkg);
          return {
            filingExport: { adapterId: adapter.id, coveragePercent: mapping.coveragePercent, mappedCount: mapping.mapped.length },
            filingPackage: {
              adapterId: adapter.id,
              coveragePercent: mapping.coveragePercent,
              mappedCount: mapping.mapped.length,
              issuedPackage: pkg.issuedPackage,
            },
          };
        } catch {
          return { filingExport: null, filingPackage: null };
        }
      })()),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─── Verify Certificate ─────────────────────────────────────────────────────

app.post('/api/v1/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { certificate, publicKeyPem, trustChain, caPublicKeyPem } = body;
    if (!certificate || !publicKeyPem) {
      return c.json({ error: 'certificate and publicKeyPem are required' }, 400);
    }

    // PKI mandatory gate: reject flat Ed25519 unless legacy escape is set
    const allowLegacyApi = process.env.ATTESTOR_ALLOW_LEGACY_API === 'true';
    const hasPkiMaterial = trustChain && trustChain.ca && trustChain.leaf && caPublicKeyPem;
    if (!hasPkiMaterial && !allowLegacyApi) {
      console.log(`[verify] Rejected: no PKI chain material submitted`);
      return c.json({
        error: 'PKI trust chain required for verification.',
        hint: 'Submit trustChain and caPublicKeyPem alongside certificate and publicKeyPem.',
        legacyEscape: 'Set ATTESTOR_ALLOW_LEGACY_API=true to allow flat Ed25519 verification (deprecated).',
      }, 422);
    }

    // 1. Verify certificate signature
    const certResult = verifyCertificate(certificate, publicKeyPem);

    // 2. Verify PKI trust chain if provided
    let chainVerification = null;
    let pkiBound = false;
    if (hasPkiMaterial) {
      const chainResult = verifyTrustChain(trustChain, caPublicKeyPem);

      // 3. CRITICAL: Bind certificate to chain leaf
      // The leaf's subject key must be the same key that signed the certificate
      const signerIdentity = derivePublicKeyIdentity(publicKeyPem);
      const leafMatchesCertificateKey = trustChain.leaf.subjectFingerprint === signerIdentity.fingerprint;
      const leafMatchesCertificateFingerprint = certificate.signing?.fingerprint === trustChain.leaf.subjectFingerprint;

      pkiBound = chainResult.chainIntact && leafMatchesCertificateKey && leafMatchesCertificateFingerprint;

      chainVerification = {
        caValid: chainResult.caValid,
        leafValid: chainResult.leafValid,
        chainIntact: chainResult.chainIntact,
        issuerMatch: chainResult.issuerMatch,
        caExpired: chainResult.caExpired,
        leafExpired: chainResult.leafExpired,
        // Certificate-to-leaf binding
        leafMatchesCertificateKey,
        leafMatchesCertificateFingerprint,
        pkiBound,
        overall: chainResult.overall,
        caName: trustChain.ca.name ?? null,
        leafSubject: trustChain.leaf.subject ?? null,
      };
    }

    // 4. Structured verification scope summary
    const pkiVerified = certResult.overall === 'valid' && pkiBound;
    const verificationMode = chainVerification ? 'pki' as const : 'legacy_ed25519' as const;
    const trustBinding = {
      certificateSignature: certResult.signatureValid && certResult.fingerprintConsistent,
      chainValid: chainVerification?.chainIntact ?? false,
      certificateBoundToLeaf: pkiBound,
      pkiVerified,
    };

    // 5. Deprecation notice when legacy flat Ed25519 path is used
    const deprecationNotice = verificationMode === 'legacy_ed25519'
      ? 'Flat Ed25519 verification without PKI trust chain is deprecated. ' +
        'Submit trustChain + caPublicKeyPem for full PKI-backed verification. ' +
        'Legacy mode will be removed in a future version.'
      : null;

    if (verificationMode === 'legacy_ed25519') {
      console.log(`[verify] Legacy flat Ed25519 verification used (no trust chain submitted)`);
    }

    return c.json({
      signatureValid: certResult.signatureValid,
      fingerprintConsistent: certResult.fingerprintConsistent,
      schemaValid: certResult.schemaValid,
      overall: certResult.overall,
      explanation: certResult.explanation,
      verificationMode,
      deprecationNotice,
      chainVerification,
      trustBinding,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─── Filing Export ──────────────────────────────────────────────────────────

app.post('/api/v1/filing/export', async (c) => {
  try {
    const { adapterId, runId, decision, certificateId, evidenceChainTerminal, rows, proofMode } = await c.req.json();
    if (!adapterId || !runId || !rows) {
      return c.json({ error: 'adapterId, runId, and rows are required' }, 400);
    }

    const adapter = filingRegistry.get(adapterId);
    if (!adapter) {
      return c.json({ error: `Filing adapter '${adapterId}' not registered. Available: ${filingRegistry.list().map(a => a.id).join(', ')}` }, 404);
    }

    // Build decision envelope from provided data
    const { buildCounterpartyEnvelope } = await import('../filing/xbrl-adapter.js');
    const envelope = buildCounterpartyEnvelope(
      runId, decision ?? 'unknown', certificateId ?? null,
      evidenceChainTerminal ?? '', rows, proofMode ?? 'unknown',
    );

    const mapping = adapter.mapToTaxonomy(envelope);
    const pkg = adapter.generatePackage(mapping);
    pkg.evidenceLink = { runId, certificateId: certificateId ?? null, evidenceChainTerminal: evidenceChainTerminal ?? '' };
    const { issueFilingPackage } = await import('../filing/report-package.js');
    pkg.issuedPackage = await issueFilingPackage(pkg);

    return c.json({
      adapterId: adapter.id,
      format: adapter.format,
      taxonomyVersion: adapter.taxonomyVersion,
      mapping: {
        mappedCount: mapping.mapped.length,
        unmappedCount: mapping.unmapped.length,
        coveragePercent: mapping.coveragePercent,
      },
      package: pkg,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

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

app.post('/api/v1/pipeline/run-async', async (c) => {
  try {
    const body = await c.req.json();
    const { candidateSql, intent, sign } = body;
    if (!candidateSql || !intent) {
      return c.json({ error: 'candidateSql and intent are required' }, 400);
    }

    const tenant = currentTenant(c);
    const quotaCheck = await canConsumePipelineRunState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Monthly pipeline run quota exceeded for this tenant plan.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
      }, 429);
    }
    const submittedAt = new Date().toISOString();

    if (asyncBackendMode === 'bullmq' && bullmqQueue) {
      reserveAsyncSubmission(tenant.tenantId);
      const queueAllowance = await canEnqueueTenantAsyncJob(bullmqQueue, tenant.tenantId, tenant.planId);
      const effectivePendingJobs = queueAllowance.snapshot.pendingJobs + currentAsyncSubmissionReservations(tenant.tenantId);
      if (
        !queueAllowance.allowed ||
        (queueAllowance.snapshot.enforced &&
          queueAllowance.snapshot.pendingLimit !== null &&
          effectivePendingJobs > queueAllowance.snapshot.pendingLimit)
      ) {
        releaseAsyncSubmission(tenant.tenantId);
        return c.json({
          error: 'Too many unfinished async jobs are already queued for this tenant.',
          tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
          usage: quotaCheck.usage,
          rateLimit: await getTenantPipelineRateLimit(tenant.tenantId, tenant.planId),
          asyncQueue: {
          tenantPendingJobs: effectivePendingJobs,
          tenantPendingLimit: queueAllowance.snapshot.pendingLimit,
          tenantIsolationEnforced: queueAllowance.snapshot.enforced,
          tenantActiveExecutions: queueAllowance.snapshot.activeExecutions,
          tenantActiveExecutionLimit: queueAllowance.snapshot.activeExecutionLimit,
          tenantActiveExecutionEnforced: queueAllowance.snapshot.activeExecutionEnforced,
          tenantActiveExecutionBackend: queueAllowance.snapshot.activeExecutionBackend,
          tenantWeightedDispatchEnforced: queueAllowance.snapshot.weightedDispatchEnforced,
          tenantWeightedDispatchBackend: queueAllowance.snapshot.weightedDispatchBackend,
          tenantWeightedDispatchWeight: queueAllowance.snapshot.weightedDispatchWeight,
          tenantWeightedDispatchWindowMs: queueAllowance.snapshot.weightedDispatchWindowMs,
          tenantWeightedDispatchNextEligibleAt: queueAllowance.snapshot.weightedDispatchNextEligibleAt,
          tenantWeightedDispatchWaitMs: queueAllowance.snapshot.weightedDispatchWaitMs,
          retryPolicy: getAsyncRetryPolicy(),
        },
      }, 429);
      }

      const rateReservation = await reserveTenantPipelineRequest(tenant.tenantId, tenant.planId);
      if (!rateReservation.allowed) {
        releaseAsyncSubmission(tenant.tenantId);
        applyRateLimitHeaders(c, rateReservation.rateLimit, { includeRetryAfter: true });
        return c.json({
          error: 'Pipeline request rate limit exceeded for this tenant plan.',
          tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
          usage: quotaCheck.usage,
          rateLimit: rateReservation.rateLimit,
        }, 429);
      }

      // BullMQ path
      const input: FinancialPipelineInput = {
        runId: `async-bullmq-${Date.now().toString(36)}`,
        intent, candidateSql,
        fixtures: body.fixtures ?? [],
        generatedReport: body.generatedReport,
        reportContract: body.reportContract,
        signingKeyPair: sign ? pki.signer.keyPair : undefined,
      };
      let jobId: string;
      try {
        ({ jobId } = await submitPipelineJob(
          bullmqQueue,
          input,
          {
            tenantId: tenant.tenantId,
            planId: tenant.planId,
            source: tenant.source,
          },
          sign,
        ));
      } finally {
        releaseAsyncSubmission(tenant.tenantId);
      }
      const rateLimit = rateReservation.rateLimit;
      applyRateLimitHeaders(c, rateLimit);
      const usage = await consumePipelineRunState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
      const asyncQueue = await getAsyncQueueSummary(bullmqQueue, tenant.tenantId, tenant.planId);
      return c.json({
        jobId,
        status: 'queued',
        backendMode: 'bullmq',
        submittedAt,
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage,
        rateLimit,
        asyncQueue: {
          tenantPendingJobs: asyncQueue.tenant?.pendingJobs ?? 0,
          tenantPendingLimit: asyncQueue.tenant?.pendingLimit ?? null,
          tenantIsolationEnforced: asyncQueue.tenant?.enforced ?? false,
          tenantActiveExecutions: asyncQueue.tenant?.activeExecutions ?? 0,
          tenantActiveExecutionLimit: asyncQueue.tenant?.activeExecutionLimit ?? null,
          tenantActiveExecutionEnforced: asyncQueue.tenant?.activeExecutionEnforced ?? false,
          tenantActiveExecutionBackend: asyncQueue.tenant?.activeExecutionBackend ?? 'memory',
          tenantWeightedDispatchEnforced: asyncQueue.tenant?.weightedDispatchEnforced ?? false,
          tenantWeightedDispatchBackend: asyncQueue.tenant?.weightedDispatchBackend ?? 'memory',
          tenantWeightedDispatchWeight: asyncQueue.tenant?.weightedDispatchWeight ?? null,
          tenantWeightedDispatchWindowMs: asyncQueue.tenant?.weightedDispatchWindowMs ?? null,
          tenantWeightedDispatchNextEligibleAt: asyncQueue.tenant?.weightedDispatchNextEligibleAt ?? null,
          tenantWeightedDispatchWaitMs: asyncQueue.tenant?.weightedDispatchWaitMs ?? 0,
          retryPolicy: asyncQueue.retryPolicy,
        },
      }, 202);
    }

    // In-process fallback (explicit about mode)
    const inProcessSnapshot = inProcessTenantQueueSnapshot(tenant.tenantId, tenant.planId);
    reserveAsyncSubmission(tenant.tenantId);
    const effectiveInProcessPendingJobs = inProcessSnapshot.pendingJobs + currentAsyncSubmissionReservations(tenant.tenantId);
    if (inProcessSnapshot.enforced && inProcessSnapshot.pendingLimit !== null && effectiveInProcessPendingJobs > inProcessSnapshot.pendingLimit) {
      releaseAsyncSubmission(tenant.tenantId);
      return c.json({
        error: 'Too many unfinished async jobs are already queued for this tenant.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
        rateLimit: await getTenantPipelineRateLimit(tenant.tenantId, tenant.planId),
        asyncQueue: {
          tenantPendingJobs: effectiveInProcessPendingJobs,
          tenantPendingLimit: inProcessSnapshot.pendingLimit,
          tenantIsolationEnforced: inProcessSnapshot.enforced,
          tenantActiveExecutions: inProcessSnapshot.activeExecutions,
          tenantActiveExecutionLimit: inProcessSnapshot.activeExecutionLimit,
          tenantActiveExecutionEnforced: inProcessSnapshot.activeExecutionEnforced,
          tenantActiveExecutionBackend: inProcessSnapshot.activeExecutionBackend,
          tenantWeightedDispatchEnforced: inProcessSnapshot.weightedDispatchEnforced,
          tenantWeightedDispatchBackend: inProcessSnapshot.weightedDispatchBackend,
          tenantWeightedDispatchWeight: inProcessSnapshot.weightedDispatchWeight,
          tenantWeightedDispatchWindowMs: inProcessSnapshot.weightedDispatchWindowMs,
          tenantWeightedDispatchNextEligibleAt: inProcessSnapshot.weightedDispatchNextEligibleAt,
          tenantWeightedDispatchWaitMs: inProcessSnapshot.weightedDispatchWaitMs,
          retryPolicy: {
            attempts: 1,
            backoffMs: 0,
            maxStalledCount: 0,
            workerConcurrency: 1,
            completedTtlSeconds: 0,
            failedTtlSeconds: 0,
          },
        },
      }, 429);
    }

    const rateReservation = await reserveTenantPipelineRequest(tenant.tenantId, tenant.planId);
    if (!rateReservation.allowed) {
      releaseAsyncSubmission(tenant.tenantId);
      applyRateLimitHeaders(c, rateReservation.rateLimit, { includeRetryAfter: true });
      return c.json({
        error: 'Pipeline request rate limit exceeded for this tenant plan.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
        rateLimit: rateReservation.rateLimit,
      }, 429);
    }
    const rateLimit = rateReservation.rateLimit;
    applyRateLimitHeaders(c, rateLimit);
    const usage = await consumePipelineRunState(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const job: AsyncJob = {
      id: jobId,
      status: 'queued',
      submittedAt,
      completedAt: null,
      tenantId: tenant.tenantId,
      planId: tenant.planId,
      result: null,
      error: null,
    };
    inProcessJobs.set(jobId, job);
    releaseAsyncSubmission(tenant.tenantId);

    setImmediate(async () => {
      job.status = 'running';
      try {
        const asyncSigners = sign ? createRequestSigners('ephemeral') : null;
        const keyPair = asyncSigners?.signer.signingKeyPair;
        const input: FinancialPipelineInput = {
          runId: `async-${jobId}`, intent, candidateSql,
          fixtures: body.fixtures ?? [],
          generatedReport: body.generatedReport,
          reportContract: body.reportContract,
          signingKeyPair: keyPair,
        };
        const report = runFinancialPipeline(input);
        let kit = null;
        if (keyPair && report.certificate) {
          kit = buildVerificationKit(report, keyPair.publicKeyPem);
        }
        job.result = {
          runId: report.runId, decision: report.decision,
          proofMode: report.liveProof.mode,
          certificateId: report.certificate?.certificateId ?? null,
          certificate: report.certificate ?? null,
          verification: kit?.verification ?? null,
          publicKeyPem: keyPair?.publicKeyPem ?? null,
          trustChain: asyncSigners?.signer.trustChain ?? null,
          caPublicKeyPem: asyncSigners?.signer.caPublicKeyPem ?? null,
        };
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
      } catch (err: any) {
        job.status = 'failed';
        job.error = err.message ?? String(err);
        job.completedAt = new Date().toISOString();
        await upsertAsyncDeadLetterRecordState({
          jobId: job.id,
          name: 'pipeline-run',
          backendMode: 'in_process',
          tenantId: job.tenantId,
          planId: job.planId,
          state: 'failed',
          failedReason: job.error,
          attemptsMade: 1,
          maxAttempts: 1,
          requestedAt: job.submittedAt,
          submittedAt: job.submittedAt,
          processedAt: job.completedAt,
          failedAt: job.completedAt,
          recordedAt: job.completedAt,
        });
      }
    });

    return c.json({
      jobId,
      status: 'queued',
      backendMode: 'in_process',
      submittedAt,
      tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
      usage,
      rateLimit,
      asyncQueue: {
        tenantPendingJobs: inProcessSnapshot.pendingJobs + 1,
        tenantPendingLimit: inProcessSnapshot.pendingLimit,
        tenantIsolationEnforced: inProcessSnapshot.enforced,
        tenantActiveExecutions: inProcessSnapshot.activeExecutions,
        tenantActiveExecutionLimit: inProcessSnapshot.activeExecutionLimit,
        tenantActiveExecutionEnforced: inProcessSnapshot.activeExecutionEnforced,
        tenantActiveExecutionBackend: inProcessSnapshot.activeExecutionBackend,
        tenantWeightedDispatchEnforced: inProcessSnapshot.weightedDispatchEnforced,
        tenantWeightedDispatchBackend: inProcessSnapshot.weightedDispatchBackend,
        tenantWeightedDispatchWeight: inProcessSnapshot.weightedDispatchWeight,
        tenantWeightedDispatchWindowMs: inProcessSnapshot.weightedDispatchWindowMs,
        tenantWeightedDispatchNextEligibleAt: inProcessSnapshot.weightedDispatchNextEligibleAt,
        tenantWeightedDispatchWaitMs: inProcessSnapshot.weightedDispatchWaitMs,
        retryPolicy: {
          attempts: 1,
          backoffMs: 0,
          maxStalledCount: 0,
          workerConcurrency: 1,
          completedTtlSeconds: 0,
          failedTtlSeconds: 0,
        },
      },
    }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get('/api/v1/pipeline/status/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  // Try BullMQ first
  if (asyncBackendMode === 'bullmq' && bullmqQueue) {
    const bmStatus = await getJobStatus(bullmqQueue, jobId);
    if (bmStatus.status !== 'not_found') {
      return c.json({
        jobId,
        backendMode: 'bullmq',
        status: bmStatus.status,
        submittedAt: bmStatus.submittedAt,
        completedAt: bmStatus.result?.completedAt ?? bmStatus.failedAt,
        result: bmStatus.result,
        error: bmStatus.error,
        attemptsMade: bmStatus.attemptsMade,
        maxAttempts: bmStatus.maxAttempts,
        tenantContext: bmStatus.tenant
          ? {
              tenantId: bmStatus.tenant.tenantId,
              source: bmStatus.tenant.source,
              planId: bmStatus.tenant.planId,
            }
          : null,
        failedAt: bmStatus.failedAt,
      });
    }
  }

  // In-process fallback
  const job = inProcessJobs.get(jobId);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json({
    jobId: job.id,
    backendMode: 'in_process',
    status: job.status,
    submittedAt: job.submittedAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
    attemptsMade: 0,
    maxAttempts: 1,
    tenantContext: { tenantId: job.tenantId, source: 'in_process', planId: job.planId },
    failedAt: job.status === 'failed' ? job.completedAt : null,
  });
});

// ─── Readiness Probe ───────────────────────────────────────────────────────
// Distinct from /health: /ready signals "this instance can serve requests"
// Used by orchestrators (Kubernetes, Railway, Compose healthcheck)

app.get('/api/v1/ready', (c) => {
  const checks: Record<string, boolean> = {};
  let ready = true;
  const highAvailability = evaluateApiHighAvailabilityState({
    redisMode: redisMode as 'external' | 'localhost' | 'embedded' | 'none' | 'unavailable',
    asyncBackendMode: asyncBackendMode as 'bullmq' | 'in_process' | 'none',
    sharedControlPlane: isSharedControlPlaneConfigured(),
    sharedBillingLedger: !!process.env.ATTESTOR_BILLING_LEDGER_PG_URL?.trim(),
  });

  // 1. Async backend initialized (BullMQ or in-process fallback)
  checks.asyncBackend = asyncBackendMode === 'bullmq' || asyncBackendMode === 'in_process';
  if (!checks.asyncBackend) ready = false;

  // 2. PKI initialized
  checks.pki = pkiReady;
  if (!checks.pki) ready = false;

  // 3. Domain registry loaded
  checks.domains = domainRegistry.listIds().length > 0;
  if (!checks.domains) ready = false;

  // 4. Redis was resolved at startup (state-based, not new probe)
  if (asyncBackendMode === 'bullmq') {
    checks.redis = redisMode !== 'unavailable' && redisMode !== 'none';
    if (!checks.redis) ready = false;
  }

  if (highAvailability.enabled) {
    checks.highAvailability = highAvailability.ready;
    if (!checks.highAvailability) ready = false;
  }

  const status = ready ? 200 : 503;
  return c.json({ ready, checks, instanceId: serviceInstanceId, asyncBackendMode, redisMode, highAvailability }, status);
});

// ─── Server Start/Stop ──────────────────────────────────────────────────────

export function startServer(port: number = 3700): { port: number; close: () => void } {
  const telemetry = initializeTelemetry('0.1.0');
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
  if (highAvailability.enabled && !highAvailability.ready) {
    throw new Error(`ATTESTOR_HA_MODE startup guard failed for instance '${highAvailability.instanceId}': ${highAvailability.issues.join(' ')}`);
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
