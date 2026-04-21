import { createHash, randomUUID } from 'node:crypto';
import type {
  EnforcementDecision,
  EnforcementReceipt,
  EnforcementRequest,
  VerificationResult,
} from './object-model.js';
import type {
  EnforcementFailureReason,
  EnforcementOutcome,
  ReleaseEnforcementRiskClass,
} from './types.js';
import { ENFORCEMENT_FAILURE_REASONS } from './types.js';

export const RELEASE_ENFORCEMENT_TELEMETRY_SPEC_VERSION =
  'attestor.release-enforcement-telemetry.v1';
export const RELEASE_ENFORCEMENT_TRANSPARENCY_RECEIPT_SPEC_VERSION =
  'attestor.release-enforcement-transparency-receipt.v1';

export const ENFORCEMENT_TELEMETRY_EVENT_NAME =
  'attestor.release_enforcement.decision';
export const ENFORCEMENT_TRANSPARENCY_EVENT_NAME =
  'attestor.release_enforcement.transparency_receipt';

export const ENFORCEMENT_TELEMETRY_HIGH_CONSEQUENCE_RISK_CLASSES = Object.freeze([
  'R4',
] as const satisfies readonly ReleaseEnforcementRiskClass[]);

export type EnforcementTelemetrySignal =
  | 'allow'
  | 'deny'
  | 'revoke'
  | 'replay'
  | 'freshness'
  | 'break-glass'
  | 'transparency-receipt';

export type EnforcementTelemetrySeverityText = 'INFO' | 'WARN' | 'ERROR';
export type EnforcementTelemetryAttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null;

export type EnforcementTelemetryOutcome =
  | EnforcementOutcome
  | 'revoked'
  | 'not-applicable';

export interface EnforcementTelemetryRefs {
  readonly requestId: string | null;
  readonly decisionId: string | null;
  readonly receiptId: string | null;
  readonly traceId: string | null;
  readonly releaseTokenId: string | null;
  readonly releaseDecisionId: string | null;
  readonly targetId: string | null;
}

export interface EnforcementTelemetryPoint {
  readonly environment: string | null;
  readonly enforcementPointId: string | null;
  readonly pointKind: string | null;
  readonly boundaryKind: string | null;
  readonly consequenceType: string | null;
  readonly riskClass: string | null;
}

export interface EnforcementTelemetryVerification {
  readonly status: VerificationResult['status'] | null;
  readonly mode: VerificationResult['mode'] | null;
  readonly presentationMode: VerificationResult['presentationMode'] | null;
  readonly cacheState: VerificationResult['cacheState'] | null;
  readonly degradedState: VerificationResult['degradedState'] | null;
  readonly introspectionActive: boolean | null;
}

export interface EnforcementTelemetryEvent {
  readonly version: typeof RELEASE_ENFORCEMENT_TELEMETRY_SPEC_VERSION;
  readonly id: string;
  readonly name: string;
  readonly signal: EnforcementTelemetrySignal;
  readonly observedAt: string;
  readonly severityText: EnforcementTelemetrySeverityText;
  readonly severityNumber: number;
  readonly source: string;
  readonly status: string | null;
  readonly outcome: EnforcementTelemetryOutcome;
  readonly responseStatus: number | null;
  readonly refs: EnforcementTelemetryRefs;
  readonly enforcementPoint: EnforcementTelemetryPoint;
  readonly verification: EnforcementTelemetryVerification;
  readonly failureReasons: readonly EnforcementFailureReason[];
  readonly attributes: Readonly<Record<string, EnforcementTelemetryAttributeValue>>;
  readonly body: string;
  readonly eventDigest: string;
}

export interface CreateEnforcementTelemetryEventInput {
  readonly source: string;
  readonly observedAt?: string;
  readonly signal?: EnforcementTelemetrySignal;
  readonly status?: string | null;
  readonly outcome?: EnforcementTelemetryOutcome | null;
  readonly request?: EnforcementRequest | null;
  readonly decision?: EnforcementDecision | null;
  readonly receipt?: EnforcementReceipt | null;
  readonly verification?: VerificationResult | null;
  readonly failureReasons?: readonly EnforcementFailureReason[];
  readonly responseStatus?: number | null;
  readonly attributes?: Readonly<Record<string, EnforcementTelemetryAttributeValue>>;
  readonly body?: string | null;
}

