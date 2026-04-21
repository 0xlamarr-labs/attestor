import assert from 'node:assert/strict';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  createReleaseTokenIssuer,
  type IssuedReleaseToken,
  type ReleaseTokenVerificationKey,
} from '../src/release-kernel/release-token.js';
import {
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
} from '../src/release-kernel/release-introspection.js';
import {
  createEnforcementDecision,
  createEnforcementReceipt,
} from '../src/release-enforcement-plane/object-model.js';
import { runEnforcementPointConformance } from '../src/release-enforcement-plane/conformance.js';
import {
  createDegradedModeGrant,
  evaluateDegradedMode,
} from '../src/release-enforcement-plane/degraded-mode.js';
import {
  createMtlsReleaseTokenConfirmation,
} from '../src/release-enforcement-plane/workload-binding.js';
import {
  CRYPTO_ENFORCEMENT_BINDING_CHECKS,
  CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION,
  createCryptoEnforcementVerificationBinding,
  createCryptoOfflineVerificationInput,
  createCryptoOnlineVerificationInput,
  createCryptoReleasePresentation,
  cryptoEnforcementVerificationBindingLabel,
  cryptoEnforcementVerificationDescriptor,
  cryptoExecutionBoundaryTemplate,
  getCryptoExecutionBoundaryTemplate,
  verifyCryptoAuthorizationOffline,
  verifyCryptoAuthorizationOnline,
  type CryptoEnforcementVerificationBinding,
} from '../src/crypto-authorization-core/enforcement-plane-verification.js';
import {
  createCryptoPolicyControlPlaneScopeBinding,
  type CryptoPolicyControlPlaneScopeBinding,
} from '../src/crypto-authorization-core/policy-control-plane-scope-binding.js';
import {
  createCryptoReleaseDecisionBinding,
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
  type CryptoExecutionAdapterKind,
} from '../src/crypto-authorization-core/types.js';

let passed = 0;

const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const BRIDGE_ADDRESS = '0x2222222222222222222222222222222222222222';
const VERIFYING_CONTRACT = '0x9999999999999999999999999999999999999999';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const CERT_THUMBPRINT = 'cert-thumbprint-crypto-enforcement';
const SPIFFE_ID = 'spiffe://attestor.test/ns/crypto/sa/safe-guard';
const CHECKED_AT = '2026-04-21T09:02:00.000Z';

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

interface FixtureSuite {
  readonly intent: CryptoAuthorizationIntent;
  readonly riskAssessment: CryptoConsequenceRiskAssessment;
  readonly releaseBinding: CryptoReleaseDecisionBinding;
  readonly policyScopeBinding: CryptoPolicyControlPlaneScopeBinding;
}

