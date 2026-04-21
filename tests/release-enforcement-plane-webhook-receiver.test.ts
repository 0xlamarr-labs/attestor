import assert from 'node:assert/strict';
import { Hono } from 'hono';
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
  type ReleaseTokenIntrospectionStore,
  type ReleaseTokenIntrospector,
} from '../src/release-kernel/release-introspection.js';
import type { CreateEnforcementPointReferenceInput } from '../src/release-enforcement-plane/types.js';
import type { NonceLedgerEntry, ReplayLedgerEntry } from '../src/release-enforcement-plane/freshness.js';
import {
  createHttpAuthorizationEnvelope,
  createHttpMessageSignatureReleaseTokenConfirmation,
  generateHttpMessageSignatureKeyPair,
  type HttpAuthorizationEnvelope,
  type HttpMessageSignatureKeyPair,
} from '../src/release-enforcement-plane/http-message-signatures.js';
import {
  ATTESTOR_WEBHOOK_EVENT_ID_HEADER,
  ATTESTOR_WEBHOOK_RECEIVER_STATUS_HEADER,
  HONO_RELEASE_WEBHOOK_BODY_CONTEXT_KEY,
  HONO_RELEASE_WEBHOOK_RECEIVER_CONTEXT_KEY,
  RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION,
  createHonoReleaseWebhookReceiver,
  evaluateReleaseWebhookRequest,
  releaseWebhookReceiverDeniedBody,
  type HonoReleaseWebhookReceiverEnv,
  type ReleaseWebhookReceiverOptions,
} from '../src/release-enforcement-plane/webhook-receiver.js';

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
  event: 'attestor.release.accepted',
  target: 'webhook.receiver.workflow',
  consequence: 'workflow.dispatch',
});
const TARGET_ID = 'webhook.receiver.workflow';
const OUTPUT_HASH = 'sha256:output';
const CONSEQUENCE_HASH = 'sha256:consequence';
const POLICY_HASH = 'sha256:policy';
const WEBHOOK_URL = 'https://webhooks.attestor.test/hooks/release?attempt=1';

function makeDecision(input: {
  readonly id: string;
  readonly targetId?: string;
  readonly consequenceType?: 'action' | 'communication' | 'record';
  readonly riskClass?: 'R2' | 'R3';
}): ReleaseDecision {
  const consequenceType = input.consequenceType ?? 'action';
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T16:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-webhook-receiver-test.v1',
    policyHash: POLICY_HASH,
    outputHash: OUTPUT_HASH,
    consequenceHash: CONSEQUENCE_HASH,
    outputContract: {
      artifactType: 'release-webhook-receiver-test.artifact',
      expectedShape: 'deterministic webhook receiver payload',
      consequenceType,
      riskClass: input.riskClass ?? 'R3',
    },
    capabilityBoundary: {
      allowedTools: ['release-webhook-receiver-test-tool'],
      allowedTargets: [input.targetId ?? TARGET_ID],
      allowedDataDomains: ['release-webhook-receiver-test'],
    },
    requester: {
      id: 'svc.release-webhook-receiver-test',
      type: 'service',
    },
    target: {
      kind: consequenceType === 'record' ? 'record-store' : 'workflow',
      id: input.targetId ?? TARGET_ID,
    },
  });
}

function webhookPoint(input: {
  readonly targetId?: string;
  readonly consequenceType?: 'action' | 'communication' | 'record';
  readonly riskClass?: 'R2' | 'R3';
} = {}): CreateEnforcementPointReferenceInput {
  return {
    environment: 'test',
    enforcementPointId: 'webhook-receiver-pep',
    pointKind: 'webhook-receiver',
    boundaryKind: 'webhook',
    consequenceType: input.consequenceType ?? 'action',
    riskClass: input.riskClass ?? 'R3',
    tenantId: 'tenant-test',
    accountId: 'acct-test',
    workloadId: 'spiffe://attestor/tests/webhook-receiver',
    audience: input.targetId ?? TARGET_ID,
  };
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

async function issueWebhookToken(input: {
  readonly signatureKey: HttpMessageSignatureKeyPair;
  readonly tokenId: string;
  readonly decisionId: string;
  readonly targetId?: string;
  readonly consequenceType?: 'action' | 'communication' | 'record';
  readonly riskClass?: 'R2' | 'R3';
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
    issuedAt: '2026-04-18T16:00:00.000Z',
    tokenId: input.tokenId,
    confirmation: createHttpMessageSignatureReleaseTokenConfirmation({
      publicKeyThumbprint: input.signatureKey.publicKeyThumbprint,
    }),
  });

  return { issued, verificationKey, decision };
}

