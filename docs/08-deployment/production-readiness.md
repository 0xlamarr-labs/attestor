# Production Readiness Guide

Attestor is now at the point where the main remaining work is not another large engineering block in the repo. It is **environment promotion**: real secrets, real cloud material, real benchmark data, and a disciplined rollout sequence.

This guide uses the **recommended path today**:

- **GKE**
- **Workload Identity**
- **Google Secret Manager**
- **External Secrets**
- **Gateway API + cert-manager**
- **Grafana Alloy / Grafana Cloud**
- **shared PostgreSQL**
- **shared Redis**

AWS remains supported. This guide chooses GKE because it is currently the cleanest repo-guided path end to end.

The repo-side shared release/policy authority-plane buildout is tracked in [Production shared authority plane buildout](../02-architecture/production-shared-authority-plane-buildout.md). That track now proves the shared authority plane with embedded PostgreSQL; this guide remains the boundary for promoting it into a real customer-operated or hosted environment.

## What "Ready" Means Here

Attestor is ready for production promotion when all four are true:

1. the **repo pipeline** is green
2. the **environment inputs** are present and reachable
3. the **benchmark + render + probe + packet** chain returns `ready-for-environment-promotion`
4. the selected **runtime profile** truthfully matches the deployment claim

That is the practical line between "good code" and "rollout-ready system".

## Runtime Profile Gate

Set `ATTESTOR_RUNTIME_PROFILE` deliberately before starting the API runtime. Do not let the profile default decide the production story.

| Profile | Use today | Required proof | Do not claim |
|---|---|---|---|
| `local-dev` | Local development, demos, and repeatable tests. | `npm test` and local API checks may run quickly with memory-backed release state. | Production readiness |
| `single-node-durable` | Customer-operated or hosted evaluation where one runtime must survive restart. | `npm run test:production-runtime-profile`, `npm run test:production-runtime-restart-recovery`, and `/api/v1/ready` reporting `checks.releaseRuntime=true`. | Multi-node production |
| `production-shared` | Multi-node release/policy authority plane target. | `ATTESTOR_RELEASE_AUTHORITY_PG_URL` must point at reachable PostgreSQL, `npm run test:production-shared-request-path-cutover` and `npm run test:production-shared-multi-instance-recovery` must pass, and `/api/v1/ready` must report shared request-path readiness. | External customer-operated rollout until real environment render/probe packets and rehearsal pass |

The current repository proves `single-node-durable` restart recovery and proves `production-shared` shared authority behavior under embedded PostgreSQL multi-instance, concurrency, restart, reconnect, and recovery tests. It does not claim your external PostgreSQL, Redis, Kubernetes, secret, DNS, TLS, observability, or billing environment is production-ready until the render/probe packet chain and rehearsal pass against that environment.

The runtime diagnostics are visible at:

- `GET /api/v1/health`
- `GET /api/v1/ready`

Both responses include `runtimeProfile` and `releaseRuntime`. Treat `releaseRuntime.durability.ready=false` or `/api/v1/ready` returning `503` as a stop condition.

### Runtime Authority State Knobs

For `single-node-durable`, point the release-authority stores at durable disk paths that survive process restart:

```bash
ATTESTOR_RUNTIME_PROFILE=single-node-durable
ATTESTOR_RELEASE_DECISION_LOG_PATH=/var/lib/attestor/release-decision-log.jsonl
ATTESTOR_RELEASE_REVIEWER_QUEUE_STORE_PATH=/var/lib/attestor/release-reviewer-queue.json
ATTESTOR_RELEASE_TOKEN_INTROSPECTION_STORE_PATH=/var/lib/attestor/release-token-introspection.json
ATTESTOR_RELEASE_EVIDENCE_PACK_STORE_PATH=/var/lib/attestor/release-evidence-packs.json
ATTESTOR_RELEASE_ENFORCEMENT_DEGRADED_MODE_STORE_PATH=/var/lib/attestor/degraded-mode-grants.json
ATTESTOR_POLICY_CONTROL_PLANE_STORE_PATH=/var/lib/attestor/policy-control-plane.json
ATTESTOR_POLICY_ACTIVATION_APPROVAL_STORE_PATH=/var/lib/attestor/policy-activation-approvals.json
ATTESTOR_POLICY_MUTATION_AUDIT_LOG_PATH=/var/lib/attestor/policy-mutation-audit.json
```

For `production-shared`, do not paper over the gate with file paths. Use it only when the dedicated release-authority PostgreSQL substrate is configured, reachable, and reflected in `/api/v1/ready`.

```bash
ATTESTOR_RUNTIME_PROFILE=production-shared
ATTESTOR_RELEASE_AUTHORITY_PG_URL=postgres://attestor:...@postgres.example.internal:5432/attestor_release_authority
```

