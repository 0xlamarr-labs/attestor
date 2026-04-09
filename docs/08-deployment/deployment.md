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
| `ATTESTOR_ACCOUNT_STORE_PATH` | No | `.attestor/accounts.json` | File-backed hosted account registry used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ACCOUNT_USER_STORE_PATH` | No | `.attestor/account-users.json` | File-backed hosted account user registry used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ACCOUNT_SESSION_STORE_PATH` | No | `.attestor/account-sessions.json` | File-backed hosted customer session store used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH` | No | `.attestor/account-user-tokens.json` | File-backed hosted invite/password-reset/MFA-login token store used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_TENANT_KEY_STORE_PATH` | No | `.attestor/tenant-keys.json` | File-backed tenant key store used by `npm run tenant:keys` and API key lookup when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_TENANT_KEY_MAX_ACTIVE_PER_TENANT` | No | `2` | Max simultaneously active hosted API keys per tenant during rotation overlap |
| `ATTESTOR_USAGE_LEDGER_PATH` | No | `.attestor/usage-ledger.json` | File-backed single-node usage ledger for hosted quota enforcement when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH` | No | `.attestor/billing-entitlements.json` | File-backed hosted billing entitlement read model used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_SESSION_COOKIE_NAME` | No | `attestor_session` | Hosted customer session cookie name |
| `ATTESTOR_SESSION_TTL_HOURS` | No | `12` | Hosted customer session TTL in hours |
| `ATTESTOR_SESSION_IDLE_TIMEOUT_MINUTES` | No | `30` | Hosted customer session idle timeout in minutes |
| `ATTESTOR_SESSION_COOKIE_SECURE` | No | `false` | Mark hosted customer session cookies as `Secure` |
| `ATTESTOR_ACCOUNT_INVITE_TTL_HOURS` | No | `72` | Hosted invite token TTL in hours for manual-delivery onboarding |
| `ATTESTOR_PASSWORD_RESET_TTL_MINUTES` | No | `30` | Hosted password-reset token TTL in minutes for manual-delivery reset flows |
| `ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY` | No | None | Dedicated secret for encrypting hosted TOTP seeds at rest; falls back to `ATTESTOR_ADMIN_API_KEY` when unset |
| `ATTESTOR_MFA_ISSUER` | No | `Attestor` | Issuer label embedded into generated `otpauth://` TOTP enrollment URLs |
| `ATTESTOR_MFA_LOGIN_TTL_MINUTES` | No | `10` | Hosted MFA login challenge TTL in minutes |
| `ATTESTOR_MFA_LOGIN_MAX_ATTEMPTS` | No | `5` | Max invalid attempts before a hosted MFA login challenge is revoked |
| `ATTESTOR_RATE_LIMIT_WINDOW_SECONDS` | No | `60` | Tenant pipeline rate-limit window size in seconds |
| `ATTESTOR_RATE_LIMIT_REDIS_URL` | No | None | Optional explicit Redis URL for shared pipeline-route rate limiting. When unset, the limiter reuses the current Redis async backend when BullMQ is active |
| `ATTESTOR_RATE_LIMIT_<PLAN>_REQUESTS` | No | Plan defaults | Per-plan request ceiling for the current window (`COMMUNITY`, `STARTER`, `PRO`, `ENTERPRISE`) |
| `ATTESTOR_ASYNC_PENDING_<PLAN>_JOBS` | No | Plan defaults | Per-plan pending async-job cap for tenant-aware BullMQ submit fairness (`COMMUNITY`, `STARTER`, `PRO`, `ENTERPRISE`) |
| `ATTESTOR_ASYNC_ACTIVE_<PLAN>_JOBS` | No | Plan defaults | Per-plan active async-execution cap for shared tenant runtime isolation (`COMMUNITY`, `STARTER`, `PRO`, `ENTERPRISE`) |
| `ATTESTOR_ASYNC_ACTIVE_LEASE_MS` | No | `15000` | Lease TTL for tenant active-execution slots |
| `ATTESTOR_ASYNC_ACTIVE_HEARTBEAT_MS` | No | Derived from lease TTL | Heartbeat interval used to refresh active-execution leases while workers process jobs |
| `ATTESTOR_ASYNC_ACTIVE_REQUEUE_DELAY_MS` | No | `1000` | Delay before a job that cannot acquire a tenant execution slot is requeued |
| `ATTESTOR_ASYNC_ACTIVE_REDIS_URL` | No | None | Optional explicit Redis URL for shared tenant active-execution isolation. When unset, the coordinator reuses the current BullMQ Redis backend when available |
| `ATTESTOR_ASYNC_ATTEMPTS` | No | `3` | BullMQ retry-attempt ceiling for async jobs |
| `ATTESTOR_ASYNC_BACKOFF_MS` | No | `1000` | BullMQ exponential backoff base delay in milliseconds |
| `ATTESTOR_ASYNC_MAX_STALLED_COUNT` | No | `1` | BullMQ stalled-job recovery ceiling before failing a job |
| `ATTESTOR_ASYNC_WORKER_CONCURRENCY` | No | `1` | BullMQ worker concurrency |
| `ATTESTOR_ASYNC_JOB_TTL_SECONDS` | No | `3600` | Completed-job retention in BullMQ |
| `ATTESTOR_ASYNC_FAILED_TTL_SECONDS` | No | `86400` | Failed-job / DLQ retention in BullMQ |
| `ATTESTOR_ASYNC_TENANT_SCAN_LIMIT` | No | `200` | BullMQ page size used by exact per-tenant pending-job inspection |
| `ATTESTOR_ASYNC_DLQ_STORE_PATH` | No | `.attestor/async-dead-letter.json` | File-backed persistent async DLQ store used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ADMIN_API_KEY` | No | None | Admin API key for hosted account, entitlement, plan catalog, audit, queue, DLQ, billing event/export, tenant lifecycle, billing attach, idempotent provisioning, and usage endpoints (`/api/v1/admin/accounts`, `/api/v1/admin/accounts/:id/billing/export`, `/api/v1/admin/accounts/:id/billing/stripe`, `/api/v1/admin/accounts/:id/suspend|reactivate|archive`, `/api/v1/admin/plans`, `/api/v1/admin/audit`, `/api/v1/admin/queue`, `/api/v1/admin/queue/dlq`, `/api/v1/admin/queue/jobs/:id/retry`, `/api/v1/admin/billing/events`, `/api/v1/admin/billing/entitlements`, `/api/v1/admin/tenant-keys`, `/api/v1/admin/usage`) |
| `ATTESTOR_CONTROL_PLANE_PG_URL` | No | None | Explicit shared PostgreSQL control-plane first slice for hosted accounts, account users, account sessions, account user action tokens, tenant keys, usage, billing entitlements, async DLQ, admin audit, admin idempotency replay, and Stripe webhook dedupe |
| `ATTESTOR_ADMIN_AUDIT_LOG_PATH` | No | `.attestor/admin-audit-log.json` | File-backed hash-linked admin mutation ledger used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH` | No | `.attestor/admin-idempotency.json` | File-backed encrypted idempotency replay store for admin `POST` routes used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
| `ATTESTOR_ADMIN_IDEMPOTENCY_TTL_HOURS` | No | `24` | Replay retention window for admin idempotency records |
| `ATTESTOR_BILLING_LEDGER_PG_URL` | No | None | Shared PostgreSQL-backed Stripe billing event ledger used by `/api/v1/admin/billing/events`, checkout/invoice lifecycle history, and cross-node webhook dedupe |
| `ATTESTOR_HA_MODE` | No | `false` | Set to `true` to require HA-safe startup: external `REDIS_URL`, BullMQ mode, and shared `ATTESTOR_CONTROL_PLANE_PG_URL` |
| `ATTESTOR_INSTANCE_ID` | No | Hostname | Optional stable instance label surfaced in `x-attestor-instance-id`, `/health`, `/ready`, and HA diagnostics |
| `ATTESTOR_OBSERVABILITY_LOG_PATH` | No | None | Optional JSONL path for structured API request logs with trace correlation and tenant/account context |
| `OTEL_LOGS_EXPORTER` | No | None | Set to `otlp` to enable OTLP structured log export |
| `OTEL_TRACES_EXPORTER` | No | None | Set to `otlp` to enable OTLP trace export |
| `OTEL_METRICS_EXPORTER` | No | None | Set to `otlp` to enable OTLP metrics export |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | None | Optional OTLP base endpoint; Attestor appends `/v1/logs`, `/v1/traces`, and `/v1/metrics` for logs, traces, and metrics |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | No | None | Optional explicit OTLP logs endpoint |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No | None | Optional explicit OTLP traces endpoint |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | No | None | Optional explicit OTLP metrics endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | No | `http/protobuf` | OTLP protocol override; only `http/protobuf` is supported in this first slice |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | No | `http/protobuf` | OTLP logs protocol override; only `http/protobuf` is supported in this first slice |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | No | `http/protobuf` | OTLP traces protocol override; only `http/protobuf` is supported in this first slice |
| `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | No | `http/protobuf` | OTLP metrics protocol override; only `http/protobuf` is supported in this first slice |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | None | Optional comma-separated OTLP header list (`k=v,k2=v2`) |
| `OTEL_EXPORTER_OTLP_LOGS_HEADERS` | No | None | Optional logs header override (`k=v,k2=v2`) |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | No | None | Optional traces header override (`k=v,k2=v2`) |
| `OTEL_EXPORTER_OTLP_METRICS_HEADERS` | No | None | Optional metrics header override (`k=v,k2=v2`) |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | No | None | Optional OTLP export timeout in milliseconds |
| `OTEL_EXPORTER_OTLP_LOGS_TIMEOUT` | No | None | Optional logs export timeout in milliseconds |
| `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` | No | None | Optional traces export timeout in milliseconds |
| `OTEL_EXPORTER_OTLP_METRICS_TIMEOUT` | No | None | Optional metrics export timeout in milliseconds |
| `OTEL_METRIC_EXPORT_TIMEOUT` | No | None | Optional fallback timeout for OTLP metrics export in milliseconds |
| `OTEL_METRIC_EXPORT_INTERVAL` | No | `1000` | Optional OTLP metrics export interval in milliseconds |
| `OTEL_SERVICE_NAME` | No | `attestor-api` | OpenTelemetry service name for exported request spans |
| `OTEL_SERVICE_INSTANCE_ID` | No | Hostname | OpenTelemetry service instance id for exported request spans |
| `STRIPE_API_KEY` | No | None | Stripe secret API key for hosted Checkout and Billing Portal session creation |
| `STRIPE_WEBHOOK_SECRET` | No | None | Stripe signing secret for `POST /api/v1/billing/stripe/webhook` |
| `ATTESTOR_STRIPE_PRICE_STARTER` | No | None | Stripe recurring price id for the hosted `starter` plan |
| `ATTESTOR_STRIPE_PRICE_PRO` | No | None | Stripe recurring price id for the hosted `pro` plan |
| `ATTESTOR_STRIPE_PRICE_ENTERPRISE` | No | None | Stripe recurring price id for the hosted `enterprise` plan |
| `ATTESTOR_BILLING_SUCCESS_URL` | No | None | Return URL for successful Stripe Checkout sessions |
| `ATTESTOR_BILLING_CANCEL_URL` | No | None | Return URL for canceled Stripe Checkout sessions |
| `ATTESTOR_BILLING_PORTAL_RETURN_URL` | No | None | Return URL for Stripe Billing Portal sessions |
| `ATTESTOR_STRIPE_WEBHOOK_STORE_PATH` | No | `.attestor/stripe-webhooks.json` | File-backed processed-event ledger for Stripe webhook duplicate suppression used when `ATTESTOR_CONTROL_PLANE_PG_URL` is not configured |
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
- Single-node API + split worker topology via `docker-compose.yml`
- Multi-node / HA first slice via `docker-compose.ha.yml` + `ops/nginx/attestor-ha.conf`, with two API nodes behind Nginx, two BullMQ workers, and startup HA guards that reject embedded/local Redis or non-shared hosted control-plane state when `ATTESTOR_HA_MODE=true`
- Shared Redis queue between API and worker
- PostgreSQL RLS tenant isolation
- Hosted tenant key lifecycle with rotate -> deactivate/reactivate -> revoke, `lastUsedAt`, and max-2 active overlap
- Hosted customer auth/RBAC first slice with bootstrap admin, opaque account sessions, password change, manual-delivery invite/password-reset flows, TOTP MFA enrollment/verify/disable + recovery codes, idle session timeout, and `account_admin` / `billing_admin` / `read_only` role boundaries on account-facing routes
- Tenant-aware pipeline throttling with plan defaults, `Retry-After`, and `429` responses. Uses a shared Redis fixed-window first slice when `ATTESTOR_RATE_LIMIT_REDIS_URL` is set or the current BullMQ Redis backend is available; otherwise falls back to in-memory single-node buckets
- Hosted account lifecycle (`active` / `suspended` / `archived`) enforced before tenant API use
- Stripe webhook reconciliation first slice: signature-verified `customer.subscription.*`, `checkout.session.completed`, `invoice.paid`, and `invoice.payment_failed` processing with duplicate-event suppression, checkout/invoice summary persistence, hosted billing entitlement projection, account suspend/reactivate sync, and hosted billing export truth. Duplicate suppression moves onto an advisory-lock-backed shared control-plane claim/finalize path when `ATTESTOR_CONTROL_PLANE_PG_URL` is set, and billing event history moves onto the shared PostgreSQL billing ledger when `ATTESTOR_BILLING_LEDGER_PG_URL` is set
- Async queue hardening first slice: plan-aware BullMQ job priority, bounded retry/backoff, exact paginated tenant-aware pending-job caps on async submit, shared Redis-backed tenant active-execution leases at worker runtime, `GET /api/v1/admin/queue` summary, `GET /api/v1/admin/queue/dlq` failed-job inspection, and `POST /api/v1/admin/queue/jobs/:id/retry` manual retry. Terminal async failures persist into a file-backed DLQ store by default and move onto the shared PostgreSQL control-plane when `ATTESTOR_CONTROL_PLANE_PG_URL` is configured
- Observability first slice: W3C trace-context-compatible response headers, Prometheus-text metrics at `GET /api/v1/admin/metrics`, `GET /api/v1/admin/telemetry` exporter status, optional JSONL request logs via `ATTESTOR_OBSERVABILITY_LOG_PATH`, and optional OTLP logs + trace + metrics export over HTTP/protobuf
- HA runtime truth: all API responses include `x-attestor-instance-id`, while `GET /api/v1/health` and `GET /api/v1/ready` expose `instanceId` and `highAvailability` status for load-balancer debugging and readiness gating
- Tenant-authenticated Stripe Checkout and Billing Portal entrypoints, with env-mapped Stripe price ids, required `Idempotency-Key` on Checkout, webhook-driven plan/quota sync back into hosted tenant records, customer-visible checkout/invoice summary at `GET /api/v1/account`, and hosted billing export at `GET /api/v1/account/billing/export` (`format=json|csv`) with live Stripe or shared-ledger/mock-summary fallback
- Control-plane backup/restore first slice: `npm run backup:control-plane` writes a logical snapshot of the hosted control-plane, including shared PostgreSQL-backed account/tenant/usage/billing-entitlement/async-DLQ/admin-audit/account-user/account-session/account-user-action-token state when `ATTESTOR_CONTROL_PLANE_PG_URL` is configured, plus the shared billing ledger export when `ATTESTOR_BILLING_LEDGER_PG_URL` is configured. Ephemeral admin idempotency and Stripe webhook dedupe state can be included explicitly for DR drills. See [backup-restore-dr.md](backup-restore-dr.md)
- Health + readiness probes

What is not yet implemented:
- Orchestrator-native autoscaling, rolling deploy coordination, or managed load-balancer integration beyond the current HA first slice
- BullMQ Pro queue groups or broader weighted multi-node scheduling/isolation beyond the current shared tenant active-execution caps
- No bundled external collector deployment or full distributed log/trace backend
- External KMS-backed tenant key storage or shared multi-node key ledger
- Full internal invoice line-item ledger, charge/invoice reconciliation beyond export-oriented summaries, Stripe-native feature entitlement service, or broader shared multi-node control-plane stores beyond the current hosted control-plane first slice
- WebAuthn/passkeys, outbound email delivery for invite/reset/MFA recovery, and SSO/SAML
