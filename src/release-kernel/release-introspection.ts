import type { ReleaseDecision, ReleaseTokenClaims } from './object-model.js';
import type {
  IssuedReleaseToken,
  ReleaseTokenVerificationKey,
  VerifyReleaseTokenInput,
} from './release-token.js';
import { verifyIssuedReleaseToken } from './release-token.js';

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
  'attestor.release-token-registry.v1';
export const RELEASE_TOKEN_INTROSPECTION_SPEC_VERSION =
  'attestor.release-introspection.v1';
export const DEFAULT_RELEASE_TOKEN_TYPE_HINT = 'attestor_release_token';

export type SupportedReleaseTokenTypeHint =
  | typeof DEFAULT_RELEASE_TOKEN_TYPE_HINT
  | 'access_token';

export type ReleaseTokenRegistryStatus = 'issued';

export interface RegisteredReleaseToken {
  readonly version: typeof RELEASE_TOKEN_REGISTRY_SPEC_VERSION;
  readonly status: ReleaseTokenRegistryStatus;
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
}

export interface RegisterIssuedReleaseTokenInput {
  readonly issuedToken: IssuedReleaseToken;
  readonly decision: ReleaseDecision;
}

export interface ReleaseTokenIntrospectionStore {
  registerIssuedToken(input: RegisterIssuedReleaseTokenInput): RegisteredReleaseToken;
  findToken(tokenId: string): RegisteredReleaseToken | null;
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
}

export type ReleaseTokenIntrospectionResult =
  | InactiveReleaseTokenIntrospectionResult
  | ActiveReleaseTokenIntrospectionResult;

export interface ReleaseTokenIntrospector {
  introspect(
    input: ReleaseTokenIntrospectionInput,
  ): Promise<ReleaseTokenIntrospectionResult>;
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
  currentDate?: string,
  resourceServerId?: string,
): InactiveReleaseTokenIntrospectionResult {
  return {
    version: RELEASE_TOKEN_INTROSPECTION_SPEC_VERSION,
    active: false,
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
  currentDate?: string,
): boolean {
  const now = introspectionTimestamp(currentDate);
  return record.status === 'issued' && record.expiresAt > now;
}

function buildRegisteredReleaseToken(
  input: RegisterIssuedReleaseTokenInput,
): RegisteredReleaseToken {
  const { issuedToken, decision } = input;
  return Object.freeze({
    version: RELEASE_TOKEN_REGISTRY_SPEC_VERSION,
    status: 'issued',
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
  });
}

export function createInMemoryReleaseTokenIntrospectionStore(): ReleaseTokenIntrospectionStore {
  const records = new Map<string, RegisteredReleaseToken>();

  return {
    registerIssuedToken(input: RegisterIssuedReleaseTokenInput): RegisteredReleaseToken {
      const record = buildRegisteredReleaseToken(input);
      records.set(record.tokenId, record);
      return record;
    },

    findToken(tokenId: string): RegisteredReleaseToken | null {
      return records.get(tokenId) ?? null;
    },
  };
}

export async function introspectReleaseToken(
  input: ReleaseTokenIntrospectionInput & {
    readonly store: ReleaseTokenIntrospectionStore;
  },
): Promise<ReleaseTokenIntrospectionResult> {
  normalizeSupportedTokenTypeHint(input.tokenTypeHint);

  let verified;
  try {
    verified = await verifyIssuedReleaseToken({
      token: input.token,
      verificationKey: input.verificationKey,
      audience: input.audience,
      currentDate: input.currentDate,
    });
  } catch {
    return inactiveReleaseTokenIntrospection(input.currentDate, input.resourceServerId);
  }

  const record = input.store.findToken(verified.claims.jti);
  if (!record) {
    return inactiveReleaseTokenIntrospection(input.currentDate, input.resourceServerId);
  }

  if (!registeredReleaseTokenMatchesClaims(record, verified.claims)) {
    return inactiveReleaseTokenIntrospection(input.currentDate, input.resourceServerId);
  }

  if (!registeredReleaseTokenIsActive(record, input.currentDate)) {
    return inactiveReleaseTokenIntrospection(input.currentDate, input.resourceServerId);
  }

  return Object.freeze({
    version: RELEASE_TOKEN_INTROSPECTION_SPEC_VERSION,
    active: true,
    token_type: DEFAULT_RELEASE_TOKEN_TYPE_HINT,
    checked_at: introspectionTimestamp(input.currentDate),
    resource_server_id: input.resourceServerId ?? null,
    scope: `release:${verified.claims.consequence_type}`,
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
  });
}

export function createReleaseTokenIntrospector(
  store: ReleaseTokenIntrospectionStore,
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