In this profile, file-backed release-authority paths are no longer the authority-plane proof. The request path must use the async shared authority-store contract, and readiness must fail closed if the shared PostgreSQL substrate is missing or unreachable.

## Recommended Stack

```mermaid
flowchart LR
  GSM["Google Secret Manager"] --> ESO["External Secrets"]
  ESO --> K8S["GKE namespace"]
  Cert["cert-manager / Gateway API"] --> K8S
  K8S --> API["Attestor API"]
  K8S --> Worker["Attestor Worker"]
  API <--> PG["Shared PostgreSQL"]
  Worker <--> PG
  API <--> Redis["Shared Redis"]
  Worker <--> Redis
  API --> Alloy["Grafana Alloy"]
  Worker --> Alloy
  Alloy --> Cloud["Grafana Cloud / managed backend"]
```

## Step 1: Provision the Target Environment

Before rendering anything, the target environment should already exist:

- a GKE cluster
- a public hostname
- Gateway API available
- `cert-manager` installed, or a clear TLS strategy chosen
- External Secrets Operator installed
- shared PostgreSQL reachable from the cluster
- shared Redis reachable from the cluster
- a managed observability backend chosen

Recommended defaults:

- TLS: `cert-manager`
- secret delivery: `external-secret`
- observability provider: `grafana-alloy`
- HA provider: `gke`

The repo-guided GKE bootstrap path is no longer just theoretical: a reserved global IP + `<ip>.sslip.io` hostname + Gateway API + cert-manager Gateway HTTP-01 solver + `attestor-tls` Secret + HTTP-to-HTTPS redirect has now been live-validated end to end. Use your own delegated hostname for the final production domain, but the bootstrap route itself is already proven.

Once the bootstrap hostname is proven, render the final delegated-domain cutover bundle with:

```bash
npm run render:gke-domain-cutover -- --hostname=api.example.com --dns-target-ip=<gateway-ip>
```

That bundle closes the final delta between the already-proven bootstrap route and the final production hostname:

- Gateway HTTPS listener hostname
- HTTP to HTTPS redirect route
- cert-manager `ClusterIssuer`
- cert-manager `Certificate`
- DNS handoff summary

## Step 2: Bootstrap the Secret Contract

Render the exact secret contract for GKE:

```bash
npm run render:secret-manager-bootstrap -- --provider=gke
```

This emits:

- GKE `ClusterSecretStore` bootstrap material
- the remote secret catalog
- seed payload examples

Important detail:

- Attestor keeps **logical** secret names human-readable
- when the backend is GKE / Google Secret Manager, slash-separated logical names are normalized into **GSM-safe remote ids**

That avoids a real class of rollout bugs where AWS-style path naming leaks into GSM.

## Step 3: Populate Real Secrets

The repo can render the contract. It cannot invent the real values.

You still need to load:

### Observability secrets

- `GRAFANA_CLOUD_OTLP_ENDPOINT`
- `GRAFANA_CLOUD_OTLP_USERNAME`
- `GRAFANA_CLOUD_OTLP_TOKEN`
- `ALERTMANAGER_DEFAULT_WEBHOOK_URL`
- `ALERTMANAGER_WARNING_WEBHOOK_URL`
- `ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY`
- any security / billing / Slack / email routing secrets you actually use

For the recommended Grafana Alloy / Grafana Cloud path, the right mental model
is a **single OTLP gateway**, not a split metrics/logs/traces credential set:

- `GRAFANA_CLOUD_OTLP_ENDPOINT` should point at the stack `otlpHttpUrl`
  connection value, typically ending in `/otlp`
- `GRAFANA_CLOUD_OTLP_USERNAME` should be the stack's Grafana tenant id from
  the same connections payload
- do not reuse the separate Prometheus, Loki, or Tempo tenant ids here

### HA / runtime secrets

- `ATTESTOR_RUNTIME_PROFILE`
- `REDIS_URL`
- `ATTESTOR_CONTROL_PLANE_PG_URL`
- `ATTESTOR_BILLING_LEDGER_PG_URL`
- `ATTESTOR_RELEASE_AUTHORITY_PG_URL` when `ATTESTOR_RUNTIME_PROFILE=production-shared`
- optional `ATTESTOR_PG_URL`
- `ATTESTOR_ADMIN_API_KEY`
- TLS material if you are not delegating certificate issuance elsewhere

### Runtime identity / routing inputs

- `ATTESTOR_PUBLIC_HOSTNAME`
- `ATTESTOR_API_IMAGE`
- `ATTESTOR_WORKER_IMAGE`

## Step 4: Measure the Real Environment

Run fresh benchmarks against the actual target environment.

### Observability benchmark

```bash
npm run benchmark:observability -- --prometheus-url=https://<prometheus> --alertmanager-url=https://<alertmanager>
```

This captures:

- live request rate
- availability
- p95 latency
- active alerts

