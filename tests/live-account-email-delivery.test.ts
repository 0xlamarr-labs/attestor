import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer, type Socket } from 'node:net';
import { startServer } from '../src/service/api-server.js';
import { resetTenantKeyStoreForTests } from '../src/service/tenant-key-store.js';
import { resetUsageMeter } from '../src/service/usage-meter.js';
import { resetTenantRateLimiterForTests } from '../src/service/rate-limit.js';
import { resetAccountStoreForTests } from '../src/service/account-store.js';
import { resetAccountUserStoreForTests } from '../src/service/account-user-store.js';
import { resetAccountUserActionTokenStoreForTests } from '../src/service/account-user-token-store.js';
import { resetAccountSessionStoreForTests } from '../src/service/account-session-store.js';
import { resetAdminAuditLogForTests } from '../src/service/admin-audit-log.js';
import { resetAdminIdempotencyStoreForTests } from '../src/service/admin-idempotency-store.js';
import { resetAsyncDeadLetterStoreForTests } from '../src/service/async-dead-letter-store.js';
import { resetStripeWebhookStoreForTests } from '../src/service/stripe-webhook-store.js';
import { resetBillingEventLedgerForTests } from '../src/service/billing-event-ledger.js';
import { resetHostedBillingEntitlementStoreForTests } from '../src/service/billing-entitlement-store.js';
import { resetObservabilityForTests } from '../src/service/observability.js';
import { resetHostedEmailDeliveryForTests, shutdownHostedEmailDelivery } from '../src/service/email-delivery.js';
import { resetHostedEmailDeliveryEventStoreForTests } from '../src/service/email-delivery-event-store.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
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

function createFakeSmtpServer(messages: string[]) {
  const sockets = new Set<Socket>();
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.unref();
    socket.setEncoding('utf8');
    let buffer = '';
    let dataMode = false;
    let dataBuffer = '';

    socket.write('220 attestor.test ESMTP\r\n');

    socket.on('data', (chunk: string | Buffer) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      while (true) {
        if (dataMode) {
          const terminatorIndex = buffer.indexOf('\r\n.\r\n');
          if (terminatorIndex === -1) break;
          dataBuffer += buffer.slice(0, terminatorIndex);
          buffer = buffer.slice(terminatorIndex + 5);
          messages.push(dataBuffer);
          dataBuffer = '';
          dataMode = false;
          socket.write('250 Message accepted\r\n');
          continue;
        }

        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd === -1) break;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-attestor.test\r\n250 OK\r\n');
          continue;
        }
        if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO') || upper.startsWith('RSET') || upper.startsWith('NOOP')) {
          socket.write('250 OK\r\n');
          continue;
        }
        if (upper.startsWith('DATA')) {
          dataMode = true;
          dataBuffer = '';
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          continue;
        }
        if (upper.startsWith('QUIT')) {
          socket.write('221 Bye\r\n');
          socket.end();
          continue;
        }
        socket.write('250 OK\r\n');
      }
    });

    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  return {
    server,
    async listen(port: number): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });
      server.unref();
    },
    async close(): Promise<void> {
      for (const socket of sockets) {
        socket.destroy();
      }
      await Promise.race([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 100)),
      ]);
    },
  };
}

function cookieHeaderFromResponse(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  const [cookiePair] = raw.split(';', 1);
  return cookiePair?.trim() || null;
}

function normalizeEmailPayload(rawEmail: string): string {
  return rawEmail.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
}

function extractOpaqueToken(rawEmail: string): string {
  const normalized = normalizeEmailPayload(rawEmail);
  const match = normalized.match(/atok_[0-9a-f]{64}/);
  if (!match) {
    throw new Error(`Expected opaque action token in SMTP payload.\n${rawEmail}`);
  }
  return match[0];
}

function extractActionUrl(rawEmail: string): string | null {
  const normalized = normalizeEmailPayload(rawEmail);
  const match = normalized.match(/https:\/\/attestor\.dev\/(?:invite|reset)\?token=atok_[0-9a-f]{64}/);
  return match ? match[0] : null;
}

