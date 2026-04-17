import type {
  EvidenceRetentionClass,
  ReleaseDecisionStatus,
  ReviewAuthorityMode,
  RiskClass,
} from './types.js';
import { RISK_CLASSES, RISK_CLASS_PROFILES } from './types.js';
import {
  defaultReleaseTokenTtlSecondsForRiskClass,
  retentionClassForRiskClass,
} from './object-model.js';

/**
 * Risk-to-control matrix for the release layer.
 *
 * This module turns the shared risk classes into concrete release discipline:
 * required checks, review posture, evidence expectations, and token
 * enforcement. The later policy engine and reviewer UX will consume these
 * profiles instead of re-encoding risk behavior ad hoc.
 */

export const DETERMINISTIC_CONTROL_CATEGORIES = [
  'contract-shape',
  'target-binding',
  'capability-boundary',
  'consequence-hash-integrity',
  'policy-rule-validation',
  'evidence-completeness',
  'trace-grade-regression',
  'provenance-binding',
  'downstream-receipt-reconciliation',
] as const;

export type DeterministicControlCategory = typeof DETERMINISTIC_CONTROL_CATEGORIES[number];

export type ReleaseTokenEnforcementLevel =
  | 'none'
  | 'optional'
  | 'required'
  | 'required-with-introspection';

export type ControlFailureDisposition =
  | 'observe'
  | 'deny'
  | 'hold'
  | 'review-required';

export interface ReviewControlProfile {
  readonly mode: ReviewAuthorityMode;
  readonly minimumReviewerCount: number;
  readonly requiresNamedReviewer: boolean;
  readonly failureDisposition: ControlFailureDisposition;
  readonly allowsOverride: boolean;
}

export interface ReleaseTokenControlProfile {
  readonly minimumEnforcement: ReleaseTokenEnforcementLevel;
  readonly maxTtlSeconds: number;
  readonly requiresRevocationSupport: boolean;
  readonly requiresReplayLedger: boolean;
}

export interface EvidenceControlProfile {
  readonly retentionClass: EvidenceRetentionClass;
  readonly requiresDecisionLog: boolean;
  readonly requiresFindingLog: boolean;
  readonly requiresTraceEvidence: boolean;
  readonly requiresDurableEvidencePack: boolean;
  readonly requiresDownstreamReceipt: boolean;
}

export interface RiskControlProfile {
  readonly riskClass: RiskClass;
  readonly summary: string;
  readonly defaultAcceptedStatus: ReleaseDecisionStatus;
  readonly deterministicChecks: readonly DeterministicControlCategory[];
  readonly review: ReviewControlProfile;
  readonly evidence: EvidenceControlProfile;
  readonly token: ReleaseTokenControlProfile;
  readonly notes: readonly string[];
}

function reviewModeForRiskClass(riskClass: RiskClass): ReviewControlProfile {
  const authority = RISK_CLASS_PROFILES[riskClass].defaultReviewAuthority;

  switch (riskClass) {
    case 'R0':
      return {
        mode: authority.mode,
        minimumReviewerCount: authority.minimumReviewerCount,
        requiresNamedReviewer: authority.requiresNamedReviewer,
        failureDisposition: 'observe',
        allowsOverride: false,
      };
    case 'R1':
      return {
        mode: authority.mode,
        minimumReviewerCount: authority.minimumReviewerCount,
        requiresNamedReviewer: authority.requiresNamedReviewer,
        failureDisposition: 'deny',
        allowsOverride: true,
      };
    case 'R2':
      return {
        mode: authority.mode,
        minimumReviewerCount: authority.minimumReviewerCount,
        requiresNamedReviewer: authority.requiresNamedReviewer,
        failureDisposition: 'hold',
        allowsOverride: true,
      };
    case 'R3':
      return {
        mode: authority.mode,
        minimumReviewerCount: authority.minimumReviewerCount,
        requiresNamedReviewer: authority.requiresNamedReviewer,
        failureDisposition: 'review-required',
        allowsOverride: true,
      };
    case 'R4':
      return {
        mode: authority.mode,
        minimumReviewerCount: authority.minimumReviewerCount,
        requiresNamedReviewer: authority.requiresNamedReviewer,
        failureDisposition: 'review-required',
        allowsOverride: true,
      };
  }
}

