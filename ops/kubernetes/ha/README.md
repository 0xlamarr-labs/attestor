# Attestor Kubernetes HA First Slice

This bundle is the orchestrator-native companion to `docker-compose.ha.yml`.

It assumes:

- external Redis
- shared PostgreSQL control-plane and billing ledger
- `ATTESTOR_HA_MODE=true`
- a Gateway API implementation provided by the cluster

Before applying it, replace:

- `ghcr.io/your-org/attestor-api:latest`
- `ghcr.io/your-org/attestor-worker:latest`
- `managed-external`
- `attestor.example.com`
- the `attestor-runtime-secrets` Secret contents

The bundle now includes:

- zero-downtime rolling updates (`maxUnavailable: 0`, `maxSurge: 1`, `minReadySeconds`)
- tuned HPA behavior for scale up/down
- topology spread + pod anti-affinity for API and worker
- API startup/readiness/liveness probes
- worker `/health` + `/ready` probe surface on `ATTESTOR_WORKER_HEALTH_PORT`
- provider-specific managed LB overlays under `providers/gke` and `providers/aws`
- optional KEDA overlay under `providers/keda` for workload-aware API and worker scaling
- calibration profiles under `profiles/` plus a render step that turns benchmark output into environment-specific KEDA and managed LB patch packs

Typical apply flow:

```powershell
kubectl apply -k ops/kubernetes/ha
kubectl rollout status deployment/attestor-api -n attestor
kubectl rollout status deployment/attestor-worker -n attestor
```

Managed LB overlays:

- `kubectl apply -k ops/kubernetes/ha/providers/gke`
- `kubectl apply -k ops/kubernetes/ha/providers/aws`

Workload-aware autoscaling overlay:

- `kubectl apply -k ops/kubernetes/ha/providers/keda`

Notes:

- the KEDA overlay replaces the base HPAs with:
  - Prometheus request-rate scaling for `attestor-api`
  - Redis waiting-list scaling for `attestor-worker`
- the GKE overlay now also carries `GCPBackendPolicy` and `GCPGatewayPolicy` placeholders for timeout/draining/Cloud Armor/TLS policy finalization
- the AWS overlay now carries target-group and load-balancer attributes for safer draining and fairer request distribution
- cloud secret/certificate wiring overlays now also exist under:
  - `providers/cert-manager`
  - `providers/external-secrets`
- a repeatable local calibration harness is available via:
  - `npm run benchmark:ha -- --url=http://127.0.0.1:3700/api/v1/health --duration=20 --concurrency=16 --replicas=2`
- a repeatable tuning render step is available via:
  - `npm run render:ha-profile -- --input=.attestor/ha-calibration/latest.json --profile=ops/kubernetes/ha/profiles/aws-production.json`
- an ops-ready credential/certificate render step is available via:
  - `npm run render:ha-credentials -- --provider=<generic|aws|gke> --output-dir=.attestor/ha/credentials`
- a self-contained release bundle render step is available via:
  - `npm run render:ha-release-bundle -- --provider=<aws|gke|generic> --benchmark=.attestor/ha-calibration/latest.json --output-dir=.attestor/ha/release`
- a rollout-near release preflight is available via:
  - `npm run probe:ha-release-inputs -- --provider=<aws|gke|generic> --benchmark=.attestor/ha-calibration/latest.json`
- a target-near runtime connectivity gate is available via:
  - `npm run probe:ha-runtime-connectivity -- --provider=<aws|gke|generic>`
- a single promotion packet handoff is now available via:
  - `npm run render:ha-promotion-packet -- --provider=<aws|gke|generic> --benchmark=.attestor/ha-calibration/latest.json`
- a combined production readiness packet is now available via:
  - `npm run render:production-readiness-packet -- --observability-provider=<generic|grafana-cloud|grafana-alloy> --observability-benchmark=.attestor/observability/calibration/latest/benchmark.json --ha-provider=<aws|gke|generic> --ha-benchmark=.attestor/ha-calibration/latest.json`
- the recommended managed-secret bootstrap is now available via:
  - `npm run render:secret-manager-bootstrap -- --provider=<aws|gke|all> --output-dir=.attestor/secret-bootstrap`

Credential/certificate wiring notes:

- `render:ha-credentials` materializes:
  - inline runtime Secret manifests
  - ExternalSecret manifests for runtime and TLS material
  - Gateway hostname/TLS patches
  - cert-manager `Certificate` manifests
  - AWS ACM / ALB HTTPS patches
  - GKE Gateway policy patches
- `render:ha-release-bundle` turns the benchmark + credential render outputs into a self-contained apply-ready bundle with final resources, not just patch fragments
- `probe:ha-runtime-connectivity` validates target-near Redis reachability, control-plane/billing-ledger PostgreSQL connectivity, hostname/image sanity, and TLS material shape before promotion
- `probe:ha-release-inputs` validates the minimum shared-state, image, hostname, Redis, control-plane, billing-ledger, and TLS inputs for a real HA promotion, runs the runtime-connectivity probe, then dry-runs the final release-bundle render before rollout
- `render:ha-promotion-packet` collapses the benchmark truth, release preflight, missing-input inventory, release-bundle location, and recommended apply flow into one rollout checkpoint
- `render:production-readiness-packet` fuses the HA and observability promotion packets, then blocks promotion if either benchmark is stale
- `render:secret-manager-bootstrap` emits provider-ready `ClusterSecretStore` manifests plus the exact remote secret catalog for the HA runtime/TLS and observability secret surfaces
- HA External Secrets lifecycle can be tuned without hand-editing YAML via:
  - `ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND`
  - `ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL`
  - `ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY`
  - `ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY`
- every secret-like input also supports a `*_FILE` variant for mounted secrets
- set `ATTESTOR_HA_PRODUCTION_MODE=true` to force the minimum shared-state/runtime inputs needed for a real HA rollout
