# Service API refactor buildout

This tracker covers the Attestor service/API refactor only. Crypto work stays on its own trackers; this file is only the service/API boundary truth source.

Rules for this refactor:

- Keep behavior stable unless a route-specific bug is intentionally fixed.
- Prefer public package surfaces over deep internal imports.
- Convert one boundary at a time and verify with focused guard tests.
- Do not move generated run artifacts or unrelated local files into commits.

## Status

| Area | Status | Evidence |
| --- | --- | --- |
| Bootstrap composition | Complete | `src/service/bootstrap/{registries,runtime,routes,server,api-route-runtime}.ts`; `npm run test:service-bootstrap-boundary` |
| API route runtime composition | Complete | `src/service/bootstrap/api-route-runtime.ts` owns release runtime, hosted account support, route dependency builders, and HTTP route runtime creation |
| Route registration boundary | Complete | `registerAllRoutes(app, runtime)` owns route registration outside `api-server.ts` |
| Server lifecycle boundary | Complete | `startHttpServer` and `installGracefulShutdown` own Node/Hono lifecycle |
| Thin API server | Complete | `src/service/api-server.ts` stays a thin Hono composition root; the boundary test caps it at 120 lines |
| Release review route typing | Complete | `release-review-routes.ts` has no `RouteDependency = any`; `npm run test:service-route-boundary` |
| Account route typing/services | Complete | `account-routes.ts` has no `RouteDependency = any`; `npm run test:service-route-boundary` |
| Admin route typing/services | Complete | `admin-routes.ts` has no `RouteDependency = any`; degraded-mode audit actions are typed in the admin audit contract |
| Pipeline route use-case services | Complete | Split into execution, verification, filing, and async route modules; all pipeline leaf routes are strongly typed |
| Webhook provider boundary | Complete | Email and Stripe webhooks split by provider; both provider routes are strongly typed |

## Next order

1. Keep the thin API-server and route-boundary tests green as new service routes evolve.
2. Prefer typed service contracts over route-local store wiring in any new HTTP module.
3. Do not widen the public product story from service internals; README and overview docs remain product truth sources.

## Current boundary debt

No explicit `RouteDependency = any` debt remains in `src/service/http/routes`.

The main `api-server.ts` no longer owns route dependency construction, release runtime wiring, hosted account support wiring, or HTTP route runtime construction. Those boundaries now live under `src/service/bootstrap`.
