import type { CapabilityBoundaryDescriptor, OutputContractDescriptor } from '../release-layer/index.js';
import {
  policy,
  policyRollout,
  type ReleasePolicyDefinition,
  type ReleasePolicyRolloutEvaluationContext,
  type ReleasePolicyRolloutResolution,
  type ReleaseTargetKind,
} from '../release-layer/index.js';
import type { PolicyBundleEntry } from './object-model.js';
import {
  defaultPolicyCompatibilityDescriptor,
  policyBundleCompatibilityKey,
  type PolicyCompatibilityDescriptor,
} from './object-model.js';
import {
  comparePolicyScopeMatches,
  matchPolicyScope,
  type PolicyScopeMatchResult,
} from './scoping.js';
import {
  resolvePolicyBundleForTarget,
  type PolicyBundleResolutionResult,
} from './discovery.js';
import type { PolicyControlPlaneStore, StoredPolicyBundleRecord } from './store.js';
import type { PolicyActivationTarget } from './types.js';

/**
 * Active policy resolver.
 *
 * Step 09 is where the control plane stops being only storage and distribution
 * metadata and starts answering the question the runtime actually cares about:
 * "what is the effective active policy for this request scope right now?"
 *
 * The resolver intentionally composes the Step 08 discovery surface instead of
 * reaching around it. That keeps bundle selection, compatibility checks, and
 * entry-level policy matching on one repeatable control-plane path.
 */

export const ACTIVE_POLICY_RESOLVER_SPEC_VERSION =
  'attestor.active-policy-resolver.v1';

export type ActivePolicyResolutionStatus =
  | 'resolved'
  | 'policy-scope-frozen'
  | 'bundle-resolution-failed'
  | 'incompatible-bundle'
  | 'no-policy-entry'
  | 'ambiguous-policy-entry';

export interface ActivePolicyResolverInput {
  readonly target: PolicyActivationTarget;
  readonly outputContract: OutputContractDescriptor;
  readonly capabilityBoundary: CapabilityBoundaryDescriptor;
  readonly targetKind: ReleaseTargetKind;
  readonly rolloutContext: ReleasePolicyRolloutEvaluationContext;
}

export interface ResolvedPolicyEntryCandidate {
  readonly entry: PolicyBundleEntry;
  readonly match: PolicyScopeMatchResult;
}

export interface ActivePolicyResolutionResult {
  readonly version: typeof ACTIVE_POLICY_RESOLVER_SPEC_VERSION;
  readonly status: ActivePolicyResolutionStatus;
  readonly target: PolicyActivationTarget;
  readonly bundleResolution: PolicyBundleResolutionResult;
  readonly bundleRecord: StoredPolicyBundleRecord | null;
  readonly compatibility: {
    readonly expected: PolicyCompatibilityDescriptor;
    readonly actual: PolicyCompatibilityDescriptor | null;
    readonly compatible: boolean;
  };
  readonly matchedEntryCandidates: readonly ResolvedPolicyEntryCandidate[];
  readonly ambiguousEntryCandidates: readonly ResolvedPolicyEntryCandidate[];
  readonly selectedEntry: PolicyBundleEntry | null;
  readonly effectivePolicy: ReleasePolicyDefinition | null;
  readonly rollout: ReleasePolicyRolloutResolution | null;
}

export interface ActivePolicyResolver {
  resolve(input: ActivePolicyResolverInput): ActivePolicyResolutionResult;
}

function samePrecedenceMatch(
  left: PolicyScopeMatchResult,
  right: PolicyScopeMatchResult,
): boolean {
  if (left.precedenceVector.length !== right.precedenceVector.length) {
    return false;
  }

  for (let index = 0; index < left.precedenceVector.length; index += 1) {
    if ((left.precedenceVector[index] ?? 0) !== (right.precedenceVector[index] ?? 0)) {
      return false;
    }
  }

  return left.specificityScore === right.specificityScore;
}

function selectMatchingEntries(
  bundleRecord: StoredPolicyBundleRecord,
  input: ActivePolicyResolverInput,
): {
  readonly matchedEntryCandidates: readonly ResolvedPolicyEntryCandidate[];
  readonly ambiguousEntryCandidates: readonly ResolvedPolicyEntryCandidate[];
  readonly selectedEntry: PolicyBundleEntry | null;
} {
  const matchedEntryCandidates = Object.freeze(
    bundleRecord.artifact.statement.predicate.entries
      .map((entry) => ({
        entry,
        match: matchPolicyScope(input.target, entry.scope),
      }))
      .filter(
        (candidate) =>
          candidate.match.matches &&
          policy.matchesReleasePolicyScope(
            candidate.entry.definition,
            input.outputContract,
            input.capabilityBoundary,
            input.targetKind,
          ),
      )
      .sort((left, right) => comparePolicyScopeMatches(left.match, right.match)),
  );

  const topCandidate = matchedEntryCandidates[0] ?? null;
  if (!topCandidate) {
    return Object.freeze({
      matchedEntryCandidates,
      ambiguousEntryCandidates: Object.freeze([]),
      selectedEntry: null,
    });
  }

  const ambiguousEntryCandidates = Object.freeze(
    matchedEntryCandidates.filter((candidate) =>
      samePrecedenceMatch(candidate.match, topCandidate.match),
    ),
  );

  return Object.freeze({
    matchedEntryCandidates,
    ambiguousEntryCandidates:
      ambiguousEntryCandidates.length > 1 ? ambiguousEntryCandidates : Object.freeze([]),
    selectedEntry:
      ambiguousEntryCandidates.length > 1 ? null : topCandidate.entry,
  });
}

