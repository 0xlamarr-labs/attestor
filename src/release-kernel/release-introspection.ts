import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { withFileLock, writeTextFileAtomic } from '../platform/file-store.js';
import type { ReleaseDecision, ReleaseTokenClaims } from './object-model.js';
import { releaseDecisionMaxUses } from './object-model.js';
import type {
  IssuedReleaseToken,
  ReleaseTokenVerificationFailure,
  ReleaseTokenVerificationKey,
  VerifyReleaseTokenInput,
} from './release-token.js';
import {
  ReleaseTokenVerificationFailure as ReleaseTokenVerificationFailureError,
  verifyIssuedReleaseToken,
} from './release-token.js';

/**
 * Active-status release-token introspection for high-risk release paths.
 *
 * This module mirrors the intent of OAuth token introspection for the Attestor
 * release layer: cryptographic verification alone is not enough for R3/R4
 * consequence paths. The protected resource also needs an "is this token still
 * active in the release authority plane?" answer.
 *
 * Step 15 intentionally stops short of revocation and replay semantics. It
 * introduces a registry and active-state introspection surface that Step 16
 * and Step 17 can later deepen without forcing a redesign.
 */

export const RELEASE_TOKEN_REGISTRY_SPEC_VERSION =
  'attestor.release-token-registry.v2';
export const RELEASE_TOKEN_INTROSPECTION_SPEC_VERSION =
  'attestor.release-introspection.v2';
export const DEFAULT_RELEASE_TOKEN_TYPE_HINT = 'attestor_release_token';
export const ATTESTOR_RELEASE_TOKEN_INTROSPECTION_STORE_PATH_ENV =
  'ATTESTOR_RELEASE_TOKEN_INTROSPECTION_STORE_PATH';

const DEFAULT_RELEASE_TOKEN_INTROSPECTION_STORE_PATH =
  '.attestor/release-token-introspection-store.json';

export type SupportedReleaseTokenTypeHint =
  | typeof DEFAULT_RELEASE_TOKEN_TYPE_HINT
  | 'access_token';

export type ReleaseTokenRegistryStatus = 'issued' | 'revoked' | 'expired' | 'consumed';
export type ReleaseTokenInactiveReason =
  | 'invalid'
  | 'unknown'
  | 'unsupported_token_type'
  | 'claim_mismatch'
  | 'revoked'
  | 'expired'
  | 'usage_exhausted';

export interface RegisteredReleaseToken {
  readonly version: typeof RELEASE_TOKEN_REGISTRY_SPEC_VERSION;
  readonly status: ReleaseTokenRegistryStatus;
  readonly statusChangedAt: string;
  readonly tokenId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly decisionId: string;
  readonly decisionStatus: ReleaseDecision['status'];
  readonly consequenceType: ReleaseDecision['consequenceType'];
  readonly riskClass: ReleaseDecision['riskClass'];
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly policyHash: string;
  readonly override: boolean;
  readonly introspectionRequired: boolean;
  readonly authorityMode: ReleaseDecision['reviewAuthority']['mode'];
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
  readonly maxUses: number;
  readonly useCount: number;
  readonly firstUsedAt: string | null;
  readonly lastUsedAt: string | null;
  readonly lastUsedByResourceServerId: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
  readonly revokedBy: string | null;
  readonly expiredAt: string | null;
}

export interface RegisterIssuedReleaseTokenInput {
  readonly issuedToken: IssuedReleaseToken;
  readonly decision: ReleaseDecision;
}

export interface RevokeReleaseTokenInput {
  readonly tokenId: string;
  readonly revokedAt?: string;
  readonly reason?: string;
  readonly revokedBy?: string;
}

export interface RecordReleaseTokenUseInput {
  readonly tokenId: string;
  readonly usedAt?: string;
  readonly resourceServerId?: string;
}

export interface RecordedReleaseTokenUseResult {
  readonly accepted: boolean;
  readonly inactiveReason: ReleaseTokenInactiveReason | null;
  readonly record: RegisteredReleaseToken | null;
}

