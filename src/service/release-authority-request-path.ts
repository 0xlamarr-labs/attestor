import type {
  DeterministicCheckObservation,
  ReleaseDeterministicEvaluationResult,
  ReleaseDecisionLogAppendInput,
  ReleaseDecisionLogEntry,
  ReleaseDecisionLogVerificationResult,
  ReleaseEvaluationResult,
  ReleaseEvaluationRequest,
  ReleaseReviewerQueueDetail,
  ReleaseReviewerQueueListOptions,
  ReleaseReviewerQueueListResult,
  ReleaseReviewerQueueRecord,
  RegisteredReleaseToken,
  RegisterIssuedReleaseTokenInput,
  ReleaseTokenIntrospectionStore,
  RevokeReleaseTokenInput,
  RecordedReleaseTokenUseResult,
  RecordReleaseTokenUseInput,
  IssuedReleaseEvidencePack,
} from '../release-layer/index.js';
import type {
  PolicyActivationApprovalRequest,
  PolicyActivationApprovalState,
  PolicyActivationApprovalStore,
  PolicyActivationRecord,
  PolicyControlPlaneStore,
  PolicyMutationAuditAppendInput,
  PolicyMutationAuditEntry,
  PolicyPackMetadata,
  PolicyMutationAuditLogWriter,
  PolicyMutationAuditVerificationResult,
  StoredPolicyBundleRecord,
  UpsertStoredPolicyBundleInput,
} from '../release-policy-control-plane/index.js';
import type {
  ConsumeDegradedModeGrantInput,
  DegradedModeAuditRecord,
  DegradedModeGrant,
  ListDegradedModeGrantOptions,
  RevokeDegradedModeGrantInput,
} from '../release-enforcement-plane/degraded-mode.js';

export type Awaitable<T> = T | Promise<T>;

export type RequestPathStoreKind =
  | 'embedded-memory'
  | 'file-backed'
  | 'postgres';

export interface RequestPathReleaseDecisionEngine {
  evaluate(input: ReleaseEvaluationRequest): Awaitable<ReleaseEvaluationResult>;
  evaluateWithDeterministicChecks(
    input: ReleaseEvaluationRequest,
    observation: DeterministicCheckObservation,
  ): Awaitable<ReleaseDeterministicEvaluationResult>;
}

export interface RequestPathReleaseShadowEvaluator<T> {
  evaluate(
    request: ReleaseEvaluationRequest,
    observation: DeterministicCheckObservation,
  ): Awaitable<T>;
}

export interface RequestPathReleaseDecisionLogWriter {
  append(input: ReleaseDecisionLogAppendInput): Awaitable<ReleaseDecisionLogEntry>;
  entries(): Awaitable<readonly ReleaseDecisionLogEntry[]>;
  latestEntryDigest(): Awaitable<string | null>;
  verify(): Awaitable<ReleaseDecisionLogVerificationResult>;
}

export interface RequestPathReleaseReviewerQueueStore {
  upsert(record: ReleaseReviewerQueueRecord): Awaitable<ReleaseReviewerQueueDetail>;
  get(id: string): Awaitable<ReleaseReviewerQueueDetail | null>;
  getRecord(id: string): Awaitable<ReleaseReviewerQueueRecord | null>;
  listPending(options?: ReleaseReviewerQueueListOptions): Awaitable<ReleaseReviewerQueueListResult>;
}

export type RequestPathReleaseTokenIntrospectionStore = {
  [K in keyof ReleaseTokenIntrospectionStore]: ReleaseTokenIntrospectionStore[K] extends (
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Awaitable<Result>
    : ReleaseTokenIntrospectionStore[K];
};

export interface RequestPathReleaseEvidencePackStore {
  upsert(pack: IssuedReleaseEvidencePack): Awaitable<IssuedReleaseEvidencePack>;
  get(id: string): Awaitable<IssuedReleaseEvidencePack | null>;
}

export interface RequestPathDegradedModeGrantStore {
  registerGrant(grant: DegradedModeGrant): Awaitable<DegradedModeGrant>;
  findGrant(id: string): Awaitable<DegradedModeGrant | null>;
  listGrants(options?: ListDegradedModeGrantOptions): Awaitable<readonly DegradedModeGrant[]>;
  revokeGrant(input: RevokeDegradedModeGrantInput): Awaitable<DegradedModeGrant | null>;
  consumeGrant(input: ConsumeDegradedModeGrantInput): Awaitable<DegradedModeGrant | null>;
  listAuditRecords(): Awaitable<readonly DegradedModeAuditRecord[]>;
  auditHead(): Awaitable<string | null>;
}

export interface RequestPathPolicyControlPlaneStore {
  readonly kind: RequestPathStoreKind;
  getMetadata(): Awaitable<ReturnType<PolicyControlPlaneStore['getMetadata']>>;
  setMetadata(
    metadata: Parameters<PolicyControlPlaneStore['setMetadata']>[0],
  ): Awaitable<ReturnType<PolicyControlPlaneStore['setMetadata']>>;
  upsertPack(pack: PolicyPackMetadata): Awaitable<PolicyPackMetadata>;
  getPack(packId: string): Awaitable<PolicyPackMetadata | null>;
  listPacks(): Awaitable<readonly PolicyPackMetadata[]>;
  upsertBundle(input: UpsertStoredPolicyBundleInput): Awaitable<StoredPolicyBundleRecord>;
  getBundle(packId: string, bundleId: string): Awaitable<StoredPolicyBundleRecord | null>;
  listBundleHistory(packId: string): Awaitable<readonly StoredPolicyBundleRecord[]>;
  listBundles(): Awaitable<readonly StoredPolicyBundleRecord[]>;
  upsertActivation(record: PolicyActivationRecord): Awaitable<PolicyActivationRecord>;
  getActivation(id: string): Awaitable<PolicyActivationRecord | null>;
  listActivations(): Awaitable<readonly PolicyActivationRecord[]>;
  exportSnapshot(): Awaitable<ReturnType<PolicyControlPlaneStore['exportSnapshot']>>;
}

export interface RequestPathPolicyActivationApprovalStore {
  readonly kind: RequestPathStoreKind;
  upsert(request: PolicyActivationApprovalRequest): Awaitable<PolicyActivationApprovalRequest>;
  get(id: string): Awaitable<PolicyActivationApprovalRequest | null>;
  list(filters?: {
    readonly state?: PolicyActivationApprovalState | null;
    readonly targetLabel?: string | null;
    readonly bundleId?: string | null;
    readonly packId?: string | null;
  }): Awaitable<readonly PolicyActivationApprovalRequest[]>;
  exportSnapshot(): Awaitable<ReturnType<PolicyActivationApprovalStore['exportSnapshot']>>;
}

export interface RequestPathPolicyMutationAuditLogWriter {
  readonly kind: RequestPathStoreKind;
  append(input: PolicyMutationAuditAppendInput): Awaitable<PolicyMutationAuditEntry>;
  entries(): Awaitable<readonly PolicyMutationAuditEntry[]>;
  latestEntryDigest(): Awaitable<string | null>;
  verify(): Awaitable<PolicyMutationAuditVerificationResult>;
  exportSnapshot(): Awaitable<ReturnType<PolicyMutationAuditLogWriter['exportSnapshot']>>;
}
