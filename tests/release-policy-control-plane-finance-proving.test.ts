import { strict as assert } from 'node:assert';
import {
  buildFinanceActionReleaseMaterial,
  buildFinanceActionReleaseObservation,
  createFinanceActionReleaseCandidateFromReport,
} from '../src/release-kernel/finance-action-release.js';
import {
  buildFinanceCommunicationReleaseMaterial,
  buildFinanceCommunicationReleaseObservation,
  createFinanceCommunicationReleaseCandidateFromReport,
} from '../src/release-kernel/finance-communication-release.js';
import {
  buildFinanceFilingReleaseMaterial,
  buildFinanceFilingReleaseObservation,
  createFinanceFilingReleaseCandidateFromReport,
} from '../src/release-kernel/finance-record-release.js';
import { createShadowModeReleaseEvaluator } from '../src/release-kernel/release-shadow-mode.js';
import { freezePolicyActivationScope } from '../src/release-policy-control-plane/activation-records.js';
import {
  createFinanceControlPlaneReleaseDecisionEngine,
  createFinancePolicyActivationTarget,
  ensureFinanceProvingPolicies,
} from '../src/release-policy-control-plane/finance-proving.js';
import { createInMemoryPolicyControlPlaneStore } from '../src/release-policy-control-plane/store.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function makeFinanceReport(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'api-finance-control-plane',
    decision: 'pass',
    certificate: { certificateId: 'cert_finance_control_plane' },
    evidenceChain: { terminalHash: 'control_plane_chain_terminal', intact: true },
    execution: {
      success: true,
      rows: [
        {
          counterparty_name: 'Bank of Nova Scotia',
          exposure_usd: 250000000,
          credit_rating: 'AA-',
          sector: 'Banking',
        },
      ],
    },
    liveProof: {
      mode: 'live_runtime',
      consistent: true,
    },
    receipt: {
      receiptStatus: 'issued',
    },
    oversight: {
      status: 'not_required',
    },
    escrow: {
      state: 'released',
    },
    filingReadiness: {
      status: 'internal_report_ready',
      blockingGaps: 0,
    },
    dossier: {
      reviewerSummary: [
        {
          category: 'policy',
          status: 'pass',
          detail: 'No blocking policy findings.',
        },
      ],
    },
    audit: {
      chainIntact: true,
    },
    attestation: {
      manifestHash: 'manifest_hash',
    },
    ...overrides,
  } as any;
}

function recordEvaluationInput() {
  const report = makeFinanceReport();
  const candidate = createFinanceFilingReleaseCandidateFromReport(report);
  const material = buildFinanceFilingReleaseMaterial(candidate!);
  return {
    report,
    material,
    observation: buildFinanceFilingReleaseObservation(material, report),
    request: {
      id: 'finance-record-control-plane',
      createdAt: '2026-04-18T12:00:00.000Z',
      outputHash: material.hashBundle.outputHash,
      consequenceHash: material.hashBundle.consequenceHash,
      outputContract: material.outputContract,
      capabilityBoundary: material.capabilityBoundary,
      requester: {
        id: 'svc.attestor.api',
        type: 'service' as const,
      },
      target: material.target,
    },
  };
}

function testFinanceSeedPublishesBundleAndScopedActivations(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  const seeded = ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:00:00.000Z',
  });

  equal(seeded.bundleRecord.manifest.entries.length, 3, 'Finance proving seed: one signed bundle carries all three proving policies');
  equal(
    seeded.activations.filter((activation) => activation.created).length,
    3,
    'Finance proving seed: first seed creates record, communication, and action activations',
  );
  equal(
    store.getMetadata()?.discoveryMode,
    'scoped-active',
    'Finance proving seed: control plane defaults runtime finance policy resolution to scoped-active discovery',
  );
}

function testFinanceSeedIsIdempotentForExistingExactTargets(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:00:00.000Z',
  });
  const seededAgain = ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:05:00.000Z',
  });

  equal(
    seededAgain.activations.filter((activation) => activation.created).length,
    0,
    'Finance proving seed: rerunning the seed does not replace existing active exact-scope activations',
  );
}

function testRecordFlowResolvesPolicyThroughControlPlane(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:00:00.000Z',
  });
  const engine = createFinanceControlPlaneReleaseDecisionEngine({
    store,
    flow: 'record',
    environment: 'api-runtime',
  });
  const input = recordEvaluationInput();
  const evaluation = engine.evaluateWithDeterministicChecks(
    input.request,
    input.observation,
  );

  equal(
    evaluation.decision.policyVersion,
    'finance.structured-record-release.v1',
    'Finance proving runtime: record release now resolves the structured record policy from the control plane',
  );
  equal(
    evaluation.decision.status,
    'review-required',
    'Finance proving runtime: the control-plane-backed record policy preserves the existing regulated review posture',
  );
}

