import { strict as assert } from 'node:assert';
import {
  CRYPTO_RELEASE_ARTIFACT_PATHS,
  CRYPTO_RELEASE_BINDING_CHECKS,
  CRYPTO_RELEASE_BINDING_STATUSES,
  CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION,
  createCryptoReleaseDecisionBinding,
  cryptoReleaseDecisionBindingDescriptor,
  cryptoReleaseDecisionBindingLabel,
  type CryptoReleaseDecisionBinding,
} from '../src/crypto-authorization-core/release-decision-binding.js';
import {
  createCryptoErc1271ValidationProjection,
  evaluateCryptoErc1271ValidationResult,
  ERC1271_MAGIC_VALUE,
} from '../src/crypto-authorization-core/erc1271-validation-projection.js';
import {
  createCryptoReplayFreshnessRules,
  evaluateCryptoAuthorizationFreshness,
} from '../src/crypto-authorization-core/replay-freshness-rules.js';
import {
  createCryptoEip712AuthorizationEnvelope,
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
  type CryptoAuthorizationDecision,
  type CryptoAuthorizationIntent,
} from '../src/crypto-authorization-core/object-model.js';
import {
  createCryptoCanonicalAssetReference,
  createCryptoCanonicalCounterpartyReference,
  createCryptoCanonicalReferenceBundle,
} from '../src/crypto-authorization-core/canonical-references.js';
import {
  createCryptoConsequenceRiskAssessment,
  type CryptoConsequenceRiskAssessment,
} from '../src/crypto-authorization-core/consequence-risk-mapping.js';
import {
  createCryptoAccountReference,
  createCryptoAssetReference,
  createCryptoChainReference,
} from '../src/crypto-authorization-core/types.js';
import type {
  EvidencePack,
  ReleaseDecision,
  ReleaseTokenClaims,
} from '../src/release-kernel/object-model.js';
import {
  buildReleaseTokenClaims,
} from '../src/release-kernel/object-model.js';

let passed = 0;

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const SIGNATURE = `0x${'11'.repeat(65)}`;

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
    assetId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    decimals: 6,
  });
}

interface FixtureParts {
  readonly intent: CryptoAuthorizationIntent;
  readonly cryptoDecision: CryptoAuthorizationDecision;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly envelope: ReturnType<typeof createCryptoEip712AuthorizationEnvelope>;
  readonly signatureValidation: ReturnType<typeof createCryptoErc1271ValidationProjection>;
  readonly signatureValidationResult: ReturnType<typeof evaluateCryptoErc1271ValidationResult>;
  readonly freshnessRules: ReturnType<typeof createCryptoReplayFreshnessRules>;
  readonly freshnessEvaluation: ReturnType<typeof evaluateCryptoAuthorizationFreshness>;
}

function fixtureParts(
  decisionStatus: CryptoAuthorizationDecision['status'] = 'allow',
): FixtureParts {
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
  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-release-binding-001',
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
    authorityKind: 'smart-account',
    authorityId: 'safe:treasury',
    validationMode: 'erc-1271-contract',
    address: ACCOUNT_ADDRESS,
  });
  const cryptoDecision = createCryptoAuthorizationDecision({
    decisionId: 'decision-release-binding-001',
    intent,
    decidedAt: '2026-04-21T08:00:02.000Z',
    status: decisionStatus,
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: 'release-crypto-bridge-001',
    reasonCodes: ['policy-allow', 'bridge-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: 'envelope-release-binding-001',
    receiptId: 'receipt-release-binding-001',
    intent,
    decision: cryptoDecision,
    signerAuthority: signer,
    riskAssessment,
    referenceBundle,
    verifyingContract: VERIFYING_CONTRACT,
  });
  const signatureValidation = createCryptoErc1271ValidationProjection({
    envelope,
    signature: SIGNATURE,
    adapterKind: 'safe-guard',
  });
  const signatureValidationResult = evaluateCryptoErc1271ValidationResult({
    projection: signatureValidation,
    returnValue: ERC1271_MAGIC_VALUE,
    blockNumber: '123',
    validatedAtEpochSeconds: 1776758450,
  });
  const freshnessRules = createCryptoReplayFreshnessRules({
    intent,
    decision: cryptoDecision,
    envelope,
  });
  const freshnessEvaluation = evaluateCryptoAuthorizationFreshness({
    rules: freshnessRules,
    nowEpochSeconds: 1776758460,
    revocationObservation: {
      revocationKey: freshnessRules.revocation.revocationKey,
      status: 'active',
      checkedAtEpochSeconds: 1776758450,
    },
  });

  return {
    intent,
    cryptoDecision,
    riskAssessment,
    envelope,
    signatureValidation,
    signatureValidationResult,
    freshnessRules,
    freshnessEvaluation,
  };
}

