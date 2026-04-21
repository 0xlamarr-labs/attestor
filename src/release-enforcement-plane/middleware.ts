import { createHash, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';
import type {
  ReleaseTokenIntrospectionStore,
  ReleaseTokenIntrospector,
} from '../release-kernel/release-introspection.js';
import type { ReleaseTokenVerificationKey } from '../release-kernel/release-token.js';
import {
  createEnforcementRequest,
  createReleasePresentation,
  type CreateEnforcementRequestInput,
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
  ATTESTOR_RELEASE_TOKEN_ID_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
  httpReleaseTokenDigest,
} from './http-message-signatures.js';
import {
  ENFORCEMENT_FAILURE_REASONS,
  type EnforcementFailureReason,
  type CreateEnforcementPointReferenceInput,
} from './types.js';

/**
 * Reference Node and Hono policy-enforcement-point middleware.
 *
 * These adapters make ordinary HTTP mutation routes fail closed before the
 * handler runs. They build the standard enforcement request + release
 * presentation objects, invoke the shared verifier core, and expose the result
 * to the downstream handler only after authorization is valid.
 */

export const RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION =
  'attestor.release-enforcement-middleware.v1';
export const HONO_RELEASE_ENFORCEMENT_CONTEXT_KEY = 'releaseEnforcement';
export const ATTESTOR_IDEMPOTENCY_KEY_HEADER = 'attestor-idempotency-key';
export const ATTESTOR_RELEASE_TOKEN_HEADER = 'attestor-release-token';
export const ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER = 'attestor-enforcement-request-id';
export const ATTESTOR_ENFORCEMENT_STATUS_HEADER = 'x-attestor-enforcement-status';
export const DEFAULT_PROTECTED_HTTP_METHODS = Object.freeze([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const);

export type ReleaseEnforcementMiddlewareStatus = 'allowed' | 'denied' | 'skipped';
export type ReleaseEnforcementMiddlewareVerifierMode = 'offline' | 'online';

export interface ReleaseEnforcementHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers | IncomingHttpHeaders | Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface ReleaseEnforcementHttpContext {
  readonly request: ReleaseEnforcementHttpRequest;
  readonly checkedAt: string;
  readonly framework: 'hono' | 'node' | 'custom';
  readonly frameworkContext?: unknown;
}

export type ReleaseEnforcementResolver<T> =
  | T
  | ((context: ReleaseEnforcementHttpContext) => T | Promise<T>);

export interface ReleaseEnforcementMiddlewareResult {
  readonly version: typeof RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION;
  readonly status: ReleaseEnforcementMiddlewareStatus;
  readonly checkedAt: string;
  readonly request: EnforcementRequest | null;
  readonly presentation: ReleasePresentation | null;
  readonly verificationResult: VerificationResult | null;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly responseStatus: number | null;
}

export interface ReleaseEnforcementDeniedBody {
  readonly version: typeof RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION;
  readonly status: 'denied';
  readonly checkedAt: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly verificationStatus: VerificationResult['status'] | null;
  readonly requestId: string | null;
}

export interface ReleaseEnforcementMiddlewareOptions {
  readonly verificationKey: ReleaseEnforcementResolver<ReleaseTokenVerificationKey>;
  readonly enforcementPoint: ReleaseEnforcementResolver<CreateEnforcementPointReferenceInput>;
  readonly verifierMode?: ReleaseEnforcementMiddlewareVerifierMode;
  readonly introspector?: ReleaseEnforcementResolver<ReleaseTokenIntrospector | undefined>;
  readonly usageStore?: ReleaseEnforcementResolver<ReleaseTokenIntrospectionStore | undefined>;
  readonly consumeOnSuccess?: boolean;
  readonly forceOnlineIntrospection?: boolean;
  readonly protectedMethods?: readonly string[];
  readonly now?: () => string;
  readonly requestId?: ReleaseEnforcementResolver<string>;
  readonly targetId?: ReleaseEnforcementResolver<string | null | undefined>;
  readonly outputHash?: ReleaseEnforcementResolver<string | null | undefined>;
  readonly consequenceHash?: ReleaseEnforcementResolver<string | null | undefined>;
  readonly releaseTokenId?: ReleaseEnforcementResolver<string | null | undefined>;
  readonly releaseDecisionId?: ReleaseEnforcementResolver<string | null | undefined>;
  readonly idempotencyKey?: ReleaseEnforcementResolver<string | null | undefined>;
  readonly buildInput?: (
    context: ReleaseEnforcementHttpContext,
  ) => OfflineReleaseVerificationInput | OnlineReleaseVerificationInput | Promise<OfflineReleaseVerificationInput | OnlineReleaseVerificationInput>;
  readonly onAllowed?: (result: ReleaseEnforcementMiddlewareResult) => void | Promise<void>;
  readonly onDenied?: (result: ReleaseEnforcementMiddlewareResult) => void | Promise<void>;
}

export interface HonoReleaseEnforcementEnv {
  readonly Variables: {
    readonly releaseEnforcement: ReleaseEnforcementMiddlewareResult;
  };
}

export interface NodeReleaseEnforcementOptions {
  readonly baseUrl?: string;
  readonly trustForwardedProto?: boolean;
}

export type NodeReleaseEnforcementRequest = IncomingMessage & {
  releaseEnforcement?: ReleaseEnforcementMiddlewareResult;
};
export type NodeReleaseEnforcementNext = (error?: unknown) => void;
export type NodeReleaseEnforcementMiddleware = (
  request: NodeReleaseEnforcementRequest,
  response: ServerResponse,
  next: NodeReleaseEnforcementNext,
) => Promise<void>;

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
    throw new Error('Release enforcement middleware now() must return a valid ISO timestamp.');
  }
  return timestamp.toISOString();
}

