import { createHash, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { Context, Handler } from 'hono';
import type { JWK } from 'jose';
import type {
  ReleaseTokenIntrospectionStore,
  ReleaseTokenIntrospector,
} from '../release-kernel/release-introspection.js';
import type { ReleaseTokenVerificationKey } from '../release-kernel/release-token.js';
import {
  createEnforcementDecision,
  createEnforcementReceipt,
  createEnforcementRequest,
  createReleasePresentation,
  type CreateEnforcementRequestInput,
  type EnforcementBreakGlassGrant,
  type EnforcementDecision,
  type EnforcementReceipt,
  type EnforcementRequest,
  type ReleasePresentation,
  type VerificationResult,
} from './object-model.js';
import {
  verifyOfflineReleaseAuthorization,
  type OfflineReleaseVerification,
  type OfflineReleaseVerificationInput,
} from './offline-verifier.js';
import {
  verifyOnlineReleaseAuthorization,
  type OnlineReleaseVerification,
  type OnlineReleaseVerificationInput,
} from './online-verifier.js';
import {
  ATTESTOR_CONSEQUENCE_HASH_HEADER,
  ATTESTOR_OUTPUT_HASH_HEADER,
  ATTESTOR_RELEASE_DECISION_ID_HEADER,
  ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER,
  ATTESTOR_RELEASE_TOKEN_ID_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
  DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS,
  HTTP_MESSAGE_SIGNATURE_LABEL,
  HTTP_MESSAGE_SIGNATURE_TAG,
  contentDigestForBody,
  httpReleaseTokenDigest,
  normalizeHttpMessageHeaders,
  normalizeHttpSignatureTargetUri,
  verifyHttpMessageSignature,
  type HttpMessageForSignature,
  type HttpMessageHeaderValue,
  type HttpMessageSignatureVerification,
} from './http-message-signatures.js';
import {
  ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER,
  ATTESTOR_IDEMPOTENCY_KEY_HEADER,
  ATTESTOR_RELEASE_TOKEN_HEADER,
} from './middleware.js';
import {
  ENFORCEMENT_FAILURE_REASONS,
  type CreateEnforcementPointReferenceInput,
  type EnforcementFailureReason,
} from './types.js';
import type { NonceLedgerEntry, ReplayLedgerEntry } from './freshness.js';

/**
 * Reference webhook receiver policy-enforcement point.
 *
 * Webhook boundaries are a harsher shape than ordinary middleware: the body
 * must stay byte-for-byte intact until signature verification, high-risk paths
 * need live token state, and retrying senders should see deterministic
 * fail-closed responses. This module gives receivers one small admission gate
 * before they hand a webhook body to business logic.
 */

export const RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION =
  'attestor.release-enforcement-webhook-receiver.v1';
export const HONO_RELEASE_WEBHOOK_RECEIVER_CONTEXT_KEY = 'releaseWebhookReceiver';
export const HONO_RELEASE_WEBHOOK_BODY_CONTEXT_KEY = 'releaseWebhookBody';
export const ATTESTOR_WEBHOOK_EVENT_ID_HEADER = 'attestor-webhook-event-id';
export const ATTESTOR_WEBHOOK_RECEIVER_STATUS_HEADER = 'x-attestor-webhook-receiver-status';
export const DEFAULT_WEBHOOK_RECEIVER_METHODS = Object.freeze(['POST'] as const);
export const DEFAULT_WEBHOOK_BREAK_GLASS_FAILURE_REASONS = Object.freeze([
  'introspection-unavailable',
  'fresh-introspection-required',
] as const satisfies readonly EnforcementFailureReason[]);

export type ReleaseWebhookReceiverStatus =
  | 'accepted'
  | 'rejected'
  | 'break-glass-accepted';
export type ReleaseWebhookReceiverVerifierMode = 'offline' | 'online';

export interface ReleaseWebhookReceiverHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers:
    | Headers
    | IncomingHttpHeaders
    | Readonly<Record<string, HttpMessageHeaderValue>>;
  readonly body?: string | Uint8Array | Buffer | null;
}

export interface ReleaseWebhookReceiverContext {
  readonly request: ReleaseWebhookReceiverHttpRequest;
  readonly checkedAt: string;
  readonly framework: 'hono' | 'node' | 'custom';
  readonly frameworkContext?: unknown;
}

export type ReleaseWebhookReceiverResolver<T> =
  | T
  | ((context: ReleaseWebhookReceiverContext) => T | Promise<T>);

