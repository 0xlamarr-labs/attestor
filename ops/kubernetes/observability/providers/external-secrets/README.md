# Attestor Observability External Secrets Overlay

This overlay ships `ExternalSecret` templates for the two production-grade
credential bundles used by the observability stack:

- `attestor-otel-gateway-grafana-cloud`
- `attestor-alertmanager-routing`

It is meant to pair with:

- the base gateway rollout at `ops/kubernetes/observability/`
- the Grafana Cloud managed-backend overlay at `ops/kubernetes/observability/providers/grafana-cloud/`

Adjust the `secretStoreRef` and remote key names to match your secret manager,
then apply with:

```powershell
kubectl apply -k ops/kubernetes/observability/providers/external-secrets
```

Boundary:

- this overlay assumes External Secrets Operator is already installed
- it ships placeholder remote key names, not real provider credentials
