import { createHmac } from 'node:crypto';
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
      for (const socket of sockets) socket.destroy();
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

function normalizeEmailPayload(rawEmail: string): string {
  return rawEmail.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
}

function normalizeSmtpHeaders(rawEmail: string): string {
  return normalizeEmailPayload(rawEmail).replace(/\r?\n[ \t]+/g, ' ');
}

function signMailgunWebhook(signingKey: string, timestamp: string, token: string): string {
  return createHmac('sha256', signingKey)
    .update(`${timestamp}${token}`, 'utf8')
    .digest('hex');
}

async function main(): Promise<void> {
  const previousEnv = { ...process.env };
  const workspace = mkdtempSync(join(tmpdir(), 'attestor-live-email-mailgun-'));
  const messages: string[] = [];
  const apiPort = await reservePort();
  const smtpPort = await reservePort();
  const smtpServer = createFakeSmtpServer(messages);
  const mailgunSigningKey = 'mailgun-signing-secret';

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
    process.env.STRIPE_API_KEY = 'sk_test_email_mailgun_mock';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_email_mailgun';
    process.env.ATTESTOR_EMAIL_DELIVERY_MODE = 'smtp';
    process.env.ATTESTOR_EMAIL_PROVIDER = 'mailgun_smtp';
    process.env.ATTESTOR_EMAIL_FROM = 'Attestor <noreply@attestor.dev>';
    process.env.ATTESTOR_SMTP_HOST = '127.0.0.1';
    process.env.ATTESTOR_SMTP_PORT = String(smtpPort);
    process.env.ATTESTOR_SMTP_IGNORE_TLS = 'true';
    process.env.ATTESTOR_ACCOUNT_INVITE_BASE_URL = 'https://attestor.dev/invite';
    process.env.ATTESTOR_MAILGUN_WEBHOOK_SIGNING_KEY = mailgunSigningKey;
    process.env.ATTESTOR_MAILGUN_WEBHOOK_MAX_AGE_SECONDS = '300';

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

    console.log('\n[Live Account Email Mailgun Webhook]');

    const createAccountRes = await fetch(`${base}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-secret',
        'Idempotency-Key': 'idem-email-mailgun-account-1',
      },
      body: JSON.stringify({
        accountName: 'Mailgun Co',
        contactEmail: 'ops@mailgun.example',
        tenantId: 'tenant-mailgun',
        tenantName: 'Mailgun Tenant',
        planId: 'starter',
      }),
    });
    ok(createAccountRes.status === 201, 'Mailgun Webhook: account create status 201');
    const createAccountBody = await createAccountRes.json() as any;
    const initialApiKey = createAccountBody.initialKey.apiKey as string;

    const bootstrapRes = await fetch(`${base}/api/v1/account/users/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${initialApiKey}`,
      },
      body: JSON.stringify({
        email: 'owner@mailgun.example',
        displayName: 'Mailgun Owner',
        password: 'BootstrapPass123!',
      }),
    });
    ok(bootstrapRes.status === 201, 'Mailgun Webhook: bootstrap status 201');

    const loginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@mailgun.example',
        password: 'BootstrapPass123!',
      }),
    });
    ok(loginRes.status === 200, 'Mailgun Webhook: login status 200');
    const accountAdminCookie = cookieHeaderFromResponse(loginRes);
    ok(Boolean(accountAdminCookie), 'Mailgun Webhook: login issues session cookie');

    const telemetryRes = await fetch(`${base}/api/v1/admin/telemetry`, {
      headers: { Authorization: 'Bearer admin-secret' },
    });
    ok(telemetryRes.status === 200, 'Mailgun Webhook: admin telemetry status 200');
    const telemetryBody = await telemetryRes.json() as any;
    ok(telemetryBody.emailDelivery.provider === 'mailgun_smtp', 'Mailgun Webhook: telemetry reports Mailgun SMTP provider');
    ok(telemetryBody.emailDelivery.analytics.mailgunWebhook.configured === true, 'Mailgun Webhook: telemetry reports Mailgun webhook configured');

    const inviteRes = await fetch(`${base}/api/v1/account/users/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: accountAdminCookie!,
      },
      body: JSON.stringify({
        email: 'invitee@mailgun.example',
        displayName: 'Invitee',
        role: 'read_only',
      }),
    });
    ok(inviteRes.status === 201, 'Mailgun Webhook: invite status 201');
    const inviteBody = await inviteRes.json() as any;
    ok(inviteBody.delivery.provider === 'mailgun_smtp', 'Mailgun Webhook: invite response reports Mailgun provider');
    ok(typeof inviteBody.delivery.deliveryId === 'string' && inviteBody.delivery.deliveryId.startsWith('edlv_'), 'Mailgun Webhook: invite response includes delivery id');
    const deliveryId = inviteBody.delivery.deliveryId as string;

    const rawInviteEmail = await waitForMessage(messages, 1);
    const normalizedInviteEmail = normalizeSmtpHeaders(rawInviteEmail);
    ok(/x-attestor-delivery-id:\s+/i.test(normalizedInviteEmail), 'Mailgun Webhook: SMTP payload includes Attestor delivery header');
    ok(normalizedInviteEmail.includes(deliveryId), 'Mailgun Webhook: SMTP payload includes issued delivery id');
    ok(/x-mailgun-variables:\s+/i.test(normalizedInviteEmail), 'Mailgun Webhook: SMTP payload includes Mailgun variables header');
    ok(normalizedInviteEmail.includes('attestor_delivery_id'), 'Mailgun Webhook: SMTP payload includes Mailgun delivery variables');

    const accountDeliveriesBeforeRes = await fetch(`${base}/api/v1/account/email/deliveries`, {
      headers: { Cookie: accountAdminCookie! },
    });
    ok(accountDeliveriesBeforeRes.status === 200, 'Mailgun Webhook: account deliveries route status 200');
    const accountDeliveriesBefore = await accountDeliveriesBeforeRes.json() as any;
    ok(accountDeliveriesBefore.records.length === 1, 'Mailgun Webhook: account deliveries include invite dispatch');
    ok(accountDeliveriesBefore.records[0].status === 'smtp_sent', 'Mailgun Webhook: initial delivery status is smtp_sent');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'mailgun-token-1';
    const deliveredPayload = {
      signature: {
        timestamp,
        token,
        signature: signMailgunWebhook(mailgunSigningKey, timestamp, token),
      },
      'event-data': {
        id: 'mailgun_evt_delivered_1',
        event: 'delivered',
        recipient: 'invitee@mailgun.example',
        timestamp: Number(timestamp),
        severity: 'permanent',
        'user-variables': {
          attestor_delivery_id: deliveryId,
          attestor_delivery_purpose: 'invite',
        },
        message: {
          headers: {
            'message-id': '<mailgun-msg-1@example.invalid>',
          },
        },
      },
    };

    const deliveredRes = await fetch(`${base}/api/v1/email/mailgun/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deliveredPayload),
    });
    ok(deliveredRes.status === 200, 'Mailgun Webhook: delivered event accepted');
    const deliveredBody = await deliveredRes.json() as any;
    ok(deliveredBody.applied === 1 && deliveredBody.duplicate === 0, 'Mailgun Webhook: first delivered event is applied once');

    const duplicateDeliveredRes = await fetch(`${base}/api/v1/email/mailgun/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deliveredPayload),
    });
    ok(duplicateDeliveredRes.status === 200, 'Mailgun Webhook: duplicate delivered event still returns 200');
    const duplicateDeliveredBody = await duplicateDeliveredRes.json() as any;
    ok(duplicateDeliveredBody.duplicate === 1, 'Mailgun Webhook: duplicate delivered event is suppressed');

    const openTimestamp = String(Number(timestamp) + 2);
    const openToken = 'mailgun-token-2';
    const openRes = await fetch(`${base}/api/v1/email/mailgun/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature: {
          timestamp: openTimestamp,
          token: openToken,
          signature: signMailgunWebhook(mailgunSigningKey, openTimestamp, openToken),
        },
        'event-data': {
          id: 'mailgun_evt_open_1',
          event: 'opened',
          recipient: 'invitee@mailgun.example',
          timestamp: Number(openTimestamp),
          'user-variables': {
            attestor_delivery_id: deliveryId,
            attestor_delivery_purpose: 'invite',
          },
          message: {
            headers: {
              'message-id': '<mailgun-msg-1@example.invalid>',
            },
          },
        },
      }),
    });
    ok(openRes.status === 200, 'Mailgun Webhook: open event accepted');

    const clickTimestamp = String(Number(timestamp) + 3);
    const clickToken = 'mailgun-token-3';
    const clickRes = await fetch(`${base}/api/v1/email/mailgun/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature: {
          timestamp: clickTimestamp,
          token: clickToken,
          signature: signMailgunWebhook(mailgunSigningKey, clickTimestamp, clickToken),
        },
        'event-data': {
          id: 'mailgun_evt_click_1',
          event: 'clicked',
          recipient: 'invitee@mailgun.example',
          timestamp: Number(clickTimestamp),
          'user-variables': {
            attestor_delivery_id: deliveryId,
            attestor_delivery_purpose: 'invite',
          },
          message: {
            headers: {
              'message-id': '<mailgun-msg-1@example.invalid>',
            },
          },
        },
      }),
    });
    ok(clickRes.status === 200, 'Mailgun Webhook: click event accepted');

    const accountDeliveriesAfterRes = await fetch(`${base}/api/v1/account/email/deliveries`, {
      headers: { Cookie: accountAdminCookie! },
    });
    ok(accountDeliveriesAfterRes.status === 200, 'Mailgun Webhook: account deliveries remain readable after webhook');
    const accountDeliveriesAfter = await accountDeliveriesAfterRes.json() as any;
    ok(accountDeliveriesAfter.records[0].status === 'delivered', 'Mailgun Webhook: delivery status progresses to delivered');
    ok(accountDeliveriesAfter.records[0].opened === true, 'Mailgun Webhook: open event is reflected in account analytics');
    ok(accountDeliveriesAfter.records[0].clicked === true, 'Mailgun Webhook: click event is reflected in account analytics');
    ok(accountDeliveriesAfter.records[0].eventCount === 4, 'Mailgun Webhook: dispatch + provider events are counted together');
    ok(accountDeliveriesAfter.records[0].providerMessageId === '<mailgun-msg-1@example.invalid>', 'Mailgun Webhook: provider message id captured');

    const adminDeliveriesRes = await fetch(`${base}/api/v1/admin/email/deliveries?provider=mailgun_smtp&accountId=${encodeURIComponent(createAccountBody.account.id)}`, {
      headers: { Authorization: 'Bearer admin-secret' },
    });
    ok(adminDeliveriesRes.status === 200, 'Mailgun Webhook: admin deliveries route status 200');
    const adminDeliveries = await adminDeliveriesRes.json() as any;
    ok(adminDeliveries.summary.accountFilter === createAccountBody.account.id, 'Mailgun Webhook: admin filter echoed');
    ok(adminDeliveries.summary.providerFilter === 'mailgun_smtp', 'Mailgun Webhook: provider filter echoed');
    ok(adminDeliveries.records.length === 1, 'Mailgun Webhook: admin deliveries return the correlated record');

    console.log(`  Live account email Mailgun webhook tests: ${passed} passed, 0 failed`);
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
    console.error('\nLive account email Mailgun webhook tests failed.');
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
