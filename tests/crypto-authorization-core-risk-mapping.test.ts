import { strict as assert } from 'node:assert';
import {
  CRYPTO_CONSEQUENCE_AMOUNT_THRESHOLDS_USD,
  CRYPTO_CONSEQUENCE_CONTEXT_SIGNALS,
  CRYPTO_CONSEQUENCE_RISK_FACTOR_KINDS,
  CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION,
  CRYPTO_VALUE_MOVING_CONSEQUENCE_KINDS,
  compareCryptoRiskClass,
  createCryptoConsequenceRiskAssessment,
  cryptoConsequenceRiskAssessmentLabel,
  cryptoConsequenceRiskMappingDescriptor,
  isCryptoConsequenceContextSignal,
  maxCryptoRiskClass,
} from '../src/crypto-authorization-core/consequence-risk-mapping.js';
import {
  createCryptoCanonicalCounterpartyReference,
} from '../src/crypto-authorization-core/canonical-references.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
} from '../src/crypto-authorization-core/types.js';

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

function fixtureChain() {
  return createCryptoChainReference({
    namespace: 'eip155',
    chainId: '1',
  });
}

function fixtureAccount(accountKind: Parameters<typeof createCryptoAccountReference>[0]['accountKind'] = 'eoa') {
  return createCryptoAccountReference({
    accountKind,
    chain: fixtureChain(),
    address: '0x1111111111111111111111111111111111111111',
  });
}

function fixtureAsset(assetKind: Parameters<typeof createCryptoAssetReference>[0]['assetKind'] = 'stablecoin') {
  return createCryptoAssetReference({
    assetKind,
    chain: fixtureChain(),
    assetId: assetKind === 'rwa-token'
      ? '0x2222222222222222222222222222222222222222'
      : '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: assetKind === 'rwa-token' ? 'RWA' : 'USDC',
    decimals: 6,
  });
}

function fixtureCounterparty(counterpartyKind: Parameters<typeof createCryptoCanonicalCounterpartyReference>[0]['counterpartyKind'] = 'account') {
  return createCryptoCanonicalCounterpartyReference({
    counterpartyKind,
    counterpartyId: `${counterpartyKind}:main`,
    chain: fixtureChain(),
  });
}

function findingCodes(assessment: ReturnType<typeof createCryptoConsequenceRiskAssessment>): readonly string[] {
  return assessment.findings.map((finding) => finding.code);
}

function testDescriptorVocabulary(): void {
  const descriptor = cryptoConsequenceRiskMappingDescriptor();

  equal(
    descriptor.version,
    CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION,
    'Crypto consequence risk mapping: descriptor exposes version',
  );
  deepEqual(
    descriptor.factorKinds,
    CRYPTO_CONSEQUENCE_RISK_FACTOR_KINDS,
    'Crypto consequence risk mapping: descriptor exposes factor kinds',
  );
  deepEqual(
    descriptor.contextSignals,
    CRYPTO_CONSEQUENCE_CONTEXT_SIGNALS,
    'Crypto consequence risk mapping: descriptor exposes context signals',
  );
  deepEqual(
    descriptor.valueMovingConsequenceKinds,
    CRYPTO_VALUE_MOVING_CONSEQUENCE_KINDS,
    'Crypto consequence risk mapping: descriptor exposes value-moving consequences',
  );
  deepEqual(
    descriptor.amountThresholdsUsd,
    CRYPTO_CONSEQUENCE_AMOUNT_THRESHOLDS_USD,
    'Crypto consequence risk mapping: descriptor exposes amount thresholds',
  );
  ok(descriptor.consequenceKinds.includes('account-delegation'), 'Crypto consequence risk mapping: descriptor includes delegation consequences');
  ok(descriptor.riskClasses.includes('R4'), 'Crypto consequence risk mapping: descriptor includes R4');
}

