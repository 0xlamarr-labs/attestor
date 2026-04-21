import assert from 'node:assert/strict';
import {
  ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION,
  ERC4337_USER_OPERATION_CHECKS,
  ERC4337_USER_OPERATION_ENTRYPOINT_VERSIONS,
  ERC4337_USER_OPERATION_OUTCOMES,
  createErc4337UserOperationPreflight,
  erc4337UserOperationAdapterDescriptor,
  erc4337UserOperationPreflightLabel,
  simulateErc4337UserOperationAuthorization,
  type Erc4337BundlerValidation,
  type Erc4337UserOperation,
} from '../src/crypto-authorization-core/erc4337-user-operation-adapter.js';
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
const PAYMASTER_ADDRESS = '0x3333333333333333333333333333333333333333';
const FACTORY_ADDRESS = '0x4444444444444444444444444444444444444444';
const OTHER_ADDRESS = '0x5555555555555555555555555555555555555555';
const ENTRYPOINT_ADDRESS = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const USER_OP_HASH = `0x${'ee'.repeat(32)}`;
const SPIFFE_ID = 'spiffe://attestor.test/ns/crypto/sa/erc4337-user-operation';
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

function fixtureSmartAccount() {
  return createCryptoAccountReference({
    accountKind: 'erc-4337-smart-account',
    chain: fixtureChain(),
    address: ACCOUNT_ADDRESS,
    accountLabel: 'Treasury smart account',
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
  executionAdapterKind: CryptoExecutionAdapterKind = 'erc-4337-user-operation',
): FixtureSuite {
  const chain = fixtureChain();
  const account = fixtureSmartAccount();
  const asset = fixtureAsset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:treasury-userop',
    authorityRef: 'authority:treasury-userop-policy',
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
    nonce: 'userop:nonce:42',
    replayProtectionMode: 'user-operation-nonce',
    digestMode: 'user-operation-hash',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    maxAmount: '250000.00',
    budgetId: 'budget:bridge:daily:usdc',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: `intent-crypto-erc4337-user-operation-${executionAdapterKind}`,
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'bridge',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind,
    evidenceRefs: [
      'evidence:crypto-erc4337-user-operation:001',
      'policy:activation:001',
    ],
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
      signals: ['cross-chain', 'agent-initiated'],
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'smart-account',
    authorityId: 'erc4337:treasury',
    validationMode: 'erc-1271-contract',
    address: ACCOUNT_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: `decision-crypto-erc4337-user-operation-${executionAdapterKind}`,
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: `release-crypto-erc4337-user-operation-${executionAdapterKind}`,
    reasonCodes: ['policy-allow', 'erc4337-user-operation-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: `envelope-crypto-erc4337-user-operation-${executionAdapterKind}`,
    receiptId: `receipt-crypto-erc4337-user-operation-${executionAdapterKind}`,
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
    adapterNonceObservation: {
      nonce: freshnessRules.adapterNonce.expectedNonce,
      matchesExpected: true,
      checkedAtEpochSeconds: FRESH_REVOCATION_CHECKED_AT_EPOCH_SECONDS,
      sourceKind: 'entrypoint-nonce-state',
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
    requestId: `erq_crypto_erc4337_user_operation_${executionAdapterKind.replaceAll('-', '_')}`,
    receivedAt: '2026-04-21T09:01:00.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.crypto.erc4337-user-operation',
      workloadId: SPIFFE_ID,
    },
    traceId: 'trace-crypto-erc4337-user-operation-001',
    idempotencyKey: 'idem-crypto-erc4337-user-operation-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function userOperation(
  overrides: Partial<Erc4337UserOperation> = {},
): Erc4337UserOperation {
  return {
    sender: ACCOUNT_ADDRESS,
    nonce: '42',
    entryPoint: ENTRYPOINT_ADDRESS,
    entryPointVersion: 'v0.8',
    chainId: 'eip155:1',
    callData: '0x12345678abcdef',
    callTarget: BRIDGE_ADDRESS,
    callValue: '0',
    callFunctionSelector: '0x12345678',
    callDataClass: 'bounded-bridge',
    callCount: 1,
    factory: null,
    factoryData: null,
    callGasLimit: '250000',
    verificationGasLimit: '150000',
    preVerificationGas: '55000',
    maxFeePerGas: '40000000000',
    maxPriorityFeePerGas: '1500000000',
    paymaster: PAYMASTER_ADDRESS,
    paymasterVerificationGasLimit: '80000',
    paymasterPostOpGasLimit: '50000',
    paymasterData: '0xabcd',
    signature: SIGNATURE,
    userOpHash: USER_OP_HASH,
    ...overrides,
  };
}

function bundlerValidation(
  overrides: Partial<Erc4337BundlerValidation> = {},
): Erc4337BundlerValidation {
  return {
    validatedAt: '2026-04-21T09:02:00.000Z',
    bundlerId: 'bundler:attestor-aa:mainnet',
    entryPointSupported: true,
    simulateValidationStatus: 'passed',
    erc7562ValidationStatus: 'passed',
    accountValidationStatus: 'passed',
    signatureValidationStatus: 'passed',
    nonceValidationStatus: 'passed',
    senderAlreadyDeployed: true,
    factoryStatus: 'not-used',
    paymasterStatus: 'ready',
    paymasterStakeReady: true,
    paymasterDepositReady: true,
    prefundCovered: true,
    gasLimitsWithinPolicy: true,
    bannedOpcodeDetected: false,
    storageAccessViolation: false,
    unstakedEntityAccessDetected: false,
    aggregatorAddress: null,
    accountValidation: {
      validAfter: '2026-04-21T09:00:10.000Z',
      validUntil: '2026-04-21T09:04:30.000Z',
    },
    paymasterValidation: {
      validAfter: '2026-04-21T09:00:10.000Z',
      validUntil: '2026-04-21T09:04:30.000Z',
    },
    ...overrides,
  };
}

function testDescriptor(): void {
  const descriptor = erc4337UserOperationAdapterDescriptor();

  equal(
    descriptor.version,
    ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION,
    'ERC-4337 UserOperation adapter: descriptor exposes version',
  );
  deepEqual(
    descriptor.entryPointVersions,
    ERC4337_USER_OPERATION_ENTRYPOINT_VERSIONS,
    'ERC-4337 UserOperation adapter: descriptor exposes EntryPoint versions',
  );
  deepEqual(
    descriptor.outcomes,
    ERC4337_USER_OPERATION_OUTCOMES,
    'ERC-4337 UserOperation adapter: descriptor exposes outcomes',
  );
  deepEqual(
    descriptor.checks,
    ERC4337_USER_OPERATION_CHECKS,
    'ERC-4337 UserOperation adapter: descriptor exposes checks',
  );
  ok(
    descriptor.standards.includes('ERC-4337'),
    'ERC-4337 UserOperation adapter: descriptor names ERC-4337',
  );
  ok(
    descriptor.standards.includes('ERC-7562'),
    'ERC-4337 UserOperation adapter: descriptor names ERC-7562',
  );
  ok(
    descriptor.standards.includes('Paymaster'),
    'ERC-4337 UserOperation adapter: descriptor names Paymaster readiness',
  );
  ok(
    descriptor.standards.includes('EntryPoint'),
    'ERC-4337 UserOperation adapter: descriptor names EntryPoint binding',
  );
}

function testCreatesAllowPreflight(): void {
  const suite = fixtureSuite();
  const preflight = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation(),
    bundlerValidation: bundlerValidation(),
  });
  const second = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation(),
    bundlerValidation: bundlerValidation(),
  });

  equal(
    preflight.version,
    ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION,
    'ERC-4337 UserOperation adapter: preflight carries version',
  );
  equal(
    preflight.outcome,
    'allow',
    'ERC-4337 UserOperation adapter: complete UserOperation preflight allows',
  );
  deepEqual(
    preflight.signals.map((signal) => signal.source),
    ['erc-4337-validation', 'erc-7562-validation-scope'],
    'ERC-4337 UserOperation adapter: emits required validation sources',
  );
  ok(
    preflight.signals.every((signal) => signal.status === 'pass'),
    'ERC-4337 UserOperation adapter: allow preflight emits pass signals',
  );
  equal(
    preflight.userOpHash,
    USER_OP_HASH,
    'ERC-4337 UserOperation adapter: carries userOpHash',
  );
  equal(
    preflight.entryPoint,
    ENTRYPOINT_ADDRESS,
    'ERC-4337 UserOperation adapter: binds EntryPoint address',
  );
  equal(
    preflight.sender,
    ACCOUNT_ADDRESS,
    'ERC-4337 UserOperation adapter: binds sender account',
  );
  equal(
    preflight.digest,
    second.digest,
    'ERC-4337 UserOperation adapter: preflight digest is deterministic',
  );
  ok(
    preflight.observations.every((entry) => entry.status === 'pass'),
    'ERC-4337 UserOperation adapter: all allow observations pass',
  );
  ok(
    erc4337UserOperationPreflightLabel(preflight).includes('outcome:allow'),
    'ERC-4337 UserOperation adapter: label includes outcome',
  );
}

