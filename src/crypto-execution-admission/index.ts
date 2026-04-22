import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationCheck,
  CryptoSimulationObservation,
  CryptoSimulationObservationStatus,
  CryptoSimulationPreflightSource,
} from '../crypto-authorization-core/authorization-simulation.js';
import type { CryptoExecutionAdapterKind } from '../crypto-authorization-core/types.js';

/**
 * Crypto execution admission turns a crypto authorization simulation into the
 * concrete handoff plan an integration point needs before submitting anything
 * to a wallet, smart account, bundler, payment facilitator, custody engine, or
 * intent solver.
 */

export const CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION =
  'attestor.crypto-execution-admission.v1';
export const CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH =
  'attestor/crypto-execution-admission';
export const CRYPTO_EXECUTION_ADMISSION_PACKAGE_NAME = 'attestor';

export const CRYPTO_EXECUTION_ADMISSION_OUTCOMES = [
  'admit',
  'needs-evidence',
  'deny',
] as const;
export type CryptoExecutionAdmissionOutcome =
  typeof CRYPTO_EXECUTION_ADMISSION_OUTCOMES[number];

export const CRYPTO_EXECUTION_ADMISSION_SURFACES = [
  'attestor-core',
  'wallet-rpc',
  'smart-account-guard',
  'account-abstraction-bundler',
  'modular-account-runtime',
  'delegated-eoa-runtime',
  'agent-payment-http',
  'custody-policy-engine',
  'intent-solver',
] as const;
export type CryptoExecutionAdmissionSurface =
  typeof CRYPTO_EXECUTION_ADMISSION_SURFACES[number];

export const CRYPTO_EXECUTION_ADMISSION_STEP_KINDS = [
  'block-execution',
  'collect-release-authorization',
  'activate-policy-scope',
  'bind-enforcement-presentation',
  'collect-adapter-preflight',
  'prepare-wallet-call',
  'run-smart-account-guard',
  'simulate-user-operation',
  'verify-http-payment',
  'evaluate-custody-policy',
  'verify-intent-settlement',
  'submit-execution',
  'record-admission-receipt',
] as const;
export type CryptoExecutionAdmissionStepKind =
  typeof CRYPTO_EXECUTION_ADMISSION_STEP_KINDS[number];

export const CRYPTO_EXECUTION_ADMISSION_STEP_STATUSES = [
  'satisfied',
  'required',
  'recommended',
  'blocked',
] as const;
export type CryptoExecutionAdmissionStepStatus =
  typeof CRYPTO_EXECUTION_ADMISSION_STEP_STATUSES[number];

export interface CryptoExecutionAdmissionAdapterProfile {
  readonly adapterKind: CryptoExecutionAdapterKind | null;
  readonly surface: CryptoExecutionAdmissionSurface;
  readonly standards: readonly string[];
  readonly requiredHandoffArtifacts: readonly string[];
  readonly submitStepKind: CryptoExecutionAdmissionStepKind;
  readonly transportHeaders: readonly string[];
}

