import assert from 'node:assert/strict';
import {
  createEmailWebhookService,
  type EmailWebhookServiceDeps,
} from '../src/service/application/email-webhook-service.js';
import type {
  HostedEmailDeliveryEventRecord,
  HostedEmailDeliverySummaryRecord,
  RecordHostedEmailProviderEventInput,
} from '../src/service/email-delivery-event-store.js';
import type { MailgunWebhookEventRecord } from '../src/service/mailgun-email-webhook.js';
import type { SendGridWebhookEventRecord } from '../src/service/sendgrid-email-webhook.js';

const now = '2026-04-21T10:00:00.000Z';

function delivery(overrides: Partial<HostedEmailDeliverySummaryRecord> = {}): HostedEmailDeliverySummaryRecord {
  return {
    deliveryId: 'delivery_123',
    accountId: 'acct_123',
    accountUserId: 'user_123',
    purpose: 'invite',
    provider: 'sendgrid_smtp',
    channel: 'smtp',
    recipient: 'ops@example.com',
    messageId: 'msg_internal',
    providerMessageId: 'msg_provider',
    actionUrl: 'https://attestor.example/invite',
    tokenReturned: false,
    status: 'smtp_sent',
    latestEventType: 'dispatch',
    latestEventAt: now,
    sentAt: now,
    deliveredAt: null,
    deferredAt: null,
    failedAt: null,
    firstOpenedAt: null,
    lastClickedAt: null,
    opened: false,
    clicked: false,
    unsubscribed: false,
    spamReported: false,
    failureReason: null,
    eventCount: 1,
    ...overrides,
  };
}

function providerRecord(input: RecordHostedEmailProviderEventInput): HostedEmailDeliveryEventRecord {
  return {
    id: 'event_123',
    deliveryId: input.deliveryId,
    accountId: input.accountId,
    accountUserId: input.accountUserId,
    purpose: input.purpose,
    provider: input.provider,
    channel: input.channel,
    recipient: input.recipient,
    messageId: input.messageId,
    providerMessageId: input.providerMessageId,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    statusHint: input.statusHint,
    actionUrl: input.actionUrl,
    tokenReturned: input.tokenReturned,
    occurredAt: input.occurredAt,
    recordedAt: now,
    payloadHash: 'hash_123',
    metadata: input.metadata ?? {},
  };
}

function sendGridEvent(overrides: Partial<SendGridWebhookEventRecord> = {}): SendGridWebhookEventRecord {
  return {
    email: 'ops@example.com',
    event: 'delivered',
    timestamp: 1776765600,
    sgEventId: 'sg_event_123',
    sgMessageId: 'sg_msg_123',
    deliveryId: 'delivery_123',
    purpose: 'invite',
    raw: { event: 'delivered' },
    ...overrides,
  };
}

function mailgunEvent(overrides: Partial<MailgunWebhookEventRecord> = {}): MailgunWebhookEventRecord {
  return {
    email: 'ops@example.com',
    event: 'failed',
    timestamp: 1776765600,
    eventId: 'mg_event_123',
    messageId: 'mg_msg_123',
    deliveryId: 'delivery_123',
    purpose: 'password_reset',
    severity: 'temporary',
    raw: { event: 'failed' },
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<EmailWebhookServiceDeps> = {},
  recorded: RecordHostedEmailProviderEventInput[] = [],
): EmailWebhookServiceDeps {
  return {
    getSendGridWebhookStatus: () => ({
      configured: true,
      publicKeyConfigured: true,
      maxAgeSeconds: 300,
    }),
    verifySignedSendGridWebhook: () => true,
    parseSendGridWebhookEvents: () => [sendGridEvent(), sendGridEvent({ deliveryId: null })],
    getMailgunWebhookStatus: () => ({
      configured: true,
      signingKeyConfigured: true,
      maxAgeSeconds: 300,
    }),
    parseMailgunWebhookEvent: () => ({
      signature: {
        timestamp: '1776765600',
        token: 'token_123',
        signature: 'signature_123',
      },
      event: mailgunEvent(),
    }),
    verifySignedMailgunWebhook: () => true,
    findEmailDeliveryById: async () => delivery(),
    recordEmailProviderEvent: async (input) => {
      recorded.push(input);
      return {
        kind: 'recorded',
        record: providerRecord(input),
        path: null,
      };
    },
    sendGridEventTypeToStatusHint: () => 'delivered',
    mailgunEventTypeToStatusHint: () => 'deferred',
    now: () => now,
    ...overrides,
  };
}

async function testSendGridWebhookRecordsProviderEvents(): Promise<void> {
  const recorded: RecordHostedEmailProviderEventInput[] = [];
  const service = createEmailWebhookService(createDeps({}, recorded));

  const result = await service.handleSendGrid({
    rawPayload: '[]',
    signature: 'sig',
    timestamp: '1776765600',
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.provider, 'sendgrid_smtp');
  assert.equal(result.responseBody.eventCount, 2);
  assert.equal(result.responseBody.applied, 1);
  assert.equal(result.responseBody.ignored, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.accountId, 'acct_123');
  assert.equal(recorded[0]?.eventType, 'sendgrid.delivered');
  assert.equal(recorded[0]?.providerMessageId, 'sg_msg_123');
}

async function testSendGridWebhookRejectsUnsignedRequests(): Promise<void> {
  const service = createEmailWebhookService(createDeps());

  const result = await service.handleSendGrid({
    rawPayload: '[]',
    signature: '',
    timestamp: '1776765600',
  });

  assert.equal(result.statusCode, 400);
  assert.match(String(result.responseBody.error), /requires X-Twilio/u);
}

async function testMailgunWebhookRecordsSeverityAwareEvents(): Promise<void> {
  const recorded: RecordHostedEmailProviderEventInput[] = [];
  const service = createEmailWebhookService(createDeps({}, recorded));

  const result = await service.handleMailgun({
    rawPayload: '{}',
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.responseBody.provider, 'mailgun_smtp');
  assert.equal(result.responseBody.applied, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.eventType, 'mailgun.failed');
  assert.equal(recorded[0]?.statusHint, 'deferred');
  assert.equal(recorded[0]?.purpose, 'password_reset');
}

async function testMailgunWebhookFailsClosedWhenDisabled(): Promise<void> {
  const service = createEmailWebhookService(createDeps({
    getMailgunWebhookStatus: () => ({
      configured: false,
      signingKeyConfigured: false,
      maxAgeSeconds: 300,
    }),
  }));

  const result = await service.handleMailgun({
    rawPayload: '{}',
  });

  assert.equal(result.statusCode, 503);
  assert.match(String(result.responseBody.error), /Mailgun event webhook disabled/u);
}

await testSendGridWebhookRecordsProviderEvents();
await testSendGridWebhookRejectsUnsignedRequests();
await testMailgunWebhookRecordsSeverityAwareEvents();
await testMailgunWebhookFailsClosedWhenDisabled();

console.log('Service email webhook service tests: 4 passed, 0 failed');
