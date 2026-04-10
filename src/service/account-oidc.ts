/**
 * Hosted Account OIDC SSO Helpers — authorization-code + PKCE first slice.
 *
 * Uses a sealed, short-lived state token instead of a server-side pending-login
 * store so the same OIDC redirect flow works across multiple API instances.
 *
 * BOUNDARY:
 * - Generic OIDC only (no SAML)
 * - Authorization Code + PKCE only
 * - The callback returns JSON and a hosted account session; no UI redirect broker yet
 * - Identity linking is email-first on the first successful login, then issuer+subject
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import * as oidcClient from 'openid-client';
import type {
  AccountUserOidcIdentityRecord,
  AccountUserRecord,
} from './account-user-store.js';

export interface HostedOidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string | null;
  redirectUrl: string;
  scopes: string;
  stateTtlMinutes: number;
}

export interface HostedOidcAuthorizationRequest {
  mode: 'authorization_code_pkce';
  issuerUrl: string;
  redirectUrl: string;
  scopes: string[];
  authorizationUrl: string;
  expiresAt: string;
}

export interface HostedOidcCallbackIdentity {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean | null;
  name: string | null;
  claims: Record<string, unknown>;
}

interface HostedOidcLoginState {
  version: 1;
  issuerUrl: string;
  redirectUrl: string;
  codeVerifier: string;
  nonce: string;
  emailHint: string | null;
  issuedAt: string;
  expiresAt: string;
}

const OIDC_SCOPE_DEFAULT = 'openid email profile';
const OIDC_STATE_PREFIX = 'aoidc_';
const OIDC_STATE_VERSION = 1;
const OIDC_STATE_TOKEN_TTL_MINUTES = 10;
const discoveryCache = new Map<string, Promise<oidcClient.Configuration>>();

function envTruthy(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function stateKey(): Buffer {
  const raw = process.env.ATTESTOR_HOSTED_OIDC_STATE_KEY?.trim()
    || process.env.ATTESTOR_ADMIN_API_KEY?.trim();
  if (!raw) {
    throw new Error(
      'ATTESTOR_HOSTED_OIDC_STATE_KEY or ATTESTOR_ADMIN_API_KEY must be set before enabling hosted OIDC SSO.',
    );
  }
  return createHash('sha256').update(`attestor.hosted.oidc.state:${raw}`).digest();
}

function encodeBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function normalizeIssuerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function hostedOidcAllowsInsecureRequests(config: HostedOidcConfig): boolean {
  const explicit = process.env.ATTESTOR_HOSTED_OIDC_ALLOW_INSECURE_HTTP;
  if (envTruthy(explicit)) return true;
  try {
    const url = new URL(config.issuerUrl);
    return url.protocol === 'http:' && (
      url.hostname === '127.0.0.1'
      || url.hostname === 'localhost'
      || url.hostname === '::1'
    );
  } catch {
    return false;
  }
}

function normalizeScopes(value: string | null | undefined): string {
  const normalized = value?.trim() || OIDC_SCOPE_DEFAULT;
  return normalized.split(/\s+/).filter(Boolean).join(' ');
}

function resolveRequestOrigin(input?: string | URL | null): string | null {
  if (!input) return null;
  const url = typeof input === 'string' ? new URL(input) : input;
  return url.origin;
}

function resolveRedirectUrl(requestOrigin?: string | URL | null): string {
  const explicit = process.env.ATTESTOR_HOSTED_OIDC_REDIRECT_URL?.trim();
  if (explicit) return explicit;
  const origin = resolveRequestOrigin(requestOrigin);
  if (!origin) {
    throw new Error('ATTESTOR_HOSTED_OIDC_REDIRECT_URL is required when the incoming request origin is unavailable.');
  }
  return new URL('/api/v1/auth/oidc/callback', origin).href;
}

export function hostedOidcStateTtlMinutes(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_HOSTED_OIDC_STATE_TTL_MINUTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : OIDC_STATE_TOKEN_TTL_MINUTES;
}

export function loadHostedOidcConfig(requestOrigin?: string | URL | null): HostedOidcConfig | null {
  const issuerUrl = process.env.ATTESTOR_HOSTED_OIDC_ISSUER_URL?.trim();
  const clientId = process.env.ATTESTOR_HOSTED_OIDC_CLIENT_ID?.trim();
  if (!issuerUrl || !clientId) return null;
  return {
    issuerUrl: normalizeIssuerUrl(issuerUrl),
    clientId,
    clientSecret: process.env.ATTESTOR_HOSTED_OIDC_CLIENT_SECRET?.trim() || null,
    redirectUrl: resolveRedirectUrl(requestOrigin),
    scopes: normalizeScopes(process.env.ATTESTOR_HOSTED_OIDC_SCOPES),
    stateTtlMinutes: hostedOidcStateTtlMinutes(),
  };
}

export function hostedOidcSummary(requestOrigin?: string | URL | null): {
  enabled: boolean;
  issuerUrl: string | null;
  redirectUrl: string | null;
  scopes: string[];
} {
  const config = loadHostedOidcConfig(requestOrigin);
  return {
    enabled: Boolean(config),
    issuerUrl: config?.issuerUrl ?? null,
    redirectUrl: config?.redirectUrl ?? null,
    scopes: config ? config.scopes.split(' ') : [],
  };
}

async function discoverOidcConfiguration(config: HostedOidcConfig): Promise<oidcClient.Configuration> {
  const key = `${config.issuerUrl}|${config.clientId}|${config.clientSecret ?? ''}`;
  let cached = discoveryCache.get(key);
  if (!cached) {
    const allowInsecure = hostedOidcAllowsInsecureRequests(config);
    cached = oidcClient.discovery(
      new URL(config.issuerUrl),
      config.clientId,
      config.clientSecret ?? undefined,
      undefined,
      allowInsecure
        ? { execute: [oidcClient.allowInsecureRequests] }
        : undefined,
    );
    discoveryCache.set(key, cached);
  }
  return cached;
}

function sealOidcLoginState(payload: HostedOidcLoginState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', stateKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `${OIDC_STATE_PREFIX}${encodeBase64Url(Buffer.concat([
    Buffer.from([OIDC_STATE_VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]))}`;
}

function unsealOidcLoginState(stateToken: string): HostedOidcLoginState {
  const normalized = stateToken.trim();
  if (!normalized.startsWith(OIDC_STATE_PREFIX)) {
    throw new Error('OIDC state token is malformed.');
  }
  const decoded = decodeBase64Url(normalized.slice(OIDC_STATE_PREFIX.length));
  if (decoded.length < 1 + 12 + 16 + 1) {
    throw new Error('OIDC state token is truncated.');
  }
  const version = decoded[0];
  if (version !== OIDC_STATE_VERSION) {
    throw new Error(`Unsupported OIDC state token version '${version}'.`);
  }
  const iv = decoded.subarray(1, 13);
  const authTag = decoded.subarray(13, 29);
  const ciphertext = decoded.subarray(29);
  const decipher = createDecipheriv('aes-256-gcm', stateKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const payload = JSON.parse(plaintext) as HostedOidcLoginState;
  if (payload.version !== OIDC_STATE_VERSION) {
    throw new Error('OIDC state payload version mismatch.');
  }
  const expiresAtMs = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error('OIDC state token is expired.');
  }
  return payload;
}

export async function buildHostedOidcAuthorizationRequest(options?: {
  requestOrigin?: string | URL | null;
  emailHint?: string | null;
}): Promise<HostedOidcAuthorizationRequest> {
  const config = loadHostedOidcConfig(options?.requestOrigin);
  if (!config) {
    throw new Error('Hosted OIDC SSO is not configured.');
  }
  const discovered = await discoverOidcConfiguration(config);
  const codeVerifier = oidcClient.randomPKCECodeVerifier();
  const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
  const nonce = oidcClient.randomNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (config.stateTtlMinutes * 60 * 1000));
  const stateToken = sealOidcLoginState({
    version: 1,
    issuerUrl: config.issuerUrl,
    redirectUrl: config.redirectUrl,
    codeVerifier,
    nonce,
    emailHint: options?.emailHint?.trim() ? options.emailHint.trim().toLowerCase() : null,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const authorizationUrl = oidcClient.buildAuthorizationUrl(discovered, {
    response_type: 'code',
    redirect_uri: config.redirectUrl,
    scope: config.scopes,
    state: stateToken,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...(options?.emailHint?.trim() ? { login_hint: options.emailHint.trim() } : {}),
  });
  return {
    mode: 'authorization_code_pkce',
    issuerUrl: config.issuerUrl,
    redirectUrl: config.redirectUrl,
    scopes: config.scopes.split(' '),
    authorizationUrl: authorizationUrl.href,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function completeHostedOidcAuthorization(currentUrl: string | URL): Promise<{
  identity: HostedOidcCallbackIdentity;
  state: HostedOidcLoginState;
}> {
  const callbackUrl = typeof currentUrl === 'string' ? new URL(currentUrl) : currentUrl;
  const stateToken = callbackUrl.searchParams.get('state')?.trim();
  if (!stateToken) {
    throw new Error('OIDC callback is missing state.');
  }
  const state = unsealOidcLoginState(stateToken);
  const config = loadHostedOidcConfig(state.redirectUrl);
  if (!config) {
    throw new Error('Hosted OIDC SSO is not configured.');
  }
  if (normalizeIssuerUrl(state.issuerUrl) !== normalizeIssuerUrl(config.issuerUrl)) {
    throw new Error('OIDC callback issuer does not match the current hosted configuration.');
  }
  const discovered = await discoverOidcConfiguration(config);
  const tokenResponse = await oidcClient.authorizationCodeGrant(
    discovered,
    callbackUrl,
    {
      expectedState: stateToken,
      expectedNonce: state.nonce,
      pkceCodeVerifier: state.codeVerifier,
    },
    {
      redirect_uri: state.redirectUrl,
    },
  );
  const claims = tokenResponse.claims();
  if (!claims?.sub) {
    throw new Error('Hosted OIDC callback did not return a subject claim.');
  }
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
  return {
    state,
    identity: {
      issuer: normalizeIssuerUrl(typeof claims.iss === 'string' ? claims.iss : config.issuerUrl),
      subject: String(claims.sub),
      email,
      emailVerified: typeof claims.email_verified === 'boolean' ? claims.email_verified : null,
      name: typeof claims.name === 'string'
        ? claims.name
        : typeof claims.preferred_username === 'string'
          ? claims.preferred_username
          : email,
      claims: claims as Record<string, unknown>,
    },
  };
}

export function accountUserOidcSummary(record: AccountUserRecord): {
  linked: boolean;
  identityCount: number;
  lastLoginAt: string | null;
} {
  const identities = record.federation.oidc.identities;
  const lastLoginAt = identities
    .map((entry) => entry.lastLoginAt)
    .filter((value): value is string => typeof value === 'string')
    .sort((left, right) => left < right ? 1 : -1)[0] ?? null;
  return {
    linked: identities.length > 0,
    identityCount: identities.length,
    lastLoginAt,
  };
}

export function linkAccountUserOidcIdentity(
  record: AccountUserRecord,
  identity: HostedOidcCallbackIdentity,
  now = new Date().toISOString(),
): { record: AccountUserRecord; linkedIdentity: AccountUserOidcIdentityRecord; changed: boolean } {
  const next = structuredClone(record);
  const identities = next.federation.oidc.identities;
  const existing = identities.find((entry) =>
    normalizeIssuerUrl(entry.issuer) === normalizeIssuerUrl(identity.issuer)
    && entry.subject.trim() === identity.subject.trim());
  if (existing) {
    const changed = existing.email !== identity.email || existing.lastLoginAt !== now;
    existing.email = identity.email;
    existing.lastLoginAt = now;
    next.updatedAt = changed ? now : next.updatedAt;
    return { record: next, linkedIdentity: existing, changed };
  }
  const linkedIdentity: AccountUserOidcIdentityRecord = {
    id: `oidc_${randomBytes(8).toString('hex')}`,
    issuer: normalizeIssuerUrl(identity.issuer),
    subject: identity.subject.trim(),
    email: identity.email,
    linkedAt: now,
    lastLoginAt: now,
  };
  identities.push(linkedIdentity);
  next.updatedAt = now;
  return { record: next, linkedIdentity, changed: true };
}

export function isHostedOidcConfigured(): boolean {
  return Boolean(loadHostedOidcConfig('http://localhost'));
}

export function hostedOidcAllowsAutomaticLinking(identity: HostedOidcCallbackIdentity): boolean {
  if (!identity.email) return false;
  return identity.emailVerified !== false || envTruthy(process.env.ATTESTOR_HOSTED_OIDC_ALLOW_UNVERIFIED_EMAIL_LINK);
}
