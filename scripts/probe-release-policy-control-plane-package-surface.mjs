import assert from 'node:assert/strict';

const controlPlane = await import('attestor/release-policy-control-plane');

assert.equal(
  controlPlane.RELEASE_POLICY_CONTROL_PLANE_PLATFORM_SURFACE_SPEC_VERSION,
  'attestor.release-policy-control-plane-platform.v1',
);
assert.equal(
  controlPlane.releasePolicyControlPlane.types.POLICY_CONTROL_PLANE_SPEC_VERSION,
  'attestor.release-policy-control-plane.v1',
);
assert.equal(
  controlPlane.releasePolicyControlPlane.runtime.CONTROL_PLANE_RUNTIME_ENGINE_SPEC_VERSION,
  'attestor.policy-control-plane-runtime.v1',
);
assert.equal(
  controlPlane.releasePolicyControlPlane.financeProving.FINANCE_PROVING_POLICY_CONTROL_PLANE_SPEC_VERSION,
  'attestor.finance-proving-policy-control-plane.v1',
);

let blockedInternalPath = false;
try {
  await import('attestor/release-policy-control-plane/store.js');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  blockedInternalPath =
    message.includes('Package subpath') ||
    message.includes('ERR_PACKAGE_PATH_NOT_EXPORTED');
}

assert.equal(
  blockedInternalPath,
  true,
  'internal release-policy-control-plane module paths should stay outside the public package surface',
);

console.log('release-policy-control-plane package surface probe passed');
