import { vocabulary } from '../release-layer/index.js';

/**
 * Shared vocabulary for Attestor's release enforcement plane.
 *
 * Step 01 intentionally stops at the language layer: it defines the stable
 * nouns that later verifier cores, sender-constrained presentations, proxy
 * bridges, webhook receivers, and consequence-specific gateways will build on.
 */

export const RELEASE_ENFORCEMENT_PLANE_SPEC_VERSION =
  'attestor.release-enforcement-plane.v1';

export const ENFORCEMENT_POINT_KINDS = [
  'application-middleware',
  'webhook-receiver',
  'async-consumer',
  'record-write-gateway',
  'communication-send-gateway',
  'action-dispatch-gateway',
  'proxy-ext-authz',
  'artifact-verifier',
] as const;
export type EnforcementPointKind = typeof ENFORCEMENT_POINT_KINDS[number];

export const ENFORCEMENT_BOUNDARY_KINDS = [
  'http-request',
  'webhook',
  'async-message',
  'record-write',
  'communication-send',
  'action-dispatch',
  'proxy-admission',
  'artifact-export',
] as const;
export type EnforcementBoundaryKind = typeof ENFORCEMENT_BOUNDARY_KINDS[number];

export const ENFORCEMENT_VERIFICATION_MODES = [
  'offline-signature',
  'online-introspection',
  'hybrid-required',
  'shadow-observe',
] as const;
export type EnforcementVerificationMode =
  typeof ENFORCEMENT_VERIFICATION_MODES[number];

export const RELEASE_PRESENTATION_MODES = [
  'bearer-release-token',
  'dpop-bound-token',
  'mtls-bound-token',
  'spiffe-bound-token',
  'http-message-signature',
  'signed-json-envelope',
] as const;
export type ReleasePresentationMode = typeof RELEASE_PRESENTATION_MODES[number];

export const ENFORCEMENT_CACHE_STATES = [
  'fresh',
  'stale-allowed',
  'stale-denied',
  'miss',
  'negative-hit',
] as const;
export type EnforcementCacheState = typeof ENFORCEMENT_CACHE_STATES[number];

export const ENFORCEMENT_DEGRADED_STATES = [
  'normal',
  'cache-only',
  'introspection-unavailable',
  'fail-closed',
  'break-glass-open',
] as const;
export type EnforcementDegradedState = typeof ENFORCEMENT_DEGRADED_STATES[number];

export const ENFORCEMENT_BREAK_GLASS_REASONS = [
  'incident-response',
  'availability-restore',
  'customer-approved-emergency',
  'regulatory-deadline',
  'control-plane-recovery',
] as const;
export type EnforcementBreakGlassReason =
  typeof ENFORCEMENT_BREAK_GLASS_REASONS[number];

export const ENFORCEMENT_OUTCOMES = [
  'allow',
  'deny',
  'shadow-allow',
  'needs-introspection',
  'break-glass-allow',
] as const;
export type EnforcementOutcome = typeof ENFORCEMENT_OUTCOMES[number];

export const ENFORCEMENT_FAILURE_REASONS = [
  'missing-release-authorization',
  'invalid-signature',
  'expired-authorization',
  'not-yet-valid-authorization',
  'future-issued-at',
  'stale-authorization',
  'revoked-authorization',
  'unknown-authorization',
  'replayed-authorization',
  'missing-replay-proof',
  'negative-cache-hit',
  'fresh-introspection-required',
  'unsupported-token-type',
  'introspection-claim-mismatch',
  'missing-nonce',
  'invalid-nonce',
  'wrong-audience',
  'wrong-consequence',
  'binding-mismatch',
  'stale-policy',
  'introspection-unavailable',
  'policy-frozen',
  'break-glass-required',
] as const;
export type EnforcementFailureReason =
  typeof ENFORCEMENT_FAILURE_REASONS[number];

export type ReleaseEnforcementConsequenceType =
  (typeof vocabulary.CONSEQUENCE_TYPES)[number];
export type ReleaseEnforcementRiskClass = (typeof vocabulary.RISK_CLASSES)[number];

export type EnforcementDefaultPosture =
  | 'allow-on-valid'
  | 'shadow-only'
  | 'fail-closed';

