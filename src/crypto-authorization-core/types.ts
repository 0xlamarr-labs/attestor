import { vocabulary } from '../release-layer/index.js';

/**
 * Shared vocabulary for Attestor's crypto authorization core.
 *
 * Step 01 intentionally stops at the language layer: it defines the stable
 * nouns that later EIP-712 envelopes, ERC-1271 validation paths, smart-account
 * adapters, wallet-permission adapters, x402 payment adapters, and custody
 * co-signer adapters will build on.
 */

export const CRYPTO_AUTHORIZATION_CORE_SPEC_VERSION =
  'attestor.crypto-authorization-core.v1';

export const CRYPTO_CHAIN_NAMESPACES = [
  'eip155',
  'solana',
  'cosmos',
  'bitcoin',
  'other',
] as const;
export type CryptoChainNamespace = typeof CRYPTO_CHAIN_NAMESPACES[number];

export const CRYPTO_CHAIN_RUNTIME_FAMILIES = [
  'evm',
  'svm',
  'cosmwasm',
  'bitcoin-script',
  'non-evm',
] as const;
export type CryptoChainRuntimeFamily =
  typeof CRYPTO_CHAIN_RUNTIME_FAMILIES[number];

export const CRYPTO_ACCOUNT_KINDS = [
  'eoa',
  'safe',
  'erc-4337-smart-account',
  'erc-7579-modular-account',
  'erc-6900-modular-account',
  'custody-account',
  'agent-wallet',
] as const;
export type CryptoAccountKind = typeof CRYPTO_ACCOUNT_KINDS[number];

export const CRYPTO_ASSET_KINDS = [
  'native-token',
  'fungible-token',
  'stablecoin',
  'rwa-token',
  'non-fungible-token',
  'multi-token',
  'other',
] as const;
export type CryptoAssetKind = typeof CRYPTO_ASSET_KINDS[number];

export const CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS = [
  'transfer',
  'approval',
  'permission-grant',
  'account-delegation',
  'contract-call',
  'batch-call',
  'swap',
  'bridge',
  'user-operation',
  'agent-payment',
  'custody-withdrawal',
  'governance-action',
] as const;
export type CryptoAuthorizationConsequenceKind =
  typeof CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS[number];

export const CRYPTO_EXECUTION_ADAPTER_KINDS = [
  'safe-guard',
  'safe-module-guard',
  'erc-4337-user-operation',
  'erc-7579-module',
  'erc-6900-plugin',
  'eip-7702-delegation',
  'wallet-call-api',
  'x402-payment',
  'custody-cosigner',
  'intent-settlement',
] as const;
export type CryptoExecutionAdapterKind =
  typeof CRYPTO_EXECUTION_ADAPTER_KINDS[number];

export const CRYPTO_AUTHORIZATION_ARTIFACT_KINDS = [
  'attestor-release-receipt',
  'eip-712-authorization',
  'erc-1271-validation',
  'wallet-permission-grant',
  'http-payment-authorization',
  'execution-proof',
  'custody-policy-decision',
] as const;
export type CryptoAuthorizationArtifactKind =
  typeof CRYPTO_AUTHORIZATION_ARTIFACT_KINDS[number];

export const CRYPTO_AUTHORIZATION_POLICY_DIMENSIONS = [
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
  'approval-quorum',
  'runtime-context',
] as const;
export type CryptoAuthorizationPolicyDimension =
  typeof CRYPTO_AUTHORIZATION_POLICY_DIMENSIONS[number];

export type CryptoReleaseConsequenceType =
  (typeof vocabulary.CONSEQUENCE_TYPES)[number];
export type CryptoAuthorizationRiskClass =
  (typeof vocabulary.RISK_CLASSES)[number];

export interface CryptoAuthorizationConsequenceProfile {
  readonly kind: CryptoAuthorizationConsequenceKind;
  readonly label: string;
  readonly releaseConsequenceType: CryptoReleaseConsequenceType;
  readonly defaultRiskClass: CryptoAuthorizationRiskClass;
  readonly requiredPolicyDimensions: readonly CryptoAuthorizationPolicyDimension[];
}

export const CRYPTO_AUTHORIZATION_CONSEQUENCE_PROFILES: Record<
  CryptoAuthorizationConsequenceKind,
  CryptoAuthorizationConsequenceProfile
