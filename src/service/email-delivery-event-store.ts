/**
 * Hosted Email Delivery Event Store - delivery analytics first slice.
 *
 * BOUNDARY:
 * - File-backed fallback used for dev/self-host unless the shared control-plane wraps it
 * - Stores dispatch events plus provider webhook events as an append-only ledger
 * - Delivery summaries are projected from the ledger; there is no separate mutable read model yet
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashJsonValue } from './json-stable.js';
import type { HostedEmailDeliveryPurpose } from './email-delivery.js';

export type HostedEmailDeliveryProvider = 'manual' | 'smtp' | 'sendgrid_smtp' | 'mailgun_smtp';
export type HostedEmailDeliveryChannel = 'api_response' | 'smtp';
export type HostedEmailDeliveryStatus =
  | 'manual_delivered'
  | 'smtp_sent'
  | 'processed'
  | 'delivered'
  | 'deferred'
  | 'bounced'
  | 'dropped'
  | 'failed'
  | 'unknown';

export interface HostedEmailDeliveryEventRecord {
  id: string;
  deliveryId: string;
  accountId: string | null;
  accountUserId: string | null;
  purpose: HostedEmailDeliveryPurpose | null;
  provider: HostedEmailDeliveryProvider;
  channel: HostedEmailDeliveryChannel;
  recipient: string;
  messageId: string | null;
  providerMessageId: string | null;
  providerEventId: string | null;
  eventType: string;
  statusHint: HostedEmailDeliveryStatus;
  actionUrl: string | null;
  tokenReturned: boolean;
  occurredAt: string;
  recordedAt: string;
  payloadHash: string;
  metadata: Record<string, unknown>;
}

interface HostedEmailDeliveryEventStoreFile {
  version: 1;
  records: HostedEmailDeliveryEventRecord[];
}

export interface HostedEmailDeliveryEventStoreSnapshot {
  version: 1;
  exportedAt: string;
  recordCount: number;
  records: HostedEmailDeliveryEventRecord[];
}

export interface HostedEmailDeliverySummaryRecord {
  deliveryId: string;
  accountId: string | null;
  accountUserId: string | null;
  purpose: HostedEmailDeliveryPurpose | null;
  provider: HostedEmailDeliveryProvider;
  channel: HostedEmailDeliveryChannel;
  recipient: string;
  messageId: string | null;
  providerMessageId: string | null;
  actionUrl: string | null;
  tokenReturned: boolean;
  status: HostedEmailDeliveryStatus;
  latestEventType: string | null;
  latestEventAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  deferredAt: string | null;
  failedAt: string | null;
  firstOpenedAt: string | null;
  lastClickedAt: string | null;
  opened: boolean;
  clicked: boolean;
  unsubscribed: boolean;
  spamReported: boolean;
  failureReason: string | null;
  eventCount: number;
}

export interface ListHostedEmailDeliveryFilters {
  deliveryId?: string | null;
  accountId?: string | null;
  accountUserId?: string | null;
  purpose?: HostedEmailDeliveryPurpose | null;
  recipient?: string | null;
  provider?: HostedEmailDeliveryProvider | null;
  status?: HostedEmailDeliveryStatus | null;
  limit?: number | null;
  offset?: number | null;
}

export interface RecordHostedEmailDispatchEventInput {
  deliveryId: string;
  accountId: string | null;
  accountUserId: string | null;
  purpose: HostedEmailDeliveryPurpose;
  provider: HostedEmailDeliveryProvider;
  channel: HostedEmailDeliveryChannel;
  recipient: string;
  messageId: string | null;
  actionUrl: string | null;
  tokenReturned: boolean;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordHostedEmailProviderEventInput {
  deliveryId: string;
  accountId: string | null;
  accountUserId: string | null;
  purpose: HostedEmailDeliveryPurpose | null;
  provider: HostedEmailDeliveryProvider;
  channel: HostedEmailDeliveryChannel;
  recipient: string;
  messageId: string | null;
  providerMessageId: string | null;
  providerEventId: string | null;
  eventType: string;
  statusHint: HostedEmailDeliveryStatus;
  actionUrl: string | null;
  tokenReturned: boolean;
  occurredAt: string;
  metadata?: Record<string, unknown>;
  rawPayload?: unknown;
}

export type HostedEmailProviderEventRecordResult =
  | { kind: 'recorded'; record: HostedEmailDeliveryEventRecord; path: string }
  | { kind: 'duplicate'; record: HostedEmailDeliveryEventRecord; path: string }
  | { kind: 'conflict'; record: HostedEmailDeliveryEventRecord; path: string };

function storePath(): string {
  return resolve(process.env.ATTESTOR_EMAIL_DELIVERY_EVENTS_PATH ?? '.attestor/email-delivery-events.json');
}

function defaultStore(): HostedEmailDeliveryEventStoreFile {
  return { version: 1, records: [] };
}

export function normalizeStatus(value: string | null | undefined): HostedEmailDeliveryStatus {
  switch (value) {
    case 'manual_delivered':
    case 'smtp_sent':
    case 'processed':
    case 'delivered':
    case 'deferred':
    case 'bounced':
    case 'dropped':
    case 'failed':
      return value;
    default:
      return 'unknown';
  }
}

function normalizeProvider(value: string | null | undefined): HostedEmailDeliveryProvider {
  switch (value) {
    case 'manual':
    case 'smtp':
    case 'sendgrid_smtp':
    case 'mailgun_smtp':
      return value;
    default:
      return 'smtp';
  }
}

function normalizeChannel(value: string | null | undefined): HostedEmailDeliveryChannel {
  return value === 'api_response' ? 'api_response' : 'smtp';
}

function normalizePurpose(value: string | null | undefined): HostedEmailDeliveryPurpose | null {
  return value === 'invite' || value === 'password_reset' ? value : null;
}

function normalizeRecord(record: HostedEmailDeliveryEventRecord): HostedEmailDeliveryEventRecord {
  return {
    ...record,
    accountId: record.accountId ?? null,
    accountUserId: record.accountUserId ?? null,
    purpose: normalizePurpose(record.purpose),
    provider: normalizeProvider(record.provider),
    channel: normalizeChannel(record.channel),
    recipient: typeof record.recipient === 'string' ? record.recipient.trim().toLowerCase() : '',
    messageId: record.messageId ?? null,
    providerMessageId: record.providerMessageId ?? null,
    providerEventId: record.providerEventId ?? null,
    eventType: typeof record.eventType === 'string' && record.eventType.trim() ? record.eventType.trim() : 'unknown',
    statusHint: normalizeStatus(record.statusHint),
    actionUrl: record.actionUrl ?? null,
    tokenReturned: Boolean(record.tokenReturned),
    occurredAt: record.occurredAt,
    recordedAt: record.recordedAt,
    payloadHash: typeof record.payloadHash === 'string' && record.payloadHash.trim() ? record.payloadHash.trim() : hashJsonValue(record),
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata
      : {},
  };
}

function loadStore(): HostedEmailDeliveryEventStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as HostedEmailDeliveryEventStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) {
      return {
        version: 1,
        records: parsed.records.map(normalizeRecord),
      };
    }
  } catch {
    // fall through
  }
  return defaultStore();
}

function saveStore(store: HostedEmailDeliveryEventStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function normalizeRecipient(value: string): string {
  return value.trim().toLowerCase();
}

function compareIso(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function nextRecordId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function findFailureReason(metadata: Record<string, unknown>): string | null {
  const candidates = [
    metadata.reason,
    metadata.response,
    metadata.smtpResponse,
    metadata.status,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function filterHostedEmailDeliverySummaries(
  records: HostedEmailDeliverySummaryRecord[],
  filters?: ListHostedEmailDeliveryFilters,
): HostedEmailDeliverySummaryRecord[] {
  const recipient = filters?.recipient ? normalizeRecipient(filters.recipient) : null;
  let filtered = records
    .filter((record) => !filters?.deliveryId || record.deliveryId === filters.deliveryId)
    .filter((record) => !filters?.accountId || record.accountId === filters.accountId)
    .filter((record) => !filters?.accountUserId || record.accountUserId === filters.accountUserId)
    .filter((record) => !filters?.purpose || record.purpose === filters.purpose)
    .filter((record) => !recipient || record.recipient === recipient)
    .filter((record) => !filters?.provider || record.provider === filters.provider)
    .filter((record) => !filters?.status || record.status === filters.status)
    .sort((left, right) => {
      const leftKey = left.latestEventAt ?? left.sentAt ?? '';
      const rightKey = right.latestEventAt ?? right.sentAt ?? '';
      return compareIso(rightKey, leftKey);
    });

  const offset = Math.max(0, filters?.offset ?? 0);
  const limit = Math.max(1, Math.min(500, filters?.limit ?? 100));
  return filtered.slice(offset, offset + limit);
}

export function summarizeHostedEmailDeliveryEvents(
  records: HostedEmailDeliveryEventRecord[],
): HostedEmailDeliverySummaryRecord[] {
  const grouped = new Map<string, HostedEmailDeliveryEventRecord[]>();
  for (const record of records.map(normalizeRecord)) {
    const list = grouped.get(record.deliveryId);
    if (list) list.push(record);
    else grouped.set(record.deliveryId, [record]);
  }

  const summaries: HostedEmailDeliverySummaryRecord[] = [];
  for (const [deliveryId, group] of grouped.entries()) {
    const ordered = [...group].sort((left, right) => {
      const byOccurred = compareIso(left.occurredAt, right.occurredAt);
      if (byOccurred !== 0) return byOccurred;
      return compareIso(left.recordedAt, right.recordedAt);
    });
    const first = ordered[0]!;
    const summary: HostedEmailDeliverySummaryRecord = {
      deliveryId,
      accountId: first.accountId,
      accountUserId: first.accountUserId,
      purpose: first.purpose,
      provider: first.provider,
      channel: first.channel,
      recipient: first.recipient,
      messageId: first.messageId,
      providerMessageId: first.providerMessageId,
      actionUrl: first.actionUrl,
      tokenReturned: first.tokenReturned,
      status: first.statusHint,
      latestEventType: first.eventType,
      latestEventAt: first.occurredAt,
      sentAt: first.channel === 'smtp' || first.provider === 'manual' ? first.occurredAt : null,
      deliveredAt: first.statusHint === 'manual_delivered' ? first.occurredAt : null,
      deferredAt: null,
      failedAt: null,
      firstOpenedAt: null,
      lastClickedAt: null,
      opened: false,
      clicked: false,
      unsubscribed: false,
      spamReported: false,
      failureReason: null,
      eventCount: 0,
    };

    for (const event of ordered) {
      summary.eventCount += 1;
      summary.accountId = summary.accountId ?? event.accountId;
      summary.accountUserId = summary.accountUserId ?? event.accountUserId;
      summary.purpose = summary.purpose ?? event.purpose;
      summary.messageId = summary.messageId ?? event.messageId;
      summary.providerMessageId = event.providerMessageId ?? summary.providerMessageId;
      summary.actionUrl = summary.actionUrl ?? event.actionUrl;
      summary.latestEventType = event.eventType;
      summary.latestEventAt = event.occurredAt;

      switch (event.eventType) {
        case 'dispatch.accepted':
          summary.sentAt = summary.sentAt ?? event.occurredAt;
          if (event.statusHint === 'manual_delivered') {
            summary.status = summary.status === 'unknown' ? 'manual_delivered' : summary.status;
            summary.deliveredAt = summary.deliveredAt ?? event.occurredAt;
          } else if (summary.status === 'unknown') {
            summary.status = event.statusHint;
          }
          break;
        case 'sendgrid.processed':
          summary.status = 'processed';
          break;
        case 'sendgrid.delivered':
          summary.status = 'delivered';
          summary.deliveredAt = summary.deliveredAt ?? event.occurredAt;
          break;
        case 'sendgrid.deferred':
          if (summary.status !== 'delivered') summary.status = 'deferred';
          summary.deferredAt = event.occurredAt;
          break;
        case 'sendgrid.bounce':
          summary.status = 'bounced';
          summary.failedAt = summary.failedAt ?? event.occurredAt;
          summary.failureReason = findFailureReason(event.metadata) ?? summary.failureReason;
          break;
        case 'sendgrid.dropped':
          summary.status = 'dropped';
          summary.failedAt = summary.failedAt ?? event.occurredAt;
          summary.failureReason = findFailureReason(event.metadata) ?? summary.failureReason;
          break;
        case 'sendgrid.spamreport':
          if (summary.status !== 'bounced' && summary.status !== 'dropped') {
            summary.status = 'failed';
          }
          summary.spamReported = true;
          summary.failedAt = summary.failedAt ?? event.occurredAt;
          summary.failureReason = findFailureReason(event.metadata) ?? summary.failureReason;
          break;
        case 'sendgrid.unsubscribe':
        case 'sendgrid.group_unsubscribe':
          summary.unsubscribed = true;
          break;
        case 'sendgrid.group_resubscribe':
          summary.unsubscribed = false;
          break;
        case 'sendgrid.open':
          summary.opened = true;
          summary.firstOpenedAt = summary.firstOpenedAt ?? event.occurredAt;
          break;
        case 'sendgrid.click':
          summary.clicked = true;
          summary.lastClickedAt = event.occurredAt;
          break;
        case 'mailgun.accepted':
          if (summary.status === 'smtp_sent' || summary.status === 'unknown') {
            summary.status = 'processed';
          }
          break;
        case 'mailgun.delivered':
          summary.status = 'delivered';
          summary.deliveredAt = summary.deliveredAt ?? event.occurredAt;
          break;
        case 'mailgun.failed':
          if (event.statusHint === 'deferred' && summary.status !== 'delivered') {
            summary.status = 'deferred';
            summary.deferredAt = event.occurredAt;
          } else {
            summary.status = event.statusHint === 'bounced' ? 'bounced' : 'failed';
            summary.failedAt = summary.failedAt ?? event.occurredAt;
            summary.failureReason = findFailureReason(event.metadata) ?? summary.failureReason;
          }
          break;
        case 'mailgun.complained':
          if (summary.status !== 'bounced' && summary.status !== 'dropped') {
            summary.status = 'failed';
          }
          summary.spamReported = true;
          summary.failedAt = summary.failedAt ?? event.occurredAt;
          summary.failureReason = findFailureReason(event.metadata) ?? summary.failureReason;
          break;
        case 'mailgun.unsubscribed':
          summary.unsubscribed = true;
          break;
        case 'mailgun.opened':
          summary.opened = true;
          summary.firstOpenedAt = summary.firstOpenedAt ?? event.occurredAt;
          break;
        case 'mailgun.clicked':
          summary.clicked = true;
          summary.lastClickedAt = event.occurredAt;
          break;
        default:
          if (summary.status === 'smtp_sent' || summary.status === 'unknown') {
            summary.status = event.statusHint;
          }
          break;
      }
    }

    summaries.push(summary);
  }

  return summaries.sort((left, right) => compareIso(right.latestEventAt ?? '', left.latestEventAt ?? ''));
}

export function buildHostedEmailDeliveryId(): string {
  return nextRecordId('edlv');
}

export function buildHostedEmailDispatchEventRecord(
  input: RecordHostedEmailDispatchEventInput,
): HostedEmailDeliveryEventRecord {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  return normalizeRecord({
    id: nextRecordId('email_evt'),
    deliveryId: input.deliveryId,
    accountId: input.accountId,
    accountUserId: input.accountUserId,
    purpose: input.purpose,
    provider: input.provider,
    channel: input.channel,
    recipient: normalizeRecipient(input.recipient),
    messageId: input.messageId,
    providerMessageId: null,
    providerEventId: null,
    eventType: 'dispatch.accepted',
    statusHint: input.provider === 'manual' ? 'manual_delivered' : 'smtp_sent',
    actionUrl: input.actionUrl,
    tokenReturned: input.tokenReturned,
    occurredAt,
    recordedAt: new Date().toISOString(),
    payloadHash: hashJsonValue({
      deliveryId: input.deliveryId,
      provider: input.provider,
      channel: input.channel,
      recipient: normalizeRecipient(input.recipient),
      messageId: input.messageId ?? null,
      actionUrl: input.actionUrl ?? null,
      tokenReturned: Boolean(input.tokenReturned),
      metadata: input.metadata ?? {},
    }),
    metadata: input.metadata ?? {},
  });
}

export function recordHostedEmailDispatchEvent(
  input: RecordHostedEmailDispatchEventInput,
): { record: HostedEmailDeliveryEventRecord; path: string } {
  const store = loadStore();
  const record = buildHostedEmailDispatchEventRecord(input);
  store.records.push(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function buildHostedEmailProviderEventRecord(
  input: RecordHostedEmailProviderEventInput,
): HostedEmailDeliveryEventRecord {
  const payloadHash = hashJsonValue({
    deliveryId: input.deliveryId,
    provider: input.provider,
    providerEventId: input.providerEventId ?? null,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    recipient: normalizeRecipient(input.recipient),
    messageId: input.messageId ?? null,
    providerMessageId: input.providerMessageId ?? null,
    metadata: input.metadata ?? {},
    rawPayload: input.rawPayload ?? null,
  });
  return normalizeRecord({
    id: nextRecordId('email_evt'),
    deliveryId: input.deliveryId,
    accountId: input.accountId,
    accountUserId: input.accountUserId,
    purpose: input.purpose,
    provider: input.provider,
    channel: input.channel,
    recipient: normalizeRecipient(input.recipient),
    messageId: input.messageId,
    providerMessageId: input.providerMessageId,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    statusHint: input.statusHint,
    actionUrl: input.actionUrl,
    tokenReturned: input.tokenReturned,
    occurredAt: input.occurredAt,
    recordedAt: new Date().toISOString(),
    payloadHash,
    metadata: input.metadata ?? {},
  });
}

export function recordHostedEmailProviderEvent(
  input: RecordHostedEmailProviderEventInput,
): HostedEmailProviderEventRecordResult {
  const store = loadStore();
  const record = buildHostedEmailProviderEventRecord(input);
  if (input.providerEventId) {
    const existing = store.records.find((entry) =>
      entry.provider === input.provider
      && entry.providerEventId === input.providerEventId,
    );
    if (existing) {
      if (existing.payloadHash !== record.payloadHash) {
        return { kind: 'conflict', record: existing, path: storePath() };
      }
      return { kind: 'duplicate', record: existing, path: storePath() };
    }
  }
  store.records.push(record);
  saveStore(store);
  return { kind: 'recorded', record, path: storePath() };
}

export function listHostedEmailDeliveryEvents(filters?: {
  deliveryId?: string | null;
  accountId?: string | null;
  accountUserId?: string | null;
  provider?: HostedEmailDeliveryProvider | null;
}): { records: HostedEmailDeliveryEventRecord[]; path: string } {
  let records = loadStore().records;
  if (filters?.deliveryId) records = records.filter((entry) => entry.deliveryId === filters.deliveryId);
  if (filters?.accountId) records = records.filter((entry) => entry.accountId === filters.accountId);
  if (filters?.accountUserId) records = records.filter((entry) => entry.accountUserId === filters.accountUserId);
  if (filters?.provider) records = records.filter((entry) => entry.provider === filters.provider);
  return {
    records: [...records].sort((left, right) => compareIso(right.occurredAt, left.occurredAt)),
    path: storePath(),
  };
}

export function listHostedEmailDeliveries(
  filters?: ListHostedEmailDeliveryFilters,
): { records: HostedEmailDeliverySummaryRecord[]; path: string } {
  const summaries = summarizeHostedEmailDeliveryEvents(loadStore().records);
  return {
    records: filterHostedEmailDeliverySummaries(summaries, filters),
    path: storePath(),
  };
}

export function exportHostedEmailDeliveryEventStoreSnapshot(): HostedEmailDeliveryEventStoreSnapshot {
  const records = [...loadStore().records].sort((left, right) => compareIso(left.occurredAt, right.occurredAt));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    recordCount: records.length,
    records,
  };
}

export function restoreHostedEmailDeliveryEventStoreSnapshot(
  snapshot: HostedEmailDeliveryEventStoreSnapshot,
): { recordCount: number; path: string } {
  const store: HostedEmailDeliveryEventStoreFile = {
    version: 1,
    records: snapshot.records.map(normalizeRecord),
  };
  saveStore(store);
  return {
    recordCount: store.records.length,
    path: storePath(),
  };
}

export function resetHostedEmailDeliveryEventStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
