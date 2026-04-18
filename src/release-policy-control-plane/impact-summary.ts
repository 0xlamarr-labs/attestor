import type { PolicyBundleEntry } from './object-model.js';
import type { PolicyDryRunResult, DryRunPolicyActivationOverlay } from './simulation.js';
import {
  createPolicySimulationApi,
  dryRunCandidatePolicyActivation,
} from './simulation.js';
import type { ActivePolicyResolverInput } from './resolver.js';
import type { PolicyControlPlaneStore, StoredPolicyBundleRecord } from './store.js';
import { policyActivationTargetLabel, type PolicyActivationTarget } from './types.js';

/**
 * Policy diff and impact summaries.
 *
 * Step 11 adds the operator-facing layer that answers "what changed?" and
 * "who will feel it?" before a candidate bundle is activated. It intentionally
 * builds on the Step 10 dry-run API instead of inventing a second simulation
 * path, so bundle diffing and runtime effect previews stay aligned.
 */

export const POLICY_IMPACT_SUMMARY_SPEC_VERSION =
  'attestor.policy-impact-summary.v1';

export type PolicyEntryChangeType = 'added' | 'removed' | 'updated' | 'unchanged';
export type PolicySemanticChangeKind =
  | 'scope'
  | 'policy-id'
  | 'policy-status'
  | 'consequence-type'
  | 'risk-class'
  | 'target-kinds'
  | 'artifact-types'
  | 'allowed-tools'
  | 'allowed-targets'
  | 'allowed-data-domains'
  | 'required-checks'
  | 'required-evidence-kinds'
  | 'failure-disposition'
  | 'max-warnings'
  | 'review-mode'
  | 'minimum-reviewer-count'
  | 'token-enforcement'
  | 'signed-envelope'
  | 'durable-evidence-pack'
  | 'downstream-receipt'
  | 'retention-class'
  | 'rollout-mode';

export interface PolicySemanticChange {
  readonly kind: PolicySemanticChangeKind;
  readonly before: string | number | boolean | readonly string[] | null;
  readonly after: string | number | boolean | readonly string[] | null;
}

export interface PolicyEntryImpactSummary {
  readonly entryId: string;
  readonly changeType: PolicyEntryChangeType;
  readonly beforeScopeLabel: string | null;
  readonly afterScopeLabel: string | null;
  readonly beforePolicyId: string | null;
  readonly afterPolicyId: string | null;
  readonly semanticChanges: readonly PolicySemanticChange[];
}

export interface PolicyBundleImpactFlags {
  readonly changesScopeCoverage: boolean;
  readonly changesConsequenceCoverage: boolean;
  readonly changesRiskCoverage: boolean;
  readonly changesRolloutBehavior: boolean;
  readonly changesEnforcementBehavior: boolean;
}

export interface PolicyBundleImpactSummary {
  readonly version: typeof POLICY_IMPACT_SUMMARY_SPEC_VERSION;
  readonly currentBundleId: string | null;
  readonly candidateBundleId: string;
  readonly changed: boolean;
  readonly counts: {
    readonly added: number;
    readonly removed: number;
    readonly updated: number;
    readonly unchanged: number;
  };
  readonly affectedScopeLabels: readonly string[];
  readonly affectedConsequenceTypes: readonly string[];
  readonly affectedRiskClasses: readonly string[];
  readonly flags: PolicyBundleImpactFlags;
  readonly entries: readonly PolicyEntryImpactSummary[];
}

export interface PolicyDryRunImpactSummary {
  readonly version: typeof POLICY_IMPACT_SUMMARY_SPEC_VERSION;
  readonly targetLabel: string;
  readonly currentStatus: PolicyDryRunResult['current']['status'];
  readonly simulatedStatus: PolicyDryRunResult['simulated']['status'];
  readonly changed: boolean;
  readonly currentBundleId: string | null;
  readonly simulatedBundleId: string | null;
  readonly currentPolicyId: string | null;
  readonly simulatedPolicyId: string | null;
  readonly currentRolloutMode: string | null;
  readonly simulatedRolloutMode: string | null;
}

export interface PolicyCandidateImpactPreview {
  readonly version: typeof POLICY_IMPACT_SUMMARY_SPEC_VERSION;
  readonly dryRun: PolicyDryRunResult;
  readonly bundleImpact: PolicyBundleImpactSummary;
  readonly dryRunImpact: PolicyDryRunImpactSummary;
}

export interface PolicyImpactApi {
  summarizeBundleImpact(
    currentBundleRecord: StoredPolicyBundleRecord | null,
    candidateBundleRecord: StoredPolicyBundleRecord,
  ): PolicyBundleImpactSummary;
  summarizeDryRunImpact(result: PolicyDryRunResult): PolicyDryRunImpactSummary;
  previewCandidateActivation(
    input: ActivePolicyResolverInput,
    overlay: DryRunPolicyActivationOverlay,
  ): PolicyCandidateImpactPreview;
}

