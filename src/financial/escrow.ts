/**
 * Authority Escrow v1.1 — Progressive release with review-outcome distinction.
 *
 * v1.1 fix: distinguishes pending vs explicitly rejected review.
 * A rejected review produces 'withheld' with a denial-specific reason,
 * not 'partial' like a pending review.
 *
 * States:
 * - held: no obligations released
 * - partial: some released, others pending (including review awaiting approval)
 * - released: all obligations fulfilled + no blocking conditions
 * - withheld: warrant violated, integrity failure, hard stops, OR authority explicitly denied
 */

import type { FinancialWarrant, AuthorityEscrow, EscrowRelease, EscrowState } from './types.js';

export type ReviewOutcome = 'not_required' | 'pending' | 'approved' | 'rejected';

/**
 * Build an escrow from warrant obligations and review outcome.
 */
export function buildEscrow(
  warrant: FinancialWarrant,
  auditChainIntact: boolean,
  reviewRequired: boolean,
  reviewApproved: boolean,
  reviewRejected: boolean,
  hardStops: number,
): AuthorityEscrow {
  const reviewOutcome: ReviewOutcome = !reviewRequired ? 'not_required'
    : reviewApproved ? 'approved'
    : reviewRejected ? 'rejected'
    : 'pending';

  const releases: EscrowRelease[] = warrant.evidenceObligations.map((ob) => ({
    obligationId: ob.id,
    released: ob.fulfilled,
    releasedBy: ob.fulfilled ? `pipeline_stage:${ob.id}` : 'not_released',
    releaseTimestamp: ob.fulfilled ? new Date().toISOString() : null,
  }));

  // Add synthetic review obligation if review is required
  if (reviewRequired) {
    releases.push({
      obligationId: 'human_review_completed',
      released: reviewOutcome === 'approved',
      releasedBy: reviewOutcome === 'approved' ? 'human_reviewer'
        : reviewOutcome === 'rejected' ? 'human_reviewer:denied'
        : 'not_released',
      releaseTimestamp: (reviewOutcome === 'approved' || reviewOutcome === 'rejected') ? new Date().toISOString() : null,
    });
  }

  const releasedCount = releases.filter((r) => r.released).length;
  const heldCount = releases.filter((r) => !r.released).length;
  const total = releases.length;

  let state: EscrowState;
  let stateReason: string;

  // Explicit denial: withheld with denial-specific reason
  if (reviewOutcome === 'rejected') {
    state = 'withheld';
    stateReason = 'Authority explicitly denied: human review rejected';
  } else if (warrant.status === 'violated') {
    state = 'withheld';
    stateReason = `Warrant violated: ${warrant.violations.join('; ')}`;
  } else if (!auditChainIntact) {
    state = 'withheld';
    stateReason = 'Audit trail integrity compromised';
  } else if (hardStops > 0) {
    state = 'withheld';
    stateReason = `${hardStops} reconciliation hard stop(s) prevent release`;
  } else if (heldCount === 0) {
    state = 'released';
    stateReason = `All ${total} obligations fulfilled — authority released`;
  } else if (releasedCount > 0) {
    state = 'partial';
    const heldNames = releases.filter((r) => !r.released).map((r) => r.obligationId);
    stateReason = `${releasedCount}/${total} obligations released, awaiting: ${heldNames.join(', ')}`;
  } else {
    state = 'held';
    stateReason = 'No obligations released';
  }

  return {
    warrantId: warrant.warrantId,
    state,
    totalObligations: total,
    releasedCount,
    heldCount,
    releases,
    stateReason,
    reviewHeld: reviewOutcome === 'pending',
  };
}

/** Compact escrow summary for reviewer artifacts. */
export function escrowSummary(e: AuthorityEscrow): {
  state: string; released: number; total: number; reviewHeld: boolean; reason: string;
} {
  return {
    state: e.state,
    released: e.releasedCount,
    total: e.totalObligations,
    reviewHeld: e.reviewHeld,
    reason: e.stateReason,
  };
}
