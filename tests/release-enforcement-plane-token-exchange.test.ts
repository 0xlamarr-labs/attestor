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
} from '../src/release-kernel/release-introspection.js';
import {
  createEnforcementRequest,
  createReleasePresentation,
  type EnforcementRequest,
  type ReleasePresentation,
} from '../src/release-enforcement-plane/object-model.js';
import {
  ATTESTOR_RELEASE_TOKEN_TYPE,
  RELEASE_TOKEN_EXCHANGE_GRANT_TYPE,
  RELEASE_TOKEN_EXCHANGE_SPEC_VERSION,
  exchangeReleaseToken,
} from '../src/release-enforcement-plane/token-exchange.js';
import { verifyOfflineReleaseAuthorization } from '../src/release-enforcement-plane/offline-verifier.js';
import { verifyOnlineReleaseAuthorization } from '../src/release-enforcement-plane/online-verifier.js';
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
    createdAt: '2026-04-18T10:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-token-exchange-test.v1',
    policyHash: 'sha256:policy',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'release-token-exchange-test.artifact',
      expectedShape: 'deterministic test artifact',
      consequenceType: input.consequenceType,
      riskClass: input.riskClass,
    },
    capabilityBoundary: {
      allowedTools: ['release-token-exchange-test-tool'],
      allowedTargets: [input.targetId],
      allowedDataDomains: ['release-token-exchange-test'],
    },
    requester: {
      id: 'svc.release-token-exchange-test',
      type: 'service',
    },
    target: {
      kind: input.consequenceType === 'record' ? 'record-store' : 'endpoint',
      id: input.targetId,
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

function bearerPresentation(input: {
  readonly issued: IssuedReleaseToken;
  readonly presentedAt?: string;
}): ReleasePresentation {
  return createReleasePresentation({
    mode: 'bearer-release-token',
    presentedAt: input.presentedAt ?? '2026-04-18T10:01:00.000Z',
    releaseToken: input.issued.token,
    releaseTokenId: input.issued.tokenId,
    releaseTokenDigest: tokenDigest(input.issued.token),
    issuer: 'attestor.release.local',
    subject: input.issued.claims.sub,
    audience: input.issued.claims.aud,
    expiresAt: input.issued.expiresAt,
    scope: input.issued.claims.scope?.split(/\s+/) ?? [],
  });
}

function mtlsPresentation(input: {
  readonly issued: IssuedReleaseToken;
}): ReleasePresentation {
  return createReleasePresentation({
    mode: 'mtls-bound-token',
    presentedAt: '2026-04-18T10:01:00.000Z',
    releaseToken: input.issued.token,
    releaseTokenId: input.issued.tokenId,
    releaseTokenDigest: tokenDigest(input.issued.token),
    issuer: 'attestor.release.local',
    subject: input.issued.claims.sub,
    audience: input.issued.claims.aud,
    expiresAt: input.issued.expiresAt,
    scope: input.issued.claims.scope?.split(/\s+/) ?? [],
    proof: {
      kind: 'mtls',
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      subjectDn: 'CN=finance-writer',
      spiffeId: WORKLOAD_SPIFFE_ID,
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
  readonly releaseTokenId: string;
  readonly releaseDecisionId: string;
}): EnforcementRequest {
  return createEnforcementRequest({
    id: input.id,
    receivedAt: '2026-04-18T10:01:00.000Z',
    enforcementPoint: {
      environment: 'test',
      enforcementPointId: `${input.id}-pep`,
      pointKind: input.pointKind ?? 'application-middleware',
      boundaryKind: input.boundaryKind ?? 'http-request',
      consequenceType: input.consequenceType ?? 'decision-support',
      riskClass: input.riskClass ?? 'R1',
      tenantId: 'tenant-test',
      accountId: 'acct-test',
      workloadId: 'spiffe://attestor/tests/token-exchange',
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

async function testAudienceScopedExchangeIssuesDownstreamToken(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-exchange-r1',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_exchange_r1',
  });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-r1-audience',
      requestedAt: '2026-04-18T10:01:00.000Z',
      subjectToken: parent.token,
      audience: 'analytics.memo.writer',
      resource: 'https://api.attestor.test/memo/',
      scope: ['release:decision-support', 'memo:write', 'memo:write'],
      ttlSeconds: 120,
      tokenId: 'rtx_memo_writer',
      actor: {
        id: 'svc.memo-gateway',
        type: 'service',
        displayName: 'Memo Gateway',
        role: 'downstream-writer',
      },
    },
    issuer,
    verificationKey,
    sourceAudience: 'attestor.release.authority',
    policy: {
      allowedAudiences: ['analytics.memo.writer'],
      allowedSourceAudiences: ['attestor.release.authority'],
      allowedScopes: ['release:decision-support', 'memo:write'],
      allowedResources: ['https://api.attestor.test/memo/'],
      maxTtlSeconds: 120,
      maxUses: 1,
      requireActor: true,
    },
  });

  equal(exchanged.version, RELEASE_TOKEN_EXCHANGE_SPEC_VERSION, 'Token exchange: result stamps stable spec version');
  equal(exchanged.grantType, RELEASE_TOKEN_EXCHANGE_GRANT_TYPE, 'Token exchange: result records token-exchange grant type');
  equal(exchanged.status, 'issued', 'Token exchange: allowed request issues a downstream token');
  equal(exchanged.issuedTokenType, ATTESTOR_RELEASE_TOKEN_TYPE, 'Token exchange: issued token type is explicit');
  equal(exchanged.audience, 'analytics.memo.writer', 'Token exchange: result is scoped to requested audience');
  deepEqual(exchanged.scope, ['memo:write', 'release:decision-support'], 'Token exchange: requested scope is normalized and narrowed');
  equal(exchanged.resource, 'https://api.attestor.test/memo/', 'Token exchange: resource URI is preserved');
  equal(exchanged.actorChain.length, 1, 'Token exchange: actor chain contains the current actor');

  if (exchanged.status !== 'issued') {
    throw new Error('Expected token exchange to issue.');
  }

  equal(exchanged.issuedToken.claims.aud, 'analytics.memo.writer', 'Token exchange: JWT audience is narrowed');
  equal(exchanged.issuedToken.claims.scope, 'memo:write release:decision-support', 'Token exchange: JWT scope is explicit');
  equal(exchanged.issuedToken.claims.resource, 'https://api.attestor.test/memo/', 'Token exchange: JWT resource is explicit');
  equal(exchanged.issuedToken.claims.parent_jti, 'rt_parent_exchange_r1', 'Token exchange: JWT links to parent token');
  equal(exchanged.issuedToken.claims.exchange_id, 'exchange-r1-audience', 'Token exchange: JWT carries exchange id');
  equal(exchanged.issuedToken.claims.source_aud, 'attestor.release.authority', 'Token exchange: JWT records source audience');
  equal(exchanged.issuedToken.claims.token_use, 'exchanged-release', 'Token exchange: JWT marks exchanged release use');
  equal(exchanged.issuedToken.claims.act?.sub, 'svc.memo-gateway', 'Token exchange: JWT carries actor claim');

  const request = makeRequest({
    id: 'erq-exchanged-r1',
    targetId: 'analytics.memo.writer',
    releaseTokenId: exchanged.issuedToken.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: bearerPresentation({ issued: exchanged.issuedToken }),
    verificationKey,
    now: '2026-04-18T10:01:30.000Z',
  });

  equal(verified.status, 'valid', 'Token exchange: downstream verifier accepts narrowed token for the target audience');
  equal(verified.claims?.aud, 'analytics.memo.writer', 'Token exchange: verifier sees downstream audience');
}

async function testExchangeDoesNotBroadenAudience(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-disallowed-audience',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_disallowed_audience',
  });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-disallowed-audience',
      requestedAt: '2026-04-18T10:01:00.000Z',
      subjectToken: parent.token,
      audience: 'payments.writer',
      scope: 'release:decision-support',
    },
    issuer,
    verificationKey,
    policy: {
      allowedAudiences: ['analytics.memo.writer'],
      allowedScopes: ['release:decision-support'],
    },
  });

  equal(exchanged.status, 'denied', 'Token exchange: disallowed audience is denied');
  ok(exchanged.failureReasons.includes('audience-not-allowed'), 'Token exchange: audience denial reason is explicit');
  equal(exchanged.issuedToken, null, 'Token exchange: denied exchange does not issue a token');
}

