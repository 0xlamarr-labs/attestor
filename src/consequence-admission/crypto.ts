import {
  CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
  type CryptoExecutionAdmissionOutcome,
  type CryptoExecutionAdmissionPlan,
  type CryptoExecutionAdmissionStep,
} from '../crypto-execution-admission/index.js';
import {
  createConsequenceAdmissionCheck,
  createConsequenceAdmissionRequest,
  createConsequenceAdmissionResponse,
  mapCryptoAdmissionOutcomeToAdmission,
  type ConsequenceAdmissionCheck,
  type ConsequenceAdmissionCheckOutcome,
  type ConsequenceAdmissionEvidenceRef,
  type ConsequenceAdmissionProofRef,
  type ConsequenceAdmissionProposedConsequence,
  type ConsequenceAdmissionRequest,
  type ConsequenceAdmissionResponse,
} from './index.js';

export const CRYPTO_EXECUTION_PLAN_ADMISSION_ENTRY_POINT_ID =
  'crypto-execution-admission-plan';
export const CRYPTO_EXECUTION_PLAN_ADMISSION_SOURCE_REF =
  'src/crypto-execution-admission/index.ts';

type OperationalPrimitive = string | number | boolean | null;

export interface CryptoExecutionPlanAdmissionRequestInput {
  readonly requestedAt: string;
  readonly requestId?: string | null;
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly actor?: string | null;
  readonly action?: string | null;
  readonly downstreamSystem?: string | null;
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

export interface CreateCryptoExecutionPlanAdmissionResponseInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly decidedAt: string;
  readonly request?: ConsequenceAdmissionRequest | null;
  readonly operationalContext?: Readonly<Record<string, OperationalPrimitive>>;
}