function fixtureBinding(): CryptoReleaseDecisionBinding {
  return createCryptoReleaseDecisionBinding(fixtureParts());
}

function tokenClaimsFor(binding: CryptoReleaseDecisionBinding): ReleaseTokenClaims {
  return buildReleaseTokenClaims({
    issuer: 'attestor:test',
    subject: `releaseDecision:${binding.releaseDecision.id}`,
    tokenId: 'rt_crypto_bridge_001',
    issuedAtEpochSeconds: 1776758402,
    ttlSeconds: 60,
    decision: binding.releaseDecision,
    audience: binding.releaseDecision.target.id,
    scope: binding.releaseTokenPosture.scope,
    resource: binding.releaseTokenPosture.resource,
  });
}

function evidencePackFor(binding: CryptoReleaseDecisionBinding): EvidencePack {
  return Object.freeze({
    version: 'attestor.evidence-pack.v1',
    id: 'evidence-pack-crypto-bridge-001',
    outputHash: binding.releaseDecision.outputHash,
    consequenceHash: binding.releaseDecision.consequenceHash,
    policyVersion: binding.releaseDecision.policyVersion,
    policyHash: binding.releaseDecision.policyHash,
    retentionClass: 'regulated',
    findings: binding.releaseDecision.findings,
    artifacts: binding.evidence.requiredArtifacts,
  });
}

function testDescriptor(): void {
  const descriptor = cryptoReleaseDecisionBindingDescriptor();

  equal(descriptor.version, CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION, 'Crypto release binding: descriptor exposes version');
  deepEqual(descriptor.artifactPaths, CRYPTO_RELEASE_ARTIFACT_PATHS, 'Crypto release binding: descriptor exposes artifact paths');
  deepEqual(descriptor.statuses, CRYPTO_RELEASE_BINDING_STATUSES, 'Crypto release binding: descriptor exposes statuses');
  deepEqual(descriptor.bindingChecks, CRYPTO_RELEASE_BINDING_CHECKS, 'Crypto release binding: descriptor exposes binding checks');
  ok(descriptor.standards.includes('EIP-712'), 'Crypto release binding: descriptor names EIP-712');
  ok(descriptor.standards.includes('ERC-1271-aware'), 'Crypto release binding: descriptor names ERC-1271 awareness');
  ok(descriptor.standards.includes('DSSE-evidence-ready'), 'Crypto release binding: descriptor names evidence readiness');
}

