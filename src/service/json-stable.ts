import { createHash } from 'node:crypto';

type StableJsonValue =
  | null
  | boolean
  | number
  | string
  | StableJsonValue[]
  | { [key: string]: StableJsonValue };

function normalizeValue(value: unknown): StableJsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    const normalized: Record<string, StableJsonValue> = {};
    for (const [key, entry] of entries) {
      normalized[key] = normalizeValue(entry);
    }
    return normalized;
  }
  return String(value);
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

export function hashJsonValue(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex');
}