export interface CryptoExecutionPlanAdmissionDescriptor {
  readonly packFamily: 'crypto';
  readonly nativeSurface: 'crypto-execution-admission';
  readonly packageSubpath: typeof CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH;
  readonly entryPointId: typeof CRYPTO_EXECUTION_PLAN_ADMISSION_ENTRY_POINT_ID;
  readonly sourceRef: typeof CRYPTO_EXECUTION_PLAN_ADMISSION_SOURCE_REF;
  readonly nativeOutcomeField: 'outcome';
  readonly hostedRouteClaimed: false;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function outcomeCheck(
  outcome: CryptoExecutionAdmissionOutcome,
): ConsequenceAdmissionCheckOutcome {
  if (outcome === 'admit') return 'pass';
  if (outcome === 'needs-evidence') return 'warn';
  return 'fail';
}

function blockedSteps(plan: CryptoExecutionAdmissionPlan): readonly CryptoExecutionAdmissionStep[] {
  return Object.freeze(plan.steps.filter((step) => step.status === 'blocked'));
}

function requiredSteps(plan: CryptoExecutionAdmissionPlan): readonly CryptoExecutionAdmissionStep[] {
  return Object.freeze(plan.steps.filter((step) => step.status === 'required'));
}

function checkOutcomeForKinds(
  plan: CryptoExecutionAdmissionPlan,
  kinds: readonly CryptoExecutionAdmissionStep['kind'][],
  fallback: ConsequenceAdmissionCheckOutcome,
): ConsequenceAdmissionCheckOutcome {
  const matching = plan.steps.filter((step) => kinds.includes(step.kind));
  if (matching.some((step) => step.status === 'blocked')) return 'fail';
  if (matching.some((step) => step.status === 'required')) return 'warn';
  if (matching.some((step) => step.status === 'recommended')) return 'warn';
  if (matching.some((step) => step.status === 'satisfied')) return 'pass';
  return fallback;
}

function adapterReadinessOutcome(
  plan: CryptoExecutionAdmissionPlan,
  fallback: ConsequenceAdmissionCheckOutcome,
): ConsequenceAdmissionCheckOutcome {
  const matching = plan.steps.filter(
    (step) =>
      step.source !== 'admission-planner' &&
      [
        'collect-adapter-preflight',
        'prepare-wallet-call',
        'run-smart-account-guard',
        'simulate-user-operation',
        'verify-http-payment',
        'evaluate-custody-policy',
        'verify-intent-settlement',
      ].includes(step.kind),
  );
  if (matching.some((step) => step.status === 'blocked')) return 'fail';
  if (matching.some((step) => step.status === 'required')) return 'warn';
  if (matching.some((step) => step.status === 'recommended')) return 'warn';
  if (matching.some((step) => step.status === 'satisfied')) return 'pass';
  return fallback;
}

function proofRefs(plan: CryptoExecutionAdmissionPlan): readonly ConsequenceAdmissionProofRef[] {
  return Object.freeze([
    {
      kind: 'admission-plan',
      id: plan.planId,
      digest: plan.digest,
      uri: null,
      verifyHint:
        'Verify the canonical crypto execution admission plan digest before downstream execution.',
    },
    {
      kind: 'external-reference',
      id: plan.simulationId,
      digest: plan.simulationDigest,
      uri: null,
      verifyHint:
        'Verify the referenced crypto authorization simulation before accepting the plan.',
    },
    {
      kind: 'source-module',
      id: CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
      digest: null,
      uri: CRYPTO_EXECUTION_PLAN_ADMISSION_SOURCE_REF,
      verifyHint:
        'Use the package boundary rather than a public hosted crypto route for this projection.',
    },
  ]);
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

function cryptoChecks(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly request: ConsequenceAdmissionRequest;
  readonly proof: readonly ConsequenceAdmissionProofRef[];
}): readonly ConsequenceAdmissionCheck[] {
  const { plan, request, proof } = input;
  const evidenceRefs = evidenceIds(request, proof);
  const outcome = outcomeCheck(plan.outcome);
  const authorityOutcome = checkOutcomeForKinds(
    plan,
    [
      'collect-release-authorization',
      'prepare-wallet-call',
      'run-smart-account-guard',
      'evaluate-custody-policy',
    ],
    outcome,
  );
  const evidenceOutcome = requiredSteps(plan).length > 0
    ? plan.outcome === 'admit' ? 'pass' : 'warn'
    : outcome;
  const freshnessOutcome = checkOutcomeForKinds(
    plan,
    [
      'simulate-user-operation',
      'verify-http-payment',
      'verify-intent-settlement',
      'bind-enforcement-presentation',
    ],
    outcome,
  );
  const enforcementOutcome = blockedSteps(plan).length > 0
    ? 'fail'
    : plan.outcome === 'admit'
      ? 'pass'
      : 'warn';
  const adapterOutcome = adapterReadinessOutcome(plan, outcome);

  return Object.freeze([
    createConsequenceAdmissionCheck({
      kind: 'policy',
      label: 'Crypto admission outcome',
      outcome,
      required: true,
      summary:
        'Crypto execution-admission outcome was projected into the canonical admission vocabulary.',
      reasonCodes: [`crypto-policy-${outcome}`, `crypto-outcome-${plan.outcome}`],
      evidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'authority',
      label: 'Crypto execution authority',
      outcome: authorityOutcome,
      required: true,
      summary:
        'Release authorization, account authority, wallet call, guard, or custody-policy handoff was evaluated by the execution plan.',
      reasonCodes: [`crypto-authority-${authorityOutcome}`],
      evidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'evidence',
      label: 'Crypto execution evidence',
      outcome: evidenceOutcome,
      required: true,
      summary:
        'Crypto simulation digest, admission plan digest, steps, next actions, and required handoff artifacts are preserved for verification.',
      reasonCodes: [`crypto-evidence-${evidenceOutcome}`],
      evidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'freshness',
      label: 'Crypto execution freshness',
      outcome: freshnessOutcome,
      required: true,
      summary:
        'Replay, nonce, validation, payment, or settlement freshness is represented by the selected crypto admission surface.',
      reasonCodes: [`crypto-freshness-${freshnessOutcome}`],
      evidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'enforcement',
      label: 'Crypto downstream enforcement',
      outcome: enforcementOutcome,
      required: true,
      summary:
        plan.outcome === 'admit'
          ? `Downstream execution may proceed through ${plan.surface} and must record an admission receipt.`
          : 'Downstream execution must not proceed automatically until the plan is admitted.',
      reasonCodes: [`crypto-enforcement-${enforcementOutcome}`],
      evidenceRefs,
    }),
    createConsequenceAdmissionCheck({
      kind: 'adapter-readiness',
      label: 'Crypto package adapter readiness',
      outcome: adapterOutcome,
      required: true,
      summary:
        'The crypto projection uses the packaged execution-admission boundary and does not claim a hosted crypto route.',
      reasonCodes: [`crypto-adapter-${adapterOutcome}`, `crypto-surface-${plan.surface}`],
      evidenceRefs: [CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH],
    }),
  ]);
}

function consequenceSummary(plan: CryptoExecutionAdmissionPlan): string {
  return [
    `Crypto ${plan.consequenceKind} consequence`,
    `for account ${plan.accountAddress}`,
    `on ${plan.chainId}`,
    `through ${plan.surface}.`,
  ].join(' ');
}

export function createCryptoExecutionPlanAdmissionRequest(
  input: CryptoExecutionPlanAdmissionRequestInput,
): ConsequenceAdmissionRequest {
  const planEvidence: readonly ConsequenceAdmissionEvidenceRef[] = Object.freeze([
    {
      id: `crypto-plan:${input.plan.planId}`,
      kind: 'crypto-execution-admission-plan',
      digest: input.plan.digest,
      uri: null,
    },
    {
      id: `crypto-simulation:${input.plan.simulationId}`,
      kind: 'crypto-authorization-simulation',
      digest: input.plan.simulationDigest,
      uri: null,
    },
    ...(input.evidence ?? []),
  ]);

  return createConsequenceAdmissionRequest({
    requestedAt: input.requestedAt,
    requestId: input.requestId,
    packFamily: 'crypto',
    entryPoint: {
      kind: 'package-boundary',
      id: CRYPTO_EXECUTION_PLAN_ADMISSION_ENTRY_POINT_ID,
      route: null,
      packageSubpath: CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
      sourceRef: CRYPTO_EXECUTION_PLAN_ADMISSION_SOURCE_REF,
    },
    proposedConsequence: {
      actor: textOrNull(input.actor) ?? input.plan.accountAddress,
      action:
        textOrNull(input.action) ??
        `request ${input.plan.surface} execution admission`,
      downstreamSystem:
        textOrNull(input.downstreamSystem) ?? input.plan.surface,
      consequenceKind: input.plan.consequenceKind,
      riskClass: 'custom',
      summary: textOrNull(input.summary) ?? consequenceSummary(input.plan),
    } satisfies ConsequenceAdmissionProposedConsequence,
    policyScope: {
      policyRef: input.policyRef ?? 'policy:crypto:execution-admission',
      tenantId: input.tenantId ?? null,
      environment: input.environment ?? null,
      dimensions: {
        domain: 'crypto',
        packageSubpath: CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
        planId: input.plan.planId,
        simulationId: input.plan.simulationId,
        intentId: input.plan.intentId,
        chainId: input.plan.chainId,
        accountAddress: input.plan.accountAddress,
        surface: input.plan.surface,
        adapterKind: input.plan.adapterKind,
        consequenceKind: input.plan.consequenceKind,
        ...(input.dimensions ?? {}),
      },
    },
    authority: {
      actorRef: input.actorRef ?? input.plan.accountAddress,
      reviewerRef: input.reviewerRef ?? null,
      signerRef: input.signerRef ?? null,
      delegationRef: input.delegationRef ?? input.plan.integrationRef,
      authorityMode: input.authorityMode ?? null,
    },
    evidence: planEvidence,
    nativeInputRefs: input.nativeInputRefs ?? [
      'CryptoExecutionAdmissionPlan.outcome',
      'simulationDigest',
      'steps',
      'requiredHandoffArtifacts',
      'nextActions',
    ],
  });
}

export function createCryptoExecutionPlanAdmissionResponse(
  input: CreateCryptoExecutionPlanAdmissionResponseInput,
): ConsequenceAdmissionResponse {
  const request =
    input.request ??
    createCryptoExecutionPlanAdmissionRequest({
      requestedAt: input.decidedAt,
      plan: input.plan,
    });
  const nativeDecision = mapCryptoAdmissionOutcomeToAdmission(input.plan.outcome);
  const proof = proofRefs(input.plan);

  return createConsequenceAdmissionResponse({
    request,
    decidedAt: input.decidedAt,
    decision: nativeDecision.mappedDecision,
    reason:
      `Crypto execution-admission outcome ${input.plan.outcome} maps to canonical ${nativeDecision.mappedDecision}.`,
    reasonCodes: [
      `crypto-execution-${nativeDecision.mappedDecision}`,
      `crypto-outcome-${input.plan.outcome}`,
    ],
    checks: cryptoChecks({
      plan: input.plan,
      request,
      proof,
    }),
    nativeDecision,
    proof,
    operationalContext: contextWithoutUndefined({
      planId: input.plan.planId,
      integrationRef: input.plan.integrationRef,
      simulationId: input.plan.simulationId,
      intentId: input.plan.intentId,
      consequenceKind: input.plan.consequenceKind,
      adapterKind: input.plan.adapterKind,
      surface: input.plan.surface,
      chainId: input.plan.chainId,
      accountAddress: input.plan.accountAddress,
      standardsCount: input.plan.standards.length,
      requiredHandoffArtifactCount: input.plan.requiredHandoffArtifacts.length,
      transportHeaderCount: input.plan.transportHeaders.length,
      stepCount: input.plan.steps.length,
      blockedReasonCount: input.plan.blockedReasons.length,
      requiredStepCount: requiredSteps(input.plan).length,
      nextActionCount: input.plan.nextActions.length,
      planCreatedAt: input.plan.createdAt,
      planDigest: input.plan.digest,
      simulationDigest: input.plan.simulationDigest,
      ...(input.operationalContext ?? {}),
    }),
  });
}

export function cryptoExecutionPlanAdmissionDescriptor():
CryptoExecutionPlanAdmissionDescriptor {
  return Object.freeze({
    packFamily: 'crypto',
    nativeSurface: 'crypto-execution-admission',
    packageSubpath: CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
    entryPointId: CRYPTO_EXECUTION_PLAN_ADMISSION_ENTRY_POINT_ID,
    sourceRef: CRYPTO_EXECUTION_PLAN_ADMISSION_SOURCE_REF,
    nativeOutcomeField: 'outcome',
    hostedRouteClaimed: false,
  });
}
