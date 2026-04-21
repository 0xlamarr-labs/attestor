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
import type { NonceLedgerEntry, ReplayLedgerEntry } from './freshness.js';
import {
  ENFORCEMENT_FAILURE_REASONS,
  type CreateEnforcementPointReferenceInput,
  type EnforcementFailureReason,
  type ReleaseEnforcementRiskClass,
  type ReleasePresentationMode,
} from './types.js';

/**
 * Action-dispatch enforcement gateway.
 *
 * This adapter is the last admission check before workflow steps, tool calls,
 * job starts, HTTP side effects, or async dispatches run. It binds the exact
 * action request to the release token and only admits sender-constrained
 * presentations that can prove the caller is the intended workload.
 */

export const RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION =
  'attestor.release-enforcement-action-dispatch.v1';
export const ACTION_DISPATCH_OUTPUT_ARTIFACT_TYPE =
  'attestor.action-dispatch.request';
export const ACTION_DISPATCH_OUTPUT_EXPECTED_SHAPE =
  'canonical downstream action dispatch';
export const ACTION_DISPATCH_DEFAULT_VERIFIER_MODE = 'online';
export const ACTION_DISPATCH_DEFAULT_BASE_URI =
  'https://attestor.local/release-enforcement/action-dispatch';
export const ACTION_DISPATCH_HTTP_METHOD = 'POST';

export type ActionDispatchGatewayStatus = 'allowed' | 'denied';
export type ActionDispatchGatewayVerifierMode = 'offline' | 'online';
export type ActionDispatchType =
  | 'workflow-dispatch'
  | 'tool-call'
  | 'async-dispatch'
  | 'http-call'
  | 'job-start';
export type ActionDispatchTargetKind = ReleaseTargetReference['kind'];
export type ActionDispatchPreconditionKind =
  | 'state'
  | 'approval'
  | 'evidence'
  | 'time-window'
  | 'idempotency';
export type ActionDispatchValue =
  | null
  | boolean
  | number
  | string
  | readonly ActionDispatchValue[]
  | { readonly [key: string]: ActionDispatchValue };

export interface ActionDispatchPrecondition {
  readonly preconditionId: string;
  readonly kind: ActionDispatchPreconditionKind;
  readonly expected?: ActionDispatchValue | null;
  readonly digest?: string | null;
}

export interface ActionDispatchRequest {
  readonly actionType: ActionDispatchType;
  readonly operation: string;
  readonly targetId?: string | null;
  readonly targetKind?: ActionDispatchTargetKind | null;
  readonly workflowId?: string | null;
  readonly toolName?: string | null;
  readonly queueOrTopic?: string | null;
  readonly resourceUri?: string | null;
  readonly requestedTransition?: string | null;
  readonly parameters?: ActionDispatchValue | null;
  readonly preconditions?: readonly ActionDispatchPrecondition[];
  readonly dryRun?: boolean;
  readonly reason?: string | null;
  readonly idempotencyKey?: string | null;
  readonly actorId?: string | null;
  readonly traceparent?: string | null;
  readonly tracestate?: string | null;
}

export interface ActionDispatchBindingOptions {
  readonly riskClass?: ReleaseEnforcementRiskClass;
  readonly dispatchBaseUri?: string | null;
}

export interface ActionDispatchCanonicalBinding {
  readonly version: typeof RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION;
  readonly target: ReleaseTargetReference;
  readonly outputContract: OutputContractDescriptor;
  readonly outputPayload: CanonicalReleaseJsonValue;
  readonly consequencePayload: CanonicalReleaseJsonValue;
  readonly hashBundle: CanonicalReleaseHashBundle;
  readonly dispatchCanonical: string;
  readonly dispatchHash: string;
  readonly httpMethod: typeof ACTION_DISPATCH_HTTP_METHOD;
  readonly dispatchUri: string;
}

