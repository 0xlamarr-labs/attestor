import assert from 'node:assert/strict';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  createPolicyActivationRecord,
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyControlPlaneMetadata,
  createPolicyPackMetadata,
  type PolicyCompatibilityDescriptor,
} from '../src/release-policy-control-plane/object-model.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyBundleSigner } from '../src/release-policy-control-plane/bundle-signing.js';
import { createInMemoryPolicyControlPlaneStore } from '../src/release-policy-control-plane/store.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';
import { createActivePolicyResolver } from '../src/release-policy-control-plane/resolver.js';
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
    createdAt: '2026-04-18T08:00:00.000Z',
    latestBundleRef: sampleBundleReference(bundleId),
  });
}

function createEntry(
  id: string,
  targetInput: Parameters<typeof createPolicyActivationTarget>[0],
  definition: ReturnType<typeof policy.createFirstHardGatewayReleasePolicy>,
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

function createSignedBundle(
  bundleId: string,
  entries: readonly ReturnType<typeof createPolicyBundleEntry>[],
  compatibilityOverride?: PolicyCompatibilityDescriptor,
) {
  const pack = samplePackMetadata(bundleId);
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(bundleId),
    pack,
    generatedAt: '2026-04-18T08:05:00.000Z',
    entries,
  });
  const compatibleManifest =
    compatibilityOverride === undefined
      ? manifest
      : Object.freeze({
          ...manifest,
          compatibility: compatibilityOverride,
        });
  const artifact = createSignablePolicyBundleArtifact(pack, compatibleManifest);
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const signedBundle = signer.sign({
    artifact,
    signedAt: '2026-04-18T08:10:00.000Z',
  });

  return {
    pack,
    manifest: compatibleManifest,
    artifact,
    signedBundle,
  };
}

function createActivation(
  id: string,
  bundleId: string,
  targetInput: Parameters<typeof createPolicyActivationTarget>[0],
) {
  return createPolicyActivationRecord({
    id,
    state: 'active',
    target: createPolicyActivationTarget(targetInput),
    bundle: sampleBundleReference(bundleId),
    activatedBy: {
      id: 'user_policy_admin',
      type: 'user',
      displayName: 'Policy Admin',
      role: 'policy-admin',
    },
    activatedAt: '2026-04-18T08:15:00.000Z',
    rationale: `Activate ${bundleId}`,
  });
}

function sampleResolverInput() {
  return {
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      accountId: 'account-major',
      domainId: 'finance',
      wedgeId: 'finance.record.release',
      consequenceType: 'record',
      riskClass: 'R4',
      planId: 'enterprise',
    }),
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    } as const,
    capabilityBoundary: {
      allowedTools: ['record-commit'],
      allowedTargets: ['finance.reporting.record-store'],
      allowedDataDomains: ['financial-reporting'],
    } as const,
    targetKind: 'record-store' as const,
    rolloutContext: {
      requestId: 'req_123',
      outputHash: 'sha256:output',
      requesterId: 'user_policy_admin',
      targetId: 'finance.reporting.record-store',
    } as const,
  };
}

function testResolvedPolicyUsesMostSpecificEntry(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const broadPolicy = policy.createFirstHardGatewayReleasePolicy();
  const specificPolicy = policy.createFirstHardGatewayReleasePolicy();
  const bundle = createSignedBundle('bundle_finance_active_policy', [
    createEntry(
      'entry-broad',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        consequenceType: 'record',
      },
      broadPolicy,
    ),
    createEntry(
      'entry-specific',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        accountId: 'account-major',
        domainId: 'finance',
        wedgeId: 'finance.record.release',
        consequenceType: 'record',
        riskClass: 'R4',
      },
      specificPolicy,
    ),
  ]);

  store.upsertPack(bundle.pack);
  store.upsertBundle({
    manifest: bundle.manifest,
    artifact: bundle.artifact,
    signedBundle: bundle.signedBundle,
  });
  const activation = createActivation('activation-record-r4', bundle.artifact.bundleId, {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
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

  const result = createActivePolicyResolver(store).resolve(sampleResolverInput());

  assert.equal(result.status, 'resolved');
  assert.equal(result.selectedEntry?.id, 'entry-specific');
  assert.equal(result.matchedEntryCandidates.length, 2);
  assert.equal(result.rollout?.rolloutMode, 'enforce');
  assert.equal(result.bundleResolution.status, 'resolved');
}

function testNoPolicyEntryFailsClosedWhenBundleExists(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const bundle = createSignedBundle('bundle_finance_action_only', [
    createEntry(
      'entry-action',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        wedgeId: 'finance-workflow-action-release',
        consequenceType: 'action',
        riskClass: 'R3',
      },
      policy.createFinanceActionReleasePolicy(),
    ),
  ]);

  store.upsertPack(bundle.pack);
  store.upsertBundle({
    manifest: bundle.manifest,
    artifact: bundle.artifact,
    signedBundle: bundle.signedBundle,
  });
  const activation = createActivation('activation-action-only', bundle.artifact.bundleId, {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
  });
  store.upsertActivation(activation);

  const result = createActivePolicyResolver(store).resolve(sampleResolverInput());

  assert.equal(result.status, 'no-policy-entry');
  assert.equal(result.bundleResolution.status, 'resolved');
  assert.equal(result.bundleRecord?.bundleId, 'bundle_finance_action_only');
  assert.equal(result.selectedEntry, null);
}

