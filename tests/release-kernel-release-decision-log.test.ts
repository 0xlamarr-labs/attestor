import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createFileBackedReleaseDecisionLogWriter,
  createInMemoryReleaseDecisionLogWriter,
  createReleaseDecisionLogEntry,
  resetFileBackedReleaseDecisionLogForTests,
  RELEASE_DECISION_LOG_SPEC_VERSION,
  ReleaseDecisionLogStoreError,
  type ReleaseDecisionLogMetadata,
  type ReleaseDecisionLogPhase,
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

function makeMetadata(input: Partial<ReleaseDecisionLogMetadata> = {}): ReleaseDecisionLogMetadata {
  return {
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
    ...input,
  };
}

function appendDecisionLogEntry(
  writer: ReturnType<typeof createInMemoryReleaseDecisionLogWriter>,
  phase: ReleaseDecisionLogPhase,
  status: 'hold' | 'review-required' | 'denied',
): void {
  writer.append({
    occurredAt: '2026-04-17T17:00:00.000Z',
    requestId: 'req_1',
    phase,
    matchedPolicyId: 'finance.structured-record-release.v1',
    decision: makeDecision(status),
    metadata: makeMetadata(),
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
      metadata: makeMetadata(),
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
  appendDecisionLogEntry(writer, 'policy-resolution', 'hold');
  writer.append({
    occurredAt: '2026-04-17T17:00:01.000Z',
    requestId: 'req_1',
    phase: 'deterministic-checks',
    matchedPolicyId: 'finance.structured-record-release.v1',
    decision: makeDecision('review-required'),
    metadata: makeMetadata({
      pendingChecks: [],
      pendingEvidenceKinds: [],
      deterministicChecksCompleted: true,
    }),
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

  const tempDir = mkdtempSync(join(tmpdir(), 'attestor-release-decision-log-'));
  const filePath = join(tempDir, 'release-decision-log.jsonl');
  try {
    const fileWriter = createFileBackedReleaseDecisionLogWriter({ path: filePath });
    appendDecisionLogEntry(fileWriter, 'policy-resolution', 'hold');
    appendDecisionLogEntry(fileWriter, 'deterministic-checks', 'review-required');
    ok(fileWriter.verify().valid, 'Release decision log: file-backed log verifies after append');
    equal(
      fileWriter.entries().length,
      2,
      'Release decision log: file-backed writer returns appended entries',
    );

    const reloadedWriter = createFileBackedReleaseDecisionLogWriter({ path: filePath });
    equal(
      reloadedWriter.entries().length,
      2,
      'Release decision log: file-backed writer reloads entries after restart',
    );
    equal(
      reloadedWriter.latestEntryDigest(),
      fileWriter.latestEntryDigest(),
      'Release decision log: reload preserves latest entry digest',
    );
    appendDecisionLogEntry(reloadedWriter, 'review', 'review-required');
    equal(
      createFileBackedReleaseDecisionLogWriter({ path: filePath }).entries().length,
      3,
      'Release decision log: file-backed writer continues the hash chain after reload',
    );

    const fileBackedSnapshot = reloadedWriter.entries() as unknown as Array<{
      readonly entryId: string;
    }>;
    fileBackedSnapshot.pop();
    equal(
      reloadedWriter.entries().length,
      3,
      'Release decision log: mutating a file-backed snapshot cannot truncate the durable log',
    );

    const lines = readFileSync(filePath, 'utf8').trim().split(/\r?\n/u);
    const tamperedEntry = JSON.parse(lines[1] ?? '{}') as { decisionStatus?: string };
    tamperedEntry.decisionStatus = 'denied';
    lines[1] = JSON.stringify(tamperedEntry);
    writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

    assert.throws(
      () => createFileBackedReleaseDecisionLogWriter({ path: filePath }),
      ReleaseDecisionLogStoreError,
      'Release decision log: tampered file-backed log fails closed on reload',
    );
    passed += 1;
  } finally {
    resetFileBackedReleaseDecisionLogForTests(filePath);
    rmSync(tempDir, { recursive: true, force: true });
  }

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
