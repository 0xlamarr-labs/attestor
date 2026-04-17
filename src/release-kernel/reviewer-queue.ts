import type {
  FinanceFilingReleaseCandidate,
  FinanceFilingReleaseReportLike,
  FinanceFilingRow,
} from './finance-record-release.js';
import type { ReleaseDecision, ReleaseFinding } from './object-model.js';
import type { ReleaseDecisionLogEntry } from './release-decision-log.js';
import type { RiskClass } from './types.js';
import { consequenceTypeLabel, RISK_CLASS_PROFILES } from './types.js';

export const RELEASE_REVIEWER_QUEUE_SPEC_VERSION = 'attestor.release-reviewer-queue.v1';

export type ReleaseReviewerQueueItemKind = 'finance.filing-export';
export type ReleaseReviewerQueueStatus = 'pending-review';

export interface ReleaseReviewerTimelineEntry {
  readonly occurredAt: string;
  readonly phase: ReleaseDecisionLogEntry['phase'];
  readonly decisionStatus: ReleaseDecision['status'];
  readonly requiresReview: boolean;
  readonly deterministicChecksCompleted: boolean;
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

export interface ReleaseReviewerQueueSummary {
  readonly version: typeof RELEASE_REVIEWER_QUEUE_SPEC_VERSION;
  readonly id: string;
  readonly kind: ReleaseReviewerQueueItemKind;
  readonly status: ReleaseReviewerQueueStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decisionId: string;
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
  upsert(item: ReleaseReviewerQueueDetail): ReleaseReviewerQueueDetail;
  get(id: string): ReleaseReviewerQueueDetail | null;
  listPending(options?: ReleaseReviewerQueueListOptions): ReleaseReviewerQueueListResult;
}

export interface CreateFinanceReviewerQueueItemInput {
  readonly decision: ReleaseDecision;
  readonly candidate: FinanceFilingReleaseCandidate;
  readonly report: FinanceFilingReleaseReportLike;
  readonly logEntries: readonly ReleaseDecisionLogEntry[];
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

export function createFinanceReviewerQueueItem(
  input: CreateFinanceReviewerQueueItemInput,
): ReleaseReviewerQueueDetail {
  const { decision, candidate, report, logEntries } = input;
  const checklist = buildChecklist(decision, candidate);
  const candidatePreview = buildCandidatePreview(candidate, report);
  const timeline = buildTimeline(decision, logEntries);
  const createdAt = decision.createdAt;
  const riskProfile = RISK_CLASS_PROFILES[decision.riskClass];
  const headline = `${candidate.adapterId} filing export waiting for release review`;
  const summary = `${candidate.runId} is paused before consequence because ${decision.reviewAuthority.minimumReviewerCount === 1 ? 'a reviewer' : `${decision.reviewAuthority.minimumReviewerCount} reviewers`} must authorize release to ${targetDisplayName(decision)}.`;

  return Object.freeze({
    version: RELEASE_REVIEWER_QUEUE_SPEC_VERSION,
    id: `review_${decision.id}`,
    kind: 'finance.filing-export',
    status: 'pending-review',
    createdAt,
    updatedAt: createdAt,
    decisionId: decision.id,
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
  });
}

export function createInMemoryReleaseReviewerQueueStore(): ReleaseReviewerQueueStore {
  const items = new Map<string, ReleaseReviewerQueueDetail>();

  return {
    upsert(item: ReleaseReviewerQueueDetail): ReleaseReviewerQueueDetail {
      const stored: ReleaseReviewerQueueDetail = Object.freeze({
        ...item,
        findings: Object.freeze(item.findings.map((finding) => Object.freeze({ ...finding }))),
        checklist: Object.freeze(item.checklist.map((entry) => Object.freeze({ ...entry }))),
        timeline: Object.freeze(item.timeline.map((entry) => Object.freeze({ ...entry }))),
        candidate: Object.freeze({
          ...item.candidate,
          rowKeys: Object.freeze([...item.candidate.rowKeys]),
          previewRows: Object.freeze(item.candidate.previewRows.map((row) => Object.freeze({ ...row }))),
        }),
      });
      items.set(stored.id, stored);
      return stored;
    },
    get(id: string): ReleaseReviewerQueueDetail | null {
      return items.get(id) ?? null;
    },
    listPending(options: ReleaseReviewerQueueListOptions = {}): ReleaseReviewerQueueListResult {
      const generatedAt = new Date().toISOString();
      const filtered = [...items.values()]
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
