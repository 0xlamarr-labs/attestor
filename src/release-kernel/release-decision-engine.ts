import type {
  ReleaseActorReference,
  ReleaseDecision,
  ReleaseFinding,
  ReleaseTargetReference,
} from './object-model.js';
import { createReleaseDecisionSkeleton } from './object-model.js';
import type { DeterministicCheckObservation } from './release-deterministic-checks.js';
import {
  applyDeterministicCheckReport,
  runDeterministicReleaseChecks,
} from './release-deterministic-checks.js';
import type { DeterministicControlCategory } from './risk-controls.js';
import type { ReleasePolicyDefinition } from './release-policy.js';
import {
  createFirstHardGatewayReleasePolicy,
  matchesReleasePolicyScope,
} from './release-policy.js';
import type { CapabilityBoundaryDescriptor, OutputContractDescriptor } from './types.js';

/**
 * Release decision engine skeleton.
 *
 * This is the first policy decision point for the release layer. It does not
 * execute deterministic checks yet; instead, it resolves the matching policy,
 * stamps an initial decision skeleton, and returns the next evaluation work
 * that later steps must complete.
 */

export const RELEASE_DECISION_ENGINE_SPEC_VERSION = 'attestor.release-decision-engine.v1';

export type ReleaseEvaluationPhase =
  | 'policy-resolution'
  | 'deterministic-checks'
  | 'review'
  | 'terminal-accept'
  | 'terminal-deny';

export interface ReleaseEvaluationRequest {
  readonly id: string;
  readonly createdAt: string;
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly outputContract: OutputContractDescriptor;
  readonly capabilityBoundary: CapabilityBoundaryDescriptor;
  readonly requester: ReleaseActorReference;
  readonly target: ReleaseTargetReference;
}

export interface ReleaseEvaluationPlan {
  readonly phase: ReleaseEvaluationPhase;
  readonly pendingChecks: readonly DeterministicControlCategory[];
  readonly pendingEvidenceKinds: readonly string[];
  readonly requiresReview: boolean;
  readonly policyId: string | null;
}

export interface ReleaseEvaluationResult {
  readonly version: typeof RELEASE_DECISION_ENGINE_SPEC_VERSION;
  readonly matchedPolicyId: string | null;
  readonly policyMatched: boolean;
  readonly decision: ReleaseDecision;
  readonly plan: ReleaseEvaluationPlan;
}

export interface ReleaseDeterministicEvaluationResult extends ReleaseEvaluationResult {
  readonly deterministicChecksCompleted: boolean;
}

export interface ReleaseDecisionEngine {
  evaluate(input: ReleaseEvaluationRequest): ReleaseEvaluationResult;
  evaluateWithDeterministicChecks(
    input: ReleaseEvaluationRequest,
    observation: DeterministicCheckObservation,
  ): ReleaseDeterministicEvaluationResult;
}

export interface CreateReleaseDecisionEngineInput {
  readonly policies?: readonly ReleasePolicyDefinition[];
}

function buildPolicyScopeMismatchFinding(): ReleaseFinding {
  return {
    code: 'policy_scope_mismatch',
    result: 'fail',
    message:
      'No active release policy matched the requested consequence, risk, target kind, and output contract.',
    source: 'policy',
  };
}

function buildPendingChecksFinding(policyId: string): ReleaseFinding {
  return {
    code: 'deterministic_checks_pending',
    result: 'info',
    message: `Release policy ${policyId} matched. Deterministic release checks must run before final release.`,
    source: 'policy',
  };
}

export function resolveMatchingReleasePolicy(
  policies: readonly ReleasePolicyDefinition[],
  input: ReleaseEvaluationRequest,
): ReleasePolicyDefinition | null {
  return (
    policies.find(
      (policy) =>
        policy.status === 'active' &&
        matchesReleasePolicyScope(
          policy,
          input.outputContract,
          input.capabilityBoundary,
          input.target.kind,
        ),
    ) ?? null
  );
}

