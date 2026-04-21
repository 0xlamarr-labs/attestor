import assert from 'node:assert/strict';
import { generateKeyPair } from '../src/signing/keys.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createReleaseTokenIssuer,
  type IssuedReleaseToken,
  type ReleaseTokenVerificationKey,
} from '../src/release-kernel/release-token.js';
import type { ReleaseDecision } from '../src/release-kernel/object-model.js';
import {
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
} from '../src/release-kernel/release-introspection.js';
import {
  createEnforcementRequest,
  createReleasePresentation,
  type EnforcementRequest,
} from '../src/release-enforcement-plane/object-model.js';
import { verifyOfflineReleaseAuthorization } from '../src/release-enforcement-plane/offline-verifier.js';
import { verifyOnlineReleaseAuthorization } from '../src/release-enforcement-plane/online-verifier.js';
import {
  ATTESTOR_CONSEQUENCE_HASH_HEADER,
  ATTESTOR_OUTPUT_HASH_HEADER,
  ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
  DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS,
  HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION,
  contentDigestForBody,
  createHttpAuthorizationEnvelope,
  createHttpMessageSignature,
  createHttpMessageSignatureReleaseTokenConfirmation,
  generateHttpMessageSignatureKeyPair,
  httpMessageFromAuthorizationEnvelope,
  httpReleaseTokenDigest,
  normalizeHttpSignatureTargetUri,
  verifyHttpMessageSignature,
  type HttpAuthorizationEnvelope,
  type HttpMessageSignatureKeyPair,
} from '../src/release-enforcement-plane/http-message-signatures.js';

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

const BODY = JSON.stringify({
  event: 'release.accepted',
  consequence: 'callback.dispatch',
});
const TARGET_ID = 'callbacks.attestor.receiver';

function makeDecision(input: {
  readonly id: string;
  readonly consequenceType?: 'decision-support' | 'action' | 'communication';
  readonly riskClass?: 'R1' | 'R3';
  readonly targetId?: string;
}) {
  const consequenceType = input.consequenceType ?? 'decision-support';
  const targetId = input.targetId ?? TARGET_ID;
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T13:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-http-signature-test.v1',
    policyHash: 'sha256:policy',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'release-http-signature-test.artifact',
      expectedShape: 'deterministic callback payload',
      consequenceType,
      riskClass: input.riskClass ?? 'R1',
    },
    capabilityBoundary: {
      allowedTools: ['release-http-signature-test-tool'],
      allowedTargets: [targetId],
      allowedDataDomains: ['release-http-signature-test'],
    },
    requester: {
      id: 'svc.release-http-signature-test',
      type: 'service',
    },
    target: {
      kind: consequenceType === 'action' ? 'workflow' : 'endpoint',
      id: targetId,
    },
  });
}

