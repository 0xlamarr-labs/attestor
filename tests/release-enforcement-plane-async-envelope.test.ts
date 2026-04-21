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
  ASYNC_CONSEQUENCE_ENVELOPE_PAYLOAD_TYPE,
  ASYNC_CONSEQUENCE_ENVELOPE_PREDICATE_TYPE,
  ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION,
  CLOUDEVENTS_SPEC_VERSION,
  IN_TOTO_STATEMENT_V1_TYPE,
  asyncReleaseTokenDigest,
  canonicalJson,
  createAsyncEnvelopeReleaseTokenConfirmation,
  createSignedAsyncConsequenceEnvelope,
  generateAsyncConsequenceEnvelopeKeyPair,
  verifySignedAsyncConsequenceEnvelope,
  type AsyncConsequenceEnvelopeKeyPair,
  type DsseEnvelope,
  type SignedAsyncConsequenceEnvelope,
} from '../src/release-enforcement-plane/async-envelope.js';

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

const TARGET_ID = 'release.async.queue';
const QUEUE_OR_TOPIC = 'attestor.release.consequences';
const MESSAGE_ID = 'msg-async-envelope-1';
const IDEMPOTENCY_KEY = 'idem-async-envelope-1';
const PAYLOAD = {
  consequence: 'record.write',
  rowCount: 2,
  target: TARGET_ID,
};

function makeDecision(input: {
  readonly id: string;
  readonly targetId?: string;
  readonly consequenceType?: 'action' | 'record' | 'communication';
  readonly riskClass?: 'R1' | 'R3';
}) {
  const consequenceType = input.consequenceType ?? 'action';
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T14:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-async-envelope-test.v1',
    policyHash: 'sha256:policy',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'release-async-envelope-test.artifact',
      expectedShape: 'deterministic async consequence payload',
      consequenceType,
      riskClass: input.riskClass ?? 'R1',
    },
    capabilityBoundary: {
      allowedTools: ['release-async-envelope-test-tool'],
      allowedTargets: [input.targetId ?? TARGET_ID],
      allowedDataDomains: ['release-async-envelope-test'],
    },
    requester: {
      id: 'svc.release-async-envelope-test',
      type: 'service',
    },
    target: {
      kind: consequenceType === 'record' ? 'artifact-registry' : 'queue',
      id: input.targetId ?? TARGET_ID,
    },
  });
}

function makeAsyncRequest(input: {
  readonly id: string;
  readonly releaseTokenId: string;
  readonly releaseDecisionId: string;
  readonly envelopeDigest?: string | null;
  readonly messageId?: string;
  readonly queueOrTopic?: string;
  readonly targetId?: string;
  readonly consequenceType?: 'action' | 'record' | 'communication';
  readonly riskClass?: 'R1' | 'R3';
}): EnforcementRequest {
  return createEnforcementRequest({
    id: input.id,
    receivedAt: '2026-04-18T14:01:00.000Z',
    enforcementPoint: {
      environment: 'test',
      enforcementPointId: `${input.id}-pep`,
      pointKind: 'async-consumer',
      boundaryKind: 'async-message',
      consequenceType: input.consequenceType ?? 'action',
      riskClass: input.riskClass ?? 'R1',
      tenantId: 'tenant-test',
      accountId: 'acct-test',
      workloadId: 'spiffe://attestor/tests/async-envelope',
      audience: input.targetId ?? TARGET_ID,
    },
    targetId: input.targetId ?? TARGET_ID,
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    releaseTokenId: input.releaseTokenId,
    releaseDecisionId: input.releaseDecisionId,
    idempotencyKey: IDEMPOTENCY_KEY,
    transport: {
      kind: 'async',
      messageId: input.messageId ?? MESSAGE_ID,
      queueOrTopic: input.queueOrTopic ?? QUEUE_OR_TOPIC,
      envelopeDigest: input.envelopeDigest ?? null,
    },
  });
}

