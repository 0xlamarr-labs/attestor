# Deployment

Attestor runs as two separate processes sharing Redis and PostgreSQL:

- **API server** — HTTP endpoints for pipeline execution, verification, filing
- **Pipeline worker** — BullMQ consumer that processes async governed pipeline jobs

Both processes are built from the same container image with different `CMD` arguments.

## Service Topology

```
                    ┌──────────────┐
  HTTP :3700   ──>  │   API Server │──┐
                    └──────────────┘  │
                                      ├── Redis (BullMQ queue)
                    ┌──────────────┐  │
                    │    Worker    │──┘
                    └──────────────┘
                           │
                    ┌──────────────┐
                    │  PostgreSQL  │  (optional — RLS tenant isolation)
                    └──────────────┘
```

## Local Development

```bash
# Single-process (API + embedded worker + embedded Redis)
npm run serve

# Split processes (requires external Redis)
REDIS_URL=redis://localhost:6379 npm run serve &
REDIS_URL=redis://localhost:6379 npm run worker &
```

## Docker Compose

```bash
docker compose up
```

Starts 4 services: `api`, `worker`, `postgres`, `redis`.

- API healthcheck uses `/api/v1/ready` (returns 503 until backend ready)
- Worker auto-restarts on crash (`restart: unless-stopped`)
- PostgreSQL RLS auto-activated on API startup when `ATTESTOR_PG_URL` is set

## Container

```bash
# Build
docker build -t attestor .

# Run API
docker run -p 3700:3700 \
  -e REDIS_URL=redis://redis:6379 \
  -e ATTESTOR_PG_URL=postgresql://... \
  attestor

# Run Worker (same image, different command)
docker run \
  -e REDIS_URL=redis://redis:6379 \
  attestor node dist/service/worker.js
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3700` | API listen port |
| `REDIS_URL` | No | Auto-resolved | Redis connection URL (Tier 1 of 3-tier resolution) |
| `ATTESTOR_PG_URL` | No | None | PostgreSQL for RLS tenant isolation |
| `ATTESTOR_TENANT_KEYS` | No | `""` | API key to tenant-id mapping (`key:id:name[:plan][:quota],...`) |
| `ATTESTOR_ACCOUNT_STORE_PATH` | No | `.attestor/accounts.json` | Local file-backed hosted account registry used by `/api/v1/admin/accounts` |
| `ATTESTOR_TENANT_KEY_STORE_PATH` | No | `.attestor/tenant-keys.json` | Local file-backed tenant key store used by `npm run tenant:keys` and API key lookup |
| `ATTESTOR_TENANT_KEY_MAX_ACTIVE_PER_TENANT` | No | `2` | Max simultaneously active hosted API keys per tenant during rotation overlap |
| `ATTESTOR_USAGE_LEDGER_PATH` | No | `.attestor/usage-ledger.json` | Local file-backed single-node usage ledger for hosted quota enforcement |
| `ATTESTOR_RATE_LIMIT_WINDOW_SECONDS` | No | `60` | Tenant pipeline rate-limit window size in seconds |
| `ATTESTOR_RATE_LIMIT_<PLAN>_REQUESTS` | No | Plan defaults | Per-plan request ceiling for the current window (`COMMUNITY`, `STARTER`, `PRO`, `ENTERPRISE`) |
| `ATTESTOR_ADMIN_API_KEY` | No | None | Admin API key for hosted account, plan catalog, audit, billing event, tenant lifecycle, billing attach, idempotent provisioning, and usage endpoints (`/api/v1/admin/accounts`, `/api/v1/admin/accounts/:id/billing/stripe`, `/api/v1/admin/accounts/:id/suspend|reactivate|archive`, `/api/v1/admin/plans`, `/api/v1/admin/audit`, `/api/v1/admin/billing/events`, `/api/v1/admin/tenant-keys`, `/api/v1/admin/usage`) |
| `ATTESTOR_ADMIN_AUDIT_LOG_PATH` | No | `.attestor/admin-audit-log.json` | Local hash-linked admin mutation ledger |
| `ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH` | No | `.attestor/admin-idempotency.json` | Local encrypted idempotency replay store for admin `POST` routes |
| `ATTESTOR_ADMIN_IDEMPOTENCY_TTL_HOURS` | No | `24` | Replay retention window for admin idempotency records |
| `ATTESTOR_BILLING_LEDGER_PG_URL` | No | None | Shared PostgreSQL-backed Stripe billing event ledger used by `/api/v1/admin/billing/events` and cross-node webhook dedupe |
| `ATTESTOR_OBSERVABILITY_LOG_PATH` | No | None | Optional JSONL path for structured API request logs with trace correlation and tenant/account context |
| `STRIPE_API_KEY` | No | None | Stripe secret API key for hosted Checkout and Billing Portal session creation |
| `STRIPE_WEBHOOK_SECRET` | No | None | Stripe signing secret for `POST /api/v1/billing/stripe/webhook` |
| `ATTESTOR_STRIPE_PRICE_STARTER` | No | None | Stripe recurring price id for the hosted `starter` plan |
| `ATTESTOR_STRIPE_PRICE_PRO` | No | None | Stripe recurring price id for the hosted `pro` plan |
| `ATTESTOR_STRIPE_PRICE_ENTERPRISE` | No | None | Stripe recurring price id for the hosted `enterprise` plan |
| `ATTESTOR_BILLING_SUCCESS_URL` | No | None | Return URL for successful Stripe Checkout sessions |
| `ATTESTOR_BILLING_CANCEL_URL` | No | None | Return URL for canceled Stripe Checkout sessions |
| `ATTESTOR_BILLING_PORTAL_RETURN_URL` | No | None | Return URL for Stripe Billing Portal sessions |
| `ATTESTOR_STRIPE_WEBHOOK_STORE_PATH` | No | `.attestor/stripe-webhooks.json` | Local processed-event ledger for Stripe webhook duplicate suppression |
| `ATTESTOR_STRIPE_USE_MOCK` | No | `false` | Local/test-only deterministic mock mode for Checkout and Billing Portal sessions |
| `NODE_ENV` | No | `production` | Environment mode |

