import { createHash } from 'node:crypto';
import { generateKeyPair } from '../signing/keys.js';
import { policy, type ReleaseActorReference } from '../release-layer/index.js';
import type {
  ReleaseDecisionEngine,
  ReleaseEvaluationRequest,
} from '../release-kernel/release-decision-engine.js';
import type { ReleaseDecisionLogWriter } from '../release-kernel/release-decision-log.js';
import {
  activatePolicyBundle,
} from './activation-records.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from './bundle-format.js';
import { createPolicyBundleSigner } from './bundle-signing.js';
import {
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyControlPlaneMetadata,
  createPolicyPackMetadata,
  type PolicyActivationRecord,
  type PolicyBundleEntry,
} from './object-model.js';
import type { PolicyControlPlaneStore, StoredPolicyBundleRecord } from './store.js';
import {
  createPolicyActivationTarget,
  policyActivationTargetLabel,
  type PolicyActivationTarget,
  type PolicyBundleReference,
} from './types.js';
import { createControlPlaneBackedReleaseDecisionEngine } from './runtime.js';

/**
 * Finance proving-policy bundle and runtime wiring.
 *
 * Step 18 moves the finance record, communication, and action proving policies
 * behind the control plane. This module owns the seed pack/bundle, the scoped
 * activation targets, and the runtime engine adapters that resolve policy from
 * the control plane instead of from direct in-process factory selection.
 */

export const FINANCE_PROVING_POLICY_CONTROL_PLANE_SPEC_VERSION =
  'attestor.finance-proving-policy-control-plane.v1';
export const FINANCE_PROVING_POLICY_PACK_ID = 'finance-proving-core';
export const FINANCE_PROVING_POLICY_BUNDLE_ID = 'bundle_finance_proving_core';
export const FINANCE_PROVING_POLICY_BUNDLE_VERSION =
  '2026.04.18.finance-proving.v1';
export const FINANCE_PROVING_POLICY_ENVIRONMENT = 'api-runtime';
export const FINANCE_PROVING_POLICY_ISSUER =
  'attestor.policy-control-plane.finance-proving';

export type FinanceProvingFlow = 'record' | 'communication' | 'action';

export interface EnsureFinanceProvingPoliciesInput {
  readonly environment?: string;
  readonly actor?: ReleaseActorReference;
  readonly activatedAt?: string;
}

export interface FinanceProvingSeedActivation {
  readonly flow: FinanceProvingFlow;
  readonly created: boolean;
  readonly activationId: string;
  readonly state: PolicyActivationRecord['state'];
  readonly targetLabel: string;
}

export interface FinanceProvingSeedResult {
  readonly version: typeof FINANCE_PROVING_POLICY_CONTROL_PLANE_SPEC_VERSION;
  readonly environment: string;
  readonly bundleCreated: boolean;
  readonly bundleRecord: StoredPolicyBundleRecord;
  readonly activations: readonly FinanceProvingSeedActivation[];
}

export interface CreateFinanceControlPlaneReleaseDecisionEngineInput {
  readonly store: PolicyControlPlaneStore;
  readonly flow: FinanceProvingFlow;
  readonly environment?: string;
  readonly decisionLog?: ReleaseDecisionLogWriter;
}