export interface ActionDispatchReleaseAuthorization {
  readonly releaseToken: string;
  readonly releaseTokenId?: string | null;
  readonly releaseDecisionId?: string | null;
  readonly mode?:
    | 'bearer-release-token'
    | 'dpop-bound-token'
    | 'mtls-bound-token'
    | 'spiffe-bound-token';
  readonly proof?: ReleasePresentationProof | null;
  readonly issuer?: string | null;
  readonly subject?: string | null;
  readonly audience?: string | null;
  readonly expiresAt?: string | null;
  readonly scope?: readonly string[];
}

export interface ActionDispatchGatewayOptions {
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly enforcementPointId: string;
  readonly environment: string;
  readonly tenantId?: string | null;
  readonly accountId?: string | null;
  readonly workloadId?: string | null;
  readonly riskClass?: ReleaseEnforcementRiskClass;
  readonly verifierMode?: ActionDispatchGatewayVerifierMode;
  readonly introspector?: ReleaseTokenIntrospector;
  readonly usageStore?: ReleaseTokenIntrospectionStore;
  readonly consumeOnSuccess?: boolean;
  readonly forceOnlineIntrospection?: boolean;
  readonly replayLedgerEntry?: ReplayLedgerEntry | null;
  readonly nonceLedgerEntry?: NonceLedgerEntry | null;
  readonly dispatchBaseUri?: string | null;
  readonly now?: () => string;
  readonly requestId?: string;
  readonly traceId?: string | null;
}

export interface ActionDispatchGatewayInput {
  readonly action: ActionDispatchRequest;
  readonly authorization?: ActionDispatchReleaseAuthorization | null;
  readonly options: ActionDispatchGatewayOptions;
}

export interface ActionDispatchGatewayResult {
  readonly version: typeof RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION;
  readonly status: ActionDispatchGatewayStatus;
  readonly checkedAt: string;
  readonly binding: ActionDispatchCanonicalBinding;
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

const ACTION_DISPATCH_TYPES = Object.freeze([
  'workflow-dispatch',
  'tool-call',
  'async-dispatch',
  'http-call',
  'job-start',
] as const satisfies readonly ActionDispatchType[]);

const ACTION_DISPATCH_TARGET_KINDS = Object.freeze([
  'endpoint',
  'queue',
  'record-store',
  'workflow',
  'artifact-registry',
] as const satisfies readonly ActionDispatchTargetKind[]);

const ACTION_DISPATCH_PRECONDITION_KINDS = Object.freeze([
  'state',
  'approval',
  'evidence',
  'time-window',
  'idempotency',
] as const satisfies readonly ActionDispatchPreconditionKind[]);

function uniqueFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const present = new Set(reasons);
  return Object.freeze(ENFORCEMENT_FAILURE_REASONS.filter((reason) => present.has(reason)));
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Action-dispatch enforcement ${fieldName} requires a non-empty value.`);
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
    throw new Error('Action-dispatch enforcement now() must return a valid ISO timestamp.');
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

function normalizeActionValue(value: ActionDispatchValue, path: string): CanonicalReleaseJsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Action-dispatch enforcement cannot canonicalize non-finite number at ${path}.`,
      );
    }
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => normalizeActionValue(item, `${path}[${index}]`)),
    );
  }

  if (!isPlainObject(value)) {
    throw new Error(`Action-dispatch enforcement only accepts plain JSON values at ${path}.`);
  }

  return Object.freeze(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeActionValue(value[key], `${path}.${key}`)]),
    ) as { readonly [key: string]: CanonicalReleaseJsonValue },
  );
}

function normalizeActionType(actionType: ActionDispatchType): ActionDispatchType {
  if (!ACTION_DISPATCH_TYPES.includes(actionType)) {
    throw new Error(`Action-dispatch enforcement actionType is unsupported: ${actionType}`);
  }
  return actionType;
}

