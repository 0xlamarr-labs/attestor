import {
  createAccountApiKeyService,
  type AccountApiKeyServiceDeps,
} from '../application/account-api-key-service.js';
import {
  createAccountAuthService,
  type AccountAuthServiceDeps,
} from '../application/account-auth-service.js';
import {
  createAccountStateService,
  type AccountStateServiceDeps,
} from '../application/account-state-service.js';
import {
  createAccountUserManagementService,
  type AccountUserManagementServiceDeps,
} from '../application/account-user-management-service.js';
import {
  createAdminControlService,
  type AdminControlServiceDeps,
} from '../application/admin-control-service.js';
import {
  createAdminMutationService,
  type AdminMutationFinalizationInput,
  type AdminMutationResponseBody,
  type AdminMutationServiceDeps,
} from '../application/admin-mutation-service.js';
import {
  createAdminQueryService,
  type AdminQueryServiceDeps,
} from '../application/admin-query-service.js';
import {
  createEmailWebhookService,
  type EmailWebhookServiceDeps,
} from '../application/email-webhook-service.js';
import {
  createPipelineDeadLetterService,
  type PipelineDeadLetterServiceDeps,
} from '../application/pipeline-dead-letter-service.js';
import {
  createPipelineUsageService,
  type PipelineUsageServiceDeps,
} from '../application/pipeline-usage-service.js';
import {
  createStripeWebhookBillingProcessor,
  type StripeWebhookBillingProcessorDeps,
} from '../application/stripe-webhook-billing-processor.js';
import {
  createStripeWebhookService,
  type StripeWebhookServiceDeps,
} from '../application/stripe-webhook-service.js';
import type { AccountRouteDeps } from '../http/routes/account-routes.js';
import type { AdminRouteDeps } from '../http/routes/admin-routes.js';
import type { PipelineRouteDeps } from '../http/routes/pipeline-routes.js';
import type { ReleasePolicyControlRouteDeps } from '../http/routes/release-policy-control-routes.js';
import type { ReleaseReviewRouteDeps } from '../http/routes/release-review-routes.js';
import type { WebhookRouteDeps } from '../http/routes/webhook-routes.js';

export type BuildAccountRouteDepsInput =
  AccountAuthServiceDeps &
  AccountApiKeyServiceDeps &
  AccountUserManagementServiceDeps &
  AccountStateServiceDeps &
  Omit<
    AccountRouteDeps,
    'authService' | 'apiKeyService' | 'stateService' | 'userManagementService'
  >;

