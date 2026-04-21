import { strict as assert } from 'node:assert';
import {
  CRYPTO_ACCOUNT_KINDS,
  CRYPTO_ASSET_KINDS,
  CRYPTO_AUTHORIZATION_ARTIFACT_KINDS,
  CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS,
  CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES,
  CRYPTO_AUTHORIZATION_CORE_SPEC_VERSION,
  CRYPTO_AUTHORIZATION_POLICY_DIMENSIONS,
  CRYPTO_CHAIN_NAMESPACES,
  CRYPTO_CHAIN_RUNTIME_FAMILIES,
  CRYPTO_EXECUTION_ADAPTER_KINDS,
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
  createCryptoExecutionAdapterReference,
  cryptoAccountReferenceLabel,
  cryptoAssetReferenceLabel,
  cryptoAuthorizationCoreDescriptor,
  cryptoChainReferenceLabel,
  cryptoExecutionAdapterReferenceLabel,
  isCryptoAccountKind,
  isCryptoAssetKind,
  isCryptoAuthorizationArtifactKind,
  isCryptoAuthorizationConsequenceKind,
  isCryptoAuthorizationPolicyDimension,
  isCryptoChainNamespace,
  isCryptoChainRuntimeFamily,
  isCryptoExecutionAdapterKind,
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

function testDescriptorVocabulary(): void {
  const descriptor = cryptoAuthorizationCoreDescriptor();

  equal(
    descriptor.version,
    CRYPTO_AUTHORIZATION_CORE_SPEC_VERSION,
    'Crypto authorization core: descriptor exposes the spec version',
  );
  deepEqual(
    descriptor.chainNamespaces,
    CRYPTO_CHAIN_NAMESPACES,
    'Crypto authorization core: descriptor exposes chain namespaces',
  );
  deepEqual(
    descriptor.chainRuntimeFamilies,
    CRYPTO_CHAIN_RUNTIME_FAMILIES,
    'Crypto authorization core: descriptor exposes chain runtime families',
  );
  deepEqual(
    descriptor.accountKinds,
    CRYPTO_ACCOUNT_KINDS,
    'Crypto authorization core: descriptor exposes account kinds',
  );
  deepEqual(
    descriptor.assetKinds,
    CRYPTO_ASSET_KINDS,
    'Crypto authorization core: descriptor exposes asset kinds',
  );
  deepEqual(
    descriptor.consequenceKinds,
    CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS,
    'Crypto authorization core: descriptor exposes consequence kinds',
  );
  deepEqual(
    descriptor.executionAdapterKinds,
    CRYPTO_EXECUTION_ADAPTER_KINDS,
    'Crypto authorization core: descriptor exposes execution adapter kinds',
  );
  deepEqual(
    descriptor.artifactKinds,
    CRYPTO_AUTHORIZATION_ARTIFACT_KINDS,
    'Crypto authorization core: descriptor exposes authorization artifact kinds',
  );
  deepEqual(
    descriptor.policyDimensions,
    CRYPTO_AUTHORIZATION_POLICY_DIMENSIONS,
    'Crypto authorization core: descriptor exposes policy dimensions',
  );
  deepEqual(
    descriptor.releaseConsequenceTypes,
    ['communication', 'record', 'action', 'decision-support'],
    'Crypto authorization core: descriptor stays bound to the release-layer consequence vocabulary',
  );
  deepEqual(
    descriptor.riskClasses,
    ['R0', 'R1', 'R2', 'R3', 'R4'],
    'Crypto authorization core: descriptor stays bound to the release-layer risk vocabulary',
  );
}

function testPredicateVocabulary(): void {
  ok(isCryptoChainNamespace('eip155'), 'Crypto authorization core: EIP-155 is a chain namespace');
  ok(isCryptoChainRuntimeFamily('evm'), 'Crypto authorization core: EVM is a runtime family');
  ok(isCryptoAccountKind('erc-4337-smart-account'), 'Crypto authorization core: ERC-4337 smart account is an account kind');
  ok(isCryptoAssetKind('stablecoin'), 'Crypto authorization core: stablecoins are an asset kind');
  ok(isCryptoAuthorizationConsequenceKind('permission-grant'), 'Crypto authorization core: permission grants are a consequence kind');
  ok(isCryptoAuthorizationConsequenceKind('agent-payment'), 'Crypto authorization core: agent payments are a consequence kind');
  ok(isCryptoExecutionAdapterKind('erc-7579-module'), 'Crypto authorization core: ERC-7579 modules are execution adapters');
  ok(isCryptoExecutionAdapterKind('x402-payment'), 'Crypto authorization core: x402 payment is an execution adapter');
  ok(isCryptoAuthorizationArtifactKind('eip-712-authorization'), 'Crypto authorization core: EIP-712 authorization is an artifact kind');
  ok(isCryptoAuthorizationPolicyDimension('approval-quorum'), 'Crypto authorization core: approval quorum is a policy dimension');
  ok(!isCryptoAccountKind('browser-session'), 'Crypto authorization core: browser sessions are not crypto accounts');
  ok(!isCryptoExecutionAdapterKind('finance-filing-export'), 'Crypto authorization core: finance filing exports are not crypto execution adapters');
}

function testConsequenceProfiles(): void {
  const approval = CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES.approval;
  equal(approval.defaultRiskClass, 'R4', 'Crypto authorization core: approvals default to high assurance');
  equal(approval.releaseConsequenceType, 'action', 'Crypto authorization core: approvals map to release-layer actions');
  ok(approval.requiredPolicyDimensions.includes('spender'), 'Crypto authorization core: approvals require spender scope');
  ok(approval.requiredPolicyDimensions.includes('amount'), 'Crypto authorization core: approvals require amount scope');

  const delegation = CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES['account-delegation'];
  equal(delegation.defaultRiskClass, 'R4', 'Crypto authorization core: account delegation defaults to high assurance');
  ok(delegation.requiredPolicyDimensions.includes('validity-window'), 'Crypto authorization core: delegation requires validity windows');
  ok(delegation.requiredPolicyDimensions.includes('runtime-context'), 'Crypto authorization core: delegation requires runtime context');

  const agentPayment = CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES['agent-payment'];
  equal(agentPayment.defaultRiskClass, 'R2', 'Crypto authorization core: agent payments can default to bounded operational risk');
  ok(agentPayment.requiredPolicyDimensions.includes('budget'), 'Crypto authorization core: agent payments require budget scope');
  ok(agentPayment.requiredPolicyDimensions.includes('cadence'), 'Crypto authorization core: agent payments require cadence scope');

  ok(
    CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS.every((kind) => !kind.includes('safe')),
    'Crypto authorization core: consequence vocabulary does not bake Safe into the core',
  );
}

function testReferenceNormalizationAndLabels(): void {
  const chain = createCryptoChainReference({
    namespace: 'eip155',
    chainId: ' 1 ',
  });

  equal(chain.chainId, '1', 'Crypto authorization core: chain id is normalized');
  equal(chain.runtimeFamily, 'evm', 'Crypto authorization core: EIP-155 defaults to EVM runtime');
  equal(
    cryptoChainReferenceLabel(chain),
    'eip155:1 / runtime:evm',
    'Crypto authorization core: chain label is stable',
  );

  const account = createCryptoAccountReference({
    accountKind: 'safe',
    chain,
    address: ' 0x1234567890abcdef1234567890abcdef12345678 ',
    accountLabel: ' treasury-main ',
  });

  equal(account.address, '0x1234567890abcdef1234567890abcdef12345678', 'Crypto authorization core: account address is normalized');
  equal(account.accountLabel, 'treasury-main', 'Crypto authorization core: account label is normalized');
  equal(
    cryptoAccountReferenceLabel(account),
    'eip155:1 / runtime:evm / account:safe / address:0x1234567890abcdef1234567890abcdef12345678 / label:treasury-main',
    'Crypto authorization core: account label carries chain and account scope',
  );

  const asset = createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain,
    assetId: ' USDC ',
    symbol: ' usdc ',
    decimals: 6,
  });

  equal(asset.assetId, 'USDC', 'Crypto authorization core: asset id is normalized');
  equal(asset.symbol, 'usdc', 'Crypto authorization core: asset symbol is normalized');
  equal(asset.decimals, 6, 'Crypto authorization core: asset decimals are preserved');
  equal(
    cryptoAssetReferenceLabel(asset),
    'eip155:1 / runtime:evm / asset:stablecoin / id:USDC / symbol:usdc / decimals:6',
    'Crypto authorization core: asset label carries chain and asset scope',
  );

  const adapter = createCryptoExecutionAdapterReference({
    adapterKind: 'safe-module-guard',
    adapterId: ' treasury-guard-v1 ',
    chain,
    accountKind: 'safe',
  });

  equal(adapter.adapterId, 'treasury-guard-v1', 'Crypto authorization core: adapter id is normalized');
  equal(
    cryptoExecutionAdapterReferenceLabel(adapter),
    'eip155:1 / runtime:evm / adapter:safe-module-guard / id:treasury-guard-v1 / account:safe',
    'Crypto authorization core: adapter label carries chain and account family scope',
  );
}

