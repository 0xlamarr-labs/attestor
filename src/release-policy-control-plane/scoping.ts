import type { PolicyActivationRecord } from './object-model.js';
import {
  createPolicyScopeSelector,
  policyActivationTargetLabel,
  type PolicyActivationTarget,
  type PolicyScopeDimension,
  type PolicyScopeSelector,
} from './types.js';

/**
 * Scoped policy matching and precedence rules for the release policy control plane.
 *
 * The control plane needs two things before it can safely resolve active policy:
 * 1. a deterministic definition of when a scoped policy activation matches a
 *    request target
 * 2. a deterministic definition of which matching activation wins when several
 *    are in play
 *
 * This module intentionally freezes those rules before the later active-policy
 * resolver exists, so discovery and activation logic can build on a stable
 * precedence contract instead of inventing per-call heuristics.
 */

export const POLICY_SCOPE_PRECEDENCE_SPEC_VERSION =
  'attestor.policy-scope-precedence.v1';

export const POLICY_SCOPE_PRECEDENCE_ORDER = Object.freeze([
  'account',
  'tenant',
  'wedge',
  'domain',
  'risk-class',
  'consequence-type',
  'cohort',
  'plan',
] as const satisfies readonly PolicyScopeDimension[]);

export type PolicyScopePrecedenceDimension =
  typeof POLICY_SCOPE_PRECEDENCE_ORDER[number];

export interface PolicyScopePrecedenceDescriptor {
  readonly version: typeof POLICY_SCOPE_PRECEDENCE_SPEC_VERSION;
  readonly mandatoryExactBoundary: readonly ['environment'];
  readonly wildcardSemantics: 'null-means-unscoped';
  readonly precedenceOrder: readonly PolicyScopePrecedenceDimension[];
  readonly hierarchyRules: readonly string[];
}

export interface PolicyScopeMatchResult {
  readonly request: PolicyActivationTarget;
  readonly selector: PolicyScopeSelector;
  readonly matches: boolean;
  readonly matchedDimensions: readonly PolicyScopeDimension[];
  readonly mismatchDimension: PolicyScopeDimension | null;
  readonly precedenceVector: readonly number[];
  readonly specificityScore: number;
  readonly selectorLabel: string;
}

export interface ResolvedPolicyActivationCandidate {
  readonly activation: PolicyActivationRecord;
  readonly match: PolicyScopeMatchResult;
}

export interface PolicyActivationPrecedenceResolution {
  readonly request: PolicyActivationTarget;
  readonly matchedCandidates: readonly ResolvedPolicyActivationCandidate[];
  readonly winner: ResolvedPolicyActivationCandidate | null;
  readonly ambiguousTopCandidates: readonly ResolvedPolicyActivationCandidate[];
}

const PRECEDENCE_DIMENSION_ACCESSORS: Readonly<
  Record<PolicyScopePrecedenceDimension, (selector: PolicyScopeSelector) => string | null>
> = Object.freeze({
  account: (selector) => selector.accountId,
  tenant: (selector) => selector.tenantId,
  wedge: (selector) => selector.wedgeId,
  domain: (selector) => selector.domainId,
  'risk-class': (selector) => selector.riskClass,
  'consequence-type': (selector) => selector.consequenceType,
  cohort: (selector) => selector.cohortId,
  plan: (selector) => selector.planId,
});

function selectorValue(
  selector: PolicyScopeSelector | PolicyActivationTarget,
  dimension: PolicyScopeDimension,
): string | null {
  switch (dimension) {
    case 'environment':
      return selector.environment;
    case 'tenant':
      return selector.tenantId;
    case 'account':
      return selector.accountId;
    case 'domain':
      return selector.domainId;
    case 'wedge':
      return selector.wedgeId;
    case 'consequence-type':
      return selector.consequenceType;
    case 'risk-class':
      return selector.riskClass;
    case 'cohort':
      return selector.cohortId;
    case 'plan':
      return selector.planId;
  }
}

function precedenceVectorForSelector(
  selector: PolicyScopeSelector,
): readonly number[] {
  const vector = POLICY_SCOPE_PRECEDENCE_ORDER.map((dimension) =>
    PRECEDENCE_DIMENSION_ACCESSORS[dimension](selector) ? 1 : 0,
  );
  return Object.freeze([...vector, selector.dimensions.length]);
}

function specificityScoreForSelector(selector: PolicyScopeSelector): number {
  return POLICY_SCOPE_PRECEDENCE_ORDER.reduce((score, dimension, index) => {
    return score + (PRECEDENCE_DIMENSION_ACCESSORS[dimension](selector) ? 2 ** (8 - index) : 0);
  }, selector.dimensions.length);
}

