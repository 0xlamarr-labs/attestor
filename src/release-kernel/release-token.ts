import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, importPKCS8, importSPKI, jwtVerify, errors as joseErrors } from 'jose';
import type { JWK, JWTHeaderParameters } from 'jose';
import type {
  ReleaseDecision,
  ReleaseTokenActorClaim,
  ReleaseTokenClaims,
  ReleaseTokenConfirmationClaim,
} from './object-model.js';
import {
  buildReleaseTokenClaims,
  defaultReleaseTokenTtlSecondsForRiskClass,
  releaseDecisionExpiresAt,
} from './object-model.js';
import { derivePublicKeyIdentity } from '../signing/keys.js';

/**
 * Signed release token issuance.
 *
 * This module turns accepted release decisions into short-lived JWT/JWS
 * artifacts that downstream systems can later verify and enforce. Step 12 is
 * intentionally about issuance and cryptographic integrity; the downstream SDK
 * and middleware wrappers arrive in the next step.
 */

export const RELEASE_TOKEN_ISSUANCE_SPEC_VERSION = 'attestor.release-token-issuance.v1';
export const RELEASE_TOKEN_VERIFICATION_KEY_SPEC_VERSION =
  'attestor.release-token-verification-key.v1';
export const RELEASE_TOKEN_VERIFICATION_SPEC_VERSION = 'attestor.release-token-verification.v1';

export type ReleaseTokenSigningAlgorithm = 'EdDSA';

export interface CreateReleaseTokenIssuerInput {
  readonly issuer: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  readonly keyId?: string;
  readonly algorithm?: ReleaseTokenSigningAlgorithm;
}

export interface ReleaseTokenIssueInput {
  readonly decision: ReleaseDecision;
  readonly subject?: string;
  readonly issuedAt?: string;
  readonly tokenId?: string;
  readonly ttlSeconds?: number;
  readonly audience?: string;
  readonly scope?: string;
  readonly resource?: string;
  readonly actor?: ReleaseTokenActorClaim;
  readonly parentTokenId?: string;
  readonly exchangeId?: string;
  readonly exchangedAt?: string;
  readonly sourceAudience?: string;
  readonly tokenUse?: ReleaseTokenClaims['token_use'];
  readonly confirmation?: ReleaseTokenConfirmationClaim;
}

export interface IssuedReleaseToken {
  readonly version: typeof RELEASE_TOKEN_ISSUANCE_SPEC_VERSION;
  readonly tokenId: string;
  readonly token: string;
  readonly claims: ReleaseTokenClaims;
  readonly keyId: string;
  readonly algorithm: ReleaseTokenSigningAlgorithm;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly publicKeyFingerprint: string;
}

export interface ReleaseTokenVerificationKey {
  readonly version: typeof RELEASE_TOKEN_VERIFICATION_KEY_SPEC_VERSION;
  readonly issuer: string;
  readonly algorithm: ReleaseTokenSigningAlgorithm;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
  readonly publicKeyPem: string;
  readonly jwk: JWK;
}

export interface VerifyReleaseTokenInput {
  readonly token: string;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly audience?: string;
  readonly currentDate?: string;
}

export interface ReleaseTokenVerificationResult {
  readonly version: typeof RELEASE_TOKEN_VERIFICATION_SPEC_VERSION;
  readonly valid: true;
  readonly claims: ReleaseTokenClaims;
  readonly protectedHeader: JWTHeaderParameters;
  readonly keyId: string | null;
  readonly publicKeyFingerprint: string;
}

export type ReleaseTokenVerificationFailureCode = 'expired' | 'invalid';

export class ReleaseTokenVerificationFailure extends Error {
  readonly code: ReleaseTokenVerificationFailureCode;

  constructor(code: ReleaseTokenVerificationFailureCode, message: string) {
    super(message);
    this.name = 'ReleaseTokenVerificationFailure';
    this.code = code;
  }
}

export interface ReleaseTokenIssuer {
  issue(input: ReleaseTokenIssueInput): Promise<IssuedReleaseToken>;
  exportVerificationKey(): Promise<ReleaseTokenVerificationKey>;
}

function isExpiredJoseError(error: unknown): boolean {
  return (
    error instanceof joseErrors.JWTExpired ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ERR_JWT_EXPIRED')
  );
}

function assertDecisionEligibleForReleaseToken(decision: ReleaseDecision): void {
  if (decision.status !== 'accepted' && decision.status !== 'overridden') {
    throw new Error(
      `Release token issuance requires an accepted or overridden decision, received ${decision.status}.`,
    );
  }
}

function parseIssuedAt(issuedAt?: string): Date {
  const value = issuedAt ? new Date(issuedAt) : new Date();
  if (Number.isNaN(value.getTime())) {
    throw new Error('Release token issuance requires a valid issuedAt timestamp.');
  }

  return value;
}