export interface ReleaseTokenIntrospectionStore {
  registerIssuedToken(input: RegisterIssuedReleaseTokenInput): RegisteredReleaseToken;
  findToken(tokenId: string): RegisteredReleaseToken | null;
  revokeToken(input: RevokeReleaseTokenInput): RegisteredReleaseToken | null;
  syncLifecycle(currentDate?: string): readonly RegisteredReleaseToken[];
  recordTokenUse(input: RecordReleaseTokenUseInput): RecordedReleaseTokenUseResult;
}

interface ReleaseTokenIntrospectionStoreFile {
  readonly version: 1;
  records: RegisteredReleaseToken[];
}

export interface ReleaseTokenIntrospectionInput
  extends Pick<VerifyReleaseTokenInput, 'token' | 'verificationKey' | 'audience' | 'currentDate'> {
  readonly tokenTypeHint?: string;
  readonly resourceServerId?: string;
}

interface ReleaseTokenIntrospectionBase {
  readonly version: typeof RELEASE_TOKEN_INTROSPECTION_SPEC_VERSION;
  readonly token_type: typeof DEFAULT_RELEASE_TOKEN_TYPE_HINT;
  readonly checked_at: string;
  readonly resource_server_id: string | null;
}

export interface InactiveReleaseTokenIntrospectionResult
  extends ReleaseTokenIntrospectionBase {
  readonly active: false;
  readonly inactive_reason: ReleaseTokenInactiveReason;
}

export interface ActiveReleaseTokenIntrospectionResult
  extends ReleaseTokenIntrospectionBase {
  readonly active: true;
  readonly scope: string;
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly jti: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly decision_id: string;
  readonly decision: ReleaseTokenClaims['decision'];
  readonly consequence_type: ReleaseTokenClaims['consequence_type'];
  readonly risk_class: ReleaseTokenClaims['risk_class'];
  readonly output_hash: string;
  readonly consequence_hash: string;
  readonly policy_hash: string;
  readonly override: boolean;
  readonly authority_mode: ReleaseTokenClaims['authority_mode'];
  readonly introspection_required: boolean;
  readonly resource?: string;
  readonly act?: ReleaseTokenClaims['act'];
  readonly parent_jti?: string;
  readonly exchange_id?: string;
  readonly exchanged_at?: number;
  readonly source_aud?: string;
  readonly token_use?: ReleaseTokenClaims['token_use'];
  readonly cnf?: ReleaseTokenClaims['cnf'];
}

export type ReleaseTokenIntrospectionResult =
  | InactiveReleaseTokenIntrospectionResult
  | ActiveReleaseTokenIntrospectionResult;

export interface ReleaseTokenIntrospector {
  introspect(
    input: ReleaseTokenIntrospectionInput,
  ): Promise<ReleaseTokenIntrospectionResult>;
}

export type AwaitableReleaseTokenIntrospectionStore = {
  [K in keyof ReleaseTokenIntrospectionStore]: ReleaseTokenIntrospectionStore[K] extends (
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Result | Promise<Result>
    : ReleaseTokenIntrospectionStore[K];
};

export class ReleaseTokenIntrospectionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseTokenIntrospectionStoreError';
  }
}

function introspectionTimestamp(currentDate?: string): string {
  if (!currentDate) {
    return new Date().toISOString();
  }

  const parsed = new Date(currentDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Release token introspection requires a valid currentDate when provided.');
  }
  return parsed.toISOString();
}

function inactiveReleaseTokenIntrospection(
  reason: ReleaseTokenInactiveReason,
  currentDate?: string,
  resourceServerId?: string,
): InactiveReleaseTokenIntrospectionResult {
  return {
    version: RELEASE_TOKEN_INTROSPECTION_SPEC_VERSION,
    active: false,
    inactive_reason: reason,
    token_type: DEFAULT_RELEASE_TOKEN_TYPE_HINT,
    checked_at: introspectionTimestamp(currentDate),
    resource_server_id: resourceServerId ?? null,
  };
}

function normalizeSupportedTokenTypeHint(
  tokenTypeHint?: string,
): SupportedReleaseTokenTypeHint | null {
  if (!tokenTypeHint) {
    return null;
  }

  if (
    tokenTypeHint === DEFAULT_RELEASE_TOKEN_TYPE_HINT ||
    tokenTypeHint === 'access_token'
  ) {
    return tokenTypeHint;
  }

  return null;
}