function makeArtifactRequest(input: {
  readonly id: string;
  readonly releaseTokenId: string;
  readonly releaseDecisionId: string;
  readonly artifactDigest: string;
  readonly targetId: string;
}): EnforcementRequest {
  return createEnforcementRequest({
    id: input.id,
    receivedAt: '2026-04-18T14:01:00.000Z',
    enforcementPoint: {
      environment: 'test',
      enforcementPointId: `${input.id}-pep`,
      pointKind: 'artifact-verifier',
      boundaryKind: 'artifact-export',
      consequenceType: 'record',
      riskClass: 'R1',
      tenantId: 'tenant-test',
      accountId: 'acct-test',
      workloadId: 'spiffe://attestor/tests/artifact-verifier',
      audience: input.targetId,
    },
    targetId: input.targetId,
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    releaseTokenId: input.releaseTokenId,
    releaseDecisionId: input.releaseDecisionId,
    idempotencyKey: IDEMPOTENCY_KEY,
    transport: {
      kind: 'artifact',
      artifactId: input.targetId,
      artifactDigest: input.artifactDigest,
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

async function issueAsyncEnvelopeBoundToken(input: {
  readonly envelopeKey: AsyncConsequenceEnvelopeKeyPair;
  readonly tokenId: string;
  readonly decisionId: string;
  readonly targetId?: string;
  readonly consequenceType?: 'action' | 'record' | 'communication';
  readonly riskClass?: 'R1' | 'R3';
  readonly bindToEnvelopeKey?: boolean;
}): Promise<{
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly decision: ReleaseDecision;
}> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    targetId: input.targetId,
    consequenceType: input.consequenceType,
    riskClass: input.riskClass,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T14:00:00.000Z',
    tokenId: input.tokenId,
    confirmation:
      input.bindToEnvelopeKey === false
        ? undefined
        : createAsyncEnvelopeReleaseTokenConfirmation({
            publicKeyThumbprint: input.envelopeKey.publicKeyThumbprint,
          }),
  });

  return { issued, verificationKey, decision };
}

async function makeEnvelope(input: {
  readonly envelopeKey: AsyncConsequenceEnvelopeKeyPair;
  readonly issued: IssuedReleaseToken;
  readonly targetId?: string;
  readonly targetKind?: 'queue' | 'artifact' | 'file' | 'export';
  readonly expiresAt?: string;
  readonly messageId?: string | null;
  readonly queueOrTopic?: string | null;
  readonly payloadName?: string;
}): Promise<SignedAsyncConsequenceEnvelope> {
  return createSignedAsyncConsequenceEnvelope({
    issuedToken: input.issued,
    privateJwk: input.envelopeKey.privateJwk,
    publicJwk: input.envelopeKey.publicJwk,
    envelopeId: 'env-async-envelope-1',
    idempotencyKey: IDEMPOTENCY_KEY,
    target: {
      kind: input.targetKind ?? 'queue',
      id: input.targetId ?? TARGET_ID,
    },
    payload: {
      name: input.payloadName ?? 'async-consequence.json',
      mediaType: 'application/json',
      content: PAYLOAD,
    },
    createdAt: '2026-04-18T14:01:00.000Z',
    expiresAt: input.expiresAt ?? '2026-04-18T14:06:00.000Z',
    producer: 'attestor.tests.async-envelope',
    messageId: input.messageId === undefined ? MESSAGE_ID : input.messageId,
    queueOrTopic: input.queueOrTopic === undefined ? QUEUE_OR_TOPIC : input.queueOrTopic,
    cloudEventSource: 'urn:attestor:test:async-envelope',
    cloudEventType: 'dev.attestor.test.async-consequence.v1',
    presentedAt: '2026-04-18T14:01:00.000Z',
  });
}

function tamperEnvelopePayload(
  envelope: SignedAsyncConsequenceEnvelope,
): DsseEnvelope {
  const statement = JSON.parse(
    Buffer.from(envelope.envelope.payload, 'base64').toString('utf8'),
  ) as typeof envelope.statement;
  const tampered = {
    ...statement,
    predicate: {
      ...statement.predicate,
      idempotencyKey: 'idem-tampered',
    },
  };
  return {
    payloadType: envelope.envelope.payloadType,
    payload: Buffer.from(canonicalJson(tampered), 'utf8').toString('base64'),
    signatures: envelope.envelope.signatures,
  };
}

async function testEnvelopeCreationAndDirectVerification(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_create',
    decisionId: 'decision-async-create',
  });
  const envelope = await makeEnvelope({ envelopeKey, issued });

  equal(envelope.version, ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION, 'Async envelopes: wrapper stamps stable spec version');
  equal(envelope.envelope.payloadType, ASYNC_CONSEQUENCE_ENVELOPE_PAYLOAD_TYPE, 'Async envelopes: DSSE payload type is stable');
  equal(envelope.statement._type, IN_TOTO_STATEMENT_V1_TYPE, 'Async envelopes: payload uses in-toto Statement v1 shape');
  equal(envelope.statement.predicateType, ASYNC_CONSEQUENCE_ENVELOPE_PREDICATE_TYPE, 'Async envelopes: predicate type is Attestor async envelope');
  equal(envelope.cloudEvent.specversion, CLOUDEVENTS_SPEC_VERSION, 'Async envelopes: CloudEvent specversion is 1.0');
  equal(envelope.cloudEvent.id, MESSAGE_ID, 'Async envelopes: CloudEvent id follows async message id');
  equal(envelope.idempotencyKey, IDEMPOTENCY_KEY, 'Async envelopes: idempotency key is explicit');
  equal(envelope.releaseTokenDigest, asyncReleaseTokenDigest(issued.token), 'Async envelopes: release token digest is bound');
  equal(envelope.statement.predicate.target.id, TARGET_ID, 'Async envelopes: target id is signed in predicate');
  equal(envelope.statement.predicate.transport.queueOrTopic, QUEUE_OR_TOPIC, 'Async envelopes: queue/topic survives in predicate');
  equal(envelope.presentation.mode, 'signed-json-envelope', 'Async envelopes: wrapper creates signed-json presentation');
  equal(envelope.presentation.proof?.kind, 'signed-json-envelope', 'Async envelopes: presentation carries signed envelope proof');
  ok(envelope.subjectDigest.startsWith('sha256:'), 'Async envelopes: subject digest is SHA-256 tagged');
  ok(envelope.envelopeDigest.startsWith('sha256:'), 'Async envelopes: envelope digest is SHA-256 tagged');

  const verified = await verifySignedAsyncConsequenceEnvelope({
    envelope,
    publicJwk: envelopeKey.publicJwk,
    now: '2026-04-18T14:01:10.000Z',
    expectedJwkThumbprint: envelopeKey.publicKeyThumbprint,
    expectedReleaseTokenDigest: asyncReleaseTokenDigest(issued.token),
    expectedIdempotencyKey: IDEMPOTENCY_KEY,
    expectedMessageId: MESSAGE_ID,
    expectedQueueOrTopic: QUEUE_OR_TOPIC,
    expectedEnvelopeDigest: envelope.envelopeDigest,
    expectedSubjectDigest: envelope.subjectDigest,
  });

  equal(verified.status, 'valid', 'Async envelopes: valid DSSE envelope verifies directly');
  deepEqual(verified.failureReasons, [], 'Async envelopes: valid direct verification has no failures');
  equal(verified.signatureRef, envelope.signatureRef, 'Async envelopes: verifier exposes signature ref');
  equal(verified.replayKey, envelope.replayKey, 'Async envelopes: verifier derives replay key from envelope digest');
}

