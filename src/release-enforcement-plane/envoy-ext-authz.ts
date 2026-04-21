import { createHash, randomUUID } from 'node:crypto';
import type {
  ReleaseTokenIntrospectionStore,
  ReleaseTokenIntrospector,
} from '../release-kernel/release-introspection.js';
import type { ReleaseTokenVerificationKey } from '../release-kernel/release-token.js';
import {
  canonicalizeReleaseJson,
  createCanonicalReleaseHashBundle,
  type CanonicalReleaseHashBundle,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type { ReleaseTargetReference } from '../release-kernel/object-model.js';
import type { OutputContractDescriptor } from '../release-kernel/types.js';
import {
  createEnforcementDecision,
  createEnforcementReceipt,
  createEnforcementRequest,
  createReleasePresentation,
  type EnforcementDecision,
  type EnforcementReceipt,
  type EnforcementRequest,
  type ReleasePresentation,
  type ReleasePresentationProof,
  type VerificationResult,
} from './object-model.js';
import {
  verifyOfflineReleaseAuthorization,
  type OfflineReleaseVerification,
} from './offline-verifier.js';
import {
  verifyOnlineReleaseAuthorization,
  type OnlineReleaseVerification,
} from './online-verifier.js';
import {
  ATTESTOR_CONSEQUENCE_HASH_HEADER,
  ATTESTOR_OUTPUT_HASH_HEADER,
  ATTESTOR_RELEASE_DECISION_ID_HEADER,
  ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER,
  ATTESTOR_RELEASE_TOKEN_ID_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
  httpReleaseTokenDigest,
} from './http-message-signatures.js';
import {
  ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER,
  ATTESTOR_IDEMPOTENCY_KEY_HEADER,
  ATTESTOR_RELEASE_TOKEN_HEADER,
} from './middleware.js';
import {
  certificateThumbprintFromPem,
  normalizeCertificateThumbprint,
  normalizeSpiffeId,
  trustDomainFromSpiffeId,
} from './workload-binding.js';
import { verifyDpopProof } from './dpop.js';
import type { NonceLedgerEntry, ReplayLedgerEntry } from './freshness.js';
import {
  ENFORCEMENT_FAILURE_REASONS,
  type CreateEnforcementPointReferenceInput,
  type EnforcementFailureReason,
  type ReleaseEnforcementConsequenceType,
  type ReleaseEnforcementRiskClass,
  type ReleasePresentationMode,
} from './types.js';

/**
 * Envoy and Istio external-authorization bridge.
 *
 * This module is intentionally a small bridge rather than a proxy framework:
 * it translates Envoy ext_authz CheckRequest objects into Attestor's shared
 * release-enforcement request and presentation model, then translates the
 * verifier result back into gRPC-style CheckResponse or HTTP-style responses.
 */

export const RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION =
  'attestor.release-enforcement-envoy-ext-authz.v1';
export const ENVOY_EXT_AUTHZ_OUTPUT_ARTIFACT_TYPE =
  'attestor.envoy-ext-authz.check-request';
export const ENVOY_EXT_AUTHZ_OUTPUT_EXPECTED_SHAPE =
  'canonical proxy admission check';
export const ENVOY_EXT_AUTHZ_DEFAULT_VERIFIER_MODE = 'online';
export const ENVOY_EXT_AUTHZ_DEFAULT_CONSEQUENCE_TYPE = 'action';
export const ENVOY_EXT_AUTHZ_DEFAULT_RISK_CLASS = 'R3';
export const ENVOY_EXT_AUTHZ_FILTER_NAME = 'envoy.filters.http.ext_authz';
export const ENVOY_EXT_AUTHZ_TYPE_URL =
  'type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz';
export const ENVOY_EXT_AUTHZ_DYNAMIC_METADATA_NAMESPACE =
  'attestor.release_enforcement';
export const ATTESTOR_PROXY_ENFORCEMENT_STATUS_HEADER =
  'x-attestor-proxy-enforcement-status';
export const ATTESTOR_PROXY_ENFORCEMENT_RECEIPT_DIGEST_HEADER =
  'attestor-enforcement-receipt-digest';
export const ATTESTOR_RELEASE_PRESENTATION_MODE_HEADER =
  'attestor-release-presentation-mode';
export const ATTESTOR_CLIENT_CERTIFICATE_THUMBPRINT_HEADER =
  'attestor-client-certificate-thumbprint';

export type EnvoyExtAuthzBridgeStatus = 'allowed' | 'denied';
export type EnvoyExtAuthzBridgeVerifierMode = 'offline' | 'online';
export type EnvoyExtAuthzTransportMode = 'grpc' | 'http';
export type EnvoyExtAuthzHeaderValue =
  | string
  | readonly string[]
  | Uint8Array
  | Buffer
  | null
  | undefined;

export interface EnvoyExtAuthzAddress {
  readonly socket_address?: {
    readonly address?: string;
    readonly port_value?: number;
  };
  readonly pipe?: {
    readonly path?: string;
  };
}

export interface EnvoyExtAuthzPeer {
  readonly address?: EnvoyExtAuthzAddress;
  readonly service?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly principal?: string;
  readonly certificate?: string;
}

export interface EnvoyExtAuthzHeaderMapEntry {
  readonly key: string;
  readonly value?: string;
  readonly raw_value?: string | Uint8Array | Buffer;
}

export interface EnvoyExtAuthzHeaderMap {
  readonly headers?: readonly EnvoyExtAuthzHeaderMapEntry[];
}

export interface EnvoyExtAuthzHttpRequestAttributes {
  readonly id?: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, EnvoyExtAuthzHeaderValue>>;
  readonly header_map?: EnvoyExtAuthzHeaderMap;
  readonly path?: string;
  readonly host?: string;
  readonly scheme?: string;
  readonly query?: string;
  readonly fragment?: string;
  readonly size?: number | string;
  readonly protocol?: string;
  readonly body?: string;
  readonly raw_body?: string | Uint8Array | Buffer;
}

export interface EnvoyExtAuthzRequestAttributes {
  readonly time?: string;
  readonly http?: EnvoyExtAuthzHttpRequestAttributes;
}

export type EnvoyExtAuthzMetadata =
  Readonly<Record<string, unknown>>;

export interface EnvoyExtAuthzAttributeContext {
  readonly source?: EnvoyExtAuthzPeer;
  readonly destination?: EnvoyExtAuthzPeer;
  readonly request?: EnvoyExtAuthzRequestAttributes;
  readonly context_extensions?: Readonly<Record<string, string>>;
  readonly metadata_context?: EnvoyExtAuthzMetadata;
  readonly route_metadata_context?: EnvoyExtAuthzMetadata;
  readonly tls_session?: {
    readonly sni?: string;
  };
}

export interface EnvoyExtAuthzCheckRequest {
  readonly attributes?: EnvoyExtAuthzAttributeContext;
}

export interface EnvoyExtAuthzProxyRequestCanonical {
  readonly requestId: string | null;
  readonly method: string;
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
  readonly targetUri: string;
  readonly protocol: string | null;
  readonly bodyDigest: string | null;
  readonly selectedHeaders: Readonly<Record<string, string>>;
  readonly source: {
    readonly service: string | null;
    readonly principal: string | null;
    readonly certificateThumbprint: string | null;
    readonly labels: Readonly<Record<string, string>>;
  };
  readonly destination: {
    readonly service: string | null;
    readonly host: string | null;
    readonly sni: string | null;
    readonly labels: Readonly<Record<string, string>>;
  };
  readonly route: {
    readonly contextExtensions: Readonly<Record<string, string>>;
    readonly metadataDigest: string | null;
    readonly routeMetadataDigest: string | null;
  };
}

export interface EnvoyExtAuthzCanonicalBindingOptions {
  readonly targetId?: string | null;
  readonly targetKind?: ReleaseTargetReference['kind'];
  readonly riskClass?: ReleaseEnforcementRiskClass;
  readonly consequenceType?: ReleaseEnforcementConsequenceType;
  readonly includeHeaders?: readonly string[];
}

export interface EnvoyExtAuthzCanonicalBinding {
  readonly version: typeof RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION;
  readonly target: ReleaseTargetReference;
  readonly outputContract: OutputContractDescriptor;
  readonly outputPayload: CanonicalReleaseJsonValue;
  readonly consequencePayload: CanonicalReleaseJsonValue;
  readonly hashBundle: CanonicalReleaseHashBundle;
  readonly proxyRequest: EnvoyExtAuthzProxyRequestCanonical;
  readonly checkCanonical: string;
  readonly checkHash: string;
  readonly headersDigest: string;
  readonly bodyDigest: string | null;
}

export interface EnvoyExtAuthzBridgeOptions {
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly enforcementPointId: string;
  readonly environment: string;
  readonly tenantId?: string | null;
  readonly accountId?: string | null;
  readonly workloadId?: string | null;
  readonly targetId?: string | null;
  readonly riskClass?: ReleaseEnforcementRiskClass;
  readonly consequenceType?: ReleaseEnforcementConsequenceType;
  readonly verifierMode?: EnvoyExtAuthzBridgeVerifierMode;
  readonly introspector?: ReleaseTokenIntrospector;
  readonly usageStore?: ReleaseTokenIntrospectionStore;
  readonly consumeOnSuccess?: boolean;
  readonly forceOnlineIntrospection?: boolean;
  readonly allowBearerFallback?: boolean;
  readonly replayLedgerEntry?: ReplayLedgerEntry | null;
  readonly nonceLedgerEntry?: NonceLedgerEntry | null;
  readonly now?: () => string;
  readonly requestId?: string;
  readonly traceId?: string | null;
  readonly removeCredentialsOnAllow?: boolean;
}

export interface EnvoyExtAuthzBridgeInput {
  readonly checkRequest: EnvoyExtAuthzCheckRequest;
  readonly options: EnvoyExtAuthzBridgeOptions;
}

export interface EnvoyExtAuthzHeaderValueOption {
  readonly header: {
    readonly key: string;
    readonly value: string;
  };
  readonly append?: boolean;
}

export interface EnvoyExtAuthzCheckResponse {
  readonly status: {
    readonly code: number;
    readonly message?: string;
  };
  readonly ok_response?: {
    readonly headers?: readonly EnvoyExtAuthzHeaderValueOption[];
    readonly headers_to_remove?: readonly string[];
    readonly dynamic_metadata?: EnvoyExtAuthzMetadata;
    readonly response_headers_to_add?: readonly EnvoyExtAuthzHeaderValueOption[];
  };
  readonly denied_response?: {
    readonly status: {
      readonly code: number;
    };
    readonly headers?: readonly EnvoyExtAuthzHeaderValueOption[];
    readonly body?: string;
  };
  readonly error_response?: {
    readonly status: {
      readonly code: number;
    };
    readonly headers?: readonly EnvoyExtAuthzHeaderValueOption[];
    readonly body?: string;
  };
  readonly dynamic_metadata?: EnvoyExtAuthzMetadata;
}

export interface EnvoyExtAuthzHttpServiceResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface EnvoyExtAuthzBridgeResult {
  readonly version: typeof RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION;
  readonly status: EnvoyExtAuthzBridgeStatus;
  readonly checkedAt: string;
  readonly binding: EnvoyExtAuthzCanonicalBinding | null;
  readonly request: EnforcementRequest | null;
  readonly presentation: ReleasePresentation | null;
  readonly verificationResult: VerificationResult | null;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
  readonly decision: EnforcementDecision | null;
  readonly receipt: EnforcementReceipt | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly responseStatus: number;
  readonly checkResponse: EnvoyExtAuthzCheckResponse;
  readonly httpResponse: EnvoyExtAuthzHttpServiceResponse;
}

export interface EnvoyExtAuthzFilterConfigOptions {
  readonly clusterName?: string;
  readonly statPrefix?: string;
  readonly timeout?: string;
  readonly maxRequestBytes?: number;
  readonly includePeerCertificate?: boolean;
  readonly includeTlsSession?: boolean;
  readonly statusOnError?: number;
  readonly allowedHeaders?: readonly string[];
}

export interface IstioExtAuthzExtensionProviderOptions {
  readonly name: string;
  readonly service: string;
  readonly port: number | string;
  readonly transport?: EnvoyExtAuthzTransportMode;
  readonly includeRequestHeadersInCheck?: readonly string[];
  readonly headersToUpstreamOnAllow?: readonly string[];
  readonly headersToDownstreamOnDeny?: readonly string[];
}

export interface IstioExtAuthzAuthorizationPolicyOptions {
  readonly name: string;
  readonly namespace?: string;
  readonly providerName: string;
  readonly selectorLabels?: Readonly<Record<string, string>>;
  readonly paths?: readonly string[];
  readonly methods?: readonly string[];
}

const GRPC_STATUS_OK = 0;
const GRPC_STATUS_ABORTED = 10;
const GRPC_STATUS_FAILED_PRECONDITION = 9;
const GRPC_STATUS_PERMISSION_DENIED = 7;
const GRPC_STATUS_UNAUTHENTICATED = 16;
const GRPC_STATUS_UNAVAILABLE = 14;

const DEFAULT_ALLOWED_HEADERS = Object.freeze([
  'authorization',
  'dpop',
  ATTESTOR_RELEASE_TOKEN_HEADER,
  ATTESTOR_RELEASE_PRESENTATION_MODE_HEADER,
  ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER,
  ATTESTOR_RELEASE_TOKEN_ID_HEADER,
  ATTESTOR_RELEASE_DECISION_ID_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
  ATTESTOR_OUTPUT_HASH_HEADER,
  ATTESTOR_CONSEQUENCE_HASH_HEADER,
  ATTESTOR_IDEMPOTENCY_KEY_HEADER,
  ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER,
  ATTESTOR_CLIENT_CERTIFICATE_THUMBPRINT_HEADER,
  'x-request-id',
  'traceparent',
] as const);

const SENSITIVE_BINDING_HEADERS = new Set([
  'authorization',
  'dpop',
  'cookie',
  'set-cookie',
  ATTESTOR_RELEASE_TOKEN_HEADER,
  ATTESTOR_RELEASE_PRESENTATION_MODE_HEADER,
  ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER,
  ATTESTOR_RELEASE_TOKEN_ID_HEADER,
  ATTESTOR_RELEASE_DECISION_ID_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
  ATTESTOR_OUTPUT_HASH_HEADER,
  ATTESTOR_CONSEQUENCE_HASH_HEADER,
]);

function sha256(value: string | Uint8Array | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function uniqueFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const present = new Set(reasons);
  return Object.freeze(ENFORCEMENT_FAILURE_REASONS.filter((reason) => present.has(reason)));
}

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value);
  if (normalized === null) {
    throw new Error(`Envoy ext_authz bridge ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeIsoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Envoy ext_authz bridge now() must return a valid ISO timestamp.');
  }
  return timestamp.toISOString();
}

function bytesForBody(
  body: EnvoyExtAuthzHttpRequestAttributes['body'] | EnvoyExtAuthzHttpRequestAttributes['raw_body'],
): Buffer | null {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  return Buffer.from(body);
}

function headerValueToString(value: EnvoyExtAuthzHeaderValue): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean).join(', ');
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString('utf8').trim();
  }
  return String(value).trim();
}

function headerMapEntryValue(entry: EnvoyExtAuthzHeaderMapEntry): string | null {
  if (entry.value !== undefined) {
    return normalizeIdentifier(entry.value);
  }
  if (entry.raw_value === undefined) {
    return null;
  }
  if (typeof entry.raw_value === 'string') {
    return normalizeIdentifier(entry.raw_value);
  }
  return normalizeIdentifier(Buffer.from(entry.raw_value).toString('utf8'));
}

function normalizeHeaders(
  http: EnvoyExtAuthzHttpRequestAttributes | undefined,
): Readonly<Record<string, string>> {
  const entries = new Map<string, string[]>();
  for (const [key, value] of Object.entries(http?.headers ?? {})) {
    const normalizedKey = key.trim().toLowerCase();
    const normalizedValue = headerValueToString(value);
    if (normalizedKey && normalizedValue) {
      entries.set(normalizedKey, [...(entries.get(normalizedKey) ?? []), normalizedValue]);
    }
  }

  for (const entry of http?.header_map?.headers ?? []) {
    const normalizedKey = normalizeIdentifier(entry.key)?.toLowerCase();
    const normalizedValue = headerMapEntryValue(entry);
    if (normalizedKey && normalizedValue) {
      entries.set(normalizedKey, [...(entries.get(normalizedKey) ?? []), normalizedValue]);
    }
  }

  return Object.freeze(
    Object.fromEntries(
      [...entries.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, values]) => [key, values.join(', ')]),
    ),
  );
}

function headerValue(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  return normalizeIdentifier(headers[name.toLowerCase()]);
}

function selectedBindingHeaders(
  headers: Readonly<Record<string, string>>,
  includeHeaders?: readonly string[],
): Readonly<Record<string, string>> {
  const include = includeHeaders
    ? new Set(includeHeaders.map((header) => header.trim().toLowerCase()).filter(Boolean))
    : null;

  return Object.freeze(
    Object.fromEntries(
      Object.entries(headers)
        .filter(([key]) => (include ? include.has(key) : !SENSITIVE_BINDING_HEADERS.has(key)))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function lowerRecord(record: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(record ?? {})
        .map(([key, value]) => [key.trim().toLowerCase(), value.trim()])
        .filter(([key, value]) => key.length > 0 && value.length > 0)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function canonicalValue(value: unknown): CanonicalReleaseJsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Envoy ext_authz bridge canonical metadata cannot contain non-finite numbers.');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }

  return String(value);
}

function metadataDigest(metadata: EnvoyExtAuthzMetadata | undefined): string | null {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }
  return sha256(canonicalizeReleaseJson(canonicalValue(metadata)));
}

function certificateThumbprintFromPeer(peer: EnvoyExtAuthzPeer | undefined): string | null {
  const certificate = normalizeIdentifier(peer?.certificate);
  if (!certificate) {
    return null;
  }
  try {
    return certificateThumbprintFromPem(certificate);
  } catch {
    return null;
  }
}

function bodyDigestFromHttp(http: EnvoyExtAuthzHttpRequestAttributes | undefined): string | null {
  const body = bytesForBody(http?.raw_body ?? http?.body);
  return body ? sha256(body) : null;
}

function normalizedHttpMethod(http: EnvoyExtAuthzHttpRequestAttributes | undefined): string {
  return normalizeIdentifier(http?.method)?.toUpperCase() ?? 'GET';
}

function normalizedHost(
  http: EnvoyExtAuthzHttpRequestAttributes | undefined,
  headers: Readonly<Record<string, string>>,
  attributes: EnvoyExtAuthzAttributeContext | undefined,
): string {
  return (
    normalizeIdentifier(http?.host) ??
    headerValue(headers, ':authority') ??
    headerValue(headers, 'host') ??
    normalizeIdentifier(attributes?.destination?.service) ??
    'unknown.local'
  );
}

function normalizedScheme(
  http: EnvoyExtAuthzHttpRequestAttributes | undefined,
  headers: Readonly<Record<string, string>>,
): string {
  const raw =
    normalizeIdentifier(http?.scheme) ??
    headerValue(headers, ':scheme') ??
    headerValue(headers, 'x-forwarded-proto') ??
    'https';
  return raw.toLowerCase();
}

function normalizedPath(
  http: EnvoyExtAuthzHttpRequestAttributes | undefined,
  headers: Readonly<Record<string, string>>,
): string {
  const raw = normalizeIdentifier(http?.path) ?? headerValue(headers, ':path') ?? '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function targetUriFromParts(input: {
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
}): string {
  const uri = new URL(`${input.scheme}://${input.host}${input.path}`);
  uri.hash = '';
  return uri.toString();
}

function targetIdFromCheck(input: {
  readonly options: EnvoyExtAuthzCanonicalBindingOptions;
  readonly headers: Readonly<Record<string, string>>;
  readonly attributes: EnvoyExtAuthzAttributeContext | undefined;
  readonly host: string;
  readonly path: string;
}): string {
  return requireIdentifier(
    input.options.targetId ??
      input.attributes?.context_extensions?.['attestor.target_id'] ??
      headerValue(input.headers, ATTESTOR_TARGET_ID_HEADER) ??
      normalizeIdentifier(input.attributes?.destination?.service) ??
      `${input.host}${input.path}`,
    'targetId',
  );
}

function proxyRequestCanonical(
  checkRequest: EnvoyExtAuthzCheckRequest,
  options: EnvoyExtAuthzCanonicalBindingOptions,
): EnvoyExtAuthzProxyRequestCanonical {
  const attributes = checkRequest.attributes;
  const http = attributes?.request?.http;
  if (!http) {
    throw new Error('Envoy ext_authz bridge requires request.http attributes.');
  }

  const headers = normalizeHeaders(http);
  const method = normalizedHttpMethod(http);
  const scheme = normalizedScheme(http, headers);
  const host = normalizedHost(http, headers, attributes);
  const path = normalizedPath(http, headers);
  const targetUri = targetUriFromParts({ scheme, host, path });
  const sourceCertificateThumbprint = certificateThumbprintFromPeer(attributes?.source);

  return Object.freeze({
    requestId: normalizeIdentifier(http.id) ?? headerValue(headers, 'x-request-id'),
    method,
    scheme,
    host,
    path,
    targetUri,
    protocol: normalizeIdentifier(http.protocol),
    bodyDigest: bodyDigestFromHttp(http),
    selectedHeaders: selectedBindingHeaders(headers, options.includeHeaders),
    source: Object.freeze({
      service: normalizeIdentifier(attributes?.source?.service),
      principal: normalizeIdentifier(attributes?.source?.principal),
      certificateThumbprint: sourceCertificateThumbprint,
      labels: lowerRecord(attributes?.source?.labels),
    }),
    destination: Object.freeze({
      service: normalizeIdentifier(attributes?.destination?.service),
      host,
      sni: normalizeIdentifier(attributes?.tls_session?.sni),
      labels: lowerRecord(attributes?.destination?.labels),
    }),
    route: Object.freeze({
      contextExtensions: lowerRecord(attributes?.context_extensions),
      metadataDigest: metadataDigest(attributes?.metadata_context),
      routeMetadataDigest: metadataDigest(attributes?.route_metadata_context),
    }),
  });
}

export function envoyOriginalRequestUri(
  checkRequest: EnvoyExtAuthzCheckRequest,
): string {
  return proxyRequestCanonical(checkRequest, {}).targetUri;
}

export function buildEnvoyExtAuthzCanonicalBinding(
  checkRequest: EnvoyExtAuthzCheckRequest,
  options: EnvoyExtAuthzCanonicalBindingOptions = {},
): EnvoyExtAuthzCanonicalBinding {
  const proxyRequest = proxyRequestCanonical(checkRequest, options);
  const headers = normalizeHeaders(checkRequest.attributes?.request?.http);
  const targetId = targetIdFromCheck({
    options,
    headers,
    attributes: checkRequest.attributes,
    host: proxyRequest.host,
    path: proxyRequest.path,
  });
  const target: ReleaseTargetReference = Object.freeze({
    kind: options.targetKind ?? 'endpoint',
    id: targetId,
    displayName: `Proxy admission ${targetId}`,
  });
  const outputContract: OutputContractDescriptor = Object.freeze({
    artifactType: ENVOY_EXT_AUTHZ_OUTPUT_ARTIFACT_TYPE,
    expectedShape: ENVOY_EXT_AUTHZ_OUTPUT_EXPECTED_SHAPE,
    consequenceType: options.consequenceType ?? ENVOY_EXT_AUTHZ_DEFAULT_CONSEQUENCE_TYPE,
    riskClass: options.riskClass ?? ENVOY_EXT_AUTHZ_DEFAULT_RISK_CLASS,
  });
  const outputPayload: CanonicalReleaseJsonValue = Object.freeze({
    version: RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION,
    proxyRequest: canonicalValue(proxyRequest),
  });
  const consequencePayload: CanonicalReleaseJsonValue = Object.freeze({
    consequenceType: outputContract.consequenceType,
    riskClass: outputContract.riskClass,
    boundary: 'proxy-admission',
    targetId: target.id,
    method: proxyRequest.method,
    targetUri: proxyRequest.targetUri,
    bodyDigest: proxyRequest.bodyDigest,
    sourcePrincipal: proxyRequest.source.principal,
    destinationService: proxyRequest.destination.service,
  });
  const hashBundle = createCanonicalReleaseHashBundle({
    outputContract,
    target,
    outputPayload,
    consequencePayload,
    idempotencyKey: proxyRequest.requestId ?? undefined,
  });
  const checkCanonical = canonicalizeReleaseJson({
    outputHash: hashBundle.outputHash,
    consequenceHash: hashBundle.consequenceHash,
    proxyRequest: canonicalValue(proxyRequest),
  });

  return Object.freeze({
    version: RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION,
    target,
    outputContract,
    outputPayload,
    consequencePayload,
    hashBundle,
    proxyRequest,
    checkCanonical,
    checkHash: sha256(checkCanonical),
    headersDigest: sha256(canonicalizeReleaseJson(proxyRequest.selectedHeaders)),
    bodyDigest: proxyRequest.bodyDigest,
  });
}

function createProxyEnforcementPoint(input: {
  readonly options: EnvoyExtAuthzBridgeOptions;
  readonly binding: EnvoyExtAuthzCanonicalBinding;
  readonly sourcePrincipal: string | null;
}): CreateEnforcementPointReferenceInput {
  return {
    environment: input.options.environment,
    enforcementPointId: input.options.enforcementPointId,
    pointKind: 'proxy-ext-authz',
    boundaryKind: 'proxy-admission',
    consequenceType: input.binding.outputContract.consequenceType,
    riskClass: input.binding.outputContract.riskClass,
    tenantId: input.options.tenantId,
    accountId: input.options.accountId,
    workloadId: input.options.workloadId ?? input.sourcePrincipal,
    audience: input.binding.target.id,
  };
}

function createProxyEnforcementRequest(input: {
  readonly checkedAt: string;
  readonly binding: EnvoyExtAuthzCanonicalBinding;
  readonly authorization: ExtractedProxyAuthorization;
  readonly options: EnvoyExtAuthzBridgeOptions;
  readonly headers: Readonly<Record<string, string>>;
}): EnforcementRequest {
  const requestId =
    input.options.requestId ??
    headerValue(input.headers, ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER) ??
    input.binding.proxyRequest.requestId ??
    `erq_envoy_ext_authz_${randomUUID()}`;
  return createEnforcementRequest({
    id: requestId,
    receivedAt: input.checkedAt,
    enforcementPoint: createProxyEnforcementPoint({
      options: input.options,
      binding: input.binding,
      sourcePrincipal: input.binding.proxyRequest.source.principal,
    }),
    targetId: input.binding.target.id,
    outputHash: input.binding.hashBundle.outputHash,
    consequenceHash: input.binding.hashBundle.consequenceHash,
    releaseTokenId: input.authorization.releaseTokenId,
    releaseDecisionId: input.authorization.releaseDecisionId,
    traceId:
      normalizeIdentifier(input.options.traceId) ??
      headerValue(input.headers, 'traceparent') ??
      input.binding.proxyRequest.requestId,
    idempotencyKey:
      headerValue(input.headers, ATTESTOR_IDEMPOTENCY_KEY_HEADER) ??
      headerValue(input.headers, 'idempotency-key') ??
      input.binding.proxyRequest.requestId,
    transport: {
      kind: 'http',
      method: input.binding.proxyRequest.method,
      uri: input.binding.proxyRequest.targetUri,
      headersDigest: input.binding.headersDigest,
      bodyDigest: input.binding.bodyDigest,
    },
  });
}

interface ExtractedProxyAuthorization {
  readonly releaseToken: string;
  readonly releaseTokenId: string | null;
  readonly releaseDecisionId: string | null;
  readonly requestedMode: ReleasePresentationMode | null;
}

function extractAuthorization(
  headers: Readonly<Record<string, string>>,
): ExtractedProxyAuthorization | null {
  const authorization = headerValue(headers, 'authorization');
  let releaseToken: string | null = null;
  if (authorization) {
    const match = /^(Bearer|DPoP)\s+(.+)$/iu.exec(authorization);
    if (match?.[2]) {
      releaseToken = normalizeIdentifier(match[2]);
    }
  }

  releaseToken = releaseToken ?? headerValue(headers, ATTESTOR_RELEASE_TOKEN_HEADER);
  if (!releaseToken) {
    return null;
  }

  const requestedMode = headerValue(headers, ATTESTOR_RELEASE_PRESENTATION_MODE_HEADER);
  return Object.freeze({
    releaseToken,
    releaseTokenId: headerValue(headers, ATTESTOR_RELEASE_TOKEN_ID_HEADER),
    releaseDecisionId: headerValue(headers, ATTESTOR_RELEASE_DECISION_ID_HEADER),
    requestedMode:
      requestedMode === 'bearer-release-token' ||
      requestedMode === 'dpop-bound-token' ||
      requestedMode === 'mtls-bound-token' ||
      requestedMode === 'spiffe-bound-token'
        ? requestedMode
        : null,
  });
}

function clientCertificateThumbprint(
  headers: Readonly<Record<string, string>>,
  binding: EnvoyExtAuthzCanonicalBinding,
): string | null {
  const fromHeader = headerValue(headers, ATTESTOR_CLIENT_CERTIFICATE_THUMBPRINT_HEADER);
  if (fromHeader) {
    try {
      return normalizeCertificateThumbprint(fromHeader);
    } catch {
      return null;
    }
  }
  return binding.proxyRequest.source.certificateThumbprint;
}

function spiffePrincipal(binding: EnvoyExtAuthzCanonicalBinding): string | null {
  const principal = binding.proxyRequest.source.principal;
  if (!principal?.startsWith('spiffe://')) {
    return null;
  }
  try {
    return normalizeSpiffeId(principal);
  } catch {
    return null;
  }
}

function proxyPresentationProof(input: {
  readonly mode: ReleasePresentationMode;
  readonly binding: EnvoyExtAuthzCanonicalBinding;
  readonly headers: Readonly<Record<string, string>>;
  readonly checkedAt: string;
  readonly authorization: ExtractedProxyAuthorization;
}): Promise<ReleasePresentationProof | null> | ReleasePresentationProof | null {
  if (input.mode === 'dpop-bound-token') {
    const proofJwt = headerValue(input.headers, 'dpop');
    if (!proofJwt) {
      return null;
    }
    return verifyDpopProof({
      proofJwt,
      httpMethod: input.binding.proxyRequest.method,
      httpUri: input.binding.proxyRequest.targetUri,
      accessToken: input.authorization.releaseToken,
      now: input.checkedAt,
    }).then((verified) => {
      if (
        verified.status !== 'valid' ||
        verified.proofJti === null ||
        verified.httpMethod === null ||
        verified.httpUri === null ||
        verified.publicKeyThumbprint === null
      ) {
        return null;
      }
      return Object.freeze({
        kind: 'dpop' as const,
        proofJwt,
        httpMethod: verified.httpMethod,
        httpUri: verified.httpUri,
        proofJti: verified.proofJti,
        accessTokenHash: verified.accessTokenHash,
        nonce: verified.nonce,
        keyThumbprint: verified.publicKeyThumbprint,
      });
    });
  }

  if (input.mode === 'spiffe-bound-token') {
    const spiffeId = spiffePrincipal(input.binding);
    if (!spiffeId) {
      return null;
    }
    return Object.freeze({
      kind: 'spiffe' as const,
      spiffeId,
      trustDomain: trustDomainFromSpiffeId(spiffeId),
      svidThumbprint: clientCertificateThumbprint(input.headers, input.binding),
    });
  }

  if (input.mode === 'mtls-bound-token') {
    const certificateThumbprint = clientCertificateThumbprint(input.headers, input.binding);
    if (!certificateThumbprint) {
      return null;
    }
    const spiffeId = spiffePrincipal(input.binding);
    return Object.freeze({
      kind: 'mtls' as const,
      certificateThumbprint,
      subjectDn: spiffeId ? null : input.binding.proxyRequest.source.principal,
      spiffeId,
    });
  }

  return null;
}

async function createProxyPresentation(input: {
  readonly binding: EnvoyExtAuthzCanonicalBinding;
  readonly headers: Readonly<Record<string, string>>;
  readonly checkedAt: string;
  readonly authorization: ExtractedProxyAuthorization;
  readonly allowBearerFallback: boolean;
}): Promise<ReleasePresentation | readonly EnforcementFailureReason[]> {
  const hasDpopProof = headerValue(input.headers, 'dpop') !== null;
  const spiffeId = spiffePrincipal(input.binding);
  const certificateThumbprint = clientCertificateThumbprint(input.headers, input.binding);
  const requestedMode = input.authorization.requestedMode;
  const mode: ReleasePresentationMode | null =
    requestedMode ??
    (hasDpopProof
      ? 'dpop-bound-token'
      : spiffeId
        ? 'spiffe-bound-token'
        : certificateThumbprint
          ? 'mtls-bound-token'
          : input.allowBearerFallback
            ? 'bearer-release-token'
            : null);

  if (mode === null) {
    return ['binding-mismatch'];
  }
  if (mode === 'bearer-release-token') {
    if (!input.allowBearerFallback) {
      return ['binding-mismatch'];
    }
    return createReleasePresentation({
      mode,
      presentedAt: input.checkedAt,
      releaseToken: input.authorization.releaseToken,
      releaseTokenId: input.authorization.releaseTokenId,
      releaseTokenDigest: httpReleaseTokenDigest(input.authorization.releaseToken),
    });
  }

  const proof = await proxyPresentationProof({
    mode,
    binding: input.binding,
    headers: input.headers,
    checkedAt: input.checkedAt,
    authorization: input.authorization,
  });
  if (proof === null) {
    return ['binding-mismatch'];
  }

  return createReleasePresentation({
    mode,
    presentedAt: input.checkedAt,
    releaseToken: input.authorization.releaseToken,
    releaseTokenId: input.authorization.releaseTokenId,
    releaseTokenDigest: httpReleaseTokenDigest(input.authorization.releaseToken),
    proof,
  });
}

function responseStatusForFailures(failureReasons: readonly EnforcementFailureReason[]): number {
  if (failureReasons.includes('missing-release-authorization')) {
    return 401;
  }
  if (failureReasons.includes('introspection-unavailable')) {
    return 503;
  }
  if (failureReasons.includes('replayed-authorization')) {
    return 409;
  }
  if (
    failureReasons.includes('fresh-introspection-required') &&
    failureReasons.every((reason) => reason === 'fresh-introspection-required')
  ) {
    return 428;
  }
  return 403;
}

function grpcStatusForFailures(failureReasons: readonly EnforcementFailureReason[]): number {
  if (failureReasons.includes('missing-release-authorization')) {
    return GRPC_STATUS_UNAUTHENTICATED;
  }
  if (failureReasons.includes('introspection-unavailable')) {
    return GRPC_STATUS_UNAVAILABLE;
  }
  if (failureReasons.includes('replayed-authorization')) {
    return GRPC_STATUS_ABORTED;
  }
  if (failureReasons.includes('fresh-introspection-required')) {
    return GRPC_STATUS_FAILED_PRECONDITION;
  }
  return GRPC_STATUS_PERMISSION_DENIED;
}

function bridgeFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const unique = uniqueFailureReasons(reasons);
  const hasHardFailure = unique.some(
    (reason) => reason !== 'fresh-introspection-required' && reason !== 'introspection-unavailable',
  );
  return hasHardFailure
    ? uniqueFailureReasons(unique.filter((reason) => reason !== 'fresh-introspection-required'))
    : unique;
}

