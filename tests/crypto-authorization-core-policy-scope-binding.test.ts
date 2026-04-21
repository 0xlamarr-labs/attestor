import assert from 'node:assert/strict';
import {
  CRYPTO_POLICY_CONTROL_PLANE_DOMAIN_ID,
  CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS,
  CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
  CRYPTO_POLICY_CONTROL_PLANE_SCOPE_DIMENSIONS,
  createCryptoPolicyControlPlaneScopeBinding,
  cryptoPolicyControlPlaneScopeBindingDescriptor,
  cryptoPolicyControlPlaneScopeBindingLabel,
  type CryptoPolicyControlPlaneScopeBinding,
} from '../src/crypto-authorization-core/policy-control-plane-scope-binding.js';
import {
  CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
  createCryptoAuthorizationActor,
  createCryptoAuthorizationConstraints,
  createCryptoAuthorizationDecision,
  createCryptoAuthorizationIntent,
  createCryptoAuthorizationPolicyScope,
  createCryptoExecutionTarget,
  createCryptoSignerAuthority,
} from '../src/crypto-authorization-core/object-model.js';
import {
  createCryptoCanonicalCounterpartyReference,
} from '../src/crypto-authorization-core/canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
} from '../src/crypto-authorization-core/consequence-risk-mapping.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
} from '../src/crypto-authorization-core/types.js';
import type { CryptoReleaseDecisionBinding } from '../src/crypto-authorization-core/release-decision-binding.js';
import { computePolicyBundleEntryDigest } from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicySimulationApi } from '../src/release-policy-control-plane/simulation.js';
import { createInMemoryPolicyControlPlaneStore } from '../src/release-policy-control-plane/store.js';
import { createInMemoryPolicyMutationAuditLogWriter } from '../src/release-policy-control-plane/audit-log.js';

let passed = 0;

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const SPENDER_ADDRESS = '0x2222222222222222222222222222222222222222';
const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

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

function fixtureAccount() {
  return createCryptoAccountReference({
    accountKind: 'safe',
    chain: fixtureChain(),
    address: ACCOUNT_ADDRESS,
    accountLabel: 'Treasury Safe',
  });
}

function fixtureAsset() {
  return createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain: fixtureChain(),
    assetId: USDC_ADDRESS,
    symbol: 'USDC',
    decimals: 6,
  });
}

function fixtureBindingInput(options?: {
  readonly dimensions?: readonly Parameters<typeof createCryptoAuthorizationPolicyScope>[0]['dimensions'][number][];
  readonly maxAmount?: string | null;
  readonly environment?: string | null;
  readonly tenantId?: string | null;
}) {
  const chain = fixtureChain();
  const account = fixtureAccount();
  const asset = fixtureAsset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:allowance-manager',
    authorityRef: 'authority:treasury-automation',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'contract',
    chain,
    targetId: 'erc20:usdc:approve',
    address: SPENDER_ADDRESS,
    counterparty: SPENDER_ADDRESS,
    protocol: 'erc20-allowance',
    functionSelector: '0x095ea7b3',
    calldataClass: 'erc20-approve',
  });
  const dimensions = options?.dimensions ?? [
    'chain',
    'account',
    'actor',
    'asset',
    'counterparty',
    'spender',
    'protocol',
    'function-selector',
    'calldata-class',
    'amount',
    'budget',
    'validity-window',
    'cadence',
    'risk-tier',
    'runtime-context',
  ];
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions,
    environment: options?.environment === undefined ? 'prod' : options.environment,
    tenantId: options?.tenantId === undefined ? 'tenant-crypto' : options.tenantId,
    policyPackRef: 'crypto-approval-pack',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T08:00:00.000Z',
    validUntil: '2026-04-21T08:10:00.000Z',
    nonce: 'approval:nonce:42',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
    maxAmount: options?.maxAmount === undefined ? '1000.00' : options.maxAmount,
    budgetId: 'budget:daily-usdc-approvals',
    cadence: 'daily',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-policy-scope-001',
    requestedAt: '2026-04-21T08:00:01.000Z',
    requester,
    account,
    consequenceKind: 'approval',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind: 'wallet-call-api',
    evidenceRefs: ['evidence:policy-scope:001'],
  });
  const counterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'contract',
    counterpartyId: SPENDER_ADDRESS,
    chain,
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'approval',
    account,
    asset,
    amount: {
      assetAmount: '1000.00',
      normalizedUsd: '1000.00',
      isUnlimitedApproval: true,
    },
    counterparty,
    context: {
      executionAdapterKind: 'wallet-call-api',
      signals: ['wallet-permission'],
      hasBudget: true,
      hasExpiry: true,
      hasRevocationPath: true,
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'wallet-permission-controller',
    authorityId: 'wallet:permissions:treasury',
    validationMode: 'wallet-native-permission',
    address: ACCOUNT_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: 'decision-policy-scope-001',
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: 'release-policy-scope-001',
    reasonCodes: ['policy-scope-bound'],
    signerAuthorities: [signer],
  });

  return {
    intent,
    cryptoDecision,
    riskAssessment,
    generatedAt: '2026-04-21T08:00:03.000Z',
    planId: 'enterprise',
  } as const;
}

