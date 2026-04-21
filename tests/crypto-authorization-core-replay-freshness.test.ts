import { strict as assert } from 'node:assert';
import {
  CRYPTO_FRESHNESS_BASELINES,
  CRYPTO_FRESHNESS_REASON_CODES,
  CRYPTO_FRESHNESS_STATUSES,
  CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION,
  CRYPTO_REPLAY_KEY_KINDS,
  CRYPTO_REVOCATION_SOURCE_KINDS,
  CRYPTO_REVOCATION_STATUSES,
  createCryptoReplayFreshnessRules,
  cryptoReplayFreshnessRulesDescriptor,
  cryptoReplayFreshnessRulesLabel,
  evaluateCryptoAdapterNonce,
  evaluateCryptoAuthorizationFreshness,
  evaluateCryptoReplayLedger,
  evaluateCryptoRevocation,
  evaluateCryptoValidityWindow,
  isCryptoFreshnessStatus,
  isCryptoReplayKeyKind,
  isCryptoRevocationStatus,
  type CryptoReplayFreshnessRules,
} from '../src/crypto-authorization-core/replay-freshness-rules.js';
import {
  createCryptoEip712AuthorizationEnvelope,
} from '../src/crypto-authorization-core/eip712-authorization-envelope.js';
import {
  CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
  createCryptoAuthorizationActor,
  createCryptoAuthorizationConstraints,
  createCryptoAuthorizationDecision,
  createCryptoAuthorizationIntent,
  createCryptoAuthorizationPolicyScope,
  createCryptoExecutionTarget,
  createCryptoSignerAuthority,
  type CryptoAuthorizationDecision,
  type CryptoReplayProtectionMode,
} from '../src/crypto-authorization-core/object-model.js';
import {
  createCryptoCanonicalAssetReference,
  createCryptoCanonicalCounterpartyReference,
  createCryptoCanonicalReferenceBundle,
} from '../src/crypto-authorization-core/canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
} from '../src/crypto-authorization-core/consequence-risk-mapping.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';

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

function fixtureChain() {
  return createCryptoChainReference({
    namespace: 'eip155',
    chainId: '1',
  });
}

function fixtureAccount(accountKind = 'safe' as const) {
  return createCryptoAccountReference({
    accountKind,
    chain: fixtureChain(),
    address: ACCOUNT_ADDRESS,
    accountLabel: 'Treasury Account',
  });
}

function fixtureAsset() {
  return createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain: fixtureChain(),
    assetId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    decimals: 6,
  });
}

function fixtureParts(
  replayProtectionMode: CryptoReplayProtectionMode = 'nonce',
  accountKind: 'safe' | 'erc-4337-smart-account' = 'safe',
) {
  const chain = fixtureChain();
  const account = fixtureAccount(accountKind);
  const asset = fixtureAsset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:treasury',
    authorityRef: 'authority:treasury-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'bridge',
    chain,
    targetId: 'bridge:canonical-usdc',
    address: '0x2222222222222222222222222222222222222222',
    counterparty: 'bridge:canonical-usdc',
    protocol: 'bridge-protocol',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-bridge',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: [
      'chain',
      'account',
      'asset',
      'counterparty',
      'amount',
      'protocol',
      'risk-tier',
      'approval-quorum',
      'runtime-context',
    ],
    environment: 'prod',
    tenantId: 'tenant-1',
    policyPackRef: 'policy-pack:crypto:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T08:00:00.000Z',
    validUntil: '2026-04-21T08:05:00.000Z',
    nonce: 'bridge:nonce:7',
    replayProtectionMode,
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    maxAmount: '250000.00',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-freshness-001',
    requestedAt: '2026-04-21T08:00:01.000Z',
    requester,
    account,
    consequenceKind: 'bridge',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind:
      replayProtectionMode === 'user-operation-nonce'
        ? 'erc-4337-user-operation'
        : replayProtectionMode === 'authorization-list-nonce'
          ? 'eip-7702-delegation'
          : 'safe-guard',
    evidenceRefs: ['evidence:release:001', 'policy:activation:001'],
  });
  const counterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'bridge',
    counterpartyId: 'bridge:canonical-usdc',
    chain,
  });
  const canonicalAsset = createCryptoCanonicalAssetReference({
    asset,
    assetNamespace: 'erc20',
  });
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain,
    account,
    asset: canonicalAsset,
    counterparty,
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'bridge',
    account,
    asset,
    amount: {
      assetAmount: '250000.00',
      normalizedUsd: '250000.00',
    },
    counterparty,
    context: {
      signals: ['cross-chain'],
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'smart-account',
    authorityId: 'safe:treasury',
    validationMode: 'erc-1271-contract',
    address: ACCOUNT_ADDRESS,
  });
  const decision = createCryptoAuthorizationDecision({
    decisionId: 'decision-freshness-001',
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    reasonCodes: ['policy-allow', 'bridge-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: 'envelope-freshness-001',
    receiptId: 'receipt-freshness-001',
    intent,
    decision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: VERIFYING_CONTRACT,
  });

  return { intent, decision, envelope };
}

