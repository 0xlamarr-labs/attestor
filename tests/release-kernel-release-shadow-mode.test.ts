import { strict as assert } from 'node:assert';
import { createReleasePolicyDefinition } from '../src/release-kernel/release-policy.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';
import { createShadowModeReleaseEvaluator } from '../src/release-kernel/release-shadow-mode.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function makeRecordRequest() {
  return {
    id: 'shadow_record_001',
    createdAt: '2026-04-17T19:00:00.000Z',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record' as const,
      riskClass: 'R4' as const,
    },
    capabilityBoundary: {
      allowedTools: ['xbrl-export'],
      allowedTargets: ['sec.edgar.filing.prepare'],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.reporting-bot',
      type: 'service' as const,
    },
    target: {
      kind: 'record-store' as const,
      id: 'finance.reporting.record-store',
    },
  };
}

function makePassingObservation() {
  return {
    actualArtifactType: 'financial-reporting.record-field',
    actualShape: 'structured financial record payload',
    observedTargetId: 'finance.reporting.record-store',
    usedTools: ['xbrl-export'],
    usedDataDomains: ['financial-reporting'],
    observedOutputHash: 'sha256:output',
    observedConsequenceHash: 'sha256:consequence',
    policyRulesSatisfied: true,
    evidenceKinds: ['trace', 'finding-log', 'signature', 'provenance'],
    traceGradePassed: true,
    provenanceBound: true,
    downstreamReceiptConfirmed: true,
  };
}

async function main(): Promise<void> {
  const defaultEvaluator = createShadowModeReleaseEvaluator();
  const defaultResult = defaultEvaluator.evaluate(makeRecordRequest(), makePassingObservation());

  equal(
    defaultResult.mode,
    'shadow',
    'Release shadow mode: evaluations are explicitly tagged as shadow-mode decisions',
  );
  ok(
    defaultResult.passThrough,
    'Release shadow mode: shadow evaluation never blocks the downstream path directly',
  );
  equal(
    defaultResult.enforcementReadiness,
    'hard-gate-eligible',
    'Release shadow mode: the finance record wedge is recognized as hard-gate-eligible',
  );
  equal(
    defaultResult.wouldDecisionStatus,
    'review-required',
    'Release shadow mode: the shadow verdict still preserves the underlying would-decision status',
  );
  ok(
    defaultResult.wouldRequireReview,
    'Release shadow mode: shadow evaluation surfaces that R4 structured record release still needs human review',
  );
  ok(
    defaultResult.wouldRequireToken,
    'Release shadow mode: shadow evaluation surfaces that a downstream release token would be required at enforcement time',
  );
  ok(
    defaultResult.wouldBlockIfEnforced,
    'Release shadow mode: review-required outcomes are marked as would-block under hard enforcement',
  );
  equal(
    defaultResult.outcome,
    'pass-through-with-warning',
    'Release shadow mode: non-ready release outcomes still pass through, but only with warning semantics',
  );
  equal(
    defaultResult.auditAnnotations['attestor.io/shadow-mode'],
    'true',
    'Release shadow mode: audit annotations explicitly mark shadow-mode execution',
  );

  const lowRiskPolicy = createReleasePolicyDefinition({
    id: 'ops.record-release.r1.v1',
    name: 'Low-risk operational record shadow policy',
    scope: {
      wedgeId: 'ops.record-release',
      consequenceType: 'record',
      riskClass: 'R1',
      targetKinds: ['record-store'],
      dataDomains: ['ops'],
    },
    outputContract: {
      allowedArtifactTypes: ['ops.record'],
      expectedShape: 'structured ops record payload',
      consequenceType: 'record',
      riskClass: 'R1',
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
      failureDisposition: 'deny',
    },
    release: {
      reviewMode: 'auto',
      minimumReviewerCount: 0,
      tokenEnforcement: 'optional',
      requireSignedEnvelope: false,
      requireDurableEvidencePack: false,
      requireDownstreamReceipt: false,
      retentionClass: 'standard',
    },
    notes: ['Low-risk shadow calibration path.'],
  });

  const lowRiskEngine = createReleaseDecisionEngine({ policies: [lowRiskPolicy] });
  const lowRiskEvaluator = createShadowModeReleaseEvaluator({ engine: lowRiskEngine });
  const lowRiskResult = lowRiskEvaluator.evaluate(
    {
      id: 'shadow_low_risk_001',
      createdAt: '2026-04-17T19:05:00.000Z',
      outputHash: 'sha256:output-low-risk',
      consequenceHash: 'sha256:consequence-low-risk',
      outputContract: {
        artifactType: 'ops.record',
        expectedShape: 'structured ops record payload',
        consequenceType: 'record',
        riskClass: 'R1',
      },
      capabilityBoundary: {
        allowedTools: ['ops-write'],
        allowedTargets: ['ops.record-store'],
        allowedDataDomains: ['ops'],
      },
      requester: {
        id: 'svc.ops-bot',
        type: 'service',
      },
      target: {
        kind: 'record-store',
        id: 'ops.record-store',
      },
    },
    {
      actualArtifactType: 'ops.record',
      actualShape: 'structured ops record payload',
      observedTargetId: 'ops.record-store',
      usedTools: ['ops-write'],
      usedDataDomains: ['ops'],
      observedOutputHash: 'sha256:output-low-risk',
      observedConsequenceHash: 'sha256:consequence-low-risk',
      policyRulesSatisfied: true,
      evidenceKinds: ['trace'],
    },
  );

  equal(
    lowRiskResult.wouldDecisionStatus,
    'accepted',
    'Release shadow mode: low-risk auto-release paths still show accepted as the underlying would-decision',
  );
  ok(
    !lowRiskResult.wouldBlockIfEnforced,
    'Release shadow mode: accepted low-risk paths are not treated as would-block under hard enforcement',
  );
  ok(
    !lowRiskResult.wouldRequireReview,
    'Release shadow mode: auto-release paths do not claim human review is required',
  );
  ok(
    !lowRiskResult.wouldRequireToken,
    'Release shadow mode: low-risk auto-release paths do not overstate token requirements when the active control profile keeps tokens optional',
  );

  console.log(`\nRelease kernel release-shadow-mode tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-shadow-mode tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