function fixtureBinding(): CryptoPolicyControlPlaneScopeBinding {
  return createCryptoPolicyControlPlaneScopeBinding(fixtureBindingInput());
}

function testDescriptor(): void {
  const descriptor = cryptoPolicyControlPlaneScopeBindingDescriptor();

  equal(descriptor.version, CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION, 'Crypto policy scope binding: descriptor exposes version');
  equal(descriptor.domainId, CRYPTO_POLICY_CONTROL_PLANE_DOMAIN_ID, 'Crypto policy scope binding: descriptor exposes domain id');
  deepEqual(descriptor.cryptoScopeDimensions, CRYPTO_POLICY_CONTROL_PLANE_SCOPE_DIMENSIONS, 'Crypto policy scope binding: descriptor exposes crypto dimensions');
  deepEqual(descriptor.bindingChecks, CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS, 'Crypto policy scope binding: descriptor exposes binding checks');
  ok(descriptor.standards.includes('CAIP-2'), 'Crypto policy scope binding: descriptor names CAIP-2');
  ok(descriptor.standards.includes('ERC-7715-permission-scope-ready'), 'Crypto policy scope binding: descriptor names ERC-7715 readiness');
  ok(descriptor.standards.includes('ERC-4337-simulation-ready'), 'Crypto policy scope binding: descriptor names ERC-4337 simulation readiness');
}

