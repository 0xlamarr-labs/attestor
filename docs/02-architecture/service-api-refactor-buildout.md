# Service API refactor buildout

This tracker covers the Attestor service/API refactor only. The crypto authorization track is paused while this work removes route and bootstrap coupling.

Rules for this refactor:

- Keep behavior stable unless a route-specific bug is intentionally fixed.
- Prefer public package surfaces over deep internal imports.
- Convert one boundary at a time and verify with focused guard tests.
- Do not move generated run artifacts or unrelated local files into commits.

## Status

| Area | Status | Evidence |
| --- | --- | --- |
| Bootstrap composition | Complete | `src/service/bootstrap/{registries,runtime,routes,server}.ts`; `npm run test:service-bootstrap-boundary` |
| Route registration boundary | Complete | `registerAllRoutes(app, runtime)` owns route registration outside `api-server.ts` |
| Server lifecycle boundary | Complete | `startHttpServer` and `installGracefulShutdown` own Node/Hono lifecycle |
| Release review route typing | Complete | `release-review-routes.ts` has no `RouteDependency = any`; `npm run test:service-route-boundary` |
| Account route typing/services | Pending | Still uses `RouteDependency = any` |
| Admin route typing/services | Complete | `admin-routes.ts` has no `RouteDependency = any`; degraded-mode audit actions are typed in the admin audit contract |
| Pipeline route use-case services | Complete | Split into execution, verification, filing, and async route modules; all pipeline leaf routes are strongly typed |
| Webhook provider boundary | Complete | Email and Stripe webhooks split by provider; both provider routes are strongly typed |

## Next order

1. Account routes: group auth, user, MFA, passkey, federation, API key, billing, and usage operations behind typed services.
2. Remove the final `RouteDependency = any` alias from all service routes.

## Current boundary debt

The explicit remaining debt is guarded by `tests/service-route-boundary.test.ts`:

- `src/service/http/routes/account-routes.ts`
