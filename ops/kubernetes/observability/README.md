# Attestor Kubernetes Observability Gateway Bundle

This bundle ships a Collector gateway rollout for Kubernetes, aligned with the
OpenTelemetry gateway deployment pattern.

It assumes:

- external or already-deployed Tempo, Loki, and Prometheus-compatible backends
- a cluster that can run a Deployment + HPA + PDB
- OTLP traffic from Attestor API/worker pods pointing at the gateway service

The bundle includes:

- Collector gateway `Deployment` with `2` replicas
- OTLP gRPC/HTTP `Service`
- `PodDisruptionBudget`
- `HorizontalPodAutoscaler`
- `ServiceAccount` + `ClusterRole` + `ClusterRoleBinding` for the Kubernetes
  attributes processor
- `k8sattributes` + `resourcedetection` + `memory_limiter` + `batch`
  processors

Before applying it, replace:

- `tempo.monitoring.svc.cluster.local:4317`
- `http://loki.monitoring.svc.cluster.local:3100/otlp`
- `attestor-observability`

Typical apply flow:

```powershell
kubectl apply -k ops/kubernetes/observability
kubectl rollout status deployment/attestor-otel-gateway -n attestor-observability
```

Managed backend overlay:

- `kubectl apply -k ops/kubernetes/observability/providers/grafana-cloud`

This overlay rewires the collector to export traces, metrics, and logs to a
managed OTLP backend while still keeping the local Prometheus scrape surface for
gateway health.

Retention/SLO tuning can now be rendered separately from benchmark data via:

- `npm run render:observability-profile -- --input=.attestor/ha-calibration/latest.json --profile=ops/observability/profiles/regulated-production.json`
