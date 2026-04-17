import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';

type RouteDeps = Record<string, any>;

export function registerPipelineRoutes(app: Hono, deps: RouteDeps): void {
  const {
    currentTenant,
    canConsumePipelineRunState,
    reserveTenantPipelineRequest,
    applyRateLimitHeaders,
    connectorRegistry,
    verifyOidcToken,
    classifyIdentitySource,
    createRequestSigners,
    runFinancialPipeline,
    buildVerificationKit,
    createFinanceFilingReleaseCandidateFromReport,
    FINANCE_FILING_ADAPTER_ID,
    buildFinanceFilingReleaseMaterial,
    financeReleaseDecisionEngine,
    buildFinanceFilingReleaseObservation,
    currentReleaseRequester,
    finalizeFinanceFilingReleaseDecision,
    apiReleaseTokenIssuer,
    apiReleaseIntrospectionStore,
    consumePipelineRunState,
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
    upsertAsyncDeadLetterRecordState,
    getJobStatus,
  } = deps;

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
        const { isPostgresConfigured } = await import('../../../connectors/postgres.js');
        const { runPostgresProve } = await import('../../../connectors/postgres-prove.js');
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
    let reviewerIdentity: any;
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

    const input = {
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
    let financeFilingRelease: {
      targetId: string;
      decisionId: string;
      decisionStatus: string;
      policyVersion: string;
      introspectionRequired: boolean;
      outputHash: string;
      consequenceHash: string;
      tokenId: string | null;
      token: string | null;
      expiresAt: string | null;
      candidate: {
        adapterId: string;
        runId: string;
        decision: string;
        certificateId: string | null;
        evidenceChainTerminal: string;
        rows: readonly Record<string, unknown>[];
        proofMode: string;
      };
    } | null = null;

    let kit = null;
    if (keyPair && report.certificate) {
      kit = buildVerificationKit(
        report, keyPair.publicKeyPem, undefined,
        keylessPair?.signer.trustChain ?? null,
        keylessPair?.signer.caPublicKeyPem ?? null,
      );
    }

    if (sign && report.certificate) {
      const filingCandidate = createFinanceFilingReleaseCandidateFromReport(report);
      if (filingCandidate?.adapterId === FINANCE_FILING_ADAPTER_ID) {
        const material = buildFinanceFilingReleaseMaterial(filingCandidate);
        const evaluation = financeReleaseDecisionEngine.evaluateWithDeterministicChecks(
          {
            id: `release_${randomUUID()}`,
            createdAt: report.timestamp,
            outputHash: material.hashBundle.outputHash,
            consequenceHash: material.hashBundle.consequenceHash,
            outputContract: material.outputContract,
            capabilityBoundary: material.capabilityBoundary,
            requester: currentReleaseRequester(c, reviewerIdentity),
            target: material.target,
          },
          buildFinanceFilingReleaseObservation(material, report),
        );
        const releaseDecision = finalizeFinanceFilingReleaseDecision(
          evaluation.decision,
          report,
        );
        const issuedReleaseToken =
          releaseDecision.status === 'accepted'
            ? await apiReleaseTokenIssuer.issue({
                decision: releaseDecision,
                issuedAt: report.timestamp,
              })
            : null;
        if (issuedReleaseToken) {
          apiReleaseIntrospectionStore.registerIssuedToken({
            issuedToken: issuedReleaseToken,
            decision: releaseDecision,
          });
        }

        financeFilingRelease = {
          targetId: material.target.id,
          decisionId: releaseDecision.id,
          decisionStatus: releaseDecision.status,
          policyVersion: releaseDecision.policyVersion,
          introspectionRequired:
            issuedReleaseToken?.claims.introspection_required ??
            releaseDecision.releaseConditions.items.some(
              (item: any) => item.kind === 'introspection' && item.required,
            ),
          outputHash: material.hashBundle.outputHash,
          consequenceHash: material.hashBundle.consequenceHash,
          tokenId: issuedReleaseToken?.tokenId ?? null,
          token: issuedReleaseToken?.token ?? null,
          expiresAt: issuedReleaseToken?.expiresAt ?? null,
          candidate: filingCandidate,
        };
      }
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
      release: {
        filingExport: financeFilingRelease,
      },
      // Auto-filing: when sign=true and filing adapter is available, include XBRL summary + issued report package
      ...(await (async () => {
        if (!sign || !report.certificate) {
          return { filingExport: null, filingPackage: null };
        }
        try {
          const adapter = filingRegistry.get('xbrl-us-gaap-2024');
          if (!adapter) return { filingExport: null, filingPackage: null };
          const { issueFilingPackage } = await import('../../../filing/report-package.js');
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
      return c.json({ error: `Filing adapter '${adapterId}' not registered. Available: ${filingRegistry.list().map((a: any) => a.id).join(', ')}` }, 404);
    }

    let verifiedRelease: any = null;
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
          tokenTypeHint: 'attestor_release_token',
          resourceServerId: 'attestor.api.finance.filing-export',
        });
      } catch (error: any) {
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
    const { buildCounterpartyEnvelope } = await import('../../../filing/xbrl-adapter.js');
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
      const input = {
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
    const job: any = {
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
        const input = {
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

}

