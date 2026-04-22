import assert from 'node:assert/strict';
import {
  SAFE_GUARD_INTERFACE_IDS,
  createCryptoExecutionAdmissionPlan,
  createSafeGuardAdmissionReceipt,
  safeGuardAdmissionDescriptor,
  safeGuardAdmissionReceiptLabel,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import type {
  SafeModuleGuardPreflight,
} from '../src/crypto-authorization-core/safe-module-guard-adapter.js';
import type {
  SafeTransactionGuardPreflight,
} from '../src/crypto-authorization-core/safe-transaction-guard-adapter.js';
import type { CryptoExecutionAdapterKind } from '../src/crypto-authorization-core/types.js';

let passed = 0;

const SAFE_ADDRESS = '0x1111111111111111111111111111111111111111';
const TARGET_ADDRESS = '0x2222222222222222222222222222222222222222';
const MODULE_ADDRESS = '0x3333333333333333333333333333333333333333';
const GUARD_ADDRESS = '0x4444444444444444444444444444444444444444';
const SAFE_TX_HASH = `0x${'aa'.repeat(32)}`;
const MODULE_TX_HASH = `0x${'bb'.repeat(32)}`;
const EXECUTION_TX_HASH = `0x${'cc'.repeat(32)}`;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function observation(
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
  const observations = input.requiredPreflightSources.map((source) =>
    observation(source, preflightStatus),
  );
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: `simulation-${input.adapterKind}`,
    simulatedAt: '2026-04-22T12:00:00.000Z',
    intentId: `intent-${input.adapterKind}`,
    consequenceKind: 'bridge',
    adapterKind: input.adapterKind,
    chainId: 'eip155:1',
    accountAddress: SAFE_ADDRESS,
    riskClass: 'R4',
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
    observations,
    requiredNextArtifacts: adapterPreflight ? [] : ['missing-adapter-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:${input.adapterKind}-${input.outcome}`,
  };
}

function planFixture(
  adapterKind: 'safe-guard' | 'safe-module-guard',
  outcome: CryptoAuthorizationSimulationResult['outcome'] = 'allow-preview',
) {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind,
      outcome,
      requiredPreflightSources: adapterKind === 'safe-guard'
        ? ['safe-guard']
        : ['safe-guard', 'module-hook'],
      preflightStatus: outcome === 'deny-preview' ? 'fail' : 'pass',
      adapterReady: outcome !== 'deny-preview',
    }),
    createdAt: '2026-04-22T12:01:00.000Z',
    integrationRef: `integration:${adapterKind}:test`,
  });
}

function transactionPreflight(
  outcome: SafeTransactionGuardPreflight['outcome'] = 'allow',
  hookPhase: SafeTransactionGuardPreflight['hookPhase'] = 'check-transaction',
): SafeTransactionGuardPreflight {
  return {
    version: 'attestor.crypto-safe-transaction-guard-adapter.v1',
    preflightId: 'safe-transaction-preflight-001',
    adapterKind: 'safe-guard',
    hookPhase,
    checkedAt: '2026-04-22T12:02:00.000Z',
    guardAddress: GUARD_ADDRESS,
    safeAddress: SAFE_ADDRESS,
    safeTxHash: SAFE_TX_HASH,
    operation: 'call',
    chainId: 'eip155:1',
    to: TARGET_ADDRESS,
    functionSelector: '0x12345678',
    nonce: '7',
    outcome,
    signal: {
      source: 'safe-guard',
      status: outcome === 'allow' ? 'pass' : outcome === 'block' ? 'fail' : 'warn',
      code: `safe-guard-${outcome}`,
      required: true,
      evidence: {
        safeTxHash: SAFE_TX_HASH,
      },
    },
    observations: [
      {
        check: 'safe-post-execution-status',
        status: 'pass',
        code: 'safe-post-execution-ok',
        message: 'Safe execution status is acceptable.',
        required: true,
        evidence: {
          executionSuccess: true,
        },
      },
    ],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    canonical: '{}',
    digest: 'sha256:safe-transaction-preflight',
  };
}