export interface EnforcementTransparencyProofStep {
  readonly position: 'left' | 'right';
  readonly digest: string;
}

export interface EnforcementTransparencyInclusionProof {
  readonly leafIndex: number;
  readonly treeSize: number;
  readonly rootHash: string;
  readonly hashes: readonly EnforcementTransparencyProofStep[];
}

export type EnforcementTransparencySubjectType =
  | 'enforcement-receipt'
  | 'enforcement-decision'
  | 'enforcement-telemetry-event';

export interface EnforcementTransparencySubject {
  readonly type: EnforcementTransparencySubjectType;
  readonly id: string | null;
  readonly requestId: string | null;
  readonly decisionId: string | null;
  readonly outcome: EnforcementTelemetryOutcome;
  readonly digest: string;
}

export interface EnforcementTransparencyReceipt {
  readonly version: typeof RELEASE_ENFORCEMENT_TRANSPARENCY_RECEIPT_SPEC_VERSION;
  readonly id: string;
  readonly issuedAt: string;
  readonly issuer: string;
  readonly serviceId: string;
  readonly logId: string;
  readonly subject: EnforcementTransparencySubject;
  readonly inclusionProof: EnforcementTransparencyInclusionProof | null;
  readonly receiptDigest: string;
}

export interface CreateEnforcementTransparencyReceiptInput {
  readonly id?: string;
  readonly issuedAt: string;
  readonly issuer?: string;
  readonly serviceId: string;
  readonly logId: string;
  readonly receipt?: EnforcementReceipt | null;
  readonly decision?: EnforcementDecision | null;
  readonly event?: EnforcementTelemetryEvent | null;
  readonly inclusionProof?: EnforcementTransparencyInclusionProof | null;
}

export type TransparencyReceiptVerificationFailure =
  | 'receipt-digest-mismatch'
  | 'inclusion-root-mismatch'
  | 'invalid-timestamp'
  | 'invalid-digest';

export interface TransparencyReceiptVerification {
  readonly status: 'valid' | 'invalid';
  readonly receipt: EnforcementTransparencyReceipt;
  readonly failureReasons: readonly TransparencyReceiptVerificationFailure[];
}

export interface EnforcementTelemetrySink {
  emit(event: EnforcementTelemetryEvent): void | Promise<void>;
  events(): readonly EnforcementTelemetryEvent[];
}

export interface EnforcementTelemetrySummary {
  readonly eventCount: number;
  readonly allowCount: number;
  readonly denyCount: number;
  readonly replayCount: number;
  readonly freshnessCount: number;
  readonly breakGlassCount: number;
  readonly revokeCount: number;
  readonly transparencyReceiptCount: number;
  readonly failureReasonCounts: Readonly<Record<EnforcementFailureReason, number>>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(',')}}`;
}

export function enforcementTelemetryDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length === 0) {
    throw new Error(`Release enforcement telemetry ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Release enforcement telemetry ${fieldName} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeFailureReasons(
  reasons: readonly EnforcementFailureReason[] | null | undefined,
): readonly EnforcementFailureReason[] {
  const present = new Set(reasons ?? []);
  for (const reason of present) {
    if (!(ENFORCEMENT_FAILURE_REASONS as readonly string[]).includes(reason)) {
      throw new Error(`Release enforcement telemetry unknown failure reason: ${reason}`);
    }
  }
  return Object.freeze(ENFORCEMENT_FAILURE_REASONS.filter((reason) => present.has(reason)));
}

function verificationFromInput(input: CreateEnforcementTelemetryEventInput): VerificationResult | null {
  return input.verification ?? input.decision?.verification ?? null;
}

