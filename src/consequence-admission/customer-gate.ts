import type {
  ConsequenceAdmissionConstraint,
  ConsequenceAdmissionDecision,
  ConsequenceAdmissionProofRef,
  ConsequenceAdmissionResponse,
} from './index.js';

export const CONSEQUENCE_ADMISSION_CUSTOMER_GATE_VERSION =
  'attestor.consequence-admission-customer-gate.v1';

export type ConsequenceAdmissionCustomerGateOutcome = 'proceed' | 'hold';

export interface EvaluateConsequenceAdmissionGateInput {
  readonly admission: ConsequenceAdmissionResponse;
  readonly downstreamAction: string;
  readonly requireProof?: boolean;
}

export interface ConsequenceAdmissionCustomerGateDecision {
  readonly version: typeof CONSEQUENCE_ADMISSION_CUSTOMER_GATE_VERSION;
  readonly outcome: ConsequenceAdmissionCustomerGateOutcome;
  readonly downstreamAction: string;
  readonly admissionId: string;
  readonly admissionDigest: string;
  readonly decision: ConsequenceAdmissionDecision;
  readonly allowedByAdmission: boolean;
  readonly failClosed: boolean;
  readonly proofRequired: boolean;
  readonly proofSatisfied: boolean;
  readonly proofRefs: readonly ConsequenceAdmissionProofRef[];
  readonly constraints: readonly ConsequenceAdmissionConstraint[];
  readonly reason: string;
  readonly reasonCodes: readonly string[];
  readonly instruction: string;
}

function normalizeDownstreamAction(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Consequence admission customer gate requires a downstream action label.');
  }
  return normalized;
}

function readonlyCopy<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

export class ConsequenceAdmissionGateHeldError extends Error {
  readonly gateDecision: ConsequenceAdmissionCustomerGateDecision;

  constructor(gateDecision: ConsequenceAdmissionCustomerGateDecision) {
    super(gateDecision.reason);
    this.name = 'ConsequenceAdmissionGateHeldError';
    this.gateDecision = gateDecision;
  }
}

export function evaluateConsequenceAdmissionGate(
  input: EvaluateConsequenceAdmissionGateInput,
): ConsequenceAdmissionCustomerGateDecision {
  const downstreamAction = normalizeDownstreamAction(input.downstreamAction);
  const proofRequired = input.requireProof ?? false;
  const proofRefs = readonlyCopy(input.admission.proof);
  const proofSatisfied = !proofRequired || proofRefs.length > 0;
  const allowedByAdmission =
    input.admission.allowed &&
    (input.admission.decision === 'admit' || input.admission.decision === 'narrow') &&
    !input.admission.failClosed;
  const outcome: ConsequenceAdmissionCustomerGateOutcome =
    allowedByAdmission && proofSatisfied ? 'proceed' : 'hold';
  const missingRequiredProof = proofRequired && !proofSatisfied;
  const reasonCodes = Object.freeze([
    ...input.admission.reasonCodes,
    missingRequiredProof ? 'customer-gate-proof-required' : 'customer-gate-proof-satisfied',
    `customer-gate-${outcome}`,
  ]);
  const reason = missingRequiredProof
    ? 'Customer gate held the consequence because required proof references were missing.'
    : outcome === 'proceed'
      ? 'Customer gate may run the downstream action because Attestor admitted the consequence.'
      : `Customer gate held the consequence because Attestor returned ${input.admission.decision}.`;

  return Object.freeze({
    version: CONSEQUENCE_ADMISSION_CUSTOMER_GATE_VERSION,
    outcome,
    downstreamAction,
    admissionId: input.admission.admissionId,
    admissionDigest: input.admission.digest,
    decision: input.admission.decision,
    allowedByAdmission,
    failClosed: input.admission.failClosed || outcome === 'hold',
    proofRequired,
    proofSatisfied,
    proofRefs,
    constraints: readonlyCopy(input.admission.constraints),
    reason,
    reasonCodes,
    instruction: outcome === 'proceed'
      ? `Run downstream action: ${downstreamAction}`
      : `Do not run downstream action: ${downstreamAction}`,
  });
}

export function assertConsequenceAdmissionGateAllows(
  input: EvaluateConsequenceAdmissionGateInput,
): ConsequenceAdmissionCustomerGateDecision {
  const gateDecision = evaluateConsequenceAdmissionGate(input);
  if (gateDecision.outcome !== 'proceed') {
    throw new ConsequenceAdmissionGateHeldError(gateDecision);
  }
  return gateDecision;
}
