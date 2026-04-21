import { createHash } from 'node:crypto';
import {
  CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES,
  type CryptoAuthorizationConsequenceKind,
  type CryptoAuthorizationRiskClass,
} from './types.js';
import type {
  CryptoAuthorizationDecision as CryptoAuthorizationDecisionObject,
  CryptoAuthorizationIntent,
} from './object-model.js';
import type { CryptoConsequenceRiskAssessment } from './consequence-risk-mapping.js';
import type { CryptoEip712AuthorizationEnvelope } from './eip712-authorization-envelope.js';
import type {
  CryptoErc1271ValidationResult,
  CryptoSignatureValidationProjection,
} from './erc1271-validation-projection.js';
import type {
  CryptoAuthorizationFreshnessEvaluation,
  CryptoReplayFreshnessRules,
} from './replay-freshness-rules.js';
import {
  createCanonicalReleaseHashBundle,
  type CanonicalReleaseHashBundle,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import {
  createReleaseDecisionSkeleton,
  releaseDecisionExpiresAt,
  releaseDecisionMaxUses,
  releaseDecisionRequiresIntrospection,
  type EvidenceArtifactReference,
  type EvidencePack,
  type ReleaseActorReference,
  type ReleaseDecision,
  type ReleaseFinding,
  type ReleaseTargetReference,
  type ReleaseTokenClaims,
  type ReviewAuthority,
} from '../release-kernel/object-model.js';
import type {
  CapabilityBoundaryDescriptor,
  ConsequenceType,
  OutputContractDescriptor,
  ReleaseDecisionStatus,
  ReviewAuthorityMode,
} from '../release-kernel/types.js';

/**
 * Binding between crypto authorization and the Attestor release layer.
 *
 * Step 08 is the point where programmable-money authorization stops being a
 * separate model. The crypto intent, decision, signature projection, freshness
 * rules, evidence artifacts, and optional release token all bind to the same
 * release decision hashes that downstream enforcement already knows how to
 * verify.
 */

export const CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION =
  'attestor.crypto-release-decision-binding.v1';

export const CRYPTO_RELEASE_ARTIFACT_PATHS = [
  'crypto-authorization-intent',
  'crypto-authorization-decision',
  'crypto-risk-assessment',
  'crypto-eip712-envelope',
  'crypto-signature-validation',
  'crypto-freshness-rules',
  'crypto-freshness-evaluation',
] as const;
export type CryptoReleaseArtifactPath = typeof CRYPTO_RELEASE_ARTIFACT_PATHS[number];

export const CRYPTO_RELEASE_BINDING_STATUSES = [
  'bound',
  'blocked',
  'review-required',
  'pending',
] as const;
export type CryptoReleaseBindingStatus =
  typeof CRYPTO_RELEASE_BINDING_STATUSES[number];

export const CRYPTO_RELEASE_BINDING_CHECKS = [
  'crypto-decision-matches-intent',
  'envelope-matches-crypto-decision',
  'risk-assessment-matches-decision',
  'release-hashes-match-crypto-payloads',
  'release-status-matches-crypto-result',
  'review-authority-is-not-weaker',
  'evidence-artifacts-are-bound',
  'release-token-posture-is-bound',
] as const;
export type CryptoReleaseBindingCheck = typeof CRYPTO_RELEASE_BINDING_CHECKS[number];

export interface CryptoReleaseHashBinding {
  readonly releaseHashBundle: CanonicalReleaseHashBundle;
  readonly outputPayloadDigest: string;
  readonly consequencePayloadDigest: string;
  readonly outputContract: OutputContractDescriptor;
  readonly capabilityBoundary: CapabilityBoundaryDescriptor;
  readonly target: ReleaseTargetReference;
}

export interface CryptoReleaseReviewerAuthorityBinding {
  readonly cryptoRequired: ReviewAuthority;
  readonly releaseBound: ReviewAuthority;
  readonly sufficient: boolean;
  readonly minimumReviewerCountDelta: number;
}

export interface CryptoReleaseTokenPosture {
  readonly required: boolean;
  readonly eligible: boolean;
  readonly tokenClaimStatus:
    | 'not-required'
    | 'required-not-present'
    | 'bound';
  readonly tokenId: string | null;
  readonly audience: string;
  readonly subject: string;
  readonly scope: string;
  readonly resource: string;
  readonly introspectionRequired: boolean;
  readonly consumeOnSuccess: boolean;
  readonly maxUses: number;
  readonly ttlCeilingSeconds: number;
}

export interface CryptoReleaseEvidenceBinding {
  readonly requiredArtifacts: readonly EvidenceArtifactReference[];
  readonly evidencePackStatus: 'not-provided' | 'bound';
  readonly evidencePackId: string | null;
}

export interface CryptoReleaseDecisionBinding {
  readonly version: typeof CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION;
  readonly bindingId: string;
  readonly status: CryptoReleaseBindingStatus;
  readonly cryptoDecisionId: string;
  readonly releaseDecisionId: string;
  readonly chainId: string;
  readonly accountAddress: string;
  readonly consequenceKind: CryptoAuthorizationConsequenceKind;
  readonly releaseConsequenceType: ConsequenceType;
  readonly riskClass: CryptoAuthorizationRiskClass;
  readonly releaseDecision: ReleaseDecision;
  readonly hashBinding: CryptoReleaseHashBinding;
  readonly reviewerAuthority: CryptoReleaseReviewerAuthorityBinding;
  readonly evidence: CryptoReleaseEvidenceBinding;
  readonly releaseTokenPosture: CryptoReleaseTokenPosture;
  readonly bindingChecks: readonly CryptoReleaseBindingCheck[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateCryptoReleaseDecisionBindingInput {
  readonly intent: CryptoAuthorizationIntent;
  readonly cryptoDecision: CryptoAuthorizationDecisionObject;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly envelope: CryptoEip712AuthorizationEnvelope;
  readonly signatureValidation: CryptoSignatureValidationProjection;
  readonly signatureValidationResult?: CryptoErc1271ValidationResult | null;
  readonly freshnessRules: CryptoReplayFreshnessRules;
  readonly freshnessEvaluation?: CryptoAuthorizationFreshnessEvaluation | null;
  readonly releaseDecision?: ReleaseDecision | null;
  readonly evidencePack?: EvidencePack | null;
  readonly releaseTokenClaims?: ReleaseTokenClaims | null;
  readonly createdAt?: string | null;
  readonly policyVersion?: string | null;
  readonly policyHash?: string | null;
  readonly requester?: ReleaseActorReference | null;
  readonly target?: ReleaseTargetReference | null;
  readonly evidencePackId?: string | null;
  readonly releaseTokenId?: string | null;
  readonly requiredReviewerRoles?: readonly string[] | null;
  readonly requiredReviewerIds?: readonly string[] | null;
}

export interface CryptoReleaseDecisionBindingDescriptor {
  readonly version: typeof CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION;
  readonly artifactPaths: typeof CRYPTO_RELEASE_ARTIFACT_PATHS;
  readonly statuses: typeof CRYPTO_RELEASE_BINDING_STATUSES;
  readonly bindingChecks: typeof CRYPTO_RELEASE_BINDING_CHECKS;
  readonly standards: readonly string[];
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

const REVIEW_AUTHORITY_RANK: Record<ReviewAuthorityMode, number> = {
  auto: 0,
  'named-reviewer': 1,
  'dual-approval': 2,
  'break-glass': 3,
};

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Crypto release decision binding ${fieldName} requires a non-empty value.`);
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

function canonicalizeJson(value: CanonicalJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalizeJson(entry)).join(',')}]`;

  const objectValue = value as { readonly [key: string]: CanonicalJsonValue };
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(objectValue[key])}`)
    .join(',')}}`;
}

function digestCanonicalJson(value: CanonicalJsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value)).digest('hex')}`;
}

function canonicalObject<T extends CanonicalJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  return Object.freeze({
    canonical: canonicalizeJson(value),
    digest: digestCanonicalJson(value),
  });
}

function assertCryptoInputsConsistent(input: CreateCryptoReleaseDecisionBindingInput): void {
  const { intent, cryptoDecision, riskAssessment, envelope, signatureValidation, freshnessRules } =
    input;
  const message = envelope.typedData.message;

  if (cryptoDecision.intentId !== intent.intentId || message.intentId !== intent.intentId) {
    throw new Error('Crypto release decision binding intent ids do not match.');
  }
  if (message.decisionId !== cryptoDecision.decisionId) {
    throw new Error('Crypto release decision binding envelope decision id does not match.');
  }
  if (riskAssessment.consequenceKind !== intent.consequenceKind) {
    throw new Error('Crypto release decision binding risk consequence does not match intent.');
  }
  if (riskAssessment.riskClass !== cryptoDecision.riskClass) {
    throw new Error('Crypto release decision binding risk class does not match crypto decision.');
  }
  if (message.riskClass !== cryptoDecision.riskClass) {
    throw new Error('Crypto release decision binding envelope risk class does not match crypto decision.');
  }
  if (message.nonce !== cryptoDecision.nonce || message.nonce !== intent.constraints.nonce) {
    throw new Error('Crypto release decision binding nonce does not match across inputs.');
  }
  if (signatureValidation.envelopeId !== envelope.envelopeId) {
    throw new Error('Crypto release decision binding signature validation must bind to the envelope.');
  }
  if (freshnessRules.envelopeId !== envelope.envelopeId) {
    throw new Error('Crypto release decision binding freshness rules must bind to the envelope.');
  }
  if (
    input.signatureValidationResult &&
    input.signatureValidationResult.projectionDigest !== signatureValidation.digest
  ) {
    throw new Error('Crypto release decision binding signature result must bind to the validation projection.');
  }
  if (
    input.freshnessEvaluation &&
    input.freshnessEvaluation.rulesDigest !== freshnessRules.digest
  ) {
    throw new Error('Crypto release decision binding freshness evaluation must bind to the freshness rules.');
  }
}

function releaseStatusFor(input: CreateCryptoReleaseDecisionBindingInput): ReleaseDecisionStatus {
  switch (input.cryptoDecision.status) {
    case 'deny':
      return 'denied';
    case 'review-required':
      return 'review-required';
    case 'expired':
      return 'expired';
    case 'revoked':
      return 'revoked';
    case 'allow':
      break;
  }

  const signatureResult = input.signatureValidationResult ?? null;
  if (signatureResult) {
    if (signatureResult.status === 'invalid') {
      return 'denied';
    }
    if (signatureResult.status === 'indeterminate') {
      return 'hold';
    }
  }

  const freshness = input.freshnessEvaluation ?? null;
  if (freshness) {
    switch (freshness.status) {
      case 'fresh':
        break;
      case 'expired':
      case 'stale':
        return 'expired';
      case 'revoked':
        return 'revoked';
      case 'replayed':
      case 'invalid':
        return 'denied';
      case 'not-yet-valid':
      case 'indeterminate':
        return 'hold';
    }
  } else {
    return 'hold';
  }

  if (!signatureResult && input.signatureValidation.subjectKind === 'smart-account') {
    return 'hold';
  }

  return 'accepted';
}

function bindingStatusFor(releaseStatus: ReleaseDecisionStatus): CryptoReleaseBindingStatus {
  switch (releaseStatus) {
    case 'accepted':
    case 'overridden':
      return 'bound';
    case 'review-required':
      return 'review-required';
    case 'hold':
      return 'pending';
    case 'denied':
    case 'expired':
    case 'revoked':
      return 'blocked';
  }
}

function defaultRequester(input: CreateCryptoReleaseDecisionBindingInput): ReleaseActorReference {
  return Object.freeze({
    id: input.intent.requester.actorId,
    type: input.intent.requester.actorKind === 'human' ? 'user' : 'service',
    displayName: input.intent.requester.authorityRef ?? input.intent.requester.actorId,
    role: input.intent.requester.actorKind,
  });
}

function defaultTarget(input: CreateCryptoReleaseDecisionBindingInput): ReleaseTargetReference {
  return Object.freeze({
    kind: 'workflow',
    id: [
      'crypto',
      input.intent.executionAdapterKind ?? 'adapter-neutral',
      input.envelope.chainBinding.caip2ChainId,
      input.envelope.signerBinding.accountAddress,
      input.intent.target.targetId,
    ].join(':'),
    displayName: input.intent.target.protocol ?? input.intent.target.targetId,
  });
}

function outputContractFor(input: CreateCryptoReleaseDecisionBindingInput): OutputContractDescriptor {
  const profile = CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES[input.intent.consequenceKind];
  return Object.freeze({
    artifactType: 'attestor.crypto-authorization',
    expectedShape: [
      'crypto',
      input.intent.consequenceKind,
      input.intent.executionAdapterKind ?? 'adapter-neutral',
      input.envelope.signerBinding.signatureValidationMode,
    ].join(':'),
    consequenceType: profile.releaseConsequenceType,
    riskClass: input.cryptoDecision.riskClass,
  });
}

function capabilityBoundaryFor(input: CreateCryptoReleaseDecisionBindingInput): CapabilityBoundaryDescriptor {
  return Object.freeze({
    allowedTools: Object.freeze([
      input.intent.executionAdapterKind ?? 'adapter-neutral',
      input.signatureValidation.validationMode,
      input.freshnessRules.replayLedger.mode,
    ]),
    allowedTargets: Object.freeze([
      input.envelope.chainBinding.caip2ChainId,
      input.envelope.signerBinding.accountAddress,
      input.intent.target.targetId,
      input.intent.target.address ?? input.intent.target.targetId,
    ]),
    allowedDataDomains: Object.freeze([
      'crypto-authorization',
      input.intent.consequenceKind,
      input.intent.account.accountKind,
      ...input.intent.policyScope.dimensions,
    ]),
  });
}

function cryptoOutputPayload(input: CreateCryptoReleaseDecisionBindingInput): CanonicalReleaseJsonValue {
  return {
    kind: 'attestor.crypto.authorization.output',
    version: CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION,
    intentId: input.intent.intentId,
    decisionId: input.cryptoDecision.decisionId,
    decisionStatus: input.cryptoDecision.status,
    chainId: input.envelope.chainBinding.caip2ChainId,
    accountAddress: input.envelope.signerBinding.accountAddress,
    signerAddress: input.envelope.signerBinding.signerAddress,
    consequenceKind: input.intent.consequenceKind,
    executionAdapterKind: input.intent.executionAdapterKind,
    target: {
      targetKind: input.intent.target.targetKind,
      targetId: input.intent.target.targetId,
      address: input.intent.target.address,
      protocol: input.intent.target.protocol,
      functionSelector: input.intent.target.functionSelector,
      calldataClass: input.intent.target.calldataClass,
    },
    asset: input.intent.asset,
    policyScope: input.intent.policyScope,
    constraints: input.intent.constraints,
    risk: {
      riskClass: input.riskAssessment.riskClass,
      findingCodes: input.riskAssessment.findings.map((finding) => finding.code),
      requiredArtifacts: input.riskAssessment.review.requiredArtifacts,
      requiredPolicyDimensions: input.riskAssessment.review.requiredPolicyDimensions,
    },
  } as unknown as CanonicalReleaseJsonValue;
}

function cryptoConsequencePayload(input: CreateCryptoReleaseDecisionBindingInput): CanonicalReleaseJsonValue {
  return {
    kind: 'attestor.crypto.authorization.consequence',
    version: CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION,
    envelopeId: input.envelope.envelopeId,
    envelopeDigest: input.envelope.digest,
    typedDataDomain: input.envelope.typedData.domain,
    typedDataMessage: {
      envelopeId: input.envelope.typedData.message.envelopeId,
      intentId: input.envelope.typedData.message.intentId,
      decisionId: input.envelope.typedData.message.decisionId,
      receiptId: input.envelope.typedData.message.receiptId,
      chainId: input.envelope.typedData.message.chainId,
      caip2ChainId: input.envelope.typedData.message.caip2ChainId,
      account: input.envelope.typedData.message.account,
      signer: input.envelope.typedData.message.signer,
      validAfter: input.envelope.typedData.message.validAfter,
      validUntil: input.envelope.typedData.message.validUntil,
      nonce: input.envelope.typedData.message.nonce,
      consequenceKind: input.envelope.typedData.message.consequenceKind,
      riskClass: input.envelope.typedData.message.riskClass,
      coverage: input.envelope.typedData.message.coverage,
    },
    signatureValidation: {
      digest: input.signatureValidation.digest,
      mode: input.signatureValidation.validationMode,
      subjectKind: input.signatureValidation.subjectKind,
      resultDigest: input.signatureValidationResult?.digest ?? null,
      resultStatus: input.signatureValidationResult?.status ?? null,
      accepted: input.signatureValidationResult?.accepted ?? null,
    },
    freshness: {
      rulesDigest: input.freshnessRules.digest,
      evaluationDigest: input.freshnessEvaluation?.digest ?? null,
      status: input.freshnessEvaluation?.status ?? null,
      accepted: input.freshnessEvaluation?.accepted ?? null,
      replayLedgerKey: input.freshnessRules.replayLedger.ledgerKey,
      revocationKey: input.freshnessRules.revocation.revocationKey,
    },
  } as unknown as CanonicalReleaseJsonValue;
}

function hashBindingFor(
  input: CreateCryptoReleaseDecisionBindingInput,
  target: ReleaseTargetReference,
  outputContract: OutputContractDescriptor,
  capabilityBoundary: CapabilityBoundaryDescriptor,
): CryptoReleaseHashBinding {
  const outputPayload = cryptoOutputPayload(input);
  const consequencePayload = cryptoConsequencePayload(input);
  const releaseHashBundle = createCanonicalReleaseHashBundle({
    outputContract,
    target,
    outputPayload,
    consequencePayload,
    recipientId: input.envelope.signerBinding.accountAddress,
    idempotencyKey: input.intent.constraints.nonce,
  });

  return Object.freeze({
    releaseHashBundle,
    outputPayloadDigest: digestCanonicalJson(outputPayload as unknown as CanonicalJsonValue),
    consequencePayloadDigest: digestCanonicalJson(consequencePayload as unknown as CanonicalJsonValue),
    outputContract,
    capabilityBoundary,
    target,
  });
}

function cryptoReviewAuthorityFor(
  input: CreateCryptoReleaseDecisionBindingInput,
): ReviewAuthority {
  return Object.freeze({
    mode: input.riskAssessment.review.authorityMode,
    minimumReviewerCount: input.riskAssessment.review.minimumReviewerCount,
    requiresNamedReviewer: input.riskAssessment.review.requiresNamedReviewer,
    requiredRoles: Object.freeze([...(input.requiredReviewerRoles ?? [])]),
    requiredReviewerIds: Object.freeze([...(input.requiredReviewerIds ?? [])]),
  });
}

function reviewAuthorityIsNotWeaker(
  required: ReviewAuthority,
  actual: ReviewAuthority,
): boolean {
  return (
    REVIEW_AUTHORITY_RANK[actual.mode] >= REVIEW_AUTHORITY_RANK[required.mode] &&
    actual.minimumReviewerCount >= required.minimumReviewerCount &&
    (!required.requiresNamedReviewer || actual.requiresNamedReviewer)
  );
}

function buildReleaseFindings(
  input: CreateCryptoReleaseDecisionBindingInput,
  releaseStatus: ReleaseDecisionStatus,
): readonly ReleaseFinding[] {
  const findings: ReleaseFinding[] = [
    {
      code: `crypto_decision_${input.cryptoDecision.status}`,
      result: input.cryptoDecision.status === 'allow' ? 'pass' : 'fail',
      message: `Crypto authorization decision ${input.cryptoDecision.decisionId} is ${input.cryptoDecision.status}.`,
      source: 'policy',
    },
    ...input.riskAssessment.findings.map((finding): ReleaseFinding => ({
      code: `crypto_risk_${finding.code}`,
      result: finding.riskClass === 'R4' ? 'warn' : 'info',
      message: finding.reason,
      source: 'deterministic-check',
    })),
    {
      code: `crypto_signature_${input.signatureValidation.validationMode}`,
      result:
        input.signatureValidationResult?.accepted === false
          ? 'fail'
          : input.signatureValidationResult?.accepted === true
            ? 'pass'
            : 'info',
      message:
        input.signatureValidationResult?.status
          ? `Crypto signature validation result is ${input.signatureValidationResult.status}.`
          : 'Crypto signature validation projection is bound; runtime validation result is pending.',
      source: 'runtime',
    },
    {
      code: `crypto_freshness_${input.freshnessEvaluation?.status ?? 'pending'}`,
      result:
        input.freshnessEvaluation?.accepted === false
          ? 'fail'
          : input.freshnessEvaluation?.accepted === true
            ? 'pass'
            : 'info',
      message:
        input.freshnessEvaluation?.status
          ? `Crypto freshness result is ${input.freshnessEvaluation.status}.`
          : 'Crypto freshness rules are bound; runtime freshness evaluation is pending.',
      source: 'runtime',
    },
  ];

  if (releaseStatus === 'hold') {
    findings.push({
      code: 'crypto_release_pending_runtime_result',
      result: 'info',
      message: 'Crypto release decision binding is held until signature and freshness results are complete.',
      source: 'runtime',
    });
  }

  return Object.freeze(findings.map((finding) => Object.freeze(finding)));
}

function buildOrValidateReleaseDecision(
  input: CreateCryptoReleaseDecisionBindingInput,
  hashBinding: CryptoReleaseHashBinding,
  releaseStatus: ReleaseDecisionStatus,
  cryptoReviewAuthority: ReviewAuthority,
): ReleaseDecision {
  const provided = input.releaseDecision ?? null;
  const policyVersion =
    normalizeOptionalIdentifier(input.policyVersion, 'policyVersion') ??
    input.intent.policyScope.policyPackRef ??
    'crypto-authorization-core';
  const policyHash =
    normalizeOptionalIdentifier(input.policyHash, 'policyHash') ??
    digestCanonicalJson(input.intent.policyScope as unknown as CanonicalJsonValue);
  const decisionId = input.cryptoDecision.releaseDecisionId ?? `crypto-release:${input.cryptoDecision.decisionId}`;
  const createdAt = normalizeOptionalIdentifier(input.createdAt, 'createdAt') ?? input.cryptoDecision.decidedAt;
  const requester = input.requester ?? defaultRequester(input);
  const findings = buildReleaseFindings(input, releaseStatus);

  const generated = createReleaseDecisionSkeleton({
    id: decisionId,
    createdAt,
    status: releaseStatus,
    policyVersion,
    policyHash,
    outputHash: hashBinding.releaseHashBundle.outputHash,
    consequenceHash: hashBinding.releaseHashBundle.consequenceHash,
    outputContract: hashBinding.outputContract,
    capabilityBoundary: hashBinding.capabilityBoundary,
    requester,
    target: hashBinding.target,
    findings,
    evidencePackId: normalizeOptionalIdentifier(input.evidencePackId, 'evidencePackId'),
    releaseTokenId: normalizeOptionalIdentifier(input.releaseTokenId, 'releaseTokenId'),
    reviewAuthority: cryptoReviewAuthority,
  });

  const decision = provided ?? generated;
  if (decision.outputHash !== generated.outputHash) {
    throw new Error('Crypto release decision binding release decision output hash does not match crypto payload.');
  }
  if (decision.consequenceHash !== generated.consequenceHash) {
    throw new Error('Crypto release decision binding release decision consequence hash does not match crypto payload.');
  }
  if (decision.status !== releaseStatus) {
    throw new Error('Crypto release decision binding release decision status does not match crypto result.');
  }
  if (decision.riskClass !== input.cryptoDecision.riskClass) {
    throw new Error('Crypto release decision binding release decision risk does not match crypto decision.');
  }
  if (decision.consequenceType !== hashBinding.outputContract.consequenceType) {
    throw new Error('Crypto release decision binding release consequence type does not match crypto profile.');
  }
  if (!reviewAuthorityIsNotWeaker(cryptoReviewAuthority, decision.reviewAuthority)) {
    throw new Error('Crypto release decision binding release reviewer authority is weaker than crypto risk requirements.');
  }

  return Object.freeze(decision);
}

function evidenceArtifactsFor(
  input: CreateCryptoReleaseDecisionBindingInput,
  releaseDecision: ReleaseDecision,
): readonly EvidenceArtifactReference[] {
  const artifacts: EvidenceArtifactReference[] = [
    {
      kind: 'other',
      path: `crypto-authorization-intent://${input.intent.intentId}`,
      digest: digestCanonicalJson(input.intent as unknown as CanonicalJsonValue),
    },
    {
      kind: 'other',
      path: `crypto-authorization-decision://${input.cryptoDecision.decisionId}`,
      digest: digestCanonicalJson(input.cryptoDecision as unknown as CanonicalJsonValue),
    },
    {
      kind: 'other',
      path: `crypto-risk-assessment://${input.riskAssessment.digest}`,
      digest: input.riskAssessment.digest,
    },
    {
      kind: 'signature',
      path: `crypto-eip712-envelope://${input.envelope.envelopeId}`,
      digest: input.envelope.digest,
    },
    {
      kind: 'signature',
      path: `crypto-signature-validation://${input.signatureValidation.digest}`,
      digest: input.signatureValidationResult?.digest ?? input.signatureValidation.digest,
    },
    {
      kind: 'provenance',
      path: `crypto-freshness-rules://${input.freshnessRules.digest}`,
      digest: input.freshnessRules.digest,
    },
  ];

  if (input.freshnessEvaluation) {
    artifacts.push({
      kind: 'provenance',
      path: `crypto-freshness-evaluation://${input.freshnessEvaluation.digest}`,
      digest: input.freshnessEvaluation.digest,
    });
  }

  artifacts.push({
    kind: 'other',
    path: `release-decision://${releaseDecision.id}`,
    digest: digestCanonicalJson(releaseDecision as unknown as CanonicalJsonValue),
  });

  return Object.freeze(artifacts.map((artifact) => Object.freeze(artifact)));
}

