import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { withFileLock, writeTextFileAtomic } from '../platform/file-store.js';
import type { ReleaseActorReference } from '../release-layer/index.js';
import type { StoredPolicyBundleRecord } from './store.js';
import {
  policyActivationTargetLabel,
  type PolicyActivationTarget,
  type PolicyBundleReference,
  type PolicyControlRiskClass,
} from './types.js';

/**
 * Reviewer approval gate for policy activation.
 *
 * This is intentionally separate from output review. It protects the control
 * plane itself: high-impact policy changes must be approved before activation
 * can mutate the active release policy state.
 */

export const POLICY_ACTIVATION_APPROVAL_SPEC_VERSION =
  'attestor.policy-activation-approval.v1';
export const POLICY_ACTIVATION_APPROVAL_STORE_SPEC_VERSION =
  'attestor.policy-activation-approval-store.v1';

export type PolicyActivationApprovalState = 'pending' | 'approved' | 'rejected';
export type PolicyActivationApprovalDecisionKind = 'approve' | 'reject';
export type PolicyActivationApprovalRequirementMode =
  | 'none'
  | 'named-reviewer'
  | 'dual-approval';
export type PolicyActivationApprovalGateStatus =
  | 'not-required'
  | 'approval-required'
  | 'approval-not-found'
  | 'approval-target-mismatch'
  | 'approval-bundle-mismatch'
  | 'approval-requirement-mismatch'
  | 'approval-pending'
  | 'approval-rejected'
  | 'approval-expired'
  | 'approved';

export interface PolicyActivationApprovalRequirement {
  readonly mode: PolicyActivationApprovalRequirementMode;
  readonly requiredApprovals: number;
  readonly requiresNamedReviewer: boolean;
  readonly requiresDistinctReviewers: boolean;
  readonly requiresRequesterSeparation: boolean;
  readonly requiredReviewerRoles: readonly string[];
  readonly riskClass: PolicyControlRiskClass | null;
  readonly reasonCode: string;
}

export interface PolicyActivationApprovalDecision {
  readonly id: string;
  readonly requestId: string;
  readonly decision: PolicyActivationApprovalDecisionKind;
  readonly reviewer: ReleaseActorReference;
  readonly decidedAt: string;
  readonly rationale: string;
  readonly decisionDigest: string;
}

export interface PolicyActivationApprovalRequest {
  readonly version: typeof POLICY_ACTIVATION_APPROVAL_SPEC_VERSION;
  readonly id: string;
  readonly state: PolicyActivationApprovalState;
  readonly target: PolicyActivationTarget;
  readonly targetLabel: string;
  readonly bundle: PolicyBundleReference;
  readonly requestedBy: ReleaseActorReference;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly reasonCode: string;
  readonly rationale: string;
  readonly requirement: PolicyActivationApprovalRequirement;
  readonly decisions: readonly PolicyActivationApprovalDecision[];
  readonly approvedReviewerIds: readonly string[];
  readonly rejectedReviewerIds: readonly string[];
  readonly latestDecisionAt: string | null;
  readonly approvalDigest: string;
}

export interface RequestPolicyActivationApprovalInput {
  readonly id?: string;
  readonly target: PolicyActivationTarget;
  readonly bundleRecord: StoredPolicyBundleRecord;
  readonly requestedBy: ReleaseActorReference;
  readonly requestedAt?: string;
  readonly expiresAt?: string;
  readonly reasonCode?: string;
  readonly rationale: string;
}

export interface RecordPolicyActivationApprovalDecisionInput {
  readonly requestId: string;
  readonly decision: PolicyActivationApprovalDecisionKind;
  readonly reviewer: ReleaseActorReference;
  readonly decidedAt?: string;
  readonly rationale: string;
}

export interface PolicyActivationApprovalGateInput {
  readonly target: PolicyActivationTarget;
  readonly bundleRecord: StoredPolicyBundleRecord;
  readonly approvalRequestId?: string | null;
  readonly now?: string;
}

export interface PolicyActivationApprovalGateResult {
  readonly allowed: boolean;
  readonly status: PolicyActivationApprovalGateStatus;
  readonly requirement: PolicyActivationApprovalRequirement;
  readonly request: PolicyActivationApprovalRequest | null;
  readonly message: string;
}

export interface PolicyActivationApprovalStoreSnapshot {
  readonly version: typeof POLICY_ACTIVATION_APPROVAL_STORE_SPEC_VERSION;
  readonly requests: readonly PolicyActivationApprovalRequest[];
}