export interface CryptoExecutionAdmissionStep {
  readonly stepId: string;
  readonly kind: CryptoExecutionAdmissionStepKind;
  readonly surface: CryptoExecutionAdmissionSurface;
  readonly status: CryptoExecutionAdmissionStepStatus;
  readonly reasonCode: string;
  readonly message: string;
  readonly source:
    | CryptoSimulationPreflightSource
    | CryptoSimulationCheck
    | 'admission-planner';
  readonly standards: readonly string[];
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CreateCryptoExecutionAdmissionPlanInput {
  readonly simulation: CryptoAuthorizationSimulationResult;
  readonly createdAt: string;
  readonly planId?: string | null;
  readonly integrationRef?: string | null;
  readonly operatorNote?: string | null;
}

export interface CryptoExecutionAdmissionPlan {
  readonly version: typeof CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION;
  readonly planId: string;
  readonly createdAt: string;
  readonly integrationRef: string | null;
  readonly simulationId: string;
  readonly simulationDigest: string;
  readonly intentId: string;
  readonly consequenceKind: CryptoAuthorizationSimulationResult['consequenceKind'];
  readonly adapterKind: CryptoExecutionAdapterKind | null;
  readonly surface: CryptoExecutionAdmissionSurface;
  readonly outcome: CryptoExecutionAdmissionOutcome;
  readonly chainId: string;
  readonly accountAddress: string;
  readonly standards: readonly string[];
  readonly requiredHandoffArtifacts: readonly string[];
  readonly transportHeaders: readonly string[];
  readonly steps: readonly CryptoExecutionAdmissionStep[];
  readonly blockedReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoExecutionAdmissionDescriptor {
  readonly version: typeof CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION;
  readonly packageName: typeof CRYPTO_EXECUTION_ADMISSION_PACKAGE_NAME;
  readonly subpath: typeof CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH;
  readonly outcomes: typeof CRYPTO_EXECUTION_ADMISSION_OUTCOMES;
  readonly surfaces: typeof CRYPTO_EXECUTION_ADMISSION_SURFACES;
  readonly stepKinds: typeof CRYPTO_EXECUTION_ADMISSION_STEP_KINDS;
  readonly standards: readonly string[];
}

export const CRYPTO_EXECUTION_ADMISSION_ADAPTER_PROFILES = Object.freeze({
  'adapter-neutral': Object.freeze({
    adapterKind: null,
    surface: 'attestor-core',
    standards: Object.freeze(['attestor-core']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'policy-scope-binding',
      'enforcement-presentation',
    ]),
    submitStepKind: 'submit-execution',
    transportHeaders: Object.freeze([]),
  }),
  'safe-guard': Object.freeze({
    adapterKind: 'safe-guard',
    surface: 'smart-account-guard',
    standards: Object.freeze(['Safe Guard', 'ERC-1271']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'safe-transaction-hash',
      'guard-precheck',
    ]),
    submitStepKind: 'run-smart-account-guard',
    transportHeaders: Object.freeze([]),
  }),
  'safe-module-guard': Object.freeze({
    adapterKind: 'safe-module-guard',
    surface: 'smart-account-guard',
    standards: Object.freeze(['Safe Module Guard', 'Safe Modules', 'ERC-1271']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'safe-module-transaction-hash',
      'module-guard-precheck',
    ]),
    submitStepKind: 'run-smart-account-guard',
    transportHeaders: Object.freeze([]),
  }),
  'erc-4337-user-operation': Object.freeze({
    adapterKind: 'erc-4337-user-operation',
    surface: 'account-abstraction-bundler',
    standards: Object.freeze(['ERC-4337', 'ERC-7562', 'ERC-1271']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'user-operation-hash',
      'simulate-validation-result',
    ]),
    submitStepKind: 'simulate-user-operation',
    transportHeaders: Object.freeze([]),
  }),
  'erc-7579-module': Object.freeze({
    adapterKind: 'erc-7579-module',
    surface: 'modular-account-runtime',
    standards: Object.freeze(['ERC-7579', 'ERC-4337']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'module-installation-evidence',
      'module-hook-precheck',
    ]),
    submitStepKind: 'submit-execution',
    transportHeaders: Object.freeze([]),
  }),
  'erc-6900-plugin': Object.freeze({
    adapterKind: 'erc-6900-plugin',
    surface: 'modular-account-runtime',
    standards: Object.freeze(['ERC-6900', 'ERC-4337']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'plugin-manifest-approval',
      'module-hook-precheck',
    ]),
    submitStepKind: 'submit-execution',
    transportHeaders: Object.freeze([]),
  }),
  'eip-7702-delegation': Object.freeze({
    adapterKind: 'eip-7702-delegation',
    surface: 'delegated-eoa-runtime',
    standards: Object.freeze(['EIP-7702', 'EIP-5792', 'ERC-7902']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'authorization-list-tuple',
      'delegate-code-approval',
    ]),
    submitStepKind: 'prepare-wallet-call',
    transportHeaders: Object.freeze([]),
  }),
  'wallet-call-api': Object.freeze({
    adapterKind: 'wallet-call-api',
    surface: 'wallet-rpc',
    standards: Object.freeze(['EIP-5792', 'ERC-7715', 'ERC-7902']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'wallet-capabilities',
      'prepared-call-bundle',
    ]),
    submitStepKind: 'prepare-wallet-call',
    transportHeaders: Object.freeze([]),
  }),
  'x402-payment': Object.freeze({
    adapterKind: 'x402-payment',
    surface: 'agent-payment-http',
    standards: Object.freeze(['x402-v2', 'HTTP 402', 'EIP-3009']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'PAYMENT-REQUIRED',
      'PAYMENT-SIGNATURE',
      'PAYMENT-RESPONSE',
    ]),
    submitStepKind: 'verify-http-payment',
    transportHeaders: Object.freeze([
      'PAYMENT-REQUIRED',
      'PAYMENT-SIGNATURE',
      'PAYMENT-RESPONSE',
    ]),
  }),
  'custody-cosigner': Object.freeze({
    adapterKind: 'custody-cosigner',
    surface: 'custody-policy-engine',
    standards: Object.freeze(['custody-policy-engine', 'co-signer-callback']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'custody-policy-decision',
      'co-signer-response',
    ]),
    submitStepKind: 'evaluate-custody-policy',
    transportHeaders: Object.freeze([]),
  }),
  'intent-settlement': Object.freeze({
    adapterKind: 'intent-settlement',
    surface: 'intent-solver',
    standards: Object.freeze(['intent-settlement', 'solver-preflight']),
    requiredHandoffArtifacts: Object.freeze([
      'attestor-release-authorization',
      'solver-route-commitment',
      'settlement-preflight',
    ]),
    submitStepKind: 'verify-intent-settlement',
    transportHeaders: Object.freeze([]),
  }),
} satisfies Record<
  CryptoExecutionAdapterKind | 'adapter-neutral',
  CryptoExecutionAdmissionAdapterProfile
