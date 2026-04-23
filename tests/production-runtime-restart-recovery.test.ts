import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildFinanceFilingReleaseMaterial,
  buildFinanceFilingReleaseObservation,
  createFinanceFilingReleaseCandidateFromReport,
  finalizeFinanceFilingReleaseDecision,
} from '../src/release-kernel/finance-record-release.js';
import { ATTESTOR_RELEASE_DECISION_LOG_PATH_ENV } from '../src/release-kernel/release-decision-log.js';
import { ATTESTOR_RELEASE_EVIDENCE_PACK_STORE_PATH_ENV } from '../src/release-kernel/release-evidence-pack.js';
import { ATTESTOR_RELEASE_TOKEN_INTROSPECTION_STORE_PATH_ENV } from '../src/release-kernel/release-introspection.js';
import {
  applyReviewerDecision,
  attachIssuedTokenToReviewerQueueRecord,
  createFinanceReviewerQueueItem,
  ATTESTOR_RELEASE_REVIEWER_QUEUE_STORE_PATH_ENV,
} from '../src/release-kernel/reviewer-queue.js';
import {
  createDegradedModeGrant,
} from '../src/release-enforcement-plane/degraded-mode.js';
import {
  recordPolicyActivationApprovalDecision,
  requestPolicyActivationApproval,
} from '../src/release-policy-control-plane/activation-approvals.js';
import { createPolicyControlPlaneMetadata } from '../src/release-policy-control-plane/object-model.js';
import { createReleaseRuntimeBootstrap } from '../src/service/bootstrap/release-runtime.js';
import {
  ATTESTOR_RUNTIME_PROFILE_ENV,
  resolveRuntimeProfile,
} from '../src/service/bootstrap/runtime-profile.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function actor(id: string, role = 'runtime-operator') {
  return {
    id,
    type: 'user' as const,
    displayName: id.replaceAll('_', ' '),
    role,
  };
}

function makeFinanceReport(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'api-finance-runtime-recovery',
    timestamp: '2026-04-23T10:00:00.000Z',
    decision: 'pending_approval',
    certificate: { certificateId: 'cert_runtime_recovery' },
    evidenceChain: { terminalHash: 'sha256:chain_terminal_runtime_recovery', intact: true },
    execution: {
      success: true,
      rows: [
        {
          counterparty_name: 'Bank of Nova Scotia',
          exposure_usd: 250000000,
          credit_rating: 'AA-',
          sector: 'Banking',
        },
        {
          counterparty_name: 'BNP Paribas',
          exposure_usd: 185000000,
          credit_rating: 'A+',
          sector: 'Banking',
        },
      ],
    },
    liveProof: {
      mode: 'live_runtime',
      consistent: true,
    },
    receipt: {
      receiptStatus: 'withheld',
    },
    oversight: {
      status: 'pending',
    },
    escrow: {
      state: 'held',
    },
    filingReadiness: {
      status: 'internal_report_ready',
    },
    audit: {
      chainIntact: true,
    },
    attestation: {
      manifestHash: 'manifest_hash_runtime_recovery',
    },
    ...overrides,
  } as any;
}

function releaseDecisionLogMetadata(requiresReview: boolean) {
  return {
    policyMatched: true,
    pendingChecks: [],
    pendingEvidenceKinds: [],
    requiresReview,
    deterministicChecksCompleted: true,
    effectivePolicyId: null,
    rolloutMode: null,
    rolloutEvaluationMode: null,
    rolloutReason: null,
    rolloutCanaryBucket: null,
    rolloutFallbackPolicyId: null,
  };
}

const STORE_PATH_ENV = [
  ATTESTOR_RUNTIME_PROFILE_ENV,
  ATTESTOR_RELEASE_DECISION_LOG_PATH_ENV,
  ATTESTOR_RELEASE_REVIEWER_QUEUE_STORE_PATH_ENV,
  ATTESTOR_RELEASE_TOKEN_INTROSPECTION_STORE_PATH_ENV,
  ATTESTOR_RELEASE_EVIDENCE_PACK_STORE_PATH_ENV,
  'ATTESTOR_RELEASE_ENFORCEMENT_DEGRADED_MODE_STORE_PATH',
  'ATTESTOR_POLICY_CONTROL_PLANE_STORE_PATH',
  'ATTESTOR_POLICY_ACTIVATION_APPROVAL_STORE_PATH',
  'ATTESTOR_POLICY_MUTATION_AUDIT_LOG_PATH',
  'ATTESTOR_RELEASE_POLICY_ENVIRONMENT',
] as const;

