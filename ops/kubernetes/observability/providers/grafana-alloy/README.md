# Attestor Observability Grafana Alloy Overlay

This overlay keeps the existing Attestor OTLP gateway topology, but swaps the
runtime from the upstream OpenTelemetry Collector image to the Grafana-supported
Alloy OTel Engine path.

It assumes:

- you already have the base gateway bundle from `ops/kubernetes/observability/`
- you want Grafana Cloud as the managed OTLP backend
- you want the Grafana-supported production distribution instead of the generic
  upstream collector image

Required secret keys:

- `grafana-cloud-otlp-endpoint`
- `grafana-cloud-otlp-username`
- `grafana-cloud-otlp-token`

This overlay uses:

- the same collector-compatible OTLP YAML pipeline as the existing gateway
- the `grafana/alloy` container image
- the Alloy OpenTelemetry Engine launch path via `bin/otelcol`

Apply it with:

```powershell
kubectl apply -k ops/kubernetes/observability/providers/grafana-alloy
```