export interface ReleaseWebhookReceiverResult {
  readonly version: typeof RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION;
  readonly status: ReleaseWebhookReceiverStatus;
  readonly checkedAt: string;
  readonly request: EnforcementRequest | null;
  readonly presentation: ReleasePresentation | null;
  readonly signature: HttpMessageSignatureVerification | null;
  readonly verificationResult: VerificationResult | null;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
  readonly decision: EnforcementDecision | null;
  readonly receipt: EnforcementReceipt | null;
  readonly breakGlass: EnforcementBreakGlassGrant | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly responseStatus: number;
  readonly retryable: boolean;
}

export interface ReleaseWebhookReceiverDeniedBody {
  readonly version: typeof RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION;
  readonly status: 'rejected';
  readonly checkedAt: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly verificationStatus: VerificationResult['status'] | null;
  readonly requestId: string | null;
  readonly retryable: boolean;
}

export interface ReleaseWebhookReceiverOptions {
  readonly verificationKey: ReleaseWebhookReceiverResolver<ReleaseTokenVerificationKey>;
  readonly signaturePublicJwk: ReleaseWebhookReceiverResolver<JWK>;
  readonly enforcementPoint: ReleaseWebhookReceiverResolver<CreateEnforcementPointReferenceInput>;
  readonly verifierMode?: ReleaseWebhookReceiverVerifierMode;
  readonly introspector?: ReleaseWebhookReceiverResolver<ReleaseTokenIntrospector | undefined>;
  readonly usageStore?: ReleaseWebhookReceiverResolver<ReleaseTokenIntrospectionStore | undefined>;
  readonly consumeOnSuccess?: boolean;
  readonly forceOnlineIntrospection?: boolean;
  readonly acceptedMethods?: readonly string[];
  readonly now?: () => string;
  readonly requestId?: ReleaseWebhookReceiverResolver<string>;
  readonly targetId?: ReleaseWebhookReceiverResolver<string | null | undefined>;
  readonly outputHash?: ReleaseWebhookReceiverResolver<string | null | undefined>;
  readonly consequenceHash?: ReleaseWebhookReceiverResolver<string | null | undefined>;
  readonly releaseTokenId?: ReleaseWebhookReceiverResolver<string | null | undefined>;
  readonly releaseDecisionId?: ReleaseWebhookReceiverResolver<string | null | undefined>;
  readonly idempotencyKey?: ReleaseWebhookReceiverResolver<string | null | undefined>;
  readonly traceId?: ReleaseWebhookReceiverResolver<string | null | undefined>;
  readonly expectedNonce?: ReleaseWebhookReceiverResolver<string | null | undefined>;
  readonly replayLedgerEntry?: ReleaseWebhookReceiverResolver<ReplayLedgerEntry | null | undefined>;
  readonly nonceLedgerEntry?: ReleaseWebhookReceiverResolver<NonceLedgerEntry | null | undefined>;
  readonly breakGlassGrant?: ReleaseWebhookReceiverResolver<EnforcementBreakGlassGrant | null | undefined>;
  readonly breakGlassAllowedFailureReasons?: readonly EnforcementFailureReason[];
  readonly requiredCoveredComponents?: readonly string[];
  readonly maxSignatureAgeSeconds?: number;
  readonly clockSkewSeconds?: number;
  readonly onAccepted?: (result: ReleaseWebhookReceiverResult) => void | Promise<void>;
  readonly onRejected?: (result: ReleaseWebhookReceiverResult) => void | Promise<void>;
}

export interface HonoReleaseWebhookReceiverEnv {
  readonly Variables: {
    readonly releaseWebhookReceiver: ReleaseWebhookReceiverResult;
    readonly releaseWebhookBody: Uint8Array;
  };
}

export type HonoReleaseWebhookReceiverHandler<E extends HonoReleaseWebhookReceiverEnv = HonoReleaseWebhookReceiverEnv> = (
  context: Context<E>,
  result: ReleaseWebhookReceiverResult,
  body: Uint8Array,
) => Response | Promise<Response>;

export type NodeReleaseWebhookReceiverRequest = IncomingMessage & {
  releaseWebhookReceiver?: ReleaseWebhookReceiverResult;
  releaseWebhookBody?: Buffer;
};

export type NodeReleaseWebhookReceiverHandler = (
  request: NodeReleaseWebhookReceiverRequest,
  response: ServerResponse,
  result: ReleaseWebhookReceiverResult,
  body: Buffer,
) => void | Promise<void>;

