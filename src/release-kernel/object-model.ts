import type {
  CapabilityBoundaryDescriptor,
  ConsequenceType,
  EvidenceRetentionClass,
  OutputContractDescriptor,
  ReleaseDecisionStatus,
  ReviewAuthorityMode,
  ReviewAuthorityProfile,
  RiskClass,
} from './types.js';
import {
  defaultReviewAuthorityForRiskClass,
  RELEASE_DECISION_TERMINAL_STATUSES,
} from './types.js';

/**
 * Versioned object model for Attestor's release layer.
 *
 * This is the shared contract for future APIs, release tokens, evidence packs,
 * and downstream verification components. It does not issue or enforce
 * anything yet; it defines the stable objects that later steps will carry.
 */

export const RELEASE_KERNEL_SPEC_VERSION = 'attestor.release-kernel.v1';
export const RELEASE_DECISION_SPEC_VERSION = 'attestor.release-decision.v1';
export const RELEASE_TOKEN_SPEC_VERSION = 'attestor.release-token.v1';
export const EVIDENCE_PACK_SPEC_VERSION = 'attestor.evidence-pack.v1';

export type ReleaseActorType = 'user' | 'service' | 'system';

export interface ReleaseActorReference {
  readonly id: string;
  readonly type: ReleaseActorType;
  readonly displayName?: string;
  readonly role?: string;
}

export type ReleaseTargetKind =
  | 'endpoint'
  | 'queue'
  | 'record-store'
  | 'workflow'
  | 'artifact-registry';

export interface ReleaseTargetReference {
  readonly kind: ReleaseTargetKind;
  readonly id: string;
  readonly displayName?: string;
}

export type ReleaseFindingResult = 'pass' | 'warn' | 'fail' | 'info';

export interface ReleaseFinding {
  readonly code: string;
  readonly result: ReleaseFindingResult;
  readonly message: string;
  readonly source:
    | 'policy'
    | 'deterministic-check'
    | 'review'
    | 'runtime'
    | 'evidence'
    | 'override';
}

export interface ReviewAuthority {
  readonly mode: ReviewAuthorityMode;
  readonly minimumReviewerCount: number;
  readonly requiresNamedReviewer: boolean;
  readonly requiredRoles: readonly string[];
  readonly requiredReviewerIds: readonly string[];
}

export type ReleaseCondition =
  | {
      readonly kind: 'target-binding';
      readonly allowedTargetId: string;
    }
  | {
      readonly kind: 'usage-limit';
      readonly maxUses: number;
    }
  | {
      readonly kind: 'expiry';
      readonly expiresAt: string;
    }
  | {
      readonly kind: 'introspection';
      readonly required: boolean;
    }
  | {
      readonly kind: 'retention';
      readonly retentionClass: EvidenceRetentionClass;
    };

export interface ReleaseConditions {
  readonly items: readonly ReleaseCondition[];
}

export interface EvidenceArtifactReference {
  readonly kind:
    | 'trace'
    | 'finding-log'
    | 'review-record'
    | 'signature'
    | 'verification-kit'
    | 'provenance'
    | 'other';
  readonly path: string;
  readonly digest?: string;
}

export interface EvidencePack {
  readonly version: typeof EVIDENCE_PACK_SPEC_VERSION;
  readonly id: string;
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly retentionClass: EvidenceRetentionClass;
  readonly findings: readonly ReleaseFinding[];
  readonly artifacts: readonly EvidenceArtifactReference[];
}

export interface OverrideGrant {
  readonly reasonCode: string;
  readonly ticketId?: string;
  readonly requestedBy: ReleaseActorReference;
}

export interface ReleaseDecision {
  readonly version: typeof RELEASE_DECISION_SPEC_VERSION;
  readonly id: string;
  readonly createdAt: string;
  readonly status: ReleaseDecisionStatus;
  readonly consequenceType: ConsequenceType;
  readonly riskClass: RiskClass;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly outputContract: OutputContractDescriptor;
  readonly capabilityBoundary: CapabilityBoundaryDescriptor;
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly requester: ReleaseActorReference;
  readonly target: ReleaseTargetReference;
  readonly reviewAuthority: ReviewAuthority;
  readonly releaseConditions: ReleaseConditions;
  readonly findings: readonly ReleaseFinding[];
  readonly evidencePackId: string | null;
  readonly releaseTokenId: string | null;
  readonly override: OverrideGrant | null;
}

export interface ReleaseTokenClaims {
  readonly version: typeof RELEASE_TOKEN_SPEC_VERSION;
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly jti: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly decision_id: string;
  readonly decision: ReleaseDecisionStatus;
  readonly consequence_type: ConsequenceType;
  readonly risk_class: RiskClass;
  readonly output_hash: string;
  readonly consequence_hash: string;
  readonly policy_hash: string;
  readonly override: boolean;
  readonly introspection_required: boolean;
  readonly authority_mode: ReviewAuthorityMode;
}

export interface CreateReleaseDecisionSkeletonInput {
  readonly id: string;
  readonly createdAt: string;
  readonly status: ReleaseDecisionStatus;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly outputContract: OutputContractDescriptor;
  readonly capabilityBoundary: CapabilityBoundaryDescriptor;
  readonly requester: ReleaseActorReference;
  readonly target: ReleaseTargetReference;
  readonly findings?: readonly ReleaseFinding[];
  readonly evidencePackId?: string | null;
  readonly releaseTokenId?: string | null;
  readonly override?: OverrideGrant | null;
  readonly reviewAuthority?: Partial<ReviewAuthority>;
  readonly releaseConditions?: ReleaseConditions;
}

