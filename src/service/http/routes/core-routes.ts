import type { Hono } from 'hono';

type RouteDeps = Record<string, any>;

export function registerCoreRoutes(app: Hono, deps: RouteDeps): void {
  const {
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
  } = deps;

  app.get('/api/v1/health', (c) => {
    const highAvailability = evaluateApiHighAvailabilityState({
      redisMode: redisMode as 'external' | 'localhost' | 'embedded' | 'none' | 'unavailable',
      asyncBackendMode: asyncBackendMode as 'bullmq' | 'in_process' | 'none',
      sharedControlPlane: isSharedControlPlaneConfigured(),
      sharedBillingLedger: !!process.env.ATTESTOR_BILLING_LEDGER_PG_URL?.trim(),
    });
    return c.json({
      status: 'healthy',
      version: '1.0.0',
      instanceId: serviceInstanceId,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      domains: domainRegistry.listIds(),
      connectors: connectorRegistry.listIds(),
      filingAdapters: filingRegistry.list().map((a: any) => a.id),
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

  app.get('/api/v1/domains', (c) => {
    const domains = domainRegistry.list().map((d: any) => ({
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
      connectorRegistry.list().map(async (connector: any) => ({
        id: connector.id,
        displayName: connector.displayName,
        configured: connector.loadConfig() !== null,
        available: await connector.isAvailable(),
      })),
    );
    return c.json({ connectors });
  });

  app.get('/api/v1/ready', (c) => {
    const checks: Record<string, boolean> = {};
    let ready = true;
    const highAvailability = evaluateApiHighAvailabilityState({
      redisMode: redisMode as 'external' | 'localhost' | 'embedded' | 'none' | 'unavailable',
      asyncBackendMode: asyncBackendMode as 'bullmq' | 'in_process' | 'none',
      sharedControlPlane: isSharedControlPlaneConfigured(),
      sharedBillingLedger: !!process.env.ATTESTOR_BILLING_LEDGER_PG_URL?.trim(),
    });

    checks.asyncBackend = asyncBackendMode === 'bullmq' || asyncBackendMode === 'in_process';
    if (!checks.asyncBackend) ready = false;

    checks.pki = pkiReady;
    if (!checks.pki) ready = false;

    checks.domains = domainRegistry.listIds().length > 0;
    if (!checks.domains) ready = false;

    if (asyncBackendMode === 'bullmq') {
      checks.redis = redisMode !== 'unavailable' && redisMode !== 'none';
      if (!checks.redis) ready = false;
    }

    if (highAvailability.enabled || highAvailability.publicHosted) {
      checks.highAvailability = highAvailability.ready;
      if (!checks.highAvailability) ready = false;
    }

    const status = ready ? 200 : 503;
    return c.json({ ready, checks, instanceId: serviceInstanceId, asyncBackendMode, redisMode, highAvailability }, status);
  });
}
