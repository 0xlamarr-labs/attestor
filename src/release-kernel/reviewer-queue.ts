import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { withFileLock, writeTextFileAtomic } from '../platform/file-store.js';
import type {
  FinanceFilingReleaseCandidate,
  FinanceFilingReleaseReportLike,
  FinanceFilingRow,
} from './finance-record-release.js';
import type { ReleaseDecision, ReleaseFinding } from './object-model.js';
import type { IssuedReleaseToken } from './release-token.js';
import type { ReleaseDecisionLogEntry } from './release-decision-log.js';
import type { RiskClass } from './types.js';
import { consequenceTypeLabel, RISK_CLASS_PROFILES } from './types.js';

export const RELEASE_REVIEWER_QUEUE_SPEC_VERSION = 'attestor.release-reviewer-queue.v2';
export const ATTESTOR_RELEASE_REVIEWER_QUEUE_STORE_PATH_ENV =
  'ATTESTOR_RELEASE_REVIEWER_QUEUE_STORE_PATH';

const DEFAULT_RELEASE_REVIEWER_QUEUE_STORE_PATH = '.attestor/release-reviewer-queue-store.json';

export type ReleaseReviewerQueueItemKind = 'finance.filing-export';
export type ReleaseReviewerQueueStatus = 'pending-review' | 'approved' | 'rejected' | 'overridden';
export type ReleaseReviewerAuthorityState = 'pending' | 'approved' | 'rejected' | 'overridden';
export type ReleaseReviewerDecisionOutcome = 'approved' | 'rejected';

export interface ReleaseReviewerTimelineEntry {
  readonly occurredAt: string;
  readonly phase: ReleaseDecisionLogEntry['phase'];
  readonly decisionStatus: ReleaseDecision['status'];
  readonly requiresReview: boolean;
  readonly deterministicChecksCompleted: boolean;
  readonly reviewerLabel?: string;
}

export interface ReleaseReviewerChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly emphasis: 'primary' | 'supporting';
}

export interface FinanceReviewerCandidatePreview {
  readonly runId: string;
  readonly adapterId: string;
  readonly certificateId: string | null;
  readonly proofMode: string;
  readonly evidenceChainTerminal: string;
  readonly rowCount: number;
  readonly rowKeys: readonly string[];
  readonly previewRows: readonly FinanceFilingRow[];
  readonly financeDecision: string;
  readonly receiptStatus: string | null;
  readonly oversightStatus: string | null;
}

export interface ReleaseReviewerIdentity {
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly reviewerRole: string;
}

export interface ReleaseReviewerDecisionRecord extends ReleaseReviewerIdentity {
  readonly id: string;
  readonly outcome: ReleaseReviewerDecisionOutcome;
  readonly decidedAt: string;
  readonly note: string | null;
}

export interface ReleaseReviewerIssuedTokenSummary {
  readonly tokenId: string;
  readonly expiresAt: string;
  readonly audience: string;
}

export interface ReleaseReviewerOverrideSummary {
  readonly reasonCode: string;
  readonly ticketId: string | null;
  readonly requestedById: string;
  readonly requestedByLabel: string;
  readonly requestedByRole: string | null;
}

export interface ReleaseReviewerQueueSummary {
  readonly version: typeof RELEASE_REVIEWER_QUEUE_SPEC_VERSION;
  readonly id: string;
  readonly kind: ReleaseReviewerQueueItemKind;
  readonly status: ReleaseReviewerQueueStatus;
  readonly authorityState: ReleaseReviewerAuthorityState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decisionId: string;
  readonly releaseDecisionStatus: ReleaseDecision['status'];
  readonly policyVersion: string;
  readonly consequenceType: ReleaseDecision['consequenceType'];
  readonly consequenceLabel: string;
  readonly riskClass: RiskClass;
  readonly riskLabel: string;
  readonly requesterLabel: string;
  readonly targetId: string;
  readonly targetDisplayName: string;
  readonly authorityMode: ReleaseDecision['reviewAuthority']['mode'];
  readonly minimumReviewerCount: number;
  readonly approvalsRecorded: number;
  readonly approvalsRemaining: number;
  readonly headline: string;
  readonly summary: string;
  readonly findingSummary: string;
  readonly checklistSummary: string;
}

