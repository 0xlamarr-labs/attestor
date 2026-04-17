import assert from 'node:assert/strict';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  createPolicyActivationRecord,
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyControlPlaneMetadata,
  createPolicyPackMetadata,
} from '../src/release-policy-control-plane/object-model.js';
import {
  createPolicyDiscoveryDocument,
  createPolicyDiscoveryLabels,
  resolvePolicyBundleForTarget,
} from '../src/release-policy-control-plane/discovery.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyBundleSigner } from '../src/release-policy-control-plane/bundle-signing.js';
import { createInMemoryPolicyControlPlaneStore } from '../src/release-policy-control-plane/store.js';
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
    createdAt: '2026-04-17T14:00:00.000Z',
    latestBundleRef: sampleBundleReference(bundleId),
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

function createSignedBundle(
  bundleId: string,
  targetInput: Parameters<typeof createPolicyActivationTarget>[0],
  definition = policy.createFirstHardGatewayReleasePolicy(),
) {
  const pack = samplePackMetadata(bundleId);
  const entry = createEntry(`entry-${bundleId}`, targetInput, definition);
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
    activatedAt: '2026-04-17T14:15:00.000Z',
    rationale: `Promote ${bundleId}.`,
  });
}

function seedStoreWithBundle(
  bundleId: string,
  targetInput: Parameters<typeof createPolicyActivationTarget>[0],
) {
  const store = createInMemoryPolicyControlPlaneStore();
  const bundle = createSignedBundle(bundleId, targetInput);
  store.upsertPack(bundle.pack);
  store.upsertBundle({
    manifest: bundle.manifest,
    artifact: bundle.artifact,
    signedBundle: bundle.signedBundle,
  });
  return { store, bundle };
}

function testDiscoveryLabelsCarryReservedAndCustomValues(): void {
  const target = createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    accountId: 'account-123',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
    planId: 'enterprise',
  });

  const labels = createPolicyDiscoveryLabels({
    target,
    storeKind: 'file-backed',
    labels: {
      cohort: 'wave-a',
      'release.channel': 'stable',
    },
  });

  assert.equal(labels.values['attestor.environment'], 'prod-eu');
  assert.equal(labels.values['attestor.account'], 'account-123');
  assert.equal(labels.values['attestor.plan'], 'enterprise');
  assert.equal(labels.values['attestor.store_kind'], 'file-backed');
  assert.equal(labels.values['cohort'], 'wave-a');
  assert.equal(labels.values['release.channel'], 'stable');
}

function testReservedDiscoveryLabelsCannotBeOverridden(): void {
  const target = createPolicyActivationTarget({
    environment: 'prod-eu',
  });

  assert.throws(
    () =>
      createPolicyDiscoveryLabels({
        target,
        labels: {
          'attestor.environment': 'dev-us',
        },
      }),
    /reserved by the control plane/i,
  );
}

function testScopedActiveResolutionSelectsMostSpecificBundle(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const tenantWide = createSignedBundle('bundle_finance_tenant_wide', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
  });
  const accountSpecific = createSignedBundle('bundle_finance_account_specific', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    accountId: 'account-123',
    domainId: 'finance',
    consequenceType: 'record',
  });

  store.upsertPack(tenantWide.pack);
  store.upsertBundle({
    manifest: tenantWide.manifest,
    artifact: tenantWide.artifact,
    signedBundle: tenantWide.signedBundle,
  });
  store.upsertBundle({
    manifest: accountSpecific.manifest,
    artifact: accountSpecific.artifact,
    signedBundle: accountSpecific.signedBundle,
  });
  store.upsertActivation(
    createActivation('activation-tenant', tenantWide.artifact.bundleId, {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
  );
  const accountActivation = createActivation(
    'activation-account',
    accountSpecific.artifact.bundleId,
    {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      accountId: 'account-123',
      domainId: 'finance',
      consequenceType: 'record',
    },
  );
  store.upsertActivation(accountActivation);
  store.setMetadata(
    createPolicyControlPlaneMetadata(
      'embedded-memory',
      'scoped-active',
      accountSpecific.manifest.bundle,
      accountActivation.id,
    ),
  );

  const result = resolvePolicyBundleForTarget(store, {
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      accountId: 'account-123',
      domainId: 'finance',
      consequenceType: 'record',
    }),
    labels: {
      cohort: 'wave-a',
    },
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.selectedCandidate?.bundleRef.bundleId, 'bundle_finance_account_specific');
  assert.equal(result.selectedCandidate?.resource?.resource, 'policy-bundles/finance-core/bundle_finance_account_specific');
  assert.equal(result.selectedCandidate?.resource?.etag, accountSpecific.artifact.payloadDigest);
  assert.equal(result.matchedCandidates.length, 2);
  assert.equal(result.labels.values['cohort'], 'wave-a');
}

