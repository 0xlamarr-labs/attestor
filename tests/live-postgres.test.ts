/**
 * LIVE PostgreSQL Integration Tests
 *
 * Real DB, real SQL, real API surface.
 */

import { strict as assert } from 'node:assert';
import EmbeddedPostgres from 'embedded-postgres';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resetSchemaAttestationHistoryForTests } from '../src/connectors/schema-attestation-history.js';

let passed = 0;
function ok(condition: boolean, msg: string): void {
  assert(condition, msg);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

async function waitForReady(base: string, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    try {
      const response = await fetch(`${base}/api/v1/ready`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for API readiness at ${base}.`);
}

async function run() {
  console.log('\n================================================================');
  console.log('  LIVE POSTGRESQL INTEGRATION TESTS - Real DB, Real SQL');
  console.log('================================================================\n');

  mkdirSync('.attestor', { recursive: true });
  const dataDir = mkdtempSync(join('.attestor', 'test-pg-data-'));
  const port = await reservePort();

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'test_attestor',
    password: 'test_attestor',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    console.log('  Starting embedded PostgreSQL...');
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_test');
    console.log(`  OK PostgreSQL 18.3 running on port ${port}\n`);

    const pgUrl = `postgres://test_attestor:test_attestor@localhost:${port}/attestor_test`;
    process.env.ATTESTOR_PG_URL = pgUrl;
    process.env.ATTESTOR_PG_ALLOWED_SCHEMAS = 'attestor_demo';
    process.env.ATTESTOR_SCHEMA_ATTESTATION_HISTORY_PATH = join(dataDir, 'schema-attestation-history.json');
    process.env.ATTESTOR_SCHEMA_CONTENT_HASH_MAX_ROWS = '1000';
    resetSchemaAttestationHistoryForTests();

    console.log('  [Probe]');
    {
      const { runPostgresProbe } = await import('../src/connectors/postgres.js');
      const probe = await runPostgresProbe();
      ok(probe.success, 'Probe: all steps passed');
      ok(probe.serverVersion !== null, 'Probe: server version detected');
      ok(probe.serverVersion!.includes('PostgreSQL'), 'Probe: is PostgreSQL');
      ok(probe.steps.every((step) => step.passed), 'Probe: every step passed');
      ok(probe.steps.some((step) => step.step === 'readonly_txn'), 'Probe: readonly_txn tested');
      console.log(`    ${probe.serverVersion?.split(',')[0]}, ${probe.steps.length} steps passed`);
    }

    console.log('\n  [Bootstrap]');
    {
      const { runDemoBootstrap } = await import('../src/connectors/postgres-demo.js');
      const result = await runDemoBootstrap();
      ok(result.success, 'Bootstrap: succeeded');
      ok(result.tables.length === 3, 'Bootstrap: 3 tables created');
      ok(result.rowCounts.counterparty_exposures === 6, 'Bootstrap: 6 counterparty rows');
      ok(result.rowCounts.liquidity_buffer === 3, 'Bootstrap: 3 liquidity rows');
      ok(result.rowCounts.position_reconciliation === 3, 'Bootstrap: 3 recon rows');
      console.log(`    ${result.tables.length} tables, ${Object.values(result.rowCounts).reduce((left, right) => left + right, 0)} total rows`);
    }

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

      const bnova = result.rows.find((row: any) => row.counterparty_name === 'Bank of Nova Scotia');
      ok(bnova !== undefined, 'Query: Bank of Nova Scotia in results');
      ok((bnova as any).exposure_usd == 250000000, 'Query: BNS exposure = 250M');
      console.log(`    ${result.rowCount} rows, ${result.durationMs}ms, context=${result.executionContextHash}`);
    }

    console.log('\n  [Predictive Guardrail - Real EXPLAIN]');
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

    console.log('\n  [Full Governed Proof - Real PostgreSQL]');
    {
      const { runPostgresProve } = await import('../src/connectors/postgres-prove.js');
      const { getDemoCounterpartySql } = await import('../src/connectors/postgres-demo.js');
      const { runFinancialPipeline } = await import('../src/financial/pipeline.js');
      const { generateKeyPair } = await import('../src/signing/keys.js');
      const { buildVerificationKit } = await import('../src/signing/bundle.js');
      const { verifyCertificate } = await import('../src/signing/certificate.js');
      const {
        COUNTERPARTY_INTENT,
        COUNTERPARTY_FIXTURE,
        COUNTERPARTY_REPORT,
        COUNTERPARTY_REPORT_CONTRACT,
      } = await import('../src/financial/fixtures/scenarios.js');

      const demoSql = getDemoCounterpartySql();
      const pgResult = await runPostgresProve(demoSql);
      ok(pgResult.attempted, 'Prove: attempted');
      ok(pgResult.execution !== null, 'Prove: execution present');
      ok(pgResult.execution!.success, 'Prove: execution succeeded');
      ok(pgResult.execution!.rowCount === 5, 'Prove: 5 rows');
      ok(pgResult.postgresEvidence.executionContextHash !== null, 'Prove: context hash');
      ok(pgResult.schemaAttestation !== null, 'Prove: schema attestation captured');
      ok(pgResult.schemaAttestation!.constraintFingerprint.length === 32, 'Prove: constraint fingerprint present');
      ok(pgResult.schemaAttestation!.indexFingerprint.length === 32, 'Prove: index fingerprint present');
      ok(pgResult.schemaAttestation!.contentFingerprint.length === 32, 'Prove: content fingerprint present');
      ok(Boolean(pgResult.schemaAttestation!.txidSnapshot), 'Prove: txid snapshot captured');
      ok(pgResult.schemaAttestation!.tableContentFingerprints.length === 1, 'Prove: per-table content fingerprint captured');
      ok(pgResult.schemaAttestation!.tableContentFingerprints[0]!.mode === 'full', 'Prove: content hash is full for demo table');
      ok(pgResult.historicalComparison === null, 'Prove: first attestation has no history diff yet');

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

      const certVerify = verifyCertificate(report.certificate!, keyPair.publicKeyPem);
      ok(certVerify.signatureValid, 'Certificate: signature valid');
      ok(certVerify.overall === 'valid', 'Certificate: overall valid');

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

    console.log('\n  [Historical Attestation Comparison]');
    {
      const { runPostgresProve } = await import('../src/connectors/postgres-prove.js');
      const { getDemoCounterpartySql } = await import('../src/connectors/postgres-demo.js');
      const pgModule = await (Function('return import("pg")')() as Promise<any>);
      const PgClient = pgModule.default?.Client ?? pgModule.Client;
      const client = new PgClient({ connectionString: pgUrl });
      await client.connect();
      await client.query(`
        UPDATE attestor_demo.counterparty_exposures
        SET exposure_usd = exposure_usd + 1000
        WHERE counterparty_name = 'Bank of Nova Scotia'
      `);
      await client.end();

      const second = await runPostgresProve(getDemoCounterpartySql());
      ok(second.schemaAttestation !== null, 'Historical compare: second attestation captured');
      ok(second.historicalComparison !== null, 'Historical compare: previous snapshot found');
      ok(second.historicalComparison!.schemaChanged === false, 'Historical compare: schema unchanged');
      ok(second.historicalComparison!.dataChanged === true, 'Historical compare: data changed');
      ok(second.historicalComparison!.contentChanged === true, 'Historical compare: content hash changed');
      ok(second.historicalComparison!.summary.includes('counterparty_exposures'), 'Historical compare: changed table named');
      console.log(`    ${second.historicalComparison!.summary}`);
    }

    console.log('\n  [API Schema Attestation Surface]');
    {
      const { getDemoCounterpartySql } = await import('../src/connectors/postgres-demo.js');
      const {
        COUNTERPARTY_FIXTURE,
        COUNTERPARTY_INTENT,
        COUNTERPARTY_REPORT,
        COUNTERPARTY_REPORT_CONTRACT,
      } = await import('../src/financial/fixtures/scenarios.js');
      const apiPort = await reservePort();
      const { startServer } = await import('../src/service/api-server.js');
      const base = `http://127.0.0.1:${apiPort}`;
      const server = startServer(apiPort);
      try {
        await waitForReady(base);
        const pipelineRes = await fetch(`${base}/api/v1/pipeline/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: { ...COUNTERPARTY_INTENT, allowedSchemas: ['attestor_demo'] },
            candidateSql: getDemoCounterpartySql(),
            fixtures: [COUNTERPARTY_FIXTURE],
            generatedReport: COUNTERPARTY_REPORT,
            reportContract: COUNTERPARTY_REPORT_CONTRACT,
            connector: 'postgres-prove',
          }),
        });
        ok(pipelineRes.status === 200, 'API schema attestation surface: pipeline run 200');
        const pipelineBody = await pipelineRes.json() as any;
        ok(pipelineBody.schemaAttestation?.scope === 'schema_attestation_full', 'API schema attestation surface: full scope');
        ok(typeof pipelineBody.schemaAttestation?.constraintFingerprint === 'string', 'API schema attestation surface: constraint fingerprint exposed');
        ok(typeof pipelineBody.schemaAttestation?.indexFingerprint === 'string', 'API schema attestation surface: index fingerprint exposed');
        ok(typeof pipelineBody.schemaAttestation?.contentFingerprint === 'string', 'API schema attestation surface: content fingerprint exposed');
        ok(Array.isArray(pipelineBody.schemaAttestation?.tableFingerprints), 'API schema attestation surface: per-table fingerprints exposed');
        ok(Boolean(pipelineBody.schemaAttestation?.historicalComparison), 'API schema attestation surface: historical comparison exposed');
      } finally {
        server.close();
      }
    }

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
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('  LIVE PG TEST CRASHED:', err);
    process.exit(1);
  });
