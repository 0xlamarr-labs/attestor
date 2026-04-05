/**
 * Financial Reference Implementation — Domain Types (v6)
 *
 * Wire formats for the financial execution domain:
 * AI-generated SQL governance, data contract validation,
 * structured report verification with provenance, audit evidence,
 * and human oversight semantics.
 *
 * Attestor's authority-and-evidence runtime for governed financial pipelines.
 * Provides warrant → escrow → receipt → capsule lifecycle, SQL governance, and live proof.
 */

// ─── Materiality / Risk Tier ─────────────────────────────────────────────────

/**
 * Materiality tier for financial governance.
 * Determines which governance layers apply and whether human approval is required.
 *
 * - `low`: automated governance sufficient (data quality checks, standard reports)
 * - `medium`: full governance + audit trail, human review recommended
 * - `high`: full governance + mandatory human approval before acceptance
 */
export type MaterialityTier = 'low' | 'medium' | 'high';

// ─── Financial Query Intent ──────────────────────────────────────────────────

export type FinancialQueryType =
  | 'counterparty_exposure'
  | 'liquidity_risk'
  | 'reconciliation_variance'
  | 'regulatory_summary'
  | 'concentration_limit';

export interface FinancialQueryIntent {
  /** What kind of financial query this is. */
  queryType: FinancialQueryType;
  /** Human-readable description of the query goal. */
  description: string;
  /** Which schemas/tables the query is allowed to access. */
  allowedSchemas: string[];
  /** Which schemas/tables must never be accessed. */
  forbiddenSchemas: string[];
  /** Expected output columns with types. */
  expectedColumns: DataContractColumn[];
  /** Business constraints on the output. */
  businessConstraints: BusinessConstraint[];
  /** Risk/materiality tier for this query. Default: 'medium'. */
  materialityTier?: MaterialityTier;
  /** Control totals for reconciliation-first acceptance. */
  controlTotals?: ControlTotal[];
  /** Review policy triggers beyond materiality-based escalation. */
  reviewTriggers?: ReviewTrigger[];
  /** Reconciliation class for this query. */
  reconciliationClass?: ReconciliationClass;
  /** Execution class: what kind of query this should be. */
  executionClass?: ExecutionClass;
  /** Execution budget: bounded resource/shape expectations. */
  executionBudget?: ExecutionBudget;
}

// --- Execution Class & Budget ---

export type ExecutionClass = 'aggregate_summary' | 'bounded_detail' | 'reconciliation_check' | 'control_total_check' | 'unbounded';

export interface ExecutionBudget {
  maxJoins?: number;
  maxProjectedColumns?: number;
  requireWhere?: boolean;
  requireLimit?: boolean;
  maxResultRows?: number;
  allowWildcard?: boolean;
}

// --- Execution Guardrails ---

export interface GuardrailCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface GuardrailResult {
  result: 'pass' | 'fail' | 'warn';
  checks: GuardrailCheck[];
  executionClass: ExecutionClass;
  totalChecks: number;
  failedChecks: number;
}

// --- Snapshot Semantics ---

export interface SnapshotIdentity {
  snapshotId: string;
  snapshotHash: string;
  version: string;
  fixtureCount: number;
  sourceKind?: 'fixture' | 'live_db';
  sourceCount?: number;
}

// --- Financial Warrant ---

export type TrustLevel = 'observe_only' | 'human_approved' | 'bounded_autonomy' | 'domain_autonomy';
export type WarrantStatus = 'active' | 'fulfilled' | 'violated';

export interface EvidenceObligation {
  id: string;
  description: string;
  fulfilled: boolean;
}

export interface FinancialWarrant {
  warrantId: string;
  issuedAt: string;
  runId: string;
  contractHash: string;
  replayIdentity: string;
  snapshotHash: string;
  /** Allowed table/schema references from policy. */
  allowedScope: string[];
  /** Denied references. */
  deniedScope: string[];
  executionClass: ExecutionClass;
  executionBudget: ExecutionBudget;
  trustLevel: TrustLevel;
  /** Allowed pipeline stages in order. */
  allowedPath: string[];
  /** Evidence that must be produced for authority to be considered satisfied. */
  evidenceObligations: EvidenceObligation[];
  /** Whether human review is required. */
  reviewRequired: boolean;
  /** Materiality tier. */
  materialityTier: MaterialityTier;
  /** Warrant status. */
  status: WarrantStatus;
  /** Violations detected during the run. */
  violations: string[];
}

// --- Authority Escrow ---

export type EscrowState = 'held' | 'partial' | 'released' | 'withheld';

export interface EscrowRelease {
  obligationId: string;
  released: boolean;
  releasedBy: string;
  releaseTimestamp: string | null;
}

export interface AuthorityEscrow {
  warrantId: string;
  state: EscrowState;
  totalObligations: number;
  releasedCount: number;
  heldCount: number;
  releases: EscrowRelease[];
  /** Why escrow is in its current state. */
  stateReason: string;
  /** Whether human review obligation exists and its status. */
  reviewHeld: boolean;
}

