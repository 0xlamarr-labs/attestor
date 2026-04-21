import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';

type RouteDependency = any;

export interface PipelineExecutionRoutesDeps {
  currentTenant: RouteDependency;
  canConsumePipelineRunState: RouteDependency;
  reserveTenantPipelineRequest: RouteDependency;
  applyRateLimitHeaders: RouteDependency;
  connectorRegistry: RouteDependency;
  verifyOidcToken: RouteDependency;
  classifyIdentitySource: RouteDependency;
  createRequestSigners: RouteDependency;
  runFinancialPipeline: RouteDependency;
  buildVerificationKit: RouteDependency;
  createFinanceCommunicationReleaseCandidateFromReport: RouteDependency;
  buildFinanceCommunicationReleaseMaterial: RouteDependency;
  buildFinanceCommunicationReleaseObservation: RouteDependency;
  financeCommunicationReleaseShadowEvaluator: RouteDependency;
  createFinanceActionReleaseCandidateFromReport: RouteDependency;
  buildFinanceActionReleaseMaterial: RouteDependency;
  buildFinanceActionReleaseObservation: RouteDependency;
  financeActionReleaseShadowEvaluator: RouteDependency;
  createFinanceFilingReleaseCandidateFromReport: RouteDependency;
  FINANCE_FILING_ADAPTER_ID: RouteDependency;
  buildFinanceFilingReleaseMaterial: RouteDependency;
  financeReleaseDecisionEngine: RouteDependency;
  financeReleaseDecisionLog: RouteDependency;
  buildFinanceFilingReleaseObservation: RouteDependency;
  currentReleaseRequester: RouteDependency;
  currentReleaseEvaluationContext: RouteDependency;
  finalizeFinanceFilingReleaseDecision: RouteDependency;
  createFinanceReviewerQueueItem: RouteDependency;
  apiReleaseReviewerQueueStore: RouteDependency;
  apiReleaseTokenIssuer: RouteDependency;
  apiReleaseEvidencePackStore: RouteDependency;
  apiReleaseEvidencePackIssuer: RouteDependency;
  apiReleaseIntrospectionStore: RouteDependency;
  consumePipelineRunState: RouteDependency;
  schemaAttestationSummaryFromFull: RouteDependency;
  schemaAttestationSummaryFromConnector: RouteDependency;
  filingRegistry: RouteDependency;
  buildCounterpartyEnvelope: RouteDependency;
}

export function registerPipelineExecutionRoutes(app: Hono, deps: PipelineExecutionRoutesDeps): void {
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
    consumePipelineRunState,
    schemaAttestationSummaryFromFull,
    schemaAttestationSummaryFromConnector,
    filingRegistry,
    buildCounterpartyEnvelope,
  } = deps;


