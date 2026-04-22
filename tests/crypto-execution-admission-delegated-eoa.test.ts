import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  createDelegatedEoaAdmissionHandoff,
  delegatedEoaAdmissionDescriptor,
  delegatedEoaAdmissionHandoffLabel,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import {
  EIP7702_AUTHORIZATION_MAGIC,
  EIP7702_DELEGATION_INDICATOR_PREFIX,
  EIP7702_INITCODE_MARKER,
  EIP7702_SET_CODE_TX_TYPE,
  type Eip7702AccountStateEvidence,
  type Eip7702AuthorizationTupleEvidence,
  type Eip7702DelegateCodeEvidence,
  type Eip7702DelegationPreflight,
  type Eip7702ExecutionEvidence,
  type Eip7702ExecutionPath,
  type Eip7702InitializationEvidence,
  type Eip7702RecoveryEvidence,
  type Eip7702SponsorEvidence,
} from '../src/crypto-authorization-core/eip7702-delegation-adapter.js';

let passed = 0;

const AUTHORITY = '0x1111111111111111111111111111111111111111';
const DELEGATE = '0x2222222222222222222222222222222222222222';
const TARGET = '0x3333333333333333333333333333333333333333';
const ENTRYPOINT = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';
const TX_HASH = `0x${'aa'.repeat(32)}`;
const TUPLE_HASH = `0x${'bb'.repeat(32)}`;
const CODE_HASH = `0x${'cc'.repeat(32)}`;
const INIT_HASH = `0x${'dd'.repeat(32)}`;
const FACTORY_DATA_HASH = `0x${'ee'.repeat(32)}`;

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

function simulationObservation(
  source: CryptoSimulationPreflightSource,
  status: CryptoSimulationObservation['status'],
): CryptoSimulationObservation {
  return {
    check: 'adapter-preflight-readiness',
    source,
    status,
    severity: status === 'fail' ? 'critical' : status === 'pass' ? 'info' : 'warning',
    code: status === 'pass' ? `${source}-ready` : `${source}-needs-attention`,
    message: status === 'pass'
      ? `${source} preflight passed.`
      : `${source} preflight needs more evidence.`,
    required: true,
    evidence: {
      source,
      status,
    },
  };
}

function simulationFixture(input: {
  executionPath?: Eip7702ExecutionPath;
  outcome?: CryptoAuthorizationSimulationResult['outcome'];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
}): CryptoAuthorizationSimulationResult {
  const outcome = input.outcome ?? 'allow-preview';
  const preflightStatus = input.preflightStatus ?? 'pass';
  const adapterReady = input.adapterReady ?? true;
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: 'simulation-eip7702',
    simulatedAt: '2026-04-22T16:00:00.000Z',
    intentId: 'intent-eip7702',
    consequenceKind: 'account-delegation',
    adapterKind: 'eip-7702-delegation',
    chainId: 'eip155:1',
    accountAddress: AUTHORITY,
    riskClass: 'R4',
    reviewAuthorityMode: 'dual-approval',
    outcome,
    confidence: outcome === 'deny-preview' ? 'high' : 'medium',
    reasonCodes: outcome === 'deny-preview' ? ['blocked-by-simulation'] : [],
    readiness: {
      releaseBinding: 'ready',
      policyBinding: 'ready',
      enforcementBinding: 'ready',
      adapterPreflight: adapterReady
        ? 'ready'
        : preflightStatus === 'fail'
          ? 'blocked'
          : 'missing',
    },
    requiredPreflightSources: ['eip-7702-authorization'],
    recommendedPreflightSources: ['wallet-call-preparation'],
    observations: [simulationObservation('eip-7702-authorization', preflightStatus)],
    requiredNextArtifacts: adapterReady ? [] : ['missing-eip7702-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: input.executionPath === undefined
      ? null
      : `Execution path ${input.executionPath}.`,
    canonical: '{}',
    digest: `sha256:eip7702-${outcome}`,
  };
}

function planFixture(
  outcome: CryptoAuthorizationSimulationResult['outcome'] = 'allow-preview',
) {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      outcome,
      preflightStatus: outcome === 'deny-preview' ? 'fail' : 'pass',
      adapterReady: outcome !== 'deny-preview',
    }),
    createdAt: '2026-04-22T16:01:00.000Z',
    integrationRef: 'integration:eip7702:runtime',
  });
}

