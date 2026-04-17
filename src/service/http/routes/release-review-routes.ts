import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { review } from '../../../release-layer/index.js';

const {
  ReleaseReviewerQueueError,
  applyBreakGlassOverride,
  applyReviewerDecision,
  attachIssuedTokenToReviewerQueueRecord,
} = review;

type RouteDeps = Record<string, any>;

function parsePositiveLimit(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readReviewField(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function parseReviewActionBody(c: any): Promise<Record<string, unknown>> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return await c.req.json();
  }

  const parsed = await c.req.parseBody();
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
}

function buildReviewActionResponse(
  review: any,
  releaseToken: any,
  evidencePack: any,
): Record<string, unknown> {
  return {
    review,
    authority: {
      state: review.authorityState,
      approvalsRequired: review.minimumReviewerCount,
      approvalsRecorded: review.approvalsRecorded,
      approvalsRemaining: review.approvalsRemaining,
      finalized: review.authorityState !== 'pending',
    },
    releaseToken,
    evidencePack,
  };
}

function buildIssuedReleaseTokenResponse(
  issuedToken: any,
): Record<string, unknown> {
  return {
    tokenId: issuedToken.tokenId,
    token: issuedToken.token,
    expiresAt: issuedToken.expiresAt,
    targetId: issuedToken.claims.aud,
    decisionId: issuedToken.claims.decision_id,
    ttlSeconds: issuedToken.claims.exp - issuedToken.claims.iat,
    override: issuedToken.claims.override,
  };
}

function buildIssuedEvidencePackResponse(
  issuedEvidencePack: any,
): Record<string, unknown> {
  return {
    evidencePackId: issuedEvidencePack.evidencePack.id,
    exportPath: `/api/v1/admin/release-evidence/${issuedEvidencePack.evidencePack.id}`,
    bundleDigest: issuedEvidencePack.bundleDigest,
    predicateType: issuedEvidencePack.statement.predicateType,
    retentionClass: issuedEvidencePack.evidencePack.retentionClass,
    subjectCount: issuedEvidencePack.statement.subject.length,
  };
}

function appendReviewerTimelineToDecisionLog(
  writer: any,
  decision: any,
  occurredAt: string,
  requestId: string,
  phase: 'review' | 'override' | 'evidence-pack' | 'terminal-accept' | 'terminal-deny',
): void {
  writer.append({
    occurredAt,
    requestId,
    phase,
    matchedPolicyId: decision.policyVersion,
    decision,
    metadata: {
      policyMatched: true,
      pendingChecks: [],
      pendingEvidenceKinds: [],
      requiresReview: decision.status === 'hold' || decision.status === 'review-required',
      deterministicChecksCompleted: true,
    },
  });
}

