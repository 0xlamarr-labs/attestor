import { createHash, randomUUID } from 'node:crypto';
import {
  SignJWT,
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair as generateJoseKeyPair,
  importJWK,
  jwtVerify,
} from 'jose';
import type { JWK, JWTPayload, ProtectedHeaderParameters } from 'jose';
import type { IssuedReleaseToken } from '../release-kernel/release-token.js';
import {
  createReleasePresentation,
  type ReleasePresentation,
  type ReleasePresentationProof,
} from './object-model.js';
import type { EnforcementFailureReason } from './types.js';
import { ENFORCEMENT_FAILURE_REASONS } from './types.js';
import type { ReplayLedgerEntry } from './freshness.js';

/**
 * DPoP-bound HTTP release presentation.
 *
 * This module implements the proof-of-possession layer for HTTP release
 * authorization: the release token can be bound to a DPoP public key via
 * `cnf.jkt`, and every HTTP request carries a signed proof over method, target
 * URI, token hash, nonce, and a replay-detectable proof `jti`.
 */

export const DPOP_PRESENTATION_SPEC_VERSION =
  'attestor.release-enforcement-dpop.v1';
export const DPOP_PROOF_JWT_TYPE = 'dpop+jwt';
export const DPOP_AUTHENTICATION_SCHEME = 'DPoP';

export type DpopSigningAlgorithm =
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA'
  | 'RS256'
  | 'PS256';

export const DEFAULT_DPOP_SIGNING_ALGORITHM: DpopSigningAlgorithm = 'ES256';
export const DEFAULT_DPOP_MAX_PROOF_AGE_SECONDS = 120;
export const DEFAULT_DPOP_CLOCK_SKEW_SECONDS = 30;

export interface DpopKeyPair {
  readonly algorithm: DpopSigningAlgorithm;
  readonly privateJwk: JWK;
  readonly publicJwk: JWK;
  readonly publicKeyThumbprint: string;
}

export interface CreateDpopProofInput {
  readonly privateJwk: JWK;
  readonly publicJwk: JWK;
  readonly algorithm?: DpopSigningAlgorithm;
  readonly httpMethod: string;
  readonly httpUri: string;
  readonly accessToken?: string | null;
  readonly nonce?: string | null;
  readonly proofJti?: string;
  readonly issuedAt?: string;
}

export interface DpopProof {
  readonly version: typeof DPOP_PRESENTATION_SPEC_VERSION;
  readonly proofJwt: string;
  readonly proofJti: string;
  readonly httpMethod: string;
  readonly httpUri: string;
  readonly issuedAt: string;
  readonly accessTokenHash: string | null;
  readonly nonce: string | null;
  readonly publicKeyThumbprint: string;
  readonly publicJwk: JWK;
}

export interface VerifyDpopProofInput {
  readonly proofJwt: string;
  readonly httpMethod: string;
  readonly httpUri: string;
  readonly accessToken?: string | null;
  readonly expectedJwkThumbprint?: string | null;
  readonly expectedNonce?: string | null;
  readonly now: string;
  readonly maxProofAgeSeconds?: number;
  readonly clockSkewSeconds?: number;
  readonly acceptedAlgorithms?: readonly DpopSigningAlgorithm[];
  readonly replayLedgerEntry?: ReplayLedgerEntry | null;
}

export interface DpopProofClaims {
  readonly jti: string;
  readonly htm: string;
  readonly htu: string;
  readonly iat: number;
  readonly ath?: string;
  readonly nonce?: string;
}

export interface DpopProofVerification {
  readonly version: typeof DPOP_PRESENTATION_SPEC_VERSION;
  readonly status: 'valid' | 'invalid';
  readonly checkedAt: string;
  readonly proofJti: string | null;
  readonly httpMethod: string | null;
  readonly httpUri: string | null;
  readonly issuedAt: string | null;
  readonly accessTokenHash: string | null;
  readonly nonce: string | null;
  readonly publicKeyThumbprint: string | null;
  readonly replayKey: string | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
}

export interface CreateDpopReleasePresentationInput {
  readonly proof: DpopProof | DpopProofVerification;
  readonly releaseToken: string;
  readonly releaseTokenId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly expiresAt: string;
  readonly presentedAt?: string;
  readonly scope?: readonly string[];
}

function uniqueFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const present = new Set(reasons);
  return Object.freeze(ENFORCEMENT_FAILURE_REASONS.filter((reason) => present.has(reason)));
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`DPoP ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeHttpMethod(method: string): string {
  return normalizeIdentifier(method, 'httpMethod').toUpperCase();
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`DPoP ${fieldName} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function epochSeconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

