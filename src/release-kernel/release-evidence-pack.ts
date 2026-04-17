import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import type {
  EvidenceArtifactReference,
  EvidencePack,
  ReleaseDecision,
} from './object-model.js';
import { EVIDENCE_PACK_SPEC_VERSION, retentionClassForRiskClass } from './object-model.js';
import { canonicalizeReleaseJson } from './release-canonicalization.js';
import type { ReleaseDecisionLogEntry } from './release-decision-log.js';
import type { IssuedReleaseToken } from './release-token.js';
import { derivePublicKeyIdentity } from '../signing/keys.js';
import type { ReleaseReviewerQueueDetail } from './reviewer-queue.js';

/**
 * Durable release evidence export.
 *
 * Current attestation systems increasingly separate short-lived authorization
 * from longer-lived signed evidence. Here we keep the release token as the
 * online gate and emit a portable DSSE-wrapped in-toto-style statement for the
 * durable proof plane.
 */

export const RELEASE_EVIDENCE_PACK_ISSUANCE_SPEC_VERSION =
  'attestor.release-evidence-pack-issuance.v1';
export const RELEASE_EVIDENCE_PACK_VERIFICATION_KEY_SPEC_VERSION =
  'attestor.release-evidence-pack-verification-key.v1';
export const RELEASE_EVIDENCE_PACK_VERIFICATION_SPEC_VERSION =
  'attestor.release-evidence-pack-verification.v1';
export const RELEASE_EVIDENCE_PACK_DSSE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';
export const RELEASE_EVIDENCE_PACK_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
export const RELEASE_EVIDENCE_PACK_PREDICATE_TYPE =
  'https://attestor.ai/attestation/release-evidence/v1';

export type ReleaseEvidencePackSigningAlgorithm = 'Ed25519';

export interface ReleaseEvidenceVerificationKey {
  readonly version: typeof RELEASE_EVIDENCE_PACK_VERIFICATION_KEY_SPEC_VERSION;
  readonly issuer: string;
  readonly algorithm: ReleaseEvidencePackSigningAlgorithm;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
  readonly publicKeyPem: string;
}

export interface ReleaseEvidenceStatementSubject {
  readonly name: string;
  readonly digest: {
    readonly sha256: string;
  };
}

export interface ReleaseEvidenceDecisionSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly status: ReleaseDecision['status'];
  readonly consequenceType: ReleaseDecision['consequenceType'];
  readonly riskClass: ReleaseDecision['riskClass'];
  readonly policyVersion: string;
  readonly targetId: string;
  readonly targetDisplayName: string | null;
  readonly requesterId: string;
  readonly requesterType: ReleaseDecision['requester']['type'];
  readonly requesterLabel: string | null;
  readonly releaseTokenId: string | null;
  readonly evidencePackId: string;
  readonly override: {
    readonly reasonCode: string;
    readonly ticketId: string | null;
    readonly requestedById: string;
    readonly requestedByLabel: string | null;
    readonly requestedByRole: string | null;
  } | null;
}

export interface ReleaseEvidenceDecisionLogSummary {
  readonly entryCount: number;
  readonly latestEntryDigest: string | null;
  readonly chainIntact: boolean;
  readonly phases: readonly ReleaseDecisionLogEntry['phase'][];
}

export interface ReleaseEvidenceReviewSummary {
  readonly reviewId: string;
  readonly status: ReleaseReviewerQueueDetail['status'];
  readonly authorityState: ReleaseReviewerQueueDetail['authorityState'];
  readonly approvalsRecorded: number;
  readonly approvalsRemaining: number;
  readonly reviewerDecisionCount: number;
  readonly overrideReasonCode: string | null;
}

export interface ReleaseEvidenceTokenSummary {
  readonly tokenId: string;
  readonly audience: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly override: boolean;
  readonly introspectionRequired: boolean;
}

