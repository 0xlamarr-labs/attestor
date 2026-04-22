import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import {
  FINANCE_PROOF_SCENARIO_IDS,
  runFinanceProofScenario,
  type FinanceProofScenarioId,
  type FinanceProofScenarioRun,
} from './finance-scenarios.js';
import {
  CRYPTO_PROOF_SCENARIO_IDS,
  runCryptoProofScenario,
  type CryptoProofScenarioId,
  type CryptoProofScenarioRun,
} from './crypto-scenarios.js';
import type {
  ProofScenarioConsequence,
  ProofScenarioProofMaterial,
  ProofSurfaceDecision,
  ProofSurfacePackFamily,
} from './scenario-registry.js';

export const PROOF_SURFACE_OUTPUT_SPEC_VERSION =
  'attestor.proof-surface.output.v1';

export const PROOF_SURFACE_OUTPUT_DEFAULT_GENERATED_AT =
  '2026-04-22T12:06:00.000Z';

export const RUNNABLE_PROOF_SCENARIO_IDS = [
  ...FINANCE_PROOF_SCENARIO_IDS,
  ...CRYPTO_PROOF_SCENARIO_IDS,
] as const;

export type RunnableProofScenarioId = typeof RUNNABLE_PROOF_SCENARIO_IDS[number];

export const PROOF_SURFACE_CHECK_NAMES = [
  'policy',
  'authority',
  'evidence',
] as const;
export type ProofSurfaceCheckName = typeof PROOF_SURFACE_CHECK_NAMES[number];

export const PROOF_SURFACE_CHECK_OUTCOMES = [
  'pass',
  'warn',
  'fail',
] as const;
export type ProofSurfaceCheckOutcome =
  typeof PROOF_SURFACE_CHECK_OUTCOMES[number];

export const PROOF_SURFACE_OUTPUT_ANCHOR_KINDS = [
  'release-decision',
  'release-material',
  'admission-plan',
  'admission-receipt',
  'adapter-preflight',
  'authorization-simulation',
] as const;
export type ProofSurfaceOutputAnchorKind =
  typeof PROOF_SURFACE_OUTPUT_ANCHOR_KINDS[number];

type RunnableProofScenarioRun =
  | FinanceProofScenarioRun
  | CryptoProofScenarioRun;

export interface ProofSurfaceOutputSource {
  readonly scenarioId: RunnableProofScenarioId;
  readonly title: string;
  readonly packFamily: Exclude<ProofSurfacePackFamily, 'general'>;
  readonly runVersion:
    | FinanceProofScenarioRun['version']
    | CryptoProofScenarioRun['version'];
  readonly categoryEntryPoint: string;
  readonly plainLanguageHook: string;
}

export interface ProofSurfaceOutputCheck {
  readonly name: ProofSurfaceCheckName;
  readonly label: string;
  readonly outcome: ProofSurfaceCheckOutcome;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
}

export interface ProofSurfaceOutputDecision {
  readonly expected: ProofSurfaceDecision;
  readonly actual: ProofSurfaceDecision;
  readonly failClosed: boolean;
  readonly reason: string;
}

export interface ProofSurfaceOutputAnchor {
  readonly kind: ProofSurfaceOutputAnchorKind;
  readonly label: string;
  readonly id: string;
  readonly digest: string | null;
}

