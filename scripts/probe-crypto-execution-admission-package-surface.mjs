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
assert.equal(
  admission.walletRpcAdmissionDescriptor().methods.includes('wallet_sendCalls'),
  true,
);
assert.equal(
  admission.walletRpcAdmissionDescriptor().erc7902Capabilities.includes('eip7702Auth'),
  true,
);
assert.equal(
  admission.safeGuardAdmissionDescriptor().interfaceIds.transactionGuard,
  '0xe6d7a83a',
);
assert.equal(
  admission.safeGuardAdmissionDescriptor().interfaceIds.moduleGuard,
  '0x58401ed8',
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
