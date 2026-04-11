/**
 * Mailgun Email Webhook helpers - signed provider analytics first slice.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { HostedEmailDeliveryPurpose } from './email-delivery.js';
import type { HostedEmailDeliveryStatus } from './email-delivery-event-store.js';

export interface MailgunWebhookStatus {
  configured: boolean;
  signingKeyConfigured: boolean;
  maxAgeSeconds: number;
}

export interface MailgunWebhookSignatureRecord {
  timestamp: string;
  token: string;
  signature: string;
}

export interface MailgunWebhookEventRecord {
  email: string | null;
  event: string;
  timestamp: number | null;
  eventId: string | null;
  messageId: string | null;
  deliveryId: string | null;
  purpose: HostedEmailDeliveryPurpose | null;
  severity: string | null;
  raw: Record<string, unknown>;
}

export function buildMailgunVariablesHeader(input: {
  deliveryId: string;
  purpose: HostedEmailDeliveryPurpose;
}): Record<string, unknown> {
  return {
    attestor_delivery_id: input.deliveryId,
    attestor_delivery_purpose: input.purpose,
  };
}

function webhookSigningKey(): string | null {
  return process.env.ATTESTOR_MAILGUN_WEBHOOK_SIGNING_KEY?.trim() || null;
}

export function mailgunWebhookMaxAgeSeconds(): number {
  const raw = process.env.ATTESTOR_MAILGUN_WEBHOOK_MAX_AGE_SECONDS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 300;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

export function getMailgunWebhookStatus(): MailgunWebhookStatus {
  return {
    configured: Boolean(webhookSigningKey()),
    signingKeyConfigured: Boolean(webhookSigningKey()),
    maxAgeSeconds: mailgunWebhookMaxAgeSeconds(),
  };
}

function safeHexEquals(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  if (!/^[a-f0-9]+$/.test(normalizedLeft) || !/^[a-f0-9]+$/.test(normalizedRight)) return false;
  if (normalizedLeft.length !== normalizedRight.length || normalizedLeft.length % 2 !== 0) return false;
  return timingSafeEqual(Buffer.from(normalizedLeft, 'hex'), Buffer.from(normalizedRight, 'hex'));
}

export function verifySignedMailgunWebhook(input: MailgunWebhookSignatureRecord): boolean {
  const signingKey = webhookSigningKey();
  if (!signingKey) return false;
  const timestampInt = Number.parseInt(input.timestamp, 10);
  if (!Number.isFinite(timestampInt)) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampInt);
  if (ageSeconds > mailgunWebhookMaxAgeSeconds()) return false;

  const expected = createHmac('sha256', signingKey)
    .update(`${input.timestamp}${input.token}`, 'utf8')
    .digest('hex');
  return safeHexEquals(expected, input.signature);
}

function extractTopLevelString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractNestedString(value: unknown, ...path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return extractTopLevelString(current);
}

function extractUserVariables(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function extractTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number.parseFloat(value.trim());
    if (Number.isFinite(numeric)) return numeric;
    const millis = Date.parse(value);
    if (Number.isFinite(millis)) return Math.floor(millis / 1000);
  }
  return null;
}

function extractPurpose(userVariables: Record<string, unknown>): HostedEmailDeliveryPurpose | null {
  const purpose = extractTopLevelString(userVariables.attestor_delivery_purpose);
  return purpose === 'invite' || purpose === 'password_reset' ? purpose : null;
}

export function normalizeMailgunEventType(raw: string | null | undefined): string {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'accepted':
      return 'accepted';
    case 'delivered':
      return 'delivered';
    case 'opened':
      return 'opened';
    case 'clicked':
      return 'clicked';
    case 'unsubscribed':
      return 'unsubscribed';
    case 'complained':
      return 'complained';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

export function mailgunEventTypeToStatusHint(eventType: string, severity?: string | null): HostedEmailDeliveryStatus {
  switch (normalizeMailgunEventType(eventType)) {
    case 'accepted':
      return 'processed';
    case 'delivered':
      return 'delivered';
    case 'opened':
    case 'clicked':
    case 'unsubscribed':
      return 'delivered';
    case 'complained':
      return 'failed';
    case 'failed':
      return severity?.trim().toLowerCase() === 'temporary' ? 'deferred' : 'bounced';
    default:
      return 'unknown';
  }
}

export function parseMailgunWebhookEvent(rawPayload: string): {
  signature: MailgunWebhookSignatureRecord;
  event: MailgunWebhookEventRecord;
} {
  const parsed = JSON.parse(rawPayload) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Mailgun webhook payload must be a JSON object.');
  }
  const root = parsed as Record<string, unknown>;
  const signatureRaw = root.signature;
  const eventDataRaw = root['event-data'];
  if (!signatureRaw || typeof signatureRaw !== 'object' || Array.isArray(signatureRaw)) {
    throw new Error('Mailgun webhook payload is missing signature metadata.');
  }
  if (!eventDataRaw || typeof eventDataRaw !== 'object' || Array.isArray(eventDataRaw)) {
    throw new Error('Mailgun webhook payload is missing event-data.');
  }

  const signatureObject = signatureRaw as Record<string, unknown>;
  const eventData = eventDataRaw as Record<string, unknown>;
  const signature = {
    timestamp: extractTopLevelString(signatureObject.timestamp) ?? '',
    token: extractTopLevelString(signatureObject.token) ?? '',
    signature: extractTopLevelString(signatureObject.signature) ?? '',
  };
  if (!signature.timestamp || !signature.token || !signature.signature) {
    throw new Error('Mailgun webhook signature object must include timestamp, token, and signature.');
  }

  const userVariables = extractUserVariables(eventData['user-variables']);
  return {
    signature,
    event: {
      email: extractTopLevelString(eventData.recipient)?.toLowerCase() ?? null,
      event: normalizeMailgunEventType(extractTopLevelString(eventData.event)),
      timestamp: extractTimestamp(eventData.timestamp),
      eventId: extractTopLevelString(eventData.id),
      messageId: extractNestedString(eventData, 'message', 'headers', 'message-id')
        ?? extractNestedString(eventData, 'message', 'headers', 'Message-Id')
        ?? extractTopLevelString(eventData['message-id']),
      deliveryId: extractTopLevelString(userVariables.attestor_delivery_id),
      purpose: extractPurpose(userVariables),
      severity: extractTopLevelString(eventData.severity),
      raw: eventData,
    },
  };
}