async function waitForMessage(messages: string[], expectedCount: number, timeoutMs = 5000): Promise<string> {
  const started = Date.now();
  while (messages.length < expectedCount) {
    if ((Date.now() - started) > timeoutMs) {
      throw new Error(`Timed out waiting for SMTP message ${expectedCount}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return messages[expectedCount - 1]!;
}

async function main(): Promise<void> {
  const previousEnv = { ...process.env };
  const workspace = mkdtempSync(join(tmpdir(), 'attestor-live-email-'));
  const messages: string[] = [];
  const apiPort = await reservePort();
  const smtpPort = await reservePort();

  const smtpServer = createFakeSmtpServer(messages);

  let serverHandle: { close: () => void } | null = null;

  try {
    mkdirSync(join(workspace, '.attestor'), { recursive: true });
    await smtpServer.listen(smtpPort);

    process.env.ATTESTOR_TENANT_KEY_STORE_PATH = join(workspace, '.attestor', 'tenant-keys.json');
    process.env.ATTESTOR_USAGE_LEDGER_PATH = join(workspace, '.attestor', 'usage-ledger.json');
    process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(workspace, '.attestor', 'accounts.json');
    process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH = join(workspace, '.attestor', 'account-users.json');
    process.env.ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH = join(workspace, '.attestor', 'account-user-tokens.json');
    process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH = join(workspace, '.attestor', 'account-sessions.json');
    process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(workspace, '.attestor', 'admin-audit.json');
    process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(workspace, '.attestor', 'admin-idempotency.json');
    process.env.ATTESTOR_ASYNC_DLQ_STORE_PATH = join(workspace, '.attestor', 'async-dlq.json');
    process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(workspace, '.attestor', 'stripe-webhooks.json');
    process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH = join(workspace, '.attestor', 'billing-entitlements.json');
    process.env.ATTESTOR_EMAIL_DELIVERY_EVENTS_PATH = join(workspace, '.attestor', 'email-delivery-events.json');
    process.env.ATTESTOR_OBSERVABILITY_LOG_PATH = join(workspace, '.attestor', 'observability.jsonl');
    process.env.ATTESTOR_SESSION_COOKIE_SECURE = 'false';
    process.env.ATTESTOR_ADMIN_API_KEY = 'admin-secret';
    process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
    process.env.STRIPE_API_KEY = 'sk_test_email_delivery_mock';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_email_delivery';
    process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.dev/billing/success';
    process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.dev/billing/cancel';
    process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://attestor.dev/app';
    process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_monthly';
    process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_monthly';
    process.env.ATTESTOR_EMAIL_DELIVERY_MODE = 'smtp';
    process.env.ATTESTOR_EMAIL_PROVIDER = 'smtp';
    process.env.ATTESTOR_EMAIL_FROM = 'Attestor <noreply@attestor.dev>';
    process.env.ATTESTOR_SMTP_HOST = '127.0.0.1';
    process.env.ATTESTOR_SMTP_PORT = String(smtpPort);
    process.env.ATTESTOR_SMTP_IGNORE_TLS = 'true';
    process.env.ATTESTOR_ACCOUNT_INVITE_BASE_URL = 'https://attestor.dev/invite';
    process.env.ATTESTOR_PASSWORD_RESET_BASE_URL = 'https://attestor.dev/reset';

    resetTenantKeyStoreForTests();
    resetUsageMeter();
    await resetTenantRateLimiterForTests();
    resetAccountStoreForTests();
    resetAccountUserStoreForTests();
    resetAccountUserActionTokenStoreForTests();
    resetAccountSessionStoreForTests();
    resetAdminAuditLogForTests();
    resetAdminIdempotencyStoreForTests();
    resetAsyncDeadLetterStoreForTests();
    resetStripeWebhookStoreForTests();
    resetHostedBillingEntitlementStoreForTests();
    await resetBillingEventLedgerForTests();
    resetObservabilityForTests();
    resetHostedEmailDeliveryForTests();
    resetHostedEmailDeliveryEventStoreForTests();

    const base = `http://127.0.0.1:${apiPort}`;
    serverHandle = startServer(apiPort);
    await new Promise((resolve) => setTimeout(resolve, 400));

    console.log('\n[Live Account Email Delivery]');

    const createAccountRes = await fetch(`${base}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-secret',
        'Idempotency-Key': 'idem-email-account-1',
      },
      body: JSON.stringify({
        accountName: 'Email Co',
        contactEmail: 'ops@email.example',
        tenantId: 'tenant-email',
        tenantName: 'Email Tenant',
        planId: 'starter',
      }),
    });
    ok(createAccountRes.status === 201, 'Email Delivery: admin account create status 201');
    const createAccountBody = await createAccountRes.json() as any;
    const initialApiKey = createAccountBody.initialKey.apiKey as string;
    ok(typeof initialApiKey === 'string' && initialApiKey.length > 10, 'Email Delivery: initial tenant key returned');

    const bootstrapRes = await fetch(`${base}/api/v1/account/users/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${initialApiKey}`,
      },
      body: JSON.stringify({
        email: 'owner@email.example',
        displayName: 'Owner Admin',
        password: 'BootstrapPass123!',
      }),
    });
    ok(bootstrapRes.status === 201, 'Email Delivery: bootstrap status 201');

    const loginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@email.example',
        password: 'BootstrapPass123!',
      }),
    });
    ok(loginRes.status === 200, 'Email Delivery: login status 200');
    const accountAdminCookie = cookieHeaderFromResponse(loginRes);
    ok(Boolean(accountAdminCookie), 'Email Delivery: login issues session cookie');

    const telemetryRes = await fetch(`${base}/api/v1/admin/telemetry`, {
      headers: { Authorization: 'Bearer admin-secret' },
    });
    ok(telemetryRes.status === 200, 'Email Delivery: admin telemetry status 200');
    const telemetryBody = await telemetryRes.json() as any;
    ok(telemetryBody.emailDelivery.mode === 'smtp', 'Email Delivery: telemetry reports smtp mode');
    ok(telemetryBody.emailDelivery.configured === true, 'Email Delivery: telemetry reports configured delivery');

    const inviteRes = await fetch(`${base}/api/v1/account/users/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: accountAdminCookie!,
      },
      body: JSON.stringify({
        email: 'invitee@email.example',
        displayName: 'Invited User',
        role: 'read_only',
      }),
    });
    ok(inviteRes.status === 201, 'Email Delivery: invite status 201');
    const inviteBody = await inviteRes.json() as any;
    ok(inviteBody.delivery.mode === 'smtp', 'Email Delivery: invite response reports smtp mode');
    ok(typeof inviteBody.delivery.deliveryId === 'string' && inviteBody.delivery.deliveryId.startsWith('edlv_'), 'Email Delivery: invite response includes delivery id');
    ok(inviteBody.delivery.tokenReturned === false, 'Email Delivery: invite response no longer returns raw token');
    ok(!('inviteToken' in inviteBody), 'Email Delivery: inviteToken omitted in smtp mode');
    ok(String(inviteBody.delivery.actionUrl).startsWith('https://attestor.dev/invite?token='), 'Email Delivery: invite action URL returned');

    const inviteEmail = await waitForMessage(messages, 1);
    const inviteToken = extractOpaqueToken(inviteEmail);
    const normalizedInviteEmail = normalizeEmailPayload(inviteEmail);
    const inviteActionUrl = extractActionUrl(inviteEmail);
    ok(inviteEmail.includes('invitee@email.example'), 'Email Delivery: invite email addressed to target user');
    ok(inviteBody.delivery.actionUrl === `https://attestor.dev/invite?token=${inviteToken}`, 'Email Delivery: invite API action URL matches token');
    ok(inviteActionUrl === `https://attestor.dev/invite?token=${inviteToken}`, `Email Delivery: invite email action URL matches token (got ${inviteActionUrl})`);
    ok(normalizedInviteEmail.includes(inviteToken), 'Email Delivery: invite email body contains the opaque token');

    const acceptInviteRes = await fetch(`${base}/api/v1/account/users/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteToken,
        password: 'InviteAccept123!',
      }),
    });
    ok(acceptInviteRes.status === 201, 'Email Delivery: invite acceptance status 201');
    const acceptInviteBody = await acceptInviteRes.json() as any;
    ok(acceptInviteBody.user.email === 'invitee@email.example', 'Email Delivery: invited user created from emailed token');

    const resetIssueRes = await fetch(`${base}/api/v1/account/users/${acceptInviteBody.user.id}/password-reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: accountAdminCookie!,
      },
      body: JSON.stringify({ ttlMinutes: 15 }),
    });
    ok(resetIssueRes.status === 201, 'Email Delivery: password reset issue status 201');
    const resetIssueBody = await resetIssueRes.json() as any;
    ok(resetIssueBody.delivery.mode === 'smtp', 'Email Delivery: reset response reports smtp mode');
    ok(typeof resetIssueBody.delivery.deliveryId === 'string' && resetIssueBody.delivery.deliveryId.startsWith('edlv_'), 'Email Delivery: reset response includes delivery id');
    ok(resetIssueBody.delivery.tokenReturned === false, 'Email Delivery: reset response omits raw token');
    ok(!('resetToken' in resetIssueBody), 'Email Delivery: resetToken omitted in smtp mode');
    ok(String(resetIssueBody.delivery.actionUrl).startsWith('https://attestor.dev/reset?token='), 'Email Delivery: reset action URL returned');

    const resetEmail = await waitForMessage(messages, 2);
    const resetToken = extractOpaqueToken(resetEmail);
    const normalizedResetEmail = normalizeEmailPayload(resetEmail);
    ok(resetEmail.includes('invitee@email.example'), 'Email Delivery: password reset email addressed to target user');
    ok(resetIssueBody.delivery.actionUrl === `https://attestor.dev/reset?token=${resetToken}`, 'Email Delivery: reset API action URL matches token');
    ok(normalizedResetEmail.includes(resetToken), 'Email Delivery: reset email body contains the opaque token');

    const resetApplyRes = await fetch(`${base}/api/v1/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resetToken,
        newPassword: 'InviteAccept456!',
      }),
    });
    ok(resetApplyRes.status === 200, 'Email Delivery: password reset apply status 200');

    const oldPasswordLoginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invitee@email.example',
        password: 'InviteAccept123!',
      }),
    });
    ok(oldPasswordLoginRes.status === 401, 'Email Delivery: old password rejected after email reset');

    const newPasswordLoginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invitee@email.example',
        password: 'InviteAccept456!',
      }),
    });
    ok(newPasswordLoginRes.status === 200, 'Email Delivery: new password accepted after email reset');

    console.log(`  Live account email delivery tests: ${passed} passed, 0 failed`);
  } finally {
    serverHandle?.close();
    shutdownHostedEmailDelivery();
    await smtpServer.close();
    Object.keys(process.env).forEach((key) => {
      if (!(key in previousEnv)) delete process.env[key];
    });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetHostedEmailDeliveryForTests();
    resetHostedEmailDeliveryEventStoreForTests();
    rmSync(workspace, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nLive account email delivery tests failed.');
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