async function testExchangeRejectsDisallowedScopeAndResource(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-disallowed-scope',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_disallowed_scope',
  });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-disallowed-scope',
      requestedAt: '2026-04-18T10:01:00.000Z',
      subjectToken: parent.token,
      audience: 'analytics.memo.writer',
      resource: 'https://evil.example/api/',
      scope: 'admin:write',
    },
    issuer,
    verificationKey,
    policy: {
      allowedAudiences: ['analytics.memo.writer'],
      allowedScopes: ['release:decision-support', 'memo:write'],
      allowedResources: ['https://api.attestor.test/memo/'],
    },
  });

  equal(exchanged.status, 'denied', 'Token exchange: disallowed scope/resource is denied');
  ok(exchanged.failureReasons.includes('scope-not-allowed'), 'Token exchange: disallowed scope is explicit');
  ok(exchanged.failureReasons.includes('resource-not-allowed'), 'Token exchange: disallowed resource is explicit');
}

async function testExchangeCapsTtlToSubjectTokenLifetime(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-ttl-cap',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_ttl_cap',
    ttlSeconds: 90,
  });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-ttl-cap',
      requestedAt: '2026-04-18T10:00:10.000Z',
      subjectToken: parent.token,
      audience: 'analytics.memo.writer',
      scope: 'release:decision-support',
      ttlSeconds: 300,
      tokenId: 'rtx_ttl_cap',
    },
    issuer,
    verificationKey,
    policy: {
      allowedAudiences: ['analytics.memo.writer'],
      allowedScopes: ['release:decision-support'],
      maxTtlSeconds: 600,
    },
  });

  equal(exchanged.status, 'issued', 'Token exchange: subject-lifetime-capped exchange succeeds');
  if (exchanged.status !== 'issued') {
    throw new Error('Expected token exchange to issue.');
  }
  equal(exchanged.ttlSeconds, 80, 'Token exchange: child TTL is capped by parent token remaining lifetime');
  equal(exchanged.issuedToken.claims.exp - exchanged.issuedToken.claims.iat, 80, 'Token exchange: JWT TTL matches cap');
}

