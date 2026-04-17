import assert from 'node:assert/strict';
import { policy } from '../src/release-layer/index.js';
import {
  POLICY_ACTIVATION_RECORD_SPEC_VERSION,
  POLICY_BUNDLE_MANIFEST_SPEC_VERSION,
  POLICY_BUNDLE_SIGNATURE_SPEC_VERSION,
  POLICY_CONTROL_METADATA_SPEC_VERSION,
  POLICY_PACK_SPEC_VERSION,
  createPolicyActivationRecord,
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyBundleSignatureRecord,
  createPolicyControlPlaneMetadata,
  createPolicyPackMetadata,
  defaultPolicyCompatibilityDescriptor,
  policyBundleCompatibilityKey,
} from '../src/release-policy-control-plane/object-model.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';

function sampleBundleReference() {
  return {
    packId: 'finance-core',
    bundleId: 'bundle_finance_core_2026_04_17',
    bundleVersion: '2026.04.17',
    digest: 'sha256:7d1d97a1a312',
  } as const;
}

function samplePolicyDefinition() {
  return policy.createFirstHardGatewayReleasePolicy();
}

function testPolicyPackMetadata(): void {
  const pack = createPolicyPackMetadata({
    id: ' finance-core ',
    name: ' Finance Core ',
    description: '  Structured financial release policies  ',
    owners: ['ops', 'finance-governance', 'ops'],
    labels: ['finance', ' regulated ', 'finance'],
    createdAt: '2026-04-17T10:00:00.000Z',
  });

  assert.equal(pack.version, POLICY_PACK_SPEC_VERSION);
  assert.equal(pack.id, 'finance-core');
  assert.equal(pack.name, 'Finance Core');
  assert.equal(pack.description, 'Structured financial release policies');
  assert.deepEqual(pack.owners, ['finance-governance', 'ops']);
  assert.deepEqual(pack.labels, ['finance', 'regulated']);
  assert.equal(pack.lifecycleState, 'draft');
}

function testPolicyBundleManifestAndEntry(): void {
  const pack = createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    lifecycleState: 'published',
    createdAt: '2026-04-17T10:00:00.000Z',
    latestBundleRef: sampleBundleReference(),
  });
  const entry = createPolicyBundleEntry({
    id: 'entry-record-r4',
    scopeTarget: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      wedgeId: 'finance.record.release',
      consequenceType: 'record',
      riskClass: 'R4',
    }),
    definition: samplePolicyDefinition(),
    policyHash: 'sha256:0f0f0f',
  });
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(),
    pack,
    generatedAt: '2026-04-17T10:05:00.000Z',
    bundleLabels: ['finance', 'r4'],
    entries: [entry],
  });

  assert.equal(manifest.version, POLICY_BUNDLE_MANIFEST_SPEC_VERSION);
  assert.equal(manifest.discoveryMode, 'bundle-manifest');
  assert.equal(manifest.entries[0]?.definition.id, 'finance.structured-record-release.v1');
  assert.deepEqual(manifest.entries[0]?.scope.dimensions, [
    'environment',
    'tenant',
    'domain',
    'wedge',
    'consequence-type',
    'risk-class',
  ]);
  assert.equal(manifest.compatibility.releasePolicySpecVersion, policy.RELEASE_POLICY_SPEC_VERSION);
}

function testPolicyBundleSignatureRecord(): void {
  const signature = createPolicyBundleSignatureRecord({
    bundle: sampleBundleReference(),
    envelopeType: 'dsse',
    algorithm: 'EdDSA',
    keyId: 'kid_release_policy',
    signerFingerprint: 'fp_release_policy',
    signedAt: '2026-04-17T10:06:00.000Z',
    payloadDigest: 'sha256:7d1d97a1a312',
    signature: 'base64:abcdef',
  });

  assert.equal(signature.version, POLICY_BUNDLE_SIGNATURE_SPEC_VERSION);
  assert.equal(signature.envelopeType, 'dsse');
  assert.equal(signature.algorithm, 'EdDSA');
  assert.equal(signature.bundle.bundleId, 'bundle_finance_core_2026_04_17');
}

