import assert from 'node:assert/strict';
import {
  CRYPTO_AUTHORIZATION_CORE_ADAPTER_NAMESPACES,
  CRYPTO_AUTHORIZATION_CORE_EXTRACTION_CRITERIA,
  CRYPTO_AUTHORIZATION_CORE_PLATFORM_SURFACE_SPEC_VERSION,
  CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH,
  cryptoAuthorizationCore,
  cryptoAuthorizationCorePublicSurface,
} from '../src/crypto-authorization-core/index.js';

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

function testCryptoAuthorizationCorePublicSurfaceDescriptor(): void {
  const descriptor = cryptoAuthorizationCorePublicSurface();

  equal(
    descriptor.version,
    CRYPTO_AUTHORIZATION_CORE_PLATFORM_SURFACE_SPEC_VERSION,
    'crypto platform surface: descriptor exposes version',
  );
  equal(
    descriptor.packageName,
    'attestor',
    'crypto platform surface: descriptor exposes package name',
  );
  equal(
    descriptor.subpath,
    CRYPTO_AUTHORIZATION_CORE_PUBLIC_SUBPATH,
    'crypto platform surface: descriptor exposes package subpath',
  );
  deepEqual(
    descriptor.namespaceExports,
    [
      'types',
      'objectModel',
      'canonicalReferences',
      'consequenceRiskMapping',
      'eip712',
      'erc1271',
      'replayFreshness',
      'releaseDecisionBinding',
      'policyScopeBinding',
      'enforcementVerification',
      'simulation',
      'safeTransactionGuard',
      'safeModuleGuard',
      'approvalAllowance',
      'erc4337UserOperation',
      'modularAccountAdapters',
      'eip7702Delegation',
      'x402AgenticPayment',
      'custodyCosignerPolicy',
    ],
    'crypto platform surface: descriptor exposes curated namespace list',
  );
  deepEqual(
    descriptor.adapterNamespaces,
    CRYPTO_AUTHORIZATION_CORE_ADAPTER_NAMESPACES,
    'crypto platform surface: descriptor exposes adapter namespaces',
  );
  equal(
    CRYPTO_AUTHORIZATION_CORE_EXTRACTION_CRITERIA.length,
    5,
    'crypto platform surface: extraction criteria are enumerated',
  );
  equal(
    CRYPTO_AUTHORIZATION_CORE_EXTRACTION_CRITERIA.filter(
      (criterion) => criterion.status === 'ready',
    ).length,
    4,
    'crypto platform surface: four extraction criteria are ready',
  );
  ok(
    descriptor.extractionCriteria.some((criterion) => criterion.status === 'pending'),
    'crypto platform surface: standalone service extraction remains pending',
  );
}

function testCryptoAuthorizationCoreBaseNamespaces(): void {
  equal(
    cryptoAuthorizationCore.types.CRYPTO_AUTHORIZATION_CORE_SPEC_VERSION,
    'attestor.crypto-authorization-core.v1',
    'crypto platform surface: vocabulary namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.objectModel.CRYPTO_AUTHORIZATION_OBJECT_MODEL_SPEC_VERSION,
    'attestor.crypto-authorization-object-model.v1',
    'crypto platform surface: object-model namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.canonicalReferences.CRYPTO_CANONICAL_REFERENCES_SPEC_VERSION,
    'attestor.crypto-canonical-references.v1',
    'crypto platform surface: canonical-reference namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.consequenceRiskMapping.CRYPTO_CONSEQUENCE_RISK_MAPPING_SPEC_VERSION,
    'attestor.crypto-consequence-risk-mapping.v1',
    'crypto platform surface: risk-mapping namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.eip712.CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION,
    'attestor.crypto-eip712-authorization-envelope.v1',
    'crypto platform surface: EIP-712 namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.erc1271.CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION,
    'attestor.crypto-erc1271-validation-projection.v1',
    'crypto platform surface: ERC-1271 namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.replayFreshness.CRYPTO_REPLAY_FRESHNESS_RULES_SPEC_VERSION,
    'attestor.crypto-replay-freshness-rules.v1',
    'crypto platform surface: replay freshness namespace is bound',
  );
}