export interface EnforcementPointProfile {
  readonly kind: EnforcementPointKind;
  readonly label: string;
  readonly supportedBoundaryKinds: readonly EnforcementBoundaryKind[];
  readonly defaultVerificationModes: readonly EnforcementVerificationMode[];
  readonly defaultPresentationModes: readonly ReleasePresentationMode[];
  readonly defaultPosture: EnforcementDefaultPosture;
}

export interface EnforcementBoundaryProfile {
  readonly kind: EnforcementBoundaryKind;
  readonly label: string;
  readonly defaultConsequenceType: ReleaseEnforcementConsequenceType;
  readonly defaultVerificationModes: readonly EnforcementVerificationMode[];
  readonly supportedPointKinds: readonly EnforcementPointKind[];
}

export const ENFORCEMENT_POINT_PROFILES: Record<
  EnforcementPointKind,
  EnforcementPointProfile
> = {
  'application-middleware': {
    kind: 'application-middleware',
    label: 'Application Middleware',
    supportedBoundaryKinds: ['http-request', 'record-write', 'communication-send', 'action-dispatch'],
    defaultVerificationModes: ['offline-signature', 'online-introspection'],
    defaultPresentationModes: ['bearer-release-token', 'dpop-bound-token'],
    defaultPosture: 'fail-closed',
  },
  'webhook-receiver': {
    kind: 'webhook-receiver',
    label: 'Webhook Receiver',
    supportedBoundaryKinds: ['webhook'],
    defaultVerificationModes: ['hybrid-required'],
    defaultPresentationModes: ['http-message-signature', 'bearer-release-token'],
    defaultPosture: 'fail-closed',
  },
  'async-consumer': {
    kind: 'async-consumer',
    label: 'Async Consumer',
    supportedBoundaryKinds: ['async-message'],
    defaultVerificationModes: ['offline-signature', 'online-introspection'],
    defaultPresentationModes: ['signed-json-envelope'],
    defaultPosture: 'fail-closed',
  },
  'record-write-gateway': {
    kind: 'record-write-gateway',
    label: 'Record Write Gateway',
    supportedBoundaryKinds: ['record-write'],
    defaultVerificationModes: ['hybrid-required'],
    defaultPresentationModes: ['bearer-release-token', 'mtls-bound-token', 'spiffe-bound-token'],
    defaultPosture: 'fail-closed',
  },
  'communication-send-gateway': {
    kind: 'communication-send-gateway',
    label: 'Communication Send Gateway',
    supportedBoundaryKinds: ['communication-send'],
    defaultVerificationModes: ['hybrid-required'],
    defaultPresentationModes: ['bearer-release-token', 'dpop-bound-token', 'http-message-signature'],
    defaultPosture: 'fail-closed',
  },
  'action-dispatch-gateway': {
    kind: 'action-dispatch-gateway',
    label: 'Action Dispatch Gateway',
    supportedBoundaryKinds: ['action-dispatch'],
    defaultVerificationModes: ['hybrid-required'],
    defaultPresentationModes: ['dpop-bound-token', 'mtls-bound-token', 'spiffe-bound-token'],
    defaultPosture: 'fail-closed',
  },
  'proxy-ext-authz': {
    kind: 'proxy-ext-authz',
    label: 'Proxy External Authorization',
    supportedBoundaryKinds: ['proxy-admission', 'http-request'],
    defaultVerificationModes: ['online-introspection', 'hybrid-required'],
    defaultPresentationModes: ['bearer-release-token', 'dpop-bound-token', 'mtls-bound-token'],
    defaultPosture: 'fail-closed',
  },
  'artifact-verifier': {
    kind: 'artifact-verifier',
    label: 'Artifact Verifier',
    supportedBoundaryKinds: ['artifact-export'],
    defaultVerificationModes: ['offline-signature'],
    defaultPresentationModes: ['signed-json-envelope'],
    defaultPosture: 'allow-on-valid',
  },
};

export const ENFORCEMENT_BOUNDARY_PROFILES: Record<
  EnforcementBoundaryKind,
  EnforcementBoundaryProfile