function header(key: string, value: string): EnvoyExtAuthzHeaderValueOption {
  return Object.freeze({
    header: Object.freeze({ key, value }),
  });
}

function dynamicMetadata(result: {
  readonly status: EnvoyExtAuthzBridgeStatus;
  readonly checkedAt: string;
  readonly request: EnforcementRequest | null;
  readonly receipt: EnforcementReceipt | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly binding: EnvoyExtAuthzCanonicalBinding | null;
}): EnvoyExtAuthzMetadata {
  return Object.freeze({
    [ENVOY_EXT_AUTHZ_DYNAMIC_METADATA_NAMESPACE]: Object.freeze({
      version: RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION,
      status: result.status,
      checked_at: result.checkedAt,
      request_id: result.request?.id ?? null,
      target_id: result.binding?.target.id ?? null,
      output_hash: result.binding?.hashBundle.outputHash ?? null,
      consequence_hash: result.binding?.hashBundle.consequenceHash ?? null,
      receipt_digest: result.receipt?.receiptDigest ?? null,
      failure_reasons: result.failureReasons,
    }),
  });
}

function deniedBody(input: {
  readonly checkedAt: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly responseStatus: number;
  readonly request: EnforcementRequest | null;
  readonly verificationResult: VerificationResult | null;
}): string {
  return JSON.stringify({
    version: RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION,
    status: 'denied',
    checkedAt: input.checkedAt,
    failureReasons: input.failureReasons,
    responseStatus: input.responseStatus,
    requestId: input.request?.id ?? null,
    verificationStatus: input.verificationResult?.status ?? null,
  });
}

