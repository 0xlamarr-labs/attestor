import assert from 'node:assert/strict';
import {
  createCryptoExecutionAdmissionPlan,
  createCustodyPolicyAdmissionCallbackContract,
  custodyPolicyAdmissionCallbackDescriptor,
  custodyPolicyAdmissionCallbackLabel,
} from '../src/crypto-execution-admission/index.js';
import type {
  CryptoAuthorizationSimulationResult,
  CryptoSimulationObservation,
  CryptoSimulationPreflightSource,
} from '../src/crypto-authorization-core/authorization-simulation.js';
import type {
  CustodyAccountEvidence,
  CustodyApprovalEvidence,
  CustodyCosignerCallbackEvidence,
  CustodyCosignerPolicyPreflight,
  CustodyKeyPostureEvidence,
  CustodyPolicyConditionsEvidence,
  CustodyPolicyDecisionEvidence,
  CustodyPostExecutionEvidence,
  CustodyScreeningEvidence,
  CustodyTransactionEvidence,
} from '../src/crypto-authorization-core/custody-cosigner-policy-adapter.js';

let passed = 0;

const SOURCE_ADDRESS = '0x1111111111111111111111111111111111111111';
const DESTINATION_ADDRESS = '0x2222222222222222222222222222222222222222';
const USDC_MAINNET = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const REQUEST_HASH = `0x${'aa'.repeat(32)}`;
const BODY_HASH = `sha256:${'bb'.repeat(32)}`;
const SIGNATURE_HASH = `sha256:${'cc'.repeat(32)}`;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
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
    simulationId: 'simulation-custody-callback',
    simulatedAt: '2026-04-22T18:00:00.000Z',
    intentId: 'intent-custody-withdrawal',
    consequenceKind: 'custody-withdrawal',
    adapterKind: 'custody-cosigner',
    chainId: 'eip155:1',
    accountAddress: SOURCE_ADDRESS,
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
    requiredPreflightSources: ['custody-policy'],
    recommendedPreflightSources: [],
    observations: [observation('custody-policy', preflightStatus)],
    requiredNextArtifacts: adapterReady ? [] : ['missing-custody-policy-evidence'],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    operatorNote: null,
    canonical: '{}',
    digest: `sha256:custody-${outcome}-${preflightStatus}`,
  };
}

function planFixture(input: {
  outcome?: CryptoAuthorizationSimulationResult['outcome'];
  preflightStatus?: CryptoSimulationObservation['status'];
  adapterReady?: boolean;
} = {}) {
  return createCryptoExecutionAdmissionPlan({
    simulation: simulationFixture(input),
    createdAt: '2026-04-22T18:01:00.000Z',
    integrationRef: 'integration:custody:cosigner',
  });
}

function account(overrides: Partial<CustodyAccountEvidence> = {}): CustodyAccountEvidence {
  return {
    provider: 'fireblocks',
    organizationId: 'org-fireblocks-attestor',
    workspaceId: 'workspace-treasury',
    vaultId: 'vault-treasury-hot',
    walletId: 'wallet-eth-mainnet',
    accountId: 'account-usdc-mainnet',
    accountRef: 'fireblocks:vault:treasury-hot:usdc-mainnet',
    chain: 'eip155:1',
    asset: USDC_MAINNET,
    sourceAddress: SOURCE_ADDRESS,
    policyEngineEnabled: true,
    custodyAccountKind: 'vault-account',
    ...overrides,
  };
}

function transaction(
  overrides: Partial<CustodyTransactionEvidence> = {},
): CustodyTransactionEvidence {
  return {
    requestId: 'custody-transfer-request-001',
    idempotencyKey: 'idem-custody-transfer-001',
    idempotencyFresh: true,
    duplicateRequestDetected: false,
    requestHash: REQUEST_HASH,
    operation: 'transfer',
    chain: 'eip155:1',
    asset: USDC_MAINNET,
    amount: '2500000000',
    sourceAccountRef: 'fireblocks:vault:treasury-hot:usdc-mainnet',
    sourceAddress: SOURCE_ADDRESS,
    destinationAddress: DESTINATION_ADDRESS,
    destinationRef: 'custody-destination:rwa-settlement-001',
    destinationMemo: 'rwa-settlement-2026-04-22',
    targetId: 'custody-destination:rwa-settlement-001',
    requestedAt: '2026-04-22T18:02:00.000Z',
    simulationPassed: true,
    ...overrides,
  };
}

