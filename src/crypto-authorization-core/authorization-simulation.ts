import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type { ReviewAuthorityMode } from '../release-kernel/types.js';
import type {
  CryptoAuthorizationIntent,
} from './object-model.js';
import type {
  CryptoConsequenceRiskAssessment,
} from './consequence-risk-mapping.js';
import type {
  CryptoAuthorizationConsequenceKind,
  CryptoAuthorizationPolicyDimension,
  CryptoAuthorizationRiskClass,
  CryptoExecutionAdapterKind,
} from './types.js';
import type { CryptoReleaseDecisionBinding } from './release-decision-binding.js';
import type { CryptoPolicyControlPlaneScopeBinding } from './policy-control-plane-scope-binding.js';
import type { CryptoEnforcementVerificationBinding } from './enforcement-plane-verification.js';

/**
 * Adapter-neutral preflight simulation for programmable-money authorization.
 *
 * Step 11 intentionally does not simulate chain execution itself. Instead it
 * gives operators and integrations one deterministic Attestor surface for
 * previewing whether a candidate crypto action is ready to proceed, needs
 * review/evidence, or should fail closed before a wallet, custody system, Safe,
 * bundler, contract, payment rail, or intent solver is touched.
 */

export const CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION =
  'attestor.crypto-authorization-simulation.v1';

export const CRYPTO_AUTHORIZATION_SIMULATION_OUTCOMES = [
  'allow-preview',
  'review-required',
  'deny-preview',
] as const;
export type CryptoAuthorizationSimulationOutcome =
  typeof CRYPTO_AUTHORIZATION_SIMULATION_OUTCOMES[number];

export const CRYPTO_SIMULATION_PREVIEW_CONFIDENCE = [
  'high',
  'medium',
  'low',
] as const;
export type CryptoSimulationPreviewConfidence =
  typeof CRYPTO_SIMULATION_PREVIEW_CONFIDENCE[number];

export const CRYPTO_SIMULATION_OBSERVATION_STATUSES = [
  'pass',
  'warn',
  'fail',
  'not-run',
  'not-applicable',
] as const;
export type CryptoSimulationObservationStatus =
  typeof CRYPTO_SIMULATION_OBSERVATION_STATUSES[number];

export const CRYPTO_SIMULATION_OBSERVATION_SEVERITIES = [
  'info',
  'warning',
  'critical',
] as const;
export type CryptoSimulationObservationSeverity =
  typeof CRYPTO_SIMULATION_OBSERVATION_SEVERITIES[number];

export const CRYPTO_SIMULATION_PREFLIGHT_SOURCES = [
  'wallet-capabilities',
  'wallet-call-preparation',
  'erc-4337-validation',
  'erc-7562-validation-scope',
  'erc-7715-permission',
  'eip-7702-authorization',
  'safe-guard',
  'module-hook',
  'custody-policy',
  'intent-settlement',
  'x402-payment',
] as const;
export type CryptoSimulationPreflightSource =
  typeof CRYPTO_SIMULATION_PREFLIGHT_SOURCES[number];

export const CRYPTO_SIMULATION_CHECKS = [
  'intent-risk-consistency',
  'policy-dimension-coverage',
  'risk-review-posture',
  'release-binding-readiness',
  'policy-binding-readiness',
  'enforcement-binding-readiness',
  'adapter-preflight-readiness',
  'execution-preview-readiness',
] as const;
export type CryptoSimulationCheck = typeof CRYPTO_SIMULATION_CHECKS[number];

