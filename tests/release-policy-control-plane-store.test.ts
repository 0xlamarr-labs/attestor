import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  createPolicyActivationRecord,
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyControlPlaneMetadata,
  createPolicyPackMetadata,
} from '../src/release-policy-control-plane/object-model.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyBundleSigner } from '../src/release-policy-control-plane/bundle-signing.js';
import {
  createFileBackedPolicyControlPlaneStore,
  createInMemoryPolicyControlPlaneStore,
  resetFileBackedPolicyControlPlaneStoreForTests,
} from '../src/release-policy-control-plane/store.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';
import { policy } from '../src/release-layer/index.js';

function sampleBundleReference(bundleId = 'bundle_finance_core_2026_04_17') {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: bundleId.replace('bundle_', '').replaceAll('_', '.'),
    digest: `sha256:${bundleId}`,
  } as const;
}

function samplePackMetadata() {
  return createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    lifecycleState: 'published',
    createdAt: '2026-04-17T14:00:00.000Z',
    latestBundleRef: sampleBundleReference(),
  });
}

function createEntry(
  id: string,
  targetInput: Parameters<typeof createPolicyActivationTarget>[0],
  definition = policy.createFirstHardGatewayReleasePolicy(),
) {
  const target = createPolicyActivationTarget(targetInput);
  const provisional = createPolicyBundleEntry({
    id,
    scopeTarget: target,
    definition,
    policyHash: 'sha256:placeholder',
  });

  return createPolicyBundleEntry({
    id,
    scopeTarget: target,
    definition,
    policyHash: computePolicyBundleEntryDigest(provisional),
  });
}

function createSignedBundle(bundleId = 'bundle_finance_core_2026_04_17') {
  const pack = createPolicyPackMetadata({
    ...samplePackMetadata(),
    latestBundleRef: sampleBundleReference(bundleId),
  });
  const entry = createEntry('entry-record-r4', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
  });
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(bundleId),
    pack,
    generatedAt: '2026-04-17T14:05:00.000Z',
    entries: [entry],
  });
  const artifact = createSignablePolicyBundleArtifact(pack, manifest);
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const signedBundle = signer.sign({
    artifact,
    signedAt: '2026-04-17T14:10:00.000Z',
  });

  return {
    pack,
    manifest,
    artifact,
    signedBundle,
    verificationKey: signer.exportVerificationKey(),
  };
}

function sampleActivationRecord(bundleId = 'bundle_finance_core_2026_04_17') {
  return createPolicyActivationRecord({
    id: `activation_${bundleId}`,
    state: 'active',
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      wedgeId: 'finance.record.release',
      consequenceType: 'record',
      riskClass: 'R4',
    }),
    bundle: sampleBundleReference(bundleId),
    activatedBy: {
      id: 'user_policy_admin',
      type: 'user',
      displayName: 'Policy Admin',
      role: 'policy-admin',
    },
    activatedAt: '2026-04-17T14:15:00.000Z',
    rationale: 'Promote finance record policy bundle.',
  });
}

function testInMemoryStoreCrud(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const bundle = createSignedBundle();
  const activation = sampleActivationRecord();

  store.upsertPack(bundle.pack);
  store.upsertBundle({
    manifest: bundle.manifest,
    artifact: bundle.artifact,
    signedBundle: bundle.signedBundle,
  });
  store.upsertActivation(activation);
  store.setMetadata(
    createPolicyControlPlaneMetadata(
      'embedded-memory',
      'scoped-active',
      bundle.manifest.bundle,
      activation.id,
    ),
  );

  assert.equal(store.getPack(bundle.pack.id)?.id, 'finance-core');
  assert.equal(store.getBundle(bundle.pack.id, bundle.artifact.bundleId)?.signedBundle?.keyId, bundle.signedBundle.keyId);
  assert.equal(store.getActivation(activation.id)?.state, 'active');
  assert.equal(store.getMetadata()?.latestActivationId, activation.id);
}

