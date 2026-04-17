import {
  POLICY_ACTIVATION_STATES,
  POLICY_CONTROL_PLANE_SPEC_VERSION,
  POLICY_DISCOVERY_MODES,
  createPolicyScopeSelector,
  policyActivationTargetLabel,
  type PolicyActivationState,
  type PolicyActivationTarget,
  type PolicyBundleReference,
  type PolicyDiscoveryMode,
  type PolicyPackLifecycleState,
  type PolicyScopeSelector,
  type PolicyStoreKind,
} from './types.js';
import {
  RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION,
  policy as releasePolicy,
  policyRollout,
  type ReleaseActorReference,
  type ReleasePolicyDefinition,
  type ReleasePolicyRolloutDefinition,
  type ReleasePolicyRolloutMode,
} from '../release-layer/index.js';

export const POLICY_PACK_SPEC_VERSION = 'attestor.policy-pack.v1';
export const POLICY_BUNDLE_MANIFEST_SPEC_VERSION =
  'attestor.policy-bundle-manifest.v1';
export const POLICY_BUNDLE_SIGNATURE_SPEC_VERSION =
  'attestor.policy-bundle-signature.v1';
export const POLICY_ACTIVATION_RECORD_SPEC_VERSION =
  'attestor.policy-activation-record.v1';
export const POLICY_CONTROL_METADATA_SPEC_VERSION =
  'attestor.policy-control-plane-metadata.v1';

export type PolicyBundleSignatureEnvelopeType = 'dsse' | 'jws';
export type PolicyBundleSignatureAlgorithm = 'EdDSA' | 'ES256';
export type PolicyActivationOperationType =
  | 'activate-bundle'
  | 'rollback-activation'
  | 'freeze-scope';

export interface PolicySchemaReference {
  readonly id: string;
  readonly version: string;
  readonly uri: string;
  readonly digest: string | null;
}

export interface PolicyCompatibilityDescriptor {
  readonly controlPlaneSpecVersion: typeof POLICY_CONTROL_PLANE_SPEC_VERSION;
  readonly releaseLayerPlatformSpecVersion: typeof RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION;
  readonly releasePolicySpecVersion: typeof releasePolicy.RELEASE_POLICY_SPEC_VERSION;
  readonly releasePolicyRolloutSpecVersion: typeof policyRollout.RELEASE_POLICY_ROLLOUT_SPEC_VERSION;
}

export interface PolicyPackMetadata {
  readonly version: typeof POLICY_PACK_SPEC_VERSION;
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly lifecycleState: PolicyPackLifecycleState;
  readonly owners: readonly string[];
  readonly labels: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestBundleRef: PolicyBundleReference | null;
}

export interface PolicyBundleEntry {
  readonly id: string;
  readonly policyId: string;
  readonly scope: PolicyScopeSelector;
  readonly definition: ReleasePolicyDefinition;
  readonly rollout: ReleasePolicyRolloutDefinition;
  readonly policyHash: string;
}

export interface PolicyBundleManifest {
  readonly version: typeof POLICY_BUNDLE_MANIFEST_SPEC_VERSION;
  readonly bundle: PolicyBundleReference;
  readonly packId: string;
  readonly bundleLabels: readonly string[];
  readonly generatedAt: string;
  readonly discoveryMode: PolicyDiscoveryMode;
  readonly compatibility: PolicyCompatibilityDescriptor;
  readonly schemas: readonly PolicySchemaReference[];
  readonly entries: readonly PolicyBundleEntry[];
}

export interface PolicyBundleSignatureRecord {
  readonly version: typeof POLICY_BUNDLE_SIGNATURE_SPEC_VERSION;
  readonly bundle: PolicyBundleReference;
  readonly envelopeType: PolicyBundleSignatureEnvelopeType;
  readonly algorithm: PolicyBundleSignatureAlgorithm;
  readonly keyId: string;
  readonly signerFingerprint: string;
  readonly signedAt: string;
  readonly payloadDigest: string;
  readonly signature: string;
}

