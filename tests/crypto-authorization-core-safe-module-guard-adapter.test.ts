import assert from 'node:assert/strict';
import {
  SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION,
  SAFE_MODULE_GUARD_CHECKS,
  SAFE_MODULE_GUARD_OUTCOMES,
  createSafeModuleGuardPreflight,
  safeModuleGuardAdapterDescriptor,
  safeModuleGuardPreflightLabel,
  simulateSafeModuleGuardAuthorization,
  type SafeModuleGuardRecoveryPosture,
  type SafeModuleGuardTransaction,
} from '../src/crypto-authorization-core/safe-module-guard-adapter.js';
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
const MODULE_ADDRESS = '0x3333333333333333333333333333333333333333';
const MODULE_GUARD_ADDRESS = '0x4444444444444444444444444444444444444444';
const OTHER_ADDRESS = '0x5555555555555555555555555555555555555555';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const MODULE_TX_HASH = `0x${'cc'.repeat(32)}`;
const RETURN_DATA_HASH = `0x${'dd'.repeat(32)}`;
const SPIFFE_ID = 'spiffe://attestor.test/ns/crypto/sa/safe-module-guard';
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
  executionAdapterKind: CryptoExecutionAdapterKind = 'safe-module-guard',
): FixtureSuite {
  const chain = fixtureChain();
  const account = fixtureSafeAccount();
  const asset = fixtureAsset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:treasury-module',
    authorityRef: 'authority:treasury-module-policy',
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
    nonce: 'module:nonce:11',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    maxAmount: '250000.00',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: `intent-crypto-safe-module-guard-${executionAdapterKind}`,
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'bridge',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind,
    evidenceRefs: ['evidence:crypto-safe-module-guard:001', 'policy:activation:001'],
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
    decisionId: `decision-crypto-safe-module-guard-${executionAdapterKind}`,
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: `release-crypto-safe-module-guard-${executionAdapterKind}`,
    reasonCodes: ['policy-allow', 'safe-module-guard-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: `envelope-crypto-safe-module-guard-${executionAdapterKind}`,
    receiptId: `receipt-crypto-safe-module-guard-${executionAdapterKind}`,
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
    requestId: `erq_crypto_safe_module_guard_${executionAdapterKind.replaceAll('-', '_')}`,
    receivedAt: '2026-04-21T09:01:00.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.crypto.safe-module-guard',
      workloadId: SPIFFE_ID,
    },
    traceId: 'trace-crypto-safe-module-guard-001',
    idempotencyKey: 'idem-crypto-safe-module-guard-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function moduleTransaction(
  overrides: Partial<SafeModuleGuardTransaction> = {},
): SafeModuleGuardTransaction {
  return {
    safeAddress: ACCOUNT_ADDRESS,
    chainId: 'eip155:1',
    moduleAddress: MODULE_ADDRESS,
    moduleEnabled: true,
    moduleGuardInstalled: true,
    moduleKind: 'allowance-module',
    modulePolicyRef: 'policy:module:treasury',
    to: BRIDGE_ADDRESS,
    value: '0',
    data: '0x12345678abcdef',
    operation: 'call',
    delegateCallAllowed: false,
    moduleTxHash: MODULE_TX_HASH,
    moduleNonce: '11',
    executor: MODULE_ADDRESS,
    returnDataHash: RETURN_DATA_HASH,
    ...overrides,
  };
}

function hook(overrides = {}) {
  return {
    phase: 'check-module-transaction' as const,
    checkedAt: '2026-04-21T09:02:00.000Z',
    moduleGuardAddress: MODULE_GUARD_ADDRESS,
    safeVersion: '1.5.0',
    ...overrides,
  };
}

function recovery(
  overrides: Partial<SafeModuleGuardRecoveryPosture> = {},
): SafeModuleGuardRecoveryPosture {
  return {
    moduleCanBeDisabledByOwners: true,
    guardCanBeRemovedByOwners: true,
    emergencySafeTxPrepared: true,
    recoveryAuthorityRef: 'safe-owner-quorum:2-of-3',
    recoveryDelaySeconds: 0,
    ...overrides,
  };
}

