import type {
  CapabilityBoundaryDescriptor,
  ConsequenceType,
  EvidenceRetentionClass,
  OutputContractDescriptor,
  ReviewAuthorityMode,
  RiskClass,
} from './types.js';
import type {
  DeterministicControlCategory,
  ReleaseTokenEnforcementLevel,
} from './risk-controls.js';
import { riskControlProfile } from './risk-controls.js';
import { firstHardGatewayWedge } from './first-hard-gateway-wedge.js';
import type { ReleaseTargetKind } from './object-model.js';
import {
  createReleasePolicyRollout,
  type CreateReleasePolicyRolloutInput,
  type ReleasePolicyRolloutDefinition,
} from './release-policy-rollout.js';

/**
 * Release policy language v1.
 *
 * This is the first declarative grammar for telling Attestor what kind of
 * output may be released, what boundary it is allowed to touch, which checks
 * must pass, and what release discipline is required if it does.
 *
 * It deliberately stays data-oriented and side-effect free so later policy
 * evaluation can borrow ideas from OPA/Cedar/CEL-style systems without
 * prematurely embedding a general-purpose policy runtime.
 */

export const RELEASE_POLICY_SPEC_VERSION = 'attestor.release-policy.v1';

export type ReleasePolicyStatus = 'draft' | 'active' | 'deprecated';
export type AcceptanceDecisionStrategy = 'all-required' | 'fail-on-any-required' | 'review-on-warning';
export type PolicyFailureDisposition = 'deny' | 'hold' | 'review-required' | 'observe';

export interface ReleasePolicyScope {
  readonly wedgeId: string;
  readonly consequenceType: ConsequenceType;
  readonly riskClass: RiskClass;
  readonly targetKinds: readonly ReleaseTargetKind[];
  readonly dataDomains: readonly string[];
}

export interface OutputContractPolicy {
  readonly allowedArtifactTypes: readonly string[];
  readonly expectedShape: string;
  readonly consequenceType: ConsequenceType;
  readonly riskClass: RiskClass;
}

export interface CapabilityBoundaryPolicy {
  readonly allowedTools: readonly string[];
  readonly allowedTargets: readonly string[];
  readonly allowedDataDomains: readonly string[];
  readonly requiresSingleTargetBinding: boolean;
}

export interface AcceptancePolicy {
  readonly strategy: AcceptanceDecisionStrategy;
  readonly requiredChecks: readonly DeterministicControlCategory[];
  readonly requiredEvidenceKinds: readonly string[];
  readonly maxWarnings: number;
  readonly failureDisposition: PolicyFailureDisposition;
}

export interface ReleaseRequirementsPolicy {
  readonly reviewMode: ReviewAuthorityMode;
  readonly minimumReviewerCount: number;
  readonly tokenEnforcement: ReleaseTokenEnforcementLevel;
  readonly requireSignedEnvelope: boolean;
  readonly requireDurableEvidencePack: boolean;
  readonly requireDownstreamReceipt: boolean;
  readonly retentionClass: EvidenceRetentionClass;
}

export interface ReleasePolicyDefinition {
  readonly version: typeof RELEASE_POLICY_SPEC_VERSION;
  readonly id: string;
  readonly name: string;
  readonly status: ReleasePolicyStatus;
  readonly rollout: ReleasePolicyRolloutDefinition;
  readonly scope: ReleasePolicyScope;
  readonly outputContract: OutputContractPolicy;
  readonly capabilityBoundary: CapabilityBoundaryPolicy;
  readonly acceptance: AcceptancePolicy;
  readonly release: ReleaseRequirementsPolicy;
  readonly notes: readonly string[];
}

export interface CreateReleasePolicyDefinitionInput {
  readonly id: string;
  readonly name: string;
  readonly status?: ReleasePolicyStatus;
  readonly rollout?: CreateReleasePolicyRolloutInput;
  readonly scope: ReleasePolicyScope;
  readonly outputContract: OutputContractPolicy;
  readonly capabilityBoundary: CapabilityBoundaryPolicy;
  readonly acceptance: AcceptancePolicy;
  readonly release: ReleaseRequirementsPolicy;
  readonly notes?: readonly string[];
}

