import assert from 'node:assert/strict';
import {
  SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION,
  SAFE_TRANSACTION_GUARD_CHECKS,
  SAFE_TRANSACTION_GUARD_OUTCOMES,
  createSafeTransactionGuardPreflight,
  safeTransactionGuardAdapterDescriptor,
  safeTransactionGuardPreflightLabel,
  simulateSafeTransactionGuardAuthorization,
  type SafeTransactionGuardTransaction,
} from '../src/crypto-authorization-core/safe-transaction-guard-adapter.js';
import {
  createCryptoEnforcementVerificationBinding,
  type CryptoEnforcementVerificationBinding,
} from '../src/crypto-authorization-core/enforcement-plane-verification.js';
import {
  createCryptoPolicyControlPlaneScopeBinding,
  type CryptoPolicyControlPlaneScopeBinding,
} from '../src/crypto-authorization-core/policy-control-plane-scope-binding.js';
import {
  createCryptoReleaseDecisionBinding,
  type CryptoReleaseDecisionBinding,
} from '../src/crypto-authorization-core/release-decision-binding.js';
import {
  createCryptoErc1271ValidationProjection,
  evaluateCryptoErc1271ValidationResult,
  ERC1271_MAGIC_VALUE,
} from '../src/crypto-authorization-core/erc1271-validation-projection.js';
import {
  createCryptoReplayFreshnessRules,
  evaluateCryptoAuthorizationFreshness,
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
  type CryptoAuthorizationIntent,
} from '../src/crypto-authorization-core/object-model.js';
import {
  createCryptoCanonicalAssetReference,
  createCryptoCanonicalCounterpartyReference,
  createCryptoCanonicalReferenceBundle,
} from '../src/crypto-authorization-core/canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
  type CryptoConsequenceRiskAssessment,
} from '../src/crypto-authorization-core/consequence-risk-mapping.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
  type CryptoExecutionAdapterKind,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const BRIDGE_ADDRESS = '0x2222222222222222222222222222222222222222';
const GUARD_ADDRESS = '0x4444444444444444444444444444444444444444';
const OTHER_ADDRESS = '0x5555555555555555555555555555555555555555';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const SAFE_TX_HASH = `0x${'aa'.repeat(32)}`;
const SIGNATURES_HASH = `0x${'bb'.repeat(32)}`;
const SPIFFE_ID = 'spiffe://attestor.test/ns/crypto/sa/safe-guard';
const VALIDATED_AT_EPOCH_SECONDS = 1776762050;
const SIMULATED_AT_EPOCH_SECONDS = 1776762120;
const FRESH_REVOCATION_CHECKED_AT_EPOCH_SECONDS = 1776762110;

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

