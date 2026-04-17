/**
 * Common release-kernel vocabulary for Attestor's AI output release layer.
 *
 * This module intentionally defines the shared language first, before the
 * release decision engine, token issuance, or enforcement adapters are added.
 * The goal is to give every future consequence flow the same consequence,
 * risk, review, and evidence grammar.
 */

export const CONSEQUENCE_TYPES = [
  'communication',
  'record',
  'action',
  'decision-support',
] as const;

export type ConsequenceType = typeof CONSEQUENCE_TYPES[number];

export interface ConsequenceTypeProfile {
  readonly id: ConsequenceType;
  readonly label: string;
  readonly description: string;
  readonly examples: readonly string[];
}

export const CONSEQUENCE_TYPE_PROFILES: Record<ConsequenceType, ConsequenceTypeProfile> = {
  communication: {
    id: 'communication',
    label: 'Communication',
    description: 'Text or structured content that leaves the system toward a human recipient.',
    examples: ['customer reply', 'internal email', 'operator-facing explanation'],
  },
  record: {
    id: 'record',
    label: 'Record',
    description: 'A structured write, filing package, report artifact, or durable system record.',
    examples: ['report field update', 'filing package export', 'case record mutation'],
  },
  action: {
    id: 'action',
    label: 'Action',
    description: 'A tool call, workflow mutation, or system-side effect that changes the environment.',
    examples: ['workflow step execution', 'system mutation', 'external API mutation'],
  },
  'decision-support': {
    id: 'decision-support',
    label: 'Decision Support',
    description: 'Output intended to inform a human or machine decision before any other direct release.',
    examples: ['risk recommendation', 'triage suggestion', 'analyst briefing note'],
  },
};

export const RISK_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;

export type RiskClass = typeof RISK_CLASSES[number];

export type DefaultReleasePath =
  | 'advisory'
  | 'auto-accept-eligible'
  | 'policy-gated'
  | 'review-required'
  | 'regulated-release';

export type ReviewAuthorityMode =
  | 'auto'
  | 'named-reviewer'
  | 'dual-approval'
  | 'break-glass';

export interface ReviewAuthorityProfile {
  readonly mode: ReviewAuthorityMode;
  readonly minimumReviewerCount: number;
  readonly requiresNamedReviewer: boolean;
}

export interface RiskClassProfile {
  readonly id: RiskClass;
  readonly label: string;
  readonly description: string;
  readonly defaultReleasePath: DefaultReleasePath;
  readonly defaultReviewAuthority: ReviewAuthorityProfile;
  readonly releaseGoal: string;
}

export const RISK_CLASS_PROFILES: Record<RiskClass, RiskClassProfile> = {
  R0: {
    id: 'R0',
    label: 'Advisory',
    description: 'No direct operational or regulated consequence without another independent step.',
    defaultReleasePath: 'advisory',
    defaultReviewAuthority: {
      mode: 'auto',
      minimumReviewerCount: 0,
      requiresNamedReviewer: false,
    },
    releaseGoal: 'Allow fast visibility while preserving clear non-authoritative status.',
  },
  R1: {
    id: 'R1',
    label: 'Low Consequence',
    description: 'Limited consequence with reversible outcomes and tight bounded scope.',
    defaultReleasePath: 'auto-accept-eligible',
    defaultReviewAuthority: {
      mode: 'auto',
      minimumReviewerCount: 0,
      requiresNamedReviewer: false,
    },
    releaseGoal: 'Maximize safe auto-release under deterministic policy checks.',
  },
  R2: {
    id: 'R2',
    label: 'Operational',
    description: 'Operational consequence where policy checks and evidence must be explicit before release.',
    defaultReleasePath: 'policy-gated',
    defaultReviewAuthority: {
      mode: 'auto',
      minimumReviewerCount: 0,
      requiresNamedReviewer: false,
    },
    releaseGoal: 'Permit bounded operational release when policy and evidence are strong enough.',
  },
  R3: {
    id: 'R3',
    label: 'High Consequence',
    description: 'High-impact consequence requiring an explicitly accountable reviewer before release.',
    defaultReleasePath: 'review-required',
    defaultReviewAuthority: {
      mode: 'named-reviewer',
      minimumReviewerCount: 1,
      requiresNamedReviewer: true,
    },
    releaseGoal: 'Bind release to a named reviewer when the outcome is materially consequential.',
  },
  R4: {
    id: 'R4',
    label: 'Regulated Artifact',
    description: 'Formal or regulated artifacts that require signed release discipline and stronger retention.',
    defaultReleasePath: 'regulated-release',
    defaultReviewAuthority: {
      mode: 'dual-approval',
      minimumReviewerCount: 2,
      requiresNamedReviewer: true,
    },
    releaseGoal: 'Treat release as a formal authorization event with durable evidence and explicit authority.',
  },
};

export const RELEASE_DECISION_STATUSES = [
  'accepted',
  'denied',
  'hold',
  'review-required',
  'expired',
  'revoked',
  'overridden',
] as const;

export type ReleaseDecisionStatus = typeof RELEASE_DECISION_STATUSES[number];

export const RELEASE_DECISION_TERMINAL_STATUSES = [
  'accepted',
  'denied',
  'expired',
  'revoked',
  'overridden',
] as const satisfies readonly ReleaseDecisionStatus[];

export interface OutputContractDescriptor {
  readonly artifactType: string;
  readonly expectedShape: string;
  readonly consequenceType: ConsequenceType;
  readonly riskClass: RiskClass;
}

export interface CapabilityBoundaryDescriptor {
  readonly allowedTools: readonly string[];
  readonly allowedTargets: readonly string[];
  readonly allowedDataDomains: readonly string[];
}

export interface EvidencePackDescriptor {
  readonly minimumRequiredEvidence: readonly string[];
  readonly retentionClass: 'ephemeral' | 'standard' | 'regulated';
}

export function isConsequenceType(value: string): value is ConsequenceType {
  return CONSEQUENCE_TYPES.includes(value as ConsequenceType);
}

export function isRiskClass(value: string): value is RiskClass {
  return RISK_CLASSES.includes(value as RiskClass);
}

export function defaultReviewAuthorityForRiskClass(riskClass: RiskClass): ReviewAuthorityProfile {
  return RISK_CLASS_PROFILES[riskClass].defaultReviewAuthority;
}

export function consequenceTypeLabel(consequenceType: ConsequenceType): string {
  return CONSEQUENCE_TYPE_PROFILES[consequenceType].label;
}