function validateEvidencePack(
  evidencePack: EvidencePack | null,
  releaseDecision: ReleaseDecision,
  requiredArtifacts: readonly EvidenceArtifactReference[],
): CryptoReleaseEvidenceBinding {
  if (evidencePack === null) {
    return Object.freeze({
      requiredArtifacts,
      evidencePackStatus: 'not-provided',
      evidencePackId: releaseDecision.evidencePackId,
    });
  }

  if (evidencePack.outputHash !== releaseDecision.outputHash) {
    throw new Error('Crypto release decision binding evidence pack output hash does not match release decision.');
  }
  if (evidencePack.consequenceHash !== releaseDecision.consequenceHash) {
    throw new Error('Crypto release decision binding evidence pack consequence hash does not match release decision.');
  }
  if (evidencePack.policyHash !== releaseDecision.policyHash) {
    throw new Error('Crypto release decision binding evidence pack policy hash does not match release decision.');
  }

  const evidenceDigests = new Set(evidencePack.artifacts.map((artifact) => artifact.digest));
  for (const artifact of requiredArtifacts) {
    if (artifact.digest && !evidenceDigests.has(artifact.digest)) {
      throw new Error(
        `Crypto release decision binding evidence pack is missing artifact digest ${artifact.digest}.`,
      );
    }
  }

  return Object.freeze({
    requiredArtifacts,
    evidencePackStatus: 'bound',
    evidencePackId: evidencePack.id,
  });
}