function configureDurableRuntimePaths(root: string): void {
  process.env[ATTESTOR_RUNTIME_PROFILE_ENV] = 'single-node-durable';
  process.env[ATTESTOR_RELEASE_DECISION_LOG_PATH_ENV] = join(root, 'release-decision-log.jsonl');
  process.env[ATTESTOR_RELEASE_REVIEWER_QUEUE_STORE_PATH_ENV] = join(root, 'release-reviewer-queue.json');
  process.env[ATTESTOR_RELEASE_TOKEN_INTROSPECTION_STORE_PATH_ENV] = join(root, 'release-token-introspection.json');
  process.env[ATTESTOR_RELEASE_EVIDENCE_PACK_STORE_PATH_ENV] = join(root, 'release-evidence-packs.json');
  process.env.ATTESTOR_RELEASE_ENFORCEMENT_DEGRADED_MODE_STORE_PATH = join(root, 'degraded-mode-grants.json');
  process.env.ATTESTOR_POLICY_CONTROL_PLANE_STORE_PATH = join(root, 'policy-control-plane.json');
  process.env.ATTESTOR_POLICY_ACTIVATION_APPROVAL_STORE_PATH = join(root, 'policy-activation-approvals.json');
  process.env.ATTESTOR_POLICY_MUTATION_AUDIT_LOG_PATH = join(root, 'policy-mutation-audit.json');
  process.env.ATTESTOR_RELEASE_POLICY_ENVIRONMENT = 'runtime-recovery';
}

