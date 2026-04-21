import type { Context, Hono } from 'hono';
import type { AdminAuditAction, AdminAuditRecord } from '../../admin-audit-log.js';
import type { AsyncDeadLetterRecord } from '../../async-dead-letter-store.js';
import type * as AsyncPipeline from '../../async-pipeline.js';
import type { HostedAccountRecord, StripeSubscriptionStatus } from '../../account-store.js';
import type * as BillingEventLedger from '../../billing-event-ledger.js';
import type { HostedBillingEntitlementRecord, HostedBillingEntitlementStatus } from '../../billing-entitlement-store.js';
import type * as BillingExport from '../../billing-export.js';
import type * as BillingFeatureService from '../../billing-feature-service.js';
import type * as BillingReconciliation from '../../billing-reconciliation.js';
import type * as ControlPlaneStore from '../../control-plane-store.js';
import type * as EmailDelivery from '../../email-delivery.js';
import type { HostedEmailDeliveryProvider, HostedEmailDeliveryStatus } from '../../email-delivery-event-store.js';
import type * as Observability from '../../observability.js';
import type * as PlanCatalog from '../../plan-catalog.js';
import type { TenantKeyRecord } from '../../tenant-key-store.js';
import type { InProcessAsyncJob, TenantAsyncBackendMode } from '../../runtime/tenant-runtime.js';
import type * as TenantRuntime from '../../runtime/tenant-runtime.js';
import type { ReleaseActorReference, ReleaseTokenIntrospectionStore } from '../../../release-layer/index.js';
import type {
  EnforcementBoundaryKind,
  EnforcementBreakGlassReason,
  EnforcementFailureReason,
  EnforcementPointKind,
  ReleaseEnforcementConsequenceType,
  ReleaseEnforcementRiskClass,
} from '../../../release-enforcement-plane/types.js';
import {
  createDegradedModeGrant,
  createInMemoryDegradedModeGrantStore,
  degradedModeGrantStatus,
  degradedModeGrantView,
  type DegradedModeGrantState,
  type DegradedModeGrantStore,
  type DegradedModeScope,
  type ListDegradedModeGrantOptions,
} from '../../../release-enforcement-plane/degraded-mode.js';

type BillingEventProviderFilter = BillingEventLedger.BillingEventProvider | null;
type BillingEventOutcomeFilter = Exclude<BillingEventLedger.BillingEventOutcome, 'pending'> | null;
type AdminRouteResponseBody = Record<string, unknown>;
type AdminAsyncQueue = Parameters<typeof AsyncPipeline.getAsyncQueueSummary>[0];

interface AdminMutationRequestResult {
  idempotencyKey: string | null;
  requestHash: string;
}

interface AdminMutationFinalizeInput {
  idempotencyKey: string | null;
  routeId: string;
  requestPayload: unknown;
  statusCode: number;
  responseBody: AdminRouteResponseBody;
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
}

