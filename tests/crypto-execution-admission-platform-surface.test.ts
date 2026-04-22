import assert from 'node:assert/strict';
import {
  CRYPTO_EXECUTION_ADMISSION_EXTRACTION_CRITERIA,
  CRYPTO_EXECUTION_ADMISSION_INTEGRATION_NAMESPACES,
  CRYPTO_EXECUTION_ADMISSION_NAMESPACE_EXPORTS,
  CRYPTO_EXECUTION_ADMISSION_PLATFORM_SURFACE_SPEC_VERSION,
  CRYPTO_EXECUTION_ADMISSION_PROOF_NAMESPACES,
  CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
  cryptoExecutionAdmission,
  cryptoExecutionAdmissionPublicSurface,
} from '../src/crypto-execution-admission/index.js';

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

function testCryptoExecutionAdmissionPublicSurfaceDescriptor(): void {
  const descriptor = cryptoExecutionAdmissionPublicSurface();

  equal(
    descriptor.version,
    CRYPTO_EXECUTION_ADMISSION_PLATFORM_SURFACE_SPEC_VERSION,
    'crypto execution admission platform surface: descriptor exposes version',
  );
  equal(
    descriptor.packageName,
    'attestor',
    'crypto execution admission platform surface: descriptor exposes package name',
  );
  equal(
    descriptor.subpath,
    CRYPTO_EXECUTION_ADMISSION_PUBLIC_SUBPATH,
    'crypto execution admission platform surface: descriptor exposes package subpath',
  );
  deepEqual(
    descriptor.namespaceExports,
    CRYPTO_EXECUTION_ADMISSION_NAMESPACE_EXPORTS,
    'crypto execution admission platform surface: descriptor exposes curated namespace list',
  );
  deepEqual(
    descriptor.integrationNamespaces,
    CRYPTO_EXECUTION_ADMISSION_INTEGRATION_NAMESPACES,
    'crypto execution admission platform surface: descriptor exposes integration namespaces',
  );
  deepEqual(
    descriptor.proofNamespaces,
    CRYPTO_EXECUTION_ADMISSION_PROOF_NAMESPACES,
    'crypto execution admission platform surface: descriptor exposes proof namespaces',
  );
  ok(
    descriptor.fixturePaths.includes(
      'fixtures/crypto-execution-admission/conformance-fixtures.v1.json',
    ),
    'crypto execution admission platform surface: fixture path is documented',
  );
  ok(
    descriptor.fixturePaths.includes(
      'fixtures/crypto-execution-admission/conformance-fixtures.schema.json',
    ),
    'crypto execution admission platform surface: schema path is documented',
  );
  equal(
    CRYPTO_EXECUTION_ADMISSION_EXTRACTION_CRITERIA.length,
    5,
    'crypto execution admission platform surface: extraction criteria are enumerated',
  );
  equal(
    CRYPTO_EXECUTION_ADMISSION_EXTRACTION_CRITERIA.filter(
      (criterion) => criterion.status === 'ready',
    ).length,
    4,
    'crypto execution admission platform surface: four extraction criteria are ready',
  );
  ok(
    descriptor.extractionCriteria.some((criterion) => criterion.status === 'pending'),
    'crypto execution admission platform surface: standalone service extraction remains pending',
  );
}