// ─── SQL Governance (v2) ─────────────────────────────────────────────────────

export type SqlSafetyResult = 'pass' | 'fail';

export interface SqlTableReference {
  /** Full reference as written (e.g., 'risk.counterparty_exposures'). */
  reference: string;
  /** Extracted schema (e.g., 'risk'). Null if unqualified. */
  schema: string | null;
  /** Extracted table name (e.g., 'counterparty_exposures'). */
  table: string;
  /** How this table is referenced (FROM, JOIN, subquery). */
  context: 'from' | 'join' | 'subquery';
}

export interface SqlGovernanceResult {
  /** Whether the SQL passed all safety gates. */
  result: SqlSafetyResult;
  /** Individual gate results. */
  gates: SqlGateResult[];
  /** The SQL text that was evaluated. */
  sqlText: string;
  /** Truncated SHA-256 hash of the SQL text (16 hex chars). */
  sqlHash: string;
  /** Structured table references extracted from the SQL. */
  referencedTables: SqlTableReference[];
}

export interface SqlGateResult {
  gate: string;
  passed: boolean;
  detail: string;
}

// ─── Execution Evidence ──────────────────────────────────────────────────────

export interface ExecutionEvidence {
  /** Whether the query executed successfully. */
  success: boolean;
  /** Execution duration in ms. */
  durationMs: number;
  /** Number of rows returned. */
  rowCount: number;
  /** Column names in the result. */
  columns: string[];
  /** Column types in the result. */
  columnTypes: string[];
  /** The actual result rows (for fixture-based execution). */
  rows: Record<string, unknown>[];
  /** Error message if execution failed. */
  error: string | null;
  /** Truncated SHA-256 hash of the result schema (columns + types, 16 hex chars). */
  schemaHash: string;
  /** Execution provider: fixture, sqlite, postgres. */
  provider?: 'fixture' | 'sqlite' | 'postgres';
  /**
   * Execution context hash (Postgres only).
   * SHA-256 of (server version + current_schemas + sanitized connection URL).
   * Proves WHICH database environment was queried, NOT the full schema/data state.
   */
  executionContextHash?: string | null;
}

// ─── Data Contracts ──────────────────────────────────────────────────────────

export interface DataContractColumn {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'null';
  required: boolean;
  /** If true, column must not contain null values. */
  notNull?: boolean;
}

export interface BusinessConstraint {
  /** What this constraint checks. */
  description: string;
  /** Column to check (or '*' for row-level). */
  column: string;
  /** Constraint type. */
  check: 'min' | 'max' | 'range' | 'not_empty' | 'row_count_min' | 'row_count_max' | 'sum_equals' | 'non_negative';
  /** Threshold value(s). */
  value?: number;
  min?: number;
  max?: number;
}

export interface DataContractResult {
  /** Overall pass/fail. */
  result: 'pass' | 'fail' | 'warn';
  /** Individual check results. */
  checks: DataContractCheck[];
  /** Total checks run. */
  totalChecks: number;
  /** Checks that failed. */
  failedChecks: number;
}

export interface DataContractCheck {
  check: string;
  passed: boolean;
  detail: string;
  severity: 'hard' | 'soft';
}

// ─── Report Provenance ───────────────────────────────────────────────────────

/**
 * Provenance record for a reported metric.
 * Links a reported value back to its source in execution evidence.
 */
export interface MetricProvenance {
  /** The reported metric field name. */
  metric: string;
  /** How this value was derived from execution data. */
  aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last' | 'direct';
  /** Source column in execution evidence. */
  sourceColumn: string;
  /** The computed value from execution evidence. */
  computedValue: number;
  /** The value reported in the report section. */
  reportedValue: number;
  /** Whether the reported value matches the computed value (within tolerance). */
  matches: boolean;
}

// ─── Report Contracts ────────────────────────────────────────────────────────

export interface ReportSection {
  /** Section identifier. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Whether this section is mandatory. */
  required: boolean;
  /** Expected content type. */
  contentType: 'narrative' | 'table' | 'metric' | 'disclaimer';
  /** If metric: expected numeric reference field in the data. */
  numericReference?: string;
  /** Expected aggregation method for numeric references. */
  expectedAggregation?: MetricProvenance['aggregation'];
}

export interface ReportContract {
  /** Report type identifier. */
  reportType: string;
  /** Required sections. */
  sections: ReportSection[];
  /** Required metadata fields in the report. */
  requiredMetadata: string[];
}

export interface GeneratedReport {
  /** Report type. */
  reportType: string;
  /** Metadata (author, date, version, etc.). */
  metadata: Record<string, string>;
  /** Report sections. */
  sections: GeneratedReportSection[];
}

export interface GeneratedReportSection {
  id: string;
  title: string;
  contentType: 'narrative' | 'table' | 'metric' | 'disclaimer';
  content: string;
  /** Numeric values referenced in this section (for cross-check against data). */
  numericValues?: Record<string, number>;
}

export interface ReportValidationResult {
  result: 'pass' | 'fail' | 'warn';
  checks: ReportValidationCheck[];
  totalChecks: number;
  failedChecks: number;
  /** Provenance records for numeric cross-references. */
  provenance: MetricProvenance[];
}

