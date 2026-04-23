import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  ConsequenceType,
  RiskClass,
} from '../release-kernel/types.js';
import type {
  CryptoExecutionAdmissionOutcome,
} from '../crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationConsequenceKind,
} from '../crypto-authorization-core/types.js';

export const CONSEQUENCE_ADMISSION_CONTRACT_VERSION =
  'attestor.consequence-admission.v1';

export const CONSEQUENCE_ADMISSION_DECISIONS = [
  'admit',
  'narrow',
  'review',
  'block',
] as const;
export type ConsequenceAdmissionDecision =
  typeof CONSEQUENCE_ADMISSION_DECISIONS[number];

export const CONSEQUENCE_ADMISSION_PACK_FAMILIES = [
  'finance',
  'crypto',
  'general',
  'future',
] as const;
export type ConsequenceAdmissionPackFamily =
  typeof CONSEQUENCE_ADMISSION_PACK_FAMILIES[number];

export const CONSEQUENCE_ADMISSION_ENTRY_POINT_KINDS = [
  'hosted-route',
  'package-boundary',
  'local-command',
  'internal-service',
] as const;
export type ConsequenceAdmissionEntryPointKind =
  typeof CONSEQUENCE_ADMISSION_ENTRY_POINT_KINDS[number];

export const CONSEQUENCE_ADMISSION_CHECK_KINDS = [
  'policy',
  'authority',
  'evidence',
  'freshness',
  'enforcement',
  'adapter-readiness',
] as const;
export type ConsequenceAdmissionCheckKind =
  typeof CONSEQUENCE_ADMISSION_CHECK_KINDS[number];

export const CONSEQUENCE_ADMISSION_CHECK_OUTCOMES = [
  'pass',
  'warn',
  'fail',
  'not-applicable',
] as const;
export type ConsequenceAdmissionCheckOutcome =
  typeof CONSEQUENCE_ADMISSION_CHECK_OUTCOMES[number];

export const CONSEQUENCE_ADMISSION_NATIVE_SURFACES = [
  'finance-pipeline',
  'crypto-execution-admission',
  'proof-surface',
  'release-layer',
  'custom',
] as const;
export type ConsequenceAdmissionNativeSurface =
  typeof CONSEQUENCE_ADMISSION_NATIVE_SURFACES[number];

export const CONSEQUENCE_ADMISSION_PROOF_KINDS = [
  'release-token',
  'release-evidence-pack',
  'certificate',
  'verification-kit',
  'admission-plan',
  'admission-receipt',
  'conformance-fixture',
  'local-artifact',
  'source-module',
  'external-reference',
] as const;
export type ConsequenceAdmissionProofKind =
  typeof CONSEQUENCE_ADMISSION_PROOF_KINDS[number];

export type ConsequenceAdmissionConsequenceKind =
  | ConsequenceType
  | CryptoAuthorizationConsequenceKind
  | 'agent-payment'
  | 'account-delegation'
  | 'user-operation'
  | 'wallet-call'
  | 'token-approval'
  | 'custody-withdrawal'
  | 'intent-settlement'
  | 'custom';

export interface ConsequenceAdmissionEntryPoint {
  readonly kind: ConsequenceAdmissionEntryPointKind;
  readonly id: string;
  readonly route: string | null;
  readonly packageSubpath: string | null;
  readonly sourceRef: string | null;
}

export interface ConsequenceAdmissionProposedConsequence {
  readonly actor: string;
  readonly action: string;
  readonly downstreamSystem: string;
  readonly consequenceKind: ConsequenceAdmissionConsequenceKind;
  readonly riskClass: RiskClass | 'custom';
  readonly summary: string;
}