export interface ProofSurfaceOutput {
  readonly version: typeof PROOF_SURFACE_OUTPUT_SPEC_VERSION;
  readonly outputId: string;
  readonly generatedAt: string;
  readonly source: ProofSurfaceOutputSource;
  readonly proposedConsequence: ProofScenarioConsequence;
  readonly checks: {
    readonly policy: ProofSurfaceOutputCheck;
    readonly authority: ProofSurfaceOutputCheck;
    readonly evidence: ProofSurfaceOutputCheck;
  };
  readonly decision: ProofSurfaceOutputDecision;
  readonly proofMaterials: readonly ProofScenarioProofMaterial[];
  readonly evidenceAnchors: readonly ProofSurfaceOutputAnchor[];
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateProofSurfaceOutputOptions {
  readonly generatedAt?: string | null;
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

function normalizeGeneratedAt(value: string | null | undefined): string {
  const raw = value ?? PROOF_SURFACE_OUTPUT_DEFAULT_GENERATED_AT;
  const timestamp = new Date(raw);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Proof surface output generatedAt must be an ISO timestamp.');
  }
  return timestamp.toISOString();
}

function outputIdFor(input: {
  readonly generatedAt: string;
  readonly scenarioId: RunnableProofScenarioId;
  readonly decision: ProofSurfaceDecision;
  readonly anchorDigests: readonly string[];
}): string {
  return canonicalObject({
    version: PROOF_SURFACE_OUTPUT_SPEC_VERSION,
    generatedAt: input.generatedAt,
    scenarioId: input.scenarioId,
    decision: input.decision,
    anchorDigests: input.anchorDigests,
  }).digest;
}

function check(input: {
  readonly name: ProofSurfaceCheckName;
  readonly label: string;
  readonly outcome: ProofSurfaceCheckOutcome;
  readonly summary: string;
  readonly evidenceRefs?: readonly string[];
}): ProofSurfaceOutputCheck {
  return Object.freeze({
    name: input.name,
    label: input.label,
    outcome: input.outcome,
    summary: input.summary,
    evidenceRefs: Object.freeze([...(input.evidenceRefs ?? [])]),
  });
}

function anchor(input: {
  readonly kind: ProofSurfaceOutputAnchorKind;
  readonly label: string;
  readonly id: string | null | undefined;
  readonly digest?: string | null;
}): ProofSurfaceOutputAnchor {
  const id = input.id?.trim() ?? '';
  if (!id) {
    throw new Error(`Proof surface output anchor ${input.label} requires an id.`);
  }
  return Object.freeze({
    kind: input.kind,
    label: input.label,
    id,
    digest: input.digest ?? null,
  });
}

function checkOutcomeFromBoolean(value: boolean): ProofSurfaceCheckOutcome {
  return value ? 'pass' : 'fail';
}

function checkOutcomeFromReadiness(
  readiness: 'ready' | 'missing' | 'blocked',
): ProofSurfaceCheckOutcome {
  switch (readiness) {
    case 'ready':
      return 'pass';
    case 'missing':
      return 'warn';
    case 'blocked':
      return 'fail';
  }
}

function authorityOutcomeForFinance(
  run: FinanceProofScenarioRun,
): ProofSurfaceCheckOutcome {
  if (run.checkResult.authoritySatisfied) return 'pass';
  return run.decision === 'review' ? 'warn' : 'fail';
}

function financeChecks(
  run: FinanceProofScenarioRun,
): ProofSurfaceOutput['checks'] {
  return Object.freeze({
    policy: check({
      name: 'policy',
      label: run.checks.policy,
      outcome: checkOutcomeFromBoolean(run.checkResult.policySatisfied),
      summary: run.matchedPolicyId
        ? `Matched policy ${run.matchedPolicyId}.`
        : 'No release policy matched this proof run.',
      evidenceRefs: [
        run.matchedPolicyId ?? 'policy-unmatched',
        ...run.checkResult.deterministicFindingCodes,
      ],
    }),
    authority: check({
      name: 'authority',
      label: run.checks.authority,
      outcome: authorityOutcomeForFinance(run),
      summary: run.checkResult.authoritySatisfied
        ? 'Finance-domain authority is complete for downstream consequence.'
        : 'Finance-domain authority is pending, so downstream consequence remains paused.',
      evidenceRefs: [
        `final-release-status:${run.finalReleaseStatus}`,
        `raw-release-status:${run.rawReleaseStatus}`,
      ],
    }),
    evidence: check({
      name: 'evidence',
      label: run.checks.evidence,
      outcome: checkOutcomeFromBoolean(run.checkResult.evidenceSatisfied),
      summary:
        'Finance proof binds canonical output hash, consequence hash, certificate posture, and evidence-chain terminal.',
      evidenceRefs: [
        run.material.outputHash,
        run.material.consequenceHash,
        run.material.certificateId ?? 'certificate:null',
        run.material.evidenceChainTerminal,
      ],
    }),
  });
}

function financeAnchors(
  run: FinanceProofScenarioRun,
): readonly ProofSurfaceOutputAnchor[] {
  return Object.freeze([
    anchor({
      kind: 'release-decision',
      label: 'Release decision',
      id: run.releaseDecisionId,
      digest: null,
    }),
    anchor({
      kind: 'release-material',
      label: 'Output hash',
      id: `${run.scenarioId}:output`,
      digest: run.material.outputHash,
    }),
    anchor({
      kind: 'release-material',
      label: 'Consequence hash',
      id: `${run.scenarioId}:consequence`,
      digest: run.material.consequenceHash,
    }),
    anchor({
      kind: 'release-material',
      label: 'Evidence chain terminal',
      id: run.material.evidenceChainTerminal,
      digest: null,
    }),
  ]);
}

function cryptoAuthorityOutcome(
  run: CryptoProofScenarioRun,
): ProofSurfaceCheckOutcome {
  if (run.preflight.signalStatus === 'pass') return 'pass';
  if (run.preflight.signalStatus === 'warn') return 'warn';
  return 'fail';
}

function cryptoEvidenceOutcome(
  run: CryptoProofScenarioRun,
): ProofSurfaceCheckOutcome {
  if (run.admission.outcome === 'deny') return 'fail';
  if (
    run.admission.outcome === 'needs-evidence' ||
    run.admissionReceipt.verificationStatus !== 'valid'
  ) {
    return 'warn';
  }
  return 'pass';
}

function cryptoChecks(
  run: CryptoProofScenarioRun,
): ProofSurfaceOutput['checks'] {
  return Object.freeze({
    policy: check({
      name: 'policy',
      label: run.checks.policy,
      outcome: checkOutcomeFromReadiness(run.simulation.readiness.policyBinding),
      summary:
        'Crypto admission is bound to the active policy scope before execution handoff.',
      evidenceRefs: [
        `policy-binding:${run.simulation.readiness.policyBinding}`,
        run.admission.planId,
      ],
    }),
    authority: check({
      name: 'authority',
      label: run.checks.authority,
      outcome: cryptoAuthorityOutcome(run),
      summary: run.preflight.failedObservationCodes.length === 0
        ? 'Adapter authority evidence is sufficient for this crypto handoff.'
        : `Adapter authority evidence failed: ${run.preflight.failedObservationCodes.join(', ')}.`,
      evidenceRefs: [
        run.preflight.preflightId,
        ...run.preflight.failedObservationCodes,
        ...run.preflight.warningObservationCodes,
      ],
    }),
    evidence: check({
      name: 'evidence',
      label: run.checks.evidence,
      outcome: cryptoEvidenceOutcome(run),
      summary:
        'Crypto proof binds adapter preflight, authorization simulation, admission plan, and signed admission receipt.',
      evidenceRefs: [
        run.preflight.digest,
        run.simulation.digest,
        run.admission.digest,
        run.admissionReceipt.receiptDigest,
      ],
    }),
  });
}

function cryptoAnchors(
  run: CryptoProofScenarioRun,
): readonly ProofSurfaceOutputAnchor[] {
  return Object.freeze([
    anchor({
      kind: 'adapter-preflight',
      label: 'Adapter preflight',
      id: run.preflight.preflightId,
      digest: run.preflight.digest,
    }),
    anchor({
      kind: 'authorization-simulation',
      label: 'Authorization simulation',
      id: run.simulation.simulationId,
      digest: run.simulation.digest,
    }),
    anchor({
      kind: 'admission-plan',
      label: 'Execution admission plan',
      id: run.admission.planId,
      digest: run.admission.digest,
    }),
    anchor({
      kind: 'admission-receipt',
      label: 'Signed admission receipt',
      id: run.admissionReceipt.receiptId,
      digest: run.admissionReceipt.receiptDigest,
    }),
  ]);
}

function sourceFor(run: RunnableProofScenarioRun): ProofSurfaceOutputSource {
  return Object.freeze({
    scenarioId: run.scenarioId,
    title: run.title,
    packFamily: run.packFamily,
    runVersion: run.version,
    categoryEntryPoint: run.categoryEntryPoint,
    plainLanguageHook: run.plainLanguageHook,
  });
}

function checksFor(run: RunnableProofScenarioRun): ProofSurfaceOutput['checks'] {
  return run.packFamily === 'finance'
    ? financeChecks(run)
    : cryptoChecks(run);
}

function anchorsFor(
  run: RunnableProofScenarioRun,
): readonly ProofSurfaceOutputAnchor[] {
  return run.packFamily === 'finance'
    ? financeAnchors(run)
    : cryptoAnchors(run);
}

export function createProofSurfaceOutput(
  run: RunnableProofScenarioRun,
  options: CreateProofSurfaceOutputOptions = {},
): ProofSurfaceOutput {
  const generatedAt = normalizeGeneratedAt(options.generatedAt);
  const checks = checksFor(run);
  const evidenceAnchors = anchorsFor(run);
  const outputId = outputIdFor({
    generatedAt,
    scenarioId: run.scenarioId,
    decision: run.decision,
    anchorDigests: evidenceAnchors.map((entry) => entry.digest ?? entry.id),
  });
  const canonicalPayload = {
    version: PROOF_SURFACE_OUTPUT_SPEC_VERSION,
    outputId,
    generatedAt,
    source: sourceFor(run),
    proposedConsequence: run.proposedConsequence,
    checks,
    decision: {
      expected: run.expectedDecision,
      actual: run.decision,
      failClosed: run.failClosed,
      reason: run.reason,
    },
    proofMaterials: run.proofMaterials,
    evidenceAnchors,
  } as const;
  const canonical = canonicalObject(
    canonicalPayload as unknown as CanonicalReleaseJsonValue,
  );

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function runProofSurfaceScenario(
  scenarioId: RunnableProofScenarioId,
  options: CreateProofSurfaceOutputOptions = {},
): ProofSurfaceOutput {
  if ((FINANCE_PROOF_SCENARIO_IDS as readonly string[]).includes(scenarioId)) {
    return createProofSurfaceOutput(
      runFinanceProofScenario(scenarioId as FinanceProofScenarioId),
      options,
    );
  }
  if ((CRYPTO_PROOF_SCENARIO_IDS as readonly string[]).includes(scenarioId)) {
    return createProofSurfaceOutput(
      runCryptoProofScenario(scenarioId as CryptoProofScenarioId),
      options,
    );
  }
  throw new Error(`Proof scenario ${scenarioId} is not runnable yet.`);
}

export function runProofSurfaceScenarios(
  options: CreateProofSurfaceOutputOptions = {},
): readonly ProofSurfaceOutput[] {
  return Object.freeze(
    RUNNABLE_PROOF_SCENARIO_IDS.map((scenarioId) =>
      runProofSurfaceScenario(scenarioId, options),
    ),
  );
}
