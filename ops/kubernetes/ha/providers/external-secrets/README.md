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
