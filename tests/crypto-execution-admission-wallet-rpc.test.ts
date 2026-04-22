import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  createWalletRpcAdmissionHandoff,
  walletRpcAdmissionDescriptor,
  walletRpcAdmissionHandoffLabel,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import type { CryptoExecutionAdapterKind } from '../src/crypto-authorization-core/types.js';

let passed = 0;

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const DAPP = '0x3333333333333333333333333333333333333333';

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
  adapterKind: CryptoExecutionAdapterKind | null;
  outcome: CryptoAuthorizationSimulationResult['outcome'];
  requiredPreflightSources?: readonly CryptoSimulationPreflightSource[];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
}): CryptoAuthorizationSimulationResult {
  const requiredPreflightSources = input.requiredPreflightSources ?? [];
  const preflightStatus = input.preflightStatus ?? 'pass';
  const adapterPreflight = input.adapterReady ?? true;
  const observations = requiredPreflightSources.map((source) =>
    observation(source, preflightStatus),
  );
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: `simulation-${input.adapterKind ?? 'neutral'}`,
    simulatedAt: '2026-04-22T10:00:00.000Z',
    intentId: `intent-${input.adapterKind ?? 'neutral'}`,
    consequenceKind: input.adapterKind === 'wallet-call-api'
      ? 'batch-call'
      : input.adapterKind === 'x402-payment'
        ? 'agent-payment'
        : 'transfer',
    adapterKind: input.adapterKind,
    chainId: 'eip155:8453',
    accountAddress: ACCOUNT,
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
    requiredPreflightSources,
    recommendedPreflightSources: [],
    observations,
    requiredNextArtifacts: adapterPreflight ? [] : ['missing-adapter-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:${input.adapterKind ?? 'neutral'}-${input.outcome}`,
  };
}

function admittedWalletPlan() {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'wallet-call-api',
      outcome: 'allow-preview',
      requiredPreflightSources: ['wallet-capabilities', 'wallet-call-preparation'],
    }),
    createdAt: '2026-04-22T11:00:00.000Z',
    integrationRef: 'integration:wallet-rpc:test',
  });
}

function testReadyWalletSendCallsHandoff(): void {
  const handoff = createWalletRpcAdmissionHandoff({
    plan: admittedWalletPlan(),
    createdAt: '2026-04-22T11:01:00.000Z',
    dappDomain: 'app.example',
    calls: [
      {
        to: TARGET,
        value: '0x1',
        data: '0x1234',
      },
      {
        to: TARGET,
        data: '0xabcd',
      },
    ],
    atomicRequired: true,
    capabilities: {
      validityTimeRange: {
        validAfter: '0x1',
        validUntil: '0x2',
      },
    },
    walletCapabilities: {
      '0x2105': {
        atomic: { status: 'supported' },
        validityTimeRange: { supported: true },
      },
    },
  });

  equal(handoff.outcome, 'ready', 'wallet RPC admission: supported calls are ready');
  equal(handoff.chainIdHex, '0x2105', 'wallet RPC admission: CAIP-2 chain id becomes EIP-155 hex');
  equal(
    handoff.capabilityDiscoveryRequest.method,
    'wallet_getCapabilities',
    'wallet RPC admission: creates capability discovery request',
  );
  deepEqual(
    handoff.capabilityDiscoveryRequest.params,
    [ACCOUNT, ['0x2105']],
    'wallet RPC admission: capability discovery is scoped to account and chain',
  );
  equal(
    handoff.sendCallsRequest?.method,
    'wallet_sendCalls',
    'wallet RPC admission: creates sendCalls request',
  );
  equal(
    handoff.sendCallsRequest?.params[0].atomicRequired,
    true,
    'wallet RPC admission: preserves atomic execution requirement',
  );
  ok(
    handoff.sendCallsRequest?.params[0].capabilities?.attestorAdmission.optional === true,
    'wallet RPC admission: Attestor metadata is an optional wallet capability',
  );
  ok(
    handoff.methods.includes('wallet_getCallsStatus'),
    'wallet RPC admission: status polling method is included',
  );
  ok(handoff.digest.startsWith('sha256:'), 'wallet RPC admission: handoff is canonicalized');
}

function testErc7715PermissionHandoff(): void {
  const handoff = createWalletRpcAdmissionHandoff({
    plan: admittedWalletPlan(),
    createdAt: '2026-04-22T11:02:00.000Z',
    requestedPermissions: [
      {
        to: DAPP,
        permission: {
          type: 'native-token-allowance',
          isAdjustmentAllowed: false,
          data: {
            allowance: '0x64',
          },
        },
        rules: [
          {
            type: 'expiry',
            data: {
              timestamp: 1776762200,
            },
          },
        ],
      },
    ],
    supportedExecutionPermissions: {
      'native-token-allowance': {
        chainIds: ['0x2105'],
        ruleTypes: ['expiry'],
      },
    },
  });

  equal(
    handoff.outcome,
    'ready',
    'wallet RPC admission: supported ERC-7715 request is ready',
  );
  equal(
    handoff.permissionRequest?.method,
    'wallet_requestExecutionPermissions',
    'wallet RPC admission: creates permission request',
  );
  equal(
    handoff.supportedExecutionPermissionsRequest?.method,
    'wallet_getSupportedExecutionPermissions',
    'wallet RPC admission: creates supported-permissions discovery request',
  );
  equal(
    handoff.permissionRequest?.params[0][0]?.permission.type,
    'native-token-allowance',
    'wallet RPC admission: preserves requested permission type',
  );
  equal(
    handoff.permissionExpectations[0]?.observedStatus,
    'supported',
    'wallet RPC admission: supported permission is recognized',
  );
  ok(
    handoff.methods.includes('wallet_getGrantedExecutionPermissions'),
    'wallet RPC admission: granted-permission lookup method is included',
  );
}