> = {
  transfer: {
    kind: 'transfer',
    label: 'Value Transfer',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R3',
    requiredPolicyDimensions: ['chain', 'account', 'asset', 'counterparty', 'amount'],
  },
  approval: {
    kind: 'approval',
    label: 'Approval Or Allowance',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R4',
    requiredPolicyDimensions: ['chain', 'account', 'asset', 'spender', 'amount'],
  },
  'permission-grant': {
    kind: 'permission-grant',
    label: 'Wallet Permission Grant',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R4',
    requiredPolicyDimensions: ['chain', 'account', 'actor', 'spender', 'validity-window'],
  },
  'account-delegation': {
    kind: 'account-delegation',
    label: 'Account Delegation',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R4',
    requiredPolicyDimensions: ['chain', 'account', 'actor', 'validity-window', 'runtime-context'],
  },
  'contract-call': {
    kind: 'contract-call',
    label: 'Contract Call',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R3',
    requiredPolicyDimensions: ['chain', 'account', 'protocol', 'function-selector', 'calldata-class'],
  },
  'batch-call': {
    kind: 'batch-call',
    label: 'Batch Call',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R3',
    requiredPolicyDimensions: ['chain', 'account', 'budget', 'runtime-context'],
  },
  swap: {
    kind: 'swap',
    label: 'Swap',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R3',
    requiredPolicyDimensions: ['chain', 'account', 'asset', 'protocol', 'amount'],
  },
  bridge: {
    kind: 'bridge',
    label: 'Bridge',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R4',
    requiredPolicyDimensions: ['chain', 'account', 'asset', 'counterparty', 'amount'],
  },
  'user-operation': {
    kind: 'user-operation',
    label: 'User Operation',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R3',
    requiredPolicyDimensions: ['chain', 'account', 'actor', 'budget', 'runtime-context'],
  },
  'agent-payment': {
    kind: 'agent-payment',
    label: 'Agent Payment',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R2',
    requiredPolicyDimensions: ['chain', 'account', 'actor', 'asset', 'budget', 'cadence'],
  },
  'custody-withdrawal': {
    kind: 'custody-withdrawal',
    label: 'Custody Withdrawal',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R4',
    requiredPolicyDimensions: [
      'chain',
      'account',
      'asset',
      'counterparty',
      'amount',
      'approval-quorum',
    ],
  },
  'governance-action': {
    kind: 'governance-action',
    label: 'Governance Action',
    releaseConsequenceType: 'action',
    defaultRiskClass: 'R4',
    requiredPolicyDimensions: ['chain', 'account', 'protocol', 'actor', 'approval-quorum'],
  },
};

export interface CryptoChainReference {
  readonly namespace: CryptoChainNamespace;
  readonly chainId: string;
  readonly runtimeFamily: CryptoChainRuntimeFamily;
}

export interface CreateCryptoChainReferenceInput {
  readonly namespace: CryptoChainNamespace;
  readonly chainId: string;
  readonly runtimeFamily?: CryptoChainRuntimeFamily;
}

export interface CryptoAccountReference {
  readonly accountKind: CryptoAccountKind;
  readonly chain: CryptoChainReference;
  readonly address: string;
  readonly accountLabel: string | null;
}

export interface CreateCryptoAccountReferenceInput {
  readonly accountKind: CryptoAccountKind;
  readonly chain: CryptoChainReference;
  readonly address: string;
  readonly accountLabel?: string | null;
}

export interface CryptoAssetReference {
  readonly assetKind: CryptoAssetKind;
  readonly chain: CryptoChainReference;
  readonly assetId: string;
  readonly symbol: string | null;
  readonly decimals: number | null;
}

export interface CreateCryptoAssetReferenceInput {
  readonly assetKind: CryptoAssetKind;
  readonly chain: CryptoChainReference;
  readonly assetId: string;
  readonly symbol?: string | null;
  readonly decimals?: number | null;
}

export interface CryptoExecutionAdapterReference {
  readonly adapterKind: CryptoExecutionAdapterKind;
  readonly adapterId: string;
  readonly chain: CryptoChainReference;
  readonly accountKind: CryptoAccountKind | null;
}

