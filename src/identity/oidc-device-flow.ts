/**
 * OIDC Device Authorization Flow for CLI Reviewer Login
 *
 * Implements RFC 8628 Device Authorization Grant:
 * 1. CLI requests a device code + user code from the IdP
 * 2. CLI displays a URL and user code to the operator
 * 3. Operator opens the URL in a browser, authenticates (including MFA)
 * 4. CLI polls until auth completes, receives tokens
 * 5. Reviewer identity extracted from ID token claims
 *
 * Supports any OIDC-compliant provider:
 * - Microsoft Entra ID (Azure AD)
 * - Okta / Auth0
 * - Google Workspace
 * - Keycloak
 *
 * BOUNDARY:
 * - Implements login + identity extraction
 * - Does NOT implement token refresh, session persistence, or key rotation
 * - Those are Phase 2 enhancements
 */

import * as client from 'openid-client';
import type { ReviewerIdentity } from '../financial/types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OidcDeviceFlowConfig {
  /** OIDC issuer URL (e.g., https://login.microsoftonline.com/tenant/v2.0). */
  issuerUrl: string;
  /** Client ID registered with the IdP. */
  clientId: string;
  /** Scopes to request. Default: 'openid email profile'. */
  scopes?: string;
}

export interface OidcDeviceFlowResult {
  success: boolean;
  /** Verified reviewer identity from the token. */
  identity: ReviewerIdentity | null;
  /** Raw ID token claims. */
  claims: Record<string, unknown> | null;
  /** Token issuer. */
  issuer: string | null;
  /** Token subject. */
  subject: string | null;
  /** How the user authenticated (MFA indicators). */
  authMethods: string[] | null;
  /** Cacheable token material. */
  accessToken: string | null;
  idToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  /** Error message if flow failed. */
  error: string | null;
}

// ─── Device Flow ────────────────────────────────────────────────────────────

/**
 * Execute the OIDC Device Authorization Flow.
 *
 * This is a blocking operation that:
 * 1. Contacts the IdP for a device code
 * 2. Prints instructions for the operator
 * 3. Polls until the operator completes browser authentication
 * 4. Returns the verified identity
 *
 * The operator MUST open a browser and authenticate — this cannot be automated.
 */
export async function executeDeviceFlow(
  config: OidcDeviceFlowConfig,
  printFn: (msg: string) => void = console.log,
): Promise<OidcDeviceFlowResult> {
  try {
    // 1. Discover IdP metadata
    const issuerUrl = new URL(config.issuerUrl);
    const serverConfig = await client.discovery(issuerUrl, config.clientId);

    // 2. Request device authorization
    const deviceResponse = await client.initiateDeviceAuthorization(serverConfig, {
      scope: config.scopes ?? 'openid email profile',
    });

    // 3. Display instructions to operator
    const userCode = deviceResponse.user_code;
    const verificationUrl = deviceResponse.verification_uri_complete ?? deviceResponse.verification_uri;
    const expiresIn = deviceResponse.expires_in ?? 300;

    printFn('');
    printFn('  ── OIDC Device Login ──');
    printFn(`  Open this URL in your browser:`);
    printFn(`    ${verificationUrl}`);
    if (userCode) {
      printFn(`  Enter code: ${userCode}`);
    }
    printFn(`  Waiting for authentication (expires in ${expiresIn}s)...`);
    printFn('');

    // 4. Poll until authentication completes
    const tokens = await client.pollDeviceAuthorizationGrant(serverConfig, deviceResponse);

    // 5. Extract identity from claims
    const claims = tokens.claims();
    if (!claims) {
      return makeError('No claims in token response');
    }

    const name = (claims.name as string) ??
                 (claims.preferred_username as string) ??
                 (claims.email as string) ??
                 claims.sub ?? 'unknown';

    const email = (claims.email as string) ?? null;
    const sub = claims.sub ?? null;
    const roles = Array.isArray(claims.roles) ? claims.roles as string[] : [];
    const amr = Array.isArray(claims.amr) ? claims.amr as string[] : null;

    const identity: ReviewerIdentity = {
      name: typeof name === 'string' ? name : 'unknown',
      role: roles.length > 0 ? roles[0] : 'oidc_authenticated',
      identifier: email ?? (sub as string) ?? 'unknown',
      signerFingerprint: null,
    };

    printFn(`  ✓ Authenticated: ${identity.name} (${identity.identifier})`);
    if (amr) {
      printFn(`  Auth methods: ${amr.join(', ')}`);
    }

    return {
      success: true,
      identity,
      claims: claims as Record<string, unknown>,
      issuer: claims.iss ?? null,
      subject: sub as string | null,
      authMethods: amr,
      accessToken: tokens.access_token ?? null,
      idToken: tokens.id_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: typeof claims.exp === 'number' ? claims.exp : null,
      error: null,
    };
  } catch (err) {
    return makeError(err instanceof Error ? err.message : String(err));
  }
}

function makeError(message: string): OidcDeviceFlowResult {
  return {
    success: false, identity: null, claims: null,
    issuer: null, subject: null, authMethods: null,
    accessToken: null, idToken: null, refreshToken: null, expiresAt: null,
    error: message,
  };
}

// ─── CLI Integration Helper ─────────────────────────────────────────────────

/**
 * Check if OIDC device flow is configured via environment variables.
 */
export function isOidcConfigured(): boolean {
  return !!(process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID);
}

/**
 * Load OIDC config from environment variables.
 */
export function loadOidcConfig(): OidcDeviceFlowConfig | null {
  const issuerUrl = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  if (!issuerUrl || !clientId) return null;
  return { issuerUrl, clientId, scopes: process.env.OIDC_SCOPES };
}
