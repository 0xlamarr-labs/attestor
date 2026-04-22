import {
  CRYPTO_ADMISSION_RECEIPT_CLASSIFICATIONS,
  CRYPTO_ADMISSION_RECEIPT_SIGNATURE_MODES,
  CRYPTO_ADMISSION_RECEIPT_SPEC_VERSION,
  CRYPTO_ADMISSION_TELEMETRY_EVENT_TYPE,
  CRYPTO_ADMISSION_TELEMETRY_SIGNALS,
  CRYPTO_ADMISSION_TELEMETRY_SPEC_VERSION,
  verifyCryptoAdmissionReceipt,
  type CryptoAdmissionReceipt,
  type CryptoAdmissionReceiptClassification,
  type CryptoAdmissionReceiptSigner,
  type CryptoAdmissionTelemetryEvent,
  type CryptoAdmissionTelemetrySignal,
  type CryptoAdmissionTelemetrySubject,
} from './telemetry-receipts.js';
import type {
  CryptoExecutionAdmissionOutcome,
  CryptoExecutionAdmissionPlan,
  CryptoExecutionAdmissionSurface,
} from './index.js';
import type { CryptoExecutionAdapterKind } from '../crypto-authorization-core/types.js';

/**
 * Adapter-neutral conformance fixtures for integrators that need to prove their
 * wallet, guard, bundler, payment, custody, or solver handoff honors the same
 * Attestor admission contract.
 */

export const CRYPTO_ADMISSION_CONFORMANCE_FIXTURES_SPEC_VERSION =
  'attestor.crypto-execution-admission-conformance-fixtures.v1';

export const CRYPTO_ADMISSION_CONFORMANCE_SCHEMA_DIALECT =
  'https://json-schema.org/draft/2020-12/schema';

export const CRYPTO_ADMISSION_CONFORMANCE_FIXTURE_PATH =
  'fixtures/crypto-execution-admission/conformance-fixtures.v1.json';

export const CRYPTO_ADMISSION_CONFORMANCE_SCHEMA_PATH =
  'fixtures/crypto-execution-admission/conformance-fixtures.schema.json';

export const CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES = [
  'wallet-rpc',
  'smart-account-guard',
  'account-abstraction-bundler',
  'modular-account-runtime',
  'delegated-eoa-runtime',
  'agent-payment-http',
  'custody-policy-engine',
  'intent-solver',
] as const satisfies readonly CryptoExecutionAdmissionSurface[];
export type CryptoAdmissionConformanceSurface =
  typeof CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES[number];

export const CRYPTO_ADMISSION_CONFORMANCE_RUNTIME_CHECKS = [
  'json-schema-2020-12-shape',
  'surface-coverage',
  'plan-subject-binding',
  'cloudevents-telemetry-shape',
  'signed-receipt-verification',
  'fail-closed-integrator-assertions',
] as const;
export type CryptoAdmissionConformanceRuntimeCheck =
  typeof CRYPTO_ADMISSION_CONFORMANCE_RUNTIME_CHECKS[number];

export const CRYPTO_ADMISSION_CONFORMANCE_TELEMETRY_SIGNALS = [
  'admitted',
  'blocked',
  'missing-evidence',
] as const satisfies readonly Exclude<CryptoAdmissionTelemetrySignal, 'receipt-issued'>[];

export interface CryptoAdmissionConformanceFixtureSigner
  extends CryptoAdmissionReceiptSigner {
  readonly purpose: 'fixture-only';
}

export interface CryptoAdmissionConformanceFixture {
  readonly fixtureId: string;
  readonly surface: CryptoAdmissionConformanceSurface;
  readonly adapterKind: CryptoExecutionAdapterKind;
  readonly standards: readonly string[];
  readonly scenario: string;
  readonly expectedSignal: Exclude<CryptoAdmissionTelemetrySignal, 'receipt-issued'>;
  readonly expectedReceiptClassification: CryptoAdmissionReceiptClassification;
  readonly expectedPlanOutcome: CryptoExecutionAdmissionOutcome;
  readonly expectedDownstreamAction: string;
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly subject: CryptoAdmissionTelemetrySubject;
  readonly telemetryEvent: CryptoAdmissionTelemetryEvent;
  readonly receipt: CryptoAdmissionReceipt;
  readonly externalIntegratorAssertions: readonly string[];
}

