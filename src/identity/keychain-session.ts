/**
 * OS Keychain Session Manager — Enterprise OIDC Token Lifecycle
 *
 * Stores OIDC tokens in the OS native keychain (Windows Credential Manager,
 * macOS Keychain, Linux Secret Service) via @napi-rs/keyring.
 *
 * Provides: login, auto-refresh, revocation, logout.
 * Falls back to encrypted file store when native keychain is unavailable.
 *
 * This replaces the file-based secure-token-store as the production path
 * when @napi-rs/keyring is installed.
 */

import * as oidcClient from 'openid-client';
import type { ReviewerIdentity } from '../financial/types.js';

const SERVICE_NAME = 'attestor-governance';

// ─── Keychain Abstraction ───────────────────────────────────────────────────

interface KeychainBackend {
  get(account: string): string | null;
  set(account: string, value: string): void;
  delete(account: string): void;
  name: string;
}

/** Try native OS keychain via @napi-rs/keyring */
async function tryNativeKeychain(): Promise<KeychainBackend | null> {
  try {
    const keyring = await import('@napi-rs/keyring');
    const Entry = keyring.Entry ?? (keyring as any).default?.Entry;
    if (!Entry) return null;

    return {
      name: 'os-keychain',
      get(account: string): string | null {
        try { return new Entry(SERVICE_NAME, account).getPassword(); }
        catch { return null; }
      },
      set(account: string, value: string): void {
        new Entry(SERVICE_NAME, account).setPassword(value);
      },
      delete(account: string): void {
        try { new Entry(SERVICE_NAME, account).deletePassword(); } catch { /* ignore */ }
      },
    };
  } catch {
    return null;
  }
}

/** Fallback: encrypted file store */
async function fileBackend(): Promise<KeychainBackend> {
  const { encryptAndStore, loadAndDecrypt, clearSecureStore } = await import('./secure-token-store.js');
  return {
    name: 'encrypted-file',
    get(_account: string): string | null {
      const data = loadAndDecrypt();
      return data ? JSON.stringify(data) : null;
    },
    set(_account: string, value: string): void {
      encryptAndStore(JSON.parse(value));
    },
    delete(_account: string): void {
      clearSecureStore();
    },
  };
}

let cachedBackend: KeychainBackend | null = null;

async function getBackend(): Promise<KeychainBackend> {
  if (cachedBackend) return cachedBackend;
  cachedBackend = await tryNativeKeychain() ?? await fileBackend();
  return cachedBackend;
}

// ─── Session Types ──────────────────────────────────────────────────────────

export interface OidcSession {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number;
  issuer: string;
  subject: string;
  name: string;
  email: string | null;
  backendUsed: string;
}

// ─── Session Operations ─────────────────────────────────────────────────────

export async function saveSession(session: OidcSession): Promise<void> {
  const backend = await getBackend();
  backend.set('oidc-session', JSON.stringify(session));
  session.backendUsed = backend.name;
}

export async function loadSession(): Promise<OidcSession | null> {
  const backend = await getBackend();
  const raw = backend.get('oidc-session');
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as OidcSession;
    session.backendUsed = backend.name;
    return session;
  } catch { return null; }
}

export async function clearSession(): Promise<void> {
  const backend = await getBackend();
  backend.delete('oidc-session');
}

export function isSessionValid(session: OidcSession): boolean {
  return Date.now() / 1000 < session.expiresAt;
}

export function isSessionExpiringSoon(session: OidcSession, thresholdSec: number = 300): boolean {
  return Date.now() / 1000 > (session.expiresAt - thresholdSec);
}

// ─── Token Refresh ──────────────────────────────────────────────────────────

export async function refreshSession(
  session: OidcSession,
  clientId: string,
): Promise<OidcSession | null> {
  if (!session.refreshToken) return null;
  try {
    const issuerUrl = new URL(session.issuer);
    const config = await oidcClient.discovery(issuerUrl, clientId);
    const newTokens = await oidcClient.refreshTokenGrant(config, session.refreshToken);
    const claims = newTokens.claims();

    return {
      accessToken: newTokens.access_token!,
      refreshToken: newTokens.refresh_token ?? session.refreshToken,
      idToken: newTokens.id_token ?? session.idToken,
      expiresAt: typeof claims?.exp === 'number' ? claims.exp : (Date.now() / 1000 + 3600),
      issuer: session.issuer,
      subject: (claims?.sub as string) ?? session.subject,
      name: (claims?.name as string) ?? session.name,
      email: (claims?.email as string) ?? session.email,
      backendUsed: session.backendUsed,
    };
  } catch { return null; }
}

// ─── Token Revocation + Logout ──────────────────────────────────────────────

export async function revokeAndLogout(
  session: OidcSession,
  clientId: string,
): Promise<{ revoked: boolean; cleared: boolean }> {
  let revoked = false;
  try {
    const issuerUrl = new URL(session.issuer);
    const config = await oidcClient.discovery(issuerUrl, clientId);

    // Revoke refresh token first (it can create new access tokens)
    if (session.refreshToken) {
      await oidcClient.tokenRevocation(config, session.refreshToken, { token_type_hint: 'refresh_token' });
      revoked = true;
    }
    // Then revoke access token
    if (session.accessToken) {
      await oidcClient.tokenRevocation(config, session.accessToken, { token_type_hint: 'access_token' });
      revoked = true;
    }
  } catch {
    // Revocation failure is non-fatal — still clear local session
  }

  await clearSession();
  return { revoked, cleared: true };
}

// ─── Identity Extraction ────────────────────────────────────────────────────

export function sessionToReviewerIdentity(session: OidcSession): ReviewerIdentity {
  return {
    name: session.name,
    role: 'oidc_authenticated',
    identifier: session.email ?? session.subject,
    signerFingerprint: null,
  };
}

export async function getSessionBackendName(): Promise<string> {
  const backend = await getBackend();
  return backend.name;
}