export interface PolicyActivationApprovalStore {
  readonly kind: 'embedded-memory' | 'file-backed';
  upsert(request: PolicyActivationApprovalRequest): PolicyActivationApprovalRequest;
  get(id: string): PolicyActivationApprovalRequest | null;
  list(filters?: {
    readonly state?: PolicyActivationApprovalState | null;
    readonly targetLabel?: string | null;
    readonly bundleId?: string | null;
    readonly packId?: string | null;
  }): readonly PolicyActivationApprovalRequest[];
  exportSnapshot(): PolicyActivationApprovalStoreSnapshot;
}

interface PolicyActivationApprovalStoreFile {
  readonly version: 1;
  requests: PolicyActivationApprovalRequest[];
}

function defaultStoreFile(): PolicyActivationApprovalStoreFile {
  return {
    version: 1,
    requests: [],
  };
}

function defaultStorePath(): string {
  return resolve(
    process.env.ATTESTOR_POLICY_ACTIVATION_APPROVAL_STORE_PATH ??
      '.attestor/release-policy-activation-approvals.json',
  );
}

function ensureStoreDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function normalizeText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Policy activation approval ${fieldName} cannot be blank.`);
  }
  return normalized;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Policy activation approval ${fieldName} must be a valid ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function resolveTimestamp(value: string | undefined, fieldName: string): string {
  return normalizeIsoTimestamp(value ?? new Date().toISOString(), fieldName);
}

function defaultExpiresAt(requestedAt: string): string {
  return new Date(Date.parse(requestedAt) + 24 * 60 * 60 * 1000).toISOString();
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Policy activation approval digests cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error('Policy activation approval digests require JSON-like values.');
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  throw new Error('Policy activation approval digests require JSON-like values.');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cloneAndFreeze<T>(value: T): T {
  const clone = structuredClone(value);

  function deepFreeze(input: unknown): unknown {
    if (input === null || typeof input !== 'object') return input;
    if (Object.isFrozen(input)) return input;
    if (Array.isArray(input)) {
      for (const item of input) deepFreeze(item);
      return Object.freeze(input);
    }
    for (const nested of Object.values(input)) deepFreeze(nested);
    return Object.freeze(input);
  }

  return deepFreeze(clone) as T;
}

function riskRank(riskClass: PolicyControlRiskClass | null): number {
  switch (riskClass) {
    case 'R4':
      return 4;
    case 'R3':
      return 3;
    case 'R2':
      return 2;
    case 'R1':
      return 1;
    case 'R0':
      return 0;
    default:
      return -1;
  }
}

function highestRiskClass(
  target: PolicyActivationTarget,
  bundleRecord: StoredPolicyBundleRecord,
): PolicyControlRiskClass | null {
  const risks = [
    target.riskClass,
    ...bundleRecord.artifact.statement.predicate.entries.map(
      (entry) => entry.definition.scope.riskClass,
    ),
  ];
  return risks.sort((left, right) => riskRank(right) - riskRank(left))[0] ?? null;
}

function compareRequests(
  left: PolicyActivationApprovalRequest,
  right: PolicyActivationApprovalRequest,
): number {
  return (
    Date.parse(right.requestedAt) - Date.parse(left.requestedAt) ||
    right.id.localeCompare(left.id)
  );
}

function computeDecisionDigest(
  decision: Omit<PolicyActivationApprovalDecision, 'decisionDigest'>,
): string {
  return sha256Hex(stableStringify(decision));
}

function computeApprovalDigest(
  request: Omit<PolicyActivationApprovalRequest, 'approvalDigest'>,
): string {
  return sha256Hex(stableStringify(request));
}

function requestWithDigest(
  request: Omit<PolicyActivationApprovalRequest, 'approvalDigest'>,
): PolicyActivationApprovalRequest {
  return Object.freeze({
    ...request,
    approvalDigest: computeApprovalDigest(request),
  });
}

function createDecision(
  input: RecordPolicyActivationApprovalDecisionInput,
): PolicyActivationApprovalDecision {
  const decidedAt = resolveTimestamp(input.decidedAt, 'decidedAt');
  const base: Omit<PolicyActivationApprovalDecision, 'decisionDigest'> = {
    id: `approval_decision_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    requestId: normalizeText(input.requestId, 'requestId'),
    decision: input.decision,
    reviewer: cloneAndFreeze(input.reviewer),
    decidedAt,
    rationale: normalizeText(input.rationale, 'decision rationale'),
  };
  return Object.freeze({
    ...base,
    decisionDigest: computeDecisionDigest(base),
  });
}

