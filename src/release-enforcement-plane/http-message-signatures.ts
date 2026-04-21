import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  timingSafeEqual,
  verify as verifyBytes,
  type JsonWebKey,
} from 'node:crypto';
import { calculateJwkThumbprint } from 'jose';
import type { JWK } from 'jose';
import type { IssuedReleaseToken } from '../release-kernel/release-token.js';
import type { ReleaseTokenConfirmationClaim } from '../release-kernel/object-model.js';
import {
  createReleasePresentation,
  type ReleasePresentation,
  type ReleasePresentationProof,
} from './object-model.js';
import type { ReplayLedgerEntry } from './freshness.js';
import type { EnforcementFailureReason } from './types.js';
import { ENFORCEMENT_FAILURE_REASONS } from './types.js';

/**
 * Signed HTTP authorization envelopes.
 *
 * This module implements Attestor's RFC 9421-style detached request signature
 * path for webhook and callback boundaries. It signs stable HTTP components,
 * release-token headers, and RFC 9530 Content-Digest values so request
 * integrity survives ordinary HTTP intermediaries without turning the release
 * token back into a reusable bearer credential.
 */

export const HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION =
  'attestor.release-enforcement-http-message-signatures.v1';
export const HTTP_MESSAGE_SIGNATURE_LABEL = 'attestor';
export const HTTP_MESSAGE_SIGNATURE_TAG = 'attestor-release-authorization';
export const HTTP_MESSAGE_SIGNATURE_ALGORITHM = 'ed25519';
export const HTTP_MESSAGE_SIGNATURE_CONTENT_DIGEST_ALGORITHM = 'sha-256';
export const DEFAULT_HTTP_MESSAGE_SIGNATURE_MAX_AGE_SECONDS = 300;
export const DEFAULT_HTTP_MESSAGE_SIGNATURE_CLOCK_SKEW_SECONDS = 30;

export const ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER = 'attestor-release-token-digest';
export const ATTESTOR_RELEASE_TOKEN_ID_HEADER = 'attestor-release-token-id';
export const ATTESTOR_RELEASE_DECISION_ID_HEADER = 'attestor-release-decision-id';
export const ATTESTOR_TARGET_ID_HEADER = 'attestor-target-id';
export const ATTESTOR_OUTPUT_HASH_HEADER = 'attestor-output-hash';
export const ATTESTOR_CONSEQUENCE_HASH_HEADER = 'attestor-consequence-hash';

export const DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS = Object.freeze([
  '@method',
  '@target-uri',
  'authorization',
  'content-digest',
  ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
  ATTESTOR_OUTPUT_HASH_HEADER,
  ATTESTOR_CONSEQUENCE_HASH_HEADER,
] as const);

export type HttpMessageSignatureAlgorithm = typeof HTTP_MESSAGE_SIGNATURE_ALGORITHM;

export type HttpMessageHeaderValue =
  | string
  | number
  | readonly (string | number)[]
  | null
  | undefined;

export interface HttpMessageForSignature {
  readonly method: string;
  readonly uri: string;
  readonly headers?: Readonly<Record<string, HttpMessageHeaderValue>>;
  readonly body?: string | Uint8Array | Buffer | null;
}

export interface HttpMessageSignatureKeyPair {
  readonly algorithm: HttpMessageSignatureAlgorithm;
  readonly privateJwk: JWK;
  readonly publicJwk: JWK;
  readonly publicKeyThumbprint: string;
  readonly keyId: string;
}

export interface CreateHttpMessageSignatureInput {
  readonly message: HttpMessageForSignature;
  readonly privateJwk: JWK;
  readonly publicJwk: JWK;
  readonly keyId?: string;
  readonly label?: string;
  readonly tag?: string;
  readonly algorithm?: HttpMessageSignatureAlgorithm;
  readonly coveredComponents?: readonly string[];
  readonly createdAt?: string;
  readonly expiresAt?: string | null;
  readonly nonce?: string | null;
}