function testPredicateAndRiskOrdering(): void {
  ok(isCryptoConsequenceContextSignal('cross-chain'), 'Crypto consequence risk mapping: cross-chain is a context signal');
  ok(isCryptoConsequenceContextSignal('missing-budget'), 'Crypto consequence risk mapping: missing-budget is a context signal');
  ok(!isCryptoConsequenceContextSignal('not-a-signal'), 'Crypto consequence risk mapping: unknown context signal is rejected');
  equal(compareCryptoRiskClass('R4', 'R2') > 0, true, 'Crypto consequence risk mapping: risk comparison orders R4 above R2');
  equal(maxCryptoRiskClass(['R1', 'R3', 'R2']), 'R3', 'Crypto consequence risk mapping: max risk returns highest risk class');
}

function testBaseTransferRisk(): void {
  const assessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'transfer',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '100.00',
      normalizedUsd: '100.00',
    },
    counterparty: fixtureCounterparty(),
    context: {
      isKnownCounterparty: true,
    },
  });

  equal(assessment.defaultRiskClass, 'R3', 'Crypto consequence risk mapping: transfer base risk is R3');
  equal(assessment.riskClass, 'R3', 'Crypto consequence risk mapping: bounded transfer stays R3');
  equal(assessment.review.authorityMode, 'named-reviewer', 'Crypto consequence risk mapping: R3 requires named reviewer');
  equal(assessment.review.minimumReviewerCount, 1, 'Crypto consequence risk mapping: R3 requires one reviewer');
  ok(assessment.review.requiredArtifacts.includes('attestor-release-receipt'), 'Crypto consequence risk mapping: review requires Attestor receipt');
  ok(assessment.review.requiredArtifacts.includes('eip-712-authorization'), 'Crypto consequence risk mapping: EOA review requires EIP-712 artifact');
  ok(assessment.review.requiredArtifacts.includes('execution-proof'), 'Crypto consequence risk mapping: R3 requires execution proof');
  ok(assessment.review.requiredPolicyDimensions.includes('counterparty'), 'Crypto consequence risk mapping: transfer preserves counterparty dimension');
  ok(assessment.digest.startsWith('sha256:'), 'Crypto consequence risk mapping: assessment digest uses sha256');
  equal(
    cryptoConsequenceRiskAssessmentLabel(assessment),
    'consequence:transfer / risk:R3 / account:eoa / asset:stablecoin / counterparty:account / review:named-reviewer',
    'Crypto consequence risk mapping: assessment label is stable',
  );
}

function testAgentPaymentCanStayOperationalWhenBounded(): void {
  const assessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account: fixtureAccount('agent-wallet'),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '5.00',
      normalizedUsd: '5.00',
    },
    context: {
      executionAdapterKind: 'x402-payment',
      hasBudget: true,
      hasExpiry: true,
      signals: ['agent-initiated'],
    },
  });

  equal(assessment.defaultRiskClass, 'R2', 'Crypto consequence risk mapping: agent payment base risk is R2');
  equal(assessment.riskClass, 'R3', 'Crypto consequence risk mapping: agent wallet value movement escalates to R3 accountability');
  ok(findingCodes(assessment).includes('agent-wallet-value-movement'), 'Crypto consequence risk mapping: agent wallet finding is present');
  ok(assessment.review.requiredArtifacts.includes('http-payment-authorization'), 'Crypto consequence risk mapping: agent payment requires HTTP payment authorization');
}

function testMissingAgentPaymentBudgetRequiresReview(): void {
  const assessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '50.00',
      normalizedUsd: '50.00',
    },
    context: {
      executionAdapterKind: 'x402-payment',
      hasBudget: false,
      hasExpiry: false,
    },
  });

  equal(assessment.riskClass, 'R3', 'Crypto consequence risk mapping: missing budget and expiry escalate agent payment to R3');
  ok(findingCodes(assessment).includes('missing-budget'), 'Crypto consequence risk mapping: missing-budget finding is present');
  ok(findingCodes(assessment).includes('missing-expiry'), 'Crypto consequence risk mapping: missing-expiry finding is present');
  ok(assessment.review.requiredPolicyDimensions.includes('budget'), 'Crypto consequence risk mapping: missing budget requires budget dimension');
  ok(assessment.review.requiredPolicyDimensions.includes('validity-window'), 'Crypto consequence risk mapping: missing expiry requires validity window');
}

