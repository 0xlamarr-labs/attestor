# Attestor Observability Bundle

This bundle ships a local, persisted observability stack for Attestor:

- `attestor-api` with OTLP logs, traces, and metrics enabled
- `otel-collector` for signal fan-out and Prometheus export
- `prometheus` + `alertmanager` for scrape + alert evaluation
- `grafana` for dashboards
- `tempo` for trace storage
- `loki` for structured log storage
- `alertmanager-config-renderer` for severity-based webhook/email routing from environment variables or mounted secret files

Start it with:

```bash
docker compose -f docker-compose.observability.yml up --build
```

The bundled Prometheus job scrapes `GET /api/v1/metrics` using the dedicated bearer token `metrics-secret`, so operators do not need to expose the broader admin API key to the metrics pipeline.

Shipped production-oriented defaults in this bundle:

- Prometheus remote-write receiver enabled so Tempo metrics-generator can write span-metrics + service-graph telemetry
- multi-window burn-rate SLO recording rules and alert rules for API availability and latency
- Loki compactor retention enabled with a 14-day default
- Tempo trace retention and metrics-generator enabled with 14-day defaults
- severity-based Alertmanager routing with Watchdog and critical-over-warning inhibition

Optional Alertmanager delivery wiring comes from:

- `ALERTMANAGER_DEFAULT_WEBHOOK_URL`
- `ALERTMANAGER_CRITICAL_WEBHOOK_URL`
- `ALERTMANAGER_WARNING_WEBHOOK_URL`
- `ALERTMANAGER_DEFAULT_SLACK_WEBHOOK_URL`
- `ALERTMANAGER_DEFAULT_SLACK_CHANNEL`
- `ALERTMANAGER_WARNING_SLACK_WEBHOOK_URL`
- `ALERTMANAGER_WARNING_SLACK_CHANNEL`
- `ALERTMANAGER_CRITICAL_PAGERDUTY_ROUTING_KEY`
- `ALERTMANAGER_SECURITY_WEBHOOK_URL`
- `ALERTMANAGER_BILLING_WEBHOOK_URL`
- `ALERTMANAGER_EMAIL_TO`
- `ALERTMANAGER_EMAIL_FROM`
- `ALERTMANAGER_SMARTHOST`
- `ALERTMANAGER_SMTP_AUTH_USERNAME`
- `ALERTMANAGER_SMTP_AUTH_PASSWORD`
- every secret-like value also supports a `*_FILE` variant for mounted Docker/Kubernetes secrets
- `ALERTMANAGER_PRODUCTION_MODE=true` enables fail-fast validation so incomplete production routing is rejected instead of silently rendering a partial config

Credential bundle rendering:

- `npm run render:observability-credentials`
- emits a redacted summary plus:
  - local `.env` material for the Docker bundle
  - a Grafana Cloud collector Secret manifest
  - an Alertmanager routing Secret manifest

Profile-driven SLO / retention tuning:

- `npm run render:observability-profile -- --input=.attestor/ha-calibration/latest.json --profile=ops/observability/profiles/regulated-production.json`
- shipped profiles live under `ops/observability/profiles/`

Managed collector rollout:

- `ops/kubernetes/observability/` now ships a gateway-style Collector Deployment with HPA, PDB, RBAC, `k8sattributes`, and `resourcedetection`
- `ops/kubernetes/observability/providers/grafana-cloud/` now uses Collector `basicauth` with endpoint/username/token secrets instead of a raw Authorization header
- `ops/kubernetes/observability/providers/external-secrets/` ships `ExternalSecret` templates for the Grafana Cloud collector secret and Alertmanager routing secret

Boundary:

- This is a shipped operator bundle and collector gateway rollout, not a fully managed hosted observability service.
- Default retention and SLO thresholds are opinionated first production defaults and should still be tuned against real traffic and compliance requirements.
- Production paging destinations still require environment-specific webhook/SMTP credentials and escalation policy choices.