function deniedHeaders(
  failureReasons: readonly EnforcementFailureReason[],
): readonly EnvoyExtAuthzHeaderValueOption[] {
  const headers = [
    header('cache-control', 'no-store'),
    header('content-type', 'application/json; charset=utf-8'),
    header(ATTESTOR_PROXY_ENFORCEMENT_STATUS_HEADER, 'denied'),
  ];
  if (failureReasons.includes('missing-release-authorization')) {
    headers.push(
      header(
        'www-authenticate',
        'Bearer realm="attestor-release", error="invalid_token", error_description="Attestor release authorization is required"',
      ),
    );
  }
  return Object.freeze(headers);
}

function checkResponseForResult(input: {
  readonly status: EnvoyExtAuthzBridgeStatus;
  readonly checkedAt: string;
  readonly request: EnforcementRequest | null;
  readonly receipt: EnforcementReceipt | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly responseStatus: number;
  readonly verificationResult: VerificationResult | null;
  readonly binding: EnvoyExtAuthzCanonicalBinding | null;
  readonly removeCredentialsOnAllow: boolean;
}): EnvoyExtAuthzCheckResponse {
  const metadata = dynamicMetadata(input);
  if (input.status === 'allowed') {
    return Object.freeze({
      status: Object.freeze({ code: GRPC_STATUS_OK, message: 'allowed' }),
      ok_response: Object.freeze({
        headers: Object.freeze([
          header(ATTESTOR_PROXY_ENFORCEMENT_STATUS_HEADER, 'allowed'),
          ...(input.request ? [header(ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER, input.request.id)] : []),
          ...(input.receipt?.receiptDigest
            ? [header(ATTESTOR_PROXY_ENFORCEMENT_RECEIPT_DIGEST_HEADER, input.receipt.receiptDigest)]
            : []),
        ]),
        headers_to_remove: input.removeCredentialsOnAllow
          ? Object.freeze(['authorization', 'dpop', ATTESTOR_RELEASE_TOKEN_HEADER])
          : Object.freeze([]),
        dynamic_metadata: metadata,
      }),
      dynamic_metadata: metadata,
    });
  }

  return Object.freeze({
    status: Object.freeze({
      code: grpcStatusForFailures(input.failureReasons),
      message: input.failureReasons.join(', '),
    }),
    denied_response: Object.freeze({
      status: Object.freeze({ code: input.responseStatus }),
      headers: deniedHeaders(input.failureReasons),
      body: deniedBody(input),
    }),
    dynamic_metadata: metadata,
  });
}