export function normalizeDpopHttpUri(uri: string): string {
  const parsed = new URL(normalizeIdentifier(uri, 'httpUri'));
  parsed.hash = '';
  parsed.search = '';
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

export function dpopAccessTokenHash(accessToken: string): string {
  return createHash('sha256').update(accessToken, 'ascii').digest('base64url');
}

export function dpopReplayKey(proofJti: string): string {
  return `dpop-proof:${normalizeIdentifier(proofJti, 'proofJti')}`;
}

function publicJwkForHeader(jwk: JWK): JWK {
  const {
    d: _d,
    p: _p,
    q: _q,
    dp: _dp,
    dq: _dq,
    qi: _qi,
    k: _k,
    key_ops: _keyOps,
    ext: _ext,
    ...publicJwk
  } = jwk as JWK & Record<string, unknown>;

  return publicJwk;
}

function headerContainsPrivateKey(jwk: JWK): boolean {
  const maybePrivate = jwk as Record<string, unknown>;
  return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'].some((field) => field in maybePrivate);
}

function algorithmIsAccepted(
  algorithm: string | undefined,
  acceptedAlgorithms: readonly DpopSigningAlgorithm[],
): algorithm is DpopSigningAlgorithm {
  if (!algorithm || algorithm === 'none' || algorithm.startsWith('HS')) {
    return false;
  }
  return acceptedAlgorithms.includes(algorithm as DpopSigningAlgorithm);
}

function claimString(payload: JWTPayload, claim: string): string | null {
  const value = payload[claim];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function claimNumber(payload: JWTPayload, claim: string): number | null {
  const value = payload[claim];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function proofIssuedAt(iat: number | null): string | null {
  return iat === null ? null : new Date(iat * 1000).toISOString();
}

function failureVerification(input: {
  readonly checkedAt: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly payload?: JWTPayload | null;
  readonly publicKeyThumbprint?: string | null;
  readonly accessTokenHash?: string | null;
}): DpopProofVerification {
  const payload = input.payload ?? null;
  const proofJti = payload ? claimString(payload, 'jti') : null;
  const htm = payload ? claimString(payload, 'htm') : null;
  const htu = payload ? claimString(payload, 'htu') : null;
  const iat = payload ? claimNumber(payload, 'iat') : null;
  const nonce = payload ? claimString(payload, 'nonce') : null;

  return Object.freeze({
    version: DPOP_PRESENTATION_SPEC_VERSION,
    status: 'invalid',
    checkedAt: input.checkedAt,
    proofJti,
    httpMethod: htm,
    httpUri: htu,
    issuedAt: proofIssuedAt(iat),
    accessTokenHash: input.accessTokenHash ?? (payload ? claimString(payload, 'ath') : null),
    nonce,
    publicKeyThumbprint: input.publicKeyThumbprint ?? null,
    replayKey: proofJti ? dpopReplayKey(proofJti) : null,
    failureReasons: uniqueFailureReasons(input.failureReasons),
  });
}

function proofTimeFailureReasons(input: {
  readonly iat: number;
  readonly now: string;
  readonly maxProofAgeSeconds: number;
  readonly clockSkewSeconds: number;
}): readonly EnforcementFailureReason[] {
  const now = epochSeconds(input.now);
  const reasons: EnforcementFailureReason[] = [];

  if (input.iat > now + input.clockSkewSeconds) {
    reasons.push('future-issued-at');
  }

  if (now - input.iat > input.maxProofAgeSeconds + input.clockSkewSeconds) {
    reasons.push('stale-authorization');
  }

  return reasons;
}

async function calculatePublicJwkThumbprint(publicJwk: JWK): Promise<string> {
  return calculateJwkThumbprint(publicJwk, 'sha256');
}

export async function generateDpopKeyPair(
  algorithm: DpopSigningAlgorithm = DEFAULT_DPOP_SIGNING_ALGORITHM,
): Promise<DpopKeyPair> {
  const keyPair = await generateJoseKeyPair(algorithm, { extractable: true });
  const privateJwk = await exportJWK(keyPair.privateKey);
  const publicJwk = publicJwkForHeader(await exportJWK(keyPair.publicKey));
  const publicKeyThumbprint = await calculatePublicJwkThumbprint(publicJwk);

  return Object.freeze({
    algorithm,
    privateJwk: Object.freeze({
      ...privateJwk,
      alg: algorithm,
    }),
    publicJwk: Object.freeze({
      ...publicJwk,
      alg: algorithm,
    }),
    publicKeyThumbprint,
  });
}

export async function createDpopProof(
  input: CreateDpopProofInput,
): Promise<DpopProof> {
  const algorithm = input.algorithm ?? DEFAULT_DPOP_SIGNING_ALGORITHM;
  const httpMethod = normalizeHttpMethod(input.httpMethod);
  const httpUri = normalizeDpopHttpUri(input.httpUri);
  const issuedAt = normalizeIsoTimestamp(input.issuedAt ?? new Date().toISOString(), 'issuedAt');
  const proofJti = input.proofJti ?? `dpop_${randomUUID()}`;
  const publicJwk = Object.freeze({
    ...publicJwkForHeader(input.publicJwk),
    alg: algorithm,
  });
  const publicKeyThumbprint = await calculatePublicJwkThumbprint(publicJwk);
  const accessTokenHash = input.accessToken ? dpopAccessTokenHash(input.accessToken) : null;
  const payload: DpopProofClaims = {
    jti: proofJti,
    htm: httpMethod,
    htu: httpUri,
    iat: epochSeconds(issuedAt),
    ...(accessTokenHash ? { ath: accessTokenHash } : {}),
    ...(input.nonce ? { nonce: input.nonce } : {}),
  };
  const privateKey = await importJWK(input.privateJwk, algorithm);
  const proofJwt = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({
      typ: DPOP_PROOF_JWT_TYPE,
      alg: algorithm,
      jwk: publicJwk,
    })
    .sign(privateKey);

  return Object.freeze({
    version: DPOP_PRESENTATION_SPEC_VERSION,
    proofJwt,
    proofJti,
    httpMethod,
    httpUri,
    issuedAt,
    accessTokenHash,
    nonce: input.nonce ?? null,
    publicKeyThumbprint,
    publicJwk,
  });
}

export async function verifyDpopProof(
  input: VerifyDpopProofInput,
): Promise<DpopProofVerification> {
  const checkedAt = normalizeIsoTimestamp(input.now, 'now');
  const acceptedAlgorithms =
    input.acceptedAlgorithms ?? [DEFAULT_DPOP_SIGNING_ALGORITHM, 'EdDSA'];
  let header: ProtectedHeaderParameters;
  let payload: JWTPayload;

  try {
    header = decodeProtectedHeader(input.proofJwt);
    payload = decodeJwt(input.proofJwt);
  } catch {
    return failureVerification({
      checkedAt,
      failureReasons: ['invalid-signature'],
    });
  }

  const proofJti = claimString(payload, 'jti');
  const htm = claimString(payload, 'htm');
  const htu = claimString(payload, 'htu');
  const iat = claimNumber(payload, 'iat');
  const ath = claimString(payload, 'ath');
  const nonce = claimString(payload, 'nonce');
  const proofShapeFailures: EnforcementFailureReason[] = [];

  if (header.typ !== DPOP_PROOF_JWT_TYPE) {
    proofShapeFailures.push('invalid-signature');
  }

  if (!algorithmIsAccepted(header.alg, acceptedAlgorithms)) {
    proofShapeFailures.push('invalid-signature');
  }

  if (
    typeof header.jwk !== 'object' ||
    header.jwk === null ||
    headerContainsPrivateKey(header.jwk as JWK)
  ) {
    proofShapeFailures.push('invalid-signature');
  }

  if (!proofJti || !htm || !htu || iat === null) {
    proofShapeFailures.push('invalid-signature');
  }

  if (
    proofShapeFailures.length > 0 ||
    proofJti === null ||
    htm === null ||
    htu === null ||
    iat === null ||
    !algorithmIsAccepted(header.alg, acceptedAlgorithms)
  ) {
    return failureVerification({
      checkedAt,
      failureReasons: proofShapeFailures.length > 0 ? proofShapeFailures : ['invalid-signature'],
      payload,
    });
  }

  const publicJwk = header.jwk as JWK;
  let publicKeyThumbprint: string;
  try {
    publicKeyThumbprint = await calculatePublicJwkThumbprint(publicJwk);
    const publicKey = await importJWK(publicJwk, header.alg);
    await jwtVerify(input.proofJwt, publicKey);
  } catch {
    return failureVerification({
      checkedAt,
      failureReasons: ['invalid-signature'],
      payload,
    });
  }

  const expectedMethod = normalizeHttpMethod(input.httpMethod);
  const expectedUri = normalizeDpopHttpUri(input.httpUri);
  const expectedAccessTokenHash = input.accessToken
    ? dpopAccessTokenHash(input.accessToken)
    : null;
  const failureReasons: EnforcementFailureReason[] = [];

  if (htm !== expectedMethod || htu !== expectedUri) {
    failureReasons.push('binding-mismatch');
  }

  if (expectedAccessTokenHash !== null) {
    if (ath !== expectedAccessTokenHash) {
      failureReasons.push('binding-mismatch');
    }
  } else if (ath !== null) {
    failureReasons.push('binding-mismatch');
  }

  if (
    input.expectedJwkThumbprint !== undefined &&
    input.expectedJwkThumbprint !== null &&
    publicKeyThumbprint !== input.expectedJwkThumbprint
  ) {
    failureReasons.push('binding-mismatch');
  }

  if (input.expectedNonce !== undefined && input.expectedNonce !== null) {
    if (nonce === null) {
      failureReasons.push('missing-nonce');
    } else if (nonce !== input.expectedNonce) {
      failureReasons.push('invalid-nonce');
    }
  }

  failureReasons.push(
    ...proofTimeFailureReasons({
      iat,
      now: checkedAt,
      maxProofAgeSeconds:
        input.maxProofAgeSeconds ?? DEFAULT_DPOP_MAX_PROOF_AGE_SECONDS,
      clockSkewSeconds:
        input.clockSkewSeconds ?? DEFAULT_DPOP_CLOCK_SKEW_SECONDS,
    }),
  );

  const replayKey = dpopReplayKey(proofJti);
  if (
    input.replayLedgerEntry &&
    input.replayLedgerEntry.key === replayKey &&
    new Date(input.replayLedgerEntry.expiresAt).getTime() >= new Date(checkedAt).getTime()
  ) {
    failureReasons.push('replayed-authorization');
  }

  const uniqueFailures = uniqueFailureReasons(failureReasons);
  return Object.freeze({
    version: DPOP_PRESENTATION_SPEC_VERSION,
    status: uniqueFailures.length === 0 ? 'valid' : 'invalid',
    checkedAt,
    proofJti,
    httpMethod: htm,
    httpUri: htu,
    issuedAt: proofIssuedAt(iat),
    accessTokenHash: ath ?? null,
    nonce,
    publicKeyThumbprint,
    replayKey,
    failureReasons: uniqueFailures,
  });
}

function proofFromDpop(proof: DpopProof | DpopProofVerification): ReleasePresentationProof {
  if (proof.proofJti === null || proof.httpMethod === null || proof.httpUri === null) {
    throw new Error('DPoP release presentation requires a complete proof.');
  }

  if (proof.publicKeyThumbprint === null) {
    throw new Error('DPoP release presentation requires a public key thumbprint.');
  }

  const proofJwt = 'proofJwt' in proof ? proof.proofJwt : '';
  if (proofJwt.length === 0) {
    throw new Error('DPoP release presentation requires the original proof JWT.');
  }

  return Object.freeze({
    kind: 'dpop',
    proofJwt,
    httpMethod: proof.httpMethod,
    httpUri: proof.httpUri,
    proofJti: proof.proofJti,
    accessTokenHash: proof.accessTokenHash,
    nonce: proof.nonce,
    keyThumbprint: proof.publicKeyThumbprint,
  });
}

export function createDpopBoundReleasePresentation(
  input: CreateDpopReleasePresentationInput,
): ReleasePresentation {
  return createReleasePresentation({
    mode: 'dpop-bound-token',
    presentedAt: input.presentedAt ?? new Date().toISOString(),
    releaseToken: input.releaseToken,
    releaseTokenId: input.releaseTokenId,
    releaseTokenDigest: `sha256:${createHash('sha256').update(input.releaseToken).digest('hex')}`,
    issuer: input.issuer,
    subject: input.subject,
    audience: input.audience,
    expiresAt: input.expiresAt,
    scope: input.scope,
    proof: proofFromDpop(input.proof),
  });
}

export function createDpopBoundPresentationFromIssuedToken(input: {
  readonly issuedToken: IssuedReleaseToken;
  readonly proof: DpopProof;
  readonly presentedAt?: string;
  readonly scope?: readonly string[];
}): ReleasePresentation {
  return createDpopBoundReleasePresentation({
    proof: input.proof,
    releaseToken: input.issuedToken.token,
    releaseTokenId: input.issuedToken.tokenId,
    issuer: input.issuedToken.claims.iss,
    subject: input.issuedToken.claims.sub,
    audience: input.issuedToken.claims.aud,
    expiresAt: input.issuedToken.expiresAt,
    presentedAt: input.presentedAt,
    scope: input.scope ?? input.issuedToken.claims.scope?.split(/\s+/) ?? [],
  });
}
