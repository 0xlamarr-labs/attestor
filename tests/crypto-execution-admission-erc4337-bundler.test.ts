import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  createErc4337BundlerAdmissionHandoff,
  erc4337BundlerAdmissionDescriptor,
  erc4337BundlerAdmissionHandoffLabel,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import type {
  Erc4337UserOperation,
  Erc4337UserOperationObservation,
  Erc4337UserOperationPreflight,
} from '../src/crypto-authorization-core/erc4337-user-operation-adapter.js';
import type { CryptoExecutionAdapterKind } from '../src/crypto-authorization-core/types.js';

let passed = 0;

const SENDER = '0x1111111111111111111111111111111111111111';
const ENTRYPOINT = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108';
const OTHER_ENTRYPOINT = '0x2222222222222222222222222222222222222222';
const CALL_TARGET = '0x3333333333333333333333333333333333333333';
const PAYMASTER = '0x4444444444444444444444444444444444444444';
const USER_OP_HASH = `0x${'ee'.repeat(32)}`;

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
    code: status === 'pass' ? `${source}-ready` : `${source}-missing`,
    message: status === 'pass'
      ? `${source} preflight passed.`
      : `${source} preflight is required.`,
    required: true,
    evidence: {
      source,
      status,
    },
  };
}

function simulationFixture(input: {
  adapterKind: CryptoExecutionAdapterKind;
  outcome: CryptoAuthorizationSimulationResult['outcome'];
  requiredPreflightSources: readonly CryptoSimulationPreflightSource[];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
}): CryptoAuthorizationSimulationResult {
  const preflightStatus = input.preflightStatus ?? 'pass';
  const adapterPreflight = input.adapterReady ?? true;
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: `simulation-${input.adapterKind}`,
    simulatedAt: '2026-04-22T13:00:00.000Z',
    intentId: `intent-${input.adapterKind}`,
    consequenceKind: 'user-operation',
    adapterKind: input.adapterKind,
    chainId: 'eip155:8453',
    accountAddress: SENDER,
    riskClass: 'R3',
    reviewAuthorityMode: 'dual-approval',
    outcome: input.outcome,
    confidence: input.outcome === 'deny-preview' ? 'high' : 'medium',
    reasonCodes: input.outcome === 'deny-preview' ? ['blocked-by-simulation'] : [],
    readiness: {
      releaseBinding: 'ready',
      policyBinding: 'ready',
      enforcementBinding: 'ready',
      adapterPreflight: adapterPreflight
        ? 'ready'
        : preflightStatus === 'fail'
          ? 'blocked'
          : 'missing',
    },
    requiredPreflightSources: input.requiredPreflightSources,
    recommendedPreflightSources: [],
    observations: input.requiredPreflightSources.map((source) =>
      simulationObservation(source, preflightStatus),
    ),
    requiredNextArtifacts: adapterPreflight ? [] : ['missing-adapter-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:${input.adapterKind}-${input.outcome}`,
  };
}

function admittedPlan(
  outcome: CryptoAuthorizationSimulationResult['outcome'] = 'allow-preview',
) {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'erc-4337-user-operation',
      outcome,
      requiredPreflightSources: ['erc-4337-validation', 'erc-7562-validation-scope'],
      preflightStatus: outcome === 'deny-preview' ? 'fail' : 'pass',
      adapterReady: outcome !== 'deny-preview',
    }),
    createdAt: '2026-04-22T13:01:00.000Z',
    integrationRef: 'integration:erc4337:bundler',
  });
}

function adapterObservation(
  check: Erc4337UserOperationObservation['check'],
  status: Erc4337UserOperationObservation['status'] = 'pass',
  code = `${check}-ready`,
): Erc4337UserOperationObservation {
  return {
    check,
    status,
    code,
    message: `${check} ${status}.`,
    required: true,
    evidence: {
      check,
      status,
    },
  };
}

function userOperation(overrides: Partial<Erc4337UserOperation> = {}): Erc4337UserOperation {
  return {
    sender: SENDER,
    nonce: '42',
    entryPoint: ENTRYPOINT,
    entryPointVersion: 'v0.8',
    chainId: 'eip155:8453',
    callData: '0x12345678abcd',
    callTarget: CALL_TARGET,
    callValue: '0',
    callFunctionSelector: '0x12345678',
    callDataClass: 'bounded-call',
    callCount: 1,
    factory: null,
    factoryData: null,
    callGasLimit: '250000',
    verificationGasLimit: '150000',
    preVerificationGas: '60000',
    maxFeePerGas: '1000000000',
    maxPriorityFeePerGas: '100000000',
    paymaster: PAYMASTER,
    paymasterVerificationGasLimit: '40000',
    paymasterPostOpGasLimit: '30000',
    paymasterData: '0xabcd',
    signature: `0x${'11'.repeat(65)}`,
    userOpHash: USER_OP_HASH,
    ...overrides,
  };
}

