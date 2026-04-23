import {
  createConsequenceAdmissionCheck,
  createConsequenceAdmissionRequest,
  createConsequenceAdmissionResponse,
  mapFinancePipelineDecisionToAdmission,
  type ConsequenceAdmissionCheck,
  type ConsequenceAdmissionCheckOutcome,
  type ConsequenceAdmissionConstraint,
  type ConsequenceAdmissionEvidenceRef,
  type ConsequenceAdmissionProofRef,
  type ConsequenceAdmissionProposedConsequence,
  type ConsequenceAdmissionRequest,
  type ConsequenceAdmissionResponse,
} from './index.js';

export const FINANCE_PIPELINE_ADMISSION_ROUTE = '/api/v1/pipeline/run';
export const FINANCE_PIPELINE_ADMISSION_ENTRY_POINT_ID = 'finance-pipeline-run';
export const FINANCE_PIPELINE_ADMISSION_SOURCE_REF =
  'src/service/http/routes/pipeline-execution-routes.ts';

type OperationalPrimitive = string | number | boolean | null;

export interface FinancePipelineAdmissionRequestInput {
  readonly requestedAt: string;
  readonly requestId?: string | null;
  readonly runId?: string | null;
  readonly actor?: string | null;
  readonly action?: string | null;
  readonly downstreamSystem?: string | null;
  readonly consequenceKind?: ConsequenceAdmissionProposedConsequence['consequenceKind'];
  readonly riskClass?: ConsequenceAdmissionProposedConsequence['riskClass'];
  readonly summary?: string | null;
  readonly policyRef?: string | null;
  readonly tenantId?: string | null;
  readonly environment?: string | null;
  readonly dimensions?: Readonly<Record<string, OperationalPrimitive>>;
  readonly actorRef?: string | null;
  readonly reviewerRef?: string | null;
  readonly signerRef?: string | null;
  readonly delegationRef?: string | null;
  readonly authorityMode?: string | null;
  readonly evidence?: readonly ConsequenceAdmissionEvidenceRef[];
  readonly nativeInputRefs?: readonly string[];
}

export interface FinanceFilingReleaseAdmissionSummary {
  readonly targetId?: string | null;
  readonly decisionId?: string | null;
  readonly decisionStatus?: string | null;
  readonly policyVersion?: string | null;
  readonly introspectionRequired?: boolean | null;
  readonly outputHash?: string | null;
  readonly consequenceHash?: string | null;
  readonly tokenId?: string | null;
  readonly token?: string | null;
  readonly expiresAt?: string | null;
  readonly evidencePackId?: string | null;
  readonly evidencePackPath?: string | null;
  readonly evidencePackDigest?: string | null;
  readonly reviewQueueId?: string | null;
  readonly reviewQueuePath?: string | null;
}

export interface FinanceShadowReleaseAdmissionSummary {
  readonly targetId?: string | null;
  readonly decisionId?: string | null;
  readonly decisionStatus?: string | null;
  readonly policyVersion?: string | null;
  readonly policyRolloutMode?: string | null;
  readonly policyEvaluationMode?: string | null;
  readonly wouldBlockIfEnforced?: boolean | null;
  readonly wouldRequireReview?: boolean | null;
  readonly wouldRequireToken?: boolean | null;
  readonly outputHash?: string | null;
  readonly consequenceHash?: string | null;
}

export interface FinancePipelineAdmissionRun {
  readonly runId: string;
  readonly decision: string;
  readonly proofMode?: string | null;
  readonly warrant?: string | null;
  readonly escrow?: string | null;
  readonly receipt?: string | null;
  readonly capsule?: string | null;
  readonly auditChainIntact?: boolean | null;
  readonly certificate?: Record<string, unknown> | null;
  readonly verification?: Record<string, unknown> | null;
  readonly signingMode?: string | null;
  readonly identitySource?: string | null;
  readonly reviewerName?: string | null;
  readonly tenantContext?: {
    readonly tenantId?: string | null;
    readonly source?: string | null;
    readonly planId?: string | null;
  } | null;
  readonly usage?: {
    readonly used?: number | null;
    readonly remaining?: number | null;
    readonly quota?: number | null;
    readonly enforced?: boolean | null;
  } | null;
  readonly rateLimit?: {
    readonly remaining?: number | null;
    readonly resetAt?: string | null;
    readonly enforced?: boolean | null;
  } | null;
  readonly release?: {
    readonly filingExport?: FinanceFilingReleaseAdmissionSummary | null;
    readonly communication?: FinanceShadowReleaseAdmissionSummary | null;
    readonly action?: FinanceShadowReleaseAdmissionSummary | null;
  } | null;
  readonly filingExport?: {
    readonly adapterId?: string | null;
    readonly coveragePercent?: number | null;
    readonly mappedCount?: number | null;
  } | null;
  readonly filingPackage?: {
    readonly adapterId?: string | null;
    readonly coveragePercent?: number | null;
    readonly mappedCount?: number | null;
    readonly issuedPackage?: Record<string, unknown> | null;
  } | null;
}

