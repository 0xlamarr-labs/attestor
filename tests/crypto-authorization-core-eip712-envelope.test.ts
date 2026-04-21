import { strict as assert } from 'node:assert';
import {
  CRYPTO_EIP191_STRUCTURED_DATA_PREFIX,
  CRYPTO_EIP712_AUTHORIZATION_DOMAIN_FIELDS,
  CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION,
  CRYPTO_EIP712_AUTHORIZATION_MESSAGE_FIELDS,
  CRYPTO_EIP712_COVERAGE_TYPE,
  CRYPTO_EIP712_DIGEST_COVERAGE_FIELDS,
  CRYPTO_EIP712_DOMAIN_NAME,
  CRYPTO_EIP712_DOMAIN_VERSION,
  CRYPTO_EIP712_PRIMARY_TYPE,
  createCryptoEip712AuthorizationEnvelope,
  cryptoEip712AuthorizationEnvelopeDescriptor,
  cryptoEip712AuthorizationEnvelopeLabel,
} from '../src/crypto-authorization-core/eip712-authorization-envelope.js';
import {
  CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
  createCryptoAuthorizationActor,
  createCryptoAuthorizationConstraints,
  createCryptoAuthorizationDecision,
  createCryptoAuthorizationIntent,
  createCryptoAuthorizationPolicyScope,
  createCryptoExecutionTarget,
  createCryptoSignerAuthority,
} from '../src/crypto-authorization-core/object-model.js';
import {
  createCryptoCanonicalAssetReference,
  createCryptoCanonicalCounterpartyReference,
  createCryptoCanonicalReferenceBundle,
} from '../src/crypto-authorization-core/canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
} from '../src/crypto-authorization-core/consequence-risk-mapping.js';
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
  return createCryptoAccountReference({
    accountKind: 'safe',
    chain: fixtureChain(),
    address: '0x1111111111111111111111111111111111111111',
    accountLabel: 'Treasury Safe',
  });
}

function fixtureAsset() {
  return createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain: fixtureChain(),
    assetId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    decimals: 6,
  });
}

function fixtureIntent() {
  const chain = fixtureChain();
  const account = fixtureAccount();
  const asset = fixtureAsset();
  const requester = createCryptoAuthorizationActor({
    actorKind: 'agent',
    actorId: 'agent:treasury',
    authorityRef: 'authority:treasury-policy',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'bridge',
    chain,
    targetId: 'bridge:canonical-usdc',
    address: '0x2222222222222222222222222222222222222222',
    counterparty: 'bridge:canonical-usdc',
    protocol: 'bridge-protocol',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-bridge',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: [
      'chain',
      'account',
      'asset',
      'counterparty',
      'amount',
      'protocol',
      'risk-tier',
      'approval-quorum',
      'runtime-context',
    ],
    environment: 'prod',
    tenantId: 'tenant-1',
    policyPackRef: 'policy-pack:crypto:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T08:00:00.000Z',
    validUntil: '2026-04-21T08:05:00.000Z',
    nonce: 'bridge:nonce:7',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    maxAmount: '250000.00',
  });

  return createCryptoAuthorizationIntent({
    intentId: 'intent-eip712-001',
    requestedAt: '2026-04-21T08:00:01.000Z',
    requester,
    account,
    consequenceKind: 'bridge',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind: 'safe-guard',
    evidenceRefs: ['evidence:release:001', 'policy:activation:001'],
  });
}

function fixtureSigner() {
  return createCryptoSignerAuthority({
    authorityKind: 'smart-account',
    authorityId: 'safe:treasury',
    validationMode: 'erc-1271-contract',
    address: '0x1111111111111111111111111111111111111111',
  });
}

