import assert from 'node:assert/strict';
import {
  EIP7702_ACCOUNT_CODE_STATES,
  EIP7702_AUTHORIZATION_MAGIC,
  EIP7702_CHECKS,
  EIP7702_DELEGATION_ADAPTER_SPEC_VERSION,
  EIP7702_DELEGATION_INDICATOR_PREFIX,
  EIP7702_EXECUTION_PATHS,
  EIP7702_INITCODE_MARKER,
  EIP7702_OUTCOMES,
  EIP7702_SET_CODE_TX_TYPE,
  createEip7702DelegationPreflight,
  eip7702DelegationAdapterDescriptor,
  eip7702DelegationPreflightLabel,
  simulateEip7702DelegationAuthorization,
  type Eip7702AccountStateEvidence,
  type Eip7702AuthorizationTupleEvidence,
  type Eip7702DelegateCodeEvidence,
  type Eip7702ExecutionEvidence,
  type Eip7702InitializationEvidence,
  type Eip7702RecoveryEvidence,
  type Eip7702SponsorEvidence,
} from '../src/crypto-authorization-core/eip7702-delegation-adapter.js';
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
  createCryptoEoaSignatureValidationProjection,
} from '../src/crypto-authorization-core/erc1271-validation-projection.js';
import {
  createCryptoReplayFreshnessRules,
  evaluateCryptoAuthorizationFreshness,
} from '../src/crypto-authorization-core/replay-freshness-rules.js';
import {
  createCryptoEip712AuthorizationEnvelope,
} from '../src/crypto-authorization-core/eip712-authorization-envelope.js';
import {
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
  createCryptoCanonicalReferenceBundle,
} from '../src/crypto-authorization-core/canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
  type CryptoConsequenceRiskAssessment,
} from '../src/crypto-authorization-core/consequence-risk-mapping.js';
import {
  createCryptoAccountReference,
  createCryptoChainReference,
  type CryptoExecutionAdapterKind,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const TARGET_ADDRESS = '0x2222222222222222222222222222222222222222';
const DELEGATE_ADDRESS = '0x3333333333333333333333333333333333333333';
const ENTRYPOINT_ADDRESS = '0x4444444444444444444444444444444444444444';
const SPONSOR_ADDRESS = '0x5555555555555555555555555555555555555555';
const OTHER_ADDRESS = '0x6666666666666666666666666666666666666666';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const TUPLE_HASH = `0x${'aa'.repeat(32)}`;
const DELEGATE_CODE_HASH = `0x${'bb'.repeat(32)}`;
const USER_OP_HASH = `0x${'cc'.repeat(32)}`;
const INIT_DATA_HASH = `0x${'dd'.repeat(32)}`;
const SPIFFE_ID = 'spiffe://attestor.test/ns/crypto/sa/eip7702-delegation';
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

function fixtureEoaAccount() {
  return createCryptoAccountReference({
    accountKind: 'eoa',
    chain: fixtureChain(),
    address: ACCOUNT_ADDRESS,
    accountLabel: 'Treasury EOA',
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
  executionAdapterKind: CryptoExecutionAdapterKind = 'eip-7702-delegation',
): FixtureSuite {
  const chain = fixtureChain();
  const account = fixtureEoaAccount();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:treasury-eip7702',
    authorityRef: 'authority:treasury-eip7702-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'contract',
    chain,
    targetId: 'contract:bounded-delegated-call',
    address: TARGET_ADDRESS,
    counterparty: 'contract:bounded-delegated-call',
    protocol: 'eip7702-delegate-protocol',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-delegated-call',
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
    nonce: 'authorization-list:nonce:7',
    replayProtectionMode: 'authorization-list-nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
    budgetId: 'budget:eip7702:daily',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: `intent-crypto-eip7702-delegation-${executionAdapterKind}`,
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'account-delegation',
    target,
    policyScope,
    constraints,
    executionAdapterKind,
    evidenceRefs: [
      'evidence:crypto-eip7702-delegation:001',
      'policy:activation:001',
    ],
  });
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain,
    account,
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'account-delegation',
    account,
    context: {
      executionAdapterKind,
      signals: ['agent-initiated'],
      hasExpiry: true,
      hasBudget: true,
      hasRevocationPath: true,
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'eoa-signer',
    authorityId: 'eoa:treasury',
    validationMode: 'eip-712-eoa',
    address: ACCOUNT_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: `decision-crypto-eip7702-delegation-${executionAdapterKind}`,
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: `release-crypto-eip7702-delegation-${executionAdapterKind}`,
    reasonCodes: ['policy-allow', 'eip7702-delegation-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: `envelope-crypto-eip7702-delegation-${executionAdapterKind}`,
    receiptId: `receipt-crypto-eip7702-delegation-${executionAdapterKind}`,
    intent,
    decision: cryptoDecision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: VERIFYING_CONTRACT,
  });
  const signatureValidation = createCryptoEoaSignatureValidationProjection({
    envelope,
    signature: SIGNATURE,
    expectedSigner: ACCOUNT_ADDRESS,
    adapterKind: executionAdapterKind,
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
      sourceKind: 'eip-7702-authority-nonce',
    },
  });
  const releaseBinding = createCryptoReleaseDecisionBinding({
    intent,
    cryptoDecision,
    riskAssessment,
    envelope,
    signatureValidation,
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
    requestId: `erq_crypto_eip7702_delegation_${executionAdapterKind.replaceAll('-', '_')}`,
    receivedAt: '2026-04-21T09:01:00.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.crypto.eip7702-delegation',
      workloadId: SPIFFE_ID,
    },
    traceId: 'trace-crypto-eip7702-delegation-001',
    idempotencyKey: 'idem-crypto-eip7702-delegation-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function authorization(
  overrides: Partial<Eip7702AuthorizationTupleEvidence> = {},
): Eip7702AuthorizationTupleEvidence {
  return {
    chainId: '1',
    authorityAddress: ACCOUNT_ADDRESS,
    delegationAddress: DELEGATE_ADDRESS,
    nonce: '7',
    yParity: '1',
    r: `0x${'12'.repeat(32)}`,
    s: `0x${'34'.repeat(32)}`,
    tupleHash: TUPLE_HASH,
    signatureRecoveredAddress: ACCOUNT_ADDRESS,
    signatureValid: true,
    lowS: true,
    ...overrides,
  };
}

function accountState(
  overrides: Partial<Eip7702AccountStateEvidence> = {},
): Eip7702AccountStateEvidence {
  return {
    observedAt: '2026-04-21T09:02:00.000Z',
    chainId: 'eip155:1',
    authorityAddress: ACCOUNT_ADDRESS,
    currentNonce: '7',
    codeState: 'empty',
    currentDelegationAddress: null,
    delegationIndicator: null,
    codeHash: null,
    pendingTransactionCount: 1,
    pendingTransactionPolicyCompliant: true,
    ...overrides,
  };
}

function delegateCode(
  overrides: Partial<Eip7702DelegateCodeEvidence> = {},
): Eip7702DelegateCodeEvidence {
  return {
    delegationAddress: DELEGATE_ADDRESS,
    delegateCodeHash: DELEGATE_CODE_HASH,
    delegateImplementationId: 'delegate.safe-eip7702.1.0.0',
    audited: true,
    allowlisted: true,
    storageLayoutSafe: true,
    supportsReplayProtection: true,
    supportsTargetCalldataBinding: true,
    supportsValueBinding: true,
    supportsGasBinding: true,
    supportsExpiryBinding: true,
    ...overrides,
  };
}

function execution(
  overrides: Partial<Eip7702ExecutionEvidence> = {},
): Eip7702ExecutionEvidence {
  return {
    executionPath: 'set-code-transaction',
    transactionType: EIP7702_SET_CODE_TX_TYPE,
    authorizationListLength: 1,
    tupleIndex: 0,
    tupleIsLastValidForAuthority: true,
    authorizationListNonEmpty: true,
    destination: ACCOUNT_ADDRESS,
    target: TARGET_ADDRESS,
    value: '0',
    data: '0x12345678abcdef',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-delegated-call',
    batchCallCount: 1,
    targetCalldataSigned: true,
    valueSigned: true,
    gasLimitSigned: true,
    nonceSigned: true,
    expirySigned: true,
    runtimeContextBound: true,
    userOperationHash: null,
    entryPoint: null,
    initCodeMarker: null,
    factoryDataHash: null,
    eip7702AuthIncluded: null,
    preVerificationGasIncludesAuthorizationCost: null,
    walletCapabilityObserved: null,
    walletCapabilitySupported: null,
    walletCapabilityRequested: null,
    atomicRequired: null,
    postExecutionSuccess: null,
    ...overrides,
  };
}

function initialization(
  overrides: Partial<Eip7702InitializationEvidence> = {},
): Eip7702InitializationEvidence {
  return {
    initializationRequired: true,
    initializationCalldataHash: INIT_DATA_HASH,
    initializationSignedByAuthority: true,
    initializationExecutedBeforeValidation: true,
    frontRunProtected: true,
    ...overrides,
  };
}

function sponsor(overrides: Partial<Eip7702SponsorEvidence> = {}): Eip7702SponsorEvidence {
  return {
    sponsored: false,
    sponsorAddress: null,
    sponsorBondRequired: null,
    sponsorBondPresent: null,
    reimbursementBound: null,
    ...overrides,
  };
}

function recovery(overrides: Partial<Eip7702RecoveryEvidence> = {}): Eip7702RecoveryEvidence {
  return {
    revocationPathReady: true,
    zeroAddressClearSupported: true,
    privateKeyStillControlsAccountAcknowledged: true,
    emergencyDelegateResetPrepared: true,
    recoveryAuthorityRef: 'authority:treasury-eip7702-recovery',
    ...overrides,
  };
}

function preflightInput() {
  return {
    ...fixtureSuite(),
    authorization: authorization(),
    accountState: accountState(),
    delegateCode: delegateCode(),
    execution: execution(),
    initialization: initialization(),
    sponsor: sponsor(),
    recovery: recovery(),
  };
}

function testDescriptor(): void {
  const descriptor = eip7702DelegationAdapterDescriptor();

  equal(
    descriptor.version,
    EIP7702_DELEGATION_ADAPTER_SPEC_VERSION,
    'EIP-7702 delegation adapter: descriptor exposes version',
  );
  equal(
    descriptor.transactionType,
    EIP7702_SET_CODE_TX_TYPE,
    'EIP-7702 delegation adapter: descriptor exposes set-code transaction type',
  );
  equal(
    descriptor.authorizationMagic,
    EIP7702_AUTHORIZATION_MAGIC,
    'EIP-7702 delegation adapter: descriptor exposes authorization magic',
  );
  equal(
    descriptor.delegationIndicatorPrefix,
    EIP7702_DELEGATION_INDICATOR_PREFIX,
    'EIP-7702 delegation adapter: descriptor exposes delegation indicator prefix',
  );
  equal(
    descriptor.initCodeMarker,
    EIP7702_INITCODE_MARKER,
    'EIP-7702 delegation adapter: descriptor exposes initCode marker',
  );
  deepEqual(
    descriptor.executionPaths,
    EIP7702_EXECUTION_PATHS,
    'EIP-7702 delegation adapter: descriptor exposes execution paths',
  );
  deepEqual(
    descriptor.accountCodeStates,
    EIP7702_ACCOUNT_CODE_STATES,
    'EIP-7702 delegation adapter: descriptor exposes account code states',
  );
  deepEqual(
    descriptor.outcomes,
    EIP7702_OUTCOMES,
    'EIP-7702 delegation adapter: descriptor exposes outcomes',
  );
  deepEqual(
    descriptor.checks,
    EIP7702_CHECKS,
    'EIP-7702 delegation adapter: descriptor exposes checks',
  );
  ok(
    descriptor.references.includes('EIP-7702'),
    'EIP-7702 delegation adapter: descriptor names EIP-7702',
  );
  ok(
    descriptor.references.includes('ERC-4337'),
    'EIP-7702 delegation adapter: descriptor names ERC-4337 integration',
  );
  ok(
    descriptor.references.includes('ERC-7902'),
    'EIP-7702 delegation adapter: descriptor names wallet capability integration',
  );
}

function testCreatesAllowPreflight(): void {
  const input = preflightInput();
  const preflight = createEip7702DelegationPreflight(input);
  const second = createEip7702DelegationPreflight(input);

  equal(
    preflight.version,
    EIP7702_DELEGATION_ADAPTER_SPEC_VERSION,
    'EIP-7702 delegation adapter: preflight carries version',
  );
  equal(
    preflight.adapterKind,
    'eip-7702-delegation',
    'EIP-7702 delegation adapter: preflight carries adapter kind',
  );
  equal(
    preflight.outcome,
    'allow',
    'EIP-7702 delegation adapter: complete set-code preflight allows',
  );
  equal(
    preflight.signal.source,
    'eip-7702-authorization',
    'EIP-7702 delegation adapter: emits EIP-7702 simulation source',
  );
  equal(
    preflight.signal.status,
    'pass',
    'EIP-7702 delegation adapter: allow signal passes',
  );
  equal(
    preflight.authorityAddress,
    ACCOUNT_ADDRESS,
    'EIP-7702 delegation adapter: binds authority address',
  );
  equal(
    preflight.delegationAddress,
    DELEGATE_ADDRESS,
    'EIP-7702 delegation adapter: binds delegation code target',
  );
  equal(
    preflight.digest,
    second.digest,
    'EIP-7702 delegation adapter: preflight digest is deterministic',
  );
  ok(
    preflight.observations.every((entry) => entry.status === 'pass'),
    'EIP-7702 delegation adapter: all allow observations pass',
  );
  ok(
    eip7702DelegationPreflightLabel(preflight).includes('outcome:allow'),
    'EIP-7702 delegation adapter: label includes outcome',
  );
}

function testSimulationAllowsDelegation(): void {
  const result = simulateEip7702DelegationAuthorization(preflightInput());

  equal(
    result.preflight.outcome,
    'allow',
    'EIP-7702 delegation adapter: simulation wrapper carries allow preflight',
  );
  equal(
    result.simulation.outcome,
    'allow-preview',
    'EIP-7702 delegation adapter: delegated EOA execution allows simulation preview',
  );
  equal(
    result.simulation.readiness.adapterPreflight,
    'ready',
    'EIP-7702 delegation adapter: simulation adapter preflight is ready',
  );
  deepEqual(
    result.simulation.requiredPreflightSources,
    ['eip-7702-authorization'],
    'EIP-7702 delegation adapter: simulation requires EIP-7702 authorization evidence',
  );
  deepEqual(
    result.simulation.requiredNextArtifacts,
    [],
    'EIP-7702 delegation adapter: allow simulation has no required next artifacts',
  );
}

function testErc4337PathAllows(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    execution: execution({
      executionPath: 'erc-4337-user-operation',
      transactionType: null,
      userOperationHash: USER_OP_HASH,
      entryPoint: ENTRYPOINT_ADDRESS,
      initCodeMarker: EIP7702_INITCODE_MARKER,
      factoryDataHash: INIT_DATA_HASH,
      eip7702AuthIncluded: true,
      preVerificationGasIncludesAuthorizationCost: true,
    }),
  });

  equal(
    preflight.outcome,
    'allow',
    'EIP-7702 delegation adapter: ERC-4337 UserOperation path allows',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-erc4337-posture-ready'),
    'EIP-7702 delegation adapter: ERC-4337 readiness reason is present',
  );
}

