import { createHash } from 'node:crypto';
import type { IssuedReleaseToken, ReleaseTokenVerificationKey } from '../release-kernel/release-token.js';
import type { ReleaseActorReference } from '../release-layer/index.js';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type { ReleaseTokenIntrospector, ReleaseTokenIntrospectionStore } from '../release-kernel/release-introspection.js';
import {
  createEnforcementRequest,
  createReleasePresentation,
  type EnforcementRequest,
  type EnforcementRequestTransport,
  type ReleasePresentation,
  type ReleasePresentationProof,
} from '../release-enforcement-plane/object-model.js';
import {
  verifyOfflineReleaseAuthorization,
  type OfflineAsyncEnvelopeVerificationContext,
  type OfflineHttpMessageSignatureVerificationContext,
  type OfflineReleaseVerification,
  type OfflineReleaseVerificationInput,
  type OfflineVerifierExpectedBinding,
} from '../release-enforcement-plane/offline-verifier.js';
import {
  verifyOnlineReleaseAuthorization,
  type OnlineReleaseVerification,
  type OnlineReleaseVerificationInput,
} from '../release-enforcement-plane/online-verifier.js';
import type {
  NonceLedgerEntry,
  ReplayLedgerEntry,
  ReplaySubjectKind,
} from '../release-enforcement-plane/freshness.js';
import {
  resolveVerificationProfile,
  type VerificationProfile,
} from '../release-enforcement-plane/verification-profiles.js';
import type {
  EnforcementBoundaryKind,
  EnforcementPointKind,
  ReleasePresentationMode,
} from '../release-enforcement-plane/types.js';
import {
  isCryptoExecutionAdapterKind,
  type CryptoExecutionAdapterKind,
} from './types.js';
import type { CryptoPolicyControlPlaneScopeBinding } from './policy-control-plane-scope-binding.js';
import type { CryptoReleaseDecisionBinding } from './release-decision-binding.js';

/**
 * Crypto authorization binding into the release enforcement plane.
 *
 * Step 10 does not introduce a separate crypto verifier. Instead it projects
 * crypto release bindings into the existing enforcement-plane contract:
 * enforcement request, expected token bindings, verification profile, and
 * presentation defaults. Future Safe, ERC-4337, ERC-6900, and EIP-7702
 * adapters can then reuse the same fail-closed verifier core.
 */

export const CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION =
  'attestor.crypto-enforcement-verification.v1';

export type CryptoExecutionBoundaryTemplateKey =
  | CryptoExecutionAdapterKind
  | 'adapter-neutral';

export interface CryptoExecutionBoundaryTemplate {
  readonly adapterKind: CryptoExecutionBoundaryTemplateKey;
  readonly pointKind: EnforcementPointKind;
  readonly boundaryKind: EnforcementBoundaryKind;
  readonly defaultPresentationModes: readonly ReleasePresentationMode[];
  readonly notes: string;
}

export interface CryptoEnforcementPresentationDefaults {
  readonly audience: string;
  readonly subject: string;
  readonly scope: readonly string[];
  readonly tokenRequired: boolean;
  readonly allowedModes: readonly ReleasePresentationMode[];
  readonly preferredModes: readonly ReleasePresentationMode[];
  readonly senderConstrainedModes: readonly ReleasePresentationMode[];
  readonly defaultMode: ReleasePresentationMode;
}

export const CRYPTO_ENFORCEMENT_BINDING_CHECKS = [
  'release-binding-is-consistent',
  'policy-binding-is-consistent',
  'enforcement-request-is-release-bound',
  'verification-profile-is-risk-derived',
  'presentation-defaults-are-derived',
  'offline-expected-bindings-are-derived',
  'online-introspection-path-is-derived',
] as const;
export type CryptoEnforcementBindingCheck =
  typeof CRYPTO_ENFORCEMENT_BINDING_CHECKS[number];

