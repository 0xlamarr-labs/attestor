import assert from 'node:assert/strict';

const admission = await import('attestor/crypto-execution-admission');

assert.equal(
  admission.CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION,
  'attestor.crypto-execution-admission.v1',
);
assert.equal(
  admission.cryptoExecutionAdmissionDescriptor().subpath,
  'attestor/crypto-execution-admission',
);
assert.equal(
  admission.cryptoExecutionAdmissionAdapterProfile('x402-payment').surface,
  'agent-payment-http',
);

let blockedInternalPath = false;
try {
  await import('attestor/crypto-execution-admission/index.js');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  blockedInternalPath =
    message.includes('Package subpath') ||
    message.includes('ERR_PACKAGE_PATH_NOT_EXPORTED');
}

assert.equal(
  blockedInternalPath,
  true,
  'internal crypto execution admission module paths should stay outside the public package surface',
);

console.log('crypto-execution-admission package surface probe passed');
