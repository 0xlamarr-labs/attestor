import { createHash } from 'node:crypto';
import type {
  CryptoAuthorizationDecision,
  CryptoAuthorizationIntent,
  CryptoReplayProtectionMode,
} from './object-model.js';
import type {
  CryptoAuthorizationConsequenceKind,
  CryptoAuthorizationRiskClass,
} from './types.js';
import type { CryptoEip712AuthorizationEnvelope } from './eip712-authorization-envelope.js';
import type { CryptoSignatureValidationProjection } from './erc1271-validation-projection.js';

/**
 * Replay, nonce, expiry, and revocation rules for crypto authorization.
 *
 * Step 07 turns the envelope's validity window and nonce into a deterministic
 * fail-closed control plan. It does not read chain state or wallet registries;
 * adapters provide observations and this module decides whether the Attestor
 * authorization is still admissible.
 */

export const CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION =
  'attestor.crypto-replay-freshness-rules.v1';

export const CRYPTO_REPLAY_KEY_KINDS = [
  'authorization-digest',
  'nonce',
  'user-operation-nonce',
  'authorization-list-nonce',
  'permission-context',
  'idempotency-key',
] as const;
export type CryptoReplayKeyKind = typeof CRYPTO_REPLAY_KEY_KINDS[number];

export const CRYPTO_REVOCATION_SOURCE_KINDS = [
  'attestor-revocation-ledger',
  'wallet-permission-registry',
  'entrypoint-nonce-state',
  'eip-7702-authority-nonce',
  'custody-policy-engine',
] as const;
export type CryptoRevocationSourceKind =
  typeof CRYPTO_REVOCATION_SOURCE_KINDS[number];

export const CRYPTO_REVOCATION_STATUSES = [
  'active',
  'revoked',
  'suspended',
  'superseded',
  'unknown',
] as const;
export type CryptoRevocationStatus = typeof CRYPTO_REVOCATION_STATUSES[number];

export const CRYPTO_FRESHNESS_STATUSES = [
  'fresh',
  'not-yet-valid',
  'expired',
  'stale',
  'replayed',
  'revoked',
  'indeterminate',
  'invalid',
] as const;
export type CryptoFreshnessStatus = typeof CRYPTO_FRESHNESS_STATUSES[number];

export const CRYPTO_FRESHNESS_REASON_CODES = [
  'fresh',
  'not-yet-valid',
  'expired',
  'stale-authorization',
  'replay-ledger-hit',
  'replay-ledger-unavailable',
  'adapter-nonce-required',
  'adapter-nonce-mismatch',
  'revocation-check-required',
  'revocation-status-stale',
  'revoked',
  'suspended',
  'superseded',
  'revocation-status-unknown',
  'envelope-intent-mismatch',
] as const;
export type CryptoFreshnessReasonCode =
  typeof CRYPTO_FRESHNESS_REASON_CODES[number];

export interface CryptoFreshnessBaseline {
  readonly clockSkewSeconds: number;
  readonly maxAuthorizationAgeSeconds: number;
  readonly replayStoreSeconds: number;
  readonly maxRevocationStatusAgeSeconds: number;
}

export interface CryptoValidityWindowPlan {
  readonly validAfterEpochSeconds: number;
  readonly validUntilEpochSeconds: number;
  readonly issuedAtEpochSeconds: number;
  readonly clockSkewSeconds: number;
  readonly maxAuthorizationAgeSeconds: number;
  readonly maxAgeExpiresAtEpochSeconds: number;
  readonly effectiveExpiresAtEpochSeconds: number;
}

export interface CryptoReplayLedgerPlan {
  readonly mode: CryptoReplayProtectionMode;
  readonly keyKind: CryptoReplayKeyKind;
  readonly ledgerKey: string;
  readonly partitionKey: string;
  readonly storeUntilEpochSeconds: number;
  readonly consumeOnAllow: boolean;
  readonly requiresLedger: boolean;
  readonly chainAuthoritative: boolean;
}

export interface CryptoRevocationPlan {
  readonly required: boolean;
  readonly sourceKind: CryptoRevocationSourceKind;
  readonly revocationKey: string;
  readonly onlineCheckRequired: boolean;
  readonly failClosedOnUnknown: boolean;
  readonly maxStatusAgeSeconds: number;
}

