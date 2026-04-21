import { createHash } from 'node:crypto';
import type { IssuedReleaseToken } from '../release-kernel/release-token.js';
import type {
  ReleaseTokenClaims,
  ReleaseTokenConfirmationClaim,
} from '../release-kernel/object-model.js';
import {
  createReleasePresentation,
  type ReleasePresentation,
  type ReleasePresentationProof,
} from './object-model.js';
import type { EnforcementFailureReason } from './types.js';
import { ENFORCEMENT_FAILURE_REASONS } from './types.js';

/**
 * Workload-bound release presentation.
 *
 * This is the mTLS/SPIFFE sender-constrained path for service-to-service
 * enforcement. The verifier intentionally consumes certificate thumbprints and
 * SPIFFE identities that were extracted by the PEP's trusted TLS/proxy layer;
 * X.509 path validation and SPIFFE bundle validation happen before this module.
 */

export const WORKLOAD_BINDING_PRESENTATION_SPEC_VERSION =
  'attestor.release-enforcement-workload-binding.v1';
export const MTLS_CERTIFICATE_CONFIRMATION_CLAIM = 'x5t#S256';

export interface WorkloadBindingConfirmationInput {
  readonly certificateThumbprint?: string | null;
  readonly spiffeId?: string | null;
  readonly trustDomain?: string | null;
}

export interface CreateMtlsBoundReleasePresentationInput {
  readonly issuedToken: IssuedReleaseToken;
  readonly certificateThumbprint: string;
  readonly subjectDn?: string | null;
  readonly spiffeId?: string | null;
  readonly presentedAt?: string;
  readonly scope?: readonly string[];
}

export interface CreateSpiffeBoundReleasePresentationInput {
  readonly issuedToken: IssuedReleaseToken;
  readonly spiffeId: string;
  readonly svidThumbprint?: string | null;
  readonly presentedAt?: string;
  readonly scope?: readonly string[];
}

export interface VerifyWorkloadBoundPresentationInput {
  readonly presentation: ReleasePresentation;
  readonly claims: ReleaseTokenClaims;
  readonly expectedSpiffeId?: string | null;
  readonly expectedTrustDomain?: string | null;
  readonly expectedCertificateThumbprint?: string | null;
  readonly checkedAt: string;
}

export interface WorkloadBoundPresentationVerification {
  readonly version: typeof WORKLOAD_BINDING_PRESENTATION_SPEC_VERSION;
  readonly status: 'valid' | 'invalid';
  readonly checkedAt: string;
  readonly presentationMode: 'mtls-bound-token' | 'spiffe-bound-token';
  readonly certificateThumbprint: string | null;
  readonly spiffeId: string | null;
  readonly trustDomain: string | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Workload binding ${fieldName} requires a non-empty value.`);
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
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Workload binding ${fieldName} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function uniqueFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const present = new Set(reasons);
  return Object.freeze(ENFORCEMENT_FAILURE_REASONS.filter((reason) => present.has(reason)));
}

export function certificateThumbprintFromDer(derCertificate: Uint8Array | Buffer): string {
  return createHash('sha256').update(derCertificate).digest('base64url');
}

export function certificateThumbprintFromPem(pemCertificate: string): string {
  const body = pemCertificate
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');

  if (body.length === 0) {
    throw new Error('Workload binding PEM certificate requires a certificate body.');
  }

  return certificateThumbprintFromDer(Buffer.from(body, 'base64'));
}

export function normalizeCertificateThumbprint(thumbprint: string): string {
  return normalizeIdentifier(thumbprint, 'certificateThumbprint');
}

export function normalizeSpiffeId(spiffeId: string): string {
  const raw = normalizeIdentifier(spiffeId, 'spiffeId');
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Workload binding SPIFFE ID must be a valid URI.');
  }

  if (parsed.protocol !== 'spiffe:') {
    throw new Error('Workload binding SPIFFE ID must use the spiffe scheme.');
  }

  if (parsed.hostname.length === 0) {
    throw new Error('Workload binding SPIFFE ID must include a trust domain.');
  }

  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error(
      'Workload binding SPIFFE ID must not include userinfo, port, query, or fragment.',
    );
  }

  return `spiffe://${parsed.hostname.toLowerCase()}${parsed.pathname}`;
}

export function trustDomainFromSpiffeId(spiffeId: string): string {
  return new URL(normalizeSpiffeId(spiffeId)).hostname.toLowerCase();
}