function parseOptionalEpochSeconds(value: string | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Release token issuance requires a valid ${fieldName} timestamp.`);
  }

  return Math.floor(parsed.getTime() / 1000);
}

function resolveTokenTtlSeconds(decision: ReleaseDecision, issuedAt: Date, requestedTtl?: number): number {
  const maxExpiry = releaseDecisionExpiresAt(decision);

  if (requestedTtl !== undefined && requestedTtl <= 0) {
    throw new Error('Release token issuance requires ttlSeconds to be positive when provided.');
  }

  if (!maxExpiry) {
    return requestedTtl ?? defaultReleaseTokenTtlSecondsForRiskClass(decision.riskClass);
  }

  const decisionExpiry = new Date(maxExpiry);
  if (Number.isNaN(decisionExpiry.getTime())) {
    throw new Error('Release decision expiry is invalid and cannot be used for token issuance.');
  }

  const maxAllowedTtl = Math.floor((decisionExpiry.getTime() - issuedAt.getTime()) / 1000);
  if (maxAllowedTtl <= 0) {
    throw new Error('Release decision is already expired for token issuance.');
  }

  return requestedTtl === undefined ? maxAllowedTtl : Math.min(requestedTtl, maxAllowedTtl);
}

export function createReleaseTokenIssuer(
  input: CreateReleaseTokenIssuerInput,
): ReleaseTokenIssuer {
  const algorithm = input.algorithm ?? 'EdDSA';
  const keyIdentity = derivePublicKeyIdentity(input.publicKeyPem);
  const keyId = input.keyId ?? keyIdentity.fingerprint;

  return {
    async issue(issueInput: ReleaseTokenIssueInput): Promise<IssuedReleaseToken> {
      assertDecisionEligibleForReleaseToken(issueInput.decision);
      const issuedAt = parseIssuedAt(issueInput.issuedAt);
      const issuedAtEpochSeconds = Math.floor(issuedAt.getTime() / 1000);
      const ttlSeconds = resolveTokenTtlSeconds(
        issueInput.decision,
        issuedAt,
        issueInput.ttlSeconds,
      );
      const tokenId = issueInput.tokenId ?? `rt_${randomUUID()}`;
      const claims = buildReleaseTokenClaims({
        issuer: input.issuer,
        subject: issueInput.subject ?? `releaseDecision:${issueInput.decision.id}`,
        tokenId,
        issuedAtEpochSeconds,
        ttlSeconds,
        decision: issueInput.decision,
        audience: issueInput.audience,
        scope: issueInput.scope,
        resource: issueInput.resource,
        actor: issueInput.actor,
        parentTokenId: issueInput.parentTokenId,
        exchangeId: issueInput.exchangeId,
        exchangedAtEpochSeconds: parseOptionalEpochSeconds(
          issueInput.exchangedAt,
          'exchangedAt',
        ),
        sourceAudience: issueInput.sourceAudience,
        tokenUse: issueInput.tokenUse,
        confirmation: issueInput.confirmation,
      });

      const privateKey = await importPKCS8(input.privateKeyPem, algorithm);
      const token = await new SignJWT(claims as unknown as Record<string, unknown>)
        .setProtectedHeader({
          alg: algorithm,
          kid: keyId,
          typ: 'JWT',
        })
        .sign(privateKey);

      return {
        version: RELEASE_TOKEN_ISSUANCE_SPEC_VERSION,
        tokenId,
        token,
        claims,
        keyId,
        algorithm,
        issuedAt: new Date(claims.iat * 1000).toISOString(),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        publicKeyFingerprint: keyIdentity.fingerprint,
      };
    },

    async exportVerificationKey(): Promise<ReleaseTokenVerificationKey> {
      const publicKey = await importSPKI(input.publicKeyPem, algorithm);
      const jwk = await exportJWK(publicKey);

      return {
        version: RELEASE_TOKEN_VERIFICATION_KEY_SPEC_VERSION,
        issuer: input.issuer,
        algorithm,
        keyId,
        publicKeyFingerprint: keyIdentity.fingerprint,
        publicKeyPem: input.publicKeyPem,
        jwk: {
          ...jwk,
          kid: keyId,
          use: 'sig',
          alg: algorithm,
        },
      };
    },
  };
}

export async function verifyIssuedReleaseToken(
  input: VerifyReleaseTokenInput,
): Promise<ReleaseTokenVerificationResult> {
  const publicKey = await importSPKI(
    input.verificationKey.publicKeyPem,
    input.verificationKey.algorithm,
  );

  let verified;
  try {
    verified = await jwtVerify(input.token, publicKey, {
      issuer: input.verificationKey.issuer,
      audience: input.audience,
      currentDate: input.currentDate ? new Date(input.currentDate) : undefined,
    });
  } catch (error) {
    if (isExpiredJoseError(error)) {
      throw new ReleaseTokenVerificationFailure('expired', 'Release token has expired.');
    }

    const message =
      error instanceof Error ? error.message : 'Release token verification failed.';
    throw new ReleaseTokenVerificationFailure('invalid', message);
  }

  return {
    version: RELEASE_TOKEN_VERIFICATION_SPEC_VERSION,
    valid: true,
    claims: verified.payload as unknown as ReleaseTokenClaims,
    protectedHeader: verified.protectedHeader,
    keyId: verified.protectedHeader.kid ?? null,
    publicKeyFingerprint: input.verificationKey.publicKeyFingerprint,
  };
}
