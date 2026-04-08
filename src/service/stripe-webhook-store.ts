/**
 * Stripe Webhook Store — Duplicate-event guard for hosted billing sync.
 *
 * BOUNDARY:
 * - Local file-backed processed-event ledger only
 * - De-duplicates by Stripe event id, with payload hash conflict detection
 * - No webhook event replay queue or dead-letter system yet
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashJsonValue } from './json-stable.js';

export interface StripeWebhookRecord {
  id: string;
  eventId: string;
  eventType: string;
  payloadHash: string;
  accountId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  outcome: 'applied' | 'ignored';
  reason: string | null;
  receivedAt: string;
}

interface StripeWebhookStoreFile {
  version: 1;
  records: StripeWebhookRecord[];
}

export type StripeWebhookLookup =
  | { kind: 'miss'; payloadHash: string }
  | { kind: 'duplicate'; payloadHash: string; record: StripeWebhookRecord }
  | { kind: 'conflict'; payloadHash: string; record: StripeWebhookRecord };

function storePath(): string {
  return resolve(process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH ?? '.attestor/stripe-webhooks.json');
}

function defaultStore(): StripeWebhookStoreFile {
  return { version: 1, records: [] };
}

function loadStore(): StripeWebhookStoreFile {
  const path = storePath();
  if (!existsSync(path)) return defaultStore();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StripeWebhookStoreFile;
    if (parsed.version === 1 && Array.isArray(parsed.records)) return parsed;
  } catch {
    // fall through to safe default
  }
  return defaultStore();
}

function saveStore(store: StripeWebhookStoreFile): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export function readStripeWebhookStoreSnapshot(): {
  path: string;
  records: StripeWebhookRecord[];
} {
  const store = loadStore();
  return {
    path: storePath(),
    records: [...store.records],
  };
}

function payloadHash(payload: string): string {
  return hashJsonValue({ payload });
}

export function lookupProcessedStripeWebhook(eventId: string, rawPayload: string): StripeWebhookLookup {
  const requestHash = payloadHash(rawPayload);
  const store = loadStore();
  const existing = store.records.find((entry) => entry.eventId === eventId);
  if (!existing) return { kind: 'miss', payloadHash: requestHash };
  if (existing.payloadHash !== requestHash) {
    return { kind: 'conflict', payloadHash: requestHash, record: existing };
  }
  return { kind: 'duplicate', payloadHash: requestHash, record: existing };
}

export function recordProcessedStripeWebhook(input: Omit<StripeWebhookRecord, 'id' | 'receivedAt' | 'payloadHash'> & {
  rawPayload: string;
}): { record: StripeWebhookRecord; path: string } {
  const store = loadStore();
  const requestHash = payloadHash(input.rawPayload);
  const existing = store.records.find((entry) => entry.eventId === input.eventId);
  if (existing) {
    if (existing.payloadHash !== requestHash) {
      throw new Error(`Stripe event '${input.eventId}' was already recorded with a different payload hash.`);
    }
    return { record: existing, path: storePath() };
  }

  const record: StripeWebhookRecord = {
    id: `stripe_evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    eventId: input.eventId,
    eventType: input.eventType,
    payloadHash: requestHash,
    accountId: input.accountId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    outcome: input.outcome,
    reason: input.reason,
    receivedAt: new Date().toISOString(),
  };
  store.records.push(record);
  saveStore(store);
  return { record, path: storePath() };
}

export function resetStripeWebhookStoreForTests(): void {
  const path = storePath();
  if (existsSync(path)) rmSync(path, { force: true });
}