function testCryptoAuthorizationCoreBindingNamespaces(): void {
  equal(
    cryptoAuthorizationCore.releaseDecisionBinding.CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION,
    'attestor.crypto-release-decision-binding.v1',
    'crypto platform surface: release binding namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.policyScopeBinding.CRYPTO_POLICY_CONTROL_PLANE_SCOPE_BINDING_SPEC_VERSION,
    'attestor.crypto-policy-control-plane-scope-binding.v1',
    'crypto platform surface: policy scope binding namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.enforcementVerification.CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION,
    'attestor.crypto-enforcement-verification.v1',
    'crypto platform surface: enforcement verification namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.simulation.CRYPTO_AUTHORIZATION_SIMULATION_SPEC_VERSION,
    'attestor.crypto-authorization-simulation.v1',
    'crypto platform surface: simulation namespace is bound',
  );
}

function testCryptoAuthorizationCoreAdapterNamespaces(): void {
  equal(
    cryptoAuthorizationCore.safeTransactionGuard.SAFE_TRANSACTION_GUARD_ADAPTER_SPEC_VERSION,
    'attestor.crypto-safe-transaction-guard-adapter.v1',
    'crypto platform surface: Safe transaction guard namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.safeModuleGuard.SAFE_MODULE_GUARD_ADAPTER_SPEC_VERSION,
    'attestor.crypto-safe-module-guard-adapter.v1',
    'crypto platform surface: Safe module guard namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.approvalAllowance.CRYPTO_APPROVAL_ALLOWANCE_CONSEQUENCE_SPEC_VERSION,
    'attestor.crypto-approval-allowance-consequence.v1',
    'crypto platform surface: approval allowance namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.erc4337UserOperation.ERC4337_USER_OPERATION_ADAPTER_SPEC_VERSION,
    'attestor.crypto-erc4337-user-operation-adapter.v1',
    'crypto platform surface: ERC-4337 namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.modularAccountAdapters.MODULAR_ACCOUNT_ADAPTER_SPEC_VERSION,
    'attestor.crypto-modular-account-adapters.v1',
    'crypto platform surface: modular account namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.eip7702Delegation.EIP7702_DELEGATION_ADAPTER_SPEC_VERSION,
    'attestor.crypto-eip7702-delegation-adapter.v1',
    'crypto platform surface: EIP-7702 namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.x402AgenticPayment.X402_AGENTIC_PAYMENT_ADAPTER_SPEC_VERSION,
    'attestor.crypto-x402-agentic-payment-adapter.v1',
    'crypto platform surface: x402 namespace is bound',
  );
  equal(
    cryptoAuthorizationCore.custodyCosignerPolicy.CUSTODY_COSIGNER_POLICY_ADAPTER_SPEC_VERSION,
    'attestor.crypto-custody-cosigner-policy-adapter.v1',
    'crypto platform surface: custody co-signer namespace is bound',
  );
}

function testCryptoAuthorizationCoreDescriptorFunctions(): void {
  equal(
    cryptoAuthorizationCore.types.cryptoAuthorizationCoreDescriptor().version,
    'attestor.crypto-authorization-core.v1',
    'crypto platform surface: vocabulary descriptor is callable',
  );
  equal(
    cryptoAuthorizationCore.objectModel.cryptoAuthorizationObjectModelDescriptor().version,
    'attestor.crypto-authorization-object-model.v1',
    'crypto platform surface: object-model descriptor is callable',
  );
  equal(
    cryptoAuthorizationCore.enforcementVerification
      .cryptoEnforcementVerificationDescriptor()
      .version,
    'attestor.crypto-enforcement-verification.v1',
    'crypto platform surface: enforcement descriptor is callable',
  );
  equal(
    cryptoAuthorizationCore.custodyCosignerPolicy
      .custodyCosignerPolicyAdapterDescriptor()
      .adapterKind,
    'custody-cosigner',
    'crypto platform surface: custody adapter descriptor is callable',
  );
}

testCryptoAuthorizationCorePublicSurfaceDescriptor();
testCryptoAuthorizationCoreBaseNamespaces();
testCryptoAuthorizationCoreBindingNamespaces();
testCryptoAuthorizationCoreAdapterNamespaces();
testCryptoAuthorizationCoreDescriptorFunctions();

console.log(`Crypto authorization core platform surface tests: ${passed} passed, 0 failed`);
