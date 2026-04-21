import assert from 'node:assert/strict';
import {
  createEnforcementDecision,
  createEnforcementReceipt,
  createEnforcementRequest,
  createReleasePresentation,
  createVerificationResult,
  type EnforcementDecision,
  type EnforcementReceipt,
} from '../src/release-enforcement-plane/object-model.js';
import {
  RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION,
  runEnforcementPointConformance,
  runReleaseEnforcementConformanceSuite,
} from '../src/release-enforcement-plane/conformance.js';
import {
  ENFORCEMENT_TELEMETRY_EVENT_NAME,
  ENFORCEMENT_TRANSPARENCY_EVENT_NAME,
  RELEASE_ENFORCEMENT_TELEMETRY_SPEC_VERSION,
  RELEASE_ENFORCEMENT_TRANSPARENCY_RECEIPT_SPEC_VERSION,
  buildEnforcementTelemetrySummary,
  createEnforcementTelemetryEvent,
  createEnforcementTransparencyReceipt,
  createInMemoryEnforcementTelemetrySink,
  createSingleLeafTransparencyProof,
  telemetryEventSafetyFindings,
  verifyEnforcementTransparencyReceipt,
  type EnforcementTelemetryEvent,
} from '../src/release-enforcement-plane/telemetry.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected);
  passed += 1;
}

const CHECKED_AT = '2026-04-18T11:00:00.000Z';

function sampleRequest() {
  return createEnforcementRequest({
    id: 'erq_conformance_1',
    receivedAt: CHECKED_AT,
    enforcementPoint: {
      environment: 'prod-eu',
      enforcementPointId: 'filing-record-gateway',
      pointKind: 'record-write-gateway',
      boundaryKind: 'record-write',
      consequenceType: 'record',
      riskClass: 'R4',
      tenantId: 'tenant-finance',
      accountId: 'acct-enterprise',
      workloadId: 'spiffe://attestor/prod/record-gateway',
      audience: 'finance-records',
    },
    targetId: 'sec.edgar.filing.prepare',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    releaseTokenId: 'rt_conformance_1',
    releaseDecisionId: 'rd_conformance_1',
    traceId: 'trace-conformance-1',
  });
}

function samplePresentation() {
  return createReleasePresentation({
    mode: 'bearer-release-token',
    presentedAt: CHECKED_AT,
    releaseTokenId: 'rt_conformance_1',
    issuer: 'attestor',
    subject: 'releaseDecision:rd_conformance_1',
    audience: 'finance-records',
  });
}

function allowedDecisionAndReceipt(): {
  readonly decision: EnforcementDecision;
  readonly receipt: EnforcementReceipt;
} {
  const request = sampleRequest();
  const verification = createVerificationResult({
    id: 'vr_conformance_allowed',
    checkedAt: CHECKED_AT,
    mode: 'hybrid-required',
    status: 'valid',
    cacheState: 'fresh',
    degradedState: 'normal',
    presentation: samplePresentation(),
    releaseDecisionId: 'rd_conformance_1',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
  });
  const decision = createEnforcementDecision({
    id: 'ed_conformance_allowed',
    request,
    decidedAt: CHECKED_AT,
    verification,
  });
  const receipt = createEnforcementReceipt({
    id: 'er_conformance_allowed',
    issuedAt: CHECKED_AT,
    decision,
    receiptDigest: 'sha256:receipt-allowed',
  });
  return { decision, receipt };
}