export interface BuildReleaseTokenClaimsInput {
  readonly issuer: string;
  readonly subject: string;
  readonly tokenId: string;
  readonly issuedAtEpochSeconds: number;
  readonly ttlSeconds: number;
  readonly decision: ReleaseDecision;
}

export function retentionClassForRiskClass(riskClass: RiskClass): EvidenceRetentionClass {
  switch (riskClass) {
    case 'R0':
      return 'ephemeral';
    case 'R1':
    case 'R2':
    case 'R3':
      return 'standard';
    case 'R4':
      return 'regulated';
  }
}

export function defaultReleaseTokenTtlSecondsForRiskClass(riskClass: RiskClass): number {
  switch (riskClass) {
    case 'R0':
      return 1800;
    case 'R1':
      return 900;
    case 'R2':
      return 600;
    case 'R3':
      return 300;
    case 'R4':
      return 180;
  }
}

export function buildReviewAuthority(
  riskClass: RiskClass,
  overrides: Partial<ReviewAuthority> = {},
): ReviewAuthority {
  const base: ReviewAuthorityProfile = defaultReviewAuthorityForRiskClass(riskClass);
  return {
    mode: overrides.mode ?? base.mode,
    minimumReviewerCount: overrides.minimumReviewerCount ?? base.minimumReviewerCount,
    requiresNamedReviewer: overrides.requiresNamedReviewer ?? base.requiresNamedReviewer,
    requiredRoles: overrides.requiredRoles ?? [],
    requiredReviewerIds: overrides.requiredReviewerIds ?? [],
  };
}

export function defaultReleaseConditions(
  riskClass: RiskClass,
  target: ReleaseTargetReference,
  createdAtIso: string,
): ReleaseConditions {
  const createdAt = new Date(createdAtIso);
  const ttlSeconds = defaultReleaseTokenTtlSecondsForRiskClass(riskClass);
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000).toISOString();

  return {
    items: [
      {
        kind: 'target-binding',
        allowedTargetId: target.id,
      },
      {
        kind: 'usage-limit',
        maxUses: 1,
      },
      {
        kind: 'expiry',
        expiresAt,
      },
      {
        kind: 'introspection',
        required: riskClass === 'R3' || riskClass === 'R4',
      },
      {
        kind: 'retention',
        retentionClass: retentionClassForRiskClass(riskClass),
      },
    ],
  };
}

export function createReleaseDecisionSkeleton(
  input: CreateReleaseDecisionSkeletonInput,
): ReleaseDecision {
  const riskClass = input.outputContract.riskClass;
  const consequenceType = input.outputContract.consequenceType;

  return {
    version: RELEASE_DECISION_SPEC_VERSION,
    id: input.id,
    createdAt: input.createdAt,
    status: input.status,
    consequenceType,
    riskClass,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    outputContract: input.outputContract,
    capabilityBoundary: input.capabilityBoundary,
    outputHash: input.outputHash,
    consequenceHash: input.consequenceHash,
    requester: input.requester,
    target: input.target,
    reviewAuthority: buildReviewAuthority(riskClass, input.reviewAuthority),
    releaseConditions:
      input.releaseConditions ?? defaultReleaseConditions(riskClass, input.target, input.createdAt),
    findings: input.findings ?? [],
    evidencePackId: input.evidencePackId ?? null,
    releaseTokenId: input.releaseTokenId ?? null,
    override: input.override ?? null,
  };
}

export function releaseDecisionRequiresIntrospection(decision: ReleaseDecision): boolean {
  return decision.releaseConditions.items.some(
    (item) => item.kind === 'introspection' && item.required,
  );
}

export function releaseDecisionExpiresAt(decision: ReleaseDecision): string | null {
  const expiry = decision.releaseConditions.items.find(
    (item): item is Extract<ReleaseCondition, { kind: 'expiry' }> => item.kind === 'expiry',
  );
  return expiry?.expiresAt ?? null;
}

export function releaseDecisionMaxUses(decision: ReleaseDecision): number | null {
  const usageLimit = decision.releaseConditions.items.find(
    (item): item is Extract<ReleaseCondition, { kind: 'usage-limit' }> =>
      item.kind === 'usage-limit',
  );
  return usageLimit?.maxUses ?? null;
}

export function buildReleaseTokenClaims(input: BuildReleaseTokenClaimsInput): ReleaseTokenClaims {
  return {
    version: RELEASE_TOKEN_SPEC_VERSION,
    iss: input.issuer,
    sub: input.subject,
    aud: input.decision.target.id,
    jti: input.tokenId,
    iat: input.issuedAtEpochSeconds,
    nbf: input.issuedAtEpochSeconds,
    exp: input.issuedAtEpochSeconds + input.ttlSeconds,
    decision_id: input.decision.id,
    decision: input.decision.status,
    consequence_type: input.decision.consequenceType,
    risk_class: input.decision.riskClass,
    output_hash: input.decision.outputHash,
    consequence_hash: input.decision.consequenceHash,
    policy_hash: input.decision.policyHash,
    override: input.decision.override !== null || input.decision.status === 'overridden',
    introspection_required: releaseDecisionRequiresIntrospection(input.decision),
    authority_mode: input.decision.reviewAuthority.mode,
  };
}

export function isTerminalReleaseDecisionStatus(status: ReleaseDecisionStatus): boolean {
  return (RELEASE_DECISION_TERMINAL_STATUSES as readonly ReleaseDecisionStatus[]).includes(status);
}
