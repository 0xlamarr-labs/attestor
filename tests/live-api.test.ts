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
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import JSZip from 'jszip';
import Stripe from 'stripe';
import { startServer } from '../src/service/api-server.js';
import { issueTenantApiKey, resetTenantKeyStoreForTests, revokeTenantApiKey } from '../src/service/tenant-key-store.js';
import { readUsageLedgerSnapshot, resetUsageMeter } from '../src/service/usage-meter.js';
import { resetTenantRateLimiterForTests } from '../src/service/rate-limit.js';
import { resetAccountStoreForTests } from '../src/service/account-store.js';
import { resetAccountUserStoreForTests } from '../src/service/account-user-store.js';
import { resetAccountUserActionTokenStoreForTests } from '../src/service/account-user-token-store.js';
import { resetAccountSessionStoreForTests } from '../src/service/account-session-store.js';
import { resetAdminAuditLogForTests } from '../src/service/admin-audit-log.js';
import { resetAdminIdempotencyStoreForTests } from '../src/service/admin-idempotency-store.js';
import { readAsyncDeadLetterStoreSnapshot, resetAsyncDeadLetterStoreForTests } from '../src/service/async-dead-letter-store.js';
import { resetStripeWebhookStoreForTests } from '../src/service/stripe-webhook-store.js';
import { resetBillingEventLedgerForTests } from '../src/service/billing-event-ledger.js';
import { resetHostedBillingEntitlementStoreForTests } from '../src/service/billing-entitlement-store.js';
import { resetHostedEmailDeliveryEventStoreForTests } from '../src/service/email-delivery-event-store.js';
import { resetObservabilityForTests } from '../src/service/observability.js';
import { generateCurrentTotpCode } from '../src/service/account-mfa.js';
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

function cookieHeaderFromResponse(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  const [cookiePair] = raw.split(';', 1);
  return cookiePair?.trim() || null;
}

function unsignedBearerToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

