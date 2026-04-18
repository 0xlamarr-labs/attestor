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
import {
  activatePolicyBundle,
  freezePolicyActivationScope,
} from '../src/release-policy-control-plane/activation-records.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyBundleSigner } from '../src/release-policy-control-plane/bundle-signing.js';
import {
  createFinanceControlPlaneReleaseDecisionEngine,
  type FinancePolicyScopeOverrides,
  type FinanceProvingFlow,
  createFinancePolicyActivationTarget,
  ensureFinanceProvingPolicies,
  FINANCE_PROVING_POLICY_PACK_ID,
} from '../src/release-policy-control-plane/finance-proving.js';
import {
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyPackMetadata,
} from '../src/release-policy-control-plane/object-model.js';
import { createInMemoryPolicyControlPlaneStore } from '../src/release-policy-control-plane/store.js';
import { generateKeyPair } from '../src/signing/keys.js';
import { policy } from '../src/release-layer/index.js';

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

function scopedFinanceOverrideBundle(
  flow: FinanceProvingFlow,
  scope: FinancePolicyScopeOverrides,
  bundleId: string,
  policyId: string,
) {
  const baseDefinition = policy.createFirstHardGatewayReleasePolicy();
  const overrideDefinition = policy.createReleasePolicyDefinition({
    id: policyId,
    name: `${baseDefinition.name} scoped override`,
    status: baseDefinition.status,
    rollout: {
      mode: 'enforce',
      activatedAt: '2026-04-18T12:35:00.000Z',
      notes: [
        `Scoped ${flow} rollout override served through the policy control plane.`,
      ],
    },
    scope: baseDefinition.scope,
    outputContract: baseDefinition.outputContract,
    capabilityBoundary: baseDefinition.capabilityBoundary,
    acceptance: baseDefinition.acceptance,
    release: baseDefinition.release,
    notes: [...baseDefinition.notes, `Scoped ${flow} override.`],
  });
  const target = createFinancePolicyActivationTarget(flow, 'api-runtime', scope);
  const provisional = createPolicyBundleEntry({
    id: `${bundleId}-entry`,
    scopeTarget: target,
    definition: overrideDefinition,
    policyHash: 'sha256:placeholder',
  });
  const entry = createPolicyBundleEntry({
    id: provisional.id,
    scopeTarget: target,
    definition: overrideDefinition,
    policyHash: computePolicyBundleEntryDigest(provisional),
  });
  const bundle = {
    packId: FINANCE_PROVING_POLICY_PACK_ID,
    bundleId,
    bundleVersion: bundleId.replaceAll('_', '.'),
    digest: `sha256:${bundleId}`,
  } as const;
  const pack = createPolicyPackMetadata({
    id: FINANCE_PROVING_POLICY_PACK_ID,
    name: 'Finance proving release policies',
    description: 'Scoped finance proving rollout overrides.',
    lifecycleState: 'published',
    owners: ['attestor-finance'],
    labels: ['finance', 'proving', 'release-gateway', 'rollout'],
    createdAt: '2026-04-18T12:34:00.000Z',
    updatedAt: '2026-04-18T12:35:00.000Z',
    latestBundleRef: bundle,
  });
  const manifest = createPolicyBundleManifest({
    bundle,
    pack,
    generatedAt: '2026-04-18T12:35:00.000Z',
    bundleLabels: ['finance', 'proving', 'rollout'],
    entries: [entry],
  });
  const artifact = createSignablePolicyBundleArtifact(pack, manifest);
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane.finance-proving.test',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });

  return {
    pack,
    manifest,
    artifact,
    signedBundle: signer.sign({
      artifact,
      signedAt: '2026-04-18T12:35:30.000Z',
    }),
    verificationKey: signer.exportVerificationKey(),
  };
}