function testAmbiguousEntryResolutionFailsClosed(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const basePolicy = policy.createFirstHardGatewayReleasePolicy();
  const bundle = createSignedBundle('bundle_finance_ambiguous', [
    createEntry(
      'entry-a',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        wedgeId: 'finance.record.release',
        consequenceType: 'record',
        riskClass: 'R4',
      },
      basePolicy,
    ),
    createEntry(
      'entry-b',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        wedgeId: 'finance.record.release',
        consequenceType: 'record',
        riskClass: 'R4',
      },
      basePolicy,
    ),
  ]);

  store.upsertPack(bundle.pack);
  store.upsertBundle({
    manifest: bundle.manifest,
    artifact: bundle.artifact,
    signedBundle: bundle.signedBundle,
  });
  store.upsertActivation(
    createActivation('activation-ambiguous', bundle.artifact.bundleId, {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
  );

  const result = createActivePolicyResolver(store).resolve(sampleResolverInput());

  assert.equal(result.status, 'ambiguous-policy-entry');
  assert.equal(result.ambiguousEntryCandidates.length, 2);
  assert.equal(result.selectedEntry, null);
}

function testIncompatibleBundleFailsClosed(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const bundle = createSignedBundle(
    'bundle_finance_incompatible',
    [
      createEntry(
        'entry-record',
        {
          environment: 'prod-eu',
          tenantId: 'tenant-finance',
          domainId: 'finance',
          wedgeId: 'finance.record.release',
          consequenceType: 'record',
          riskClass: 'R4',
        },
        policy.createFirstHardGatewayReleasePolicy(),
      ),
    ],
    {
      controlPlaneSpecVersion: 'attestor.release-policy-control-plane.v999' as never,
      releaseLayerPlatformSpecVersion:
        'attestor.release-layer-platform.v1',
      releasePolicySpecVersion: policy.RELEASE_POLICY_SPEC_VERSION,
      releasePolicyRolloutSpecVersion:
        policy.createFirstHardGatewayReleasePolicy().rollout.version,
    },
  );

  store.upsertPack(bundle.pack);
  store.upsertBundle({
    manifest: bundle.manifest,
    artifact: bundle.artifact,
    signedBundle: bundle.signedBundle,
  });
  store.upsertActivation(
    createActivation('activation-incompatible', bundle.artifact.bundleId, {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
  );

  const result = createActivePolicyResolver(store).resolve(sampleResolverInput());

  assert.equal(result.status, 'incompatible-bundle');
  assert.equal(result.compatibility.compatible, false);
}

function testBundleResolutionFailurePassesThrough(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const result = createActivePolicyResolver(store).resolve(sampleResolverInput());

  assert.equal(result.status, 'bundle-resolution-failed');
  assert.equal(result.bundleResolution.status, 'no-match');
  assert.equal(result.effectivePolicy, null);
}

function run(): void {
  testResolvedPolicyUsesMostSpecificEntry();
  testNoPolicyEntryFailsClosedWhenBundleExists();
  testAmbiguousEntryResolutionFailsClosed();
  testIncompatibleBundleFailsClosed();
  testBundleResolutionFailurePassesThrough();
  console.log('Release policy control-plane resolver tests: 5 passed, 0 failed');
}

run();
