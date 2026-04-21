import assert from 'node:assert/strict';
import {
  MODULAR_ACCOUNT_ADAPTER_KINDS,
  MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION,
  MODULAR_ACCOUNT_CHECKS,
  MODULAR_ACCOUNT_OUTCOMES,
  createModularAccountAdapterPreflight,
  modularAccountAdapterPreflightLabel,
  modularAccountAdaptersDescriptor,
  simulateModularAccountAdapterAuthorization,
  type ModularAccountAdapterKind,
  type ModularAccountExecutionContext,
  type ModularAccountHookContext,
  type ModularAccountModuleState,
  type ModularAccountPluginManifest,
  type ModularAccountValidationContext,
} from '../src/crypto-authorization-core/modular-account-adapters.js';
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
  ERC1271_MAGIC_VALUE,
  createCryptoErc1271ValidationProjection,
  evaluateCryptoErc1271ValidationResult,
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
  type CryptoAccountKind,
  type CryptoExecutionAdapterKind,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const TARGET_ADDRESS = '0x2222222222222222222222222222222222222222';
const MODULE_ADDRESS = '0x3333333333333333333333333333333333333333';
const PLUGIN_ADDRESS = '0x4444444444444444444444444444444444444444';
const HOOK_ADDRESS = '0x5555555555555555555555555555555555555555';
const OTHER_ADDRESS = '0x6666666666666666666666666666666666666666';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const OPERATION_HASH = `0x${'aa'.repeat(32)}`;
const MANIFEST_HASH = `0x${'bb'.repeat(32)}`;
const HOOK_DATA_HASH = `0x${'cc'.repeat(32)}`;
const INIT_DATA_HASH = `0x${'dd'.repeat(32)}`;
const SPIFFE_ID = 'spiffe://attestor.test/ns/crypto/sa/modular-account';
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

function accountKindFor(adapterKind: ModularAccountAdapterKind): CryptoAccountKind {
  return adapterKind === 'erc-7579-module'
    ? 'erc-7579-modular-account'
    : 'erc-6900-modular-account';
}

function fixtureAccount(adapterKind: ModularAccountAdapterKind) {
  return createCryptoAccountReference({
    accountKind: accountKindFor(adapterKind),
    chain: fixtureChain(),
    address: ACCOUNT_ADDRESS,
    accountLabel: 'Treasury modular account',
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
  executionAdapterKind: CryptoExecutionAdapterKind = 'erc-7579-module',
): FixtureSuite {
  const adapterKind = executionAdapterKind as ModularAccountAdapterKind;
  const chain = fixtureChain();
  const account = fixtureAccount(adapterKind);
  const asset = fixtureAsset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:treasury-modular-account',
    authorityRef: 'authority:treasury-modular-account-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'contract',
    chain,
    targetId: 'contract:bounded-module-call',
    address: TARGET_ADDRESS,
    counterparty: 'contract:bounded-module-call',
    protocol: 'module-protocol',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-module-call',
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
    nonce: adapterKind === 'erc-6900-plugin' ? 'plugin:nonce:17' : 'module:nonce:17',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    maxAmount: '100000.00',
    budgetId: 'budget:module:daily:usdc',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: `intent-crypto-modular-account-${executionAdapterKind}`,
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'contract-call',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind,
    evidenceRefs: [
      'evidence:crypto-modular-account:001',
      'policy:activation:001',
    ],
  });
  const counterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'contract',
    counterpartyId: 'contract:bounded-module-call',
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
    consequenceKind: 'contract-call',
    account,
    asset,
    amount: {
      assetAmount: '100000.00',
      normalizedUsd: '100000.00',
    },
    counterparty,
    context: {
      executionAdapterKind,
      signals: ['agent-initiated'],
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'smart-account',
    authorityId: 'modular-account:treasury',
    validationMode: 'erc-1271-contract',
    address: ACCOUNT_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: `decision-crypto-modular-account-${executionAdapterKind}`,
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: `release-crypto-modular-account-${executionAdapterKind}`,
    reasonCodes: ['policy-allow', 'modular-account-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: `envelope-crypto-modular-account-${executionAdapterKind}`,
    receiptId: `receipt-crypto-modular-account-${executionAdapterKind}`,
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
      sourceKind: 'account-nonce-state',
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
    requestId: `erq_crypto_modular_account_${executionAdapterKind.replaceAll('-', '_')}`,
    receivedAt: '2026-04-21T09:01:00.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.crypto.modular-account',
      workloadId: SPIFFE_ID,
    },
    traceId: 'trace-crypto-modular-account-001',
    idempotencyKey: 'idem-crypto-modular-account-001',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
    enforcementBinding,
  };
}

