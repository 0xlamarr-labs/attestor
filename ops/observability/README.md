# Attestor Observability Bundle

This bundle ships a local, persisted observability stack for Attestor:

- `attestor-api` with OTLP logs, traces, and metrics enabled
- `otel-collector` for signal fan-out and Prometheus export
- `prometheus` + `alertmanager` for scrape + alert evaluation
- `grafana` for dashboards
- `tempo` for trace storage
- `loki` for structured log storage

Start it with:

```bash
docker compose -f docker-compose.observability.yml up --build
```

The bundled Prometheus job scrapes `GET /api/v1/metrics` using the dedicated bearer token `metrics-secret`, so operators do not need to expose the broader admin API key to the metrics pipeline.

Boundary:

- This is a shipped operator bundle, not a managed hosted observability service.
- Retention is local-volume based and should be tuned before production use.
- Alert routing is intentionally minimal by default and should be connected to the team's real paging/email/webhook system.
