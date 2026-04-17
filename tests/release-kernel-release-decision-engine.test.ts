import { strict as assert } from 'node:assert';
import {
  createReleaseDecisionEngine,
  evaluateReleaseDecisionSkeleton,
  RELEASE_DECISION_ENGINE_SPEC_VERSION,
  resolveMatchingReleasePolicy,
} from '../src/release-kernel/release-decision-engine.js';
import { createFirstHardGatewayReleasePolicy } from '../src/release-kernel/release-policy.js';
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

  console.log(`\nRelease kernel release-decision-engine tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-decision-engine tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
