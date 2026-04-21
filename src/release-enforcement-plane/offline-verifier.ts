import { createHash } from 'node:crypto';
import type {
  ReleaseTokenVerificationKey,
  ReleaseTokenVerificationResult,
} from '../release-kernel/release-token.js';
import {
  ReleaseTokenVerificationFailure,
  verifyIssuedReleaseToken,
} from '../release-kernel/release-token.js';
import {
  RELEASE_TOKEN_SPEC_VERSION,
  type ReleaseTokenClaims,
} from '../release-kernel/object-model.js';
import {
  createVerificationResult,
  type EnforcementRequest,
  type ReleasePresentation,
  type VerificationResult,
} from './object-model.js';
import {
  evaluateReleaseFreshness,
  resolveFreshnessRules,
  type NonceLedgerEntry,
  type ReleaseFreshnessEvaluation,
  type ReplayLedgerEntry,
  type ReplaySubjectKind,
} from './freshness.js';
import {
  ENFORCEMENT_FAILURE_REASONS,
  type EnforcementFailureReason,
  type ReleasePresentationMode,
} from './types.js';
import { verifyDpopProof } from './dpop.js';
import {
  HTTP_MESSAGE_SIGNATURE_TAG,
  normalizeHttpSignatureTargetUri,
  verifyHttpMessageSignature,
  type HttpMessageForSignature,
} from './http-message-signatures.js';
import { verifyWorkloadBoundPresentation } from './workload-binding.js';
import {
  resolveVerificationProfile,
  type VerificationProfile,
} from './verification-profiles.js';
import type { JWK } from 'jose';

/**
 * Offline release verification core.
 *
 * This is the reusable local verifier that PEPs can run before any network
 * introspection exists. It verifies the signed release token and its local
 * bindings, then returns `indeterminate` rather than `valid` whenever the
 * profile still requires online liveness in a later enforcement step.
 */

export const OFFLINE_RELEASE_VERIFIER_SPEC_VERSION =
  'attestor.release-enforcement-offline-verifier.v1';

export type OfflineReleaseVerificationStatus =
  | 'valid'
  | 'invalid'
  | 'indeterminate';

export interface OfflineVerifierExpectedBinding {
  readonly audience?: string;
  readonly releaseTokenId?: string;
  readonly releaseDecisionId?: string;
  readonly consequenceType?: EnforcementRequest['enforcementPoint']['consequenceType'];
  readonly riskClass?: EnforcementRequest['enforcementPoint']['riskClass'];
  readonly outputHash?: string;
  readonly consequenceHash?: string;
  readonly policyHash?: string;
}

export interface OfflineHttpMessageSignatureVerificationContext {
  readonly message: HttpMessageForSignature;
  readonly publicJwk: JWK;
  readonly label?: string;
  readonly expectedNonce?: string | null;
  readonly expectedTag?: string | null;
  readonly requiredCoveredComponents?: readonly string[];
  readonly maxSignatureAgeSeconds?: number;
  readonly clockSkewSeconds?: number;
}

export interface OfflineReleaseVerificationInput {
  readonly request: EnforcementRequest;
  readonly presentation: ReleasePresentation;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly now: string;
  readonly profile?: VerificationProfile;
  readonly expected?: OfflineVerifierExpectedBinding;
  readonly replayKey?: string | null;
  readonly replaySubjectKind?: ReplaySubjectKind;
  readonly replayLedgerEntry?: ReplayLedgerEntry | null;
  readonly nonceLedgerEntry?: NonceLedgerEntry | null;
  readonly httpMessageSignature?: OfflineHttpMessageSignatureVerificationContext;
  readonly verificationResultId?: string;
}