function normalizeTargetKind(
  action: ActionDispatchRequest,
  targetId: string,
): ActionDispatchTargetKind {
  if (action.targetKind !== undefined && action.targetKind !== null) {
    if (!ACTION_DISPATCH_TARGET_KINDS.includes(action.targetKind)) {
      throw new Error(`Action-dispatch enforcement targetKind is unsupported: ${action.targetKind}`);
    }
    return action.targetKind;
  }

  if (action.actionType === 'async-dispatch' || normalizeOptionalIdentifier(action.queueOrTopic)) {
    return 'queue';
  }
  if (action.actionType === 'http-call' || action.actionType === 'tool-call') {
    return 'endpoint';
  }
  if (targetId.includes('artifact')) {
    return 'artifact-registry';
  }
  return 'workflow';
}

function targetIdForAction(action: ActionDispatchRequest): string {
  const explicitTargetId = normalizeOptionalIdentifier(action.targetId);
  if (explicitTargetId) {
    return explicitTargetId;
  }

  const workflowId = normalizeOptionalIdentifier(action.workflowId);
  if (workflowId) {
    return `${workflowId}.dispatch`;
  }

  const queueOrTopic = normalizeOptionalIdentifier(action.queueOrTopic);
  if (queueOrTopic) {
    return queueOrTopic;
  }

  const toolName = normalizeOptionalIdentifier(action.toolName);
  if (toolName) {
    return toolName;
  }

  const resourceUri = normalizeOptionalIdentifier(action.resourceUri);
  if (resourceUri) {
    return resourceUri;
  }

  throw new Error(
    'Action-dispatch enforcement requires targetId, workflowId, queueOrTopic, toolName, or resourceUri.',
  );
}

function normalizeTraceparent(value: string | null | undefined): string | null {
  const traceparent = normalizeOptionalIdentifier(value);
  if (traceparent === null) {
    return null;
  }
  if (!/^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/u.test(traceparent)) {
    throw new Error('Action-dispatch enforcement traceparent must follow W3C Trace Context shape.');
  }
  return traceparent;
}

function normalizePrecondition(
  precondition: ActionDispatchPrecondition,
  index: number,
): Record<string, CanonicalReleaseJsonValue> {
  const kind = precondition.kind;
  if (!ACTION_DISPATCH_PRECONDITION_KINDS.includes(kind)) {
    throw new Error(`Action-dispatch enforcement precondition[${index}].kind is unsupported: ${kind}`);
  }
  return {
    preconditionId: normalizeIdentifier(
      precondition.preconditionId,
      `precondition[${index}].preconditionId`,
    ),
    kind,
    expected:
      precondition.expected === undefined || precondition.expected === null
        ? null
        : normalizeActionValue(precondition.expected, `$.preconditions[${index}].expected`),
    digest: normalizeOptionalIdentifier(precondition.digest),
  };
}

function normalizePreconditions(
  preconditions: readonly ActionDispatchPrecondition[] | undefined,
): readonly Record<string, CanonicalReleaseJsonValue>[] {
  const normalized = (preconditions ?? []).map((precondition, index) =>
    normalizePrecondition(precondition, index),
  );
  const seenIds = new Set<string>();
  for (const precondition of normalized) {
    const preconditionId = precondition.preconditionId as string;
    if (seenIds.has(preconditionId)) {
      throw new Error(
        `Action-dispatch enforcement duplicate precondition id is not allowed: ${preconditionId}.`,
      );
    }
    seenIds.add(preconditionId);
  }
  return Object.freeze(
    [...normalized].sort((left, right) =>
      (left.preconditionId as string).localeCompare(right.preconditionId as string),
    ),
  );
}