export function buildAccountRouteDeps(input: BuildAccountRouteDepsInput): AccountRouteDeps {
  const authService = createAccountAuthService(input);
  const apiKeyService = createAccountApiKeyService(input);
  const stateService = createAccountStateService(input);
  const userManagementService = createAccountUserManagementService(input);

  return {
    authService,
    apiKeyService,
    stateService,
    userManagementService,
    currentHostedAccount: input.currentHostedAccount,
    setSessionCookieForRecord: input.setSessionCookieForRecord,
    accountUserView: input.accountUserView,
    adminAccountView: input.adminAccountView,
    accountApiKeyView: input.accountApiKeyView,
    verifyAccountUserPasswordRecord: input.verifyAccountUserPasswordRecord,
    totpSummary: input.totpSummary,
    buildHostedPasskeyAuthenticationOptions: input.buildHostedPasskeyAuthenticationOptions,
    asAuthenticationResponse: input.asAuthenticationResponse,
    parsePasskeyAuthenticationChallenge: input.parsePasskeyAuthenticationChallenge,
    verifyHostedPasskeyAuthentication: input.verifyHostedPasskeyAuthentication,
    passkeyCredentialToWebAuthnCredential: input.passkeyCredentialToWebAuthnCredential,
    getHostedSamlMetadata: input.getHostedSamlMetadata,
    buildHostedSamlAuthorizationRequest: input.buildHostedSamlAuthorizationRequest,
    completeHostedSamlAuthorization: input.completeHostedSamlAuthorization,
    hostedSamlAllowsAutomaticLinking: input.hostedSamlAllowsAutomaticLinking,
    linkAccountUserSamlIdentity: input.linkAccountUserSamlIdentity,
    buildHostedOidcAuthorizationRequest: input.buildHostedOidcAuthorizationRequest,
    completeHostedOidcAuthorization: input.completeHostedOidcAuthorization,
    hostedOidcAllowsAutomaticLinking: input.hostedOidcAllowsAutomaticLinking,
    linkAccountUserOidcIdentity: input.linkAccountUserOidcIdentity,
    verifyTotpCode: input.verifyTotpCode,
    verifyAndConsumeRecoveryCode: input.verifyAndConsumeRecoveryCode,
    requireAccountSession: input.requireAccountSession,
    currentAccountAccess: input.currentAccountAccess,
    buildHostedPasskeyRegistrationOptions: input.buildHostedPasskeyRegistrationOptions,
    parsePasskeyRegistrationChallenge: input.parsePasskeyRegistrationChallenge,
    asRegistrationResponse: input.asRegistrationResponse,
    verifyHostedPasskeyRegistration: input.verifyHostedPasskeyRegistration,
    buildAccountUserPasskeyCredentialRecord: input.buildAccountUserPasskeyCredentialRecord,
    generateHostedPasskeyUserHandle: input.generateHostedPasskeyUserHandle,
    accountUserDetailedMfaView: input.accountUserDetailedMfaView,
    accountUserDetailedOidcView: input.accountUserDetailedOidcView,
    accountUserDetailedSamlView: input.accountUserDetailedSamlView,
    accountUserDetailedPasskeyView: input.accountUserDetailedPasskeyView,
    accountPasskeyCredentialView: input.accountPasskeyCredentialView,
    decryptTotpSecret: input.decryptTotpSecret,
    getSecretEnvelopeStatus: input.getSecretEnvelopeStatus,
    encryptTotpSecret: input.encryptTotpSecret,
    generateRecoveryCodes: input.generateRecoveryCodes,
    generateTotpSecretBase32: input.generateTotpSecretBase32,
    buildTotpOtpAuthUrl: input.buildTotpOtpAuthUrl,
    normalizePasskeyAuthenticatorHint: input.normalizePasskeyAuthenticatorHint,
    currentAccountRole: input.currentAccountRole,
    getTenantPipelineRateLimit: input.getTenantPipelineRateLimit,
    readHostedBillingEntitlement: input.readHostedBillingEntitlement,
    buildHostedFeatureServiceView: input.buildHostedFeatureServiceView,
    accountUserActionTokenView: input.accountUserActionTokenView,
    getCookie: input.getCookie,
    deleteCookie: input.deleteCookie,
    sessionCookieName: input.sessionCookieName,
    accountMfaErrorResponse: input.accountMfaErrorResponse,
    getHostedPlan: input.getHostedPlan,
    createHostedCheckoutSession: input.createHostedCheckoutSession,
    stripeBillingErrorResponse: input.stripeBillingErrorResponse,
    createHostedBillingPortalSession: input.createHostedBillingPortalSession,
    buildHostedBillingExport: input.buildHostedBillingExport,
    renderHostedBillingExportCsv: input.renderHostedBillingExportCsv,
    buildHostedBillingReconciliation: input.buildHostedBillingReconciliation,
    billingEntitlementView: input.billingEntitlementView,
    currentTenant: input.currentTenant,
  };
}

export type AdminMutationRequest = ReleaseReviewRouteDeps['adminMutationRequest'];
export type FinalizeAdminMutation = (
  input: AdminMutationFinalizationInput,
) => Promise<AdminMutationResponseBody>;

export type BuildAdminRouteDepsInput =
  AdminMutationServiceDeps &
  AdminControlServiceDeps &
  AdminQueryServiceDeps &
  Omit<AdminRouteDeps, 'adminMutationService' | 'adminControlService' | 'adminQueryService'>;

export interface BuiltAdminRouteDeps {
  adminRouteDeps: AdminRouteDeps;
  adminMutationRequest: AdminMutationRequest;
  finalizeAdminMutation: FinalizeAdminMutation;
}