export interface NodeReleaseWebhookReceiverOptions {
  readonly baseUrl?: string;
  readonly trustForwardedProto?: boolean;
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

function normalizeMethod(method: string | undefined): string {
  return normalizeIdentifier(method)?.toUpperCase() ?? 'GET';
}

function normalizeIsoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Release webhook receiver now() must return a valid ISO timestamp.');
  }
  return timestamp.toISOString();
}

function bodyBytes(body: ReleaseWebhookReceiverHttpRequest['body']): Uint8Array {
  if (body === undefined || body === null) {
    return new Uint8Array();
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body);
  }
  return new Uint8Array(body);
}

function bodyForSignature(body: ReleaseWebhookReceiverHttpRequest['body']): Buffer {
  return Buffer.from(bodyBytes(body));
}

function headerRecord(
  headers: ReleaseWebhookReceiverHttpRequest['headers'],
): Readonly<Record<string, HttpMessageHeaderValue>> {
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
    return Object.freeze(record);
  }
  return headers as Readonly<Record<string, HttpMessageHeaderValue>>;
}

function headerValue(
  headers: ReleaseWebhookReceiverHttpRequest['headers'],
  name: string,
): string | null {
  const lowerName = name.toLowerCase();
  if (headers instanceof Headers) {
    return normalizeIdentifier(headers.get(lowerName) ?? headers.get(name));
  }

  const record = headers as Readonly<Record<string, HttpMessageHeaderValue>>;
  const direct = record[lowerName] ?? record[name];
  if (Array.isArray(direct)) {
    return normalizeIdentifier(direct.map((value) => String(value)).join(', '));
  }
  if (direct === undefined || direct === null) {
    return null;
  }
  return normalizeIdentifier(String(direct));
}

function bearerReleaseToken(headers: ReleaseWebhookReceiverHttpRequest['headers']): string | null {
  const authorization = headerValue(headers, 'authorization');
  if (authorization) {
    const match = /^Bearer\s+(.+)$/iu.exec(authorization);
    if (match?.[1]) {
      return normalizeIdentifier(match[1]);
    }
  }

  return headerValue(headers, ATTESTOR_RELEASE_TOKEN_HEADER);
}

async function resolveOption<T>(
  option: ReleaseWebhookReceiverResolver<T> | undefined,
  context: ReleaseWebhookReceiverContext,
): Promise<T | undefined> {
  if (typeof option === 'function') {
    return (option as (context: ReleaseWebhookReceiverContext) => T | Promise<T>)(context);
  }
  return option;
}

async function resolveRequiredBinding(
  option: ReleaseWebhookReceiverResolver<string | null | undefined> | undefined,
  context: ReleaseWebhookReceiverContext,
  headerName: string,
): Promise<string | null> {
  const resolved = normalizeIdentifier(await resolveOption(option, context));
  return resolved ?? headerValue(context.request.headers, headerName);
}

function acceptedMethods(options: ReleaseWebhookReceiverOptions): ReadonlySet<string> {
  return new Set(
    (options.acceptedMethods ?? DEFAULT_WEBHOOK_RECEIVER_METHODS).map((method) =>
      method.trim().toUpperCase(),
    ),
  );
}

function methodAllowed(
  request: ReleaseWebhookReceiverHttpRequest,
  options: ReleaseWebhookReceiverOptions,
): boolean {
  return acceptedMethods(options).has(normalizeMethod(request.method));
}

