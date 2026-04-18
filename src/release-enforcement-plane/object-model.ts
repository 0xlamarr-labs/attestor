import type { ReleaseActorReference } from '../release-layer/index.js';
import type {
  EnforcementBreakGlassReason,
  EnforcementCacheState,
  EnforcementDegradedState,
  EnforcementFailureReason,
  EnforcementOutcome,
  EnforcementVerificationMode,
  ReleasePresentationMode,
} from './types.js';
import {
  ENFORCEMENT_OUTCOMES,
  createEnforcementPointReference,
  enforcementPointReferenceLabel,
  type CreateEnforcementPointReferenceInput,
  type EnforcementPointReference,
  type ReleaseEnforcementConsequenceType,
  type ReleaseEnforcementRiskClass,
} from './types.js';

/**
 * Versioned object model for Attestor's release enforcement plane.
 *
 * This is the shared contract for downstream PEPs, verifier cores,
 * introspection calls, sender-constrained presentations, and enforcement
 * receipts. It defines the stable objects only; cryptographic verification and
 * live network behavior arrive in later steps.
 */

export const RELEASE_ENFORCEMENT_OBJECT_MODEL_SPEC_VERSION =
  'attestor.release-enforcement-object-model.v1';
export const ENFORCEMENT_REQUEST_SPEC_VERSION =
  'attestor.enforcement-request.v1';
export const RELEASE_PRESENTATION_SPEC_VERSION =
  'attestor.release-presentation.v1';
export const INTROSPECTION_SNAPSHOT_SPEC_VERSION =
  'attestor.introspection-snapshot.v1';
export const VERIFICATION_RESULT_SPEC_VERSION =
  'attestor.verification-result.v1';
export const ENFORCEMENT_DECISION_SPEC_VERSION =
  'attestor.enforcement-decision.v1';
export const ENFORCEMENT_RECEIPT_SPEC_VERSION =
  'attestor.enforcement-receipt.v1';

export type VerificationStatus = 'valid' | 'invalid' | 'indeterminate';

export interface EnforcementRequest {
  readonly version: typeof ENFORCEMENT_REQUEST_SPEC_VERSION;
  readonly id: string;
  readonly receivedAt: string;
  readonly enforcementPoint: EnforcementPointReference;
  readonly enforcementPointLabel: string;
  readonly targetId: string;
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly releaseTokenId: string | null;
  readonly releaseDecisionId: string | null;
  readonly requester: ReleaseActorReference | null;
  readonly traceId: string | null;
  readonly idempotencyKey: string | null;
  readonly transport: EnforcementRequestTransport | null;
}

export type EnforcementRequestTransport =
  | {
      readonly kind: 'http';
      readonly method: string;
      readonly uri: string;
      readonly headersDigest: string | null;
      readonly bodyDigest: string | null;
    }
  | {
      readonly kind: 'async';
      readonly messageId: string;
      readonly queueOrTopic: string;
      readonly envelopeDigest: string | null;
    }
  | {
      readonly kind: 'artifact';
      readonly artifactId: string;
      readonly artifactDigest: string;
    };

export type ReleasePresentationProof =
  | {
      readonly kind: 'dpop';
      readonly proofJwt: string;
      readonly httpMethod: string;
      readonly httpUri: string;
      readonly proofJti: string;
      readonly accessTokenHash: string | null;
      readonly nonce: string | null;
      readonly keyThumbprint: string;
    }
  | {
      readonly kind: 'mtls';
      readonly certificateThumbprint: string;
      readonly subjectDn: string | null;
      readonly spiffeId: string | null;
    }
  | {
      readonly kind: 'spiffe';
      readonly spiffeId: string;
      readonly trustDomain: string;
      readonly svidThumbprint: string | null;
    }
  | {
      readonly kind: 'http-message-signature';
      readonly signatureInput: string;
      readonly signature: string;
      readonly keyId: string;
      readonly coveredComponents: readonly string[];
      readonly createdAt: string | null;
      readonly expiresAt: string | null;
      readonly nonce: string | null;
    }
  | {
      readonly kind: 'signed-json-envelope';
      readonly envelopeDigest: string;
      readonly subjectDigest: string;
      readonly signatureRef: string | null;
    };