function registeredReleaseTokenMatchesClaims(
  record: RegisteredReleaseToken,
  claims: ReleaseTokenClaims,
): boolean {
  return (
    record.tokenId === claims.jti &&
    record.issuer === claims.iss &&
    record.subject === claims.sub &&
    record.audience === claims.aud &&
    record.decisionId === claims.decision_id &&
    record.decisionStatus === claims.decision &&
    record.consequenceType === claims.consequence_type &&
    record.riskClass === claims.risk_class &&
    record.outputHash === claims.output_hash &&
    record.consequenceHash === claims.consequence_hash &&
    record.policyHash === claims.policy_hash &&
    record.override === claims.override &&
    record.introspectionRequired === claims.introspection_required &&
    record.authorityMode === claims.authority_mode
  );
}

function registeredReleaseTokenIsActive(
  record: RegisteredReleaseToken,
): boolean {
  return record.status === 'issued';
}

function inactiveReasonForRegisteredReleaseToken(
  record: RegisteredReleaseToken,
): ReleaseTokenInactiveReason {
  switch (record.status) {
    case 'revoked':
      return 'revoked';
    case 'expired':
      return 'expired';
    case 'consumed':
      return 'usage_exhausted';
    case 'issued':
    default:
      return 'invalid';
  }
}

function buildRegisteredReleaseToken(
  input: RegisterIssuedReleaseTokenInput,
): RegisteredReleaseToken {
  const { issuedToken, decision } = input;
  return Object.freeze({
    version: RELEASE_TOKEN_REGISTRY_SPEC_VERSION,
    status: 'issued',
    statusChangedAt: issuedToken.issuedAt,
    tokenId: issuedToken.tokenId,
    issuer: issuedToken.claims.iss,
    subject: issuedToken.claims.sub,
    audience: issuedToken.claims.aud,
    issuedAt: issuedToken.issuedAt,
    notBefore: new Date(issuedToken.claims.nbf * 1000).toISOString(),
    expiresAt: issuedToken.expiresAt,
    decisionId: decision.id,
    decisionStatus: decision.status,
    consequenceType: decision.consequenceType,
    riskClass: decision.riskClass,
    outputHash: decision.outputHash,
    consequenceHash: decision.consequenceHash,
    policyHash: decision.policyHash,
    override: decision.override !== null || decision.status === 'overridden',
    introspectionRequired: issuedToken.claims.introspection_required,
    authorityMode: decision.reviewAuthority.mode,
    keyId: issuedToken.keyId,
    publicKeyFingerprint: issuedToken.publicKeyFingerprint,
    maxUses: Math.max(1, releaseDecisionMaxUses(decision) ?? 1),
    useCount: 0,
    firstUsedAt: null,
    lastUsedAt: null,
    lastUsedByResourceServerId: null,
    revokedAt: null,
    revocationReason: null,
    revokedBy: null,
    expiredAt: null,
  });
}

function freezeRegisteredReleaseToken(record: RegisteredReleaseToken): RegisteredReleaseToken {
  return Object.freeze({
    ...record,
  });
}

function defaultReleaseTokenIntrospectionStoreFile(): ReleaseTokenIntrospectionStoreFile {
  return {
    version: 1,
    records: [],
  };
}

function defaultReleaseTokenIntrospectionStorePath(): string {
  return resolve(
    process.env[ATTESTOR_RELEASE_TOKEN_INTROSPECTION_STORE_PATH_ENV] ??
      DEFAULT_RELEASE_TOKEN_INTROSPECTION_STORE_PATH,
  );
}

function ensureReleaseTokenIntrospectionStoreDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function normalizeReleaseTokenIntrospectionStoreFile(
  value: unknown,
  path: string,
): ReleaseTokenIntrospectionStoreFile {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1 ||
    !Array.isArray((value as { records?: unknown }).records)
  ) {
    throw new ReleaseTokenIntrospectionStoreError(
      `Release token introspection store '${path}' has an invalid file shape.`,
    );
  }

  return {
    version: 1,
    records: (value as { records: RegisteredReleaseToken[] }).records.map((record) =>
      freezeRegisteredReleaseToken(record),
    ),
  };
}