function testBundleHistoryOrdering(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const older = createSignedBundle('bundle_finance_core_2026_04_16');
  const newer = createSignedBundle('bundle_finance_core_2026_04_17');

  store.upsertPack(older.pack);
  store.upsertBundle({
    manifest: older.manifest,
    artifact: older.artifact,
    signedBundle: older.signedBundle,
    storedAt: '2026-04-16T14:00:00.000Z',
  });
  store.upsertBundle({
    manifest: newer.manifest,
    artifact: newer.artifact,
    signedBundle: newer.signedBundle,
    storedAt: '2026-04-17T14:00:00.000Z',
  });

  const history = store.listBundleHistory('finance-core');
  assert.equal(history.length, 2);
  assert.equal(history[0]?.bundleId, newer.artifact.bundleId);
  assert.equal(history[1]?.bundleId, older.artifact.bundleId);
}

function testSnapshotsAreFrozenAndIndependent(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const bundle = createSignedBundle();
  store.upsertPack(bundle.pack);
  const snapshot = store.exportSnapshot();

  assert.throws(
    () => {
      (snapshot.packs as PolicyPackMutation[]).push(bundle.pack);
    },
    /object is not extensible|read only|frozen/i,
  );
  assert.equal(store.listPacks().length, 1);
}

type PolicyPackMutation = { push(item: unknown): number };

function testFileBackedRoundTrip(): void {
  const path = resolve('.attestor/test-release-policy-store.json');
  resetFileBackedPolicyControlPlaneStoreForTests(path);

  try {
    const bundle = createSignedBundle();
    const activation = sampleActivationRecord();
    const writer = createFileBackedPolicyControlPlaneStore(path);
    writer.upsertPack(bundle.pack);
    writer.upsertBundle({
      manifest: bundle.manifest,
      artifact: bundle.artifact,
      signedBundle: bundle.signedBundle,
    });
    writer.upsertActivation(activation);

    const reader = createFileBackedPolicyControlPlaneStore(path);
    assert.equal(reader.listPacks().length, 1);
    assert.equal(reader.listBundles().length, 1);
    assert.equal(reader.listActivations().length, 1);
    assert.equal(reader.getBundle('finance-core', bundle.artifact.bundleId)?.verificationKey?.keyId, bundle.signedBundle.keyId);
  } finally {
    resetFileBackedPolicyControlPlaneStoreForTests(path);
  }
}

function testBundleUpsertReplacesExistingRecord(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const unsigned = createSignedBundle();
  const signed = createSignedBundle();

  store.upsertPack(unsigned.pack);
  store.upsertBundle({
    manifest: unsigned.manifest,
    artifact: unsigned.artifact,
    storedAt: '2026-04-17T14:00:00.000Z',
  });
  store.upsertBundle({
    manifest: signed.manifest,
    artifact: signed.artifact,
    signedBundle: signed.signedBundle,
    storedAt: '2026-04-17T14:10:00.000Z',
  });

  const record = store.getBundle('finance-core', signed.artifact.bundleId);
  assert.equal(store.listBundles().length, 1);
  assert.equal(record?.signedBundle?.keyId, signed.signedBundle.keyId);
  assert.equal(record?.storedAt, '2026-04-17T14:10:00.000Z');
}

function testMetadataAndActivationOrdering(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const activationOld = createPolicyActivationRecord({
    ...sampleActivationRecord('bundle_old'),
    id: 'activation_old',
    activatedAt: '2026-04-16T14:15:00.000Z',
  });
  const activationNew = createPolicyActivationRecord({
    ...sampleActivationRecord('bundle_new'),
    id: 'activation_new',
    activatedAt: '2026-04-17T14:15:00.000Z',
  });

  store.upsertActivation(activationOld);
  store.upsertActivation(activationNew);
  store.setMetadata(
    createPolicyControlPlaneMetadata(
      'embedded-memory',
      'scoped-active',
      sampleBundleReference('bundle_new'),
      'activation_new',
    ),
  );

  assert.equal(store.listActivations()[0]?.id, 'activation_new');
  assert.equal(store.getMetadata()?.activeBundleRef?.bundleId, 'bundle_new');
}

testInMemoryStoreCrud();
testBundleHistoryOrdering();
testSnapshotsAreFrozenAndIndependent();
testFileBackedRoundTrip();
testBundleUpsertReplacesExistingRecord();
testMetadataAndActivationOrdering();

console.log('Release policy control-plane store tests: 27 passed, 0 failed');