function conditions(
  overrides: Partial<CustodyPolicyConditionsEvidence> = {},
): CustodyPolicyConditionsEvidence {
  return {
    chainBound: true,
    accountBound: true,
    assetBound: true,
    destinationBound: true,
    amountBound: true,
    operationBound: true,
    budgetBound: true,
    velocityBound: true,
    attestorReceiptRequired: true,
    attestorReceiptMatched: true,
    ...overrides,
  };
}

function policyDecision(
  overrides: Partial<CustodyPolicyDecisionEvidence> = {},
): CustodyPolicyDecisionEvidence {
  return {
    provider: 'fireblocks',
    decisionId: 'custody-policy-decision-001',
    policyId: 'custody-policy-rwa-settlement',
    policyVersion: '2026-04-22.1',
    policyHash: 'sha256:policyhash001',
    activePolicyHash: 'sha256:policyhash001',
    ruleId: 'rule-approved-rwa-settlement',
    effect: 'allow',
    status: 'approved',
    matched: true,
    explicitDeny: false,
    implicitDeny: false,
    evaluatedAt: '2026-04-22T18:02:05.000Z',
    environment: 'prod-crypto',
    tenantId: 'tenant-crypto',
    policyActivated: true,
    conditions: conditions(),
    ...overrides,
  };
}

function approvals(overrides: Partial<CustodyApprovalEvidence> = {}): CustodyApprovalEvidence {
  return {
    requiredApprovals: 2,
    collectedApprovals: 2,
    quorumSatisfied: true,
    approverIds: ['ops-approver-a', 'risk-approver-b'],
    requiredRoles: ['treasury-ops', 'risk'],
    collectedRoles: ['treasury-ops', 'risk'],
    requesterId: 'treasury-service:rwa-settlement',
    requesterApproved: false,
    dutySeparationSatisfied: true,
    policyAdminApprovedOwnChange: false,
    breakGlassUsed: false,
    breakGlassAuthorized: false,
    ...overrides,
  };
}

function callback(
  overrides: Partial<CustodyCosignerCallbackEvidence> = {},
): CustodyCosignerCallbackEvidence {
  return {
    callbackId: 'cosigner-callback-001',
    configured: true,
    authenticated: true,
    authMethod: 'jwt-public-key',
    signatureValid: true,
    tlsPinned: true,
    senderConstrained: true,
    sourceIpAllowlisted: true,
    timestamp: '2026-04-22T18:02:06.000Z',
    nonce: 'callback-nonce-001',
    nonceFresh: true,
    bodyHash: BODY_HASH,
    bodyHashMatches: true,
    responseAction: 'approve',
    responseSigned: true,
    responseWithinSeconds: 5,
    attestorReleaseTokenVerified: true,
    ...overrides,
  };
}

function screening(overrides: Partial<CustodyScreeningEvidence> = {}): CustodyScreeningEvidence {
  return {
    destinationAllowlisted: true,
    counterpartyKnown: true,
    sanctionsScreened: true,
    sanctionsHit: false,
    riskScore: 12,
    riskScoreMax: 50,
    riskTierAllowed: true,
    travelRuleRequired: true,
    travelRuleCompleted: true,
    velocityLimitChecked: true,
    velocityLimitRemainingAtomic: '10000000000',
    maxAmountAtomic: '5000000000',
    ...overrides,
  };
}

function keyPosture(
  overrides: Partial<CustodyKeyPostureEvidence> = {},
): CustodyKeyPostureEvidence {
  return {
    keyId: 'mpc-key-mainnet-usdc-001',
    keyType: 'mpc',
    cosignerId: 'cosigner-attestor-prod-001',
    cosignerPaired: true,
    cosignerHealthy: true,
    enclaveBacked: true,
    keyShareHealthy: true,
    signingPolicyBound: true,
    keyExportable: false,
    signerRoleBound: true,
    haSignerAvailable: true,
    recoveryReady: true,
    ...overrides,
  };
}

