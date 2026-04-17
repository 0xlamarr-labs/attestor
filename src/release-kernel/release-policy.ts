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
  FINANCE_REVIEW_SUMMARY_ARTIFACT_TYPE,
  FINANCE_REVIEW_SUMMARY_EXPECTED_SHAPE,
  FINANCE_REVIEW_SUMMARY_TARGET_ID,
} from './finance-communication-release.js';
import {
  FINANCE_WORKFLOW_ACTION_ARTIFACT_TYPE,
  FINANCE_WORKFLOW_ACTION_EXPECTED_SHAPE,
  FINANCE_WORKFLOW_ACTION_TARGET_ID,
} from './finance-action-release.js';
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

export function createFinanceCommunicationReleasePolicy(): ReleasePolicyDefinition {
  const riskControls = riskControlProfile('R2');

  return createReleasePolicyDefinition({
    id: 'finance.review-summary-communication.v1',
    name: 'Finance review summary communication policy',
    rollout: {
      mode: 'dry-run',
      activatedAt: '2026-04-17T00:00:00.000Z',
      notes: [
        'Communication launches in dry-run so recipient and channel binding can be calibrated before any blocking send path is enabled.',
      ],
    },
    scope: {
      wedgeId: 'finance-review-summary-communication',
      consequenceType: 'communication',
      riskClass: 'R2',
      targetKinds: ['endpoint'],
      dataDomains: ['financial-reporting'],
    },
    outputContract: {
      allowedArtifactTypes: [FINANCE_REVIEW_SUMMARY_ARTIFACT_TYPE],
      expectedShape: FINANCE_REVIEW_SUMMARY_EXPECTED_SHAPE,
      consequenceType: 'communication',
      riskClass: 'R2',
    },
    capabilityBoundary: {
      allowedTools: ['review-summary-render', 'channel-dispatch'],
      allowedTargets: [FINANCE_REVIEW_SUMMARY_TARGET_ID],
      allowedDataDomains: ['financial-reporting'],
      requiresSingleTargetBinding: true,
    },
    acceptance: {
      strategy: 'all-required',
      requiredChecks: riskControls.deterministicChecks,
      requiredEvidenceKinds: ['trace', 'finding-log'],
      maxWarnings: 0,
      failureDisposition: riskControls.review.failureDisposition,
    },
    release: {
      reviewMode: 'auto',
      minimumReviewerCount: 0,
      tokenEnforcement: riskControls.token.minimumEnforcement,
      requireSignedEnvelope: false,
      requireDurableEvidencePack: riskControls.evidence.requiresDurableEvidencePack,
      requireDownstreamReceipt: riskControls.evidence.requiresDownstreamReceipt,
      retentionClass: riskControls.evidence.retentionClass,
    },
    notes: [
      'This is the second canonical flow: outbound reviewer-facing communication after record release proved the first hard boundary.',
    ],
  });
}

export function createFinanceActionReleasePolicy(): ReleasePolicyDefinition {
  const riskControls = riskControlProfile('R3');

  return createReleasePolicyDefinition({
    id: 'finance.workflow-action-release.v1',
    name: 'Finance workflow action release policy',
    rollout: {
      mode: 'dry-run',
      activatedAt: '2026-04-17T00:00:00.000Z',
      notes: [
        'Action release launches in dry-run so side effects stay observable before pre-execution authorization becomes mandatory.',
      ],
    },
    scope: {
      wedgeId: 'finance-workflow-action-release',
      consequenceType: 'action',
      riskClass: 'R3',
      targetKinds: ['workflow'],
      dataDomains: ['financial-reporting'],
    },
    outputContract: {
      allowedArtifactTypes: [FINANCE_WORKFLOW_ACTION_ARTIFACT_TYPE],
      expectedShape: FINANCE_WORKFLOW_ACTION_EXPECTED_SHAPE,
      consequenceType: 'action',
      riskClass: 'R3',
    },
    capabilityBoundary: {
      allowedTools: ['workflow-dispatch', 'filing-prepare'],
      allowedTargets: [FINANCE_WORKFLOW_ACTION_TARGET_ID],
      allowedDataDomains: ['financial-reporting'],
      requiresSingleTargetBinding: true,
    },
    acceptance: {
      strategy: 'all-required',
      requiredChecks: riskControls.deterministicChecks,
      requiredEvidenceKinds: ['trace', 'finding-log', 'provenance'],
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
      'This is the third canonical flow: bounded workflow action requests stay shadow-first until a concrete pre-execution gate is ready.',
    ],
  });
}