function testCommunicationShadowStillResolvesDryRunPolicy(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:00:00.000Z',
  });
  const report = makeFinanceReport();
  const candidate = createFinanceCommunicationReleaseCandidateFromReport(report);
  const material = buildFinanceCommunicationReleaseMaterial(candidate!);
  const observation = buildFinanceCommunicationReleaseObservation(material, report);
  const shadow = createShadowModeReleaseEvaluator({
    engine: createFinanceControlPlaneReleaseDecisionEngine({
      store,
      flow: 'communication',
      environment: 'api-runtime',
    }),
  }).evaluate(
    {
      id: 'finance-communication-control-plane',
      createdAt: '2026-04-18T12:10:00.000Z',
      outputHash: material.hashBundle.outputHash,
      consequenceHash: material.hashBundle.consequenceHash,
      outputContract: material.outputContract,
      capabilityBoundary: material.capabilityBoundary,
      requester: {
        id: 'svc.attestor.api',
        type: 'service',
      },
      target: material.target,
    },
    observation,
  );

  equal(
    shadow.policyRolloutMode,
    'dry-run',
    'Finance proving runtime: communication flow still resolves the dry-run rollout through the control plane',
  );
}

function testFrozenRecordScopeFailsClosedAtRuntime(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:00:00.000Z',
  });
  freezePolicyActivationScope(store, {
    id: 'freeze.finance-record',
    target: createFinancePolicyActivationTarget('record', 'api-runtime'),
    activatedBy: {
      id: 'incident-commander',
      type: 'user',
      displayName: 'Incident Commander',
      role: 'incident-commander',
    },
    activatedAt: '2026-04-18T12:20:00.000Z',
    freezeReason: 'incident-containment',
    rationale: 'Pause regulated finance record releases while the bundle is investigated.',
    reasonCode: 'incident',
  });

  const engine = createFinanceControlPlaneReleaseDecisionEngine({
    store,
    flow: 'record',
    environment: 'api-runtime',
  });
  const input = recordEvaluationInput();
  const evaluation = engine.evaluateWithDeterministicChecks(
    input.request,
    input.observation,
  );

  equal(
    evaluation.decision.status,
    'denied',
    'Finance proving runtime: a frozen record scope now blocks the finance release path fail-closed',
  );
  ok(
    evaluation.decision.findings.some((finding) => finding.code === 'policy_scope_frozen'),
    'Finance proving runtime: frozen-scope denials are explicit in the runtime findings',
  );
}

function testActionShadowStillRequiresNamedReview(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:00:00.000Z',
  });
  const report = makeFinanceReport();
  const candidate = createFinanceActionReleaseCandidateFromReport(report);
  const material = buildFinanceActionReleaseMaterial(candidate);
  const observation = buildFinanceActionReleaseObservation(material, report);
  const shadow = createShadowModeReleaseEvaluator({
    engine: createFinanceControlPlaneReleaseDecisionEngine({
      store,
      flow: 'action',
      environment: 'api-runtime',
    }),
  }).evaluate(
    {
      id: 'finance-action-control-plane',
      createdAt: '2026-04-18T12:30:00.000Z',
      outputHash: material.hashBundle.outputHash,
      consequenceHash: material.hashBundle.consequenceHash,
      outputContract: material.outputContract,
      capabilityBoundary: material.capabilityBoundary,
      requester: {
        id: 'svc.attestor.api',
        type: 'service',
      },
      target: material.target,
    },
    observation,
  );

  equal(
    shadow.wouldRequireReview,
    true,
    'Finance proving runtime: action flow still surfaces named-review requirements after moving policy resolution to the control plane',
  );
}

function run(): void {
  testFinanceSeedPublishesBundleAndScopedActivations();
  testFinanceSeedIsIdempotentForExistingExactTargets();
  testRecordFlowResolvesPolicyThroughControlPlane();
  testCommunicationShadowStillResolvesDryRunPolicy();
  testFrozenRecordScopeFailsClosedAtRuntime();
  testActionShadowStillRequiresNamedReview();
  console.log(`Release policy control-plane finance-proving tests: ${passed} passed, 0 failed`);
}

run();