function sortStrings(values: readonly string[]): readonly string[] {
  return Object.freeze(Array.from(new Set(values)).sort((left, right) => left.localeCompare(right)));
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function entryScopeLabel(target: PolicyActivationTarget): string {
  return policyActivationTargetLabel(target);
}

function bundleEntriesById(
  bundleRecord: StoredPolicyBundleRecord | null,
): ReadonlyMap<string, PolicyBundleEntry> {
  return new Map(
    (bundleRecord?.artifact.statement.predicate.entries ?? []).map((entry) => [
      entry.id,
      entry,
    ]),
  );
}

function pushChange(
  changes: PolicySemanticChange[],
  kind: PolicySemanticChangeKind,
  before: PolicySemanticChange['before'],
  after: PolicySemanticChange['after'],
): void {
  const beforeArray = Array.isArray(before) ? sortStrings(before) : before;
  const afterArray = Array.isArray(after) ? sortStrings(after) : after;
  const unchanged = Array.isArray(beforeArray) && Array.isArray(afterArray)
    ? sameStringArray(beforeArray, afterArray)
    : beforeArray === afterArray;
  if (unchanged) {
    return;
  }

  changes.push(
    Object.freeze({
      kind,
      before: beforeArray,
      after: afterArray,
    }),
  );
}

function summarizeEntryChanges(
  previous: PolicyBundleEntry | null,
  next: PolicyBundleEntry | null,
): PolicyEntryImpactSummary {
  const semanticChanges: PolicySemanticChange[] = [];

  if (previous && next) {
    pushChange(semanticChanges, 'scope', entryScopeLabel(previous.scope), entryScopeLabel(next.scope));
    pushChange(semanticChanges, 'policy-id', previous.definition.id, next.definition.id);
    pushChange(semanticChanges, 'policy-status', previous.definition.status, next.definition.status);
    pushChange(
      semanticChanges,
      'consequence-type',
      previous.definition.scope.consequenceType,
      next.definition.scope.consequenceType,
    );
    pushChange(
      semanticChanges,
      'risk-class',
      previous.definition.scope.riskClass,
      next.definition.scope.riskClass,
    );
    pushChange(
      semanticChanges,
      'target-kinds',
      previous.definition.scope.targetKinds,
      next.definition.scope.targetKinds,
    );
    pushChange(
      semanticChanges,
      'artifact-types',
      previous.definition.outputContract.allowedArtifactTypes,
      next.definition.outputContract.allowedArtifactTypes,
    );
    pushChange(
      semanticChanges,
      'allowed-tools',
      previous.definition.capabilityBoundary.allowedTools,
      next.definition.capabilityBoundary.allowedTools,
    );
    pushChange(
      semanticChanges,
      'allowed-targets',
      previous.definition.capabilityBoundary.allowedTargets,
      next.definition.capabilityBoundary.allowedTargets,
    );
    pushChange(
      semanticChanges,
      'allowed-data-domains',
      previous.definition.capabilityBoundary.allowedDataDomains,
      next.definition.capabilityBoundary.allowedDataDomains,
    );
    pushChange(
      semanticChanges,
      'required-checks',
      previous.definition.acceptance.requiredChecks,
      next.definition.acceptance.requiredChecks,
    );
    pushChange(
      semanticChanges,
      'required-evidence-kinds',
      previous.definition.acceptance.requiredEvidenceKinds,
      next.definition.acceptance.requiredEvidenceKinds,
    );
    pushChange(
      semanticChanges,
      'failure-disposition',
      previous.definition.acceptance.failureDisposition,
      next.definition.acceptance.failureDisposition,
    );
    pushChange(
      semanticChanges,
      'max-warnings',
      previous.definition.acceptance.maxWarnings,
      next.definition.acceptance.maxWarnings,
    );
    pushChange(
      semanticChanges,
      'review-mode',
      previous.definition.release.reviewMode,
      next.definition.release.reviewMode,
    );
    pushChange(
      semanticChanges,
      'minimum-reviewer-count',
      previous.definition.release.minimumReviewerCount,
      next.definition.release.minimumReviewerCount,
    );
    pushChange(
      semanticChanges,
      'token-enforcement',
      previous.definition.release.tokenEnforcement,
      next.definition.release.tokenEnforcement,
    );
    pushChange(
      semanticChanges,
      'signed-envelope',
      previous.definition.release.requireSignedEnvelope,
      next.definition.release.requireSignedEnvelope,
    );
    pushChange(
      semanticChanges,
      'durable-evidence-pack',
      previous.definition.release.requireDurableEvidencePack,
      next.definition.release.requireDurableEvidencePack,
    );
    pushChange(
      semanticChanges,
      'downstream-receipt',
      previous.definition.release.requireDownstreamReceipt,
      next.definition.release.requireDownstreamReceipt,
    );
    pushChange(
      semanticChanges,
      'retention-class',
      previous.definition.release.retentionClass,
      next.definition.release.retentionClass,
    );
    pushChange(
      semanticChanges,
      'rollout-mode',
      previous.rollout.mode,
      next.rollout.mode,
    );
  }

  const changeType: PolicyEntryChangeType =
    previous === null
      ? 'added'
      : next === null
        ? 'removed'
        : semanticChanges.length > 0
          ? 'updated'
          : 'unchanged';

  return Object.freeze({
    entryId: next?.id ?? previous!.id,
    changeType,
    beforeScopeLabel: previous ? entryScopeLabel(previous.scope) : null,
    afterScopeLabel: next ? entryScopeLabel(next.scope) : null,
    beforePolicyId: previous?.definition.id ?? null,
    afterPolicyId: next?.definition.id ?? null,
    semanticChanges: Object.freeze(semanticChanges),
  });
}

function bundleImpactFlags(entries: readonly PolicyEntryImpactSummary[]): PolicyBundleImpactFlags {
  const semanticKinds = new Set(
    entries.flatMap((entry) => entry.semanticChanges.map((change) => change.kind)),
  );
  const nonUnchanged = entries.filter((entry) => entry.changeType !== 'unchanged');

  return Object.freeze({
    changesScopeCoverage:
      nonUnchanged.some(
        (entry) =>
          entry.changeType === 'added' ||
          entry.changeType === 'removed' ||
          entry.semanticChanges.some((change) => change.kind === 'scope'),
      ),
    changesConsequenceCoverage:
      nonUnchanged.some(
        (entry) =>
          entry.changeType === 'added' ||
          entry.changeType === 'removed' ||
          entry.semanticChanges.some((change) => change.kind === 'consequence-type'),
      ),
    changesRiskCoverage:
      nonUnchanged.some(
        (entry) =>
          entry.changeType === 'added' ||
          entry.changeType === 'removed' ||
          entry.semanticChanges.some((change) => change.kind === 'risk-class'),
      ),
    changesRolloutBehavior: semanticKinds.has('rollout-mode'),
    changesEnforcementBehavior: [
      'failure-disposition',
      'review-mode',
      'minimum-reviewer-count',
      'token-enforcement',
      'signed-envelope',
      'durable-evidence-pack',
      'downstream-receipt',
      'retention-class',
      'required-checks',
      'required-evidence-kinds',
      'max-warnings',
      'allowed-tools',
      'allowed-targets',
      'allowed-data-domains',
    ].some((kind) => semanticKinds.has(kind as PolicySemanticChangeKind)),
  });
}

function collectAffectedConsequenceTypes(
  currentBundleRecord: StoredPolicyBundleRecord | null,
  candidateBundleRecord: StoredPolicyBundleRecord,
  entries: readonly PolicyEntryImpactSummary[],
): readonly string[] {
  const current = bundleEntriesById(currentBundleRecord);
  const next = bundleEntriesById(candidateBundleRecord);
  const values: string[] = [];

  for (const entry of entries) {
    if (entry.changeType === 'unchanged') {
      continue;
    }
    const before = current.get(entry.entryId)?.definition.scope.consequenceType;
    const after = next.get(entry.entryId)?.definition.scope.consequenceType;
    if (before) values.push(before);
    if (after) values.push(after);
  }

  return sortStrings(values);
}

function collectAffectedRiskClasses(
  currentBundleRecord: StoredPolicyBundleRecord | null,
  candidateBundleRecord: StoredPolicyBundleRecord,
  entries: readonly PolicyEntryImpactSummary[],
): readonly string[] {
  const current = bundleEntriesById(currentBundleRecord);
  const next = bundleEntriesById(candidateBundleRecord);
  const values: string[] = [];

  for (const entry of entries) {
    if (entry.changeType === 'unchanged') {
      continue;
    }
    const before = current.get(entry.entryId)?.definition.scope.riskClass;
    const after = next.get(entry.entryId)?.definition.scope.riskClass;
    if (before) values.push(before);
    if (after) values.push(after);
  }

  return sortStrings(values);
}

export function summarizePolicyBundleImpact(
  currentBundleRecord: StoredPolicyBundleRecord | null,
  candidateBundleRecord: StoredPolicyBundleRecord,
): PolicyBundleImpactSummary {
  const currentEntries = bundleEntriesById(currentBundleRecord);
  const candidateEntries = bundleEntriesById(candidateBundleRecord);
  const entryIds = sortStrings([...currentEntries.keys(), ...candidateEntries.keys()]);
  const entries = Object.freeze(
    entryIds
      .map((entryId) =>
        summarizeEntryChanges(
          currentEntries.get(entryId) ?? null,
          candidateEntries.get(entryId) ?? null,
        ),
      )
      .sort((left, right) => left.entryId.localeCompare(right.entryId)),
  );

  const counts = Object.freeze({
    added: entries.filter((entry) => entry.changeType === 'added').length,
    removed: entries.filter((entry) => entry.changeType === 'removed').length,
    updated: entries.filter((entry) => entry.changeType === 'updated').length,
    unchanged: entries.filter((entry) => entry.changeType === 'unchanged').length,
  });

  const affectedScopeLabels = sortStrings(
    entries.flatMap((entry) =>
      entry.changeType === 'unchanged'
        ? []
        : [entry.beforeScopeLabel, entry.afterScopeLabel].filter(
            (value): value is string => Boolean(value),
          ),
    ),
  );

  return Object.freeze({
    version: POLICY_IMPACT_SUMMARY_SPEC_VERSION,
    currentBundleId: currentBundleRecord?.bundleId ?? null,
    candidateBundleId: candidateBundleRecord.bundleId,
    changed: counts.added > 0 || counts.removed > 0 || counts.updated > 0,
    counts,
    affectedScopeLabels,
    affectedConsequenceTypes: collectAffectedConsequenceTypes(
      currentBundleRecord,
      candidateBundleRecord,
      entries,
    ),
    affectedRiskClasses: collectAffectedRiskClasses(
      currentBundleRecord,
      candidateBundleRecord,
      entries,
    ),
    flags: bundleImpactFlags(entries),
    entries,
  });
}

export function summarizePolicyDryRunImpact(
  result: PolicyDryRunResult,
): PolicyDryRunImpactSummary {
  return Object.freeze({
    version: POLICY_IMPACT_SUMMARY_SPEC_VERSION,
    targetLabel: policyActivationTargetLabel(result.current.target),
    currentStatus: result.current.status,
    simulatedStatus: result.simulated.status,
    changed: result.delta.changed,
    currentBundleId: result.current.bundleRecord?.bundleId ?? null,
    simulatedBundleId: result.simulated.bundleRecord?.bundleId ?? null,
    currentPolicyId: result.current.effectivePolicy?.id ?? null,
    simulatedPolicyId: result.simulated.effectivePolicy?.id ?? null,
    currentRolloutMode: result.current.rollout?.rolloutMode ?? null,
    simulatedRolloutMode: result.simulated.rollout?.rolloutMode ?? null,
  });
}

export function previewCandidatePolicyImpact(
  store: PolicyControlPlaneStore,
  input: ActivePolicyResolverInput,
  overlay: DryRunPolicyActivationOverlay,
): PolicyCandidateImpactPreview {
  const dryRun = dryRunCandidatePolicyActivation(store, input, overlay);
  return Object.freeze({
    version: POLICY_IMPACT_SUMMARY_SPEC_VERSION,
    dryRun,
    bundleImpact: summarizePolicyBundleImpact(
      dryRun.current.bundleRecord,
      overlay.bundleRecord,
    ),
    dryRunImpact: summarizePolicyDryRunImpact(dryRun),
  });
}

export function createPolicyImpactApi(
  store: PolicyControlPlaneStore,
): PolicyImpactApi {
  const simulationApi = createPolicySimulationApi(store);

  return {
    summarizeBundleImpact(
      currentBundleRecord: StoredPolicyBundleRecord | null,
      candidateBundleRecord: StoredPolicyBundleRecord,
    ): PolicyBundleImpactSummary {
      return summarizePolicyBundleImpact(currentBundleRecord, candidateBundleRecord);
    },

    summarizeDryRunImpact(result: PolicyDryRunResult): PolicyDryRunImpactSummary {
      return summarizePolicyDryRunImpact(result);
    },

    previewCandidateActivation(
      input: ActivePolicyResolverInput,
      overlay: DryRunPolicyActivationOverlay,
    ): PolicyCandidateImpactPreview {
      const dryRun = simulationApi.dryRunCandidateActivation(input, overlay);
      return Object.freeze({
        version: POLICY_IMPACT_SUMMARY_SPEC_VERSION,
        dryRun,
        bundleImpact: summarizePolicyBundleImpact(
          dryRun.current.bundleRecord,
          overlay.bundleRecord,
        ),
        dryRunImpact: summarizePolicyDryRunImpact(dryRun),
      });
    },
  };
}