function fixtureRules(
  replayProtectionMode: CryptoReplayProtectionMode = 'nonce',
): CryptoReplayFreshnessRules {
  const parts = fixtureParts(replayProtectionMode);
  return createCryptoReplayFreshnessRules(parts);
}

function activeRevocationObservation(rules: CryptoReplayFreshnessRules) {
  return {
    revocationKey: rules.revocation.revocationKey,
    status: 'active' as const,
    checkedAtEpochSeconds: 1776758450,
  };
}

function testDescriptorAndGuards(): void {
  const descriptor = cryptoReplayFreshnessRulesDescriptor();

  equal(descriptor.version, CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION, 'Crypto replay freshness: descriptor exposes version');
  deepEqual(descriptor.replayKeyKinds, CRYPTO_REPLAY_KEY_KINDS, 'Crypto replay freshness: descriptor exposes replay key kinds');
  deepEqual(descriptor.revocationSourceKinds, CRYPTO_REVOCATION_SOURCE_KINDS, 'Crypto replay freshness: descriptor exposes revocation sources');
  deepEqual(descriptor.revocationStatuses, CRYPTO_REVOCATION_STATUSES, 'Crypto replay freshness: descriptor exposes revocation statuses');
  deepEqual(descriptor.freshnessStatuses, CRYPTO_FRESHNESS_STATUSES, 'Crypto replay freshness: descriptor exposes freshness statuses');
  deepEqual(descriptor.reasonCodes, CRYPTO_FRESHNESS_REASON_CODES, 'Crypto replay freshness: descriptor exposes reason codes');
  ok(descriptor.standards.includes('EIP-712'), 'Crypto replay freshness: descriptor names EIP-712');
  ok(descriptor.standards.includes('ERC-4337-ready'), 'Crypto replay freshness: descriptor names ERC-4337 readiness');
  ok(descriptor.standards.includes('ERC-7715-ready'), 'Crypto replay freshness: descriptor names ERC-7715 readiness');
  ok(descriptor.standards.includes('EIP-7702-ready'), 'Crypto replay freshness: descriptor names EIP-7702 readiness');
  ok(isCryptoReplayKeyKind('user-operation-nonce'), 'Crypto replay freshness: replay key guard accepts user-operation nonce');
  ok(!isCryptoReplayKeyKind('other'), 'Crypto replay freshness: replay key guard rejects unknown value');
  ok(isCryptoRevocationStatus('revoked'), 'Crypto replay freshness: revocation status guard accepts revoked');
  ok(!isCryptoRevocationStatus('paused'), 'Crypto replay freshness: revocation status guard rejects unknown value');
  ok(isCryptoFreshnessStatus('fresh'), 'Crypto replay freshness: status guard accepts fresh');
  ok(!isCryptoFreshnessStatus('maybe'), 'Crypto replay freshness: status guard rejects unknown value');
}