function testCreatesPolicyControlPlaneBinding(): void {
  const binding = fixtureBinding();
  const second = fixtureBinding();

  equal(binding.version, CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION, 'Crypto policy scope binding: binding carries version');
  equal(binding.intentId, 'intent-policy-scope-001', 'Crypto policy scope binding: intent id is bound');
  equal(binding.cryptoDecisionId, 'decision-policy-scope-001', 'Crypto policy scope binding: crypto decision id is bound');
  equal(binding.releaseDecisionId, 'release-policy-scope-001', 'Crypto policy scope binding: release decision id is carried');
  equal(binding.policyPackId, 'crypto-approval-pack', 'Crypto policy scope binding: policy pack comes from crypto policy scope');
  equal(binding.activationTarget.environment, 'prod', 'Crypto policy scope binding: activation target carries environment');
  equal(binding.activationTarget.tenantId, 'tenant-crypto', 'Crypto policy scope binding: activation target carries tenant');
  equal(binding.activationTarget.accountId, `eip155:1:${ACCOUNT_ADDRESS}`, 'Crypto policy scope binding: activation target derives CAIP-10 account');
  equal(binding.activationTarget.domainId, CRYPTO_POLICY_CONTROL_PLANE_DOMAIN_ID, 'Crypto policy scope binding: activation target carries crypto domain');
  equal(binding.activationTarget.wedgeId, 'crypto.approval', 'Crypto policy scope binding: activation target carries crypto wedge');
  equal(binding.activationTarget.consequenceType, 'action', 'Crypto policy scope binding: activation target maps to release action');
  equal(binding.activationTarget.riskClass, 'R4', 'Crypto policy scope binding: activation target carries risk');
  equal(binding.activationTarget.planId, 'enterprise', 'Crypto policy scope binding: activation target carries plan');
  ok(binding.activationTarget.cohortId?.includes('wallet-call-api'), 'Crypto policy scope binding: activation target carries adapter cohort');
  ok(binding.scopeSelector.dimensions.includes('account'), 'Crypto policy scope binding: selector is account scoped');
  ok(binding.scopeSelector.dimensions.includes('wedge'), 'Crypto policy scope binding: selector is wedge scoped');
  ok(binding.targetLabel.includes('domain:crypto-authorization'), 'Crypto policy scope binding: target label is control-plane compatible');
  equal(binding.cryptoScope.chain.caip2ChainId, 'eip155:1', 'Crypto policy scope binding: CAIP-2 chain is bound');
  equal(binding.cryptoScope.account.caip10AccountId, `eip155:1:${ACCOUNT_ADDRESS}`, 'Crypto policy scope binding: CAIP-10 account is bound');
  equal(binding.cryptoScope.asset?.caip19AssetId, `eip155:1/erc20:${USDC_ADDRESS}`, 'Crypto policy scope binding: CAIP-19 asset is bound');
  equal(binding.cryptoScope.counterparty?.counterpartyId, SPENDER_ADDRESS, 'Crypto policy scope binding: counterparty is bound');
  equal(binding.cryptoScope.spender, SPENDER_ADDRESS, 'Crypto policy scope binding: spender is bound');
  equal(binding.cryptoScope.protocol, 'erc20-allowance', 'Crypto policy scope binding: protocol is bound');
  equal(binding.cryptoScope.functionSelector, '0x095ea7b3', 'Crypto policy scope binding: function selector is bound');
  equal(binding.cryptoScope.calldataClass, 'erc20-approve', 'Crypto policy scope binding: calldata class is bound');
  equal(binding.cryptoScope.budget.maxAmount, '1000.00', 'Crypto policy scope binding: amount is bound');
  equal(binding.cryptoScope.budget.budgetId, 'budget:daily-usdc-approvals', 'Crypto policy scope binding: budget id is bound');
  equal(binding.cryptoScope.budget.cadence, 'daily', 'Crypto policy scope binding: cadence is bound');
  equal(binding.cryptoScope.budget.validUntil, '2026-04-21T08:10:00.000Z', 'Crypto policy scope binding: validity window is bound');
  ok(binding.cryptoScope.requiredDimensions.includes('validity-window'), 'Crypto policy scope binding: risk-added validity dimension is required');
  ok(binding.cryptoScope.requiredDimensions.includes('spender'), 'Crypto policy scope binding: spender dimension is required');
  ok(binding.cryptoScope.providedDimensions.includes('budget'), 'Crypto policy scope binding: provided budget dimension is retained');
  ok(binding.cryptoScope.digest.startsWith('sha256:'), 'Crypto policy scope binding: extended scope digest is exposed');
  equal(binding.policyPack.lifecycleState, 'published', 'Crypto policy scope binding: policy pack is published');
  equal(binding.policyPack.latestBundleRef?.bundleId, binding.bundleId, 'Crypto policy scope binding: pack latest bundle points at bundle');
  ok(binding.policyPack.labels.includes('approval'), 'Crypto policy scope binding: policy pack labels consequence');
  equal(binding.policyBundleEntry.policyHash, computePolicyBundleEntryDigest(binding.policyBundleEntry), 'Crypto policy scope binding: policy hash verifies');
  equal(binding.policyBundleEntry.definition.scope.wedgeId, 'crypto.approval', 'Crypto policy scope binding: release policy wedge is crypto approval');
  equal(binding.policyBundleEntry.definition.release.requireSignedEnvelope, true, 'Crypto policy scope binding: release policy requires signed envelope');
  equal(binding.policyBundleManifest.packId, 'crypto-approval-pack', 'Crypto policy scope binding: manifest binds pack id');
  equal(binding.policyBundleManifest.entries[0]?.id, binding.policyBundleEntry.id, 'Crypto policy scope binding: manifest carries entry');
  equal(binding.policyBundleManifest.schemas[0]?.digest, binding.cryptoScope.digest, 'Crypto policy scope binding: manifest schema digest binds crypto scope');
  equal(binding.signableArtifact.packId, binding.policyPackId, 'Crypto policy scope binding: signable artifact carries pack id');
  equal(binding.signableArtifact.statement.subject.length, 4, 'Crypto policy scope binding: signable artifact has in-toto subjects');
  ok(binding.signableArtifact.payloadDigest.startsWith('sha256:'), 'Crypto policy scope binding: signable artifact digest is exposed');
  equal(binding.bundleRecord.version, 'attestor.policy-store-record.v1', 'Crypto policy scope binding: bundle record is store-compatible');
  equal(binding.bundleRecord.signedBundle, null, 'Crypto policy scope binding: unsigned bundle record remains signable later');
  equal(binding.activationRecord.state, 'active', 'Crypto policy scope binding: activation record is active');
  equal(binding.activationRecord.targetLabel, binding.targetLabel, 'Crypto policy scope binding: activation record target label matches');
  equal(binding.activationRecord.rolloutMode, 'enforce', 'Crypto policy scope binding: activation rollout is enforce by default');
  equal(binding.simulationOverlay.bundleRecord.bundleId, binding.bundleId, 'Crypto policy scope binding: simulation overlay carries bundle');
  equal(binding.simulationOverlay.target.accountId, binding.activationTarget.accountId, 'Crypto policy scope binding: simulation overlay targets account');
  equal(binding.auditAppendInput.action, 'activate-bundle', 'Crypto policy scope binding: audit input activates bundle');
  equal(binding.auditAppendInput.subject.activationId, binding.activationId, 'Crypto policy scope binding: audit subject carries activation');
  ok(JSON.stringify(binding.auditAppendInput.mutationSnapshot).includes('budget:daily-usdc-approvals'), 'Crypto policy scope binding: audit snapshot includes budget');
  deepEqual(binding.bindingChecks, CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_CHECKS, 'Crypto policy scope binding: binding checks are complete');
  equal(binding.digest, second.digest, 'Crypto policy scope binding: digest is deterministic');
  ok(binding.bindingId.startsWith('sha256:'), 'Crypto policy scope binding: binding id is deterministic digest');
  ok(
    cryptoPolicyControlPlaneScopeBindingLabel(binding).includes('crypto-policy:decision-policy-scope-001'),
    'Crypto policy scope binding: label names decision',
  );
}

