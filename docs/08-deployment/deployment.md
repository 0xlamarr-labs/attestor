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
| `ATTESTOR_USAGE_LEDGER_PATH` | No | `.attestor/usage-ledger.json` | Local file-backed single-node usage ledger for hosted quota enforcement |
| `ATTESTOR_ADMIN_API_KEY` | No | None | Admin API key for hosted account, plan catalog, audit, tenant management, idempotent provisioning, and usage endpoints (`/api/v1/admin/accounts`, `/api/v1/admin/plans`, `/api/v1/admin/audit`, `/api/v1/admin/tenant-keys`, `/api/v1/admin/usage`) |
| `ATTESTOR_ADMIN_AUDIT_LOG_PATH` | No | `.attestor/admin-audit-log.json` | Local hash-linked admin mutation ledger |
| `ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH` | No | `.attestor/admin-idempotency.json` | Local encrypted idempotency replay store for admin `POST` routes |
| `ATTESTOR_ADMIN_IDEMPOTENCY_TTL_HOURS` | No | `24` | Replay retention window for admin idempotency records |
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
- Health + readiness probes

What is not yet implemented:
- Multi-node horizontal scaling with load balancer
- Job priority or rate limiting
- Dead-letter queue configuration
- Multi-tenant job isolation in the queue
- Centralized logging / metrics / tracing