function httpResponseForCheckResponse(
  checkResponse: EnvoyExtAuthzCheckResponse,
): EnvoyExtAuthzHttpServiceResponse {
  if (checkResponse.status.code === GRPC_STATUS_OK) {
    return Object.freeze({
      status: 200,
      headers: Object.freeze(
        Object.fromEntries(
          (checkResponse.ok_response?.headers ?? []).map((entry) => [
            entry.header.key,
            entry.header.value,
          ]),
        ),
      ),
      body: '',
    });
  }

  return Object.freeze({
    status: checkResponse.denied_response?.status.code ?? 403,
    headers: Object.freeze(
      Object.fromEntries(
        (checkResponse.denied_response?.headers ?? []).map((entry) => [
          entry.header.key,
          entry.header.value,
        ]),
      ),
    ),
    body: checkResponse.denied_response?.body ?? '',
  });
}

function decisionAndReceipt(input: {
  readonly request: EnforcementRequest;
  readonly verification: VerificationResult;
  readonly checkedAt: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
}): {
  readonly decision: EnforcementDecision;
  readonly receipt: EnforcementReceipt;
} {
  const decision = createEnforcementDecision({
    id: `ed_envoy_ext_authz_${input.request.id}`,
    request: input.request,
    decidedAt: input.checkedAt,
    verification: input.verification,
    failureReasons: input.failureReasons,
  });
  const receiptDigest = sha256(JSON.stringify({
    decisionId: decision.id,
    requestId: decision.requestId,
    outcome: decision.outcome,
    releaseTokenId: decision.releaseTokenId,
    releaseDecisionId: decision.releaseDecisionId,
    verificationStatus: decision.verification.status,
    failureReasons: decision.failureReasons,
  }));
  const receipt = createEnforcementReceipt({
    id: `er_envoy_ext_authz_${input.request.id}`,
    issuedAt: input.checkedAt,
    decision,
    receiptDigest,
  });

  return { decision, receipt };
}