export interface CreateFinancePipelineAdmissionResponseInput {
  readonly run: FinancePipelineAdmissionRun;
  readonly decidedAt: string;
  readonly request?: ConsequenceAdmissionRequest | null;
  readonly constraints?: readonly ConsequenceAdmissionConstraint[];
  readonly operationalContext?: Readonly<Record<string, OperationalPrimitive>>;
}

export interface FinancePipelineAdmissionDescriptor {
  readonly packFamily: 'finance';
  readonly nativeSurface: 'finance-pipeline';
  readonly route: typeof FINANCE_PIPELINE_ADMISSION_ROUTE;
  readonly entryPointId: typeof FINANCE_PIPELINE_ADMISSION_ENTRY_POINT_ID;
  readonly sourceRef: typeof FINANCE_PIPELINE_ADMISSION_SOURCE_REF;
  readonly nativeDecisionOrder: readonly [
    'release.filingExport.decisionStatus',
    'decision',
  ];
  readonly hostedRouteBehavior: 'unchanged';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null | undefined, key: string): string | null {
  return textOrNull(record?.[key]);
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function contextWithoutUndefined(
  input: Readonly<Record<string, OperationalPrimitive | undefined>>,
): Readonly<Record<string, OperationalPrimitive>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Record<string, OperationalPrimitive>,
  );
}

function evidenceIds(
  request: ConsequenceAdmissionRequest,
  proof: readonly ConsequenceAdmissionProofRef[],
): readonly string[] {
  return Object.freeze([
    ...request.evidence.map((entry) => entry.id),
    ...proof.map((entry) => entry.id),
  ]);
}

function normalizeReleaseStatus(run: FinancePipelineAdmissionRun): {
  readonly value: string;
  readonly source: 'release.filingExport.decisionStatus' | 'decision';
  readonly filingRelease: FinanceFilingReleaseAdmissionSummary | null;
} {
  const filingRelease = run.release?.filingExport ?? null;
  const releaseStatus = textOrNull(filingRelease?.decisionStatus);
  if (releaseStatus) {
    return Object.freeze({
      value: releaseStatus,
      source: 'release.filingExport.decisionStatus',
      filingRelease,
    });
  }
  return Object.freeze({
    value: run.decision,
    source: 'decision',
    filingRelease,
  });
}

function certificateIdFor(run: FinancePipelineAdmissionRun): string | null {
  return stringField(run.certificate, 'certificateId');
}

function certificateFingerprintFor(run: FinancePipelineAdmissionRun): string | null {
  const signing = recordOrNull(run.certificate?.signing);
  return stringField(signing, 'fingerprint');
}

