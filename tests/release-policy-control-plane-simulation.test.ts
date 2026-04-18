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
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyBundleSigner } from '../src/release-policy-control-plane/bundle-signing.js';
import { createInMemoryPolicyControlPlaneStore } from '../src/release-policy-control-plane/store.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';
import { createPolicySimulationApi } from '../src/release-policy-control-plane/simulation.js';
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
) {
  const pack = samplePackMetadata(bundleId);
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(bundleId),
    pack,
    generatedAt: '2026-04-18T09:05:00.000Z',
    entries,
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
    manifest,
    artifact,
    signedBundle,
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
    activatedAt: '2026-04-18T09:15:00.000Z',
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
      requestId: 'req_simulation',
      outputHash: 'sha256:output',
      requesterId: 'user_policy_admin',
      targetId: 'finance.reporting.record-store',
    } as const,
  };
}

function currentBundleDefinition() {
  return policy.createFirstHardGatewayReleasePolicy();
}

function candidateDryRunDefinition() {
  return policy.createReleasePolicyDefinition({
    ...policy.createFirstHardGatewayReleasePolicy(),
    id: 'finance.structured-record-release.dry-run.v1',
    name: 'Finance structured record release policy (dry run)',
    rollout: {
      mode: 'dry-run',
      activatedAt: '2026-04-18T09:20:00.000Z',
    },
  });
}

function seedResolvedStore(discoveryMode: 'scoped-active' | 'static' = 'scoped-active') {
  const store = createInMemoryPolicyControlPlaneStore();
  const currentBundle = createSignedBundle('bundle_finance_current', [
    createEntry(
      'entry-current',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        wedgeId: 'finance.record.release',
        consequenceType: 'record',
        riskClass: 'R4',
      },
      currentBundleDefinition(),
    ),
  ]);

  store.upsertPack(currentBundle.pack);
  store.upsertBundle({
    manifest: currentBundle.manifest,
    artifact: currentBundle.artifact,
    signedBundle: currentBundle.signedBundle,
    verificationKey: currentBundle.bundleRecord.verificationKey,
    storedAt: currentBundle.bundleRecord.storedAt,
  });
  const activation = createActivation('activation-current', currentBundle.artifact.bundleId, {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
  });
  if (discoveryMode !== 'static') {
    store.upsertActivation(activation);
  }
  store.setMetadata(
    createPolicyControlPlaneMetadata(
      'embedded-memory',
      discoveryMode,
      currentBundle.manifest.bundle,
      discoveryMode === 'static' ? null : activation.id,
    ),
  );

  return { store, currentBundle };
}

function testDryRunCandidateActivationDoesNotMutateStore(): void {
  const { store } = seedResolvedStore();
  const snapshotBefore = JSON.stringify(store.exportSnapshot());
  const candidateBundle = createSignedBundle('bundle_finance_candidate', [
    createEntry(
      'entry-candidate',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        wedgeId: 'finance.record.release',
        consequenceType: 'record',
        riskClass: 'R4',
      },
      candidateDryRunDefinition(),
    ),
  ]);

  const simulation = createPolicySimulationApi(store).dryRunCandidateActivation(
    sampleResolverInput(),
    {
      bundleRecord: candidateBundle.bundleRecord,
      target: createPolicyActivationTarget({
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        consequenceType: 'record',
      }),
      activatedAt: '2026-04-18T09:30:00.000Z',
    },
  );

  assert.equal(simulation.current.status, 'resolved');
  assert.equal(simulation.simulated.status, 'resolved');
  assert.equal(simulation.current.bundleRecord?.bundleId, 'bundle_finance_current');
  assert.equal(simulation.simulated.bundleRecord?.bundleId, 'bundle_finance_candidate');
  assert.equal(simulation.delta.changed, true);
  assert.equal(simulation.delta.bundleChanged, true);
  assert.equal(simulation.delta.policyChanged, true);
  assert.equal(simulation.delta.rolloutChanged, true);
  assert.equal(JSON.stringify(store.exportSnapshot()), snapshotBefore);
}

function testDryRunCapturesStatusRegression(): void {
  const { store } = seedResolvedStore();
  const candidateBundle = createSignedBundle('bundle_finance_candidate_bad', [
    createEntry(
      'entry-action-only',
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

  const simulation = createPolicySimulationApi(store).dryRunCandidateActivation(
    sampleResolverInput(),
    {
      bundleRecord: candidateBundle.bundleRecord,
      target: createPolicyActivationTarget({
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        consequenceType: 'record',
      }),
    },
  );

  assert.equal(simulation.current.status, 'resolved');
  assert.equal(simulation.simulated.status, 'no-policy-entry');
  assert.equal(simulation.delta.statusChanged, true);
  assert.equal(simulation.delta.bundleChanged, true);
}

function testDryRunSupportsStaticDiscoveryMode(): void {
  const { store } = seedResolvedStore('static');
  const candidateBundle = createSignedBundle('bundle_finance_candidate_static', [
    createEntry(
      'entry-candidate-static',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        wedgeId: 'finance.record.release',
        consequenceType: 'record',
        riskClass: 'R4',
      },
      candidateDryRunDefinition(),
    ),
  ]);

  const simulation = createPolicySimulationApi(store).dryRunCandidateActivation(
    sampleResolverInput(),
    {
      bundleRecord: candidateBundle.bundleRecord,
      target: createPolicyActivationTarget({
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        domainId: 'finance',
        consequenceType: 'record',
      }),
      discoveryMode: 'static',
    },
  );

  assert.equal(simulation.current.status, 'resolved');
  assert.equal(simulation.current.bundleRecord?.bundleId, 'bundle_finance_current');
  assert.equal(simulation.simulated.status, 'resolved');
  assert.equal(simulation.simulated.bundleRecord?.bundleId, 'bundle_finance_candidate_static');
}

function testResolveCurrentDelegatesToResolver(): void {
  const { store } = seedResolvedStore();
  const result = createPolicySimulationApi(store).resolveCurrent(sampleResolverInput());

  assert.equal(result.status, 'resolved');
  assert.equal(result.bundleRecord?.bundleId, 'bundle_finance_current');
}

function run(): void {
  testDryRunCandidateActivationDoesNotMutateStore();
  testDryRunCapturesStatusRegression();
  testDryRunSupportsStaticDiscoveryMode();
  testResolveCurrentDelegatesToResolver();
  console.log('Release policy control-plane simulation tests: 4 passed, 0 failed');
}

run();
