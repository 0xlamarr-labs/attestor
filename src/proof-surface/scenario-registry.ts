import {
  RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH,
  RELEASE_LAYER_PUBLIC_SUBPATH,
  releaseLayerPublicSurface,
} from '../release-layer/index.js';
import {
  financeReleaseLayerPublicSurface,
} from '../release-layer/finance.js';
import {
  CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH,
  cryptoAuthorizationCorePublicSurface,
} from '../crypto-authorization-core/index.js';
import {
  CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
  cryptoExecutionAdmissionPublicSurface,
} from '../crypto-execution-admission/index.js';

export const PROOF_SURFACE_SPEC_VERSION = 'attestor.proof-surface.v1';

export const PROOF_SURFACE_PACK_FAMILIES = [
  'finance',
  'crypto',
  'general',
] as const;
export type ProofSurfacePackFamily = typeof PROOF_SURFACE_PACK_FAMILIES[number];

export const PROOF_SURFACE_DECISIONS = [
  'admit',
  'narrow',
  'review',
  'block',
] as const;
export type ProofSurfaceDecision = typeof PROOF_SURFACE_DECISIONS[number];

export const PROOF_SURFACE_ENTRY_POINT_KINDS = [
  'package-surface',
  'hosted-route',
  'local-command',
] as const;
export type ProofSurfaceEntryPointKind =
  typeof PROOF_SURFACE_ENTRY_POINT_KINDS[number];

export const PROOF_SURFACE_PROOF_MATERIAL_KINDS = [
  'release-material',
  'release-evidence-pack',
  'release-token',
  'crypto-admission-plan',
  'crypto-admission-receipt',
  'conformance-fixture',
  'verification-command',
  'source-module',
] as const;
export type ProofSurfaceProofMaterialKind =
  typeof PROOF_SURFACE_PROOF_MATERIAL_KINDS[number];

export const PROOF_SCENARIO_IDS = [
  'finance-filing-admit',
  'finance-filing-review',
  'crypto-x402-payment-admit',
  'crypto-delegated-eoa-block',
  'general-missing-evidence-block',
] as const;
export type ProofScenarioId = typeof PROOF_SCENARIO_IDS[number];

export interface ProofScenarioConsequence {
  readonly actor: string;
  readonly action: string;
  readonly downstreamSystem: string;
  readonly consequenceType: string;
  readonly riskClass: string;
}

export interface ProofScenarioCheckSet {
  readonly policy: string;
  readonly authority: string;
  readonly evidence: string;
}

export interface ProofScenarioEntryPoint {
  readonly kind: ProofSurfaceEntryPointKind;
  readonly packageSubpath: string | null;
  readonly sourceFiles: readonly string[];
  readonly exportedSymbols: readonly string[];
  readonly route: string | null;
  readonly note: string;
}

export interface ProofScenarioProofMaterial {
  readonly kind: ProofSurfaceProofMaterialKind;
  readonly label: string;
  readonly source: string;
  readonly verifyHint: string;
}

export interface ProofScenarioDefinition {
  readonly id: ProofScenarioId;
  readonly title: string;
  readonly packFamily: ProofSurfacePackFamily;
  readonly categoryEntryPoint: string;
  readonly plainLanguageHook: string;
  readonly proposedConsequence: ProofScenarioConsequence;
  readonly entryPoints: readonly ProofScenarioEntryPoint[];
  readonly checks: ProofScenarioCheckSet;
  readonly expectedDecision: ProofSurfaceDecision;
  readonly expectedReason: string;
  readonly proofMaterials: readonly ProofScenarioProofMaterial[];
  readonly customerValue: string;
  readonly nonGoals: readonly string[];
}

export interface ProofSurfaceDescriptor {
  readonly version: typeof PROOF_SURFACE_SPEC_VERSION;
  readonly scenarioCount: number;
  readonly scenarioIds: readonly ProofScenarioId[];
  readonly packFamilies: typeof PROOF_SURFACE_PACK_FAMILIES;
  readonly decisions: typeof PROOF_SURFACE_DECISIONS;
  readonly publicSubpaths: {
    readonly releaseLayer: typeof RELEASE_LAYER_PUBLIC_SUBPATH;
    readonly finance: typeof RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH;
    readonly cryptoAuthorizationCore: typeof CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH;
    readonly cryptoExecutionAdmission: typeof CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH;
  };
}

