# Attestor Observability Grafana Cloud Overlay

This overlay switches the Kubernetes collector gateway from the local LGTM
stack wiring to a managed Grafana Cloud OTLP endpoint.

It assumes:

- you already have the base gateway bundle from `ops/kubernetes/observability/`
- you have generated Grafana Cloud OTLP connection details
- you created the secret values required below

Required secret keys:

- `grafana-cloud-otlp-endpoint`
- `grafana-cloud-otlp-auth-header`

The OTLP auth header should be the full HTTP header value, for example:

```text
Basic <base64(username:token)>
```

Apply it with:

```powershell
kubectl apply -k ops/kubernetes/observability/providers/grafana-cloud
```