function testAcceptedBinding(): void {
  const binding = fixtureBinding();
  const second = fixtureBinding();

  equal(binding.version, CRYPTO_RELEASE_DECISION_BINDING_SPEC_VERSION, 'Crypto release binding: binding carries version');
  equal(binding.status, 'bound', 'Crypto release binding: accepted crypto authorization is bound');
  equal(binding.cryptoDecisionId, 'decision-release-binding-001', 'Crypto release binding: crypto decision id is bound');
  equal(binding.releaseDecisionId, 'release-crypto-bridge-001', 'Crypto release binding: release decision id is bound');
  equal(binding.chainId, 'eip155:1', 'Crypto release binding: chain id is bound');
  equal(binding.accountAddress, ACCOUNT_ADDRESS, 'Crypto release binding: account address is bound');
  equal(binding.consequenceKind, 'bridge', 'Crypto release binding: crypto consequence is bound');
  equal(binding.releaseConsequenceType, 'action', 'Crypto release binding: bridge maps to release-layer action');
  equal(binding.riskClass, 'R4', 'Crypto release binding: risk class is bound');
  equal(binding.releaseDecision.status, 'accepted', 'Crypto release binding: release decision is accepted');
  equal(binding.releaseDecision.consequenceType, 'action', 'Crypto release binding: release decision consequence type is action');
  equal(binding.releaseDecision.riskClass, 'R4', 'Crypto release binding: release decision risk is R4');
  equal(binding.releaseDecision.policyVersion, 'policy-pack:crypto:v1', 'Crypto release binding: policy version comes from crypto policy scope');
  ok(binding.releaseDecision.policyHash.startsWith('sha256:'), 'Crypto release binding: policy hash is deterministic');
  ok(binding.releaseDecision.outputHash.startsWith('sha256:'), 'Crypto release binding: output hash is sha256');
  ok(binding.releaseDecision.consequenceHash.startsWith('sha256:'), 'Crypto release binding: consequence hash is sha256');
  equal(binding.releaseDecision.outputHash, binding.hashBinding.releaseHashBundle.outputHash, 'Crypto release binding: release output hash matches hash bundle');
  equal(binding.releaseDecision.consequenceHash, binding.hashBinding.releaseHashBundle.consequenceHash, 'Crypto release binding: release consequence hash matches hash bundle');
  equal(binding.hashBinding.outputContract.artifactType, 'attestor.crypto-authorization', 'Crypto release binding: output contract artifact type is explicit');
  equal(binding.hashBinding.outputContract.expectedShape, 'crypto:bridge:safe-guard:erc-1271-contract', 'Crypto release binding: output contract shape is adapter-aware');
  ok(binding.hashBinding.outputPayloadDigest.startsWith('sha256:'), 'Crypto release binding: output payload digest is exposed');
  ok(binding.hashBinding.consequencePayloadDigest.startsWith('sha256:'), 'Crypto release binding: consequence payload digest is exposed');
  ok(binding.hashBinding.capabilityBoundary.allowedTools.includes('safe-guard'), 'Crypto release binding: capability boundary carries adapter');
  ok(binding.hashBinding.capabilityBoundary.allowedTools.includes('erc-1271-contract'), 'Crypto release binding: capability boundary carries validation mode');
  ok(binding.hashBinding.capabilityBoundary.allowedTargets.includes(ACCOUNT_ADDRESS), 'Crypto release binding: capability boundary carries account target');
  ok(binding.hashBinding.capabilityBoundary.allowedDataDomains.includes('crypto-authorization'), 'Crypto release binding: capability boundary carries data domain');
  equal(binding.hashBinding.target.kind, 'workflow', 'Crypto release binding: release target is workflow');
  ok(binding.hashBinding.target.id.includes('safe-guard'), 'Crypto release binding: release target names adapter');
  equal(binding.reviewerAuthority.cryptoRequired.mode, 'dual-approval', 'Crypto release binding: crypto risk requires dual approval');
  equal(binding.reviewerAuthority.cryptoRequired.minimumReviewerCount, 2, 'Crypto release binding: crypto risk requires two reviewers');
  equal(binding.reviewerAuthority.releaseBound.mode, 'dual-approval', 'Crypto release binding: release reviewer mode is bound');
  equal(binding.reviewerAuthority.sufficient, true, 'Crypto release binding: reviewer authority is sufficient');
  equal(binding.reviewerAuthority.minimumReviewerCountDelta, 0, 'Crypto release binding: reviewer count delta is exact');
  equal(binding.evidence.evidencePackStatus, 'not-provided', 'Crypto release binding: evidence pack can be pending');
  equal(binding.evidence.requiredArtifacts.length, 8, 'Crypto release binding: evidence artifact list is complete');
  ok(binding.evidence.requiredArtifacts.some((artifact) => artifact.path.startsWith('crypto-eip712-envelope://')), 'Crypto release binding: envelope evidence artifact is present');
  ok(binding.evidence.requiredArtifacts.some((artifact) => artifact.path.startsWith('crypto-signature-validation://')), 'Crypto release binding: signature validation artifact is present');
  ok(binding.evidence.requiredArtifacts.some((artifact) => artifact.path.startsWith('crypto-freshness-evaluation://')), 'Crypto release binding: freshness evaluation artifact is present');
  equal(binding.releaseTokenPosture.required, true, 'Crypto release binding: accepted release requires token');
  equal(binding.releaseTokenPosture.eligible, true, 'Crypto release binding: accepted release is token-eligible');
  equal(binding.releaseTokenPosture.tokenClaimStatus, 'required-not-present', 'Crypto release binding: missing token claim is explicit');
  equal(binding.releaseTokenPosture.audience, binding.releaseDecision.target.id, 'Crypto release binding: token audience is target id');
  equal(binding.releaseTokenPosture.subject, `releaseDecision:${binding.releaseDecision.id}`, 'Crypto release binding: token subject is release decision');
  equal(binding.releaseTokenPosture.scope, 'release:crypto:bridge', 'Crypto release binding: token scope is crypto consequence scoped');
  ok(binding.releaseTokenPosture.resource.includes(ACCOUNT_ADDRESS), 'Crypto release binding: token resource includes account');
  equal(binding.releaseTokenPosture.introspectionRequired, true, 'Crypto release binding: R4 token requires introspection');
  equal(binding.releaseTokenPosture.consumeOnSuccess, true, 'Crypto release binding: token consumption is required');
  equal(binding.releaseTokenPosture.maxUses, 1, 'Crypto release binding: max uses defaults to one');
  equal(binding.releaseTokenPosture.ttlCeilingSeconds, 120, 'Crypto release binding: token TTL is capped by crypto freshness');
  deepEqual(binding.bindingChecks, CRYPTO_RELEASE_BINDING_CHECKS, 'Crypto release binding: binding checks are complete');
  ok(binding.releaseDecision.findings.some((finding) => finding.code === 'crypto_signature_erc-1271-contract'), 'Crypto release binding: release findings include signature validation');
  ok(binding.releaseDecision.findings.some((finding) => finding.code === 'crypto_freshness_fresh'), 'Crypto release binding: release findings include freshness result');
  equal(binding.digest, second.digest, 'Crypto release binding: binding digest is deterministic');
  equal(
    cryptoReleaseDecisionBindingLabel(binding),
    `crypto-release:decision-release-binding-001 / release:release-crypto-bridge-001 / status:bound / chain:eip155:1 / account:${ACCOUNT_ADDRESS} / risk:R4`,
    'Crypto release binding: label is stable',
  );
}

