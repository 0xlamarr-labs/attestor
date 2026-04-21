import { strict as assert } from 'node:assert';
import {
  CRYPTO_CANONICAL_DIGEST_ALGORITHM,
  CRYPTO_CANONICAL_REFERENCE_KINDS,
  CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
  CRYPTO_COUNTERPARTY_KINDS,
  createCryptoCanonicalAccountReference,
  createCryptoCanonicalAssetReference,
  createCryptoCanonicalChainReference,
  createCryptoCanonicalCounterpartyReference,
  createCryptoCanonicalReferenceBundle,
  cryptoCanonicalReferencesDescriptor,
  isCryptoCanonicalReferenceKind,
  isCryptoCounterpartyKind,
  parseCaip2ChainId,
  parseCaip10AccountId,
} from '../src/crypto-authorization-core/canonical-references.js';
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

function fixtureAccount() {
  const chain = fixtureChain();
  return createCryptoAccountReference({
    accountKind: 'safe',
    chain,
    address: '0xAbCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
    accountLabel: 'Treasury Safe',
  });
}

function fixtureAsset() {
  const chain = fixtureChain();
  return createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain,
    assetId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
  });
}

function testDescriptorVocabulary(): void {
  const descriptor = cryptoCanonicalReferencesDescriptor();

  equal(
    descriptor.version,
    CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    'Crypto canonical references: descriptor exposes version',
  );
  deepEqual(
    descriptor.referenceKinds,
    CRYPTO_CANONICAL_REFERENCE_KINDS,
    'Crypto canonical references: descriptor exposes reference kinds',
  );
  deepEqual(
    descriptor.counterpartyKinds,
    CRYPTO_COUNTERPARTY_KINDS,
    'Crypto canonical references: descriptor exposes counterparty kinds',
  );
  equal(
    descriptor.digestAlgorithm,
    CRYPTO_CANONICAL_DIGEST_ALGORITHM,
    'Crypto canonical references: descriptor exposes digest algorithm',
  );
  deepEqual(
    descriptor.caipStandards,
    ['CAIP-2', 'CAIP-10', 'CAIP-19'],
    'Crypto canonical references: descriptor declares the CAIP backbone',
  );
}

function testPredicateVocabulary(): void {
  ok(isCryptoCanonicalReferenceKind('chain'), 'Crypto canonical references: chain is a reference kind');
  ok(isCryptoCanonicalReferenceKind('counterparty'), 'Crypto canonical references: counterparty is a reference kind');
  ok(isCryptoCounterpartyKind('intent-solver'), 'Crypto canonical references: intent solver is a counterparty kind');
  ok(isCryptoCounterpartyKind('custody-destination'), 'Crypto canonical references: custody destination is a counterparty kind');
  ok(!isCryptoCanonicalReferenceKind('release-token'), 'Crypto canonical references: release token is not a canonical reference kind');
  ok(!isCryptoCounterpartyKind('unknown-counterparty'), 'Crypto canonical references: unknown counterparty kind is rejected');
}

function testChainAndAccountCanonicalization(): void {
  const chain = createCryptoCanonicalChainReference(fixtureChain());

  equal(chain.referenceKind, 'chain', 'Crypto canonical references: chain object kind is stable');
  equal(chain.caip2ChainId, 'eip155:1', 'Crypto canonical references: chain uses CAIP-2');
  equal(chain.namespace, 'eip155', 'Crypto canonical references: chain namespace is preserved');
  equal(chain.reference, '1', 'Crypto canonical references: chain reference is preserved');
  ok(chain.digest.startsWith('sha256:'), 'Crypto canonical references: chain digest uses sha256');
  equal(
    chain.canonical,
    '{"caip2ChainId":"eip155:1","namespace":"eip155","reference":"1","referenceKind":"chain","runtimeFamily":"evm","version":"attestor.crypto-canonical-references.v1"}',
    'Crypto canonical references: chain canonical JSON is stable',
  );
  deepEqual(
    parseCaip2ChainId(chain.caip2ChainId),
    { namespace: 'eip155', reference: '1' },
    'Crypto canonical references: CAIP-2 parser returns namespace and reference',
  );

  const account = createCryptoCanonicalAccountReference(fixtureAccount());

  equal(account.referenceKind, 'account', 'Crypto canonical references: account object kind is stable');
  equal(
    account.accountAddress,
    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    'Crypto canonical references: EVM account identity is lowercased',
  );
  equal(
    account.caip10AccountId,
    'eip155:1:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    'Crypto canonical references: account uses CAIP-10',
  );
  ok(
    account.display.includes('Treasury Safe'),
    'Crypto canonical references: display carries the account label separately',
  );
  deepEqual(
    parseCaip10AccountId(account.caip10AccountId),
    {
      chainId: 'eip155:1',
      accountAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    },
    'Crypto canonical references: CAIP-10 parser returns chain id and account address',
  );
}

