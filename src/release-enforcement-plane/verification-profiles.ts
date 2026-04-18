import {
  ENFORCEMENT_VERIFICATION_MODES,
  RELEASE_PRESENTATION_MODES,
  type EnforcementBoundaryKind,
  type EnforcementVerificationMode,
  type ReleaseEnforcementConsequenceType,
  type ReleaseEnforcementRiskClass,
  type ReleasePresentationMode,
} from './types.js';

/**
 * Verification-profile matrix for Attestor enforcement points.
 *
 * Step 03 freezes how consequence type, risk class, and boundary kind map to
 * verification posture before the verifier implementation exists. This keeps
 * middleware, proxy bridges, webhooks, and domain gateways from inventing
 * separate allow/deny heuristics later.
 */

export const VERIFICATION_PROFILE_MATRIX_SPEC_VERSION =
  'attestor.verification-profile-matrix.v1';

export type SenderConstraintRequirement =
  | 'none'
  | 'recommended'
  | 'required'
  | 'not-applicable';

export type EnforcementOverridePosture =
  | 'not-allowed'
  | 'named-break-glass'
  | 'dual-break-glass';

export interface VerificationCacheBudget {
  readonly positiveTtlSeconds: number;
  readonly negativeTtlSeconds: number;
  readonly staleIfErrorSeconds: number;
  readonly requireFreshOnlineCheck: boolean;
}

export interface RiskVerificationBaseline {
  readonly riskClass: ReleaseEnforcementRiskClass;
  readonly verificationModes: readonly EnforcementVerificationMode[];
  readonly onlineIntrospectionRequired: boolean;
  readonly senderConstraint: SenderConstraintRequirement;
  readonly replayProtectionRequired: boolean;
  readonly cacheBudget: VerificationCacheBudget;
  readonly overridePosture: EnforcementOverridePosture;
  readonly failClosed: boolean;
}

export interface BoundaryVerificationBaseline {
  readonly boundaryKind: EnforcementBoundaryKind;
  readonly supportedConsequenceTypes: readonly ReleaseEnforcementConsequenceType[];
  readonly verificationModes: readonly EnforcementVerificationMode[];
  readonly allowedPresentationModes: readonly ReleasePresentationMode[];
  readonly senderConstraint: SenderConstraintRequirement;
  readonly replayProtectionRequired: boolean;
  readonly cacheBudget: VerificationCacheBudget;
  readonly failClosed: boolean;
}

export interface VerificationProfileResolutionInput {
  readonly consequenceType: ReleaseEnforcementConsequenceType;
  readonly riskClass: ReleaseEnforcementRiskClass;
  readonly boundaryKind: EnforcementBoundaryKind;
}

export interface VerificationProfile {
  readonly version: typeof VERIFICATION_PROFILE_MATRIX_SPEC_VERSION;
  readonly id: string;
  readonly consequenceType: ReleaseEnforcementConsequenceType;
  readonly riskClass: ReleaseEnforcementRiskClass;
  readonly boundaryKind: EnforcementBoundaryKind;
  readonly verificationModes: readonly EnforcementVerificationMode[];
  readonly onlineIntrospectionRequired: boolean;
  readonly allowedPresentationModes: readonly ReleasePresentationMode[];
  readonly senderConstrainedPresentationModes: readonly ReleasePresentationMode[];
  readonly senderConstraint: SenderConstraintRequirement;
  readonly replayProtectionRequired: boolean;
  readonly cacheBudget: VerificationCacheBudget;
  readonly overridePosture: EnforcementOverridePosture;
  readonly failClosed: boolean;
}

export interface VerificationProfileMatrixDescriptor {
  readonly version: typeof VERIFICATION_PROFILE_MATRIX_SPEC_VERSION;
  readonly riskBaselines: readonly ReleaseEnforcementRiskClass[];
  readonly boundaryBaselines: readonly EnforcementBoundaryKind[];
  readonly senderConstrainedPresentationModes: readonly ReleasePresentationMode[];
}

export const SENDER_CONSTRAINED_PRESENTATION_MODES = Object.freeze([
  'dpop-bound-token',
  'mtls-bound-token',
  'spiffe-bound-token',
  'http-message-signature',
] as const satisfies readonly ReleasePresentationMode[]);

