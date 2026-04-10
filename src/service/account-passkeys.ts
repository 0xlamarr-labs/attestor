/**
 * Hosted Account Passkeys - WebAuthn/passkeys first slice.
 *
 * BOUNDARY:
 * - WebAuthn/passkeys only (no SAML)
 * - Server-side verification uses @simplewebauthn/server
 * - Passkey verification follows the current SimpleWebAuthn passkeys baseline:
 *   `userVerification: 'preferred'` + `requireUserVerification: false` by default
 * - Deployments with stricter MFA/regulatory requirements can opt into
 *   `ATTESTOR_WEBAUTHN_REQUIRE_USER_VERIFICATION=true`
 * - One-time challenge state is persisted by the hosted account action-token store
 * - RP ID / origin may be env-pinned for production deployments
 * - Authentication first slice is email-first, not full usernameless discovery
 */

import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type CredentialDeviceType,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import type {
  AccountUserPasskeyCredentialRecord,
  AccountUserRecord,
} from './account-user-store.js';

export interface HostedPasskeyConfig {
  rpId: string;
  rpName: string;
  origin: string;
  stateTtlMinutes: number;
  requireUserVerification: boolean;
}

export type HostedPasskeyAuthenticatorHint = 'securityKey' | 'localDevice' | 'remoteDevice';

export interface HostedPasskeyRegistrationChallengeState {
  version: 1;
  purpose: 'registration';
  accountId: string;
  accountUserId: string;
  rpId: string;
  origin: string;
  challenge: string;
  userHandle: string;
  issuedAt: string;
  expiresAt: string;
}

export interface HostedPasskeyAuthenticationChallengeState {
  version: 1;
  purpose: 'authentication';
  accountUserId: string;
  rpId: string;
  origin: string;
  challenge: string;
  issuedAt: string;
  expiresAt: string;
}

const PASSKEY_STATE_VERSION = 1;
const PASSKEY_STATE_TTL_MINUTES = 10;

function ttlMinutes(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_WEBAUTHN_STATE_TTL_MINUTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PASSKEY_STATE_TTL_MINUTES;
}