async function run() {
  mkdirSync('.attestor', { recursive: true });

  // Billing control-plane uses file-backed mode for this test suite.
  // PostgreSQL-backed billing is tested separately in control-plane-backup-pg.test.ts.
  delete process.env.ATTESTOR_BILLING_LEDGER_PG_URL;

  process.env.ATTESTOR_TENANT_KEY_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-tenant-keys.json');
  process.env.ATTESTOR_USAGE_LEDGER_PATH = join(process.cwd(), '.attestor', 'live-api-usage-ledger.json');
  process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-accounts.json');
  process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-account-users.json');
  process.env.ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-account-user-tokens.json');
  process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-account-sessions.json');
  process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY = 'live-api-mfa-secret';
  process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(process.cwd(), '.attestor', 'live-api-admin-audit.json');
  process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-admin-idempotency.json');
  process.env.ATTESTOR_ASYNC_DLQ_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-async-dlq.json');
  process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-stripe-webhooks.json');
  process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH = join(process.cwd(), '.attestor', 'live-api-billing-entitlements.json');
  process.env.ATTESTOR_EMAIL_DELIVERY_EVENTS_PATH = join(process.cwd(), '.attestor', 'live-api-email-delivery-events.json');
  process.env.ATTESTOR_OBSERVABILITY_LOG_PATH = join(process.cwd(), '.attestor', 'live-api-observability.jsonl');
  process.env.ATTESTOR_SESSION_COOKIE_SECURE = 'false';
  process.env.ATTESTOR_ADMIN_API_KEY = 'admin-secret';
  process.env.ATTESTOR_METRICS_API_KEY = 'metrics-secret';
process.env.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS = '5';
  process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS = '3';
  process.env.ATTESTOR_RATE_LIMIT_PRO_REQUESTS = '20';
  process.env.ATTESTOR_ASYNC_PENDING_STARTER_JOBS = '1';
  process.env.ATTESTOR_ASYNC_DISPATCH_BASE_INTERVAL_MS = '400';
  process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
  process.env.STRIPE_API_KEY = 'sk_test_live_api_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_live_api_test';
  process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.dev/billing/success';
  process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.dev/billing/cancel';
  process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://attestor.dev/settings/billing';
  process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_ENTERPRISE = 'price_enterprise_monthly';
  resetTenantKeyStoreForTests();
  resetUsageMeter();
  await resetTenantRateLimiterForTests();
  resetAccountStoreForTests();
  resetAccountUserStoreForTests();
  resetAccountSessionStoreForTests();
  resetAdminAuditLogForTests();
  resetAdminIdempotencyStoreForTests();
  resetAsyncDeadLetterStoreForTests();
  resetStripeWebhookStoreForTests();
  resetHostedBillingEntitlementStoreForTests();
  resetHostedEmailDeliveryEventStoreForTests();
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
      ok(body.version === '1.0.0', 'Health: version correct');
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
    let filingRelease: any = null;
    let reviewRequiredFilingRelease: any = null;
    let reviewQueueId: string | null = null;
    let approvedReleaseToken: string | null = null;
    let breakGlassFilingRelease: any = null;
    let breakGlassReviewQueueId: string | null = null;
    let breakGlassReleaseToken: string | null = null;
    let breakGlassEvidencePackId: string | null = null;
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
      ok(body.filingPackage !== null, 'Pipeline(signed): filing package present');
      ok(body.filingPackage.adapterId === 'xbrl-us-gaap-2024', 'Pipeline(signed): filing package adapter');
      ok(body.filingPackage.issuedPackage.fileExtension === '.xbr', 'Pipeline(signed): filing package uses .xbr');
      ok(body.filingPackage.issuedPackage.archive.base64.length > 0, 'Pipeline(signed): filing archive base64 present');
      ok(body.release?.filingExport !== null, 'Pipeline(signed): filing release artifact present');
      ok(body.release.filingExport.targetId === 'sec.edgar.filing.prepare', 'Pipeline(signed): filing release target bound');
      ok(body.release.filingExport.introspectionRequired === true, 'Pipeline(signed): filing release requires active introspection');
      ok(typeof body.release.filingExport.token === 'string', 'Pipeline(signed): filing release token present');
      ok(typeof body.release.filingExport.outputHash === 'string', 'Pipeline(signed): filing release output hash present');
      ok(typeof body.release.filingExport.consequenceHash === 'string', 'Pipeline(signed): filing release consequence hash present');
      ok(typeof body.release.filingExport.evidencePackId === 'string', 'Pipeline(signed): durable evidence pack id present');
      ok(typeof body.release.filingExport.evidencePackPath === 'string', 'Pipeline(signed): durable evidence pack export path present');
      ok(typeof body.release.filingExport.evidencePackDigest === 'string', 'Pipeline(signed): durable evidence pack digest present');
      ok(body.release.filingExport.candidate.adapterId === 'xbrl-us-gaap-2024', 'Pipeline(signed): filing release candidate adapter');
      ok(Array.isArray(body.release.filingExport.candidate.rows), 'Pipeline(signed): filing release candidate rows present');
      ok(body.release?.communication !== null, 'Pipeline(signed): communication shadow release present');
      ok(body.release.communication.policyRolloutMode === 'dry-run', 'Pipeline(signed): communication flow launches in dry-run rollout mode');
      ok(body.release.communication.policyEvaluationMode === 'shadow', 'Pipeline(signed): communication flow evaluates in shadow mode');
      ok(body.release.communication.decisionStatus === 'accepted', 'Pipeline(signed): communication shadow path would accept the bounded reviewer summary');
      ok(body.release?.action !== null, 'Pipeline(signed): action shadow release present');
      ok(body.release.action.policyRolloutMode === 'dry-run', 'Pipeline(signed): action flow launches in dry-run rollout mode');
      ok(body.release.action.policyEvaluationMode === 'shadow', 'Pipeline(signed): action flow evaluates in shadow mode');
      ok(body.release.action.decisionStatus === 'review-required', 'Pipeline(signed): action shadow path still requires human authority');
      filingRelease = body.release.filingExport;
      console.log(`    cert=${fullCert.certificateId}, chain: CA=${body.trustChain.ca.name}, leaf=${body.trustChain.leaf.subject}`);
    }

    // ═══ PIPELINE RUN — review-required candidate ═══
    console.log('\n  [POST /api/v1/pipeline/run — review-required release candidate]');
    {
      const reviewRequiredIntent = {
        ...COUNTERPARTY_INTENT,
        materialityTier: 'high',
      };
      const res = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: reviewRequiredIntent,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: true,
        }),
      });
      ok(res.status === 200, 'Pipeline(review queue): status 200');
      const body = await res.json() as any;
      ok(body.decision === 'pending_approval', 'Pipeline(review queue): finance decision is pending approval');
      ok(body.release?.filingExport !== null, 'Pipeline(review queue): filing release artifact present');
      ok(body.release.filingExport.decisionStatus === 'hold', 'Pipeline(review queue): release decision is held pending reviewer authority');
      ok(body.release.filingExport.token === null, 'Pipeline(review queue): no release token issued yet');
      ok(typeof body.release.filingExport.reviewQueueId === 'string', 'Pipeline(review queue): reviewer queue id present');
      ok(typeof body.release.filingExport.reviewQueuePath === 'string', 'Pipeline(review queue): reviewer queue path present');
      ok(body.release.communication?.policyEvaluationMode === 'shadow', 'Pipeline(review queue): communication flow remains shadowed on held finance candidates');
      ok(body.release.action?.policyEvaluationMode === 'shadow', 'Pipeline(review queue): action flow remains shadowed on held finance candidates');
      reviewRequiredFilingRelease = body.release.filingExport;
      reviewQueueId = body.release.filingExport.reviewQueueId;
      console.log(`    reviewQueue=${reviewQueueId}, releaseDecision=${body.release.filingExport.decisionId}`);
    }

    // ═══ PIPELINE RUN — break-glass review-required candidate ═══
    console.log('\n  [POST /api/v1/pipeline/run — break-glass review-required candidate]');
    {
      const breakGlassIntent = {
        ...COUNTERPARTY_INTENT,
        materialityTier: 'high',
      };
      const res = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateSql: COUNTERPARTY_SQL,
          intent: breakGlassIntent,
          fixtures: [COUNTERPARTY_FIXTURE],
          generatedReport: COUNTERPARTY_REPORT,
          reportContract: COUNTERPARTY_REPORT_CONTRACT,
          sign: true,
        }),
      });
      ok(res.status === 200, 'Pipeline(break-glass queue): status 200');
      const body = await res.json() as any;
      ok(body.decision === 'pending_approval', 'Pipeline(break-glass queue): finance decision is pending approval');
      ok(body.release?.filingExport !== null, 'Pipeline(break-glass queue): filing release artifact present');
      ok(body.release.filingExport.decisionStatus === 'hold', 'Pipeline(break-glass queue): release decision is held pending reviewer authority');
      ok(body.release.filingExport.token === null, 'Pipeline(break-glass queue): no release token issued yet');
      ok(typeof body.release.filingExport.reviewQueueId === 'string', 'Pipeline(break-glass queue): reviewer queue id present');
      breakGlassFilingRelease = body.release.filingExport;
      breakGlassReviewQueueId = body.release.filingExport.reviewQueueId;
      console.log(`    breakGlassReviewQueue=${breakGlassReviewQueueId}, releaseDecision=${body.release.filingExport.decisionId}`);
    }

    // ═══ REVIEWER QUEUE — list/detail/inbox ═══
    console.log('\n  [GET /api/v1/admin/release-reviews — reviewer inbox]');
    {
      const listRes = await fetch(`${BASE}/api/v1/admin/release-reviews`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(listRes.status === 200, 'Reviewer inbox(list): status 200');
      const listBody = await listRes.json() as any;
      ok(listBody.totalPending >= 1, 'Reviewer inbox(list): at least one pending review is listed');
      ok(Array.isArray(listBody.items), 'Reviewer inbox(list): items array present');
      const listedItem = listBody.items.find((item: any) => item.id === reviewQueueId);
      ok(Boolean(listedItem), 'Reviewer inbox(list): newly queued review is discoverable');
      ok(listedItem.riskClass === 'R4', 'Reviewer inbox(list): queued review keeps R4 risk');

      const detailRes = await fetch(`${BASE}/api/v1/admin/release-reviews/${reviewQueueId}`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(detailRes.status === 200, 'Reviewer inbox(detail): status 200');
      const detailBody = await detailRes.json() as any;
      ok(detailBody.review.id === reviewQueueId, 'Reviewer inbox(detail): requested queue item returned');
      ok(detailBody.review.candidate.rowCount > 0, 'Reviewer inbox(detail): candidate preview present');
      ok(Array.isArray(detailBody.review.timeline) && detailBody.review.timeline.length >= 2, 'Reviewer inbox(detail): timeline included');

      const inboxHtmlRes = await fetch(`${BASE}/api/v1/admin/release-reviews/inbox`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(inboxHtmlRes.status === 200, 'Reviewer inbox(html): status 200');
      ok((inboxHtmlRes.headers.get('content-type') ?? '').includes('text/html'), 'Reviewer inbox(html): text/html content type');
      const inboxHtml = await inboxHtmlRes.text();
      ok(inboxHtml.includes('Human authority before consequence.'), 'Reviewer inbox(html): reviewer inbox headline rendered');
      ok(inboxHtml.includes(String(reviewQueueId)), 'Reviewer inbox(html): queued review is rendered into the inbox view');

      const detailHtmlRes = await fetch(`${BASE}/api/v1/admin/release-reviews/${reviewQueueId}/view`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(detailHtmlRes.status === 200, 'Reviewer inbox(detail html): status 200');
      const detailHtml = await detailHtmlRes.text();
      ok(detailHtml.includes('Release review packet'), 'Reviewer inbox(detail html): detail packet headline rendered');
      ok(detailHtml.includes('Candidate preview'), 'Reviewer inbox(detail html): candidate preview section rendered');
      console.log(`    pending=${listBody.totalPending}, review=${reviewQueueId}`);
    }

    // ═══ REVIEWER QUEUE — named review and dual approval ═══
    console.log('\n  [POST /api/v1/admin/release-reviews/:id/approve — named review + dual approval]');
    {
      const firstApprovalRes = await fetch(`${BASE}/api/v1/admin/release-reviews/${reviewQueueId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reviewerId: 'reviewer.alpha',
          reviewerName: 'Alpha Reviewer',
          reviewerRole: 'financial_reporting_manager',
          note: 'Finance target binding and row preview look correct.',
        }),
      });
      ok(firstApprovalRes.status === 200, 'Reviewer approve(first): status 200');
      const firstApprovalBody = await firstApprovalRes.json() as any;
      ok(firstApprovalBody.review.status === 'pending-review', 'Reviewer approve(first): R4 item remains pending after first approval');
      ok(firstApprovalBody.review.approvalsRecorded === 1, 'Reviewer approve(first): first approval is counted');
      ok(firstApprovalBody.releaseToken === null, 'Reviewer approve(first): no token issued before dual approval closes');

      const secondApprovalRes = await fetch(`${BASE}/api/v1/admin/release-reviews/${reviewQueueId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reviewerId: 'reviewer.beta',
          reviewerName: 'Beta Reviewer',
          reviewerRole: 'financial_reporting_manager',
          note: 'Second approval closes the regulated release authority path.',
        }),
      });
      ok(secondApprovalRes.status === 200, 'Reviewer approve(second): status 200');
      const secondApprovalBody = await secondApprovalRes.json() as any;
      ok(secondApprovalBody.review.status === 'approved', 'Reviewer approve(second): review queue item closes as approved');
      ok(secondApprovalBody.review.authorityState === 'approved', 'Reviewer approve(second): authority state becomes approved');
      ok(typeof secondApprovalBody.releaseToken?.token === 'string', 'Reviewer approve(second): release token is issued after dual approval');
      ok(typeof secondApprovalBody.evidencePack?.evidencePackId === 'string', 'Reviewer approve(second): durable evidence pack is exported after dual approval');
      ok(typeof secondApprovalBody.evidencePack?.exportPath === 'string', 'Reviewer approve(second): durable evidence pack export path returned');
      approvedReleaseToken = secondApprovalBody.releaseToken.token;

      const listAfterApprovalRes = await fetch(`${BASE}/api/v1/admin/release-reviews`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(listAfterApprovalRes.status === 200, 'Reviewer inbox(after approval): status 200');
      const listAfterApprovalBody = await listAfterApprovalRes.json() as any;
      ok(!listAfterApprovalBody.items.some((item: any) => item.id === reviewQueueId), 'Reviewer inbox(after approval): approved item no longer appears in pending inbox');
      console.log(`    approvals=2/2, token=${secondApprovalBody.releaseToken.tokenId}`);
    }

    // ═══ REVIEWER QUEUE — break-glass override ═══
    console.log('\n  [POST /api/v1/admin/release-reviews/:id/override — break-glass release]');
    {
      const overrideRes = await fetch(`${BASE}/api/v1/admin/release-reviews/${breakGlassReviewQueueId}/override`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reasonCode: 'regulatory_deadline',
          ticketId: 'INC-2048',
          requestedById: 'ops.breakglass',
          requestedByName: 'Operations Override',
          requestedByRole: 'incident_commander',
          note: 'Emergency filing preparation needed before market open.',
        }),
      });
      ok(overrideRes.status === 200, 'Reviewer override: status 200');
      const overrideBody = await overrideRes.json() as any;
      ok(overrideBody.review.status === 'overridden', 'Reviewer override: queue item closes as overridden');
      ok(overrideBody.review.authorityState === 'overridden', 'Reviewer override: authority state becomes overridden');
      ok(overrideBody.review.releaseDecisionStatus === 'overridden', 'Reviewer override: release decision status becomes overridden');
      ok(overrideBody.review.overrideGrant?.reasonCode === 'regulatory_deadline', 'Reviewer override: override summary preserves reason code');
      ok(typeof overrideBody.releaseToken?.token === 'string', 'Reviewer override: short-lived release token issued');
      ok(overrideBody.releaseToken.override === true, 'Reviewer override: release token is flagged as override');
      ok(Number(overrideBody.releaseToken.ttlSeconds) <= 60, 'Reviewer override: release token is short-lived');
      ok(typeof overrideBody.evidencePack?.evidencePackId === 'string', 'Reviewer override: durable evidence pack is exported after break-glass release');
      ok(typeof overrideBody.evidencePack?.exportPath === 'string', 'Reviewer override: durable evidence pack export path returned');
      breakGlassReleaseToken = overrideBody.releaseToken.token;
      breakGlassEvidencePackId = overrideBody.evidencePack.evidencePackId;
      console.log(`    override=regulatory_deadline, token=${overrideBody.releaseToken.tokenId}`);
    }

    // ═══ RELEASE EVIDENCE PACK — exported durable bundle ═══
    console.log('\n  [GET /api/v1/admin/release-evidence/:id — durable evidence bundle]');
    {
      const res = await fetch(`${BASE}/api/v1/admin/release-evidence/${breakGlassEvidencePackId}`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(res.status === 200, 'Release evidence bundle: status 200');
      const body = await res.json() as any;
      ok(body.evidencePack.evidencePack.id === breakGlassEvidencePackId, 'Release evidence bundle: expected evidence pack returned');
      ok(body.evidencePack.statement._type === 'https://in-toto.io/Statement/v1', 'Release evidence bundle: in-toto statement type exported');
      ok(body.evidencePack.statement.predicateType === 'https://attestor.ai/attestation/release-evidence/v1', 'Release evidence bundle: Attestor release predicate exported');
      ok(body.evidencePack.statement.predicate.review.overrideReasonCode === 'regulatory_deadline', 'Release evidence bundle: override reason is preserved in the durable review summary');
      ok(body.evidencePack.statement.predicate.releaseToken.override === true, 'Release evidence bundle: override token summary is preserved');
      ok(typeof body.evidencePack.verificationKey.keyId === 'string', 'Release evidence bundle: verification key metadata exported');
      ok(typeof body.evidencePack.bundleDigest === 'string', 'Release evidence bundle: bundle digest exported');
      console.log(`    evidencePack=${body.evidencePack.evidencePack.id}, predicate=${body.evidencePack.statement.predicateType}`);
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

    // ═══ FILING EXPORT — missing release token ═══
    console.log('\n  [POST /api/v1/filing/export — missing release token]');
    {
      const res = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filingRelease.candidate),
      });
      ok(res.status === 401, 'Filing(no token): status 401');
      ok((res.headers.get('WWW-Authenticate') ?? '').includes('invalid_token'), 'Filing(no token): RFC6750 challenge present');
      const body = await res.json() as any;
      ok(body.error === 'missing_token' || body.error === 'invalid_token', 'Filing(no token): bearer failure body returned');
      console.log('    release token required before export');
    }

    // ═══ FILING EXPORT — tampered payload ═══
    console.log('\n  [POST /api/v1/filing/export — tampered payload]');
    {
      const tampered = {
        ...filingRelease.candidate,
        rows: filingRelease.candidate.rows.map((row: Record<string, unknown>) => ({ ...row })),
      };
      (tampered.rows[0] as any).exposure_usd = Number((tampered.rows[0] as any).exposure_usd ?? 0) + 1;

      const res = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${filingRelease.token}`,
        },
        body: JSON.stringify(tampered),
      });
      ok(res.status === 403, 'Filing(tampered): status 403');
      const body = await res.json() as any;
      ok(body.error === 'insufficient_scope', 'Filing(tampered): binding mismatch rejected as insufficient scope');
      console.log('    tampered payload blocked by output/consequence hash binding');
    }

    // ═══ FILING EXPORT — approved reviewer token ═══
    console.log('\n  [POST /api/v1/filing/export — approved dual-review token]');
    {
      const res = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${approvedReleaseToken}`,
        },
        body: JSON.stringify(reviewRequiredFilingRelease.candidate),
      });
      ok(res.status === 200, 'Filing(approved dual-review token): status 200');
      const body = await res.json() as any;
      ok(body.release?.authorized === true, 'Filing(approved dual-review token): release authorization is attached');
      ok(body.release?.introspectionVerified === true, 'Filing(approved dual-review token): high-risk introspection is confirmed');
      ok(body.package?.content?.facts?.length > 0, 'Filing(approved dual-review token): filing package is still produced after human authority closes');
      console.log(`    approved review release decision=${body.release.decisionId}, token=${body.release.tokenId}`);
    }

    // ═══ FILING EXPORT — break-glass override token ═══
    console.log('\n  [POST /api/v1/filing/export — break-glass override token]');
    {
      const res = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${breakGlassReleaseToken}`,
        },
        body: JSON.stringify(breakGlassFilingRelease.candidate),
      });
      ok(res.status === 200, 'Filing(break-glass token): status 200');
      const body = await res.json() as any;
      ok(body.release?.authorized === true, 'Filing(break-glass token): release authorization is attached');
      ok(body.release?.introspectionVerified === true, 'Filing(break-glass token): high-risk introspection is confirmed');
      ok(body.package?.content?.facts?.length > 0, 'Filing(break-glass token): filing package is produced after override');
      console.log(`    overridden release decision=${body.release.decisionId}, token=${body.release.tokenId}`);
    }

    // ═══ FILING EXPORT — authorized XBRL ═══
    console.log('\n  [POST /api/v1/filing/export — authorized XBRL]');
    {
      const res = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${filingRelease.token}`,
        },
        body: JSON.stringify(filingRelease.candidate),
      });
      ok(res.status === 200, 'Filing: status 200');
      const body = await res.json() as any;
      ok(body.adapterId === 'xbrl-us-gaap-2024', 'Filing: adapter ID');
      ok(body.format === 'xbrl', 'Filing: format = xbrl');
      ok(body.taxonomyVersion === 'US-GAAP 2024', 'Filing: taxonomy version');
      ok(body.mapping.mappedCount > 0, 'Filing: has mapped fields');
      ok(body.mapping.coveragePercent > 50, 'Filing: coverage > 50%');
      ok(body.package.content.facts.length > 0, 'Filing: package has facts');
      ok(body.package.evidenceLink.runId === filingRelease.candidate.runId, 'Filing: evidence link runId');
      ok(body.package.evidenceLink.certificateId === filingRelease.candidate.certificateId, 'Filing: evidence link certId');
      ok(body.release?.authorized === true, 'Filing: release summary reports authorized');
      ok(body.release?.decisionId === filingRelease.decisionId, 'Filing: release summary preserves decision id');
      ok(body.release?.introspectionVerified === true, 'Filing: release summary reports active introspection verification');
      ok(body.release?.tokenId === filingRelease.tokenId, 'Filing: release summary preserves token id');
      ok(body.package.issuedPackage.fileExtension === '.xbr', 'Filing: report package uses .xbr');
      ok(body.package.issuedPackage.files.some((f: any) => f.path === 'META-INF/reportPackage.json'), 'Filing: includes reportPackage.json');
      const zip = await JSZip.loadAsync(Buffer.from(body.package.issuedPackage.archive.base64, 'base64'));
      ok(zip.file(`${body.package.issuedPackage.topLevelDirectory}/META-INF/reportPackage.json`) !== null, 'Filing: zip metadata exists');
      ok(zip.file(`${body.package.issuedPackage.topLevelDirectory}/${body.package.issuedPackage.reportPath}`) !== null, 'Filing: zip report exists');
      console.log(`    mapped=${body.mapping.mappedCount}, coverage=${body.mapping.coveragePercent}%, facts=${body.package.content.facts.length}`);
    }

    // ═══ FILING EXPORT — replayed release token ═══
    console.log('\n  [POST /api/v1/filing/export — replayed release token]');
    {
      const replayRes = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${filingRelease.token}`,
        },
        body: JSON.stringify(filingRelease.candidate),
      });
      ok(replayRes.status === 401, 'Filing(replay): consumed token no longer authorizes export');
      const replayBody = await replayRes.json() as any;
      ok(replayBody.error === 'invalid_token', 'Filing(replay): replay is surfaced as invalid_token');
      ok(
        String(replayBody.error_description ?? '').includes('consumed'),
        'Filing(replay): downstream verifier explains consumed-token replay rejection',
      );
      console.log('    replayed release token blocked after first successful use');
    }

    // ═══ FILING EXPORT — revoked release token ═══
    console.log('\n  [POST /api/v1/filing/export — revoked release token]');
    {
      const revokeRun = await fetch(`${BASE}/api/v1/pipeline/run`, {
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
      ok(revokeRun.status === 200, 'Filing(revoked): fresh signed pipeline run status 200');
      const revokeRunBody = await revokeRun.json() as any;
      const revokedRelease = revokeRunBody.release?.filingExport;
      ok(typeof revokedRelease?.tokenId === 'string', 'Filing(revoked): fresh release token id present');

      const revokeRes = await fetch(`${BASE}/api/v1/admin/release-tokens/${revokedRelease.tokenId}/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'Idempotency-Key': 'admin-release-token-revoke-live-api',
        },
        body: JSON.stringify({
          reason: 'operator cancelled filing release',
        }),
      });
      ok(revokeRes.status === 200, 'Filing(revoked): admin revoke status 200');
      const revokeBody = await revokeRes.json() as any;
      ok(revokeBody.token.status === 'revoked', 'Filing(revoked): token status marked revoked');
      ok(revokeBody.token.revocationReason === 'operator cancelled filing release', 'Filing(revoked): revoke reason preserved');

      const revokedExportRes = await fetch(`${BASE}/api/v1/filing/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${revokedRelease.token}`,
        },
        body: JSON.stringify(revokedRelease.candidate),
      });
      ok(revokedExportRes.status === 401, 'Filing(revoked): revoked token no longer authorizes export');
      const revokedExportBody = await revokedExportRes.json() as any;
      ok(revokedExportBody.error === 'invalid_token', 'Filing(revoked): revoke is surfaced as invalid_token');
      ok(
        String(revokedExportBody.error_description ?? '').includes('revoked'),
        'Filing(revoked): revoke reason reaches the downstream verifier response',
      );
      console.log('    revoked release token blocked before export');
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
      ok(typeof body.asyncQueue?.tenantActiveExecutions === 'number', 'Async: active execution snapshot present');
      ok(typeof body.asyncQueue?.tenantWeightedDispatchEnforced === 'boolean', 'Async: weighted dispatch enforcement surfaced');
      ok(typeof body.asyncQueue?.tenantWeightedDispatchWeight === 'number' || body.asyncQueue?.tenantWeightedDispatchWeight === null, 'Async: weighted dispatch weight surfaced');
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
      ok(acceptedQueueJob!.body.asyncQueue.tenantActiveExecutionLimit === 1, 'Async Queue: starter tenant active execution cap = 1');
      ok(acceptedQueueJob!.body.asyncQueue.tenantWeightedDispatchEnforced === true, 'Async Queue: starter weighted dispatch enforced');
      ok(acceptedQueueJob!.body.asyncQueue.tenantWeightedDispatchWeight === 1, 'Async Queue: starter weighted dispatch weight = 1');
      ok(acceptedQueueJob!.body.asyncQueue.tenantWeightedDispatchWindowMs === 400, 'Async Queue: starter weighted dispatch window = 400ms');
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
      ok(
        failedStatus.error.includes('candidateSql')
          || failedStatus.error.includes('intent')
          || failedStatus.error.includes('Async job payload requires')
          || failedStatus.error.includes('non-empty string')
          || failedStatus.error.includes('object'),
        `Async Queue: worker exposes validation failure (actual=${failedStatus.error})`,
      );
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
      ok(typeof adminQueueBody.tenant?.weightedDispatchEnforced === 'boolean', 'Admin Queue: weighted dispatch enforcement surfaced');
      ok(typeof adminQueueBody.tenant?.weightedDispatchWindowMs === 'number' || adminQueueBody.tenant?.weightedDispatchWindowMs === null, 'Admin Queue: weighted dispatch window surfaced');

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
      ok(dlqRecord.backendMode === 'bullmq', 'Admin DLQ: backendMode truthful');
      ok(typeof dlqRecord.recordedAt === 'string', 'Admin DLQ: recordedAt surfaced');
      const persistedDlq = readAsyncDeadLetterStoreSnapshot();
      ok(persistedDlq.records.some((record) => record.jobId === failedSubmitBody.jobId), 'Admin DLQ: failed job persisted to local DLQ store');

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
      ok(!readAsyncDeadLetterStoreSnapshot().records.some((record) => record.jobId === failedSubmitBody.jobId), 'Admin Queue Retry: DLQ record removed after retry');

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
      ok(plansBody.defaults.rateLimitWindowSeconds === 5, 'Admin Plans: rate-limit window override exposed');
      ok(plansBody.defaults.asyncExecutionShared === true, 'Admin Plans: async execution backend reported as shared');
      ok(plansBody.defaults.asyncWeightedDispatchShared === true, 'Admin Plans: async weighted dispatch backend reported as shared');
      const starterPlan = plansBody.plans.find((entry: any) => entry.id === 'starter');
      const communityPlan = plansBody.plans.find((entry: any) => entry.id === 'community');
      ok(Boolean(communityPlan), 'Admin Plans: community plan present');
      ok(communityPlan.defaultMonthlyRunQuota === 10, 'Admin Plans: community hosted quota = 10');
      ok(Boolean(starterPlan), 'Admin Plans: starter plan present');
      ok(starterPlan.defaultMonthlyRunQuota === 100, 'Admin Plans: starter quota = 100');
      ok(starterPlan.defaultPipelineRequestsPerWindow === 3, 'Admin Plans: starter rate limit = 3');
      ok(starterPlan.defaultAsyncActiveJobsPerTenant === 1, 'Admin Plans: starter active execution cap = 1');
      ok(starterPlan.defaultAsyncDispatchWeight === 1, 'Admin Plans: starter dispatch weight = 1');
      ok(starterPlan.defaultAsyncDispatchWindowMs === 400, 'Admin Plans: starter dispatch window = 400ms');
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

      const forgedTenantToken = unsignedBearerToken({
        tenantId: createAccountBody.account.primaryTenantId,
        tenantName: 'Forged Tenant',
        planId: 'enterprise',
        monthlyRunQuota: 999999,
      });
      const forgedUsageRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${forgedTenantToken}` },
      });
      ok(forgedUsageRes.status === 401, 'Hosted auth: unsigned bearer tenant claim is rejected');
      const forgedUsageBody = await forgedUsageRes.json() as any;
      ok(
        String(forgedUsageBody.error ?? '').includes('Valid tenant API key required'),
        'Hosted auth: forged bearer rejection explains tenant API key requirement',
      );

      const forgedBootstrapRes = await fetch(`${BASE}/api/v1/account/users/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${forgedTenantToken}`,
        },
        body: JSON.stringify({
          email: 'forged@account.example',
          displayName: 'Forged Admin',
          password: 'ForgedBootstrap123!',
        }),
      });
      ok(forgedBootstrapRes.status === 401, 'Hosted auth: forged bearer token cannot bootstrap an account admin');

      const accountSummaryRes = await fetch(`${BASE}/api/v1/account`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(accountSummaryRes.status === 200, 'Account API: summary status 200');
      const accountSummaryBody = await accountSummaryRes.json() as any;
      ok(accountSummaryBody.account.id === createAccountBody.account.id, 'Account API: summary returns hosted account');
      ok(accountSummaryBody.account.billing.provider === null, 'Account API: billing starts empty');
      ok(accountSummaryBody.entitlement.provider === 'manual', 'Account API: initial entitlement provider is manual');
      ok(accountSummaryBody.entitlement.status === 'provisioned', 'Account API: initial entitlement status is provisioned');
      ok(accountSummaryBody.entitlement.accessEnabled === true, 'Account API: initial entitlement enables access');

      const accountEntitlementRes = await fetch(`${BASE}/api/v1/account/entitlement`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(accountEntitlementRes.status === 200, 'Account Entitlement: status 200');
      const accountEntitlementBody = await accountEntitlementRes.json() as any;
      ok(accountEntitlementBody.entitlement.accountId === createAccountBody.account.id, 'Account Entitlement: account id matches');
      ok(accountEntitlementBody.entitlement.effectivePlanId === 'starter', 'Account Entitlement: starter plan reflected');

      const accountFeaturesInitialRes = await fetch(`${BASE}/api/v1/account/features`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(accountFeaturesInitialRes.status === 200, 'Account Features: initial status 200');
      const accountFeaturesInitialBody = await accountFeaturesInitialRes.json() as any;
      const starterApiFeature = accountFeaturesInitialBody.features.find((entry: any) => entry.key === 'api.access');
      ok(Boolean(starterApiFeature), 'Account Features: api.access feature present');
      ok(starterApiFeature.granted === true, 'Account Features: api.access initially granted by plan default');
      ok(starterApiFeature.grantSource === 'plan_default', 'Account Features: api.access initial source is plan default');

      const bootstrapRes = await fetch(`${BASE}/api/v1/account/users/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createAccountBody.initialKey.apiKey}`,
        },
        body: JSON.stringify({
          email: 'owner@account.example',
          displayName: 'Owner Admin',
          password: 'BootstrapPass123!',
        }),
      });
      ok(bootstrapRes.status === 201, 'Account Users: bootstrap status 201');
      const bootstrapBody = await bootstrapRes.json() as any;
      ok(bootstrapBody.bootstrap === true, 'Account Users: bootstrap flag true');
      ok(bootstrapBody.user.role === 'account_admin', 'Account Users: bootstrap user is account_admin');

      const bootstrapConflictRes = await fetch(`${BASE}/api/v1/account/users/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createAccountBody.initialKey.apiKey}`,
        },
        body: JSON.stringify({
          email: 'second@account.example',
          displayName: 'Second Admin',
          password: 'BootstrapPass456!',
        }),
      });
      ok(bootstrapConflictRes.status === 409, 'Account Users: bootstrap blocked once users exist');

      const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@account.example',
          password: 'BootstrapPass123!',
        }),
      });
      ok(loginRes.status === 200, 'Auth: login status 200');
      const loginBody = await loginRes.json() as any;
      let accountAdminCookie = cookieHeaderFromResponse(loginRes);
      ok(Boolean(accountAdminCookie), 'Auth: login sets session cookie');
      ok(loginBody.session.source === 'account_session', 'Auth: login returns account_session source');
      ok(loginBody.user.lastLoginAt !== null, 'Auth: login updates lastLoginAt');

      const meRes = await fetch(`${BASE}/api/v1/auth/me`, {
        headers: { Cookie: accountAdminCookie! },
      });
      ok(meRes.status === 200, 'Auth: me status 200');
      const meBody = await meRes.json() as any;
      ok(meBody.user.email === 'owner@account.example', 'Auth: me returns logged-in user');
      ok(meBody.session.role === 'account_admin', 'Auth: me returns account_admin role');

      const sessionAccountRes = await fetch(`${BASE}/api/v1/account`, {
        headers: { Cookie: accountAdminCookie! },
      });
      ok(sessionAccountRes.status === 200, 'Account API: summary also works with session cookie');
      const sessionAccountBody = await sessionAccountRes.json() as any;
      ok(sessionAccountBody.tenantContext.source === 'account_session', 'Account API: session summary source=account_session');

      const usersNoSessionRes = await fetch(`${BASE}/api/v1/account/users`, {
        headers: { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` },
      });
      ok(usersNoSessionRes.status === 401, 'Account Users: session required for user listing');

      const createBillingAdminRes = await fetch(`${BASE}/api/v1/account/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: accountAdminCookie!,
        },
        body: JSON.stringify({
          email: 'billing@account.example',
          displayName: 'Billing Admin',
          password: 'BillingPass123!',
          role: 'billing_admin',
        }),
      });
      ok(createBillingAdminRes.status === 201, 'Account Users: create billing_admin status 201');
      const createBillingAdminBody = await createBillingAdminRes.json() as any;
      ok(createBillingAdminBody.user.role === 'billing_admin', 'Account Users: billing_admin role persisted');

      const createReadOnlyRes = await fetch(`${BASE}/api/v1/account/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: accountAdminCookie!,
        },
        body: JSON.stringify({
          email: 'readonly@account.example',
          displayName: 'Read Only',
          password: 'ReadOnlyPass123!',
          role: 'read_only',
        }),
      });
      ok(createReadOnlyRes.status === 201, 'Account Users: create read_only status 201');
      const createReadOnlyBody = await createReadOnlyRes.json() as any;
      ok(createReadOnlyBody.user.role === 'read_only', 'Account Users: read_only role persisted');

      const inviteRes = await fetch(`${BASE}/api/v1/account/users/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: accountAdminCookie!,
        },
        body: JSON.stringify({
          email: 'invitee@account.example',
          displayName: 'Invited User',
          role: 'read_only',
        }),
      });
      ok(inviteRes.status === 201, 'Account Users: invite status 201');
      const inviteBody = await inviteRes.json() as any;
      ok(inviteBody.invite.status === 'pending', 'Account Users: invite starts pending');
      ok(typeof inviteBody.inviteToken === 'string' && inviteBody.inviteToken.startsWith('atok_'), 'Account Users: invite token returned once');

      const invitesListRes = await fetch(`${BASE}/api/v1/account/users/invites`, {
        headers: { Cookie: accountAdminCookie! },
      });
      ok(invitesListRes.status === 200, 'Account Users: invite list status 200');
      const invitesListBody = await invitesListRes.json() as any;
      ok(invitesListBody.invites.some((entry: any) => entry.id === inviteBody.invite.id && entry.status === 'pending'), 'Account Users: invite list shows pending invite');

      const acceptInviteRes = await fetch(`${BASE}/api/v1/account/users/invites/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteToken: inviteBody.inviteToken,
          password: 'InviteAccept123!',
        }),
      });
      ok(acceptInviteRes.status === 201, 'Account Users: invite accept status 201');
      const acceptInviteBody = await acceptInviteRes.json() as any;
      const invitedCookie = cookieHeaderFromResponse(acceptInviteRes);
      ok(Boolean(invitedCookie), 'Account Users: invite accept issues session cookie');
      ok(acceptInviteBody.accepted === true, 'Account Users: invite accept flag true');
      ok(acceptInviteBody.user.email === 'invitee@account.example', 'Account Users: invite creates expected user');

      const usersListRes = await fetch(`${BASE}/api/v1/account/users`, {
        headers: { Cookie: accountAdminCookie! },
      });
      ok(usersListRes.status === 200, 'Account Users: list status 200');
      const usersListBody = await usersListRes.json() as any;
      ok(usersListBody.users.length === 4, 'Account Users: list returns bootstrap + billing + read_only + invitee');

      const readOnlyLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'readonly@account.example',
          password: 'ReadOnlyPass123!',
        }),
      });
      ok(readOnlyLoginRes.status === 200, 'Auth: read_only login status 200');
      let readOnlyCookie = cookieHeaderFromResponse(readOnlyLoginRes);
      ok(Boolean(readOnlyCookie), 'Auth: read_only login sets session cookie');

      const readOnlyUsersRes = await fetch(`${BASE}/api/v1/account/users`, {
        headers: { Cookie: readOnlyCookie! },
      });
      ok(readOnlyUsersRes.status === 403, 'RBAC: read_only user blocked from user listing');

      const readOnlyPasswordChangeRes = await fetch(`${BASE}/api/v1/auth/password/change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: readOnlyCookie!,
        },
        body: JSON.stringify({
          currentPassword: 'ReadOnlyPass123!',
          newPassword: 'ReadOnlyPass456!',
        }),
      });
      ok(readOnlyPasswordChangeRes.status === 200, 'Auth: password change status 200');
      const readOnlyPasswordChangeBody = await readOnlyPasswordChangeRes.json() as any;
      const rotatedReadOnlyCookie = cookieHeaderFromResponse(readOnlyPasswordChangeRes);
      ok(Boolean(rotatedReadOnlyCookie), 'Auth: password change rotates session cookie');
      ok(readOnlyPasswordChangeBody.changed === true, 'Auth: password change returns changed=true');

      const oldReadOnlySessionRes = await fetch(`${BASE}/api/v1/auth/me`, {
        headers: { Cookie: readOnlyCookie! },
      });
      ok(oldReadOnlySessionRes.status === 401, 'Auth: pre-change read_only session is revoked');
      readOnlyCookie = rotatedReadOnlyCookie;

      const readOnlyOldPasswordLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'readonly@account.example',
          password: 'ReadOnlyPass123!',
        }),
      });
      ok(readOnlyOldPasswordLoginRes.status === 401, 'Auth: old read_only password no longer works');

      const readOnlyNewPasswordLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'readonly@account.example',
          password: 'ReadOnlyPass456!',
        }),
      });
      ok(readOnlyNewPasswordLoginRes.status === 200, 'Auth: new read_only password works');
      readOnlyCookie = cookieHeaderFromResponse(readOnlyNewPasswordLoginRes);

      const readOnlyMfaEnrollRes = await fetch(`${BASE}/api/v1/account/mfa/totp/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: readOnlyCookie!,
        },
        body: JSON.stringify({
          password: 'ReadOnlyPass456!',
        }),
      });
      ok(readOnlyMfaEnrollRes.status === 200, 'MFA: TOTP enrollment start status 200');
      const readOnlyMfaEnrollBody = await readOnlyMfaEnrollRes.json() as any;
      ok(readOnlyMfaEnrollBody.enrollment.method === 'totp', 'MFA: enrollment method is totp');
      ok(typeof readOnlyMfaEnrollBody.enrollment.secretBase32 === 'string', 'MFA: enrollment returns secret');
      ok(String(readOnlyMfaEnrollBody.enrollment.otpauthUrl).startsWith('otpauth://totp/'), 'MFA: enrollment returns otpauth URL');
      const readOnlyPendingMfaRes = await fetch(`${BASE}/api/v1/account/mfa`, {
        headers: { Cookie: readOnlyCookie! },
      });
      ok(readOnlyPendingMfaRes.status === 200, 'MFA: summary status 200 while pending');
      const readOnlyPendingMfaBody = await readOnlyPendingMfaRes.json() as any;
      ok(readOnlyPendingMfaBody.mfa.pendingEnrollment === true, 'MFA: summary shows pending enrollment');

      const readOnlyMfaConfirmRes = await fetch(`${BASE}/api/v1/account/mfa/totp/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: readOnlyCookie!,
        },
        body: JSON.stringify({
          code: generateCurrentTotpCode(readOnlyMfaEnrollBody.enrollment.secretBase32),
        }),
      });
      ok(readOnlyMfaConfirmRes.status === 200, 'MFA: TOTP confirm status 200');
      const readOnlyMfaConfirmBody = await readOnlyMfaConfirmRes.json() as any;
      const readOnlyMfaCookie = cookieHeaderFromResponse(readOnlyMfaConfirmRes);
      ok(Boolean(readOnlyMfaCookie), 'MFA: confirm rotates session cookie');
      ok(readOnlyMfaConfirmBody.enabled === true, 'MFA: confirm enables MFA');
      ok(Array.isArray(readOnlyMfaConfirmBody.recoveryCodes) && readOnlyMfaConfirmBody.recoveryCodes.length === 8, 'MFA: confirm returns recovery codes once');

      const stalePreMfaSessionRes = await fetch(`${BASE}/api/v1/auth/me`, {
        headers: { Cookie: readOnlyCookie! },
      });
      ok(stalePreMfaSessionRes.status === 401, 'MFA: pre-enrollment session revoked after enable');
      readOnlyCookie = readOnlyMfaCookie;

      const readOnlyEnabledMfaRes = await fetch(`${BASE}/api/v1/account/mfa`, {
        headers: { Cookie: readOnlyCookie! },
      });
      ok(readOnlyEnabledMfaRes.status === 200, 'MFA: summary status 200 after enable');
      const readOnlyEnabledMfaBody = await readOnlyEnabledMfaRes.json() as any;
      ok(readOnlyEnabledMfaBody.mfa.enabled === true, 'MFA: summary shows enabled');
      ok(readOnlyEnabledMfaBody.mfa.recoveryCodesRemaining === 8, 'MFA: summary shows recovery code count');

      const readOnlyMfaLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'readonly@account.example',
          password: 'ReadOnlyPass456!',
        }),
      });
      ok(readOnlyMfaLoginRes.status === 200, 'MFA: login returns challenge response');
      const readOnlyMfaLoginBody = await readOnlyMfaLoginRes.json() as any;
      ok(readOnlyMfaLoginBody.mfaRequired === true, 'MFA: login requires second factor');
      ok(typeof readOnlyMfaLoginBody.challengeToken === 'string' && readOnlyMfaLoginBody.challengeToken.startsWith('atok_'), 'MFA: challenge token returned');

      const readOnlyMfaWrongVerifyRes = await fetch(`${BASE}/api/v1/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: readOnlyMfaLoginBody.challengeToken,
          code: '000000',
        }),
      });
      ok(readOnlyMfaWrongVerifyRes.status === 400, 'MFA: wrong TOTP code rejected');

      const readOnlyMfaVerifyRes = await fetch(`${BASE}/api/v1/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: readOnlyMfaLoginBody.challengeToken,
          code: generateCurrentTotpCode(readOnlyMfaEnrollBody.enrollment.secretBase32),
        }),
      });
      ok(readOnlyMfaVerifyRes.status === 200, 'MFA: verify challenge status 200');
      const readOnlyMfaVerifyBody = await readOnlyMfaVerifyRes.json() as any;
      readOnlyCookie = cookieHeaderFromResponse(readOnlyMfaVerifyRes);
      ok(Boolean(readOnlyCookie), 'MFA: verify issues new session cookie');
      ok(readOnlyMfaVerifyBody.verified === true, 'MFA: verify returns verified=true');
      ok(readOnlyMfaVerifyBody.recoveryCodeUsed === false, 'MFA: verify notes TOTP path');

      const readOnlyMfaDisableRes = await fetch(`${BASE}/api/v1/account/mfa/disable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: readOnlyCookie!,
        },
        body: JSON.stringify({
          password: 'ReadOnlyPass456!',
          recoveryCode: readOnlyMfaConfirmBody.recoveryCodes[0],
        }),
      });
      ok(readOnlyMfaDisableRes.status === 200, 'MFA: disable status 200');
      const readOnlyMfaDisableBody = await readOnlyMfaDisableRes.json() as any;
      const readOnlyPostDisableCookie = cookieHeaderFromResponse(readOnlyMfaDisableRes);
      ok(Boolean(readOnlyPostDisableCookie), 'MFA: disable rotates session cookie');
      ok(readOnlyMfaDisableBody.disabled === true, 'MFA: disable returns disabled=true');
      ok(readOnlyMfaDisableBody.recoveryCodeUsed === true, 'MFA: disable accepts recovery code');
      readOnlyCookie = readOnlyPostDisableCookie;

      const readOnlyDisabledMfaRes = await fetch(`${BASE}/api/v1/account/mfa`, {
        headers: { Cookie: readOnlyCookie! },
      });
      ok(readOnlyDisabledMfaRes.status === 200, 'MFA: summary status 200 after disable');
      const readOnlyDisabledMfaBody = await readOnlyDisabledMfaRes.json() as any;
      ok(readOnlyDisabledMfaBody.mfa.enabled === false, 'MFA: summary shows disabled after disable');

      const billingAdminLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'billing@account.example',
          password: 'BillingPass123!',
        }),
      });
      ok(billingAdminLoginRes.status === 200, 'Auth: billing_admin login status 200');
      let billingAdminCookie = cookieHeaderFromResponse(billingAdminLoginRes);
      ok(Boolean(billingAdminCookie), 'Auth: billing_admin login sets session cookie');

      const billingResetRes = await fetch(`${BASE}/api/v1/account/users/${createBillingAdminBody.user.id}/password-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: accountAdminCookie!,
        },
        body: JSON.stringify({ ttlMinutes: 20 }),
      });
      ok(billingResetRes.status === 201, 'Account Users: password reset issue status 201');
      const billingResetBody = await billingResetRes.json() as any;
      ok(billingResetBody.reset.status === 'pending', 'Account Users: password reset token pending');
      ok(typeof billingResetBody.resetToken === 'string' && billingResetBody.resetToken.startsWith('atok_'), 'Account Users: password reset token returned');

      const billingPasswordResetApplyRes = await fetch(`${BASE}/api/v1/auth/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resetToken: billingResetBody.resetToken,
          newPassword: 'BillingPass456!',
        }),
      });
      ok(billingPasswordResetApplyRes.status === 200, 'Auth: password reset apply status 200');
      const billingPasswordResetApplyBody = await billingPasswordResetApplyRes.json() as any;
      ok(billingPasswordResetApplyBody.reset === true, 'Auth: password reset apply flag true');

      const billingOldPasswordLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'billing@account.example',
          password: 'BillingPass123!',
        }),
      });
      ok(billingOldPasswordLoginRes.status === 401, 'Auth: billing_admin old password rejected after reset');

      const billingNewPasswordLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'billing@account.example',
          password: 'BillingPass456!',
        }),
      });
      ok(billingNewPasswordLoginRes.status === 200, 'Auth: billing_admin new password accepted after reset');
      billingAdminCookie = cookieHeaderFromResponse(billingNewPasswordLoginRes);
      ok(Boolean(billingAdminCookie), 'Auth: billing_admin reset login sets new session cookie');

      const checkoutMissingKeyRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: accountAdminCookie!,
        },
        body: JSON.stringify({ planId: 'pro' }),
      });
      ok(checkoutMissingKeyRes.status === 400, 'Account Billing: checkout requires Idempotency-Key');

      const checkoutNoPlanRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: accountAdminCookie!,
          'Idempotency-Key': 'checkout-no-plan-1',
        },
        body: JSON.stringify({}),
      });
      ok(checkoutNoPlanRes.status === 400, 'Account Billing: checkout requires planId');

      const checkoutRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: accountAdminCookie!,
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

      const entitlementAfterCheckoutRes = await fetch(`${BASE}/api/v1/account/entitlement`, {
        headers: { Cookie: accountAdminCookie! },
      });
      ok(entitlementAfterCheckoutRes.status === 200, 'Account Entitlement: readable after checkout');
      const entitlementAfterCheckoutBody = await entitlementAfterCheckoutRes.json() as any;
      ok(entitlementAfterCheckoutBody.entitlement.status === 'provisioned', 'Account Entitlement: checkout creation alone does not activate entitlement');

      const checkoutReplayRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: accountAdminCookie!,
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
        headers: { Cookie: billingAdminCookie! },
      });
      ok(portalMissingCustomerRes.status === 409, 'Account Billing: portal requires Stripe customer');

      const readOnlyCheckoutRes = await fetch(`${BASE}/api/v1/account/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: readOnlyCookie!,
          'Idempotency-Key': 'checkout-read-only-1',
        },
        body: JSON.stringify({ planId: 'pro' }),
      });
      ok(readOnlyCheckoutRes.status === 403, 'RBAC: read_only user blocked from billing checkout');

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

      const suspendedEntitlementRes = await fetch(`${BASE}/api/v1/admin/billing/entitlements?accountId=${createAccountBody.account.id}`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(suspendedEntitlementRes.status === 200, 'Admin Billing Entitlements: readable after manual suspend');
      const suspendedEntitlementBody = await suspendedEntitlementRes.json() as any;
      ok(suspendedEntitlementBody.records[0].status === 'suspended', 'Admin Billing Entitlements: manual suspend overrides active subscription in entitlement view');
      ok(suspendedEntitlementBody.records[0].accessEnabled === false, 'Admin Billing Entitlements: manual suspend disables entitlement access');

      const suspendedSessionMeRes = await fetch(`${BASE}/api/v1/auth/me`, {
        headers: { Cookie: accountAdminCookie! },
      });
      ok(suspendedSessionMeRes.status === 401, 'Admin Accounts: manual suspend invalidates existing account session');

      const suspendedBillingSessionRes = await fetch(`${BASE}/api/v1/account/billing/portal`, {
        method: 'POST',
        headers: { Cookie: billingAdminCookie! },
      });
      ok(suspendedBillingSessionRes.status === 401, 'Admin Accounts: manual suspend invalidates existing billing session');

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

      const reactivatedEntitlementRes = await fetch(`${BASE}/api/v1/admin/billing/entitlements?accountId=${createAccountBody.account.id}`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(reactivatedEntitlementRes.status === 200, 'Admin Billing Entitlements: readable after reactivate');
      const reactivatedEntitlementBody = await reactivatedEntitlementRes.json() as any;
      ok(reactivatedEntitlementBody.records[0].status === 'active', 'Admin Billing Entitlements: reactivate restores active entitlement view');

      const accountAdminReLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@account.example',
          password: 'BootstrapPass123!',
        }),
      });
      ok(accountAdminReLoginRes.status === 200, 'Auth: account_admin can log back in after manual reactivate');
      accountAdminCookie = cookieHeaderFromResponse(accountAdminReLoginRes);
      ok(Boolean(accountAdminCookie), 'Auth: account_admin re-login refreshes session cookie');

      const billingAdminReLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'billing@account.example',
          password: 'BillingPass456!',
        }),
      });
      ok(billingAdminReLoginRes.status === 200, 'Auth: billing_admin can log back in after manual reactivate');
      billingAdminCookie = cookieHeaderFromResponse(billingAdminReLoginRes);
      ok(Boolean(billingAdminCookie), 'Auth: billing_admin re-login refreshes session cookie');

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

      const suspendedPortalOldSessionRes = await fetch(`${BASE}/api/v1/account/billing/portal`, {
        method: 'POST',
        headers: { Cookie: billingAdminCookie! },
      });
      ok(suspendedPortalOldSessionRes.status === 401, 'Stripe Webhook: suspension invalidates pre-existing billing session');

      const suspendedBillingLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'billing@account.example',
          password: 'BillingPass456!',
        }),
      });
      ok(suspendedBillingLoginRes.status === 200, 'Auth: suspended billing_admin can re-login for billing self-service');
      billingAdminCookie = cookieHeaderFromResponse(suspendedBillingLoginRes);
      ok(Boolean(billingAdminCookie), 'Auth: suspended billing_admin login sets fresh session cookie');

      const suspendedPortalRes = await fetch(`${BASE}/api/v1/account/billing/portal`, {
        method: 'POST',
        headers: { Cookie: billingAdminCookie! },
      });
      ok(suspendedPortalRes.status === 200, 'Stripe Webhook: suspended account may still open billing portal after re-login');

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
              has_more: false,
              data: [{
                id: 'il_account_001_paid_1',
                object: 'line_item',
                invoice: 'in_account_001_paid',
                amount: 5000,
                subtotal: 5000,
                currency: 'usd',
                description: 'Attestor Pro Monthly',
                quantity: 1,
                subscription: 'sub_account_001',
                pricing: {
                  type: 'price_details',
                  price_details: {
                    price: 'price_pro_monthly',
                  },
                  unit_amount_decimal: '5000',
                },
                period: {
                  start: Math.floor(Date.now() / 1000) - 3600,
                  end: Math.floor(Date.now() / 1000),
                },
                parent: {
                  type: 'subscription_item_details',
                  invoice_item_details: null,
                  subscription_item_details: {
                    invoice_item: null,
                    proration: false,
                    proration_details: null,
                    subscription: 'sub_account_001',
                    subscription_item: 'si_account_001',
                  },
                },
                metadata: {},
              }],
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

      const billingAdminPostInvoiceLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'billing@account.example',
          password: 'BillingPass456!',
        }),
      });
      ok(billingAdminPostInvoiceLoginRes.status === 200, 'Auth: billing_admin can re-login after invoice recovery');
      billingAdminCookie = cookieHeaderFromResponse(billingAdminPostInvoiceLoginRes);
      ok(Boolean(billingAdminCookie), 'Auth: billing_admin invoice recovery login refreshes session cookie');

      const portalReadyRes = await fetch(`${BASE}/api/v1/account/billing/portal`, {
        method: 'POST',
        headers: { Cookie: billingAdminCookie! },
      });
      ok(portalReadyRes.status === 200, 'Account Billing: portal status 200 once customer exists');
      const portalReadyBody = await portalReadyRes.json() as any;
      ok(String(portalReadyBody.portalUrl).includes('/portal/'), 'Account Billing: portal URL returned');
      ok(portalReadyBody.mock === true, 'Account Billing: portal mock mode surfaced');

      const checkoutSuccessPageRes = await fetch(`${BASE}/billing/success`);
      ok(checkoutSuccessPageRes.status === 200, 'Billing pages: success return surface responds');
      const checkoutSuccessPage = await checkoutSuccessPageRes.text();
      ok(checkoutSuccessPage.includes('Checkout completed'), 'Billing pages: success return surface explains checkout completion');
      ok(checkoutSuccessPage.includes('14-day free trial'), 'Billing pages: success return surface explains the starter trial in human terms');

      const checkoutCancelPageRes = await fetch(`${BASE}/billing/cancel`);
      ok(checkoutCancelPageRes.status === 200, 'Billing pages: cancel return surface responds');
      const checkoutCancelPage = await checkoutCancelPageRes.text();
      ok(checkoutCancelPage.includes('Checkout canceled'), 'Billing pages: cancel return surface explains cancellation');
      ok(checkoutCancelPage.includes('same hosted account'), 'Billing pages: cancel return surface explains that the account is unchanged');

      const billingSettingsPageRes = await fetch(`${BASE}/settings/billing`);
      ok(billingSettingsPageRes.status === 200, 'Billing pages: billing settings return surface responds');
      const billingSettingsPage = await billingSettingsPageRes.text();
      ok(billingSettingsPage.includes('Billing settings'), 'Billing pages: billing settings return surface explains next steps');
      ok(billingSettingsPage.includes('Starter is the first hosted paid plan'), 'Billing pages: billing settings summarises the plan ladder in plain language');

      const landingPageRes = await fetch(`${BASE}/`);
      ok(landingPageRes.status === 200, 'Site surface: landing page responds');
      const landingPage = await landingPageRes.text();
      ok(landingPage.includes('AI-assisted financial reporting acceptance'), 'Site surface: landing page leads with the finance wedge');
      ok(landingPage.includes('Counterparty exposure reporting acceptance'), 'Site surface: landing page points at the canonical reporting proof');

      const proofSurfaceRes = await fetch(`${BASE}/proof/financial-reporting-acceptance`);
      ok(proofSurfaceRes.status === 200, 'Site surface: proof page responds');
      const proofSurface = await proofSurfaceRes.text();
      ok(proofSurface.includes('shown as evidence instead of promise'), 'Site surface: proof page frames the product through evidence');
      ok(proofSurface.includes('committed hybrid packet'), 'Site surface: proof page explains that a committed packet is available');

      const proofKitRes = await fetch(`${BASE}/proof/financial-reporting-acceptance/evidence/kit.json`);
      ok(proofKitRes.status === 200, 'Site surface: committed proof kit endpoint responds');
      ok((proofKitRes.headers.get('content-type') ?? '').includes('application/json'), 'Site surface: committed proof kit endpoint returns JSON');
      const proofKitBody = await proofKitRes.json() as any;
      ok(proofKitBody.verification.overall === 'verified', 'Site surface: committed proof kit exposes a verified packet');

      const appReturnRes = await fetch(`${BASE}/app`);
      ok(appReturnRes.status === 200, 'Billing pages: legacy app return path resolves');
      ok(appReturnRes.url.endsWith('/settings/billing'), 'Billing pages: legacy app return path redirects to billing settings');

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
      ok(accountSummaryAfterWebhookBody.entitlement.provider === 'stripe', 'Account API: summary entitlement provider switches to stripe');
      ok(accountSummaryAfterWebhookBody.entitlement.status === 'active', 'Account API: summary entitlement reaches active');
      ok(accountSummaryAfterWebhookBody.entitlement.effectivePlanId === 'pro', 'Account API: summary entitlement effective plan synced to pro');

      const accountEntitlementAfterWebhookRes = await fetch(`${BASE}/api/v1/account/entitlement`, {
        headers: { Cookie: billingAdminCookie! },
      });
      ok(accountEntitlementAfterWebhookRes.status === 200, 'Account Entitlement: status 200 after webhook lifecycle');
      const accountEntitlementAfterWebhookBody = await accountEntitlementAfterWebhookRes.json() as any;
      ok(accountEntitlementAfterWebhookBody.entitlement.status === 'active', 'Account Entitlement: active after invoice.paid');
      ok(accountEntitlementAfterWebhookBody.entitlement.accessEnabled === true, 'Account Entitlement: access re-enabled after invoice.paid');
      ok(accountEntitlementAfterWebhookBody.entitlement.lastEventId === 'evt_invoice_account_001_paid', 'Account Entitlement: last event tracks latest invoice event');

      const entitlementSummaryPayload = JSON.stringify({
        id: 'evt_entitlements_account_001_updated',
        object: 'event',
        type: 'entitlements.active_entitlement_summary.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            object: 'entitlements.active_entitlement_summary',
            customer: 'cus_account_001',
            entitlements: {
              object: 'list',
              data: [
                {
                  id: 'entacct_001_pro_api',
                  object: 'entitlements.active_entitlement',
                  lookup_key: 'attestor.pro.api',
                  feature: {
                    id: 'feat_pro_api',
                    object: 'entitlements.feature',
                    lookup_key: 'attestor.pro.api',
                  },
                },
                {
                  id: 'entacct_001_export',
                  object: 'entitlements.active_entitlement',
                  lookup_key: 'attestor.pro.billing_export',
                  feature: {
                    id: 'feat_billing_export',
                    object: 'entitlements.feature',
                    lookup_key: 'attestor.pro.billing_export',
                  },
                },
              ],
            },
          },
        },
      });
      const entitlementSummarySignature = stripe.webhooks.generateTestHeaderString({
        payload: entitlementSummaryPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      });
      const entitlementSummaryRes = await fetch(`${BASE}/api/v1/billing/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': entitlementSummarySignature,
        },
        body: entitlementSummaryPayload,
      });
      ok(entitlementSummaryRes.status === 200, 'Stripe Webhook: entitlements.active_entitlement_summary.updated accepted');

      const accountEntitlementAfterSummaryRes = await fetch(`${BASE}/api/v1/account/entitlement`, {
        headers: { Cookie: billingAdminCookie! },
      });
      ok(accountEntitlementAfterSummaryRes.status === 200, 'Account Entitlement: readable after entitlement summary update');
      const accountEntitlementAfterSummaryBody = await accountEntitlementAfterSummaryRes.json() as any;
      ok(accountEntitlementAfterSummaryBody.entitlement.lastEventId === 'evt_entitlements_account_001_updated', 'Account Entitlement: last event advances to entitlement summary');
      ok(accountEntitlementAfterSummaryBody.entitlement.stripeEntitlementLookupKeys.includes('attestor.pro.api'), 'Account Entitlement: lookup keys persisted from Stripe entitlement summary');
      ok(accountEntitlementAfterSummaryBody.entitlement.stripeEntitlementFeatureIds.includes('feat_pro_api'), 'Account Entitlement: feature ids persisted from Stripe entitlement summary');
      ok(typeof accountEntitlementAfterSummaryBody.entitlement.stripeEntitlementSummaryUpdatedAt === 'string', 'Account Entitlement: entitlement summary timestamp stored');

      const accountFeaturesRes = await fetch(`${BASE}/api/v1/account/features`, {
        headers: { Cookie: billingAdminCookie! },
      });
      ok(accountFeaturesRes.status === 200, 'Account Features: status 200 after entitlement summary');
      const accountFeaturesBody = await accountFeaturesRes.json() as any;
      ok(accountFeaturesBody.summary.stripeSummaryPresent === true, 'Account Features: stripe summary marked present');
      const apiFeature = accountFeaturesBody.features.find((entry: any) => entry.key === 'api.access');
      ok(Boolean(apiFeature), 'Account Features: api.access feature still present');
      ok(apiFeature.granted === true, 'Account Features: api.access granted after Stripe entitlement summary');
      ok(apiFeature.grantSource === 'stripe_entitlement', 'Account Features: api.access source switches to Stripe entitlement');
      ok(apiFeature.matchedLookupKeys.includes('attestor.pro.api'), 'Account Features: api.access matched Stripe lookup key');
      const exportFeature = accountFeaturesBody.features.find((entry: any) => entry.key === 'billing.export');
      ok(Boolean(exportFeature), 'Account Features: billing.export feature present');
      ok(exportFeature.grantSource === 'stripe_entitlement', 'Account Features: billing.export source switches to Stripe entitlement');
      const reconciliationFeature = accountFeaturesBody.features.find((entry: any) => entry.key === 'billing.reconciliation');
      ok(Boolean(reconciliationFeature), 'Account Features: billing.reconciliation feature present');
      ok(reconciliationFeature.granted === false, 'Account Features: missing Stripe-managed reconciliation entitlement stays disabled');
      ok(reconciliationFeature.grantSource === 'stripe_not_granted', 'Account Features: reconciliation shows Stripe-not-granted status');

      const adminAccountFeaturesRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/features`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(adminAccountFeaturesRes.status === 200, 'Admin Account Features: status 200');
      const adminAccountFeaturesBody = await adminAccountFeaturesRes.json() as any;
      ok(adminAccountFeaturesBody.summary.stripeGrantedCount >= 2, 'Admin Account Features: stripe-backed features counted');
      ok(adminAccountFeaturesBody.features.some((entry: any) => entry.key === 'billing.export' && entry.grantSource === 'stripe_entitlement'), 'Admin Account Features: export feature visible to admin');

      const accountAdminPostInvoiceLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@account.example',
          password: 'BootstrapPass123!',
        }),
      });
      ok(accountAdminPostInvoiceLoginRes.status === 200, 'Auth: account_admin can re-login after invoice recovery');
      accountAdminCookie = cookieHeaderFromResponse(accountAdminPostInvoiceLoginRes);
      ok(Boolean(accountAdminCookie), 'Auth: account_admin post-invoice re-login sets fresh session cookie');

      const accountBillingExportRes = await fetch(`${BASE}/api/v1/account/billing/export?limit=5`, {
        headers: { Cookie: billingAdminCookie! },
      });
      ok(accountBillingExportRes.status === 200, 'Account Billing Export: json status 200');
      const accountBillingExportBody = await accountBillingExportRes.json() as any;
      ok(accountBillingExportBody.accountId === createAccountBody.account.id, 'Account Billing Export: account id matches');
      ok(accountBillingExportBody.entitlement.status === 'active', 'Account Billing Export: entitlement included in JSON');
      ok(accountBillingExportBody.checkout.sessionId === checkoutBody.checkoutSessionId, 'Account Billing Export: checkout session propagated');
      ok(accountBillingExportBody.entitlementFeatures.lookupKeys.includes('attestor.pro.api'), 'Account Billing Export: entitlement lookup keys exported');
      ok(accountBillingExportBody.entitlementFeatures.featureIds.includes('feat_pro_api'), 'Account Billing Export: entitlement feature ids exported');
      ok(accountBillingExportBody.reconciliation.summary.status === 'partial', 'Account Billing Export: reconciliation is partial without detailed line-item truth');
      ok(accountBillingExportBody.reconciliation.summary.invoiceCount >= 1, 'Account Billing Export: reconciliation invoice count reported');
      ok(accountBillingExportBody.summary.dataSource === 'ledger_derived' || accountBillingExportBody.summary.dataSource === 'mock_summary', 'Account Billing Export: data source is ledger-derived or mock-summary');
      const exportedInvoice = accountBillingExportBody.invoices.find((entry: any) => entry.invoiceId === 'in_account_001_paid');
      ok(Boolean(exportedInvoice), 'Account Billing Export: paid invoice exported');
      ok(exportedInvoice.amountPaid === 5000, 'Account Billing Export: paid invoice amount exported');
      const exportedCharge = accountBillingExportBody.charges.find((entry: any) => entry.invoiceId === 'in_account_001_paid');
      ok(Boolean(exportedCharge), 'Account Billing Export: derived charge exported from invoice.paid');
      ok(exportedCharge.status === 'succeeded', 'Account Billing Export: derived charge status succeeded');
      if (accountBillingExportBody.summary.dataSource === 'ledger_derived' || accountBillingExportBody.summary.dataSource === 'stripe_live') {
        const exportedLineItem = accountBillingExportBody.lineItems.find((entry: any) => entry.invoiceId === 'in_account_001_paid');
        ok(Boolean(exportedLineItem), 'Account Billing Export: invoice line item exported when detailed billing truth is available');
        ok(exportedLineItem.priceId === 'price_pro_monthly', 'Account Billing Export: invoice line item captures price id');
        ok(accountBillingExportBody.summary.lineItemCount >= 1, 'Account Billing Export: line item count reported when detailed billing truth is available');
      } else {
        ok(accountBillingExportBody.summary.lineItemCount === 0, 'Account Billing Export: line items stay empty without shared billing ledger');
      }
      const exportedReconciliationInvoice = accountBillingExportBody.reconciliation.invoices.find((entry: any) => entry.invoiceId === 'in_account_001_paid');
      ok(Boolean(exportedReconciliationInvoice), 'Account Billing Export: reconciliation includes paid invoice');
      ok(exportedReconciliationInvoice.checks.chargesVsInvoicePaid.status === 'match', 'Account Billing Export: reconciliation matches paid charges');
      ok(exportedReconciliationInvoice.checks.lineItemsVsInvoice.status === 'unavailable', 'Account Billing Export: reconciliation marks missing line items as unavailable in mock-summary mode');

      const accountBillingExportCsvRes = await fetch(`${BASE}/api/v1/account/billing/export?format=csv&limit=5`, {
        headers: { Cookie: billingAdminCookie! },
      });
      ok(accountBillingExportCsvRes.status === 200, 'Account Billing Export: csv status 200');
      ok((accountBillingExportCsvRes.headers.get('content-type') ?? '').includes('text/csv'), 'Account Billing Export: csv content-type');
      const accountBillingExportCsv = await accountBillingExportCsvRes.text();
      ok(accountBillingExportCsv.includes('recordType,accountId,tenantId'), 'Account Billing Export: csv header present');
      ok(accountBillingExportCsv.includes('invoice') && accountBillingExportCsv.includes('in_account_001_paid'), 'Account Billing Export: csv includes invoice row');
      if (accountBillingExportBody.summary.lineItemCount > 0) {
        ok(accountBillingExportCsv.includes('line_item') && accountBillingExportCsv.includes('il_account_001_paid_1'), 'Account Billing Export: csv includes invoice line item row when detailed billing truth is available');
      }

      const adminBillingExportNoAuth = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/export`);
      ok(adminBillingExportNoAuth.status === 401, 'Admin Account Billing Export: auth required');

      const adminBillingExportRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/export?limit=5`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(adminBillingExportRes.status === 200, 'Admin Account Billing Export: json status 200');
      const adminBillingExportBody = await adminBillingExportRes.json() as any;
      ok(adminBillingExportBody.accountId === createAccountBody.account.id, 'Admin Account Billing Export: account id matches');
      ok(adminBillingExportBody.summary.invoiceCount >= 1, 'Admin Account Billing Export: invoice count reported');
      ok(adminBillingExportBody.entitlement.status === 'active', 'Admin Account Billing Export: entitlement included');
      ok(adminBillingExportBody.reconciliation.summary.status === 'partial', 'Admin Account Billing Export: reconciliation partial without shared billing ledger');
      if (adminBillingExportBody.summary.dataSource === 'ledger_derived' || adminBillingExportBody.summary.dataSource === 'stripe_live') {
        ok(adminBillingExportBody.summary.lineItemCount >= 1, 'Admin Account Billing Export: line item count reported when detailed billing truth is available');
      } else {
        ok(adminBillingExportBody.summary.lineItemCount === 0, 'Admin Account Billing Export: line items stay empty without shared billing ledger');
      }

      const accountBillingReconciliationRes = await fetch(`${BASE}/api/v1/account/billing/reconciliation?limit=5`, {
        headers: { Cookie: billingAdminCookie! },
      });
      ok(accountBillingReconciliationRes.status === 200, 'Account Billing Reconciliation: status 200');
      const accountBillingReconciliationBody = await accountBillingReconciliationRes.json() as any;
      ok(accountBillingReconciliationBody.accountId === createAccountBody.account.id, 'Account Billing Reconciliation: account id matches');
      ok(accountBillingReconciliationBody.reconciliation.summary.status === 'partial', 'Account Billing Reconciliation: partial summary without shared line-item truth');

      const adminBillingReconciliationRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/reconciliation?limit=5`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(adminBillingReconciliationRes.status === 200, 'Admin Account Billing Reconciliation: status 200');
      const adminBillingReconciliationBody = await adminBillingReconciliationRes.json() as any;
      ok(adminBillingReconciliationBody.reconciliation.summary.invoiceCount >= 1, 'Admin Account Billing Reconciliation: invoice count reported');
      ok(adminBillingReconciliationBody.reconciliation.summary.partialCount >= 1, 'Admin Account Billing Reconciliation: partial reconciliation counted');

      const adminBillingExportCsvRes = await fetch(`${BASE}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/export?format=csv&limit=5`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(adminBillingExportCsvRes.status === 200, 'Admin Account Billing Export: csv status 200');
      ok((adminBillingExportCsvRes.headers.get('content-disposition') ?? '').includes(`${createAccountBody.account.id}-billing-export.csv`), 'Admin Account Billing Export: csv attachment filename');

      const deactivateReadOnlyRes = await fetch(`${BASE}/api/v1/account/users/${createReadOnlyBody.user.id}/deactivate`, {
        method: 'POST',
        headers: { Cookie: accountAdminCookie! },
      });
      ok(deactivateReadOnlyRes.status === 200, 'Account Users: deactivate read_only status 200');
      const deactivateReadOnlyBody = await deactivateReadOnlyRes.json() as any;
      ok(deactivateReadOnlyBody.user.status === 'inactive', 'Account Users: read_only marked inactive');

      const readOnlyAfterDeactivateLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'readonly@account.example',
          password: 'ReadOnlyPass456!',
        }),
      });
      ok(readOnlyAfterDeactivateLoginRes.status === 403, 'Auth: inactive read_only user cannot log in');

      const reactivateReadOnlyRes = await fetch(`${BASE}/api/v1/account/users/${createReadOnlyBody.user.id}/reactivate`, {
        method: 'POST',
        headers: { Cookie: accountAdminCookie! },
      });
      ok(reactivateReadOnlyRes.status === 200, 'Account Users: reactivate read_only status 200');
      const reactivateReadOnlyBody = await reactivateReadOnlyRes.json() as any;
      ok(reactivateReadOnlyBody.user.status === 'active', 'Account Users: read_only reactivated');

      const readOnlyReLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'readonly@account.example',
          password: 'ReadOnlyPass456!',
        }),
      });
      ok(readOnlyReLoginRes.status === 200, 'Auth: reactivated read_only user can log in again');
      const readOnlyLogoutCookie = cookieHeaderFromResponse(readOnlyReLoginRes);
      ok(Boolean(readOnlyLogoutCookie), 'Auth: reactivated read_only login sets cookie');

      const readOnlyLogoutRes = await fetch(`${BASE}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Cookie: readOnlyLogoutCookie! },
      });
      ok(readOnlyLogoutRes.status === 200, 'Auth: logout status 200');

      const readOnlyAfterLogoutMeRes = await fetch(`${BASE}/api/v1/auth/me`, {
        headers: { Cookie: readOnlyLogoutCookie! },
      });
      ok(readOnlyAfterLogoutMeRes.status === 401, 'Auth: logged-out session rejected by me endpoint');

      const billingEventsNoAuth = await fetch(`${BASE}/api/v1/admin/billing/events`);
      ok(billingEventsNoAuth.status === 401, 'Admin Billing Events: auth required');

      // Billing Events ledger requires ATTESTOR_BILLING_LEDGER_PG_URL — skip detailed checks when PG not configured
      const billingEventsRes = await fetch(`${BASE}/api/v1/admin/billing/events?accountId=${createAccountBody.account.id}&limit=10`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      if (billingEventsRes.status === 200) {
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
        console.log(`    billing events: ${billingEventsBody.summary.recordCount} records (PG ledger)`);
      } else {
        console.log(`    billing events: skipped (PG ledger not configured, status ${billingEventsRes.status})`);
      }

      const billingEntitlementsNoAuth = await fetch(`${BASE}/api/v1/admin/billing/entitlements`);
      ok(billingEntitlementsNoAuth.status === 401, 'Admin Billing Entitlements: auth required');

      const billingEntitlementsRes = await fetch(`${BASE}/api/v1/admin/billing/entitlements?accountId=${createAccountBody.account.id}`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(billingEntitlementsRes.status === 200, 'Admin Billing Entitlements: status 200');
      const billingEntitlementsBody = await billingEntitlementsRes.json() as any;
      ok(billingEntitlementsBody.summary.recordCount === 1, 'Admin Billing Entitlements: one record returned for account');
      ok(billingEntitlementsBody.records[0].status === 'active', 'Admin Billing Entitlements: active entitlement returned');
      ok(billingEntitlementsBody.records[0].effectivePlanId === 'pro', 'Admin Billing Entitlements: plan filter view shows pro');

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

      const scrapeMetricsNoAuth = await fetch(`${BASE}/api/v1/metrics`);
      ok(scrapeMetricsNoAuth.status === 401, 'Scrape Metrics: auth required');

      const scrapeMetricsWrongAuth = await fetch(`${BASE}/api/v1/metrics`, {
        headers: { Authorization: 'Bearer wrong-secret' },
      });
      ok(scrapeMetricsWrongAuth.status === 401, 'Scrape Metrics: wrong token rejected');

      const scrapeMetricsRes = await fetch(`${BASE}/api/v1/metrics`, {
        headers: { Authorization: 'Bearer metrics-secret' },
      });
      ok(scrapeMetricsRes.status === 200, 'Scrape Metrics: status 200');
      ok((scrapeMetricsRes.headers.get('content-type') ?? '').includes('text/plain'), 'Scrape Metrics: content type is text/plain');
      const scrapeMetricsBody = await scrapeMetricsRes.text();
      ok(scrapeMetricsBody.includes('attestor_http_requests_total'), 'Scrape Metrics: request counter exposed');

      const observabilityLog = readFileSync(process.env.ATTESTOR_OBSERVABILITY_LOG_PATH!, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
      ok(observabilityLog.some((entry: any) => entry.route === '/api/v1/health' && entry.traceId), 'Observability Log: health request captured with trace id');
      ok(observabilityLog.some((entry: any) => entry.route === '/api/v1/billing/stripe/webhook' && entry.accountId === createAccountBody.account.id), 'Observability Log: billing webhook captured with account context');

      const telemetryNoAuth = await fetch(`${BASE}/api/v1/admin/telemetry`);
      ok(telemetryNoAuth.status === 401, 'Admin Telemetry: auth required');

      const telemetryRes = await fetch(`${BASE}/api/v1/admin/telemetry`, {
        headers: { Authorization: 'Bearer admin-secret' },
      });
      ok(telemetryRes.status === 200, 'Admin Telemetry: status 200');
      const telemetryBody = await telemetryRes.json() as any;
      ok(telemetryBody.telemetry.enabled === false, 'Admin Telemetry: disabled by default without OTLP env');

      const signupRes = await fetch(`${BASE}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountName: 'Self Serve Co',
          email: 'founder@selfserve.example',
          displayName: 'Founder Owner',
          password: 'SelfServePass123!',
        }),
      });
      ok(signupRes.status === 201, 'Auth Signup: status 201');
      const signupBody = await signupRes.json() as any;
      let signupCookie = cookieHeaderFromResponse(signupRes);
      ok(Boolean(signupCookie), 'Auth Signup: session cookie issued');
      ok(signupBody.signup === true, 'Auth Signup: signup flag true');
      ok(signupBody.user.role === 'account_admin', 'Auth Signup: first user is account_admin');
      ok(signupBody.initialKey.planId === 'community', 'Auth Signup: community plan applied');
      ok(signupBody.commercial.currentPhase === 'evaluation', 'Auth Signup: signup starts in evaluation phase');
      ok(signupBody.commercial.includedMonthlyRunQuota === 10, 'Auth Signup: community includes 10 hosted runs before upgrade');
      ok(signupBody.commercial.firstHostedPlanId === 'starter', 'Auth Signup: starter is the first hosted paid plan');
      ok(signupBody.commercial.firstHostedPlanTrialDays === 14, 'Auth Signup: starter trial surfaced in signup response');
      ok(typeof signupBody.initialKey.apiKey === 'string', 'Auth Signup: initial API key returned');

      const signupUsageRes = await fetch(`${BASE}/api/v1/account/usage`, {
        headers: { Authorization: `Bearer ${signupBody.initialKey.apiKey}` },
      });
      ok(signupUsageRes.status === 200, 'Auth Signup: initial API key works');
      const signupUsageBody = await signupUsageRes.json() as any;
      ok(signupUsageBody.tenantContext.planId === 'community', 'Auth Signup: community plan visible in usage');
      ok(signupUsageBody.usage.quota === 10, 'Auth Signup: community signup has 10 included hosted runs');
      ok(signupUsageBody.usage.enforced === true, 'Auth Signup: community hosted quota is enforced');

      const signupPipelineRunRes = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signupBody.initialKey.apiKey}`,
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
      ok(signupPipelineRunRes.status === 200, 'Auth Signup: evaluation account can consume one of the included community hosted runs');
      const signupPipelineRunBody = await signupPipelineRunRes.json() as any;
      ok(signupPipelineRunBody.decision === 'pass', 'Auth Signup: community hosted run still executes the governed pipeline');

      for (let attempt = 2; attempt <= 10; attempt += 1) {
        const res = await fetch(`${BASE}/api/v1/pipeline/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${signupBody.initialKey.apiKey}`,
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
        ok(res.status === 200, `Auth Signup: community run ${attempt} stays within the included quota`);
      }

      const signupQuotaExceededRes = await fetch(`${BASE}/api/v1/pipeline/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signupBody.initialKey.apiKey}`,
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
      ok(signupQuotaExceededRes.status === 429, 'Auth Signup: community hosted run 11 is blocked after the included 10 runs are consumed');

      const accountKeysRes = await fetch(`${BASE}/api/v1/account/api-keys`, {
        headers: { Cookie: signupCookie! },
      });
      ok(accountKeysRes.status === 200, 'Account API Keys: list status 200');
      const accountKeysBody = await accountKeysRes.json() as any;
      ok(accountKeysBody.keys.length === 1, 'Account API Keys: initial key listed');
      ok(accountKeysBody.keys[0].id === signupBody.initialKey.id, 'Account API Keys: initial key id matches signup response');

      const rotateAccountKeyRes = await fetch(`${BASE}/api/v1/account/api-keys/${signupBody.initialKey.id}/rotate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: signupCookie!,
        },
      });
      ok(rotateAccountKeyRes.status === 201, 'Account API Keys: rotate status 201');
      const rotateAccountKeyBody = await rotateAccountKeyRes.json() as any;
      ok(typeof rotateAccountKeyBody.newKey.apiKey === 'string', 'Account API Keys: rotate returns new plaintext key');
      ok(rotateAccountKeyBody.previousKey.id === signupBody.initialKey.id, 'Account API Keys: rotate preserves previous key id reference');

      const revokeSupersededKeyRes = await fetch(`${BASE}/api/v1/account/api-keys/${signupBody.initialKey.id}/revoke`, {
        method: 'POST',
        headers: { Cookie: signupCookie! },
      });
      ok(revokeSupersededKeyRes.status === 200, 'Account API Keys: revoke superseded signup key status 200');
      const revokeSupersededKeyBody = await revokeSupersededKeyRes.json() as any;
      ok(revokeSupersededKeyBody.key.status === 'revoked', 'Account API Keys: superseded signup key marked revoked');

      const issueAccountKeyRes = await fetch(`${BASE}/api/v1/account/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: signupCookie!,
        },
      });
      ok(issueAccountKeyRes.status === 201, 'Account API Keys: issue status 201');
      const issueAccountKeyBody = await issueAccountKeyRes.json() as any;
      ok(typeof issueAccountKeyBody.key.apiKey === 'string', 'Account API Keys: plaintext key returned on issue');
      ok(issueAccountKeyBody.key.planId === 'community', 'Account API Keys: issued key inherits community plan');

      const deactivateKeyRes = await fetch(`${BASE}/api/v1/account/api-keys/${issueAccountKeyBody.key.id}/deactivate`, {
        method: 'POST',
        headers: { Cookie: signupCookie! },
      });
      ok(deactivateKeyRes.status === 200, 'Account API Keys: deactivate status 200');
      const deactivateKeyBody = await deactivateKeyRes.json() as any;
      ok(deactivateKeyBody.key.status === 'inactive', 'Account API Keys: key marked inactive');

      const reactivateKeyRes = await fetch(`${BASE}/api/v1/account/api-keys/${issueAccountKeyBody.key.id}/reactivate`, {
        method: 'POST',
        headers: { Cookie: signupCookie! },
      });
      ok(reactivateKeyRes.status === 200, 'Account API Keys: reactivate status 200');
      const reactivateKeyBody = await reactivateKeyRes.json() as any;
      ok(reactivateKeyBody.key.status === 'active', 'Account API Keys: key marked active again');

      const revokeKeyRes = await fetch(`${BASE}/api/v1/account/api-keys/${issueAccountKeyBody.key.id}/revoke`, {
        method: 'POST',
        headers: { Cookie: signupCookie! },
      });
      ok(revokeKeyRes.status === 200, 'Account API Keys: revoke status 200');
      const revokeKeyBody = await revokeKeyRes.json() as any;
      ok(revokeKeyBody.key.status === 'revoked', 'Account API Keys: key marked revoked');

      const signupReadOnlyCreateRes = await fetch(`${BASE}/api/v1/account/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: signupCookie!,
        },
        body: JSON.stringify({
          email: 'reader@selfserve.example',
          displayName: 'Reader',
          password: 'ReaderPass123!',
          role: 'read_only',
        }),
      });
      ok(signupReadOnlyCreateRes.status === 201, 'Account API Keys: create read_only user status 201');

      const signupReadOnlyLoginRes = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'reader@selfserve.example',
          password: 'ReaderPass123!',
        }),
      });
      ok(signupReadOnlyLoginRes.status === 200, 'Account API Keys: read_only login status 200');
      const signupReadOnlyCookie = cookieHeaderFromResponse(signupReadOnlyLoginRes);
      ok(Boolean(signupReadOnlyCookie), 'Account API Keys: read_only session cookie issued');

      const readOnlyListKeysRes = await fetch(`${BASE}/api/v1/account/api-keys`, {
        headers: { Cookie: signupReadOnlyCookie! },
      });
      ok(readOnlyListKeysRes.status === 403, 'Account API Keys: read_only blocked from listing keys');

      const readOnlyIssueKeyRes = await fetch(`${BASE}/api/v1/account/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: signupReadOnlyCookie!,
        },
      });
      ok(readOnlyIssueKeyRes.status === 403, 'Account API Keys: read_only blocked from issuing keys');

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

      await new Promise((resolve) => setTimeout(resolve, 5200));

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
    resetAccountUserStoreForTests();
    resetAccountUserActionTokenStoreForTests();
    resetAccountSessionStoreForTests();
    resetTenantKeyStoreForTests();
    resetUsageMeter();
    await resetTenantRateLimiterForTests();
    resetAdminAuditLogForTests();
    resetAdminIdempotencyStoreForTests();
    resetStripeWebhookStoreForTests();
    resetHostedBillingEntitlementStoreForTests();
    resetHostedEmailDeliveryEventStoreForTests();
    await resetBillingEventLedgerForTests();
    resetObservabilityForTests();
    serverHandle.close();
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