export const RISK_VERIFICATION_BASELINES: Record<
  ReleaseEnforcementRiskClass,
  RiskVerificationBaseline
> = Object.freeze({
  R0: Object.freeze({
    riskClass: 'R0',
    verificationModes: ['shadow-observe'] as const,
    onlineIntrospectionRequired: false,
    senderConstraint: 'none',
    replayProtectionRequired: false,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 300,
      negativeTtlSeconds: 60,
      staleIfErrorSeconds: 300,
      requireFreshOnlineCheck: false,
    }),
    overridePosture: 'not-allowed',
    failClosed: false,
  }),
  R1: Object.freeze({
    riskClass: 'R1',
    verificationModes: ['offline-signature'] as const,
    onlineIntrospectionRequired: false,
    senderConstraint: 'none',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 120,
      negativeTtlSeconds: 30,
      staleIfErrorSeconds: 60,
      requireFreshOnlineCheck: false,
    }),
    overridePosture: 'not-allowed',
    failClosed: true,
  }),
  R2: Object.freeze({
    riskClass: 'R2',
    verificationModes: ['offline-signature', 'online-introspection'] as const,
    onlineIntrospectionRequired: true,
    senderConstraint: 'recommended',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 60,
      negativeTtlSeconds: 15,
      staleIfErrorSeconds: 30,
      requireFreshOnlineCheck: false,
    }),
    overridePosture: 'named-break-glass',
    failClosed: true,
  }),
  R3: Object.freeze({
    riskClass: 'R3',
    verificationModes: ['hybrid-required'] as const,
    onlineIntrospectionRequired: true,
    senderConstraint: 'required',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 15,
      negativeTtlSeconds: 5,
      staleIfErrorSeconds: 0,
      requireFreshOnlineCheck: true,
    }),
    overridePosture: 'named-break-glass',
    failClosed: true,
  }),
  R4: Object.freeze({
    riskClass: 'R4',
    verificationModes: ['hybrid-required'] as const,
    onlineIntrospectionRequired: true,
    senderConstraint: 'required',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 0,
      negativeTtlSeconds: 0,
      staleIfErrorSeconds: 0,
      requireFreshOnlineCheck: true,
    }),
    overridePosture: 'dual-break-glass',
    failClosed: true,
  }),
});

export const BOUNDARY_VERIFICATION_BASELINES: Record<
  EnforcementBoundaryKind,
  BoundaryVerificationBaseline