function testDescriptor(): void {
  const descriptor = safeModuleGuardAdapterDescriptor();

  equal(
    descriptor.version,
    SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION,
    'Safe module guard adapter: descriptor exposes version',
  );
  deepEqual(
    descriptor.outcomes,
    SAFE_MODULE_GUARD_OUTCOMES,
    'Safe module guard adapter: descriptor exposes outcomes',
  );
  deepEqual(
    descriptor.checks,
    SAFE_MODULE_GUARD_CHECKS,
    'Safe module guard adapter: descriptor exposes checks',
  );
  ok(
    descriptor.standards.includes('setModuleGuard'),
    'Safe module guard adapter: descriptor names setModuleGuard',
  );
  ok(
    descriptor.standards.includes('execTransactionFromModule'),
    'Safe module guard adapter: descriptor names execTransactionFromModule',
  );
  ok(
    descriptor.standards.includes('checkModuleTransaction'),
    'Safe module guard adapter: descriptor names checkModuleTransaction',
  );
  ok(
    descriptor.standards.includes('checkAfterModuleExecution'),
    'Safe module guard adapter: descriptor names checkAfterModuleExecution',
  );
}

function testCreatesAllowPreflight(): void {
  const suite = fixtureSuite();
  const preflight = createSafeModuleGuardPreflight({
    ...suite,
    transaction: moduleTransaction(),
    hook: hook(),
    recovery: recovery(),
  });
  const second = createSafeModuleGuardPreflight({
    ...suite,
    transaction: moduleTransaction(),
    hook: hook(),
    recovery: recovery(),
  });

  equal(
    preflight.version,
    SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION,
    'Safe module guard adapter: preflight carries version',
  );
  equal(
    preflight.outcome,
    'allow',
    'Safe module guard adapter: complete module transaction preflight allows',
  );
  deepEqual(
    preflight.signals.map((signal) => signal.source),
    ['safe-guard', 'module-hook'],
    'Safe module guard adapter: emits Safe guard and module hook sources',
  );
  ok(
    preflight.signals.every((signal) => signal.status === 'pass'),
    'Safe module guard adapter: allow preflight emits pass signals',
  );
  equal(
    preflight.functionSelector,
    '0x12345678',
    'Safe module guard adapter: extracts function selector',
  );
  equal(
    preflight.operation,
    'call',
    'Safe module guard adapter: module transaction uses call operation',
  );
  equal(
    preflight.moduleTxHash,
    MODULE_TX_HASH,
    'Safe module guard adapter: carries module transaction hash',
  );
  equal(
    preflight.digest,
    second.digest,
    'Safe module guard adapter: preflight digest is deterministic',
  );
  ok(
    preflight.observations.every((entry) => entry.status === 'pass'),
    'Safe module guard adapter: all allow observations pass',
  );
  ok(
    safeModuleGuardPreflightLabel(preflight).includes('outcome:allow'),
    'Safe module guard adapter: label includes outcome',
  );
}

function testSimulationAllowsBoundModuleTransaction(): void {
  const suite = fixtureSuite();
  const result = simulateSafeModuleGuardAuthorization({
    ...suite,
    transaction: moduleTransaction(),
    hook: hook(),
    recovery: recovery(),
  });

  equal(
    result.preflight.outcome,
    'allow',
    'Safe module guard adapter: simulation wrapper carries allow preflight',
  );
  equal(
    result.simulation.outcome,
    'allow-preview',
    'Safe module guard adapter: bound module transaction allows simulation preview',
  );
  equal(
    result.simulation.readiness.adapterPreflight,
    'ready',
    'Safe module guard adapter: simulation adapter preflight is ready',
  );
  ok(
    result.simulation.requiredPreflightSources.includes('safe-guard'),
    'Safe module guard adapter: simulation requires Safe guard source',
  );
  ok(
    result.simulation.requiredPreflightSources.includes('module-hook'),
    'Safe module guard adapter: simulation requires module hook source',
  );
  deepEqual(
    result.simulation.requiredNextArtifacts,
    [],
    'Safe module guard adapter: allow simulation has no required next artifacts',
  );
}

