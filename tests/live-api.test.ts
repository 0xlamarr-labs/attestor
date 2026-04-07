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
import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import Stripe from 'stripe';
import { startServer } from '../src/service/api-server.js';
import { issueTenantApiKey, resetTenantKeyStoreForTests, revokeTenantApiKey } from '../src/service/tenant-key-store.js';
import { readUsageLedgerSnapshot, resetUsageMeter } from '../src/service/usage-meter.js';
import { resetTenantRateLimiterForTests } from '../src/service/rate-limit.js';
import { resetAccountStoreForTests } from '../src/service/account-store.js';
import { resetAdminAuditLogForTests } from '../src/service/admin-audit-log.js';
import { resetAdminIdempotencyStoreForTests } from '../src/service/admin-idempotency-store.js';
import { resetStripeWebhookStoreForTests } from '../src/service/stripe-webhook-store.js';
import { resetBillingEventLedgerForTests } from '../src/service/billing-event-ledger.js';
import { resetObservabilityForTests } from '../src/service/observability.js';
import {
  COUNTERPARTY_SQL, COUNTERPARTY_INTENT, COUNTERPARTY_FIXTURE,
  COUNTERPARTY_REPORT, COUNTERPARTY_REPORT_CONTRACT,
} from '../src/financial/fixtures/scenarios.js';

const BASE = 'http://localhost:3700';
const stripe = new Stripe('sk_test_live_api');
let serverHandle: { close: () => void };
let passed = 0;

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

async function waitForJobStatus(
  jobId: string,
  expected: 'completed' | 'failed',
  timeoutMs: number = 6000,
  headers?: Record<string, string>,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/v1/pipeline/status/${jobId}`, { headers });
    const body = await res.json();
    if (body.status === expected) return body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for async job ${jobId} to reach status '${expected}'.`);
}

function ok(condition: boolean, msg: string): void {
  assert(condition, msg);
  passed++;
}

function metricSamples(metrics: string, metricName: string, labels: Record<string, string>): number[] {
  const labelMatcher = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
  return metrics
    .split(/\r?\n/)
    .filter((line) => line.startsWith(metricName))
    .filter((line) => labelMatcher.every((part) => line.includes(part)))
    .map((line) => {
      const value = Number.parseFloat(line.trim().split(/\s+/).pop() ?? 'NaN');
      return value;
    })
    .filter((value) => Number.isFinite(value));
}