export interface FinancePolicyScopeOverrides {
  readonly tenantId?: string | null;
  readonly accountId?: string | null;
  readonly cohortId?: string | null;
  readonly planId?: string | null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function taggedDigest(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

function resolveNow(value?: string): string {
  const timestamp = value ? new Date(value) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Finance policy control-plane seed requires a valid ISO timestamp.');
  }
  return timestamp.toISOString();
}

function defaultSeedActor(): ReleaseActorReference {
  return Object.freeze({
    id: 'attestor.finance.policy-seed',
    type: 'system',
    displayName: 'Attestor Finance Policy Seed',
    role: 'policy-seed',
  });
}

function financePolicyDefinition(flow: FinanceProvingFlow) {
  switch (flow) {
    case 'record':
      return policy.createFirstHardGatewayReleasePolicy();
    case 'communication':
      return policy.createFinanceCommunicationReleasePolicy();
    case 'action':
      return policy.createFinanceActionReleasePolicy();
  }
}

function financePolicyFlows(): readonly FinanceProvingFlow[] {
  return Object.freeze(['record', 'communication', 'action']);
}

function financePolicyTarget(
  flow: FinanceProvingFlow,
  environment = FINANCE_PROVING_POLICY_ENVIRONMENT,
  scopeOverrides: FinancePolicyScopeOverrides = {},
): PolicyActivationTarget {
  const definition = financePolicyDefinition(flow);
  return createPolicyActivationTarget({
    environment,
    tenantId: scopeOverrides.tenantId,
    accountId: scopeOverrides.accountId,
    domainId: 'finance',
    wedgeId: definition.scope.wedgeId,
    consequenceType: definition.scope.consequenceType,
    riskClass: definition.scope.riskClass,
    cohortId: scopeOverrides.cohortId,
    planId: scopeOverrides.planId,
  });
}

function normalizeOptionalScopeValue(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveTenantIdFromRequester(request: ReleaseEvaluationRequest): string | null {
  if (
    request.requester.type === 'service' &&
    request.requester.id.startsWith('tenant:')
  ) {
    return normalizeOptionalScopeValue(request.requester.id.slice('tenant:'.length));
  }

  return null;
}

function resolvePlanIdFromRequester(request: ReleaseEvaluationRequest): string | null {
  if (request.requester.type !== 'service') {
    return null;
  }

  const normalizedRole = normalizeOptionalScopeValue(request.requester.role);
  return normalizedRole && normalizedRole !== 'service' ? normalizedRole : null;
}

function resolveFinancePolicyScopeFromRequest(
  request: ReleaseEvaluationRequest,
): FinancePolicyScopeOverrides {
  return Object.freeze({
    tenantId:
      normalizeOptionalScopeValue(request.context?.tenantId) ??
      resolveTenantIdFromRequester(request),
    accountId: normalizeOptionalScopeValue(request.context?.accountId),
    cohortId: normalizeOptionalScopeValue(request.context?.cohortId),
    planId:
      normalizeOptionalScopeValue(request.context?.planId) ??
      resolvePlanIdFromRequester(request),
  });
}

function financePolicyEntryId(flow: FinanceProvingFlow): string {
  return `finance-proving-${flow}-entry`;
}

function financePolicyActivationId(flow: FinanceProvingFlow): string {
  return `activation.finance-proving.${flow}`;
}

function createFinancePolicyEntry(
  flow: FinanceProvingFlow,
  environment: string,
): PolicyBundleEntry {
  const definition = financePolicyDefinition(flow);
  const scopeTarget = financePolicyTarget(flow, environment);
  const provisional = createPolicyBundleEntry({
    id: financePolicyEntryId(flow),
    scopeTarget,
    definition,
    policyHash: 'sha256:placeholder',
  });

  return createPolicyBundleEntry({
    id: provisional.id,
    scopeTarget,
    definition,
    policyHash: computePolicyBundleEntryDigest(provisional),
  });
}

function financeBundleReference(
  entries: readonly PolicyBundleEntry[],
): PolicyBundleReference {
  return Object.freeze({
    packId: FINANCE_PROVING_POLICY_PACK_ID,
    bundleId: FINANCE_PROVING_POLICY_BUNDLE_ID,
    bundleVersion: FINANCE_PROVING_POLICY_BUNDLE_VERSION,
    digest: taggedDigest(
      JSON.stringify(
        entries.map((entry) => ({
          id: entry.id,
          policyId: entry.policyId,
          policyHash: entry.policyHash,
          environment: entry.scope.environment,
        })),
      ),
    ),
  });
}

function createFinancePolicyPackMetadata(
  createdAt: string,
  updatedAt: string,
  bundleRef: PolicyBundleReference,
) {
  return createPolicyPackMetadata({
    id: FINANCE_PROVING_POLICY_PACK_ID,
    name: 'Finance proving release policies',
    description:
      'Signed finance record, communication, and action proving policies served through the Attestor policy control plane.',
    lifecycleState: 'published',
    owners: ['attestor-finance'],
    labels: ['finance', 'proving', 'release-gateway'],
    createdAt,
    updatedAt,
    latestBundleRef: bundleRef,
  });
}

function existingActivationForTarget(
  store: PolicyControlPlaneStore,
  target: PolicyActivationTarget,
): PolicyActivationRecord | null {
  const targetLabel = policyActivationTargetLabel(target);
  return (
    store
      .listActivations()
      .find(
        (record) =>
          record.targetLabel === targetLabel &&
          (record.state === 'active' || record.state === 'frozen'),
      ) ?? null
  );
}

function bundleMatchesEnvironment(
  record: StoredPolicyBundleRecord,
  environment: string,
): boolean {
  const entries = record.artifact.statement.predicate.entries;
  return (
    entries.length === financePolicyFlows().length &&
    entries.every((entry) => entry.scope.environment === environment)
  );
}

function publishFinanceProvingBundle(
  store: PolicyControlPlaneStore,
  environment: string,
  now: string,
): StoredPolicyBundleRecord {
  const entries = financePolicyFlows().map((flow) =>
    createFinancePolicyEntry(flow, environment),
  );
  const bundleRef = financeBundleReference(entries);
  const existingPack = store.getPack(FINANCE_PROVING_POLICY_PACK_ID);
  const pack = createFinancePolicyPackMetadata(
    existingPack?.createdAt ?? now,
    now,
    bundleRef,
  );
  const manifest = createPolicyBundleManifest({
    bundle: bundleRef,
    pack,
    generatedAt: now,
    bundleLabels: ['finance', 'proving', 'release-gateway'],
    entries,
  });
  const artifact = createSignablePolicyBundleArtifact(pack, manifest);
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: FINANCE_PROVING_POLICY_ISSUER,
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const signedBundle = signer.sign({
    artifact,
    signedAt: now,
  });

  store.upsertPack(pack);
  return store.upsertBundle({
    manifest,
    artifact,
    signedBundle,
    verificationKey: signer.exportVerificationKey(),
    storedAt: now,
  });
}

export function createFinancePolicyActivationTarget(
  flow: FinanceProvingFlow,
  environment = FINANCE_PROVING_POLICY_ENVIRONMENT,
  scopeOverrides: FinancePolicyScopeOverrides = {},
): PolicyActivationTarget {
  return financePolicyTarget(flow, environment, scopeOverrides);
}

export function ensureFinanceProvingPolicies(
  store: PolicyControlPlaneStore,
  input: EnsureFinanceProvingPoliciesInput = {},
): FinanceProvingSeedResult {
  const environment = input.environment ?? FINANCE_PROVING_POLICY_ENVIRONMENT;
  const now = resolveNow(input.activatedAt);
  const actor = input.actor ?? defaultSeedActor();
  const existingBundle =
    store.getBundle(FINANCE_PROVING_POLICY_PACK_ID, FINANCE_PROVING_POLICY_BUNDLE_ID);
  const bundleRecord =
    existingBundle && bundleMatchesEnvironment(existingBundle, environment)
      ? existingBundle
      : publishFinanceProvingBundle(store, environment, now);
  const activations = financePolicyFlows().map((flow) => {
    const target = financePolicyTarget(flow, environment);
    const existingActivation = existingActivationForTarget(store, target);
    if (existingActivation) {
      return Object.freeze({
        flow,
        created: false,
        activationId: existingActivation.id,
        state: existingActivation.state,
        targetLabel: existingActivation.targetLabel,
      });
    }

    const lifecycle = activatePolicyBundle(store, {
      id: financePolicyActivationId(flow),
      target,
      bundle: bundleRecord.manifest.bundle,
      activatedBy: actor,
      activatedAt: now,
      rolloutMode: financePolicyDefinition(flow).rollout.mode,
      reasonCode: 'seed-finance-proving',
      rationale:
        'Seed the finance record, communication, and action proving policies into the control plane so runtime policy selection resolves through signed bundle discovery.',
    });

    return Object.freeze({
      flow,
      created: true,
      activationId: lifecycle.appliedRecord.id,
      state: lifecycle.appliedRecord.state,
      targetLabel: lifecycle.appliedRecord.targetLabel,
    });
  });

  const metadata = store.getMetadata();
  const latestActivationId =
    activations.find((activation) => activation.created)?.activationId ??
    metadata?.latestActivationId ??
    store.listActivations()[0]?.id ??
    null;

  if (
    !metadata ||
    metadata.activeBundleRef === null ||
    metadata.latestActivationId === null
  ) {
    store.setMetadata(
      createPolicyControlPlaneMetadata(
        metadata?.storeKind ?? store.kind,
        metadata?.discoveryMode ?? 'scoped-active',
        metadata?.activeBundleRef ?? bundleRecord.manifest.bundle,
        metadata?.latestActivationId ?? latestActivationId,
      ),
    );
  }

  return Object.freeze({
    version: FINANCE_PROVING_POLICY_CONTROL_PLANE_SPEC_VERSION,
    environment,
    bundleCreated: existingBundle === null || !bundleMatchesEnvironment(existingBundle, environment),
    bundleRecord,
    activations: Object.freeze(activations),
  });
}

export function createFinanceControlPlaneReleaseDecisionEngine(
  input: CreateFinanceControlPlaneReleaseDecisionEngineInput,
): ReleaseDecisionEngine {
  const environment = input.environment ?? FINANCE_PROVING_POLICY_ENVIRONMENT;
  return createControlPlaneBackedReleaseDecisionEngine({
    store: input.store,
    decisionLog: input.decisionLog,
    resolveTarget: (request) =>
      financePolicyTarget(
        input.flow,
        environment,
        resolveFinancePolicyScopeFromRequest(request),
      ),
  });
}
