import * as types from './types.js';
import * as objectModel from './object-model.js';
import * as canonicalReferences from './canonical-references.js';
import * as consequenceRiskMapping from './consequence-risk-mapping.js';
import * as eip712 from './eip712-authorization-envelope.js';
import * as erc1271 from './erc1271-validation-projection.js';
import * as replayFreshness from './replay-freshness-rules.js';
import * as releaseDecisionBinding from './release-decision-binding.js';
import * as policyScopeBinding from './policy-control-plane-scope-binding.js';
import * as enforcementVerification from './enforcement-plane-verification.js';
import * as simulation from './authorization-simulation.js';
import * as safeTransactionGuard from './safe-transaction-guard-adapter.js';
import * as safeModuleGuard from './safe-module-guard-adapter.js';
import * as approvalAllowance from './approval-allowance-consequence.js';
import * as erc4337UserOperation from './erc4337-user-operation-adapter.js';
import * as modularAccountAdapters from './modular-account-adapters.js';
import * as eip7702Delegation from './eip7702-delegation-adapter.js';
import * as x402AgenticPayment from './x402-agentic-payment-adapter.js';
import * as custodyCosignerPolicy from './custody-cosigner-policy-adapter.js';

export {
  types,
  objectModel,
  canonicalReferences,
  consequenceRiskMapping,
  eip712,
  erc1271,
  replayFreshness,
  releaseDecisionBinding,
  policyScopeBinding,
  enforcementVerification,
  simulation,
  safeTransactionGuard,
  safeModuleGuard,
  approvalAllowance,
  erc4337UserOperation,
  modularAccountAdapters,
  eip7702Delegation,
  x402AgenticPayment,
  custodyCosignerPolicy,
};

/**
 * Curated public platform surface for the Attestor crypto authorization core.
 *
 * This exposes the stable programmable-money authorization substrate through
 * one package subpath while keeping adapter internals and file layout private.
 */

export const CRYPTO_AUTHORIZATION_CORE_PLATFORM_SURFACE_SPEC_VERSION =
  'attestor.crypto-authorization-core-platform.v1';
export const CRYPTO_AUTHORIZATION_CORE_PACKAGE_NAME = 'attestor';
export const CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH =
  'attestor/crypto-authorization-core';

export type CryptoAuthorizationCoreExtractionStatus = 'ready' | 'pending';

export interface CryptoAuthorizationCoreExtractionCriterion {
  readonly id: string;
  readonly status: CryptoAuthorizationCoreExtractionStatus;
  readonly description: string;
}

export interface CryptoAuthorizationCorePublicSurfaceDescriptor {
  readonly version: typeof CRYPTO_AUTHORIZATION_CORE_PLATFORM_SURFACE_SPEC_VERSION;
  readonly packageName: typeof CRYPTO_AUTHORIZATION_CORE_PACKAGE_NAME;
  readonly subpath: typeof CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH;
  readonly namespaceExports: readonly string[];
  readonly adapterNamespaces: readonly string[];
  readonly extractionCriteria: readonly CryptoAuthorizationCoreExtractionCriterion[];
}

export const CRYPTO_AUTHORIZATION_CORE_EXTRACTION_CRITERIA = Object.freeze([
  Object.freeze({
    id: 'stable-authorization-language',
    status: 'ready',
    description:
      'Chain, account, asset, consequence, artifact, adapter, intent, decision, receipt, and projection objects are versioned and stable enough for package consumers.',
  }),
  Object.freeze({
    id: 'stable-proof-and-verification-bindings',
    status: 'ready',
    description:
      'Release-layer, policy-control-plane, enforcement-plane, EIP-712, ERC-1271, replay, expiry, and revocation bindings are explicit and versioned.',
  }),
  Object.freeze({
    id: 'multiple-execution-adapters-proven',
    status: 'ready',
    description:
      'Safe guards, approval/allowance, ERC-4337, ERC-7579, ERC-6900, EIP-7702, x402, and custody co-signer paths reuse the same authorization core.',
  }),
  Object.freeze({
    id: 'package-boundary-proven',
    status: 'ready',
    description:
      'The crypto authorization core is exported through one stable package subpath with package-boundary probes that block internal deep imports.',
  }),
  Object.freeze({
    id: 'justify-separate-crypto-service',
    status: 'pending',
    description:
      'A standalone deployable crypto authorization service should wait until chain-adjacent latency, customer-operated custody, or isolation requirements clearly justify a separate runtime boundary.',
  }),
] satisfies readonly CryptoAuthorizationCoreExtractionCriterion[]);