export interface ReportValidationCheck {
  check: string;
  passed: boolean;
  detail: string;
}

// ─── Audit Trail (v2) ────────────────────────────────────────────────────────

/** Evidence category for audit entries. */
export type AuditCategory = 'governance' | 'execution' | 'validation' | 'decision' | 'oversight' | 'lifecycle';

export interface AuditEntry {
  /** Monotonic sequence number. */
  seq: number;
  /** ISO timestamp. */
  timestamp: string;
  /** Stage that produced this entry. */
  stage: string;
  /** What happened. */
  action: string;
  /** Evidence category. */
  category: AuditCategory;
  /** Truncated SHA-256 evidence hash (16 hex chars). Chain uses truncated hashes throughout. */
  evidenceHash: string;
  /** Previous entry's evidence hash (truncated). Genesis uses hash of runId. */
  previousHash: string;
  /** Structured detail. */
  detail: Record<string, unknown>;
}

export interface AuditTrail {
  runId: string;
  entries: AuditEntry[];
  /**
   * Whether the truncated-SHA-256 hash chain is intact (verified on finalization).
   * Hash truncation to 16 hex chars (64 bits) is sufficient for tamper evidence
   * in an audit context but is NOT cryptographically equivalent to full SHA-256.
   */
  chainIntact: boolean;
}

// ─── Human Oversight ─────────────────────────────────────────────────────────

/** Whether human approval is required, completed, or not applicable. */
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface HumanOversight {
  /** Whether this run requires human approval based on materiality tier. */
  required: boolean;
  /** Reason why approval is required (or why it is not). */
  reason: string;
  /** Current approval status. */
  status: ApprovalStatus;
  /** Reviewer identity (role, not person — e.g., 'risk_officer', 'compliance_reviewer'). */
  reviewerRole?: string;
  /** Approval/rejection reason from the reviewer. */
  reviewNote?: string;
  /** ISO timestamp of the approval/rejection decision. */
  decisionTimestamp?: string;
}

// ─── Lineage Evidence ────────────────────────────────────────────────────────

/**
 * Lineage evidence for a financial run.
 * Answers: what source objects were touched, what output was produced,
 * which metrics came from which evidence, and which decision followed.
 *
 * Inspired by OpenLineage facets, implemented as a bounded Attestor-native structure.
 */
export interface LineageEvidence {
  /** Run identifier for traceability. */
  runId: string;
  /** Input artifacts. */
  inputs: LineageArtifact[];
  /** Output artifacts. */
  outputs: LineageArtifact[];
  /** Source-to-metric mappings (from report provenance). */
  metricMappings: MetricProvenance[];
  /** Whether all metric sections have provenance records. */
  provenanceComplete: boolean;
  /** Evidence chain summary: hash links between pipeline stages. */
  chainSummary: { stage: string; hash: string }[];
}

export interface LineageArtifact {
  /** Artifact type. */
  type: 'schema' | 'table' | 'query' | 'result_set' | 'report';
  /** Artifact name or identifier. */
  name: string;
  /** Truncated SHA-256 hash. */
  hash: string;
  /** Additional metadata. */
  metadata?: Record<string, unknown>;
}

// ─── Reconciliation Authority ────────────────────────────────────────────────

/**
 * Control total for reconciliation-first acceptance.
 * A control total is a mandatory balance check: if the total doesn't match,
 * the run fails regardless of other structural correctness.
 */
export interface ControlTotal {
  /** Human-readable description. */
  description: string;
  /** Column to sum. */
  column: string;
  /** Expected total value. */
  expectedTotal: number;
  /** Acceptable variance (absolute). 0 = exact match required. */
  tolerance: number;
}

// ─── Review Policy ───────────────────────────────────────────────────────────

/** Escalation trigger — what evidence condition triggers review. */
export interface ReviewTrigger {
  /** Trigger identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Condition type. */
  condition:
    | 'materiality_high'
    | 'reconciliation_failure'
    | 'provenance_mismatch'
    | 'sensitive_schema_access'
    | 'audit_integrity_failure'
    | 'warning_count_exceeds'
    | 'control_total_breach';
  /** Threshold for count-based conditions. */
  threshold?: number;
}

export interface ReviewPolicyResult {
  /** Whether review is required by policy. */
  required: boolean;
  /** Whether the required review has been approved. */
  approved: boolean;
  /** Whether the required review has been explicitly rejected. */
  rejected: boolean;
  /** Which triggers fired. */
  triggeredBy: string[];
  /** Explanation for the escalation decision. */
  reason: string;
}

// ─── Replay Benchmark ────────────────────────────────────────────────────────

export type BenchmarkCategory =
  | 'sql_safety'
  | 'data_quality'
  | 'reconciliation'
  | 'report_structure'
  | 'provenance'
  | 'oversight'
  | 'lineage'
  | 'pass';