function restoreEnvironment(previous: Map<string, string | undefined>): void {
  for (const key of STORE_PATH_ENV) {
    const value = previous.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'attestor-runtime-recovery-'));
  const previousEnv = new Map<string, string | undefined>(
    STORE_PATH_ENV.map((key) => [key, process.env[key]]),
  );

  try {
    configureDurableRuntimePaths(root);
    const profile = resolveRuntimeProfile({ env: process.env });
    const first = createReleaseRuntimeBootstrap({ runtimeProfile: profile });

    equal(first.runtimeProfile.id, 'single-node-durable', 'Runtime recovery: durable runtime profile is selected');
    equal(first.runtimeProfileDiagnostics.durability.ready, true, 'Runtime recovery: durable profile passes startup durability checks');
    ok(
      first.runtimeProfileDiagnostics.releaseStores.every((store) => store.satisfiesSelectedProfile),
      'Runtime recovery: every release store satisfies the selected durable profile',
    );

    const report = makeFinanceReport();
    const candidate = createFinanceFilingReleaseCandidateFromReport(report);
    ok(candidate !== null, 'Runtime recovery: finance report creates a release candidate');
    const material = buildFinanceFilingReleaseMaterial(candidate!);
    const evaluation = first.financeReleaseDecisionEngine.evaluateWithDeterministicChecks(
      {
        id: 'finance-runtime-recovery-decision',
        createdAt: report.timestamp,
        outputHash: material.hashBundle.outputHash,
        consequenceHash: material.hashBundle.consequenceHash,
        outputContract: material.outputContract,
        capabilityBoundary: material.capabilityBoundary,
        requester: {
          id: 'svc.attestor.api',
          type: 'service',
          displayName: 'Attestor API',
        },
        target: material.target,
      },
      buildFinanceFilingReleaseObservation(material, report),
    );
    equal(evaluation.decision.status, 'review-required', 'Runtime recovery: release engine records a review-required decision');

    const finalized = finalizeFinanceFilingReleaseDecision(evaluation.decision, report);
    const queueItem = createFinanceReviewerQueueItem({
      decision: finalized,
      candidate: candidate!,
      report,
      logEntries: first.financeReleaseDecisionLog.entries(),
    });
    const firstApproval = applyReviewerDecision({
      record: queueItem,
      outcome: 'approved',
      reviewerId: 'reviewer.alpha',
      reviewerName: 'Alpha Reviewer',
      reviewerRole: 'financial_reporting_manager',
      decidedAt: '2026-04-23T10:01:00.000Z',
      note: 'First reviewer confirms release conditions.',
    });
    const secondApproval = applyReviewerDecision({
      record: firstApproval.record,
      outcome: 'approved',
      reviewerId: 'reviewer.beta',
      reviewerName: 'Beta Reviewer',
      reviewerRole: 'financial_reporting_manager',
      decidedAt: '2026-04-23T10:02:00.000Z',
      note: 'Second reviewer closes regulated release authority.',
    });
    equal(secondApproval.record.releaseDecision.status, 'accepted', 'Runtime recovery: dual review reaches accepted authority state');

    first.financeReleaseDecisionLog.append({
      occurredAt: '2026-04-23T10:01:00.000Z',
      requestId: 'review:runtime-recovery:approve-1',
      phase: 'review',
      matchedPolicyId: secondApproval.record.releaseDecision.policyVersion,
      decision: secondApproval.record.releaseDecision,
      metadata: releaseDecisionLogMetadata(true),
    });
    first.financeReleaseDecisionLog.append({
      occurredAt: '2026-04-23T10:02:00.000Z',
      requestId: 'review:runtime-recovery:terminal-accept',
      phase: 'terminal-accept',
      matchedPolicyId: secondApproval.record.releaseDecision.policyVersion,
      decision: secondApproval.record.releaseDecision,
      metadata: releaseDecisionLogMetadata(false),
    });

    const issuedToken = await first.apiReleaseTokenIssuer.issue({
      decision: secondApproval.record.releaseDecision,
      issuedAt: '2026-04-23T10:02:30.000Z',
    });
    const recordWithToken = attachIssuedTokenToReviewerQueueRecord({
      record: secondApproval.record,
      issuedToken,
    });
    first.apiReleaseReviewerQueueStore.upsert(recordWithToken);
    first.apiReleaseIntrospectionStore.registerIssuedToken({
      issuedToken,
      decision: recordWithToken.releaseDecision,
    });

    const issuedEvidencePack = await first.apiReleaseEvidencePackIssuer.issue({
      decision: {
        ...recordWithToken.releaseDecision,
        evidencePackId: 'ep_runtime_recovery_test',
      },
      evidencePackId: 'ep_runtime_recovery_test',
      issuedAt: '2026-04-23T10:03:00.000Z',
      decisionLogEntries: first.financeReleaseDecisionLog.entries().filter(
        (entry) => entry.decisionId === recordWithToken.releaseDecision.id,
      ),
      decisionLogChainIntact: first.financeReleaseDecisionLog.verify().valid,
      review: recordWithToken.detail,
      releaseToken: issuedToken,
      artifactReferences: [
        {
          kind: 'provenance',
          path: 'runtime-recovery://finance-report',
          digest: report.evidenceChain.terminalHash,
        },
      ],
    });
    first.apiReleaseEvidencePackStore.upsert(issuedEvidencePack);

    const existingMetadata = first.policyControlPlaneStore.getMetadata();
    ok(existingMetadata !== null, 'Runtime recovery: finance proving policy metadata is seeded');
    const sentinelActivationId = 'activation_runtime_recovery_sentinel';
    first.policyControlPlaneStore.setMetadata(
      createPolicyControlPlaneMetadata(
        existingMetadata!.storeKind,
        existingMetadata!.discoveryMode,
        existingMetadata!.activeBundleRef,
        sentinelActivationId,
      ),
    );

    const policyBundleRecord = first.policyControlPlaneStore.listBundles()[0];
    const policyActivation = first.policyControlPlaneStore.listActivations()[0];
    ok(policyBundleRecord !== undefined, 'Runtime recovery: seeded policy bundle exists before restart');
    ok(policyActivation !== undefined, 'Runtime recovery: seeded policy activation exists before restart');
    const approvalRequest = requestPolicyActivationApproval(
      first.policyActivationApprovalStore,
      {
        id: 'approval_runtime_recovery',
        target: policyActivation!.target,
        bundleRecord: policyBundleRecord!,
        requestedBy: actor('requester_policy_admin', 'policy-admin'),
        requestedAt: '2026-04-23T10:04:00.000Z',
        expiresAt: '2026-04-24T10:04:00.000Z',
        rationale: 'Runtime recovery test policy activation approval state.',
      },
    );
    const firstPolicyApproval = recordPolicyActivationApprovalDecision(
      first.policyActivationApprovalStore,
      {
        requestId: approvalRequest.id,
        decision: 'approve',
        reviewer: actor('risk_owner', 'risk-owner'),
        decidedAt: '2026-04-23T10:05:00.000Z',
        rationale: 'Risk owner recovery approval.',
      },
    );
    const secondPolicyApproval = recordPolicyActivationApprovalDecision(
      first.policyActivationApprovalStore,
      {
        requestId: approvalRequest.id,
        decision: 'approve',
        reviewer: actor('compliance_officer', 'compliance-officer'),
        decidedAt: '2026-04-23T10:06:00.000Z',
        rationale: 'Compliance recovery approval.',
      },
    );
    ok(
      firstPolicyApproval.state === 'pending' || firstPolicyApproval.state === 'approved',
      'Runtime recovery: first policy approval records progress',
    );
    equal(secondPolicyApproval.state, 'approved', 'Runtime recovery: policy activation approval closes before restart');

    const auditEntry = first.policyMutationAuditLog.append({
      occurredAt: '2026-04-23T10:07:00.000Z',
      action: 'request-activation-approval',
      actor: actor('requester_policy_admin', 'policy-admin'),
      subject: {
        packId: policyBundleRecord!.packId,
        bundleId: policyBundleRecord!.bundleId,
        bundleVersion: policyBundleRecord!.bundleVersion,
        activationId: policyActivation!.id,
        targetLabel: policyActivation!.targetLabel,
      },
      reasonCode: 'runtime-recovery-test',
      rationale: 'Record a policy control-plane mutation before restart.',
      mutationSnapshot: {
        approvalRequestId: approvalRequest.id,
        activationId: policyActivation!.id,
      },
    });

    const grant = createDegradedModeGrant({
      id: 'dmg_runtime_recovery_test',
      state: 'cache-only',
      reason: 'control-plane-recovery',
      scope: {
        environment: 'runtime-recovery',
        enforcementPointId: 'filing-export',
        pointKind: 'application-middleware',
        boundaryKind: 'http-request',
        tenantId: 'tenant-recovery',
      },
      authorizedBy: actor('ops_lead', 'sre'),
      approvedBy: [actor('incident_commander', 'sre')],
      authorizedAt: '2026-04-23T10:08:00.000Z',
      startsAt: '2026-04-23T10:08:00.000Z',
      expiresAt: '2026-04-23T10:18:00.000Z',
      ticketId: 'INC-RECOVERY-1',
      rationale: 'Runtime recovery test cache-only grant.',
      allowedFailureReasons: ['introspection-unavailable'],
      maxUses: 2,
      remainingUses: 2,
    });
    first.apiReleaseDegradedModeGrantStore.registerGrant(grant);
    const consumedGrant = first.apiReleaseDegradedModeGrantStore.consumeGrant({
      id: grant.id,
      checkedAt: '2026-04-23T10:09:00.000Z',
      actor: actor('resource_server', 'service'),
      failureReasons: ['introspection-unavailable'],
      outcome: 'shadow-allow',
      metadata: {
        source: 'production-runtime-restart-recovery.test',
      },
    });
    equal(consumedGrant?.remainingUses, 1, 'Runtime recovery: degraded-mode grant use budget is consumed before restart');

    const second = createReleaseRuntimeBootstrap({ runtimeProfile: profile });
    equal(second.runtimeProfileDiagnostics.durability.ready, true, 'Runtime recovery: restarted runtime passes durable diagnostics');
    equal(
      second.financeReleaseDecisionLog.verify().valid,
      true,
      'Runtime recovery: decision log hash chain verifies after restart',
    );
    ok(
      second.financeReleaseDecisionLog.entries().some(
        (entry) => entry.decisionId === recordWithToken.releaseDecision.id,
      ),
      'Runtime recovery: decision log reloads the accepted release decision',
    );
    equal(
      second.apiReleaseReviewerQueueStore.getRecord(recordWithToken.detail.id)?.detail.issuedReleaseToken?.tokenId,
      issuedToken.tokenId,
      'Runtime recovery: reviewer queue reloads issued token linkage',
    );
    equal(
      second.apiReleaseIntrospectionStore.findToken(issuedToken.tokenId)?.status,
      'issued',
      'Runtime recovery: token introspection reloads issued token state',
    );
    equal(
      second.apiReleaseEvidencePackStore.get(issuedEvidencePack.evidencePack.id)?.bundleDigest,
      issuedEvidencePack.bundleDigest,
      'Runtime recovery: evidence pack reloads with bundle digest intact',
    );
    equal(
      second.policyControlPlaneStore.getMetadata()?.latestActivationId,
      sentinelActivationId,
      'Runtime recovery: policy control-plane metadata survives restart',
    );
    ok(
      second.policyControlPlaneStore.listBundles().some(
        (bundle) => bundle.bundleId === policyBundleRecord!.bundleId,
      ),
      'Runtime recovery: policy bundle state survives restart',
    );
    equal(
      second.policyActivationApprovalStore.get(approvalRequest.id)?.state,
      'approved',
      'Runtime recovery: policy activation approval state survives restart',
    );
    equal(
      second.policyMutationAuditLog.verify().valid,
      true,
      'Runtime recovery: policy mutation audit chain verifies after restart',
    );
    equal(
      second.policyMutationAuditLog.entries().at(-1)?.entryDigest,
      auditEntry.entryDigest,
      'Runtime recovery: policy mutation audit head survives restart',
    );
    equal(
      second.apiReleaseDegradedModeGrantStore.findGrant(grant.id)?.remainingUses,
      1,
      'Runtime recovery: degraded-mode grant state survives restart',
    );
    ok(
      second.apiReleaseDegradedModeGrantStore.listAuditRecords().some(
        (entry) => entry.grantId === grant.id && entry.action === 'grant-used',
      ),
      'Runtime recovery: degraded-mode grant audit records survive restart',
    );
    equal(
      second.apiReleaseDegradedModeGrantStore.auditHead(),
      first.apiReleaseDegradedModeGrantStore.auditHead(),
      'Runtime recovery: degraded-mode audit head is stable across restart',
    );
  } finally {
    restoreEnvironment(previousEnv);
    rmSync(root, { recursive: true, force: true });
  }

  console.log(`production runtime restart recovery tests passed (${passed} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
