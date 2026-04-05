/**
 * Financial Reference Implementation - operator CLI.
 *
 * Entry points:
 * - Run a named fixture scenario
 * - Run the full replay benchmark corpus
 * - Run a bounded local live scenario (model-generated SQL + local SQLite execution)
 *
 * Usage:
 *   npx tsx src/financial/cli.ts scenario <id>
 *   npx tsx src/financial/cli.ts live-scenario <id>
 *   npx tsx src/financial/cli.ts benchmark
 */

import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callGpt, GPT_MODEL } from '../api/openai.js';
import { runFinancialPipeline, type FinancialPipelineInput } from './pipeline.js';
import { runBenchmarkCorpus, type BenchmarkEntry } from './replay.js';
import { renderPackSummary } from './output-pack.js';
import { executeSqliteQuery, materializeSqliteFixtureDatabases, type SqliteSchemaBinding } from './execution.js';
import { governSql } from './sql-governance.js';
import type { FinancialRunReport, LiveProofInput } from './types.js';
import { generateKeyPair, loadPrivateKey, loadPublicKey, derivePublicKeyIdentity, type AttestorKeyPair } from '../signing/keys.js';
import { verifyCertificate } from '../signing/certificate.js';
import { buildVerificationKit } from '../signing/bundle.js';
import { runPostgresProve } from '../connectors/postgres-prove.js';
import { isPostgresConfigured } from '../connectors/postgres.js';
import {
  COUNTERPARTY_SQL, COUNTERPARTY_INTENT, COUNTERPARTY_FIXTURE,
  COUNTERPARTY_REPORT_CONTRACT, COUNTERPARTY_REPORT, COUNTERPARTY_LIVE_DATABASES,
  LIQUIDITY_SQL, LIQUIDITY_INTENT, LIQUIDITY_FIXTURE,
  RECON_SQL, RECON_INTENT, RECON_FIXTURE,
  UNSAFE_SQL_WRITE, UNSAFE_SQL_INJECTION,
  HIGH_MAT_INTENT,
  CONCENTRATION_SQL, CONCENTRATION_INTENT, CONCENTRATION_FIXTURE,
  CONTROL_TOTAL_INTENT,
} from './fixtures/scenarios.js';

type SqlGenerationMetadata = {
  provider: 'openai';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
};

type PersistedArtifactPaths = {
  runDir: string;
  report: string;
  outputPack: string;
  dossier: string;
  manifest: string;
  attestation: string | null;
  openLineage: string | null;
  candidateSql: string;
  sqlGeneration: string | null;
  snapshotDir: string | null;
};

type LiveScenarioDefinition = {
  description: string;
  buildInput: (runId: string, candidateSql: string, liveProof: LiveProofInput) => FinancialPipelineInput;
  buildSqlPrompt: () => { systemPrompt: string; userMessage: string };
};

const SCENARIOS: Record<string, { description: string; input: FinancialPipelineInput }> = {
  'counterparty': {
    description: 'Counterparty exposure summary (expected: pass)',
    input: { runId: 'cli-counterparty', intent: COUNTERPARTY_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT },
  },
  'liquidity': {
    description: 'Liquidity risk - negative value (expected: fail)',
    input: { runId: 'cli-liquidity', intent: LIQUIDITY_INTENT, candidateSql: LIQUIDITY_SQL, fixtures: [LIQUIDITY_FIXTURE] },
  },
  'recon': {
    description: 'Reconciliation variance - sum mismatch (expected: fail)',
    input: { runId: 'cli-recon', intent: RECON_INTENT, candidateSql: RECON_SQL, fixtures: [RECON_FIXTURE] },
  },
  'unsafe-sql': {
    description: 'Unsafe SQL - write operation (expected: block)',
    input: { runId: 'cli-unsafe', intent: COUNTERPARTY_INTENT, candidateSql: UNSAFE_SQL_WRITE, fixtures: [] },
  },
  'injection': {
    description: 'SQL injection attempt (expected: block)',
    input: { runId: 'cli-injection', intent: COUNTERPARTY_INTENT, candidateSql: UNSAFE_SQL_INJECTION, fixtures: [] },
  },
  'high-materiality': {
    description: 'High materiality - pending approval (expected: pending_approval)',
    input: { runId: 'cli-high-mat', intent: HIGH_MAT_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT },
  },
  'concentration': {
    description: 'Concentration limit breach (expected: pending_approval)',
    input: { runId: 'cli-concentration', intent: CONCENTRATION_INTENT, candidateSql: CONCENTRATION_SQL, fixtures: [CONCENTRATION_FIXTURE] },
  },
  'control-total': {
    description: 'Control total breach (expected: fail)',
    input: { runId: 'cli-control-total', intent: CONTROL_TOTAL_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT },
  },
};