function postExecution(
  overrides: Partial<CustodyPostExecutionEvidence> = {},
): CustodyPostExecutionEvidence {
  return {
    activityId: 'custody-activity-001',
    status: 'signed',
    signatureHash: SIGNATURE_HASH,
    transactionHash: null,
    providerStatus: 'SIGNED',
    failureReason: null,
    ...overrides,
  };
}

function preflight(
  overrides: Partial<CustodyCosignerPolicyPreflight> = {},
): CustodyCosignerPolicyPreflight {
  return {
    version: 'attestor.crypto-custody-cosigner-policy-adapter.v1',
    preflightId: 'preflight-custody-callback',
    adapterKind: 'custody-cosigner',
    checkedAt: '2026-04-22T18:02:05.000Z',
    provider: 'fireblocks',
    organizationId: 'org-fireblocks-attestor',
    accountRef: 'fireblocks:vault:treasury-hot:usdc-mainnet',
    requestId: 'custody-transfer-request-001',
    idempotencyKey: 'idem-custody-transfer-001',
    chain: 'eip155:1',
    asset: USDC_MAINNET,
    amount: '2500000000',
    destinationAddress: DESTINATION_ADDRESS,
    policyId: 'custody-policy-rwa-settlement',
    policyVersion: '2026-04-22.1',
    policyDecisionId: 'custody-policy-decision-001',
    approvalQuorum: '2/2',
    keyId: 'mpc-key-mainnet-usdc-001',
    callbackId: 'cosigner-callback-001',
    outcome: 'allow',
    signal: {
      source: 'custody-policy',
      status: 'pass',
      code: 'custody-cosigner-policy-adapter-allow',
      message: 'Custody preflight passed.',
      required: true,
      evidence: {
        requestId: 'custody-transfer-request-001',
      },
    },
    observations: [],
    releaseBindingDigest: 'sha256:release',
    policyScopeDigest: 'sha256:policy',
    enforcementBindingDigest: 'sha256:enforcement',
    canonical: '{}',
    digest: 'sha256:custody-preflight',
    ...overrides,
  };
}

function contract(
  overrides: Partial<Parameters<typeof createCustodyPolicyAdmissionCallbackContract>[0]> = {},
) {
  return createCustodyPolicyAdmissionCallbackContract({
    plan: planFixture(),
    preflight: preflight(),
    account: account(),
    transaction: transaction(),
    policyDecision: policyDecision(),
    approvals: approvals(),
    callback: callback(),
    screening: screening(),
    keyPosture: keyPosture(),
    postExecution: postExecution(),
    createdAt: '2026-04-22T18:03:00.000Z',
    callbackUrl: 'https://cosigner.attestor.example/fireblocks/callback',
    ...overrides,
  });
}

function testReadyApproveContract(): void {
  const ready = contract();

  equal(ready.outcome, 'allow', 'custody callback: full evidence allows provider approval');
  equal(ready.action, 'approve-request', 'custody callback: allow maps to approve action');
  equal(
    ready.providerResponse.responseDeadlineSeconds,
    30,
    'custody callback: Fireblocks profile carries 30-second response deadline',
  );
  equal(
    ready.providerResponse.protocol,
    'jwt-signed-json',
    'custody callback: JWT public-key auth maps to signed JSON response',
  );
  equal(
    ready.providerResponse.signedResponseRequired,
    true,
    'custody callback: JWT response must be signed',
  );
  ok(
    ready.expectations.every((entry) => entry.status === 'satisfied'),
    'custody callback: all happy-path expectations are satisfied',
  );
  ok(ready.digest.startsWith('sha256:'), 'custody callback: contract has canonical digest');
}

function testTlsPinnedJsonCanAllowWithoutSignedResponse(): void {
  const tlsContract = contract({
    callback: callback({
      authMethod: 'tls-certificate-pinning',
      signatureValid: false,
      responseSigned: false,
      tlsPinned: true,
    }),
  });

  equal(
    tlsContract.outcome,
    'allow',
    'custody callback: TLS-pinned callback can allow without JWT response signing',
  );
  equal(
    tlsContract.providerResponse.protocol,
    'tls-pinned-json',
    'custody callback: TLS certificate pinning maps to pinned JSON protocol',
  );
  equal(
    tlsContract.providerResponse.signedResponseRequired,
    false,
    'custody callback: TLS-pinned JSON does not require a signed response',
  );
}