export interface BenchmarkScenario {
  /** Unique scenario identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Governance category being tested. */
  category: BenchmarkCategory;
  /** Expected failure mode (null = expected pass). */
  expectedFailureMode: string | null;
  /** Expected final decision. */
  expectedDecision: FinancialDecision;
  /** Expected failing scorer (if applicable). */
  expectedFailingScorer?: string;
}


// --- Evidence Chain ---

export interface EvidenceChainLink {
  stage: string;
  artifactType: string;
  hash: string;
  previousHash: string;
}

export interface EvidenceChain {
  runId: string;
  links: EvidenceChainLink[];
  rootHash: string;
  terminalHash: string;
  length: number;
  intact: boolean;
}

// --- Independence Proof ---

export interface IndependenceProof {
  generator: { component: string; role: string };
  validators: Array<{ component: string; role: string; scope: string }>;
  escalation: { component: string; role: string };
  auditRecorder: { component: string; role: string };
  overlapDetected: boolean;
  summary: string;
}

// --- Timeliness Proof ---

export interface StageTimingEntry {
  stage: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface TimelinessProof {
  totalDurationMs: number;
  stages: StageTimingEntry[];
  controlledAggregationMs: number;
  validationMs: number;
  scoringMs: number;
}

// --- Reconciliation Authority ---

export type ReconciliationClass =
  | 'exact_balance'
  | 'tolerance_balance'
  | 'variance_explanation_required'
  | 'control_total_only'
  | 'aggregate_crosscheck';

export type BreakHandling = 'hard_stop' | 'reviewable_variance' | 'informational' | 'explanation_required' | 'approval_required';

export interface ReconciliationBreak {
  check: string;
  description: string;
  expected: number | string;
  actual: number | string;
  variance: number | string;
  tolerance: number | string;
  column: string;
  severity: 'hard' | 'soft';
  /** Reconciliation class of this check. */
  reconClass: ReconciliationClass;
  /** How this break should be handled. */
  handling: BreakHandling;
  /** Whether review was escalated for this break. */
  reviewEscalated: boolean;
  /** Snapshot identity tied to this break. */
  snapshotHash: string | null;
}

export interface BreakReport {
  hasBreaks: boolean;
  totalBreaks: number;
  breaks: ReconciliationBreak[];
  reviewRequired: boolean;
  /** Hard stops that must block the run. */
  hardStops: number;
  /** Reviewable variances that can proceed with approval. */
  reviewableVariances: number;
  /** Informational mismatches noted but non-blocking. */
  informational: number;
}

// --- Replay Metadata ---

export interface ReplayMetadata {
  /** Run-instance identity (includes runId — unique per run). */
  runIdentity: string;
  /** Replay-equivalence identity (excludes runId — stable across replays of same scenario). */
  replayIdentity: string;
  /** Backward-compatible hash of the input evidence set (fixtures offline, snapshot sources live). */
  fixtureHash: string;
  /** Hash of the decision. */
  decisionHash: string;
  /** Whether this run is replay-stable (same replayIdentity → same decision). */
  replayStable: boolean;
}

// --- Policy & Entitlement ---

export type PolicyVerdict = 'allowed' | 'denied' | 'restricted';

export interface PolicyDecision {
  reference: string;
  schema: string | null;
  table: string;
  verdict: PolicyVerdict;
  reason: string;
}

export interface PolicyResult {
  /** Overall policy verdict. */
  result: 'pass' | 'fail';
  /** Per-reference decisions. */
  decisions: PolicyDecision[];
  /** Whether least-privilege boundaries were preserved. */
  leastPrivilegePreserved: boolean;
  /** Summary explanation. */
  summary: string;
}

// --- Run Manifest ---

export interface RunManifest {
  runId: string;
  timestamp: string;
  decision: FinancialDecision;
  artifacts: {
    runReport: { present: true };
    outputPack: { present: boolean; hash: string | null };
    dossier: { present: boolean; hash: string | null };
    auditTrail: { entries: number; chainIntact: boolean; lastHash: string | null };
    lineage: { inputs: number; outputs: number; provenanceComplete: boolean };
  };
  liveProof: LiveProofMetadata;
  receipt: { receiptId: string; status: string } | null;
  capsule: { capsuleId: string; authorityState: string } | null;
  evidenceChainTerminal: string | null;
}

// --- Live Proof ---

export type ProofMode = 'offline_fixture' | 'mocked_model' | 'live_model' | 'live_runtime' | 'hybrid';

export interface ProofGap {
  category: string;
  description: string;
}

export interface LiveProofUpstreamEvidence {
  provider: string | null;
  model: string | null;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number | null;
  requestId: string | null;
  live: boolean;
}

export interface LiveProofExecutionEvidence {
  provider: string | null;
  mode: 'fixture' | 'sandbox' | 'live_db';
  latencyMs: number | null;
  live: boolean;
}

export interface LiveProofInput {
  collectedAt?: string;
  upstream?: Partial<LiveProofUpstreamEvidence>;
  execution?: Partial<LiveProofExecutionEvidence>;
  gaps?: ProofGap[];
}

export interface LiveProof {
  /** Explicit proof mode — what kind of runtime evidence exists. */
  mode: ProofMode;
  /** When proof was collected. */
  collectedAt: string;
  runId: string;
  replayIdentity: string;

