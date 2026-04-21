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
import {
  ENFORCEMENT_FAILURE_REASONS,
  type EnforcementFailureReason,
  type ReleaseEnforcementConsequenceType,
  type ReleaseEnforcementRiskClass,
} from './types.js';

/**
 * Signed async consequence envelopes.
 *
 * This module carries Attestor release authorization across queues, exports,
 * files, and artifact boundaries. It uses DSSE pre-authentication encoding for
 * the signature context, an in-toto Statement-v1-shaped payload for subject and
 * predicate binding, CloudEvents 1.0 metadata for async routing, and a
 * deterministic JSON representation for stable hashing.
 */

export const ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION =
  'attestor.release-enforcement-async-envelope.v1';
export const ASYNC_CONSEQUENCE_ENVELOPE_PAYLOAD_TYPE =
  'application/vnd.attestor.release-enforcement.async-consequence-envelope+json;version=1';
export const ASYNC_CONSEQUENCE_ENVELOPE_PREDICATE_TYPE =
  'https://attestor.dev/release-enforcement/async-consequence-envelope/v1';
export const IN_TOTO_STATEMENT_V1_TYPE = 'https://in-toto.io/Statement/v1';
export const CLOUDEVENTS_SPEC_VERSION = '1.0';
export const ASYNC_CONSEQUENCE_ENVELOPE_ALGORITHM = 'ed25519';
export const DEFAULT_ASYNC_ENVELOPE_MAX_AGE_SECONDS = 900;
export const DEFAULT_ASYNC_ENVELOPE_CLOCK_SKEW_SECONDS = 30;

export type AsyncConsequenceBoundaryKind =
  | 'queue'
  | 'topic'
  | 'export'
  | 'file'
  | 'artifact';

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export type AsyncConsequenceEnvelopeAlgorithm =
  typeof ASYNC_CONSEQUENCE_ENVELOPE_ALGORITHM;

export interface AsyncConsequenceEnvelopeKeyPair {
  readonly algorithm: AsyncConsequenceEnvelopeAlgorithm;
  readonly privateJwk: JWK;
  readonly publicJwk: JWK;
  readonly publicKeyThumbprint: string;
  readonly keyId: string;
}

export interface AsyncConsequenceEnvelopeTarget {
  readonly kind: AsyncConsequenceBoundaryKind;
  readonly id: string;
}

export interface AsyncConsequencePayloadInput {
  readonly name: string;
  readonly mediaType?: string;
  readonly content?: string | Uint8Array | Buffer | CanonicalJsonValue | null;
  readonly digest?: string;
  readonly sizeBytes?: number;
}

export interface AsyncConsequencePayloadDescriptor {
  readonly name: string;
  readonly mediaType: string;
  readonly digest: string;
  readonly sizeBytes: number | null;
}

export interface AsyncConsequenceCloudEvent {
  readonly specversion: typeof CLOUDEVENTS_SPEC_VERSION;
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly subject: string;
  readonly time: string;
  readonly datacontenttype: string;
  readonly dataschema: string;
}

export interface AsyncConsequenceReleaseBinding {
  readonly tokenId: string;
  readonly tokenDigest: string;
  readonly decisionId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly expiresAt: string;
  readonly scope: readonly string[];
}

export interface AsyncConsequenceBinding {
  readonly consequenceType: ReleaseEnforcementConsequenceType;
  readonly riskClass: ReleaseEnforcementRiskClass;
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly policyHash: string;
}

export interface AsyncConsequenceTransportBinding {
  readonly messageId: string | null;
  readonly queueOrTopic: string | null;
}

export interface AsyncConsequenceSignerBinding {
  readonly algorithm: AsyncConsequenceEnvelopeAlgorithm;
  readonly keyId: string;
  readonly publicKeyThumbprint: string;
}

export interface AsyncConsequenceEnvelopePredicate {
  readonly version: typeof ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION;
  readonly envelopeId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
  readonly producer: string;
  readonly target: AsyncConsequenceEnvelopeTarget;
  readonly release: AsyncConsequenceReleaseBinding;
  readonly consequence: AsyncConsequenceBinding;
  readonly payload: AsyncConsequencePayloadDescriptor;
  readonly transport: AsyncConsequenceTransportBinding;
  readonly cloudEvent: AsyncConsequenceCloudEvent;
  readonly signer: AsyncConsequenceSignerBinding;
}

export interface InTotoStatementSubject {
  readonly name: string;
  readonly digest: Readonly<Record<'sha256', string>>;
}