function deterministicChecksForRiskClass(
  riskClass: RiskClass,
): readonly DeterministicControlCategory[] {
  switch (riskClass) {
    case 'R0':
      return ['contract-shape'];
    case 'R1':
      return ['contract-shape', 'target-binding'];
    case 'R2':
      return [
        'contract-shape',
        'target-binding',
        'capability-boundary',
        'consequence-hash-integrity',
        'policy-rule-validation',
      ];
    case 'R3':
      return [
        'contract-shape',
        'target-binding',
        'capability-boundary',
        'consequence-hash-integrity',
        'policy-rule-validation',
        'evidence-completeness',
        'trace-grade-regression',
      ];
    case 'R4':
      return [
        'contract-shape',
        'target-binding',
        'capability-boundary',
        'consequence-hash-integrity',
        'policy-rule-validation',
        'evidence-completeness',
        'trace-grade-regression',
        'provenance-binding',
        'downstream-receipt-reconciliation',
      ];
  }
}

function evidenceControlsForRiskClass(riskClass: RiskClass): EvidenceControlProfile {
  switch (riskClass) {
    case 'R0':
      return {
        retentionClass: retentionClassForRiskClass(riskClass),
        requiresDecisionLog: true,
        requiresFindingLog: true,
        requiresTraceEvidence: false,
        requiresDurableEvidencePack: false,
        requiresDownstreamReceipt: false,
      };
    case 'R1':
      return {
        retentionClass: retentionClassForRiskClass(riskClass),
        requiresDecisionLog: true,
        requiresFindingLog: true,
        requiresTraceEvidence: false,
        requiresDurableEvidencePack: false,
        requiresDownstreamReceipt: false,
      };
    case 'R2':
      return {
        retentionClass: retentionClassForRiskClass(riskClass),
        requiresDecisionLog: true,
        requiresFindingLog: true,
        requiresTraceEvidence: true,
        requiresDurableEvidencePack: false,
        requiresDownstreamReceipt: false,
      };
    case 'R3':
      return {
        retentionClass: retentionClassForRiskClass(riskClass),
        requiresDecisionLog: true,
        requiresFindingLog: true,
        requiresTraceEvidence: true,
        requiresDurableEvidencePack: true,
        requiresDownstreamReceipt: false,
      };
    case 'R4':
      return {
        retentionClass: retentionClassForRiskClass(riskClass),
        requiresDecisionLog: true,
        requiresFindingLog: true,
        requiresTraceEvidence: true,
        requiresDurableEvidencePack: true,
        requiresDownstreamReceipt: true,
      };
  }
}

function tokenControlsForRiskClass(riskClass: RiskClass): ReleaseTokenControlProfile {
  switch (riskClass) {
    case 'R0':
      return {
        minimumEnforcement: 'none',
        maxTtlSeconds: defaultReleaseTokenTtlSecondsForRiskClass(riskClass),
        requiresRevocationSupport: false,
        requiresReplayLedger: false,
      };
    case 'R1':
      return {
        minimumEnforcement: 'optional',
        maxTtlSeconds: defaultReleaseTokenTtlSecondsForRiskClass(riskClass),
        requiresRevocationSupport: false,
        requiresReplayLedger: false,
      };
    case 'R2':
      return {
        minimumEnforcement: 'required',
        maxTtlSeconds: defaultReleaseTokenTtlSecondsForRiskClass(riskClass),
        requiresRevocationSupport: false,
        requiresReplayLedger: true,
      };
    case 'R3':
      return {
        minimumEnforcement: 'required-with-introspection',
        maxTtlSeconds: defaultReleaseTokenTtlSecondsForRiskClass(riskClass),
        requiresRevocationSupport: true,
        requiresReplayLedger: true,
      };
    case 'R4':
      return {
        minimumEnforcement: 'required-with-introspection',
        maxTtlSeconds: defaultReleaseTokenTtlSecondsForRiskClass(riskClass),
        requiresRevocationSupport: true,
        requiresReplayLedger: true,
      };
  }
}

