# Research: DB Multi-Tenancy + Distributed Services (2025-2026)

*Captured: April 2026*

## Multi-Tenant PostgreSQL

### Shared Schema + RLS (Default 2025-2026)
- `tenant_id` column on all tables + RLS policies
- `set_config('app.tenant_id', $1, true)` per transaction (transaction-scoped)
- Performance: ~0.4ms overhead (3.6ms vs 3.2ms without RLS)
- Composite indexes: `(tenant_id, created_at)` essential
- PgBouncer: always use transaction-local settings

### Schema-Per-Tenant
- For 10-500 high-value tenants needing custom DDL
- Migrations must run per schema, pooling complex
- 4.8-12.5ms latency (vs 3.6ms shared+RLS)
- Only if compliance requires logical separation

### Neon: Project-Per-Tenant
- One Neon project per tenant (not branch-per-tenant)
- Independent compute, scale-to-zero for inactive
- Strongest isolation, best for high-value B2B

### Supabase
- Shared schema + RLS natively integrated with `auth.uid()`
- `tenant_id` in `app_metadata` on JWT

### Drizzle ORM
- First-class RLS support in schema DSL
- pgvpd proxy (Feb 2026): protocol-level tenant injection
- Nile integration: virtual tenant databases

### Minimum Viable Tenant Isolation
| Layer | Action |
|---|---|
| DB | Shared schema, `tenant_id`, RLS |
| ORM | Drizzle + composite indexes |
| Pool | `set_config` in BEGIN/COMMIT wrapper |
| Auth | JWT with `tenant_id` claim |
| Test | Assert cross-tenant data inaccessible |

## Distributed TypeScript Services

### Hono + BullMQ Topology
```
[Hono API] --enqueue--> [Redis] <--poll-- [BullMQ Workers]
```
- Hono: multi-runtime (Node/Bun/CF/Deno)
- BullMQ: priorities, rate limiting, flow jobs
- `@bull-board/hono` for dashboard
- Horizontal: add worker containers → same Redis

### Temporal vs Inngest
| Dimension | Temporal | Inngest |
|---|---|---|
| Model | Stateful workers + cluster | Serverless event-driven |
| DX | Steeper, deterministic replay | Normal TS + `step.run()` |
| Multi-tenant | Manual routing | Built-in concurrency per key |
| Best for | Complex multi-service sagas | Background jobs, event pipelines |

### Deployment: Railway vs Fly.io
| Dimension | Railway | Fly.io |
|---|---|---|
| Deploy | Git push, auto-detect | Dockerfile, `fly deploy` |
| Multi-service | Shared private network | WireGuard mesh |
| Best for | Rapid iteration | Edge/custom infra |

### Minimum Viable Distributed Stack
```
Hono (API) + Drizzle (ORM) + PostgreSQL (RLS) + Inngest (workflows) + Railway (deploy)
```
- Type-safe everything
- Database-enforced tenant isolation
- Durable async processing
- Zero Redis to manage (Inngest handles queueing)
- Single-command deploys

### Decision Tree
- **Background jobs only**: Hono + BullMQ + Redis
- **Durable multi-step workflows**: Hono + Inngest
- **Long-running saga orchestration**: Hono + Temporal
