# Hosted Account Visibility

This guide shows hosted customers where current plan, usage, quota, entitlement, feature, invoice, charge, and billing state live today.

For prices, free evaluation, trial posture, and production licensing, use [Commercial packaging, pricing, and evaluation](product-packaging.md).

For exact route order, auth boundaries, success signals, and failure signals, use [Hosted journey contract](hosted-journey-contract.md).

For the first hosted API call after signup, use [First hosted API call](hosted-first-api-call.md).

## Start with one summary route

If a customer asks "where do I look first?", the answer is `GET /api/v1/account`.

That route returns the compact hosted account-plane view:

- `account`
- `entitlement`
- `tenantContext`
- `usage`
- `rateLimit`

It is the fastest way to confirm which tenant is active, which plan is effective, whether access is currently enabled, and how much hosted runtime budget remains.

## Visibility map

| Need to inspect | Route | Auth | What comes back | Truth owner |
|---|---|---|---|---|
| Current account, plan, entitlement, usage, and rate limit in one read | `GET /api/v1/account` | account session or `Authorization: Bearer <tenant_api_key>` | `account`, `entitlement`, `tenantContext`, `usage`, `rateLimit` | Attestor account plane |
| Current quota counters and rate-limit budget | `GET /api/v1/account/usage` | account session or `Authorization: Bearer <tenant_api_key>` | `tenantContext`, `usage`, `rateLimit` | Attestor account plane |
| Current entitlement state | `GET /api/v1/account/entitlement` | account session or `Authorization: Bearer <tenant_api_key>` | `entitlement` | Attestor entitlement read model |
| Current feature grants on top of the effective plan | `GET /api/v1/account/features` | account session or `Authorization: Bearer <tenant_api_key>` | feature list plus feature summary | Attestor feature projection from plan plus Stripe entitlement summary |
| Invoice, charge, line-item, and entitlement export for account visibility or CSV handoff | `GET /api/v1/account/billing/export?format=json|csv&limit=<n>` | account session or `Authorization: Bearer <tenant_api_key>` | `checkout`, `invoices`, `charges`, `lineItems`, `entitlementFeatures`, `reconciliation`, `summary` | Attestor export view over Stripe-backed and ledger-backed billing truth |
| Per-invoice reconciliation status for review work | `GET /api/v1/account/billing/reconciliation?limit=<n>` | account session with `account_admin`, `billing_admin`, or `read_only` | `entitlement`, `reconciliation` | Attestor reconciliation view |
| Open self-service billing UI | `POST /api/v1/account/billing/portal` | account session with `account_admin` or `billing_admin` | `portalSessionId`, `portalUrl`, `mock` | Attestor creates the session; Stripe hosts the portal |
| Start paid hosted upgrade | `POST /api/v1/account/billing/checkout` | account session with `account_admin` or `billing_admin` plus `Idempotency-Key` | `checkoutSessionId`, `checkoutUrl`, `planId`, `trialDays`, `mock` | Attestor starts checkout; Stripe collects payment |

## What Attestor owns

Attestor owns the customer-visible control view before and around consequence:

- hosted account identity and tenant context
- usage and quota projection
- rate-limit projection
- entitlement state and access posture
- feature projection on top of the effective plan
- billing export and reconciliation read models
- checkout-session creation and billing-portal session creation

That is why the customer can stay on one account plane while moving from evaluation to paid hosted use.

## What Stripe owns

Stripe still owns the billing system itself:

- payment method collection and storage
- hosted checkout payment flow
- hosted customer portal UI
- invoice rendering and payment collection
- subscription lifecycle changes
- asynchronous billing event delivery

Attestor does not replace those Stripe surfaces. It creates the customer handoff into them, then converges the resulting lifecycle back into account-plane entitlement and feature state through signed webhook processing.

## How to read the state in practice

Use this order:

1. call `GET /api/v1/account` to see the compact current state
2. call `GET /api/v1/account/usage` if the question is specifically quota, remaining budget, or rate limit
3. call `GET /api/v1/account/entitlement` if the question is access state, effective plan, Stripe subscription status, or last billing event
4. call `GET /api/v1/account/features` if the question is which capability is granted, denied, plan-default, or Stripe-managed
5. call `GET /api/v1/account/billing/export` when finance, support, or operations needs invoice/charge/export detail or CSV output
6. call `GET /api/v1/account/billing/reconciliation` when a human reviewer needs per-invoice reconciliation status
7. call `POST /api/v1/account/billing/portal` when the customer needs to act inside Stripe

## Important shape details

- Attestor currently returns usage and rate-limit visibility in JSON response bodies through `usage` and `rateLimit`; this guide does not claim a separate public header contract.
- `GET /api/v1/account/billing/export` can return `json` or `csv`, and the JSON payload includes a `summary.dataSource` value such as `stripe_live`, `ledger_derived`, `mock_summary`, or `empty`.
- `GET /api/v1/account/features` is the clean place to answer "is this capability actually granted?" without forcing callers to interpret raw Stripe objects.
- `GET /api/v1/account/billing/reconciliation` is session-only on purpose; it is for account-plane review work, not for generic tenant runtime calls.
- `POST /api/v1/account/billing/portal` and `POST /api/v1/account/billing/checkout` do not return invoices or subscription state directly. They return the short-lived handoff into Stripe-hosted UI.

## What not to mix together

Keep these truth sources separate:

- use [Commercial packaging, pricing, and evaluation](product-packaging.md) for price, free path, trial, and licensing questions
- use this guide for "where do I inspect current hosted state?" questions
- use [Stripe commercial bootstrap](stripe-commercial-bootstrap.md) only for operator setup, not as a customer pricing page

That separation keeps the customer story clean: pricing is one truth source, current state is another, and operator bootstrap stays operator-facing.
