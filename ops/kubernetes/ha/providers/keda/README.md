# Attestor HA KEDA Overlay

This overlay replaces the base CPU/memory-only HPAs with workload-aware KEDA
scalers:

- API scale-out from Prometheus request-rate telemetry
- worker scale-out from BullMQ Redis waiting-list backlog

It assumes:

- KEDA is already installed in the cluster
- Prometheus is reachable from the KEDA operator
- the runtime secret contains Redis scaler keys:
  - `redis-address`
  - `redis-password`
  - optionally `redis-username` for ACL deployments

Apply it with:

```powershell
kubectl apply -k ops/kubernetes/ha/providers/keda
```