export interface CryptoAdapterNoncePlan {
  readonly required: boolean;
  readonly sourceKind: CryptoRevocationSourceKind | null;
  readonly expectedNonce: string;
  readonly adapterNonceKind: CryptoReplayKeyKind;
}

export interface CryptoReplayFreshnessRules {
  readonly version: typeof CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION;
  readonly ruleId: string;
  readonly envelopeId: string;
  readonly intentId: string;
  readonly decisionId: string;
  readonly chainId: string;
  readonly accountAddress: string;
  readonly signerAddress: string;
  readonly domainVerifyingContract: string;
  readonly consequenceKind: CryptoAuthorizationConsequenceKind;
  readonly riskClass: CryptoAuthorizationRiskClass;
  readonly validityWindow: CryptoValidityWindowPlan;
  readonly replayLedger: CryptoReplayLedgerPlan;
  readonly revocation: CryptoRevocationPlan;
  readonly adapterNonce: CryptoAdapterNoncePlan;
  readonly requiredChecks: readonly string[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateCryptoReplayFreshnessRulesInput {
  readonly envelope: CryptoEip712AuthorizationEnvelope;
  readonly intent: CryptoAuthorizationIntent;
  readonly decision: CryptoAuthorizationDecision;
  readonly validationProjection?: CryptoSignatureValidationProjection | null;
  readonly permissionContext?: string | null;
  readonly idempotencyKey?: string | null;
  readonly revocationSourceKind?: CryptoRevocationSourceKind | null;
}

export interface CryptoValidityWindowEvaluation {
  readonly status: 'valid' | 'not-yet-valid' | 'expired' | 'stale';
  readonly accepted: boolean;
  readonly checkedAtEpochSeconds: number;
  readonly reasonCodes: readonly CryptoFreshnessReasonCode[];
}

export interface CryptoReplayLedgerEntry {
  readonly ledgerKey: string;
  readonly firstSeenAtEpochSeconds: number;
  readonly expiresAtEpochSeconds: number;
  readonly consumedAtEpochSeconds?: number | null;
}

export interface CryptoReplayLedgerEvaluationInput {
  readonly rules: CryptoReplayFreshnessRules;
  readonly nowEpochSeconds: number;
  readonly ledgerAvailable?: boolean;
  readonly ledgerEntry?: CryptoReplayLedgerEntry | null;
}

export interface CryptoReplayLedgerEvaluation {
  readonly status: 'fresh' | 'replayed' | 'indeterminate';
  readonly accepted: boolean;
  readonly storeUntilEpochSeconds: number | null;
  readonly consumeOnAllow: boolean;
  readonly reasonCodes: readonly CryptoFreshnessReasonCode[];
}

export interface CryptoRevocationObservation {
  readonly revocationKey: string;
  readonly status: CryptoRevocationStatus;
  readonly checkedAtEpochSeconds: number;
  readonly reasonCode?: string | null;
}

export interface CryptoRevocationEvaluationInput {
  readonly rules: CryptoReplayFreshnessRules;
  readonly nowEpochSeconds: number;
  readonly observation?: CryptoRevocationObservation | null;
}

export interface CryptoRevocationEvaluation {
  readonly status: 'not-required' | 'active' | 'revoked' | 'indeterminate';
  readonly accepted: boolean;
  readonly reasonCodes: readonly CryptoFreshnessReasonCode[];
}

export interface CryptoAdapterNonceObservation {
  readonly nonce: string;
  readonly matchesExpected: boolean;
  readonly checkedAtEpochSeconds: number;
  readonly sourceKind: CryptoRevocationSourceKind;
}

export interface CryptoAdapterNonceEvaluationInput {
  readonly rules: CryptoReplayFreshnessRules;
  readonly observation?: CryptoAdapterNonceObservation | null;
}

export interface CryptoAdapterNonceEvaluation {
  readonly status: 'not-required' | 'valid' | 'invalid' | 'indeterminate';
  readonly accepted: boolean;
  readonly reasonCodes: readonly CryptoFreshnessReasonCode[];
}

export interface EvaluateCryptoAuthorizationFreshnessInput {
  readonly rules: CryptoReplayFreshnessRules;
  readonly nowEpochSeconds: number;
  readonly replayLedgerAvailable?: boolean;
  readonly replayLedgerEntry?: CryptoReplayLedgerEntry | null;
  readonly revocationObservation?: CryptoRevocationObservation | null;
  readonly adapterNonceObservation?: CryptoAdapterNonceObservation | null;
}

export interface CryptoAuthorizationFreshnessEvaluation {
  readonly version: typeof CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION;
  readonly rulesDigest: string;
  readonly status: CryptoFreshnessStatus;
  readonly accepted: boolean;
  readonly checkedAtEpochSeconds: number;
  readonly reasonCodes: readonly CryptoFreshnessReasonCode[];
  readonly validityWindow: CryptoValidityWindowEvaluation;
  readonly replayLedger: CryptoReplayLedgerEvaluation;
  readonly revocation: CryptoRevocationEvaluation;
  readonly adapterNonce: CryptoAdapterNonceEvaluation;
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoReplayFreshnessRulesDescriptor {
  readonly version: typeof CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION;
  readonly replayKeyKinds: typeof CRYPTO_REPLAY_KEY_KINDS;
  readonly revocationSourceKinds: typeof CRYPTO_REVOCATION_SOURCE_KINDS;
  readonly revocationStatuses: typeof CRYPTO_REVOCATION_STATUSES;
  readonly freshnessStatuses: typeof CRYPTO_FRESHNESS_STATUSES;
  readonly reasonCodes: typeof CRYPTO_FRESHNESS_REASON_CODES;
  readonly standards: readonly string[];
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export const CRYPTO_FRESHNESS_BASELINES: Record<
  CryptoAuthorizationRiskClass,
  CryptoFreshnessBaseline
> = Object.freeze({
  R0: Object.freeze({
    clockSkewSeconds: 120,
    maxAuthorizationAgeSeconds: 86_400,
    replayStoreSeconds: 0,
    maxRevocationStatusAgeSeconds: 3_600,
  }),
  R1: Object.freeze({
    clockSkewSeconds: 120,
    maxAuthorizationAgeSeconds: 3_600,
    replayStoreSeconds: 3_600,
    maxRevocationStatusAgeSeconds: 900,
  }),
  R2: Object.freeze({
    clockSkewSeconds: 60,
    maxAuthorizationAgeSeconds: 900,
    replayStoreSeconds: 900,
    maxRevocationStatusAgeSeconds: 300,
  }),
  R3: Object.freeze({
    clockSkewSeconds: 30,
    maxAuthorizationAgeSeconds: 300,
    replayStoreSeconds: 300,
    maxRevocationStatusAgeSeconds: 60,
  }),
  R4: Object.freeze({
    clockSkewSeconds: 15,
    maxAuthorizationAgeSeconds: 120,
    replayStoreSeconds: 120,
    maxRevocationStatusAgeSeconds: 30,
  }),
});

const REVOCABLE_CONSEQUENCES = new Set<CryptoAuthorizationConsequenceKind>([
  'approval',
  'permission-grant',
  'account-delegation',
  'agent-payment',
  'custody-withdrawal',
  'governance-action',
]);

const CHAIN_AUTHORITATIVE_REPLAY_MODES = new Set<CryptoReplayProtectionMode>([
  'user-operation-nonce',
  'authorization-list-nonce',
]);

const CONSUME_ON_ALLOW_REPLAY_MODES = new Set<CryptoReplayProtectionMode>([
  'nonce',
  'user-operation-nonce',
  'authorization-list-nonce',
  'one-time-receipt',
  'idempotency-key',
]);

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Crypto replay freshness rules ${fieldName} requires a non-empty value.`);
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

function normalizeEpochSeconds(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Crypto replay freshness rules ${fieldName} must be a non-negative integer epoch second.`);
  }
  return value;
}

function epochSeconds(value: string, fieldName: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`Crypto replay freshness rules ${fieldName} must be an ISO timestamp.`);
  }
  return Math.floor(time / 1000);
}

