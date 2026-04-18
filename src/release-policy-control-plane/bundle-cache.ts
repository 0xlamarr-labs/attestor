import type { StoredPolicyBundleRecord } from './store.js';

/**
 * Bundle cache and freshness controls.
 *
 * Step 17 makes policy-bundle loading deterministic for consumers: every
 * bundle resource has a strong ETag, explicit freshness windows, cache headers,
 * and a fail-closed expiry point for stale policy material.
 */

export const POLICY_BUNDLE_CACHE_POLICY_SPEC_VERSION =
  'attestor.policy-bundle-cache-policy.v1';
export const POLICY_BUNDLE_CACHE_DESCRIPTOR_SPEC_VERSION =
  'attestor.policy-bundle-cache-descriptor.v1';

export const DEFAULT_POLICY_BUNDLE_MAX_AGE_SECONDS = 60;
export const DEFAULT_POLICY_BUNDLE_STALE_IF_ERROR_SECONDS = 300;

export type PolicyBundleFreshnessState =
  | 'fresh'
  | 'stale-if-error'
  | 'expired';

export type PolicyBundleConditionalStatus = 'modified' | 'not-modified';

export interface PolicyBundleCachePolicy {
  readonly version: typeof POLICY_BUNDLE_CACHE_POLICY_SPEC_VERSION;
  readonly validator: 'strong-etag';
  readonly maxAgeSeconds: number;
  readonly staleIfErrorSeconds: number;
  readonly failureMode: 'fail-closed-after-stale-if-error';
  readonly persistAcrossRestart: boolean;
}

export interface PolicyBundleCacheDescriptor {
  readonly version: typeof POLICY_BUNDLE_CACHE_DESCRIPTOR_SPEC_VERSION;
  readonly resource: string;
  readonly etag: string;
  readonly digest: string;
  readonly packId: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly storedAt: string;
  readonly validatedAt: string;
  readonly evaluatedAt: string;
  readonly freshUntil: string;
  readonly staleIfErrorUntil: string;
  readonly ageSeconds: number;
  readonly freshness: PolicyBundleFreshnessState;
  readonly cacheControl: string;
  readonly persisted: boolean;
  readonly policy: PolicyBundleCachePolicy;
}

export interface CreatePolicyBundleCachePolicyInput {
  readonly maxAgeSeconds?: number;
  readonly staleIfErrorSeconds?: number;
  readonly persistAcrossRestart?: boolean;
}

export interface CreatePolicyBundleCacheDescriptorInput
  extends CreatePolicyBundleCachePolicyInput {
  readonly now?: string;
  readonly validatedAt?: string;
  readonly persisted?: boolean;
}

export interface PolicyBundleConditionalResponse {
  readonly status: PolicyBundleConditionalStatus;
  readonly descriptor: PolicyBundleCacheDescriptor;
}