export interface AdminRouteDeps {
  currentAdminAuthorized(context: Context): Response | null;
  listTenantKeyRecordsState: typeof ControlPlaneStore.listTenantKeyRecordsState;
  adminTenantKeyView(record: TenantKeyRecord): AdminRouteResponseBody;
  tenantKeyStorePolicy(): { maxActiveKeysPerTenant: number };
  listHostedAccountsState: typeof ControlPlaneStore.listHostedAccountsState;
  adminAccountView(record: HostedAccountRecord): AdminRouteResponseBody;
  findHostedAccountByIdState: typeof ControlPlaneStore.findHostedAccountByIdState;
  readHostedBillingEntitlement(account: HostedAccountRecord): Promise<HostedBillingEntitlementRecord>;
  buildHostedBillingExport: typeof BillingExport.buildHostedBillingExport;
  buildHostedBillingReconciliation: typeof BillingReconciliation.buildHostedBillingReconciliation;
  renderHostedBillingExportCsv: typeof BillingExport.renderHostedBillingExportCsv;
  billingEntitlementView(record: HostedBillingEntitlementRecord): AdminRouteResponseBody;
  buildHostedFeatureServiceView: typeof BillingFeatureService.buildHostedFeatureServiceView;
  getTenantAsyncExecutionCoordinatorStatus(): { shared: boolean; backend: 'memory' | 'redis' };
  getTenantAsyncWeightedDispatchCoordinatorStatus(): { shared: boolean; backend: 'memory' | 'redis' };
  adminPlanView(): AdminRouteResponseBody[];
  DEFAULT_HOSTED_PLAN_ID: typeof PlanCatalog.DEFAULT_HOSTED_PLAN_ID;
  defaultRateLimitWindowSeconds: typeof PlanCatalog.defaultRateLimitWindowSeconds;
  listAdminAuditRecordsState: typeof ControlPlaneStore.listAdminAuditRecordsState;
  adminAuditView(record: AdminAuditRecord): AdminRouteResponseBody;
  isBillingEventLedgerConfigured: typeof BillingEventLedger.isBillingEventLedgerConfigured;
  listBillingEvents: typeof BillingEventLedger.listBillingEvents;
  billingEventView(record: BillingEventLedger.BillingEventRecord): AdminRouteResponseBody;
  listHostedBillingEntitlementsState: typeof ControlPlaneStore.listHostedBillingEntitlementsState;
  renderPrometheusMetrics: typeof Observability.renderPrometheusMetrics;
  currentMetricsAuthorized(context: Context): Response | null;
  getTelemetryStatus: typeof Observability.getTelemetryStatus;
  getHostedEmailDeliveryStatus: typeof EmailDelivery.getHostedEmailDeliveryStatus;
  getSecretEnvelopeStatus(): unknown;
  listHostedEmailDeliveriesState: typeof ControlPlaneStore.listHostedEmailDeliveriesState;
  asyncBackendMode: TenantAsyncBackendMode;
  bullmqQueue: AdminAsyncQueue | null;
  getAsyncQueueSummary: typeof AsyncPipeline.getAsyncQueueSummary;
  getAsyncRetryPolicy: typeof AsyncPipeline.getAsyncRetryPolicy;
  inProcessJobs: Map<string, InProcessAsyncJob>;
  inProcessTenantQueueSnapshot: typeof TenantRuntime.inProcessTenantQueueSnapshot;
  listAsyncDeadLetterRecordsState: typeof ControlPlaneStore.listAsyncDeadLetterRecordsState;
  listFailedPipelineJobs: typeof AsyncPipeline.listFailedPipelineJobs;
  retryFailedPipelineJob: typeof AsyncPipeline.retryFailedPipelineJob;
  adminMutationRequest(
    context: Context,
    routeId: string,
    requestPayload: unknown,
  ): Promise<AdminMutationRequestResult | Response>;
  finalizeAdminMutation(input: AdminMutationFinalizeInput): Promise<AdminRouteResponseBody>;
  resolvePlanSpec: typeof PlanCatalog.resolvePlanSpec;
  provisionHostedAccountState: typeof ControlPlaneStore.provisionHostedAccountState;
  accountStoreErrorResponse(context: Context, error: unknown): Response | null;
  tenantKeyStoreErrorResponse(context: Context, error: unknown): Response | null;
  attachStripeBillingToAccountState: typeof ControlPlaneStore.attachStripeBillingToAccountState;
  stripeBillingErrorResponse(context: Context, error: unknown): Response | null;
  syncHostedBillingEntitlement(
    account: HostedAccountRecord,
    options?: {
      lastEventId?: string | null;
      lastEventType?: string | null;
      lastEventAt?: string | null;
      stripeEntitlementLookupKeys?: string[] | null;
      stripeEntitlementFeatureIds?: string[] | null;
      stripeEntitlementSummaryUpdatedAt?: string | null;
    },
  ): Promise<HostedBillingEntitlementRecord>;
  syncHostedBillingEntitlementForTenant(
    tenantId: string,
    options?: {
      lastEventId?: string | null;
      lastEventType?: string | null;
      lastEventAt?: string | null;
      stripeEntitlementLookupKeys?: string[] | null;
      stripeEntitlementFeatureIds?: string[] | null;
      stripeEntitlementSummaryUpdatedAt?: string | null;
    },
  ): Promise<HostedBillingEntitlementRecord | null>;
  parseStripeSubscriptionStatus(raw: unknown): StripeSubscriptionStatus;
  setHostedAccountStatusState: typeof ControlPlaneStore.setHostedAccountStatusState;
  revokeAccountSessionsForAccountState: typeof ControlPlaneStore.revokeAccountSessionsForAccountState;
  issueTenantApiKeyState: typeof ControlPlaneStore.issueTenantApiKeyState;
  rotateTenantApiKeyState: typeof ControlPlaneStore.rotateTenantApiKeyState;
  setTenantApiKeyStatusState: typeof ControlPlaneStore.setTenantApiKeyStatusState;
  recoverTenantApiKeyState: typeof ControlPlaneStore.recoverTenantApiKeyState;
  revokeTenantApiKeyState: typeof ControlPlaneStore.revokeTenantApiKeyState;
  secretEnvelopeErrorResponse(context: Context, error: unknown): Response | null;
  queryUsageLedgerState: typeof ControlPlaneStore.queryUsageLedgerState;
  findTenantRecordByTenantIdState: typeof ControlPlaneStore.findTenantRecordByTenantIdState;
  findHostedAccountByTenantIdState: typeof ControlPlaneStore.findHostedAccountByTenantIdState;
  apiReleaseIntrospectionStore: ReleaseTokenIntrospectionStore;
  releaseDegradedModeGrantStore?: DegradedModeGrantStore;
}

