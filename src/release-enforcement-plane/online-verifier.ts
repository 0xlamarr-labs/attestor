import type {
  ActiveReleaseTokenIntrospectionResult,
  ReleaseTokenIntrospectionResult,
  ReleaseTokenIntrospectionStore,
  ReleaseTokenIntrospector,
  ReleaseTokenInactiveReason,
} from '../release-kernel/release-introspection.js';
import { DEFAULT_RELEASE_TOKEN_TYPE_HINT } from '../release-kernel/release-introspection.js';
import {
  createIntrospectionSnapshot,
  createVerificationResult,
  type IntrospectionSnapshot,
  type VerificationResult,
} from './object-model.js';
import {
  evaluateReleaseFreshness,
  resolveFreshnessRules,
  type ReleaseFreshnessEvaluation,
  type ReplaySubjectKind,
} from './freshness.js';
import {
  OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
  verifyOfflineReleaseAuthorization,
  type OfflineReleaseVerification,
  type OfflineReleaseVerificationInput,
} from './offline-verifier.js';
import {
  ENFORCEMENT_FAILURE_REASONS,
  type EnforcementFailureReason,
  type EnforcementVerificationMode,
} from './types.js';

/**
 * Online release verification.
 *
 * This layer composes the offline verifier with an authority-plane
 * introspection call. It is where high-risk release authorization becomes live:
 * revoked, unknown, consumed, expired, or claim-mismatched tokens fail closed
 * even if the signed artifact can still be verified locally.
 */

export const ONLINE_RELEASE_VERIFIER_SPEC_VERSION =
  'attestor.release-enforcement-online-verifier.v1';

export type OnlineReleaseVerificationStatus = 'valid' | 'invalid';

export interface OnlineReleaseVerificationInput
  extends OfflineReleaseVerificationInput {
  readonly introspector?: ReleaseTokenIntrospector;
  readonly tokenTypeHint?: string;
  readonly resourceServerId?: string;
  readonly usageStore?: ReleaseTokenIntrospectionStore;
  readonly consumeOnSuccess?: boolean;
  readonly forceOnlineIntrospection?: boolean;
  readonly introspectionSnapshotId?: string;
}

