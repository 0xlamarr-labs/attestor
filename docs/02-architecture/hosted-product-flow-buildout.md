# Hosted Product Flow And Adoption Hardening Tracker

This tracker covers the Attestor hosted API, account, billing, and adoption flow only.

The goal is not to add another product line. The goal is to make the existing hosted product path externally understandable, commercially usable, and mechanically verifiable without weakening the one-product Attestor model.

## Guardrails For This Tracker

- The numbered step list below is frozen for this buildout track.
- Step ids and titles do not get rewritten or renumbered later.
- We may append clarifying notes, acceptance criteria, or sub-notes.
- We may only change the `Status`, `Evidence`, and `Notes` columns as work progresses.
- Keep Attestor as one product with one platform core and modular packs.
- Do not invent public routes, request schemas, prices, or hosted capabilities that are not backed by shipped code or a committed truth-source document.
- Keep public pricing, free evaluation, trial posture, delivery paths, and production licensing in `docs/01-overview/product-packaging.md`.
- Keep hosted signup, first API key, checkout, portal, usage, and account-plane flow in `docs/01-overview/hosted-customer-journey.md`.
- Keep operator Stripe setup in `docs/01-overview/stripe-commercial-bootstrap.md`; it must not become a second public pricing page.

## Why This Track Exists

The API, account plane, API keys, usage, Stripe checkout, Stripe portal, webhook processing, and entitlement synchronization already exist. What is still easy to lose is the adoption shape around them.

A serious buyer or evaluator needs to see one coherent path:

1. choose the commercial/evaluation path
2. create the hosted account
3. receive the first API key
4. call Attestor before consequence
5. upgrade through Stripe when moving onto paid hosted use
6. keep the same account as the control point for usage, entitlement, billing, and keys

This track hardens that path as a product surface, not as a new engine.

## Fresh Research Anchors

Reviewed on 2026-04-22 before opening this track:

- Stripe Checkout is the supported hosted payment entry point for redirecting customers into Stripe-managed payment collection and returning them to the product: [Stripe Checkout](https://docs.stripe.com/payments/checkout)
- Stripe Billing Customer Portal is the Stripe-managed place where customers manage payment methods, invoices, subscriptions, and billing details after checkout: [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- Stripe subscription webhooks are required for asynchronous subscription lifecycle changes, because successful payment, cancellation, failed payment, and subscription status changes do not all happen inside the initial checkout request: [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- Stripe Entitlements models feature access as entitlement state and emits `entitlements.active_entitlement_summary.updated`, which matches Attestor's need to converge billing state into account-plane authorization: [Stripe Entitlements](https://docs.stripe.com/billing/entitlements)
- OpenAPI 3.1 defines a machine-readable API description format for HTTP APIs, so the hosted customer journey should eventually have a compact external contract instead of relying only on prose: [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- OWASP API Security Top 10 2023 keeps broken object-level authorization, broken authentication, broken function-level authorization, and unrestricted resource consumption as first-order API risks, so the hosted path must keep account/session/API-key/role/quota boundaries explicit: [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)

Reviewed again on 2026-04-22 before Step 02:

- Stripe idempotent request guidance supports requiring a unique idempotency key on checkout creation so customer retries do not create accidental duplicate operations: [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- Stripe Checkout is a hosted payment collection surface, while the Billing Customer Portal is the customer-managed billing/subscription surface after checkout: [Stripe Checkout](https://docs.stripe.com/payments/checkout), [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- Stripe subscription and entitlement docs keep webhook-driven convergence as the reliable source for subscription, invoice, and feature-access changes after checkout: [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [Stripe Entitlements](https://docs.stripe.com/billing/entitlements)

## Architecture Decision

Treat the hosted product flow as an adoption shell around the existing Attestor core:

- public product truth stays in overview docs
- route/API truth stays tied to shipped service routes and API types
- Stripe operator truth stays separated from customer-facing pricing
- production readiness remains an operations track, not a substitute for customer onboarding
- no broad frontend, file workspace, wallet, custody, or orchestration surface is required to make the hosted API purchasable

## Progress Summary

| Metric | Value |
|---|---|
| Total frozen steps | 8 |
| Completed | 2 |
| In progress | 0 |
| Not started | 6 |
| Current posture | Active; canonical hosted journey contract is defined, and the next gap is focused signup-to-first-API-key verification |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Audit existing hosted API, account, billing, Stripe, and documentation surfaces | `docs/01-overview/hosted-product-flow-audit.md`, `tests/hosted-product-flow-docs.test.ts`, `docs/01-overview/product-packaging.md`, `docs/01-overview/hosted-customer-journey.md`, `docs/01-overview/stripe-commercial-bootstrap.md`, `src/service/http/routes/account-routes.ts`, `src/service/http/routes/stripe-webhook-routes.ts`, `scripts/probe-production-hosted-flow.ts`, `tests/live-api.test.ts` | Existing surfaces cover signup, first API key, account overview, usage, entitlement, API key lifecycle, checkout, portal, webhook processing, and billing entitlement convergence. Remaining work is hardening the external customer journey contract, examples, and readiness gates. |
| 02 | complete | Define one canonical hosted journey contract | `src/service/hosted-journey-contract.ts`, `docs/01-overview/hosted-journey-contract.md`, `tests/hosted-product-flow-contract.test.ts`, `tests/hosted-product-flow-docs.test.ts`, `docs/01-overview/hosted-customer-journey.md`, `docs/01-overview/product-packaging.md` | The hosted path now has a machine-readable journey descriptor plus a customer-facing contract doc covering route order, auth boundaries, success signals, failure signals, pricing/operator truth-source separation, checkout idempotency, Stripe signature boundaries, and webhook-based entitlement convergence without adding a second product story. |
| 03 | not_started | Harden signup-to-first-API-key verification |  | Prove the hosted evaluation path from signup through first API key, community quota, account usage, and API-key lifecycle in a focused test/probe that is smaller than the full live API suite. |
| 04 | not_started | Harden Stripe checkout, portal, webhook, and entitlement convergence |  | Prove paid hosted upgrade behavior: idempotent checkout start, portal creation, signed webhook processing, duplicate/conflict behavior, subscription state transitions, entitlement summary updates, and fail-closed delinquency/suspension behavior. |
| 05 | not_started | Add the first customer API-call quickstart |  | Add a short customer-facing flow showing how a hosted account uses its first API key to call Attestor before a consequence, without inventing broad app UI or domain-specific magic. |
| 06 | not_started | Add finance and crypto first-integration examples |  | Show how the same hosted API/adoption model maps into finance and crypto packs while preserving the one-product model and avoiding separate-product language. |
| 07 | not_started | Add usage, quota, billing, and entitlement visibility guide |  | Make account-plane visibility obvious: what customers can inspect, which endpoint owns it, what Stripe owns, and what operators must not expose as customer-facing pricing truth. |
| 08 | not_started | Add final docs truth-source and readiness gate |  | Add a final guard that README, product packaging, hosted customer journey, Stripe bootstrap, system overview, route contract, probes, and tests agree before calling the hosted product flow sale-ready. |

## Immediate Next Step

Step 03 should harden signup-to-first-API-key verification with a focused test or probe that is smaller than the full live API suite.
