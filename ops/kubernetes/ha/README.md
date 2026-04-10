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

Typical apply flow:

```powershell
kubectl apply -k ops/kubernetes/ha
kubectl rollout status deployment/attestor-api -n attestor
kubectl rollout status deployment/attestor-worker -n attestor
```

Managed LB overlays:

- `kubectl apply -k ops/kubernetes/ha/providers/gke`
- `kubectl apply -k ops/kubernetes/ha/providers/aws`