export function buildAdminRouteDeps(input: BuildAdminRouteDepsInput): BuiltAdminRouteDeps {
  const adminMutationService = createAdminMutationService(input);
  const adminControlService = createAdminControlService(input);
  const adminQueryService = createAdminQueryService(input);

  const adminMutationRequest: AdminMutationRequest = async (c, routeId, requestPayload) => {
    const mutation = await adminMutationService.begin({
      idempotencyKey: c.req.header('Idempotency-Key')?.trim() ?? null,
      routeId,
      requestPayload,
    });
    if (mutation.kind === 'ready') {
      return {
        idempotencyKey: mutation.idempotencyKey,
        requestHash: mutation.requestHash,
      };
    }
    if (mutation.kind === 'conflict') {
      return c.json(mutation.responseBody, mutation.statusCode);
    }
    return new Response(JSON.stringify(mutation.responseBody), {
      status: mutation.statusCode,
      headers: mutation.headers,
    });
  };

  const finalizeAdminMutation: FinalizeAdminMutation = (options) =>
    adminMutationService.finalize(options);

  return {
    adminRouteDeps: {
      currentAdminAuthorized: input.currentAdminAuthorized,
      adminMutationService,
      adminControlService,
      adminQueryService,
      adminTenantKeyView: input.adminTenantKeyView,
      tenantKeyStorePolicy: input.tenantKeyStorePolicy,
      adminAccountView: input.adminAccountView,
      readHostedBillingEntitlement: input.readHostedBillingEntitlement,
      buildHostedBillingExport: input.buildHostedBillingExport,
      buildHostedBillingReconciliation: input.buildHostedBillingReconciliation,
      renderHostedBillingExportCsv: input.renderHostedBillingExportCsv,
      billingEntitlementView: input.billingEntitlementView,
      buildHostedFeatureServiceView: input.buildHostedFeatureServiceView,
      getTenantAsyncExecutionCoordinatorStatus: input.getTenantAsyncExecutionCoordinatorStatus,
      getTenantAsyncWeightedDispatchCoordinatorStatus:
        input.getTenantAsyncWeightedDispatchCoordinatorStatus,
      adminPlanView: input.adminPlanView,
      DEFAULT_HOSTED_PLAN_ID: input.DEFAULT_HOSTED_PLAN_ID,
      defaultRateLimitWindowSeconds: input.defaultRateLimitWindowSeconds,
      adminAuditView: input.adminAuditView,
      isBillingEventLedgerConfigured: input.isBillingEventLedgerConfigured,
      listBillingEvents: input.listBillingEvents,
      billingEventView: input.billingEventView,
      renderPrometheusMetrics: input.renderPrometheusMetrics,
      currentMetricsAuthorized: input.currentMetricsAuthorized,
      getTelemetryStatus: input.getTelemetryStatus,
      getHostedEmailDeliveryStatus: input.getHostedEmailDeliveryStatus,
      getSecretEnvelopeStatus: input.getSecretEnvelopeStatus,
      asyncBackendMode: input.asyncBackendMode,
      bullmqQueue: input.bullmqQueue,
      getAsyncQueueSummary: input.getAsyncQueueSummary,
      getAsyncRetryPolicy: input.getAsyncRetryPolicy,
      inProcessJobs: input.inProcessJobs,
      inProcessTenantQueueSnapshot: input.inProcessTenantQueueSnapshot,
      listFailedPipelineJobs: input.listFailedPipelineJobs,
      retryFailedPipelineJob: input.retryFailedPipelineJob,
      apiReleaseIntrospectionStore: input.apiReleaseIntrospectionStore,
      releaseDegradedModeGrantStore: input.releaseDegradedModeGrantStore,
    },
    adminMutationRequest,
    finalizeAdminMutation,
  };
}

export type BuildReleaseReviewRouteDepsInput =
  Omit<ReleaseReviewRouteDeps, 'adminMutationRequest' | 'finalizeAdminMutation'> & {
    adminMutationRequest: AdminMutationRequest;
    finalizeAdminMutation: FinalizeAdminMutation;
  };

export function buildReleaseReviewRouteDeps(
  input: BuildReleaseReviewRouteDepsInput,
): ReleaseReviewRouteDeps {
  return {
    ...input,
  };
}

export type BuildReleasePolicyControlRouteDepsInput =
  Omit<ReleasePolicyControlRouteDeps, 'adminMutationRequest' | 'finalizeAdminMutation'> & {
    adminMutationRequest: AdminMutationRequest;
    finalizeAdminMutation: FinalizeAdminMutation;
  };

export function buildReleasePolicyControlRouteDeps(
  input: BuildReleasePolicyControlRouteDepsInput,
): ReleasePolicyControlRouteDeps {
  return {
    ...input,
  };
}

export type BuildPipelineRouteDepsInput =
  PipelineUsageServiceDeps &
  PipelineDeadLetterServiceDeps &
  Omit<PipelineRouteDeps, 'pipelineUsageService' | 'pipelineDeadLetterService'>;

