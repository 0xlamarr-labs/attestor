import type { PolicyActivationRecord, PolicyControlPlaneMetadata } from './object-model.js';
import { policyActivationTargetLabel, type PolicyActivationTarget } from './types.js';
import type {
  PolicyControlPlaneStore,
  StoredPolicyBundleRecord,
} from './store.js';
import {
  comparePolicyScopeMatches,
  matchPolicyScope,
  resolvePolicyActivationPrecedence,
  type PolicyScopeMatchResult,
} from './scoping.js';

/**
 * Discovery and bundle-resolution surface for policy consumers.
 *
 * Step 08 adds the first explicit contract for how a consumer learns which
 * bundle to load for a given scope. The goal is to freeze a control-plane
 * discovery surface before we wire a full active-policy resolver, so later
 * HTTP/admin/runtime integrations all build on the same resolution grammar.
 */

export const POLICY_DISCOVERY_LABELS_SPEC_VERSION =
  'attestor.policy-discovery-labels.v1';
export const POLICY_BUNDLE_RESOURCE_SPEC_VERSION =
  'attestor.policy-bundle-resource.v1';
export const POLICY_BUNDLE_RESOLUTION_SPEC_VERSION =
  'attestor.policy-bundle-resolution.v1';
export const POLICY_DISCOVERY_DOCUMENT_SPEC_VERSION =
  'attestor.policy-discovery-document.v1';

export type PolicyBundleResolutionStatus =
  | 'resolved'
  | 'no-match'
  | 'ambiguous'
  | 'missing-bundle'
  | 'frozen';

export type PolicyBundleResolutionSource = 'static' | 'activation';

export interface PolicyDiscoveryLabels {
  readonly version: typeof POLICY_DISCOVERY_LABELS_SPEC_VERSION;
  readonly values: Readonly<Record<string, string>>;
}

export interface PolicyBundleResourceDescriptor {
  readonly version: typeof POLICY_BUNDLE_RESOURCE_SPEC_VERSION;
  readonly resource: string;
  readonly etag: string;
  readonly digest: string;
  readonly packId: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly storedAt: string;
  readonly signed: boolean;
  readonly keyId: string | null;
  readonly publicKeyFingerprint: string | null;
}

export interface PolicyBundleResolutionCandidate {
  readonly source: PolicyBundleResolutionSource;
  readonly bundleRef: {
    readonly packId: string;
    readonly bundleId: string;
    readonly bundleVersion: string;
    readonly digest: string;
  };
  readonly activation: PolicyActivationRecord | null;
  readonly activationId: string | null;
  readonly targetLabel: string | null;
  readonly match: PolicyScopeMatchResult | null;
  readonly bundleRecord: StoredPolicyBundleRecord | null;
  readonly resource: PolicyBundleResourceDescriptor | null;
}

export interface PolicyBundleResolutionResult {
  readonly version: typeof POLICY_BUNDLE_RESOLUTION_SPEC_VERSION;
  readonly status: PolicyBundleResolutionStatus;
  readonly storeKind: PolicyControlPlaneStore['kind'];
  readonly discoveryMode:
    | NonNullable<PolicyControlPlaneMetadata['discoveryMode']>
    | 'scoped-active';
  readonly target: PolicyActivationTarget;
  readonly targetLabel: string;
  readonly labels: PolicyDiscoveryLabels;
  readonly metadata: PolicyControlPlaneMetadata | null;
  readonly selectedCandidate: PolicyBundleResolutionCandidate | null;
  readonly matchedCandidates: readonly PolicyBundleResolutionCandidate[];
  readonly ambiguousCandidates: readonly PolicyBundleResolutionCandidate[];
  readonly missingBundleCandidates: readonly PolicyBundleResolutionCandidate[];
}

export interface PolicyDiscoveryDocument {
  readonly version: typeof POLICY_DISCOVERY_DOCUMENT_SPEC_VERSION;
  readonly generatedAt: string;
  readonly metadata: PolicyControlPlaneMetadata | null;
  readonly labels: PolicyDiscoveryLabels;
  readonly target: PolicyActivationTarget;
  readonly targetLabel: string;
  readonly bundleResolution: PolicyBundleResolutionResult;
}

