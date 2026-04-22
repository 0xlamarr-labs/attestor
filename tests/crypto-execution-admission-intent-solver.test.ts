import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  createIntentSolverAdmissionHandoff,
  intentSolverAdmissionDescriptor,
  intentSolverAdmissionHandoffLabel,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import type {
  IntentSolverCounterpartyEvidence,
  IntentSolverOrderEvidence,
  IntentSolverReplayEvidence,
  IntentSolverRouteCommitmentEvidence,
  IntentSolverSettlementEvidence,
} from '../src/crypto-execution-admission/index.js';

let passed = 0;

const USER = '0x1111111111111111111111111111111111111111';
const ORIGIN_SETTLER = '0x2222222222222222222222222222222222222222';
const DESTINATION_SETTLER = '0x3333333333333333333333333333333333333333';
const SOLVER = '0x4444444444444444444444444444444444444444';
const USDC_BASE = '0x833589fcD6EDB6E08F4C7C32D4F71B54BDa02913';
const USDC_ARBITRUM = '0xaf88D065E77C8cC2239327C5EDb3A432268e5831';

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function observation(
  source: CryptoSimulationPreflightSource,
  status: CryptoSimulationObservation['status'],
): CryptoSimulationObservation {
  return {
    check: 'adapter-preflight-readiness',
    source,
    status,
    severity: status === 'fail' ? 'critical' : status === 'pass' ? 'info' : 'warning',
    code: status === 'pass' ? `${source}-ready` : `${source}-needs-review`,
    message: status === 'pass' ? `${source} preflight passed.` : `${source} needs review.`,
    required: true,
    evidence: {
      source,
      status,
    },
  };
}

function simulationFixture(input: {
  outcome?: CryptoAuthorizationSimulationResult['outcome'];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
} = {}): CryptoAuthorizationSimulationResult {
  const outcome = input.outcome ?? 'allow-preview';
  const preflightStatus = input.preflightStatus ?? 'pass';
  const adapterReady = input.adapterReady ?? preflightStatus === 'pass';
  return {
    version: 'attestor.crypto-authorization-simulation.v1',
    simulationId: 'simulation-intent-solver',
    simulatedAt: '2026-04-22T20:00:00.000Z',
    intentId: 'intent-crosschain-usdc-route',
    consequenceKind: 'bridge',
    adapterKind: 'intent-settlement',
    chainId: 'eip155:8453',
    accountAddress: USER,
    riskClass: 'R4',
    reviewAuthorityMode: 'dual-approval',
    outcome,
    confidence: outcome === 'deny-preview' ? 'high' : 'medium',
    reasonCodes: outcome === 'deny-preview' ? ['blocked-by-simulation'] : [],
    readiness: {
      releaseBinding: 'ready',
      policyBinding: 'ready',
      enforcementBinding: 'ready',
      adapterPreflight: adapterReady
        ? 'ready'
        : preflightStatus === 'fail'
          ? 'blocked'
          : 'missing',
    },
    requiredPreflightSources: ['intent-settlement'],
    recommendedPreflightSources: [],
    observations: [observation('intent-settlement', preflightStatus)],
    requiredNextArtifacts: adapterReady ? [] : ['missing-intent-settlement-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:intent-${outcome}-${preflightStatus}`,
  };
}

function planFixture(input: {
  outcome?: CryptoAuthorizationSimulationResult['outcome'];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
} = {}) {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture(input),
    createdAt: '2026-04-22T20:01:00.000Z',
    integrationRef: 'integration:intent-solver:erc7683',
  });
}

function order(overrides: Partial<IntentSolverOrderEvidence> = {}): IntentSolverOrderEvidence {
  return {
    orderKind: 'erc-7683-gasless',
    orderId: `0x${'ab'.repeat(32)}`,
    user: USER,
    originChainId: 'eip155:8453',
    originSettler: ORIGIN_SETTLER,
    orderDataType: `0x${'12'.repeat(32)}`,
    orderDataHash: `sha256:${'34'.repeat(32)}`,
    openDeadline: '2026-04-22T20:40:00.000Z',
    fillDeadline: '2026-04-22T21:00:00.000Z',
    nonce: 'intent-nonce-001',
    signatureHash: `sha256:${'56'.repeat(32)}`,
    resolvedOrderHash: `sha256:${'78'.repeat(32)}`,
    maxSpentHash: `sha256:${'9a'.repeat(32)}`,
    minReceivedHash: `sha256:${'bc'.repeat(32)}`,
    ...overrides,
  };
}