function testStaticResolutionUsesMetadataActiveBundle(): void {
  const { store, bundle } = seedStoreWithBundle('bundle_finance_static', {
    environment: 'prod-eu',
    domainId: 'finance',
    consequenceType: 'record',
  });
  store.setMetadata(
    createPolicyControlPlaneMetadata(
      'embedded-memory',
      'static',
      bundle.manifest.bundle,
      null,
    ),
  );

  const result = resolvePolicyBundleForTarget(store, {
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
    }),
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.discoveryMode, 'static');
  assert.equal(result.selectedCandidate?.source, 'static');
  assert.equal(result.selectedCandidate?.activationId, null);
  assert.equal(result.selectedCandidate?.bundleRef.bundleId, 'bundle_finance_static');
}

function testAmbiguousTopCandidatesStayExplicit(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const first = createSignedBundle('bundle_finance_conflict_a', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
  });
  const second = createSignedBundle('bundle_finance_conflict_b', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
  });

  store.upsertPack(first.pack);
  store.upsertBundle({
    manifest: first.manifest,
    artifact: first.artifact,
    signedBundle: first.signedBundle,
  });
  store.upsertBundle({
    manifest: second.manifest,
    artifact: second.artifact,
    signedBundle: second.signedBundle,
  });
  store.upsertActivation(
    createActivation('activation-conflict-a', first.artifact.bundleId, {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
  );
  store.upsertActivation(
    createActivation('activation-conflict-b', second.artifact.bundleId, {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
  );

  const result = resolvePolicyBundleForTarget(store, {
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.selectedCandidate, null);
  assert.equal(result.ambiguousCandidates.length, 2);
}

function testMissingBundleIsFailClosed(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const activation = createActivation(
    'activation-missing-bundle',
    'bundle_missing_bundle_record',
    {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    },
  );
  store.upsertActivation(activation);

  const result = resolvePolicyBundleForTarget(store, {
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
  });

  assert.equal(result.status, 'missing-bundle');
  assert.equal(result.selectedCandidate?.bundleRef.bundleId, 'bundle_missing_bundle_record');
  assert.equal(result.selectedCandidate?.bundleRecord, null);
  assert.equal(result.missingBundleCandidates.length, 1);
}

function testDiscoveryDocumentCarriesResolutionContext(): void {
  const { store, bundle } = seedStoreWithBundle('bundle_finance_discovery_doc', {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
  });
  const activation = createActivation(
    'activation-discovery-doc',
    bundle.artifact.bundleId,
    {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    },
  );
  store.upsertActivation(activation);
  const metadata = createPolicyControlPlaneMetadata(
    'embedded-memory',
    'bundle-manifest',
    bundle.manifest.bundle,
    activation.id,
  );
  store.setMetadata(metadata);

  const document = createPolicyDiscoveryDocument(store, {
    generatedAt: '2026-04-17T16:30:00.000Z',
    target: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      consequenceType: 'record',
    }),
    labels: {
      region: 'eu-central',
    },
  });

  assert.equal(document.generatedAt, '2026-04-17T16:30:00.000Z');
  assert.equal(document.metadata?.discoveryMode, 'bundle-manifest');
  assert.equal(document.bundleResolution.status, 'resolved');
  assert.equal(document.bundleResolution.labels.values.region, 'eu-central');
  assert.equal(
    document.bundleResolution.selectedCandidate?.resource?.bundleId,
    'bundle_finance_discovery_doc',
  );
}

function run(): void {
  testDiscoveryLabelsCarryReservedAndCustomValues();
  testReservedDiscoveryLabelsCannotBeOverridden();
  testScopedActiveResolutionSelectsMostSpecificBundle();
  testStaticResolutionUsesMetadataActiveBundle();
  testAmbiguousTopCandidatesStayExplicit();
  testMissingBundleIsFailClosed();
  testDiscoveryDocumentCarriesResolutionContext();
  console.log('Release policy control-plane discovery tests: 7 passed, 0 failed');
}

run();
