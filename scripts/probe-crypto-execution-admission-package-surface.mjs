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
assert.equal(
  admission.erc4337BundlerAdmissionDescriptor().methods.includes('eth_sendUserOperation'),
  true,
);
assert.equal(
  admission.erc4337BundlerAdmissionDescriptor().standards.includes('ERC-7769'),
  true,
);
assert.equal(
  admission.modularAccountAdmissionDescriptor().standards.includes('ERC-7579'),
  true,
);
assert.equal(
  admission.modularAccountAdmissionDescriptor().runtimeChecks.includes('executionManifest'),
  true,
);
assert.equal(
  admission.delegatedEoaAdmissionDescriptor().standards.includes('EIP-7702'),
  true,
);
assert.equal(
  admission.delegatedEoaAdmissionDescriptor().runtimeChecks.includes('eip7702Auth'),
  true,
);
assert.equal(
  admission.x402ResourceServerAdmissionDescriptor().standards.includes('x402-v2'),
  true,
);
assert.equal(
  admission.x402ResourceServerAdmissionDescriptor().runtimeChecks.includes('PAYMENT-REQUIRED'),
  true,
);
assert.equal(
  admission.custodyPolicyAdmissionCallbackDescriptor().outcomes.includes('needs-review'),
  true,
);
assert.equal(
  admission.custodyPolicyAdmissionCallbackDescriptor().runtimeChecks.includes('callbackAuthentication'),
  true,
);
assert.equal(
  admission.intentSolverAdmissionDescriptor().standards.includes('ERC-7683'),
  true,
);
assert.equal(
  admission.intentSolverAdmissionDescriptor().runtimeChecks.includes('replayProtection'),
  true,
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