export interface HttpMessageSignature {
  readonly version: typeof HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION;
  readonly label: string;
  readonly algorithm: HttpMessageSignatureAlgorithm;
  readonly keyId: string;
  readonly publicKeyThumbprint: string;
  readonly coveredComponents: readonly string[];
  readonly signatureInput: string;
  readonly signature: string;
  readonly signatureBase: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly nonce: string | null;
  readonly tag: string | null;
  readonly replayKey: string;
}

export interface CreateHttpAuthorizationEnvelopeInput {
  readonly request: HttpMessageForSignature;
  readonly issuedToken: IssuedReleaseToken;
  readonly privateJwk: JWK;
  readonly publicJwk: JWK;
  readonly keyId?: string;
  readonly label?: string;
  readonly tag?: string;
  readonly algorithm?: HttpMessageSignatureAlgorithm;
  readonly coveredComponents?: readonly string[];
  readonly createdAt?: string;
  readonly expiresAt?: string | null;
  readonly nonce?: string | null;
  readonly presentedAt?: string;
  readonly scope?: readonly string[];
}

export interface HttpAuthorizationEnvelope {
  readonly version: typeof HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION;
  readonly label: string;
  readonly algorithm: HttpMessageSignatureAlgorithm;
  readonly method: string;
  readonly uri: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyDigest: string;
  readonly releaseTokenDigest: string;
  readonly signatureInput: string;
  readonly signature: string;
  readonly coveredComponents: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly nonce: string | null;
  readonly keyId: string;
  readonly replayKey: string;
  readonly presentation: ReleasePresentation;
}

export interface VerifyHttpMessageSignatureInput {
  readonly message: HttpMessageForSignature;
  readonly signatureInput: string;
  readonly signature: string;
  readonly publicJwk: JWK;
  readonly label?: string;
  readonly expectedKeyId?: string | null;
  readonly expectedJwkThumbprint?: string | null;
  readonly expectedNonce?: string | null;
  readonly expectedTag?: string | null;
  readonly requiredCoveredComponents?: readonly string[];
  readonly now: string;
  readonly maxSignatureAgeSeconds?: number;
  readonly clockSkewSeconds?: number;
  readonly replayLedgerEntry?: ReplayLedgerEntry | null;
}

export interface HttpMessageSignatureVerification {
  readonly version: typeof HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION;
  readonly status: 'valid' | 'invalid';
  readonly checkedAt: string;
  readonly label: string;
  readonly algorithm: string | null;
  readonly keyId: string | null;
  readonly publicKeyThumbprint: string | null;
  readonly coveredComponents: readonly string[];
  readonly createdAt: string | null;
  readonly expiresAt: string | null;
  readonly nonce: string | null;
  readonly tag: string | null;
  readonly contentDigest: string | null;
  readonly replayKey: string | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
}

