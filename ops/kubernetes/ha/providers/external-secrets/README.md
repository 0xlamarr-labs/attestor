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
