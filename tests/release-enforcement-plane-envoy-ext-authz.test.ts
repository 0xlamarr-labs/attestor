import assert from 'node:assert/strict';
import { generateKeyPair } from '../src/signing/keys.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createReleaseTokenIssuer,
  type IssuedReleaseToken,
  type ReleaseTokenVerificationKey,
} from '../src/release-kernel/release-token.js';
import type {
  ReleaseDecision,
  ReleaseTokenConfirmationClaim,
} from '../src/release-kernel/object-model.js';
import {
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
  type ReleaseTokenIntrospectionStore,
  type ReleaseTokenIntrospector,
} from '../src/release-kernel/release-introspection.js';
import {
  ATTESTOR_CLIENT_CERTIFICATE_THUMBPRINT_HEADER,
  ATTESTOR_PROXY_ENFORCEMENT_RECEIPT_DIGEST_HEADER,
  ATTESTOR_PROXY_ENFORCEMENT_STATUS_HEADER,
  ATTESTOR_RELEASE_PRESENTATION_MODE_HEADER,
  ENVOY_EXT_AUTHZ_DYNAMIC_METADATA_NAMESPACE,
  RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION,
  buildEnvoyExtAuthzCanonicalBinding,
  envoyOriginalRequestUri,
  evaluateEnvoyExternalAuthorization,
  renderEnvoyExtAuthzHttpFilterConfig,
  renderIstioExtAuthzAuthorizationPolicy,
  renderIstioExtAuthzExtensionProvider,
  type EnvoyExtAuthzCheckRequest,
} from '../src/release-enforcement-plane/envoy-ext-authz.js';
import {
  ATTESTOR_CONSEQUENCE_HASH_HEADER,
  ATTESTOR_OUTPUT_HASH_HEADER,
  ATTESTOR_RELEASE_DECISION_ID_HEADER,
  ATTESTOR_RELEASE_TOKEN_ID_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
} from '../src/release-enforcement-plane/http-message-signatures.js';
import {
  ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER,
  ATTESTOR_RELEASE_TOKEN_HEADER,
} from '../src/release-enforcement-plane/middleware.js';
import {
  createDpopProof,
  dpopReplayKey,
  generateDpopKeyPair,
  type DpopKeyPair,
} from '../src/release-enforcement-plane/dpop.js';
import {
  certificateThumbprintFromPem,
  createMtlsReleaseTokenConfirmation,
  createSpiffeReleaseTokenConfirmation,
} from '../src/release-enforcement-plane/workload-binding.js';
import type { ReplayLedgerEntry } from '../src/release-enforcement-plane/freshness.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  passed += 1;
}

const CHECKED_AT = '2026-04-18T22:00:20.000Z';
const WORKLOAD_SPIFFE_ID = 'spiffe://attestor.test/ns/finance/sa/proxy-client';
const PEER_CERTIFICATE = [
  '-----BEGIN CERTIFICATE-----',
  'AQIDBAUGBwgJCgsMDQ4PEA==',
  '-----END CERTIFICATE-----',
].join('\n');
const PEER_CERTIFICATE_THUMBPRINT = certificateThumbprintFromPem(PEER_CERTIFICATE);

const BASE_CHECK: EnvoyExtAuthzCheckRequest = Object.freeze({
  attributes: Object.freeze({
    source: Object.freeze({
      service: 'finance-api.attestor.svc.cluster.local',
      principal: WORKLOAD_SPIFFE_ID,
      certificate: PEER_CERTIFICATE,
      labels: Object.freeze({
        app: 'finance-api',
        version: 'v1',
      }),
    }),
    destination: Object.freeze({
      service: 'finance-gateway.attestor.svc.cluster.local',
      labels: Object.freeze({
        app: 'finance-gateway',
      }),
    }),
    request: Object.freeze({
      time: CHECKED_AT,
      http: Object.freeze({
        id: 'req-envoy-ext-authz-1',
        method: 'POST',
        scheme: 'https',
        host: 'finance.attestor.local',
        path: '/v1/filings/prepare?run=2026-04-18',
        protocol: 'HTTP/2',
        headers: Object.freeze({
          ':method': 'POST',
          ':path': '/v1/filings/prepare?run=2026-04-18',
          ':scheme': 'https',
          ':authority': 'finance.attestor.local',
          'content-type': 'application/json',
          'x-request-id': 'req-envoy-ext-authz-1',
          traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
          'x-attestor-workflow': 'filing-prepare',
        }),
        body: '{"runId":"run-2026-04-18","transition":"prepare"}',
      }),
    }),
    context_extensions: Object.freeze({
      'attestor.target_id': 'finance.reporting.proxy.prepare-filing',
      'istio.authorization_provider': 'attestor-release-ext-authz',
    }),
    metadata_context: Object.freeze({
      filter_metadata: Object.freeze({
        'envoy.filters.http.jwt_authn': Object.freeze({
          issuer: 'attestor.release.local',
        }),
      }),
    }),
    route_metadata_context: Object.freeze({
      route: Object.freeze({
        name: 'finance-prepare-filing',
      }),
    }),
    tls_session: Object.freeze({
      sni: 'finance.attestor.local',
    }),
  }),
});