> = {
  'http-request': {
    kind: 'http-request',
    label: 'HTTP Request',
    defaultConsequenceType: 'decision-support',
    defaultVerificationModes: ['offline-signature'],
    supportedPointKinds: ['application-middleware', 'proxy-ext-authz'],
  },
  webhook: {
    kind: 'webhook',
    label: 'Webhook',
    defaultConsequenceType: 'action',
    defaultVerificationModes: ['hybrid-required'],
    supportedPointKinds: ['webhook-receiver'],
  },
  'async-message': {
    kind: 'async-message',
    label: 'Async Message',
    defaultConsequenceType: 'action',
    defaultVerificationModes: ['offline-signature', 'online-introspection'],
    supportedPointKinds: ['async-consumer'],
  },
  'record-write': {
    kind: 'record-write',
    label: 'Record Write',
    defaultConsequenceType: 'record',
    defaultVerificationModes: ['hybrid-required'],
    supportedPointKinds: ['application-middleware', 'record-write-gateway'],
  },
  'communication-send': {
    kind: 'communication-send',
    label: 'Communication Send',
    defaultConsequenceType: 'communication',
    defaultVerificationModes: ['hybrid-required'],
    supportedPointKinds: ['application-middleware', 'communication-send-gateway'],
  },
  'action-dispatch': {
    kind: 'action-dispatch',
    label: 'Action Dispatch',
    defaultConsequenceType: 'action',
    defaultVerificationModes: ['hybrid-required'],
    supportedPointKinds: ['application-middleware', 'action-dispatch-gateway'],
  },
  'proxy-admission': {
    kind: 'proxy-admission',
    label: 'Proxy Admission',
    defaultConsequenceType: 'decision-support',
    defaultVerificationModes: ['online-introspection', 'hybrid-required'],
    supportedPointKinds: ['proxy-ext-authz'],
  },
  'artifact-export': {
    kind: 'artifact-export',
    label: 'Artifact Export',
    defaultConsequenceType: 'record',
    defaultVerificationModes: ['offline-signature'],
    supportedPointKinds: ['artifact-verifier'],
  },
};

export interface EnforcementPointReference {
  readonly environment: string;
  readonly enforcementPointId: string;
  readonly pointKind: EnforcementPointKind;
  readonly boundaryKind: EnforcementBoundaryKind;
  readonly consequenceType: ReleaseEnforcementConsequenceType;
  readonly riskClass: ReleaseEnforcementRiskClass;
  readonly tenantId: string | null;
  readonly accountId: string | null;
  readonly workloadId: string | null;
  readonly audience: string | null;
}

export interface CreateEnforcementPointReferenceInput {
  readonly environment: string;
  readonly enforcementPointId: string;
  readonly pointKind: EnforcementPointKind;
  readonly boundaryKind: EnforcementBoundaryKind;
  readonly consequenceType: ReleaseEnforcementConsequenceType;
  readonly riskClass: ReleaseEnforcementRiskClass;
  readonly tenantId?: string | null;
  readonly accountId?: string | null;
  readonly workloadId?: string | null;
  readonly audience?: string | null;
}

export interface ReleaseEnforcementPlaneDescriptor {
  readonly version: typeof RELEASE_ENFORCEMENT_PLANE_SPEC_VERSION;
  readonly enforcementPointKinds: readonly EnforcementPointKind[];
  readonly boundaryKinds: readonly EnforcementBoundaryKind[];
  readonly verificationModes: readonly EnforcementVerificationMode[];
  readonly presentationModes: readonly ReleasePresentationMode[];
  readonly cacheStates: readonly EnforcementCacheState[];
  readonly degradedStates: readonly EnforcementDegradedState[];
  readonly breakGlassReasons: readonly EnforcementBreakGlassReason[];
  readonly outcomes: readonly EnforcementOutcome[];
  readonly failureReasons: readonly EnforcementFailureReason[];
}

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