export interface ReleasePresentation {
  readonly version: typeof RELEASE_PRESENTATION_SPEC_VERSION;
  readonly mode: ReleasePresentationMode;
  readonly presentedAt: string;
  readonly releaseToken: string | null;
  readonly releaseTokenId: string | null;
  readonly releaseTokenDigest: string | null;
  readonly issuer: string | null;
  readonly subject: string | null;
  readonly audience: string | null;
  readonly expiresAt: string | null;
  readonly scope: readonly string[];
  readonly proof: ReleasePresentationProof | null;
}

export interface IntrospectionSnapshot {
  readonly version: typeof INTROSPECTION_SNAPSHOT_SPEC_VERSION;
  readonly checkedAt: string;
  readonly authority: string;
  readonly active: boolean;
  readonly releaseTokenId: string | null;
  readonly releaseDecisionId: string | null;
  readonly issuer: string | null;
  readonly subject: string | null;
  readonly audience: string | null;
  readonly scope: readonly string[];
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly notBefore: string | null;
  readonly clientId: string | null;
  readonly consequenceType: ReleaseEnforcementConsequenceType | null;
  readonly riskClass: ReleaseEnforcementRiskClass | null;
}

export interface VerificationResult {
  readonly version: typeof VERIFICATION_RESULT_SPEC_VERSION;
  readonly id: string;
  readonly checkedAt: string;
  readonly mode: EnforcementVerificationMode;
  readonly status: VerificationStatus;
  readonly cacheState: EnforcementCacheState;
  readonly degradedState: EnforcementDegradedState;
  readonly presentationMode: ReleasePresentationMode;
  readonly releaseTokenId: string | null;
  readonly releaseDecisionId: string | null;
  readonly issuer: string | null;
  readonly subject: string | null;
  readonly audience: string | null;
  readonly outputHash: string | null;
  readonly consequenceHash: string | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly introspection: IntrospectionSnapshot | null;
}

export interface EnforcementBreakGlassGrant {
  readonly reason: EnforcementBreakGlassReason;
  readonly authorizedBy: ReleaseActorReference;
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly ticketId: string | null;
  readonly rationale: string;
}

export interface EnforcementDecision {
  readonly version: typeof ENFORCEMENT_DECISION_SPEC_VERSION;
  readonly id: string;
  readonly requestId: string;
  readonly decidedAt: string;
  readonly outcome: EnforcementOutcome;
  readonly enforcementPoint: EnforcementPointReference;
  readonly releaseTokenId: string | null;
  readonly releaseDecisionId: string | null;
  readonly verification: VerificationResult;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly cacheState: EnforcementCacheState;
  readonly degradedState: EnforcementDegradedState;
  readonly breakGlass: EnforcementBreakGlassGrant | null;
}

export interface EnforcementReceipt {
  readonly version: typeof ENFORCEMENT_RECEIPT_SPEC_VERSION;
  readonly id: string;
  readonly issuedAt: string;
  readonly decisionId: string;
  readonly requestId: string;
  readonly outcome: EnforcementOutcome;
  readonly enforcementPointLabel: string;
  readonly releaseTokenId: string | null;
  readonly releaseDecisionId: string | null;
  readonly outputHash: string | null;
  readonly consequenceHash: string | null;
  readonly verificationStatus: VerificationStatus;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly receiptDigest: string | null;
}

export interface CreateEnforcementRequestInput {
  readonly id: string;
  readonly receivedAt: string;
  readonly enforcementPoint: CreateEnforcementPointReferenceInput | EnforcementPointReference;
  readonly targetId: string;
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly releaseTokenId?: string | null;
  readonly releaseDecisionId?: string | null;
  readonly requester?: ReleaseActorReference | null;
  readonly traceId?: string | null;
  readonly idempotencyKey?: string | null;
  readonly transport?: EnforcementRequestTransport | null;
}