function headersDigest(headers: ReleaseWebhookReceiverHttpRequest['headers']): string {
  const normalized = normalizeHttpMessageHeaders(headerRecord(headers));
  const canonical = Object.entries(normalized)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function releaseWebhookMessage(
  request: ReleaseWebhookReceiverHttpRequest,
): HttpMessageForSignature {
  return Object.freeze({
    method: normalizeMethod(request.method),
    uri: request.url,
    headers: headerRecord(request.headers),
    body: bodyForSignature(request.body),
  });
}

function responseStatusForFailures(
  failureReasons: readonly EnforcementFailureReason[],
  fallback = 403,
): number {
  if (failureReasons.includes('missing-release-authorization')) {
    return 401;
  }
  if (failureReasons.includes('introspection-unavailable') || failureReasons.includes('break-glass-required')) {
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
  return fallback;
}

function isRetryableFailure(failureReasons: readonly EnforcementFailureReason[]): boolean {
  return (
    failureReasons.includes('introspection-unavailable') ||
    failureReasons.includes('fresh-introspection-required') ||
    failureReasons.includes('break-glass-required')
  );
}

function receiverFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const unique = uniqueFailureReasons(reasons);
  const hasHardFailure = unique.some(
    (reason) =>
      reason !== 'fresh-introspection-required' &&
      reason !== 'introspection-unavailable' &&
      reason !== 'break-glass-required',
  );
  return hasHardFailure
    ? uniqueFailureReasons(unique.filter((reason) => reason !== 'fresh-introspection-required'))
    : unique;
}

function resultFromEarlyRejection(input: {
  readonly checkedAt: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly responseStatus?: number;
}): ReleaseWebhookReceiverResult {
  const failureReasons = uniqueFailureReasons(input.failureReasons);
  return Object.freeze({
    version: RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION,
    status: 'rejected',
    checkedAt: input.checkedAt,
    request: null,
    presentation: null,
    signature: null,
    verificationResult: null,
    offline: null,
    online: null,
    decision: null,
    receipt: null,
    breakGlass: null,
    failureReasons,
    responseStatus: input.responseStatus ?? responseStatusForFailures(failureReasons),
    retryable: isRetryableFailure(failureReasons),
  });
}

function receiptDigestForDecision(decision: EnforcementDecision): string {
  const material = JSON.stringify({
    decisionId: decision.id,
    requestId: decision.requestId,
    outcome: decision.outcome,
    releaseTokenId: decision.releaseTokenId,
    releaseDecisionId: decision.releaseDecisionId,
    verificationStatus: decision.verification.status,
    failureReasons: decision.failureReasons,
  });
  return `sha256:${createHash('sha256').update(material).digest('hex')}`;
}

function activeBreakGlassGrant(
  grant: EnforcementBreakGlassGrant | null | undefined,
  checkedAt: string,
): EnforcementBreakGlassGrant | null {
  if (!grant) {
    return null;
  }
  const nowMs = new Date(checkedAt).getTime();
  const authorizedAtMs = new Date(grant.authorizedAt).getTime();
  const expiresAtMs = new Date(grant.expiresAt).getTime();
  if (
    Number.isNaN(authorizedAtMs) ||
    Number.isNaN(expiresAtMs) ||
    authorizedAtMs > nowMs ||
    expiresAtMs <= nowMs
  ) {
    return null;
  }
  return grant;
}

function breakGlassAllowedFailures(options: ReleaseWebhookReceiverOptions): ReadonlySet<EnforcementFailureReason> {
  return new Set(options.breakGlassAllowedFailureReasons ?? DEFAULT_WEBHOOK_BREAK_GLASS_FAILURE_REASONS);
}

function canUseBreakGlass(input: {
  readonly online: OnlineReleaseVerification | null;
  readonly offline: OfflineReleaseVerification | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly options: ReleaseWebhookReceiverOptions;
}): boolean {
  const offline = input.online?.offline ?? input.offline;
  if (!offline || !offline.offlineVerified || offline.profile.overridePosture === 'not-allowed') {
    return false;
  }

  const allowed = breakGlassAllowedFailures(input.options);
  return input.failureReasons.length > 0 && input.failureReasons.every((reason) => allowed.has(reason));
}

function createDecisionAndReceipt(input: {
  readonly request: EnforcementRequest;
  readonly verification: VerificationResult;
  readonly checkedAt: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly breakGlass: EnforcementBreakGlassGrant | null;
}): {
  readonly decision: EnforcementDecision;
  readonly receipt: EnforcementReceipt;
} {
  const decision = createEnforcementDecision({
    id: `ed_webhook_${input.request.id}`,
    request: input.request,
    decidedAt: input.checkedAt,
    verification: input.verification,
    failureReasons: input.failureReasons,
    breakGlass: input.breakGlass,
  });
  const receipt = createEnforcementReceipt({
    id: `er_webhook_${input.request.id}`,
    issuedAt: input.checkedAt,
    decision,
    receiptDigest: receiptDigestForDecision(decision),
  });

  return { decision, receipt };
}

function resultFromVerification(input: {
  readonly checkedAt: string;
  readonly request: EnforcementRequest;
  readonly presentation: ReleasePresentation;
  readonly signature: HttpMessageSignatureVerification;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
  readonly options: ReleaseWebhookReceiverOptions;
  readonly breakGlassGrant: EnforcementBreakGlassGrant | null;
}): ReleaseWebhookReceiverResult {
  const verificationResult =
    input.online?.verificationResult ?? input.offline?.verificationResult ?? null;
  if (verificationResult === null) {
    return resultFromEarlyRejection({
      checkedAt: input.checkedAt,
      failureReasons: ['invalid-signature'],
    });
  }

  const verifierFailures = receiverFailureReasons(
    input.online?.failureReasons ?? input.offline?.failureReasons ?? ['invalid-signature'],
  );

  if (verifierFailures.length === 0) {
    const { decision, receipt } = createDecisionAndReceipt({
      request: input.request,
      verification: verificationResult,
      checkedAt: input.checkedAt,
      failureReasons: [],
      breakGlass: null,
    });
    return Object.freeze({
      version: RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION,
      status: 'accepted',
      checkedAt: input.checkedAt,
      request: input.request,
      presentation: input.presentation,
      signature: input.signature,
      verificationResult,
      offline: input.offline,
      online: input.online,
      decision,
      receipt,
      breakGlass: null,
      failureReasons: Object.freeze([]),
      responseStatus: 202,
      retryable: false,
    });
  }

  const activeGrant = activeBreakGlassGrant(input.breakGlassGrant, input.checkedAt);
  const breakGlassEligible = canUseBreakGlass({
    online: input.online,
    offline: input.offline,
    failureReasons: verifierFailures,
    options: input.options,
  });

  if (activeGrant && breakGlassEligible) {
    const { decision, receipt } = createDecisionAndReceipt({
      request: input.request,
      verification: verificationResult,
      checkedAt: input.checkedAt,
      failureReasons: verifierFailures,
      breakGlass: activeGrant,
    });
    return Object.freeze({
      version: RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION,
      status: 'break-glass-accepted',
      checkedAt: input.checkedAt,
      request: input.request,
      presentation: input.presentation,
      signature: input.signature,
      verificationResult,
      offline: input.offline,
      online: input.online,
      decision,
      receipt,
      breakGlass: activeGrant,
      failureReasons: verifierFailures,
      responseStatus: 202,
      retryable: false,
    });
  }

  const failureReasons = uniqueFailureReasons([
    ...verifierFailures,
    ...(breakGlassEligible ? ['break-glass-required' as const] : []),
  ]);
  const { decision, receipt } = createDecisionAndReceipt({
    request: input.request,
    verification: verificationResult,
    checkedAt: input.checkedAt,
    failureReasons,
    breakGlass: null,
  });

  return Object.freeze({
    version: RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION,
    status: 'rejected',
    checkedAt: input.checkedAt,
    request: input.request,
    presentation: input.presentation,
    signature: input.signature,
    verificationResult,
    offline: input.offline,
    online: input.online,
    decision,
    receipt,
    breakGlass: null,
    failureReasons,
    responseStatus: responseStatusForFailures(failureReasons),
    retryable: isRetryableFailure(failureReasons),
  });
}

function inputUsesOnlineVerifier(
  input: OfflineReleaseVerificationInput | OnlineReleaseVerificationInput,
  options: ReleaseWebhookReceiverOptions,
): input is OnlineReleaseVerificationInput {
  return (
    options.verifierMode !== 'offline' ||
    options.forceOnlineIntrospection === true ||
    'introspector' in input ||
    'forceOnlineIntrospection' in input
  );
}

async function buildVerifierInput(
  context: ReleaseWebhookReceiverContext,
  options: ReleaseWebhookReceiverOptions,
): Promise<
  | {
      readonly input: OfflineReleaseVerificationInput | OnlineReleaseVerificationInput;
      readonly signature: HttpMessageSignatureVerification;
    }
  | ReleaseWebhookReceiverResult
> {
  if (!methodAllowed(context.request, options)) {
    return resultFromEarlyRejection({
      checkedAt: context.checkedAt,
      failureReasons: ['binding-mismatch'],
      responseStatus: 405,
    });
  }

  const releaseToken = bearerReleaseToken(context.request.headers);
  if (releaseToken === null) {
    return resultFromEarlyRejection({
      checkedAt: context.checkedAt,
      failureReasons: ['missing-release-authorization'],
      responseStatus: 401,
    });
  }

  const signatureInput = headerValue(context.request.headers, 'signature-input');
  const signatureHeader = headerValue(context.request.headers, 'signature');
  if (signatureInput === null || signatureHeader === null) {
    return resultFromEarlyRejection({
      checkedAt: context.checkedAt,
      failureReasons: ['invalid-signature'],
      responseStatus: 401,
    });
  }

  const targetId = await resolveRequiredBinding(
    options.targetId,
    context,
    ATTESTOR_TARGET_ID_HEADER,
  );
  const outputHash = await resolveRequiredBinding(
    options.outputHash,
    context,
    ATTESTOR_OUTPUT_HASH_HEADER,
  );
  const consequenceHash = await resolveRequiredBinding(
    options.consequenceHash,
    context,
    ATTESTOR_CONSEQUENCE_HASH_HEADER,
  );
  if (targetId === null || outputHash === null || consequenceHash === null) {
    return resultFromEarlyRejection({
      checkedAt: context.checkedAt,
      failureReasons: ['binding-mismatch'],
    });
  }

  const releaseTokenId =
    normalizeIdentifier(await resolveOption(options.releaseTokenId, context)) ??
    headerValue(context.request.headers, ATTESTOR_RELEASE_TOKEN_ID_HEADER);
  const releaseDecisionId =
    normalizeIdentifier(await resolveOption(options.releaseDecisionId, context)) ??
    headerValue(context.request.headers, ATTESTOR_RELEASE_DECISION_ID_HEADER);
  const requestId =
    normalizeIdentifier(await resolveOption(options.requestId, context)) ??
    headerValue(context.request.headers, ATTESTOR_WEBHOOK_EVENT_ID_HEADER) ??
    headerValue(context.request.headers, ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER) ??
    randomUUID();
  const idempotencyKey =
    normalizeIdentifier(await resolveOption(options.idempotencyKey, context)) ??
    headerValue(context.request.headers, ATTESTOR_IDEMPOTENCY_KEY_HEADER) ??
    headerValue(context.request.headers, 'idempotency-key');
  const traceId =
    normalizeIdentifier(await resolveOption(options.traceId, context)) ??
    headerValue(context.request.headers, 'traceparent');
  const enforcementPoint = await resolveOption(options.enforcementPoint, context);
  if (!enforcementPoint) {
    return resultFromEarlyRejection({
      checkedAt: context.checkedAt,
      failureReasons: ['binding-mismatch'],
    });
  }

  const message = releaseWebhookMessage(context.request);
  const signaturePublicJwk = await resolveOption(options.signaturePublicJwk, context);
  if (!signaturePublicJwk) {
    return resultFromEarlyRejection({
      checkedAt: context.checkedAt,
      failureReasons: ['invalid-signature'],
    });
  }

  const expectedNonce = normalizeIdentifier(await resolveOption(options.expectedNonce, context));
  const replayLedgerEntry = await resolveOption(options.replayLedgerEntry, context) ?? null;
  const nonceLedgerEntry = await resolveOption(options.nonceLedgerEntry, context) ?? null;
  const signature = await verifyHttpMessageSignature({
    message,
    signatureInput,
    signature: signatureHeader,
    publicJwk: signaturePublicJwk,
    label: HTTP_MESSAGE_SIGNATURE_LABEL,
    expectedNonce,
    expectedTag: HTTP_MESSAGE_SIGNATURE_TAG,
    requiredCoveredComponents:
      options.requiredCoveredComponents ?? DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS,
    now: context.checkedAt,
    maxSignatureAgeSeconds: options.maxSignatureAgeSeconds,
    clockSkewSeconds: options.clockSkewSeconds,
    replayLedgerEntry,
  });

  const requestInput: CreateEnforcementRequestInput = {
    id: requestId,
    receivedAt: context.checkedAt,
    enforcementPoint,
    targetId,
    outputHash,
    consequenceHash,
    releaseTokenId,
    releaseDecisionId,
    traceId,
    idempotencyKey,
    transport: {
      kind: 'http',
      method: normalizeMethod(context.request.method),
      uri: normalizeHttpSignatureTargetUri(context.request.url),
      headersDigest: headersDigest(context.request.headers),
      bodyDigest: contentDigestForBody(bodyForSignature(context.request.body)),
    },
  };
  const enforcementRequest = createEnforcementRequest(requestInput);
  const presentation = createReleasePresentation({
    mode: 'http-message-signature',
    presentedAt: context.checkedAt,
    releaseToken,
    releaseTokenId,
    releaseTokenDigest:
      headerValue(context.request.headers, ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER) ??
      httpReleaseTokenDigest(releaseToken),
    audience: targetId,
    proof: {
      kind: 'http-message-signature',
      signatureInput,
      signature: signatureHeader,
      keyId: signature.keyId ?? 'unknown-http-message-signature-key',
      coveredComponents: signature.coveredComponents,
      createdAt: signature.createdAt,
      expiresAt: signature.expiresAt,
      nonce: signature.nonce,
    },
  });
  const verificationKey = await resolveOption(options.verificationKey, context);
  if (!verificationKey) {
    return resultFromEarlyRejection({
      checkedAt: context.checkedAt,
      failureReasons: ['invalid-signature'],
    });
  }

  const baseInput: OfflineReleaseVerificationInput = {
    request: enforcementRequest,
    presentation,
    verificationKey,
    now: context.checkedAt,
    replayLedgerEntry,
    nonceLedgerEntry,
    httpMessageSignature: {
      message,
      publicJwk: signaturePublicJwk,
      expectedNonce,
      expectedTag: HTTP_MESSAGE_SIGNATURE_TAG,
      requiredCoveredComponents:
        options.requiredCoveredComponents ?? DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS,
      maxSignatureAgeSeconds: options.maxSignatureAgeSeconds,
      clockSkewSeconds: options.clockSkewSeconds,
    },
  };

  if (options.verifierMode === 'offline') {
    return { input: baseInput, signature };
  }

  return {
    input: {
      ...baseInput,
      introspector: await resolveOption(options.introspector, context),
      usageStore: await resolveOption(options.usageStore, context),
      consumeOnSuccess: options.consumeOnSuccess ?? true,
      forceOnlineIntrospection: options.forceOnlineIntrospection ?? true,
      resourceServerId: enforcementRequest.enforcementPoint.enforcementPointId,
    } satisfies OnlineReleaseVerificationInput,
    signature,
  };
}

function isReceiverResult(value: unknown): value is ReleaseWebhookReceiverResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly version?: unknown }).version === RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION
  );
}

