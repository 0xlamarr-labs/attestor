import type { ReleaseDecision, ReleaseFinding } from './object-model.js';
import type { DeterministicControlCategory } from './risk-controls.js';
import type { ReleasePolicyDefinition } from './release-policy.js';

/**
 * Deterministic release checks.
 *
 * These checks deliberately stay mechanical and reproducible. They do not
 * use models or heuristics; they validate whether a release candidate still
 * satisfies the exact contract, boundary, evidence, and binding requirements
 * that the matched release policy demands.
 */

export const RELEASE_DETERMINISTIC_CHECKS_SPEC_VERSION =
  'attestor.release-deterministic-checks.v1';

export type DeterministicCheckPhase =
  | 'deterministic-checks'
  | 'review'
  | 'terminal-accept'
  | 'terminal-deny';

export interface DeterministicCheckObservation {
  readonly actualArtifactType: string;
  readonly actualShape: string;
  readonly observedTargetId: string;
  readonly usedTools: readonly string[];
  readonly usedDataDomains: readonly string[];
  readonly observedOutputHash: string;
  readonly observedConsequenceHash: string;
  readonly policyRulesSatisfied: boolean;
  readonly evidenceKinds: readonly string[];
  readonly traceGradePassed?: boolean;
  readonly provenanceBound?: boolean;
  readonly downstreamReceiptConfirmed?: boolean;
}

export interface DeterministicCheckOutcome {
  readonly category: DeterministicControlCategory;
  readonly passed: boolean;
  readonly finding: ReleaseFinding;
}

export interface DeterministicCheckReport {
  readonly version: typeof RELEASE_DETERMINISTIC_CHECKS_SPEC_VERSION;
  readonly allPassed: boolean;
  readonly passCount: number;
  readonly failCount: number;
  readonly outcomes: readonly DeterministicCheckOutcome[];
  readonly findings: readonly ReleaseFinding[];
  readonly resultingStatus: ReleaseDecision['status'];
  readonly nextPhase: DeterministicCheckPhase;
}

function buildDeterministicFinding(
  category: DeterministicControlCategory,
  passed: boolean,
  message: string,
): ReleaseFinding {
  return {
    code: category,
    result: passed ? 'pass' : 'fail',
    message,
    source: 'deterministic-check',
  };
}

function categoryOutcome(
  category: DeterministicControlCategory,
  decision: ReleaseDecision,
  policy: ReleasePolicyDefinition,
  observation: DeterministicCheckObservation,
): DeterministicCheckOutcome {
  switch (category) {
    case 'contract-shape': {
      const passed =
        policy.outputContract.allowedArtifactTypes.includes(observation.actualArtifactType) &&
        observation.actualShape === policy.outputContract.expectedShape;
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Artifact type and shape match the policy output contract.'
            : 'Artifact type or shape does not match the policy output contract.',
        ),
      };
    }
    case 'target-binding': {
      const passed =
        observation.observedTargetId === decision.target.id &&
        policy.capabilityBoundary.allowedTargets.includes(observation.observedTargetId);
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Observed target matches the bound release target.'
            : 'Observed target does not match the bound release target or allowed target list.',
        ),
      };
    }
    case 'capability-boundary': {
      const toolsAllowed = observation.usedTools.every((tool) =>
        policy.capabilityBoundary.allowedTools.includes(tool),
      );
      const domainsAllowed = observation.usedDataDomains.every((domain) =>
        policy.capabilityBoundary.allowedDataDomains.includes(domain),
      );
      const passed = toolsAllowed && domainsAllowed;
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Observed tools and data domains remain inside the declared capability boundary.'
            : 'Observed tools or data domains exceeded the declared capability boundary.',
        ),
      };
    }
    case 'consequence-hash-integrity': {
      const passed =
        observation.observedOutputHash === decision.outputHash &&
        observation.observedConsequenceHash === decision.consequenceHash;
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Observed output and consequence hashes match the bound release candidate.'
            : 'Observed output or consequence hash diverged from the bound release candidate.',
        ),
      };
    }
    case 'policy-rule-validation': {
      const passed = observation.policyRulesSatisfied;
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Policy-specific validation rules passed.'
            : 'Policy-specific validation rules failed.',
        ),
      };
    }
    case 'evidence-completeness': {
      const passed = policy.acceptance.requiredEvidenceKinds.every((kind) =>
        observation.evidenceKinds.includes(kind),
      );
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Required evidence kinds are present.'
            : 'One or more required evidence kinds are missing.',
        ),
      };
    }
    case 'trace-grade-regression': {
      const passed = observation.traceGradePassed === true;
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Trace-grade regression check passed.'
            : 'Trace-grade regression check failed or was missing.',
        ),
      };
    }
    case 'provenance-binding': {
      const passed = observation.provenanceBound === true;
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Provenance is bound to the release candidate.'
            : 'Provenance was not bound to the release candidate.',
        ),
      };
    }
    case 'downstream-receipt-reconciliation': {
      const passed = observation.downstreamReceiptConfirmed === true;
      return {
        category,
        passed,
        finding: buildDeterministicFinding(
          category,
          passed,
          passed
            ? 'Downstream receipt was confirmed for the release candidate.'
            : 'Downstream receipt was missing or could not be reconciled.',
        ),
      };
    }
  }
}

function terminalStatusAfterChecks(
  policy: ReleasePolicyDefinition,
  allPassed: boolean,
): { status: ReleaseDecision['status']; nextPhase: DeterministicCheckPhase } {
  if (allPassed) {
    if (policy.release.reviewMode === 'auto') {
      return {
        status: 'accepted',
        nextPhase: 'terminal-accept',
      };
    }

    return {
      status: 'review-required',
      nextPhase: 'review',
    };
  }

  switch (policy.acceptance.failureDisposition) {
    case 'deny':
      return {
        status: 'denied',
        nextPhase: 'terminal-deny',
      };
    case 'hold':
      return {
        status: 'hold',
        nextPhase: 'deterministic-checks',
      };
    case 'review-required':
      return {
        status: 'review-required',
        nextPhase: 'review',
      };
    case 'observe':
      return {
        status: 'accepted',
        nextPhase: 'terminal-accept',
      };
  }
}

export function runDeterministicReleaseChecks(
  policy: ReleasePolicyDefinition,
  decision: ReleaseDecision,
  observation: DeterministicCheckObservation,
): DeterministicCheckReport {
  const outcomes = policy.acceptance.requiredChecks.map((category) =>
    categoryOutcome(category, decision, policy, observation),
  );
  const findings = outcomes.map((outcome) => outcome.finding);
  const passCount = outcomes.filter((outcome) => outcome.passed).length;
  const failCount = outcomes.length - passCount;
  const allPassed = failCount === 0;
  const terminal = terminalStatusAfterChecks(policy, allPassed);

  return {
    version: RELEASE_DETERMINISTIC_CHECKS_SPEC_VERSION,
    allPassed,
    passCount,
    failCount,
    outcomes,
    findings,
    resultingStatus: terminal.status,
    nextPhase: terminal.nextPhase,
  };
}

export function applyDeterministicCheckReport(
  decision: ReleaseDecision,
  report: DeterministicCheckReport,
): ReleaseDecision {
  return {
    ...decision,
    status: report.resultingStatus,
    findings: [...decision.findings, ...report.findings],
  };
}