function makeDecision(input: {
  readonly id: string;
  readonly binding: ReturnType<typeof buildEnvoyExtAuthzCanonicalBinding>;
}): ReleaseDecision {
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T22:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-envoy-ext-authz-test.v1',
    policyHash: 'sha256:policy',
    outputHash: input.binding.hashBundle.outputHash,
    consequenceHash: input.binding.hashBundle.consequenceHash,
    outputContract: input.binding.outputContract,
    capabilityBoundary: {
      allowedTools: ['proxy-ext-authz', 'envoy-ext-authz', 'istio-custom-authz'],
      allowedTargets: [input.binding.target.id],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.release-envoy-ext-authz-test',
      type: 'service',
    },
    target: input.binding.target,
  });
}

async function setupIssuer() {
  const keyPair = generateKeyPair();
  const issuer = createReleaseTokenIssuer({
    issuer: 'attestor.release.local',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  return {
    issuer,
    verificationKey: await issuer.exportVerificationKey(),
  };
}

async function issueProxyToken(input: {
  readonly tokenId: string;
  readonly decisionId: string;
  readonly checkRequest?: EnvoyExtAuthzCheckRequest;
  readonly confirmation?: ReleaseTokenConfirmationClaim;
}): Promise<{
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly decision: ReleaseDecision;
  readonly binding: ReturnType<typeof buildEnvoyExtAuthzCanonicalBinding>;
}> {
  const binding = buildEnvoyExtAuthzCanonicalBinding(input.checkRequest ?? BASE_CHECK);
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    binding,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T22:00:00.000Z',
    tokenId: input.tokenId,
    confirmation: input.confirmation,
  });

  return { issued, verificationKey, decision, binding };
}

function register(
  issued: IssuedReleaseToken,
  decision: ReleaseDecision,
): {
  readonly store: ReleaseTokenIntrospectionStore;
  readonly introspector: ReleaseTokenIntrospector;
} {
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  store.registerIssuedToken({ issuedToken: issued, decision });
  return { store, introspector };
}

function nonceLedgerEntry(nonce: string) {
  return {
    nonce,
    issuedAt: '2026-04-18T21:59:50.000Z',
    expiresAt: '2026-04-18T22:01:30.000Z',
  };
}

function options(input: {
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly introspector?: ReleaseTokenIntrospector;
  readonly store?: ReleaseTokenIntrospectionStore;
  readonly verifierMode?: 'offline' | 'online';
  readonly nonce?: string;
  readonly replayLedgerEntry?: ReplayLedgerEntry;
}) {
  return {
    verificationKey: input.verificationKey,
    enforcementPointId: 'attestor-release-ext-authz',
    environment: 'test',
    tenantId: 'tenant-test',
    accountId: 'acct-test',
    introspector: input.introspector,
    usageStore: input.store,
    verifierMode: input.verifierMode,
    requestId: 'erq-envoy-ext-authz-test',
    replayLedgerEntry: input.replayLedgerEntry,
    nonceLedgerEntry: input.nonce ? nonceLedgerEntry(input.nonce) : undefined,
    now: () => CHECKED_AT,
  };
}

function withHeaders(
  checkRequest: EnvoyExtAuthzCheckRequest,
  headers: Readonly<Record<string, string>>,
): EnvoyExtAuthzCheckRequest {
  const attributes = checkRequest.attributes ?? {};
  const request = attributes.request ?? {};
  const http = request.http ?? {};
  return Object.freeze({
    attributes: Object.freeze({
      ...attributes,
      request: Object.freeze({
        ...request,
        http: Object.freeze({
          ...http,
          headers: Object.freeze({
            ...(http.headers ?? {}),
            ...headers,
          }),
        }),
      }),
    }),
  });
}

