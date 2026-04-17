import { strict as assert } from 'node:assert';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';
import {
  applyDeterministicCheckReport,
  RELEASE_DETERMINISTIC_CHECKS_SPEC_VERSION,
  runDeterministicReleaseChecks,
} from '../src/release-kernel/release-deterministic-checks.js';
import { createFirstHardGatewayReleasePolicy, createReleasePolicyDefinition } from '../src/release-kernel/release-policy.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function makeRecordDecision() {
  return createReleaseDecisionSkeleton({
    id: 'rd_check_001',
    createdAt: '2026-04-17T16:00:00.000Z',
    status: 'hold',
    policyVersion: 'finance.structured-record-release.v1',
    policyHash: 'finance.structured-record-release.v1',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    capabilityBoundary: {
      allowedTools: ['xbrl-export'],
      allowedTargets: ['sec.edgar.filing.prepare'],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.reporting-bot',
      type: 'service',
      displayName: 'Reporting Bot',
    },
    target: {
      kind: 'record-store',
      id: 'finance.reporting.record-store',
      displayName: 'Reporting Record Store',
    },
  });
}

async function main(): Promise<void> {
  const firstPolicy = createFirstHardGatewayReleasePolicy();
  const decision = makeRecordDecision();

  const passingObservation = {
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

  const passingReport = runDeterministicReleaseChecks(firstPolicy, decision, passingObservation);

  equal(
    passingReport.version,
    RELEASE_DETERMINISTIC_CHECKS_SPEC_VERSION,
    'Deterministic checks: schema version is stable',
  );
  ok(passingReport.allPassed, 'Deterministic checks: the first hard-gateway scenario can pass all required checks');
  equal(
    passingReport.resultingStatus,
    'review-required',
    'Deterministic checks: successful R4 checks move the decision into review-required, not straight to accepted',
  );
  equal(
    passingReport.nextPhase,
    'review',
    'Deterministic checks: successful R4 checks advance the flow to review',
  );
  equal(
    passingReport.failCount,
    0,
    'Deterministic checks: a passing run has no failed categories',
  );

  const applied = applyDeterministicCheckReport(decision, passingReport);
  equal(
    applied.status,
    'review-required',
    'Deterministic checks: applying a passing report updates the decision status',
  );
  ok(
    applied.findings.some((finding) => finding.code === 'provenance-binding' && finding.result === 'pass'),
    'Deterministic checks: applied findings include deterministic pass evidence',
  );

  const failingReport = runDeterministicReleaseChecks(firstPolicy, decision, {
    ...passingObservation,
    evidenceKinds: ['trace', 'finding-log', 'signature'],
    provenanceBound: false,
    downstreamReceiptConfirmed: false,
  });

  ok(
    !failingReport.allPassed,
    'Deterministic checks: missing provenance or downstream receipt fails the required R4 checks',
  );
  equal(
    failingReport.resultingStatus,
    'review-required',
    'Deterministic checks: failed R4 checks still escalate to review-required according to the risk matrix',
  );
  ok(
    failingReport.findings.some((finding) => finding.code === 'provenance-binding' && finding.result === 'fail'),
    'Deterministic checks: failed findings name the specific deterministic control that broke',
  );

  const communicationPolicy = createReleasePolicyDefinition({
    id: 'custom.communication.policy',
    name: 'Custom communication policy',
    status: 'active',
    scope: {
      wedgeId: 'custom-communication',
      consequenceType: 'communication',
      riskClass: 'R2',
      targetKinds: ['endpoint'],
      dataDomains: ['customer-ops'],
    },
    outputContract: {
      allowedArtifactTypes: ['customer-support.reply'],
      expectedShape: 'approved outbound reply',
      consequenceType: 'communication',
      riskClass: 'R2',
    },
    capabilityBoundary: {
      allowedTools: ['send-email'],
      allowedTargets: ['customer.reply.send'],
      allowedDataDomains: ['customer-ops'],
      requiresSingleTargetBinding: true,
    },
    acceptance: {
      strategy: 'all-required',
      requiredChecks: ['contract-shape', 'target-binding', 'capability-boundary'],
      requiredEvidenceKinds: ['trace', 'finding-log'],
      maxWarnings: 0,
      failureDisposition: 'deny',
    },
    release: {
      reviewMode: 'auto',
      minimumReviewerCount: 0,
      tokenEnforcement: 'required',
      requireSignedEnvelope: false,
      requireDurableEvidencePack: false,
      requireDownstreamReceipt: true,
      retentionClass: 'standard',
    },
    notes: [],
  });

  const communicationDecision = createReleaseDecisionSkeleton({
    id: 'rd_check_002',
    createdAt: '2026-04-17T16:05:00.000Z',
    status: 'hold',
    policyVersion: communicationPolicy.id,
    policyHash: communicationPolicy.id,
    outputHash: 'sha256:output-2',
    consequenceHash: 'sha256:consequence-2',
    outputContract: {
      artifactType: 'customer-support.reply',
      expectedShape: 'approved outbound reply',
      consequenceType: 'communication',
      riskClass: 'R2',
    },
    capabilityBoundary: {
      allowedTools: ['send-email'],
      allowedTargets: ['customer.reply.send'],
      allowedDataDomains: ['customer-ops'],
    },
    requester: {
      id: 'svc.customer-agent',
      type: 'service',
    },
    target: {
      kind: 'endpoint',
      id: 'customer.reply.send',
    },
  });

  const communicationReport = runDeterministicReleaseChecks(communicationPolicy, communicationDecision, {
    actualArtifactType: 'customer-support.reply',
    actualShape: 'approved outbound reply',
    observedTargetId: 'customer.reply.send',
    usedTools: ['send-email'],
    usedDataDomains: ['customer-ops'],
    observedOutputHash: 'sha256:output-2',
    observedConsequenceHash: 'sha256:consequence-2',
    policyRulesSatisfied: true,
    evidenceKinds: ['trace', 'finding-log'],
  });

  equal(
    communicationReport.resultingStatus,
    'accepted',
    'Deterministic checks: passing auto-review policies can end in accepted immediately',
  );
  equal(
    communicationReport.nextPhase,
    'terminal-accept',
    'Deterministic checks: passing auto-review policies terminate in accepted',
  );

  const engine = createReleaseDecisionEngine();
  const engineResult = engine.evaluateWithDeterministicChecks(
    {
      id: 'rd_eval_engine',
      createdAt: '2026-04-17T16:10:00.000Z',
      outputHash: 'sha256:output',
      consequenceHash: 'sha256:consequence',
      outputContract: {
        artifactType: 'financial-reporting.record-field',
        expectedShape: 'structured financial record payload',
        consequenceType: 'record',
        riskClass: 'R4',
      },
      capabilityBoundary: {
        allowedTools: ['xbrl-export'],
        allowedTargets: ['sec.edgar.filing.prepare'],
        allowedDataDomains: ['financial-reporting'],
      },
      requester: {
        id: 'svc.reporting-bot',
        type: 'service',
      },
      target: {
        kind: 'record-store',
        id: 'finance.reporting.record-store',
      },
    },
    passingObservation,
  );

  ok(
    engineResult.deterministicChecksCompleted,
    'Deterministic checks: the engine can now advance a matched request through deterministic validation',
  );
  equal(
    engineResult.decision.status,
    'review-required',
    'Deterministic checks: the engine returns the post-check status from the deterministic report',
  );
  equal(
    engineResult.plan.phase,
    'review',
    'Deterministic checks: the engine transitions to review after successful R4 deterministic checks',
  );

  console.log(`\nRelease kernel deterministic-check tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel deterministic-check tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