export interface PolicyActivationRecord {
  readonly version: typeof POLICY_ACTIVATION_RECORD_SPEC_VERSION;
  readonly id: string;
  readonly state: PolicyActivationState;
  readonly operationType: PolicyActivationOperationType;
  readonly target: PolicyActivationTarget;
  readonly selector: PolicyScopeSelector;
  readonly targetLabel: string;
  readonly bundle: PolicyBundleReference;
  readonly activatedBy: ReleaseActorReference;
  readonly activatedAt: string;
  readonly rolloutMode: ReleasePolicyRolloutMode;
  readonly reasonCode: string;
  readonly rationale: string;
  readonly previousActivationId: string | null;
  readonly supersededByActivationId: string | null;
  readonly rollbackOfActivationId: string | null;
  readonly freezeReason: string | null;
  readonly compatibility: PolicyCompatibilityDescriptor;
}

export interface PolicyControlPlaneMetadata {
  readonly version: typeof POLICY_CONTROL_METADATA_SPEC_VERSION;
  readonly storeKind: PolicyStoreKind;
  readonly discoveryMode: PolicyDiscoveryMode;
  readonly activeBundleRef: PolicyBundleReference | null;
  readonly latestActivationId: string | null;
  readonly compatibility: PolicyCompatibilityDescriptor;
}

export interface CreatePolicyPackMetadataInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly lifecycleState?: PolicyPackLifecycleState;
  readonly owners?: readonly string[];
  readonly labels?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly latestBundleRef?: PolicyBundleReference | null;
}

export interface CreatePolicyBundleEntryInput {
  readonly id: string;
  readonly scopeTarget: PolicyActivationTarget;
  readonly definition: ReleasePolicyDefinition;
  readonly policyHash: string;
}

export interface CreatePolicyBundleManifestInput {
  readonly bundle: PolicyBundleReference;
  readonly pack: PolicyPackMetadata;
  readonly generatedAt: string;
  readonly discoveryMode?: PolicyDiscoveryMode;
  readonly bundleLabels?: readonly string[];
  readonly schemas?: readonly PolicySchemaReference[];
  readonly entries: readonly PolicyBundleEntry[];
}

export interface CreatePolicyBundleSignatureRecordInput {
  readonly bundle: PolicyBundleReference;
  readonly envelopeType: PolicyBundleSignatureEnvelopeType;
  readonly algorithm: PolicyBundleSignatureAlgorithm;
  readonly keyId: string;
  readonly signerFingerprint: string;
  readonly signedAt: string;
  readonly payloadDigest: string;
  readonly signature: string;
}