function fixtureEnvelope() {
  const intent = fixtureIntent();
  const counterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'bridge',
    counterpartyId: 'bridge:canonical-usdc',
    chain: fixtureChain(),
  });
  const asset = createCryptoCanonicalAssetReference({
    asset: fixtureAsset(),
    assetNamespace: 'erc20',
  });
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain: fixtureChain(),
    account: fixtureAccount(),
    asset,
    counterparty,
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'bridge',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '250000.00',
      normalizedUsd: '250000.00',
    },
    counterparty,
    context: {
      signals: ['cross-chain'],
    },
  });
  const signer = fixtureSigner();
  const decision = createCryptoAuthorizationDecision({
    decisionId: 'decision-eip712-001',
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    reasonCodes: ['policy-allow', 'bridge-reviewed'],
    signerAuthorities: [signer],
  });

  return createCryptoEip712AuthorizationEnvelope({
    envelopeId: 'envelope-eip712-001',
    receiptId: 'receipt-eip712-001',
    intent,
    decision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: '0x9999999999999999999999999999999999999999',
  });
}

function testDescriptor(): void {
  const descriptor = cryptoEip712AuthorizationEnvelopeDescriptor();

  equal(
    descriptor.version,
    CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION,
    'Crypto EIP-712 envelope: descriptor exposes version',
  );
  equal(descriptor.domainName, CRYPTO_EIP712_DOMAIN_NAME, 'Crypto EIP-712 envelope: descriptor exposes domain name');
  equal(descriptor.domainVersion, CRYPTO_EIP712_DOMAIN_VERSION, 'Crypto EIP-712 envelope: descriptor exposes domain version');
  equal(descriptor.primaryType, CRYPTO_EIP712_PRIMARY_TYPE, 'Crypto EIP-712 envelope: descriptor exposes primary type');
  equal(descriptor.eip191Prefix, CRYPTO_EIP191_STRUCTURED_DATA_PREFIX, 'Crypto EIP-712 envelope: descriptor exposes EIP-191 prefix');
  deepEqual(descriptor.domainFields, CRYPTO_EIP712_AUTHORIZATION_DOMAIN_FIELDS, 'Crypto EIP-712 envelope: descriptor exposes domain fields');
  deepEqual(descriptor.messageFields, CRYPTO_EIP712_AUTHORIZATION_MESSAGE_FIELDS, 'Crypto EIP-712 envelope: descriptor exposes message fields');
  deepEqual(descriptor.coverageFields, CRYPTO_EIP712_DIGEST_COVERAGE_FIELDS, 'Crypto EIP-712 envelope: descriptor exposes coverage fields');
  ok(descriptor.standards.includes('EIP-712'), 'Crypto EIP-712 envelope: descriptor names EIP-712');
  ok(descriptor.standards.includes('ERC-5267'), 'Crypto EIP-712 envelope: descriptor names ERC-5267 domain retrieval');
}

function testTypedDataShape(): void {
  const envelope = fixtureEnvelope();
  const typedData = envelope.typedData;

  equal(envelope.version, CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION, 'Crypto EIP-712 envelope: envelope carries version');
  equal(envelope.rpcMethod, 'eth_signTypedData', 'Crypto EIP-712 envelope: RPC method is eth_signTypedData');
  equal(envelope.eip191Prefix, '0x1901', 'Crypto EIP-712 envelope: structured-data prefix is exposed');
  equal(typedData.primaryType, 'AttestorCryptoAuthorization', 'Crypto EIP-712 envelope: primary type is stable');
  deepEqual(typedData.types.EIP712Domain, CRYPTO_EIP712_AUTHORIZATION_DOMAIN_FIELDS, 'Crypto EIP-712 envelope: typed data includes domain fields');
  deepEqual(typedData.types.AttestorDigestCoverage, CRYPTO_EIP712_DIGEST_COVERAGE_FIELDS, 'Crypto EIP-712 envelope: typed data includes coverage fields');
  deepEqual(typedData.types.AttestorCryptoAuthorization, CRYPTO_EIP712_AUTHORIZATION_MESSAGE_FIELDS, 'Crypto EIP-712 envelope: typed data includes message fields');
  equal(typedData.domain.name, 'Attestor Crypto Authorization', 'Crypto EIP-712 envelope: default domain name is stable');
  equal(typedData.domain.version, '1', 'Crypto EIP-712 envelope: default domain version is stable');
  equal(typedData.domain.chainId, 1, 'Crypto EIP-712 envelope: EIP-155 chain id is projected into domain');
  equal(typedData.domain.verifyingContract, '0x9999999999999999999999999999999999999999', 'Crypto EIP-712 envelope: verifying contract is normalized');
  ok(/^0x[0-9a-f]{64}$/.test(typedData.domain.salt), 'Crypto EIP-712 envelope: domain salt is bytes32');
}