function testRuleCreation(): void {
  const rules = fixtureRules();
  const second = fixtureRules();

  equal(rules.version, CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION, 'Crypto replay freshness: rules carry version');
  equal(rules.envelopeId, 'envelope-freshness-001', 'Crypto replay freshness: rules bind envelope id');
  equal(rules.intentId, 'intent-freshness-001', 'Crypto replay freshness: rules bind intent id');
  equal(rules.decisionId, 'decision-freshness-001', 'Crypto replay freshness: rules bind decision id');
  equal(rules.chainId, 'eip155:1', 'Crypto replay freshness: rules bind chain');
  equal(rules.accountAddress, ACCOUNT_ADDRESS, 'Crypto replay freshness: rules bind account');
  equal(rules.signerAddress, ACCOUNT_ADDRESS, 'Crypto replay freshness: rules bind signer');
  equal(rules.domainVerifyingContract, VERIFYING_CONTRACT, 'Crypto replay freshness: rules bind domain verifying contract');
  equal(rules.consequenceKind, 'bridge', 'Crypto replay freshness: rules bind consequence');
  equal(rules.riskClass, 'R4', 'Crypto replay freshness: rules bind risk class');
  equal(rules.validityWindow.validAfterEpochSeconds, 1776758400, 'Crypto replay freshness: validAfter is projected');
  equal(rules.validityWindow.validUntilEpochSeconds, 1776758700, 'Crypto replay freshness: validUntil is projected');
  equal(rules.validityWindow.issuedAtEpochSeconds, 1776758402, 'Crypto replay freshness: issuedAt comes from decision time');
  equal(rules.validityWindow.clockSkewSeconds, 15, 'Crypto replay freshness: R4 skew is strict');
  equal(rules.validityWindow.maxAuthorizationAgeSeconds, 120, 'Crypto replay freshness: R4 max age is strict');
  equal(rules.validityWindow.maxAgeExpiresAtEpochSeconds, 1776758522, 'Crypto replay freshness: max age deadline is exposed');
  equal(rules.validityWindow.effectiveExpiresAtEpochSeconds, 1776758522, 'Crypto replay freshness: effective expiry is min of exp and max age');
  equal(rules.replayLedger.mode, 'nonce', 'Crypto replay freshness: replay mode is carried');
  equal(rules.replayLedger.keyKind, 'nonce', 'Crypto replay freshness: nonce mode maps to nonce key');
  ok(rules.replayLedger.ledgerKey.startsWith('sha256:'), 'Crypto replay freshness: ledger key is digest');
  equal(rules.replayLedger.partitionKey, `crypto-replay:eip155:1:${ACCOUNT_ADDRESS}:nonce`, 'Crypto replay freshness: replay partition is stable');
  equal(rules.replayLedger.storeUntilEpochSeconds, 1776758820, 'Crypto replay freshness: ledger retention extends past expiry');
  equal(rules.replayLedger.consumeOnAllow, true, 'Crypto replay freshness: nonce mode consumes on allow');
  equal(rules.replayLedger.requiresLedger, true, 'Crypto replay freshness: replay ledger is required');
  equal(rules.replayLedger.chainAuthoritative, false, 'Crypto replay freshness: plain nonce is not chain authoritative');
  equal(rules.revocation.required, false, 'Crypto replay freshness: bridge does not require revocation by consequence');
  equal(rules.revocation.onlineCheckRequired, true, 'Crypto replay freshness: R4 still requires online liveness');
  equal(rules.revocation.failClosedOnUnknown, true, 'Crypto replay freshness: online liveness fails closed');
  equal(rules.revocation.maxStatusAgeSeconds, 30, 'Crypto replay freshness: R4 revocation status age is strict');
  equal(rules.adapterNonce.required, false, 'Crypto replay freshness: plain nonce does not require adapter nonce observation');
  ok(rules.requiredChecks.includes('valid-until-enforced'), 'Crypto replay freshness: expiry check is required');
  ok(rules.requiredChecks.includes('replay-ledger-checked'), 'Crypto replay freshness: replay ledger check is required');
  ok(rules.requiredChecks.includes('consume-on-allow'), 'Crypto replay freshness: consume-on-allow check is required');
  equal(rules.digest, second.digest, 'Crypto replay freshness: rules digest is deterministic');
  equal(
    cryptoReplayFreshnessRulesLabel(rules),
    `freshness:envelope-freshness-001 / chain:eip155:1 / account:${ACCOUNT_ADDRESS} / risk:R4 / replay:nonce / nonce:nonce`,
    'Crypto replay freshness: label is stable',
  );
}