export function registerReleaseReviewRoutes(app: Hono, deps: RouteDeps): void {
  const {
    currentAdminAuthorized,
    apiReleaseReviewerQueueStore,
    renderReleaseReviewerQueueInboxPage,
    renderReleaseReviewerQueueDetailPage,
    financeReleaseDecisionLog,
    apiReleaseTokenIssuer,
    apiReleaseEvidencePackStore,
    apiReleaseEvidencePackIssuer,
    apiReleaseIntrospectionStore,
    adminMutationRequest,
    finalizeAdminMutation,
  } = deps;

  app.get('/api/v1/admin/release-evidence/:id', (c) => {
    const unauthorized = currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const pack = apiReleaseEvidencePackStore.get(c.req.param('id'));
    if (!pack) {
      return c.json({ error: `Release evidence pack '${c.req.param('id')}' not found.` }, 404);
    }

    c.header('cache-control', 'no-store');
    return c.json({ evidencePack: pack });
  });

  app.get('/api/v1/admin/release-reviews', (c) => {
    const unauthorized = currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const limit = parsePositiveLimit(c.req.query('limit'));
    if (c.req.query('limit') !== undefined && limit === null) {
      return c.json({ error: 'limit must be a positive integer.' }, 400);
    }

    const result = apiReleaseReviewerQueueStore.listPending({
      limit: limit ?? undefined,
      riskClass: (c.req.query('riskClass')?.trim() || undefined) as any,
      consequenceType: (c.req.query('consequenceType')?.trim() || undefined) as any,
    });

    c.header('cache-control', 'no-store');
    return c.json({
      generatedAt: result.generatedAt,
      totalPending: result.totalPending,
      countsByRiskClass: result.countsByRiskClass,
      items: result.items,
    });
  });

  app.get('/api/v1/admin/release-reviews/inbox', (c) => {
    const unauthorized = currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const limit = parsePositiveLimit(c.req.query('limit'));
    if (c.req.query('limit') !== undefined && limit === null) {
      return c.json({ error: 'limit must be a positive integer.' }, 400);
    }

    const result = apiReleaseReviewerQueueStore.listPending({
      limit: limit ?? undefined,
      riskClass: (c.req.query('riskClass')?.trim() || undefined) as any,
      consequenceType: (c.req.query('consequenceType')?.trim() || undefined) as any,
    });

    c.header('content-type', 'text/html; charset=utf-8');
    c.header('cache-control', 'no-store');
    return c.body(renderReleaseReviewerQueueInboxPage(result));
  });

  app.get('/api/v1/admin/release-reviews/:id', (c) => {
    const unauthorized = currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const item = apiReleaseReviewerQueueStore.get(c.req.param('id'));
    if (!item) {
      return c.json({ error: `Release review '${c.req.param('id')}' not found.` }, 404);
    }

    c.header('cache-control', 'no-store');
    return c.json({ review: item });
  });

  app.get('/api/v1/admin/release-reviews/:id/view', (c) => {
    const unauthorized = currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const item = apiReleaseReviewerQueueStore.get(c.req.param('id'));
    if (!item) {
      return c.json({ error: `Release review '${c.req.param('id')}' not found.` }, 404);
    }

    c.header('content-type', 'text/html; charset=utf-8');
    c.header('cache-control', 'no-store');
    return c.body(renderReleaseReviewerQueueDetailPage(item));
  });

  app.post('/api/v1/admin/release-reviews/:id/approve', async (c) => {
    const unauthorized = currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseReviewActionBody(c);
    const routeId = 'admin.release_review.approve';
    const mutation = await adminMutationRequest(c, routeId, body);
    if (mutation instanceof Response) {
      return mutation;
    }

    const record = apiReleaseReviewerQueueStore.getRecord(c.req.param('id'));
    if (!record) {
      return c.json({ error: `Release review '${c.req.param('id')}' not found.` }, 404);
    }

    try {
      const decidedAt = new Date().toISOString();
      const transition = applyReviewerDecision({
        record,
        outcome: 'approved',
        reviewerId: readReviewField(body, 'reviewerId') ?? '',
        reviewerName: readReviewField(body, 'reviewerName') ?? '',
        reviewerRole: readReviewField(body, 'reviewerRole') ?? '',
        note: readReviewField(body, 'note'),
        decidedAt,
      });

      appendReviewerTimelineToDecisionLog(
        financeReleaseDecisionLog,
        transition.record.releaseDecision,
        decidedAt,
        `review:${transition.record.detail.id}:approve`,
        'review',
      );

      let finalRecord = transition.record;
      let responseToken: Record<string, unknown> | null = null;
      let responseEvidencePack: Record<string, unknown> | null = null;
      if (transition.record.detail.authorityState === 'approved') {
        appendReviewerTimelineToDecisionLog(
          financeReleaseDecisionLog,
          transition.record.releaseDecision,
          decidedAt,
          `review:${transition.record.detail.id}:terminal-accept`,
          'terminal-accept',
        );
        const issuedToken = await apiReleaseTokenIssuer.issue({
          decision: transition.record.releaseDecision,
          issuedAt: decidedAt,
        });
        apiReleaseIntrospectionStore.registerIssuedToken({
          issuedToken,
          decision: transition.record.releaseDecision,
        });
        finalRecord = attachIssuedTokenToReviewerQueueRecord({
          record: transition.record,
          issuedToken,
        });
        responseToken = buildIssuedReleaseTokenResponse(issuedToken);
        const evidencePackId = `ep_${randomUUID()}`;
        const releaseDecisionWithEvidence = {
          ...finalRecord.releaseDecision,
          evidencePackId,
        };
        appendReviewerTimelineToDecisionLog(
          financeReleaseDecisionLog,
          releaseDecisionWithEvidence,
          decidedAt,
          `review:${transition.record.detail.id}:evidence-pack`,
          'evidence-pack',
        );
        const issuedEvidencePack = await apiReleaseEvidencePackIssuer.issue({
          decision: releaseDecisionWithEvidence,
          evidencePackId,
          issuedAt: decidedAt,
          decisionLogEntries: financeReleaseDecisionLog
            .entries()
            .filter((entry: any) => entry.decisionId === releaseDecisionWithEvidence.id),
          decisionLogChainIntact: financeReleaseDecisionLog.verify().valid,
          review: finalRecord.detail,
          releaseToken: issuedToken,
        });
        apiReleaseEvidencePackStore.upsert(issuedEvidencePack);
        finalRecord = {
          detail: {
            ...finalRecord.detail,
            updatedAt: decidedAt,
            evidencePackId,
            timeline: [
              ...finalRecord.detail.timeline,
              {
                occurredAt: decidedAt,
                phase: 'evidence-pack',
                decisionStatus: finalRecord.releaseDecision.status,
                requiresReview: false,
                deterministicChecksCompleted: true,
                reviewerLabel: 'Attestor release evidence issuer',
              },
            ],
          },
          releaseDecision: releaseDecisionWithEvidence,
        };
        responseEvidencePack = buildIssuedEvidencePackResponse(issuedEvidencePack);
      }

      const stored = apiReleaseReviewerQueueStore.upsert(finalRecord);
      c.header('cache-control', 'no-store');
      return c.json(
        await finalizeAdminMutation({
          idempotencyKey: mutation.idempotencyKey,
          routeId,
          requestPayload: body,
          statusCode: 200,
          responseBody: buildReviewActionResponse(stored, responseToken, responseEvidencePack),
          audit: {
            action: 'release_review.approved',
            requestHash: mutation.requestHash,
            metadata: {
              reviewId: stored.id,
              decisionId: stored.decisionId,
              reviewerId: readReviewField(body, 'reviewerId'),
              reviewerRole: readReviewField(body, 'reviewerRole'),
              authorityState: stored.authorityState,
              approvalsRecorded: stored.approvalsRecorded,
              releaseTokenId: responseToken?.tokenId ?? null,
              evidencePackId: responseEvidencePack?.evidencePackId ?? null,
            },
          },
        }),
      );
    } catch (error) {
      if (error instanceof ReleaseReviewerQueueError) {
        const status =
          error.code === 'already_finalized'
            ? 409
            : error.code === 'duplicate_reviewer'
              ? 409
              : error.code === 'reviewer_not_allowed' || error.code === 'reviewer_role_not_allowed'
                ? 403
                : 400;
        return c.json({ error: error.message, code: error.code }, status);
      }

      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post('/api/v1/admin/release-reviews/:id/reject', async (c) => {
    const unauthorized = currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseReviewActionBody(c);
    const routeId = 'admin.release_review.reject';
    const mutation = await adminMutationRequest(c, routeId, body);
    if (mutation instanceof Response) {
      return mutation;
    }

    const record = apiReleaseReviewerQueueStore.getRecord(c.req.param('id'));
    if (!record) {
      return c.json({ error: `Release review '${c.req.param('id')}' not found.` }, 404);
    }

    try {
      const decidedAt = new Date().toISOString();
      const transition = applyReviewerDecision({
        record,
        outcome: 'rejected',
        reviewerId: readReviewField(body, 'reviewerId') ?? '',
        reviewerName: readReviewField(body, 'reviewerName') ?? '',
        reviewerRole: readReviewField(body, 'reviewerRole') ?? '',
        note: readReviewField(body, 'note'),
        decidedAt,
      });

      appendReviewerTimelineToDecisionLog(
        financeReleaseDecisionLog,
        transition.record.releaseDecision,
        decidedAt,
        `review:${transition.record.detail.id}:reject`,
        'review',
      );
      appendReviewerTimelineToDecisionLog(
        financeReleaseDecisionLog,
        transition.record.releaseDecision,
        decidedAt,
        `review:${transition.record.detail.id}:terminal-deny`,
        'terminal-deny',
      );

      const stored = apiReleaseReviewerQueueStore.upsert(transition.record);
      c.header('cache-control', 'no-store');
      return c.json(
        await finalizeAdminMutation({
          idempotencyKey: mutation.idempotencyKey,
          routeId,
          requestPayload: body,
          statusCode: 200,
          responseBody: buildReviewActionResponse(stored, null, null),
          audit: {
            action: 'release_review.rejected',
            requestHash: mutation.requestHash,
            metadata: {
              reviewId: stored.id,
              decisionId: stored.decisionId,
              reviewerId: readReviewField(body, 'reviewerId'),
              reviewerRole: readReviewField(body, 'reviewerRole'),
              authorityState: stored.authorityState,
            },
          },
        }),
      );
    } catch (error) {
      if (error instanceof ReleaseReviewerQueueError) {
        const status =
          error.code === 'already_finalized'
            ? 409
            : error.code === 'duplicate_reviewer'
              ? 409
              : error.code === 'reviewer_not_allowed' || error.code === 'reviewer_role_not_allowed'
                ? 403
                : 400;
        return c.json({ error: error.message, code: error.code }, status);
      }

      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  app.post('/api/v1/admin/release-reviews/:id/override', async (c) => {
    const unauthorized = currentAdminAuthorized(c);
    if (unauthorized) return unauthorized;

    const body = await parseReviewActionBody(c);
    const routeId = 'admin.release_review.override';
    const mutation = await adminMutationRequest(c, routeId, body);
    if (mutation instanceof Response) {
      return mutation;
    }

    const record = apiReleaseReviewerQueueStore.getRecord(c.req.param('id'));
    if (!record) {
      return c.json({ error: `Release review '${c.req.param('id')}' not found.` }, 404);
    }

    try {
      const decidedAt = new Date().toISOString();
      const overriddenRecord = applyBreakGlassOverride({
        record,
        reasonCode: readReviewField(body, 'reasonCode') ?? '',
        ticketId: readReviewField(body, 'ticketId'),
        requestedById: readReviewField(body, 'requestedById') ?? '',
        requestedByName: readReviewField(body, 'requestedByName') ?? '',
        requestedByRole: readReviewField(body, 'requestedByRole'),
        note: readReviewField(body, 'note'),
        decidedAt,
      });

      appendReviewerTimelineToDecisionLog(
        financeReleaseDecisionLog,
        overriddenRecord.releaseDecision,
        decidedAt,
        `review:${overriddenRecord.detail.id}:override`,
        'override',
      );
      appendReviewerTimelineToDecisionLog(
        financeReleaseDecisionLog,
        overriddenRecord.releaseDecision,
        decidedAt,
        `review:${overriddenRecord.detail.id}:terminal-accept`,
        'terminal-accept',
      );

      const issuedToken = await apiReleaseTokenIssuer.issue({
        decision: overriddenRecord.releaseDecision,
        issuedAt: decidedAt,
        ttlSeconds: 60,
      });
      apiReleaseIntrospectionStore.registerIssuedToken({
        issuedToken,
        decision: overriddenRecord.releaseDecision,
      });

      const finalRecord = attachIssuedTokenToReviewerQueueRecord({
        record: overriddenRecord,
        issuedToken,
      });
      const evidencePackId = `ep_${randomUUID()}`;
      const releaseDecisionWithEvidence = {
        ...finalRecord.releaseDecision,
        evidencePackId,
      };
      appendReviewerTimelineToDecisionLog(
        financeReleaseDecisionLog,
        releaseDecisionWithEvidence,
        decidedAt,
        `review:${overriddenRecord.detail.id}:evidence-pack`,
        'evidence-pack',
      );
      const issuedEvidencePack = await apiReleaseEvidencePackIssuer.issue({
        decision: releaseDecisionWithEvidence,
        evidencePackId,
        issuedAt: decidedAt,
        decisionLogEntries: financeReleaseDecisionLog
          .entries()
          .filter((entry: any) => entry.decisionId === releaseDecisionWithEvidence.id),
        decisionLogChainIntact: financeReleaseDecisionLog.verify().valid,
        review: finalRecord.detail,
        releaseToken: issuedToken,
      });
      apiReleaseEvidencePackStore.upsert(issuedEvidencePack);
      const finalRecordWithEvidence = {
        detail: {
          ...finalRecord.detail,
          updatedAt: decidedAt,
          evidencePackId,
          timeline: [
            ...finalRecord.detail.timeline,
            {
              occurredAt: decidedAt,
              phase: 'evidence-pack',
              decisionStatus: finalRecord.releaseDecision.status,
              requiresReview: false,
              deterministicChecksCompleted: true,
              reviewerLabel: 'Attestor release evidence issuer',
            },
          ],
        },
        releaseDecision: releaseDecisionWithEvidence,
      };

      const stored = apiReleaseReviewerQueueStore.upsert(finalRecordWithEvidence);
      const responseToken = buildIssuedReleaseTokenResponse(issuedToken);
      const responseEvidencePack = buildIssuedEvidencePackResponse(issuedEvidencePack);
      c.header('cache-control', 'no-store');
      return c.json(
        await finalizeAdminMutation({
          idempotencyKey: mutation.idempotencyKey,
          routeId,
          requestPayload: body,
          statusCode: 200,
          responseBody: buildReviewActionResponse(stored, responseToken, responseEvidencePack),
          audit: {
            action: 'release_break_glass.issued',
            requestHash: mutation.requestHash,
            metadata: {
              reviewId: stored.id,
              decisionId: stored.decisionId,
              reasonCode: stored.overrideGrant?.reasonCode ?? null,
              ticketId: stored.overrideGrant?.ticketId ?? null,
              requestedById: stored.overrideGrant?.requestedById ?? null,
              requestedByRole: stored.overrideGrant?.requestedByRole ?? null,
              authorityState: stored.authorityState,
              releaseTokenId: responseToken.tokenId,
              evidencePackId: responseEvidencePack.evidencePackId,
              ttlSeconds: responseToken.ttlSeconds,
            },
          },
        }),
      );
    } catch (error) {
      if (error instanceof ReleaseReviewerQueueError) {
        const status =
          error.code === 'already_finalized'
            ? 409
            : error.code === 'missing_override_reason' || error.code === 'missing_override_requester'
              ? 400
              : 409;
        return c.json({ error: error.message, code: error.code }, status);
      }

      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}
