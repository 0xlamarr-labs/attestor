# Hosted Product Flow Audit

Reviewed on 2026-04-22.

This audit records what already exists in the Attestor hosted product path and what still needs to be hardened. It is intentionally narrow: hosted account, API key, usage, billing, Stripe, entitlement, and adoption flow.

It does not reopen the crypto buildout, change the one-product positioning, or turn Attestor into a file workspace, wallet, custody platform, or orchestration layer.

## Current Conclusion

The hosted product path is sale-ready for its current scope.

That scope is narrow and explicit: one product, one hosted account plane, one pricing truth source, one customer journey contract, one first-call path, one finance/crypto entry map, one account visibility map, Stripe-backed checkout and portal handoffs, webhook-driven billing convergence, and a final docs/probe/test gate that guards the public story against drift.

## Truth Sources Already In Place

| Surface | Source of truth | What it owns |
|---|---|---|
| Product framing | `README.md` | one product, platform core, modular packs, adoption links |
| Pricing and packaging | `docs/01-overview/product-packaging.md` | public plans, prices, free evaluation, trial posture, production license boundary |
| Hosted customer journey | `docs/01-overview/hosted-customer-journey.md` | signup, first API key, checkout, portal, account plane, customer flow |
| First customer API call | `docs/01-overview/hosted-first-api-call.md` | first tenant-key call, usage preflight, consequence gate, decision handling |
| Finance and crypto first integrations | `docs/01-overview/finance-and-crypto-first-integrations.md` | one-product mapping from hosted adoption into finance HTTP and crypto package integration paths |
| Hosted account visibility | `docs/01-overview/hosted-account-visibility.md` | current plan, usage, entitlement, feature, invoice, charge, and billing visibility map |
| Stripe operator setup | `docs/01-overview/stripe-commercial-bootstrap.md` | live Stripe prices, live account, payout setup, env vars, webhook configuration |
| Architecture posture | `docs/02-architecture/system-overview.md` | one-product architecture, core/pack maturity, active work posture |
| Hardening plan | `docs/02-architecture/hosted-product-flow-buildout.md` | frozen step list for adoption hardening |

## Existing Runtime Surface

The shipped hosted customer path maps to these service routes:

| Customer or operator need | Route | Evidence |
|---|---|---|
| Create hosted account and first user | `POST /api/v1/auth/signup` | `src/service/http/routes/account-routes.ts`, `src/service/application/account-auth-service.ts`, `tests/live-api.test.ts` |
| Log in | `POST /api/v1/auth/login` | `src/service/http/routes/account-routes.ts`, `tests/live-api.test.ts` |
| Inspect current session | `GET /api/v1/auth/me` | `src/service/http/routes/account-routes.ts`, `tests/live-api.test.ts` |
| Inspect account, entitlement, usage, and rate limit | `GET /api/v1/account` | `src/service/http/routes/account-routes.ts` |
| Inspect usage/quota | `GET /api/v1/account/usage` | `src/service/http/routes/account-routes.ts`, `tests/live-api.test.ts`, `tests/live-control-plane-pg.test.ts` |
| Inspect billing entitlement | `GET /api/v1/account/entitlement` | `src/service/http/routes/account-routes.ts`, `tests/live-api.test.ts`, `tests/live-control-plane-pg.test.ts` |
| Inspect feature posture | `GET /api/v1/account/features` | `src/service/http/routes/account-routes.ts` |
| Inspect invoice, charge, and entitlement export shape | `GET /api/v1/account/billing/export` | `src/service/http/routes/account-routes.ts`, `src/service/billing-export.ts`, `tests/live-api.test.ts` |
| Inspect billing reconciliation status | `GET /api/v1/account/billing/reconciliation` | `src/service/http/routes/account-routes.ts`, `src/service/billing-reconciliation.ts`, `tests/live-api.test.ts` |
| Manage API keys | `GET /api/v1/account/api-keys`, `POST /api/v1/account/api-keys`, `POST /api/v1/account/api-keys/:id/rotate`, `POST /api/v1/account/api-keys/:id/deactivate`, `POST /api/v1/account/api-keys/:id/reactivate`, `POST /api/v1/account/api-keys/:id/revoke` | `src/service/http/routes/account-routes.ts`, `src/service/application/account-api-key-service.ts`, `tests/live-api.test.ts` |
| Start paid hosted checkout | `POST /api/v1/account/billing/checkout` | `src/service/http/routes/account-routes.ts`, `src/service/stripe-billing.ts`, `tests/stripe-commercial-config.test.ts`, `tests/live-api.test.ts` |
| Open billing portal | `POST /api/v1/account/billing/portal` | `src/service/http/routes/account-routes.ts`, `src/service/stripe-billing.ts`, `tests/stripe-commercial-config.test.ts`, `tests/live-api.test.ts` |
| Process Stripe billing lifecycle events | `POST /api/v1/billing/stripe/webhook` | `src/service/http/routes/stripe-webhook-routes.ts`, `src/service/application/stripe-webhook-service.ts`, `src/service/application/stripe-webhook-billing-processor.ts`, `tests/stripe-webhook-events.test.ts`, `tests/live-api.test.ts` |