function normalizeTrustDomain(trustDomain: string): string {
  return normalizeIdentifier(trustDomain, 'trustDomain').toLowerCase();
}

export function createMtlsReleaseTokenConfirmation(
  input: WorkloadBindingConfirmationInput,
): ReleaseTokenConfirmationClaim {
  const certificateThumbprint = normalizeOptionalIdentifier(
    input.certificateThumbprint,
    'certificateThumbprint',
  );
  const spiffeId = input.spiffeId ? normalizeSpiffeId(input.spiffeId) : null;
  const trustDomain =
    input.trustDomain !== undefined && input.trustDomain !== null
      ? normalizeTrustDomain(input.trustDomain)
      : spiffeId
        ? trustDomainFromSpiffeId(spiffeId)
        : null;

  if (certificateThumbprint === null) {
    throw new Error('Workload binding mTLS confirmation requires a certificate thumbprint.');
  }

  if (spiffeId !== null && trustDomain !== trustDomainFromSpiffeId(spiffeId)) {
    throw new Error('Workload binding SPIFFE trust domain must match the SPIFFE ID.');
  }

  return Object.freeze({
    [MTLS_CERTIFICATE_CONFIRMATION_CLAIM]: certificateThumbprint,
    ...(spiffeId ? { spiffe_id: spiffeId } : {}),
    ...(trustDomain ? { spiffe_trust_domain: trustDomain } : {}),
  });
}

export function createSpiffeReleaseTokenConfirmation(
  input: WorkloadBindingConfirmationInput,
): ReleaseTokenConfirmationClaim {
  if (!input.spiffeId) {
    throw new Error('Workload binding SPIFFE confirmation requires a SPIFFE ID.');
  }

  const spiffeId = normalizeSpiffeId(input.spiffeId);
  const trustDomain =
    input.trustDomain !== undefined && input.trustDomain !== null
      ? normalizeTrustDomain(input.trustDomain)
      : trustDomainFromSpiffeId(spiffeId);
  const certificateThumbprint = normalizeOptionalIdentifier(
    input.certificateThumbprint,
    'certificateThumbprint',
  );

  if (trustDomain !== trustDomainFromSpiffeId(spiffeId)) {
    throw new Error('Workload binding SPIFFE trust domain must match the SPIFFE ID.');
  }

  return Object.freeze({
    ...(certificateThumbprint ? { [MTLS_CERTIFICATE_CONFIRMATION_CLAIM]: certificateThumbprint } : {}),
    spiffe_id: spiffeId,
    spiffe_trust_domain: trustDomain,
  });
}