function canonicalizeJson(value: CanonicalJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalizeJson(entry)).join(',')}]`;

  const objectValue = value as { readonly [key: string]: CanonicalJsonValue };
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(objectValue[key])}`)
    .join(',')}}`;
}

function digestCanonicalJson(value: CanonicalJsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value)).digest('hex')}`;
}

function canonicalObject<T extends CanonicalJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  return Object.freeze({
    canonical: canonicalizeJson(value),
    digest: digestCanonicalJson(value),
  });
}

function uniqueReasons(
  values: readonly CryptoFreshnessReasonCode[],
): readonly CryptoFreshnessReasonCode[] {
  const present = new Set(values);
  return Object.freeze(CRYPTO_FRESHNESS_REASON_CODES.filter((code) => present.has(code)));
}

function replayKeyKindFor(mode: CryptoReplayProtectionMode): CryptoReplayKeyKind {
  switch (mode) {
    case 'nonce':
      return 'nonce';
    case 'user-operation-nonce':
      return 'user-operation-nonce';
    case 'authorization-list-nonce':
      return 'authorization-list-nonce';
    case 'session-budget':
      return 'permission-context';
    case 'idempotency-key':
      return 'idempotency-key';
    case 'one-time-receipt':
      return 'authorization-digest';
  }
}

