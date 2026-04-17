import type { ConsequenceType } from './types.js';
import { CONSEQUENCE_TYPES } from './types.js';
import type { ReleaseTargetKind } from './object-model.js';

/**
 * Consequence-specific rollout guidance for the release layer.
 *
 * These profiles answer a narrower question than the risk matrix:
 * how each consequence type should enter the product, what kind of
 * enforcement shape it needs, and what contract/evidence constraints
 * must exist before it can be treated as a real gateway path.
 */

export type ConsequenceRolloutMode =
  | 'hard-gate-first'
  | 'shadow-first-then-hard-gate'
  | 'advisory-first-until-boundary';

export type ConsequenceEnforcementMode =
  | 'signed-envelope-verify'
  | 'inline-token-verify'
  | 'pre-execution-authorize'
  | 'advisory-receipt';

export type ConsequencePriority = 'primary' | 'secondary' | 'tertiary' | 'specialized';

export interface ConsequenceContractRequirements {
  readonly requiresStableArtifactType: boolean;
  readonly requiresExpectedShape: boolean;
  readonly requiresTargetBinding: boolean;
  readonly requiresConsequenceHash: boolean;
  readonly requiresRecipientBinding: boolean;
  readonly requiresIdempotencyKey: boolean;
  readonly requiresSingleUseRelease: boolean;
  readonly allowsBatchRelease: boolean;
}

export interface ConsequenceEvidenceRequirements {
  readonly minimumEvidenceKinds: readonly string[];
  readonly requiresDurableEvidence: boolean;
  readonly requiresDownstreamReceipt: boolean;
}

export interface ConsequenceRolloutProfile {
  readonly consequenceType: ConsequenceType;
  readonly rolloutOrder: 1 | 2 | 3 | 4;
  readonly priority: ConsequencePriority;
  readonly rolloutMode: ConsequenceRolloutMode;
  readonly enforcementMode: ConsequenceEnforcementMode;
  readonly hardGateEligible: boolean;
  readonly summary: string;
  readonly defaultTargetKinds: readonly ReleaseTargetKind[];
  readonly contractRequirements: ConsequenceContractRequirements;
  readonly evidenceRequirements: ConsequenceEvidenceRequirements;
  readonly notes: readonly string[];
}