function deniedDecisionAndReceipt(failureReason: 'replayed-authorization' | 'fresh-introspection-required') {
  const request = sampleRequest();
  const verification = createVerificationResult({
    id: `vr_conformance_${failureReason}`,
    checkedAt: CHECKED_AT,
    mode: 'online-introspection',
    status: 'invalid',
    cacheState: failureReason === 'fresh-introspection-required' ? 'stale-denied' : 'negative-hit',
    degradedState: failureReason === 'fresh-introspection-required' ? 'introspection-unavailable' : 'normal',
    presentation: samplePresentation(),
    releaseDecisionId: 'rd_conformance_1',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    failureReasons: [failureReason],
  });
  const decision = createEnforcementDecision({
    id: `ed_conformance_${failureReason}`,
    request,
    decidedAt: CHECKED_AT,
    verification,
  });
  const receipt = createEnforcementReceipt({
    id: `er_conformance_${failureReason}`,
    issuedAt: CHECKED_AT,
    decision,
    receiptDigest: `sha256:receipt-${failureReason}`,
  });
  return { decision, receipt };
}

function breakGlassDecisionAndReceipt() {
  const request = sampleRequest();
  const verification = createVerificationResult({
    id: 'vr_conformance_break_glass',
    checkedAt: CHECKED_AT,
    mode: 'online-introspection',
    status: 'invalid',
    cacheState: 'stale-denied',
    degradedState: 'break-glass-open',
    presentation: samplePresentation(),
    releaseDecisionId: 'rd_conformance_1',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    failureReasons: ['introspection-unavailable'],
  });
  const decision = createEnforcementDecision({
    id: 'ed_conformance_break_glass',
    request,
    decidedAt: CHECKED_AT,
    verification,
    breakGlass: {
      reason: 'control-plane-recovery',
      authorizedBy: {
        id: 'user_incident_commander',
        type: 'user',
        role: 'incident-commander',
      },
      authorizedAt: '2026-04-18T10:58:00.000Z',
      expiresAt: '2026-04-18T11:08:00.000Z',
      ticketId: 'INC-TELEMETRY-1',
      rationale: 'Restore enforcement while telemetry conformance fixture simulates outage.',
    },
  });
  const receipt = createEnforcementReceipt({
    id: 'er_conformance_break_glass',
    issuedAt: CHECKED_AT,
    decision,
    receiptDigest: 'sha256:receipt-break-glass',
  });
  return { decision, receipt };
}

function transparencyReceiptFor(receipt: EnforcementReceipt) {
  const provisional = createEnforcementTransparencyReceipt({
    issuedAt: CHECKED_AT,
    serviceId: 'attestor-transparency-dev',
    logId: 'release-enforcement-dev-log',
    receipt,
  });
  return createEnforcementTransparencyReceipt({
    id: 'etr_conformance_1',
    issuedAt: CHECKED_AT,
    serviceId: 'attestor-transparency-dev',
    logId: 'release-enforcement-dev-log',
    receipt,
    inclusionProof: createSingleLeafTransparencyProof(provisional.subject.digest),
  });
}

function testSpecConstants(): void {
  equal(RELEASE_ENFORCEMENT_TELEMETRY_SPEC_VERSION, 'attestor.release-enforcement-telemetry.v1', 'Conformance: telemetry schema version is stable');
  equal(RELEASE_ENFORCEMENT_TRANSPARENCY_RECEIPT_SPEC_VERSION, 'attestor.release-enforcement-transparency-receipt.v1', 'Conformance: transparency receipt schema version is stable');
  equal(RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION, 'attestor.release-enforcement-conformance.v1', 'Conformance: suite schema version is stable');
}

function testTelemetryEventForAllow(): EnforcementTelemetryEvent {
  const { decision, receipt } = allowedDecisionAndReceipt();
  const event = createEnforcementTelemetryEvent({
    source: 'record-write-gateway',
    observedAt: CHECKED_AT,
    status: 'allowed',
    request: sampleRequest(),
    decision,
    receipt,
    responseStatus: 200,
  });

  equal(event.version, RELEASE_ENFORCEMENT_TELEMETRY_SPEC_VERSION, 'Telemetry: event stamps schema version');
  equal(event.name, ENFORCEMENT_TELEMETRY_EVENT_NAME, 'Telemetry: event uses stable event name');
  equal(event.signal, 'allow', 'Telemetry: valid allow is classified as allow');
  equal(event.outcome, 'allow', 'Telemetry: event carries decision outcome');
  equal(event.refs.decisionId, decision.id, 'Telemetry: event binds decision reference');
  equal(event.refs.receiptId, receipt.id, 'Telemetry: event binds receipt reference');
  equal(event.enforcementPoint.riskClass, 'R4', 'Telemetry: event carries low-cardinality risk class');
  ok(event.eventDigest.startsWith('sha256:'), 'Telemetry: event carries deterministic digest');

  return event;
}

