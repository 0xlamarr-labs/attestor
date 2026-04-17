import type { Hono } from 'hono';

type RouteDeps = Record<string, any>;

export function registerAdminRoutes(app: Hono, deps: RouteDeps): void {
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
  } = deps;

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

  const action = c.req.query('action')?.trim() as any | undefined;
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
      appliedCount: records.filter((record: any) => record.outcome === 'applied').length,
      ignoredCount: records.filter((record: any) => record.outcome === 'ignored').length,
      pendingCount: records.filter((record: any) => record.outcome === 'pending').length,
    },
  });
});

app.get('/api/v1/admin/billing/entitlements', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const accountId = c.req.query('accountId')?.trim() || null;
  const tenantId = c.req.query('tenantId')?.trim() || null;
  const statusValue = c.req.query('status')?.trim() || null;
  const allowedStatuses = new Set<any>([
    'provisioned',
    'checkout_completed',
    'active',
    'trialing',
    'delinquent',
    'suspended',
    'archived',
  ]);
  const status = statusValue && allowedStatuses.has(statusValue as any)
    ? statusValue as any
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
      accessEnabledCount: result.records.filter((entry: any) => entry.accessEnabled).length,
      providerCounts: {
        manual: result.records.filter((entry: any) => entry.provider === 'manual').length,
        stripe: result.records.filter((entry: any) => entry.provider === 'stripe').length,
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
      waiting: Array.from((inProcessJobs as Map<string, any>).values()).filter((job) => job.status === 'queued').length,
      active: Array.from((inProcessJobs as Map<string, any>).values()).filter((job) => job.status === 'running').length,
      delayed: 0,
      prioritized: 0,
      completed: Array.from((inProcessJobs as Map<string, any>).values()).filter((job) => job.status === 'completed').length,
      failed: Array.from((inProcessJobs as Map<string, any>).values()).filter((job) => job.status === 'failed').length,
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
    const merged = new Map<string, any>();
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
  const live = Array.from((inProcessJobs as Map<string, any>).values())
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
  const merged = new Map<string, any>();
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  let stripeSubscriptionStatus: any;
  try {
    stripeSubscriptionStatus = parseStripeSubscriptionStatus(body.stripeSubscriptionStatus);
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
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

  const body = await c.req.json().catch(() => ({}));
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

app.get('/api/v1/admin/usage', async (c) => {
  const unauthorized = currentAdminAuthorized(c);
  if (unauthorized) return unauthorized;

  const tenantId = c.req.query('tenantId')?.trim() || null;
  const period = c.req.query('period')?.trim() || null;
  const usageRecords = await queryUsageLedgerState({ tenantId, period });
  const records = await Promise.all(usageRecords.map(async (entry: any) => {
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
      tenantCount: new Set(records.map((entry: any) => entry.tenantId)).size,
      totalUsed: records.reduce((sum, entry) => sum + entry.used, 0),
    },
  });
});

}