const LIVE_SCENARIOS: Record<string, LiveScenarioDefinition> = {
  'counterparty': {
    description: 'Bounded local live counterparty exposure exercise (model SQL + local SQLite)',
    buildInput: (runId, candidateSql, liveProof) => ({
      runId,
      intent: COUNTERPARTY_INTENT,
      candidateSql,
      fixtures: [],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      liveProof,
    }),
    buildSqlPrompt: () => ({
      systemPrompt: [
        'You write exactly one read-only SQLite-compatible SQL query.',
        'Return SQL only. No markdown. No commentary. No prose.',
        'Use only a single SELECT statement.',
        'Do not use INSERT, UPDATE, DELETE, DROP, ALTER, PRAGMA, ATTACH, or multiple statements.',
        'Output columns must be exactly in this order: counterparty_name, exposure_usd, credit_rating, sector.',
      ].join(' '),
      userMessage: [
        `Goal: ${COUNTERPARTY_INTENT.description}`,
        'Allowed schema: risk',
        'Available table: risk.counterparty_exposures(counterparty_name TEXT, exposure_usd REAL, credit_rating TEXT, sector TEXT, reporting_date TEXT)',
        'Filter on reporting_date = "2026-03-28".',
        'Sort by exposure_usd descending.',
        'Do not aggregate. Return the detailed rows needed to prove the total exposure.',
        'The query should support these business constraints: at least 3 counterparties, non-negative exposure_usd, exposure_usd sum = 850000000.',
      ].join('\n'),
    }),
  },
};

const BENCHMARK_CORPUS: BenchmarkEntry[] = [
  { scenario: { id: 'BM-001', description: 'Counterparty pass', category: 'pass', expectedFailureMode: null, expectedDecision: 'pass' }, input: SCENARIOS['counterparty'].input },
  { scenario: { id: 'BM-002', description: 'Unsafe SQL block', category: 'sql_safety', expectedFailureMode: 'write_operation', expectedDecision: 'block', expectedFailingScorer: 'sql_safety' }, input: SCENARIOS['unsafe-sql'].input },
  { scenario: { id: 'BM-003', description: 'Data contract fail', category: 'data_quality', expectedFailureMode: 'negative_value', expectedDecision: 'fail', expectedFailingScorer: 'data_contracts' }, input: SCENARIOS['liquidity'].input },
  { scenario: { id: 'BM-004', description: 'Recon mismatch', category: 'reconciliation', expectedFailureMode: 'sum_not_zero', expectedDecision: 'fail', expectedFailingScorer: 'reconciliation' }, input: SCENARIOS['recon'].input },
  { scenario: { id: 'BM-005', description: 'High materiality pending', category: 'oversight', expectedFailureMode: null, expectedDecision: 'pending_approval' }, input: SCENARIOS['high-materiality'].input },
  { scenario: { id: 'BM-006', description: 'Control total breach', category: 'reconciliation', expectedFailureMode: 'control_total', expectedDecision: 'fail' }, input: SCENARIOS['control-total'].input },
];

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function estimateOpenAICostUsd(inputTokens: number, outputTokens: number, cachedInputTokens: number): number {
  const paidInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return roundUsd((paidInputTokens * 2.5 + outputTokens * 15) / 1_000_000);
}