interface ParsedSignatureInput {
  readonly label: string;
  readonly signatureParamsValue: string;
  readonly coveredComponents: readonly string[];
  readonly params: Readonly<Record<string, string | number | boolean>>;
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
    throw new Error(`HTTP message signature ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeHeaderName(name: string): string {
  const normalized = normalizeIdentifier(name, 'headerName').toLowerCase();
  if (normalized.startsWith('@')) {
    return normalized;
  }
  if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(normalized)) {
    throw new Error(`HTTP message signature header name is invalid: ${name}`);
  }
  return normalized;
}

function normalizeComponentName(component: string): string {
  return normalizeHeaderName(component);
}

function normalizeHttpMethod(method: string): string {
  return normalizeIdentifier(method, 'method').toUpperCase();
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`HTTP message signature ${fieldName} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function epochSeconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function isoFromEpochSeconds(value: number | null): string | null {
  return value === null ? null : new Date(value * 1000).toISOString();
}

function bytesForBody(body: HttpMessageForSignature['body']): Buffer {
  if (body === undefined || body === null) {
    return Buffer.alloc(0);
  }
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  return Buffer.from(body);
}

export function contentDigestForBody(body: HttpMessageForSignature['body']): string {
  const digest = createHash('sha256').update(bytesForBody(body)).digest('base64');
  return `${HTTP_MESSAGE_SIGNATURE_CONTENT_DIGEST_ALGORITHM}=:${digest}:`;
}

export function httpReleaseTokenDigest(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function normalizedUri(uri: string): URL {
  const parsed = new URL(normalizeIdentifier(uri, 'uri'));
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';
  return parsed;
}

export function normalizeHttpSignatureTargetUri(uri: string): string {
  return normalizedUri(uri).toString();
}

function normalizeHeaderValue(value: HttpMessageHeaderValue): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    const values = value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    return values.length > 0 ? values.join(', ') : null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeHttpMessageHeaders(
  headers: Readonly<Record<string, HttpMessageHeaderValue>> | undefined,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  if (!headers) {
    return Object.freeze(normalized);
  }

  for (const [name, value] of Object.entries(headers)) {
    const headerName = normalizeHeaderName(name);
    const headerValue = normalizeHeaderValue(value);
    if (headerValue !== null) {
      normalized[headerName] = headerValue;
    }
  }

  return Object.freeze(normalized);
}

function headerValueForComponent(
  headers: Readonly<Record<string, string>>,
  component: string,
): string {
  const value = headers[normalizeHeaderName(component)];
  if (value === undefined) {
    throw new Error(`HTTP message signature missing covered header: ${component}`);
  }
  return value;
}

function componentValue(message: HttpMessageForSignature, component: string): string {
  const normalizedComponent = normalizeComponentName(component);
  const uri = normalizedUri(message.uri);
  const headers = normalizeHttpMessageHeaders(message.headers);

  switch (normalizedComponent) {
    case '@method':
      return normalizeHttpMethod(message.method);
    case '@target-uri':
      return uri.toString();
    case '@authority':
      return uri.host.toLowerCase();
    case '@scheme':
      return uri.protocol.slice(0, -1);
    case '@path':
      return uri.pathname || '/';
    case '@query':
      return uri.search || '?';
    case '@request-target':
      return `${uri.pathname || '/'}${uri.search}`;
    default:
      if (normalizedComponent.startsWith('@')) {
        throw new Error(`HTTP message signature unsupported derived component: ${component}`);
      }
      return headerValueForComponent(headers, normalizedComponent);
  }
}

function escapeSfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function serializeParameterValue(value: string | number | boolean): string {
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '?1' : '?0';
  }
  return `"${escapeSfString(value)}"`;
}

function signatureParamsValue(input: {
  readonly components: readonly string[];
  readonly created: number;
  readonly expires: number | null;
  readonly keyId: string;
  readonly algorithm: HttpMessageSignatureAlgorithm;
  readonly nonce: string | null;
  readonly tag: string | null;
}): string {
  const componentList = input.components
    .map((component) => `"${escapeSfString(normalizeComponentName(component))}"`)
    .join(' ');
  const params: [string, string | number | boolean][] = [
    ['created', input.created],
  ];

  if (input.expires !== null) {
    params.push(['expires', input.expires]);
  }
  params.push(['keyid', input.keyId], ['alg', input.algorithm]);
  if (input.nonce !== null) {
    params.push(['nonce', input.nonce]);
  }
  if (input.tag !== null) {
    params.push(['tag', input.tag]);
  }

  return `(${componentList})${params
    .map(([name, value]) => `;${name}=${serializeParameterValue(value)}`)
    .join('')}`;
}

function signatureInputHeaderValue(label: string, value: string): string {
  return `${normalizeIdentifier(label, 'label')}=${value}`;
}

function signatureHeaderValue(label: string, signature: Buffer): string {
  return `${normalizeIdentifier(label, 'label')}=:${signature.toString('base64')}:`;
}

function splitTopLevel(input: string, separator: string): readonly string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let escaped = false;
  let depth = 0;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && inQuote) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      current += char;
      continue;
    }
    if (!inQuote && char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (!inQuote && char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (!inQuote && depth === 0 && char === separator) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return Object.freeze(parts);
}

function unquoteSfString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }

  let output = '';
  let escaped = false;
  for (const char of trimmed.slice(1, -1)) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    output += char;
  }
  return output;
}

