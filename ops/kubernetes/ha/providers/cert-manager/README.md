# Attestor HA cert-manager Overlay

This overlay adds certificate automation for the Gateway/API entrypoint using
cert-manager.

It assumes:

- cert-manager is already installed
- a `ClusterIssuer` exists in the cluster

Before applying it, replace:

- `letsencrypt-prod`
- `attestor.example.com`

Apply it with:

```powershell
kubectl apply -k ops/kubernetes/ha/providers/cert-manager
```

Renderer-assisted flow:

```powershell
npm run render:ha-credentials -- --provider=gke --output-dir=.attestor/ha/credentials
```

When `ATTESTOR_TLS_MODE=cert-manager`, the renderer emits a ready-to-edit
`cert-manager.certificate.yaml` manifest with the chosen hostname, secret name,
and `ClusterIssuer`.