async function testExchangeRejectsExpiredSubject(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-expired-subject',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_expired',
    ttlSeconds: 30,
  });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-expired-subject',
      requestedAt: '2026-04-18T10:02:00.000Z',
      subjectToken: parent.token,
      audience: 'analytics.memo.writer',
      scope: 'release:decision-support',
    },
    issuer,
    verificationKey,
    policy: {
      allowedAudiences: ['analytics.memo.writer'],
      allowedScopes: ['release:decision-support'],
    },
  });

  equal(exchanged.status, 'denied', 'Token exchange: expired subject token is denied');
  deepEqual(exchanged.failureReasons, ['expired-subject-token'], 'Token exchange: expired subject reason is explicit');
}

async function testExchangePreservesActorChain(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-actor-chain',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_actor_chain',
    actor: {
      sub: 'svc.orchestrator',
      actor_type: 'service',
      role: 'agent-orchestrator',
    },
  });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-actor-chain',
      requestedAt: '2026-04-18T10:01:00.000Z',
      subjectToken: parent.token,
      audience: 'analytics.memo.writer',
      scope: 'release:decision-support',
      actor: {
        id: 'svc.memo-gateway',
        type: 'service',
        role: 'downstream-writer',
      },
    },
    issuer,
    verificationKey,
    policy: {
      allowedAudiences: ['analytics.memo.writer'],
      allowedScopes: ['release:decision-support'],
      requireActor: true,
    },
  });

  equal(exchanged.status, 'issued', 'Token exchange: actor-chain exchange succeeds');
  if (exchanged.status !== 'issued') {
    throw new Error('Expected token exchange to issue.');
  }
  equal(exchanged.actorChain.length, 2, 'Token exchange: actor chain keeps current and previous actors');
  equal(exchanged.issuedToken.claims.act?.sub, 'svc.memo-gateway', 'Token exchange: current actor is first in JWT actor chain');
  equal(exchanged.issuedToken.claims.act?.act?.sub, 'svc.orchestrator', 'Token exchange: parent actor is nested in JWT actor chain');
}

