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
import {
  createPolicyImpactApi,
  summarizePolicyBundleImpact,
} from '../src/release-policy-control-plane/impact-summary.js';
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
      requestId: 'req_impact',
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

function seedResolvedStore() {
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
  const activation = createActivation(currentBundle.artifact.bundleId);
  store.upsertActivation(activation);
  store.setMetadata(
    createPolicyControlPlaneMetadata(
      'embedded-memory',
      'scoped-active',
      currentBundle.manifest.bundle,
      activation.id,
    ),
  );

  return { store, currentBundle };
}

function testBundleImpactDetectsSemanticPolicyChanges(): void {
  const { currentBundle } = seedResolvedStore();
  const candidateBundle = createSignedBundle('bundle_finance_candidate', [
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
      candidateDryRunDefinition(),
    ),
  ]);

  const impact = summarizePolicyBundleImpact(
    currentBundle.bundleRecord,
    candidateBundle.bundleRecord,
  );

  assert.equal(impact.changed, true);
  assert.deepEqual(impact.counts, {
    added: 0,
    removed: 0,
    updated: 1,
    unchanged: 0,
  });
  assert.equal(impact.flags.changesRolloutBehavior, true);
  assert.equal(impact.flags.changesEnforcementBehavior, false);
  assert.equal(impact.entries[0]?.semanticChanges.some((change) => change.kind === 'policy-id'), true);
  assert.equal(impact.entries[0]?.semanticChanges.some((change) => change.kind === 'rollout-mode'), true);
}

function testBundleImpactDetectsAddedAndRemovedScopes(): void {
  const { currentBundle } = seedResolvedStore();
  const candidateBundle = createSignedBundle('bundle_finance_action_only', [
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

  const impact = summarizePolicyBundleImpact(
    currentBundle.bundleRecord,
    candidateBundle.bundleRecord,
  );

  assert.equal(impact.changed, true);
  assert.deepEqual(impact.counts, {
    added: 1,
    removed: 1,
    updated: 0,
    unchanged: 0,
  });
  assert.equal(impact.flags.changesScopeCoverage, true);
  assert.equal(impact.flags.changesConsequenceCoverage, true);
  assert.equal(impact.flags.changesRiskCoverage, true);
  assert.deepEqual(impact.affectedConsequenceTypes, ['action', 'record']);
  assert.deepEqual(impact.affectedRiskClasses, ['R3', 'R4']);
}

function testImpactApiPreviewsCandidateActivation(): void {
  const { store } = seedResolvedStore();
  const candidateBundle = createSignedBundle('bundle_finance_candidate', [
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
      candidateDryRunDefinition(),
    ),
  ]);

  const preview = createPolicyImpactApi(store).previewCandidateActivation(
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

  assert.equal(preview.dryRun.current.status, 'resolved');
  assert.equal(preview.dryRun.simulated.status, 'resolved');
  assert.equal(preview.bundleImpact.currentBundleId, 'bundle_finance_current');
  assert.equal(preview.bundleImpact.candidateBundleId, 'bundle_finance_candidate');
  assert.equal(preview.dryRunImpact.changed, true);
  assert.equal(preview.dryRunImpact.currentPolicyId, 'finance.structured-record-release.v1');
  assert.equal(preview.dryRunImpact.simulatedPolicyId, 'finance.structured-record-release.dry-run.v1');
  assert.equal(preview.dryRunImpact.currentRolloutMode, 'enforce');
  assert.equal(preview.dryRunImpact.simulatedRolloutMode, 'dry-run');
}

function testBundleImpactCanBeNoop(): void {
  const { currentBundle } = seedResolvedStore();
  const impact = summarizePolicyBundleImpact(
    currentBundle.bundleRecord,
    currentBundle.bundleRecord,
  );

  assert.equal(impact.changed, false);
  assert.deepEqual(impact.counts, {
    added: 0,
    removed: 0,
    updated: 0,
    unchanged: 1,
  });
}

function run(): void {
  testBundleImpactDetectsSemanticPolicyChanges();
  testBundleImpactDetectsAddedAndRemovedScopes();
  testImpactApiPreviewsCandidateActivation();
  testBundleImpactCanBeNoop();
  console.log('Release policy control-plane impact-summary tests: 4 passed, 0 failed');
}

run();
