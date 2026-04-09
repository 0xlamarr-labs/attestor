import { strict as assert } from 'node:assert';
import EmbeddedPostgres from 'embedded-postgres';
import Stripe from 'stripe';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  COUNTERPARTY_FIXTURE,
  COUNTERPARTY_INTENT,
  COUNTERPARTY_REPORT,
  COUNTERPARTY_REPORT_CONTRACT,
  COUNTERPARTY_SQL,
} from '../src/financial/fixtures/scenarios.js';
import { generateCurrentTotpCode } from '../src/service/account-mfa.js';
import { resetAdminAuditLogForTests } from '../src/service/admin-audit-log.js';
import { resetAdminIdempotencyStoreForTests } from '../src/service/admin-idempotency-store.js';
import { resetHostedBillingEntitlementStoreForTests } from '../src/service/billing-entitlement-store.js';
import { resetObservabilityForTests } from '../src/service/observability.js';
import { resetTenantRateLimiterForTests } from '../src/service/rate-limit.js';
import { resetStripeWebhookStoreForTests } from '../src/service/stripe-webhook-store.js';
import { resetBillingEventLedgerForTests } from '../src/service/billing-event-ledger.js';
import {
  claimProcessedStripeWebhookState,
  finalizeProcessedStripeWebhookState,
  releaseProcessedStripeWebhookClaimState,
  resetSharedControlPlaneStoreForTests,
} from '../src/service/control-plane-store.js';

let passed = 0;
const stripe = new Stripe('sk_test_live_control_plane');

function ok(condition: boolean, message: string): void {
  assert(condition, message);
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
        reject(new Error('Could not reserve TCP port.'));
        return;
      }
      const { port } = address;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

