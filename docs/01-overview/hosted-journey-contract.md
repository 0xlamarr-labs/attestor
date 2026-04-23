# Hosted Journey Contract

This is the canonical customer journey contract for the Attestor hosted path.

It defines the supported customer sequence, route ownership, auth boundary, success signals, and failure signals. It does not define pricing or operator Stripe setup.

- Pricing, free evaluation, trial posture, and production licensing live in [Commercial packaging, pricing, and evaluation](product-packaging.md).
- The short narrative buying flow lives in [Hosted customer journey](hosted-customer-journey.md).
- The customer-facing operating model and decision vocabulary live in [Operating model](operating-model.md).
- The first customer API-call quickstart lives in [First hosted API call](hosted-first-api-call.md).
- The first finance and crypto integration examples live in [Finance and crypto first integrations](finance-and-crypto-first-integrations.md).
- The current account-plane visibility map lives in [Hosted account visibility](hosted-account-visibility.md).
- Operator Stripe setup lives in [Stripe commercial bootstrap](stripe-commercial-bootstrap.md).
- The machine-readable contract descriptor lives in `src/service/hosted-journey-contract.ts`.

## Contract Rules

- Attestor remains one product with one platform core.
- Hosted and customer-operated are delivery paths, not separate products.
- Finance and crypto are packs on the same core, not separate primary product identities.
- Attestor does not auto-detect what pack to run. The customer system calls the relevant hosted path for the consequence it needs to control.
- Checkout starts the paid hosted path, but signed Stripe webhooks are what converge billing and entitlement state back into Attestor.
- Customer systems still own their data, models, agents, wallets, and downstream execution systems.

## Auth Boundaries

| Boundary | Used for | Contract posture |
|---|---|---|
| no auth | initial hosted signup | only creates the first account/user/key path |
| account session | account plane, billing checkout, billing portal, API-key management | role-gated for account or billing admin work |
| tenant API key | customer systems calling Attestor before consequence | identifies the tenant, plan, quota, and rate-limit context |
| `Stripe-Signature` | billing webhook convergence | verified with `STRIPE_WEBHOOK_SECRET`; customers do not call this route |

## Canonical Sequence

| Step | Route(s) | Caller | Success means | Fails when |
|---|---|---|---|---|
| create hosted account | `POST /api/v1/auth/signup` | customer | `201`, account session cookie, account admin user, first tenant API key, evaluation commercial metadata | signup input is incomplete or account/user state conflicts |
| inspect evaluation state | `GET /api/v1/account`, `GET /api/v1/account/usage`, `GET /api/v1/account/entitlement`, `GET /api/v1/account/features` | customer | current account, plan, usage, rate limit, entitlement, and feature state are visible | tenant/account context is not resolvable or account lifecycle blocks access |
| make first Attestor call | `POST /api/v1/pipeline/run`, `POST /api/v1/verify` | customer system | decision/proof material is produced before downstream consequence, and proof can be verified | request shape is invalid, quota/rate limit blocks the run, or required proof material is missing |
| upgrade through checkout | `POST /api/v1/account/billing/checkout` | customer | Stripe checkout session and URL are returned for `starter`, `pro`, or `enterprise`; `Idempotency-Key` protects retries | idempotency key is missing, plan is unsupported, or account/billing admin authority is missing |
| converge billing state | `POST /api/v1/billing/stripe/webhook` | Stripe | signed billing event is applied, ignored, deduped, or rejected deterministically; entitlement state converges | signature is missing/invalid, payload hash conflicts, or webhook secret is not configured |
| operate account plane | `POST /api/v1/account/billing/portal`, `GET /api/v1/account/billing/export`, `GET /api/v1/account/billing/reconciliation`, `GET /api/v1/account/api-keys`, `POST /api/v1/account/api-keys` | customer | billing portal opens for Stripe-backed accounts; invoice/export/reconciliation views stay attached to the same account plane; API keys can be listed or issued from the same account plane | required account role is missing, billing state is not ready, active key limit is reached, or billing export input is invalid |

## Route Contract

| Route | Auth | Key request contract | Key response contract |
|---|---|---|---|
| `POST /api/v1/auth/signup` | none | `AuthSignupRequest` | `AuthSignupResponse` |
| `GET /api/v1/account` | account session or tenant API key | account context | `AccountSummaryResponse` |
| `GET /api/v1/account/usage` | account session or tenant API key | account/tenant context | `AccountUsageResponse` |
| `GET /api/v1/account/entitlement` | account session or tenant API key | account/tenant context | account entitlement view |
| `GET /api/v1/account/features` | account session or tenant API key | account/tenant context | `AccountFeaturesResponse` |
| `POST /api/v1/pipeline/run` | tenant API key for hosted use | `PipelineRunRequest` | `PipelineRunResponse` |
| `POST /api/v1/verify` | tenant API key for hosted use | certificate, public key, and PKI material | `VerifyResponse` |
| `POST /api/v1/account/billing/checkout` | account session with account or billing admin role | `planId` plus `Idempotency-Key` | `AccountBillingCheckoutResponse` |
| `POST /api/v1/account/billing/portal` | account session with account or billing admin role | account session | `AccountBillingPortalResponse` |
| `GET /api/v1/account/billing/export` | account session or tenant API key | `format=json|csv`, optional `limit` | `AccountBillingExportResponse` or CSV export |
| `GET /api/v1/account/billing/reconciliation` | account session with account, billing, or read-only role | optional `limit` | `AccountBillingReconciliationResponse` |
| `GET /api/v1/account/api-keys` | account session with account admin role | account session | `AccountApiKeysListResponse` |
| `POST /api/v1/account/api-keys` | account session with account admin role | account session | `AccountIssueApiKeyResponse` |
| `POST /api/v1/billing/stripe/webhook` | Stripe signature | raw Stripe event payload | billing webhook processing result |

## Billing Convergence Contract

Attestor starts hosted paid upgrade through Stripe Checkout and keeps the customer on the same hosted account plane. The checkout response is not the final source of account entitlement truth.

The final hosted billing posture converges through signed Stripe webhooks:

- checkout completion
- subscription create/update/delete/pause/resume
- invoice paid or failed
- charge succeeded/failed/refunded
- `entitlements.active_entitlement_summary.updated`

The customer-facing result is visible through:

- `GET /api/v1/account`
- `GET /api/v1/account/entitlement`
- `GET /api/v1/account/features`
- `GET /api/v1/account/usage`
- `GET /api/v1/account/billing/export`
- `GET /api/v1/account/billing/reconciliation`
- `POST /api/v1/account/billing/portal`

## What This Contract Does Not Do

- It does not publish a full OpenAPI document yet.
- It does not replace the pricing truth source.
- It does not replace operator Stripe bootstrap.
- It does not make Attestor a wallet, custody platform, file workspace, or orchestration layer.
- It does not imply that Attestor guesses a pack automatically from a request.
