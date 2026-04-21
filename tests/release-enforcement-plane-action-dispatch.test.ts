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
  buildActionDispatchCanonicalBinding,
  enforceActionDispatch,
  RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION,
  type ActionDispatchRequest,
} from '../src/release-enforcement-plane/action-dispatch.js';
import {
  createDpopBoundPresentationFromIssuedToken,
  createDpopProof,
  dpopReplayKey,
  generateDpopKeyPair,
  type DpopKeyPair,
} from '../src/release-enforcement-plane/dpop.js';
import {
  createMtlsBoundPresentationFromIssuedToken,
  createMtlsReleaseTokenConfirmation,
  createSpiffeBoundPresentationFromIssuedToken,
  createSpiffeReleaseTokenConfirmation,
} from '../src/release-enforcement-plane/workload-binding.js';
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

const WORKLOAD_CERT_THUMBPRINT = 'cert-thumbprint-action-dispatch';
const WORKLOAD_SPIFFE_ID = 'spiffe://attestor.test/ns/finance/sa/action-dispatcher';

const ACTION: ActionDispatchRequest = Object.freeze({
  actionType: 'workflow-dispatch',
  operation: 'prepare-filing-submission',
  targetId: 'finance.reporting.release-workflow.dispatch',
  targetKind: 'workflow',
  workflowId: 'finance.reporting.release-workflow',
  requestedTransition: 'prepare-filing-submission',
  parameters: {
    runId: 'run-2026-04-18',
    certificateId: 'cert_finance_action',
    filingReadinessStatus: 'internal_report_ready',
    blockingGaps: 0,
    proofMode: 'hybrid-required',
    approvals: ['primary-reviewer', 'secondary-reviewer'],
  },
  preconditions: [
    {
      preconditionId: 'certificate-bound',
      kind: 'evidence',
      digest: 'sha256:cert-finance-action',
    },
    {
      preconditionId: 'filing-readiness',
      kind: 'state',
      expected: 'internal_report_ready',
    },
  ],
  dryRun: false,
  reason: 'release-authorized filing preparation workflow step',
  idempotencyKey: 'idem-action-dispatch-1',
  actorId: 'svc.finance-action-dispatcher',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
});

