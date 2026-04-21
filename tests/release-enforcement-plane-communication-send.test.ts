import assert from 'node:assert/strict';
import { generateKeyPair } from '../src/signing/keys.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createReleaseTokenIssuer,
  type IssuedReleaseToken,
  type ReleaseTokenVerificationKey,
} from '../src/release-kernel/release-token.js';
import type { ReleaseDecision, ReleaseTokenConfirmationClaim } from '../src/release-kernel/object-model.js';
import {
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
  type ReleaseTokenIntrospectionStore,
  type ReleaseTokenIntrospector,
} from '../src/release-kernel/release-introspection.js';
import {
  buildCommunicationSendCanonicalBinding,
  enforceCommunicationSend,
  RELEASE_COMMUNICATION_SEND_GATEWAY_SPEC_VERSION,
  type CommunicationSendMessage,
} from '../src/release-enforcement-plane/communication-send.js';
import {
  createDpopBoundPresentationFromIssuedToken,
  createDpopProof,
  dpopReplayKey,
  generateDpopKeyPair,
  type DpopKeyPair,
} from '../src/release-enforcement-plane/dpop.js';
import {
  createHttpAuthorizationEnvelope,
  generateHttpMessageSignatureKeyPair,
  httpMessageFromAuthorizationEnvelope,
} from '../src/release-enforcement-plane/http-message-signatures.js';
import type { ReplayLedgerEntry } from '../src/release-enforcement-plane/freshness.js';

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

const MESSAGE: CommunicationSendMessage = Object.freeze({
  channel: 'memo',
  channelId: 'internal-review-mailbox',
  recipientId: 'finance-reporting-reviewers',
  targetId: 'finance.reporting.review.mailbox',
  subject: 'Finance review summary for run-2026-04-18',
  body: [
    'Run: run-2026-04-18',
    'Decision: accepted',
    'Filing readiness: ready',
    'Reviewer summary: release evidence is complete.',
  ].join('\n'),
  attachments: [
    {
      attachmentId: 'evidence-pack',
      fileName: 'release-evidence.json',
      contentType: 'application/json',
      digest: 'sha256:evidence-pack-digest',
      sizeBytes: 4096,
      disposition: 'attachment',
    },
    {
      attachmentId: 'summary',
      fileName: 'review-summary.txt',
      contentType: 'text/plain',
      digest: 'sha256:review-summary-digest',
      sizeBytes: 1024,
    },
  ],
  metadata: {
    runId: 'run-2026-04-18',
    proofMode: 'hybrid-required',
    reviewerQueue: ['primary', 'secondary'],
  },
  idempotencyKey: 'idem-communication-send-1',
  actorId: 'svc.finance-communication-sender',
});

function makeDecision(input: {
  readonly id: string;
  readonly binding: ReturnType<typeof buildCommunicationSendCanonicalBinding>;
}): ReleaseDecision {
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T18:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-communication-send-test.v1',
    policyHash: 'sha256:policy',
    outputHash: input.binding.hashBundle.outputHash,
    consequenceHash: input.binding.hashBundle.consequenceHash,
    outputContract: input.binding.outputContract,
    capabilityBoundary: {
      allowedTools: ['communication-send-gateway', 'channel-dispatch'],
      allowedTargets: [input.binding.target.id],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.release-communication-send-test',
      type: 'service',
    },
    target: input.binding.target,
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

async function issueCommunicationToken(input: {
  readonly tokenId: string;
  readonly decisionId: string;
  readonly message?: CommunicationSendMessage;
  readonly confirmation?: ReleaseTokenConfirmationClaim;
}): Promise<{
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly decision: ReleaseDecision;
  readonly binding: ReturnType<typeof buildCommunicationSendCanonicalBinding>;
}> {
  const binding = buildCommunicationSendCanonicalBinding(input.message ?? MESSAGE);
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    binding,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T18:00:00.000Z',
    tokenId: input.tokenId,
    confirmation: input.confirmation,
  });

  return { issued, verificationKey, decision, binding };
}

