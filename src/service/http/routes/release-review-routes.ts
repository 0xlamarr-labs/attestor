import type { Hono } from 'hono';

type RouteDeps = Record<string, any>;

function parsePositiveLimit(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function registerReleaseReviewRoutes(app: Hono, deps: RouteDeps): void {
  const {
    currentAdminAuthorized,
    apiReleaseReviewerQueueStore,
    renderReleaseReviewerQueueInboxPage,
    renderReleaseReviewerQueueDetailPage,
  } = deps;

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
}