function withoutSourceIdentity(checkRequest: EnvoyExtAuthzCheckRequest): EnvoyExtAuthzCheckRequest {
  const attributes = checkRequest.attributes ?? {};
  return Object.freeze({
    attributes: Object.freeze({
      ...attributes,
      source: Object.freeze({
        service: attributes.source?.service,
        labels: attributes.source?.labels,
      }),
    }),
  });
}

function withPath(checkRequest: EnvoyExtAuthzCheckRequest, path: string): EnvoyExtAuthzCheckRequest {
  const attributes = checkRequest.attributes ?? {};
  const request = attributes.request ?? {};
  const http = request.http ?? {};
  return Object.freeze({
    attributes: Object.freeze({
      ...attributes,
      request: Object.freeze({
        ...request,
        http: Object.freeze({
          ...http,
          path,
          headers: Object.freeze({
            ...(http.headers ?? {}),
            ':path': path,
          }),
        }),
      }),
    }),
  });
}

async function dpopHeaders(input: {
  readonly issued: IssuedReleaseToken;
  readonly decision: ReleaseDecision;
  readonly dpopKey: DpopKeyPair;
  readonly checkRequest?: EnvoyExtAuthzCheckRequest;
  readonly nonce?: string;
  readonly proofJti?: string;
  readonly uri?: string;
}) {
  const nonce = input.nonce ?? 'nonce-envoy-ext-authz';
  const proof = await createDpopProof({
    privateJwk: input.dpopKey.privateJwk,
    publicJwk: input.dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: input.uri ?? envoyOriginalRequestUri(input.checkRequest ?? BASE_CHECK),
    accessToken: input.issued.token,
    nonce,
    proofJti: input.proofJti ?? 'dpop-proof-envoy-ext-authz',
    issuedAt: '2026-04-18T22:00:10.000Z',
  });

  return {
    headers: {
      authorization: `DPoP ${input.issued.token}`,
      dpop: proof.proofJwt,
      [ATTESTOR_RELEASE_TOKEN_ID_HEADER]: input.issued.tokenId,
      [ATTESTOR_RELEASE_DECISION_ID_HEADER]: input.decision.id,
    },
    nonce,
    proof,
  };
}

function tokenBindingHeaders(input: {
  readonly issued: IssuedReleaseToken;
  readonly decision: ReleaseDecision;
  readonly binding: ReturnType<typeof buildEnvoyExtAuthzCanonicalBinding>;
}): Readonly<Record<string, string>> {
  return {
    [ATTESTOR_RELEASE_TOKEN_ID_HEADER]: input.issued.tokenId,
    [ATTESTOR_RELEASE_DECISION_ID_HEADER]: input.decision.id,
    [ATTESTOR_TARGET_ID_HEADER]: input.binding.target.id,
    [ATTESTOR_OUTPUT_HASH_HEADER]: input.binding.hashBundle.outputHash,
    [ATTESTOR_CONSEQUENCE_HASH_HEADER]: input.binding.hashBundle.consequenceHash,
  };
}

async function testCanonicalBinding(): Promise<void> {
  const left = buildEnvoyExtAuthzCanonicalBinding(BASE_CHECK);
  const right = buildEnvoyExtAuthzCanonicalBinding(BASE_CHECK);

  equal(left.version, RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION, 'Envoy bridge: binding version is stable');
  equal(left.target.id, 'finance.reporting.proxy.prepare-filing', 'Envoy bridge: target comes from context extension');
  equal(left.target.kind, 'endpoint', 'Envoy bridge: proxy target defaults to endpoint');
  equal(left.proxyRequest.method, 'POST', 'Envoy bridge: method is normalized');
  equal(left.proxyRequest.targetUri, 'https://finance.attestor.local/v1/filings/prepare?run=2026-04-18', 'Envoy bridge: original request URI is reconstructed');
  equal(left.proxyRequest.source.principal, WORKLOAD_SPIFFE_ID, 'Envoy bridge: source principal is captured');
  equal(left.proxyRequest.source.certificateThumbprint, PEER_CERTIFICATE_THUMBPRINT, 'Envoy bridge: source certificate thumbprint is derived');
  ok(left.proxyRequest.selectedHeaders.authorization === undefined, 'Envoy bridge: authorization header is excluded from release binding');
  equal(left.hashBundle.outputHash, right.hashBundle.outputHash, 'Envoy bridge: output hash is deterministic');
  equal(left.hashBundle.consequenceHash, right.hashBundle.consequenceHash, 'Envoy bridge: consequence hash is deterministic');
  ok(left.checkHash.startsWith('sha256:'), 'Envoy bridge: check hash is recorded');
}