function buildProofRefs(run: FinancePipelineAdmissionRun): readonly ConsequenceAdmissionProofRef[] {
  const proof: ConsequenceAdmissionProofRef[] = [];
  const certificateId = certificateIdFor(run);
  const certificateFingerprint = certificateFingerprintFor(run);
  const filingRelease = run.release?.filingExport ?? null;

  if (certificateId) {
    proof.push({
      kind: 'certificate',
      id: certificateId,
      digest: certificateFingerprint ? `fingerprint:${certificateFingerprint}` : null,
      uri: null,
      verifyHint: 'Verify the signed Attestor certificate with the returned public key material.',
    });
  }

  if (run.verification) {
    proof.push({
      kind: 'verification-kit',
      id: `verification:${run.runId}`,
      digest: stringField(run.verification, 'digest'),
      uri: stringField(run.verification, 'path'),
      verifyHint: 'Use the verification object returned by the finance pipeline response.',
    });
  }

  if (textOrNull(filingRelease?.tokenId)) {
    const tokenId = textOrNull(filingRelease?.tokenId);
    proof.push({
      kind: 'release-token',
      id: tokenId!,
      digest: null,
      uri: null,
      verifyHint: 'Verify the release token before allowing the downstream filing consequence.',
    });
  }

  const evidencePackId = textOrNull(filingRelease?.evidencePackId);
  if (evidencePackId) {
    proof.push({
      kind: 'release-evidence-pack',
      id: evidencePackId,
      digest: textOrNull(filingRelease?.evidencePackDigest),
      uri: textOrNull(filingRelease?.evidencePackPath),
      verifyHint: 'Fetch and verify the release evidence pack for the filing decision.',
    });
  }

  const reviewQueueId = textOrNull(filingRelease?.reviewQueueId);
  if (reviewQueueId) {
    proof.push({
      kind: 'local-artifact',
      id: reviewQueueId,
      digest: null,
      uri: textOrNull(filingRelease?.reviewQueuePath),
      verifyHint: 'Review queue material must be resolved before automatic consequence.',
    });
  }

  return Object.freeze(proof);
}

function tokenFreshnessOutcome(
  filingRelease: FinanceFilingReleaseAdmissionSummary | null,
  decidedAt: string,
): ConsequenceAdmissionCheckOutcome {
  const expiresAt = textOrNull(filingRelease?.expiresAt);
  if (!expiresAt) return 'not-applicable';
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return 'fail';
  return expiry.getTime() > new Date(decidedAt).getTime() ? 'pass' : 'fail';
}

