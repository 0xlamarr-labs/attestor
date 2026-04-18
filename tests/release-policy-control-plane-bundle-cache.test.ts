import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyPackMetadata,
} from '../src/release-policy-control-plane/object-model.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyBundleSigner } from '../src/release-policy-control-plane/bundle-signing.js';
import {
  createFileBackedPolicyControlPlaneStore,
  resetFileBackedPolicyControlPlaneStoreForTests,
  type StoredPolicyBundleRecord,
} from '../src/release-policy-control-plane/store.js';
import {
  createPolicyBundleCacheDescriptor,
  createPolicyBundleConditionalResponse,
  policyBundleCacheHeaders,
  policyBundleEtagMatches,
} from '../src/release-policy-control-plane/bundle-cache.js';
import {
  createPolicyDiscoveryDocument,
} from '../src/release-policy-control-plane/discovery.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';
import { policy } from '../src/release-layer/index.js';

function sampleBundleReference(bundleId = 'bundle_finance_cache_2026_04_18') {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: bundleId.replace('bundle_', '').replaceAll('_', '.'),
    digest: `sha256:${bundleId}`,
  } as const;
}

function samplePackMetadata(bundleId = 'bundle_finance_cache_2026_04_18') {
  return createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    lifecycleState: 'published',
    createdAt: '2026-04-18T10:00:00.000Z',
    latestBundleRef: sampleBundleReference(bundleId),
  });
}

function sampleTarget() {
  return createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
  });
}

function createEntry() {
  const target = sampleTarget();
  const definition = policy.createFirstHardGatewayReleasePolicy();
  const provisional = createPolicyBundleEntry({
    id: 'entry-record-cache',
    scopeTarget: target,
    definition,
    policyHash: 'sha256:placeholder',
  });

  return createPolicyBundleEntry({
    id: 'entry-record-cache',
    scopeTarget: target,
    definition,
    policyHash: computePolicyBundleEntryDigest(provisional),
  });
}

function createSignedBundleRecord(
  bundleId = 'bundle_finance_cache_2026_04_18',
): {
  readonly pack: ReturnType<typeof samplePackMetadata>;
  readonly record: StoredPolicyBundleRecord;
} {
  const pack = samplePackMetadata(bundleId);
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(bundleId),
    pack,
    generatedAt: '2026-04-18T10:01:00.000Z',
    entries: [createEntry()],
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
    signedAt: '2026-04-18T10:02:00.000Z',
  });

  return {
    pack,
    record: {
      version: 'attestor.policy-store-record.v1',
      packId: manifest.packId,
      bundleId: manifest.bundle.bundleId,
      bundleVersion: manifest.bundle.bundleVersion,
      storedAt: '2026-04-18T10:03:00.000Z',
      manifest,
      artifact,
      signedBundle,
      verificationKey: signer.exportVerificationKey(),
    },
  };
}

function testSignedBundleEtagUsesSignedPayloadDigest(): void {
  const { record } = createSignedBundleRecord();
  const descriptor = createPolicyBundleCacheDescriptor(record);

  assert.equal(descriptor.etag, `"${record.signedBundle?.signatureRecord.payloadDigest}"`);
  assert.equal(descriptor.digest, record.manifest.bundle.digest);
  assert.equal(descriptor.resource, 'policy-bundles/finance-core/bundle_finance_cache_2026_04_18');
  assert.equal(descriptor.policy.validator, 'strong-etag');
}

function testConditionalRequestReturnsNotModifiedForMatchingEtag(): void {
  const { record } = createSignedBundleRecord();
  const descriptor = createPolicyBundleCacheDescriptor(record);
  const notModified = createPolicyBundleConditionalResponse(record, descriptor.etag);
  const modified = createPolicyBundleConditionalResponse(record, '"sha256:other"');

  assert.equal(notModified.status, 'not-modified');
  assert.equal(modified.status, 'modified');
  assert.equal(policyBundleEtagMatches(descriptor.etag, descriptor), true);
  assert.equal(policyBundleEtagMatches(`W/${descriptor.etag}`, descriptor), false);
}

function testFreshnessWindowsAreDeterministic(): void {
  const { record } = createSignedBundleRecord();
  const fresh = createPolicyBundleCacheDescriptor(record, {
    validatedAt: '2026-04-18T10:00:00.000Z',
    now: '2026-04-18T10:00:59.000Z',
    maxAgeSeconds: 60,
    staleIfErrorSeconds: 300,
  });
  const stale = createPolicyBundleCacheDescriptor(record, {
    validatedAt: '2026-04-18T10:00:00.000Z',
    now: '2026-04-18T10:01:01.000Z',
    maxAgeSeconds: 60,
    staleIfErrorSeconds: 300,
  });
  const expired = createPolicyBundleCacheDescriptor(record, {
    validatedAt: '2026-04-18T10:00:00.000Z',
    now: '2026-04-18T10:06:01.000Z',
    maxAgeSeconds: 60,
    staleIfErrorSeconds: 300,
  });

  assert.equal(fresh.freshness, 'fresh');
  assert.equal(stale.freshness, 'stale-if-error');
  assert.equal(expired.freshness, 'expired');
  assert.equal(expired.policy.failureMode, 'fail-closed-after-stale-if-error');
}

