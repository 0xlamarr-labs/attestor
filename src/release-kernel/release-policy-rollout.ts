import { createHash } from 'node:crypto';

/**
 * Policy rollout controls for the release layer.
 *
 * This separates "what policy says" from "how aggressively that policy is
 * currently being enforced". The model borrows from modern admission-policy
 * rollout ideas such as warn/audit/deny splits and canary-style staged
 * adoption, while staying deterministic and request-bound inside Attestor's
 * release kernel.
 */

export const RELEASE_POLICY_ROLLOUT_SPEC_VERSION = 'attestor.release-policy-rollout.v1';

export type ReleasePolicyRolloutMode = 'dry-run' | 'canary' | 'enforce' | 'rolled-back';
export type ReleasePolicyRolloutEvaluationMode = 'shadow' | 'enforce';
export type ReleasePolicyRolloutCohortKey =
  | 'request-id'
  | 'output-hash'
  | 'requester-id'
  | 'target-id';

export interface ReleasePolicyRolloutDefinition {
  readonly version: typeof RELEASE_POLICY_ROLLOUT_SPEC_VERSION;
  readonly mode: ReleasePolicyRolloutMode;
  readonly canaryPercentage: number;
  readonly cohortKey: ReleasePolicyRolloutCohortKey;
  readonly cohortSalt: string;
  readonly activatedAt: string | null;
  readonly fallbackPolicyId: string | null;
  readonly notes: readonly string[];
}

export interface CreateReleasePolicyRolloutInput {
  readonly mode: ReleasePolicyRolloutMode;
  readonly canaryPercentage?: number;
  readonly cohortKey?: ReleasePolicyRolloutCohortKey;
  readonly cohortSalt?: string;
  readonly activatedAt?: string | null;
  readonly fallbackPolicyId?: string | null;
  readonly notes?: readonly string[];
}

export interface ReleasePolicyRolloutEvaluationContext {
  readonly requestId: string;
  readonly outputHash: string;
  readonly requesterId: string;
  readonly targetId: string;
}

export interface ReleasePolicyRolloutResolution {
  readonly rolloutMode: ReleasePolicyRolloutMode;
  readonly evaluationMode: ReleasePolicyRolloutEvaluationMode;
  readonly reason:
    | 'dry-run'
    | 'canary-enforce'
    | 'canary-shadow'
    | 'enforce'
    | 'rolled-back';
  readonly canaryBucket: number | null;
}

function assertPercentage(percentage: number): void {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('Release policy rollout canaryPercentage must be between 0 and 100.');
  }
}

export function createReleasePolicyRollout(
  input: CreateReleasePolicyRolloutInput,
): ReleasePolicyRolloutDefinition {
  const canaryPercentage =
    input.mode === 'canary'
      ? (input.canaryPercentage ?? 0)
      : input.mode === 'enforce'
        ? 100
        : 0;

  assertPercentage(canaryPercentage);

  return {
    version: RELEASE_POLICY_ROLLOUT_SPEC_VERSION,
    mode: input.mode,
    canaryPercentage,
    cohortKey: input.cohortKey ?? 'request-id',
    cohortSalt: input.cohortSalt ?? 'attestor.release-policy-rollout',
    activatedAt: input.activatedAt ?? null,
    fallbackPolicyId: input.fallbackPolicyId ?? null,
    notes: input.notes ?? [],
  };
}

function rolloutCohortMaterial(
  rollout: ReleasePolicyRolloutDefinition,
  context: ReleasePolicyRolloutEvaluationContext,
): string {
  switch (rollout.cohortKey) {
    case 'request-id':
      return context.requestId;
    case 'output-hash':
      return context.outputHash;
    case 'requester-id':
      return context.requesterId;
    case 'target-id':
      return context.targetId;
  }
}

export function computeReleasePolicyCanaryBucket(
  rollout: ReleasePolicyRolloutDefinition,
  context: ReleasePolicyRolloutEvaluationContext,
): number {
  const material = `${rollout.cohortSalt}:${rollout.mode}:${rolloutCohortMaterial(rollout, context)}`;
  const digest = createHash('sha256').update(material).digest('hex');
  const basis = Number.parseInt(digest.slice(0, 8), 16);
  return basis % 10000;
}

export function resolveReleasePolicyRollout(
  rollout: ReleasePolicyRolloutDefinition,
  context: ReleasePolicyRolloutEvaluationContext,
): ReleasePolicyRolloutResolution {
  switch (rollout.mode) {
    case 'dry-run':
      return {
        rolloutMode: rollout.mode,
        evaluationMode: 'shadow',
        reason: 'dry-run',
        canaryBucket: null,
      };
    case 'enforce':
      return {
        rolloutMode: rollout.mode,
        evaluationMode: 'enforce',
        reason: 'enforce',
        canaryBucket: null,
      };
    case 'rolled-back':
      return {
        rolloutMode: rollout.mode,
        evaluationMode: 'shadow',
        reason: 'rolled-back',
        canaryBucket: null,
      };
    case 'canary': {
      const bucket = computeReleasePolicyCanaryBucket(rollout, context);
      const threshold = Math.round(rollout.canaryPercentage * 100);
      const evaluationMode = bucket < threshold ? 'enforce' : 'shadow';
      return {
        rolloutMode: rollout.mode,
        evaluationMode,
        reason: evaluationMode === 'enforce' ? 'canary-enforce' : 'canary-shadow',
        canaryBucket: bucket,
      };
    }
  }
}
