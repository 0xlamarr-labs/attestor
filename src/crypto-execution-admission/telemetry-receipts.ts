import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type {
  CryptoExecutionAdmissionPlan,
  CryptoExecutionAdmissionSurface,
} from './index.js';

/**
 * Uniform telemetry and signed receipts for crypto execution admission.
 *
 * This module intentionally sits above the surface-specific handoffs. Wallets,
 * guards, bundlers, x402 servers, custody callbacks, and solver integrations
 * keep their own contracts, while this layer gives operators one event and
 * receipt shape for admitted, blocked, and missing-evidence outcomes.
 */

export const CRYPTO_ADMISSION_TELEMETRY_SPEC_VERSION =
  'attestor.crypto-execution-admission-telemetry.v1';
export const CRYPTO_ADMISSION_RECEIPT_SPEC_VERSION =
  'attestor.crypto-execution-admission-receipt.v1';

export const CRYPTO_ADMISSION_TELEMETRY_EVENT_TYPE =
  'attestor.crypto_execution_admission.decision';
export const CRYPTO_ADMISSION_RECEIPT_EVENT_TYPE =
  'attestor.crypto_execution_admission.receipt';

export const CRYPTO_ADMISSION_TELEMETRY_SIGNALS = [
  'admitted',
  'blocked',
  'missing-evidence',
  'receipt-issued',
] as const;
export type CryptoAdmissionTelemetrySignal =
  typeof CRYPTO_ADMISSION_TELEMETRY_SIGNALS[number];

export const CRYPTO_ADMISSION_RECEIPT_CLASSIFICATIONS = [
  'admitted',
  'blocked',
  'missing-evidence',
] as const;
export type CryptoAdmissionReceiptClassification =
  typeof CRYPTO_ADMISSION_RECEIPT_CLASSIFICATIONS[number];

export const CRYPTO_ADMISSION_TELEMETRY_SEVERITY_TEXT = [
  'INFO',
  'WARN',
  'ERROR',
] as const;
export type CryptoAdmissionTelemetrySeverityText =
  typeof CRYPTO_ADMISSION_TELEMETRY_SEVERITY_TEXT[number];

export const CRYPTO_ADMISSION_RECEIPT_SIGNATURE_MODES = [
  'hmac-sha256',
] as const;
export type CryptoAdmissionReceiptSignatureMode =
  typeof CRYPTO_ADMISSION_RECEIPT_SIGNATURE_MODES[number];

export interface CryptoAdmissionTraceContext {
  readonly traceparent: string | null;
  readonly tracestate: string | null;
}

export interface CryptoAdmissionTelemetrySubject {
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly subjectDigest: string;
  readonly surface: CryptoExecutionAdmissionSurface;
  readonly adapterKind: string | null;
  readonly outcome: string;
  readonly action: string | null;
  readonly planId: string;
  readonly planDigest: string;
}

export interface CreateCryptoAdmissionTelemetrySubjectInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly subjectDigest: string;
  readonly outcome?: string | null;
  readonly action?: string | null;
  readonly surface?: CryptoExecutionAdmissionSurface | null;
  readonly adapterKind?: string | null;
}

export type CryptoAdmissionTelemetryAttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null;

export interface CryptoAdmissionTelemetryEventData {
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly simulationDigest: string;
  readonly intentId: string;
  readonly surface: CryptoExecutionAdmissionSurface;
  readonly adapterKind: string | null;
  readonly planOutcome: CryptoExecutionAdmissionPlan['outcome'];
  readonly signal: CryptoAdmissionTelemetrySignal;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly subjectDigest: string;
  readonly subjectOutcome: string;
  readonly failureReasons: readonly string[];
  readonly receiptId: string | null;
}