function testCacheHeadersExposeConsumerContract(): void {
  const { record } = createSignedBundleRecord();
  const descriptor = createPolicyBundleCacheDescriptor(record, {
    validatedAt: '2026-04-18T10:00:00.000Z',
    now: '2026-04-18T10:01:01.000Z',
  });
  const headers = policyBundleCacheHeaders(descriptor);

  assert.equal(headers.etag, descriptor.etag);
  assert.equal(headers['cache-control'], 'private, max-age=60, stale-if-error=300');
  assert.equal(headers['x-attestor-policy-bundle-freshness'], 'stale-if-error');
  assert.equal(headers['x-attestor-policy-bundle-failure-mode'], 'fail-closed-after-stale-if-error');
  assert.equal(headers['x-attestor-policy-bundle-persisted'], 'true');
}

function testFileBackedStorePreservesCacheDescriptorAcrossRestart(): void {
  const path = join(
    tmpdir(),
    `attestor-policy-cache-${randomUUID().replace(/-/g, '')}.json`,
  );
  const { pack, record } = createSignedBundleRecord();
  resetFileBackedPolicyControlPlaneStoreForTests(path);

  const firstStore = createFileBackedPolicyControlPlaneStore(path);
  firstStore.upsertPack(pack);
  firstStore.upsertBundle({
    manifest: record.manifest,
    artifact: record.artifact,
    signedBundle: record.signedBundle,
    verificationKey: record.verificationKey,
    storedAt: record.storedAt,
  });
  const firstDescriptor = createPolicyBundleCacheDescriptor(
    firstStore.getBundle(record.packId, record.bundleId)!,
  );

  const restartedStore = createFileBackedPolicyControlPlaneStore(path);
  const restartedRecord = restartedStore.getBundle(record.packId, record.bundleId);
  assert.ok(restartedRecord);
  const restartedDescriptor = createPolicyBundleCacheDescriptor(restartedRecord);

  assert.equal(restartedDescriptor.etag, firstDescriptor.etag);
  assert.equal(restartedDescriptor.digest, firstDescriptor.digest);
  assert.equal(restartedDescriptor.persisted, true);

  resetFileBackedPolicyControlPlaneStoreForTests(path);
}

function testDiscoveryResourceCarriesCacheDescriptor(): void {
  const path = join(
    tmpdir(),
    `attestor-policy-cache-discovery-${randomUUID().replace(/-/g, '')}.json`,
  );
  const { pack, record } = createSignedBundleRecord();
  resetFileBackedPolicyControlPlaneStoreForTests(path);
  const store = createFileBackedPolicyControlPlaneStore(path);
  store.upsertPack(pack);
  store.upsertBundle({
    manifest: record.manifest,
    artifact: record.artifact,
    signedBundle: record.signedBundle,
    verificationKey: record.verificationKey,
    storedAt: record.storedAt,
  });
  store.setMetadata({
    version: 'attestor.policy-control-plane-metadata.v1',
    storeKind: 'file-backed',
    discoveryMode: 'static',
    activeBundleRef: record.manifest.bundle,
    latestActivationId: null,
    compatibility: record.manifest.compatibility,
  });

  const document = createPolicyDiscoveryDocument(store, {
    generatedAt: '2026-04-18T10:05:00.000Z',
    target: sampleTarget(),
  });

  assert.equal(document.bundleResolution.status, 'resolved');
  assert.equal(document.bundleResolution.selectedCandidate?.resource?.cache.etag, `"${record.signedBundle?.signatureRecord.payloadDigest}"`);
  assert.equal(document.bundleResolution.selectedCandidate?.resource?.cache.policy.persistAcrossRestart, true);

  resetFileBackedPolicyControlPlaneStoreForTests(path);
}

testSignedBundleEtagUsesSignedPayloadDigest();
testConditionalRequestReturnsNotModifiedForMatchingEtag();
testFreshnessWindowsAreDeterministic();
testCacheHeadersExposeConsumerContract();
testFileBackedStorePreservesCacheDescriptorAcrossRestart();
testDiscoveryResourceCarriesCacheDescriptor();

console.log('Release policy control-plane bundle-cache tests: 6 passed, 0 failed');
