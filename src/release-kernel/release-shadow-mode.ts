import type { ReleaseDecisionStatus } from './types.js';
import { consequenceRolloutProfile } from './consequence-rollout.js';
import type {
  ReleaseDeterministicEvaluationResult,
  ReleaseDecisionEngine,
  ReleaseEvaluationPhase,
  ReleaseEvaluationRequest,
} from './release-decision-engine.js';
import { createReleaseDecisionEngine } from './release-decision-engine.js';
import type { DeterministicCheckObservation } from './release-deterministic-checks.js';
import type {
  ReleasePolicyRolloutEvaluationMode,
  ReleasePolicyRolloutMode,
} from './release-policy-rollout.js';
import { riskControlProfile } from './risk-controls.js';

/**
 * Shadow-mode release evaluation.
 *
 * This layer lets Attestor compute the full release outcome without yet
 * blocking the downstream consequence path. It exists so teams can calibrate
 * false positives, review load, and enforcement readiness before turning on
 * fail-closed gateway behavior.
 */

export const RELEASE_SHADOW_MODE_SPEC_VERSION = 'attestor.release-shadow-mode.v1';

export type ShadowReleaseOutcome = 'pass-through' | 'pass-through-with-warning';
export type ShadowReleaseSeverity = 'info' | 'warn' | 'critical';
export type ShadowEnforcementReadiness =
  | 'hard-gate-eligible'
  | 'shadow-first'
  | 'advisory-only';

export interface ShadowReleaseSignal {
  readonly code: string;
  readonly severity: ShadowReleaseSeverity;
  readonly message: string;
}

export interface ShadowReleaseEvaluationResult {
  readonly version: typeof RELEASE_SHADOW_MODE_SPEC_VERSION;
  readonly mode: 'shadow';
  readonly outcome: ShadowReleaseOutcome;
  readonly severity: ShadowReleaseSeverity;
  readonly passThrough: true;
  readonly enforcementReadiness: ShadowEnforcementReadiness;
  readonly policyRolloutMode: ReleasePolicyRolloutMode | null;
  readonly policyEvaluationMode: ReleasePolicyRolloutEvaluationMode | null;
  readonly wouldDecisionStatus: ReleaseDecisionStatus;
  readonly wouldPhase: ReleaseEvaluationPhase;
  readonly wouldBlockIfEnforced: boolean;
  readonly wouldRequireReview: boolean;
  readonly wouldRequireToken: boolean;
  readonly evaluation: ReleaseDeterministicEvaluationResult;
  readonly signals: readonly ShadowReleaseSignal[];
  readonly auditAnnotations: Readonly<Record<string, string>>;
}

export interface ShadowModeReleaseEvaluator {
  evaluate(
    request: ReleaseEvaluationRequest,
    observation: DeterministicCheckObservation,
  ): ShadowReleaseEvaluationResult;
}

export interface CreateShadowModeReleaseEvaluatorInput {
  readonly engine?: ReleaseDecisionEngine;
}

function shadowEnforcementReadinessForRequest(
  request: ReleaseEvaluationRequest,
): ShadowEnforcementReadiness {
  const rollout = consequenceRolloutProfile(request.outputContract.consequenceType);
  switch (rollout.rolloutMode) {
    case 'hard-gate-first':
      return 'hard-gate-eligible';
    case 'shadow-first-then-hard-gate':
      return 'shadow-first';
    case 'advisory-first-until-boundary':
      return 'advisory-only';
  }
}

function wouldBlockIfEnforced(status: ReleaseDecisionStatus, readiness: ShadowEnforcementReadiness): boolean {
  if (readiness === 'advisory-only') {
    return false;
  }

  return status === 'denied' || status === 'hold' || status === 'review-required';
}

function wouldRequireReview(result: ReleaseDeterministicEvaluationResult): boolean {
  return result.plan.requiresReview || result.decision.status === 'review-required';
}

function wouldRequireToken(request: ReleaseEvaluationRequest): boolean {
  const risk = riskControlProfile(request.outputContract.riskClass);
  const rollout = consequenceRolloutProfile(request.outputContract.consequenceType);
  return (
    rollout.hardGateEligible &&
    (risk.token.minimumEnforcement === 'required' ||
      risk.token.minimumEnforcement === 'required-with-introspection')
  );
}

