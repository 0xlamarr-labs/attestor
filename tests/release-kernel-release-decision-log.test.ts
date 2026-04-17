import { strict as assert } from 'node:assert';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createInMemoryReleaseDecisionLogWriter,
  createReleaseDecisionLogEntry,
  RELEASE_DECISION_LOG_SPEC_VERSION,
  verifyReleaseDecisionLogChain,
} from '../src/release-kernel/release-decision-log.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function makeDecision(status: 'hold' | 'review-required' | 'denied') {
  return createReleaseDecisionSkeleton({
    id: `decision-${status}`,
    createdAt: '2026-04-17T17:00:00.000Z',
    status,
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
    },
    target: {
      kind: 'record-store',
      id: 'finance.reporting.record-store',
    },
  });
}

async function main(): Promise<void> {
  const firstEntry = createReleaseDecisionLogEntry(
    {
      occurredAt: '2026-04-17T17:00:00.000Z',
      requestId: 'req_1',
      phase: 'policy-resolution',
      matchedPolicyId: 'finance.structured-record-release.v1',
      decision: makeDecision('hold'),
      metadata: {
        policyMatched: true,
        pendingChecks: ['contract-shape'],
        pendingEvidenceKinds: ['trace'],
        requiresReview: true,
        deterministicChecksCompleted: false,
        effectivePolicyId: 'finance.structured-record-release.v1',
        rolloutMode: 'enforce',
        rolloutEvaluationMode: 'enforce',
        rolloutReason: 'enforce',
        rolloutCanaryBucket: null,
        rolloutFallbackPolicyId: null,
      },
    },
    1,
    null,
  );

  equal(
    firstEntry.version,
    RELEASE_DECISION_LOG_SPEC_VERSION,
    'Release decision log: schema version is stable',
  );
  equal(
    firstEntry.previousEntryDigest,
    null,
    'Release decision log: the first entry starts the chain with no previous digest',
  );

  const writer = createInMemoryReleaseDecisionLogWriter();
  writer.append({
    occurredAt: '2026-04-17T17:00:00.000Z',
    requestId: 'req_1',
    phase: 'policy-resolution',
    matchedPolicyId: 'finance.structured-record-release.v1',
    decision: makeDecision('hold'),
    metadata: {
      policyMatched: true,
      pendingChecks: ['contract-shape'],
      pendingEvidenceKinds: ['trace'],
      requiresReview: true,
      deterministicChecksCompleted: false,
      effectivePolicyId: 'finance.structured-record-release.v1',
      rolloutMode: 'enforce',
      rolloutEvaluationMode: 'enforce',
      rolloutReason: 'enforce',
      rolloutCanaryBucket: null,
      rolloutFallbackPolicyId: null,
    },
  });
  writer.append({
    occurredAt: '2026-04-17T17:00:01.000Z',
    requestId: 'req_1',
    phase: 'deterministic-checks',
    matchedPolicyId: 'finance.structured-record-release.v1',
    decision: makeDecision('review-required'),
    metadata: {
      policyMatched: true,
      pendingChecks: [],
      pendingEvidenceKinds: [],
      requiresReview: true,
      deterministicChecksCompleted: true,
      effectivePolicyId: 'finance.structured-record-release.v1',
      rolloutMode: 'enforce',
      rolloutEvaluationMode: 'enforce',
      rolloutReason: 'enforce',
      rolloutCanaryBucket: null,
      rolloutFallbackPolicyId: null,
    },
  });

  const verification = writer.verify();
  ok(verification.valid, 'Release decision log: append-only in-memory log verifies as a valid hash chain');
  equal(
    verification.verifiedEntries,
    2,
    'Release decision log: verification covers every appended entry',
  );
  ok(
    writer.entries()[1]?.previousEntryDigest === writer.entries()[0]?.entryDigest,
    'Release decision log: each later entry binds to the previous entry digest',
  );
  const externalView = writer.entries() as unknown as Array<{ readonly entryId: string }>;
  externalView.pop();
  equal(
    writer.entries().length,
    2,
    'Release decision log: callers only receive a snapshot view and cannot truncate the append-only log by mutating a returned array',
  );

  const tampered = writer.entries().map((entry, index) =>
    index === 1
      ? {
          ...entry,
          decisionStatus: 'denied' as const,
        }
      : entry,
  );
  ok(
    !verifyReleaseDecisionLogChain(tampered).valid,
    'Release decision log: changing a historical entry breaks chain verification',
  );

  const engineLog = createInMemoryReleaseDecisionLogWriter();
  const engine = createReleaseDecisionEngine({ decisionLog: engineLog });
  const request = {
    id: 'rd_eval_log',
    createdAt: '2026-04-17T17:05:00.000Z',
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

  engine.evaluate(request);
  engine.evaluateWithDeterministicChecks(request, {
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
  });

  const engineEntries = engineLog.entries();
  equal(
    engineEntries.length,
    3,
    'Release decision log: engine logging records policy resolution and deterministic-check phases as append-only entries',
  );
  equal(
    engineEntries[0]?.phase,
    'policy-resolution',
    'Release decision log: the first engine log entry captures policy resolution',
  );
  equal(
    engineEntries.at(-1)?.phase,
    'deterministic-checks',
    'Release decision log: deterministic evaluation appends a deterministic-check log entry',
  );

  console.log(`\nRelease kernel release-decision-log tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-decision-log tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
