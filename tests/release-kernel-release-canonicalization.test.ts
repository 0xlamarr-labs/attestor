import { strict as assert } from 'node:assert';
import {
  canonicalizeReleaseConsequenceEnvelope,
  canonicalizeReleaseJson,
  canonicalizeReleaseOutputEnvelope,
  createCanonicalReleaseHashBundle,
  RELEASE_CANONICALIZATION_SPEC_VERSION,
} from '../src/release-kernel/release-canonicalization.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function throws(fn: () => unknown, pattern: RegExp, message: string): void {
  assert.throws(fn, pattern, message);
  passed += 1;
}

async function main(): Promise<void> {
  const canonicalA = canonicalizeReleaseJson({
    z: 2,
    a: {
      beta: [true, null, 'x'],
      alpha: 1,
    },
  });
  const canonicalB = canonicalizeReleaseJson({
    a: {
      alpha: 1,
      beta: [true, null, 'x'],
    },
    z: 2,
  });

  equal(
    canonicalA,
    canonicalB,
    'Release canonicalization: semantically identical objects produce the same canonical JSON regardless of key order',
  );
  equal(
    canonicalA,
    '{"a":{"alpha":1,"beta":[true,null,"x"]},"z":2}',
    'Release canonicalization: canonical JSON is compact, sorted, and whitespace-free',
  );

  throws(
    () => canonicalizeReleaseJson({ bad: undefined as never }),
    /Undefined values are not canonicalizable/,
    'Release canonicalization: undefined object values are rejected instead of being silently dropped',
  );
  throws(
    () => canonicalizeReleaseJson({ bad: Number.NaN }),
    /Non-finite number is not canonicalizable/,
    'Release canonicalization: non-finite numbers are rejected to avoid lossy hashing',
  );
  throws(
    () => canonicalizeReleaseJson({ bad: new Date('2026-04-17T00:00:00.000Z') as never }),
    /Only plain JSON objects are canonicalizable/,
    'Release canonicalization: custom object instances are rejected instead of being coerced implicitly',
  );

  const outputCanonical = canonicalizeReleaseOutputEnvelope({
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    payload: {
      value: 42,
      field: 'totalAssets',
      currency: 'USD',
    },
  });
  ok(
    outputCanonical.includes('"artifactType":"financial-reporting.record-field"'),
    'Release canonicalization: output canonicalization binds the artifact contract metadata into the hashed envelope',
  );

  const consequenceCanonical = canonicalizeReleaseConsequenceEnvelope({
    consequenceType: 'record',
    target: {
      kind: 'record-store',
      id: 'finance.reporting.record-store',
    },
    recipientId: undefined,
    idempotencyKey: 'idem_001',
    payload: {
      field: 'totalAssets',
      recordId: 'balance-sheet-2026-03',
      value: 42,
    },
  });
  ok(
    consequenceCanonical.includes('"idempotencyKey":"idem_001"'),
    'Release canonicalization: consequence canonicalization binds idempotency semantics into the downstream hash',
  );

  const firstBundle = createCanonicalReleaseHashBundle({
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    target: {
      kind: 'record-store',
      id: 'finance.reporting.record-store',
    },
    outputPayload: {
      value: 42,
      field: 'totalAssets',
      currency: 'USD',
    },
    consequencePayload: {
      recordId: 'balance-sheet-2026-03',
      field: 'totalAssets',
      value: 42,
    },
    idempotencyKey: 'idem_001',
  });

  equal(
    firstBundle.version,
    RELEASE_CANONICALIZATION_SPEC_VERSION,
    'Release canonicalization: hash bundles carry a stable schema version',
  );
  ok(
    firstBundle.outputHash.startsWith('sha256:') && firstBundle.consequenceHash.startsWith('sha256:'),
    'Release canonicalization: both output and consequence hashes are emitted as explicit SHA-256 digests',
  );

  const reorderedBundle = createCanonicalReleaseHashBundle({
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    target: {
      kind: 'record-store',
      id: 'finance.reporting.record-store',
    },
    outputPayload: {
      currency: 'USD',
      field: 'totalAssets',
      value: 42,
    },
    consequencePayload: {
      value: 42,
      field: 'totalAssets',
      recordId: 'balance-sheet-2026-03',
    },
    idempotencyKey: 'idem_001',
  });

  equal(
    reorderedBundle.outputHash,
    firstBundle.outputHash,
    'Release canonicalization: output hashes remain stable when payload key order changes but meaning does not',
  );
  equal(
    reorderedBundle.consequenceHash,
    firstBundle.consequenceHash,
    'Release canonicalization: consequence hashes remain stable when payload key order changes but meaning does not',
  );

  const changedTargetBundle = createCanonicalReleaseHashBundle({
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    target: {
      kind: 'record-store',
      id: 'finance.reporting.secondary-store',
    },
    outputPayload: {
      value: 42,
      field: 'totalAssets',
      currency: 'USD',
    },
    consequencePayload: {
      recordId: 'balance-sheet-2026-03',
      field: 'totalAssets',
      value: 42,
    },
    idempotencyKey: 'idem_001',
  });

  equal(
    changedTargetBundle.outputHash,
    firstBundle.outputHash,
    'Release canonicalization: output hash stays stable when only the downstream target changes',
  );
  ok(
    changedTargetBundle.consequenceHash !== firstBundle.consequenceHash,
    'Release canonicalization: consequence hash changes when the bound downstream target changes',
  );

  console.log(`\nRelease kernel release-canonicalization tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-canonicalization tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