function buildFinanceChecks(input: {
  readonly run: FinancePipelineAdmissionRun;
  readonly request: ConsequenceAdmissionRequest;
  readonly decidedAt: string;
  readonly proof: readonly ConsequenceAdmissionProofRef[];
  readonly nativeDecisionSource: 'release.filingExport.decisionStatus' | 'decision';
  readonly filingRelease: FinanceFilingReleaseAdmissionSummary | null;
}): readonly ConsequenceAdmissionCheck[] {
  const { run, request, decidedAt, proof, nativeDecisionSource, filingRelease } = input;
  const proofEvidenceRefs = evidenceIds(request, proof);
  const status = textOrNull(filingRelease?.decisionStatus)?.toLowerCase() ?? run.decision.toLowerCase();
  const hasHardReleaseToken = Boolean(textOrNull(filingRelease?.tokenId));
  const hasReviewQueue = Boolean(textOrNull(filingRelease?.reviewQueueId));
  const hasAuthorityMaterial = Boolean(run.warrant || run.escrow || run.receipt || run.capsule);
  const hasProofMaterial = proof.length > 0 || run.auditChainIntact === true || Boolean(run.proofMode);
  const allowStatuses = ['pass', 'accepted', 'allow', 'allowed', 'narrow', 'constrained', 'scope-reduced', 'limited'];
  const reviewStatuses = ['hold', 'review', 'review-required', 'needs-review', 'pending-review'];
  const denyStatuses = ['denied', 'fail', 'block', 'blocked', 'deny', 'revoked', 'expired'];
  const policyOutcome: ConsequenceAdmissionCheckOutcome =
    denyStatuses.includes(status)
      ? 'fail'
      : reviewStatuses.includes(status)
        ? 'warn'
        : allowStatuses.includes(status)
          ? 'pass'
          : 'fail';
  const authorityOutcome: ConsequenceAdmissionCheckOutcome =
    policyOutcome === 'fail'
      ? 'fail'
      : hasAuthorityMaterial || hasHardReleaseToken
        ? 'pass'
        : 'warn';
  const evidenceOutcome: ConsequenceAdmissionCheckOutcome =
    hasProofMaterial ? 'pass' : policyOutcome === 'fail' ? 'fail' : 'warn';
  const freshnessOutcome = tokenFreshnessOutcome(filingRelease, decidedAt);
  const enforcementOutcome: ConsequenceAdmissionCheckOutcome =
    hasHardReleaseToken
      ? 'pass'
      : hasReviewQueue
        ? 'warn'
        : policyOutcome === 'fail'
          ? 'fail'
          : 'warn';

  return Object.freeze([
    createConsequenceAdmissionCheck({
      kind: 'policy',
      label: 'Finance policy decision',
      outcome: policyOutcome,
      required: true,
      summary:
        nativeDecisionSource === 'release.filingExport.decisionStatus'
          ? 'Finance filing release decision was projected into the canonical admission vocabulary.'
          : 'Finance pipeline decision was projected into the canonical admission vocabulary.',
      reasonCodes: [`finance-policy-${policyOutcome}`, `finance-native-${status}`],
      evidenceRefs: proofEvidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'authority',
      label: 'Finance authority closure',
      outcome: authorityOutcome,
      required: true,
      summary: hasAuthorityMaterial || hasHardReleaseToken
        ? 'Finance warrant, escrow, receipt, capsule, or release token material is present.'
        : 'Finance authority material is not fully represented in the native response.',
      reasonCodes: [`finance-authority-${authorityOutcome}`],
      evidenceRefs: proofEvidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'evidence',
      label: 'Finance proof material',
      outcome: evidenceOutcome,
      required: true,
      summary: hasProofMaterial
        ? 'Finance proof material is present for independent inspection.'
        : 'Finance proof material is missing from the native response.',
      reasonCodes: [`finance-evidence-${evidenceOutcome}`],
      evidenceRefs: proofEvidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'freshness',
      label: 'Finance token freshness',
      outcome: freshnessOutcome,
      required: freshnessOutcome !== 'not-applicable',
      summary: textOrNull(filingRelease?.expiresAt)
        ? 'Finance release token expiry was checked against the admission decision time.'
        : 'No finance release token expiry is present on this native response.',
      reasonCodes: [`finance-freshness-${freshnessOutcome}`],
      evidenceRefs: proofEvidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'enforcement',
      label: 'Finance downstream enforcement',
      outcome: enforcementOutcome,
      required: true,
      summary: hasHardReleaseToken
        ? 'A finance release token is present for downstream enforcement.'
        : hasReviewQueue
          ? 'A finance review queue item is present, so automatic downstream consequence must hold.'
          : 'No finance release token is present; the customer system must enforce the canonical decision itself.',
      reasonCodes: [`finance-enforcement-${enforcementOutcome}`],
      evidenceRefs: proofEvidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'adapter-readiness',
      label: 'Finance hosted route adapter',
      outcome: 'pass',
      required: true,
      summary: 'The existing finance hosted proof route is wrapped without changing route behavior.',
      reasonCodes: ['finance-adapter-ready'],
      evidenceRefs: [FINANCE_PIPELINE_ADMISSION_SOURCE_REF],
    }),
  ]);
}

function defaultNarrowConstraints(): readonly ConsequenceAdmissionConstraint[] {
  return Object.freeze([
    {
      id: 'finance-native-constraint',
      summary: 'Proceed only under the constraints returned by the finance native surface.',
      enforcedBy: 'customer downstream system',
    },
  ]);
}

export function createFinancePipelineAdmissionRequest(
  input: FinancePipelineAdmissionRequestInput,
): ConsequenceAdmissionRequest {
  return createConsequenceAdmissionRequest({
    requestedAt: input.requestedAt,
    requestId: input.requestId,
    packFamily: 'finance',
    entryPoint: {
      kind: 'hosted-route',
      id: FINANCE_PIPELINE_ADMISSION_ENTRY_POINT_ID,
      route: FINANCE_PIPELINE_ADMISSION_ROUTE,
      packageSubpath: null,
      sourceRef: FINANCE_PIPELINE_ADMISSION_SOURCE_REF,
    },
    proposedConsequence: {
      actor: textOrNull(input.actor) ?? 'AI-assisted finance workflow',
      action: textOrNull(input.action) ?? 'evaluate a finance consequence before release',
      downstreamSystem: textOrNull(input.downstreamSystem) ?? 'customer finance workflow',
      consequenceKind: input.consequenceKind ?? 'record',
      riskClass: input.riskClass ?? 'R4',
      summary:
        textOrNull(input.summary) ??
        'Finance workflow asks Attestor whether a proposed record, filing, communication, or action may proceed.',
    },
    policyScope: {
      policyRef: input.policyRef ?? 'policy:finance:hosted-proof-wedge',
      tenantId: input.tenantId ?? null,
      environment: input.environment ?? null,
      dimensions: {
        domain: 'finance',
        route: FINANCE_PIPELINE_ADMISSION_ROUTE,
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.dimensions ?? {}),
      },
    },
    authority: {
      actorRef: input.actorRef ?? null,
      reviewerRef: input.reviewerRef ?? null,
      signerRef: input.signerRef ?? null,
      delegationRef: input.delegationRef ?? null,
      authorityMode: input.authorityMode ?? null,
    },
    evidence: input.evidence,
    nativeInputRefs: input.nativeInputRefs ?? ['candidateSql', 'intent', 'fixtures', 'sign'],
  });
}

