import assert from 'node:assert/strict';
import {
  BOUNDARY_FRESHNESS_BASELINES,
  RELEASE_FRESHNESS_RULES_SPEC_VERSION,
  RISK_FRESHNESS_BASELINES,
  evaluateAuthorizationTimeBounds,
  evaluateIntrospectionCache,
  evaluateNonceFreshness,
  evaluateReleaseFreshness,
  evaluateReplayProtection,
  freshnessRulesDescriptor,
  resolveFreshnessRules,
  type FreshnessRules,
} from '../src/release-enforcement-plane/freshness.js';
import { resolveVerificationProfile } from '../src/release-enforcement-plane/verification-profiles.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  passed += 1;
}

function r4RecordRules(): FreshnessRules {
  return resolveFreshnessRules(
    resolveVerificationProfile({
      consequenceType: 'record',
      riskClass: 'R4',
      boundaryKind: 'record-write',
    }),
  );
}

function r3CommunicationRules(): FreshnessRules {
  return resolveFreshnessRules(
    resolveVerificationProfile({
      consequenceType: 'communication',
      riskClass: 'R3',
      boundaryKind: 'communication-send',
    }),
  );
}

function r2HttpRules(): FreshnessRules {
  return resolveFreshnessRules(
    resolveVerificationProfile({
      consequenceType: 'decision-support',
      riskClass: 'R2',
      boundaryKind: 'http-request',
    }),
  );
}

function r1HttpRules(): FreshnessRules {
  return resolveFreshnessRules(
    resolveVerificationProfile({
      consequenceType: 'decision-support',
      riskClass: 'R1',
      boundaryKind: 'http-request',
    }),
  );
}

function testDescriptorAndRuleResolution(): void {
  const descriptor = freshnessRulesDescriptor();
  equal(descriptor.version, RELEASE_FRESHNESS_RULES_SPEC_VERSION, 'Freshness rules: descriptor exposes stable spec version');
  ok(descriptor.riskBaselines.includes('R4'), 'Freshness rules: descriptor exposes R4 baseline');
  ok(descriptor.boundaryBaselines.includes('record-write'), 'Freshness rules: descriptor exposes record-write baseline');
  equal(RISK_FRESHNESS_BASELINES.R4.replayWindowSeconds, 30, 'Freshness rules: R4 replay window is tight');
  equal(BOUNDARY_FRESHNESS_BASELINES['proxy-admission'].clockSkewSeconds, 15, 'Freshness rules: proxy admission has tight clock skew');

  const rules = r4RecordRules();
  equal(rules.version, RELEASE_FRESHNESS_RULES_SPEC_VERSION, 'Freshness rules: resolved rules stamp spec version');
  equal(rules.id, 'freshness-rules:record:R4:record-write', 'Freshness rules: resolved id is deterministic');
  equal(rules.clockSkewSeconds, 15, 'Freshness rules: R4 record-write uses strict clock skew');
  equal(rules.maxTokenAgeSeconds, 120, 'Freshness rules: R4 record-write has short token max age');
  equal(rules.positiveCacheTtlSeconds, 0, 'Freshness rules: R4 record-write disables positive cache');
  equal(rules.negativeCacheTtlSeconds, 0, 'Freshness rules: R4 record-write disables negative cache');
  equal(rules.replayWindowSeconds, 30, 'Freshness rules: R4 record-write has short replay window');
  deepEqual(rules.requireNonceForPresentationModes, ['dpop-bound-token'], 'Freshness rules: R4 record-write requires nonce for DPoP only');
  equal(rules.failClosedWhenStale, true, 'Freshness rules: R4 record-write fails closed when stale');
}

function testLowerRiskHttpRules(): void {
  const rules = r1HttpRules();
  equal(rules.onlineIntrospectionRequired, false, 'Freshness rules: R1 HTTP does not require online introspection');
  equal(rules.positiveCacheTtlSeconds, 60, 'Freshness rules: R1 HTTP inherits boundary positive cache budget');
  equal(rules.staleIfErrorSeconds, 30, 'Freshness rules: R1 HTTP has stale-if-error budget');
  equal(rules.replayProtectionRequired, true, 'Freshness rules: R1 HTTP still requires replay protection');
  deepEqual(rules.requireNonceForPresentationModes, [], 'Freshness rules: R1 HTTP does not require nonces');
}

