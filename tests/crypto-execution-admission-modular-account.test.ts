import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  createModularAccountAdmissionHandoff,
  modularAccountAdmissionDescriptor,
  modularAccountAdmissionHandoffLabel,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import type {
  ModularAccountAdapterKind,
  ModularAccountAdapterPreflight,
  ModularAccountCheck,
  ModularAccountObservation,
} from '../src/crypto-authorization-core/modular-account-adapters.js';
import type { CryptoExecutionAdapterKind } from '../src/crypto-authorization-core/types.js';

let passed = 0;

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const MODULE = '0x2222222222222222222222222222222222222222';
const PLUGIN = '0x3333333333333333333333333333333333333333';
const TARGET = '0x4444444444444444444444444444444444444444';
const OPERATION_HASH = `0x${'ab'.repeat(32)}`;
const HOOK_DATA_HASH = `0x${'cd'.repeat(32)}`;
const MANIFEST_HASH = `0x${'ef'.repeat(32)}`;
const RUNTIME_TX_HASH = `0x${'12'.repeat(32)}`;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
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
  outcome?: CryptoAuthorizationSimulationResult['outcome'];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
}): CryptoAuthorizationSimulationResult {
  const outcome = input.outcome ?? 'allow-preview';
  const preflightStatus = input.preflightStatus ?? 'pass';
  const adapterPreflight = input.adapterReady ?? true;
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: `simulation-${input.adapterKind}`,
    simulatedAt: '2026-04-22T14:00:00.000Z',
    intentId: `intent-${input.adapterKind}`,
    consequenceKind: 'contract-call',
    adapterKind: input.adapterKind,
    chainId: 'eip155:1',
    accountAddress: ACCOUNT,
    riskClass: 'R3',
    reviewAuthorityMode: 'dual-approval',
    outcome,
    confidence: outcome === 'deny-preview' ? 'high' : 'medium',
    reasonCodes: outcome === 'deny-preview' ? ['blocked-by-simulation'] : [],
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
    requiredPreflightSources: ['module-hook'],
    recommendedPreflightSources: [],
    observations: [simulationObservation('module-hook', preflightStatus)],
    requiredNextArtifacts: adapterPreflight ? [] : ['missing-module-hook-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:${input.adapterKind}-${outcome}`,
  };
}

function planFixture(
  adapterKind: CryptoExecutionAdapterKind,
  outcome: CryptoAuthorizationSimulationResult['outcome'] = 'allow-preview',
) {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture({
      adapterKind,
      outcome,
      preflightStatus: outcome === 'deny-preview' ? 'fail' : 'pass',
      adapterReady: outcome !== 'deny-preview',
    }),
    createdAt: '2026-04-22T14:01:00.000Z',
    integrationRef: `integration:${adapterKind}:runtime`,
  });
}

