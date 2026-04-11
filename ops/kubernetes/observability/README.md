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
- `kubectl apply -k ops/kubernetes/observability/providers/external-secrets`

This overlay rewires the collector to export traces, metrics, and logs to a
managed OTLP backend while still keeping the local Prometheus scrape surface for
gateway health.

The Grafana Cloud overlay now uses Collector `basicauth` with
endpoint/username/token secrets, and the External Secrets overlay ships
placeholder `ExternalSecret` resources for both collector and Alertmanager
routing credentials.

Retention/SLO tuning can now be rendered separately from benchmark data via:

- `npm run render:observability-profile -- --input=.attestor/observability/latest.json --profile=ops/observability/profiles/regulated-production.json`

And a self-contained release bundle can now be rendered via:

- `npm run render:observability-release-bundle -- --provider=<generic|grafana-cloud> --benchmark=.attestor/observability/latest.json --output-dir=.attestor/observability/release`
- `npm run probe:observability-release-inputs -- --provider=<generic|grafana-cloud> --benchmark=.attestor/observability/latest.json --prometheus-url=<url> --alertmanager-url=<url>`

That release bundle composes:

- the base Kubernetes collector gateway resources
- the managed-backend provider overlay
- rendered secret or `ExternalSecret` resources
- rendered Alertmanager routing config
- rendered SLO/rule/retention artifacts from the selected benchmark profile

Before calling the managed backend wiring production-ready, a rollout-near probe is also available:

- `npm run probe:observability-receivers -- --prometheus-url=<url> --alertmanager-url=<url>`
- `npm run probe:alert-routing`
- `npm run probe:observability-release-inputs -- --provider=<generic|grafana-cloud> --benchmark=.attestor/observability/latest.json --prometheus-url=<url> --alertmanager-url=<url>`
- `npm run render:observability-promotion-packet -- --provider=<generic|grafana-cloud> --benchmark=.attestor/observability/latest.json --prometheus-url=<url> --alertmanager-url=<url>`

That probe:

- emits real OTLP trace/log/metric traffic through the configured exporter env
- forces a telemetry flush
- checks Prometheus API auth with a lightweight instant query
- checks Alertmanager API auth with an alerts listing call
- simulates Alertmanager routing fanout for default/critical/warning/security/billing/watchdog alerts from the rendered config
- validates provider credentials plus External Secrets store/lifecycle inputs and dry-runs the full release-bundle render before probing receivers and route fanout
- emits a single promotion packet summary that captures readiness state, missing inputs, bundle location, and recommended apply flow