function preflight(
  executionPath: Eip7702ExecutionPath = 'set-code-transaction',
  overrides: Partial<Eip7702DelegationPreflight> = {},
): Eip7702DelegationPreflight {
  return {
    version: 'attestor.crypto-eip7702-delegation-adapter.v1',
    preflightId: `preflight:${executionPath}`,
    adapterKind: 'eip-7702-delegation',
    checkedAt: '2026-04-22T16:02:00.000Z',
    authorityAddress: AUTHORITY,
    delegationAddress: DELEGATE,
    chainId: 'eip155:1',
    authorizationNonce: '7',
    executionPath,
    target: TARGET,
    functionSelector: '0x12345678',
    outcome: 'allow',
    signal: {
      source: 'eip-7702-authorization',
      status: 'pass',
      code: 'eip7702-preflight-allow',
      required: true,
      evidence: {
        authorityAddress: AUTHORITY,
        delegationAddress: DELEGATE,
      },
    },
    observations: [],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    canonical: '{}',
    digest: `sha256:${executionPath}-preflight`,
    ...overrides,
  };
}

function authorization(
  overrides: Partial<Eip7702AuthorizationTupleEvidence> = {},
): Eip7702AuthorizationTupleEvidence {
  return {
    chainId: '1',
    authorityAddress: AUTHORITY,
    delegationAddress: DELEGATE,
    nonce: '7',
    yParity: '1',
    r: `0x${'12'.repeat(32)}`,
    s: `0x${'34'.repeat(32)}`,
    tupleHash: TUPLE_HASH,
    signatureRecoveredAddress: AUTHORITY,
    signatureValid: true,
    lowS: true,
    ...overrides,
  };
}

function accountState(
  overrides: Partial<Eip7702AccountStateEvidence> = {},
): Eip7702AccountStateEvidence {
  return {
    observedAt: '2026-04-22T16:03:00.000Z',
    chainId: 'eip155:1',
    authorityAddress: AUTHORITY,
    currentNonce: '7',
    codeState: 'empty',
    currentDelegationAddress: null,
    delegationIndicator: null,
    codeHash: null,
    pendingTransactionCount: 0,
    pendingTransactionPolicyCompliant: true,
    ...overrides,
  };
}

