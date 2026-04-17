import { createHash } from 'node:crypto';
import type { OutputContractDescriptor } from './types.js';
import type { ReleaseTargetReference } from './object-model.js';

/**
 * Canonicalization and hashing for releasable outputs.
 *
 * The release layer needs one invariant byte representation for the output
 * artifact and one for the downstream consequence candidate, so that the
 * decision, token, and verifier layers all bind to the same hashes.
 *
 * This module follows the spirit of RFC 8785 (JSON canonicalization) while
 * staying intentionally strict about accepted values. We only allow
 * canonicalizable JSON-compatible values and fail fast on ambiguous or lossy
 * inputs such as undefined, NaN, Infinity, functions, or custom class
 * instances.
 */

export const RELEASE_CANONICALIZATION_SPEC_VERSION = 'attestor.release-canonicalization.v1';

export type CanonicalReleaseJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalReleaseJsonValue[]
  | { readonly [key: string]: CanonicalReleaseJsonValue };

type CanonicalReleaseObject = { readonly [key: string]: CanonicalReleaseJsonValue };

export interface ReleaseOutputEnvelope {
  readonly outputContract: OutputContractDescriptor;
  readonly payload: CanonicalReleaseJsonValue;
}

export interface ReleaseConsequenceEnvelope {
  readonly consequenceType: OutputContractDescriptor['consequenceType'];
  readonly target: ReleaseTargetReference;
  readonly payload: CanonicalReleaseJsonValue;
  readonly recipientId?: string;
  readonly idempotencyKey?: string;
}

export interface CreateCanonicalReleaseHashBundleInput {
  readonly outputContract: OutputContractDescriptor;
  readonly target: ReleaseTargetReference;
  readonly outputPayload: CanonicalReleaseJsonValue;
  readonly consequencePayload: CanonicalReleaseJsonValue;
  readonly recipientId?: string;
  readonly idempotencyKey?: string;
}

export interface CanonicalReleaseHashBundle {
  readonly version: typeof RELEASE_CANONICALIZATION_SPEC_VERSION;
  readonly outputCanonical: string;
  readonly consequenceCanonical: string;
  readonly outputHash: string;
  readonly consequenceHash: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCanonicalReleaseObject(value: CanonicalReleaseJsonValue): value is CanonicalReleaseObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCanonicalValue(
  value: CanonicalReleaseJsonValue,
  path: string,
): CanonicalReleaseJsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number is not canonicalizable at ${path}.`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => normalizeCanonicalValue(item, `${path}[${index}]`)),
    );
  }

  if (!isPlainObject(value)) {
    throw new Error(`Only plain JSON objects are canonicalizable at ${path}.`);
  }

  const normalizedEntries = Object.keys(value)
    .sort()
    .map((key) => {
      const nestedValue = value[key];
      if (nestedValue === undefined) {
        throw new Error(`Undefined values are not canonicalizable at ${path}.${key}.`);
      }
      return [key, normalizeCanonicalValue(nestedValue as CanonicalReleaseJsonValue, `${path}.${key}`)] as const;
    });

  return Object.freeze(
    Object.fromEntries(normalizedEntries) as { readonly [key: string]: CanonicalReleaseJsonValue },
  );
}

function serializeCanonicalValue(value: CanonicalReleaseJsonValue): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonicalValue(item)).join(',')}]`;
  }

  if (!isCanonicalReleaseObject(value)) {
    throw new Error('Only canonical JSON objects may reach object serialization.');
  }

  return serializeCanonicalObject(value);
}

function serializeCanonicalObject(value: CanonicalReleaseObject): string {
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeCanonicalValue(value[key])}`)
    .join(',')}}`;
}

export function canonicalizeReleaseJson(value: CanonicalReleaseJsonValue): string {
  const normalized = normalizeCanonicalValue(value, '$');
  return serializeCanonicalValue(normalized);
}

export function canonicalizeReleaseOutputEnvelope(input: ReleaseOutputEnvelope): string {
  return canonicalizeReleaseJson({
    artifactType: input.outputContract.artifactType,
    expectedShape: input.outputContract.expectedShape,
    consequenceType: input.outputContract.consequenceType,
    riskClass: input.outputContract.riskClass,
    payload: input.payload,
  });
}

export function canonicalizeReleaseConsequenceEnvelope(
  input: ReleaseConsequenceEnvelope,
): string {
  return canonicalizeReleaseJson({
    consequenceType: input.consequenceType,
    target: {
      kind: input.target.kind,
      id: input.target.id,
    },
    recipientId: input.recipientId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    payload: input.payload,
  });
}

export function createCanonicalReleaseHashBundle(
  input: CreateCanonicalReleaseHashBundleInput,
): CanonicalReleaseHashBundle {
  const outputCanonical = canonicalizeReleaseOutputEnvelope({
    outputContract: input.outputContract,
    payload: input.outputPayload,
  });
  const consequenceCanonical = canonicalizeReleaseConsequenceEnvelope({
    consequenceType: input.outputContract.consequenceType,
    target: input.target,
    payload: input.consequencePayload,
    recipientId: input.recipientId,
    idempotencyKey: input.idempotencyKey,
  });

  return {
    version: RELEASE_CANONICALIZATION_SPEC_VERSION,
    outputCanonical,
    consequenceCanonical,
    outputHash: `sha256:${sha256Hex(outputCanonical)}`,
    consequenceHash: `sha256:${sha256Hex(consequenceCanonical)}`,
  };
}
