# Attestor HA External Secrets Overlay

This overlay replaces hand-managed runtime secrets with External Secrets
Operator resources.

It assumes:

- External Secrets Operator is installed
- a `ClusterSecretStore` exists and is reachable by the cluster

Before applying it, replace:

- `platform-secrets`
- the remote secret keys in both resources

Apply it with:

```powershell
kubectl apply -k ops/kubernetes/ha/providers/external-secrets
```

Renderer-assisted flow:

```powershell
npm run render:ha-credentials -- --provider=gke --output-dir=.attestor/ha/credentials
```

That bundle can emit environment-specific `runtime-secrets.external-secret.yaml`
and `tls.external-secret.yaml` manifests with the right secret-store name, prefix,
and hostname/TLS wiring before you copy the final values into this overlay.

The renderer also supports lifecycle tuning without hand-editing the manifests:

- `ATTESTOR_HA_EXTERNAL_SECRET_STORE_KIND`
- `ATTESTOR_HA_EXTERNAL_SECRET_REFRESH_INTERVAL`
- `ATTESTOR_HA_EXTERNAL_SECRET_CREATION_POLICY`
- `ATTESTOR_HA_EXTERNAL_SECRET_DELETION_POLICY`

Recommended bootstrap:

```powershell
npm run render:secret-manager-bootstrap -- --provider=<aws|gke|all> --output-dir=.attestor/secret-bootstrap
```

That bundle emits provider-ready `ClusterSecretStore` manifests plus the exact
remote secret names expected by this HA overlay.