function bridgeResult(input: {
  readonly status: EnvoyExtAuthzBridgeStatus;
  readonly checkedAt: string;
  readonly binding: EnvoyExtAuthzCanonicalBinding | null;
  readonly request: EnforcementRequest | null;
  readonly presentation: ReleasePresentation | null;
  readonly verificationResult: VerificationResult | null;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
  readonly decision: EnforcementDecision | null;
  readonly receipt: EnforcementReceipt | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly removeCredentialsOnAllow: boolean;
}): EnvoyExtAuthzBridgeResult {
  const failureReasons = uniqueFailureReasons(input.failureReasons);
  const responseStatus = input.status === 'allowed' ? 200 : responseStatusForFailures(failureReasons);
  const checkResponse = checkResponseForResult({
    ...input,
    failureReasons,
    responseStatus,
  });
  return Object.freeze({
    version: RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION,
    status: input.status,
    checkedAt: input.checkedAt,
    binding: input.binding,
    request: input.request,
    presentation: input.presentation,
    verificationResult: input.verificationResult,
    offline: input.offline,
    online: input.online,
    decision: input.decision,
    receipt: input.receipt,
    failureReasons,
    responseStatus,
    checkResponse,
    httpResponse: httpResponseForCheckResponse(checkResponse),
  });
}

