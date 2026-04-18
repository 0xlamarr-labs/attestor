import assert from 'node:assert/strict';
import { resolve } from 'node:path';
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
  createFileBackedPolicyActivationApprovalStore,
  createInMemoryPolicyActivationApprovalStore,
  derivePolicyActivationApprovalRequirement,
  evaluatePolicyActivationApprovalGate,
  recordPolicyActivationApprovalDecision,
  requestPolicyActivationApproval,
  resetFileBackedPolicyActivationApprovalStoreForTests,
} from '../src/release-policy-control-plane/activation-approvals.js';
import {
  createPolicyActivationTarget,
  type PolicyActivationTarget,
} from '../src/release-policy-control-plane/types.js';
import { policy } from '../src/release-layer/index.js';

function actor(id: string, role = 'policy-admin') {
  return {
    id,
    type: 'user',
    displayName: id.replaceAll('_', ' '),
    role,
  } as const;
}

function bundleReference(bundleId: string) {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: bundleId.replace('bundle_', '').replaceAll('_', '.'),
    digest: `sha256:${bundleId}`,
  } as const;
}

function targetForRisk(riskClass: 'R2' | 'R4'): PolicyActivationTarget {
  if (riskClass === 'R2') {
    return createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      accountId: 'account-major',
      domainId: 'finance',
      wedgeId: 'finance-review-summary-communication',
      consequenceType: 'communication',
      riskClass: 'R2',
      planId: 'enterprise',
    });
  }

  return createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    accountId: 'account-major',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
    planId: 'enterprise',
  });
}

function createEntry(id: string, target: PolicyActivationTarget) {
  const definition =
    target.riskClass === 'R2'
      ? policy.createFinanceCommunicationReleasePolicy()
      : policy.createFirstHardGatewayReleasePolicy();
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

function createSignedBundle(riskClass: 'R2' | 'R4' = 'R4') {
  const bundleId = riskClass === 'R2'
    ? 'bundle_finance_comm_2026_04_18'
    : 'bundle_finance_record_2026_04_18';
  const target = targetForRisk(riskClass);
  const pack = createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    lifecycleState: 'published',
    createdAt: '2026-04-18T09:00:00.000Z',
    latestBundleRef: bundleReference(bundleId),
  });
  const manifest = createPolicyBundleManifest({
    bundle: bundleReference(bundleId),
    pack,
    generatedAt: '2026-04-18T09:05:00.000Z',
    entries: [createEntry(`entry-${riskClass.toLowerCase()}`, target)],
  });
  const artifact = createSignablePolicyBundleArtifact(pack, manifest);
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });

  return {
    target,
    bundleRecord: {
      version: 'attestor.policy-store-record.v1' as const,
      packId: manifest.packId,
      bundleId: artifact.bundleId,
      bundleVersion: manifest.bundle.bundleVersion,
      storedAt: '2026-04-18T09:07:00.000Z',
      manifest,
      artifact,
      signedBundle: signer.sign({
        artifact,
        signedAt: '2026-04-18T09:06:00.000Z',
      }),
      verificationKey: signer.exportVerificationKey(),
    },
  };
}

function requestApproval() {
  const store = createInMemoryPolicyActivationApprovalStore();
  const bundle = createSignedBundle('R4');
  const request = requestPolicyActivationApproval(store, {
    id: 'approval_r4',
    target: bundle.target,
    bundleRecord: bundle.bundleRecord,
    requestedBy: actor('requester_policy_admin'),
    requestedAt: '2026-04-18T09:10:00.000Z',
    expiresAt: '2026-04-19T09:10:00.000Z',
    rationale: 'Promote regulated finance record release policy.',
  });
  return { store, bundle, request };
}

function testR4RequiresDualApproval(): void {
  const bundle = createSignedBundle('R4');
  const requirement = derivePolicyActivationApprovalRequirement({
    target: bundle.target,
    bundleRecord: bundle.bundleRecord,
  });

  assert.equal(requirement.mode, 'dual-approval');
  assert.equal(requirement.requiredApprovals, 2);
  assert.equal(requirement.requiresRequesterSeparation, true);
}