function testSimulationOverlayResolvesCandidatePolicy(): void {
  const binding = fixtureBinding();
  const store = createInMemoryPolicyControlPlaneStore();
  const simulation = createPolicySimulationApi(store).dryRunCandidateActivation(
    {
      target: binding.activationTarget,
      outputContract: {
        artifactType: binding.policyBundleEntry.definition.outputContract.allowedArtifactTypes[0]!,
        expectedShape: binding.policyBundleEntry.definition.outputContract.expectedShape,
        consequenceType: binding.policyBundleEntry.definition.outputContract.consequenceType,
        riskClass: binding.policyBundleEntry.definition.outputContract.riskClass,
      },
      capabilityBoundary: {
        allowedTools: binding.policyBundleEntry.definition.capabilityBoundary.allowedTools,
        allowedTargets: binding.policyBundleEntry.definition.capabilityBoundary.allowedTargets,
        allowedDataDomains: binding.policyBundleEntry.definition.capabilityBoundary.allowedDataDomains,
      },
      targetKind: 'workflow',
      rolloutContext: {
        requestId: 'req_crypto_policy_scope',
        outputHash: 'sha256:crypto-policy-scope',
        requesterId: 'agent:allowance-manager',
        targetId: 'erc20:usdc:approve',
        tenantId: 'tenant-crypto',
        accountId: binding.activationTarget.accountId,
        planId: 'enterprise',
        cohortId: binding.activationTarget.cohortId,
      },
    },
    binding.simulationOverlay,
  );

  equal(simulation.simulated.status, 'resolved', 'Crypto policy scope binding: simulation resolves candidate policy');
  equal(simulation.simulated.bundleRecord?.bundleId, binding.bundleId, 'Crypto policy scope binding: simulation resolves candidate bundle');
  equal(simulation.delta.statusChanged, true, 'Crypto policy scope binding: simulation captures status change');
  equal(store.listBundles().length, 0, 'Crypto policy scope binding: dry run does not mutate store bundles');
  equal(store.listActivations().length, 0, 'Crypto policy scope binding: dry run does not mutate activations');
}

