import { createHash } from 'node:crypto';
import {
  canonicalizeReleaseJson,
  type CanonicalReleaseJsonValue,
} from '../release-kernel/release-canonicalization.js';
import type { CryptoExecutionAdmissionPlan } from './index.js';

/**
 * Intent-solver admission handoffs bind a solver route to Attestor policy,
 * settlement, slippage, counterparty, deadline, and replay evidence before an
 * intent order is opened, filled, or handed to a solver network.
 */

export const INTENT_SOLVER_ADMISSION_HANDOFF_SPEC_VERSION =
  'attestor.crypto-intent-solver-admission-handoff.v1';

export const INTENT_SOLVER_ADMISSION_OUTCOMES = [
  'ready',
  'needs-solver-evidence',
  'blocked',
] as const;
export type IntentSolverAdmissionOutcome =
  typeof INTENT_SOLVER_ADMISSION_OUTCOMES[number];

export const INTENT_SOLVER_ADMISSION_ACTIONS = [
  'submit-order',
  'request-route-review',
  'block-route',
] as const;
export type IntentSolverAdmissionAction =
  typeof INTENT_SOLVER_ADMISSION_ACTIONS[number];

export const INTENT_SOLVER_ORDER_KINDS = [
  'erc-7683-gasless',
  'erc-7683-onchain',
  'solver-api-quote',
  'custom-intent',
] as const;
export type IntentSolverOrderKind = typeof INTENT_SOLVER_ORDER_KINDS[number];

export const INTENT_SOLVER_SETTLEMENT_METHODS = [
  'erc-7683-open-for',
  'erc-7683-open',
  'solver-api-submit',
  'custom-settlement',
] as const;
export type IntentSolverSettlementMethod =
  typeof INTENT_SOLVER_SETTLEMENT_METHODS[number];

export const INTENT_SOLVER_REPLAY_PROTECTION_MODES = [
  'erc-7683-nonce',
  'permit2-nonce',
  'idempotency-key',
  'one-time-order-id',
] as const;
export type IntentSolverReplayProtectionMode =
  typeof INTENT_SOLVER_REPLAY_PROTECTION_MODES[number];

export const INTENT_SOLVER_COUNTERPARTY_SCREENING_STATUSES = [
  'clear',
  'pending',
  'blocked',
] as const;
export type IntentSolverCounterpartyScreeningStatus =
  typeof INTENT_SOLVER_COUNTERPARTY_SCREENING_STATUSES[number];

export const INTENT_SOLVER_EXPECTATION_KINDS = [
  'plan-surface',
  'adapter-preflight',
  'order-binding',
  'route-commitment',
  'solver-identity',
  'settlement-contract',
  'counterparty-binding',
  'slippage-limit',
  'deadline-window',
  'fill-instructions',
  'liquidity-posture',
  'attestor-token-binding',
  'replay-protection',
  'post-settlement',
] as const;
export type IntentSolverExpectationKind =
  typeof INTENT_SOLVER_EXPECTATION_KINDS[number];

export const INTENT_SOLVER_EXPECTATION_STATUSES = [
  'satisfied',
  'missing',
  'pending',
  'failed',
  'unsupported',
] as const;
export type IntentSolverExpectationStatus =
  typeof INTENT_SOLVER_EXPECTATION_STATUSES[number];

export interface IntentSolverOrderEvidence {
  readonly orderKind: IntentSolverOrderKind;
  readonly orderId: string;
  readonly user: string;
  readonly originChainId: string;
  readonly originSettler: string;
  readonly orderDataType: string | null;
  readonly orderDataHash: string;
  readonly openDeadline: string | null;
  readonly fillDeadline: string;
  readonly nonce: string;
  readonly signatureHash: string | null;
  readonly resolvedOrderHash: string | null;
  readonly maxSpentHash: string | null;
  readonly minReceivedHash: string | null;
}

export interface IntentSolverFillInstructionEvidence {
  readonly instructionId: string;
  readonly destinationChainId: string;
  readonly destinationSettler: string;
  readonly originDataHash: string;
}

export interface IntentSolverRouteCommitmentEvidence {
  readonly routeId: string;
  readonly routeHash: string;
  readonly quoteId: string | null;
  readonly quoteExpiresAt: string | null;
  readonly committedAt: string;
  readonly solverId: string;
  readonly solverAddress: string | null;
  readonly originChainId: string;
  readonly destinationChainIds: readonly string[];
  readonly inputToken: string;
  readonly inputAmount: string;
  readonly outputToken: string;
  readonly quotedOutputAmount: string;
  readonly minOutputAmount: string;
  readonly slippageBps: number;
  readonly maxSlippageBps: number;
  readonly fillInstructions: readonly IntentSolverFillInstructionEvidence[];
  readonly exclusiveSolverId: string | null;
  readonly exclusivityDeadline: string | null;
  readonly counterpartyRefs: readonly string[];
  readonly routeSimulationHash: string | null;
}

export interface IntentSolverSettlementEvidence {
  readonly settlementSystem: string;
  readonly settlementMethod: IntentSolverSettlementMethod;
  readonly originSettler: string;
  readonly destinationSettlers: readonly string[];
  readonly settlementContractVerified: boolean;
  readonly settlementSecurityReviewed: boolean;
  readonly settlementWindowSeconds: number;
  readonly fillDeadline: string;
  readonly refundPathAvailable: boolean;
  readonly settlementOracle: string | null;
  readonly liquiditySource: string | null;
}