> = Object.freeze({
  'http-request': Object.freeze({
    boundaryKind: 'http-request',
    supportedConsequenceTypes: ['communication', 'record', 'action', 'decision-support'] as const,
    verificationModes: ['offline-signature'] as const,
    allowedPresentationModes: ['bearer-release-token', 'dpop-bound-token', 'http-message-signature'] as const,
    senderConstraint: 'recommended',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 60,
      negativeTtlSeconds: 15,
      staleIfErrorSeconds: 30,
      requireFreshOnlineCheck: false,
    }),
    failClosed: true,
  }),
  webhook: Object.freeze({
    boundaryKind: 'webhook',
    supportedConsequenceTypes: ['communication', 'record', 'action'] as const,
    verificationModes: ['hybrid-required'] as const,
    allowedPresentationModes: [
      'bearer-release-token',
      'dpop-bound-token',
      'http-message-signature',
    ] as const,
    senderConstraint: 'required',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 15,
      negativeTtlSeconds: 5,
      staleIfErrorSeconds: 0,
      requireFreshOnlineCheck: true,
    }),
    failClosed: true,
  }),
  'async-message': Object.freeze({
    boundaryKind: 'async-message',
    supportedConsequenceTypes: ['communication', 'record', 'action'] as const,
    verificationModes: ['offline-signature', 'online-introspection'] as const,
    allowedPresentationModes: [
      'signed-json-envelope',
      'spiffe-bound-token',
      'mtls-bound-token',
    ] as const,
    senderConstraint: 'recommended',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 60,
      negativeTtlSeconds: 15,
      staleIfErrorSeconds: 30,
      requireFreshOnlineCheck: false,
    }),
    failClosed: true,
  }),
  'record-write': Object.freeze({
    boundaryKind: 'record-write',
    supportedConsequenceTypes: ['record'] as const,
    verificationModes: ['hybrid-required'] as const,
    allowedPresentationModes: [
      'bearer-release-token',
      'dpop-bound-token',
      'mtls-bound-token',
      'spiffe-bound-token',
    ] as const,
    senderConstraint: 'required',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 15,
      negativeTtlSeconds: 5,
      staleIfErrorSeconds: 0,
      requireFreshOnlineCheck: true,
    }),
    failClosed: true,
  }),
  'communication-send': Object.freeze({
    boundaryKind: 'communication-send',
    supportedConsequenceTypes: ['communication'] as const,
    verificationModes: ['hybrid-required'] as const,
    allowedPresentationModes: [
      'bearer-release-token',
      'dpop-bound-token',
      'http-message-signature',
    ] as const,
    senderConstraint: 'required',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 15,
      negativeTtlSeconds: 5,
      staleIfErrorSeconds: 0,
      requireFreshOnlineCheck: true,
    }),
    failClosed: true,
  }),
  'action-dispatch': Object.freeze({
    boundaryKind: 'action-dispatch',
    supportedConsequenceTypes: ['action'] as const,
    verificationModes: ['hybrid-required'] as const,
    allowedPresentationModes: ['dpop-bound-token', 'mtls-bound-token', 'spiffe-bound-token'] as const,
    senderConstraint: 'required',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 0,
      negativeTtlSeconds: 0,
      staleIfErrorSeconds: 0,
      requireFreshOnlineCheck: true,
    }),
    failClosed: true,
  }),
  'proxy-admission': Object.freeze({
    boundaryKind: 'proxy-admission',
    supportedConsequenceTypes: ['communication', 'record', 'action', 'decision-support'] as const,
    verificationModes: ['online-introspection', 'hybrid-required'] as const,
    allowedPresentationModes: [
      'bearer-release-token',
      'dpop-bound-token',
      'mtls-bound-token',
      'spiffe-bound-token',
    ] as const,
    senderConstraint: 'recommended',
    replayProtectionRequired: true,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 10,
      negativeTtlSeconds: 5,
      staleIfErrorSeconds: 0,
      requireFreshOnlineCheck: true,
    }),
    failClosed: true,
  }),
  'artifact-export': Object.freeze({
    boundaryKind: 'artifact-export',
    supportedConsequenceTypes: ['record', 'decision-support'] as const,
    verificationModes: ['offline-signature'] as const,
    allowedPresentationModes: ['signed-json-envelope', 'http-message-signature'] as const,
    senderConstraint: 'not-applicable',
    replayProtectionRequired: false,
    cacheBudget: Object.freeze({
      positiveTtlSeconds: 300,
      negativeTtlSeconds: 60,
      staleIfErrorSeconds: 300,
      requireFreshOnlineCheck: false,
    }),
    failClosed: false,
  }),
});

const SENDER_CONSTRAINT_ORDER: Record<SenderConstraintRequirement, number> = {
  'not-applicable': -1,
  none: 0,
  recommended: 1,
  required: 2,
};

function sortedVerificationModes(
  modes: readonly EnforcementVerificationMode[],
): readonly EnforcementVerificationMode[] {
  return Object.freeze(
    ENFORCEMENT_VERIFICATION_MODES.filter((mode) => modes.includes(mode)),
  );
}

function sortedPresentationModes(
  modes: readonly ReleasePresentationMode[],
): readonly ReleasePresentationMode[] {
  return Object.freeze(
    RELEASE_PRESENTATION_MODES.filter((mode) => modes.includes(mode)),
  );
}

function mergeVerificationModes(
  left: readonly EnforcementVerificationMode[],
  right: readonly EnforcementVerificationMode[],
): readonly EnforcementVerificationMode[] {
  const union = new Set([...left, ...right]);
  if (union.has('hybrid-required')) {
    return Object.freeze(['hybrid-required']);
  }
  return sortedVerificationModes([...union]);
}

function senderConstraintMode(
  risk: SenderConstraintRequirement,
  boundary: SenderConstraintRequirement,
): SenderConstraintRequirement {
  if (boundary === 'not-applicable') {
    return 'not-applicable';
  }
  return SENDER_CONSTRAINT_ORDER[risk] >= SENDER_CONSTRAINT_ORDER[boundary]
    ? risk
    : boundary;
}