function normalizeIdentifier(
  value: string,
  fieldName: string,
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Release enforcement-plane ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Release enforcement-plane ${fieldName} cannot be blank when provided.`);
  }

  return normalized;
}

export function isEnforcementPointKind(value: string): value is EnforcementPointKind {
  return includesValue(ENFORCEMENT_POINT_KINDS, value);
}

export function isEnforcementBoundaryKind(value: string): value is EnforcementBoundaryKind {
  return includesValue(ENFORCEMENT_BOUNDARY_KINDS, value);
}

export function isEnforcementVerificationMode(
  value: string,
): value is EnforcementVerificationMode {
  return includesValue(ENFORCEMENT_VERIFICATION_MODES, value);
}

export function isReleasePresentationMode(value: string): value is ReleasePresentationMode {
  return includesValue(RELEASE_PRESENTATION_MODES, value);
}

export function isEnforcementCacheState(value: string): value is EnforcementCacheState {
  return includesValue(ENFORCEMENT_CACHE_STATES, value);
}

export function isEnforcementDegradedState(value: string): value is EnforcementDegradedState {
  return includesValue(ENFORCEMENT_DEGRADED_STATES, value);
}

export function isEnforcementBreakGlassReason(
  value: string,
): value is EnforcementBreakGlassReason {
  return includesValue(ENFORCEMENT_BREAK_GLASS_REASONS, value);
}

export function isEnforcementFailureReason(value: string): value is EnforcementFailureReason {
  return includesValue(ENFORCEMENT_FAILURE_REASONS, value);
}

export function enforcementPointSupportsBoundary(
  pointKind: EnforcementPointKind,
  boundaryKind: EnforcementBoundaryKind,
): boolean {
  return ENFORCEMENT_POINT_PROFILES[pointKind].supportedBoundaryKinds.includes(boundaryKind);
}

export function createEnforcementPointReference(
  input: CreateEnforcementPointReferenceInput,
): EnforcementPointReference {
  if (!enforcementPointSupportsBoundary(input.pointKind, input.boundaryKind)) {
    throw new Error(
      `Release enforcement-plane point kind ${input.pointKind} does not support ${input.boundaryKind} boundaries.`,
    );
  }

  if (input.accountId !== undefined && input.accountId !== null && input.tenantId == null) {
    throw new Error(
      'Release enforcement-plane account-scoped enforcement point also requires tenant scope.',
    );
  }

  return Object.freeze({
    environment: normalizeIdentifier(input.environment, 'environment'),
    enforcementPointId: normalizeIdentifier(input.enforcementPointId, 'enforcementPointId'),
    pointKind: input.pointKind,
    boundaryKind: input.boundaryKind,
    consequenceType: input.consequenceType,
    riskClass: input.riskClass,
    tenantId: normalizeOptionalIdentifier(input.tenantId, 'tenantId'),
    accountId: normalizeOptionalIdentifier(input.accountId, 'accountId'),
    workloadId: normalizeOptionalIdentifier(input.workloadId, 'workloadId'),
    audience: normalizeOptionalIdentifier(input.audience, 'audience'),
  });
}

export function enforcementPointReferenceLabel(
  reference: EnforcementPointReference,
): string {
  const segments = [
    `env:${reference.environment}`,
    `point:${reference.enforcementPointId}`,
    `kind:${reference.pointKind}`,
    `boundary:${reference.boundaryKind}`,
    `consequence:${reference.consequenceType}`,
    `risk:${reference.riskClass}`,
  ];

  if (reference.tenantId) {
    segments.push(`tenant:${reference.tenantId}`);
  }
  if (reference.accountId) {
    segments.push(`account:${reference.accountId}`);
  }
  if (reference.workloadId) {
    segments.push(`workload:${reference.workloadId}`);
  }
  if (reference.audience) {
    segments.push(`aud:${reference.audience}`);
  }

  return segments.join(' / ');
}

export function releaseEnforcementPlaneDescriptor(): ReleaseEnforcementPlaneDescriptor {
  return Object.freeze({
    version: RELEASE_ENFORCEMENT_PLANE_SPEC_VERSION,
    enforcementPointKinds: ENFORCEMENT_POINT_KINDS,
    boundaryKinds: ENFORCEMENT_BOUNDARY_KINDS,
    verificationModes: ENFORCEMENT_VERIFICATION_MODES,
    presentationModes: RELEASE_PRESENTATION_MODES,
    cacheStates: ENFORCEMENT_CACHE_STATES,
    degradedStates: ENFORCEMENT_DEGRADED_STATES,
    breakGlassReasons: ENFORCEMENT_BREAK_GLASS_REASONS,
    outcomes: ENFORCEMENT_OUTCOMES,
    failureReasons: ENFORCEMENT_FAILURE_REASONS,
  });
}