export async function evaluateReleaseWebhookRequest(
  request: ReleaseWebhookReceiverHttpRequest,
  options: ReleaseWebhookReceiverOptions,
  framework: ReleaseWebhookReceiverContext['framework'] = 'custom',
  frameworkContext?: unknown,
): Promise<ReleaseWebhookReceiverResult> {
  const checkedAt = normalizeIsoTimestamp(options.now?.() ?? new Date().toISOString());
  const context: ReleaseWebhookReceiverContext = Object.freeze({
    request,
    checkedAt,
    framework,
    frameworkContext,
  });

  const inputOrReject = await buildVerifierInput(context, options);
  if (isReceiverResult(inputOrReject)) {
    await options.onRejected?.(inputOrReject);
    return inputOrReject;
  }

  const verifierInput = inputOrReject.input;
  const breakGlassGrant =
    activeBreakGlassGrant(await resolveOption(options.breakGlassGrant, context), checkedAt);

  if (inputUsesOnlineVerifier(verifierInput, options)) {
    const online = await verifyOnlineReleaseAuthorization(verifierInput);
    const result = resultFromVerification({
      checkedAt,
      request: verifierInput.request,
      presentation: verifierInput.presentation,
      signature: inputOrReject.signature,
      offline: online.offline,
      online,
      options,
      breakGlassGrant,
    });
    if (result.status === 'rejected') {
      await options.onRejected?.(result);
    } else {
      await options.onAccepted?.(result);
    }
    return result;
  }

  const offline = await verifyOfflineReleaseAuthorization(verifierInput);
  const result = resultFromVerification({
    checkedAt,
    request: verifierInput.request,
    presentation: verifierInput.presentation,
    signature: inputOrReject.signature,
    offline,
    online: null,
    options,
    breakGlassGrant,
  });
  if (result.status === 'rejected') {
    await options.onRejected?.(result);
  } else {
    await options.onAccepted?.(result);
  }
  return result;
}