async function run() {
  mkdirSync('.attestor', { recursive: true });
  const billingPgDataDir = mkdtempSync(join(process.cwd(), '.attestor', 'live-api-billing-pg-'));
  const billingPgPort = await reservePort();
  const billingPg = new EmbeddedPostgres({
    databaseDir: billingPgDataDir,
    user: 'live_api_billing',
    password: 'live_api_billing',
    port: billingPgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await billingPg.initialise();
  await billingPg.start();
  await billingPg.createDatabase('attestor_billing');
  process.env.ATTESTOR_BILLING_LEDGER_PG_URL = `postgres://live_api_billing:live_api_billing@localhost:${billingPgPort}/attestor_billing`;

  process.env.ATTESTOR_TENANT_KEY_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-tenant-keys.json');
  process.env.ATTESTOR_USAGE_LEDGER_PATH = join(process.cwd(), '.attestor', 'live-api-usage-ledger.json');
  process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-accounts.json');
  process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(process.cwd(), '.attestor', 'live-api-admin-audit.json');
  process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-admin-idempotency.json');
  process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-stripe-webhooks.json');
  process.env.ATTESTOR_OBSERVABILITY_LOG_PATH = join(process.cwd(), '.attestor', 'live-api-observability.jsonl');
  process.env.ATTESTOR_ADMIN_API_KEY = 'admin-secret';
  process.env.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS = '2';
  process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS = '3';
  process.env.ATTESTOR_RATE_LIMIT_PRO_REQUESTS = '20';
  process.env.ATTESTOR_ASYNC_PENDING_STARTER_JOBS = '1';
  process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
  process.env.STRIPE_API_KEY = 'sk_test_live_api_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_live_api_test';
  process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.dev/billing/success';
  process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.dev/billing/cancel';
  process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://attestor.dev/app';
  process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_ENTERPRISE = 'price_enterprise_monthly';
  resetTenantKeyStoreForTests();
  resetUsageMeter();
  resetTenantRateLimiterForTests();
  resetAccountStoreForTests();
  resetAdminAuditLogForTests();
  resetAdminIdempotencyStoreForTests();
  resetStripeWebhookStoreForTests();
  await resetBillingEventLedgerForTests();
  resetObservabilityForTests();

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
      ok(Boolean(res.headers.get('x-attestor-trace-id')), 'Health: trace id header present');
      ok(Boolean(res.headers.get('traceparent')), 'Health: traceparent header present');
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
      ok(typeof body.asyncQueue?.tenantPendingJobs === 'number', 'Async: queue snapshot present');
      ok(body.asyncQueue?.retryPolicy?.attempts >= 1, 'Async: retry policy present');
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
      ok(typeof body.attemptsMade === 'number', 'Async: attemptsMade returned');
      ok(typeof body.maxAttempts === 'number' && body.maxAttempts >= 1, 'Async: maxAttempts returned');
      ok(body.tenantContext?.tenantId === 'default', 'Async: tenant context returned in status');
      console.log(`    status=${body.status}, backend=${body.backendMode}, decision=${body.result.decision}, cert=${body.result.certificateId}`);
    }

    // Status for non-existent job
    console.log('\n  [GET /api/v1/pipeline/status/nonexistent]');
    {
      const res = await fetch(`${BASE}/api/v1/pipeline/status/nonexistent`);
      ok(res.status === 404, 'Async: unknown job = 404');
      console.log(`    unknown job rejected`);
    }

    console.log('\n  [Async Queue Hardening — tenant cap + DLQ + retry]');
    {
      const queueTenant = issueTenantApiKey({
        tenantId: 'tenant-queue',
        tenantName: 'Queue Tenant',
        planId: 'starter',
      });
      const queueHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${queueTenant.apiKey}`,
      };

      const payload = JSON.stringify({
        candidateSql: COUNTERPARTY_SQL,
        intent: COUNTERPARTY_INTENT,
        fixtures: [COUNTERPARTY_FIXTURE],
        generatedReport: COUNTERPARTY_REPORT,
        reportContract: COUNTERPARTY_REPORT_CONTRACT,
        sign: false,
      });
      const [queueAttemptA, queueAttemptB] = await Promise.all([
        fetch(`${BASE}/api/v1/pipeline/run-async`, {
          method: 'POST',
          headers: queueHeaders,
          body: payload,
        }),
        fetch(`${BASE}/api/v1/pipeline/run-async`, {
          method: 'POST',
          headers: queueHeaders,
          body: payload,
        }),
      ]);
      const queueBodies = [
        { status: queueAttemptA.status, body: await queueAttemptA.json() as any },
        { status: queueAttemptB.status, body: await queueAttemptB.json() as any },
      ];
      const acceptedQueueJob = queueBodies.find((entry) => entry.status === 202);
      const rejectedQueueJob = queueBodies.find((entry) => entry.status === 429);
      ok(Boolean(acceptedQueueJob), 'Async Queue: one starter job accepted');
      ok(Boolean(rejectedQueueJob), 'Async Queue: one starter job rejected at pending cap');
      ok(acceptedQueueJob!.body.asyncQueue.tenantIsolationEnforced === true, 'Async Queue: starter tenant isolation enforced');
      ok(acceptedQueueJob!.body.asyncQueue.tenantPendingLimit === 1, 'Async Queue: starter tenant pending cap = 1');
      ok(rejectedQueueJob!.body.asyncQueue.tenantPendingJobs >= 1, 'Async Queue: rejected response reports pending jobs');
      ok(rejectedQueueJob!.body.asyncQueue.tenantPendingLimit === 1, 'Async Queue: rejected response reports pending limit');

      const failedTenant = issueTenantApiKey({
        tenantId: 'tenant-dlq',
        tenantName: 'DLQ Tenant',
        planId: 'pro',
      });
      const failedSubmit = await fetch(`${BASE}/api/v1/pipeline/run-async`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${failedTenant.apiKey}`,
        },
        body: JSON.stringify({
          candidateSql: 123,
          intent: 'bad-intent',
          sign: false,
        }),
      });
      ok(failedSubmit.status === 202, 'Async Queue: invalid payload still reaches worker for DLQ proof');
      const failedSubmitBody = await failedSubmit.json() as any;
      const failedStatus = await waitForJobStatus(
        failedSubmitBody.jobId,
        'failed',
        6000,
        { Authorization: `Bearer ${failedTenant.apiKey}` },
      );
      ok(failedStatus.error.includes('candidateSql') || failedStatus.error.includes('intent'), 'Async Queue: worker exposes validation failure');
      ok(failedStatus.maxAttempts >= 1, 'Async Queue: failed status reports retry ceiling');
      ok(failedStatus.tenantContext?.tenantId === 'tenant-dlq', 'Async Queue: failed status keeps tenant context');

      const adminQueueNoAuth = await fetch(`${BASE}/api/v1/admin/queue`);
      ok(adminQueueNoAuth.status === 401, 'Admin Queue: auth required');

      const adminQueueRes = await fetch(`${BASE}/api/v1/admin/queue?tenantId=tenant-dlq&planId=pro`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(adminQueueRes.status === 200, 'Admin Queue: status 200');
      const adminQueueBody = await adminQueueRes.json() as any;
      ok(adminQueueBody.retryPolicy.attempts >= 1, 'Admin Queue: retry policy exposed');
      ok(adminQueueBody.tenant?.tenantId === 'tenant-dlq', 'Admin Queue: tenant snapshot returned');
      ok(adminQueueBody.counts.failed >= 1, 'Admin Queue: failed count reflected');

      const dlqNoAuth = await fetch(`${BASE}/api/v1/admin/queue/dlq`);
      ok(dlqNoAuth.status === 401, 'Admin DLQ: auth required');

      const dlqRes = await fetch(`${BASE}/api/v1/admin/queue/dlq?tenantId=tenant-dlq&limit=10`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(dlqRes.status === 200, 'Admin DLQ: status 200');
      const dlqBody = await dlqRes.json() as any;
      ok(dlqBody.summary.recordCount >= 1, 'Admin DLQ: at least one failed job listed');
      const dlqRecord = dlqBody.records.find((record: any) => record.jobId === failedSubmitBody.jobId);
      ok(Boolean(dlqRecord), 'Admin DLQ: failed job record present');
      ok(dlqRecord.failedReason.includes('candidateSql') || dlqRecord.failedReason.includes('intent'), 'Admin DLQ: failure reason preserved');

      const retryNoAuth = await fetch(`${BASE}/api/v1/admin/queue/jobs/${failedSubmitBody.jobId}/retry`, {
        method: 'POST',
      });
      ok(retryNoAuth.status === 401, 'Admin Queue Retry: auth required');

      const retryRes = await fetch(`${BASE}/api/v1/admin/queue/jobs/${failedSubmitBody.jobId}/retry`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'queue-retry-live-api',
        },
      });
      ok(retryRes.status === 202, 'Admin Queue Retry: status 202');
      const retryBody = await retryRes.json() as any;
      ok(retryBody.job.jobId === failedSubmitBody.jobId, 'Admin Queue Retry: same job retried');

      const retryAuditRes = await fetch(`${BASE}/api/v1/admin/audit?action=async_job.retried`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(retryAuditRes.status === 200, 'Admin Queue Retry: audit status 200');
      const retryAuditBody = await retryAuditRes.json() as any;
      ok(retryAuditBody.summary.recordCount >= 1, 'Admin Queue Retry: retry action audited');
      console.log(`    cap=1, failedJob=${failedSubmitBody.jobId}, dlqRecords=${dlqBody.summary.recordCount}`);
    }

    // ═══ PIPELINE RUN — bad input ═══
    console.log('\n  [POST /api/v1/pipeline/run — missing fields]');
    {
      const badInputTenant = issueTenantApiKey({
        tenantId: 'tenant-bad-input',
        tenantName: 'Bad Input Tenant',
        planId: 'pro',
      });
      const res = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${badInputTenant.apiKey}`,
        },
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
      const notFoundTenant = issueTenantApiKey({
        tenantId: 'tenant-not-found',
        tenantName: 'Not Found Tenant',
        planId: 'pro',
      });
      const res = await fetch(`${BASE}/api/v1/nonexistent`, {
        headers: { Authorization: `Bearer ${notFoundTenant.apiKey}` },
      });
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
      ok(usageBody.rateLimit.requestsPerWindow === 3, 'File store: rate limit propagated');

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
      const plansNoAuth = await fetch(`${BASE}/api/v1/admin/plans`);
      ok(plansNoAuth.status === 401, 'Admin Plans: auth required');

      const plansRes = await fetch(`${BASE}/api/v1/admin/plans`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(plansRes.status === 200, 'Admin Plans: list status 200');
      const plansBody = await plansRes.json() as any;
      ok(plansBody.defaults.hostedProvisioningPlanId === 'starter', 'Admin Plans: hosted default = starter');
      ok(plansBody.defaults.rateLimitWindowSeconds === 2, 'Admin Plans: rate-limit window override exposed');
      const starterPlan = plansBody.plans.find((entry: any) => entry.id === 'starter');
      ok(Boolean(starterPlan), 'Admin Plans: starter plan present');
      ok(starterPlan.defaultMonthlyRunQuota === 100, 'Admin Plans: starter quota = 100');
      ok(starterPlan.defaultPipelineRequestsPerWindow === 3, 'Admin Plans: starter rate limit = 3');
      ok(starterPlan.stripePriceConfigured === true, 'Admin Plans: starter Stripe price configured');
      ok(starterPlan.defaultForHostedProvisioning === true, 'Admin Plans: starter is hosted default');

      const accountsNoAuth = await fetch(`${BASE}/api/v1/admin/accounts`);
      ok(accountsNoAuth.status === 401, 'Admin Accounts: auth required');

      const createAccountRes = await fetch(`${BASE}/api/v1/admin/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-create-1',
        },
        body: JSON.stringify({
          accountName: 'Account Co',
          contactEmail: 'ops@account.example',
          tenantId: 'tenant-account',
          tenantName: 'Account Tenant',
        }),
      });
      ok(createAccountRes.status === 201, 'Admin Accounts: create status 201');
      const createAccountBody = await createAccountRes.json() as any;
      ok(createAccountBody.account.accountName === 'Account Co', 'Admin Accounts: account name persisted');
      ok(typeof createAccountBody.initialKey.apiKey === 'string', 'Admin Accounts: initial key returned');
      ok(createAccountBody.initialKey.planId === 'starter', 'Admin Accounts: hosted default plan applied');
      ok(createAccountBody.initialKey.monthlyRunQuota === 100, 'Admin Accounts: hosted default quota applied');

      const createAccountReplayRes = await fetch(`${BASE}/api/v1/admin/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-create-1',
        },
        body: JSON.stringify({
          accountName: 'Account Co',
          contactEmail: 'ops@account.example',
          tenantId: 'tenant-account',
          tenantName: 'Account Tenant',
        }),
      });
      ok(createAccountReplayRes.status === 201, 'Admin Accounts: idempotent replay preserves status');
      ok(createAccountReplayRes.headers.get('x-attestor-idempotent-replay') === 'true', 'Admin Accounts: replay header set');
      const createAccountReplayBody = await createAccountReplayRes.json() as any;
      ok(createAccountReplayBody.account.id === createAccountBody.account.id, 'Admin Accounts: replay preserves account id');
      ok(createAccountReplayBody.initialKey.id === createAccountBody.initialKey.id, 'Admin Accounts: replay preserves initial key id');
      ok(createAccountReplayBody.initialKey.apiKey === createAccountBody.initialKey.apiKey, 'Admin Accounts: replay preserves plaintext API key');

      const createAccountConflictRes = await fetch(`${BASE}/api/v1/admin/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-create-1',
        },
        body: JSON.stringify({
          accountName: 'Account Co Changed',
          contactEmail: 'ops@account.example',
          tenantId: 'tenant-account',
          tenantName: 'Account Tenant',
        }),
      });
      ok(createAccountConflictRes.status === 409, 'Admin Accounts: mismatched idempotent request rejected');

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
      const accountUsageBody = await accountUsageRes.json() as any;
      ok(accountUsageBody.rateLimit.requestsPerWindow === 3, 'Admin Accounts: starter rate limit visible on account usage');

      const accountSummaryRes = await fetch(`${BASE}/api/v1/account`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(accountSummaryRes.status === 200, 'Account API: summary status 200');
      const accountSummaryBody = await accountSummaryRes.json() as any;
      ok(accountSummaryBody.account.id === createAccountBody.account.id, 'Account API: summary returns hosted account');
      ok(accountSummaryBody.account.billing.provider === null, 'Account API: billing starts empty');

      const checkoutMissingKeyRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createAccountBody.initialKey.apiKey}`,
        },
        body: JSON.stringify({ planId: 'pro' }),
      });
      ok(checkoutMissingKeyRes.status === 400, 'Account Billing: checkout requires Idempotency-Key');

      const checkoutNoPlanRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createAccountBody.initialKey.apiKey}`,
          'Idempotency-Key': 'checkout-no-plan-1',
        },
        body: JSON.stringify({}),
      });
      ok(checkoutNoPlanRes.status === 400, 'Account Billing: checkout requires planId');

      const checkoutRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createAccountBody.initialKey.apiKey}`,
          'Idempotency-Key': 'checkout-account-1',
        },
        body: JSON.stringify({ planId: 'pro' }),
      });
      ok(checkoutRes.status === 200, 'Account Billing: checkout status 200');
      const checkoutBody = await checkoutRes.json() as any;
      ok(checkoutBody.planId === 'pro', 'Account Billing: checkout plan echoed');
      ok(checkoutBody.stripePriceId === 'price_pro_monthly', 'Account Billing: checkout uses mapped Stripe price');
      ok(String(checkoutBody.checkoutUrl).includes('/checkout/'), 'Account Billing: checkout URL returned');
      ok(checkoutBody.mock === true, 'Account Billing: checkout mock mode surfaced');
      ok(checkoutRes.headers.get('x-attestor-idempotency-key') === 'checkout-account-1', 'Account Billing: checkout echoes idempotency key');

      const checkoutReplayRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createAccountBody.initialKey.apiKey}`,
          'Idempotency-Key': 'checkout-account-1',
        },
        body: JSON.stringify({ planId: 'pro' }),
      });
      ok(checkoutReplayRes.status === 200, 'Account Billing: checkout replay preserves status 200');
      const checkoutReplayBody = await checkoutReplayRes.json() as any;
      ok(checkoutReplayBody.checkoutSessionId === checkoutBody.checkoutSessionId, 'Account Billing: checkout replay returns same session id');
      ok(checkoutReplayBody.checkoutUrl === checkoutBody.checkoutUrl, 'Account Billing: checkout replay returns same URL');

      const portalMissingCustomerRes = await fetch(`${BASE}/api/v1/account/billing/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(portalMissingCustomerRes.status === 409, 'Account Billing: portal requires Stripe customer');

      ok(listedAccount.status === 'active', 'Admin Accounts: new account starts active');
      ok(listedAccount.billing.provider === null, 'Admin Accounts: billing starts empty');

      const attachBillingRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/stripe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-billing-attach-1',
        },
        body: JSON.stringify({
          stripeCustomerId: 'cus_account_001',
          stripeSubscriptionId: 'sub_account_001',
          stripeSubscriptionStatus: 'active',
          stripePriceId: 'price_pro_monthly',
        }),
      });
      ok(attachBillingRes.status === 200, 'Admin Accounts: attach stripe billing status 200');
      const attachBillingBody = await attachBillingRes.json() as any;
      ok(attachBillingBody.account.billing.provider === 'stripe', 'Admin Accounts: stripe provider persisted');
      ok(attachBillingBody.account.billing.stripeCustomerId === 'cus_account_001', 'Admin Accounts: stripe customer persisted');
      ok(attachBillingBody.account.billing.stripeSubscriptionId === 'sub_account_001', 'Admin Accounts: stripe subscription persisted');
      ok(attachBillingBody.account.billing.stripeSubscriptionStatus === 'active', 'Admin Accounts: stripe status persisted');

      const attachBillingReplayRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/stripe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-billing-attach-1',
        },
        body: JSON.stringify({
          stripeCustomerId: 'cus_account_001',
          stripeSubscriptionId: 'sub_account_001',
          stripeSubscriptionStatus: 'active',
          stripePriceId: 'price_pro_monthly',
        }),
      });
      ok(attachBillingReplayRes.status === 200, 'Admin Accounts: attach stripe replay preserves status');
      ok(attachBillingReplayRes.headers.get('x-attestor-idempotent-replay') === 'true', 'Admin Accounts: attach stripe replay header set');

      const checkoutCompletedPayload = JSON.stringify({
        id: 'evt_checkout_account_001_completed',
        object: 'event',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: checkoutBody.checkoutSessionId,
            object: 'checkout.session',
            mode: 'subscription',
            customer: 'cus_account_001',
            subscription: 'sub_account_001',
            created: Math.floor(Date.now() / 1000),
            metadata: {
              attestorAccountId: createAccountBody.account.id,
              attestorTenantId: createAccountBody.account.primaryTenantId,
              attestorPlanId: 'pro',
            },
          },
        },
      });
      const checkoutCompletedSignature = stripe.webhooks.generateTestHeaderString({
        payload: checkoutCompletedPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });
      const checkoutCompletedRes = await fetch(`${BASE}/api/v1/billing/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': checkoutCompletedSignature,
        },
        body: checkoutCompletedPayload,
      });
      ok(checkoutCompletedRes.status === 200, 'Stripe Webhook: checkout.session.completed accepted');
      const checkoutCompletedBody = await checkoutCompletedRes.json() as any;
      ok(checkoutCompletedBody.billing.lastCheckoutSessionId === checkoutBody.checkoutSessionId, 'Stripe Webhook: checkout completion stores session id');
      ok(checkoutCompletedBody.billing.lastCheckoutPlanId === 'pro', 'Stripe Webhook: checkout completion stores target plan');
      ok(typeof checkoutCompletedBody.billing.lastCheckoutCompletedAt === 'string', 'Stripe Webhook: checkout completion stores completed timestamp');
      ok(checkoutCompletedBody.mappedPlanId === 'pro', 'Stripe Webhook: checkout completion maps hosted plan');

      const suspendAccountRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-suspend-1',
        },
        body: JSON.stringify({ reason: 'manual hold' }),
      });
      ok(suspendAccountRes.status === 200, 'Admin Accounts: suspend status 200');
      const suspendAccountBody = await suspendAccountRes.json() as any;
      ok(suspendAccountBody.account.status === 'suspended', 'Admin Accounts: suspend marks account suspended');
      ok(typeof suspendAccountBody.account.suspendedAt === 'string', 'Admin Accounts: suspend captures suspendedAt');

      const suspendedAccountUsageRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(suspendedAccountUsageRes.status === 403, 'Admin Accounts: suspended account key blocked');
      const suspendedAccountUsageBody = await suspendedAccountUsageRes.json() as any;
      ok(suspendedAccountUsageBody.accountStatus === 'suspended', 'Admin Accounts: suspended account status surfaced');

      const reactivateAccountRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/reactivate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-reactivate-1',
        },
        body: JSON.stringify({ reason: 'billing fixed' }),
      });
      ok(reactivateAccountRes.status === 200, 'Admin Accounts: reactivate status 200');
      const reactivateAccountBody = await reactivateAccountRes.json() as any;
      ok(reactivateAccountBody.account.status === 'active', 'Admin Accounts: reactivate restores active status');
      ok(reactivateAccountBody.account.suspendedAt === null, 'Admin Accounts: reactivate clears suspendedAt');

      const reactivatedAccountUsageRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(reactivatedAccountUsageRes.status === 200, 'Admin Accounts: reactivated account key works again');

      const pastDuePayload = JSON.stringify({
        id: 'evt_sub_account_001_past_due',
        object: 'event',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_account_001',
            object: 'subscription',
            customer: 'cus_account_001',
            status: 'past_due',
            metadata: {},
            items: {
              object: 'list',
              data: [{ price: { id: 'price_pro_monthly' } }],
            },
          },
        },
      });
      const pastDueSignature = stripe.webhooks.generateTestHeaderString({
        payload: pastDuePayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });
      const pastDueWebhookRes = await fetch(`${BASE}/api/v1/billing/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': pastDueSignature,
        },
        body: pastDuePayload,
      });
      ok(pastDueWebhookRes.status === 200, 'Stripe Webhook: past_due event accepted');
      const pastDueWebhookBody = await pastDueWebhookRes.json() as any;
      ok(pastDueWebhookBody.accountStatus === 'suspended', 'Stripe Webhook: past_due suspends account');
      ok(pastDueWebhookBody.billing.stripeSubscriptionStatus === 'past_due', 'Stripe Webhook: billing status updated to past_due');

      const blockedAfterWebhookRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(blockedAfterWebhookRes.status === 403, 'Stripe Webhook: suspended account blocked after webhook');

      const suspendedPortalRes = await fetch(`${BASE}/api/v1/account/billing/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(suspendedPortalRes.status === 200, 'Stripe Webhook: suspended account may still open billing portal');

      const pastDueWebhookReplayRes = await fetch(`${BASE}/api/v1/billing/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': pastDueSignature,
        },
        body: pastDuePayload,
      });
      ok(pastDueWebhookReplayRes.status === 200, 'Stripe Webhook: duplicate event preserves 200');
      ok(pastDueWebhookReplayRes.headers.get('x-attestor-stripe-replay') === 'true', 'Stripe Webhook: duplicate header set');
      const pastDueWebhookReplayBody = await pastDueWebhookReplayRes.json() as any;
      ok(pastDueWebhookReplayBody.duplicate === true, 'Stripe Webhook: duplicate replay flagged');

      const activePayload = JSON.stringify({
        id: 'evt_sub_account_001_active',
        object: 'event',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_account_001',
            object: 'subscription',
            customer: 'cus_account_001',
            status: 'active',
            metadata: {},
            items: {
              object: 'list',
              data: [{ price: { id: 'price_pro_monthly' } }],
            },
          },
        },
      });
      const activeSignature = stripe.webhooks.generateTestHeaderString({
        payload: activePayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });
      const activeWebhookRes = await fetch(`${BASE}/api/v1/billing/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': activeSignature,
        },
        body: activePayload,
      });
      ok(activeWebhookRes.status === 200, 'Stripe Webhook: active event accepted');
      const activeWebhookBody = await activeWebhookRes.json() as any;
      ok(activeWebhookBody.accountStatus === 'active', 'Stripe Webhook: active event restores account');
      ok(activeWebhookBody.billing.stripeSubscriptionStatus === 'active', 'Stripe Webhook: billing status restored to active');
      ok(activeWebhookBody.mappedPlanId === 'pro', 'Stripe Webhook: Stripe price maps back to hosted plan');

      const allowedAfterActiveWebhookRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(allowedAfterActiveWebhookRes.status === 200, 'Stripe Webhook: active account key works again');
      const allowedAfterActiveWebhookBody = await allowedAfterActiveWebhookRes.json() as any;
      ok(allowedAfterActiveWebhookBody.tenantContext.planId === 'pro', 'Stripe Webhook: tenant plan updated from Stripe price');
      ok(allowedAfterActiveWebhookBody.usage.quota === 1000, 'Stripe Webhook: tenant quota updated from Stripe price');

      const invoiceFailedPayload = JSON.stringify({
        id: 'evt_invoice_account_001_failed',
        object: 'event',
        type: 'invoice.payment_failed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'in_account_001_failed',
            object: 'invoice',
            customer: 'cus_account_001',
            subscription: 'sub_account_001',
            status: 'open',
            currency: 'usd',
            amount_paid: 0,
            amount_due: 5000,
            billing_reason: 'subscription_cycle',
            metadata: {
              attestorAccountId: createAccountBody.account.id,
            },
            status_transitions: {
              paid_at: null,
            },
            lines: {
              object: 'list',
              data: [{ price: { id: 'price_pro_monthly' } }],
            },
          },
        },
      });
      const invoiceFailedSignature = stripe.webhooks.generateTestHeaderString({
        payload: invoiceFailedPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });
      const invoiceFailedRes = await fetch(`${BASE}/api/v1/billing/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': invoiceFailedSignature,
        },
        body: invoiceFailedPayload,
      });
      ok(invoiceFailedRes.status === 200, 'Stripe Webhook: invoice.payment_failed accepted');
      const invoiceFailedBody = await invoiceFailedRes.json() as any;
      ok(invoiceFailedBody.billing.lastInvoiceId === 'in_account_001_failed', 'Stripe Webhook: invoice failure stores invoice id');
      ok(invoiceFailedBody.billing.lastInvoiceStatus === 'open', 'Stripe Webhook: invoice failure stores invoice status');
      ok(invoiceFailedBody.billing.lastInvoiceAmountDue === 5000, 'Stripe Webhook: invoice failure stores amount due');
      ok(typeof invoiceFailedBody.billing.delinquentSince === 'string', 'Stripe Webhook: invoice failure stores delinquentSince');

      const invoicePaidPayload = JSON.stringify({
        id: 'evt_invoice_account_001_paid',
        object: 'event',
        type: 'invoice.paid',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'in_account_001_paid',
            object: 'invoice',
            customer: 'cus_account_001',
            subscription: 'sub_account_001',
            status: 'paid',
            currency: 'usd',
            amount_paid: 5000,
            amount_due: 5000,
            billing_reason: 'subscription_cycle',
            metadata: {
              attestorAccountId: createAccountBody.account.id,
            },
            status_transitions: {
              paid_at: Math.floor(Date.now() / 1000),
            },
            lines: {
              object: 'list',
              data: [{ price: { id: 'price_pro_monthly' } }],
            },
          },
        },
      });
      const invoicePaidSignature = stripe.webhooks.generateTestHeaderString({
        payload: invoicePaidPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });
      const invoicePaidRes = await fetch(`${BASE}/api/v1/billing/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': invoicePaidSignature,
        },
        body: invoicePaidPayload,
      });
      ok(invoicePaidRes.status === 200, 'Stripe Webhook: invoice.paid accepted');
      const invoicePaidBody = await invoicePaidRes.json() as any;
      ok(invoicePaidBody.billing.lastInvoiceId === 'in_account_001_paid', 'Stripe Webhook: invoice paid stores latest invoice id');
      ok(invoicePaidBody.billing.lastInvoiceStatus === 'paid', 'Stripe Webhook: invoice paid stores paid status');
      ok(invoicePaidBody.billing.lastInvoiceAmountPaid === 5000, 'Stripe Webhook: invoice paid stores amount paid');
      ok(typeof invoicePaidBody.billing.lastInvoicePaidAt === 'string', 'Stripe Webhook: invoice paid stores paid timestamp');
      ok(invoicePaidBody.billing.delinquentSince === null, 'Stripe Webhook: invoice paid clears delinquentSince');

      const portalReadyRes = await fetch(`${BASE}/api/v1/account/billing/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(portalReadyRes.status === 200, 'Account Billing: portal status 200 once customer exists');
      const portalReadyBody = await portalReadyRes.json() as any;
      ok(String(portalReadyBody.portalUrl).includes('/portal/'), 'Account Billing: portal URL returned');
      ok(portalReadyBody.mock === true, 'Account Billing: portal mock mode surfaced');

      const accountSummaryAfterWebhookRes = await fetch(`${BASE}/api/v1/account`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(accountSummaryAfterWebhookRes.status === 200, 'Account API: summary still available after webhook');
      const accountSummaryAfterWebhookBody = await accountSummaryAfterWebhookRes.json() as any;
      ok(accountSummaryAfterWebhookBody.account.billing.stripeCustomerId === 'cus_account_001', 'Account API: summary shows Stripe customer');
      ok(accountSummaryAfterWebhookBody.account.billing.stripeSubscriptionId === 'sub_account_001', 'Account API: summary shows Stripe subscription');
      ok(accountSummaryAfterWebhookBody.account.billing.stripeSubscriptionStatus === 'active', 'Account API: summary shows restored Stripe status');
      ok(accountSummaryAfterWebhookBody.account.billing.lastCheckoutSessionId === checkoutBody.checkoutSessionId, 'Account API: summary shows checkout session');
      ok(accountSummaryAfterWebhookBody.account.billing.lastCheckoutPlanId === 'pro', 'Account API: summary shows checkout plan');
      ok(accountSummaryAfterWebhookBody.account.billing.lastInvoiceStatus === 'paid', 'Account API: summary shows last invoice status');
      ok(accountSummaryAfterWebhookBody.account.billing.lastInvoiceAmountPaid === 5000, 'Account API: summary shows last invoice payment');
      ok(accountSummaryAfterWebhookBody.account.billing.delinquentSince === null, 'Account API: summary shows cleared delinquentSince');
      ok(accountSummaryAfterWebhookBody.tenantContext.planId === 'pro', 'Account API: summary shows synced plan');

      const accountBillingExportRes = await fetch(`${BASE}/api/v1/account/billing/export?limit=5`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(accountBillingExportRes.status === 200, 'Account Billing Export: json status 200');
      const accountBillingExportBody = await accountBillingExportRes.json() as any;
      ok(accountBillingExportBody.accountId === createAccountBody.account.id, 'Account Billing Export: account id matches');
      ok(accountBillingExportBody.checkout.sessionId === checkoutBody.checkoutSessionId, 'Account Billing Export: checkout session propagated');
      ok(accountBillingExportBody.summary.dataSource === 'ledger_derived', 'Account Billing Export: ledger-derived source used when shared billing ledger available');
      const exportedInvoice = accountBillingExportBody.invoices.find((entry: any) => entry.invoiceId === 'in_account_001_paid');
      ok(Boolean(exportedInvoice), 'Account Billing Export: paid invoice exported');
      ok(exportedInvoice.amountPaid === 5000, 'Account Billing Export: paid invoice amount exported');
      const exportedCharge = accountBillingExportBody.charges.find((entry: any) => entry.invoiceId === 'in_account_001_paid');
      ok(Boolean(exportedCharge), 'Account Billing Export: derived charge exported from invoice.paid');
      ok(exportedCharge.status === 'succeeded', 'Account Billing Export: derived charge status succeeded');

      const accountBillingExportCsvRes = await fetch(`${BASE}/api/v1/account/billing/export?format=csv&limit=5`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(accountBillingExportCsvRes.status === 200, 'Account Billing Export: csv status 200');
      ok((accountBillingExportCsvRes.headers.get('content-type') ?? '').includes('text/csv'), 'Account Billing Export: csv content-type');
      const accountBillingExportCsv = await accountBillingExportCsvRes.text();
      ok(accountBillingExportCsv.includes('recordType,accountId,tenantId'), 'Account Billing Export: csv header present');
      ok(accountBillingExportCsv.includes('invoice') && accountBillingExportCsv.includes('in_account_001_paid'), 'Account Billing Export: csv includes invoice row');

      const adminBillingExportNoAuth = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/export`);
      ok(adminBillingExportNoAuth.status === 401, 'Admin Account Billing Export: auth required');

      const adminBillingExportRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/export?limit=5`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(adminBillingExportRes.status === 200, 'Admin Account Billing Export: json status 200');
      const adminBillingExportBody = await adminBillingExportRes.json() as any;
      ok(adminBillingExportBody.accountId === createAccountBody.account.id, 'Admin Account Billing Export: account id matches');
      ok(adminBillingExportBody.summary.invoiceCount >= 1, 'Admin Account Billing Export: invoice count reported');

      const adminBillingExportCsvRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/export?format=csv&limit=5`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(adminBillingExportCsvRes.status === 200, 'Admin Account Billing Export: csv status 200');
      ok((adminBillingExportCsvRes.headers.get('content-disposition') ?? '').includes(`${createAccountBody.account.id}-billing-export.csv`), 'Admin Account Billing Export: csv attachment filename');

      const billingEventsNoAuth = await fetch(`${BASE}/api/v1/admin/billing/events`);
      ok(billingEventsNoAuth.status === 401, 'Admin Billing Events: auth required');

      const billingEventsRes = await fetch(`${BASE}/api/v1/admin/billing/events?accountId=${createAccountBody.account.id}&limit=10`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(billingEventsRes.status === 200, 'Admin Billing Events: list status 200');
      const billingEventsBody = await billingEventsRes.json() as any;
      ok(billingEventsBody.summary.recordCount === 5, 'Admin Billing Events: five webhook events stored for account');
      ok(billingEventsBody.summary.appliedCount === 5, 'Admin Billing Events: all stored events applied');
      const checkoutLedger = billingEventsBody.records.find((entry: any) => entry.providerEventId === 'evt_checkout_account_001_completed');
      ok(Boolean(checkoutLedger), 'Admin Billing Events: checkout completion event present');
      ok(checkoutLedger.stripeCheckoutSessionId === checkoutBody.checkoutSessionId, 'Admin Billing Events: checkout event captures session id');
      ok(checkoutLedger.mappedPlanId === 'pro', 'Admin Billing Events: checkout event captures mapped plan');
      const pastDueLedger = billingEventsBody.records.find((entry: any) => entry.providerEventId === 'evt_sub_account_001_past_due');
      ok(Boolean(pastDueLedger), 'Admin Billing Events: past_due event present');
      ok(pastDueLedger.accountStatusAfter === 'suspended', 'Admin Billing Events: past_due captures suspended status');
      ok(pastDueLedger.billingStatusAfter === 'past_due', 'Admin Billing Events: past_due captures billing status');
      const activeLedger = billingEventsBody.records.find((entry: any) => entry.providerEventId === 'evt_sub_account_001_active');
      ok(Boolean(activeLedger), 'Admin Billing Events: active event present');
      ok(activeLedger.accountStatusBefore === 'suspended', 'Admin Billing Events: active event captures previous status');
      ok(activeLedger.accountStatusAfter === 'active', 'Admin Billing Events: active event captures restored status');
      ok(activeLedger.mappedPlanId === 'pro', 'Admin Billing Events: active event captures mapped plan');
      const invoiceFailedLedger = billingEventsBody.records.find((entry: any) => entry.providerEventId === 'evt_invoice_account_001_failed');
      ok(Boolean(invoiceFailedLedger), 'Admin Billing Events: invoice failure event present');
      ok(invoiceFailedLedger.stripeInvoiceId === 'in_account_001_failed', 'Admin Billing Events: invoice failure captures invoice id');
      ok(invoiceFailedLedger.stripeInvoiceAmountDue === 5000, 'Admin Billing Events: invoice failure captures amount due');
      const invoicePaidLedger = billingEventsBody.records.find((entry: any) => entry.providerEventId === 'evt_invoice_account_001_paid');
      ok(Boolean(invoicePaidLedger), 'Admin Billing Events: invoice paid event present');
      ok(invoicePaidLedger.stripeInvoiceStatus === 'paid', 'Admin Billing Events: invoice paid captures invoice status');
      ok(invoicePaidLedger.stripeInvoiceAmountPaid === 5000, 'Admin Billing Events: invoice paid captures amount paid');

      const billingEventTypeRes = await fetch(`${BASE}/api/v1/admin/billing/events?eventType=customer.subscription.updated`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(billingEventTypeRes.status === 200, 'Admin Billing Events: eventType filter status 200');
      const billingEventTypeBody = await billingEventTypeRes.json() as any;
      ok(billingEventTypeBody.records.length >= 2, 'Admin Billing Events: eventType filter returns Stripe subscription updates');

      const metricsNoAuth = await fetch(`${BASE}/api/v1/admin/metrics`);
      ok(metricsNoAuth.status === 401, 'Admin Metrics: auth required');

      const metricsRes = await fetch(`${BASE}/api/v1/admin/metrics`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(metricsRes.status === 200, 'Admin Metrics: status 200');
      ok((metricsRes.headers.get('content-type') ?? '').includes('text/plain'), 'Admin Metrics: content type is text/plain');
      const metricsBody = await metricsRes.text();
      ok(metricsBody.includes('attestor_http_requests_total'), 'Admin Metrics: http request counter exposed');
      ok(metricsBody.includes('route=\"/api/v1/health\"'), 'Admin Metrics: health route labeled');
      ok(metricsBody.includes('attestor_trace_context_requests_total'), 'Admin Metrics: trace context counter exposed');
      ok(metricsBody.includes('attestor_billing_webhook_events_total'), 'Admin Metrics: billing webhook counter exposed');
      const durationBuckets = metricSamples(metricsBody, 'attestor_http_request_duration_seconds_bucket', {
        method: 'GET',
        route: '/api/v1/health',
      });
      ok(durationBuckets.length >= 2, 'Admin Metrics: duration histogram buckets exposed');
      ok(durationBuckets.every((value, index) => index === 0 || value >= durationBuckets[index - 1]), 'Admin Metrics: duration histogram buckets are monotonic');
      const durationCount = metricSamples(metricsBody, 'attestor_http_request_duration_seconds_count', {
        method: 'GET',
        route: '/api/v1/health',
      })[0];
      const plusInfBucket = metricSamples(metricsBody, 'attestor_http_request_duration_seconds_bucket', {
        method: 'GET',
        route: '/api/v1/health',
        le: '+Inf',
      })[0];
      ok(typeof durationCount === 'number' && typeof plusInfBucket === 'number' && plusInfBucket === durationCount, 'Admin Metrics: +Inf bucket matches histogram count');

      const observabilityLog = readFileSync(process.env.ATTESTOR_OBSERVABILITY_LOG_PATH!, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
      ok(observabilityLog.some((entry: any) => entry.route === '/api/v1/health' && entry.traceId), 'Observability Log: health request captured with trace id');
      ok(observabilityLog.some((entry: any) => entry.route === '/api/v1/billing/stripe/webhook' && entry.accountId === createAccountBody.account.id), 'Observability Log: billing webhook captured with account context');

      const noAuth = await fetch(`${BASE}/api/v1/admin/tenant-keys`);
      ok(noAuth.status === 401, 'Admin API: auth required');

      const issueRes = await fetch(`${BASE}/api/v1/admin/tenant-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-tenant-issue-1',
        },
        body: JSON.stringify({
          tenantId: 'tenant-admin',
          tenantName: 'Admin Co',
          planId: 'pro',
        }),
      });
      ok(issueRes.status === 201, 'Admin API: issue key created');
      const issueBody = await issueRes.json() as any;
      ok(typeof issueBody.key.apiKey === 'string', 'Admin API: plaintext apiKey returned once');
      ok(issueBody.key.planId === 'pro', 'Admin API: plan persisted');
      ok(issueBody.key.monthlyRunQuota === 1000, 'Admin API: plan default quota applied');

      const issueReplayRes = await fetch(`${BASE}/api/v1/admin/tenant-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-tenant-issue-1',
        },
        body: JSON.stringify({
          tenantId: 'tenant-admin',
          tenantName: 'Admin Co',
          planId: 'pro',
        }),
      });
      ok(issueReplayRes.status === 201, 'Admin API: tenant issue replay preserves status');
      ok(issueReplayRes.headers.get('x-attestor-idempotent-replay') === 'true', 'Admin API: tenant issue replay header set');
      const issueReplayBody = await issueReplayRes.json() as any;
      ok(issueReplayBody.key.id === issueBody.key.id, 'Admin API: tenant issue replay preserves key id');
      ok(issueReplayBody.key.apiKey === issueBody.key.apiKey, 'Admin API: tenant issue replay preserves api key');

      const invalidPlanRes = await fetch(`${BASE}/api/v1/admin/tenant-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
        },
        body: JSON.stringify({
          tenantId: 'tenant-invalid',
          tenantName: 'Invalid Co',
          planId: 'wrong-plan',
        }),
      });
      ok(invalidPlanRes.status === 400, 'Admin API: invalid plan rejected');
      const invalidPlanBody = await invalidPlanRes.json() as any;
      ok(String(invalidPlanBody.error).includes('Valid plans'), 'Admin API: invalid plan error is actionable');

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
      ok(listBody.defaults.maxActiveKeysPerTenant === 2, 'Admin API: list exposes active-key policy');
      const listed = listBody.keys.find((entry: any) => entry.id === issueBody.key.id);
      ok(Boolean(listed), 'Admin API: issued key appears in list');
      ok(!('apiKeyHash' in listed), 'Admin API: hash not exposed');
      ok(typeof listed.lastUsedAt === 'string', 'Admin API: lastUsedAt captured after tenant use');

      const rotateRes = await fetch(`${BASE}/api/v1/admin/tenant-keys/${issueBody.key.id}/rotate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-tenant-rotate-1',
        },
        body: JSON.stringify({}),
      });
      ok(rotateRes.status === 201, 'Admin API: rotate status 201');
      const rotateBody = await rotateRes.json() as any;
      ok(typeof rotateBody.newKey.apiKey === 'string', 'Admin API: rotate returns new plaintext API key');
      ok(rotateBody.newKey.rotatedFromKeyId === issueBody.key.id, 'Admin API: new key points to previous key');
      ok(rotateBody.previousKey.supersededByKeyId === rotateBody.newKey.id, 'Admin API: previous key points to replacement');

      const rotateReplayRes = await fetch(`${BASE}/api/v1/admin/tenant-keys/${issueBody.key.id}/rotate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-tenant-rotate-1',
        },
        body: JSON.stringify({}),
      });
      ok(rotateReplayRes.status === 201, 'Admin API: rotate replay preserves status');
      ok(rotateReplayRes.headers.get('x-attestor-idempotent-replay') === 'true', 'Admin API: rotate replay header set');
      const rotateReplayBody = await rotateReplayRes.json() as any;
      ok(rotateReplayBody.newKey.id === rotateBody.newKey.id, 'Admin API: rotate replay preserves new key id');
      ok(rotateReplayBody.newKey.apiKey === rotateBody.newKey.apiKey, 'Admin API: rotate replay preserves plaintext API key');

      const overlapOldRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${issueBody.key.apiKey}` },
      });
      ok(overlapOldRes.status === 200, 'Admin API: previous key stays active during overlap');
      const overlapNewRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${rotateBody.newKey.apiKey}` },
      });
      ok(overlapNewRes.status === 200, 'Admin API: rotated key becomes active immediately');

      const thirdKeyRes = await fetch(`${BASE}/api/v1/admin/tenant-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
        },
        body: JSON.stringify({
          tenantId: 'tenant-admin',
          tenantName: 'Admin Co',
          planId: 'pro',
        }),
      });
      ok(thirdKeyRes.status === 409, 'Admin API: third active key for tenant rejected');

      const deactivateRes = await fetch(`${BASE}/api/v1/admin/tenant-keys/${issueBody.key.id}/deactivate`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-tenant-deactivate-1',
        },
      });
      ok(deactivateRes.status === 200, 'Admin API: deactivate status 200');
      const deactivateBody = await deactivateRes.json() as any;
      ok(deactivateBody.key.status === 'inactive', 'Admin API: deactivate marks key inactive');
      ok(typeof deactivateBody.key.deactivatedAt === 'string', 'Admin API: deactivate captures deactivatedAt');

      const deactivatedTenantRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${issueBody.key.apiKey}` },
      });
      ok(deactivatedTenantRes.status === 401, 'Admin API: inactive key no longer works');

      const reactivateRes = await fetch(`${BASE}/api/v1/admin/tenant-keys/${issueBody.key.id}/reactivate`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-tenant-reactivate-1',
        },
      });
      ok(reactivateRes.status === 200, 'Admin API: reactivate status 200');
      const reactivateBody = await reactivateRes.json() as any;
      ok(reactivateBody.key.status === 'active', 'Admin API: reactivate restores active status');
      ok(reactivateBody.key.deactivatedAt === null, 'Admin API: reactivate clears deactivatedAt');

      const reactivatedTenantRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${issueBody.key.apiKey}` },
      });
      ok(reactivatedTenantRes.status === 200, 'Admin API: reactivated key works again');

      await fetch(`${BASE}/api/v1/admin/tenant-keys/${issueBody.key.id}/deactivate`, {
        method: 'POST',
        headers: { Authorization: 'Bearer admin-secret' },
      });

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
      const accountRunBody = await accountRun.json() as any;
      ok(accountRunBody.rateLimit.requestsPerWindow === 20, 'Admin Accounts: run response reflects synced pro rate limit');
      ok(accountRunBody.rateLimit.used >= 1, 'Admin Accounts: run rate limit usage increments');

      const archiveAccountRes = await fetch(`${BASE}/api/v1/admin/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-create-archive-1',
        },
        body: JSON.stringify({
          accountName: 'Archive Co',
          contactEmail: 'ops@archive.example',
          tenantId: 'tenant-archive',
          tenantName: 'Archive Tenant',
        }),
      });
      ok(archiveAccountRes.status === 201, 'Admin Accounts: archive test account created');
      const archiveAccountBody = await archiveAccountRes.json() as any;

      const archiveRes = await fetch(`${BASE}/api/v1/admin/accounts/${archiveAccountBody.account.id}/archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-account-archive-1',
        },
        body: JSON.stringify({ reason: 'customer offboarded' }),
      });
      ok(archiveRes.status === 200, 'Admin Accounts: archive status 200');
      const archiveBody = await archiveRes.json() as any;
      ok(archiveBody.account.status === 'archived', 'Admin Accounts: archive marks account archived');
      ok(typeof archiveBody.account.archivedAt === 'string', 'Admin Accounts: archive captures archivedAt');

      const archivedUsageRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${archiveAccountBody.initialKey.apiKey}` },
      });
      ok(archivedUsageRes.status === 403, 'Admin Accounts: archived account key blocked');
      const archivedUsageBody = await archivedUsageRes.json() as any;
      ok(archivedUsageBody.accountStatus === 'archived', 'Admin Accounts: archived account status surfaced');

      const archivedReactivateRes = await fetch(`${BASE}/api/v1/admin/accounts/${archiveAccountBody.account.id}/reactivate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
        },
        body: JSON.stringify({ reason: 'should fail' }),
      });
      ok(archivedReactivateRes.status === 409, 'Admin Accounts: archived account cannot reactivate');

      const rateTenantRes = await fetch(`${BASE}/api/v1/admin/tenant-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
        },
        body: JSON.stringify({
          tenantId: 'tenant-rate',
          tenantName: 'Rate Co',
          planId: 'starter',
        }),
      });
      ok(rateTenantRes.status === 201, 'Admin API: starter tenant for rate-limit test issued');
      const rateTenantBody = await rateTenantRes.json() as any;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const allowed = await fetch(`${BASE}/api/v1/pipeline/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${rateTenantBody.key.apiKey}`,
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
        ok(allowed.status === 200, `Rate Limit: starter request ${attempt + 1} allowed`);
        const allowedBody = await allowed.json() as any;
        ok(allowedBody.rateLimit.requestsPerWindow === 3, `Rate Limit: request ${attempt + 1} limit exposed`);
      }

      const limitedSync = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rateTenantBody.key.apiKey}`,
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
      ok(limitedSync.status === 429, 'Rate Limit: sync route throttled after starter window exhausted');
      ok(limitedSync.headers.get('retry-after') !== null, 'Rate Limit: retry-after header present');
      const limitedSyncBody = await limitedSync.json() as any;
      ok(limitedSyncBody.rateLimit.remaining === 0, 'Rate Limit: sync 429 reports zero remaining');
      ok(limitedSyncBody.rateLimit.requestsPerWindow === 3, 'Rate Limit: sync 429 reports starter limit');

      const limitedAsync = await fetch(`${BASE}/api/v1/pipeline/run-async`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rateTenantBody.key.apiKey}`,
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
      ok(limitedAsync.status === 429, 'Rate Limit: async route shares tenant window');

      await new Promise((resolve) => setTimeout(resolve, 2200));

      const afterReset = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rateTenantBody.key.apiKey}`,
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
      ok(afterReset.status === 200, 'Rate Limit: window reset allows new request');
      const afterResetBody = await afterReset.json() as any;
      ok(afterResetBody.rateLimit.used === 1, 'Rate Limit: reset starts new window usage at 1');

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
        headers: {
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-tenant-revoke-1',
        },
      });
      ok(revokeRes.status === 200, 'Admin API: revoke status 200');
      const revokeBody = await revokeRes.json() as any;
      ok(revokeBody.key.status === 'revoked', 'Admin API: revoke marks record revoked');

      const revokeReplayRes = await fetch(`${BASE}/api/v1/admin/tenant-keys/${issueBody.key.id}/revoke`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'idem-tenant-revoke-1',
        },
      });
      ok(revokeReplayRes.status === 200, 'Admin API: revoke replay preserves status');
      ok(revokeReplayRes.headers.get('x-attestor-idempotent-replay') === 'true', 'Admin API: revoke replay header set');
      const revokeReplayBody = await revokeReplayRes.json() as any;
      ok(revokeReplayBody.key.id === revokeBody.key.id, 'Admin API: revoke replay preserves key id');
      ok(revokeReplayBody.key.status === 'revoked', 'Admin API: revoke replay preserves status');

      const revokedTenantRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${issueBody.key.apiKey}` },
      });
      ok(revokedTenantRes.status === 401, 'Admin API: revoked key no longer works');

      const replacementTenantRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${rotateBody.newKey.apiKey}` },
      });
      ok(replacementTenantRes.status === 200, 'Admin API: replacement key stays active after old revoke');

      const auditNoAuth = await fetch(`${BASE}/api/v1/admin/audit`);
      ok(auditNoAuth.status === 401, 'Admin Audit: auth required');

      const auditRes = await fetch(`${BASE}/api/v1/admin/audit?limit=30`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(auditRes.status === 200, 'Admin Audit: list status 200');
      const auditBody = await auditRes.json() as any;
      ok(auditBody.summary.chainIntact === true, 'Admin Audit: chain intact');
      ok(auditBody.summary.recordCount >= 12, 'Admin Audit: expected records present');
      const accountAudit = auditBody.records.find((entry: any) => entry.action === 'account.created' && entry.accountId === createAccountBody.account.id);
      ok(Boolean(accountAudit), 'Admin Audit: account create event present');
      ok(accountAudit.idempotencyKey === 'idem-account-create-1', 'Admin Audit: account create idempotency captured');
      const accountBillingAudit = auditBody.records.find((entry: any) => entry.action === 'account.billing.attached' && entry.accountId === createAccountBody.account.id);
      ok(Boolean(accountBillingAudit), 'Admin Audit: account billing attach event present');
      const accountSuspendAudit = auditBody.records.find((entry: any) => entry.action === 'account.suspended' && entry.accountId === createAccountBody.account.id);
      ok(Boolean(accountSuspendAudit), 'Admin Audit: account suspend event present');
      const accountReactivateAudit = auditBody.records.find((entry: any) => entry.action === 'account.reactivated' && entry.accountId === createAccountBody.account.id);
      ok(Boolean(accountReactivateAudit), 'Admin Audit: account reactivate event present');
      const accountArchiveAudit = auditBody.records.find((entry: any) => entry.action === 'account.archived' && entry.accountId === archiveAccountBody.account.id);
      ok(Boolean(accountArchiveAudit), 'Admin Audit: account archive event present');
      const stripeWebhookAudit = auditBody.records.find((entry: any) => entry.action === 'billing.stripe.webhook_applied' && entry.accountId === createAccountBody.account.id);
      ok(Boolean(stripeWebhookAudit), 'Admin Audit: stripe webhook event present');
      ok(stripeWebhookAudit.actorType === 'stripe_webhook', 'Admin Audit: stripe webhook actor type captured');
      const issueAudit = auditBody.records.find((entry: any) => entry.action === 'tenant_key.issued' && entry.tenantKeyId === issueBody.key.id);
      ok(Boolean(issueAudit), 'Admin Audit: tenant key issue event present');
      const rotateAudit = auditBody.records.find((entry: any) => entry.action === 'tenant_key.rotated' && entry.tenantKeyId === rotateBody.newKey.id);
      ok(Boolean(rotateAudit), 'Admin Audit: tenant key rotate event present');
      const deactivateAudit = auditBody.records.find((entry: any) => entry.action === 'tenant_key.deactivated' && entry.tenantKeyId === issueBody.key.id);
      ok(Boolean(deactivateAudit), 'Admin Audit: tenant key deactivate event present');
      const reactivateAudit = auditBody.records.find((entry: any) => entry.action === 'tenant_key.reactivated' && entry.tenantKeyId === issueBody.key.id);
      ok(Boolean(reactivateAudit), 'Admin Audit: tenant key reactivate event present');
      const revokeAudit = auditBody.records.find((entry: any) => entry.action === 'tenant_key.revoked' && entry.tenantKeyId === issueBody.key.id);
      ok(Boolean(revokeAudit), 'Admin Audit: tenant key revoke event present');

      const auditTenantFilterRes = await fetch(`${BASE}/api/v1/admin/audit?tenantId=tenant-admin`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(auditTenantFilterRes.status === 200, 'Admin Audit: tenant filter status 200');
      const auditTenantFilterBody = await auditTenantFilterRes.json() as any;
      ok(auditTenantFilterBody.records.every((entry: any) => entry.tenantId === 'tenant-admin'), 'Admin Audit: tenant filter narrows records');

      console.log(`    account=${createAccountBody.account.id}, issued=${issueBody.key.id}, usageUsed=${usageListed.used}, revoked=${revokeBody.key.status}`);
    }

    console.log(`\n  Live API Tests: ${passed} passed, 0 failed\n`);
  } finally {
    resetAccountStoreForTests();
    resetTenantKeyStoreForTests();
    resetUsageMeter();
    resetTenantRateLimiterForTests();
    resetAdminAuditLogForTests();
    resetAdminIdempotencyStoreForTests();
    resetStripeWebhookStoreForTests();
    await resetBillingEventLedgerForTests();
    resetObservabilityForTests();
    serverHandle.close();
    await billingPg.stop();
    try { rmSync(billingPgDataDir, { recursive: true, force: true }); } catch {}
    console.log('  Server stopped.\n');
  }
}

run()
  .then(() => {
    // Force exit after assertions completed and cleanup finished.
    process.exit(0);
  })
  .catch(err => {
    console.error('  LIVE TEST CRASHED:', err);
    try { serverHandle?.close(); } catch {}
    process.exit(1);
  });
