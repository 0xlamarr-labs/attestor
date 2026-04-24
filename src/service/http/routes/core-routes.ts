import type { Hono } from 'hono';

type DomainRegistryLike = {
  listIds(): string[];
  list(): Array<{
    id: string;
    version: string;
    displayName: string;
    description: string;
    clauses: readonly unknown[];
    guardrails: readonly unknown[];
  }>;
};
type ConnectorRegistryLike = {
  listIds(): string[];
  list(): Array<{
    id: string;
    displayName: string;
    loadConfig(): unknown;
    isAvailable(): Promise<boolean>;
  }>;
};
type FilingRegistryLike = {
  list(): Array<{ id: string }>;
};
type HighAvailabilityState = {
  enabled: boolean;
  publicHosted: boolean;
  ready: boolean;
};
type RuntimeProfileDiagnostics = {
  version: string;
  profile: {
    id: string;
    label: string;
    purpose: string;
    production: boolean;
  };
  releaseStores: readonly {
    component: string;
    mode: string;
    allowedModes: readonly string[];
    satisfiesSelectedProfile: boolean;
    sharedForProduction: boolean;
  }[];
  durability: {
    ready: boolean;
    summary: string;
    violations: readonly {
      component: string;
      observedMode: string;
      allowedModes: readonly string[];
    }[];
  };
};
type ReleaseRuntimeRequestPathDiagnostics = {
  version: string;
  usesSharedAuthorityStores: boolean;
  contract: string;
  storeModes: Record<string, string>;
  sharedComponents: readonly string[];
  blockers: readonly string[];
};
type SharedAuthorityRuntimeReadiness = {
  version: string;
  evaluatedAt: string;
  runtimeProfileId: string | null;
  mode: 'postgres' | 'disabled';
  configured: boolean;
  ready: boolean;
  checks: Record<string, boolean>;
  summary: unknown;
  components: readonly unknown[];
  storeSummaries: unknown;
  blockers: readonly {
    code: string;
    message: string;
    components: readonly string[];
  }[];
};

export interface CoreRouteDeps {
  evaluateApiHighAvailabilityState(input: {
    redisMode: 'external' | 'localhost' | 'embedded' | 'none' | 'unavailable';
    asyncBackendMode: 'bullmq' | 'in_process' | 'none';
    sharedControlPlane: boolean;
    sharedBillingLedger: boolean;
  }): HighAvailabilityState;
  redisMode: string;
  asyncBackendMode: 'bullmq' | 'in_process' | 'none';
  isSharedControlPlaneConfigured(): boolean;
  serviceInstanceId: string;
  startTime: number;
  domainRegistry: DomainRegistryLike;
  connectorRegistry: ConnectorRegistryLike;
  filingRegistry: FilingRegistryLike;
  pkiReady: boolean;
  pki: {
    ca: { certificate: { name: string; fingerprint: string } };
    signer: { certificate: { subject: string } };
    reviewer: { certificate: { subject: string } };
  };
  runtimeProfileDiagnostics: RuntimeProfileDiagnostics;
  releaseRuntimeRequestPathDiagnostics: ReleaseRuntimeRequestPathDiagnostics;
  evaluateSharedAuthorityRuntimeReadiness(input: {
    runtimeProfileId?: string | null;
    requestPathUsesSharedStores?: boolean;
  }): Promise<SharedAuthorityRuntimeReadiness>;
  rlsActivationResult: {
    activated: boolean;
    policiesFound: number;
    tablesProtected: string[];
    error: string | null;
  };
}

export function registerCoreRoutes(app: Hono, deps: CoreRouteDeps): void {
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
    runtimeProfileDiagnostics,
    releaseRuntimeRequestPathDiagnostics,
    evaluateSharedAuthorityRuntimeReadiness,
    rlsActivationResult,
  } = deps;

  app.get('/api/v1/health', async (c) => {
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
      filingAdapters: filingRegistry.list().map((adapter) => adapter.id),
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
      runtimeProfile: runtimeProfileDiagnostics.profile,
      releaseRuntime: {
        diagnosticsVersion: runtimeProfileDiagnostics.version,
        durability: runtimeProfileDiagnostics.durability,
        stores: runtimeProfileDiagnostics.releaseStores,
        requestPath: releaseRuntimeRequestPathDiagnostics,
      },
      sharedAuthorityRuntime: await evaluateSharedAuthorityRuntimeReadiness({
        runtimeProfileId: runtimeProfileDiagnostics.profile.id,
        requestPathUsesSharedStores:
          releaseRuntimeRequestPathDiagnostics.usesSharedAuthorityStores,
      }),
      highAvailability,
      engine: 'attestor',
    });
  });

  app.get('/api/v1/domains', (c) => {
    const domains = domainRegistry.list().map((domain) => ({
      id: domain.id,
      version: domain.version,
      displayName: domain.displayName,
      description: domain.description,
      clauseCount: domain.clauses.length,
      guardrailCount: domain.guardrails.length,
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

  app.get('/api/v1/ready', async (c) => {
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

    checks.releaseRuntime = runtimeProfileDiagnostics.durability.ready;
    if (!checks.releaseRuntime) ready = false;

    const sharedAuthorityRuntime = await evaluateSharedAuthorityRuntimeReadiness({
      runtimeProfileId: runtimeProfileDiagnostics.profile.id,
      requestPathUsesSharedStores:
        releaseRuntimeRequestPathDiagnostics.usesSharedAuthorityStores,
    });
    checks.sharedAuthorityRuntime =
      runtimeProfileDiagnostics.profile.id === 'production-shared'
        ? sharedAuthorityRuntime.ready
        : true;
    if (!checks.sharedAuthorityRuntime) ready = false;

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
    return c.json({
      ready,
      checks,
      instanceId: serviceInstanceId,
      asyncBackendMode,
      redisMode,
      runtimeProfile: runtimeProfileDiagnostics.profile,
      releaseRuntime: {
        durability: runtimeProfileDiagnostics.durability,
        stores: runtimeProfileDiagnostics.releaseStores,
        requestPath: releaseRuntimeRequestPathDiagnostics,
      },
      sharedAuthorityRuntime,
      highAvailability,
    }, status);
  });
}