function makeRequest(input: {
  readonly id: string;
  readonly targetId?: string;
  readonly uri?: string;
  readonly boundaryKind?: 'http-request' | 'webhook';
  readonly pointKind?: 'application-middleware' | 'webhook-receiver';
  readonly consequenceType?: 'decision-support' | 'action' | 'communication';
  readonly riskClass?: 'R1' | 'R3';
  readonly releaseTokenId: string;
  readonly releaseDecisionId: string;
}): EnforcementRequest {
  const boundaryKind = input.boundaryKind ?? 'http-request';
  const pointKind = input.pointKind ?? 'application-middleware';
  return createEnforcementRequest({
    id: input.id,
    receivedAt: '2026-04-18T13:01:00.000Z',
    enforcementPoint: {
      environment: 'test',
      enforcementPointId: `${input.id}-pep`,
      pointKind,
      boundaryKind,
      consequenceType: input.consequenceType ?? 'decision-support',
      riskClass: input.riskClass ?? 'R1',
      tenantId: 'tenant-test',
      accountId: 'acct-test',
      workloadId: 'spiffe://attestor/tests/http-signature',
      audience: input.targetId ?? TARGET_ID,
    },
    targetId: input.targetId ?? TARGET_ID,
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    releaseTokenId: input.releaseTokenId,
    releaseDecisionId: input.releaseDecisionId,
    transport: {
      kind: 'http',
      method: 'POST',
      uri: input.uri ?? 'https://callbacks.attestor.test/v1/release?attempt=1',
      headersDigest: 'sha256:headers',
      bodyDigest: contentDigestForBody(BODY),
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

async function issueHttpSignatureBoundToken(input: {
  readonly signatureKey: HttpMessageSignatureKeyPair;
  readonly tokenId: string;
  readonly decisionId: string;
  readonly targetId?: string;
  readonly consequenceType?: 'decision-support' | 'action' | 'communication';
  readonly riskClass?: 'R1' | 'R3';
  readonly bindToSignatureKey?: boolean;
}): Promise<{
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly decision: ReleaseDecision;
}> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    consequenceType: input.consequenceType,
    riskClass: input.riskClass,
    targetId: input.targetId,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T13:00:00.000Z',
    tokenId: input.tokenId,
    confirmation:
      input.bindToSignatureKey === false
        ? undefined
        : createHttpMessageSignatureReleaseTokenConfirmation({
            publicKeyThumbprint: input.signatureKey.publicKeyThumbprint,
          }),
  });

  return { issued, verificationKey, decision };
}

async function makeEnvelope(input: {
  readonly signatureKey: HttpMessageSignatureKeyPair;
  readonly issued: IssuedReleaseToken;
  readonly uri?: string;
  readonly nonce?: string | null;
  readonly body?: string;
  readonly coveredComponents?: readonly string[];
}): Promise<HttpAuthorizationEnvelope> {
  return createHttpAuthorizationEnvelope({
    request: {
      method: 'post',
      uri: input.uri ?? 'https://callbacks.attestor.test/v1/release?attempt=1#client-fragment',
      headers: {
        'content-type': 'application/json',
      },
      body: input.body ?? BODY,
    },
    issuedToken: input.issued,
    privateJwk: input.signatureKey.privateJwk,
    publicJwk: input.signatureKey.publicJwk,
    coveredComponents: input.coveredComponents,
    createdAt: '2026-04-18T13:01:00.000Z',
    expiresAt: '2026-04-18T13:02:00.000Z',
    nonce: input.nonce === undefined ? 'nonce-http-1' : input.nonce,
    presentedAt: '2026-04-18T13:01:00.000Z',
  });
}

async function testEnvelopeCreationAndVerification(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_create',
    decisionId: 'decision-http-sig-create',
  });
  const envelope = await makeEnvelope({ signatureKey, issued });

  equal(envelope.version, HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION, 'HTTP signatures: envelope stamps stable spec version');
  equal(envelope.method, 'POST', 'HTTP signatures: method is normalized');
  equal(envelope.uri, 'https://callbacks.attestor.test/v1/release?attempt=1', 'HTTP signatures: target URI strips fragments and keeps query');
  equal(envelope.bodyDigest, contentDigestForBody(BODY), 'HTTP signatures: Content-Digest covers the request body');
  equal(envelope.releaseTokenDigest, httpReleaseTokenDigest(issued.token), 'HTTP signatures: release-token digest is exposed');
  equal(envelope.headers[ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER], httpReleaseTokenDigest(issued.token), 'HTTP signatures: release-token digest header is present');
  equal(envelope.headers[ATTESTOR_TARGET_ID_HEADER], TARGET_ID, 'HTTP signatures: target-id header is present');
  equal(envelope.headers[ATTESTOR_OUTPUT_HASH_HEADER], 'sha256:output', 'HTTP signatures: output hash header is present');
  equal(envelope.headers[ATTESTOR_CONSEQUENCE_HASH_HEADER], 'sha256:consequence', 'HTTP signatures: consequence hash header is present');
  ok(envelope.coveredComponents.includes('authorization'), 'HTTP signatures: Authorization is signed');
  ok(envelope.coveredComponents.includes('content-digest'), 'HTTP signatures: Content-Digest is signed');
  equal(envelope.presentation.mode, 'http-message-signature', 'HTTP signatures: envelope creates release presentation');

  const verified = await verifyHttpMessageSignature({
    message: httpMessageFromAuthorizationEnvelope(envelope, BODY),
    signatureInput: envelope.signatureInput,
    signature: envelope.signature,
    publicJwk: signatureKey.publicJwk,
    expectedKeyId: signatureKey.keyId,
    expectedJwkThumbprint: signatureKey.publicKeyThumbprint,
    expectedNonce: 'nonce-http-1',
    now: '2026-04-18T13:01:10.000Z',
  });

  equal(verified.status, 'valid', 'HTTP signatures: valid envelope signature verifies');
  deepEqual(verified.failureReasons, [], 'HTTP signatures: valid envelope has no failures');
  equal(verified.publicKeyThumbprint, signatureKey.publicKeyThumbprint, 'HTTP signatures: verifier exposes JWK thumbprint');
  equal(verified.contentDigest, contentDigestForBody(BODY), 'HTTP signatures: verifier reports signed content digest');
}