function testReplayModeMappings(): void {
  const oneTime = fixtureRules('one-time-receipt');
  const sessionA = createCryptoReplayFreshnessRules({
    ...fixtureParts('session-budget'),
    permissionContext: 'permission-context:alpha',
  });
  const sessionB = createCryptoReplayFreshnessRules({
    ...fixtureParts('session-budget'),
    permissionContext: 'permission-context:beta',
  });
  const idempotent = createCryptoReplayFreshnessRules({
    ...fixtureParts('idempotency-key'),
    idempotencyKey: 'idempotency:payment:1',
  });
  const userOp = createCryptoReplayFreshnessRules(fixtureParts('user-operation-nonce', 'erc-4337-smart-account'));
  const authList = fixtureRules('authorization-list-nonce');

  equal(oneTime.replayLedger.keyKind, 'authorization-digest', 'Crypto replay freshness: one-time receipt maps to authorization digest');
  equal(oneTime.replayLedger.consumeOnAllow, true, 'Crypto replay freshness: one-time receipt consumes on allow');
  equal(sessionA.replayLedger.keyKind, 'permission-context', 'Crypto replay freshness: session budget maps to permission context');
  equal(sessionA.revocation.required, true, 'Crypto replay freshness: session budget requires revocation/liveness');
  ok(sessionA.requiredChecks.includes('budget-session-liveness-checked'), 'Crypto replay freshness: session budget liveness check is listed');
  ok(sessionA.replayLedger.ledgerKey !== sessionB.replayLedger.ledgerKey, 'Crypto replay freshness: permission context affects ledger key');
  equal(idempotent.replayLedger.keyKind, 'idempotency-key', 'Crypto replay freshness: idempotency mode maps to idempotency key');
  equal(userOp.replayLedger.keyKind, 'user-operation-nonce', 'Crypto replay freshness: user-operation mode maps to UserOperation nonce');
  equal(userOp.replayLedger.chainAuthoritative, true, 'Crypto replay freshness: UserOperation nonce is chain authoritative');
  equal(userOp.adapterNonce.required, true, 'Crypto replay freshness: UserOperation nonce requires adapter observation');
  equal(userOp.adapterNonce.sourceKind, 'entrypoint-nonce-state', 'Crypto replay freshness: UserOperation source is EntryPoint nonce state');
  ok(userOp.requiredChecks.includes('adapter-nonce-state-checked'), 'Crypto replay freshness: adapter nonce check is listed');
  equal(authList.replayLedger.keyKind, 'authorization-list-nonce', 'Crypto replay freshness: authorization-list mode maps to authorization-list nonce');
  equal(authList.adapterNonce.sourceKind, 'eip-7702-authority-nonce', 'Crypto replay freshness: authorization-list source is EIP-7702 authority nonce');
}

function testValidityWindowEvaluation(): void {
  const rules = fixtureRules();

  const fresh = evaluateCryptoValidityWindow({
    rules,
    nowEpochSeconds: 1776758460,
  });
  const notYetValid = evaluateCryptoValidityWindow({
    rules,
    nowEpochSeconds: 1776758384,
  });
  const stale = evaluateCryptoValidityWindow({
    rules,
    nowEpochSeconds: 1776758538,
  });
  const expired = evaluateCryptoValidityWindow({
    rules,
    nowEpochSeconds: 1776758716,
  });

  equal(fresh.status, 'valid', 'Crypto replay freshness: valid window accepts current authorization');
  equal(fresh.accepted, true, 'Crypto replay freshness: valid window accepted flag is true');
  deepEqual(fresh.reasonCodes, ['fresh'], 'Crypto replay freshness: valid window reason is fresh');
  equal(notYetValid.status, 'not-yet-valid', 'Crypto replay freshness: not-before is enforced with skew');
  deepEqual(notYetValid.reasonCodes, ['not-yet-valid'], 'Crypto replay freshness: not-yet-valid reason is explicit');
  equal(stale.status, 'stale', 'Crypto replay freshness: max authorization age is enforced');
  deepEqual(stale.reasonCodes, ['stale-authorization'], 'Crypto replay freshness: stale reason is explicit');
  equal(expired.status, 'expired', 'Crypto replay freshness: validUntil is enforced with skew');
  deepEqual(expired.reasonCodes, ['expired'], 'Crypto replay freshness: expired reason is explicit');
}

