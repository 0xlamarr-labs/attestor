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
import { join } from 'node:path';
import { startServer } from '../src/service/api-server.js';
import { issueTenantApiKey, resetTenantKeyStoreForTests, revokeTenantApiKey } from '../src/service/tenant-key-store.js';
import { readUsageLedgerSnapshot, resetUsageMeter } from '../src/service/usage-meter.js';
import { resetAccountStoreForTests } from '../src/service/account-store.js';
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
  process.env.ATTESTOR_TENANT_KEY_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-tenant-keys.json');
  process.env.ATTESTOR_USAGE_LEDGER_PATH = join(process.cwd(), '.attestor', 'live-api-usage-ledger.json');
  process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-accounts.json');
  process.env.ATTESTOR_ADMIN_API_KEY = 'admin-secret';
  resetTenantKeyStoreForTests();
  resetUsageMeter();
  resetAccountStoreForTests();

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
      ok(body.pki?.caName === 'Attestor Keyless CA', 'Health: PKI CA name');
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

    // ═══ VERIFY ENDPOINT — PKI mandatory: flat Ed25519 rejected with 422 ═══
    console.log('\n  [POST /api/v1/verify — flat Ed25519 rejected (PKI mandatory)]');
    {
      // Submit WITHOUT trust chain — should be rejected with 422
      const verifyRes = await fetch(`${BASE}/api/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificate: fullCert, publicKeyPem: savedPubKey }),
      });
      ok(verifyRes.status === 422, 'Verify(flat): status 422 (PKI required)');
      const v = await verifyRes.json() as any;
      ok(v.error.includes('PKI trust chain required'), 'Verify(flat): error says PKI required');
      ok(v.hint !== undefined, 'Verify(flat): hint present');
      ok(v.legacyEscape !== undefined, 'Verify(flat): legacy escape documented');
      console.log(`    status=422, error=${v.error}`);
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
      ok(pv.chainVerification.caName === 'Attestor Keyless CA', 'PKI-Verify: CA name');
      // Certificate-to-leaf binding
      ok(pv.chainVerification.leafMatchesCertificateKey === true, 'PKI-Verify: leaf matches cert key');
      ok(pv.chainVerification.pkiBound === true, 'PKI-Verify: PKI bound');
      // Trust binding summary
      ok(pv.trustBinding !== undefined, 'PKI-Verify: trustBinding present');
      ok(pv.trustBinding.certificateSignature === true, 'PKI-Verify: cert sig in binding');
      ok(pv.trustBinding.chainValid === true, 'PKI-Verify: chain valid in binding');
      ok(pv.trustBinding.certificateBoundToLeaf === true, 'PKI-Verify: bound to leaf');
      ok(pv.trustBinding.pkiVerified === true, 'PKI-Verify: fully PKI verified');
      // PKI mode — no deprecation
      ok(pv.verificationMode === 'pki', 'PKI-Verify: verificationMode = pki');
      ok(pv.deprecationNotice === null, 'PKI-Verify: no deprecation notice');
      console.log(`    cert=${pv.overall}, chain=${pv.chainVerification.overall}, bound=${pv.chainVerification.pkiBound}, pkiVerified=${pv.trustBinding.pkiVerified}, mode=${pv.verificationMode}`);
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

    // ═══ READINESS PROBE ═══
    console.log('\n  [GET /api/v1/ready]');
    {
      const res = await fetch(`${BASE}/api/v1/ready`);
      ok(res.status === 200, 'Ready: status 200');
      const body = await res.json() as any;
      ok(body.ready === true, 'Ready: ready = true');
      ok(body.checks.asyncBackend === true, 'Ready: asyncBackend check passed');
      ok(body.checks.pki === true, 'Ready: PKI check passed');
      ok(body.checks.domains === true, 'Ready: domains check passed');
      console.log(`    ready=${body.ready}, mode=${body.asyncBackendMode}, redis=${body.redisMode}`);
    }

    // ═══ 404 for unknown route ═══
    console.log('\n  [GET /api/v1/nonexistent]');
    {
      const res = await fetch(`${BASE}/api/v1/nonexistent`);
      ok(res.status === 404, '404: unknown route returns 404');
      console.log(`    status=${res.status}`);
    }

    // ═══ HOSTED SHELL — plan/quota/usage first slice ═══
    process.env.ATTESTOR_TENANT_KEYS = 'pro-key:tenant-pro:Acme:pro:2';

    console.log('\n  [GET /api/v1/account/usage — tenant usage]');
    {
      const res = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: 'Bearer pro-key' },
      });
      ok(res.status === 200, 'Usage: status 200');
      const body = await res.json() as any;
      ok(body.tenantContext.tenantId === 'tenant-pro', 'Usage: tenant id');
      ok(body.tenantContext.planId === 'pro', 'Usage: plan id');
      ok(body.usage.used === 0, 'Usage: starts at 0');
      ok(body.usage.quota === 2, 'Usage: quota = 2');
      ok(body.usage.remaining === 2, 'Usage: remaining = 2');
      console.log(`    tenant=${body.tenantContext.tenantId}, plan=${body.tenantContext.planId}, used=${body.usage.used}/${body.usage.quota}`);
    }

    console.log('\n  [POST /api/v1/pipeline/run — tenant metering]');
    {
      const first = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer pro-key' },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: COUNTERPARTY_INTENT,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: false,
        }),
      });
      ok(first.status === 200, 'Quota: first run allowed');
      const firstBody = await first.json() as any;
      ok(firstBody.tenantContext.planId === 'pro', 'Quota: plan propagated');
      ok(firstBody.usage.used === 1, 'Quota: first run increments usage');
      ok(firstBody.usage.remaining === 1, 'Quota: first run remaining = 1');

      const second = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer pro-key' },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: COUNTERPARTY_INTENT,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: false,
        }),
      });
      ok(second.status === 200, 'Quota: second run allowed');
      const secondBody = await second.json() as any;
      ok(secondBody.usage.used === 2, 'Quota: second run increments usage');
      ok(secondBody.usage.remaining === 0, 'Quota: second run remaining = 0');

      const third = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer pro-key' },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: COUNTERPARTY_INTENT,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: false,
        }),
      });
      ok(third.status === 429, 'Quota: third run rejected');
      const thirdBody = await third.json() as any;
      ok(thirdBody.usage.used === 2, 'Quota: rejected run does not increment usage');
      ok(thirdBody.usage.remaining === 0, 'Quota: rejected run remaining = 0');
      console.log(`    quota enforced: used=${thirdBody.usage.used}/${thirdBody.usage.quota}, status=${third.status}`);

      const ledger = readUsageLedgerSnapshot();
      const persisted = ledger.records.find((entry) => entry.tenantId === 'tenant-pro' && entry.period === secondBody.usage.period);
      ok(Boolean(persisted), 'Quota: usage persisted to local ledger');
      ok(persisted?.used === 2, 'Quota: persisted ledger count = 2');
    }

    process.env.ATTESTOR_TENANT_KEYS = '';

    console.log('\n  [File-backed tenant key issuance + revoke]');
    {
      const issued = issueTenantApiKey({
        tenantId: 'tenant-file',
        tenantName: 'File Co',
        planId: 'starter',
        monthlyRunQuota: 1,
      });

      const usageRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${issued.apiKey}` },
      });
      ok(usageRes.status === 200, 'File store: issued key is accepted');
      const usageBody = await usageRes.json() as any;
      ok(usageBody.tenantContext.tenantId === 'tenant-file', 'File store: tenant id propagated');
      ok(usageBody.tenantContext.planId === 'starter', 'File store: plan propagated');
      ok(usageBody.usage.quota === 1, 'File store: quota propagated');

      const anonymousRes = await fetch(`${BASE}/api/v1/account/usage`);
      ok(anonymousRes.status === 401, 'File store: active keys enforce auth');

      revokeTenantApiKey(issued.record.id);

      const revokedRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${issued.apiKey}` },
      });
      ok(revokedRes.status === 401, 'File store: revoked key rejected');
      console.log(`    issued=${issued.record.id}, preview=${issued.record.apiKeyPreview}, revokedStatus=${revokedRes.status}`);
    }

    console.log('\n  [Admin tenant key management API]');
    {
      const accountsNoAuth = await fetch(`${BASE}/api/v1/admin/accounts`);
      ok(accountsNoAuth.status === 401, 'Admin Accounts: auth required');

      const createAccountRes = await fetch(`${BASE}/api/v1/admin/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
        },
        body: JSON.stringify({
          accountName: 'Account Co',
          contactEmail: 'ops@account.example',
          tenantId: 'tenant-account',
          tenantName: 'Account Tenant',
          planId: 'starter',
          monthlyRunQuota: 2,
        }),
      });
      ok(createAccountRes.status === 201, 'Admin Accounts: create status 201');
      const createAccountBody = await createAccountRes.json() as any;
      ok(createAccountBody.account.accountName === 'Account Co', 'Admin Accounts: account name persisted');
      ok(typeof createAccountBody.initialKey.apiKey === 'string', 'Admin Accounts: initial key returned');

      const accountsListRes = await fetch(`${BASE}/api/v1/admin/accounts`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(accountsListRes.status === 200, 'Admin Accounts: list status 200');
      const accountsListBody = await accountsListRes.json() as any;
      const listedAccount = accountsListBody.accounts.find((entry: any) => entry.id === createAccountBody.account.id);
      ok(Boolean(listedAccount), 'Admin Accounts: new account appears in list');
      ok(listedAccount.primaryTenantId === 'tenant-account', 'Admin Accounts: primary tenant persisted');

      const accountUsageRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(accountUsageRes.status === 200, 'Admin Accounts: initial key works on tenant route');

      const noAuth = await fetch(`${BASE}/api/v1/admin/tenant-keys`);
      ok(noAuth.status === 401, 'Admin API: auth required');

      const issueRes = await fetch(`${BASE}/api/v1/admin/tenant-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
        },
        body: JSON.stringify({
          tenantId: 'tenant-admin',
          tenantName: 'Admin Co',
          planId: 'pro',
          monthlyRunQuota: 3,
        }),
      });
      ok(issueRes.status === 201, 'Admin API: issue key created');
      const issueBody = await issueRes.json() as any;
      ok(typeof issueBody.key.apiKey === 'string', 'Admin API: plaintext apiKey returned once');
      ok(issueBody.key.planId === 'pro', 'Admin API: plan persisted');

      const tenantUsage = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${issueBody.key.apiKey}` },
      });
      ok(tenantUsage.status === 200, 'Admin API: issued key works on tenant route');
      const tenantUsageBody = await tenantUsage.json() as any;
      ok(tenantUsageBody.tenantContext.tenantId === 'tenant-admin', 'Admin API: tenant route resolves issued key');

      const tenantRun = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${issueBody.key.apiKey}`,
        },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: COUNTERPARTY_INTENT,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: false,
        }),
      });
      ok(tenantRun.status === 200, 'Admin API: issued key can consume pipeline run');

      const listRes = await fetch(`${BASE}/api/v1/admin/tenant-keys`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(listRes.status === 200, 'Admin API: list status 200');
      const listBody = await listRes.json() as any;
      const listed = listBody.keys.find((entry: any) => entry.id === issueBody.key.id);
      ok(Boolean(listed), 'Admin API: issued key appears in list');
      ok(!('apiKeyHash' in listed), 'Admin API: hash not exposed');

      const usageNoAuth = await fetch(`${BASE}/api/v1/admin/usage`);
      ok(usageNoAuth.status === 401, 'Admin Usage: auth required');

      const usageListRes = await fetch(`${BASE}/api/v1/admin/usage`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(usageListRes.status === 200, 'Admin Usage: list status 200');
      const usageListBody = await usageListRes.json() as any;
      const usageListed = usageListBody.records.find((entry: any) => entry.tenantId === 'tenant-admin');
      ok(Boolean(usageListed), 'Admin Usage: tenant-admin appears in usage report');
      ok(usageListed.tenantName === 'Admin Co', 'Admin Usage: tenant name enriched');
      ok(usageListed.planId === 'pro', 'Admin Usage: plan enriched');
      ok(usageListed.used === 1, 'Admin Usage: used count tracked');
      ok(usageListBody.summary.totalUsed >= 1, 'Admin Usage: summary totalUsed present');

      const accountRun = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createAccountBody.initialKey.apiKey}`,
        },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: COUNTERPARTY_INTENT,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: false,
        }),
      });
      ok(accountRun.status === 200, 'Admin Accounts: created account key can consume pipeline run');

      const usageAccountFilterRes = await fetch(`${BASE}/api/v1/admin/usage?tenantId=tenant-account`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(usageAccountFilterRes.status === 200, 'Admin Usage: account tenant filter status 200');
      const usageAccountFilterBody = await usageAccountFilterRes.json() as any;
      ok(usageAccountFilterBody.records.length === 1, 'Admin Usage: account tenant appears in filter');
      ok(usageAccountFilterBody.records[0].accountId === createAccountBody.account.id, 'Admin Usage: account id enriched');
      ok(usageAccountFilterBody.records[0].accountName === 'Account Co', 'Admin Usage: account name enriched');

      const usageFilterRes = await fetch(`${BASE}/api/v1/admin/usage?tenantId=tenant-admin`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(usageFilterRes.status === 200, 'Admin Usage: tenant filter status 200');
      const usageFilterBody = await usageFilterRes.json() as any;
      ok(usageFilterBody.records.length === 1, 'Admin Usage: tenant filter narrows records');
      ok(usageFilterBody.records[0].tenantId === 'tenant-admin', 'Admin Usage: tenant filter record correct');

      const revokeRes = await fetch(`${BASE}/api/v1/admin/tenant-keys/${issueBody.key.id}/revoke`, {
        method: 'POST',
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(revokeRes.status === 200, 'Admin API: revoke status 200');
      const revokeBody = await revokeRes.json() as any;
      ok(revokeBody.key.status === 'revoked', 'Admin API: revoke marks record revoked');

      const revokedTenantRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${issueBody.key.apiKey}` },
      });
      ok(revokedTenantRes.status === 401, 'Admin API: revoked key no longer works');
      console.log(`    account=${createAccountBody.account.id}, issued=${issueBody.key.id}, usageUsed=${usageListed.used}, revoked=${revokeBody.key.status}`);
    }

    console.log(`\n  Live API Tests: ${passed} passed, 0 failed\n`);
  } finally {
    resetAccountStoreForTests();
    resetTenantKeyStoreForTests();
    resetUsageMeter();
    serverHandle.close();
    console.log('  Server stopped.\n');
    // Force exit: embedded Redis / BullMQ connections keep the event loop alive
    process.exit(0);
  }
}

run().catch(err => {
  console.error('  LIVE TEST CRASHED:', err);
  try { serverHandle?.close(); } catch {}
  process.exit(1);
});
