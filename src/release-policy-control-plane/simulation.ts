import { createPolicyControlPlaneMetadata } from './object-model.js';
import { activatePolicyBundle } from './activation-records.js';
import {
  resolveActivePolicy,
  type ActivePolicyResolverInput,
  type ActivePolicyResolutionResult,
} from './resolver.js';
import type { StoredPolicyBundleRecord, PolicyControlPlaneStore } from './store.js';
import { createInMemoryPolicyControlPlaneStoreFromSnapshot } from './store.js';
import type { PolicyActivationTarget, PolicyDiscoveryMode } from './types.js';
import type { ReleaseActorReference } from '../release-layer/index.js';

/**
 * Policy simulation and dry-run API.
 *
 * Step 10 gives operators a way to ask "what would this policy do?" without
 * mutating the live control-plane store. The implementation clones the current
 * snapshot into an isolated in-memory store, overlays a candidate bundle +
 * activation posture, and resolves policy exactly as the active resolver would.
 */

export const POLICY_SIMULATION_SPEC_VERSION =
  'attestor.policy-simulation.v1';

export interface DryRunPolicyActivationOverlay {
  readonly bundleRecord: StoredPolicyBundleRecord;
  readonly target: PolicyActivationTarget;
  readonly discoveryMode?: PolicyDiscoveryMode;
  readonly activationId?: string;
  readonly actor?: ReleaseActorReference;
  readonly activatedAt?: string;
  readonly reasonCode?: string;
  readonly rationale?: string;
}

export interface PolicySimulationDelta {
  readonly changed: boolean;
  readonly statusChanged: boolean;
  readonly bundleChanged: boolean;
  readonly policyChanged: boolean;
  readonly rolloutChanged: boolean;
}

export interface PolicyDryRunResult {
  readonly version: typeof POLICY_SIMULATION_SPEC_VERSION;
  readonly current: ActivePolicyResolutionResult;
  readonly simulated: ActivePolicyResolutionResult;
  readonly delta: PolicySimulationDelta;
}

export interface PolicySimulationApi {
  resolveCurrent(input: ActivePolicyResolverInput): ActivePolicyResolutionResult;
  dryRunCandidateActivation(
    input: ActivePolicyResolverInput,
    overlay: DryRunPolicyActivationOverlay,
  ): PolicyDryRunResult;
}

function resolveActivatedAt(value?: string): string {
  const timestamp = value ? new Date(value) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Policy simulation requires a valid activatedAt timestamp.');
  }
  return timestamp.toISOString();
}

function defaultSimulationActor(): ReleaseActorReference {
  return Object.freeze({
    id: 'attestor.policy-simulator',
    type: 'system',
    displayName: 'Attestor Policy Simulator',
    role: 'policy-simulator',
  });
}

function resolveDiscoveryMode(
  store: PolicyControlPlaneStore,
  overlay: DryRunPolicyActivationOverlay,
): PolicyDiscoveryMode {
  return overlay.discoveryMode ?? store.getMetadata()?.discoveryMode ?? 'scoped-active';
}

function deriveOverlayRolloutMode(
  overlay: DryRunPolicyActivationOverlay,
): 'enforce' | 'dry-run' | 'canary' | 'rolled-back' {
  const rolloutModes = new Set(
    overlay.bundleRecord.artifact.statement.predicate.entries.map(
      (entry) => entry.rollout.mode,
    ),
  );

  if (rolloutModes.size === 1) {
    return [...rolloutModes][0]!;
  }

  // Mixed-entry bundles still resolve per-entry rollout at evaluation time.
  // The activation lifecycle record only needs a stable target-level posture.
  return 'enforce';
}

function applyDryRunOverlay(
  store: PolicyControlPlaneStore,
  overlay: DryRunPolicyActivationOverlay,
): void {
  const pack = overlay.bundleRecord.artifact.statement.predicate.pack;
  const manifest = overlay.bundleRecord.manifest;

  store.upsertPack({
    ...pack,
    latestBundleRef: manifest.bundle,
    updatedAt: overlay.bundleRecord.storedAt,
  });
  store.upsertBundle({
    manifest,
    artifact: overlay.bundleRecord.artifact,
    signedBundle: overlay.bundleRecord.signedBundle,
    verificationKey: overlay.bundleRecord.verificationKey,
    storedAt: overlay.bundleRecord.storedAt,
  });

  const discoveryMode = resolveDiscoveryMode(store, overlay);
  const metadata = store.getMetadata();
  if (discoveryMode === 'static') {
    store.setMetadata(
      createPolicyControlPlaneMetadata(
        metadata?.storeKind ?? store.kind,
        'static',
        manifest.bundle,
        metadata?.latestActivationId ?? null,
      ),
    );
    return;
  }

  const lifecycle = activatePolicyBundle(store, {
    id: overlay.activationId ?? `simulation_${manifest.bundle.bundleId}`,
    target: overlay.target,
    bundle: manifest.bundle,
    activatedBy: overlay.actor ?? defaultSimulationActor(),
    activatedAt: resolveActivatedAt(overlay.activatedAt),
    rolloutMode: deriveOverlayRolloutMode(overlay),
    reasonCode: overlay.reasonCode ?? 'dry-run-simulation',
    rationale:
      overlay.rationale ??
      'Simulate candidate policy activation without mutating the persistent control plane.',
  });
  store.setMetadata(
    createPolicyControlPlaneMetadata(
      metadata?.storeKind ?? store.kind,
      discoveryMode,
      manifest.bundle,
      lifecycle.appliedRecord.id,
    ),
  );
}

function createSimulationDelta(
  current: ActivePolicyResolutionResult,
  simulated: ActivePolicyResolutionResult,
): PolicySimulationDelta {
  const statusChanged = current.status !== simulated.status;
  const bundleChanged =
    current.bundleRecord?.bundleId !== simulated.bundleRecord?.bundleId ||
    current.bundleRecord?.packId !== simulated.bundleRecord?.packId;
  const policyChanged =
    current.effectivePolicy?.id !== simulated.effectivePolicy?.id;
  const rolloutChanged =
    current.rollout?.rolloutMode !== simulated.rollout?.rolloutMode ||
    current.rollout?.evaluationMode !== simulated.rollout?.evaluationMode;

  return Object.freeze({
    changed:
      statusChanged || bundleChanged || policyChanged || rolloutChanged,
    statusChanged,
    bundleChanged,
    policyChanged,
    rolloutChanged,
  });
}

export function dryRunCandidatePolicyActivation(
  store: PolicyControlPlaneStore,
  input: ActivePolicyResolverInput,
  overlay: DryRunPolicyActivationOverlay,
): PolicyDryRunResult {
  const current = resolveActivePolicy(store, input);
  const simulationStore = createInMemoryPolicyControlPlaneStoreFromSnapshot(
    store.exportSnapshot(),
  );
  applyDryRunOverlay(simulationStore, overlay);
  const simulated = resolveActivePolicy(simulationStore, input);

  return Object.freeze({
    version: POLICY_SIMULATION_SPEC_VERSION,
    current,
    simulated,
    delta: createSimulationDelta(current, simulated),
  });
}

export function createPolicySimulationApi(
  store: PolicyControlPlaneStore,
): PolicySimulationApi {
  return {
    resolveCurrent(input: ActivePolicyResolverInput): ActivePolicyResolutionResult {
      return resolveActivePolicy(store, input);
    },
    dryRunCandidateActivation(
      input: ActivePolicyResolverInput,
      overlay: DryRunPolicyActivationOverlay,
    ): PolicyDryRunResult {
      return dryRunCandidatePolicyActivation(store, input, overlay);
    },
  };
}