async function testConfigRendering(): Promise<void> {
  const envoy = renderEnvoyExtAuthzHttpFilterConfig();
  equal(envoy.name, 'envoy.filters.http.ext_authz', 'Envoy bridge: renders ext_authz HTTP filter');
  equal(envoy.typed_config.failure_mode_allow, false, 'Envoy bridge: failure mode is fail closed');
  equal(envoy.typed_config.include_peer_certificate, true, 'Envoy bridge: peer certificate inclusion is enabled');
  equal(envoy.typed_config.include_tls_session, true, 'Envoy bridge: TLS session inclusion is enabled');
  equal(envoy.typed_config.validate_mutations, true, 'Envoy bridge: response mutation validation is enabled');
  equal(envoy.typed_config.status_on_error.code, 503, 'Envoy bridge: control-plane errors surface as unavailable');
  ok(envoy.typed_config.allowed_headers.patterns.some((pattern) => pattern.exact === 'dpop'), 'Envoy bridge: DPoP header is included in checks');

  const provider = renderIstioExtAuthzExtensionProvider({
    name: 'attestor-release-ext-authz',
    service: 'attestor-release-ext-authz.attestor-system.svc.cluster.local',
    port: 9000,
  });
  equal(provider.name, 'attestor-release-ext-authz', 'Istio bridge: provider name is stable');
  equal(provider.envoyExtAuthzGrpc.service, 'attestor-release-ext-authz.attestor-system.svc.cluster.local', 'Istio bridge: provider service is rendered');
  equal(provider.envoyExtAuthzGrpc.port, '9000', 'Istio bridge: provider port is a string for MeshConfig');
  ok(provider.envoyExtAuthzGrpc.headersToUpstreamOnAllow.includes(ATTESTOR_PROXY_ENFORCEMENT_RECEIPT_DIGEST_HEADER), 'Istio bridge: receipt digest can go upstream on allow');

  const policy = renderIstioExtAuthzAuthorizationPolicy({
    name: 'attestor-release-ext-authz',
    namespace: 'attestor',
    providerName: 'attestor-release-ext-authz',
    selectorLabels: { app: 'finance-gateway' },
    paths: ['/v1/filings/*'],
    methods: ['POST'],
  });
  equal(policy.apiVersion, 'security.istio.io/v1', 'Istio bridge: policy uses stable security API');
  equal(policy.spec.action, 'CUSTOM', 'Istio bridge: policy delegates through CUSTOM action');
  equal(policy.spec.provider.name, 'attestor-release-ext-authz', 'Istio bridge: policy references provider');
  deepEqual(policy.spec.selector?.matchLabels, { app: 'finance-gateway' }, 'Istio bridge: selector labels are preserved');
  deepEqual(policy.spec.rules[0]?.to[0]?.operation.paths, ['/v1/filings/*'], 'Istio bridge: protected paths are rendered');
}

async function testValidDpopProxyCheck(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueProxyToken({
    tokenId: 'token-envoy-dpop',
    decisionId: 'decision-envoy-dpop',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const proof = await dpopHeaders({ issued, decision, dpopKey });
  const checkRequest = withHeaders(BASE_CHECK, proof.headers);

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: proof.nonce,
    }),
  });

  equal(result.status, 'allowed', 'Envoy bridge: valid DPoP proxy check is allowed');
  equal(result.checkResponse.status.code, 0, 'Envoy bridge: allowed CheckResponse uses gRPC OK');
  equal(result.httpResponse.status, 200, 'Envoy bridge: HTTP authorization service allows with 200');
  equal(result.presentation?.mode, 'dpop-bound-token', 'Envoy bridge: DPoP proof becomes DPoP presentation');
  equal(result.request?.enforcementPoint.pointKind, 'proxy-ext-authz', 'Envoy bridge: request uses proxy-ext-authz point kind');
  equal(result.request?.enforcementPoint.boundaryKind, 'proxy-admission', 'Envoy bridge: request uses proxy-admission boundary');
  equal(result.online?.consumed, true, 'Envoy bridge: online verifier consumes successful proxy token');
  equal(store.findToken(issued.tokenId)?.status, 'consumed', 'Envoy bridge: token store records consumption');
  ok(result.checkResponse.ok_response?.headers_to_remove?.includes('authorization'), 'Envoy bridge: credentials are stripped before upstream by default');
  ok(result.checkResponse.ok_response?.headers?.some((entry) => entry.header.key === ATTESTOR_PROXY_ENFORCEMENT_STATUS_HEADER), 'Envoy bridge: allow status header is added');
  ok(result.receipt?.receiptDigest?.startsWith('sha256:'), 'Envoy bridge: allowed check has an enforcement receipt digest');
  ok(Boolean(result.checkResponse.dynamic_metadata?.[ENVOY_EXT_AUTHZ_DYNAMIC_METADATA_NAMESPACE]), 'Envoy bridge: dynamic metadata is populated');
}