export interface CreatePolicyDiscoveryLabelsInput {
  readonly target: PolicyActivationTarget;
  readonly metadata?: PolicyControlPlaneMetadata | null;
  readonly storeKind?: PolicyControlPlaneStore['kind'];
  readonly labels?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

export interface ResolvePolicyBundleInput {
  readonly target: PolicyActivationTarget;
  readonly metadata?: PolicyControlPlaneMetadata | null;
  readonly labels?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

export interface CreatePolicyDiscoveryDocumentInput
  extends ResolvePolicyBundleInput {
  readonly generatedAt?: string;
}

const RESERVED_DISCOVERY_LABEL_KEYS = Object.freeze([
  'attestor.environment',
  'attestor.tenant',
  'attestor.account',
  'attestor.domain',
  'attestor.wedge',
  'attestor.consequence_type',
  'attestor.risk_class',
  'attestor.plan',
  'attestor.discovery_mode',
  'attestor.store_kind',
  'attestor.target_label',
]);

function resolveGeneratedAt(value?: string): string {
  const timestamp = value ? new Date(value) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Policy discovery document requires a valid generatedAt timestamp.');
  }
  return timestamp.toISOString();
}

function normalizeDiscoveryLabelKey(key: string): string {
  const normalized = key.trim();
  if (normalized.length === 0) {
    throw new Error('Policy discovery labels require non-empty keys.');
  }
  return normalized;
}

function normalizeDiscoveryLabelValue(
  value: string | number | boolean | null | undefined,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveDiscoveryMode(
  metadata: PolicyControlPlaneMetadata | null | undefined,
): NonNullable<PolicyControlPlaneMetadata['discoveryMode']> | 'scoped-active' {
  return metadata?.discoveryMode ?? 'scoped-active';
}

function discoveryLabelEntries(
  input: CreatePolicyDiscoveryLabelsInput,
): readonly (readonly [string, string])[] {
  const metadata = input.metadata ?? null;
  const discoveryMode = resolveDiscoveryMode(metadata);
  const storeKind = input.storeKind ?? metadata?.storeKind ?? 'embedded-memory';
  const entries = new Map<string, string>([
    ['attestor.environment', input.target.environment],
    ['attestor.discovery_mode', discoveryMode],
    ['attestor.store_kind', storeKind],
    ['attestor.target_label', policyActivationTargetLabel(input.target)],
  ]);

  if (input.target.tenantId) {
    entries.set('attestor.tenant', input.target.tenantId);
  }
  if (input.target.accountId) {
    entries.set('attestor.account', input.target.accountId);
  }
  if (input.target.domainId) {
    entries.set('attestor.domain', input.target.domainId);
  }
  if (input.target.wedgeId) {
    entries.set('attestor.wedge', input.target.wedgeId);
  }
  if (input.target.consequenceType) {
    entries.set('attestor.consequence_type', input.target.consequenceType);
  }
  if (input.target.riskClass) {
    entries.set('attestor.risk_class', input.target.riskClass);
  }
  if (input.target.planId) {
    entries.set('attestor.plan', input.target.planId);
  }

  for (const [rawKey, rawValue] of Object.entries(input.labels ?? {})) {
    const key = normalizeDiscoveryLabelKey(rawKey);
    if (RESERVED_DISCOVERY_LABEL_KEYS.includes(key)) {
      throw new Error(
        `Policy discovery label '${key}' is reserved by the control plane and cannot be overridden.`,
      );
    }

    const value = normalizeDiscoveryLabelValue(rawValue);
    if (value !== null) {
      entries.set(key, value);
    }
  }

  return Object.freeze(
    [...entries.entries()].sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey),
    ),
  );
}

function freezeLabelValues(
  entries: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(entries));
}

function lookupBundleRecord(
  store: PolicyControlPlaneStore,
  bundleRef: PolicyBundleResolutionCandidate['bundleRef'],
): StoredPolicyBundleRecord | null {
  return store.getBundle(bundleRef.packId, bundleRef.bundleId);
}

function createBundleResourceDescriptor(
  record: StoredPolicyBundleRecord,
): PolicyBundleResourceDescriptor {
  return Object.freeze({
    version: POLICY_BUNDLE_RESOURCE_SPEC_VERSION,
    resource:
      `policy-bundles/${encodeURIComponent(record.packId)}/` +
      `${encodeURIComponent(record.bundleId)}`,
    etag: record.signedBundle?.signatureRecord.payloadDigest ?? record.artifact.payloadDigest,
    digest: record.manifest.bundle.digest,
    packId: record.packId,
    bundleId: record.bundleId,
    bundleVersion: record.bundleVersion,
    storedAt: record.storedAt,
    signed: record.signedBundle !== null,
    keyId: record.verificationKey?.keyId ?? null,
    publicKeyFingerprint: record.verificationKey?.publicKeyFingerprint ?? null,
  });
}