export interface ReleaseReviewerQueueDetail extends ReleaseReviewerQueueSummary {
  readonly outputHash: string;
  readonly consequenceHash: string;
  readonly evidencePackId: string | null;
  readonly findings: readonly ReleaseFinding[];
  readonly candidate: FinanceReviewerCandidatePreview;
  readonly checklist: readonly ReleaseReviewerChecklistItem[];
  readonly timeline: readonly ReleaseReviewerTimelineEntry[];
  readonly reviewerDecisions: readonly ReleaseReviewerDecisionRecord[];
  readonly issuedReleaseToken: ReleaseReviewerIssuedTokenSummary | null;
  readonly overrideGrant: ReleaseReviewerOverrideSummary | null;
}

export interface ReleaseReviewerQueueRecord {
  readonly detail: ReleaseReviewerQueueDetail;
  readonly releaseDecision: ReleaseDecision;
}

export interface ReleaseReviewerQueueListOptions {
  readonly riskClass?: RiskClass;
  readonly consequenceType?: ReleaseDecision['consequenceType'];
  readonly limit?: number;
}

export interface ReleaseReviewerQueueListResult {
  readonly generatedAt: string;
  readonly totalPending: number;
  readonly countsByRiskClass: Readonly<Record<RiskClass, number>>;
  readonly items: readonly ReleaseReviewerQueueSummary[];
}

export interface ReleaseReviewerQueueStore {
  upsert(record: ReleaseReviewerQueueRecord): ReleaseReviewerQueueDetail;
  get(id: string): ReleaseReviewerQueueDetail | null;
  getRecord(id: string): ReleaseReviewerQueueRecord | null;
  listPending(options?: ReleaseReviewerQueueListOptions): ReleaseReviewerQueueListResult;
}

interface ReleaseReviewerQueueStoreFile {
  readonly version: 1;
  records: ReleaseReviewerQueueRecord[];
}

export interface CreateFinanceReviewerQueueItemInput {
  readonly decision: ReleaseDecision;
  readonly candidate: FinanceFilingReleaseCandidate;
  readonly report: FinanceFilingReleaseReportLike;
  readonly logEntries: readonly ReleaseDecisionLogEntry[];
}

export interface ApplyReviewerDecisionInput {
  readonly record: ReleaseReviewerQueueRecord;
  readonly outcome: ReleaseReviewerDecisionOutcome;
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly reviewerRole: string;
  readonly decidedAt: string;
  readonly note?: string | null;
}

export interface ApplyReviewerDecisionResult {
  readonly record: ReleaseReviewerQueueRecord;
  readonly finalDecisionReached: boolean;
}

export interface AttachIssuedTokenInput {
  readonly record: ReleaseReviewerQueueRecord;
  readonly issuedToken: IssuedReleaseToken;
}

export interface ApplyBreakGlassOverrideInput {
  readonly record: ReleaseReviewerQueueRecord;
  readonly reasonCode: string;
  readonly ticketId?: string | null;
  readonly requestedById: string;
  readonly requestedByName: string;
  readonly requestedByRole?: string | null;
  readonly note?: string | null;
  readonly decidedAt: string;
}

export class ReleaseReviewerQueueError extends Error {
  readonly code:
    | 'missing_reviewer'
    | 'reviewer_not_allowed'
    | 'reviewer_role_not_allowed'
    | 'duplicate_reviewer'
    | 'already_finalized'
    | 'missing_override_reason'
    | 'missing_override_requester';

  constructor(
    code:
      | 'missing_reviewer'
      | 'reviewer_not_allowed'
      | 'reviewer_role_not_allowed'
      | 'duplicate_reviewer'
      | 'already_finalized'
      | 'missing_override_reason'
      | 'missing_override_requester',
    message: string,
  ) {
    super(message);
    this.name = 'ReleaseReviewerQueueError';
    this.code = code;
  }
}

export class ReleaseReviewerQueueStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseReviewerQueueStoreError';
  }
}

function normalizeOptionalRole(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function riskRank(riskClass: RiskClass): number {
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
  }
}

function requesterLabel(decision: ReleaseDecision): string {
  if (decision.requester.displayName?.trim()) {
    return decision.requester.displayName.trim();
  }
  return decision.requester.id;
}

function targetDisplayName(decision: ReleaseDecision): string {
  return decision.target.displayName?.trim() || decision.target.id;
}

function summarizeFindings(findings: readonly ReleaseFinding[]): string {
  const fails = findings.filter((finding) => finding.result === 'fail');
  if (fails.length > 0) {
    return fails[0]?.message ?? `${fails.length} blocking findings require reviewer attention.`;
  }

  const warns = findings.filter((finding) => finding.result === 'warn');
  if (warns.length > 0) {
    return warns[0]?.message ?? `${warns.length} warning findings require reviewer attention.`;
  }

  return 'Deterministic controls passed, but human authority is still required before consequence.';
}

