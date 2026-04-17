import { createHash } from 'node:crypto';
import { canonicalizeReleaseJson } from '../release-kernel/release-canonicalization.js';
import {
  type PolicyBundleEntry,
  type PolicyBundleManifest,
  type PolicyPackMetadata,
  type PolicySchemaReference,
} from './object-model.js';

/**
 * Portable policy-bundle artifact format.
 *
 * Step 04 freezes the signable bundle shape before any signing or verification
 * logic exists. The goal is to make policy packs portable, hashable, and
 * DSSE-ready so Step 05 can layer cryptography on top of a stable artifact,
 * rather than inventing the artifact and the signature contract at the same
 * time.
 */

export const POLICY_BUNDLE_FORMAT_SPEC_VERSION = 'attestor.policy-bundle-format.v1';
export const POLICY_BUNDLE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';
export const POLICY_BUNDLE_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
export const POLICY_BUNDLE_PREDICATE_TYPE =
  'https://attestor.ai/attestation/policy-bundle/v1';

export interface PolicyBundleStatementSubject {
  readonly name: string;
  readonly digest: {
    readonly sha256: string;
  };
}

export interface PolicyBundlePredicate {
  readonly version: typeof POLICY_BUNDLE_FORMAT_SPEC_VERSION;
  readonly pack: PolicyPackMetadata;
  readonly manifest: PolicyBundleManifest;
  readonly entries: readonly PolicyBundleEntry[];
  readonly schemas: readonly PolicySchemaReference[];
}

export interface PolicyBundleStatement {
  readonly _type: typeof POLICY_BUNDLE_STATEMENT_TYPE;
  readonly subject: readonly PolicyBundleStatementSubject[];
  readonly predicateType: typeof POLICY_BUNDLE_PREDICATE_TYPE;
  readonly predicate: PolicyBundlePredicate;
}