function delegateCode(
  overrides: Partial<Eip7702DelegateCodeEvidence> = {},
): Eip7702DelegateCodeEvidence {
  return {
    delegationAddress: DELEGATE,
    delegateCodeHash: CODE_HASH,
    delegateImplementationId: 'delegate.kernel.v1',
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
  executionPath: Eip7702ExecutionPath = 'set-code-transaction',
  overrides: Partial<Eip7702ExecutionEvidence> = {},
): Eip7702ExecutionEvidence {
  return {
    executionPath,
    transactionType: executionPath === 'set-code-transaction' ? EIP7702_SET_CODE_TX_TYPE : null,
    authorizationListLength: 1,
    tupleIndex: 0,
    tupleIsLastValidForAuthority: true,
    authorizationListNonEmpty: true,
    destination: AUTHORITY,
    target: TARGET,
    value: '0',
    data: '0x12345678abcd',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-call',
    batchCallCount: executionPath === 'wallet-call-api' ? 1 : null,
    targetCalldataSigned: true,
    valueSigned: true,
    gasLimitSigned: true,
    nonceSigned: true,
    expirySigned: true,
    runtimeContextBound: true,
    userOperationHash: executionPath === 'erc-4337-user-operation' ? TX_HASH : null,
    entryPoint: executionPath === 'erc-4337-user-operation' ? ENTRYPOINT : null,
    initCodeMarker: executionPath === 'erc-4337-user-operation' ? EIP7702_INITCODE_MARKER : null,
    factoryDataHash: executionPath === 'erc-4337-user-operation' ? FACTORY_DATA_HASH : null,
    eip7702AuthIncluded: executionPath === 'erc-4337-user-operation' ? true : null,
    preVerificationGasIncludesAuthorizationCost:
      executionPath === 'erc-4337-user-operation' ? true : null,
    walletCapabilityObserved: executionPath === 'wallet-call-api' ? true : null,
    walletCapabilitySupported: executionPath === 'wallet-call-api' ? true : null,
    walletCapabilityRequested: executionPath === 'wallet-call-api' ? true : null,
    atomicRequired: executionPath === 'wallet-call-api' ? true : null,
    postExecutionSuccess: null,
    ...overrides,
  };
}

function initialization(
  overrides: Partial<Eip7702InitializationEvidence> = {},
): Eip7702InitializationEvidence {
  return {
    initializationRequired: true,
    initializationCalldataHash: INIT_HASH,
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
    recoveryAuthorityRef: 'recovery:treasury',
    ...overrides,
  };
}

function testReadySetCodeHandoff(): void {
  const handoff = createDelegatedEoaAdmissionHandoff({
    plan: planFixture(),
    preflight: preflight('set-code-transaction', {
      authorityAddress: AUTHORITY.toUpperCase(),
      delegationAddress: DELEGATE.toUpperCase(),
      target: TARGET.toUpperCase(),
    }),
    authorization: authorization(),
    accountState: accountState(),
    delegateCode: delegateCode(),
    execution: execution('set-code-transaction'),
    initialization: initialization(),
    sponsor: sponsor(),
    recovery: recovery(),
    createdAt: '2026-04-22T16:04:00.000Z',
    runtimeId: 'runtime:eip7702-direct',
  });

  equal(handoff.outcome, 'ready', 'Delegated EOA admission: direct set-code handoff is ready');
  equal(handoff.chainIdHex, '0x1', 'Delegated EOA admission: CAIP-2 chain id becomes hex');
  equal(
    handoff.setCodeTransactionType,
    EIP7702_SET_CODE_TX_TYPE,
    'Delegated EOA admission: set-code transaction type is surfaced',
  );
  equal(
    handoff.authorizationMagic,
    EIP7702_AUTHORIZATION_MAGIC,
    'Delegated EOA admission: authorization magic is surfaced',
  );
  equal(
    handoff.delegationIndicatorPrefix,
    EIP7702_DELEGATION_INDICATOR_PREFIX,
    'Delegated EOA admission: delegation indicator prefix is surfaced',
  );
  ok(
    handoff.runtimeChecks.some((entry) => entry.check === 'setCodeTransactionType'),
    'Delegated EOA admission: runtime checks include direct set-code requirement',
  );
  ok(
    delegatedEoaAdmissionHandoffLabel(handoff).includes('path:set-code-transaction'),
    'Delegated EOA admission: label includes execution path',
  );
}

function testWalletCapabilityMissing(): void {
  const handoff = createDelegatedEoaAdmissionHandoff({
    plan: planFixture(),
    preflight: preflight('wallet-call-api'),
    authorization: authorization(),
    accountState: accountState(),
    delegateCode: delegateCode(),
    execution: execution('wallet-call-api', {
      walletCapabilityObserved: null,
      walletCapabilityRequested: null,
      walletCapabilitySupported: null,
    }),
    initialization: initialization(),
    sponsor: sponsor(),
    recovery: recovery(),
    createdAt: '2026-04-22T16:05:00.000Z',
    walletProviderId: 'wallet:embedded',
  });

  equal(
    handoff.outcome,
    'needs-runtime-evidence',
    'Delegated EOA admission: missing wallet capability evidence pauses execution',
  );
  equal(
    handoff.expectations.find((entry) => entry.kind === 'wallet-capability')?.status,
    'missing',
    'Delegated EOA admission: wallet capability expectation becomes missing',
  );
  deepEqual(
    handoff.walletCapability,
    {
      required: true,
      observed: null,
      supported: null,
      requested: null,
      atomicRequired: true,
    },
    'Delegated EOA admission: wallet capability posture is surfaced in the handoff',
  );
}

function testWalletCapabilityUnsupportedBlocks(): void {
  const handoff = createDelegatedEoaAdmissionHandoff({
    plan: planFixture(),
    preflight: preflight('wallet-call-api'),
    authorization: authorization(),
    accountState: accountState(),
    delegateCode: delegateCode(),
    execution: execution('wallet-call-api', {
      walletCapabilityObserved: true,
      walletCapabilityRequested: true,
      walletCapabilitySupported: false,
    }),
    initialization: initialization(),
    sponsor: sponsor(),
    recovery: recovery(),
    createdAt: '2026-04-22T16:06:00.000Z',
  });

  equal(
    handoff.outcome,
    'blocked',
    'Delegated EOA admission: unsupported wallet capability blocks execution',
  );
  ok(
    handoff.blockingReasons.includes('eip7702-wallet-capability-unsupported'),
    'Delegated EOA admission: blocking reason names unsupported wallet capability',
  );
  equal(
    handoff.expectations.find((entry) => entry.kind === 'wallet-capability')?.status,
    'unsupported',
    'Delegated EOA admission: wallet capability expectation becomes unsupported',
  );
}

function testDelegateCodePostureBlocks(): void {
  const handoff = createDelegatedEoaAdmissionHandoff({
    plan: planFixture(),
    preflight: preflight(),
    authorization: authorization(),
    accountState: accountState(),
    delegateCode: delegateCode({
      audited: false,
      allowlisted: false,
    }),
    execution: execution(),
    initialization: initialization(),
    sponsor: sponsor(),
    recovery: recovery(),
    createdAt: '2026-04-22T16:07:00.000Z',
  });

  equal(
    handoff.outcome,
    'blocked',
    'Delegated EOA admission: bad delegate-code posture blocks execution',
  );
  equal(
    handoff.expectations.find((entry) => entry.kind === 'delegate-code')?.reasonCode,
    'eip7702-delegate-code-posture-blocked',
    'Delegated EOA admission: delegate-code expectation uses explicit posture reason',
  );
}

function testErc4337PathReady(): void {
  const handoff = createDelegatedEoaAdmissionHandoff({
    plan: planFixture(),
    preflight: preflight('erc-4337-user-operation'),
    authorization: authorization(),
    accountState: accountState(),
    delegateCode: delegateCode(),
    execution: execution('erc-4337-user-operation'),
    initialization: initialization(),
    sponsor: sponsor(),
    recovery: recovery(),
    createdAt: '2026-04-22T16:08:00.000Z',
  });

  equal(
    handoff.outcome,
    'ready',
    'Delegated EOA admission: ERC-4337 delegated EOA handoff can be ready',
  );
  equal(
    handoff.execution.initCodeMarker,
    EIP7702_INITCODE_MARKER,
    'Delegated EOA admission: ERC-4337 path carries the EIP-7702 initcode marker',
  );
  ok(
    handoff.runtimeChecks.some(
      (entry) => entry.check === 'preVerificationGasIncludesAuthorizationCost',
    ),
    'Delegated EOA admission: ERC-4337 runtime checks include authorization gas coverage',
  );
  equal(
    handoff.execution.entryPoint,
    ENTRYPOINT,
    'Delegated EOA admission: ERC-4337 entry point is surfaced',
  );
}

function testRuntimeObservationFailureBlocks(): void {
  const handoff = createDelegatedEoaAdmissionHandoff({
    plan: planFixture(),
    preflight: preflight(),
    authorization: authorization(),
    accountState: accountState(),
    delegateCode: delegateCode(),
    execution: execution(),
    initialization: initialization(),
    sponsor: sponsor(),
    recovery: recovery(),
    createdAt: '2026-04-22T16:09:00.000Z',
    runtimeObservation: {
      observedAt: '2026-04-22T16:10:00.000Z',
      txHash: TX_HASH,
      success: false,
      receiptStatus: 'reverted',
      codeState: 'delegated',
      delegationAddress: DELEGATE,
      nonce: '8',
    },
  });

  equal(
    handoff.outcome,
    'blocked',
    'Delegated EOA admission: failed runtime observation blocks the handoff',
  );
  ok(
    handoff.blockingReasons.includes('eip7702-post-execution-failed'),
    'Delegated EOA admission: runtime failure is preserved as a blocking reason',
  );
  equal(
    handoff.expectations.find((entry) => entry.kind === 'post-execution')?.status,
    'failed',
    'Delegated EOA admission: post-execution expectation becomes failed on runtime failure',
  );
}

function testDescriptor(): void {
  const descriptor = delegatedEoaAdmissionDescriptor();

  equal(
    descriptor.version,
    'attestor.crypto-delegated-eoa-admission-handoff.v1',
    'Delegated EOA admission: descriptor exposes version',
  );
  ok(
    descriptor.standards.includes('EIP-7702'),
    'Delegated EOA admission: descriptor references EIP-7702',
  );
  ok(
    descriptor.runtimeChecks.includes('eip7702Auth'),
    'Delegated EOA admission: descriptor lists eip7702Auth runtime check',
  );
}

testReadySetCodeHandoff();
testWalletCapabilityMissing();
testWalletCapabilityUnsupportedBlocks();
testDelegateCodePostureBlocks();
testErc4337PathReady();
testRuntimeObservationFailureBlocks();
testDescriptor();

console.log(`crypto execution admission delegated EOA tests passed (${passed} assertions)`);