export interface IntentSolverCounterpartyEvidence {
  readonly solverId: string;
  readonly solverAddress: string | null;
  readonly allowlisted: boolean;
  readonly blocked: boolean;
  readonly screeningStatus: IntentSolverCounterpartyScreeningStatus;
  readonly reputationTier: string | null;
  readonly bondPosted: boolean | null;
  readonly requiredBondSatisfied: boolean | null;
  readonly blockedCounterpartyRefs: readonly string[];
}

export interface IntentSolverReplayEvidence {
  readonly replayProtectionMode: IntentSolverReplayProtectionMode;
  readonly nonce: string;
  readonly nonceFresh: boolean;
  readonly idempotencyKey: string;
  readonly orderAlreadyOpened: boolean;
  readonly duplicateOrderDetected: boolean;
  readonly routeReplayDetected: boolean;
}

export interface IntentSolverRuntimeObservation {
  readonly observedAt: string;
  readonly orderSubmitted?: boolean | null;
  readonly openTransactionHash?: string | null;
  readonly fillTransactionHashes?: readonly string[] | null;
  readonly settlementCompleted?: boolean | null;
  readonly replayBlocked?: boolean | null;
}

export interface IntentSolverAdmissionExpectation {
  readonly kind: IntentSolverExpectationKind;
  readonly status: IntentSolverExpectationStatus;
  readonly reasonCode: string;
  readonly evidence: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}

export interface IntentSolverAdmissionSettlementWindow {
  readonly openDeadline: string | null;
  readonly fillDeadline: string;
  readonly quoteExpiresAt: string | null;
  readonly settlementWindowSeconds: number;
}

export interface IntentSolverAdmissionSlippageBound {
  readonly inputAmount: string;
  readonly quotedOutputAmount: string;
  readonly minOutputAmount: string;
  readonly slippageBps: number;
  readonly maxSlippageBps: number;
}

export interface IntentSolverAdmissionSubmitContract {
  readonly settlementMethod: IntentSolverSettlementMethod;
  readonly orderKind: IntentSolverOrderKind;
  readonly originSettler: string;
  readonly destinationSettlers: readonly string[];
  readonly requiresResolvedOrder: true;
  readonly requiresFillInstructionBinding: true;
  readonly requiresReplayProtection: true;
  readonly requiresAttestorSidecar: true;
}

export interface CreateIntentSolverAdmissionHandoffInput {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly order: IntentSolverOrderEvidence;
  readonly route: IntentSolverRouteCommitmentEvidence;
  readonly settlement: IntentSolverSettlementEvidence;
  readonly counterparty: IntentSolverCounterpartyEvidence;
  readonly replay: IntentSolverReplayEvidence;
  readonly createdAt: string;
  readonly handoffId?: string | null;
  readonly runtimeObservation?: IntentSolverRuntimeObservation | null;
  readonly operatorNote?: string | null;
}

export interface IntentSolverAdmissionHandoff {
  readonly version: typeof INTENT_SOLVER_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly handoffId: string;
  readonly createdAt: string;
  readonly outcome: IntentSolverAdmissionOutcome;
  readonly action: IntentSolverAdmissionAction;
  readonly planId: string;
  readonly planDigest: string;
  readonly simulationId: string;
  readonly intentId: string;
  readonly orderId: string;
  readonly orderKind: IntentSolverOrderKind;
  readonly routeId: string;
  readonly routeHash: string;
  readonly solverId: string;
  readonly solverAddress: string | null;
  readonly originChainId: string;
  readonly destinationChainIds: readonly string[];
  readonly originSettler: string;
  readonly destinationSettlers: readonly string[];
  readonly settlementMethod: IntentSolverSettlementMethod;
  readonly settlementWindow: IntentSolverAdmissionSettlementWindow;
  readonly slippage: IntentSolverAdmissionSlippageBound;
  readonly replayProtectionMode: IntentSolverReplayProtectionMode;
  readonly idempotencyKey: string;
  readonly submitContract: IntentSolverAdmissionSubmitContract;
  readonly runtimeObservation: IntentSolverRuntimeObservation | null;
  readonly attestorSidecar: Readonly<Record<string, CanonicalReleaseJsonValue>>;
  readonly expectations: readonly IntentSolverAdmissionExpectation[];
  readonly blockingReasons: readonly string[];
  readonly nextActions: readonly string[];
  readonly operatorNote: string | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface IntentSolverAdmissionDescriptor {
  readonly version: typeof INTENT_SOLVER_ADMISSION_HANDOFF_SPEC_VERSION;
  readonly outcomes: typeof INTENT_SOLVER_ADMISSION_OUTCOMES;
  readonly actions: typeof INTENT_SOLVER_ADMISSION_ACTIONS;
  readonly orderKinds: typeof INTENT_SOLVER_ORDER_KINDS;
  readonly settlementMethods: typeof INTENT_SOLVER_SETTLEMENT_METHODS;
  readonly replayProtectionModes: typeof INTENT_SOLVER_REPLAY_PROTECTION_MODES;
  readonly expectationKinds: typeof INTENT_SOLVER_EXPECTATION_KINDS;
  readonly expectationStatuses: typeof INTENT_SOLVER_EXPECTATION_STATUSES;
  readonly runtimeChecks: readonly string[];
  readonly standards: readonly string[];
}

function includesValue<T extends string>(
  values: readonly T[],
  candidate: string,
): candidate is T {
  return (values as readonly string[]).includes(candidate);
}

function normalizeIdentifier(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`intent-solver admission ${fieldName} requires a non-empty value.`);
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

function normalizeStringList(values: readonly string[], fieldName: string): readonly string[] {
  if (values.length === 0) {
    throw new Error(`intent-solver admission ${fieldName} requires at least one value.`);
  }
  return Object.freeze(
    values.map((value, index) => normalizeIdentifier(value, `${fieldName}[${index}]`)),
  );
}

function normalizeOptionalStringList(
  values: readonly string[] | null | undefined,
  fieldName: string,
): readonly string[] | null {
  if (values === undefined || values === null) return null;
  return Object.freeze(
    values.map((value, index) => normalizeIdentifier(value, `${fieldName}[${index}]`)),
  );
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`intent-solver admission ${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

function normalizeOptionalIsoTimestamp(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeIsoTimestamp(value, fieldName);
}

function normalizeOrderKind(value: string): IntentSolverOrderKind {
  const normalized = normalizeIdentifier(value, 'order.orderKind');
  if (!includesValue(INTENT_SOLVER_ORDER_KINDS, normalized)) {
    throw new Error(`intent-solver admission orderKind is unsupported: ${normalized}.`);
  }
  return normalized;
}

function normalizeSettlementMethod(value: string): IntentSolverSettlementMethod {
  const normalized = normalizeIdentifier(value, 'settlement.settlementMethod');
  if (!includesValue(INTENT_SOLVER_SETTLEMENT_METHODS, normalized)) {
    throw new Error(`intent-solver admission settlementMethod is unsupported: ${normalized}.`);
  }
  return normalized;
}

function normalizeReplayProtectionMode(value: string): IntentSolverReplayProtectionMode {
  const normalized = normalizeIdentifier(value, 'replay.replayProtectionMode');
  if (!includesValue(INTENT_SOLVER_REPLAY_PROTECTION_MODES, normalized)) {
    throw new Error(
      `intent-solver admission replayProtectionMode is unsupported: ${normalized}.`,
    );
  }
  return normalized;
}

function normalizeScreeningStatus(value: string): IntentSolverCounterpartyScreeningStatus {
  const normalized = normalizeIdentifier(value, 'counterparty.screeningStatus');
  if (!includesValue(INTENT_SOLVER_COUNTERPARTY_SCREENING_STATUSES, normalized)) {
    throw new Error(
      `intent-solver admission screeningStatus is unsupported: ${normalized}.`,
    );
  }
  return normalized;
}

function normalizeAtomicUnits(value: string, fieldName: string): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) {
    throw new Error(`intent-solver admission ${fieldName} must be unsigned atomic units.`);
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`intent-solver admission ${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`intent-solver admission ${fieldName} must be a positive integer.`);
  }
  return value;
}