function preflight(
  overrides: Partial<Erc4337UserOperationPreflight> = {},
): Erc4337UserOperationPreflight {
  return {
    version: 'attestor.crypto-erc4337-user-operation-adapter.v1',
    preflightId: 'erc4337-preflight-001',
    adapterKind: 'erc-4337-user-operation',
    checkedAt: '2026-04-22T13:02:00.000Z',
    bundlerId: 'bundler:test',
    entryPoint: ENTRYPOINT,
    entryPointVersion: 'v0.8',
    sender: SENDER,
    userOpHash: USER_OP_HASH,
    nonce: '42',
    chainId: 'eip155:8453',
    callTarget: CALL_TARGET,
    callFunctionSelector: '0x12345678',
    callDataClass: 'bounded-call',
    paymaster: PAYMASTER,
    factory: null,
    outcome: 'allow',
    signals: [
      {
        source: 'erc-4337-validation',
        status: 'pass',
        code: 'erc4337-user-operation-allow',
        required: true,
        evidence: {
          userOpHash: USER_OP_HASH,
        },
      },
      {
        source: 'erc-7562-validation-scope',
        status: 'pass',
        code: 'erc7562-validation-scope-allow',
        required: true,
        evidence: {
          userOpHash: USER_OP_HASH,
        },
      },
    ],
    observations: [
      adapterObservation('erc4337-bundler-simulation-passed'),
      adapterObservation('erc4337-erc7562-scope-passed'),
      adapterObservation('erc4337-paymaster-readiness'),
    ],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    canonical: '{}',
    digest: 'sha256:erc4337-preflight',
    ...overrides,
  };
}

function gasEstimate() {
  return {
    preVerificationGas: '0xea60',
    verificationGasLimit: '0x249f0',
    callGasLimit: '0x3d090',
    paymasterVerificationGasLimit: '0x9c40',
    paymasterPostOpGasLimit: '0x7530',
  };
}

function testReadyBundlerHandoff(): void {
  const handoff = createErc4337BundlerAdmissionHandoff({
    plan: admittedPlan(),
    preflight: preflight({
      entryPoint: ENTRYPOINT.toUpperCase(),
      sender: SENDER.toUpperCase(),
      userOpHash: USER_OP_HASH.toUpperCase(),
    }),
    userOperation: userOperation(),
    createdAt: '2026-04-22T13:03:00.000Z',
    bundlerChainIdHex: '0x2105',
    supportedEntryPoints: [ENTRYPOINT.toUpperCase()],
    gasEstimate: gasEstimate(),
    bundlerId: 'bundler:pimlico-like',
    bundlerUrl: 'https://bundler.example/rpc',
  });

  equal(handoff.outcome, 'ready', 'ERC-4337 bundler admission: fully evidenced handoff is ready');
  equal(handoff.chainIdHex, '0x2105', 'ERC-4337 bundler admission: CAIP-2 chain id becomes hex');
  equal(
    handoff.sendUserOperationRequest.method,
    'eth_sendUserOperation',
    'ERC-4337 bundler admission: creates send request',
  );
  equal(
    handoff.estimateGasRequest.method,
    'eth_estimateUserOperationGas',
    'ERC-4337 bundler admission: creates gas estimate request',
  );
  equal(
    handoff.sendUserOperationRequest.params[0].nonce,
    '0x2a',
    'ERC-4337 bundler admission: decimal nonce is projected to hex quantity',
  );
  equal(
    handoff.entryPoint,
    ENTRYPOINT,
    'ERC-4337 bundler admission: EntryPoint evidence is normalized before matching',
  );
  equal(
    handoff.sendUserOperationRequest.params[0].paymaster,
    PAYMASTER,
    'ERC-4337 bundler admission: paymaster is preserved',
  );
  ok(
    handoff.methods.includes('eth_getUserOperationReceipt'),
    'ERC-4337 bundler admission: receipt lookup method is included',
  );
  ok(handoff.digest.startsWith('sha256:'), 'ERC-4337 bundler admission: handoff is canonicalized');
}

function testMissingBundlerEvidenceNeedsEvidence(): void {
  const handoff = createErc4337BundlerAdmissionHandoff({
    plan: admittedPlan(),
    preflight: preflight(),
    userOperation: userOperation(),
    createdAt: '2026-04-22T13:04:00.000Z',
  });

  equal(
    handoff.outcome,
    'needs-bundler-evidence',
    'ERC-4337 bundler admission: missing chain/entrypoint/gas evidence is not ready',
  );
  ok(
    handoff.nextActions.includes('Call eth_chainId and eth_supportedEntryPoints before submission.'),
    'ERC-4337 bundler admission: missing evidence asks for bundler discovery',
  );
}