async function testOfflineVerifierAcceptsHttpMessageSignature(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued, verificationKey, decision } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_offline',
    decisionId: 'decision-http-sig-offline',
  });
  const envelope = await makeEnvelope({ signatureKey, issued });
  const request = makeRequest({
    id: 'erq-http-sig-offline',
    uri: envelope.uri,
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T13:01:10.000Z',
    nonceLedgerEntry: {
      nonce: 'nonce-http-1',
      issuedAt: '2026-04-18T13:00:50.000Z',
      expiresAt: '2026-04-18T13:01:30.000Z',
    },
    httpMessageSignature: {
      message: httpMessageFromAuthorizationEnvelope(envelope, BODY),
      publicJwk: signatureKey.publicJwk,
    },
  });

  equal(verified.status, 'valid', 'HTTP signatures: offline verifier accepts matching signed envelope');
  equal(verified.offlineVerified, true, 'HTTP signatures: offline verifier records local signature success');
  deepEqual(verified.failureReasons, [], 'HTTP signatures: valid offline envelope has no failures');
  equal(verified.freshness?.replay.replayKey, envelope.replayKey, 'HTTP signatures: freshness tracks signature replay key');
}

async function testOfflineVerifierFailsClosedWithoutHttpContext(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued, verificationKey, decision } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_missing_context',
    decisionId: 'decision-http-sig-missing-context',
  });
  const envelope = await makeEnvelope({ signatureKey, issued, nonce: null });
  const request = makeRequest({
    id: 'erq-http-sig-missing-context',
    uri: envelope.uri,
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T13:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'HTTP signatures: verifier fails closed without HTTP signature context');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'HTTP signatures: missing context maps to binding mismatch');
}

async function testBodyTamperingFailsDigestCheck(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_body',
    decisionId: 'decision-http-sig-body',
  });
  const envelope = await makeEnvelope({ signatureKey, issued, nonce: null });
  const verified = await verifyHttpMessageSignature({
    message: httpMessageFromAuthorizationEnvelope(envelope, JSON.stringify({ event: 'tampered' })),
    signatureInput: envelope.signatureInput,
    signature: envelope.signature,
    publicJwk: signatureKey.publicJwk,
    expectedJwkThumbprint: signatureKey.publicKeyThumbprint,
    now: '2026-04-18T13:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'HTTP signatures: body tampering invalidates the envelope');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'HTTP signatures: body tampering maps to binding mismatch');
}

async function testCoverageRequirementsFailClosed(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_coverage',
    decisionId: 'decision-http-sig-coverage',
  });
  const envelope = await makeEnvelope({
    signatureKey,
    issued,
    coveredComponents: ['@method', '@target-uri', 'content-digest'],
  });
  const verified = await verifyHttpMessageSignature({
    message: httpMessageFromAuthorizationEnvelope(envelope, BODY),
    signatureInput: envelope.signatureInput,
    signature: envelope.signature,
    publicJwk: signatureKey.publicJwk,
    expectedJwkThumbprint: signatureKey.publicKeyThumbprint,
    now: '2026-04-18T13:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'HTTP signatures: insufficient coverage is invalid');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'HTTP signatures: missing required components map to binding mismatch');
  deepEqual(
    DEFAULT_HTTP_AUTHORIZATION_ENVELOPE_COMPONENTS.slice(0, 2),
    ['@method', '@target-uri'],
    'HTTP signatures: default coverage begins with derived request binding',
  );
}

async function testUnboundReleaseTokenFails(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued, verificationKey, decision } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_unbound',
    decisionId: 'decision-http-sig-unbound',
    bindToSignatureKey: false,
  });
  const envelope = await makeEnvelope({ signatureKey, issued, nonce: null });
  const request = makeRequest({
    id: 'erq-http-sig-unbound',
    uri: envelope.uri,
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T13:01:10.000Z',
    httpMessageSignature: {
      message: httpMessageFromAuthorizationEnvelope(envelope, BODY),
      publicJwk: signatureKey.publicJwk,
    },
  });

  equal(verified.status, 'invalid', 'HTTP signatures: presentation requires a JWK-bound release token');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'HTTP signatures: unbound token maps to binding mismatch');
}

async function testWrongSigningKeyFailsSenderBinding(): Promise<void> {
  const tokenKey = await generateHttpMessageSignatureKeyPair();
  const proofKey = await generateHttpMessageSignatureKeyPair();
  const { issued, verificationKey, decision } = await issueHttpSignatureBoundToken({
    signatureKey: tokenKey,
    tokenId: 'rt_http_sig_wrong_key',
    decisionId: 'decision-http-sig-wrong-key',
  });
  const envelope = await makeEnvelope({
    signatureKey: proofKey,
    issued,
    nonce: null,
  });
  const request = makeRequest({
    id: 'erq-http-sig-wrong-key',
    uri: envelope.uri,
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T13:01:10.000Z',
    httpMessageSignature: {
      message: httpMessageFromAuthorizationEnvelope(envelope, BODY),
      publicJwk: proofKey.publicJwk,
    },
  });

  equal(verified.status, 'invalid', 'HTTP signatures: signing key must match token cnf.jkt');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'HTTP signatures: wrong signing key maps to binding mismatch');
}