function testLowRiskDoesNotRequireApproval(): void {
  const store = createInMemoryPolicyActivationApprovalStore();
  const bundle = createSignedBundle('R2');
  const result = evaluatePolicyActivationApprovalGate(store, {
    target: bundle.target,
    bundleRecord: bundle.bundleRecord,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.status, 'not-required');
}

function testSelfApprovalIsRejected(): void {
  const { store, request } = requestApproval();

  assert.throws(
    () =>
      recordPolicyActivationApprovalDecision(store, {
        requestId: request.id,
        decision: 'approve',
        reviewer: actor('requester_policy_admin'),
        decidedAt: '2026-04-18T09:11:00.000Z',
        rationale: 'Self approve.',
      }),
    /same actor/,
  );
}

function testDualApprovalRequiresTwoDistinctReviewers(): void {
  const { store, bundle, request } = requestApproval();

  const first = recordPolicyActivationApprovalDecision(store, {
    requestId: request.id,
    decision: 'approve',
    reviewer: actor('risk_owner', 'risk-owner'),
    decidedAt: '2026-04-18T09:11:00.000Z',
    rationale: 'Risk owner approval.',
  });
  assert.equal(first.state, 'pending');

  const pendingGate = evaluatePolicyActivationApprovalGate(store, {
    target: bundle.target,
    bundleRecord: bundle.bundleRecord,
    approvalRequestId: request.id,
    now: '2026-04-18T09:12:00.000Z',
  });
  assert.equal(pendingGate.allowed, false);
  assert.equal(pendingGate.status, 'approval-pending');

  const second = recordPolicyActivationApprovalDecision(store, {
    requestId: request.id,
    decision: 'approve',
    reviewer: actor('compliance_officer', 'compliance-officer'),
    decidedAt: '2026-04-18T09:13:00.000Z',
    rationale: 'Compliance approval.',
  });
  assert.equal(second.state, 'approved');
  assert.deepEqual(second.approvedReviewerIds, ['compliance_officer', 'risk_owner']);

  const approvedGate = evaluatePolicyActivationApprovalGate(store, {
    target: bundle.target,
    bundleRecord: bundle.bundleRecord,
    approvalRequestId: request.id,
    now: '2026-04-18T09:14:00.000Z',
  });
  assert.equal(approvedGate.allowed, true);
  assert.equal(approvedGate.status, 'approved');
}

function testGateRejectsExpiredOrMismatchedApproval(): void {
  const { store, bundle, request } = requestApproval();
  recordPolicyActivationApprovalDecision(store, {
    requestId: request.id,
    decision: 'approve',
    reviewer: actor('risk_owner', 'risk-owner'),
    decidedAt: '2026-04-18T09:11:00.000Z',
    rationale: 'Risk owner approval.',
  });
  recordPolicyActivationApprovalDecision(store, {
    requestId: request.id,
    decision: 'approve',
    reviewer: actor('compliance_officer', 'compliance-officer'),
    decidedAt: '2026-04-18T09:13:00.000Z',
    rationale: 'Compliance approval.',
  });

  const expired = evaluatePolicyActivationApprovalGate(store, {
    target: bundle.target,
    bundleRecord: bundle.bundleRecord,
    approvalRequestId: request.id,
    now: '2026-04-20T09:14:00.000Z',
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.status, 'approval-expired');

  const otherBundle = createSignedBundle('R4');
  const mismatched = evaluatePolicyActivationApprovalGate(store, {
    target: otherBundle.target,
    bundleRecord: {
      ...otherBundle.bundleRecord,
      bundleId: 'bundle_finance_record_other',
      manifest: {
        ...otherBundle.bundleRecord.manifest,
        bundle: {
          ...otherBundle.bundleRecord.manifest.bundle,
          bundleId: 'bundle_finance_record_other',
        },
      },
    },
    approvalRequestId: request.id,
    now: '2026-04-18T09:14:00.000Z',
  });
  assert.equal(mismatched.allowed, false);
  assert.equal(mismatched.status, 'approval-bundle-mismatch');
}

function testFileBackedApprovalStorePersists(): void {
  const path = resolve('.attestor/tests/policy-activation-approvals.json');
  resetFileBackedPolicyActivationApprovalStoreForTests(path);
  try {
    const writer = createFileBackedPolicyActivationApprovalStore(path);
    const bundle = createSignedBundle('R4');
    const request = requestPolicyActivationApproval(writer, {
      id: 'approval_file_backed',
      target: bundle.target,
      bundleRecord: bundle.bundleRecord,
      requestedBy: actor('requester_policy_admin'),
      requestedAt: '2026-04-18T09:10:00.000Z',
      rationale: 'Persist approval request.',
    });

    const reader = createFileBackedPolicyActivationApprovalStore(path);
    assert.equal(reader.get(request.id)?.id, request.id);
    assert.equal(reader.list({ state: 'pending' }).length, 1);
  } finally {
    resetFileBackedPolicyActivationApprovalStoreForTests(path);
  }
}

function run(): void {
  testR4RequiresDualApproval();
  testLowRiskDoesNotRequireApproval();
  testSelfApprovalIsRejected();
  testDualApprovalRequiresTwoDistinctReviewers();
  testGateRejectsExpiredOrMismatchedApproval();
  testFileBackedApprovalStorePersists();
  console.log('Release policy control-plane activation-approval tests: 6 passed, 0 failed');
}

run();