export interface AsyncConsequenceEnvelopeStatement {
  readonly _type: typeof IN_TOTO_STATEMENT_V1_TYPE;
  readonly subject: readonly InTotoStatementSubject[];
  readonly predicateType: typeof ASYNC_CONSEQUENCE_ENVELOPE_PREDICATE_TYPE;
  readonly predicate: AsyncConsequenceEnvelopePredicate;
}

export interface DsseSignature {
  readonly keyid: string;
  readonly sig: string;
}

export interface DsseEnvelope {
  readonly payloadType: typeof ASYNC_CONSEQUENCE_ENVELOPE_PAYLOAD_TYPE;
  readonly payload: string;
  readonly signatures: readonly DsseSignature[];
}

export interface CreateSignedAsyncConsequenceEnvelopeInput {
  readonly issuedToken: IssuedReleaseToken;
  readonly privateJwk: JWK;
  readonly publicJwk: JWK;
  readonly keyId?: string;
  readonly envelopeId: string;
  readonly idempotencyKey: string;
  readonly target: AsyncConsequenceEnvelopeTarget;
  readonly payload: AsyncConsequencePayloadInput;
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly producer?: string;
  readonly messageId?: string | null;
  readonly queueOrTopic?: string | null;
  readonly cloudEventSource?: string;
  readonly cloudEventType?: string;
  readonly cloudEventSubject?: string;
  readonly presentedAt?: string;
  readonly scope?: readonly string[];
}

export interface SignedAsyncConsequenceEnvelope {
  readonly version: typeof ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION;
  readonly algorithm: AsyncConsequenceEnvelopeAlgorithm;
  readonly envelope: DsseEnvelope;
  readonly statement: AsyncConsequenceEnvelopeStatement;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
  readonly releaseTokenDigest: string;
  readonly subjectDigest: string;
  readonly statementDigest: string;
  readonly envelopeDigest: string;
  readonly signatureRef: string;
  readonly keyId: string;
  readonly publicKeyThumbprint: string;
  readonly cloudEvent: AsyncConsequenceCloudEvent;
  readonly target: AsyncConsequenceEnvelopeTarget;
  readonly replayKey: string;
  readonly presentation: ReleasePresentation;
}

export interface VerifySignedAsyncConsequenceEnvelopeInput {
  readonly envelope: DsseEnvelope | SignedAsyncConsequenceEnvelope;
  readonly publicJwk: JWK;
  readonly now: string;
  readonly expectedKeyId?: string | null;
  readonly expectedJwkThumbprint?: string | null;
  readonly expectedReleaseTokenDigest?: string | null;
  readonly expectedReleaseTokenId?: string | null;
  readonly expectedReleaseDecisionId?: string | null;
  readonly expectedAudience?: string | null;
  readonly expectedTargetId?: string | null;
  readonly expectedOutputHash?: string | null;
  readonly expectedConsequenceHash?: string | null;
  readonly expectedPolicyHash?: string | null;
  readonly expectedConsequenceType?: ReleaseEnforcementConsequenceType | null;
  readonly expectedRiskClass?: ReleaseEnforcementRiskClass | null;
  readonly expectedIdempotencyKey?: string | null;
  readonly expectedMessageId?: string | null;
  readonly expectedQueueOrTopic?: string | null;
  readonly expectedEnvelopeDigest?: string | null;
  readonly expectedSubjectDigest?: string | null;
  readonly maxEnvelopeAgeSeconds?: number;
  readonly clockSkewSeconds?: number;
  readonly replayLedgerEntry?: ReplayLedgerEntry | null;
}