export interface CreatePolicyActivationRecordInput {
  readonly id: string;
  readonly state?: PolicyActivationState;
  readonly operationType?: PolicyActivationOperationType;
  readonly target: PolicyActivationTarget;
  readonly bundle: PolicyBundleReference;
  readonly activatedBy: ReleaseActorReference;
  readonly activatedAt: string;
  readonly rolloutMode?: ReleasePolicyRolloutMode;
  readonly reasonCode?: string;
  readonly rationale: string;
  readonly previousActivationId?: string | null;
  readonly supersededByActivationId?: string | null;
  readonly rollbackOfActivationId?: string | null;
  readonly freezeReason?: string | null;
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Policy control-plane ${fieldName} cannot be blank.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Policy control-plane ${fieldName} must be a valid ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeUniqueStrings(values: readonly string[] | undefined): readonly string[] {
  if (!values || values.length === 0) {
    return Object.freeze([]);
  }

  return Object.freeze(
    Array.from(
      new Set(
        values
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    ).sort(),
  );
}

function assertBundleReference(bundle: PolicyBundleReference): void {
  normalizeIdentifier(bundle.packId, 'bundle.packId');
  normalizeIdentifier(bundle.bundleId, 'bundle.bundleId');
  normalizeIdentifier(bundle.bundleVersion, 'bundle.bundleVersion');
  normalizeIdentifier(bundle.digest, 'bundle.digest');
}

export function defaultPolicyCompatibilityDescriptor(): PolicyCompatibilityDescriptor {
  return Object.freeze({
    controlPlaneSpecVersion: POLICY_CONTROL_PLANE_SPEC_VERSION,
    releaseLayerPlatformSpecVersion: RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION,
    releasePolicySpecVersion: releasePolicy.RELEASE_POLICY_SPEC_VERSION,
    releasePolicyRolloutSpecVersion: policyRollout.RELEASE_POLICY_ROLLOUT_SPEC_VERSION,
  });
}

export function createPolicyPackMetadata(
  input: CreatePolicyPackMetadataInput,
): PolicyPackMetadata {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const updatedAt = normalizeIsoTimestamp(input.updatedAt ?? createdAt, 'updatedAt');

  return Object.freeze({
    version: POLICY_PACK_SPEC_VERSION,
    id: normalizeIdentifier(input.id, 'policy pack id'),
    name: normalizeIdentifier(input.name, 'policy pack name'),
    description: normalizeOptionalText(input.description),
    lifecycleState: input.lifecycleState ?? 'draft',
    owners: normalizeUniqueStrings(input.owners),
    labels: normalizeUniqueStrings(input.labels),
    createdAt,
    updatedAt,
    latestBundleRef: input.latestBundleRef ?? null,
  });
}

export function createPolicyBundleEntry(
  input: CreatePolicyBundleEntryInput,
): PolicyBundleEntry {
  return Object.freeze({
    id: normalizeIdentifier(input.id, 'policy bundle entry id'),
    policyId: input.definition.id,
    scope: createPolicyScopeSelector(input.scopeTarget),
    definition: input.definition,
    rollout: input.definition.rollout,
    policyHash: normalizeIdentifier(input.policyHash, 'policy bundle entry hash'),
  });
}

export function createPolicyBundleManifest(
  input: CreatePolicyBundleManifestInput,
): PolicyBundleManifest {
  assertBundleReference(input.bundle);
  if (input.entries.length === 0) {
    throw new Error('Policy bundle manifest requires at least one policy entry.');
  }
  if (input.pack.id !== input.bundle.packId) {
    throw new Error('Policy bundle manifest pack id must match the bundle reference pack id.');
  }

  return Object.freeze({
    version: POLICY_BUNDLE_MANIFEST_SPEC_VERSION,
    bundle: input.bundle,
    packId: input.pack.id,
    bundleLabels: normalizeUniqueStrings(input.bundleLabels),
    generatedAt: normalizeIsoTimestamp(input.generatedAt, 'generatedAt'),
    discoveryMode: input.discoveryMode ?? 'bundle-manifest',
    compatibility: defaultPolicyCompatibilityDescriptor(),
    schemas: Object.freeze(input.schemas ?? []),
    entries: Object.freeze([...input.entries]),
  });
}

export function createPolicyBundleSignatureRecord(
  input: CreatePolicyBundleSignatureRecordInput,
): PolicyBundleSignatureRecord {
  assertBundleReference(input.bundle);

  return Object.freeze({
    version: POLICY_BUNDLE_SIGNATURE_SPEC_VERSION,
    bundle: input.bundle,
    envelopeType: input.envelopeType,
    algorithm: input.algorithm,
    keyId: normalizeIdentifier(input.keyId, 'policy bundle signature keyId'),
    signerFingerprint: normalizeIdentifier(
      input.signerFingerprint,
      'policy bundle signature signerFingerprint',
    ),
    signedAt: normalizeIsoTimestamp(input.signedAt, 'signedAt'),
    payloadDigest: normalizeIdentifier(input.payloadDigest, 'policy bundle signature payloadDigest'),
    signature: normalizeIdentifier(input.signature, 'policy bundle signature'),
  });
}

export function createPolicyActivationRecord(
  input: CreatePolicyActivationRecordInput,
): PolicyActivationRecord {
  assertBundleReference(input.bundle);

  const state = input.state ?? 'candidate';
  if (!POLICY_ACTIVATION_STATES.includes(state)) {
    throw new Error(`Unsupported policy activation state '${state}'.`);
  }

  const operationType =
    input.operationType ??
    (state === 'frozen'
      ? 'freeze-scope'
      : input.rollbackOfActivationId
        ? 'rollback-activation'
        : 'activate-bundle');
  const rolloutMode =
    input.rolloutMode ??
    (operationType === 'rollback-activation' ? 'rolled-back' : 'enforce');
  const reasonCode = normalizeIdentifier(
    input.reasonCode ??
      (operationType === 'freeze-scope'
        ? 'freeze'
        : operationType === 'rollback-activation'
          ? 'rollback'
          : 'promotion'),
    'policy activation reasonCode',
  );
  const rationale = normalizeIdentifier(input.rationale, 'policy activation rationale');
  const freezeReason = normalizeOptionalText(input.freezeReason);
  const supersededByActivationId = normalizeOptionalText(input.supersededByActivationId);
  if (state === 'frozen' && !freezeReason) {
    throw new Error('Frozen policy activation records require a freeze reason.');
  }
  if (operationType === 'rollback-activation' && !input.rollbackOfActivationId) {
    throw new Error('Rollback policy activation records require a rollback target activation id.');
  }
  if (state === 'superseded' && !supersededByActivationId) {
    throw new Error('Superseded policy activation records require a superseding activation id.');
  }
  if (state === 'rolled-back' && !supersededByActivationId) {
    throw new Error('Rolled-back policy activation records require a replacement activation id.');
  }

  return Object.freeze({
    version: POLICY_ACTIVATION_RECORD_SPEC_VERSION,
    id: normalizeIdentifier(input.id, 'policy activation id'),
    state,
    operationType,
    target: input.target,
    selector: createPolicyScopeSelector(input.target),
    targetLabel: policyActivationTargetLabel(input.target),
    bundle: input.bundle,
    activatedBy: input.activatedBy,
    activatedAt: normalizeIsoTimestamp(input.activatedAt, 'activatedAt'),
    rolloutMode,
    reasonCode,
    rationale,
    previousActivationId: normalizeOptionalText(input.previousActivationId),
    supersededByActivationId,
    rollbackOfActivationId: normalizeOptionalText(input.rollbackOfActivationId),
    freezeReason,
    compatibility: defaultPolicyCompatibilityDescriptor(),
  });
}

export function createPolicyControlPlaneMetadata(
  storeKind: PolicyStoreKind,
  discoveryMode: PolicyDiscoveryMode,
  activeBundleRef: PolicyBundleReference | null,
  latestActivationId: string | null,
): PolicyControlPlaneMetadata {
  if (!POLICY_DISCOVERY_MODES.includes(discoveryMode)) {
    throw new Error(`Unsupported policy discovery mode '${discoveryMode}'.`);
  }

  if (activeBundleRef) {
    assertBundleReference(activeBundleRef);
  }

  return Object.freeze({
    version: POLICY_CONTROL_METADATA_SPEC_VERSION,
    storeKind,
    discoveryMode,
    activeBundleRef,
    latestActivationId: normalizeOptionalText(latestActivationId),
    compatibility: defaultPolicyCompatibilityDescriptor(),
  });
}

export function policyBundleCompatibilityKey(
  compatibility: PolicyCompatibilityDescriptor,
): string {
  return [
    compatibility.controlPlaneSpecVersion,
    compatibility.releaseLayerPlatformSpecVersion,
    compatibility.releasePolicySpecVersion,
    compatibility.releasePolicyRolloutSpecVersion,
  ].join(' | ');
}