function parseParameterValue(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  if (trimmed === '?1') {
    return true;
  }
  if (trimmed === '?0') {
    return false;
  }
  return unquoteSfString(trimmed);
}

function parseSignatureParamsValue(value: string, label: string): ParsedSignatureInput {
  const trimmed = value.trim();
  const open = trimmed.indexOf('(');
  const close = trimmed.indexOf(')');
  if (open !== 0 || close <= open) {
    throw new Error('HTTP message signature Signature-Input must contain an inner list.');
  }

  const componentSection = trimmed.slice(open + 1, close);
  const coveredComponents = Array.from(componentSection.matchAll(/"((?:\\.|[^"\\])*)"/g))
    .map((match) => normalizeComponentName(unquoteSfString(`"${match[1] ?? ''}"`)));
  if (coveredComponents.length === 0) {
    throw new Error('HTTP message signature Signature-Input must cover at least one component.');
  }

  const params: Record<string, string | number | boolean> = {};
  for (const rawPart of splitTopLevel(trimmed.slice(close + 1), ';')) {
    if (rawPart.length === 0) {
      continue;
    }
    const equals = rawPart.indexOf('=');
    if (equals <= 0) {
      continue;
    }
    const name = rawPart.slice(0, equals).trim().toLowerCase();
    params[name] = parseParameterValue(rawPart.slice(equals + 1));
  }

  return Object.freeze({
    label,
    signatureParamsValue: trimmed,
    coveredComponents: Object.freeze(coveredComponents),
    params: Object.freeze(params),
  });
}

function parseSignatureInput(
  input: string,
  expectedLabel: string,
): ParsedSignatureInput {
  const trimmed = normalizeIdentifier(input, 'signatureInput');
  const expected = normalizeIdentifier(expectedLabel, 'label');
  const entries = splitTopLevel(trimmed, ',');

  for (const entry of entries) {
    const equals = entry.indexOf('=');
    if (equals > 0) {
      const label = entry.slice(0, equals).trim();
      if (label === expected) {
        return parseSignatureParamsValue(entry.slice(equals + 1), label);
      }
    }
  }

  if (trimmed.startsWith('(')) {
    return parseSignatureParamsValue(trimmed, expected);
  }

  throw new Error(`HTTP message signature Signature-Input does not include ${expected}.`);
}

function parseSignatureBytes(input: string, expectedLabel: string): Buffer {
  const trimmed = normalizeIdentifier(input, 'signature');
  const expected = normalizeIdentifier(expectedLabel, 'label');
  const entries = splitTopLevel(trimmed, ',');

  for (const entry of entries) {
    const equals = entry.indexOf('=');
    if (equals > 0) {
      const label = entry.slice(0, equals).trim();
      if (label === expected) {
        return parseBinaryValue(entry.slice(equals + 1));
      }
    }
  }

  return parseBinaryValue(trimmed);
}

function parseBinaryValue(value: string): Buffer {
  const trimmed = value.trim();
  const binary = trimmed.startsWith(':') && trimmed.endsWith(':')
    ? trimmed.slice(1, -1)
    : trimmed;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(binary)) {
    throw new Error('HTTP message signature value must be base64.');
  }
  return Buffer.from(binary, 'base64');
}