function testUnlimitedApprovalIsRegulatedGrade(): void {
  const assessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'approval',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      isUnlimitedApproval: true,
    },
    counterparty: fixtureCounterparty('contract'),
    context: {
      hasExpiry: false,
      hasRevocationPath: false,
    },
  });

  equal(assessment.riskClass, 'R4', 'Crypto consequence risk mapping: unlimited approval is R4');
  equal(assessment.review.authorityMode, 'dual-approval', 'Crypto consequence risk mapping: R4 requires dual approval');
  equal(assessment.review.minimumReviewerCount, 2, 'Crypto consequence risk mapping: R4 requires two reviewers');
  ok(findingCodes(assessment).includes('unlimited-approval'), 'Crypto consequence risk mapping: unlimited approval finding is present');
  ok(findingCodes(assessment).includes('missing-revocation'), 'Crypto consequence risk mapping: missing revocation finding is present');
  ok(assessment.review.requiredPolicyDimensions.includes('spender'), 'Crypto consequence risk mapping: approval requires spender dimension');
}

function testAmountThresholdsEscalateDeterministically(): void {
  const reviewAmount = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '10000',
      normalizedUsd: '10000',
    },
  });
  const dualApprovalAmount = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '100000',
      normalizedUsd: '100000',
    },
  });
  const criticalAmount = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '1000000.000001',
      normalizedUsd: '1000000.000001',
    },
  });

  equal(reviewAmount.riskClass, 'R3', 'Crypto consequence risk mapping: review threshold escalates to R3');
  equal(dualApprovalAmount.riskClass, 'R4', 'Crypto consequence risk mapping: dual approval threshold escalates to R4');
  equal(criticalAmount.riskClass, 'R4', 'Crypto consequence risk mapping: critical threshold remains R4');
  ok(findingCodes(criticalAmount).includes('critical-amount'), 'Crypto consequence risk mapping: critical finding is present');
}

function testBridgeAndCrossChainAreR4(): void {
  const assessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'bridge',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '1000',
      normalizedUsd: '1000',
    },
    counterparty: fixtureCounterparty('bridge'),
    context: {
      signals: ['cross-chain'],
    },
  });

  equal(assessment.riskClass, 'R4', 'Crypto consequence risk mapping: bridge execution is R4');
  ok(findingCodes(assessment).includes('bridge-counterparty'), 'Crypto consequence risk mapping: bridge counterparty finding is present');
  ok(findingCodes(assessment).includes('cross-chain'), 'Crypto consequence risk mapping: cross-chain finding is present');
  ok(assessment.review.requiredPolicyDimensions.includes('protocol'), 'Crypto consequence risk mapping: bridge requires protocol dimension');
}

function testDelegationAndModularContext(): void {
  const delegation = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'account-delegation',
    account: fixtureAccount(),
    context: {
      executionAdapterKind: 'eip-7702-delegation',
      hasExpiry: false,
      hasRevocationPath: false,
    },
  });
  const modular = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'contract-call',
    account: fixtureAccount('erc-6900-modular-account'),
    context: {
      executionAdapterKind: 'erc-6900-plugin',
      operationCount: 3,
    },
  });

  equal(delegation.riskClass, 'R4', 'Crypto consequence risk mapping: EIP-7702 delegation is R4');
  ok(findingCodes(delegation).includes('eip-7702-delegation'), 'Crypto consequence risk mapping: delegation adapter finding is present');
  ok(findingCodes(delegation).includes('missing-expiry'), 'Crypto consequence risk mapping: delegation missing-expiry finding is present');
  equal(modular.riskClass, 'R3', 'Crypto consequence risk mapping: modular account extension is review-grade');
  ok(modular.review.requiredArtifacts.includes('erc-1271-validation'), 'Crypto consequence risk mapping: modular account requires ERC-1271 artifact');
  ok(findingCodes(modular).includes('batch-operation'), 'Crypto consequence risk mapping: modular batch finding is present');
}