function testReplayLedgerEvaluation(): void {
  const rules = fixtureRules();

  const fresh = evaluateCryptoReplayLedger({
    rules,
    nowEpochSeconds: 1776758460,
  });
  const replayed = evaluateCryptoReplayLedger({
    rules,
    nowEpochSeconds: 1776758460,
    ledgerEntry: {
      ledgerKey: rules.replayLedger.ledgerKey,
      firstSeenAtEpochSeconds: 1776758420,
      expiresAtEpochSeconds: 1776758820,
    },
  });
  const expiredEntry = evaluateCryptoReplayLedger({
    rules,
    nowEpochSeconds: 1776758900,
    ledgerEntry: {
      ledgerKey: rules.replayLedger.ledgerKey,
      firstSeenAtEpochSeconds: 1776758420,
      expiresAtEpochSeconds: 1776758820,
    },
  });
  const unavailable = evaluateCryptoReplayLedger({
    rules,
    nowEpochSeconds: 1776758460,
    ledgerAvailable: false,
  });

  equal(fresh.status, 'fresh', 'Crypto replay freshness: absent ledger entry is fresh');
  equal(fresh.accepted, true, 'Crypto replay freshness: absent ledger entry is accepted');
  equal(fresh.storeUntilEpochSeconds, rules.replayLedger.storeUntilEpochSeconds, 'Crypto replay freshness: fresh ledger evaluation exposes store deadline');
  equal(fresh.consumeOnAllow, true, 'Crypto replay freshness: fresh ledger evaluation preserves consume-on-allow');
  equal(replayed.status, 'replayed', 'Crypto replay freshness: ledger hit is replayed');
  equal(replayed.accepted, false, 'Crypto replay freshness: replayed ledger entry is rejected');
  deepEqual(replayed.reasonCodes, ['replay-ledger-hit'], 'Crypto replay freshness: replay reason is explicit');
  equal(expiredEntry.status, 'fresh', 'Crypto replay freshness: expired ledger entry no longer blocks');
  equal(unavailable.status, 'indeterminate', 'Crypto replay freshness: unavailable ledger is indeterminate');
  deepEqual(unavailable.reasonCodes, ['replay-ledger-unavailable'], 'Crypto replay freshness: unavailable ledger reason is explicit');
}

function testRevocationEvaluation(): void {
  const rules = fixtureRules();
  const active = evaluateCryptoRevocation({
    rules,
    nowEpochSeconds: 1776758460,
    observation: activeRevocationObservation(rules),
  });
  const missing = evaluateCryptoRevocation({
    rules,
    nowEpochSeconds: 1776758460,
  });
  const stale = evaluateCryptoRevocation({
    rules,
    nowEpochSeconds: 1776758460,
    observation: {
      ...activeRevocationObservation(rules),
      checkedAtEpochSeconds: 1776758400,
    },
  });
  const revoked = evaluateCryptoRevocation({
    rules,
    nowEpochSeconds: 1776758460,
    observation: {
      ...activeRevocationObservation(rules),
      status: 'revoked',
    },
  });
  const suspended = evaluateCryptoRevocation({
    rules,
    nowEpochSeconds: 1776758460,
    observation: {
      ...activeRevocationObservation(rules),
      status: 'suspended',
    },
  });
  const superseded = evaluateCryptoRevocation({
    rules,
    nowEpochSeconds: 1776758460,
    observation: {
      ...activeRevocationObservation(rules),
      status: 'superseded',
    },
  });
  const unknown = evaluateCryptoRevocation({
    rules,
    nowEpochSeconds: 1776758460,
    observation: {
      ...activeRevocationObservation(rules),
      status: 'unknown',
    },
  });
  const relaxedRules: CryptoReplayFreshnessRules = {
    ...rules,
    revocation: {
      ...rules.revocation,
      required: false,
      onlineCheckRequired: false,
      failClosedOnUnknown: false,
    },
  };
  const notRequired = evaluateCryptoRevocation({
    rules: relaxedRules,
    nowEpochSeconds: 1776758460,
  });

  equal(active.status, 'active', 'Crypto replay freshness: active revocation observation is accepted');
  equal(active.accepted, true, 'Crypto replay freshness: active revocation accepted flag is true');
  equal(missing.status, 'indeterminate', 'Crypto replay freshness: missing online revocation check is indeterminate');
  deepEqual(missing.reasonCodes, ['revocation-check-required'], 'Crypto replay freshness: missing revocation reason is explicit');
  equal(stale.status, 'indeterminate', 'Crypto replay freshness: stale revocation status is indeterminate');
  deepEqual(stale.reasonCodes, ['revocation-status-stale'], 'Crypto replay freshness: stale revocation reason is explicit');
  equal(revoked.status, 'revoked', 'Crypto replay freshness: revoked status blocks');
  deepEqual(revoked.reasonCodes, ['revoked'], 'Crypto replay freshness: revoked reason is explicit');
  equal(suspended.status, 'revoked', 'Crypto replay freshness: suspended status blocks');
  deepEqual(suspended.reasonCodes, ['suspended'], 'Crypto replay freshness: suspended reason is explicit');
  equal(superseded.status, 'revoked', 'Crypto replay freshness: superseded status blocks');
  deepEqual(superseded.reasonCodes, ['superseded'], 'Crypto replay freshness: superseded reason is explicit');
  equal(unknown.status, 'indeterminate', 'Crypto replay freshness: unknown revocation status is indeterminate');
  deepEqual(unknown.reasonCodes, ['revocation-status-unknown'], 'Crypto replay freshness: unknown reason is explicit');
  equal(notRequired.status, 'not-required', 'Crypto replay freshness: non-online, non-revocable plan does not require observation');
}