function testMessageBindingsAndCoverage(): void {
  const envelope = fixtureEnvelope();
  const message = envelope.typedData.message;

  equal(message.version, CRYPTO_EIP712_AUTHORIZATION_ENVELOPE_SPEC_VERSION, 'Crypto EIP-712 envelope: message carries version');
  equal(message.envelopeId, 'envelope-eip712-001', 'Crypto EIP-712 envelope: message binds envelope id');
  equal(message.intentId, 'intent-eip712-001', 'Crypto EIP-712 envelope: message binds intent id');
  equal(message.decisionId, 'decision-eip712-001', 'Crypto EIP-712 envelope: message binds decision id');
  equal(message.receiptId, 'receipt-eip712-001', 'Crypto EIP-712 envelope: message binds receipt id');
  equal(message.chainId, 1, 'Crypto EIP-712 envelope: message binds chain id');
  equal(message.caip2ChainId, 'eip155:1', 'Crypto EIP-712 envelope: message binds CAIP-2 chain id');
  equal(message.account, '0x1111111111111111111111111111111111111111', 'Crypto EIP-712 envelope: message binds account address');
  equal(message.signer, '0x1111111111111111111111111111111111111111', 'Crypto EIP-712 envelope: message binds signer address');
  equal(message.validAfter, 1776758400, 'Crypto EIP-712 envelope: validAfter is epoch seconds');
  equal(message.validUntil, 1776758700, 'Crypto EIP-712 envelope: validUntil is epoch seconds');
  equal(message.nonce, 'bridge:nonce:7', 'Crypto EIP-712 envelope: message binds nonce');
  equal(message.consequenceKind, 'bridge', 'Crypto EIP-712 envelope: message binds consequence');
  equal(message.riskClass, 'R4', 'Crypto EIP-712 envelope: message binds risk class');
  ok(/^0x[0-9a-f]{64}$/.test(message.coverage.referenceBundleDigest), 'Crypto EIP-712 envelope: reference coverage is bytes32');
  ok(/^0x[0-9a-f]{64}$/.test(message.coverage.intentDigest), 'Crypto EIP-712 envelope: intent coverage is bytes32');
  ok(/^0x[0-9a-f]{64}$/.test(message.coverage.decisionDigest), 'Crypto EIP-712 envelope: decision coverage is bytes32');
  ok(/^0x[0-9a-f]{64}$/.test(message.coverage.riskAssessmentDigest), 'Crypto EIP-712 envelope: risk coverage is bytes32');
  ok(/^0x[0-9a-f]{64}$/.test(message.coverage.evidenceDigest), 'Crypto EIP-712 envelope: evidence coverage is bytes32');
}

function testSignerChainAndDomainIntrospection(): void {
  const envelope = fixtureEnvelope();

  equal(envelope.signerBinding.signerAddress, '0x1111111111111111111111111111111111111111', 'Crypto EIP-712 envelope: signer binding carries signer');
  equal(envelope.signerBinding.signerAuthorityId, 'safe:treasury', 'Crypto EIP-712 envelope: signer binding carries authority id');
  equal(envelope.signerBinding.signerAuthorityKind, 'smart-account', 'Crypto EIP-712 envelope: signer binding carries authority kind');
  equal(envelope.signerBinding.signatureValidationMode, 'erc-1271-contract', 'Crypto EIP-712 envelope: signer binding carries validation mode');
  equal(envelope.chainBinding.caip2ChainId, 'eip155:1', 'Crypto EIP-712 envelope: chain binding carries CAIP-2 id');
  equal(envelope.chainBinding.eip155ChainId, '1', 'Crypto EIP-712 envelope: chain binding carries EIP-155 id');
  equal(envelope.domainIntrospection.erc5267FieldsBitmap, '0x1f', 'Crypto EIP-712 envelope: ERC-5267 bitmap covers all domain fields');
  deepEqual(
    envelope.domainIntrospection.fields,
    ['name', 'version', 'chainId', 'verifyingContract', 'salt'],
    'Crypto EIP-712 envelope: domain introspection fields are explicit',
  );
  deepEqual(envelope.domainIntrospection.extensions, [], 'Crypto EIP-712 envelope: no domain extensions are required yet');
}