function testAuthorizationTimeBounds(): void {
  const rules = r4RecordRules();

  const stale = evaluateAuthorizationTimeBounds({
    rules,
    now: '2026-04-18T00:02:31.000Z',
    issuedAt: '2026-04-18T00:00:00.000Z',
    expiresAt: '2026-04-18T00:10:00.000Z',
  });
  equal(stale.status, 'invalid', 'Freshness rules: max token age can invalidate old authorization before exp');
  deepEqual(stale.failureReasons, ['stale-authorization'], 'Freshness rules: stale max-age failure is explicit');
  equal(stale.maxAgeExpiresAt, '2026-04-18T00:02:00.000Z', 'Freshness rules: max-age expiry is exposed');

  const expired = evaluateAuthorizationTimeBounds({
    rules,
    now: '2026-04-18T00:01:00.000Z',
    expiresAt: '2026-04-18T00:00:40.000Z',
  });
  deepEqual(expired.failureReasons, ['expired-authorization'], 'Freshness rules: expired authorization is rejected beyond skew');

  const notYetValid = evaluateAuthorizationTimeBounds({
    rules,
    now: '2026-04-18T00:00:00.000Z',
    notBefore: '2026-04-18T00:00:31.000Z',
  });
  deepEqual(notYetValid.failureReasons, ['not-yet-valid-authorization'], 'Freshness rules: not-before claims are enforced');

  const futureIssued = evaluateAuthorizationTimeBounds({
    rules,
    now: '2026-04-18T00:00:00.000Z',
    issuedAt: '2026-04-18T00:00:20.000Z',
  });
  deepEqual(futureIssued.failureReasons, ['future-issued-at'], 'Freshness rules: future issued-at claims are enforced');
}

function testIntrospectionCacheRules(): void {
  const r2Http = r2HttpRules();
  const staleAllowed = evaluateIntrospectionCache({
    rules: r2Http,
    now: '2026-04-18T00:01:10.000Z',
    cache: {
      checkedAt: '2026-04-18T00:00:00.000Z',
      active: true,
    },
    introspectionError: true,
  });
  equal(staleAllowed.status, 'stale-allowed', 'Freshness rules: stale-if-error can allow bounded stale positive cache');
  equal(staleAllowed.cacheState, 'stale-allowed', 'Freshness rules: stale-if-error maps to cache state');
  equal(staleAllowed.staleIfErrorUntil, '2026-04-18T00:01:30.000Z', 'Freshness rules: stale-if-error deadline is explicit');

  const staleDenied = evaluateIntrospectionCache({
    rules: r2Http,
    now: '2026-04-18T00:01:10.000Z',
    cache: {
      checkedAt: '2026-04-18T00:00:00.000Z',
      active: true,
    },
  });
  equal(staleDenied.status, 'stale-denied', 'Freshness rules: stale positive cache is denied without an introspection error path');
  ok(staleDenied.failureReasons.includes('fresh-introspection-required'), 'Freshness rules: stale online-required cache asks for fresh introspection');

  const r4Record = r4RecordRules();
  const liveOnly = evaluateIntrospectionCache({
    rules: r4Record,
    now: '2026-04-18T00:00:01.000Z',
    cache: {
      checkedAt: '2026-04-18T00:00:00.000Z',
      active: true,
    },
    introspectionError: true,
  });
  equal(liveOnly.status, 'stale-denied', 'Freshness rules: R4 zero-cache posture denies one-second-old introspection');
  ok(liveOnly.failureReasons.includes('introspection-unavailable'), 'Freshness rules: failed live check records introspection unavailable');

  const negativeHit = evaluateIntrospectionCache({
    rules: r2Http,
    now: '2026-04-18T00:00:05.000Z',
    cache: {
      checkedAt: '2026-04-18T00:00:00.000Z',
      active: false,
    },
  });
  equal(negativeHit.status, 'negative-hit', 'Freshness rules: fresh inactive cache is authoritative');
  deepEqual(negativeHit.failureReasons, ['negative-cache-hit'], 'Freshness rules: negative cache hit is explicit');

  const tokenExpiryCapsCache = evaluateIntrospectionCache({
    rules: r1HttpRules(),
    now: '2026-04-18T00:00:25.000Z',
    cache: {
      checkedAt: '2026-04-18T00:00:00.000Z',
      active: true,
      tokenExpiresAt: '2026-04-18T00:00:20.000Z',
    },
  });
  equal(tokenExpiryCapsCache.status, 'stale-denied', 'Freshness rules: introspection cache never extends beyond token expiry');
  equal(tokenExpiryCapsCache.freshUntil, '2026-04-18T00:00:20.000Z', 'Freshness rules: effective cache deadline is capped by exp');
}