export function releaseWebhookReceiverDeniedBody(
  result: ReleaseWebhookReceiverResult,
): ReleaseWebhookReceiverDeniedBody {
  return Object.freeze({
    version: RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION,
    status: 'rejected',
    checkedAt: result.checkedAt,
    failureReasons: result.failureReasons,
    verificationStatus: result.verificationResult?.status ?? null,
    requestId: result.request?.id ?? null,
    retryable: result.retryable,
  });
}

export function releaseWebhookReceiverResponseHeaders(
  result: ReleaseWebhookReceiverResult,
): Headers {
  const headers = new Headers({
    'cache-control': 'no-store',
    [ATTESTOR_WEBHOOK_RECEIVER_STATUS_HEADER]: result.status,
  });
  if (result.status === 'rejected') {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  if (result.failureReasons.includes('missing-release-authorization')) {
    headers.set(
      'www-authenticate',
      'Bearer realm="attestor-webhook", error="invalid_token", error_description="Attestor release authorization is required"',
    );
  }
  if (result.failureReasons.includes('missing-nonce') || result.failureReasons.includes('invalid-nonce')) {
    headers.set('accept-signature', `${HTTP_MESSAGE_SIGNATURE_LABEL}=("${DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS.join('" "')}")`);
  }
  return headers;
}

function rejectedResponse(result: ReleaseWebhookReceiverResult): Response {
  return new Response(JSON.stringify(releaseWebhookReceiverDeniedBody(result)), {
    status: result.responseStatus,
    headers: releaseWebhookReceiverResponseHeaders(result),
  });
}

export function createHonoReleaseWebhookReceiver<E extends HonoReleaseWebhookReceiverEnv = HonoReleaseWebhookReceiverEnv>(
  options: ReleaseWebhookReceiverOptions,
  handler: HonoReleaseWebhookReceiverHandler<E>,
): Handler<E> {
  return async (context) => {
    const body = new Uint8Array(await context.req.raw.arrayBuffer());
    const result = await evaluateReleaseWebhookRequest(
      {
        method: context.req.method,
        url: context.req.url,
        headers: context.req.raw.headers,
        body,
      },
      options,
      'hono',
      context,
    );
    context.set(HONO_RELEASE_WEBHOOK_RECEIVER_CONTEXT_KEY, result);
    context.set(HONO_RELEASE_WEBHOOK_BODY_CONTEXT_KEY, body);
    context.header(ATTESTOR_WEBHOOK_RECEIVER_STATUS_HEADER, result.status);

    if (result.status === 'rejected') {
      return rejectedResponse(result);
    }

    return handler(context, result, body);
  };
}

function forwardedProto(headers: IncomingHttpHeaders): string | null {
  const value = headerValue(headers, 'x-forwarded-proto');
  return value?.split(',')[0]?.trim().toLowerCase() ?? null;
}

function nodeRequestUrl(
  request: IncomingMessage,
  options: NodeReleaseWebhookReceiverOptions | undefined,
): string {
  const rawUrl = request.url ?? '/';
  if (/^https?:\/\//iu.test(rawUrl)) {
    return rawUrl;
  }

  const protocol =
    options?.trustForwardedProto === true
      ? forwardedProto(request.headers) ?? 'http'
      : (request.socket as { readonly encrypted?: boolean }).encrypted
        ? 'https'
        : 'http';
  const host = headerValue(request.headers, 'host') ?? 'localhost';
  return new URL(rawUrl, options?.baseUrl ?? `${protocol}://${host}`).toString();
}

function readNodeBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function writeNodeRejectedResponse(
  response: ServerResponse,
  result: ReleaseWebhookReceiverResult,
): void {
  const headers = releaseWebhookReceiverResponseHeaders(result);
  headers.forEach((value, name) => {
    response.setHeader(name, value);
  });
  response.statusCode = result.responseStatus;
  response.end(JSON.stringify(releaseWebhookReceiverDeniedBody(result)));
}

export function createNodeReleaseWebhookReceiver(
  options: ReleaseWebhookReceiverOptions,
  handler: NodeReleaseWebhookReceiverHandler,
  nodeOptions?: NodeReleaseWebhookReceiverOptions,
): (request: NodeReleaseWebhookReceiverRequest, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const body = await readNodeBody(request);
    const result = await evaluateReleaseWebhookRequest(
      {
        method: normalizeMethod(request.method),
        url: nodeRequestUrl(request, nodeOptions),
        headers: request.headers,
        body,
      },
      options,
      'node',
      request,
    );
    request.releaseWebhookReceiver = result;
    request.releaseWebhookBody = body;
    response.setHeader(ATTESTOR_WEBHOOK_RECEIVER_STATUS_HEADER, result.status);

    if (result.status === 'rejected') {
      writeNodeRejectedResponse(response, result);
      return;
    }

    await handler(request, response, result, body);
  };
}