### HA benchmark

```bash
npm run benchmark:ha -- --url=https://<public-host>/api/v1/health
```

This captures:

- health/availability truth
- calibration data used by the HA renderer chain

## Step 5: Render the Promotion Assets

### Observability chain

```bash
npm run render:observability-profile -- --input=.attestor/observability/calibration/latest/benchmark.json --profile=ops/observability/profiles/regulated-production.json
npm run render:observability-credentials
npm run render:observability-release-bundle
npm run probe:observability-release-inputs
npm run render:observability-promotion-packet
```

### HA chain

```bash
npm run render:ha-profile -- --input=.attestor/ha-calibration/latest.json --profile=ops/kubernetes/ha/profiles/gke-production.json
npm run render:ha-credentials
npm run render:ha-release-bundle
npm run probe:ha-runtime-connectivity
npm run probe:ha-release-inputs
npm run render:ha-promotion-packet
```

## Step 6: Render the Final Combined Gate

Before rendering the final production packet, run the repo-side runtime gates:

```bash
npm run test:production-runtime-profile
npm run test:production-runtime-restart-recovery
npm run test:production-shared-request-path-cutover
npm run test:production-shared-multi-instance-recovery
```

Then render the final environment promotion packet:

```bash
npm run render:production-readiness-packet -- --observability-provider=grafana-alloy --observability-benchmark=.attestor/observability/calibration/latest/benchmark.json --ha-provider=gke --ha-benchmark=.attestor/ha-calibration/latest.json --prometheus-url=https://<prometheus> --alertmanager-url=https://<alertmanager>
```

This is the final repo-side handoff.

If the packet says:

- `ready-for-environment-promotion`: the repo pipeline and environment inputs line up
- `blocked-on-environment-inputs`: stop and fix the listed missing inputs or stale benchmarks first

## Step 7: Apply and Validate

Once the packet is green:

1. apply the observability bundle
2. apply the HA bundle
3. if you are moving from bootstrap `sslip.io` to a delegated domain, apply the final-domain cutover bundle
4. wait for rollout completion
5. verify `GET /api/v1/admin/telemetry` reports OTLP logs/traces/metrics enabled against the in-cluster receiver service
6. only then treat Grafana Cloud / managed-backend auth errors as a destination-side credential problem rather than an app-runtime wiring problem
7. confirm API `/api/v1/ready`
8. confirm worker `/ready`
9. confirm API `/api/v1/health` reports the selected `runtimeProfile` and `releaseRuntime.durability.ready=true`
10. confirm traces/logs/metrics reach the backend
11. confirm alert routing reaches the real destinations
12. confirm Stripe / hosted auth / queue / billing critical paths still behave correctly

## Step 8: Run a Short Production Rehearsal

Do not stop at "the pods came up".

Run a short but real rehearsal:

- rolling restart
- restart recovery check for the selected runtime profile
- worker drain / recovery
- one alert-routing exercise
- one benchmark refresh
- one restore/DR exercise if this is a serious environment

That is what converts a technically correct deployment into an operationally credible one.

## Exit Criteria

You can call the deployment production-ready when all of these are true:

- production readiness packet is green
- `ATTESTOR_RUNTIME_PROFILE` is explicitly set
- `/api/v1/ready` returns ready with `checks.releaseRuntime=true`
- `/api/v1/health` reports the expected `runtimeProfile` and `releaseRuntime.durability.ready=true`
- `single-node-durable` restart recovery has passed if you are running one API runtime
- `production-shared` is only used if `ATTESTOR_RELEASE_AUTHORITY_PG_URL` is reachable and the shared request path reports the `async-shared-authority-stores` contract
- observability packet is green
- HA packet is green
- real secrets are loaded from the chosen secret backend
- live traces/logs/metrics are visible
- alerts reach the intended receivers
- shared PostgreSQL and Redis are reachable from the running workload
- the public hostname and TLS path work end to end
- at least one rehearsal rollout has succeeded cleanly

## What Still Remains Outside the Repo

This is the honest boundary.

The repository can now:

- render the bundles
- verify the inputs
- probe the endpoints
- produce rollout checkpoints
- prove `single-node-durable` release-authority restart recovery
- prove the `production-shared` shared authority plane under embedded PostgreSQL multi-instance, concurrency, restart, reconnect, and recovery tests

But it still cannot do these things without your real environment:

- create your cloud accounts
- choose your final production domains
- provide the final TLS material or let cert-manager mint certificates inside your own environment
- provide your real OTLP / PagerDuty / webhook credentials
- produce real production traffic on its own
- prove that your external PostgreSQL, Redis, Kubernetes, secret, DNS, TLS, observability, billing, and rollout environment behaves correctly without live promotion inputs and rehearsal

That is not a weakness in the repo. It is the natural boundary between shipped software and real operations.