export interface CryptoEnforcementVerificationBinding {
  readonly version: typeof CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION;
  readonly bindingId: string;
  readonly intentId: string | null;
  readonly cryptoDecisionId: string;
  readonly releaseDecisionId: string;
  readonly adapterKind: CryptoExecutionAdapterKind | null;
  readonly releaseBindingDigest: string;
  readonly policyScopeDigest: string | null;
  readonly policyActivationId: string | null;
  readonly policyBundleId: string | null;
  readonly boundaryTemplate: CryptoExecutionBoundaryTemplate;
  readonly enforcementRequest: EnforcementRequest;
  readonly verificationProfile: VerificationProfile;
  readonly expectedBinding: Required<OfflineVerifierExpectedBinding>;
  readonly presentationDefaults: CryptoEnforcementPresentationDefaults;
  readonly bindingChecks: readonly CryptoEnforcementBindingCheck[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateCryptoEnforcementBindingInput {
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding?: CryptoPolicyControlPlaneScopeBinding | null;
  readonly requestId: string;
  readonly receivedAt: string;
  readonly enforcementPoint: {
    readonly environment?: string | null;
    readonly enforcementPointId: string;
    readonly pointKind?: EnforcementPointKind;
    readonly boundaryKind?: EnforcementBoundaryKind;
    readonly tenantId?: string | null;
    readonly accountId?: string | null;
    readonly workloadId?: string | null;
    readonly audience?: string | null;
  };
  readonly targetId?: string | null;
  readonly requester?: ReleaseActorReference | null;
  readonly traceId?: string | null;
  readonly idempotencyKey?: string | null;
  readonly transport?: EnforcementRequestTransport | null;
}

export interface CryptoEnforcementVerificationDescriptor {
  readonly version: typeof CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION;
  readonly boundaryTemplates: readonly CryptoExecutionBoundaryTemplateKey[];
  readonly bindingChecks: typeof CRYPTO_ENFORCEMENT_BINDING_CHECKS;
  readonly standards: readonly string[];
}

export interface CreateCryptoReleasePresentationInput {
  readonly binding: CryptoEnforcementVerificationBinding;
  readonly presentedAt: string;
  readonly mode?: ReleasePresentationMode;
  readonly issuedToken?: IssuedReleaseToken | null;
  readonly releaseToken?: string | null;
  readonly releaseTokenId?: string | null;
  readonly releaseTokenDigest?: string | null;
  readonly issuer?: string | null;
  readonly subject?: string | null;
  readonly audience?: string | null;
  readonly expiresAt?: string | null;
  readonly scope?: readonly string[] | string | null;
  readonly proof?: ReleasePresentationProof | null;
}

export interface VerifyCryptoAuthorizationOfflineInput {
  readonly binding: CryptoEnforcementVerificationBinding;
  readonly presentation: ReleasePresentation;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly now: string;
  readonly replayKey?: string | null;
  readonly replaySubjectKind?: ReplaySubjectKind;
  readonly replayLedgerEntry?: ReplayLedgerEntry | null;
  readonly nonceLedgerEntry?: NonceLedgerEntry | null;
  readonly httpMessageSignature?: OfflineHttpMessageSignatureVerificationContext;
  readonly asyncEnvelope?: OfflineAsyncEnvelopeVerificationContext;
  readonly verificationResultId?: string;
}

export interface VerifyCryptoAuthorizationOnlineInput
  extends VerifyCryptoAuthorizationOfflineInput {
  readonly introspector?: ReleaseTokenIntrospector;
  readonly tokenTypeHint?: string;
  readonly resourceServerId?: string;
  readonly usageStore?: ReleaseTokenIntrospectionStore;
  readonly consumeOnSuccess?: boolean;
  readonly forceOnlineIntrospection?: boolean;
  readonly introspectionSnapshotId?: string;
}

export const CRYPTO_EXECUTION_BOUNDARY_TEMPLATES = Object.freeze({
  'adapter-neutral': Object.freeze({
    adapterKind: 'adapter-neutral',
    pointKind: 'application-middleware',
    boundaryKind: 'http-request',
    defaultPresentationModes: Object.freeze([
      'dpop-bound-token',
      'bearer-release-token',
      'http-message-signature',
    ] as const),
    notes:
      'Adapter-neutral crypto authorization defaults to an HTTP request boundary with reusable bearer or sender-constrained presentation.',
  }),
  'safe-guard': Object.freeze({
    adapterKind: 'safe-guard',
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    defaultPresentationModes: Object.freeze([
      'mtls-bound-token',
      'spiffe-bound-token',
      'dpop-bound-token',
    ] as const),
    notes:
      'Safe transaction guards usually sit before high-consequence execution, so they default to an action-dispatch boundary with sender-constrained presentation.',
  }),
  'safe-module-guard': Object.freeze({
    adapterKind: 'safe-module-guard',
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    defaultPresentationModes: Object.freeze([
      'mtls-bound-token',
      'spiffe-bound-token',
      'dpop-bound-token',
    ] as const),
    notes:
      'Safe module guards gate module-initiated execution and therefore default to sender-constrained action dispatch.',
  }),
  'erc-4337-user-operation': Object.freeze({
    adapterKind: 'erc-4337-user-operation',
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    defaultPresentationModes: Object.freeze([
      'dpop-bound-token',
      'mtls-bound-token',
      'spiffe-bound-token',
    ] as const),
    notes:
      'UserOperation execution is an action-dispatch boundary with strongly preferred sender-constrained presentation.',
  }),
  'erc-7579-module': Object.freeze({
    adapterKind: 'erc-7579-module',
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    defaultPresentationModes: Object.freeze([
      'mtls-bound-token',
      'spiffe-bound-token',
      'dpop-bound-token',
    ] as const),
    notes:
      'Modular account execution should reuse action-dispatch verification with workload or key-bound presentation.',
  }),
  'erc-6900-plugin': Object.freeze({
    adapterKind: 'erc-6900-plugin',
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    defaultPresentationModes: Object.freeze([
      'mtls-bound-token',
      'spiffe-bound-token',
      'dpop-bound-token',
    ] as const),
    notes:
      'ERC-6900 plugin execution remains a fail-closed dispatch boundary with sender-constrained presentation.',
  }),
  'eip-7702-delegation': Object.freeze({
    adapterKind: 'eip-7702-delegation',
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    defaultPresentationModes: Object.freeze([
      'dpop-bound-token',
      'mtls-bound-token',
      'spiffe-bound-token',
    ] as const),
    notes:
      'EIP-7702 delegation is an account-control action and should inherit the same high-consequence dispatch posture.',
  }),
  'wallet-call-api': Object.freeze({
    adapterKind: 'wallet-call-api',
    pointKind: 'application-middleware',
    boundaryKind: 'http-request',
    defaultPresentationModes: Object.freeze([
      'dpop-bound-token',
      'bearer-release-token',
      'http-message-signature',
    ] as const),
    notes:
      'Wallet call APIs are naturally HTTP-facing and can start with bearer or sender-constrained presentation before wallet execution.',
  }),
  'x402-payment': Object.freeze({
    adapterKind: 'x402-payment',
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    defaultPresentationModes: Object.freeze([
      'http-message-signature',
      'dpop-bound-token',
      'bearer-release-token',
    ] as const),
    notes:
      'Programmatic HTTP payment flows move value and therefore use action-dispatch enforcement while preserving signed-request presentation.',
  }),
  'custody-cosigner': Object.freeze({
    adapterKind: 'custody-cosigner',
    pointKind: 'action-dispatch-gateway',
    boundaryKind: 'action-dispatch',
    defaultPresentationModes: Object.freeze([
      'signed-json-envelope',
      'spiffe-bound-token',
      'mtls-bound-token',
    ] as const),
    notes:
      'Custody co-signer requests move value and therefore use action-dispatch enforcement while preserving signed-envelope and workload-bound presentation.',
  }),
  'intent-settlement': Object.freeze({
    adapterKind: 'intent-settlement',
    pointKind: 'async-consumer',
    boundaryKind: 'async-message',
    defaultPresentationModes: Object.freeze([
      'signed-json-envelope',
      'spiffe-bound-token',
      'mtls-bound-token',
    ] as const),
    notes:
      'Intent settlement is usually asynchronous and should inherit the signed-envelope verification path.',
  }),
} satisfies Record<CryptoExecutionBoundaryTemplateKey, CryptoExecutionBoundaryTemplate>);

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length === 0) {
    throw new Error(`Crypto enforcement verification ${fieldName} requires a non-empty value.`);
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
    throw new Error(`Crypto enforcement verification ${fieldName} must be an ISO timestamp.`);
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

function sha256TokenDigest(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function splitScope(scope: string | null | undefined): readonly string[] {
  if (!scope) {
    return Object.freeze([]);
  }

  return Object.freeze(
    Array.from(
      new Set(
        scope
          .split(/\s+/u)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    ),
  );
}

function normalizeScopeInput(
  scope: readonly string[] | string | null | undefined,
): readonly string[] {
  if (scope === undefined || scope === null) {
    return Object.freeze([]);
  }
  if (typeof scope === 'string') {
    return splitScope(scope);
  }

  return Object.freeze(
    Array.from(
      new Set(
        scope
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    ),
  );
}

function adapterKindFromReleaseBinding(
  releaseBinding: CryptoReleaseDecisionBinding,
): CryptoExecutionAdapterKind | null {
  const allowedTools = releaseBinding.hashBinding.capabilityBoundary.allowedTools;
  for (const tool of allowedTools) {
    if (isCryptoExecutionAdapterKind(tool)) {
      return tool;
    }
  }
  return null;
}

function boundaryTemplateForAdapter(
  adapterKind: CryptoExecutionAdapterKind | null,
): CryptoExecutionBoundaryTemplate {
  const key: CryptoExecutionBoundaryTemplateKey = adapterKind ?? 'adapter-neutral';
  return CRYPTO_EXECUTION_BOUNDARY_TEMPLATES[key];
}

function defaultTargetId(releaseBinding: CryptoReleaseDecisionBinding): string {
  return normalizeIdentifier(
    releaseBinding.releaseDecision.target.id,
    'releaseDecision.target.id',
  );
}

function defaultAudience(releaseBinding: CryptoReleaseDecisionBinding): string {
  return normalizeIdentifier(
    releaseBinding.releaseTokenPosture.audience,
    'releaseTokenPosture.audience',
  );
}

function defaultSubject(releaseBinding: CryptoReleaseDecisionBinding): string {
  return normalizeIdentifier(
    releaseBinding.releaseTokenPosture.subject,
    'releaseTokenPosture.subject',
  );
}

function assertTargetAndAudience(
  releaseBinding: CryptoReleaseDecisionBinding,
  targetId: string | null | undefined,
  audience: string | null | undefined,
): void {
  const expectedTarget = defaultTargetId(releaseBinding);
  const expectedAudience = defaultAudience(releaseBinding);

  if (targetId !== undefined && targetId !== null && targetId !== expectedTarget) {
    throw new Error(
      'Crypto enforcement verification targetId must match the release-bound target.',
    );
  }

  if (audience !== undefined && audience !== null && audience !== expectedAudience) {
    throw new Error(
      'Crypto enforcement verification audience must match the release-bound audience.',
    );
  }
}

function assertPolicyScopeBindingConsistency(
  releaseBinding: CryptoReleaseDecisionBinding,
  policyScopeBinding: CryptoPolicyControlPlaneScopeBinding | null,
): void {
  if (policyScopeBinding === null) {
    return;
  }

  if (policyScopeBinding.cryptoDecisionId !== releaseBinding.cryptoDecisionId) {
    throw new Error(
      'Crypto enforcement verification policy scope binding does not match the crypto decision.',
    );
  }
  if (
    policyScopeBinding.releaseDecisionId !== null &&
    policyScopeBinding.releaseDecisionId !== releaseBinding.releaseDecisionId
  ) {
    throw new Error(
      'Crypto enforcement verification policy scope binding does not match the release decision.',
    );
  }
  if (
    policyScopeBinding.activationTarget.consequenceType !==
    releaseBinding.releaseDecision.consequenceType
  ) {
    throw new Error(
      'Crypto enforcement verification policy scope consequence does not match the release decision.',
    );
  }
  if (
    policyScopeBinding.activationTarget.riskClass !==
    releaseBinding.releaseDecision.riskClass
  ) {
    throw new Error(
      'Crypto enforcement verification policy scope risk does not match the release decision.',
    );
  }
}

function derivePresentationDefaults(input: {
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly verificationProfile: VerificationProfile;
  readonly boundaryTemplate: CryptoExecutionBoundaryTemplate;
}): CryptoEnforcementPresentationDefaults {
  const preferredModes = input.boundaryTemplate.defaultPresentationModes.filter((mode) =>
    input.verificationProfile.allowedPresentationModes.includes(mode),
  );
  const defaultMode =
    preferredModes[0] ?? input.verificationProfile.allowedPresentationModes[0];

  if (!defaultMode) {
    throw new Error(
      'Crypto enforcement verification requires at least one allowed presentation mode.',
    );
  }

  return Object.freeze({
    audience: defaultAudience(input.releaseBinding),
    subject: defaultSubject(input.releaseBinding),
    scope: splitScope(input.releaseBinding.releaseTokenPosture.scope),
    tokenRequired: input.releaseBinding.releaseTokenPosture.required,
    allowedModes: input.verificationProfile.allowedPresentationModes,
    preferredModes: Object.freeze(preferredModes),
    senderConstrainedModes: input.verificationProfile.senderConstrainedPresentationModes,
    defaultMode,
  });
}

function expectedBindingFor(
  releaseBinding: CryptoReleaseDecisionBinding,
): Required<OfflineVerifierExpectedBinding> {
  return Object.freeze({
    audience: defaultAudience(releaseBinding),
    releaseTokenId: releaseBinding.releaseTokenPosture.tokenId ?? '',
    releaseDecisionId: releaseBinding.releaseDecisionId,
    consequenceType: releaseBinding.releaseDecision.consequenceType,
    riskClass: releaseBinding.releaseDecision.riskClass,
    outputHash: releaseBinding.releaseDecision.outputHash,
    consequenceHash: releaseBinding.releaseDecision.consequenceHash,
    policyHash: releaseBinding.releaseDecision.policyHash,
  });
}

function expectedBindingForPresentation(input: {
  readonly binding: CryptoEnforcementVerificationBinding;
  readonly presentation: ReleasePresentation;
}): Required<OfflineVerifierExpectedBinding> {
  return Object.freeze({
    ...input.binding.expectedBinding,
    releaseTokenId:
      input.binding.expectedBinding.releaseTokenId ||
      input.presentation.releaseTokenId ||
      '',
  });
}

function deriveEnvironment(
  input: CreateCryptoEnforcementBindingInput,
): string {
  return normalizeIdentifier(
    input.enforcementPoint.environment ??
      input.policyScopeBinding?.activationTarget.environment ??
      null,
    'enforcementPoint.environment',
  );
}

function deriveTenantId(
  input: CreateCryptoEnforcementBindingInput,
): string | null {
  return normalizeOptionalIdentifier(
    input.enforcementPoint.tenantId ??
      input.policyScopeBinding?.activationTarget.tenantId ??
      null,
    'enforcementPoint.tenantId',
  );
}

function deriveAccountId(
  input: CreateCryptoEnforcementBindingInput,
): string | null {
  return normalizeOptionalIdentifier(
    input.enforcementPoint.accountId ??
      input.policyScopeBinding?.activationTarget.accountId ??
      null,
    'enforcementPoint.accountId',
  );
}

export function cryptoExecutionBoundaryTemplate(
  adapterKind: CryptoExecutionAdapterKind | null,
): CryptoExecutionBoundaryTemplate {
  return boundaryTemplateForAdapter(adapterKind);
}

export function getCryptoExecutionBoundaryTemplate(
  adapterKind: CryptoExecutionAdapterKind | null,
): CryptoExecutionBoundaryTemplate {
  return cryptoExecutionBoundaryTemplate(adapterKind);
}

export function createCryptoEnforcementVerificationBinding(
  input: CreateCryptoEnforcementBindingInput,
): CryptoEnforcementVerificationBinding {
  const policyScopeBinding = input.policyScopeBinding ?? null;
  assertPolicyScopeBindingConsistency(input.releaseBinding, policyScopeBinding);

  const adapterKind = adapterKindFromReleaseBinding(input.releaseBinding);
  const boundaryTemplate = boundaryTemplateForAdapter(adapterKind);
  const pointKind = input.enforcementPoint.pointKind ?? boundaryTemplate.pointKind;
  const boundaryKind = input.enforcementPoint.boundaryKind ?? boundaryTemplate.boundaryKind;
  assertTargetAndAudience(
    input.releaseBinding,
    input.targetId,
    input.enforcementPoint.audience,
  );
  const targetId =
    normalizeOptionalIdentifier(input.targetId, 'targetId') ??
    defaultTargetId(input.releaseBinding);
  const audience =
    normalizeOptionalIdentifier(
      input.enforcementPoint.audience,
      'enforcementPoint.audience',
    ) ?? defaultAudience(input.releaseBinding);

  const enforcementRequest = createEnforcementRequest({
    id: normalizeIdentifier(input.requestId, 'requestId'),
    receivedAt: normalizeIsoTimestamp(input.receivedAt, 'receivedAt'),
    enforcementPoint: {
      environment: deriveEnvironment(input),
      enforcementPointId: normalizeIdentifier(
        input.enforcementPoint.enforcementPointId,
        'enforcementPoint.enforcementPointId',
      ),
      pointKind,
      boundaryKind,
      consequenceType: input.releaseBinding.releaseDecision.consequenceType,
      riskClass: input.releaseBinding.releaseDecision.riskClass,
      tenantId: deriveTenantId(input),
      accountId: deriveAccountId(input),
      workloadId: normalizeOptionalIdentifier(
        input.enforcementPoint.workloadId,
        'enforcementPoint.workloadId',
      ),
      audience,
    },
    targetId,
    outputHash: input.releaseBinding.releaseDecision.outputHash,
    consequenceHash: input.releaseBinding.releaseDecision.consequenceHash,
    releaseTokenId: input.releaseBinding.releaseTokenPosture.tokenId,
    releaseDecisionId: input.releaseBinding.releaseDecisionId,
    requester: input.requester ?? input.releaseBinding.releaseDecision.requester,
    traceId: normalizeOptionalIdentifier(input.traceId, 'traceId'),
    idempotencyKey: normalizeOptionalIdentifier(input.idempotencyKey, 'idempotencyKey'),
    transport: input.transport ?? null,
  });
  const verificationProfile = resolveVerificationProfile({
    consequenceType: enforcementRequest.enforcementPoint.consequenceType,
    riskClass: enforcementRequest.enforcementPoint.riskClass,
    boundaryKind: enforcementRequest.enforcementPoint.boundaryKind,
  });
  const expectedBinding = expectedBindingFor(input.releaseBinding);
  const presentationDefaults = derivePresentationDefaults({
    releaseBinding: input.releaseBinding,
    verificationProfile,
    boundaryTemplate,
  });
  const bindingId = digestCanonicalJson({
    version: CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION,
    cryptoDecisionId: input.releaseBinding.cryptoDecisionId,
    releaseDecisionId: input.releaseBinding.releaseDecisionId,
    requestId: enforcementRequest.id,
    enforcementPointId: enforcementRequest.enforcementPoint.enforcementPointId,
    boundaryKind: enforcementRequest.enforcementPoint.boundaryKind,
    verificationProfileId: verificationProfile.id,
  } as unknown as CanonicalReleaseJsonValue);
  const canonicalPayload = {
    version: CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION,
    bindingId,
    intentId: policyScopeBinding?.intentId ?? null,
    cryptoDecisionId: input.releaseBinding.cryptoDecisionId,
    releaseDecisionId: input.releaseBinding.releaseDecisionId,
    adapterKind,
    releaseBindingDigest: input.releaseBinding.digest,
    policyScopeDigest: policyScopeBinding?.digest ?? null,
    policyActivationId: policyScopeBinding?.activationId ?? null,
    policyBundleId: policyScopeBinding?.bundleId ?? null,
    boundaryTemplate,
    enforcementRequest,
    verificationProfile,
    expectedBinding,
    presentationDefaults,
    bindingChecks: CRYPTO_ENFORCEMENT_BINDING_CHECKS,
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function cryptoEnforcementVerificationBindingLabel(
  binding: CryptoEnforcementVerificationBinding,
): string {
  return [
    `crypto-enforcement:${binding.cryptoDecisionId}`,
    `release:${binding.releaseDecisionId}`,
    `request:${binding.enforcementRequest.id}`,
    `boundary:${binding.enforcementRequest.enforcementPoint.boundaryKind}`,
    `point:${binding.enforcementRequest.enforcementPoint.enforcementPointId}`,
  ].join(' / ');
}

export function cryptoEnforcementVerificationDescriptor():
CryptoEnforcementVerificationDescriptor {
  return Object.freeze({
    version: CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION,
    boundaryTemplates: Object.freeze(
      Object.keys(CRYPTO_EXECUTION_BOUNDARY_TEMPLATES) as CryptoExecutionBoundaryTemplateKey[],
    ),
    bindingChecks: CRYPTO_ENFORCEMENT_BINDING_CHECKS,
    standards: Object.freeze([
      'release-enforcement-plane',
      'EIP-712',
      'ERC-1271-aware',
      'ERC-7715-ready',
      'EIP-7702-ready',
      'RFC-9449-ready',
      'RFC-9421-ready',
      'SPIFFE-ready',
    ]),
  });
}

function expiresAtFromIssuedToken(issuedToken: IssuedReleaseToken): string {
  return issuedToken.expiresAt;
}

export function createCryptoReleasePresentation(
  input: CreateCryptoReleasePresentationInput,
): ReleasePresentation {
  const mode = input.mode ?? input.binding.presentationDefaults.defaultMode;
  if (!input.binding.presentationDefaults.allowedModes.includes(mode)) {
    throw new Error(
      'Crypto enforcement verification presentation mode is not allowed by the derived verification profile.',
    );
  }
  if (
    input.binding.verificationProfile.senderConstraint === 'required' &&
    !input.binding.presentationDefaults.senderConstrainedModes.includes(mode)
  ) {
    throw new Error(
      'Crypto enforcement verification sender-constrained profile requires a sender-constrained presentation mode.',
    );
  }

  const issuedToken = input.issuedToken ?? null;
  const releaseToken = input.releaseToken ?? issuedToken?.token ?? null;
  const releaseTokenId =
    input.releaseTokenId ??
    issuedToken?.tokenId ??
    (input.binding.expectedBinding.releaseTokenId || null);
  if (input.binding.presentationDefaults.tokenRequired && !releaseToken) {
    throw new Error(
      'Crypto enforcement verification presentation requires a release token for the bound release posture.',
    );
  }

  const releaseTokenDigest =
    input.releaseTokenDigest ??
    (releaseToken ? sha256TokenDigest(releaseToken) : null);
  const issuer = input.issuer ?? issuedToken?.claims.iss ?? null;
  const subject =
    input.subject ??
    issuedToken?.claims.sub ??
    input.binding.presentationDefaults.subject;
  const audience =
    input.audience ??
    issuedToken?.claims.aud ??
    input.binding.presentationDefaults.audience;
  const expiresAt =
    input.expiresAt ??
    (issuedToken ? expiresAtFromIssuedToken(issuedToken) : null);
  const scope =
    normalizeScopeInput(input.scope).length > 0
      ? normalizeScopeInput(input.scope)
      : issuedToken?.claims.scope
        ? splitScope(issuedToken.claims.scope)
        : input.binding.presentationDefaults.scope;

  return createReleasePresentation({
    mode,
    presentedAt: input.presentedAt,
    releaseToken,
    releaseTokenId,
    releaseTokenDigest,
    issuer,
    subject,
    audience,
    expiresAt,
    scope,
    proof: input.proof ?? null,
  });
}

export function createCryptoOfflineVerificationInput(
  input: VerifyCryptoAuthorizationOfflineInput,
): OfflineReleaseVerificationInput {
  return Object.freeze({
    request: input.binding.enforcementRequest,
    presentation: input.presentation,
    verificationKey: input.verificationKey,
    now: input.now,
    profile: input.binding.verificationProfile,
    expected: expectedBindingForPresentation({
      binding: input.binding,
      presentation: input.presentation,
    }),
    replayKey: input.replayKey,
    replaySubjectKind: input.replaySubjectKind,
    replayLedgerEntry: input.replayLedgerEntry,
    nonceLedgerEntry: input.nonceLedgerEntry,
    httpMessageSignature: input.httpMessageSignature,
    asyncEnvelope: input.asyncEnvelope,
    verificationResultId: input.verificationResultId,
  });
}

export async function verifyCryptoAuthorizationOffline(
  input: VerifyCryptoAuthorizationOfflineInput,
): Promise<OfflineReleaseVerification> {
  return verifyOfflineReleaseAuthorization(createCryptoOfflineVerificationInput(input));
}

export function createCryptoOnlineVerificationInput(
  input: VerifyCryptoAuthorizationOnlineInput,
): OnlineReleaseVerificationInput {
  return Object.freeze({
    ...createCryptoOfflineVerificationInput(input),
    introspector: input.introspector,
    tokenTypeHint: input.tokenTypeHint,
    resourceServerId: input.resourceServerId,
    usageStore: input.usageStore,
    consumeOnSuccess: input.consumeOnSuccess,
    forceOnlineIntrospection: input.forceOnlineIntrospection,
    introspectionSnapshotId: input.introspectionSnapshotId,
  });
}

export async function verifyCryptoAuthorizationOnline(
  input: VerifyCryptoAuthorizationOnlineInput,
): Promise<OnlineReleaseVerification> {
  return verifyOnlineReleaseAuthorization(createCryptoOnlineVerificationInput(input));
}
