/**
 * Hosted Account SAML Helpers — SP-initiated first slice.
 *
 * BOUNDARY:
 * - SP-initiated Web SSO only
 * - HTTP-Redirect AuthnRequest + HTTP-POST ACS only
 * - Signed IdP responses/assertions are required
 * - XML schema validation uses a strict custom guard, not a full XSD validator
 * - Identity linking is issuer+subject first, then verified-email fallback
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as samlify from 'samlify';
import type {
  AccountUserRecord,
  AccountUserSamlIdentityRecord,
} from './account-user-store.js';

export interface HostedSamlConfig {
  idpMetadataXml: string;
  entityId: string;
  metadataUrl: string;
  acsUrl: string;
  relayStateTtlMinutes: number;
  authnRequestsSigned: boolean;
  privateKey: string | null;
  signingCert: string | null;
  clockDriftMs: number;
}

export interface HostedSamlAuthorizationRequest {
  mode: 'sp_initiated_redirect';
  entityId: string;
  metadataUrl: string;
  acsUrl: string;
  authorizationUrl: string;
  requestId: string;
  expiresAt: string;
}

export interface HostedSamlCallbackIdentity {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: true | null;
  name: string | null;
  nameId: string;
  nameIdFormat: string | null;
  sessionIndex: string | null;
  audience: string[];
  attributes: Record<string, string[]>;
  claims: Record<string, unknown>;
}

interface HostedSamlRelayState {
  version: 1;
  requestId: string;
  issuer: string;
  metadataUrl: string;
  acsUrl: string;
  emailHint: string | null;
  issuedAt: string;
  expiresAt: string;
}

const SAML_RELAY_STATE_PREFIX = 'asaml_';
const SAML_RELAY_STATE_VERSION = 1;
const DEFAULT_RELAY_STATE_TTL_MINUTES = 10;
const DEFAULT_CLOCK_DRIFT_SECONDS = 120;
const MAX_SAML_XML_BYTES = 256 * 1024;

const entityCache = new Map<string, {
  sp: any;
  idp: any;
  config: HostedSamlConfig;
}>();

let schemaValidatorConfigured = false;

function envTruthy(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' ? entry.trim() : '')
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function readInlineOrFile(value: string | undefined, pathValue: string | undefined): string | null {
  const inline = value?.trim();
  if (inline) return inline;
  const filePath = pathValue?.trim();
  if (!filePath) return null;
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Hosted SAML configuration file '${resolved}' was not found.`);
  }
  return readFileSync(resolved, 'utf8').trim();
}

function resolveRequestOrigin(input?: string | URL | null): string | null {
  if (!input) return null;
  const url = typeof input === 'string' ? new URL(input) : input;
  return url.origin;
}

function resolveMetadataUrl(requestOrigin?: string | URL | null): string {
  const explicit = process.env.ATTESTOR_HOSTED_SAML_METADATA_URL?.trim();
  if (explicit) return explicit;
  const origin = resolveRequestOrigin(requestOrigin);
  if (!origin) {
    throw new Error('ATTESTOR_HOSTED_SAML_METADATA_URL is required when the incoming request origin is unavailable.');
  }
  return new URL('/api/v1/auth/saml/metadata', origin).href;
}

function resolveAcsUrl(requestOrigin?: string | URL | null): string {
  const explicit = process.env.ATTESTOR_HOSTED_SAML_ACS_URL?.trim();
  if (explicit) return explicit;
  const origin = resolveRequestOrigin(requestOrigin);
  if (!origin) {
    throw new Error('ATTESTOR_HOSTED_SAML_ACS_URL is required when the incoming request origin is unavailable.');
  }
  return new URL('/api/v1/auth/saml/acs', origin).href;
}

function relayStateKey(): Buffer {
  const raw = process.env.ATTESTOR_HOSTED_SAML_RELAY_STATE_KEY?.trim()
    || process.env.ATTESTOR_ADMIN_API_KEY?.trim();
  if (!raw) {
    throw new Error(
      'ATTESTOR_HOSTED_SAML_RELAY_STATE_KEY or ATTESTOR_ADMIN_API_KEY must be set before enabling hosted SAML SSO.',
    );
  }
  return createHash('sha256').update(`attestor.hosted.saml.relay:${raw}`).digest();
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

function sealRelayState(payload: HostedSamlRelayState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', relayStateKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `${SAML_RELAY_STATE_PREFIX}${encodeBase64Url(Buffer.concat([
    Buffer.from([SAML_RELAY_STATE_VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]))}`;
}

function unsealRelayState(value: string): HostedSamlRelayState {
  const token = value.trim();
  if (!token.startsWith(SAML_RELAY_STATE_PREFIX)) {
    throw new Error('SAML relay state is malformed.');
  }
  const decoded = decodeBase64Url(token.slice(SAML_RELAY_STATE_PREFIX.length));
  if (decoded.length < 1 + 12 + 16 + 1) {
    throw new Error('SAML relay state is truncated.');
  }
  const version = decoded[0];
  if (version !== SAML_RELAY_STATE_VERSION) {
    throw new Error(`Unsupported SAML relay state version '${version}'.`);
  }
  const iv = decoded.subarray(1, 13);
  const authTag = decoded.subarray(13, 29);
  const ciphertext = decoded.subarray(29);
  const decipher = createDecipheriv('aes-256-gcm', relayStateKey(), iv);
  decipher.setAuthTag(authTag);
  const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as HostedSamlRelayState;
  if (payload.version !== SAML_RELAY_STATE_VERSION) {
    throw new Error('SAML relay state version mismatch.');
  }
  const expiresAtMs = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error('SAML relay state is expired.');
  }
  return payload;
}

function samlRelayStateTtlMinutes(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_HOSTED_SAML_RELAY_STATE_TTL_MINUTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RELAY_STATE_TTL_MINUTES;
}

function samlClockDriftMs(): number {
  const parsed = Number.parseInt(process.env.ATTESTOR_HOSTED_SAML_CLOCK_DRIFT_SECONDS ?? '', 10);
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CLOCK_DRIFT_SECONDS;
  return seconds * 1000;
}

function stripPemHeaders(value: string): string {
  return value
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

function ensureSchemaValidatorConfigured(): void {
  if (schemaValidatorConfigured) return;
  samlify.setSchemaValidator({
    validate: async (xml: string) => {
      if (typeof xml !== 'string' || !xml.trim()) {
        throw new Error('SAML XML payload is empty.');
      }
      if (Buffer.byteLength(xml, 'utf8') > MAX_SAML_XML_BYTES) {
        throw new Error('SAML XML payload exceeds the configured size limit.');
      }
      if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
        throw new Error('SAML XML payload contains forbidden DTD/entity declarations.');
      }
      if (!/<(?:\w+:)?(?:Response|AuthnRequest)\b/i.test(xml)) {
        throw new Error('SAML XML payload does not contain a supported SAML root element.');
      }
      if (!/urn:oasis:names:tc:SAML:/i.test(xml)) {
        throw new Error('SAML XML payload does not declare a SAML namespace.');
      }
      return 'strict_custom_guard';
    },
  });
  schemaValidatorConfigured = true;
}

function loadHostedSamlConfig(requestOrigin?: string | URL | null): HostedSamlConfig | null {
  const idpMetadataXml = readInlineOrFile(
    process.env.ATTESTOR_HOSTED_SAML_IDP_METADATA_XML,
    process.env.ATTESTOR_HOSTED_SAML_IDP_METADATA_PATH,
  );
  if (!idpMetadataXml) return null;
  const metadataUrl = resolveMetadataUrl(requestOrigin);
  const acsUrl = resolveAcsUrl(requestOrigin);
  const entityId = process.env.ATTESTOR_HOSTED_SAML_ENTITY_ID?.trim() || metadataUrl;
  const authnRequestsSigned = envTruthy(process.env.ATTESTOR_HOSTED_SAML_SIGN_AUTHN_REQUESTS);
  const privateKey = readInlineOrFile(
    process.env.ATTESTOR_HOSTED_SAML_SP_PRIVATE_KEY,
    process.env.ATTESTOR_HOSTED_SAML_SP_PRIVATE_KEY_PATH,
  );
  const signingCert = readInlineOrFile(
    process.env.ATTESTOR_HOSTED_SAML_SP_CERT,
    process.env.ATTESTOR_HOSTED_SAML_SP_CERT_PATH,
  );
  if (authnRequestsSigned && (!privateKey || !signingCert)) {
    throw new Error(
      'Hosted SAML request signing requires ATTESTOR_HOSTED_SAML_SP_PRIVATE_KEY(_PATH) and ATTESTOR_HOSTED_SAML_SP_CERT(_PATH).',
    );
  }
  return {
    idpMetadataXml,
    entityId,
    metadataUrl,
    acsUrl,
    relayStateTtlMinutes: samlRelayStateTtlMinutes(),
    authnRequestsSigned,
    privateKey,
    signingCert,
    clockDriftMs: samlClockDriftMs(),
  };
}

function entityCacheKey(config: HostedSamlConfig): string {
  return [
    config.entityId,
    config.metadataUrl,
    config.acsUrl,
    config.authnRequestsSigned ? 'signed' : 'unsigned',
    createHash('sha256').update(config.idpMetadataXml).digest('hex'),
    createHash('sha256').update(config.privateKey ?? '').digest('hex'),
    createHash('sha256').update(config.signingCert ?? '').digest('hex'),
  ].join('|');
}

function buildEntities(config: HostedSamlConfig): { sp: any; idp: any; config: HostedSamlConfig } {
  ensureSchemaValidatorConfigured();
  const key = entityCacheKey(config);
  const cached = entityCache.get(key);
  if (cached) return cached;

  const sp = samlify.ServiceProvider({
    entityID: config.entityId,
    authnRequestsSigned: config.authnRequestsSigned,
    wantAssertionsSigned: true,
    wantMessageSigned: true,
    privateKey: config.privateKey ?? undefined,
    signingCert: config.signingCert ?? undefined,
    clockDrifts: [-config.clockDriftMs, config.clockDriftMs],
    assertionConsumerService: [{
      Binding: samlify.Constants.namespace.binding.post,
      Location: config.acsUrl,
    }],
  });
  const idp = samlify.IdentityProvider({
    metadata: config.idpMetadataXml,
    wantAuthnRequestsSigned: config.authnRequestsSigned,
  });
  const created = { sp, idp, config };
  entityCache.set(key, created);
  return created;
}

function normalizeAttributeMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {};
  const pairs = Object.entries(value as Record<string, unknown>).map(([key, raw]) => {
    const values = normalizeStringArray(raw);
    return [key, values] as const;
  });
  return Object.fromEntries(pairs);
}

function firstAttribute(attributes: Record<string, string[]>, names: string[]): string | null {
  for (const name of names) {
    const entry = attributes[name];
    if (entry && entry.length > 0 && entry[0]) return entry[0];
  }
  return null;
}

export function loadHostedSamlSummary(requestOrigin?: string | URL | null): {
  enabled: boolean;
  entityId: string | null;
  metadataUrl: string | null;
  acsUrl: string | null;
  authnRequestsSigned: boolean;
} {
  const config = loadHostedSamlConfig(requestOrigin);
  return {
    enabled: Boolean(config),
    entityId: config?.entityId ?? null,
    metadataUrl: config?.metadataUrl ?? null,
    acsUrl: config?.acsUrl ?? null,
    authnRequestsSigned: config?.authnRequestsSigned ?? false,
  };
}

export function isHostedSamlConfigured(): boolean {
  try {
    return Boolean(loadHostedSamlConfig('http://localhost'));
  } catch {
    return false;
  }
}

export function getHostedSamlMetadata(requestOrigin?: string | URL | null): string {
  const config = loadHostedSamlConfig(requestOrigin);
  if (!config) {
    throw new Error('Hosted SAML SSO is not configured.');
  }
  const { sp } = buildEntities(config);
  return sp.getMetadata();
}

export function buildHostedSamlAuthorizationRequest(options?: {
  requestOrigin?: string | URL | null;
  emailHint?: string | null;
}): HostedSamlAuthorizationRequest {
  const config = loadHostedSamlConfig(options?.requestOrigin);
  if (!config) {
    throw new Error('Hosted SAML SSO is not configured.');
  }
  const { sp, idp } = buildEntities(config);
  const request = sp.createLoginRequest(idp, 'redirect') as { id: string; context: string };
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (config.relayStateTtlMinutes * 60 * 1000));
  const relayState = sealRelayState({
    version: 1,
    requestId: request.id,
    issuer: config.entityId,
    metadataUrl: config.metadataUrl,
    acsUrl: config.acsUrl,
    emailHint: normalizeEmail(options?.emailHint),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const url = new URL(request.context);
  url.searchParams.set('RelayState', relayState);
  return {
    mode: 'sp_initiated_redirect',
    entityId: config.entityId,
    metadataUrl: config.metadataUrl,
    acsUrl: config.acsUrl,
    authorizationUrl: url.href,
    requestId: request.id,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function completeHostedSamlAuthorization(input: {
  requestOrigin?: string | URL | null;
  samlResponse: string;
  relayState: string;
}): Promise<{
  relayState: HostedSamlRelayState;
  responseId: string | null;
  identity: HostedSamlCallbackIdentity;
}> {
  const relayState = unsealRelayState(input.relayState);
  const config = loadHostedSamlConfig(input.requestOrigin ?? relayState.metadataUrl);
  if (!config) {
    throw new Error('Hosted SAML SSO is not configured.');
  }
  if (normalizeIssuer(relayState.issuer) !== normalizeIssuer(config.entityId)) {
    throw new Error('SAML relay state issuer does not match the current hosted configuration.');
  }
  const { sp, idp } = buildEntities(config);
  const parsed = await sp.parseLoginResponse(idp, 'post', {
    body: {
      SAMLResponse: input.samlResponse,
      RelayState: input.relayState,
    },
  });
  const extract = parsed.extract ?? {};
  const inResponseTo = typeof extract.response?.inResponseTo === 'string'
    ? extract.response.inResponseTo.trim()
    : '';
  if (!inResponseTo || inResponseTo !== relayState.requestId) {
    throw new Error('SAML response InResponseTo does not match the issued login request.');
  }
  const audience = normalizeStringArray(extract.audience);
  if (audience.length > 0 && !audience.includes(config.entityId)) {
    throw new Error('SAML response audience does not include the hosted service provider entity ID.');
  }
  const issuer = normalizeIssuer(typeof extract.issuer === 'string' ? extract.issuer : '');
  if (!issuer) {
    throw new Error('SAML response issuer is missing.');
  }
  const nameId = typeof extract.nameID === 'string' ? extract.nameID.trim() : '';
  if (!nameId) {
    throw new Error('SAML response NameID is missing.');
  }
  const attributes = normalizeAttributeMap(extract.attributes);
  const emailFromAttributes = normalizeEmail(firstAttribute(attributes, [
    'email',
    'emailAddress',
    'mail',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    'urn:oid:0.9.2342.19200300.100.1.3',
  ]));
  const displayName = firstAttribute(attributes, [
    'displayName',
    'name',
    'givenName',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  ]);
  const nameIdFormat = typeof extract.nameIDFormat === 'string' && extract.nameIDFormat.trim()
    ? extract.nameIDFormat.trim()
    : null;
  const sessionIndex = typeof extract.sessionIndex?.sessionIndex === 'string' && extract.sessionIndex.sessionIndex.trim()
    ? extract.sessionIndex.sessionIndex.trim()
    : null;
  const email = emailFromAttributes ?? normalizeEmail(nameId.includes('@') ? nameId : null);

  return {
    relayState,
    responseId: typeof extract.response?.id === 'string' && extract.response.id.trim()
      ? extract.response.id.trim()
      : null,
    identity: {
      issuer,
      subject: nameId,
      email,
      emailVerified: email ? true : null,
      name: displayName,
      nameId,
      nameIdFormat,
      sessionIndex,
      audience,
      attributes,
      claims: {
        issuer,
        audience,
        email,
        name: displayName,
        nameId,
        nameIdFormat,
        sessionIndex,
        attributes,
      },
    },
  };
}

export function hostedSamlAllowsAutomaticLinking(identity: HostedSamlCallbackIdentity): boolean {
  if (!identity.email) return false;
  return true;
}

export function accountUserSamlSummary(record: AccountUserRecord): {
  linked: boolean;
  identityCount: number;
  lastLoginAt: string | null;
} {
  const identities = record.federation.saml.identities;
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

export function linkAccountUserSamlIdentity(
  record: AccountUserRecord,
  identity: HostedSamlCallbackIdentity,
  now = new Date().toISOString(),
): { record: AccountUserRecord; linkedIdentity: AccountUserSamlIdentityRecord; changed: boolean } {
  const next = structuredClone(record);
  const identities = next.federation.saml.identities;
  const existing = identities.find((entry) =>
    normalizeIssuer(entry.issuer) === normalizeIssuer(identity.issuer)
    && entry.subject.trim() === identity.subject.trim());
  if (existing) {
    const changed =
      existing.email !== identity.email
      || existing.lastLoginAt !== now
      || existing.nameIdFormat !== identity.nameIdFormat;
    existing.email = identity.email;
    existing.nameIdFormat = identity.nameIdFormat;
    existing.lastLoginAt = now;
    next.updatedAt = changed ? now : next.updatedAt;
    return { record: next, linkedIdentity: existing, changed };
  }
  const linkedIdentity: AccountUserSamlIdentityRecord = {
    id: `saml_${randomBytes(8).toString('hex')}`,
    issuer: normalizeIssuer(identity.issuer),
    subject: identity.subject.trim(),
    email: identity.email,
    nameIdFormat: identity.nameIdFormat,
    linkedAt: now,
    lastLoginAt: now,
  };
  identities.push(linkedIdentity);
  next.updatedAt = now;
  return { record: next, linkedIdentity, changed: true };
}

export interface HostedSamlReplayRecord {
  requestId: string;
  responseId: string | null;
  issuer: string;
  subject: string;
  consumedAt: string;
  expiresAt: string;
}