async function testValidSpiffeProxyCheck(): Promise<void> {
  const { issued, verificationKey, decision } = await issueProxyToken({
    tokenId: 'token-envoy-spiffe',
    decisionId: 'decision-envoy-spiffe',
    confirmation: createSpiffeReleaseTokenConfirmation({
      spiffeId: WORKLOAD_SPIFFE_ID,
      certificateThumbprint: PEER_CERTIFICATE_THUMBPRINT,
    }),
  });
  const { store, introspector } = register(issued, decision);
  const binding = buildEnvoyExtAuthzCanonicalBinding(BASE_CHECK);
  const checkRequest = withHeaders(BASE_CHECK, {
    authorization: `Bearer ${issued.token}`,
    [ATTESTOR_RELEASE_PRESENTATION_MODE_HEADER]: 'spiffe-bound-token',
    ...tokenBindingHeaders({ issued, decision, binding }),
  });

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({ verificationKey, introspector, store }),
  });

  equal(result.status, 'allowed', 'Envoy bridge: valid SPIFFE proxy check is allowed');
  equal(result.presentation?.mode, 'spiffe-bound-token', 'Envoy bridge: SPIFFE principal becomes SPIFFE presentation');
  equal(result.presentation?.proof?.kind, 'spiffe', 'Envoy bridge: SPIFFE proof is attached');
  equal(result.responseStatus, 200, 'Envoy bridge: SPIFFE allow response is 200');
  equal(result.online?.active, true, 'Envoy bridge: SPIFFE token is active at introspection');
}

async function testValidMtlsProxyCheck(): Promise<void> {
  const mtlsCheck = withHeaders(BASE_CHECK, {
    [ATTESTOR_CLIENT_CERTIFICATE_THUMBPRINT_HEADER]: PEER_CERTIFICATE_THUMBPRINT,
  });
  const { issued, verificationKey, decision, binding } = await issueProxyToken({
    tokenId: 'token-envoy-mtls',
    decisionId: 'decision-envoy-mtls',
    checkRequest: mtlsCheck,
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: PEER_CERTIFICATE_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  const { store, introspector } = register(issued, decision);
  const checkRequest = withHeaders(mtlsCheck, {
    authorization: `Bearer ${issued.token}`,
    [ATTESTOR_RELEASE_PRESENTATION_MODE_HEADER]: 'mtls-bound-token',
    ...tokenBindingHeaders({ issued, decision, binding }),
  });

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({ verificationKey, introspector, store }),
  });

  equal(result.status, 'allowed', 'Envoy bridge: valid mTLS proxy check is allowed');
  equal(result.presentation?.mode, 'mtls-bound-token', 'Envoy bridge: mTLS thumbprint becomes mTLS presentation');
  equal(result.presentation?.proof?.kind, 'mtls', 'Envoy bridge: mTLS proof is attached');
  equal(result.responseStatus, 200, 'Envoy bridge: mTLS allow response is 200');
}

async function testMissingAuthorizationFailsClosed(): Promise<void> {
  const { verificationKey } = await issueProxyToken({
    tokenId: 'token-envoy-missing',
    decisionId: 'decision-envoy-missing',
  });
  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest: BASE_CHECK,
    options: options({ verificationKey }),
  });

  equal(result.status, 'denied', 'Envoy bridge: missing authorization is denied');
  equal(result.responseStatus, 401, 'Envoy bridge: missing authorization maps to 401');
  equal(result.checkResponse.status.code, 16, 'Envoy bridge: missing authorization maps to gRPC unauthenticated');
  deepEqual(result.failureReasons, ['missing-release-authorization'], 'Envoy bridge: missing authorization reason is stable');
  ok(Boolean(result.httpResponse.headers['www-authenticate']), 'Envoy bridge: deny response includes WWW-Authenticate');
}

