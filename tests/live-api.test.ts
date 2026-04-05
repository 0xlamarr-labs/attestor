/**
 * LIVE API Integration Tests
 *
 * These are NOT mocks. This test:
 * 1. Starts a real Hono HTTP server on port 3700
 * 2. Sends real HTTP requests to it
 * 3. Verifies real responses
 * 4. Stops the server
 *
 * Run: npx tsx tests/live-api.test.ts
 */

import { strict as assert } from 'node:assert';
import { startServer } from '../src/service/api-server.js';
import {
  COUNTERPARTY_SQL, COUNTERPARTY_INTENT, COUNTERPARTY_FIXTURE,
  COUNTERPARTY_REPORT, COUNTERPARTY_REPORT_CONTRACT,
} from '../src/financial/fixtures/scenarios.js';

const BASE = 'http://localhost:3700';
let serverHandle: { close: () => void };
let passed = 0;

function ok(condition: boolean, msg: string): void {
  assert(condition, msg);
  passed++;
}

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  LIVE API INTEGRATION TESTS — Real HTTP, Real Server');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Start real server ──
  console.log('  Starting Hono API server on port 3700...');
  serverHandle = startServer(3700);
  // Give server a moment to bind
  await new Promise(r => setTimeout(r, 500));
  console.log('  ✓ Server running\n');

  try {
    // ═══ HEALTH ENDPOINT ═══
    console.log('  [GET /api/v1/health]');
    {
      const res = await fetch(`${BASE}/api/v1/health`);
      ok(res.status === 200, 'Health: status 200');
      const body = await res.json() as any;
      ok(body.status === 'healthy', 'Health: status=healthy');
      ok(body.version === '0.1.0', 'Health: version correct');
      ok(Array.isArray(body.domains), 'Health: domains is array');
      ok(body.domains.includes('finance'), 'Health: finance domain registered');
      ok(body.domains.includes('healthcare'), 'Health: healthcare domain registered');
      ok(typeof body.uptime === 'number', 'Health: uptime is number');
      ok(body.pki?.ready === true, 'Health: PKI ready');
      ok(body.pki?.caName === 'Attestor API Root CA', 'Health: PKI CA name');
      ok(typeof body.pki?.caFingerprint === 'string', 'Health: PKI CA fingerprint');
      console.log(`    status=${body.status}, pki=${body.pki.caName} (${body.pki.caFingerprint}), domains=${body.domains.join(',')}, uptime=${body.uptime}s`);
    }

    // ═══ DOMAINS ENDPOINT ═══
    console.log('\n  [GET /api/v1/domains]');
    {
      const res = await fetch(`${BASE}/api/v1/domains`);
      ok(res.status === 200, 'Domains: status 200');
      const body = await res.json() as any;
      ok(body.domains.length === 2, 'Domains: 2 domains');
      const finance = body.domains.find((d: any) => d.id === 'finance');
      ok(finance !== undefined, 'Domains: finance found');
      ok(finance.clauseCount === 5, 'Domains: finance has 5 clauses');
      const healthcare = body.domains.find((d: any) => d.id === 'healthcare');
      ok(healthcare !== undefined, 'Domains: healthcare found');
      ok(healthcare.clauseCount === 5, 'Domains: healthcare has 5 clauses');
      console.log(`    finance: ${finance.clauseCount} clauses, healthcare: ${healthcare.clauseCount} clauses`);
    }

    console.log('\n  [GET /api/v1/connectors]');
    {
      const res = await fetch(`${BASE}/api/v1/connectors`);
      ok(res.status === 200, 'Connectors: status 200');
      const body = await res.json() as any;
      ok(Array.isArray(body.connectors), 'Connectors: connectors is array');
      const snowflake = body.connectors.find((d: any) => d.id === 'snowflake');
      ok(snowflake !== undefined, 'Connectors: snowflake found');
      ok(typeof snowflake.configured === 'boolean', 'Connectors: configured boolean');
      ok(typeof snowflake.available === 'boolean', 'Connectors: available boolean');
      console.log(`    snowflake: configured=${snowflake.configured}, available=${snowflake.available}`);
    }

    // ═══ PIPELINE RUN — unsigned ═══
    console.log('\n  [POST /api/v1/pipeline/run — unsigned]');
    {
      const res = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: COUNTERPARTY_INTENT,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: false,
        }),
      });
      ok(res.status === 200, 'Pipeline(unsigned): status 200');
      const body = await res.json() as any;
      ok(body.decision === 'pass', 'Pipeline(unsigned): decision=pass');
      ok(body.scoring.scorersRun === 8, 'Pipeline(unsigned): 8 scorers');
      ok(body.proofMode === 'offline_fixture', 'Pipeline(unsigned): proof=fixture');
      ok(body.auditChainIntact === true, 'Pipeline(unsigned): audit intact');
      ok(body.certificate === null, 'Pipeline(unsigned): no certificate (unsigned)');
      // Tenant context (anonymous/default when no ATTESTOR_TENANT_KEYS)
      ok(body.tenantContext !== undefined, 'Pipeline(unsigned): tenantContext present');
      ok(body.tenantContext.tenantId === 'default', 'Pipeline(unsigned): tenant=default');
      console.log(`    decision=${body.decision}, tenant=${body.tenantContext.tenantId}, proof=${body.proofMode}`);
    }

    // ═══ PIPELINE RUN — signed with certificate ═══
    console.log('\n  [POST /api/v1/pipeline/run — signed]');
    let fullCert: any = null;
    let savedPubKey: string = '';
    {
      const res = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: COUNTERPARTY_INTENT,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: true,
        }),
      });
      ok(res.status === 200, 'Pipeline(signed): status 200');
      const body = await res.json() as any;
      ok(body.decision === 'pass', 'Pipeline(signed): decision=pass');
      ok(body.certificate !== null, 'Pipeline(signed): certificate present');
      ok(body.certificate.type === 'attestor.certificate.v1', 'Pipeline(signed): full cert type');
      ok(body.certificate.signing?.algorithm === 'ed25519', 'Pipeline(signed): ed25519');
      ok(body.certificate.certificateId?.startsWith('cert_'), 'Pipeline(signed): cert ID');
      ok(body.certificate.signing?.signature?.length === 128, 'Pipeline(signed): 64-byte signature');
      ok(body.verification !== null, 'Pipeline(signed): verification present');
      ok(body.verification.cryptographic.valid === true, 'Pipeline(signed): crypto valid');
      ok(body.publicKeyPem !== null, 'Pipeline(signed): public key returned');
      fullCert = body.certificate;
      savedPubKey = body.publicKeyPem;
      ok(body.trustChain !== null, 'Pipeline(signed): trust chain present');
      ok(body.trustChain.type === 'attestor.trust_chain.v1', 'Pipeline(signed): trust chain type');
      ok(body.trustChain.ca?.type === 'attestor.ca_certificate.v1', 'Pipeline(signed): CA cert in chain');
      ok(body.trustChain.leaf?.type === 'attestor.leaf_certificate.v1', 'Pipeline(signed): leaf cert in chain');
      console.log(`    cert=${fullCert.certificateId}, chain: CA=${body.trustChain.ca.name}, leaf=${body.trustChain.leaf.subject}`);
    }

    // ═══ VERIFY ENDPOINT — real end-to-end certificate verification ═══
    console.log('\n  [POST /api/v1/verify — REAL certificate E2E]');
    {
      // Use the FULL certificate from the pipeline run
      const verifyRes = await fetch(`${BASE}/api/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificate: fullCert, publicKeyPem: savedPubKey }),
      });
      ok(verifyRes.status === 200, 'Verify(real): status 200');
      const v = await verifyRes.json() as any;
      ok(v.signatureValid === true, 'Verify(real): signature VALID');
      ok(v.fingerprintConsistent === true, 'Verify(real): fingerprint consistent');
      ok(v.schemaValid === true, 'Verify(real): schema valid');
      ok(v.overall === 'valid', 'Verify(real): overall = valid');
      console.log(`    sig=${v.signatureValid}, fp=${v.fingerprintConsistent}, overall=${v.overall}`);
    }

    // ═══ VERIFY ENDPOINT — bad input ═══
    console.log('\n  [POST /api/v1/verify — bad input]');
    {
      const badRes = await fetch(`${BASE}/api/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificate: null, publicKeyPem: null }),
      });
      ok(badRes.status === 400, 'Verify(bad): status 400');
      console.log(`    bad input rejected: ${(await badRes.json() as any).error}`);
    }

    // ═══ FILING EXPORT ═══
    console.log('\n  [POST /api/v1/filing/export — XBRL]');
    {
      const rows = [
        { counterparty_name: 'Bank of Nova Scotia', exposure_usd: 250000000, credit_rating: 'AA-', sector: 'Banking' },
        { counterparty_name: 'Deutsche Bank AG', exposure_usd: 200000000, credit_rating: 'A-', sector: 'Banking' },
      ];
      const res = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adapterId: 'xbrl-us-gaap-2024',
          runId: 'filing-test-1',
          decision: 'pass',
          certificateId: 'cert_test123',
          evidenceChainTerminal: 'abc123',
          rows,
          proofMode: 'live_runtime',
        }),
      });
      ok(res.status === 200, 'Filing: status 200');
      const body = await res.json() as any;
      ok(body.adapterId === 'xbrl-us-gaap-2024', 'Filing: adapter ID');
      ok(body.format === 'xbrl', 'Filing: format = xbrl');
      ok(body.taxonomyVersion === 'US-GAAP 2024', 'Filing: taxonomy version');
      ok(body.mapping.mappedCount > 0, 'Filing: has mapped fields');
      ok(body.mapping.coveragePercent > 50, 'Filing: coverage > 50%');
      ok(body.package.content.facts.length > 0, 'Filing: package has facts');
      ok(body.package.evidenceLink.runId === 'filing-test-1', 'Filing: evidence link runId');
      ok(body.package.evidenceLink.certificateId === 'cert_test123', 'Filing: evidence link certId');
      console.log(`    mapped=${body.mapping.mappedCount}, coverage=${body.mapping.coveragePercent}%, facts=${body.package.content.facts.length}`);
    }

    // ═══ FILING EXPORT — bad adapter ═══
    console.log('\n  [POST /api/v1/filing/export — unknown adapter]');
    {
      const res = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId: 'nonexistent', runId: 'x', rows: [] }),
      });
      ok(res.status === 404, 'Filing(bad): status 404');
      console.log(`    unknown adapter rejected`);
    }

    // ═══ ISSUE → VERIFY WITH PKI CHAIN (E2E closed loop) ═══
    console.log('\n  [Issue → Verify with PKI Chain — E2E]');
    {
      // Run a fresh pipeline to get cert + chain + key from the SAME run
      const freshRun = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateSql: COUNTERPARTY_SQL, intent: COUNTERPARTY_INTENT, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT, sign: true }),
      });
      const freshBody = await freshRun.json() as any;

      // Now verify with the same run's cert + key + chain + CA key
      const verifyRes = await fetch(`${BASE}/api/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificate: freshBody.certificate,
          publicKeyPem: freshBody.publicKeyPem,
          trustChain: freshBody.trustChain,
          caPublicKeyPem: freshBody.caPublicKeyPem,
        }),
      });
      ok(verifyRes.status === 200, 'PKI-Verify: status 200');
      const pv = await verifyRes.json() as any;
      ok(pv.signatureValid === true, 'PKI-Verify: signature valid');
      ok(pv.overall === 'valid', 'PKI-Verify: cert overall valid');
      ok(pv.chainVerification !== null, 'PKI-Verify: chain verification present');
      ok(pv.chainVerification.chainIntact === true, 'PKI-Verify: chain intact');
      ok(pv.chainVerification.caValid === true, 'PKI-Verify: CA valid');
      ok(pv.chainVerification.leafValid === true, 'PKI-Verify: leaf valid');
      ok(pv.chainVerification.caExpired === false, 'PKI-Verify: CA not expired');
      ok(pv.chainVerification.leafExpired === false, 'PKI-Verify: leaf not expired');
      ok(pv.chainVerification.caName === 'Attestor API Root CA', 'PKI-Verify: CA name');
      // Certificate-to-leaf binding
      ok(pv.chainVerification.leafMatchesCertificateKey === true, 'PKI-Verify: leaf matches cert key');
      ok(pv.chainVerification.pkiBound === true, 'PKI-Verify: PKI bound');
      // Trust binding summary
      ok(pv.trustBinding !== undefined, 'PKI-Verify: trustBinding present');
      ok(pv.trustBinding.certificateSignature === true, 'PKI-Verify: cert sig in binding');
      ok(pv.trustBinding.chainValid === true, 'PKI-Verify: chain valid in binding');
      ok(pv.trustBinding.certificateBoundToLeaf === true, 'PKI-Verify: bound to leaf');
      ok(pv.trustBinding.pkiVerified === true, 'PKI-Verify: fully PKI verified');
      console.log(`    cert=${pv.overall}, chain=${pv.chainVerification.overall}, bound=${pv.chainVerification.pkiBound}, pkiVerified=${pv.trustBinding.pkiVerified}`);
    }

    // ═══ PKI LEAF MISMATCH DETECTION ═══
    console.log('\n  [PKI Verify — Leaf Mismatch]');
    {
      // Issue a cert from one run, but submit a DIFFERENT run's trust chain
      const run1 = await (await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateSql: COUNTERPARTY_SQL, intent: COUNTERPARTY_INTENT, fixtures: [COUNTERPARTY_FIXTURE], generatedReport: COUNTERPARTY_REPORT, reportContract: COUNTERPARTY_REPORT_CONTRACT, sign: true }),
      })).json() as any;

      // Generate a different key pair's identity to simulate mismatch
      // Use run1's cert but a fabricated publicKeyPem that doesn't match the chain leaf
      const mismatchRes = await fetch(`${BASE}/api/v1/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificate: run1.certificate,
          publicKeyPem: run1.publicKeyPem,
          trustChain: { ...run1.trustChain, leaf: { ...run1.trustChain.leaf, subjectFingerprint: 'aaaa_fake_fingerprint' } },
          caPublicKeyPem: run1.caPublicKeyPem,
        }),
      });
      const mm = await mismatchRes.json() as any;
      ok(mm.chainVerification.leafMatchesCertificateKey === false || mm.chainVerification.leafMatchesCertificateFingerprint === false, 'PKI-Mismatch: leaf binding fails');
      ok(mm.chainVerification.pkiBound === false, 'PKI-Mismatch: NOT PKI bound');
      ok(mm.trustBinding.certificateBoundToLeaf === false, 'PKI-Mismatch: binding reports unbound');
      ok(mm.trustBinding.pkiVerified === false, 'PKI-Mismatch: NOT PKI verified');
      console.log(`    mismatch detected: pkiBound=${mm.chainVerification.pkiBound}, pkiVerified=${mm.trustBinding.pkiVerified}`);
    }

    // ═══ ASYNC PIPELINE ═══
    console.log('\n  [POST /api/v1/pipeline/run-async — submit]');
    let asyncJobId: string;
    {
      const res = await fetch(`${BASE}/api/v1/pipeline/run-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: COUNTERPARTY_INTENT,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: true,
        }),
      });
      ok(res.status === 202, 'Async: submit returns 202');
      const body = await res.json() as any;
      ok(body.jobId !== undefined, 'Async: jobId returned');
      ok(body.status === 'queued', 'Async: status=queued');
      ok(body.backendMode === 'in_process' || body.backendMode === 'bullmq', 'Async: backendMode truthful');
      asyncJobId = body.jobId;
      console.log(`    jobId=${asyncJobId}, status=${body.status}, backend=${body.backendMode}`);
    }

    // Poll for completion
    console.log('\n  [GET /api/v1/pipeline/status/:jobId — poll]');
    {
      // Wait a moment for the async job to complete
      await new Promise(r => setTimeout(r, 2000));
      const res = await fetch(`${BASE}/api/v1/pipeline/status/${asyncJobId}`);
      ok(res.status === 200, 'Async: status endpoint 200');
      const body = await res.json() as any;
      ok(body.status === 'completed', 'Async: job completed');
      ok(body.backendMode === 'in_process' || body.backendMode === 'bullmq', 'Async: status shows backendMode');
      ok(body.result !== null, 'Async: result present');
      ok(body.result.decision === 'pass', 'Async: decision=pass');
      ok(body.result.certificateId !== null, 'Async: certificate issued');
      ok(body.result.certificate !== null, 'Async: full cert in result');
      ok(body.result.trustChain !== null, 'Async: trust chain in result');
      console.log(`    status=${body.status}, backend=${body.backendMode}, decision=${body.result.decision}, cert=${body.result.certificateId}`);
    }

    // Status for non-existent job
    console.log('\n  [GET /api/v1/pipeline/status/nonexistent]');
    {
      const res = await fetch(`${BASE}/api/v1/pipeline/status/nonexistent`);
      ok(res.status === 404, 'Async: unknown job = 404');
      console.log(`    unknown job rejected`);
    }

    // ═══ PIPELINE RUN — bad input ═══
    console.log('\n  [POST /api/v1/pipeline/run — missing fields]');
    {
      const res = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateSql: null }),
      });
      ok(res.status === 400, 'Pipeline(bad): status 400');
      const body = await res.json() as any;
      ok(body.error !== undefined, 'Pipeline(bad): error message');
      console.log(`    error handled: ${body.error}`);
    }

    // ═══ 404 for unknown route ═══
    console.log('\n  [GET /api/v1/nonexistent]');
    {
      const res = await fetch(`${BASE}/api/v1/nonexistent`);
      ok(res.status === 404, '404: unknown route returns 404');
      console.log(`    status=${res.status}`);
    }

    console.log(`\n  Live API Tests: ${passed} passed, 0 failed\n`);
  } finally {
    serverHandle.close();
    console.log('  Server stopped.\n');
  }
}

run().catch(err => {
  console.error('  LIVE TEST CRASHED:', err);
  try { serverHandle?.close(); } catch {}
  process.exit(1);
});