export interface CryptoAdmissionTelemetryEvent {
  readonly version: typeof CRYPTO_ADMISSION_TELEMETRY_SPEC_VERSION;
  readonly specversion: '1.0';
  readonly id: string;
  readonly type:
    | typeof CRYPTO_ADMISSION_TELEMETRY_EVENT_TYPE
    | typeof CRYPTO_ADMISSION_RECEIPT_EVENT_TYPE;
  readonly source: string;
  readonly subject: string;
  readonly time: string;
  readonly datacontenttype: 'application/json';
  readonly traceparent: string | null;
  readonly tracestate: string | null;
  readonly signal: CryptoAdmissionTelemetrySignal;
  readonly severityText: CryptoAdmissionTelemetrySeverityText;
  readonly severityNumber: number;
  readonly attributes: Readonly<Record<string, CryptoAdmissionTelemetryAttributeValue>>;
  readonly data: CryptoAdmissionTelemetryEventData;
  readonly body: string;
  readonly eventDigest: string;
}

export interface CryptoAdmissionReceiptSignature {
  readonly mode: CryptoAdmissionReceiptSignatureMode;
  readonly keyId: string;
  readonly signedPayloadDigest: string;
  readonly value: string;
}

export interface CryptoAdmissionReceipt {
  readonly version: typeof CRYPTO_ADMISSION_RECEIPT_SPEC_VERSION;
  readonly receiptId: string;
  readonly issuedAt: string;
  readonly issuer: string;
  readonly serviceId: string;
  readonly classification: CryptoAdmissionReceiptClassification;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly simulationDigest: string;
  readonly intentId: string;
  readonly surface: CryptoExecutionAdmissionSurface;
  readonly adapterKind: string | null;
  readonly planOutcome: CryptoExecutionAdmissionPlan['outcome'];
  readonly subject: CryptoAdmissionTelemetrySubject;
  readonly trace: CryptoAdmissionTraceContext;
  readonly failureReasons: readonly string[];
  readonly evidenceDigest: string;
  readonly receiptDigest: string;
  readonly signature: CryptoAdmissionReceiptSignature;
}

export interface CryptoAdmissionReceiptSigner {
  readonly keyId: string;
  readonly secret: string;
}

export interface CreateCryptoAdmissionReceiptInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly subject: CryptoAdmissionTelemetrySubject;
  readonly issuedAt: string;
  readonly serviceId: string;
  readonly signer: CryptoAdmissionReceiptSigner;
  readonly receiptId?: string | null;
  readonly issuer?: string | null;
  readonly traceparent?: string | null;
  readonly tracestate?: string | null;
  readonly failureReasons?: readonly string[] | null;
}

export interface VerifyCryptoAdmissionReceiptInput {
  readonly receipt: CryptoAdmissionReceipt;
  readonly signer?: CryptoAdmissionReceiptSigner | null;
}

export const CRYPTO_ADMISSION_RECEIPT_VERIFICATION_FAILURES = [
  'receipt-digest-mismatch',
  'signature-mismatch',
  'signature-key-mismatch',
  'invalid-timestamp',
  'subject-plan-mismatch',
  'invalid-trace-context',
] as const;
export type CryptoAdmissionReceiptVerificationFailure =
  typeof CRYPTO_ADMISSION_RECEIPT_VERIFICATION_FAILURES[number];

export interface CryptoAdmissionReceiptVerification {
  readonly status: 'valid' | 'invalid';
  readonly receipt: CryptoAdmissionReceipt;
  readonly failureReasons: readonly CryptoAdmissionReceiptVerificationFailure[];
}

export interface CreateCryptoAdmissionTelemetryEventInput {
  readonly source: string;
  readonly observedAt: string;
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly subject: CryptoAdmissionTelemetrySubject;
  readonly receipt?: CryptoAdmissionReceipt | null;
  readonly signal?: CryptoAdmissionTelemetrySignal | null;
  readonly traceparent?: string | null;
  readonly tracestate?: string | null;
  readonly failureReasons?: readonly string[] | null;
  readonly attributes?: Readonly<Record<string, CryptoAdmissionTelemetryAttributeValue>> | null;
  readonly body?: string | null;
}

export interface CryptoAdmissionTelemetrySink {
  emit(event: CryptoAdmissionTelemetryEvent): void | Promise<void>;
  events(): readonly CryptoAdmissionTelemetryEvent[];
}