async function makeEnvelope(input: {
  readonly signatureKey: HttpMessageSignatureKeyPair;
  readonly issued: IssuedReleaseToken;
  readonly body?: string;
  readonly nonce?: string;
  readonly url?: string;
}): Promise<HttpAuthorizationEnvelope> {
  return createHttpAuthorizationEnvelope({
    request: {
      method: 'POST',
      uri: input.url ?? WEBHOOK_URL,
      headers: {
        'content-type': 'application/json',
      },
      body: input.body ?? BODY,
    },
    issuedToken: input.issued,
    privateJwk: input.signatureKey.privateJwk,
    publicJwk: input.signatureKey.publicJwk,
    createdAt: '2026-04-18T16:01:00.000Z',
    expiresAt: '2026-04-18T16:02:00.000Z',
    nonce: input.nonce ?? 'nonce-webhook-1',
    presentedAt: '2026-04-18T16:01:00.000Z',
  });
}

function nonceLedger(nonce: string): NonceLedgerEntry {
  return {
    nonce,
    issuedAt: '2026-04-18T16:00:50.000Z',
    expiresAt: '2026-04-18T16:01:50.000Z',
  };
}

function replayLedger(key: string): ReplayLedgerEntry {
  return {
    subjectKind: 'http-message-signature',
    key,
    firstSeenAt: '2026-04-18T16:01:01.000Z',
    expiresAt: '2026-04-18T16:02:00.000Z',
  };
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

function receiverOptions(input: {
  readonly signatureKey: HttpMessageSignatureKeyPair;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly introspector?: ReleaseTokenIntrospector;
  readonly store?: ReleaseTokenIntrospectionStore;
  readonly nonce?: string;
  readonly replayLedgerEntry?: ReplayLedgerEntry | null;
  readonly breakGlass?: boolean;
}): ReleaseWebhookReceiverOptions {
  return {
    verificationKey: input.verificationKey,
    signaturePublicJwk: input.signatureKey.publicJwk,
    enforcementPoint: webhookPoint(),
    introspector: input.introspector,
    usageStore: input.store,
    nonceLedgerEntry: input.nonce ? nonceLedger(input.nonce) : undefined,
    replayLedgerEntry: input.replayLedgerEntry,
    expectedNonce: input.nonce,
    now: () => '2026-04-18T16:01:10.000Z',
    breakGlassGrant: input.breakGlass
      ? {
          reason: 'control-plane-recovery',
          authorizedBy: {
            id: 'user.release-operator',
            type: 'user',
            role: 'release-operator',
          },
          authorizedAt: '2026-04-18T16:00:30.000Z',
          expiresAt: '2026-04-18T16:05:00.000Z',
          ticketId: 'INC-4242',
          rationale: 'Control-plane introspection is degraded; local signature verification remains valid.',
        }
      : undefined,
  };
}

async function setupValidWebhook(input: {
  readonly tokenId: string;
  readonly decisionId: string;
  readonly nonce: string;
}) {
  const signatureKey = await generateHttpMessageSignatureKeyPair();
  const { issued, verificationKey, decision } = await issueWebhookToken({
    signatureKey,
    tokenId: input.tokenId,
    decisionId: input.decisionId,
  });
  const envelope = await makeEnvelope({
    signatureKey,
    issued,
    nonce: input.nonce,
  });
  return { signatureKey, issued, verificationKey, decision, envelope };
}

async function testDirectReceiverAcceptsSignedWebhook(): Promise<void> {
  const { signatureKey, issued, verificationKey, decision, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_valid',
    decisionId: 'decision-webhook-receiver-valid',
    nonce: 'nonce-webhook-valid',
  });
  const { store, introspector } = register(issued, decision);
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'POST',
      url: envelope.uri,
      headers: new Headers(envelope.headers),
      body: BODY,
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-webhook-valid',
    }),
  );

  equal(result.version, RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION, 'Webhook receiver: result stamps stable spec version');
  equal(result.status, 'accepted', 'Webhook receiver: accepts valid signed webhook');
  equal(result.responseStatus, 202, 'Webhook receiver: accepted result is admission-ready');
  equal(result.decision?.outcome, 'allow', 'Webhook receiver: valid webhook creates allow decision');
  ok(result.receipt?.receiptDigest?.startsWith('sha256:'), 'Webhook receiver: accepted webhook emits receipt digest');
  equal(result.online?.onlineChecked, true, 'Webhook receiver: webhook path performs online introspection');
  equal(result.online?.consumed, true, 'Webhook receiver: accepted webhook consumes token use');
  equal(result.offline?.freshness?.nonce.status, 'valid', 'Webhook receiver: nonce freshness is valid');
  deepEqual(result.failureReasons, [], 'Webhook receiver: valid webhook has no failures');
}