export interface CryptoAdmissionConformanceFixtureSuite {
  readonly version: typeof CRYPTO_ADMISSION_CONFORMANCE_FIXTURES_SPEC_VERSION;
  readonly schemaDialect: typeof CRYPTO_ADMISSION_CONFORMANCE_SCHEMA_DIALECT;
  readonly generatedAt: string;
  readonly fixtureSigner: CryptoAdmissionConformanceFixtureSigner;
  readonly requiredSurfaces: readonly CryptoAdmissionConformanceSurface[];
  readonly fixtures: readonly CryptoAdmissionConformanceFixture[];
}

export interface CryptoAdmissionConformanceDescriptor {
  readonly fixtureVersion: typeof CRYPTO_ADMISSION_CONFORMANCE_FIXTURES_SPEC_VERSION;
  readonly schemaDialect: typeof CRYPTO_ADMISSION_CONFORMANCE_SCHEMA_DIALECT;
  readonly fixturePath: typeof CRYPTO_ADMISSION_CONFORMANCE_FIXTURE_PATH;
  readonly schemaPath: typeof CRYPTO_ADMISSION_CONFORMANCE_SCHEMA_PATH;
  readonly requiredSurfaces: typeof CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES;
  readonly runtimeChecks: typeof CRYPTO_ADMISSION_CONFORMANCE_RUNTIME_CHECKS;
  readonly telemetrySignals: typeof CRYPTO_ADMISSION_CONFORMANCE_TELEMETRY_SIGNALS;
  readonly receiptClassifications: typeof CRYPTO_ADMISSION_RECEIPT_CLASSIFICATIONS;
}

export type CryptoAdmissionConformanceFindingSeverity = 'error' | 'warning';