export interface CreateReleasePresentationInput {
  readonly mode: ReleasePresentationMode;
  readonly presentedAt: string;
  readonly releaseToken?: string | null;
  readonly releaseTokenId?: string | null;
  readonly releaseTokenDigest?: string | null;
  readonly issuer?: string | null;
  readonly subject?: string | null;
  readonly audience?: string | null;
  readonly expiresAt?: string | null;
  readonly scope?: readonly string[];
  readonly proof?: ReleasePresentationProof | null;
}

export interface CreateIntrospectionSnapshotInput {
  readonly checkedAt: string;
  readonly authority: string;
  readonly active: boolean;
  readonly releaseTokenId?: string | null;
  readonly releaseDecisionId?: string | null;
  readonly issuer?: string | null;
  readonly subject?: string | null;
  readonly audience?: string | null;
  readonly scope?: readonly string[];
  readonly issuedAt?: string | null;
  readonly expiresAt?: string | null;
  readonly notBefore?: string | null;
  readonly clientId?: string | null;
  readonly consequenceType?: ReleaseEnforcementConsequenceType | null;
  readonly riskClass?: ReleaseEnforcementRiskClass | null;
}

export interface CreateVerificationResultInput {
  readonly id: string;
  readonly checkedAt: string;
  readonly mode: EnforcementVerificationMode;
  readonly status: VerificationStatus;
  readonly cacheState?: EnforcementCacheState;
  readonly degradedState?: EnforcementDegradedState;
  readonly presentation: ReleasePresentation;
  readonly releaseDecisionId?: string | null;
  readonly outputHash?: string | null;
  readonly consequenceHash?: string | null;
  readonly failureReasons?: readonly EnforcementFailureReason[];
  readonly introspection?: IntrospectionSnapshot | null;
}

export interface CreateEnforcementDecisionInput {
  readonly id: string;
  readonly request: EnforcementRequest;
  readonly decidedAt: string;
  readonly verification: VerificationResult;
  readonly outcome?: EnforcementOutcome;
  readonly failureReasons?: readonly EnforcementFailureReason[];
  readonly breakGlass?: EnforcementBreakGlassGrant | null;
}