function createActivationCandidate(
  store: PolicyControlPlaneStore,
  activation: PolicyActivationRecord,
  match: PolicyScopeMatchResult,
): PolicyBundleResolutionCandidate {
  const bundleRecord = lookupBundleRecord(store, activation.bundle);

  return Object.freeze({
    source: 'activation',
    bundleRef: activation.bundle,
    activation,
    activationId: activation.id,
    targetLabel: activation.targetLabel,
    match,
    bundleRecord,
    resource: bundleRecord ? createBundleResourceDescriptor(bundleRecord) : null,
  });
}

function createStaticCandidate(
  store: PolicyControlPlaneStore,
  metadata: PolicyControlPlaneMetadata,
): PolicyBundleResolutionCandidate | null {
  const bundleRef = metadata.activeBundleRef;
  if (!bundleRef) {
    return null;
  }

  const bundleRecord = lookupBundleRecord(store, bundleRef);
  return Object.freeze({
    source: 'static',
    bundleRef,
    activation: null,
    activationId: null,
    targetLabel: null,
    match: null,
    bundleRecord,
    resource: bundleRecord ? createBundleResourceDescriptor(bundleRecord) : null,
  });
}

function classifyResolutionStatus(input: {
  readonly selectedCandidate: PolicyBundleResolutionCandidate | null;
  readonly ambiguousCandidates: readonly PolicyBundleResolutionCandidate[];
  readonly missingBundleCandidates: readonly PolicyBundleResolutionCandidate[];
  readonly matchedCandidates: readonly PolicyBundleResolutionCandidate[];
}): PolicyBundleResolutionStatus {
  if (input.selectedCandidate?.activation?.state === 'frozen') {
    return 'frozen';
  }
  if (input.ambiguousCandidates.length > 0) {
    return 'ambiguous';
  }
  if (input.selectedCandidate === null) {
    return 'no-match';
  }
  if (input.selectedCandidate.bundleRecord === null || input.missingBundleCandidates.length > 0) {
    return 'missing-bundle';
  }
  if (input.matchedCandidates.length === 0 && input.selectedCandidate.source !== 'static') {
    return 'no-match';
  }
  return 'resolved';
}

function candidateActivationsForScopedResolution(
  store: PolicyControlPlaneStore,
): readonly PolicyActivationRecord[] {
  return store
    .listActivations()
    .filter((activation) =>
      activation.state === 'active' || activation.state === 'frozen'
    );
}

function resolveFrozenPrecedence(
  target: PolicyActivationTarget,
  candidates: readonly PolicyActivationRecord[],
) {
  return resolvePolicyActivationPrecedence(
    target,
    candidates.filter((activation) => activation.state === 'frozen'),
  );
}

export function createPolicyDiscoveryLabels(
  input: CreatePolicyDiscoveryLabelsInput,
): PolicyDiscoveryLabels {
  return Object.freeze({
    version: POLICY_DISCOVERY_LABELS_SPEC_VERSION,
    values: freezeLabelValues(discoveryLabelEntries(input)),
  });
}

