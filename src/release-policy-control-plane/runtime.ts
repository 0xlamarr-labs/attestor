import type {
  ReleaseDecisionLogPhase,
  ReleaseDecisionLogWriter,
} from '../release-kernel/release-decision-log.js';
import type {
  ReleaseDeterministicEvaluationResult,
  ReleaseDecisionEngine,
  ReleaseEvaluationRequest,
  ReleaseEvaluationResult,
} from '../release-kernel/release-decision-engine.js';
import {
  createReleaseDecisionEngine,
  RELEASE_DECISION_ENGINE_SPEC_VERSION,
} from '../release-kernel/release-decision-engine.js';
import type { DeterministicCheckObservation } from '../release-kernel/release-deterministic-checks.js';
import type { ReleaseFinding } from '../release-kernel/object-model.js';
import { createReleaseDecisionSkeleton } from '../release-kernel/object-model.js';
import { resolveActivePolicy, type ActivePolicyResolutionStatus } from './resolver.js';
import type { PolicyControlPlaneStore } from './store.js';
import type { PolicyActivationTarget } from './types.js';

/**
 * Runtime bridge from the policy control plane into the release decision engine.
 *
 * Step 18 needs real finance consequence flows to resolve policy through the
 * signed bundle + activation surface. This adapter lets the existing release
 * engine keep doing deterministic evaluation while the effective policy now
 * comes from control-plane discovery and resolution instead of direct in-process
 * policy factory selection.
 */

export const CONTROL_PLANE_RUNTIME_ENGINE_SPEC_VERSION =
  'attestor.policy-control-plane-runtime.v1';

export interface CreateControlPlaneBackedReleaseDecisionEngineInput {
  readonly store: PolicyControlPlaneStore;
  readonly resolveTarget: (request: ReleaseEvaluationRequest) => PolicyActivationTarget;
  readonly decisionLog?: ReleaseDecisionLogWriter;
}

function buildRolloutContext(request: ReleaseEvaluationRequest) {
  return {
    requestId: request.id,
    outputHash: request.outputHash,
    requesterId: request.requester.id,
    targetId: request.target.id,
    tenantId: request.context?.tenantId ?? null,
    accountId: request.context?.accountId ?? null,
    planId: request.context?.planId ?? null,
    cohortId: request.context?.cohortId ?? null,
  } as const;
}

function buildResolutionFinding(status: ActivePolicyResolutionStatus): ReleaseFinding {
  switch (status) {
    case 'policy-scope-frozen':
      return {
        code: 'policy_scope_frozen',
        result: 'fail',
        message:
          'The matched policy scope is frozen by the control plane, so Attestor is failing closed for this release request.',
        source: 'policy',
      };
    case 'bundle-resolution-failed':
      return {
        code: 'policy_bundle_resolution_failed',
        result: 'fail',
        message:
          'Attestor could not resolve an active policy bundle for this release request scope, so the release cannot proceed.',
        source: 'policy',
      };
    case 'incompatible-bundle':
      return {
        code: 'policy_bundle_incompatible',
        result: 'fail',
        message:
          'The resolved policy bundle is incompatible with the current release-layer/runtime surface, so the release is denied.',
        source: 'policy',
      };
    case 'no-policy-entry':
      return {
        code: 'policy_entry_missing',
        result: 'fail',
        message:
          'No active policy entry in the resolved bundle matched this release scope, so the request is denied.',
        source: 'policy',
      };
    case 'ambiguous-policy-entry':
      return {
        code: 'policy_entry_ambiguous',
        result: 'fail',
        message:
          'Multiple active policy entries matched this release scope with the same precedence, so Attestor is failing closed.',
        source: 'policy',
      };
    case 'resolved':
      return {
        code: 'policy_resolution_unexpected',
        result: 'fail',
        message:
          'The control-plane runtime adapter reached an unexpected resolved-state failure path.',
        source: 'policy',
      };
  }
}