function headerValue(
  headers: ReleaseEnforcementHttpRequest['headers'],
  name: string,
): string | null {
  const lowerName = name.toLowerCase();
  if (headers instanceof Headers) {
    return normalizeIdentifier(headers.get(lowerName));
  }

  const record = headers as Readonly<Record<string, string | readonly string[] | undefined>>;
  const direct = record[lowerName] ?? record[name];
  if (Array.isArray(direct)) {
    return normalizeIdentifier((direct as readonly string[]).join(', '));
  }
  if (direct === undefined) {
    return null;
  }
  return normalizeIdentifier(String(direct));
}

function authorizationBearerToken(headers: ReleaseEnforcementHttpRequest['headers']): string | null {
  const authorization = headerValue(headers, 'authorization');
  if (authorization) {
    const match = /^Bearer\s+(.+)$/iu.exec(authorization);
    if (match?.[1]) {
      return normalizeIdentifier(match[1]);
    }
  }

  return headerValue(headers, ATTESTOR_RELEASE_TOKEN_HEADER);
}

function protectedMethods(options: ReleaseEnforcementMiddlewareOptions): ReadonlySet<string> {
  return new Set(
    (options.protectedMethods ?? DEFAULT_PROTECTED_HTTP_METHODS).map((method) =>
      method.trim().toUpperCase(),
    ),
  );
}

function shouldProtect(
  context: ReleaseEnforcementHttpContext,
  options: ReleaseEnforcementMiddlewareOptions,
): boolean {
  return protectedMethods(options).has(normalizeMethod(context.request.method));
}

async function resolveOption<T>(
  option: ReleaseEnforcementResolver<T> | undefined,
  context: ReleaseEnforcementHttpContext,
): Promise<T | undefined> {
  if (typeof option === 'function') {
    return (option as (context: ReleaseEnforcementHttpContext) => T | Promise<T>)(context);
  }
  return option;
}

async function resolveRequiredBinding(
  option: ReleaseEnforcementResolver<string | null | undefined> | undefined,
  context: ReleaseEnforcementHttpContext,
  headerName: string,
): Promise<string | null> {
  const resolved = normalizeIdentifier(await resolveOption(option, context));
  return resolved ?? headerValue(context.request.headers, headerName);
}