export interface CreateCryptoExecutionAdapterReferenceInput {
  readonly adapterKind: CryptoExecutionAdapterKind;
  readonly adapterId: string;
  readonly chain: CryptoChainReference;
  readonly accountKind?: CryptoAccountKind | null;
}

export interface CryptoAuthorizationCoreDescriptor {
  readonly version: typeof CRYPTO_AUTHORIZATION_CORE_SPEC_VERSION;
  readonly chainNamespaces: readonly CryptoChainNamespace[];
  readonly chainRuntimeFamilies: readonly CryptoChainRuntimeFamily[];
  readonly accountKinds: readonly CryptoAccountKind[];
  readonly assetKinds: readonly CryptoAssetKind[];
  readonly consequenceKinds: readonly CryptoAuthorizationConsequenceKind[];
  readonly executionAdapterKinds: readonly CryptoExecutionAdapterKind[];
  readonly artifactKinds: readonly CryptoAuthorizationArtifactKind[];
  readonly policyDimensions: readonly CryptoAuthorizationPolicyDimension[];
  readonly releaseConsequenceTypes: readonly CryptoReleaseConsequenceType[];
  readonly riskClasses: readonly CryptoAuthorizationRiskClass[];
}

const DEFAULT_RUNTIME_BY_NAMESPACE: Record<
  CryptoChainNamespace,
  CryptoChainRuntimeFamily
> = {
  eip155: 'evm',
  solana: 'svm',
  cosmos: 'cosmwasm',
  bitcoin: 'bitcoin-script',
  other: 'non-evm',
};

