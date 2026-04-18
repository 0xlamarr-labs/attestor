import assert from 'node:assert/strict';
import {
  ENFORCEMENT_DECISION_SPEC_VERSION,
  ENFORCEMENT_RECEIPT_SPEC_VERSION,
  ENFORCEMENT_REQUEST_SPEC_VERSION,
  INTROSPECTION_SNAPSHOT_SPEC_VERSION,
  RELEASE_ENFORCEMENT_OBJECT_MODEL_SPEC_VERSION,
  RELEASE_PRESENTATION_SPEC_VERSION,
  VERIFICATION_RESULT_SPEC_VERSION,
  createEnforcementDecision,
  createEnforcementReceipt,
  createEnforcementRequest,
  createIntrospectionSnapshot,
  createReleasePresentation,
  createVerificationResult,
} from '../src/release-enforcement-plane/object-model.js';

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

function sampleEnforcementPoint() {
  return {
    environment: ' prod-eu ',
    enforcementPointId: ' filing-export-pep ',
    pointKind: 'record-write-gateway',
    boundaryKind: 'record-write',
    consequenceType: 'record',
    riskClass: 'R4',
    tenantId: ' tenant-finance ',
    accountId: ' acct-enterprise ',
    workloadId: ' spiffe://attestor/api ',
    audience: ' filing-export ',
  } as const;
}

function testSpecVersions(): void {
  equal(RELEASE_ENFORCEMENT_OBJECT_MODEL_SPEC_VERSION, 'attestor.release-enforcement-object-model.v1', 'Enforcement object model: shared schema version is stable');
  equal(ENFORCEMENT_REQUEST_SPEC_VERSION, 'attestor.enforcement-request.v1', 'Enforcement object model: request schema version is stable');
  equal(RELEASE_PRESENTATION_SPEC_VERSION, 'attestor.release-presentation.v1', 'Enforcement object model: presentation schema version is stable');
  equal(INTROSPECTION_SNAPSHOT_SPEC_VERSION, 'attestor.introspection-snapshot.v1', 'Enforcement object model: introspection schema version is stable');
  equal(VERIFICATION_RESULT_SPEC_VERSION, 'attestor.verification-result.v1', 'Enforcement object model: verification schema version is stable');
  equal(ENFORCEMENT_DECISION_SPEC_VERSION, 'attestor.enforcement-decision.v1', 'Enforcement object model: decision schema version is stable');
  equal(ENFORCEMENT_RECEIPT_SPEC_VERSION, 'attestor.enforcement-receipt.v1', 'Enforcement object model: receipt schema version is stable');
}

function testEnforcementRequest(): ReturnType<typeof createEnforcementRequest> {
  const request = createEnforcementRequest({
    id: ' erq_001 ',
    receivedAt: '2026-04-18T09:15:12.100+02:00',
    enforcementPoint: sampleEnforcementPoint(),
    targetId: ' sec.edgar.filing.prepare ',
    outputHash: ' sha256:output ',
    consequenceHash: ' sha256:consequence ',
    releaseTokenId: ' rt_001 ',
    releaseDecisionId: ' rd_001 ',
    requester: {
      id: 'svc.reporting-bot',
      type: 'service',
      displayName: 'Reporting Bot',
    },
    traceId: ' trace-123 ',
    idempotencyKey: ' idem-123 ',
    transport: {
      kind: 'http',
      method: 'post',
      uri: 'https://attestor.example/filing/export',
      headersDigest: ' sha256:headers ',
      bodyDigest: ' sha256:body ',
    },
  });

  equal(request.version, ENFORCEMENT_REQUEST_SPEC_VERSION, 'Enforcement object model: request stamps schema version');
  equal(request.id, 'erq_001', 'Enforcement object model: request id is normalized');
  equal(request.receivedAt, '2026-04-18T07:15:12.100Z', 'Enforcement object model: request timestamp is normalized to ISO UTC');
  equal(request.enforcementPoint.environment, 'prod-eu', 'Enforcement object model: nested enforcement point is normalized');
  equal(request.enforcementPoint.accountId, 'acct-enterprise', 'Enforcement object model: nested account id is normalized');
  equal(request.targetId, 'sec.edgar.filing.prepare', 'Enforcement object model: target id is normalized');
  equal(request.transport?.kind, 'http', 'Enforcement object model: request can carry HTTP transport metadata');
  if (request.transport?.kind !== 'http') {
    throw new Error('Expected HTTP transport in test request.');
  }
  equal(request.transport.method, 'POST', 'Enforcement object model: HTTP method is normalized');
  equal(request.transport.bodyDigest, 'sha256:body', 'Enforcement object model: HTTP body digest is normalized');
  ok(request.enforcementPointLabel.includes('boundary:record-write'), 'Enforcement object model: request carries a readable point label');

  return request;
}