export function createReleasePolicyDefinition(
  input: CreateReleasePolicyDefinitionInput,
): ReleasePolicyDefinition {
  return {
    version: RELEASE_POLICY_SPEC_VERSION,
    id: input.id,
    name: input.name,
    status: input.status ?? 'active',
    rollout: createReleasePolicyRollout(input.rollout ?? { mode: 'enforce' }),
    scope: input.scope,
    outputContract: input.outputContract,
    capabilityBoundary: input.capabilityBoundary,
    acceptance: input.acceptance,
    release: input.release,
    notes: input.notes ?? [],
  };
}

export function matchesReleasePolicyScope(
  policy: ReleasePolicyDefinition,
  outputContract: OutputContractDescriptor,
  capabilityBoundary: CapabilityBoundaryDescriptor,
  targetKind: ReleaseTargetKind,
): boolean {
  return (
    policy.scope.consequenceType === outputContract.consequenceType &&
    policy.scope.riskClass === outputContract.riskClass &&
    policy.scope.targetKinds.includes(targetKind) &&
    policy.outputContract.allowedArtifactTypes.includes(outputContract.artifactType) &&
    policy.outputContract.expectedShape === outputContract.expectedShape &&
    capabilityBoundary.allowedDataDomains.every((domain) =>
      policy.capabilityBoundary.allowedDataDomains.includes(domain),
    )
  );
}

export function createFirstHardGatewayReleasePolicy(): ReleasePolicyDefinition {
  const wedge = firstHardGatewayWedge();
  const riskControls = riskControlProfile(wedge.defaultRiskClass);

  return createReleasePolicyDefinition({
    id: 'finance.structured-record-release.v1',
    name: 'Finance structured record release policy',
    rollout: {
      mode: 'enforce',
      activatedAt: '2026-04-17T00:00:00.000Z',
      notes: [
        'The first hard gateway wedge starts in enforce mode so the finance proving path remains fail-closed by default.',
      ],
    },
    scope: {
      wedgeId: wedge.id,
      consequenceType: wedge.consequenceType,
      riskClass: wedge.defaultRiskClass,
      targetKinds: wedge.targetKinds,
      dataDomains: ['financial-reporting'],
    },
    outputContract: {
      allowedArtifactTypes: [
        'financial-reporting.record-field',
        'financial-reporting.filing-preparation-payload',
        'financial-reporting.structured-report-artifact',
      ],
      expectedShape: 'structured financial record payload',
      consequenceType: wedge.consequenceType,
      riskClass: wedge.defaultRiskClass,
    },
    capabilityBoundary: {
      allowedTools: ['xbrl-export', 'filing-prepare', 'record-commit'],
      allowedTargets: ['sec.edgar.filing.prepare', 'finance.reporting.record-store'],
      allowedDataDomains: ['financial-reporting'],
      requiresSingleTargetBinding: true,
    },
    acceptance: {
      strategy: 'all-required',
      requiredChecks: riskControls.deterministicChecks,
      requiredEvidenceKinds: ['trace', 'finding-log', 'signature', 'provenance'],
      maxWarnings: 0,
      failureDisposition: riskControls.review.failureDisposition,
    },
    release: {
      reviewMode: riskControls.review.mode,
      minimumReviewerCount: riskControls.review.minimumReviewerCount,
      tokenEnforcement: riskControls.token.minimumEnforcement,
      requireSignedEnvelope: true,
      requireDurableEvidencePack: riskControls.evidence.requiresDurableEvidencePack,
      requireDownstreamReceipt: riskControls.evidence.requiresDownstreamReceipt,
      retentionClass: riskControls.evidence.retentionClass,
    },
    notes: [
      'This first policy language slice is intentionally declarative and wedge-bound.',
      'The first hard gateway policy stays anchored to structured financial record release before broader platform generalization.',
    ],
  });
}
