import { createHash } from 'node:crypto';
import {
  createCryptoCanonicalAccountReference,
  createCryptoCanonicalAssetReference,
  createCryptoCanonicalChainReference,
  createCryptoCanonicalCounterpartyReference,
  createCryptoCanonicalReferenceBundle,
  type CryptoCanonicalAccountReference,
  type CryptoCanonicalAssetReference,
  type CryptoCanonicalChainReference,
  type CryptoCanonicalCounterpartyReference,
  type CryptoCounterpartyKind,
} from './canonical-references.js';
import {
  CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES,
  type CryptoAuthorizationPolicyDimension,
} from './types.js';
import type {
  CryptoAuthorizationDecision,
  CryptoAuthorizationIntent,
} from './object-model.js';
import type { CryptoConsequenceRiskAssessment } from './consequence-risk-mapping.js';
import type { CryptoReleaseDecisionBinding } from './release-decision-binding.js';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import { riskControlProfile } from '../release-kernel/risk-controls.js';
import {
  policy,
  type CapabilityBoundaryDescriptor,
  type OutputContractDescriptor,
  type ReleaseActorReference,
  type ReleasePolicyDefinition,
  type ReleasePolicyRolloutMode,
} from '../release-layer/index.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
  type SignablePolicyBundleArtifact,
} from '../release-policy-control-plane/bundle-format.js';
import {
  createPolicyActivationRecord,
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyPackMetadata,
  type PolicyActivationRecord,
  type PolicyBundleEntry,
  type PolicyBundleManifest,
  type PolicyPackMetadata,
} from '../release-policy-control-plane/object-model.js';
import {
  createPolicyActivationTarget,
  createPolicyScopeSelector,
  policyActivationTargetLabel,
  type PolicyActivationTarget,
  type PolicyBundleReference,
  type PolicyScopeSelector,
} from '../release-policy-control-plane/types.js';
import {
  POLICY_STORE_RECORD_SPEC_VERSION,
  type StoredPolicyBundleRecord,
} from '../release-policy-control-plane/store.js';
import type { DryRunPolicyActivationOverlay } from '../release-policy-control-plane/simulation.js';
import type { PolicyMutationAuditAppendInput } from '../release-policy-control-plane/audit-log.js';

/**
 * Crypto authorization binding into the release policy control plane.
 *
 * Step 09 keeps crypto scope rich enough for chain/account/asset/budget policy,
 * while projecting it into the generic policy-control-plane activation grammar
 * that already signs, activates, simulates, and audits release policies.
 */

export const CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION =
  'attestor.crypto-policy-control-plane-scope-binding.v1';

export const CRYPTO_POLICY_CONTROL_PLANE_DOMAIN_ID = 'crypto-authorization';
export const CRYPTO_POLICY_CONTROL_PLANE_DEFAULT_PACK_ID =
  'crypto-authorization-core';
export const CRYPTO_POLICY_CONTROL_PLANE_POLICY_SCHEMA_ID =
  'attestor.crypto-authorization-policy-scope';
export const CRYPTO_POLICY_CONTROL_PLANE_POLICY_SCHEMA_VERSION = '1.0.0';
export const CRYPTO_POLICY_CONTROL_PLANE_POLICY_SCHEMA_URI =
  'https://schemas.attestor.ai/crypto-authorization/policy-scope/v1';

export const CRYPTO_POLICY_CONTROL_PLANE_SCOPE_DIMENSIONS = [
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
] as const satisfies readonly CryptoAuthorizationPolicyDimension[];

export const CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS = [
  'crypto-decision-matches-intent',
  'risk-assessment-matches-decision',
  'risk-required-dimensions-are-covered',
  'canonical-chain-account-asset-scope-is-bound',
  'spender-counterparty-protocol-budget-scope-is-bound',
  'control-plane-activation-target-is-derived',
  'policy-bundle-entry-hash-is-bound',
  'signable-policy-pack-artifact-is-bound',
  'simulation-overlay-is-bound',
  'audit-snapshot-is-bound',
] as const;
export type CryptoPolicyControlPlaneScopeBindingCheck =
  typeof CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS[number];

export interface CryptoPolicyControlPlaneBudgetScope {
  readonly maxAmount: string | null;
  readonly budgetId: string | null;
  readonly cadence: string | null;
  readonly validAfter: string;
  readonly validUntil: string;
  readonly nonce: string;
  readonly replayProtectionMode: string;
  readonly digestMode: string;
}