function testReleaseTokenClaimsBinding(): void {
  const parts = fixtureParts();
  const initial = createCryptoReleaseDecisionBinding(parts);
  const claims = tokenClaimsFor(initial);
  const binding = createCryptoReleaseDecisionBinding({
    ...parts,
    releaseTokenClaims: claims,
    releaseTokenId: claims.jti,
  });

  equal(binding.releaseTokenPosture.tokenClaimStatus, 'bound', 'Crypto release binding: release token claims can be bound');
  equal(binding.releaseTokenPosture.tokenId, 'rt_crypto_bridge_001', 'Crypto release binding: token id is carried');
  equal(binding.releaseTokenPosture.audience, claims.aud, 'Crypto release binding: token audience matches posture');
  equal(binding.releaseTokenPosture.scope, claims.scope, 'Crypto release binding: token scope matches posture');

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        releaseTokenClaims: {
          ...claims,
          output_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      }),
    /release token output hash does not match/i,
  );
  passed += 1;
}

function testEvidencePackBinding(): void {
  const parts = fixtureParts();
  const initial = createCryptoReleaseDecisionBinding(parts);
  const evidencePack = evidencePackFor(initial);
  const binding = createCryptoReleaseDecisionBinding({
    ...parts,
    evidencePack,
    releaseDecision: initial.releaseDecision,
    evidencePackId: evidencePack.id,
  });

  equal(binding.evidence.evidencePackStatus, 'bound', 'Crypto release binding: evidence pack can be bound');
  equal(binding.evidence.evidencePackId, 'evidence-pack-crypto-bridge-001', 'Crypto release binding: evidence pack id is carried');

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        releaseDecision: initial.releaseDecision,
        evidencePack: {
          ...evidencePack,
          artifacts: evidencePack.artifacts.slice(0, -1),
        },
      }),
    /evidence pack is missing artifact digest/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        releaseDecision: initial.releaseDecision,
        evidencePack: {
          ...evidencePack,
          consequenceHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      }),
    /evidence pack consequence hash does not match/i,
  );
  passed += 1;
}

function testProvidedReleaseDecisionValidation(): void {
  const parts = fixtureParts();
  const initial = createCryptoReleaseDecisionBinding(parts);
  const strongerDecision: ReleaseDecision = {
    ...initial.releaseDecision,
    reviewAuthority: {
      ...initial.releaseDecision.reviewAuthority,
      minimumReviewerCount: 3,
    },
  };
  const stronger = createCryptoReleaseDecisionBinding({
    ...parts,
    releaseDecision: strongerDecision,
  });

  equal(stronger.reviewerAuthority.sufficient, true, 'Crypto release binding: stronger provided reviewer authority is accepted');
  equal(stronger.reviewerAuthority.minimumReviewerCountDelta, 1, 'Crypto release binding: reviewer delta records stronger authority');

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        releaseDecision: {
          ...initial.releaseDecision,
          outputHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        },
      }),
    /release decision output hash does not match/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        releaseDecision: {
          ...initial.releaseDecision,
          reviewAuthority: {
            ...initial.releaseDecision.reviewAuthority,
            mode: 'auto',
            minimumReviewerCount: 0,
            requiresNamedReviewer: false,
          },
        },
      }),
    /reviewer authority is weaker/i,
  );
  passed += 1;
}

