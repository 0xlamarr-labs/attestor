/**
 * Review Policy v1 — Evidence-aware escalation for financial governance.
 *
 * Goes beyond static materiality-based oversight.
 * Evaluates evidence from the pipeline run to determine whether human review
 * is required, based on configurable policy triggers.
 *
 * Default triggers:
 * - High materiality tier
 * - Reconciliation/control-total failures
 * - Provenance mismatches
 * - Sensitive schema access
 * - Audit integrity failures
 * - Excessive warning count
 */

import type {
  FinancialQueryIntent,
  ReviewTrigger,
  ReviewPolicyResult,
  SqlGovernanceResult,
  DataContractResult,
  ReportValidationResult,
  AuditTrail,
  FinancialScore,
} from './types.js';

/** Default review triggers when none are specified on the intent. */
const DEFAULT_TRIGGERS: ReviewTrigger[] = [
  { id: 'mat_high', description: 'High materiality tier', condition: 'materiality_high' },
  { id: 'recon_fail', description: 'Reconciliation or control-total failure', condition: 'reconciliation_failure' },
  { id: 'prov_mismatch', description: 'Report provenance mismatch', condition: 'provenance_mismatch' },
  { id: 'sensitive_schema', description: 'Sensitive schema access attempted', condition: 'sensitive_schema_access' },
  { id: 'audit_broken', description: 'Audit trail integrity failure', condition: 'audit_integrity_failure' },
];

export interface ReviewPolicyContext {
  intent: FinancialQueryIntent;
  sqlGovernance: SqlGovernanceResult;
  dataContract: DataContractResult | null;
  reportValidation: ReportValidationResult | null;
  audit: AuditTrail;
  scores: FinancialScore[];
}

/**
 * Evaluate review policy against pipeline evidence.
 * Returns whether review is required and which triggers fired.
 */
export function evaluateReviewPolicy(ctx: ReviewPolicyContext): ReviewPolicyResult {
  const triggers = ctx.intent.reviewTriggers ?? DEFAULT_TRIGGERS;
  const fired: string[] = [];

  for (const trigger of triggers) {
    if (checkTrigger(trigger, ctx)) {
      fired.push(trigger.id);
    }
  }

  return {
    required: fired.length > 0,
    approved: false,
    rejected: false,
    triggeredBy: fired,
    reason: fired.length > 0
      ? `Review required: ${fired.join(', ')}`
      : 'No review triggers fired — automated governance sufficient',
  };
}

/**
 * Post-score review evaluation.
 * Re-evaluates score-dependent triggers (like warning_count_exceeds)
 * after the scoring cascade has run, and merges into the existing policy result.
 *
 * This fixes the ordering issue: pre-score evaluation runs before scoring
 * (for evidence-based triggers), post-score runs after (for score-dependent triggers).
 */
export function mergePostScoreReview(
  existing: ReviewPolicyResult,
  ctx: ReviewPolicyContext,
): ReviewPolicyResult {
  const triggers = ctx.intent.reviewTriggers ?? DEFAULT_TRIGGERS;
  const scoreDependent = triggers.filter((t) =>
    t.condition === 'warning_count_exceeds',
  );

  const newFired: string[] = [];
  for (const trigger of scoreDependent) {
    if (checkTrigger(trigger, ctx) && !existing.triggeredBy.includes(trigger.id)) {
      newFired.push(trigger.id);
    }
  }

  if (newFired.length === 0) return existing;

  const allTriggers = [...existing.triggeredBy, ...newFired];
  return {
    ...existing,
    required: true,
    triggeredBy: allTriggers,
    reason: `Review required: ${allTriggers.join(', ')}`,
  };
}

function checkTrigger(trigger: ReviewTrigger, ctx: ReviewPolicyContext): boolean {
  switch (trigger.condition) {
    case 'materiality_high':
      return (ctx.intent.materialityTier ?? 'medium') === 'high';

    case 'reconciliation_failure': {
      if (!ctx.dataContract) return false;
      const reconChecks = ctx.dataContract.checks.filter((c) =>
        c.check.startsWith('sum_equals') || c.check.startsWith('range'),
      );
      return reconChecks.some((c) => !c.passed);
    }

    case 'provenance_mismatch':
      return (ctx.reportValidation?.provenance ?? []).some((p) => !p.matches);

    case 'sensitive_schema_access': {
      const forbidden = ctx.intent.forbiddenSchemas.map((s) => s.toLowerCase());
      return ctx.sqlGovernance.referencedTables.some((r) =>
        r.schema && forbidden.includes(r.schema),
      );
    }

    case 'audit_integrity_failure':
      return !ctx.audit.chainIntact;

    case 'warning_count_exceeds': {
      const warnCount = ctx.scores.filter((s) => s.value === 'warn').length;
      return warnCount > (trigger.threshold ?? 2);
    }

    case 'control_total_breach': {
      if (!ctx.dataContract) return false;
      return ctx.dataContract.checks
        .filter((c) => c.check.startsWith('sum_equals') || c.check.startsWith('control_total'))
        .some((c) => !c.passed);
    }

    default:
      return false;
  }
}