function normalizeAction(
  action: ActionDispatchRequest,
): Record<string, CanonicalReleaseJsonValue> {
  const actionType = normalizeActionType(action.actionType);
  const operation = normalizeIdentifier(action.operation, 'action.operation');
  const targetId = targetIdForAction(action);
  const targetKind = normalizeTargetKind(action, targetId);

  return {
    actionType,
    operation,
    targetId,
    targetKind,
    workflowId: normalizeOptionalIdentifier(action.workflowId),
    toolName: normalizeOptionalIdentifier(action.toolName),
    queueOrTopic: normalizeOptionalIdentifier(action.queueOrTopic),
    resourceUri: normalizeOptionalIdentifier(action.resourceUri),
    requestedTransition: normalizeOptionalIdentifier(action.requestedTransition),
    parameters:
      action.parameters === undefined || action.parameters === null
        ? null
        : normalizeActionValue(action.parameters, '$.parameters'),
    preconditions: normalizePreconditions(action.preconditions),
    dryRun: action.dryRun ?? false,
    reason: normalizeOptionalIdentifier(action.reason),
    idempotencyKey: normalizeOptionalIdentifier(action.idempotencyKey),
    actorId: normalizeOptionalIdentifier(action.actorId),
    traceparent: normalizeTraceparent(action.traceparent),
    tracestate: normalizeOptionalIdentifier(action.tracestate),
  };
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function actionTarget(action: ActionDispatchRequest): ReleaseTargetReference {
  const targetId = targetIdForAction(action);
  return Object.freeze({
    kind: normalizeTargetKind(action, targetId),
    id: targetId,
  });
}

function outputContract(riskClass: ReleaseEnforcementRiskClass): OutputContractDescriptor {
  return {
    artifactType: ACTION_DISPATCH_OUTPUT_ARTIFACT_TYPE,
    expectedShape: ACTION_DISPATCH_OUTPUT_EXPECTED_SHAPE,
    consequenceType: 'action',
    riskClass,
  };
}

function normalizeDispatchBaseUri(dispatchBaseUri?: string | null): string {
  const base = normalizeOptionalIdentifier(dispatchBaseUri) ?? ACTION_DISPATCH_DEFAULT_BASE_URI;
  const parsed = new URL(base);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/+$/u, '');
}

export function actionDispatchUri(
  targetId: string,
  dispatchBaseUri?: string | null,
): string {
  return `${normalizeDispatchBaseUri(dispatchBaseUri)}/${encodeURIComponent(
    normalizeIdentifier(targetId, 'targetId'),
  )}`;
}

export function buildActionDispatchCanonicalBinding(
  action: ActionDispatchRequest,
  options: ActionDispatchBindingOptions = {},
): ActionDispatchCanonicalBinding {
  const riskClass = options.riskClass ?? 'R3';
  const normalizedAction = normalizeAction(action);
  const target = actionTarget(action);
  const contract = outputContract(riskClass);
  const outputPayload = Object.freeze({
    actionDispatch: normalizedAction,
  } satisfies Record<string, CanonicalReleaseJsonValue>);
  const consequencePayload = Object.freeze({
    operation: normalizedAction.operation,
    actionType: normalizedAction.actionType,
    targetId: target.id,
    actionDispatch: normalizedAction,
  } satisfies Record<string, CanonicalReleaseJsonValue>);
  const hashBundle = createCanonicalReleaseHashBundle({
    outputContract: contract,
    target,
    outputPayload,
    consequencePayload,
    idempotencyKey: normalizeOptionalIdentifier(action.idempotencyKey) ?? undefined,
  });
  const dispatchCanonical = canonicalizeReleaseJson(normalizedAction);

  return Object.freeze({
    version: RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION,
    target,
    outputContract: contract,
    outputPayload,
    consequencePayload,
    hashBundle,
    dispatchCanonical,
    dispatchHash: sha256(dispatchCanonical),
    httpMethod: ACTION_DISPATCH_HTTP_METHOD,
    dispatchUri: actionDispatchUri(target.id, options.dispatchBaseUri),
  });
}

function createActionEnforcementPoint(
  options: ActionDispatchGatewayOptions,
  binding: ActionDispatchCanonicalBinding,
): CreateEnforcementPointReferenceInput {
  return {
    environment: options.environment,
    enforcementPointId: options.enforcementPointId,
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    consequenceType: 'action',
    riskClass: binding.outputContract.riskClass,
    tenantId: options.tenantId,
    accountId: options.accountId,
    workloadId: options.workloadId,
    audience: binding.target.id,
  };
}

