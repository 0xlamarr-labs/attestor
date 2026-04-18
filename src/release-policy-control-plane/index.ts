import * as types from './types.js';
import * as objectModel from './object-model.js';
import * as scoping from './scoping.js';
import * as bundleFormat from './bundle-format.js';
import * as bundleSigning from './bundle-signing.js';
import * as bundleCache from './bundle-cache.js';
import * as store from './store.js';
import * as activationRecords from './activation-records.js';
import * as activationApprovals from './activation-approvals.js';
import * as discovery from './discovery.js';
import * as resolver from './resolver.js';
import * as simulation from './simulation.js';
import * as impactSummary from './impact-summary.js';
import * as testPack from './test-pack.js';
import * as auditLog from './audit-log.js';
import * as runtime from './runtime.js';
import * as financeProving from './finance-proving.js';

export {
  types,
  objectModel,
  scoping,
  bundleFormat,
  bundleSigning,
  bundleCache,
  store,
  activationRecords,
  activationApprovals,
  discovery,
  resolver,
  simulation,
  impactSummary,
  testPack,
  auditLog,
  runtime,
  financeProving,
};

/**
 * Curated public platform surface for the Attestor release-policy control plane.
 *
 * Like the release layer, this surface intentionally groups stable namespaces
 * behind one package subpath instead of exposing internal file layout as API.
 */

export const RELEASE_POLICY_CONTROL_PLANE_PLATFORM_SURFACE_SPEC_VERSION =
  'attestor.release-policy-control-plane-platform.v1';
export const RELEASE_POLICY_CONTROL_PLANE_PACKAGE_NAME = 'attestor';
export const RELEASE_POLICY_CONTROL_PLANE_PUBLIC_SUBPATH =
  'attestor/release-policy-control-plane';

export type ReleasePolicyControlPlaneExtractionStatus = 'ready' | 'pending';

export interface ReleasePolicyControlPlaneExtractionCriterion {
  readonly id: string;
  readonly status: ReleasePolicyControlPlaneExtractionStatus;
  readonly description: string;
}

export interface ReleasePolicyControlPlanePublicSurfaceDescriptor {
  readonly version: typeof RELEASE_POLICY_CONTROL_PLANE_PLATFORM_SURFACE_SPEC_VERSION;
  readonly packageName: typeof RELEASE_POLICY_CONTROL_PLANE_PACKAGE_NAME;
  readonly subpath: typeof RELEASE_POLICY_CONTROL_PLANE_PUBLIC_SUBPATH;
  readonly namespaceExports: readonly string[];
  readonly extractionCriteria: readonly ReleasePolicyControlPlaneExtractionCriterion[];
}

export const RELEASE_POLICY_CONTROL_PLANE_EXTRACTION_CRITERIA = Object.freeze([
  Object.freeze({
    id: 'stable-policy-bundle-contract',
    status: 'ready',
    description:
      'Policy bundle format, signature verification, bundle freshness, and compatibility envelopes are now explicit and versioned.',
  }),
  Object.freeze({
    id: 'stable-scope-and-activation-contract',
    status: 'ready',
    description:
      'Scoped activation, rollback, freeze, approval, and audit semantics are stable enough to form a reusable control-plane contract.',
  }),
  Object.freeze({
    id: 'runtime-resolution-proven',
    status: 'ready',
    description:
      'The finance runtime now resolves active policy through the packaged control-plane surface, including tenant-aware progressive rollout.',
  }),
  Object.freeze({
    id: 'operator-surface-stable',
    status: 'ready',
    description:
      'Simulation, impact preview, admin mutation, and audit verification routes now sit on top of the same reusable control-plane primitives.',
  }),
  Object.freeze({
    id: 'justify-separate-control-plane-service',
    status: 'pending',
    description:
      'A standalone deployable policy-control-plane service should wait until multi-domain or customer-operated requirements clearly justify a separate runtime boundary.',
  }),
] satisfies readonly ReleasePolicyControlPlaneExtractionCriterion[]);

export const releasePolicyControlPlane = Object.freeze({
  types,
  objectModel,
  scoping,
  bundleFormat,
  bundleSigning,
  bundleCache,
  store,
  activationRecords,
  activationApprovals,
  discovery,
  resolver,
  simulation,
  impactSummary,
  testPack,
  auditLog,
  runtime,
  financeProving,
});

export type ReleasePolicyControlPlane = typeof releasePolicyControlPlane;
export type PolicyControlPlaneStore = store.PolicyControlPlaneStore;
export type StoredPolicyBundleRecord = store.StoredPolicyBundleRecord;
export type UpsertStoredPolicyBundleInput = store.UpsertStoredPolicyBundleInput;
export type PolicyActivationApprovalGateResult =
  activationApprovals.PolicyActivationApprovalGateResult;
export type PolicyActivationApprovalRequest =
  activationApprovals.PolicyActivationApprovalRequest;
export type PolicyActivationApprovalState =
  activationApprovals.PolicyActivationApprovalState;
export type PolicyActivationApprovalStore =
  activationApprovals.PolicyActivationApprovalStore;
export type PolicyMutationAuditEntry = auditLog.PolicyMutationAuditEntry;
export type PolicyMutationAuditLogWriter = auditLog.PolicyMutationAuditLogWriter;
export type PolicyBundleCacheDescriptor = bundleCache.PolicyBundleCacheDescriptor;
export type PolicyActivationRecord = objectModel.PolicyActivationRecord;
export type PolicyPackMetadata = objectModel.PolicyPackMetadata;
export type PolicyActivationTarget = types.PolicyActivationTarget;
export type PolicyBundleReference = types.PolicyBundleReference;
export type PolicyPackLifecycleState = types.PolicyPackLifecycleState;
export type PolicyMutationAction = types.PolicyMutationAction;

export function releasePolicyControlPlanePublicSurface(): ReleasePolicyControlPlanePublicSurfaceDescriptor {
  return Object.freeze({
    version: RELEASE_POLICY_CONTROL_PLANE_PLATFORM_SURFACE_SPEC_VERSION,
    packageName: RELEASE_POLICY_CONTROL_PLANE_PACKAGE_NAME,
    subpath: RELEASE_POLICY_CONTROL_PLANE_PUBLIC_SUBPATH,
    namespaceExports: Object.freeze(Object.keys(releasePolicyControlPlane)),
    extractionCriteria: RELEASE_POLICY_CONTROL_PLANE_EXTRACTION_CRITERIA,
  });
}