function register(
  issued: IssuedReleaseToken,
  decision: ReleaseDecision,
): {
  readonly store: ReleaseTokenIntrospectionStore;
  readonly introspector: ReleaseTokenIntrospector;
} {
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  store.registerIssuedToken({ issuedToken: issued, decision });
  return { store, introspector };
}

function nonceLedgerEntry(nonce: string) {
  return {
    nonce,
    issuedAt: '2026-04-18T18:00:50.000Z',
    expiresAt: '2026-04-18T18:02:00.000Z',
  };
}

function options(input: {
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly introspector?: ReleaseTokenIntrospector;
  readonly store?: ReleaseTokenIntrospectionStore;
  readonly verifierMode?: 'offline' | 'online';
  readonly nonce?: string;
  readonly replayLedgerEntry?: ReplayLedgerEntry;
  readonly httpMessageSignature?: Parameters<typeof enforceCommunicationSend>[0]['options']['httpMessageSignature'];
}) {
  return {
    verificationKey: input.verificationKey,
    enforcementPointId: 'communication-send-gateway-pep',
    environment: 'test',
    tenantId: 'tenant-test',
    accountId: 'acct-test',
    workloadId: 'svc.finance-communication-sender',
    introspector: input.introspector,
    usageStore: input.store,
    verifierMode: input.verifierMode,
    requestId: 'erq-communication-send-test',
    replayLedgerEntry: input.replayLedgerEntry,
    nonceLedgerEntry: input.nonce ? nonceLedgerEntry(input.nonce) : undefined,
    httpMessageSignature: input.httpMessageSignature,
    now: () => '2026-04-18T18:01:00.000Z',
  };
}

async function dpopAuthorization(input: {
  readonly issued: IssuedReleaseToken;
  readonly dpopKey: DpopKeyPair;
  readonly binding?: ReturnType<typeof buildCommunicationSendCanonicalBinding>;
  readonly nonce?: string;
  readonly proofJti?: string;
  readonly method?: string;
  readonly uri?: string;
}) {
  const binding = input.binding ?? buildCommunicationSendCanonicalBinding(MESSAGE);
  const proof = await createDpopProof({
    privateJwk: input.dpopKey.privateJwk,
    publicJwk: input.dpopKey.publicJwk,
    httpMethod: input.method ?? binding.httpMethod,
    httpUri: input.uri ?? binding.sendUri,
    accessToken: input.issued.token,
    nonce: input.nonce ?? 'nonce-communication-send',
    proofJti: input.proofJti ?? 'dpop-proof-communication-send',
    issuedAt: '2026-04-18T18:01:00.000Z',
  });
  const presentation = createDpopBoundPresentationFromIssuedToken({
    issuedToken: input.issued,
    proof,
    presentedAt: '2026-04-18T18:01:00.000Z',
  });
  return {
    releaseToken: input.issued.token,
    releaseTokenId: input.issued.tokenId,
    releaseDecisionId: input.issued.claims.decision_id,
    mode: presentation.mode,
    proof: presentation.proof,
    issuer: presentation.issuer,
    subject: presentation.subject,
    audience: presentation.audience,
    expiresAt: presentation.expiresAt,
    scope: presentation.scope,
  } as const;
}

async function testCanonicalBindingIsStable(): Promise<void> {
  const left = buildCommunicationSendCanonicalBinding(MESSAGE);
  const reordered = buildCommunicationSendCanonicalBinding({
    ...MESSAGE,
    attachments: [...(MESSAGE.attachments ?? [])].reverse(),
    metadata: {
      reviewerQueue: ['primary', 'secondary'],
      proofMode: 'hybrid-required',
      runId: 'run-2026-04-18',
    },
  });

  equal(left.version, RELEASE_COMMUNICATION_SEND_GATEWAY_SPEC_VERSION, 'Communication-send gateway: binding stamps stable spec version');
  equal(left.target.id, 'finance.reporting.review.mailbox', 'Communication-send gateway: explicit target id binds outbound endpoint');
  equal(left.outputContract.consequenceType, 'communication', 'Communication-send gateway: output contract is communication consequence');
  equal(left.outputContract.riskClass, 'R2', 'Communication-send gateway: default communication send risk class is R2');
  ok(left.hashBundle.outputHash.startsWith('sha256:'), 'Communication-send gateway: output hash is canonicalized');
  ok(left.hashBundle.consequenceHash.startsWith('sha256:'), 'Communication-send gateway: consequence hash is canonicalized');
  equal(left.messageHash, reordered.messageHash, 'Communication-send gateway: metadata and attachment ordering do not change message hash');
  equal(left.hashBundle.outputHash, reordered.hashBundle.outputHash, 'Communication-send gateway: reordered message fields retain output binding');
}