function adminDegradedModeActor(value: unknown): ReleaseActorReference {
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const id = typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id.trim()
      : 'admin_api_key';
    const type = candidate.type === 'user' || candidate.type === 'service' || candidate.type === 'system'
      ? candidate.type
      : 'service';
    return {
      id,
      type,
      ...(typeof candidate.displayName === 'string' && candidate.displayName.trim()
        ? { displayName: candidate.displayName.trim() }
        : {}),
      ...(typeof candidate.role === 'string' && candidate.role.trim()
        ? { role: candidate.role.trim() }
        : {}),
    };
  }

  return {
    id: 'admin_api_key',
    type: 'service',
    displayName: 'Admin API Key',
    role: 'release-enforcement-admin',
  };
}

function adminDegradedModeScope(value: unknown): DegradedModeScope {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const candidate = value as Record<string, unknown>;
  return {
    environment: typeof candidate.environment === 'string' ? candidate.environment : null,
    enforcementPointId:
      typeof candidate.enforcementPointId === 'string' ? candidate.enforcementPointId : null,
    pointKind: typeof candidate.pointKind === 'string'
      ? candidate.pointKind as EnforcementPointKind
      : null,
    boundaryKind: typeof candidate.boundaryKind === 'string'
      ? candidate.boundaryKind as EnforcementBoundaryKind
      : null,
    tenantId: typeof candidate.tenantId === 'string' ? candidate.tenantId : null,
    accountId: typeof candidate.accountId === 'string' ? candidate.accountId : null,
    workloadId: typeof candidate.workloadId === 'string' ? candidate.workloadId : null,
    audience: typeof candidate.audience === 'string' ? candidate.audience : null,
    targetId: typeof candidate.targetId === 'string' ? candidate.targetId : null,
    consequenceType:
      typeof candidate.consequenceType === 'string'
        ? candidate.consequenceType as ReleaseEnforcementConsequenceType
        : null,
    riskClass: typeof candidate.riskClass === 'string'
      ? candidate.riskClass as ReleaseEnforcementRiskClass
      : null,
  };
}

function adminDegradedModeStringArray<T extends string>(value: unknown): readonly T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is T => typeof item === 'string');
}

function adminDegradedModeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function adminDegradedModeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Release enforcement degraded mode request failed.';
}

function adminRouteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function adminAuditActionFilter(value: string | undefined): AdminAuditAction | null {
  switch (value) {
    case 'account.created':
    case 'account.suspended':
    case 'account.reactivated':
    case 'account.archived':
    case 'account.billing.attached':
    case 'async_job.retried':
    case 'billing.stripe.webhook_applied':
    case 'policy_activation.approval_approved':
    case 'policy_activation.approval_rejected':
    case 'policy_activation.approval_requested':
    case 'policy_activation.activated':
    case 'policy_activation.emergency_frozen':
    case 'policy_activation.emergency_rolled_back':
    case 'policy_activation.rolled_back':
    case 'policy_bundle.published':
    case 'policy_pack.upserted':
    case 'release_break_glass.issued':
    case 'release_enforcement.degraded_mode.grant_created':
    case 'release_enforcement.degraded_mode.grant_revoked':
    case 'release_review.approved':
    case 'release_review.rejected':
    case 'release_token.revoked':
    case 'tenant_key.issued':
    case 'tenant_key.rotated':
    case 'tenant_key.deactivated':
    case 'tenant_key.reactivated':
    case 'tenant_key.recovered':
    case 'tenant_key.revoked':
      return value;
    default:
      return null;
  }
}

function billingEventProviderFilter(value: string | undefined): BillingEventProviderFilter {
  return value === 'stripe' ? value : null;
}

