import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  CryptoAuthorizationIntent,
} from './object-model.js';
import type {
  CryptoConsequenceRiskAssessment,
} from './consequence-risk-mapping.js';
import type { CryptoReleaseDecisionBinding } from './release-decision-binding.js';
import type { CryptoPolicyControlPlaneScopeBinding } from './policy-control-plane-scope-binding.js';
import type { CryptoEnforcementVerificationBinding } from './enforcement-plane-verification.js';
import {
  createCryptoAuthorizationSimulation,
  type CryptoAuthorizationSimulationResult,
  type CryptoSimulationPreflightSignal,
} from './authorization-simulation.js';
import type {
  CryptoAccountKind,
  CryptoExecutionAdapterKind,
} from './types.js';

/**
 * ERC-7579 and ERC-6900 modular account adapters.
 *
 * Step 16 keeps module/plugin semantics outside the core authorization object
 * model while still making validator, executor, hook, fallback, manifest, and
 * runtime-validation evidence first-class before modular account execution.
 */

export const MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION =
  'attestor.crypto-modular-account-adapters.v1';

export const MODULAR_ACCOUNT_ADAPTER_KINDS = [
  'erc-7579-module',
  'erc-6900-plugin',
] as const satisfies readonly CryptoExecutionAdapterKind[];
export type ModularAccountAdapterKind =
  typeof MODULAR_ACCOUNT_ADAPTER_KINDS[number];

export const MODULAR_ACCOUNT_STANDARDS = [
  'erc-7579',
  'erc-6900',
] as const;
export type ModularAccountStandard =
  typeof MODULAR_ACCOUNT_STANDARDS[number];

export const MODULAR_ACCOUNT_MODULE_KINDS = [
  'validator',
  'executor',
  'hook',
  'fallback-handler',
  'plugin',
] as const;
export type ModularAccountModuleKind =
  typeof MODULAR_ACCOUNT_MODULE_KINDS[number];

export const MODULAR_ACCOUNT_EXECUTION_CALL_TYPES = [
  'single-call',
  'batch-call',
  'staticcall',
  'delegatecall',
] as const;
export type ModularAccountExecutionCallType =
  typeof MODULAR_ACCOUNT_EXECUTION_CALL_TYPES[number];

export const MODULAR_ACCOUNT_EXECUTION_TYPES = [
  'revert-on-failure',
  'try-execute',
] as const;
export type ModularAccountExecutionType =
  typeof MODULAR_ACCOUNT_EXECUTION_TYPES[number];

export const MODULAR_ACCOUNT_VALIDATION_FUNCTIONS = [
  'validateUserOp',
  'isValidSignatureWithSender',
  'runtime-validation',
  'global-validation',
  'plugin-userop-validation',
] as const;
export type ModularAccountValidationFunction =
  typeof MODULAR_ACCOUNT_VALIDATION_FUNCTIONS[number];

export const MODULAR_ACCOUNT_EXECUTION_FUNCTIONS = [
  'execute',
  'executeFromExecutor',
  'executeUserOp',
  'executeWithRuntimeValidation',
  'executeFromPlugin',
] as const;
export type ModularAccountExecutionFunction =
  typeof MODULAR_ACCOUNT_EXECUTION_FUNCTIONS[number];

export const MODULAR_ACCOUNT_OUTCOMES = [
  'allow',
  'review-required',
  'block',
] as const;
export type ModularAccountOutcome =
  typeof MODULAR_ACCOUNT_OUTCOMES[number];

export const MODULAR_ACCOUNT_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
] as const;
export type ModularAccountObservationStatus =
  typeof MODULAR_ACCOUNT_OBSERVATION_STATUSES[number];

export const MODULAR_ACCOUNT_CHECKS = [
  'modular-adapter-kind',
  'modular-account-kind-supported',
  'modular-account-matches-intent',
  'modular-chain-matches-intent',
  'modular-account-implementation-bound',
  'modular-module-installed',
  'modular-module-type-supported',
  'modular-execution-mode-supported',
  'modular-target-matches-intent',
  'modular-function-selector-matches-intent',
  'modular-calldata-class-matches-intent',
  'modular-native-value-posture',
  'modular-nonce-matches-intent',
  'modular-validation-function-bound',
  'modular-execution-function-bound',
  'modular-runtime-validation-passed',
  'modular-hooks-passed',
  'modular-delegatecall-posture',
  'modular-installation-authorized',
  'modular-plugin-manifest-bound',
  'modular-fallback-sender-forwarding',
  'modular-release-binding-ready',
  'modular-policy-binding-ready',
  'modular-enforcement-binding-ready',
  'modular-operation-hash-bound',
  'modular-recovery-posture-ready',
  'modular-post-execution-status',
] as const;
export type ModularAccountCheck = typeof MODULAR_ACCOUNT_CHECKS[number];

export interface ModularAccountAdapterProfile {
  readonly adapterKind: ModularAccountAdapterKind;
  readonly standard: ModularAccountStandard;
  readonly accountKind: CryptoAccountKind;
  readonly requiredModuleKinds: readonly ModularAccountModuleKind[];
  readonly standards: readonly string[];
  readonly notes: string;
}

export interface ModularAccountExecutionMode {
  readonly encodedMode: string;
  readonly callType: ModularAccountExecutionCallType;
  readonly executionType: ModularAccountExecutionType;
  readonly modeSelector?: string | null;
  readonly modePayload?: string | null;
}

export interface ModularAccountInstallAuthorization {
  readonly authorized: boolean;
  readonly eventObserved: boolean;
  readonly installedBy?: string | null;
  readonly installedAt?: string | null;
  readonly initDataHash?: string | null;
}

export interface ModularAccountRecoveryPosture {
  readonly moduleCanBeUninstalled: boolean;
  readonly hookCanBeDisabled: boolean;
  readonly emergencyExecutionPrepared: boolean;
  readonly recoveryAuthorityRef?: string | null;
  readonly recoveryDelaySeconds?: number | null;
}

export interface ModularAccountModuleState {
  readonly moduleStandard: ModularAccountStandard;
  readonly observedAt: string;
  readonly accountAddress: string;
  readonly chainId: string;
  readonly accountImplementationId: string;
  readonly moduleAddress: string;
  readonly moduleKind: ModularAccountModuleKind;
  readonly moduleTypeId?: string | null;
  readonly moduleId?: string | null;
  readonly moduleVersion?: string | null;
  readonly moduleInstalled: boolean;
  readonly accountSupportsExecutionMode: boolean;
  readonly accountSupportsModuleType: boolean;
  readonly moduleTypeMatches: boolean;
  readonly installAuthorization: ModularAccountInstallAuthorization;
  readonly recovery: ModularAccountRecoveryPosture;
}

export interface ModularAccountValidationContext {
  readonly validatorAddress?: string | null;
  readonly validationFunction: ModularAccountValidationFunction;
  readonly validationFunctionAuthorized: boolean;
  readonly signatureSelectionSanitized?: boolean | null;
  readonly userOperationValidationPassed?: boolean | null;
  readonly signatureValidationPassed?: boolean | null;
  readonly runtimeValidationPassed: boolean;
  readonly validationDataBound: boolean;
  readonly globalValidationAllowed?: boolean | null;
  readonly selectorPermissionBound?: boolean | null;
}

export interface ModularAccountExecutionContext {
  readonly operationHash: string;
  readonly nonce: string;
  readonly target: string;
  readonly value: string;
  readonly data: string;
  readonly functionSelector?: string | null;
  readonly calldataClass?: string | null;
  readonly batchCallCount?: number | null;
  readonly executionMode: ModularAccountExecutionMode;
  readonly executorAddress?: string | null;
  readonly executionFunction: ModularAccountExecutionFunction;
  readonly executionFunctionAuthorized: boolean;
  readonly delegateCallAllowed?: boolean | null;
  readonly postExecutionSuccess?: boolean | null;
}