function testUnsupportedEntryPointBlocks(): void {
  const handoff = createErc4337BundlerAdmissionHandoff({
    plan: admittedPlan(),
    preflight: preflight(),
    userOperation: userOperation(),
    createdAt: '2026-04-22T13:05:00.000Z',
    bundlerChainIdHex: '0x2105',
    supportedEntryPoints: [OTHER_ENTRYPOINT],
    gasEstimate: gasEstimate(),
  });

  equal(handoff.outcome, 'blocked', 'ERC-4337 bundler admission: unsupported EntryPoint blocks');
  ok(
    handoff.blockingReasons.includes('entrypoint-unsupported'),
    'ERC-4337 bundler admission: unsupported EntryPoint reason is carried',
  );
}

function testGasEstimateAboveLimitsBlocks(): void {
  const handoff = createErc4337BundlerAdmissionHandoff({
    plan: admittedPlan(),
    preflight: preflight(),
    userOperation: userOperation({
      callGasLimit: '1000',
    }),
    createdAt: '2026-04-22T13:06:00.000Z',
    bundlerChainIdHex: '0x2105',
    supportedEntryPoints: [ENTRYPOINT],
    gasEstimate: gasEstimate(),
  });

  equal(handoff.outcome, 'blocked', 'ERC-4337 bundler admission: gas estimate above limit blocks');
  ok(
    handoff.blockingReasons.includes('useroperation-gas-estimate-exceeds-limits'),
    'ERC-4337 bundler admission: gas limit reason is explicit',
  );
}

function testDeniedPlanAndErc7562FailureBlock(): void {
  const denied = createErc4337BundlerAdmissionHandoff({
    plan: admittedPlan('deny-preview'),
    preflight: preflight(),
    userOperation: userOperation(),
    createdAt: '2026-04-22T13:07:00.000Z',
    bundlerChainIdHex: '0x2105',
    supportedEntryPoints: [ENTRYPOINT],
    gasEstimate: gasEstimate(),
  });
  const erc7562Failed = createErc4337BundlerAdmissionHandoff({
    plan: admittedPlan(),
    preflight: preflight({
      outcome: 'block',
      observations: [
        adapterObservation('erc4337-bundler-simulation-passed'),
        adapterObservation(
          'erc4337-erc7562-scope-passed',
          'fail',
          'erc7562-opcode-rule-violation',
        ),
      ],
    }),
    userOperation: userOperation(),
    createdAt: '2026-04-22T13:08:00.000Z',
    bundlerChainIdHex: '0x2105',
    supportedEntryPoints: [ENTRYPOINT],
    gasEstimate: gasEstimate(),
  });

  equal(denied.outcome, 'blocked', 'ERC-4337 bundler admission: denied plan blocks');
  ok(
    denied.blockingReasons.includes('admission-plan-denied'),
    'ERC-4337 bundler admission: denied plan reason is carried',
  );
  equal(erc7562Failed.outcome, 'blocked', 'ERC-4337 bundler admission: ERC-7562 failure blocks');
  ok(
    erc7562Failed.blockingReasons.includes('erc7562-validation-scope-failed'),
    'ERC-4337 bundler admission: ERC-7562 reason is carried',
  );
}

function testDescriptorAndLabel(): void {
  const descriptor = erc4337BundlerAdmissionDescriptor();
  const handoff = createErc4337BundlerAdmissionHandoff({
    plan: admittedPlan(),
    preflight: preflight(),
    userOperation: userOperation(),
    createdAt: '2026-04-22T13:09:00.000Z',
    bundlerChainIdHex: '0x2105',
    supportedEntryPoints: [ENTRYPOINT],
    gasEstimate: gasEstimate(),
  });

  ok(
    descriptor.methods.includes('eth_sendUserOperation'),
    'ERC-4337 bundler admission: descriptor includes send method',
  );
  ok(
    descriptor.standards.includes('ERC-7769'),
    'ERC-4337 bundler admission: descriptor includes ERC-7769',
  );
  ok(
    erc4337BundlerAdmissionHandoffLabel(handoff).includes('entrypoint:v0.8'),
    'ERC-4337 bundler admission: label includes EntryPoint version',
  );
  deepEqual(
    handoff.getUserOperationReceiptRequest.params,
    [USER_OP_HASH],
    'ERC-4337 bundler admission: receipt lookup is keyed by userOpHash',
  );
}

testReadyBundlerHandoff();
testMissingBundlerEvidenceNeedsEvidence();
testUnsupportedEntryPointBlocks();
testGasEstimateAboveLimitsBlocks();
testDeniedPlanAndErc7562FailureBlock();
testDescriptorAndLabel();

console.log(`Crypto execution admission ERC-4337 bundler tests: ${passed} passed, 0 failed`);