function billingEventOutcomeFilter(value: string | undefined): BillingEventOutcomeFilter {
  switch (value) {
    case 'applied':
    case 'ignored':
      return value;
    default:
      return null;
  }
}

function billingEntitlementStatusFilter(value: string | null): HostedBillingEntitlementStatus | null {
  switch (value) {
    case 'provisioned':
    case 'checkout_completed':
    case 'active':
    case 'trialing':
    case 'delinquent':
    case 'suspended':
    case 'archived':
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

export function registerAdminRoutes(app: Hono, deps: AdminRouteDeps): void {
  const {
    currentAdminAuthorized,
    listTenantKeyRecordsState,
    adminTenantKeyView,
    tenantKeyStorePolicy,
    listHostedAccountsState,
    adminAccountView,
    findHostedAccountByIdState,
    readHostedBillingEntitlement,
    buildHostedBillingExport,
    buildHostedBillingReconciliation,
    renderHostedBillingExportCsv,
    billingEntitlementView,
    buildHostedFeatureServiceView,
    getTenantAsyncExecutionCoordinatorStatus,
    getTenantAsyncWeightedDispatchCoordinatorStatus,
    adminPlanView,
    DEFAULT_HOSTED_PLAN_ID,
    defaultRateLimitWindowSeconds,
    listAdminAuditRecordsState,
    adminAuditView,
    isBillingEventLedgerConfigured,
    listBillingEvents,
    billingEventView,
    listHostedBillingEntitlementsState,
    renderPrometheusMetrics,
    currentMetricsAuthorized,
    getTelemetryStatus,
    getHostedEmailDeliveryStatus,
    getSecretEnvelopeStatus,
    listHostedEmailDeliveriesState,
    asyncBackendMode,
    bullmqQueue,
    getAsyncQueueSummary,
    getAsyncRetryPolicy,
    inProcessJobs,
    inProcessTenantQueueSnapshot,
    listAsyncDeadLetterRecordsState,
    listFailedPipelineJobs,
    retryFailedPipelineJob,
    adminMutationRequest,
    finalizeAdminMutation,
    resolvePlanSpec,
    provisionHostedAccountState,
    accountStoreErrorResponse,
    tenantKeyStoreErrorResponse,
    attachStripeBillingToAccountState,
    stripeBillingErrorResponse,
    syncHostedBillingEntitlement,
    syncHostedBillingEntitlementForTenant,
    parseStripeSubscriptionStatus,
    setHostedAccountStatusState,
    revokeAccountSessionsForAccountState,
    issueTenantApiKeyState,
    rotateTenantApiKeyState,
    setTenantApiKeyStatusState,
    recoverTenantApiKeyState,
    revokeTenantApiKeyState,
    secretEnvelopeErrorResponse,
    queryUsageLedgerState,
    findTenantRecordByTenantIdState,
    findHostedAccountByTenantIdState,
    apiReleaseIntrospectionStore,
    releaseDegradedModeGrantStore,
  } = deps;
  const degradedModeGrantStore: DegradedModeGrantStore =
    releaseDegradedModeGrantStore ?? createInMemoryDegradedModeGrantStore();

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

  const action = adminAuditActionFilter(c.req.query('action')?.trim());
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

  const provider = billingEventProviderFilter(c.req.query('provider')?.trim());
  const accountId = c.req.query('accountId')?.trim() || null;
  const tenantId = c.req.query('tenantId')?.trim() || null;
  const eventType = c.req.query('eventType')?.trim() || null;
  const outcome = billingEventOutcomeFilter(c.req.query('outcome')?.trim());
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
  const status = billingEntitlementStatusFilter(statusValue);
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

  return c.body(renderPrometheusMetrics('1.0.0'), 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'cache-control': 'no-store',
  });
});

