# Commercial Packaging, Pricing, and Evaluation

This document is the commercial truth source for Attestor plan structure, pricing, free evaluation, hosted trial posture, delivery paths, and the production licensing boundary.

Attestor is one product: a **policy-bound release and authorization platform for high-consequence systems**. Finance is the deepest proven wedge today. Crypto extends the same platform core and control model.

## What customers buy

Customers are not buying a file workspace, chatbot shell, wallet, or separate product per domain.

They are buying:

- governed release and authorization before consequence
- portable proof and independent verification
- authority closure and auditability
- a shared platform core that can carry multiple packs
- a hosted path and a customer-operated path, depending on control requirements

Customer data, business workflows, models, agents, wallets, and operational systems stay in the customer's own environment. Attestor sits in front of the consequence boundary.

## Delivery paths

Attestor is sold through two delivery paths:

### Hosted path

For teams that want a managed product path.

What they get:

- hosted account and tenant boundary
- API keys
- usage and billing visibility
- hosted release / proof / authorization access

### Customer-operated path

For teams that need stricter runtime, isolation, or operating control.

What they get:

- the same Attestor product and core control model
- a commercial deployment path under customer control
- enterprise packaging around deployment boundary, scale, and operating requirements

## Plans, pricing, and evaluation path

| Plan | Price | Evaluation / trial posture | Intended use |
|---|---|---|
| `community` | free | zero-cost evaluation path and the first `10` hosted runs | local proof work, non-production evaluation, and first hosted tests |
| `starter` | EUR `499` / month | first paid hosted plan; shipped hosted checkout supports an operator-configured Stripe trial, with `14` days as the default bootstrap value | one serious team and one live workflow |
| `pro` | EUR `1,999` / month | paid hosted upgrade on the same account plane | several workflows or one business unit |
| `enterprise` | from EUR `7,500` / month | negotiated commercial path for stricter rollout or customer-operated deployment | negotiated scale, stricter rollout, or a customer-operated deployment boundary |

Pricing should be read together with the product shape:

- `community` is for evaluation, not a broad production commitment
- `starter` is the first paid hosted step after evaluation and can carry the hosted Stripe trial configured by the operator
- paid hosted plans stay on the same account surface
- `enterprise` is where customer-operated deployment and stricter control boundaries fit commercially

If a reader comes here from the README asking "what is free?" the answer is:

- the `community` path is the zero-cost evaluation route
- the first `10` hosted runs are included there
- the first paid hosted plan is `starter`
- the shipped hosted bootstrap supports a Stripe-backed `starter` trial with `14` days as the default bootstrap value

## How buying works

The commercial path should be simple:

1. choose the plan that matches the control boundary and usage posture
2. create the hosted account if using the hosted path
3. receive the first API key
4. open Stripe Checkout when moving onto a paid hosted plan
5. use the same account for usage, billing, entitlement, and key management
6. for customer-operated deployment, move into the enterprise commercial path before production use

For the detailed hosted signup and checkout flow, see [Hosted customer journey](hosted-customer-journey.md). For exact route order, auth boundaries, success signals, and failure signals, see [Hosted journey contract](hosted-journey-contract.md).

## Production licensing

This repository is source-available under Business Source License 1.1.

The practical commercial rule is:

- non-production use is allowed
- production use requires a commercial license until the Change Date in [LICENSE](../../LICENSE)

That applies whether Attestor is used through a hosted paid plan or through a customer-operated production deployment.

## Hosted commercial surface

The hosted commercial surface only needs to cover:

- signup and login
- account overview
- entitlement and usage
- API key lifecycle
- Stripe Checkout and Billing Portal
- docs and onboarding

It does not need to become a broad document workspace or generic AI application.

## Operator handoff

This document defines the public commercial shape only.

The operator-side Stripe and billing bootstrap lives in [Stripe commercial bootstrap](stripe-commercial-bootstrap.md).

## Product truth to preserve

Do not describe Attestor as:

- a file uploader
- an AI workspace
- a generic AI-for-everything platform
- a separate finance product and separate crypto product

Describe it as:

**Attestor is one product: a policy-bound release and authorization platform for high-consequence systems, delivered through hosted and customer-operated paths, with finance as the deepest proven wedge and crypto as an extension pack on the same core.**
