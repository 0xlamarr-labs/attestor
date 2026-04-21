import { strict as assert } from 'node:assert';
import {
  CRYPTO_AUTHORIZATION_ACTOR_KINDS,
  CRYPTO_AUTHORIZATION_DECISION_STATUSES,
  CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
  CRYPTO_AUTHORIZATION_DIGEST_MODES,
  CRYPTO_AUTHORIZATION_OBJECT_KINDS,
  CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION,
  CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
  CRYPTO_EXECUTION_TARGET_KINDS,
  CRYPTO_REPLAY_PROTECTION_MODES,
  CRYPTO_SIGNATURE_VALIDATION_MODES,
  CRYPTO_SIGNER_AUTHORITY_KINDS,
  createCryptoAuthorizationActor,
  createCryptoAuthorizationConstraints,
  createCryptoAuthorizationDecision,
  createCryptoAuthorizationIntent,
  createCryptoAuthorizationPolicyScope,
  createCryptoAuthorizationReceipt,
  createCryptoExecutionProjection,
  createCryptoExecutionTarget,
  createCryptoSignerAuthority,
  cryptoAuthorizationDecisionLabel,
  cryptoAuthorizationIntentLabel,
  cryptoAuthorizationObjectModelDescriptor,
  isCryptoAuthorizationActorKind,
  isCryptoAuthorizationDecisionStatus,
  isCryptoAuthorizationDigestMode,
  isCryptoAuthorizationObjectKind,
  isCryptoExecutionTargetKind,
  isCryptoReplayProtectionMode,
  isCryptoSignatureValidationMode,
  isCryptoSignerAuthorityKind,
} from '../src/crypto-authorization-core/object-model.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

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

function fixtureChain() {
  return createCryptoChainReference({
    namespace: 'eip155',
    chainId: '1',
  });
}

function fixtureIntent() {
  const chain = fixtureChain();
  const account = createCryptoAccountReference({
    accountKind: 'erc-4337-smart-account',
    chain,
    address: '0x1111111111111111111111111111111111111111',
  });
  const asset = createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain,
    assetId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    decimals: 6,
  });
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:treasury-rebalancer',
    authorityRef: 'attestor-authority:agent-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'contract',
    chain,
    targetId: 'uniswap-v4-router',
    address: '0x2222222222222222222222222222222222222222',
    protocol: 'uniswap',
    functionSelector: '0x3593564c',
    calldataClass: 'bounded-swap',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: ['chain', 'account', 'actor', 'budget', 'runtime-context'],
    environment: 'prod',
    tenantId: 'tenant-finance',
    accountId: 'acct-treasury',
    policyPackRef: 'policy-pack:crypto-core-v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T08:00:00.000Z',
    validUntil: '2026-04-21T08:05:00.000Z',
    nonce: 'userop:7:42',
    replayProtectionMode: 'user-operation-nonce',
    digestMode: 'user-operation-hash',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    budgetId: 'budget:daily-agent',
  });

  return createCryptoAuthorizationIntent({
    intentId: 'intent-userop-001',
    requestedAt: '2026-04-21T08:00:01.000Z',
    requester,
    account,
    consequenceKind: 'user-operation',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind: 'erc-4337-user-operation',
    evidenceRefs: ['release:evidence:001'],
  });
}

function fixtureSigner() {
  return createCryptoSignerAuthority({
    authorityKind: 'smart-account',
    authorityId: 'smart-account:treasury',
    validationMode: 'erc-1271-contract',
    address: '0x1111111111111111111111111111111111111111',
  });
}

function testDescriptorVocabulary(): void {
  const descriptor = cryptoAuthorizationObjectModelDescriptor();

  equal(
    descriptor.version,
    CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION,
    'Crypto authorization object model: descriptor exposes version',
  );
  deepEqual(descriptor.objectKinds, CRYPTO_AUTHORIZATION_OBJECT_KINDS, 'Crypto authorization object model: descriptor exposes object kinds');
  deepEqual(descriptor.actorKinds, CRYPTO_AUTHORIZATION_ACTOR_KINDS, 'Crypto authorization object model: descriptor exposes actor kinds');
  deepEqual(descriptor.executionTargetKinds, CRYPTO_EXECUTION_TARGET_KINDS, 'Crypto authorization object model: descriptor exposes execution target kinds');
  deepEqual(descriptor.decisionStatuses, CRYPTO_AUTHORIZATION_DECISION_STATUSES, 'Crypto authorization object model: descriptor exposes decision statuses');
  deepEqual(descriptor.signerAuthorityKinds, CRYPTO_SIGNER_AUTHORITY_KINDS, 'Crypto authorization object model: descriptor exposes signer authority kinds');
  deepEqual(descriptor.signatureValidationModes, CRYPTO_SIGNATURE_VALIDATION_MODES, 'Crypto authorization object model: descriptor exposes signature validation modes');
  deepEqual(descriptor.replayProtectionModes, CRYPTO_REPLAY_PROTECTION_MODES, 'Crypto authorization object model: descriptor exposes replay protection modes');
  deepEqual(descriptor.digestModes, CRYPTO_AUTHORIZATION_DIGEST_MODES, 'Crypto authorization object model: descriptor exposes digest modes');
}