function modulePreflight(
  hookPhase: SafeModuleGuardPreflight['hookPhase'] = 'check-after-module-execution',
): SafeModuleGuardPreflight {
  return {
    version: 'attestor.crypto-safe-module-guard-adapter.v1',
    preflightId: 'safe-module-preflight-001',
    adapterKind: 'safe-module-guard',
    hookPhase,
    checkedAt: '2026-04-22T12:03:00.000Z',
    moduleGuardAddress: GUARD_ADDRESS,
    safeAddress: SAFE_ADDRESS,
    moduleAddress: MODULE_ADDRESS,
    moduleTxHash: MODULE_TX_HASH,
    operation: 'call',
    chainId: 'eip155:1',
    to: TARGET_ADDRESS,
    functionSelector: '0x12345678',
    moduleNonce: '11',
    outcome: 'allow',
    signals: [
      {
        source: 'safe-guard',
        status: 'pass',
        code: 'safe-module-guard-allow',
        required: true,
        evidence: {
          moduleTxHash: MODULE_TX_HASH,
        },
      },
      {
        source: 'module-hook',
        status: 'pass',
        code: 'module-hook-allow',
        required: true,
        evidence: {
          moduleAddress: MODULE_ADDRESS,
        },
      },
    ],
    observations: [
      {
        check: 'safe-module-post-execution-status',
        status: 'pass',
        code: 'safe-module-post-execution-ok',
        message: 'Safe module execution status is acceptable.',
        required: true,
        evidence: {
          executionSuccess: true,
        },
      },
    ],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    canonical: '{}',
    digest: 'sha256:safe-module-preflight',
  };
}

function installation() {
  return {
    guardAddress: GUARD_ADDRESS,
    expectedGuardAddress: GUARD_ADDRESS,
    safeVersion: '1.5.0',
    supportsErc165: true,
    supportsGuardInterface: true,
    enabledOnSafe: true,
    changedGuardEventObserved: true,
    changedModuleGuardEventObserved: true,
  };
}

function recovery() {
  return {
    guardCanBeRemovedByOwners: true,
    emergencySafeTxPrepared: true,
    recoveryAuthorityRef: 'safe:owners',
    recoveryDelaySeconds: 0,
    moduleCanBeDisabledByOwners: true,
  };
}

function testSafeTransactionGuardReceiptReady(): void {
  const receipt = createSafeGuardAdmissionReceipt({
    plan: planFixture('safe-guard'),
    preflight: transactionPreflight(),
    createdAt: '2026-04-22T12:04:00.000Z',
    installation: installation(),
    recovery: recovery(),
  });

  equal(receipt.kind, 'safe-transaction-guard', 'Safe guard admission: transaction kind is selected');
  equal(receipt.phase, 'pre-execution', 'Safe guard admission: transaction check is pre-execution');
  equal(receipt.outcome, 'ready', 'Safe guard admission: ready preflight creates ready receipt');
  equal(receipt.interfaceId, SAFE_GUARD_INTERFACE_IDS.transactionGuard, 'Safe guard admission: transaction guard interface id is bound');
  equal(receipt.transactionHash, SAFE_TX_HASH, 'Safe guard admission: Safe tx hash is bound');
  ok(receipt.digest.startsWith('sha256:'), 'Safe guard admission: receipt is canonicalized');
}

function testSafeModuleGuardReceiptReady(): void {
  const receipt = createSafeGuardAdmissionReceipt({
    plan: planFixture('safe-module-guard'),
    preflight: modulePreflight(),
    createdAt: '2026-04-22T12:05:00.000Z',
    installation: installation(),
    recovery: recovery(),
    execution: {
      observedAt: '2026-04-22T12:06:00.000Z',
      txHash: EXECUTION_TX_HASH,
      success: true,
      statusEvent: 'ExecutionFromModuleSuccess',
    },
  });

  equal(receipt.kind, 'safe-module-guard', 'Safe guard admission: module kind is selected');
  equal(receipt.phase, 'post-execution', 'Safe guard admission: module after hook is post-execution');
  equal(receipt.outcome, 'ready', 'Safe guard admission: successful module execution is ready');
  equal(receipt.interfaceId, SAFE_GUARD_INTERFACE_IDS.moduleGuard, 'Safe guard admission: module guard interface id is bound');
  equal(receipt.moduleAddress, MODULE_ADDRESS, 'Safe guard admission: module address is bound');
  equal(receipt.execution?.statusEvent, 'ExecutionFromModuleSuccess', 'Safe guard admission: execution status event is recorded');
}