export interface OfflineReleaseVerification {
  readonly version: typeof OFFLINE_RELEASE_VERIFIER_SPEC_VERSION;
  readonly status: OfflineReleaseVerificationStatus;
  readonly offlineVerified: boolean;
  readonly requiresOnlineIntrospection: boolean;
  readonly checkedAt: string;
  readonly profile: VerificationProfile;
  readonly freshness: ReleaseFreshnessEvaluation | null;
  readonly verificationResult: VerificationResult;
  readonly tokenVerification: ReleaseTokenVerificationResult | null;
  readonly claims: ReleaseTokenClaims | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Release enforcement-plane offline verifier ${fieldName} must be a valid ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function sha256TokenDigest(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function uniqueFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const present = new Set(reasons);
  return Object.freeze(ENFORCEMENT_FAILURE_REASONS.filter((reason) => present.has(reason)));
}

function expectedBindingForRequest(
  input: OfflineReleaseVerificationInput,
): Required<OfflineVerifierExpectedBinding> {
  const request = input.request;
  return {
    audience: input.expected?.audience ?? request.targetId,
    releaseTokenId: input.expected?.releaseTokenId ?? request.releaseTokenId ?? '',
    releaseDecisionId: input.expected?.releaseDecisionId ?? request.releaseDecisionId ?? '',
    consequenceType: input.expected?.consequenceType ?? request.enforcementPoint.consequenceType,
    riskClass: input.expected?.riskClass ?? request.enforcementPoint.riskClass,
    outputHash: input.expected?.outputHash ?? request.outputHash,
    consequenceHash: input.expected?.consequenceHash ?? request.consequenceHash,
    policyHash: input.expected?.policyHash ?? '',
  };
}

function resolveProfile(input: OfflineReleaseVerificationInput): VerificationProfile {
  const requestProfile = resolveVerificationProfile({
    consequenceType: input.request.enforcementPoint.consequenceType,
    riskClass: input.request.enforcementPoint.riskClass,
    boundaryKind: input.request.enforcementPoint.boundaryKind,
  });

  if (!input.profile) {
    return requestProfile;
  }

  if (
    input.profile.consequenceType !== requestProfile.consequenceType ||
    input.profile.riskClass !== requestProfile.riskClass ||
    input.profile.boundaryKind !== requestProfile.boundaryKind
  ) {
    throw new Error(
      'Release enforcement-plane offline verifier profile must match the enforcement request boundary, consequence type, and risk class.',
    );
  }

  return input.profile;
}

function presentationCarriesReleaseToken(presentation: ReleasePresentation): boolean {
  return typeof presentation.releaseToken === 'string' && presentation.releaseToken.length > 0;
}

function assertPresentationMode(
  profile: VerificationProfile,
  presentationMode: ReleasePresentationMode,
): readonly EnforcementFailureReason[] {
  if (!profile.allowedPresentationModes.includes(presentationMode)) {
    return ['binding-mismatch'];
  }
  return [];
}

function releaseTokenFailureReason(error: unknown): EnforcementFailureReason {
  if (error instanceof ReleaseTokenVerificationFailure && error.code === 'expired') {
    return 'expired-authorization';
  }
  return 'invalid-signature';
}

function protectedHeaderFailureReasons(
  verification: ReleaseTokenVerificationResult,
  key: ReleaseTokenVerificationKey,
): readonly EnforcementFailureReason[] {
  const reasons: EnforcementFailureReason[] = [];

  if (verification.protectedHeader.alg !== key.algorithm) {
    reasons.push('invalid-signature');
  }

  if (verification.keyId !== key.keyId) {
    reasons.push('invalid-signature');
  }

  if (
    verification.protectedHeader.typ !== undefined &&
    verification.protectedHeader.typ !== 'JWT'
  ) {
    reasons.push('invalid-signature');
  }

  return reasons;
}

function claimShapeFailureReasons(claims: ReleaseTokenClaims): readonly EnforcementFailureReason[] {
  const reasons: EnforcementFailureReason[] = [];

  if (claims.version !== RELEASE_TOKEN_SPEC_VERSION) {
    reasons.push('invalid-signature');
  }

  if (claims.decision !== 'accepted' && claims.decision !== 'overridden') {
    reasons.push('binding-mismatch');
  }

  return reasons;
}

function bindingFailureReasons(
  input: OfflineReleaseVerificationInput,
  claims: ReleaseTokenClaims,
): readonly EnforcementFailureReason[] {
  const expected = expectedBindingForRequest(input);
  const presentation = input.presentation;
  const reasons: EnforcementFailureReason[] = [];

  if (claims.aud !== expected.audience) {
    reasons.push('wrong-audience');
  }

  if (expected.releaseTokenId && claims.jti !== expected.releaseTokenId) {
    reasons.push('binding-mismatch');
  }

  if (presentation.releaseTokenId !== null && presentation.releaseTokenId !== claims.jti) {
    reasons.push('binding-mismatch');
  }

  if (input.request.releaseTokenId !== null && input.request.releaseTokenId !== claims.jti) {
    reasons.push('binding-mismatch');
  }

  if (expected.releaseDecisionId && claims.decision_id !== expected.releaseDecisionId) {
    reasons.push('binding-mismatch');
  }

  if (
    presentation.releaseTokenDigest !== null &&
    presentation.releaseToken !== null &&
    presentation.releaseTokenDigest !== sha256TokenDigest(presentation.releaseToken)
  ) {
    reasons.push('binding-mismatch');
  }

  if (presentation.issuer !== null && presentation.issuer !== claims.iss) {
    reasons.push('binding-mismatch');
  }

  if (presentation.subject !== null && presentation.subject !== claims.sub) {
    reasons.push('binding-mismatch');
  }

  if (presentation.audience !== null && presentation.audience !== claims.aud) {
    reasons.push('wrong-audience');
  }

  if (presentation.expiresAt !== null && presentation.expiresAt !== new Date(claims.exp * 1000).toISOString()) {
    reasons.push('expired-authorization');
  }

  if (claims.consequence_type !== expected.consequenceType) {
    reasons.push('wrong-consequence');
  }

  if (claims.risk_class !== expected.riskClass) {
    reasons.push('binding-mismatch');
  }

  if (claims.output_hash !== expected.outputHash) {
    reasons.push('binding-mismatch');
  }

  if (claims.consequence_hash !== expected.consequenceHash) {
    reasons.push('binding-mismatch');
  }

  if (expected.policyHash && claims.policy_hash !== expected.policyHash) {
    reasons.push('binding-mismatch');
  }

  return reasons;
}

async function dpopBindingFailureReasons(
  input: OfflineReleaseVerificationInput,
  claims: ReleaseTokenClaims,
  checkedAt: string,
): Promise<readonly EnforcementFailureReason[]> {
  if (input.presentation.mode !== 'dpop-bound-token') {
    return [];
  }

  const proof = input.presentation.proof;
  const transport = input.request.transport;
  if (
    proof?.kind !== 'dpop' ||
    transport?.kind !== 'http' ||
    input.presentation.releaseToken === null ||
    claims.cnf?.jkt === undefined
  ) {
    return ['binding-mismatch'];
  }

  const verified = await verifyDpopProof({
    proofJwt: proof.proofJwt,
    httpMethod: transport.method,
    httpUri: transport.uri,
    accessToken: input.presentation.releaseToken,
    expectedJwkThumbprint: claims.cnf.jkt,
    now: checkedAt,
    replayLedgerEntry: input.replayLedgerEntry,
  });
  const metadataFailures: EnforcementFailureReason[] = [];

  if (
    verified.proofJti !== proof.proofJti ||
    verified.httpMethod !== proof.httpMethod ||
    verified.httpUri !== proof.httpUri ||
    verified.accessTokenHash !== proof.accessTokenHash ||
    verified.nonce !== proof.nonce ||
    verified.publicKeyThumbprint !== proof.keyThumbprint
  ) {
    metadataFailures.push('binding-mismatch');
  }

  return uniqueFailureReasons([
    ...verified.failureReasons,
    ...metadataFailures,
  ]);
}

function workloadBindingFailureReasons(
  input: OfflineReleaseVerificationInput,
  claims: ReleaseTokenClaims,
  checkedAt: string,
): readonly EnforcementFailureReason[] {
  if (
    input.presentation.mode !== 'mtls-bound-token' &&
    input.presentation.mode !== 'spiffe-bound-token'
  ) {
    return [];
  }

  const verified = verifyWorkloadBoundPresentation({
    presentation: input.presentation,
    claims,
    checkedAt,
  });

  return verified.failureReasons;
}

function componentSetsMatch(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalize = (components: readonly string[]) =>
    components.map((component) => component.trim().toLowerCase()).sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function httpMessageMatchesRequestTransport(input: {
  readonly request: EnforcementRequest;
  readonly message: HttpMessageForSignature;
}): boolean {
  const transport = input.request.transport;
  if (transport?.kind !== 'http') {
    return false;
  }

  return (
    input.message.method.trim().toUpperCase() === transport.method &&
    normalizeHttpSignatureTargetUri(input.message.uri) ===
      normalizeHttpSignatureTargetUri(transport.uri)
  );
}

async function httpMessageSignatureBindingFailureReasons(
  input: OfflineReleaseVerificationInput,
  claims: ReleaseTokenClaims,
  checkedAt: string,
): Promise<readonly EnforcementFailureReason[]> {
  if (input.presentation.mode !== 'http-message-signature') {
    return [];
  }

  const proof = input.presentation.proof;
  const context = input.httpMessageSignature;
  if (
    proof?.kind !== 'http-message-signature' ||
    context === undefined ||
    input.presentation.releaseToken === null ||
    claims.cnf?.jkt === undefined ||
    !httpMessageMatchesRequestTransport({
      request: input.request,
      message: context.message,
    })
  ) {
    return ['binding-mismatch'];
  }

  const verified = await verifyHttpMessageSignature({
    message: context.message,
    signatureInput: proof.signatureInput,
    signature: proof.signature,
    publicJwk: context.publicJwk,
    label: context.label,
    expectedKeyId: proof.keyId,
    expectedJwkThumbprint: claims.cnf.jkt,
    expectedNonce: context.expectedNonce,
    expectedTag: context.expectedTag ?? HTTP_MESSAGE_SIGNATURE_TAG,
    requiredCoveredComponents: context.requiredCoveredComponents,
    now: checkedAt,
    maxSignatureAgeSeconds: context.maxSignatureAgeSeconds,
    clockSkewSeconds: context.clockSkewSeconds,
    replayLedgerEntry: input.replayLedgerEntry,
  });
  const metadataFailures: EnforcementFailureReason[] = [];

  if (
    verified.keyId !== proof.keyId ||
    verified.createdAt !== proof.createdAt ||
    verified.expiresAt !== proof.expiresAt ||
    verified.nonce !== proof.nonce ||
    !componentSetsMatch(verified.coveredComponents, proof.coveredComponents)
  ) {
    metadataFailures.push('binding-mismatch');
  }

  return uniqueFailureReasons([
    ...verified.failureReasons,
    ...metadataFailures,
  ]);
}

function replaySubjectKindForPresentation(
  presentation: ReleasePresentation,
): ReplaySubjectKind {
  if (presentation.proof?.kind === 'dpop') {
    return 'dpop-proof';
  }

  if (presentation.proof?.kind === 'http-message-signature') {
    return 'http-message-signature';
  }

  if (presentation.proof?.kind === 'signed-json-envelope') {
    return 'signed-json-envelope';
  }

  return 'release-token';
}

function replayKeyForPresentation(
  presentation: ReleasePresentation,
  claims: ReleaseTokenClaims,
): string {
  if (presentation.proof?.kind === 'dpop') {
    return `dpop-proof:${presentation.proof.proofJti}`;
  }

  if (presentation.proof?.kind === 'http-message-signature') {
    return `http-message-signature:${presentation.proof.nonce ?? presentation.proof.signature}`;
  }

  if (presentation.proof?.kind === 'signed-json-envelope') {
    return `signed-json-envelope:${presentation.proof.envelopeDigest}`;
  }

  return `release-token:${claims.jti}`;
}

function nonceForPresentation(presentation: ReleasePresentation): string | null {
  if (presentation.proof?.kind === 'dpop') {
    return presentation.proof.nonce;
  }

  if (presentation.proof?.kind === 'http-message-signature') {
    return presentation.proof.nonce;
  }

  return null;
}

function tokenIssuedAtIso(claims: ReleaseTokenClaims): string {
  return new Date(claims.iat * 1000).toISOString();
}

function tokenNotBeforeIso(claims: ReleaseTokenClaims): string {
  return new Date(claims.nbf * 1000).toISOString();
}

function tokenExpiresAtIso(claims: ReleaseTokenClaims): string {
  return new Date(claims.exp * 1000).toISOString();
}

function deriveStatus(
  offlineFailureReasons: readonly EnforcementFailureReason[],
  freshness: ReleaseFreshnessEvaluation | null,
  requiresOnlineIntrospection: boolean,
): OfflineReleaseVerificationStatus {
  if (offlineFailureReasons.length > 0 || freshness?.status === 'invalid') {
    return 'invalid';
  }

  if (requiresOnlineIntrospection || freshness?.status === 'indeterminate') {
    return 'indeterminate';
  }

  return 'valid';
}

export async function verifyOfflineReleaseAuthorization(
  input: OfflineReleaseVerificationInput,
): Promise<OfflineReleaseVerification> {
  const checkedAt = normalizeIsoTimestamp(input.now, 'now');
  const profile = resolveProfile(input);
  const presentationModeFailures = assertPresentationMode(profile, input.presentation.mode);

  let tokenVerification: ReleaseTokenVerificationResult | null = null;
  let claims: ReleaseTokenClaims | null = null;
  let freshness: ReleaseFreshnessEvaluation | null = null;
  const offlineFailures: EnforcementFailureReason[] = [...presentationModeFailures];

  if (!presentationCarriesReleaseToken(input.presentation)) {
    offlineFailures.push('missing-release-authorization');
  }

  if (offlineFailures.length === 0 && input.presentation.releaseToken !== null) {
    try {
      tokenVerification = await verifyIssuedReleaseToken({
        token: input.presentation.releaseToken,
        verificationKey: input.verificationKey,
        currentDate: checkedAt,
      });
      claims = tokenVerification.claims;
      offlineFailures.push(
        ...protectedHeaderFailureReasons(tokenVerification, input.verificationKey),
        ...claimShapeFailureReasons(tokenVerification.claims),
        ...bindingFailureReasons(input, tokenVerification.claims),
        ...(await dpopBindingFailureReasons(input, tokenVerification.claims, checkedAt)),
        ...workloadBindingFailureReasons(input, tokenVerification.claims, checkedAt),
        ...(await httpMessageSignatureBindingFailureReasons(
          input,
          tokenVerification.claims,
          checkedAt,
        )),
      );
    } catch (error) {
      offlineFailures.push(releaseTokenFailureReason(error));
    }
  }

  if (claims !== null) {
    const rules = resolveFreshnessRules(profile);
    freshness = evaluateReleaseFreshness({
      rules,
      now: checkedAt,
      presentationMode: input.presentation.mode,
      issuedAt: tokenIssuedAtIso(claims),
      notBefore: tokenNotBeforeIso(claims),
      expiresAt: tokenExpiresAtIso(claims),
      replayKey:
        input.replayKey ??
        replayKeyForPresentation(input.presentation, claims),
      replaySubjectKind:
        input.replaySubjectKind ??
        replaySubjectKindForPresentation(input.presentation),
      replayLedgerEntry: input.replayLedgerEntry,
      nonce: nonceForPresentation(input.presentation),
      nonceLedgerEntry: input.nonceLedgerEntry,
    });
  }

  const requiresOnlineIntrospection =
    profile.onlineIntrospectionRequired || claims?.introspection_required === true;
  const failureReasons = uniqueFailureReasons([
    ...offlineFailures,
    ...(freshness?.failureReasons ?? []),
    ...(requiresOnlineIntrospection && freshness?.status === 'fresh'
      ? ['fresh-introspection-required' as const]
      : []),
  ]);
  const status = deriveStatus(offlineFailures, freshness, requiresOnlineIntrospection);
  const verificationStatus =
    status === 'valid'
      ? 'valid'
      : status === 'indeterminate'
        ? 'indeterminate'
        : 'invalid';
  const verificationResult = createVerificationResult({
    id: input.verificationResultId ?? `vr_offline_${input.request.id}`,
    checkedAt,
    mode: 'offline-signature',
    status: verificationStatus,
    cacheState: freshness?.cacheState ?? 'miss',
    degradedState: freshness?.degradedState ?? 'normal',
    presentation: input.presentation,
    releaseDecisionId: claims?.decision_id ?? input.request.releaseDecisionId,
    outputHash: claims?.output_hash ?? null,
    consequenceHash: claims?.consequence_hash ?? null,
    failureReasons,
  });

  return Object.freeze({
    version: OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
    status,
    offlineVerified:
      claims !== null &&
      offlineFailures.length === 0 &&
      freshness?.status !== 'invalid',
    requiresOnlineIntrospection,
    checkedAt,
    profile,
    freshness,
    verificationResult,
    tokenVerification,
    claims,
    failureReasons,
  });
}
