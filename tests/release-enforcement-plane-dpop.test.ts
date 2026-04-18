import assert from 'node:assert/strict';
import { SignJWT, importJWK } from 'jose';
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
} from '../src/release-enforcement-plane/object-model.js';
import {
  DPOP_PROOF_JWT_TYPE,
  DPOP_PRESENTATION_SPEC_VERSION,
  createDpopBoundPresentationFromIssuedToken,
  createDpopProof,
  dpopAccessTokenHash,
  dpopReplayKey,
  generateDpopKeyPair,
  normalizeDpopHttpUri,
  verifyDpopProof,
  type DpopKeyPair,
} from '../src/release-enforcement-plane/dpop.js';
import { verifyOfflineReleaseAuthorization } from '../src/release-enforcement-plane/offline-verifier.js';
import { verifyOnlineReleaseAuthorization } from '../src/release-enforcement-plane/online-verifier.js';

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

function makeDecision(input: {
  readonly id: string;
  readonly consequenceType: 'record' | 'decision-support';
  readonly riskClass: 'R1' | 'R4';
  readonly targetId: string;
}) {
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T11:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-dpop-test.v1',
    policyHash: 'sha256:policy',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'release-dpop-test.artifact',
      expectedShape: 'deterministic test artifact',
      consequenceType: input.consequenceType,
      riskClass: input.riskClass,
    },
    capabilityBoundary: {
      allowedTools: ['release-dpop-test-tool'],
      allowedTargets: [input.targetId],
      allowedDataDomains: ['release-dpop-test'],
    },
    requester: {
      id: 'svc.release-dpop-test',
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
  readonly uri?: string;
  readonly method?: string;
  readonly consequenceType?: 'record' | 'decision-support';
  readonly riskClass?: 'R1' | 'R4';
  readonly boundaryKind?: 'http-request' | 'record-write';
  readonly pointKind?: 'application-middleware' | 'record-write-gateway';
  readonly releaseTokenId: string;
  readonly releaseDecisionId: string;
}): EnforcementRequest {
  return createEnforcementRequest({
    id: input.id,
    receivedAt: '2026-04-18T11:01:00.000Z',
    enforcementPoint: {
      environment: 'test',
      enforcementPointId: `${input.id}-pep`,
      pointKind: input.pointKind ?? 'application-middleware',
      boundaryKind: input.boundaryKind ?? 'http-request',
      consequenceType: input.consequenceType ?? 'decision-support',
      riskClass: input.riskClass ?? 'R1',
      tenantId: 'tenant-test',
      accountId: 'acct-test',
      workloadId: 'spiffe://attestor/tests/dpop',
      audience: input.targetId,
    },
    targetId: input.targetId,
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    releaseTokenId: input.releaseTokenId,
    releaseDecisionId: input.releaseDecisionId,
    transport: {
      kind: 'http',
      method: input.method ?? 'POST',
      uri: input.uri ?? `https://attestor.test/${input.id}?debug=true#fragment`,
      headersDigest: 'sha256:headers',
      bodyDigest: 'sha256:body',
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

async function issueDpopBoundToken(input: {
  readonly dpopKeyPair: DpopKeyPair;
  readonly tokenId: string;
  readonly decisionId: string;
  readonly targetId: string;
  readonly consequenceType?: 'record' | 'decision-support';
  readonly riskClass?: 'R1' | 'R4';
}) {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    consequenceType: input.consequenceType ?? 'decision-support',
    riskClass: input.riskClass ?? 'R1',
    targetId: input.targetId,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T11:00:00.000Z',
    tokenId: input.tokenId,
    confirmation: {
      jkt: input.dpopKeyPair.publicKeyThumbprint,
    },
  });

  return {
    issuer,
    verificationKey,
    decision,
    issued,
  };
}

async function testDpopProofCreationAndVerification(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const proof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'post',
    httpUri: 'https://api.attestor.test/memo?debug=true#fragment',
    accessToken: 'release-token-value',
    nonce: 'nonce-1',
    proofJti: 'dpop-proof-1',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });

  equal(proof.version, DPOP_PRESENTATION_SPEC_VERSION, 'DPoP: proof stamps stable spec version');
  equal(proof.httpMethod, 'POST', 'DPoP: method is normalized');
  equal(proof.httpUri, 'https://api.attestor.test/memo', 'DPoP: htu removes query and fragment');
  equal(proof.accessTokenHash, dpopAccessTokenHash('release-token-value'), 'DPoP: ath hashes the access token');
  equal(proof.publicKeyThumbprint, dpopKey.publicKeyThumbprint, 'DPoP: proof exposes JWK thumbprint');

  const verified = await verifyDpopProof({
    proofJwt: proof.proofJwt,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo?debug=true#fragment',
    accessToken: 'release-token-value',
    expectedJwkThumbprint: dpopKey.publicKeyThumbprint,
    expectedNonce: 'nonce-1',
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(verified.status, 'valid', 'DPoP: valid proof verifies');
  equal(verified.proofJti, 'dpop-proof-1', 'DPoP: verifier keeps proof jti');
  equal(verified.httpUri, normalizeDpopHttpUri('https://api.attestor.test/memo?debug=true#fragment'), 'DPoP: verifier keeps normalized htu');
  deepEqual(verified.failureReasons, [], 'DPoP: valid proof has no failure reasons');
}

async function testOfflineVerifierAcceptsDpopBoundToken(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { verificationKey, decision, issued } = await issueDpopBoundToken({
    dpopKeyPair: dpopKey,
    tokenId: 'rt_dpop_offline',
    decisionId: 'decision-dpop-offline',
    targetId: 'analytics.memo.writer',
  });
  const request = makeRequest({
    id: 'erq-dpop-offline',
    targetId: 'analytics.memo.writer',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const proof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: request.transport?.kind === 'http' ? request.transport.uri : '',
    accessToken: issued.token,
    proofJti: 'dpop-proof-offline',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });
  const presentation = createDpopBoundPresentationFromIssuedToken({
    issuedToken: issued,
    proof,
    presentedAt: '2026-04-18T11:01:00.000Z',
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation,
    verificationKey,
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(verified.status, 'valid', 'DPoP: offline verifier accepts matching DPoP-bound release token');
  equal(verified.offlineVerified, true, 'DPoP: offline verifier records local verification success');
  deepEqual(verified.failureReasons, [], 'DPoP: matching proof has no failure reasons');
  equal(verified.freshness?.replay.replayKey, dpopReplayKey('dpop-proof-offline'), 'DPoP: freshness tracks proof jti replay key');
}

async function testOfflineVerifierRejectsWrongMethod(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { verificationKey, decision, issued } = await issueDpopBoundToken({
    dpopKeyPair: dpopKey,
    tokenId: 'rt_dpop_wrong_method',
    decisionId: 'decision-dpop-wrong-method',
    targetId: 'analytics.memo.writer',
  });
  const request = makeRequest({
    id: 'erq-dpop-wrong-method',
    targetId: 'analytics.memo.writer',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const proof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'GET',
    httpUri: request.transport?.kind === 'http' ? request.transport.uri : '',
    accessToken: issued.token,
    proofJti: 'dpop-proof-wrong-method',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createDpopBoundPresentationFromIssuedToken({
      issuedToken: issued,
      proof,
      presentedAt: '2026-04-18T11:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'DPoP: wrong HTTP method is invalid');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'DPoP: wrong method maps to binding mismatch');
}

async function testOfflineVerifierRejectsWrongAccessTokenHash(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { verificationKey, decision, issued } = await issueDpopBoundToken({
    dpopKeyPair: dpopKey,
    tokenId: 'rt_dpop_wrong_ath',
    decisionId: 'decision-dpop-wrong-ath',
    targetId: 'analytics.memo.writer',
  });
  const request = makeRequest({
    id: 'erq-dpop-wrong-ath',
    targetId: 'analytics.memo.writer',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const proof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: request.transport?.kind === 'http' ? request.transport.uri : '',
    accessToken: 'not-the-release-token',
    proofJti: 'dpop-proof-wrong-ath',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createDpopBoundPresentationFromIssuedToken({
      issuedToken: issued,
      proof,
      presentedAt: '2026-04-18T11:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'DPoP: wrong access-token hash is invalid');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'DPoP: ath mismatch maps to binding mismatch');
}

async function testOfflineVerifierRejectsWrongConfirmationKey(): Promise<void> {
  const tokenKey = await generateDpopKeyPair();
  const proofKey = await generateDpopKeyPair();
  const { verificationKey, decision, issued } = await issueDpopBoundToken({
    dpopKeyPair: tokenKey,
    tokenId: 'rt_dpop_wrong_key',
    decisionId: 'decision-dpop-wrong-key',
    targetId: 'analytics.memo.writer',
  });
  const request = makeRequest({
    id: 'erq-dpop-wrong-key',
    targetId: 'analytics.memo.writer',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const proof = await createDpopProof({
    privateJwk: proofKey.privateJwk,
    publicJwk: proofKey.publicJwk,
    httpMethod: 'POST',
    httpUri: request.transport?.kind === 'http' ? request.transport.uri : '',
    accessToken: issued.token,
    proofJti: 'dpop-proof-wrong-key',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createDpopBoundPresentationFromIssuedToken({
      issuedToken: issued,
      proof,
      presentedAt: '2026-04-18T11:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'DPoP: proof key must match release token cnf.jkt');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'DPoP: key mismatch maps to binding mismatch');
}

async function testOfflineVerifierRejectsUnboundToken(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: 'decision-dpop-unbound',
    consequenceType: 'decision-support',
    riskClass: 'R1',
    targetId: 'analytics.memo.writer',
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T11:00:00.000Z',
    tokenId: 'rt_dpop_unbound',
  });
  const request = makeRequest({
    id: 'erq-dpop-unbound',
    targetId: 'analytics.memo.writer',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const proof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: request.transport?.kind === 'http' ? request.transport.uri : '',
    accessToken: issued.token,
    proofJti: 'dpop-proof-unbound',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createDpopBoundPresentationFromIssuedToken({
      issuedToken: issued,
      proof,
      presentedAt: '2026-04-18T11:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'DPoP: DPoP presentation requires a cnf-bound release token');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'DPoP: missing cnf maps to binding mismatch');
}

async function testDpopReplayLedgerHitFails(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const proof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    proofJti: 'dpop-proof-replay',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });

  const verified = await verifyDpopProof({
    proofJwt: proof.proofJwt,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    expectedJwkThumbprint: dpopKey.publicKeyThumbprint,
    now: '2026-04-18T11:01:10.000Z',
    replayLedgerEntry: {
      subjectKind: 'dpop-proof',
      key: dpopReplayKey('dpop-proof-replay'),
      firstSeenAt: '2026-04-18T11:01:00.000Z',
      expiresAt: '2026-04-18T11:03:00.000Z',
    },
  });

  equal(verified.status, 'invalid', 'DPoP: replay ledger hit is invalid');
  deepEqual(verified.failureReasons, ['replayed-authorization'], 'DPoP: replay reason is explicit');
}

async function testDpopStaleAndFutureProofsFail(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const staleProof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    proofJti: 'dpop-proof-stale',
    issuedAt: '2026-04-18T11:00:00.000Z',
  });
  const futureProof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    proofJti: 'dpop-proof-future',
    issuedAt: '2026-04-18T11:05:00.000Z',
  });

  const stale = await verifyDpopProof({
    proofJwt: staleProof.proofJwt,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    expectedJwkThumbprint: dpopKey.publicKeyThumbprint,
    now: '2026-04-18T11:03:31.000Z',
    maxProofAgeSeconds: 120,
    clockSkewSeconds: 30,
  });
  const future = await verifyDpopProof({
    proofJwt: futureProof.proofJwt,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    expectedJwkThumbprint: dpopKey.publicKeyThumbprint,
    now: '2026-04-18T11:01:00.000Z',
    maxProofAgeSeconds: 120,
    clockSkewSeconds: 30,
  });

  ok(stale.failureReasons.includes('stale-authorization'), 'DPoP: stale proof is rejected');
  ok(future.failureReasons.includes('future-issued-at'), 'DPoP: future proof is rejected');
}

async function testDpopNonceChecks(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const withNonce = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    nonce: 'nonce-good',
    proofJti: 'dpop-proof-nonce-good',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });
  const withoutNonce = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    proofJti: 'dpop-proof-nonce-missing',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });

  const valid = await verifyDpopProof({
    proofJwt: withNonce.proofJwt,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    expectedJwkThumbprint: dpopKey.publicKeyThumbprint,
    expectedNonce: 'nonce-good',
    now: '2026-04-18T11:01:10.000Z',
  });
  const missing = await verifyDpopProof({
    proofJwt: withoutNonce.proofJwt,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    expectedJwkThumbprint: dpopKey.publicKeyThumbprint,
    expectedNonce: 'nonce-good',
    now: '2026-04-18T11:01:10.000Z',
  });
  const mismatch = await verifyDpopProof({
    proofJwt: withNonce.proofJwt,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    expectedJwkThumbprint: dpopKey.publicKeyThumbprint,
    expectedNonce: 'nonce-other',
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(valid.status, 'valid', 'DPoP: expected nonce verifies');
  deepEqual(missing.failureReasons, ['missing-nonce'], 'DPoP: missing nonce is explicit');
  deepEqual(mismatch.failureReasons, ['invalid-nonce'], 'DPoP: wrong nonce is explicit');
}

async function testDpopHeaderCannotCarryPrivateKey(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const privateKey = await importJWK(dpopKey.privateJwk, dpopKey.algorithm);
  const proofJwt = await new SignJWT({
    jti: 'dpop-private-header',
    htm: 'POST',
    htu: 'https://api.attestor.test/memo',
    iat: 1776500460,
    ath: dpopAccessTokenHash('release-token-value'),
  })
    .setProtectedHeader({
      typ: DPOP_PROOF_JWT_TYPE,
      alg: dpopKey.algorithm,
      jwk: dpopKey.privateJwk,
    })
    .sign(privateKey);

  const verified = await verifyDpopProof({
    proofJwt,
    httpMethod: 'POST',
    httpUri: 'https://api.attestor.test/memo',
    accessToken: 'release-token-value',
    expectedJwkThumbprint: dpopKey.publicKeyThumbprint,
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'DPoP: proof header cannot expose private JWK material');
  deepEqual(verified.failureReasons, ['invalid-signature'], 'DPoP: private header is treated as invalid proof');
}

async function testHighRiskDpopPresentationWorksWithOnlineVerifier(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { verificationKey, decision, issued } = await issueDpopBoundToken({
    dpopKeyPair: dpopKey,
    tokenId: 'rt_dpop_r4',
    decisionId: 'decision-dpop-r4',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
  });
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  store.registerIssuedToken({ issuedToken: issued, decision });
  const request = makeRequest({
    id: 'erq-dpop-r4',
    targetId: 'finance.reporting.record-store',
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
    pointKind: 'record-write-gateway',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const proof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: request.transport?.kind === 'http' ? request.transport.uri : '',
    accessToken: issued.token,
    nonce: 'nonce-r4',
    proofJti: 'dpop-proof-r4',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });

  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: createDpopBoundPresentationFromIssuedToken({
      issuedToken: issued,
      proof,
      presentedAt: '2026-04-18T11:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T11:01:10.000Z',
    introspector,
    nonceLedgerEntry: {
      nonce: 'nonce-r4',
      issuedAt: '2026-04-18T11:00:50.000Z',
      expiresAt: '2026-04-18T11:01:30.000Z',
    },
    resourceServerId: 'erq-dpop-r4-pep',
  });

  equal(verified.status, 'valid', 'DPoP: high-risk DPoP-bound token passes online verifier');
  equal(verified.offline.freshness?.nonce.status, 'valid', 'DPoP: R4 nonce freshness is valid');
  equal(verified.freshness?.replay.replayKey, dpopReplayKey('dpop-proof-r4'), 'DPoP: online verifier preserves DPoP replay key');
}

async function testDpopPresentationMetadataTamperingFails(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { verificationKey, decision, issued } = await issueDpopBoundToken({
    dpopKeyPair: dpopKey,
    tokenId: 'rt_dpop_metadata_tamper',
    decisionId: 'decision-dpop-metadata-tamper',
    targetId: 'analytics.memo.writer',
  });
  const request = makeRequest({
    id: 'erq-dpop-metadata-tamper',
    targetId: 'analytics.memo.writer',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const proof = await createDpopProof({
    privateJwk: dpopKey.privateJwk,
    publicJwk: dpopKey.publicJwk,
    httpMethod: 'POST',
    httpUri: request.transport?.kind === 'http' ? request.transport.uri : '',
    accessToken: issued.token,
    proofJti: 'dpop-proof-metadata-tamper',
    issuedAt: '2026-04-18T11:01:00.000Z',
  });
  const tampered = createReleasePresentation({
    mode: 'dpop-bound-token',
    presentedAt: '2026-04-18T11:01:00.000Z',
    releaseToken: issued.token,
    releaseTokenId: issued.tokenId,
    issuer: issued.claims.iss,
    subject: issued.claims.sub,
    audience: issued.claims.aud,
    expiresAt: issued.expiresAt,
    proof: {
      kind: 'dpop',
      proofJwt: proof.proofJwt,
      httpMethod: proof.httpMethod,
      httpUri: proof.httpUri,
      proofJti: 'different-proof-jti',
      accessTokenHash: proof.accessTokenHash,
      nonce: proof.nonce,
      keyThumbprint: proof.publicKeyThumbprint,
    },
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: tampered,
    verificationKey,
    now: '2026-04-18T11:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'DPoP: presentation metadata must match signed proof JWT');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'DPoP: metadata tampering maps to binding mismatch');
}

async function main(): Promise<void> {
  await testDpopProofCreationAndVerification();
  await testOfflineVerifierAcceptsDpopBoundToken();
  await testOfflineVerifierRejectsWrongMethod();
  await testOfflineVerifierRejectsWrongAccessTokenHash();
  await testOfflineVerifierRejectsWrongConfirmationKey();
  await testOfflineVerifierRejectsUnboundToken();
  await testDpopReplayLedgerHitFails();
  await testDpopStaleAndFutureProofsFail();
  await testDpopNonceChecks();
  await testDpopHeaderCannotCarryPrivateKey();
  await testHighRiskDpopPresentationWorksWithOnlineVerifier();
  await testDpopPresentationMetadataTamperingFails();

  console.log(`Release enforcement-plane DPoP tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane DPoP tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