export interface CryptoSimulationPreflightSignal {
  readonly source: CryptoSimulationPreflightSource;
  readonly status: Extract<
    CryptoSimulationObservationStatus,
    'pass' | 'warn' | 'fail' | 'not-run'
  >;
  readonly code: string;
  readonly message?: string | null;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CryptoSimulationAdapterPreflightProfile {
  readonly adapterKind: CryptoExecutionAdapterKind | 'adapter-neutral';
  readonly requiredSources: readonly CryptoSimulationPreflightSource[];
  readonly recommendedSources: readonly CryptoSimulationPreflightSource[];
  readonly standards: readonly string[];
  readonly notes: string;
}

export interface CryptoSimulationObservation {
  readonly check: CryptoSimulationCheck;
  readonly source: CryptoSimulationPreflightSource | 'attestor-core';
  readonly status: CryptoSimulationObservationStatus;
  readonly severity: CryptoSimulationObservationSeverity;
  readonly code: string;
  readonly message: string;
  readonly required: boolean;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface CryptoSimulationReadiness {
  readonly releaseBinding: 'ready' | 'missing' | 'blocked' | 'review-required';
  readonly policyBinding: 'ready' | 'missing' | 'blocked';
  readonly enforcementBinding: 'ready' | 'missing' | 'blocked';
  readonly adapterPreflight: 'ready' | 'missing' | 'blocked';
}

export interface CreateCryptoAuthorizationSimulationInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly simulatedAt: string;
  readonly releaseBinding?: CryptoReleaseDecisionBinding | null;
  readonly policyScopeBinding?: CryptoPolicyControlPlaneScopeBinding | null;
  readonly enforcementBinding?: CryptoEnforcementVerificationBinding | null;
  readonly preflightSignals?: readonly CryptoSimulationPreflightSignal[];
  readonly simulationId?: string | null;
  readonly operatorNote?: string | null;
}

export interface CryptoAuthorizationSimulationResult {
  readonly version: typeof CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION;
  readonly simulationId: string;
  readonly simulatedAt: string;
  readonly intentId: string;
  readonly consequenceKind: CryptoAuthorizationConsequenceKind;
  readonly adapterKind: CryptoExecutionAdapterKind | null;
  readonly chainId: string;
  readonly accountAddress: string;
  readonly riskClass: CryptoAuthorizationRiskClass;
  readonly reviewAuthorityMode: ReviewAuthorityMode;
  readonly outcome: CryptoAuthorizationSimulationOutcome;
  readonly confidence: CryptoSimulationPreviewConfidence;
  readonly reasonCodes: readonly string[];
  readonly readiness: CryptoSimulationReadiness;
  readonly requiredPreflightSources: readonly CryptoSimulationPreflightSource[];
  readonly recommendedPreflightSources: readonly CryptoSimulationPreflightSource[];
  readonly observations: readonly CryptoSimulationObservation[];
  readonly requiredNextArtifacts: readonly string[];
  readonly releaseBindingDigest: string | null;
  readonly policyScopeDigest: string | null;
  readonly enforcementBindingDigest: string | null;
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoAuthorizationSimulationDescriptor {
  readonly version: typeof CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION;
  readonly outcomes: typeof CRYPTO_AUTHORIZATION_SIMULATION_OUTCOMES;
  readonly confidenceLevels: typeof CRYPTO_SIMULATION_PREVIEW_CONFIDENCE;
  readonly observationStatuses: typeof CRYPTO_SIMULATION_OBSERVATION_STATUSES;
  readonly preflightSources: typeof CRYPTO_SIMULATION_PREFLIGHT_SOURCES;
  readonly checks: typeof CRYPTO_SIMULATION_CHECKS;
  readonly standards: readonly string[];
}

export const CRYPTO_SIMULATION_ADAPTER_PREFLIGHT_PROFILES = Object.freeze({
  'adapter-neutral': Object.freeze({
    adapterKind: 'adapter-neutral',
    requiredSources: Object.freeze([] as const),
    recommendedSources: Object.freeze(['wallet-capabilities'] as const),
    standards: Object.freeze(['attestor-core']),
    notes:
      'Adapter-neutral simulation can preview core Attestor readiness before a concrete execution adapter is selected.',
  }),
  'safe-guard': Object.freeze({
    adapterKind: 'safe-guard',
    requiredSources: Object.freeze(['safe-guard'] as const),
    recommendedSources: Object.freeze(['wallet-call-preparation'] as const),
    standards: Object.freeze(['Safe Guard', 'release-enforcement-plane']),
    notes:
      'Safe transaction guard simulation requires explicit guard pre-check readiness before execution dispatch.',
  }),
  'safe-module-guard': Object.freeze({
    adapterKind: 'safe-module-guard',
    requiredSources: Object.freeze(['safe-guard', 'module-hook'] as const),
    recommendedSources: Object.freeze(['wallet-call-preparation'] as const),
    standards: Object.freeze(['Safe Module Guard', 'release-enforcement-plane']),
    notes:
      'Safe module execution needs both module-guard and module/hook readiness because module paths can bypass ordinary owner transaction flow.',
  }),
  'erc-4337-user-operation': Object.freeze({
    adapterKind: 'erc-4337-user-operation',
    requiredSources: Object.freeze([
      'erc-4337-validation',
      'erc-7562-validation-scope',
    ] as const),
    recommendedSources: Object.freeze(['wallet-capabilities'] as const),
    standards: Object.freeze(['ERC-4337', 'ERC-7562']),
    notes:
      'UserOperation simulation must know account/paymaster/factory validation and ERC-7562 validation-scope posture before bundler submission.',
  }),
  'erc-7579-module': Object.freeze({
    adapterKind: 'erc-7579-module',
    requiredSources: Object.freeze(['module-hook'] as const),
    recommendedSources: Object.freeze([
      'erc-4337-validation',
      'erc-7562-validation-scope',
    ] as const),
    standards: Object.freeze(['ERC-7579', 'ERC-4337', 'ERC-7562']),
    notes:
      'Modular account simulation requires module/hook pre-check readiness and benefits from UserOperation validation evidence.',
  }),
  'erc-6900-plugin': Object.freeze({
    adapterKind: 'erc-6900-plugin',
    requiredSources: Object.freeze(['module-hook'] as const),
    recommendedSources: Object.freeze([
      'erc-4337-validation',
      'erc-7562-validation-scope',
    ] as const),
    standards: Object.freeze(['ERC-6900', 'ERC-4337', 'ERC-7562']),
    notes:
      'Plugin simulation requires module/hook readiness while keeping plugin logic outside the core authorization model.',
  }),
  'eip-7702-delegation': Object.freeze({
    adapterKind: 'eip-7702-delegation',
    requiredSources: Object.freeze(['eip-7702-authorization'] as const),
    recommendedSources: Object.freeze(['wallet-call-preparation'] as const),
    standards: Object.freeze(['EIP-7702', 'EIP-5792', 'ERC-7836']),
    notes:
      'Delegated EOA simulation must prove authorization-list, delegate target, chain, and nonce readiness before any delegated execution is attempted.',
  }),
  'wallet-call-api': Object.freeze({
    adapterKind: 'wallet-call-api',
    requiredSources: Object.freeze([
      'wallet-capabilities',
      'wallet-call-preparation',
    ] as const),
    recommendedSources: Object.freeze([] as const),
    standards: Object.freeze(['EIP-5792', 'ERC-7836', 'ERC-7902']),
    notes:
      'Wallet call simulation relies on capability discovery and prepared-call evidence before wallet submission.',
  }),
  'x402-payment': Object.freeze({
    adapterKind: 'x402-payment',
    requiredSources: Object.freeze(['x402-payment'] as const),
    recommendedSources: Object.freeze(['wallet-capabilities'] as const),
    standards: Object.freeze(['x402', 'HTTP 402']),
    notes:
      'Agentic HTTP payment simulation must bind budget, recipient, and payment requirement evidence before payment execution.',
  }),
  'custody-cosigner': Object.freeze({
    adapterKind: 'custody-cosigner',
    requiredSources: Object.freeze(['custody-policy'] as const),
    recommendedSources: Object.freeze([] as const),
    standards: Object.freeze(['custody-policy-engine']),
    notes:
      'Custody simulation must carry an explicit custody policy pre-decision without replacing the custody platform key-management layer.',
  }),
  'intent-settlement': Object.freeze({
    adapterKind: 'intent-settlement',
    requiredSources: Object.freeze(['intent-settlement'] as const),
    recommendedSources: Object.freeze(['wallet-capabilities'] as const),
    standards: Object.freeze(['intent-settlement']),
    notes:
      'Intent-settlement simulation needs solver/settlement-route evidence before off-chain routing can become executable.',
  }),
} satisfies Record<
  CryptoExecutionAdapterKind | 'adapter-neutral',
  CryptoSimulationAdapterPreflightProfile
>);

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Crypto authorization simulation ${fieldName} requires a non-empty value.`);
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
    throw new Error(`Crypto authorization simulation ${fieldName} must be an ISO timestamp.`);
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

function caip2ChainId(intent: CryptoAuthorizationIntent): string {
  return `${intent.chain.namespace}:${intent.chain.chainId}`;
}

function providedDimensions(
  intent: CryptoAuthorizationIntent,
): Set<CryptoAuthorizationPolicyDimension> {
  return new Set(intent.policyScope.dimensions);
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function observation(input: {
  readonly check: CryptoSimulationCheck;
  readonly source?: CryptoSimulationPreflightSource | 'attestor-core';
  readonly status: CryptoSimulationObservationStatus;
  readonly severity?: CryptoSimulationObservationSeverity;
  readonly code: string;
  readonly message: string;
  readonly required?: boolean;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): CryptoSimulationObservation {
  return Object.freeze({
    check: input.check,
    source: input.source ?? 'attestor-core',
    status: input.status,
    severity:
      input.severity ??
      (input.status === 'fail'
        ? 'critical'
        : input.status === 'warn' || input.status === 'not-run'
          ? 'warning'
          : 'info'),
    code: normalizeIdentifier(input.code, 'observation.code'),
    message: normalizeIdentifier(input.message, 'observation.message'),
    required: input.required ?? false,
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function adapterProfileFor(
  adapterKind: CryptoExecutionAdapterKind | null,
): CryptoSimulationAdapterPreflightProfile {
  return CRYPTO_SIMULATION_ADAPTER_PREFLIGHT_PROFILES[adapterKind ?? 'adapter-neutral'];
}

function consequenceSpecificRequiredSources(
  intent: CryptoAuthorizationIntent,
): readonly CryptoSimulationPreflightSource[] {
  switch (intent.consequenceKind) {
    case 'permission-grant':
    case 'approval':
      return ['erc-7715-permission'];
    case 'account-delegation':
      return ['eip-7702-authorization'];
    case 'user-operation':
      return ['erc-4337-validation', 'erc-7562-validation-scope'];
    case 'batch-call':
      return ['wallet-call-preparation'];
    case 'agent-payment':
      return intent.executionAdapterKind === 'x402-payment' ? ['x402-payment'] : [];
    case 'custody-withdrawal':
      return ['custody-policy'];
    default:
      return [];
  }
}

function requiredPreflightSources(
  intent: CryptoAuthorizationIntent,
): readonly CryptoSimulationPreflightSource[] {
  const profile = adapterProfileFor(intent.executionAdapterKind);
  return unique([
    ...profile.requiredSources,
    ...consequenceSpecificRequiredSources(intent),
  ]);
}

function recommendedPreflightSources(
  intent: CryptoAuthorizationIntent,
): readonly CryptoSimulationPreflightSource[] {
  const required = new Set(requiredPreflightSources(intent));
  return unique(
    adapterProfileFor(intent.executionAdapterKind).recommendedSources.filter(
      (source) => !required.has(source),
    ),
  );
}

function assertInputConsistency(input: CreateCryptoAuthorizationSimulationInput): void {
  const { intent, riskAssessment, releaseBinding, policyScopeBinding, enforcementBinding } = input;
  if (riskAssessment.consequenceKind !== intent.consequenceKind) {
    throw new Error('Crypto authorization simulation risk consequence does not match intent.');
  }
  if (riskAssessment.accountKind !== intent.account.accountKind) {
    throw new Error('Crypto authorization simulation risk account kind does not match intent.');
  }
  if (policyScopeBinding && !releaseBinding) {
    throw new Error('Crypto authorization simulation policy binding requires the release binding it was derived from.');
  }
  if (enforcementBinding && !releaseBinding) {
    throw new Error('Crypto authorization simulation enforcement binding requires the release binding it verifies.');
  }
  if (releaseBinding) {
    if (releaseBinding.consequenceKind !== intent.consequenceKind) {
      throw new Error('Crypto authorization simulation release binding consequence does not match intent.');
    }
    if (releaseBinding.riskClass !== riskAssessment.riskClass) {
      throw new Error('Crypto authorization simulation release binding risk does not match risk assessment.');
    }
    if (releaseBinding.chainId !== caip2ChainId(intent)) {
      throw new Error('Crypto authorization simulation release binding chain does not match intent.');
    }
    if (releaseBinding.accountAddress !== intent.account.address) {
      throw new Error('Crypto authorization simulation release binding account does not match intent.');
    }
  }
  if (policyScopeBinding && releaseBinding) {
    if (policyScopeBinding.cryptoDecisionId !== releaseBinding.cryptoDecisionId) {
      throw new Error('Crypto authorization simulation policy binding does not match release-bound crypto decision.');
    }
    if (
      policyScopeBinding.releaseDecisionId !== null &&
      policyScopeBinding.releaseDecisionId !== releaseBinding.releaseDecisionId
    ) {
      throw new Error('Crypto authorization simulation policy binding does not match release decision.');
    }
  }
  if (enforcementBinding && releaseBinding) {
    if (enforcementBinding.cryptoDecisionId !== releaseBinding.cryptoDecisionId) {
      throw new Error('Crypto authorization simulation enforcement binding does not match crypto decision.');
    }
    if (enforcementBinding.releaseDecisionId !== releaseBinding.releaseDecisionId) {
      throw new Error('Crypto authorization simulation enforcement binding does not match release decision.');
    }
    if (enforcementBinding.expectedBinding.riskClass !== releaseBinding.riskClass) {
      throw new Error('Crypto authorization simulation enforcement binding risk does not match release binding.');
    }
  }
}

function intentRiskObservations(
  input: CreateCryptoAuthorizationSimulationInput,
): readonly CryptoSimulationObservation[] {
  return Object.freeze([
    observation({
      check: 'intent-risk-consistency',
      status: 'pass',
      code: 'intent-risk-consistent',
      message: 'Intent and risk assessment describe the same crypto consequence and account kind.',
      required: true,
      evidence: {
        intentId: input.intent.intentId,
        consequenceKind: input.intent.consequenceKind,
        accountKind: input.intent.account.accountKind,
        riskClass: input.riskAssessment.riskClass,
      },
    }),
  ]);
}

function policyDimensionObservations(
  input: CreateCryptoAuthorizationSimulationInput,
): readonly CryptoSimulationObservation[] {
  const provided = providedDimensions(input.intent);
  const missing = input.riskAssessment.review.requiredPolicyDimensions.filter(
    (dimension) => !provided.has(dimension),
  );
  if (missing.length > 0) {
    return Object.freeze([
      observation({
        check: 'policy-dimension-coverage',
        status: 'fail',
        code: 'policy-dimensions-missing',
        message: 'Candidate crypto action is missing risk-required policy dimensions.',
        required: true,
        evidence: {
          missing,
          provided: input.intent.policyScope.dimensions,
        },
      }),
    ]);
  }

  return Object.freeze([
    observation({
      check: 'policy-dimension-coverage',
      status: 'pass',
      code: 'policy-dimensions-covered',
      message: 'Candidate crypto action covers every risk-required policy dimension.',
      required: true,
      evidence: {
        provided: input.intent.policyScope.dimensions,
        required: input.riskAssessment.review.requiredPolicyDimensions,
      },
    }),
  ]);
}

function riskReviewObservation(
  input: CreateCryptoAuthorizationSimulationInput,
): CryptoSimulationObservation {
  const mode = input.riskAssessment.review.authorityMode;
  const releaseStatus = input.releaseBinding?.releaseDecision.status ?? null;
  if (mode === 'auto') {
    return observation({
      check: 'risk-review-posture',
      status: 'pass',
      code: 'risk-auto-release-eligible',
      message: 'Risk posture is eligible for automatic release if all bindings and preflight checks pass.',
      evidence: {
        riskClass: input.riskAssessment.riskClass,
        authorityMode: mode,
      },
    });
  }

  if (
    input.releaseBinding?.status === 'bound' &&
    (releaseStatus === 'accepted' || releaseStatus === 'overridden')
  ) {
    return observation({
      check: 'risk-review-posture',
      status: 'pass',
      code: 'risk-review-authority-satisfied',
      message: 'Risk posture required review authority, and the release binding shows it has been satisfied.',
      required: true,
      evidence: {
        riskClass: input.riskAssessment.riskClass,
        authorityMode: mode,
        releaseStatus,
      },
    });
  }

  return observation({
    check: 'risk-review-posture',
    status: 'warn',
    code: `risk-requires-${mode}`,
    message: 'Risk posture requires human or break-glass authority before an allow outcome can become executable.',
    required: true,
    evidence: {
      riskClass: input.riskAssessment.riskClass,
      authorityMode: mode,
      minimumReviewerCount: input.riskAssessment.review.minimumReviewerCount,
    },
  });
}

function releaseBindingObservation(
  binding: CryptoReleaseDecisionBinding | null,
): CryptoSimulationObservation {
  if (!binding) {
    return observation({
      check: 'release-binding-readiness',
      status: 'warn',
      code: 'release-binding-missing',
      message: 'No release-layer binding is attached yet, so the preview cannot become executable.',
      required: true,
    });
  }

  const releaseStatus = binding.releaseDecision.status;
  if (binding.status === 'blocked' || releaseStatus === 'denied' || releaseStatus === 'expired' || releaseStatus === 'revoked') {
    return observation({
      check: 'release-binding-readiness',
      status: 'fail',
      code: 'release-binding-blocked',
      message: 'Release-layer binding is blocked or terminally denied.',
      required: true,
      evidence: {
        bindingStatus: binding.status,
        releaseStatus,
        releaseDecisionId: binding.releaseDecisionId,
      },
    });
  }

  if (
    binding.status === 'review-required' ||
    binding.status === 'pending' ||
    releaseStatus === 'hold' ||
    releaseStatus === 'review-required'
  ) {
    return observation({
      check: 'release-binding-readiness',
      status: 'warn',
      code: 'release-binding-needs-review-or-finalization',
      message: 'Release-layer binding exists but still needs review, freshness, or finalization before execution.',
      required: true,
      evidence: {
        bindingStatus: binding.status,
        releaseStatus,
        releaseDecisionId: binding.releaseDecisionId,
      },
    });
  }

  return observation({
    check: 'release-binding-readiness',
    status: 'pass',
    code: 'release-binding-ready',
    message: 'Release-layer binding is ready for downstream authorization simulation.',
    required: true,
    evidence: {
      bindingStatus: binding.status,
      releaseStatus,
      releaseDecisionId: binding.releaseDecisionId,
      digest: binding.digest,
    },
  });
}

function policyBindingObservation(
  policyScopeBinding: CryptoPolicyControlPlaneScopeBinding | null,
): CryptoSimulationObservation {
  if (!policyScopeBinding) {
    return observation({
      check: 'policy-binding-readiness',
      status: 'warn',
      code: 'policy-binding-missing',
      message: 'No policy-control-plane scope binding is attached yet.',
      required: true,
    });
  }

  if (policyScopeBinding.activationRecord.state !== 'active') {
    return observation({
      check: 'policy-binding-readiness',
      status: 'fail',
      code: 'policy-activation-not-active',
      message: 'Policy-control-plane binding is present but the activation record is not active.',
      required: true,
      evidence: {
        activationId: policyScopeBinding.activationId,
        activationState: policyScopeBinding.activationRecord.state,
      },
    });
  }

  return observation({
    check: 'policy-binding-readiness',
    status: 'pass',
    code: 'policy-binding-ready',
    message: 'Policy-control-plane scope binding is active and simulation-ready.',
    required: true,
    evidence: {
      activationId: policyScopeBinding.activationId,
      bundleId: policyScopeBinding.bundleId,
      digest: policyScopeBinding.digest,
    },
  });
}

function enforcementBindingObservation(
  enforcementBinding: CryptoEnforcementVerificationBinding | null,
): CryptoSimulationObservation {
  if (!enforcementBinding) {
    return observation({
      check: 'enforcement-binding-readiness',
      status: 'warn',
      code: 'enforcement-binding-missing',
      message: 'No enforcement-plane verification binding is attached yet.',
      required: true,
    });
  }

  if (!enforcementBinding.verificationProfile.failClosed) {
    return observation({
      check: 'enforcement-binding-readiness',
      status: 'fail',
      code: 'enforcement-profile-not-fail-closed',
      message: 'Crypto execution simulation requires a fail-closed enforcement profile.',
      required: true,
      evidence: {
        profileId: enforcementBinding.verificationProfile.id,
      },
    });
  }

  return observation({
    check: 'enforcement-binding-readiness',
    status: 'pass',
    code: 'enforcement-binding-ready',
    message: 'Enforcement-plane binding provides a fail-closed verification profile and expected token bindings.',
    required: true,
    evidence: {
      bindingId: enforcementBinding.bindingId,
      profileId: enforcementBinding.verificationProfile.id,
      boundaryKind: enforcementBinding.enforcementRequest.enforcementPoint.boundaryKind,
      digest: enforcementBinding.digest,
    },
  });
}

function signalObservation(
  signal: CryptoSimulationPreflightSignal,
  required: boolean,
): CryptoSimulationObservation {
  return observation({
    check: 'adapter-preflight-readiness',
    source: signal.source,
    status: signal.status,
    code: signal.code,
    message:
      signal.message ??
      `Adapter preflight signal ${signal.source} returned ${signal.status}.`,
    required: required || signal.required === true,
    evidence: signal.evidence,
  });
}

function preflightObservations(
  input: CreateCryptoAuthorizationSimulationInput,
): readonly CryptoSimulationObservation[] {
  const required = requiredPreflightSources(input.intent);
  const recommended = recommendedPreflightSources(input.intent);
  const requiredSet = new Set(required);
  const recommendedSet = new Set(recommended);
  const signals = input.preflightSignals ?? [];
  const observations: CryptoSimulationObservation[] = [];

  for (const signal of signals) {
    observations.push(signalObservation(signal, requiredSet.has(signal.source)));
  }

  const seen = new Set(signals.map((signal) => signal.source));
  for (const source of required) {
    if (!seen.has(source)) {
      observations.push(
        observation({
          check: 'adapter-preflight-readiness',
          source,
          status: 'not-run',
          code: `required-${source}-missing`,
          message: `Required ${source} preflight evidence is missing for this adapter/consequence path.`,
          required: true,
        }),
      );
    }
  }
  for (const source of recommended) {
    if (!seen.has(source) && !recommendedSet.has(source)) {
      continue;
    }
    if (!seen.has(source)) {
      observations.push(
        observation({
          check: 'adapter-preflight-readiness',
          source,
          status: 'not-run',
          code: `recommended-${source}-missing`,
          message: `Recommended ${source} preflight evidence is not present yet.`,
          required: false,
        }),
      );
    }
  }

  if (required.length === 0 && signals.length === 0) {
    observations.push(
      observation({
        check: 'adapter-preflight-readiness',
        status: 'not-applicable',
        code: 'adapter-preflight-not-required',
        message: 'No adapter-specific preflight source is required for this simulation.',
      }),
    );
  }

  return Object.freeze(observations);
}

function executionReadinessObservation(
  observations: readonly CryptoSimulationObservation[],
): CryptoSimulationObservation {
  const hardFailures = observations.filter((entry) => entry.status === 'fail');
  const requiredMissing = observations.filter(
    (entry) => entry.required && entry.status === 'not-run',
  );
  const requiredWarnings = observations.filter(
    (entry) => entry.required && entry.status === 'warn',
  );

  if (hardFailures.length > 0) {
    return observation({
      check: 'execution-preview-readiness',
      status: 'fail',
      code: 'execution-preview-denied',
      message: 'Simulation has hard failures and should fail closed before execution.',
      required: true,
      evidence: {
        failures: hardFailures.map((entry) => entry.code),
      },
    });
  }

  if (requiredMissing.length > 0 || requiredWarnings.length > 0) {
    return observation({
      check: 'execution-preview-readiness',
      status: 'warn',
      code: 'execution-preview-needs-review-or-evidence',
      message: 'Simulation needs review, finalization, or required preflight evidence before execution.',
      required: true,
      evidence: {
        missing: requiredMissing.map((entry) => entry.code),
        warnings: requiredWarnings.map((entry) => entry.code),
      },
    });
  }

  return observation({
    check: 'execution-preview-readiness',
    status: 'pass',
    code: 'execution-preview-ready',
    message: 'Simulation is ready for an allow preview.',
    required: true,
  });
}

function outcomeFromObservations(
  observations: readonly CryptoSimulationObservation[],
): CryptoAuthorizationSimulationOutcome {
  if (observations.some((entry) => entry.status === 'fail')) {
    return 'deny-preview';
  }
  if (
    observations.some(
      (entry) =>
        entry.required &&
        (entry.status === 'warn' || entry.status === 'not-run'),
    )
  ) {
    return 'review-required';
  }
  return 'allow-preview';
}

function confidenceFromObservations(
  outcome: CryptoAuthorizationSimulationOutcome,
  observations: readonly CryptoSimulationObservation[],
): CryptoSimulationPreviewConfidence {
  if (outcome === 'deny-preview') {
    return 'high';
  }
  if (outcome === 'allow-preview') {
    return observations.some((entry) => entry.status === 'warn' || entry.status === 'not-run')
      ? 'medium'
      : 'high';
  }
  const missingRequired = observations.some(
    (entry) => entry.required && entry.status === 'not-run',
  );
  return missingRequired ? 'low' : 'medium';
}

function reasonCodesFromObservations(
  observations: readonly CryptoSimulationObservation[],
): readonly string[] {
  return Object.freeze(
    observations
      .filter((entry) => entry.status !== 'pass' && entry.status !== 'not-applicable')
      .map((entry) => entry.code),
  );
}

function requiredNextArtifacts(
  observations: readonly CryptoSimulationObservation[],
): readonly string[] {
  const artifacts: string[] = [];
  for (const entry of observations) {
    if (!entry.required) {
      continue;
    }
    if (entry.status === 'warn' || entry.status === 'not-run') {
      artifacts.push(entry.code);
    }
  }
  return Object.freeze([...new Set(artifacts)]);
}

function readinessFor(
  observations: readonly CryptoSimulationObservation[],
): CryptoSimulationReadiness {
  const byCheck = (check: CryptoSimulationCheck) =>
    observations.find((entry) => entry.check === check);
  const release = byCheck('release-binding-readiness');
  const policy = byCheck('policy-binding-readiness');
  const enforcement = byCheck('enforcement-binding-readiness');
  const preflight = observations.filter(
    (entry) => entry.check === 'adapter-preflight-readiness' && entry.required,
  );

  return Object.freeze({
    releaseBinding:
      release?.status === 'pass'
        ? 'ready'
        : release?.status === 'fail'
          ? 'blocked'
          : release?.code === 'release-binding-missing'
            ? 'missing'
            : 'review-required',
    policyBinding:
      policy?.status === 'pass'
        ? 'ready'
        : policy?.status === 'fail'
          ? 'blocked'
          : 'missing',
    enforcementBinding:
      enforcement?.status === 'pass'
        ? 'ready'
        : enforcement?.status === 'fail'
          ? 'blocked'
          : 'missing',
    adapterPreflight:
      preflight.some((entry) => entry.status === 'fail')
        ? 'blocked'
        : preflight.some((entry) => entry.status === 'not-run' || entry.status === 'warn')
          ? 'missing'
          : 'ready',
  });
}

function simulationIdFor(input: {
  readonly intent: CryptoAuthorizationIntent;
  readonly simulatedAt: string;
  readonly releaseBindingDigest: string | null;
  readonly policyScopeDigest: string | null;
  readonly enforcementBindingDigest: string | null;
}): string {
  return canonicalObject({
    version: CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION,
    intentId: input.intent.intentId,
    simulatedAt: input.simulatedAt,
    releaseBindingDigest: input.releaseBindingDigest,
    policyScopeDigest: input.policyScopeDigest,
    enforcementBindingDigest: input.enforcementBindingDigest,
  }).digest;
}

export function cryptoSimulationAdapterPreflightProfile(
  adapterKind: CryptoExecutionAdapterKind | null,
): CryptoSimulationAdapterPreflightProfile {
  return adapterProfileFor(adapterKind);
}

export function createCryptoAuthorizationSimulation(
  input: CreateCryptoAuthorizationSimulationInput,
): CryptoAuthorizationSimulationResult {
  assertInputConsistency(input);
  const simulatedAt = normalizeIsoTimestamp(input.simulatedAt, 'simulatedAt');
  const releaseBinding = input.releaseBinding ?? null;
  const policyScopeBinding = input.policyScopeBinding ?? null;
  const enforcementBinding = input.enforcementBinding ?? null;
  const releaseBindingDigest = releaseBinding?.digest ?? null;
  const policyScopeDigest = policyScopeBinding?.digest ?? null;
  const enforcementBindingDigest = enforcementBinding?.digest ?? null;
  const baseObservations = Object.freeze([
    ...intentRiskObservations(input),
    ...policyDimensionObservations(input),
    riskReviewObservation(input),
    releaseBindingObservation(releaseBinding),
    policyBindingObservation(policyScopeBinding),
    enforcementBindingObservation(enforcementBinding),
    ...preflightObservations(input),
  ]);
  const observations = Object.freeze([
    ...baseObservations,
    executionReadinessObservation(baseObservations),
  ]);
  const outcome = outcomeFromObservations(observations);
  const requiredSources = requiredPreflightSources(input.intent);
  const recommendedSources = recommendedPreflightSources(input.intent);
  const simulationId =
    normalizeOptionalIdentifier(input.simulationId, 'simulationId') ??
    simulationIdFor({
      intent: input.intent,
      simulatedAt,
      releaseBindingDigest,
      policyScopeDigest,
      enforcementBindingDigest,
    });
  const canonicalPayload = {
    version: CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION,
    simulationId,
    simulatedAt,
    intentId: input.intent.intentId,
    consequenceKind: input.intent.consequenceKind,
    adapterKind: input.intent.executionAdapterKind,
    chainId: caip2ChainId(input.intent),
    accountAddress: input.intent.account.address,
    riskClass: input.riskAssessment.riskClass,
    reviewAuthorityMode: input.riskAssessment.review.authorityMode,
    outcome,
    confidence: confidenceFromObservations(outcome, observations),
    reasonCodes: reasonCodesFromObservations(observations),
    readiness: readinessFor(observations),
    requiredPreflightSources: requiredSources,
    recommendedPreflightSources: recommendedSources,
    observations,
    requiredNextArtifacts: requiredNextArtifacts(observations),
    releaseBindingDigest,
    policyScopeDigest,
    enforcementBindingDigest,
    operatorNote: normalizeOptionalIdentifier(input.operatorNote, 'operatorNote'),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function cryptoAuthorizationSimulationLabel(
  simulation: CryptoAuthorizationSimulationResult,
): string {
  return [
    `crypto-simulation:${simulation.intentId}`,
    `outcome:${simulation.outcome}`,
    `risk:${simulation.riskClass}`,
    `adapter:${simulation.adapterKind ?? 'adapter-neutral'}`,
  ].join(' / ');
}

export function cryptoAuthorizationSimulationDescriptor():
CryptoAuthorizationSimulationDescriptor {
  return Object.freeze({
    version: CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION,
    outcomes: CRYPTO_AUTHORIZATION_SIMULATION_OUTCOMES,
    confidenceLevels: CRYPTO_SIMULATION_PREVIEW_CONFIDENCE,
    observationStatuses: CRYPTO_SIMULATION_OBSERVATION_STATUSES,
    preflightSources: CRYPTO_SIMULATION_PREFLIGHT_SOURCES,
    checks: CRYPTO_SIMULATION_CHECKS,
    standards: Object.freeze([
      'release-layer',
      'release-policy-control-plane',
      'release-enforcement-plane',
      'EIP-5792',
      'ERC-7836',
      'ERC-7902-ready',
      'ERC-4337',
      'ERC-7562',
      'ERC-7715',
      'EIP-7702',
      'ERC-7579',
      'ERC-6900',
      'Safe-guards',
      'x402-ready',
      'custody-policy-ready',
    ]),
  });
}