function testSimulationAllowsBoundUserOperation(): void {
  const suite = fixtureSuite();
  const result = simulateErc4337UserOperationAuthorization({
    ...suite,
    userOperation: userOperation(),
    bundlerValidation: bundlerValidation(),
  });

  equal(
    result.preflight.outcome,
    'allow',
    'ERC-4337 UserOperation adapter: simulation wrapper carries allow preflight',
  );
  equal(
    result.simulation.outcome,
    'allow-preview',
    'ERC-4337 UserOperation adapter: bound UserOperation allows simulation preview',
  );
  equal(
    result.simulation.readiness.adapterPreflight,
    'ready',
    'ERC-4337 UserOperation adapter: simulation adapter preflight is ready',
  );
  ok(
    result.simulation.requiredPreflightSources.includes('erc-4337-validation'),
    'ERC-4337 UserOperation adapter: simulation requires ERC-4337 validation',
  );
  ok(
    result.simulation.requiredPreflightSources.includes('erc-7562-validation-scope'),
    'ERC-4337 UserOperation adapter: simulation requires ERC-7562 scope',
  );
  deepEqual(
    result.simulation.requiredNextArtifacts,
    [],
    'ERC-4337 UserOperation adapter: allow simulation has no required next artifacts',
  );
}

function testBundlerSimulationFailureBlocks(): void {
  const suite = fixtureSuite();
  const result = simulateErc4337UserOperationAuthorization({
    ...suite,
    userOperation: userOperation(),
    bundlerValidation: bundlerValidation({ simulateValidationStatus: 'failed' }),
  });

  equal(
    result.preflight.outcome,
    'block',
    'ERC-4337 UserOperation adapter: failed simulateValidation blocks',
  );
  ok(
    result.preflight.observations.some((entry) => entry.code === 'erc4337-simulate-validation-failed'),
    'ERC-4337 UserOperation adapter: failed simulateValidation reason is present',
  );
  equal(
    result.simulation.outcome,
    'deny-preview',
    'ERC-4337 UserOperation adapter: failed simulateValidation denies simulation preview',
  );
}