export interface SignedAsyncConsequenceEnvelopeVerification {
  readonly version: typeof ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION;
  readonly status: 'valid' | 'invalid';
  readonly checkedAt: string;
  readonly keyId: string | null;
  readonly publicKeyThumbprint: string | null;
  readonly envelopeDigest: string | null;
  readonly subjectDigest: string | null;
  readonly statementDigest: string | null;
  readonly signatureRef: string | null;
  readonly createdAt: string | null;
  readonly expiresAt: string | null;
  readonly idempotencyKey: string | null;
  readonly releaseTokenDigest: string | null;
  readonly releaseTokenId: string | null;
  readonly releaseDecisionId: string | null;
  readonly targetId: string | null;
  readonly messageId: string | null;
  readonly queueOrTopic: string | null;
  readonly cloudEvent: AsyncConsequenceCloudEvent | null;
  readonly replayKey: string | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
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
    throw new Error(`Async consequence envelope ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Async consequence envelope ${fieldName} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function normalizeScope(values: readonly string[] | undefined): readonly string[] {
  if (!values || values.length === 0) {
    return Object.freeze([]);
  }

  return Object.freeze(
    Array.from(
      new Set(
        values
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    ).sort(),
  );
}

function epochSeconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Digest(bytes: Buffer | string): string {
  return `sha256:${sha256Hex(bytes)}`;
}

export function asyncReleaseTokenDigest(token: string): string {
  return sha256Digest(token);
}

function digestHex(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!normalized.startsWith('sha256:')) {
    throw new Error(`Async consequence envelope ${fieldName} must use sha256:<hex> form.`);
  }
  const hex = normalized.slice('sha256:'.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`Async consequence envelope ${fieldName} must contain a SHA-256 hex digest.`);
  }
  return hex;
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
  readonly bytes: Buffer;
}): Buffer {
  const privateKey = createPrivateKey({
    key: jwkForCrypto(input.privateJwk),
    format: 'jwk',
  });
  return signBytes(null, input.bytes, privateKey);
}

function verifyEd25519(input: {
  readonly publicJwk: JWK;
  readonly bytes: Buffer;
  readonly signature: Buffer;
}): boolean {
  const publicKey = createPublicKey({
    key: jwkForCrypto(publicJwkForHeader(input.publicJwk)),
    format: 'jwk',
  });
  return verifyBytes(null, input.bytes, publicKey, input.signature);
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function assertCanonicalNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error('Async consequence envelope canonical JSON numbers must be finite.');
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    assertCanonicalNumber(value);
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }

  throw new Error('Async consequence envelope canonical JSON only supports JSON values.');
}

function contentBytes(content: AsyncConsequencePayloadInput['content']): Buffer | null {
  if (content === undefined || content === null) {
    return null;
  }

  if (typeof content === 'string') {
    return Buffer.from(content, 'utf8');
  }

  if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
    return Buffer.from(content);
  }

  return Buffer.from(canonicalJson(content), 'utf8');
}

function payloadDescriptor(input: AsyncConsequencePayloadInput): AsyncConsequencePayloadDescriptor {
  const bytes = contentBytes(input.content);
  const digest =
    input.digest !== undefined
      ? normalizeIdentifier(input.digest, 'payload.digest')
      : bytes === null
        ? null
        : sha256Digest(bytes);
  if (digest === null) {
    throw new Error('Async consequence envelope payload requires either content or digest.');
  }

  if (!digest.startsWith('sha256:')) {
    throw new Error('Async consequence envelope payload digest must use sha256:<hex> form.');
  }

  return Object.freeze({
    name: normalizeIdentifier(input.name, 'payload.name'),
    mediaType: normalizeIdentifier(input.mediaType ?? 'application/octet-stream', 'payload.mediaType'),
    digest,
    sizeBytes: bytes === null ? input.sizeBytes ?? null : bytes.byteLength,
  });
}

function dssePreAuthenticationEncoding(payloadType: string, payload: Buffer): Buffer {
  const payloadTypeBytes = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${payloadTypeBytes.byteLength} `, 'utf8'),
    payloadTypeBytes,
    Buffer.from(` ${payload.byteLength} `, 'utf8'),
    payload,
  ]);
}

function signatureRef(input: {
  readonly keyId: string;
  readonly signature: string;
}): string {
  return `dsse:${input.keyId}:${sha256Hex(input.signature)}`;
}

function dsseEnvelopeDigest(envelope: DsseEnvelope): string {
  return sha256Digest(canonicalJson(envelope));
}

function releasePresentationProof(input: {
  readonly envelopeDigest: string;
  readonly subjectDigest: string;
  readonly signatureRef: string;
}): ReleasePresentationProof {
  return Object.freeze({
    kind: 'signed-json-envelope',
    envelopeDigest: input.envelopeDigest,
    subjectDigest: input.subjectDigest,
    signatureRef: input.signatureRef,
  });
}

function replayKeyForEnvelope(envelopeDigest: string): string {
  return `signed-json-envelope:${envelopeDigest}`;
}

function normalizeCloudEventSource(input: {
  readonly source?: string;
  readonly producer: string;
}): string {
  return normalizeIdentifier(
    input.source ?? `urn:attestor:release-enforcement:${input.producer}`,
    'cloudEvent.source',
  );
}