function adapterNonceSourceFor(
  mode: CryptoReplayProtectionMode,
): CryptoRevocationSourceKind | null {
  switch (mode) {
    case 'user-operation-nonce':
      return 'entrypoint-nonce-state';
    case 'authorization-list-nonce':
      return 'eip-7702-authority-nonce';
    default:
      return null;
  }
}

function defaultRevocationSourceFor(
  input: CreateCryptoReplayFreshnessRulesInput,
): CryptoRevocationSourceKind {
  if (input.intent.consequenceKind === 'permission-grant') {
    return 'wallet-permission-registry';
  }
  if (input.intent.consequenceKind === 'custody-withdrawal') {
    return 'custody-policy-engine';
  }
  const adapterNonceSource = adapterNonceSourceFor(input.intent.constraints.replayProtectionMode);
  return adapterNonceSource ?? 'attestor-revocation-ledger';
}

function replayPartitionKey(
  envelope: CryptoEip712AuthorizationEnvelope,
  mode: CryptoReplayProtectionMode,
): string {
  return [
    'crypto-replay',
    envelope.chainBinding.caip2ChainId,
    envelope.signerBinding.accountAddress,
    mode,
  ].join(':');
}

function assertEnvelopeConsistency(input: CreateCryptoReplayFreshnessRulesInput): void {
  const { envelope, intent, decision, validationProjection } = input;
  const message = envelope.typedData.message;

  if (message.intentId !== intent.intentId || decision.intentId !== intent.intentId) {
    throw new Error('Crypto replay freshness rules envelope, intent, and decision must share an intent id.');
  }
  if (message.decisionId !== decision.decisionId) {
    throw new Error('Crypto replay freshness rules envelope and decision must share a decision id.');
  }
  if (message.nonce !== intent.constraints.nonce || message.nonce !== decision.nonce) {
    throw new Error('Crypto replay freshness rules envelope, intent, and decision must share a nonce.');
  }
  if (message.consequenceKind !== intent.consequenceKind) {
    throw new Error('Crypto replay freshness rules envelope consequence must match intent.');
  }
  if (message.riskClass !== decision.riskClass) {
    throw new Error('Crypto replay freshness rules envelope risk must match decision.');
  }
  if (message.validAfter !== epochSeconds(decision.validAfter, 'decision.validAfter')) {
    throw new Error('Crypto replay freshness rules envelope validAfter must match decision.');
  }
  if (message.validUntil !== epochSeconds(decision.validUntil, 'decision.validUntil')) {
    throw new Error('Crypto replay freshness rules envelope validUntil must match decision.');
  }
  if (validationProjection && validationProjection.envelopeId !== envelope.envelopeId) {
    throw new Error('Crypto replay freshness rules validation projection must bind to the envelope.');
  }
}

function requiredChecksFor(input: CreateCryptoReplayFreshnessRulesInput): readonly string[] {
  const replayMode = input.intent.constraints.replayProtectionMode;
  const checks = [
    'envelope-intent-decision-consistency',
    'valid-after-enforced',
    'valid-until-enforced',
    'max-authorization-age-enforced',
    'chain-id-bound',
    'account-address-bound',
    'domain-verifying-contract-bound',
    'nonce-bound',
    'replay-ledger-checked',
  ];

  if (CONSUME_ON_ALLOW_REPLAY_MODES.has(replayMode)) {
    checks.push('consume-on-allow');
  }
  if (CHAIN_AUTHORITATIVE_REPLAY_MODES.has(replayMode)) {
    checks.push('adapter-nonce-state-checked');
  }
  if (REVOCABLE_CONSEQUENCES.has(input.intent.consequenceKind)) {
    checks.push('revocation-status-checked');
  }
  if (input.intent.constraints.replayProtectionMode === 'session-budget') {
    checks.push('budget-session-liveness-checked');
  }

  return Object.freeze(checks);
}

