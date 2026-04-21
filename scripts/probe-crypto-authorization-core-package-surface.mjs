import assert from 'node:assert/strict';

const cryptoCore = await import('attestor/crypto-authorization-core');

assert.equal(
  cryptoCore.CRYPTO_AUTHORIZATION_CORE_PLATFORM_SURFACE_SPEC_VERSION,
  'attestor.crypto-authorization-core-platform.v1',
);
assert.equal(
  cryptoCore.cryptoAuthorizationCore.types.CRYPTO_AUTHORIZATION_CORE_SPEC_VERSION,
  'attestor.crypto-authorization-core.v1',
);
assert.equal(
  cryptoCore.cryptoAuthorizationCore.simulation.CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION,
  'attestor.crypto-authorization-simulation.v1',
);
assert.equal(
  cryptoCore.cryptoAuthorizationCore.x402AgenticPayment.X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
  'attestor.crypto-x402-agentic-payment-adapter.v1',
);
assert.equal(
  cryptoCore.cryptoAuthorizationCore.custodyCosignerPolicy.CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION,
  'attestor.crypto-custody-cosigner-policy-adapter.v1',
);

let blockedInternalPath = false;
try {
  await import('attestor/crypto-authorization-core/types.js');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  blockedInternalPath =
    message.includes('Package subpath') ||
    message.includes('ERR_PACKAGE_PATH_NOT_EXPORTED');
}

assert.equal(
  blockedInternalPath,
  true,
  'internal crypto authorization core module paths should stay outside the public package surface',
);

console.log('crypto-authorization-core package surface probe passed');