function outcomeFromInput(input: CreateEnforcementTelemetryEventInput): EnforcementTelemetryOutcome {
  if (input.outcome) {
    return input.outcome;
  }
  return input.decision?.outcome ?? input.receipt?.outcome ?? 'not-applicable';
}

function requestRefs(input: CreateEnforcementTelemetryEventInput): EnforcementTelemetryRefs {
  const decision = input.decision ?? null;
  const receipt = input.receipt ?? null;
  const verification = verificationFromInput(input);
  const request = input.request ?? null;
  return Object.freeze({
    requestId: request?.id ?? decision?.requestId ?? receipt?.requestId ?? null,
    decisionId: decision?.id ?? receipt?.decisionId ?? null,
    receiptId: receipt?.id ?? null,
    traceId: request?.traceId ?? null,
    releaseTokenId:
      decision?.releaseTokenId ?? receipt?.releaseTokenId ?? verification?.releaseTokenId ?? null,
    releaseDecisionId:
      decision?.releaseDecisionId ??
      receipt?.releaseDecisionId ??
      verification?.releaseDecisionId ??
      null,
    targetId: request?.targetId ?? null,
  });
}

function pointFromInput(input: CreateEnforcementTelemetryEventInput): EnforcementTelemetryPoint {
  const point = input.decision?.enforcementPoint ?? input.request?.enforcementPoint ?? null;
  return Object.freeze({
    environment: point?.environment ?? null,
    enforcementPointId: point?.enforcementPointId ?? null,
    pointKind: point?.pointKind ?? null,
    boundaryKind: point?.boundaryKind ?? null,
    consequenceType: point?.consequenceType ?? null,
    riskClass: point?.riskClass ?? null,
  });
}

function verificationView(input: CreateEnforcementTelemetryEventInput): EnforcementTelemetryVerification {
  const verification = verificationFromInput(input);
  return Object.freeze({
    status: verification?.status ?? null,
    mode: verification?.mode ?? null,
    presentationMode: verification?.presentationMode ?? null,
    cacheState: verification?.cacheState ?? null,
    degradedState: verification?.degradedState ?? null,
    introspectionActive: verification?.introspection?.active ?? null,
  });
}

function defaultSignal(input: CreateEnforcementTelemetryEventInput): EnforcementTelemetrySignal {
  const outcome = outcomeFromInput(input);
  const failures = normalizeFailureReasons(
    input.failureReasons ?? input.decision?.failureReasons ?? input.receipt?.failureReasons ?? [],
  );
  if (outcome === 'break-glass-allow') {
    return 'break-glass';
  }
  if (outcome === 'revoked') {
    return 'revoke';
  }
  if (failures.includes('replayed-authorization')) {
    return 'replay';
  }
  if (
    failures.includes('fresh-introspection-required') ||
    failures.includes('stale-authorization') ||
    failures.includes('negative-cache-hit') ||
    failures.includes('introspection-unavailable')
  ) {
    return 'freshness';
  }
  if (outcome === 'deny') {
    return 'deny';
  }
  return 'allow';
}

function severityForSignal(signal: EnforcementTelemetrySignal): {
  readonly severityText: EnforcementTelemetrySeverityText;
  readonly severityNumber: number;
} {
  if (signal === 'allow' || signal === 'transparency-receipt') {
    return { severityText: 'INFO', severityNumber: 9 };
  }
  if (signal === 'deny' || signal === 'replay') {
    return { severityText: 'ERROR', severityNumber: 17 };
  }
  return { severityText: 'WARN', severityNumber: 13 };
}

function telemetryBody(input: {
  readonly signal: EnforcementTelemetrySignal;
  readonly outcome: EnforcementTelemetryOutcome;
  readonly source: string;
  readonly failureReasons: readonly EnforcementFailureReason[];
}): string {
  if (input.signal === 'allow') {
    return `${input.source} allowed release enforcement request.`;
  }
  if (input.signal === 'break-glass') {
    return `${input.source} allowed release enforcement request through break-glass.`;
  }
  if (input.signal === 'revoke') {
    return `${input.source} recorded release authorization revocation.`;
  }
  if (input.signal === 'replay') {
    return `${input.source} denied replayed release authorization.`;
  }
  if (input.signal === 'freshness') {
    return `${input.source} recorded release enforcement freshness state.`;
  }
  if (input.signal === 'transparency-receipt') {
    return `${input.source} exported release enforcement transparency receipt.`;
  }
  return `${input.source} denied release enforcement request with ${input.failureReasons.length} failure reason(s).`;
}

