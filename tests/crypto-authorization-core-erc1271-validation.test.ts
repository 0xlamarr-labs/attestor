import { strict as assert } from 'node:assert';
import {
  CRYPTO_ERC1271_RESULT_STATUSES,
  CRYPTO_ERC1271_VALIDATION_PATHS,
  CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION,
  CRYPTO_MODULAR_VALIDATION_MODULE_TYPES,
  CRYPTO_SIGNATURE_VALIDATION_SUBJECT_KINDS,
  ERC1271_INVALID_VALUE,
  ERC1271_IS_VALID_SIGNATURE_ABI,
  ERC1271_IS_VALID_SIGNATURE_SELECTOR,
  ERC1271_MAGIC_VALUE,
  ERC6492_DETECTION_SUFFIX,
  ERC7739_SUPPORT_DETECTION_HASH,
  ERC7739_SUPPORT_MAGIC_VALUE,
  createCryptoEoaSignatureValidationProjection,
  createCryptoErc1271ValidationProjection,
  createCryptoSignatureValidationProjection,
  cryptoErc1271ValidationProjectionDescriptor,
  cryptoErc1271ValidationProjectionLabel,
  evaluateCryptoErc1271ValidationResult,
  extractCryptoErc1271ReturnBytes4,
} from '../src/crypto-authorization-core/erc1271-validation-projection.js';
import {
  createCryptoEip712AuthorizationEnvelope,
} from '../src/crypto-authorization-core/eip712-authorization-envelope.js';
import {
  CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
  CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
  createCryptoAuthorizationActor,
  createCryptoAuthorizationConstraints,
  createCryptoAuthorizationDecision,
  createCryptoAuthorizationIntent,
  createCryptoAuthorizationPolicyScope,
  createCryptoExecutionTarget,
  createCryptoSignerAuthority,
  type CryptoSignatureValidationMode,
  type CryptoSignerAuthorityKind,
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
  type CryptoAccountKind,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

const SMART_ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const EOA_ADDRESS = '0x3333333333333333333333333333333333333333';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const COUNTERFACTUAL_SIGNATURE = `0x${'22'.repeat(65)}${ERC6492_DETECTION_SUFFIX.slice(2)}`;
const ABI_ENCODED_MAGIC = `${ERC1271_MAGIC_VALUE}${'0'.repeat(56)}`;

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

function fixtureAccount(accountKind: CryptoAccountKind = 'safe', address = SMART_ACCOUNT_ADDRESS) {
  return createCryptoAccountReference({
    accountKind,
    chain: fixtureChain(),
    address,
    accountLabel: accountKind === 'eoa' ? 'Treasury EOA' : 'Treasury Smart Account',
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

function fixtureEnvelope(
  accountKind: CryptoAccountKind = 'safe',
  validationMode: CryptoSignatureValidationMode = 'erc-1271-contract',
  signerAuthorityKind: CryptoSignerAuthorityKind = 'smart-account',
  signerAddress = SMART_ACCOUNT_ADDRESS,
) {
  const chain = fixtureChain();
  const account = fixtureAccount(accountKind, signerAddress);
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
    nonce: `${accountKind}:nonce:7`,
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts:
      validationMode === 'erc-1271-contract'
        ? CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS
        : CRYPTO_AUTHORIZATION_DEFAULT_REQUIRED_ARTIFACTS,
    maxAmount: '250000.00',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: `intent-${accountKind}-001`,
    requestedAt: '2026-04-21T08:00:01.000Z',
    requester,
    account,
    consequenceKind: 'bridge',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind: validationMode === 'erc-1271-contract' ? 'safe-guard' : 'wallet-call-api',
    evidenceRefs: ['evidence:release:001', 'policy:activation:001'],
  });
  const counterparty = createCryptoCanonicalCounterpartyReference({
    counterpartyKind: 'bridge',
    counterpartyId: 'bridge:canonical-usdc',
    chain,
  });
  const canonicalAsset = createCryptoCanonicalAssetReference({
    asset,
    assetNamespace: 'erc20',
  });
  const referenceBundle = createCryptoCanonicalReferenceBundle({
    chain,
    account,
    asset: canonicalAsset,
    counterparty,
  });
  const riskAssessment = createCryptoConsequenceRiskAssessment({
    consequenceKind: 'bridge',
    account,
    asset,
    amount: {
      assetAmount: '250000.00',
      normalizedUsd: '250000.00',
    },
    counterparty,
    context: {
      signals: ['cross-chain'],
    },
  });
  const signer = createCryptoSignerAuthority({
    authorityKind: signerAuthorityKind,
    authorityId: validationMode === 'erc-1271-contract' ? 'safe:treasury' : 'alice',
    validationMode,
    address: signerAddress,
  });
  const decision = createCryptoAuthorizationDecision({
    decisionId: `decision-${accountKind}-001`,
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    reasonCodes: ['policy-allow', 'bridge-reviewed'],
    signerAuthorities: [signer],
  });

  return createCryptoEip712AuthorizationEnvelope({
    envelopeId: `envelope-${accountKind}-001`,
    receiptId: `receipt-${accountKind}-001`,
    intent,
    decision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: VERIFYING_CONTRACT,
  });
}

function smartProjection() {
  return createCryptoErc1271ValidationProjection({
    envelope: fixtureEnvelope(),
    signature: SIGNATURE,
    adapterKind: 'safe-guard',
  });
}

function testDescriptor(): void {
  const descriptor = cryptoErc1271ValidationProjectionDescriptor();

  equal(
    descriptor.version,
    CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION,
    'Crypto ERC-1271 validation: descriptor exposes version',
  );
  equal(descriptor.abiSignature, ERC1271_IS_VALID_SIGNATURE_ABI, 'Crypto ERC-1271 validation: descriptor exposes ABI signature');
  equal(descriptor.selector, ERC1271_IS_VALID_SIGNATURE_SELECTOR, 'Crypto ERC-1271 validation: descriptor exposes selector');
  equal(descriptor.magicValue, ERC1271_MAGIC_VALUE, 'Crypto ERC-1271 validation: descriptor exposes magic value');
  equal(descriptor.invalidValue, ERC1271_INVALID_VALUE, 'Crypto ERC-1271 validation: descriptor exposes invalid value');
  deepEqual(descriptor.validationPaths, CRYPTO_ERC1271_VALIDATION_PATHS, 'Crypto ERC-1271 validation: descriptor exposes validation paths');
  deepEqual(descriptor.modularModuleTypes, CRYPTO_MODULAR_VALIDATION_MODULE_TYPES, 'Crypto ERC-1271 validation: descriptor exposes modular module types');
  deepEqual(descriptor.subjectKinds, CRYPTO_SIGNATURE_VALIDATION_SUBJECT_KINDS, 'Crypto ERC-1271 validation: descriptor exposes subject kinds');
  deepEqual(descriptor.resultStatuses, CRYPTO_ERC1271_RESULT_STATUSES, 'Crypto ERC-1271 validation: descriptor exposes result statuses');
  ok(descriptor.standards.includes('ERC-1271'), 'Crypto ERC-1271 validation: descriptor names ERC-1271');
  ok(descriptor.standards.includes('ERC-6492-ready'), 'Crypto ERC-1271 validation: descriptor is counterfactual-ready');
  ok(descriptor.standards.includes('ERC-7579-ready'), 'Crypto ERC-1271 validation: descriptor is modular-account-ready');
  ok(descriptor.standards.includes('ERC-7739-ready'), 'Crypto ERC-1271 validation: descriptor is defensive-rehashing-ready');
}

function testSmartAccountDefaultProjection(): void {
  const projection = smartProjection();
  const second = smartProjection();

  equal(projection.version, CRYPTO_ERC1271_VALIDATION_PROJECTION_SPEC_VERSION, 'Crypto ERC-1271 validation: projection carries version');
  equal(projection.projectionKind, 'signature-validation', 'Crypto ERC-1271 validation: projection kind is stable');
  equal(projection.subjectKind, 'smart-account', 'Crypto ERC-1271 validation: smart account subject is detected');
  equal(projection.validationMode, 'erc-1271-contract', 'Crypto ERC-1271 validation: validation mode is ERC-1271');
  equal(projection.validationPath, 'deployed-contract', 'Crypto ERC-1271 validation: default path is deployed contract');
  equal(projection.envelopeId, 'envelope-safe-001', 'Crypto ERC-1271 validation: envelope id is bound');
  equal(projection.chainId, 'eip155:1', 'Crypto ERC-1271 validation: chain id is bound');
  equal(projection.accountAddress, SMART_ACCOUNT_ADDRESS, 'Crypto ERC-1271 validation: account address is bound');
  equal(projection.signerAddress, SMART_ACCOUNT_ADDRESS, 'Crypto ERC-1271 validation: signer address is bound');
  equal(projection.validatorContract, SMART_ACCOUNT_ADDRESS, 'Crypto ERC-1271 validation: validator defaults to account');
  equal(projection.adapterKind, 'safe-guard', 'Crypto ERC-1271 validation: adapter kind is carried as context');
  equal(projection.attestorAuthorizationDigest.startsWith('sha256:'), true, 'Crypto ERC-1271 validation: Attestor digest is sha256');
  ok(/^0x[0-9a-f]{64}$/.test(projection.attestorAuthorizationDigestBytes32), 'Crypto ERC-1271 validation: digest is projected to bytes32');
  equal(projection.staticCall.callKind, 'erc-1271-is-valid-signature', 'Crypto ERC-1271 validation: staticcall kind is stable');
  equal(projection.staticCall.callType, 'staticcall', 'Crypto ERC-1271 validation: staticcall is required');
  equal(projection.staticCall.to, SMART_ACCOUNT_ADDRESS, 'Crypto ERC-1271 validation: staticcall target is validator');
  equal(projection.staticCall.selector, '0x1626ba7e', 'Crypto ERC-1271 validation: staticcall selector is ERC-1271');
  equal(projection.staticCall.abiSignature, 'isValidSignature(bytes32,bytes)', 'Crypto ERC-1271 validation: ABI signature is explicit');
  equal(projection.staticCall.stateMutability, 'view', 'Crypto ERC-1271 validation: state mutability is view');
  equal(projection.staticCall.arguments.hash, projection.attestorAuthorizationDigestBytes32, 'Crypto ERC-1271 validation: staticcall hash uses envelope digest bytes32');
  equal(projection.staticCall.arguments.signature, SIGNATURE, 'Crypto ERC-1271 validation: staticcall signature is carried');
  equal(projection.staticCall.expectedReturnValue, ERC1271_MAGIC_VALUE, 'Crypto ERC-1271 validation: expected return value is magic');
  equal(projection.staticCall.invalidReturnValue, ERC1271_INVALID_VALUE, 'Crypto ERC-1271 validation: invalid return value is explicit');
  equal(projection.staticCall.gasPolicy, 'do-not-hardcode-gas-limit', 'Crypto ERC-1271 validation: gas policy avoids hardcoded limits');
  equal(projection.counterfactual, null, 'Crypto ERC-1271 validation: deployed path has no counterfactual plan');
  equal(projection.modular, null, 'Crypto ERC-1271 validation: deployed path has no modular plan');
  equal(projection.defensiveRehashing.standard, 'ERC-7739', 'Crypto ERC-1271 validation: defensive rehashing posture names ERC-7739');
  equal(projection.defensiveRehashing.accountAddress, SMART_ACCOUNT_ADDRESS, 'Crypto ERC-1271 validation: defensive rehashing binds account');
  equal(projection.defensiveRehashing.chainId, 'eip155:1', 'Crypto ERC-1271 validation: defensive rehashing binds chain');
  equal(projection.defensiveRehashing.domainVerifyingContract, VERIFYING_CONTRACT, 'Crypto ERC-1271 validation: defensive rehashing binds domain contract');
  equal(projection.defensiveRehashing.supportDetectionHash, ERC7739_SUPPORT_DETECTION_HASH, 'Crypto ERC-1271 validation: ERC-7739 detection hash is exposed');
  equal(projection.defensiveRehashing.supportMagicValue, ERC7739_SUPPORT_MAGIC_VALUE, 'Crypto ERC-1271 validation: ERC-7739 support magic is exposed');
  equal(projection.defensiveRehashing.safeToSkipReason, 'attestor-envelope-binds-account-chain-domain', 'Crypto ERC-1271 validation: skip reason is explicit');
  ok(projection.validationChecks.includes('staticcall-is-required'), 'Crypto ERC-1271 validation: staticcall check is listed');
  ok(projection.validationChecks.includes('magic-value-must-match-0x1626ba7e'), 'Crypto ERC-1271 validation: magic-value check is listed');
  ok(projection.validationChecks.includes('nonce-and-validity-window-come-from-envelope'), 'Crypto ERC-1271 validation: freshness check is listed');
  equal(projection.digest, second.digest, 'Crypto ERC-1271 validation: projection digest is deterministic');
  equal(
    cryptoErc1271ValidationProjectionLabel(projection),
    `validation:envelope-safe-001 / mode:erc-1271-contract / path:deployed-contract / chain:eip155:1 / account:${SMART_ACCOUNT_ADDRESS} / validator:${SMART_ACCOUNT_ADDRESS}`,
    'Crypto ERC-1271 validation: label is stable',
  );
}

function testCustomValidatorProjection(): void {
  const projection = createCryptoErc1271ValidationProjection({
    envelope: fixtureEnvelope(),
    signature: SIGNATURE.toUpperCase().replace('X', 'x'),
    validatorContract: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });

  equal(projection.validatorContract, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Crypto ERC-1271 validation: custom validator is normalized');
  equal(projection.staticCall.to, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Crypto ERC-1271 validation: custom validator is staticcall target');
  equal(projection.staticCall.arguments.signature, SIGNATURE, 'Crypto ERC-1271 validation: signature hex is normalized');
  ok(projection.validationChecks.includes('validator-contract-is-explicitly-projected'), 'Crypto ERC-1271 validation: custom validator check is listed');
}

function testCounterfactualProjection(): void {
  const projection = createCryptoErc1271ValidationProjection({
    envelope: fixtureEnvelope('erc-4337-smart-account'),
    signature: COUNTERFACTUAL_SIGNATURE,
    validationPath: 'counterfactual-erc6492',
    allowCounterfactual: true,
    factory: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    factoryCalldata: '0xBEEF',
    adapterKind: 'erc-4337-user-operation',
  });

  equal(projection.validationPath, 'counterfactual-erc6492', 'Crypto ERC-1271 validation: counterfactual path is selected');
  equal(projection.adapterKind, 'erc-4337-user-operation', 'Crypto ERC-1271 validation: account-abstraction adapter context is preserved');
  ok(projection.counterfactual !== null, 'Crypto ERC-1271 validation: counterfactual plan is present');
  equal(projection.counterfactual?.standard, 'ERC-6492', 'Crypto ERC-1271 validation: counterfactual plan names ERC-6492');
  equal(projection.counterfactual?.enabled, true, 'Crypto ERC-1271 validation: counterfactual plan is enabled');
  equal(projection.counterfactual?.detectionSuffix, ERC6492_DETECTION_SUFFIX, 'Crypto ERC-1271 validation: ERC-6492 suffix is exposed');
  equal(projection.counterfactual?.factory, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Crypto ERC-1271 validation: factory is normalized');
  equal(projection.counterfactual?.factoryCalldata, '0xbeef', 'Crypto ERC-1271 validation: factory calldata is normalized');
  ok(projection.counterfactual?.verificationOrder.includes('detect-erc6492-suffix'), 'Crypto ERC-1271 validation: ERC-6492 detection order is listed');
  ok(projection.validationChecks.includes('erc6492-counterfactual-wrapper-is-declared'), 'Crypto ERC-1271 validation: counterfactual check is listed');
}

function testModularAndSafePaths(): void {
  const modular = createCryptoErc1271ValidationProjection({
    envelope: fixtureEnvelope('erc-7579-modular-account'),
    signature: SIGNATURE,
    validationPath: 'modular-validator',
    module: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    moduleType: 'validator',
    adapterKind: 'erc-7579-module',
  });
  const safe = createCryptoErc1271ValidationProjection({
    envelope: fixtureEnvelope(),
    signature: SIGNATURE,
    validationPath: 'safe-guard',
    adapterKind: 'safe-guard',
  });

  equal(modular.validationPath, 'modular-validator', 'Crypto ERC-1271 validation: modular validator path is selected');
  ok(modular.modular !== null, 'Crypto ERC-1271 validation: modular plan is present');
  equal(modular.modular?.standard, 'ERC-7579', 'Crypto ERC-1271 validation: modular plan names ERC-7579');
  equal(modular.modular?.module, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Crypto ERC-1271 validation: module is normalized');
  equal(modular.modular?.moduleType, 'validator', 'Crypto ERC-1271 validation: validator module type is selected');
  equal(modular.modular?.validatorRequired, true, 'Crypto ERC-1271 validation: validator module is required');
  ok(modular.validationChecks.includes('erc7579-validator-module-is-declared'), 'Crypto ERC-1271 validation: modular check is listed');
  equal(safe.validationPath, 'safe-guard', 'Crypto ERC-1271 validation: Safe guard path is selected');
  ok(safe.validationChecks.includes('safe-guard-path-is-declared'), 'Crypto ERC-1271 validation: Safe guard check is listed');
}

function testEoaProjection(): void {
  const envelope = fixtureEnvelope('eoa', 'eip-712-eoa', 'eoa-signer', EOA_ADDRESS);
  const projection = createCryptoSignatureValidationProjection({
    envelope,
    signature: SIGNATURE,
    expectedSigner: EOA_ADDRESS,
    adapterKind: 'wallet-call-api',
  });
  const direct = createCryptoEoaSignatureValidationProjection({
    envelope,
    signature: SIGNATURE,
  });

  equal(projection.subjectKind, 'eoa', 'Crypto ERC-1271 validation: EOA subject is detected');
  equal(projection.validationMode, 'eip-712-eoa', 'Crypto ERC-1271 validation: EOA validation mode is EIP-712');
  equal(projection.chainId, 'eip155:1', 'Crypto ERC-1271 validation: EOA projection binds chain');
  equal(projection.accountAddress, EOA_ADDRESS, 'Crypto ERC-1271 validation: EOA projection binds account');
  equal(projection.signerAddress, EOA_ADDRESS, 'Crypto ERC-1271 validation: EOA projection binds signer');
  equal(projection.adapterKind, 'wallet-call-api', 'Crypto ERC-1271 validation: EOA projection carries adapter context');
  equal(projection.attestorAuthorizationDigest, envelope.digest, 'Crypto ERC-1271 validation: EOA projection carries envelope digest');
  ok(/^0x[0-9a-f]{64}$/.test(projection.attestorAuthorizationDigestBytes32), 'Crypto ERC-1271 validation: EOA digest is bytes32');
  equal(projection.erc1271StaticCall, null, 'Crypto ERC-1271 validation: EOA path has no ERC-1271 staticcall');
  equal(projection.expectedRecoveredSigner, EOA_ADDRESS, 'Crypto ERC-1271 validation: EOA path expects recovered signer');
  ok(projection.validationChecks.includes('ecrecover-or-wallet-verifier-must-match-envelope-signer'), 'Crypto ERC-1271 validation: EOA signer check is listed');
  equal(direct.subjectKind, 'eoa', 'Crypto ERC-1271 validation: direct EOA helper returns EOA projection');
  equal(
    cryptoErc1271ValidationProjectionLabel(projection),
    `validation:envelope-eoa-001 / mode:eip-712-eoa / chain:eip155:1 / signer:${EOA_ADDRESS}`,
    'Crypto ERC-1271 validation: EOA label is stable',
  );
}

function testResultEvaluation(): void {
  const projection = smartProjection();
  const valid = evaluateCryptoErc1271ValidationResult({
    projection,
    returnValue: ERC1271_MAGIC_VALUE,
    blockNumber: 123n.toString(),
    validatedAtEpochSeconds: 1776758420,
  });
  const validAbi = evaluateCryptoErc1271ValidationResult({
    projection,
    returnValue: ABI_ENCODED_MAGIC,
  });
  const invalid = evaluateCryptoErc1271ValidationResult({
    projection,
    returnValue: ERC1271_INVALID_VALUE,
  });
  const mismatch = evaluateCryptoErc1271ValidationResult({
    projection,
    returnValue: '0x12345678',
  });
  const reverted = evaluateCryptoErc1271ValidationResult({
    projection,
    returnValue: ERC1271_MAGIC_VALUE,
    reverted: true,
    revertReason: 'account paused',
  });
  const missing = evaluateCryptoErc1271ValidationResult({
    projection,
  });
  const malformed = evaluateCryptoErc1271ValidationResult({
    projection,
    returnValue: '0x1234',
  });

  equal(valid.status, 'valid', 'Crypto ERC-1271 validation: magic value returns valid status');
  equal(valid.accepted, true, 'Crypto ERC-1271 validation: magic value is accepted');
  equal(valid.magicValueMatched, true, 'Crypto ERC-1271 validation: magic value is matched');
  equal(valid.returnBytes4, ERC1271_MAGIC_VALUE, 'Crypto ERC-1271 validation: return bytes4 is extracted');
  equal(valid.blockNumber, '123', 'Crypto ERC-1271 validation: block number is preserved');
  equal(valid.validatedAtEpochSeconds, 1776758420, 'Crypto ERC-1271 validation: validation time is preserved');
  ok(valid.reasonCodes.includes('erc1271-magic-value-matched'), 'Crypto ERC-1271 validation: valid reason code is listed');
  equal(validAbi.status, 'valid', 'Crypto ERC-1271 validation: ABI-encoded bytes4 return is accepted');
  equal(extractCryptoErc1271ReturnBytes4(ABI_ENCODED_MAGIC), ERC1271_MAGIC_VALUE, 'Crypto ERC-1271 validation: helper extracts ABI-encoded bytes4');
  equal(invalid.status, 'invalid', 'Crypto ERC-1271 validation: invalid magic returns invalid status');
  ok(invalid.reasonCodes.includes('erc1271-invalid-value-returned'), 'Crypto ERC-1271 validation: invalid return code is listed');
  equal(mismatch.status, 'invalid', 'Crypto ERC-1271 validation: non-magic bytes4 returns invalid status');
  ok(mismatch.reasonCodes.includes('erc1271-magic-value-mismatch'), 'Crypto ERC-1271 validation: mismatch reason code is listed');
  equal(reverted.status, 'indeterminate', 'Crypto ERC-1271 validation: revert is indeterminate');
  ok(reverted.reasonCodes.includes('erc1271-call-reverted'), 'Crypto ERC-1271 validation: revert reason code is listed');
  equal(missing.status, 'indeterminate', 'Crypto ERC-1271 validation: missing return is indeterminate');
  ok(missing.reasonCodes.includes('erc1271-return-value-missing'), 'Crypto ERC-1271 validation: missing return reason code is listed');
  equal(malformed.status, 'indeterminate', 'Crypto ERC-1271 validation: malformed return is indeterminate');
  ok(malformed.reasonCodes.includes('erc1271-return-value-malformed'), 'Crypto ERC-1271 validation: malformed return reason code is listed');
  equal(valid.digest, evaluateCryptoErc1271ValidationResult({ projection, returnValue: ERC1271_MAGIC_VALUE, blockNumber: '123', validatedAtEpochSeconds: 1776758420 }).digest, 'Crypto ERC-1271 validation: result digest is deterministic');
}

function testInvalidInputsReject(): void {
  assert.throws(
    () =>
      createCryptoErc1271ValidationProjection({
        envelope: fixtureEnvelope('eoa', 'eip-712-eoa', 'eoa-signer', EOA_ADDRESS),
        signature: SIGNATURE,
      }),
    /requires an erc-1271-contract envelope/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoEoaSignatureValidationProjection({
        envelope: fixtureEnvelope(),
        signature: SIGNATURE,
      }),
    /requires an eip-712-eoa envelope/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoErc1271ValidationProjection({
        envelope: fixtureEnvelope(),
        signature: '',
      }),
    /signature requires a non-empty value/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoErc1271ValidationProjection({
        envelope: fixtureEnvelope(),
        signature: '0x1',
      }),
    /signature must be non-empty 0x hex bytes/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoErc1271ValidationProjection({
        envelope: fixtureEnvelope(),
        signature: SIGNATURE,
        validatorContract: '0x123',
      }),
    /validatorContract must be a 20-byte EVM address/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoErc1271ValidationProjection({
        envelope: fixtureEnvelope(),
        signature: COUNTERFACTUAL_SIGNATURE,
        validationPath: 'counterfactual-erc6492',
      }),
    /counterfactual validation must be explicitly enabled/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoErc1271ValidationProjection({
        envelope: fixtureEnvelope(),
        signature: COUNTERFACTUAL_SIGNATURE,
        validationPath: 'counterfactual-erc6492',
        allowCounterfactual: true,
        factoryCalldata: '0xbeef',
      }),
    /factory requires a non-empty value/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoErc1271ValidationProjection({
        envelope: fixtureEnvelope('erc-7579-modular-account'),
        signature: SIGNATURE,
        validationPath: 'modular-validator',
        module: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        moduleType: 'executor',
      }),
    /requires a validator module/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoErc1271ValidationProjection({
        envelope: fixtureEnvelope(),
        signature: SIGNATURE,
        expectedSigner: EOA_ADDRESS,
      }),
    /expectedSigner must match/i,
  );
  passed += 1;

  assert.throws(
    () => extractCryptoErc1271ReturnBytes4('0x1234'),
    /returnValue must be bytes4 or ABI-encoded bytes4/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptor();
  testSmartAccountDefaultProjection();
  testCustomValidatorProjection();
  testCounterfactualProjection();
  testModularAndSafePaths();
  testEoaProjection();
  testResultEvaluation();
  testInvalidInputsReject();

  console.log(`\nCrypto authorization core ERC-1271 validation projection tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core ERC-1271 validation projection tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