function testErc7562ViolationBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation(),
    bundlerValidation: bundlerValidation({
      bannedOpcodeDetected: true,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'ERC-4337 UserOperation adapter: ERC-7562 violation blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'erc4337-erc7562-banned-opcode'),
    'ERC-4337 UserOperation adapter: ERC-7562 banned opcode reason is present',
  );
}

function testPaymasterNotReadyBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation(),
    bundlerValidation: bundlerValidation({
      paymasterStakeReady: false,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'ERC-4337 UserOperation adapter: paymaster stake failure blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'erc4337-paymaster-stake-not-ready'),
    'ERC-4337 UserOperation adapter: paymaster stake reason is present',
  );
}

function testGasPolicyBlocks(): void {
  const suite = fixtureSuite();
  const preflight = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation({
      maxFeePerGas: '100',
      maxPriorityFeePerGas: '200',
    }),
    bundlerValidation: bundlerValidation(),
  });

  equal(
    preflight.outcome,
    'block',
    'ERC-4337 UserOperation adapter: priority fee above max fee blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'erc4337-priority-fee-exceeds-max-fee'),
    'ERC-4337 UserOperation adapter: gas policy reason is present',
  );
}

function testNonceAndTargetMismatchBlocks(): void {
  const suite = fixtureSuite();
  const nonceMismatch = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation({ nonce: '43' }),
    bundlerValidation: bundlerValidation(),
  });
  const targetMismatch = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation({ callTarget: OTHER_ADDRESS }),
    bundlerValidation: bundlerValidation(),
  });

  equal(
    nonceMismatch.outcome,
    'block',
    'ERC-4337 UserOperation adapter: nonce mismatch blocks',
  );
  ok(
    nonceMismatch.observations.some((entry) => entry.code === 'erc4337-nonce-mismatch'),
    'ERC-4337 UserOperation adapter: nonce mismatch reason is present',
  );
  equal(
    targetMismatch.outcome,
    'block',
    'ERC-4337 UserOperation adapter: target mismatch blocks',
  );
  ok(
    targetMismatch.observations.some((entry) => entry.code === 'erc4337-call-target-mismatch'),
    'ERC-4337 UserOperation adapter: target mismatch reason is present',
  );
}

