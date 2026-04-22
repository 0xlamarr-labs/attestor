import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  ModularAccountAdapterKind,
  ModularAccountAdapterPreflight,
  ModularAccountCheck,
  ModularAccountModuleKind,
  ModularAccountObservation,
} from '../crypto-authorization-core/modular-account-adapters.js';
import type { CryptoExecutionAdmissionPlan } from './index.js';

/**
 * Modular account admission handoffs project ERC-7579 module and ERC-6900
 * plugin preflight evidence into a deterministic runtime admission object.
 * Attestor does not become the account runtime; it names the checks the runtime
 * must honor before module/plugin execution proceeds.
 */

export const MODULAR_ACCOUNT_ADMISSION_HANDOFF_SPEC_VERSION =
  'attestor.crypto-modular-account-admission-handoff.v1';

export const MODULAR_ACCOUNT_ADMISSION_OUTCOMES = [
  'ready',
  'needs-runtime-evidence',
  'blocked',
] as const;
export type ModularAccountAdmissionOutcome =
  typeof MODULAR_ACCOUNT_ADMISSION_OUTCOMES[number];

export const MODULAR_ACCOUNT_ADMISSION_EXPECTATION_KINDS = [
  'plan-surface',
  'adapter-preflight',
  'module-installation',
  'module-type',
  'execution-mode',
  'selector-scope',
  'validation',
  'hook',
  'plugin-manifest',
  'recovery',
  'post-execution',
] as const;
export type ModularAccountAdmissionExpectationKind =
  typeof MODULAR_ACCOUNT_ADMISSION_EXPECTATION_KINDS[number];

export const MODULAR_ACCOUNT_ADMISSION_EXPECTATION_STATUSES = [
  'satisfied',
  'missing',
  'unsupported',
  'failed',
] as const;
export type ModularAccountAdmissionExpectationStatus =
  typeof MODULAR_ACCOUNT_ADMISSION_EXPECTATION_STATUSES[number];

export interface ModularAccountRuntimeObservation {
  readonly observedAt: string;
  readonly txHash?: string | null;
  readonly success: boolean;
  readonly eventName?: string | null;
}

export interface ModularAccountAdmissionExpectation {
  readonly kind: ModularAccountAdmissionExpectationKind;
  readonly status: ModularAccountAdmissionExpectationStatus;
  readonly reasonCode: string;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateModularAccountAdmissionHandoffInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: ModularAccountAdapterPreflight;
  readonly createdAt: string;
  readonly handoffId?: string | null;
  readonly runtimeId?: string | null;
  readonly accountImplementationId?: string | null;
  readonly moduleTypeId?: string | null;
  readonly executionMode?: string | null;
  readonly hookDataHash?: string | null;
  readonly pluginManifestHash?: string | null;
  readonly runtimeObservation?: ModularAccountRuntimeObservation | null;
  readonly operatorNote?: string | null;
}

export interface ModularAccountRuntimeCheck {
  readonly standard: 'ERC-7579' | 'ERC-6900';
  readonly check: string;
  readonly reason: string;
}