function resultFromVerification(input: {
  readonly checkedAt: string;
  readonly binding: EnvoyExtAuthzCanonicalBinding;
  readonly request: EnforcementRequest;
  readonly presentation: ReleasePresentation;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
  readonly removeCredentialsOnAllow: boolean;
}): EnvoyExtAuthzBridgeResult {
  const verificationResult =
    input.online?.verificationResult ?? input.offline?.verificationResult ?? null;
  if (verificationResult === null) {
    return bridgeResult({
      ...input,
      status: 'denied',
      verificationResult: null,
      decision: null,
      receipt: null,
      failureReasons: ['invalid-signature'],
    });
  }

  const failureReasons = bridgeFailureReasons(
    input.online?.failureReasons ?? input.offline?.failureReasons ?? [],
  );
  const { decision, receipt } = decisionAndReceipt({
    request: input.request,
    verification: verificationResult,
    checkedAt: input.checkedAt,
    failureReasons,
  });
  const allowed = failureReasons.length === 0 && verificationResult.status === 'valid';

  return bridgeResult({
    ...input,
    status: allowed ? 'allowed' : 'denied',
    verificationResult,
    decision,
    receipt,
    failureReasons,
  });
}

export async function evaluateEnvoyExternalAuthorization(
  input: EnvoyExtAuthzBridgeInput,
): Promise<EnvoyExtAuthzBridgeResult> {
  const checkedAt = normalizeIsoTimestamp(input.options.now?.() ?? new Date().toISOString());
  const removeCredentialsOnAllow = input.options.removeCredentialsOnAllow ?? true;
  let binding: EnvoyExtAuthzCanonicalBinding;
  let headers: Readonly<Record<string, string>>;

  try {
    binding = buildEnvoyExtAuthzCanonicalBinding(input.checkRequest, {
      targetId: input.options.targetId,
      riskClass: input.options.riskClass,
      consequenceType: input.options.consequenceType,
    });
    headers = normalizeHeaders(input.checkRequest.attributes?.request?.http);
  } catch {
    return bridgeResult({
      status: 'denied',
      checkedAt,
      binding: null,
      request: null,
      presentation: null,
      verificationResult: null,
      offline: null,
      online: null,
      decision: null,
      receipt: null,
      failureReasons: ['binding-mismatch'],
      removeCredentialsOnAllow,
    });
  }

  const authorization = extractAuthorization(headers);
  if (authorization === null) {
    return bridgeResult({
      status: 'denied',
      checkedAt,
      binding,
      request: null,
      presentation: null,
      verificationResult: null,
      offline: null,
      online: null,
      decision: null,
      receipt: null,
      failureReasons: ['missing-release-authorization'],
      removeCredentialsOnAllow,
    });
  }

  const request = createProxyEnforcementRequest({
    checkedAt,
    binding,
    authorization,
    options: input.options,
    headers,
  });
  const presentationOrFailures = await createProxyPresentation({
    binding,
    headers,
    checkedAt,
    authorization,
    allowBearerFallback: input.options.allowBearerFallback ?? false,
  });
  if (Array.isArray(presentationOrFailures)) {
    const failureReasons = presentationOrFailures as readonly EnforcementFailureReason[];
    return bridgeResult({
      status: 'denied',
      checkedAt,
      binding,
      request,
      presentation: null,
      verificationResult: null,
      offline: null,
      online: null,
      decision: null,
      receipt: null,
      failureReasons,
      removeCredentialsOnAllow,
    });
  }
  const presentation = presentationOrFailures as ReleasePresentation;

  if (input.options.verifierMode === 'offline') {
    const offline = await verifyOfflineReleaseAuthorization({
      request,
      presentation,
      verificationKey: input.options.verificationKey,
      now: checkedAt,
      replayLedgerEntry: input.options.replayLedgerEntry,
      nonceLedgerEntry: input.options.nonceLedgerEntry,
    });
    return resultFromVerification({
      checkedAt,
      binding,
      request,
      presentation,
      offline,
      online: null,
      removeCredentialsOnAllow,
    });
  }

  const online = await verifyOnlineReleaseAuthorization({
    request,
    presentation,
    verificationKey: input.options.verificationKey,
    now: checkedAt,
    introspector: input.options.introspector,
    usageStore: input.options.usageStore,
    consumeOnSuccess: input.options.consumeOnSuccess ?? true,
    forceOnlineIntrospection: input.options.forceOnlineIntrospection ?? true,
    replayLedgerEntry: input.options.replayLedgerEntry,
    nonceLedgerEntry: input.options.nonceLedgerEntry,
    resourceServerId: input.options.enforcementPointId,
  });

  return resultFromVerification({
    checkedAt,
    binding,
    request,
    presentation,
    offline: online.offline,
    online,
    removeCredentialsOnAllow,
  });
}