function testBlockedAndPendingBindings(): void {
  const invalidSignatureParts = fixtureParts();
  const invalidSignature = createCryptoReleaseDecisionBinding({
    ...invalidSignatureParts,
    signatureValidationResult: evaluateCryptoErc1271ValidationResult({
      projection: invalidSignatureParts.signatureValidation,
      returnValue: '0xffffffff',
    }),
  });
  const replayedFreshnessParts = fixtureParts();
  const replayed = createCryptoReleaseDecisionBinding({
    ...replayedFreshnessParts,
    freshnessEvaluation: evaluateCryptoAuthorizationFreshness({
      rules: replayedFreshnessParts.freshnessRules,
      nowEpochSeconds: 1776758460,
      revocationObservation: {
        revocationKey: replayedFreshnessParts.freshnessRules.revocation.revocationKey,
        status: 'active',
        checkedAtEpochSeconds: 1776758450,
      },
      replayLedgerEntry: {
        ledgerKey: replayedFreshnessParts.freshnessRules.replayLedger.ledgerKey,
        firstSeenAtEpochSeconds: 1776758420,
        expiresAtEpochSeconds: 1776758820,
      },
    }),
  });
  const pending = createCryptoReleaseDecisionBinding({
    ...fixtureParts(),
    freshnessEvaluation: null,
  });
  const reviewParts = fixtureParts();
  const reviewRequired = createCryptoReleaseDecisionBinding({
    ...reviewParts,
    cryptoDecision: {
      ...reviewParts.cryptoDecision,
      status: 'review-required',
    },
  });

  equal(invalidSignature.releaseDecision.status, 'denied', 'Crypto release binding: invalid signature denies release');
  equal(invalidSignature.status, 'blocked', 'Crypto release binding: invalid signature is blocked');
  equal(invalidSignature.releaseTokenPosture.required, false, 'Crypto release binding: denied release does not require token');
  equal(invalidSignature.releaseTokenPosture.tokenClaimStatus, 'not-required', 'Crypto release binding: denied token posture is not required');
  equal(replayed.releaseDecision.status, 'denied', 'Crypto release binding: replayed authorization denies release');
  equal(replayed.status, 'blocked', 'Crypto release binding: replayed authorization is blocked');
  ok(replayed.releaseDecision.findings.some((finding) => finding.code === 'crypto_freshness_replayed'), 'Crypto release binding: replayed finding is present');
  equal(pending.releaseDecision.status, 'hold', 'Crypto release binding: missing freshness result holds release');
  equal(pending.status, 'pending', 'Crypto release binding: missing freshness result is pending');
  ok(pending.releaseDecision.findings.some((finding) => finding.code === 'crypto_release_pending_runtime_result'), 'Crypto release binding: pending runtime finding is present');
  equal(reviewRequired.releaseDecision.status, 'review-required', 'Crypto release binding: crypto review-required maps to release review-required');
  equal(reviewRequired.status, 'review-required', 'Crypto release binding: review-required status is preserved');
}

function testConsistencyRejections(): void {
  const parts = fixtureParts();

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        signatureValidation: {
          ...parts.signatureValidation,
          envelopeId: 'wrong-envelope',
        },
      }),
    /signature validation must bind to the envelope/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        freshnessRules: {
          ...parts.freshnessRules,
          envelopeId: 'wrong-envelope',
        },
      }),
    /freshness rules must bind to the envelope/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        signatureValidationResult: {
          ...parts.signatureValidationResult,
          projectionDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        },
      }),
    /signature result must bind/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        riskAssessment: {
          ...parts.riskAssessment,
          riskClass: 'R3',
        },
      }),
    /risk class does not match/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createCryptoReleaseDecisionBinding({
        ...parts,
        cryptoDecision: {
          ...parts.cryptoDecision,
          nonce: 'wrong-nonce',
        },
      }),
    /nonce does not match/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptor();
  testAcceptedBinding();
  testReleaseTokenClaimsBinding();
  testEvidencePackBinding();
  testProvidedReleaseDecisionValidation();
  testBlockedAndPendingBindings();
  testConsistencyRejections();

  console.log(`\nCrypto authorization core release binding tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nCrypto authorization core release binding tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
