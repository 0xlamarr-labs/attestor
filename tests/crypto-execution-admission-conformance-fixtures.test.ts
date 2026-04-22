import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES,
  cryptoAdmissionConformanceDescriptor,
  validateCryptoAdmissionConformanceFixtureSuite,
} from '../src/crypto-execution-admission/index.js';

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
  assert.deepEqual(actual, expected, message);
  passed += 1;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): JsonRecord {
  assert.equal(typeof value, 'object', `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
  return value as JsonRecord;
}

function asArray(value: unknown, label: string): JsonRecord[] {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  return value as JsonRecord[];
}

const suiteUrl = new URL(
  '../fixtures/crypto-execution-admission/conformance-fixtures.v1.json',
  import.meta.url,
);
const schemaUrl = new URL(
  '../fixtures/crypto-execution-admission/conformance-fixtures.schema.json',
  import.meta.url,
);

const suite = JSON.parse(await readFile(suiteUrl, 'utf8')) as JsonRecord;
const schema = JSON.parse(await readFile(schemaUrl, 'utf8')) as JsonRecord;

const descriptor = cryptoAdmissionConformanceDescriptor();
equal(
  descriptor.fixtureVersion,
  'attestor.crypto-execution-admission-conformance-fixtures.v1',
  'descriptor exposes conformance fixture version',
);
equal(
  descriptor.schemaDialect,
  'https://json-schema.org/draft/2020-12/schema',
  'descriptor names the JSON Schema dialect',
);
ok(
  descriptor.runtimeChecks.includes('signed-receipt-verification'),
  'descriptor includes signed receipt verification',
);
ok(
  descriptor.runtimeChecks.includes('fail-closed-integrator-assertions'),
  'descriptor includes fail-closed integrator assertions',
);

equal(
  schema.$schema,
  descriptor.schemaDialect,
  'schema uses the descriptor JSON Schema dialect',
);
equal(
  schema.$id,
  'https://attestor.dev/schemas/crypto-execution-admission/conformance-fixtures.v1',
  'schema exposes a stable id',
);

const validation = validateCryptoAdmissionConformanceFixtureSuite(suite);
if (validation.status !== 'valid') {
  assert.fail(JSON.stringify(validation.findings, null, 2));
}
passed += 1;
equal(validation.fixtureCount, 8, 'suite carries one fixture per external surface');
deepEqual(validation.missingSurfaces, [], 'suite has no missing required surfaces');
deepEqual(
  [...validation.coveredSurfaces].sort(),
  [...CRYPTO_ADMISSION_CONFORMANCE_REQUIRED_SURFACES].sort(),
  'suite covers every required external surface',
);

const fixtures = asArray(suite.fixtures, 'fixtures');
const signals = new Set(fixtures.map((fixture) => fixture.expectedSignal));
ok(signals.has('admitted'), 'suite includes admitted fixtures');
ok(signals.has('blocked'), 'suite includes blocked fixtures');
ok(signals.has('missing-evidence'), 'suite includes missing-evidence fixtures');

for (const fixture of fixtures) {
  const plan = asRecord(fixture.plan, `${fixture.fixtureId}.plan`);
  const subject = asRecord(fixture.subject, `${fixture.fixtureId}.subject`);
  const telemetryEvent = asRecord(
    fixture.telemetryEvent,
    `${fixture.fixtureId}.telemetryEvent`,
  );
  const receipt = asRecord(fixture.receipt, `${fixture.fixtureId}.receipt`);
  const eventData = asRecord(telemetryEvent.data, `${fixture.fixtureId}.telemetryEvent.data`);
  const receiptSubject = asRecord(receipt.subject, `${fixture.fixtureId}.receipt.subject`);

  equal(plan.surface, fixture.surface, `${fixture.fixtureId} plan surface matches`);
  equal(subject.planDigest, plan.digest, `${fixture.fixtureId} subject binds plan digest`);
  equal(eventData.planId, plan.planId, `${fixture.fixtureId} event binds plan id`);
  equal(receipt.planDigest, plan.digest, `${fixture.fixtureId} receipt binds plan digest`);
  equal(
    receiptSubject.subjectDigest,
    subject.subjectDigest,
    `${fixture.fixtureId} receipt embeds subject digest`,
  );
}

const duplicateSuite = cloneJson(suite);
const duplicateFixtures = asArray(duplicateSuite.fixtures, 'duplicate fixtures');
duplicateFixtures[1].fixtureId = duplicateFixtures[0].fixtureId;
const duplicateValidation = validateCryptoAdmissionConformanceFixtureSuite(duplicateSuite);
equal(duplicateValidation.status, 'invalid', 'duplicate fixture ids are rejected');
ok(
  duplicateValidation.findings.some((finding) => finding.code === 'fixture-id-duplicate'),
  'duplicate id finding is reported',
);

const wrongSignalSuite = cloneJson(suite);
const wrongSignalFixture = asArray(wrongSignalSuite.fixtures, 'wrong signal fixtures')[0];
wrongSignalFixture.expectedSignal = 'blocked';
const wrongSignalValidation = validateCryptoAdmissionConformanceFixtureSuite(wrongSignalSuite);
equal(wrongSignalValidation.status, 'invalid', 'signal/outcome mismatches are rejected');
ok(
  wrongSignalValidation.findings.some((finding) => finding.code === 'signal-outcome-mismatch'),
  'signal/outcome mismatch finding is reported',
);

const missingSurfaceSuite = cloneJson(suite);
missingSurfaceSuite.fixtures = asArray(
  missingSurfaceSuite.fixtures,
  'missing surface fixtures',
).filter((fixture) => fixture.surface !== 'intent-solver');
const missingSurfaceValidation =
  validateCryptoAdmissionConformanceFixtureSuite(missingSurfaceSuite);
equal(missingSurfaceValidation.status, 'invalid', 'missing surface coverage is rejected');
ok(
  missingSurfaceValidation.findings.some((finding) => finding.code === 'surface-coverage-missing'),
  'missing surface finding is reported',
);

const badSignatureSuite = cloneJson(suite);
const badSignatureReceipt = asRecord(
  asArray(badSignatureSuite.fixtures, 'bad signature fixtures')[0].receipt,
  'bad signature receipt',
);
const badSignature = asRecord(badSignatureReceipt.signature, 'bad signature');
badSignature.value = 'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000';
const badSignatureValidation = validateCryptoAdmissionConformanceFixtureSuite(badSignatureSuite);
equal(badSignatureValidation.status, 'invalid', 'bad fixture signatures are rejected');
ok(
  badSignatureValidation.findings.some((finding) => finding.code === 'receipt-signature-invalid'),
  'bad signature finding is reported',
);

console.log(`crypto-execution-admission-conformance-fixtures: ${passed} assertions passed`);