function loadReleaseTokenIntrospectionStoreFile(
  path: string,
): ReleaseTokenIntrospectionStoreFile {
  ensureReleaseTokenIntrospectionStoreDirectory(path);
  if (!existsSync(path)) return defaultReleaseTokenIntrospectionStoreFile();

  try {
    return normalizeReleaseTokenIntrospectionStoreFile(
      JSON.parse(readFileSync(path, 'utf8')) as unknown,
      path,
    );
  } catch (error) {
    if (error instanceof ReleaseTokenIntrospectionStoreError) throw error;
    throw new ReleaseTokenIntrospectionStoreError(
      `Release token introspection store '${path}' could not be parsed.`,
    );
  }
}

function saveReleaseTokenIntrospectionStoreFile(
  path: string,
  file: ReleaseTokenIntrospectionStoreFile,
): void {
  writeTextFileAtomic(
    path,
    `${JSON.stringify(
      {
        version: 1,
        records: file.records,
      },
      null,
      2,
    )}\n`,
  );
}

function upsertRegisteredReleaseToken(
  file: ReleaseTokenIntrospectionStoreFile,
  record: RegisteredReleaseToken,
): RegisteredReleaseToken {
  const frozen = freezeRegisteredReleaseToken(record);
  const existingIndex = file.records.findIndex((entry) => entry.tokenId === frozen.tokenId);
  if (existingIndex >= 0) {
    file.records[existingIndex] = frozen;
  } else {
    file.records.push(frozen);
  }
  return frozen;
}

function normalizeLifecycleTimestamp(label: string, timestamp?: string): string {
  const normalized = introspectionTimestamp(timestamp);
  if (Number.isNaN(new Date(normalized).getTime())) {
    throw new Error(`Release token lifecycle requires a valid ${label} timestamp.`);
  }
  return normalized;
}

function expireRegisteredReleaseToken(
  record: RegisteredReleaseToken,
): RegisteredReleaseToken {
  if (record.status !== 'issued') {
    return record;
  }

  return Object.freeze({
    ...record,
    status: 'expired',
    statusChangedAt: record.expiresAt,
    expiredAt: record.expiresAt,
  });
}

function revokeRegisteredReleaseToken(
  record: RegisteredReleaseToken,
  input: RevokeReleaseTokenInput,
): RegisteredReleaseToken {
  if (record.status === 'revoked') {
    return record;
  }

  const revokedAt = normalizeLifecycleTimestamp('revokedAt', input.revokedAt);
  const reason = typeof input.reason === 'string' && input.reason.trim() !== ''
    ? input.reason.trim()
    : null;
  const revokedBy = typeof input.revokedBy === 'string' && input.revokedBy.trim() !== ''
    ? input.revokedBy.trim()
    : null;

  return Object.freeze({
    ...record,
    status: 'revoked',
    statusChangedAt: revokedAt,
    revokedAt,
    revocationReason: reason,
    revokedBy,
  });
}

function consumeRegisteredReleaseToken(
  record: RegisteredReleaseToken,
  input: RecordReleaseTokenUseInput,
): RegisteredReleaseToken {
  const usedAt = normalizeLifecycleTimestamp('usedAt', input.usedAt);
  const nextUseCount = record.useCount + 1;
  const exhausted = nextUseCount >= record.maxUses;

  return Object.freeze({
    ...record,
    status: exhausted ? 'consumed' : record.status,
    statusChangedAt: exhausted ? usedAt : record.statusChangedAt,
    useCount: nextUseCount,
    firstUsedAt: record.firstUsedAt ?? usedAt,
    lastUsedAt: usedAt,
    lastUsedByResourceServerId: input.resourceServerId ?? null,
  });
}