export function derivePolicyActivationApprovalRequirement(input: {
  readonly target: PolicyActivationTarget;
  readonly bundleRecord: StoredPolicyBundleRecord;
}): PolicyActivationApprovalRequirement {
  const riskClass = highestRiskClass(input.target, input.bundleRecord);
  if (riskRank(riskClass) >= 4) {
    return Object.freeze({
      mode: 'dual-approval',
      requiredApprovals: 2,
      requiresNamedReviewer: true,
      requiresDistinctReviewers: true,
      requiresRequesterSeparation: true,
      requiredReviewerRoles: Object.freeze(['compliance-officer', 'policy-admin', 'risk-owner']),
      riskClass,
      reasonCode: 'regulated-or-r4-policy-activation',
    });
  }
  if (riskRank(riskClass) >= 3) {
    return Object.freeze({
      mode: 'named-reviewer',
      requiredApprovals: 1,
      requiresNamedReviewer: true,
      requiresDistinctReviewers: true,
      requiresRequesterSeparation: true,
      requiredReviewerRoles: Object.freeze(['policy-admin', 'risk-owner']),
      riskClass,
      reasonCode: 'high-consequence-policy-activation',
    });
  }

  return Object.freeze({
    mode: 'none',
    requiredApprovals: 0,
    requiresNamedReviewer: false,
    requiresDistinctReviewers: false,
    requiresRequesterSeparation: false,
    requiredReviewerRoles: Object.freeze([]),
    riskClass,
    reasonCode: 'approval-not-required',
  });
}

