import * as vocabulary from '../release-kernel/types.js';
import * as model from '../release-kernel/object-model.js';
import * as consequences from '../release-kernel/consequence-rollout.js';
import * as risk from '../release-kernel/risk-controls.js';
import * as wedge from '../release-kernel/first-hard-gateway-wedge.js';
import * as policyRollout from '../release-kernel/release-policy-rollout.js';
import * as policy from '../release-kernel/release-policy.js';
import * as decision from '../release-kernel/release-decision-engine.js';
import * as decisionLog from '../release-kernel/release-decision-log.js';
import * as deterministicChecks from '../release-kernel/release-deterministic-checks.js';
import * as shadow from '../release-kernel/release-shadow-mode.js';
import * as canonicalization from '../release-kernel/release-canonicalization.js';
import * as token from '../release-kernel/release-token.js';
import * as verification from '../release-kernel/release-verification.js';
import * as introspection from '../release-kernel/release-introspection.js';
import * as evidence from '../release-kernel/release-evidence-pack.js';
import * as review from '../release-kernel/reviewer-queue.js';

export {
  vocabulary,
  model,
  consequences,
  risk,
  wedge,
  policyRollout,
  policy,
  decision,
  decisionLog,
  deterministicChecks,
  shadow,
  canonicalization,
  token,
  verification,
  introspection,
  evidence,
  review,
};

export type ReleaseReviewerQueueDetail = review.ReleaseReviewerQueueDetail;
export type ReleaseReviewerQueueListResult = review.ReleaseReviewerQueueListResult;

/**
 * Curated public platform surface for the Attestor release layer.
 *
 * The intent is not to freeze every internal file path. Instead, consumers get
 * stable subpath entrypoints with grouped namespaces that can travel with the
 * release layer if and when it is later extracted from the modular monolith.
 */

export const RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION =
  'attestor.release-layer-platform.v1';
export const RELEASE_LAYER_PACKAGE_NAME = 'attestor';
export const RELEASE_LAYER_PUBLIC_SUBPATH = 'attestor/release-layer';
export const RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH = 'attestor/release-layer/finance';

export type ReleaseLayerExtractionStatus = 'ready' | 'pending';

export interface ReleaseLayerExtractionCriterion {
  readonly id: string;
  readonly status: ReleaseLayerExtractionStatus;
  readonly description: string;
}

export interface ReleaseLayerPublicSubpaths {
  readonly core: typeof RELEASE_LAYER_PUBLIC_SUBPATH;
  readonly finance: typeof RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH;
}

export interface ReleaseLayerPublicSurfaceDescriptor {
  readonly version: typeof RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION;
  readonly packageName: typeof RELEASE_LAYER_PACKAGE_NAME;
  readonly subpaths: ReleaseLayerPublicSubpaths;
  readonly namespaceExports: readonly string[];
  readonly extractionCriteria: readonly ReleaseLayerExtractionCriterion[];
}

export const RELEASE_LAYER_EXTRACTION_CRITERIA = Object.freeze([
  Object.freeze({
    id: 'stable-release-decision',
    status: 'ready',
    description: '`releaseDecision` is versioned and stable enough to act as a package-level contract.',
  }),
  Object.freeze({
    id: 'stable-release-token',
    status: 'ready',
    description: '`releaseToken` issuance, verification, revocation, and replay semantics are now explicit and versioned.',
  }),
  Object.freeze({
    id: 'multiple-consequence-flows',
    status: 'ready',
    description:
      'The same release layer now backs `record`, `communication`, and `action` consequence flows.',
  }),
  Object.freeze({
    id: 'stable-downstream-verification-contract',
    status: 'ready',
    description:
      'The downstream verification middleware and token-binding contract are now stable enough to version as a reusable surface.',
  }),
  Object.freeze({
    id: 'justify-separate-scaling-boundary',
    status: 'pending',
    description:
      'A standalone deployable release service should wait until scaling and availability requirements clearly diverge from the current modular monolith.',
  }),
] satisfies readonly ReleaseLayerExtractionCriterion[]);

export const releaseLayer = Object.freeze({
  vocabulary,
  model,
  consequences,
  risk,
  wedge,
  policyRollout,
  policy,
  decision,
  decisionLog,
  deterministicChecks,
  shadow,
  canonicalization,
  token,
  verification,
  introspection,
  evidence,
  review,
});

export type ReleaseLayer = typeof releaseLayer;
export type ReleaseActorReference = model.ReleaseActorReference;
export type ReleasePolicyDefinition = policy.ReleasePolicyDefinition;
export type ReleasePolicyRolloutDefinition = policyRollout.ReleasePolicyRolloutDefinition;
export type ReleasePolicyRolloutMode = policyRollout.ReleasePolicyRolloutMode;

export function releaseLayerPublicSurface(): ReleaseLayerPublicSurfaceDescriptor {
  return Object.freeze({
    version: RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION,
    packageName: RELEASE_LAYER_PACKAGE_NAME,
    subpaths: Object.freeze({
      core: RELEASE_LAYER_PUBLIC_SUBPATH,
      finance: RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH,
    }),
    namespaceExports: Object.freeze(Object.keys(releaseLayer)),
    extractionCriteria: RELEASE_LAYER_EXTRACTION_CRITERIA,
  });
}