function testCustodyAndRwaEscalate(): void {
  const custody = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'custody-withdrawal',
    account: fixtureAccount('custody-account'),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '1000',
      normalizedUsd: '1000',
    },
    counterparty: fixtureCounterparty('custody-destination'),
    context: {
      executionAdapterKind: 'custody-cosigner',
      requiresCustodyPolicy: true,
      hasCustodyPolicy: false,
    },
  });
  const rwa = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'transfer',
    account: fixtureAccount(),
    asset: fixtureAsset('rwa-token'),
    amount: {
      assetAmount: '10',
      normalizedUsd: '500',
    },
    counterparty: fixtureCounterparty(),
  });

  equal(custody.riskClass, 'R4', 'Crypto consequence risk mapping: custody withdrawal is R4');
  ok(custody.review.requiredArtifacts.includes('custody-policy-decision'), 'Crypto consequence risk mapping: custody requires custody policy decision');
  ok(findingCodes(custody).includes('custody-policy-missing'), 'Crypto consequence risk mapping: missing custody policy finding is present');
  equal(rwa.riskClass, 'R4', 'Crypto consequence risk mapping: RWA transfer escalates to R4');
  ok(findingCodes(rwa).includes('rwa-token'), 'Crypto consequence risk mapping: RWA finding is present');
}

function testCounterpartyAndMissingAmountFindings(): void {
  const missingCounterparty = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'transfer',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '1',
      normalizedUsd: '1',
    },
  });
  const missingAmount = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account: fixtureAccount(),
    asset: fixtureAsset(),
  });
  const intentSolver = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'swap',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '100',
      normalizedUsd: '100',
    },
    counterparty: fixtureCounterparty('intent-solver'),
    context: {
      signals: ['intent-solver-routing'],
    },
  });

  ok(findingCodes(missingCounterparty).includes('missing-counterparty'), 'Crypto consequence risk mapping: transfer without counterparty is flagged');
  ok(findingCodes(missingAmount).includes('missing-normalized-amount'), 'Crypto consequence risk mapping: value movement without normalized amount is flagged');
  equal(missingAmount.riskClass, 'R3', 'Crypto consequence risk mapping: missing amount escalates agent payment to R3');
  ok(findingCodes(intentSolver).includes('intent-solver-counterparty'), 'Crypto consequence risk mapping: intent solver counterparty is flagged');
  ok(findingCodes(intentSolver).includes('intent-solver-routing'), 'Crypto consequence risk mapping: intent solver routing is flagged');
}

function testDeterministicDigestAndInvalidInputs(): void {
  const left = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '10',
      normalizedUsd: '10',
    },
    context: {
      signals: ['missing-budget', 'agent-initiated'],
    },
  });
  const right = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'agent-payment',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      normalizedUsd: '10',
      assetAmount: '10',
    },
    context: {
      signals: ['agent-initiated', 'missing-budget'],
    },
  });

  equal(left.digest, right.digest, 'Crypto consequence risk mapping: digest is deterministic across signal order');

  assert.throws(
    () =>
      createCryptoConsequenceRiskAssessment({
        consequenceKind: 'agent-payment',
        account: fixtureAccount(),
        amount: {
          normalizedUsd: '-1',
        },
      }),
    /non-negative decimal/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoConsequenceRiskAssessment({
        consequenceKind: 'contract-call',
        account: fixtureAccount(),
        context: {
          operationCount: 0,
        },
      }),
    /positive integer/i,
  );
  passed += 1;

  assert.throws(
    () => maxCryptoRiskClass([]),
    /at least one risk class/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptorVocabulary();
  testPredicateAndRiskOrdering();
  testBaseTransferRisk();
  testAgentPaymentCanStayOperationalWhenBounded();
  testMissingAgentPaymentBudgetRequiresReview();
  testUnlimitedApprovalIsRegulatedGrade();
  testAmountThresholdsEscalateDeterministically();
  testBridgeAndCrossChainAreR4();
  testDelegationAndModularContext();
  testCustodyAndRwaEscalate();
  testCounterpartyAndMissingAmountFindings();
  testDeterministicDigestAndInvalidInputs();

  console.log(`\nCrypto authorization core risk-mapping tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core risk-mapping tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