async function waitForJobStatus(
  base: string,
  jobId: string,
  expected: 'completed' | 'failed',
  timeoutMs: number = 6000,
  headers?: Record<string, string>,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/v1/pipeline/status/${jobId}`, { headers });
    const body = await res.json();
    if (body.status === expected) return body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for async job ${jobId} to reach status '${expected}'.`);
}

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(process.cwd(), '.attestor', 'live-control-plane-pg-'));
  const pgDataDir = join(tempRoot, 'pg');
  const pgPort = await reservePort();
  const apiPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user: 'control_plane_live',
    password: 'control_plane_live',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  const accountStorePath = join(tempRoot, 'accounts.json');
  const tenantKeyStorePath = join(tempRoot, 'tenant-keys.json');
  const usageLedgerPath = join(tempRoot, 'usage-ledger.json');
  const accountUserStorePath = join(tempRoot, 'account-users.json');
  const accountUserTokenStorePath = join(tempRoot, 'account-user-tokens.json');
  const accountSessionStorePath = join(tempRoot, 'account-sessions.json');
  const adminAuditPath = join(tempRoot, 'admin-audit.json');
  const adminIdempotencyPath = join(tempRoot, 'admin-idempotency.json');
  const asyncDlqPath = join(tempRoot, 'async-dlq.json');
  const stripeWebhookPath = join(tempRoot, 'stripe-webhooks.json');
  const billingEntitlementPath = join(tempRoot, 'billing-entitlements.json');

  process.env.ATTESTOR_CONTROL_PLANE_PG_URL = `postgres://control_plane_live:control_plane_live@localhost:${pgPort}/attestor_control_plane`;
  process.env.ATTESTOR_ACCOUNT_STORE_PATH = accountStorePath;
  process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH = accountUserStorePath;
  process.env.ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH = accountUserTokenStorePath;
  process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH = accountSessionStorePath;
  process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY = 'shared-control-plane-mfa-secret';
  process.env.ATTESTOR_TENANT_KEY_STORE_PATH = tenantKeyStorePath;
  process.env.ATTESTOR_USAGE_LEDGER_PATH = usageLedgerPath;
  process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = adminAuditPath;
  process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = adminIdempotencyPath;
  process.env.ATTESTOR_ASYNC_DLQ_STORE_PATH = asyncDlqPath;
  process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = stripeWebhookPath;
  process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH = billingEntitlementPath;
  process.env.ATTESTOR_OBSERVABILITY_LOG_PATH = join(tempRoot, 'observability.jsonl');
  process.env.ATTESTOR_ADMIN_API_KEY = 'admin-shared-control-plane';
  process.env.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS = '2';
  process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS = '5';
  process.env.ATTESTOR_RATE_LIMIT_PRO_REQUESTS = '10';
  process.env.ATTESTOR_ASYNC_PENDING_STARTER_JOBS = '1';
  process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
  process.env.STRIPE_API_KEY = 'sk_test_live_control_plane_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_live_control_plane';
  process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.dev/billing/success';
  process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.dev/billing/cancel';
  process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://attestor.dev/app';
  process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_ENTERPRISE = 'price_enterprise_monthly';

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('attestor_control_plane');

  await resetSharedControlPlaneStoreForTests();
  await resetTenantRateLimiterForTests();
  resetAdminAuditLogForTests();
  resetAdminIdempotencyStoreForTests();
  resetStripeWebhookStoreForTests();
  resetHostedBillingEntitlementStoreForTests();
  resetObservabilityForTests();
  await resetBillingEventLedgerForTests();

  const { startServer } = await import('../src/service/api-server.js');
  const base = `http://127.0.0.1:${apiPort}`;
  const server = startServer(apiPort);
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    console.log('\n[Live shared control-plane PG]');

    const createAccountRes = await fetch(`${base}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-shared-control-plane',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'shared-control-plane-account-1',
      },
      body: JSON.stringify({
        accountName: 'PG Hosted Co',
        contactEmail: 'ops@pg-hosted.example',
        tenantId: 'tenant-pg-live',
        tenantName: 'PG Live Tenant',
        planId: 'starter',
      }),
    });
    ok(createAccountRes.status === 201, 'Admin account create: 201');
    const createAccountBody = await createAccountRes.json() as any;
    ok(createAccountBody.account.primaryTenantId === 'tenant-pg-live', 'Admin account create: tenant stored');
    ok(createAccountBody.initialKey.apiKey.startsWith('atk_'), 'Admin account create: API key issued');
    ok(!existsSync(accountStorePath), 'Shared PG: no local account store file created');
    ok(!existsSync(accountUserStorePath), 'Shared PG: no local account user store file created');
    ok(!existsSync(accountUserTokenStorePath), 'Shared PG: no local account user token store file created');
    ok(!existsSync(accountSessionStorePath), 'Shared PG: no local account session store file created');
    ok(!existsSync(tenantKeyStorePath), 'Shared PG: no local tenant key store file created');
    ok(!existsSync(usageLedgerPath), 'Shared PG: no local usage ledger file created');
    ok(!existsSync(billingEntitlementPath), 'Shared PG: no local billing entitlement file created');
    ok(!existsSync(adminAuditPath), 'Shared PG: no local admin audit file created');
    ok(!existsSync(adminIdempotencyPath), 'Shared PG: no local admin idempotency file created');
    ok(!existsSync(asyncDlqPath), 'Shared PG: no local async DLQ file created');

    const createAccountReplayRes = await fetch(`${base}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-shared-control-plane',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'shared-control-plane-account-1',
      },
      body: JSON.stringify({
        accountName: 'PG Hosted Co',
        contactEmail: 'ops@pg-hosted.example',
        tenantId: 'tenant-pg-live',
        tenantName: 'PG Live Tenant',
        planId: 'starter',
      }),
    });
    ok(createAccountReplayRes.status === 201, 'Admin account replay: 201');
    ok(createAccountReplayRes.headers.get('x-attestor-idempotent-replay') === 'true', 'Admin account replay: replay header set');
    ok(!existsSync(adminIdempotencyPath), 'Shared PG: no local admin idempotency file after replay');

    const tenantAuth = { Authorization: `Bearer ${createAccountBody.initialKey.apiKey}` };

    const accountRes = await fetch(`${base}/api/v1/account`, { headers: tenantAuth });
    ok(accountRes.status === 200, 'Tenant account summary: 200');
    const accountBody = await accountRes.json() as any;
    ok(accountBody.account.accountName === 'PG Hosted Co', 'Tenant account summary: account name matches');
    ok(accountBody.usage.used === 0, 'Tenant account summary: usage starts at 0');
    ok(accountBody.entitlement.status === 'provisioned', 'Tenant account summary: entitlement starts provisioned');
    ok(accountBody.entitlement.effectivePlanId === 'starter', 'Tenant account summary: starter entitlement projected');

    const entitlementRes = await fetch(`${base}/api/v1/account/entitlement`, { headers: tenantAuth });
    ok(entitlementRes.status === 200, 'Tenant entitlement summary: 200');
    const entitlementBody = await entitlementRes.json() as any;
    ok(entitlementBody.entitlement.provider === 'manual', 'Tenant entitlement summary: provider starts manual');

    const bootstrapRes = await fetch(`${base}/api/v1/account/users/bootstrap`, {
      method: 'POST',
      headers: {
        ...tenantAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'owner@pg-hosted.example',
        displayName: 'PG Owner',
        password: 'PgOwnerPass123!',
      }),
    });
    ok(bootstrapRes.status === 201, 'Account bootstrap via shared PG: 201');
    const bootstrapBody = await bootstrapRes.json() as any;
    ok(bootstrapBody.user.role === 'account_admin', 'Account bootstrap via shared PG: account_admin created');
    ok(!existsSync(accountUserStorePath), 'Shared PG: bootstrap does not create local user store file');

    const loginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@pg-hosted.example',
        password: 'PgOwnerPass123!',
      }),
    });
    ok(loginRes.status === 200, 'Account login via shared PG: 200');
    let accountSessionCookie = loginRes.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
    ok(Boolean(accountSessionCookie), 'Account login via shared PG: session cookie returned');
    ok(!existsSync(accountSessionStorePath), 'Shared PG: login does not create local session store file');

    const meRes = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Cookie: accountSessionCookie! },
    });
    ok(meRes.status === 200, 'Account me via shared PG session: 200');
    const meBody = await meRes.json() as any;
    ok(meBody.session.role === 'account_admin', 'Account me via shared PG session: role persisted');

    const mfaEnrollRes = await fetch(`${base}/api/v1/account/mfa/totp/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: accountSessionCookie!,
      },
      body: JSON.stringify({
        password: 'PgOwnerPass123!',
      }),
    });
    ok(mfaEnrollRes.status === 200, 'Shared PG MFA enroll: 200');
    const mfaEnrollBody = await mfaEnrollRes.json() as any;
    ok(typeof mfaEnrollBody.enrollment.secretBase32 === 'string', 'Shared PG MFA enroll: secret returned');
    ok(!existsSync(accountUserStorePath), 'Shared PG MFA enroll: no local account user store created');

    const mfaConfirmRes = await fetch(`${base}/api/v1/account/mfa/totp/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: accountSessionCookie!,
      },
      body: JSON.stringify({
        code: generateCurrentTotpCode(mfaEnrollBody.enrollment.secretBase32),
      }),
    });
    ok(mfaConfirmRes.status === 200, 'Shared PG MFA confirm: 200');
    const mfaConfirmBody = await mfaConfirmRes.json() as any;
    accountSessionCookie = mfaConfirmRes.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
    ok(Boolean(accountSessionCookie), 'Shared PG MFA confirm: fresh session cookie returned');
    ok(Array.isArray(mfaConfirmBody.recoveryCodes) && mfaConfirmBody.recoveryCodes.length === 8, 'Shared PG MFA confirm: recovery codes returned');
    ok(!existsSync(accountSessionStorePath), 'Shared PG MFA confirm: no local session store created');

    const mfaSummaryRes = await fetch(`${base}/api/v1/account/mfa`, {
      headers: { Cookie: accountSessionCookie! },
    });
    ok(mfaSummaryRes.status === 200, 'Shared PG MFA summary: 200');
    const mfaSummaryBody = await mfaSummaryRes.json() as any;
    ok(mfaSummaryBody.mfa.enabled === true, 'Shared PG MFA summary: enabled=true');

    const mfaLoginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@pg-hosted.example',
        password: 'PgOwnerPass123!',
      }),
    });
    ok(mfaLoginRes.status === 200, 'Shared PG MFA login: challenge response');
    const mfaLoginBody = await mfaLoginRes.json() as any;
    ok(mfaLoginBody.mfaRequired === true, 'Shared PG MFA login: mfaRequired');
    ok(!existsSync(accountUserTokenStorePath), 'Shared PG MFA login: no local action token store created');

    const mfaVerifyRes = await fetch(`${base}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: mfaLoginBody.challengeToken,
        code: generateCurrentTotpCode(mfaEnrollBody.enrollment.secretBase32),
      }),
    });
    ok(mfaVerifyRes.status === 200, 'Shared PG MFA verify: 200');
    accountSessionCookie = mfaVerifyRes.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
    ok(Boolean(accountSessionCookie), 'Shared PG MFA verify: session cookie returned');

    const inviteRes = await fetch(`${base}/api/v1/account/users/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: accountSessionCookie!,
      },
      body: JSON.stringify({
        email: 'invitee@pg-hosted.example',
        displayName: 'PG Invitee',
        role: 'read_only',
      }),
    });
    ok(inviteRes.status === 201, 'Account invite via shared PG: 201');
    const inviteBody = await inviteRes.json() as any;
    ok(inviteBody.invite.status === 'pending', 'Account invite via shared PG: pending');
    ok(!existsSync(accountUserTokenStorePath), 'Shared PG: invite does not create local token store file');

    const acceptInviteRes = await fetch(`${base}/api/v1/account/users/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken: inviteBody.inviteToken,
        password: 'PgInvitePass123!',
      }),
    });
    ok(acceptInviteRes.status === 201, 'Account invite accept via shared PG: 201');
    const acceptInviteBody = await acceptInviteRes.json() as any;
    ok(acceptInviteBody.user.email === 'invitee@pg-hosted.example', 'Account invite accept via shared PG: user created');

    const sessionAccountRes = await fetch(`${base}/api/v1/account`, {
      headers: { Cookie: accountSessionCookie! },
    });
    ok(sessionAccountRes.status === 200, 'Account summary via shared PG session: 200');
    const sessionAccountBody = await sessionAccountRes.json() as any;
    ok(sessionAccountBody.tenantContext.source === 'account_session', 'Account summary via shared PG session: source=account_session');

    const pipelineRes = await fetch(`${base}/api/v1/pipeline/run`, {
      method: 'POST',
      headers: {
        ...tenantAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        candidateSql: COUNTERPARTY_SQL,
        intent: COUNTERPARTY_INTENT,
        fixtures: [COUNTERPARTY_FIXTURE],
        generatedReport: COUNTERPARTY_REPORT,
        reportContract: COUNTERPARTY_REPORT_CONTRACT,
      }),
    });
    ok(pipelineRes.status === 200, 'Pipeline run via shared PG tenant: 200');
    const pipelineBody = await pipelineRes.json() as any;
    ok(pipelineBody.tenantContext.tenantId === 'tenant-pg-live', 'Pipeline run: tenant context preserved');
    ok(pipelineBody.usage.used === 1, 'Pipeline run: usage increments to 1');

    const usageRes = await fetch(`${base}/api/v1/account/usage`, { headers: tenantAuth });
    ok(usageRes.status === 200, 'Tenant usage summary: 200');
    const usageBody = await usageRes.json() as any;
    ok(usageBody.usage.used === 1, 'Tenant usage summary: PG-backed usage persisted');

    const adminUsageRes = await fetch(`${base}/api/v1/admin/usage?tenantId=tenant-pg-live`, {
      headers: { Authorization: 'Bearer admin-shared-control-plane' },
    });
    ok(adminUsageRes.status === 200, 'Admin usage: 200');
    const adminUsageBody = await adminUsageRes.json() as any;
    ok(adminUsageBody.records.length === 1, 'Admin usage: one tenant usage record');
    ok(adminUsageBody.records[0].accountName === 'PG Hosted Co', 'Admin usage: account enrichment resolved');

    const rotateRes = await fetch(`${base}/api/v1/admin/tenant-keys/${createAccountBody.initialKey.id}/rotate`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-shared-control-plane',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'shared-control-plane-rotate-1',
      },
      body: JSON.stringify({ planId: 'pro' }),
    });
    ok(rotateRes.status === 201, 'Tenant key rotate: 201');
    const rotateBody = await rotateRes.json() as any;
    const replacementAuth = { Authorization: `Bearer ${rotateBody.newKey.apiKey}` };

    const overlapOldRes = await fetch(`${base}/api/v1/account/usage`, { headers: tenantAuth });
    const overlapNewRes = await fetch(`${base}/api/v1/account/usage`, { headers: replacementAuth });
    ok(overlapOldRes.status === 200, 'Old key still works during overlap');
    ok(overlapNewRes.status === 200, 'Replacement key works during overlap');

    const sessionAccountAfterRotateRes = await fetch(`${base}/api/v1/account`, {
      headers: { Cookie: accountSessionCookie! },
    });
    ok(sessionAccountAfterRotateRes.status === 200, 'Account summary reflects rotated tenant key plan');
    const sessionAccountAfterRotateBody = await sessionAccountAfterRotateRes.json() as any;
    ok(sessionAccountAfterRotateBody.tenantContext.planId === 'pro', 'Account summary picks up rotated tenant plan');
    ok(sessionAccountAfterRotateBody.entitlement.effectivePlanId === 'pro', 'Entitlement sync follows rotated tenant plan');

    const deactivateRes = await fetch(`${base}/api/v1/admin/tenant-keys/${createAccountBody.initialKey.id}/deactivate`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-shared-control-plane',
        'Idempotency-Key': 'shared-control-plane-deactivate-1',
      },
    });
    ok(deactivateRes.status === 200, 'Tenant key deactivate: 200');

    const deactivatedOldRes = await fetch(`${base}/api/v1/account/usage`, { headers: tenantAuth });
    ok(deactivatedOldRes.status === 401, 'Old key blocked after deactivate');

    const suspendRes = await fetch(`${base}/api/v1/admin/accounts/${createAccountBody.account.id}/suspend`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-shared-control-plane',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'shared-control-plane-suspend-1',
      },
      body: JSON.stringify({ reason: 'delinquent' }),
    });
    ok(suspendRes.status === 200, 'Suspend account: 200');

    const suspendedUsageRes = await fetch(`${base}/api/v1/account/usage`, { headers: replacementAuth });
    ok(suspendedUsageRes.status === 403, 'Suspended account blocked on tenant usage route');

    const reactivateRes = await fetch(`${base}/api/v1/admin/accounts/${createAccountBody.account.id}/reactivate`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-shared-control-plane',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'shared-control-plane-reactivate-1',
      },
      body: JSON.stringify({ reason: 'paid' }),
    });
    ok(reactivateRes.status === 200, 'Reactivate account: 200');

    const reactivatedUsageRes = await fetch(`${base}/api/v1/account/usage`, { headers: replacementAuth });
    ok(reactivatedUsageRes.status === 200, 'Reactivated account usable again');

    const staleSessionAfterSuspendRes = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Cookie: accountSessionCookie! },
    });
    ok(staleSessionAfterSuspendRes.status === 401, 'Suspended account invalidates existing shared PG session');

    const reLoginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@pg-hosted.example',
        password: 'PgOwnerPass123!',
      }),
    });
    ok(reLoginRes.status === 200, 'Shared PG account can re-login after reactivate');
    const reLoginBody = await reLoginRes.json() as any;
    ok(reLoginBody.mfaRequired === true, 'Shared PG re-login still enforces MFA');

    const reLoginVerifyRes = await fetch(`${base}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: reLoginBody.challengeToken,
        code: generateCurrentTotpCode(mfaEnrollBody.enrollment.secretBase32),
      }),
    });
    ok(reLoginVerifyRes.status === 200, 'Shared PG re-login MFA verify: 200');
    accountSessionCookie = reLoginVerifyRes.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
    ok(Boolean(accountSessionCookie), 'Shared PG re-login returns fresh session cookie after MFA verify');

    const failedAsyncRes = await fetch(`${base}/api/v1/pipeline/run-async`, {
      method: 'POST',
      headers: {
        ...replacementAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        candidateSql: 123,
        intent: 'bad-intent',
      }),
    });
    ok(failedAsyncRes.status === 202, 'Shared PG async failure proof: queued for worker validation');
    const failedAsyncBody = await failedAsyncRes.json() as any;
    const failedAsyncStatus = await waitForJobStatus(
      base,
      failedAsyncBody.jobId,
      'failed',
      6000,
      replacementAuth,
    );
    ok(failedAsyncStatus.tenantContext?.tenantId === 'tenant-pg-live', 'Shared PG async failure proof: tenant context preserved');
    const sharedDlqRes = await fetch(`${base}/api/v1/admin/queue/dlq?tenantId=tenant-pg-live&limit=10`, {
      headers: { Authorization: 'Bearer admin-shared-control-plane' },
    });
    ok(sharedDlqRes.status === 200, 'Shared PG async DLQ: admin route readable');
    const sharedDlqBody = await sharedDlqRes.json() as any;
    const sharedDlqRecord = sharedDlqBody.records.find((record: any) => record.jobId === failedAsyncBody.jobId);
    ok(Boolean(sharedDlqRecord), 'Shared PG async DLQ: failed job persisted');
    ok(sharedDlqRecord.backendMode === 'bullmq', 'Shared PG async DLQ: backend mode truthful');
    ok(!existsSync(asyncDlqPath), 'Shared PG async DLQ: no local file created after failure');

    const checkoutRes = await fetch(`${base}/api/v1/account/billing/checkout`, {
      method: 'POST',
      headers: {
        Cookie: accountSessionCookie!,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'shared-control-plane-checkout-1',
      },
      body: JSON.stringify({ planId: 'pro' }),
    });
    ok(checkoutRes.status === 200, 'Billing checkout via shared PG session: 200');
    const checkoutBody = await checkoutRes.json() as any;
    ok(checkoutBody.planId === 'pro', 'Billing checkout via shared PG session: plan echoed');

    const listAccountsRes = await fetch(`${base}/api/v1/admin/accounts`, {
      headers: { Authorization: 'Bearer admin-shared-control-plane' },
    });
    const listKeysRes = await fetch(`${base}/api/v1/admin/tenant-keys`, {
      headers: { Authorization: 'Bearer admin-shared-control-plane' },
    });
    ok(listAccountsRes.status === 200, 'Admin accounts list: 200');
    ok(listKeysRes.status === 200, 'Admin tenant keys list: 200');
    const listAccountsBody = await listAccountsRes.json() as any;
    const listKeysBody = await listKeysRes.json() as any;
    ok(listAccountsBody.accounts.length === 1, 'Admin accounts list: shared PG account visible');
    ok(listKeysBody.keys.length === 2, 'Admin tenant keys list: overlap lifecycle preserved');

    const attachBillingRes = await fetch(`${base}/api/v1/admin/accounts/${createAccountBody.account.id}/billing/stripe`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-shared-control-plane',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'shared-control-plane-attach-billing-1',
      },
      body: JSON.stringify({
        stripeCustomerId: 'cus_pg_live_001',
        stripeSubscriptionId: 'sub_pg_live_001',
        stripeSubscriptionStatus: 'active',
        stripePriceId: 'price_pro_monthly',
      }),
    });
    ok(attachBillingRes.status === 200, 'Attach Stripe billing: 200');

    const sharedClaimPayload = '{"id":"evt_pg_live_claim_1"}';
    const firstClaim = await claimProcessedStripeWebhookState({
      eventId: 'evt_pg_live_claim_1',
      eventType: 'invoice.paid',
      rawPayload: sharedClaimPayload,
    });
    ok(firstClaim.kind === 'claimed', 'Shared PG webhook claim: first claim created pending row');
    if (firstClaim.kind !== 'claimed') throw new Error('Expected first Stripe webhook claim to succeed.');
    const secondClaimPromise = claimProcessedStripeWebhookState({
      eventId: 'evt_pg_live_claim_1',
      eventType: 'invoice.paid',
      rawPayload: sharedClaimPayload,
    });
    const secondClaimWhileHeld = await Promise.race([
      secondClaimPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 75)),
    ]);
    ok(secondClaimWhileHeld === 'pending', 'Shared PG webhook claim: second claim waits while advisory lock is held');
    const finalizedClaim = await finalizeProcessedStripeWebhookState({
      claimId: firstClaim.claimId,
      eventId: 'evt_pg_live_claim_1',
      eventType: 'invoice.paid',
      accountId: createAccountBody.account.id,
      stripeCustomerId: 'cus_pg_live_001',
      stripeSubscriptionId: 'sub_pg_live_001',
      outcome: 'applied',
      reason: null,
      rawPayload: sharedClaimPayload,
    });
    ok(finalizedClaim.record.outcome === 'applied', 'Shared PG webhook claim: finalize persists final outcome');
    const secondClaim = await secondClaimPromise;
    ok(secondClaim.kind === 'duplicate', 'Shared PG webhook claim: duplicate sees finalized row after lock release');

    const releasedClaim = await claimProcessedStripeWebhookState({
      eventId: 'evt_pg_live_claim_release',
      eventType: 'invoice.payment_failed',
      rawPayload: '{"id":"evt_pg_live_claim_release"}',
    });
    ok(releasedClaim.kind === 'claimed', 'Shared PG webhook claim: second pending claim created');
    if (releasedClaim.kind !== 'claimed') throw new Error('Expected releasable Stripe webhook claim to succeed.');
    await releaseProcessedStripeWebhookClaimState('evt_pg_live_claim_release', releasedClaim.claimId);
    const reclaimedClaim = await claimProcessedStripeWebhookState({
      eventId: 'evt_pg_live_claim_release',
      eventType: 'invoice.payment_failed',
      rawPayload: '{"id":"evt_pg_live_claim_release"}',
    });
    ok(reclaimedClaim.kind === 'claimed', 'Shared PG webhook claim: released pending row can be claimed again');
    if (reclaimedClaim.kind !== 'claimed') throw new Error('Expected reclaimed Stripe webhook claim to succeed.');
    await finalizeProcessedStripeWebhookState({
      claimId: reclaimedClaim.claimId,
      eventId: 'evt_pg_live_claim_release',
      eventType: 'invoice.payment_failed',
      accountId: createAccountBody.account.id,
      stripeCustomerId: 'cus_pg_live_001',
      stripeSubscriptionId: 'sub_pg_live_001',
      outcome: 'ignored',
      reason: 'manual_release_test',
      rawPayload: '{"id":"evt_pg_live_claim_release"}',
    });

    const subscriptionPayload = JSON.stringify({
      id: 'evt_pg_live_sub_1',
      object: 'event',
      type: 'customer.subscription.updated',
      created: 1712553600,
      data: {
        object: {
          id: 'sub_pg_live_001',
          object: 'subscription',
          customer: 'cus_pg_live_001',
          status: 'past_due',
          metadata: {
            attestorAccountId: createAccountBody.account.id,
          },
          items: {
            data: [
              {
                price: {
                  id: 'price_pro_monthly',
                },
              },
            ],
          },
        },
      },
    });
    const subscriptionSignature = stripe.webhooks.generateTestHeaderString({
      payload: subscriptionPayload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });
    const webhookRes = await fetch(`${base}/api/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': subscriptionSignature,
      },
      body: subscriptionPayload,
    });
    ok(webhookRes.status === 200, 'Shared PG webhook: first delivery accepted');
    const webhookReplayRes = await fetch(`${base}/api/v1/billing/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': subscriptionSignature,
      },
      body: subscriptionPayload,
    });
    ok(webhookReplayRes.status === 200, 'Shared PG webhook: duplicate delivery preserved');
    ok(webhookReplayRes.headers.get('x-attestor-stripe-replay') === 'true', 'Shared PG webhook: duplicate replay header set');
    ok(!existsSync(stripeWebhookPath), 'Shared PG: no local Stripe webhook dedupe file created');
    ok(!existsSync(billingEntitlementPath), 'Shared PG: webhook lifecycle still avoids local entitlement file');

    const entitlementAfterWebhookRes = await fetch(`${base}/api/v1/account/entitlement`, {
      headers: { Authorization: `Bearer ${rotateBody.newKey.apiKey}` },
    });
    ok(entitlementAfterWebhookRes.status === 403, 'Shared PG entitlement route respects suspended account state');

    const adminEntitlementsRes = await fetch(`${base}/api/v1/admin/billing/entitlements?accountId=${createAccountBody.account.id}`, {
      headers: { Authorization: 'Bearer admin-shared-control-plane' },
    });
    ok(adminEntitlementsRes.status === 200, 'Admin billing entitlements via shared PG: 200');
    const adminEntitlementsBody = await adminEntitlementsRes.json() as any;
    ok(adminEntitlementsBody.summary.recordCount === 1, 'Admin billing entitlements via shared PG: one record');
    ok(adminEntitlementsBody.records[0].status === 'delinquent', 'Admin billing entitlements via shared PG: delinquent status reflected');
    ok(adminEntitlementsBody.records[0].provider === 'stripe', 'Admin billing entitlements via shared PG: provider switched to stripe');

    console.log(`  Shared control-plane PG tests: ${passed} passed, 0 failed\n`);
  } finally {
    server.close();
    await resetSharedControlPlaneStoreForTests();
    await resetTenantRateLimiterForTests();
    resetAdminAuditLogForTests();
    resetAdminIdempotencyStoreForTests();
    resetStripeWebhookStoreForTests();
    resetHostedBillingEntitlementStoreForTests();
    resetObservabilityForTests();
    await resetBillingEventLedgerForTests();
    try { await pg.stop(); } catch {}
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    delete process.env.ATTESTOR_CONTROL_PLANE_PG_URL;
  }
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Live shared control-plane PG test failed:', err);
  process.exit(1);
});