function testPredicateVocabulary(): void {
  ok(isCryptoAuthorizationObjectKind('authorization-intent'), 'Crypto authorization object model: intent is an object kind');
  ok(isCryptoAuthorizationActorKind('agent'), 'Crypto authorization object model: agent is an actor kind');
  ok(isCryptoExecutionTargetKind('intent-solver'), 'Crypto authorization object model: intent solver is a target kind');
  ok(isCryptoAuthorizationDecisionStatus('review-required'), 'Crypto authorization object model: review-required is a decision status');
  ok(isCryptoSignerAuthorityKind('custody-policy-engine'), 'Crypto authorization object model: custody policy engine is a signer authority');
  ok(isCryptoSignatureValidationMode('eip-712-eoa'), 'Crypto authorization object model: EIP-712 EOA validation is supported');
  ok(isCryptoSignatureValidationMode('erc-1271-contract'), 'Crypto authorization object model: ERC-1271 validation is supported');
  ok(isCryptoReplayProtectionMode('authorization-list-nonce'), 'Crypto authorization object model: authorization-list nonce is supported');
  ok(isCryptoAuthorizationDigestMode('wallet-call-batch-hash'), 'Crypto authorization object model: wallet-call batch hashes are supported');
  ok(!isCryptoExecutionTargetKind('finance-record'), 'Crypto authorization object model: finance record is not a crypto execution target');
}

function testActorTargetScopeAndConstraintFactories(): void {
  const chain = fixtureChain();
  const actor = createCryptoAuthorizationActor({
    actorKind: 'human',
    actorId: ' alice ',
    authorityRef: ' reviewer:alice ',
  });

  equal(actor.actorId, 'alice', 'Crypto authorization object model: actor id is normalized');
  equal(actor.authorityRef, 'reviewer:alice', 'Crypto authorization object model: actor authority is normalized');

  const target = createCryptoExecutionTarget({
    targetKind: 'payee',
    chain,
    targetId: ' payroll-vendor ',
    address: ' 0x3333333333333333333333333333333333333333 ',
    counterparty: ' vendor:acme ',
  });

  equal(target.targetId, 'payroll-vendor', 'Crypto authorization object model: target id is normalized');
  equal(target.address, '0x3333333333333333333333333333333333333333', 'Crypto authorization object model: target address is normalized');
  equal(target.counterparty, 'vendor:acme', 'Crypto authorization object model: counterparty is normalized');

  const scope = createCryptoAuthorizationPolicyScope({
    dimensions: ['chain', 'account', 'account', 'asset', 'amount'],
    environment: ' prod ',
    tenantId: ' tenant-1 ',
  });

  deepEqual(scope.dimensions, ['chain', 'account', 'asset', 'amount'], 'Crypto authorization object model: policy dimensions are deduplicated in order');
  equal(scope.environment, 'prod', 'Crypto authorization object model: environment is normalized');
  equal(scope.tenantId, 'tenant-1', 'Crypto authorization object model: tenant id is normalized');

  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T08:00:00.000Z',
    validUntil: '2026-04-21T08:10:00.000Z',
    nonce: ' nonce-1 ',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
    maxAmount: ' 1000.00 ',
    cadence: ' per-day ',
  });

  equal(constraints.nonce, 'nonce-1', 'Crypto authorization object model: nonce is normalized');
  equal(constraints.maxAmount, '1000.00', 'Crypto authorization object model: max amount is normalized');
  equal(constraints.cadence, 'per-day', 'Crypto authorization object model: cadence is normalized');
  deepEqual(
    constraints.requiredArtifacts,
    ['attestor-release-receipt', 'eip-712-authorization'],
    'Crypto authorization object model: default EIP-712 artifact set is preserved',
  );
}