function buildChecklist(
  decision: ReleaseDecision,
  candidate: FinanceFilingReleaseCandidate,
): readonly ReleaseReviewerChecklistItem[] {
  const steps: ReleaseReviewerChecklistItem[] = [
    {
      id: 'target-binding',
      label: `Confirm the release target is still '${targetDisplayName(decision)}'.`,
      emphasis: 'primary',
    },
    {
      id: 'row-preview',
      label: `Review the ${candidate.rows.length} structured record row(s) that would cross the consequence boundary.`,
      emphasis: 'primary',
    },
    {
      id: 'finding-review',
      label: 'Read the deterministic findings and verify no blocked control was bypassed.',
      emphasis: 'primary',
    },
    {
      id: 'authority-bridge',
      label: 'Check the finance authority chain state (receipt, oversight, proof mode) before authorizing release.',
      emphasis: 'supporting',
    },
  ];

  if (decision.reviewAuthority.minimumReviewerCount > 1) {
    steps.push({
      id: 'dual-approval-heads-up',
      label: `This risk class is configured for ${decision.reviewAuthority.minimumReviewerCount} reviewers. Coordinate the second approval path before consequence.`,
      emphasis: 'supporting',
    });
  }

  return Object.freeze(steps);
}

function buildCandidatePreview(
  candidate: FinanceFilingReleaseCandidate,
  report: FinanceFilingReleaseReportLike,
): FinanceReviewerCandidatePreview {
  const rowKeys = Array.from(
    candidate.rows.reduce((keys, row) => {
      for (const key of Object.keys(row)) {
        keys.add(key);
      }
      return keys;
    }, new Set<string>()),
  ).sort();

  return Object.freeze({
    runId: candidate.runId,
    adapterId: candidate.adapterId,
    certificateId: candidate.certificateId,
    proofMode: candidate.proofMode,
    evidenceChainTerminal: candidate.evidenceChainTerminal,
    rowCount: candidate.rows.length,
    rowKeys: Object.freeze(rowKeys),
    previewRows: Object.freeze(candidate.rows.slice(0, 3).map((row) => Object.freeze({ ...row }))),
    financeDecision: report.decision,
    receiptStatus: report.receipt?.receiptStatus ?? null,
    oversightStatus: report.oversight.status,
  });
}

function buildTimeline(
  decision: ReleaseDecision,
  entries: readonly ReleaseDecisionLogEntry[],
): readonly ReleaseReviewerTimelineEntry[] {
  return Object.freeze(
    entries
      .filter((entry) => entry.decisionId === decision.id)
      .sort((left, right) => left.sequence - right.sequence)
      .map((entry) =>
        Object.freeze({
          occurredAt: entry.occurredAt,
          phase: entry.phase,
          decisionStatus: entry.decisionStatus,
          requiresReview: entry.metadata.requiresReview,
          deterministicChecksCompleted: entry.metadata.deterministicChecksCompleted,
        }),
      ),
  );
}

function ensureNamedReviewerRequirements(
  decision: ReleaseDecision,
  input: ApplyReviewerDecisionInput,
): void {
  if (!input.reviewerId.trim() || !input.reviewerName.trim() || !input.reviewerRole.trim()) {
    throw new ReleaseReviewerQueueError(
      'missing_reviewer',
      'Named review requires reviewerId, reviewerName, and reviewerRole.',
    );
  }

  if (
    decision.reviewAuthority.requiredReviewerIds.length > 0 &&
    !decision.reviewAuthority.requiredReviewerIds.includes(input.reviewerId.trim())
  ) {
    throw new ReleaseReviewerQueueError(
      'reviewer_not_allowed',
      `Reviewer '${input.reviewerId}' is not authorized for this release decision.`,
    );
  }

  if (
    decision.reviewAuthority.requiredRoles.length > 0 &&
    !decision.reviewAuthority.requiredRoles.includes(input.reviewerRole.trim())
  ) {
    throw new ReleaseReviewerQueueError(
      'reviewer_role_not_allowed',
      `Reviewer role '${input.reviewerRole}' is not allowed for this release decision.`,
    );
  }
}

