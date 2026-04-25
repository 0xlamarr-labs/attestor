/**
 * Attestor OIDC Identity Verification
 *
 * Binds reviewer identity to enterprise directory services via OIDC.
 * Transforms reviewer identity from "operator-asserted" to "token-verified":
 * if a valid OIDC ID token is provided, the reviewer's name, email, and
 * organizational claims come from the identity provider — not from CLI input.
 *
 * DESIGN:
 * - Accepts an OIDC ID token (JWT)
 * - Validates the token signature against the issuer's JWKS endpoint
 * - Extracts identity claims (sub, email, name, roles)
 * - Returns a verified ReviewerIdentity
 *
 * SUPPORTED PROVIDERS (any OIDC-compliant):
 * - Microsoft Entra ID (Azure AD)
 * - Okta / Auth0
 * - Google Workspace
 * - Keycloak
 * - Any provider with a .well-known/openid-configuration endpoint
 *
 * BOUNDARY:
 * - This validates tokens. It does not implement login flows.
 * - The operator obtains the token externally (browser SSO, device flow, CLI login)
 * - Attestor verifies the token and extracts identity
 * - No token storage, no refresh, no session management
 */

import * as jose from 'jose';
import type { ReviewerIdentity } from '../financial/types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OidcVerificationResult {
  verified: boolean;
  /** Verified reviewer identity from the token. Null if verification failed. */
  identity: ReviewerIdentity | null;
  /** Token issuer (e.g., https://login.microsoftonline.com/tenant/v2.0). */
  issuer: string | null;
  /** Token subject (unique user ID from the provider). */
  subject: string | null;
  /** Token audience. */
  audience: string | null;
  /** Token expiration. */
  expiresAt: string | null;
  /** Verification method. */
  method: 'oidc_jwks';
  /** Error message if verification failed. */
  error: string | null;
}

export interface OidcConfig {
  /** OIDC issuer URL (e.g., https://login.microsoftonline.com/tenant/v2.0). */
  issuer: string;
  /** Expected audience (client ID). If provided, audience is checked. */
  audience?: string;
  /** Clock tolerance in seconds for exp/nbf checks. Default: 60. */
  clockToleranceSec?: number;
}

// ─── Token Verification ─────────────────────────────────────────────────────

/**
 * Verify an OIDC ID token and extract reviewer identity.
 *
 * The token signature is verified against the issuer's JWKS endpoint
 * (fetched from {issuer}/.well-known/openid-configuration → jwks_uri).
 * This is a real cryptographic verification, not just JWT decoding.
 */
export async function verifyOidcToken(
  token: string,
  config: OidcConfig,
): Promise<OidcVerificationResult> {
  try {
    // Discover JWKS URI from OIDC well-known config.
    // jose needs the jwks_uri directly, not the openid-configuration document.
    const discoveryUrl = `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const discoveryResponse = await fetch(discoveryUrl);
    if (!discoveryResponse.ok) {
      return makeError(`OIDC discovery failed: ${discoveryResponse.status} from ${discoveryUrl}`);
    }
    const discoveryDoc = await discoveryResponse.json() as { jwks_uri?: string; issuer?: string };
    if (!discoveryDoc.jwks_uri) {
      return makeError(`OIDC discovery did not return jwks_uri`);
    }

    const jwks = jose.createRemoteJWKSet(new URL(discoveryDoc.jwks_uri));

    // Verify the token
    const verifyOptions: jose.JWTVerifyOptions = {
      issuer: config.issuer,
      clockTolerance: config.clockToleranceSec ?? 60,
    };
    if (config.audience) {
      verifyOptions.audience = config.audience;
    }

    const { payload } = await jose.jwtVerify(token, jwks, verifyOptions);

    // Extract identity claims
    const name = (payload.name as string) ?? (payload.preferred_username as string) ?? (payload.email as string) ?? payload.sub ?? 'unknown';
    const email = (payload.email as string) ?? null;
    const sub = payload.sub ?? null;
    const roles = Array.isArray(payload.roles) ? payload.roles as string[] : [];

    const identity: ReviewerIdentity = {
      name: typeof name === 'string' ? name : 'unknown',
      role: roles.length > 0 ? roles[0] : 'oidc_verified_user',
      identifier: email ?? sub ?? 'unknown',
      signerFingerprint: null, // populated later when signing
    };

    return {
      verified: true,
      identity,
      issuer: payload.iss ?? null,
      subject: sub,
      audience: typeof payload.aud === 'string' ? payload.aud : Array.isArray(payload.aud) ? payload.aud[0] : null,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      method: 'oidc_jwks',
      error: null,
    };
  } catch (err) {
    return makeError(err instanceof Error ? err.message : String(err));
  }
}

function makeError(message: string): OidcVerificationResult {
  return {
    verified: false,
    identity: null,
    issuer: null,
    subject: null,
    audience: null,
    expiresAt: null,
    method: 'oidc_jwks',
    error: message,
  };
}

// ─── Offline Token Decode (no verification — for inspection only) ───────────

/**
 * Decode a JWT without verification. For inspection and debugging only.
 * Returns the payload claims without checking the signature.
 */
export function decodeTokenUnsafe(token: string): Record<string, unknown> | null {
  try {
    const payload = jose.decodeJwt(token);
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Identity Source Classification ─────────────────────────────────────────

export type IdentitySource = 'operator_asserted' | 'oidc_verified' | 'pki_bound';

/**
 * Classify how a reviewer identity was established.
 * This is used in artifacts to distinguish trust levels.
 */
export function classifyIdentitySource(
  oidcVerified: boolean,
  pkiBound: boolean,
): IdentitySource {
  if (pkiBound) return 'pki_bound';
  if (oidcVerified) return 'oidc_verified';
  return 'operator_asserted';
}