async function testMissingSignatureFailsClosed(): Promise<void> {
  const { signatureKey, verificationKey, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_missing_sig',
    decisionId: 'decision-webhook-receiver-missing-sig',
    nonce: 'nonce-webhook-missing-sig',
  });
  const headers = new Headers(envelope.headers);
  headers.delete('signature');
  headers.delete('signature-input');
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'POST',
      url: envelope.uri,
      headers,
      body: BODY,
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      nonce: 'nonce-webhook-missing-sig',
    }),
  );

  equal(result.status, 'rejected', 'Webhook receiver: missing HTTP signature is rejected');
  equal(result.responseStatus, 401, 'Webhook receiver: missing signature fails before handler admission');
  deepEqual(result.failureReasons, ['invalid-signature'], 'Webhook receiver: missing signature failure is explicit');
  equal(result.decision, null, 'Webhook receiver: missing envelope has no admission decision');
}

async function testTamperedBodyIsDenied(): Promise<void> {
  const { signatureKey, issued, verificationKey, decision, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_tamper',
    decisionId: 'decision-webhook-receiver-tamper',
    nonce: 'nonce-webhook-tamper',
  });
  const { store, introspector } = register(issued, decision);
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'POST',
      url: envelope.uri,
      headers: new Headers(envelope.headers),
      body: JSON.stringify({ event: 'tampered' }),
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-webhook-tamper',
    }),
  );

  equal(result.status, 'rejected', 'Webhook receiver: tampered body is rejected');
  equal(result.responseStatus, 403, 'Webhook receiver: body tampering is not retryable');
  equal(result.decision?.outcome, 'deny', 'Webhook receiver: tampered body creates deny decision');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Webhook receiver: content digest mismatch maps to binding mismatch');
  equal(result.retryable, false, 'Webhook receiver: tampered body rejection is non-retryable');
}

async function testReplayLedgerHitIsConflict(): Promise<void> {
  const { signatureKey, issued, verificationKey, decision, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_replay',
    decisionId: 'decision-webhook-receiver-replay',
    nonce: 'nonce-webhook-replay',
  });
  const { store, introspector } = register(issued, decision);
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'POST',
      url: envelope.uri,
      headers: new Headers(envelope.headers),
      body: BODY,
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-webhook-replay',
      replayLedgerEntry: replayLedger(envelope.replayKey),
    }),
  );

  equal(result.status, 'rejected', 'Webhook receiver: replayed signature is rejected');
  equal(result.responseStatus, 409, 'Webhook receiver: replay maps to conflict');
  deepEqual(result.failureReasons, ['replayed-authorization'], 'Webhook receiver: replay reason is explicit');
  equal(result.decision?.outcome, 'deny', 'Webhook receiver: replay creates deny decision');
}

async function testIntrospectionUnavailableRequiresBreakGlass(): Promise<void> {
  const { signatureKey, verificationKey, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_no_introspection',
    decisionId: 'decision-webhook-receiver-no-introspection',
    nonce: 'nonce-webhook-no-introspection',
  });
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'POST',
      url: envelope.uri,
      headers: new Headers(envelope.headers),
      body: BODY,
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      nonce: 'nonce-webhook-no-introspection',
    }),
  );

  equal(result.status, 'rejected', 'Webhook receiver: online-required path rejects when introspection is unavailable');
  equal(result.responseStatus, 503, 'Webhook receiver: introspection outage is retryable');
  equal(result.retryable, true, 'Webhook receiver: retry hint is set for control-plane outage');
  deepEqual(
    result.failureReasons,
    ['introspection-unavailable', 'break-glass-required'],
    'Webhook receiver: missing break-glass grant is explicit',
  );
  equal(result.decision?.outcome, 'deny', 'Webhook receiver: outage without break-glass remains deny');
}