function defaultAttributes(input: {
  readonly signal: EnforcementTelemetrySignal;
  readonly outcome: EnforcementTelemetryOutcome;
  readonly status: string | null;
  readonly responseStatus: number | null;
  readonly point: EnforcementTelemetryPoint;
  readonly verification: EnforcementTelemetryVerification;
  readonly failureReasons: readonly EnforcementFailureReason[];
}): Readonly<Record<string, EnforcementTelemetryAttributeValue>> {
  return Object.freeze({
    'attestor.release_enforcement.signal': input.signal,
    'attestor.release_enforcement.outcome': input.outcome,
    'attestor.release_enforcement.status': input.status,
    'attestor.release_enforcement.failure_reason_count': input.failureReasons.length,
    'attestor.release_enforcement.failure_reasons': input.failureReasons,
    'attestor.release_enforcement.point.kind': input.point.pointKind,
    'attestor.release_enforcement.boundary.kind': input.point.boundaryKind,
    'attestor.release_enforcement.consequence.type': input.point.consequenceType,
    'attestor.release_enforcement.risk.class': input.point.riskClass,
    'attestor.release_enforcement.verification.status': input.verification.status,
    'attestor.release_enforcement.verification.mode': input.verification.mode,
    'attestor.release_enforcement.presentation.mode': input.verification.presentationMode,
    'attestor.release_enforcement.cache.state': input.verification.cacheState,
    'attestor.release_enforcement.degraded.state': input.verification.degradedState,
    'http.response.status_code': input.responseStatus,
  });
}

function eventDigestMaterial(event: Omit<EnforcementTelemetryEvent, 'eventDigest'>): unknown {
  return {
    version: event.version,
    id: event.id,
    name: event.name,
    signal: event.signal,
    observedAt: event.observedAt,
    source: event.source,
    status: event.status,
    outcome: event.outcome,
    responseStatus: event.responseStatus,
    refs: event.refs,
    enforcementPoint: event.enforcementPoint,
    verification: event.verification,
    failureReasons: event.failureReasons,
    attributes: event.attributes,
    body: event.body,
  };
}

export function createEnforcementTelemetryEvent(
  input: CreateEnforcementTelemetryEventInput,
): EnforcementTelemetryEvent {
  const source = normalizeIdentifier(input.source, 'source');
  const observedAt = normalizeIsoTimestamp(input.observedAt ?? new Date().toISOString(), 'observedAt');
  const failureReasons = normalizeFailureReasons(
    input.failureReasons ?? input.decision?.failureReasons ?? input.receipt?.failureReasons ?? [],
  );
  const outcome = outcomeFromInput(input);
  const signal = input.signal ?? defaultSignal(input);
  const severity = severityForSignal(signal);
  const refs = requestRefs(input);
  const point = pointFromInput(input);
  const verification = verificationView(input);
  const status = normalizeOptionalIdentifier(input.status) ?? input.decision?.outcome ?? null;
  const responseStatus = input.responseStatus ?? null;
  const attributes = Object.freeze({
    ...defaultAttributes({
      signal,
      outcome,
      status,
      responseStatus,
      point,
      verification,
      failureReasons,
    }),
    ...(input.attributes ?? {}),
  });
  const eventWithoutDigest: Omit<EnforcementTelemetryEvent, 'eventDigest'> = Object.freeze({
    version: RELEASE_ENFORCEMENT_TELEMETRY_SPEC_VERSION,
    id: `ete_${randomUUID().replaceAll('-', '')}`,
    name: signal === 'transparency-receipt'
      ? ENFORCEMENT_TRANSPARENCY_EVENT_NAME
      : ENFORCEMENT_TELEMETRY_EVENT_NAME,
    signal,
    observedAt,
    severityText: severity.severityText,
    severityNumber: severity.severityNumber,
    source,
    status,
    outcome,
    responseStatus,
    refs,
    enforcementPoint: point,
    verification,
    failureReasons,
    attributes,
    body: input.body ?? telemetryBody({ signal, outcome, source, failureReasons }),
  });

  return Object.freeze({
    ...eventWithoutDigest,
    eventDigest: enforcementTelemetryDigest(eventDigestMaterial(eventWithoutDigest)),
  });
}