function testUnsupportedRequiredErc7902CapabilityBlocks(): void {
  const handoff = createWalletRpcAdmissionHandoff({
    plan: admittedWalletPlan(),
    createdAt: '2026-04-22T11:03:00.000Z',
    calls: [
      {
        to: TARGET,
        data: '0x1234',
      },
    ],
    capabilities: {
      eip7702Auth: {
        authorization: '0x1234',
      },
    },
    walletCapabilities: {
      '0x2105': {
        eip7702Auth: { supported: false },
      },
    },
  });

  equal(
    handoff.outcome,
    'blocked',
    'wallet RPC admission: unsupported required ERC-7902 capability blocks',
  );
  ok(
    handoff.blockingReasons.includes('required-capability-eip7702Auth-unsupported'),
    'wallet RPC admission: unsupported EIP-7702 wallet capability is named',
  );
  ok(
    handoff.nextActions[0]?.includes('Do not call wallet_sendCalls'),
    'wallet RPC admission: blocked handoff fails closed before wallet submission',
  );
}

function testMissingWalletEvidenceDoesNotPretendReady(): void {
  const handoff = createWalletRpcAdmissionHandoff({
    plan: admittedWalletPlan(),
    createdAt: '2026-04-22T11:04:00.000Z',
    calls: [
      {
        to: TARGET,
        data: '0x1234',
      },
    ],
    atomicRequired: true,
  });

  equal(
    handoff.outcome,
    'needs-wallet-evidence',
    'wallet RPC admission: missing capability evidence is not ready',
  );
  ok(
    handoff.nextActions.includes('Call wallet_getCapabilities for the account and chain before submission.'),
    'wallet RPC admission: missing capability evidence asks for discovery',
  );
}

function testDeniedOrWrongSurfacePlansBlock(): void {
  const deniedPlan = createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'wallet-call-api',
      outcome: 'deny-preview',
      requiredPreflightSources: ['wallet-capabilities'],
      preflightStatus: 'fail',
      adapterReady: false,
    }),
    createdAt: '2026-04-22T11:05:00.000Z',
  });
  const wrongSurfacePlan = createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind: 'x402-payment',
      outcome: 'allow-preview',
      requiredPreflightSources: ['x402-payment'],
    }),
    createdAt: '2026-04-22T11:06:00.000Z',
  });

  const denied = createWalletRpcAdmissionHandoff({
    plan: deniedPlan,
    createdAt: '2026-04-22T11:07:00.000Z',
    calls: [{ to: TARGET, data: '0x1234' }],
  });
  const wrongSurface = createWalletRpcAdmissionHandoff({
    plan: wrongSurfacePlan,
    createdAt: '2026-04-22T11:08:00.000Z',
    calls: [{ to: TARGET, data: '0x1234' }],
  });

  equal(denied.outcome, 'blocked', 'wallet RPC admission: denied plan blocks');
  ok(
    denied.blockingReasons.includes('admission-plan-denied'),
    'wallet RPC admission: denied plan reason is carried',
  );
  equal(wrongSurface.outcome, 'blocked', 'wallet RPC admission: non-wallet plan blocks');
  ok(
    wrongSurface.blockingReasons.includes('admission-plan-surface-not-wallet-rpc'),
    'wallet RPC admission: wrong surface reason is carried',
  );
}

function testDescriptorAndLabel(): void {
  const descriptor = walletRpcAdmissionDescriptor();
  const handoff = createWalletRpcAdmissionHandoff({
    plan: admittedWalletPlan(),
    createdAt: '2026-04-22T11:09:00.000Z',
    calls: [{ to: TARGET, data: '0x1234' }],
    walletCapabilities: {
      '0x2105': {
        atomic: { status: 'supported' },
      },
    },
  });

  ok(
    descriptor.methods.includes('wallet_sendCalls'),
    'wallet RPC admission: descriptor includes sendCalls',
  );
  ok(
    descriptor.erc7902Capabilities.includes('eip7702Auth'),
    'wallet RPC admission: descriptor includes ERC-7902 EIP-7702 capability',
  );
  ok(
    walletRpcAdmissionHandoffLabel(handoff).includes('chain:0x2105'),
    'wallet RPC admission: label carries chain id',
  );
}

testReadyWalletSendCallsHandoff();
testErc7715PermissionHandoff();
testUnsupportedRequiredErc7902CapabilityBlocks();
testMissingWalletEvidenceDoesNotPretendReady();
testDeniedOrWrongSurfacePlansBlock();
testDescriptorAndLabel();

console.log(`Crypto execution admission wallet RPC tests: ${passed} passed, 0 failed`);