## Existing Service Boundaries

The refactor already moved the most important hosted flow responsibilities behind typed application services:

- `AccountAuthService` owns signup, first user, first API key, session issuance, and signup commercial metadata.
- `AccountApiKeyService` owns API-key list, issue, rotate, status change, and revoke.
- `AccountStateService` owns account-plane reads and current usage context.
- `PipelineUsageService` owns quota check and consume behavior for pipeline routes.
- `StripeWebhookService` owns signed webhook verification, dedupe, replay/conflict handling, and claim finalization.
- `StripeWebhookBillingProcessor` owns supported Stripe billing events, subscription/invoice/charge/entitlement normalization, account matching, entitlement sync, audit, and lifecycle effects.

## Existing Test And Probe Coverage

The current repo already covers important parts of the hosted product path:

- `tests/live-api.test.ts` proves signup, first API key, community quota, API-key lifecycle, checkout, portal, signed webhook processing, entitlement summary updates, invoice outcomes, delinquency/suspension behavior, and route observability.
- `tests/live-control-plane-pg.test.ts` covers the same billing/entitlement shape against shared control-plane persistence.
- `tests/stripe-commercial-config.test.ts` covers Stripe checkout/portal configuration, hosted plan pricing env vars, starter trial defaults, mock mode, and unsafe return URL rejection.
- `tests/stripe-webhook-events.test.ts` guards the supported Stripe event list and canonical webhook route.
- `tests/service-stripe-webhook-service.test.ts` covers signature enforcement, dedupe, replay, conflict, and shared-ledger/control-plane claim behavior.
- `tests/service-stripe-webhook-billing-processor.test.ts` covers billing event processing behavior behind the route.
- `tests/hosted-product-flow-readiness.test.ts` is the final docs/probe/test gate that checks truth-source separation, script exposure, production probe coverage, tracker completion, and sale-ready posture before the hosted path can be called clean.
- `scripts/probe-production-hosted-flow.ts` exists as a production-oriented probe for account creation, first API key use, governed pipeline call, summary/usage/entitlement/features visibility, billing export and reconciliation reads, checkout, portal, signed webhook simulation, and cleanup.

## Hardening Gaps

These are the remaining gaps that matter before calling the hosted product path truly clean:

1. **Canonical hosted journey contract.** Addressed after this audit by `docs/01-overview/hosted-journey-contract.md` and `src/service/hosted-journey-contract.ts`; keep that pair as the route/auth/success/failure contract.
2. **Focused hosted flow probe.** Addressed by `tests/hosted-signup-first-api-key-flow.test.ts`, which proves signup -> first API key -> usage/quota -> first consequence call -> quota rejection -> API-key listing/issue/revoke without pulling in the entire service matrix.
3. **Focused billing convergence probe.** Addressed by `tests/hosted-stripe-billing-convergence-flow.test.ts`, which proves checkout idempotency, checkout-completed pending posture, portal readiness, signed webhook processing, duplicate replay, payload conflict rejection, subscription suspension/reactivation, invoice delinquency/recovery, entitlement summary convergence, and fail-closed tenant API behavior.
4. **Customer first-call quickstart.** Addressed by `docs/01-overview/hosted-first-api-call.md`, which shows the first tenant API-key usage preflight, first `POST /api/v1/pipeline/run` consequence gate, expected decision/tenant/usage shape, secret handling, failure signals, and downstream fail-closed responsibility.
5. **Finance and crypto adoption examples.** Addressed by `docs/01-overview/finance-and-crypto-first-integrations.md`, which keeps one-product language while separating the real first integration surfaces: finance starts with the hosted `POST /api/v1/pipeline/run` route, and crypto starts with the packaged `attestor/crypto-authorization-core` / `attestor/crypto-execution-admission` surfaces until a future route contract exists.
6. **Usage and billing visibility guide.** Addressed by `docs/01-overview/hosted-account-visibility.md`, which maps current plan, usage, rate limit, entitlement, feature, billing export, reconciliation, checkout, and portal visibility onto the shipped hosted account-plane routes while keeping pricing truth and operator Stripe truth separate.
7. **Final truth-source gate.** Addressed by `tests/hosted-product-flow-readiness.test.ts`, `package.json`, and `scripts/probe-production-hosted-flow.ts`, which keep README, pricing, hosted journey, account visibility, Stripe bootstrap, system overview, route contract, runtime probes, and focused hosted-flow gates aligned before calling the hosted path sale-ready.

## Decision

The hosted product flow hardening track is complete for its current scope.

Future hosted-flow edits should preserve the docs, contract, readiness, and production-probe gates before widening the product story again.