async function testReplayLedgerHitFails(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_replay',
    decisionId: 'decision-http-sig-replay',
  });
  const envelope = await makeEnvelope({
    signatureKey,
    issued,
    nonce: 'nonce-http-replay',
  });
  const verified = await verifyHttpMessageSignature({
    message: httpMessageFromAuthorizationEnvelope(envelope, BODY),
    signatureInput: envelope.signatureInput,
    signature: envelope.signature,
    publicJwk: signatureKey.publicJwk,
    expectedJwkThumbprint: signatureKey.publicKeyThumbprint,
    now: '2026-04-18T13:01:10.000Z',
    replayLedgerEntry: {
      subjectKind: 'http-message-signature',
      key: envelope.replayKey,
      firstSeenAt: '2026-04-18T13:01:00.000Z',
      expiresAt: '2026-04-18T13:02:00.000Z',
    },
  });

  equal(verified.status, 'invalid', 'HTTP signatures: replay ledger hit is invalid');
  deepEqual(verified.failureReasons, ['replayed-authorization'], 'HTTP signatures: replay reason is explicit');
}

async function testNonceAndExpiryChecks(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_nonce_expiry',
    decisionId: 'decision-http-sig-nonce-expiry',
  });
  const noNonce = await makeEnvelope({
    signatureKey,
    issued,
    nonce: null,
  });
  const expired = await makeEnvelope({
    signatureKey,
    issued,
    nonce: 'nonce-http-expired',
  });
  const missingNonce = await verifyHttpMessageSignature({
    message: httpMessageFromAuthorizationEnvelope(noNonce, BODY),
    signatureInput: noNonce.signatureInput,
    signature: noNonce.signature,
    publicJwk: signatureKey.publicJwk,
    expectedNonce: 'nonce-http-required',
    now: '2026-04-18T13:01:10.000Z',
  });
  const expiredVerification = await verifyHttpMessageSignature({
    message: httpMessageFromAuthorizationEnvelope(expired, BODY),
    signatureInput: expired.signatureInput,
    signature: expired.signature,
    publicJwk: signatureKey.publicJwk,
    expectedNonce: 'nonce-http-expired',
    now: '2026-04-18T13:03:00.000Z',
  });

  deepEqual(missingNonce.failureReasons, ['missing-nonce'], 'HTTP signatures: expected nonce is enforced');
  deepEqual(expiredVerification.failureReasons, ['expired-authorization'], 'HTTP signatures: expires parameter is enforced');
}

async function testPresentationMetadataTamperingFails(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued, verificationKey, decision } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_metadata',
    decisionId: 'decision-http-sig-metadata',
  });
  const envelope = await makeEnvelope({ signatureKey, issued });
  if (envelope.presentation.proof?.kind !== 'http-message-signature') {
    throw new Error('Expected HTTP message signature proof.');
  }
  const tamperedPresentation = createReleasePresentation({
    mode: 'http-message-signature',
    presentedAt: '2026-04-18T13:01:00.000Z',
    releaseToken: issued.token,
    releaseTokenId: issued.tokenId,
    releaseTokenDigest: httpReleaseTokenDigest(issued.token),
    issuer: issued.claims.iss,
    subject: issued.claims.sub,
    audience: issued.claims.aud,
    expiresAt: issued.expiresAt,
    proof: {
      ...envelope.presentation.proof,
      nonce: 'nonce-http-tampered',
    },
  });
  const request = makeRequest({
    id: 'erq-http-sig-metadata',
    uri: envelope.uri,
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: tamperedPresentation,
    verificationKey,
    now: '2026-04-18T13:01:10.000Z',
    nonceLedgerEntry: {
      nonce: 'nonce-http-tampered',
      issuedAt: '2026-04-18T13:00:50.000Z',
      expiresAt: '2026-04-18T13:01:30.000Z',
    },
    httpMessageSignature: {
      message: httpMessageFromAuthorizationEnvelope(envelope, BODY),
      publicJwk: signatureKey.publicJwk,
    },
  });

  equal(verified.status, 'invalid', 'HTTP signatures: presentation metadata tampering is invalid');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'HTTP signatures: metadata tampering maps to binding mismatch');
}