function normalizeCloudEventType(value: string | undefined): string {
  return normalizeIdentifier(
    value ?? 'dev.attestor.release-enforcement.async-consequence.v1',
    'cloudEvent.type',
  );
}

function createCloudEvent(input: {
  readonly envelopeId: string;
  readonly messageId: string | null;
  readonly source?: string;
  readonly type?: string;
  readonly subject?: string;
  readonly targetId: string;
  readonly createdAt: string;
  readonly producer: string;
}): AsyncConsequenceCloudEvent {
  return Object.freeze({
    specversion: CLOUDEVENTS_SPEC_VERSION,
    id: input.messageId ?? input.envelopeId,
    source: normalizeCloudEventSource({
      source: input.source,
      producer: input.producer,
    }),
    type: normalizeCloudEventType(input.type),
    subject: normalizeIdentifier(input.subject ?? input.targetId, 'cloudEvent.subject'),
    time: input.createdAt,
    datacontenttype: ASYNC_CONSEQUENCE_ENVELOPE_PAYLOAD_TYPE,
    dataschema: ASYNC_CONSEQUENCE_ENVELOPE_PREDICATE_TYPE,
  });
}

function statementPayloadBytes(statement: AsyncConsequenceEnvelopeStatement): Buffer {
  return Buffer.from(canonicalJson(statement), 'utf8');
}

function buildStatement(input: {
  readonly envelopeId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
  readonly producer: string;
  readonly target: AsyncConsequenceEnvelopeTarget;
  readonly issuedToken: IssuedReleaseToken;
  readonly payload: AsyncConsequencePayloadDescriptor;
  readonly messageId: string | null;
  readonly queueOrTopic: string | null;
  readonly cloudEvent: AsyncConsequenceCloudEvent;
  readonly keyId: string;
  readonly publicKeyThumbprint: string;
}): AsyncConsequenceEnvelopeStatement {
  const subjectHex = digestHex(input.payload.digest, 'payload.digest');
  return Object.freeze({
    _type: IN_TOTO_STATEMENT_V1_TYPE,
    subject: Object.freeze([
      Object.freeze({
        name: input.payload.name,
        digest: Object.freeze({
          sha256: subjectHex,
        }),
      }),
    ]),
    predicateType: ASYNC_CONSEQUENCE_ENVELOPE_PREDICATE_TYPE,
    predicate: Object.freeze({
      version: ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION,
      envelopeId: input.envelopeId,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
      producer: input.producer,
      target: input.target,
      release: Object.freeze({
        tokenId: input.issuedToken.tokenId,
        tokenDigest: asyncReleaseTokenDigest(input.issuedToken.token),
        decisionId: input.issuedToken.claims.decision_id,
        issuer: input.issuedToken.claims.iss,
        subject: input.issuedToken.claims.sub,
        audience: input.issuedToken.claims.aud,
        expiresAt: input.issuedToken.expiresAt,
        scope: normalizeScope(input.issuedToken.claims.scope?.split(/\s+/)),
      }),
      consequence: Object.freeze({
        consequenceType: input.issuedToken.claims.consequence_type,
        riskClass: input.issuedToken.claims.risk_class,
        outputHash: input.issuedToken.claims.output_hash,
        consequenceHash: input.issuedToken.claims.consequence_hash,
        policyHash: input.issuedToken.claims.policy_hash,
      }),
      payload: input.payload,
      transport: Object.freeze({
        messageId: input.messageId,
        queueOrTopic: input.queueOrTopic,
      }),
      cloudEvent: input.cloudEvent,
      signer: Object.freeze({
        algorithm: ASYNC_CONSEQUENCE_ENVELOPE_ALGORITHM,
        keyId: input.keyId,
        publicKeyThumbprint: input.publicKeyThumbprint,
      }),
    }),
  });
}

