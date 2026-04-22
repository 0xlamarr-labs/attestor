# Hosted Product Flow Audit

Reviewed on 2026-04-22.

This audit records what already exists in the Attestor hosted product path and what still needs to be hardened. It is intentionally narrow: hosted account, API key, usage, billing, Stripe, entitlement, and adoption flow.

It does not reopen the crypto buildout, change the one-product positioning, or turn Attestor into a file workspace, wallet, custody platform, or orchestration layer.

## Current Conclusion

The hosted API and billing pieces are real. The remaining work is not "build Stripe" or "invent an API." The remaining work is to make the customer journey contract, proof examples, and readiness gates tight enough that the product is understandable and hard to mis-document.

## Truth Sources Already In Place

| Surface | Source of truth | What it owns |
|---|---|---|
| Product framing | `README.md` | one product, platform core, modular packs, adoption links |
| Pricing and packaging | `docs/01-overview/product-packaging.md` | public plans, prices, free evaluation, trial posture, production license boundary |
| Hosted customer journey | `docs/01-overview/hosted-customer-journey.md` | signup, first API key, checkout, portal, account plane, customer flow |
| First customer API call | `docs/01-overview/hosted-first-api-call.md` | first tenant-key call, usage preflight, consequence gate, decision handling |
| Finance and crypto first integrations | `docs/01-overview/finance-and-crypto-first-integrations.md` | one-product mapping from hosted adoption into finance HTTP and crypto package integration paths |
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
- `scripts/probe-production-hosted-flow.ts` exists as a production-oriented probe for account creation, first API key use, governed pipeline call, checkout, portal, signed webhook simulation, and cleanup.

## Hardening Gaps

These are the remaining gaps that matter before calling the hosted product path truly clean:

1. **Canonical hosted journey contract.** Addressed after this audit by `docs/01-overview/hosted-journey-contract.md` and `src/service/hosted-journey-contract.ts`; keep that pair as the route/auth/success/failure contract.
2. **Focused hosted flow probe.** Addressed by `tests/hosted-signup-first-api-key-flow.test.ts`, which proves signup -> first API key -> usage/quota -> first consequence call -> quota rejection -> API-key listing/issue/revoke without pulling in the entire service matrix.
3. **Focused billing convergence probe.** Addressed by `tests/hosted-stripe-billing-convergence-flow.test.ts`, which proves checkout idempotency, checkout-completed pending posture, portal readiness, signed webhook processing, duplicate replay, payload conflict rejection, subscription suspension/reactivation, invoice delinquency/recovery, entitlement summary convergence, and fail-closed tenant API behavior.
4. **Customer first-call quickstart.** Addressed by `docs/01-overview/hosted-first-api-call.md`, which shows the first tenant API-key usage preflight, first `POST /api/v1/pipeline/run` consequence gate, expected decision/tenant/usage shape, secret handling, failure signals, and downstream fail-closed responsibility.
5. **Finance and crypto adoption examples.** Addressed by `docs/01-overview/finance-and-crypto-first-integrations.md`, which keeps one-product language while separating the real first integration surfaces: finance starts with the hosted `POST /api/v1/pipeline/run` route, and crypto starts with the packaged `attestor/crypto-authorization-core` / `attestor/crypto-execution-admission` surfaces until a future route contract exists.
6. **Usage and billing visibility guide.** Customers should know which endpoint tells them current plan, usage, entitlement, rate limit, invoices/charges, and what remains in Stripe.
7. **Final truth-source gate.** README, pricing, hosted journey, Stripe bootstrap, system overview, route contract, and probes should be tested together so future edits cannot silently reintroduce duplication or contradiction.

## Decision

Continue with the hosted product flow hardening track before reopening new crypto work.

The next implementation step is to add the usage, quota, billing, and entitlement visibility guide.