async function testHighRiskWebhookWorksWithOnlineVerifier(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued, verificationKey, decision } = await issueHttpSignatureBoundToken({
    signatureKey,
    tokenId: 'rt_http_sig_webhook',
    decisionId: 'decision-http-sig-webhook',
    targetId: 'workflow.callback.receiver',
    consequenceType: 'action',
    riskClass: 'R3',
  });
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  store.registerIssuedToken({ issuedToken: issued, decision });
  const envelope = await makeEnvelope({
    signatureKey,
    issued,
    uri: 'https://callbacks.attestor.test/v1/workflow?attempt=1',
    nonce: 'nonce-http-webhook',
  });
  const request = makeRequest({
    id: 'erq-http-sig-webhook',
    targetId: 'workflow.callback.receiver',
    uri: envelope.uri,
    boundaryKind: 'webhook',
    pointKind: 'webhook-receiver',
    consequenceType: 'action',
    riskClass: 'R3',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T13:01:10.000Z',
    introspector,
    resourceServerId: 'erq-http-sig-webhook-pep',
    nonceLedgerEntry: {
      nonce: 'nonce-http-webhook',
      issuedAt: '2026-04-18T13:00:50.000Z',
      expiresAt: '2026-04-18T13:01:30.000Z',
    },
    httpMessageSignature: {
      message: httpMessageFromAuthorizationEnvelope(envelope, BODY),
      publicJwk: signatureKey.publicJwk,
    },
  });

  equal(verified.status, 'valid', 'HTTP signatures: high-risk webhook passes online verifier');
  equal(verified.onlineChecked, true, 'HTTP signatures: webhook path performs online introspection');
  equal(verified.offline.freshness?.nonce.status, 'valid', 'HTTP signatures: webhook nonce freshness is valid');
  equal(verified.freshness?.replay.replayKey, envelope.replayKey, 'HTTP signatures: online verifier preserves signature replay key');
}

function testTargetUriNormalization(): void {
  equal(
    normalizeHttpSignatureTargetUri('HTTPS://Callbacks.Attestor.Test/v1/release?attempt=1#frag'),
    'https://callbacks.attestor.test/v1/release?attempt=1',
    'HTTP signatures: URI normalization lowercases scheme/host and strips fragment',
  );
}

async function testStandaloneSignatureHelper(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const body = '{}';
  const message = {
    method: 'POST',
    uri: 'https://callbacks.attestor.test/minimal',
    headers: {
      authorization: 'Bearer release-token',
      'content-digest': contentDigestForBody(body),
      [ATTESTOR_RELEASE_TOKEN_DIGEST_HEADER]: 'sha256:release',
      [ATTESTOR_TARGET_ID_HEADER]: TARGET_ID,
      [ATTESTOR_OUTPUT_HASH_HEADER]: 'sha256:output',
      [ATTESTOR_CONSEQUENCE_HASH_HEADER]: 'sha256:consequence',
    },
    body,
  };
  const signature = await createHttpMessageSignature({
    message,
    privateJwk: signatureKey.privateJwk,
    publicJwk: signatureKey.publicJwk,
    createdAt: '2026-04-18T13:01:00.000Z',
    expiresAt: '2026-04-18T13:02:00.000Z',
    nonce: 'nonce-helper',
  });
  const verified = await verifyHttpMessageSignature({
    message,
    signatureInput: signature.signatureInput,
    signature: signature.signature,
    publicJwk: signatureKey.publicJwk,
    expectedNonce: 'nonce-helper',
    now: '2026-04-18T13:01:10.000Z',
  });

  equal(signature.replayKey, 'http-message-signature:nonce-helper', 'HTTP signatures: nonce becomes replay key');
  equal(verified.status, 'valid', 'HTTP signatures: standalone helper verifies');
}

async function main(): Promise<void> {
  await testEnvelopeCreationAndVerification();
  await testOfflineVerifierAcceptsHttpMessageSignature();
  await testOfflineVerifierFailsClosedWithoutHttpContext();
  await testBodyTamperingFailsDigestCheck();
  await testCoverageRequirementsFailClosed();
  await testUnboundReleaseTokenFails();
  await testWrongSigningKeyFailsSenderBinding();
  await testReplayLedgerHitFails();
  await testNonceAndExpiryChecks();
  await testPresentationMetadataTamperingFails();
  await testHighRiskWebhookWorksWithOnlineVerifier();
  testTargetUriNormalization();
  await testStandaloneSignatureHelper();

  console.log(`Release enforcement-plane HTTP message signature tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane HTTP message signature tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