export interface CryptoAdmissionTelemetrySummary {
  readonly eventCount: number;
  readonly admittedCount: number;
  readonly blockedCount: number;
  readonly missingEvidenceCount: number;
  readonly receiptIssuedCount: number;
  readonly bySurface: Readonly<Record<CryptoExecutionAdmissionSurface, number>>;
  readonly failureReasonCounts: Readonly<Record<string, number>>;
}

export interface CryptoAdmissionTelemetryDescriptor {
  readonly telemetryVersion: typeof CRYPTO_ADMISSION_TELEMETRY_SPEC_VERSION;
  readonly receiptVersion: typeof CRYPTO_ADMISSION_RECEIPT_SPEC_VERSION;
  readonly eventTypes: readonly [
    typeof CRYPTO_ADMISSION_TELEMETRY_EVENT_TYPE,
    typeof CRYPTO_ADMISSION_RECEIPT_EVENT_TYPE,
  ];
  readonly signals: typeof CRYPTO_ADMISSION_TELEMETRY_SIGNALS;
  readonly receiptClassifications: typeof CRYPTO_ADMISSION_RECEIPT_CLASSIFICATIONS;
  readonly signatureModes: typeof CRYPTO_ADMISSION_RECEIPT_SIGNATURE_MODES;
  readonly conventions: readonly string[];
  readonly safetyChecks: readonly string[];
}

