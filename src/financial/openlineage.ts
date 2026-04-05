/**
 * OpenLineage / Interop Export v1 — Bounded interoperable lineage export.
 *
 * Inspired by OpenLineage spec (run/job/dataset model with custom facets).
 * Produces a structured export suitable for integration with lineage platforms
 * (Marquez, DataHub, Atlan, etc.) without requiring those tools at runtime.
 *
 * Handles blocked/pre-execution-failed runs truthfully:
 * even if no execution output exists, the export captures request identity,
 * pre-execution decisions, denied objects, and why no output was produced.
 */

import type { FinancialRunReport } from './types.js';

/**
 * Schema URL base for Attestor custom OpenLineage facets.
 * Points to in-repo schema files. These are not externally hosted —
 * the URL is a stable reference to the schema definition in the repository.
 */
const SCHEMA_BASE = 'https://raw.githubusercontent.com/0xlamarr-labs/attestor/master/schemas/openlineage';
const PRODUCER = 'https://github.com/0xlamarr-labs/attestor';

/** Standard OpenLineage facet metadata fields. */
interface FacetMeta {
  _schemaURL: string;
  _producer: string;
}

export interface OpenLineageExport {
  /** OpenLineage event type. */
  eventType: 'COMPLETE' | 'FAIL' | 'ABORT';
  eventTime: string;

  run: {
    runId: string;
    replayIdentity: string;
    snapshotHash: string;
    decision: string;
  };

  job: {
    namespace: 'attestor.financial';
    name: string;
    queryType: string;
  };

  inputs: Array<{
    namespace: string;
    name: string;
    facets: Record<string, unknown>;
  }>;

  outputs: Array<{
    namespace: string;
    name: string;
    facets: Record<string, unknown>;
  }>;

  /** Custom facets for Attestor-specific governance evidence. */
  facets: {
    attestor_policy: FacetMeta & {
      result: string;
      leastPrivilegePreserved: boolean;
      deniedReferences: string[];
    };
    attestor_guardrails: FacetMeta & {
      result: string;
      executionClass: string;
      failedChecks: string[];
    };
    attestor_breakOps: FacetMeta & {
      hasBreaks: boolean;
      hardStops: number;
      reviewableVariances: number;
    };
    attestor_filingReadiness: FacetMeta & {
      status: string;
      blockingGaps: number;
    };
    attestor_oversight: FacetMeta & {
      required: boolean;
      status: string;
      reviewerRole: string | null;
    };
    attestor_attestation: FacetMeta & {
      evidenceChainTerminal: string;
      auditChainIntact: boolean;
      verificationResult: string;
    };
    attestor_liveProof: FacetMeta & {
      mode: string;
      upstreamLive: boolean;
      executionLive: boolean;
      consistent: boolean;
      gaps: string[];
    };
  };
}

/**
 * Export a financial run as an OpenLineage-compatible event.
 */
export function buildOpenLineageExport(report: FinancialRunReport): OpenLineageExport {
  const isBlocked = report.decision === 'block';
  const isFailed = report.decision === 'fail' || report.decision === 'rejected';

  return {
    eventType: isBlocked ? 'ABORT' : isFailed ? 'FAIL' : 'COMPLETE',
    eventTime: report.timestamp,

    run: {
      runId: report.runId,
      replayIdentity: report.replayMetadata.replayIdentity,
      snapshotHash: report.snapshot.snapshotHash,
      decision: report.decision,
    },

    job: {
      namespace: 'attestor.financial',
      name: `financial_${report.queryIntent.queryType}`,
      queryType: report.queryIntent.queryType,
    },

    inputs: report.sqlGovernance.referencedTables.map((ref) => ({
      namespace: ref.schema ?? 'unknown',
      name: ref.table,
      facets: { context: ref.context, reference: ref.reference },
    })),

    outputs: report.execution ? [{
      namespace: 'attestor.result',
      name: `result_${report.execution.columns.length}cols_${report.execution.rowCount}rows`,
      facets: { schemaHash: report.execution.schemaHash, rowCount: report.execution.rowCount },
    }] : [],

    facets: {
      attestor_policy: {
        _schemaURL: `${SCHEMA_BASE}/AttestorPolicyRunFacet.json`,
        _producer: PRODUCER,
        result: report.policyResult.result,
        leastPrivilegePreserved: report.policyResult.leastPrivilegePreserved,
        deniedReferences: report.policyResult.decisions.filter((d) => d.verdict === 'denied').map((d) => d.reference),
      },
      attestor_guardrails: {
        _schemaURL: `${SCHEMA_BASE}/AttestorGuardrailsRunFacet.json`,
        _producer: PRODUCER,
        result: report.guardrailResult.result,
        executionClass: report.guardrailResult.executionClass,
        failedChecks: report.guardrailResult.checks.filter((c) => !c.passed).map((c) => c.check),
      },
      attestor_breakOps: {
        _schemaURL: `${SCHEMA_BASE}/AttestorBreakOpsRunFacet.json`,
        _producer: PRODUCER,
        hasBreaks: report.breakReport.hasBreaks,
        hardStops: report.breakReport.hardStops,
        reviewableVariances: report.breakReport.reviewableVariances,
      },
      attestor_filingReadiness: {
        _schemaURL: `${SCHEMA_BASE}/AttestorFilingReadinessRunFacet.json`,
        _producer: PRODUCER,
        status: report.filingReadiness.status,
        blockingGaps: report.filingReadiness.blockingGaps,
      },
      attestor_oversight: {
        _schemaURL: `${SCHEMA_BASE}/AttestorOversightRunFacet.json`,
        _producer: PRODUCER,
        required: report.oversight.required,
        status: report.oversight.status,
        reviewerRole: report.oversight.reviewerRole ?? null,
      },
      attestor_attestation: {
        _schemaURL: `${SCHEMA_BASE}/AttestorAttestationRunFacet.json`,
        _producer: PRODUCER,
        evidenceChainTerminal: report.evidenceChain.terminalHash,
        auditChainIntact: report.audit.chainIntact,
        verificationResult: report.evidenceChain.intact ? 'passed' : 'failed',
      },
      attestor_liveProof: {
        _schemaURL: `${SCHEMA_BASE}/AttestorLiveProofRunFacet.json`,
        _producer: PRODUCER,
        mode: report.liveProof.mode,
        upstreamLive: report.liveProof.upstream.live,
        executionLive: report.liveProof.execution.live,
        consistent: report.liveProof.consistent,
        gaps: report.liveProof.gaps.map((gap) => gap.category),
      },
    },
  };
}