function tokenDigest(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function scopeFromIssuedToken(
  issuedToken: IssuedReleaseToken,
  scope: readonly string[] | undefined,
): readonly string[] {
  return scope ?? issuedToken.claims.scope?.split(/\s+/) ?? [];
}

export function createMtlsBoundPresentationFromIssuedToken(
  input: CreateMtlsBoundReleasePresentationInput,
): ReleasePresentation {
  const proof: ReleasePresentationProof = Object.freeze({
    kind: 'mtls',
    certificateThumbprint: normalizeCertificateThumbprint(input.certificateThumbprint),
    subjectDn: normalizeOptionalIdentifier(input.subjectDn, 'subjectDn'),
    spiffeId: input.spiffeId ? normalizeSpiffeId(input.spiffeId) : null,
  });

  return createReleasePresentation({
    mode: 'mtls-bound-token',
    presentedAt: input.presentedAt ?? new Date().toISOString(),
    releaseToken: input.issuedToken.token,
    releaseTokenId: input.issuedToken.tokenId,
    releaseTokenDigest: tokenDigest(input.issuedToken.token),
    issuer: input.issuedToken.claims.iss,
    subject: input.issuedToken.claims.sub,
    audience: input.issuedToken.claims.aud,
    expiresAt: input.issuedToken.expiresAt,
    scope: scopeFromIssuedToken(input.issuedToken, input.scope),
    proof,
  });
}

export function createSpiffeBoundPresentationFromIssuedToken(
  input: CreateSpiffeBoundReleasePresentationInput,
): ReleasePresentation {
  const spiffeId = normalizeSpiffeId(input.spiffeId);
  const proof: ReleasePresentationProof = Object.freeze({
    kind: 'spiffe',
    spiffeId,
    trustDomain: trustDomainFromSpiffeId(spiffeId),
    svidThumbprint: normalizeOptionalIdentifier(input.svidThumbprint, 'svidThumbprint'),
  });

  return createReleasePresentation({
    mode: 'spiffe-bound-token',
    presentedAt: input.presentedAt ?? new Date().toISOString(),
    releaseToken: input.issuedToken.token,
    releaseTokenId: input.issuedToken.tokenId,
    releaseTokenDigest: tokenDigest(input.issuedToken.token),
    issuer: input.issuedToken.claims.iss,
    subject: input.issuedToken.claims.sub,
    audience: input.issuedToken.claims.aud,
    expiresAt: input.issuedToken.expiresAt,
    scope: scopeFromIssuedToken(input.issuedToken, input.scope),
    proof,
  });
}

function confirmationCertificateThumbprint(
  claims: ReleaseTokenClaims,
): string | null {
  return claims.cnf?.[MTLS_CERTIFICATE_CONFIRMATION_CLAIM] ?? null;
}

function confirmationSpiffeId(claims: ReleaseTokenClaims): string | null {
  return claims.cnf?.spiffe_id ? normalizeSpiffeId(claims.cnf.spiffe_id) : null;
}

function confirmationTrustDomain(claims: ReleaseTokenClaims): string | null {
  return claims.cnf?.spiffe_trust_domain
    ? normalizeTrustDomain(claims.cnf.spiffe_trust_domain)
    : null;
}

function mismatchIf(
  condition: boolean,
  reasons: EnforcementFailureReason[],
): void {
  if (condition) {
    reasons.push('binding-mismatch');
  }
}

function verifyMtlsBinding(input: {
  readonly proof: Extract<ReleasePresentationProof, { kind: 'mtls' }> | null;
  readonly claims: ReleaseTokenClaims;
  readonly expectedSpiffeId: string | null;
  readonly expectedTrustDomain: string | null;
  readonly expectedCertificateThumbprint: string | null;
}): {
  readonly certificateThumbprint: string | null;
  readonly spiffeId: string | null;
  readonly trustDomain: string | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
} {
  const reasons: EnforcementFailureReason[] = [];
  const claimCertificateThumbprint = confirmationCertificateThumbprint(input.claims);
  const claimSpiffeId = confirmationSpiffeId(input.claims);
  const claimTrustDomain = confirmationTrustDomain(input.claims);
  const proofCertificateThumbprint = input.proof?.certificateThumbprint ?? null;
  const proofSpiffeId = input.proof?.spiffeId ? normalizeSpiffeId(input.proof.spiffeId) : null;
  const proofTrustDomain = proofSpiffeId ? trustDomainFromSpiffeId(proofSpiffeId) : null;

  mismatchIf(input.proof === null, reasons);
  mismatchIf(claimCertificateThumbprint === null, reasons);
  mismatchIf(
    claimCertificateThumbprint !== null &&
      proofCertificateThumbprint !== null &&
      proofCertificateThumbprint !== claimCertificateThumbprint,
    reasons,
  );
  mismatchIf(
    input.expectedCertificateThumbprint !== null &&
      proofCertificateThumbprint !== input.expectedCertificateThumbprint,
    reasons,
  );
  mismatchIf(claimSpiffeId !== null && proofSpiffeId !== claimSpiffeId, reasons);
  mismatchIf(input.expectedSpiffeId !== null && proofSpiffeId !== input.expectedSpiffeId, reasons);
  mismatchIf(claimTrustDomain !== null && proofTrustDomain !== claimTrustDomain, reasons);
  mismatchIf(
    input.expectedTrustDomain !== null && proofTrustDomain !== input.expectedTrustDomain,
    reasons,
  );

  return Object.freeze({
    certificateThumbprint: proofCertificateThumbprint,
    spiffeId: proofSpiffeId,
    trustDomain: proofTrustDomain,
    failureReasons: uniqueFailureReasons(reasons),
  });
}

function verifySpiffeBinding(input: {
  readonly proof: Extract<ReleasePresentationProof, { kind: 'spiffe' }> | null;
  readonly claims: ReleaseTokenClaims;
  readonly expectedSpiffeId: string | null;
  readonly expectedTrustDomain: string | null;
  readonly expectedCertificateThumbprint: string | null;
}): {
  readonly certificateThumbprint: string | null;
  readonly spiffeId: string | null;
  readonly trustDomain: string | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
} {
  const reasons: EnforcementFailureReason[] = [];
  const claimCertificateThumbprint = confirmationCertificateThumbprint(input.claims);
  const claimSpiffeId = confirmationSpiffeId(input.claims);
  const claimTrustDomain = confirmationTrustDomain(input.claims);
  const proofSpiffeId = input.proof ? normalizeSpiffeId(input.proof.spiffeId) : null;
  const proofTrustDomain = input.proof ? normalizeTrustDomain(input.proof.trustDomain) : null;
  const proofDerivedTrustDomain = proofSpiffeId ? trustDomainFromSpiffeId(proofSpiffeId) : null;
  const proofSvidThumbprint = input.proof?.svidThumbprint ?? null;

  mismatchIf(input.proof === null, reasons);
  mismatchIf(claimSpiffeId === null, reasons);
  mismatchIf(claimSpiffeId !== null && proofSpiffeId !== claimSpiffeId, reasons);
  mismatchIf(proofTrustDomain !== null && proofTrustDomain !== proofDerivedTrustDomain, reasons);
  mismatchIf(claimTrustDomain !== null && proofTrustDomain !== claimTrustDomain, reasons);
  mismatchIf(input.expectedSpiffeId !== null && proofSpiffeId !== input.expectedSpiffeId, reasons);
  mismatchIf(input.expectedTrustDomain !== null && proofTrustDomain !== input.expectedTrustDomain, reasons);
  mismatchIf(
    claimCertificateThumbprint !== null && proofSvidThumbprint !== claimCertificateThumbprint,
    reasons,
  );
  mismatchIf(
    input.expectedCertificateThumbprint !== null &&
      proofSvidThumbprint !== input.expectedCertificateThumbprint,
    reasons,
  );

  return Object.freeze({
    certificateThumbprint: proofSvidThumbprint,
    spiffeId: proofSpiffeId,
    trustDomain: proofTrustDomain,
    failureReasons: uniqueFailureReasons(reasons),
  });
}

export function verifyWorkloadBoundPresentation(
  input: VerifyWorkloadBoundPresentationInput,
): WorkloadBoundPresentationVerification {
  const checkedAt = normalizeIsoTimestamp(input.checkedAt, 'checkedAt');
  const expectedSpiffeId = input.expectedSpiffeId ? normalizeSpiffeId(input.expectedSpiffeId) : null;
  const expectedTrustDomain = input.expectedTrustDomain
    ? normalizeTrustDomain(input.expectedTrustDomain)
    : null;
  const expectedCertificateThumbprint = input.expectedCertificateThumbprint
    ? normalizeCertificateThumbprint(input.expectedCertificateThumbprint)
    : null;

  if (input.presentation.mode === 'mtls-bound-token') {
    const proof = input.presentation.proof?.kind === 'mtls' ? input.presentation.proof : null;
    const verified = verifyMtlsBinding({
      proof,
      claims: input.claims,
      expectedSpiffeId,
      expectedTrustDomain,
      expectedCertificateThumbprint,
    });

    return Object.freeze({
      version: WORKLOAD_BINDING_PRESENTATION_SPEC_VERSION,
      status: verified.failureReasons.length === 0 ? 'valid' : 'invalid',
      checkedAt,
      presentationMode: 'mtls-bound-token',
      certificateThumbprint: verified.certificateThumbprint,
      spiffeId: verified.spiffeId,
      trustDomain: verified.trustDomain,
      failureReasons: verified.failureReasons,
    });
  }

  if (input.presentation.mode === 'spiffe-bound-token') {
    const proof = input.presentation.proof?.kind === 'spiffe' ? input.presentation.proof : null;
    const verified = verifySpiffeBinding({
      proof,
      claims: input.claims,
      expectedSpiffeId,
      expectedTrustDomain,
      expectedCertificateThumbprint,
    });

    return Object.freeze({
      version: WORKLOAD_BINDING_PRESENTATION_SPEC_VERSION,
      status: verified.failureReasons.length === 0 ? 'valid' : 'invalid',
      checkedAt,
      presentationMode: 'spiffe-bound-token',
      certificateThumbprint: verified.certificateThumbprint,
      spiffeId: verified.spiffeId,
      trustDomain: verified.trustDomain,
      failureReasons: verified.failureReasons,
    });
  }

  throw new Error('Workload binding verifier only supports mTLS or SPIFFE-bound presentations.');
}