const releaseLayerSurface = releaseLayerPublicSurface();
const financeSurface = financeReleaseLayerPublicSurface();
const cryptoAuthorizationSurface = cryptoAuthorizationCorePublicSurface();
const cryptoAdmissionSurface = cryptoExecutionAdmissionPublicSurface();

function packageEntryPoint(input: {
  readonly packageSubpath: string;
  readonly sourceFiles: readonly string[];
  readonly exportedSymbols: readonly string[];
  readonly note: string;
}): ProofScenarioEntryPoint {
  return Object.freeze({
    kind: 'package-surface',
    packageSubpath: input.packageSubpath,
    sourceFiles: Object.freeze([...input.sourceFiles]),
    exportedSymbols: Object.freeze([...input.exportedSymbols]),
    route: null,
    note: input.note,
  });
}

export const PROOF_SCENARIO_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'finance-filing-admit',
    title: 'Finance filing release can proceed with proof',
    packFamily: 'finance',
    categoryEntryPoint:
      'An AI-assisted finance workflow is about to prepare a filing-like structured record.',
    plainLanguageHook:
      'The model produced the record, but Attestor checks whether it can become a filing-preparation consequence.',
    proposedConsequence: Object.freeze({
      actor: 'AI-assisted financial reporting workflow',
      action: 'prepare structured filing payload for downstream filing workflow',
      downstreamSystem: 'filing preparation adapter',
      consequenceType: 'record',
      riskClass: 'R4',
    }),
    entryPoints: Object.freeze([
      packageEntryPoint({
        packageSubpath: financeSurface.subpath,
        sourceFiles: Object.freeze([
          'src/release-layer/finance.ts',
          'src/release-kernel/finance-record-release.ts',
        ]),
        exportedSymbols: Object.freeze([
          'financeReleaseLayerPublicSurface',
          'record.createFinanceFilingReleaseCandidateFromReport',
          'record.buildFinanceFilingReleaseMaterial',
          'record.buildFinanceFilingReleaseObservation',
          'record.finalizeFinanceFilingReleaseDecision',
        ]),
        note:
          'Finance remains the deepest proof wedge and uses the packaged release-layer finance surface.',
      }),
    ]),
    checks: Object.freeze({
      policy: 'first hard-gateway finance release policy',
      authority: 'finance-domain receipt, escrow, reviewer, and filing-readiness posture',
      evidence:
        'canonical output/consequence hashes, certificate id, terminal evidence-chain hash, and live-proof mode',
    }),
    expectedDecision: 'admit',
    expectedReason:
      'A downstream filing-preparation consequence may proceed only when finance-domain authority and deterministic release evidence are both satisfied.',
    proofMaterials: Object.freeze([
      Object.freeze({
        kind: 'release-material',
        label: 'Finance filing release material',
        source: 'src/release-kernel/finance-record-release.ts',
        verifyHint: 'Inspect canonical output and consequence hashes on the release material.',
      }),
      Object.freeze({
        kind: 'verification-command',
        label: 'Hybrid proof verification',
        source: 'npm run showcase:proof:hybrid && npm run verify:cert -- .attestor/showcase/latest/evidence/kit.json',
        verifyHint: 'Regenerate and verify the external evidence kit locally.',
      }),
    ]),
    customerValue:
      'Shows that Attestor can turn a high-stakes AI finance output into a bounded release decision with durable proof.',
    nonGoals: Object.freeze([
      'not an EDGAR filing system',
      'not the finance model',
      'not a replacement for reviewer responsibility',
    ]),
  }),
  Object.freeze({
    id: 'finance-filing-review',
    title: 'Finance filing release pauses for review',
    packFamily: 'finance',
    categoryEntryPoint:
      'A finance workflow has useful output, but reviewer authority or release evidence is not complete.',
    plainLanguageHook:
      'Attestor does not turn uncertainty into action; it keeps the consequence in review.',
    proposedConsequence: Object.freeze({
      actor: 'AI-assisted financial reporting workflow',
      action: 'prepare structured filing payload while approval remains pending',
      downstreamSystem: 'filing preparation adapter',
      consequenceType: 'record',
      riskClass: 'R4',
    }),
    entryPoints: Object.freeze([
      packageEntryPoint({
        packageSubpath: financeSurface.subpath,
        sourceFiles: Object.freeze([
          'src/release-layer/finance.ts',
          'src/release-kernel/finance-record-release.ts',
        ]),
        exportedSymbols: Object.freeze([
          'financeReleaseLayerPublicSurface',
          'record.financeFilingReleaseStatusFromReport',
          'record.finalizeFinanceFilingReleaseDecision',
        ]),
        note:
          'The same finance release path can accept, deny, or hold a filing candidate based on domain authority.',
      }),
    ]),
    checks: Object.freeze({
      policy: 'first hard-gateway finance release policy',
      authority: 'pending oversight or withheld receipt keeps the release from becoming final',
      evidence:
        'candidate rows may exist, but release evidence and authority are not sufficient for consequence',
    }),
    expectedDecision: 'review',
    expectedReason:
      'The output exists, but Attestor keeps the consequence out of the downstream filing path until authority is complete.',
    proofMaterials: Object.freeze([
      Object.freeze({
        kind: 'source-module',
        label: 'Finance release status bridge',
        source: 'src/release-kernel/finance-record-release.ts',
        verifyHint: 'Review financeFilingReleaseStatusFromReport and finalizeFinanceFilingReleaseDecision.',
      }),
    ]),
    customerValue:
      'Makes the safe middle state visible: useful AI output can be held for review instead of being silently accepted or rejected.',
    nonGoals: Object.freeze([
      'not a manual approval UI',
      'not a filing submission route',
      'not automatic reviewer substitution',
    ]),
  }),
  Object.freeze({
    id: 'crypto-x402-payment-admit',
    title: 'Agent payment can proceed after admission',
    packFamily: 'crypto',
    categoryEntryPoint:
      'An AI agent or resource server is about to fulfill a paid request through an x402-style payment flow.',
    plainLanguageHook:
      'The agent payment is not treated as just another API call; Attestor requires payment evidence before fulfillment.',
    proposedConsequence: Object.freeze({
      actor: 'AI agent payment client',
      action: 'pay for and unlock a protected resource',
      downstreamSystem: 'x402 resource server',
      consequenceType: 'agent-payment',
      riskClass: 'R3',
    }),
    entryPoints: Object.freeze([
      packageEntryPoint({
        packageSubpath: cryptoAuthorizationSurface.subpath,
        sourceFiles: Object.freeze([
          'src/crypto-authorization-core/index.ts',
          'src/crypto-authorization-core/x402-agentic-payment-adapter.ts',
        ]),
        exportedSymbols: Object.freeze([
          'cryptoAuthorizationCorePublicSurface',
          'x402AgenticPayment.simulateX402AgenticPaymentAuthorization',
        ]),
        note:
          'The crypto authorization core models the programmable-money consequence before execution.',
      }),
      packageEntryPoint({
        packageSubpath: cryptoAdmissionSurface.subpath,
        sourceFiles: Object.freeze([
          'src/crypto-execution-admission/index.ts',
          'src/crypto-execution-admission/x402-resource-server.ts',
        ]),
        exportedSymbols: Object.freeze([
          'cryptoExecutionAdmissionPublicSurface',
          'createCryptoExecutionAdmissionPlan',
          'x402ResourceServer',
          'telemetryReceipts',
        ]),
        note:
          'The execution-admission surface turns the simulation into the x402 handoff before fulfillment.',
      }),
    ]),
    checks: Object.freeze({
      policy: 'agent-payment admission policy and adapter preflight readiness',
      authority: 'wallet/payment authority plus Attestor release and policy binding',
      evidence:
        'PAYMENT-REQUIRED, PAYMENT-SIGNATURE, facilitator verification, settlement posture, and admission receipt',
    }),
    expectedDecision: 'admit',
    expectedReason:
      'The resource server may fulfill only after payment evidence and Attestor admission are both present.',
    proofMaterials: Object.freeze([
      Object.freeze({
        kind: 'crypto-admission-plan',
        label: 'x402 execution-admission plan',
        source: 'src/crypto-execution-admission/index.ts',
        verifyHint: 'createCryptoExecutionAdmissionPlan returns an agent-payment-http admit handoff.',
      }),
      Object.freeze({
        kind: 'conformance-fixture',
        label: 'Crypto execution-admission fixture suite',
        source: 'fixtures/crypto-execution-admission/conformance-fixtures.v1.json',
        verifyHint: 'Validate against fixtures/crypto-execution-admission/conformance-fixtures.schema.json.',
      }),
    ]),
    customerValue:
      'Shows crypto as the same Attestor control model applied before programmable-money fulfillment.',
    nonGoals: Object.freeze([
      'not a wallet',
      'not a custody provider',
      'not a public hosted crypto HTTP route',
    ]),
  }),
  Object.freeze({
    id: 'crypto-delegated-eoa-block',
    title: 'Delegated EOA execution fails closed',
    packFamily: 'crypto',
    categoryEntryPoint:
      'A delegated EOA runtime is about to execute with missing or failing authorization evidence.',
    plainLanguageHook:
      'If delegation evidence is wrong or missing, Attestor blocks the execution path before it becomes a transaction.',
    proposedConsequence: Object.freeze({
      actor: 'delegated EOA runtime',
      action: 'execute a delegated account action',
      downstreamSystem: 'EIP-7702 execution runtime',
      consequenceType: 'account-delegation',
      riskClass: 'R4',
    }),
    entryPoints: Object.freeze([
      packageEntryPoint({
        packageSubpath: cryptoAuthorizationSurface.subpath,
        sourceFiles: Object.freeze([
          'src/crypto-authorization-core/index.ts',
          'src/crypto-authorization-core/eip7702-delegation-adapter.ts',
        ]),
        exportedSymbols: Object.freeze([
          'cryptoAuthorizationCorePublicSurface',
          'eip7702Delegation.simulateEip7702DelegationAuthorization',
        ]),
        note:
          'The crypto authorization core models EIP-7702 delegation evidence and replay/freshness posture.',
      }),
      packageEntryPoint({
        packageSubpath: cryptoAdmissionSurface.subpath,
        sourceFiles: Object.freeze([
          'src/crypto-execution-admission/index.ts',
          'src/crypto-execution-admission/delegated-eoa.ts',
        ]),
        exportedSymbols: Object.freeze([
          'cryptoExecutionAdmissionPublicSurface',
          'createCryptoExecutionAdmissionPlan',
          'delegatedEoa',
          'telemetryReceipts',
        ]),
        note:
          'The admission surface turns a denied or missing-evidence delegation simulation into a fail-closed plan.',
      }),
    ]),
    checks: Object.freeze({
      policy: 'delegated-account execution policy and adapter preflight requirements',
      authority: 'EIP-7702 authorization tuple, delegate-code posture, nonce freshness, and account authority',
      evidence:
        'authorization tuple evidence, delegate-code posture, recovery posture, and signed admission receipt',
    }),
    expectedDecision: 'block',
    expectedReason:
      'A delegated execution path with failed authorization evidence must produce a blocked admission plan, not a best-effort transaction.',
    proofMaterials: Object.freeze([
      Object.freeze({
        kind: 'crypto-admission-plan',
        label: 'Delegated EOA blocked admission plan',
        source: 'src/crypto-execution-admission/index.ts',
        verifyHint: 'createCryptoExecutionAdmissionPlan maps denied EIP-7702 simulation to outcome deny.',
      }),
      Object.freeze({
        kind: 'crypto-admission-receipt',
        label: 'Signed admission receipt support',
        source: 'src/crypto-execution-admission/telemetry-receipts.ts',
        verifyHint: 'Use telemetryReceipts helpers to issue and verify admission receipts.',
      }),
    ]),
    customerValue:
      'Makes the fail-closed crypto story concrete without pretending Attestor is the wallet or chain runtime.',
    nonGoals: Object.freeze([
      'not a transaction broadcaster',
      'not an EOA wallet',
      'not a custody recovery product',
    ]),
  }),
  Object.freeze({
    id: 'general-missing-evidence-block',
    title: 'High-consequence action is blocked without evidence',
    packFamily: 'general',
    categoryEntryPoint:
      'A system wants to send, write, file, execute, or settle before it can show enough evidence.',
    plainLanguageHook:
      'Attestor teaches the core reflex: no evidence, no consequence.',
    proposedConsequence: Object.freeze({
      actor: 'customer-controlled automation',
      action: 'perform a high-consequence downstream action',
      downstreamSystem: 'customer consequence system',
      consequenceType: 'action',
      riskClass: 'R4',
    }),
    entryPoints: Object.freeze([
      packageEntryPoint({
        packageSubpath: releaseLayerSurface.subpaths.core,
        sourceFiles: Object.freeze([
          'src/release-layer/index.ts',
          'src/release-kernel/release-decision-engine.ts',
          'src/release-kernel/release-deterministic-checks.ts',
        ]),
        exportedSymbols: Object.freeze([
          'releaseLayerPublicSurface',
          'decision.createReleaseDecisionEngine',
          'deterministicChecks.runDeterministicReleaseChecks',
        ]),
        note:
          'The general release layer can deny or hold any consequence when policy, authority, or evidence is missing.',
      }),
    ]),
    checks: Object.freeze({
      policy: 'release policy for the proposed consequence',
      authority: 'requester, reviewer, or delegated authority must match the release scope',
      evidence:
        'required output shape, capability boundary, provenance, receipt, and deterministic-check evidence',
    }),
    expectedDecision: 'block',
    expectedReason:
      'When a consequence cannot show enough policy, authority, and evidence, the downstream action must fail closed.',
    proofMaterials: Object.freeze([
      Object.freeze({
        kind: 'source-module',
        label: 'Release decision engine',
        source: 'src/release-kernel/release-decision-engine.ts',
        verifyHint: 'Inspect decision evaluation and deterministic-check application.',
      }),
      Object.freeze({
        kind: 'release-evidence-pack',
        label: 'Release evidence pack support',
        source: 'src/release-kernel/release-evidence-pack.ts',
        verifyHint: 'Use release evidence pack issuance and verification for portable proof.',
      }),
    ]),
    customerValue:
      'Shows the universal Attestor promise in its simplest form: proof first, action second.',
    nonGoals: Object.freeze([
      'not automatic pack detection',
      'not a generic workflow runner',
      'not a substitute for customer enforcement integration',
    ]),
  }),
] satisfies readonly ProofScenarioDefinition[]);