export interface CryptoPolicyControlPlaneExtendedScope {
  readonly version: typeof CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION;
  readonly providedDimensions: readonly CryptoAuthorizationPolicyDimension[];
  readonly requiredDimensions: readonly CryptoAuthorizationPolicyDimension[];
  readonly chain: CryptoCanonicalChainReference;
  readonly account: CryptoCanonicalAccountReference;
  readonly asset: CryptoCanonicalAssetReference | null;
  readonly counterparty: CryptoCanonicalCounterpartyReference | null;
  readonly actor: {
    readonly actorKind: CryptoAuthorizationIntent['requester']['actorKind'];
    readonly actorId: string;
    readonly authorityRef: string | null;
  };
  readonly spender: string | null;
  readonly protocol: string | null;
  readonly functionSelector: string | null;
  readonly calldataClass: string | null;
  readonly budget: CryptoPolicyControlPlaneBudgetScope;
  readonly consequenceKind: CryptoAuthorizationIntent['consequenceKind'];
  readonly executionAdapterKind: CryptoAuthorizationIntent['executionAdapterKind'];
  readonly accountKind: CryptoAuthorizationIntent['account']['accountKind'];
  readonly targetKind: CryptoAuthorizationIntent['target']['targetKind'];
  readonly referenceBundleDigest: string;
  readonly policyPackRef: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateCryptoPolicyControlPlaneScopeBindingInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly cryptoDecision: CryptoAuthorizationDecision;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding?: CryptoReleaseDecisionBinding | null;
  readonly policyDefinition?: ReleasePolicyDefinition | null;
  readonly generatedAt?: string | null;
  readonly storedAt?: string | null;
  readonly packId?: string | null;
  readonly packName?: string | null;
  readonly packDescription?: string | null;
  readonly bundleId?: string | null;
  readonly bundleVersion?: string | null;
  readonly entryId?: string | null;
  readonly activationId?: string | null;
  readonly actor?: ReleaseActorReference | null;
  readonly planId?: string | null;
  readonly cohortId?: string | null;
  readonly rolloutMode?: ReleasePolicyRolloutMode | null;
}

