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
  createPolicyTestCase,
  createPolicyTestPack,
  runPolicyTestPack,
} from '../src/release-policy-control-plane/test-pack.js';
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
      requestId: 'req_test_pack',
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

function candidateBundle() {
  return createSignedBundle('bundle_finance_candidate', [
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
}

function activationTarget() {
  return createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
  });
}

function testRequiredCasesGateOverallRun(): void {
  const { store } = seedResolvedStore();
  const candidate = candidateBundle();
  const testPack = createPolicyTestPack({
    id: 'finance-policy-pack',
    name: 'Finance policy pack',
    candidateBundle: candidate.bundleRecord.manifest.bundle,
    cases: [
      createPolicyTestCase({
        id: 'record-release-dry-run',
        name: 'Record release dry-run preview',
        resolverInput: sampleResolverInput(),
        activationTarget: activationTarget(),
        expectation: {
          currentStatus: 'resolved',
          simulatedStatus: 'resolved',
          currentPolicyId: 'finance.structured-record-release.v1',
          simulatedPolicyId: 'finance.structured-record-release.dry-run.v1',
          currentRolloutMode: 'enforce',
          simulatedRolloutMode: 'dry-run',
          changed: true,
          policyChanged: true,
          rolloutChanged: true,
        },
      }),
    ],
  });

  const result = runPolicyTestPack(store, testPack, candidate.bundleRecord);

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.counts, {
    passed: 1,
    failed: 0,
    requiredFailed: 0,
    advisoryFailed: 0,
  });
}

function testFailedRequiredCaseFailsRun(): void {
  const { store } = seedResolvedStore();
  const candidate = candidateBundle();
  const testPack = createPolicyTestPack({
    id: 'finance-policy-pack-fail',
    name: 'Finance policy pack fail',
    candidateBundle: candidate.bundleRecord.manifest.bundle,
    cases: [
      createPolicyTestCase({
        id: 'wrong-status',
        name: 'Wrong status expectation',
        resolverInput: sampleResolverInput(),
        activationTarget: activationTarget(),
        expectation: {
          simulatedStatus: 'no-policy-entry',
        },
      }),
    ],
  });

  const result = runPolicyTestPack(store, testPack, candidate.bundleRecord);

  assert.equal(result.status, 'failed');
  assert.equal(result.counts.requiredFailed, 1);
  assert.equal(result.results[0]?.failures[0]?.field, 'simulatedStatus');
}

function testAdvisoryFailuresDoNotFailRun(): void {
  const { store } = seedResolvedStore();
  const candidate = candidateBundle();
  const testPack = createPolicyTestPack({
    id: 'finance-policy-pack-advisory',
    name: 'Finance policy pack advisory',
    candidateBundle: candidate.bundleRecord.manifest.bundle,
    cases: [
      createPolicyTestCase({
        id: 'advisory-mismatch',
        name: 'Advisory mismatch',
        severity: 'advisory',
        resolverInput: sampleResolverInput(),
        activationTarget: activationTarget(),
        expectation: {
          simulatedRolloutMode: 'enforce',
        },
      }),
    ],
  });

  const result = runPolicyTestPack(store, testPack, candidate.bundleRecord);

  assert.equal(result.status, 'passed');
  assert.equal(result.counts.advisoryFailed, 1);
  assert.equal(result.counts.requiredFailed, 0);
}

function testCandidateBundleMismatchIsRejected(): void {
  const { store } = seedResolvedStore();
  const candidate = candidateBundle();
  const testPack = createPolicyTestPack({
    id: 'finance-policy-pack-mismatch',
    name: 'Finance policy pack mismatch',
    candidateBundle: sampleBundleReference('bundle_other'),
    cases: [
      createPolicyTestCase({
        id: 'record-release-dry-run',
        name: 'Record release dry-run preview',
        resolverInput: sampleResolverInput(),
        activationTarget: activationTarget(),
        expectation: {
          simulatedStatus: 'resolved',
        },
      }),
    ],
  });

  assert.throws(
    () => runPolicyTestPack(store, testPack, candidate.bundleRecord),
    /candidate bundle reference must match/i,
  );
}

function run(): void {
  testRequiredCasesGateOverallRun();
  testFailedRequiredCaseFailsRun();
  testAdvisoryFailuresDoNotFailRun();
  testCandidateBundleMismatchIsRejected();
  console.log('Release policy control-plane test-pack tests: 4 passed, 0 failed');
}

run();