export function listProofScenarioIds(): readonly ProofScenarioId[] {
  return PROOF_SCENARIO_IDS;
}

export function proofScenarioRegistry(): readonly ProofScenarioDefinition[] {
  return PROOF_SCENARIO_REGISTRY;
}

export function getProofScenario(id: ProofScenarioId): ProofScenarioDefinition {
  const scenario = PROOF_SCENARIO_REGISTRY.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown proof scenario: ${id}`);
  }
  return scenario;
}

export function proofScenariosByPack(
  packFamily: ProofSurfacePackFamily,
): readonly ProofScenarioDefinition[] {
  return PROOF_SCENARIO_REGISTRY.filter(
    (scenario) => scenario.packFamily === packFamily,
  );
}

export function proofSurfaceDescriptor(): ProofSurfaceDescriptor {
  return Object.freeze({
    version: PROOF_SURFACE_SPEC_VERSION,
    scenarioCount: PROOF_SCENARIO_REGISTRY.length,
    scenarioIds: PROOF_SCENARIO_IDS,
    packFamilies: PROOF_SURFACE_PACK_FAMILIES,
    decisions: PROOF_SURFACE_DECISIONS,
    publicSubpaths: Object.freeze({
      releaseLayer: RELEASE_LAYER_PUBLIC_SUBPATH,
      finance: RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH,
      cryptoAuthorizationCore: CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH,
      cryptoExecutionAdmission: CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
    }),
  });
}