export interface OnlineReleaseVerification {
  readonly version: typeof ONLINE_RELEASE_VERIFIER_SPEC_VERSION;
  readonly offlineVerifierVersion: typeof OFFLINE_RELEASE_VERIFIER_SPEC_VERSION;
  readonly status: OnlineReleaseVerificationStatus;
  readonly checkedAt: string;
  readonly onlineChecked: boolean;
  readonly active: boolean | null;
  readonly introspection: ReleaseTokenIntrospectionResult | null;
  readonly introspectionSnapshot: IntrospectionSnapshot | null;
  readonly freshness: ReleaseFreshnessEvaluation | null;
  readonly verificationResult: VerificationResult;
  readonly offline: OfflineReleaseVerification;
  readonly consumed: boolean;
  readonly useCount: number | null;
  readonly maxUses: number | null;
  readonly failureReasons: readonly EnforcementFailureReason[];
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Release enforcement-plane online verifier ${fieldName} must be a valid ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function uniqueFailureReasons(
  reasons: readonly EnforcementFailureReason[],
): readonly EnforcementFailureReason[] {
  const present = new Set(reasons);
  return Object.freeze(ENFORCEMENT_FAILURE_REASONS.filter((reason) => present.has(reason)));
}

function inactiveReasonFailureReasons(
  reason: ReleaseTokenInactiveReason,
): readonly EnforcementFailureReason[] {
  switch (reason) {
    case 'revoked':
      return ['revoked-authorization'];
    case 'expired':
      return ['expired-authorization'];
    case 'usage_exhausted':
      return ['replayed-authorization'];
    case 'unknown':
      return ['unknown-authorization'];
    case 'unsupported_token_type':
      return ['unsupported-token-type'];
    case 'claim_mismatch':
      return ['introspection-claim-mismatch', 'binding-mismatch'];
    case 'invalid':
    default:
      return ['invalid-signature'];
  }
}

function expectedResourceServerId(input: OnlineReleaseVerificationInput): string {
  return input.resourceServerId ?? input.request.enforcementPoint.enforcementPointId;
}

function expectedAudience(input: OnlineReleaseVerificationInput): string {
  return input.expected?.audience ?? input.request.targetId;
}

function activeIntrospectionClaimMismatch(
  offline: OfflineReleaseVerification,
  introspection: ActiveReleaseTokenIntrospectionResult,
): boolean {
  const claims = offline.claims;
  if (claims === null) {
    return true;
  }

  return (
    introspection.jti !== claims.jti ||
    introspection.iss !== claims.iss ||
    introspection.sub !== claims.sub ||
    introspection.aud !== claims.aud ||
    introspection.decision_id !== claims.decision_id ||
    introspection.decision !== claims.decision ||
    introspection.consequence_type !== claims.consequence_type ||
    introspection.risk_class !== claims.risk_class ||
    introspection.output_hash !== claims.output_hash ||
    introspection.consequence_hash !== claims.consequence_hash ||
    introspection.policy_hash !== claims.policy_hash ||
    introspection.override !== claims.override ||
    introspection.authority_mode !== claims.authority_mode ||
    introspection.introspection_required !== claims.introspection_required
  );
}

function snapshotFromIntrospection(
  introspection: ReleaseTokenIntrospectionResult,
): IntrospectionSnapshot {
  if (!introspection.active) {
    return createIntrospectionSnapshot({
      checkedAt: introspection.checked_at,
      authority: 'attestor.release-introspection',
      active: false,
    });
  }

  return createIntrospectionSnapshot({
    checkedAt: introspection.checked_at,
    authority: 'attestor.release-introspection',
    active: true,
    releaseTokenId: introspection.jti,
    releaseDecisionId: introspection.decision_id,
    issuer: introspection.iss,
    subject: introspection.sub,
    audience: introspection.aud,
    scope: [introspection.scope],
    issuedAt: new Date(introspection.iat * 1000).toISOString(),
    expiresAt: new Date(introspection.exp * 1000).toISOString(),
    notBefore: new Date(introspection.nbf * 1000).toISOString(),
    clientId: introspection.resource_server_id,
    consequenceType: introspection.consequence_type,
    riskClass: introspection.risk_class,
  });
}

function replayKeyFromOffline(
  input: OnlineReleaseVerificationInput,
  offline: OfflineReleaseVerification,
): string | null | undefined {
  if (input.replayKey !== undefined) {
    return input.replayKey;
  }

  return offline.freshness?.replay.replayKey ?? null;
}

function replaySubjectKindFromOffline(
  input: OnlineReleaseVerificationInput,
  offline: OfflineReleaseVerification,
): ReplaySubjectKind | undefined {
  return input.replaySubjectKind ?? offline.freshness?.replay.subjectKind ?? undefined;
}

function nonceFromOffline(offline: OfflineReleaseVerification): string | null | undefined {
  return offline.freshness?.nonce.nonce ?? null;
}

function freshnessFromActiveIntrospection(
  input: OnlineReleaseVerificationInput,
  offline: OfflineReleaseVerification,
  introspection: ActiveReleaseTokenIntrospectionResult,
  checkedAt: string,
): ReleaseFreshnessEvaluation {
  return evaluateReleaseFreshness({
    rules: resolveFreshnessRules(offline.profile),
    now: checkedAt,
    presentationMode: offline.verificationResult.presentationMode,
    issuedAt: new Date(introspection.iat * 1000).toISOString(),
    notBefore: new Date(introspection.nbf * 1000).toISOString(),
    expiresAt: new Date(introspection.exp * 1000).toISOString(),
    introspectionCache: {
      checkedAt: introspection.checked_at,
      active: true,
      tokenExpiresAt: new Date(introspection.exp * 1000).toISOString(),
    },
    replayKey: replayKeyFromOffline(input, offline),
    replaySubjectKind: replaySubjectKindFromOffline(input, offline),
    replayLedgerEntry: input.replayLedgerEntry,
    nonce: nonceFromOffline(offline),
    nonceLedgerEntry: input.nonceLedgerEntry,
  });
}

function freshnessFromInactiveIntrospection(
  input: OnlineReleaseVerificationInput,
  offline: OfflineReleaseVerification,
  introspection: ReleaseTokenIntrospectionResult,
  checkedAt: string,
): ReleaseFreshnessEvaluation {
  return evaluateReleaseFreshness({
    rules: resolveFreshnessRules(offline.profile),
    now: checkedAt,
    presentationMode: offline.verificationResult.presentationMode,
    issuedAt: offline.claims ? new Date(offline.claims.iat * 1000).toISOString() : null,
    notBefore: offline.claims ? new Date(offline.claims.nbf * 1000).toISOString() : null,
    expiresAt: offline.claims ? new Date(offline.claims.exp * 1000).toISOString() : null,
    introspectionCache: {
      checkedAt: introspection.checked_at,
      active: false,
    },
    replayKey: replayKeyFromOffline(input, offline),
    replaySubjectKind: replaySubjectKindFromOffline(input, offline),
    replayLedgerEntry: input.replayLedgerEntry,
    nonce: nonceFromOffline(offline),
    nonceLedgerEntry: input.nonceLedgerEntry,
  });
}

function finalVerificationMode(
  onlineChecked: boolean,
  offline: OfflineReleaseVerification,
): EnforcementVerificationMode {
  if (!onlineChecked) {
    return 'offline-signature';
  }

  return offline.profile.verificationModes.includes('hybrid-required')
    ? 'hybrid-required'
    : 'online-introspection';
}

function createFinalVerificationResult(input: {
  readonly verifierInput: OnlineReleaseVerificationInput;
  readonly offline: OfflineReleaseVerification;
  readonly checkedAt: string;
  readonly onlineChecked: boolean;
  readonly valid: boolean;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly freshness: ReleaseFreshnessEvaluation | null;
  readonly introspectionSnapshot: IntrospectionSnapshot | null;
}): VerificationResult {
  return createVerificationResult({
    id:
      input.verifierInput.verificationResultId ??
      `vr_online_${input.verifierInput.request.id}`,
    checkedAt: input.checkedAt,
    mode: finalVerificationMode(input.onlineChecked, input.offline),
    status: input.valid ? 'valid' : 'invalid',
    cacheState: input.freshness?.cacheState ?? input.offline.verificationResult.cacheState,
    degradedState:
      input.freshness?.degradedState ?? input.offline.verificationResult.degradedState,
    presentation: input.verifierInput.presentation,
    releaseDecisionId:
      input.offline.claims?.decision_id ??
      input.verifierInput.request.releaseDecisionId,
    outputHash:
      input.offline.claims?.output_hash ??
      input.offline.verificationResult.outputHash,
    consequenceHash:
      input.offline.claims?.consequence_hash ??
      input.offline.verificationResult.consequenceHash,
    failureReasons: input.failureReasons,
    introspection: input.introspectionSnapshot,
  });
}

async function introspectOnline(
  input: OnlineReleaseVerificationInput,
): Promise<ReleaseTokenIntrospectionResult> {
  if (!input.introspector) {
    throw new Error('Release enforcement-plane online verifier requires an introspector for online-required release authorization.');
  }

  const token = input.presentation.releaseToken;
  if (token === null) {
    throw new Error('Release enforcement-plane online verifier cannot introspect a missing release token.');
  }

  return input.introspector.introspect({
    token,
    verificationKey: input.verificationKey,
    audience: expectedAudience(input),
    currentDate: input.now,
    tokenTypeHint: input.tokenTypeHint ?? DEFAULT_RELEASE_TOKEN_TYPE_HINT,
    resourceServerId: expectedResourceServerId(input),
  });
}

export async function verifyOnlineReleaseAuthorization(
  input: OnlineReleaseVerificationInput,
): Promise<OnlineReleaseVerification> {
  const checkedAt = normalizeIsoTimestamp(input.now, 'now');
  const offline = await verifyOfflineReleaseAuthorization(input);

  if (offline.status === 'invalid') {
    const failureReasons = uniqueFailureReasons(offline.failureReasons);
    const verificationResult = createFinalVerificationResult({
      verifierInput: input,
      offline,
      checkedAt,
      onlineChecked: false,
      valid: false,
      failureReasons,
      freshness: offline.freshness,
      introspectionSnapshot: null,
    });

    return Object.freeze({
      version: ONLINE_RELEASE_VERIFIER_SPEC_VERSION,
      offlineVerifierVersion: OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
      status: 'invalid',
      checkedAt,
      onlineChecked: false,
      active: null,
      introspection: null,
      introspectionSnapshot: null,
      freshness: offline.freshness,
      verificationResult,
      offline,
      consumed: false,
      useCount: null,
      maxUses: null,
      failureReasons,
    });
  }

  const onlineRequired =
    input.forceOnlineIntrospection === true || offline.requiresOnlineIntrospection;
  if (!onlineRequired) {
    const verificationResult = createFinalVerificationResult({
      verifierInput: input,
      offline,
      checkedAt,
      onlineChecked: false,
      valid: true,
      failureReasons: [],
      freshness: offline.freshness,
      introspectionSnapshot: null,
    });

    return Object.freeze({
      version: ONLINE_RELEASE_VERIFIER_SPEC_VERSION,
      offlineVerifierVersion: OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
      status: 'valid',
      checkedAt,
      onlineChecked: false,
      active: null,
      introspection: null,
      introspectionSnapshot: null,
      freshness: offline.freshness,
      verificationResult,
      offline,
      consumed: false,
      useCount: null,
      maxUses: null,
      failureReasons: [],
    });
  }

  let introspection: ReleaseTokenIntrospectionResult;
  try {
    introspection = await introspectOnline(input);
  } catch {
    const failureReasons = uniqueFailureReasons(['introspection-unavailable']);
    const freshness = offline.freshness;
    const verificationResult = createFinalVerificationResult({
      verifierInput: input,
      offline,
      checkedAt,
      onlineChecked: true,
      valid: false,
      failureReasons,
      freshness,
      introspectionSnapshot: null,
    });

    return Object.freeze({
      version: ONLINE_RELEASE_VERIFIER_SPEC_VERSION,
      offlineVerifierVersion: OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
      status: 'invalid',
      checkedAt,
      onlineChecked: true,
      active: null,
      introspection: null,
      introspectionSnapshot: null,
      freshness,
      verificationResult,
      offline,
      consumed: false,
      useCount: null,
      maxUses: null,
      failureReasons,
    });
  }

  const introspectionSnapshot = snapshotFromIntrospection(introspection);
  if (!introspection.active) {
    const freshness = freshnessFromInactiveIntrospection(input, offline, introspection, checkedAt);
    const failureReasons = uniqueFailureReasons([
      ...inactiveReasonFailureReasons(introspection.inactive_reason),
      ...freshness.failureReasons,
    ]);
    const verificationResult = createFinalVerificationResult({
      verifierInput: input,
      offline,
      checkedAt,
      onlineChecked: true,
      valid: false,
      failureReasons,
      freshness,
      introspectionSnapshot,
    });

    return Object.freeze({
      version: ONLINE_RELEASE_VERIFIER_SPEC_VERSION,
      offlineVerifierVersion: OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
      status: 'invalid',
      checkedAt,
      onlineChecked: true,
      active: false,
      introspection,
      introspectionSnapshot,
      freshness,
      verificationResult,
      offline,
      consumed: false,
      useCount: null,
      maxUses: null,
      failureReasons,
    });
  }

  const freshness = freshnessFromActiveIntrospection(input, offline, introspection, checkedAt);
  const activeMismatch = activeIntrospectionClaimMismatch(offline, introspection);
  let consumed = false;
  let useCount: number | null = null;
  let maxUses: number | null = null;
  const usageFailures: EnforcementFailureReason[] = [];

  if (input.consumeOnSuccess) {
    if (!input.usageStore || !offline.claims) {
      usageFailures.push('introspection-unavailable');
    } else {
      const usage = input.usageStore.recordTokenUse({
        tokenId: offline.claims.jti,
        usedAt: checkedAt,
        resourceServerId: expectedResourceServerId(input),
      });
      if (!usage.accepted || !usage.record) {
        usageFailures.push(
          ...inactiveReasonFailureReasons(usage.inactiveReason ?? 'invalid'),
        );
      } else {
        consumed = true;
        useCount = usage.record.useCount;
        maxUses = usage.record.maxUses;
      }
    }
  }

  const failureReasons = uniqueFailureReasons([
    ...(freshness.status === 'invalid' ? freshness.failureReasons : []),
    ...(activeMismatch ? ['introspection-claim-mismatch' as const, 'binding-mismatch' as const] : []),
    ...usageFailures,
  ]);
  const valid = failureReasons.length === 0;
  const verificationResult = createFinalVerificationResult({
    verifierInput: input,
    offline,
    checkedAt,
    onlineChecked: true,
    valid,
    failureReasons,
    freshness,
    introspectionSnapshot,
  });

  return Object.freeze({
    version: ONLINE_RELEASE_VERIFIER_SPEC_VERSION,
    offlineVerifierVersion: OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
    status: valid ? 'valid' : 'invalid',
    checkedAt,
    onlineChecked: true,
    active: true,
    introspection,
    introspectionSnapshot,
    freshness,
    verificationResult,
    offline,
    consumed,
    useCount,
    maxUses,
    failureReasons,
  });
}