function senderConstrainedModes(
  allowedPresentationModes: readonly ReleasePresentationMode[],
): readonly ReleasePresentationMode[] {
  const allowed = new Set(allowedPresentationModes);
  return Object.freeze(
    SENDER_CONSTRAINED_PRESENTATION_MODES.filter((mode) => allowed.has(mode)),
  );
}

function mergeCacheBudget(
  risk: VerificationCacheBudget,
  boundary: VerificationCacheBudget,
): VerificationCacheBudget {
  return Object.freeze({
    positiveTtlSeconds: Math.min(risk.positiveTtlSeconds, boundary.positiveTtlSeconds),
    negativeTtlSeconds: Math.min(risk.negativeTtlSeconds, boundary.negativeTtlSeconds),
    staleIfErrorSeconds: Math.min(risk.staleIfErrorSeconds, boundary.staleIfErrorSeconds),
    requireFreshOnlineCheck: risk.requireFreshOnlineCheck || boundary.requireFreshOnlineCheck,
  });
}

function verificationProfileId(input: VerificationProfileResolutionInput): string {
  return [
    'verification-profile',
    input.consequenceType,
    input.riskClass,
    input.boundaryKind,
  ].join(':');
}

function assertBoundarySupportsConsequence(
  boundary: BoundaryVerificationBaseline,
  consequenceType: ReleaseEnforcementConsequenceType,
): void {
  if (!boundary.supportedConsequenceTypes.includes(consequenceType)) {
    throw new Error(
      `Release enforcement-plane ${boundary.boundaryKind} boundary does not support ${consequenceType} consequence.`,
    );
  }
}

export function resolveVerificationProfile(
  input: VerificationProfileResolutionInput,
): VerificationProfile {
  const risk = RISK_VERIFICATION_BASELINES[input.riskClass];
  const boundary = BOUNDARY_VERIFICATION_BASELINES[input.boundaryKind];
  assertBoundarySupportsConsequence(boundary, input.consequenceType);

  const verificationModes = mergeVerificationModes(
    risk.verificationModes,
    boundary.verificationModes,
  );
  const allowedPresentationModes = sortedPresentationModes(boundary.allowedPresentationModes);
  const senderConstraint = senderConstraintMode(
    risk.senderConstraint,
    boundary.senderConstraint,
  );
  const constrainedModes = senderConstrainedModes(allowedPresentationModes);

  if (senderConstraint === 'required' && constrainedModes.length === 0) {
    throw new Error(
      'Release enforcement-plane sender-constrained profile has no sender-constrained presentation mode.',
    );
  }

  const cacheBudget = mergeCacheBudget(risk.cacheBudget, boundary.cacheBudget);
  const onlineIntrospectionRequired =
    risk.onlineIntrospectionRequired ||
    boundary.verificationModes.includes('online-introspection') ||
    boundary.verificationModes.includes('hybrid-required') ||
    verificationModes.includes('hybrid-required') ||
    cacheBudget.requireFreshOnlineCheck;

  return Object.freeze({
    version: VERIFICATION_PROFILE_MATRIX_SPEC_VERSION,
    id: verificationProfileId(input),
    consequenceType: input.consequenceType,
    riskClass: input.riskClass,
    boundaryKind: input.boundaryKind,
    verificationModes,
    onlineIntrospectionRequired,
    allowedPresentationModes,
    senderConstrainedPresentationModes: constrainedModes,
    senderConstraint,
    replayProtectionRequired:
      risk.replayProtectionRequired || boundary.replayProtectionRequired,
    cacheBudget,
    overridePosture: risk.overridePosture,
    failClosed: risk.failClosed || boundary.failClosed,
  });
}

export function verificationProfileMatrixDescriptor(): VerificationProfileMatrixDescriptor {
  return Object.freeze({
    version: VERIFICATION_PROFILE_MATRIX_SPEC_VERSION,
    riskBaselines: Object.freeze(Object.keys(RISK_VERIFICATION_BASELINES) as ReleaseEnforcementRiskClass[]),
    boundaryBaselines: Object.freeze(
      Object.keys(BOUNDARY_VERIFICATION_BASELINES) as EnforcementBoundaryKind[],
    ),
    senderConstrainedPresentationModes: SENDER_CONSTRAINED_PRESENTATION_MODES,
  });
}