function adapterObservation(
  check: ModularAccountCheck,
  status: ModularAccountObservation['status'] = 'pass',
  code = `${check}-ready`,
): ModularAccountObservation {
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

function observations(overrides: readonly ModularAccountObservation[] = []) {
  const base = [
    adapterObservation('modular-module-installed'),
    adapterObservation('modular-module-type-supported'),
    adapterObservation('modular-execution-mode-supported'),
    adapterObservation('modular-function-selector-matches-intent'),
    adapterObservation('modular-runtime-validation-passed'),
    adapterObservation('modular-hooks-passed'),
    adapterObservation('modular-plugin-manifest-bound'),
    adapterObservation('modular-recovery-posture-ready'),
  ];
  return [
    ...base.filter(
      (entry) => !overrides.some((override) => override.check === entry.check),
    ),
    ...overrides,
  ];
}

function preflight(
  adapterKind: ModularAccountAdapterKind,
  overrides: Partial<ModularAccountAdapterPreflight> = {},
): ModularAccountAdapterPreflight {
  return {
    version: 'attestor.crypto-modular-account-adapters.v1',
    preflightId: `modular-preflight-${adapterKind}`,
    adapterKind,
    moduleStandard: adapterKind === 'erc-6900-plugin' ? 'erc-6900' : 'erc-7579',
    checkedAt: '2026-04-22T14:02:00.000Z',
    accountAddress: ACCOUNT,
    moduleAddress: adapterKind === 'erc-6900-plugin' ? PLUGIN : MODULE,
    moduleKind: adapterKind === 'erc-6900-plugin' ? 'plugin' : 'executor',
    operationHash: OPERATION_HASH,
    executionFunction: adapterKind === 'erc-6900-plugin'
      ? 'executeFromPlugin'
      : 'executeFromExecutor',
    validationFunction: adapterKind === 'erc-6900-plugin'
      ? 'runtime-validation'
      : 'validateUserOp',
    chainId: 'eip155:1',
    target: TARGET,
    functionSelector: '0x12345678',
    nonce: '17',
    outcome: 'allow',
    signal: {
      source: 'module-hook',
      status: 'pass',
      code: 'modular-account-adapter-allow',
      required: true,
      evidence: {
        operationHash: OPERATION_HASH,
        hookDataHash: HOOK_DATA_HASH,
        pluginManifestHash: adapterKind === 'erc-6900-plugin' ? MANIFEST_HASH : null,
      },
    },
    observations: observations(),
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    canonical: '{}',
    digest: `sha256:${adapterKind}-preflight`,
    ...overrides,
  };
}

function testErc7579ReadyHandoff(): void {
  const handoff = createModularAccountAdmissionHandoff({
    plan: planFixture('erc-7579-module'),
    preflight: preflight('erc-7579-module', {
      accountAddress: ACCOUNT.toUpperCase(),
      moduleAddress: MODULE.toUpperCase(),
      target: TARGET.toUpperCase(),
      operationHash: OPERATION_HASH.toUpperCase(),
    }),
    createdAt: '2026-04-22T14:03:00.000Z',
    runtimeId: 'runtime:kernel-7579',
    accountImplementationId: 'vendor.account.1.0.0',
    executionMode: `0x${'00'.repeat(32)}`,
  });

  equal(handoff.outcome, 'ready', 'Modular account admission: ERC-7579 handoff is ready');
  equal(handoff.moduleTypeId, '2', 'Modular account admission: ERC-7579 executor module type id is projected');
  equal(handoff.accountAddress, ACCOUNT, 'Modular account admission: account address is normalized');
  ok(
    handoff.requiredInterfaces.includes('IERC7579Execution.executeFromExecutor'),
    'Modular account admission: ERC-7579 execution interface is required',
  );
  ok(
    handoff.runtimeChecks.some((entry) => entry.check === 'supportsExecutionMode'),
    'Modular account admission: ERC-7579 execution mode check is required',
  );
  ok(handoff.digest.startsWith('sha256:'), 'Modular account admission: handoff is canonicalized');
}

function testErc6900ReadyHandoff(): void {
  const handoff = createModularAccountAdmissionHandoff({
    plan: planFixture('erc-6900-plugin'),
    preflight: preflight('erc-6900-plugin'),
    createdAt: '2026-04-22T14:04:00.000Z',
    runtimeId: 'runtime:kernel-6900',
  });

  equal(handoff.outcome, 'ready', 'Modular account admission: ERC-6900 handoff is ready');
  equal(
    handoff.pluginManifestHash,
    MANIFEST_HASH,
    'Modular account admission: ERC-6900 manifest hash is carried from signal evidence',
  );
  ok(
    handoff.requiredInterfaces.includes('IERC6900ExecutionModule.executionManifest'),
    'Modular account admission: ERC-6900 execution manifest interface is required',
  );
  ok(
    handoff.runtimeChecks.some((entry) => entry.check === 'executeWithRuntimeValidation'),
    'Modular account admission: ERC-6900 runtime validation check is required',
  );
  ok(
    modularAccountAdmissionHandoffLabel(handoff).includes('adapter:erc-6900-plugin'),
    'Modular account admission: label includes adapter kind',
  );
}

function testMissingErc6900ManifestNeedsEvidence(): void {
  const handoff = createModularAccountAdmissionHandoff({
    plan: planFixture('erc-6900-plugin'),
    preflight: preflight('erc-6900-plugin', {
      signal: {
        source: 'module-hook',
        status: 'pass',
        code: 'modular-account-adapter-allow',
        required: true,
        evidence: {
          operationHash: OPERATION_HASH,
          hookDataHash: HOOK_DATA_HASH,
        },
      },
    }),
    createdAt: '2026-04-22T14:05:00.000Z',
  });

  equal(
    handoff.outcome,
    'needs-runtime-evidence',
    'Modular account admission: ERC-6900 missing manifest hash needs evidence',
  );
  ok(
    handoff.expectations.some((entry) => entry.reasonCode === 'erc6900-plugin-manifest-hash-missing'),
    'Modular account admission: missing manifest reason is explicit',
  );
}

function testHookFailureBlocks(): void {
  const handoff = createModularAccountAdmissionHandoff({
    plan: planFixture('erc-7579-module'),
    preflight: preflight('erc-7579-module', {
      observations: observations([
        adapterObservation('modular-hooks-passed', 'fail', 'modular-hooks-failed'),
      ]),
    }),
    createdAt: '2026-04-22T14:06:00.000Z',
  });

  equal(handoff.outcome, 'blocked', 'Modular account admission: failed hook evidence blocks');
  ok(
    handoff.blockingReasons.includes('modular-hooks-failed'),
    'Modular account admission: hook failure reason is carried',
  );
}

function testDeniedPlanAndRuntimeFailureBlock(): void {
  const denied = createModularAccountAdmissionHandoff({
    plan: planFixture('erc-7579-module', 'deny-preview'),
    preflight: preflight('erc-7579-module'),
    createdAt: '2026-04-22T14:07:00.000Z',
  });
  const runtimeFailed = createModularAccountAdmissionHandoff({
    plan: planFixture('erc-6900-plugin'),
    preflight: preflight('erc-6900-plugin'),
    createdAt: '2026-04-22T14:08:00.000Z',
    runtimeObservation: {
      observedAt: '2026-04-22T14:08:30.000Z',
      txHash: RUNTIME_TX_HASH,
      success: false,
      eventName: 'ExecutionFailed',
    },
  });

  equal(denied.outcome, 'blocked', 'Modular account admission: denied plan blocks');
  ok(
    denied.blockingReasons.includes('admission-plan-denied'),
    'Modular account admission: denied reason is carried',
  );
  equal(runtimeFailed.outcome, 'blocked', 'Modular account admission: failed runtime observation blocks');
  ok(
    runtimeFailed.blockingReasons.includes('modular-runtime-post-execution-failed'),
    'Modular account admission: runtime failure reason is carried',
  );
}

function testWrongSurfaceAndDescriptor(): void {
  const wrongSurface = createModularAccountAdmissionHandoff({
    plan: planFixture('wallet-call-api'),
    preflight: preflight('erc-7579-module'),
    createdAt: '2026-04-22T14:09:00.000Z',
  });
  const descriptor = modularAccountAdmissionDescriptor();

  equal(wrongSurface.outcome, 'blocked', 'Modular account admission: wrong plan surface blocks');
  ok(
    wrongSurface.blockingReasons.includes('modular-account-plan-surface-mismatch'),
    'Modular account admission: wrong surface reason is explicit',
  );
  ok(
    descriptor.standards.includes('ERC-7579') && descriptor.standards.includes('ERC-6900'),
    'Modular account admission: descriptor names both modular account standards',
  );
  ok(
    descriptor.runtimeChecks.includes('executionManifest'),
    'Modular account admission: descriptor exposes ERC-6900 manifest check',
  );
}

testErc7579ReadyHandoff();
testErc6900ReadyHandoff();
testMissingErc6900ManifestNeedsEvidence();
testHookFailureBlocks();
testDeniedPlanAndRuntimeFailureBlock();
testWrongSurfaceAndDescriptor();

console.log(`Crypto execution admission modular account tests: ${passed} passed, 0 failed`);