function createReleaseTokenIntrospectionStoreFromAccessors(accessors: {
  readonly read: () => ReleaseTokenIntrospectionStoreFile;
  readonly mutate: <T>(action: (file: ReleaseTokenIntrospectionStoreFile) => T) => T;
}): ReleaseTokenIntrospectionStore {
  return {
    registerIssuedToken(input: RegisterIssuedReleaseTokenInput): RegisteredReleaseToken {
      return accessors.mutate((file) =>
        upsertRegisteredReleaseToken(file, buildRegisteredReleaseToken(input)),
      );
    },

    findToken(tokenId: string): RegisteredReleaseToken | null {
      return accessors.read().records.find((record) => record.tokenId === tokenId) ?? null;
    },

    revokeToken(input: RevokeReleaseTokenInput): RegisteredReleaseToken | null {
      return accessors.mutate((file) => {
        const existing = file.records.find((record) => record.tokenId === input.tokenId) ?? null;
        if (!existing) {
          return null;
        }

        const revoked = revokeRegisteredReleaseToken(existing, input);
        return upsertRegisteredReleaseToken(file, revoked);
      });
    },

    syncLifecycle(currentDate?: string): readonly RegisteredReleaseToken[] {
      const now = introspectionTimestamp(currentDate);
      return accessors.mutate((file) => {
        const expired: RegisteredReleaseToken[] = [];

        for (const record of file.records) {
          if (record.status === 'issued' && record.expiresAt <= now) {
            expired.push(upsertRegisteredReleaseToken(file, expireRegisteredReleaseToken(record)));
          }
        }

        return Object.freeze(expired);
      });
    },

    recordTokenUse(input: RecordReleaseTokenUseInput): RecordedReleaseTokenUseResult {
      return accessors.mutate((file) => {
        const now = introspectionTimestamp(input.usedAt);
        for (const record of file.records) {
          if (record.status === 'issued' && record.expiresAt <= now) {
            upsertRegisteredReleaseToken(file, expireRegisteredReleaseToken(record));
          }
        }

        const existing =
          file.records.find((record) => record.tokenId === input.tokenId) ?? null;
        if (!existing) {
          return Object.freeze({
            accepted: false,
            inactiveReason: 'unknown',
            record: null,
          });
        }

        if (existing.status !== 'issued') {
          return Object.freeze({
            accepted: false,
            inactiveReason: inactiveReasonForRegisteredReleaseToken(existing),
            record: existing,
          });
        }

        const consumed = consumeRegisteredReleaseToken(existing, input);
        upsertRegisteredReleaseToken(file, consumed);
        return Object.freeze({
          accepted: true,
          inactiveReason: null,
          record: consumed,
        });
      });
    },
  };
}

export function createInMemoryReleaseTokenIntrospectionStore(): ReleaseTokenIntrospectionStore {
  let file = defaultReleaseTokenIntrospectionStoreFile();

  return createReleaseTokenIntrospectionStoreFromAccessors({
    read: () => file,
    mutate: (action) => {
      const workingCopy: ReleaseTokenIntrospectionStoreFile = {
        version: 1,
        records: [...file.records],
      };
      const result = action(workingCopy);
      file = workingCopy;
      return result;
    },
  });
}

export function createFileBackedReleaseTokenIntrospectionStore(
  path = defaultReleaseTokenIntrospectionStorePath(),
): ReleaseTokenIntrospectionStore {
  loadReleaseTokenIntrospectionStoreFile(path);

  return createReleaseTokenIntrospectionStoreFromAccessors({
    read: () => withFileLock(path, () => loadReleaseTokenIntrospectionStoreFile(path)),
    mutate: (action) =>
      withFileLock(path, () => {
        const file = loadReleaseTokenIntrospectionStoreFile(path);
        const result = action(file);
        saveReleaseTokenIntrospectionStoreFile(path, file);
        return result;
      }),
  });
}

export function resetFileBackedReleaseTokenIntrospectionStoreForTests(path?: string): void {
  const resolvedPath = path ?? defaultReleaseTokenIntrospectionStorePath();
  if (existsSync(resolvedPath)) {
    rmSync(resolvedPath, { force: true });
  }
  if (existsSync(`${resolvedPath}.lock`)) {
    rmSync(`${resolvedPath}.lock`, { recursive: true, force: true });
  }
}