function testFactoryPathRequiresReadiness(): void {
  const suite = fixtureSuite();
  const blocked = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation({
      factory: FACTORY_ADDRESS,
      factoryData: null,
      paymaster: null,
      paymasterVerificationGasLimit: null,
      paymasterPostOpGasLimit: null,
      paymasterData: null,
    }),
    bundlerValidation: bundlerValidation({
      senderAlreadyDeployed: false,
      factoryStatus: 'not-ready',
      paymasterStatus: 'not-used',
      paymasterStakeReady: null,
      paymasterDepositReady: null,
      paymasterValidation: null,
    }),
  });
  const allowed = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation({
      factory: FACTORY_ADDRESS,
      factoryData: '0xabcdef',
      paymaster: null,
      paymasterVerificationGasLimit: null,
      paymasterPostOpGasLimit: null,
      paymasterData: null,
    }),
    bundlerValidation: bundlerValidation({
      senderAlreadyDeployed: false,
      factoryStatus: 'ready',
      paymasterStatus: 'not-used',
      paymasterStakeReady: null,
      paymasterDepositReady: null,
      paymasterValidation: null,
    }),
  });

  equal(
    blocked.outcome,
    'block',
    'ERC-4337 UserOperation adapter: missing factory readiness blocks counterfactual sender',
  );
  ok(
    blocked.observations.some((entry) => entry.code === 'erc4337-factory-not-ready'),
    'ERC-4337 UserOperation adapter: factory readiness reason is present',
  );
  equal(
    allowed.outcome,
    'allow',
    'ERC-4337 UserOperation adapter: ready factory path allows counterfactual sender',
  );
}

function testValidationWindowMustStayInsideIntent(): void {
  const suite = fixtureSuite();
  const preflight = createErc4337UserOperationPreflight({
    ...suite,
    userOperation: userOperation(),
    bundlerValidation: bundlerValidation({
      accountValidation: {
        validAfter: '2026-04-21T08:59:00.000Z',
        validUntil: '2026-04-21T09:06:00.000Z',
      },
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'ERC-4337 UserOperation adapter: widened account validation window blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'erc4337-account-validation-window-outside-intent'),
    'ERC-4337 UserOperation adapter: validation window reason is present',
  );
}

function testRejectsWrongAdapterIntent(): void {
  const suite = fixtureSuite('safe-guard');

  assert.throws(
    () =>
      createErc4337UserOperationPreflight({
        ...suite,
        userOperation: userOperation(),
        bundlerValidation: bundlerValidation(),
      }),
    /erc-4337-user-operation/i,
  );
  passed += 1;
}

function main(): void {
  testDescriptor();
  testCreatesAllowPreflight();
  testSimulationAllowsBoundUserOperation();
  testBundlerSimulationFailureBlocks();
  testErc7562ViolationBlocks();
  testPaymasterNotReadyBlocks();
  testGasPolicyBlocks();
  testNonceAndTargetMismatchBlocks();
  testFactoryPathRequiresReadiness();
  testValidationWindowMustStayInsideIntent();
  testRejectsWrongAdapterIntent();
  console.log(`crypto authorization core ERC-4337 UserOperation adapter tests passed (${passed} assertions)`);
}

main();