function testTelemetryClassification(): readonly EnforcementTelemetryEvent[] {
  const replay = deniedDecisionAndReceipt('replayed-authorization');
  const replayEvent = createEnforcementTelemetryEvent({
    source: 'envoy-ext-authz',
    observedAt: CHECKED_AT,
    status: 'denied',
    decision: replay.decision,
    receipt: replay.receipt,
    responseStatus: 409,
  });
  equal(replayEvent.signal, 'replay', 'Telemetry: replay failures get replay signal');
  equal(replayEvent.severityText, 'ERROR', 'Telemetry: replay denial is error severity');

  const freshness = deniedDecisionAndReceipt('fresh-introspection-required');
  const freshnessEvent = createEnforcementTelemetryEvent({
    source: 'webhook-receiver',
    observedAt: CHECKED_AT,
    status: 'rejected',
    decision: freshness.decision,
    receipt: freshness.receipt,
    responseStatus: 428,
  });
  equal(freshnessEvent.signal, 'freshness', 'Telemetry: freshness failures get freshness signal');
  equal(freshnessEvent.severityText, 'WARN', 'Telemetry: freshness issue is warning severity');

  const breakGlass = breakGlassDecisionAndReceipt();
  const breakGlassEvent = createEnforcementTelemetryEvent({
    source: 'webhook-receiver',
    observedAt: CHECKED_AT,
    status: 'break-glass-accepted',
    decision: breakGlass.decision,
    receipt: breakGlass.receipt,
    responseStatus: 202,
  });
  equal(breakGlassEvent.signal, 'break-glass', 'Telemetry: emergency allow gets break-glass signal');
  equal(breakGlassEvent.outcome, 'break-glass-allow', 'Telemetry: emergency allow preserves break-glass outcome');

  return [replayEvent, freshnessEvent, breakGlassEvent];
}

function testTelemetrySinkAndSummary(events: readonly EnforcementTelemetryEvent[]): void {
  const sink = createInMemoryEnforcementTelemetrySink();
  for (const event of events) {
    sink.emit(event);
  }
  const summary = buildEnforcementTelemetrySummary(sink.events());

  equal(summary.eventCount, events.length, 'Telemetry sink: stores all emitted events');
  equal(summary.allowCount, 1, 'Telemetry summary: counts allow events');
  equal(summary.replayCount, 1, 'Telemetry summary: counts replay events');
  equal(summary.freshnessCount, 1, 'Telemetry summary: counts freshness events');
  equal(summary.breakGlassCount, 1, 'Telemetry summary: counts break-glass events');
  equal(summary.failureReasonCounts['replayed-authorization'], 1, 'Telemetry summary: counts failure reasons');
}