function testPolicyActivationRecord(): void {
  const activation = createPolicyActivationRecord({
    id: 'activation_finance_prod_record',
    state: 'active',
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      wedgeId: 'finance.record.release',
      consequenceType: 'record',
      riskClass: 'R4',
    }),
    bundle: sampleBundleReference(),
    activatedBy: {
      id: 'user_anne',
      type: 'user',
      displayName: 'Anne Reviewer',
      role: 'policy-admin',
    },
    activatedAt: '2026-04-17T10:10:00.000Z',
    rolloutMode: 'canary',
    reasonCode: 'promote-bundle',
    rationale: 'Promote validated finance record policy bundle.',
    previousActivationId: 'activation_finance_old',
  });

  assert.equal(activation.version, POLICY_ACTIVATION_RECORD_SPEC_VERSION);
  assert.equal(activation.state, 'active');
  assert.equal(activation.operationType, 'activate-bundle');
  assert.equal(activation.rolloutMode, 'canary');
  assert.equal(activation.reasonCode, 'promote-bundle');
  assert.equal(
    activation.targetLabel,
    'env:prod-eu / tenant:tenant-finance / domain:finance / wedge:finance.record.release / consequence:record / risk:R4',
  );
  assert.equal(activation.selector.dimensions.includes('wedge'), true);
  assert.equal(activation.previousActivationId, 'activation_finance_old');
}

function testFrozenActivationRequiresReason(): void {
  assert.throws(
    () =>
      createPolicyActivationRecord({
        id: 'activation_frozen',
        state: 'frozen',
        operationType: 'freeze-scope',
        target: createPolicyActivationTarget({
          environment: 'prod-eu',
          consequenceType: 'record',
        }),
        bundle: sampleBundleReference(),
        activatedBy: { id: 'system', type: 'system' },
        activatedAt: '2026-04-17T10:12:00.000Z',
        rolloutMode: 'rolled-back',
        reasonCode: 'freeze',
        rationale: 'Emergency freeze.',
      }),
    /freeze reason/i,
  );
}

function testHistoricalActivationRequiresSupersessionLink(): void {
  assert.throws(
    () =>
      createPolicyActivationRecord({
        id: 'activation_superseded_missing_link',
        state: 'superseded',
        target: createPolicyActivationTarget({
          environment: 'prod-eu',
          consequenceType: 'record',
        }),
        bundle: sampleBundleReference(),
        activatedBy: { id: 'system', type: 'system' },
        activatedAt: '2026-04-17T10:13:00.000Z',
        rolloutMode: 'enforce',
        reasonCode: 'promote-bundle',
        rationale: 'Superseded without successor.',
      }),
    /superseding activation id/i,
  );
}

function testControlPlaneMetadataAndCompatibility(): void {
  const compatibility = defaultPolicyCompatibilityDescriptor();
  const metadata = createPolicyControlPlaneMetadata(
    'postgres',
    'scoped-active',
    sampleBundleReference(),
    'activation_finance_prod_record',
  );

  assert.equal(metadata.version, POLICY_CONTROL_METADATA_SPEC_VERSION);
  assert.equal(metadata.discoveryMode, 'scoped-active');
  assert.equal(
    policyBundleCompatibilityKey(compatibility),
    [
      compatibility.controlPlaneSpecVersion,
      compatibility.releaseLayerPlatformSpecVersion,
      compatibility.releasePolicySpecVersion,
      compatibility.releasePolicyRolloutSpecVersion,
    ].join(' | '),
  );
}

testPolicyPackMetadata();
testPolicyBundleManifestAndEntry();
testPolicyBundleSignatureRecord();
testPolicyActivationRecord();
testFrozenActivationRequiresReason();
testHistoricalActivationRequiresSupersessionLink();
testControlPlaneMetadataAndCompatibility();

console.log('Release policy control-plane object-model tests: 31 passed, 0 failed');