export const RISK_CONTROL_PROFILES: Record<RiskClass, RiskControlProfile> = {
  R0: {
    riskClass: 'R0',
    summary: 'Advisory-only output: observe and score it, but do not require a release token for consequence.',
    defaultAcceptedStatus: 'accepted',
    deterministicChecks: deterministicChecksForRiskClass('R0'),
    review: reviewModeForRiskClass('R0'),
    evidence: evidenceControlsForRiskClass('R0'),
    token: tokenControlsForRiskClass('R0'),
    notes: [
      'Use this only where another independent step still stands between the output and real consequence.',
      'R0 should optimize for visibility and calibration, not for hard release gating.',
    ],
  },
  R1: {
    riskClass: 'R1',
    summary: 'Low-consequence output: auto-release can happen, but only after bounded deterministic checks.',
    defaultAcceptedStatus: 'accepted',
    deterministicChecks: deterministicChecksForRiskClass('R1'),
    review: reviewModeForRiskClass('R1'),
    evidence: evidenceControlsForRiskClass('R1'),
    token: tokenControlsForRiskClass('R1'),
    notes: [
      'R1 is the first class where a release token becomes useful, even if not yet mandatory across every flow.',
      'Failures should default to deny rather than silently flowing into consequence.',
    ],
  },
  R2: {
    riskClass: 'R2',
    summary: 'Operational release: consequence requires full deterministic gating and explicit release authorization.',
    defaultAcceptedStatus: 'accepted',
    deterministicChecks: deterministicChecksForRiskClass('R2'),
    review: reviewModeForRiskClass('R2'),
    evidence: evidenceControlsForRiskClass('R2'),
    token: tokenControlsForRiskClass('R2'),
    notes: [
      'R2 should be the first class where no-token/no-release becomes a stable default.',
      'Operational release should hold on failed controls rather than guessing through uncertainty.',
    ],
  },
  R3: {
    riskClass: 'R3',
    summary: 'High-consequence release: bind release to a named reviewer and introspectable authorization.',
    defaultAcceptedStatus: 'accepted',
    deterministicChecks: deterministicChecksForRiskClass('R3'),
    review: reviewModeForRiskClass('R3'),
    evidence: evidenceControlsForRiskClass('R3'),
    token: tokenControlsForRiskClass('R3'),
    notes: [
      'R3 assumes explicit accountability and stronger evidence, not just higher model quality.',
      'Introspection and replay controls become mandatory because downstream consequence is materially significant.',
    ],
  },
  R4: {
    riskClass: 'R4',
    summary: 'Regulated artifact release: dual approval, durable evidence, and strictly enforced release tokens.',
    defaultAcceptedStatus: 'accepted',
    deterministicChecks: deterministicChecksForRiskClass('R4'),
    review: reviewModeForRiskClass('R4'),
    evidence: evidenceControlsForRiskClass('R4'),
    token: tokenControlsForRiskClass('R4'),
    notes: [
      'R4 is the class where signed release discipline must survive audit, replay, and downstream dispute.',
      'This is the strongest fit for filings, regulated records, and other formal artifacts with external consequence.',
    ],
  },
};

export function riskControlProfile(riskClass: RiskClass): RiskControlProfile {
  return RISK_CONTROL_PROFILES[riskClass];
}

export function orderedRiskControlProfiles(): readonly RiskControlProfile[] {
  return RISK_CLASSES.map((riskClass) => RISK_CONTROL_PROFILES[riskClass]);
}

export function riskClassesRequiringHumanReview(): readonly RiskClass[] {
  return orderedRiskControlProfiles()
    .filter((profile) => profile.review.mode === 'named-reviewer' || profile.review.mode === 'dual-approval')
    .map((profile) => profile.riskClass);
}