function statusRank(status: CryptoFreshnessStatus): number {
  switch (status) {
    case 'fresh':
      return 0;
    case 'indeterminate':
      return 1;
    case 'not-yet-valid':
      return 2;
    case 'stale':
      return 3;
    case 'expired':
      return 4;
    case 'replayed':
      return 5;
    case 'revoked':
      return 6;
    case 'invalid':
      return 7;
  }
}

function higherPriorityStatus(
  left: CryptoFreshnessStatus,
  right: CryptoFreshnessStatus,
): CryptoFreshnessStatus {
  return statusRank(left) >= statusRank(right) ? left : right;
}

export function isCryptoReplayKeyKind(value: string): value is CryptoReplayKeyKind {
  return includesValue(CRYPTO_REPLAY_KEY_KINDS, value);
}

export function isCryptoRevocationStatus(value: string): value is CryptoRevocationStatus {
  return includesValue(CRYPTO_REVOCATION_STATUSES, value);
}

export function isCryptoFreshnessStatus(value: string): value is CryptoFreshnessStatus {
  return includesValue(CRYPTO_FRESHNESS_STATUSES, value);
}

export function createCryptoReplayFreshnessRules(
  input: CreateCryptoReplayFreshnessRulesInput,
): CryptoReplayFreshnessRules {
  assertEnvelopeConsistency(input);

  const { envelope, intent, decision } = input;
  const baseline = CRYPTO_FRESHNESS_BASELINES[decision.riskClass];
  const validAfterEpochSeconds = normalizeEpochSeconds(
    envelope.typedData.message.validAfter,
    'validAfterEpochSeconds',
  );
  const validUntilEpochSeconds = normalizeEpochSeconds(
    envelope.typedData.message.validUntil,
    'validUntilEpochSeconds',
  );
  if (validAfterEpochSeconds >= validUntilEpochSeconds) {
    throw new Error('Crypto replay freshness rules validAfter must be before validUntil.');
  }

  const issuedAtEpochSeconds = epochSeconds(decision.decidedAt, 'decision.decidedAt');
  const maxAgeExpiresAtEpochSeconds =
    issuedAtEpochSeconds + baseline.maxAuthorizationAgeSeconds;
  const replayMode = intent.constraints.replayProtectionMode;
  const keyKind = replayKeyKindFor(replayMode);
  const permissionContext = normalizeOptionalIdentifier(input.permissionContext, 'permissionContext');
  const idempotencyKey = normalizeOptionalIdentifier(input.idempotencyKey, 'idempotencyKey');
  const keyMaterial = keyKind === 'permission-context'
    ? permissionContext ?? envelope.typedData.message.nonce
    : keyKind === 'idempotency-key'
      ? idempotencyKey ?? envelope.typedData.message.nonce
      : keyKind === 'authorization-digest'
        ? envelope.digest
        : envelope.typedData.message.nonce;
  const partitionKey = replayPartitionKey(envelope, replayMode);
  const replayLedgerPayload = {
    version: CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION,
    keyKind,
    mode: replayMode,
    partitionKey,
    keyMaterial,
    envelopeDigest: envelope.digest,
  } as const;
  const revocationSourceKind =
    input.revocationSourceKind ?? defaultRevocationSourceFor(input);
  const revocationRequired =
    REVOCABLE_CONSEQUENCES.has(intent.consequenceKind) ||
    replayMode === 'session-budget';
  const onlineCheckRequired =
    revocationRequired || decision.riskClass === 'R3' || decision.riskClass === 'R4';
  const adapterNonceSource = adapterNonceSourceFor(replayMode);
  const adapterNonceRequired = adapterNonceSource !== null;

  const baseRules = {
    version: CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION,
    ruleId: [
      'crypto-freshness',
      envelope.chainBinding.caip2ChainId,
      envelope.signerBinding.accountAddress,
      decision.decisionId,
      envelope.typedData.message.nonce,
    ].join(':'),
    envelopeId: envelope.envelopeId,
    intentId: intent.intentId,
    decisionId: decision.decisionId,
    chainId: envelope.chainBinding.caip2ChainId,
    accountAddress: envelope.signerBinding.accountAddress,
    signerAddress: envelope.signerBinding.signerAddress,
    domainVerifyingContract: envelope.typedData.domain.verifyingContract,
    consequenceKind: intent.consequenceKind,
    riskClass: decision.riskClass,
    validityWindow: Object.freeze({
      validAfterEpochSeconds,
      validUntilEpochSeconds,
      issuedAtEpochSeconds,
      clockSkewSeconds: baseline.clockSkewSeconds,
      maxAuthorizationAgeSeconds: baseline.maxAuthorizationAgeSeconds,
      maxAgeExpiresAtEpochSeconds,
      effectiveExpiresAtEpochSeconds: Math.min(
        validUntilEpochSeconds,
        maxAgeExpiresAtEpochSeconds,
      ),
    }),
    replayLedger: Object.freeze({
      mode: replayMode,
      keyKind,
      ledgerKey: digestCanonicalJson(replayLedgerPayload),
      partitionKey,
      storeUntilEpochSeconds:
        validUntilEpochSeconds + Math.max(baseline.replayStoreSeconds, baseline.clockSkewSeconds),
      consumeOnAllow: CONSUME_ON_ALLOW_REPLAY_MODES.has(replayMode),
      requiresLedger: true,
      chainAuthoritative: CHAIN_AUTHORITATIVE_REPLAY_MODES.has(replayMode),
    }),
    revocation: Object.freeze({
      required: revocationRequired,
      sourceKind: revocationSourceKind,
      revocationKey: digestCanonicalJson({
        version: CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION,
        chainId: envelope.chainBinding.caip2ChainId,
        accountAddress: envelope.signerBinding.accountAddress,
        decisionId: decision.decisionId,
        nonce: envelope.typedData.message.nonce,
        sourceKind: revocationSourceKind,
      }),
      onlineCheckRequired,
      failClosedOnUnknown: onlineCheckRequired,
      maxStatusAgeSeconds: baseline.maxRevocationStatusAgeSeconds,
    }),
    adapterNonce: Object.freeze({
      required: adapterNonceRequired,
      sourceKind: adapterNonceSource,
      expectedNonce: envelope.typedData.message.nonce,
      adapterNonceKind: keyKind,
    }),
    requiredChecks: requiredChecksFor(input),
  } as const;
  const canonical = canonicalObject(baseRules as unknown as CanonicalJsonValue);

  return Object.freeze({
    ...baseRules,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function evaluateCryptoValidityWindow(input: {
  readonly rules: CryptoReplayFreshnessRules;
  readonly nowEpochSeconds: number;
}): CryptoValidityWindowEvaluation {
  const now = normalizeEpochSeconds(input.nowEpochSeconds, 'nowEpochSeconds');
  const window = input.rules.validityWindow;
  const skew = window.clockSkewSeconds;

  if (now + skew < window.validAfterEpochSeconds) {
    return Object.freeze({
      status: 'not-yet-valid',
      accepted: false,
      checkedAtEpochSeconds: now,
      reasonCodes: uniqueReasons(['not-yet-valid']),
    });
  }

  if (now - skew >= window.validUntilEpochSeconds) {
    return Object.freeze({
      status: 'expired',
      accepted: false,
      checkedAtEpochSeconds: now,
      reasonCodes: uniqueReasons(['expired']),
    });
  }

  if (now - skew > window.maxAgeExpiresAtEpochSeconds) {
    return Object.freeze({
      status: 'stale',
      accepted: false,
      checkedAtEpochSeconds: now,
      reasonCodes: uniqueReasons(['stale-authorization']),
    });
  }

  return Object.freeze({
    status: 'valid',
    accepted: true,
    checkedAtEpochSeconds: now,
    reasonCodes: uniqueReasons(['fresh']),
  });
}

export function evaluateCryptoReplayLedger(
  input: CryptoReplayLedgerEvaluationInput,
): CryptoReplayLedgerEvaluation {
  normalizeEpochSeconds(input.nowEpochSeconds, 'nowEpochSeconds');
  if (input.ledgerAvailable === false) {
    return Object.freeze({
      status: 'indeterminate',
      accepted: false,
      storeUntilEpochSeconds: null,
      consumeOnAllow: false,
      reasonCodes: uniqueReasons(['replay-ledger-unavailable']),
    });
  }

  const entry = input.ledgerEntry ?? null;
  if (
    entry &&
    entry.ledgerKey === input.rules.replayLedger.ledgerKey &&
    input.nowEpochSeconds <= normalizeEpochSeconds(entry.expiresAtEpochSeconds, 'ledgerEntry.expiresAtEpochSeconds')
  ) {
    return Object.freeze({
      status: 'replayed',
      accepted: false,
      storeUntilEpochSeconds: null,
      consumeOnAllow: false,
      reasonCodes: uniqueReasons(['replay-ledger-hit']),
    });
  }

  return Object.freeze({
    status: 'fresh',
    accepted: true,
    storeUntilEpochSeconds: input.rules.replayLedger.storeUntilEpochSeconds,
    consumeOnAllow: input.rules.replayLedger.consumeOnAllow,
    reasonCodes: uniqueReasons(['fresh']),
  });
}

export function evaluateCryptoRevocation(
  input: CryptoRevocationEvaluationInput,
): CryptoRevocationEvaluation {
  const now = normalizeEpochSeconds(input.nowEpochSeconds, 'nowEpochSeconds');
  const plan = input.rules.revocation;
  const observation = input.observation ?? null;

  if (!plan.onlineCheckRequired && observation === null) {
    return Object.freeze({
      status: 'not-required',
      accepted: true,
      reasonCodes: uniqueReasons(['fresh']),
    });
  }

  if (observation === null || observation.revocationKey !== plan.revocationKey) {
    return Object.freeze({
      status: 'indeterminate',
      accepted: false,
      reasonCodes: uniqueReasons(['revocation-check-required']),
    });
  }

  if (!isCryptoRevocationStatus(observation.status)) {
    throw new Error(
      `Crypto replay freshness rules does not support revocation status ${observation.status}.`,
    );
  }

  switch (observation.status) {
    case 'revoked':
      return Object.freeze({
        status: 'revoked',
        accepted: false,
        reasonCodes: uniqueReasons(['revoked']),
      });
    case 'suspended':
      return Object.freeze({
        status: 'revoked',
        accepted: false,
        reasonCodes: uniqueReasons(['suspended']),
      });
    case 'superseded':
      return Object.freeze({
        status: 'revoked',
        accepted: false,
        reasonCodes: uniqueReasons(['superseded']),
      });
    case 'unknown':
      return Object.freeze({
        status: 'indeterminate',
        accepted: false,
        reasonCodes: uniqueReasons(['revocation-status-unknown']),
      });
    case 'active':
      break;
  }

  const checkedAt = normalizeEpochSeconds(
    observation.checkedAtEpochSeconds,
    'revocation.checkedAtEpochSeconds',
  );
  if (now - checkedAt > plan.maxStatusAgeSeconds) {
    return Object.freeze({
      status: 'indeterminate',
      accepted: false,
      reasonCodes: uniqueReasons(['revocation-status-stale']),
    });
  }

  return Object.freeze({
    status: 'active',
    accepted: true,
    reasonCodes: uniqueReasons(['fresh']),
  });
}

export function evaluateCryptoAdapterNonce(
  input: CryptoAdapterNonceEvaluationInput,
): CryptoAdapterNonceEvaluation {
  const plan = input.rules.adapterNonce;
  if (!plan.required) {
    return Object.freeze({
      status: 'not-required',
      accepted: true,
      reasonCodes: uniqueReasons(['fresh']),
    });
  }

  const observation = input.observation ?? null;
  if (observation === null) {
    return Object.freeze({
      status: 'indeterminate',
      accepted: false,
      reasonCodes: uniqueReasons(['adapter-nonce-required']),
    });
  }

  if (
    observation.sourceKind !== plan.sourceKind ||
    observation.nonce !== plan.expectedNonce ||
    !observation.matchesExpected
  ) {
    return Object.freeze({
      status: 'invalid',
      accepted: false,
      reasonCodes: uniqueReasons(['adapter-nonce-mismatch']),
    });
  }

  return Object.freeze({
    status: 'valid',
    accepted: true,
    reasonCodes: uniqueReasons(['fresh']),
  });
}

export function evaluateCryptoAuthorizationFreshness(
  input: EvaluateCryptoAuthorizationFreshnessInput,
): CryptoAuthorizationFreshnessEvaluation {
  const now = normalizeEpochSeconds(input.nowEpochSeconds, 'nowEpochSeconds');
  const validityWindow = evaluateCryptoValidityWindow({
    rules: input.rules,
    nowEpochSeconds: now,
  });
  const replayLedger = evaluateCryptoReplayLedger({
    rules: input.rules,
    nowEpochSeconds: now,
    ledgerAvailable: input.replayLedgerAvailable,
    ledgerEntry: input.replayLedgerEntry,
  });
  const revocation = evaluateCryptoRevocation({
    rules: input.rules,
    nowEpochSeconds: now,
    observation: input.revocationObservation,
  });
  const adapterNonce = evaluateCryptoAdapterNonce({
    rules: input.rules,
    observation: input.adapterNonceObservation,
  });
  let status: CryptoFreshnessStatus = 'fresh';

  switch (validityWindow.status) {
    case 'not-yet-valid':
      status = higherPriorityStatus(status, 'not-yet-valid');
      break;
    case 'expired':
      status = higherPriorityStatus(status, 'expired');
      break;
    case 'stale':
      status = higherPriorityStatus(status, 'stale');
      break;
    case 'valid':
      break;
  }
  if (replayLedger.status === 'replayed') {
    status = higherPriorityStatus(status, 'replayed');
  } else if (replayLedger.status === 'indeterminate') {
    status = higherPriorityStatus(status, 'indeterminate');
  }
  if (revocation.status === 'revoked') {
    status = higherPriorityStatus(status, 'revoked');
  } else if (revocation.status === 'indeterminate') {
    status = higherPriorityStatus(status, 'indeterminate');
  }
  if (adapterNonce.status === 'invalid') {
    status = higherPriorityStatus(status, 'invalid');
  } else if (adapterNonce.status === 'indeterminate') {
    status = higherPriorityStatus(status, 'indeterminate');
  }

  const reasonCodes = uniqueReasons([
    ...validityWindow.reasonCodes,
    ...replayLedger.reasonCodes,
    ...revocation.reasonCodes,
    ...adapterNonce.reasonCodes,
  ].filter((reason) => reason !== 'fresh'));
  const payload = {
    version: CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION,
    rulesDigest: input.rules.digest,
    status,
    accepted: status === 'fresh',
    checkedAtEpochSeconds: now,
    reasonCodes,
    validityWindow,
    replayLedger,
    revocation,
    adapterNonce,
  } as const;
  const canonical = canonicalObject(payload as unknown as CanonicalJsonValue);

  return Object.freeze({
    version: CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION,
    rulesDigest: input.rules.digest,
    status,
    accepted: status === 'fresh',
    checkedAtEpochSeconds: now,
    reasonCodes,
    validityWindow,
    replayLedger,
    revocation,
    adapterNonce,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function cryptoReplayFreshnessRulesLabel(
  rules: CryptoReplayFreshnessRules,
): string {
  return [
    `freshness:${rules.envelopeId}`,
    `chain:${rules.chainId}`,
    `account:${rules.accountAddress}`,
    `risk:${rules.riskClass}`,
    `replay:${rules.replayLedger.mode}`,
    `nonce:${rules.replayLedger.keyKind}`,
  ].join(' / ');
}

export function cryptoReplayFreshnessRulesDescriptor():
CryptoReplayFreshnessRulesDescriptor {
  return Object.freeze({
    version: CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION,
    replayKeyKinds: CRYPTO_REPLAY_KEY_KINDS,
    revocationSourceKinds: CRYPTO_REVOCATION_SOURCE_KINDS,
    revocationStatuses: CRYPTO_REVOCATION_STATUSES,
    freshnessStatuses: CRYPTO_FRESHNESS_STATUSES,
    reasonCodes: CRYPTO_FRESHNESS_REASON_CODES,
    standards: Object.freeze([
      'EIP-712',
      'ERC-4337-ready',
      'ERC-7715-ready',
      'EIP-7702-ready',
      'ERC-6492-aware',
    ]),
  });
}