export interface CreateEnforcementReceiptInput {
  readonly id: string;
  readonly issuedAt: string;
  readonly decision: EnforcementDecision;
  readonly outputHash?: string | null;
  readonly consequenceHash?: string | null;
  readonly receiptDigest?: string | null;
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Release enforcement-plane ${fieldName} requires a non-empty value.`);
  }
  return normalized;
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
    throw new Error(`Release enforcement-plane ${fieldName} cannot be blank when provided.`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Release enforcement-plane ${fieldName} must be a valid ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalIsoTimestamp(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeIsoTimestamp(value, fieldName);
}

function normalizeScope(values: readonly string[] | undefined): readonly string[] {
  if (!values || values.length === 0) {
    return Object.freeze([]);
  }

  return Object.freeze(
    Array.from(
      new Set(
        values
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    ).sort(),
  );
}

function normalizeFailureReasons(
  reasons: readonly EnforcementFailureReason[] | undefined,
): readonly EnforcementFailureReason[] {
  if (!reasons || reasons.length === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(Array.from(new Set(reasons)).sort());
}

function normalizeCoveredComponents(
  components: readonly string[],
): readonly string[] {
  return Object.freeze(
    Array.from(
      new Set(
        components
          .map((component) => component.trim())
          .filter((component) => component.length > 0),
      ),
    ).sort(),
  );
}

function normalizeTransport(
  transport: EnforcementRequestTransport | null | undefined,
): EnforcementRequestTransport | null {
  if (!transport) {
    return null;
  }

  switch (transport.kind) {
    case 'http':
      return Object.freeze({
        kind: 'http',
        method: normalizeIdentifier(transport.method.toUpperCase(), 'transport.method'),
        uri: normalizeIdentifier(transport.uri, 'transport.uri'),
        headersDigest: normalizeOptionalIdentifier(transport.headersDigest, 'transport.headersDigest'),
        bodyDigest: normalizeOptionalIdentifier(transport.bodyDigest, 'transport.bodyDigest'),
      });
    case 'async':
      return Object.freeze({
        kind: 'async',
        messageId: normalizeIdentifier(transport.messageId, 'transport.messageId'),
        queueOrTopic: normalizeIdentifier(transport.queueOrTopic, 'transport.queueOrTopic'),
        envelopeDigest: normalizeOptionalIdentifier(transport.envelopeDigest, 'transport.envelopeDigest'),
      });
    case 'artifact':
      return Object.freeze({
        kind: 'artifact',
        artifactId: normalizeIdentifier(transport.artifactId, 'transport.artifactId'),
        artifactDigest: normalizeIdentifier(transport.artifactDigest, 'transport.artifactDigest'),
      });
  }
}

function normalizeProof(proof: ReleasePresentationProof): ReleasePresentationProof {
  switch (proof.kind) {
    case 'dpop':
      return Object.freeze({
        kind: 'dpop',
        proofJwt: normalizeIdentifier(proof.proofJwt, 'dpop.proofJwt'),
        httpMethod: normalizeIdentifier(proof.httpMethod.toUpperCase(), 'dpop.httpMethod'),
        httpUri: normalizeIdentifier(proof.httpUri, 'dpop.httpUri'),
        proofJti: normalizeIdentifier(proof.proofJti, 'dpop.proofJti'),
        accessTokenHash: normalizeOptionalIdentifier(proof.accessTokenHash, 'dpop.accessTokenHash'),
        nonce: normalizeOptionalIdentifier(proof.nonce, 'dpop.nonce'),
        keyThumbprint: normalizeIdentifier(proof.keyThumbprint, 'dpop.keyThumbprint'),
      });
    case 'mtls':
      return Object.freeze({
        kind: 'mtls',
        certificateThumbprint: normalizeIdentifier(
          proof.certificateThumbprint,
          'mtls.certificateThumbprint',
        ),
        subjectDn: normalizeOptionalText(proof.subjectDn),
        spiffeId: normalizeOptionalIdentifier(proof.spiffeId, 'mtls.spiffeId'),
      });
    case 'spiffe':
      return Object.freeze({
        kind: 'spiffe',
        spiffeId: normalizeIdentifier(proof.spiffeId, 'spiffe.spiffeId'),
        trustDomain: normalizeIdentifier(proof.trustDomain, 'spiffe.trustDomain'),
        svidThumbprint: normalizeOptionalIdentifier(proof.svidThumbprint, 'spiffe.svidThumbprint'),
      });
    case 'http-message-signature':
      return Object.freeze({
        kind: 'http-message-signature',
        signatureInput: normalizeIdentifier(
          proof.signatureInput,
          'httpMessageSignature.signatureInput',
        ),
        signature: normalizeIdentifier(proof.signature, 'httpMessageSignature.signature'),
        keyId: normalizeIdentifier(proof.keyId, 'httpMessageSignature.keyId'),
        coveredComponents: normalizeCoveredComponents(proof.coveredComponents),
        createdAt: normalizeOptionalIsoTimestamp(
          proof.createdAt,
          'httpMessageSignature.createdAt',
        ),
        expiresAt: normalizeOptionalIsoTimestamp(
          proof.expiresAt,
          'httpMessageSignature.expiresAt',
        ),
        nonce: normalizeOptionalIdentifier(proof.nonce, 'httpMessageSignature.nonce'),
      });
    case 'signed-json-envelope':
      return Object.freeze({
        kind: 'signed-json-envelope',
        envelopeDigest: normalizeIdentifier(proof.envelopeDigest, 'signedEnvelope.envelopeDigest'),
        subjectDigest: normalizeIdentifier(proof.subjectDigest, 'signedEnvelope.subjectDigest'),
        signatureRef: normalizeOptionalIdentifier(proof.signatureRef, 'signedEnvelope.signatureRef'),
      });
  }
}

function assertPresentationProof(mode: ReleasePresentationMode, proof: ReleasePresentationProof | null): void {
  switch (mode) {
    case 'bearer-release-token':
      return;
    case 'dpop-bound-token':
      if (proof?.kind !== 'dpop') {
        throw new Error('Release enforcement-plane DPoP-bound presentation requires a DPoP proof.');
      }
      return;
    case 'mtls-bound-token':
      if (proof?.kind !== 'mtls') {
        throw new Error('Release enforcement-plane mTLS-bound presentation requires an mTLS proof.');
      }
      return;
    case 'spiffe-bound-token':
      if (proof?.kind !== 'spiffe') {
        throw new Error('Release enforcement-plane SPIFFE-bound presentation requires a SPIFFE proof.');
      }
      return;
    case 'http-message-signature':
      if (proof?.kind !== 'http-message-signature') {
        throw new Error(
          'Release enforcement-plane HTTP message signature presentation requires an HTTP message signature proof.',
        );
      }
      return;
    case 'signed-json-envelope':
      if (proof?.kind !== 'signed-json-envelope') {
        throw new Error(
          'Release enforcement-plane signed JSON envelope presentation requires an envelope proof.',
        );
      }
      return;
  }
}

function resolveEnforcementPoint(
  reference: CreateEnforcementPointReferenceInput | EnforcementPointReference,
): EnforcementPointReference {
  if ('enforcementPointId' in reference && 'riskClass' in reference) {
    return createEnforcementPointReference(reference);
  }
  return reference;
}

function deriveOutcome(
  verification: VerificationResult,
  breakGlass: EnforcementBreakGlassGrant | null,
): EnforcementOutcome {
  if (breakGlass) {
    return 'break-glass-allow';
  }
  if (verification.mode === 'shadow-observe') {
    return 'shadow-allow';
  }
  if (verification.status === 'valid') {
    return 'allow';
  }
  if (verification.status === 'indeterminate') {
    return 'needs-introspection';
  }
  return 'deny';
}

function assertEnforcementOutcomeCoherence(
  outcome: EnforcementOutcome,
  verification: VerificationResult,
  failureReasons: readonly EnforcementFailureReason[],
  breakGlass: EnforcementBreakGlassGrant | null,
): void {
  if (outcome === 'allow' && verification.status !== 'valid') {
    throw new Error('Release enforcement-plane allow decisions require valid verification.');
  }
  if (outcome === 'deny' && failureReasons.length === 0) {
    throw new Error('Release enforcement-plane deny decisions require at least one failure reason.');
  }
  if (outcome === 'break-glass-allow' && breakGlass === null) {
    throw new Error('Release enforcement-plane break-glass allow decisions require a break-glass grant.');
  }
  if (!ENFORCEMENT_OUTCOMES.includes(outcome)) {
    throw new Error(`Release enforcement-plane unknown outcome: ${outcome}`);
  }
}

export function createEnforcementRequest(
  input: CreateEnforcementRequestInput,
): EnforcementRequest {
  const enforcementPoint = resolveEnforcementPoint(input.enforcementPoint);

  return Object.freeze({
    version: ENFORCEMENT_REQUEST_SPEC_VERSION,
    id: normalizeIdentifier(input.id, 'enforcementRequest.id'),
    receivedAt: normalizeIsoTimestamp(input.receivedAt, 'enforcementRequest.receivedAt'),
    enforcementPoint,
    enforcementPointLabel: enforcementPointReferenceLabel(enforcementPoint),
    targetId: normalizeIdentifier(input.targetId, 'enforcementRequest.targetId'),
    outputHash: normalizeIdentifier(input.outputHash, 'enforcementRequest.outputHash'),
    consequenceHash: normalizeIdentifier(
      input.consequenceHash,
      'enforcementRequest.consequenceHash',
    ),
    releaseTokenId: normalizeOptionalIdentifier(
      input.releaseTokenId,
      'enforcementRequest.releaseTokenId',
    ),
    releaseDecisionId: normalizeOptionalIdentifier(
      input.releaseDecisionId,
      'enforcementRequest.releaseDecisionId',
    ),
    requester: input.requester ?? null,
    traceId: normalizeOptionalIdentifier(input.traceId, 'enforcementRequest.traceId'),
    idempotencyKey: normalizeOptionalIdentifier(
      input.idempotencyKey,
      'enforcementRequest.idempotencyKey',
    ),
    transport: normalizeTransport(input.transport),
  });
}

export function createReleasePresentation(
  input: CreateReleasePresentationInput,
): ReleasePresentation {
  const proof = input.proof ? normalizeProof(input.proof) : null;
  assertPresentationProof(input.mode, proof);

  return Object.freeze({
    version: RELEASE_PRESENTATION_SPEC_VERSION,
    mode: input.mode,
    presentedAt: normalizeIsoTimestamp(input.presentedAt, 'releasePresentation.presentedAt'),
    releaseToken: normalizeOptionalText(input.releaseToken),
    releaseTokenId: normalizeOptionalIdentifier(
      input.releaseTokenId,
      'releasePresentation.releaseTokenId',
    ),
    releaseTokenDigest: normalizeOptionalIdentifier(
      input.releaseTokenDigest,
      'releasePresentation.releaseTokenDigest',
    ),
    issuer: normalizeOptionalIdentifier(input.issuer, 'releasePresentation.issuer'),
    subject: normalizeOptionalIdentifier(input.subject, 'releasePresentation.subject'),
    audience: normalizeOptionalIdentifier(input.audience, 'releasePresentation.audience'),
    expiresAt: normalizeOptionalIsoTimestamp(input.expiresAt, 'releasePresentation.expiresAt'),
    scope: normalizeScope(input.scope),
    proof,
  });
}

export function createIntrospectionSnapshot(
  input: CreateIntrospectionSnapshotInput,
): IntrospectionSnapshot {
  return Object.freeze({
    version: INTROSPECTION_SNAPSHOT_SPEC_VERSION,
    checkedAt: normalizeIsoTimestamp(input.checkedAt, 'introspectionSnapshot.checkedAt'),
    authority: normalizeIdentifier(input.authority, 'introspectionSnapshot.authority'),
    active: input.active,
    releaseTokenId: normalizeOptionalIdentifier(
      input.releaseTokenId,
      'introspectionSnapshot.releaseTokenId',
    ),
    releaseDecisionId: normalizeOptionalIdentifier(
      input.releaseDecisionId,
      'introspectionSnapshot.releaseDecisionId',
    ),
    issuer: normalizeOptionalIdentifier(input.issuer, 'introspectionSnapshot.issuer'),
    subject: normalizeOptionalIdentifier(input.subject, 'introspectionSnapshot.subject'),
    audience: normalizeOptionalIdentifier(input.audience, 'introspectionSnapshot.audience'),
    scope: normalizeScope(input.scope),
    issuedAt: normalizeOptionalIsoTimestamp(input.issuedAt, 'introspectionSnapshot.issuedAt'),
    expiresAt: normalizeOptionalIsoTimestamp(input.expiresAt, 'introspectionSnapshot.expiresAt'),
    notBefore: normalizeOptionalIsoTimestamp(input.notBefore, 'introspectionSnapshot.notBefore'),
    clientId: normalizeOptionalIdentifier(input.clientId, 'introspectionSnapshot.clientId'),
    consequenceType: input.consequenceType ?? null,
    riskClass: input.riskClass ?? null,
  });
}

export function createVerificationResult(
  input: CreateVerificationResultInput,
): VerificationResult {
  const failureReasons = normalizeFailureReasons(input.failureReasons);
  if (input.status === 'invalid' && failureReasons.length === 0) {
    throw new Error('Release enforcement-plane invalid verification requires a failure reason.');
  }
  if (input.status === 'valid' && failureReasons.length > 0) {
    throw new Error('Release enforcement-plane valid verification cannot carry failure reasons.');
  }

  return Object.freeze({
    version: VERIFICATION_RESULT_SPEC_VERSION,
    id: normalizeIdentifier(input.id, 'verificationResult.id'),
    checkedAt: normalizeIsoTimestamp(input.checkedAt, 'verificationResult.checkedAt'),
    mode: input.mode,
    status: input.status,
    cacheState: input.cacheState ?? 'miss',
    degradedState: input.degradedState ?? 'normal',
    presentationMode: input.presentation.mode,
    releaseTokenId: input.presentation.releaseTokenId,
    releaseDecisionId: normalizeOptionalIdentifier(
      input.releaseDecisionId,
      'verificationResult.releaseDecisionId',
    ),
    issuer: input.presentation.issuer,
    subject: input.presentation.subject,
    audience: input.presentation.audience,
    outputHash: normalizeOptionalIdentifier(input.outputHash, 'verificationResult.outputHash'),
    consequenceHash: normalizeOptionalIdentifier(
      input.consequenceHash,
      'verificationResult.consequenceHash',
    ),
    failureReasons,
    introspection: input.introspection ?? null,
  });
}

export function createEnforcementDecision(
  input: CreateEnforcementDecisionInput,
): EnforcementDecision {
  const breakGlass = input.breakGlass ?? null;
  const outcome = input.outcome ?? deriveOutcome(input.verification, breakGlass);
  const failureReasons =
    input.failureReasons !== undefined
      ? normalizeFailureReasons(input.failureReasons)
      : input.verification.failureReasons;

  assertEnforcementOutcomeCoherence(outcome, input.verification, failureReasons, breakGlass);

  return Object.freeze({
    version: ENFORCEMENT_DECISION_SPEC_VERSION,
    id: normalizeIdentifier(input.id, 'enforcementDecision.id'),
    requestId: input.request.id,
    decidedAt: normalizeIsoTimestamp(input.decidedAt, 'enforcementDecision.decidedAt'),
    outcome,
    enforcementPoint: input.request.enforcementPoint,
    releaseTokenId: input.verification.releaseTokenId,
    releaseDecisionId: input.verification.releaseDecisionId,
    verification: input.verification,
    failureReasons,
    cacheState: input.verification.cacheState,
    degradedState: input.verification.degradedState,
    breakGlass,
  });
}

export function createEnforcementReceipt(
  input: CreateEnforcementReceiptInput,
): EnforcementReceipt {
  return Object.freeze({
    version: ENFORCEMENT_RECEIPT_SPEC_VERSION,
    id: normalizeIdentifier(input.id, 'enforcementReceipt.id'),
    issuedAt: normalizeIsoTimestamp(input.issuedAt, 'enforcementReceipt.issuedAt'),
    decisionId: input.decision.id,
    requestId: input.decision.requestId,
    outcome: input.decision.outcome,
    enforcementPointLabel: enforcementPointReferenceLabel(input.decision.enforcementPoint),
    releaseTokenId: input.decision.releaseTokenId,
    releaseDecisionId: input.decision.releaseDecisionId,
    outputHash:
      normalizeOptionalIdentifier(input.outputHash, 'enforcementReceipt.outputHash') ??
      input.decision.verification.outputHash,
    consequenceHash:
      normalizeOptionalIdentifier(input.consequenceHash, 'enforcementReceipt.consequenceHash') ??
      input.decision.verification.consequenceHash,
    verificationStatus: input.decision.verification.status,
    failureReasons: input.decision.failureReasons,
    receiptDigest: normalizeOptionalIdentifier(
      input.receiptDigest,
      'enforcementReceipt.receiptDigest',
    ),
  });
}