function testReleasePresentation(): ReturnType<typeof createReleasePresentation> {
  const presentation = createReleasePresentation({
    mode: 'dpop-bound-token',
    presentedAt: '2026-04-18T07:15:13.000Z',
    releaseToken: ' jwt.release.token ',
    releaseTokenId: ' rt_001 ',
    releaseTokenDigest: ' sha256:token ',
    issuer: ' attestor ',
    subject: ' releaseDecision:rd_001 ',
    audience: ' filing-export ',
    expiresAt: '2026-04-18T07:18:13.000Z',
    scope: ['record:write', 'filing:export', 'record:write', '  '],
    proof: {
      kind: 'dpop',
      proofJwt: ' dpop.jwt ',
      httpMethod: 'post',
      httpUri: 'https://attestor.example/filing/export?debug=false',
      proofJti: ' proof-jti-001 ',
      accessTokenHash: ' sha256:ath ',
      nonce: ' nonce-1 ',
      keyThumbprint: ' thumbprint-1 ',
    },
  });

  equal(presentation.version, RELEASE_PRESENTATION_SPEC_VERSION, 'Enforcement object model: presentation stamps schema version');
  equal(presentation.presentedAt, '2026-04-18T07:15:13.000Z', 'Enforcement object model: presentation timestamp is stable');
  equal(presentation.releaseTokenId, 'rt_001', 'Enforcement object model: token id is normalized');
  deepEqual(presentation.scope, ['filing:export', 'record:write'], 'Enforcement object model: scopes are unique and sorted');
  equal(presentation.proof?.kind, 'dpop', 'Enforcement object model: DPoP-bound presentation keeps DPoP proof');
  if (presentation.proof?.kind !== 'dpop') {
    throw new Error('Expected DPoP proof in test presentation.');
  }
  equal(presentation.proof.httpMethod, 'POST', 'Enforcement object model: DPoP HTTP method is normalized');
  equal(presentation.proof.proofJti, 'proof-jti-001', 'Enforcement object model: DPoP proof jti is normalized');

  return presentation;
}

function testIntrospectionSnapshot(): ReturnType<typeof createIntrospectionSnapshot> {
  const snapshot = createIntrospectionSnapshot({
    checkedAt: '2026-04-18T07:15:14.000Z',
    authority: ' attestor-release-authority ',
    active: true,
    releaseTokenId: ' rt_001 ',
    releaseDecisionId: ' rd_001 ',
    issuer: ' attestor ',
    subject: ' releaseDecision:rd_001 ',
    audience: ' filing-export ',
    scope: ['filing:export', 'record:write', 'filing:export'],
    issuedAt: '2026-04-18T07:15:13.000Z',
    expiresAt: '2026-04-18T07:18:13.000Z',
    notBefore: '2026-04-18T07:15:13.000Z',
    clientId: ' filing-export-pep ',
    consequenceType: 'record',
    riskClass: 'R4',
  });

  equal(snapshot.version, INTROSPECTION_SNAPSHOT_SPEC_VERSION, 'Enforcement object model: introspection stamps schema version');
  equal(snapshot.authority, 'attestor-release-authority', 'Enforcement object model: introspection authority is normalized');
  ok(snapshot.active, 'Enforcement object model: active introspection state is represented explicitly');
  deepEqual(snapshot.scope, ['filing:export', 'record:write'], 'Enforcement object model: introspection scopes are unique and sorted');
  equal(snapshot.consequenceType, 'record', 'Enforcement object model: introspection can carry consequence binding');
  equal(snapshot.riskClass, 'R4', 'Enforcement object model: introspection can carry risk binding');

  return snapshot;
}