function matcherPatterns(headers: readonly string[]) {
  return Object.freeze(
    headers.map((name) =>
      Object.freeze({
        exact: name,
      }),
    ),
  );
}

export function renderEnvoyExtAuthzHttpFilterConfig(
  options: EnvoyExtAuthzFilterConfigOptions = {},
) {
  return Object.freeze({
    name: ENVOY_EXT_AUTHZ_FILTER_NAME,
    typed_config: Object.freeze({
      '@type': ENVOY_EXT_AUTHZ_TYPE_URL,
      stat_prefix: options.statPrefix ?? 'attestor_release_ext_authz',
      transport_api_version: 'V3',
      grpc_service: Object.freeze({
        envoy_grpc: Object.freeze({
          cluster_name: options.clusterName ?? 'attestor-release-ext-authz',
        }),
        timeout: options.timeout ?? '0.5s',
      }),
      failure_mode_allow: false,
      status_on_error: Object.freeze({
        code: options.statusOnError ?? 503,
      }),
      validate_mutations: true,
      include_peer_certificate: options.includePeerCertificate ?? true,
      include_tls_session: options.includeTlsSession ?? true,
      encode_raw_headers: true,
      with_request_body: Object.freeze({
        max_request_bytes: options.maxRequestBytes ?? 16384,
        allow_partial_message: false,
        pack_as_bytes: true,
      }),
      allowed_headers: Object.freeze({
        patterns: matcherPatterns(options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS),
      }),
    }),
  });
}

