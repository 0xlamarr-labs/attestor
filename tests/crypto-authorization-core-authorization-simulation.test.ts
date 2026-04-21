import assert from 'node:assert/strict';
import {
  CRYPTO_AUTHORIZATION_SIMULATION_OUTCOMES,
  CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION,
  CRYPTO_SIMULATION_CHECKS,
  createCryptoAuthorizationSimulation,
  cryptoAuthorizationSimulationDescriptor,
  cryptoAuthorizationSimulationLabel,
  cryptoSimulationAdapterPreflightProfile,
} from '../src/crypto-authorization-core/authorization-simulation.js';
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
  CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
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
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const DELEGATE_ADDRESS = '0x3333333333333333333333333333333333333333';
const SIGNATURE = `0x${'11'.repeat(65)}`;
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

function fixtureEoaAccount() {
  return createCryptoAccountReference({
    accountKind: 'eoa',
    chain: fixtureChain(),
    address: ACCOUNT_ADDRESS,
    accountLabel: 'Treasury EOA',
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
    nonce: 'bridge:nonce:7',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    maxAmount: '250000.00',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-crypto-simulation-001',
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'bridge',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind,
    evidenceRefs: ['evidence:crypto-simulation:001', 'policy:activation:001'],
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
    decisionId: 'decision-crypto-simulation-001',
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: 'release-crypto-simulation-001',
    reasonCodes: ['policy-allow', 'bridge-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: 'envelope-crypto-simulation-001',
    receiptId: 'receipt-crypto-simulation-001',
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
    requestId: 'erq_crypto_simulation_001',
    receivedAt: '2026-04-21T09:01:00.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.crypto.safe-guard',
      workloadId: SPIFFE_ID,
    },
    traceId: 'trace-crypto-simulation-001',
    idempotencyKey: 'idem-crypto-simulation-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function delegationCandidateFixture(): {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
} {
  const chain = fixtureChain();
  const account = fixtureEoaAccount();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:session-delegator',
    authorityRef: 'authority:delegate-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'contract',
    chain,
    targetId: 'delegate:eip7702-session',
    address: DELEGATE_ADDRESS,
    protocol: 'eip-7702-delegate',
    functionSelector: '0xabcdef01',
    calldataClass: 'session-delegation',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: [
      'chain',
      'account',
      'actor',
      'protocol',
      'function-selector',
      'calldata-class',
      'validity-window',
      'runtime-context',
      'risk-tier',
      'approval-quorum',
    ],
    environment: 'prod-crypto',
    tenantId: 'tenant-crypto',
    policyPackRef: 'policy-pack:crypto:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T09:00:00.000Z',
    validUntil: '2026-04-21T09:05:00.000Z',
    nonce: '7702:nonce:5',
    replayProtectionMode: 'authorization-list-nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-crypto-simulation-7702',
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'account-delegation',
    target,
    policyScope,
    constraints,
    executionAdapterKind: 'eip-7702-delegation',
    evidenceRefs: ['evidence:eip7702:001'],
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'account-delegation',
    account,
    context: {
      executionAdapterKind: 'eip-7702-delegation',
      signals: ['high-privilege-call'],
    },
  });

  return { intent, riskAssessment };
}

function testDescriptorAndProfiles(): void {
  const descriptor = cryptoAuthorizationSimulationDescriptor();

  equal(
    descriptor.version,
    CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION,
    'Crypto authorization simulation: descriptor exposes version',
  );
  deepEqual(
    descriptor.outcomes,
    CRYPTO_AUTHORIZATION_SIMULATION_OUTCOMES,
    'Crypto authorization simulation: descriptor exposes outcomes',
  );
  deepEqual(
    descriptor.checks,
    CRYPTO_SIMULATION_CHECKS,
    'Crypto authorization simulation: descriptor exposes checks',
  );
  ok(
    descriptor.standards.includes('ERC-7562'),
    'Crypto authorization simulation: descriptor names UserOperation validation scope',
  );
  ok(
    descriptor.standards.includes('EIP-7702'),
    'Crypto authorization simulation: descriptor names EIP-7702 delegation',
  );
  ok(
    descriptor.standards.includes('ERC-7715'),
    'Crypto authorization simulation: descriptor names wallet permissions',
  );

  const userOperation = cryptoSimulationAdapterPreflightProfile('erc-4337-user-operation');
  ok(
    userOperation.requiredSources.includes('erc-4337-validation'),
    'Crypto authorization simulation: ERC-4337 profile requires UserOperation validation',
  );
  ok(
    userOperation.requiredSources.includes('erc-7562-validation-scope'),
    'Crypto authorization simulation: ERC-4337 profile requires ERC-7562 validation scope',
  );

  const walletCall = cryptoSimulationAdapterPreflightProfile('wallet-call-api');
  deepEqual(
    walletCall.requiredSources,
    ['wallet-capabilities', 'wallet-call-preparation'],
    'Crypto authorization simulation: wallet-call API needs capabilities and prepared-call evidence',
  );

  const delegation = cryptoSimulationAdapterPreflightProfile('eip-7702-delegation');
  deepEqual(
    delegation.requiredSources,
    ['eip-7702-authorization'],
    'Crypto authorization simulation: EIP-7702 profile requires authorization-list evidence',
  );
}

