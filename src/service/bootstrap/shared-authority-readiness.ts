import {
  RELEASE_AUTHORITY_COMPONENTS,
  ensureReleaseAuthorityStore,
  isReleaseAuthorityStoreConfigured,
  listReleaseAuthorityComponents,
  releaseAuthorityStoreMode,
  type ReleaseAuthorityComponentRecord,
  type ReleaseAuthorityStoreSummary,
} from '../release-authority-store.js';
import {
  createSharedReleaseDecisionLogStore,
  type SharedReleaseDecisionLogStoreSummary,
} from '../release-decision-log-store.js';
import {
  createSharedReleaseReviewerQueueStore,
  type SharedReleaseReviewerQueueStoreSummary,
} from '../release-reviewer-queue-store.js';
import {
  createSharedReleaseTokenIntrospectionStore,
  type SharedReleaseTokenIntrospectionStoreSummary,
} from '../release-token-introspection-store.js';
import {
  createSharedReleaseEvidencePackStore,
  type SharedReleaseEvidencePackStoreSummary,
} from '../release-evidence-pack-store.js';
import {
  createSharedReleaseDegradedModeGrantStore,
  type SharedReleaseDegradedModeGrantStoreSummary,
} from '../release-degraded-mode-grant-store.js';
import {
  createSharedPolicyActivationApprovalStore,
  createSharedPolicyControlPlaneStore,
  createSharedPolicyMutationAuditLogWriter,
  type SharedPolicyActivationApprovalStoreSummary,
  type SharedPolicyControlPlaneStoreSummary,
  type SharedPolicyMutationAuditLogSummary,
} from '../release-policy-authority-store.js';
import type {
  AttestorRuntimeProfileId,
  ReleaseRuntimeStoreComponent,
} from './runtime-profile.js';

export const SHARED_AUTHORITY_RUNTIME_READINESS_SPEC_VERSION =
  'attestor.shared-authority-runtime-readiness.v1';

export type SharedAuthorityRuntimeReadinessBlockerCode =
  | 'release_authority_store_disabled'
  | 'release_authority_component_count_mismatch'
  | 'release_authority_components_not_ready'
  | 'release_authority_bootstrap_not_wired'
  | 'release_authority_request_path_not_shared'
  | 'release_authority_store_probe_failed';

export interface SharedAuthorityRuntimeReadinessBlocker {
  readonly code: SharedAuthorityRuntimeReadinessBlockerCode;
  readonly message: string;
  readonly components: readonly ReleaseRuntimeStoreComponent[];
}

export interface SharedAuthorityRuntimeReadinessComponent {
  readonly component: ReleaseRuntimeStoreComponent;
  readonly status: ReleaseAuthorityComponentRecord['status'];
  readonly schemaVersion: number;
  readonly desiredMode: 'shared';
  readonly sharedStore: string | null;
  readonly bootstrapWired: boolean;
  readonly table: string | null;
  readonly updatedAt: string;
}

export interface SharedAuthorityRuntimeStoreSummaries {
  readonly releaseDecisionLog: SharedReleaseDecisionLogStoreSummary;
  readonly releaseReviewerQueue: SharedReleaseReviewerQueueStoreSummary;
  readonly releaseTokenIntrospection: SharedReleaseTokenIntrospectionStoreSummary;
  readonly releaseEvidencePack: SharedReleaseEvidencePackStoreSummary;
  readonly releaseDegradedModeGrants: SharedReleaseDegradedModeGrantStoreSummary;
  readonly policyControlPlane: SharedPolicyControlPlaneStoreSummary;
  readonly policyActivationApprovals: SharedPolicyActivationApprovalStoreSummary;
  readonly policyMutationAuditLog: SharedPolicyMutationAuditLogSummary;
}

export interface SharedAuthorityRuntimeReadiness {
  readonly version: typeof SHARED_AUTHORITY_RUNTIME_READINESS_SPEC_VERSION;
  readonly evaluatedAt: string;
  readonly runtimeProfileId: AttestorRuntimeProfileId | null;
  readonly mode: 'postgres' | 'disabled';
  readonly configured: boolean;
  readonly ready: boolean;
  readonly checks: {
    readonly configured: boolean;
    readonly substrateReady: boolean;
    readonly allComponentsSeeded: boolean;
    readonly allComponentsReady: boolean;
    readonly allComponentsBootstrapWired: boolean;
    readonly requestPathUsesSharedStores: boolean;
    readonly storeSummariesReadable: boolean;
  };
  readonly summary: ReleaseAuthorityStoreSummary | null;
  readonly components: readonly SharedAuthorityRuntimeReadinessComponent[];
  readonly storeSummaries: SharedAuthorityRuntimeStoreSummaries | null;
  readonly blockers: readonly SharedAuthorityRuntimeReadinessBlocker[];
}

