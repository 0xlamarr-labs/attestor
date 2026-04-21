import assert from 'node:assert/strict';
import {
  CRYPTO_ALLOWANCE_AMOUNT_POSTURES,
  CRYPTO_ALLOWANCE_DURATION_POSTURES,
  CRYPTO_APPROVAL_ALLOWANCE_CHECKS,
  CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION,
  CRYPTO_APPROVAL_ALLOWANCE_MECHANISMS,
  CRYPTO_APPROVAL_ALLOWANCE_OUTCOMES,
  CRYPTO_APPROVAL_MAX_UINT256,
  createCryptoApprovalAllowanceConsequence,
  cryptoApprovalAllowanceConsequenceDescriptor,
  cryptoApprovalAllowanceConsequenceLabel,
} from '../src/crypto-authorization-core/approval-allowance-consequence.js';
import {
  createCryptoAuthorizationSimulation,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import {
  CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
  createCryptoAuthorizationActor,
  createCryptoAuthorizationConstraints,
  createCryptoAuthorizationIntent,
  createCryptoAuthorizationPolicyScope,
  createCryptoExecutionTarget,
} from '../src/crypto-authorization-core/object-model.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const TOKEN_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const SPENDER_ADDRESS = '0x2222222222222222222222222222222222222222';
const OTHER_SPENDER = '0x3333333333333333333333333333333333333333';
const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3';

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

function fixtureAccount() {
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
    assetId: TOKEN_ADDRESS,
    symbol: 'USDC',
    decimals: 6,
  });
}

function fixtureApprovalIntent(options: {
  readonly intentId?: string;
  readonly consequenceKind?: 'approval' | 'transfer' | 'permission-grant';
  readonly functionSelector?: string | null;
  readonly targetAddress?: string | null;
  readonly maxAmount?: string | null;
  readonly budgetId?: string | null;
  readonly validUntil?: string;
} = {}) {
  const chain = fixtureChain();
  const account = fixtureAccount();
  const asset = options.consequenceKind === 'permission-grant' ? null : fixtureAsset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:approval-manager',
    authorityRef: 'authority:crypto-approval-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'contract',
    chain,
    targetId: 'erc20:usdc:allowance',
    address: options.targetAddress === undefined ? TOKEN_ADDRESS : options.targetAddress,
    counterparty: SPENDER_ADDRESS,
    protocol: 'erc20-allowance',
    functionSelector: options.functionSelector === undefined
      ? '0x095ea7b3'
      : options.functionSelector,
    calldataClass: 'erc20-approval',
  });
  const consequenceKind = options.consequenceKind ?? 'approval';
  const dimensions = consequenceKind === 'permission-grant'
    ? ['chain', 'account', 'actor', 'spender', 'validity-window', 'budget', 'risk-tier']
    : consequenceKind === 'transfer'
      ? ['chain', 'account', 'asset', 'counterparty', 'amount', 'risk-tier']
    : ['chain', 'account', 'asset', 'spender', 'amount', 'budget', 'validity-window', 'risk-tier'];
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions,
    environment: 'prod-crypto',
    tenantId: 'tenant-crypto',
    policyPackRef: 'policy-pack:approval:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T08:00:00.000Z',
    validUntil: options.validUntil ?? '2026-04-21T08:10:00.000Z',
    nonce: 'approval:nonce:42',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
    maxAmount: options.maxAmount === undefined ? '1000' : options.maxAmount,
    budgetId: options.budgetId === undefined ? 'budget:daily-usdc-approvals' : options.budgetId,
    cadence: 'daily',
  });

  return createCryptoAuthorizationIntent({
    intentId: options.intentId ?? 'intent-approval-001',
    requestedAt: '2026-04-21T08:00:01.000Z',
    requester,
    account,
    consequenceKind,
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind: 'wallet-call-api',
    evidenceRefs: ['evidence:approval:001'],
  });
}

function codes(consequence: ReturnType<typeof createCryptoApprovalAllowanceConsequence>): readonly string[] {
  return consequence.observations.map((entry) => entry.code);
}