export interface CryptoPolicyControlPlaneScopeBinding {
  readonly version: typeof CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION;
  readonly bindingId: string;
  readonly intentId: string;
  readonly cryptoDecisionId: string;
  readonly releaseDecisionId: string | null;
  readonly policyPackId: string;
  readonly bundleId: string;
  readonly activationId: string;
  readonly activationTarget: PolicyActivationTarget;
  readonly scopeSelector: PolicyScopeSelector;
  readonly targetLabel: string;
  readonly cryptoScope: CryptoPolicyControlPlaneExtendedScope;
  readonly policyPack: PolicyPackMetadata;
  readonly bundleReference: PolicyBundleReference;
  readonly policyBundleEntry: PolicyBundleEntry;
  readonly policyBundleManifest: PolicyBundleManifest;
  readonly signableArtifact: SignablePolicyBundleArtifact;
  readonly bundleRecord: StoredPolicyBundleRecord;
  readonly activationRecord: PolicyActivationRecord;
  readonly simulationOverlay: DryRunPolicyActivationOverlay;
  readonly auditAppendInput: PolicyMutationAuditAppendInput;
  readonly bindingChecks: readonly CryptoPolicyControlPlaneScopeBindingCheck[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoPolicyControlPlaneScopeBindingDescriptor {
  readonly version: typeof CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION;
  readonly domainId: typeof CRYPTO_POLICY_CONTROL_PLANE_DOMAIN_ID;
  readonly cryptoScopeDimensions: typeof CRYPTO_POLICY_CONTROL_PLANE_SCOPE_DIMENSIONS;
  readonly bindingChecks: typeof CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS;
  readonly standards: readonly string[];
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Crypto policy-control-plane scope binding ${fieldName} requires a non-empty value.`);
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

function normalizeIsoTimestamp(
  value: string | null | undefined,
  fallback: string,
  fieldName: string,
): string {
  const timestamp = new Date(value ?? fallback);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Crypto policy-control-plane scope binding ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function canonicalizeJson(value: CanonicalReleaseJsonValue): string {
  return canonicalizeReleaseJson(value);
}

function digestCanonicalJson(value: CanonicalReleaseJsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value)).digest('hex')}`;
}

function canonicalObject<T extends CanonicalReleaseJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  return Object.freeze({
    canonical: canonicalizeJson(value),
    digest: digestCanonicalJson(value),
  });
}

function uniqueDimensions(
  values: readonly CryptoAuthorizationPolicyDimension[],
): readonly CryptoAuthorizationPolicyDimension[] {
  return Object.freeze([...new Set(values)]);
}

function assertInputConsistency(input: CreateCryptoPolicyControlPlaneScopeBindingInput): void {
  const { intent, cryptoDecision, riskAssessment, releaseBinding } = input;
  if (cryptoDecision.intentId !== intent.intentId) {
    throw new Error('Crypto policy-control-plane scope binding decision intent id does not match intent.');
  }
  if (riskAssessment.consequenceKind !== intent.consequenceKind) {
    throw new Error('Crypto policy-control-plane scope binding risk consequence does not match intent.');
  }
  if (riskAssessment.riskClass !== cryptoDecision.riskClass) {
    throw new Error('Crypto policy-control-plane scope binding risk class does not match crypto decision.');
  }
  if (releaseBinding) {
    if (releaseBinding.cryptoDecisionId !== cryptoDecision.decisionId) {
      throw new Error('Crypto policy-control-plane scope binding release binding does not match crypto decision.');
    }
    if (releaseBinding.consequenceKind !== intent.consequenceKind) {
      throw new Error('Crypto policy-control-plane scope binding release consequence does not match intent.');
    }
    if (releaseBinding.riskClass !== cryptoDecision.riskClass) {
      throw new Error('Crypto policy-control-plane scope binding release risk does not match crypto decision.');
    }
  }
}

function assertRequiredDimensions(input: CreateCryptoPolicyControlPlaneScopeBindingInput): void {
  const provided = new Set(input.intent.policyScope.dimensions);
  const required = input.riskAssessment.review.requiredPolicyDimensions;
  const missing = required.filter((dimension) => !provided.has(dimension));
  if (missing.length > 0) {
    throw new Error(
      `Crypto policy-control-plane scope binding policy scope is missing required dimensions: ${missing.join(', ')}.`,
    );
  }
}

function dimensionIsRequired(
  input: CreateCryptoPolicyControlPlaneScopeBindingInput,
  dimension: CryptoAuthorizationPolicyDimension,
): boolean {
  return input.riskAssessment.review.requiredPolicyDimensions.includes(dimension);
}

function assertDimensionValues(input: CreateCryptoPolicyControlPlaneScopeBindingInput): void {
  const { intent } = input;
  const requires = (dimension: CryptoAuthorizationPolicyDimension) =>
    dimensionIsRequired(input, dimension);

  if (requires('asset') && intent.asset === null) {
    throw new Error('Crypto policy-control-plane scope binding asset scope requires an asset reference.');
  }
  if (requires('amount') && intent.constraints.maxAmount === null) {
    throw new Error('Crypto policy-control-plane scope binding amount scope requires maxAmount.');
  }
  if (requires('budget')) {
    const hasBudget =
      intent.constraints.budgetId !== null ||
      intent.constraints.maxAmount !== null ||
      intent.constraints.cadence !== null;
    if (!hasBudget) {
      throw new Error('Crypto policy-control-plane scope binding budget scope requires a budget, amount, or cadence bound.');
    }
  }
  if (requires('cadence') && intent.constraints.cadence === null) {
    throw new Error('Crypto policy-control-plane scope binding cadence scope requires cadence.');
  }
  if (requires('counterparty') && !intent.target.counterparty && !intent.target.address) {
    throw new Error('Crypto policy-control-plane scope binding counterparty scope requires counterparty or address.');
  }
  if (requires('spender') && !intent.target.address && !intent.target.counterparty) {
    throw new Error('Crypto policy-control-plane scope binding spender scope requires spender address or counterparty.');
  }
  if (requires('protocol') && intent.target.protocol === null) {
    throw new Error('Crypto policy-control-plane scope binding protocol scope requires protocol.');
  }
  if (requires('function-selector') && intent.target.functionSelector === null) {
    throw new Error('Crypto policy-control-plane scope binding function-selector scope requires functionSelector.');
  }
  if (requires('calldata-class') && intent.target.calldataClass === null) {
    throw new Error('Crypto policy-control-plane scope binding calldata-class scope requires calldataClass.');
  }
  if (requires('runtime-context') && intent.executionAdapterKind === null) {
    throw new Error('Crypto policy-control-plane scope binding runtime-context scope requires executionAdapterKind.');
  }
}

function counterpartyKindForIntent(intent: CryptoAuthorizationIntent): CryptoCounterpartyKind {
  switch (intent.target.targetKind) {
    case 'bridge':
      return 'bridge';
    case 'intent-solver':
      return 'intent-solver';
    case 'custody-destination':
      return 'custody-destination';
    case 'governance-proposal':
      return 'protocol';
    case 'payee':
    case 'address':
      return 'account';
    case 'contract':
    case 'module':
      return intent.target.protocol ? 'protocol' : 'contract';
  }
}

function createCounterpartyReference(
  intent: CryptoAuthorizationIntent,
): CryptoCanonicalCounterpartyReference | null {
  const counterpartyId = intent.target.counterparty ?? intent.target.address ?? null;
  if (counterpartyId === null) {
    return null;
  }

  return createCryptoCanonicalCounterpartyReference({
    counterpartyKind: counterpartyKindForIntent(intent),
    counterpartyId,
    chain: intent.chain,
    display: intent.target.protocol ?? counterpartyId,
  });
}

function createExtendedScope(
  input: CreateCryptoPolicyControlPlaneScopeBindingInput,
): CryptoPolicyControlPlaneExtendedScope {
  assertRequiredDimensions(input);
  assertDimensionValues(input);

  const { intent, riskAssessment } = input;
  const chain = createCryptoCanonicalChainReference(intent.chain);
  const account = createCryptoCanonicalAccountReference(intent.account);
  const asset = intent.asset
    ? createCryptoCanonicalAssetReference({
        asset: intent.asset,
        assetNamespace:
          intent.asset.chain.namespace === 'eip155' && intent.asset.assetKind !== 'native-token'
            ? 'erc20'
            : undefined,
      })
    : null;
  const counterparty = createCounterpartyReference(intent);
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain,
    account,
    asset,
    counterparty,
  });
  const requiredDimensions = uniqueDimensions(riskAssessment.review.requiredPolicyDimensions);
  const providedDimensions = uniqueDimensions(intent.policyScope.dimensions);
  const scopePayload = {
    version: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
    providedDimensions,
    requiredDimensions,
    chainDigest: chain.digest,
    accountDigest: account.digest,
    assetDigest: asset?.digest ?? null,
    counterpartyDigest: counterparty?.digest ?? null,
    actorKind: intent.requester.actorKind,
    actorId: intent.requester.actorId,
    spender: intent.target.address ?? intent.target.counterparty ?? null,
    protocol: intent.target.protocol,
    functionSelector: intent.target.functionSelector,
    calldataClass: intent.target.calldataClass,
    budget: {
      maxAmount: intent.constraints.maxAmount,
      budgetId: intent.constraints.budgetId,
      cadence: intent.constraints.cadence,
      validAfter: intent.constraints.validAfter,
      validUntil: intent.constraints.validUntil,
      nonce: intent.constraints.nonce,
      replayProtectionMode: intent.constraints.replayProtectionMode,
      digestMode: intent.constraints.digestMode,
    },
    consequenceKind: intent.consequenceKind,
    executionAdapterKind: intent.executionAdapterKind,
    accountKind: intent.account.accountKind,
    targetKind: intent.target.targetKind,
    referenceBundleDigest: referenceBundle.digest,
    policyPackRef: intent.policyScope.policyPackRef,
  } as const;
  const canonical = canonicalObject(scopePayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    version: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
    providedDimensions,
    requiredDimensions,
    chain,
    account,
    asset,
    counterparty,
    actor: Object.freeze({
      actorKind: intent.requester.actorKind,
      actorId: intent.requester.actorId,
      authorityRef: intent.requester.authorityRef,
    }),
    spender: intent.target.address ?? intent.target.counterparty ?? null,
    protocol: intent.target.protocol,
    functionSelector: intent.target.functionSelector,
    calldataClass: intent.target.calldataClass,
    budget: Object.freeze({
      maxAmount: intent.constraints.maxAmount,
      budgetId: intent.constraints.budgetId,
      cadence: intent.constraints.cadence,
      validAfter: intent.constraints.validAfter,
      validUntil: intent.constraints.validUntil,
      nonce: intent.constraints.nonce,
      replayProtectionMode: intent.constraints.replayProtectionMode,
      digestMode: intent.constraints.digestMode,
    }),
    consequenceKind: intent.consequenceKind,
    executionAdapterKind: intent.executionAdapterKind,
    accountKind: intent.account.accountKind,
    targetKind: intent.target.targetKind,
    referenceBundleDigest: referenceBundle.digest,
    policyPackRef: intent.policyScope.policyPackRef,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

function defaultActor(intent: CryptoAuthorizationIntent): ReleaseActorReference {
  return Object.freeze({
    id: intent.requester.actorId,
    type: intent.requester.actorKind === 'human' ? 'user' : 'service',
    displayName: intent.requester.authorityRef ?? intent.requester.actorId,
    role: `crypto-${intent.requester.actorKind}`,
  });
}

function stableId(prefix: string, material: CanonicalReleaseJsonValue, length = 20): string {
  const digest = createHash('sha256').update(canonicalizeJson(material)).digest('hex');
  return `${prefix}_${digest.slice(0, length)}`;
}

function resolvePackId(input: CreateCryptoPolicyControlPlaneScopeBindingInput): string {
  return normalizeOptionalIdentifier(input.packId, 'packId') ??
    normalizeOptionalIdentifier(input.intent.policyScope.policyPackRef, 'policyPackRef') ??
    CRYPTO_POLICY_CONTROL_PLANE_DEFAULT_PACK_ID;
}

function createActivationTarget(
  input: CreateCryptoPolicyControlPlaneScopeBindingInput,
  cryptoScope: CryptoPolicyControlPlaneExtendedScope,
): PolicyActivationTarget {
  const profile = CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[input.intent.consequenceKind];
  const environment = normalizeIdentifier(
    input.intent.policyScope.environment,
    'policyScope.environment',
  );
  const tenantId = normalizeIdentifier(
    input.intent.policyScope.tenantId,
    'policyScope.tenantId',
  );
  const accountId =
    normalizeOptionalIdentifier(input.intent.policyScope.accountId, 'policyScope.accountId') ??
    cryptoScope.account.caip10AccountId;
  const cohortId =
    normalizeOptionalIdentifier(input.cohortId, 'cohortId') ??
    [
      cryptoScope.chain.caip2ChainId,
      input.intent.executionAdapterKind ?? 'adapter-neutral',
      input.intent.consequenceKind,
    ].join(':');

  return createPolicyActivationTarget({
    environment,
    tenantId,
    accountId,
    domainId: CRYPTO_POLICY_CONTROL_PLANE_DOMAIN_ID,
    wedgeId: `crypto.${input.intent.consequenceKind}`,
    consequenceType: profile.releaseConsequenceType,
    riskClass: input.cryptoDecision.riskClass,
    cohortId,
    planId: normalizeOptionalIdentifier(input.planId, 'planId'),
  });
}

function defaultOutputContract(
  input: CreateCryptoPolicyControlPlaneScopeBindingInput,
): OutputContractDescriptor {
  const profile = CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[input.intent.consequenceKind];
  return Object.freeze({
    artifactType: 'attestor.crypto-authorization',
    expectedShape: [
      'crypto',
      input.intent.consequenceKind,
      input.intent.executionAdapterKind ?? 'adapter-neutral',
      'policy-scope',
    ].join(':'),
    consequenceType: profile.releaseConsequenceType,
    riskClass: input.cryptoDecision.riskClass,
  });
}

function defaultCapabilityBoundary(
  input: CreateCryptoPolicyControlPlaneScopeBindingInput,
  cryptoScope: CryptoPolicyControlPlaneExtendedScope,
): CapabilityBoundaryDescriptor {
  return Object.freeze({
    allowedTools: Object.freeze([
      input.intent.executionAdapterKind ?? 'adapter-neutral',
      input.cryptoDecision.signerAuthorities[0]?.validationMode ?? 'attestor-release-signature',
      input.intent.constraints.replayProtectionMode,
    ]),
    allowedTargets: Object.freeze([
      cryptoScope.chain.caip2ChainId,
      cryptoScope.account.caip10AccountId,
      input.intent.target.targetId,
      input.intent.target.address ?? input.intent.target.targetId,
    ]),
    allowedDataDomains: Object.freeze([
      CRYPTO_POLICY_CONTROL_PLANE_DOMAIN_ID,
      input.intent.consequenceKind,
      input.intent.account.accountKind,
      ...input.intent.policyScope.dimensions,
    ]),
  });
}

function createDefaultPolicyDefinition(
  input: CreateCryptoPolicyControlPlaneScopeBindingInput,
  cryptoScope: CryptoPolicyControlPlaneExtendedScope,
  generatedAt: string,
): ReleasePolicyDefinition {
  const outputContract = input.releaseBinding?.hashBinding.outputContract ?? defaultOutputContract(input);
  const capabilityBoundary =
    input.releaseBinding?.hashBinding.capabilityBoundary ??
    defaultCapabilityBoundary(input, cryptoScope);
  const controls = riskControlProfile(input.cryptoDecision.riskClass);

  return policy.createReleasePolicyDefinition({
    id: `crypto.${input.intent.consequenceKind}.${input.cryptoDecision.riskClass}.policy.v1`,
    name: `Crypto ${CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[input.intent.consequenceKind].label} authorization policy`,
    rollout: {
      mode: input.rolloutMode ?? 'enforce',
      activatedAt: generatedAt,
      cohortKey: 'account-id',
      cohortSalt: 'attestor.crypto.policy-scope',
      notes: [
        'Crypto authorization policy scopes bind chain, account, asset, counterparty, spender, protocol, and budget context before execution adapters run.',
      ],
    },
    scope: {
      wedgeId: `crypto.${input.intent.consequenceKind}`,
      consequenceType: outputContract.consequenceType,
      riskClass: input.cryptoDecision.riskClass,
      targetKinds: ['workflow'],
      dataDomains: capabilityBoundary.allowedDataDomains,
    },
    outputContract: {
      allowedArtifactTypes: [outputContract.artifactType],
      expectedShape: outputContract.expectedShape,
      consequenceType: outputContract.consequenceType,
      riskClass: input.cryptoDecision.riskClass,
    },
    capabilityBoundary: {
      allowedTools: capabilityBoundary.allowedTools,
      allowedTargets: capabilityBoundary.allowedTargets,
      allowedDataDomains: capabilityBoundary.allowedDataDomains,
      requiresSingleTargetBinding: true,
    },
    acceptance: {
      strategy: 'all-required',
      requiredChecks: controls.deterministicChecks,
      requiredEvidenceKinds: ['signature', 'provenance', 'finding-log'],
      maxWarnings: 0,
      failureDisposition: controls.review.failureDisposition,
    },
    release: {
      reviewMode: controls.review.mode,
      minimumReviewerCount: controls.review.minimumReviewerCount,
      tokenEnforcement: controls.token.minimumEnforcement,
      requireSignedEnvelope: true,
      requireDurableEvidencePack: controls.evidence.requiresDurableEvidencePack,
      requireDownstreamReceipt: controls.evidence.requiresDownstreamReceipt,
      retentionClass: controls.evidence.retentionClass,
    },
    notes: [
      `Binds crypto consequence ${input.intent.consequenceKind} to policy-control-plane scope ${cryptoScope.digest}.`,
      `Required crypto dimensions: ${cryptoScope.requiredDimensions.join(', ')}.`,
    ],
  });
}

function createPolicyEntry(
  entryId: string,
  activationTarget: PolicyActivationTarget,
  definition: ReleasePolicyDefinition,
): PolicyBundleEntry {
  const provisional = createPolicyBundleEntry({
    id: entryId,
    scopeTarget: activationTarget,
    definition,
    policyHash: 'sha256:placeholder',
  });

  return createPolicyBundleEntry({
    id: entryId,
    scopeTarget: activationTarget,
    definition,
    policyHash: computePolicyBundleEntryDigest(provisional),
  });
}

function createBundleReference(
  input: CreateCryptoPolicyControlPlaneScopeBindingInput,
  packId: string,
  cryptoScope: CryptoPolicyControlPlaneExtendedScope,
  generatedAt: string,
): PolicyBundleReference {
  const bundleId =
    normalizeOptionalIdentifier(input.bundleId, 'bundleId') ??
    stableId('crypto_policy_bundle', {
      intentId: input.intent.intentId,
      decisionId: input.cryptoDecision.decisionId,
      scopeDigest: cryptoScope.digest,
    } as unknown as CanonicalReleaseJsonValue);
  const bundleVersion =
    normalizeOptionalIdentifier(input.bundleVersion, 'bundleVersion') ??
    generatedAt.slice(0, 10).replaceAll('-', '.');
  const digest = digestCanonicalJson({
    version: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
    packId,
    bundleId,
    bundleVersion,
    scopeDigest: cryptoScope.digest,
    riskDigest: input.riskAssessment.digest,
  } as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    packId,
    bundleId,
    bundleVersion,
    digest,
  });
}