function testReplayProtectionRules(): void {
  const rules = r1HttpRules();

  const missingKey = evaluateReplayProtection({
    rules,
    now: '2026-04-18T00:00:00.000Z',
  });
  equal(missingKey.status, 'missing-key', 'Freshness rules: replay-required profile rejects missing replay key');
  deepEqual(missingKey.failureReasons, ['missing-replay-proof'], 'Freshness rules: missing replay key has explicit reason');

  const replayed = evaluateReplayProtection({
    rules,
    now: '2026-04-18T00:00:30.000Z',
    replayKey: 'proof:jti-1',
    subjectKind: 'dpop-proof',
    ledgerEntry: {
      subjectKind: 'dpop-proof',
      key: 'proof:jti-1',
      firstSeenAt: '2026-04-18T00:00:00.000Z',
      expiresAt: '2026-04-18T00:02:00.000Z',
    },
  });
  equal(replayed.status, 'replayed', 'Freshness rules: ledger hit inside window is replayed');
  deepEqual(replayed.failureReasons, ['replayed-authorization'], 'Freshness rules: replayed authorization reason is explicit');

  const freshAfterExpiry = evaluateReplayProtection({
    rules,
    now: '2026-04-18T00:03:01.000Z',
    replayKey: 'proof:jti-1',
    subjectKind: 'dpop-proof',
    ledgerEntry: {
      subjectKind: 'dpop-proof',
      key: 'proof:jti-1',
      firstSeenAt: '2026-04-18T00:00:00.000Z',
      expiresAt: '2026-04-18T00:02:00.000Z',
    },
  });
  equal(freshAfterExpiry.status, 'fresh', 'Freshness rules: expired replay ledger entries can be replaced');
  equal(freshAfterExpiry.storeUntil, '2026-04-18T00:05:01.000Z', 'Freshness rules: fresh replay key exposes new store deadline');

  const noReplayProfile = resolveFreshnessRules(
    resolveVerificationProfile({
      consequenceType: 'record',
      riskClass: 'R0',
      boundaryKind: 'artifact-export',
    }),
  );
  const notRequired = evaluateReplayProtection({
    rules: noReplayProfile,
    now: '2026-04-18T00:00:00.000Z',
  });
  equal(notRequired.status, 'not-required', 'Freshness rules: R0 artifact export does not require replay ledger');
}

function testNonceRules(): void {
  const rules = r3CommunicationRules();

  const missing = evaluateNonceFreshness({
    rules,
    now: '2026-04-18T00:00:00.000Z',
    presentationMode: 'dpop-bound-token',
  });
  equal(missing.status, 'missing', 'Freshness rules: high-risk DPoP presentation requires nonce');
  deepEqual(missing.failureReasons, ['missing-nonce'], 'Freshness rules: missing nonce has explicit reason');

  const valid = evaluateNonceFreshness({
    rules,
    now: '2026-04-18T00:00:20.000Z',
    presentationMode: 'dpop-bound-token',
    nonce: 'nonce-1',
    ledgerEntry: {
      nonce: 'nonce-1',
      issuedAt: '2026-04-18T00:00:00.000Z',
      expiresAt: '2026-04-18T00:01:00.000Z',
    },
  });
  equal(valid.status, 'valid', 'Freshness rules: unused nonce inside window is valid');
  equal(valid.consumeOnAllow, true, 'Freshness rules: valid nonce is marked for consumption on allow');

  const consumed = evaluateNonceFreshness({
    rules,
    now: '2026-04-18T00:00:20.000Z',
    presentationMode: 'dpop-bound-token',
    nonce: 'nonce-1',
    ledgerEntry: {
      nonce: 'nonce-1',
      issuedAt: '2026-04-18T00:00:00.000Z',
      expiresAt: '2026-04-18T00:01:00.000Z',
      consumedAt: '2026-04-18T00:00:10.000Z',
    },
  });
  equal(consumed.status, 'consumed', 'Freshness rules: consumed nonce cannot be reused');
  deepEqual(consumed.failureReasons, ['invalid-nonce'], 'Freshness rules: consumed nonce maps to invalid nonce');

  const expired = evaluateNonceFreshness({
    rules,
    now: '2026-04-18T00:01:31.000Z',
    presentationMode: 'dpop-bound-token',
    nonce: 'nonce-1',
    ledgerEntry: {
      nonce: 'nonce-1',
      issuedAt: '2026-04-18T00:00:00.000Z',
      expiresAt: '2026-04-18T00:01:00.000Z',
    },
  });
  equal(expired.status, 'expired', 'Freshness rules: nonce expires beyond skew-adjusted window');

  const mtlsNoNonce = evaluateNonceFreshness({
    rules: r4RecordRules(),
    now: '2026-04-18T00:00:00.000Z',
    presentationMode: 'mtls-bound-token',
  });
  equal(mtlsNoNonce.status, 'not-required', 'Freshness rules: mTLS-bound presentation does not require nonce');
}