export const CRYPTO_AUTHORIZATION_CORE_ADAPTER_NAMESPACES = Object.freeze([
  'safeTransactionGuard',
  'safeModuleGuard',
  'approvalAllowance',
  'erc4337UserOperation',
  'modularAccountAdapters',
  'eip7702Delegation',
  'x402AgenticPayment',
  'custodyCosignerPolicy',
] as const);

export const cryptoAuthorizationCore = Object.freeze({
  types,
  objectModel,
  canonicalReferences,
  consequenceRiskMapping,
  eip712,
  erc1271,
  replayFreshness,
  releaseDecisionBinding,
  policyScopeBinding,
  enforcementVerification,
  simulation,
  safeTransactionGuard,
  safeModuleGuard,
  approvalAllowance,
  erc4337UserOperation,
  modularAccountAdapters,
  eip7702Delegation,
  x402AgenticPayment,
  custodyCosignerPolicy,
});

export type CryptoAuthorizationCore = typeof cryptoAuthorizationCore;
export type CryptoAuthorizationIntent = objectModel.CryptoAuthorizationIntent;
export type CryptoAuthorizationDecision = objectModel.CryptoAuthorizationDecision;
export type CryptoAuthorizationReceipt = objectModel.CryptoAuthorizationReceipt;
export type CryptoExecutionProjection = objectModel.CryptoExecutionProjection;
export type CryptoCanonicalReferenceBundle =
  canonicalReferences.CryptoCanonicalReferenceBundle;
export type CryptoConsequenceRiskAssessment =
  consequenceRiskMapping.CryptoConsequenceRiskAssessment;
export type CryptoReleaseDecisionBinding =
  releaseDecisionBinding.CryptoReleaseDecisionBinding;
export type CryptoPolicyControlPlaneScopeBinding =
  policyScopeBinding.CryptoPolicyControlPlaneScopeBinding;
export type CryptoEnforcementVerificationBinding =
  enforcementVerification.CryptoEnforcementVerificationBinding;
export type CryptoAuthorizationSimulationResult =
  simulation.CryptoAuthorizationSimulationResult;
export type SafeTransactionGuardPreflight =
  safeTransactionGuard.SafeTransactionGuardPreflight;
export type SafeModuleGuardPreflight =
  safeModuleGuard.SafeModuleGuardPreflight;
export type CryptoApprovalAllowanceConsequence =
  approvalAllowance.CryptoApprovalAllowanceConsequence;
export type Erc4337UserOperationPreflight =
  erc4337UserOperation.Erc4337UserOperationPreflight;
export type ModularAccountAdapterPreflight =
  modularAccountAdapters.ModularAccountAdapterPreflight;
export type Eip7702DelegationPreflight =
  eip7702Delegation.Eip7702DelegationPreflight;
export type X402AgenticPaymentPreflight =
  x402AgenticPayment.X402AgenticPaymentPreflight;
export type CustodyCosignerPolicyPreflight =
  custodyCosignerPolicy.CustodyCosignerPolicyPreflight;

export function cryptoAuthorizationCorePublicSurface():
CryptoAuthorizationCorePublicSurfaceDescriptor {
  return Object.freeze({
    version: CRYPTO_AUTHORIZATION_CORE_PLATFORM_SURFACE_SPEC_VERSION,
    packageName: CRYPTO_AUTHORIZATION_CORE_PACKAGE_NAME,
    subpath: CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH,
    namespaceExports: Object.freeze(Object.keys(cryptoAuthorizationCore)),
    adapterNamespaces: CRYPTO_AUTHORIZATION_CORE_ADAPTER_NAMESPACES,
    extractionCriteria: CRYPTO_AUTHORIZATION_CORE_EXTRACTION_CRITERIA,
  });
}