export async function introspectReleaseToken(
  input: ReleaseTokenIntrospectionInput & {
    readonly store: AwaitableReleaseTokenIntrospectionStore;
  },
): Promise<ReleaseTokenIntrospectionResult> {
  const tokenTypeHint = normalizeSupportedTokenTypeHint(input.tokenTypeHint);
  if (input.tokenTypeHint && !tokenTypeHint) {
    return inactiveReleaseTokenIntrospection(
      'unsupported_token_type',
      input.currentDate,
      input.resourceServerId,
    );
  }

  await input.store.syncLifecycle(input.currentDate);

  let verified;
  try {
    verified = await verifyIssuedReleaseToken({
      token: input.token,
      verificationKey: input.verificationKey,
      audience: input.audience,
      currentDate: input.currentDate,
    });
  } catch (error) {
    if (
      error instanceof ReleaseTokenVerificationFailureError &&
      error.code === 'expired'
    ) {
      return inactiveReleaseTokenIntrospection(
        'expired',
        input.currentDate,
        input.resourceServerId,
      );
    }

    return inactiveReleaseTokenIntrospection(
      'invalid',
      input.currentDate,
      input.resourceServerId,
    );
  }

  const record = await input.store.findToken(verified.claims.jti);
  if (!record) {
    return inactiveReleaseTokenIntrospection(
      'unknown',
      input.currentDate,
      input.resourceServerId,
    );
  }

  if (!registeredReleaseTokenMatchesClaims(record, verified.claims)) {
    return inactiveReleaseTokenIntrospection(
      'claim_mismatch',
      input.currentDate,
      input.resourceServerId,
    );
  }

  if (!registeredReleaseTokenIsActive(record)) {
    return inactiveReleaseTokenIntrospection(
      inactiveReasonForRegisteredReleaseToken(record),
      input.currentDate,
      input.resourceServerId,
    );
  }

  return Object.freeze({
    version: RELEASE_TOKEN_INTROSPECTION_SPEC_VERSION,
    active: true,
    token_type: DEFAULT_RELEASE_TOKEN_TYPE_HINT,
    checked_at: introspectionTimestamp(input.currentDate),
    resource_server_id: input.resourceServerId ?? null,
    scope: verified.claims.scope ?? `release:${verified.claims.consequence_type}`,
    iss: verified.claims.iss,
    sub: verified.claims.sub,
    aud: verified.claims.aud,
    jti: verified.claims.jti,
    iat: verified.claims.iat,
    nbf: verified.claims.nbf,
    exp: verified.claims.exp,
    decision_id: verified.claims.decision_id,
    decision: verified.claims.decision,
    consequence_type: verified.claims.consequence_type,
    risk_class: verified.claims.risk_class,
    output_hash: verified.claims.output_hash,
    consequence_hash: verified.claims.consequence_hash,
    policy_hash: verified.claims.policy_hash,
    override: verified.claims.override,
    authority_mode: verified.claims.authority_mode,
    introspection_required: verified.claims.introspection_required,
    ...(verified.claims.resource ? { resource: verified.claims.resource } : {}),
    ...(verified.claims.act ? { act: verified.claims.act } : {}),
    ...(verified.claims.parent_jti ? { parent_jti: verified.claims.parent_jti } : {}),
    ...(verified.claims.exchange_id ? { exchange_id: verified.claims.exchange_id } : {}),
    ...(verified.claims.exchanged_at !== undefined
      ? { exchanged_at: verified.claims.exchanged_at }
      : {}),
    ...(verified.claims.source_aud ? { source_aud: verified.claims.source_aud } : {}),
    ...(verified.claims.token_use ? { token_use: verified.claims.token_use } : {}),
    ...(verified.claims.cnf ? { cnf: verified.claims.cnf } : {}),
  });
}

export function createReleaseTokenIntrospector(
  store: AwaitableReleaseTokenIntrospectionStore,
): ReleaseTokenIntrospector {
  return {
    introspect(
      input: ReleaseTokenIntrospectionInput,
    ): Promise<ReleaseTokenIntrospectionResult> {
      return introspectReleaseToken({
        ...input,
        store,
      });
    },
  };
}
