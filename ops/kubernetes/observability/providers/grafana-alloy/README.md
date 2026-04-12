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

The recommended managed path is the **single Grafana Cloud OTLP gateway**, not
the older split `prometheus/loki/tempo` destination pattern. In practice that
means:

- `grafana-cloud-otlp-endpoint` should come from the stack `otlpHttpUrl`
  connection field and point at the unified `/otlp` gateway
- `grafana-cloud-otlp-username` should be the stack's **Grafana tenant id**
  from the same connections payload, not the separate per-signal tenant ids
- `grafana-cloud-otlp-token` is the Grafana Cloud access token / password used
  with that basic-auth pair

A concrete values example for that live-proven path ships here:

- [otlp-gateway.values.example.yaml](/C:/Users/thedi/attestor/ops/kubernetes/observability/providers/grafana-alloy/otlp-gateway.values.example.yaml)

This overlay uses:

- the same collector-compatible OTLP YAML pipeline as the existing gateway
- the `grafana/alloy` container image
- the Alloy OpenTelemetry Engine launch path via `bin/otelcol`

Apply it with:

```powershell
kubectl apply -k ops/kubernetes/observability/providers/grafana-alloy
```
