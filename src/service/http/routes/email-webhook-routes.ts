import type { Hono } from 'hono';
import type {
  HostedEmailDeliveryEventRecord,
  HostedEmailDeliverySummaryRecord,
  ListHostedEmailDeliveryFilters,
  RecordHostedEmailProviderEventInput,
} from '../../email-delivery-event-store.js';
import type {
  MailgunWebhookEventRecord,
  MailgunWebhookSignatureRecord,
  MailgunWebhookStatus,
} from '../../mailgun-email-webhook.js';
import type {
  SendGridWebhookEventRecord,
  SendGridWebhookStatus,
} from '../../sendgrid-email-webhook.js';

export interface EmailWebhookRouteDeps {
  getSendGridWebhookStatus(): SendGridWebhookStatus;
  verifySignedSendGridWebhook(input: {
    rawPayload: string;
    signature: string;
    timestamp: string;
  }): boolean;
  parseSendGridWebhookEvents(rawPayload: string): SendGridWebhookEventRecord[];
  listHostedEmailDeliveriesState(filters?: ListHostedEmailDeliveryFilters): Promise<{
    records: HostedEmailDeliverySummaryRecord[];
    path: string | null;
  }>;
  recordHostedEmailProviderEventState(
    input: RecordHostedEmailProviderEventInput,
  ): Promise<{
    kind: 'recorded' | 'duplicate' | 'conflict';
    record: HostedEmailDeliveryEventRecord;
    path: string | null;
  }>;
  sendGridEventTypeToStatusHint(eventType: string): RecordHostedEmailProviderEventInput['statusHint'];
  getMailgunWebhookStatus(): MailgunWebhookStatus;
  parseMailgunWebhookEvent(rawPayload: string): {
    signature: MailgunWebhookSignatureRecord;
    event: MailgunWebhookEventRecord;
  };
  verifySignedMailgunWebhook(input: MailgunWebhookSignatureRecord): boolean;
  mailgunEventTypeToStatusHint(
    eventType: string,
    severity?: string | null,
  ): RecordHostedEmailProviderEventInput['statusHint'];
}

export function registerEmailWebhookRoutes(app: Hono, deps: EmailWebhookRouteDeps): void {
  const {
    getSendGridWebhookStatus,
    verifySignedSendGridWebhook,
    parseSendGridWebhookEvents,
    listHostedEmailDeliveriesState,
    recordHostedEmailProviderEventState,
    sendGridEventTypeToStatusHint,
    getMailgunWebhookStatus,
    parseMailgunWebhookEvent,
    verifySignedMailgunWebhook,
    mailgunEventTypeToStatusHint,
  } = deps;

app.post('/api/v1/email/sendgrid/webhook', async (c) => {
  const webhookStatus = getSendGridWebhookStatus();
  if (!webhookStatus.configured) {
    return c.json({
      error: 'SendGrid event webhook disabled. Set ATTESTOR_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY to enable delivery analytics.',
    }, 503);
  }

  const signature = c.req.header('x-twilio-email-event-webhook-signature')?.trim() ?? '';
  const timestamp = c.req.header('x-twilio-email-event-webhook-timestamp')?.trim() ?? '';
  if (!signature || !timestamp) {
    return c.json({
      error: 'Signed SendGrid webhook requires X-Twilio-Email-Event-Webhook-Signature and X-Twilio-Email-Event-Webhook-Timestamp.',
    }, 400);
  }

  const rawPayload = await c.req.text();
  if (!verifySignedSendGridWebhook({ rawPayload, signature, timestamp })) {
    return c.json({ error: 'SendGrid webhook signature verification failed.' }, 400);
  }

  let events;
  try {
    events = parseSendGridWebhookEvents(rawPayload);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  let applied = 0;
  let duplicate = 0;
  let ignored = 0;
  let conflict = 0;

  for (const event of events) {
    if (!event.deliveryId || !event.email) {
      ignored += 1;
      continue;
    }
    const existing = await listHostedEmailDeliveriesState({
      deliveryId: event.deliveryId,
      limit: 1,
    });
    const delivery = existing.records[0] ?? null;
    const result = await recordHostedEmailProviderEventState({
      deliveryId: event.deliveryId,
      accountId: delivery?.accountId ?? null,
      accountUserId: delivery?.accountUserId ?? null,
      purpose: event.purpose ?? delivery?.purpose ?? null,
      provider: 'sendgrid_smtp',
      channel: 'smtp',
      recipient: event.email,
      messageId: delivery?.messageId ?? null,
      providerMessageId: event.sgMessageId ?? delivery?.providerMessageId ?? null,
      providerEventId: event.sgEventId,
      eventType: `sendgrid.${event.event}`,
      statusHint: sendGridEventTypeToStatusHint(event.event),
      actionUrl: delivery?.actionUrl ?? null,
      tokenReturned: delivery?.tokenReturned ?? false,
      occurredAt: event.timestamp
        ? new Date(event.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      metadata: event.raw,
      rawPayload: event.raw,
    });
    if (result.kind === 'recorded') applied += 1;
    else if (result.kind === 'duplicate') duplicate += 1;
    else conflict += 1;
  }

  return c.json({
    received: true,
    provider: 'sendgrid_smtp',
    eventCount: events.length,
    applied,
    duplicate,
    ignored,
    conflict,
  });
});

app.post('/api/v1/email/mailgun/webhook', async (c) => {
  const webhookStatus = getMailgunWebhookStatus();
  if (!webhookStatus.configured) {
    return c.json({
      error: 'Mailgun event webhook disabled. Set ATTESTOR_MAILGUN_WEBHOOK_SIGNING_KEY to enable delivery analytics.',
    }, 503);
  }

  const rawPayload = await c.req.text();
  let parsed;
  try {
    parsed = parseMailgunWebhookEvent(rawPayload);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  if (!verifySignedMailgunWebhook(parsed.signature)) {
    return c.json({ error: 'Mailgun webhook signature verification failed.' }, 400);
  }

  const event = parsed.event;
  let applied = 0;
  let duplicate = 0;
  let ignored = 0;
  let conflict = 0;

  if (!event.deliveryId || !event.email) {
    ignored += 1;
  } else {
    const existing = await listHostedEmailDeliveriesState({
      deliveryId: event.deliveryId,
      limit: 1,
    });
    const delivery = existing.records[0] ?? null;
    const result = await recordHostedEmailProviderEventState({
      deliveryId: event.deliveryId,
      accountId: delivery?.accountId ?? null,
      accountUserId: delivery?.accountUserId ?? null,
      purpose: event.purpose ?? delivery?.purpose ?? null,
      provider: 'mailgun_smtp',
      channel: 'smtp',
      recipient: event.email,
      messageId: delivery?.messageId ?? null,
      providerMessageId: event.messageId ?? delivery?.providerMessageId ?? null,
      providerEventId: event.eventId,
      eventType: `mailgun.${event.event}`,
      statusHint: mailgunEventTypeToStatusHint(event.event, event.severity),
      actionUrl: delivery?.actionUrl ?? null,
      tokenReturned: delivery?.tokenReturned ?? false,
      occurredAt: event.timestamp
        ? new Date(event.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      metadata: {
        ...event.raw,
        severity: event.severity ?? null,
      },
      rawPayload: event.raw,
    });
    if (result.kind === 'recorded') applied += 1;
    else if (result.kind === 'duplicate') duplicate += 1;
    else conflict += 1;
  }

  return c.json({
    received: true,
    provider: 'mailgun_smtp',
    eventCount: 1,
    applied,
    duplicate,
    ignored,
    conflict,
  });
});
}