function parseAtomicUnits(value: string, fieldName: string): bigint {
  return BigInt(normalizeAtomicUnits(value, fieldName));
}

function sameIdentifier(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left?.trim() ?? '').toLowerCase() === (right?.trim() ?? '').toLowerCase();
}

function deadlineInFuture(deadline: string | null, createdAt: string): boolean {
  if (deadline === null) return true;
  return Date.parse(deadline) > Date.parse(createdAt);
}

function deadlineNotAfter(
  left: string | null,
  right: string,
): boolean {
  if (left === null) return true;
  return Date.parse(left) <= Date.parse(right);
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

function expectation(input: {
  readonly kind: IntentSolverExpectationKind;
  readonly status: IntentSolverExpectationStatus;
  readonly reasonCode: string;
  readonly evidence?: Readonly<Record<string, CanonicalReleaseJsonValue>>;
}): IntentSolverAdmissionExpectation {
  return Object.freeze({
    kind: input.kind,
    status: input.status,
    reasonCode: normalizeIdentifier(input.reasonCode, 'expectation.reasonCode'),
    evidence: Object.freeze(input.evidence ?? {}),
  });
}

function normalizedOrder(order: IntentSolverOrderEvidence): IntentSolverOrderEvidence {
  const openDeadline = normalizeOptionalIsoTimestamp(order.openDeadline, 'order.openDeadline');
  const fillDeadline = normalizeIsoTimestamp(order.fillDeadline, 'order.fillDeadline');
  if (!deadlineNotAfter(openDeadline, fillDeadline)) {
    throw new Error(
      'intent-solver admission order.openDeadline must be at or before order.fillDeadline.',
    );
  }
  return Object.freeze({
    orderKind: normalizeOrderKind(order.orderKind),
    orderId: normalizeIdentifier(order.orderId, 'order.orderId'),
    user: normalizeIdentifier(order.user, 'order.user'),
    originChainId: normalizeIdentifier(order.originChainId, 'order.originChainId'),
    originSettler: normalizeIdentifier(order.originSettler, 'order.originSettler'),
    orderDataType: normalizeOptionalIdentifier(order.orderDataType, 'order.orderDataType'),
    orderDataHash: normalizeIdentifier(order.orderDataHash, 'order.orderDataHash'),
    openDeadline,
    fillDeadline,
    nonce: normalizeIdentifier(order.nonce, 'order.nonce'),
    signatureHash: normalizeOptionalIdentifier(order.signatureHash, 'order.signatureHash'),
    resolvedOrderHash: normalizeOptionalIdentifier(
      order.resolvedOrderHash,
      'order.resolvedOrderHash',
    ),
    maxSpentHash: normalizeOptionalIdentifier(order.maxSpentHash, 'order.maxSpentHash'),
    minReceivedHash: normalizeOptionalIdentifier(
      order.minReceivedHash,
      'order.minReceivedHash',
    ),
  });
}

function normalizedFillInstruction(
  instruction: IntentSolverFillInstructionEvidence,
  index: number,
): IntentSolverFillInstructionEvidence {
  return Object.freeze({
    instructionId: normalizeIdentifier(
      instruction.instructionId,
      `route.fillInstructions[${index}].instructionId`,
    ),
    destinationChainId: normalizeIdentifier(
      instruction.destinationChainId,
      `route.fillInstructions[${index}].destinationChainId`,
    ),
    destinationSettler: normalizeIdentifier(
      instruction.destinationSettler,
      `route.fillInstructions[${index}].destinationSettler`,
    ),
    originDataHash: normalizeIdentifier(
      instruction.originDataHash,
      `route.fillInstructions[${index}].originDataHash`,
    ),
  });
}

function normalizedRoute(
  route: IntentSolverRouteCommitmentEvidence,
): IntentSolverRouteCommitmentEvidence {
  const destinationChainIds = normalizeStringList(
    route.destinationChainIds,
    'route.destinationChainIds',
  );
  if (route.fillInstructions.length === 0) {
    throw new Error('intent-solver admission route.fillInstructions requires at least one value.');
  }
  return Object.freeze({
    routeId: normalizeIdentifier(route.routeId, 'route.routeId'),
    routeHash: normalizeIdentifier(route.routeHash, 'route.routeHash'),
    quoteId: normalizeOptionalIdentifier(route.quoteId, 'route.quoteId'),
    quoteExpiresAt: normalizeOptionalIsoTimestamp(route.quoteExpiresAt, 'route.quoteExpiresAt'),
    committedAt: normalizeIsoTimestamp(route.committedAt, 'route.committedAt'),
    solverId: normalizeIdentifier(route.solverId, 'route.solverId'),
    solverAddress: normalizeOptionalIdentifier(route.solverAddress, 'route.solverAddress'),
    originChainId: normalizeIdentifier(route.originChainId, 'route.originChainId'),
    destinationChainIds,
    inputToken: normalizeIdentifier(route.inputToken, 'route.inputToken'),
    inputAmount: normalizeAtomicUnits(route.inputAmount, 'route.inputAmount'),
    outputToken: normalizeIdentifier(route.outputToken, 'route.outputToken'),
    quotedOutputAmount: normalizeAtomicUnits(
      route.quotedOutputAmount,
      'route.quotedOutputAmount',
    ),
    minOutputAmount: normalizeAtomicUnits(route.minOutputAmount, 'route.minOutputAmount'),
    slippageBps: normalizeNonNegativeInteger(route.slippageBps, 'route.slippageBps'),
    maxSlippageBps: normalizeNonNegativeInteger(
      route.maxSlippageBps,
      'route.maxSlippageBps',
    ),
    fillInstructions: Object.freeze(
      route.fillInstructions.map((instruction, index) =>
        normalizedFillInstruction(instruction, index),
      ),
    ),
    exclusiveSolverId: normalizeOptionalIdentifier(
      route.exclusiveSolverId,
      'route.exclusiveSolverId',
    ),
    exclusivityDeadline: normalizeOptionalIsoTimestamp(
      route.exclusivityDeadline,
      'route.exclusivityDeadline',
    ),
    counterpartyRefs: Object.freeze(
      route.counterpartyRefs.map((value, index) =>
        normalizeIdentifier(value, `route.counterpartyRefs[${index}]`),
      ),
    ),
    routeSimulationHash: normalizeOptionalIdentifier(
      route.routeSimulationHash,
      'route.routeSimulationHash',
    ),
  });
}

function normalizedSettlement(
  settlement: IntentSolverSettlementEvidence,
): IntentSolverSettlementEvidence {
  return Object.freeze({
    settlementSystem: normalizeIdentifier(settlement.settlementSystem, 'settlement.system'),
    settlementMethod: normalizeSettlementMethod(settlement.settlementMethod),
    originSettler: normalizeIdentifier(settlement.originSettler, 'settlement.originSettler'),
    destinationSettlers: normalizeStringList(
      settlement.destinationSettlers,
      'settlement.destinationSettlers',
    ),
    settlementContractVerified: Boolean(settlement.settlementContractVerified),
    settlementSecurityReviewed: Boolean(settlement.settlementSecurityReviewed),
    settlementWindowSeconds: normalizePositiveInteger(
      settlement.settlementWindowSeconds,
      'settlement.settlementWindowSeconds',
    ),
    fillDeadline: normalizeIsoTimestamp(settlement.fillDeadline, 'settlement.fillDeadline'),
    refundPathAvailable: Boolean(settlement.refundPathAvailable),
    settlementOracle: normalizeOptionalIdentifier(
      settlement.settlementOracle,
      'settlement.settlementOracle',
    ),
    liquiditySource: normalizeOptionalIdentifier(
      settlement.liquiditySource,
      'settlement.liquiditySource',
    ),
  });
}

function normalizedCounterparty(
  counterparty: IntentSolverCounterpartyEvidence,
): IntentSolverCounterpartyEvidence {
  return Object.freeze({
    solverId: normalizeIdentifier(counterparty.solverId, 'counterparty.solverId'),
    solverAddress: normalizeOptionalIdentifier(
      counterparty.solverAddress,
      'counterparty.solverAddress',
    ),
    allowlisted: Boolean(counterparty.allowlisted),
    blocked: Boolean(counterparty.blocked),
    screeningStatus: normalizeScreeningStatus(counterparty.screeningStatus),
    reputationTier: normalizeOptionalIdentifier(
      counterparty.reputationTier,
      'counterparty.reputationTier',
    ),
    bondPosted: counterparty.bondPosted ?? null,
    requiredBondSatisfied: counterparty.requiredBondSatisfied ?? null,
    blockedCounterpartyRefs: Object.freeze(
      counterparty.blockedCounterpartyRefs.map((value, index) =>
        normalizeIdentifier(value, `counterparty.blockedCounterpartyRefs[${index}]`),
      ),
    ),
  });
}

function normalizedReplay(replay: IntentSolverReplayEvidence): IntentSolverReplayEvidence {
  return Object.freeze({
    replayProtectionMode: normalizeReplayProtectionMode(replay.replayProtectionMode),
    nonce: normalizeIdentifier(replay.nonce, 'replay.nonce'),
    nonceFresh: Boolean(replay.nonceFresh),
    idempotencyKey: normalizeIdentifier(replay.idempotencyKey, 'replay.idempotencyKey'),
    orderAlreadyOpened: Boolean(replay.orderAlreadyOpened),
    duplicateOrderDetected: Boolean(replay.duplicateOrderDetected),
    routeReplayDetected: Boolean(replay.routeReplayDetected),
  });
}

function normalizedRuntimeObservation(
  observation: IntentSolverRuntimeObservation | null | undefined,
): IntentSolverRuntimeObservation | null {
  if (!observation) return null;
  return Object.freeze({
    observedAt: normalizeIsoTimestamp(observation.observedAt, 'runtimeObservation.observedAt'),
    orderSubmitted: observation.orderSubmitted ?? null,
    openTransactionHash: normalizeOptionalIdentifier(
      observation.openTransactionHash,
      'runtimeObservation.openTransactionHash',
    ),
    fillTransactionHashes: normalizeOptionalStringList(
      observation.fillTransactionHashes,
      'runtimeObservation.fillTransactionHashes',
    ),
    settlementCompleted: observation.settlementCompleted ?? null,
    replayBlocked: observation.replayBlocked ?? null,
  });
}

function fillInstructionsCoverRoute(
  route: IntentSolverRouteCommitmentEvidence,
): boolean {
  const instructionChains = new Set(
    route.fillInstructions.map((instruction) => instruction.destinationChainId),
  );
  return route.destinationChainIds.every((chainId) => instructionChains.has(chainId));
}

function destinationSettlersCoverRoute(
  settlement: IntentSolverSettlementEvidence,
  route: IntentSolverRouteCommitmentEvidence,
): boolean {
  const normalizedSettlers = new Set(
    settlement.destinationSettlers.map((settler) => settler.toLowerCase()),
  );
  return route.fillInstructions.every((instruction) =>
    normalizedSettlers.has(instruction.destinationSettler.toLowerCase()),
  );
}

function routeCounterpartiesAllowed(
  route: IntentSolverRouteCommitmentEvidence,
  counterparty: IntentSolverCounterpartyEvidence,
): boolean {
  if (counterparty.blockedCounterpartyRefs.length === 0) return true;
  const blocked = new Set(
    counterparty.blockedCounterpartyRefs.map((value) => value.toLowerCase()),
  );
  return route.counterpartyRefs.every((value) => !blocked.has(value.toLowerCase()));
}

function expectationsFor(input: {
  readonly plan: CryptoExecutionAdmissionPlan;
  readonly createdAt: string;
  readonly order: IntentSolverOrderEvidence;
  readonly route: IntentSolverRouteCommitmentEvidence;
  readonly settlement: IntentSolverSettlementEvidence;
  readonly counterparty: IntentSolverCounterpartyEvidence;
  readonly replay: IntentSolverReplayEvidence;
  readonly runtimeObservation: IntentSolverRuntimeObservation | null;
}): readonly IntentSolverAdmissionExpectation[] {
  const {
    plan,
    createdAt,
    order,
    route,
    settlement,
    counterparty,
    replay,
    runtimeObservation,
  } = input;
  const minOutput = parseAtomicUnits(route.minOutputAmount, 'route.minOutputAmount');
  const quotedOutput = parseAtomicUnits(route.quotedOutputAmount, 'route.quotedOutputAmount');
  const routeChainsCovered = fillInstructionsCoverRoute(route);
  const settlementCoversRoute = destinationSettlersCoverRoute(settlement, route);
  const routeCounterpartiesClean = routeCounterpartiesAllowed(route, counterparty);
  const orderFresh =
    deadlineInFuture(order.openDeadline, createdAt) &&
    deadlineInFuture(order.fillDeadline, createdAt) &&
    deadlineInFuture(route.quoteExpiresAt, createdAt) &&
    deadlineInFuture(route.exclusivityDeadline, createdAt);
  const deadlinesBound =
    settlement.fillDeadline === order.fillDeadline &&
    deadlineNotAfter(route.quoteExpiresAt, order.fillDeadline) &&
    deadlineNotAfter(route.exclusivityDeadline, order.fillDeadline);

  return Object.freeze([
    expectation({
      kind: 'plan-surface',
      status:
        plan.surface === 'intent-solver' && plan.adapterKind === 'intent-settlement'
          ? 'satisfied'
          : 'failed',
      reasonCode:
        plan.surface === 'intent-solver' && plan.adapterKind === 'intent-settlement'
          ? 'intent-solver-plan-bound'
          : 'intent-solver-plan-surface-mismatch',
      evidence: {
        planSurface: plan.surface,
        adapterKind: plan.adapterKind,
        planOutcome: plan.outcome,
      },
    }),
    expectation({
      kind: 'adapter-preflight',
      status:
        plan.outcome === 'deny'
          ? 'failed'
          : plan.outcome === 'admit'
            ? 'satisfied'
            : 'missing',
      reasonCode:
        plan.outcome === 'deny'
          ? 'intent-solver-plan-denied'
          : plan.outcome === 'admit'
            ? 'intent-solver-plan-admitted'
            : 'intent-solver-plan-needs-evidence',
      evidence: {
        requiredArtifacts: [...plan.requiredHandoffArtifacts],
        blockedReasons: [...plan.blockedReasons],
      },
    }),
    expectation({
      kind: 'order-binding',
      status:
        sameIdentifier(order.originChainId, plan.chainId) &&
        sameIdentifier(order.user, plan.accountAddress) &&
        sameIdentifier(route.originChainId, order.originChainId)
          ? 'satisfied'
          : 'failed',
      reasonCode:
        sameIdentifier(order.originChainId, plan.chainId) &&
        sameIdentifier(order.user, plan.accountAddress) &&
        sameIdentifier(route.originChainId, order.originChainId)
          ? 'intent-order-bound-to-plan'
          : 'intent-order-plan-mismatch',
      evidence: {
        orderId: order.orderId,
        orderKind: order.orderKind,
        orderUser: order.user,
        planAccount: plan.accountAddress,
        originChainId: order.originChainId,
        planChainId: plan.chainId,
      },
    }),
    expectation({
      kind: 'route-commitment',
      status: route.routeHash && route.routeSimulationHash ? 'satisfied' : 'missing',
      reasonCode:
        route.routeHash && route.routeSimulationHash
          ? 'solver-route-commitment-bound'
          : 'solver-route-commitment-missing',
      evidence: {
        routeId: route.routeId,
        routeHash: route.routeHash,
        routeSimulationHash: route.routeSimulationHash,
      },
    }),
    expectation({
      kind: 'solver-identity',
      status:
        counterparty.solverId === route.solverId &&
        sameIdentifier(counterparty.solverAddress, route.solverAddress)
          ? 'satisfied'
          : 'failed',
      reasonCode:
        counterparty.solverId === route.solverId &&
        sameIdentifier(counterparty.solverAddress, route.solverAddress)
          ? 'solver-identity-bound'
          : 'solver-identity-mismatch',
      evidence: {
        routeSolverId: route.solverId,
        counterpartySolverId: counterparty.solverId,
        routeSolverAddress: route.solverAddress,
        counterpartySolverAddress: counterparty.solverAddress,
      },
    }),
    expectation({
      kind: 'settlement-contract',
      status:
        sameIdentifier(order.originSettler, settlement.originSettler) &&
        settlementCoversRoute &&
        settlement.settlementContractVerified &&
        settlement.settlementSecurityReviewed
          ? 'satisfied'
          : settlement.settlementContractVerified
            ? 'pending'
            : 'failed',
      reasonCode:
        sameIdentifier(order.originSettler, settlement.originSettler) &&
        settlementCoversRoute &&
        settlement.settlementContractVerified &&
        settlement.settlementSecurityReviewed
          ? 'settlement-contracts-verified'
          : !settlement.settlementContractVerified
            ? 'settlement-contract-unverified'
            : 'settlement-contract-review-pending',
      evidence: {
        originSettler: settlement.originSettler,
        destinationSettlers: [...settlement.destinationSettlers],
        settlementSystem: settlement.settlementSystem,
        settlementSecurityReviewed: settlement.settlementSecurityReviewed,
      },
    }),
    expectation({
      kind: 'counterparty-binding',
      status:
        counterparty.allowlisted &&
        !counterparty.blocked &&
        counterparty.screeningStatus === 'clear' &&
        routeCounterpartiesClean
          ? 'satisfied'
          : counterparty.screeningStatus === 'pending'
            ? 'pending'
            : 'failed',
      reasonCode:
        counterparty.allowlisted &&
        !counterparty.blocked &&
        counterparty.screeningStatus === 'clear' &&
        routeCounterpartiesClean
          ? 'solver-counterparties-clear'
          : counterparty.screeningStatus === 'pending'
            ? 'solver-counterparty-screening-pending'
            : 'solver-counterparty-blocked',
      evidence: {
        allowlisted: counterparty.allowlisted,
        blocked: counterparty.blocked,
        screeningStatus: counterparty.screeningStatus,
        counterpartyRefs: [...route.counterpartyRefs],
        blockedCounterpartyRefs: [...counterparty.blockedCounterpartyRefs],
      },
    }),
    expectation({
      kind: 'slippage-limit',
      status:
        minOutput <= quotedOutput && route.slippageBps <= route.maxSlippageBps
          ? 'satisfied'
          : 'failed',
      reasonCode:
        minOutput <= quotedOutput && route.slippageBps <= route.maxSlippageBps
          ? 'solver-slippage-within-bound'
          : 'solver-slippage-out-of-bound',
      evidence: {
        quotedOutputAmount: route.quotedOutputAmount,
        minOutputAmount: route.minOutputAmount,
        slippageBps: route.slippageBps,
        maxSlippageBps: route.maxSlippageBps,
      },
    }),
    expectation({
      kind: 'deadline-window',
      status: orderFresh && deadlinesBound ? 'satisfied' : 'failed',
      reasonCode:
        orderFresh && deadlinesBound
          ? 'solver-deadlines-bound-and-fresh'
          : 'solver-deadline-window-invalid',
      evidence: {
        createdAt,
        openDeadline: order.openDeadline,
        fillDeadline: order.fillDeadline,
        quoteExpiresAt: route.quoteExpiresAt,
        exclusivityDeadline: route.exclusivityDeadline,
        settlementFillDeadline: settlement.fillDeadline,
      },
    }),
    expectation({
      kind: 'fill-instructions',
      status:
        routeChainsCovered &&
        route.fillInstructions.length > 0 &&
        order.resolvedOrderHash !== null
          ? 'satisfied'
          : 'missing',
      reasonCode:
        routeChainsCovered &&
        route.fillInstructions.length > 0 &&
        order.resolvedOrderHash !== null
          ? 'solver-fill-instructions-bound'
          : 'solver-fill-instructions-incomplete',
      evidence: {
        destinationChainIds: [...route.destinationChainIds],
        fillInstructionCount: route.fillInstructions.length,
        resolvedOrderHash: order.resolvedOrderHash,
      },
    }),
    expectation({
      kind: 'liquidity-posture',
      status:
        settlement.liquiditySource &&
        settlement.refundPathAvailable &&
        counterparty.requiredBondSatisfied !== false
          ? 'satisfied'
          : 'pending',
      reasonCode:
        settlement.liquiditySource &&
        settlement.refundPathAvailable &&
        counterparty.requiredBondSatisfied !== false
          ? 'solver-liquidity-and-refund-ready'
          : 'solver-liquidity-or-refund-pending',
      evidence: {
        liquiditySource: settlement.liquiditySource,
        refundPathAvailable: settlement.refundPathAvailable,
        bondPosted: counterparty.bondPosted,
        requiredBondSatisfied: counterparty.requiredBondSatisfied,
      },
    }),
    expectation({
      kind: 'attestor-token-binding',
      status: plan.requiredHandoffArtifacts.includes('attestor-release-authorization')
        ? 'satisfied'
        : 'failed',
      reasonCode: plan.requiredHandoffArtifacts.includes('attestor-release-authorization')
        ? 'attestor-release-authorization-bound'
        : 'attestor-release-authorization-missing',
      evidence: {
        planId: plan.planId,
        planDigest: plan.digest,
        simulationDigest: plan.simulationDigest,
      },
    }),
    expectation({
      kind: 'replay-protection',
      status:
        replay.nonce === order.nonce &&
        replay.nonceFresh &&
        !replay.orderAlreadyOpened &&
        !replay.duplicateOrderDetected &&
        !replay.routeReplayDetected
          ? 'satisfied'
          : 'failed',
      reasonCode:
        replay.nonce === order.nonce &&
        replay.nonceFresh &&
        !replay.orderAlreadyOpened &&
        !replay.duplicateOrderDetected &&
        !replay.routeReplayDetected
          ? 'solver-replay-protection-bound'
          : 'solver-replay-risk-detected',
      evidence: {
        replayProtectionMode: replay.replayProtectionMode,
        orderNonce: order.nonce,
        replayNonce: replay.nonce,
        idempotencyKey: replay.idempotencyKey,
        orderAlreadyOpened: replay.orderAlreadyOpened,
        duplicateOrderDetected: replay.duplicateOrderDetected,
        routeReplayDetected: replay.routeReplayDetected,
      },
    }),
    expectation({
      kind: 'post-settlement',
      status:
        runtimeObservation === null
          ? 'pending'
          : runtimeObservation.replayBlocked === true ||
              runtimeObservation.settlementCompleted === false
            ? 'failed'
            : runtimeObservation.settlementCompleted === true
              ? 'satisfied'
              : 'pending',
      reasonCode:
        runtimeObservation === null
          ? 'solver-post-settlement-not-observed'
          : runtimeObservation.replayBlocked === true
            ? 'solver-post-settlement-replay-blocked'
            : runtimeObservation.settlementCompleted === false
              ? 'solver-post-settlement-failed'
              : runtimeObservation.settlementCompleted === true
                ? 'solver-post-settlement-recorded'
                : 'solver-post-settlement-pending',
      evidence: {
        observedAt: runtimeObservation?.observedAt ?? null,
        orderSubmitted: runtimeObservation?.orderSubmitted ?? null,
        settlementCompleted: runtimeObservation?.settlementCompleted ?? null,
        replayBlocked: runtimeObservation?.replayBlocked ?? null,
      },
    }),
  ]);
}

function outcomeFor(
  expectations: readonly IntentSolverAdmissionExpectation[],
): IntentSolverAdmissionOutcome {
  if (expectations.some((entry) => entry.status === 'failed' || entry.status === 'unsupported')) {
    return 'blocked';
  }
  const admissionBlockingKinds: readonly IntentSolverExpectationKind[] = [
    'plan-surface',
    'adapter-preflight',
    'order-binding',
    'route-commitment',
    'solver-identity',
    'settlement-contract',
    'counterparty-binding',
    'slippage-limit',
    'deadline-window',
    'fill-instructions',
    'liquidity-posture',
    'attestor-token-binding',
    'replay-protection',
  ];
  const admissionExpectations = expectations.filter((entry) =>
    admissionBlockingKinds.includes(entry.kind),
  );
  if (admissionExpectations.some((entry) => entry.status !== 'satisfied')) {
    return 'needs-solver-evidence';
  }
  return 'ready';
}

function actionFor(outcome: IntentSolverAdmissionOutcome): IntentSolverAdmissionAction {
  if (outcome === 'ready') return 'submit-order';
  if (outcome === 'needs-solver-evidence') return 'request-route-review';
  return 'block-route';
}

function blockingReasonsFor(
  expectations: readonly IntentSolverAdmissionExpectation[],
): readonly string[] {
  return Object.freeze(
    expectations
      .filter((entry) => entry.status === 'failed' || entry.status === 'unsupported')
      .map((entry) => entry.reasonCode),
  );
}

function nextActionsFor(
  outcome: IntentSolverAdmissionOutcome,
  expectations: readonly IntentSolverAdmissionExpectation[],
): readonly string[] {
  if (outcome === 'ready') {
    return Object.freeze([
      'Submit the admitted intent order through the bound settlement method and solver route.',
      'Record post-settlement observation against the Attestor handoff after execution returns.',
    ]);
  }
  if (outcome === 'blocked') {
    return Object.freeze([
      'Do not open, fill, submit, or broadcast this intent route.',
      'Create a new solver route commitment after resolving blocked Attestor expectations.',
    ]);
  }
  return Object.freeze(
    expectations
      .filter((entry) => entry.status === 'missing' || entry.status === 'pending')
      .map((entry) => entry.reasonCode),
  );
}

function handoffIdFor(input: {
  readonly planId: string;
  readonly orderId: string;
  readonly routeId: string;
  readonly createdAt: string;
}): string {
  const material = canonicalizeReleaseJson(input as unknown as CanonicalReleaseJsonValue);
  return `intent-solver-handoff-${createHash('sha256')
    .update(material)
    .digest('hex')
    .slice(0, 24)}`;
}

export function createIntentSolverAdmissionHandoff(
  input: CreateIntentSolverAdmissionHandoffInput,
): IntentSolverAdmissionHandoff {
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'createdAt');
  const order = normalizedOrder(input.order);
  const route = normalizedRoute(input.route);
  const settlement = normalizedSettlement(input.settlement);
  const counterparty = normalizedCounterparty(input.counterparty);
  const replay = normalizedReplay(input.replay);
  const runtimeObservation = normalizedRuntimeObservation(input.runtimeObservation);
  const expectations = expectationsFor({
    plan: input.plan,
    createdAt,
    order,
    route,
    settlement,
    counterparty,
    replay,
    runtimeObservation,
  });
  const outcome = outcomeFor(expectations);
  const action = actionFor(outcome);
  const handoffId =
    normalizeOptionalIdentifier(input.handoffId, 'handoffId') ??
    handoffIdFor({
      planId: input.plan.planId,
      orderId: order.orderId,
      routeId: route.routeId,
      createdAt,
    });
  const destinationSettlers = Object.freeze([...settlement.destinationSettlers]);
  const canonicalPayload = {
    version: INTENT_SOLVER_ADMISSION_HANDOFF_SPEC_VERSION,
    handoffId,
    createdAt,
    outcome,
    action,
    planId: input.plan.planId,
    planDigest: input.plan.digest,
    simulationId: input.plan.simulationId,
    intentId: input.plan.intentId,
    orderId: order.orderId,
    orderKind: order.orderKind,
    routeId: route.routeId,
    routeHash: route.routeHash,
    solverId: route.solverId,
    solverAddress: route.solverAddress,
    originChainId: order.originChainId,
    destinationChainIds: Object.freeze([...route.destinationChainIds]),
    originSettler: order.originSettler,
    destinationSettlers,
    settlementMethod: settlement.settlementMethod,
    settlementWindow: Object.freeze({
      openDeadline: order.openDeadline,
      fillDeadline: order.fillDeadline,
      quoteExpiresAt: route.quoteExpiresAt,
      settlementWindowSeconds: settlement.settlementWindowSeconds,
    }),
    slippage: Object.freeze({
      inputAmount: route.inputAmount,
      quotedOutputAmount: route.quotedOutputAmount,
      minOutputAmount: route.minOutputAmount,
      slippageBps: route.slippageBps,
      maxSlippageBps: route.maxSlippageBps,
    }),
    replayProtectionMode: replay.replayProtectionMode,
    idempotencyKey: replay.idempotencyKey,
    submitContract: Object.freeze({
      settlementMethod: settlement.settlementMethod,
      orderKind: order.orderKind,
      originSettler: settlement.originSettler,
      destinationSettlers,
      requiresResolvedOrder: true,
      requiresFillInstructionBinding: true,
      requiresReplayProtection: true,
      requiresAttestorSidecar: true,
    }),
    runtimeObservation,
    attestorSidecar: Object.freeze({
      attestorPlanId: input.plan.planId,
      attestorPlanDigest: input.plan.digest,
      attestorSimulationId: input.plan.simulationId,
      attestorSimulationDigest: input.plan.simulationDigest,
      routeHash: route.routeHash,
      orderDataHash: order.orderDataHash,
      resolvedOrderHash: order.resolvedOrderHash,
    }),
    expectations,
    blockingReasons: blockingReasonsFor(expectations),
    nextActions: nextActionsFor(outcome, expectations),
    operatorNote: normalizeOptionalIdentifier(input.operatorNote, 'operatorNote'),
  } as const;
  const canonical = canonicalObject(canonicalPayload as unknown as CanonicalReleaseJsonValue);

  return Object.freeze({
    ...canonicalPayload,
    canonical: canonical.canonical,
    digest: canonical.digest,
  });
}

