import { strict as assert } from 'node:assert';
import {
  createReleaseDecisionEngine,
  evaluateReleaseDecisionSkeleton,
  RELEASE_DECISION_ENGINE_SPEC_VERSION,
  resolveMatchingReleasePolicy,
} from '../src/release-kernel/release-decision-engine.js';
import {
  createFirstHardGatewayReleasePolicy,
  createReleasePolicyDefinition,
} from '../src/release-kernel/release-policy.js';
import type {
  CapabilityBoundaryDescriptor,
  OutputContractDescriptor,
} from '../src/release-kernel/types.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function makeStructuredRecordRequest() {
  const outputContract: OutputContractDescriptor = {
    artifactType: 'financial-reporting.record-field',
    expectedShape: 'structured financial record payload',
    consequenceType: 'record',
    riskClass: 'R4',
  };

  const capabilityBoundary: CapabilityBoundaryDescriptor = {
    allowedTools: ['xbrl-export'],
    allowedTargets: ['sec.edgar.filing.prepare'],
    allowedDataDomains: ['financial-reporting'],
  };

  return {
    id: 'rd_eval_001',
    createdAt: '2026-04-17T15:00:00.000Z',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract,
    capabilityBoundary,
    requester: {
      id: 'svc.reporting-bot',
      type: 'service' as const,
      displayName: 'Reporting Bot',
      role: 'reporting-automation',
    },
    target: {
      kind: 'record-store' as const,
      id: 'finance.reporting.record-store',
      displayName: 'Reporting Record Store',
    },
  };
}