export function policyScopePrecedenceDescriptor(): PolicyScopePrecedenceDescriptor {
  return Object.freeze({
    version: POLICY_SCOPE_PRECEDENCE_SPEC_VERSION,
    mandatoryExactBoundary: ['environment'] as const,
    wildcardSemantics: 'null-means-unscoped',
    precedenceOrder: POLICY_SCOPE_PRECEDENCE_ORDER,
    hierarchyRules: Object.freeze([
      'Environment is mandatory and must always match exactly; there is no cross-environment fallback.',
      'A null dimension inside a selector means the selector is unscoped on that dimension and therefore acts as a wildcard.',
      'Account scope requires tenant scope and overrides broader tenant-wide matches when both apply.',
      'Wedge scope requires domain scope and overrides broader domain-wide matches when both apply.',
      'Risk-class scope requires consequence-type scope and overrides broader consequence-wide matches when both apply.',
      'Cohort scope is an optional rollout discriminator that can narrow a bundle without overriding explicit identity or domain/consequence-specific matches.',
      'Plan scope is optional and acts as the lowest-precedence optional discriminator after identity, wedge/domain, consequence scope, and cohort selection.',
      'If two matching activations have identical precedence vectors, resolution is ambiguous and must be treated as a control-plane conflict rather than resolved implicitly.',
    ]),
  });
}

export function matchPolicyScope(
  request: PolicyActivationTarget,
  selectorOrTarget: PolicyScopeSelector | PolicyActivationTarget,
): PolicyScopeMatchResult {
  const selector =
    'dimensions' in selectorOrTarget
      ? selectorOrTarget
      : createPolicyScopeSelector(selectorOrTarget);
  const matchedDimensions: PolicyScopeDimension[] = ['environment'];

  if (request.environment !== selector.environment) {
    return Object.freeze({
      request,
      selector,
      matches: false,
      matchedDimensions: Object.freeze([]),
      mismatchDimension: 'environment',
      precedenceVector: precedenceVectorForSelector(selector),
      specificityScore: specificityScoreForSelector(selector),
      selectorLabel: policyActivationTargetLabel(selector),
    });
  }

  for (const dimension of selector.dimensions) {
    if (dimension === 'environment') {
      continue;
    }

    const selectorDimensionValue = selectorValue(selector, dimension);
    if (selectorDimensionValue === null) {
      continue;
    }

    const requestValue = selectorValue(request, dimension);
    if (requestValue !== selectorDimensionValue) {
      return Object.freeze({
        request,
        selector,
        matches: false,
        matchedDimensions: Object.freeze([...matchedDimensions]),
        mismatchDimension: dimension,
        precedenceVector: precedenceVectorForSelector(selector),
        specificityScore: specificityScoreForSelector(selector),
        selectorLabel: policyActivationTargetLabel(selector),
      });
    }

    matchedDimensions.push(dimension);
  }

  return Object.freeze({
    request,
    selector,
    matches: true,
    matchedDimensions: Object.freeze(matchedDimensions),
    mismatchDimension: null,
    precedenceVector: precedenceVectorForSelector(selector),
    specificityScore: specificityScoreForSelector(selector),
    selectorLabel: policyActivationTargetLabel(selector),
  });
}

export function comparePolicyScopeMatches(
  left: PolicyScopeMatchResult,
  right: PolicyScopeMatchResult,
): number {
  const maxLength = Math.max(left.precedenceVector.length, right.precedenceVector.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left.precedenceVector[index] ?? 0;
    const rightValue = right.precedenceVector[index] ?? 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return left.selectorLabel.localeCompare(right.selectorLabel);
}

export function resolvePolicyActivationPrecedence(
  request: PolicyActivationTarget,
  activations: readonly PolicyActivationRecord[],
): PolicyActivationPrecedenceResolution {
  const matchedCandidates = Object.freeze(
    activations
      .map((activation) => ({
        activation,
        match: matchPolicyScope(request, activation.selector),
      }))
      .filter((candidate) => candidate.match.matches)
      .sort((left, right) => comparePolicyScopeMatches(left.match, right.match)),
  );

  if (matchedCandidates.length === 0) {
    return Object.freeze({
      request,
      matchedCandidates,
      winner: null,
      ambiguousTopCandidates: Object.freeze([]),
    });
  }

  const [topCandidate] = matchedCandidates;
  if (!topCandidate) {
    return Object.freeze({
      request,
      matchedCandidates,
      winner: null,
      ambiguousTopCandidates: Object.freeze([]),
    });
  }

  const ambiguousTopCandidates = matchedCandidates.filter(
    (candidate) =>
      comparePolicyScopeMatches(candidate.match, topCandidate.match) === 0 &&
      candidate.match.selectorLabel === topCandidate.match.selectorLabel,
  );

  return Object.freeze({
    request,
    matchedCandidates,
    winner: ambiguousTopCandidates.length === 1 ? topCandidate : null,
    ambiguousTopCandidates:
      ambiguousTopCandidates.length > 1
        ? Object.freeze([...ambiguousTopCandidates])
        : Object.freeze([]),
  });
}
