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

Reviewed again on 2026-04-22 before Step 03:

- OAuth bearer-token usage keeps the `Authorization: Bearer <token>` header as the interoperable protected-resource pattern and warns that bearer tokens must be protected from disclosure in storage and transport: [RFC 6750](https://datatracker.ietf.org/doc/html/rfc6750)
- OpenAPI 3.1 models API-key, HTTP bearer, and mutual TLS security schemes explicitly, so the hosted journey contract should keep auth boundaries route-specific instead of implying automatic pack detection or magical routing: [OpenAPI Security Scheme Object](https://spec.openapis.org/oas/latest.html#security-scheme-object)
- OWASP API2:2023 keeps broken authentication as a primary API risk; the signup path must prove that issued credentials work and revoked/anonymous credentials fail closed: [OWASP API2:2023 Broken Authentication](https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/)
- OWASP API4:2023 calls out missing interaction/resource limits as a serious API risk; the free community evaluation path must show quota enforcement, not just a documented limit: [OWASP API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)

Reviewed again on 2026-04-22 before Step 04:

- Stripe idempotent requests are the supported retry pattern for `POST` requests, and reused keys with changed parameters should be treated as misuse rather than a new operation: [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- Stripe Checkout Sessions create the hosted payment/subscription entry point, while the customer portal is the Stripe-hosted self-service surface for billing information, payment methods, invoices, and subscription status: [Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions/create), [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- Stripe webhook verification depends on the exact raw request body and the `Stripe-Signature` header, so Attestor must keep signature verification ahead of event processing: [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature)
- Stripe Entitlements emits active entitlement summary updates as billing-managed feature-access truth, so Attestor must converge those events into account-plane authorization rather than treating checkout as sufficient by itself: [Stripe Entitlements](https://docs.stripe.com/billing/entitlements), [Stripe event types](https://docs.stripe.com/api/events/types)

Reviewed again on 2026-04-22 before Step 05:

- RFC 9110 defines the HTTP `Authorization` request header as the standard place for credentials used by a client to authenticate to an origin server, so the first-call quickstart should show tenant API keys in headers, not URLs: [RFC 9110 Authorization](https://www.rfc-editor.org/rfc/rfc9110.html#name-authorization)
- RFC 6750 keeps `Authorization: Bearer <token>` as the interoperable protected-resource pattern and warns that bearer tokens need protection from disclosure in storage and transport: [RFC 6750 Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)
- OWASP API2:2023 lists sensitive authentication details in URLs and unvalidated tokens as broken-authentication risks; the quickstart should teach secret handling before it teaches the first API call: [OWASP API2:2023 Broken Authentication](https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/)
- OWASP API4:2023 recommends limiting how often clients interact with APIs, so the first-call path should show quota/rate-limit response handling as expected product behavior, not as a surprise: [OWASP API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)

Reviewed again on 2026-04-22 before Step 06:

- SEC Inline XBRL guidance and the EDGAR Filer Manual keep structured financial reporting tied to machine-readable filing requirements, which supports finance as the first hard consequence boundary rather than a soft demo: [SEC Inline XBRL](https://www.sec.gov/data-research/structured-data/inline-xbrl), [SEC EDGAR Filer Manual](https://www.sec.gov/submit-filings/edgar-filer-manual)
- XBRL International describes Inline XBRL as a single human-readable and machine-readable reporting format, which matches Attestor's finance first-integration posture around structured output, evidence, and verification before filing-like consequences: [XBRL Inline XBRL](https://www.xbrl.org/ixbrl)
- EIP-712 and ERC-1271 remain the relevant structured-data and smart-account validation anchors for crypto authorization evidence, so Attestor should describe crypto as signed authorization/admission infrastructure, not as a wallet: [EIP-712](https://eips.ethereum.org/EIPS/eip-712), [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271)
- ERC-4337 and EIP-7702 define concrete account-abstraction and delegated-EOA execution surfaces, so Attestor's first crypto integration examples should name bundler/delegated-runtime handoffs without claiming a new public hosted route: [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337), [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)

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
| Completed | 6 |
| In progress | 0 |
| Not started | 2 |
| Current posture | Active; hosted signup, Stripe billing convergence, first customer API-call guidance, and finance/crypto first-integration examples are hardened; the next gap is account-plane visibility guidance |

## Frozen Step List

| Step | Status | Deliverable | Evidence | Notes |
|---|---|---|---|---|
| 01 | complete | Audit existing hosted API, account, billing, Stripe, and documentation surfaces | `docs/01-overview/hosted-product-flow-audit.md`, `tests/hosted-product-flow-docs.test.ts`, `docs/01-overview/product-packaging.md`, `docs/01-overview/hosted-customer-journey.md`, `docs/01-overview/stripe-commercial-bootstrap.md`, `src/service/http/routes/account-routes.ts`, `src/service/http/routes/stripe-webhook-routes.ts`, `scripts/probe-production-hosted-flow.ts`, `tests/live-api.test.ts` | Existing surfaces cover signup, first API key, account overview, usage, entitlement, API key lifecycle, checkout, portal, webhook processing, and billing entitlement convergence. Remaining work is hardening the external customer journey contract, examples, and readiness gates. |
| 02 | complete | Define one canonical hosted journey contract | `src/service/hosted-journey-contract.ts`, `docs/01-overview/hosted-journey-contract.md`, `tests/hosted-product-flow-contract.test.ts`, `tests/hosted-product-flow-docs.test.ts`, `docs/01-overview/hosted-customer-journey.md`, `docs/01-overview/product-packaging.md` | The hosted path now has a machine-readable journey descriptor plus a customer-facing contract doc covering route order, auth boundaries, success signals, failure signals, pricing/operator truth-source separation, checkout idempotency, Stripe signature boundaries, and webhook-based entitlement convergence without adding a second product story. |
| 03 | complete | Harden signup-to-first-API-key verification | `tests/hosted-signup-first-api-key-flow.test.ts`, `tests/hosted-product-flow-docs.test.ts`, `package.json`, `docs/01-overview/hosted-product-flow-audit.md` | The focused gate proves hosted signup, session issuance, one-time plaintext first API key, bearer-authenticated account/usage/entitlement access, first governed consequence call, community quota exhaustion at run 11, hidden historical plaintext secrets, second key issue, revoked signup-key rejection, and replacement-key continuity without running the full live API suite. |
| 04 | complete | Harden Stripe checkout, portal, webhook, and entitlement convergence | `tests/hosted-stripe-billing-convergence-flow.test.ts`, `tests/hosted-product-flow-docs.test.ts`, `package.json`, `docs/01-overview/hosted-product-flow-audit.md` | The focused gate proves paid hosted checkout idempotency, hosted portal readiness, raw-body Stripe signature enforcement, duplicate replay behavior, payload conflict rejection, checkout-completed pending posture, subscription past_due fail-closed suspension, active subscription recovery, invoice delinquency/recovery, entitlement summary convergence, and Stripe-backed feature grants without relying on the full live API suite. |
| 05 | complete | Add the first customer API-call quickstart | `docs/01-overview/hosted-first-api-call.md`, `README.md`, `docs/01-overview/hosted-customer-journey.md`, `docs/01-overview/hosted-journey-contract.md`, `src/service/hosted-journey-contract.ts`, `tests/hosted-product-flow-docs.test.ts`, `tests/hosted-product-flow-contract.test.ts`, `docs/01-overview/hosted-product-flow-audit.md` | The quickstart shows the first tenant API-key usage preflight, the first `POST /api/v1/pipeline/run` consequence gate, expected decision/proof/tenant/usage shape, Bearer-header secret handling, quota/rate-limit failure signals, optional signed proof verification, and downstream fail-closed responsibility without adding a new product surface or claiming automatic pack detection. |
| 06 | complete | Add finance and crypto first-integration examples | `docs/01-overview/finance-and-crypto-first-integrations.md`, `README.md`, `docs/01-overview/hosted-customer-journey.md`, `docs/01-overview/hosted-journey-contract.md`, `src/service/hosted-journey-contract.ts`, `tests/hosted-product-flow-docs.test.ts`, `tests/hosted-product-flow-contract.test.ts`, `docs/01-overview/hosted-product-flow-audit.md` | The first-integration guide preserves the one-product model while making the real first surfaces explicit: finance starts through the hosted `POST /api/v1/pipeline/run` path, and crypto starts through the packaged `attestor/crypto-authorization-core` and `attestor/crypto-execution-admission` surfaces for wallets, Safe guards, ERC-4337 bundlers, modular accounts, EIP-7702 delegated EOAs, x402 resource servers, custody policy engines, and intent solvers. It also states that crypto must not be described as generally available through a public hosted route until a committed route contract, test, and tracker exist. |
| 07 | not_started | Add usage, quota, billing, and entitlement visibility guide |  | Make account-plane visibility obvious: what customers can inspect, which endpoint owns it, what Stripe owns, and what operators must not expose as customer-facing pricing truth. |
| 08 | not_started | Add final docs truth-source and readiness gate |  | Add a final guard that README, product packaging, hosted customer journey, Stripe bootstrap, system overview, route contract, probes, and tests agree before calling the hosted product flow sale-ready. |

## Immediate Next Step

Step 07 should add a compact usage, quota, billing, and entitlement visibility guide that shows what customers inspect inside Attestor and what remains owned by Stripe.
