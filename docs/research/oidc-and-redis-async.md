# Research: Enterprise OIDC + Redis Async Queues (2025-2026)

*Captured: April 2026*

## Enterprise OIDC/IAM

### openid-client v6
- ESM-only, TypeScript native, Node.js >=20.19.0
- Device Authorization Grant (RFC 8628): `initiateDeviceAuthorization()` + `pollDeviceAuthorizationGrant()`
- Auth Code + PKCE: `authorizationCodeGrant()` with `pkceCodeVerifier`
- Refresh Token Grant: standard
- CIBA: supported
- Dropped: dynamic registration, self-issued providers

### Provider CLI Patterns
| Provider | Device Flow | PKCE | Token Lifetime | Notes |
|---|---|---|---|---|
| Okta | Yes (must enable) | Yes (default) | Configurable refresh | Org-level toggle |
| Azure AD/Entra | Yes (native) | Yes (required) | 1h access, 24h refresh | Known v6 B2C issues |
| Keycloak | Yes (v15+) | Yes | Realm-configurable | `/realms/{realm}/device` |

### Production-Grade CLI SSO Minimum
1. Device Flow primary (headless/SSH safe)
2. Auth Code + PKCE fallback (desktop with browser)
3. Secure token storage: `keytar` (OS keychain) or encrypted file
4. Silent refresh before access token expires
5. Token revocation on logout
6. OIDC discovery (never hardcode endpoints)
7. Request `offline_access` scope for refresh tokens

### Key Packages
| Package | Purpose |
|---|---|
| `openid-client` v6 | OIDC RP client |
| `keytar` v7 | OS keychain storage |
| `jose` v5 | JWT decode/verify |
| `open` | Browser launch for PKCE |

## Redis-Backed Async (BullMQ v5)

### Best Practices
- **Retries**: exponential backoff (`type: 'exponential', delay: 1000`)
- **Non-retryable errors**: throw `UnrecoverableError`
- **Dead Letter Queue**: event listener on `worker.on('failed')` → move to DLQ queue
- **Health checks**: `connection.ping()` + `queue.getJobCounts()`
- **Rate limiting**: `limiter: { max: 100, duration: 60_000 }`

### Embedded Redis for Dev/Test
| Approach | Fidelity | Best For |
|---|---|---|
| `ioredis-mock` | Low-medium | Unit tests |
| `testcontainers` | Full (real Redis) | Integration tests |
| Docker Compose | Full | Local dev |

### Production Rules
- Dedicated Redis instance (not cache Redis)
- `maxRetriesPerRequest: null` on every connection
- Workers as separate processes from API
- `removeOnComplete/removeOnFail` with count limits
- Monitor with Bull Board or OpenTelemetry (v5.71+)

### Key Packages
| Package | Version | Purpose |
|---|---|---|
| `bullmq` | 5.71+ | Job queue |
| `ioredis` | 5.x | Redis client |
| `ioredis-mock` | 8.x | Unit test mock |
| `testcontainers` | 10.x | Integration test |
| `bull-board` | 5.x | Queue dashboard |