## Health and Readiness

| Endpoint | Purpose | Response |
|---|---|---|
| `GET /api/v1/health` | Detailed system state | Always 200, includes PKI/RLS/async status |
| `GET /api/v1/ready` | Orchestrator readiness probe | 200 when ready, 503 when not |

The readiness probe checks:
- Async backend initialized (BullMQ or in-process)
- PKI hierarchy ready
- Domain registry loaded
- Redis reachable (when BullMQ mode)

## Graceful Shutdown

The API server handles `SIGTERM` and `SIGINT`:
1. Stops accepting new HTTP connections
2. Allows 5s for in-flight requests to complete
3. Exits cleanly

The worker handles `SIGTERM` and `SIGINT`:
1. Stops accepting new BullMQ jobs
2. Waits for in-flight job to complete
3. Closes Redis connection
4. Exits cleanly

## Redis Auto-Resolution

When `REDIS_URL` is not set, the API server probes three tiers:
1. `REDIS_URL` environment variable (production)
2. `localhost:6379` probe (local Redis)
3. Embedded `redis-memory-server` (dev/CI only)

If all three fail, the async pipeline falls back to in-process execution (jobs lost on restart).

The worker **requires** Redis and will exit with code 1 if no Redis is available.

## Current Boundary

What is deployed today:
- Single-node API + split worker topology via docker-compose
- Shared Redis queue between API and worker
- PostgreSQL RLS tenant isolation
- Local file-backed tenant key lifecycle with rotate -> deactivate/reactivate -> revoke, `lastUsedAt`, and max-2 active overlap
- Tenant-aware in-memory pipeline throttling with plan defaults, `Retry-After`, and `429` responses
- Local file-backed hosted account lifecycle (`active` / `suspended` / `archived`) enforced before tenant API use
- Stripe webhook reconciliation first slice: signature-verified `customer.subscription.*` processing with duplicate-event suppression and account suspend/reactivate sync, plus an optional shared PostgreSQL-backed billing event ledger when `ATTESTOR_BILLING_LEDGER_PG_URL` is set
- Observability first slice: W3C trace-context-compatible response headers, Prometheus-text metrics at `GET /api/v1/admin/metrics`, and optional JSONL request logs via `ATTESTOR_OBSERVABILITY_LOG_PATH`
- Tenant-authenticated Stripe Checkout and Billing Portal entrypoints, with env-mapped Stripe price ids and webhook-driven plan/quota sync back into hosted tenant records
- Health + readiness probes

What is not yet implemented:
- Multi-node horizontal scaling with load balancer
- Job priority or shared/distributed rate limiting
- Dead-letter queue configuration
- Multi-tenant job isolation in the queue
- External log/metrics collector, OTLP exporter, or full distributed tracing backend
- External KMS-backed tenant key storage or shared multi-node key ledger
- Internal invoice ledger, Stripe checkout completion persistence outside webhooks, or broader shared multi-node control-plane stores beyond the Stripe webhook event ledger
