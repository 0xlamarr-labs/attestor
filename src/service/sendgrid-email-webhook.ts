/**
 * SendGrid Email Webhook helpers - signed provider analytics first slice.
 */

import { createPublicKey, verify as verifySignature } from 'node:crypto';
import type { HostedEmailDeliveryPurpose } from './email-delivery.js';
import type { HostedEmailDeliveryStatus } from './email-delivery-event-store.js';

export interface SendGridWebhookStatus {
  configured: boolean;
  publicKeyConfigured: boolean;
  maxAgeSeconds: number;
}

export interface SendGridWebhookEventRecord {
  email: string | null;
  event: string;
  timestamp: number | null;
  sgEventId: string | null;
  sgMessageId: string | null;
  deliveryId: string | null;
  purpose: HostedEmailDeliveryPurpose | null;
  raw: Record<string, unknown>;
}

export function buildSendGridSmtpApiHeader(input: {
  deliveryId: string;
  purpose: HostedEmailDeliveryPurpose;
}): Record<string, unknown> {
  return {
    unique_args: {
      attestor_delivery_id: input.deliveryId,
      attestor_delivery_purpose: input.purpose,
    },
    category: [`attestor_${input.purpose}`],
  };
}

function webhookPublicKey(): string | null {
  return process.env.ATTESTOR_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY?.trim() || null;
}

export function sendGridWebhookMaxAgeSeconds(): number {
  const raw = process.env.ATTESTOR_SENDGRID_EVENT_WEBHOOK_MAX_AGE_SECONDS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 300;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

export function getSendGridWebhookStatus(): SendGridWebhookStatus {
  return {
    configured: Boolean(webhookPublicKey()),
    publicKeyConfigured: Boolean(webhookPublicKey()),
    maxAgeSeconds: sendGridWebhookMaxAgeSeconds(),
  };
}

function normalizePublicKeyPem(value: string): string {
  if (value.includes('BEGIN PUBLIC KEY')) return value;
  const wrapped = value.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? value;
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
}

export function verifySignedSendGridWebhook(input: {
  rawPayload: string;
  signature: string;
  timestamp: string;
}): boolean {
  const publicKey = webhookPublicKey();
  if (!publicKey) return false;
  const timestampInt = Number.parseInt(input.timestamp, 10);
  if (!Number.isFinite(timestampInt)) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampInt);
  if (ageSeconds > sendGridWebhookMaxAgeSeconds()) return false;

  const keyObject = createPublicKey(normalizePublicKeyPem(publicKey));
  return verifySignature(
    'sha256',
    Buffer.concat([
      Buffer.from(input.timestamp, 'utf8'),
      Buffer.from(input.rawPayload, 'utf8'),
    ]),
    keyObject,
    Buffer.from(input.signature, 'base64'),
  );
}

function extractTopLevelString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractDeliveryId(raw: Record<string, unknown>): string | null {
  const topLevel = extractTopLevelString(raw.attestor_delivery_id);
  if (topLevel) return topLevel;

  const uniqueArgs = raw.unique_args;
  if (uniqueArgs && typeof uniqueArgs === 'object' && !Array.isArray(uniqueArgs)) {
    const nested = extractTopLevelString((uniqueArgs as Record<string, unknown>).attestor_delivery_id);
    if (nested) return nested;
  }

  const customArgs = raw.custom_args;
  if (customArgs && typeof customArgs === 'object' && !Array.isArray(customArgs)) {
    const nested = extractTopLevelString((customArgs as Record<string, unknown>).attestor_delivery_id);
    if (nested) return nested;
  }

  return null;
}

function extractPurpose(raw: Record<string, unknown>): HostedEmailDeliveryPurpose | null {
  const topLevel = extractTopLevelString(raw.attestor_delivery_purpose);
  if (topLevel === 'invite' || topLevel === 'password_reset') return topLevel;

  const uniqueArgs = raw.unique_args;
  if (uniqueArgs && typeof uniqueArgs === 'object' && !Array.isArray(uniqueArgs)) {
    const nested = extractTopLevelString((uniqueArgs as Record<string, unknown>).attestor_delivery_purpose);
    if (nested === 'invite' || nested === 'password_reset') return nested;
  }

  const customArgs = raw.custom_args;
  if (customArgs && typeof customArgs === 'object' && !Array.isArray(customArgs)) {
    const nested = extractTopLevelString((customArgs as Record<string, unknown>).attestor_delivery_purpose);
    if (nested === 'invite' || nested === 'password_reset') return nested;
  }

  return null;
}

export function normalizeSendGridEventType(raw: string | null | undefined): string {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'processed':
      return 'processed';
    case 'delivered':
      return 'delivered';
    case 'deferred':
      return 'deferred';
    case 'bounce':
      return 'bounce';
    case 'dropped':
      return 'dropped';
    case 'open':
      return 'open';
    case 'click':
      return 'click';
    case 'spamreport':
      return 'spamreport';
    case 'unsubscribe':
      return 'unsubscribe';
    case 'group_unsubscribe':
      return 'group_unsubscribe';
    case 'group_resubscribe':
      return 'group_resubscribe';
    default:
      return 'unknown';
  }
}

export function sendGridEventTypeToStatusHint(eventType: string): HostedEmailDeliveryStatus {
  switch (normalizeSendGridEventType(eventType)) {
    case 'processed':
      return 'processed';
    case 'delivered':
      return 'delivered';
    case 'deferred':
      return 'deferred';
    case 'bounce':
      return 'bounced';
    case 'dropped':
      return 'dropped';
    case 'spamreport':
      return 'failed';
    case 'open':
    case 'click':
    case 'unsubscribe':
    case 'group_unsubscribe':
    case 'group_resubscribe':
      return 'delivered';
    default:
      return 'unknown';
  }
}

export function parseSendGridWebhookEvents(rawPayload: string): SendGridWebhookEventRecord[] {
  const parsed = JSON.parse(rawPayload) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('SendGrid Event Webhook payload must be a JSON array.');
  }
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`SendGrid Event Webhook payload entry ${index} is invalid.`);
    }
    const raw = entry as Record<string, unknown>;
    return {
      email: extractTopLevelString(raw.email)?.toLowerCase() ?? null,
      event: normalizeSendGridEventType(extractTopLevelString(raw.event)),
      timestamp: typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
        ? raw.timestamp
        : typeof raw.timestamp === 'string' && raw.timestamp.trim()
          ? Number.parseInt(raw.timestamp.trim(), 10)
          : null,
      sgEventId: extractTopLevelString(raw.sg_event_id),
      sgMessageId: extractTopLevelString(raw.sg_message_id),
      deliveryId: extractDeliveryId(raw),
      purpose: extractPurpose(raw),
      raw,
    };
  });
}