function tokenTtlCeilingSeconds(
  releaseDecision: ReleaseDecision,
  freshnessRules: CryptoReplayFreshnessRules,
): number {
  const createdAt = Math.floor(Date.parse(releaseDecision.createdAt) / 1000);
  if (!Number.isFinite(createdAt)) {
    throw new Error('Crypto release decision binding release decision createdAt must be an ISO timestamp.');
  }
  const releaseExpiry = releaseDecisionExpiresAt(releaseDecision);
  const releaseExpirySeconds = releaseExpiry
    ? Math.floor(Date.parse(releaseExpiry) / 1000)
    : Number.MAX_SAFE_INTEGER;
  const freshnessExpiry = freshnessRules.validityWindow.effectiveExpiresAtEpochSeconds;
  return Math.max(0, Math.min(releaseExpirySeconds, freshnessExpiry) - createdAt);
}

function validateReleaseTokenClaims(
  claims: ReleaseTokenClaims,
  releaseDecision: ReleaseDecision,
): void {
  if (claims.decision_id !== releaseDecision.id) {
    throw new Error('Crypto release decision binding release token decision id does not match release decision.');
  }
  if (claims.decision !== releaseDecision.status) {
    throw new Error('Crypto release decision binding release token status does not match release decision.');
  }
  if (claims.output_hash !== releaseDecision.outputHash) {
    throw new Error('Crypto release decision binding release token output hash does not match release decision.');
  }
  if (claims.consequence_hash !== releaseDecision.consequenceHash) {
    throw new Error('Crypto release decision binding release token consequence hash does not match release decision.');
  }
  if (claims.policy_hash !== releaseDecision.policyHash) {
    throw new Error('Crypto release decision binding release token policy hash does not match release decision.');
  }
  if (claims.aud !== releaseDecision.target.id) {
    throw new Error('Crypto release decision binding release token audience does not match release target.');
  }
  if (claims.introspection_required !== releaseDecisionRequiresIntrospection(releaseDecision)) {
    throw new Error('Crypto release decision binding release token introspection posture does not match release decision.');
  }
}