function testCandidateOnlyRequiresReview(): void {
  const suite = fixtureSuite();
  const simulation = createCryptoAuthorizationSimulation({
    intent: suite.intent,
    riskAssessment: suite.riskAssessment,
    simulatedAt: '2026-04-21T09:02:00.000Z',
  });

  equal(
    simulation.outcome,
    'review-required',
    'Crypto authorization simulation: candidate-only Safe bridge requires review',
  );
  equal(
    simulation.confidence,
    'low',
    'Crypto authorization simulation: candidate-only preview has low confidence',
  );
  equal(
    simulation.readiness.releaseBinding,
    'missing',
    'Crypto authorization simulation: release binding readiness is missing',
  );
  equal(
    simulation.readiness.policyBinding,
    'missing',
    'Crypto authorization simulation: policy binding readiness is missing',
  );
  equal(
    simulation.readiness.enforcementBinding,
    'missing',
    'Crypto authorization simulation: enforcement binding readiness is missing',
  );
  equal(
    simulation.readiness.adapterPreflight,
    'missing',
    'Crypto authorization simulation: adapter preflight readiness is missing',
  );
  ok(
    simulation.requiredPreflightSources.includes('safe-guard'),
    'Crypto authorization simulation: Safe guard preflight is required',
  );
  ok(
    simulation.requiredNextArtifacts.includes('release-binding-missing'),
    'Crypto authorization simulation: missing release binding is a next artifact',
  );
  ok(
    simulation.requiredNextArtifacts.includes('required-safe-guard-missing'),
    'Crypto authorization simulation: missing Safe guard preflight is a next artifact',
  );
}

function testFullSafeGuardAllowPreview(): void {
  const suite = fixtureSuite();
  const simulation = createCryptoAuthorizationSimulation({
    intent: suite.intent,
    riskAssessment: suite.riskAssessment,
    releaseBinding: suite.releaseBinding,
    policyScopeBinding: suite.policyScopeBinding,
    enforcementBinding: suite.enforcementBinding,
    simulatedAt: '2026-04-21T09:02:00.000Z',
    preflightSignals: [
      {
        source: 'safe-guard',
        status: 'pass',
        code: 'safe-guard-would-allow',
        message: 'Safe guard dry-run accepted the bound Attestor release.',
        required: true,
        evidence: {
          safeTxHash: '0xsafe',
          chainId: 'eip155:1',
        },
      },
      {
        source: 'wallet-call-preparation',
        status: 'pass',
        code: 'wallet-call-prepared',
        message: 'Wallet call payload is prepared for the bound Safe transaction.',
      },
    ],
    operatorNote: 'Step 11 Safe guard allow preview.',
  });

  equal(
    simulation.outcome,
    'allow-preview',
    'Crypto authorization simulation: complete Safe guard evidence allows preview',
  );
  equal(
    simulation.confidence,
    'high',
    'Crypto authorization simulation: complete evidence has high confidence',
  );
  deepEqual(
    simulation.readiness,
    {
      releaseBinding: 'ready',
      policyBinding: 'ready',
      enforcementBinding: 'ready',
      adapterPreflight: 'ready',
    },
    'Crypto authorization simulation: all readiness gates are ready',
  );
  deepEqual(
    simulation.requiredNextArtifacts,
    [],
    'Crypto authorization simulation: allow preview has no required next artifacts',
  );
  equal(
    simulation.releaseBindingDigest,
    suite.releaseBinding.digest,
    'Crypto authorization simulation: release binding digest is carried',
  );
  equal(
    simulation.policyScopeDigest,
    suite.policyScopeBinding.digest,
    'Crypto authorization simulation: policy scope digest is carried',
  );
  equal(
    simulation.enforcementBindingDigest,
    suite.enforcementBinding.digest,
    'Crypto authorization simulation: enforcement binding digest is carried',
  );
  ok(
    simulation.digest.startsWith('sha256:'),
    'Crypto authorization simulation: result has deterministic digest',
  );
  ok(
    cryptoAuthorizationSimulationLabel(simulation).includes('outcome:allow-preview'),
    'Crypto authorization simulation: label includes outcome',
  );
}

