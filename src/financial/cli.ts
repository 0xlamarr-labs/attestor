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

// ─── Shell-aware operator guidance ──────────────────────────────────────────

/** Format an environment variable assignment for the current shell. */
function envSet(name: string, value: string): string {
  if (process.platform === 'win32') {
    return `$env:${name}='${value}'`;
  }
  return `export ${name}=${value}`;
}

/** Shell name for operator context. */
function shellName(): string {
  return process.platform === 'win32' ? 'PowerShell' : 'bash/zsh';
}

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
import { runMultiQueryPipeline, type MultiQueryUnit } from './multi-query-pipeline.js';
import { buildMultiQueryOutputPack, buildMultiQueryDossier, buildMultiQueryManifest, buildMultiQueryVerificationKit, renderMultiQuerySummary } from './multi-query-proof.js';
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
    npx tsx src/financial/cli.ts prove <id> [key-dir] [--reviewer-key-dir <dir>] [--connector <id>]
                                                      Run governed scenario + issue signed certificate
    npx tsx src/financial/cli.ts multi-query            Run a governed multi-query proof (fixed scenario set)
    npx tsx src/financial/cli.ts healthcare            Run healthcare domain E2E scenarios
    npx tsx src/financial/cli.ts pg-demo-init          Bootstrap demo schema + data in PostgreSQL for real DB proof
    npx tsx src/financial/cli.ts pg-demo-teardown      Remove the demo schema from PostgreSQL
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
async function runProductProof(scenarioId: string, keyDir?: string, reviewerKeyDir?: string, connectorId?: string): Promise<void> {
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

  // Step 1a-pki: Generate PKI trust chain for this prove run
  const { generatePkiHierarchy, verifyTrustChain } = await import('../signing/pki-chain.js');
  const pkiHierarchy = generatePkiHierarchy('Attestor CLI CA', 'CLI Runtime Signer', 'CLI Reviewer');
  // Use the PKI signer key as the signing key (PKI-backed by default)
  keyPair = pkiHierarchy.signer.keyPair;
  console.log(`  PKI: CA=${pkiHierarchy.ca.certificate.name}, signer=${pkiHierarchy.signer.certificate.subject}`);

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

  // Step 1c: Optional OIDC-backed reviewer identity (cache-first)
  let oidcIdentity: import('../financial/types.js').ReviewerIdentity | null = null;
  let oidcTokenPath: 'cached' | 'refreshed' | 'device_flow' | 'none' = 'none';
  const { isOidcConfigured, loadOidcConfig, executeDeviceFlow } = await import('../identity/oidc-device-flow.js');
  const { loadCachedTokens, saveCachedTokens, isTokenExpired, isTokenExpiringSoon } = await import('../identity/token-cache.js');
  const { loadSession, saveSession, isSessionValid, isSessionExpiringSoon, refreshSession, getSessionBackendName } = await import('../identity/keychain-session.js');
  // Keychain-first: OS keychain (Windows/macOS/Linux) with encrypted-file fallback.
  const keychainBackend = await getSessionBackendName();
  const loadTokens = async () => {
    const session = await loadSession();
    if (session) return session as any;
    if (process.env.ATTESTOR_PLAINTEXT_TOKEN_IMPORT === '1') {
      const legacy = loadCachedTokens();
      if (legacy) {
        console.log(`  OIDC: importing legacy cache into keychain (${keychainBackend})`);
        await saveSession({ accessToken: legacy.accessToken ?? '', refreshToken: legacy.refreshToken ?? null, idToken: legacy.idToken ?? null, expiresAt: legacy.expiresAt ?? 0, issuer: legacy.issuer ?? '', subject: legacy.subject ?? '', name: legacy.name ?? '', email: legacy.email ?? null, backendUsed: keychainBackend });
        return legacy;
      }
    }
    return null;
  };
  const saveTokens = async (tokens: any) => {
    await saveSession({ accessToken: tokens.accessToken ?? '', refreshToken: tokens.refreshToken ?? null, idToken: tokens.idToken ?? null, expiresAt: tokens.expiresAt ?? 0, issuer: tokens.issuer ?? '', subject: tokens.subject ?? '', name: tokens.name ?? '', email: tokens.email ?? null, backendUsed: keychainBackend });
    if (process.env.ATTESTOR_PLAINTEXT_TOKEN_FALLBACK === '1') {
      saveCachedTokens(tokens);
    }
  };

  if (isOidcConfigured()) {
    const oidcConfig = loadOidcConfig()!;
    console.log(`\n  OIDC: configured (${oidcConfig.issuerUrl})`);

    // 1. Try cached tokens first
    const cached = await loadTokens();
    if (cached && !isTokenExpired(cached)) {
      oidcIdentity = { name: cached.name ?? 'Cached User', role: 'oidc_authenticated', identifier: cached.email ?? cached.subject, signerFingerprint: null };
      oidcTokenPath = 'cached';
      console.log(`  OIDC: using cached identity — ${oidcIdentity.name} (${oidcIdentity.identifier})`);

      // 1b. Refresh if expiring soon
      if (isTokenExpiringSoon(cached)) {
        console.log(`  OIDC: token expiring soon, attempting refresh...`);
        const refreshed = await refreshSession(cached, oidcConfig.clientId);
        if (refreshed) {
          await saveTokens(refreshed);
          oidcIdentity = { name: refreshed.name ?? cached.name ?? 'Refreshed User', role: 'oidc_authenticated', identifier: refreshed.email ?? refreshed.subject, signerFingerprint: null };
          oidcTokenPath = 'refreshed';
          console.log(`  OIDC: token refreshed successfully`);
        }
      }
    } else if (cached && isTokenExpired(cached) && cached.refreshToken) {
      // 2. Expired but has refresh token — try refresh
      console.log(`  OIDC: cached token expired, attempting refresh...`);
      const refreshed = await refreshSession(cached, oidcConfig.clientId);
      if (refreshed) {
        await saveTokens(refreshed);
        oidcIdentity = { name: refreshed.name ?? 'Refreshed User', role: 'oidc_authenticated', identifier: refreshed.email ?? refreshed.subject, signerFingerprint: null };
        oidcTokenPath = 'refreshed';
        console.log(`  OIDC: token refreshed — ${oidcIdentity.name}`);
      }
    }

    // 3. Fall back to interactive device flow
    if (!oidcIdentity) {
      console.log(`  OIDC: no valid cached token, starting device flow...`);
      const oidcResult = await executeDeviceFlow(oidcConfig);
      if (oidcResult.success && oidcResult.identity) {
        oidcIdentity = oidcResult.identity;
        oidcTokenPath = 'device_flow';
        // Save real token material for cache/refresh
        await saveTokens({
          accessToken: oidcResult.accessToken ?? '',
          idToken: oidcResult.idToken ?? null,
          refreshToken: oidcResult.refreshToken ?? null,
          expiresAt: oidcResult.expiresAt ?? (Date.now() / 1000 + 3600),
          issuer: oidcResult.issuer ?? oidcConfig.issuerUrl,
          subject: oidcResult.subject ?? '',
          name: oidcIdentity.name, email: oidcIdentity.identifier,
        });
        if (!oidcResult.refreshToken) {
          console.log(`  OIDC: note — IdP did not issue a refresh token. Future sessions will require interactive login.`);
        }
        if (false) { // removed old block
        }
        console.log(`  OIDC: authenticated via device flow — ${oidcIdentity.name}`);
      } else {
        console.log(`  OIDC: device flow failed — ${oidcResult.error}. Using ephemeral identity.`);
      }
    }

    if (oidcTokenPath !== 'none') {
      console.log(`  OIDC token path: ${oidcTokenPath}`);
    }
  }

  // Step 2: Find scenario
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    console.error(`  Unknown scenario: ${scenarioId}. Use 'list' to see available scenarios.`);
    process.exit(1);
  }
  console.log(`  Intent: ${scenario.description}\n`);

  // Step 3a: Check for explicit connector (e.g., --connector snowflake)
  let connectorExecution: any = null;
  let connectorProvider: string | null = null;
  if (connectorId) {
    const { connectorRegistry } = await import('../connectors/connector-interface.js');
    const { snowflakeConnector } = await import('../connectors/snowflake-connector.js');
    if (!connectorRegistry.has('snowflake')) connectorRegistry.register(snowflakeConnector);

    const connector = connectorRegistry.get(connectorId);
    if (!connector) {
      console.log(`  Connector '${connectorId}' not found. Available: ${connectorRegistry.listIds().join(', ')}`);
    } else {
      const connConfig = connector.loadConfig();
      if (!connConfig) {
        console.log(`  Connector '${connectorId}': not configured (env vars missing)`);
      } else {
        console.log(`  Connector: ${connector.displayName} — attempting execution...`);
        try {
          const result = await connector.execute(scenario.input.candidateSql, connConfig);
          if (result.success) {
            connectorExecution = result;
            connectorProvider = result.provider;
            console.log(`  Execution: ✓ ${result.provider} — ${result.rowCount} rows in ${result.durationMs}ms`);
            if (result.executionContextHash) {
              console.log(`  Context:   ${result.executionContextHash}`);
            }
          } else {
            console.log(`  Execution: ✗ ${result.error}`);
          }
        } catch (err: any) {
          console.log(`  Execution: ✗ ${err.message}`);
        }
        console.log('');
      }
    }
  }

  // Step 3b: Check for PostgreSQL-backed execution (only if no explicit connector)
  let pgProveResult: Awaited<ReturnType<typeof runPostgresProve>> | null = null;
  const { reportPostgresReadiness: checkPg, loadPostgresConfig: loadPgConf } = await import('../connectors/postgres.js');
  const pgReadiness = await checkPg();

  // Detect demo schema mode: when ATTESTOR_PG_ALLOWED_SCHEMAS includes 'attestor_demo',
  // use canonical demo SQL from the bootstrap module instead of regex rewriting.
  const pgConf = loadPgConf();
  const usingDemoSchema = pgConf?.allowedSchemas?.includes('attestor_demo') ?? false;
  let candidateSqlForPg = scenario.input.candidateSql;
  let demoSource: 'canonical' | 'rewrite' | 'none' = 'none';
  if (usingDemoSchema) {
    const { getDemoCounterpartySql } = await import('../connectors/postgres-demo.js');
    if (scenarioId === 'counterparty') {
      // Use the canonical demo SQL — single source of truth for demo-schema queries
      candidateSqlForPg = getDemoCounterpartySql();
      demoSource = 'canonical';
      console.log(`  Demo mode: using canonical demo SQL for '${scenarioId}' (attestor_demo schema)`);
    } else {
      // No canonical helper for this scenario yet — fall back to schema rewriting
      candidateSqlForPg = candidateSqlForPg.replace(/\brisk\./g, 'attestor_demo.');
      demoSource = 'rewrite';
      console.log(`  Demo mode: rewriting SQL schema references for '${scenarioId}' (risk.* → attestor_demo.*)`);
    }
  }

  if (!pgReadiness.configured) {
    console.log(`  PostgreSQL: not configured (ATTESTOR_PG_URL not set)`);
    console.log(`    Proof will use offline fixture data.`);
    console.log(`    For real DB proof: ${envSet('ATTESTOR_PG_URL', 'postgres://user:pass@host:5432/db')}\n`);
  } else if (!pgReadiness.driverInstalled) {
    console.log(`  PostgreSQL: URL configured but pg driver not installed`);
    console.log(`    Proof will use offline fixture data.`);
    console.log(`    To enable: npm install pg\n`);
  } else {
    console.log(`  PostgreSQL: config present — attempting real database proof path...`);
    pgProveResult = await runPostgresProve(candidateSqlForPg);
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
        console.log(`  Execution:  ✓ REAL PostgreSQL — ${pgProveResult.execution.rowCount} rows in ${pgProveResult.execution.durationMs}ms`);
      } else if (pgProveResult.execution) {
        console.log(`  Execution:  ✗ PostgreSQL execution failed: ${pgProveResult.execution.error}`);
        console.log(`    Proof falls back to offline fixture data.`);
      }
    } else {
      console.log(`  PostgreSQL: attempt failed — ${pgProveResult.skipReason}`);
      console.log(`    Proof falls back to offline fixture data.`);
    }
    console.log('');
  }

  // Step 4: Run governed pipeline with signing + reviewer authority (+ Postgres evidence if available)
  // Reviewer approval: when reviewer key pair is available and the scenario needs review,
  // the prove path provides a reviewer endorsement. For low-materiality scenarios that don't
  // require review, reviewer endorsement is still attached to demonstrate the full chain.
  // Use OIDC identity if available, otherwise fall back to ephemeral
  const reviewerName = oidcIdentity?.name ?? (reviewerKeyMode === 'loaded' ? 'Loaded Reviewer' : 'Ephemeral Reviewer');
  const reviewerRole = oidcIdentity?.role ?? 'attestor_operator';
  const reviewerIdentifier = oidcIdentity?.identifier ?? `prove-cli:${reviewerKeyPair?.fingerprint}`;
  const identitySourceLabel = oidcIdentity ? 'oidc_verified' : 'operator_asserted';

  const reviewerApproval: FinancialPipelineInput['approval'] = reviewerKeyPair ? {
    status: 'approved',
    reviewerRole,
    reviewNote: `Product proof reviewer endorsement (${reviewerKeyMode} key, identity: ${identitySourceLabel})`,
    reviewerIdentity: {
      name: reviewerName,
      role: reviewerRole,
      identifier: reviewerIdentifier,
      signerFingerprint: null, // populated by pipeline signing
    },
    reviewerKeyPair,
  } : undefined;

  // When reviewer key is available, force high materiality to trigger the review path.
  // This ensures the endorsement chain is exercised in the product proof.
  let intentOverride = reviewerKeyPair
    ? { ...scenario.input.intent, materialityTier: 'high' as const }
    : { ...scenario.input.intent };

  // In demo mode, also override allowedSchemas so SQL governance accepts attestor_demo.*
  if (usingDemoSchema) {
    intentOverride = { ...intentOverride, allowedSchemas: ['attestor_demo'] };
  }

  const pipelineInput: FinancialPipelineInput = {
    ...scenario.input,
    // In demo mode, use canonical demo SQL (or schema-rewritten fallback) for governance and execution
    candidateSql: usingDemoSchema ? candidateSqlForPg : scenario.input.candidateSql,
    intent: intentOverride,
    signingKeyPair: keyPair,
    // Inject reviewer approval (overrides scenario-level approval if any)
    ...(reviewerApproval ? { approval: reviewerApproval } : {}),
    // Connector-routed execution (e.g., Snowflake)
    ...(connectorExecution ? {
      externalExecution: connectorExecution,
      liveProof: {
        collectedAt: new Date().toISOString(),
        execution: { live: true, provider: connectorProvider!, mode: 'live_db' as const, latencyMs: connectorExecution.durationMs ?? null },
      },
    } : {}),
    // Only pass Postgres execution when it ACTUALLY executed (not denied by preflight)
    ...(!connectorExecution && pgProveResult?.attempted && pgProveResult.execution?.success && !pgProveResult.skipReason ? {
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
    const demoLabel = usingDemoSchema ? ' (seeded demo data)' : '';
    console.log(`  Source:   REAL PostgreSQL execution (${pgProveResult!.execution!.rowCount} rows, ${pgProveResult!.execution!.durationMs}ms)${demoLabel}`);
    if (usingDemoSchema) {
      console.log(`  Schema:   attestor_demo (repo-native demo bootstrap, SQL source: ${demoSource})`);
    }
    if (pgProveResult!.postgresEvidence?.executionContextHash) {
      console.log(`  Context:  ${pgProveResult!.postgresEvidence.executionContextHash} (db environment hash)`);
    }
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

    // Step 7: Build verification kit with PKI trust chain (self-contained portable proof)
    const kit = buildVerificationKit(
      report, keyPair.publicKeyPem, reviewerKeyPair?.publicKeyPem ?? null,
      pkiHierarchy.chains.signer, pkiHierarchy.ca.keyPair.publicKeyPem,
    );

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
    // PKI trust chain artifact
    writeFileSync(join(outDir, 'trust-chain.json'), JSON.stringify(pkiHierarchy.chains.signer, null, 2));
    writeFileSync(join(outDir, 'ca-public.pem'), pkiHierarchy.ca.keyPair.publicKeyPem);

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
 * Multi-Query Demo — governed multi-query proof with signed certificate and verification kit.
 */
async function runMultiQueryDemo(): Promise<void> {
  console.log(`\n  Attestor Multi-Query — Governed Multi-Query Signed Proof`);
  console.log('');

  const units: MultiQueryUnit[] = [
    {
      unitId: 'counterparty',
      label: 'Counterparty exposure summary',
      input: { runId: 'x', intent: COUNTERPARTY_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT },
    },
    {
      unitId: 'liquidity',
      label: 'Liquidity risk assessment',
      input: { runId: 'x', intent: LIQUIDITY_INTENT, candidateSql: LIQUIDITY_SQL, fixtures: [LIQUIDITY_FIXTURE] },
    },
    {
      unitId: 'recon',
      label: 'Reconciliation variance check',
      input: { runId: 'x', intent: RECON_INTENT, candidateSql: RECON_SQL, fixtures: [RECON_FIXTURE] },
    },
  ];

  const runId = `mq-demo-${Date.now().toString(36)}`;
  const report = runMultiQueryPipeline(runId, units);

  // Display summary
  console.log(renderMultiQuerySummary(report));

  // Signing keys
  const keyPair = generateKeyPair();
  const reviewerKeyPair = generateKeyPair();
  console.log(`\n  Signing key:  ephemeral (${keyPair.fingerprint})`);
  console.log(`  Reviewer key: ephemeral (${reviewerKeyPair.fingerprint})`);

  // Build reviewer endorsement
  const { buildMultiQueryReviewerEndorsement } = await import('../signing/multi-query-reviewer.js');
  const endorsement = buildMultiQueryReviewerEndorsement(
    report.runId,
    report.multiQueryHash,
    report.unitCount,
    report.aggregateDecision,
    { name: 'Ephemeral Reviewer', role: 'attestor_operator', identifier: `mq-demo:${reviewerKeyPair.fingerprint}`, signerFingerprint: null },
    'Multi-query demo proof review',
    reviewerKeyPair,
  );

  // Build proof artifacts — signed certificate + reviewer-endorsed kit
  const outputPack = buildMultiQueryOutputPack(report);
  const dossier = buildMultiQueryDossier(report);
  const kit = buildMultiQueryVerificationKit(report, keyPair, endorsement, reviewerKeyPair.publicKeyPem);

  console.log(`  Certificate: ${kit.certificate.certificateId}`);
  console.log(`  Kit overall: ${kit.verification.overall.toUpperCase()}`);

  // Persist
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join('.attestor', 'multi-query', `${runId}_${ts}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'output-pack.json'), JSON.stringify(outputPack, null, 2));
  writeFileSync(join(outDir, 'dossier.json'), JSON.stringify(dossier, null, 2));
  writeFileSync(join(outDir, 'kit.json'), JSON.stringify(kit, null, 2));
  writeFileSync(join(outDir, 'certificate.json'), JSON.stringify(kit.certificate, null, 2));
  writeFileSync(join(outDir, 'public-key.pem'), keyPair.publicKeyPem);
  writeFileSync(join(outDir, 'reviewer-public.pem'), reviewerKeyPair.publicKeyPem);
  writeFileSync(join(outDir, 'verification-summary.json'), JSON.stringify(kit.verification, null, 2));

  console.log(`\n  Artifacts saved to: ${outDir}/`);
  console.log(`    kit.json                — multi-query verification kit (certificate + manifest + reviewer + summary)`);
  console.log(`    certificate.json        — Ed25519-signed multi-query attestation certificate`);
  console.log(`    output-pack.json        — machine-readable multi-query output pack`);
  console.log(`    dossier.json            — reviewer-facing multi-query decision dossier`);
  console.log(`    public-key.pem          — signer public key`);
  console.log(`    reviewer-public.pem     — reviewer signer public key`);
  console.log(`    verification-summary.json — multi-query verification result`);

  console.log(`\n  Verification Summary:`);
  console.log(`    Crypto:      ${kit.verification.cryptographic.valid ? '✓' : '✗'} (${kit.verification.cryptographic.algorithm})`);
  console.log(`    Governance:  ${kit.verification.governanceSufficiency.sufficient ? 'sufficient' : 'INSUFFICIENT'}`);
  console.log(`    Proof:       ${kit.verification.proofCompleteness.aggregateMode}`);
  console.log(`    Units:       ${kit.verification.unitCount}`);
  console.log(`    Decision:    ${kit.verification.aggregateDecision}`);
  const re = kit.verification.reviewerEndorsement;
  console.log(`    Reviewer:    ${re.verified ? '✓ verified' : re.present ? '△ present but not verified' : '(none)'} ${re.reviewerName ? `(${re.reviewerName})` : ''}`);
  console.log(`    Overall:     ${kit.verification.overall.toUpperCase()}`);
  console.log('');
}

/**
 * Healthcare Domain Demo — runs healthcare quality measure scenarios through the governance engine.
 */
async function runHealthcareDemo(): Promise<void> {
  console.log(`\n  Attestor Healthcare Domain — Governed Quality Measure Scenarios\n`);

  const { runFinancialPipeline } = await import('./pipeline.js');
  const {
    READMISSION_SQL, READMISSION_INTENT, READMISSION_FIXTURE,
    SMALL_CELL_SQL, SMALL_CELL_INTENT, SMALL_CELL_FIXTURE,
    TEMPORAL_SQL, TEMPORAL_INTENT, TEMPORAL_FIXTURE,
  } = await import('../domains/healthcare-scenarios.js');
  const {
    evaluatePatientCountConsistency, evaluateRateBound,
    evaluateSmallCellSuppression, evaluateTemporalConsistency,
  } = await import('../domains/healthcare-clauses.js');
  const { generateKeyPair } = await import('../signing/keys.js');

  const scenarios = [
    { id: 'readmission', label: 'Readmission Rate Quality Measure', sql: READMISSION_SQL, intent: READMISSION_INTENT, fixture: READMISSION_FIXTURE, expectedDecision: 'pass' },
    { id: 'small-cell', label: 'Small Cell Suppression Check', sql: SMALL_CELL_SQL, intent: SMALL_CELL_INTENT, fixture: SMALL_CELL_FIXTURE, expectedDecision: 'pass' },
    { id: 'temporal', label: 'Temporal Consistency Check', sql: TEMPORAL_SQL, intent: TEMPORAL_INTENT, fixture: TEMPORAL_FIXTURE, expectedDecision: 'fail' },
  ];

  const keyPair = generateKeyPair();
  let allExpected = true;

  for (const s of scenarios) {
    const report = runFinancialPipeline({ runId: `hc-${s.id}`, intent: s.intent, candidateSql: s.sql, fixtures: [s.fixture], signingKeyPair: keyPair });
    const match = report.decision === s.expectedDecision;
    if (!match) allExpected = false;
    const icon = match ? '✓' : '✗';
    console.log(`  ${icon} ${s.label.padEnd(40)} decision=${report.decision.padEnd(6)} expected=${s.expectedDecision} ${match ? '' : '← MISMATCH'}`);

    // Run domain-specific clause checks
    const rows = s.fixture.result.rows;
    if (s.id === 'readmission') {
      const pc = evaluatePatientCountConsistency(rows, 'numerator', 'excluded', 'denominator');
      const rb = evaluateRateBound(rows, 'readmission_rate', 0.0, 0.30, 'readmission');
      console.log(`    clauses: patient_count=${pc.passed ? '✓' : '✗'}, rate_bound=${rb.passed ? '✓' : '✗'}`);
    }
    if (s.id === 'small-cell') {
      const sc = evaluateSmallCellSuppression(rows, 'patient_count', 11);
      console.log(`    clauses: small_cell=${sc.passed ? '✓ (no violations)' : `✗ (${(sc.evidence as any).violations.length} violations)`}`);
    }
    if (s.id === 'temporal') {
      const tc = evaluateTemporalConsistency(rows, 'admission_date', 'discharge_date');
      console.log(`    clauses: temporal=${tc.passed ? '✓' : `✗ (${(tc.evidence as any).violations} inconsistencies)`}`);
    }
  }

  // eCQM measure evaluation
  const { evaluateMeasure, CMS_READMISSION_MEASURE } = await import('../domains/healthcare-measures.js');
  const measureResult = evaluateMeasure(CMS_READMISSION_MEASURE, {
    initial_population: 350,
    denominator: 300,
    denominator_exclusion: 50,
    numerator: 36,
    numerator_exclusion: 0,
  });
  console.log(`\n  eCQM Measure: ${measureResult.title}`);
  console.log(`    Rate: ${measureResult.rate !== null ? (measureResult.rate * 100).toFixed(1) + '%' : 'N/A'}`);
  console.log(`    Performance: ${measureResult.performanceMet ? '✓ met' : '✗ not met'}`);
  for (const gc of measureResult.governanceChecks) {
    console.log(`    ${gc.passed ? '✓' : '✗'} ${gc.description}`);
  }

  // CMS Top-3 quality measures
  const { CMS165_BLOOD_PRESSURE, CMS122_DIABETES_A1C, CMS130_COLORECTAL_SCREENING, toFhirMeasureReport } = await import('../domains/healthcare-measures.js');
  const { validateFhirMeasureReport } = await import('../domains/fhir-validator.js');

  const cmsMeasures = [
    { measure: CMS165_BLOOD_PRESSURE, data: { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 } },
    { measure: CMS122_DIABETES_A1C, data: { initial_population: 800, denominator: 750, denominator_exclusion: 50, numerator: 60 } },
    { measure: CMS130_COLORECTAL_SCREENING, data: { initial_population: 2000, denominator: 1900, denominator_exclusion: 100, numerator: 1520 } },
  ];

  console.log(`\n  ── CMS Quality Measures (eCQM) ──`);
  let fhirValidationErrors = 0;
  for (const { measure, data } of cmsMeasures) {
    const result = evaluateMeasure(measure, data);
    const fhir = toFhirMeasureReport(result);
    const validation = await validateFhirMeasureReport(fhir);
    const rateStr = result.rate !== null ? (result.rate * 100).toFixed(1) + '%' : 'N/A';
    const valIcon = validation.valid ? '✓' : '✗';
    console.log(`  ${result.performanceMet ? '✓' : '✗'} ${measure.measureId}: ${measure.title} — rate=${rateStr}, FHIR=${valIcon} ${validation.scope} (${validation.errors.length} errors)`);
    if (!validation.valid) {
      fhirValidationErrors += validation.errors.length;
      for (const err of validation.errors) {
        console.log(`      ✗ ${err.path}: ${err.message}`);
      }
    }
  }
  if (fhirValidationErrors > 0) {
    console.log(`\n  ⚠ FHIR validation: ${fhirValidationErrors} error(s) — MeasureReport output may not conform to R4 schema`);
  }

  // QRDA III export
  const { generateQrda3, validateQrda3Structure } = await import('../filing/qrda3-generator.js');
  const allEvaluations = cmsMeasures.map(({ measure, data }) => evaluateMeasure(measure, data));
  const qrda3Xml = generateQrda3(allEvaluations, { reportingYear: '2026', performerName: 'Attestor Healthcare Demo' });
  const qrda3Validation = validateQrda3Structure(qrda3Xml, allEvaluations.length);
  console.log(`\n  QRDA III: generated ${qrda3Xml.length} chars XML for ${allEvaluations.length} measures — structural ${qrda3Validation.valid ? '✓' : '✗'} (${qrda3Validation.checks.length} checks, ${qrda3Validation.scope})`);

  // CMS IG XPath validation (SaxonJS)
  const { validateQrda3Schematron } = await import('../filing/qrda3-schematron.js');
  const cmsValidation = await validateQrda3Schematron(qrda3Xml);
  console.log(`  CMS IG:  ${cmsValidation.valid ? '✓' : '✗'} ${cmsValidation.passedRules}/${cmsValidation.totalRules} rules pass (${cmsValidation.errors} errors, ${cmsValidation.scope})`);
  if (cmsValidation.errors > 0) {
    for (const a of cmsValidation.assertions.filter(a => !a.passed)) {
      console.log(`    ✗ ${a.ruleId}: ${a.description}`);
    }
  }

  // CMS 2026 Schematron validation (real .sch file)
  const { validateCmsSchematron } = await import('../filing/qrda3-cms-schematron.js');
  const schResult = await validateCmsSchematron(qrda3Xml);
  const schIcon = schResult.errorCount === 0 ? '✓' : '⚠';
  console.log(`  CMS Sch: ${schIcon} ${schResult.errorCount} errors, ${schResult.warningCount} warnings (${schResult.scope})`);
  if (schResult.errorCount > 0) {
    // Show unique error descriptions
    const unique = new Map<string, number>();
    for (const e of schResult.errors) { unique.set(e.description, (unique.get(e.description) ?? 0) + 1); }
    for (const [desc, count] of [...unique.entries()].slice(0, 5)) {
      console.log(`    ✗ [${count}x] ${desc.slice(0, 120)}`);
    }
    if (unique.size > 5) console.log(`    ... and ${unique.size - 5} more rule types`);
  }

  // Cypress-equivalent validators (Layers 2-6)
  const { validateCypressLayers } = await import('../filing/qrda3-cypress-validators.js');
  const cypressResult = validateCypressLayers(qrda3Xml);
  console.log(`  Cypress-eq: ${cypressResult.valid ? '✓' : '✗'} ${cypressResult.totalErrors} errors, ${cypressResult.totalWarnings} warnings (${cypressResult.scope}, not actual ONC Cypress)`);
  for (const layer of cypressResult.layers) {
    const icon = layer.valid ? '✓' : '✗';
    const warnStr = layer.warnings.length > 0 ? ` (${layer.warnings.length} warnings)` : '';
    console.log(`    ${icon} L${layer.layer} ${layer.name}: ${layer.errors.length} errors${warnStr}`);
    for (const e of layer.errors) console.log(`      ✗ ${e}`);
  }

  const { isVsacConfigured, validateVsacLayer7ForMeasures } = await import('../filing/vsac-api-client.js');
  if (isVsacConfigured()) {
    console.log(`  Expanding VSAC Layer 7 value sets...`);
    const vsacResult = await validateVsacLayer7ForMeasures(cmsMeasures.map(entry => entry.measure));
    const vsacIcon = vsacResult.valid ? '✓' : '✗';
    console.log(`  VSAC L7: ${vsacIcon} ${vsacResult.expandedTargets}/${vsacResult.totalTargets} value sets expanded, ${vsacResult.totalCodes} codes (${vsacResult.scope})`);
    if (!vsacResult.valid) {
      const failedTargets = vsacResult.targets.filter(entry => !entry.valid);
      for (const target of failedTargets.slice(0, 5)) {
        console.log(`    - ${target.name} [${target.oid}] ${target.error ?? 'unknown VSAC error'}`);
      }
      if (failedTargets.length > 5) console.log(`    ... and ${failedTargets.length - 5} more`);
    }
  } else {
    console.log(`  VSAC L7: ⊘ skipped (set VSAC_UMLS_API_KEY from the UMLS My Profile page for live value-set expansion)`);
  }

  // ONC Cypress API validation (env-gated — only when UMLS credentials available)
  const { isCypressConfigured, validateViaCypressApi } = await import('../filing/cypress-api-client.js');
  if (isCypressConfigured()) {
    console.log(`  Submitting to ONC Cypress server...`);
    const apiResult = await validateViaCypressApi(qrda3Xml);
    const apiIcon = apiResult.valid ? '✓' : (apiResult.httpStatus === 0 ? '⊘' : '✗');
    console.log(`  ONC Cypress: ${apiIcon} ${apiResult.errorCount} errors (${apiResult.scope}, HTTP ${apiResult.httpStatus})`);
    if (!apiResult.valid && apiResult.errors.length > 0) {
      for (const e of apiResult.errors.slice(0, 5)) console.log(`    - ${e.message.slice(0, 120)}`);
      if (apiResult.errors.length > 5) console.log(`    ... and ${apiResult.errors.length - 5} more`);
    }
  } else {
    console.log(`  ONC Cypress: ⊘ skipped (set CYPRESS_UMLS_USER + CYPRESS_UMLS_PASS for real ONC validation)`);
  }

  console.log(`\n  Healthcare scenarios: ${scenarios.length} ran, ${allExpected ? 'all matched expected decisions' : 'SOME MISMATCHES'}`);
  if (allExpected) {
    console.log(`  Certificate: ${scenarios[0].id} issued with signing key ${keyPair.fingerprint}`);
  }
  console.log('');
}

/**
 * PostgreSQL Demo Bootstrap — seeds a deterministic demo schema for real DB proof.
 *
 * This is the ONLY write operation in Attestor's PostgreSQL integration.
 * It creates an `attestor_demo` schema with tables matching the repo's
 * fixture scenarios, so `prove counterparty` can run against real Postgres.
 */
async function runPgDemoInit(): Promise<void> {
  const { runDemoBootstrap, getDemoBootstrapPlan, getDemoCounterpartySql, getDemoAllowedSchemas } = await import('../connectors/postgres-demo.js');

  console.log(`\n  Attestor PostgreSQL Demo Bootstrap`);
  console.log(`  This creates a demo schema with deterministic data for real DB proof.\n`);

  const plan = getDemoBootstrapPlan();
  console.log(`  Schema: ${plan.schema}`);
  console.log(`  Tables:`);
  for (const t of plan.tables) {
    console.log(`    ${plan.schema}.${t.name.padEnd(30)} ${t.rowCount} rows  (${t.columns.join(', ')})`);
  }
  console.log('');

  const result = await runDemoBootstrap();
  if (result.success) {
    console.log(`  ✓ ${result.message}`);
    console.log('');
    for (const [table, count] of Object.entries(result.rowCounts)) {
      console.log(`    ${plan.schema}.${table}: ${count} rows`);
    }
    console.log('');
    console.log(`  Next steps (${shellName()}):`);
    console.log(`    1. ${envSet('ATTESTOR_PG_ALLOWED_SCHEMAS', getDemoAllowedSchemas().join(','))}`);
    console.log(`    2. npm run prove -- counterparty`);
    console.log('');
    console.log(`  When ATTESTOR_PG_ALLOWED_SCHEMAS includes '${plan.schema}', the counterparty`);
    console.log(`  scenario uses canonical demo SQL from the bootstrap module (not regex rewriting).`);
    console.log(`  Other scenarios without a dedicated demo helper fall back to schema rewriting.`);
    console.log('');
    console.log(`  Important: This bootstrap is for demo/proof setup only.`);
    console.log(`  The governed proof path remains strictly read-only.`);
  } else {
    console.log(`  ✗ ${result.message}`);
  }
  console.log('');
}

/**
 * PostgreSQL Demo Teardown — removes the demo schema.
 */
async function runPgDemoTeardown(): Promise<void> {
  const { runDemoTeardown } = await import('../connectors/postgres-demo.js');

  console.log(`\n  Attestor PostgreSQL Demo Teardown\n`);

  const result = await runDemoTeardown();
  if (result.success) {
    console.log(`  ✓ ${result.message}`);
  } else {
    console.log(`  ✗ ${result.message}`);
  }
  console.log('');
}

/**
 * Doctor — readiness check for real product proof.
 *
 * When Postgres is configured and the driver is available, runs a bounded
 * connectivity probe (SELECT version(), current_schemas, read-only txn).
 */
async function runDoctor(): Promise<void> {
  const { reportPostgresReadiness, isPostgresConfigured, runPostgresProbe } = await import('../connectors/postgres.js');
  const { existsSync } = await import('node:fs');

  console.log(`\n  Attestor Doctor — Product Proof Readiness`);
  console.log('');

  // Signing
  const hasKeyDir = existsSync('.attestor/private.pem');
  console.log(`  ${hasKeyDir ? '✓' : '○'} Signing key pair  ${hasKeyDir ? '.attestor/private.pem found' : 'Not found — run: npm run keygen'}`);

  // Model credentials
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  console.log(`  ${hasOpenAI ? '✓' : '○'} OpenAI API key    ${hasOpenAI ? 'Set' : 'Not set — needed for live model proof'}`);

  // PostgreSQL — surface readiness
  const pgReadiness = await reportPostgresReadiness();
  console.log(`  ${pgReadiness.runnable ? '✓' : pgReadiness.configured ? '△' : '○'} PostgreSQL         ${pgReadiness.message}`);

  // Deep Postgres probe when both URL and driver are present
  let pgProbeOk = false;
  if (pgReadiness.runnable) {
    console.log('');
    console.log(`  ── PostgreSQL Proof Probe ──`);
    const probe = await runPostgresProbe();
    for (const step of probe.steps) {
      console.log(`    ${step.passed ? '✓' : '✗'} ${step.step.padEnd(14)} ${step.detail}`);
      if (!step.passed && step.remediation) {
        console.log(`      → ${step.remediation}`);
      }
    }
    pgProbeOk = probe.success;
    if (probe.success) {
      console.log(`\n    Readiness: configured ✓  reachable ✓  read-only safe ✓  ready for prove ✓`);
    } else {
      // Find the first failed step for a targeted summary
      const failedStep = probe.steps.find(s => !s.passed);
      console.log(`\n    ✗ Probe failed at step: ${failedStep?.step ?? 'unknown'}`);
      console.log(`    ${probe.message}`);
    }
  }

  // SQLite
  console.log(`\n  ✓ SQLite (built-in)  Always available for fixture/local live proof`);

  console.log('');
  console.log(`  Proof modes:`);
  console.log(`    ✓ offline_fixture        — always available (fixture data)`);
  console.log(`    ${hasOpenAI ? '✓' : '○'} live_model             — ${hasOpenAI ? 'ready' : 'needs OPENAI_API_KEY'}`);
  console.log(`    ✓ live_runtime (SQLite)  — built-in local execution`);
  console.log(`    ${pgProbeOk ? '✓' : pgReadiness.runnable ? '△' : '○'} live_runtime (Postgres) — ${pgProbeOk ? 'verified and operational' : pgReadiness.runnable ? 'driver+URL present but probe not passed' : 'not ready'}`);

  // ── Repo-native demo proof path ──
  console.log('');
  console.log(`  ── Repo-Native Demo Proof Path ──`);
  console.log(`  The fastest way to a real PostgreSQL-backed proof from this repo:`);

  const demoSteps: string[] = [];
  if (!pgReadiness.configured) demoSteps.push(envSet('ATTESTOR_PG_URL', 'postgres://user:pass@host:5432/db'));
  if (!pgReadiness.driverInstalled) demoSteps.push('npm install pg');
  if (pgReadiness.runnable && !pgProbeOk) demoSteps.push('Fix PostgreSQL connectivity (see probe results above)');
  if (!hasKeyDir) demoSteps.push('npm run keygen');

  if (pgProbeOk) {
    // DB is reachable — show the exact demo sequence
    demoSteps.push('npx tsx src/financial/cli.ts pg-demo-init');
    demoSteps.push(envSet('ATTESTOR_PG_ALLOWED_SCHEMAS', 'attestor_demo'));
    if (hasKeyDir) {
      demoSteps.push('npm run prove -- counterparty .attestor');
    } else {
      demoSteps.push('npm run prove -- counterparty');
    }
    console.log(`  Commands for ${shellName()}:`);
    for (let i = 0; i < demoSteps.length; i++) {
      console.log(`    ${i + 1}. ${demoSteps[i]}`);
    }
    console.log('');
    console.log(`  This seeds a deterministic attestor_demo schema, then runs a real`);
    console.log(`  PostgreSQL-backed governed proof with signed certificate and kit.`);
    console.log(`  (Seeded demo data — not external production data.)`);
  } else {
    // Prerequisites not met
    for (let i = 0; i < demoSteps.length; i++) {
      console.log(`    ${i + 1}. ${demoSteps[i]}`);
    }
    console.log(`    Then:`);
    console.log(`      npx tsx src/financial/cli.ts pg-demo-init`);
    console.log(`      ${envSet('ATTESTOR_PG_ALLOWED_SCHEMAS', 'attestor_demo')}`);
    console.log(`      npm run prove -- counterparty`);
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
    let connectorArg: string | undefined;
    for (let i = 1; i < proveArgs.length; i++) {
      if (proveArgs[i] === '--reviewer-key-dir' && proveArgs[i + 1]) {
        reviewerKeyDirArg = proveArgs[++i];
      } else if (proveArgs[i] === '--connector' && proveArgs[i + 1]) {
        connectorArg = proveArgs[++i];
      } else if (!keyDirArg) {
        keyDirArg = proveArgs[i];
      }
    }
    await runProductProof(scenarioArg, keyDirArg, reviewerKeyDirArg, connectorArg);
    return;
  }

  if (command === 'multi-query') {
    await runMultiQueryDemo();
    return;
  }

  if (command === 'healthcare') {
    await runHealthcareDemo();
    return;
  }

  if (command === 'pg-demo-init') {
    await runPgDemoInit();
    return;
  }

  if (command === 'pg-demo-teardown') {
    await runPgDemoTeardown();
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
