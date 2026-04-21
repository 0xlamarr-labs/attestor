import type {
  EnforcementDecision,
  EnforcementReceipt,
  EnforcementRequest,
  VerificationResult,
} from './object-model.js';
import type {
  EnforcementFailureReason,
  ReleaseEnforcementRiskClass,
} from './types.js';
import {
  ENFORCEMENT_TELEMETRY_HIGH_CONSEQUENCE_RISK_CLASSES,
  type EnforcementTelemetryEvent,
  type EnforcementTransparencyReceipt,
  telemetryEventSafetyFindings,
  verifyEnforcementTransparencyReceipt,
} from './telemetry.js';

export const RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION =
  'attestor.release-enforcement-conformance.v1';

export type EnforcementConformanceStatus = 'pass' | 'fail';

export type EnforcementConformanceRuleId =
  | 'result.shape'
  | 'decision.receipt-consistency'
  | 'deny.failure-reasons'
  | 'allow.verification'
  | 'telemetry.required-fields'
  | 'telemetry.failure-alignment'
  | 'telemetry.classification'
  | 'telemetry.no-sensitive-material'
  | 'transparency.receipt-verifies'
  | 'high-consequence.transparency-required';

export interface EnforcementConformanceResultLike {
  readonly status: string;
  readonly checkedAt: string;
  readonly request?: EnforcementRequest | null;
  readonly decision?: EnforcementDecision | null;
  readonly receipt?: EnforcementReceipt | null;
  readonly verificationResult?: VerificationResult | null;
  readonly failureReasons?: readonly EnforcementFailureReason[];
  readonly responseStatus?: number | null;
}

export interface EnforcementConformanceOptions {
  readonly requireTelemetry?: boolean;
  readonly requireTransparencyForHighConsequence?: boolean;
  readonly highConsequenceRiskClasses?: readonly ReleaseEnforcementRiskClass[];
}

export interface EnforcementConformanceCase {
  readonly id: string;
  readonly result: EnforcementConformanceResultLike;
  readonly telemetryEvent?: EnforcementTelemetryEvent | null;
  readonly transparencyReceipt?: EnforcementTransparencyReceipt | null;
  readonly options?: EnforcementConformanceOptions;
}