async function main(): Promise<void> {
  const policies = [createFirstHardGatewayReleasePolicy()];
  const request = makeStructuredRecordRequest();

  const resolvedPolicy = resolveMatchingReleasePolicy(policies, request);
  equal(
    resolvedPolicy?.id,
    'finance.structured-record-release.v1',
    'Release decision engine: policy resolution finds the active first hard-gateway policy',
  );

  const result = evaluateReleaseDecisionSkeleton(request, policies);
  equal(
    result.version,
    RELEASE_DECISION_ENGINE_SPEC_VERSION,
    'Release decision engine: result carries a stable engine schema version',
  );
  ok(result.policyMatched, 'Release decision engine: matching requests are recognized as policy-covered');
  equal(
    result.matchedPolicyId,
    'finance.structured-record-release.v1',
    'Release decision engine: matching requests record the matched policy id',
  );
  equal(
    result.decision.status,
    'hold',
    'Release decision engine: matching requests stay on hold until deterministic checks run',
  );
  equal(
    result.plan.phase,
    'deterministic-checks',
    'Release decision engine: the next phase after policy match is deterministic checks',
  );
  ok(
    result.plan.pendingChecks.includes('provenance-binding') &&
      result.plan.pendingChecks.includes('downstream-receipt-reconciliation'),
    'Release decision engine: the pending plan carries the policy-driven required checks',
  );
  ok(
    result.plan.requiresReview,
    'Release decision engine: review requirements are surfaced before final release',
  );
  equal(
    result.plan.rolloutMode,
    'enforce',
    'Release decision engine: the first hard-gateway policy carries an explicit enforce rollout state',
  );
  equal(
    result.plan.rolloutEvaluationMode,
    'enforce',
    'Release decision engine: the first hard-gateway policy is actively enforced instead of relying on implicit rollout state',
  );
  equal(
    result.decision.policyVersion,
    'finance.structured-record-release.v1',
    'Release decision engine: the initial decision skeleton binds to the matched policy version',
  );
  equal(
    result.decision.findings[0]?.code,
    'deterministic_checks_pending',
    'Release decision engine: matched decisions explain that checks still need to run',
  );

  const engine = createReleaseDecisionEngine();
  const engineResult = engine.evaluate(request);
  equal(
    engineResult.matchedPolicyId,
    'finance.structured-record-release.v1',
    'Release decision engine: the default engine includes the frozen first hard-gateway policy',
  );

  const nonMatchingRequest = {
    ...request,
    outputContract: {
      artifactType: 'financial-reporting.analyst-note',
      expectedShape: 'free-form note',
      consequenceType: 'decision-support' as const,
      riskClass: 'R2' as const,
    },
    target: {
      kind: 'queue' as const,
      id: 'analysis.queue',
      displayName: 'Analysis Queue',
    },
  };

  const denied = evaluateReleaseDecisionSkeleton(nonMatchingRequest, policies);
  ok(
    !denied.policyMatched,
    'Release decision engine: requests outside the active policy scope are not treated as covered',
  );
  equal(
    denied.decision.status,
    'denied',
    'Release decision engine: unmatched requests are denied immediately at policy-resolution time',
  );
  equal(
    denied.plan.phase,
    'terminal-deny',
    'Release decision engine: unmatched requests stop at terminal deny',
  );
  equal(
    denied.decision.findings[0]?.code,
    'policy_scope_mismatch',
    'Release decision engine: denied requests explain the policy scope mismatch',
  );

  const dryRunPolicy = createReleasePolicyDefinition({
    id: 'ops.record-release.r2.v1',
    name: 'Ops structured record dry-run policy',
    rollout: {
      mode: 'dry-run',
      activatedAt: '2026-04-17T20:15:00.000Z',
    },
    scope: {
      wedgeId: 'ops-record-release',
      consequenceType: 'record',
      riskClass: 'R2',
      targetKinds: ['record-store'],
      dataDomains: ['ops'],
    },
    outputContract: {
      allowedArtifactTypes: ['ops.record'],
      expectedShape: 'structured ops record payload',
      consequenceType: 'record',
      riskClass: 'R2',
    },
    capabilityBoundary: {
      allowedTools: ['ops-write'],
      allowedTargets: ['ops.record-store'],
      allowedDataDomains: ['ops'],
      requiresSingleTargetBinding: true,
    },
    acceptance: {
      strategy: 'all-required',
      requiredChecks: ['contract-shape', 'target-binding'],
      requiredEvidenceKinds: ['trace'],
      maxWarnings: 0,
      failureDisposition: 'hold',
    },
    release: {
      reviewMode: 'auto',
      minimumReviewerCount: 0,
      tokenEnforcement: 'required',
      requireSignedEnvelope: false,
      requireDurableEvidencePack: false,
      requireDownstreamReceipt: false,
      retentionClass: 'standard',
    },
  });

  const dryRunResult = evaluateReleaseDecisionSkeleton(
    {
      id: 'rd_eval_dry_run_001',
      createdAt: '2026-04-17T15:10:00.000Z',
      outputHash: 'sha256:ops-output',
      consequenceHash: 'sha256:ops-consequence',
      outputContract: {
        artifactType: 'ops.record',
        expectedShape: 'structured ops record payload',
        consequenceType: 'record',
        riskClass: 'R2',
      },
      capabilityBoundary: {
        allowedTools: ['ops-write'],
        allowedTargets: ['ops.record-store'],
        allowedDataDomains: ['ops'],
      },
      requester: {
        id: 'svc.ops-bot',
        type: 'service',
        displayName: 'Ops Bot',
      },
      target: {
        kind: 'record-store',
        id: 'ops.record-store',
      },
    },
    [dryRunPolicy],
  );
  equal(
    dryRunResult.plan.rolloutMode,
    'dry-run',
    'Release decision engine: rollout mode is preserved on the evaluation plan',
  );
  equal(
    dryRunResult.plan.rolloutEvaluationMode,
    'shadow',
    'Release decision engine: dry-run policies resolve to shadow evaluation mode',
  );

  const rollbackFallbackPolicy = createReleasePolicyDefinition({
    id: 'finance.structured-record-release.rollback',
    name: 'Finance structured record fallback policy',
    status: 'deprecated',
    rollout: {
      mode: 'enforce',
      activatedAt: '2026-04-10T00:00:00.000Z',
    },
    scope: {
      wedgeId: 'finance-structured-record-release',
      consequenceType: 'record',
      riskClass: 'R4',
      targetKinds: ['record-store', 'artifact-registry'],
      dataDomains: ['financial-reporting'],
    },
    outputContract: {
      allowedArtifactTypes: [
        'financial-reporting.record-field',
        'financial-reporting.filing-preparation-payload',
        'financial-reporting.structured-report-artifact',
      ],
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    capabilityBoundary: {
      allowedTools: ['xbrl-export', 'filing-prepare', 'record-commit'],
      allowedTargets: ['sec.edgar.filing.prepare', 'finance.reporting.record-store'],
      allowedDataDomains: ['financial-reporting'],
      requiresSingleTargetBinding: true,
    },
    acceptance: {
      strategy: 'all-required',
      requiredChecks: ['contract-shape', 'target-binding', 'capability-boundary'],
      requiredEvidenceKinds: ['trace', 'finding-log'],
      maxWarnings: 0,
      failureDisposition: 'hold',
    },
    release: {
      reviewMode: 'named-reviewer',
      minimumReviewerCount: 1,
      tokenEnforcement: 'required-with-introspection',
      requireSignedEnvelope: true,
      requireDurableEvidencePack: true,
      requireDownstreamReceipt: true,
      retentionClass: 'regulated',
    },
  });

  const rolledBackPrimaryPolicy = createReleasePolicyDefinition({
    ...createFirstHardGatewayReleasePolicy(),
    rollout: {
      mode: 'rolled-back',
      fallbackPolicyId: 'finance.structured-record-release.rollback',
      activatedAt: '2026-04-17T20:20:00.000Z',
    },
  });

  const rollbackResult = evaluateReleaseDecisionSkeleton(request, [
    rolledBackPrimaryPolicy,
    rollbackFallbackPolicy,
  ]);
  equal(
    rollbackResult.plan.rolloutMode,
    'rolled-back',
    'Release decision engine: rollback state remains visible even when a fallback policy is selected',
  );
  equal(
    rollbackResult.plan.effectivePolicyId,
    'finance.structured-record-release.rollback',
    'Release decision engine: rollback can move evaluation onto an explicitly named fallback policy',
  );
  equal(
    rollbackResult.plan.rolloutFallbackPolicyId,
    'finance.structured-record-release.rollback',
    'Release decision engine: fallback policy id is preserved on the evaluation plan',
  );
  equal(
    rollbackResult.decision.policyVersion,
    'finance.structured-record-release.rollback',
    'Release decision engine: decision skeleton binds to the effective fallback policy during rollback',
  );

  console.log(`\nRelease kernel release-decision-engine tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-decision-engine tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