function moduleState(
  adapterKind: ModularAccountAdapterKind,
  overrides: Partial<ModularAccountModuleState> = {},
): ModularAccountModuleState {
  return {
    moduleStandard: adapterKind === 'erc-6900-plugin' ? 'erc-6900' : 'erc-7579',
    observedAt: '2026-04-21T09:02:00.000Z',
    accountAddress: ACCOUNT_ADDRESS,
    chainId: 'eip155:1',
    accountImplementationId:
      adapterKind === 'erc-6900-plugin' ? 'account-impl:6900:v1' : 'account-impl:7579:v1',
    moduleAddress: adapterKind === 'erc-6900-plugin' ? PLUGIN_ADDRESS : MODULE_ADDRESS,
    moduleKind: adapterKind === 'erc-6900-plugin' ? 'plugin' : 'executor',
    moduleTypeId: adapterKind === 'erc-6900-plugin' ? null : '2',
    moduleId: adapterKind === 'erc-6900-plugin' ? 'plugin:limit-order' : 'module:executor',
    moduleVersion: '1.0.0',
    moduleInstalled: true,
    accountSupportsExecutionMode: true,
    accountSupportsModuleType: true,
    moduleTypeMatches: true,
    installAuthorization: {
      authorized: true,
      eventObserved: true,
      installedBy: ACCOUNT_ADDRESS,
      installedAt: '2026-04-21T08:55:00.000Z',
      initDataHash: INIT_DATA_HASH,
    },
    recovery: {
      moduleCanBeUninstalled: true,
      hookCanBeDisabled: true,
      emergencyExecutionPrepared: true,
      recoveryAuthorityRef: 'authority:treasury-recovery',
      recoveryDelaySeconds: 3600,
    },
    ...overrides,
  };
}

function execution(
  adapterKind: ModularAccountAdapterKind,
  overrides: Partial<ModularAccountExecutionContext> = {},
): ModularAccountExecutionContext {
  return {
    operationHash: OPERATION_HASH,
    nonce: '17',
    target: TARGET_ADDRESS,
    value: '0',
    data: '0x12345678abcdef',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-module-call',
    batchCallCount: 1,
    executionMode: {
      encodedMode: `0x${'00'.repeat(32)}`,
      callType: 'single-call',
      executionType: 'revert-on-failure',
      modeSelector: '0x00000000',
      modePayload: '0x',
    },
    executorAddress: adapterKind === 'erc-6900-plugin' ? PLUGIN_ADDRESS : MODULE_ADDRESS,
    executionFunction: adapterKind === 'erc-6900-plugin'
      ? 'executeFromPlugin'
      : 'executeFromExecutor',
    executionFunctionAuthorized: true,
    delegateCallAllowed: false,
    postExecutionSuccess: null,
    ...overrides,
  };
}

function validation(
  adapterKind: ModularAccountAdapterKind,
  overrides: Partial<ModularAccountValidationContext> = {},
): ModularAccountValidationContext {
  return {
    validatorAddress: adapterKind === 'erc-6900-plugin' ? PLUGIN_ADDRESS : MODULE_ADDRESS,
    validationFunction: adapterKind === 'erc-6900-plugin'
      ? 'runtime-validation'
      : 'validateUserOp',
    validationFunctionAuthorized: true,
    signatureSelectionSanitized: true,
    userOperationValidationPassed: true,
    signatureValidationPassed: true,
    runtimeValidationPassed: true,
    validationDataBound: true,
    globalValidationAllowed: true,
    selectorPermissionBound: true,
    ...overrides,
  };
}