function headersDigest(headers: ReleaseEnforcementHttpRequest['headers']): string {
  const entries: [string, string][] = [];
  if (headers instanceof Headers) {
    headers.forEach((value, key) => entries.push([key.toLowerCase(), value.trim()]));
  } else {
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }
      entries.push([
        key.toLowerCase(),
        Array.isArray(value) ? value.join(', ').trim() : String(value).trim(),
      ]);
    }
  }

  const canonical = entries
    .filter(([, value]) => value.length > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function bodyDigestFromHeaders(headers: ReleaseEnforcementHttpRequest['headers']): string | null {
  return headerValue(headers, 'content-digest') ?? headerValue(headers, 'attestor-body-digest');
}

function skippedResult(checkedAt: string): ReleaseEnforcementMiddlewareResult {
  return Object.freeze({
    version: RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION,
    status: 'skipped',
    checkedAt,
    request: null,
    presentation: null,
    verificationResult: null,
    offline: null,
    online: null,
    failureReasons: Object.freeze([]),
    responseStatus: null,
  });
}

function deniedResult(input: {
  readonly checkedAt: string;
  readonly request: EnforcementRequest | null;
  readonly presentation: ReleasePresentation | null;
  readonly verificationResult: VerificationResult | null;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly responseStatus: number;
}): ReleaseEnforcementMiddlewareResult {
  return Object.freeze({
    version: RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION,
    status: 'denied',
    checkedAt: input.checkedAt,
    request: input.request,
    presentation: input.presentation,
    verificationResult: input.verificationResult,
    offline: input.offline,
    online: input.online,
    failureReasons: uniqueFailureReasons(input.failureReasons),
    responseStatus: input.responseStatus,
  });
}

function allowedResult(input: {
  readonly checkedAt: string;
  readonly request: EnforcementRequest;
  readonly presentation: ReleasePresentation;
  readonly verificationResult: VerificationResult;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
}): ReleaseEnforcementMiddlewareResult {
  return Object.freeze({
    version: RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION,
    status: 'allowed',
    checkedAt: input.checkedAt,
    request: input.request,
    presentation: input.presentation,
    verificationResult: input.verificationResult,
    offline: input.offline,
    online: input.online,
    failureReasons: Object.freeze([]),
    responseStatus: null,
  });
}

function isMiddlewareResult(value: unknown): value is ReleaseEnforcementMiddlewareResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly version?: unknown }).version ===
      RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION &&
    typeof (value as { readonly status?: unknown }).status === 'string'
  );
}

function responseStatusForFailures(
  failureReasons: readonly EnforcementFailureReason[],
  verificationStatus: VerificationResult['status'] | null,
): number {
  if (failureReasons.includes('missing-release-authorization')) {
    return 401;
  }
  if (verificationStatus === 'indeterminate' || failureReasons.includes('fresh-introspection-required')) {
    return 428;
  }
  return 403;
}

export function releaseEnforcementDeniedBody(
  result: ReleaseEnforcementMiddlewareResult,
): ReleaseEnforcementDeniedBody {
  return Object.freeze({
    version: RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION,
    status: 'denied',
    checkedAt: result.checkedAt,
    failureReasons: result.failureReasons,
    verificationStatus: result.verificationResult?.status ?? null,
    requestId: result.request?.id ?? null,
  });
}

export function releaseEnforcementDenyHeaders(
  result: ReleaseEnforcementMiddlewareResult,
): Headers {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    [ATTESTOR_ENFORCEMENT_STATUS_HEADER]: 'denied',
  });
  if (result.failureReasons.includes('missing-release-authorization')) {
    headers.set(
      'www-authenticate',
      'Bearer realm="attestor-release", error="invalid_token", error_description="Attestor release authorization is required"',
    );
  }
  return headers;
}