>);

function normalizeIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`Crypto execution admission ${fieldName} requires a non-empty value.`);
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
    throw new Error(`Crypto execution admission ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
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

function adapterProfileFor(
  adapterKind: CryptoExecutionAdapterKind | null,
): CryptoExecutionAdmissionAdapterProfile {
  return CRYPTO_EXECUTION_ADMISSION_ADAPTER_PROFILES[adapterKind ?? 'adapter-neutral'];
}

function step(input: {
  readonly stepId: string;
  readonly kind: CryptoExecutionAdmissionStepKind;
  readonly surface: CryptoExecutionAdmissionSurface;
  readonly status: CryptoExecutionAdmissionStepStatus;
  readonly reasonCode: string;
  readonly message: string;
  readonly source:
    | CryptoSimulationPreflightSource
    | CryptoSimulationCheck
    | 'admission-planner';
  readonly standards?: readonly string[];
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): CryptoExecutionAdmissionStep {
  return Object.freeze({
    stepId: normalizeIdentifier(input.stepId, 'stepId'),
    kind: input.kind,
    surface: input.surface,
    status: input.status,
    reasonCode: normalizeIdentifier(input.reasonCode, 'step.reasonCode'),
    message: normalizeIdentifier(input.message, 'step.message'),
    source: input.source,
    standards: Object.freeze(input.standards ?? []),
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function readinessStep(input: {
  readonly check: CryptoSimulationCheck;
  readonly ready: boolean;
  readonly blocked: boolean;
  readonly missingReason: string;
  readonly blockedReason: string;
  readonly readyReason: string;
  readonly kind: CryptoExecutionAdmissionStepKind;
}): CryptoExecutionAdmissionStep {
  return step({
    stepId: input.check,
    kind: input.kind,
    surface: 'attestor-core',
    status: input.blocked ? 'blocked' : input.ready ? 'satisfied' : 'required',
    reasonCode: input.blocked
      ? input.blockedReason
      : input.ready
        ? input.readyReason
        : input.missingReason,
    message: input.blocked
      ? 'This Attestor binding is blocked and execution must not proceed.'
      : input.ready
        ? 'This Attestor binding is ready for execution admission.'
        : 'This Attestor binding is required before execution admission can continue.',
    source: input.check,
    standards: ['attestor-release', 'attestor-policy', 'attestor-enforcement'],
  });
}

function statusFromObservation(
  observation: CryptoSimulationObservation | null,
): CryptoExecutionAdmissionStepStatus {
  if (!observation) return 'required';
  if (observation.status === 'pass' || observation.status === 'not-applicable') {
    return 'satisfied';
  }
  if (observation.status === 'fail') return 'blocked';
  if (observation.status === 'warn' || observation.status === 'not-run') return 'required';
  return 'recommended';
}

function sourceObservation(
  simulation: CryptoAuthorizationSimulationResult,
  source: CryptoSimulationPreflightSource,
): CryptoSimulationObservation | null {
  return simulation.observations.find(
    (observation) =>
      observation.check === 'adapter-preflight-readiness' &&
      observation.source === source,
  ) ?? null;
}

function preflightStepKind(
  source: CryptoSimulationPreflightSource,
  profile: CryptoExecutionAdmissionAdapterProfile,
): CryptoExecutionAdmissionStepKind {
  switch (source) {
    case 'wallet-capabilities':
    case 'wallet-call-preparation':
    case 'eip-7702-authorization':
      return 'prepare-wallet-call';
    case 'erc-4337-validation':
    case 'erc-7562-validation-scope':
      return 'simulate-user-operation';
    case 'safe-guard':
    case 'module-hook':
      return 'run-smart-account-guard';
    case 'x402-payment':
      return 'verify-http-payment';
    case 'custody-policy':
      return 'evaluate-custody-policy';
    case 'intent-settlement':
      return 'verify-intent-settlement';
    case 'erc-7715-permission':
      return profile.surface === 'wallet-rpc'
        ? 'prepare-wallet-call'
        : 'collect-adapter-preflight';
  }
}

function preflightSteps(
  simulation: CryptoAuthorizationSimulationResult,
  profile: CryptoExecutionAdmissionAdapterProfile,
): readonly CryptoExecutionAdmissionStep[] {
  return Object.freeze(
    simulation.requiredPreflightSources.map((source) => {
      const observation = sourceObservation(simulation, source);
      return step({
        stepId: `preflight:${source}`,
        kind: preflightStepKind(source, profile),
        surface: profile.surface,
        status: statusFromObservation(observation),
        reasonCode: observation?.code ?? `required-${source}-missing`,
        message:
          observation?.message ??
          `Required ${source} preflight evidence is missing for execution admission.`,
        source,
        standards: profile.standards,
        evidence: observation?.evidence,
      });
    }),
  );
}

function admissionOutcome(
  simulation: CryptoAuthorizationSimulationResult,
): CryptoExecutionAdmissionOutcome {
  if (
    simulation.outcome === 'deny-preview' ||
    simulation.readiness.releaseBinding === 'blocked' ||
    simulation.readiness.policyBinding === 'blocked' ||
    simulation.readiness.enforcementBinding === 'blocked' ||
    simulation.readiness.adapterPreflight === 'blocked'
  ) {
    return 'deny';
  }
  if (
    simulation.outcome === 'allow-preview' &&
    simulation.readiness.releaseBinding === 'ready' &&
    simulation.readiness.policyBinding === 'ready' &&
    simulation.readiness.enforcementBinding === 'ready' &&
    simulation.readiness.adapterPreflight === 'ready'
  ) {
    return 'admit';
  }
  return 'needs-evidence';
}

function nextActionsFor(
  outcome: CryptoExecutionAdmissionOutcome,
  steps: readonly CryptoExecutionAdmissionStep[],
  profile: CryptoExecutionAdmissionAdapterProfile,
): readonly string[] {
  if (outcome === 'deny') {
    return Object.freeze([
      'Do not submit the transaction, UserOperation, payment, custody request, or intent route.',
      'Resolve blocked Attestor or adapter preflight reasons before creating a new admission plan.',
    ]);
  }
  if (outcome === 'admit') {
    return Object.freeze([
      `Proceed through ${profile.surface} using the listed handoff artifacts.`,
      'Record the admission receipt after the downstream execution attempt returns.',
    ]);
  }
  return Object.freeze(
    steps
      .filter((entry) => entry.status === 'required')
      .map((entry) => entry.reasonCode),
  );
}

function blockedReasonsFor(
  steps: readonly CryptoExecutionAdmissionStep[],
): readonly string[] {
  return Object.freeze(
    steps
      .filter((entry) => entry.status === 'blocked')
      .map((entry) => entry.reasonCode),
  );
}

function planIdFor(input: {
  readonly simulation: CryptoAuthorizationSimulationResult;
  readonly createdAt: string;
  readonly integrationRef: string | null;
}): string {
  return canonicalObject({
    version: CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION,
    simulationId: input.simulation.simulationId,
    simulationDigest: input.simulation.digest,
    createdAt: input.createdAt,
    integrationRef: input.integrationRef,
  }).digest;
}

export function cryptoExecutionAdmissionAdapterProfile(
  adapterKind: CryptoExecutionAdapterKind | null,
): CryptoExecutionAdmissionAdapterProfile {
  return adapterProfileFor(adapterKind);
}

export function createCryptoExecutionAdmissionPlan(
  input: CreateCryptoExecutionAdmissionPlanInput,
): CryptoExecutionAdmissionPlan {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const integrationRef = normalizeOptionalIdentifier(input.integrationRef, 'integrationRef');
  const profile = adapterProfileFor(input.simulation.adapterKind);
  const baseSteps = Object.freeze([
    readinessStep({
      check: 'release-binding-readiness',
      ready: input.simulation.readiness.releaseBinding === 'ready',
      blocked: input.simulation.readiness.releaseBinding === 'blocked',
      missingReason: 'release-authorization-required',
      blockedReason: 'release-authorization-blocked',
      readyReason: 'release-authorization-ready',
      kind: 'collect-release-authorization',
    }),
    readinessStep({
      check: 'policy-binding-readiness',
      ready: input.simulation.readiness.policyBinding === 'ready',
      blocked: input.simulation.readiness.policyBinding === 'blocked',
      missingReason: 'policy-scope-activation-required',
      blockedReason: 'policy-scope-activation-blocked',
      readyReason: 'policy-scope-activation-ready',
      kind: 'activate-policy-scope',
    }),
    readinessStep({
      check: 'enforcement-binding-readiness',
      ready: input.simulation.readiness.enforcementBinding === 'ready',
      blocked: input.simulation.readiness.enforcementBinding === 'blocked',
      missingReason: 'enforcement-presentation-required',
      blockedReason: 'enforcement-presentation-blocked',
      readyReason: 'enforcement-presentation-ready',
      kind: 'bind-enforcement-presentation',
    }),
    ...preflightSteps(input.simulation, profile),
  ]);
  const outcome = admissionOutcome(input.simulation);
  const terminalStep = outcome === 'deny'
    ? step({
        stepId: 'block-execution',
        kind: 'block-execution',
        surface: profile.surface,
        status: 'blocked',
        reasonCode: 'execution-admission-denied',
        message: 'Execution admission is denied by Attestor simulation or adapter preflight.',
        source: 'admission-planner',
        standards: profile.standards,
      })
    : step({
        stepId: 'submit-execution',
        kind: profile.submitStepKind,
        surface: profile.surface,
        status: outcome === 'admit' ? 'required' : 'recommended',
        reasonCode: outcome === 'admit'
          ? 'downstream-execution-admitted'
          : 'downstream-execution-waits-for-required-evidence',
        message: outcome === 'admit'
          ? 'Downstream execution may proceed through the selected admission surface.'
          : 'Downstream execution should wait until required admission evidence is satisfied.',
        source: 'admission-planner',
        standards: profile.standards,
      });
  const receiptStep = step({
    stepId: 'record-admission-receipt',
    kind: 'record-admission-receipt',
    surface: 'attestor-core',
    status: outcome === 'admit' ? 'required' : 'recommended',
    reasonCode: 'admission-receipt-required',
    message: 'Record a durable Attestor admission receipt after the downstream execution attempt.',
    source: 'admission-planner',
    standards: ['attestor-evidence'],
  });
  const steps = Object.freeze([...baseSteps, terminalStep, receiptStep]);
  const blockedReasons = blockedReasonsFor(steps);
  const planId =
    normalizeOptionalIdentifier(input.planId, 'planId') ??
    planIdFor({
      simulation: input.simulation,
      createdAt,
      integrationRef,
    });
  const canonicalPayload = {
    version: CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION,
    planId,
    createdAt,
    integrationRef,
    simulationId: input.simulation.simulationId,
    simulationDigest: input.simulation.digest,
    intentId: input.simulation.intentId,
    consequenceKind: input.simulation.consequenceKind,
    adapterKind: input.simulation.adapterKind,
    surface: profile.surface,
    outcome,
    chainId: input.simulation.chainId,
    accountAddress: input.simulation.accountAddress,
    standards: profile.standards,
    requiredHandoffArtifacts: profile.requiredHandoffArtifacts,
    transportHeaders: profile.transportHeaders,
    steps,
    blockedReasons,
    nextActions: nextActionsFor(outcome, steps, profile),
    operatorNote: normalizeOptionalIdentifier(input.operatorNote, 'operatorNote'),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function cryptoExecutionAdmissionLabel(
  plan: CryptoExecutionAdmissionPlan,
): string {
  return [
    `crypto-admission:${plan.intentId}`,
    `outcome:${plan.outcome}`,
    `surface:${plan.surface}`,
    `adapter:${plan.adapterKind ?? 'adapter-neutral'}`,
  ].join(' / ');
}

export function cryptoExecutionAdmissionDescriptor():
CryptoExecutionAdmissionDescriptor {
  return Object.freeze({
    version: CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION,
    packageName: CRYPTO_EXECUTION_ADMISSION_PACKAGE_NAME,
    subpath: CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
    outcomes: CRYPTO_EXECUTION_ADMISSION_OUTCOMES,
    surfaces: CRYPTO_EXECUTION_ADMISSION_SURFACES,
    stepKinds: CRYPTO_EXECUTION_ADMISSION_STEP_KINDS,
    standards: Object.freeze([
      'Attestor release layer',
      'Attestor policy control plane',
      'Attestor enforcement plane',
      'EIP-5792',
      'ERC-7715',
      'ERC-7902',
      'ERC-1271',
      'ERC-4337',
      'ERC-7579',
      'ERC-6900',
      'EIP-7702',
      'Safe Guards',
      'x402-v2',
      'custody-policy-engine',
    ]),
  });
}

export * from './wallet-rpc.js';
export * from './safe-guard.js';
export * from './erc4337-bundler.js';
export * from './modular-account.js';
export * from './delegated-eoa.js';