function digestPair(left: string, right: string): string {
  return enforcementTelemetryDigest({ left, right });
}

export function transparencyRootFromProof(
  subjectDigest: string,
  proof: EnforcementTransparencyInclusionProof,
): string {
  let current = normalizeIdentifier(subjectDigest, 'subject.digest');
  for (const step of proof.hashes) {
    const digest = normalizeIdentifier(step.digest, 'inclusionProof.hash.digest');
    current = step.position === 'left' ? digestPair(digest, current) : digestPair(current, digest);
  }
  return current;
}

export function createSingleLeafTransparencyProof(
  subjectDigest: string,
): EnforcementTransparencyInclusionProof {
  const normalizedSubjectDigest = normalizeIdentifier(subjectDigest, 'subject.digest');
  return Object.freeze({
    leafIndex: 0,
    treeSize: 1,
    rootHash: normalizedSubjectDigest,
    hashes: Object.freeze([]),
  });
}

function subjectFromReceipt(receipt: EnforcementReceipt): EnforcementTransparencySubject {
  return Object.freeze({
    type: 'enforcement-receipt',
    id: receipt.id,
    requestId: receipt.requestId,
    decisionId: receipt.decisionId,
    outcome: receipt.outcome,
    digest: enforcementTelemetryDigest(receipt),
  });
}

function subjectFromDecision(decision: EnforcementDecision): EnforcementTransparencySubject {
  return Object.freeze({
    type: 'enforcement-decision',
    id: decision.id,
    requestId: decision.requestId,
    decisionId: decision.id,
    outcome: decision.outcome,
    digest: enforcementTelemetryDigest(decision),
  });
}

function subjectFromEvent(event: EnforcementTelemetryEvent): EnforcementTransparencySubject {
  return Object.freeze({
    type: 'enforcement-telemetry-event',
    id: event.id,
    requestId: event.refs.requestId,
    decisionId: event.refs.decisionId,
    outcome: event.outcome,
    digest: event.eventDigest,
  });
}

function transparencySubject(input: CreateEnforcementTransparencyReceiptInput): EnforcementTransparencySubject {
  if (input.receipt) {
    return subjectFromReceipt(input.receipt);
  }
  if (input.decision) {
    return subjectFromDecision(input.decision);
  }
  if (input.event) {
    return subjectFromEvent(input.event);
  }
  throw new Error('Release enforcement transparency receipt requires a receipt, decision, or telemetry event subject.');
}

function receiptDigestMaterial(
  receipt: Omit<EnforcementTransparencyReceipt, 'receiptDigest'>,
): unknown {
  return {
    version: receipt.version,
    id: receipt.id,
    issuedAt: receipt.issuedAt,
    issuer: receipt.issuer,
    serviceId: receipt.serviceId,
    logId: receipt.logId,
    subject: receipt.subject,
    inclusionProof: receipt.inclusionProof,
  };
}