async function defaultInputForHttpRequest(
  context: ReleaseEnforcementHttpContext,
  options: ReleaseEnforcementMiddlewareOptions,
): Promise<OfflineReleaseVerificationInput | OnlineReleaseVerificationInput | ReleaseEnforcementMiddlewareResult> {
  const releaseToken = authorizationBearerToken(context.request.headers);
  if (releaseToken === null) {
    return deniedResult({
      checkedAt: context.checkedAt,
      request: null,
      presentation: null,
      verificationResult: null,
      offline: null,
      online: null,
      failureReasons: ['missing-release-authorization'],
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
    return deniedResult({
      checkedAt: context.checkedAt,
      request: null,
      presentation: null,
      verificationResult: null,
      offline: null,
      online: null,
      failureReasons: ['binding-mismatch'],
      responseStatus: 403,
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
    headerValue(context.request.headers, ATTESTOR_ENFORCEMENT_REQUEST_ID_HEADER) ??
    randomUUID();
  const idempotencyKey =
    normalizeIdentifier(await resolveOption(options.idempotencyKey, context)) ??
    headerValue(context.request.headers, ATTESTOR_IDEMPOTENCY_KEY_HEADER) ??
    headerValue(context.request.headers, 'idempotency-key');
  const enforcementPoint = await resolveOption(options.enforcementPoint, context);
  if (!enforcementPoint) {
    return deniedResult({
      checkedAt: context.checkedAt,
      request: null,
      presentation: null,
      verificationResult: null,
      offline: null,
      online: null,
      failureReasons: ['binding-mismatch'],
      responseStatus: 403,
    });
  }

  const requestInput: CreateEnforcementRequestInput = {
    id: requestId,
    receivedAt: context.checkedAt,
    enforcementPoint,
    targetId,
    outputHash,
    consequenceHash,
    releaseTokenId,
    releaseDecisionId,
    idempotencyKey,
    transport: {
      kind: 'http',
      method: normalizeMethod(context.request.method),
      uri: context.request.url,
      headersDigest: headersDigest(context.request.headers),
      bodyDigest: bodyDigestFromHeaders(context.request.headers),
    },
  };
  const enforcementRequest = createEnforcementRequest(requestInput);
  const presentation = createReleasePresentation({
    mode: 'bearer-release-token',
    presentedAt: context.checkedAt,
    releaseToken,
    releaseTokenId,
    releaseTokenDigest: httpReleaseTokenDigest(releaseToken),
  });
  const verificationKey = await resolveOption(options.verificationKey, context);
  if (!verificationKey) {
    return deniedResult({
      checkedAt: context.checkedAt,
      request: enforcementRequest,
      presentation,
      verificationResult: null,
      offline: null,
      online: null,
      failureReasons: ['invalid-signature'],
      responseStatus: 403,
    });
  }

  const baseInput: OfflineReleaseVerificationInput = {
    request: enforcementRequest,
    presentation,
    verificationKey,
    now: context.checkedAt,
  };

  if (options.verifierMode === 'online' || options.forceOnlineIntrospection === true) {
    return {
      ...baseInput,
      introspector: await resolveOption(options.introspector, context),
      usageStore: await resolveOption(options.usageStore, context),
      consumeOnSuccess: options.consumeOnSuccess,
      forceOnlineIntrospection: options.forceOnlineIntrospection,
    } satisfies OnlineReleaseVerificationInput;
  }

  return baseInput;
}

function inputUsesOnlineVerifier(
  input: OfflineReleaseVerificationInput | OnlineReleaseVerificationInput,
  options: ReleaseEnforcementMiddlewareOptions,
): input is OnlineReleaseVerificationInput {
  return (
    options.verifierMode === 'online' ||
    options.forceOnlineIntrospection === true ||
    'introspector' in input ||
    'forceOnlineIntrospection' in input
  );
}

export async function evaluateReleaseEnforcementHttpRequest(
  request: ReleaseEnforcementHttpRequest,
  options: ReleaseEnforcementMiddlewareOptions,
  framework: ReleaseEnforcementHttpContext['framework'] = 'custom',
  frameworkContext?: unknown,
): Promise<ReleaseEnforcementMiddlewareResult> {
  const checkedAt = normalizeIsoTimestamp(options.now?.() ?? new Date().toISOString());
  const context: ReleaseEnforcementHttpContext = Object.freeze({
    request,
    checkedAt,
    framework,
    frameworkContext,
  });

  if (!shouldProtect(context, options)) {
    return skippedResult(checkedAt);
  }

  const inputOrDeny = options.buildInput
    ? await options.buildInput(context)
    : await defaultInputForHttpRequest(context, options);
  if (isMiddlewareResult(inputOrDeny)) {
    await options.onDenied?.(inputOrDeny);
    return inputOrDeny;
  }

  const verifierInput = inputOrDeny;
  if (inputUsesOnlineVerifier(verifierInput, options)) {
    const online = await verifyOnlineReleaseAuthorization(verifierInput);
    if (online.status === 'valid') {
      const result = allowedResult({
        checkedAt,
        request: verifierInput.request,
        presentation: verifierInput.presentation,
        verificationResult: online.verificationResult,
        offline: online.offline,
        online,
      });
      await options.onAllowed?.(result);
      return result;
    }

    const result = deniedResult({
      checkedAt,
      request: verifierInput.request,
      presentation: verifierInput.presentation,
      verificationResult: online.verificationResult,
      offline: online.offline,
      online,
      failureReasons: online.failureReasons,
      responseStatus: responseStatusForFailures(
        online.failureReasons,
        online.verificationResult.status,
      ),
    });
    await options.onDenied?.(result);
    return result;
  }

  const offline = await verifyOfflineReleaseAuthorization(verifierInput);
  if (offline.status === 'valid') {
    const result = allowedResult({
      checkedAt,
      request: verifierInput.request,
      presentation: verifierInput.presentation,
      verificationResult: offline.verificationResult,
      offline,
      online: null,
    });
    await options.onAllowed?.(result);
    return result;
  }

  const result = deniedResult({
    checkedAt,
    request: verifierInput.request,
    presentation: verifierInput.presentation,
    verificationResult: offline.verificationResult,
    offline,
    online: null,
    failureReasons: offline.failureReasons,
    responseStatus: responseStatusForFailures(
      offline.failureReasons,
      offline.verificationResult.status,
    ),
  });
  await options.onDenied?.(result);
  return result;
}

function deniedResponse(result: ReleaseEnforcementMiddlewareResult): Response {
  return new Response(JSON.stringify(releaseEnforcementDeniedBody(result)), {
    status: result.responseStatus ?? 403,
    headers: releaseEnforcementDenyHeaders(result),
  });
}

export function createHonoReleaseEnforcementMiddleware(
  options: ReleaseEnforcementMiddlewareOptions,
): MiddlewareHandler<HonoReleaseEnforcementEnv> {
  return createMiddleware<HonoReleaseEnforcementEnv>(async (context, next) => {
    const result = await evaluateReleaseEnforcementHttpRequest(
      {
        method: context.req.method,
        url: context.req.url,
        headers: context.req.raw.headers,
      },
      options,
      'hono',
      context,
    );
    context.set(HONO_RELEASE_ENFORCEMENT_CONTEXT_KEY, result);
    context.header(ATTESTOR_ENFORCEMENT_STATUS_HEADER, result.status);

    if (result.status === 'denied') {
      return deniedResponse(result);
    }

    await next();
  });
}

function forwardedProto(headers: IncomingHttpHeaders): string | null {
  const value = headerValue(headers, 'x-forwarded-proto');
  return value?.split(',')[0]?.trim().toLowerCase() ?? null;
}

function nodeRequestUrl(
  request: IncomingMessage,
  options: NodeReleaseEnforcementOptions | undefined,
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

function writeNodeDeniedResponse(
  response: ServerResponse,
  result: ReleaseEnforcementMiddlewareResult,
): void {
  const headers = releaseEnforcementDenyHeaders(result);
  headers.forEach((value, name) => {
    response.setHeader(name, value);
  });
  response.statusCode = result.responseStatus ?? 403;
  response.end(JSON.stringify(releaseEnforcementDeniedBody(result)));
}

export function createNodeReleaseEnforcementMiddleware(
  options: ReleaseEnforcementMiddlewareOptions,
  nodeOptions?: NodeReleaseEnforcementOptions,
): NodeReleaseEnforcementMiddleware {
  return async (request, response, next) => {
    try {
      const result = await evaluateReleaseEnforcementHttpRequest(
        {
          method: normalizeMethod(request.method),
          url: nodeRequestUrl(request, nodeOptions),
          headers: request.headers,
        },
        options,
        'node',
        request,
      );
      request.releaseEnforcement = result;
      response.setHeader(ATTESTOR_ENFORCEMENT_STATUS_HEADER, result.status);

      if (result.status === 'denied') {
        writeNodeDeniedResponse(response, result);
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