async function testBearerDowngradeFailsClosed(): Promise<void> {
  const { issued, verificationKey, decision, binding } = await issueProxyToken({
    tokenId: 'token-envoy-bearer',
    decisionId: 'decision-envoy-bearer',
  });
  const { store, introspector } = register(issued, decision);
  const checkRequest = withHeaders(withoutSourceIdentity(BASE_CHECK), {
    authorization: `Bearer ${issued.token}`,
    ...tokenBindingHeaders({ issued, decision, binding }),
  });

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({ verificationKey, introspector, store }),
  });

  equal(result.status, 'denied', 'Envoy bridge: bearer downgrade is denied by default');
  equal(result.responseStatus, 403, 'Envoy bridge: bearer downgrade maps to 403');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Envoy bridge: bearer downgrade maps to binding mismatch');
  equal(store.findToken(issued.tokenId)?.status, 'issued', 'Envoy bridge: denied bearer token is not consumed');
}

async function testChangedPathFailsBinding(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueProxyToken({
    tokenId: 'token-envoy-path',
    decisionId: 'decision-envoy-path',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const changed = withPath(BASE_CHECK, '/v1/filings/submit?run=2026-04-18');
  const proof = await dpopHeaders({
    issued,
    decision,
    dpopKey,
    checkRequest: changed,
    nonce: 'nonce-envoy-path',
    proofJti: 'dpop-proof-envoy-path',
  });
  const checkRequest = withHeaders(changed, proof.headers);

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: proof.nonce,
    }),
  });

  equal(result.status, 'denied', 'Envoy bridge: changed route path is denied');
  equal(result.responseStatus, 403, 'Envoy bridge: changed route path maps to 403');
  ok(result.failureReasons.includes('binding-mismatch'), 'Envoy bridge: changed route path maps to binding mismatch');
  equal(store.findToken(issued.tokenId)?.status, 'issued', 'Envoy bridge: mismatched token is not consumed');
}

async function testWrongDpopUriFails(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueProxyToken({
    tokenId: 'token-envoy-wrong-dpop',
    decisionId: 'decision-envoy-wrong-dpop',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const proof = await dpopHeaders({
    issued,
    decision,
    dpopKey,
    nonce: 'nonce-envoy-wrong-dpop',
    proofJti: 'dpop-proof-envoy-wrong-dpop',
    uri: 'https://finance.attestor.local/v1/other',
  });
  const checkRequest = withHeaders(BASE_CHECK, proof.headers);

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: proof.nonce,
    }),
  });

  equal(result.status, 'denied', 'Envoy bridge: DPoP htu mismatch is denied');
  equal(result.responseStatus, 403, 'Envoy bridge: DPoP htu mismatch maps to 403');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Envoy bridge: DPoP htu mismatch maps to binding mismatch');
  equal(result.presentation, null, 'Envoy bridge: invalid DPoP proof does not become a presentation');
}

async function testOfflineModeRequiresFreshIntrospection(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueProxyToken({
    tokenId: 'token-envoy-offline',
    decisionId: 'decision-envoy-offline',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const proof = await dpopHeaders({
    issued,
    decision,
    dpopKey,
    nonce: 'nonce-envoy-offline',
    proofJti: 'dpop-proof-envoy-offline',
  });
  const checkRequest = withHeaders(BASE_CHECK, proof.headers);

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({
      verificationKey,
      verifierMode: 'offline',
      nonce: proof.nonce,
    }),
  });

  equal(result.status, 'denied', 'Envoy bridge: offline high-risk proxy check is denied');
  equal(result.responseStatus, 428, 'Envoy bridge: offline high-risk proxy check requires fresh introspection');
  deepEqual(result.failureReasons, ['fresh-introspection-required'], 'Envoy bridge: offline path reports fresh introspection requirement');
  equal(result.checkResponse.status.code, 9, 'Envoy bridge: fresh introspection requirement maps to gRPC failed precondition');
}