function extractSql(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:sql)?\s*([\s\S]*?)```/iu);
  const raw = fenced ? fenced[1].trim() : trimmed.replace(/^sql:\s*/iu, '').trim();
  return raw.replace(/;+\s*$/u, '');
}

function looksCompleteSql(sql: string): boolean {
  if (!/^\s*select\b/iu.test(sql)) return false;
  return !/\b(select|from|where|join|and|or|order\s+by|group\s+by)\s*$/iu.test(sql.trim());
}

function persistFinancialArtifacts(
  report: FinancialRunReport,
  runDir: string,
  extras: { candidateSql: string; sqlGeneration?: SqlGenerationMetadata | null; snapshotDir?: string | null },
): PersistedArtifactPaths {
  mkdirSync(runDir, { recursive: true });

  const reportPath = join(runDir, 'report.json');
  const outputPackPath = join(runDir, 'output-pack.json');
  const dossierPath = join(runDir, 'dossier.json');
  const manifestPath = join(runDir, 'manifest.json');
  const attestationPath = report.attestation ? join(runDir, 'attestation.json') : null;
  const openLineagePath = report.openLineageExport ? join(runDir, 'openlineage.json') : null;
  const candidateSqlPath = join(runDir, 'candidate.sql');
  const sqlGenerationPath = extras.sqlGeneration ? join(runDir, 'sql-generation.json') : null;

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(outputPackPath, `${JSON.stringify(report.outputPack, null, 2)}\n`, 'utf8');
  writeFileSync(dossierPath, `${JSON.stringify(report.dossier, null, 2)}\n`, 'utf8');
  writeFileSync(manifestPath, `${JSON.stringify(report.manifest, null, 2)}\n`, 'utf8');
  writeFileSync(candidateSqlPath, `${extras.candidateSql.trim()}\n`, 'utf8');
  if (attestationPath && report.attestation) {
    writeFileSync(attestationPath, `${JSON.stringify(report.attestation, null, 2)}\n`, 'utf8');
  }
  if (openLineagePath && report.openLineageExport) {
    writeFileSync(openLineagePath, `${JSON.stringify(report.openLineageExport, null, 2)}\n`, 'utf8');
  }
  if (sqlGenerationPath && extras.sqlGeneration) {
    writeFileSync(sqlGenerationPath, `${JSON.stringify(extras.sqlGeneration, null, 2)}\n`, 'utf8');
  }

  return {
    runDir,
    report: reportPath,
    outputPack: outputPackPath,
    dossier: dossierPath,
    manifest: manifestPath,
    attestation: attestationPath,
    openLineage: openLineagePath,
    candidateSql: candidateSqlPath,
    sqlGeneration: sqlGenerationPath,
    snapshotDir: extras.snapshotDir ?? null,
  };
}

function printReportSummary(report: FinancialRunReport): void {
  console.log(`  Decision: ${report.decision.toUpperCase()}`);
  console.log(`  Scorers: ${report.scoring.scorersRun} ran`);
  console.log(`  Audit: ${report.audit.entries.length} entries, chain ${report.audit.chainIntact ? 'intact' : 'BROKEN'}`);
  console.log(`  Lineage: ${report.lineage.inputs.length} inputs, ${report.lineage.outputs.length} outputs`);
  console.log(`  Review: ${report.reviewPolicy.required ? `required (${report.reviewPolicy.triggeredBy.join(', ')})` : 'not required'}`);
  console.log(`  Manifest: ${report.manifest.artifacts.outputPack.present ? 'output pack' : '-'}, ${report.manifest.artifacts.dossier.present ? 'dossier' : '-'}`);
  console.log(`  Mode: ${report.liveProof.mode} (upstream_live=${report.liveProof.upstream.live}, execution_live=${report.liveProof.execution.live}, gaps=${report.liveProof.gaps.length})`);
}

function runScenario(id: string): void {
  const scenario = SCENARIOS[id];
  if (!scenario) {
    console.error(`Unknown scenario "${id}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n  Attestor Financial - Running scenario: ${id}`);
  console.log(`  ${scenario.description}\n`);

  const report = runFinancialPipeline(scenario.input);
  printReportSummary(report);

  if (report.reportValidation) {
    console.log(`\n${renderPackSummary(report.outputPack)}`);
  }
}

async function generateLiveCounterpartySql(bindings: SqliteSchemaBinding[]): Promise<{ sql: string; proof: LiveProofInput; metadata: SqlGenerationMetadata }> {
  const basePrompt = LIVE_SCENARIOS['counterparty'].buildSqlPrompt();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedInputTokens = 0;
  let totalLatencyMs = 0;
  let repairHint: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const start = Date.now();
    const result = await callGpt({
      stage: 'financial_live_sql',
      systemPrompt: repairHint
        ? `${basePrompt.systemPrompt} Previous response was incomplete or invalid. Return one complete SQL query only.`
        : basePrompt.systemPrompt,
      userMessage: repairHint
        ? `${basePrompt.userMessage}\n\nRepair hint: ${repairHint}`
        : basePrompt.userMessage,
      effort: 'low',
      maxTokens: 600,
    });
    const latencyMs = Date.now() - start;
    const sql = extractSql(result.content);

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    totalCachedInputTokens += result.cachedInputTokens;
    totalLatencyMs += latencyMs;

    const governance = governSql(sql, COUNTERPARTY_INTENT);
    const executionPreflight = executeSqliteQuery(sql, { provider: 'sqlite', bindings });
    if (looksCompleteSql(sql) && governance.result === 'pass' && executionPreflight.success) {
      const estimatedCostUsd = estimateOpenAICostUsd(totalInputTokens, totalOutputTokens, totalCachedInputTokens);
      return {
        sql,
        proof: {
          upstream: {
            provider: 'openai',
            model: GPT_MODEL,
            tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
            latencyMs: totalLatencyMs,
            requestId: null,
            live: true,
          },
        },
        metadata: {
          provider: 'openai',
          model: GPT_MODEL,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cachedInputTokens: totalCachedInputTokens,
          latencyMs: totalLatencyMs,
          estimatedCostUsd,
        },
      };
    }

    repairHint = [
      !looksCompleteSql(sql) ? 'Query was incomplete or truncated.' : null,
      governance.result !== 'pass' ? `Governance failed: ${governance.gates.filter((gate) => !gate.passed).map((gate) => gate.detail).join(' | ')}` : null,
      !executionPreflight.success ? `SQLite execution failed: ${executionPreflight.error}` : null,
    ].filter(Boolean).join(' ');
  }

  throw new Error('Unable to produce a complete governance-safe SQL query after 2 attempts.');
}