export interface SignablePolicyBundleArtifact {
  readonly version: typeof POLICY_BUNDLE_FORMAT_SPEC_VERSION;
  readonly bundleId: string;
  readonly packId: string;
  readonly payloadType: typeof POLICY_BUNDLE_PAYLOAD_TYPE;
  readonly statement: PolicyBundleStatement;
  readonly canonicalPayload: string;
  readonly payloadDigest: string;
  readonly packDigest: string;
  readonly manifestDigest: string;
  readonly entriesDigest: string;
  readonly schemasDigest: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function taggedDigest(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

function stripSha256Prefix(value: string): string {
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}

function normalizePackMetadata(pack: PolicyPackMetadata): PolicyPackMetadata {
  return Object.freeze({
    ...pack,
    owners: Object.freeze([...pack.owners].sort()),
    labels: Object.freeze([...pack.labels].sort()),
  });
}

function normalizeSchemas(
  schemas: readonly PolicySchemaReference[],
): readonly PolicySchemaReference[] {
  return Object.freeze(
    [...schemas]
      .map((schema) =>
        Object.freeze({
          ...schema,
        }),
      )
      .sort((left, right) => {
        return (
          left.id.localeCompare(right.id) ||
          left.version.localeCompare(right.version) ||
          left.uri.localeCompare(right.uri)
        );
      }),
  );
}

function normalizeEntries(
  entries: readonly PolicyBundleEntry[],
): readonly PolicyBundleEntry[] {
  return Object.freeze(
    [...entries]
      .map((entry) =>
        Object.freeze({
          ...entry,
          scope: Object.freeze({
            ...entry.scope,
            dimensions: Object.freeze([...entry.scope.dimensions]),
          }),
          definition: Object.freeze(entry.definition),
          rollout: Object.freeze(entry.rollout),
        }),
      )
      .sort((left, right) => {
        return (
          left.id.localeCompare(right.id) ||
          left.policyId.localeCompare(right.policyId) ||
          left.scope.environment.localeCompare(right.scope.environment)
        );
      }),
  );
}

function normalizeManifest(
  manifest: PolicyBundleManifest,
  entries: readonly PolicyBundleEntry[],
  schemas: readonly PolicySchemaReference[],
): PolicyBundleManifest {
  return Object.freeze({
    ...manifest,
    bundleLabels: Object.freeze([...manifest.bundleLabels].sort()),
    schemas,
    entries,
  });
}

export function computePolicyBundleEntryDigest(entry: PolicyBundleEntry): string {
  return taggedDigest(
    canonicalizeReleaseJson({
      id: entry.id,
      policyId: entry.policyId,
      scope: {
        environment: entry.scope.environment,
        tenantId: entry.scope.tenantId,
        accountId: entry.scope.accountId,
        domainId: entry.scope.domainId,
        wedgeId: entry.scope.wedgeId,
        consequenceType: entry.scope.consequenceType,
        riskClass: entry.scope.riskClass,
        planId: entry.scope.planId,
        dimensions: entry.scope.dimensions,
      },
      definition: entry.definition as never,
      rollout: entry.rollout as never,
    } as never),
  );
}

function computeDigest(value: unknown): string {
  return taggedDigest(canonicalizeReleaseJson(value as never));
}

function assertBundleIntegrity(
  pack: PolicyPackMetadata,
  manifest: PolicyBundleManifest,
  entries: readonly PolicyBundleEntry[],
): void {
  if (manifest.packId !== pack.id || manifest.bundle.packId !== pack.id) {
    throw new Error('Policy bundle format requires manifest and bundle pack ids to match the pack metadata.');
  }

  const seenEntryIds = new Set<string>();
  for (const entry of entries) {
    if (seenEntryIds.has(entry.id)) {
      throw new Error(`Policy bundle format requires unique entry ids; duplicate '${entry.id}' found.`);
    }
    seenEntryIds.add(entry.id);

    const expectedDigest = computePolicyBundleEntryDigest(entry);
    if (entry.policyHash !== expectedDigest) {
      throw new Error(
        `Policy bundle entry '${entry.id}' has policyHash '${entry.policyHash}' but expected '${expectedDigest}'.`,
      );
    }
  }
}

export function createSignablePolicyBundleArtifact(
  pack: PolicyPackMetadata,
  manifest: PolicyBundleManifest,
): SignablePolicyBundleArtifact {
  const normalizedPack = normalizePackMetadata(pack);
  const normalizedSchemas = normalizeSchemas(manifest.schemas);
  const normalizedEntries = normalizeEntries(manifest.entries);
  assertBundleIntegrity(normalizedPack, manifest, normalizedEntries);
  const normalizedManifest = normalizeManifest(manifest, normalizedEntries, normalizedSchemas);

  const packDigest = computeDigest(normalizedPack);
  const manifestDigest = computeDigest({
    ...normalizedManifest,
    entries: normalizedManifest.entries.map((entry) => entry.id),
    schemas: normalizedManifest.schemas.map((schema) => ({
      id: schema.id,
      version: schema.version,
      uri: schema.uri,
      digest: schema.digest,
    })),
  });
  const entriesDigest = computeDigest(
    normalizedEntries.map((entry) => ({
      id: entry.id,
      policyHash: entry.policyHash,
    })),
  );
  const schemasDigest = computeDigest(
    normalizedSchemas.map((schema) => ({
      id: schema.id,
      version: schema.version,
      uri: schema.uri,
      digest: schema.digest,
    })),
  );

  const statement: PolicyBundleStatement = Object.freeze({
    _type: POLICY_BUNDLE_STATEMENT_TYPE,
    subject: Object.freeze([
      Object.freeze({
        name: `policy-pack/${normalizedPack.id}`,
        digest: Object.freeze({
          sha256: stripSha256Prefix(packDigest),
        }),
      }),
      Object.freeze({
        name: `policy-bundle-manifest/${normalizedManifest.bundle.bundleId}`,
        digest: Object.freeze({
          sha256: stripSha256Prefix(manifestDigest),
        }),
      }),
      Object.freeze({
        name: `policy-bundle-entries/${normalizedManifest.bundle.bundleId}`,
        digest: Object.freeze({
          sha256: stripSha256Prefix(entriesDigest),
        }),
      }),
      Object.freeze({
        name: `policy-bundle-schemas/${normalizedManifest.bundle.bundleId}`,
        digest: Object.freeze({
          sha256: stripSha256Prefix(schemasDigest),
        }),
      }),
    ]),
    predicateType: POLICY_BUNDLE_PREDICATE_TYPE,
    predicate: Object.freeze({
      version: POLICY_BUNDLE_FORMAT_SPEC_VERSION,
      pack: normalizedPack,
      manifest: normalizedManifest,
      entries: normalizedEntries,
      schemas: normalizedSchemas,
    }),
  });

  const canonicalPayload = canonicalizeReleaseJson(statement as never);

  return Object.freeze({
    version: POLICY_BUNDLE_FORMAT_SPEC_VERSION,
    bundleId: normalizedManifest.bundle.bundleId,
    packId: normalizedPack.id,
    payloadType: POLICY_BUNDLE_PAYLOAD_TYPE,
    statement,
    canonicalPayload,
    payloadDigest: taggedDigest(canonicalPayload),
    packDigest,
    manifestDigest,
    entriesDigest,
    schemasDigest,
  });
}