function fixtureSuite(
  executionAdapterKind: CryptoExecutionAdapterKind = 'safe-guard',
): FixtureSuite {
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
    address: BRIDGE_ADDRESS,
    counterparty: 'bridge:canonical-usdc',
    protocol: 'bridge-protocol',
    functionSelector: '0x12345678',
    calldataClass: 'bounded-bridge',
  });
  const policyScope = createCryptoAuthorizationPolicyScope({
    dimensions: [
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
    ],
    environment: 'prod-crypto',
    tenantId: 'tenant-crypto',
    policyPackRef: 'policy-pack:crypto:v1',
  });
  const constraints = createCryptoAuthorizationConstraints({
    validAfter: '2026-04-21T09:00:00.000Z',
    validUntil: '2026-04-21T09:05:00.000Z',
    nonce: 'bridge:nonce:7',
    replayProtectionMode: 'nonce',
    digestMode: 'eip-712-typed-data',
    requiredArtifacts: CRYPTO_AUTHORIZATION_SMART_ACCOUNT_ARTIFACTS,
    maxAmount: '250000.00',
  });
  const intent = createCryptoAuthorizationIntent({
    intentId: 'intent-crypto-enforcement-001',
    requestedAt: '2026-04-21T09:00:01.000Z',
    requester,
    account,
    consequenceKind: 'bridge',
    target,
    asset,
    policyScope,
    constraints,
    executionAdapterKind,
    evidenceRefs: ['evidence:crypto-enforcement:001', 'policy:activation:001'],
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
      executionAdapterKind,
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
    decisionId: 'decision-crypto-enforcement-001',
    intent,
    decidedAt: '2026-04-21T09:00:02.000Z',
    status: 'allow',
    riskClass: riskAssessment.riskClass,
    releaseDecisionId: 'release-crypto-enforcement-001',
    reasonCodes: ['policy-allow', 'bridge-reviewed'],
    signerAuthorities: [signer],
  });
  const envelope = createCryptoEip712AuthorizationEnvelope({
    envelopeId: 'envelope-crypto-enforcement-001',
    receiptId: 'receipt-crypto-enforcement-001',
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
    adapterKind: executionAdapterKind,
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
  const releaseBinding = createCryptoReleaseDecisionBinding({
    intent,
    cryptoDecision,
    riskAssessment,
    envelope,
    signatureValidation,
    signatureValidationResult,
    freshnessRules,
    freshnessEvaluation,
  });
  const policyScopeBinding = createCryptoPolicyControlPlaneScopeBinding({
    intent,
    cryptoDecision,
    riskAssessment,
    releaseBinding,
    generatedAt: '2026-04-21T09:00:03.000Z',
    planId: 'enterprise',
  });

  return {
    intent,
    riskAssessment,
    releaseBinding,
    policyScopeBinding,
  };
}

function createBinding(
  releaseBinding: CryptoReleaseDecisionBinding,
  policyScopeBinding: CryptoPolicyControlPlaneScopeBinding | null,
): CryptoEnforcementVerificationBinding {
  return createCryptoEnforcementVerificationBinding({
    releaseBinding,
    policyScopeBinding,
    requestId: 'erq_crypto_enforcement_001',
    receivedAt: '2026-04-21T09:01:00.000Z',
    enforcementPoint: {
      enforcementPointId: 'pep.crypto.safe-guard',
      workloadId: SPIFFE_ID,
    },
    traceId: 'trace-crypto-enforcement-001',
    idempotencyKey: 'idem-crypto-enforcement-001',
  });
}

function issueableReleaseDecision(
  decision: CryptoReleaseDecisionBinding['releaseDecision'],
): CryptoReleaseDecisionBinding['releaseDecision'] {
  if (decision.status === 'accepted' || decision.status === 'overridden') {
    return decision;
  }

  return Object.freeze({
    ...decision,
    status: 'accepted',
  });
}

async function setupIssuer(): Promise<{
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly issue: (input: {
    readonly tokenId: string;
    readonly decision: CryptoReleaseDecisionBinding['releaseDecision'];
  }) => Promise<IssuedReleaseToken>;
}> {
  const keyPair = generateKeyPair();
  const issuer = createReleaseTokenIssuer({
    issuer: 'attestor.release.local',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  return {
    verificationKey: await issuer.exportVerificationKey(),
    issue(input) {
      return issuer.issue({
        decision: input.decision,
        issuedAt: '2026-04-21T09:01:30.000Z',
        tokenId: input.tokenId,
        confirmation: createMtlsReleaseTokenConfirmation({
          certificateThumbprint: CERT_THUMBPRINT,
          spiffeId: SPIFFE_ID,
        }),
      });
    },
  };
}

async function issuedPresentationFixture(): Promise<{
  readonly binding: CryptoEnforcementVerificationBinding;
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly releaseDecision: CryptoReleaseDecisionBinding['releaseDecision'];
}> {
  const suite = fixtureSuite();
  const binding = createBinding(suite.releaseBinding, suite.policyScopeBinding);
  const releaseDecision = issueableReleaseDecision(suite.releaseBinding.releaseDecision);
  const issuer = await setupIssuer();
  const issued = await issuer.issue({
    tokenId: 'rt_crypto_enforcement_001',
    decision: releaseDecision,
  });

  return {
    binding,
    issued,
    verificationKey: issuer.verificationKey,
    releaseDecision,
  };
}

function testDescriptorAndBoundaryTemplates(): void {
  const descriptor = cryptoEnforcementVerificationDescriptor();

  equal(
    descriptor.version,
    CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION,
    'Crypto enforcement verification: descriptor exposes version',
  );
  deepEqual(
    descriptor.bindingChecks,
    CRYPTO_ENFORCEMENT_BINDING_CHECKS,
    'Crypto enforcement verification: descriptor exposes binding checks',
  );
  ok(
    descriptor.standards.includes('release-enforcement-plane'),
    'Crypto enforcement verification: descriptor names enforcement-plane reuse',
  );
  ok(
    descriptor.standards.includes('EIP-7702-ready'),
    'Crypto enforcement verification: descriptor names delegation readiness',
  );

  const walletCall = cryptoExecutionBoundaryTemplate('wallet-call-api');
  equal(
    walletCall.pointKind,
    'application-middleware',
    'Crypto enforcement verification: wallet call adapter uses application middleware',
  );
  equal(
    walletCall.boundaryKind,
    'http-request',
    'Crypto enforcement verification: wallet call adapter uses HTTP request boundary',
  );

  const safeGuard = getCryptoExecutionBoundaryTemplate('safe-guard');
  equal(
    safeGuard.pointKind,
    'action-dispatch-gateway',
    'Crypto enforcement verification: Safe guard uses action-dispatch gateway',
  );
  equal(
    safeGuard.boundaryKind,
    'action-dispatch',
    'Crypto enforcement verification: Safe guard uses action-dispatch boundary',
  );
}

function testCreatesBinding(): void {
  const suite = fixtureSuite();
  const binding = createBinding(suite.releaseBinding, suite.policyScopeBinding);
  const second = createBinding(suite.releaseBinding, suite.policyScopeBinding);

  equal(
    binding.version,
    CRYPTO_ENFORCEMENT_VERIFICATION_SPEC_VERSION,
    'Crypto enforcement verification: binding carries version',
  );
  equal(
    binding.adapterKind,
    'safe-guard',
    'Crypto enforcement verification: adapter kind is inferred from release binding',
  );
  equal(
    binding.policyActivationId,
    suite.policyScopeBinding.activationId,
    'Crypto enforcement verification: policy activation id is carried',
  );
  equal(
    binding.policyBundleId,
    suite.policyScopeBinding.bundleId,
    'Crypto enforcement verification: policy bundle id is carried',
  );
  equal(
    binding.enforcementRequest.enforcementPoint.environment,
    'prod-crypto',
    'Crypto enforcement verification: environment derives from policy scope binding',
  );
  equal(
    binding.enforcementRequest.enforcementPoint.tenantId,
    'tenant-crypto',
    'Crypto enforcement verification: tenant derives from policy scope binding',
  );
  equal(
    binding.enforcementRequest.enforcementPoint.accountId,
    suite.policyScopeBinding.activationTarget.accountId,
    'Crypto enforcement verification: account derives from policy scope binding',
  );
  equal(
    binding.enforcementRequest.enforcementPoint.pointKind,
    'action-dispatch-gateway',
    'Crypto enforcement verification: high-risk Safe bridge maps to action-dispatch gateway',
  );
  equal(
    binding.enforcementRequest.enforcementPoint.boundaryKind,
    'action-dispatch',
    'Crypto enforcement verification: high-risk Safe bridge maps to action-dispatch boundary',
  );
  equal(
    binding.verificationProfile.id,
    'verification-profile:action:R4:action-dispatch',
    'Crypto enforcement verification: verification profile derives from release consequence and risk',
  );
  equal(
    binding.verificationProfile.onlineIntrospectionRequired,
    true,
    'Crypto enforcement verification: R4 action dispatch requires online introspection',
  );
  equal(
    binding.presentationDefaults.defaultMode,
    'mtls-bound-token',
    'Crypto enforcement verification: preferred sender-constrained default is mTLS',
  );
  deepEqual(
    binding.presentationDefaults.preferredModes,
    ['mtls-bound-token', 'spiffe-bound-token', 'dpop-bound-token'],
    'Crypto enforcement verification: preferred modes follow the adapter template in allowed order',
  );
  equal(
    binding.expectedBinding.releaseDecisionId,
    suite.releaseBinding.releaseDecisionId,
    'Crypto enforcement verification: expected binding carries release decision id',
  );
  equal(
    binding.expectedBinding.audience,
    suite.releaseBinding.releaseTokenPosture.audience,
    'Crypto enforcement verification: expected binding carries audience',
  );
  equal(
    binding.digest,
    second.digest,
    'Crypto enforcement verification: digest is deterministic',
  );
  ok(
    cryptoEnforcementVerificationBindingLabel(binding).includes(
      'crypto-enforcement:decision-crypto-enforcement-001',
    ),
    'Crypto enforcement verification: label names the crypto decision',
  );
}

async function testOfflineVerificationWrapper(): Promise<void> {
  const { binding, issued, verificationKey } = await issuedPresentationFixture();
  const presentation = createCryptoReleasePresentation({
    binding,
    issuedToken: issued,
    presentedAt: CHECKED_AT,
    mode: 'mtls-bound-token',
    proof: {
      kind: 'mtls',
      certificateThumbprint: CERT_THUMBPRINT,
      subjectDn: 'CN=crypto-safe-guard',
      spiffeId: SPIFFE_ID,
    },
  });
  const offlineInput = createCryptoOfflineVerificationInput({
    binding,
    presentation,
    verificationKey,
    now: CHECKED_AT,
    verificationResultId: 'vr_crypto_offline_001',
  });

  equal(
    offlineInput.request.id,
    binding.enforcementRequest.id,
    'Crypto enforcement verification: offline input reuses bound enforcement request',
  );
  equal(
    offlineInput.expected?.releaseTokenId,
    issued.tokenId,
    'Crypto enforcement verification: offline input fills expected token id from presentation',
  );

  const verified = await verifyCryptoAuthorizationOffline({
    binding,
    presentation,
    verificationKey,
    now: CHECKED_AT,
    verificationResultId: 'vr_crypto_offline_001',
  });

  equal(
    verified.status,
    'indeterminate',
    'Crypto enforcement verification: R4 action dispatch stays indeterminate offline',
  );
  equal(
    verified.offlineVerified,
    true,
    'Crypto enforcement verification: offline wrapper verifies the bound token locally',
  );
  equal(
    verified.requiresOnlineIntrospection,
    true,
    'Crypto enforcement verification: high-risk binding still requires online liveness',
  );
  deepEqual(
    verified.failureReasons,
    ['fresh-introspection-required'],
    'Crypto enforcement verification: only online freshness remains after local verification',
  );
}

async function testOnlineVerificationWrapper(): Promise<void> {
  const { binding, issued, verificationKey, releaseDecision } = await issuedPresentationFixture();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  store.registerIssuedToken({
    issuedToken: issued,
    decision: releaseDecision,
  });
  const introspector = createReleaseTokenIntrospector(store);
  const presentation = createCryptoReleasePresentation({
    binding,
    issuedToken: issued,
    presentedAt: CHECKED_AT,
    mode: 'mtls-bound-token',
    proof: {
      kind: 'mtls',
      certificateThumbprint: CERT_THUMBPRINT,
      subjectDn: 'CN=crypto-safe-guard',
      spiffeId: SPIFFE_ID,
    },
  });
  const onlineInput = createCryptoOnlineVerificationInput({
    binding,
    presentation,
    verificationKey,
    now: CHECKED_AT,
    introspector,
    usageStore: store,
    verificationResultId: 'vr_crypto_online_001',
  });

  equal(
    onlineInput.profile?.id,
    binding.verificationProfile.id,
    'Crypto enforcement verification: online input reuses derived verification profile',
  );
  equal(
    onlineInput.resourceServerId,
    undefined,
    'Crypto enforcement verification: online input lets the verifier default resource server id',
  );

  const verified = await verifyCryptoAuthorizationOnline({
    binding,
    presentation,
    verificationKey,
    now: CHECKED_AT,
    introspector,
    usageStore: store,
    verificationResultId: 'vr_crypto_online_001',
  });

  equal(
    verified.status,
    'valid',
    'Crypto enforcement verification: active introspection upgrades the binding to valid',
  );
  equal(
    verified.onlineChecked,
    true,
    'Crypto enforcement verification: high-risk wrapper performs online introspection',
  );
  equal(
    verified.verificationResult.mode,
    'hybrid-required',
    'Crypto enforcement verification: high-risk result records hybrid verification mode',
  );
  equal(
    verified.introspectionSnapshot?.active,
    true,
    'Crypto enforcement verification: online verification exposes an active introspection snapshot',
  );
}

async function testConformanceAndDegradedModeReuse(): Promise<void> {
  const suite = fixtureSuite();
  const binding = createBinding(suite.releaseBinding, suite.policyScopeBinding);
  const releaseDecision = issueableReleaseDecision(suite.releaseBinding.releaseDecision);
  const issuer = await setupIssuer();
  const issued = await issuer.issue({
    tokenId: 'rt_crypto_enforcement_002',
    decision: releaseDecision,
  });
  const presentation = createCryptoReleasePresentation({
    binding,
    issuedToken: issued,
    presentedAt: CHECKED_AT,
    mode: 'mtls-bound-token',
    proof: {
      kind: 'mtls',
      certificateThumbprint: CERT_THUMBPRINT,
      subjectDn: 'CN=crypto-safe-guard',
      spiffeId: SPIFFE_ID,
    },
  });
  const store = createInMemoryReleaseTokenIntrospectionStore();
  store.registerIssuedToken({
    issuedToken: issued,
    decision: releaseDecision,
  });
  const verified = await verifyCryptoAuthorizationOnline({
    binding,
    presentation,
    verificationKey: issuer.verificationKey,
    now: CHECKED_AT,
    introspector: createReleaseTokenIntrospector(store),
    verificationResultId: 'vr_crypto_online_002',
  });
  const decision = createEnforcementDecision({
    id: 'ed_crypto_enforcement_001',
    request: binding.enforcementRequest,
    decidedAt: CHECKED_AT,
    verification: verified.verificationResult,
  });
  const receipt = createEnforcementReceipt({
    id: 'er_crypto_enforcement_001',
    issuedAt: CHECKED_AT,
    decision,
    receiptDigest: 'sha256:crypto-enforcement-receipt-001',
  });
  const report = runEnforcementPointConformance({
    id: 'crypto-safe-guard-allow',
    result: {
      status: 'allowed',
      checkedAt: CHECKED_AT,
      request: binding.enforcementRequest,
      decision,
      receipt,
      verificationResult: verified.verificationResult,
      failureReasons: [],
    },
  });

  equal(
    report.status,
    'pass',
    'Crypto enforcement verification: valid crypto-bound enforcement result passes conformance',
  );

  const introspectionUnavailable = await verifyCryptoAuthorizationOnline({
    binding,
    presentation,
    verificationKey: issuer.verificationKey,
    now: CHECKED_AT,
    verificationResultId: 'vr_crypto_online_003',
  });
  const degraded = evaluateDegradedMode({
    checkedAt: CHECKED_AT,
    request: binding.enforcementRequest,
    verification: introspectionUnavailable.verificationResult,
    grant: createDegradedModeGrant({
      id: 'dmg_crypto_enforcement_001',
      state: 'break-glass-open',
      reason: 'availability-restore',
      scope: {
        environment: binding.enforcementRequest.enforcementPoint.environment,
        enforcementPointId: binding.enforcementRequest.enforcementPoint.enforcementPointId,
        pointKind: binding.enforcementRequest.enforcementPoint.pointKind,
        boundaryKind: binding.enforcementRequest.enforcementPoint.boundaryKind,
        tenantId: binding.enforcementRequest.enforcementPoint.tenantId,
        accountId: binding.enforcementRequest.enforcementPoint.accountId,
        workloadId: binding.enforcementRequest.enforcementPoint.workloadId,
        audience: binding.enforcementRequest.enforcementPoint.audience,
        targetId: binding.enforcementRequest.targetId,
        consequenceType: binding.enforcementRequest.enforcementPoint.consequenceType,
        riskClass: binding.enforcementRequest.enforcementPoint.riskClass,
      },
      authorizedBy: {
        id: 'user_crypto_incident_commander',
        type: 'user',
        role: 'incident-commander',
      },
      approvedBy: [
        {
          id: 'user_crypto_release_admin',
          type: 'user',
          role: 'release-admin',
        },
      ],
      authorizedAt: '2026-04-21T09:01:30.000Z',
      startsAt: '2026-04-21T09:01:30.000Z',
      expiresAt: '2026-04-21T09:10:00.000Z',
      ticketId: 'INC-CRYPTO-001',
      rationale: 'Restore safe-guard enforcement during a verified introspection outage.',
      allowedFailureReasons: ['introspection-unavailable', 'fresh-introspection-required'],
      maxUses: 2,
    }),
  });

  equal(
    introspectionUnavailable.status,
    'invalid',
    'Crypto enforcement verification: missing introspector fails closed online',
  );
  deepEqual(
    introspectionUnavailable.failureReasons,
    ['introspection-unavailable'],
    'Crypto enforcement verification: online outage is explicit',
  );
  equal(
    degraded.status,
    'break-glass-allow',
    'Crypto enforcement verification: degraded mode can reuse the same bound request on outage',
  );
  equal(
    degraded.outcome,
    'break-glass-allow',
    'Crypto enforcement verification: degraded mode keeps explicit break-glass outcome',
  );
}

function testMismatchedPolicyBindingFailsClosed(): void {
  const suite = fixtureSuite();

  assert.throws(
    () =>
      createCryptoEnforcementVerificationBinding({
        releaseBinding: suite.releaseBinding,
        policyScopeBinding: {
          ...suite.policyScopeBinding,
          releaseDecisionId: 'release-crypto-enforcement-other',
        },
        requestId: 'erq_crypto_enforcement_002',
        receivedAt: '2026-04-21T09:01:00.000Z',
        enforcementPoint: {
          enforcementPointId: 'pep.crypto.safe-guard',
          workloadId: SPIFFE_ID,
        },
      }),
    /release decision/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptorAndBoundaryTemplates();
  testCreatesBinding();
  await testOfflineVerificationWrapper();
  await testOnlineVerificationWrapper();
  await testConformanceAndDegradedModeReuse();
  testMismatchedPolicyBindingFailsClosed();
  console.log(`crypto authorization core enforcement verification tests passed (${passed} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