function hooks(overrides: Partial<ModularAccountHookContext> = {}): ModularAccountHookContext {
  return {
    hooksRequired: true,
    hookAddress: HOOK_ADDRESS,
    preCheckPassed: true,
    postCheckPassed: true,
    hookDataHash: HOOK_DATA_HASH,
    selectorRoutingPassed: true,
    fallbackUsesErc2771: true,
    ...overrides,
  };
}

function manifest(overrides: Partial<ModularAccountPluginManifest> = {}): ModularAccountPluginManifest {
  return {
    manifestHash: MANIFEST_HASH,
    manifestApproved: true,
    permittedSelectors: ['0x12345678'],
    executionFunctionSelector: '0x12345678',
    validationFunctionSelector: '0x87654321',
    dependenciesApproved: true,
    ...overrides,
  };
}

function preflightInput(adapterKind: ModularAccountAdapterKind) {
  return {
    ...fixtureSuite(adapterKind),
    moduleState: moduleState(adapterKind),
    validation: validation(adapterKind),
    execution: execution(adapterKind),
    hooks: hooks(),
    pluginManifest: adapterKind === 'erc-6900-plugin' ? manifest() : null,
  };
}

function testDescriptor(): void {
  const descriptor = modularAccountAdaptersDescriptor();

  equal(
    descriptor.version,
    MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION,
    'Modular account adapters: descriptor exposes version',
  );
  deepEqual(
    descriptor.adapterKinds,
    MODULAR_ACCOUNT_ADAPTER_KINDS,
    'Modular account adapters: descriptor exposes adapter kinds',
  );
  deepEqual(
    descriptor.outcomes,
    MODULAR_ACCOUNT_OUTCOMES,
    'Modular account adapters: descriptor exposes outcomes',
  );
  deepEqual(
    descriptor.checks,
    MODULAR_ACCOUNT_CHECKS,
    'Modular account adapters: descriptor exposes checks',
  );
  ok(
    descriptor.references.includes('ERC-7579'),
    'Modular account adapters: descriptor names ERC-7579',
  );
  ok(
    descriptor.references.includes('ERC-6900'),
    'Modular account adapters: descriptor names ERC-6900',
  );
  ok(
    descriptor.references.includes('plugin-manifest'),
    'Modular account adapters: descriptor names plugin manifest evidence',
  );
}

function testCreatesErc7579AllowPreflight(): void {
  const input = preflightInput('erc-7579-module');
  const preflight = createModularAccountAdapterPreflight(input);
  const second = createModularAccountAdapterPreflight(input);

  equal(
    preflight.version,
    MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION,
    'Modular account adapters: ERC-7579 preflight carries version',
  );
  equal(
    preflight.adapterKind,
    'erc-7579-module',
    'Modular account adapters: ERC-7579 preflight carries adapter kind',
  );
  equal(
    preflight.moduleStandard,
    'erc-7579',
    'Modular account adapters: ERC-7579 preflight binds module standard',
  );
  equal(
    preflight.outcome,
    'allow',
    'Modular account adapters: complete ERC-7579 module preflight allows',
  );
  equal(
    preflight.signal.source,
    'module-hook',
    'Modular account adapters: ERC-7579 emits module-hook simulation source',
  );
  equal(
    preflight.signal.status,
    'pass',
    'Modular account adapters: ERC-7579 allow signal passes',
  );
  equal(
    preflight.operationHash,
    OPERATION_HASH,
    'Modular account adapters: ERC-7579 binds operation hash',
  );
  equal(
    preflight.digest,
    second.digest,
    'Modular account adapters: ERC-7579 preflight digest is deterministic',
  );
  ok(
    preflight.observations.every((entry) => entry.status === 'pass'),
    'Modular account adapters: ERC-7579 all allow observations pass',
  );
  ok(
    modularAccountAdapterPreflightLabel(preflight).includes('outcome:allow'),
    'Modular account adapters: ERC-7579 label includes outcome',
  );
}

