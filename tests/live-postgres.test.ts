/**
 * LIVE PostgreSQL Integration Tests
 *
 * These are NOT mocks. This test:
 * 1. Starts a real embedded PostgreSQL instance
 * 2. Bootstraps the demo schema with real SQL DDL/DML
 * 3. Runs real governed queries against real PostgreSQL
 * 4. Verifies real execution evidence, predictive guardrails, and proof markers
 * 5. Stops the database
 *
 * Run: npx tsx tests/live-postgres.test.ts
 */

import { strict as assert } from 'node:assert';
import EmbeddedPostgres from 'embedded-postgres';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

let passed = 0;
function ok(condition: boolean, msg: string): void { assert(condition, msg); passed++; }

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  LIVE POSTGRESQL INTEGRATION TESTS — Real DB, Real SQL');
  console.log('══════════════════════════════════════════════════════════════\n');

  const dataDir = join('.attestor', 'test-pg-data');
  try { rmSync(dataDir, { recursive: true }); } catch {}
  mkdirSync(dataDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'test_attestor',
    password: 'test_attestor',
    port: 15433,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    // ── Start real PostgreSQL ──
    console.log('  Starting embedded PostgreSQL...');
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_test');
    console.log('  ✓ PostgreSQL 18.3 running on port 15433\n');

    const pgUrl = 'postgres://test_attestor:test_attestor@localhost:15433/attestor_test';
    process.env.ATTESTOR_PG_URL = pgUrl;
    process.env.ATTESTOR_PG_ALLOWED_SCHEMAS = 'attestor_demo';

    // ═══ CONNECTIVITY PROBE ═══
    console.log('  [Probe]');
    {
      const { runPostgresProbe } = await import('../src/connectors/postgres.js');
      const probe = await runPostgresProbe();
      ok(probe.success, 'Probe: all steps passed');
      ok(probe.serverVersion !== null, 'Probe: server version detected');
      ok(probe.serverVersion!.includes('PostgreSQL'), 'Probe: is PostgreSQL');
      ok(probe.steps.every(s => s.passed), 'Probe: every step passed');
      ok(probe.steps.some(s => s.step === 'readonly_txn'), 'Probe: readonly_txn tested');
      console.log(`    ${probe.serverVersion?.split(',')[0]}, ${probe.steps.length} steps passed`);
    }

    // ═══ DEMO BOOTSTRAP ═══
    console.log('\n  [Bootstrap]');
    {
      const { runDemoBootstrap } = await import('../src/connectors/postgres-demo.js');
      const result = await runDemoBootstrap();
      ok(result.success, 'Bootstrap: succeeded');
      ok(result.tables.length === 3, 'Bootstrap: 3 tables created');
      ok(result.rowCounts['counterparty_exposures'] === 6, 'Bootstrap: 6 counterparty rows');
      ok(result.rowCounts['liquidity_buffer'] === 3, 'Bootstrap: 3 liquidity rows');
      ok(result.rowCounts['position_reconciliation'] === 3, 'Bootstrap: 3 recon rows');
      console.log(`    ${result.tables.length} tables, ${Object.values(result.rowCounts).reduce((a,b)=>a+b, 0)} total rows`);
    }

    // ═══ REAL QUERY EXECUTION ═══
    console.log('\n  [Real Query Execution]');
    {
      const { executePostgresQuery, loadPostgresConfig } = await import('../src/connectors/postgres.js');
      const config = loadPostgresConfig()!;
      const { getDemoCounterpartySql } = await import('../src/connectors/postgres-demo.js');
      const sql = getDemoCounterpartySql();

      const result = await executePostgresQuery(sql, config);
      ok(result.success, 'Query: execution succeeded');
      ok(result.rowCount === 5, 'Query: 5 rows returned (date-filtered)');
      ok(result.columns.includes('counterparty_name'), 'Query: has counterparty_name column');
      ok(result.columns.includes('exposure_usd'), 'Query: has exposure_usd column');
      ok(result.executionContextHash !== null, 'Query: context hash present');
      ok(result.executionContextHash!.length === 16, 'Query: context hash is 16 hex chars');
      ok(result.durationMs >= 0, 'Query: duration recorded');

      // Verify actual data
      const bnova = result.rows.find((r: any) => r.counterparty_name === 'Bank of Nova Scotia');
      ok(bnova !== undefined, 'Query: Bank of Nova Scotia in results');
      ok((bnova as any).exposure_usd == 250000000, 'Query: BNS exposure = 250M');
      console.log(`    ${result.rowCount} rows, ${result.durationMs}ms, context=${result.executionContextHash}`);
    }

    // ═══ PREDICTIVE GUARDRAIL (real EXPLAIN) ═══
    console.log('\n  [Predictive Guardrail — Real EXPLAIN]');
    {
      const { runPredictivePreflight } = await import('../src/connectors/predictive-guardrails.js');
      const { getDemoCounterpartySql } = await import('../src/connectors/postgres-demo.js');
      const sql = getDemoCounterpartySql();

      const preflight = await runPredictivePreflight(sql, pgUrl);
      ok(preflight.performed, 'Preflight: performed');
      ok(preflight.riskLevel === 'low', 'Preflight: low risk (small table)');
      ok(preflight.recommendation === 'proceed', 'Preflight: proceed');
      ok(preflight.plannerEvidence !== null, 'Preflight: planner evidence present');
      ok(preflight.plannerEvidence!.estimatedRows >= 0, 'Preflight: row estimate present');
      ok(preflight.plannerEvidence!.nodeTypes.length > 0, 'Preflight: node types present');
      console.log(`    risk=${preflight.riskLevel}, rows~${preflight.plannerEvidence!.estimatedRows}, nodes=${preflight.plannerEvidence!.nodeTypes.join(',')}`);
    }

    // ═══ FULL GOVERNED PROOF RUN ═══
    console.log('\n  [Full Governed Proof — Real PostgreSQL]');
    {
      const { runPostgresProve } = await import('../src/connectors/postgres-prove.js');
      const { getDemoCounterpartySql } = await import('../src/connectors/postgres-demo.js');
      const { runFinancialPipeline } = await import('../src/financial/pipeline.js');
      const { generateKeyPair } = await import('../src/signing/keys.js');
      const { buildVerificationKit } = await import('../src/signing/bundle.js');
      const { verifyCertificate } = await import('../src/signing/certificate.js');
      const { COUNTERPARTY_INTENT, COUNTERPARTY_FIXTURE, COUNTERPARTY_REPORT, COUNTERPARTY_REPORT_CONTRACT } = await import('../src/financial/fixtures/scenarios.js');

      const demoSql = getDemoCounterpartySql();
      const pgResult = await runPostgresProve(demoSql);
      ok(pgResult.attempted, 'Prove: attempted');
      ok(pgResult.execution !== null, 'Prove: execution present');
      ok(pgResult.execution!.success, 'Prove: execution succeeded');
      ok(pgResult.execution!.rowCount === 5, 'Prove: 5 rows');
      ok(pgResult.postgresEvidence.executionContextHash !== null, 'Prove: context hash');

      // Run full governed pipeline with real PG evidence
      const keyPair = generateKeyPair();
      const report = runFinancialPipeline({
        runId: `live-pg-test-${Date.now()}`,
        intent: { ...COUNTERPARTY_INTENT, allowedSchemas: ['attestor_demo'] },
        candidateSql: demoSql,
        fixtures: [COUNTERPARTY_FIXTURE],
        generatedReport: COUNTERPARTY_REPORT,
        reportContract: COUNTERPARTY_REPORT_CONTRACT,
        signingKeyPair: keyPair,
        externalExecution: pgResult.execution!,
        liveProof: {
          collectedAt: new Date().toISOString(),
          execution: { live: true, provider: 'postgres', mode: 'live_db' as const, latencyMs: pgResult.execution!.durationMs ?? null },
        },
        predictiveGuardrail: pgResult.predictiveGuardrail,
      });

      ok(report.liveProof.mode === 'live_runtime' || report.liveProof.mode === 'hybrid', 'Pipeline: live proof mode');
      ok(report.liveProof.execution.live, 'Pipeline: execution is live');
      ok(report.liveProof.execution.provider === 'postgres', 'Pipeline: provider = postgres');
      ok(report.certificate !== null, 'Pipeline: certificate issued');
      ok(report.audit.chainIntact, 'Pipeline: audit chain intact');

      // Verify certificate
      const certVerify = verifyCertificate(report.certificate!, keyPair.publicKeyPem);
      ok(certVerify.signatureValid, 'Certificate: signature valid');
      ok(certVerify.overall === 'valid', 'Certificate: overall valid');

      // Build and verify kit
      const kit = buildVerificationKit(report, keyPair.publicKeyPem);
      ok(kit !== null, 'Kit: built');
      ok(kit!.verification.cryptographic.valid, 'Kit: crypto valid');
      ok(kit!.verification.proofCompleteness.executionLive, 'Kit: execution live');
      ok(kit!.verification.proofCompleteness.executionProvider === 'postgres', 'Kit: provider=postgres');
      ok(kit!.verification.proofCompleteness.hasDbContextEvidence, 'Kit: DB context evidence');

      console.log(`    decision=${report.decision}, proof=${report.liveProof.mode}, provider=postgres`);
      console.log(`    cert=${report.certificate!.certificateId}, kit=${kit!.verification.overall}`);
      console.log(`    context=${pgResult.postgresEvidence.executionContextHash}`);
    }

    // ═══ DEMO TEARDOWN ═══
    console.log('\n  [Teardown]');
    {
      const { runDemoTeardown } = await import('../src/connectors/postgres-demo.js');
      const result = await runDemoTeardown();
      ok(result.success, 'Teardown: succeeded');
      console.log(`    ${result.message}`);
    }

    console.log(`\n  Live PostgreSQL Tests: ${passed} passed, 0 failed\n`);

  } finally {
    await pg.stop();
    console.log('  PostgreSQL stopped.\n');
    try { rmSync(dataDir, { recursive: true }); } catch {}
  }
}

run().catch(err => {
  console.error('  LIVE PG TEST CRASHED:', err);
  process.exit(1);
});