async function runLiveScenario(id: string): Promise<void> {
  const scenario = LIVE_SCENARIOS[id];
  if (!scenario) {
    console.error(`Unknown live scenario "${id}". Available: ${Object.keys(LIVE_SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('your-')) {
    console.error('OPENAI_API_KEY is required for live financial SQL generation.');
    process.exit(1);
  }

  const runId = `financial-live-${id}-${randomUUID()}`;
  const runDir = join(process.cwd(), '.attestor-financial', 'runs', runId);
  const snapshotDir = join(runDir, 'snapshot');

  console.log(`\n  Attestor Financial - Running live scenario: ${id}`);
  console.log(`  ${scenario.description}`);
  console.log(`  Run ID: ${runId}\n`);

  const overallStart = Date.now();
  const snapshot = materializeSqliteFixtureDatabases(snapshotDir, COUNTERPARTY_LIVE_DATABASES);
  const generated = await generateLiveCounterpartySql(snapshot.bindings);
  const input = scenario.buildInput(runId, generated.sql, generated.proof);
  input.liveExecution = {
    provider: 'sqlite',
    bindings: snapshot.bindings,
  };

  const report = runFinancialPipeline(input);
  const persisted = persistFinancialArtifacts(report, runDir, {
    candidateSql: generated.sql,
    sqlGeneration: generated.metadata,
    snapshotDir,
  });

  printReportSummary(report);
  console.log(`  Snapshot: ${report.snapshot.version} (${report.snapshot.sourceCount ?? report.snapshot.fixtureCount} ${report.snapshot.sourceKind ?? 'fixture'} source${(report.snapshot.sourceCount ?? report.snapshot.fixtureCount) === 1 ? '' : 's'})`);
  console.log(`  SQL model: ${generated.metadata.provider}/${generated.metadata.model}`);
  console.log(`  SQL tokens: in=${generated.metadata.inputTokens}, out=${generated.metadata.outputTokens}, cached_in=${generated.metadata.cachedInputTokens}`);
  console.log(`  Est. SQL cost: $${generated.metadata.estimatedCostUsd.toFixed(4)}`);
  console.log(`  Duration: ${Date.now() - overallStart}ms`);
  console.log(`  Artifacts:`);
  console.log(`    report: ${persisted.report}`);
  console.log(`    output-pack: ${persisted.outputPack}`);
  console.log(`    dossier: ${persisted.dossier}`);
  console.log(`    manifest: ${persisted.manifest}`);
  if (persisted.attestation) console.log(`    attestation: ${persisted.attestation}`);
  if (persisted.openLineage) console.log(`    openlineage: ${persisted.openLineage}`);
  console.log(`    candidate-sql: ${persisted.candidateSql}`);
  if (persisted.sqlGeneration) console.log(`    sql-generation: ${persisted.sqlGeneration}`);
  if (persisted.snapshotDir) console.log(`    snapshot-dir: ${persisted.snapshotDir}`);
  console.log('');
  console.log(renderPackSummary(report.outputPack));
}

function runBenchmark(): void {
  console.log('\n  Attestor Financial - Benchmark Corpus\n');

  const summary = runBenchmarkCorpus(BENCHMARK_CORPUS);

  for (const result of summary.results) {
    const status = result.decisionMatch && result.scorerMatch ? '✓' : '✗';
    console.log(`  ${status} ${result.scenario.id}: ${result.scenario.description} -> ${result.report.decision} (expected: ${result.scenario.expectedDecision})`);
  }

  console.log(`\n  Results: ${summary.passed}/${summary.totalScenarios} scenarios match expected decisions\n`);
  process.exit(summary.failed > 0 ? 1 : 0);
}

function printHelp(): void {
  console.log(`
  Attestor Financial - Evidence-Governed Financial Data Pipeline

  Usage:
    npx tsx src/financial/cli.ts scenario <id>         Run a named fixture scenario
    npx tsx src/financial/cli.ts live-scenario <id>    Run a bounded local live scenario
    npx tsx src/financial/cli.ts prove <id> [key-dir] [--reviewer-key-dir <dir>]
                                                      Run governed scenario + issue signed certificate
    npx tsx src/financial/cli.ts doctor                Check product proof readiness (keys, DB, credentials)
    npx tsx src/financial/cli.ts benchmark             Run the full replay benchmark corpus
    npx tsx src/financial/cli.ts list                  List available scenarios

  Fixture scenarios:
${Object.entries(SCENARIOS).map(([id, definition]) => `    ${id.padEnd(20)} ${definition.description}`).join('\n')}

  Live scenarios:
${Object.entries(LIVE_SCENARIOS).map(([id, definition]) => `    ${id.padEnd(20)} ${definition.description}`).join('\n')}

  Fixture scenarios remain offline/fixture-based.
  Live scenarios are bounded local hybrid exercises: model-generated SQL + local SQLite execution + persisted reviewer artifacts.
  `);
}

/**
 * Product Proof — the end-to-end attested analytics demonstration.
 *
 * 1. Generates or loads signing key pair
 * 2. Optionally loads or generates reviewer signing key pair
 * 3. Runs a governed financial scenario (fixture or live)
 * 4. Issues a signed Ed25519 attestation certificate
 * 5. If reviewer key is available, endorsement is signed and kit is reviewer-verifiable
 * 6. Verifies the certificate independently
 * 7. Persists all artifacts including the verification kit
 *
 * Usage: attestor prove <scenario-id> [key-dir] [--reviewer-key-dir <dir>]
 *
 * Reviewer key material:
 *   --reviewer-key-dir <dir>  Load reviewer key from <dir>/reviewer-private.pem + reviewer-public.pem
 *   When absent: generates ephemeral reviewer key for local proof demonstration
 */
async function runProductProof(scenarioId: string, keyDir?: string, reviewerKeyDir?: string): Promise<void> {
  console.log(`\n  Attestor Product Proof — Attested Analytics Demonstration`);
  console.log(`  Scenario: ${scenarioId}`);

  // Step 1: Signing key pair (runtime certificate signer)
  let keyPair: AttestorKeyPair;
  if (keyDir) {
    try {
      const privateKeyPem = loadPrivateKey(join(keyDir, 'private.pem'));
      const publicKeyPem = loadPublicKey(join(keyDir, 'public.pem'));
      const identity = derivePublicKeyIdentity(publicKeyPem);
      keyPair = { privateKeyPem, publicKeyPem, ...identity };
      console.log(`  Signing key: loaded from ${keyDir} (fingerprint: ${keyPair.fingerprint})`);
    } catch {
      console.log(`  Key directory ${keyDir} not found. Generating ephemeral key pair...`);
      keyPair = generateKeyPair();
      console.log(`  Signing key: ephemeral (fingerprint: ${keyPair.fingerprint})`);
    }
  } else {
    keyPair = generateKeyPair();
    console.log(`  Signing key: ephemeral (fingerprint: ${keyPair.fingerprint})`);
  }

  // Step 1b: Reviewer signing key pair (separate from runtime signer)
  let reviewerKeyPair: AttestorKeyPair | null = null;
  let reviewerKeyMode: 'loaded' | 'ephemeral' | 'absent' = 'absent';
  if (reviewerKeyDir) {
    try {
      const rpk = loadPrivateKey(join(reviewerKeyDir, 'reviewer-private.pem'));
      const rpub = loadPublicKey(join(reviewerKeyDir, 'reviewer-public.pem'));
      const rid = derivePublicKeyIdentity(rpub);
      reviewerKeyPair = { privateKeyPem: rpk, publicKeyPem: rpub, ...rid };
      reviewerKeyMode = 'loaded';
      console.log(`  Reviewer key: loaded from ${reviewerKeyDir} (fingerprint: ${reviewerKeyPair.fingerprint})`);
    } catch {
      console.log(`  Reviewer key directory ${reviewerKeyDir} not usable. Generating ephemeral reviewer key...`);
      reviewerKeyPair = generateKeyPair();
      reviewerKeyMode = 'ephemeral';
      console.log(`  Reviewer key: ephemeral (fingerprint: ${reviewerKeyPair.fingerprint})`);
    }
  } else {
    // Default: generate ephemeral reviewer key for local proof demonstration
    reviewerKeyPair = generateKeyPair();
    reviewerKeyMode = 'ephemeral';
    console.log(`  Reviewer key: ephemeral for local demo (fingerprint: ${reviewerKeyPair.fingerprint})`);
  }

  // Step 2: Find scenario
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    console.error(`  Unknown scenario: ${scenarioId}. Use 'list' to see available scenarios.`);
    process.exit(1);
  }
  console.log(`  Intent: ${scenario.description}\n`);

  // Step 3: Check for PostgreSQL-backed execution
  let pgProveResult: Awaited<ReturnType<typeof runPostgresProve>> | null = null;
  const { reportPostgresReadiness: checkPg } = await import('../connectors/postgres.js');
  const pgReadiness = await checkPg();

  if (!pgReadiness.configured) {
    console.log(`  PostgreSQL: not configured (ATTESTOR_PG_URL not set)`);
    console.log(`    Proof will use offline fixture data.`);
    console.log(`    For real DB proof: export ATTESTOR_PG_URL=postgres://user:pass@host:5432/db\n`);
  } else if (!pgReadiness.driverInstalled) {
    console.log(`  PostgreSQL: URL configured but pg driver not installed`);
    console.log(`    Proof will use offline fixture data.`);
    console.log(`    To enable: npm install pg\n`);
  } else {
    console.log(`  PostgreSQL: ready — running real database proof path...`);
    pgProveResult = await runPostgresProve(scenario.input.candidateSql);
    if (pgProveResult.attempted) {
      if (pgProveResult.predictiveGuardrail.performed) {
        console.log(`  Preflight:  ${pgProveResult.predictiveGuardrail.riskLevel} risk (${pgProveResult.predictiveGuardrail.recommendation})`);
        for (const sig of pgProveResult.predictiveGuardrail.signals) {
          console.log(`    ${sig.severity === 'critical' ? '✗' : '⚠'} ${sig.signal}: ${sig.detail}`);
        }
        if (pgProveResult.predictiveGuardrail.recommendation === 'deny') {
          console.log(`  Execution:  DENIED by predictive guardrail — proof falls back to fixture`);
        }
      }
      if (pgProveResult.execution?.success) {
        console.log(`  Execution:  ✓ ${pgProveResult.execution.rowCount} rows in ${pgProveResult.execution.durationMs}ms (real PostgreSQL)`);
      } else if (pgProveResult.execution) {
        console.log(`  Execution:  ✗ ${pgProveResult.execution.error}`);
      }
    } else {
      console.log(`  PostgreSQL: skipped — ${pgProveResult.skipReason}`);
    }
    console.log('');
  }

  // Step 4: Run governed pipeline with signing + reviewer authority (+ Postgres evidence if available)
  // Reviewer approval: when reviewer key pair is available and the scenario needs review,
  // the prove path provides a reviewer endorsement. For low-materiality scenarios that don't
  // require review, reviewer endorsement is still attached to demonstrate the full chain.
  const reviewerApproval: FinancialPipelineInput['approval'] = reviewerKeyPair ? {
    status: 'approved',
    reviewerRole: 'attestor_operator',
    reviewNote: `Product proof reviewer endorsement (${reviewerKeyMode} key)`,
    reviewerIdentity: {
      name: reviewerKeyMode === 'loaded' ? 'Loaded Reviewer' : 'Ephemeral Reviewer',
      role: 'attestor_operator',
      identifier: `prove-cli:${reviewerKeyPair.fingerprint}`,
      signerFingerprint: null, // populated by pipeline signing
    },
    reviewerKeyPair,
  } : undefined;

  // When reviewer key is available, force high materiality to trigger the review path.
  // This ensures the endorsement chain is exercised in the product proof.
  const intentOverride = reviewerKeyPair
    ? { ...scenario.input.intent, materialityTier: 'high' as const }
    : scenario.input.intent;

  const pipelineInput: FinancialPipelineInput = {
    ...scenario.input,
    intent: intentOverride,
    signingKeyPair: keyPair,
    // Inject reviewer approval (overrides scenario-level approval if any)
    ...(reviewerApproval ? { approval: reviewerApproval } : {}),
    // Only pass Postgres execution when it ACTUALLY executed (not denied by preflight)
    ...(pgProveResult?.attempted && pgProveResult.execution?.success && !pgProveResult.skipReason ? {
      externalExecution: pgProveResult.execution,
      liveProof: {
        collectedAt: new Date().toISOString(),
        upstream: scenario.input.liveProof?.upstream,
        execution: {
          live: true,
          provider: 'postgres',
          mode: 'live_db' as const,
          latencyMs: pgProveResult.execution.durationMs ?? null,
        },
      },
      predictiveGuardrail: pgProveResult.predictiveGuardrail,
    } : {
      // Preflight-only or denied: pass guardrail result but NOT live execution evidence
      ...(pgProveResult?.predictiveGuardrail ? { predictiveGuardrail: pgProveResult.predictiveGuardrail } : {}),
    }),
  };

  const report = runFinancialPipeline(pipelineInput);

  // Step 4: Display result
  console.log(`  Decision: ${report.decision.toUpperCase()}`);
  console.log(`  Scorers:  ${report.scoring.scorersRun} ran`);
  console.log(`  Warrant:  ${report.warrant.status} (${report.warrant.evidenceObligations.filter((o: any) => o.fulfilled).length}/${report.warrant.evidenceObligations.length} obligations)`);
  console.log(`  Escrow:   ${report.escrow.state}`);
  console.log(`  Receipt:  ${report.receipt?.receiptStatus ?? 'not issued'}`);
  console.log(`  Capsule:  ${report.capsule?.authorityState ?? 'none'}`);
  console.log(`  Audit:    ${report.audit.entries.length} entries, chain ${report.audit.chainIntact ? 'intact' : 'BROKEN'}`);
  console.log(`  Live:     ${report.liveProof.mode}`);

  // Step 5: Proof source truth — explicit about what data backed this run
  const wasRealPg = pgProveResult?.attempted && pgProveResult.execution?.success;
  const wasDenied = pgProveResult?.attempted && pgProveResult.predictiveGuardrail?.recommendation === 'deny';
  if (wasRealPg) {
    console.log(`  Source:   REAL PostgreSQL execution (${pgProveResult!.execution!.rowCount} rows, ${pgProveResult!.execution!.durationMs}ms)`);
  } else if (wasDenied) {
    console.log(`  Source:   offline fixture (PostgreSQL preflight DENIED execution)`);
  } else if (pgReadiness.configured && !pgReadiness.driverInstalled) {
    console.log(`  Source:   offline fixture (pg driver not installed)`);
  } else if (!pgReadiness.configured) {
    console.log(`  Source:   offline fixture (ATTESTOR_PG_URL not configured)`);
  } else {
    console.log(`  Source:   offline fixture`);
  }

  if (pgProveResult?.predictiveGuardrail?.performed) {
    console.log(`  Preflight: ${pgProveResult.predictiveGuardrail.riskLevel} (${pgProveResult.predictiveGuardrail.signals.length} signals)`);
  }

  // Step 6: Certificate truth
  if (report.certificate) {
    console.log(`\n  ✓ Certificate issued: ${report.certificate.certificateId}`);
    console.log(`    Algorithm:   ${report.certificate.signing.algorithm}`);
    console.log(`    Signer:      ${report.certificate.signing.fingerprint}`);
    console.log(`    Decision:    ${report.certificate.decision}`);

    // Step 6: Independent verification (proves the certificate is self-verifying)
    const verification = verifyCertificate(report.certificate, keyPair.publicKeyPem);
    console.log(`\n  Independent Verification:`);
    console.log(`    Signature:   ${verification.signatureValid ? '✓ valid' : '✗ INVALID'}`);
    console.log(`    Fingerprint: ${verification.fingerprintConsistent ? '✓ consistent' : '✗ MISMATCH'}`);
    console.log(`    Overall:     ${verification.overall === 'valid' ? '✓ VALID' : '✗ ' + verification.overall.toUpperCase()}`);

    // Step 7: Build verification kit (includes reviewer endorsement when reviewer key is available)
    const kit = buildVerificationKit(report, keyPair.publicKeyPem, reviewerKeyPair?.publicKeyPem ?? null);

    // Step 8: Persist artifacts
    // Run-unique proof directory: scenario + timestamp + run ID prefix (no collision, no stale mixing)
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = join('.attestor', 'proofs', `${scenarioId}_${ts}_${report.runId.slice(0, 8)}`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'certificate.json'), JSON.stringify(report.certificate, null, 2));
    writeFileSync(join(outDir, 'public-key.pem'), keyPair.publicKeyPem);
    if (kit) {
      writeFileSync(join(outDir, 'kit.json'), JSON.stringify(kit, null, 2));
      writeFileSync(join(outDir, 'verification-summary.json'), JSON.stringify(kit.verification, null, 2));
    }
    writeFileSync(join(outDir, 'bundle.json'), JSON.stringify(kit?.bundle ?? {}, null, 2));
    if (reviewerKeyPair) {
      writeFileSync(join(outDir, 'reviewer-public.pem'), reviewerKeyPair.publicKeyPem);
    }

    console.log(`\n  Artifacts saved to: ${outDir}/`);
    console.log(`    kit.json               — full verification kit (certificate + bundle + summary)`);
    console.log(`    certificate.json       — portable Ed25519-signed attestation certificate`);
    console.log(`    bundle.json            — authority bundle (full governance evidence)`);
    console.log(`    verification-summary.json — 6-dimensional verification result`);
    console.log(`    public-key.pem         — runtime signer public key`);
    if (reviewerKeyPair) {
      console.log(`    reviewer-public.pem    — reviewer signer public key`);
    }
    console.log(`\n  To verify independently:`);
    console.log(`    npx tsx src/signing/verify-cli.ts ${outDir}/kit.json`);
    console.log(`    npx tsx src/signing/verify-cli.ts ${outDir}/certificate.json ${outDir}/public-key.pem`);

    if (kit?.verification) {
      console.log(`\n  Verification Summary:`);
      console.log(`    Crypto:      ${kit.verification.cryptographic.valid ? '✓' : '✗'}`);
      console.log(`    Authority:   ${kit.verification.authority.state}`);
      console.log(`    Governance:  ${kit.verification.governanceSufficiency.sufficient ? 'sufficient' : 'INSUFFICIENT'}`);
      console.log(`    Proof:       ${kit.verification.proofCompleteness.mode} (${kit.verification.proofCompleteness.gapCount} gaps)`);

      // Reviewer endorsement truth
      const re = kit.verification.reviewerEndorsement;
      if (!re.present) {
        console.log(`    Reviewer:    (no endorsement)`);
      } else if (re.verified) {
        console.log(`    Reviewer:    ✓ verified (${re.reviewerName}, ${re.fingerprint}, ${reviewerKeyMode} key)`);
      } else if (re.signed && !re.boundToRun) {
        console.log(`    Reviewer:    ✗ signed but binding mismatch — endorsement NOT bound to this run`);
      } else if (re.signed) {
        console.log(`    Reviewer:    △ signed but not independently verifiable (reviewer key not in kit)`);
      } else {
        console.log(`    Reviewer:    △ present but unsigned`);
      }

      console.log(`    Overall:     ${kit.verification.overall.toUpperCase()}`);
    }
  } else {
    console.log(`\n  ✗ No certificate issued (signing key not provided or pipeline error)`);
  }

  console.log('');
}