function testSimulationAllowsErc7579Module(): void {
  const result = simulateModularAccountAdapterAuthorization(preflightInput('erc-7579-module'));

  equal(
    result.preflight.outcome,
    'allow',
    'Modular account adapters: ERC-7579 simulation wrapper carries allow preflight',
  );
  equal(
    result.simulation.outcome,
    'allow-preview',
    'Modular account adapters: ERC-7579 allows simulation preview',
  );
  equal(
    result.simulation.readiness.adapterPreflight,
    'ready',
    'Modular account adapters: ERC-7579 simulation adapter preflight is ready',
  );
  deepEqual(
    result.simulation.requiredPreflightSources,
    ['module-hook'],
    'Modular account adapters: ERC-7579 simulation requires module-hook evidence',
  );
  deepEqual(
    result.simulation.requiredNextArtifacts,
    [],
    'Modular account adapters: ERC-7579 allow simulation has no required next artifacts',
  );
}

function testCreatesErc6900AllowPreflight(): void {
  const preflight = createModularAccountAdapterPreflight(preflightInput('erc-6900-plugin'));

  equal(
    preflight.adapterKind,
    'erc-6900-plugin',
    'Modular account adapters: ERC-6900 preflight carries adapter kind',
  );
  equal(
    preflight.moduleStandard,
    'erc-6900',
    'Modular account adapters: ERC-6900 preflight binds module standard',
  );
  equal(
    preflight.outcome,
    'allow',
    'Modular account adapters: complete ERC-6900 plugin preflight allows',
  );
  equal(
    preflight.signal.status,
    'pass',
    'Modular account adapters: ERC-6900 allow signal passes',
  );
  ok(
    preflight.observations.every((entry) => entry.status === 'pass'),
    'Modular account adapters: ERC-6900 all allow observations pass',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'modular-plugin-manifest-bound'),
    'Modular account adapters: ERC-6900 binds approved plugin manifest',
  );
}

function testDisabledModuleBlocks(): void {
  const result = simulateModularAccountAdapterAuthorization({
    ...preflightInput('erc-7579-module'),
    moduleState: moduleState('erc-7579-module', { moduleInstalled: false }),
  });

  equal(
    result.preflight.outcome,
    'block',
    'Modular account adapters: disabled ERC-7579 module blocks',
  );
  ok(
    result.preflight.observations.some((entry) => entry.code === 'modular-module-not-installed'),
    'Modular account adapters: disabled module reason is present',
  );
  equal(
    result.simulation.outcome,
    'deny-preview',
    'Modular account adapters: disabled module denies simulation preview',
  );
}