export function intentSolverAdmissionHandoffLabel(
  handoff: IntentSolverAdmissionHandoff,
): string {
  return [
    `intent-solver:${handoff.intentId}`,
    `outcome:${handoff.outcome}`,
    `route:${handoff.routeId}`,
    `solver:${handoff.solverId}`,
  ].join(' / ');
}

export function intentSolverAdmissionDescriptor(): IntentSolverAdmissionDescriptor {
  return Object.freeze({
    version: INTENT_SOLVER_ADMISSION_HANDOFF_SPEC_VERSION,
    outcomes: INTENT_SOLVER_ADMISSION_OUTCOMES,
    actions: INTENT_SOLVER_ADMISSION_ACTIONS,
    orderKinds: INTENT_SOLVER_ORDER_KINDS,
    settlementMethods: INTENT_SOLVER_SETTLEMENT_METHODS,
    replayProtectionModes: INTENT_SOLVER_REPLAY_PROTECTION_MODES,
    expectationKinds: INTENT_SOLVER_EXPECTATION_KINDS,
    expectationStatuses: INTENT_SOLVER_EXPECTATION_STATUSES,
    runtimeChecks: Object.freeze([
      'routeCommitment',
      'settlementContract',
      'slippageLimit',
      'deadlineWindow',
      'fillInstructions',
      'liquidityPosture',
      'counterpartyScreening',
      'replayProtection',
      'postSettlementObservation',
    ]),
    standards: Object.freeze([
      'ERC-7683',
      'ResolvedCrossChainOrder',
      'IOriginSettler',
      'IDestinationSettler',
      'intent-settlement',
      'solver-preflight',
    ]),
  });
}