async function testValidDpopCommunicationSendAllowsAndConsumesToken(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_allow',
    decisionId: 'decision-communication-send-allow',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceCommunicationSend({
    message: MESSAGE,
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-communication-send',
      proofJti: 'dpop-proof-communication-send',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-communication-send',
    }),
  });

  equal(result.status, 'allowed', 'Communication-send gateway: valid DPoP-bound message is allowed');
  equal(result.responseStatus, 200, 'Communication-send gateway: allowed result is send-ready');
  equal(result.decision?.outcome, 'allow', 'Communication-send gateway: valid send emits allow decision');
  ok(result.receipt?.receiptDigest?.startsWith('sha256:'), 'Communication-send gateway: allowed send emits receipt digest');
  equal(result.request?.enforcementPoint.boundaryKind, 'communication-send', 'Communication-send gateway: request uses communication-send boundary');
  equal(result.request?.targetId, result.binding.target.id, 'Communication-send gateway: request target matches message binding');
  equal(result.request?.outputHash, result.binding.hashBundle.outputHash, 'Communication-send gateway: request output hash matches binding');
  equal(result.request?.consequenceHash, result.binding.hashBundle.consequenceHash, 'Communication-send gateway: request consequence hash matches binding');
  equal(result.request?.transport?.kind, 'http', 'Communication-send gateway: send transport is HTTP-bound');
  equal(result.request?.transport?.kind === 'http' ? result.request.transport.uri : null, binding.sendUri, 'Communication-send gateway: DPoP proof is bound to send URI');
  equal(result.online?.onlineChecked, true, 'Communication-send gateway: send performs online introspection');
  equal(result.online?.consumed, true, 'Communication-send gateway: successful send consumes token use');
  deepEqual(result.failureReasons, [], 'Communication-send gateway: valid send has no failures');
}

async function testHttpMessageSignatureCommunicationSendAllows(): Promise<void> {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued, verificationKey, decision, binding } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_http_signature',
    decisionId: 'decision-communication-send-http-signature',
    confirmation: { jkt: signatureKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const envelope = await createHttpAuthorizationEnvelope({
    request: {
      method: binding.httpMethod,
      uri: binding.sendUri,
      body: binding.messageCanonical,
    },
    issuedToken: issued,
    privateJwk: signatureKey.privateJwk,
    publicJwk: signatureKey.publicJwk,
    nonce: 'nonce-communication-http-signature',
    createdAt: '2026-04-18T18:01:00.000Z',
    presentedAt: '2026-04-18T18:01:00.000Z',
  });
  const result = await enforceCommunicationSend({
    message: MESSAGE,
    authorization: {
      releaseToken: issued.token,
      releaseTokenId: issued.tokenId,
      releaseDecisionId: decision.id,
      mode: envelope.presentation.mode,
      proof: envelope.presentation.proof,
      issuer: envelope.presentation.issuer,
      subject: envelope.presentation.subject,
      audience: envelope.presentation.audience,
      expiresAt: envelope.presentation.expiresAt,
      scope: envelope.presentation.scope,
    },
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-communication-http-signature',
      httpMessageSignature: {
        message: httpMessageFromAuthorizationEnvelope(envelope, binding.messageCanonical),
        publicJwk: signatureKey.publicJwk,
        expectedNonce: 'nonce-communication-http-signature',
      },
    }),
  });

  equal(result.status, 'allowed', 'Communication-send gateway: HTTP message signature envelope is allowed');
  equal(result.presentation?.mode, 'http-message-signature', 'Communication-send gateway: HTTP signature presentation is preserved');
  equal(result.offline?.freshness?.nonce.status, 'valid', 'Communication-send gateway: HTTP signature nonce is valid');
  equal(result.request?.transport?.kind === 'http' ? result.request.transport.bodyDigest : null, binding.messageHash, 'Communication-send gateway: signed message body digest is bound');
  equal(result.online?.consumed, true, 'Communication-send gateway: HTTP signature send consumes token use');
  deepEqual(result.failureReasons, [], 'Communication-send gateway: HTTP signature send has no failures');
}