async function testBreakGlassCanAdmitLocallyVerifiedWebhook(): Promise<void> {
  const { signatureKey, verificationKey, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_break_glass',
    decisionId: 'decision-webhook-receiver-break-glass',
    nonce: 'nonce-webhook-break-glass',
  });
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'POST',
      url: envelope.uri,
      headers: new Headers(envelope.headers),
      body: BODY,
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      nonce: 'nonce-webhook-break-glass',
      breakGlass: true,
    }),
  );

  equal(result.status, 'break-glass-accepted', 'Webhook receiver: active grant can admit locally verified webhook');
  equal(result.responseStatus, 202, 'Webhook receiver: break-glass admission is handler-ready');
  equal(result.decision?.outcome, 'break-glass-allow', 'Webhook receiver: break-glass creates explicit outcome');
  equal(result.breakGlass?.ticketId, 'INC-4242', 'Webhook receiver: break-glass grant is retained');
  deepEqual(result.failureReasons, ['introspection-unavailable'], 'Webhook receiver: break-glass keeps original failure reasons');
}

async function testBreakGlassCannotBypassInvalidSignature(): Promise<void> {
  const { signatureKey, verificationKey, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_break_glass_tamper',
    decisionId: 'decision-webhook-receiver-break-glass-tamper',
    nonce: 'nonce-webhook-break-glass-tamper',
  });
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'POST',
      url: envelope.uri,
      headers: new Headers(envelope.headers),
      body: JSON.stringify({ event: 'tampered' }),
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      nonce: 'nonce-webhook-break-glass-tamper',
      breakGlass: true,
    }),
  );

  equal(result.status, 'rejected', 'Webhook receiver: break-glass cannot bypass invalid signature binding');
  equal(result.decision?.outcome, 'deny', 'Webhook receiver: invalid signed envelope remains deny under break-glass');
  equal(result.breakGlass, null, 'Webhook receiver: invalid envelope does not attach break-glass grant');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Webhook receiver: invalid signature failure is preserved');
}

async function testRejectedResponseBodyAndHeaders(): Promise<void> {
  const { signatureKey, verificationKey, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_body',
    decisionId: 'decision-webhook-receiver-body',
    nonce: 'nonce-webhook-body',
  });
  const headers = new Headers(envelope.headers);
  headers.delete('authorization');
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'POST',
      url: envelope.uri,
      headers,
      body: BODY,
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      nonce: 'nonce-webhook-body',
    }),
  );
  const body = releaseWebhookReceiverDeniedBody(result);

  equal(result.status, 'rejected', 'Webhook receiver: missing bearer token is rejected');
  equal(result.responseStatus, 401, 'Webhook receiver: missing bearer token maps to challenge status');
  deepEqual(body.failureReasons, ['missing-release-authorization'], 'Webhook receiver: denied body reports failure reasons');
  equal(body.requestId, null, 'Webhook receiver: denied body omits request id when request was not built');
  equal(body.retryable, false, 'Webhook receiver: missing authorization is not retryable');
}

async function testMethodGuardFailsBeforeVerification(): Promise<void> {
  const { signatureKey, verificationKey, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_get',
    decisionId: 'decision-webhook-receiver-get',
    nonce: 'nonce-webhook-get',
  });
  const result = await evaluateReleaseWebhookRequest(
    {
      method: 'GET',
      url: envelope.uri,
      headers: new Headers(envelope.headers),
      body: BODY,
    },
    receiverOptions({
      signatureKey,
      verificationKey,
      nonce: 'nonce-webhook-get',
    }),
  );

  equal(result.status, 'rejected', 'Webhook receiver: non-POST webhook request is rejected');
  equal(result.responseStatus, 405, 'Webhook receiver: method guard maps to method-not-allowed');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Webhook receiver: method guard records binding mismatch');
}

