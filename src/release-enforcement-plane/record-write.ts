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
import { httpReleaseTokenDigest } from './http-message-signatures.js';
import {
  ENFORCEMENT_FAILURE_REASONS,
  type CreateEnforcementPointReferenceInput,
  type EnforcementFailureReason,
  type ReleasePresentationMode,
  type ReleaseEnforcementRiskClass,
} from './types.js';

/**
 * Record-write enforcement gateway.
 *
 * This adapter is the structured mutation counterpart to the HTTP middleware:
 * it canonicalizes the exact record write being admitted, derives the release
 * output/consequence hashes, and then uses the shared verifier contract before
 * a durable record mutation is allowed to execute.
 */

export const RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION =
  'attestor.release-enforcement-record-write.v1';
export const RECORD_WRITE_OUTPUT_ARTIFACT_TYPE = 'attestor.record-write.mutation';
export const RECORD_WRITE_OUTPUT_EXPECTED_SHAPE = 'canonical structured record write';
export const RECORD_WRITE_DEFAULT_VERIFIER_MODE = 'online';

export type RecordWriteGatewayStatus = 'allowed' | 'denied';
export type RecordWriteGatewayVerifierMode = 'offline' | 'online';
export type RecordWriteOperation = 'insert' | 'update' | 'upsert' | 'delete';
export type RecordWriteValue =
  | null
  | boolean
  | number
  | string
  | readonly RecordWriteValue[]
  | { readonly [key: string]: RecordWriteValue };

export interface RecordWriteMutation {
  readonly storeId: string;
  readonly collection: string;
  readonly recordId: string;
  readonly operation: RecordWriteOperation;
  readonly before?: RecordWriteValue | null;
  readonly after?: RecordWriteValue | null;
  readonly patch?: RecordWriteValue | null;
  readonly idempotencyKey?: string | null;
  readonly actorId?: string | null;
  readonly schemaVersion?: string | null;
  readonly reason?: string | null;
}

export interface RecordWriteCanonicalBinding {
  readonly version: typeof RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION;
  readonly target: ReleaseTargetReference;
  readonly outputContract: OutputContractDescriptor;
  readonly outputPayload: CanonicalReleaseJsonValue;
  readonly consequencePayload: CanonicalReleaseJsonValue;
  readonly hashBundle: CanonicalReleaseHashBundle;
  readonly mutationCanonical: string;
  readonly mutationHash: string;
}

export interface RecordWriteReleaseAuthorization {
  readonly releaseToken: string;
  readonly releaseTokenId?: string | null;
  readonly releaseDecisionId?: string | null;
  readonly mode?: 'bearer-release-token' | 'mtls-bound-token' | 'spiffe-bound-token';
  readonly proof?: ReleasePresentationProof | null;
  readonly issuer?: string | null;
  readonly subject?: string | null;
  readonly audience?: string | null;
  readonly expiresAt?: string | null;
  readonly scope?: readonly string[];
}

export interface RecordWriteGatewayOptions {
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly enforcementPointId: string;
  readonly environment: string;
  readonly tenantId?: string | null;
  readonly accountId?: string | null;
  readonly workloadId?: string | null;
  readonly riskClass?: ReleaseEnforcementRiskClass;
  readonly verifierMode?: RecordWriteGatewayVerifierMode;
  readonly introspector?: ReleaseTokenIntrospector;
  readonly usageStore?: ReleaseTokenIntrospectionStore;
  readonly consumeOnSuccess?: boolean;
  readonly forceOnlineIntrospection?: boolean;
  readonly now?: () => string;
  readonly requestId?: string;
  readonly traceId?: string | null;
}

export interface RecordWriteGatewayInput {
  readonly mutation: RecordWriteMutation;
  readonly authorization?: RecordWriteReleaseAuthorization | null;
  readonly options: RecordWriteGatewayOptions;
}

export interface RecordWriteGatewayResult {
  readonly version: typeof RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION;
  readonly status: RecordWriteGatewayStatus;
  readonly checkedAt: string;
  readonly binding: RecordWriteCanonicalBinding;
  readonly request: EnforcementRequest | null;
  readonly presentation: ReleasePresentation | null;
  readonly verificationResult: VerificationResult | null;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
  readonly decision: EnforcementDecision | null;
  readonly receipt: EnforcementReceipt | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly responseStatus: number;
}

function uniqueFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const present = new Set(reasons);
  return Object.freeze(ENFORCEMENT_FAILURE_REASONS.filter((reason) => present.has(reason)));
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Record-write enforcement ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeIsoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Record-write enforcement now() must return a valid ISO timestamp.');
  }
  return timestamp.toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeRecordWriteValue(value: RecordWriteValue, path: string): CanonicalReleaseJsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Record-write enforcement cannot canonicalize non-finite number at ${path}.`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => normalizeRecordWriteValue(item, `${path}[${index}]`)),
    );
  }

  if (!isPlainObject(value)) {
    throw new Error(`Record-write enforcement only accepts plain JSON values at ${path}.`);
  }

  return Object.freeze(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeRecordWriteValue(value[key], `${path}.${key}`)]),
    ) as { readonly [key: string]: CanonicalReleaseJsonValue },
  );
}

function normalizeMutation(mutation: RecordWriteMutation): Record<string, CanonicalReleaseJsonValue> {
  const operation = mutation.operation;
  if (!['insert', 'update', 'upsert', 'delete'].includes(operation)) {
    throw new Error(`Record-write enforcement operation is unsupported: ${operation}`);
  }

  const before = mutation.before === undefined ? null : normalizeRecordWriteValue(mutation.before, '$.before');
  const after = mutation.after === undefined ? null : normalizeRecordWriteValue(mutation.after, '$.after');
  const patch = mutation.patch === undefined ? null : normalizeRecordWriteValue(mutation.patch, '$.patch');
  if (operation === 'delete' && before === null) {
    throw new Error('Record-write enforcement delete mutations require the prior record state.');
  }
  if ((operation === 'insert' || operation === 'upsert') && after === null) {
    throw new Error('Record-write enforcement insert/upsert mutations require the resulting record state.');
  }
  if (operation === 'update' && after === null && patch === null) {
    throw new Error('Record-write enforcement update mutations require a resulting record state or patch.');
  }

  return {
    storeId: normalizeIdentifier(mutation.storeId, 'mutation.storeId'),
    collection: normalizeIdentifier(mutation.collection, 'mutation.collection'),
    recordId: normalizeIdentifier(mutation.recordId, 'mutation.recordId'),
    operation,
    before,
    after,
    patch,
    idempotencyKey: normalizeOptionalIdentifier(mutation.idempotencyKey),
    actorId: normalizeOptionalIdentifier(mutation.actorId),
    schemaVersion: normalizeOptionalIdentifier(mutation.schemaVersion),
    reason: normalizeOptionalIdentifier(mutation.reason),
  };
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function recordTarget(mutation: RecordWriteMutation): ReleaseTargetReference {
  return Object.freeze({
    kind: 'record-store',
    id: [
      normalizeIdentifier(mutation.storeId, 'mutation.storeId'),
      normalizeIdentifier(mutation.collection, 'mutation.collection'),
      normalizeIdentifier(mutation.recordId, 'mutation.recordId'),
    ].join('/'),
  });
}

function outputContract(riskClass: ReleaseEnforcementRiskClass): OutputContractDescriptor {
  return {
    artifactType: RECORD_WRITE_OUTPUT_ARTIFACT_TYPE,
    expectedShape: RECORD_WRITE_OUTPUT_EXPECTED_SHAPE,
    consequenceType: 'record',
    riskClass,
  };
}

export function buildRecordWriteCanonicalBinding(
  mutation: RecordWriteMutation,
  riskClass: ReleaseEnforcementRiskClass = 'R4',
): RecordWriteCanonicalBinding {
  const normalizedMutation = normalizeMutation(mutation);
  const target = recordTarget(mutation);
  const contract = outputContract(riskClass);
  const outputPayload = Object.freeze({
    recordWrite: normalizedMutation,
  } satisfies Record<string, CanonicalReleaseJsonValue>);
  const consequencePayload = Object.freeze({
    operation: 'record-write',
    targetId: target.id,
    recordWrite: normalizedMutation,
  } satisfies Record<string, CanonicalReleaseJsonValue>);
  const hashBundle = createCanonicalReleaseHashBundle({
    outputContract: contract,
    target,
    outputPayload,
    consequencePayload,
    idempotencyKey: normalizeOptionalIdentifier(mutation.idempotencyKey) ?? undefined,
  });
  const mutationCanonical = canonicalizeReleaseJson(normalizedMutation);

  return Object.freeze({
    version: RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION,
    target,
    outputContract: contract,
    outputPayload,
    consequencePayload,
    hashBundle,
    mutationCanonical,
    mutationHash: sha256(mutationCanonical),
  });
}

function createRecordEnforcementPoint(
  options: RecordWriteGatewayOptions,
  binding: RecordWriteCanonicalBinding,
): CreateEnforcementPointReferenceInput {
  return {
    environment: options.environment,
    enforcementPointId: options.enforcementPointId,
    pointKind: 'record-write-gateway',
    boundaryKind: 'record-write',
    consequenceType: 'record',
    riskClass: binding.outputContract.riskClass,
    tenantId: options.tenantId,
    accountId: options.accountId,
    workloadId: options.workloadId,
    audience: binding.target.id,
  };
}

function createRecordWriteRequest(input: {
  readonly checkedAt: string;
  readonly binding: RecordWriteCanonicalBinding;
  readonly mutation: RecordWriteMutation;
  readonly authorization: RecordWriteReleaseAuthorization;
  readonly options: RecordWriteGatewayOptions;
}): EnforcementRequest {
  return createEnforcementRequest({
    id: input.options.requestId ?? `erq_record_write_${randomUUID()}`,
    receivedAt: input.checkedAt,
    enforcementPoint: createRecordEnforcementPoint(input.options, input.binding),
    targetId: input.binding.target.id,
    outputHash: input.binding.hashBundle.outputHash,
    consequenceHash: input.binding.hashBundle.consequenceHash,
    releaseTokenId: normalizeOptionalIdentifier(input.authorization.releaseTokenId),
    releaseDecisionId: normalizeOptionalIdentifier(input.authorization.releaseDecisionId),
    traceId: normalizeOptionalIdentifier(input.options.traceId),
    idempotencyKey: normalizeOptionalIdentifier(input.mutation.idempotencyKey),
    transport: {
      kind: 'artifact',
      artifactId: input.binding.target.id,
      artifactDigest: input.binding.mutationHash,
    },
  });
}

function createRecordWritePresentation(
  authorization: RecordWriteReleaseAuthorization,
  checkedAt: string,
): ReleasePresentation {
  return createReleasePresentation({
    mode: authorization.mode ?? 'bearer-release-token',
    presentedAt: checkedAt,
    releaseToken: authorization.releaseToken,
    releaseTokenId: authorization.releaseTokenId,
    releaseTokenDigest: httpReleaseTokenDigest(authorization.releaseToken),
    issuer: authorization.issuer,
    subject: authorization.subject,
    audience: authorization.audience,
    expiresAt: authorization.expiresAt,
    scope: authorization.scope,
    proof: authorization.proof ?? null,
  });
}

function senderConstrainedPresentationFailureReasons(
  mode: ReleasePresentationMode,
): readonly EnforcementFailureReason[] {
  return mode === 'mtls-bound-token' || mode === 'spiffe-bound-token'
    ? []
    : ['binding-mismatch'];
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
    id: `ed_record_write_${input.request.id}`,
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
    id: `er_record_write_${input.request.id}`,
    issuedAt: input.checkedAt,
    decision,
    receiptDigest,
  });

  return { decision, receipt };
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

function gatewayFailureReasons(
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

function deniedEarlyResult(input: {
  readonly checkedAt: string;
  readonly binding: RecordWriteCanonicalBinding;
  readonly failureReasons: readonly EnforcementFailureReason[];
}): RecordWriteGatewayResult {
  const failureReasons = uniqueFailureReasons(input.failureReasons);
  return Object.freeze({
    version: RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION,
    status: 'denied',
    checkedAt: input.checkedAt,
    binding: input.binding,
    request: null,
    presentation: null,
    verificationResult: null,
    offline: null,
    online: null,
    decision: null,
    receipt: null,
    failureReasons,
    responseStatus: responseStatusForFailures(failureReasons),
  });
}

function resultFromVerification(input: {
  readonly checkedAt: string;
  readonly binding: RecordWriteCanonicalBinding;
  readonly request: EnforcementRequest;
  readonly presentation: ReleasePresentation;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
}): RecordWriteGatewayResult {
  const verificationResult =
    input.online?.verificationResult ?? input.offline?.verificationResult ?? null;
  if (verificationResult === null) {
    return deniedEarlyResult({
      checkedAt: input.checkedAt,
      binding: input.binding,
      failureReasons: ['invalid-signature'],
    });
  }

  const failureReasons = gatewayFailureReasons(
    input.online?.failureReasons ?? input.offline?.failureReasons ?? [],
  );
  const { decision, receipt } = decisionAndReceipt({
    request: input.request,
    verification: verificationResult,
    checkedAt: input.checkedAt,
    failureReasons,
  });
  const allowed = failureReasons.length === 0 && verificationResult.status === 'valid';

  return Object.freeze({
    version: RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION,
    status: allowed ? 'allowed' : 'denied',
    checkedAt: input.checkedAt,
    binding: input.binding,
    request: input.request,
    presentation: input.presentation,
    verificationResult,
    offline: input.offline,
    online: input.online,
    decision,
    receipt,
    failureReasons,
    responseStatus: allowed ? 200 : responseStatusForFailures(failureReasons),
  });
}

export async function enforceRecordWrite(
  input: RecordWriteGatewayInput,
): Promise<RecordWriteGatewayResult> {
  const checkedAt = normalizeIsoTimestamp(input.options.now?.() ?? new Date().toISOString());
  const riskClass = input.options.riskClass ?? 'R4';
  const binding = buildRecordWriteCanonicalBinding(input.mutation, riskClass);
  const authorization = input.authorization ?? null;

  if (!authorization?.releaseToken) {
    return deniedEarlyResult({
      checkedAt,
      binding,
      failureReasons: ['missing-release-authorization'],
    });
  }

  const request = createRecordWriteRequest({
    checkedAt,
    binding,
    mutation: input.mutation,
    authorization,
    options: input.options,
  });
  const presentation = createRecordWritePresentation(authorization, checkedAt);
  const presentationModeFailures = senderConstrainedPresentationFailureReasons(presentation.mode);
  if (presentationModeFailures.length > 0) {
    const verifierPresentation = createReleasePresentation({
      mode: presentation.mode,
      presentedAt: checkedAt,
      releaseToken: authorization.releaseToken,
      releaseTokenId: authorization.releaseTokenId,
    });
    const offline = await verifyOfflineReleaseAuthorization({
      request,
      presentation: verifierPresentation,
      verificationKey: input.options.verificationKey,
      now: checkedAt,
    });
    const forcedFailureReasons = gatewayFailureReasons([
      ...presentationModeFailures,
      ...offline.failureReasons,
    ]);
    const forcedVerification = {
      ...offline.verificationResult,
      status: 'invalid' as const,
      failureReasons: forcedFailureReasons,
    };
    const { decision, receipt } = decisionAndReceipt({
      request,
      verification: forcedVerification,
      checkedAt,
      failureReasons: forcedFailureReasons,
    });
    return Object.freeze({
      version: RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION,
      status: 'denied',
      checkedAt,
      binding,
      request,
      presentation,
      verificationResult: forcedVerification,
      offline,
      online: null,
      decision,
      receipt,
      failureReasons: forcedFailureReasons,
      responseStatus: responseStatusForFailures(forcedFailureReasons),
    });
  }

  if (input.options.verifierMode === 'offline') {
    const offline = await verifyOfflineReleaseAuthorization({
      request,
      presentation,
      verificationKey: input.options.verificationKey,
      now: checkedAt,
    });
    return resultFromVerification({
      checkedAt,
      binding,
      request,
      presentation,
      offline,
      online: null,
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
    resourceServerId: input.options.enforcementPointId,
  });

  return resultFromVerification({
    checkedAt,
    binding,
    request,
    presentation,
    offline: online.offline,
    online,
  });
}