async function testMissingAuthorizationFailsClosed(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { verificationKey } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_missing',
    decisionId: 'decision-communication-send-missing',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const result = await enforceCommunicationSend({
    message: MESSAGE,
    authorization: null,
    options: options({ verificationKey }),
  });

  equal(result.status, 'denied', 'Communication-send gateway: missing authorization is denied');
  equal(result.responseStatus, 401, 'Communication-send gateway: missing authorization maps to challenge status');
  deepEqual(result.failureReasons, ['missing-release-authorization'], 'Communication-send gateway: missing authorization failure is explicit');
  equal(result.request, null, 'Communication-send gateway: missing authorization does not build verifier request');
}

async function testDifferentMessageBodyFailsBinding(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_body',
    decisionId: 'decision-communication-send-body',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceCommunicationSend({
    message: {
      ...MESSAGE,
      body: `${MESSAGE.body}\nTampered instruction: send without review.`,
    },
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-communication-body',
      proofJti: 'dpop-proof-communication-body',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-communication-body',
    }),
  });

  equal(result.status, 'denied', 'Communication-send gateway: changed message body is denied');
  equal(result.responseStatus, 403, 'Communication-send gateway: binding mismatch is non-retryable');
  equal(result.decision?.outcome, 'deny', 'Communication-send gateway: changed message emits deny decision');
  ok(result.failureReasons.includes('binding-mismatch'), 'Communication-send gateway: changed message reports binding mismatch');
}

async function testWrongRecipientFailsAudienceAndBinding(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_recipient',
    decisionId: 'decision-communication-send-recipient',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceCommunicationSend({
    message: {
      ...MESSAGE,
      targetId: 'finance.reporting.external.mailbox',
      recipientId: 'external-reviewers',
    },
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-communication-recipient',
      proofJti: 'dpop-proof-communication-recipient',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-communication-recipient',
    }),
  });

  equal(result.status, 'denied', 'Communication-send gateway: wrong recipient target is denied');
  ok(result.failureReasons.includes('wrong-audience'), 'Communication-send gateway: wrong target reports wrong audience');
  ok(result.failureReasons.includes('binding-mismatch'), 'Communication-send gateway: wrong target also reports binding mismatch');
}

async function testBearerTokenDeniedForCommunicationSendProfile(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_bearer',
    decisionId: 'decision-communication-send-bearer',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceCommunicationSend({
    message: MESSAGE,
    authorization: {
      releaseToken: issued.token,
      releaseTokenId: issued.tokenId,
      releaseDecisionId: decision.id,
      mode: 'bearer-release-token',
    },
    options: options({
      verificationKey,
      introspector,
      store,
    }),
  });

  equal(result.status, 'denied', 'Communication-send gateway: bearer token is denied on sender-constrained send profile');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Communication-send gateway: bearer downgrade maps to binding mismatch');
}

