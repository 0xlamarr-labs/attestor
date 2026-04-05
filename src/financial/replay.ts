/**
 * Replay Corpus / Benchmark Harness v1.
 *
 * Runs a corpus of benchmark scenarios through the financial pipeline
 * and produces a structured summary: pass/fail by scenario,
 * decision match vs expected, and failure mode verification.
 *
 * This is a governance asset: it proves that the authority stack
 * produces correct decisions across a known set of scenarios.
 */

import type {
  BenchmarkScenario,
  FinancialRunReport,
  FinancialDecision,
} from './types.js';
import { runFinancialPipeline, type FinancialPipelineInput } from './pipeline.js';

export interface BenchmarkResult {
  scenario: BenchmarkScenario;
  report: FinancialRunReport;
  decisionMatch: boolean;
  scorerMatch: boolean;
  detail: string;
}

export interface BenchmarkSummary {
  totalScenarios: number;
  passed: number;
  failed: number;
  results: BenchmarkResult[];
}

export interface BenchmarkEntry {
  scenario: BenchmarkScenario;
  input: FinancialPipelineInput;
}

/**
 * Run a complete benchmark corpus and produce a structured summary.
 */
export function runBenchmarkCorpus(entries: BenchmarkEntry[]): BenchmarkSummary {
  const results: BenchmarkResult[] = [];

  for (const entry of entries) {
    const report = runFinancialPipeline(entry.input);

    const decisionMatch = report.decision === entry.scenario.expectedDecision;

    // Check if the expected failing scorer actually failed (if specified)
    let scorerMatch = true;
    if (entry.scenario.expectedFailingScorer) {
      const failingScorers = report.scoring.scores
        .filter((s) => s.value === false)
        .map((s) => s.scorer);
      scorerMatch = failingScorers.includes(entry.scenario.expectedFailingScorer);
    }

    const allMatch = decisionMatch && scorerMatch;

    results.push({
      scenario: entry.scenario,
      report,
      decisionMatch,
      scorerMatch,
      detail: allMatch
        ? `✓ ${entry.scenario.id}: decision=${report.decision} (expected ${entry.scenario.expectedDecision})`
        : `✗ ${entry.scenario.id}: decision=${report.decision} (expected ${entry.scenario.expectedDecision})${!scorerMatch ? `, expected scorer ${entry.scenario.expectedFailingScorer} to fail` : ''}`,
    });
  }

  return {
    totalScenarios: entries.length,
    passed: results.filter((r) => r.decisionMatch && r.scorerMatch).length,
    failed: results.filter((r) => !r.decisionMatch || !r.scorerMatch).length,
    results,
  };
}