function testMissingRequiredPreflightKeepsReview(): void {
  const suite = fixtureSuite();
  const simulation = createCryptoAuthorizationSimulation({
    intent: suite.intent,
    riskAssessment: suite.riskAssessment,
    releaseBinding: suite.releaseBinding,
    policyScopeBinding: suite.policyScopeBinding,
    enforcementBinding: suite.enforcementBinding,
    simulatedAt: '2026-04-21T09:02:00.000Z',
    preflightSignals: [
      {
        source: 'wallet-call-preparation',
        status: 'pass',
        code: 'wallet-call-prepared',
      },
    ],
  });

  equal(
    simulation.outcome,
    'review-required',
    'Crypto authorization simulation: missing required Safe guard preflight keeps review required',
  );
  equal(
    simulation.confidence,
    'low',
    'Crypto authorization simulation: missing required preflight lowers confidence',
  );
  equal(
    simulation.readiness.adapterPreflight,
    'missing',
    'Crypto authorization simulation: adapter readiness remains missing',
  );
  ok(
    simulation.requiredNextArtifacts.includes('required-safe-guard-missing'),
    'Crypto authorization simulation: missing Safe guard preflight is explicit',
  );
}

function testHardPreflightFailureDenies(): void {
  const suite = fixtureSuite();
  const simulation = createCryptoAuthorizationSimulation({
    intent: suite.intent,
    riskAssessment: suite.riskAssessment,
    releaseBinding: suite.releaseBinding,
    policyScopeBinding: suite.policyScopeBinding,
    enforcementBinding: suite.enforcementBinding,
    simulatedAt: '2026-04-21T09:02:00.000Z',
    preflightSignals: [
      {
        source: 'safe-guard',
        status: 'fail',
        code: 'safe-guard-would-revert',
        message: 'Safe guard dry-run rejected the transaction.',
        required: true,
      },
    ],
  });

  equal(
    simulation.outcome,
    'deny-preview',
    'Crypto authorization simulation: hard adapter preflight failure denies preview',
  );
  equal(
    simulation.confidence,
    'high',
    'Crypto authorization simulation: fail-closed denial has high confidence',
  );
  equal(
    simulation.readiness.adapterPreflight,
    'blocked',
    'Crypto authorization simulation: adapter preflight readiness is blocked',
  );
  ok(
    simulation.reasonCodes.includes('safe-guard-would-revert'),
    'Crypto authorization simulation: adapter failure reason is preserved',
  );
  ok(
    simulation.reasonCodes.includes('execution-preview-denied'),
    'Crypto authorization simulation: execution denial reason is emitted',
  );
}

function testEip7702DelegationRequiresAuthorizationPreflight(): void {
  const candidate = delegationCandidateFixture();
  const simulation = createCryptoAuthorizationSimulation({
    intent: candidate.intent,
    riskAssessment: candidate.riskAssessment,
    simulatedAt: '2026-04-21T09:02:00.000Z',
  });

  equal(
    simulation.outcome,
    'review-required',
    'Crypto authorization simulation: EIP-7702 candidate requires review before evidence',
  );
  equal(
    simulation.adapterKind,
    'eip-7702-delegation',
    'Crypto authorization simulation: EIP-7702 adapter kind is carried',
  );
  deepEqual(
    simulation.requiredPreflightSources,
    ['eip-7702-authorization'],
    'Crypto authorization simulation: EIP-7702 requires delegation authorization preflight',
  );
  ok(
    simulation.requiredNextArtifacts.includes('required-eip-7702-authorization-missing'),
    'Crypto authorization simulation: missing EIP-7702 authorization is explicit',
  );
}

function testMismatchedBindingFailsClosed(): void {
  const suite = fixtureSuite();

  assert.throws(
    () =>
      createCryptoAuthorizationSimulation({
        intent: suite.intent,
        riskAssessment: suite.riskAssessment,
        releaseBinding: {
          ...suite.releaseBinding,
          accountAddress: '0x9999999999999999999999999999999999999999',
        },
        policyScopeBinding: suite.policyScopeBinding,
        enforcementBinding: suite.enforcementBinding,
        simulatedAt: '2026-04-21T09:02:00.000Z',
      }),
    /account/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoAuthorizationSimulation({
        intent: suite.intent,
        riskAssessment: suite.riskAssessment,
        enforcementBinding: suite.enforcementBinding,
        simulatedAt: '2026-04-21T09:02:00.000Z',
      }),
    /release binding/i,
  );
  passed += 1;
}

function main(): void {
  testDescriptorAndProfiles();
  testCandidateOnlyRequiresReview();
  testFullSafeGuardAllowPreview();
  testMissingRequiredPreflightKeepsReview();
  testHardPreflightFailureDenies();
  testEip7702DelegationRequiresAuthorizationPreflight();
  testMismatchedBindingFailsClosed();
  console.log(`crypto authorization core authorization simulation tests passed (${passed} assertions)`);
}

main();