export interface ReleaseEvidencePredicate {
  readonly version: typeof RELEASE_EVIDENCE_PACK_ISSUANCE_SPEC_VERSION;
  readonly exportedAt: string;
  readonly evidencePack: EvidencePack;
  readonly decision: ReleaseEvidenceDecisionSummary;
  readonly decisionLog: ReleaseEvidenceDecisionLogSummary;
  readonly review: ReleaseEvidenceReviewSummary | null;
  readonly releaseToken: ReleaseEvidenceTokenSummary | null;
}

export interface ReleaseEvidenceStatement {
  readonly _type: typeof RELEASE_EVIDENCE_PACK_STATEMENT_TYPE;
  readonly subject: readonly ReleaseEvidenceStatementSubject[];
  readonly predicateType: typeof RELEASE_EVIDENCE_PACK_PREDICATE_TYPE;
  readonly predicate: ReleaseEvidencePredicate;
}

export interface ReleaseEvidenceDsseSignature {
  readonly keyid: string;
  readonly sig: string;
}

export interface ReleaseEvidenceDsseEnvelope {
  readonly payloadType: typeof RELEASE_EVIDENCE_PACK_DSSE_PAYLOAD_TYPE;
  readonly payload: string;
  readonly signatures: readonly ReleaseEvidenceDsseSignature[];
}

export interface IssuedReleaseEvidencePack {
  readonly version: typeof RELEASE_EVIDENCE_PACK_ISSUANCE_SPEC_VERSION;
  readonly evidencePack: EvidencePack;
  readonly statement: ReleaseEvidenceStatement;
  readonly envelope: ReleaseEvidenceDsseEnvelope;
  readonly verificationKey: ReleaseEvidenceVerificationKey;
  readonly bundleDigest: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
}

export interface ReleaseEvidencePackIssueInput {
  readonly decision: ReleaseDecision;
  readonly evidencePackId?: string;
  readonly issuedAt?: string;
  readonly decisionLogEntries: readonly ReleaseDecisionLogEntry[];
  readonly decisionLogChainIntact?: boolean;
  readonly review?: ReleaseReviewerQueueDetail | null;
  readonly releaseToken?: IssuedReleaseToken | null;
  readonly artifactReferences?: readonly EvidenceArtifactReference[];
}

export interface CreateReleaseEvidencePackIssuerInput {
  readonly issuer: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  readonly keyId?: string;
  readonly algorithm?: ReleaseEvidencePackSigningAlgorithm;
}

export interface VerifyReleaseEvidencePackInput {
  readonly issuedEvidencePack: IssuedReleaseEvidencePack;
  readonly verificationKey?: ReleaseEvidenceVerificationKey;
}

export interface ReleaseEvidencePackVerificationResult {
  readonly version: typeof RELEASE_EVIDENCE_PACK_VERIFICATION_SPEC_VERSION;
  readonly valid: true;
  readonly evidencePackId: string;
  readonly keyId: string;
  readonly predicateType: string;
  readonly subjectCount: number;
  readonly bundleDigest: string;
}

export interface ReleaseEvidencePackIssuer {
  issue(input: ReleaseEvidencePackIssueInput): Promise<IssuedReleaseEvidencePack>;
  exportVerificationKey(): ReleaseEvidenceVerificationKey;
}

