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

Typical apply flow:

```powershell
kubectl apply -k ops/kubernetes/ha
kubectl rollout status deployment/attestor-api -n attestor
kubectl rollout status deployment/attestor-worker -n attestor
```