function testVerificationDecisionAndReceipt(): void {
  const request = testEnforcementRequest();
  const presentation = testReleasePresentation();
  const introspection = testIntrospectionSnapshot();
  const verification = createVerificationResult({
    id: ' vr_001 ',
    checkedAt: '2026-04-18T07:15:15.000Z',
    mode: 'hybrid-required',
    status: 'valid',
    cacheState: 'fresh',
    degradedState: 'normal',
    presentation,
    releaseDecisionId: ' rd_001 ',
    outputHash: ' sha256:output ',
    consequenceHash: ' sha256:consequence ',
    introspection,
  });

  equal(verification.version, VERIFICATION_RESULT_SPEC_VERSION, 'Enforcement object model: verification stamps schema version');
  equal(verification.id, 'vr_001', 'Enforcement object model: verification id is normalized');
  equal(verification.presentationMode, 'dpop-bound-token', 'Enforcement object model: verification records presentation mode');
  equal(verification.releaseTokenId, 'rt_001', 'Enforcement object model: verification binds token id');
  equal(verification.outputHash, 'sha256:output', 'Enforcement object model: verification binds output hash');
  deepEqual(verification.failureReasons, [], 'Enforcement object model: valid verification has no failure reasons');

  const decision = createEnforcementDecision({
    id: ' ed_001 ',
    request,
    decidedAt: '2026-04-18T07:15:16.000Z',
    verification,
  });

  equal(decision.version, ENFORCEMENT_DECISION_SPEC_VERSION, 'Enforcement object model: decision stamps schema version');
  equal(decision.id, 'ed_001', 'Enforcement object model: decision id is normalized');
  equal(decision.outcome, 'allow', 'Enforcement object model: valid verification derives allow outcome');
  equal(decision.requestId, request.id, 'Enforcement object model: decision binds request');
  equal(decision.releaseTokenId, 'rt_001', 'Enforcement object model: decision carries release token id');

  const receipt = createEnforcementReceipt({
    id: ' erc_001 ',
    issuedAt: '2026-04-18T07:15:17.000Z',
    decision,
    receiptDigest: ' sha256:receipt ',
  });

  equal(receipt.version, ENFORCEMENT_RECEIPT_SPEC_VERSION, 'Enforcement object model: receipt stamps schema version');
  equal(receipt.decisionId, decision.id, 'Enforcement object model: receipt binds decision');
  equal(receipt.outcome, 'allow', 'Enforcement object model: receipt carries outcome');
  equal(receipt.outputHash, 'sha256:output', 'Enforcement object model: receipt inherits output hash from verification');
  equal(receipt.consequenceHash, 'sha256:consequence', 'Enforcement object model: receipt inherits consequence hash from verification');
}

function testInvalidAndBreakGlassBranches(): void {
  assert.throws(
    () =>
      createReleasePresentation({
        mode: 'dpop-bound-token',
        presentedAt: '2026-04-18T07:15:13.000Z',
        proof: null,
      }),
    /requires a DPoP proof/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createVerificationResult({
        id: 'vr_bad',
        checkedAt: '2026-04-18T07:15:15.000Z',
        mode: 'offline-signature',
        status: 'invalid',
        presentation: createReleasePresentation({
          mode: 'bearer-release-token',
          presentedAt: '2026-04-18T07:15:13.000Z',
          releaseTokenId: 'rt_bad',
        }),
      }),
    /requires a failure reason/i,
  );
  passed += 1;

  const request = createEnforcementRequest({
    id: 'erq_break_glass',
    receivedAt: '2026-04-18T07:15:12.000Z',
    enforcementPoint: sampleEnforcementPoint(),
    targetId: 'sec.edgar.filing.prepare',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
  });
  const invalidVerification = createVerificationResult({
    id: 'vr_invalid',
    checkedAt: '2026-04-18T07:15:15.000Z',
    mode: 'online-introspection',
    status: 'invalid',
    presentation: createReleasePresentation({
      mode: 'bearer-release-token',
      presentedAt: '2026-04-18T07:15:13.000Z',
      releaseTokenId: 'rt_revoked',
    }),
    failureReasons: ['revoked-authorization', 'revoked-authorization'],
  });

  assert.throws(
    () =>
      createEnforcementDecision({
        id: 'ed_bad_allow',
        request,
        decidedAt: '2026-04-18T07:15:16.000Z',
        verification: invalidVerification,
        outcome: 'allow',
      }),
    /allow decisions require valid verification/i,
  );
  passed += 1;

  const denied = createEnforcementDecision({
    id: 'ed_denied',
    request,
    decidedAt: '2026-04-18T07:15:16.000Z',
    verification: invalidVerification,
  });

  equal(denied.outcome, 'deny', 'Enforcement object model: invalid verification derives deny outcome');
  deepEqual(denied.failureReasons, ['revoked-authorization'], 'Enforcement object model: failure reasons are de-duplicated');

  const breakGlass = createEnforcementDecision({
    id: 'ed_break_glass',
    request,
    decidedAt: '2026-04-18T07:15:16.000Z',
    verification: invalidVerification,
    breakGlass: {
      reason: 'availability-restore',
      authorizedBy: {
        id: 'user_incident_commander',
        type: 'user',
        role: 'incident-commander',
      },
      authorizedAt: '2026-04-18T07:14:00.000Z',
      expiresAt: '2026-04-18T07:24:00.000Z',
      ticketId: 'INC-123',
      rationale: 'Restore filing export path while introspection service recovers.',
    },
  });

  equal(breakGlass.outcome, 'break-glass-allow', 'Enforcement object model: break-glass grant derives break-glass outcome');
  equal(breakGlass.breakGlass?.reason, 'availability-restore', 'Enforcement object model: break-glass reason is retained');
}

testSpecVersions();
testVerificationDecisionAndReceipt();
testInvalidAndBreakGlassBranches();

console.log(`Release enforcement-plane object-model tests: ${passed} passed, 0 failed`);
