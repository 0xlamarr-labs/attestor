# Attestor GKE Gateway Cutover

This directory covers the public GKE Gateway path for Attestor.

## Two phases

1. **bootstrap**
   - static public IP
   - HTTP Gateway listener
   - optional `<ip>.sslip.io` hostname for immediate public proof
2. **final delegated-domain cutover**
   - real hostname
   - HTTPS listener
   - HTTP `301` redirect
   - cert-manager certificate issuance

## Bootstrap

The base HA bundle already ships the HTTP bootstrap path:

- [gateway.yaml](/C:/Users/thedi/attestor/ops/kubernetes/ha/gateway.yaml)
- [httproute.yaml](/C:/Users/thedi/attestor/ops/kubernetes/ha/httproute.yaml)

This is the fast path for:

- smoke-testing the public Gateway
- confirming the reserved global address
- proving the stack with `sslip.io` before final DNS delegation

## Final-domain cutover

Render the dedicated cutover bundle with:

```powershell
npm run render:gke-domain-cutover -- --hostname=api.example.com --static-address-name=attestor-gateway-ip --dns-target-ip=203.0.113.10
```

The generated bundle contains:

- `gateway.yaml`
- `httproute.yaml`
- `clusterissuer.yaml`
- `certificate.yaml`
- `kustomization.yaml`
- `summary.json`

Apply it with:

```powershell
kubectl apply -k .attestor/ha/gke-domain-cutover/api.example.com
```

## DNS handoff

The intended cutover is:

- create an `A` record for your final hostname
- point it at the public GKE IPv4
- keep the Gateway `NamedAddress` aligned with the reserved static address name

If you are not ready for your delegated zone yet, the bootstrap hostname can still be:

- `<gateway-ip>.sslip.io`

## Related manifests

- [https-gateway.example.yaml](/C:/Users/thedi/attestor/ops/kubernetes/ha/providers/gke/https-gateway.example.yaml)
- [https-httproute.example.yaml](/C:/Users/thedi/attestor/ops/kubernetes/ha/providers/gke/https-httproute.example.yaml)
- [clusterissuer.example.yaml](/C:/Users/thedi/attestor/ops/kubernetes/ha/providers/cert-manager/clusterissuer.example.yaml)
- [certificate.yaml](/C:/Users/thedi/attestor/ops/kubernetes/ha/providers/cert-manager/certificate.yaml)
