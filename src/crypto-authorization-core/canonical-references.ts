import { createHash } from 'node:crypto';
import {
  type CryptoAccountReference,
  type CryptoAssetKind,
  type CryptoAssetReference,
  type CryptoChainReference,
} from './types.js';

/**
 * Canonical chain/account/asset/counterparty references for crypto authorization.
 *
 * Step 03 uses CAIP-2, CAIP-10, and CAIP-19 as the chain-agnostic identity
 * backbone. EVM display checksums and future interoperable-address encodings
 * are adapter/display projections; the core digest binds to these canonical
 * references.
 */

export const CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION =
  'attestor.crypto-canonical-references.v1';

export const CRYPTO_CANONICAL_DIGEST_ALGORITHM = 'sha256';

export const CRYPTO_CANONICAL_REFERENCE_KINDS = [
  'chain',
  'account',
  'asset',
  'counterparty',
] as const;
export type CryptoCanonicalReferenceKind =
  typeof CRYPTO_CANONICAL_REFERENCE_KINDS[number];

export const CRYPTO_COUNTERPARTY_KINDS = [
  'account',
  'contract',
  'protocol',
  'bridge',
  'intent-solver',
  'custody-destination',
  'offchain-entity',
] as const;
export type CryptoCounterpartyKind = typeof CRYPTO_COUNTERPARTY_KINDS[number];

export const CRYPTO_ASSET_NAMESPACE_BY_KIND: Record<CryptoAssetKind, string> = {
  'native-token': 'slip44',
  'fungible-token': 'token',
  stablecoin: 'token',
  'rwa-token': 'token',
  'non-fungible-token': 'nft',
  'multi-token': 'token',
  other: 'asset',
};

