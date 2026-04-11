## Observability Profiles

These profiles turn benchmark data into environment-specific observability tuning packs.

Typical flow:

```powershell
npm run benchmark:ha -- --url=http://127.0.0.1:3700/api/v1/health --duration=30 --concurrency=24 --replicas=3 --output=.attestor/ha-calibration/staging.json
npm run render:observability-profile -- --input=.attestor/ha-calibration/staging.json --profile=ops/observability/profiles/regulated-production.json --output-dir=.attestor/observability/reg-prod
```

The render step produces:

- `summary.json` with measured-vs-target SLO truth
- `recording-rules.generated.yml`
- `alerts.generated.yml`
- `retention.env`
- `README.md`

Shipped profiles:

- `regulated-production.json`
- `lean-production.json`

These are operator defaults, not universal truth. Re-render after large traffic-shape or compliance changes.