app.get('/api/v1/metrics', (c) => {
  const unauthorized = currentMetricsAuthorized(c);
  if (unauthorized) return unauthorized;

  return c.body(renderPrometheusMetrics('1.0.0'), 200, {
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
    status: hostedEmailDeliveryStatusFilter(status),
    provider: hostedEmailDeliveryProviderFilter(provider),
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
    return c.json({ error: adminRouteErrorMessage(err) }, 409);
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

  const body = await c.req.json() as Record<string, unknown>;
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
    return c.json({ error: adminRouteErrorMessage(err) }, 400);
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

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  let stripeSubscriptionStatus: StripeSubscriptionStatus;
  try {
    stripeSubscriptionStatus = parseStripeSubscriptionStatus(body.stripeSubscriptionStatus);
  } catch (err) {
    return c.json({ error: adminRouteErrorMessage(err) }, 400);
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

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
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

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
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

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
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

  const body = await c.req.json() as Record<string, unknown>;
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
    return c.json({ error: adminRouteErrorMessage(err) }, 400);
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

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
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
    return c.json({ error: adminRouteErrorMessage(err) }, 400);
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

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
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

app.post('/api/v1/admin/release-tokens/:id/revoke', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const requestPayload = {
    id: c.req.param('id'),
    reason: reason || null,
  };
  const adminMutation = await adminMutationRequest(c, 'admin.release_tokens.revoke', requestPayload);
  if (adminMutation instanceof Response) return adminMutation;

  const existing = apiReleaseIntrospectionStore.findToken(c.req.param('id'));
  if (!existing) {
    return c.json({ error: 'Release token not found' }, 404);
  }

  const revoked = apiReleaseIntrospectionStore.revokeToken({
    tokenId: existing.tokenId,
    revokedAt: new Date().toISOString(),
    reason: reason || undefined,
    revokedBy: 'admin_api_key',
  });
  if (!revoked) {
    return c.json({ error: 'Release token not found' }, 404);
  }

  const responseBody = await finalizeAdminMutation({
    idempotencyKey: adminMutation.idempotencyKey,
    routeId: 'admin.release_tokens.revoke',
    requestPayload,
    statusCode: 200,
    responseBody: {
      token: {
        id: revoked.tokenId,
        status: revoked.status,
        decisionId: revoked.decisionId,
        consequenceType: revoked.consequenceType,
        riskClass: revoked.riskClass,
        audience: revoked.audience,
        issuedAt: revoked.issuedAt,
        expiresAt: revoked.expiresAt,
        revokedAt: revoked.revokedAt,
        revocationReason: revoked.revocationReason,
        revokedBy: revoked.revokedBy,
      },
    },
    audit: {
      action: 'release_token.revoked',
      requestHash: adminMutation.requestHash,
      metadata: {
        tokenId: revoked.tokenId,
        decisionId: revoked.decisionId,
        consequenceType: revoked.consequenceType,
        riskClass: revoked.riskClass,
        audience: revoked.audience,
        reason: revoked.revocationReason,
        revokedBy: revoked.revokedBy,
      },
    },
  });

  return c.json(responseBody);
});

app.get('/api/v1/admin/release-enforcement/degraded-mode/grants', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const statusQuery = c.req.query('status')?.trim() as ListDegradedModeGrantOptions['status'] | undefined;
  const allowedStatuses: readonly NonNullable<ListDegradedModeGrantOptions['status']>[] = [
    'active',
    'not-yet-valid',
    'expired',
    'revoked',
    'exhausted',
    'all',
  ];
  if (statusQuery && !allowedStatuses.includes(statusQuery)) {
    return c.json({ error: 'status must be active, not-yet-valid, expired, revoked, exhausted, or all.' }, 400);
  }

  const grants = degradedModeGrantStore.listGrants({
    status: statusQuery ?? 'all',
  });
  const now = new Date().toISOString();
  return c.json({
    version: 'attestor.release-enforcement-degraded-mode.admin.v1',
    grants: grants.map(degradedModeGrantView),
    summary: {
      grantCount: grants.length,
      activeCount: grants.filter((grant) => degradedModeGrantStatus(grant, now) === 'active').length,
      auditHead: degradedModeGrantStore.auditHead(),
    },
  });
});

app.post('/api/v1/admin/release-enforcement/degraded-mode/grants', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const state = adminDegradedModeText(body.state ?? body.posture) as DegradedModeGrantState;
  const allowedFailureReasons =
    adminDegradedModeStringArray<EnforcementFailureReason>(body.allowedFailureReasons);
  const approvedBy = Array.isArray(body.approvedBy)
    ? body.approvedBy.map(adminDegradedModeActor)
    : [];
  const requestPayload = {
    id: adminDegradedModeText(body.id) || null,
    state: state || null,
    reason: adminDegradedModeText(body.reason) || null,
    scope: body.scope ?? null,
    ticketId: adminDegradedModeText(body.ticketId) || null,
    ttlSeconds: typeof body.ttlSeconds === 'number' ? body.ttlSeconds : null,
    expiresAt: adminDegradedModeText(body.expiresAt) || null,
    maxUses: typeof body.maxUses === 'number' ? body.maxUses : null,
    allowedFailureReasons: allowedFailureReasons ?? null,
  };
  const adminMutation = await adminMutationRequest(
    c,
    'admin.release_enforcement.degraded_mode.grants.create',
    requestPayload,
  );
  if (adminMutation instanceof Response) return adminMutation;

  try {
    const grant = createDegradedModeGrant({
      id: adminDegradedModeText(body.id) || undefined,
      state,
      reason: adminDegradedModeText(body.reason) as EnforcementBreakGlassReason,
      scope: adminDegradedModeScope(body.scope),
      authorizedBy: adminDegradedModeActor(body.authorizedBy ?? body.grantedBy),
      approvedBy,
      authorizedAt: adminDegradedModeText(body.authorizedAt) || undefined,
      startsAt: adminDegradedModeText(body.startsAt) || undefined,
      expiresAt: adminDegradedModeText(body.expiresAt) || undefined,
      ttlSeconds: typeof body.ttlSeconds === 'number' ? body.ttlSeconds : undefined,
      maxTtlSeconds: typeof body.maxTtlSeconds === 'number' ? body.maxTtlSeconds : undefined,
      ticketId: adminDegradedModeText(body.ticketId),
      rationale: adminDegradedModeText(body.rationale),
      allowedFailureReasons,
      maxUses: typeof body.maxUses === 'number' ? body.maxUses : undefined,
      remainingUses: typeof body.remainingUses === 'number' ? body.remainingUses : undefined,
    });
    degradedModeGrantStore.registerGrant(grant);

    const responseBody = await finalizeAdminMutation({
      idempotencyKey: adminMutation.idempotencyKey,
      routeId: 'admin.release_enforcement.degraded_mode.grants.create',
      requestPayload,
      statusCode: 201,
      responseBody: {
        grant: degradedModeGrantView(grant),
        auditHead: degradedModeGrantStore.auditHead(),
      },
      audit: {
        action: 'release_enforcement.degraded_mode.grant_created',
        requestHash: adminMutation.requestHash,
        metadata: {
          grantId: grant.id,
          state: grant.state,
          reason: grant.reason,
          ticketId: grant.ticketId,
          expiresAt: grant.expiresAt,
          maxUses: grant.maxUses,
          remainingUses: grant.remainingUses,
          auditDigest: grant.auditDigest,
          auditHead: degradedModeGrantStore.auditHead(),
        },
      },
    });

    return c.json(responseBody, 201);
  } catch (error) {
    return c.json({ error: adminDegradedModeError(error) }, 400);
  }
});

app.post('/api/v1/admin/release-enforcement/degraded-mode/grants/:id/revoke', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const reason = adminDegradedModeText(body.reason);
  if (!reason) {
    return c.json({ error: 'Release enforcement degraded mode grant revocation reason is required.' }, 400);
  }
  const requestPayload = {
    id: c.req.param('id'),
    reason,
  };
  const adminMutation = await adminMutationRequest(
    c,
    'admin.release_enforcement.degraded_mode.grants.revoke',
    requestPayload,
  );
  if (adminMutation instanceof Response) return adminMutation;

  try {
    const revoked = degradedModeGrantStore.revokeGrant({
      id: c.req.param('id'),
      revokedAt: new Date().toISOString(),
      revokedBy: adminDegradedModeActor(body.revokedBy ?? body.actor),
      revocationReason: reason,
    });
    if (!revoked) {
      return c.json({ error: 'Release enforcement degraded mode grant not found.' }, 404);
    }

    const responseBody = await finalizeAdminMutation({
      idempotencyKey: adminMutation.idempotencyKey,
      routeId: 'admin.release_enforcement.degraded_mode.grants.revoke',
      requestPayload,
      statusCode: 200,
      responseBody: {
        grant: degradedModeGrantView(revoked),
        auditHead: degradedModeGrantStore.auditHead(),
      },
      audit: {
        action: 'release_enforcement.degraded_mode.grant_revoked',
        requestHash: adminMutation.requestHash,
        metadata: {
          grantId: revoked.id,
          state: revoked.state,
          reason: revoked.reason,
          revocationReason: revoked.revocationReason,
          revokedAt: revoked.revokedAt,
          revokedBy: revoked.revokedBy,
          auditDigest: revoked.auditDigest,
          auditHead: degradedModeGrantStore.auditHead(),
        },
      },
    });

    return c.json(responseBody);
  } catch (error) {
    return c.json({ error: adminDegradedModeError(error) }, 400);
  }
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

}