export interface ModularAccountAdmissionHandoff {
  readonly version: typeof MODULAR_ACCOUNT_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly handoffId: string;
  readonly createdAt: string;
  readonly outcome: ModularAccountAdmissionOutcome;
  readonly adapterKind: ModularAccountAdapterKind;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly preflightId: string;
  readonly preflightDigest: string;
  readonly accountAddress: string;
  readonly chainId: string;
  readonly moduleStandard: ModularAccountAdapterPreflight['moduleStandard'];
  readonly moduleAddress: string;
  readonly moduleKind: ModularAccountModuleKind;
  readonly moduleTypeId: string | null;
  readonly operationHash: string;
  readonly target: string;
  readonly functionSelector: string | null;
  readonly nonce: string;
  readonly executionFunction: ModularAccountAdapterPreflight['executionFunction'];
  readonly validationFunction: ModularAccountAdapterPreflight['validationFunction'];
  readonly runtimeId: string | null;
  readonly accountImplementationId: string | null;
  readonly executionMode: string | null;
  readonly hookDataHash: string | null;
  readonly pluginManifestHash: string | null;
  readonly requiredInterfaces: readonly string[];
  readonly runtimeChecks: readonly ModularAccountRuntimeCheck[];
  readonly runtimeObservation: ModularAccountRuntimeObservation | null;
  readonly attestorSidecar: Readonly<Record<string, CanonicalReleaseJsonValue>>;
  readonly expectations: readonly ModularAccountAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface ModularAccountAdmissionDescriptor {
  readonly version: typeof MODULAR_ACCOUNT_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly outcomes: typeof MODULAR_ACCOUNT_ADMISSION_OUTCOMES;
  readonly expectationKinds: typeof MODULAR_ACCOUNT_ADMISSION_EXPECTATION_KINDS;
  readonly expectationStatuses: typeof MODULAR_ACCOUNT_ADMISSION_EXPECTATION_STATUSES;
  readonly standards: readonly string[];
  readonly runtimeChecks: readonly string[];
}

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
  if (!normalized) {
    throw new Error(`Modular account admission ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Modular account admission ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalIsoTimestamp(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeIsoTimestamp(value, fieldName);
}

function normalizeAddress(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(normalized)) {
    throw new Error(`Modular account admission ${fieldName} must be an EVM address.`);
  }
  return normalized;
}

function normalizeHash(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`Modular account admission ${fieldName} must be a 32-byte hex value.`);
  }
  return normalized;
}

function normalizeOptionalHash(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeHash(value, fieldName);
}

function normalizeSelector(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = normalizeIdentifier(value, fieldName).toLowerCase();
  if (!/^0x[0-9a-f]{8}$/u.test(normalized)) {
    throw new Error(`Modular account admission ${fieldName} must be a 4-byte selector.`);
  }
  return normalized;
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

function observationFor(
  preflight: ModularAccountAdapterPreflight,
  check: ModularAccountCheck,
): ModularAccountObservation | null {
  return preflight.observations.find((entry) => entry.check === check) ?? null;
}

function statusFromObservation(
  observation: ModularAccountObservation | null,
): ModularAccountAdmissionExpectationStatus {
  if (observation === null) return 'missing';
  if (observation.status === 'pass') return 'satisfied';
  if (observation.status === 'warn') return 'missing';
  return 'failed';
}

function expectation(input: {
  readonly kind: ModularAccountAdmissionExpectationKind;
  readonly status: ModularAccountAdmissionExpectationStatus;
  readonly reasonCode: string;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): ModularAccountAdmissionExpectation {
  return Object.freeze({
    kind: input.kind,
    status: input.status,
    reasonCode: normalizeIdentifier(input.reasonCode, 'expectation.reasonCode'),
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function observationExpectation(input: {
  readonly preflight: ModularAccountAdapterPreflight;
  readonly kind: ModularAccountAdmissionExpectationKind;
  readonly check: ModularAccountCheck;
  readonly missingReason: string;
}): ModularAccountAdmissionExpectation {
  const observation = observationFor(input.preflight, input.check);
  return expectation({
    kind: input.kind,
    status: statusFromObservation(observation),
    reasonCode: observation?.code ?? input.missingReason,
    evidence: observation?.evidence,
  });
}

function evidenceString(
  evidence: Readonly<Record<string, CanonicalReleaseJsonValue>> | undefined,
  key: string,
): string | null {
  const value = evidence?.[key];
  return typeof value === 'string' ? value : null;
}

function signalEvidenceString(preflight: ModularAccountAdapterPreflight, key: string): string | null {
  return evidenceString(preflight.signal.evidence, key);
}

function moduleTypeIdFor(
  preflight: ModularAccountAdapterPreflight,
  override: string | null,
): string | null {
  if (override !== null) return override;
  if (preflight.adapterKind === 'erc-7579-module') {
    return ERC7579_MODULE_TYPE_IDS[preflight.moduleKind];
  }
  return null;
}

function requiredInterfacesFor(
  preflight: ModularAccountAdapterPreflight,
): readonly string[] {
  if (preflight.adapterKind === 'erc-7579-module') {
    const interfaces = [
      'IERC7579Execution.execute',
      'IERC7579Execution.executeFromExecutor',
      'IERC7579AccountConfig.supportsExecutionMode',
      'IERC7579AccountConfig.supportsModule',
      'IERC7579ModuleConfig.isModuleInstalled',
      'IERC7579Module.isModuleType',
      'ERC-1271.isValidSignature',
    ];
    if (preflight.moduleKind === 'validator') {
      interfaces.push('IERC7579Validator.validateUserOp');
      interfaces.push('IERC7579Validator.isValidSignatureWithSender');
    }
    if (preflight.moduleKind === 'hook') {
      interfaces.push('IERC7579Hook.preCheck');
      interfaces.push('IERC7579Hook.postCheck');
    }
    if (preflight.moduleKind === 'fallback-handler') {
      interfaces.push('ERC-2771._msgSender forwarding');
    }
    return Object.freeze(interfaces);
  }
  return Object.freeze([
    'IERC6900Account.execute',
    'IERC6900Account.executeBatch',
    'IERC6900Account.executeWithRuntimeValidation',
    'IERC6900Account.installExecution',
    'IERC6900Account.installValidation',
    'IERC6900ExecutionModule.executionManifest',
    'ExecutionManifest.functions',
    'ExecutionManifest.executionHooks',
    'ValidationConfig.runtimeValidation',
  ]);
}

function runtimeChecksFor(
  preflight: ModularAccountAdapterPreflight,
): readonly ModularAccountRuntimeCheck[] {
  if (preflight.adapterKind === 'erc-7579-module') {
    return Object.freeze([
      {
        standard: 'ERC-7579',
        check: 'supportsExecutionMode',
        reason: 'Account must declare the encoded execution mode before execution.',
      },
      {
        standard: 'ERC-7579',
        check: 'isModuleInstalled',
        reason: 'Module must be installed under the admitted module type id.',
      },
      {
        standard: 'ERC-7579',
        check: 'preCheck/postCheck',
        reason: 'Required hooks must run around admitted execution.',
      },
    ]);
  }
  return Object.freeze([
    {
      standard: 'ERC-6900',
      check: 'executionManifest',
      reason: 'Plugin manifest must be the approved manifest bound by Attestor.',
    },
    {
      standard: 'ERC-6900',
      check: 'executeWithRuntimeValidation',
      reason: 'Runtime validation must match the admitted validation function.',
    },
    {
      standard: 'ERC-6900',
      check: 'executionHooks',
      reason: 'Execution hooks must receive the calldata format required by ERC-6900.',
    },
  ]);
}

function pluginManifestExpectation(input: {
  readonly preflight: ModularAccountAdapterPreflight;
  readonly pluginManifestHash: string | null;
}): ModularAccountAdmissionExpectation {
  if (input.preflight.adapterKind === 'erc-7579-module') {
    return expectation({
      kind: 'plugin-manifest',
      status: 'satisfied',
      reasonCode: 'erc7579-plugin-manifest-not-required',
      evidence: {
        adapterKind: input.preflight.adapterKind,
      },
    });
  }
  const observation = observationFor(input.preflight, 'modular-plugin-manifest-bound');
  const status = statusFromObservation(observation);
  return expectation({
    kind: 'plugin-manifest',
    status: input.pluginManifestHash === null && status === 'satisfied' ? 'missing' : status,
    reasonCode: input.pluginManifestHash === null && status === 'satisfied'
      ? 'erc6900-plugin-manifest-hash-missing'
      : observation?.code ?? 'erc6900-plugin-manifest-evidence-missing',
    evidence: {
      observation: observation?.evidence ?? null,
      pluginManifestHash: input.pluginManifestHash,
    },
  });
}

function expectationsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: ModularAccountAdapterPreflight;
  readonly pluginManifestHash: string | null;
  readonly runtimeObservation: ModularAccountRuntimeObservation | null;
}): readonly ModularAccountAdmissionExpectation[] {
  const planSurfaceReady =
    input.plan.surface === 'modular-account-runtime' &&
    input.plan.adapterKind === input.preflight.adapterKind;
  const standardReady =
    (input.preflight.adapterKind === 'erc-7579-module' &&
      input.preflight.moduleStandard === 'erc-7579') ||
    (input.preflight.adapterKind === 'erc-6900-plugin' &&
      input.preflight.moduleStandard === 'erc-6900');
  const adapterOutcomeReady = input.preflight.outcome === 'allow';
  const runtimeObservationReady =
    input.runtimeObservation === null || input.runtimeObservation.success;
  return Object.freeze([
    expectation({
      kind: 'plan-surface',
      status: planSurfaceReady ? 'satisfied' : 'unsupported',
      reasonCode: planSurfaceReady
        ? 'modular-account-plan-surface-ready'
        : 'modular-account-plan-surface-mismatch',
      evidence: {
        planSurface: input.plan.surface,
        planAdapterKind: input.plan.adapterKind,
        preflightAdapterKind: input.preflight.adapterKind,
      },
    }),
    expectation({
      kind: 'adapter-preflight',
      status: !standardReady
        ? 'failed'
        : adapterOutcomeReady
        ? 'satisfied'
        : input.preflight.outcome === 'review-required'
          ? 'missing'
          : 'failed',
      reasonCode: !standardReady
        ? 'modular-account-standard-mismatch'
        : adapterOutcomeReady
        ? 'modular-account-preflight-allow'
        : input.preflight.outcome === 'review-required'
          ? 'modular-account-preflight-review-required'
          : 'modular-account-preflight-blocked',
      evidence: {
        adapterKind: input.preflight.adapterKind,
        moduleStandard: input.preflight.moduleStandard,
        preflightOutcome: input.preflight.outcome,
        preflightDigest: input.preflight.digest,
      },
    }),
    observationExpectation({
      preflight: input.preflight,
      kind: 'module-installation',
      check: 'modular-module-installed',
      missingReason: 'modular-module-installation-evidence-missing',
    }),
    observationExpectation({
      preflight: input.preflight,
      kind: 'module-type',
      check: 'modular-module-type-supported',
      missingReason: 'modular-module-type-evidence-missing',
    }),
    observationExpectation({
      preflight: input.preflight,
      kind: 'execution-mode',
      check: 'modular-execution-mode-supported',
      missingReason: 'modular-execution-mode-evidence-missing',
    }),
    observationExpectation({
      preflight: input.preflight,
      kind: 'selector-scope',
      check: 'modular-function-selector-matches-intent',
      missingReason: 'modular-selector-scope-evidence-missing',
    }),
    observationExpectation({
      preflight: input.preflight,
      kind: 'validation',
      check: 'modular-runtime-validation-passed',
      missingReason: 'modular-runtime-validation-evidence-missing',
    }),
    observationExpectation({
      preflight: input.preflight,
      kind: 'hook',
      check: 'modular-hooks-passed',
      missingReason: 'modular-hook-evidence-missing',
    }),
    pluginManifestExpectation({
      preflight: input.preflight,
      pluginManifestHash: input.pluginManifestHash,
    }),
    observationExpectation({
      preflight: input.preflight,
      kind: 'recovery',
      check: 'modular-recovery-posture-ready',
      missingReason: 'modular-recovery-evidence-missing',
    }),
    expectation({
      kind: 'post-execution',
      status: runtimeObservationReady ? 'satisfied' : 'failed',
      reasonCode: runtimeObservationReady
        ? 'modular-runtime-post-execution-compatible'
        : 'modular-runtime-post-execution-failed',
      evidence: {
        runtimeObservation: input.runtimeObservation as unknown as CanonicalReleaseJsonValue,
      },
    }),
  ]);
}

function blockingReasonsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: ModularAccountAdapterPreflight;
  readonly expectations: readonly ModularAccountAdmissionExpectation[];
}): readonly string[] {
  const reasons: string[] = [];
  if (input.plan.outcome === 'deny') {
    reasons.push('admission-plan-denied');
  }
  if (input.plan.chainId !== input.preflight.chainId) {
    reasons.push('modular-account-chain-mismatch');
  }
  if (
    input.plan.accountAddress.toLowerCase() !==
    normalizeAddress(input.preflight.accountAddress, 'preflight.accountAddress')
  ) {
    reasons.push('modular-account-address-mismatch');
  }
  input.expectations
    .filter((entry) => entry.status === 'unsupported' || entry.status === 'failed')
    .forEach((entry) => reasons.push(entry.reasonCode));
  return Object.freeze(reasons);
}

function outcomeFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: ModularAccountAdapterPreflight;
  readonly expectations: readonly ModularAccountAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
}): ModularAccountAdmissionOutcome {
  if (input.blockingReasons.length > 0) return 'blocked';
  if (input.plan.outcome !== 'admit' || input.preflight.outcome !== 'allow') {
    return 'needs-runtime-evidence';
  }
  if (input.expectations.some((entry) => entry.status === 'missing')) {
    return 'needs-runtime-evidence';
  }
  return 'ready';
}

function nextActionsFor(outcome: ModularAccountAdmissionOutcome): readonly string[] {
  switch (outcome) {
    case 'ready':
      return Object.freeze([
        'Proceed through the admitted modular account runtime path.',
        'Record the post-execution runtime observation against this Attestor handoff.',
      ]);
    case 'needs-runtime-evidence':
      return Object.freeze([
        'Collect module installation, module type, execution mode, hook, validation, manifest, and recovery evidence.',
        'Refresh the modular account admission handoff before runtime execution.',
      ]);
    case 'blocked':
      return Object.freeze([
        'Do not execute this module or plugin path.',
        'Resolve the blocked plan, module, hook, manifest, validation, recovery, or runtime reason and create a new handoff.',
      ]);
  }
}

function handoffIdFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly preflight: ModularAccountAdapterPreflight;
  readonly createdAt: string;
}): string {
  return canonicalObject({
    version: MODULAR_ACCOUNT_ADMISSION_HANDOFF_SPEC_VERSION,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    operationHash: input.preflight.operationHash,
    createdAt: input.createdAt,
  }).digest;
}

function normalizedRuntimeObservation(
  value: ModularAccountRuntimeObservation | null | undefined,
): ModularAccountRuntimeObservation | null {
  if (value === undefined || value === null) return null;
  return Object.freeze({
    observedAt: normalizeIsoTimestamp(value.observedAt, 'runtimeObservation.observedAt'),
    txHash: normalizeOptionalHash(value.txHash, 'runtimeObservation.txHash'),
    success: value.success,
    eventName: normalizeOptionalIdentifier(value.eventName, 'runtimeObservation.eventName'),
  });
}

export function createModularAccountAdmissionHandoff(
  input: CreateModularAccountAdmissionHandoffInput,
): ModularAccountAdmissionHandoff {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const accountAddress = normalizeAddress(input.preflight.accountAddress, 'preflight.accountAddress');
  const moduleAddress = normalizeAddress(input.preflight.moduleAddress, 'preflight.moduleAddress');
  const operationHash = normalizeHash(input.preflight.operationHash, 'preflight.operationHash');
  const target = normalizeAddress(input.preflight.target, 'preflight.target');
  const functionSelector = normalizeSelector(
    input.preflight.functionSelector,
    'preflight.functionSelector',
  );
  const moduleTypeId = moduleTypeIdFor(
    input.preflight,
    normalizeOptionalIdentifier(input.moduleTypeId, 'moduleTypeId'),
  );
  const hookDataHash = normalizeOptionalHash(
    input.hookDataHash ?? signalEvidenceString(input.preflight, 'hookDataHash'),
    'hookDataHash',
  );
  const pluginManifestHash = normalizeOptionalHash(
    input.pluginManifestHash ?? signalEvidenceString(input.preflight, 'pluginManifestHash'),
    'pluginManifestHash',
  );
  const runtimeObservation = normalizedRuntimeObservation(input.runtimeObservation);
  const expectations = expectationsFor({
    plan: input.plan,
    preflight: input.preflight,
    pluginManifestHash,
    runtimeObservation,
  });
  const blockingReasons = blockingReasonsFor({
    plan: input.plan,
    preflight: input.preflight,
    expectations,
  });
  const outcome = outcomeFor({
    plan: input.plan,
    preflight: input.preflight,
    expectations,
    blockingReasons,
  });
  const handoffId =
    normalizeOptionalIdentifier(input.handoffId, 'handoffId') ??
    handoffIdFor({
      plan: input.plan,
      preflight: input.preflight,
      createdAt,
    });
  const attestorSidecar = Object.freeze({
    version: MODULAR_ACCOUNT_ADMISSION_HANDOFF_SPEC_VERSION,
    handoffId,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    operationHash,
    outcome,
  });
  const canonicalPayload = {
    version: MODULAR_ACCOUNT_ADMISSION_HANDOFF_SPEC_VERSION,
    handoffId,
    createdAt,
    outcome,
    adapterKind: input.preflight.adapterKind,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    preflightId: input.preflight.preflightId,
    preflightDigest: input.preflight.digest,
    accountAddress,
    chainId: input.preflight.chainId,
    moduleStandard: input.preflight.moduleStandard,
    moduleAddress,
    moduleKind: input.preflight.moduleKind,
    moduleTypeId,
    operationHash,
    target,
    functionSelector,
    nonce: normalizeIdentifier(input.preflight.nonce, 'preflight.nonce'),
    executionFunction: input.preflight.executionFunction,
    validationFunction: input.preflight.validationFunction,
    runtimeId: normalizeOptionalIdentifier(input.runtimeId, 'runtimeId'),
    accountImplementationId: normalizeOptionalIdentifier(
      input.accountImplementationId,
      'accountImplementationId',
    ),
    executionMode: normalizeOptionalIdentifier(input.executionMode, 'executionMode'),
    hookDataHash,
    pluginManifestHash,
    requiredInterfaces: requiredInterfacesFor(input.preflight),
    runtimeChecks: runtimeChecksFor(input.preflight),
    runtimeObservation,
    attestorSidecar,
    expectations,
    blockingReasons,
    nextActions: nextActionsFor(outcome),
    operatorNote: normalizeOptionalIdentifier(input.operatorNote, 'operatorNote'),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);
  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function modularAccountAdmissionHandoffLabel(
  handoff: ModularAccountAdmissionHandoff,
): string {
  return [
    `modular-account-admission:${handoff.operationHash}`,
    `adapter:${handoff.adapterKind}`,
    `outcome:${handoff.outcome}`,
    `module:${handoff.moduleAddress}`,
  ].join(' / ');
}

export function modularAccountAdmissionDescriptor(): ModularAccountAdmissionDescriptor {
  return Object.freeze({
    version: MODULAR_ACCOUNT_ADMISSION_HANDOFF_SPEC_VERSION,
    outcomes: MODULAR_ACCOUNT_ADMISSION_OUTCOMES,
    expectationKinds: MODULAR_ACCOUNT_ADMISSION_EXPECTATION_KINDS,
    expectationStatuses: MODULAR_ACCOUNT_ADMISSION_EXPECTATION_STATUSES,
    standards: Object.freeze([
      'ERC-7579',
      'ERC-6900',
      'ERC-4337',
      'ERC-1271',
      'ERC-165',
      'ERC-2771',
      'IERC7579Execution',
      'IERC7579ModuleConfig',
      'IERC7579Hook',
      'IERC6900Account',
      'ExecutionManifest',
      'ValidationConfig',
      'Attestor modular account admission receipt',
    ]),
    runtimeChecks: Object.freeze([
      'supportsExecutionMode',
      'supportsModule',
      'isModuleInstalled',
      'preCheck/postCheck',
      'executionManifest',
      'executeWithRuntimeValidation',
      'executionHooks',
    ]),
  });
}