function testInvalidReferencesReject(): void {
  assert.throws(
    () =>
      createCryptoChainReference({
        namespace: 'eip155',
        chainId: '   ',
      }),
    /chainId requires a non-empty value/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoChainReference({
        namespace: 'bad-chain' as never,
        chainId: '1',
      }),
    /does not support chain namespace/i,
  );
  passed += 1;

  const chain = createCryptoChainReference({ namespace: 'eip155', chainId: '1' });

  assert.throws(
    () =>
      createCryptoAccountReference({
        accountKind: 'not-a-wallet' as never,
        chain,
        address: '0x123',
      }),
    /does not support account kind/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoAccountReference({
        accountKind: 'eoa',
        chain,
        address: '   ',
      }),
    /address requires a non-empty value/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoAssetReference({
        assetKind: 'stablecoin',
        chain,
        assetId: 'USDC',
        decimals: -1,
      }),
    /decimals must be a non-negative integer/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoExecutionAdapterReference({
        adapterKind: 'unknown-adapter' as never,
        adapterId: 'adapter-1',
        chain,
      }),
    /does not support execution adapter kind/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptorVocabulary();
  testPredicateVocabulary();
  testConsequenceProfiles();
  testReferenceNormalizationAndLabels();
  testInvalidReferencesReject();

  console.log(`\nCrypto authorization core type tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core type tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