function testIntentDecisionReceiptAndProjection(): void {
  const intent = fixtureIntent();

  equal(intent.objectKind, 'authorization-intent', 'Crypto authorization object model: intent object kind is stable');
  equal(intent.version, CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION, 'Crypto authorization object model: intent carries version');
  equal(intent.chain.chainId, '1', 'Crypto authorization object model: intent chain comes from account');
  equal(intent.asset?.symbol, 'USDC', 'Crypto authorization object model: intent can bind an asset');
  equal(intent.executionAdapterKind, 'erc-4337-user-operation', 'Crypto authorization object model: intent can name an adapter without becoming adapter-specific');
  equal(
    cryptoAuthorizationIntentLabel(intent),
    'intent:intent-userop-001 / consequence:user-operation / chain:eip155:1 / account:erc-4337-smart-account / target:contract:uniswap-v4-router / nonce:userop:7:42',
    'Crypto authorization object model: intent label carries execution-critical dimensions',
  );

  const signer = fixtureSigner();
  const decision = createCryptoAuthorizationDecision({
    decisionId: 'decision-userop-001',
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: 'allow',
    releaseDecisionId: 'release-decision-001',
    reasonCodes: ['policy-allow', 'budget-ok'],
    signerAuthorities: [signer],
  });

  equal(decision.objectKind, 'authorization-decision', 'Crypto authorization object model: decision object kind is stable');
  equal(decision.intentId, intent.intentId, 'Crypto authorization object model: decision binds to intent id');
  equal(decision.riskClass, 'R3', 'Crypto authorization object model: user-operation default risk is projected');
  deepEqual(decision.requiredArtifacts, CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS, 'Crypto authorization object model: decision inherits required artifacts');
  equal(decision.nonce, 'userop:7:42', 'Crypto authorization object model: decision inherits nonce');
  equal(
    cryptoAuthorizationDecisionLabel(decision),
    'decision:decision-userop-001 / intent:intent-userop-001 / status:allow / risk:R3 / nonce:userop:7:42',
    'Crypto authorization object model: decision label carries status, risk, and nonce',
  );

  const receipt = createCryptoAuthorizationReceipt({
    receiptId: 'receipt-userop-001',
    decision,
    issuedAt: '2026-04-21T08:00:03.000Z',
    artifactKind: 'erc-1271-validation',
    digestMode: 'user-operation-hash',
    authorizationDigest: 'sha256:userop',
    evidenceDigest: 'sha256:evidence',
    signerAuthority: signer,
  });

  equal(receipt.objectKind, 'authorization-receipt', 'Crypto authorization object model: receipt object kind is stable');
  equal(receipt.decisionId, decision.decisionId, 'Crypto authorization object model: receipt binds to decision');
  equal(receipt.signatureValidationMode, 'erc-1271-contract', 'Crypto authorization object model: receipt inherits signer validation mode');

  const projection = createCryptoExecutionProjection({
    projectionId: 'projection-userop-001',
    receipt,
    adapterKind: 'erc-4337-user-operation',
    target: intent.target,
    digestMode: 'user-operation-hash',
    projectedArtifactDigest: 'sha256:packed-user-operation',
  });

  equal(projection.objectKind, 'execution-projection', 'Crypto authorization object model: projection object kind is stable');
  equal(projection.receiptId, receipt.receiptId, 'Crypto authorization object model: projection binds to receipt');
  equal(projection.adapterKind, 'erc-4337-user-operation', 'Crypto authorization object model: projection can target ERC-4337 adapter');
}

function testPermissionGrantIntent(): void {
  const chain = fixtureChain();
  const account = createCryptoAccountReference({
    accountKind: 'eoa',
    chain,
    address: '0x4444444444444444444444444444444444444444',
  });
  const requester = createCryptoAuthorizationActor({
    actorKind: 'wallet',
    actorId: 'wallet:browser',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'module',
    chain,
    targetId: 'wallet-permission-controller',
    address: '0x5555555555555555555555555555555555555555',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: ['chain', 'account', 'actor', 'spender', 'validity-window'],
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T09:00:00.000Z',
    validUntil: '2026-04-21T10:00:00.000Z',
    nonce: 'permission:1',
    replayProtectionMode: 'session-budget',
    digestMode: 'attestor-canonical-json',
    requiredArtifacts: ['attestor-release-receipt', 'wallet-permission-grant'],
  });

  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-permission-001',
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'permission-grant',
    target,
    policyScope,
    constraints,
    executionAdapterKind: 'wallet-call-api',
  });

  equal(intent.consequenceKind, 'permission-grant', 'Crypto authorization object model: permission grants are first-class');
  equal(intent.constraints.replayProtectionMode, 'session-budget', 'Crypto authorization object model: permission grants can use session-budget replay protection');
  equal(intent.executionAdapterKind, 'wallet-call-api', 'Crypto authorization object model: permission grants can project to wallet call APIs');
}