function includesValue<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Crypto authorization core ${fieldName} requires a non-empty value.`);
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
    throw new Error(
      `Crypto authorization core ${fieldName} cannot be blank when provided.`,
    );
  }

  return normalized;
}

function normalizeOptionalDecimals(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Crypto authorization core decimals must be a non-negative integer.');
  }

  return value;
}

export function isCryptoChainNamespace(value: string): value is CryptoChainNamespace {
  return includesValue(CRYPTO_CHAIN_NAMESPACES, value);
}

export function isCryptoChainRuntimeFamily(
  value: string,
): value is CryptoChainRuntimeFamily {
  return includesValue(CRYPTO_CHAIN_RUNTIME_FAMILIES, value);
}

export function isCryptoAccountKind(value: string): value is CryptoAccountKind {
  return includesValue(CRYPTO_ACCOUNT_KINDS, value);
}

export function isCryptoAssetKind(value: string): value is CryptoAssetKind {
  return includesValue(CRYPTO_ASSET_KINDS, value);
}

export function isCryptoAuthorizationConsequenceKind(
  value: string,
): value is CryptoAuthorizationConsequenceKind {
  return includesValue(CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS, value);
}

export function isCryptoExecutionAdapterKind(
  value: string,
): value is CryptoExecutionAdapterKind {
  return includesValue(CRYPTO_EXECUTION_ADAPTER_KINDS, value);
}

export function isCryptoAuthorizationArtifactKind(
  value: string,
): value is CryptoAuthorizationArtifactKind {
  return includesValue(CRYPTO_AUTHORIZATION_ARTIFACT_KINDS, value);
}

export function isCryptoAuthorizationPolicyDimension(
  value: string,
): value is CryptoAuthorizationPolicyDimension {
  return includesValue(CRYPTO_AUTHORIZATION_POLICY_DIMENSIONS, value);
}

export function createCryptoChainReference(
  input: CreateCryptoChainReferenceInput,
): CryptoChainReference {
  if (!isCryptoChainNamespace(input.namespace)) {
    throw new Error(`Crypto authorization core does not support chain namespace ${input.namespace}.`);
  }

  const runtimeFamily = input.runtimeFamily ?? DEFAULT_RUNTIME_BY_NAMESPACE[input.namespace];
  if (!isCryptoChainRuntimeFamily(runtimeFamily)) {
    throw new Error(
      `Crypto authorization core does not support runtime family ${runtimeFamily}.`,
    );
  }

  return Object.freeze({
    namespace: input.namespace,
    chainId: normalizeIdentifier(input.chainId, 'chainId'),
    runtimeFamily,
  });
}

export function createCryptoAccountReference(
  input: CreateCryptoAccountReferenceInput,
): CryptoAccountReference {
  if (!isCryptoAccountKind(input.accountKind)) {
    throw new Error(`Crypto authorization core does not support account kind ${input.accountKind}.`);
  }

  return Object.freeze({
    accountKind: input.accountKind,
    chain: input.chain,
    address: normalizeIdentifier(input.address, 'address'),
    accountLabel: normalizeOptionalIdentifier(input.accountLabel, 'accountLabel'),
  });
}

export function createCryptoAssetReference(
  input: CreateCryptoAssetReferenceInput,
): CryptoAssetReference {
  if (!isCryptoAssetKind(input.assetKind)) {
    throw new Error(`Crypto authorization core does not support asset kind ${input.assetKind}.`);
  }

  return Object.freeze({
    assetKind: input.assetKind,
    chain: input.chain,
    assetId: normalizeIdentifier(input.assetId, 'assetId'),
    symbol: normalizeOptionalIdentifier(input.symbol, 'symbol'),
    decimals: normalizeOptionalDecimals(input.decimals),
  });
}

export function createCryptoExecutionAdapterReference(
  input: CreateCryptoExecutionAdapterReferenceInput,
): CryptoExecutionAdapterReference {
  if (!isCryptoExecutionAdapterKind(input.adapterKind)) {
    throw new Error(
      `Crypto authorization core does not support execution adapter kind ${input.adapterKind}.`,
    );
  }

  if (input.accountKind != null && !isCryptoAccountKind(input.accountKind)) {
    throw new Error(
      `Crypto authorization core does not support account kind ${input.accountKind}.`,
    );
  }

  return Object.freeze({
    adapterKind: input.adapterKind,
    adapterId: normalizeIdentifier(input.adapterId, 'adapterId'),
    chain: input.chain,
    accountKind: input.accountKind ?? null,
  });
}

export function cryptoChainReferenceLabel(reference: CryptoChainReference): string {
  return `${reference.namespace}:${reference.chainId} / runtime:${reference.runtimeFamily}`;
}

export function cryptoAccountReferenceLabel(reference: CryptoAccountReference): string {
  const segments = [
    cryptoChainReferenceLabel(reference.chain),
    `account:${reference.accountKind}`,
    `address:${reference.address}`,
  ];

  if (reference.accountLabel) {
    segments.push(`label:${reference.accountLabel}`);
  }

  return segments.join(' / ');
}

export function cryptoAssetReferenceLabel(reference: CryptoAssetReference): string {
  const segments = [
    cryptoChainReferenceLabel(reference.chain),
    `asset:${reference.assetKind}`,
    `id:${reference.assetId}`,
  ];

  if (reference.symbol) {
    segments.push(`symbol:${reference.symbol}`);
  }
  if (reference.decimals !== null) {
    segments.push(`decimals:${reference.decimals}`);
  }

  return segments.join(' / ');
}

export function cryptoExecutionAdapterReferenceLabel(
  reference: CryptoExecutionAdapterReference,
): string {
  const segments = [
    cryptoChainReferenceLabel(reference.chain),
    `adapter:${reference.adapterKind}`,
    `id:${reference.adapterId}`,
  ];

  if (reference.accountKind) {
    segments.push(`account:${reference.accountKind}`);
  }

  return segments.join(' / ');
}

export function cryptoAuthorizationCoreDescriptor(): CryptoAuthorizationCoreDescriptor {
  return Object.freeze({
    version: CRYPTO_AUTHORIZATION_CORE_SPEC_VERSION,
    chainNamespaces: CRYPTO_CHAIN_NAMESPACES,
    chainRuntimeFamilies: CRYPTO_CHAIN_RUNTIME_FAMILIES,
    accountKinds: CRYPTO_ACCOUNT_KINDS,
    assetKinds: CRYPTO_ASSET_KINDS,
    consequenceKinds: CRYPTO_AUTHORIZATION_CONSEQUENCE_KINDS,
    executionAdapterKinds: CRYPTO_EXECUTION_ADAPTER_KINDS,
    artifactKinds: CRYPTO_AUTHORIZATION_ARTIFACT_KINDS,
    policyDimensions: CRYPTO_AUTHORIZATION_POLICY_DIMENSIONS,
    releaseConsequenceTypes: vocabulary.CONSEQUENCE_TYPES,
    riskClasses: vocabulary.RISK_CLASSES,
  });
}