function testTransparencyReceipt(): ReturnType<typeof transparencyReceiptFor> {
  const { receipt } = allowedDecisionAndReceipt();
  const transparencyReceipt = transparencyReceiptFor(receipt);
  const verification = verifyEnforcementTransparencyReceipt(transparencyReceipt);

  equal(transparencyReceipt.version, RELEASE_ENFORCEMENT_TRANSPARENCY_RECEIPT_SPEC_VERSION, 'Transparency: receipt stamps schema version');
  equal(transparencyReceipt.subject.type, 'enforcement-receipt', 'Transparency: receipt binds enforcement receipt subject');
  equal(transparencyReceipt.subject.id, receipt.id, 'Transparency: subject carries receipt id');
  ok(transparencyReceipt.subject.digest.startsWith('sha256:'), 'Transparency: subject carries digest');
  equal(verification.status, 'valid', 'Transparency: receipt verifies');
  deepEqual([...verification.failureReasons], [], 'Transparency: valid receipt has no verification failures');

  const event = createEnforcementTelemetryEvent({
    source: 'transparency-exporter',
    observedAt: CHECKED_AT,
    signal: 'transparency-receipt',
    outcome: 'not-applicable',
    status: 'exported',
    receipt,
    attributes: {
      'attestor.release_enforcement.transparency.log_id': transparencyReceipt.logId,
    },
  });
  equal(event.name, ENFORCEMENT_TRANSPARENCY_EVENT_NAME, 'Transparency: telemetry export gets transparency event name');
  equal(event.signal, 'transparency-receipt', 'Transparency: telemetry export uses transparency signal');

  const tampered = {
    ...transparencyReceipt,
    subject: {
      ...transparencyReceipt.subject,
      digest: 'sha256:tampered',
    },
  };
  equal(verifyEnforcementTransparencyReceipt(tampered).status, 'invalid', 'Transparency: tampering invalidates receipt');

  return transparencyReceipt;
}

function testConformancePass(transparencyReceipt: ReturnType<typeof transparencyReceiptFor>): void {
  const { decision, receipt } = allowedDecisionAndReceipt();
  const telemetryEvent = createEnforcementTelemetryEvent({
    source: 'record-write-gateway',
    observedAt: CHECKED_AT,
    status: 'allowed',
    request: sampleRequest(),
    decision,
    receipt,
    responseStatus: 200,
  });
  const report = runEnforcementPointConformance({
    id: 'record-write-allowed',
    result: {
      status: 'allowed',
      checkedAt: CHECKED_AT,
      request: sampleRequest(),
      decision,
      receipt,
      failureReasons: [],
      responseStatus: 200,
    },
    telemetryEvent,
    transparencyReceipt,
    options: {
      requireTelemetry: true,
      requireTransparencyForHighConsequence: true,
    },
  });

  equal(report.version, RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION, 'Conformance: report stamps schema version');
  equal(report.status, 'pass', 'Conformance: high-risk allowed result passes with telemetry and transparency receipt');
  equal(report.summary.failed, 0, 'Conformance: passing report has zero failed rules');
  ok(report.findings.some((finding) => finding.ruleId === 'telemetry.required-fields'), 'Conformance: telemetry rule ran');
  ok(report.findings.some((finding) => finding.ruleId === 'high-consequence.transparency-required'), 'Conformance: transparency rule ran');
}

