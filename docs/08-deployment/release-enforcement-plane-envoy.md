# Release Enforcement Plane Envoy and Istio External Authorization

This note describes the Step 17 proxy bridge for Attestor release enforcement. It keeps application handlers from becoming the only policy-enforcement point by letting Envoy or Istio pause a request, ask Attestor's external authorizer, and continue only after the same release token, sender binding, output hash, consequence hash, freshness, replay, and introspection checks pass.

Primary references used for the bridge:

- Envoy HTTP `ext_authz` filter: https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter.html
- Envoy authorization service proto: https://www.envoyproxy.io/docs/envoy/latest/api-v3/service/auth/v3/external_auth.proto
- Envoy attribute context proto: https://www.envoyproxy.io/docs/envoy/latest/api-v3/service/auth/v3/attribute_context.proto
- Istio external authorization task: https://istio.io/latest/docs/tasks/security/authorization/authz-custom/
- Istio AuthorizationPolicy reference: https://preliminary.istio.io/latest/docs/reference/config/security/authorization-policy/

## Bridge contract

`src/release-enforcement-plane/envoy-ext-authz.ts` accepts an Envoy v3 `CheckRequest` shape and returns both:

- a gRPC-style `CheckResponse` for Envoy `ext_authz`
- an HTTP-style response shape for HTTP external authorization deployments

The bridge canonicalizes the original downstream request before verification:

- method, scheme, host, path, and reconstructed target URI
- source principal, SPIFFE ID, source certificate thumbprint, and source labels
- destination service, SNI, destination labels, route context extension digests, and route metadata digests
- body digest and selected non-credential headers

Credential and proof headers are excluded from the canonical release binding so the release decision can be prepared before the token/proof exists and still bind to the exact request Envoy is admitting.

## Required Envoy posture

The bridge is designed for fail-closed proxy admission:

- `failure_mode_allow: false`
- `validate_mutations: true`
- `include_peer_certificate: true`
- `include_tls_session: true`
- raw headers enabled for exact check input
- bounded request body buffering for hash binding

The helper `renderEnvoyExtAuthzHttpFilterConfig()` renders the reference filter object:

```yaml
name: envoy.filters.http.ext_authz
typed_config:
  "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
  stat_prefix: attestor_release_ext_authz
  transport_api_version: V3
  grpc_service:
    envoy_grpc:
      cluster_name: attestor-release-ext-authz
    timeout: 0.5s
  failure_mode_allow: false
  status_on_error:
    code: 503
  validate_mutations: true
  include_peer_certificate: true
  include_tls_session: true
  encode_raw_headers: true
  with_request_body:
    max_request_bytes: 16384
    allow_partial_message: false
    pack_as_bytes: true
```

Place the filter before later filters that could mutate routing. Envoy documents route-cache clearing after authorization as a bypass risk, so the deployment posture should keep the protected route stable after the authorization check.

## Istio posture

Istio uses `CUSTOM` authorization policies to delegate to a named MeshConfig extension provider. The bridge helpers render:

- an `extensionProviders` entry with `envoyExtAuthzGrpc` or `envoyExtAuthzHttp`
- an `AuthorizationPolicy` with `action: CUSTOM`

Reference MeshConfig provider:

```yaml
extensionProviders:
- name: attestor-release-ext-authz
  envoyExtAuthzGrpc:
    service: attestor-release-ext-authz.attestor-system.svc.cluster.local
    port: "9000"
    includeRequestHeadersInCheck:
    - authorization
    - dpop
    - attestor-release-token
    - attestor-release-token-id
    - attestor-release-decision-id
    - attestor-target-id
    - attestor-output-hash
    - attestor-consequence-hash
    - traceparent
    headersToUpstreamOnAllow:
    - x-attestor-proxy-enforcement-status
    - attestor-enforcement-request-id
    - attestor-enforcement-receipt-digest
    headersToDownstreamOnDeny:
    - content-type
    - www-authenticate
    - x-attestor-proxy-enforcement-status
```

Reference policy:

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: attestor-release-ext-authz
  namespace: attestor
spec:
  selector:
    matchLabels:
      app: finance-gateway
  action: CUSTOM
  provider:
    name: attestor-release-ext-authz
  rules:
  - to:
    - operation:
        paths:
        - /v1/filings/*
        methods:
        - POST
```

## Presentation modes

The proxy bridge is sender-constrained by default:

- DPoP: `Authorization: DPoP <release-token>` plus `DPoP: <proof-jwt>`
- SPIFFE: source principal from Envoy `AttributeContext.Peer.principal`
- mTLS: peer certificate from `include_peer_certificate` or an already trusted certificate thumbprint header

Bearer fallback is disabled unless an embedding service explicitly enables `allowBearerFallback`. With the default posture, a bare bearer token is treated as a downgrade and denied with `binding-mismatch`.

## Response behavior

Allowed checks return gRPC status `OK` and add:

- `x-attestor-proxy-enforcement-status: allowed`
- `attestor-enforcement-request-id`
- `attestor-enforcement-receipt-digest`

By default, `authorization`, `dpop`, and `attestor-release-token` are removed before the upstream service receives the request.

Denied checks are deterministic:

- missing authorization: HTTP `401`, gRPC `UNAUTHENTICATED`
- replay: HTTP `409`, gRPC `ABORTED`
- fresh introspection required: HTTP `428`, gRPC `FAILED_PRECONDITION`
- control-plane/introspection unavailable: HTTP `503`, gRPC `UNAVAILABLE`
- all other invalid bindings: HTTP `403`, gRPC `PERMISSION_DENIED`

Every response includes Attestor dynamic metadata under `attestor.release_enforcement` for access logs and later telemetry.
