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
| Admin route typing/services | Pending | Still uses `RouteDependency = any` |
| Pipeline route use-case services | Complete | Split into execution, verification, filing, and async route modules; all pipeline leaf routes are strongly typed |
| Webhook service split | In progress | Email and Stripe webhooks split; email route is strongly typed; Stripe route still uses `RouteDependency = any` |

## Next order

1. Stripe webhook route: replace the legacy dependency bundle with typed billing-event and account/billing service contracts.
2. Pipeline leaf routes: replace split execution, verification, filing, and async dependency bundles with typed service contracts.
3. Admin routes: group account, tenant key, billing, queue, audit, and telemetry operations behind typed services.
4. Account routes: group auth, user, MFA, passkey, federation, API key, billing, and usage operations behind typed services.
5. Remove the final `RouteDependency = any` alias from all service routes.

## Current boundary debt

The explicit remaining debt is guarded by `tests/service-route-boundary.test.ts`:

- `src/service/http/routes/account-routes.ts`
- `src/service/http/routes/admin-routes.ts`
- `src/service/http/routes/stripe-webhook-routes.ts`