function testDescriptor(): void {
  const descriptor = cryptoApprovalAllowanceConsequenceDescriptor();

  equal(
    descriptor.version,
    CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION,
    'Crypto approval allowance consequence: descriptor exposes version',
  );
  deepEqual(
    descriptor.mechanisms,
    CRYPTO_APPROVAL_ALLOWANCE_MECHANISMS,
    'Crypto approval allowance consequence: descriptor exposes mechanisms',
  );
  deepEqual(
    descriptor.amountPostures,
    CRYPTO_ALLOWANCE_AMOUNT_POSTURES,
    'Crypto approval allowance consequence: descriptor exposes amount postures',
  );
  deepEqual(
    descriptor.durationPostures,
    CRYPTO_ALLOWANCE_DURATION_POSTURES,
    'Crypto approval allowance consequence: descriptor exposes duration postures',
  );
  deepEqual(
    descriptor.outcomes,
    CRYPTO_APPROVAL_ALLOWANCE_OUTCOMES,
    'Crypto approval allowance consequence: descriptor exposes outcomes',
  );
  deepEqual(
    descriptor.checks,
    CRYPTO_APPROVAL_ALLOWANCE_CHECKS,
    'Crypto approval allowance consequence: descriptor exposes checks',
  );
  ok(descriptor.standards.includes('EIP-20'), 'Crypto approval allowance consequence: descriptor names EIP-20');
  ok(descriptor.standards.includes('EIP-2612'), 'Crypto approval allowance consequence: descriptor names EIP-2612');
  ok(descriptor.standards.includes('Permit2'), 'Crypto approval allowance consequence: descriptor names Permit2');
  ok(descriptor.standards.includes('ERC-7674'), 'Crypto approval allowance consequence: descriptor names ERC-7674');
}

function testBoundedApprovalAllows(): void {
  const intent = fixtureApprovalIntent();
  const consequence = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'erc20-approve',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '500',
    currentAllowance: '0',
    normalizedUsd: '500',
    allowanceExpiration: '2026-04-21T08:05:00.000Z',
    revocation: {
      revocable: true,
      method: 'approve-zero',
      authorityRef: 'safe-owner-quorum:2-of-3',
      revocationTarget: TOKEN_ADDRESS,
    },
    isKnownSpender: true,
  });
  const second = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'erc20-approve',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '500',
    currentAllowance: '0',
    normalizedUsd: '500',
    allowanceExpiration: '2026-04-21T08:05:00.000Z',
    revocation: {
      revocable: true,
      method: 'approve-zero',
      authorityRef: 'safe-owner-quorum:2-of-3',
      revocationTarget: TOKEN_ADDRESS,
    },
    isKnownSpender: true,
  });

  equal(consequence.outcome, 'allow', 'Crypto approval allowance consequence: bounded approval allows');
  equal(consequence.riskAssessment.riskClass, 'R4', 'Crypto approval allowance consequence: approval remains R4');
  equal(consequence.mechanism, 'erc20-approve', 'Crypto approval allowance consequence: mechanism is carried');
  equal(consequence.tokenAddress, TOKEN_ADDRESS, 'Crypto approval allowance consequence: token is normalized');
  equal(consequence.spenderAddress, SPENDER_ADDRESS, 'Crypto approval allowance consequence: spender is normalized');
  equal(consequence.resultingAllowance, '500', 'Crypto approval allowance consequence: resulting allowance is projected');
  equal(consequence.signal.source, 'erc-7715-permission', 'Crypto approval allowance consequence: emits permission preflight source');
  equal(consequence.signal.status, 'pass', 'Crypto approval allowance consequence: allow emits pass signal');
  ok(consequence.observations.every((entry) => entry.status === 'pass'), 'Crypto approval allowance consequence: bounded approval observations pass');
  ok(consequence.requiredPolicyDimensions.includes('budget'), 'Crypto approval allowance consequence: approval requires budget dimension');
  ok(consequence.requiredPolicyDimensions.includes('validity-window'), 'Crypto approval allowance consequence: approval requires validity window');
  equal(consequence.digest, second.digest, 'Crypto approval allowance consequence: digest is deterministic');
  ok(
    cryptoApprovalAllowanceConsequenceLabel(consequence).includes('outcome:allow'),
    'Crypto approval allowance consequence: label includes outcome',
  );
}

function testSimulationConsumesApprovalPreflight(): void {
  const intent = fixtureApprovalIntent();
  const consequence = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'erc20-approve',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '25',
    normalizedUsd: '25',
    allowanceExpiration: '2026-04-21T08:05:00.000Z',
    revocation: { revocable: true, method: 'approve-zero' },
  });
  const simulation = createCryptoAuthorizationSimulation({
    intent,
    riskAssessment: consequence.riskAssessment,
    simulatedAt: '2026-04-21T08:02:00.000Z',
    preflightSignals: [consequence.signal],
  });

  ok(
    simulation.requiredPreflightSources.includes('erc-7715-permission'),
    'Crypto approval allowance consequence: approval simulation requires permission source',
  );
  ok(
    simulation.observations.some(
      (entry) =>
        entry.source === 'erc-7715-permission' &&
        entry.status === 'pass',
    ),
    'Crypto approval allowance consequence: approval preflight satisfies permission readiness',
  );
  ok(
    !simulation.requiredNextArtifacts.includes('required-erc-7715-permission-missing'),
    'Crypto approval allowance consequence: permission preflight removes missing-source artifact',
  );
}

