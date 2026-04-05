/**
 * OIDC Token Cache — Bounded Session Persistence
 *
 * Stores OIDC tokens locally so the reviewer does not need to
 * re-authenticate every endorsement. Tokens are stored as JSON
 * in a local file with basic file-system-level protection.
 *
 * BOUNDARY:
 * - File-based storage (no OS keychain integration yet)
 * - Refresh token support (when IdP issues one)
 * - Token expiry checking
 * - Not encrypted at rest (future: OS keychain or encrypted file)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface CachedTokenSet {
  accessToken: string;
  idToken: string | null;
  refreshToken: string | null;
  expiresAt: number; // Unix timestamp (seconds)
  issuer: string;
  subject: string;
  name: string | null;
  email: string | null;
  cachedAt: string;
}

const DEFAULT_CACHE_PATH = join('.attestor', 'oidc-token-cache.json');

export function loadCachedTokens(cachePath: string = DEFAULT_CACHE_PATH): CachedTokenSet | null {
  try {
    if (!existsSync(cachePath)) return null;
    const raw = readFileSync(cachePath, 'utf8');
    const cached = JSON.parse(raw) as CachedTokenSet;
    // Check expiry
    if (cached.expiresAt && Date.now() / 1000 > cached.expiresAt) {
      return cached; // Return even if expired — caller can try refresh
    }
    return cached;
  } catch {
    return null;
  }
}

export function saveCachedTokens(tokens: CachedTokenSet, cachePath: string = DEFAULT_CACHE_PATH): void {
  const dir = dirname(cachePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearCachedTokens(cachePath: string = DEFAULT_CACHE_PATH): void {
  try {
    const { unlinkSync } = require('node:fs');
    if (existsSync(cachePath)) unlinkSync(cachePath);
  } catch { /* ignore */ }
}

export function isTokenExpired(tokens: CachedTokenSet): boolean {
  return Date.now() / 1000 > tokens.expiresAt;
}

export function isTokenExpiringSoon(tokens: CachedTokenSet, thresholdSeconds: number = 300): boolean {
  return Date.now() / 1000 > (tokens.expiresAt - thresholdSeconds);
}

/**
 * Attempt token refresh using openid-client.
 * Returns new tokens if refresh succeeds, null otherwise.
 */
export async function refreshTokens(
  cached: CachedTokenSet,
  clientId: string,
): Promise<CachedTokenSet | null> {
  if (!cached.refreshToken) return null;

  try {
    const oidcClient = await import('openid-client');
    const issuerUrl = new URL(cached.issuer);
    const config = await oidcClient.discovery(issuerUrl, clientId);

    const newTokens = await oidcClient.refreshTokenGrant(config, cached.refreshToken);
    const claims = newTokens.claims();

    const refreshed: CachedTokenSet = {
      accessToken: newTokens.access_token!,
      idToken: newTokens.id_token ?? cached.idToken,
      refreshToken: newTokens.refresh_token ?? cached.refreshToken,
      expiresAt: claims?.exp ?? (Date.now() / 1000 + 3600),
      issuer: cached.issuer,
      subject: (claims?.sub as string) ?? cached.subject,
      name: (claims?.name as string) ?? cached.name,
      email: (claims?.email as string) ?? cached.email,
      cachedAt: new Date().toISOString(),
    };

    return refreshed;
  } catch {
    return null;
  }
}