/**
 * Doctor — readiness check for real product proof.
 */
async function runDoctor(): Promise<void> {
  const { reportPostgresReadiness, isPostgresConfigured } = await import('../connectors/postgres.js');
  const { existsSync } = await import('node:fs');

  console.log(`\n  Attestor Doctor — Product Proof Readiness`);
  console.log('');

  // Signing
  const hasKeyDir = existsSync('.attestor/private.pem');
  console.log(`  ${hasKeyDir ? '✓' : '○'} Signing key pair  ${hasKeyDir ? '.attestor/private.pem found' : 'Not found — run: npm run keygen'}`);

  // Model credentials
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  console.log(`  ${hasOpenAI ? '✓' : '○'} OpenAI API key    ${hasOpenAI ? 'Set' : 'Not set — needed for live model proof'}`);

  // PostgreSQL
  const pgReadiness = await reportPostgresReadiness();
  console.log(`  ${pgReadiness.runnable ? '✓' : pgReadiness.configured ? '△' : '○'} PostgreSQL         ${pgReadiness.message}`);

  // SQLite
  console.log(`  ✓ SQLite (built-in)  Always available for fixture/local live proof`);

  console.log('');
  console.log(`  Proof modes:`);
  console.log(`    ✓ offline_fixture        — always available (fixture data)`);
  console.log(`    ${hasOpenAI ? '✓' : '○'} live_model             — ${hasOpenAI ? 'ready' : 'needs OPENAI_API_KEY'}`);
  console.log(`    ✓ live_runtime (SQLite)  — built-in local execution`);
  console.log(`    ${pgReadiness.runnable ? '✓' : '○'} live_runtime (Postgres) — ${pgReadiness.runnable ? 'ready for real DB proof' : 'not ready (see below)'}`);

  console.log('');
  console.log(`  Product proof readiness (outsider-verifiable, real DB):`);
  const steps: string[] = [];
  if (!hasKeyDir) steps.push('npm run keygen');
  if (!pgReadiness.configured) steps.push('export ATTESTOR_PG_URL=postgres://user:pass@host:5432/db');
  if (!pgReadiness.driverInstalled) steps.push('npm install pg');

  if (steps.length === 0 && hasKeyDir && pgReadiness.runnable) {
    console.log(`    ✓ Ready — run: npm run prove -- counterparty .attestor`);
  } else {
    for (let i = 0; i < steps.length; i++) {
      console.log(`    ${i + 1}. ${steps[i]}`);
    }
    console.log(`    Then: npm run prove -- counterparty .attestor`);
  }
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'scenario' && args[1]) {
    runScenario(args[1]);
    return;
  }

  if (command === 'live-scenario' && args[1]) {
    await runLiveScenario(args[1]);
    return;
  }

  if (command === 'benchmark') {
    runBenchmark();
    return;
  }

  if (command === 'prove' && args[1]) {
    // Parse optional --reviewer-key-dir flag from remaining args
    const proveArgs = args.slice(1);
    const scenarioArg = proveArgs[0];
    let keyDirArg: string | undefined;
    let reviewerKeyDirArg: string | undefined;
    for (let i = 1; i < proveArgs.length; i++) {
      if (proveArgs[i] === '--reviewer-key-dir' && proveArgs[i + 1]) {
        reviewerKeyDirArg = proveArgs[++i];
      } else if (!keyDirArg) {
        keyDirArg = proveArgs[i];
      }
    }
    await runProductProof(scenarioArg, keyDirArg, reviewerKeyDirArg);
    return;
  }

  if (command === 'doctor') {
    await runDoctor();
    return;
  }

  if (command === 'list') {
    console.log('\n  Fixture scenarios:');
    for (const [id, definition] of Object.entries(SCENARIOS)) {
      console.log(`    ${id.padEnd(20)} ${definition.description}`);
    }
    console.log('\n  Live scenarios:');
    for (const [id, definition] of Object.entries(LIVE_SCENARIOS)) {
      console.log(`    ${id.padEnd(20)} ${definition.description}`);
    }
    console.log('');
    return;
  }

  printHelp();
}

main().catch((error) => {
  console.error('\n  Financial CLI crashed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