function testUnsupportedExecutionModeBlocks(): void {
  const preflight = createModularAccountAdapterPreflight({
    ...preflightInput('erc-7579-module'),
    moduleState: moduleState('erc-7579-module', { accountSupportsExecutionMode: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'Modular account adapters: unsupported execution mode blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'modular-execution-mode-unsupported'),
    'Modular account adapters: unsupported execution mode reason is present',
  );
}

function testDelegatecallRequiresExplicitEvidence(): void {
  const blocked = createModularAccountAdapterPreflight({
    ...preflightInput('erc-7579-module'),
    execution: execution('erc-7579-module', {
      executionMode: {
        encodedMode: `0x${'ff'.padEnd(64, '0')}`,
        callType: 'delegatecall',
        executionType: 'revert-on-failure',
        modeSelector: '0x00000000',
        modePayload: '0x',
      },
    }),
  });
  const allowed = createModularAccountAdapterPreflight({
    ...preflightInput('erc-7579-module'),
    execution: execution('erc-7579-module', {
      executionMode: {
        encodedMode: `0x${'ff'.padEnd(64, '0')}`,
        callType: 'delegatecall',
        executionType: 'revert-on-failure',
        modeSelector: '0x00000000',
        modePayload: '0x',
      },
      delegateCallAllowed: true,
    }),
  });

  equal(
    blocked.outcome,
    'block',
    'Modular account adapters: delegatecall without evidence blocks',
  );
  ok(
    blocked.observations.some((entry) => entry.code === 'modular-delegatecall-blocked'),
    'Modular account adapters: delegatecall block reason is present',
  );
  equal(
    allowed.outcome,
    'allow',
    'Modular account adapters: delegatecall with explicit evidence allows',
  );
}

function testHookFailureBlocks(): void {
  const preflight = createModularAccountAdapterPreflight({
    ...preflightInput('erc-7579-module'),
    hooks: hooks({ preCheckPassed: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'Modular account adapters: failed hook pre-check blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'modular-hooks-failed'),
    'Modular account adapters: failed hook reason is present',
  );
}

function testErc6900ManifestFailureBlocks(): void {
  const preflight = createModularAccountAdapterPreflight({
    ...preflightInput('erc-6900-plugin'),
    pluginManifest: manifest({ manifestApproved: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'Modular account adapters: unapproved ERC-6900 manifest blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'modular-plugin-manifest-not-bound'),
    'Modular account adapters: unapproved manifest reason is present',
  );
}

function testFallbackHandlerMustForwardSender(): void {
  const preflight = createModularAccountAdapterPreflight({
    ...preflightInput('erc-7579-module'),
    moduleState: moduleState('erc-7579-module', {
      moduleKind: 'fallback-handler',
      moduleTypeId: '3',
    }),
    execution: execution('erc-7579-module', {
      executionFunction: 'execute',
    }),
    hooks: hooks({ fallbackUsesErc2771: false }),
  });

  equal(
    preflight.outcome,
    'block',
    'Modular account adapters: fallback handler without ERC-2771 forwarding blocks',
  );
  ok(
    preflight.observations.some((entry) => entry.code === 'modular-fallback-sender-forwarding-missing'),
    'Modular account adapters: fallback sender-forwarding reason is present',
  );
}

function testNonceAndTargetMismatchBlocks(): void {
  const nonceMismatch = createModularAccountAdapterPreflight({
    ...preflightInput('erc-7579-module'),
    execution: execution('erc-7579-module', { nonce: '18' }),
  });
  const targetMismatch = createModularAccountAdapterPreflight({
    ...preflightInput('erc-7579-module'),
    execution: execution('erc-7579-module', { target: OTHER_ADDRESS }),
  });

  equal(
    nonceMismatch.outcome,
    'block',
    'Modular account adapters: nonce mismatch blocks',
  );
  ok(
    nonceMismatch.observations.some((entry) => entry.code === 'modular-nonce-mismatch'),
    'Modular account adapters: nonce mismatch reason is present',
  );
  equal(
    targetMismatch.outcome,
    'block',
    'Modular account adapters: target mismatch blocks',
  );
  ok(
    targetMismatch.observations.some((entry) => entry.code === 'modular-target-mismatch'),
    'Modular account adapters: target mismatch reason is present',
  );
}

function testWrongAdapterRejects(): void {
  assert.throws(
    () => createModularAccountAdapterPreflight({
      ...fixtureSuite('safe-guard'),
      moduleState: moduleState('erc-7579-module'),
      validation: validation('erc-7579-module'),
      execution: execution('erc-7579-module'),
      hooks: hooks(),
      pluginManifest: null,
    }),
    /erc-7579-module or erc-6900-plugin/,
  );
  passed += 1;
}

testDescriptor();
testCreatesErc7579AllowPreflight();
testSimulationAllowsErc7579Module();
testCreatesErc6900AllowPreflight();
testDisabledModuleBlocks();
testUnsupportedExecutionModeBlocks();
testDelegatecallRequiresExplicitEvidence();
testHookFailureBlocks();
testErc6900ManifestFailureBlocks();
testFallbackHandlerMustForwardSender();
testNonceAndTargetMismatchBlocks();
testWrongAdapterRejects();

console.log(`crypto-authorization-core-modular-account-adapters: ${passed} checks passed`);