const CRYPTO_ADMISSION_SURFACES = [
  'attestor-core',
  'wallet-rpc',
  'smart-account-guard',
  'account-abstraction-bundler',
  'modular-account-runtime',
  'delegated-eoa-runtime',
  'agent-payment-http',
  'custody-policy-engine',
  'intent-solver',
] as const satisfies readonly CryptoExecutionAdmissionSurface[];

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`crypto admission telemetry ${fieldName} requires a non-empty value.`);
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
  const normalized = normalizeIdentifier(value, fieldName);
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(`crypto admission telemetry ${fieldName} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeTraceparent(value: string | null | undefined): string | null {
  const traceparent = normalizeOptionalIdentifier(value, 'traceparent');
  if (traceparent === null) return null;
  if (!/^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/u.test(traceparent)) {
    throw new Error('crypto admission telemetry traceparent must follow W3C Trace Context shape.');
  }
  return traceparent;
}

function normalizeTraceContext(input: {
  readonly traceparent?: string | null;
  readonly tracestate?: string | null;
}): CryptoAdmissionTraceContext {
  return Object.freeze({
    traceparent: normalizeTraceparent(input.traceparent),
    tracestate: normalizeOptionalIdentifier(input.tracestate, 'tracestate'),
  });
}

function normalizeStringList(
  values: readonly string[] | null | undefined,
  fieldName: string,
): readonly string[] {
  return Object.freeze(
    [...new Set(values ?? [])].map((value, index) =>
      normalizeIdentifier(value, `${fieldName}[${index}]`),
    ),
  );
}

function cryptoAdmissionDigest(value: unknown): string {
  const canonical = canonicalizeReleaseJson(value as CanonicalReleaseJsonValue);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function canonicalPayload(value: unknown): string {
  return canonicalizeReleaseJson(value as CanonicalReleaseJsonValue);
}

function defaultClassification(
  plan: CryptoExecutionAdmissionPlan,
  subjectOutcome: string,
): CryptoAdmissionReceiptClassification {
  const normalized = subjectOutcome.trim().toLowerCase();
  if (
    plan.outcome === 'deny' ||
    normalized.includes('blocked') ||
    normalized.includes('deny') ||
    normalized.includes('reject') ||
    normalized.includes('failed')
  ) {
    return 'blocked';
  }
  if (
    plan.outcome === 'needs-evidence' ||
    normalized.includes('needs') ||
    normalized.includes('missing') ||
    normalized.includes('pending') ||
    normalized.includes('review')
  ) {
    return 'missing-evidence';
  }
  return 'admitted';
}

function signalFor(
  plan: CryptoExecutionAdmissionPlan,
  subject: CryptoAdmissionTelemetrySubject,
): CryptoAdmissionTelemetrySignal {
  return defaultClassification(plan, subject.outcome);
}

function severityFor(signal: CryptoAdmissionTelemetrySignal): {
  readonly severityText: CryptoAdmissionTelemetrySeverityText;
  readonly severityNumber: number;
} {
  if (signal === 'admitted' || signal === 'receipt-issued') {
    return { severityText: 'INFO', severityNumber: 9 };
  }
  if (signal === 'blocked') {
    return { severityText: 'ERROR', severityNumber: 17 };
  }
  return { severityText: 'WARN', severityNumber: 13 };
}

function defaultBody(input: {
  readonly source: string;
  readonly signal: CryptoAdmissionTelemetrySignal;
  readonly subject: CryptoAdmissionTelemetrySubject;
}): string {
  if (input.signal === 'admitted') {
    return `${input.source} admitted crypto execution through ${input.subject.surface}.`;
  }
  if (input.signal === 'blocked') {
    return `${input.source} blocked crypto execution through ${input.subject.surface}.`;
  }
  if (input.signal === 'receipt-issued') {
    return `${input.source} issued a crypto execution admission receipt.`;
  }
  return `${input.source} recorded missing crypto admission evidence for ${input.subject.surface}.`;
}

function receiptDigestMaterial(
  receipt: Omit<CryptoAdmissionReceipt, 'receiptDigest' | 'signature'>,
): unknown {
  return {
    version: receipt.version,
    receiptId: receipt.receiptId,
    issuedAt: receipt.issuedAt,
    issuer: receipt.issuer,
    serviceId: receipt.serviceId,
    classification: receipt.classification,
    planId: receipt.planId,
    planDigest: receipt.planDigest,
    simulationId: receipt.simulationId,
    simulationDigest: receipt.simulationDigest,
    intentId: receipt.intentId,
    surface: receipt.surface,
    adapterKind: receipt.adapterKind,
    planOutcome: receipt.planOutcome,
    subject: receipt.subject,
    trace: receipt.trace,
    failureReasons: receipt.failureReasons,
    evidenceDigest: receipt.evidenceDigest,
  };
}

function signReceiptPayload(
  payload: unknown,
  signer: CryptoAdmissionReceiptSigner,
): CryptoAdmissionReceiptSignature {
  const keyId = normalizeIdentifier(signer.keyId, 'signer.keyId');
  const secret = normalizeIdentifier(signer.secret, 'signer.secret');
  const signedPayloadDigest = cryptoAdmissionDigest(payload);
  const value = `hmac-sha256:${createHmac('sha256', secret)
    .update(canonicalPayload(payload))
    .digest('hex')}`;
  return Object.freeze({
    mode: 'hmac-sha256',
    keyId,
    signedPayloadDigest,
    value,
  });
}

function signatureMatches(
  payload: unknown,
  signer: CryptoAdmissionReceiptSigner,
  signature: CryptoAdmissionReceiptSignature,
): boolean {
  const expected = signReceiptPayload(payload, signer).value;
  const actual = signature.value;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function receiptIdFor(input: {
  readonly planId: string;
  readonly subjectId: string;
  readonly issuedAt: string;
}): string {
  return `car_${createHash('sha256')
    .update(canonicalPayload(input))
    .digest('hex')
    .slice(0, 24)}`;
}

export function createCryptoAdmissionTelemetrySubject(
  input: CreateCryptoAdmissionTelemetrySubjectInput,
): CryptoAdmissionTelemetrySubject {
  const surface = input.surface ?? input.plan.surface;
  if (surface !== input.plan.surface) {
    throw new Error('crypto admission telemetry subject surface must match the admission plan.');
  }
  return Object.freeze({
    subjectKind: normalizeIdentifier(input.subjectKind, 'subjectKind'),
    subjectId: normalizeIdentifier(input.subjectId, 'subjectId'),
    subjectDigest: normalizeIdentifier(input.subjectDigest, 'subjectDigest'),
    surface,
    adapterKind:
      input.adapterKind === undefined
        ? input.plan.adapterKind
        : normalizeOptionalIdentifier(input.adapterKind, 'adapterKind'),
    outcome: normalizeOptionalIdentifier(input.outcome, 'outcome') ?? input.plan.outcome,
    action: normalizeOptionalIdentifier(input.action, 'action'),
    planId: input.plan.planId,
    planDigest: input.plan.digest,
  });
}

export function createCryptoAdmissionReceipt(
  input: CreateCryptoAdmissionReceiptInput,
): CryptoAdmissionReceipt {
  const issuedAt = normalizeIsoTimestamp(input.issuedAt, 'issuedAt');
  if (input.subject.planId !== input.plan.planId || input.subject.planDigest !== input.plan.digest) {
    throw new Error('crypto admission receipt subject must reference the same admission plan.');
  }
  if (input.subject.surface !== input.plan.surface) {
    throw new Error('crypto admission receipt subject surface must match the admission plan.');
  }
  const failureReasons = normalizeStringList(
    input.failureReasons ?? input.plan.blockedReasons,
    'failureReasons',
  );
  const trace = normalizeTraceContext(input);
  const withoutDigest: Omit<CryptoAdmissionReceipt, 'receiptDigest' | 'signature'> =
    Object.freeze({
      version: CRYPTO_ADMISSION_RECEIPT_SPEC_VERSION,
      receiptId:
        normalizeOptionalIdentifier(input.receiptId, 'receiptId') ??
        receiptIdFor({
          planId: input.plan.planId,
          subjectId: input.subject.subjectId,
          issuedAt,
        }),
      issuedAt,
      issuer:
        normalizeOptionalIdentifier(input.issuer, 'issuer') ??
        'attestor.crypto-execution-admission',
      serviceId: normalizeIdentifier(input.serviceId, 'serviceId'),
      classification: defaultClassification(input.plan, input.subject.outcome),
      planId: input.plan.planId,
      planDigest: input.plan.digest,
      simulationId: input.plan.simulationId,
      simulationDigest: input.plan.simulationDigest,
      intentId: input.plan.intentId,
      surface: input.plan.surface,
      adapterKind: input.plan.adapterKind,
      planOutcome: input.plan.outcome,
      subject: input.subject,
      trace,
      failureReasons,
      evidenceDigest: cryptoAdmissionDigest({
        planDigest: input.plan.digest,
        subjectDigest: input.subject.subjectDigest,
        failureReasons,
      }),
    });
  const digestMaterial = receiptDigestMaterial(withoutDigest);
  const signature = signReceiptPayload(digestMaterial, input.signer);

  return Object.freeze({
    ...withoutDigest,
    receiptDigest: cryptoAdmissionDigest(digestMaterial),
    signature,
  });
}

export function verifyCryptoAdmissionReceipt(
  input: VerifyCryptoAdmissionReceiptInput,
): CryptoAdmissionReceiptVerification {
  const failures: CryptoAdmissionReceiptVerificationFailure[] = [];
  const { receipt } = input;
  const digestMaterial = receiptDigestMaterial({
    version: receipt.version,
    receiptId: receipt.receiptId,
    issuedAt: receipt.issuedAt,
    issuer: receipt.issuer,
    serviceId: receipt.serviceId,
    classification: receipt.classification,
    planId: receipt.planId,
    planDigest: receipt.planDigest,
    simulationId: receipt.simulationId,
    simulationDigest: receipt.simulationDigest,
    intentId: receipt.intentId,
    surface: receipt.surface,
    adapterKind: receipt.adapterKind,
    planOutcome: receipt.planOutcome,
    subject: receipt.subject,
    trace: receipt.trace,
    failureReasons: receipt.failureReasons,
    evidenceDigest: receipt.evidenceDigest,
  });
  if (cryptoAdmissionDigest(digestMaterial) !== receipt.receiptDigest) {
    failures.push('receipt-digest-mismatch');
  }
  if (Number.isNaN(new Date(receipt.issuedAt).getTime())) {
    failures.push('invalid-timestamp');
  }
  if (
    receipt.subject.planId !== receipt.planId ||
    receipt.subject.planDigest !== receipt.planDigest ||
    receipt.subject.surface !== receipt.surface
  ) {
    failures.push('subject-plan-mismatch');
  }
  try {
    normalizeTraceContext(receipt.trace);
  } catch {
    failures.push('invalid-trace-context');
  }
  if (input.signer) {
    if (input.signer.keyId !== receipt.signature.keyId) {
      failures.push('signature-key-mismatch');
    } else if (!signatureMatches(digestMaterial, input.signer, receipt.signature)) {
      failures.push('signature-mismatch');
    }
  }

  return Object.freeze({
    status: failures.length === 0 ? 'valid' : 'invalid',
    receipt,
    failureReasons: Object.freeze(failures),
  });
}

function eventDigestMaterial(
  event: Omit<CryptoAdmissionTelemetryEvent, 'eventDigest'>,
): unknown {
  return {
    version: event.version,
    specversion: event.specversion,
    id: event.id,
    type: event.type,
    source: event.source,
    subject: event.subject,
    time: event.time,
    datacontenttype: event.datacontenttype,
    traceparent: event.traceparent,
    tracestate: event.tracestate,
    signal: event.signal,
    severityText: event.severityText,
    severityNumber: event.severityNumber,
    attributes: event.attributes,
    data: event.data,
    body: event.body,
  };
}

export function createCryptoAdmissionTelemetryEvent(
  input: CreateCryptoAdmissionTelemetryEventInput,
): CryptoAdmissionTelemetryEvent {
  const source = normalizeIdentifier(input.source, 'source');
  const observedAt = normalizeIsoTimestamp(input.observedAt, 'observedAt');
  if (input.subject.planId !== input.plan.planId || input.subject.planDigest !== input.plan.digest) {
    throw new Error('crypto admission telemetry subject must reference the same admission plan.');
  }
  const signal = input.signal ?? signalFor(input.plan, input.subject);
  const severity = severityFor(signal);
  const trace = normalizeTraceContext({
    traceparent: input.traceparent ?? input.receipt?.trace.traceparent ?? null,
    tracestate: input.tracestate ?? input.receipt?.trace.tracestate ?? null,
  });
  const failureReasons = normalizeStringList(
    input.failureReasons ?? input.receipt?.failureReasons ?? input.plan.blockedReasons,
    'failureReasons',
  );
  const data = Object.freeze({
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    simulationDigest: input.plan.simulationDigest,
    intentId: input.plan.intentId,
    surface: input.plan.surface,
    adapterKind: input.plan.adapterKind,
    planOutcome: input.plan.outcome,
    signal,
    subjectKind: input.subject.subjectKind,
    subjectId: input.subject.subjectId,
    subjectDigest: input.subject.subjectDigest,
    subjectOutcome: input.subject.outcome,
    failureReasons,
    receiptId: input.receipt?.receiptId ?? null,
  });
  const attributes = Object.freeze({
    'attestor.crypto_admission.signal': signal,
    'attestor.crypto_admission.surface': input.plan.surface,
    'attestor.crypto_admission.adapter_kind': input.plan.adapterKind,
    'attestor.crypto_admission.plan_outcome': input.plan.outcome,
    'attestor.crypto_admission.subject_kind': input.subject.subjectKind,
    'attestor.crypto_admission.subject_outcome': input.subject.outcome,
    'attestor.crypto_admission.failure_reason_count': failureReasons.length,
    'attestor.crypto_admission.failure_reasons': failureReasons,
    'attestor.crypto_admission.receipt_id': input.receipt?.receiptId ?? null,
    'event.name':
      signal === 'receipt-issued'
        ? CRYPTO_ADMISSION_RECEIPT_EVENT_TYPE
        : CRYPTO_ADMISSION_TELEMETRY_EVENT_TYPE,
    ...(input.attributes ?? {}),
  });
  const withoutDigest: Omit<CryptoAdmissionTelemetryEvent, 'eventDigest'> =
    Object.freeze({
      version: CRYPTO_ADMISSION_TELEMETRY_SPEC_VERSION,
      specversion: '1.0',
      id: `cate_${randomUUID().replaceAll('-', '')}`,
      type:
        signal === 'receipt-issued'
          ? CRYPTO_ADMISSION_RECEIPT_EVENT_TYPE
          : CRYPTO_ADMISSION_TELEMETRY_EVENT_TYPE,
      source,
      subject: `${input.subject.surface}/${input.subject.subjectKind}/${input.subject.subjectId}`,
      time: observedAt,
      datacontenttype: 'application/json',
      traceparent: trace.traceparent,
      tracestate: trace.tracestate,
      signal,
      severityText: severity.severityText,
      severityNumber: severity.severityNumber,
      attributes,
      data,
      body: input.body ?? defaultBody({ source, signal, subject: input.subject }),
    });

  return Object.freeze({
    ...withoutDigest,
    eventDigest: cryptoAdmissionDigest(eventDigestMaterial(withoutDigest)),
  });
}

export function createInMemoryCryptoAdmissionTelemetrySink():
CryptoAdmissionTelemetrySink {
  const entries: CryptoAdmissionTelemetryEvent[] = [];
  return Object.freeze({
    emit(event: CryptoAdmissionTelemetryEvent): void {
      entries.push(event);
    },
    events(): readonly CryptoAdmissionTelemetryEvent[] {
      return Object.freeze([...entries]);
    },
  });
}

export function buildCryptoAdmissionTelemetrySummary(
  events: readonly CryptoAdmissionTelemetryEvent[],
): CryptoAdmissionTelemetrySummary {
  const bySurface = Object.fromEntries(
    CRYPTO_ADMISSION_SURFACES.map((surface) => [surface, 0]),
  ) as Record<CryptoExecutionAdmissionSurface, number>;
  const failureReasonCounts: Record<string, number> = {};
  for (const event of events) {
    bySurface[event.data.surface] += 1;
    for (const reason of event.data.failureReasons) {
      failureReasonCounts[reason] = (failureReasonCounts[reason] ?? 0) + 1;
    }
  }
  return Object.freeze({
    eventCount: events.length,
    admittedCount: events.filter((event) => event.signal === 'admitted').length,
    blockedCount: events.filter((event) => event.signal === 'blocked').length,
    missingEvidenceCount: events.filter((event) => event.signal === 'missing-evidence').length,
    receiptIssuedCount: events.filter((event) => event.signal === 'receipt-issued').length,
    bySurface: Object.freeze(bySurface),
    failureReasonCounts: Object.freeze(failureReasonCounts),
  });
}

export function cryptoAdmissionTelemetryEventSafetyFindings(
  event: CryptoAdmissionTelemetryEvent,
): readonly string[] {
  const material = canonicalPayload({
    body: event.body,
    attributes: event.attributes,
    data: event.data,
  }).toLowerCase();
  const findings: string[] = [];
  for (const marker of [
    'bearer ',
    'jwt.',
    'private_key',
    'secret=',
    'attestor-release-token',
  ]) {
    if (material.includes(marker)) {
      findings.push(`telemetry contains sensitive marker: ${marker.trim()}`);
    }
  }
  return Object.freeze(findings);
}

export function cryptoAdmissionTelemetryDescriptor():
CryptoAdmissionTelemetryDescriptor {
  return Object.freeze({
    telemetryVersion: CRYPTO_ADMISSION_TELEMETRY_SPEC_VERSION,
    receiptVersion: CRYPTO_ADMISSION_RECEIPT_SPEC_VERSION,
    eventTypes: [
      CRYPTO_ADMISSION_TELEMETRY_EVENT_TYPE,
      CRYPTO_ADMISSION_RECEIPT_EVENT_TYPE,
    ] as const,
    signals: CRYPTO_ADMISSION_TELEMETRY_SIGNALS,
    receiptClassifications: CRYPTO_ADMISSION_RECEIPT_CLASSIFICATIONS,
    signatureModes: CRYPTO_ADMISSION_RECEIPT_SIGNATURE_MODES,
    conventions: Object.freeze([
      'CloudEvents 1.0 envelope fields',
      'OpenTelemetry log/event severity and attributes',
      'W3C Trace Context traceparent/tracestate correlation',
      'Attestor canonical JSON digest',
      'HMAC-SHA256 signed admission receipt',
    ]),
    safetyChecks: Object.freeze([
      'subject-plan alignment',
      'traceparent shape validation',
      'digest verification',
      'signature verification',
      'sensitive marker scan',
    ]),
  });
}