export interface EvaluateSharedAuthorityRuntimeReadinessInput {
  readonly runtimeProfileId?: AttestorRuntimeProfileId | null;
  readonly requestPathUsesSharedStores?: boolean;
}

function metadataString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function metadataBoolean(value: unknown): boolean {
  return value === true;
}

function componentView(
  record: ReleaseAuthorityComponentRecord,
): SharedAuthorityRuntimeReadinessComponent {
  return Object.freeze({
    component: record.component,
    status: record.status,
    schemaVersion: record.schemaVersion,
    desiredMode: record.desiredMode,
    sharedStore: metadataString(record.metadata.sharedStore),
    bootstrapWired: metadataBoolean(record.metadata.bootstrapWired),
    table:
      metadataString(record.metadata.table) ??
      metadataString(record.metadata.grantsTable) ??
      metadataString(record.metadata.metadataTable),
    updatedAt: record.updatedAt,
  });
}

function componentsFor(
  records: readonly ReleaseAuthorityComponentRecord[],
): readonly SharedAuthorityRuntimeReadinessComponent[] {
  return Object.freeze(records.map(componentView));
}

async function probeSharedStoreSummaries(): Promise<SharedAuthorityRuntimeStoreSummaries> {
  const [
    releaseDecisionLog,
    releaseReviewerQueue,
    releaseTokenIntrospection,
    releaseEvidencePack,
    releaseDegradedModeGrants,
    policyControlPlane,
    policyActivationApprovals,
    policyMutationAuditLog,
  ] = await Promise.all([
    createSharedReleaseDecisionLogStore().summary(),
    createSharedReleaseReviewerQueueStore().summary(),
    createSharedReleaseTokenIntrospectionStore().summary(),
    createSharedReleaseEvidencePackStore().summary(),
    createSharedReleaseDegradedModeGrantStore().summary(),
    createSharedPolicyControlPlaneStore().summary(),
    createSharedPolicyActivationApprovalStore().summary(),
    createSharedPolicyMutationAuditLogWriter().summary(),
  ]);

  return Object.freeze({
    releaseDecisionLog,
    releaseReviewerQueue,
    releaseTokenIntrospection,
    releaseEvidencePack,
    releaseDegradedModeGrants,
    policyControlPlane,
    policyActivationApprovals,
    policyMutationAuditLog,
  });
}

function buildBlockers(input: {
  runtimeProfileId: AttestorRuntimeProfileId | null;
  configured: boolean;
  allComponentsSeeded: boolean;
  pendingComponents: readonly ReleaseRuntimeStoreComponent[];
  unwiredComponents: readonly ReleaseRuntimeStoreComponent[];
  requestPathUsesSharedStores: boolean;
  probeError: Error | null;
}): readonly SharedAuthorityRuntimeReadinessBlocker[] {
  const blockers: SharedAuthorityRuntimeReadinessBlocker[] = [];

  if (!input.configured) {
    blockers.push({
      code: 'release_authority_store_disabled',
      message:
        'Release authority shared store is disabled. Configure ATTESTOR_RELEASE_AUTHORITY_PG_URL before claiming production-shared readiness.',
      components: Object.freeze([...RELEASE_AUTHORITY_COMPONENTS]),
    });
  }

  if (!input.allComponentsSeeded) {
    blockers.push({
      code: 'release_authority_component_count_mismatch',
      message:
        'Release authority shared store registry does not contain the complete authority component set.',
      components: Object.freeze([...RELEASE_AUTHORITY_COMPONENTS]),
    });
  }

  if (input.pendingComponents.length > 0) {
    blockers.push({
      code: 'release_authority_components_not_ready',
      message: 'One or more release authority shared stores are not marked ready.',
      components: Object.freeze([...input.pendingComponents]),
    });
  }

  if (input.unwiredComponents.length > 0) {
    blockers.push({
      code: 'release_authority_bootstrap_not_wired',
      message:
        'One or more ready shared stores are not yet marked as runtime bootstrap wired; production-shared must stay fail-closed until cutover metadata is explicit.',
      components: Object.freeze([...input.unwiredComponents]),
    });
  }

  if (
    input.runtimeProfileId === 'production-shared' &&
    !input.requestPathUsesSharedStores
  ) {
    blockers.push({
      code: 'release_authority_request_path_not_shared',
      message:
        'Production-shared request handling is still guarded because the release/policy runtime request path has not completed the shared-store contract cutover.',
      components: Object.freeze([...RELEASE_AUTHORITY_COMPONENTS]),
    });
  }

  if (input.probeError) {
    blockers.push({
      code: 'release_authority_store_probe_failed',
      message: `Release authority shared store probe failed: ${input.probeError.message}`,
      components: Object.freeze([...RELEASE_AUTHORITY_COMPONENTS]),
    });
  }

  return Object.freeze(blockers);
}