export function createFinancePipelineAdmissionResponse(
  input: CreateFinancePipelineAdmissionResponseInput,
): ConsequenceAdmissionResponse {
  const request =
    input.request ??
    createFinancePipelineAdmissionRequest({
      requestedAt: input.decidedAt,
      runId: input.run.runId,
      tenantId: input.run.tenantContext?.tenantId ?? null,
      environment: input.run.tenantContext?.source ?? null,
    });
  const native = normalizeReleaseStatus(input.run);
  const nativeDecision = mapFinancePipelineDecisionToAdmission(native.value);
  const proof = buildProofRefs(input.run);
  const decision = nativeDecision.mappedDecision;
  const constraints =
    decision === 'narrow'
      ? input.constraints?.length
        ? input.constraints
        : defaultNarrowConstraints()
      : input.constraints ?? [];

  return createConsequenceAdmissionResponse({
    request,
    decidedAt: input.decidedAt,
    decision,
    reason:
      native.source === 'release.filingExport.decisionStatus'
        ? `Finance filing release status ${native.value} maps to canonical ${decision}.`
        : `Finance pipeline decision ${native.value} maps to canonical ${decision}.`,
    reasonCodes: [
      `finance-${native.source === 'decision' ? 'pipeline' : 'release'}-${decision}`,
      `finance-native-${native.value.toLowerCase()}`,
    ],
    checks: buildFinanceChecks({
      run: input.run,
      request,
      decidedAt: input.decidedAt,
      proof,
      nativeDecisionSource: native.source,
      filingRelease: native.filingRelease,
    }),
    constraints,
    nativeDecision,
    proof,
    operationalContext: contextWithoutUndefined({
      tenantId: input.run.tenantContext?.tenantId ?? null,
      tenantSource: input.run.tenantContext?.source ?? null,
      planId: input.run.tenantContext?.planId ?? null,
      proofMode: input.run.proofMode ?? null,
      signingMode: input.run.signingMode ?? null,
      identitySource: input.run.identitySource ?? null,
      reviewerName: input.run.reviewerName ?? null,
      auditChainIntact: boolOrNull(input.run.auditChainIntact),
      usageUsed: numberOrNull(input.run.usage?.used),
      usageRemaining: numberOrNull(input.run.usage?.remaining),
      usageQuota: numberOrNull(input.run.usage?.quota),
      usageEnforced: boolOrNull(input.run.usage?.enforced),
      rateLimitRemaining: numberOrNull(input.run.rateLimit?.remaining),
      rateLimitEnforced: boolOrNull(input.run.rateLimit?.enforced),
      releaseDecisionId: native.filingRelease?.decisionId ?? null,
      releasePolicyVersion: native.filingRelease?.policyVersion ?? null,
      releaseIntrospectionRequired: boolOrNull(native.filingRelease?.introspectionRequired),
      ...(input.operationalContext ?? {}),
    }),
  });
}

export function financePipelineAdmissionDescriptor():
FinancePipelineAdmissionDescriptor {
  return Object.freeze({
    packFamily: 'finance',
    nativeSurface: 'finance-pipeline',
    route: FINANCE_PIPELINE_ADMISSION_ROUTE,
    entryPointId: FINANCE_PIPELINE_ADMISSION_ENTRY_POINT_ID,
    sourceRef: FINANCE_PIPELINE_ADMISSION_SOURCE_REF,
    nativeDecisionOrder: [
      'release.filingExport.decisionStatus',
      'decision',
    ] as const,
    hostedRouteBehavior: 'unchanged',
  });
}