async function testOfflineVerifierAcceptsAsyncEnvelope(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued, verificationKey, decision } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_offline',
    decisionId: 'decision-async-offline',
  });
  const envelope = await makeEnvelope({ envelopeKey, issued });
  const request = makeAsyncRequest({
    id: 'erq-async-offline',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
    envelopeDigest: envelope.envelopeDigest,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T14:01:10.000Z',
    asyncEnvelope: {
      envelope,
      publicJwk: envelopeKey.publicJwk,
    },
  });

  equal(verified.status, 'indeterminate', 'Async envelopes: offline verifier verifies async envelope before live liveness');
  equal(verified.offlineVerified, true, 'Async envelopes: offline verifier records local envelope success');
  deepEqual(verified.failureReasons, ['fresh-introspection-required'], 'Async envelopes: async-message still requires live liveness by profile');
  equal(verified.freshness?.replay.replayKey, envelope.replayKey, 'Async envelopes: freshness tracks envelope replay key');
  equal(verified.freshness?.replay.subjectKind, 'signed-json-envelope', 'Async envelopes: freshness tracks signed envelope subject kind');
}

async function testOfflineVerifierFailsClosedWithoutContext(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued, verificationKey, decision } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_missing_context',
    decisionId: 'decision-async-missing-context',
  });
  const envelope = await makeEnvelope({ envelopeKey, issued });
  const request = makeAsyncRequest({
    id: 'erq-async-missing-context',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
    envelopeDigest: envelope.envelopeDigest,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T14:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'Async envelopes: verifier fails closed without async envelope context');
  deepEqual(verified.failureReasons, ['fresh-introspection-required', 'binding-mismatch'], 'Async envelopes: missing context maps to liveness and binding failures');
}

