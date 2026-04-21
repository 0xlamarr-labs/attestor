import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair } from '../src/signing/keys.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createReleaseTokenIssuer,
  type IssuedReleaseToken,
} from '../src/release-kernel/release-token.js';
import {
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
  type ActiveReleaseTokenIntrospectionResult,
  type ReleaseTokenIntrospector,
} from '../src/release-kernel/release-introspection.js';
import {
  createEnforcementRequest,
  createReleasePresentation,
  type EnforcementRequest,
  type ReleasePresentation,
} from '../src/release-enforcement-plane/object-model.js';
import {
  ONLINE_RELEASE_VERIFIER_SPEC_VERSION,
  verifyOnlineReleaseAuthorization,
} from '../src/release-enforcement-plane/online-verifier.js';
import { createMtlsReleaseTokenConfirmation } from '../src/release-enforcement-plane/workload-binding.js';

let passed = 0;
const WORKLOAD_CERT_THUMBPRINT = 'cert-thumbprint';
const WORKLOAD_SPIFFE_ID = 'spiffe://attestor/tests/finance-writer';

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

function tokenDigest(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

function makeDecision(input: {
  readonly id: string;
  readonly consequenceType: 'record' | 'decision-support';
  readonly riskClass: 'R1' | 'R4';
  readonly targetId: string;
}) {
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T09:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-online-test.v1',
    policyHash: 'sha256:policy',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'release-online-test.artifact',
      expectedShape: 'deterministic test artifact',
      consequenceType: input.consequenceType,
      riskClass: input.riskClass,
    },
    capabilityBoundary: {
      allowedTools: ['release-online-test-tool'],
      allowedTargets: [input.targetId],
      allowedDataDomains: ['release-online-test'],
    },
    requester: {
      id: 'svc.release-online-test',
      type: 'service',
    },
    target: {
      kind: input.consequenceType === 'record' ? 'record-store' : 'endpoint',
      id: input.targetId,
    },
  });
}

function makeRequest(input: {
  readonly id: string;
  readonly targetId: string;
  readonly consequenceType?: 'record' | 'decision-support';
  readonly riskClass?: 'R1' | 'R4';
  readonly boundaryKind?: 'http-request' | 'record-write';
  readonly pointKind?: 'application-middleware' | 'record-write-gateway';
  readonly releaseTokenId?: string | null;
  readonly releaseDecisionId?: string | null;
}): EnforcementRequest {
  return createEnforcementRequest({
    id: input.id,
    receivedAt: '2026-04-18T09:01:00.000Z',
    enforcementPoint: {
      environment: 'test',
      enforcementPointId: `${input.id}-pep`,
      pointKind: input.pointKind ?? 'application-middleware',
      boundaryKind: input.boundaryKind ?? 'http-request',
      consequenceType: input.consequenceType ?? 'decision-support',
      riskClass: input.riskClass ?? 'R1',
      tenantId: 'tenant-test',
      accountId: 'acct-test',
      workloadId: 'spiffe://attestor/tests/online-verifier',
      audience: input.targetId,
    },
    targetId: input.targetId,
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    releaseTokenId: input.releaseTokenId,
    releaseDecisionId: input.releaseDecisionId,
    transport: {
      kind: 'http',
      method: 'POST',
      uri: `https://attestor.test/${input.id}`,
      headersDigest: 'sha256:headers',
      bodyDigest: 'sha256:body',
    },
  });
}

function bearerPresentation(input: {
  readonly issued: IssuedReleaseToken;
  readonly decisionId: string;
  readonly audience?: string;
}): ReleasePresentation {
  return createReleasePresentation({
    mode: 'bearer-release-token',
    presentedAt: '2026-04-18T09:01:00.000Z',
    releaseToken: input.issued.token,
    releaseTokenId: input.issued.tokenId,
    releaseTokenDigest: tokenDigest(input.issued.token),
    issuer: 'attestor.release.local',
    subject: `releaseDecision:${input.decisionId}`,
    audience: input.audience ?? input.issued.claims.aud,
    expiresAt: input.issued.expiresAt,
  });
}

function mtlsPresentation(input: {
  readonly issued: IssuedReleaseToken;
  readonly decisionId: string;
}): ReleasePresentation {
  return createReleasePresentation({
    mode: 'mtls-bound-token',
    presentedAt: '2026-04-18T09:01:00.000Z',
    releaseToken: input.issued.token,
    releaseTokenId: input.issued.tokenId,
    releaseTokenDigest: tokenDigest(input.issued.token),
    issuer: 'attestor.release.local',
    subject: `releaseDecision:${input.decisionId}`,
    audience: input.issued.claims.aud,
    expiresAt: input.issued.expiresAt,
    proof: {
      kind: 'mtls',
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      subjectDn: 'CN=finance-writer',
      spiffeId: WORKLOAD_SPIFFE_ID,
    },
  });
}