function actionHeadersDigest(input: {
  readonly binding: ActionDispatchCanonicalBinding;
  readonly authorization: ActionDispatchReleaseAuthorization;
}): string {
  return sha256(canonicalizeReleaseJson({
    targetId: input.binding.target.id,
    outputHash: input.binding.hashBundle.outputHash,
    consequenceHash: input.binding.hashBundle.consequenceHash,
    releaseTokenId: normalizeOptionalIdentifier(input.authorization.releaseTokenId),
    releaseDecisionId: normalizeOptionalIdentifier(input.authorization.releaseDecisionId),
  }));
}

function createActionDispatchRequest(input: {
  readonly checkedAt: string;
  readonly binding: ActionDispatchCanonicalBinding;
  readonly action: ActionDispatchRequest;
  readonly authorization: ActionDispatchReleaseAuthorization;
  readonly options: ActionDispatchGatewayOptions;
}): EnforcementRequest {
  return createEnforcementRequest({
    id: input.options.requestId ?? `erq_action_dispatch_${randomUUID()}`,
    receivedAt: input.checkedAt,
    enforcementPoint: createActionEnforcementPoint(input.options, input.binding),
    targetId: input.binding.target.id,
    outputHash: input.binding.hashBundle.outputHash,
    consequenceHash: input.binding.hashBundle.consequenceHash,
    releaseTokenId: normalizeOptionalIdentifier(input.authorization.releaseTokenId),
    releaseDecisionId: normalizeOptionalIdentifier(input.authorization.releaseDecisionId),
    traceId:
      normalizeOptionalIdentifier(input.options.traceId) ??
      normalizeOptionalIdentifier(input.action.traceparent),
    idempotencyKey: normalizeOptionalIdentifier(input.action.idempotencyKey),
    transport: {
      kind: 'http',
      method: input.binding.httpMethod,
      uri: input.binding.dispatchUri,
      headersDigest: actionHeadersDigest({
        binding: input.binding,
        authorization: input.authorization,
      }),
      bodyDigest: input.binding.dispatchHash,
    },
  });
}

function createActionDispatchPresentation(
  authorization: ActionDispatchReleaseAuthorization,
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
  return mode === 'dpop-bound-token' ||
    mode === 'mtls-bound-token' ||
    mode === 'spiffe-bound-token'
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
    id: `ed_action_dispatch_${input.request.id}`,
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
    id: `er_action_dispatch_${input.request.id}`,
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
  readonly binding: ActionDispatchCanonicalBinding;
  readonly failureReasons: readonly EnforcementFailureReason[];
}): ActionDispatchGatewayResult {
  const failureReasons = uniqueFailureReasons(input.failureReasons);
  return Object.freeze({
    version: RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION,
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
  readonly binding: ActionDispatchCanonicalBinding;
  readonly request: EnforcementRequest;
  readonly presentation: ReleasePresentation;
  readonly offline: OfflineReleaseVerification | null;
  readonly online: OnlineReleaseVerification | null;
}): ActionDispatchGatewayResult {
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
    version: RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION,
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

export async function enforceActionDispatch(
  input: ActionDispatchGatewayInput,
): Promise<ActionDispatchGatewayResult> {
  const checkedAt = normalizeIsoTimestamp(input.options.now?.() ?? new Date().toISOString());
  const binding = buildActionDispatchCanonicalBinding(input.action, {
    riskClass: input.options.riskClass,
    dispatchBaseUri: input.options.dispatchBaseUri,
  });
  const authorization = input.authorization ?? null;

  if (!authorization?.releaseToken) {
    return deniedEarlyResult({
      checkedAt,
      binding,
      failureReasons: ['missing-release-authorization'],
    });
  }

  const request = createActionDispatchRequest({
    checkedAt,
    binding,
    action: input.action,
    authorization,
    options: input.options,
  });
  const presentation = createActionDispatchPresentation(authorization, checkedAt);
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
      replayLedgerEntry: input.options.replayLedgerEntry,
      nonceLedgerEntry: input.options.nonceLedgerEntry,
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
      version: RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION,
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
  });
}