function normalizeRpId(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

function requireUserVerification(): boolean {
  const value = process.env.ATTESTOR_WEBAUTHN_REQUIRE_USER_VERIFICATION?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function resolveOrigin(requestOrigin?: string | URL | null): string {
  const configured = process.env.ATTESTOR_WEBAUTHN_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  if (!requestOrigin) {
    throw new Error('Hosted passkeys require ATTESTOR_WEBAUTHN_ORIGIN or a concrete request origin.');
  }
  return new URL(typeof requestOrigin === 'string' ? requestOrigin : requestOrigin.href).origin;
}

function resolveRpId(requestOrigin?: string | URL | null): string {
  const configured = process.env.ATTESTOR_WEBAUTHN_RP_ID?.trim();
  if (configured) return normalizeRpId(configured);
  return normalizeRpId(new URL(resolveOrigin(requestOrigin)).hostname);
}

export function loadHostedPasskeyConfig(requestOrigin?: string | URL | null): HostedPasskeyConfig {
  const origin = resolveOrigin(requestOrigin);
  return {
    origin,
    rpId: resolveRpId(requestOrigin),
    rpName: process.env.ATTESTOR_WEBAUTHN_RP_NAME?.trim() || 'Attestor',
    stateTtlMinutes: ttlMinutes(),
    requireUserVerification: requireUserVerification(),
  };
}

export function generateHostedPasskeyUserHandle(): string {
  return randomBytes(32).toString('base64url');
}

function userHandleBytes(userHandle: string): ReturnType<Uint8Array['slice']> {
  return Buffer.from(userHandle, 'base64url') as unknown as ReturnType<Uint8Array['slice']>;
}

function currentIssuedWindow(config: HostedPasskeyConfig): { issuedAt: string; expiresAt: string } {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (config.stateTtlMinutes * 60 * 1000));
  return {
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function accountUserPasskeySummary(record: AccountUserRecord): {
  enabled: boolean;
  credentialCount: number;
  userHandleConfigured: boolean;
  lastUsedAt: string | null;
  updatedAt: string | null;
} {
  const credentialCount = record.passkeys.credentials.length;
  const lastUsedAt = record.passkeys.credentials
    .map((credential) => credential.lastUsedAt)
    .filter((value): value is string => typeof value === 'string')
    .sort()
    .at(-1) ?? null;
  return {
    enabled: credentialCount > 0,
    credentialCount,
    userHandleConfigured: Boolean(record.passkeys.userHandle),
    lastUsedAt,
    updatedAt: record.passkeys.updatedAt ?? null,
  };
}

export async function buildHostedPasskeyRegistrationOptions(options: {
  requestOrigin?: string | URL | null;
  user: AccountUserRecord;
  userHandle: string;
  preferredAuthenticatorType?: HostedPasskeyAuthenticatorHint | null;
  challenge?: string | null;
}): Promise<{
  challengeState: HostedPasskeyRegistrationChallengeState;
  registration: PublicKeyCredentialCreationOptionsJSON;
  config: HostedPasskeyConfig;
}> {
  const config = loadHostedPasskeyConfig(options.requestOrigin);
  const { issuedAt, expiresAt } = currentIssuedWindow(config);
  const registration = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: options.user.email,
    userDisplayName: options.user.displayName,
    userID: userHandleBytes(options.userHandle),
    challenge: options.challenge ?? undefined,
    attestationType: 'none',
    excludeCredentials: options.user.passkeys.credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: config.requireUserVerification ? 'required' : 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
    preferredAuthenticatorType: options.preferredAuthenticatorType ?? undefined,
  });
  return {
    config,
    registration,
    challengeState: {
      version: PASSKEY_STATE_VERSION,
      purpose: 'registration',
      accountId: options.user.accountId,
      accountUserId: options.user.id,
      rpId: config.rpId,
      origin: config.origin,
      challenge: registration.challenge,
      userHandle: options.userHandle,
      issuedAt,
      expiresAt,
    },
  };
}

export async function buildHostedPasskeyAuthenticationOptions(options: {
  requestOrigin?: string | URL | null;
  user: AccountUserRecord;
  challenge?: string | null;
}): Promise<{
  challengeState: HostedPasskeyAuthenticationChallengeState;
  authentication: PublicKeyCredentialRequestOptionsJSON;
  config: HostedPasskeyConfig;
}> {
  const config = loadHostedPasskeyConfig(options.requestOrigin);
  const { issuedAt, expiresAt } = currentIssuedWindow(config);
  const authentication = await generateAuthenticationOptions({
    rpID: config.rpId,
    challenge: options.challenge ?? undefined,
    userVerification: config.requireUserVerification ? 'required' : 'preferred',
    allowCredentials: options.user.passkeys.credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
  });
  return {
    config,
    authentication,
    challengeState: {
      version: PASSKEY_STATE_VERSION,
      purpose: 'authentication',
      accountUserId: options.user.id,
      rpId: config.rpId,
      origin: config.origin,
      challenge: authentication.challenge,
      issuedAt,
      expiresAt,
    },
  };
}

export async function verifyHostedPasskeyRegistration(options: {
  challengeState: HostedPasskeyRegistrationChallengeState;
  response: RegistrationResponseJSON;
}) {
  return verifyRegistrationResponse({
    response: options.response,
    expectedChallenge: options.challengeState.challenge,
    expectedOrigin: options.challengeState.origin,
    expectedRPID: options.challengeState.rpId,
    requireUserVerification: loadHostedPasskeyConfig(options.challengeState.origin).requireUserVerification,
  });
}

export async function verifyHostedPasskeyAuthentication(options: {
  challengeState: HostedPasskeyAuthenticationChallengeState;
  response: AuthenticationResponseJSON;
  credential: WebAuthnCredential;
}) {
  return verifyAuthenticationResponse({
    response: options.response,
    expectedChallenge: options.challengeState.challenge,
    expectedOrigin: options.challengeState.origin,
    expectedRPID: options.challengeState.rpId,
    credential: options.credential,
    requireUserVerification: loadHostedPasskeyConfig(options.challengeState.origin).requireUserVerification,
  });
}

export function buildAccountUserPasskeyCredentialRecord(input: {
  credential: WebAuthnCredential;
  transports: AuthenticatorTransportFuture[];
  aaguid: string | null;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  createdAt?: string | null;
  lastUsedAt?: string | null;
}): AccountUserPasskeyCredentialRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: `acpk_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    credentialId: input.credential.id,
    publicKey: Buffer.from(input.credential.publicKey).toString('base64url'),
    counter: input.credential.counter,
    transports: [...input.transports] as AccountUserPasskeyCredentialRecord['transports'],
    aaguid: input.aaguid,
    deviceType: input.deviceType,
    backedUp: input.backedUp,
    createdAt,
    lastUsedAt: input.lastUsedAt ?? null,
  };
}

export function passkeyCredentialToWebAuthnCredential(
  credential: AccountUserPasskeyCredentialRecord,
): WebAuthnCredential {
  return {
    id: credential.credentialId,
    publicKey: Buffer.from(credential.publicKey, 'base64url'),
    counter: credential.counter,
    transports: credential.transports as AuthenticatorTransportFuture[],
  };
}