export interface CryptoCanonicalChainReference {
  readonly referenceKind: 'chain';
  readonly version: typeof CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION;
  readonly caip2ChainId: string;
  readonly namespace: string;
  readonly reference: string;
  readonly display: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoCanonicalAccountReference {
  readonly referenceKind: 'account';
  readonly version: typeof CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION;
  readonly chain: CryptoCanonicalChainReference;
  readonly caip10AccountId: string;
  readonly accountAddress: string;
  readonly display: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateCryptoCanonicalAssetReferenceInput {
  readonly asset: CryptoAssetReference;
  readonly assetNamespace?: string;
  readonly assetReference?: string;
  readonly tokenId?: string | null;
}

export interface CryptoCanonicalAssetReference {
  readonly referenceKind: 'asset';
  readonly version: typeof CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION;
  readonly chain: CryptoCanonicalChainReference;
  readonly assetNamespace: string;
  readonly assetReference: string;
  readonly tokenId: string | null;
  readonly caip19AssetType: string;
  readonly caip19AssetId: string;
  readonly display: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateCryptoCanonicalCounterpartyReferenceInput {
  readonly counterpartyKind: CryptoCounterpartyKind;
  readonly counterpartyId: string;
  readonly chain?: CryptoChainReference | CryptoCanonicalChainReference | null;
  readonly account?: CryptoAccountReference | CryptoCanonicalAccountReference | null;
  readonly display?: string | null;
}

export interface CryptoCanonicalCounterpartyReference {
  readonly referenceKind: 'counterparty';
  readonly version: typeof CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION;
  readonly counterpartyKind: CryptoCounterpartyKind;
  readonly counterpartyId: string;
  readonly chain: CryptoCanonicalChainReference | null;
  readonly account: CryptoCanonicalAccountReference | null;
  readonly display: string;
  readonly canonical: string;
  readonly digest: string;
}

export interface CryptoCanonicalReferenceBundle {
  readonly version: typeof CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION;
  readonly chain: CryptoCanonicalChainReference;
  readonly account: CryptoCanonicalAccountReference | null;
  readonly asset: CryptoCanonicalAssetReference | null;
  readonly counterparty: CryptoCanonicalCounterpartyReference | null;
  readonly canonical: string;
  readonly digest: string;
}

export interface CreateCryptoCanonicalReferenceBundleInput {
  readonly chain: CryptoChainReference | CryptoCanonicalChainReference;
  readonly account?: CryptoAccountReference | CryptoCanonicalAccountReference | null;
  readonly asset?: CryptoCanonicalAssetReference | null;
  readonly counterparty?: CryptoCanonicalCounterpartyReference | null;
}

export interface CryptoCanonicalReferencesDescriptor {
  readonly version: typeof CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION;
  readonly referenceKinds: readonly CryptoCanonicalReferenceKind[];
  readonly counterpartyKinds: readonly CryptoCounterpartyKind[];
  readonly digestAlgorithm: typeof CRYPTO_CANONICAL_DIGEST_ALGORITHM;
  readonly caipStandards: readonly string[];
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

const CAIP2_NAMESPACE_PATTERN = /^[-a-z0-9]{3,8}$/;
const CAIP2_REFERENCE_PATTERN = /^[-_a-zA-Z0-9]{1,32}$/;
const CAIP_ADDRESS_PATTERN = /^[-.%a-zA-Z0-9]{1,128}$/;
const CAIP19_ASSET_NAMESPACE_PATTERN = /^[-a-z0-9]{3,8}$/;
const CAIP19_TOKEN_ID_PATTERN = /^[-.%a-zA-Z0-9]{1,78}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const EVM_CONTRACT_ASSET_NAMESPACES = new Set(['erc20', 'erc721', 'erc1155']);

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Crypto canonical reference ${fieldName} requires a non-empty value.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | null | undefined,
  fieldName: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Crypto canonical reference ${fieldName} cannot be blank when provided.`);
  }
  return normalized;
}

function assertPattern(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new Error(`Crypto canonical reference ${label} is not CAIP-compatible: ${value}.`);
  }
}

function normalizeEvmAddressIfApplicable(
  chain: CryptoChainReference,
  value: string,
  fieldName: string,
): string {
  const normalized = normalizeIdentifier(value, fieldName);
  if (chain.namespace !== 'eip155' && chain.runtimeFamily !== 'evm') {
    return normalized;
  }

  if (!EVM_ADDRESS_PATTERN.test(normalized)) {
    throw new Error(`Crypto canonical reference ${fieldName} must be a 20-byte EVM address.`);
  }

  return normalized.toLowerCase();
}

function normalizeAssetReference(
  chain: CryptoChainReference,
  assetNamespace: string,
  value: string,
): string {
  const normalized = normalizeIdentifier(value, 'asset reference');
  const evmLikeChain = chain.namespace === 'eip155' || chain.runtimeFamily === 'evm';
  if (!evmLikeChain) {
    return normalized;
  }

  if (EVM_CONTRACT_ASSET_NAMESPACES.has(assetNamespace)) {
    if (!EVM_ADDRESS_PATTERN.test(normalized)) {
      throw new Error(
        'Crypto canonical reference asset reference must be a 20-byte EVM address for EVM contract asset namespaces.',
      );
    }
    return normalized.toLowerCase();
  }

  return EVM_ADDRESS_PATTERN.test(normalized) ? normalized.toLowerCase() : normalized;
}

function normalizeCaip2ChainId(chain: CryptoChainReference): string {
  const namespace = normalizeIdentifier(chain.namespace, 'chain namespace');
  const reference = normalizeIdentifier(chain.chainId, 'chain reference');
  assertPattern(namespace, CAIP2_NAMESPACE_PATTERN, 'chain namespace');
  assertPattern(reference, CAIP2_REFERENCE_PATTERN, 'chain reference');
  return `${namespace}:${reference}`;
}

function canonicalizeJson(value: CanonicalJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalizeJson(entry)).join(',')}]`;

  const objectValue = value as { readonly [key: string]: CanonicalJsonValue };
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(objectValue[key])}`)
    .join(',')}}`;
}

function digestCanonicalJson(value: CanonicalJsonValue): string {
  return `${CRYPTO_CANONICAL_DIGEST_ALGORITHM}:${createHash('sha256')
    .update(canonicalizeJson(value))
    .digest('hex')}`;
}

function canonicalStringFor(value: CanonicalJsonValue): string {
  return canonicalizeJson(value);
}

function isCanonicalChainReference(
  value: CryptoChainReference | CryptoCanonicalChainReference,
): value is CryptoCanonicalChainReference {
  return 'referenceKind' in value && value.referenceKind === 'chain';
}

function isCanonicalAccountReference(
  value: CryptoAccountReference | CryptoCanonicalAccountReference,
): value is CryptoCanonicalAccountReference {
  return 'referenceKind' in value && value.referenceKind === 'account';
}

export function isCryptoCanonicalReferenceKind(
  value: string,
): value is CryptoCanonicalReferenceKind {
  return includesValue(CRYPTO_CANONICAL_REFERENCE_KINDS, value);
}

export function isCryptoCounterpartyKind(value: string): value is CryptoCounterpartyKind {
  return includesValue(CRYPTO_COUNTERPARTY_KINDS, value);
}

export function createCryptoCanonicalChainReference(
  chain: CryptoChainReference | CryptoCanonicalChainReference,
): CryptoCanonicalChainReference {
  if (isCanonicalChainReference(chain)) {
    return chain;
  }

  const caip2ChainId = normalizeCaip2ChainId(chain);
  const payload = {
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    referenceKind: 'chain',
    caip2ChainId,
    namespace: chain.namespace,
    reference: chain.chainId,
    runtimeFamily: chain.runtimeFamily,
  } as const;

  return Object.freeze({
    referenceKind: 'chain',
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    caip2ChainId,
    namespace: chain.namespace,
    reference: chain.chainId,
    display: caip2ChainId,
    canonical: canonicalStringFor(payload),
    digest: digestCanonicalJson(payload),
  });
}

export function createCryptoCanonicalAccountReference(
  account: CryptoAccountReference | CryptoCanonicalAccountReference,
): CryptoCanonicalAccountReference {
  if (isCanonicalAccountReference(account)) {
    return account;
  }

  const chain = createCryptoCanonicalChainReference(account.chain);
  const accountAddress = normalizeEvmAddressIfApplicable(
    account.chain,
    account.address,
    'account address',
  );
  assertPattern(accountAddress, CAIP_ADDRESS_PATTERN, 'account address');
  const caip10AccountId = `${chain.caip2ChainId}:${accountAddress}`;
  const payload = {
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    referenceKind: 'account',
    caip10AccountId,
    accountKind: account.accountKind,
    accountAddress,
  } as const;

  return Object.freeze({
    referenceKind: 'account',
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    chain,
    caip10AccountId,
    accountAddress,
    display: account.accountLabel ? `${account.accountLabel} (${caip10AccountId})` : caip10AccountId,
    canonical: canonicalStringFor(payload),
    digest: digestCanonicalJson(payload),
  });
}

export function createCryptoCanonicalAssetReference(
  input: CreateCryptoCanonicalAssetReferenceInput,
): CryptoCanonicalAssetReference {
  const chain = createCryptoCanonicalChainReference(input.asset.chain);
  const assetNamespace = normalizeIdentifier(
    input.assetNamespace ?? CRYPTO_ASSET_NAMESPACE_BY_KIND[input.asset.assetKind],
    'asset namespace',
  );
  assertPattern(assetNamespace, CAIP19_ASSET_NAMESPACE_PATTERN, 'asset namespace');

  const rawAssetReference = input.assetReference ?? input.asset.assetId;
  const assetReference = normalizeAssetReference(
    input.asset.chain,
    assetNamespace,
    rawAssetReference,
  );
  assertPattern(assetReference, CAIP_ADDRESS_PATTERN, 'asset reference');

  const tokenId = normalizeOptionalIdentifier(input.tokenId, 'tokenId');
  if (tokenId !== null) {
    assertPattern(tokenId, CAIP19_TOKEN_ID_PATTERN, 'tokenId');
  }

  const caip19AssetType = `${chain.caip2ChainId}/${assetNamespace}:${assetReference}`;
  const caip19AssetId = tokenId === null ? caip19AssetType : `${caip19AssetType}/${tokenId}`;
  const payload = {
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    referenceKind: 'asset',
    caip19AssetId,
    caip19AssetType,
    assetKind: input.asset.assetKind,
    assetNamespace,
    assetReference,
    tokenId,
  } as const;

  return Object.freeze({
    referenceKind: 'asset',
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    chain,
    assetNamespace,
    assetReference,
    tokenId,
    caip19AssetType,
    caip19AssetId,
    display: input.asset.symbol ? `${input.asset.symbol} (${caip19AssetId})` : caip19AssetId,
    canonical: canonicalStringFor(payload),
    digest: digestCanonicalJson(payload),
  });
}

export function createCryptoCanonicalCounterpartyReference(
  input: CreateCryptoCanonicalCounterpartyReferenceInput,
): CryptoCanonicalCounterpartyReference {
  if (!isCryptoCounterpartyKind(input.counterpartyKind)) {
    throw new Error(
      `Crypto canonical reference does not support counterparty kind ${input.counterpartyKind}.`,
    );
  }

  const account = input.account ? createCryptoCanonicalAccountReference(input.account) : null;
  if (account && input.chain) {
    const explicitChain = createCryptoCanonicalChainReference(input.chain);
    if (explicitChain.caip2ChainId !== account.chain.caip2ChainId) {
      throw new Error(
        'Crypto canonical reference counterparty account chain must match explicit chain.',
      );
    }
  }
  const chain = account
    ? account.chain
    : input.chain
      ? createCryptoCanonicalChainReference(input.chain)
      : null;
  const rawCounterpartyId = account?.caip10AccountId ?? input.counterpartyId;
  const counterpartyId = normalizeIdentifier(rawCounterpartyId, 'counterpartyId');
  const display = normalizeOptionalIdentifier(input.display, 'display') ?? counterpartyId;
  const payload = {
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    referenceKind: 'counterparty',
    counterpartyKind: input.counterpartyKind,
    counterpartyId,
    chainId: chain?.caip2ChainId ?? null,
    accountId: account?.caip10AccountId ?? null,
  } as const;

  return Object.freeze({
    referenceKind: 'counterparty',
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    counterpartyKind: input.counterpartyKind,
    counterpartyId,
    chain,
    account,
    display,
    canonical: canonicalStringFor(payload),
    digest: digestCanonicalJson(payload),
  });
}

export function createCryptoCanonicalReferenceBundle(
  input: CreateCryptoCanonicalReferenceBundleInput,
): CryptoCanonicalReferenceBundle {
  const chain = createCryptoCanonicalChainReference(input.chain);
  const account = input.account ? createCryptoCanonicalAccountReference(input.account) : null;
  const asset = input.asset ?? null;
  const counterparty = input.counterparty ?? null;

  if (account && account.chain.caip2ChainId !== chain.caip2ChainId) {
    throw new Error('Crypto canonical reference bundle account chain must match bundle chain.');
  }
  if (asset && asset.chain.caip2ChainId !== chain.caip2ChainId) {
    throw new Error('Crypto canonical reference bundle asset chain must match bundle chain.');
  }
  if (counterparty?.chain && counterparty.chain.caip2ChainId !== chain.caip2ChainId) {
    throw new Error('Crypto canonical reference bundle counterparty chain must match bundle chain.');
  }

  const payload = {
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    referenceKind: 'reference-bundle',
    chainDigest: chain.digest,
    accountDigest: account?.digest ?? null,
    assetDigest: asset?.digest ?? null,
    counterpartyDigest: counterparty?.digest ?? null,
  } as const;

  return Object.freeze({
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    chain,
    account,
    asset,
    counterparty,
    canonical: canonicalStringFor(payload),
    digest: digestCanonicalJson(payload),
  });
}

export function parseCaip2ChainId(value: string): {
  readonly namespace: string;
  readonly reference: string;
} {
  const normalized = normalizeIdentifier(value, 'CAIP-2 chain id');
  const parts = normalized.split(':');
  if (parts.length !== 2) {
    throw new Error('Crypto canonical reference CAIP-2 chain id must contain one colon.');
  }
  const [namespace, reference] = parts;
  assertPattern(namespace, CAIP2_NAMESPACE_PATTERN, 'chain namespace');
  assertPattern(reference, CAIP2_REFERENCE_PATTERN, 'chain reference');
  return Object.freeze({ namespace, reference });
}

export function parseCaip10AccountId(value: string): {
  readonly chainId: string;
  readonly accountAddress: string;
} {
  const normalized = normalizeIdentifier(value, 'CAIP-10 account id');
  const parts = normalized.split(':');
  if (parts.length < 3) {
    throw new Error('Crypto canonical reference CAIP-10 account id must include chain and account.');
  }
  const accountAddress = parts.slice(2).join(':');
  const chainId = `${parts[0]}:${parts[1]}`;
  parseCaip2ChainId(chainId);
  assertPattern(accountAddress, CAIP_ADDRESS_PATTERN, 'account address');
  return Object.freeze({ chainId, accountAddress });
}

export function cryptoCanonicalReferencesDescriptor(): CryptoCanonicalReferencesDescriptor {
  return Object.freeze({
    version: CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    referenceKinds: CRYPTO_CANONICAL_REFERENCE_KINDS,
    counterpartyKinds: CRYPTO_COUNTERPARTY_KINDS,
    digestAlgorithm: CRYPTO_CANONICAL_DIGEST_ALGORITHM,
    caipStandards: Object.freeze(['CAIP-2', 'CAIP-10', 'CAIP-19']),
  });
}