  /** Upstream model evidence. */
  upstream: LiveProofUpstreamEvidence;

  /** Execution/database evidence. */
  execution: LiveProofExecutionEvidence;

  /** What is NOT proven in this run. */
  gaps: ProofGap[];

  /** Verification: does the proof-mode match the collected evidence? */
  consistent: boolean;
}

// Backward-compatible alias for manifest
export type LiveProofMetadata = LiveProof;

function deriveProofMode(upstream: LiveProofUpstreamEvidence, execution: LiveProofExecutionEvidence): ProofMode {
  if (upstream.live && execution.live) return 'hybrid';
  if (upstream.live) return 'live_model';
  if (execution.live) return 'live_runtime';
  return execution.mode === 'sandbox' ? 'mocked_model' : 'offline_fixture';
}

function deriveProofGaps(upstream: LiveProofUpstreamEvidence, execution: LiveProofExecutionEvidence): ProofGap[] {
  const gaps: ProofGap[] = [];

  if (!upstream.live) {
    gaps.push({
      category: 'model',
      description: execution.mode === 'sandbox'
        ? 'No live upstream model invocation — model path is mocked or simulated'
        : 'No live upstream model invocation — all model calls are mocked',
    });
  }

  if (!execution.live) {
    gaps.push({
      category: 'execution',
      description: execution.mode === 'sandbox'
        ? 'No live database execution — sandbox path only'
        : 'No live database execution — fixture-based sandbox only',
    });
  }

  if (!upstream.tokenUsage) {
    gaps.push({ category: 'cost', description: 'No real token/cost data observed for this run' });
  }

  return gaps;
}

function isLiveProofConsistent(proof: LiveProof): boolean {
  if (!proof.runId || !proof.replayIdentity || Number.isNaN(Date.parse(proof.collectedAt))) return false;

  if (proof.mode !== deriveProofMode(proof.upstream, proof.execution)) return false;

  if (proof.upstream.live && (!proof.upstream.provider || !proof.upstream.model)) return false;
  if (!proof.upstream.live && proof.upstream.requestId) return false;

  if (proof.execution.live) {
    if (proof.execution.mode !== 'live_db') return false;
    if (!proof.execution.provider) return false;
  } else if (proof.execution.mode === 'live_db') {
    return false;
  }

  if (proof.mode === 'hybrid') return proof.upstream.live && proof.execution.live;
  if (proof.mode === 'live_model') return proof.upstream.live && !proof.execution.live;
  if (proof.mode === 'live_runtime') return !proof.upstream.live && proof.execution.live;
  if (proof.mode === 'mocked_model') return !proof.upstream.live && !proof.execution.live && proof.execution.mode === 'sandbox';
  return !proof.upstream.live && !proof.execution.live && proof.execution.mode === 'fixture';
}

export function buildLiveProof(runId: string, replayIdentity: string, input: LiveProofInput = {}): LiveProof {
  const upstream: LiveProofUpstreamEvidence = {
    provider: null,
    model: null,
    tokenUsage: null,
    latencyMs: null,
    requestId: null,
    live: false,
    ...input.upstream,
  };

  const execution: LiveProofExecutionEvidence = {
    provider: null,
    mode: 'fixture',
    latencyMs: null,
    live: false,
    ...input.execution,
  };

  const proof: LiveProof = {
    mode: deriveProofMode(upstream, execution),
    collectedAt: input.collectedAt ?? new Date().toISOString(),
    runId,
    replayIdentity,
    upstream,
    execution,
    gaps: input.gaps ?? deriveProofGaps(upstream, execution),
    consistent: true,
  };

  return { ...proof, consistent: isLiveProofConsistent(proof) };
}

export function buildOfflineProof(runId: string, replayIdentity: string): LiveProof {
  return buildLiveProof(runId, replayIdentity);
}

/**
 * Verify that a LiveProof is internally consistent.
 * offline_fixture: upstream.live and execution.live must be false
 * live_model: upstream.live must be true
 * live_runtime: execution.live must be true
 */
export function verifyLiveProof(proof: LiveProof): boolean {
  return proof.consistent === isLiveProofConsistent(proof) && proof.consistent;
}

// ─── Live Proof v1.1 — Readiness Assessment ────────────────────────────────

/**
 * Live Readiness Assessment v1.1
 *
 * Truthfully evaluates what live-proof capabilities are available
 * in the current runtime environment. Does NOT fake any live evidence.
 *
 * A reviewer should be able to answer from this artifact:
 * - what was truly live?
 * - what remained offline?
 * - what proof gaps remain?
 * - what external dependencies are still missing?
 * - whether this was a real live exercise or only a readiness result
 */
export interface LiveReadinessResult {
  /** Version of the readiness assessment. */
  version: '1.1';
  /** When the readiness assessment was performed. */
  assessedAt: string;
  /** Whether this is a real live exercise result or only a readiness check. */
  exerciseType: 'readiness_only' | 'live_exercise';
  /** Upstream model credential availability. */
  upstream: {
    openaiAvailable: boolean;
    anthropicAvailable: boolean;
    anyModelAvailable: boolean;
    detail: string;
  };
  /** Execution/database credential availability. */
  execution: {
    liveDbAvailable: boolean;
    sandboxAvailable: boolean;
    detail: string;
  };
  /** What could be exercised right now. */
  availableModes: ProofMode[];
  /** What is blocked and why. */
  blockedModes: Array<{ mode: ProofMode; reason: string }>;
  /** Explicit next steps for a reviewer or operator. */
  nextSteps: string[];
  /** Whether authority semantics would change if live proof were available. */
  authorityImpact: string;
}

export interface LiveReadinessOptions {
  exerciseType?: 'readiness_only' | 'live_exercise';
  liveDbAvailable?: boolean;
  sandboxAvailable?: boolean;
}

/**
 * Assess live-proof readiness by checking environment for credentials.
 * Does NOT call any external APIs — only checks presence of env vars.
 */
export function assessLiveReadiness(options: LiveReadinessOptions = {}): LiveReadinessResult {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const openaiAvailable = !!openaiKey && !openaiKey.includes('your-') && openaiKey.length > 10;
  const anthropicAvailable = !!anthropicKey && !anthropicKey.includes('your-') && anthropicKey.length > 10;
  const anyModelAvailable = openaiAvailable || anthropicAvailable;

  const liveDbAvailable = options.liveDbAvailable ?? false;
  const sandboxAvailable = options.sandboxAvailable ?? false;

  const availableModes: ProofMode[] = ['offline_fixture'];
  const blockedModes: Array<{ mode: ProofMode; reason: string }> = [];

  if (anyModelAvailable) {
    availableModes.push('live_model');
    if (sandboxAvailable) availableModes.push('mocked_model');
    if (liveDbAvailable) availableModes.push('hybrid');
  } else {
    blockedModes.push({ mode: 'live_model', reason: 'No model API credentials found in environment (OPENAI_API_KEY, ANTHROPIC_API_KEY)' });
    blockedModes.push({ mode: 'hybrid', reason: 'Requires both model credentials and live DB — neither available' });
  }

  if (liveDbAvailable) {
    availableModes.push('live_runtime');
  } else {
    blockedModes.push({ mode: 'live_runtime', reason: 'No live database connection configured' });
  }

  if (!anyModelAvailable && !sandboxAvailable) {
    blockedModes.push({ mode: 'mocked_model', reason: 'No sandbox execution environment configured' });
  }

  const nextSteps: string[] = [];
  if (!anyModelAvailable) nextSteps.push('Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env to enable live_model proof');
  if (!liveDbAvailable) nextSteps.push('Configure a live database connection to enable live_runtime proof');
  if (anyModelAvailable && !liveDbAvailable) nextSteps.push('Model credentials available — run a bounded live_model exercise as the next highest-value step');
  if (!anyModelAvailable && !liveDbAvailable) nextSteps.push('Current environment supports offline_fixture only — all committed runs remain truthfully offline');

  const upstreamDetail = anyModelAvailable
    ? `Available: ${[openaiAvailable ? 'OpenAI' : null, anthropicAvailable ? 'Anthropic' : null].filter(Boolean).join(', ')}`
    : 'No model API credentials found';

  return {
    version: '1.1',
    assessedAt: new Date().toISOString(),
    exerciseType: options.exerciseType ?? 'readiness_only',
    upstream: {
      openaiAvailable,
      anthropicAvailable,
      anyModelAvailable,
      detail: upstreamDetail,
    },
    execution: {
      liveDbAvailable,
      sandboxAvailable,
      detail: liveDbAvailable ? 'Live DB available' : 'No live database — fixture execution only',
    },
    availableModes,
    blockedModes,
    nextSteps,
    authorityImpact: 'Missing live proof does not deny authority. Authority chain (warrant → escrow → receipt → capsule) operates independently of proof mode. Live proof is a truthfulness artifact, not an authority gate.',
  };
}

/**
 * Build a reviewer-facing live proof summary string.
 * Answers: what was truly live, what remained offline, what gaps remain.
 */
export function buildLiveProofReviewerSummary(proof: LiveProof, readiness?: LiveReadinessResult): string {
  const lines: string[] = [];
  lines.push(`Proof mode: ${proof.mode}`);
  lines.push(`Upstream live: ${proof.upstream.live}${proof.upstream.provider ? ` (${proof.upstream.provider}/${proof.upstream.model})` : ''}`);
  lines.push(`Execution live: ${proof.execution.live}${proof.execution.provider ? ` (${proof.execution.provider})` : ''}`);
  lines.push(`Consistent: ${proof.consistent}`);

  if (proof.gaps.length > 0) {
    lines.push(`Gaps (${proof.gaps.length}):`);
    for (const gap of proof.gaps) {
      lines.push(`  - [${gap.category}] ${gap.description}`);
    }
  } else {
    lines.push('Gaps: none');
  }

  if (readiness) {
    lines.push('');
    lines.push(`Readiness: ${readiness.exerciseType}`);
    lines.push(`Available modes: ${readiness.availableModes.join(', ')}`);
    if (readiness.blockedModes.length > 0) {
      lines.push(`Blocked modes:`);
      for (const b of readiness.blockedModes) {
        lines.push(`  - ${b.mode}: ${b.reason}`);
      }
    }
    if (readiness.nextSteps.length > 0) {
      lines.push(`Next steps:`);
      for (const s of readiness.nextSteps) {
        lines.push(`  - ${s}`);
      }
    }
  }

  return lines.join('\n');
}


// ─── Financial Scoring ───────────────────────────────────────────────────────

export interface FinancialScore {
  scorer: string;
  value: boolean | 'warn' | 'skip';
  verdict: string;
  explanation: string;
}

export type FinancialDecision = 'pass' | 'fail' | 'warn' | 'block' | 'pending_approval' | 'rejected';

export interface FinancialScoringResult {
  decision: FinancialDecision;
  scores: FinancialScore[];
  scorersRun: number;
}

export interface OutputPack {
  version: '1.0';
  generatedAt: string;
  runId: string;
  decision: string;
  summary: PackSummary;
  sqlGovernance: PackSqlGovernance;
  execution: PackExecution | null;
  dataContracts: PackDataContracts | null;
  reportProvenance: PackProvenance | null;
  lineage: PackLineage;
  policy: PackPolicy | null;
  guardrails: PackGuardrails | null;
  snapshot: PackSnapshot;
  breakOps: PackBreakOps;
  reviewPolicy: PackReviewPolicy;
  oversight: PackOversight;
  auditIntegrity: PackAuditIntegrity;
  warrant: { warrantId: string; status: string; trustLevel: string; contractHash: string; snapshotHash: string; pathStages: number; obligationsFulfilled: number; obligationsTotal: number; violations: string[] };
  escrow: { state: string; released: number; total: number; reviewHeld: boolean; reason: string };
  receipt: { receiptId: string; status: string; decision: string; warrantId: string; signatureMode: string; issuanceReason: string } | null;
  capsule: { capsuleId: string; authorityState: string; decision: string; reason: string; hardFacts: number; advisorySignals: number } | null;
  liveProof: { mode: string; upstreamLive: boolean; executionLive: boolean; gaps: number; gapCategories: string[]; consistent: boolean; readiness: string | null; availableModes: string[] | null } | null;
  filingReadiness: FilingReadiness;
  regulatoryAlignment: RegulatoryAlignmentNote[];
}

export interface PackPolicy {
  result: string;
  leastPrivilegePreserved: boolean;
  deniedReferences: string[];
  restrictedReferences: string[];
}

export interface PackGuardrails {
  result: string;
  executionClass: string;
  failedChecks: string[];
}

export interface PackSnapshot {
  snapshotId: string;
  snapshotHash: string;
  version: string;
  fixtureCount: number;
  sourceKind?: 'fixture' | 'live_db';
  sourceCount?: number;
}

export interface PackBreakOps {
  hasBreaks: boolean;
  totalBreaks: number;
  hardStops: number;
  reviewableVariances: number;
  informational: number;
  breaks: Array<{
    check: string;
    reconClass: string;
    handling: string;
    expected: string | number;
    actual: string | number;
    variance: string | number;
    column: string;
  }>;
}

// --- Filing Readiness ---

export type ReadinessStatus = 'review_ready' | 'internal_report_ready' | 'filing_not_ready' | 'blocked';

export interface ReadinessGap {
  category: string;
  description: string;
  blocking: boolean;
}

export interface FilingReadiness {
  status: ReadinessStatus;
  gaps: ReadinessGap[];
  totalGaps: number;
  blockingGaps: number;
}

export interface PackSummary {
  queryType: string;
  description: string;
  materialityTier: string;
  decision: string;
  scorersRun: number;
  totalAuditEntries: number;
}

export interface PackSqlGovernance {
  result: string;
  gatesPassed: number;
  gatesTotal: number;
  failedGates: string[];
  referencedTables: string[];
  sqlHash: string;
}

export interface PackExecution {
  success: boolean;
  rowCount: number;
  columns: string[];
  schemaHash: string;
  error: string | null;
}

export interface PackDataContracts {
  result: string;
  totalChecks: number;
  failedChecks: number;
  controlTotalChecks: number;
  failures: string[];
}

export interface PackProvenance {
  totalRecords: number;
  allMatch: boolean;
  records: MetricProvenance[];
}

export interface PackLineage {
  inputCount: number;
  outputCount: number;
  metricMappings: number;
  provenanceComplete: boolean;
}

export interface PackReviewPolicy {
  required: boolean;
  approved: boolean;
  rejected: boolean;
  triggeredBy: string[];
  reason: string;
}

export interface PackOversight {
  required: boolean;
  status: string;
  reviewerRole: string | null;
  reviewNote: string | null;
}

export interface PackAuditIntegrity {
  chainIntact: boolean;
  totalEntries: number;
}

export interface RegulatoryAlignmentNote {
  framework: string;
  principle: string;
  relevance: string;
}

// --- Verification Sub-Results ---

export interface VerificationSubResults {
  chainLinkage: boolean;
  canonicalArtifacts: boolean;
  signatureVerified: boolean | null;
  overall: 'passed' | 'partial' | 'failed' | 'unsigned';
  trustModel: string;
}

// --- Decision Dossier ---

export interface DossierSummarySection {
  category: string;
  status: string;
  detail: string;
}

export interface DecisionDossier {
  runId: string;
  generatedAt: string;
  decision: string;
  timeline: DossierEvent[];
  criticalEvidence: DossierEvidence[];
  blockers: DossierBlocker[];
  reviewPath: DossierReviewPath;
  unresolvedRisks: string[];
  artifactHashes: Record<string, string>;
  /** Reviewer packet sections: filing, break, policy, guardrails, snapshot, attestation, interop. */
  reviewerSummary: DossierSummarySection[];
}

export interface DossierEvent {
  seq: number;
  stage: string;
  outcome: string;
  significance: 'routine' | 'notable' | 'critical';
}

export interface DossierEvidence {
  scorer: string;
  value: string;
  verdict: string;
  significance: 'passed' | 'failed' | 'warning' | 'skipped';
}

export interface DossierBlocker {
  source: string;
  reason: string;
}

export interface DossierReviewPath {
  required: boolean;
  triggers: string[];
  outcome: 'not_required' | 'pending' | 'approved' | 'rejected';
  reviewerRole: string | null;
  reviewNote: string | null;
}

// ─── Financial Run Report ────────────────────────────────────────────────────

export interface FinancialRunReport {
  runId: string;
  timestamp: string;
  durationMs: number;
  queryIntent: FinancialQueryIntent;
  sqlGovernance: SqlGovernanceResult;
  execution: ExecutionEvidence | null;
  dataContract: DataContractResult | null;
  reportValidation: ReportValidationResult | null;
  scoring: FinancialScoringResult;
  audit: AuditTrail;
  oversight: HumanOversight;
  lineage: LineageEvidence;
  reviewPolicy: ReviewPolicyResult;
  outputPack: OutputPack;
  dossier: DecisionDossier;
  manifest: RunManifest;
  warrant: FinancialWarrant;
  policyResult: PolicyResult;
  guardrailResult: GuardrailResult;
  snapshot: SnapshotIdentity;
  evidenceChain: EvidenceChain;
  independenceProof: IndependenceProof;
  timelinessProof: TimelinessProof;
  breakReport: BreakReport;
  replayMetadata: ReplayMetadata;
  filingReadiness: FilingReadiness;
  attestation: import('./attestation.js').AttestationPack | null;
  escrow: AuthorityEscrow;
  receipt: import('./receipt.js').WarrantReceipt | null;
  capsule: import('./capsule.js').DecisionCapsule | null;
  liveProof: LiveProof;
  liveReadiness: LiveReadinessResult | null;
  openLineageExport: import('./openlineage.js').OpenLineageExport | null;
  /** Ed25519-signed portable attestation certificate. Null if no signing key was provided. */
  certificate: import('../signing/certificate.js').AttestationCertificate | null;
  /** Predictive guardrail preflight result (Postgres only). Null for fixture/SQLite runs. */
  predictiveGuardrail: import('../connectors/predictive-guardrails.js').PredictiveGuardrailResult | null;
  /** Semantic clause evaluation results. Null if no clauses defined. */
  semanticClauses: SemanticClauseResult | null;
  /** Final disposition. */
  decision: FinancialDecision;
}

// ─── Semantic Clauses ────────────────────────────────────────────────────────

/**
 * Semantic clause: a machine-checkable analytical obligation.
 *
 * Goes beyond SQL-shape governance: these define what the NUMBERS must satisfy,
 * not just what the QUERY must look like.
 */
export type SemanticClauseType = 'balance_identity' | 'control_total' | 'ratio_bound' | 'sign_constraint' | 'completeness_check';

export interface SemanticClause {
  /** Unique clause ID. */
  id: string;
  /** Clause type. */
  type: SemanticClauseType;
  /** Human-readable description. */
  description: string;
  /** The formal expression (e.g., "net = gross_long - gross_short"). */
  expression: string;
  /** Column names involved. */
  columns: string[];
  /** Tolerance for numeric checks (0 = exact). */
  tolerance: number;
  /** Severity: hard = blocks, soft = warns. */
  severity: 'hard' | 'soft';
}

export interface SemanticClauseEvaluation {
  clause: SemanticClause;
  passed: boolean;
  /** Computed values from actual data. */
  observed: Record<string, number>;
  /** Expected relationship. */
  expected: string;
  /** Variance if applicable. */
  variance: number | null;
  /** Explanation. */
  explanation: string;
}

export interface SemanticClauseResult {
  performed: boolean;
  clauseCount: number;
  passCount: number;
  failCount: number;
  hardFailCount: number;
  evaluations: SemanticClauseEvaluation[];
}