export function buildPipelineRouteDeps(input: BuildPipelineRouteDepsInput): PipelineRouteDeps {
  const pipelineUsageService = createPipelineUsageService(input);
  const pipelineDeadLetterService = createPipelineDeadLetterService(input);

  return {
    currentTenant: input.currentTenant,
    pipelineUsageService,
    reserveTenantPipelineRequest: input.reserveTenantPipelineRequest,
    applyRateLimitHeaders: input.applyRateLimitHeaders,
    connectorRegistry: input.connectorRegistry,
    verifyOidcToken: input.verifyOidcToken,
    classifyIdentitySource: input.classifyIdentitySource,
    createRequestSigners: input.createRequestSigners,
    runFinancialPipeline: input.runFinancialPipeline,
    buildVerificationKit: input.buildVerificationKit,
    createFinanceCommunicationReleaseCandidateFromReport:
      input.createFinanceCommunicationReleaseCandidateFromReport,
    buildFinanceCommunicationReleaseMaterial: input.buildFinanceCommunicationReleaseMaterial,
    buildFinanceCommunicationReleaseObservation: input.buildFinanceCommunicationReleaseObservation,
    financeCommunicationReleaseShadowEvaluator: input.financeCommunicationReleaseShadowEvaluator,
    createFinanceActionReleaseCandidateFromReport:
      input.createFinanceActionReleaseCandidateFromReport,
    buildFinanceActionReleaseMaterial: input.buildFinanceActionReleaseMaterial,
    buildFinanceActionReleaseObservation: input.buildFinanceActionReleaseObservation,
    financeActionReleaseShadowEvaluator: input.financeActionReleaseShadowEvaluator,
    createFinanceFilingReleaseCandidateFromReport:
      input.createFinanceFilingReleaseCandidateFromReport,
    FINANCE_FILING_ADAPTER_ID: input.FINANCE_FILING_ADAPTER_ID,
    buildFinanceFilingReleaseMaterial: input.buildFinanceFilingReleaseMaterial,
    financeReleaseDecisionEngine: input.financeReleaseDecisionEngine,
    financeReleaseDecisionLog: input.financeReleaseDecisionLog,
    buildFinanceFilingReleaseObservation: input.buildFinanceFilingReleaseObservation,
    currentReleaseRequester: input.currentReleaseRequester,
    currentReleaseEvaluationContext: input.currentReleaseEvaluationContext,
    finalizeFinanceFilingReleaseDecision: input.finalizeFinanceFilingReleaseDecision,
    createFinanceReviewerQueueItem: input.createFinanceReviewerQueueItem,
    apiReleaseReviewerQueueStore: input.apiReleaseReviewerQueueStore,
    apiReleaseTokenIssuer: input.apiReleaseTokenIssuer,
    apiReleaseEvidencePackStore: input.apiReleaseEvidencePackStore,
    apiReleaseEvidencePackIssuer: input.apiReleaseEvidencePackIssuer,
    apiReleaseIntrospectionStore: input.apiReleaseIntrospectionStore,
    schemaAttestationSummaryFromFull: input.schemaAttestationSummaryFromFull,
    schemaAttestationSummaryFromConnector: input.schemaAttestationSummaryFromConnector,
    filingRegistry: input.filingRegistry,
    buildCounterpartyEnvelope: input.buildCounterpartyEnvelope,
    verifyCertificate: input.verifyCertificate,
    verifyTrustChain: input.verifyTrustChain,
    derivePublicKeyIdentity: input.derivePublicKeyIdentity,
    apiReleaseVerificationKeyPromise: input.apiReleaseVerificationKeyPromise,
    resolveReleaseTokenFromRequest: input.resolveReleaseTokenFromRequest,
    verifyReleaseAuthorization: input.verifyReleaseAuthorization,
    apiReleaseIntrospector: input.apiReleaseIntrospector,
    ReleaseVerificationError: input.ReleaseVerificationError,
    asyncBackendMode: input.asyncBackendMode,
    bullmqQueue: input.bullmqQueue,
    canEnqueueTenantAsyncJob: input.canEnqueueTenantAsyncJob,
    currentAsyncSubmissionReservations: input.currentAsyncSubmissionReservations,
    reserveAsyncSubmission: input.reserveAsyncSubmission,
    releaseAsyncSubmission: input.releaseAsyncSubmission,
    getAsyncRetryPolicy: input.getAsyncRetryPolicy,
    getAsyncQueueSummary: input.getAsyncQueueSummary,
    submitPipelineJob: input.submitPipelineJob,
    getTenantPipelineRateLimit: input.getTenantPipelineRateLimit,
    inProcessTenantQueueSnapshot: input.inProcessTenantQueueSnapshot,
    inProcessJobs: input.inProcessJobs,
    pki: input.pki,
    pipelineDeadLetterService,
    getJobStatus: input.getJobStatus,
  };
}

export type BuildWebhookRouteDepsInput =
  EmailWebhookServiceDeps &
  StripeWebhookServiceDeps &
  StripeWebhookBillingProcessorDeps;

export function buildWebhookRouteDeps(input: BuildWebhookRouteDepsInput): WebhookRouteDeps {
  const stripeWebhookService = createStripeWebhookService(input);
  const stripeWebhookBillingProcessor = createStripeWebhookBillingProcessor(input);
  const emailWebhookService = createEmailWebhookService(input);

  return {
    emailWebhookService,
    stripeWebhookService,
    stripeWebhookBillingProcessor,
  };
}
