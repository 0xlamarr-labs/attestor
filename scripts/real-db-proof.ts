/**
 * First Real PostgreSQL-Backed Proof Run
 *
 * This script:
 * 1. Starts an embedded PostgreSQL instance (real PG binary)
 * 2. Generates signing + reviewer keys
 * 3. Bootstraps the demo schema
 * 4. Runs a governed proof with real DB execution
 * 5. Verifies the resulting certificate and kit
 * 6. Stops the embedded PostgreSQL
 *
 * Usage: npx tsx scripts/real-db-proof.ts
 */

import EmbeddedPostgres from 'embedded-postgres';
import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ATTESTOR — First Real PostgreSQL-Backed Proof Run');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Step 1: Start embedded PostgreSQL ──
  console.log('  [1/7] Starting embedded PostgreSQL...');
  const dataDir = join('.attestor', 'pg-data');
  mkdirSync(dataDir, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'attestor',
    password: 'attestor',
    port: 15432,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    console.log('  ✓ Embedded PostgreSQL running on port 15432');

    // Create the database
    await pg.createDatabase('attestor_proof');
    console.log('  ✓ Database "attestor_proof" created');

    const pgUrl = 'postgres://attestor:attestor@localhost:15432/attestor_proof';

    // Set environment variables for child processes and current process
    process.env.ATTESTOR_PG_URL = pgUrl;
    process.env.ATTESTOR_PG_ALLOWED_SCHEMAS = 'attestor_demo';

    // ── Step 2: Verify connectivity with doctor probe ──
    console.log('\n  [2/7] Running connectivity probe...');
    const { runPostgresProbe } = await import('../src/connectors/postgres.js');
    const probe = await runPostgresProbe();
    for (const step of probe.steps) {
      console.log(`    ${step.passed ? '✓' : '✗'} ${step.step.padEnd(14)} ${step.detail}`);
    }
    if (!probe.success) {
      console.error('\n  ✗ Probe failed. Cannot proceed.');
      await pg.stop();
      process.exit(1);
    }
    console.log(`  ✓ PostgreSQL verified: ${probe.serverVersion?.split(',')[0]}`);

    // ── Step 3: Generate signing keys ──
    console.log('\n  [3/7] Generating signing keys...');
    const { generateKeyPair } = await import('../src/signing/keys.js');
    const signingKeyPair = generateKeyPair();
    const reviewerKeyPair = generateKeyPair();
    console.log(`  ✓ Signing key: ${signingKeyPair.fingerprint}`);
    console.log(`  ✓ Reviewer key: ${reviewerKeyPair.fingerprint}`);

    // ── Step 4: Bootstrap demo schema ──
    console.log('\n  [4/7] Bootstrapping demo schema...');
    const { runDemoBootstrap } = await import('../src/connectors/postgres-demo.js');
    const bootstrap = await runDemoBootstrap();
    if (!bootstrap.success) {
      console.error(`\n  ✗ Bootstrap failed: ${bootstrap.message}`);
      await pg.stop();
      process.exit(1);
    }
    console.log(`  ✓ ${bootstrap.message}`);
    for (const [table, count] of Object.entries(bootstrap.rowCounts)) {
      console.log(`    attestor_demo.${table}: ${count} rows`);
    }

    // ── Step 5: Run governed proof with real PostgreSQL ──
    console.log('\n  [5/7] Running governed proof against real PostgreSQL...');
    const { getDemoCounterpartySql } = await import('../src/connectors/postgres-demo.js');
    const { runFinancialPipeline } = await import('../src/financial/pipeline.js');
    const { runPostgresProve: runPgProve } = await import('../src/connectors/postgres-prove.js');
    const { COUNTERPARTY_INTENT, COUNTERPARTY_FIXTURE, COUNTERPARTY_REPORT, COUNTERPARTY_REPORT_CONTRACT } = await import('../src/financial/fixtures/scenarios.js');

    // Execute against real PostgreSQL
    const demoSql = getDemoCounterpartySql();
    const pgProveResult = await runPgProve(demoSql);

    if (!pgProveResult.execution?.success) {
      console.error(`\n  ✗ PostgreSQL execution failed: ${pgProveResult.execution?.error ?? pgProveResult.skipReason}`);
      await pg.stop();
      process.exit(1);
    }

    console.log(`  ✓ REAL PostgreSQL execution: ${pgProveResult.execution.rowCount} rows in ${pgProveResult.execution.durationMs}ms`);
    if (pgProveResult.predictiveGuardrail.performed) {
      console.log(`  ✓ Predictive guardrail: ${pgProveResult.predictiveGuardrail.riskLevel} risk (${pgProveResult.predictiveGuardrail.recommendation})`);
    }
    console.log(`  ✓ Context hash: ${pgProveResult.postgresEvidence.executionContextHash}`);

    // Run full governed pipeline with real PG evidence
    const pipelineInput = {
      runId: `real-pg-proof-${Date.now().toString(36)}`,
      intent: { ...COUNTERPARTY_INTENT, materialityTier: 'high' as const, allowedSchemas: ['attestor_demo'] },
      candidateSql: demoSql,
      fixtures: [COUNTERPARTY_FIXTURE],
      generatedReport: COUNTERPARTY_REPORT,
      reportContract: COUNTERPARTY_REPORT_CONTRACT,
      signingKeyPair,
      externalExecution: pgProveResult.execution,
      liveProof: {
        collectedAt: new Date().toISOString(),
        execution: {
          live: true,
          provider: 'postgres',
          mode: 'live_db' as const,
          latencyMs: pgProveResult.execution.durationMs ?? null,
        },
      },
      predictiveGuardrail: pgProveResult.predictiveGuardrail,
      approval: {
        status: 'approved',
        reviewerRole: 'attestor_operator',
        reviewNote: 'First real PostgreSQL-backed proof run',
        reviewerIdentity: {
          name: 'Attestor Operator',
          role: 'attestor_operator',
          identifier: `real-pg-proof:${reviewerKeyPair.fingerprint}`,
          signerFingerprint: null,
        },
        reviewerKeyPair,
      },
    };

    const report = runFinancialPipeline(pipelineInput);

    console.log(`\n  ── Governed Decision ──`);
    console.log(`  Decision:  ${report.decision.toUpperCase()}`);
    console.log(`  Scorers:   ${report.scoring.scorersRun} ran`);
    console.log(`  Warrant:   ${report.warrant.status}`);
    console.log(`  Escrow:    ${report.escrow.state}`);
    console.log(`  Receipt:   ${report.receipt?.receiptStatus ?? 'not issued'}`);
    console.log(`  Capsule:   ${report.capsule?.authorityState ?? 'none'}`);
    console.log(`  Audit:     ${report.audit.entries.length} entries, chain ${report.audit.chainIntact ? 'intact' : 'BROKEN'}`);
    console.log(`  Proof:     ${report.liveProof.mode}`);
    console.log(`  Provider:  ${report.liveProof.execution.provider ?? 'none'}`);
    console.log(`  Reviewer:  ${report.oversight.endorsement?.reviewer.name ?? 'none'}`);

    // ── Step 6: Build and verify certificate + kit ──
    console.log('\n  [6/7] Building and verifying portable proof artifacts...');
    const { buildVerificationKit } = await import('../src/signing/bundle.js');
    const { verifyCertificate } = await import('../src/signing/certificate.js');

    if (!report.certificate) {
      console.error('  ✗ No certificate issued');
      await pg.stop();
      process.exit(1);
    }

    // Certificate verification
    const certVerify = verifyCertificate(report.certificate, signingKeyPair.publicKeyPem);
    console.log(`  Certificate: ${report.certificate.certificateId}`);
    console.log(`    Signature:   ${certVerify.signatureValid ? '✓ valid' : '✗ INVALID'}`);
    console.log(`    Fingerprint: ${certVerify.fingerprintConsistent ? '✓ consistent' : '✗ MISMATCH'}`);
    console.log(`    Overall:     ${certVerify.overall === 'valid' ? '✓ VALID' : '✗ ' + certVerify.overall}`);

    // Verification kit
    const kit = buildVerificationKit(report, signingKeyPair.publicKeyPem, reviewerKeyPair.publicKeyPem);
    if (!kit) {
      console.error('  ✗ Kit build failed');
      await pg.stop();
      process.exit(1);
    }

    const v = kit.verification;
    console.log(`\n  ── 6-Dimensional Verification ──`);
    console.log(`  ${v.cryptographic.valid ? '✓' : '✗'} Cryptographic:  ${v.cryptographic.valid ? 'valid' : 'INVALID'} (${v.cryptographic.algorithm})`);
    console.log(`  ${v.structural.valid ? '✓' : '✗'} Structural:     ${v.structural.valid ? 'valid' : 'INVALID'}`);
    console.log(`  ${v.authority.warrantFulfilled ? '✓' : '✗'} Authority:       ${v.authority.state}`);
    console.log(`  ${v.governanceSufficiency.sufficient ? '✓' : '✗'} Governance:      ${v.governanceSufficiency.sufficient ? 'sufficient' : 'INSUFFICIENT'}`);
    console.log(`  ${v.proofCompleteness.executionLive ? '✓' : '✗'} Proof:           ${v.proofCompleteness.mode} (provider: ${v.proofCompleteness.executionProvider ?? 'none'}, db_context: ${v.proofCompleteness.hasDbContextEvidence})`);
    console.log(`  ${v.reviewerEndorsement.verified ? '✓' : '✗'} Reviewer:        ${v.reviewerEndorsement.verified ? 'verified' : 'NOT verified'} (${v.reviewerEndorsement.reviewerName})`);
    console.log(`\n  Overall: ${v.overall.toUpperCase()}`);

    // ── Step 7: Save artifacts ──
    console.log('\n  [7/7] Saving proof artifacts...');
    const { writeFileSync } = await import('node:fs');
    const outDir = join('.attestor', 'proofs', `real-pg-proof_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'kit.json'), JSON.stringify(kit, null, 2));
    writeFileSync(join(outDir, 'certificate.json'), JSON.stringify(report.certificate, null, 2));
    writeFileSync(join(outDir, 'public-key.pem'), signingKeyPair.publicKeyPem);
    writeFileSync(join(outDir, 'reviewer-public.pem'), reviewerKeyPair.publicKeyPem);
    writeFileSync(join(outDir, 'verification-summary.json'), JSON.stringify(kit.verification, null, 2));

    console.log(`  ✓ Artifacts saved to: ${outDir}/`);
    console.log(`    kit.json                — full verification kit`);
    console.log(`    certificate.json        — Ed25519-signed attestation certificate`);
    console.log(`    public-key.pem          — runtime signer public key`);
    console.log(`    reviewer-public.pem     — reviewer signer public key`);
    console.log(`    verification-summary.json — 6-dimensional verification result`);

    // ── Final Summary — TRUTHFUL ──
    const isFullPass = report.decision === 'pass' && v.overall === 'verified';
    const isProofDegraded = v.overall === 'proof_degraded';
    const isAuthorityComplete = v.authority.state === 'authorized';

    console.log('\n══════════════════════════════════════════════════════════════');
    if (isFullPass) {
      console.log('  REAL POSTGRESQL-BACKED PROOF RUN — FULLY VERIFIED');
    } else if (isProofDegraded && report.decision === 'pass') {
      console.log('  REAL POSTGRESQL-BACKED PROOF RUN — PASS (proof degraded: no live upstream model)');
    } else if (report.decision === 'pass' && !isAuthorityComplete) {
      console.log('  REAL POSTGRESQL-BACKED PROOF RUN — PASS (authority closure pending)');
    } else {
      console.log(`  REAL POSTGRESQL-BACKED PROOF RUN — ${report.decision.toUpperCase()} (${v.overall})`);
    }
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Database:    embedded PostgreSQL (${probe.serverVersion?.split(',')[0]})`);
    console.log(`  Execution:   REAL — ${pgProveResult.execution.rowCount} rows, ${pgProveResult.execution.durationMs}ms`);
    console.log(`  Context:     ${pgProveResult.postgresEvidence.executionContextHash}`);
    console.log(`  Decision:    ${report.decision.toUpperCase()}`);
    console.log(`  Certificate: ${report.certificate.certificateId}`);
    console.log(`  Kit overall: ${v.overall.toUpperCase()}`);
    console.log(`  Reviewer:    ${v.reviewerEndorsement.reviewerName} (${v.reviewerEndorsement.verified ? 'verified' : 'not verified'})`);
    console.log(`  Artifacts:   ${outDir}/`);
    console.log('══════════════════════════════════════════════════════════════\n');

    // ── Cleanup ──
    await pg.stop();
    console.log('  Embedded PostgreSQL stopped.\n');

    // Exit truthfully: non-zero if governance failed
    if (report.decision !== 'pass') {
      console.log(`  Exit 1: governance decision was ${report.decision}, not pass.\n`);
      process.exit(1);
    }

  } catch (err) {
    console.error('\n  ✗ Fatal error:', err instanceof Error ? err.message : String(err));
    try { await pg.stop(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