function testCustomDomainAndLargeChain(): void {
  const chain = createCryptoChainReference({
    namespace: 'eip155',
    chainId: '9007199254740993',
  });
  const account = createCryptoAccountReference({
    accountKind: 'eoa',
    chain,
    address: '0x3333333333333333333333333333333333333333',
  });
  const target = createCryptoExecutionTarget({
    targetKind: 'payee',
    chain,
    targetId: 'vendor',
    address: '0x4444444444444444444444444444444444444444',
  });
  const requester = createCryptoAuthorizationActor({
    actorKind: 'human',
    actorId: 'alice',
  });
  const scope = createCryptoAuthorizationPolicyScope({
    dimensions: ['chain', 'account', 'asset', 'counterparty', 'amount', 'risk-tier'],
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T08:00:00.000Z',
    validUntil: '2026-04-21T08:01:00.000Z',
    nonce: 'transfer:1',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: ['attestor-release-receipt', 'eip-712-authorization'],
  });
  const asset = createCryptoAssetReference({
    assetKind: 'stablecoin',
    chain,
    assetId: '0x5555555555555555555555555555555555555555',
    symbol: 'USDC',
    decimals: 6,
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-large-chain',
    requestedAt: '2026-04-21T08:00:00.000Z',
    requester,
    account,
    consequenceKind: 'transfer',
    target,
    asset,
    policyScope: scope,
    constraints,
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: 'eoa-signer',
    authorityId: 'alice',
    validationMode: 'eip-712-eoa',
    address: '0x3333333333333333333333333333333333333333',
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'transfer',
    account,
    asset,
    amount: {
      assetAmount: '100',
      normalizedUsd: '100',
    },
  });
  const decision = createCryptoAuthorizationDecision({
    decisionId: 'decision-large-chain',
    intent,
    decidedAt: '2026-04-21T08:00:01.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    signerAuthorities: [signer],
  });
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain,
    account,
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: 'envelope-large-chain',
    receiptId: 'receipt-large-chain',
    intent,
    decision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: '0x6666666666666666666666666666666666666666',
    domainName: 'Custom Attestor Domain',
    domainVersion: '2',
    domainSalt: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });

  equal(envelope.typedData.domain.name, 'Custom Attestor Domain', 'Crypto EIP-712 envelope: custom domain name is preserved');
  equal(envelope.typedData.domain.version, '2', 'Crypto EIP-712 envelope: custom domain version is preserved');
  equal(envelope.typedData.domain.chainId, '9007199254740993', 'Crypto EIP-712 envelope: large chain id remains a decimal string');
  equal(envelope.typedData.domain.salt, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Crypto EIP-712 envelope: sha256 salt converts to bytes32');
}

function testDigestAndLabelAreStable(): void {
  const first = fixtureEnvelope();
  const second = fixtureEnvelope();

  equal(first.digest, second.digest, 'Crypto EIP-712 envelope: digest is deterministic');
  ok(first.digest.startsWith('sha256:'), 'Crypto EIP-712 envelope: digest uses sha256');
  equal(
    cryptoEip712AuthorizationEnvelopeLabel(first),
    'envelope:envelope-eip712-001 / chain:eip155:1 / account:0x1111111111111111111111111111111111111111 / signer:0x1111111111111111111111111111111111111111 / risk:R4 / nonce:bridge:nonce:7',
    'Crypto EIP-712 envelope: label is stable',
  );
}