function makeDecision(input: {
  readonly id: string;
  readonly binding: ReturnType<typeof buildActionDispatchCanonicalBinding>;
}): ReleaseDecision {
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T19:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-action-dispatch-test.v1',
    policyHash: 'sha256:policy',
    outputHash: input.binding.hashBundle.outputHash,
    consequenceHash: input.binding.hashBundle.consequenceHash,
    outputContract: input.binding.outputContract,
    capabilityBoundary: {
      allowedTools: ['action-dispatch-gateway', 'workflow-dispatch', 'filing-prepare'],
      allowedTargets: [input.binding.target.id],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.release-action-dispatch-test',
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

async function issueActionToken(input: {
  readonly tokenId: string;
  readonly decisionId: string;
  readonly action?: ActionDispatchRequest;
  readonly confirmation?: ReleaseTokenConfirmationClaim;
}): Promise<{
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly decision: ReleaseDecision;
  readonly binding: ReturnType<typeof buildActionDispatchCanonicalBinding>;
}> {
  const binding = buildActionDispatchCanonicalBinding(input.action ?? ACTION);
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    binding,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T19:00:00.000Z',
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
    issuedAt: '2026-04-18T19:00:50.000Z',
    expiresAt: '2026-04-18T19:01:30.000Z',
  };
}

function options(input: {
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly introspector?: ReleaseTokenIntrospector;
  readonly store?: ReleaseTokenIntrospectionStore;
  readonly verifierMode?: 'offline' | 'online';
  readonly nonce?: string;
  readonly replayLedgerEntry?: ReplayLedgerEntry;
}) {
  return {
    verificationKey: input.verificationKey,
    enforcementPointId: 'action-dispatch-gateway-pep',
    environment: 'test',
    tenantId: 'tenant-test',
    accountId: 'acct-test',
    workloadId: WORKLOAD_SPIFFE_ID,
    introspector: input.introspector,
    usageStore: input.store,
    verifierMode: input.verifierMode,
    requestId: 'erq-action-dispatch-test',
    replayLedgerEntry: input.replayLedgerEntry,
    nonceLedgerEntry: input.nonce ? nonceLedgerEntry(input.nonce) : undefined,
    now: () => '2026-04-18T19:01:00.000Z',
  };
}

async function dpopAuthorization(input: {
  readonly issued: IssuedReleaseToken;
  readonly dpopKey: DpopKeyPair;
  readonly binding?: ReturnType<typeof buildActionDispatchCanonicalBinding>;
  readonly nonce?: string;
  readonly proofJti?: string;
  readonly method?: string;
  readonly uri?: string;
}) {
  const binding = input.binding ?? buildActionDispatchCanonicalBinding(ACTION);
  const proof = await createDpopProof({
    privateJwk: input.dpopKey.privateJwk,
    publicJwk: input.dpopKey.publicJwk,
    httpMethod: input.method ?? binding.httpMethod,
    httpUri: input.uri ?? binding.dispatchUri,
    accessToken: input.issued.token,
    nonce: input.nonce ?? 'nonce-action-dispatch',
    proofJti: input.proofJti ?? 'dpop-proof-action-dispatch',
    issuedAt: '2026-04-18T19:01:00.000Z',
  });
  const presentation = createDpopBoundPresentationFromIssuedToken({
    issuedToken: input.issued,
    proof,
    presentedAt: '2026-04-18T19:01:00.000Z',
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

function mtlsAuthorization(issued: IssuedReleaseToken) {
  const presentation = createMtlsBoundPresentationFromIssuedToken({
    issuedToken: issued,
    certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
    subjectDn: 'CN=finance-action-dispatcher',
    spiffeId: WORKLOAD_SPIFFE_ID,
    presentedAt: '2026-04-18T19:01:00.000Z',
  });
  return {
    releaseToken: issued.token,
    releaseTokenId: issued.tokenId,
    releaseDecisionId: issued.claims.decision_id,
    mode: presentation.mode,
    proof: presentation.proof,
    issuer: presentation.issuer,
    subject: presentation.subject,
    audience: presentation.audience,
    expiresAt: presentation.expiresAt,
    scope: presentation.scope,
  } as const;
}

function spiffeAuthorization(issued: IssuedReleaseToken) {
  const presentation = createSpiffeBoundPresentationFromIssuedToken({
    issuedToken: issued,
    spiffeId: WORKLOAD_SPIFFE_ID,
    svidThumbprint: WORKLOAD_CERT_THUMBPRINT,
    presentedAt: '2026-04-18T19:01:00.000Z',
  });
  return {
    releaseToken: issued.token,
    releaseTokenId: issued.tokenId,
    releaseDecisionId: issued.claims.decision_id,
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
  const left = buildActionDispatchCanonicalBinding(ACTION);
  const reordered = buildActionDispatchCanonicalBinding({
    ...ACTION,
    parameters: {
      approvals: ['primary-reviewer', 'secondary-reviewer'],
      proofMode: 'hybrid-required',
      blockingGaps: 0,
      filingReadinessStatus: 'internal_report_ready',
      certificateId: 'cert_finance_action',
      runId: 'run-2026-04-18',
    },
    preconditions: [...(ACTION.preconditions ?? [])].reverse(),
  });

  equal(left.version, RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION, 'Action-dispatch gateway: binding stamps stable spec version');
  equal(left.target.id, 'finance.reporting.release-workflow.dispatch', 'Action-dispatch gateway: target binds workflow dispatch endpoint');
  equal(left.target.kind, 'workflow', 'Action-dispatch gateway: target kind is workflow');
  equal(left.outputContract.consequenceType, 'action', 'Action-dispatch gateway: output contract is action consequence');
  equal(left.outputContract.riskClass, 'R3', 'Action-dispatch gateway: default action risk class is R3');
  ok(left.hashBundle.outputHash.startsWith('sha256:'), 'Action-dispatch gateway: output hash is canonicalized');
  ok(left.hashBundle.consequenceHash.startsWith('sha256:'), 'Action-dispatch gateway: consequence hash is canonicalized');
  equal(left.dispatchHash, reordered.dispatchHash, 'Action-dispatch gateway: parameter and precondition ordering do not change dispatch hash');
  equal(left.hashBundle.outputHash, reordered.hashBundle.outputHash, 'Action-dispatch gateway: reordered action fields retain output binding');
}

async function testValidDpopActionDispatchAllowsAndConsumesToken(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueActionToken({
    tokenId: 'rt_action_dispatch_allow',
    decisionId: 'decision-action-dispatch-allow',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceActionDispatch({
    action: ACTION,
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-action-dispatch',
      proofJti: 'dpop-proof-action-dispatch',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-action-dispatch',
    }),
  });

  equal(result.status, 'allowed', 'Action-dispatch gateway: valid DPoP-bound action is allowed');
  equal(result.responseStatus, 200, 'Action-dispatch gateway: allowed result is dispatch-ready');
  equal(result.decision?.outcome, 'allow', 'Action-dispatch gateway: valid action emits allow decision');
  ok(result.receipt?.receiptDigest?.startsWith('sha256:'), 'Action-dispatch gateway: allowed action emits receipt digest');
  equal(result.request?.enforcementPoint.boundaryKind, 'action-dispatch', 'Action-dispatch gateway: request uses action-dispatch boundary');
  equal(result.request?.targetId, result.binding.target.id, 'Action-dispatch gateway: request target matches action binding');
  equal(result.request?.outputHash, result.binding.hashBundle.outputHash, 'Action-dispatch gateway: request output hash matches binding');
  equal(result.request?.consequenceHash, result.binding.hashBundle.consequenceHash, 'Action-dispatch gateway: request consequence hash matches binding');
  equal(result.request?.transport?.kind, 'http', 'Action-dispatch gateway: dispatch transport is HTTP-bound');
  equal(result.request?.transport?.kind === 'http' ? result.request.transport.uri : null, binding.dispatchUri, 'Action-dispatch gateway: DPoP proof is bound to dispatch URI');
  equal(result.online?.onlineChecked, true, 'Action-dispatch gateway: action performs online introspection');
  equal(result.online?.consumed, true, 'Action-dispatch gateway: successful action consumes token use');
  deepEqual(result.failureReasons, [], 'Action-dispatch gateway: valid action has no failures');
}

async function testValidMtlsActionDispatchAllowsWithoutNonce(): Promise<void> {
  const { issued, verificationKey, decision } = await issueActionToken({
    tokenId: 'rt_action_dispatch_mtls',
    decisionId: 'decision-action-dispatch-mtls',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceActionDispatch({
    action: ACTION,
    authorization: mtlsAuthorization(issued),
    options: options({
      verificationKey,
      introspector,
      store,
    }),
  });

  equal(result.status, 'allowed', 'Action-dispatch gateway: valid mTLS-bound action is allowed');
  equal(result.presentation?.mode, 'mtls-bound-token', 'Action-dispatch gateway: mTLS presentation is preserved');
  equal(result.offline?.freshness?.nonce.status, 'not-required', 'Action-dispatch gateway: mTLS action does not require nonce freshness');
  equal(result.online?.consumed, true, 'Action-dispatch gateway: mTLS action consumes token use');
  deepEqual(result.failureReasons, [], 'Action-dispatch gateway: valid mTLS action has no failures');
}

async function testValidSpiffeActionDispatchAllows(): Promise<void> {
  const { issued, verificationKey, decision } = await issueActionToken({
    tokenId: 'rt_action_dispatch_spiffe',
    decisionId: 'decision-action-dispatch-spiffe',
    confirmation: createSpiffeReleaseTokenConfirmation({
      spiffeId: WORKLOAD_SPIFFE_ID,
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
    }),
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceActionDispatch({
    action: ACTION,
    authorization: spiffeAuthorization(issued),
    options: options({
      verificationKey,
      introspector,
      store,
    }),
  });

  equal(result.status, 'allowed', 'Action-dispatch gateway: valid SPIFFE-bound action is allowed');
  equal(result.presentation?.mode, 'spiffe-bound-token', 'Action-dispatch gateway: SPIFFE presentation is preserved');
  equal(result.online?.consumed, true, 'Action-dispatch gateway: SPIFFE action consumes token use');
  deepEqual(result.failureReasons, [], 'Action-dispatch gateway: valid SPIFFE action has no failures');
}

async function testMissingAuthorizationFailsClosed(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { verificationKey } = await issueActionToken({
    tokenId: 'rt_action_dispatch_missing',
    decisionId: 'decision-action-dispatch-missing',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const result = await enforceActionDispatch({
    action: ACTION,
    authorization: null,
    options: options({ verificationKey }),
  });

  equal(result.status, 'denied', 'Action-dispatch gateway: missing authorization is denied');
  equal(result.responseStatus, 401, 'Action-dispatch gateway: missing authorization maps to challenge status');
  deepEqual(result.failureReasons, ['missing-release-authorization'], 'Action-dispatch gateway: missing authorization failure is explicit');
  equal(result.request, null, 'Action-dispatch gateway: missing authorization does not build verifier request');
}

async function testDifferentActionParametersFailBinding(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueActionToken({
    tokenId: 'rt_action_dispatch_parameters',
    decisionId: 'decision-action-dispatch-parameters',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceActionDispatch({
    action: {
      ...ACTION,
      parameters: {
        ...ACTION.parameters as Record<string, unknown>,
        blockingGaps: 2,
      } as any,
    },
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-action-parameters',
      proofJti: 'dpop-proof-action-parameters',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-action-parameters',
    }),
  });

  equal(result.status, 'denied', 'Action-dispatch gateway: changed parameters are denied');
  equal(result.responseStatus, 403, 'Action-dispatch gateway: binding mismatch is non-retryable');
  equal(result.decision?.outcome, 'deny', 'Action-dispatch gateway: changed parameters emit deny decision');
  ok(result.failureReasons.includes('binding-mismatch'), 'Action-dispatch gateway: changed parameters report binding mismatch');
}

async function testWrongActionTargetFailsAudienceAndBinding(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueActionToken({
    tokenId: 'rt_action_dispatch_target',
    decisionId: 'decision-action-dispatch-target',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceActionDispatch({
    action: {
      ...ACTION,
      targetId: 'finance.reporting.release-workflow.external-dispatch',
    },
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-action-target',
      proofJti: 'dpop-proof-action-target',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-action-target',
    }),
  });

  equal(result.status, 'denied', 'Action-dispatch gateway: wrong action target is denied');
  ok(result.failureReasons.includes('wrong-audience'), 'Action-dispatch gateway: wrong target reports wrong audience');
  ok(result.failureReasons.includes('binding-mismatch'), 'Action-dispatch gateway: wrong target also reports binding mismatch');
}

async function testBearerTokenDeniedForActionDispatchProfile(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision } = await issueActionToken({
    tokenId: 'rt_action_dispatch_bearer',
    decisionId: 'decision-action-dispatch-bearer',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceActionDispatch({
    action: ACTION,
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

  equal(result.status, 'denied', 'Action-dispatch gateway: bearer token is denied on sender-constrained action profile');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Action-dispatch gateway: bearer downgrade maps to binding mismatch');
}

async function testOfflineActionDispatchRequiresFreshIntrospection(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, binding } = await issueActionToken({
    tokenId: 'rt_action_dispatch_offline',
    decisionId: 'decision-action-dispatch-offline',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const result = await enforceActionDispatch({
    action: ACTION,
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-action-offline',
      proofJti: 'dpop-proof-action-offline',
    }),
    options: options({
      verificationKey,
      verifierMode: 'offline',
      nonce: 'nonce-action-offline',
    }),
  });

  equal(result.status, 'denied', 'Action-dispatch gateway: offline-only action path is denied');
  equal(result.responseStatus, 428, 'Action-dispatch gateway: offline action requires fresh introspection');
  equal(result.offline?.status, 'indeterminate', 'Action-dispatch gateway: offline verifier records indeterminate action posture');
  deepEqual(result.failureReasons, ['fresh-introspection-required'], 'Action-dispatch gateway: fresh introspection requirement is explicit');
}

async function testRevokedTokenFailsClosed(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueActionToken({
    tokenId: 'rt_action_dispatch_revoked',
    decisionId: 'decision-action-dispatch-revoked',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  store.revokeToken({
    tokenId: issued.tokenId,
    revokedAt: '2026-04-18T19:00:30.000Z',
    reason: 'test revocation',
  });
  const result = await enforceActionDispatch({
    action: ACTION,
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-action-revoked',
      proofJti: 'dpop-proof-action-revoked',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-action-revoked',
    }),
  });

  equal(result.status, 'denied', 'Action-dispatch gateway: revoked token is denied');
  ok(result.failureReasons.includes('revoked-authorization'), 'Action-dispatch gateway: revoked reason is explicit');
  equal(result.decision?.outcome, 'deny', 'Action-dispatch gateway: revoked token emits deny decision');
}

async function testReplayedDpopProofFailsClosed(): Promise<void> {
  const dpopKey = await generateDpopKeyPair();
  const { issued, verificationKey, decision, binding } = await issueActionToken({
    tokenId: 'rt_action_dispatch_replayed',
    decisionId: 'decision-action-dispatch-replayed',
    confirmation: { jkt: dpopKey.publicKeyThumbprint },
  });
  const { store, introspector } = register(issued, decision);
  const replayLedgerEntry: ReplayLedgerEntry = {
    subjectKind: 'dpop-proof',
    key: dpopReplayKey('dpop-proof-action-replayed'),
    firstSeenAt: '2026-04-18T19:00:55.000Z',
    expiresAt: '2026-04-18T19:01:30.000Z',
  };
  const result = await enforceActionDispatch({
    action: ACTION,
    authorization: await dpopAuthorization({
      issued,
      dpopKey,
      binding,
      nonce: 'nonce-action-replayed',
      proofJti: 'dpop-proof-action-replayed',
    }),
    options: options({
      verificationKey,
      introspector,
      store,
      nonce: 'nonce-action-replayed',
      replayLedgerEntry,
    }),
  });

  equal(result.status, 'denied', 'Action-dispatch gateway: replayed DPoP proof is denied');
  equal(result.responseStatus, 409, 'Action-dispatch gateway: replayed proof maps to conflict');
  deepEqual(result.failureReasons, ['replayed-authorization'], 'Action-dispatch gateway: replay reason is explicit');
}

async function testCanonicalizationRejectsAmbiguousValues(): Promise<void> {
  assert.throws(
    () => buildActionDispatchCanonicalBinding({
      ...ACTION,
      actionType: 'unbounded-shell' as any,
    }),
    /unsupported/u,
  );
  passed += 1;

  assert.throws(
    () => buildActionDispatchCanonicalBinding({
      ...ACTION,
      parameters: {
        riskScore: Number.POSITIVE_INFINITY,
      },
    }),
    /non-finite number/u,
  );
  passed += 1;

  assert.throws(
    () => buildActionDispatchCanonicalBinding({
      ...ACTION,
      traceparent: 'trace-me',
    }),
    /Trace Context/u,
  );
  passed += 1;
}

async function main(): Promise<void> {
  await testCanonicalBindingIsStable();
  await testValidDpopActionDispatchAllowsAndConsumesToken();
  await testValidMtlsActionDispatchAllowsWithoutNonce();
  await testValidSpiffeActionDispatchAllows();
  await testMissingAuthorizationFailsClosed();
  await testDifferentActionParametersFailBinding();
  await testWrongActionTargetFailsAudienceAndBinding();
  await testBearerTokenDeniedForActionDispatchProfile();
  await testOfflineActionDispatchRequiresFreshIntrospection();
  await testRevokedTokenFailsClosed();
  await testReplayedDpopProofFailsClosed();
  await testCanonicalizationRejectsAmbiguousValues();

  console.log(`Release enforcement-plane action-dispatch tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane action-dispatch tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