export interface ModularAccountHookContext {
  readonly hooksRequired: boolean;
  readonly hookAddress?: string | null;
  readonly preCheckPassed?: boolean | null;
  readonly postCheckPassed?: boolean | null;
  readonly hookDataHash?: string | null;
  readonly selectorRoutingPassed?: boolean | null;
  readonly fallbackUsesErc2771?: boolean | null;
}

export interface ModularAccountPluginManifest {
  readonly manifestHash?: string | null;
  readonly manifestApproved?: boolean | null;
  readonly permittedSelectors?: readonly string[] | null;
  readonly executionFunctionSelector?: string | null;
  readonly validationFunctionSelector?: string | null;
  readonly dependenciesApproved?: boolean | null;
}

export interface ModularAccountObservation {
  readonly check: ModularAccountCheck;
  readonly status: ModularAccountObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateModularAccountAdapterPreflightInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly moduleState: ModularAccountModuleState;
  readonly validation: ModularAccountValidationContext;
  readonly execution: ModularAccountExecutionContext;
  readonly hooks: ModularAccountHookContext;
  readonly pluginManifest?: ModularAccountPluginManifest | null;
  readonly preflightId?: string | null;
}

export interface ModularAccountAdapterPreflight {
  readonly version: typeof MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION;
  readonly preflightId: string;
  readonly adapterKind: ModularAccountAdapterKind;
  readonly moduleStandard: ModularAccountStandard;
  readonly checkedAt: string;
  readonly accountAddress: string;
  readonly moduleAddress: string;
  readonly moduleKind: ModularAccountModuleKind;
  readonly operationHash: string;
  readonly executionFunction: ModularAccountExecutionFunction;
  readonly validationFunction: ModularAccountValidationFunction;
  readonly chainId: string;
  readonly target: string;
  readonly functionSelector: string | null;
  readonly nonce: string;
  readonly outcome: ModularAccountOutcome;
  readonly signal: CryptoSimulationPreflightSignal;
  readonly observations: readonly ModularAccountObservation[];
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface ModularAccountAdapterSimulationResult {
  readonly preflight: ModularAccountAdapterPreflight;
  readonly simulation: CryptoAuthorizationSimulationResult;
}

export interface ModularAccountAdaptersDescriptor {
  readonly version: typeof MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION;
  readonly adapterKinds: typeof MODULAR_ACCOUNT_ADAPTER_KINDS;
  readonly standards: typeof MODULAR_ACCOUNT_STANDARDS;
  readonly moduleKinds: typeof MODULAR_ACCOUNT_MODULE_KINDS;
  readonly callTypes: typeof MODULAR_ACCOUNT_EXECUTION_CALL_TYPES;
  readonly executionTypes: typeof MODULAR_ACCOUNT_EXECUTION_TYPES;
  readonly validationFunctions: typeof MODULAR_ACCOUNT_VALIDATION_FUNCTIONS;
  readonly executionFunctions: typeof MODULAR_ACCOUNT_EXECUTION_FUNCTIONS;
  readonly outcomes: typeof MODULAR_ACCOUNT_OUTCOMES;
  readonly checks: typeof MODULAR_ACCOUNT_CHECKS;
  readonly profiles: Readonly<Record<ModularAccountAdapterKind, ModularAccountAdapterProfile>>;
  readonly references: readonly string[];
}

export const MODULAR_ACCOUNT_ADAPTER_PROFILES: Readonly<
  Record<ModularAccountAdapterKind, ModularAccountAdapterProfile>
> = Object.freeze({
  'erc-7579-module': Object.freeze({
    adapterKind: 'erc-7579-module',
    standard: 'erc-7579',
    accountKind: 'erc-7579-modular-account',
    requiredModuleKinds: Object.freeze([
      'validator',
      'executor',
      'hook',
      'fallback-handler',
    ] as const),
    standards: Object.freeze([
      'ERC-7579',
      'IERC7579Execution',
      'executeFromExecutor',
      'supportsExecutionMode',
      'supportsModule',
      'isModuleInstalled',
      'IERC7579Validator',
      'IERC7579Hook',
      'ERC-1271-forwarding',
    ]),
    notes:
      'ERC-7579 module execution requires installed module evidence, module type support, execution mode support, validator/executor/hook readiness, and sender-forwarding posture for fallback handlers.',
  }),
  'erc-6900-plugin': Object.freeze({
    adapterKind: 'erc-6900-plugin',
    standard: 'erc-6900',
    accountKind: 'erc-6900-modular-account',
    requiredModuleKinds: Object.freeze(['plugin'] as const),
    standards: Object.freeze([
      'ERC-6900',
      'plugin-manifest',
      'runtime-validation',
      'user-operation-validation',
      'execution-functions',
      'validation-hooks',
      'execution-hooks',
      'global-validation',
    ]),
    notes:
      'ERC-6900 plugin execution requires an approved plugin manifest, selector-scoped execution and validation functions, runtime validation, hook readiness, and dependency posture.',
  }),
});

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';

const ERC7579_MODULE_TYPE_IDS: Readonly<Record<ModularAccountModuleKind, string | null>> =
  Object.freeze({
    validator: '1',
    executor: '2',
    'fallback-handler': '3',
    hook: '4',
    plugin: null,
  });

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Modular account adapter ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Modular account adapter ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalIsoTimestamp(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeIsoTimestamp(value, fieldName);
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`Modular account adapter ${fieldName} must be an EVM address.`);
  }
  return normalized.toLowerCase();
}

function normalizeOptionalAddress(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeAddress(value, fieldName);
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`Modular account adapter ${fieldName} must be a 32-byte hex value.`);
  }
  return normalized.toLowerCase();
}

function normalizeOptionalHash(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeHash(value, fieldName);
}

function normalizeSelector(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[a-f0-9]{8}$/.test(normalized)) {
    throw new Error(`Modular account adapter ${fieldName} must be a 4-byte selector.`);
  }
  return normalized;
}

function normalizeHexData(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(normalized)) {
    throw new Error(`Modular account adapter ${fieldName} must be hex bytes.`);
  }
  return normalized.toLowerCase();
}

function normalizeOptionalHexData(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeHexData(value, fieldName);
}

function normalizeUintString(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error(`Modular account adapter ${fieldName} must be a non-negative integer string.`);
  }
  return normalized;
}

function normalizeOptionalBatchCallCount(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Modular account adapter execution.batchCallCount must be a positive integer.');
  }
  return value;
}

function normalizeOptionalRecoveryDelay(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Modular account adapter recoveryDelaySeconds must be a non-negative integer.');
  }
  return value;
}

function canonicalObject<T extends CanonicalReleaseJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  const canonical = canonicalizeReleaseJson(value);
  return Object.freeze({
    canonical,
    digest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
  });
}

function caip2ChainId(intent: CryptoAuthorizationIntent): string {
  return `${intent.chain.namespace}:${intent.chain.chainId}`;
}