export interface CryptoAdmissionConformanceValidationFinding {
  readonly severity: CryptoAdmissionConformanceFindingSeverity;
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface CryptoAdmissionConformanceValidationResult {
  readonly status: 'valid' | 'invalid';
  readonly fixtureCount: number;
  readonly coveredSurfaces: readonly CryptoAdmissionConformanceSurface[];
  readonly missingSurfaces: readonly CryptoAdmissionConformanceSurface[];
  readonly findings: readonly CryptoAdmissionConformanceValidationFinding[];
}

const EXPECTED_SIGNAL_BY_OUTCOME: Readonly<
  Record<CryptoExecutionAdmissionOutcome, Exclude<CryptoAdmissionTelemetrySignal, 'receipt-issued'>>
> = Object.freeze({
  admit: 'admitted',
  deny: 'blocked',
  'needs-evidence': 'missing-evidence',
});

const EXPECTED_CLASSIFICATION_BY_OUTCOME: Readonly<
  Record<CryptoExecutionAdmissionOutcome, CryptoAdmissionReceiptClassification>
> = Object.freeze({
  admit: 'admitted',
  deny: 'blocked',
  'needs-evidence': 'missing-evidence',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringAt(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function arrayAt(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function hasStringArray(record: Record<string, unknown>, key: string): boolean {
  return arrayAt(record, key).every((item) => typeof item === 'string');
}

function pushFinding(
  findings: CryptoAdmissionConformanceValidationFinding[],
  finding: CryptoAdmissionConformanceValidationFinding,
): void {
  findings.push(Object.freeze(finding));
}

function pushError(
  findings: CryptoAdmissionConformanceValidationFinding[],
  path: string,
  code: string,
  message: string,
): void {
  pushFinding(findings, {
    severity: 'error',
    code,
    path,
    message,
  });
}

function isRequiredSurface(value: unknown): value is CryptoAdmissionConformanceSurface {
  return typeof value === 'string' &&
    CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES.includes(
      value as CryptoAdmissionConformanceSurface,
    );
}

function isTelemetrySignal(
  value: unknown,
): value is Exclude<CryptoAdmissionTelemetrySignal, 'receipt-issued'> {
  return typeof value === 'string' &&
    value !== 'receipt-issued' &&
    CRYPTO_ADMISSION_TELEMETRY_SIGNALS.includes(
      value as CryptoAdmissionTelemetrySignal,
    );
}

function isReceiptClassification(
  value: unknown,
): value is CryptoAdmissionReceiptClassification {
  return typeof value === 'string' &&
    CRYPTO_ADMISSION_RECEIPT_CLASSIFICATIONS.includes(
      value as CryptoAdmissionReceiptClassification,
    );
}

function isPlanOutcome(value: unknown): value is CryptoExecutionAdmissionOutcome {
  return value === 'admit' || value === 'deny' || value === 'needs-evidence';
}

function isSha256Digest(value: unknown): boolean {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function assertEqual(
  findings: CryptoAdmissionConformanceValidationFinding[],
  actual: unknown,
  expected: unknown,
  path: string,
  code: string,
  message: string,
): void {
  if (actual !== expected) {
    pushError(findings, path, code, message);
  }
}

function validateFixture(
  input: unknown,
  index: number,
  signer: CryptoAdmissionConformanceFixtureSigner | null,
  seenFixtureIds: Set<string>,
  coveredSurfaces: Set<CryptoAdmissionConformanceSurface>,
  findings: CryptoAdmissionConformanceValidationFinding[],
): void {
  const path = `fixtures[${index}]`;
  if (!isRecord(input)) {
    pushError(findings, path, 'fixture-not-object', 'Fixture must be an object.');
    return;
  }

  const fixtureId = stringAt(input, 'fixtureId');
  if (fixtureId == null || fixtureId.length === 0) {
    pushError(findings, `${path}.fixtureId`, 'fixture-id-required', 'Fixture id is required.');
  } else if (seenFixtureIds.has(fixtureId)) {
    pushError(
      findings,
      `${path}.fixtureId`,
      'fixture-id-duplicate',
      `Fixture id ${fixtureId} appears more than once.`,
    );
  } else {
    seenFixtureIds.add(fixtureId);
  }

  const surface = input.surface;
  if (!isRequiredSurface(surface)) {
    pushError(
      findings,
      `${path}.surface`,
      'surface-unsupported',
      'Fixture surface must be one of the required external admission surfaces.',
    );
  } else {
    coveredSurfaces.add(surface);
  }

  if (stringAt(input, 'adapterKind') == null) {
    pushError(findings, `${path}.adapterKind`, 'adapter-kind-required', 'Adapter kind is required.');
  }
  if (stringAt(input, 'scenario') == null) {
    pushError(findings, `${path}.scenario`, 'scenario-required', 'Scenario is required.');
  }
  if (!hasStringArray(input, 'standards') || arrayAt(input, 'standards').length === 0) {
    pushError(
      findings,
      `${path}.standards`,
      'standards-required',
      'Fixture must name at least one external standard or surface convention.',
    );
  }
  if (!hasStringArray(input, 'externalIntegratorAssertions') ||
    arrayAt(input, 'externalIntegratorAssertions').length < 4) {
    pushError(
      findings,
      `${path}.externalIntegratorAssertions`,
      'integrator-assertions-required',
      'Fixture must include fail-closed assertions for external integrators.',
    );
  }

  const expectedSignal = input.expectedSignal;
  const expectedReceiptClassification = input.expectedReceiptClassification;
  const expectedPlanOutcome = input.expectedPlanOutcome;
  if (!isTelemetrySignal(expectedSignal)) {
    pushError(
      findings,
      `${path}.expectedSignal`,
      'expected-signal-invalid',
      'Expected signal must be admitted, blocked, or missing-evidence.',
    );
  }
  if (!isReceiptClassification(expectedReceiptClassification)) {
    pushError(
      findings,
      `${path}.expectedReceiptClassification`,
      'expected-classification-invalid',
      'Expected receipt classification is invalid.',
    );
  }
  if (!isPlanOutcome(expectedPlanOutcome)) {
    pushError(
      findings,
      `${path}.expectedPlanOutcome`,
      'expected-plan-outcome-invalid',
      'Expected plan outcome is invalid.',
    );
  }
  if (stringAt(input, 'expectedDownstreamAction') == null) {
    pushError(
      findings,
      `${path}.expectedDownstreamAction`,
      'expected-action-required',
      'Expected downstream action is required.',
    );
  }
  if (isPlanOutcome(expectedPlanOutcome) && isTelemetrySignal(expectedSignal)) {
    assertEqual(
      findings,
      expectedSignal,
      EXPECTED_SIGNAL_BY_OUTCOME[expectedPlanOutcome],
      `${path}.expectedSignal`,
      'signal-outcome-mismatch',
      'Expected telemetry signal must match the expected plan outcome.',
    );
  }
  if (isPlanOutcome(expectedPlanOutcome) && isReceiptClassification(expectedReceiptClassification)) {
    assertEqual(
      findings,
      expectedReceiptClassification,
      EXPECTED_CLASSIFICATION_BY_OUTCOME[expectedPlanOutcome],
      `${path}.expectedReceiptClassification`,
      'classification-outcome-mismatch',
      'Expected receipt classification must match the expected plan outcome.',
    );
  }

  const plan = input.plan;
  const subject = input.subject;
  const telemetryEvent = input.telemetryEvent;
  const receipt = input.receipt;
  if (!isRecord(plan)) {
    pushError(findings, `${path}.plan`, 'plan-required', 'Plan fixture object is required.');
  }
  if (!isRecord(subject)) {
    pushError(
      findings,
      `${path}.subject`,
      'subject-required',
      'Telemetry subject fixture object is required.',
    );
  }
  if (!isRecord(telemetryEvent)) {
    pushError(
      findings,
      `${path}.telemetryEvent`,
      'telemetry-event-required',
      'Telemetry event fixture object is required.',
    );
  }
  if (!isRecord(receipt)) {
    pushError(findings, `${path}.receipt`, 'receipt-required', 'Receipt fixture object is required.');
  }
  if (!isRecord(plan) || !isRecord(subject) || !isRecord(telemetryEvent) || !isRecord(receipt)) {
    return;
  }

  assertEqual(
    findings,
    plan.version,
    'attestor.crypto-execution-admission.v1',
    `${path}.plan.version`,
    'plan-version-mismatch',
    'Plan version must match crypto execution admission v1.',
  );
  assertEqual(
    findings,
    plan.surface,
    surface,
    `${path}.plan.surface`,
    'plan-surface-mismatch',
    'Plan surface must match fixture surface.',
  );
  assertEqual(
    findings,
    plan.adapterKind,
    input.adapterKind,
    `${path}.plan.adapterKind`,
    'plan-adapter-mismatch',
    'Plan adapter kind must match fixture adapter kind.',
  );
  assertEqual(
    findings,
    plan.outcome,
    expectedPlanOutcome,
    `${path}.plan.outcome`,
    'plan-outcome-mismatch',
    'Plan outcome must match fixture expectation.',
  );
  if (!isSha256Digest(plan.digest)) {
    pushError(
      findings,
      `${path}.plan.digest`,
      'plan-digest-invalid',
      'Plan digest must be a sha256 digest.',
    );
  }

  assertEqual(
    findings,
    subject.surface,
    surface,
    `${path}.subject.surface`,
    'subject-surface-mismatch',
    'Subject surface must match fixture surface.',
  );
  assertEqual(
    findings,
    subject.adapterKind,
    input.adapterKind,
    `${path}.subject.adapterKind`,
    'subject-adapter-mismatch',
    'Subject adapter kind must match fixture adapter kind.',
  );
  assertEqual(
    findings,
    subject.planId,
    plan.planId,
    `${path}.subject.planId`,
    'subject-plan-id-mismatch',
    'Subject plan id must bind to plan id.',
  );
  assertEqual(
    findings,
    subject.planDigest,
    plan.digest,
    `${path}.subject.planDigest`,
    'subject-plan-digest-mismatch',
    'Subject plan digest must bind to plan digest.',
  );
  if (!isSha256Digest(subject.subjectDigest)) {
    pushError(
      findings,
      `${path}.subject.subjectDigest`,
      'subject-digest-invalid',
      'Subject digest must be a sha256 digest.',
    );
  }

  assertEqual(
    findings,
    telemetryEvent.version,
    CRYPTO_ADMISSION_TELEMETRY_SPEC_VERSION,
    `${path}.telemetryEvent.version`,
    'telemetry-version-mismatch',
    'Telemetry version must match crypto admission telemetry v1.',
  );
  assertEqual(
    findings,
    telemetryEvent.specversion,
    '1.0',
    `${path}.telemetryEvent.specversion`,
    'telemetry-specversion-mismatch',
    'Telemetry event must use CloudEvents specversion 1.0.',
  );
  assertEqual(
    findings,
    telemetryEvent.type,
    CRYPTO_ADMISSION_TELEMETRY_EVENT_TYPE,
    `${path}.telemetryEvent.type`,
    'telemetry-type-mismatch',
    'Conformance telemetry event must be an admission decision event.',
  );
  assertEqual(
    findings,
    telemetryEvent.signal,
    expectedSignal,
    `${path}.telemetryEvent.signal`,
    'telemetry-signal-mismatch',
    'Telemetry signal must match fixture expectation.',
  );
  const eventData = isRecord(telemetryEvent.data) ? telemetryEvent.data : null;
  if (eventData == null) {
    pushError(
      findings,
      `${path}.telemetryEvent.data`,
      'telemetry-data-required',
      'Telemetry data object is required.',
    );
  } else {
    assertEqual(
      findings,
      eventData.planId,
      plan.planId,
      `${path}.telemetryEvent.data.planId`,
      'telemetry-plan-id-mismatch',
      'Telemetry plan id must bind to plan id.',
    );
    assertEqual(
      findings,
      eventData.planDigest,
      plan.digest,
      `${path}.telemetryEvent.data.planDigest`,
      'telemetry-plan-digest-mismatch',
      'Telemetry plan digest must bind to plan digest.',
    );
    assertEqual(
      findings,
      eventData.surface,
      surface,
      `${path}.telemetryEvent.data.surface`,
      'telemetry-surface-mismatch',
      'Telemetry surface must match fixture surface.',
    );
    assertEqual(
      findings,
      eventData.subjectId,
      subject.subjectId,
      `${path}.telemetryEvent.data.subjectId`,
      'telemetry-subject-id-mismatch',
      'Telemetry subject id must bind to subject.',
    );
  }
  if (!isSha256Digest(telemetryEvent.eventDigest)) {
    pushError(
      findings,
      `${path}.telemetryEvent.eventDigest`,
      'telemetry-digest-invalid',
      'Telemetry event digest must be a sha256 digest.',
    );
  }

  assertEqual(
    findings,
    receipt.version,
    CRYPTO_ADMISSION_RECEIPT_SPEC_VERSION,
    `${path}.receipt.version`,
    'receipt-version-mismatch',
    'Receipt version must match crypto admission receipt v1.',
  );
  assertEqual(
    findings,
    receipt.classification,
    expectedReceiptClassification,
    `${path}.receipt.classification`,
    'receipt-classification-mismatch',
    'Receipt classification must match fixture expectation.',
  );
  assertEqual(
    findings,
    receipt.planId,
    plan.planId,
    `${path}.receipt.planId`,
    'receipt-plan-id-mismatch',
    'Receipt plan id must bind to plan id.',
  );
  assertEqual(
    findings,
    receipt.planDigest,
    plan.digest,
    `${path}.receipt.planDigest`,
    'receipt-plan-digest-mismatch',
    'Receipt plan digest must bind to plan digest.',
  );
  assertEqual(
    findings,
    receipt.surface,
    surface,
    `${path}.receipt.surface`,
    'receipt-surface-mismatch',
    'Receipt surface must match fixture surface.',
  );
  assertEqual(
    findings,
    receipt.adapterKind,
    input.adapterKind,
    `${path}.receipt.adapterKind`,
    'receipt-adapter-mismatch',
    'Receipt adapter kind must match fixture adapter kind.',
  );
  assertEqual(
    findings,
    receipt.planOutcome,
    expectedPlanOutcome,
    `${path}.receipt.planOutcome`,
    'receipt-plan-outcome-mismatch',
    'Receipt plan outcome must match fixture expectation.',
  );
  if (!isSha256Digest(receipt.receiptDigest)) {
    pushError(
      findings,
      `${path}.receipt.receiptDigest`,
      'receipt-digest-invalid',
      'Receipt digest must be a sha256 digest.',
    );
  }
  const signature = isRecord(receipt.signature) ? receipt.signature : null;
  if (signature == null) {
    pushError(
      findings,
      `${path}.receipt.signature`,
      'receipt-signature-required',
      'Receipt signature object is required.',
    );
  } else {
    assertEqual(
      findings,
      signature.mode,
      CRYPTO_ADMISSION_RECEIPT_SIGNATURE_MODES[0],
      `${path}.receipt.signature.mode`,
      'receipt-signature-mode-mismatch',
      'Receipt signature must use the fixture signature mode.',
    );
    if (signer != null) {
      assertEqual(
        findings,
        signature.keyId,
        signer.keyId,
        `${path}.receipt.signature.keyId`,
        'receipt-signature-key-mismatch',
        'Receipt signature key must match fixture signer key id.',
      );
      try {
        const verification = verifyCryptoAdmissionReceipt({
          receipt: receipt as unknown as CryptoAdmissionReceipt,
          signer,
        });
        if (verification.status !== 'valid') {
          pushError(
            findings,
            `${path}.receipt.signature`,
            'receipt-signature-invalid',
            `Receipt signature failed verification: ${verification.failureReasons.join(', ')}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushError(
          findings,
          `${path}.receipt.signature`,
          'receipt-signature-verification-error',
          message,
        );
      }
    }
  }
}

function fixtureSignerFrom(input: Record<string, unknown>): CryptoAdmissionConformanceFixtureSigner | null {
  const signerInput = input.fixtureSigner;
  if (!isRecord(signerInput)) {
    return null;
  }
  const keyId = stringAt(signerInput, 'keyId');
  const secret = stringAt(signerInput, 'secret');
  const purpose = signerInput.purpose;
  if (keyId == null || secret == null || purpose !== 'fixture-only') {
    return null;
  }
  return Object.freeze({
    keyId,
    secret,
    purpose,
  });
}

export function validateCryptoAdmissionConformanceFixtureSuite(
  suite: unknown,
): CryptoAdmissionConformanceValidationResult {
  const findings: CryptoAdmissionConformanceValidationFinding[] = [];
  const coveredSurfaces = new Set<CryptoAdmissionConformanceSurface>();
  const seenFixtureIds = new Set<string>();

  if (!isRecord(suite)) {
    pushError(findings, '$', 'suite-not-object', 'Conformance suite must be an object.');
    return Object.freeze({
      status: 'invalid',
      fixtureCount: 0,
      coveredSurfaces: Object.freeze([]),
      missingSurfaces: CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES,
      findings: Object.freeze(findings),
    });
  }

  assertEqual(
    findings,
    suite.version,
    CRYPTO_ADMISSION_CONFORMANCE_FIXTURES_SPEC_VERSION,
    '$.version',
    'suite-version-mismatch',
    'Suite version must match crypto admission conformance fixtures v1.',
  );
  assertEqual(
    findings,
    suite.schemaDialect,
    CRYPTO_ADMISSION_CONFORMANCE_SCHEMA_DIALECT,
    '$.schemaDialect',
    'schema-dialect-mismatch',
    'Suite schema dialect must be JSON Schema Draft 2020-12.',
  );
  if (stringAt(suite, 'generatedAt') == null) {
    pushError(findings, '$.generatedAt', 'generated-at-required', 'Generated timestamp is required.');
  }

  const signer = fixtureSignerFrom(suite);
  if (signer == null) {
    pushError(
      findings,
      '$.fixtureSigner',
      'fixture-signer-invalid',
      'Fixture signer must include keyId, secret, and purpose=fixture-only.',
    );
  }

  const requiredSurfaces = arrayAt(suite, 'requiredSurfaces');
  for (const requiredSurface of CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES) {
    if (!requiredSurfaces.includes(requiredSurface)) {
      pushError(
        findings,
        '$.requiredSurfaces',
        'required-surface-missing-from-suite',
        `Suite requiredSurfaces must include ${requiredSurface}.`,
      );
    }
  }

  const fixtures = arrayAt(suite, 'fixtures');
  if (fixtures.length === 0) {
    pushError(findings, '$.fixtures', 'fixtures-empty', 'At least one conformance fixture is required.');
  }
  fixtures.forEach((fixture, index) =>
    validateFixture(fixture, index, signer, seenFixtureIds, coveredSurfaces, findings),
  );

  const missingSurfaces = CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES.filter(
    (surface) => !coveredSurfaces.has(surface),
  );
  for (const missingSurface of missingSurfaces) {
    pushError(
      findings,
      '$.fixtures',
      'surface-coverage-missing',
      `No conformance fixture covers ${missingSurface}.`,
    );
  }

  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  return Object.freeze({
    status: errorCount === 0 ? 'valid' : 'invalid',
    fixtureCount: fixtures.length,
    coveredSurfaces: Object.freeze([...coveredSurfaces].sort()),
    missingSurfaces: Object.freeze(missingSurfaces),
    findings: Object.freeze(findings),
  });
}

export function cryptoAdmissionConformanceDescriptor():
CryptoAdmissionConformanceDescriptor {
  return Object.freeze({
    fixtureVersion: CRYPTO_ADMISSION_CONFORMANCE_FIXTURES_SPEC_VERSION,
    schemaDialect: CRYPTO_ADMISSION_CONFORMANCE_SCHEMA_DIALECT,
    fixturePath: CRYPTO_ADMISSION_CONFORMANCE_FIXTURE_PATH,
    schemaPath: CRYPTO_ADMISSION_CONFORMANCE_SCHEMA_PATH,
    requiredSurfaces: CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES,
    runtimeChecks: CRYPTO_ADMISSION_CONFORMANCE_RUNTIME_CHECKS,
    telemetrySignals: CRYPTO_ADMISSION_CONFORMANCE_TELEMETRY_SIGNALS,
    receiptClassifications: CRYPTO_ADMISSION_RECEIPT_CLASSIFICATIONS,
  });
}