export function renderIstioExtAuthzExtensionProvider(
  options: IstioExtAuthzExtensionProviderOptions,
) {
  const common = Object.freeze({
    service: options.service,
    port: String(options.port),
    includeRequestHeadersInCheck: Object.freeze(
      options.includeRequestHeadersInCheck ?? DEFAULT_ALLOWED_HEADERS,
    ),
    headersToUpstreamOnAllow: Object.freeze(
      options.headersToUpstreamOnAllow ?? [
        ATTESTOR_PROXY_ENFORCEMENT_STATUS_HEADER,
        ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER,
        ATTESTOR_PROXY_ENFORCEMENT_RECEIPT_DIGEST_HEADER,
      ],
    ),
    headersToDownstreamOnDeny: Object.freeze(
      options.headersToDownstreamOnDeny ?? [
        'content-type',
        'www-authenticate',
        ATTESTOR_PROXY_ENFORCEMENT_STATUS_HEADER,
      ],
    ),
  });

  return Object.freeze({
    name: options.name,
    ...(options.transport === 'http'
      ? { envoyExtAuthzHttp: common }
      : { envoyExtAuthzGrpc: common }),
  });
}

export function renderIstioExtAuthzAuthorizationPolicy(
  options: IstioExtAuthzAuthorizationPolicyOptions,
) {
  return Object.freeze({
    apiVersion: 'security.istio.io/v1',
    kind: 'AuthorizationPolicy',
    metadata: Object.freeze({
      name: options.name,
      ...(options.namespace ? { namespace: options.namespace } : {}),
    }),
    spec: Object.freeze({
      ...(options.selectorLabels
        ? {
            selector: Object.freeze({
              matchLabels: Object.freeze({ ...options.selectorLabels }),
            }),
          }
        : {}),
      action: 'CUSTOM',
      provider: Object.freeze({
        name: options.providerName,
      }),
      rules: Object.freeze([
        Object.freeze({
          to: Object.freeze([
            Object.freeze({
              operation: Object.freeze({
                ...(options.paths ? { paths: Object.freeze([...options.paths]) } : {}),
                ...(options.methods ? { methods: Object.freeze([...options.methods]) } : {}),
              }),
            }),
          ]),
        }),
      ]),
    }),
  });
}