function activateScopedFinanceOverride(
  store: ReturnType<typeof createInMemoryPolicyControlPlaneStore>,
  flow: FinanceProvingFlow,
  scope: FinancePolicyScopeOverrides,
  bundleId: string,
  policyId: string,
): void {
  const bundle = scopedFinanceOverrideBundle(flow, scope, bundleId, policyId);
  store.upsertPack(bundle.pack);
  store.upsertBundle({
    manifest: bundle.manifest,
    artifact: bundle.artifact,
    signedBundle: bundle.signedBundle,
    verificationKey: bundle.verificationKey,
    storedAt: '2026-04-18T12:35:45.000Z',
  });
  activatePolicyBundle(store, {
    id: `activation.${bundleId}`,
    target: createFinancePolicyActivationTarget(flow, 'api-runtime', scope),
    bundle: bundle.manifest.bundle,
    activatedBy: {
      id: 'policy-rollout-admin',
      type: 'user',
      displayName: 'Policy Rollout Admin',
      role: 'policy-admin',
    },
    activatedAt: '2026-04-18T12:36:00.000Z',
    rolloutMode: 'enforce',
    reasonCode: 'progressive-rollout',
    rationale: `Activate scoped finance ${flow} override for controlled rollout.`,
  });
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

function testRecordFlowUsesTenantScopedBundleOverride(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:00:00.000Z',
  });
  activateScopedFinanceOverride(
    store,
    'record',
    { tenantId: 'tenant-pilot', planId: 'enterprise' },
    'bundle_finance_tenant_pilot_record',
    'finance.structured-record-release.tenant-pilot.v1',
  );

  const engine = createFinanceControlPlaneReleaseDecisionEngine({
    store,
    flow: 'record',
    environment: 'api-runtime',
  });
  const input = recordEvaluationInput();
  const tenantPilotEvaluation = engine.evaluateWithDeterministicChecks(
    {
      ...input.request,
      context: {
        tenantId: 'tenant-pilot',
        planId: 'enterprise',
      },
    },
    input.observation,
  );
  const defaultEvaluation = engine.evaluateWithDeterministicChecks(
    {
      ...input.request,
      context: {
        tenantId: 'tenant-general',
        planId: 'enterprise',
      },
    },
    input.observation,
  );

  equal(
    tenantPilotEvaluation.decision.policyVersion,
    'finance.structured-record-release.tenant-pilot.v1',
    'Finance proving runtime: tenant context now selects a tenant-scoped bundle override when one is active',
  );
  equal(
    defaultEvaluation.decision.policyVersion,
    'finance.structured-record-release.v1',
    'Finance proving runtime: tenants outside the rollout keep resolving the global proving policy',
  );
}

function testRecordFlowUsesCohortScopedBundleOverride(): void {
  const store = createInMemoryPolicyControlPlaneStore();
  ensureFinanceProvingPolicies(store, {
    environment: 'api-runtime',
    activatedAt: '2026-04-18T11:00:00.000Z',
  });
  activateScopedFinanceOverride(
    store,
    'record',
    { cohortId: 'wave-a' },
    'bundle_finance_wave_a_record',
    'finance.structured-record-release.wave-a.v1',
  );

  const engine = createFinanceControlPlaneReleaseDecisionEngine({
    store,
    flow: 'record',
    environment: 'api-runtime',
  });
  const input = recordEvaluationInput();
  const waveAEvaluation = engine.evaluateWithDeterministicChecks(
    {
      ...input.request,
      context: {
        tenantId: 'tenant-finance',
        cohortId: 'wave-a',
      },
    },
    input.observation,
  );
  const waveBEvaluation = engine.evaluateWithDeterministicChecks(
    {
      ...input.request,
      context: {
        tenantId: 'tenant-finance',
        cohortId: 'wave-b',
      },
    },
    input.observation,
  );

  equal(
    waveAEvaluation.decision.policyVersion,
    'finance.structured-record-release.wave-a.v1',
    'Finance proving runtime: cohort context now selects a cohort-scoped bundle override during progressive rollout',
  );
  equal(
    waveBEvaluation.decision.policyVersion,
    'finance.structured-record-release.v1',
    'Finance proving runtime: requests outside the rollout cohort keep the default bundle selection',
  );
}

function run(): void {
  testFinanceSeedPublishesBundleAndScopedActivations();
  testFinanceSeedIsIdempotentForExistingExactTargets();
  testRecordFlowResolvesPolicyThroughControlPlane();
  testCommunicationShadowStillResolvesDryRunPolicy();
  testFrozenRecordScopeFailsClosedAtRuntime();
  testActionShadowStillRequiresNamedReview();
  testRecordFlowUsesTenantScopedBundleOverride();
  testRecordFlowUsesCohortScopedBundleOverride();
  console.log(`Release policy control-plane finance-proving tests: ${passed} passed, 0 failed`);
}

run();
