/**
 * Challenge / Differential Reconciliation Harness v1.
 *
 * Tests reconciliation authority across a spectrum of scenarios:
 * exact match, within-tolerance, above-tolerance, provenance-consistent
 * but control-total-inconsistent, and snapshot-changed cases.
 *
 * This is a governance asset: it proves the reconciliation authority
 * correctly classifies and handles each break type.
 */

import { runFinancialPipeline, type FinancialPipelineInput } from './pipeline.js';
import type { FinancialRunReport, ReconciliationClass, BreakHandling } from './types.js';

export interface ChallengeScenario {
  id: string;
  description: string;
  reconClass: ReconciliationClass;
  expectedDecision: string;
  expectedBreakCount: number;
  expectedHandling: BreakHandling | null;
}

export interface ChallengeResult {
  scenario: ChallengeScenario;
  report: FinancialRunReport;
  decisionMatch: boolean;
  breakCountMatch: boolean;
  handlingMatch: boolean;
  detail: string;
}

export interface ChallengeSummary {
  totalScenarios: number;
  passed: number;
  failed: number;
  results: ChallengeResult[];
}

export interface ChallengeEntry {
  scenario: ChallengeScenario;
  input: FinancialPipelineInput;
}

/**
 * Run a reconciliation challenge corpus.
 */
export function runChallengeCorpus(entries: ChallengeEntry[]): ChallengeSummary {
  const results: ChallengeResult[] = [];

  for (const entry of entries) {
    const report = runFinancialPipeline(entry.input);
    const decisionMatch = report.decision === entry.scenario.expectedDecision;
    const breakCountMatch = report.breakReport.totalBreaks === entry.scenario.expectedBreakCount;

    let handlingMatch = true;
    if (entry.scenario.expectedHandling !== null && report.breakReport.breaks.length > 0) {
      handlingMatch = report.breakReport.breaks[0].handling === entry.scenario.expectedHandling;
    }

    const allMatch = decisionMatch && breakCountMatch && handlingMatch;

    results.push({
      scenario: entry.scenario,
      report,
      decisionMatch,
      breakCountMatch,
      handlingMatch,
      detail: allMatch
        ? `✓ ${entry.scenario.id}: ${entry.scenario.description}`
        : `✗ ${entry.scenario.id}: decision=${report.decision}(expected ${entry.scenario.expectedDecision}), breaks=${report.breakReport.totalBreaks}(expected ${entry.scenario.expectedBreakCount})`,
    });
  }

  return {
    totalScenarios: entries.length,
    passed: results.filter((r) => r.decisionMatch && r.breakCountMatch && r.handlingMatch).length,
    failed: results.filter((r) => !r.decisionMatch || !r.breakCountMatch || !r.handlingMatch).length,
    results,
  };
}