export interface ConsequenceAdmissionPolicyScope {
  readonly policyRef: string | null;
  readonly tenantId: string | null;
  readonly environment: string | null;
  readonly dimensions: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ConsequenceAdmissionAuthority {
  readonly actorRef: string | null;
  readonly reviewerRef: string | null;
  readonly signerRef: string | null;
  readonly delegationRef: string | null;
  readonly authorityMode: string | null;
}

export interface ConsequenceAdmissionEvidenceRef {
  readonly id: string;
  readonly kind: string;
  readonly digest: string | null;
  readonly uri: string | null;
}

export interface ConsequenceAdmissionRequest {
  readonly version: typeof CONSEQUENCE_ADMISSION_CONTRACT_VERSION;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly packFamily: ConsequenceAdmissionPackFamily;
  readonly entryPoint: ConsequenceAdmissionEntryPoint;
  readonly proposedConsequence: ConsequenceAdmissionProposedConsequence;
  readonly policyScope: ConsequenceAdmissionPolicyScope;
  readonly authority: ConsequenceAdmissionAuthority;
  readonly evidence: readonly ConsequenceAdmissionEvidenceRef[];
  readonly nativeInputRefs: readonly string[];
}

export interface ConsequenceAdmissionCheck {
  readonly kind: ConsequenceAdmissionCheckKind;
  readonly label: string;
  readonly outcome: ConsequenceAdmissionCheckOutcome;
  readonly required: boolean;
  readonly summary: string;
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ConsequenceAdmissionNativeDecision {
  readonly surface: ConsequenceAdmissionNativeSurface;
  readonly value: string;
  readonly mappedDecision: ConsequenceAdmissionDecision;
  readonly mappingReason: string;
}

export interface ConsequenceAdmissionConstraint {
  readonly id: string;
  readonly summary: string;
  readonly enforcedBy: string;
}

export interface ConsequenceAdmissionProofRef {
  readonly kind: ConsequenceAdmissionProofKind;
  readonly id: string;
  readonly digest: string | null;
  readonly uri: string | null;
  readonly verifyHint: string;
}

export interface ConsequenceAdmissionResponse {
  readonly version: typeof CONSEQUENCE_ADMISSION_CONTRACT_VERSION;
  readonly admissionId: string;
  readonly decidedAt: string;
  readonly request: ConsequenceAdmissionRequest;
  readonly decision: ConsequenceAdmissionDecision;
  readonly allowed: boolean;
  readonly failClosed: boolean;
  readonly reason: string;
  readonly reasonCodes: readonly string[];
  readonly checks: readonly ConsequenceAdmissionCheck[];
  readonly constraints: readonly ConsequenceAdmissionConstraint[];
  readonly nativeDecision: ConsequenceAdmissionNativeDecision | null;
  readonly proof: readonly ConsequenceAdmissionProofRef[];
  readonly operationalContext: Readonly<Record<string, string | number | boolean | null>>;
  readonly canonical: string;
  readonly digest: string;
}

export interface ConsequenceAdmissionProblem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string | null;
  readonly decision: 'block';
  readonly failClosed: true;
  readonly reasonCodes: readonly string[];
}

export interface ConsequenceAdmissionDescriptor {
  readonly version: typeof CONSEQUENCE_ADMISSION_CONTRACT_VERSION;
  readonly decisions: typeof CONSEQUENCE_ADMISSION_DECISIONS;
  readonly packFamilies: typeof CONSEQUENCE_ADMISSION_PACK_FAMILIES;
  readonly entryPointKinds: typeof CONSEQUENCE_ADMISSION_ENTRY_POINT_KINDS;
  readonly checkKinds: typeof CONSEQUENCE_ADMISSION_CHECK_KINDS;
  readonly checkOutcomes: typeof CONSEQUENCE_ADMISSION_CHECK_OUTCOMES;
  readonly proofKinds: typeof CONSEQUENCE_ADMISSION_PROOF_KINDS;
  readonly nativeSurfaces: typeof CONSEQUENCE_ADMISSION_NATIVE_SURFACES;
}

export interface CreateConsequenceAdmissionRequestInput {
  readonly requestedAt: string;
  readonly requestId?: string | null;
  readonly packFamily: ConsequenceAdmissionPackFamily;
  readonly entryPoint: ConsequenceAdmissionEntryPoint;
  readonly proposedConsequence: ConsequenceAdmissionProposedConsequence;
  readonly policyScope?: Partial<ConsequenceAdmissionPolicyScope> | null;
  readonly authority?: Partial<ConsequenceAdmissionAuthority> | null;
  readonly evidence?: readonly ConsequenceAdmissionEvidenceRef[];
  readonly nativeInputRefs?: readonly string[];
}

export interface CreateConsequenceAdmissionResponseInput {
  readonly request: ConsequenceAdmissionRequest;
  readonly decidedAt: string;
  readonly decision: ConsequenceAdmissionDecision;
  readonly reason: string;
  readonly reasonCodes?: readonly string[];
  readonly checks?: readonly ConsequenceAdmissionCheck[];
  readonly constraints?: readonly ConsequenceAdmissionConstraint[];
  readonly nativeDecision?: ConsequenceAdmissionNativeDecision | null;
  readonly proof?: readonly ConsequenceAdmissionProofRef[];
  readonly operationalContext?: Readonly<Record<string, string | number | boolean | null>>;
  readonly failClosed?: boolean | null;
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`Consequence admission ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeIdentifier(value, fieldName);
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Consequence admission ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function canonicalObject<T extends CanonicalReleaseJsonValue>(value: T): {
  readonly canonical: string;
  readonly digest: string;
} {
  const canonical = canonicalizeReleaseJson(value);
  return Object.freeze({
    canonical,
    digest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
  });
}

function requestIdFor(input: Omit<ConsequenceAdmissionRequest, 'requestId'>): string {
  return canonicalObject({
    version: input.version,
    requestedAt: input.requestedAt,
    packFamily: input.packFamily,
    entryPoint: input.entryPoint,
    proposedConsequence: input.proposedConsequence,
    policyScope: input.policyScope,
    authority: input.authority,
    evidence: input.evidence,
    nativeInputRefs: input.nativeInputRefs,
  } as unknown as CanonicalReleaseJsonValue).digest;
}

function admissionIdFor(input: {
  readonly decidedAt: string;
  readonly requestId: string;
  readonly decision: ConsequenceAdmissionDecision;
  readonly reasonCodes: readonly string[];
  readonly proofDigests: readonly string[];
}): string {
  return canonicalObject({
    version: CONSEQUENCE_ADMISSION_CONTRACT_VERSION,
    decidedAt: input.decidedAt,
    requestId: input.requestId,
    decision: input.decision,
    reasonCodes: input.reasonCodes,
    proofDigests: input.proofDigests,
  }).digest;
}

function readonlyCopy<T>(items: readonly T[] | null | undefined): readonly T[] {
  return Object.freeze([...(items ?? [])]);
}

export function isConsequenceAdmissionDecision(
  value: string,
): value is ConsequenceAdmissionDecision {
  return CONSEQUENCE_ADMISSION_DECISIONS.includes(
    value as ConsequenceAdmissionDecision,
  );
}

export function consequenceAdmissionAllowsConsequence(
  decision: ConsequenceAdmissionDecision,
): boolean {
  return decision === 'admit' || decision === 'narrow';
}

export function mapFinancePipelineDecisionToAdmission(
  value: string,
): ConsequenceAdmissionNativeDecision {
  const normalized = value.trim().toLowerCase();
  let mappedDecision: ConsequenceAdmissionDecision = 'block';
  let mappingReason = 'Unknown finance decision values fail closed.';

  if (['pass', 'accepted', 'allow', 'allowed'].includes(normalized)) {
    mappedDecision = 'admit';
    mappingReason = 'Finance allow branch maps to canonical admit.';
  } else if (
    ['narrow', 'constrained', 'scope-reduced', 'limited'].includes(normalized)
  ) {
    mappedDecision = 'narrow';
    mappingReason = 'Finance constrained allow branch maps to canonical narrow.';
  } else if (
    ['hold', 'review', 'review-required', 'needs-review', 'pending-review'].includes(normalized)
  ) {
    mappedDecision = 'review';
    mappingReason = 'Finance hold/review branch maps to canonical review.';
  } else if (
    ['fail', 'block', 'blocked', 'deny', 'denied', 'expired', 'revoked'].includes(normalized)
  ) {
    mappedDecision = 'block';
    mappingReason = 'Finance denial or invalid release state maps to canonical block.';
  }

  return Object.freeze({
    surface: 'finance-pipeline',
    value,
    mappedDecision,
    mappingReason,
  });
}

export function mapCryptoAdmissionOutcomeToAdmission(
  value: CryptoExecutionAdmissionOutcome | string,
): ConsequenceAdmissionNativeDecision {
  const normalized = value.trim().toLowerCase();
  let mappedDecision: ConsequenceAdmissionDecision = 'block';
  let mappingReason = 'Unknown crypto admission outcomes fail closed.';

  if (normalized === 'admit') {
    mappedDecision = 'admit';
    mappingReason = 'Crypto execution-admission admit maps to canonical admit.';
  } else if (normalized === 'needs-evidence') {
    mappedDecision = 'review';
    mappingReason = 'Crypto needs-evidence maps to canonical review.';
  } else if (normalized === 'deny') {
    mappedDecision = 'block';
    mappingReason = 'Crypto deny maps to canonical block.';
  }

  return Object.freeze({
    surface: 'crypto-execution-admission',
    value,
    mappedDecision,
    mappingReason,
  });
}

export function createConsequenceAdmissionCheck(
  input: ConsequenceAdmissionCheck,
): ConsequenceAdmissionCheck {
  return Object.freeze({
    kind: input.kind,
    label: normalizeIdentifier(input.label, 'check.label'),
    outcome: input.outcome,
    required: input.required,
    summary: normalizeIdentifier(input.summary, 'check.summary'),
    reasonCodes: readonlyCopy(input.reasonCodes),
    evidenceRefs: readonlyCopy(input.evidenceRefs),
  });
}

export function createConsequenceAdmissionRequest(
  input: CreateConsequenceAdmissionRequestInput,
): ConsequenceAdmissionRequest {
  const requestedAt = normalizeIsoTimestamp(input.requestedAt, 'requestedAt');
  const base = Object.freeze({
    version: CONSEQUENCE_ADMISSION_CONTRACT_VERSION,
    requestedAt,
    packFamily: input.packFamily,
    entryPoint: Object.freeze({
      kind: input.entryPoint.kind,
      id: normalizeIdentifier(input.entryPoint.id, 'entryPoint.id'),
      route: normalizeOptionalIdentifier(input.entryPoint.route, 'entryPoint.route'),
      packageSubpath: normalizeOptionalIdentifier(
        input.entryPoint.packageSubpath,
        'entryPoint.packageSubpath',
      ),
      sourceRef: normalizeOptionalIdentifier(input.entryPoint.sourceRef, 'entryPoint.sourceRef'),
    }),
    proposedConsequence: Object.freeze({
      actor: normalizeIdentifier(input.proposedConsequence.actor, 'proposedConsequence.actor'),
      action: normalizeIdentifier(input.proposedConsequence.action, 'proposedConsequence.action'),
      downstreamSystem: normalizeIdentifier(
        input.proposedConsequence.downstreamSystem,
        'proposedConsequence.downstreamSystem',
      ),
      consequenceKind: input.proposedConsequence.consequenceKind,
      riskClass: input.proposedConsequence.riskClass,
      summary: normalizeIdentifier(
        input.proposedConsequence.summary,
        'proposedConsequence.summary',
      ),
    }),
    policyScope: Object.freeze({
      policyRef: input.policyScope?.policyRef ?? null,
      tenantId: input.policyScope?.tenantId ?? null,
      environment: input.policyScope?.environment ?? null,
      dimensions: Object.freeze(input.policyScope?.dimensions ?? {}),
    }),
    authority: Object.freeze({
      actorRef: input.authority?.actorRef ?? null,
      reviewerRef: input.authority?.reviewerRef ?? null,
      signerRef: input.authority?.signerRef ?? null,
      delegationRef: input.authority?.delegationRef ?? null,
      authorityMode: input.authority?.authorityMode ?? null,
    }),
    evidence: readonlyCopy(input.evidence),
    nativeInputRefs: readonlyCopy(input.nativeInputRefs),
  } satisfies Omit<ConsequenceAdmissionRequest, 'requestId'>);

  return Object.freeze({
    ...base,
    requestId: normalizeOptionalIdentifier(input.requestId, 'requestId') ?? requestIdFor(base),
  });
}

export function createConsequenceAdmissionResponse(
  input: CreateConsequenceAdmissionResponseInput,
): ConsequenceAdmissionResponse {
  const decidedAt = normalizeIsoTimestamp(input.decidedAt, 'decidedAt');
  const reason = normalizeIdentifier(input.reason, 'reason');
  const reasonCodes = readonlyCopy(input.reasonCodes);
  const constraints = readonlyCopy(input.constraints);

  if (input.decision === 'narrow' && constraints.length === 0) {
    throw new Error(
      'Consequence admission narrow decisions require at least one explicit constraint.',
    );
  }

  if (input.nativeDecision && input.nativeDecision.mappedDecision !== input.decision) {
    throw new Error(
      'Consequence admission native decision mapping must match the canonical decision.',
    );
  }

  const failClosed =
    input.failClosed ?? (input.decision === 'review' || input.decision === 'block');
  const proof = readonlyCopy(input.proof);
  const admissionId = admissionIdFor({
    decidedAt,
    requestId: input.request.requestId,
    decision: input.decision,
    reasonCodes,
    proofDigests: proof.map((entry) => entry.digest ?? entry.id),
  });
  const canonicalPayload = {
    version: CONSEQUENCE_ADMISSION_CONTRACT_VERSION,
    admissionId,
    decidedAt,
    request: input.request,
    decision: input.decision,
    allowed: consequenceAdmissionAllowsConsequence(input.decision),
    failClosed,
    reason,
    reasonCodes,
    checks: readonlyCopy(input.checks),
    constraints,
    nativeDecision: input.nativeDecision ?? null,
    proof,
    operationalContext: Object.freeze(input.operationalContext ?? {}),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function createConsequenceAdmissionProblem(input: {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string | null;
  readonly reasonCodes?: readonly string[];
}): ConsequenceAdmissionProblem {
  return Object.freeze({
    type: normalizeIdentifier(input.type, 'problem.type'),
    title: normalizeIdentifier(input.title, 'problem.title'),
    status: input.status,
    detail: normalizeIdentifier(input.detail, 'problem.detail'),
    instance: input.instance ?? null,
    decision: 'block',
    failClosed: true,
    reasonCodes: readonlyCopy(input.reasonCodes),
  });
}

export function consequenceAdmissionDescriptor():
ConsequenceAdmissionDescriptor {
  return Object.freeze({
    version: CONSEQUENCE_ADMISSION_CONTRACT_VERSION,
    decisions: CONSEQUENCE_ADMISSION_DECISIONS,
    packFamilies: CONSEQUENCE_ADMISSION_PACK_FAMILIES,
    entryPointKinds: CONSEQUENCE_ADMISSION_ENTRY_POINT_KINDS,
    checkKinds: CONSEQUENCE_ADMISSION_CHECK_KINDS,
    checkOutcomes: CONSEQUENCE_ADMISSION_CHECK_OUTCOMES,
    proofKinds: CONSEQUENCE_ADMISSION_PROOF_KINDS,
    nativeSurfaces: CONSEQUENCE_ADMISSION_NATIVE_SURFACES,
  });
}

export * from './finance.js';
export * from './crypto.js';
export * from './facade.js';
export * from './customer-gate.js';