function releaseTokenPostureFor(
  input: CreateCryptoReleaseDecisionBindingInput,
  releaseDecision: ReleaseDecision,
): CryptoReleaseTokenPosture {
  const eligible = releaseDecision.status === 'accepted' || releaseDecision.status === 'overridden';
  const required = eligible;
  const claims = input.releaseTokenClaims ?? null;
  if (claims) {
    validateReleaseTokenClaims(claims, releaseDecision);
  }

  const tokenClaimStatus = !required
    ? 'not-required'
    : claims
      ? 'bound'
      : 'required-not-present';

  return Object.freeze({
    required,
    eligible,
    tokenClaimStatus,
    tokenId: claims?.jti ?? releaseDecision.releaseTokenId,
    audience: releaseDecision.target.id,
    subject: `releaseDecision:${releaseDecision.id}`,
    scope: `release:crypto:${input.intent.consequenceKind}`,
    resource: [
      input.envelope.chainBinding.caip2ChainId,
      input.envelope.signerBinding.accountAddress,
      input.intent.target.targetId,
    ].join('/'),
    introspectionRequired: releaseDecisionRequiresIntrospection(releaseDecision),
    consumeOnSuccess:
      input.freshnessRules.replayLedger.consumeOnAllow ||
      (releaseDecisionMaxUses(releaseDecision) ?? 1) === 1,
    maxUses: releaseDecisionMaxUses(releaseDecision) ?? 1,
    ttlCeilingSeconds: tokenTtlCeilingSeconds(releaseDecision, input.freshnessRules),
  });
}

