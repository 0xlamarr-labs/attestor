import type { Hono } from 'hono';
import type { DecisionEnvelope, FilingAdapterRegistry } from '../../../filing/filing-adapter.js';
import type {
  FinanceFilingReleaseCandidate,
  FinanceFilingReleaseMaterial,
} from '../../../release-layer/finance.js';
import type {
  ReleaseVerificationContext,
  ReleaseVerificationErrorConstructor,
  ReleaseVerificationInput,
  ReleaseTokenIntrospectionStore,
  ReleaseTokenIntrospector,
  ReleaseTokenVerificationKey,
} from '../../../release-layer/index.js';

export interface PipelineFilingRoutesDeps {
  FINANCE_FILING_ADAPTER_ID: string;
  buildFinanceFilingReleaseMaterial(candidate: FinanceFilingReleaseCandidate): FinanceFilingReleaseMaterial;
  apiReleaseIntrospectionStore: ReleaseTokenIntrospectionStore;
  filingRegistry: Pick<FilingAdapterRegistry, 'get' | 'list'>;
  buildCounterpartyEnvelope(
    runId: string,
    decision: string,
    certificateId: string | null,
    evidenceChainTerminal: string,
    rows: readonly Record<string, unknown>[],
    proofMode: string,
  ): DecisionEnvelope;
  apiReleaseVerificationKeyPromise: Promise<ReleaseTokenVerificationKey>;
  resolveReleaseTokenFromRequest(request: Request): string;
  verifyReleaseAuthorization(input: ReleaseVerificationInput): Promise<ReleaseVerificationContext>;
  apiReleaseIntrospector: ReleaseTokenIntrospector;
  ReleaseVerificationError: ReleaseVerificationErrorConstructor;
}

export function registerPipelineFilingRoutes(app: Hono, deps: PipelineFilingRoutesDeps): void {
  const {
    FINANCE_FILING_ADAPTER_ID,
    buildFinanceFilingReleaseMaterial,
    apiReleaseIntrospectionStore,
    filingRegistry,
    buildCounterpartyEnvelope,
    apiReleaseVerificationKeyPromise,
    resolveReleaseTokenFromRequest,
    verifyReleaseAuthorization,
    apiReleaseIntrospector,
    ReleaseVerificationError,
  } = deps;


// Filing Export

app.post('/api/v1/filing/export', async (c) => {
  try {
    const { adapterId, runId, decision, certificateId, evidenceChainTerminal, rows, proofMode } = await c.req.json();
    if (!adapterId || !runId || !rows) {
      return c.json({ error: 'adapterId, runId, and rows are required' }, 400);
    }

    const adapter = filingRegistry.get(adapterId);
    if (!adapter) {
      return c.json({ error: `Filing adapter '${adapterId}' not registered. Available: ${filingRegistry.list().map((a) => a.id).join(', ')}` }, 404);
    }

    let verifiedRelease: ReleaseVerificationContext | null = null;
    if (adapterId === FINANCE_FILING_ADAPTER_ID) {
      const material = buildFinanceFilingReleaseMaterial({
        adapterId,
        runId,
        decision: decision ?? 'unknown',
        certificateId: certificateId ?? null,
        evidenceChainTerminal: evidenceChainTerminal ?? '',
        rows,
        proofMode: proofMode ?? 'unknown',
      });

      try {
        const verificationKey = await apiReleaseVerificationKeyPromise;
        const token = resolveReleaseTokenFromRequest(c.req.raw);
        verifiedRelease = await verifyReleaseAuthorization({
          token,
          verificationKey,
          audience: material.target.id,
          expectedTargetId: material.target.id,
          expectedOutputHash: material.hashBundle.outputHash,
          expectedConsequenceHash: material.hashBundle.consequenceHash,
          introspector: apiReleaseIntrospector,
          usageStore: apiReleaseIntrospectionStore,
          consumeOnSuccess: true,
          tokenTypeHint: 'attestor_release_token',
          resourceServerId: 'attestor.api.finance.filing-export',
        });
      } catch (error) {
        if (error instanceof ReleaseVerificationError) {
          c.header('WWW-Authenticate', error.challenge);
          return c.json(error.toResponseBody(), error.status);
        }

        const description =
          error instanceof Error ? error.message : 'Release verification failed unexpectedly.';
        c.header(
          'WWW-Authenticate',
          `Bearer realm="attestor-release", error="invalid_token", error_description="${description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
        );
        return c.json(
          {
            error: 'invalid_token',
            error_description: description,
          },
          401,
        );
      }
    }

    // Build decision envelope from provided data
    const envelope = buildCounterpartyEnvelope(
      runId, decision ?? 'unknown', certificateId ?? null,
      evidenceChainTerminal ?? '', rows, proofMode ?? 'unknown',
    );

    const mapping = adapter.mapToTaxonomy(envelope);
    const pkg = adapter.generatePackage(mapping);
    pkg.evidenceLink = { runId, certificateId: certificateId ?? null, evidenceChainTerminal: evidenceChainTerminal ?? '' };
    const { issueFilingPackage } = await import('../../../filing/report-package.js');
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
      release: verifiedRelease
        ? {
            authorized: true,
            decisionId: verifiedRelease.verification.claims.decision_id,
            tokenId: verifiedRelease.verification.claims.jti,
            targetId: verifiedRelease.verification.claims.aud,
            introspectionVerified: verifiedRelease.introspection?.active ?? false,
          }
        : null,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
}