function testCryptoExecutionAdmissionNamespaceBindings(): void {
  equal(
    cryptoExecutionAdmission.planner.CRYPTO_EXECUTION_ADMISSION_SPEC_VERSION,
    'attestor.crypto-execution-admission.v1',
    'crypto execution admission platform surface: planner namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.walletRpc.WALLET_RPC_ADMISSION_HANDOFF_SPEC_VERSION,
    'attestor.crypto-wallet-rpc-admission-handoff.v1',
    'crypto execution admission platform surface: wallet RPC namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.safeGuard.SAFE_GUARD_ADMISSION_RECEIPT_SPEC_VERSION,
    'attestor.crypto-safe-guard-admission-receipt.v1',
    'crypto execution admission platform surface: Safe guard namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.erc4337Bundler
      .ERC4337_BUNDLER_ADMISSION_HANDOFF_SPEC_VERSION,
    'attestor.crypto-erc4337-bundler-admission-handoff.v1',
    'crypto execution admission platform surface: ERC-4337 namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.modularAccount.MODULAR_ACCOUNT_ADMISSION_HANDOFF_SPEC_VERSION,
    'attestor.crypto-modular-account-admission-handoff.v1',
    'crypto execution admission platform surface: modular account namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.delegatedEoa.DELEGATED_EOA_ADMISSION_HANDOFF_SPEC_VERSION,
    'attestor.crypto-delegated-eoa-admission-handoff.v1',
    'crypto execution admission platform surface: delegated EOA namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.x402ResourceServer
      .X402_RESOURCE_SERVER_ADMISSION_MIDDLEWARE_SPEC_VERSION,
    'attestor.crypto-x402-resource-server-admission-middleware.v1',
    'crypto execution admission platform surface: x402 namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.custodyPolicyCallback
      .CUSTODY_POLICY_ADMISSION_CALLBACK_SPEC_VERSION,
    'attestor.crypto-custody-policy-admission-callback.v1',
    'crypto execution admission platform surface: custody callback namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.intentSolver.INTENT_SOLVER_ADMISSION_HANDOFF_SPEC_VERSION,
    'attestor.crypto-intent-solver-admission-handoff.v1',
    'crypto execution admission platform surface: intent solver namespace is bound',
  );
}

function testCryptoExecutionAdmissionProofNamespaces(): void {
  equal(
    cryptoExecutionAdmission.telemetryReceipts.CRYPTO_ADMISSION_TELEMETRY_SPEC_VERSION,
    'attestor.crypto-execution-admission-telemetry.v1',
    'crypto execution admission platform surface: telemetry namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.telemetryReceipts.CRYPTO_ADMISSION_RECEIPT_SPEC_VERSION,
    'attestor.crypto-execution-admission-receipt.v1',
    'crypto execution admission platform surface: receipt namespace is bound',
  );
  equal(
    cryptoExecutionAdmission.conformanceFixtures
      .CRYPTO_ADMISSION_CONFORMANCE_FIXTURES_SPEC_VERSION,
    'attestor.crypto-execution-admission-conformance-fixtures.v1',
    'crypto execution admission platform surface: conformance namespace is bound',
  );
}

function testCryptoExecutionAdmissionDescriptorFunctions(): void {
  equal(
    cryptoExecutionAdmission.planner.cryptoExecutionAdmissionDescriptor().subpath,
    'attestor/crypto-execution-admission',
    'crypto execution admission platform surface: planner descriptor is callable',
  );
  ok(
    cryptoExecutionAdmission.walletRpc
      .walletRpcAdmissionDescriptor()
      .methods.includes('wallet_sendCalls'),
    'crypto execution admission platform surface: wallet descriptor is callable',
  );
  ok(
    cryptoExecutionAdmission.erc4337Bundler
      .erc4337BundlerAdmissionDescriptor()
      .methods.includes('eth_sendUserOperation'),
    'crypto execution admission platform surface: bundler descriptor is callable',
  );
  ok(
    cryptoExecutionAdmission.conformanceFixtures
      .cryptoAdmissionConformanceDescriptor()
      .runtimeChecks.includes('signed-receipt-verification'),
    'crypto execution admission platform surface: conformance descriptor is callable',
  );
}

testCryptoExecutionAdmissionPublicSurfaceDescriptor();
testCryptoExecutionAdmissionNamespaceBindings();
testCryptoExecutionAdmissionProofNamespaces();
testCryptoExecutionAdmissionDescriptorFunctions();

console.log(`Crypto execution admission platform surface tests: ${passed} passed, 0 failed`);