export function createCryptoReleaseDecisionBinding(
  input: CreateCryptoReleaseDecisionBindingInput,
): CryptoReleaseDecisionBinding {
  assertCryptoInputsConsistent(input);

  const target = input.target ?? defaultTarget(input);
  const outputContract = outputContractFor(input);
  const capabilityBoundary = capabilityBoundaryFor(input);
  const hashBinding = hashBindingFor(input, target, outputContract, capabilityBoundary);
  const releaseStatus = releaseStatusFor(input);
  const cryptoReviewAuthority = cryptoReviewAuthorityFor(input);
  const releaseDecision = buildOrValidateReleaseDecision(
    input,
    hashBinding,
    releaseStatus,
    cryptoReviewAuthority,
  );
  const reviewerAuthority: CryptoReleaseReviewerAuthorityBinding = Object.freeze({
    cryptoRequired: cryptoReviewAuthority,
    releaseBound: releaseDecision.reviewAuthority,
    sufficient: reviewAuthorityIsNotWeaker(
      cryptoReviewAuthority,
      releaseDecision.reviewAuthority,
    ),
    minimumReviewerCountDelta:
      releaseDecision.reviewAuthority.minimumReviewerCount -
      cryptoReviewAuthority.minimumReviewerCount,
  });
  const evidence = validateEvidencePack(
    input.evidencePack ?? null,
    releaseDecision,
    evidenceArtifactsFor(input, releaseDecision),
  );
  const releaseTokenPosture = releaseTokenPostureFor(input, releaseDecision);
  const bindingChecks = CRYPTO_RELEASE_BINDING_CHECKS;
  const bindingId = digestCanonicalJson({
    version: CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION,
    cryptoDecisionId: input.cryptoDecision.decisionId,
    releaseDecisionId: releaseDecision.id,
    outputHash: releaseDecision.outputHash,
    consequenceHash: releaseDecision.consequenceHash,
    signatureValidationDigest: input.signatureValidation.digest,
    freshnessRulesDigest: input.freshnessRules.digest,
  });
  const canonicalPayload = {
    version: CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION,
    bindingId,
    status: bindingStatusFor(releaseDecision.status),
    cryptoDecisionId: input.cryptoDecision.decisionId,
    releaseDecisionId: releaseDecision.id,
    chainId: input.envelope.chainBinding.caip2ChainId,
    accountAddress: input.envelope.signerBinding.accountAddress,
    consequenceKind: input.intent.consequenceKind,
    releaseConsequenceType: outputContract.consequenceType,
    riskClass: input.cryptoDecision.riskClass,
    releaseDecision,
    hashBinding,
    reviewerAuthority,
    evidence,
    releaseTokenPosture,
    bindingChecks,
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function cryptoReleaseDecisionBindingLabel(
  binding: CryptoReleaseDecisionBinding,
): string {
  return [
    `crypto-release:${binding.cryptoDecisionId}`,
    `release:${binding.releaseDecisionId}`,
    `status:${binding.status}`,
    `chain:${binding.chainId}`,
    `account:${binding.accountAddress}`,
    `risk:${binding.riskClass}`,
  ].join(' / ');
}

export function cryptoReleaseDecisionBindingDescriptor():
CryptoReleaseDecisionBindingDescriptor {
  return Object.freeze({
    version: CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION,
    artifactPaths: CRYPTO_RELEASE_ARTIFACT_PATHS,
    statuses: CRYPTO_RELEASE_BINDING_STATUSES,
    bindingChecks: CRYPTO_RELEASE_BINDING_CHECKS,
    standards: Object.freeze([
      'EIP-712',
      'ERC-1271-aware',
      'ERC-4337-ready',
      'ERC-7715-ready',
      'EIP-7702-ready',
      'DSSE-evidence-ready',
    ]),
  });
}