async function testOfflineCommunicationSendRequiresFreshIntrospection(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, binding } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_offline',
    decisionId: 'decision-communication-send-offline',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const result = await enforceCommunicationSend({
    message: MESSAGE,
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-communication-offline',
      proofJti: 'dpop-proof-communication-offline',
    }),
    options: options({
      verificationKey,
      verifierMode: 'offline',
      nonce: 'nonce-communication-offline',
    }),
  });

  equal(result.status, 'denied', 'Communication-send gateway: offline-only send path is denied');
  equal(result.responseStatus, 428, 'Communication-send gateway: offline send requires fresh introspection');
  equal(result.offline?.status, 'indeterminate', 'Communication-send gateway: offline verifier records indeterminate send posture');
  deepEqual(result.failureReasons, ['fresh-introspection-required'], 'Communication-send gateway: fresh introspection requirement is explicit');
}

async function testRevokedTokenFailsClosed(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_revoked',
    decisionId: 'decision-communication-send-revoked',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  store.revokeToken({
    tokenId: issued.tokenId,
    revokedAt: '2026-04-18T18:00:30.000Z',
    reason: 'test revocation',
  });
  const result = await enforceCommunicationSend({
    message: MESSAGE,
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-communication-revoked',
      proofJti: 'dpop-proof-communication-revoked',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-communication-revoked',
    }),
  });

  equal(result.status, 'denied', 'Communication-send gateway: revoked token is denied');
  ok(result.failureReasons.includes('revoked-authorization'), 'Communication-send gateway: revoked reason is explicit');
  equal(result.decision?.outcome, 'deny', 'Communication-send gateway: revoked token emits deny decision');
}

async function testReplayedDpopProofFailsClosed(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueCommunicationToken({
    tokenId: 'rt_communication_send_replayed',
    decisionId: 'decision-communication-send-replayed',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const replayLedgerEntry: ReplayLedgerEntry = {
    subjectKind: 'dpop-proof',
    key: dpopReplayKey('dpop-proof-communication-replayed'),
    firstSeenAt: '2026-04-18T18:00:55.000Z',
    expiresAt: '2026-04-18T18:02:00.000Z',
  };
  const result = await enforceCommunicationSend({
    message: MESSAGE,
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-communication-replayed',
      proofJti: 'dpop-proof-communication-replayed',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-communication-replayed',
      replayLedgerEntry,
    }),
  });

  equal(result.status, 'denied', 'Communication-send gateway: replayed DPoP proof is denied');
  equal(result.responseStatus, 409, 'Communication-send gateway: replayed proof maps to conflict');
  deepEqual(result.failureReasons, ['replayed-authorization'], 'Communication-send gateway: replay reason is explicit');
}

async function testCanonicalizationRejectsAmbiguousValues(): Promise<void> {
  assert.throws(
    () => buildCommunicationSendCanonicalBinding({
      ...MESSAGE,
      body: null,
      html: null,
      templateId: null,
    }),
    /requires message\.body/u,
  );
  passed += 1;

  assert.throws(
    () => buildCommunicationSendCanonicalBinding({
      ...MESSAGE,
      metadata: {
        riskScore: Number.NaN,
      },
    }),
    /non-finite number/u,
  );
  passed += 1;

  assert.throws(
    () => buildCommunicationSendCanonicalBinding({
      ...MESSAGE,
      attachments: [
        {
          attachmentId: 'bad-size',
          fileName: 'bad.txt',
          contentType: 'text/plain',
          digest: 'sha256:bad',
          sizeBytes: -1,
        },
      ],
    }),
    /safe non-negative integer/u,
  );
  passed += 1;
}

async function main(): Promise<void> {
  await testCanonicalBindingIsStable();
  await testValidDpopCommunicationSendAllowsAndConsumesToken();
  await testHttpMessageSignatureCommunicationSendAllows();
  await testMissingAuthorizationFailsClosed();
  await testDifferentMessageBodyFailsBinding();
  await testWrongRecipientFailsAudienceAndBinding();
  await testBearerTokenDeniedForCommunicationSendProfile();
  await testOfflineCommunicationSendRequiresFreshIntrospection();
  await testRevokedTokenFailsClosed();
  await testReplayedDpopProofFailsClosed();
  await testCanonicalizationRejectsAmbiguousValues();

  console.log(`Release enforcement-plane communication-send tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane communication-send tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