function testInvalidObjectsReject(): void {
  assert.throws(
    () =>
      createCryptoAuthorizationActor({
        actorKind: 'robot' as never,
        actorId: 'agent-1',
      }),
    /does not support actor kind/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoAuthorizationPolicyScope({
        dimensions: [],
      }),
    /requires at least one dimension/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoAuthorizationConstraints({
        validAfter: '2026-04-21T09:00:00.000Z',
        validUntil: '2026-04-21T08:00:00.000Z',
        nonce: 'nonce',
        replayProtectionMode: 'nonce',
        digestMode: 'eip-712-typed-data',
        requiredArtifacts: ['eip-712-authorization'],
      }),
    /validAfter must be before validUntil/i,
  );
  passed += 1;

  const chain = fixtureChain();
  const otherChain = createCryptoChainReference({
    namespace: 'eip155',
    chainId: '137',
  });
  const account = createCryptoAccountReference({
    accountKind: 'eoa',
    chain,
    address: '0x4444444444444444444444444444444444444444',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'payee',
    chain: otherChain,
    targetId: 'payee',
  });
  const requester = createCryptoAuthorizationActor({
    actorKind: 'human',
    actorId: 'alice',
  });
  const scope = createCryptoAuthorizationPolicyScope({
    dimensions: ['chain', 'account', 'asset', 'counterparty', 'amount'],
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T08:00:00.000Z',
    validUntil: '2026-04-21T08:10:00.000Z',
    nonce: 'nonce',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: ['eip-712-authorization'],
  });

  assert.throws(
    () =>
      createCryptoAuthorizationIntent({
        intentId: 'intent-bad-chain',
        requestedAt: '2026-04-21T08:00:01.000Z',
        requester,
        account,
        consequenceKind: 'transfer',
        target,
        policyScope: scope,
        constraints,
      }),
    /account and target must share a chain/i,
  );
  passed += 1;

  const sameChainTarget = createCryptoExecutionTarget({
    targetKind: 'payee',
    chain,
    targetId: 'payee',
  });
  const missingDimensionScope = createCryptoAuthorizationPolicyScope({
    dimensions: ['chain', 'account', 'asset', 'amount'],
  });

  assert.throws(
    () =>
      createCryptoAuthorizationIntent({
        intentId: 'intent-missing-dimension',
        requestedAt: '2026-04-21T08:00:01.000Z',
        requester,
        account,
        consequenceKind: 'transfer',
        target: sameChainTarget,
        policyScope: missingDimensionScope,
        constraints,
      }),
    /requires counterparty/i,
  );
  passed += 1;

  const intent = fixtureIntent();
  assert.throws(
    () =>
      createCryptoAuthorizationDecision({
        decisionId: 'decision-no-signer',
        intent,
        decidedAt: '2026-04-21T08:00:02.000Z',
        status: 'allow',
      }),
    /allow decisions require at least one signer authority/i,
  );
  passed += 1;

  const signer = fixtureSigner();
  const decision = createCryptoAuthorizationDecision({
    decisionId: 'decision-valid',
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: 'allow',
    signerAuthorities: [signer],
  });

  assert.throws(
    () =>
      createCryptoAuthorizationReceipt({
        receiptId: 'receipt-mode-mismatch',
        decision,
        issuedAt: '2026-04-21T08:00:03.000Z',
        artifactKind: 'erc-1271-validation',
        digestMode: 'user-operation-hash',
        authorizationDigest: 'sha256:userop',
        evidenceDigest: 'sha256:evidence',
        signerAuthority: signer,
        signatureValidationMode: 'eip-712-eoa',
      }),
    /validation mode must match signer authority/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptorVocabulary();
  testPredicateVocabulary();
  testActorTargetScopeAndConstraintFactories();
  testIntentDecisionReceiptAndProjection();
  testPermissionGrantIntent();
  testInvalidObjectsReject();

  console.log(`\nCrypto authorization core object-model tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core object-model tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