function testDisabledModuleBlocks(): void {
  const suite = fixtureSuite();
  const result = simulateSafeModuleGuardAuthorization({
    ...suite,
    transaction: moduleTransaction({ moduleEnabled: false }),
    hook: hook(),
    recovery: recovery(),
  });

  equal(
    result.preflight.outcome,
    'block',
    'Safe module guard adapter: disabled module blocks',
  );
  ok(
    result.preflight.observations.some((entry) => entry.code === 'safe-module-not-enabled'),
    'Safe module guard adapter: disabled module reason is present',
  );
  equal(
    result.simulation.outcome,
    'deny-preview',
    'Safe module guard adapter: disabled module denies simulation preview',
  );
}

function testMissingModuleGuardBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createSafeModuleGuardPreflight({
    ...suite,
    transaction: moduleTransaction({ moduleGuardInstalled: true }),
    hook: hook({ moduleGuardAddress: ZERO_ADDRESS }),
    recovery: recovery(),
  });

  equal(
    preflight.outcome,
    'block',
    'Safe module guard adapter: disabled module guard address blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'safe-module-guard-not-installed'),
    'Safe module guard adapter: disabled module guard reason is present',
  );
}

function testMissingRecoveryBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createSafeModuleGuardPreflight({
    ...suite,
    transaction: moduleTransaction(),
    hook: hook(),
    recovery: recovery({ emergencySafeTxPrepared: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'Safe module guard adapter: missing recovery posture blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'safe-module-recovery-posture-missing'),
    'Safe module guard adapter: missing recovery reason is present',
  );
}

function testDelegatecallBlocksUnlessExplicitlyAllowed(): void {
  const suite = fixtureSuite();
  const blocked = createSafeModuleGuardPreflight({
    ...suite,
    transaction: moduleTransaction({ operation: 'delegatecall' }),
    hook: hook(),
    recovery: recovery(),
  });
  const allowed = createSafeModuleGuardPreflight({
    ...suite,
    transaction: moduleTransaction({
      operation: 'delegatecall',
      delegateCallAllowed: true,
    }),
    hook: hook(),
    recovery: recovery(),
  });

  equal(
    blocked.outcome,
    'block',
    'Safe module guard adapter: delegatecall blocks without explicit evidence',
  );
  ok(
    blocked.observations.some((entry) => entry.code === 'safe-module-delegatecall-blocked'),
    'Safe module guard adapter: delegatecall failure reason is present',
  );
  equal(
    allowed.outcome,
    'allow',
    'Safe module guard adapter: delegatecall can allow with explicit adapter evidence',
  );
}

function testPostExecutionFailureBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createSafeModuleGuardPreflight({
    ...suite,
    transaction: moduleTransaction(),
    hook: hook({
      phase: 'check-after-module-execution' as const,
      executionSuccess: false,
    }),
    recovery: recovery(),
  });

  equal(
    preflight.hookPhase,
    'check-after-module-execution',
    'Safe module guard adapter: post-execution phase is carried',
  );
  equal(
    preflight.outcome,
    'block',
    'Safe module guard adapter: failed post-execution hook blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'safe-module-post-execution-failed'),
    'Safe module guard adapter: post-execution failure reason is present',
  );
}

function testMismatchedTargetBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createSafeModuleGuardPreflight({
    ...suite,
    transaction: moduleTransaction({ to: OTHER_ADDRESS }),
    hook: hook(),
    recovery: recovery(),
  });

  equal(
    preflight.outcome,
    'block',
    'Safe module guard adapter: mismatched target blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'safe-module-target-mismatch'),
    'Safe module guard adapter: target mismatch reason is present',
  );
}

function testRejectsOrdinarySafeGuardAdapter(): void {
  const suite = fixtureSuite('safe-guard');

  assert.throws(
    () =>
      createSafeModuleGuardPreflight({
        ...suite,
        transaction: moduleTransaction(),
        hook: hook(),
        recovery: recovery(),
      }),
    /safe-module-guard/i,
  );
  passed += 1;
}

function main(): void {
  testDescriptor();
  testCreatesAllowPreflight();
  testSimulationAllowsBoundModuleTransaction();
  testDisabledModuleBlocks();
  testMissingModuleGuardBlocks();
  testMissingRecoveryBlocks();
  testDelegatecallBlocksUnlessExplicitlyAllowed();
  testPostExecutionFailureBlocks();
  testMismatchedTargetBlocks();
  testRejectsOrdinarySafeGuardAdapter();
  console.log(`crypto authorization core Safe module guard adapter tests passed (${passed} assertions)`);
}

main();