async function testHighRiskExchangeRegistersForOnlineVerifier(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision({
    id: 'decision-r4-exchange',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_r4_exchange',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  store.registerIssuedToken({ issuedToken: parent, decision });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-r4-record',
      requestedAt: '2026-04-18T10:00:30.000Z',
      subjectToken: parent.token,
      audience: 'finance.reporting.record-store',
      resource: 'https://records.attestor.test/finance/',
      scope: 'record:write',
      actor: {
        id: 'svc.finance-writer',
        type: 'service',
        role: 'record-writer',
      },
      tokenId: 'rtx_finance_record',
    },
    issuer,
    verificationKey,
    sourceAudience: 'attestor.release.authority',
    subjectIntrospector: introspector,
    store,
    policy: {
      allowedAudiences: ['finance.reporting.record-store'],
      allowedSourceAudiences: ['attestor.release.authority'],
      allowedScopes: ['record:write'],
      allowedResources: ['https://records.attestor.test/finance/'],
      maxTtlSeconds: 60,
      maxUses: 1,
      requireActor: true,
    },
  });

  equal(exchanged.status, 'issued', 'Token exchange: high-risk exchange issues registered child token');
  if (exchanged.status !== 'issued') {
    throw new Error('Expected token exchange to issue.');
  }

  const request = makeRequest({
    id: 'erq-exchanged-r4',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: exchanged.issuedToken.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: mtlsPresentation({ issued: exchanged.issuedToken }),
    verificationKey,
    now: '2026-04-18T10:01:00.000Z',
    introspector,
    resourceServerId: 'erq-exchanged-r4-pep',
  });

  equal(verified.status, 'valid', 'Token exchange: registered high-risk child token passes online enforcement');
  equal(verified.active, true, 'Token exchange: online verifier sees child token active');
  equal(verified.introspection?.scope, 'record:write', 'Token exchange: introspection exposes narrowed scope');
  equal(verified.freshness?.introspectionCache.status, 'fresh', 'Token exchange: online freshness is fresh');
}

async function testExchangeRejectsRevokedSubjectWhenIntrospectionIsRequired(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision({
    id: 'decision-revoked-subject',
    consequenceType: 'record',
    riskClass: 'R4',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_revoked_subject',
  });
  store.registerIssuedToken({ issuedToken: parent, decision });
  store.revokeToken({
    tokenId: parent.tokenId,
    revokedAt: '2026-04-18T10:00:20.000Z',
    reason: 'release withdrawn before exchange',
    revokedBy: 'risk-admin',
  });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-revoked-subject',
      requestedAt: '2026-04-18T10:01:00.000Z',
      subjectToken: parent.token,
      audience: 'finance.reporting.record-store',
      scope: 'record:write',
      actor: {
        id: 'svc.finance-writer',
        type: 'service',
      },
    },
    issuer,
    verificationKey,
    sourceAudience: 'attestor.release.authority',
    subjectIntrospector: introspector,
    policy: {
      allowedAudiences: ['finance.reporting.record-store'],
      allowedSourceAudiences: ['attestor.release.authority'],
      allowedScopes: ['record:write'],
      requireActor: true,
    },
  });

  equal(exchanged.status, 'denied', 'Token exchange: revoked subject token cannot be exchanged');
  deepEqual(exchanged.failureReasons, ['inactive-subject-token'], 'Token exchange: inactive subject reason is explicit');
}

async function testExchangeRejectsInvalidResourceUri(): Promise<void> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-invalid-resource',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'attestor.release.authority',
  });
  const parent = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T10:00:00.000Z',
    tokenId: 'rt_parent_invalid_resource',
  });

  const exchanged = await exchangeReleaseToken({
    request: {
      id: 'exchange-invalid-resource',
      requestedAt: '2026-04-18T10:01:00.000Z',
      subjectToken: parent.token,
      audience: 'analytics.memo.writer',
      resource: 'not a uri',
      scope: 'release:decision-support',
    },
    issuer,
    verificationKey,
    policy: {
      allowedAudiences: ['analytics.memo.writer'],
      allowedScopes: ['release:decision-support'],
    },
  });

  equal(exchanged.status, 'denied', 'Token exchange: invalid resource URI is denied');
  deepEqual(exchanged.failureReasons, ['invalid-target'], 'Token exchange: invalid target reason is explicit');
}

async function main(): Promise<void> {
  await testAudienceScopedExchangeIssuesDownstreamToken();
  await testExchangeDoesNotBroadenAudience();
  await testExchangeRejectsDisallowedScopeAndResource();
  await testExchangeCapsTtlToSubjectTokenLifetime();
  await testExchangeRejectsExpiredSubject();
  await testExchangePreservesActorChain();
  await testHighRiskExchangeRegistersForOnlineVerifier();
  await testExchangeRejectsRevokedSubjectWhenIntrospectionIsRequired();
  await testExchangeRejectsInvalidResourceUri();

  console.log(`Release enforcement-plane token-exchange tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane token-exchange tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