function testAdapterNonceEvaluation(): void {
  const rules = fixtureRules('user-operation-nonce');
  const notRequired = evaluateCryptoAdapterNonce({
    rules: fixtureRules('nonce'),
  });
  const missing = evaluateCryptoAdapterNonce({ rules });
  const mismatch = evaluateCryptoAdapterNonce({
    rules,
    observation: {
      nonce: 'bridge:nonce:8',
      matchesExpected: false,
      checkedAtEpochSeconds: 1776758460,
      sourceKind: 'entrypoint-nonce-state',
    },
  });
  const wrongSource = evaluateCryptoAdapterNonce({
    rules,
    observation: {
      nonce: 'bridge:nonce:7',
      matchesExpected: true,
      checkedAtEpochSeconds: 1776758460,
      sourceKind: 'eip-7702-authority-nonce',
    },
  });
  const valid = evaluateCryptoAdapterNonce({
    rules,
    observation: {
      nonce: 'bridge:nonce:7',
      matchesExpected: true,
      checkedAtEpochSeconds: 1776758460,
      sourceKind: 'entrypoint-nonce-state',
    },
  });

  equal(notRequired.status, 'not-required', 'Crypto replay freshness: plain nonce needs no adapter nonce');
  equal(missing.status, 'indeterminate', 'Crypto replay freshness: chain-authoritative nonce requires observation');
  deepEqual(missing.reasonCodes, ['adapter-nonce-required'], 'Crypto replay freshness: missing adapter nonce reason is explicit');
  equal(mismatch.status, 'invalid', 'Crypto replay freshness: mismatched adapter nonce is invalid');
  deepEqual(mismatch.reasonCodes, ['adapter-nonce-mismatch'], 'Crypto replay freshness: adapter nonce mismatch reason is explicit');
  equal(wrongSource.status, 'invalid', 'Crypto replay freshness: wrong adapter nonce source is invalid');
  equal(valid.status, 'valid', 'Crypto replay freshness: matching adapter nonce is valid');
  equal(valid.accepted, true, 'Crypto replay freshness: matching adapter nonce accepted flag is true');
}