export async function generateAsyncConsequenceEnvelopeKeyPair(): Promise<AsyncConsequenceEnvelopeKeyPair> {
  const keyPair = generateKeyPairSync('ed25519');
  const privateJwk = keyPair.privateKey.export({ format: 'jwk' }) as JWK;
  const publicJwk = publicJwkForHeader(keyPair.publicKey.export({ format: 'jwk' }) as JWK);
  const publicKeyThumbprint = await publicJwkThumbprint(publicJwk);

  return Object.freeze({
    algorithm: ASYNC_CONSEQUENCE_ENVELOPE_ALGORITHM,
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

export function createAsyncEnvelopeReleaseTokenConfirmation(input: {
  readonly publicKeyThumbprint: string;
}): ReleaseTokenConfirmationClaim {
  return Object.freeze({
    jkt: normalizeIdentifier(input.publicKeyThumbprint, 'publicKeyThumbprint'),
  });
}

export async function createSignedAsyncConsequenceEnvelope(
  input: CreateSignedAsyncConsequenceEnvelopeInput,
): Promise<SignedAsyncConsequenceEnvelope> {
  const createdAt = normalizeIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'createdAt');
  const expiresAt = normalizeIsoTimestamp(
    input.expiresAt ??
      new Date(
        new Date(createdAt).getTime() + DEFAULT_ASYNC_ENVELOPE_MAX_AGE_SECONDS * 1000,
      ).toISOString(),
    'expiresAt',
  );
  const envelopeId = normalizeIdentifier(input.envelopeId, 'envelopeId');
  const idempotencyKey = normalizeIdentifier(input.idempotencyKey, 'idempotencyKey');
  const producer = normalizeIdentifier(input.producer ?? 'attestor.release-enforcement', 'producer');
  const target = Object.freeze({
    kind: input.target.kind,
    id: normalizeIdentifier(input.target.id, 'target.id'),
  });
  const messageId = normalizeOptionalIdentifier(input.messageId, 'messageId');
  const queueOrTopic = normalizeOptionalIdentifier(input.queueOrTopic, 'queueOrTopic');
  const publicKeyThumbprintValue = await publicJwkThumbprint(input.publicJwk);
  const keyId = input.keyId ?? publicKeyThumbprintValue;
  const payload = payloadDescriptor(input.payload);
  const cloudEvent = createCloudEvent({
    envelopeId,
    messageId,
    source: input.cloudEventSource,
    type: input.cloudEventType,
    subject: input.cloudEventSubject,
    targetId: target.id,
    createdAt,
    producer,
  });
  const statement = buildStatement({
    envelopeId,
    createdAt,
    expiresAt,
    idempotencyKey,
    producer,
    target,
    issuedToken: input.issuedToken,
    payload,
    messageId,
    queueOrTopic,
    cloudEvent,
    keyId,
    publicKeyThumbprint: publicKeyThumbprintValue,
  });
  const statementBytes = statementPayloadBytes(statement);
  const signatureBytes = signEd25519({
    privateJwk: input.privateJwk,
    bytes: dssePreAuthenticationEncoding(
      ASYNC_CONSEQUENCE_ENVELOPE_PAYLOAD_TYPE,
      statementBytes,
    ),
  });
  const signature = signatureBytes.toString('base64');
  const envelope = Object.freeze({
    payloadType: ASYNC_CONSEQUENCE_ENVELOPE_PAYLOAD_TYPE,
    payload: statementBytes.toString('base64'),
    signatures: Object.freeze([
      Object.freeze({
        keyid: keyId,
        sig: signature,
      }),
    ]),
  });
  const envelopeDigest = dsseEnvelopeDigest(envelope);
  const subjectDigest = payload.digest;
  const statementDigest = sha256Digest(statementBytes);
  const signatureRefValue = signatureRef({ keyId, signature });
  const releaseTokenDigest = asyncReleaseTokenDigest(input.issuedToken.token);
  const presentation = createReleasePresentation({
    mode: 'signed-json-envelope',
    presentedAt: input.presentedAt ?? createdAt,
    releaseToken: input.issuedToken.token,
    releaseTokenId: input.issuedToken.tokenId,
    releaseTokenDigest,
    issuer: input.issuedToken.claims.iss,
    subject: input.issuedToken.claims.sub,
    audience: input.issuedToken.claims.aud,
    expiresAt: input.issuedToken.expiresAt,
    scope: input.scope ?? input.issuedToken.claims.scope?.split(/\s+/) ?? [],
    proof: releasePresentationProof({
      envelopeDigest,
      subjectDigest,
      signatureRef: signatureRefValue,
    }),
  });

  return Object.freeze({
    version: ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION,
    algorithm: ASYNC_CONSEQUENCE_ENVELOPE_ALGORITHM,
    envelope,
    statement,
    createdAt,
    expiresAt,
    idempotencyKey,
    releaseTokenDigest,
    subjectDigest,
    statementDigest,
    envelopeDigest,
    signatureRef: signatureRefValue,
    keyId,
    publicKeyThumbprint: publicKeyThumbprintValue,
    cloudEvent,
    target,
    replayKey: replayKeyForEnvelope(envelopeDigest),
    presentation,
  });
}

function unwrapEnvelope(
  envelope: DsseEnvelope | SignedAsyncConsequenceEnvelope,
): DsseEnvelope {
  if ('envelope' in envelope) {
    return envelope.envelope;
  }
  return envelope;
}

function invalidVerification(checkedAt: string): SignedAsyncConsequenceEnvelopeVerification {
  return Object.freeze({
    version: ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION,
    status: 'invalid',
    checkedAt,
    keyId: null,
    publicKeyThumbprint: null,
    envelopeDigest: null,
    subjectDigest: null,
    statementDigest: null,
    signatureRef: null,
    createdAt: null,
    expiresAt: null,
    idempotencyKey: null,
    releaseTokenDigest: null,
    releaseTokenId: null,
    releaseDecisionId: null,
    targetId: null,
    messageId: null,
    queueOrTopic: null,
    cloudEvent: null,
    replayKey: null,
    failureReasons: uniqueFailureReasons(['invalid-signature']),
  });
}

function parseBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Async consequence envelope value must be base64.');
  }
  return Buffer.from(value, 'base64');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatement(payloadBytes: Buffer): AsyncConsequenceEnvelopeStatement {
  const parsed = JSON.parse(payloadBytes.toString('utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Async consequence envelope payload must be a statement object.');
  }
  return parsed as unknown as AsyncConsequenceEnvelopeStatement;
}

function firstSignature(
  envelope: DsseEnvelope,
  expectedKeyId: string | null | undefined,
): DsseSignature {
  const signatures = envelope.signatures ?? [];
  if (signatures.length === 0) {
    throw new Error('Async consequence envelope requires a DSSE signature.');
  }
  const selected =
    expectedKeyId === undefined || expectedKeyId === null
      ? signatures[0]
      : signatures.find((signature) => signature.keyid === expectedKeyId);
  if (!selected) {
    throw new Error('Async consequence envelope does not include the expected key id.');
  }
  return selected;
}

function statementShapeFailures(
  statement: AsyncConsequenceEnvelopeStatement,
): readonly EnforcementFailureReason[] {
  const reasons: EnforcementFailureReason[] = [];
  if (statement._type !== IN_TOTO_STATEMENT_V1_TYPE) {
    reasons.push('binding-mismatch');
  }
  if (statement.predicateType !== ASYNC_CONSEQUENCE_ENVELOPE_PREDICATE_TYPE) {
    reasons.push('binding-mismatch');
  }
  if (!Array.isArray(statement.subject) || statement.subject.length === 0) {
    reasons.push('binding-mismatch');
  }
  if (statement.predicate?.version !== ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION) {
    reasons.push('binding-mismatch');
  }
  if (statement.predicate?.cloudEvent?.specversion !== CLOUDEVENTS_SPEC_VERSION) {
    reasons.push('binding-mismatch');
  }
  if (statement.predicate?.signer?.algorithm !== ASYNC_CONSEQUENCE_ENVELOPE_ALGORITHM) {
    reasons.push('invalid-signature');
  }
  return uniqueFailureReasons(reasons);
}

function subjectDigestFromStatement(statement: AsyncConsequenceEnvelopeStatement): string | null {
  const subject = statement.subject[0];
  const sha256 = subject?.digest?.sha256;
  return typeof sha256 === 'string' && sha256.length > 0 ? `sha256:${sha256.toLowerCase()}` : null;
}

function completePredicate(
  statement: AsyncConsequenceEnvelopeStatement,
): AsyncConsequenceEnvelopePredicate | null {
  const predicate = (statement as unknown as { readonly predicate?: unknown }).predicate;
  if (!isRecord(predicate)) {
    return null;
  }
  if (
    typeof predicate.createdAt !== 'string' ||
    typeof predicate.expiresAt !== 'string' ||
    typeof predicate.idempotencyKey !== 'string'
  ) {
    return null;
  }
  if (
    !isRecord(predicate.release) ||
    !isRecord(predicate.consequence) ||
    !isRecord(predicate.target) ||
    !isRecord(predicate.transport) ||
    !isRecord(predicate.cloudEvent) ||
    !isRecord(predicate.signer)
  ) {
    return null;
  }
  return predicate as unknown as AsyncConsequenceEnvelopePredicate;
}

function timeFailureReasons(input: {
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly now: string;
  readonly maxAgeSeconds: number;
  readonly clockSkewSeconds: number;
}): readonly EnforcementFailureReason[] {
  const reasons: EnforcementFailureReason[] = [];
  const now = epochSeconds(input.now);
  const created = epochSeconds(input.createdAt);
  const expires = epochSeconds(input.expiresAt);

  if (created > now + input.clockSkewSeconds) {
    reasons.push('future-issued-at');
  }
  if (now - created > input.maxAgeSeconds + input.clockSkewSeconds) {
    reasons.push('stale-authorization');
  }
  if (now - input.clockSkewSeconds >= expires) {
    reasons.push('expired-authorization');
  }

  return uniqueFailureReasons(reasons);
}

function compareExpected(
  actual: string | null,
  expected: string | null | undefined,
  reason: EnforcementFailureReason,
): readonly EnforcementFailureReason[] {
  if (expected === undefined || expected === null) {
    return [];
  }
  if (actual === null || !timingSafeStringEqual(actual, expected)) {
    return [reason];
  }
  return [];
}

function bindingFailureReasons(input: {
  readonly verificationInput: VerifySignedAsyncConsequenceEnvelopeInput;
  readonly statement: AsyncConsequenceEnvelopeStatement;
  readonly envelopeDigest: string;
  readonly subjectDigest: string | null;
  readonly signatureRefValue: string;
  readonly publicKeyThumbprint: string;
  readonly keyId: string;
}): readonly EnforcementFailureReason[] {
  const predicate = input.statement.predicate;
  const expected = input.verificationInput;
  const reasons: EnforcementFailureReason[] = [];

  reasons.push(
    ...compareExpected(input.envelopeDigest, expected.expectedEnvelopeDigest, 'binding-mismatch'),
    ...compareExpected(input.subjectDigest, expected.expectedSubjectDigest, 'binding-mismatch'),
    ...compareExpected(input.keyId, expected.expectedKeyId, 'binding-mismatch'),
    ...compareExpected(
      input.publicKeyThumbprint,
      expected.expectedJwkThumbprint,
      'binding-mismatch',
    ),
    ...compareExpected(
      predicate.release.tokenDigest,
      expected.expectedReleaseTokenDigest,
      'binding-mismatch',
    ),
    ...compareExpected(
      predicate.release.tokenId,
      expected.expectedReleaseTokenId,
      'binding-mismatch',
    ),
    ...compareExpected(
      predicate.release.decisionId,
      expected.expectedReleaseDecisionId,
      'binding-mismatch',
    ),
    ...compareExpected(predicate.release.audience, expected.expectedAudience, 'wrong-audience'),
    ...compareExpected(predicate.target.id, expected.expectedTargetId, 'binding-mismatch'),
    ...compareExpected(
      predicate.consequence.outputHash,
      expected.expectedOutputHash,
      'binding-mismatch',
    ),
    ...compareExpected(
      predicate.consequence.consequenceHash,
      expected.expectedConsequenceHash,
      'binding-mismatch',
    ),
    ...compareExpected(
      predicate.consequence.policyHash,
      expected.expectedPolicyHash,
      'binding-mismatch',
    ),
    ...compareExpected(
      predicate.idempotencyKey,
      expected.expectedIdempotencyKey,
      'binding-mismatch',
    ),
    ...compareExpected(
      predicate.transport.messageId,
      expected.expectedMessageId,
      'binding-mismatch',
    ),
    ...compareExpected(
      predicate.transport.queueOrTopic,
      expected.expectedQueueOrTopic,
      'binding-mismatch',
    ),
  );

  if (
    expected.expectedConsequenceType !== undefined &&
    expected.expectedConsequenceType !== null &&
    predicate.consequence.consequenceType !== expected.expectedConsequenceType
  ) {
    reasons.push('wrong-consequence');
  }

  if (
    expected.expectedRiskClass !== undefined &&
    expected.expectedRiskClass !== null &&
    predicate.consequence.riskClass !== expected.expectedRiskClass
  ) {
    reasons.push('binding-mismatch');
  }

  if (predicate.signer.keyId !== input.keyId) {
    reasons.push('binding-mismatch');
  }
  if (predicate.signer.publicKeyThumbprint !== input.publicKeyThumbprint) {
    reasons.push('binding-mismatch');
  }
  if (input.signatureRefValue.length === 0) {
    reasons.push('invalid-signature');
  }

  return uniqueFailureReasons(reasons);
}

export async function verifySignedAsyncConsequenceEnvelope(
  input: VerifySignedAsyncConsequenceEnvelopeInput,
): Promise<SignedAsyncConsequenceEnvelopeVerification> {
  const checkedAt = normalizeIsoTimestamp(input.now, 'now');
  let envelope: DsseEnvelope;
  let payloadBytes: Buffer;
  let statement: AsyncConsequenceEnvelopeStatement;
  let signature: DsseSignature;
  let signatureBytes: Buffer;

  try {
    envelope = unwrapEnvelope(input.envelope);
    if (envelope.payloadType !== ASYNC_CONSEQUENCE_ENVELOPE_PAYLOAD_TYPE) {
      return invalidVerification(checkedAt);
    }
    signature = firstSignature(envelope, input.expectedKeyId);
    payloadBytes = parseBase64(envelope.payload);
    signatureBytes = parseBase64(signature.sig);
    statement = parseStatement(payloadBytes);
    if (canonicalJson(statement) !== payloadBytes.toString('utf8')) {
      return invalidVerification(checkedAt);
    }
  } catch {
    return invalidVerification(checkedAt);
  }

  const failureReasons: EnforcementFailureReason[] = [];
  const envelopeDigest = dsseEnvelopeDigest(envelope);
  const subjectDigest = subjectDigestFromStatement(statement);
  const statementDigest = sha256Digest(payloadBytes);
  const signatureRefValue = signatureRef({
    keyId: signature.keyid,
    signature: signature.sig,
  });
  const predicate = completePredicate(statement);
  let publicKeyThumbprintValue: string | null = null;

  failureReasons.push(...statementShapeFailures(statement));
  if (predicate === null) {
    failureReasons.push('binding-mismatch');
  }

  try {
    publicKeyThumbprintValue = await publicJwkThumbprint(input.publicJwk);
    if (
      !verifyEd25519({
        publicJwk: input.publicJwk,
        bytes: dssePreAuthenticationEncoding(envelope.payloadType, payloadBytes),
        signature: signatureBytes,
      })
    ) {
      failureReasons.push('invalid-signature');
    }
  } catch {
    failureReasons.push('invalid-signature');
  }

  if (publicKeyThumbprintValue !== null && predicate !== null) {
    failureReasons.push(
      ...bindingFailureReasons({
        verificationInput: input,
        statement,
        envelopeDigest,
        subjectDigest,
        signatureRefValue,
        publicKeyThumbprint: publicKeyThumbprintValue,
        keyId: signature.keyid,
      }),
    );
  }

  if (predicate !== null) {
    failureReasons.push(
      ...timeFailureReasons({
        createdAt: predicate.createdAt,
        expiresAt: predicate.expiresAt,
        now: checkedAt,
        maxAgeSeconds:
          input.maxEnvelopeAgeSeconds ?? DEFAULT_ASYNC_ENVELOPE_MAX_AGE_SECONDS,
        clockSkewSeconds:
          input.clockSkewSeconds ?? DEFAULT_ASYNC_ENVELOPE_CLOCK_SKEW_SECONDS,
      }),
    );
  }

  const replayKey = replayKeyForEnvelope(envelopeDigest);
  if (
    input.replayLedgerEntry &&
    input.replayLedgerEntry.key === replayKey &&
    new Date(input.replayLedgerEntry.expiresAt).getTime() >= new Date(checkedAt).getTime()
  ) {
    failureReasons.push('replayed-authorization');
  }

  const uniqueFailures = uniqueFailureReasons(failureReasons);
  return Object.freeze({
    version: ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION,
    status: uniqueFailures.length === 0 ? 'valid' : 'invalid',
    checkedAt,
    keyId: signature.keyid,
    publicKeyThumbprint: publicKeyThumbprintValue,
    envelopeDigest,
    subjectDigest,
    statementDigest,
    signatureRef: signatureRefValue,
    createdAt: predicate?.createdAt ?? null,
    expiresAt: predicate?.expiresAt ?? null,
    idempotencyKey: predicate?.idempotencyKey ?? null,
    releaseTokenDigest: predicate?.release.tokenDigest ?? null,
    releaseTokenId: predicate?.release.tokenId ?? null,
    releaseDecisionId: predicate?.release.decisionId ?? null,
    targetId: predicate?.target.id ?? null,
    messageId: predicate?.transport.messageId ?? null,
    queueOrTopic: predicate?.transport.queueOrTopic ?? null,
    cloudEvent: predicate?.cloudEvent ?? null,
    replayKey,
    failureReasons: uniqueFailures,
  });
}