export function createEnforcementTransparencyReceipt(
  input: CreateEnforcementTransparencyReceiptInput,
): EnforcementTransparencyReceipt {
  const subject = transparencySubject(input);
  const withoutDigest: Omit<EnforcementTransparencyReceipt, 'receiptDigest'> = Object.freeze({
    version: RELEASE_ENFORCEMENT_TRANSPARENCY_RECEIPT_SPEC_VERSION,
    id: normalizeOptionalIdentifier(input.id) ?? `etr_${randomUUID().replaceAll('-', '')}`,
    issuedAt: normalizeIsoTimestamp(input.issuedAt, 'issuedAt'),
    issuer: normalizeOptionalIdentifier(input.issuer) ?? 'attestor.release-enforcement-plane',
    serviceId: normalizeIdentifier(input.serviceId, 'serviceId'),
    logId: normalizeIdentifier(input.logId, 'logId'),
    subject,
    inclusionProof: input.inclusionProof ?? null,
  });

  return Object.freeze({
    ...withoutDigest,
    receiptDigest: enforcementTelemetryDigest(receiptDigestMaterial(withoutDigest)),
  });
}

export function verifyEnforcementTransparencyReceipt(
  receipt: EnforcementTransparencyReceipt,
): TransparencyReceiptVerification {
  const failures: TransparencyReceiptVerificationFailure[] = [];
  const recomputed = enforcementTelemetryDigest(receiptDigestMaterial({
    version: receipt.version,
    id: receipt.id,
    issuedAt: receipt.issuedAt,
    issuer: receipt.issuer,
    serviceId: receipt.serviceId,
    logId: receipt.logId,
    subject: receipt.subject,
    inclusionProof: receipt.inclusionProof,
  }));
  if (recomputed !== receipt.receiptDigest) {
    failures.push('receipt-digest-mismatch');
  }

  if (Number.isNaN(new Date(receipt.issuedAt).getTime())) {
    failures.push('invalid-timestamp');
  }
  if (!receipt.subject.digest.startsWith('sha256:')) {
    failures.push('invalid-digest');
  }
  if (receipt.inclusionProof) {
    const root = transparencyRootFromProof(receipt.subject.digest, receipt.inclusionProof);
    if (root !== receipt.inclusionProof.rootHash) {
      failures.push('inclusion-root-mismatch');
    }
  }

  return Object.freeze({
    status: failures.length === 0 ? 'valid' : 'invalid',
    receipt,
    failureReasons: Object.freeze(failures),
  });
}

export function createInMemoryEnforcementTelemetrySink(): EnforcementTelemetrySink {
  const entries: EnforcementTelemetryEvent[] = [];
  return Object.freeze({
    emit(event: EnforcementTelemetryEvent): void {
      entries.push(event);
    },
    events(): readonly EnforcementTelemetryEvent[] {
      return Object.freeze([...entries]);
    },
  });
}

export function buildEnforcementTelemetrySummary(
  events: readonly EnforcementTelemetryEvent[],
): EnforcementTelemetrySummary {
  const failureReasonCounts = Object.fromEntries(
    ENFORCEMENT_FAILURE_REASONS.map((reason) => [reason, 0]),
  ) as Record<EnforcementFailureReason, number>;
  for (const event of events) {
    for (const reason of event.failureReasons) {
      failureReasonCounts[reason] += 1;
    }
  }

  return Object.freeze({
    eventCount: events.length,
    allowCount: events.filter((event) => event.signal === 'allow').length,
    denyCount: events.filter((event) => event.signal === 'deny').length,
    replayCount: events.filter((event) => event.signal === 'replay').length,
    freshnessCount: events.filter((event) => event.signal === 'freshness').length,
    breakGlassCount: events.filter((event) => event.signal === 'break-glass').length,
    revokeCount: events.filter((event) => event.signal === 'revoke').length,
    transparencyReceiptCount: events.filter((event) => event.signal === 'transparency-receipt').length,
    failureReasonCounts: Object.freeze(failureReasonCounts),
  });
}

export function telemetryEventSafetyFindings(
  event: EnforcementTelemetryEvent,
): readonly string[] {
  const material = stableStringify({
    body: event.body,
    attributes: event.attributes,
    refs: event.refs,
  }).toLowerCase();
  const findings: string[] = [];
  for (const marker of ['bearer ', 'jwt.', 'release-token=', 'attestor-release-token']) {
    if (material.includes(marker)) {
      findings.push(`telemetry contains sensitive marker: ${marker.trim()}`);
    }
  }
  return Object.freeze(findings);
}
