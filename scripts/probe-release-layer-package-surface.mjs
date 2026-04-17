import assert from 'node:assert/strict';

const core = await import('attestor/release-layer');
const finance = await import('attestor/release-layer/finance');

assert.equal(
  core.RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION,
  'attestor.release-layer-platform.v1',
);
assert.equal(
  core.releaseLayer.token.RELEASE_TOKEN_ISSUANCE_SPEC_VERSION,
  'attestor.release-token-issuance.v1',
);
assert.equal(
  finance.RELEASE_LAYER_FINANCE_SURFACE_SPEC_VERSION,
  'attestor.release-layer-finance.v1',
);
assert.equal(
  finance.financeReleaseLayer.record.FINANCE_RECORD_RELEASE_SPEC_VERSION,
  'attestor.finance-record-release.v1',
);

let blockedInternalPath = false;
try {
  await import('attestor/release-kernel/release-token.js');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  blockedInternalPath =
    message.includes('Package subpath') ||
    message.includes('ERR_PACKAGE_PATH_NOT_EXPORTED');
}

assert.equal(
  blockedInternalPath,
  true,
  'internal release-kernel paths should stay outside the public package surface',
);

console.log('release-layer package surface probe passed');