export function createPolicyActivationApprovalRequest(
  input: RequestPolicyActivationApprovalInput,
): PolicyActivationApprovalRequest {
  const requestedAt = resolveTimestamp(input.requestedAt, 'requestedAt');
  const requirement = derivePolicyActivationApprovalRequirement({
    target: input.target,
    bundleRecord: input.bundleRecord,
  });
  const base: Omit<PolicyActivationApprovalRequest, 'approvalDigest'> = {
    version: POLICY_ACTIVATION_APPROVAL_SPEC_VERSION,
    id: input.id ?? `activation_approval_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    state: requirement.requiredApprovals === 0 ? 'approved' as const : 'pending' as const,
    target: cloneAndFreeze(input.target),
    targetLabel: policyActivationTargetLabel(input.target),
    bundle: input.bundleRecord.manifest.bundle,
    requestedBy: cloneAndFreeze(input.requestedBy),
    requestedAt,
    expiresAt: normalizeIsoTimestamp(input.expiresAt ?? defaultExpiresAt(requestedAt), 'expiresAt'),
    reasonCode: input.reasonCode ?? requirement.reasonCode,
    rationale: normalizeText(input.rationale, 'request rationale'),
    requirement,
    decisions: Object.freeze([]),
    approvedReviewerIds: Object.freeze([]),
    rejectedReviewerIds: Object.freeze([]),
    latestDecisionAt: null,
  };

  return requestWithDigest(base);
}

function normalizeStoreSnapshot(file: PolicyActivationApprovalStoreFile): PolicyActivationApprovalStoreSnapshot {
  return cloneAndFreeze({
    version: POLICY_ACTIVATION_APPROVAL_STORE_SPEC_VERSION,
    requests: [...file.requests].sort(compareRequests),
  });
}

function loadStoreFile(path: string): PolicyActivationApprovalStoreFile {
  if (!existsSync(path)) return defaultStoreFile();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PolicyActivationApprovalStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.requests)) return parsed;
  } catch {
    // fall through to safe default
  }
  return defaultStoreFile();
}

function saveStoreFile(path: string, file: PolicyActivationApprovalStoreFile): void {
  writeTextFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}

function createStoreFromAccessors(
  kind: PolicyActivationApprovalStore['kind'],
  accessors: {
    readonly read: () => PolicyActivationApprovalStoreFile;
    readonly mutate: <T>(action: (file: PolicyActivationApprovalStoreFile) => T) => T;
  },
): PolicyActivationApprovalStore {
  return {
    kind,

    upsert(request: PolicyActivationApprovalRequest): PolicyActivationApprovalRequest {
      return accessors.mutate((file) => {
        const normalized = cloneAndFreeze(request);
        const index = file.requests.findIndex((entry) => entry.id === normalized.id);
        if (index >= 0) {
          file.requests[index] = normalized;
        } else {
          file.requests.push(normalized);
        }
        file.requests.sort(compareRequests);
        return normalized;
      });
    },

    get(id: string): PolicyActivationApprovalRequest | null {
      const request = accessors.read().requests.find((entry) => entry.id === id) ?? null;
      return cloneAndFreeze(request);
    },

    list(filters = {}): readonly PolicyActivationApprovalRequest[] {
      return cloneAndFreeze(
        accessors.read().requests
          .filter((request) => !filters.state || request.state === filters.state)
          .filter((request) => !filters.targetLabel || request.targetLabel === filters.targetLabel)
          .filter((request) => !filters.bundleId || request.bundle.bundleId === filters.bundleId)
          .filter((request) => !filters.packId || request.bundle.packId === filters.packId)
          .sort(compareRequests),
      );
    },

    exportSnapshot(): PolicyActivationApprovalStoreSnapshot {
      return normalizeStoreSnapshot(accessors.read());
    },
  };
}

export function createInMemoryPolicyActivationApprovalStore(): PolicyActivationApprovalStore {
  let file = defaultStoreFile();
  return createStoreFromAccessors('embedded-memory', {
    read: () => file,
    mutate: (action) => {
      const workingCopy = structuredClone(file) as PolicyActivationApprovalStoreFile;
      const result = action(workingCopy);
      file = workingCopy;
      return result;
    },
  });
}

export function createFileBackedPolicyActivationApprovalStore(
  path = defaultStorePath(),
): PolicyActivationApprovalStore {
  return createStoreFromAccessors('file-backed', {
    read: () => {
      ensureStoreDirectory(path);
      return withFileLock(path, () => loadStoreFile(path));
    },
    mutate: (action) => {
      ensureStoreDirectory(path);
      return withFileLock(path, () => {
        const file = loadStoreFile(path);
        const result = action(file);
        saveStoreFile(path, file);
        return result;
      });
    },
  });
}

export function resetFileBackedPolicyActivationApprovalStoreForTests(path?: string): void {
  const resolvedPath = path ?? defaultStorePath();
  if (existsSync(resolvedPath)) rmSync(resolvedPath, { force: true });
  if (existsSync(`${resolvedPath}.lock`)) {
    rmSync(`${resolvedPath}.lock`, { recursive: true, force: true });
  }
}

export function requestPolicyActivationApproval(
  store: PolicyActivationApprovalStore,
  input: RequestPolicyActivationApprovalInput,
): PolicyActivationApprovalRequest {
  return store.upsert(createPolicyActivationApprovalRequest(input));
}

function roleAllowed(
  requirement: PolicyActivationApprovalRequirement,
  reviewer: ReleaseActorReference,
): boolean {
  if (requirement.requiredReviewerRoles.length === 0) return true;
  if (!reviewer.role) return false;
  return requirement.requiredReviewerRoles.includes(reviewer.role);
}

function distinctApprovalCount(decisions: readonly PolicyActivationApprovalDecision[]): number {
  return new Set(
    decisions
      .filter((decision) => decision.decision === 'approve')
      .map((decision) => decision.reviewer.id),
  ).size;
}

function finalizeRequestWithDecision(
  request: PolicyActivationApprovalRequest,
  decision: PolicyActivationApprovalDecision,
): PolicyActivationApprovalRequest {
  const decisions = Object.freeze([...request.decisions, decision]);
  const approvedReviewerIds = Object.freeze(
    Array.from(
      new Set(
        decisions
          .filter((entry) => entry.decision === 'approve')
          .map((entry) => entry.reviewer.id),
      ),
    ).sort(),
  );
  const rejectedReviewerIds = Object.freeze(
    Array.from(
      new Set(
        decisions
          .filter((entry) => entry.decision === 'reject')
          .map((entry) => entry.reviewer.id),
      ),
    ).sort(),
  );
  const state: PolicyActivationApprovalState =
    decision.decision === 'reject'
      ? 'rejected'
      : distinctApprovalCount(decisions) >= request.requirement.requiredApprovals
        ? 'approved'
        : 'pending';

  return requestWithDigest({
    ...request,
    state,
    decisions,
    approvedReviewerIds,
    rejectedReviewerIds,
    latestDecisionAt: decision.decidedAt,
  });
}

export function recordPolicyActivationApprovalDecision(
  store: PolicyActivationApprovalStore,
  input: RecordPolicyActivationApprovalDecisionInput,
): PolicyActivationApprovalRequest {
  const request = store.get(input.requestId);
  if (!request) {
    throw new Error(`Policy activation approval request '${input.requestId}' was not found.`);
  }
  if (request.state !== 'pending') {
    throw new Error(`Policy activation approval request '${input.requestId}' is already ${request.state}.`);
  }
  if (request.requirement.requiresRequesterSeparation && request.requestedBy.id === input.reviewer.id) {
    throw new Error('Policy activation approval cannot be granted by the same actor that requested activation.');
  }
  if (input.decision === 'approve' && !roleAllowed(request.requirement, input.reviewer)) {
    throw new Error(
      `Reviewer role '${input.reviewer.role}' is not allowed for this policy activation approval.`,
    );
  }
  if (
    input.decision === 'approve' &&
    request.approvedReviewerIds.includes(input.reviewer.id)
  ) {
    throw new Error(`Reviewer '${input.reviewer.id}' has already approved this activation request.`);
  }

  const decision = createDecision(input);
  return store.upsert(finalizeRequestWithDecision(request, decision));
}

function requestExpired(
  request: PolicyActivationApprovalRequest,
  now: string | undefined,
): boolean {
  const comparisonTime = now ? Date.parse(normalizeIsoTimestamp(now, 'now')) : Date.now();
  return Date.parse(request.expiresAt) < comparisonTime;
}

export function evaluatePolicyActivationApprovalGate(
  store: PolicyActivationApprovalStore,
  input: PolicyActivationApprovalGateInput,
): PolicyActivationApprovalGateResult {
  const requirement = derivePolicyActivationApprovalRequirement({
    target: input.target,
    bundleRecord: input.bundleRecord,
  });
  if (requirement.requiredApprovals === 0) {
    return Object.freeze({
      allowed: true,
      status: 'not-required',
      requirement,
      request: null,
      message: 'Policy activation approval is not required for this target and bundle.',
    });
  }
  if (!input.approvalRequestId?.trim()) {
    return Object.freeze({
      allowed: false,
      status: 'approval-required',
      requirement,
      request: null,
      message: 'Policy activation requires an approved reviewer authorization request.',
    });
  }

  const request = store.get(input.approvalRequestId.trim());
  if (!request) {
    return Object.freeze({
      allowed: false,
      status: 'approval-not-found',
      requirement,
      request: null,
      message: `Policy activation approval request '${input.approvalRequestId}' was not found.`,
    });
  }
  if (request.targetLabel !== policyActivationTargetLabel(input.target)) {
    return Object.freeze({
      allowed: false,
      status: 'approval-target-mismatch',
      requirement,
      request,
      message: 'Policy activation approval target does not match the requested activation target.',
    });
  }
  if (
    request.bundle.packId !== input.bundleRecord.packId ||
    request.bundle.bundleId !== input.bundleRecord.bundleId
  ) {
    return Object.freeze({
      allowed: false,
      status: 'approval-bundle-mismatch',
      requirement,
      request,
      message: 'Policy activation approval bundle does not match the requested activation bundle.',
    });
  }
  if (request.requirement.requiredApprovals < requirement.requiredApprovals) {
    return Object.freeze({
      allowed: false,
      status: 'approval-requirement-mismatch',
      requirement,
      request,
      message: 'Policy activation approval no longer satisfies the current approval requirement.',
    });
  }
  if (requestExpired(request, input.now)) {
    return Object.freeze({
      allowed: false,
      status: 'approval-expired',
      requirement,
      request,
      message: 'Policy activation approval has expired.',
    });
  }
  if (request.state === 'rejected') {
    return Object.freeze({
      allowed: false,
      status: 'approval-rejected',
      requirement,
      request,
      message: 'Policy activation approval was rejected.',
    });
  }
  if (request.state !== 'approved') {
    return Object.freeze({
      allowed: false,
      status: 'approval-pending',
      requirement,
      request,
      message: 'Policy activation approval is still pending.',
    });
  }

  return Object.freeze({
    allowed: true,
    status: 'approved',
    requirement,
    request,
    message: 'Policy activation approval requirement satisfied.',
  });
}