export interface ReleaseEvidencePackStore {
  upsert(pack: IssuedReleaseEvidencePack): IssuedReleaseEvidencePack;
  get(id: string): IssuedReleaseEvidencePack | null;
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function taggedSha256Hex(value: string | Buffer): string {
  return `sha256:${sha256Hex(value)}`;
}

function stripSha256Prefix(value: string): string {
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}

function canonicalDigest(value: unknown): string {
  return taggedSha256Hex(canonicalizeReleaseJson(value as never));
}

function resolveIssuedAt(issuedAt?: string): string {
  const resolved = issuedAt ? new Date(issuedAt) : new Date();
  if (Number.isNaN(resolved.getTime())) {
    throw new Error('Release evidence pack issuance requires a valid issuedAt timestamp.');
  }

  return resolved.toISOString();
}

function releaseDecisionRetentionClass(decision: ReleaseDecision): EvidencePack['retentionClass'] {
  const retention = decision.releaseConditions.items.find(
    (item): item is Extract<ReleaseDecision['releaseConditions']['items'][number], { kind: 'retention' }> =>
      item.kind === 'retention',
  );
  return retention?.retentionClass ?? retentionClassForRiskClass(decision.riskClass);
}

function summarizeDecisionLog(
  entries: readonly ReleaseDecisionLogEntry[],
  chainIntactOverride?: boolean,
): ReleaseEvidenceDecisionLogSummary {
  return {
    entryCount: entries.length,
    latestEntryDigest: entries.at(-1)?.entryDigest ?? null,
    chainIntact:
      chainIntactOverride ??
      entries.every((entry) => typeof entry.entryDigest === 'string' && entry.entryDigest.length > 0),
    phases: Object.freeze(entries.map((entry) => entry.phase)),
  };
}

function summarizeReview(detail?: ReleaseReviewerQueueDetail | null): ReleaseEvidenceReviewSummary | null {
  if (!detail) {
    return null;
  }

  return {
    reviewId: detail.id,
    status: detail.status,
    authorityState: detail.authorityState,
    approvalsRecorded: detail.approvalsRecorded,
    approvalsRemaining: detail.approvalsRemaining,
    reviewerDecisionCount: detail.reviewerDecisions.length,
    overrideReasonCode: detail.overrideGrant?.reasonCode ?? null,
  };
}

function summarizeReleaseToken(
  issuedToken?: IssuedReleaseToken | null,
): ReleaseEvidenceTokenSummary | null {
  if (!issuedToken) {
    return null;
  }

  return {
    tokenId: issuedToken.tokenId,
    audience: issuedToken.claims.aud,
    issuedAt: issuedToken.issuedAt,
    expiresAt: issuedToken.expiresAt,
    override: issuedToken.claims.override,
    introspectionRequired: issuedToken.claims.introspection_required,
  };
}

function summarizeDecision(
  decision: ReleaseDecision,
  evidencePackId: string,
): ReleaseEvidenceDecisionSummary {
  return {
    id: decision.id,
    createdAt: decision.createdAt,
    status: decision.status,
    consequenceType: decision.consequenceType,
    riskClass: decision.riskClass,
    policyVersion: decision.policyVersion,
    targetId: decision.target.id,
    targetDisplayName: decision.target.displayName ?? null,
    requesterId: decision.requester.id,
    requesterType: decision.requester.type,
    requesterLabel: decision.requester.displayName ?? null,
    releaseTokenId: decision.releaseTokenId,
    evidencePackId,
    override: decision.override
      ? {
          reasonCode: decision.override.reasonCode,
          ticketId: decision.override.ticketId ?? null,
          requestedById: decision.override.requestedBy.id,
          requestedByLabel: decision.override.requestedBy.displayName ?? null,
          requestedByRole: decision.override.requestedBy.role ?? null,
        }
      : null,
  };
}

function buildArtifactReferences(input: {
  readonly decision: ReleaseDecision;
  readonly decisionLogEntries: readonly ReleaseDecisionLogEntry[];
  readonly review: ReleaseReviewerQueueDetail | null;
  readonly releaseToken: IssuedReleaseToken | null;
  readonly artifactReferences: readonly EvidenceArtifactReference[];
}): readonly EvidenceArtifactReference[] {
  const artifacts: EvidenceArtifactReference[] = [
    {
      kind: 'other',
      path: `release-decision-log://${input.decision.id}`,
      digest: canonicalDigest(
        input.decisionLogEntries.map((entry) => ({
          entryId: entry.entryId,
          phase: entry.phase,
          entryDigest: entry.entryDigest,
          previousEntryDigest: entry.previousEntryDigest,
        })),
      ),
    },
    ...input.artifactReferences,
  ];

  if (input.review) {
    artifacts.push({
      kind: 'review-record',
      path: `release-review://${input.review.id}`,
      digest: canonicalDigest({
        id: input.review.id,
        status: input.review.status,
        authorityState: input.review.authorityState,
        reviewerDecisions: input.review.reviewerDecisions,
        timeline: input.review.timeline,
      }),
    });
  }

  if (input.releaseToken) {
    artifacts.push({
      kind: 'signature',
      path: `release-token://${input.releaseToken.tokenId}`,
      digest: taggedSha256Hex(input.releaseToken.token),
    });
  }

  return Object.freeze(
    artifacts.map((artifact) =>
      Object.freeze({
        kind: artifact.kind,
        path: artifact.path,
        digest: artifact.digest,
      }),
    ),
  );
}

function buildEvidencePack(
  decision: ReleaseDecision,
  evidencePackId: string,
  artifacts: readonly EvidenceArtifactReference[],
): EvidencePack {
  return Object.freeze({
    version: EVIDENCE_PACK_SPEC_VERSION,
    id: evidencePackId,
    outputHash: decision.outputHash,
    consequenceHash: decision.consequenceHash,
    policyVersion: decision.policyVersion,
    policyHash: decision.policyHash,
    retentionClass: releaseDecisionRetentionClass(decision),
    findings: Object.freeze(decision.findings.map((finding) => Object.freeze({ ...finding }))),
    artifacts,
  });
}

function buildStatement(
  input: {
    readonly decision: ReleaseDecision;
    readonly evidencePack: EvidencePack;
    readonly decisionLogSummary: ReleaseEvidenceDecisionLogSummary;
    readonly review: ReleaseEvidenceReviewSummary | null;
    readonly releaseToken: ReleaseEvidenceTokenSummary | null;
    readonly exportedAt: string;
  },
): ReleaseEvidenceStatement {
  return Object.freeze({
    _type: RELEASE_EVIDENCE_PACK_STATEMENT_TYPE,
    subject: Object.freeze([
      Object.freeze({
        name: `release-output/${input.decision.id}`,
        digest: Object.freeze({
          sha256: stripSha256Prefix(input.decision.outputHash),
        }),
      }),
      Object.freeze({
        name: `release-consequence/${input.decision.target.id}`,
        digest: Object.freeze({
          sha256: stripSha256Prefix(input.decision.consequenceHash),
        }),
      }),
    ]),
    predicateType: RELEASE_EVIDENCE_PACK_PREDICATE_TYPE,
    predicate: Object.freeze({
      version: RELEASE_EVIDENCE_PACK_ISSUANCE_SPEC_VERSION,
      exportedAt: input.exportedAt,
      evidencePack: input.evidencePack,
      decision: summarizeDecision(input.decision, input.evidencePack.id),
      decisionLog: input.decisionLogSummary,
      review: input.review,
      releaseToken: input.releaseToken,
    }),
  });
}

function dssePreAuthEncoding(payloadType: string, payload: Buffer): Buffer {
  const payloadTypeBuffer = Buffer.from(payloadType, 'utf-8');
  return Buffer.concat([
    Buffer.from('DSSEv1 ', 'utf-8'),
    Buffer.from(String(payloadTypeBuffer.length), 'utf-8'),
    Buffer.from(' ', 'utf-8'),
    payloadTypeBuffer,
    Buffer.from(' ', 'utf-8'),
    Buffer.from(String(payload.length), 'utf-8'),
    Buffer.from(' ', 'utf-8'),
    payload,
  ]);
}

function buildBundleDigest(input: {
  readonly evidencePack: EvidencePack;
  readonly statement: ReleaseEvidenceStatement;
  readonly envelope: ReleaseEvidenceDsseEnvelope;
  readonly verificationKey: ReleaseEvidenceVerificationKey;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
}): string {
  return canonicalDigest({
    version: RELEASE_EVIDENCE_PACK_ISSUANCE_SPEC_VERSION,
    evidencePack: input.evidencePack,
    statement: input.statement,
    envelope: input.envelope,
    verificationKey: input.verificationKey,
    issuedAt: input.issuedAt,
    keyId: input.keyId,
    publicKeyFingerprint: input.publicKeyFingerprint,
  });
}

export function createReleaseEvidencePackIssuer(
  input: CreateReleaseEvidencePackIssuerInput,
): ReleaseEvidencePackIssuer {
  const algorithm = input.algorithm ?? 'Ed25519';
  const keyIdentity = derivePublicKeyIdentity(input.publicKeyPem);
  const keyId = input.keyId ?? keyIdentity.fingerprint;
  const verificationKey: ReleaseEvidenceVerificationKey = Object.freeze({
    version: RELEASE_EVIDENCE_PACK_VERIFICATION_KEY_SPEC_VERSION,
    issuer: input.issuer,
    algorithm,
    keyId,
    publicKeyFingerprint: keyIdentity.fingerprint,
    publicKeyPem: input.publicKeyPem,
  });

  return {
    async issue(issueInput: ReleaseEvidencePackIssueInput): Promise<IssuedReleaseEvidencePack> {
      const issuedAt = resolveIssuedAt(issueInput.issuedAt);
      const evidencePackId = issueInput.evidencePackId ?? `ep_${randomUUID()}`;
      const decisionSnapshot: ReleaseDecision = Object.freeze({
        ...issueInput.decision,
        evidencePackId,
        releaseTokenId: issueInput.releaseToken?.tokenId ?? issueInput.decision.releaseTokenId,
      });
      const decisionLogEntries = Object.freeze(
        issueInput.decisionLogEntries
          .filter((entry) => entry.decisionId === decisionSnapshot.id)
          .map((entry) => Object.freeze({ ...entry })),
      );
      const reviewSummary = summarizeReview(issueInput.review ?? null);
      const releaseTokenSummary = summarizeReleaseToken(issueInput.releaseToken ?? null);
      const artifacts = buildArtifactReferences({
        decision: decisionSnapshot,
        decisionLogEntries,
        review: issueInput.review ?? null,
        releaseToken: issueInput.releaseToken ?? null,
        artifactReferences: issueInput.artifactReferences ?? [],
      });
      const evidencePack = buildEvidencePack(decisionSnapshot, evidencePackId, artifacts);
      const statement = buildStatement({
        decision: decisionSnapshot,
        evidencePack,
        decisionLogSummary: summarizeDecisionLog(
          decisionLogEntries,
          issueInput.decisionLogChainIntact,
        ),
        review: reviewSummary,
        releaseToken: releaseTokenSummary,
        exportedAt: issuedAt,
      });

      const payload = Buffer.from(canonicalizeReleaseJson(statement as never), 'utf-8');
      const pae = dssePreAuthEncoding(RELEASE_EVIDENCE_PACK_DSSE_PAYLOAD_TYPE, payload);
      const signature = sign(null, pae, createPrivateKey(input.privateKeyPem));
      const envelope: ReleaseEvidenceDsseEnvelope = Object.freeze({
        payloadType: RELEASE_EVIDENCE_PACK_DSSE_PAYLOAD_TYPE,
        payload: payload.toString('base64'),
        signatures: Object.freeze([
          Object.freeze({
            keyid: keyId,
            sig: signature.toString('base64'),
          }),
        ]),
      });

      return Object.freeze({
        version: RELEASE_EVIDENCE_PACK_ISSUANCE_SPEC_VERSION,
        evidencePack,
        statement,
        envelope,
        verificationKey,
        bundleDigest: buildBundleDigest({
          evidencePack,
          statement,
          envelope,
          verificationKey,
          issuedAt,
          keyId,
          publicKeyFingerprint: keyIdentity.fingerprint,
        }),
        issuedAt,
        keyId,
        publicKeyFingerprint: keyIdentity.fingerprint,
      });
    },

    exportVerificationKey(): ReleaseEvidenceVerificationKey {
      return verificationKey;
    },
  };
}

export function verifyIssuedReleaseEvidencePack(
  input: VerifyReleaseEvidencePackInput,
): ReleaseEvidencePackVerificationResult {
  const pack = input.issuedEvidencePack;
  const verificationKey = input.verificationKey ?? pack.verificationKey;
  const payload = Buffer.from(pack.envelope.payload, 'base64');
  const pae = dssePreAuthEncoding(pack.envelope.payloadType, payload);
  const signature = pack.envelope.signatures[0];
  if (!signature) {
    throw new Error('Release evidence pack is missing DSSE signatures.');
  }

  const valid = verify(
    null,
    pae,
    createPublicKey(verificationKey.publicKeyPem),
    Buffer.from(signature.sig, 'base64'),
  );
  if (!valid) {
    throw new Error('Release evidence pack DSSE signature is invalid.');
  }

  const statement = JSON.parse(payload.toString('utf-8')) as ReleaseEvidenceStatement;
  if (
    statement._type !== RELEASE_EVIDENCE_PACK_STATEMENT_TYPE ||
    statement.predicateType !== RELEASE_EVIDENCE_PACK_PREDICATE_TYPE
  ) {
    throw new Error('Release evidence pack statement type is not recognized.');
  }

  if (statement.predicate.evidencePack.id !== pack.evidencePack.id) {
    throw new Error('Release evidence pack payload does not match the exported pack id.');
  }

  if (statement.subject.length < 2) {
    throw new Error('Release evidence pack statement subjects are incomplete.');
  }

  const expectedBundleDigest = buildBundleDigest({
    evidencePack: pack.evidencePack,
    statement: pack.statement,
    envelope: pack.envelope,
    verificationKey: pack.verificationKey,
    issuedAt: pack.issuedAt,
    keyId: pack.keyId,
    publicKeyFingerprint: pack.publicKeyFingerprint,
  });
  if (expectedBundleDigest !== pack.bundleDigest) {
    throw new Error('Release evidence pack bundle digest does not match its contents.');
  }

  return {
    version: RELEASE_EVIDENCE_PACK_VERIFICATION_SPEC_VERSION,
    valid: true,
    evidencePackId: pack.evidencePack.id,
    keyId: signature.keyid,
    predicateType: statement.predicateType,
    subjectCount: statement.subject.length,
    bundleDigest: pack.bundleDigest,
  };
}

export function createInMemoryReleaseEvidencePackStore(): ReleaseEvidencePackStore {
  const items = new Map<string, IssuedReleaseEvidencePack>();

  return {
    upsert(pack: IssuedReleaseEvidencePack): IssuedReleaseEvidencePack {
      const stored = Object.freeze({
        ...pack,
        evidencePack: Object.freeze({
          ...pack.evidencePack,
          findings: Object.freeze(pack.evidencePack.findings.map((finding) => Object.freeze({ ...finding }))),
          artifacts: Object.freeze(pack.evidencePack.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
        }),
        statement: Object.freeze({
          ...pack.statement,
          subject: Object.freeze(pack.statement.subject.map((subject) => Object.freeze({
            ...subject,
            digest: Object.freeze({ ...subject.digest }),
          }))),
          predicate: Object.freeze(pack.statement.predicate),
        }),
        envelope: Object.freeze({
          ...pack.envelope,
          signatures: Object.freeze(pack.envelope.signatures.map((entry) => Object.freeze({ ...entry }))),
        }),
        verificationKey: Object.freeze({ ...pack.verificationKey }),
      });
      items.set(stored.evidencePack.id, stored);
      return stored;
    },
    get(id: string): IssuedReleaseEvidencePack | null {
      return items.get(id) ?? null;
    },
  };
}
