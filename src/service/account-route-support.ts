import { randomUUID } from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { totpSummary } from './account-mfa.js';
import {
  hostedOidcSummary,
  accountUserOidcSummary,
} from './account-oidc.js';
import {
  loadHostedSamlSummary,
  accountUserSamlSummary,
} from './account-saml.js';
import {
  accountUserPasskeySummary,
  type HostedPasskeyAuthenticationChallengeState,
  type HostedPasskeyAuthenticatorHint,
  type HostedPasskeyRegistrationChallengeState,
} from './account-passkeys.js';
import type { AccountUserRecord } from './account-user-store.js';
import type { AccountUserActionTokenRecord } from './account-user-token-store.js';

export function accountUserView(record: AccountUserRecord) {
  const mfa = totpSummary(record.mfa.totp);
  const passkeys = accountUserPasskeySummary(record);
  const oidc = accountUserOidcSummary(record);
  const saml = accountUserSamlSummary(record);
  return {
    id: record.id,
    accountId: record.accountId,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deactivatedAt: record.deactivatedAt,
    lastLoginAt: record.lastLoginAt,
    mfa: {
      enabled: mfa.enabled,
      method: mfa.method,
      enrolledAt: mfa.enrolledAt,
      pendingEnrollment: mfa.pendingEnrollment,
    },
    passkeys: {
      enabled: passkeys.enabled,
      credentialCount: passkeys.credentialCount,
      userHandleConfigured: passkeys.userHandleConfigured,
      lastUsedAt: passkeys.lastUsedAt,
    },
    federation: {
      oidcLinked: oidc.linked,
      oidcIdentityCount: oidc.identityCount,
      lastOidcLoginAt: oidc.lastLoginAt,
      samlLinked: saml.linked,
      samlIdentityCount: saml.identityCount,
      lastSamlLoginAt: saml.lastLoginAt,
    },
  };
}

export function accountUserDetailedMfaView(record: AccountUserRecord) {
  return totpSummary(record.mfa.totp);
}

export function accountUserDetailedOidcView(
  record: AccountUserRecord,
  requestOrigin?: string | URL | null,
) {
  const summary = hostedOidcSummary(requestOrigin);
  return {
    configured: summary.enabled,
    issuerUrl: summary.issuerUrl,
    redirectUrl: summary.redirectUrl,
    scopes: summary.scopes,
    identities: record.federation.oidc.identities.map((identity) => ({
      id: identity.id,
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      linkedAt: identity.linkedAt,
      lastLoginAt: identity.lastLoginAt,
    })),
  };
}

export function accountUserDetailedSamlView(
  record: AccountUserRecord,
  requestOrigin?: string | URL | null,
) {
  const summary = loadHostedSamlSummary(requestOrigin);
  return {
    configured: summary.enabled,
    entityId: summary.entityId,
    metadataUrl: summary.metadataUrl,
    acsUrl: summary.acsUrl,
    authnRequestsSigned: summary.authnRequestsSigned,
    identities: record.federation.saml.identities.map((identity) => ({
      id: identity.id,
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      nameIdFormat: identity.nameIdFormat,
      linkedAt: identity.linkedAt,
      lastLoginAt: identity.lastLoginAt,
    })),
  };
}

export function accountUserDetailedPasskeyView(record: AccountUserRecord) {
  const summary = accountUserPasskeySummary(record);
  return {
    enabled: summary.enabled,
    credentialCount: summary.credentialCount,
    userHandleConfigured: summary.userHandleConfigured,
    lastUsedAt: summary.lastUsedAt,
    updatedAt: summary.updatedAt,
    credentials: record.passkeys.credentials.map((credential) => ({
      id: credential.id,
      credentialId: credential.credentialId,
      transports: credential.transports,
      aaguid: credential.aaguid,
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
    })),
  };
}

