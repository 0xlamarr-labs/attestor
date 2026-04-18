import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  createPolicyActivationRecord,
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
  createFileBackedPolicyMutationAuditLogWriter,
  createInMemoryPolicyMutationAuditLogWriter,
  createPolicyMutationAuditSubjectFromActivation,
  createPolicyMutationAuditSubjectFromBundle,
  createPolicyMutationAuditSubjectFromPack,
  resetFileBackedPolicyMutationAuditLogForTests,
  verifyPolicyMutationAuditLogChain,
} from '../src/release-policy-control-plane/audit-log.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';
import { policy } from '../src/release-layer/index.js';

function sampleBundleReference(bundleId: string) {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: bundleId.replace('bundle_', '').replaceAll('_', '.'),
    digest: `sha256:${bundleId}`,
  } as const;
}

function samplePackMetadata(bundleId: string) {
  return createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    lifecycleState: 'published',
    createdAt: '2026-04-18T09:00:00.000Z',
    latestBundleRef: sampleBundleReference(bundleId),
  });
}

function createEntry() {
  const definition = policy.createFirstHardGatewayReleasePolicy();
  const target = createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
  });
  const provisional = createPolicyBundleEntry({
    id: 'entry-current',
    scopeTarget: target,
    definition,
    policyHash: 'sha256:placeholder',
  });

  return createPolicyBundleEntry({
    id: 'entry-current',
    scopeTarget: target,
    definition,
    policyHash: computePolicyBundleEntryDigest(provisional),
  });
}

function createSignedBundle(bundleId: string) {
  const pack = samplePackMetadata(bundleId);
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(bundleId),
    pack,
    generatedAt: '2026-04-18T09:05:00.000Z',
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
    signedAt: '2026-04-18T09:10:00.000Z',
  });

  return {
    pack,
    bundleRecord: {
      version: 'attestor.policy-store-record.v1' as const,
      packId: manifest.packId,
      bundleId: artifact.bundleId,
      bundleVersion: manifest.bundle.bundleVersion,
      storedAt: '2026-04-18T09:11:00.000Z',
      manifest,
      artifact,
      signedBundle,
      verificationKey: signer.exportVerificationKey(),
    },
  };
}

function createActivation(bundleId: string) {
  return createPolicyActivationRecord({
    id: 'activation-current',
    state: 'active',
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
    bundle: sampleBundleReference(bundleId),
    activatedBy: {
      id: 'user_policy_admin',
      type: 'user',
      displayName: 'Policy Admin',
      role: 'policy-admin',
    },
    activatedAt: '2026-04-18T09:15:00.000Z',
    rationale: `Activate ${bundleId}`,
  });
}

function actor() {
  return {
    id: 'user_policy_admin',
    type: 'user',
    displayName: 'Policy Admin',
    role: 'policy-admin',
  } as const;
}

function testInMemoryAuditLogIsHashLinked(): void {
  const writer = createInMemoryPolicyMutationAuditLogWriter();
  const bundle = createSignedBundle('bundle_finance_current');
  const activation = createActivation(bundle.bundleRecord.bundleId);

  writer.append({
    occurredAt: '2026-04-18T09:20:00.000Z',
    action: 'create-pack',
    actor: actor(),
    subject: createPolicyMutationAuditSubjectFromPack(bundle.pack),
    mutationSnapshot: bundle.pack,
  });
  writer.append({
    occurredAt: '2026-04-18T09:21:00.000Z',
    action: 'publish-bundle',
    actor: actor(),
    subject: createPolicyMutationAuditSubjectFromBundle(bundle.bundleRecord),
    mutationSnapshot: bundle.bundleRecord.manifest,
  });
  writer.append({
    occurredAt: '2026-04-18T09:22:00.000Z',
    action: 'activate-bundle',
    actor: actor(),
    subject: createPolicyMutationAuditSubjectFromActivation(activation),
    reasonCode: 'promote-bundle',
    rationale: 'Promote candidate bundle to active.',
    mutationSnapshot: activation,
  });

  const snapshot = writer.exportSnapshot();
  assert.equal(snapshot.entries.length, 3);
  assert.equal(writer.verify().valid, true);
  assert.equal(snapshot.entries[2]?.previousEntryDigest, snapshot.entries[1]?.entryDigest ?? null);
}

function testAuditLogDetectsTampering(): void {
  const writer = createInMemoryPolicyMutationAuditLogWriter();
  const bundle = createSignedBundle('bundle_finance_current');

  writer.append({
    occurredAt: '2026-04-18T09:20:00.000Z',
    action: 'publish-bundle',
    actor: actor(),
    subject: createPolicyMutationAuditSubjectFromBundle(bundle.bundleRecord),
    mutationSnapshot: bundle.bundleRecord.manifest,
  });

  const tampered = structuredClone(writer.entries());
  (tampered[0]!.reasonCode as string | null) = 'tampered';

  const verification = verifyPolicyMutationAuditLogChain(tampered);
  assert.equal(verification.valid, false);
  assert.equal(verification.brokenEntryId, tampered[0]?.entryId ?? null);
}

function testFileBackedAuditLogPersists(): void {
  const path = resolve('.attestor/tests/policy-mutation-audit-log.json');
  resetFileBackedPolicyMutationAuditLogForTests(path);
  try {
    const writer = createFileBackedPolicyMutationAuditLogWriter(path);
    const bundle = createSignedBundle('bundle_finance_current');

    writer.append({
      occurredAt: '2026-04-18T09:20:00.000Z',
      action: 'publish-bundle',
      actor: actor(),
      subject: createPolicyMutationAuditSubjectFromBundle(bundle.bundleRecord),
      mutationSnapshot: bundle.bundleRecord.artifact,
    });

    const reopened = createFileBackedPolicyMutationAuditLogWriter(path);
    assert.equal(reopened.entries().length, 1);
    assert.equal(reopened.verify().valid, true);
  } finally {
    resetFileBackedPolicyMutationAuditLogForTests(path);
  }
}

function testSubjectHelpersCaptureStableIdentity(): void {
  const bundle = createSignedBundle('bundle_finance_current');
  const activation = createActivation(bundle.bundleRecord.bundleId);

  const packSubject = createPolicyMutationAuditSubjectFromPack(bundle.pack);
  const bundleSubject = createPolicyMutationAuditSubjectFromBundle(bundle.bundleRecord);
  const activationSubject = createPolicyMutationAuditSubjectFromActivation(activation);

  assert.equal(packSubject.packId, 'finance-core');
  assert.equal(bundleSubject.bundleId, 'bundle_finance_current');
  assert.equal(activationSubject.activationId, 'activation-current');
  assert.equal(activationSubject.targetLabel, activation.targetLabel);
}

function run(): void {
  testInMemoryAuditLogIsHashLinked();
  testAuditLogDetectsTampering();
  testFileBackedAuditLogPersists();
  testSubjectHelpersCaptureStableIdentity();
  console.log('Release policy control-plane audit-log tests: 4 passed, 0 failed');
}

run();
