# First Hosted API Call

This quickstart shows the first customer-owned API call after hosted signup.

Use it when you already have a hosted account and the one-time plaintext `initialKey.apiKey` returned by `POST /api/v1/auth/signup`.

It does not replace the canonical route contract in [Hosted journey contract](hosted-journey-contract.md), and it does not define pricing. Pricing lives in [Commercial packaging, pricing, and evaluation](product-packaging.md).

For the cross-pack operating model and canonical decision vocabulary, use [Operating model](operating-model.md).

## What You Are Proving

Your system is not handing control to Attestor. It is adding a gate before consequence:

1. your system prepares a proposed output, query, action, or other consequence material
2. your system calls Attestor with a tenant API key
3. Attestor returns a decision, proof posture, tenant context, and usage state
4. your system only writes, sends, files, executes, or settles if the decision allows it

Attestor does not auto-detect packs from magic input. You call the hosted path that matches the consequence you need to control.

## 1. Configure The Client

Use the tenant API key in the HTTP `Authorization` header.

```bash
export ATTESTOR_BASE_URL="https://<your-attestor-host>"
export ATTESTOR_API_KEY="<initialKey.apiKey>"
```

Keep the key in a secret store or environment variable. Do not put it in URLs, client-side code, tickets, screenshots, or logs. Historical API-key list responses do not expose plaintext secret material again.

## 2. Confirm The Account Context

Call `GET /api/v1/account/usage` before the first consequence call:

```bash
curl -sS "$ATTESTOR_BASE_URL/api/v1/account/usage" \
  -H "Authorization: Bearer $ATTESTOR_API_KEY"
```

Expected shape:

```json
{
  "tenantContext": {
    "source": "api_key",
    "planId": "community"
  },
  "usage": {
    "used": 0,
    "quota": 10,
    "remaining": 10,
    "enforced": true
  }
}
```

Exact IDs and limits depend on the account and plan. The important signal is that the tenant context, usage, quota, and enforcement posture are visible before the first consequence call.

## 3. Call Attestor Before Consequence

This reference payload uses the finance proof wedge because it is the deepest proven path today. Production callers should send their own proposed consequence material and evidence source.

Call `POST /api/v1/pipeline/run` from the customer system that is about to write, send, file, execute, or settle:

```bash
curl -sS -X POST "$ATTESTOR_BASE_URL/api/v1/pipeline/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ATTESTOR_API_KEY" \
  --data-binary @- <<'JSON'
{
  "candidateSql": "SELECT counterparty_name, exposure_usd, credit_rating, sector FROM risk.counterparty_exposures WHERE reporting_date = '2026-03-28' ORDER BY exposure_usd DESC",
  "intent": {
    "queryType": "counterparty_exposure",
    "description": "Summarize top counterparty exposures by credit rating and sector for the current reporting date.",
    "allowedSchemas": ["risk"],
    "forbiddenSchemas": ["pii", "hr", "auth"],
    "executionClass": "bounded_detail",
    "executionBudget": {
      "maxJoins": 2,
      "maxProjectedColumns": 10,
      "allowWildcard": false,
      "requireLimit": false
    },
    "expectedColumns": [
      { "name": "counterparty_name", "type": "string", "required": true, "notNull": true },
      { "name": "exposure_usd", "type": "number", "required": true, "notNull": true },
      { "name": "credit_rating", "type": "string", "required": true, "notNull": true },
      { "name": "sector", "type": "string", "required": true }
    ],
    "businessConstraints": [
      { "description": "Result must not be empty", "column": "*", "check": "not_empty" },
      { "description": "Exposure must be non-negative", "column": "exposure_usd", "check": "non_negative" },
      { "description": "At least 3 counterparties", "column": "*", "check": "row_count_min", "value": 3 },
      { "description": "Total exposure should equal 850M", "column": "exposure_usd", "check": "sum_equals", "value": 850000000 }
    ]
  },
  "fixtures": [
    {
      "sqlHash": "6745022a2abb8c77",
      "description": "Counterparty exposure summary - 5 rows, valid data",
      "result": {
        "success": true,
        "columns": ["counterparty_name", "exposure_usd", "credit_rating", "sector"],
        "columnTypes": ["string", "number", "string", "string"],
        "rows": [
          { "counterparty_name": "Bank of Nova Scotia", "exposure_usd": 250000000, "credit_rating": "AA-", "sector": "Banking" },
          { "counterparty_name": "Deutsche Bank AG", "exposure_usd": 200000000, "credit_rating": "A-", "sector": "Banking" },
          { "counterparty_name": "Toyota Motor Corp", "exposure_usd": 180000000, "credit_rating": "A+", "sector": "Automotive" },
          { "counterparty_name": "Shell plc", "exposure_usd": 120000000, "credit_rating": "A", "sector": "Energy" },
          { "counterparty_name": "Tesco plc", "exposure_usd": 100000000, "credit_rating": "BBB+", "sector": "Retail" }
        ]
      }
    }
  ],
  "sign": false
}
JSON
```

Expected shape:

```json
{
  "decision": "pass",
  "proofMode": "offline_fixture",
  "tenantContext": {
    "source": "api_key",
    "planId": "community"
  },
  "usage": {
    "used": 1,
    "remaining": 9
  }
}
```

This is the shipped finance route's domain-native finance decision. In the canonical admission vocabulary, `pass` is the finance allow branch and maps to canonical `admit`. The typed finance projection in `src/consequence-admission/finance.ts` now performs that mapping for the current hosted finance response without changing this route shape.

The downstream system should gate on the returned decision. If the decision is not allowed for the consequence, do not write, send, file, execute, or settle.

## 4. Optional Signed Proof

When the customer needs portable verification material, set `sign` to `true` on the pipeline call. The response can include `certificate`, `publicKeyPem`, `trustChain`, and `caPublicKeyPem`.

Verify that material with:

```bash
curl -sS -X POST "$ATTESTOR_BASE_URL/api/v1/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ATTESTOR_API_KEY" \
  --data-binary @verify-payload.json
```

The verify payload is built from the signed pipeline response. A valid verification response includes `overall`, `signatureValid`, and trust-binding fields.

## Failure Signals

- `401`: the tenant API key is missing, invalid, or revoked
- `400`: the request shape is invalid, usually missing `candidateSql` or `intent`
- `429`: quota or rate limit blocks the run; the rejected run does not become a downstream consequence
- non-allowed decision: the downstream system must fail closed or route to review

## Where To Go Next

- Buying and checkout flow: [Hosted customer journey](hosted-customer-journey.md)
- Exact route and auth contract: [Hosted journey contract](hosted-journey-contract.md)
- Canonical operating model: [Operating model](operating-model.md)
- Finance proof wedge: [AI-assisted financial reporting acceptance](financial-reporting-acceptance.md)