function route(
  overrides: Partial<IntentSolverRouteCommitmentEvidence> = {},
): IntentSolverRouteCommitmentEvidence {
  return {
    routeId: 'route-base-to-arbitrum-usdc',
    routeHash: `sha256:${'de'.repeat(32)}`,
    quoteId: 'quote-crosschain-usdc-001',
    quoteExpiresAt: '2026-04-22T20:30:00.000Z',
    committedAt: '2026-04-22T20:02:00.000Z',
    solverId: 'solver-across-style-001',
    solverAddress: SOLVER,
    originChainId: 'eip155:8453',
    destinationChainIds: ['eip155:42161'],
    inputToken: USDC_BASE,
    inputAmount: '100000000',
    outputToken: USDC_ARBITRUM,
    quotedOutputAmount: '99700000',
    minOutputAmount: '99500000',
    slippageBps: 50,
    maxSlippageBps: 75,
    fillInstructions: [
      {
        instructionId: 'fill-arbitrum-usdc',
        destinationChainId: 'eip155:42161',
        destinationSettler: DESTINATION_SETTLER,
        originDataHash: `sha256:${'ef'.repeat(32)}`,
      },
    ],
    exclusiveSolverId: null,
    exclusivityDeadline: null,
    counterpartyRefs: ['counterparty:across-style-relayer'],
    routeSimulationHash: `sha256:${'01'.repeat(32)}`,
    ...overrides,
  };
}

function settlement(
  overrides: Partial<IntentSolverSettlementEvidence> = {},
): IntentSolverSettlementEvidence {
  return {
    settlementSystem: 'erc7683-compatible-settlement',
    settlementMethod: 'erc-7683-open-for',
    originSettler: ORIGIN_SETTLER,
    destinationSettlers: [DESTINATION_SETTLER],
    settlementContractVerified: true,
    settlementSecurityReviewed: true,
    settlementWindowSeconds: 3600,
    fillDeadline: '2026-04-22T21:00:00.000Z',
    refundPathAvailable: true,
    settlementOracle: 'settlement-oracle:chainproof',
    liquiditySource: 'solver-liquidity-pool:usdc-arbitrum',
    ...overrides,
  };
}

function counterparty(
  overrides: Partial<IntentSolverCounterpartyEvidence> = {},
): IntentSolverCounterpartyEvidence {
  return {
    solverId: 'solver-across-style-001',
    solverAddress: SOLVER,
    allowlisted: true,
    blocked: false,
    screeningStatus: 'clear',
    reputationTier: 'institutional',
    bondPosted: true,
    requiredBondSatisfied: true,
    blockedCounterpartyRefs: [],
    ...overrides,
  };
}

function replay(overrides: Partial<IntentSolverReplayEvidence> = {}): IntentSolverReplayEvidence {
  return {
    replayProtectionMode: 'erc-7683-nonce',
    nonce: 'intent-nonce-001',
    nonceFresh: true,
    idempotencyKey: 'idem-intent-route-001',
    orderAlreadyOpened: false,
    duplicateOrderDetected: false,
    routeReplayDetected: false,
    ...overrides,
  };
}

function readyHandoff() {
  return createIntentSolverAdmissionHandoff({
    plan: planFixture(),
    order: order(),
    route: route(),
    settlement: settlement(),
    counterparty: counterparty(),
    replay: replay(),
    createdAt: '2026-04-22T20:03:00.000Z',
  });
}

const ready = readyHandoff();
equal(ready.outcome, 'ready', 'ready solver route can be submitted');
equal(ready.action, 'submit-order', 'ready route submits the intent order');
equal(ready.submitContract.settlementMethod, 'erc-7683-open-for', 'settlement method is bound');
equal(ready.submitContract.requiresFillInstructionBinding, true, 'fill binding is required');
equal(ready.settlementWindow.fillDeadline, '2026-04-22T21:00:00.000Z', 'fill deadline is normalized');
equal(ready.slippage.maxSlippageBps, 75, 'max slippage is retained');
equal(ready.attestorSidecar.attestorPlanDigest, ready.planDigest, 'sidecar binds the plan digest');
ok(ready.digest.startsWith('sha256:'), 'handoff has a canonical digest');
ok(
  ready.expectations.every((entry) =>
    entry.kind === 'post-settlement' ? entry.status === 'pending' : entry.status === 'satisfied',
  ),
  'all pre-submit expectations are satisfied while post-settlement remains pending',
);

const missingRouteEvidence = createIntentSolverAdmissionHandoff({
  plan: planFixture(),
  order: order({ resolvedOrderHash: null }),
  route: route({ routeSimulationHash: null }),
  settlement: settlement(),
  counterparty: counterparty(),
  replay: replay(),
  createdAt: '2026-04-22T20:03:00.000Z',
});
equal(
  missingRouteEvidence.outcome,
  'needs-solver-evidence',
  'missing resolved order and route simulation require solver evidence',
);
ok(
  missingRouteEvidence.nextActions.includes('solver-route-commitment-missing'),
  'missing route commitment is a next action',
);
ok(
  missingRouteEvidence.nextActions.includes('solver-fill-instructions-incomplete'),
  'missing resolved order is a next action',
);

