import assert from 'node:assert/strict';
import {
  buildCryptoAdmissionTelemetrySummary,
  createCryptoAdmissionReceipt,
  createCryptoAdmissionTelemetryEvent,
  createCryptoAdmissionTelemetrySubject,
  createInMemoryCryptoAdmissionTelemetrySink,
  cryptoAdmissionTelemetryDescriptor,
  cryptoAdmissionTelemetryEventSafetyFindings,
  verifyCryptoAdmissionReceipt,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoExecutionAdmissionPlan,
  CryptoExecutionAdmissionSurface,
} from '../src/crypto-execution-admission/index.js';
import type { CryptoExecutionAdapterKind } from '../src/crypto-authorization-core/types.js';

let passed = 0;

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const SIGNER = {
  keyId: 'crypto-admission-receipt-key-001',
  secret: 'local-test-secret',
};

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function planFixture(input: {
  surface?: CryptoExecutionAdmissionSurface;
  outcome?: CryptoExecutionAdmissionPlan['outcome'];
  adapterKind?: CryptoExecutionAdapterKind | null;
  blockedReasons?: readonly string[];
} = {}): CryptoExecutionAdmissionPlan {
  const surface = input.surface ?? 'wallet-rpc';
  const outcome = input.outcome ?? 'admit';
  const adapterKind = input.adapterKind ?? 'wallet-call-api';
  const blockedReasons = input.blockedReasons ?? [];
  return {
    version: 'attestor.crypto-execution-admission.v1',
    planId: `plan-${surface}-${outcome}`,
    createdAt: '2026-04-22T21:00:00.000Z',
    integrationRef: `integration:${surface}`,
    simulationId: `simulation-${surface}`,
    simulationDigest: `sha256:simulation-${surface}`,
    intentId: `intent-${surface}`,
    consequenceKind: 'transfer',
    adapterKind,
    surface,
    outcome,
    chainId: 'eip155:1',
    accountAddress: '0x1111111111111111111111111111111111111111',
    standards: ['attestor-core'],
    requiredHandoffArtifacts: ['attestor-release-authorization'],
    transportHeaders: [],
    steps: [],
    blockedReasons,
    nextActions: [],
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:plan-${surface}-${outcome}`,
  };
}

function subjectFor(
  plan: CryptoExecutionAdmissionPlan,
  outcome = plan.outcome,
  action = 'submit',
) {
  return createCryptoAdmissionTelemetrySubject({
    plan,
    subjectKind: `${plan.surface}-handoff`,
    subjectId: `${plan.surface}-subject-001`,
    subjectDigest: `sha256:subject-${plan.surface}`,
    outcome,
    action,
  });
}

const admittedPlan = planFixture();
const admittedSubject = subjectFor(admittedPlan, 'ready');
const admittedReceipt = createCryptoAdmissionReceipt({
  plan: admittedPlan,
  subject: admittedSubject,
  issuedAt: '2026-04-22T21:01:00.000Z',
  serviceId: 'attestor-crypto-admission',
  signer: SIGNER,
  traceparent: TRACEPARENT,
});
equal(admittedReceipt.classification, 'admitted', 'admitted plan creates admitted receipt');
equal(admittedReceipt.signature.mode, 'hmac-sha256', 'receipt is HMAC signed');
ok(admittedReceipt.receiptDigest.startsWith('sha256:'), 'receipt carries digest');
equal(
  verifyCryptoAdmissionReceipt({ receipt: admittedReceipt, signer: SIGNER }).status,
  'valid',
  'receipt verifies with the signing key',
);
equal(
  verifyCryptoAdmissionReceipt({
    receipt: admittedReceipt,
    signer: { ...SIGNER, secret: 'wrong-secret' },
  }).status,
  'invalid',
  'receipt rejects the wrong signing secret',
);

const admittedEvent = createCryptoAdmissionTelemetryEvent({
  source: 'attestor.crypto-execution-admission',
  observedAt: '2026-04-22T21:01:01.000Z',
  plan: admittedPlan,
  subject: admittedSubject,
  receipt: admittedReceipt,
});
equal(admittedEvent.specversion, '1.0', 'event uses CloudEvents specversion');
equal(admittedEvent.signal, 'admitted', 'admitted event signal is inferred');
equal(admittedEvent.severityText, 'INFO', 'admitted event has info severity');
equal(admittedEvent.traceparent, TRACEPARENT, 'traceparent propagates from receipt');
ok(admittedEvent.eventDigest.startsWith('sha256:'), 'telemetry event carries digest');
equal(
  cryptoAdmissionTelemetryEventSafetyFindings(admittedEvent).length,
  0,
  'telemetry event does not contain sensitive markers',
);

const blockedPlan = planFixture({
  surface: 'account-abstraction-bundler',
  adapterKind: 'erc-4337-user-operation',
  outcome: 'deny',
  blockedReasons: ['erc-7562-validation-failed'],
});
const blockedSubject = subjectFor(blockedPlan, 'blocked', 'block-route');
const blockedReceipt = createCryptoAdmissionReceipt({
  plan: blockedPlan,
  subject: blockedSubject,
  issuedAt: '2026-04-22T21:02:00.000Z',
  serviceId: 'attestor-crypto-admission',
  signer: SIGNER,
});
equal(blockedReceipt.classification, 'blocked', 'deny plan creates blocked receipt');
const blockedEvent = createCryptoAdmissionTelemetryEvent({
  source: 'attestor.crypto-execution-admission',
  observedAt: '2026-04-22T21:02:01.000Z',
  plan: blockedPlan,
  subject: blockedSubject,
  receipt: blockedReceipt,
});
equal(blockedEvent.signal, 'blocked', 'blocked event signal is inferred');
equal(blockedEvent.severityText, 'ERROR', 'blocked event has error severity');
ok(
  blockedEvent.data.failureReasons.includes('erc-7562-validation-failed'),
  'blocked event carries failure reasons',
);

const missingPlan = planFixture({
  surface: 'intent-solver',
  adapterKind: 'intent-settlement',
  outcome: 'needs-evidence',
});
const missingSubject = subjectFor(missingPlan, 'needs-solver-evidence', 'request-route-review');
const missingEvent = createCryptoAdmissionTelemetryEvent({
  source: 'attestor.crypto-execution-admission',
  observedAt: '2026-04-22T21:03:01.000Z',
  plan: missingPlan,
  subject: missingSubject,
  failureReasons: ['solver-route-commitment-missing'],
});
equal(missingEvent.signal, 'missing-evidence', 'missing event signal is inferred');
equal(missingEvent.severityText, 'WARN', 'missing evidence event has warning severity');

const receiptEvent = createCryptoAdmissionTelemetryEvent({
  source: 'attestor.crypto-execution-admission',
  observedAt: '2026-04-22T21:04:01.000Z',
  plan: admittedPlan,
  subject: admittedSubject,
  receipt: admittedReceipt,
  signal: 'receipt-issued',
});
equal(
  receiptEvent.type,
  'attestor.crypto_execution_admission.receipt',
  'receipt-issued events use the receipt event type',
);

assert.throws(
  () =>
    createCryptoAdmissionTelemetryEvent({
      source: 'attestor.crypto-execution-admission',
      observedAt: '2026-04-22T21:05:01.000Z',
      plan: admittedPlan,
      subject: admittedSubject,
      traceparent: 'bad-traceparent',
    }),
  /traceparent/,
  'bad traceparent is rejected',
);
passed += 1;

assert.throws(
  () =>
    createCryptoAdmissionReceipt({
      plan: admittedPlan,
      subject: createCryptoAdmissionTelemetrySubject({
        plan: admittedPlan,
        subjectKind: 'wrong-surface',
        subjectId: 'wrong-surface-subject',
        subjectDigest: 'sha256:wrong',
        surface: 'intent-solver',
      }),
      issuedAt: '2026-04-22T21:06:00.000Z',
      serviceId: 'attestor-crypto-admission',
      signer: SIGNER,
    }),
  /surface/,
  'subject surface mismatch is rejected',
);
passed += 1;

const sink = createInMemoryCryptoAdmissionTelemetrySink();
sink.emit(admittedEvent);
sink.emit(blockedEvent);
sink.emit(missingEvent);
sink.emit(receiptEvent);
equal(sink.events().length, 4, 'in-memory telemetry sink stores events');
const summary = buildCryptoAdmissionTelemetrySummary(sink.events());
equal(summary.eventCount, 4, 'summary counts all events');
equal(summary.admittedCount, 1, 'summary counts admitted events');
equal(summary.blockedCount, 1, 'summary counts blocked events');
equal(summary.missingEvidenceCount, 1, 'summary counts missing evidence events');
equal(summary.receiptIssuedCount, 1, 'summary counts receipt-issued events');
equal(summary.bySurface['wallet-rpc'], 2, 'summary groups events by surface');
equal(
  summary.failureReasonCounts['erc-7562-validation-failed'],
  1,
  'summary counts failure reasons',
);

const surfaces: readonly CryptoExecutionAdmissionSurface[] = [
  'attestor-core',
  'wallet-rpc',
  'smart-account-guard',
  'account-abstraction-bundler',
  'modular-account-runtime',
  'delegated-eoa-runtime',
  'agent-payment-http',
  'custody-policy-engine',
  'intent-solver',
];
for (const surface of surfaces) {
  const surfacePlan = planFixture({
    surface,
    adapterKind: surface === 'attestor-core' ? null : 'wallet-call-api',
  });
  const surfaceSubject = subjectFor(surfacePlan, 'ready');
  const surfaceReceipt = createCryptoAdmissionReceipt({
    plan: surfacePlan,
    subject: surfaceSubject,
    issuedAt: '2026-04-22T21:07:00.000Z',
    serviceId: 'attestor-crypto-admission',
    signer: SIGNER,
  });
  equal(
    verifyCryptoAdmissionReceipt({ receipt: surfaceReceipt, signer: SIGNER }).status,
    'valid',
    `${surface} receipt verifies`,
  );
}

const descriptor = cryptoAdmissionTelemetryDescriptor();
ok(
  descriptor.conventions.includes('CloudEvents 1.0 envelope fields'),
  'descriptor names CloudEvents envelope',
);
ok(
  descriptor.conventions.includes('W3C Trace Context traceparent/tracestate correlation'),
  'descriptor names W3C trace context',
);
ok(
  descriptor.safetyChecks.includes('signature verification'),
  'descriptor names signature verification',
);

console.log(`crypto-execution-admission-telemetry-receipts: ${passed} assertions passed`);