function testWalletCapabilityPathAllows(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    execution: execution({
      executionPath: 'wallet-call-api',
      walletCapabilityRequested: true,
      walletCapabilityObserved: true,
      walletCapabilitySupported: true,
      atomicRequired: true,
    }),
  });

  equal(
    preflight.outcome,
    'allow',
    'EIP-7702 delegation adapter: wallet-call capability path allows',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-wallet-capability-ready'),
    'EIP-7702 delegation adapter: wallet capability readiness reason is present',
  );
}

function testNonceMismatchBlocks(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    authorization: authorization({ nonce: '8' }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: stale authority nonce blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-authority-nonce-stale'),
    'EIP-7702 delegation adapter: stale nonce reason is present',
  );
}

function testChainMismatchBlocks(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    authorization: authorization({ chainId: '10' }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: wrong tuple chain blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-authorization-chain-mismatch'),
    'EIP-7702 delegation adapter: wrong chain reason is present',
  );
}

function testInvalidSignatureBlocks(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    authorization: authorization({ signatureValid: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: invalid authorization tuple signature blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-authorization-signature-invalid'),
    'EIP-7702 delegation adapter: invalid signature reason is present',
  );
}

function testDelegateCodeNotApprovedBlocks(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    delegateCode: delegateCode({ allowlisted: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: unapproved delegate code blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-delegate-code-not-approved'),
    'EIP-7702 delegation adapter: unapproved delegate code reason is present',
  );
}

function testAccountCodeStateBlocks(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    accountState: accountState({
      codeState: 'other-code',
      codeHash: `0x${'ef'.repeat(32)}`,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: non-delegation account code blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-account-has-nondelegation-code'),
    'EIP-7702 delegation adapter: non-delegation code reason is present',
  );
}

function testAuthorizationListMustBeNonEmptyAndLastValid(): void {
  const empty = createEip7702DelegationPreflight({
    ...preflightInput(),
    execution: execution({ authorizationListLength: 0, authorizationListNonEmpty: false }),
  });
  const superseded = createEip7702DelegationPreflight({
    ...preflightInput(),
    execution: execution({ authorizationListLength: 2, tupleIsLastValidForAuthority: false }),
  });

  equal(
    empty.outcome,
    'block',
    'EIP-7702 delegation adapter: empty authorization list blocks',
  );
  ok(
    empty.observations.some((entry) => entry.code === 'eip7702-authorization-list-empty'),
    'EIP-7702 delegation adapter: empty authorization list reason is present',
  );
  equal(
    superseded.outcome,
    'block',
    'EIP-7702 delegation adapter: superseded authorization tuple blocks',
  );
  ok(
    superseded.observations.some((entry) => entry.code === 'eip7702-authorization-tuple-not-last-valid'),
    'EIP-7702 delegation adapter: superseded tuple reason is present',
  );
}

function testCallScopeMustBeSigned(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    execution: execution({ targetCalldataSigned: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: unsigned call scope blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-call-scope-not-signed'),
    'EIP-7702 delegation adapter: unsigned call scope reason is present',
  );
}

function testInitializationMustBeFrontRunProtected(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    initialization: initialization({ frontRunProtected: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: unprotected initialization blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-initialization-not-protected'),
    'EIP-7702 delegation adapter: initialization reason is present',
  );
}

function testErc4337PathRequiresGasAccounting(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    execution: execution({
      executionPath: 'erc-4337-user-operation',
      transactionType: null,
      userOperationHash: USER_OP_HASH,
      entryPoint: ENTRYPOINT_ADDRESS,
      initCodeMarker: EIP7702_INITCODE_MARKER,
      eip7702AuthIncluded: true,
      preVerificationGasIncludesAuthorizationCost: false,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: ERC-4337 path without auth gas accounting blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-erc4337-posture-not-ready'),
    'EIP-7702 delegation adapter: ERC-4337 gas accounting reason is present',
  );
}

function testWalletCapabilityMustBeSupported(): void {
  const preflight = createEip7702DelegationPreflight({
    ...preflightInput(),
    execution: execution({
      executionPath: 'wallet-call-api',
      walletCapabilityRequested: true,
      walletCapabilityObserved: true,
      walletCapabilitySupported: false,
    }),
  });

  equal(
    preflight.outcome,
    'block',
    'EIP-7702 delegation adapter: unsupported wallet capability blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'eip7702-wallet-capability-missing'),
    'EIP-7702 delegation adapter: unsupported wallet capability reason is present',
  );
}

function testSponsorRecoveryAndPendingPostureBlock(): void {
  const sponsorBlocked = createEip7702DelegationPreflight({
    ...preflightInput(),
    sponsor: sponsor({
      sponsored: true,
      sponsorAddress: SPONSOR_ADDRESS,
      sponsorBondRequired: true,
      sponsorBondPresent: false,
      reimbursementBound: true,
    }),
  });
  const recoveryBlocked = createEip7702DelegationPreflight({
    ...preflightInput(),
    recovery: recovery({ emergencyDelegateResetPrepared: false }),
  });
  const pendingBlocked = createEip7702DelegationPreflight({
    ...preflightInput(),
    accountState: accountState({
      pendingTransactionCount: 2,
      pendingTransactionPolicyCompliant: false,
    }),
  });

  equal(
    sponsorBlocked.outcome,
    'block',
    'EIP-7702 delegation adapter: unbonded sponsor blocks',
  );
  ok(
    sponsorBlocked.observations.some((entry) => entry.code === 'eip7702-sponsor-posture-not-ready'),
    'EIP-7702 delegation adapter: sponsor reason is present',
  );
  equal(
    recoveryBlocked.outcome,
    'block',
    'EIP-7702 delegation adapter: missing recovery posture blocks',
  );
  ok(
    recoveryBlocked.observations.some((entry) => entry.code === 'eip7702-revocation-and-recovery-missing'),
    'EIP-7702 delegation adapter: recovery reason is present',
  );
  equal(
    pendingBlocked.outcome,
    'block',
    'EIP-7702 delegation adapter: unsafe pending transaction posture blocks',
  );
  ok(
    pendingBlocked.observations.some((entry) => entry.code === 'eip7702-pending-transaction-risk'),
    'EIP-7702 delegation adapter: pending transaction reason is present',
  );
}

function testTargetMismatchAndWrongAdapterReject(): void {
  const targetMismatch = createEip7702DelegationPreflight({
    ...preflightInput(),
    execution: execution({ target: OTHER_ADDRESS }),
  });

  equal(
    targetMismatch.outcome,
    'block',
    'EIP-7702 delegation adapter: target mismatch blocks',
  );
  ok(
    targetMismatch.observations.some((entry) => entry.code === 'eip7702-target-mismatch'),
    'EIP-7702 delegation adapter: target mismatch reason is present',
  );
  assert.throws(
    () => createEip7702DelegationPreflight({
      ...fixtureSuite('safe-guard'),
      authorization: authorization(),
      accountState: accountState(),
      delegateCode: delegateCode(),
      execution: execution(),
      initialization: initialization(),
      sponsor: sponsor(),
      recovery: recovery(),
    }),
    /eip-7702-delegation/,
  );
  passed += 1;
}

testDescriptor();
testCreatesAllowPreflight();
testSimulationAllowsDelegation();
testErc4337PathAllows();
testWalletCapabilityPathAllows();
testNonceMismatchBlocks();
testChainMismatchBlocks();
testInvalidSignatureBlocks();
testDelegateCodeNotApprovedBlocks();
testAccountCodeStateBlocks();
testAuthorizationListMustBeNonEmptyAndLastValid();
testCallScopeMustBeSigned();
testInitializationMustBeFrontRunProtected();
testErc4337PathRequiresGasAccounting();
testWalletCapabilityMustBeSupported();
testSponsorRecoveryAndPendingPostureBlock();
testTargetMismatchAndWrongAdapterReject();

console.log(`crypto-authorization-core-eip7702-delegation-adapter: ${passed} checks passed`);