function testConformanceFailures(): void {
  const { decision, receipt } = allowedDecisionAndReceipt();
  const unsafeEvent = {
    ...createEnforcementTelemetryEvent({
      source: 'record-write-gateway',
      observedAt: CHECKED_AT,
      status: 'allowed',
      decision,
      receipt,
      responseStatus: 200,
    }),
    body: 'Bearer raw.jwt.material should not appear in telemetry',
  };
  ok(telemetryEventSafetyFindings(unsafeEvent).length > 0, 'Conformance: unsafe telemetry marker is detectable');

  const missingTransparency = runEnforcementPointConformance({
    id: 'missing-transparency',
    result: {
      status: 'allowed',
      checkedAt: CHECKED_AT,
      request: sampleRequest(),
      decision,
      receipt,
      failureReasons: [],
      responseStatus: 200,
    },
    telemetryEvent: unsafeEvent,
    options: {
      requireTelemetry: true,
      requireTransparencyForHighConsequence: true,
    },
  });

  equal(missingTransparency.status, 'fail', 'Conformance: missing high-risk transparency receipt fails');
  ok(
    missingTransparency.findings.some(
      (finding) => finding.ruleId === 'telemetry.no-sensitive-material' && finding.status === 'fail',
    ),
    'Conformance: unsafe telemetry fails safety rule',
  );
  ok(
    missingTransparency.findings.some(
      (finding) => finding.ruleId === 'high-consequence.transparency-required' && finding.status === 'fail',
    ),
    'Conformance: missing transparency fails high-consequence rule',
  );

  const badReceipt = {
    ...receipt,
    decisionId: 'different-decision',
  };
  const mismatch = runEnforcementPointConformance({
    id: 'receipt-mismatch',
    result: {
      status: 'allowed',
      checkedAt: CHECKED_AT,
      request: sampleRequest(),
      decision,
      receipt: badReceipt,
      failureReasons: [],
      responseStatus: 200,
    },
  });
  ok(
    mismatch.findings.some(
      (finding) => finding.ruleId === 'decision.receipt-consistency' && finding.status === 'fail',
    ),
    'Conformance: receipt mismatch fails consistency rule',
  );

  const denial = runEnforcementPointConformance({
    id: 'denial-without-reason',
    result: {
      status: 'denied',
      checkedAt: CHECKED_AT,
      failureReasons: [],
      responseStatus: 403,
    },
    options: { requireTelemetry: false },
  });
  ok(
    denial.findings.some(
      (finding) => finding.ruleId === 'deny.failure-reasons' && finding.status === 'fail',
    ),
    'Conformance: denied result without failure reasons fails',
  );
}

function testConformanceSuite(transparencyReceipt: ReturnType<typeof transparencyReceiptFor>): void {
  const allowed = allowedDecisionAndReceipt();
  const replay = deniedDecisionAndReceipt('replayed-authorization');
  const allowedEvent = createEnforcementTelemetryEvent({
    source: 'record-write-gateway',
    observedAt: CHECKED_AT,
    status: 'allowed',
    decision: allowed.decision,
    receipt: allowed.receipt,
    responseStatus: 200,
  });
  const replayEvent = createEnforcementTelemetryEvent({
    source: 'envoy-ext-authz',
    observedAt: CHECKED_AT,
    status: 'denied',
    decision: replay.decision,
    receipt: replay.receipt,
    responseStatus: 409,
  });
  const suite = runReleaseEnforcementConformanceSuite(
    [
      {
        id: 'allowed',
        result: {
          status: 'allowed',
          checkedAt: CHECKED_AT,
          request: sampleRequest(),
          decision: allowed.decision,
          receipt: allowed.receipt,
          failureReasons: [],
          responseStatus: 200,
        },
        telemetryEvent: allowedEvent,
        transparencyReceipt,
        options: {
          requireTelemetry: true,
          requireTransparencyForHighConsequence: true,
        },
      },
      {
        id: 'replay',
        result: {
          status: 'denied',
          checkedAt: CHECKED_AT,
          decision: replay.decision,
          receipt: replay.receipt,
          failureReasons: ['replayed-authorization'],
          responseStatus: 409,
        },
        telemetryEvent: replayEvent,
        options: { requireTelemetry: true },
      },
    ],
    CHECKED_AT,
  );

  equal(suite.status, 'pass', 'Conformance suite: all conforming cases pass');
  equal(suite.caseCount, 2, 'Conformance suite: counts cases');
  equal(suite.passedCases, 2, 'Conformance suite: counts passing cases');
  equal(suite.failedCases, 0, 'Conformance suite: counts failing cases');
}

const allowEvent = testTelemetryEventForAllow();
const classifiedEvents = testTelemetryClassification();
testSpecConstants();
testTelemetrySinkAndSummary([allowEvent, ...classifiedEvents]);
const transparencyReceipt = testTransparencyReceipt();
testConformancePass(transparencyReceipt);
testConformanceFailures();
testConformanceSuite(transparencyReceipt);

console.log(`Release enforcement-plane conformance tests: ${passed} passed, 0 failed`);