async function testHonoReceiverAdmitsHandlerAfterVerification(): Promise<void> {
  const { signatureKey, issued, verificationKey, decision, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_hono',
    decisionId: 'decision-webhook-receiver-hono',
    nonce: 'nonce-webhook-hono',
  });
  const { store, introspector } = register(issued, decision);
  const app = new Hono<HonoReleaseWebhookReceiverEnv>();
  let handlerReached = 0;

  app.post(
    '/hooks/release',
    createHonoReleaseWebhookReceiver(
      receiverOptions({
        signatureKey,
        verificationKey,
        introspector,
        store,
        nonce: 'nonce-webhook-hono',
      }),
      (context, result, body) => {
        handlerReached += 1;
        const storedResult = context.get(HONO_RELEASE_WEBHOOK_RECEIVER_CONTEXT_KEY);
        const storedBody = context.get(HONO_RELEASE_WEBHOOK_BODY_CONTEXT_KEY);
        return context.json({
          status: result.status,
          storedStatus: storedResult.status,
          bodyLength: body.byteLength,
          storedBodyLength: storedBody.byteLength,
          outcome: result.decision?.outcome,
        }, 202);
      },
    ),
  );

  const response = await app.request(envelope.uri, {
    method: 'POST',
    headers: new Headers({
      ...envelope.headers,
      [ATTESTOR_WEBHOOK_EVENT_ID_HEADER]: 'evt-webhook-hono',
    }),
    body: BODY,
  });
  const body = await response.json() as {
    readonly status: string;
    readonly storedStatus: string;
    readonly bodyLength: number;
    readonly storedBodyLength: number;
    readonly outcome: string;
  };

  equal(response.status, 202, 'Webhook receiver: Hono handler returns accepted response');
  equal(response.headers.get(ATTESTOR_WEBHOOK_RECEIVER_STATUS_HEADER), 'accepted', 'Webhook receiver: Hono stamps status header');
  equal(handlerReached, 1, 'Webhook receiver: Hono handler runs after verification');
  equal(body.status, 'accepted', 'Webhook receiver: Hono handler sees accepted result');
  equal(body.storedStatus, 'accepted', 'Webhook receiver: Hono context stores result');
  equal(body.bodyLength, BODY.length, 'Webhook receiver: Hono handler receives raw body bytes');
  equal(body.storedBodyLength, BODY.length, 'Webhook receiver: Hono context stores raw body bytes');
  equal(body.outcome, 'allow', 'Webhook receiver: Hono handler receives allow decision');
}

async function testHonoReceiverBlocksRejectedWebhook(): Promise<void> {
  const { signatureKey, verificationKey, envelope } = await setupValidWebhook({
    tokenId: 'rt_webhook_receiver_hono_block',
    decisionId: 'decision-webhook-receiver-hono-block',
    nonce: 'nonce-webhook-hono-block',
  });
  const app = new Hono<HonoReleaseWebhookReceiverEnv>();
  let handlerReached = 0;

  app.post(
    '/hooks/release',
    createHonoReleaseWebhookReceiver(
      receiverOptions({
        signatureKey,
        verificationKey,
        nonce: 'nonce-webhook-hono-block',
      }),
      () => {
        handlerReached += 1;
        return new Response('should not run');
      },
    ),
  );

  const response = await app.request(envelope.uri, {
    method: 'POST',
    headers: new Headers(envelope.headers),
    body: BODY,
  });
  const body = await response.json() as { readonly failureReasons: readonly string[] };

  equal(response.status, 503, 'Webhook receiver: Hono returns fail-closed response when introspection is unavailable');
  equal(response.headers.get(ATTESTOR_WEBHOOK_RECEIVER_STATUS_HEADER), 'rejected', 'Webhook receiver: Hono stamps rejected status');
  equal(handlerReached, 0, 'Webhook receiver: rejected Hono webhook does not reach handler');
  deepEqual(body.failureReasons, ['introspection-unavailable', 'break-glass-required'], 'Webhook receiver: Hono rejection reports failures');
}

async function main(): Promise<void> {
  await testDirectReceiverAcceptsSignedWebhook();
  await testMissingSignatureFailsClosed();
  await testTamperedBodyIsDenied();
  await testReplayLedgerHitIsConflict();
  await testIntrospectionUnavailableRequiresBreakGlass();
  await testBreakGlassCanAdmitLocallyVerifiedWebhook();
  await testBreakGlassCannotBypassInvalidSignature();
  await testRejectedResponseBodyAndHeaders();
  await testMethodGuardFailsBeforeVerification();
  await testHonoReceiverAdmitsHandlerAfterVerification();
  await testHonoReceiverBlocksRejectedWebhook();

  console.log(`Release enforcement-plane webhook receiver tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane webhook receiver tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