export function resolvePolicyBundleForTarget(
  store: PolicyControlPlaneStore,
  input: ResolvePolicyBundleInput,
): PolicyBundleResolutionResult {
  const metadata = input.metadata ?? store.getMetadata();
  const discoveryMode = resolveDiscoveryMode(metadata);
  const labels = createPolicyDiscoveryLabels({
    target: input.target,
    metadata,
    storeKind: store.kind,
    labels: input.labels,
  });
  const targetLabel = policyActivationTargetLabel(input.target);

  if (discoveryMode === 'static' && metadata) {
    const selectedCandidate = createStaticCandidate(store, metadata);
    const matchedCandidates = selectedCandidate
      ? Object.freeze([selectedCandidate])
      : Object.freeze([] as PolicyBundleResolutionCandidate[]);
    const missingBundleCandidates =
      selectedCandidate && selectedCandidate.bundleRecord === null
        ? Object.freeze([selectedCandidate])
        : Object.freeze([] as PolicyBundleResolutionCandidate[]);

    return Object.freeze({
      version: POLICY_BUNDLE_RESOLUTION_SPEC_VERSION,
      status: classifyResolutionStatus({
        selectedCandidate,
        ambiguousCandidates: Object.freeze([]),
        missingBundleCandidates,
        matchedCandidates,
      }),
      storeKind: store.kind,
      discoveryMode,
      target: input.target,
      targetLabel,
      labels,
      metadata,
      selectedCandidate,
      matchedCandidates,
      ambiguousCandidates: Object.freeze([]),
      missingBundleCandidates,
    });
  }

  const scopedActivations = candidateActivationsForScopedResolution(store);
  const frozenPrecedence = resolveFrozenPrecedence(input.target, scopedActivations);
  if (frozenPrecedence.matchedCandidates.length > 0) {
    const topFrozenCandidate =
      frozenPrecedence.winner ?? frozenPrecedence.matchedCandidates[0]!;
    const frozenCandidate = createActivationCandidate(
      store,
      topFrozenCandidate.activation,
      topFrozenCandidate.match,
    );
    const matchedCandidates = Object.freeze(
      scopedActivations
        .map((activation) => ({
          activation,
          match: matchPolicyScope(input.target, activation.selector),
        }))
        .filter((candidate) => candidate.match.matches)
        .sort((left, right) => comparePolicyScopeMatches(left.match, right.match))
        .map((candidate) =>
          createActivationCandidate(store, candidate.activation, candidate.match),
        ),
    );
    const missingBundleCandidates = Object.freeze(
      matchedCandidates.filter((candidate) => candidate.bundleRecord === null),
    );
    const ambiguousCandidates = Object.freeze(
      frozenPrecedence.ambiguousTopCandidates.map((candidate) =>
        createActivationCandidate(store, candidate.activation, candidate.match),
      ),
    );

    return Object.freeze({
      version: POLICY_BUNDLE_RESOLUTION_SPEC_VERSION,
      status: 'frozen',
      storeKind: store.kind,
      discoveryMode,
      target: input.target,
      targetLabel,
      labels,
      metadata,
      selectedCandidate: frozenCandidate,
      matchedCandidates,
      ambiguousCandidates,
      missingBundleCandidates,
    });
  }

  const activeActivations = scopedActivations.filter(
    (activation) => activation.state === 'active',
  );
  const precedence = resolvePolicyActivationPrecedence(input.target, activeActivations);
  const matchedCandidates = Object.freeze(
    precedence.matchedCandidates.map((candidate) =>
      createActivationCandidate(store, candidate.activation, candidate.match),
    ),
  );
  const ambiguousCandidates = Object.freeze(
    precedence.ambiguousTopCandidates.map((candidate) =>
      createActivationCandidate(store, candidate.activation, candidate.match),
    ),
  );
  const selectedCandidate =
    precedence.winner === null
      ? null
      : createActivationCandidate(
          store,
          precedence.winner.activation,
          precedence.winner.match,
        );
  const missingBundleCandidates = Object.freeze(
    [
      ...matchedCandidates.filter((candidate) => candidate.bundleRecord === null),
      ...(selectedCandidate && selectedCandidate.bundleRecord === null
        ? [selectedCandidate]
        : []),
    ].filter(
      (candidate, index, allCandidates) =>
        allCandidates.findIndex(
          (other) =>
            other.source === candidate.source &&
            other.bundleRef.bundleId === candidate.bundleRef.bundleId &&
            other.activationId === candidate.activationId,
        ) === index,
    ),
  );

  return Object.freeze({
    version: POLICY_BUNDLE_RESOLUTION_SPEC_VERSION,
    status: classifyResolutionStatus({
      selectedCandidate,
      ambiguousCandidates,
      missingBundleCandidates,
      matchedCandidates,
    }),
    storeKind: store.kind,
    discoveryMode,
    target: input.target,
    targetLabel,
    labels,
    metadata,
    selectedCandidate,
    matchedCandidates,
    ambiguousCandidates,
    missingBundleCandidates,
  });
}

export function createPolicyDiscoveryDocument(
  store: PolicyControlPlaneStore,
  input: CreatePolicyDiscoveryDocumentInput,
): PolicyDiscoveryDocument {
  const metadata = input.metadata ?? store.getMetadata();
  const bundleResolution = resolvePolicyBundleForTarget(store, input);

  return Object.freeze({
    version: POLICY_DISCOVERY_DOCUMENT_SPEC_VERSION,
    generatedAt: resolveGeneratedAt(input.generatedAt),
    metadata,
    labels: bundleResolution.labels,
    target: input.target,
    targetLabel: policyActivationTargetLabel(input.target),
    bundleResolution,
  });
}