async function testTamperedPayloadFailsSignature(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_tamper',
    decisionId: 'decision-async-tamper',
  });
  const envelope = await makeEnvelope({ envelopeKey, issued });
  const verified = await verifySignedAsyncConsequenceEnvelope({
    envelope: tamperEnvelopePayload(envelope),
    publicJwk: envelopeKey.publicJwk,
    now: '2026-04-18T14:01:10.000Z',
  });

  equal(verified.status, 'invalid', 'Async envelopes: payload tampering invalidates DSSE signature');
  deepEqual(verified.failureReasons, ['invalid-signature'], 'Async envelopes: tampered payload maps to invalid signature');
}

async function testExpiryAndReplayChecks(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_expiry_replay',
    decisionId: 'decision-async-expiry-replay',
  });
  const envelope = await makeEnvelope({
    envelopeKey,
    issued,
    expiresAt: '2026-04-18T14:02:00.000Z',
  });
  const expired = await verifySignedAsyncConsequenceEnvelope({
    envelope,
    publicJwk: envelopeKey.publicJwk,
    now: '2026-04-18T14:03:00.000Z',
  });
  const replayed = await verifySignedAsyncConsequenceEnvelope({
    envelope,
    publicJwk: envelopeKey.publicJwk,
    now: '2026-04-18T14:01:10.000Z',
    replayLedgerEntry: {
      subjectKind: 'signed-json-envelope',
      key: envelope.replayKey,
      firstSeenAt: '2026-04-18T14:01:00.000Z',
      expiresAt: '2026-04-18T14:02:00.000Z',
    },
  });

  deepEqual(expired.failureReasons, ['expired-authorization'], 'Async envelopes: envelope expiry is enforced');
  deepEqual(replayed.failureReasons, ['replayed-authorization'], 'Async envelopes: replay ledger hit is explicit');
}

async function testUnboundReleaseTokenFails(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued, verificationKey, decision } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_unbound',
    decisionId: 'decision-async-unbound',
    bindToEnvelopeKey: false,
  });
  const envelope = await makeEnvelope({ envelopeKey, issued });
  const request = makeAsyncRequest({
    id: 'erq-async-unbound',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
    envelopeDigest: envelope.envelopeDigest,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T14:01:10.000Z',
    asyncEnvelope: {
      envelope,
      publicJwk: envelopeKey.publicJwk,
    },
  });

  equal(verified.status, 'invalid', 'Async envelopes: signed-json presentation requires a JWK-bound release token');
  deepEqual(verified.failureReasons, ['fresh-introspection-required', 'binding-mismatch'], 'Async envelopes: unbound token maps to liveness and binding failures');
}

async function testWrongSigningKeyFailsSenderBinding(): Promise<void> {
  const tokenKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const proofKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued, verificationKey, decision } = await issueAsyncEnvelopeBoundToken({
    envelopeKey: tokenKey,
    tokenId: 'rt_async_wrong_key',
    decisionId: 'decision-async-wrong-key',
  });
  const envelope = await makeEnvelope({
    envelopeKey: proofKey,
    issued,
  });
  const request = makeAsyncRequest({
    id: 'erq-async-wrong-key',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
    envelopeDigest: envelope.envelopeDigest,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T14:01:10.000Z',
    asyncEnvelope: {
      envelope,
      publicJwk: proofKey.publicJwk,
    },
  });

  equal(verified.status, 'invalid', 'Async envelopes: signing key must match token cnf.jkt');
  deepEqual(verified.failureReasons, ['fresh-introspection-required', 'binding-mismatch'], 'Async envelopes: wrong signing key maps to liveness and binding failures');
}