export async function evaluateSharedAuthorityRuntimeReadiness(
  input: EvaluateSharedAuthorityRuntimeReadinessInput = {},
): Promise<SharedAuthorityRuntimeReadiness> {
  const evaluatedAt = new Date().toISOString();
  const configured = isReleaseAuthorityStoreConfigured();
  const mode = releaseAuthorityStoreMode();
  const runtimeProfileId = input.runtimeProfileId ?? null;
  const requestPathUsesSharedStores = input.requestPathUsesSharedStores ?? false;

  if (!configured) {
    const blockers = buildBlockers({
      runtimeProfileId,
      configured,
      allComponentsSeeded: false,
      pendingComponents: RELEASE_AUTHORITY_COMPONENTS,
      unwiredComponents: [],
      requestPathUsesSharedStores,
      probeError: null,
    });
    return Object.freeze({
      version: SHARED_AUTHORITY_RUNTIME_READINESS_SPEC_VERSION,
      evaluatedAt,
      runtimeProfileId,
      mode,
      configured,
      ready: false,
      checks: Object.freeze({
        configured,
        substrateReady: false,
        allComponentsSeeded: false,
        allComponentsReady: false,
        allComponentsBootstrapWired: false,
        requestPathUsesSharedStores,
        storeSummariesReadable: false,
      }),
      summary: null,
      components: Object.freeze([]),
      storeSummaries: null,
      blockers,
    });
  }

  let summary: ReleaseAuthorityStoreSummary | null = null;
  let componentRecords: readonly ReleaseAuthorityComponentRecord[] = Object.freeze([]);
  let storeSummaries: SharedAuthorityRuntimeStoreSummaries | null = null;
  let probeError: Error | null = null;

  try {
    summary = await ensureReleaseAuthorityStore();
    storeSummaries = await probeSharedStoreSummaries();
    componentRecords = await listReleaseAuthorityComponents();
  } catch (error) {
    probeError = error instanceof Error ? error : new Error(String(error));
  }

  const components = componentsFor(componentRecords);
  const allComponentsSeeded = components.length === RELEASE_AUTHORITY_COMPONENTS.length;
  const pendingComponents = components
    .filter((component) => component.status !== 'ready')
    .map((component) => component.component);
  const unwiredComponents = components
    .filter((component) => component.status === 'ready' && !component.bootstrapWired)
    .map((component) => component.component);
  const allComponentsReady = allComponentsSeeded && pendingComponents.length === 0;
  const allComponentsBootstrapWired = allComponentsReady && unwiredComponents.length === 0;
  const storeSummariesReadable = storeSummaries !== null && probeError === null;
  const substrateReady =
    summary !== null &&
    summary.configured &&
    summary.mode === 'postgres' &&
    summary.componentCount === RELEASE_AUTHORITY_COMPONENTS.length;
  const blockers = buildBlockers({
    runtimeProfileId,
    configured,
    allComponentsSeeded,
    pendingComponents,
    unwiredComponents,
    requestPathUsesSharedStores,
    probeError,
  });
  const ready =
    configured &&
    substrateReady &&
    allComponentsSeeded &&
    allComponentsReady &&
    allComponentsBootstrapWired &&
    requestPathUsesSharedStores &&
    storeSummariesReadable &&
    blockers.length === 0;

  return Object.freeze({
    version: SHARED_AUTHORITY_RUNTIME_READINESS_SPEC_VERSION,
    evaluatedAt,
    runtimeProfileId,
    mode,
    configured,
    ready,
    checks: Object.freeze({
      configured,
      substrateReady,
      allComponentsSeeded,
      allComponentsReady,
      allComponentsBootstrapWired,
      requestPathUsesSharedStores,
      storeSummariesReadable,
    }),
    summary,
    components,
    storeSummaries,
    blockers,
  });
}