async function testRevokedTokenFails(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueProxyToken({
    tokenId: 'token-envoy-revoked',
    decisionId: 'decision-envoy-revoked',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  store.revokeToken({
    tokenId: issued.tokenId,
    revokedAt: '2026-04-18T22:00:05.000Z',
    reason: 'test revocation',
    revokedBy: 'release-authority',
  });
  const proof = await dpopHeaders({
    issued,
    decision,
    dpopKey,
    nonce: 'nonce-envoy-revoked',
    proofJti: 'dpop-proof-envoy-revoked',
  });
  const checkRequest = withHeaders(BASE_CHECK, proof.headers);

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: proof.nonce,
    }),
  });

  equal(result.status, 'denied', 'Envoy bridge: revoked token is denied');
  equal(result.responseStatus, 403, 'Envoy bridge: revoked token maps to 403');
  deepEqual(result.failureReasons, ['revoked-authorization', 'negative-cache-hit'], 'Envoy bridge: revoked token reason is stable');
}

async function testIntrospectionUnavailableFailsClosed(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueProxyToken({
    tokenId: 'token-envoy-unavailable',
    decisionId: 'decision-envoy-unavailable',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const proof = await dpopHeaders({
    issued,
    decision,
    dpopKey,
    nonce: 'nonce-envoy-unavailable',
    proofJti: 'dpop-proof-envoy-unavailable',
  });
  const checkRequest = withHeaders(BASE_CHECK, proof.headers);

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({
      verificationKey,
      nonce: proof.nonce,
    }),
  });

  equal(result.status, 'denied', 'Envoy bridge: missing introspector is denied');
  equal(result.responseStatus, 503, 'Envoy bridge: missing introspector maps to 503');
  deepEqual(result.failureReasons, ['introspection-unavailable'], 'Envoy bridge: missing introspector reason is stable');
  equal(result.checkResponse.status.code, 14, 'Envoy bridge: missing introspector maps to gRPC unavailable');
}

async function testReplayFailsClosed(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueProxyToken({
    tokenId: 'token-envoy-replay',
    decisionId: 'decision-envoy-replay',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const proofJti = 'dpop-proof-envoy-replay';
  const proof = await dpopHeaders({
    issued,
    decision,
    dpopKey,
    nonce: 'nonce-envoy-replay',
    proofJti,
  });
  const checkRequest = withHeaders(BASE_CHECK, proof.headers);

  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest,
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: proof.nonce,
      replayLedgerEntry: {
        subjectKind: 'dpop-proof',
        key: dpopReplayKey(proofJti),
        firstSeenAt: '2026-04-18T22:00:11.000Z',
        expiresAt: '2026-04-18T22:01:20.000Z',
      },
    }),
  });

  equal(result.status, 'denied', 'Envoy bridge: replayed DPoP proof is denied');
  equal(result.responseStatus, 409, 'Envoy bridge: replayed DPoP proof maps to 409');
  deepEqual(result.failureReasons, ['replayed-authorization'], 'Envoy bridge: replay reason is stable');
  equal(result.checkResponse.status.code, 10, 'Envoy bridge: replay maps to gRPC aborted');
}

async function testMalformedCheckFailsClosed(): Promise<void> {
  const { verificationKey } = await issueProxyToken({
    tokenId: 'token-envoy-malformed',
    decisionId: 'decision-envoy-malformed',
  });
  const result = await evaluateEnvoyExternalAuthorization({
    checkRequest: { attributes: { request: {} } },
    options: options({ verificationKey }),
  });

  equal(result.status, 'denied', 'Envoy bridge: malformed check request is denied');
  equal(result.responseStatus, 403, 'Envoy bridge: malformed check request maps to 403');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Envoy bridge: malformed check request maps to binding mismatch');
  equal(result.binding, null, 'Envoy bridge: malformed check request has no binding');
}

async function run(): Promise<void> {
  await testCanonicalBinding();
  await testConfigRendering();
  await testValidDpopProxyCheck();
  await testValidSpiffeProxyCheck();
  await testValidMtlsProxyCheck();
  await testMissingAuthorizationFailsClosed();
  await testBearerDowngradeFailsClosed();
  await testChangedPathFailsBinding();
  await testWrongDpopUriFails();
  await testOfflineModeRequiresFreshIntrospection();
  await testRevokedTokenFails();
  await testIntrospectionUnavailableFailsClosed();
  await testReplayFailsClosed();
  await testMalformedCheckFailsClosed();

  console.log(`Release enforcement-plane Envoy ext_authz tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