function testUnsafeRecoveryPostureRequiresRecovery(): void {
  const receipt = createSafeGuardAdmissionReceipt({
    plan: planFixture('safe-module-guard'),
    preflight: modulePreflight('check-module-transaction'),
    createdAt: '2026-04-22T12:07:00.000Z',
    installation: installation(),
    recovery: {
      ...recovery(),
      moduleCanBeDisabledByOwners: false,
    },
  });

  equal(receipt.outcome, 'recovery-required', 'Safe guard admission: unsafe recovery posture is not ready');
  ok(
    receipt.blockingReasons.includes('safe-guard-recovery-posture-required'),
    'Safe guard admission: recovery posture reason is explicit',
  );
  ok(
    receipt.nextActions.some((action) => action.includes('emergency Safe transaction')),
    'Safe guard admission: recovery action is explicit',
  );
}

function testDeniedPlanBlocksReceipt(): void {
  const receipt = createSafeGuardAdmissionReceipt({
    plan: planFixture('safe-guard', 'deny-preview'),
    preflight: transactionPreflight('allow'),
    createdAt: '2026-04-22T12:08:00.000Z',
    installation: installation(),
    recovery: recovery(),
  });

  equal(receipt.outcome, 'blocked', 'Safe guard admission: denied plan blocks receipt');
  ok(
    receipt.blockingReasons.includes('admission-plan-denied'),
    'Safe guard admission: denied plan reason is carried',
  );
}

function testWrongSurfaceBlocksReceipt(): void {
  const receipt = createSafeGuardAdmissionReceipt({
    plan: createCryptoExecutionAdmissionPlan({
      simulation: simulationFixture({
        adapterKind: 'wallet-call-api',
        outcome: 'allow-preview',
        requiredPreflightSources: ['wallet-capabilities', 'wallet-call-preparation'],
      }),
      createdAt: '2026-04-22T12:09:00.000Z',
    }),
    preflight: transactionPreflight('allow'),
    createdAt: '2026-04-22T12:10:00.000Z',
    installation: installation(),
    recovery: recovery(),
  });

  equal(receipt.outcome, 'blocked', 'Safe guard admission: non-Safe plan blocks receipt');
  ok(
    receipt.blockingReasons.includes('admission-plan-surface-not-smart-account-guard'),
    'Safe guard admission: wrong surface reason is explicit',
  );
}

function testDescriptorAndLabel(): void {
  const descriptor = safeGuardAdmissionDescriptor();
  const receipt = createSafeGuardAdmissionReceipt({
    plan: planFixture('safe-guard'),
    preflight: transactionPreflight(),
    createdAt: '2026-04-22T12:11:00.000Z',
    installation: installation(),
    recovery: recovery(),
  });

  ok(
    descriptor.kinds.includes('safe-module-guard'),
    'Safe guard admission: descriptor includes module guard kind',
  );
  equal(
    descriptor.interfaceIds.moduleGuard,
    '0x58401ed8',
    'Safe guard admission: descriptor exposes module guard interface id',
  );
  ok(
    safeGuardAdmissionReceiptLabel(receipt).includes('outcome:ready'),
    'Safe guard admission: label includes outcome',
  );
}

testSafeTransactionGuardReceiptReady();
testSafeModuleGuardReceiptReady();
testUnsafeRecoveryPostureRequiresRecovery();
testDeniedPlanBlocksReceipt();
testWrongSurfaceBlocksReceipt();
testDescriptorAndLabel();

console.log(`Crypto execution admission Safe guard tests: ${passed} passed, 0 failed`);