function testUnlimitedPersistentApprovalBlocksWithoutExplicitScope(): void {
  const intent = fixtureApprovalIntent({
    intentId: 'intent-unlimited-approval',
    budgetId: null,
  });
  const consequence = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'erc20-approve',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: CRYPTO_APPROVAL_MAX_UINT256,
    currentAllowance: '0',
    amountPosture: 'unlimited',
    revocation: { revocable: false },
  });

  equal(consequence.outcome, 'block', 'Crypto approval allowance consequence: unlimited approval blocks without explicit max scope');
  equal(consequence.signal.status, 'fail', 'Crypto approval allowance consequence: blocked approval emits fail signal');
  ok(codes(consequence).includes('approval-unlimited-requires-explicit-policy'), 'Crypto approval allowance consequence: unlimited policy finding is present');
  ok(codes(consequence).includes('approval-requested-amount-exceeds-intent'), 'Crypto approval allowance consequence: requested amount cap failure is present');
  ok(codes(consequence).includes('approval-expiry-missing'), 'Crypto approval allowance consequence: missing expiry warning is present');
  ok(codes(consequence).includes('approval-revocation-missing'), 'Crypto approval allowance consequence: missing revocation warning is present');
  ok(
    consequence.riskAssessment.findings.some((finding) => finding.code === 'unlimited-approval'),
    'Crypto approval allowance consequence: risk assessment flags unlimited approval',
  );
}

function testPermitEvidenceIsBound(): void {
  const intent = fixtureApprovalIntent({
    intentId: 'intent-permit-approval',
    functionSelector: '0xd505accf',
  });
  const consequence = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'eip-2612-permit',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '300',
    normalizedUsd: '300',
    allowanceExpiration: '2026-04-21T08:06:00.000Z',
    permitDeadline: '2026-04-21T08:08:00.000Z',
    permitNonce: '17',
    permitDomainChainId: 'eip155:1',
    permitDomainVerifyingContract: TOKEN_ADDRESS,
    revocation: { revocable: true, method: 'approve-zero' },
  });
  const missingNonce = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'eip-2612-permit',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '300',
    normalizedUsd: '300',
    allowanceExpiration: '2026-04-21T08:06:00.000Z',
    permitDeadline: '2026-04-21T08:08:00.000Z',
    permitDomainChainId: 'eip155:1',
    permitDomainVerifyingContract: TOKEN_ADDRESS,
    revocation: { revocable: true, method: 'approve-zero' },
  });
  const lateDeadline = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'eip-2612-permit',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '300',
    normalizedUsd: '300',
    allowanceExpiration: '2026-04-21T08:06:00.000Z',
    permitDeadline: '2026-04-21T08:30:00.000Z',
    permitNonce: '18',
    permitDomainChainId: 'eip155:1',
    permitDomainVerifyingContract: TOKEN_ADDRESS,
    revocation: { revocable: true, method: 'approve-zero' },
  });

  equal(consequence.outcome, 'allow', 'Crypto approval allowance consequence: complete EIP-2612 permit allows');
  ok(codes(consequence).includes('approval-permit-evidence-bound'), 'Crypto approval allowance consequence: permit evidence bound code is present');
  equal(missingNonce.outcome, 'block', 'Crypto approval allowance consequence: missing permit nonce blocks');
  ok(codes(missingNonce).includes('approval-permit-nonce-missing'), 'Crypto approval allowance consequence: missing permit nonce code is present');
  equal(lateDeadline.outcome, 'block', 'Crypto approval allowance consequence: late permit deadline blocks');
  ok(codes(lateDeadline).includes('approval-permit-deadline-exceeds-intent'), 'Crypto approval allowance consequence: late permit deadline code is present');
}

function testTransactionScopedApprovalsAllowWithoutPersistentRevocation(): void {
  const intent = fixtureApprovalIntent({
    intentId: 'intent-permit2-signature-transfer',
    functionSelector: null,
  });
  const permit2SignatureTransfer = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'permit2-signature-transfer',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '125',
    normalizedUsd: '125',
    permitDeadline: '2026-04-21T08:04:00.000Z',
    permitNonce: 'permit2:9',
    permitDomainChainId: 'eip155:1',
    permitDomainVerifyingContract: PERMIT2_ADDRESS,
  });
  const temporaryApprove = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'erc-7674-temporary-approve',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '125',
    normalizedUsd: '125',
  });

  equal(
    permit2SignatureTransfer.durationPosture,
    'transaction-scoped',
    'Crypto approval allowance consequence: Permit2 signature transfer is transaction-scoped',
  );
  equal(
    permit2SignatureTransfer.resultingAllowance,
    '0',
    'Crypto approval allowance consequence: Permit2 signature transfer does not persist allowance',
  );
  equal(
    permit2SignatureTransfer.outcome,
    'allow',
    'Crypto approval allowance consequence: transaction-scoped Permit2 transfer allows',
  );
  equal(
    temporaryApprove.durationPosture,
    'transaction-scoped',
    'Crypto approval allowance consequence: ERC-7674 temporary approval is transaction-scoped',
  );
  equal(
    temporaryApprove.outcome,
    'allow',
    'Crypto approval allowance consequence: ERC-7674 temporary approval allows without persistent revocation',
  );
}

