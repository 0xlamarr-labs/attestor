import { vocabulary } from '../release-layer/index.js';

/**
 * Shared vocabulary for the release policy control plane.
 *
 * Step 01 intentionally stops at the language layer: it defines the stable
 * nouns and normalized target/scope grammar that later policy-pack, bundle,
 * activation, discovery, and audit code will build on.
 */

export const POLICY_CONTROL_PLANE_SPEC_VERSION =
  'attestor.release-policy-control-plane.v1';

export const POLICY_PACK_LIFECYCLE_STATES = [
  'draft',
  'validated',
  'signed',
  'published',
  'deprecated',
  'revoked',
] as const;
export type PolicyPackLifecycleState = typeof POLICY_PACK_LIFECYCLE_STATES[number];

export const POLICY_ACTIVATION_STATES = [
  'candidate',
  'active',
  'superseded',
  'rolled-back',
  'frozen',
] as const;
export type PolicyActivationState = typeof POLICY_ACTIVATION_STATES[number];

export const POLICY_DISCOVERY_MODES = [
  'static',
  'scoped-active',
  'bundle-manifest',
] as const;
export type PolicyDiscoveryMode = typeof POLICY_DISCOVERY_MODES[number];

export const POLICY_STORE_KINDS = [
  'embedded-memory',
  'file-backed',
  'postgres',
] as const;
export type PolicyStoreKind = typeof POLICY_STORE_KINDS[number];

export const POLICY_SCOPE_DIMENSIONS = [
  'environment',
  'tenant',
  'account',
  'domain',
  'wedge',
  'consequence-type',
  'risk-class',
  'plan',
] as const;
export type PolicyScopeDimension = typeof POLICY_SCOPE_DIMENSIONS[number];

export const POLICY_MUTATION_ACTIONS = [
  'create-pack',
  'publish-bundle',
  'activate-bundle',
  'rollback-activation',
  'freeze-scope',
] as const;
export type PolicyMutationAction = typeof POLICY_MUTATION_ACTIONS[number];

export type PolicyControlConsequenceType =
  (typeof vocabulary.CONSEQUENCE_TYPES)[number];
export type PolicyControlRiskClass = (typeof vocabulary.RISK_CLASSES)[number];

export interface PolicyBundleReference {
  readonly packId: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly digest: string;
}

export interface PolicyActivationTarget {
  readonly environment: string;
  readonly tenantId: string | null;
  readonly accountId: string | null;
  readonly domainId: string | null;
  readonly wedgeId: string | null;
  readonly consequenceType: PolicyControlConsequenceType | null;
  readonly riskClass: PolicyControlRiskClass | null;
  readonly planId: string | null;
}

export interface PolicyScopeSelector extends PolicyActivationTarget {
  readonly dimensions: readonly PolicyScopeDimension[];
}

export interface PolicyControlPlaneDescriptor {
  readonly version: typeof POLICY_CONTROL_PLANE_SPEC_VERSION;
  readonly storeKinds: readonly PolicyStoreKind[];
  readonly lifecycleStates: readonly PolicyPackLifecycleState[];
  readonly activationStates: readonly PolicyActivationState[];
  readonly discoveryModes: readonly PolicyDiscoveryMode[];
  readonly scopeDimensions: readonly PolicyScopeDimension[];
  readonly mutationActions: readonly PolicyMutationAction[];
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Policy control-plane ${fieldName} cannot be blank when provided.`);
  }

  return normalized;
}

function assertActivationTargetValidity(target: PolicyActivationTarget): void {
  if (!target.environment.trim()) {
    throw new Error('Policy control-plane activation target requires a non-empty environment.');
  }

  if (target.accountId !== null && target.tenantId === null) {
    throw new Error('Policy control-plane account-scoped activation also requires tenant scope.');
  }

  if (target.riskClass !== null && target.consequenceType === null) {
    throw new Error(
      'Policy control-plane risk-class targeting requires a consequence type to be set.',
    );
  }
}

export interface CreatePolicyActivationTargetInput {
  readonly environment: string;
  readonly tenantId?: string | null;
  readonly accountId?: string | null;
  readonly domainId?: string | null;
  readonly wedgeId?: string | null;
  readonly consequenceType?: PolicyControlConsequenceType | null;
  readonly riskClass?: PolicyControlRiskClass | null;
  readonly planId?: string | null;
}

export function createPolicyActivationTarget(
  input: CreatePolicyActivationTargetInput,
): PolicyActivationTarget {
  const target: PolicyActivationTarget = Object.freeze({
    environment: input.environment.trim(),
    tenantId: normalizeOptionalIdentifier(input.tenantId, 'tenantId'),
    accountId: normalizeOptionalIdentifier(input.accountId, 'accountId'),
    domainId: normalizeOptionalIdentifier(input.domainId, 'domainId'),
    wedgeId: normalizeOptionalIdentifier(input.wedgeId, 'wedgeId'),
    consequenceType: input.consequenceType ?? null,
    riskClass: input.riskClass ?? null,
    planId: normalizeOptionalIdentifier(input.planId, 'planId'),
  });

  assertActivationTargetValidity(target);
  return target;
}

export function policyScopeDimensionsForTarget(
  target: PolicyActivationTarget,
): readonly PolicyScopeDimension[] {
  const dimensions: PolicyScopeDimension[] = ['environment'];

  if (target.tenantId) {
    dimensions.push('tenant');
  }
  if (target.accountId) {
    dimensions.push('account');
  }
  if (target.domainId) {
    dimensions.push('domain');
  }
  if (target.wedgeId) {
    dimensions.push('wedge');
  }
  if (target.consequenceType) {
    dimensions.push('consequence-type');
  }
  if (target.riskClass) {
    dimensions.push('risk-class');
  }
  if (target.planId) {
    dimensions.push('plan');
  }

  return Object.freeze(dimensions);
}

export function createPolicyScopeSelector(
  target: PolicyActivationTarget,
): PolicyScopeSelector {
  return Object.freeze({
    ...target,
    dimensions: policyScopeDimensionsForTarget(target),
  });
}

export function policyActivationTargetLabel(target: PolicyActivationTarget): string {
  const segments = [`env:${target.environment}`];

  if (target.tenantId) {
    segments.push(`tenant:${target.tenantId}`);
  }
  if (target.accountId) {
    segments.push(`account:${target.accountId}`);
  }
  if (target.domainId) {
    segments.push(`domain:${target.domainId}`);
  }
  if (target.wedgeId) {
    segments.push(`wedge:${target.wedgeId}`);
  }
  if (target.consequenceType) {
    segments.push(`consequence:${target.consequenceType}`);
  }
  if (target.riskClass) {
    segments.push(`risk:${target.riskClass}`);
  }
  if (target.planId) {
    segments.push(`plan:${target.planId}`);
  }

  return segments.join(' / ');
}

export function policyControlPlaneDescriptor(): PolicyControlPlaneDescriptor {
  return Object.freeze({
    version: POLICY_CONTROL_PLANE_SPEC_VERSION,
    storeKinds: POLICY_STORE_KINDS,
    lifecycleStates: POLICY_PACK_LIFECYCLE_STATES,
    activationStates: POLICY_ACTIVATION_STATES,
    discoveryModes: POLICY_DISCOVERY_MODES,
    scopeDimensions: POLICY_SCOPE_DIMENSIONS,
    mutationActions: POLICY_MUTATION_ACTIONS,
  });
}