export const CONSEQUENCE_ROLLOUT_PROFILES: Record<ConsequenceType, ConsequenceRolloutProfile> = {
  communication: {
    consequenceType: 'communication',
    rolloutOrder: 2,
    priority: 'secondary',
    rolloutMode: 'shadow-first-then-hard-gate',
    enforcementMode: 'inline-token-verify',
    hardGateEligible: true,
    summary: 'Gate outbound human-readable communication after recipient and channel binding are explicit.',
    defaultTargetKinds: ['endpoint', 'queue'],
    contractRequirements: {
      requiresStableArtifactType: true,
      requiresExpectedShape: true,
      requiresTargetBinding: true,
      requiresConsequenceHash: true,
      requiresRecipientBinding: true,
      requiresIdempotencyKey: true,
      requiresSingleUseRelease: false,
      allowsBatchRelease: false,
    },
    evidenceRequirements: {
      minimumEvidenceKinds: ['trace', 'finding-log', 'signature'],
      requiresDurableEvidence: false,
      requiresDownstreamReceipt: true,
    },
    notes: [
      'Communication should start in shadow mode so teams can calibrate false positives before blocking sends.',
      'Recipient, channel, and rendered content digest should all bind into the release decision before enforcement.',
    ],
  },
  record: {
    consequenceType: 'record',
    rolloutOrder: 1,
    priority: 'primary',
    rolloutMode: 'hard-gate-first',
    enforcementMode: 'signed-envelope-verify',
    hardGateEligible: true,
    summary: 'Treat structured writes and filing artifacts as the first fail-closed release boundary.',
    defaultTargetKinds: ['record-store', 'artifact-registry', 'queue'],
    contractRequirements: {
      requiresStableArtifactType: true,
      requiresExpectedShape: true,
      requiresTargetBinding: true,
      requiresConsequenceHash: true,
      requiresRecipientBinding: false,
      requiresIdempotencyKey: true,
      requiresSingleUseRelease: true,
      allowsBatchRelease: false,
    },
    evidenceRequirements: {
      minimumEvidenceKinds: ['trace', 'finding-log', 'signature', 'provenance'],
      requiresDurableEvidence: true,
      requiresDownstreamReceipt: true,
    },
    notes: [
      'The first hard gateway wedge should remain AI output to structured record because the consequence is easy to hash, bind, and reject.',
      'Records should be admitted only when the downstream store or artifact path can reject writes without a valid release token or signed envelope.',
    ],
  },
  action: {
    consequenceType: 'action',
    rolloutOrder: 3,
    priority: 'tertiary',
    rolloutMode: 'shadow-first-then-hard-gate',
    enforcementMode: 'pre-execution-authorize',
    hardGateEligible: true,
    summary: 'Authorize tool-driven side effects only when the exact action payload and target are bound.',
    defaultTargetKinds: ['workflow', 'endpoint', 'queue'],
    contractRequirements: {
      requiresStableArtifactType: true,
      requiresExpectedShape: true,
      requiresTargetBinding: true,
      requiresConsequenceHash: true,
      requiresRecipientBinding: false,
      requiresIdempotencyKey: true,
      requiresSingleUseRelease: true,
      allowsBatchRelease: false,
    },
    evidenceRequirements: {
      minimumEvidenceKinds: ['trace', 'finding-log', 'signature', 'review-record'],
      requiresDurableEvidence: true,
      requiresDownstreamReceipt: true,
    },
    notes: [
      'Action release should begin in shadow mode because side effects are the easiest path to operational blast radius.',
      'Every authorized action should bind to an exact target and a single-use release to reduce replay and substitution risk.',
    ],
  },
  'decision-support': {
    consequenceType: 'decision-support',
    rolloutOrder: 4,
    priority: 'specialized',
    rolloutMode: 'advisory-first-until-boundary',
    enforcementMode: 'advisory-receipt',
    hardGateEligible: false,
    summary: 'Keep decision-support advisory until it is attached to a concrete downstream release boundary.',
    defaultTargetKinds: ['queue', 'artifact-registry'],
    contractRequirements: {
      requiresStableArtifactType: true,
      requiresExpectedShape: true,
      requiresTargetBinding: false,
      requiresConsequenceHash: false,
      requiresRecipientBinding: false,
      requiresIdempotencyKey: false,
      requiresSingleUseRelease: false,
      allowsBatchRelease: true,
    },
    evidenceRequirements: {
      minimumEvidenceKinds: ['trace', 'finding-log'],
      requiresDurableEvidence: false,
      requiresDownstreamReceipt: false,
    },
    notes: [
      'Decision-support should not be treated as a true hard gate until it feeds a concrete record, communication, or action consequence.',
      'The release layer should emit advisory evidence here first, then upgrade to enforced release only when the downstream decision surface is explicit.',
    ],
  },
};

export function consequenceRolloutProfile(
  consequenceType: ConsequenceType,
): ConsequenceRolloutProfile {
  return CONSEQUENCE_ROLLOUT_PROFILES[consequenceType];
}

export function orderedConsequenceRolloutProfiles(): readonly ConsequenceRolloutProfile[] {
  return CONSEQUENCE_TYPES.map((consequenceType) => CONSEQUENCE_ROLLOUT_PROFILES[consequenceType])
    .slice()
    .sort((left, right) => left.rolloutOrder - right.rolloutOrder);
}

export function hardGateEligibleConsequenceTypes(): readonly ConsequenceType[] {
  return orderedConsequenceRolloutProfiles()
    .filter((profile) => profile.hardGateEligible)
    .map((profile) => profile.consequenceType);
}