function reviewerDecisionRecord(
  input: ApplyReviewerDecisionInput,
): ReleaseReviewerDecisionRecord {
  return Object.freeze({
    id: `rrd_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    reviewerId: input.reviewerId.trim(),
    reviewerName: input.reviewerName.trim(),
    reviewerRole: input.reviewerRole.trim(),
    outcome: input.outcome,
    decidedAt: input.decidedAt,
    note: input.note?.trim() ? input.note.trim() : null,
  });
}

function overrideSummaryFromDecision(decision: ReleaseDecision): ReleaseReviewerOverrideSummary | null {
  if (!decision.override) {
    return null;
  }

  return Object.freeze({
    reasonCode: decision.override.reasonCode,
    ticketId: decision.override.ticketId ?? null,
    requestedById: decision.override.requestedBy.id,
    requestedByLabel:
      decision.override.requestedBy.displayName?.trim() || decision.override.requestedBy.id,
    requestedByRole: normalizeOptionalRole(decision.override.requestedBy.role),
  });
}

function updateReviewSummary(
  decision: ReleaseDecision,
  reviewerDecisions: readonly ReleaseReviewerDecisionRecord[],
): Pick<
  ReleaseReviewerQueueSummary,
  | 'status'
  | 'authorityState'
  | 'releaseDecisionStatus'
  | 'approvalsRecorded'
  | 'approvalsRemaining'
  | 'summary'
  | 'findingSummary'
> {
  const approvalsRecorded = reviewerDecisions.filter((entry) => entry.outcome === 'approved').length;
  const rejection = reviewerDecisions.find((entry) => entry.outcome === 'rejected') ?? null;
  const approvalsRemaining = Math.max(
    decision.reviewAuthority.minimumReviewerCount - approvalsRecorded,
    0,
  );

  if (rejection) {
    return {
      status: 'rejected',
      authorityState: 'rejected',
      releaseDecisionStatus: 'denied',
      approvalsRecorded,
      approvalsRemaining,
      summary: `Reviewer authority denied consequence after ${rejection.reviewerName} rejected the release candidate.`,
      findingSummary: `Rejected by ${rejection.reviewerName}; no release token may be issued for this candidate.`,
    };
  }

  if (approvalsRemaining === 0) {
    return {
      status: 'approved',
      authorityState: 'approved',
      releaseDecisionStatus: 'accepted',
      approvalsRecorded,
      approvalsRemaining,
      summary: `Reviewer authority is complete. ${approvalsRecorded} reviewer approval(s) authorized release to ${targetDisplayName(decision)}.`,
      findingSummary: 'Human authority completed the release decision; token issuance may proceed.',
    };
  }

  return {
    status: 'pending-review',
    authorityState: 'pending',
    releaseDecisionStatus: decision.status,
    approvalsRecorded,
    approvalsRemaining,
    summary: `${approvalsRecorded} of ${decision.reviewAuthority.minimumReviewerCount} required reviewer approval(s) recorded before consequence may proceed.`,
    findingSummary: approvalsRecorded > 0
      ? 'Additional named reviewer approval is still required before token issuance.'
      : summarizeFindings(decision.findings),
  };
}

function buildBreakGlassSummary(
  decision: ReleaseDecision,
): Pick<
  ReleaseReviewerQueueSummary,
  | 'status'
  | 'authorityState'
  | 'releaseDecisionStatus'
  | 'approvalsRecorded'
  | 'approvalsRemaining'
  | 'summary'
  | 'findingSummary'
> {
  const approvalsRecorded = decision.override ? 1 : 0;
  return {
    status: 'overridden',
    authorityState: 'overridden',
    releaseDecisionStatus: 'overridden',
    approvalsRecorded,
    approvalsRemaining: 0,
    summary: `Break-glass release override authorized consequence to ${targetDisplayName(decision)} under explicit emergency controls.`,
    findingSummary: `Emergency override '${decision.override?.reasonCode ?? 'unspecified'}' replaced normal reviewer closure for this candidate.`,
  };
}

function addReviewFinding(
  decision: ReleaseDecision,
  input: ApplyReviewerDecisionInput,
  approvalsRecorded: number,
): ReleaseFinding {
  if (input.outcome === 'rejected') {
    return {
      code: 'release_reviewer_rejected',
      result: 'fail',
      message: `${input.reviewerName.trim()} rejected the release candidate before consequence.`,
      source: 'review',
    };
  }

  return {
    code:
      decision.reviewAuthority.minimumReviewerCount > 1
        ? approvalsRecorded >= decision.reviewAuthority.minimumReviewerCount
          ? 'release_dual_approval_completed'
          : 'release_dual_approval_partial'
        : 'release_named_review_approved',
    result: approvalsRecorded >= decision.reviewAuthority.minimumReviewerCount ? 'pass' : 'info',
    message:
      approvalsRecorded >= decision.reviewAuthority.minimumReviewerCount
        ? `${input.reviewerName.trim()} completed the required reviewer authority for consequence release.`
        : `${input.reviewerName.trim()} recorded approval ${approvalsRecorded} of ${decision.reviewAuthority.minimumReviewerCount}.`,
    source: 'review',
  };
}

function cloneDecisionWithReviewOutcome(
  decision: ReleaseDecision,
  input: ApplyReviewerDecisionInput,
  reviewerDecisions: readonly ReleaseReviewerDecisionRecord[],
): ReleaseDecision {
  const approvalsRecorded = reviewerDecisions.filter((entry) => entry.outcome === 'approved').length;
  const nextStatus =
    input.outcome === 'rejected'
      ? 'denied'
      : approvalsRecorded >= decision.reviewAuthority.minimumReviewerCount
        ? 'accepted'
        : decision.status;

  return Object.freeze({
    ...decision,
    status: nextStatus,
    findings: Object.freeze([...decision.findings, addReviewFinding(decision, input, approvalsRecorded)]),
  });
}

function cloneDecisionWithBreakGlassOverride(
  decision: ReleaseDecision,
  input: ApplyBreakGlassOverrideInput,
): ReleaseDecision {
  const reasonCode = input.reasonCode.trim();
  if (!reasonCode) {
    throw new ReleaseReviewerQueueError(
      'missing_override_reason',
      'Break-glass override requires a non-empty reasonCode.',
    );
  }

  const requestedById = input.requestedById.trim();
  const requestedByName = input.requestedByName.trim();
  if (!requestedById || !requestedByName) {
    throw new ReleaseReviewerQueueError(
      'missing_override_requester',
      'Break-glass override requires requestedById and requestedByName.',
    );
  }

  const overrideFinding: ReleaseFinding = {
    code: 'release_break_glass_override',
    result: 'warn',
    message: `${requestedByName} authorized an emergency break-glass release for reason '${reasonCode}'.`,
    source: 'override',
  };

  return Object.freeze({
    ...decision,
    status: 'overridden',
    override: Object.freeze({
      reasonCode,
      ticketId: input.ticketId?.trim() || undefined,
      requestedBy: Object.freeze({
        id: requestedById,
        type: 'user',
        displayName: requestedByName,
        role: normalizeOptionalRole(input.requestedByRole) ?? undefined,
      }),
    }),
    findings: Object.freeze([
      ...decision.findings,
      overrideFinding,
    ]),
  });
}

function reviewerTimelineEntry(
  occurredAt: string,
  phase: ReleaseReviewerTimelineEntry['phase'],
  decisionStatus: ReleaseDecision['status'],
  reviewerLabel: string,
): ReleaseReviewerTimelineEntry {
  return Object.freeze({
    occurredAt,
    phase,
    decisionStatus,
    requiresReview: decisionStatus === 'review-required' || decisionStatus === 'hold',
    deterministicChecksCompleted: true,
    reviewerLabel,
  });
}

function freezeReviewerDecisions(
  decisions: readonly ReleaseReviewerDecisionRecord[],
): readonly ReleaseReviewerDecisionRecord[] {
  return Object.freeze(decisions.map((entry) => Object.freeze({ ...entry })));
}

function freezeTimeline(
  timeline: readonly ReleaseReviewerTimelineEntry[],
): readonly ReleaseReviewerTimelineEntry[] {
  return Object.freeze(timeline.map((entry) => Object.freeze({ ...entry })));
}

function freezeDetail(detail: ReleaseReviewerQueueDetail): ReleaseReviewerQueueDetail {
  return Object.freeze({
    ...detail,
    findings: Object.freeze(detail.findings.map((finding) => Object.freeze({ ...finding }))),
    checklist: Object.freeze(detail.checklist.map((entry) => Object.freeze({ ...entry }))),
    timeline: freezeTimeline(detail.timeline),
    reviewerDecisions: freezeReviewerDecisions(detail.reviewerDecisions),
    candidate: Object.freeze({
      ...detail.candidate,
      rowKeys: Object.freeze([...detail.candidate.rowKeys]),
      previewRows: Object.freeze(detail.candidate.previewRows.map((row) => Object.freeze({ ...row }))),
    }),
    issuedReleaseToken: detail.issuedReleaseToken
      ? Object.freeze({ ...detail.issuedReleaseToken })
      : null,
    overrideGrant: detail.overrideGrant
      ? Object.freeze({ ...detail.overrideGrant })
      : null,
  });
}

function freezeRecord(record: ReleaseReviewerQueueRecord): ReleaseReviewerQueueRecord {
  return Object.freeze({
    detail: freezeDetail(record.detail),
    releaseDecision: Object.freeze({
      ...record.releaseDecision,
      findings: Object.freeze(record.releaseDecision.findings.map((finding) => Object.freeze({ ...finding }))),
      reviewAuthority: Object.freeze({
        ...record.releaseDecision.reviewAuthority,
        requiredRoles: Object.freeze([...record.releaseDecision.reviewAuthority.requiredRoles]),
        requiredReviewerIds: Object.freeze([...record.releaseDecision.reviewAuthority.requiredReviewerIds]),
      }),
      releaseConditions: Object.freeze({
        items: Object.freeze(record.releaseDecision.releaseConditions.items.map((item) => Object.freeze({ ...item }))),
      }),
    }),
  });
}

function defaultReleaseReviewerQueueStoreFile(): ReleaseReviewerQueueStoreFile {
  return {
    version: 1,
    records: [],
  };
}

function defaultReleaseReviewerQueueStorePath(): string {
  return resolve(
    process.env[ATTESTOR_RELEASE_REVIEWER_QUEUE_STORE_PATH_ENV] ??
      DEFAULT_RELEASE_REVIEWER_QUEUE_STORE_PATH,
  );
}

function ensureReleaseReviewerQueueStoreDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function normalizeReleaseReviewerQueueStoreFile(
  value: unknown,
  path: string,
): ReleaseReviewerQueueStoreFile {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1 ||
    !Array.isArray((value as { records?: unknown }).records)
  ) {
    throw new ReleaseReviewerQueueStoreError(
      `Release reviewer queue store '${path}' has an invalid file shape.`,
    );
  }

  return {
    version: 1,
    records: (value as { records: ReleaseReviewerQueueRecord[] }).records.map((record) =>
      freezeRecord(record),
    ),
  };
}

function loadReleaseReviewerQueueStoreFile(path: string): ReleaseReviewerQueueStoreFile {
  ensureReleaseReviewerQueueStoreDirectory(path);
  if (!existsSync(path)) return defaultReleaseReviewerQueueStoreFile();

  try {
    return normalizeReleaseReviewerQueueStoreFile(
      JSON.parse(readFileSync(path, 'utf8')) as unknown,
      path,
    );
  } catch (error) {
    if (error instanceof ReleaseReviewerQueueStoreError) throw error;
    throw new ReleaseReviewerQueueStoreError(
      `Release reviewer queue store '${path}' could not be parsed.`,
    );
  }
}

function saveReleaseReviewerQueueStoreFile(
  path: string,
  file: ReleaseReviewerQueueStoreFile,
): void {
  writeTextFileAtomic(
    path,
    `${JSON.stringify(
      {
        version: 1,
        records: file.records,
      },
      null,
      2,
    )}\n`,
  );
}

function createReleaseReviewerQueueStoreFromAccessors(accessors: {
  readonly read: () => ReleaseReviewerQueueStoreFile;
  readonly mutate: <T>(action: (file: ReleaseReviewerQueueStoreFile) => T) => T;
}): ReleaseReviewerQueueStore {
  return {
    upsert(record: ReleaseReviewerQueueRecord): ReleaseReviewerQueueDetail {
      return accessors.mutate((file) => {
        const stored = freezeRecord(record);
        const existingIndex = file.records.findIndex((entry) => entry.detail.id === stored.detail.id);
        if (existingIndex >= 0) {
          file.records[existingIndex] = stored;
        } else {
          file.records.push(stored);
        }
        return stored.detail;
      });
    },
    get(id: string): ReleaseReviewerQueueDetail | null {
      return accessors.read().records.find((record) => record.detail.id === id)?.detail ?? null;
    },
    getRecord(id: string): ReleaseReviewerQueueRecord | null {
      return accessors.read().records.find((record) => record.detail.id === id) ?? null;
    },
    listPending(options: ReleaseReviewerQueueListOptions = {}): ReleaseReviewerQueueListResult {
      const generatedAt = new Date().toISOString();
      const filtered = accessors
        .read()
        .records
        .map((record) => record.detail)
        .filter((item) => item.status === 'pending-review')
        .filter((item) => !options.riskClass || item.riskClass === options.riskClass)
        .filter((item) => !options.consequenceType || item.consequenceType === options.consequenceType)
        .sort((left, right) => {
          const rankDelta = riskRank(right.riskClass) - riskRank(left.riskClass);
          if (rankDelta !== 0) return rankDelta;
          return left.createdAt.localeCompare(right.createdAt);
        });

      const limited = options.limit ? filtered.slice(0, options.limit) : filtered;
      const counts = filtered.reduce<Record<RiskClass, number>>((acc, item) => {
        acc[item.riskClass] += 1;
        return acc;
      }, { R0: 0, R1: 0, R2: 0, R3: 0, R4: 0 });

      return {
        generatedAt,
        totalPending: filtered.length,
        countsByRiskClass: Object.freeze(counts),
        items: Object.freeze(limited),
      };
    },
  };
}

export function createFinanceReviewerQueueItem(
  input: CreateFinanceReviewerQueueItemInput,
): ReleaseReviewerQueueRecord {
  const { decision, candidate, report, logEntries } = input;
  const checklist = buildChecklist(decision, candidate);
  const candidatePreview = buildCandidatePreview(candidate, report);
  const timeline = buildTimeline(decision, logEntries);
  const createdAt = decision.createdAt;
  const riskProfile = RISK_CLASS_PROFILES[decision.riskClass];
  const headline = `${candidate.adapterId} filing export waiting for release review`;
  const summary = `${candidate.runId} is paused before consequence because ${decision.reviewAuthority.minimumReviewerCount === 1 ? 'a reviewer' : `${decision.reviewAuthority.minimumReviewerCount} reviewers`} must authorize release to ${targetDisplayName(decision)}.`;

  return freezeRecord({
    detail: {
      version: RELEASE_REVIEWER_QUEUE_SPEC_VERSION,
      id: `review_${decision.id}`,
      kind: 'finance.filing-export',
      status: 'pending-review',
      authorityState: 'pending',
      createdAt,
      updatedAt: createdAt,
      decisionId: decision.id,
      releaseDecisionStatus: decision.status,
      policyVersion: decision.policyVersion,
      consequenceType: decision.consequenceType,
      consequenceLabel: consequenceTypeLabel(decision.consequenceType),
      riskClass: decision.riskClass,
      riskLabel: riskProfile.label,
      requesterLabel: requesterLabel(decision),
      targetId: decision.target.id,
      targetDisplayName: targetDisplayName(decision),
      authorityMode: decision.reviewAuthority.mode,
      minimumReviewerCount: decision.reviewAuthority.minimumReviewerCount,
      approvalsRecorded: 0,
      approvalsRemaining: decision.reviewAuthority.minimumReviewerCount,
      headline,
      summary,
      findingSummary: summarizeFindings(decision.findings),
      checklistSummary: checklist[0]?.label ?? 'Review required before consequence.',
      outputHash: decision.outputHash,
      consequenceHash: decision.consequenceHash,
      evidencePackId: decision.evidencePackId,
      findings: Object.freeze(decision.findings.map((finding) => Object.freeze({ ...finding }))),
      candidate: candidatePreview,
      checklist,
      timeline,
      reviewerDecisions: Object.freeze([]),
      issuedReleaseToken: null,
      overrideGrant: null,
    },
    releaseDecision: Object.freeze({
      ...decision,
      findings: Object.freeze(decision.findings.map((finding) => Object.freeze({ ...finding }))),
    }),
  });
}

export function applyReviewerDecision(
  input: ApplyReviewerDecisionInput,
): ApplyReviewerDecisionResult {
  const { record } = input;
  if (record.detail.status !== 'pending-review') {
    throw new ReleaseReviewerQueueError(
      'already_finalized',
      `Release review '${record.detail.id}' is already ${record.detail.status}.`,
    );
  }

  ensureNamedReviewerRequirements(record.releaseDecision, input);

  if (
    record.detail.reviewerDecisions.some(
      (entry) => entry.reviewerId === input.reviewerId.trim(),
    )
  ) {
    throw new ReleaseReviewerQueueError(
      'duplicate_reviewer',
      `Reviewer '${input.reviewerId}' has already acted on this release decision.`,
    );
  }

  const reviewEntry = reviewerDecisionRecord(input);
  const reviewerDecisions = freezeReviewerDecisions([
    ...record.detail.reviewerDecisions,
    reviewEntry,
  ]);
  const nextDecision = cloneDecisionWithReviewOutcome(record.releaseDecision, input, reviewerDecisions);
  const summary = updateReviewSummary(nextDecision, reviewerDecisions);
  const timeline = freezeTimeline([
    ...record.detail.timeline,
    reviewerTimelineEntry(
      input.decidedAt,
      'review',
      nextDecision.status,
      reviewEntry.reviewerName,
    ),
    ...(summary.authorityState === 'approved'
      ? [reviewerTimelineEntry(input.decidedAt, 'terminal-accept', 'accepted', reviewEntry.reviewerName)]
      : summary.authorityState === 'rejected'
        ? [reviewerTimelineEntry(input.decidedAt, 'terminal-deny', 'denied', reviewEntry.reviewerName)]
        : []),
  ]);

  return {
    record: freezeRecord({
      detail: {
        ...record.detail,
        status: summary.status,
        authorityState: summary.authorityState,
        updatedAt: input.decidedAt,
        releaseDecisionStatus: summary.releaseDecisionStatus,
        approvalsRecorded: summary.approvalsRecorded,
        approvalsRemaining: summary.approvalsRemaining,
        summary: summary.summary,
        findingSummary: summary.findingSummary,
        findings: Object.freeze(nextDecision.findings.map((finding) => Object.freeze({ ...finding }))),
        timeline,
        reviewerDecisions,
      },
      releaseDecision: nextDecision,
    }),
    finalDecisionReached:
      summary.authorityState === 'approved' || summary.authorityState === 'rejected',
  };
}

export function applyBreakGlassOverride(
  input: ApplyBreakGlassOverrideInput,
): ReleaseReviewerQueueRecord {
  const { record } = input;
  if (record.detail.status !== 'pending-review') {
    throw new ReleaseReviewerQueueError(
      'already_finalized',
      `Release review '${record.detail.id}' is already ${record.detail.status}.`,
    );
  }

  const nextDecision = cloneDecisionWithBreakGlassOverride(record.releaseDecision, input);
  const summary = buildBreakGlassSummary(nextDecision);
  const timeline = freezeTimeline([
    ...record.detail.timeline,
    reviewerTimelineEntry(
      input.decidedAt,
      'override',
      'overridden',
      input.requestedByName.trim(),
    ),
    reviewerTimelineEntry(
      input.decidedAt,
      'terminal-accept',
      'overridden',
      input.requestedByName.trim(),
    ),
  ]);

  return freezeRecord({
    detail: {
      ...record.detail,
      status: summary.status,
      authorityState: summary.authorityState,
      updatedAt: input.decidedAt,
      releaseDecisionStatus: summary.releaseDecisionStatus,
      approvalsRecorded: summary.approvalsRecorded,
      approvalsRemaining: summary.approvalsRemaining,
      summary: summary.summary,
      findingSummary: summary.findingSummary,
      findings: Object.freeze(nextDecision.findings.map((finding) => Object.freeze({ ...finding }))),
      timeline,
      overrideGrant: overrideSummaryFromDecision(nextDecision),
    },
    releaseDecision: nextDecision,
  });
}

export function attachIssuedTokenToReviewerQueueRecord(
  input: AttachIssuedTokenInput,
): ReleaseReviewerQueueRecord {
  return freezeRecord({
    detail: {
      ...input.record.detail,
      updatedAt: input.issuedToken.issuedAt,
      issuedReleaseToken: {
        tokenId: input.issuedToken.tokenId,
        expiresAt: input.issuedToken.expiresAt,
        audience: input.issuedToken.claims.aud,
      },
    },
    releaseDecision: {
      ...input.record.releaseDecision,
      releaseTokenId: input.issuedToken.tokenId,
    },
  });
}

export function createInMemoryReleaseReviewerQueueStore(): ReleaseReviewerQueueStore {
  let file = defaultReleaseReviewerQueueStoreFile();

  return createReleaseReviewerQueueStoreFromAccessors({
    read: () => file,
    mutate: (action) => {
      const workingCopy: ReleaseReviewerQueueStoreFile = {
        version: 1,
        records: [...file.records],
      };
      const result = action(workingCopy);
      file = workingCopy;
      return result;
    },
  });
}

export function createFileBackedReleaseReviewerQueueStore(
  path = defaultReleaseReviewerQueueStorePath(),
): ReleaseReviewerQueueStore {
  loadReleaseReviewerQueueStoreFile(path);

  return createReleaseReviewerQueueStoreFromAccessors({
    read: () => withFileLock(path, () => loadReleaseReviewerQueueStoreFile(path)),
    mutate: (action) =>
      withFileLock(path, () => {
        const file = loadReleaseReviewerQueueStoreFile(path);
        const result = action(file);
        saveReleaseReviewerQueueStoreFile(path, file);
        return result;
      }),
  });
}

export function resetFileBackedReleaseReviewerQueueStoreForTests(path?: string): void {
  const resolvedPath = path ?? defaultReleaseReviewerQueueStorePath();
  if (existsSync(resolvedPath)) {
    rmSync(resolvedPath, { force: true });
  }
  if (existsSync(`${resolvedPath}.lock`)) {
    rmSync(`${resolvedPath}.lock`, { recursive: true, force: true });
  }
}