export interface EnforcementConformanceFinding {
  readonly ruleId: EnforcementConformanceRuleId;
  readonly status: EnforcementConformanceStatus;
  readonly message: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface EnforcementConformanceReport {
  readonly version: typeof RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION;
  readonly caseId: string;
  readonly status: EnforcementConformanceStatus;
  readonly checkedAt: string;
  readonly findings: readonly EnforcementConformanceFinding[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
  };
}

export interface EnforcementConformanceSuiteReport {
  readonly version: typeof RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION;
  readonly checkedAt: string;
  readonly status: EnforcementConformanceStatus;
  readonly caseCount: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly reports: readonly EnforcementConformanceReport[];
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Release enforcement conformance ${fieldName} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function finding(
  ruleId: EnforcementConformanceRuleId,
  status: EnforcementConformanceStatus,
  message: string,
  evidence: Readonly<Record<string, unknown>> = {},
): EnforcementConformanceFinding {
  return Object.freeze({ ruleId, status, message, evidence });
}

function resultFailureReasons(
  result: EnforcementConformanceResultLike,
): readonly EnforcementFailureReason[] {
  return result.failureReasons ?? result.decision?.failureReasons ?? result.receipt?.failureReasons ?? [];
}

function resultVerification(
  result: EnforcementConformanceResultLike,
): VerificationResult | null {
  return result.verificationResult ?? result.decision?.verification ?? null;
}

function resultRiskClass(
  result: EnforcementConformanceResultLike,
): ReleaseEnforcementRiskClass | null {
  return result.decision?.enforcementPoint.riskClass ??
    result.request?.enforcementPoint.riskClass ??
    null;
}

function isDeniedResult(result: EnforcementConformanceResultLike): boolean {
  return result.status === 'denied' ||
    result.status === 'rejected' ||
    result.decision?.outcome === 'deny';
}

function isAllowedResult(result: EnforcementConformanceResultLike): boolean {
  return result.status === 'allowed' ||
    result.status === 'accepted' ||
    result.status === 'break-glass-accepted' ||
    result.decision?.outcome === 'allow' ||
    result.decision?.outcome === 'break-glass-allow';
}

function resultShapeFinding(result: EnforcementConformanceResultLike): EnforcementConformanceFinding {
  const hasStatus = typeof result.status === 'string' && result.status.trim().length > 0;
  const hasTimestamp = Number.isFinite(new Date(result.checkedAt).getTime());
  const hasDecisionOrFailure = Boolean(result.decision) || resultFailureReasons(result).length > 0;
  const status = hasStatus && hasTimestamp && hasDecisionOrFailure ? 'pass' : 'fail';
  return finding(
    'result.shape',
    status,
    status === 'pass'
      ? 'Enforcement result carries status, timestamp, and decision or failure evidence.'
      : 'Enforcement result must carry status, timestamp, and decision or failure evidence.',
    {
      hasStatus,
      hasTimestamp,
      hasDecision: Boolean(result.decision),
      failureReasonCount: resultFailureReasons(result).length,
    },
  );
}

function receiptConsistencyFinding(result: EnforcementConformanceResultLike): EnforcementConformanceFinding {
  if (!result.decision || !result.receipt) {
    return finding(
      'decision.receipt-consistency',
      'pass',
      'Decision/receipt consistency is not required when one side is absent.',
      {
        hasDecision: Boolean(result.decision),
        hasReceipt: Boolean(result.receipt),
      },
    );
  }

  const consistent =
    result.receipt.decisionId === result.decision.id &&
    result.receipt.requestId === result.decision.requestId &&
    result.receipt.outcome === result.decision.outcome &&
    JSON.stringify(result.receipt.failureReasons) === JSON.stringify(result.decision.failureReasons);

  return finding(
    'decision.receipt-consistency',
    consistent ? 'pass' : 'fail',
    consistent
      ? 'Enforcement receipt matches the decision it represents.'
      : 'Enforcement receipt must match decision id, request id, outcome, and failure reasons.',
    {
      decisionId: result.decision.id,
      receiptDecisionId: result.receipt.decisionId,
      decisionOutcome: result.decision.outcome,
      receiptOutcome: result.receipt.outcome,
    },
  );
}

function denyFailureFinding(result: EnforcementConformanceResultLike): EnforcementConformanceFinding {
  if (!isDeniedResult(result)) {
    return finding('deny.failure-reasons', 'pass', 'Result is not a denial.', {
      status: result.status,
    });
  }
  const failures = resultFailureReasons(result);
  return finding(
    'deny.failure-reasons',
    failures.length > 0 ? 'pass' : 'fail',
    failures.length > 0
      ? 'Denied enforcement result carries explicit failure reasons.'
      : 'Denied enforcement result must carry explicit failure reasons.',
    { failureReasonCount: failures.length },
  );
}

function allowVerificationFinding(result: EnforcementConformanceResultLike): EnforcementConformanceFinding {
  if (!isAllowedResult(result)) {
    return finding('allow.verification', 'pass', 'Result is not an allow.', {
      status: result.status,
    });
  }
  const verification = resultVerification(result);
  const breakGlass = result.decision?.breakGlass ?? null;
  const valid = verification?.status === 'valid' || Boolean(breakGlass);
  return finding(
    'allow.verification',
    valid ? 'pass' : 'fail',
    valid
      ? 'Allowed enforcement result is backed by valid verification or an explicit break-glass grant.'
      : 'Allowed enforcement result must be backed by valid verification or an explicit break-glass grant.',
    {
      verificationStatus: verification?.status ?? null,
      hasBreakGlass: Boolean(breakGlass),
    },
  );
}

function telemetryRequiredFinding(
  result: EnforcementConformanceResultLike,
  telemetryEvent: EnforcementTelemetryEvent | null | undefined,
  options: EnforcementConformanceOptions,
): EnforcementConformanceFinding {
  if (!options.requireTelemetry && !telemetryEvent) {
    return finding('telemetry.required-fields', 'pass', 'Telemetry is optional for this case.', {});
  }
  const valid = Boolean(
    telemetryEvent?.version &&
    telemetryEvent.source &&
    telemetryEvent.observedAt &&
    telemetryEvent.eventDigest &&
    telemetryEvent.name,
  );
  return finding(
    'telemetry.required-fields',
    valid ? 'pass' : 'fail',
    valid
      ? 'Telemetry event carries required OTel-style event fields.'
      : 'Telemetry event must carry version, source, observedAt, name, and digest.',
    {
      hasTelemetry: Boolean(telemetryEvent),
      resultStatus: result.status,
    },
  );
}

function telemetryAlignmentFinding(
  result: EnforcementConformanceResultLike,
  telemetryEvent: EnforcementTelemetryEvent | null | undefined,
): EnforcementConformanceFinding {
  if (!telemetryEvent) {
    return finding('telemetry.failure-alignment', 'pass', 'No telemetry event supplied.', {});
  }
  const resultFailures = resultFailureReasons(result);
  const aligned = JSON.stringify(resultFailures) === JSON.stringify(telemetryEvent.failureReasons);
  const refsAligned =
    (!result.decision || telemetryEvent.refs.decisionId === result.decision.id) &&
    (!result.receipt || telemetryEvent.refs.receiptId === result.receipt.id);
  return finding(
    'telemetry.failure-alignment',
    aligned && refsAligned ? 'pass' : 'fail',
    aligned && refsAligned
      ? 'Telemetry event aligns with result failure reasons and decision/receipt references.'
      : 'Telemetry event must align with result failure reasons and decision/receipt references.',
    {
      resultFailures,
      telemetryFailures: telemetryEvent.failureReasons,
      telemetryDecisionId: telemetryEvent.refs.decisionId,
      decisionId: result.decision?.id ?? null,
    },
  );
}

function telemetryClassificationFinding(
  result: EnforcementConformanceResultLike,
  telemetryEvent: EnforcementTelemetryEvent | null | undefined,
): EnforcementConformanceFinding {
  if (!telemetryEvent) {
    return finding('telemetry.classification', 'pass', 'No telemetry event supplied.', {});
  }
  const failures = resultFailureReasons(result);
  const expected =
    result.decision?.outcome === 'break-glass-allow'
      ? 'break-glass'
      : failures.includes('replayed-authorization')
        ? 'replay'
        : failures.some((reason) =>
            reason === 'fresh-introspection-required' ||
            reason === 'stale-authorization' ||
            reason === 'negative-cache-hit' ||
            reason === 'introspection-unavailable')
          ? 'freshness'
          : isDeniedResult(result)
            ? 'deny'
            : 'allow';
  const matches = telemetryEvent.signal === expected;
  return finding(
    'telemetry.classification',
    matches ? 'pass' : 'fail',
    matches
      ? 'Telemetry signal classifies allow/deny/replay/freshness/break-glass consistently.'
      : 'Telemetry signal must classify allow/deny/replay/freshness/break-glass consistently.',
    {
      expected,
      actual: telemetryEvent.signal,
    },
  );
}

function telemetrySafetyFinding(
  telemetryEvent: EnforcementTelemetryEvent | null | undefined,
): EnforcementConformanceFinding {
  if (!telemetryEvent) {
    return finding('telemetry.no-sensitive-material', 'pass', 'No telemetry event supplied.', {});
  }
  const findings = telemetryEventSafetyFindings(telemetryEvent);
  return finding(
    'telemetry.no-sensitive-material',
    findings.length === 0 ? 'pass' : 'fail',
    findings.length === 0
      ? 'Telemetry event does not contain obvious raw authorization material.'
      : 'Telemetry event must not contain raw authorization material.',
    { findings },
  );
}

function transparencyVerificationFinding(
  transparencyReceipt: EnforcementTransparencyReceipt | null | undefined,
): EnforcementConformanceFinding {
  if (!transparencyReceipt) {
    return finding(
      'transparency.receipt-verifies',
      'pass',
      'Transparency receipt is optional when not required.',
      {},
    );
  }
  const verification = verifyEnforcementTransparencyReceipt(transparencyReceipt);
  return finding(
    'transparency.receipt-verifies',
    verification.status === 'valid' ? 'pass' : 'fail',
    verification.status === 'valid'
      ? 'Transparency receipt digest and inclusion proof verify.'
      : 'Transparency receipt digest and inclusion proof must verify.',
    {
      failureReasons: verification.failureReasons,
      subjectDigest: transparencyReceipt.subject.digest,
    },
  );
}

function highConsequenceTransparencyFinding(
  result: EnforcementConformanceResultLike,
  transparencyReceipt: EnforcementTransparencyReceipt | null | undefined,
  options: EnforcementConformanceOptions,
): EnforcementConformanceFinding {
  if (!options.requireTransparencyForHighConsequence) {
    return finding(
      'high-consequence.transparency-required',
      'pass',
      'High-consequence transparency receipts are optional for this case.',
      {},
    );
  }
  const highRiskClasses = new Set(
    options.highConsequenceRiskClasses ?? ENFORCEMENT_TELEMETRY_HIGH_CONSEQUENCE_RISK_CLASSES,
  );
  const riskClass = resultRiskClass(result);
  if (!riskClass || !highRiskClasses.has(riskClass)) {
    return finding(
      'high-consequence.transparency-required',
      'pass',
      'Result is not in a high-consequence risk class.',
      { riskClass },
    );
  }
  const valid = Boolean(transparencyReceipt) &&
    verifyEnforcementTransparencyReceipt(transparencyReceipt!).status === 'valid';
  return finding(
    'high-consequence.transparency-required',
    valid ? 'pass' : 'fail',
    valid
      ? 'High-consequence result has a verifiable transparency receipt.'
      : 'High-consequence result requires a verifiable transparency receipt.',
    {
      riskClass,
      hasTransparencyReceipt: Boolean(transparencyReceipt),
    },
  );
}

export function runEnforcementPointConformance(
  input: EnforcementConformanceCase,
): EnforcementConformanceReport {
  const checkedAt = normalizeIsoTimestamp(input.result.checkedAt, 'result.checkedAt');
  const options = input.options ?? {};
  const findings = Object.freeze([
    resultShapeFinding(input.result),
    receiptConsistencyFinding(input.result),
    denyFailureFinding(input.result),
    allowVerificationFinding(input.result),
    telemetryRequiredFinding(input.result, input.telemetryEvent, options),
    telemetryAlignmentFinding(input.result, input.telemetryEvent),
    telemetryClassificationFinding(input.result, input.telemetryEvent),
    telemetrySafetyFinding(input.telemetryEvent),
    transparencyVerificationFinding(input.transparencyReceipt),
    highConsequenceTransparencyFinding(input.result, input.transparencyReceipt, options),
  ]);
  const failed = findings.filter((entry) => entry.status === 'fail').length;
  return Object.freeze({
    version: RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION,
    caseId: input.id,
    status: failed === 0 ? 'pass' : 'fail',
    checkedAt,
    findings,
    summary: Object.freeze({
      passed: findings.length - failed,
      failed,
    }),
  });
}

export function runReleaseEnforcementConformanceSuite(
  cases: readonly EnforcementConformanceCase[],
  checkedAt = new Date().toISOString(),
): EnforcementConformanceSuiteReport {
  const reports = Object.freeze(cases.map((entry) => runEnforcementPointConformance(entry)));
  const failedCases = reports.filter((report) => report.status === 'fail').length;
  return Object.freeze({
    version: RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION,
    checkedAt: normalizeIsoTimestamp(checkedAt, 'checkedAt'),
    status: failedCases === 0 ? 'pass' : 'fail',
    caseCount: reports.length,
    passedCases: reports.length - failedCases,
    failedCases,
    reports,
  });
}