function fixtureSafeAccount() {
  return createCryptoAccountReference({
    accountKind: 'safe',
    chain: fixtureChain(),
    address: ACCOUNT_ADDRESS,
    accountLabel: 'Treasury Safe',
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

interface FixtureSuite {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
}

function fixtureSuite(
  executionAdapterKind: CryptoExecutionAdapterKind = 'safe-guard',
): FixtureSuite {
  const chain = fixtureChain();
  const account = fixtureSafeAccount();
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
    address: BRIDGE_ADDRESS,
    counterparty: 'bridge:canonical-usdc',
    protocol: 'bridge-protocol',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-bridge',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: [
      'chain',
      'account',
      'actor',
      'asset',
      'counterparty',
      'spender',
      'protocol',
      'function-selector',
      'calldata-class',
      'amount',
      'budget',
      'validity-window',
      'cadence',
      'risk-tier',
      'approval-quorum',
      'runtime-context',
    ],
    environment: 'prod-crypto',
    tenantId: 'tenant-crypto',
    policyPackRef: 'policy-pack:crypto:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T09:00:00.000Z',
    validUntil: '2026-04-21T09:05:00.000Z',
    nonce: 'safe:nonce:7',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    maxAmount: '250000.00',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: `intent-crypto-safe-guard-${executionAdapterKind}`,
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'bridge',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind,
    evidenceRefs: ['evidence:crypto-safe-guard:001', 'policy:activation:001'],
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
      executionAdapterKind,
      signals: ['cross-chain'],
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'smart-account',
    authorityId: 'safe:treasury',
    validationMode: 'erc-1271-contract',
    address: ACCOUNT_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: `decision-crypto-safe-guard-${executionAdapterKind}`,
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: `release-crypto-safe-guard-${executionAdapterKind}`,
    reasonCodes: ['policy-allow', 'safe-guard-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: `envelope-crypto-safe-guard-${executionAdapterKind}`,
    receiptId: `receipt-crypto-safe-guard-${executionAdapterKind}`,
    intent,
    decision: cryptoDecision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: VERIFYING_CONTRACT,
  });
  const signatureValidation = createCryptoErc1271ValidationProjection({
    envelope,
    signature: SIGNATURE,
    adapterKind: executionAdapterKind,
  });
  const signatureValidationResult = evaluateCryptoErc1271ValidationResult({
    projection: signatureValidation,
    returnValue: ERC1271_MAGIC_VALUE,
    blockNumber: '123',
    validatedAtEpochSeconds: VALIDATED_AT_EPOCH_SECONDS,
  });
  const freshnessRules = createCryptoReplayFreshnessRules({
    intent,
    decision: cryptoDecision,
    envelope,
  });
  const freshnessEvaluation = evaluateCryptoAuthorizationFreshness({
    rules: freshnessRules,
    nowEpochSeconds: SIMULATED_AT_EPOCH_SECONDS,
    revocationObservation: {
      revocationKey: freshnessRules.revocation.revocationKey,
      status: 'active',
      checkedAtEpochSeconds: FRESH_REVOCATION_CHECKED_AT_EPOCH_SECONDS,
    },
  });
  const releaseBinding = createCryptoReleaseDecisionBinding({
    intent,
    cryptoDecision,
    riskAssessment,
    envelope,
    signatureValidation,
    signatureValidationResult,
    freshnessRules,
    freshnessEvaluation,
  });
  const policyScopeBinding = createCryptoPolicyControlPlaneScopeBinding({
    intent,
    cryptoDecision,
    riskAssessment,
    releaseBinding,
    generatedAt: '2026-04-21T09:00:03.000Z',
    planId: 'enterprise',
  });
  const enforcementBinding = createCryptoEnforcementVerificationBinding({
    releaseBinding,
    policyScopeBinding,
    requestId: `erq_crypto_safe_guard_${executionAdapterKind.replaceAll('-', '_')}`,
    receivedAt: '2026-04-21T09:01:00.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.crypto.safe-guard',
      workloadId: SPIFFE_ID,
    },
    traceId: 'trace-crypto-safe-guard-001',
    idempotencyKey: 'idem-crypto-safe-guard-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function safeTransaction(
  overrides: Partial<SafeTransactionGuardTransaction> = {},
): SafeTransactionGuardTransaction {
  return {
    safeAddress: ACCOUNT_ADDRESS,
    chainId: 'eip155:1',
    to: BRIDGE_ADDRESS,
    value: '0',
    data: '0x12345678abcdef',
    operation: 'call',
    safeTxGas: '150000',
    baseGas: '21000',
    gasPrice: '0',
    gasToken: '0x0000000000000000000000000000000000000000',
    refundReceiver: '0x0000000000000000000000000000000000000000',
    signaturesHash: SIGNATURES_HASH,
    msgSender: ACCOUNT_ADDRESS,
    safeTxHash: SAFE_TX_HASH,
    nonce: '7',
    ...overrides,
  };
}

function hook(overrides = {}) {
  return {
    phase: 'check-transaction' as const,
    checkedAt: '2026-04-21T09:02:00.000Z',
    guardAddress: GUARD_ADDRESS,
    safeVersion: '1.5.0',
    ...overrides,
  };
}

function testDescriptor(): void {
  const descriptor = safeTransactionGuardAdapterDescriptor();

  equal(
    descriptor.version,
    SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION,
    'Safe transaction guard adapter: descriptor exposes version',
  );
  deepEqual(
    descriptor.outcomes,
    SAFE_TRANSACTION_GUARD_OUTCOMES,
    'Safe transaction guard adapter: descriptor exposes outcomes',
  );
  deepEqual(
    descriptor.checks,
    SAFE_TRANSACTION_GUARD_CHECKS,
    'Safe transaction guard adapter: descriptor exposes checks',
  );
  ok(
    descriptor.standards.includes('checkTransaction'),
    'Safe transaction guard adapter: descriptor names checkTransaction',
  );
  ok(
    descriptor.standards.includes('checkAfterExecution'),
    'Safe transaction guard adapter: descriptor names checkAfterExecution',
  );
}

function testCreatesAllowPreflight(): void {
  const suite = fixtureSuite();
  const preflight = createSafeTransactionGuardPreflight({
    ...suite,
    transaction: safeTransaction(),
    hook: hook(),
  });
  const second = createSafeTransactionGuardPreflight({
    ...suite,
    transaction: safeTransaction(),
    hook: hook(),
  });

  equal(
    preflight.version,
    SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION,
    'Safe transaction guard adapter: preflight carries version',
  );
  equal(
    preflight.outcome,
    'allow',
    'Safe transaction guard adapter: complete ordinary Safe tx preflight allows',
  );
  equal(
    preflight.signal.source,
    'safe-guard',
    'Safe transaction guard adapter: emits Safe guard simulation source',
  );
  equal(
    preflight.signal.status,
    'pass',
    'Safe transaction guard adapter: allow preflight emits pass signal',
  );
  equal(
    preflight.functionSelector,
    '0x12345678',
    'Safe transaction guard adapter: extracts function selector',
  );
  equal(
    preflight.operation,
    'call',
    'Safe transaction guard adapter: ordinary transaction uses call operation',
  );
  equal(
    preflight.safeTxHash,
    SAFE_TX_HASH,
    'Safe transaction guard adapter: carries Safe transaction hash',
  );
  equal(
    preflight.digest,
    second.digest,
    'Safe transaction guard adapter: preflight digest is deterministic',
  );
  ok(
    preflight.observations.every((entry) => entry.status === 'pass'),
    'Safe transaction guard adapter: all allow observations pass',
  );
  ok(
    safeTransactionGuardPreflightLabel(preflight).includes('outcome:allow'),
    'Safe transaction guard adapter: label includes outcome',
  );
}

function testSimulationAllowsBoundSafeTransaction(): void {
  const suite = fixtureSuite();
  const result = simulateSafeTransactionGuardAuthorization({
    ...suite,
    transaction: safeTransaction(),
    hook: hook(),
  });

  equal(
    result.preflight.outcome,
    'allow',
    'Safe transaction guard adapter: simulation wrapper carries allow preflight',
  );
  equal(
    result.simulation.outcome,
    'allow-preview',
    'Safe transaction guard adapter: bound Safe transaction allows simulation preview',
  );
  equal(
    result.simulation.readiness.adapterPreflight,
    'ready',
    'Safe transaction guard adapter: simulation adapter preflight is ready',
  );
  ok(
    result.simulation.requiredPreflightSources.includes('safe-guard'),
    'Safe transaction guard adapter: simulation requires Safe guard source',
  );
  deepEqual(
    result.simulation.requiredNextArtifacts,
    [],
    'Safe transaction guard adapter: allow simulation has no required next artifacts',
  );
}

function testDelegatecallBlocks(): void {
  const suite = fixtureSuite();
  const result = simulateSafeTransactionGuardAuthorization({
    ...suite,
    transaction: safeTransaction({ operation: 'delegatecall' }),
    hook: hook(),
  });

  equal(
    result.preflight.outcome,
    'block',
    'Safe transaction guard adapter: delegatecall blocks',
  );
  equal(
    result.preflight.signal.status,
    'fail',
    'Safe transaction guard adapter: blocked delegatecall emits fail signal',
  );
  ok(
    result.preflight.observations.some((entry) => entry.code === 'safe-delegatecall-blocked'),
    'Safe transaction guard adapter: delegatecall failure reason is present',
  );
  equal(
    result.simulation.outcome,
    'deny-preview',
    'Safe transaction guard adapter: delegatecall block denies simulation preview',
  );
}

function testMismatchedTargetBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createSafeTransactionGuardPreflight({
    ...suite,
    transaction: safeTransaction({ to: OTHER_ADDRESS }),
    hook: hook(),
  });

  equal(
    preflight.outcome,
    'block',
    'Safe transaction guard adapter: mismatched target blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'safe-target-mismatch'),
    'Safe transaction guard adapter: target mismatch reason is present',
  );
}

function testPostExecutionFailureBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createSafeTransactionGuardPreflight({
    ...suite,
    transaction: safeTransaction(),
    hook: hook({
      phase: 'check-after-execution' as const,
      executionSuccess: false,
    }),
  });

  equal(
    preflight.hookPhase,
    'check-after-execution',
    'Safe transaction guard adapter: post-execution phase is carried',
  );
  equal(
    preflight.outcome,
    'block',
    'Safe transaction guard adapter: failed post-execution hook blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'safe-post-execution-failed'),
    'Safe transaction guard adapter: post-execution failure reason is present',
  );
}

function testRejectsNonOrdinarySafeGuardAdapter(): void {
  const suite = fixtureSuite('safe-module-guard');

  assert.throws(
    () =>
      createSafeTransactionGuardPreflight({
        ...suite,
        transaction: safeTransaction(),
        hook: hook(),
      }),
    /safe-guard/i,
  );
  passed += 1;
}

function main(): void {
  testDescriptor();
  testCreatesAllowPreflight();
  testSimulationAllowsBoundSafeTransaction();
  testDelegatecallBlocks();
  testMismatchedTargetBlocks();
  testPostExecutionFailureBlocks();
  testRejectsNonOrdinarySafeGuardAdapter();
  console.log(`crypto authorization core Safe transaction guard adapter tests passed (${passed} assertions)`);
}

main();