export function evaluateReleaseDecisionSkeleton(
  input: ReleaseEvaluationRequest,
  policies: readonly ReleasePolicyDefinition[],
): ReleaseEvaluationResult {
  const matchedPolicy = resolveMatchingReleasePolicy(policies, input);

  if (!matchedPolicy) {
    const decision = createReleaseDecisionSkeleton({
      id: input.id,
      createdAt: input.createdAt,
      status: 'denied',
      policyVersion: 'unmatched',
      policyHash: 'unmatched',
      outputHash: input.outputHash,
      consequenceHash: input.consequenceHash,
      outputContract: input.outputContract,
      capabilityBoundary: input.capabilityBoundary,
      requester: input.requester,
      target: input.target,
      findings: [buildPolicyScopeMismatchFinding()],
    });

    return {
      version: RELEASE_DECISION_ENGINE_SPEC_VERSION,
      matchedPolicyId: null,
      policyMatched: false,
      decision,
      plan: {
        phase: 'terminal-deny',
        pendingChecks: [],
        pendingEvidenceKinds: [],
        requiresReview: false,
        policyId: null,
      },
    };
  }

  const requiresReview =
    matchedPolicy.release.reviewMode === 'named-reviewer' ||
    matchedPolicy.release.reviewMode === 'dual-approval';

  const decision = createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: input.createdAt,
    status: 'hold',
    policyVersion: matchedPolicy.id,
    policyHash: matchedPolicy.id,
    outputHash: input.outputHash,
    consequenceHash: input.consequenceHash,
    outputContract: input.outputContract,
    capabilityBoundary: input.capabilityBoundary,
    requester: input.requester,
    target: input.target,
    findings: [buildPendingChecksFinding(matchedPolicy.id)],
  });

  return {
    version: RELEASE_DECISION_ENGINE_SPEC_VERSION,
    matchedPolicyId: matchedPolicy.id,
    policyMatched: true,
    decision,
    plan: {
      phase: 'deterministic-checks',
      pendingChecks: matchedPolicy.acceptance.requiredChecks,
      pendingEvidenceKinds: matchedPolicy.acceptance.requiredEvidenceKinds,
      requiresReview,
      policyId: matchedPolicy.id,
    },
  };
}

export function createReleaseDecisionEngine(
  input: CreateReleaseDecisionEngineInput = {},
): ReleaseDecisionEngine {
  const policies = input.policies ?? [createFirstHardGatewayReleasePolicy()];

  return {
    evaluate(request: ReleaseEvaluationRequest): ReleaseEvaluationResult {
      return evaluateReleaseDecisionSkeleton(request, policies);
    },
    evaluateWithDeterministicChecks(
      request: ReleaseEvaluationRequest,
      observation: DeterministicCheckObservation,
    ): ReleaseDeterministicEvaluationResult {
      const initial = evaluateReleaseDecisionSkeleton(request, policies);

      if (!initial.policyMatched || initial.matchedPolicyId === null) {
        return {
          ...initial,
          deterministicChecksCompleted: false,
        };
      }

      const matchedPolicy = resolveMatchingReleasePolicy(policies, request);
      if (!matchedPolicy) {
        return {
          ...initial,
          deterministicChecksCompleted: false,
        };
      }

      const report = runDeterministicReleaseChecks(matchedPolicy, initial.decision, observation);
      const decision = applyDeterministicCheckReport(initial.decision, report);

      return {
        version: initial.version,
        matchedPolicyId: initial.matchedPolicyId,
        policyMatched: true,
        decision,
        plan: {
          phase: report.nextPhase,
          pendingChecks: [],
          pendingEvidenceKinds: [],
          requiresReview: report.nextPhase === 'review',
          policyId: initial.matchedPolicyId,
        },
        deterministicChecksCompleted: true,
      };
    },
  };
}