export function createCryptoPolicyControlPlaneScopeBinding(
  input: CreateCryptoPolicyControlPlaneScopeBindingInput,
): CryptoPolicyControlPlaneScopeBinding {
  assertInputConsistency(input);

  const generatedAt = normalizeIsoTimestamp(
    input.generatedAt,
    input.cryptoDecision.decidedAt,
    'generatedAt',
  );
  const storedAt = normalizeIsoTimestamp(input.storedAt, generatedAt, 'storedAt');
  const actor = input.actor ?? defaultActor(input.intent);
  const cryptoScope = createExtendedScope(input);
  const activationTarget = createActivationTarget(input, cryptoScope);
  const scopeSelector = createPolicyScopeSelector(activationTarget);
  const targetLabel = policyActivationTargetLabel(activationTarget);
  const packId = resolvePackId(input);
  const bundleReference = createBundleReference(input, packId, cryptoScope, generatedAt);
  const policyDefinition =
    input.policyDefinition ??
    createDefaultPolicyDefinition(input, cryptoScope, generatedAt);
  const entryId =
    normalizeOptionalIdentifier(input.entryId, 'entryId') ??
    stableId('crypto_policy_entry', {
      decisionId: input.cryptoDecision.decisionId,
      scopeDigest: cryptoScope.digest,
    } as unknown as CanonicalReleaseJsonValue);
  const policyBundleEntry = createPolicyEntry(entryId, activationTarget, policyDefinition);
  const policyPack = createPolicyPackMetadata({
    id: packId,
    name: input.packName ?? 'Crypto Authorization Core',
    description:
      input.packDescription ??
      'Policy pack for crypto authorization chain/account/asset/counterparty/spender/protocol/budget scopes.',
    lifecycleState: 'published',
    owners: ['crypto-authorization'],
    labels: [
      'crypto',
      input.intent.consequenceKind,
      input.cryptoDecision.riskClass,
      input.intent.executionAdapterKind ?? 'adapter-neutral',
    ],
    createdAt: generatedAt,
    updatedAt: generatedAt,
    latestBundleRef: bundleReference,
  });
  const policyBundleManifest = createPolicyBundleManifest({
    bundle: bundleReference,
    pack: policyPack,
    generatedAt,
    discoveryMode: 'bundle-manifest',
    bundleLabels: ['crypto', input.intent.consequenceKind, input.cryptoDecision.riskClass],
    schemas: [
      {
        id: CRYPTO_POLICY_CONTROL_PLANE_POLICY_SCHEMA_ID,
        version: CRYPTO_POLICY_CONTROL_PLANE_POLICY_SCHEMA_VERSION,
        uri: CRYPTO_POLICY_CONTROL_PLANE_POLICY_SCHEMA_URI,
        digest: cryptoScope.digest,
      },
    ],
    entries: [policyBundleEntry],
  });
  const signableArtifact = createSignablePolicyBundleArtifact(
    policyPack,
    policyBundleManifest,
  );
  const bundleRecord: StoredPolicyBundleRecord = Object.freeze({
    version: POLICY_STORE_RECORD_SPEC_VERSION,
    packId: policyBundleManifest.packId,
    bundleId: signableArtifact.bundleId,
    bundleVersion: policyBundleManifest.bundle.bundleVersion,
    storedAt,
    manifest: policyBundleManifest,
    artifact: signableArtifact,
    signedBundle: null,
    verificationKey: null,
  });
  const activationId =
    normalizeOptionalIdentifier(input.activationId, 'activationId') ??
    stableId('crypto_policy_activation', {
      bundleId: bundleReference.bundleId,
      targetLabel,
      decisionId: input.cryptoDecision.decisionId,
    } as unknown as CanonicalReleaseJsonValue);
  const activationRecord = createPolicyActivationRecord({
    id: activationId,
    state: 'active',
    operationType: 'activate-bundle',
    target: activationTarget,
    bundle: bundleReference,
    activatedBy: actor,
    activatedAt: generatedAt,
    rolloutMode: policyDefinition.rollout.mode,
    reasonCode: 'crypto-policy-scope-binding',
    rationale:
      'Bind crypto authorization scope to a signed policy-control-plane bundle before downstream crypto execution.',
  });
  const simulationOverlay: DryRunPolicyActivationOverlay = Object.freeze({
    bundleRecord,
    target: activationTarget,
    discoveryMode: 'scoped-active',
    activationId,
    actor,
    activatedAt: generatedAt,
    reasonCode: 'crypto-policy-scope-binding-dry-run',
    rationale:
      'Simulate crypto authorization policy scope activation without mutating the persistent control plane.',
  });
  const auditAppendInput: PolicyMutationAuditAppendInput = Object.freeze({
    occurredAt: generatedAt,
    action: 'activate-bundle',
    actor,
    subject: Object.freeze({
      packId: packId,
      bundleId: bundleReference.bundleId,
      bundleVersion: bundleReference.bundleVersion,
      activationId,
      targetLabel,
    }),
    reasonCode: 'crypto-policy-scope-binding',
    rationale:
      'Crypto authorization policy scope activation binds chain/account/asset/counterparty/spender/protocol/budget evidence to a policy bundle.',
    mutationSnapshot: Object.freeze({
      version: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
      intentId: input.intent.intentId,
      cryptoDecisionId: input.cryptoDecision.decisionId,
      releaseDecisionId: input.releaseBinding?.releaseDecisionId ?? input.cryptoDecision.releaseDecisionId,
      activationTarget,
      cryptoScope: {
        digest: cryptoScope.digest,
        chain: cryptoScope.chain.caip2ChainId,
        account: cryptoScope.account.caip10AccountId,
        asset: cryptoScope.asset?.caip19AssetId ?? null,
        counterparty: cryptoScope.counterparty?.counterpartyId ?? null,
        spender: cryptoScope.spender,
        protocol: cryptoScope.protocol,
        budget: cryptoScope.budget,
        requiredDimensions: cryptoScope.requiredDimensions,
      },
      policyHash: policyBundleEntry.policyHash,
      bundleDigest: signableArtifact.payloadDigest,
    }),
  });
  const bindingId = digestCanonicalJson({
    version: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
    intentId: input.intent.intentId,
    decisionId: input.cryptoDecision.decisionId,
    releaseDecisionId: input.releaseBinding?.releaseDecisionId ?? input.cryptoDecision.releaseDecisionId,
    scopeDigest: cryptoScope.digest,
    policyHash: policyBundleEntry.policyHash,
    bundlePayloadDigest: signableArtifact.payloadDigest,
    activationId,
  } as unknown as CanonicalReleaseJsonValue);
  const canonicalPayload = {
    version: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
    bindingId,
    intentId: input.intent.intentId,
    cryptoDecisionId: input.cryptoDecision.decisionId,
    releaseDecisionId: input.releaseBinding?.releaseDecisionId ?? input.cryptoDecision.releaseDecisionId,
    policyPackId: packId,
    bundleId: bundleReference.bundleId,
    activationId,
    activationTarget,
    scopeSelector,
    targetLabel,
    cryptoScopeDigest: cryptoScope.digest,
    policyHash: policyBundleEntry.policyHash,
    signableArtifactDigest: signableArtifact.payloadDigest,
    auditMutationDigest: digestCanonicalJson(auditAppendInput.mutationSnapshot as CanonicalReleaseJsonValue),
    bindingChecks: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS,
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    version: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
    bindingId,
    intentId: input.intent.intentId,
    cryptoDecisionId: input.cryptoDecision.decisionId,
    releaseDecisionId: input.releaseBinding?.releaseDecisionId ?? input.cryptoDecision.releaseDecisionId,
    policyPackId: packId,
    bundleId: bundleReference.bundleId,
    activationId,
    activationTarget,
    scopeSelector,
    targetLabel,
    cryptoScope,
    policyPack,
    bundleReference,
    policyBundleEntry,
    policyBundleManifest,
    signableArtifact,
    bundleRecord,
    activationRecord,
    simulationOverlay,
    auditAppendInput,
    bindingChecks: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function cryptoPolicyControlPlaneScopeBindingLabel(
  binding: CryptoPolicyControlPlaneScopeBinding,
): string {
  return [
    `crypto-policy:${binding.cryptoDecisionId}`,
    `bundle:${binding.bundleId}`,
    `activation:${binding.activationId}`,
    `target:${binding.targetLabel}`,
  ].join(' / ');
}

export function cryptoPolicyControlPlaneScopeBindingDescriptor():
CryptoPolicyControlPlaneScopeBindingDescriptor {
  return Object.freeze({
    version: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
    domainId: CRYPTO_POLICY_CONTROL_PLANE_DOMAIN_ID,
    cryptoScopeDimensions: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_DIMENSIONS,
    bindingChecks: CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS,
    standards: Object.freeze([
      'CAIP-2',
      'CAIP-10',
      'CAIP-19',
      'EIP-712-policy-pack-ready',
      'ERC-7715-permission-scope-ready',
      'ERC-4337-simulation-ready',
    ]),
  });
}