// Pipeline Run

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

    // Optional connector-backed execution
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
        // Connector execution failure is not fatal; fall back to fixture.
        connectorExecution = null;
      }
    }

    // Keyless signer created after identity resolution (below)

    // OIDC-backed reviewer identity
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
    let financeCommunicationRelease: {
      targetId: string;
      decisionId: string;
      decisionStatus: string;
      policyVersion: string;
      policyRolloutMode: string | null;
      policyEvaluationMode: string | null;
      wouldBlockIfEnforced: boolean;
      wouldRequireReview: boolean;
      wouldRequireToken: boolean;
      outputHash: string;
      consequenceHash: string;
      preview: {
        recipientId: string;
        channelId: string;
        subject: string;
      };
    } | null = null;
    let financeActionRelease: {
      targetId: string;
      decisionId: string;
      decisionStatus: string;
      policyVersion: string;
      policyRolloutMode: string | null;
      policyEvaluationMode: string | null;
      wouldBlockIfEnforced: boolean;
      wouldRequireReview: boolean;
      wouldRequireToken: boolean;
      outputHash: string;
      consequenceHash: string;
      preview: {
        workflowId: string;
        actionType: string;
        requestedTransition: string;
      };
    } | null = null;
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
      evidencePackId: string | null;
      evidencePackPath: string | null;
      evidencePackDigest: string | null;
      reviewQueueId: string | null;
      reviewQueuePath: string | null;
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
            context: currentReleaseEvaluationContext(c),
            target: material.target,
          },
          buildFinanceFilingReleaseObservation(material, report),
        );
        const releaseDecision = finalizeFinanceFilingReleaseDecision(
          evaluation.decision,
          report,
        );
        const reviewQueueItem =
          releaseDecision.reviewAuthority.minimumReviewerCount > 0 &&
          (releaseDecision.status === 'review-required' || releaseDecision.status === 'hold')
            ? apiReleaseReviewerQueueStore.upsert(
                createFinanceReviewerQueueItem({
                  decision: releaseDecision,
                  candidate: filingCandidate,
                  report,
                  logEntries: financeReleaseDecisionLog.entries(),
                }),
              )
            : null;
        const issuedReleaseToken =
          releaseDecision.status === 'accepted'
            ? await apiReleaseTokenIssuer.issue({
                decision: releaseDecision,
                issuedAt: report.timestamp,
              })
            : null;
        const decisionForEvidence = issuedReleaseToken
          ? {
              ...releaseDecision,
              releaseTokenId: issuedReleaseToken.tokenId,
            }
          : releaseDecision;
        if (issuedReleaseToken) {
          apiReleaseIntrospectionStore.registerIssuedToken({
            issuedToken: issuedReleaseToken,
            decision: releaseDecision,
          });
        }
        const issuedEvidencePack =
          issuedReleaseToken
            ? await apiReleaseEvidencePackIssuer.issue({
                decision: decisionForEvidence,
                issuedAt: report.timestamp,
                decisionLogEntries: financeReleaseDecisionLog
                  .entries()
                  .filter((entry: any) => entry.decisionId === releaseDecision.id),
                decisionLogChainIntact: financeReleaseDecisionLog.verify().valid,
                releaseToken: issuedReleaseToken,
                artifactReferences: Object.freeze(
                  report.evidenceChain?.terminalHash
                    ? [
                        {
                          kind: 'provenance',
                          path: `finance-evidence-chain://${report.runId}`,
                          digest: report.evidenceChain.terminalHash.startsWith('sha256:')
                            ? report.evidenceChain.terminalHash
                            : `sha256:${report.evidenceChain.terminalHash}`,
                        },
                      ]
                    : [],
                ),
              })
            : null;
        if (issuedEvidencePack) {
          apiReleaseEvidencePackStore.upsert(issuedEvidencePack);
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
          evidencePackId: issuedEvidencePack?.evidencePack.id ?? null,
          evidencePackPath: issuedEvidencePack
            ? `/api/v1/admin/release-evidence/${issuedEvidencePack.evidencePack.id}`
            : null,
          evidencePackDigest: issuedEvidencePack?.bundleDigest ?? null,
          reviewQueueId: reviewQueueItem?.id ?? null,
          reviewQueuePath: reviewQueueItem
            ? `/api/v1/admin/release-reviews/${reviewQueueItem.id}`
            : null,
          candidate: filingCandidate,
        };
      }
    }

    const communicationCandidate = createFinanceCommunicationReleaseCandidateFromReport(report);
    if (communicationCandidate) {
      const communicationMaterial = buildFinanceCommunicationReleaseMaterial(communicationCandidate);
      const communicationShadow = financeCommunicationReleaseShadowEvaluator.evaluate(
        {
          id: `release_comm_${randomUUID()}`,
          createdAt: report.timestamp,
          outputHash: communicationMaterial.hashBundle.outputHash,
          consequenceHash: communicationMaterial.hashBundle.consequenceHash,
          outputContract: communicationMaterial.outputContract,
          capabilityBoundary: communicationMaterial.capabilityBoundary,
          requester: currentReleaseRequester(c, reviewerIdentity),
          context: currentReleaseEvaluationContext(c),
          target: communicationMaterial.target,
        },
        buildFinanceCommunicationReleaseObservation(communicationMaterial, report),
      );

      financeCommunicationRelease = {
        targetId: communicationMaterial.target.id,
        decisionId: communicationShadow.evaluation.decision.id,
        decisionStatus: communicationShadow.evaluation.decision.status,
        policyVersion: communicationShadow.evaluation.decision.policyVersion,
        policyRolloutMode: communicationShadow.policyRolloutMode,
        policyEvaluationMode: communicationShadow.policyEvaluationMode,
        wouldBlockIfEnforced: communicationShadow.wouldBlockIfEnforced,
        wouldRequireReview: communicationShadow.wouldRequireReview,
        wouldRequireToken: communicationShadow.wouldRequireToken,
        outputHash: communicationMaterial.hashBundle.outputHash,
        consequenceHash: communicationMaterial.hashBundle.consequenceHash,
        preview: {
          recipientId: communicationCandidate.recipientId,
          channelId: communicationCandidate.channelId,
          subject: communicationCandidate.subject,
        },
      };
    }

    const actionCandidate = createFinanceActionReleaseCandidateFromReport(report);
    if (actionCandidate) {
      const actionMaterial = buildFinanceActionReleaseMaterial(actionCandidate);
      const actionShadow = financeActionReleaseShadowEvaluator.evaluate(
        {
          id: `release_action_${randomUUID()}`,
          createdAt: report.timestamp,
          outputHash: actionMaterial.hashBundle.outputHash,
          consequenceHash: actionMaterial.hashBundle.consequenceHash,
          outputContract: actionMaterial.outputContract,
          capabilityBoundary: actionMaterial.capabilityBoundary,
          requester: currentReleaseRequester(c, reviewerIdentity),
          context: currentReleaseEvaluationContext(c),
          target: actionMaterial.target,
        },
        buildFinanceActionReleaseObservation(actionMaterial, report),
      );

      financeActionRelease = {
        targetId: actionMaterial.target.id,
        decisionId: actionShadow.evaluation.decision.id,
        decisionStatus: actionShadow.evaluation.decision.status,
        policyVersion: actionShadow.evaluation.decision.policyVersion,
        policyRolloutMode: actionShadow.policyRolloutMode,
        policyEvaluationMode: actionShadow.policyEvaluationMode,
        wouldBlockIfEnforced: actionShadow.wouldBlockIfEnforced,
        wouldRequireReview: actionShadow.wouldRequireReview,
        wouldRequireToken: actionShadow.wouldRequireToken,
        outputHash: actionMaterial.hashBundle.outputHash,
        consequenceHash: actionMaterial.hashBundle.consequenceHash,
        preview: {
          workflowId: actionCandidate.workflowId,
          actionType: actionCandidate.actionType,
          requestedTransition: actionCandidate.requestedTransition,
        },
      };
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
        communication: financeCommunicationRelease,
        action: financeActionRelease,
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
}