function testPendingReviewContract(): void {
  const pending = contract({
    plan: planFixture({
      preflightStatus: 'warn',
      adapterReady: false,
    }),
    preflight: preflight({
      outcome: 'review-required',
      signal: {
        source: 'custody-policy',
        status: 'warn',
        code: 'custody-cosigner-policy-adapter-review-required',
        message: 'Custody review is required.',
        required: true,
        evidence: {
          requestId: 'custody-transfer-request-001',
        },
      },
    }),
    policyDecision: policyDecision({
      effect: 'review-required',
      status: 'pending',
    }),
    approvals: approvals({
      collectedApprovals: 1,
      quorumSatisfied: false,
      approverIds: ['ops-approver-a'],
      collectedRoles: ['treasury-ops'],
    }),
    callback: callback({
      responseAction: 'pending-review',
    }),
  });

  equal(
    pending.outcome,
    'needs-review',
    'custody callback: pending policy/quorum maps to needs-review',
  );
  equal(
    pending.action,
    'queue-review',
    'custody callback: needs-review queues custody review',
  );
  equal(
    pending.providerResponse.normalizedCallbackAction,
    'pending-review',
    'custody callback: provider response remains a pending-review action',
  );
}

function testMissingCallbackFailsClosed(): void {
  const denied = contract({
    callback: callback({
      configured: false,
    }),
  });

  equal(
    denied.outcome,
    'deny',
    'custody callback: missing callback fails closed',
  );
  equal(
    denied.action,
    'reject-request',
    'custody callback: missing callback rejects request',
  );
  ok(
    denied.blockingReasons.includes('custody-callback-not-configured'),
    'custody callback: missing callback reason is preserved',
  );
}

function testRetryMapsToReviewWithoutApproval(): void {
  const retry = contract({
    callback: callback({
      responseAction: 'retry',
    }),
  });

  equal(
    retry.outcome,
    'needs-review',
    'custody callback: retry never auto-approves custody signing',
  );
  equal(
    retry.providerResponse.normalizedCallbackAction,
    'pending-review',
    'custody callback: retry normalizes to pending review',
  );
  ok(
    retry.nextActions.some((entry) => entry.includes('Do not approve')),
    'custody callback: retry next action blocks approval',
  );
}

function testScreeningBlocksContract(): void {
  const denied = contract({
    screening: screening({
      sanctionsHit: true,
      riskScore: 95,
    }),
  });

  equal(
    denied.outcome,
    'deny',
    'custody callback: sanctions or risk hit denies callback admission',
  );
  ok(
    denied.blockingReasons.includes('custody-screening-risk-blocked'),
    'custody callback: screening reason is preserved',
  );
}

function testDescriptorAndLabel(): void {
  const descriptor = custodyPolicyAdmissionCallbackDescriptor();
  const ready = contract();

  equal(
    descriptor.version,
    'attestor.crypto-custody-policy-admission-callback.v1',
    'custody callback: descriptor exposes version',
  );
  deepEqual(
    descriptor.outcomes,
    ['allow', 'needs-review', 'deny'],
    'custody callback: descriptor exposes normalized outcomes',
  );
  ok(
    descriptor.runtimeChecks.includes('callbackAuthentication'),
    'custody callback: descriptor names callback authentication check',
  );
  ok(
    descriptor.standards.includes('Fireblocks API co-signer callback'),
    'custody callback: descriptor cites Fireblocks callback integration',
  );
  ok(
    custodyPolicyAdmissionCallbackLabel(ready).includes('outcome:allow'),
    'custody callback: label includes outcome',
  );
}

testReadyApproveContract();
testTlsPinnedJsonCanAllowWithoutSignedResponse();
testPendingReviewContract();
testMissingCallbackFailsClosed();
testRetryMapsToReviewWithoutApproval();
testScreeningBlocksContract();
testDescriptorAndLabel();

console.log(`crypto-execution-admission-custody-policy-callback: ${passed} assertions passed`);
