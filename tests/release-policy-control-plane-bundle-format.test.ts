import assert from 'node:assert/strict';
import { policy } from '../src/release-layer/index.js';
import {
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyPackMetadata,
} from '../src/release-policy-control-plane/object-model.js';
import {
  POLICY_BUNDLE_FORMAT_SPEC_VERSION,
  POLICY_BUNDLE_PAYLOAD_TYPE,
  POLICY_BUNDLE_PREDICATE_TYPE,
  POLICY_BUNDLE_STATEMENT_TYPE,
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';

function sampleBundleReference(bundleId = 'bundle_finance_core_2026_04_17') {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: '2026.04.17',
    digest: `sha256:${bundleId}`,
  } as const;
}

function samplePackMetadata() {
  return createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    description: 'Primary finance proving policy pack',
    lifecycleState: 'published',
    owners: ['ops', 'finance-governance'],
    labels: ['finance', 'r4'],
    createdAt: '2026-04-17T12:00:00.000Z',
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

function testEntryDigestDeterminism(): void {
  const entry = createEntry('entry-record-r4', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
  });

  assert.equal(
    computePolicyBundleEntryDigest(entry),
    computePolicyBundleEntryDigest(entry),
  );
}

function testCreateSignableBundleArtifact(): void {
  const pack = samplePackMetadata();
  const entry = createEntry('entry-record-r4', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
  });
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(),
    pack,
    generatedAt: '2026-04-17T12:05:00.000Z',
    bundleLabels: ['r4', 'finance'],
    schemas: [
      {
        id: 'policy-schema',
        version: '1.0.0',
        uri: 'https://schemas.attestor.ai/policy/v1',
        digest: 'sha256:schema1',
      },
    ],
    entries: [entry],
  });

  const artifact = createSignablePolicyBundleArtifact(pack, manifest);

  assert.equal(artifact.version, POLICY_BUNDLE_FORMAT_SPEC_VERSION);
  assert.equal(artifact.payloadType, POLICY_BUNDLE_PAYLOAD_TYPE);
  assert.equal(artifact.statement._type, POLICY_BUNDLE_STATEMENT_TYPE);
  assert.equal(artifact.statement.predicateType, POLICY_BUNDLE_PREDICATE_TYPE);
  assert.equal(artifact.statement.subject.length, 4);
  assert.equal(artifact.statement.predicate.pack.id, 'finance-core');
  assert.equal(artifact.statement.predicate.entries[0]?.id, 'entry-record-r4');
  assert.equal(artifact.payloadDigest.startsWith('sha256:'), true);
}

function testBundleArtifactIsOrderIndependent(): void {
  const pack = samplePackMetadata();
  const entryA = createEntry('entry-domain', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
  });
  const entryB = createEntry(
    'entry-record-r4',
    {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      wedgeId: 'finance.record.release',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    policy.createFirstHardGatewayReleasePolicy(),
  );

  const manifestA = createPolicyBundleManifest({
    bundle: sampleBundleReference('bundle_order_a'),
    pack,
    generatedAt: '2026-04-17T12:10:00.000Z',
    bundleLabels: ['finance', 'r4'],
    schemas: [
      {
        id: 'schema-b',
        version: '1.0.0',
        uri: 'https://schemas.attestor.ai/b',
        digest: 'sha256:schema-b',
      },
      {
        id: 'schema-a',
        version: '1.0.0',
        uri: 'https://schemas.attestor.ai/a',
        digest: 'sha256:schema-a',
      },
    ],
    entries: [entryB, entryA],
  });
  const manifestB = createPolicyBundleManifest({
    bundle: sampleBundleReference('bundle_order_a'),
    pack,
    generatedAt: '2026-04-17T12:10:00.000Z',
    bundleLabels: ['r4', 'finance'],
    schemas: [...manifestA.schemas].reverse(),
    entries: [...manifestA.entries].reverse(),
  });

  const artifactA = createSignablePolicyBundleArtifact(pack, manifestA);
  const artifactB = createSignablePolicyBundleArtifact(pack, manifestB);

  assert.equal(artifactA.payloadDigest, artifactB.payloadDigest);
  assert.equal(artifactA.entriesDigest, artifactB.entriesDigest);
  assert.equal(artifactA.schemasDigest, artifactB.schemasDigest);
}

function testBundleRejectsInvalidPolicyHash(): void {
  const pack = samplePackMetadata();
  const invalidEntry = createPolicyBundleEntry({
    id: 'entry-invalid-hash',
    scopeTarget: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
      riskClass: 'R4',
    }),
    definition: policy.createFirstHardGatewayReleasePolicy(),
    policyHash: 'sha256:not-the-real-hash',
  });
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference('bundle_invalid_hash'),
    pack,
    generatedAt: '2026-04-17T12:15:00.000Z',
    entries: [invalidEntry],
  });

  assert.throws(
    () => createSignablePolicyBundleArtifact(pack, manifest),
    /policyHash/i,
  );
}

function testBundleRejectsWrongPackBinding(): void {
  const pack = samplePackMetadata();
  const otherPack = createPolicyPackMetadata({
    id: 'other-pack',
    name: 'Other Pack',
    createdAt: '2026-04-17T12:20:00.000Z',
  });
  const entry = createEntry('entry-record-r4', {
    environment: 'prod-eu',
    consequenceType: 'record',
    riskClass: 'R4',
  });
  const manifest = createPolicyBundleManifest({
    bundle: {
      packId: 'other-pack',
      bundleId: 'bundle_wrong_pack',
      bundleVersion: '2026.04.17',
      digest: 'sha256:bundle_wrong_pack',
    },
    pack: otherPack,
    generatedAt: '2026-04-17T12:20:00.000Z',
    entries: [entry],
  });

  assert.throws(
    () => createSignablePolicyBundleArtifact(pack, manifest),
    /pack ids/i,
  );
}

testEntryDigestDeterminism();
testCreateSignableBundleArtifact();
testBundleArtifactIsOrderIndependent();
testBundleRejectsInvalidPolicyHash();
testBundleRejectsWrongPackBinding();

console.log('Release policy control-plane bundle-format tests: 23 passed, 0 failed');