function testAssetCanonicalization(): void {
  const asset = createCryptoCanonicalAssetReference({
    asset: fixtureAsset(),
    assetNamespace: 'erc20',
  });

  equal(asset.referenceKind, 'asset', 'Crypto canonical references: asset object kind is stable');
  equal(asset.assetNamespace, 'erc20', 'Crypto canonical references: explicit asset namespace is preserved');
  equal(
    asset.assetReference,
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    'Crypto canonical references: EVM asset reference is lowercased',
  );
  equal(
    asset.caip19AssetType,
    'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    'Crypto canonical references: asset type uses CAIP-19',
  );
  equal(asset.caip19AssetId, asset.caip19AssetType, 'Crypto canonical references: fungible asset id equals asset type');
  ok(asset.display.includes('USDC'), 'Crypto canonical references: display carries symbol separately');

  const nft = createCryptoCanonicalAssetReference({
    asset: createCryptoAssetReference({
      assetKind: 'non-fungible-token',
      chain: fixtureChain(),
      assetId: '0x1234567890abcdef1234567890abcdef12345678',
      symbol: 'COLLECTIBLE',
    }),
    assetNamespace: 'erc721',
    tokenId: '42',
  });

  equal(
    nft.caip19AssetId,
    'eip155:1/erc721:0x1234567890abcdef1234567890abcdef12345678/42',
    'Crypto canonical references: token id extends CAIP-19 for individually addressable assets',
  );
  equal(nft.tokenId, '42', 'Crypto canonical references: token id is preserved');

  const nativeAsset = createCryptoCanonicalAssetReference({
    asset: createCryptoAssetReference({
      assetKind: 'native-token',
      chain: fixtureChain(),
      assetId: '60',
      symbol: 'ETH',
      decimals: 18,
    }),
  });

  equal(nativeAsset.assetNamespace, 'slip44', 'Crypto canonical references: native assets default to SLIP-44 namespace');
  equal(
    nativeAsset.caip19AssetType,
    'eip155:1/slip44:60',
    'Crypto canonical references: native EVM assets are not forced into contract-address form',
  );
}

function testCounterpartyAndBundles(): void {
  const account = createCryptoCanonicalAccountReference(fixtureAccount());
  const asset = createCryptoCanonicalAssetReference({
    asset: fixtureAsset(),
    assetNamespace: 'erc20',
  });
  const accountCounterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'account',
    counterpartyId: 'ignored-when-account-is-present',
    account,
  });

  equal(
    accountCounterparty.counterpartyId,
    account.caip10AccountId,
    'Crypto canonical references: account counterparty binds to CAIP-10 id',
  );
  equal(
    accountCounterparty.chain?.caip2ChainId,
    'eip155:1',
    'Crypto canonical references: account counterparty carries chain',
  );

  const protocolCounterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'protocol',
    counterpartyId: 'protocol:uniswap-v4',
    chain: fixtureChain(),
    display: 'Uniswap v4',
  });

  equal(protocolCounterparty.display, 'Uniswap v4', 'Crypto canonical references: protocol display is preserved');
  equal(protocolCounterparty.chain?.caip2ChainId, 'eip155:1', 'Crypto canonical references: protocol counterparty can be chain scoped');

  const bundle = createCryptoCanonicalReferenceBundle({
    chain: fixtureChain(),
    account,
    asset,
    counterparty: protocolCounterparty,
  });
  const repeatBundle = createCryptoCanonicalReferenceBundle({
    counterparty: protocolCounterparty,
    asset,
    account,
    chain: fixtureChain(),
  });

  equal(bundle.digest, repeatBundle.digest, 'Crypto canonical references: bundle digest is deterministic');
  equal(bundle.account?.digest, account.digest, 'Crypto canonical references: bundle binds account digest');
  equal(bundle.asset?.digest, asset.digest, 'Crypto canonical references: bundle binds asset digest');
  equal(
    bundle.counterparty?.digest,
    protocolCounterparty.digest,
    'Crypto canonical references: bundle binds counterparty digest',
  );
}

function testInvalidReferencesReject(): void {
  assert.throws(
    () =>
      createCryptoCanonicalChainReference(
        createCryptoChainReference({
          namespace: 'eip155',
          chainId: 'not valid',
        }),
      ),
    /chain reference is not CAIP-compatible/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoCanonicalAccountReference(
        createCryptoAccountReference({
          accountKind: 'eoa',
          chain: fixtureChain(),
          address: '0x123',
        }),
      ),
    /20-byte EVM address/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoCanonicalAssetReference({
        asset: fixtureAsset(),
        assetNamespace: 'erc20',
        assetReference: 'USDC',
      }),
    /20-byte EVM address for EVM contract asset namespaces/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoCanonicalAssetReference({
        asset: fixtureAsset(),
        assetNamespace: 'er',
      }),
    /asset namespace is not CAIP-compatible/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoCanonicalAssetReference({
        asset: fixtureAsset(),
        assetNamespace: 'erc20',
        tokenId: 'bad/token',
      }),
    /tokenId is not CAIP-compatible/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoCanonicalCounterpartyReference({
        counterpartyKind: 'offchain-entity',
        counterpartyId: '   ',
      }),
    /counterpartyId requires a non-empty value/i,
  );
  passed += 1;

  assert.throws(
    () => parseCaip10AccountId('eip155:1:bad/address'),
    /account address is not CAIP-compatible/i,
  );
  passed += 1;

  const account = createCryptoCanonicalAccountReference(fixtureAccount());
  const otherChain = createCryptoCanonicalChainReference(
    createCryptoChainReference({
      namespace: 'eip155',
      chainId: '137',
    }),
  );

  assert.throws(
    () =>
      createCryptoCanonicalCounterpartyReference({
        counterpartyKind: 'account',
        counterpartyId: account.caip10AccountId,
        chain: otherChain,
        account,
      }),
    /account chain must match explicit chain/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoCanonicalReferenceBundle({
        chain: otherChain,
        account,
      }),
    /account chain must match bundle chain/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptorVocabulary();
  testPredicateVocabulary();
  testChainAndAccountCanonicalization();
  testAssetCanonicalization();
  testCounterpartyAndBundles();
  testInvalidReferencesReject();

  console.log(`\nCrypto authorization core canonical-reference tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core canonical-reference tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
