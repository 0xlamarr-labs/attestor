import assert from 'node:assert/strict';

const enforcementPlane = await import('attestor/release-enforcement-plane');

assert.equal(
  enforcementPlane.RELEASE_ENFORCEMENT_PLANE_PLATFORM_SURFACE_SPEC_VERSION,
  'attestor.release-enforcement-plane-platform.v1',
);
assert.equal(
  enforcementPlane.releaseEnforcementPlane.types.RELEASE_ENFORCEMENT_PLANE_SPEC_VERSION,
  'attestor.release-enforcement-plane.v1',
);
assert.equal(
  enforcementPlane.releaseEnforcementPlane.offlineVerifier.OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
  'attestor.release-enforcement-offline-verifier.v1',
);
assert.equal(
  enforcementPlane.releaseEnforcementPlane.telemetry.RELEASE_ENFORCEMENT_TELEMETRY_SPEC_VERSION,
  'attestor.release-enforcement-telemetry.v1',
);
assert.equal(
  enforcementPlane.releaseEnforcementPlane.conformance.RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION,
  'attestor.release-enforcement-conformance.v1',
);

let blockedInternalPath = false;
try {
  await import('attestor/release-enforcement-plane/offline-verifier.js');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  blockedInternalPath =
    message.includes('Package subpath') ||
    message.includes('ERR_PACKAGE_PATH_NOT_EXPORTED');
}

assert.equal(
  blockedInternalPath,
  true,
  'internal release-enforcement-plane module paths should stay outside the public package surface',
);

console.log('release-enforcement-plane package surface probe passed');