function numericParam(
  params: Readonly<Record<string, string | number | boolean>>,
  name: string,
): number | null {
  const value = params[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringParam(
  params: Readonly<Record<string, string | number | boolean>>,
  name: string,
): string | null {
  const value = params[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function signatureBase(
  message: HttpMessageForSignature,
  components: readonly string[],
  paramsValue: string,
): string {
  const lines = components.map(
    (component) => `"${normalizeComponentName(component)}": ${componentValue(message, component)}`,
  );
  lines.push(`"@signature-params": ${paramsValue}`);
  return lines.join('\n');
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

function jwkForCrypto(jwk: JWK): JsonWebKey {
  const {
    alg: _alg,
    kid: _kid,
    use: _use,
    key_ops: _keyOps,
    ext: _ext,
    ...key
  } = jwk as JWK & Record<string, unknown>;
  return key as unknown as JsonWebKey;
}

async function publicJwkThumbprint(publicJwk: JWK): Promise<string> {
  return calculateJwkThumbprint(publicJwkForHeader(publicJwk), 'sha256');
}

function signEd25519(input: {
  readonly privateJwk: JWK;
  readonly signatureBase: string;
}): Buffer {
  const privateKey = createPrivateKey({
    key: jwkForCrypto(input.privateJwk),
    format: 'jwk',
  });
  return signBytes(null, Buffer.from(input.signatureBase, 'utf8'), privateKey);
}

function verifyEd25519(input: {
  readonly publicJwk: JWK;
  readonly signatureBase: string;
  readonly signature: Buffer;
}): boolean {
  const publicKey = createPublicKey({
    key: jwkForCrypto(publicJwkForHeader(input.publicJwk)),
    format: 'jwk',
  });
  return verifyBytes(
    null,
    Buffer.from(input.signatureBase, 'utf8'),
    publicKey,
    input.signature,
  );
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function timeFailureReasons(input: {
  readonly created: number | null;
  readonly expires: number | null;
  readonly now: string;
  readonly maxAgeSeconds: number;
  readonly clockSkewSeconds: number;
}): readonly EnforcementFailureReason[] {
  const reasons: EnforcementFailureReason[] = [];
  const now = epochSeconds(input.now);

  if (input.created === null) {
    reasons.push('invalid-signature');
  } else {
    if (input.created > now + input.clockSkewSeconds) {
      reasons.push('future-issued-at');
    }
    if (now - input.created > input.maxAgeSeconds + input.clockSkewSeconds) {
      reasons.push('stale-authorization');
    }
  }

  if (input.expires !== null && now - input.clockSkewSeconds >= input.expires) {
    reasons.push('expired-authorization');
  }

  return uniqueFailureReasons(reasons);
}

function coverageFailureReasons(input: {
  readonly coveredComponents: readonly string[];
  readonly requiredCoveredComponents: readonly string[];
}): readonly EnforcementFailureReason[] {
  const covered = new Set(input.coveredComponents.map(normalizeComponentName));
  const missing = input.requiredCoveredComponents
    .map(normalizeComponentName)
    .some((component) => !covered.has(component));
  return missing ? ['binding-mismatch'] : [];
}

function contentDigestFailureReasons(message: HttpMessageForSignature): readonly EnforcementFailureReason[] {
  const headers = normalizeHttpMessageHeaders(message.headers);
  const received = headers['content-digest'];
  if (received === undefined) {
    return ['binding-mismatch'];
  }
  return timingSafeStringEqual(received, contentDigestForBody(message.body))
    ? []
    : ['binding-mismatch'];
}

export async function generateHttpMessageSignatureKeyPair(): Promise<HttpMessageSignatureKeyPair> {
  const keyPair = generateKeyPairSync('ed25519');
  const privateJwk = keyPair.privateKey.export({ format: 'jwk' }) as JWK;
  const publicJwk = publicJwkForHeader(keyPair.publicKey.export({ format: 'jwk' }) as JWK);
  const publicKeyThumbprint = await publicJwkThumbprint(publicJwk);

  return Object.freeze({
    algorithm: HTTP_MESSAGE_SIGNATURE_ALGORITHM,
    privateJwk: Object.freeze({
      ...privateJwk,
      alg: 'EdDSA',
    }),
    publicJwk: Object.freeze({
      ...publicJwk,
      alg: 'EdDSA',
    }),
    publicKeyThumbprint,
    keyId: publicKeyThumbprint,
  });
}

export function httpMessageSignatureReplayKey(input: {
  readonly nonce?: string | null;
  readonly signature: string;
}): string {
  const nonce = input.nonce?.trim();
  if (nonce) {
    return `http-message-signature:${nonce}`;
  }

  const rawSignature = input.signature.includes('=')
    ? input.signature.slice(input.signature.indexOf('=') + 1)
    : input.signature;
  const signature = parseBinaryValue(rawSignature).toString('base64');
  return `http-message-signature:${createHash('sha256').update(signature).digest('hex')}`;
}

export function createHttpMessageSignatureReleaseTokenConfirmation(input: {
  readonly publicKeyThumbprint: string;
}): ReleaseTokenConfirmationClaim {
  return Object.freeze({
    jkt: normalizeIdentifier(input.publicKeyThumbprint, 'publicKeyThumbprint'),
  });
}

export async function createHttpMessageSignature(
  input: CreateHttpMessageSignatureInput,
): Promise<HttpMessageSignature> {
  const algorithm = input.algorithm ?? HTTP_MESSAGE_SIGNATURE_ALGORITHM;
  if (algorithm !== HTTP_MESSAGE_SIGNATURE_ALGORITHM) {
    throw new Error(`HTTP message signature unsupported algorithm: ${algorithm}`);
  }

  const label = input.label ?? HTTP_MESSAGE_SIGNATURE_LABEL;
  const createdAt = normalizeIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'createdAt');
  const expiresAt =
    input.expiresAt === undefined
      ? new Date(new Date(createdAt).getTime() + DEFAULT_HTTP_MESSAGE_SIGNATURE_MAX_AGE_SECONDS * 1000).toISOString()
      : input.expiresAt === null
        ? null
        : normalizeIsoTimestamp(input.expiresAt, 'expiresAt');
  const keyId = input.keyId ?? await publicJwkThumbprint(input.publicJwk);
  const publicKeyThumbprintValue = await publicJwkThumbprint(input.publicJwk);
  const components = Object.freeze(
    (input.coveredComponents ?? DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS).map(
      normalizeComponentName,
    ),
  );
  const paramsValue = signatureParamsValue({
    components,
    created: epochSeconds(createdAt),
    expires: expiresAt === null ? null : epochSeconds(expiresAt),
    keyId,
    algorithm,
    nonce: input.nonce ?? null,
    tag: input.tag ?? HTTP_MESSAGE_SIGNATURE_TAG,
  });
  const base = signatureBase(input.message, components, paramsValue);
  const signatureBytes = signEd25519({
    privateJwk: input.privateJwk,
    signatureBase: base,
  });
  const signature = signatureHeaderValue(label, signatureBytes);

  return Object.freeze({
    version: HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION,
    label,
    algorithm,
    keyId,
    publicKeyThumbprint: publicKeyThumbprintValue,
    coveredComponents: components,
    signatureInput: signatureInputHeaderValue(label, paramsValue),
    signature,
    signatureBase: base,
    createdAt,
    expiresAt,
    nonce: input.nonce ?? null,
    tag: input.tag ?? HTTP_MESSAGE_SIGNATURE_TAG,
    replayKey: httpMessageSignatureReplayKey({
      nonce: input.nonce,
      signature,
    }),
  });
}

export async function verifyHttpMessageSignature(
  input: VerifyHttpMessageSignatureInput,
): Promise<HttpMessageSignatureVerification> {
  const checkedAt = normalizeIsoTimestamp(input.now, 'now');
  const label = input.label ?? HTTP_MESSAGE_SIGNATURE_LABEL;
  let parsed: ParsedSignatureInput;
  let signatureBytes: Buffer;

  try {
    parsed = parseSignatureInput(input.signatureInput, label);
    signatureBytes = parseSignatureBytes(input.signature, parsed.label);
  } catch {
    return Object.freeze({
      version: HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION,
      status: 'invalid',
      checkedAt,
      label,
      algorithm: null,
      keyId: null,
      publicKeyThumbprint: null,
      coveredComponents: Object.freeze([]),
      createdAt: null,
      expiresAt: null,
      nonce: null,
      tag: null,
      contentDigest: null,
      replayKey: null,
      failureReasons: uniqueFailureReasons(['invalid-signature']),
    });
  }

  const algorithm = stringParam(parsed.params, 'alg');
  const keyId = stringParam(parsed.params, 'keyid');
  const nonce = stringParam(parsed.params, 'nonce');
  const tag = stringParam(parsed.params, 'tag');
  const created = numericParam(parsed.params, 'created');
  const expires = numericParam(parsed.params, 'expires');
  const requiredCoveredComponents =
    input.requiredCoveredComponents ?? DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS;
  const headers = normalizeHttpMessageHeaders(input.message.headers);
  const failureReasons: EnforcementFailureReason[] = [];
  let publicKeyThumbprintValue: string | null = null;

  if (algorithm !== HTTP_MESSAGE_SIGNATURE_ALGORITHM) {
    failureReasons.push('invalid-signature');
  }

  if (keyId === null) {
    failureReasons.push('invalid-signature');
  } else if (
    input.expectedKeyId !== undefined &&
    input.expectedKeyId !== null &&
    keyId !== input.expectedKeyId
  ) {
    failureReasons.push('binding-mismatch');
  }

  if (
    input.expectedTag !== undefined &&
    input.expectedTag !== null &&
    tag !== input.expectedTag
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
    ...coverageFailureReasons({
      coveredComponents: parsed.coveredComponents,
      requiredCoveredComponents,
    }),
    ...timeFailureReasons({
      created,
      expires,
      now: checkedAt,
      maxAgeSeconds:
        input.maxSignatureAgeSeconds ?? DEFAULT_HTTP_MESSAGE_SIGNATURE_MAX_AGE_SECONDS,
      clockSkewSeconds:
        input.clockSkewSeconds ?? DEFAULT_HTTP_MESSAGE_SIGNATURE_CLOCK_SKEW_SECONDS,
    }),
  );

  if (parsed.coveredComponents.includes('content-digest')) {
    failureReasons.push(...contentDigestFailureReasons(input.message));
  }

  try {
    publicKeyThumbprintValue = await publicJwkThumbprint(input.publicJwk);
    if (
      input.expectedJwkThumbprint !== undefined &&
      input.expectedJwkThumbprint !== null &&
      publicKeyThumbprintValue !== input.expectedJwkThumbprint
    ) {
      failureReasons.push('binding-mismatch');
    }

    const base = signatureBase(
      input.message,
      parsed.coveredComponents,
      parsed.signatureParamsValue,
    );
    if (
      algorithm === HTTP_MESSAGE_SIGNATURE_ALGORITHM &&
      !verifyEd25519({
        publicJwk: input.publicJwk,
        signatureBase: base,
        signature: signatureBytes,
      })
    ) {
      failureReasons.push('invalid-signature');
    }
  } catch {
    failureReasons.push('invalid-signature');
  }

  const replayKey = httpMessageSignatureReplayKey({
    nonce,
    signature: signatureBytes.toString('base64'),
  });
  if (
    input.replayLedgerEntry &&
    input.replayLedgerEntry.key === replayKey &&
    new Date(input.replayLedgerEntry.expiresAt).getTime() >= new Date(checkedAt).getTime()
  ) {
    failureReasons.push('replayed-authorization');
  }

  const uniqueFailures = uniqueFailureReasons(failureReasons);
  return Object.freeze({
    version: HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION,
    status: uniqueFailures.length === 0 ? 'valid' : 'invalid',
    checkedAt,
    label: parsed.label,
    algorithm,
    keyId,
    publicKeyThumbprint: publicKeyThumbprintValue,
    coveredComponents: parsed.coveredComponents,
    createdAt: isoFromEpochSeconds(created),
    expiresAt: isoFromEpochSeconds(expires),
    nonce,
    tag,
    contentDigest: headers['content-digest'] ?? null,
    replayKey,
    failureReasons: uniqueFailures,
  });
}

function signedEnvelopeHeaders(input: {
  readonly request: HttpMessageForSignature;
  readonly issuedToken: IssuedReleaseToken;
}): Readonly<Record<string, string>> {
  const headers = {
    ...normalizeHttpMessageHeaders(input.request.headers),
    authorization: `Bearer ${input.issuedToken.token}`,
    'content-digest': contentDigestForBody(input.request.body),
    [ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER]: httpReleaseTokenDigest(input.issuedToken.token),
    [ATTESTOR_RELEASE_TOKEN_ID_HEADER]: input.issuedToken.tokenId,
    [ATTESTOR_RELEASE_DECISION_ID_HEADER]: input.issuedToken.claims.decision_id,
    [ATTESTOR_TARGET_ID_HEADER]: input.issuedToken.claims.aud,
    [ATTESTOR_OUTPUT_HASH_HEADER]: input.issuedToken.claims.output_hash,
    [ATTESTOR_CONSEQUENCE_HASH_HEADER]: input.issuedToken.claims.consequence_hash,
  };

  return Object.freeze(headers);
}

function proofFromHttpSignature(signature: HttpMessageSignature): ReleasePresentationProof {
  return Object.freeze({
    kind: 'http-message-signature',
    signatureInput: signature.signatureInput,
    signature: signature.signature,
    keyId: signature.keyId,
    coveredComponents: signature.coveredComponents,
    createdAt: signature.createdAt,
    expiresAt: signature.expiresAt,
    nonce: signature.nonce,
  });
}

export async function createHttpAuthorizationEnvelope(
  input: CreateHttpAuthorizationEnvelopeInput,
): Promise<HttpAuthorizationEnvelope> {
  const headers = signedEnvelopeHeaders({
    request: input.request,
    issuedToken: input.issuedToken,
  });
  const message: HttpMessageForSignature = {
    method: input.request.method,
    uri: input.request.uri,
    headers,
    body: input.request.body,
  };
  const signature = await createHttpMessageSignature({
    message,
    privateJwk: input.privateJwk,
    publicJwk: input.publicJwk,
    keyId: input.keyId,
    label: input.label,
    tag: input.tag,
    algorithm: input.algorithm,
    coveredComponents: input.coveredComponents,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
  });
  const finalHeaders = Object.freeze({
    ...headers,
    'signature-input': signature.signatureInput,
    signature: signature.signature,
  });
  const presentation = createReleasePresentation({
    mode: 'http-message-signature',
    presentedAt: input.presentedAt ?? signature.createdAt,
    releaseToken: input.issuedToken.token,
    releaseTokenId: input.issuedToken.tokenId,
    releaseTokenDigest: httpReleaseTokenDigest(input.issuedToken.token),
    issuer: input.issuedToken.claims.iss,
    subject: input.issuedToken.claims.sub,
    audience: input.issuedToken.claims.aud,
    expiresAt: input.issuedToken.expiresAt,
    scope: input.scope ?? input.issuedToken.claims.scope?.split(/\s+/) ?? [],
    proof: proofFromHttpSignature(signature),
  });

  return Object.freeze({
    version: HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION,
    label: signature.label,
    algorithm: signature.algorithm,
    method: normalizeHttpMethod(input.request.method),
    uri: normalizeHttpSignatureTargetUri(input.request.uri),
    headers: finalHeaders,
    bodyDigest: headers['content-digest'],
    releaseTokenDigest: headers[ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER],
    signatureInput: signature.signatureInput,
    signature: signature.signature,
    coveredComponents: signature.coveredComponents,
    createdAt: signature.createdAt,
    expiresAt: signature.expiresAt,
    nonce: signature.nonce,
    keyId: signature.keyId,
    replayKey: signature.replayKey,
    presentation,
  });
}

export function httpMessageFromAuthorizationEnvelope(
  envelope: HttpAuthorizationEnvelope,
  body?: HttpMessageForSignature['body'],
): HttpMessageForSignature {
  return Object.freeze({
    method: envelope.method,
    uri: envelope.uri,
    headers: envelope.headers,
    body: body ?? null,
  });
}