function testCombinedEvaluation(): void {
  const rules = fixtureRules();
  const userOpRules = fixtureRules('user-operation-nonce');
  const fresh = evaluateCryptoAuthorizationFreshness({
    rules,
    nowEpochSeconds: 1776758460,
    revocationObservation: activeRevocationObservation(rules),
  });
  const missingRevocation = evaluateCryptoAuthorizationFreshness({
    rules,
    nowEpochSeconds: 1776758460,
  });
  const replayed = evaluateCryptoAuthorizationFreshness({
    rules,
    nowEpochSeconds: 1776758460,
    revocationObservation: activeRevocationObservation(rules),
    replayLedgerEntry: {
      ledgerKey: rules.replayLedger.ledgerKey,
      firstSeenAtEpochSeconds: 1776758420,
      expiresAtEpochSeconds: 1776758820,
    },
  });
  const revoked = evaluateCryptoAuthorizationFreshness({
    rules,
    nowEpochSeconds: 1776758460,
    revocationObservation: {
      ...activeRevocationObservation(rules),
      status: 'revoked',
    },
  });
  const expired = evaluateCryptoAuthorizationFreshness({
    rules,
    nowEpochSeconds: 1776758716,
    revocationObservation: activeRevocationObservation(rules),
  });
  const invalidAdapterNonce = evaluateCryptoAuthorizationFreshness({
    rules: userOpRules,
    nowEpochSeconds: 1776758460,
    revocationObservation: activeRevocationObservation(userOpRules),
    adapterNonceObservation: {
      nonce: 'bridge:nonce:8',
      matchesExpected: false,
      checkedAtEpochSeconds: 1776758460,
      sourceKind: 'entrypoint-nonce-state',
    },
  });
  const deterministic = evaluateCryptoAuthorizationFreshness({
    rules,
    nowEpochSeconds: 1776758460,
    revocationObservation: activeRevocationObservation(rules),
  });

  equal(fresh.status, 'fresh', 'Crypto replay freshness: combined evaluation accepts fresh authorization');
  equal(fresh.accepted, true, 'Crypto replay freshness: combined fresh accepted flag is true');
  deepEqual(fresh.reasonCodes, [], 'Crypto replay freshness: combined fresh has no failure reasons');
  equal(missingRevocation.status, 'indeterminate', 'Crypto replay freshness: missing liveness check is indeterminate');
  deepEqual(missingRevocation.reasonCodes, ['revocation-check-required'], 'Crypto replay freshness: missing liveness reason is explicit');
  equal(replayed.status, 'replayed', 'Crypto replay freshness: replay ledger hit dominates combined status');
  ok(replayed.reasonCodes.includes('replay-ledger-hit'), 'Crypto replay freshness: combined replay includes replay reason');
  equal(revoked.status, 'revoked', 'Crypto replay freshness: revoked status dominates combined status');
  ok(revoked.reasonCodes.includes('revoked'), 'Crypto replay freshness: combined revoked includes revoked reason');
  equal(expired.status, 'expired', 'Crypto replay freshness: expired window blocks combined evaluation');
  ok(expired.reasonCodes.includes('expired'), 'Crypto replay freshness: combined expired includes expired reason');
  equal(invalidAdapterNonce.status, 'invalid', 'Crypto replay freshness: invalid adapter nonce dominates combined status');
  ok(invalidAdapterNonce.reasonCodes.includes('adapter-nonce-mismatch'), 'Crypto replay freshness: combined adapter mismatch includes reason');
  equal(fresh.digest, deterministic.digest, 'Crypto replay freshness: combined evaluation digest is deterministic');
}

function testInvalidInputsReject(): void {
  const parts = fixtureParts();
  const badDecision: CryptoAuthorizationDecision = {
    ...parts.decision,
    nonce: 'bridge:nonce:8',
  };

  assert.throws(
    () =>
      createCryptoReplayFreshnessRules({
        ...parts,
        decision: badDecision,
      }),
    /share a nonce/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoReplayFreshnessRules({
        ...parts,
        validationProjection: {
          envelopeId: 'other-envelope',
        } as never,
      }),
    /validation projection must bind/i,
  );
  passed += 1;

  assert.throws(
    () =>
      evaluateCryptoAuthorizationFreshness({
        rules: fixtureRules(),
        nowEpochSeconds: -1,
      }),
    /nowEpochSeconds must be a non-negative integer/i,
  );
  passed += 1;
}

function testBaselines(): void {
  equal(CRYPTO_FRESHNESS_BASELINES.R4.clockSkewSeconds, 15, 'Crypto replay freshness: R4 clock skew is tight');
  equal(CRYPTO_FRESHNESS_BASELINES.R4.maxAuthorizationAgeSeconds, 120, 'Crypto replay freshness: R4 max age is tight');
  equal(CRYPTO_FRESHNESS_BASELINES.R3.maxRevocationStatusAgeSeconds, 60, 'Crypto replay freshness: R3 revocation liveness is bounded');
  equal(CRYPTO_FRESHNESS_BASELINES.R1.replayStoreSeconds, 3600, 'Crypto replay freshness: R1 replay retention is longer');
}

async function main(): Promise<void> {
  testDescriptorAndGuards();
  testRuleCreation();
  testReplayModeMappings();
  testValidityWindowEvaluation();
  testReplayLedgerEvaluation();
  testRevocationEvaluation();
  testAdapterNonceEvaluation();
  testCombinedEvaluation();
  testInvalidInputsReject();
  testBaselines();

  console.log(`\nCrypto authorization core replay freshness tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core replay freshness tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