const staleDeadline = createIntentSolverAdmissionHandoff({
  plan: planFixture(),
  order: order({ openDeadline: '2026-04-22T20:00:00.000Z' }),
  route: route(),
  settlement: settlement(),
  counterparty: counterparty(),
  replay: replay(),
  createdAt: '2026-04-22T20:03:00.000Z',
});
equal(staleDeadline.outcome, 'blocked', 'stale open deadline blocks route admission');
ok(
  staleDeadline.blockingReasons.includes('solver-deadline-window-invalid'),
  'deadline failure is recorded',
);

const badSlippage = createIntentSolverAdmissionHandoff({
  plan: planFixture(),
  order: order(),
  route: route({ slippageBps: 120, maxSlippageBps: 75 }),
  settlement: settlement(),
  counterparty: counterparty(),
  replay: replay(),
  createdAt: '2026-04-22T20:03:00.000Z',
});
equal(badSlippage.outcome, 'blocked', 'excess slippage blocks route admission');
ok(
  badSlippage.blockingReasons.includes('solver-slippage-out-of-bound'),
  'slippage failure is recorded',
);

const blockedCounterparty = createIntentSolverAdmissionHandoff({
  plan: planFixture(),
  order: order(),
  route: route(),
  settlement: settlement(),
  counterparty: counterparty({
    blocked: true,
    screeningStatus: 'blocked',
    blockedCounterpartyRefs: ['counterparty:across-style-relayer'],
  }),
  replay: replay(),
  createdAt: '2026-04-22T20:03:00.000Z',
});
equal(blockedCounterparty.outcome, 'blocked', 'blocked solver counterparty blocks admission');
ok(
  blockedCounterparty.blockingReasons.includes('solver-counterparty-blocked'),
  'counterparty block is recorded',
);

const duplicateReplay = createIntentSolverAdmissionHandoff({
  plan: planFixture(),
  order: order(),
  route: route(),
  settlement: settlement(),
  counterparty: counterparty(),
  replay: replay({ duplicateOrderDetected: true }),
  createdAt: '2026-04-22T20:03:00.000Z',
});
equal(duplicateReplay.outcome, 'blocked', 'duplicate order blocks route admission');
ok(
  duplicateReplay.blockingReasons.includes('solver-replay-risk-detected'),
  'replay failure is recorded',
);

const pendingSettlementSecurity = createIntentSolverAdmissionHandoff({
  plan: planFixture(),
  order: order(),
  route: route(),
  settlement: settlement({ settlementSecurityReviewed: false }),
  counterparty: counterparty(),
  replay: replay(),
  createdAt: '2026-04-22T20:03:00.000Z',
});
equal(
  pendingSettlementSecurity.outcome,
  'needs-solver-evidence',
  'pending settlement review does not submit the route',
);
ok(
  pendingSettlementSecurity.nextActions.includes('settlement-contract-review-pending'),
  'pending settlement review is a next action',
);

const deniedPlan = createIntentSolverAdmissionHandoff({
  plan: planFixture({ outcome: 'deny-preview', preflightStatus: 'fail', adapterReady: false }),
  order: order(),
  route: route(),
  settlement: settlement(),
  counterparty: counterparty(),
  replay: replay(),
  createdAt: '2026-04-22T20:03:00.000Z',
});
equal(deniedPlan.outcome, 'blocked', 'denied Attestor plan blocks solver handoff');
ok(
  deniedPlan.blockingReasons.includes('intent-solver-plan-denied'),
  'plan denial is recorded',
);

const observed = createIntentSolverAdmissionHandoff({
  plan: planFixture(),
  order: order(),
  route: route(),
  settlement: settlement(),
  counterparty: counterparty(),
  replay: replay(),
  createdAt: '2026-04-22T20:03:00.000Z',
  runtimeObservation: {
    observedAt: '2026-04-22T20:50:00.000Z',
    orderSubmitted: true,
    openTransactionHash: `0x${'aa'.repeat(32)}`,
    fillTransactionHashes: [`0x${'bb'.repeat(32)}`],
    settlementCompleted: true,
    replayBlocked: false,
  },
});
equal(observed.outcome, 'ready', 'completed settlement observation keeps ready posture');
ok(
  observed.expectations.some(
    (entry) => entry.kind === 'post-settlement' && entry.status === 'satisfied',
  ),
  'post-settlement observation is recorded when present',
);

const descriptor = intentSolverAdmissionDescriptor();
ok(descriptor.standards.includes('ERC-7683'), 'descriptor names ERC-7683');
ok(
  descriptor.runtimeChecks.includes('replayProtection'),
  'descriptor names replay protection runtime check',
);
ok(
  intentSolverAdmissionHandoffLabel(ready).includes('intent-solver:intent-crosschain-usdc-route'),
  'label includes intent id',
);

console.log(`crypto-execution-admission-intent-solver: ${passed} assertions passed`);
