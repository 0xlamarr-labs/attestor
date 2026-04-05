/**
 * Live Proof v1.1 — Truthful runtime evidence
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFinancialPipeline } from './pipeline.js';
import { verifyLiveProof, buildLiveProof, buildOfflineProof, assessLiveReadiness, buildLiveProofReviewerSummary } from './types.js';
import { verifyCapsule } from './capsule.js';
import { runBenchmarkCorpus, type BenchmarkEntry } from './replay.js';
import { executeSqliteQuery, materializeSqliteFixtureDatabases } from './execution.js';
import {
  COUNTERPARTY_SQL, COUNTERPARTY_INTENT, COUNTERPARTY_FIXTURE,
  COUNTERPARTY_REPORT_CONTRACT, COUNTERPARTY_REPORT, COUNTERPARTY_LIVE_DATABASES,
  LIQUIDITY_SQL, LIQUIDITY_INTENT, LIQUIDITY_FIXTURE,
  RECON_SQL, RECON_INTENT, RECON_FIXTURE,
  UNSAFE_SQL_WRITE, UNSAFE_SQL_INJECTION,
  HIGH_MAT_INTENT,
  CONTROL_TOTAL_INTENT,
} from './fixtures/scenarios.js';

let passed = 0;
function ok(condition: boolean, msg: string): void { assert(condition, msg); passed++; }

export async function runFinancialTests(): Promise<number> {
  passed = 0;
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  BANK-GRADE — Live Proof v1.1');
  console.log('══════════════════════════════════════════════════════════════');

  // ═══ LIVE PROOF ON PIPELINE RUN ═══
  console.log('\n  [Live Proof on Run]');
  {
    const r = runFinancialPipeline({ runId: 'lp-1', intent: COUNTERPARTY_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT });

    ok(r.liveProof !== undefined && r.liveProof !== null, 'LiveProof: present on report');
    ok(r.liveProof.mode === 'offline_fixture', 'LiveProof: mode=offline_fixture');
    ok(!r.liveProof.upstream.live, 'LiveProof: upstream not live');
    ok(!r.liveProof.execution.live, 'LiveProof: execution not live');
    ok(r.liveProof.execution.mode === 'fixture', 'LiveProof: execution=fixture');
    ok(r.liveProof.gaps.length >= 3, `LiveProof: ${r.liveProof.gaps.length} gaps`);
    ok(r.liveProof.consistent, 'LiveProof: consistent');
    ok(r.liveProof.replayIdentity === r.replayMetadata.replayIdentity, 'LiveProof: replay identity matches');

    console.log(`    LiveProof: mode=${r.liveProof.mode}, gaps=${r.liveProof.gaps.length}, consistent=${r.liveProof.consistent}`);
  }

  // ═══ PROOF-MODE VERIFICATION ═══
  console.log('\n  [Proof-Mode Verification]');
  {
    // Offline: consistent
    const offline = buildOfflineProof('test', 'replay');
    ok(verifyLiveProof(offline), 'Verify: offline consistent');

    // Fake inconsistent: offline mode but upstream.live=true
    const fake = buildLiveProof('test', 'replay', { upstream: { live: true } });
    ok(fake.mode !== 'offline_fixture', 'Fake: mode derived from evidence (not offline)');

    // Live model: upstream.live=true + provider + model
    const liveModel = buildLiveProof('test', 'replay', {
      upstream: { live: true, provider: 'anthropic', model: 'claude-opus-4.6' },
    });
    ok(liveModel.mode === 'live_model', 'LiveModel: mode=live_model');
    ok(verifyLiveProof(liveModel), 'LiveModel: consistent');
    ok(liveModel.gaps.some((g) => g.category === 'execution'), 'LiveModel: has execution gap (no live DB)');

    // Live runtime: execution.live=true + provider
    const liveRuntime = buildLiveProof('test', 'replay', {
      execution: { live: true, provider: 'duckdb', mode: 'live_db' },
    });
    ok(liveRuntime.mode === 'live_runtime', 'LiveRuntime: mode=live_runtime');
    ok(verifyLiveProof(liveRuntime), 'LiveRuntime: consistent');

    // Hybrid: both live
    const hybrid = buildLiveProof('test', 'replay', {
      upstream: { live: true, provider: 'openai', model: 'gpt-5.4' },
      execution: { live: true, provider: 'snowflake', mode: 'live_db' },
    });
    ok(hybrid.mode === 'hybrid', 'Hybrid: mode=hybrid');
    ok(verifyLiveProof(hybrid), 'Hybrid: consistent');
    ok(hybrid.gaps.length === 0 || hybrid.gaps.every((g) => g.category === 'cost'), 'Hybrid: minimal gaps');

    console.log(`    Modes: offline=${offline.mode}, liveModel=${liveModel.mode}, liveRuntime=${liveRuntime.mode}, hybrid=${hybrid.mode}`);
  }

  // ═══ LIVE PROOF IN ARTIFACTS ═══
  console.log('\n  [Live Proof in Artifacts]');
  {
    const r = runFinancialPipeline({ runId: 'lp-art', intent: COUNTERPARTY_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT });

    // Output pack
    ok(r.outputPack.liveProof !== null, 'Pack: liveProof present');
    ok(r.outputPack.liveProof!.mode === 'offline_fixture', 'Pack: mode=offline');
    ok(!r.outputPack.liveProof!.upstreamLive, 'Pack: upstream not live');
    ok(r.outputPack.liveProof!.gaps >= 3, 'Pack: has gaps');
    ok(r.outputPack.liveProof!.gapCategories.includes('model'), 'Pack: exposes gap categories');
    ok(r.outputPack.liveProof!.consistent, 'Pack: consistent');

    // Dossier
    ok(r.dossier.reviewerSummary.some((s) => s.category === 'live_proof'), 'Dossier: has live_proof');
    const lpSection = r.dossier.reviewerSummary.find((s) => s.category === 'live_proof')!;
    ok(lpSection.status === 'offline_fixture', 'Dossier: shows offline');
    ok(lpSection.detail.includes('gap_categories=model|execution|cost'), 'Dossier: gap categories visible');

    // Attestation + OpenLineage
    ok(r.attestation !== null, 'Attestation: present');
    ok(r.attestation!.liveProof.mode === 'offline_fixture', 'Attestation: carries proof mode');
    ok(r.attestation!.liveProof.gapCategories.includes('execution'), 'Attestation: carries proof gaps');
    ok(r.attestation!.liveProof.consistent, 'Attestation: proof consistent');

    ok(r.openLineageExport !== null, 'OpenLineage: present');
    ok(r.openLineageExport!.facets.attestor_liveProof.mode === 'offline_fixture', 'OpenLineage: carries proof mode');
    ok(r.openLineageExport!.facets.attestor_liveProof.gaps.includes('cost'), 'OpenLineage: carries proof gaps');
    ok(r.dossier.reviewerSummary.find((s) => s.category === 'attestation')?.status === 'unsigned', 'Dossier: attestation reflects final artifact');
    ok(r.dossier.reviewerSummary.find((s) => s.category === 'interop')?.status === 'exported', 'Dossier: interop reflects final export');

    // Synthetic runtime observation should propagate coherently through the artifact chain.
    const synthetic = runFinancialPipeline({
      runId: 'lp-synth',
      intent: COUNTERPARTY_INTENT,
      candidateSql: COUNTERPARTY_SQL,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      liveProof: {
        upstream: { live: true, provider: 'anthropic', model: 'claude-opus-4.6' },
      },
    });
    ok(synthetic.liveProof.mode === 'live_model', 'Pipeline: propagates synthetic live-model evidence');
    ok(synthetic.outputPack.liveProof!.mode === 'live_model', 'Pipeline: pack reflects synthetic live-model evidence');
    ok(synthetic.manifest.liveProof.mode === 'live_model', 'Pipeline: manifest reflects synthetic live-model evidence');

    console.log(`    Artifacts: pack=${r.outputPack.liveProof!.mode}, dossier=${lpSection.status}`);
  }

  // ═══ E2E PIPELINE ═══
  console.log('\n  [E2E Pipeline]');
  {
    ok(runFinancialPipeline({ runId: 'e1', intent: COUNTERPARTY_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT }).decision === 'pass', 'E2E: pass');
    ok(runFinancialPipeline({ runId: 'e2', intent: COUNTERPARTY_INTENT, candidateSql: UNSAFE_SQL_WRITE, fixtures: [] }).decision === 'block', 'E2E: block');
    ok(runFinancialPipeline({ runId: 'e3', intent: LIQUIDITY_INTENT, candidateSql: LIQUIDITY_SQL, fixtures: [LIQUIDITY_FIXTURE] }).decision === 'fail', 'E2E: fail');
    ok(runFinancialPipeline({ runId: 'e4', intent: HIGH_MAT_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT }).decision === 'pending_approval', 'E2E: pending');
    ok(runFinancialPipeline({ runId: 'e5', intent: HIGH_MAT_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT, approval: { status: 'approved', reviewerRole: 'o', reviewNote: 'y' } }).decision === 'pass', 'E2E: approved');
    ok(runFinancialPipeline({ runId: 'e6', intent: COUNTERPARTY_INTENT, candidateSql: UNSAFE_SQL_INJECTION, fixtures: [] }).decision === 'block', 'E2E: injection');
    ok(runFinancialPipeline({ runId: 'e7', intent: CONTROL_TOTAL_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT }).decision === 'fail', 'E2E: ct');

    const full = runFinancialPipeline({ runId: 'e-full', intent: COUNTERPARTY_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT });
    ok(full.capsule!.authorityState === 'authorized', 'E2E: capsule authorized');
    ok(full.receipt!.receiptStatus === 'issued', 'E2E: receipt issued');
    ok(full.liveProof.mode === 'offline_fixture', 'E2E: live proof offline');

    console.log('    E2E: all verified');
  }

  // ═══ BENCHMARK ═══
  console.log('\n  [Benchmark]');
  {
    ok(runBenchmarkCorpus([
      { scenario: { id: 'B1', description: 'Pass', category: 'pass', expectedFailureMode: null, expectedDecision: 'pass' }, input: { runId: 'b1', intent: COUNTERPARTY_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT } },
      { scenario: { id: 'B2', description: 'Block', category: 'sql_safety', expectedFailureMode: 'w', expectedDecision: 'block' }, input: { runId: 'b2', intent: COUNTERPARTY_INTENT, candidateSql: UNSAFE_SQL_WRITE, fixtures: [] } },
    ]).passed === 2, 'Benchmark: 2/2');
    console.log('    Benchmark: 2/2');
  }

  // ═══ LIVE READINESS ASSESSMENT v1.1 ═══
  console.log('\n  [Live Readiness Assessment v1.1]');
  {
    const readiness = assessLiveReadiness();
    ok(readiness.version === '1.1', 'Readiness: version 1.1');
    ok(readiness.exerciseType === 'readiness_only', 'Readiness: readiness_only (no live credentials in test env)');
    ok(readiness.availableModes.includes('offline_fixture'), 'Readiness: offline_fixture always available');
    ok(readiness.blockedModes.length > 0, 'Readiness: some modes blocked (no credentials)');
    ok(readiness.nextSteps.length > 0, 'Readiness: has actionable next steps');
    ok(readiness.authorityImpact.includes('not deny authority'), 'Readiness: authority impact explains no denial');
    ok(readiness.upstream.detail.length > 0, 'Readiness: upstream detail present');
    ok(readiness.execution.detail.length > 0, 'Readiness: execution detail present');

    console.log(`    Readiness: type=${readiness.exerciseType}, available=${readiness.availableModes.join(',')}, blocked=${readiness.blockedModes.length}, steps=${readiness.nextSteps.length}`);
  }

  // ═══ BOUNDED LIVE SQLITE EXECUTION ═══
  console.log('\n  [Bounded Live SQLite Execution]');
  {
    const tempDir = mkdtempSync(join(tmpdir(), 'attestor-fin-live-'));
    try {
      const snapshot = materializeSqliteFixtureDatabases(tempDir, COUNTERPARTY_LIVE_DATABASES);
      const execution = executeSqliteQuery(COUNTERPARTY_SQL, {
        provider: 'sqlite',
        bindings: snapshot.bindings,
      });
      ok(snapshot.sourceCount === 1, 'LiveSQLite: one source database materialized');
      ok(execution.success, 'LiveSQLite: query executes successfully');
      ok(execution.rowCount === 5, `LiveSQLite: expected 5 rows (got ${execution.rowCount})`);
      ok(execution.columns.join(',') === 'counterparty_name,exposure_usd,credit_rating,sector', 'LiveSQLite: expected columns preserved');
      console.log(`    LiveSQLite: rows=${execution.rowCount}, schemaHash=${execution.schemaHash}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // ═══ LIVE PIPELINE MODES ═══
  console.log('\n  [Live Pipeline Modes]');
  {
    const tempDir = mkdtempSync(join(tmpdir(), 'attestor-fin-pipeline-'));
    try {
      const snapshot = materializeSqliteFixtureDatabases(tempDir, COUNTERPARTY_LIVE_DATABASES);

      const runtimeOnly = runFinancialPipeline({
        runId: 'lp-runtime',
        intent: COUNTERPARTY_INTENT,
        candidateSql: COUNTERPARTY_SQL,
        fixtures: [],
        liveExecution: { provider: 'sqlite', bindings: snapshot.bindings },
        generatedReport: COUNTERPARTY_REPORT,
        reportContract: COUNTERPARTY_REPORT_CONTRACT,
      });
      ok(runtimeOnly.liveProof.mode === 'live_runtime', 'LivePipeline: runtime-only proof mode');
      ok(runtimeOnly.liveProof.execution.live, 'LivePipeline: execution marked live');
      ok(runtimeOnly.liveReadiness?.exerciseType === 'live_exercise', 'LivePipeline: runtime-only run marked live_exercise');
      ok(runtimeOnly.snapshot.sourceKind === 'live_db', 'LivePipeline: snapshot sourceKind=live_db');
      ok(runtimeOnly.outputPack.snapshot.sourceKind === 'live_db', 'LivePipeline: pack snapshot sourceKind=live_db');
      ok(!!runtimeOnly.dossier.reviewerSummary.find((s) => s.category === 'snapshot')?.detail.includes('live_db source'), 'LivePipeline: dossier snapshot detail reflects live_db');

      const hybrid = runFinancialPipeline({
        runId: 'lp-hybrid',
        intent: COUNTERPARTY_INTENT,
        candidateSql: COUNTERPARTY_SQL,
        fixtures: [],
        liveExecution: { provider: 'sqlite', bindings: snapshot.bindings },
        generatedReport: COUNTERPARTY_REPORT,
        reportContract: COUNTERPARTY_REPORT_CONTRACT,
        liveProof: {
          upstream: {
            provider: 'openai',
            model: 'o3',
            tokenUsage: { input: 128, output: 48 },
            latencyMs: 42,
            requestId: null,
            live: true,
          },
        },
      });
      ok(hybrid.liveProof.mode === 'hybrid', 'LivePipeline: hybrid proof mode');
      ok(hybrid.liveProof.gaps.length === 0, 'LivePipeline: hybrid has no proof gaps');
      ok(hybrid.liveReadiness?.exerciseType === 'live_exercise', 'LivePipeline: hybrid run marked live_exercise');
      ok(hybrid.decision === 'pass', 'LivePipeline: hybrid counterparty run passes');

      const readiness = assessLiveReadiness({ exerciseType: 'live_exercise', liveDbAvailable: true });
      ok(readiness.exerciseType === 'live_exercise', 'ReadinessOptions: exerciseType override applied');
      ok(readiness.execution.liveDbAvailable, 'ReadinessOptions: liveDbAvailable override applied');
      ok(readiness.availableModes.includes('live_runtime'), 'ReadinessOptions: live_runtime available when live DB present');

      console.log(`    LivePipeline: runtime=${runtimeOnly.liveProof.mode}, hybrid=${hybrid.liveProof.mode}, readiness=${readiness.exerciseType}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // ═══ LIVE READINESS ON PIPELINE RUN ═══
  console.log('\n  [Live Readiness on Pipeline Run]');
  {
    const r = runFinancialPipeline({ runId: 'lr-1', intent: COUNTERPARTY_INTENT, candidateSql: COUNTERPARTY_SQL, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT });
    ok(r.liveReadiness !== null, 'Pipeline: liveReadiness present');
    ok(r.liveReadiness!.version === '1.1', 'Pipeline: readiness version 1.1');
    ok(r.liveReadiness!.exerciseType === 'readiness_only', 'Pipeline: readiness_only');
    ok(r.outputPack.liveProof!.readiness === 'readiness_only', 'Pack: readiness propagated');
    ok(r.outputPack.liveProof!.availableModes !== null, 'Pack: availableModes propagated');
    ok(r.dossier.reviewerSummary.find((s) => s.category === 'live_proof')!.detail.includes('readiness=readiness_only'), 'Dossier: readiness visible');

    console.log(`    Pipeline readiness: ${r.liveReadiness!.exerciseType}, available modes in pack: ${r.outputPack.liveProof!.availableModes?.join(',')}`);
  }

  // ═══ REVIEWER SUMMARY ═══
  console.log('\n  [Reviewer Summary]');
  {
    const proof = buildOfflineProof('test', 'replay');
    const readiness = assessLiveReadiness();
    const summary = buildLiveProofReviewerSummary(proof, readiness);
    ok(summary.includes('Proof mode: offline_fixture'), 'Summary: includes mode');
    ok(summary.includes('Gaps'), 'Summary: includes gaps');
    ok(summary.includes('Readiness: readiness_only'), 'Summary: includes readiness');
    ok(summary.includes('Next steps'), 'Summary: includes next steps');
    ok(summary.includes('Blocked modes'), 'Summary: includes blocked modes');

    console.log(`    Summary length: ${summary.length} chars`);
  }

  // ── Semantic Clause Evaluation ──
  console.log('\n  [Semantic Clause Evaluation]');
  {
    const { evaluateSemanticClauses } = await import('./semantic-clauses.js');
    const { SemanticClause, ExecutionEvidence } = await import('./types.js') as any;

    // Mock execution evidence: counterparty exposure with known values
    const execEvidence = {
      success: true, durationMs: 12, rowCount: 3, error: null, schemaHash: 'test',
      columns: ['counterparty', 'gross_long', 'gross_short', 'net_exposure', 'exposure_usd', 'concentration_pct'],
      columnTypes: ['text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric'],
      rows: [
        { counterparty: 'JPM', gross_long: 1000000, gross_short: 400000, net_exposure: 600000, exposure_usd: 600000, concentration_pct: 0.15 },
        { counterparty: 'GS', gross_long: 800000, gross_short: 300000, net_exposure: 500000, exposure_usd: 500000, concentration_pct: 0.12 },
        { counterparty: 'MS', gross_long: 600000, gross_short: 200000, net_exposure: 400000, exposure_usd: 400000, concentration_pct: 0.10 },
      ],
    };

    // Test 1: Balance identity passes (net = gross_long - gross_short)
    const balanceClause = { id: 'SC-001', type: 'balance_identity' as const, description: 'Net exposure = gross long - gross short', expression: 'net_exposure = gross_long - gross_short', columns: ['net_exposure', 'gross_long', 'gross_short'], tolerance: 0.01, severity: 'hard' as const };
    const balanceResult = evaluateSemanticClauses([balanceClause], execEvidence);
    ok(balanceResult.performed, 'Semantic: balance identity evaluated');
    ok(balanceResult.passCount === 1, 'Semantic: balance identity passes');
    ok(balanceResult.hardFailCount === 0, 'Semantic: no hard failures');

    // Test 2: Control total passes (exposure_usd sums correctly)
    const controlClause = { id: 'SC-002', type: 'control_total' as const, description: 'Total exposure reconciliation', expression: 'exposure_usd = sum(exposure_usd)', columns: ['exposure_usd'], tolerance: 0.01, severity: 'hard' as const };
    const controlResult = evaluateSemanticClauses([controlClause], execEvidence);
    ok(controlResult.performed, 'Semantic: control total evaluated');
    ok(controlResult.passCount === 1, 'Semantic: control total passes');

    // Test 3: Sign constraint passes (all exposures non-negative)
    const signClause = { id: 'SC-003', type: 'sign_constraint' as const, description: 'Exposures must be non-negative', expression: 'exposure_usd >= 0', columns: ['exposure_usd'], tolerance: 0, severity: 'hard' as const };
    const signResult = evaluateSemanticClauses([signClause], execEvidence);
    ok(signResult.passCount === 1, 'Semantic: sign constraint passes');

    // Test 4: Ratio bound passes (concentration < 100%)
    const ratioClause = { id: 'SC-004', type: 'ratio_bound' as const, description: 'Concentration must be under 100%', expression: 'concentration_pct <= 1.0', columns: ['concentration_pct'], tolerance: 0, severity: 'soft' as const };
    const ratioResult = evaluateSemanticClauses([ratioClause], execEvidence);
    ok(ratioResult.passCount === 1, 'Semantic: ratio bound passes');

    // Test 5: Completeness check passes (no nulls)
    const completenessClause = { id: 'SC-005', type: 'completeness_check' as const, description: 'All exposure fields populated', expression: 'non-null', columns: ['counterparty', 'exposure_usd', 'concentration_pct'], tolerance: 0, severity: 'hard' as const };
    const completenessResult = evaluateSemanticClauses([completenessClause], execEvidence);
    ok(completenessResult.passCount === 1, 'Semantic: completeness passes');

    // Test 6: Balance identity HARD FAIL (wrong net values)
    const badExec = {
      ...execEvidence,
      rows: [
        { counterparty: 'JPM', gross_long: 1000000, gross_short: 400000, net_exposure: 999999, exposure_usd: 600000, concentration_pct: 0.15 },
        { counterparty: 'GS', gross_long: 800000, gross_short: 300000, net_exposure: 500000, exposure_usd: 500000, concentration_pct: 0.12 },
      ],
    };
    const failResult = evaluateSemanticClauses([balanceClause], badExec);
    ok(failResult.failCount === 1, 'Semantic: balance identity fails on wrong net');
    ok(failResult.hardFailCount === 1, 'Semantic: balance hard failure counted');
    ok(!failResult.evaluations[0].passed, 'Semantic: evaluation reports failure');
    ok(failResult.evaluations[0].variance !== null && failResult.evaluations[0].variance > 0, 'Semantic: variance reported');

    // Test 7: Sign constraint HARD FAIL (negative exposure)
    const negExec = {
      ...execEvidence,
      rows: [
        { counterparty: 'JPM', gross_long: 1000000, gross_short: 400000, net_exposure: 600000, exposure_usd: -100, concentration_pct: 0.15 },
      ],
    };
    const negResult = evaluateSemanticClauses([signClause], negExec);
    ok(negResult.failCount === 1, 'Semantic: sign constraint fails on negative');
    ok(negResult.hardFailCount === 1, 'Semantic: sign hard failure counted');

    // Test 8: Multiple clauses mixed results
    const mixedResult = evaluateSemanticClauses([balanceClause, signClause, ratioClause], badExec);
    ok(mixedResult.clauseCount === 3, 'Semantic: 3 clauses evaluated');
    ok(mixedResult.passCount >= 1, 'Semantic: some clauses pass');
    ok(mixedResult.failCount >= 1, 'Semantic: some clauses fail');

    // Test 9: No execution → not performed
    const noExecResult = evaluateSemanticClauses([balanceClause], null);
    ok(!noExecResult.performed, 'Semantic: null execution → not performed');

    console.log(`    Clauses: balance=${balanceResult.passCount === 1 ? '✓' : '✗'}, control=${controlResult.passCount === 1 ? '✓' : '✗'}, sign=${signResult.passCount === 1 ? '✓' : '✗'}, ratio=${ratioResult.passCount === 1 ? '✓' : '✗'}, complete=${completenessResult.passCount === 1 ? '✓' : '✗'}`);
    console.log(`    Failures: balance_bad=${failResult.hardFailCount}, negative=${negResult.hardFailCount}, mixed=${mixedResult.failCount}/${mixedResult.clauseCount}`);
  }

  // ── Semantic Clause Pipeline Integration ──
  console.log('\n  [Semantic Clause Pipeline Integration]');
  {
    const { runFinancialPipeline } = await import('./pipeline.js');
    const { COUNTERPARTY_SQL, COUNTERPARTY_INTENT, COUNTERPARTY_FIXTURE, COUNTERPARTY_REPORT_CONTRACT, COUNTERPARTY_REPORT } = await import('./fixtures/scenarios.js');

    // Scenario 1: Pipeline with passing semantic clauses → decision unaffected
    // Uses actual counterparty fixture columns: counterparty_name, exposure_usd, credit_rating, sector
    const passingClauses = [
      { id: 'SC-P01', type: 'sign_constraint' as const, description: 'Exposures non-negative', expression: 'exposure_usd >= 0', columns: ['exposure_usd'], tolerance: 0, severity: 'hard' as const },
      { id: 'SC-P02', type: 'completeness_check' as const, description: 'Key fields populated', expression: 'non-null', columns: ['counterparty_name', 'exposure_usd'], tolerance: 0, severity: 'soft' as const },
    ];
    const passReport = runFinancialPipeline({
      runId: 'sem-pass-test',
      intent: COUNTERPARTY_INTENT,
      candidateSql: COUNTERPARTY_SQL,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      semanticClauses: passingClauses,
    });
    ok(passReport.decision === 'pass', 'Pipeline+Semantic: passing clauses → decision still pass');
    ok(passReport.semanticClauses !== null, 'Pipeline+Semantic: clause result present');
    ok(passReport.semanticClauses!.performed, 'Pipeline+Semantic: clauses evaluated');
    ok(passReport.semanticClauses!.hardFailCount === 0, 'Pipeline+Semantic: no hard failures');
    ok(passReport.semanticClauses!.passCount === 2, 'Pipeline+Semantic: both clauses pass');
    // Check artifact surfacing
    ok(passReport.outputPack.semanticClauses !== null, 'Pipeline+Semantic: output pack has semantic summary');
    ok(passReport.outputPack.semanticClauses!.performed, 'Pipeline+Semantic: output pack shows performed');
    // Check audit trail contains semantic entry
    ok(passReport.audit.entries.some((e) => e.stage === 'semantic_clauses'), 'Pipeline+Semantic: audit trail has semantic entry');

    // Scenario 2: Pipeline with hard-failing semantic clause → decision becomes 'fail'
    // Intentionally wrong constraint: exposure_usd must be negative (all values are positive)
    const failingClauses = [
      { id: 'SC-F01', type: 'sign_constraint' as const, description: 'Exposure must be negative (intentionally wrong)', expression: 'exposure_usd < 0', columns: ['exposure_usd'], tolerance: 0, severity: 'hard' as const },
    ];
    const failReport = runFinancialPipeline({
      runId: 'sem-fail-test',
      intent: COUNTERPARTY_INTENT,
      candidateSql: COUNTERPARTY_SQL,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      semanticClauses: failingClauses,
    });
    ok(failReport.decision === 'fail', 'Pipeline+Semantic: hard clause failure → decision fail');
    ok(failReport.semanticClauses!.hardFailCount === 1, 'Pipeline+Semantic: 1 hard failure');
    ok(failReport.semanticClauses!.evaluations[0].explanation.includes('violate'), 'Pipeline+Semantic: explanation mentions violation');
    // Check dossier blockers
    ok(failReport.dossier.blockers.some((b) => b.source.includes('semantic_clause')), 'Pipeline+Semantic: dossier has semantic blocker');
    // Check output pack
    ok(failReport.outputPack.semanticClauses!.hardFailCount === 1, 'Pipeline+Semantic: output pack shows hard fail');
    ok(failReport.outputPack.semanticClauses!.failedClauses.length === 1, 'Pipeline+Semantic: output pack lists failed clause');

    // Scenario 3: Pipeline without semantic clauses → null result, decision unaffected
    const noClauseReport = runFinancialPipeline({
      runId: 'sem-none-test',
      intent: COUNTERPARTY_INTENT,
      candidateSql: COUNTERPARTY_SQL,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
    });
    ok(noClauseReport.semanticClauses === null, 'Pipeline+Semantic: no clauses → null result');
    ok(noClauseReport.decision === 'pass', 'Pipeline+Semantic: no clauses → decision unaffected');

    console.log(`    Pass scenario: decision=${passReport.decision}, clauses=${passReport.semanticClauses!.passCount}/${passReport.semanticClauses!.clauseCount}`);
    console.log(`    Fail scenario: decision=${failReport.decision}, hard_fails=${failReport.semanticClauses!.hardFailCount}, blockers=${failReport.dossier.blockers.filter((b) => b.source.includes('semantic')).length}`);
    console.log(`    No-clause scenario: decision=${noClauseReport.decision}, clauses=${noClauseReport.semanticClauses}`);
  }

  // ── Workflow-Bound Reviewer Identity ──
  console.log('\n  [Workflow-Bound Reviewer Identity]');
  {
    const { runFinancialPipeline } = await import('./pipeline.js');
    const { COUNTERPARTY_SQL, COUNTERPARTY_INTENT, COUNTERPARTY_FIXTURE, COUNTERPARTY_REPORT_CONTRACT, COUNTERPARTY_REPORT } = await import('./fixtures/scenarios.js');

    // Scenario: Approved run with reviewer identity
    const reviewerIdentity = {
      name: 'Jane Chen',
      role: 'risk_officer',
      identifier: 'jchen@bank.internal',
      signerFingerprint: null, // not yet Ed25519-signed
    };
    const approvedReport = runFinancialPipeline({
      runId: 'reviewer-id-test',
      intent: { ...COUNTERPARTY_INTENT, materialityTier: 'high' as const },
      candidateSql: COUNTERPARTY_SQL,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      approval: { status: 'approved', reviewerRole: 'risk_officer', reviewNote: 'Exposure within limits', reviewerIdentity },
    });

    // Reviewer identity propagates
    ok(approvedReport.oversight.reviewerIdentity !== null, 'Reviewer: identity present in oversight');
    ok(approvedReport.oversight.reviewerIdentity!.name === 'Jane Chen', 'Reviewer: name preserved');
    ok(approvedReport.oversight.reviewerIdentity!.role === 'risk_officer', 'Reviewer: role preserved');
    ok(approvedReport.oversight.reviewerIdentity!.identifier === 'jchen@bank.internal', 'Reviewer: identifier preserved');
    ok(approvedReport.oversight.reviewerIdentity!.signerFingerprint === null, 'Reviewer: unsigned (no fingerprint yet)');

    // Decision should be approved (not pending) since approval was provided
    ok(approvedReport.decision === 'pass', 'Reviewer: approved high-materiality → decision pass');

    // Reviewer identity in output pack
    ok(approvedReport.outputPack.oversight.reviewerIdentity !== null, 'Reviewer: identity in output pack');
    ok(approvedReport.outputPack.oversight.reviewerIdentity!.name === 'Jane Chen', 'Reviewer: output pack name');

    // Reviewer identity in dossier
    ok(approvedReport.dossier.reviewPath.reviewerIdentity !== null, 'Reviewer: identity in dossier');
    ok(approvedReport.dossier.reviewPath.reviewerIdentity!.identifier === 'jchen@bank.internal', 'Reviewer: dossier identifier');

    // Without reviewer identity — null
    const noIdReport = runFinancialPipeline({
      runId: 'reviewer-noid-test',
      intent: { ...COUNTERPARTY_INTENT, materialityTier: 'high' as const },
      candidateSql: COUNTERPARTY_SQL,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      approval: { status: 'approved', reviewerRole: 'risk_officer', reviewNote: 'OK' },
    });
    ok(noIdReport.oversight.reviewerIdentity === null, 'Reviewer: no identity when not provided');

    console.log(`    With identity: reviewer=${approvedReport.oversight.reviewerIdentity!.name}, role=${approvedReport.oversight.reviewerIdentity!.role}, decision=${approvedReport.decision}`);
    console.log(`    Without identity: reviewerIdentity=${noIdReport.oversight.reviewerIdentity}`);

    // Test: Role normalization — identity role overrides approval.reviewerRole
    const mismatchReport = runFinancialPipeline({
      runId: 'reviewer-mismatch-test',
      intent: { ...COUNTERPARTY_INTENT, materialityTier: 'high' as const },
      candidateSql: COUNTERPARTY_SQL,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      approval: { status: 'approved', reviewerRole: 'old_role', reviewNote: 'OK', reviewerIdentity: { name: 'Bob Lee', role: 'compliance_officer', identifier: 'blee@bank.internal', signerFingerprint: null } },
    });
    ok(mismatchReport.oversight.reviewerRole === 'compliance_officer', 'Reviewer: identity role overrides approval.reviewerRole');
    ok(mismatchReport.oversight.reviewerIdentity!.role === 'compliance_officer', 'Reviewer: identity role consistent');

    // Test: Endorsement created when identity is provided
    ok(mismatchReport.oversight.endorsement !== null, 'Endorsement: created when identity provided');
    ok(mismatchReport.oversight.endorsement!.reviewer.name === 'Bob Lee', 'Endorsement: reviewer name');
    ok(mismatchReport.oversight.endorsement!.endorsedDecision === 'approved', 'Endorsement: endorsed decision');
    ok(mismatchReport.oversight.endorsement!.rationale === 'OK', 'Endorsement: rationale');
    ok(mismatchReport.oversight.endorsement!.scope.includes('output_pack'), 'Endorsement: scope includes output_pack');
    ok(mismatchReport.oversight.endorsement!.signature === null, 'Endorsement: unsigned (no Ed25519 yet)');

    // Test: Endorsement in output pack
    ok(mismatchReport.outputPack.oversight.endorsement !== null, 'Endorsement: present in output pack');
    ok(mismatchReport.outputPack.oversight.endorsement!.reviewerName === 'Bob Lee', 'Endorsement: output pack reviewer name');
    ok(mismatchReport.outputPack.oversight.endorsement!.signed === false, 'Endorsement: output pack unsigned');

    // Test: No endorsement when no identity
    ok(noIdReport.oversight.endorsement === null, 'Endorsement: null when no identity');

    console.log(`    Role normalization: approval.role='old_role', identity.role='${mismatchReport.oversight.reviewerRole}' → identity wins`);
    console.log(`    Endorsement: reviewer=${mismatchReport.oversight.endorsement!.reviewer.name}, decision=${mismatchReport.oversight.endorsement!.endorsedDecision}, signed=${mismatchReport.oversight.endorsement!.signature !== null}`);

    // Test: Endorsement in dossier review path
    ok(mismatchReport.dossier.reviewPath.endorsement !== null, 'Dossier: endorsement present in review path');
    ok(mismatchReport.dossier.reviewPath.endorsement!.reviewerName === 'Bob Lee', 'Dossier: endorsement reviewer name');
    ok(mismatchReport.dossier.reviewPath.endorsement!.signed === false, 'Dossier: endorsement unsigned');

    // Test: Reviewer-signed endorsement with Ed25519
    const { generateKeyPair: genReviewerKey } = await import('../signing/keys.js');
    const { verifyReviewerEndorsement } = await import('../signing/reviewer-endorsement.js');
    const reviewerKeyPair = genReviewerKey();

    const signedReport = runFinancialPipeline({
      runId: 'reviewer-signed-test',
      intent: { ...COUNTERPARTY_INTENT, materialityTier: 'high' as const },
      candidateSql: COUNTERPARTY_SQL,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      approval: {
        status: 'approved',
        reviewerRole: 'risk_officer',
        reviewNote: 'Exposure within approved limits',
        reviewerIdentity: { name: 'Alice Park', role: 'risk_officer', identifier: 'apark@bank.internal', signerFingerprint: null },
        reviewerKeyPair,
      },
    });

    // Endorsement is signed
    ok(signedReport.oversight.endorsement !== null, 'Signed: endorsement exists');
    ok(signedReport.oversight.endorsement!.signature !== null, 'Signed: endorsement has signature');
    ok(signedReport.oversight.endorsement!.signature!.length === 128, 'Signed: signature is 64 bytes (128 hex)');
    ok(signedReport.oversight.endorsement!.reviewer.signerFingerprint === reviewerKeyPair.fingerprint, 'Signed: reviewer fingerprint set');

    // Verify the endorsement independently
    const verifyResult = verifyReviewerEndorsement(signedReport.oversight.endorsement!, reviewerKeyPair.publicKeyPem);
    ok(verifyResult.valid, 'Signed: endorsement signature valid');
    ok(verifyResult.fingerprintMatch, 'Signed: fingerprint matches');

    // Tamper detection
    const tampered = { ...signedReport.oversight.endorsement!, rationale: 'TAMPERED' };
    const tamperVerify = verifyReviewerEndorsement(tampered, reviewerKeyPair.publicKeyPem);
    ok(!tamperVerify.valid, 'Signed: tampered endorsement fails verification');

    // Endorsement surfaced as signed in artifacts
    ok(signedReport.outputPack.oversight.endorsement!.signed === true, 'Signed: output pack shows signed=true');
    ok(signedReport.dossier.reviewPath.endorsement!.signed === true, 'Signed: dossier shows signed=true');

    console.log(`    Signed endorsement: reviewer=${signedReport.oversight.endorsement!.reviewer.name}, fingerprint=${signedReport.oversight.endorsement!.reviewer.signerFingerprint}, verified=${verifyResult.valid}`);
  }

  console.log(`\n  Financial Tests: ${passed} passed, 0 failed\n`);
  return passed;
}

// Auto-run when executed directly
runFinancialTests().then((passed) => {
  process.exit(passed > 0 ? 0 : 1);
}).catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