function normalizePositiveInteger(value: number | undefined, fieldName: string): number {
  if (value === undefined) {
    throw new Error(`${fieldName} must be provided.`);
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Policy bundle cache ${fieldName} must be a valid ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function addSeconds(isoTimestamp: string, seconds: number): string {
  return new Date(Date.parse(isoTimestamp) + seconds * 1000).toISOString();
}

function ageSeconds(validatedAt: string, evaluatedAt: string): number {
  return Math.max(0, Math.floor((Date.parse(evaluatedAt) - Date.parse(validatedAt)) / 1000));
}

function httpDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toUTCString();
}

export function createPolicyBundleResourcePath(record: StoredPolicyBundleRecord): string {
  return (
    `policy-bundles/${encodeURIComponent(record.packId)}/` +
    `${encodeURIComponent(record.bundleId)}`
  );
}

export function createPolicyBundleCachePolicy(
  input: CreatePolicyBundleCachePolicyInput = {},
): PolicyBundleCachePolicy {
  return Object.freeze({
    version: POLICY_BUNDLE_CACHE_POLICY_SPEC_VERSION,
    validator: 'strong-etag',
    maxAgeSeconds: normalizePositiveInteger(
      input.maxAgeSeconds ?? DEFAULT_POLICY_BUNDLE_MAX_AGE_SECONDS,
      'maxAgeSeconds',
    ),
    staleIfErrorSeconds: normalizePositiveInteger(
      input.staleIfErrorSeconds ?? DEFAULT_POLICY_BUNDLE_STALE_IF_ERROR_SECONDS,
      'staleIfErrorSeconds',
    ),
    failureMode: 'fail-closed-after-stale-if-error',
    persistAcrossRestart: input.persistAcrossRestart ?? true,
  });
}

export function policyBundleStrongEtag(record: StoredPolicyBundleRecord): string {
  const digest = record.signedBundle?.signatureRecord.payloadDigest ?? record.artifact.payloadDigest;
  return `"${digest}"`;
}

export function policyBundleCacheControlHeader(
  policy: PolicyBundleCachePolicy = createPolicyBundleCachePolicy(),
): string {
  return [
    'private',
    `max-age=${policy.maxAgeSeconds}`,
    `stale-if-error=${policy.staleIfErrorSeconds}`,
  ].join(', ');
}

function resolveFreshness(input: {
  readonly evaluatedAt: string;
  readonly freshUntil: string;
  readonly staleIfErrorUntil: string;
}): PolicyBundleFreshnessState {
  if (Date.parse(input.evaluatedAt) <= Date.parse(input.freshUntil)) {
    return 'fresh';
  }
  if (Date.parse(input.evaluatedAt) <= Date.parse(input.staleIfErrorUntil)) {
    return 'stale-if-error';
  }
  return 'expired';
}

export function createPolicyBundleCacheDescriptor(
  record: StoredPolicyBundleRecord,
  input: CreatePolicyBundleCacheDescriptorInput = {},
): PolicyBundleCacheDescriptor {
  const policy = createPolicyBundleCachePolicy(input);
  const validatedAt = normalizeIsoTimestamp(
    input.validatedAt ?? input.now ?? record.storedAt,
    'validatedAt',
  );
  const evaluatedAt = normalizeIsoTimestamp(input.now ?? validatedAt, 'evaluatedAt');
  const freshUntil = addSeconds(validatedAt, policy.maxAgeSeconds);
  const staleIfErrorUntil = addSeconds(freshUntil, policy.staleIfErrorSeconds);

  return Object.freeze({
    version: POLICY_BUNDLE_CACHE_DESCRIPTOR_SPEC_VERSION,
    resource: createPolicyBundleResourcePath(record),
    etag: policyBundleStrongEtag(record),
    digest: record.manifest.bundle.digest,
    packId: record.packId,
    bundleId: record.bundleId,
    bundleVersion: record.bundleVersion,
    storedAt: normalizeIsoTimestamp(record.storedAt, 'storedAt'),
    validatedAt,
    evaluatedAt,
    freshUntil,
    staleIfErrorUntil,
    ageSeconds: ageSeconds(validatedAt, evaluatedAt),
    freshness: resolveFreshness({ evaluatedAt, freshUntil, staleIfErrorUntil }),
    cacheControl: policyBundleCacheControlHeader(policy),
    persisted: input.persisted ?? policy.persistAcrossRestart,
    policy,
  });
}

function normalizeEntityTag(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }
  return `"${trimmed}"`;
}

export function policyBundleEtagMatches(
  ifNoneMatchHeader: string | null | undefined,
  descriptor: PolicyBundleCacheDescriptor,
): boolean {
  if (!ifNoneMatchHeader || ifNoneMatchHeader.trim().length === 0) {
    return false;
  }

  return ifNoneMatchHeader
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => {
      if (candidate === '*') {
        return true;
      }
      if (candidate.startsWith('W/')) {
        return false;
      }
      return normalizeEntityTag(candidate) === descriptor.etag;
    });
}

export function createPolicyBundleConditionalResponse(
  record: StoredPolicyBundleRecord,
  ifNoneMatchHeader: string | null | undefined,
  input: CreatePolicyBundleCacheDescriptorInput = {},
): PolicyBundleConditionalResponse {
  const descriptor = createPolicyBundleCacheDescriptor(record, input);
  return Object.freeze({
    status: policyBundleEtagMatches(ifNoneMatchHeader, descriptor)
      ? 'not-modified'
      : 'modified',
    descriptor,
  });
}

export function policyBundleCacheHeaders(
  descriptor: PolicyBundleCacheDescriptor,
): Readonly<Record<string, string>> {
  return Object.freeze({
    etag: descriptor.etag,
    'cache-control': descriptor.cacheControl,
    'last-modified': httpDate(descriptor.storedAt),
    'x-attestor-policy-bundle-digest': descriptor.digest,
    'x-attestor-policy-bundle-version': descriptor.bundleVersion,
    'x-attestor-policy-bundle-freshness': descriptor.freshness,
    'x-attestor-policy-bundle-fresh-until': descriptor.freshUntil,
    'x-attestor-policy-bundle-stale-if-error-until': descriptor.staleIfErrorUntil,
    'x-attestor-policy-bundle-failure-mode': descriptor.policy.failureMode,
    'x-attestor-policy-bundle-persisted': String(descriptor.persisted),
  });
}