function testAuditSnapshotAppendsAndVerifies(): void {
  const binding = fixtureBinding();
  const auditLog = createInMemoryPolicyMutationAuditLogWriter();
  const entry = auditLog.append(binding.auditAppendInput);
  const verification = auditLog.verify();

  equal(entry.sequence, 1, 'Crypto policy scope binding: audit append creates first entry');
  equal(entry.action, 'activate-bundle', 'Crypto policy scope binding: audit action is activation');
  equal(entry.subject.bundleId, binding.bundleId, 'Crypto policy scope binding: audit entry binds bundle');
  ok(entry.mutationDigest.length > 0, 'Crypto policy scope binding: audit entry has mutation digest');
  equal(verification.valid, true, 'Crypto policy scope binding: audit log verifies');
  equal(verification.verifiedEntries, 1, 'Crypto policy scope binding: audit log verifies one entry');
}

function testFailClosedDimensionChecks(): void {
  const missingRiskDimension = fixtureBindingInput({
    dimensions: [
      'chain',
      'account',
      'asset',
      'spender',
      'amount',
      'risk-tier',
    ],
  });

  assert.throws(
    () => createCryptoPolicyControlPlaneScopeBinding(missingRiskDimension),
    /missing required dimensions: validity-window/i,
  );
  passed += 1;

  const missingAmountValue = fixtureBindingInput({ maxAmount: null });

  assert.throws(
    () => createCryptoPolicyControlPlaneScopeBinding(missingAmountValue),
    /amount scope requires maxAmount/i,
  );
  passed += 1;

  const valid = fixtureBindingInput();
  const mismatchedReleaseBinding = {
    cryptoDecisionId: 'wrong-decision',
    consequenceKind: 'approval',
    riskClass: 'R4',
  } as CryptoReleaseDecisionBinding;

  assert.throws(
    () =>
      createCryptoPolicyControlPlaneScopeBinding({
        ...valid,
        releaseBinding: mismatchedReleaseBinding,
      }),
    /release binding does not match crypto decision/i,
  );
  passed += 1;

  const missingTenant = fixtureBindingInput({ tenantId: null });

  assert.throws(
    () => createCryptoPolicyControlPlaneScopeBinding(missingTenant),
    /policyScope\.tenantId requires a non-empty value/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptor();
  testCreatesPolicyControlPlaneBinding();
  testSimulationOverlayResolvesCandidatePolicy();
  testAuditSnapshotAppendsAndVerifies();
  testFailClosedDimensionChecks();

  console.log(`\nCrypto authorization core policy scope binding tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core policy scope binding tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
