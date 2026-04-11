## HA Calibration Profiles

These profiles turn `npm run benchmark:ha` output into environment-specific KEDA and managed load-balancer tuning artifacts.

Usage:

```powershell
npm run benchmark:ha -- --url=http://127.0.0.1:3700/api/v1/health --duration=30 --concurrency=24 --replicas=3 --output=.attestor/ha-calibration/staging.json
npm run render:ha-profile -- --input=.attestor/ha-calibration/staging.json --profile=ops/kubernetes/ha/profiles/aws-production.json --output-dir=.attestor/ha-calibration/aws-production
```

Shipped profiles:

- `aws-production.json`
- `gke-production.json`

The render step produces:

- `summary.json` with SLO evaluation and recommended thresholds
- `api-scaledobject.patch.yaml`
- `worker-scaledobject.patch.yaml`
- a provider-specific managed LB policy patch
- `README.md` with apply guidance

These profiles are intentionally conservative defaults. They are designed to be rerun after benchmark or production traffic changes, not treated as one-time static truth.