function buildSignals(
  result: ReleaseDeterministicEvaluationResult,
  readiness: ShadowEnforcementReadiness,
  requireReview: boolean,
  requireToken: boolean,
): readonly ShadowReleaseSignal[] {
  const signals: ShadowReleaseSignal[] = [];
  const rolloutMode = result.plan.rolloutMode;
  const rolloutEvaluationMode = result.plan.rolloutEvaluationMode;

  if (rolloutMode === 'dry-run' && rolloutEvaluationMode === 'shadow') {
    signals.push({
      code: 'shadow_rollout_dry_run',
      severity: 'warn',
      message:
        'The matched release policy is currently in dry-run mode, so this request is being evaluated for evidence and readiness without live enforcement.',
    });
  }

  if (rolloutMode === 'canary' && rolloutEvaluationMode === 'shadow') {
    signals.push({
      code: 'shadow_rollout_canary',
      severity: 'warn',
      message:
        'The matched release policy is in canary rollout mode and this request fell outside the current enforced cohort.',
    });
  }

  if (rolloutMode === 'rolled-back') {
    signals.push({
      code: 'shadow_rollout_rollback',
      severity: 'warn',
      message:
        'The matched release policy is under rollback control, so Attestor is preserving shadow visibility while avoiding unconditional enforcement drift.',
    });
  }

  if (readiness === 'advisory-only') {
    signals.push({
      code: 'shadow_advisory_only',
      severity: 'info',
      message:
        'This consequence type remains advisory-first until a concrete downstream release boundary exists.',
    });
  }

  if (requireToken) {
    signals.push({
      code: 'shadow_token_required',
      severity: 'warn',
      message: 'Hard enforcement would require a downstream-verified release token on this path.',
    });
  }

  if (requireReview) {
    signals.push({
      code: 'shadow_review_required',
      severity: 'warn',
      message: 'Hard enforcement would pause this release for named or dual human review.',
    });
  }

  if (wouldBlockIfEnforced(result.decision.status, readiness)) {
    signals.push({
      code: 'shadow_would_block',
      severity: result.decision.status === 'denied' ? 'critical' : 'warn',
      message: `Hard enforcement would not pass this release through immediately because the computed status is ${result.decision.status}.`,
    });
  }

  return signals;
}

function aggregateSeverity(signals: readonly ShadowReleaseSignal[]): ShadowReleaseSeverity {
  if (signals.some((signal) => signal.severity === 'critical')) {
    return 'critical';
  }

  if (signals.some((signal) => signal.severity === 'warn')) {
    return 'warn';
  }

  return 'info';
}

function buildAuditAnnotations(
  result: ReleaseDeterministicEvaluationResult,
  readiness: ShadowEnforcementReadiness,
  requireReview: boolean,
  requireToken: boolean,
): Readonly<Record<string, string>> {
  return Object.freeze({
    'attestor.io/shadow-mode': 'true',
    'attestor.io/would-decision-status': result.decision.status,
    'attestor.io/would-phase': result.plan.phase,
    'attestor.io/would-block-if-enforced': String(
      wouldBlockIfEnforced(result.decision.status, readiness),
    ),
    'attestor.io/would-require-review': String(requireReview),
    'attestor.io/would-require-token': String(requireToken),
    'attestor.io/enforcement-readiness': readiness,
    'attestor.io/policy-rollout-mode': result.plan.rolloutMode ?? 'none',
    'attestor.io/policy-evaluation-mode': result.plan.rolloutEvaluationMode ?? 'none',
    'attestor.io/effective-policy-id': result.plan.effectivePolicyId ?? 'none',
  });
}

export function createShadowModeReleaseEvaluator(
  input: CreateShadowModeReleaseEvaluatorInput = {},
): ShadowModeReleaseEvaluator {
  const engine = input.engine ?? createReleaseDecisionEngine();

  return {
    evaluate(
      request: ReleaseEvaluationRequest,
      observation: DeterministicCheckObservation,
    ): ShadowReleaseEvaluationResult {
      const evaluation = engine.evaluateWithDeterministicChecks(request, observation);
      const readiness = shadowEnforcementReadinessForRequest(request);
      const requireReview = wouldRequireReview(evaluation);
      const requireToken = wouldRequireToken(request);
      const signals = buildSignals(evaluation, readiness, requireReview, requireToken);
      const severity = aggregateSeverity(signals);

      return {
        version: RELEASE_SHADOW_MODE_SPEC_VERSION,
        mode: 'shadow',
        outcome: signals.length === 0 ? 'pass-through' : 'pass-through-with-warning',
        severity,
        passThrough: true,
        enforcementReadiness: readiness,
        policyRolloutMode: evaluation.plan.rolloutMode,
        policyEvaluationMode: evaluation.plan.rolloutEvaluationMode,
        wouldDecisionStatus: evaluation.decision.status,
        wouldPhase: evaluation.plan.phase,
        wouldBlockIfEnforced: wouldBlockIfEnforced(evaluation.decision.status, readiness),
        wouldRequireReview: requireReview,
        wouldRequireToken: requireToken,
        evaluation,
        signals,
        auditAnnotations: buildAuditAnnotations(
          evaluation,
          readiness,
          requireReview,
          requireToken,
        ),
      };
    },
  };
}
