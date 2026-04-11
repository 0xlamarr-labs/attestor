# Attestor Observability Grafana Cloud Overlay

This overlay switches the Kubernetes collector gateway from the local LGTM
stack wiring to a managed Grafana Cloud OTLP endpoint.

It assumes:

- you already have the base gateway bundle from `ops/kubernetes/observability/`
- you have generated Grafana Cloud OTLP connection details
- you created the secret values required below

Required secret keys:

- `grafana-cloud-otlp-endpoint`
- `grafana-cloud-otlp-username`
- `grafana-cloud-otlp-token`

This overlay now uses the Collector `basicauth` authenticator pattern instead of
injecting a raw `Authorization` header string. That keeps the wiring closer to
the official OpenTelemetry auth model and makes secret rotation cleaner.

Apply it with:

```powershell
kubectl apply -k ops/kubernetes/observability/providers/grafana-cloud
```
