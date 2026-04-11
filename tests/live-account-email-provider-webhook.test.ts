import { createSign, generateKeyPairSync } from 'node:crypto';
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

function signSendGridPayload(privateKeyPem: string, rawPayload: string, timestamp: string): string {
  const signer = createSign('sha256');
  signer.update(timestamp, 'utf8');
  signer.update(rawPayload, 'utf8');
  signer.end();
  return signer.sign(privateKeyPem).toString('base64');
}

function normalizeEmailPayload(rawEmail: string): string {
  return rawEmail.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
}

function normalizeSmtpHeaders(rawEmail: string): string {
  return normalizeEmailPayload(rawEmail).replace(/\r?\n[ \t]+/g, ' ');
}

async function main(): Promise<void> {
  const previousEnv = { ...process.env };
  const workspace = mkdtempSync(join(tmpdir(), 'attestor-live-email-provider-'));
  const messages: string[] = [];
  const apiPort = await reservePort();
  const smtpPort = await reservePort();
  const smtpServer = createFakeSmtpServer(messages);
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

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
    process.env.STRIPE_API_KEY = 'sk_test_email_provider_mock';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_email_provider';
    process.env.ATTESTOR_EMAIL_DELIVERY_MODE = 'smtp';
    process.env.ATTESTOR_EMAIL_PROVIDER = 'sendgrid_smtp';
    process.env.ATTESTOR_EMAIL_FROM = 'Attestor <noreply@attestor.dev>';
    process.env.ATTESTOR_SMTP_HOST = '127.0.0.1';
    process.env.ATTESTOR_SMTP_PORT = String(smtpPort);
    process.env.ATTESTOR_SMTP_IGNORE_TLS = 'true';
    process.env.ATTESTOR_ACCOUNT_INVITE_BASE_URL = 'https://attestor.dev/invite';
    process.env.ATTESTOR_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY = publicKey;
    process.env.ATTESTOR_SENDGRID_EVENT_WEBHOOK_MAX_AGE_SECONDS = '300';

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

    console.log('\n[Live Account Email Provider Webhook]');

    const createAccountRes = await fetch(`${base}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-secret',
        'Idempotency-Key': 'idem-email-provider-account-1',
      },
      body: JSON.stringify({
        accountName: 'Provider Co',
        contactEmail: 'ops@provider.example',
        tenantId: 'tenant-provider',
        tenantName: 'Provider Tenant',
        planId: 'starter',
      }),
    });
    ok(createAccountRes.status === 201, 'Provider Webhook: account create status 201');
    const createAccountBody = await createAccountRes.json() as any;
    const initialApiKey = createAccountBody.initialKey.apiKey as string;

    const bootstrapRes = await fetch(`${base}/api/v1/account/users/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${initialApiKey}`,
      },
      body: JSON.stringify({
        email: 'owner@provider.example',
        displayName: 'Provider Owner',
        password: 'BootstrapPass123!',
      }),
    });
    ok(bootstrapRes.status === 201, 'Provider Webhook: bootstrap status 201');

    const loginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@provider.example',
        password: 'BootstrapPass123!',
      }),
    });
    ok(loginRes.status === 200, 'Provider Webhook: login status 200');
    const accountAdminCookie = cookieHeaderFromResponse(loginRes);
    ok(Boolean(accountAdminCookie), 'Provider Webhook: login issues session cookie');

    const telemetryRes = await fetch(`${base}/api/v1/admin/telemetry`, {
      headers: { Authorization: 'Bearer admin-secret' },
    });
    ok(telemetryRes.status === 200, 'Provider Webhook: admin telemetry status 200');
    const telemetryBody = await telemetryRes.json() as any;
    ok(telemetryBody.emailDelivery.provider === 'sendgrid_smtp', 'Provider Webhook: telemetry reports SendGrid SMTP provider');
    ok(telemetryBody.emailDelivery.analytics.sendGridWebhook.configured === true, 'Provider Webhook: telemetry reports SendGrid webhook configured');

    const inviteRes = await fetch(`${base}/api/v1/account/users/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: accountAdminCookie!,
      },
      body: JSON.stringify({
        email: 'invitee@provider.example',
        displayName: 'Invitee',
        role: 'read_only',
      }),
    });
    ok(inviteRes.status === 201, 'Provider Webhook: invite status 201');
    const inviteBody = await inviteRes.json() as any;
    ok(inviteBody.delivery.provider === 'sendgrid_smtp', 'Provider Webhook: invite response reports SendGrid provider');
    ok(typeof inviteBody.delivery.deliveryId === 'string' && inviteBody.delivery.deliveryId.startsWith('edlv_'), 'Provider Webhook: invite response includes delivery id');
    const deliveryId = inviteBody.delivery.deliveryId as string;

    const rawInviteEmail = await waitForMessage(messages, 1);
    const normalizedInviteEmail = normalizeSmtpHeaders(rawInviteEmail);
    ok(/x-attestor-delivery-id:\s+/i.test(normalizedInviteEmail), 'Provider Webhook: SMTP payload includes Attestor delivery header');
    ok(normalizedInviteEmail.includes(deliveryId), 'Provider Webhook: SMTP payload includes issued delivery id');
    ok(/x-smtpapi:\s+/i.test(normalizedInviteEmail), 'Provider Webhook: SMTP payload includes SendGrid SMTP API header');
    ok(normalizedInviteEmail.includes('attestor_delivery_id'), 'Provider Webhook: SMTP payload includes SendGrid delivery unique arg');

    const accountDeliveriesBeforeRes = await fetch(`${base}/api/v1/account/email/deliveries`, {
      headers: { Cookie: accountAdminCookie! },
    });
    ok(accountDeliveriesBeforeRes.status === 200, 'Provider Webhook: account deliveries route status 200');
    const accountDeliveriesBefore = await accountDeliveriesBeforeRes.json() as any;
    ok(accountDeliveriesBefore.records.length === 1, 'Provider Webhook: account deliveries include invite dispatch');
    ok(accountDeliveriesBefore.records[0].status === 'smtp_sent', 'Provider Webhook: initial delivery status is smtp_sent');

    const timestamp = String(Math.floor(Date.now() / 1000));
    const webhookPayload = JSON.stringify([
      {
        email: 'invitee@provider.example',
        event: 'processed',
        timestamp: Number(timestamp),
        sg_event_id: 'sg_evt_processed_1',
        sg_message_id: 'sg_msg_1',
        attestor_delivery_id: deliveryId,
      },
      {
        email: 'invitee@provider.example',
        event: 'delivered',
        timestamp: Number(timestamp) + 1,
        sg_event_id: 'sg_evt_delivered_1',
        sg_message_id: 'sg_msg_1',
        attestor_delivery_id: deliveryId,
      },
      {
        email: 'invitee@provider.example',
        event: 'open',
        timestamp: Number(timestamp) + 2,
        sg_event_id: 'sg_evt_open_1',
        sg_message_id: 'sg_msg_1',
        attestor_delivery_id: deliveryId,
      },
    ]);
    const signature = signSendGridPayload(privateKey, webhookPayload, timestamp);

    const webhookRes = await fetch(`${base}/api/v1/email/sendgrid/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
        'X-Twilio-Email-Event-Webhook-Signature': signature,
      },
      body: webhookPayload,
    });
    ok(webhookRes.status === 200, 'Provider Webhook: signed webhook accepted');
    const webhookBody = await webhookRes.json() as any;
    ok(webhookBody.applied === 3, 'Provider Webhook: all signed webhook events applied');
    ok(webhookBody.duplicate === 0, 'Provider Webhook: first webhook has no duplicates');

    const duplicateWebhookRes = await fetch(`${base}/api/v1/email/sendgrid/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Twilio-Email-Event-Webhook-Timestamp': timestamp,
        'X-Twilio-Email-Event-Webhook-Signature': signature,
      },
      body: webhookPayload,
    });
    ok(duplicateWebhookRes.status === 200, 'Provider Webhook: duplicate webhook still returns 200');
    const duplicateWebhookBody = await duplicateWebhookRes.json() as any;
    ok(duplicateWebhookBody.duplicate === 3, 'Provider Webhook: duplicate webhook events are suppressed');

    const accountDeliveriesAfterRes = await fetch(`${base}/api/v1/account/email/deliveries`, {
      headers: { Cookie: accountAdminCookie! },
    });
    ok(accountDeliveriesAfterRes.status === 200, 'Provider Webhook: account deliveries remain readable after webhook');
    const accountDeliveriesAfter = await accountDeliveriesAfterRes.json() as any;
    ok(accountDeliveriesAfter.records[0].status === 'delivered', 'Provider Webhook: delivery status progresses to delivered');
    ok(accountDeliveriesAfter.records[0].opened === true, 'Provider Webhook: open event is reflected in account analytics');
    ok(accountDeliveriesAfter.records[0].eventCount === 4, 'Provider Webhook: dispatch + provider events are counted together');
    ok(accountDeliveriesAfter.records[0].providerMessageId === 'sg_msg_1', 'Provider Webhook: provider message id captured');

    const adminDeliveriesRes = await fetch(`${base}/api/v1/admin/email/deliveries?accountId=${encodeURIComponent(createAccountBody.account.id)}`, {
      headers: { Authorization: 'Bearer admin-secret' },
    });
    ok(adminDeliveriesRes.status === 200, 'Provider Webhook: admin deliveries route status 200');
    const adminDeliveries = await adminDeliveriesRes.json() as any;
    ok(adminDeliveries.summary.accountFilter === createAccountBody.account.id, 'Provider Webhook: admin filter echoed');
    ok(adminDeliveries.records.length === 1, 'Provider Webhook: admin deliveries return the correlated record');

    console.log(`  Live account email provider webhook tests: ${passed} passed, 0 failed`);
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
    console.error('\nLive account email provider webhook tests failed.');
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