async function testPresentationMetadataTamperingFails(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued, verificationKey, decision } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_metadata',
    decisionId: 'decision-async-metadata',
  });
  const envelope = await makeEnvelope({ envelopeKey, issued });
  const request = makeAsyncRequest({
    id: 'erq-async-metadata',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
    envelopeDigest: envelope.envelopeDigest,
  });
  const tamperedPresentation = createReleasePresentation({
    mode: 'signed-json-envelope',
    presentedAt: '2026-04-18T14:01:00.000Z',
    releaseToken: issued.token,
    releaseTokenId: issued.tokenId,
    releaseTokenDigest: asyncReleaseTokenDigest(issued.token),
    issuer: issued.claims.iss,
    subject: issued.claims.sub,
    audience: issued.claims.aud,
    expiresAt: issued.expiresAt,
    proof: {
      kind: 'signed-json-envelope',
      envelopeDigest: 'sha256:tampered-envelope',
      subjectDigest: envelope.subjectDigest,
      signatureRef: envelope.signatureRef,
    },
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: tamperedPresentation,
    verificationKey,
    now: '2026-04-18T14:01:10.000Z',
    asyncEnvelope: {
      envelope,
      publicJwk: envelopeKey.publicJwk,
    },
  });

  equal(verified.status, 'invalid', 'Async envelopes: presentation digest tampering is invalid');
  deepEqual(verified.failureReasons, ['fresh-introspection-required', 'binding-mismatch'], 'Async envelopes: presentation tampering maps to liveness and binding failures');
}

async function testArtifactBoundaryBindsSubjectDigest(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const targetId = 'artifact.release.export';
  const { issued, verificationKey, decision } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_artifact',
    decisionId: 'decision-async-artifact',
    targetId,
    consequenceType: 'record',
  });
  const envelope = await makeEnvelope({
    envelopeKey,
    issued,
    targetId,
    targetKind: 'artifact',
    messageId: null,
    queueOrTopic: null,
    payloadName: 'artifact-release.json',
  });
  const request = makeArtifactRequest({
    id: 'erq-async-artifact',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
    artifactDigest: envelope.subjectDigest,
    targetId,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T14:01:10.000Z',
    asyncEnvelope: {
      envelope,
      publicJwk: envelopeKey.publicJwk,
    },
  });

  equal(verified.status, 'valid', 'Async envelopes: artifact export verifies with subject digest binding');
  deepEqual(verified.failureReasons, [], 'Async envelopes: artifact export has no failures');
  equal(verified.freshness?.replay.status, 'fresh', 'Async envelopes: artifact export keeps fresh replay proof when risk requires it');
}

async function testHighRiskAsyncEnvelopeWorksWithOnlineVerifier(): Promise<void> {
  const envelopeKey = await generateAsyncConsequenceEnvelopeKeyPair();
  const { issued, verificationKey, decision } = await issueAsyncEnvelopeBoundToken({
    envelopeKey,
    tokenId: 'rt_async_high_risk',
    decisionId: 'decision-async-high-risk',
    consequenceType: 'action',
    riskClass: 'R3',
  });
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  store.registerIssuedToken({ issuedToken: issued, decision });
  const envelope = await makeEnvelope({ envelopeKey, issued });
  const request = makeAsyncRequest({
    id: 'erq-async-high-risk',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
    envelopeDigest: envelope.envelopeDigest,
    consequenceType: 'action',
    riskClass: 'R3',
  });
  const verified = await verifyOnlineReleaseAuthorization({
    request,
    presentation: envelope.presentation,
    verificationKey,
    now: '2026-04-18T14:01:10.000Z',
    introspector,
    resourceServerId: 'erq-async-high-risk-pep',
    asyncEnvelope: {
      envelope,
      publicJwk: envelopeKey.publicJwk,
    },
  });

  equal(verified.status, 'valid', 'Async envelopes: high-risk async envelope passes online verifier');
  equal(verified.onlineChecked, true, 'Async envelopes: high-risk async path performs online introspection');
  equal(verified.offline.status, 'indeterminate', 'Async envelopes: high-risk offline component waits for liveness');
  equal(verified.freshness?.replay.replayKey, envelope.replayKey, 'Async envelopes: online verifier preserves envelope replay key');
}

async function main(): Promise<void> {
  await testEnvelopeCreationAndDirectVerification();
  await testOfflineVerifierAcceptsAsyncEnvelope();
  await testOfflineVerifierFailsClosedWithoutContext();
  await testTamperedPayloadFailsSignature();
  await testExpiryAndReplayChecks();
  await testUnboundReleaseTokenFails();
  await testWrongSigningKeyFailsSenderBinding();
  await testPresentationMetadataTamperingFails();
  await testArtifactBoundaryBindsSubjectDigest();
  await testHighRiskAsyncEnvelopeWorksWithOnlineVerifier();

  console.log(`Release enforcement-plane async envelope tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane async envelope tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