function sameAddress(left: string, right: string | null | undefined): boolean {
  if (!right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
}

function adapterKindFromIntent(intent: CryptoAuthorizationIntent): ModularAccountAdapterKind {
  if (
    intent.executionAdapterKind !== 'erc-7579-module' &&
    intent.executionAdapterKind !== 'erc-6900-plugin'
  ) {
    throw new Error('Modular account adapter requires intent execution adapter erc-7579-module or erc-6900-plugin.');
  }
  return intent.executionAdapterKind;
}

function standardFrom(input: ModularAccountStandard): ModularAccountStandard {
  if (!MODULAR_ACCOUNT_STANDARDS.includes(input)) {
    throw new Error(`Modular account adapter does not support module standard ${input}.`);
  }
  return input;
}

function moduleKindFrom(input: ModularAccountModuleKind): ModularAccountModuleKind {
  if (!MODULAR_ACCOUNT_MODULE_KINDS.includes(input)) {
    throw new Error(`Modular account adapter does not support module kind ${input}.`);
  }
  return input;
}

function callTypeFrom(input: ModularAccountExecutionCallType): ModularAccountExecutionCallType {
  if (!MODULAR_ACCOUNT_EXECUTION_CALL_TYPES.includes(input)) {
    throw new Error(`Modular account adapter does not support call type ${input}.`);
  }
  return input;
}

function executionTypeFrom(input: ModularAccountExecutionType): ModularAccountExecutionType {
  if (!MODULAR_ACCOUNT_EXECUTION_TYPES.includes(input)) {
    throw new Error(`Modular account adapter does not support execution type ${input}.`);
  }
  return input;
}

function validationFunctionFrom(
  input: ModularAccountValidationFunction,
): ModularAccountValidationFunction {
  if (!MODULAR_ACCOUNT_VALIDATION_FUNCTIONS.includes(input)) {
    throw new Error(`Modular account adapter does not support validation function ${input}.`);
  }
  return input;
}

function executionFunctionFrom(
  input: ModularAccountExecutionFunction,
): ModularAccountExecutionFunction {
  if (!MODULAR_ACCOUNT_EXECUTION_FUNCTIONS.includes(input)) {
    throw new Error(`Modular account adapter does not support execution function ${input}.`);
  }
  return input;
}

function normalizeExecutionMode(
  input: ModularAccountExecutionMode,
): ModularAccountExecutionMode {
  return Object.freeze({
    encodedMode: normalizeHash(input.encodedMode, 'execution.executionMode.encodedMode'),
    callType: callTypeFrom(input.callType),
    executionType: executionTypeFrom(input.executionType),
    modeSelector: normalizeSelector(input.modeSelector, 'execution.executionMode.modeSelector'),
    modePayload: normalizeOptionalHexData(input.modePayload, 'execution.executionMode.modePayload'),
  });
}

function normalizedModuleState(input: ModularAccountModuleState): ModularAccountModuleState {
  return Object.freeze({
    moduleStandard: standardFrom(input.moduleStandard),
    observedAt: normalizeIsoTimestamp(input.observedAt, 'moduleState.observedAt'),
    accountAddress: normalizeAddress(input.accountAddress, 'moduleState.accountAddress'),
    chainId: normalizeIdentifier(input.chainId, 'moduleState.chainId'),
    accountImplementationId: normalizeIdentifier(
      input.accountImplementationId,
      'moduleState.accountImplementationId',
    ),
    moduleAddress: normalizeAddress(input.moduleAddress, 'moduleState.moduleAddress'),
    moduleKind: moduleKindFrom(input.moduleKind),
    moduleTypeId: normalizeOptionalIdentifier(input.moduleTypeId, 'moduleState.moduleTypeId'),
    moduleId: normalizeOptionalIdentifier(input.moduleId, 'moduleState.moduleId'),
    moduleVersion: normalizeOptionalIdentifier(input.moduleVersion, 'moduleState.moduleVersion'),
    moduleInstalled: input.moduleInstalled,
    accountSupportsExecutionMode: input.accountSupportsExecutionMode,
    accountSupportsModuleType: input.accountSupportsModuleType,
    moduleTypeMatches: input.moduleTypeMatches,
    installAuthorization: Object.freeze({
      authorized: input.installAuthorization.authorized,
      eventObserved: input.installAuthorization.eventObserved,
      installedBy: normalizeOptionalAddress(
        input.installAuthorization.installedBy,
        'moduleState.installAuthorization.installedBy',
      ),
      installedAt: normalizeOptionalIsoTimestamp(
        input.installAuthorization.installedAt,
        'moduleState.installAuthorization.installedAt',
      ),
      initDataHash: normalizeOptionalHash(
        input.installAuthorization.initDataHash,
        'moduleState.installAuthorization.initDataHash',
      ),
    }),
    recovery: Object.freeze({
      moduleCanBeUninstalled: input.recovery.moduleCanBeUninstalled,
      hookCanBeDisabled: input.recovery.hookCanBeDisabled,
      emergencyExecutionPrepared: input.recovery.emergencyExecutionPrepared,
      recoveryAuthorityRef: normalizeOptionalIdentifier(
        input.recovery.recoveryAuthorityRef,
        'moduleState.recovery.recoveryAuthorityRef',
      ),
      recoveryDelaySeconds: normalizeOptionalRecoveryDelay(input.recovery.recoveryDelaySeconds),
    }),
  });
}

function normalizedValidation(
  input: ModularAccountValidationContext,
): ModularAccountValidationContext {
  return Object.freeze({
    validatorAddress: normalizeOptionalAddress(input.validatorAddress, 'validation.validatorAddress'),
    validationFunction: validationFunctionFrom(input.validationFunction),
    validationFunctionAuthorized: input.validationFunctionAuthorized,
    signatureSelectionSanitized: input.signatureSelectionSanitized ?? null,
    userOperationValidationPassed: input.userOperationValidationPassed ?? null,
    signatureValidationPassed: input.signatureValidationPassed ?? null,
    runtimeValidationPassed: input.runtimeValidationPassed,
    validationDataBound: input.validationDataBound,
    globalValidationAllowed: input.globalValidationAllowed ?? null,
    selectorPermissionBound: input.selectorPermissionBound ?? null,
  });
}

function normalizedExecution(
  input: ModularAccountExecutionContext,
): ModularAccountExecutionContext {
  return Object.freeze({
    operationHash: normalizeHash(input.operationHash, 'execution.operationHash'),
    nonce: normalizeUintString(input.nonce, 'execution.nonce'),
    target: normalizeAddress(input.target, 'execution.target'),
    value: normalizeUintString(input.value, 'execution.value'),
    data: normalizeHexData(input.data, 'execution.data'),
    functionSelector: normalizeSelector(input.functionSelector, 'execution.functionSelector'),
    calldataClass: normalizeOptionalIdentifier(input.calldataClass, 'execution.calldataClass'),
    batchCallCount: normalizeOptionalBatchCallCount(input.batchCallCount),
    executionMode: normalizeExecutionMode(input.executionMode),
    executorAddress: normalizeOptionalAddress(input.executorAddress, 'execution.executorAddress'),
    executionFunction: executionFunctionFrom(input.executionFunction),
    executionFunctionAuthorized: input.executionFunctionAuthorized,
    delegateCallAllowed: input.delegateCallAllowed ?? null,
    postExecutionSuccess: input.postExecutionSuccess ?? null,
  });
}

function normalizedHooks(input: ModularAccountHookContext): ModularAccountHookContext {
  return Object.freeze({
    hooksRequired: input.hooksRequired,
    hookAddress: normalizeOptionalAddress(input.hookAddress, 'hooks.hookAddress'),
    preCheckPassed: input.preCheckPassed ?? null,
    postCheckPassed: input.postCheckPassed ?? null,
    hookDataHash: normalizeOptionalHash(input.hookDataHash, 'hooks.hookDataHash'),
    selectorRoutingPassed: input.selectorRoutingPassed ?? null,
    fallbackUsesErc2771: input.fallbackUsesErc2771 ?? null,
  });
}

function normalizedPluginManifest(
  input: ModularAccountPluginManifest | null | undefined,
): ModularAccountPluginManifest | null {
  if (input === undefined || input === null) {
    return null;
  }
  return Object.freeze({
    manifestHash: normalizeOptionalHash(input.manifestHash, 'pluginManifest.manifestHash'),
    manifestApproved: input.manifestApproved ?? null,
    permittedSelectors: input.permittedSelectors
      ? Object.freeze(input.permittedSelectors.map((selector, index) =>
          normalizeSelector(selector, `pluginManifest.permittedSelectors.${index}`) ?? '0x00000000',
        ))
      : null,
    executionFunctionSelector: normalizeSelector(
      input.executionFunctionSelector,
      'pluginManifest.executionFunctionSelector',
    ),
    validationFunctionSelector: normalizeSelector(
      input.validationFunctionSelector,
      'pluginManifest.validationFunctionSelector',
    ),
    dependenciesApproved: input.dependenciesApproved ?? null,
  });
}

function assertAdapterConsistency(input: CreateModularAccountAdapterPreflightInput): void {
  const adapterKind = adapterKindFromIntent(input.intent);
  if (input.riskAssessment.consequenceKind !== input.intent.consequenceKind) {
    throw new Error('Modular account adapter risk consequence does not match intent.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.policyScopeBinding.cryptoDecisionId) {
    throw new Error('Modular account adapter policy binding does not match release binding.');
  }
  if (input.releaseBinding.cryptoDecisionId !== input.enforcementBinding.cryptoDecisionId) {
    throw new Error('Modular account adapter enforcement binding does not match release binding.');
  }
  if (input.enforcementBinding.adapterKind !== adapterKind) {
    throw new Error(`Modular account adapter requires ${adapterKind} enforcement binding.`);
  }
  if (input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind !== 'action-dispatch') {
    throw new Error('Modular account adapter requires action-dispatch enforcement.');
  }
  if (!input.enforcementBinding.verificationProfile.failClosed) {
    throw new Error('Modular account adapter requires fail-closed enforcement verification.');
  }
}

function nonceMatches(intentNonce: string, moduleNonce: string): boolean {
  return (
    intentNonce === moduleNonce ||
    intentNonce === `module:nonce:${moduleNonce}` ||
    intentNonce === `plugin:nonce:${moduleNonce}` ||
    intentNonce === `modular:nonce:${moduleNonce}` ||
    intentNonce.endsWith(`:${moduleNonce}`)
  );
}

function selectorAllowedByManifest(input: {
  readonly manifest: ModularAccountPluginManifest | null;
  readonly selector: string | null;
}): boolean {
  if (input.manifest === null) {
    return false;
  }
  const selectors = input.manifest.permittedSelectors ?? [];
  return input.selector !== null && selectors.includes(input.selector);
}

function moduleTypeMatchesProfile(input: {
  readonly adapterKind: ModularAccountAdapterKind;
  readonly moduleState: ModularAccountModuleState;
}): boolean {
  const profile = MODULAR_ACCOUNT_ADAPTER_PROFILES[input.adapterKind];
  if (!profile.requiredModuleKinds.includes(input.moduleState.moduleKind)) {
    return false;
  }
  if (profile.standard === 'erc-6900') {
    return input.moduleState.moduleKind === 'plugin' && input.moduleState.moduleTypeMatches;
  }
  const expectedTypeId = ERC7579_MODULE_TYPE_IDS[input.moduleState.moduleKind];
  return (
    expectedTypeId !== null &&
    input.moduleState.moduleTypeId === expectedTypeId &&
    input.moduleState.moduleTypeMatches
  );
}

function validationReady(input: {
  readonly adapterKind: ModularAccountAdapterKind;
  readonly validation: ModularAccountValidationContext;
  readonly execution: ModularAccountExecutionContext;
  readonly manifest: ModularAccountPluginManifest | null;
}): boolean {
  const commonReady =
    input.validation.validationFunctionAuthorized &&
    input.validation.validationDataBound &&
    input.validation.signatureSelectionSanitized !== false &&
    input.validation.userOperationValidationPassed !== false &&
    input.validation.signatureValidationPassed !== false &&
    input.validation.selectorPermissionBound !== false;
  if (!commonReady) {
    return false;
  }
  if (input.adapterKind === 'erc-6900-plugin') {
    return (
      input.validation.runtimeValidationPassed &&
      input.validation.globalValidationAllowed !== false &&
      selectorAllowedByManifest({
        manifest: input.manifest,
        selector: input.execution.functionSelector ?? null,
      })
    );
  }
  return input.validation.runtimeValidationPassed;
}

function executionReady(input: {
  readonly adapterKind: ModularAccountAdapterKind;
  readonly moduleState: ModularAccountModuleState;
  readonly execution: ModularAccountExecutionContext;
  readonly manifest: ModularAccountPluginManifest | null;
}): boolean {
  if (!input.execution.executionFunctionAuthorized) {
    return false;
  }
  if (input.adapterKind === 'erc-7579-module') {
    if (input.moduleState.moduleKind === 'executor') {
      return input.execution.executionFunction === 'executeFromExecutor';
    }
    if (input.moduleState.moduleKind === 'validator') {
      return input.execution.executionFunction === 'execute' ||
        input.execution.executionFunction === 'executeUserOp';
    }
    return true;
  }
  return (
    (input.execution.executionFunction === 'executeFromPlugin' ||
      input.execution.executionFunction === 'executeWithRuntimeValidation') &&
    selectorAllowedByManifest({
      manifest: input.manifest,
      selector: input.execution.functionSelector ?? null,
    })
  );
}

function hooksReady(input: {
  readonly moduleState: ModularAccountModuleState;
  readonly hooks: ModularAccountHookContext;
}): boolean {
  if (!input.hooks.hooksRequired && input.moduleState.moduleKind !== 'hook') {
    return true;
  }
  return (
    input.hooks.hookAddress !== null &&
    input.hooks.hookAddress !== ZERO_EVM_ADDRESS &&
    input.hooks.preCheckPassed === true &&
    input.hooks.postCheckPassed !== false
  );
}

function pluginManifestReady(input: {
  readonly adapterKind: ModularAccountAdapterKind;
  readonly manifest: ModularAccountPluginManifest | null;
  readonly execution: ModularAccountExecutionContext;
}): boolean {
  if (input.adapterKind === 'erc-7579-module') {
    return true;
  }
  return (
    input.manifest !== null &&
    input.manifest.manifestHash !== null &&
    input.manifest.manifestApproved === true &&
    input.manifest.dependenciesApproved === true &&
    selectorAllowedByManifest({
      manifest: input.manifest,
      selector: input.execution.functionSelector ?? null,
    })
  );
}

function fallbackForwardingReady(input: {
  readonly moduleState: ModularAccountModuleState;
  readonly hooks: ModularAccountHookContext;
}): boolean {
  if (input.moduleState.moduleKind !== 'fallback-handler') {
    return true;
  }
  return input.hooks.selectorRoutingPassed === true && input.hooks.fallbackUsesErc2771 === true;
}

function recoveryReady(input: {
  readonly moduleState: ModularAccountModuleState;
  readonly hooks: ModularAccountHookContext;
}): boolean {
  const hookReady =
    !input.hooks.hooksRequired &&
    input.moduleState.moduleKind !== 'hook'
      ? true
      : input.moduleState.recovery.hookCanBeDisabled;
  return (
    input.moduleState.recovery.moduleCanBeUninstalled &&
    hookReady &&
    input.moduleState.recovery.emergencyExecutionPrepared
  );
}

function pluginManifestEvidence(
  manifest: ModularAccountPluginManifest | null,
): CanonicalReleaseJsonValue {
  if (manifest === null) {
    return null;
  }
  return Object.freeze({
    manifestHash: manifest.manifestHash ?? null,
    manifestApproved: manifest.manifestApproved ?? null,
    permittedSelectors: Object.freeze([...(manifest.permittedSelectors ?? [])]),
    executionFunctionSelector: manifest.executionFunctionSelector ?? null,
    validationFunctionSelector: manifest.validationFunctionSelector ?? null,
    dependenciesApproved: manifest.dependenciesApproved ?? null,
  });
}

function observation(input: {
  readonly check: ModularAccountCheck;
  readonly status: ModularAccountObservationStatus;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): ModularAccountObservation {
  return Object.freeze({
    check: input.check,
    status: input.status,
    code: normalizeIdentifier(input.code, 'observation.code'),
    message: normalizeIdentifier(input.message, 'observation.message'),
    required: input.required ?? true,
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function buildObservations(input: {
  readonly adapterKind: ModularAccountAdapterKind;
  readonly intent: CryptoAuthorizationIntent;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
  readonly enforcementBinding: CryptoEnforcementVerificationBinding;
  readonly moduleState: ModularAccountModuleState;
  readonly validation: ModularAccountValidationContext;
  readonly execution: ModularAccountExecutionContext;
  readonly hooks: ModularAccountHookContext;
  readonly pluginManifest: ModularAccountPluginManifest | null;
}): readonly ModularAccountObservation[] {
  const observations: ModularAccountObservation[] = [];
  const profile = MODULAR_ACCOUNT_ADAPTER_PROFILES[input.adapterKind];
  const chainId = caip2ChainId(input.intent);
  const targetAddress = input.intent.target.address ?? null;
  const requiredSelector = input.intent.target.functionSelector?.toLowerCase() ?? null;
  const requiredCalldataClass = input.intent.target.calldataClass ?? null;
  const moduleTypeReady =
    input.moduleState.accountSupportsModuleType &&
    moduleTypeMatchesProfile({
      adapterKind: input.adapterKind,
      moduleState: input.moduleState,
    });
  const validationFunctionReady = validationReady({
    adapterKind: input.adapterKind,
    validation: input.validation,
    execution: input.execution,
    manifest: input.pluginManifest,
  });
  const executionFunctionReady = executionReady({
    adapterKind: input.adapterKind,
    moduleState: input.moduleState,
    execution: input.execution,
    manifest: input.pluginManifest,
  });
  const hookChecksReady = hooksReady({
    moduleState: input.moduleState,
    hooks: input.hooks,
  });
  const delegateCallReady =
    input.execution.executionMode.callType !== 'delegatecall' ||
    input.execution.delegateCallAllowed === true;
  const installReady =
    input.moduleState.installAuthorization.authorized &&
    input.moduleState.installAuthorization.eventObserved;
  const manifestReady = pluginManifestReady({
    adapterKind: input.adapterKind,
    manifest: input.pluginManifest,
    execution: input.execution,
  });
  const fallbackReady = fallbackForwardingReady({
    moduleState: input.moduleState,
    hooks: input.hooks,
  });
  const nativeValueUnexpected =
    input.execution.value !== '0' &&
    input.intent.asset !== null &&
    input.intent.asset.assetKind !== 'native-token';

  observations.push(
    observation({
      check: 'modular-adapter-kind',
      status: input.moduleState.moduleStandard === profile.standard ? 'pass' : 'fail',
      code: input.moduleState.moduleStandard === profile.standard
        ? 'modular-adapter-standard-bound'
        : 'modular-adapter-standard-mismatch',
      message: input.moduleState.moduleStandard === profile.standard
        ? 'Modular account evidence uses the standard required by the execution adapter.'
        : 'Modular account evidence standard does not match the execution adapter.',
      evidence: {
        adapterKind: input.adapterKind,
        moduleStandard: input.moduleState.moduleStandard,
        expectedStandard: profile.standard,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-account-kind-supported',
      status: input.intent.account.accountKind === profile.accountKind ? 'pass' : 'fail',
      code: input.intent.account.accountKind === profile.accountKind
        ? 'modular-account-kind-supported'
        : 'modular-account-kind-unsupported',
      message: input.intent.account.accountKind === profile.accountKind
        ? 'Intent account kind is supported by the modular account adapter profile.'
        : 'Intent account kind is not supported by the modular account adapter profile.',
      evidence: {
        accountKind: input.intent.account.accountKind,
        expectedAccountKind: profile.accountKind,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-account-matches-intent',
      status: sameAddress(input.moduleState.accountAddress, input.intent.account.address)
        ? 'pass'
        : 'fail',
      code: sameAddress(input.moduleState.accountAddress, input.intent.account.address)
        ? 'modular-account-bound'
        : 'modular-account-mismatch',
      message: sameAddress(input.moduleState.accountAddress, input.intent.account.address)
        ? 'Modular account address matches the crypto authorization intent.'
        : 'Modular account address does not match the crypto authorization intent.',
      evidence: {
        accountAddress: input.moduleState.accountAddress,
        intentAccount: input.intent.account.address,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-chain-matches-intent',
      status: input.moduleState.chainId === chainId ? 'pass' : 'fail',
      code: input.moduleState.chainId === chainId
        ? 'modular-chain-bound'
        : 'modular-chain-mismatch',
      message: input.moduleState.chainId === chainId
        ? 'Modular account chain matches the crypto authorization intent.'
        : 'Modular account chain does not match the crypto authorization intent.',
      evidence: {
        moduleChainId: input.moduleState.chainId,
        intentChainId: chainId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-account-implementation-bound',
      status: 'pass',
      code: 'modular-account-implementation-bound',
      message: 'Account implementation identity is present for modular-account evidence.',
      evidence: {
        accountImplementationId: input.moduleState.accountImplementationId,
        observedAt: input.moduleState.observedAt,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-module-installed',
      status: input.moduleState.moduleInstalled ? 'pass' : 'fail',
      code: input.moduleState.moduleInstalled
        ? 'modular-module-installed'
        : 'modular-module-not-installed',
      message: input.moduleState.moduleInstalled
        ? 'Module or plugin is installed before execution.'
        : 'Module or plugin is not installed and must fail closed.',
      evidence: {
        moduleAddress: input.moduleState.moduleAddress,
        moduleKind: input.moduleState.moduleKind,
        moduleId: input.moduleState.moduleId ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-module-type-supported',
      status: moduleTypeReady ? 'pass' : 'fail',
      code: !input.moduleState.accountSupportsModuleType
        ? 'modular-account-does-not-support-module-type'
        : moduleTypeReady
          ? 'modular-module-type-supported'
          : 'modular-module-type-mismatch',
      message: moduleTypeReady
        ? 'Account supports the module or plugin type required by the adapter.'
        : 'Account does not support the module/plugin type or the module type evidence mismatches.',
      evidence: {
        moduleKind: input.moduleState.moduleKind,
        moduleTypeId: input.moduleState.moduleTypeId ?? null,
        accountSupportsModuleType: input.moduleState.accountSupportsModuleType,
        moduleTypeMatches: input.moduleState.moduleTypeMatches,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-execution-mode-supported',
      status: input.moduleState.accountSupportsExecutionMode ? 'pass' : 'fail',
      code: input.moduleState.accountSupportsExecutionMode
        ? 'modular-execution-mode-supported'
        : 'modular-execution-mode-unsupported',
      message: input.moduleState.accountSupportsExecutionMode
        ? 'Account supports the encoded modular execution mode.'
        : 'Account does not support the encoded modular execution mode.',
      evidence: {
        encodedMode: input.execution.executionMode.encodedMode,
        callType: input.execution.executionMode.callType,
        executionType: input.execution.executionMode.executionType,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-target-matches-intent',
      status: targetAddress === null
        ? 'warn'
        : sameAddress(input.execution.target, targetAddress)
          ? 'pass'
          : 'fail',
      code: targetAddress === null
        ? 'modular-target-not-required'
        : sameAddress(input.execution.target, targetAddress)
          ? 'modular-target-bound'
          : 'modular-target-mismatch',
      message: targetAddress === null
        ? 'Crypto authorization intent does not require an EVM execution target.'
        : sameAddress(input.execution.target, targetAddress)
          ? 'Modular execution target matches the crypto authorization intent.'
          : 'Modular execution target does not match the crypto authorization intent.',
      evidence: {
        executionTarget: input.execution.target,
        intentTargetAddress: targetAddress,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-function-selector-matches-intent',
      status: requiredSelector === null
        ? 'pass'
        : input.execution.functionSelector === requiredSelector
          ? 'pass'
          : 'fail',
      code: requiredSelector === null
        ? 'modular-function-selector-not-required'
        : input.execution.functionSelector === requiredSelector
          ? 'modular-function-selector-bound'
          : 'modular-function-selector-mismatch',
      message: requiredSelector === null
        ? 'Crypto authorization intent does not require a function selector.'
        : input.execution.functionSelector === requiredSelector
          ? 'Modular execution function selector matches the crypto authorization intent.'
          : 'Modular execution function selector does not match the crypto authorization intent.',
      evidence: {
        executionFunctionSelector: input.execution.functionSelector ?? null,
        intentFunctionSelector: requiredSelector,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-calldata-class-matches-intent',
      status: requiredCalldataClass === null
        ? 'pass'
        : input.execution.calldataClass === requiredCalldataClass
          ? 'pass'
          : 'fail',
      code: requiredCalldataClass === null
        ? 'modular-calldata-class-not-required'
        : input.execution.calldataClass === requiredCalldataClass
          ? 'modular-calldata-class-bound'
          : 'modular-calldata-class-mismatch',
      message: requiredCalldataClass === null
        ? 'Crypto authorization intent does not require a calldata class.'
        : input.execution.calldataClass === requiredCalldataClass
          ? 'Modular execution calldata class matches the crypto authorization intent.'
          : 'Modular execution calldata class does not match the crypto authorization intent.',
      evidence: {
        calldataClass: input.execution.calldataClass ?? null,
        intentCalldataClass: requiredCalldataClass,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-native-value-posture',
      status: nativeValueUnexpected ? 'fail' : 'pass',
      code: nativeValueUnexpected
        ? 'modular-native-value-not-expected'
        : 'modular-native-value-compatible',
      message: nativeValueUnexpected
        ? 'Modular execution carries native value while the intent is scoped to a non-native asset.'
        : 'Modular execution native value posture is compatible with the crypto authorization intent.',
      evidence: {
        value: input.execution.value,
        assetKind: input.intent.asset?.assetKind ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-nonce-matches-intent',
      status: nonceMatches(input.intent.constraints.nonce, input.execution.nonce)
        ? 'pass'
        : 'fail',
      code: nonceMatches(input.intent.constraints.nonce, input.execution.nonce)
        ? 'modular-nonce-bound'
        : 'modular-nonce-mismatch',
      message: nonceMatches(input.intent.constraints.nonce, input.execution.nonce)
        ? 'Modular execution nonce matches the crypto authorization replay constraint.'
        : 'Modular execution nonce does not match the crypto authorization replay constraint.',
      evidence: {
        moduleNonce: input.execution.nonce,
        intentNonce: input.intent.constraints.nonce,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-validation-function-bound',
      status: validationFunctionReady ? 'pass' : 'fail',
      code: !input.validation.validationFunctionAuthorized
        ? 'modular-validation-function-not-authorized'
        : !input.validation.validationDataBound
          ? 'modular-validation-data-not-bound'
          : input.validation.signatureSelectionSanitized === false
            ? 'modular-signature-selection-not-sanitized'
            : input.validation.selectorPermissionBound === false
              ? 'modular-selector-permission-not-bound'
              : input.adapterKind === 'erc-6900-plugin' &&
                  !selectorAllowedByManifest({
                    manifest: input.pluginManifest,
                    selector: input.execution.functionSelector ?? null,
                  })
                ? 'modular-plugin-selector-not-permitted'
                : 'modular-validation-function-bound',
      message: validationFunctionReady
        ? 'Validation function, selector permission, and validation data are bound to the modular execution.'
        : 'Validation function evidence is missing, unauthorized, unsanitized, or selector-unbound.',
      evidence: {
        validationFunction: input.validation.validationFunction,
        validatorAddress: input.validation.validatorAddress ?? null,
        validationFunctionAuthorized: input.validation.validationFunctionAuthorized,
        validationDataBound: input.validation.validationDataBound,
        signatureSelectionSanitized: input.validation.signatureSelectionSanitized ?? null,
        selectorPermissionBound: input.validation.selectorPermissionBound ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-execution-function-bound',
      status: executionFunctionReady ? 'pass' : 'fail',
      code: !input.execution.executionFunctionAuthorized
        ? 'modular-execution-function-not-authorized'
        : executionFunctionReady
          ? 'modular-execution-function-bound'
          : 'modular-execution-function-mismatch',
      message: executionFunctionReady
        ? 'Execution function is authorized and compatible with the modular adapter profile.'
        : 'Execution function is unauthorized or incompatible with the modular adapter profile.',
      evidence: {
        executionFunction: input.execution.executionFunction,
        executorAddress: input.execution.executorAddress ?? null,
        moduleKind: input.moduleState.moduleKind,
      },
    }),
  );

  const runtimeValidationReady =
    input.validation.runtimeValidationPassed &&
    input.validation.userOperationValidationPassed !== false &&
    input.validation.signatureValidationPassed !== false &&
    input.validation.globalValidationAllowed !== false;
  observations.push(
    observation({
      check: 'modular-runtime-validation-passed',
      status: runtimeValidationReady ? 'pass' : 'fail',
      code: !input.validation.runtimeValidationPassed
        ? 'modular-runtime-validation-failed'
        : input.validation.userOperationValidationPassed === false
          ? 'modular-userop-validation-failed'
          : input.validation.signatureValidationPassed === false
            ? 'modular-signature-validation-failed'
            : input.validation.globalValidationAllowed === false
              ? 'modular-global-validation-not-allowed'
              : 'modular-runtime-validation-passed',
      message: runtimeValidationReady
        ? 'Runtime, UserOperation, signature, and global-validation posture is compatible.'
        : 'Runtime, UserOperation, signature, or global-validation posture failed.',
      evidence: {
        runtimeValidationPassed: input.validation.runtimeValidationPassed,
        userOperationValidationPassed: input.validation.userOperationValidationPassed ?? null,
        signatureValidationPassed: input.validation.signatureValidationPassed ?? null,
        globalValidationAllowed: input.validation.globalValidationAllowed ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-hooks-passed',
      status: hookChecksReady ? 'pass' : 'fail',
      code: !input.hooks.hooksRequired && input.moduleState.moduleKind !== 'hook'
        ? 'modular-hooks-not-required'
        : hookChecksReady
          ? 'modular-hooks-passed'
          : 'modular-hooks-failed',
      message: !input.hooks.hooksRequired && input.moduleState.moduleKind !== 'hook'
        ? 'This modular execution does not require hook evidence.'
        : hookChecksReady
          ? 'Required modular hook pre/post checks passed.'
          : 'Required modular hook checks are missing or failed.',
      evidence: {
        hooksRequired: input.hooks.hooksRequired,
        hookAddress: input.hooks.hookAddress ?? null,
        preCheckPassed: input.hooks.preCheckPassed ?? null,
        postCheckPassed: input.hooks.postCheckPassed ?? null,
        hookDataHash: input.hooks.hookDataHash ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-delegatecall-posture',
      status: delegateCallReady ? 'pass' : 'fail',
      code: delegateCallReady
        ? 'modular-delegatecall-posture-compatible'
        : 'modular-delegatecall-blocked',
      message: delegateCallReady
        ? 'Execution call type is compatible with adapter evidence.'
        : 'Delegatecall execution is blocked without explicit adapter evidence.',
      evidence: {
        callType: input.execution.executionMode.callType,
        delegateCallAllowed: input.execution.delegateCallAllowed ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-installation-authorized',
      status: installReady ? 'pass' : 'fail',
      code: installReady
        ? 'modular-installation-authorized'
        : 'modular-installation-not-authorized',
      message: installReady
        ? 'Module/plugin installation authorization and event evidence are present.'
        : 'Module/plugin installation authorization or event evidence is missing.',
      evidence: {
        authorized: input.moduleState.installAuthorization.authorized,
        eventObserved: input.moduleState.installAuthorization.eventObserved,
        installedBy: input.moduleState.installAuthorization.installedBy ?? null,
        initDataHash: input.moduleState.installAuthorization.initDataHash ?? null,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-plugin-manifest-bound',
      status: manifestReady ? 'pass' : 'fail',
      code: input.adapterKind === 'erc-7579-module'
        ? 'modular-plugin-manifest-not-required'
        : manifestReady
          ? 'modular-plugin-manifest-bound'
          : 'modular-plugin-manifest-not-bound',
      message: input.adapterKind === 'erc-7579-module'
        ? 'ERC-7579 module path does not require an ERC-6900 plugin manifest.'
        : manifestReady
          ? 'ERC-6900 plugin manifest is approved, dependency-bound, and selector-scoped.'
          : 'ERC-6900 plugin manifest is missing, unapproved, dependency-unbound, or selector-unscoped.',
      evidence: {
        pluginManifest: pluginManifestEvidence(input.pluginManifest),
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-fallback-sender-forwarding',
      status: fallbackReady ? 'pass' : 'fail',
      code: input.moduleState.moduleKind !== 'fallback-handler'
        ? 'modular-fallback-not-applicable'
        : fallbackReady
          ? 'modular-fallback-sender-forwarding-ready'
          : 'modular-fallback-sender-forwarding-missing',
      message: input.moduleState.moduleKind !== 'fallback-handler'
        ? 'Execution is not through a fallback handler.'
        : fallbackReady
          ? 'Fallback handler selector routing and ERC-2771 sender forwarding are ready.'
          : 'Fallback handler lacks selector routing or ERC-2771 sender forwarding evidence.',
      evidence: {
        selectorRoutingPassed: input.hooks.selectorRoutingPassed ?? null,
        fallbackUsesErc2771: input.hooks.fallbackUsesErc2771 ?? null,
      },
    }),
  );

  const releaseReady =
    input.releaseBinding.status === 'bound' &&
    (input.releaseBinding.releaseDecision.status === 'accepted' ||
      input.releaseBinding.releaseDecision.status === 'overridden');
  observations.push(
    observation({
      check: 'modular-release-binding-ready',
      status: releaseReady ? 'pass' : 'fail',
      code: releaseReady
        ? 'modular-release-binding-ready'
        : 'modular-release-binding-not-executable',
      message: releaseReady
        ? 'Release binding is executable for modular-account dispatch.'
        : 'Release binding is not executable and modular-account dispatch must fail closed.',
      evidence: {
        bindingStatus: input.releaseBinding.status,
        releaseStatus: input.releaseBinding.releaseDecision.status,
        releaseDecisionId: input.releaseBinding.releaseDecisionId,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-policy-binding-ready',
      status: input.policyScopeBinding.activationRecord.state === 'active' ? 'pass' : 'fail',
      code: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'modular-policy-binding-active'
        : 'modular-policy-binding-not-active',
      message: input.policyScopeBinding.activationRecord.state === 'active'
        ? 'Policy-control-plane binding is active for modular-account dispatch.'
        : 'Policy-control-plane binding is not active.',
      evidence: {
        activationId: input.policyScopeBinding.activationId,
        activationState: input.policyScopeBinding.activationRecord.state,
      },
    }),
  );

  const enforcementReady =
    input.enforcementBinding.adapterKind === input.adapterKind &&
    input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind === 'action-dispatch' &&
    input.enforcementBinding.verificationProfile.failClosed;
  observations.push(
    observation({
      check: 'modular-enforcement-binding-ready',
      status: enforcementReady ? 'pass' : 'fail',
      code: enforcementReady
        ? 'modular-enforcement-binding-ready'
        : 'modular-enforcement-binding-not-ready',
      message: enforcementReady
        ? 'Enforcement binding is fail-closed and action-dispatch scoped for modular-account dispatch.'
        : 'Enforcement binding is not modular-account action-dispatch ready.',
      evidence: {
        adapterKind: input.enforcementBinding.adapterKind,
        boundaryKind: input.enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
        profileId: input.enforcementBinding.verificationProfile.id,
      },
    }),
  );

  observations.push(
    observation({
      check: 'modular-operation-hash-bound',
      status: 'pass',
      code: 'modular-operation-hash-bound',
      message: 'Modular operation hash is present and bound into adapter evidence.',
      evidence: {
        operationHash: input.execution.operationHash,
        dataLength: input.execution.data.length,
        batchCallCount: input.execution.batchCallCount ?? null,
      },
    }),
  );

  const recoveryPostureReady = recoveryReady({
    moduleState: input.moduleState,
    hooks: input.hooks,
  });
  observations.push(
    observation({
      check: 'modular-recovery-posture-ready',
      status: recoveryPostureReady ? 'pass' : 'fail',
      code: recoveryPostureReady
        ? 'modular-recovery-posture-ready'
        : 'modular-recovery-posture-missing',
      message: recoveryPostureReady
        ? 'Module/plugin has owner-controlled recovery and emergency execution posture.'
        : 'Module/plugin recovery posture is missing or incomplete.',
      evidence: {
        moduleCanBeUninstalled: input.moduleState.recovery.moduleCanBeUninstalled,
        hookCanBeDisabled: input.moduleState.recovery.hookCanBeDisabled,
        emergencyExecutionPrepared: input.moduleState.recovery.emergencyExecutionPrepared,
        recoveryAuthorityRef: input.moduleState.recovery.recoveryAuthorityRef ?? null,
        recoveryDelaySeconds: input.moduleState.recovery.recoveryDelaySeconds ?? null,
      },
    }),
  );

  const postExecutionSuccess =
    input.execution.postExecutionSuccess === null ||
    input.execution.postExecutionSuccess === true;
  observations.push(
    observation({
      check: 'modular-post-execution-status',
      status: postExecutionSuccess ? 'pass' : 'fail',
      code: postExecutionSuccess
        ? 'modular-post-execution-compatible'
        : 'modular-post-execution-failed',
      message: postExecutionSuccess
        ? 'No failed modular post-execution status was observed.'
        : 'Modular post-execution status failed and must block.',
      evidence: {
        postExecutionSuccess: input.execution.postExecutionSuccess ?? null,
      },
    }),
  );

  return Object.freeze(observations);
}

function outcomeFromObservations(
  observations: readonly ModularAccountObservation[],
): ModularAccountOutcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'block';
  }
  if (observations.some((entry) => entry.required && entry.status === 'warn')) {
    return 'review-required';
  }
  return 'allow';
}

function signalStatusFor(outcome: ModularAccountOutcome): CryptoSimulationPreflightSignal['status'] {
  switch (outcome) {
    case 'allow':
      return 'pass';
    case 'review-required':
      return 'warn';
    case 'block':
      return 'fail';
  }
}

function failingReasonCodes(
  observations: readonly ModularAccountObservation[],
): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => entry.code),
  );
}

function preflightIdFor(input: {
  readonly adapterKind: ModularAccountAdapterKind;
  readonly moduleState: ModularAccountModuleState;
  readonly execution: ModularAccountExecutionContext;
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string;
  readonly enforcementBindingDigest: string;
}): string {
  return canonicalObject({
    version: MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION,
    adapterKind: input.adapterKind,
    observedAt: input.moduleState.observedAt,
    accountAddress: input.moduleState.accountAddress,
    moduleAddress: input.moduleState.moduleAddress,
    moduleKind: input.moduleState.moduleKind,
    operationHash: input.execution.operationHash,
    releaseBindingDigest: input.releaseBindingDigest,
    policyScopeDigest: input.policyScopeDigest,
    enforcementBindingDigest: input.enforcementBindingDigest,
  }).digest;
}

function signalFor(input: {
  readonly adapterKind: ModularAccountAdapterKind;
  readonly outcome: ModularAccountOutcome;
  readonly preflightId: string;
  readonly moduleState: ModularAccountModuleState;
  readonly validation: ModularAccountValidationContext;
  readonly execution: ModularAccountExecutionContext;
  readonly hooks: ModularAccountHookContext;
  readonly pluginManifest: ModularAccountPluginManifest | null;
  readonly observations: readonly ModularAccountObservation[];
}): CryptoSimulationPreflightSignal {
  const status = signalStatusFor(input.outcome);
  return Object.freeze({
    source: 'module-hook',
    status,
    code: input.outcome === 'allow'
      ? 'modular-account-adapter-allow'
      : input.outcome === 'review-required'
        ? 'modular-account-adapter-review-required'
        : 'modular-account-adapter-block',
    message: input.outcome === 'allow'
      ? 'Modular account adapter accepted the Attestor-bound module/plugin preflight.'
      : input.outcome === 'review-required'
        ? 'Modular account adapter needs additional evidence before execution.'
        : 'Modular account adapter would block module/plugin execution fail-closed.',
    required: true,
    evidence: Object.freeze({
      adapterVersion: MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION,
      preflightId: input.preflightId,
      adapterKind: input.adapterKind,
      moduleStandard: input.moduleState.moduleStandard,
      accountAddress: input.moduleState.accountAddress,
      moduleAddress: input.moduleState.moduleAddress,
      moduleKind: input.moduleState.moduleKind,
      operationHash: input.execution.operationHash,
      executionFunction: input.execution.executionFunction,
      validationFunction: input.validation.validationFunction,
      hookAddress: input.hooks.hookAddress ?? null,
      pluginManifestHash: input.pluginManifest?.manifestHash ?? null,
      reasonCodes: failingReasonCodes(input.observations),
    }),
  });
}

export function createModularAccountAdapterPreflight(
  input: CreateModularAccountAdapterPreflightInput,
): ModularAccountAdapterPreflight {
  assertAdapterConsistency(input);
  const adapterKind = adapterKindFromIntent(input.intent);
  const moduleState = normalizedModuleState(input.moduleState);
  const validation = normalizedValidation(input.validation);
  const execution = normalizedExecution(input.execution);
  const hooks = normalizedHooks(input.hooks);
  const pluginManifest = normalizedPluginManifest(input.pluginManifest);
  const observations = buildObservations({
    adapterKind,
    intent: input.intent,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    moduleState,
    validation,
    execution,
    hooks,
    pluginManifest,
  });
  const outcome = outcomeFromObservations(observations);
  const preflightId =
    normalizeOptionalIdentifier(input.preflightId, 'preflightId') ??
    preflightIdFor({
      adapterKind,
      moduleState,
      execution,
      releaseBindingDigest: input.releaseBinding.digest,
      policyScopeDigest: input.policyScopeBinding.digest,
      enforcementBindingDigest: input.enforcementBinding.digest,
    });
  const signal = signalFor({
    adapterKind,
    outcome,
    preflightId,
    moduleState,
    validation,
    execution,
    hooks,
    pluginManifest,
    observations,
  });
  const canonicalPayload = {
    version: MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION,
    preflightId,
    adapterKind,
    moduleStandard: moduleState.moduleStandard,
    checkedAt: moduleState.observedAt,
    accountAddress: moduleState.accountAddress,
    moduleAddress: moduleState.moduleAddress,
    moduleKind: moduleState.moduleKind,
    operationHash: execution.operationHash,
    executionFunction: execution.executionFunction,
    validationFunction: validation.validationFunction,
    chainId: moduleState.chainId,
    target: execution.target,
    functionSelector: execution.functionSelector ?? null,
    nonce: execution.nonce,
    outcome,
    signal,
    observations,
    releaseBindingDigest: input.releaseBinding.digest,
    policyScopeDigest: input.policyScopeBinding.digest,
    enforcementBindingDigest: input.enforcementBinding.digest,
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function simulateModularAccountAdapterAuthorization(
  input: CreateModularAccountAdapterPreflightInput,
): ModularAccountAdapterSimulationResult {
  const preflight = createModularAccountAdapterPreflight(input);
  const simulation = createCryptoAuthorizationSimulation({
    intent: input.intent,
    riskAssessment: input.riskAssessment,
    releaseBinding: input.releaseBinding,
    policyScopeBinding: input.policyScopeBinding,
    enforcementBinding: input.enforcementBinding,
    simulatedAt: preflight.checkedAt,
    preflightSignals: [preflight.signal],
    operatorNote: `Modular account ${preflight.adapterKind} ${preflight.operationHash} preflight ${preflight.outcome}.`,
  });

  return Object.freeze({
    preflight,
    simulation,
  });
}

export function modularAccountAdapterPreflightLabel(
  preflight: ModularAccountAdapterPreflight,
): string {
  return [
    `modular-account:${preflight.operationHash}`,
    `adapter:${preflight.adapterKind}`,
    `outcome:${preflight.outcome}`,
    `module:${preflight.moduleAddress}`,
  ].join(' / ');
}

export function modularAccountAdaptersDescriptor(): ModularAccountAdaptersDescriptor {
  return Object.freeze({
    version: MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION,
    adapterKinds: MODULAR_ACCOUNT_ADAPTER_KINDS,
    standards: MODULAR_ACCOUNT_STANDARDS,
    moduleKinds: MODULAR_ACCOUNT_MODULE_KINDS,
    callTypes: MODULAR_ACCOUNT_EXECUTION_CALL_TYPES,
    executionTypes: MODULAR_ACCOUNT_EXECUTION_TYPES,
    validationFunctions: MODULAR_ACCOUNT_VALIDATION_FUNCTIONS,
    executionFunctions: MODULAR_ACCOUNT_EXECUTION_FUNCTIONS,
    outcomes: MODULAR_ACCOUNT_OUTCOMES,
    checks: MODULAR_ACCOUNT_CHECKS,
    profiles: MODULAR_ACCOUNT_ADAPTER_PROFILES,
    references: Object.freeze([
      'ERC-7579',
      'ERC-6900',
      'ERC-4337',
      'ERC-1271',
      'ERC-165',
      'ERC-2771',
      'module-hook',
      'plugin-manifest',
      'runtime-validation',
      'release-layer',
      'release-policy-control-plane',
      'release-enforcement-plane',
      'attestor-crypto-authorization-simulation',
    ]),
  });
}