function testInvalidInputsReject(): void {
  const intent = fixtureIntent();
  const signer = fixtureSigner();
  const counterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'bridge',
    counterpartyId: 'bridge:canonical-usdc',
    chain: fixtureChain(),
  });
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain: fixtureChain(),
    account: fixtureAccount(),
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'bridge',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '250000.00',
      normalizedUsd: '250000.00',
    },
    counterparty,
    context: {
      signals: ['cross-chain'],
    },
  });
  const allowDecision = createCryptoAuthorizationDecision({
    decisionId: 'decision-valid',
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    signerAuthorities: [signer],
  });

  assert.throws(
    () =>
      createCryptoEip712AuthorizationEnvelope({
        envelopeId: 'bad-contract',
        receiptId: 'receipt',
        intent,
        decision: allowDecision,
        signerAuthority: signer,
        riskAssessment,
        referenceBundle,
        verifyingContract: '0x123',
      }),
    /verifyingContract must be a 20-byte EVM address/i,
  );
  passed += 1;

  const deniedDecision = createCryptoAuthorizationDecision({
    decisionId: 'decision-denied',
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: 'deny',
    riskClass: riskAssessment.riskClass,
    signerAuthorities: [signer],
  });
  assert.throws(
    () =>
      createCryptoEip712AuthorizationEnvelope({
        envelopeId: 'denied',
        receiptId: 'receipt',
        intent,
        decision: deniedDecision,
        signerAuthority: signer,
        riskAssessment,
        referenceBundle,
        verifyingContract: '0x9999999999999999999999999999999999999999',
      }),
    /requires an allow decision/i,
  );
  passed += 1;

  const wrongSigner = createCryptoSignerAuthority({
    authorityKind: 'eoa-signer',
    authorityId: 'bob',
    validationMode: 'eip-712-eoa',
    address: '0x7777777777777777777777777777777777777777',
  });
  assert.throws(
    () =>
      createCryptoEip712AuthorizationEnvelope({
        envelopeId: 'wrong-signer',
        receiptId: 'receipt',
        intent,
        decision: allowDecision,
        signerAuthority: wrongSigner,
        riskAssessment,
        referenceBundle,
        verifyingContract: '0x9999999999999999999999999999999999999999',
      }),
    /signer must be authorized/i,
  );
  passed += 1;

  const mismatchedRisk = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'transfer',
    account: fixtureAccount(),
    asset: fixtureAsset(),
    amount: {
      assetAmount: '1',
      normalizedUsd: '1',
    },
  });
  assert.throws(
    () =>
      createCryptoEip712AuthorizationEnvelope({
        envelopeId: 'wrong-risk',
        receiptId: 'receipt',
        intent,
        decision: allowDecision,
        signerAuthority: signer,
        riskAssessment: mismatchedRisk,
        referenceBundle,
        verifyingContract: '0x9999999999999999999999999999999999999999',
      }),
    /decision risk must match risk assessment|risk assessment consequence must match intent/i,
  );
  passed += 1;

  const otherChain = createCryptoChainReference({
    namespace: 'eip155',
    chainId: '137',
  });
  const wrongBundle = createCryptoCanonicalReferenceBundle({
    chain: otherChain,
  });
  assert.throws(
    () =>
      createCryptoEip712AuthorizationEnvelope({
        envelopeId: 'wrong-bundle',
        receiptId: 'receipt',
        intent,
        decision: allowDecision,
        signerAuthority: signer,
        riskAssessment,
        referenceBundle: wrongBundle,
        verifyingContract: '0x9999999999999999999999999999999999999999',
      }),
    /reference bundle chain must match/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoEip712AuthorizationEnvelope({
        envelopeId: 'bad-salt',
        receiptId: 'receipt',
        intent,
        decision: allowDecision,
        signerAuthority: signer,
        riskAssessment,
        referenceBundle,
        verifyingContract: '0x9999999999999999999999999999999999999999',
        domainSalt: 'not-bytes32',
      }),
    /domainSalt must be/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptor();
  testTypedDataShape();
  testMessageBindingsAndCoverage();
  testSignerChainAndDomainIntrospection();
  testCustomDomainAndLargeChain();
  testDigestAndLabelAreStable();
  testInvalidInputsReject();

  console.log(`\nCrypto authorization core EIP-712 envelope tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core EIP-712 envelope tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