function createFailedResolutionResult(
  request: ReleaseEvaluationRequest,
  status: ActivePolicyResolutionStatus,
): ReleaseEvaluationResult {
  const policyId = `control-plane.${status}`;
  const decision = createReleaseDecisionSkeleton({
    id: request.id,
    createdAt: request.createdAt,
    status: 'denied',
    policyVersion: policyId,
    policyHash: policyId,
    outputHash: request.outputHash,
    consequenceHash: request.consequenceHash,
    outputContract: request.outputContract,
    capabilityBoundary: request.capabilityBoundary,
    requester: request.requester,
    target: request.target,
    findings: [buildResolutionFinding(status)],
  });

  return Object.freeze({
    version: RELEASE_DECISION_ENGINE_SPEC_VERSION,
    matchedPolicyId: null,
    policyMatched: false,
    decision,
    plan: {
      phase: 'terminal-deny' as const,
      pendingChecks: Object.freeze([]),
      pendingEvidenceKinds: Object.freeze([]),
      requiresReview: false,
      policyId: null,
      effectivePolicyId: null,
      rolloutMode: null,
      rolloutEvaluationMode: null,
      rolloutReason: null,
      rolloutCanaryBucket: null,
      rolloutFallbackPolicyId: null,
    },
  });
}

function appendDecisionLog(
  writer: ReleaseDecisionLogWriter | undefined,
  request: ReleaseEvaluationRequest,
  result: ReleaseEvaluationResult,
  phase: ReleaseDecisionLogPhase,
  deterministicChecksCompleted: boolean,
): void {
  writer?.append({
    occurredAt: request.createdAt,
    requestId: request.id,
    phase,
    matchedPolicyId: result.matchedPolicyId,
    decision: result.decision,
    metadata: {
      policyMatched: result.policyMatched,
      pendingChecks: result.plan.pendingChecks,
      pendingEvidenceKinds: result.plan.pendingEvidenceKinds,
      requiresReview: result.plan.requiresReview,
      deterministicChecksCompleted,
      effectivePolicyId: result.plan.effectivePolicyId,
      rolloutMode: result.plan.rolloutMode,
      rolloutEvaluationMode: result.plan.rolloutEvaluationMode,
      rolloutReason: result.plan.rolloutReason,
      rolloutCanaryBucket: result.plan.rolloutCanaryBucket,
      rolloutFallbackPolicyId: result.plan.rolloutFallbackPolicyId,
    },
  });
}

function resolveControlPlanePolicy(
  store: PolicyControlPlaneStore,
  resolveTarget: (request: ReleaseEvaluationRequest) => PolicyActivationTarget,
  request: ReleaseEvaluationRequest,
) {
  return resolveActivePolicy(store, {
    target: resolveTarget(request),
    outputContract: request.outputContract,
    capabilityBoundary: request.capabilityBoundary,
    targetKind: request.target.kind,
    rolloutContext: buildRolloutContext(request),
  });
}

export function createControlPlaneBackedReleaseDecisionEngine(
  input: CreateControlPlaneBackedReleaseDecisionEngineInput,
): ReleaseDecisionEngine {
  return {
    evaluate(request: ReleaseEvaluationRequest): ReleaseEvaluationResult {
      const resolution = resolveControlPlanePolicy(input.store, input.resolveTarget, request);
      if (resolution.status !== 'resolved' || !resolution.effectivePolicy) {
        const failed = createFailedResolutionResult(request, resolution.status);
        appendDecisionLog(input.decisionLog, request, failed, 'policy-resolution', false);
        return failed;
      }

      const engine = createReleaseDecisionEngine({
        policies: [resolution.effectivePolicy],
      });
      const result = engine.evaluate(request);
      appendDecisionLog(input.decisionLog, request, result, 'policy-resolution', false);
      return result;
    },

    evaluateWithDeterministicChecks(
      request: ReleaseEvaluationRequest,
      observation: DeterministicCheckObservation,
    ): ReleaseDeterministicEvaluationResult {
      const resolution = resolveControlPlanePolicy(input.store, input.resolveTarget, request);
      if (resolution.status !== 'resolved' || !resolution.effectivePolicy) {
        const failed = createFailedResolutionResult(request, resolution.status);
        appendDecisionLog(input.decisionLog, request, failed, 'policy-resolution', false);
        return Object.freeze({
          ...failed,
          deterministicChecksCompleted: false,
        });
      }

      const engine = createReleaseDecisionEngine({
        policies: [resolution.effectivePolicy],
      });
      const initial = engine.evaluate(request);
      appendDecisionLog(input.decisionLog, request, initial, 'policy-resolution', false);
      const result = engine.evaluateWithDeterministicChecks(request, observation);
      appendDecisionLog(input.decisionLog, request, result, 'deterministic-checks', true);
      return result;
    },
  };
}