function compatibilityEnvelope(
  bundleRecord: StoredPolicyBundleRecord | null,
): ActivePolicyResolutionResult['compatibility'] {
  const expected = defaultPolicyCompatibilityDescriptor();
  const actual = bundleRecord?.manifest.compatibility ?? null;

  return Object.freeze({
    expected,
    actual,
    compatible:
      actual !== null &&
      policyBundleCompatibilityKey(expected) === policyBundleCompatibilityKey(actual),
  });
}

function failResult(
  input: ActivePolicyResolverInput,
  bundleResolution: PolicyBundleResolutionResult,
  bundleRecord: StoredPolicyBundleRecord | null,
  status: ActivePolicyResolutionStatus,
  compatibility = compatibilityEnvelope(bundleRecord),
  matchedEntryCandidates: readonly ResolvedPolicyEntryCandidate[] = Object.freeze([]),
  ambiguousEntryCandidates: readonly ResolvedPolicyEntryCandidate[] = Object.freeze([]),
): ActivePolicyResolutionResult {
  return Object.freeze({
    version: ACTIVE_POLICY_RESOLVER_SPEC_VERSION,
    status,
    target: input.target,
    bundleResolution,
    bundleRecord,
    compatibility,
    matchedEntryCandidates,
    ambiguousEntryCandidates,
    selectedEntry: null,
    effectivePolicy: null,
    rollout: null,
  });
}

export function resolveActivePolicy(
  store: PolicyControlPlaneStore,
  input: ActivePolicyResolverInput,
): ActivePolicyResolutionResult {
  const bundleResolution = resolvePolicyBundleForTarget(store, {
    target: input.target,
  });
  const bundleRecord = bundleResolution.selectedCandidate?.bundleRecord ?? null;

  if (bundleResolution.status === 'frozen') {
    return failResult(
      input,
      bundleResolution,
      bundleRecord,
      'policy-scope-frozen',
    );
  }

  if (bundleResolution.status !== 'resolved' || !bundleRecord) {
    return failResult(
      input,
      bundleResolution,
      bundleRecord,
      'bundle-resolution-failed',
    );
  }

  const compatibility = compatibilityEnvelope(bundleRecord);
  if (!compatibility.compatible) {
    return failResult(
      input,
      bundleResolution,
      bundleRecord,
      'incompatible-bundle',
      compatibility,
    );
  }

  const entrySelection = selectMatchingEntries(bundleRecord, input);
  if (entrySelection.matchedEntryCandidates.length === 0) {
    return failResult(
      input,
      bundleResolution,
      bundleRecord,
      'no-policy-entry',
      compatibility,
      entrySelection.matchedEntryCandidates,
    );
  }

  if (entrySelection.ambiguousEntryCandidates.length > 0) {
    return failResult(
      input,
      bundleResolution,
      bundleRecord,
      'ambiguous-policy-entry',
      compatibility,
      entrySelection.matchedEntryCandidates,
      entrySelection.ambiguousEntryCandidates,
    );
  }

  const selectedEntry = entrySelection.selectedEntry!;
  const rollout = policyRollout.resolveReleasePolicyRollout(
    selectedEntry.rollout,
    input.rolloutContext,
  );

  return Object.freeze({
    version: ACTIVE_POLICY_RESOLVER_SPEC_VERSION,
    status: 'resolved',
    target: input.target,
    bundleResolution,
    bundleRecord,
    compatibility,
    matchedEntryCandidates: entrySelection.matchedEntryCandidates,
    ambiguousEntryCandidates: Object.freeze([]),
    selectedEntry,
    effectivePolicy: selectedEntry.definition,
    rollout,
  });
}

export function createActivePolicyResolver(
  store: PolicyControlPlaneStore,
): ActivePolicyResolver {
  return {
    resolve(input: ActivePolicyResolverInput): ActivePolicyResolutionResult {
      return resolveActivePolicy(store, input);
    },
  };
}