export function accountPasskeyCredentialView(
  record: AccountUserRecord['passkeys']['credentials'][number],
) {
  return {
    id: record.id,
    credentialId: record.credentialId,
    transports: record.transports,
    aaguid: record.aaguid,
    deviceType: record.deviceType,
    backedUp: record.backedUp,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

function accountUserActionTokenStatus(
  record: AccountUserActionTokenRecord,
): 'pending' | 'consumed' | 'revoked' | 'expired' {
  if (record.consumedAt) return 'consumed';
  if (record.revokedAt) return 'revoked';
  if (Date.parse(record.expiresAt) <= Date.now()) return 'expired';
  return 'pending';
}

export function accountUserActionTokenView(record: AccountUserActionTokenRecord) {
  return {
    id: record.id,
    purpose: record.purpose,
    accountId: record.accountId,
    accountUserId: record.accountUserId,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
    status: accountUserActionTokenStatus(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
    revokedAt: record.revokedAt,
  };
}

function accountUserActionTokenContext(
  record: AccountUserActionTokenRecord,
): Record<string, unknown> {
  return record.context && typeof record.context === 'object' ? record.context : {};
}

export function parsePasskeyRegistrationChallenge(
  record: AccountUserActionTokenRecord,
): HostedPasskeyRegistrationChallengeState | null {
  if (record.purpose !== 'passkey_registration') return null;
  const context = accountUserActionTokenContext(record);
  const challenge = typeof context.challenge === 'string' ? context.challenge.trim() : '';
  const rpId = typeof context.rpId === 'string' ? context.rpId.trim() : '';
  const origin = typeof context.origin === 'string' ? context.origin.trim() : '';
  const userHandle = typeof context.userHandle === 'string' ? context.userHandle.trim() : '';
  if (!record.accountUserId || !challenge || !rpId || !origin || !userHandle) return null;
  return {
    version: 1,
    purpose: 'registration',
    accountId: record.accountId,
    accountUserId: record.accountUserId,
    rpId,
    origin,
    challenge,
    userHandle,
    issuedAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function parsePasskeyAuthenticationChallenge(
  record: AccountUserActionTokenRecord,
): HostedPasskeyAuthenticationChallengeState | null {
  if (record.purpose !== 'passkey_authentication') return null;
  const context = accountUserActionTokenContext(record);
  const challenge = typeof context.challenge === 'string' ? context.challenge.trim() : '';
  const rpId = typeof context.rpId === 'string' ? context.rpId.trim() : '';
  const origin = typeof context.origin === 'string' ? context.origin.trim() : '';
  if (!record.accountUserId || !challenge || !rpId || !origin) return null;
  return {
    version: 1,
    purpose: 'authentication',
    accountUserId: record.accountUserId,
    rpId,
    origin,
    challenge,
    issuedAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function normalizePasskeyAuthenticatorHint(
  value: unknown,
): HostedPasskeyAuthenticatorHint | null {
  if (value !== 'securityKey' && value !== 'localDevice' && value !== 'remoteDevice') {
    return null;
  }
  return value;
}

export function asRegistrationResponse(value: unknown): RegistrationResponseJSON | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as RegistrationResponseJSON;
  if (
    response.type !== 'public-key' ||
    !response.response ||
    typeof response.response !== 'object'
  ) {
    return null;
  }
  return response;
}

export function asAuthenticationResponse(value: unknown): AuthenticationResponseJSON | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as AuthenticationResponseJSON;
  if (
    response.type !== 'public-key' ||
    !response.response ||
    typeof response.response !== 'object'
  ) {
    return null;
  }
  return response;
}

function normalizeSignupTenantSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 32);
}

export function deriveSignupTenantId(accountName: string, email: string): string {
  const [emailLocalPart] = email.split('@', 1);
  const base =
    normalizeSignupTenantSegment(accountName) ||
    normalizeSignupTenantSegment(emailLocalPart ?? '') ||
    'account';
  return `${base}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}
