import * as types from './types.js';
import * as objectModel from './object-model.js';
import * as verificationProfiles from './verification-profiles.js';
import * as freshness from './freshness.js';
import * as offlineVerifier from './offline-verifier.js';
import * as onlineVerifier from './online-verifier.js';
import * as tokenExchange from './token-exchange.js';
import * as dpop from './dpop.js';
import * as workloadBinding from './workload-binding.js';
import * as httpMessageSignatures from './http-message-signatures.js';
import * as asyncEnvelope from './async-envelope.js';
import * as middleware from './middleware.js';
import * as webhookReceiver from './webhook-receiver.js';
import * as recordWrite from './record-write.js';
import * as communicationSend from './communication-send.js';
import * as actionDispatch from './action-dispatch.js';
import * as envoyExtAuthz from './envoy-ext-authz.js';
import * as degradedMode from './degraded-mode.js';
import * as telemetry from './telemetry.js';
import * as conformance from './conformance.js';

export {
  types,
  objectModel,
  verificationProfiles,
  freshness,
  offlineVerifier,
  onlineVerifier,
  tokenExchange,
  dpop,
  workloadBinding,
  httpMessageSignatures,
  asyncEnvelope,
  middleware,
  webhookReceiver,
  recordWrite,
  communicationSend,
  actionDispatch,
  envoyExtAuthz,
  degradedMode,
  telemetry,
  conformance,
};

/**
 * Curated public platform surface for the Attestor release-enforcement plane.
 *
 * This keeps the enforcement plane reusable behind one stable package subpath
 * instead of freezing every internal file path as public API.
 */

export const RELEASE_ENFORCEMENT_PLANE_PLATFORM_SURFACE_SPEC_VERSION =
  'attestor.release-enforcement-plane-platform.v1';
export const RELEASE_ENFORCEMENT_PLANE_PACKAGE_NAME = 'attestor';
export const RELEASE_ENFORCEMENT_PLANE_PUBLIC_SUBPATH =
  'attestor/release-enforcement-plane';

export type ReleaseEnforcementPlaneExtractionStatus = 'ready' | 'pending';

export interface ReleaseEnforcementPlaneExtractionCriterion {
  readonly id: string;
  readonly status: ReleaseEnforcementPlaneExtractionStatus;
  readonly description: string;
}

export interface ReleaseEnforcementPlanePublicSurfaceDescriptor {
  readonly version: typeof RELEASE_ENFORCEMENT_PLANE_PLATFORM_SURFACE_SPEC_VERSION;
  readonly packageName: typeof RELEASE_ENFORCEMENT_PLANE_PACKAGE_NAME;
  readonly subpath: typeof RELEASE_ENFORCEMENT_PLANE_PUBLIC_SUBPATH;
  readonly namespaceExports: readonly string[];
  readonly extractionCriteria: readonly ReleaseEnforcementPlaneExtractionCriterion[];
}

export const RELEASE_ENFORCEMENT_PLANE_EXTRACTION_CRITERIA = Object.freeze([
  Object.freeze({
    id: 'stable-enforcement-verifier-contract',
    status: 'ready',
    description:
      'The offline verifier, online introspection path, freshness rules, and verification-profile matrix now form a stable enforcement contract.',
  }),
  Object.freeze({
    id: 'multiple-pep-topologies-proven',
    status: 'ready',
    description:
      'HTTP middleware, webhook receiver, gateway adapters, and Envoy ext_authz now reuse the same verification core and enforcement object model.',
  }),
  Object.freeze({
    id: 'sender-constrained-presentation-stable',
    status: 'ready',
    description:
      'DPoP, workload-bound mTLS and SPIFFE, HTTP message signatures, and signed async envelopes are explicit and versioned.',
  }),
  Object.freeze({
    id: 'operational-enforcement-surface-stable',
    status: 'ready',
    description:
      'Degraded-mode control, telemetry, transparency receipts, and conformance helpers now sit on top of the same packaged enforcement primitives.',
  }),
  Object.freeze({
    id: 'justify-separate-enforcement-service',
    status: 'pending',
    description:
      'A standalone deployable enforcement-plane service should wait until customer-operated topologies, scaling, or blast-radius needs clearly justify a separate runtime boundary.',
  }),
] satisfies readonly ReleaseEnforcementPlaneExtractionCriterion[]);

export const releaseEnforcementPlane = Object.freeze({
  types,
  objectModel,
  verificationProfiles,
  freshness,
  offlineVerifier,
  onlineVerifier,
  tokenExchange,
  dpop,
  workloadBinding,
  httpMessageSignatures,
  asyncEnvelope,
  middleware,
  webhookReceiver,
  recordWrite,
  communicationSend,
  actionDispatch,
  envoyExtAuthz,
  degradedMode,
  telemetry,
  conformance,
});

export type ReleaseEnforcementPlane = typeof releaseEnforcementPlane;
export type EnforcementRequest = objectModel.EnforcementRequest;
export type ReleasePresentation = objectModel.ReleasePresentation;
export type VerificationResult = objectModel.VerificationResult;
export type EnforcementBreakGlassGrant = objectModel.EnforcementBreakGlassGrant;
export type EnforcementDecision = objectModel.EnforcementDecision;
export type EnforcementReceipt = objectModel.EnforcementReceipt;
export type VerificationProfile = verificationProfiles.VerificationProfile;
export type EnforcementBoundaryKind = types.EnforcementBoundaryKind;
export type ReleaseEnforcementConsequenceType = types.ReleaseEnforcementConsequenceType;
export type ReleaseEnforcementRiskClass = types.ReleaseEnforcementRiskClass;
export type EnforcementFailureReason = types.EnforcementFailureReason;
export type EnforcementTelemetryEvent = telemetry.EnforcementTelemetryEvent;
export type EnforcementTransparencyReceipt = telemetry.EnforcementTransparencyReceipt;
export type EnforcementConformanceStatus = conformance.EnforcementConformanceStatus;

export function releaseEnforcementPlanePublicSurface(): ReleaseEnforcementPlanePublicSurfaceDescriptor {
  return Object.freeze({
    version: RELEASE_ENFORCEMENT_PLANE_PLATFORM_SURFACE_SPEC_VERSION,
    packageName: RELEASE_ENFORCEMENT_PLANE_PACKAGE_NAME,
    subpath: RELEASE_ENFORCEMENT_PLANE_PUBLIC_SUBPATH,
    namespaceExports: Object.freeze(Object.keys(releaseEnforcementPlane)),
    extractionCriteria: RELEASE_ENFORCEMENT_PLANE_EXTRACTION_CRITERIA,
  });
}