function testDecreaseAndRevokeReduceAuthority(): void {
  const intent = fixtureApprovalIntent({
    intentId: 'intent-decrease-approval',
    functionSelector: '0xa457c2d7',
  });
  const decrease = createCryptoApprovalAllowanceConsequence({
    intent,
    mechanism: 'erc20-decrease-allowance',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '200',
    currentAllowance: '500',
    normalizedUsd: '200',
  });
  const revoke = createCryptoApprovalAllowanceConsequence({
    intent: fixtureApprovalIntent({
      intentId: 'intent-revoke-approval',
      functionSelector: '0x095ea7b3',
    }),
    mechanism: 'erc20-approve',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '0',
    currentAllowance: '500',
    normalizedUsd: '0',
  });

  equal(decrease.amountPosture, 'decrease-only', 'Crypto approval allowance consequence: decrease allowance is decrease-only');
  equal(decrease.resultingAllowance, '300', 'Crypto approval allowance consequence: decrease projects resulting allowance');
  equal(decrease.outcome, 'allow', 'Crypto approval allowance consequence: decrease-only authority reduction allows');
  equal(revoke.amountPosture, 'revoke', 'Crypto approval allowance consequence: zero approval is revoke posture');
  equal(revoke.durationPosture, 'revoked', 'Crypto approval allowance consequence: zero approval is revoked duration posture');
  equal(revoke.resultingAllowance, '0', 'Crypto approval allowance consequence: revoke projects zero resulting allowance');
  equal(revoke.outcome, 'allow', 'Crypto approval allowance consequence: revoke approval allows');
}

function testInvalidBindingsFailClosed(): void {
  const mismatchedTarget = createCryptoApprovalAllowanceConsequence({
    intent: fixtureApprovalIntent({
      intentId: 'intent-mismatched-target',
      targetAddress: OTHER_SPENDER,
    }),
    mechanism: 'erc20-approve',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '100',
    normalizedUsd: '100',
    allowanceExpiration: '2026-04-21T08:05:00.000Z',
    revocation: { revocable: true, method: 'approve-zero' },
  });
  const transferIntent = fixtureApprovalIntent({
    intentId: 'intent-transfer-not-approval',
    consequenceKind: 'transfer',
  });
  const wrongIntentKind = createCryptoApprovalAllowanceConsequence({
    intent: transferIntent,
    mechanism: 'erc20-approve',
    spenderAddress: SPENDER_ADDRESS,
    requestedAmount: '100',
    normalizedUsd: '100',
    allowanceExpiration: '2026-04-21T08:05:00.000Z',
    revocation: { revocable: true, method: 'approve-zero' },
  });

  equal(mismatchedTarget.outcome, 'block', 'Crypto approval allowance consequence: mismatched target blocks');
  ok(codes(mismatchedTarget).includes('approval-target-mismatch'), 'Crypto approval allowance consequence: target mismatch code is present');
  equal(wrongIntentKind.outcome, 'block', 'Crypto approval allowance consequence: non-approval intent blocks');
  ok(codes(wrongIntentKind).includes('approval-intent-kind-mismatch'), 'Crypto approval allowance consequence: intent mismatch code is present');

  assert.throws(
    () =>
      createCryptoApprovalAllowanceConsequence({
        intent: fixtureApprovalIntent(),
        mechanism: 'erc20-approve',
        spenderAddress: '0xnot-an-address',
        requestedAmount: '100',
      }),
    /spenderAddress must be an EVM address/i,
  );
  passed += 1;
}

function main(): void {
  testDescriptor();
  testBoundedApprovalAllows();
  testSimulationConsumesApprovalPreflight();
  testUnlimitedPersistentApprovalBlocksWithoutExplicitScope();
  testPermitEvidenceIsBound();
  testTransactionScopedApprovalsAllowWithoutPersistentRevocation();
  testDecreaseAndRevokeReduceAuthority();
  testInvalidBindingsFailClosed();
  console.log(`crypto authorization core approval allowance consequence tests passed (${passed} assertions)`);
}

main();