function testCombinedFreshnessEvaluation(): void {
  const staleAllowed = evaluateReleaseFreshness({
    rules: r2HttpRules(),
    now: '2026-04-18T00:01:10.000Z',
    presentationMode: 'bearer-release-token',
    issuedAt: '2026-04-18T00:00:00.000Z',
    expiresAt: '2026-04-18T00:10:00.000Z',
    introspectionCache: {
      checkedAt: '2026-04-18T00:00:00.000Z',
      active: true,
    },
    introspectionError: true,
    replayKey: 'release-token:token-1',
    replaySubjectKind: 'release-token',
  });
  equal(staleAllowed.status, 'stale-allowed', 'Freshness rules: combined evaluator can return bounded stale allow');
  equal(staleAllowed.cacheState, 'stale-allowed', 'Freshness rules: combined stale allow preserves cache state');
  equal(staleAllowed.degradedState, 'cache-only', 'Freshness rules: combined stale allow marks cache-only degraded state');
  deepEqual(staleAllowed.failureReasons, [], 'Freshness rules: bounded stale allow has no failure reason');

  const hardFailure = evaluateReleaseFreshness({
    rules: r4RecordRules(),
    now: '2026-04-18T00:02:31.000Z',
    presentationMode: 'dpop-bound-token',
    issuedAt: '2026-04-18T00:00:00.000Z',
    expiresAt: '2026-04-18T00:10:00.000Z',
  });
  equal(hardFailure.status, 'invalid', 'Freshness rules: combined evaluator rejects hard freshness failures');
  equal(hardFailure.degradedState, 'fail-closed', 'Freshness rules: hard freshness failure is fail-closed');
  ok(hardFailure.failureReasons.includes('stale-authorization'), 'Freshness rules: combined failure includes stale authorization');
  ok(hardFailure.failureReasons.includes('fresh-introspection-required'), 'Freshness rules: combined failure includes fresh introspection requirement');
  ok(hardFailure.failureReasons.includes('missing-replay-proof'), 'Freshness rules: combined failure includes missing replay proof');
  ok(hardFailure.failureReasons.includes('missing-nonce'), 'Freshness rules: combined failure includes missing nonce');

  const negative = evaluateReleaseFreshness({
    rules: r2HttpRules(),
    now: '2026-04-18T00:00:05.000Z',
    presentationMode: 'bearer-release-token',
    issuedAt: '2026-04-18T00:00:00.000Z',
    expiresAt: '2026-04-18T00:10:00.000Z',
    introspectionCache: {
      checkedAt: '2026-04-18T00:00:00.000Z',
      active: false,
    },
    replayKey: 'release-token:token-1',
    replaySubjectKind: 'release-token',
  });
  equal(negative.status, 'invalid', 'Freshness rules: combined evaluator rejects fresh negative cache');
  equal(negative.cacheState, 'negative-hit', 'Freshness rules: combined negative cache preserves cache state');
  deepEqual(negative.failureReasons, ['negative-cache-hit'], 'Freshness rules: combined negative cache exposes explicit reason');
}

testDescriptorAndRuleResolution();
testLowerRiskHttpRules();
testAuthorizationTimeBounds();
testIntrospectionCacheRules();
testReplayProtectionRules();
testNonceRules();
testCombinedFreshnessEvaluation();

console.log(`Release enforcement-plane freshness tests: ${passed} passed, 0 failed`);