async function setupIssuer() {
  const keyPair = generateKeyPair();
  const issuer = createReleaseTokenIssuer({
    issuer: 'attestor.release.local',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  return {
    issuer,
    verificationKey: await issuer.exportVerificationKey(),
  };
}

function activeIntrospectionFromIssued(
  issued: IssuedReleaseToken,
  overrides: Partial<ActiveReleaseTokenIntrospectionResult> = {},
): ActiveReleaseTokenIntrospectionResult {
  return {
    version: 'attestor.release-introspection.v2',
    active: true,
    token_type: 'attestor_release_token',
    checked_at: '2026-04-18T09:01:00.000Z',
    resource_server_id: 'erq-mismatch-pep',
    scope: `release:${issued.claims.consequence_type}`,
    iss: issued.claims.iss,
    sub: issued.claims.sub,
    aud: issued.claims.aud,
    jti: issued.claims.jti,
    iat: issued.claims.iat,
    nbf: issued.claims.nbf,
    exp: issued.claims.exp,
    decision_id: issued.claims.decision_id,
    decision: issued.claims.decision,
    consequence_type: issued.claims.consequence_type,
    risk_class: issued.claims.risk_class,
    output_hash: issued.claims.output_hash,
    consequence_hash: issued.claims.consequence_hash,
    policy_hash: issued.claims.policy_hash,
    override: issued.claims.override,
    authority_mode: issued.claims.authority_mode,
    introspection_required: issued.claims.introspection_required,
    ...overrides,
  };
}

async function testLowRiskCanRemainOfflineValid(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-low-risk-online',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'analytics.memo.preview',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_low_risk',
  });
  const request = makeRequest({
    id: 'erq-online-low-risk',
    targetId: 'analytics.memo.preview',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: bearerPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
  });

  equal(verified.version, ONLINE_RELEASE_VERIFIER_SPEC_VERSION, 'Online verifier: result stamps stable spec version');
  equal(verified.status, 'valid', 'Online verifier: low-risk token can remain valid without online introspection');
  equal(verified.onlineChecked, false, 'Online verifier: low-risk path does not force online check');
  equal(verified.active, null, 'Online verifier: low-risk offline path has no active-state answer');
  deepEqual(verified.failureReasons, [], 'Online verifier: low-risk offline path has no failure reasons');
  equal(verified.verificationResult.mode, 'offline-signature', 'Online verifier: low-risk offline path keeps offline verification mode');
}

async function testHighRiskActiveIntrospectionAllows(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision({
    id: 'decision-r4-online',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'finance.reporting.record-store',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_r4',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  store.registerIssuedToken({ issuedToken: issued, decision });
  const request = makeRequest({
    id: 'erq-online-r4',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
    introspector,
    resourceServerId: 'erq-online-r4-pep',
  });

  equal(verified.status, 'valid', 'Online verifier: active high-risk introspection upgrades offline indeterminate to valid');
  equal(verified.onlineChecked, true, 'Online verifier: high-risk path performs online check');
  equal(verified.active, true, 'Online verifier: active introspection state is retained');
  deepEqual(verified.failureReasons, [], 'Online verifier: active high-risk verification has no failure reasons');
  equal(verified.offline.status, 'indeterminate', 'Online verifier: offline component remains indeterminate before liveness');
  equal(verified.verificationResult.status, 'valid', 'Online verifier: final verification result is valid after liveness');
  equal(verified.verificationResult.mode, 'hybrid-required', 'Online verifier: high-risk result records hybrid verification');
  equal(verified.verificationResult.introspection?.active, true, 'Online verifier: verification result embeds active introspection snapshot');
  equal(verified.freshness?.introspectionCache.status, 'fresh', 'Online verifier: active live introspection creates fresh cache state');
}

async function testHighRiskCanConsumeOnSuccess(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision({
    id: 'decision-consume-online',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'finance.reporting.record-store',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_consume',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  store.registerIssuedToken({ issuedToken: issued, decision });
  const request = makeRequest({
    id: 'erq-online-consume',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
    introspector,
    usageStore: store,
    consumeOnSuccess: true,
    resourceServerId: 'erq-online-consume-pep',
  });

  equal(verified.status, 'valid', 'Online verifier: first consuming high-risk admission succeeds');
  equal(verified.consumed, true, 'Online verifier: successful consume-on-success records usage');
  equal(verified.useCount, 1, 'Online verifier: use count is surfaced');
  equal(verified.maxUses, 1, 'Online verifier: max uses is surfaced');
}

async function testRevokedTokenFails(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision({
    id: 'decision-revoked-online',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'finance.reporting.record-store',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_revoked',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  store.registerIssuedToken({ issuedToken: issued, decision });
  store.revokeToken({
    tokenId: issued.tokenId,
    revokedAt: '2026-04-18T09:00:30.000Z',
    reason: 'operator cancelled release',
    revokedBy: 'admin',
  });
  const request = makeRequest({
    id: 'erq-online-revoked',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
    introspector,
  });

  equal(verified.status, 'invalid', 'Online verifier: revoked token fails closed');
  equal(verified.active, false, 'Online verifier: revoked token has inactive state');
  ok(verified.failureReasons.includes('revoked-authorization'), 'Online verifier: revoked reason is explicit');
  equal(verified.verificationResult.status, 'invalid', 'Online verifier: revoked token yields invalid verification result');
  equal(verified.verificationResult.introspection?.active, false, 'Online verifier: inactive introspection snapshot is attached');
}

async function testConsumedTokenFailsAsReplay(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision({
    id: 'decision-consumed-online',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'finance.reporting.record-store',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_consumed',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  store.registerIssuedToken({ issuedToken: issued, decision });
  store.recordTokenUse({
    tokenId: issued.tokenId,
    usedAt: '2026-04-18T09:00:30.000Z',
    resourceServerId: 'previous-pep',
  });
  const request = makeRequest({
    id: 'erq-online-consumed',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
    introspector,
  });

  equal(verified.status, 'invalid', 'Online verifier: consumed token fails closed');
  ok(verified.failureReasons.includes('replayed-authorization'), 'Online verifier: consumed token maps to replayed authorization');
}

async function testUnknownTokenFails(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision({
    id: 'decision-unknown-online',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'finance.reporting.record-store',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_unknown',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  const request = makeRequest({
    id: 'erq-online-unknown',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
    introspector,
  });

  equal(verified.status, 'invalid', 'Online verifier: unknown authority-plane token fails closed');
  ok(verified.failureReasons.includes('unknown-authorization'), 'Online verifier: unknown token reason is explicit');
}

async function testUnsupportedTokenTypeFails(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision({
    id: 'decision-unsupported-online',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'finance.reporting.record-store',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_unsupported',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  store.registerIssuedToken({ issuedToken: issued, decision });
  const request = makeRequest({
    id: 'erq-online-unsupported',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
    introspector,
    tokenTypeHint: 'not_supported',
  });

  equal(verified.status, 'invalid', 'Online verifier: unsupported token type fails closed');
  ok(verified.failureReasons.includes('unsupported-token-type'), 'Online verifier: unsupported token type reason is explicit');
}

async function testActiveClaimMismatchFails(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-mismatch-online',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'finance.reporting.record-store',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_mismatch',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  const introspector: ReleaseTokenIntrospector = {
    async introspect() {
      return activeIntrospectionFromIssued(issued, {
        output_hash: 'sha256:wrong-output',
      });
    },
  };
  const request = makeRequest({
    id: 'erq-mismatch',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
    introspector,
  });

  equal(verified.status, 'invalid', 'Online verifier: active introspection claim mismatch fails closed');
  ok(verified.failureReasons.includes('introspection-claim-mismatch'), 'Online verifier: claim mismatch reason is explicit');
  ok(verified.failureReasons.includes('binding-mismatch'), 'Online verifier: claim mismatch also marks binding mismatch');
}

async function testIntrospectionUnavailableFailsClosed(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-unavailable-online',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'finance.reporting.record-store',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T09:00:00.000Z',
    tokenId: 'rt_online_unavailable',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  const introspector: ReleaseTokenIntrospector = {
    async introspect() {
      throw new Error('introspection service unavailable');
    },
  };
  const request = makeRequest({
    id: 'erq-online-unavailable',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued, decisionId: decision.id }),
    verificationKey,
    now: '2026-04-18T09:01:00.000Z',
    introspector,
  });

  equal(verified.status, 'invalid', 'Online verifier: introspection outage fails closed for high-risk path');
  equal(verified.onlineChecked, true, 'Online verifier: outage is recorded as attempted online check');
  deepEqual(verified.failureReasons, ['introspection-unavailable'], 'Online verifier: outage reason is explicit');
  equal(verified.verificationResult.degradedState, 'fail-closed', 'Online verifier: outage preserves fail-closed degraded state');
}

async function main(): Promise<void> {
  await testLowRiskCanRemainOfflineValid();
  await testHighRiskActiveIntrospectionAllows();
  await testHighRiskCanConsumeOnSuccess();
  await testRevokedTokenFails();
  await testConsumedTokenFailsAsReplay();
  await testUnknownTokenFails();
  await testUnsupportedTokenTypeFails();
  await testActiveClaimMismatchFails();
  await testIntrospectionUnavailableFailsClosed();

  console.log(`Release enforcement-plane online-verifier tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane online-verifier tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
